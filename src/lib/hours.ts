import type { Answers, OpenState, Period, Place } from "./types";

const WEEK = 7 * 1440;

/**
 * Don't recommend somewhere that shuts before you could plausibly get there and
 * eat. "Open at 8:40" is useless if it closes at 8:45.
 */
export const CLOSING_BUFFER_MIN = 45;

/**
 * Minute-of-week in the PLACE's local time, not the browser's.
 *
 * Matters when travelling: Google gives opening hours as a local wall clock plus
 * a UTC offset, so a Montreal place must be evaluated against Montreal's clock
 * even while the phone is set to Vancouver. Shifting UTC by the place's offset
 * and then reading the UTC fields gives exactly that.
 */
function placeMinuteOfWeek(at: Date, utcOffsetMinutes: number | null): number {
  const shifted =
    utcOffsetMinutes == null
      ? at // no offset known — assume the phone and the place agree
      : new Date(at.getTime() + utcOffsetMinutes * 60_000);
  const day = utcOffsetMinutes == null ? shifted.getDay() : shifted.getUTCDay();
  const h = utcOffsetMinutes == null ? shifted.getHours() : shifted.getUTCHours();
  const m = utcOffsetMinutes == null ? shifted.getMinutes() : shifted.getUTCMinutes();
  return day * 1440 + h * 60 + m;
}

/** Expand a packed period into absolute minute-of-week bounds, unwrapping overnight. */
function bounds(p: Period): [number, number] {
  const [od, om, cd, cm] = p;
  const start = od * 1440 + om;
  if (cd === -1) return [start, start + 1440]; // open 24h
  let end = cd * 1440 + cm;
  // Closes at or before it opens => runs past midnight into the next day(s).
  if (end <= start) end += WEEK;
  return [start, end];
}

/**
 * Is this place open at `at`, and if so how long until it closes?
 *
 * `unknown` is deliberately distinct from `shut`. Around 15% of small places
 * have no hours in Google's data, and silently dropping them would hide real
 * options while silently including them would send you to a closed door. The UI
 * shows the uncertainty instead.
 */
export function openAt(
  place: Pick<Place, "h" | "tz" | "tmp">,
  at: Date,
): { state: OpenState; closesInMin: number | null } {
  if (place.tmp) return { state: "shut", closesInMin: null };
  if (!place.h?.length) return { state: "unknown", closesInMin: null };

  const now = placeMinuteOfWeek(at, place.tz);

  for (const period of place.h) {
    const [start, end] = bounds(period);
    // Test both this week and last week's wrap, so a Saturday-night period that
    // runs into Sunday morning still matches early on Sunday.
    for (const t of [now, now + WEEK]) {
      if (t >= start && t < end) {
        const closesInMin = end - t;
        return {
          state: closesInMin <= CLOSING_BUFFER_MIN ? "soon" : "open",
          closesInMin,
        };
      }
    }
  }
  return { state: "shut", closesInMin: null };
}

/**
 * Resolve the "when" answer to an actual instant.
 *
 * `at` is a datetime-local string ("2026-07-25T19:30"), which browsers parse as
 * local time — so an explicitly chosen day and time is honoured literally rather
 * than being rolled forward.
 */
export function targetTime(when: "now" | "hour" | { at: string }): Date {
  if (when === "now") return new Date();
  if (when === "hour") return new Date(Date.now() + 60 * 60_000);
  const d = new Date(when.at);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Format a Date for a datetime-local input, in local time. */
export function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sensible starting point: the next half hour, two hours out. */
export function defaultWhenAt(): string {
  const d = new Date(Date.now() + 2 * 60 * 60_000);
  d.setMinutes(d.getMinutes() > 30 ? 60 : 30, 0, 0);
  return toLocalInput(d);
}

export function describeWhen(when: Answers["when"]): string {
  if (when === "now") return "now";
  if (when === "hour") return "in an hour";

  const d = targetTime(when);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const isTomorrow = d.toDateString() === tomorrow.toDateString();

  const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `today ${time}`;
  if (isTomorrow) return `tomorrow ${time}`;
  return `${d.toLocaleDateString("en-CA", { weekday: "short", day: "numeric", month: "short" })} ${time}`;
}
