import { useState } from "react";
import { LocationGate } from "./LocationGate";
import { describeWhen, targetTime, toLocalInput } from "../lib/hours";
import type { Answers, Coords, Family, Taste } from "../lib/types";

const RADII = [
  { label: "Walking", sub: "1km", m: 1_000 },
  { label: "5km", sub: null, m: 5_000 },
  { label: "10km", sub: null, m: 10_000 },
  { label: "Anywhere", sub: null, m: 60_000 },
];

/** An emoji per cuisine family (or specific label), shown on its craving chip. */
const CHIP_EMOJI: Record<string, string> = {
  "North American": "🍔",
  Chinese: "🥡",
  Japanese: "🍣",
  Korean: "🍲",
  "Southeast Asian": "🍜",
  "South Asian": "🍛",
  "Middle Eastern": "🥙",
  European: "🍝",
  Caribbean: "🌴",
  "Latin American": "🌮",
  African: "🍢",
  "Bakery & Sweets": "🧁",
  Cafe: "🧋",
  Coffee: "☕",
  Pacific: "🐟",
  Asian: "🥢",
  Dietary: "🥗",
  Retail: "🛒",
};
const emojiFor = (family: string, label: string) =>
  CHIP_EMOJI[label] ?? CHIP_EMOJI[family] ?? "🍽️";

const FAMILY_LABEL: Record<string, string> = { Cafe: "Bubble Tea / Cafe" };

/** Quick day/time jumps for the "when" step. */
function shortcuts(): { label: string; at: string }[] {
  const out: { label: string; at: string }[] = [];
  const mk = (dayOffset: number, hour: number, min: number) => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(hour, min, 0, 0);
    return toLocalInput(d);
  };
  out.push({ label: "Tonight 7pm", at: mk(0, 19, 0) });
  out.push({ label: "Tomorrow 12pm", at: mk(1, 12, 0) });
  out.push({ label: "Tomorrow 7pm", at: mk(1, 19, 0) });
  const today = new Date().getDay();
  for (const [name, dow] of [["Fri", 5], ["Sat", 6]] as const) {
    const delta = (dow - today + 7) % 7 || 7;
    out.push({ label: `${name} 7pm`, at: mk(delta, 19, 0) });
  }
  return out;
}

type Step = "mode" | "location" | "when" | "far" | "craving";

/**
 * One question at a time, forward only.
 *
 * Opens on location (only when it isn't already known — so "New search" skips
 * straight to the questions), then Sweet/Savoury, when, how far, craving.
 * Everything after location is defaulted, so each step is one tap to move on.
 * There is no going back; a known location can still be changed via the overlay.
 */
