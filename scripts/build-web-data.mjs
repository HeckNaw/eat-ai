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
  }));

/**
 * Name each cluster from the addresses of the places inside it — the most common
 * street plus the locality. Free, and it turns the location-denied fallback into
 * "pick where you are" instead of a dead end. No geocoding API needed.
 */
function nameClusters(clusters, allPlaces) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dist = (aY, aX, bY, bX) => {
    const h = Math.sin(rad(bY - aY) / 2) ** 2 +
      Math.cos(rad(aY)) * Math.cos(rad(bY)) * Math.sin(rad(bX - aX) / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  return clusters.map((c) => {
    const near = allPlaces.filter((p) => p.a && dist(c.lat, c.lng, p.y, p.x) < 700);
    const streets = new Map(), localities = new Map();
    for (const p of near) {
      const parts = p.a.split(",").map((x) => x.trim());
      // "244 Claremont St" -> "Claremont St"
      const street = (parts[0] ?? "").replace(/^[\d\-\/]+\s*/, "").replace(/\s+(unit|suite|#).*$/i, "");
      if (street.length > 3) streets.set(street, (streets.get(street) ?? 0) + 1);
      const loc = parts[1];
      if (loc) localities.set(loc, (localities.get(loc) ?? 0) + 1);
    }
    const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const street = top(streets), locality = top(localities);
    return {
      lat: c.lat, lng: c.lng, count: c.count,
      name: street ? (locality && locality !== street ? `${street}, ${locality}` : street) : locality ?? "Saved area",
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
};

const write = (name, data) => {
  const json = JSON.stringify(data);
  writeFileSync(join(PUB, name), json);
  const kb = (n) => `${(n / 1024).toFixed(0)}KB`;
  console.log(`  ${name.padEnd(14)} ${kb(json.length).padStart(7)}  →  ${kb(gzipSync(json).length)} gzipped`);
};

console.log(`packing ${places.length} places for the browser:`);
write("places.json", places);
write("taste.json", webTaste);
console.log("\nwrote to public/");
