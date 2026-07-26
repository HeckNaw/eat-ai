#!/usr/bin/env node
/**
 * Emit the compact payloads the browser downloads.
 *
 *   node scripts/build-web-data.mjs
 *
 * labelled.json is 3.6MB pretty-printed, most of which the app never reads.
 * This strips it to the fields the scorer and the cards actually use, with
 * short keys and packed opening hours. Runs on every build.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { isRuledOut, negatives } from "./lib/negatives.mjs";
import { isCorporateChain } from "./lib/chains.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PUB = join(ROOT, "public");
mkdirSync(PUB, { recursive: true });

const labelled = JSON.parse(readFileSync(join(ROOT, "labelled.json"), "utf8"));
const taste = JSON.parse(readFileSync(join(ROOT, "taste.json"), "utf8"));

/**
 * Google returns periods as {open:{day,hour,minute}, close:{...}}. Packed here
 * as [openDay, openMinuteOfDay, closeDay, closeMinuteOfDay] — a quarter of the
 * bytes and directly comparable at query time.
 */
function packHours(periods) {
  if (!periods?.length) return null;
  const out = [];
  for (const p of periods) {
    if (p.open?.day == null) continue;
    const od = p.open.day;
    const om = (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
    // A missing close means open 24h on that day.
    if (p.close?.day == null) { out.push([od, om, -1, -1]); continue; }
    out.push([od, om, p.close.day, (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0)]);
  }
  return out.length ? out : null;
}

const places = labelled.places
  // Explicitly ruled out. These were saved once and rejected later, and the
  // later judgement wins — shipping them would keep recommending places Nathan
  // has already said no to.
  .filter((p) => !isRuledOut(p))
  // Permanently closed places can't be recommended. They shaped taste.json
  // already, so dropping them here loses nothing.
  .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
  .filter((p) => p.lat != null && p.lng != null)
  .map((p) => ({
    i: p.placeId,
    n: p.name,
    a: p.address ?? null,
    y: +p.lat.toFixed(5),
    x: +p.lng.toFixed(5),
    c: p.cuisine ?? null,
    cs: p.cuisines?.length ? p.cuisines : null,
    f: p.cuisineFamily ?? null,
    at: p.attributes?.length ? p.attributes : null,
    r: p.rating ?? null,
    rc: p.reviewCount ?? null,
    p: p.priceLevel ? p.priceLevel.replace("PRICE_LEVEL_", "") : null,
    pe: p.priceEstimate?.band ? p.priceEstimate.band.replace("PRICE_LEVEL_", "") : null,
    h: packHours(p.openingHours),
    tz: p.utcOffsetMinutes ?? null,
    u: p.googleMapsUri ?? null,
    l: p.list,
    tmp: p.businessStatus === "CLOSED_TEMPORARILY" || undefined,
    // Corporate chain — Nathan dislikes corporate, not quick service, so the
    // scorer penalises these. Matched by brand name, not by Google's type.
    co: isCorporateChain(p.name) || undefined,
  }));

// Photo resource names are ~700 chars each; four per place is ~1.7MB — far too
// much to sit in the payload that boots the app and drives filtering. They go in
// a separate file, loaded lazily only once swiping starts, so the app boots on
// the lean 124KB places.json and photos stream in behind skeletons.
const photoMap = {};
for (const p of labelled.places) {
  if (p.placeId && !isRuledOut(p) && p.photos?.length) photoMap[p.placeId] = p.photos;
}

/**
 * Name each cluster by its main INTERSECTION, derived from the addresses already
 * on hand. No geocoding API, and it travels to any city where places are saved.
 *
 * A street alone is useless in Toronto — four separate clusters sit on Yonge St,
 * which runs 56km. "Yonge St & Yorkville Ave" is how people actually navigate.
 */
function nameClusters(clusters, allPlaces) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dist = (aY, aX, bY, bX) => {
    const h = Math.sin(rad(bY - aY) / 2) ** 2 +
      Math.cos(rad(aY)) * Math.cos(rad(bY)) * Math.sin(rad(bX - aX) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };

  /** "244 Claremont St Unit 3" -> "Claremont St" */
  const streetOf = (addr) => {
    if (!addr) return null;
    let s = addr.split(",")[0].trim();
    s = s.replace(/^[\d\-\/]+\s*/, "");
    s = s.replace(/\s+(unit|suite|ste|apt|#|no\.?)\s*.*$/i, "");
    // "Bloor St W Main Floor", "Queen St E Lower Level", "King St Rear"
    s = s.replace(/\s+(main|ground|lower|upper|second|basement|bsmt|mezzanine|concourse|penthouse|ph|rear|front|lobby)\b.*$/i, "");
    s = s.replace(/\s+\d+[a-z]?$/i, "");
    return s.length > 3 ? s : null;
  };

  /**
   * Collapse "Bloor St W" and "Bloor St W A" so a street never pairs with itself.
   * The trailing-letter strip runs while spaces still exist, and spares n/s/e/w
   * because those are real directions that distinguish two different streets.
   */
  const key = (s) =>
    s.toLowerCase()
      .replace(/[.,]/g, "")
      .replace(/\b(street|st)\b/g, "st")
      .replace(/\b(avenue|ave)\b/g, "av")
      .replace(/\b(road|rd)\b/g, "rd")
      .replace(/\b(boulevard|blvd)\b/g, "bl")
      .replace(/\b(drive|dr)\b/g, "dr")
      .replace(/\s+(?![nsew]\b)[a-z]\b\s*$/, "")
      .replace(/[^a-z0-9]/g, "");

  return clusters.map((c) => {
    const near = [];
    for (const p of allPlaces) {
      if (!p.a) continue;
      const d = dist(c.lat, c.lng, p.y, p.x);
      if (d < 650) near.push([p, d]);
    }

    // Weight by closeness — a street at the centroid names the place better than
    // one at the cluster's edge.
    const streets = new Map();
    const localities = new Map();
    for (const [p, d] of near) {
      const st = streetOf(p.a);
      if (st) {
        const k = key(st);
        const cur = streets.get(k) ?? { name: st, w: 0 };
        cur.w += 1 / (1 + d / 250);
        // Prefer the shorter spelling as the display form.
        if (st.length < cur.name.length) cur.name = st;
        streets.set(k, cur);
      }
      const loc = p.a.split(",")[1]?.trim();
      if (loc) localities.set(loc, (localities.get(loc) ?? 0) + 1);
    }

    const ranked = [...streets.values()].sort((a, b) => b.w - a.w);
    const locality = [...localities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    let name;
    if (ranked.length >= 2) {
      name = `${ranked[0].name} & ${ranked[1].name}`;
    } else if (ranked.length === 1) {
      // One street only — qualify it with the locality so it is still specific.
      name = locality && key(locality) !== key(ranked[0].name)
        ? `${ranked[0].name}, ${locality}`
        : ranked[0].name;
    } else {
      name = locality ?? "Saved area";
    }

    return {
      lat: c.lat,
      lng: c.lng,
      count: c.count,
      name,
      locality,
      topCuisines: c.topCuisines.slice(0, 3),
    };
  });
}

const namedClusters = nameClusters(taste.clusters, places);

// Only the parts of taste.json the client scores or renders with.
const webTaste = {
  cuisineAffinity: Object.fromEntries(
    Object.entries(taste.cuisineAffinity).map(([k, v]) => [k, v.weight]),
  ),
  familyAffinity: Object.fromEntries(
    Object.entries(taste.familyAffinity).map(([k, v]) => [k, v.weight]),
  ),
  attributeAffinity: Object.fromEntries(
    Object.entries(taste.attributeAffinity).map(([k, v]) => [k, v.weight]),
  ),
  clusters: taste.clusters.map((c) => [c.lat, c.lng, c.count]),
  // Named, largest first — the "where are you?" fallback list.
  areas: namedClusters.slice(0, 24),
  hierarchy: taste.hierarchy,
  chips: taste.chips,
  defaultSearchTypes: taste.defaultSearchTypes,
  // placeIds Nathan ruled out. Added to the discovery exclude set so a rejected
  // chain like Burrito Boyz can't return as an off-list "New to you" pick — the
  // saved-list exclusion alone doesn't cover these, since they were never saved.
  ruledOutIds: [...negatives.placeIds],
};

const write = (name, data) => {
  const json = JSON.stringify(data);
  writeFileSync(join(PUB, name), json);
  const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
  console.log(`  ${name.padEnd(14)} ${kb(json.length).padStart(7)}  →  ${kb(gzipSync(json).length)} gzipped`);
};

// The corporate list must never catch an independent. Print every saved place
// it flags, so a mis-tuned brand shows up as a favourite about to be buried.
const flaggedSaved = places.filter((p) => p.co).map((p) => p.n);
console.log(
  `corporate-flagged saved places: ${flaggedSaved.length}` +
    (flaggedSaved.length ? ` — ${[...new Set(flaggedSaved)].join(", ")}` : ""),
);

console.log(`\npacking ${places.length} places for the browser:`);
write("places.json", places);
write("taste.json", webTaste);
write("photos.json", photoMap);
console.log(`  (${Object.keys(photoMap).length} places have photos)`);
console.log("\nwrote to public/");
