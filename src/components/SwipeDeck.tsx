import { useEffect, useMemo, useRef, useState } from "react";
import { formatDistance } from "../lib/geo";
import { photoUrl } from "../lib/photos";
import type { Scored } from "../lib/types";

/**
 * One restaurant at a time, swipe to decide.
 *
 *   left  → skip, next card
 *   right → drop it in the basket, next card
 *
 * Saved-list places come first, then new-to-you, each badged. The basket is
 * reachable at any time and is where you end up once the deck runs out — the
 * point is to collect a shortlist while swiping, then choose from it.
 */

const SWIPE_PX = 90; // drag past this to commit a swipe
const PEEK_Y = 18; // px each card below the top is pushed down, to peek out
const PEEK_SCALE = 0.05; // and shrunk, per level of depth

/** Circular-arrow restart icon, for the "new search" button. */
function RestartIcon() {
  return (
    <svg
      className="deck-restart-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 1 0-.9 4.5" />
      <polyline points="20 4 20 11 13 11" />
    </svg>
  );
}

/** Line-art shopping basket, used on the basket button. */
function BasketIcon() {
  return (
    <svg
      className="deck-basket-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 8.5h14l-1.1 10.2a1.5 1.5 0 0 1-1.5 1.3H7.6a1.5 1.5 0 0 1-1.5-1.3L5 8.5Z" />
      <path d="M8.5 8.5a3.5 3.5 0 0 1 7 0" />
      <path d="M9.2 12v4M12 12v4M14.8 12v4" />
    </svg>
  );
}

/** The one heart used by both the save button and the skipped-row restore. */
function HeartIcon() {
  return (
    <svg className="deck-heart" viewBox="0 0 24 22" aria-hidden="true">
      {/* Symmetric about x=12: left edge 2, right edge 22. */}
      <path
        fill="currentColor"
        d="M12 21C12 21 2 14.4 2 7.8 2 4.6 4.6 2 7.8 2c1.8 0 3.4.9 4.2 2.3C12.8 2.9 14.4 2 16.2 2 19.4 2 22 4.6 22 7.8 22 14.4 12 21 12 21Z"
      />
    </svg>
  );
}

function money(p: string | null): string {
  return p === "INEXPENSIVE" ? "$" : p === "MODERATE" ? "$$" : p === "EXPENSIVE" ? "$$$" : "$$$$";
}

function statusText(s: Scored): { s: string; text: string } {
  if (s.open === "open") {
    // Over 2 hours of runway is plenty — just "open". Show the countdown only
    // once it's within two hours (but still more than the 1-hour "soon" mark).
    return s.closesInMin != null && s.closesInMin <= 120
      ? { s: "open", text: `open · ${Math.floor(s.closesInMin / 60)}h${String(s.closesInMin % 60).padStart(2, "0")} left` }
      : { s: "open", text: "open" };
  }
  if (s.open === "soon") return { s: "soon", text: `closes in ${s.closesInMin}m` };
  if (s.open === "unknown") return { s: "unknown", text: "hours unknown" };
  return { s: "shut", text: "closed" };
}

