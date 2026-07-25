import { useState } from "react";
import { formatDistance } from "../lib/geo";
import type { Loosened } from "../lib/score";
import type { Scored } from "../lib/types";

const PAGE = 5;

/** Plain sentence for what the fallback ladder gave up, in the order it gave it. */
function describeLoosening(l: Loosened): string {
  const bits: string[] = [];
  if (l.widened) bits.push(`searched out to ${formatDistance(l.radiusM)}`);
  if (l.broadened) bits.push("included related cuisines");
  if (l.dropped) bits.push("ignored the craving");
  if (!bits.length) return "Showing the closest matches.";
  const last = bits.pop();
  const sentence = [bits.join(", "), last].filter(Boolean).join(" and ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}

function statusLabel(s: Scored): { s: string; text: string } {
  if (s.open === "open") {
    return s.closesInMin != null && s.closesInMin < 180
      ? {
          s: "open",
          text: `open · ${Math.floor(s.closesInMin / 60)}h${String(s.closesInMin % 60).padStart(2, "0")} left`,
        }
      : { s: "open", text: "open" };
  }
  if (s.open === "soon") return { s: "soon", text: `closes in ${s.closesInMin}m` };
  if (s.open === "unknown") return { s: "unknown", text: "hours unknown" };
  return { s: "shut", text: "closed" };
}

function PlaceCard({ item, index, isNew }: { item: Scored; index: number; isNew: boolean }) {
  const { place } = item;
  const st = statusLabel(item);
  const price = place.p ?? place.pe;
  const priceGuess = !place.p && !!place.pe;
  const money =
    price === "INEXPENSIVE" ? "$" : price === "MODERATE" ? "$$" : price === "EXPENSIVE" ? "$$$" : "$$$$";

  return (
    <a
      className="card"
      data-new={isNew}
      style={{ "--i": index } as React.CSSProperties}
      href={place.u ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.n)}`}
      target="_blank"
      rel="noreferrer"
    >
      <div className="card-top">
        <span className="card-name">{place.n}</span>
        <span className="card-dist mono">{formatDistance(item.distanceM)}</span>
      </div>

      <div className="card-meta">
        <span className="status mono" data-s={st.s}>
          <span className="pip" />
          {st.text}
        </span>

        {place.c && (
          <>
            <span className="dot" />
            <span className="tag tag-cuisine">{place.c}</span>
          </>
        )}

        {place.r != null && (
          <>
            <span className="dot" />
            <span className="mono" style={{ fontSize: "0.8125rem" }}>
              {place.r}&#9733;
              {place.rc != null && (
                <span style={{ color: "var(--ink-faint)" }}> {place.rc.toLocaleString()}</span>
              )}
            </span>
          </>
        )}

        {price && (
          <>
            <span className="dot" />
            <span
              className="mono"
              style={{ fontSize: "0.8125rem", opacity: priceGuess ? 0.5 : 1 }}
              title={priceGuess ? "estimated — Google has no price for this place" : undefined}
            >
              {money}
              {priceGuess && "?"}
            </span>
          </>
        )}
      </div>

      {item.why && <div className="card-why" dangerouslySetInnerHTML={{ __html: item.why }} />}
    </a>
  );
}

/**
 * Placeholder stack shown while a section settles. Widths vary per row so it
 * reads as text rather than a progress bar.
 */
function Skeletons({ count = 5 }: { count?: number }) {
  const widths = ["62%", "48%", "71%", "55%", "66%"];
  const pills = [
    ["3.5rem", "4.5rem", "2.5rem"],
    ["3rem", "5rem"],
    ["4rem", "3.5rem", "3rem"],
    ["3.25rem", "4rem"],
    ["3.75rem", "4.25rem", "2.75rem"],
  ];
  return (
    <div className="cards">
      {Array.from({ length: count }, (_, i) => (
        <div className="sk" key={i} style={{ "--i": i } as React.CSSProperties}>
          <div className="sk-row">
            <div className="sk-bar" style={{ width: widths[i % widths.length], flex: "0 0 auto" }} />
            <div className="sk-bar" style={{ width: "2.5rem", marginLeft: "auto" }} />
          </div>
          <div className="sk-meta">
            {(pills[i % pills.length] ?? []).map((w, j) => (
              <div className="sk-pill" key={j} style={{ width: w }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Paginated list. "See more" costs nothing — everything shown is already fetched. */
function Paged({ items, isNew, empty }: { items: Scored[]; isNew: boolean; empty: string }) {
  const [shown, setShown] = useState(PAGE);
  if (!items.length) return <div className="empty">{empty}</div>;

  const visible = items.slice(0, shown);
  const more = items.length - shown;

  return (
    <>
      <div className="cards">
        {visible.map((item, i) => (
          <PlaceCard key={item.place.i} item={item} index={i % PAGE} isNew={isNew} />
        ))}
      </div>
      {more > 0 && (
        <button
          className="btn-quiet"
          style={{ width: "100%", marginTop: "0.75rem" }}
          onClick={() => setShown(shown + PAGE)}
        >
          See {Math.min(PAGE, more)} more
          <span className="mono" style={{ opacity: 0.5, marginLeft: "0.375rem" }}>
            {more} left
          </span>
        </button>
      )}
    </>
  );
}

/**
 * Two sections, never blended. Merging them would need a weight for "already
 * saved this", and no principled value for it exists — set it high and discovery
 * never fires, set it low and 1,340 deliberate saves get ignored.
 */
export function Results({
  onList,
  offList,
  settling,
  discovering,
  discoverError,
  onBack,
  summary,
  loosened,
}: {
  onList: Scored[];
  offList: Scored[];
  settling: boolean;
  discovering: boolean;
  discoverError: string | null;
  onBack: () => void;
  summary: string;
  loosened: Loosened | null;
}) {
  return (
    <>
      <div className="q" style={{ "--i": 0 } as React.CSSProperties}>
        <span className="eyebrow">{summary}</span>
      </div>

      {/* Say what was given up. Quietly widening the search is worse than
          returning nothing, because the results then look like they satisfied
          constraints they don't. */}
      {!settling && loosened && (
        <div className="loosened">
          <b>Not much matched.</b> {describeLoosening(loosened)}
        </div>
      )}

      <div className="section-head">
        <h2>From your list</h2>
        <span className="section-count mono">
          {settling
            ? "\u00b7\u00b7\u00b7"
            : onList.length
              ? `${Math.min(PAGE, onList.length)} of ${onList.length}`
              : "none"}
        </span>
      </div>
      {settling ? (
        <Skeletons />
      ) : (
        <Paged
          items={onList}
          isNew={false}
          empty="Nothing you've saved is open and close enough. Try a wider radius or a later time."
        />
      )}

      <div className="section-head">
        <h2>New to you</h2>
        <span className="section-count mono">
          {discovering
            ? "searching"
            : offList.length
              ? `${Math.min(PAGE, offList.length)} of ${offList.length}`
              : "none"}
        </span>
      </div>

      {discovering ? (
        <Skeletons />
      ) : discoverError ? (
        <div className="err">{discoverError}</div>
      ) : (
        <Paged
          items={offList}
          isNew
          empty="No new places matched. Widen the radius, or drop a craving."
        />
      )}

      <div className="dock">
        <button className="btn" onClick={onBack}>
          Ask me again
        </button>
      </div>
    </>
  );
}
