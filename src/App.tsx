import { useEffect, useMemo, useState } from "react";
import { Backdrop } from "./components/Backdrop";
import { LocationGate } from "./components/LocationGate";
import { QuestionScreen } from "./components/QuestionScreen";
import { Results } from "./components/Results";
import { Unlock } from "./components/Unlock";
import { checkAccess, post, Unauthorized } from "./lib/api";
import { describeWhen, targetTime } from "./lib/hours";
import { diversify, rank } from "./lib/score";
import type { Answers, Coords, Place, Scored, Taste } from "./lib/types";

type Stage = "loading" | "locked" | "gate" | "ask" | "results";

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
  const [settling, setSettling] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);

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
        setStage(access.ok ? "gate" : "locked");
      })
      .catch(() => setLoadError("Couldn't load your places. Reload?"));
  }, []);

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

  const onListRanked: Scored[] = useMemo(() => {
    if (!places || !taste || !origin) return [];
    return rank(places, origin, answers, taste, at, modeOf);
  }, [places, taste, origin, answers, at, modeOf]);

  const offListRanked: Scored[] = useMemo(() => {
    if (!taste || !origin || !offList.length) return [];
    return rank(offList, origin, answers, taste, at, modeOf);
  }, [offList, taste, origin, answers, at, modeOf]);

  async function go() {
    if (!origin || !taste) return;
    setStage("results");
    setOffList([]);
    setDiscoverError(null);
    setSettling(true);
    setDiscovering(true);

    // The saved-list half is computed synchronously, so it would pop in with no
    // perceptible transition. A short floor gives the skeletons time to register
    // as a deliberate beat rather than a flash of broken layout.
    const floor = new Promise((r) => setTimeout(r, 550));

    try {
      const data = await post<{ places?: Place[] }>("/api/discover", {
        lat: origin.lat,
        lng: origin.lng,
        radius: Math.min(answers.radiusM, 50_000),
        includedPrimaryTypes: searchTypes(taste, answers),
        exclude: (places ?? []).map((p) => p.i),
      });
      await floor;
      setSettling(false);
      setOffList(data.places ?? []);
    } catch (e) {
      await floor;
      setSettling(false);
      if (e instanceof Unauthorized) {
        setStage("locked");
        return;
      }
      console.error("discover failed:", e);
      setDiscoverError(
        "Couldn't search for new places right now — your own list above is unaffected.",
      );
    } finally {
      setSettling(false);
      setDiscovering(false);
    }
  }

  const summary = origin
    ? `${answers.mode} · ${describeWhen(answers.when)} · within ${
        answers.radiusM >= 60_000 ? "any distance" : `${(answers.radiusM / 1000).toFixed(answers.radiusM < 1000 ? 1 : 0)}km`
      }${answers.cuisines.length ? ` · ${answers.cuisines.length} craving${answers.cuisines.length > 1 ? "s" : ""}` : ""}`
    : "";

  return (
    <>
      <Backdrop />
      <div className="shell">
      <header className="masthead">
        <span className="wordmark">
          chudly<b>.ai</b>
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

      {stage === "locked" && <Unlock onUnlocked={() => setStage("gate")} />}

      {stage === "gate" && taste && (
        <LocationGate
          areas={taste.areas ?? []}
          onLocated={(c, label) => {
            setOrigin(c);
            setOriginLabel(label);
            setStage("ask");
          }}
        />
      )}

      {stage === "ask" && taste && (
        <QuestionScreen
          taste={taste}
          answers={answers}
          setAnswers={setAnswers}
          onGo={go}
          locationLabel={originLabel}
          onChangeLocation={() => setStage("gate")}
        />
      )}

      {stage === "results" && (
        <Results
          summary={summary}
          onList={diversify(onListRanked, 40)}
          offList={diversify(offListRanked, 40)}
          settling={settling}
          discovering={discovering}
          discoverError={discoverError}
          onBack={() => setStage("ask")}
        />
      )}
      </div>
    </>
  );
}
