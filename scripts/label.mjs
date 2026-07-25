#!/usr/bin/env node
/**
 * Apply lexicon.json to enriched.json -> labelled.json
 *
 *   node scripts/label.mjs
 *
 * No API calls, no cost, deterministic, re-runnable. Edit lexicon.json and
 * re-run to change the labels.
 *
 * Adds per place:
 *   cuisine          most specific match ("Sichuan", not "Chinese")
 *   cuisineFamily    grouping for the scorer
 *   cuisines[]       every cuisine matched
 *   cuisineSource    name | googleType | summary  — how it was determined
 *   attributes[]     no-frills, counter-service, institution, ...
 *   priceEstimate    only when Google has no priceLevel; never overwrites it
 *
 * The same functions label off-list discovery candidates at query time, which
 * is why the matching lives here and the vocabulary lives in data.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const lex = JSON.parse(readFileSync(join(ROOT, "lexicon.json"), "utf8"));
// Manual research: places whose cuisine is in neither the name nor Google's
// taxonomy, resolved by reading their website or searching them.
const overrides = existsSync(join(ROOT, "overrides.json"))
  ? JSON.parse(readFileSync(join(ROOT, "overrides.json"), "utf8")).byPlaceId
  : {};
const src = JSON.parse(readFileSync(join(ROOT, "enriched.json"), "utf8"));

// A name saying "Chengdu" beats Google saying "chinese_restaurant" — but only
// because Google is usually generic or empty. When Google IS specific
// ("ethiopian_restaurant"), that is a curated classification and outranks a
// keyword guess: otherwise a broad token like "african" wins over Ethiopian.
const W_TYPE_SPECIFIC = 4;
const W_NAME = 3;
const W_TYPE = 2;
const W_SUMMARY = 1;

// Types that carry no cuisine information, so they only ever score W_TYPE.
const GENERIC_TYPES = new Set([
  "restaurant", "food", "meal_takeaway", "meal_delivery", "cafe", "bar", "pub",
  "asian_restaurant", "fast_food_restaurant", "fine_dining_restaurant",
  "fusion_restaurant", "asian_fusion_restaurant", "american_restaurant",
  "chinese_restaurant", "sandwich_shop", "deli", "bakery", "dessert_shop",
  "ice_cream_shop", "coffee_shop", "confectionery", "food_store",
  "grocery_store", "seafood_restaurant", "barbecue_restaurant",
  "chicken_restaurant", "hamburger_restaurant", "pizza_restaurant",
  "steak_house", "breakfast_restaurant", "brunch_restaurant", "tea_house",
  "bubble_tea_store", "pastry_shop", "bagel_shop", "dessert_restaurant",
  "candy_store", "poke_restaurant", "hawaiian_restaurant", "halal_restaurant",
  "chicken_wings_restaurant", "vegan_restaurant", "vegetarian_restaurant",
]);

/** Lowercase, strip punctuation to spaces, keep CJK and accented letters. */
function normalize(s) {
  return ` ${(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Whole-word / whole-phrase containment. The leading and trailing spaces added
 * by normalize() are what make this a boundary match — so "pho" does not fire
 * on "Phoenix", and "lao" does not fire on "Laotian"'s neighbours.
 */
function hasTerm(haystack, term) {
  const t = normalize(term).trim();
  if (!t) return false;
  // Exact word match always counts.
  if (haystack.includes(` ${t} `)) return true;
  // Tokens of 5+ characters also match as a word PREFIX, so "vietnam" fires on
  // "Vietnamese" and "crepe" on "Crepes". Shorter tokens stay exact-only —
  // otherwise "pho" would match "Phoenix".
  if (t.length >= 5) return haystack.includes(` ${t}`);
  return false;
}

const cuisineKeys = Object.keys(lex.cuisines); // insertion order = specific first

function labelCuisine(name, types, primaryType, summary) {
  const hName = normalize(name);
  const hSummary = normalize(summary);
  const typeSet = new Set([...(types ?? []), primaryType].filter(Boolean));

  const scores = new Map();
  const sources = new Map();

  for (const key of cuisineKeys) {
    const def = lex.cuisines[key];
    let score = 0;
    let source = null;

    for (const tok of def.nameTokens ?? []) {
      if (hasTerm(hName, tok)) { score += W_NAME; source ??= "name"; break; }
    }
    for (const gt of def.googleTypes ?? []) {
      if (typeSet.has(gt)) {
        score += GENERIC_TYPES.has(gt) ? W_TYPE : W_TYPE_SPECIFIC;
        source ??= "googleType";
        break;
      }
    }
    for (const st of def.summaryTerms ?? []) {
      if (hasTerm(hSummary, st)) { score += W_SUMMARY; source ??= "summary"; break; }
    }
    if (score > 0) { scores.set(key, score); sources.set(key, source); }
  }

  if (scores.size === 0) return { cuisine: null, cuisineFamily: null, cuisines: [], cuisineSource: null };

  // Highest score wins; on a tie the earlier (more specific) lexicon key wins,
  // so "Sichuan" beats "Chinese" rather than the reverse.
  const ranked = [...scores.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return cuisineKeys.indexOf(a[0]) - cuisineKeys.indexOf(b[0]);
  });

  const [best] = ranked;
  return {
    cuisine: best[0],
    cuisineFamily: lex.cuisines[best[0]].family,
    cuisines: ranked.map(([k]) => k),
    cuisineSource: sources.get(best[0]),
  };
}

function labelAttributes(name, summary) {
  const hName = normalize(name);
  const hSummary = normalize(summary);
  const found = [];
  for (const [attr, def] of Object.entries(lex.attributes)) {
    const hit =
      (def.summaryTerms ?? []).some((t) => hasTerm(hSummary, t)) ||
      (def.nameTokens ?? []).some((t) => hasTerm(hName, t));
    if (hit) found.push(attr);
  }
  return found;
}

/** Only consulted when Google has no priceLevel. Never overwrites a real value. */
function estimatePrice(attributes) {
  const votes = attributes
    .map((a) => lex.attributes[a]?.impliesPrice)
    .filter(Boolean);
  if (!votes.length) return null;
  const tally = new Map();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const [band, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return { band, confidence: n >= 2 ? "medium" : "low", basis: attributes };
}

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
