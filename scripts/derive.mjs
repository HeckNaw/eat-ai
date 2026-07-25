#!/usr/bin/env node
/**
 * Derive taste.json from labelled.json.
 *
 *   node scripts/derive.mjs
 *
 * Pure statistics. No API calls, no cost, no hand-authored numbers anywhere —
 * every value here is counted from the saved places. That is the point: the
 * scorer reads this file and holds no taste assumptions of its own, so a
 * preference like "sometimes likes badly-rated dive spots" is something the
 * data can express rather than something a threshold has to permit.
 *
 * All 1,340 saved places carry equal weight. Might try / Must try / Hidden Gems
 * / Good eats is provenance, not a quality hierarchy.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { lex } from "./lib/labeller.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const src = JSON.parse(readFileSync(join(ROOT, "labelled.json"), "utf8"));

// Permanently closed places tell us nothing about where to eat tonight, but
// they DO still describe taste — a shuttered favourite was still a favourite.
// Kept for affinity, excluded from geography.
const all = src.places.filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY");
const located = all.filter((p) => p.lat != null && p.lng != null);

/** Count occurrences, then express each as a share and as 0..1 against the max. */
function affinity(items, pick) {
  const counts = new Map();
  let total = 0;
  for (const item of items) {
    for (const key of [pick(item)].flat()) {
      if (key == null) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      total += 1;
    }
  }
  const max = Math.max(1, ...counts.values());
  return Object.fromEntries(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, n]) => [key, { count: n, share: +(n / total).toFixed(5), weight: +(n / max).toFixed(4) }]),
  );
}

// `cuisines` (all matches) rather than `cuisine` (primary only): a Lebanese
// bakery should count toward both, the same way a craving matches either.
const cuisineAffinity = affinity(all, (p) => p.cuisines);
const familyAffinity = affinity(all, (p) => [
  ...new Set((p.cuisines ?? []).map((c) => lex.cuisines[c]?.family).filter(Boolean)),
]);
const attributeAffinity = affinity(all, (p) => p.attributes);

// ---------------------------------------------------------------------------
// geography — roughly 1km cells, merged into neighbourhoods
// ---------------------------------------------------------------------------

const LAT_CELL = 0.009; // ~1km
const LNG_CELL = 0.012; // ~1km at Toronto's latitude

const cells = new Map();
for (const p of located) {
  const key = `${Math.round(p.lat / LAT_CELL)},${Math.round(p.lng / LNG_CELL)}`;
  if (!cells.has(key)) cells.set(key, []);
  cells.get(key).push(p);
}

const clusters = [...cells.values()]
  .filter((ps) => ps.length >= 4) // a handful of places isn't a neighbourhood
  .map((ps) => {
    const counts = new Map();
    for (const p of ps) if (p.cuisine) counts.set(p.cuisine, (counts.get(p.cuisine) ?? 0) + 1);
    return {
      lat: +(ps.reduce((s, p) => s + p.lat, 0) / ps.length).toFixed(5),
      lng: +(ps.reduce((s, p) => s + p.lng, 0) / ps.length).toFixed(5),
      count: ps.length,
      topCuisines: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => k),
    };
  })
  .sort((a, b) => b.count - a.count);

// ---------------------------------------------------------------------------
// descriptive stats — recorded, deliberately NOT scoring inputs
// ---------------------------------------------------------------------------

function stats(values) {
  const v = values.filter((x) => x != null).sort((a, b) => a - b);
  if (!v.length) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const q = (f) => v[Math.min(v.length - 1, Math.floor(f * v.length))];
  return {
    n: v.length,
    mean: +mean.toFixed(3),
    sd: +Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length).toFixed(3),
    min: v[0], p10: q(0.1), median: q(0.5), p90: q(0.9), max: v[v.length - 1],
  };
}

// ---------------------------------------------------------------------------
// cuisine hierarchy — family, then the styles within it
// ---------------------------------------------------------------------------
//
// Selecting "Chinese" should mean every Chinese style; drilling in should let a
// specific one be picked. The tree is not authored — `family` already exists on
// every lexicon entry, and the counts come from the saved places.

const modeOf = (c) => lex.cuisines[c]?.mode ?? "savoury";

function buildHierarchy(mode) {
  const families = new Map();
  for (const [cuisine, v] of Object.entries(cuisineAffinity)) {
    const def = lex.cuisines[cuisine];
    if (!def) continue;
    const m = modeOf(cuisine);
    if (mode === "savoury" && !(m === "savoury" || m === "both")) continue;
    if (mode === "sweet" && !(m === "sweet" || m === "both")) continue;
    if (mode === "retail" && m !== "retail") continue;
    if (!families.has(def.family)) families.set(def.family, { family: def.family, count: 0, styles: [] });
    const f = families.get(def.family);
    f.count += v.count;
    f.styles.push({
      cuisine,
      count: v.count,
      weight: v.weight,
      googleTypes: def.googleTypes ?? [],
    });
  }
  return [...families.values()]
    .map((f) => ({ ...f, styles: f.styles.sort((a, b) => b.count - a.count) }))
    .sort((a, b) => b.count - a.count);
}

const hierarchy = {
  savoury: buildHierarchy("savoury"),
  sweet: buildHierarchy("sweet"),
  retail: buildHierarchy("retail"),
};

