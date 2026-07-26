#!/usr/bin/env node
/**
 * Resolve every place in seed.json against Places API (New) and write enriched.json.
 *
 *   node --env-file=.env scripts/enrich.mjs --limit 10        # probe: 10 searches
 *   node --env-file=.env scripts/enrich.mjs --titles "Gus Tacos,Zen Kyoto - Bay Adelaide Centre"
 *   node --env-file=.env scripts/enrich.mjs                   # full run
 *   node --env-file=.env scripts/enrich.mjs --force           # ignore cache
 *
 * One search per unique title, asking for up to 20 results, then each of your
 * saved CIDs is matched against those results. That's what lets six Gus Tacos
 * branches resolve to six distinct records — searching per-record would return
 * the same top hit six times.
 *
 * Every raw response is appended to data/places-cache.jsonl, so an interrupted
 * run resumes for free and re-runs cost nothing.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CACHE = join(ROOT, "data", "places-cache.jsonl");

// Input and output are overridable so the same path can enrich the negative
// lists (--in negatives.json --out negatives-enriched.json). They must go
// through this script and not a variant of it: a negative is only comparable to
// a positive if it carries the identical field mask, and the cache is shared,
// so anything already fetched as a positive costs nothing to fetch again.

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

// Only what the scorer actually reads. Adding places.reviews would push this
// into the priciest SKU tier; we deliberately don't.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.primaryTypeDisplayName",
  "places.priceLevel",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.utcOffsetMinutes",
  "places.websiteUri",
  "places.editorialSummary",
  "places.businessStatus",
  "places.googleMapsUri",
  // Photo resource names only — the actual images are fetched separately and on
  // demand through /api/photo, so this adds no cost here (photos is a Pro field
  // and the mask is already Enterprise+Atmosphere, the top tier).
  "places.photos",
].join(",");

// How many photo references to keep per place. The UI shows up to four in a
// grid; keeping exactly that avoids bloating the payload with refs never shown.
const MAX_PHOTOS = 4;

/** Google returns rich photo objects; we only need the resource name to fetch. */
function photoNames(photos) {
  if (!photos?.length) return null;
  const names = photos.slice(0, MAX_PHOTOS).map((p) => p.name).filter(Boolean);
  return names.length ? names : null;
}

const CONCURRENCY = 4;
const MAX_RETRIES = 4;

