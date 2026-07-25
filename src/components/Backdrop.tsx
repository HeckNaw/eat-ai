import { useEffect, useRef } from "react";

/**
 * Diagonal EAT carousel behind everything.
 *
 * Motion is driven in JS rather than CSS, for one reason: the speed has to
 * react to scrolling, and `animation-duration` cannot be changed mid-flight
 * without the row jumping to a new position in its cycle. A requestAnimationFrame
 * loop advancing a transform has no such seam — it can ease from a crawl to a
 * rush and back with nothing to hide.
 *
 * Baseline is deliberately very slow: a few pixels a second, read as drift, not
 * as scrolling text. A scroll flicks a shared boost up; it decays back to the
 * crawl within about a second of the scroll stopping.
 *
 * Purely decorative: aria-hidden, pointer-events none, frozen under
 * prefers-reduced-motion.
 */

const WORD = "EAT";

// Enough rows to fill the tallest phone even at the smallest font. On mobile the
// font clamps to ~44px, so ~24 rows cover a ~1100px column; on desktop the extra
// rows simply overflow the viewport and are clipped. Too few, and the stack
// centres with empty bands top and bottom — the bug this replaces.
const ROWS = 24;

// Three letters is narrow, so a short track lets a gap walk across the screen —
// pad each row well past the over-scaled container width.
const PER_ROW = 24;

// px/second. Base is the crawl; each row varies a little so the field never
// looks like one rigid sheet.
const BASE_SPEED = 5;
const SPEED_VARIANCE = 6;

// Scroll response. A scroll delta adds to a shared boost (capped), which decays
// exponentially back to zero — so faster scrolling accelerates the field more.
const SCROLL_GAIN = 0.09;
const MAX_BOOST = 11;
const BOOST_DECAY = 3.2; // per second; ~1s to settle

const FACES: Record<string, string> = {
  anton: '"Anton", Impact, sans-serif',
  bebas: '"Bebas Neue", Impact, sans-serif',
  archivo: '"Archivo Black", Impact, sans-serif',
  oswald: '"Oswald", Impact, sans-serif',
  impact: 'Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif',
};

function chosenFace(): string | undefined {
  if (typeof location === "undefined") return undefined;
  const key = new URLSearchParams(location.search).get("face");
  return key ? FACES[key.toLowerCase()] : undefined;
}

export function Backdrop() {
  const run = Array.from({ length: PER_ROW }, () => WORD).join(" ");
  const face = chosenFace();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const tracks = Array.from(root.querySelectorAll<HTMLElement>(".backdrop-track"));

    const state = tracks.map((el, i) => ({
      el,
      dir: i % 2 === 0 ? -1 : 1,
      speed: BASE_SPEED + (i % 5) * (SPEED_VARIANCE / 4),
      offset: -i * 37, // stagger so rows don't share a phase
      half: 1000, // remeasured once fonts settle
    }));

    // The seamless wrap distance is half the track (it holds the run twice).
    // Measured after fonts load, since a custom display face changes the width.
    const measure = () => {
      for (const s of state) s.half = s.el.scrollWidth / 2 || s.half;
    };
    if (document.fonts?.ready) document.fonts.ready.then(measure);
    else measure();
    window.addEventListener("resize", measure);

    let boost = 0;
    let lastScrollY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      boost = Math.min(boost + Math.abs(y - lastScrollY) * SCROLL_GAIN, MAX_BOOST);
      lastScrollY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05); // clamp after a tab stall
      last = now;
      boost -= boost * Math.min(dt * BOOST_DECAY, 1);
      const mult = 1 + boost;
      for (const s of state) {
        s.offset += s.dir * s.speed * mult * dt;
        // Keep offset within [-half, 0) so the doubled track never shows a seam.
        s.offset = (((s.offset % s.half) + s.half) % s.half) - s.half;
        s.el.style.transform = `translate3d(${s.offset.toFixed(2)}px,0,0)`;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    // Don't burn frames on a hidden tab.
    const onVisible = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
      } else {
        last = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <div
      className="backdrop"
      aria-hidden="true"
      ref={rootRef}
      style={face ? ({ "--face": face } as React.CSSProperties) : undefined}
    >
      <div className="backdrop-rotate">
        {Array.from({ length: ROWS }, (_, i) => (
          <div className="backdrop-row" key={i}>
            {/* Twice, for the seamless wrap. */}
            <span className="backdrop-track">
              {run} {run}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