// Chips for the question screen, split by the top-level sweet/savoury choice.
//
// Note the asymmetry with the hierarchy above: a "both" cuisine (bakery, coffee)
// is MATCHABLE in savoury mode — a Lebanese bakery selling manakish should turn
// up in a savoury search — but is not PROMOTED as a savoury chip, because
// offering "Bakery" as a top suggestion at 7pm is noise. Inclusion and promotion
// are different things.
function chipsFor(mode) {
  return Object.entries(cuisineAffinity)
    .filter(([k, v]) => {
      const m = modeOf(k);
      // "both" belongs on the sweet side — bakeries and cafés are where you go
      // for something sweet — but must not crowd the savoury list.
      const ok = mode === "sweet" ? m === "sweet" || m === "both" : m === "savoury";
      return ok && v.count >= 10;
    })
    .slice(0, 12)
    .map(([k, v]) => ({
      cuisine: k,
      count: v.count,
      family: lex.cuisines[k]?.family ?? null,
      googleTypes: lex.cuisines[k]?.googleTypes ?? [],
    }));
}
const chips = { savoury: chipsFor("savoury"), sweet: chipsFor("sweet") };

// When no craving is selected, discovery still narrows to these rather than
// running unrestricted — an unrestricted Nearby Search downtown returns
// franchises, which is the opposite of what the saved lists describe.
function defaultTypesFor(mode) {
  return [
    ...new Set(
      Object.keys(cuisineAffinity)
        .filter((c) => {
          const m = modeOf(c);
          return mode === "sweet" ? m === "sweet" || m === "both" : m === "savoury" || m === "both";
        })
        .slice(0, 20)
        .flatMap((c) => lex.cuisines[c]?.googleTypes ?? [])
        .filter(Boolean),
    ),
  ];
}
const defaultSearchTypes = { savoury: defaultTypesFor("savoury"), sweet: defaultTypesFor("sweet") };

const taste = {
  generatedAt: new Date().toISOString(),
  basis: {
    places: all.length,
    withCoordinates: located.length,
    note: "All saved places weighted equally. Provenance (might_try/must_try/hidden_gem/good_eats) is not a quality hierarchy and is not used here.",
  },
  cuisineAffinity,
  familyAffinity,
  hierarchy,
  attributeAffinity,
  clusters,
  chips,
  defaultSearchTypes,
  descriptiveOnly: {
    note: "Recorded for display, NOT scoring inputs. Rating is too tightly distributed to discriminate and weighting it would push down the low-rated favourites. Review count shows no obscurity preference. Price is missing for ~46% of saved places and ~75% of off-list candidates.",
    rating: stats(all.map((p) => p.rating)),
    reviewCount: stats(all.map((p) => p.reviewCount)),
    priceLevel: Object.fromEntries(
      Object.entries(
        all.reduce((m, p) => ((m[p.priceLevel ?? "unknown"] = (m[p.priceLevel ?? "unknown"] ?? 0) + 1), m), {}),
      ).sort((a, b) => b[1] - a[1]),
    ),
  },
};

writeFileSync(join(ROOT, "taste.json"), JSON.stringify(taste, null, 2));

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

console.log(`derived from ${all.length} places (${located.length} with coordinates)\n`);

console.log("cuisine affinity — top 16 (weight is 0..1 against the strongest):");
for (const [k, v] of Object.entries(cuisineAffinity).slice(0, 16)) {
  const bar = "█".repeat(Math.round(v.weight * 34));
  console.log(`  ${k.padEnd(26)} ${String(v.count).padStart(4)}  ${v.weight.toFixed(2)}  ${bar}`);
}

console.log("\ncuisine family:");
for (const [k, v] of Object.entries(familyAffinity).slice(0, 10)) {
  console.log(`  ${k.padEnd(20)} ${String(v.count).padStart(4)}  ${v.weight.toFixed(2)}`);
}

console.log("\nattribute affinity:");
for (const [k, v] of Object.entries(attributeAffinity).slice(0, 12)) {
  console.log(`  ${k.padEnd(18)} ${String(v.count).padStart(4)}  ${v.weight.toFixed(2)}`);
}

console.log(`\nneighbourhoods (>=4 saved places): ${clusters.length}`);
for (const c of clusters.slice(0, 8)) {
  console.log(`  ${String(c.count).padStart(3)} places  ${c.lat},${c.lng}  ${c.topCuisines.slice(0, 4).join(", ")}`);
}

console.log(`\nSAVOURY chips: ${chips.savoury.map((c) => c.cuisine).join(" · ")}`);
console.log(`SWEET chips:   ${chips.sweet.map((c) => c.cuisine).join(" · ")}`);

console.log(`\nhierarchy — savoury families and their styles:`);
for (const f of hierarchy.savoury.slice(0, 7)) {
  console.log(`  ${f.family} (${f.count})`);
  console.log(`      ${f.styles.map((s2) => `${s2.cuisine} ${s2.count}`).join(" · ")}`);
}
console.log(`\nhierarchy — sweet:`);
for (const f of hierarchy.sweet) {
  console.log(`  ${f.family} (${f.count}): ${f.styles.map((s2) => `${s2.cuisine} ${s2.count}`).join(" · ")}`);
}
console.log(`\nwrote taste.json`);
