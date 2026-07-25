/**
 * Every server call goes through here so the passcode is attached in exactly
 * one place, and so a 401 is a distinguishable outcome rather than a generic
 * failure — the UI has to be able to re-prompt.
 */

const KEY = "chudly.passcode";

export class Unauthorized extends Error {
  constructor() {
    super("Wrong passcode.");
  }
}

export function storedPasscode(): string {
  try {
    return localStorage.getItem(KEY) ?? "";
  } catch {
    return ""; // private browsing with storage blocked
  }
}

export function savePasscode(code: string): void {
  try {
    localStorage.setItem(KEY, code);
  } catch {
    /* not fatal — the code stays in memory for this session */
  }
}

export function forgetPasscode(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function post<T>(path: string, body: object, passcode?: string): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, passcode: passcode ?? storedPasscode() }),
  });
  if (res.status === 401) throw new Unauthorized();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

/**
 * Ask the server whether we're allowed in. Deliberately its own route: it hits
 * no external API, so the app can check on every boot for free instead of
 * discovering it's locked out halfway through a search.
 */
export async function checkAccess(passcode?: string): Promise<{ ok: boolean; required: boolean }> {
  try {
    return await post<{ ok: boolean; required: boolean }>("/api/auth", {}, passcode);
  } catch (e) {
    if (e instanceof Unauthorized) return { ok: false, required: true };
    // Network or server trouble is not the same as being locked out. Let the
    // app through; the Places routes will fail loudly on their own if it's real.
    return { ok: true, required: false };
  }
}
