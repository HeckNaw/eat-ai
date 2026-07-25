/**
 * Diagonal EAT carousel behind everything.
 *
 * Rows alternate direction, which makes the whole field read as movement rather
 * than as scrolling text. The loop is seamless because each track holds the same
 * run of words twice and animates exactly -50%, so the halfway point lands where
 * the start was.
 *
 * Purely decorative: aria-hidden, pointer-events none, and frozen entirely under
 * prefers-reduced-motion.
 */

const WORD = "EAT";
const ROWS = 14;

// Three letters instead of four, so more per row to keep each track wider than
// the over-scaled container — otherwise a gap walks across the screen.
const PER_ROW = 22;

/**
 * Face picker, temporary. A backdrop at 4% opacity behind moving cards looks
 * nothing like a font specimen, so the only useful way to choose is in situ:
 *
 *   ?face=anton  ?face=bebas  ?face=archivo  ?face=oswald  ?face=impact
 *
 * Once one wins, hard-code it in styles.css, delete this, and drop the losing
 * families from the font link in index.html.
 */
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

  return (
    <div
      className="backdrop"
      aria-hidden="true"
      style={face ? ({ "--face": face } as React.CSSProperties) : undefined}
    >
      <div className="backdrop-rotate">
        {Array.from({ length: ROWS }, (_, i) => (
          <div
            className="backdrop-row"
            key={i}
            data-dir={i % 2 === 0 ? "left" : "right"}
            style={
              {
                // Slow enough to read as drift rather than scrolling. Varying the
                // duration per row stops the field looking mechanical.
                "--dur": `${110 + (i % 5) * 22}s`,
                "--delay": `${i * -7}s`,
              } as React.CSSProperties
            }
          >
            {/* Twice, for the seamless -50% wrap. */}
            <span className="backdrop-track">
              {run} {run}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
