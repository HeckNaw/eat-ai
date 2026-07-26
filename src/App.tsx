import { useEffect, useMemo, useState } from "react";
import { Backdrop } from "./components/Backdrop";
import { Flow } from "./components/Flow";
import { SwipeDeck } from "./components/SwipeDeck";
import { Unlock } from "./components/Unlock";
import { checkAccess, post, Unauthorized } from "./lib/api";
import { targetTime } from "./lib/hours";
import { localizeFamilies } from "./lib/local";
import { loadPhotos } from "./lib/photostore";
import { rank } from "./lib/score";
import type { Answers, Coords, Place, Scored, Taste } from "./lib/types";

type Stage = "loading" | "locked" | "flow" | "results";

/** Nearby Search accepts at most 50 includedPrimaryTypes. */
const MAX_TYPES = 50;

/**
 * Google place types to search for, best-liked first.
 *
 * Two things this has to get right, both learned the hard way:
 *
 * 1. Selecting *every* cuisine says exactly what selecting none says — "no
 *    constraint" — so it uses the curated default set rather than the union.
 *    The union runs to 87 types in savoury, and truncating that to 50 by list
 *    order threw away Coffee, Korean, Middle Eastern, Vietnamese, Mexican and
 *    Thai: Select All was searching a worse set than leaving the picker blank.
 * 2. When a large-but-partial selection still overflows 50, the types that
 *    survive are the ones attached to the most-saved cuisines. Truncation is
 *    unavoidable; dropping the least-liked rather than the last-listed is not.
 */
function searchTypes(taste: Taste, answers: Answers): string[] {
  const familiesInMode = taste.hierarchy[answers.mode] ?? [];
  const cuisinesInMode = familiesInMode.flatMap((f) => f.styles.map((s) => s.cuisine));
  const wanted = answers.cuisines;

  const coversEverything =
    cuisinesInMode.length > 0 && cuisinesInMode.every((c) => wanted.includes(c));
  if (!wanted.length || coversEverything) return taste.defaultSearchTypes[answers.mode];

  const styles = Object.values(taste.hierarchy)
    .flat()
    .flatMap((f) => f.styles)
    .filter((s) => wanted.includes(s.cuisine))
    .sort((a, b) => (taste.cuisineAffinity[b.cuisine] ?? 0) - (taste.cuisineAffinity[a.cuisine] ?? 0));

  return [...new Set(styles.flatMap((s) => s.googleTypes))].slice(0, MAX_TYPES);
}

const DEFAULTS: Answers = {
  mode: "savoury",
  when: "now",
  radiusM: 5_000,
  cuisines: [],
};