export function Flow({
  taste,
  families,
  answers,
  setAnswers,
  origin,
  originLabel,
  onLocated,
  onGo,
}: {
  taste: Taste;
  families: Family[];
  answers: Answers;
  setAnswers: (a: Answers) => void;
  origin: Coords | null;
  originLabel: string;
  onLocated: (c: Coords, label: string) => void;
  onGo: () => void;
}) {
  // Location always leads the sequence, so "change location" can jump back to it.
  // On a "New search" the location is already known, so start one step in (mode)
  // rather than re-asking it.
  const [steps] = useState<Step[]>(() => ["location", "mode", "when", "far", "craving"]);
  const [i, setI] = useState(() => (origin ? 1 : 0));
  // Where to return after re-picking a location from a later step.
  const [returnTo, setReturnTo] = useState<number | null>(null);
  const [openFamily, setOpenFamily] = useState<string | null>(null);

  const step = steps[i];
  const next = () => (i < steps.length - 1 ? setI(i + 1) : onGo());

  const pickerValue = toLocalInput(targetTime(answers.when));
  const familyList: Family[] =
    families.length ? families : (taste.hierarchy[answers.mode] ?? taste.hierarchy.savoury);
  const allVisible = familyList.flatMap((f) => f.styles.map((s) => s.cuisine));

  const toggleCuisine = (c: string) =>
    setAnswers({
      ...answers,
      cuisines: answers.cuisines.includes(c)
        ? answers.cuisines.filter((x) => x !== c)
        : [...answers.cuisines, c],
    });
  const toggleFamily = (f: Family) => {
    const all = f.styles.map((s) => s.cuisine);
    const allOn = all.every((c) => answers.cuisines.includes(c));
    setAnswers({
      ...answers,
      cuisines: allOn
        ? answers.cuisines.filter((c) => !all.includes(c))
        : [...new Set([...answers.cuisines, ...all])],
    });
  };

  // Picking a location advances to the next step, or — if we came here via
  // "change location" from a later step — returns to that step.
  const locationStep = (
    <LocationGate
      areas={taste.areas ?? []}
      onLocated={(c, label) => {
        onLocated(c, label);
        if (returnTo != null) {
          setI(returnTo);
          setReturnTo(null);
        } else {
          next();
        }
      }}
    />
  );

  return (
    <div className="flow">
      <div className="flow-top">
        <div className="flow-bar" role="progressbar" aria-valuenow={i + 1} aria-valuemax={steps.length}>
          {steps.map((s, n) => (
            <span key={s} className="flow-seg" data-done={n < i || undefined} data-on={n === i || undefined} />
          ))}
        </div>
      </div>

      <div key={i} className="flow-step">

        {step === "mode" && (
          <div className="q">
            <div className="q-head">
              <span className="q-title">Sweet or savoury?</span>
            </div>
            <div className="seg seg-lg">
              {(["savoury", "sweet"] as const).map((m) => (
                <button
                  key={m}
                  data-on={answers.mode === m}
                  onClick={() => setAnswers({ ...answers, mode: m, cuisines: [] })}
                >
                  {m === "savoury" ? "Savoury" : "Sweet"}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "location" && locationStep}

        {step === "when" && (
          <div className="q">
            <div className="q-head">
              <span className="q-title">When are you eating?</span>
            </div>
            <div className="chips">
              <button
                className="chip"
                data-on={answers.when === "now"}
                onClick={() => setAnswers({ ...answers, when: "now" })}
              >
                Now
              </button>
              <button
                className="chip"
                data-on={answers.when === "hour"}
                onClick={() => setAnswers({ ...answers, when: "hour" })}
              >
                In an hour
              </button>
              {shortcuts().map((s2) => (
                <button
                  key={s2.at}
                  className="chip"
                  data-on={typeof answers.when === "object" && answers.when.at === s2.at}
                  onClick={() => setAnswers({ ...answers, when: { at: s2.at } })}
                >
                  {s2.label}
                </button>
              ))}
            </div>
            <div style={{ marginTop: "0.625rem" }}>
              <input
                className="field"
                type="datetime-local"
                min={toLocalInput(new Date())}
                value={pickerValue}
                onChange={(e) => setAnswers({ ...answers, when: { at: e.target.value } })}
              />
              <div className="hint mono">&rarr; {describeWhen(answers.when)}</div>
            </div>
          </div>
        )}

        {step === "far" && (
          <div className="q">
            <div className="q-head">
              <span className="q-title">How far will you go?</span>
            </div>
            <div className="chips">
              {RADII.map((r) => (
                <button
                  key={r.m}
                  className="chip"
                  data-on={answers.radiusM === r.m}
                  onClick={() => setAnswers({ ...answers, radiusM: r.m })}
                >
                  {r.label}
                  {r.sub && <span className="chip-n">{r.sub}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === "craving" && (
          <div className="q">
            <div className="q-head">
              <span className="q-title">Craving anything?</span>
              {answers.cuisines.length > 0 ? (
                <button className="btn-quiet" onClick={() => setAnswers({ ...answers, cuisines: [] })}>
                  Clear {answers.cuisines.length}
                </button>
              ) : (
                <button className="btn-quiet" onClick={() => setAnswers({ ...answers, cuisines: allVisible })}>
                  Select all
                  <span className="mono" style={{ opacity: 0.5, marginLeft: "0.375rem", fontSize: "0.75rem" }}>
                    {allVisible.length}
                  </span>
                </button>
              )}
            </div>
            <div className="chips">
              {familyList.map((f) => {
                const on = f.styles.some((s) => answers.cuisines.includes(s.cuisine));
                const isOpen = openFamily === f.family;
                const label =
                  f.styles.length === 1
                    ? (f.styles[0]?.cuisine ?? f.family)
                    : (FAMILY_LABEL[f.family] ?? f.family);
                return (
                  <div key={f.family} style={{ width: "100%" }}>
                    <div style={{ display: "flex", gap: "0.375rem" }}>
                      <button className="chip" data-on={on} onClick={() => toggleFamily(f)}>
                        <span className="chip-emoji" aria-hidden="true">{emojiFor(f.family, label)}</span>
                        {label}
                        {f.count > 0 && <span className="chip-n">{f.count}</span>}
                      </button>
                      {f.styles.length > 1 && (
                        <button
                          className="chip"
                          data-open={isOpen}
                          aria-label={`Styles within ${label}`}
                          onClick={() => setOpenFamily(isOpen ? null : f.family)}
                        >
                          <span className="chip-more">+</span>
                        </button>
                      )}
                    </div>
                    {f.styles.length > 1 && (
                      <div className="styles" data-open={isOpen}>
                        <div className="styles-inner">
                          <div className="styles-pad">
                            {f.styles.map((s) => (
                              <button
                                key={s.cuisine}
                                className="chip-sm"
                                data-on={answers.cuisines.includes(s.cuisine)}
                                onClick={() => toggleCuisine(s.cuisine)}
                              >
                                {s.cuisine}
                                {s.count > 0 && <span className="chip-n">{s.count}</span>}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* The location step carries its own actions; every other step gets the
          Continue / Feed me dock, plus a way to change a known location. */}
      {step !== "location" && (
        <div className="dock">
          <button className="btn" onClick={next}>
            {i === steps.length - 1 ? "Feed me" : "Continue"}
          </button>
          {origin && (
            <button
              className="btn-quiet"
              style={{ width: "100%", marginTop: "0.5rem" }}
              // Jump back to the location step, remembering where to return to.
              onClick={() => {
                setReturnTo(i);
                setI(steps.indexOf("location"));
              }}
            >
              <span className="mono" style={{ fontSize: "0.75rem" }}>
                near {originLabel} — change
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
