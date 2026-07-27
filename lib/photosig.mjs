/**
 * Signatures for photo resource names.
 *
 * The problem this solves: /api/photo is unauthenticated by design — an <img>
 * tag can't send a passcode, and gating on a per-device token would fragment
 * the CDN cache that makes photos free after the first view. But an open proxy
 * that accepts any well-formed name is an unbounded bill: Google photo resource
 * names are harvestable by anyone with their own key, and every distinct one we
 * forward is $0.007 on our key.
 *
 * So the name has to prove *we* produced it. A signature does that without any
 * server-side state and without touching the cache: the URL stays deterministic,
 * so each photo is still fetched from Google exactly once and served from the
 * edge forever after.
 *
 * The signature covers the name only, not the width. Width is already pinned to
 * a three-value allow-list in photo.mjs, so signing it would add no security
 * while forcing three signatures per photo into photos.json.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

// 96 bits of base64url. Forging one is infeasible; the shorter tag keeps 5,190
// of them from bloating the lazily-loaded photos.json.
const SIG_LEN = 16;

// Not "/" — that's structural in a resource name — and not any base64url
// character, or splitting a signed entry would be ambiguous.
export const SEP = "~";

export function photoSignature(name, secret) {
  return createHmac("sha256", String(secret)).update(String(name)).digest("base64url").slice(0, SIG_LEN);
}

/** "places/x/photos/y" + secret -> "places/x/photos/y~<sig>", the form the client stores. */
export function signPhotoName(name, secret) {
  return secret ? `${name}${SEP}${photoSignature(name, secret)}` : name;
}

/** Sign a list, dropping nothing — an unsigned deployment passes names through. */
export function signPhotoNames(names, secret) {
  if (!names?.length) return names ?? null;
  return names.map((n) => signPhotoName(n, secret));
}

/**
 * Constant-time check. Length is compared first because timingSafeEqual throws
 * on a mismatch, and a forged signature of the wrong length must not be
 * distinguishable from one of the right length by the error it produces.
 */
export function verifyPhotoSignature(name, sig, secret) {
  const expected = photoSignature(name, secret);
  const got = String(sig ?? "");
  if (got.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
