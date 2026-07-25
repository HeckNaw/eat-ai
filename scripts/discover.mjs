#!/usr/bin/env node
/**
 * Off-list discovery: find places NOT already saved, near a location.
 *
 *   node --env-file=.env scripts/discover.mjs --lat 43.6532 --lng -79.3832 \
 *        --radius 2000 --cuisines "Korean,Vietnamese,Middle Eastern"
 *
 * The point of this file: a Nearby Search response carries the SAME fields the
 * enrichment run fetched, because the field mask is the same. So off-list
 * candidates arrive already enriched — there is no second lookup. The lexicon
 * then labels them with the same functions used on the saved list, so both
 * sources produce identical feature vectors and can be scored by one function.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

// Byte-for-byte the mask used by enrich.mjs — that is what makes discovery
// results structurally identical to saved-list records.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.shortFormattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.priceLevel",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.utcOffsetMinutes",
  "places.editorialSummary",
  "places.businessStatus",
  "places.googleMapsUri",
].join(",");

function parseArgs(argv) {
  const out = { lat: 43.6532, lng: -79.3832, radius: 2000, cuisines: null, max: 20 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--lat") out.lat = Number(argv[++i]);
    else if (a === "--lng") out.lng = Number(argv[++i]);
    else if (a === "--radius") out.radius = Number(argv[++i]);
    else if (a === "--cuisines") out.cuisines = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--max") out.max = Number(argv[++i]);
  }
  return out;
}

/** Map lexicon cuisine names to the Google primary types Nearby Search accepts. */
export function googleTypesFor(cuisines, lex) {
  const types = new Set();
  for (const c of cuisines ?? []) {
    for (const t of lex.cuisines[c]?.googleTypes ?? []) types.add(t);
  }
  return [...types];
}

export async function searchNearby({ apiKey, lat, lng, radius, includedPrimaryTypes, max = 20 }) {
  const body = {
    locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    maxResultCount: Math.min(max, 20),
    // DISTANCE rather than the default POPULARITY. Prominence ranking returns
    // the chains and patio spots that years of saving nothing already rejected.
    rankPreference: "DISTANCE",
    languageCode: "en",
    regionCode: "CA",
  };
  if (includedPrimaryTypes?.length) body.includedPrimaryTypes = includedPrimaryTypes;

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).places ?? [];
}

// --------------------------------------------------------------------------
// CLI — verification harness
// --------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.error("run with: node --env-file=.env scripts/discover.mjs");
    process.exit(1);
  }

  const lex = JSON.parse(readFileSync(join(ROOT, "lexicon.json"), "utf8"));
  const saved = JSON.parse(readFileSync(join(ROOT, "labelled.json"), "utf8"));
  const savedIds = new Set(saved.places.map((p) => p.placeId));

  const includedPrimaryTypes = args.cuisines ? googleTypesFor(args.cuisines, lex) : [];
  console.log(`searching ${args.radius}m around ${args.lat},${args.lng}`);
  if (includedPrimaryTypes.length) console.log(`narrowed to: ${includedPrimaryTypes.join(", ")}`);

  const results = await searchNearby({ apiKey, ...args, includedPrimaryTypes });

  const fresh = results.filter((r) => !savedIds.has(r.id));
  console.log(`\n${results.length} returned · ${results.length - fresh.length} already on your lists · ${fresh.length} new\n`);

  const field = (r, f) => (f(r) == null ? "—" : f(r));
  console.log("FIELD AVAILABILITY on off-list results (vs the saved-list record):");
  const checks = {
    "coords": (r) => r.location?.latitude,
    "rating": (r) => r.rating,
    "reviewCount": (r) => r.userRatingCount,
    "priceLevel": (r) => r.priceLevel,
    "openingHours": (r) => r.regularOpeningHours?.periods,
    "editorialSummary": (r) => r.editorialSummary?.text,
    "primaryType": (r) => r.primaryType,
    "businessStatus": (r) => r.businessStatus,
  };
  for (const [name, fn] of Object.entries(checks)) {
    const n = results.filter((r) => fn(r) != null).length;
    console.log(`  ${name.padEnd(18)} ${n}/${results.length}`);
  }

  console.log(`\nNEW TO YOU (nearest first):`);
  for (const r of fresh.slice(0, 12)) {
    const rating = r.rating ? `${r.rating}★ (${r.userRatingCount})` : "unrated";
    console.log(`  ${(r.displayName?.text ?? "?").slice(0, 32).padEnd(32)} ${rating.padEnd(16)} ${r.primaryType ?? "—"}`);
    if (r.editorialSummary?.text) console.log(`      "${r.editorialSummary.text.slice(0, 76)}"`);
  }
}
