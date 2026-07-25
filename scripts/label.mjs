#!/usr/bin/env node
/**
 * Apply lexicon.json (+ overrides.json) to enriched.json -> labelled.json
 *
 *   node scripts/label.mjs
 *
 * No API calls, no cost, deterministic, re-runnable. Edit lexicon.json or
 * overrides.json and re-run.
 *
 * The matching itself lives in scripts/lib/labeller.mjs, which scripts/
 * discover.mjs also imports — so off-list candidates are labelled by the exact
 * same code, not merely the same approach.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lex, labelCuisine, labelAttributes, estimatePrice } from "./lib/labeller.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = JSON.parse(readFileSync(join(ROOT, "enriched.json"), "utf8"));
const overrides = existsSync(join(ROOT, "overrides.json"))
  ? JSON.parse(readFileSync(join(ROOT, "overrides.json"), "utf8")).byPlaceId
  : {};

const places = src.places.map((p) => {
  let cuisine = labelCuisine(p.name, p.types, p.primaryType, p.summary);
  const attributes = labelAttributes(p.name, p.summary);

  // Researched overrides win — they came from reading the actual menu or site.
  const ov = overrides[p.placeId];
  if (ov) {
    cuisine = {
      cuisine: ov.cuisine,
      cuisineFamily: lex.cuisines[ov.cuisine]?.family ?? null,
      cuisines: ov.cuisines ?? [ov.cuisine],
      cuisineSource: "researched",
    };
  }

  return {
    ...p,
    ...cuisine,
    attributes,
    priceEstimate: p.priceLevel ? null : estimatePrice(attributes),
    onList: true,
  };
});

writeFileSync(
  join(ROOT, "labelled.json"),
  JSON.stringify({ generatedAt: new Date().toISOString(), count: places.length, places }, null, 2),
);

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const open = places.filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY");
const tally = (arr, fn) => {
  const m = new Map();
  for (const x of arr) for (const k of [fn(x)].flat()) if (k != null) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]);
};

const labelled = open.filter((p) => p.cuisine);
console.log(`labelled ${labelled.length} / ${open.length} operational places with a cuisine`);
console.log(`  unlabelled: ${open.length - labelled.length}\n`);

console.log("how the cuisine was determined:");
for (const [k, n] of tally(labelled, (p) => p.cuisineSource)) {
  console.log(`  ${k.padEnd(12)} ${n}`);
}

const GENERIC = new Set(["restaurant", "meal_takeaway", "food", "meal_delivery", "cafe", null]);
const rescued = labelled.filter((p) => GENERIC.has(p.primaryType));
console.log(`\nplaces Google could not classify that now have a cuisine: ${rescued.length}`);
for (const p of rescued.slice(0, 8)) {
  console.log(`  ${p.name.slice(0, 34).padEnd(34)} ${String(p.primaryType)} -> ${p.cuisine}`);
}

console.log(`\ntop cuisines across all saved places:`);
for (const [k, n] of tally(open, (p) => p.cuisine).slice(0, 22)) {
  console.log(`  ${k.padEnd(28)} ${n}`);
}

console.log(`\nattributes found:`);
for (const [k, n] of tally(open, (p) => p.attributes)) {
  console.log(`  ${k.padEnd(18)} ${n}`);
}

const est = open.filter((p) => p.priceEstimate);
console.log(
  `\nprice: ${open.filter((p) => p.priceLevel).length} from Google, ` +
    `${est.length} estimated, ${open.length - open.filter((p) => p.priceLevel).length - est.length} still unknown`,
);
console.log(`\nwrote labelled.json`);
