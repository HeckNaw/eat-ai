import { useState } from "react";
import { getPosition } from "../lib/geo";
import type { Area, Coords } from "../lib/types";

/**
 * Explain first, then ask.
 *
 * A cold browser permission prompt gets denied, and a denial is sticky — so the
 * reason comes before the request, and the request is tied to a deliberate tap
 * rather than page load. Denial is not a dead end: the fallback is picking from
 * the user's own saved neighbourhoods, which needs no geocoding API.
 */
export function LocationGate({
  areas,
  onLocated,
}: {
  areas: Area[];
  onLocated: (c: Coords, label: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      onLocated(await getPosition(), "your location");
    } catch (e) {
      setError((e as Error).message);
      setManual(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="panel gate">
        <h1>
          <span className="hi">Hi, Nathan!</span> I need to know where you are.
        </h1>
        <p>Everything useful depends on it:</p>
        <ul>
          <li>
            <b>How far</b> is the only question that matters when you're hungry
          </li>
          <li>
            <b>What's actually open</b> right now, in this timezone
          </li>
          <li>
            <b>Which of your 1,269 spots</b> are near enough to bother with
          </li>
        </ul>
        <p style={{ fontSize: "0.875rem", color: "var(--ink-faint)" }}>
          It stays on your phone. Nothing is stored, nothing is sent anywhere except
          Google, and only to ask what's nearby.
        </p>

        {error && <div className="err">{error}</div>}
      </div>

      {manual && (
        <>
          <div className="section-head">
            <h2>Or pick where you are</h2>
            <span className="section-count mono">{areas.length} areas</span>
          </div>
          <div className="cards">
            {areas.slice(0, 10).map((a, i) => (
              <button
                key={`${a.lat},${a.lng}`}
                className="card"
                style={{ "--i": i } as React.CSSProperties}
                onClick={() => onLocated({ lat: a.lat, lng: a.lng }, a.name)}
              >
                <div className="card-top">
                  <span className="card-name">{a.name}</span>
                  <span className="card-dist mono">{a.count}</span>
                </div>
                <div className="card-meta">
                  {a.topCuisines.map((c) => (
                    <span className="tag" key={c}>
                      {c}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="dock">
        <button className="btn" onClick={ask} disabled={busy}>
          {busy ? (
            <span className="thinking">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <>Use my location</>
          )}
        </button>
        {!manual && (
          <button
            className="btn-quiet"
            style={{ width: "100%", marginTop: "0.5rem" }}
            onClick={() => setManual(true)}
          >
            I'd rather pick an area
          </button>
        )}
      </div>
    </>
  );
}
