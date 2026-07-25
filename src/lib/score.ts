import { distanceM, formatDistance } from "./geo";
import { openAt } from "./hours";
import type { Answers, Coords, OpenState, Place, Scored, Taste } from "./types";

/**
 * THE ONLY AUTHORED NUMBERS IN THE SYSTEM.
 *
 * Every individual signal is counted from the saved places — cuisine affinity,
 * attribute affinity, neighbourhood density all come out of taste.json. But
 * combining them into one ranking needs relative importance, and that cannot be
 * derived without feedback data on which recommendations were actually taken.
 *
 * So these four are a stated judgement rather than a measurement, and they live
 * here, named and in one place, instead of being scattered through the scorer.
 * Tune freely; nothing else in the pipeline depends on them.
 *
 * Deliberately absent: rating and review count. The rating distribution across
 * the saved places is far too tight to discriminate (mean 4.40, sd 0.28), and
 * weighting it would push down the low-rated favourites — which is exactly
 * backwards.
 */
const W = {
  cuisine: 0.4,       // the craving is the strongest stated signal
  distance: 0.3,      // somewhere excellent and unreachable is not a recommendation
  attributes: 0.15,   // no-frills, counter-service, institution — the character match
  neighbourhood: 0.15, // places near where you already eat tend to land better
};

/** 1 at the door, decaying to 0 at the edge of the chosen radius. */
function proximity(distM: number, radiusM: number): number {
  return Math.max(0, 1 - distM / Math.max(1, radiusM));
}

/**
 * Strongest affinity across every cuisine the place matched, not just its primary
 * label — so a Lebanese bakery scores on Lebanese as well as Bakery.
 */
function cuisineScore(place: Place, taste: Taste, wanted: string[]): number {
  const matched = place.cs ?? (place.c ? [place.c] : []);
  if (!matched.length) return 0.25; // unlabelled: neutral, never eliminated

  // An explicit craving overrides learned affinity — you asked for this.
  if (wanted.length) {
    return matched.some((c) => wanted.includes(c)) ? 1 : 0;
  }
  const byCuisine = Math.max(0, ...matched.map((c) => taste.cuisineAffinity[c] ?? 0));
  const byFamily = place.f ? (taste.familyAffinity[place.f] ?? 0) : 0;
  return Math.max(byCuisine, byFamily * 0.8);
}

function attributeScore(place: Place, taste: Taste): number {
  if (!place.at?.length) return 0.3; // absent, not disliked — most off-list places have none
  const weights = place.at.map((a) => taste.attributeAffinity[a] ?? 0);
  return weights.reduce((s, w) => s + w, 0) / weights.length;
}

/**
 * How much of your own map sits near this place. Falls out of the geographic
 * clusters, and it does real work: an identical query in your North York cluster
 * returns places you'd save, while the same query at Yonge & Queen returns
 * franchises.
 */
function neighbourhoodScore(place: Place, taste: Taste): number {
  if (!taste.clusters.length) return 0;
  let best = 0;
  for (const [lat, lng, count] of taste.clusters) {
    const d = distanceM({ lat: place.y, lng: place.x }, { lat, lng });
    if (d > 2_000) continue;
    best = Math.max(best, (1 - d / 2_000) * Math.min(1, count / 20));
  }
  return best;
}

/** One short line explaining the pick. Templated — no model call. */
function explain(place: Place, taste: Taste, wanted: string[], distM: number): string {
  const bits: string[] = [];

  if (wanted.length && place.cs?.some((c) => wanted.includes(c))) {
    bits.push(`<b>${place.cs.find((c) => wanted.includes(c))}</b> — what you asked for`);
  } else if (place.c) {
    const w = taste.cuisineAffinity[place.c] ?? 0;
    if (w >= 0.55) bits.push(`<b>${place.c}</b> is one of your most-saved`);
    else if (w > 0) bits.push(`<b>${place.c}</b>`);
  }

  const strong = (place.at ?? [])
    .filter((a) => (taste.attributeAffinity[a] ?? 0) >= 0.4)
    .slice(0, 2);
  if (strong.length) bits.push(strong.join(" · "));

  if (neighbourhoodScore(place, taste) > 0.35) bits.push("in an area you eat in a lot");
  if (distM < 700) bits.push("walkable");

  return bits.slice(0, 3).join(" &middot; ");
}

export interface Ranked {
  onList: Scored[];
  offList: Scored[];
}

/** Score and hard-filter one pool. Hard filters are facts; scoring is judgement. */
export function rank(
  places: Place[],
  origin: Coords,
  answers: Answers,
  taste: Taste,
  at: Date,
  modeOf: (cuisine: string) => string,
): Scored[] {
  const out: Scored[] = [];

  for (const place of places) {
    // --- hard filters: objective, non-negotiable, never traded off ---
    const dist = distanceM(origin, { lat: place.y, lng: place.x });
    if (dist > answers.radiusM) continue;

    const { state, closesInMin } = openAt(place, at);
    if (state === "shut") continue;

    if (answers.mode !== "either") {
      const modes = (place.cs ?? (place.c ? [place.c] : [])).map(modeOf);
      const ok =
        modes.length === 0 ||
        modes.some((m) => m === answers.mode || m === "both");
      if (!ok) continue;
    }
    if (answers.cuisines.length) {
      const matched = place.cs ?? (place.c ? [place.c] : []);
      if (!matched.some((c) => answers.cuisines.includes(c))) continue;
    }

    // --- scoring: derived signals, combined by the weights above ---
    const score =
      W.cuisine * cuisineScore(place, taste, answers.cuisines) +
      W.distance * proximity(dist, answers.radiusM) +
      W.attributes * attributeScore(place, taste) +
      W.neighbourhood * neighbourhoodScore(place, taste) +
      // A place with unknown hours is a gamble, so nudge it below a sure thing
      // rather than removing it.
      (state === "unknown" ? -0.06 : 0) +
      (state === "soon" ? -0.03 : 0);

    out.push({
      place,
      distanceM: dist,
      open: state,
      closesInMin,
      score,
      why: explain(place, taste, answers.cuisines, dist),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/**
 * Greedy diversity: take the best, then the best whose cuisine isn't already
 * represented, and so on. Stops five ramen shops being five ramen shops without
 * needing a model to notice.
 */
export function diversify(items: Scored[], limit: number): Scored[] {
  const picked: Scored[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    if (picked.length >= limit) break;
    const key = item.place.c ?? "?";
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push(item);
  }
  // Top up in score order if diversity couldn't fill the quota.
  for (const item of items) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }
  return picked;
}

export { formatDistance };
export type { OpenState };