export default function App() {
  const [stage, setStage] = useState<Stage>("loading");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [taste, setTaste] = useState<Taste | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [origin, setOrigin] = useState<Coords | null>(null);
  const [originLabel, setOriginLabel] = useState("you");
  const [answers, setAnswers] = useState<Answers>(DEFAULTS);

  const [offList, setOffList] = useState<Place[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [photoMap, setPhotoMap] = useState<Record<string, string[]> | null>(null);

  // Both payloads are static and cached after first load: 123KB + 4KB gzipped.
  // The access probe runs alongside them rather than before, so the passcode
  // check costs no extra wall-clock time on boot.
  useEffect(() => {
    Promise.all([
      fetch("/places.json").then((r) => r.json()),
      fetch("/taste.json").then((r) => r.json()),
      checkAccess(),
    ])
      .then(([p, t, access]) => {
        setPlaces(p);
        setTaste(t);
        setStage(access.ok ? "flow" : "locked");
      })
      .catch(() => setLoadError("Couldn't load your places. Reload?"));
  }, []);

  // Start pulling the photo names once the user reaches the questions, so they
  // are usually ready by the time the swipe deck appears — overlapped with the
  // discovery call rather than blocking it.
  useEffect(() => {
    if (stage === "flow" && !photoMap) loadPhotos().then(setPhotoMap);
  }, [stage, photoMap]);

  // Every screen change starts at the top. Picking a location from far down the
  // gate's area list would otherwise drop you into the middle of the questions
  // screen; the same applies going into results and back. Instant, not smooth —
  // this is a page swap, not a scroll within one.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [stage]);

  /** Cuisine -> mode, read off the hierarchy so the client needs no lexicon copy. */
  const modeOf = useMemo(() => {
    const map = new Map<string, string>();
    if (taste) {
      for (const [mode, fams] of Object.entries(taste.hierarchy)) {
        for (const f of fams) for (const s of f.styles) {
          // A cuisine present in both trees is "both" — matchable either way.
          map.set(s.cuisine, map.has(s.cuisine) && map.get(s.cuisine) !== mode ? "both" : mode);
        }
      }
    }
    return (c: string) => map.get(c) ?? "savoury";
  }, [taste]);

  const at = useMemo(() => targetTime(answers.when), [answers.when, stage]);

  // Craving chips re-counted and re-ordered by what's near the chosen spot, so
  // downtown shows Chinese first and North York shows Korean — rather than the
  // global list pinning North American at the top everywhere. Free: it counts
  // the saved places already in the browser, no API call. See lib/local.ts.
  const localFamilies = useMemo(() => {
    if (!taste) return [];
    const base = taste.hierarchy[answers.mode] ?? taste.hierarchy.savoury;
    return localizeFamilies(base, places ?? [], origin).families;
  }, [taste, places, origin, answers.mode]);

  // No filter-loosening. A craving is a hard filter — asking for coffee and
  // being shown a burger to pad the list is worse than a short list. The one
  // built-in "last resort" is the corporate penalty, which is soft rather than a
  // filter: a chain like Tim Hortons ranks below every real option of the same
  // kind, so it only surfaces in the top five when nothing better of that kind
  // is nearby. Nothing here reaches for a different cuisine or a wider radius —
  // if too little matches, the honest short (or empty) list is the answer.
  const onListRanked: Scored[] = useMemo(() => {
    if (!places || !taste || !origin) return [];
    return rank(places, origin, answers, taste, at, modeOf);
  }, [places, taste, origin, answers, at, modeOf]);

  const offListRanked: Scored[] = useMemo(() => {
    if (!taste || !origin || !offList.length) return [];
    return rank(offList, origin, answers, taste, at, modeOf);
  }, [offList, taste, origin, answers, at, modeOf]);

  // Everything that matched, saved-list first then new-to-you, in one deck to
  // swipe through. On-list is ready synchronously; off-list appends when the
  // discovery call returns, so the deck grows under the swiper.
  const deck: Scored[] = useMemo(
    () => [...onListRanked, ...offListRanked],
    [onListRanked, offListRanked],
  );

  async function go() {
    if (!origin || !taste) return;
    setStage("results");
    setOffList([]);
    setDiscovering(true);

    try {
      const data = await post<{ places?: Place[] }>("/api/discover", {
        lat: origin.lat,
        lng: origin.lng,
        radius: Math.min(answers.radiusM, 50_000),
        includedPrimaryTypes: searchTypes(taste, answers),
        // Saved places, plus the explicitly-ruled-out ones (chains like Burrito
        // Boyz), so neither returns as an off-list discovery.
        exclude: [...(places ?? []).map((p) => p.i), ...(taste.ruledOutIds ?? [])],
      });
      setOffList(data.places ?? []);
    } catch (e) {
      if (e instanceof Unauthorized) {
        setStage("locked");
        return;
      }
      console.error("discover failed:", e);
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <>
      <Backdrop />
      <div className="shell">
      <header className="masthead">
        <span className="wordmark">
          eat<b>.ai</b>
        </span>
        {places && (
          <span className="eyebrow" style={{ marginLeft: "auto" }}>
            {places.length.toLocaleString()} places
          </span>
        )}
      </header>

      {loadError && <div className="err">{loadError}</div>}

      {stage === "loading" && !loadError && (
        <div className="empty">
          <span className="thinking" style={{ color: "var(--accent)" }}>
            <i />
            <i />
            <i />
          </span>
        </div>
      )}

      {stage === "locked" && <Unlock onUnlocked={() => setStage("flow")} />}

      {stage === "flow" && taste && (
        <Flow
          taste={taste}
          families={localFamilies}
          answers={answers}
          setAnswers={setAnswers}
          origin={origin}
          originLabel={originLabel}
          onLocated={(c, label) => {
            setOrigin(c);
            setOriginLabel(label);
          }}
          onGo={go}
        />
      )}

      {stage === "results" && (
        <SwipeDeck
          deck={deck}
          discovering={discovering}
          photoMap={photoMap}
          onRestart={() => setStage("flow")}
        />
      )}
      </div>
    </>
  );
}
