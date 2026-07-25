import { useState } from "react";
import { parseDistance } from "../lib/parse";
import type { Answers, Family, Taste } from "../lib/types";

const RADII = [
  { label: "Walking", sub: "1km", m: 1_000 },
  { label: "5km", sub: null, m: 5_000 },
  { label: "10km", sub: null, m: 10_000 },
  { label: "Anywhere", sub: null, m: 60_000 },
];

/**
 * Every question is defaulted, so the whole screen collapses to one tap when
 * nothing about tonight is unusual. The questions are for narrowing, not a toll
 * gate — a hungry person should not be filling in a form.
 */
export function QuestionScreen({
  taste,
  answers,
  setAnswers,
  onGo,
  locationLabel,
  onChangeLocation,
}: {
  taste: Taste;
  answers: Answers;
  setAnswers: (a: Answers) => void;
  onGo: () => void;
  locationLabel: string;
  onChangeLocation: () => void;
}) {
  const [openFamily, setOpenFamily] = useState<string | null>(null);
  const [freeDistance, setFreeDistance] = useState("");
  const [showTime, setShowTime] = useState(typeof answers.when === "object");

  const parsed = freeDistance ? parseDistance(freeDistance) : null;

  const mode = answers.mode === "sweet" ? "sweet" : "savoury";
  const families: Family[] =
    answers.mode === "either"
      ? [...taste.hierarchy.savoury, ...taste.hierarchy.sweet]
      : taste.hierarchy[mode];

  const toggleCuisine = (c: string) => {
    const has = answers.cuisines.includes(c);
    setAnswers({
      ...answers,
      cuisines: has ? answers.cuisines.filter((x) => x !== c) : [...answers.cuisines, c],
    });
  };

  /** Selecting a family means every style inside it. */
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

  const q = (i: number) => ({ "--i": i }) as React.CSSProperties;

  return (
    <>
      <div className="q" style={q(0)}>
        <div className="q-head">
          <span className="q-title">Sweet or savoury?</span>
        </div>
        <div className="seg">
          {(["savoury", "sweet", "either"] as const).map((m) => (
            <button
              key={m}
              data-on={answers.mode === m}
              onClick={() => setAnswers({ ...answers, mode: m, cuisines: [] })}
            >
              {m === "savoury" ? "Savoury" : m === "sweet" ? "Sweet" : "Either"}
            </button>
          ))}
        </div>
      </div>

      <div className="q" style={q(1)}>
        <div className="q-head">
          <span className="q-title">Eating when?</span>
        </div>
        <div className="chips">
          <button
            className="chip"
            data-on={answers.when === "now"}
            onClick={() => {
              setShowTime(false);
              setAnswers({ ...answers, when: "now" });
            }}
          >
            Now
          </button>
          <button
            className="chip"
            data-on={answers.when === "hour"}
            onClick={() => {
              setShowTime(false);
              setAnswers({ ...answers, when: "hour" });
            }}
          >
            In an hour
          </button>
          <button
            className="chip"
            data-on={typeof answers.when === "object"}
            onClick={() => {
              setShowTime(true);
              setAnswers({ ...answers, when: { at: "19:30" } });
            }}
          >
            Pick a time
          </button>
        </div>
        {showTime && typeof answers.when === "object" && (
          <input
            className="field"
            style={{ marginTop: "0.5rem" }}
            type="time"
            value={answers.when.at}
            onChange={(e) => setAnswers({ ...answers, when: { at: e.target.value } })}
          />
        )}
      </div>

      <div className="q" style={q(2)}>
        <div className="q-head">
          <span className="q-title">How far will you go?</span>
        </div>
        <div className="chips">
          {RADII.map((r) => (
            <button
              key={r.m}
              className="chip"
              data-on={answers.radiusM === r.m && !parsed}
              onClick={() => {
                setFreeDistance("");
                setAnswers({ ...answers, radiusM: r.m });
              }}
            >
              {r.label}
              {r.sub && <span className="chip-n">{r.sub}</span>}
            </button>
          ))}
        </div>
        <input
          className="field"
          style={{ marginTop: "0.5rem" }}
          placeholder="or type it — “20 min”, “2 miles”, “800m”"
          value={freeDistance}
          onChange={(e) => {
            setFreeDistance(e.target.value);
            const p = parseDistance(e.target.value);
            if (p) setAnswers({ ...answers, radiusM: p.radiusM });
          }}
        />
        {freeDistance && (
          <div className="hint mono">
            {parsed ? `→ ${parsed.label}` : "→ didn't catch that — try “20 min” or “3km”"}
          </div>
        )}
      </div>

      <div className="q" style={q(3)}>
        <div className="q-head">
          <span className="q-title">Craving anything?</span>
          {answers.cuisines.length > 0 && (
            <button className="btn-quiet" onClick={() => setAnswers({ ...answers, cuisines: [] })}>
              Clear {answers.cuisines.length}
            </button>
          )}
        </div>
        <div className="chips">
          {families.map((f) => {
            const on = f.styles.some((s) => answers.cuisines.includes(s.cuisine));
            const isOpen = openFamily === f.family;
            return (
              <div key={f.family} style={{ width: "100%" }}>
                <div style={{ display: "flex", gap: "0.375rem" }}>
                  <button className="chip" data-on={on} onClick={() => toggleFamily(f)}>
                    {f.family}
                    <span className="chip-n">{f.count}</span>
                  </button>
                  {f.styles.length > 1 && (
                    <button
                      className="chip"
                      data-open={isOpen}
                      aria-label={`Styles within ${f.family}`}
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
                            <span className="chip-n">{s.count}</span>
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

      <div className="dock">
        <button className="btn" onClick={onGo}>
          Feed me
        </button>
        <button
          className="btn-quiet"
          style={{ width: "100%", marginTop: "0.5rem" }}
          onClick={onChangeLocation}
        >
          <span className="mono" style={{ fontSize: "0.75rem" }}>
            near {locationLabel} — change
          </span>
        </button>
      </div>
    </>
  );
}
