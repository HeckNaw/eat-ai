import { distanceM } from "./geo";
import type { Coords, Family, Place } from "./types";

/**
 * Re-count and re-order the craving families by what is near the chosen spot,
 * rather than by the global saved-list totals.
 *
 * Why this works from local data alone, with no API call: Nathan saves
 * representatively — in Brampton he saved the South Asian places, in North York
 * the Korean ones — so the distribution of his own saves near a point tracks the
 * character of that area. Downtown stays Chinese/Bakery; North York surfaces
 * Korean; Brampton surfaces South Asian. A true non-list census is not possible
 * anyway: Nearby Search caps at 20 results and returns no totals.
 *
 * The scan radius adapts. Downtown is saturated, so 5km is a tight, accurate
 * neighbourhood; the suburbs are sparse, so it widens to gather enough signal
 * before giving up. Below the floor — a place with almost no saved history, like
 * a new city — it returns the global order untouched rather than a noisy one.
 */

const SCAN_STEPS_M = [5_000, 10_000, 15_000];
const ENOUGH = 20; // places within radius to trust a local re-rank
const FLOOR = 8; // below this even at the widest step, fall back to global

export interface Localized {
  families: Family[];
  scanRadiusM: number | null; // null when it fell back to global
}

/** Places within a radius, and the cuisine tally among them. */
function tally(places: Place[], origin: Coords, radiusM: number) {
  const counts = new Map<string, number>();
  let n = 0;
  for (const p of places) {
    if (distanceM(origin, { lat: p.y, lng: p.x }) > radiusM) continue;
    n++;
    for (const c of p.cs ?? (p.c ? [p.c] : [])) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return { counts, n };
}

export function localizeFamilies(
  families: Family[],
  places: Place[],
  origin: Coords | null,
): Localized {
  if (!origin || !families.length) return { families, scanRadiusM: null };

  // Smallest step with enough places; otherwise the widest, if it clears the
  // floor; otherwise give up and keep the global order.
  let chosen: { counts: Map<string, number>; n: number; radiusM: number } | null = null;
  for (const radiusM of SCAN_STEPS_M) {
    const t = tally(places, origin, radiusM);
    if (t.n >= ENOUGH) {
      chosen = { ...t, radiusM };
      break;
    }
    chosen = { ...t, radiusM }; // remember the widest tried
  }
  if (!chosen || chosen.n < FLOOR) return { families, scanRadiusM: null };

  const { counts } = chosen;
  const localCount = (cuisine: string) => counts.get(cuisine) ?? 0;

  // Rebuild each family with local counts, styles sorted by local prevalence.
  // Global count is the tiebreak, so a zero-nearby cuisine keeps a stable place
  // at the bottom rather than jumping around — nothing becomes uncravable.
  const rebuilt = families.map((f) => {
    const styles = f.styles
      .map((s) => ({ ...s, count: localCount(s.cuisine), globalCount: s.count }))
      .sort((a, b) => b.count - a.count || b.globalCount - a.globalCount)
      .map(({ globalCount: _g, ...s }) => s);
    const count = styles.reduce((sum, s) => sum + s.count, 0);
    return { ...f, styles, count, globalCount: f.count };
  });

  rebuilt.sort((a, b) => b.count - a.count || b.globalCount - a.globalCount);

  return {
    families: rebuilt.map(({ globalCount: _g, ...f }) => f),
    scanRadiusM: chosen.radiusM,
  };
}
