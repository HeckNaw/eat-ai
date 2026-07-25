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

/**
 * Corporate-chain penalty.
 *
 * A stated preference, in Nathan's words: "fast food I don't like means
 * corporate. I don't like corporate." The dislike is of franchise brands, not
 * of quick service — Banh Mi Boys is fast food and stays; McDonald's is a
 * corporation and sinks. Detection is by brand name in chains.mjs, never by
 * Google's fast-food type, which would bury his mom-and-pop favourites.
 *
 * Large on purpose — 0.5 against a base score that maxes near 1.0. It buries a
 * chain beneath any genuine option without a hard filter, so a chain still
 * appears rather than leaving an empty screen when nothing else is open.
 */
const CORPORATE_PENALTY = 0.5;

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
  const radiusM = answers.radiusM;
  const cuisines = answers.cuisines;

  for (const place of places) {
    // --- hard filters: objective, non-negotiable, never traded off ---
    // A craving is a hard filter: asking for coffee and being handed a burger to
    // pad the list is worse than a short list. The corporate penalty below is
    // the one built-in "last resort" — soft, not a filter — so a chain surfaces
    // only when nothing better of the same kind is in range.
    const dist = distanceM(origin, { lat: place.y, lng: place.x });
    if (dist > radiusM) continue;

    const { state, closesInMin } = openAt(place, at);
    if (state === "shut") continue;

    // An unlabelled place is never eliminated by mode — absence of a cuisine is
    // not evidence it's the wrong kind of food.
    const modes = (place.cs ?? (place.c ? [place.c] : [])).map(modeOf);
    if (modes.length && !modes.some((m) => m === answers.mode || m === "both")) continue;
    if (cuisines.length) {
      const matched = place.cs ?? (place.c ? [place.c] : []);
      if (!matched.some((c) => cuisines.includes(c))) continue;
    }

    // --- scoring: derived signals, combined by the weights above ---
    const score =
      W.cuisine * cuisineScore(place, taste, cuisines) +
      W.distance * proximity(dist, radiusM) +
      W.attributes * attributeScore(place, taste) +
      W.neighbourhood * neighbourhoodScore(place, taste) +
      // A place with unknown hours is a gamble, so nudge it below a sure thing
      // rather than removing it.
      (state === "unknown" ? -0.06 : 0) +
      (state === "soon" ? -0.03 : 0) +
      // Chains sink beneath any real option but stay reachable as a last resort.
      (place.co ? -CORPORATE_PENALTY : 0);

    out.push({
      place,
      distanceM: dist,
      open: state,
      closesInMin,
      score,
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
