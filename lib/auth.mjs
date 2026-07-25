/**
 * The single-user gate.
 *
 * This app has no accounts and needs none, but a Vercel URL is public by
 * default and every /api call spends real Google quota. So the two Places
 * routes require a shared passcode.
 *
 * What this does and does not protect:
 *   - protects  the API key and the billable calls behind it
 *   - protects  nothing about public/places.json, which is a static asset and
 *               stays readable by anyone with the URL. The saved restaurant
 *               list is not a secret; the spend is.
 *
 * If APP_PASSCODE is unset the routes stay open, which is what keeps local dev
 * a single `npm run dev` with no extra setup.
 */

import { timingSafeEqual } from "node:crypto";

/** Constant-time compare that tolerates unequal lengths. */
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) {
    // Still burn a comparison so length isn't leaked by timing alone.
    timingSafeEqual(x, x);
    return false;
  }
  return timingSafeEqual(x, y);
}

export function passcodeRequired(env = process.env) {
  return Boolean((env.APP_PASSCODE ?? "").trim());
}

/** True when the request may proceed. */
export function authorized(body, env = process.env) {
  const expected = (env.APP_PASSCODE ?? "").trim();
  if (!expected) return true;
  return same(body?.passcode ?? "", expected);
}

export const DENIED = { status: 401, body: { error: "Wrong passcode." } };

/** GET-shaped probe so the client can learn its state without spending a call. */
export function handleAuth(body, env = process.env) {
  const required = passcodeRequired(env);
  if (!required) return { status: 200, body: { ok: true, required: false } };
  if (!authorized(body, env)) return DENIED;
  return { status: 200, body: { ok: true, required: true } };
}
