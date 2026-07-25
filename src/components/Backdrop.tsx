/**
 * Diagonal CHUD carousel behind everything.
 *
 * Rows alternate direction, which makes the whole field read as movement rather
 * than as scrolling text. The loop is seamless because each track holds the same
 * run of words twice and animates exactly -50%, so the halfway point lands where
 * the start was.
 *
 * Purely decorative: aria-hidden, pointer-events none, and frozen entirely under
 * prefers-reduced-motion.
 */

const ROWS = 14;
const PER_ROW = 14;

export function Backdrop() {
  const run = Array.from({ length: PER_ROW }, () => "CHUD").join(" ");

  return (
    <div className="backdrop" aria-hidden="true">
      <div className="backdrop-rotate">
        {Array.from({ length: ROWS }, (_, i) => (
          <div
            className="backdrop-row"
            key={i}
            data-dir={i % 2 === 0 ? "left" : "right"}
            style={
              {
                // Varying the duration per row stops the field looking mechanical.
                "--dur": `${34 + (i % 5) * 7}s`,
                "--delay": `${i * -2.5}s`,
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
