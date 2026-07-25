import { useState } from "react";
import { post } from "../lib/api";
import { getPosition } from "../lib/geo";
import type { Area, Coords } from "../lib/types";

interface Hit { id: string; name: string; address: string | null; lat: number; lng: number }

/**
 * Explain first, then ask.
 *
 * A cold browser permission prompt gets denied, and a denial is sticky — so the
 * reason comes before the request, and the request is tied to a deliberate tap
 * rather than page load. Two manual routes sit alongside it, so denying location
 * is never a dead end: type an address, or pick a saved neighbourhood.
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

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showAllAreas, setShowAllAreas] = useState(false);

  async function useDevice() {
    setBusy(true);
    setError(null);
    try {
      onLocated(await getPosition(), "your location");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Explicit submit rather than search-as-you-type — every lookup is an API call. */
  async function search(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 3) return;
    setSearching(true);
    setSearchError(null);
    setHits(null);
    try {
      const data = await post<{ results?: Hit[] }>("/api/geocode", { query: q });
      if (!data.results?.length) setSearchError(`Nothing found for “${q}”.`);
      setHits(data.results ?? []);
    } catch (err) {
      setSearchError((err as Error).message);
    } finally {
      setSearching(false);
    }
  }

  const visibleAreas = showAllAreas ? areas : areas.slice(0, 6);

  return (
    <>
      <div className="panel gate">
        <h1>
          <span className="hi">Hi, Nathan!</span> I need to know where you are.
        </h1>
        <p>Everything useful depends on it:</p>
        <ul>
          <li>
            <b>How far</b> are you willing to go to eat.
          </li>
          <li>
            <b>What's actually open</b> right now or for your occasion.
          </li>
          <li>
            <b>Which of your places</b> are near enough to bother with.
          </li>
        </ul>
        {error && <div className="err">{error}</div>}
      </div>

      <div className="q" style={{ marginTop: "1.25rem" }}>
        <div className="q-head">
          <span className="q-title">Type an address, intersection or place</span>
        </div>
        <form className="row" onSubmit={search}>
          <input
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. Dundas &amp; Ossington"
            autoComplete="street-address"
            enterKeyHint="search"
            inputMode="search"
          />
          <button
            className="btn-quiet"
            type="submit"
            disabled={searching || query.trim().length < 3}
          >
            {searching ? (
              <span className="thinking">
                <i />
                <i />
                <i />
              </span>
            ) : (
              "Find"
            )}
          </button>
        </form>

        {searchError && (
          <div className="hint" style={{ color: "var(--soon)" }}>
            {searchError}
          </div>
        )}

        {hits && hits.length > 0 && (
          <div className="cards" style={{ marginTop: "0.75rem" }}>
            {hits.map((h, i) => (
              <button
                key={h.id}
                className="card"
                style={{ "--i": i } as React.CSSProperties}
                onClick={() => onLocated({ lat: h.lat, lng: h.lng }, h.name)}
              >
                <div className="card-top">
                  <span className="card-name">{h.name}</span>
                </div>
                {h.address && <div className="card-meta">{h.address}</div>}
              </button>
            ))}
          </div>
        )}
      </div>

      {areas.length > 0 && (
        <div className="q">
          <div className="q-head">
            <span className="q-title">Or somewhere you already eat</span>
            <span className="section-count mono">{areas.length}</span>
          </div>
          <div className="cards">
            {visibleAreas.map((a, i) => (
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
          {!showAllAreas && areas.length > 6 && (
            <button
              className="btn-quiet"
              style={{ width: "100%", marginTop: "0.75rem" }}
              onClick={() => setShowAllAreas(true)}
            >
              See {areas.length - 6} more areas
            </button>
          )}
        </div>
      )}

      <div className="dock">
        <button className="btn" onClick={useDevice} disabled={busy}>
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
      </div>
    </>
  );
}
