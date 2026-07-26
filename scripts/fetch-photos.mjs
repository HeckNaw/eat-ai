#!/usr/bin/env node
/**
 * Add photo references to enriched.json — cheaply.
 *
 *   node --env-file=.env scripts/fetch-photos.mjs
 *   node --env-file=.env scripts/fetch-photos.mjs --limit 5   # probe
 *
 * The obvious way — re-running enrich.mjs with the photos field — would re-bill
 * every place at Text Search Enterprise+Atmosphere ($57/1000), ~$70 once this
 * month's free tier is spent. This avoids that entirely: we already have every
 * placeId, so a direct Place Details lookup asking for id+photos bills at Place
 * Details Pro, which has 5,000 free requests a month and is otherwise untouched.
 * 1,266 places < 5,000, so the whole pass is $0.
 *
 * Writes the photo resource names back into enriched.json, so re-running
 * label.mjs carries them into labelled.json and the browser payload. Every
 * response is cached, so a re-run costs nothing.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENRICHED = join(ROOT, "enriched.json");
const CACHE = join(ROOT, "data", "photos-cache.jsonl");

const API_KEY = process.env.GOOGLE_MAPS_API_KEY;
if (!API_KEY) {
  console.error("GOOGLE_MAPS_API_KEY is not set. Run with: node --env-file=.env scripts/fetch-photos.mjs");
  process.exit(1);
}

const MAX_PHOTOS = 4;
const CONCURRENCY = 5;
const MAX_RETRIES = 4;
// Ceiling well under the 5,000 free Place Details Pro requests, so a loop bug
// can't wander into paid territory.
const MAX_CALLS = 2_000;

const args = process.argv.slice(2);
const limitIdx = args.indexOf("--limit");
const LIMIT = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
const FORCE = args.includes("--force");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache() {
  const m = new Map();
  if (!existsSync(CACHE)) return m;
  for (const line of readFileSync(CACHE, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      m.set(e.placeId, e.photos);
    } catch {
      /* torn final line */
    }
  }
  return m;
}

async function fetchPhotos(placeId) {
  const url = `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: {
          "X-Goog-Api-Key": API_KEY,
          "X-Goog-FieldMask": "id,photos",
        },
      });
    } catch {
      if (attempt === MAX_RETRIES) throw new Error("network");
      await sleep(2 ** attempt * 500);
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      const names = (data.photos ?? []).slice(0, MAX_PHOTOS).map((p) => p.name).filter(Boolean);
      return names.length ? names : null;
    }
    if (res.status !== 429 && res.status < 500) {
      throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
    }
    if (attempt === MAX_RETRIES) throw new Error(`HTTP ${res.status} after retries`);
    await sleep(2 ** attempt * 1000);
  }
}

async function main() {
  const data = JSON.parse(readFileSync(ENRICHED, "utf8"));
  const places = data.places.filter((p) => p.placeId);
  const cache = loadCache();

  const todo = places.filter((p) => FORCE || !cache.has(p.placeId)).slice(0, LIMIT);
  console.log(
    `${places.length} places · ${cache.size} cached · ${todo.length} to fetch` +
      ` (Place Details Pro, 5,000 free/month)`,
  );

  let calls = 0;
  let cursor = 0;
  let withPhotos = 0;
  let capHit = false;

  async function worker() {
    while (cursor < todo.length) {
      const p = todo[cursor++];
      if (calls >= MAX_CALLS) {
        if (!capHit) {
          capHit = true;
          console.error(`\n⚠ hit --max-calls ceiling of ${MAX_CALLS}; stopping`);
        }
        return;
      }
      try {
        const names = await fetchPhotos(p.placeId);
        calls++;
        cache.set(p.placeId, names);
        appendFileSync(CACHE, JSON.stringify({ placeId: p.placeId, photos: names }) + "\n");
        if (names) withPhotos++;
        if (calls % 100 === 0) console.log(`  …${calls} fetched`);
      } catch (err) {
        console.error(`  ✗ ${p.name}: ${err.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  // Merge every known photo set (cache covers this run and prior runs) back in.
  let applied = 0;
  for (const p of data.places) {
    if (p.placeId && cache.has(p.placeId)) {
      p.photos = cache.get(p.placeId);
      if (p.photos) applied++;
    }
  }
  writeFileSync(ENRICHED, JSON.stringify(data, null, 2));

  console.log(
    `\ndone: ${calls} API calls this run, ${applied}/${data.places.length} places now have photos ` +
      `(${withPhotos} new this run)`,
  );
  console.log("next:  node scripts/label.mjs && node scripts/derive.mjs && node scripts/build-web-data.mjs");
}

main();
