/**
 * The "would not eat here" set, keyed by CID.
 *
 * Loaded by both derive.mjs and build-web-data.mjs so a place Nathan has ruled
 * out is excluded from two different things:
 *
 *   - the browser payload, so it is never recommended again
 *   - the taste statistics, so it stops counting as evidence of what he likes
 *
 * The second matters more than it looks. A place saved to Might try and later
 * marked "too pedestrian" was never a preference — leaving it in the affinity
 * counts means the model keeps learning from a judgement he has reversed.
 *
 * The negative lists are the more recent statement, so they win outright over
 * the saved lists. Returns an empty set before the negatives are imported, so
 * the pipeline still runs on a clean checkout.
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const PATH = join(ROOT, "negatives.json");

function load() {
  if (!existsSync(PATH)) return { cids: new Set(), byCid: new Map() };
  const { places = [] } = JSON.parse(readFileSync(PATH, "utf8"));
  const byCid = new Map();
  for (const p of places) if (p.cid) byCid.set(p.cid, p);
  return { cids: new Set(byCid.keys()), byCid };
}

export const negatives = load();

/** True when this place has been explicitly ruled out. */
export function isRuledOut(place) {
  return Boolean(place?.cid && negatives.cids.has(place.cid));
}