function mapsHref(s: Scored): string {
  return s.place.u ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.place.n)}`;
}

/** A single photo tile with its own skeleton until the image decodes. */
function PhotoTile({ name }: { name: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="deck-photo" data-loaded={loaded}>
      {!loaded && <div className="deck-photo-sk" />}
      <img
        src={photoUrl(name, 800)}
        alt=""
        loading="eager"
        draggable={false}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  );
}

/**
 * Up to four photos in a grid. Three states: names not resolved yet (the photo
 * map is still loading) → skeleton tiles; names resolved and empty → monogram;
 * names present → the tiles, each with its own skeleton until it decodes.
 */
function Photos({ s, photoMap }: { s: Scored; photoMap: Record<string, string[]> | null }) {
  // Off-list places carry names inline; saved places come from the lazy map.
  const names = s.place.ph ?? photoMap?.[s.place.i];
  const resolving = names === undefined; // map still loading and none inline

  if (resolving) {
    return (
      <div className="deck-photos" data-n={4}>
        {[0, 1, 2, 3].map((i) => (
          <div className="deck-photo" key={i}>
            <div className="deck-photo-sk" />
          </div>
        ))}
      </div>
    );
  }
  if (!names || !names.length) {
    return (
      <div className="deck-photos deck-photos-none" data-cuisine={s.place.c ?? ""}>
        <span>{(s.place.n[0] ?? "?").toUpperCase()}</span>
      </div>
    );
  }
  return (
    <div className="deck-photos" data-n={Math.min(names.length, 4)}>
      {names.slice(0, 4).map((name) => (
        <PhotoTile name={name} key={name} />
      ))}
    </div>
  );
}

function CardFace({ s, photoMap }: { s: Scored; photoMap: Record<string, string[]> | null }) {
  const st = statusText(s);
  const isNew = s.place.l === "new";
  const price = s.place.p ?? s.place.pe;
  const priceGuess = !s.place.p && !!s.place.pe;

  return (
    <>
      <Photos s={s} photoMap={photoMap} />
      <div className="deck-body">
        <div className="deck-badges">
          <span className={`deck-badge ${isNew ? "is-new" : "is-list"}`}>
            {isNew ? "New to you" : "On your list"}
          </span>
          {s.place.co && <span className="deck-badge is-chain">chain</span>}
        </div>
        <h2 className="deck-name">{s.place.n}</h2>
        <div className="card-meta">
          <span className="status mono" data-s={st.s}>
            <span className="pip" />
            {st.text}
          </span>
          <span className="dot" />
          <span className="card-dist mono">{formatDistance(s.distanceM)}</span>
          {s.place.c && (
            <>
              <span className="dot" />
              <span className="tag tag-cuisine">{s.place.c}</span>
            </>
          )}
          {s.place.r != null && (
            <>
              <span className="dot" />
              <span className="mono" style={{ fontSize: "0.8125rem" }}>
                {s.place.r}&#9733;
                {s.place.rc != null && (
                  <span style={{ color: "var(--ink-faint)" }}> {s.place.rc.toLocaleString()}</span>
                )}
              </span>
            </>
          )}
          {price && (
            <>
              <span className="dot" />
              <span className="mono" style={{ fontSize: "0.8125rem", opacity: priceGuess ? 0.5 : 1 }}>
                {money(price)}
                {priceGuess && "?"}
              </span>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** One row in the basket / skipped lists. */
function BasketRow({ s, i }: { s: Scored; i: number }) {
  const st = statusText(s);
  return (
    <a
      className="card"
      style={{ "--i": i } as React.CSSProperties}
      href={mapsHref(s)}
      target="_blank"
      rel="noreferrer"
    >
      <div className="card-top">
        <span className="card-name">{s.place.n}</span>
        <span className="card-dist mono">{formatDistance(s.distanceM)}</span>
      </div>
      <div className="card-meta">
        <span className="status mono" data-s={st.s}>
          <span className="pip" />
          {st.text}
        </span>
        {s.place.c && (
          <>
            <span className="dot" />
            <span className="tag tag-cuisine">{s.place.c}</span>
          </>
        )}
        {s.place.r != null && (
          <>
            <span className="dot" />
            <span className="mono" style={{ fontSize: "0.8125rem" }}>{s.place.r}&#9733;</span>
          </>
        )}
      </div>
    </a>
  );
}

const ROW_SWIPE_PX = 68; // drag a row past this to move it

/**
 * A swipeable list row. Swipe it in its action direction to move it to the other
 * list; the card flies off and leaves the action icon behind on a coloured
 * field, which then fades — so the gesture reads back what it just did.
 *
 *   basket item  → swipe left  → skip  (red field, white ✕)
 *   skipped item → swipe right → keep  (green field, white heart)
 */
function MoveRow({
  s,
  i,
  action,
  greyed,
  onCommit,
}: {
  s: Scored;
  i: number;
  action: "keep" | "skip";
  greyed?: boolean;
  onCommit: () => void;
}) {
  const toRight = action === "keep"; // restoring swipes right; skipping swipes left
  const [dx, setDx] = useState(0);
  const [committing, setCommitting] = useState(false);
  const start = useRef<number | null>(null);
  const moved = useRef(false);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<number | undefined>(undefined);

  const clamp = (d: number) => (toRight ? Math.max(0, d) : Math.min(0, d));
  const commitRow = () => {
    setCommitting(true);
    window.setTimeout(onCommit, 520); // move after the leave-behind fades
  };

  // Trackpad two-finger horizontal swipe → wheel deltaX. Same handling as the
  // deck card, clamped to this row's one actionable direction.
  function wheel(e: React.WheelEvent) {
    if (committing) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    wheelAccum.current += e.deltaX;
    setDx(clamp(-wheelAccum.current));
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      const settled = clamp(-wheelAccum.current);
      wheelAccum.current = 0;
      if (toRight ? settled > ROW_SWIPE_PX : settled < -ROW_SWIPE_PX) commitRow();
      else setDx(0);
    }, 110);
  }

  function down(e: React.PointerEvent) {
    if (committing) return;
    start.current = e.clientX;
    moved.current = false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (start.current == null) return;
    let d = e.clientX - start.current;
    if (Math.abs(d) > 4) moved.current = true;
    d = toRight ? Math.max(0, d) : Math.min(0, d); // only the actionable direction
    setDx(d);
  }
  function up() {
    if (start.current == null) return;
    start.current = null;
    const past = toRight ? dx > ROW_SWIPE_PX : dx < -ROW_SWIPE_PX;
    if (past) commitRow();
    else setDx(0);
  }

  const progress = Math.min(1, Math.abs(dx) / ROW_SWIPE_PX);
  const dragging = start.current != null;
  const tx = committing ? (toRight ? 1 : -1) * (typeof window !== "undefined" ? window.innerWidth : 500) : dx;

  return (
    <div className="deck-move-row" data-action={action} data-committing={committing || undefined} data-greyed={greyed || undefined}>
      <div className="deck-move-hint" style={committing ? undefined : { opacity: progress }}>
        {action === "keep" ? <HeartIcon /> : <span className="deck-x-mark">✕</span>}
      </div>
      <div
        className="deck-move-card"
        style={{
          transform: `translate3d(${tx}px,0,0)`,
          transition: committing || !dragging ? "transform 0.3s var(--out), opacity 0.3s var(--out)" : "none",
          opacity: committing ? 0 : 1,
        }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onWheel={wheel}
        onClickCapture={(e) => {
          if (moved.current) e.preventDefault();
        }}
      >
        <BasketRow s={s} i={i} />
      </div>
    </div>
  );
}

/** Meta row (open · distance · cuisine · rating · price) reused in the result. */
function MetaLine({ s }: { s: Scored }) {
  const st = statusText(s);
  const price = s.place.p ?? s.place.pe;
  return (
    <div className="card-meta chooser-meta">
      <span className="status mono" data-s={st.s}>
        <span className="pip" />
        {st.text}
      </span>
      <span className="dot" />
      <span className="card-dist mono">{formatDistance(s.distanceM)}</span>
      {s.place.c && (
        <>
          <span className="dot" />
          <span className="tag tag-cuisine">{s.place.c}</span>
        </>
      )}
      {s.place.r != null && (
        <>
          <span className="dot" />
          <span className="mono" style={{ fontSize: "0.8125rem" }}>{s.place.r}&#9733;</span>
        </>
      )}
      {price && (
        <>
          <span className="dot" />
          <span className="mono" style={{ fontSize: "0.8125rem" }}>
            {money(price)}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * "Choose for me" — a raffle over the basket. A light cycles through the picks,
 * fast then decelerating, and lands on a random one; the winner is then revealed
 * with its photos. Full-screen dim overlay.
 */
function Chooser({
  items,
  photoMap,
  onClose,
}: {
  items: Scored[];
  photoMap: Record<string, string[]> | null;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"spinning" | "result">("spinning");
  const [highlight, setHighlight] = useState(0);
  const [chosen, setChosen] = useState<Scored | null>(null);
  const timer = useRef<number | undefined>(undefined);

  function spin() {
    window.clearTimeout(timer.current);
    const n = items.length;
    if (!n) return;
    const target = Math.floor(Math.random() * n);
    setChosen(null);
    setHighlight(0);
    setPhase("spinning");
    // A few full loops, ending exactly on the target index.
    const totalTicks = n * 4 + target;
    let tick = 0;
    const FAST = 55;
    const SLOW = 340;
    const run = () => {
      setHighlight(tick % n);
      if (tick >= totalTicks) {
        timer.current = window.setTimeout(() => {
          setChosen(items[target] ?? null);
          setPhase("result");
        }, 520);
        return;
      }
      const p = tick / totalTicks;
      const delay = FAST + (SLOW - FAST) * p * p; // decelerate toward the end
      tick += 1;
      timer.current = window.setTimeout(run, delay);
    };
    run();
  }

  useEffect(() => {
    spin();
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === "result" && chosen) {
    return (
      <div className="chooser" role="dialog" aria-modal="true">
        <div className="chooser-result">
          <p className="chooser-congrats">🎉 Congratulations!</p>
          <p className="chooser-sub">You&rsquo;re eating at</p>
          <h1 className="chooser-name">{chosen.place.n}</h1>
          <div className="chooser-card">
            <Photos s={chosen} photoMap={photoMap} />
          </div>
          <MetaLine s={chosen} />
          <a
            className="btn"
            href={mapsHref(chosen)}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: "1.25rem" }}
          >
            Open in Maps
          </a>
          <div className="chooser-actions">
            <button className="btn-quiet" onClick={spin}>
              Choose again
            </button>
            <button className="btn-quiet" onClick={onClose}>
              Back to basket
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chooser" role="dialog" aria-modal="true">
      <p className="chooser-title mono">choosing&hellip;</p>
      <div className="chooser-list">
        {items.map((s, i) => (
          <div key={s.place.i} className="chooser-item" data-lit={i === highlight || undefined}>
            <span className="chooser-item-name">{s.place.n}</span>
            {s.place.c && <span className="chooser-item-cuisine">{s.place.c}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The basket: kept picks up top, skipped ones greyed below. Swipe rows to move. */
function Basket({
  items,
  rejected,
  photoMap,
  onBack,
  onKeep,
  onSkip,
  canResume,
}: {
  items: Scored[];
  rejected: Scored[];
  photoMap: Record<string, string[]> | null;
  onBack: () => void;
  onKeep: (s: Scored) => void;
  onSkip: (s: Scored) => void;
  canResume: boolean;
}) {
  const [choosing, setChoosing] = useState(false);
  return (
    <>
      {choosing && <Chooser items={items} photoMap={photoMap} onClose={() => setChoosing(false)} />}

      {canResume && (
        <button className="btn-quiet" style={{ width: "100%", marginBottom: "1.25rem" }} onClick={onBack}>
          &lsaquo; Back to swiping
        </button>
      )}

      <div className="section-head">
        <h2>Your basket</h2>
        <span className="section-count mono">{items.length}</span>
      </div>
      {items.length >= 2 && (
        <button className="btn" style={{ width: "100%", marginBottom: "1rem" }} onClick={() => setChoosing(true)}>
          🎲&nbsp;&nbsp;Choose for me
        </button>
      )}
      {items.length === 0 ? (
        <div className="empty" style={{ textAlign: "center", color: "var(--ink-dim)" }}>
          Nothing saved yet. Swipe right on a place to drop it here.
        </div>
      ) : (
        <div className="cards">
          {items.map((s, i) => (
            <MoveRow key={s.place.i} s={s} i={i} action="skip" onCommit={() => onSkip(s)} />
          ))}
        </div>
      )}

      {rejected.length > 0 && (
        <>
          <div className="section-head" style={{ marginTop: "1.5rem" }}>
            <h2 style={{ color: "var(--ink-dim)" }}>Skipped</h2>
            <span className="section-count mono">{rejected.length}</span>
          </div>
          <div className="cards">
            {rejected.map((s, i) => (
              <MoveRow key={s.place.i} s={s} i={i} action="keep" greyed onCommit={() => onKeep(s)} />
            ))}
          </div>
        </>
      )}

    </>
  );
}

/**
 * The card that was just swiped, flying off screen on its own element so it
 * never re-enters the stack. Mounts where the drag left it (fromX), then a
 * double rAF flips it off-screen so the transition actually runs.
 */
function LeavingCard({
  card,
  dir,
  fromX,
  photoMap,
  onDone,
}: {
  card: Scored;
  dir: 1 | -1;
  fromX: number;
  photoMap: Record<string, string[]> | null;
  onDone: () => void;
}) {
  const [off, setOff] = useState(false);
  useEffect(() => {
    let r2 = 0;
    const r1 = requestAnimationFrame(() => {
      r2 = requestAnimationFrame(() => setOff(true));
    });
    return () => {
      cancelAnimationFrame(r1);
      cancelAnimationFrame(r2);
    };
  }, []);
  const x = off ? dir * (typeof window !== "undefined" ? window.innerWidth * 1.2 : 600) : fromX;
  return (
    <div
      className="deck-card deck-leaving"
      style={{
        zIndex: 20,
        transform: `translate3d(${x}px,0,0) rotate(${x / 22}deg)`,
        opacity: off ? 0 : 1,
        transition: "transform 0.36s var(--out), opacity 0.36s var(--out)",
      }}
      onTransitionEnd={onDone}
      aria-hidden="true"
    >
      <CardFace s={card} photoMap={photoMap} />
    </div>
  );
}

export function SwipeDeck({
  deck,
  discovering,
  photoMap,
  onRestart,
}: {
  deck: Scored[];
  discovering: boolean;
  photoMap: Record<string, string[]> | null;
  onRestart: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [basket, setBasket] = useState<Scored[]>([]);
  const [rejected, setRejected] = useState<Scored[]>([]);
  const [showBasket, setShowBasket] = useState(false);
  const [drag, setDrag] = useState(0);
  // The card currently flying off the top of the stack, as its own element so it
  // never boomerangs back as the next restaurant. `fromX` is where the drag left
  // it, so the hand-off from the stack is seamless.
  const [leaving, setLeaving] = useState<{ card: Scored; dir: 1 | -1; fromX: number; n: number } | null>(null);
  const leaveN = useRef(0);
  // A one-shot screen flash + fading icon on each decision. `n` bumps so React
  // remounts the overlay and the CSS animation replays even on rapid swipes.
  const [flash, setFlash] = useState<{ dir: 1 | -1; n: number } | null>(null);
  const flashN = useRef(0);
  const pointerStart = useRef<number | null>(null);
  const moved = useRef(false);
  const wheelAccum = useRef(0);
  const wheelTimer = useRef<number | undefined>(undefined);

  const current = deck[index];
  const atEnd = index >= deck.length;
  // Genuinely finished only when the deck is exhausted and nothing more is loading.
  const finished = atEnd && !discovering;

  // Land on the basket the moment swiping is done.
  useEffect(() => {
    if (finished) setShowBasket(true);
  }, [finished]);

  function commit(dir: 1 | -1) {
    const card = deck[index];
    if (!card) return;
    if (dir === 1) setBasket((b) => (b.some((x) => x.place.i === card.place.i) ? b : [...b, card]));
    else setRejected((r) => (r.some((x) => x.place.i === card.place.i) ? r : [...r, card]));
    setFlash({ dir, n: ++flashN.current });
    // Hand the top card to a standalone flying element, then advance the stack.
    // The card underneath animates up into its place; nothing returns.
    setLeaving({ card, dir, fromX: drag, n: ++leaveN.current });
    setIndex((i) => i + 1);
    setDrag(0);
  }

  function onPointerDown(e: React.PointerEvent) {
    pointerStart.current = e.clientX;
    moved.current = false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (pointerStart.current == null) return;
    const dx = e.clientX - pointerStart.current;
    if (Math.abs(dx) > 4) moved.current = true;
    setDrag(dx);
  }
  function onPointerUp() {
    if (pointerStart.current == null) return;
    pointerStart.current = null;
    if (drag > SWIPE_PX) commit(1);
    else if (drag < -SWIPE_PX) commit(-1);
    else setDrag(0);
  }

  // Trackpad two-finger horizontal swipe arrives as wheel events with deltaX.
  // Accumulate them so the card follows the fingers, then commit or snap back a
  // beat after the gesture stops. Vertical intent (deltaY dominant) is left to
  // scroll the page.
  function onWheel(e: React.WheelEvent) {
    if (!current) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    wheelAccum.current += e.deltaX;
    const d = -wheelAccum.current; // fingers left → card left (skip)
    setDrag(d);
    window.clearTimeout(wheelTimer.current);
    wheelTimer.current = window.setTimeout(() => {
      const settled = -wheelAccum.current;
      wheelAccum.current = 0;
      if (settled > SWIPE_PX) commit(1);
      else if (settled < -SWIPE_PX) commit(-1);
      else setDrag(0);
    }, 110);
  }

  const inBasket = (s: Scored) => basket.some((x) => x.place.i === s.place.i);

  const savedCount = basket.length;
  const progress = useMemo(
    () => (deck.length ? Math.min(index, deck.length) : 0),
    [index, deck.length],
  );

  if (showBasket) {
    return (
      <>
        <Basket
          items={basket}
          rejected={rejected}
          photoMap={photoMap}
          canResume={!finished}
          onBack={() => setShowBasket(false)}
          onKeep={(s) => {
            setRejected((r) => r.filter((x) => x.place.i !== s.place.i));
            setBasket((b) => (b.some((x) => x.place.i === s.place.i) ? b : [...b, s]));
          }}
          onSkip={(s) => {
            setBasket((b) => b.filter((x) => x.place.i !== s.place.i));
            setRejected((r) => (r.some((x) => x.place.i === s.place.i) ? r : [...r, s]));
          }}
        />
        <div className="dock">
          <button className="btn" onClick={onRestart}>
            {finished ? "New search" : "Ask me again"}
          </button>
        </div>
      </>
    );
  }

  // Up to three cards visible at once: the interactive top card plus two peeking
  // underneath, so the deck reads as a physical stack.
  const stack = deck.slice(index, index + 3);
  const decided: 0 | 1 | -1 = drag > SWIPE_PX ? 1 : drag < -SWIPE_PX ? -1 : 0;

  return (
    <>
      {/* One-shot decision flash: a wash of colour and a fading icon over the
          whole screen. Keyed by n so it replays on every swipe. */}
      {flash && (
        <div
          key={flash.n}
          className="deck-flash"
          data-dir={flash.dir === 1 ? "save" : "skip"}
          onAnimationEnd={() => setFlash((f) => (f && f.n === flash.n ? null : f))}
          aria-hidden="true"
        >
          <span className="deck-flash-icon">
            {flash.dir === 1 ? <HeartIcon /> : <span className="deck-x-mark">✕</span>}
          </span>
        </div>
      )}

      <div className="deck-head">
        <span className="deck-progress mono">
          {deck.length ? (
            <>
              <b>{Math.min(progress + (current ? 1 : 0), deck.length)}</b>
              <span className="deck-progress-sep">/</span>
              {deck.length}
              {discovering && <span className="deck-progress-more">+</span>}
              <span className="deck-progress-left">
                {/* The current card is undecided, so it counts as still left. */}
                {Math.max(deck.length - progress, 0)} left
              </span>
            </>
          ) : (
            ""
          )}
        </span>
        <button className="deck-restart-btn" onClick={onRestart}>
          <RestartIcon />
          New search
        </button>
      </div>

      <div className="deck-stage" onWheel={onWheel}>
        {/* Render deepest-first so the top card paints last. Each is keyed by
            place id, so when the top leaves, the ones below keep their identity
            and simply transition up a level — no reuse, no boomerang. */}
        {stack
          .map((s, depth) => ({ s, depth }))
          .reverse()
          .map(({ s, depth }) => {
            const isTop = depth === 0;
            const base = `translateY(${depth * PEEK_Y}px) scale(${1 - depth * PEEK_SCALE})`;
            const dragging = isTop && pointerStart.current != null;
            return (
              <div
                key={s.place.i}
                className="deck-card"
                data-depth={depth}
                style={{
                  zIndex: 10 - depth,
                  transform: isTop && drag ? `translate3d(${drag}px,0,0) rotate(${drag / 22}deg)` : base,
                  transition: dragging ? "none" : "transform 0.3s var(--out), filter 0.3s var(--out)",
                }}
                {...(isTop
                  ? {
                      onPointerDown,
                      onPointerMove,
                      onPointerUp,
                      onPointerCancel: onPointerUp,
                      "data-decided": decided === 1 ? "save" : decided === -1 ? "skip" : undefined,
                    }
                  : { "aria-hidden": true })}
              >
                {isTop ? (
                  <>
                    {/* Tap (no drag) opens the place; a real swipe does not. */}
                    <a
                      className="deck-open"
                      href={mapsHref(s)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => {
                        if (moved.current) e.preventDefault();
                      }}
                    >
                      <CardFace s={s} photoMap={photoMap} />
                    </a>
                    <div className="deck-stamp deck-stamp-save" style={{ opacity: Math.max(0, Math.min(1, drag / SWIPE_PX)) }}>
                      {inBasket(s) ? "in basket" : "basket"}
                    </div>
                    <div className="deck-stamp deck-stamp-skip" style={{ opacity: Math.max(0, Math.min(1, -drag / SWIPE_PX)) }}>
                      skip
                    </div>
                  </>
                ) : (
                  <CardFace s={s} photoMap={photoMap} />
                )}
              </div>
            );
          })}

        {/* The card being swiped away, flying off on its own. */}
        {leaving && (
          <LeavingCard
            key={leaving.n}
            card={leaving.card}
            dir={leaving.dir}
            fromX={leaving.fromX}
            photoMap={photoMap}
            onDone={() => setLeaving((l) => (l && l.n === leaving.n ? null : l))}
          />
        )}

        {stack.length === 0 && (
          <div className="deck-card deck-card-loading">
            <span className="thinking" style={{ color: "var(--accent)" }}>
              <i />
              <i />
              <i />
            </span>
            <p className="mono">finding new places…</p>
          </div>
        )}
      </div>

      <div className="dock deck-actions">
        <button className="deck-act deck-act-skip" onClick={() => commit(-1)} disabled={!current} aria-label="Skip">
          ✕
        </button>
        <button className="deck-act deck-act-basket" onClick={() => setShowBasket(true)} aria-label="View basket">
          <BasketIcon />
          <span className="deck-basket-n">{savedCount}</span>
        </button>
        <button className="deck-act deck-act-save" onClick={() => commit(1)} disabled={!current} aria-label="Add to basket">
          <HeartIcon />
        </button>
      </div>
    </>
  );
}
