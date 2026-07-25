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
  /** Loosened constraints from the fallback ladder; defaults to what was asked. */
  opts?: { radiusM?: number; cuisines?: string[] },
): Scored[] {
  const out: Scored[] = [];
  const radiusM = opts?.radiusM ?? answers.radiusM;
  const cuisines = opts?.cuisines ?? answers.cuisines;

  for (const place of places) {
    // --- hard filters: objective, non-negotiable, never traded off ---
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
      // Proximity is measured against the radius actually in force, so that
      // once the search widens the far results still order sensibly instead of
      // all flattening to zero.
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
      why: explain(place, taste, cuisines, dist),
    });
  }

  return out.sort((a, b) => b.score - a.score);
}

/** What had to be given up to fill the results, and how to say so. */
export interface Loosened {
  radiusM: number;
  cuisines: string[];
  widened: boolean;
  broadened: boolean;
  dropped: boolean;
}

/**
 * Widen the search until there are enough results, one concession at a time.
 *
 * An empty screen is the worst possible answer to "I'm hungry" — but so is
 * silently pretending a place 4km away was within the 1km you asked for. So the
 * ladder gives ground in a fixed order, stops the moment it has enough, and
 * reports exactly what it relaxed so the UI can say it out loud.
 *
 * The order encodes which concession costs least:
 *
 *   1. distance ×1.6   — a bit further is a smaller compromise than a different
 *                        cuisine, because you asked for the cuisine on purpose
 *   2. + related cuisines — Sichuan opens up to the rest of Chinese
 *   3. distance ×2.5
 *   4. drop the craving entirely — last resort, you did explicitly ask
 *
 * Two things deliberately never relax: `mode`, because someone who wants
 * dessert is not served by a steakhouse, and `shut`, because a closed
 * restaurant is not a recommendation at any distance.
 *
 * Only the saved list truly benefits from the distance rungs — off-list
 * candidates were fetched from Places inside the original radius, so widening
 * cannot conjure more of them without another billed call. They still gain from
 * the cuisine rungs.
 */
const LADDER = [
  { radius: 1, cuisine: 0 },   // exactly what was asked
  { radius: 1.6, cuisine: 0 }, // a bit further
  { radius: 1.6, cuisine: 1 }, // ...and related cuisines
  { radius: 2.5, cuisine: 1 }, // further still
  { radius: 2.5, cuisine: 2 }, // give up on the craving
] as const;

const MAX_RADIUS_M = 60_000;

type Rung = (typeof LADDER)[number];

export function rankWithFallback(
  places: Place[],
  origin: Coords,
  answers: Answers,
  taste: Taste,
  at: Date,
  modeOf: (cuisine: string) => string,
  /** [as asked, family-broadened, []] — built by the caller, which owns the hierarchy. */
  cuisineLadder: string[][],
  target: number,
): { items: Scored[]; loosened: Loosened | null } {
  const rungFor = (step: Rung) =>
    cuisineLadder[Math.min(step.cuisine, cuisineLadder.length - 1)] ?? [];
  const radiusFor = (step: Rung) => Math.min(answers.radiusM * step.radius, MAX_RADIUS_M);

  let best: Scored[] = [];
  let bestStep: Rung = LADDER[0];
  let relaxed = false;

  for (const [i, step] of LADDER.entries()) {
    // With no craving set there is nothing to broaden, so the cuisine rungs
    // duplicate the distance rung above them.
    const prev = LADDER[i - 1];
    if (prev && !answers.cuisines.length && step.radius === prev.radius) continue;

    const items = rank(places, origin, answers, taste, at, modeOf, {
      radiusM: radiusFor(step),
      cuisines: rungFor(step),
    });

    if (items.length > best.length) {
      best = items;
      bestStep = step;
      relaxed = i > 0;
    }
    if (items.length >= target) break;
  }

  if (!relaxed) return { items: best, loosened: null };

  return {
    items: best,
    loosened: {
      radiusM: radiusFor(bestStep),
      cuisines: rungFor(bestStep),
      widened: bestStep.radius > 1,
      broadened: Boolean(answers.cuisines.length) && bestStep.cuisine === 1,
      dropped: Boolean(answers.cuisines.length) && bestStep.cuisine >= 2,
    },
  };
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
