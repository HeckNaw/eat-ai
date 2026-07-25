/**
 * Parse the free-text answer to "how far".
 *
 * Accepts a distance ("3km", "2 miles", "800m") or a travel time ("20 min",
 * "half an hour"), because people think in both. Time converts at a city driving
 * average of 25km/h — slow enough to be honest about lights and parking.
 *
 * Returns null when nothing sensible can be read, so the UI can say so rather
 * than silently guessing a radius.
 */

const CITY_KMH = 25;

export interface ParsedDistance {
  radiusM: number;
  label: string;
}

export function parseDistance(raw: string): ParsedDistance | null {
  const s = raw.toLowerCase().trim();
  if (!s) return null;

  if (/\b(any|anywhere|whatever|no limit|far|doesn'?t matter)\b/.test(s)) {
    return { radiusM: 60_000, label: "anywhere" };
  }
  if (/\b(walk|walking|close|nearby|around the corner)\b/.test(s) && !/\d/.test(s)) {
    return { radiusM: 1_200, label: "walking distance" };
  }

  const words: Record<string, number> = {
    "half an hour": 30, "half hour": 30, "an hour": 60, "hour": 60,
    "quarter hour": 15, "ten": 10, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "sixty": 60,
  };

  let n: number | null = null;
  const digits = s.match(/(\d+(?:\.\d+)?)/);
  if (digits) n = Number(digits[1]);
  if (n == null) {
    for (const [word, val] of Object.entries(words)) {
      if (s.includes(word)) { n = val; break; }
    }
  }
  if (n == null || !Number.isFinite(n) || n <= 0) return null;

  // Time first — "20 min" must not be read as 20 metres.
  if (/\b(min|mins|minute|minutes|hr|hrs|hour|hours)\b/.test(s) || /half an hour|half hour/.test(s)) {
    const minutes = /\b(hr|hrs|hour|hours)\b/.test(s) && !/min/.test(s) ? n * 60 : n;
    const m = Math.round((minutes / 60) * CITY_KMH * 1000);
    return {
      radiusM: Math.min(80_000, Math.max(400, m)),
      label: `${minutes} min drive · about ${(m / 1000).toFixed(m < 9500 ? 1 : 0)}km`,
    };
  }

  if (/\b(mi|mile|miles)\b/.test(s)) {
    const m = Math.round(n * 1609);
    return { radiusM: Math.min(80_000, m), label: `${n} mi · ${(m / 1000).toFixed(1)}km` };
  }
  if (/\bm\b|\bmetre|\bmeter/.test(s) && !/\bkm\b/.test(s)) {
    return { radiusM: Math.min(80_000, Math.max(200, n)), label: `${n}m` };
  }

  // Bare numbers and anything with "k" read as kilometres — the common case.
  const m = Math.round(n * 1000);
  return { radiusM: Math.min(80_000, Math.max(300, m)), label: `${n}km` };
}
