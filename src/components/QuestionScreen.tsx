import { useState } from "react";
import { describeWhen, targetTime, toLocalInput } from "../lib/hours";
import type { Answers, Family, Taste } from "../lib/types";

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
  Cafe: "🧋", // the sweet-mode family (Bubble Tea / Cafe)
  Coffee: "☕", // the savoury-mode single cuisine
  Pacific: "🐟",
  Asian: "🥢",
  Dietary: "🥗",
  Retail: "🛒",
};
// Look up by the shown label first (so "Coffee" keeps ☕), then the family.
const emojiFor = (family: string, label: string) =>
  CHIP_EMOJI[label] ?? CHIP_EMOJI[family] ?? "🍽️";

/** Display-name overrides for a family chip. */
const FAMILY_LABEL: Record<string, string> = {
  Cafe: "Bubble Tea / Cafe",
};

/**
 * Quick jumps for the days people actually plan around, so the calendar is there
 * for the rest rather than being the only way in.
 */
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

  // Next Friday and Saturday evening, the two most-planned slots.
  const today = new Date().getDay();
  for (const [name, dow] of [["Fri", 5], ["Sat", 6]] as const) {
    const delta = (dow - today + 7) % 7 || 7;
    out.push({ label: `${name} 7pm`, at: mk(delta, 19, 0) });
  }
  return out;
}

/**
 * Every question is defaulted, so the whole screen collapses to one tap when
 * nothing about tonight is unusual. The questions are for narrowing, not a toll
 * gate — a hungry person should not be filling in a form.
 */
export function QuestionScreen({
  taste,
  families,
  answers,
  setAnswers,
  onGo,
  locationLabel,
  onChangeLocation,
}: {
  taste: Taste;
  /** Craving families, already re-ordered by what's near the chosen spot. */
  families: Family[];
  answers: Answers;
  setAnswers: (a: Answers) => void;
  onGo: () => void;
  locationLabel: string;
  onChangeLocation: () => void;
}) {
  const [openFamily, setOpenFamily] = useState<string | null>(null);

  // The always-visible picker mirrors whatever "when" resolves to — the current
  // time for Now, an hour out for In an hour, or the exact custom value.
  const pickerValue = toLocalInput(targetTime(answers.when));

  const familyList: Family[] =
    families.length ? families : (taste.hierarchy[answers.mode] ?? taste.hierarchy.savoury);

  const toggleCuisine = (c: string) => {
    const has = answers.cuisines.includes(c);
    setAnswers({
      ...answers,
      cuisines: has ? answers.cuisines.filter((x) => x !== c) : [...answers.cuisines, c],
    });
  };

  /** Every cuisine currently on offer, i.e. within the chosen sweet/savoury mode. */
  const allVisible = familyList.flatMap((f) => f.styles.map((s) => s.cuisine));

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
          {(["savoury", "sweet"] as const).map((m) => (
            <button
              key={m}
              data-on={answers.mode === m}
              // Cravings are mode-scoped, so switching sides clears them rather
              // than leaving selections that no longer exist in the new tree.
              onClick={() => setAnswers({ ...answers, mode: m, cuisines: [] })}
            >
              {m === "savoury" ? "Savoury" : "Sweet"}
            </button>
          ))}
        </div>
      </div>

      <div className="q" style={q(1)}>
        <div className="q-head">
          <span className="q-title">Pick a day &amp; time</span>
        </div>
        <div className="chips">
          {/* Now and In an hour come first, then the common day shortcuts. Each
              just sets the picker; editing the picker directly clears them. */}
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
          {shortcuts().map((s2) => {
            const on = typeof answers.when === "object" && answers.when.at === s2.at;
            return (
              <button
                key={s2.at}
                className="chip"
                data-on={on}
                onClick={() => setAnswers({ ...answers, when: { at: s2.at } })}
              >
                {s2.label}
              </button>
            );
          })}
        </div>

        {/* Always visible. Its value tracks the chip above; typing a custom time
            switches "when" to that exact value, which deselects every chip. */}
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

      <div className="q" style={q(2)}>
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

      <div className="q" style={q(3)}>
        <div className="q-head">
          <span className="q-title">Craving anything?</span>
          {answers.cuisines.length > 0 ? (
            <button className="btn-quiet" onClick={() => setAnswers({ ...answers, cuisines: [] })}>
              Clear {answers.cuisines.length}
            </button>
          ) : (
            <button
              className="btn-quiet"
              onClick={() => setAnswers({ ...answers, cuisines: allVisible })}
            >
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
            // A family wrapping a single cuisine has nothing to drill into, so
            // it labels itself with the cuisine. Otherwise the chip reads as an
            // invented container — "Asian" for one pan-Asian entry, "Pacific"
            // for eight poke places.
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