// ---------------------------------------------------------------------------
// args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {
    limit: Infinity,
    titles: null,
    force: false,
    maxCalls: 1300,
    in: "seed.json",
    out: "enriched.json",
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") out.in = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]);
    else if (a === "--titles") out.titles = argv[++i].split(",").map((s) => s.trim().toLowerCase());
    else if (a === "--max-calls") out.maxCalls = Number(argv[++i]);
    else if (a === "--force") out.force = true;
    else if (a === "--help" || a === "-h") {
      console.log(readFileSync(new URL(import.meta.url)).toString().split("*/")[0]);
      process.exit(0);
    } else {
      console.error(`Unknown flag: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const SEED = join(ROOT, args.in);
const OUT = join(ROOT, args.out);

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error(
    "GOOGLE_MAPS_API_KEY is not set.\n" +
      "Run with:  node --env-file=.env scripts/enrich.mjs",
  );
  process.exit(1);
}

const BIAS = {
  lat: Number(process.env.HOME_LAT ?? 43.6532),
  lng: Number(process.env.HOME_LNG ?? -79.3832),
  radius: Math.min(Number(process.env.SEARCH_RADIUS_M ?? 50000), 50000),
};

// ---------------------------------------------------------------------------
// identity helpers
// ---------------------------------------------------------------------------

/** Your CSV stores the feature ID in hex; Places returns the CID in decimal. */
function hexCidToDecimal(hexCid) {
  try {
    return BigInt(hexCid).toString(10);
  } catch {
    return null;
  }
}

/** Pull the cid query param out of a Places googleMapsUri, if present. */
function cidFromMapsUri(uri) {
  if (!uri) return null;
  const m = /[?&]cid=(\d+)/.exec(uri);
  return m ? m[1] : null;
}

function normalize(s) {
  return (s ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** Token-overlap ratio, used only when the CID match fails. */
function nameSimilarity(a, b) {
  const A = new Set(normalize(a).split(" "));
  const B = new Set(normalize(b).split(" "));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  return shared / Math.max(A.size, B.size);
}

// ---------------------------------------------------------------------------
// cache
// ---------------------------------------------------------------------------

function loadCache() {
  const cache = new Map();
  if (!existsSync(CACHE)) return cache;
  for (const line of readFileSync(CACHE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      cache.set(entry.query, entry.response); // later lines win
    } catch {
      /* skip a torn final line from an interrupted write */
    }
  }
  return cache;
}

function cachePut(query, response) {
  appendFileSync(CACHE, JSON.stringify({ query, response, at: new Date().toISOString() }) + "\n");
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function searchText(textQuery) {
  const body = {
    textQuery,
    maxResultCount: 20, // billed per request, not per result — free breadth
    languageCode: "en",
    regionCode: "CA",
    locationBias: {
      circle: {
        center: { latitude: BIAS.lat, longitude: BIAS.lng },
        radius: BIAS.radius,
      },
    },
  };

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": API_KEY,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (res.ok) return res.json();

    const text = await res.text();

    // 4xx other than rate limiting won't fix itself — surface it immediately.
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`HTTP ${res.status} for ${textQuery}\n${text}`);
    }
    if (attempt === MAX_RETRIES) {
      throw new Error(`HTTP ${res.status} after ${MAX_RETRIES} retries: ${text}`);
    }
    await sleep(2 ** attempt * 1000);
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const seed = JSON.parse(readFileSync(SEED, "utf8"));

  // Group saved places by the title we'll search for.
  const tasks = new Map(); // normalizedTitle -> { query, places: [] }
  for (const place of seed.places) {
    const key = place.normalizedTitle;
    if (!tasks.has(key)) tasks.set(key, { query: place.title, places: [] });
    tasks.get(key).places.push(place);
  }

  let list = [...tasks.values()];
  if (args.titles) {
    list = list.filter((t) => args.titles.some((want) => t.query.toLowerCase().includes(want)));
  }
  // Probe mode: bias toward the interesting cases — multi-branch chains and
  // non-Latin names are where matching is most likely to break.
  if (Number.isFinite(args.limit)) {
    list.sort((a, b) => {
      const branch = b.places.length - a.places.length;
      if (branch !== 0) return branch;
      const cjk = (t) => (/[\u3000-\u9fff\uac00-\ud7af]/.test(t.query) ? 0 : 1);
      return cjk(a) - cjk(b);
    });
    list = list.slice(0, args.limit);
  }

  const cache = loadCache();
  console.log(
    `${list.length} searches (${list.reduce((n, t) => n + t.places.length, 0)} places)` +
      `${args.force ? " — cache ignored" : ` — ${cache.size} cached`}`,
  );

  const enriched = [];
  const unmatched = [];
  let calls = 0;
  let cursor = 0;
  let capHit = false;

  async function worker() {
    while (cursor < list.length) {
      const task = list[cursor++];
      let response = args.force ? undefined : cache.get(task.query);

      if (!response) {
        // Hard ceiling on billable calls. Cheap insurance against a loop bug
        // burning through the free tier and into paid territory.
        if (calls >= args.maxCalls) {
          if (!capHit) {
            capHit = true;
            console.error(`\n⚠ hit --max-calls ceiling of ${args.maxCalls}; stopping fetches`);
          }
          unmatched.push({ ...task.places[0], reason: "max_calls_reached" });
          continue;
        }
        try {
          response = await searchText(task.query);
          calls++;
          cachePut(task.query, response);
        } catch (err) {
          console.error(`  ✗ ${task.query}: ${err.message.split("\n")[0]}`);
          for (const p of task.places) unmatched.push({ ...p, reason: "api_error" });
          continue;
        }
      }

      const results = response.places ?? [];
      const claimed = new Set();

      for (const place of task.places) {
        const wantCid = place.cid ? hexCidToDecimal(place.cid) : null;

        // 1. Exact: CID from the Maps URL matches the CID Places returned.
        let hit = wantCid
          ? results.find((r) => cidFromMapsUri(r.googleMapsUri) === wantCid)
          : undefined;
        let confidence = hit ? "cid_exact" : null;

        // 2. Fall back to the best unclaimed name match.
        if (!hit) {
          let best = null;
          let bestScore = 0;
          for (const r of results) {
            if (claimed.has(r.id)) continue;
            const score = nameSimilarity(place.title, r.displayName?.text);
            if (score > bestScore) {
              best = r;
              bestScore = score;
            }
          }
          if (best && bestScore >= 0.6) {
            hit = best;
            confidence = bestScore === 1 ? "name_exact" : "name_fuzzy";
          }
        }

        if (!hit) {
          unmatched.push({ ...place, reason: results.length ? "no_match" : "no_results" });
          continue;
        }
        claimed.add(hit.id);

        enriched.push({
          ...place,
          confidence,
          placeId: hit.id,
          name: hit.displayName?.text ?? place.title,
          address: hit.shortFormattedAddress ?? hit.formattedAddress ?? null,
          lat: hit.location?.latitude ?? null,
          lng: hit.location?.longitude ?? null,
          primaryType: hit.primaryType ?? null,
          primaryTypeLabel: hit.primaryTypeDisplayName?.text ?? null,
          types: hit.types ?? [],
          priceLevel: hit.priceLevel ?? null,
          rating: hit.rating ?? null,
          reviewCount: hit.userRatingCount ?? null,
          openingHours: hit.regularOpeningHours?.periods ?? null,
          utcOffsetMinutes: hit.utcOffsetMinutes ?? null,
          website: hit.websiteUri ?? null,
          summary: hit.editorialSummary?.text ?? null,
          businessStatus: hit.businessStatus ?? null,
          googleMapsUri: hit.googleMapsUri ?? null,
          photos: photoNames(hit.photos),
          enriched: true,
        });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, list.length) }, worker));

  enriched.sort((a, b) => a.normalizedTitle.localeCompare(b.normalizedTitle));

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        partial: list.length < tasks.size,
        searches: list.length,
        apiCalls: calls,
        count: enriched.length,
        unmatchedCount: unmatched.length,
        places: enriched,
        unmatched,
      },
      null,
      2,
    ),
  );

  report({ enriched, unmatched, calls, searches: list.length });
}

function report({ enriched, unmatched, calls, searches }) {
  const tally = (fn) => {
    const m = new Map();
    for (const p of enriched) {
      const k = fn(p) ?? "(none)";
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort((a, b) => b[1] - a[1]);
  };

  console.log(`\nsearches: ${searches}   billed calls: ${calls}   matched: ${enriched.length}   unmatched: ${unmatched.length}`);

  console.log(`\nmatch confidence:`);
  for (const [k, n] of tally((p) => p.confidence)) console.log(`  ${k.padEnd(12)} ${n}`);

  console.log(`\nprimaryType (this is the granularity the taste profile depends on):`);
  for (const [k, n] of tally((p) => p.primaryType).slice(0, 25)) {
    console.log(`  ${String(k).padEnd(30)} ${n}`);
  }

  const coords = enriched.filter((p) => p.lat != null).length;
  const priced = enriched.filter((p) => p.priceLevel).length;
  const rated = enriched.filter((p) => p.rating != null).length;
  const hours = enriched.filter((p) => p.openingHours).length;
  console.log(
    `\nfield coverage:  coords ${coords}/${enriched.length}   price ${priced}   rating ${rated}   hours ${hours}`,
  );

  const closed = enriched.filter((p) => p.businessStatus && p.businessStatus !== "OPERATIONAL");
  if (closed.length) {
    console.log(`\n${closed.length} no longer operational:`);
    for (const p of closed.slice(0, 10)) console.log(`  ${p.name} — ${p.businessStatus}`);
  }

  const multi = new Map();
  for (const p of enriched) {
    const k = p.normalizedTitle;
    if (!multi.has(k)) multi.set(k, []);
    multi.get(k).push(p);
  }
  const chains = [...multi.values()].filter((v) => v.length > 1);
  if (chains.length) {
    console.log(`\nmulti-branch chains resolved (distinct coordinates = working):`);
    for (const branches of chains.slice(0, 3)) {
      console.log(`  ${branches[0].name} — ${branches.length} branches`);
      for (const b of branches) {
        const at = b.lat != null ? `${b.lat.toFixed(4)}, ${b.lng.toFixed(4)}` : "no coords";
        console.log(`      ${at}  ${b.confidence}  ${b.address ?? ""}`);
      }
    }
  }

  if (unmatched.length) {
    console.log(`\nneeds manual attention:`);
    for (const p of unmatched.slice(0, 15)) console.log(`  [${p.reason}] ${p.title}`);
    if (unmatched.length > 15) console.log(`  ... and ${unmatched.length - 15} more`);
  }

  console.log(`\nwrote ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
