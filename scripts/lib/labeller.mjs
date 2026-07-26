/**
 * The labeller. Imported by BOTH scripts/label.mjs (build time, saved list) and
 * scripts/discover.mjs (query time, off-list candidates) so the two paths are
 * literally the same code, not merely the same idea.
 *
 * A Nearby Search response carries the same fields the enrichment run fetched,
 * so an off-list candidate can be labelled the instant it arrives — no extra
 * API call, no build step.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const lex = JSON.parse(readFileSync(join(ROOT, "lexicon.json"), "utf8"));

// A name saying "Chengdu" beats Google saying "chinese_restaurant" — but only
// because Google is usually generic or empty. When Google IS specific
// ("ethiopian_restaurant"), that is a curated classification and outranks a
// keyword guess; otherwise a broad token like "african" wins over Ethiopian.
const W_TYPE_SPECIFIC = 4;
const W_NAME = 3;
const W_TYPE = 2;
const W_SUMMARY = 1;

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
export function normalize(s) {
  return ` ${(s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/**
 * Whole-word match, plus word-prefix for tokens of 5+ characters so "vietnam"
 * fires on "Vietnamese" and "crepe" on "Crepes". Shorter tokens stay exact-only,
 * otherwise "pho" would match "Phoenix".
 */
export function hasTerm(haystack, term) {
  const t = normalize(term).trim();
  if (!t) return false;
  if (haystack.includes(` ${t} `)) return true;
  if (t.length >= 5) return haystack.includes(` ${t}`);
  return false;
}

const cuisineKeys = Object.keys(lex.cuisines); // insertion order = specific first

export function labelCuisine(name, types, primaryType, summary) {
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

  if (scores.size === 0) {
    return { cuisine: null, cuisineFamily: null, cuisines: [], cuisineSource: null };
  }

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

export function labelAttributes(name, summary) {
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
export function estimatePrice(attributes) {
  const votes = attributes.map((a) => lex.attributes[a]?.impliesPrice).filter(Boolean);
  if (!votes.length) return null;
  const tally = new Map();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const [band, n] = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return { band, confidence: n >= 2 ? "medium" : "low", basis: attributes };
}

/**
 * Label a raw Places API result — the shape Nearby Search returns for a place
 * that is not on the saved list. Produces the same fields the saved list has,
 * so one scoring function can rank both.
 */
export function labelPlacesResult(r) {
  const name = r.displayName?.text ?? "";
  const summary = r.editorialSummary?.text ?? null;
  const cuisine = labelCuisine(name, r.types, r.primaryType, summary);
  const attributes = labelAttributes(name, summary);
  return {
    placeId: r.id,
    name,
    address: r.shortFormattedAddress ?? r.formattedAddress ?? null,
    lat: r.location?.latitude ?? null,
    lng: r.location?.longitude ?? null,
    primaryType: r.primaryType ?? null,
    types: r.types ?? [],
    rating: r.rating ?? null,
    reviewCount: r.userRatingCount ?? null,
    priceLevel: r.priceLevel ?? null,
    openingHours: r.regularOpeningHours?.periods ?? null,
    utcOffsetMinutes: r.utcOffsetMinutes ?? null,
    summary,
    businessStatus: r.businessStatus ?? null,
    googleMapsUri: r.googleMapsUri ?? null,
    photos: r.photos?.length ? r.photos.slice(0, 4).map((p) => p.name).filter(Boolean) : null,
    ...cuisine,
    attributes,
    priceEstimate: r.priceLevel ? null : estimatePrice(attributes),
    onList: false,
  };
}
