/**
 * Serve a Google Place photo through our own origin.
 *
 * Two reasons this is a proxy and not a direct client fetch:
 *
 *   1. The Google Place Photo endpoint needs the API key in the URL. Fetching
 *      client-side would leak the key, breaking the same rule that keeps
 *      discovery server-side.
 *   2. Each Place Photo request is billed ($7/1000, 1,000 free/month). By
 *      answering with a long immutable cache header, Vercel's CDN stores the
 *      image, so every distinct photo hits Google at most ONCE — after that it
 *      is served from the edge for free. That is what makes swiping essentially
 *      free after the first pass.
 *
 * Photo resource names are stable, long-lived strings of the form
 * "places/{placeId}/photos/{photoId}", so caching them hard is safe.
 */

const HOST = "https://places.googleapis.com/v1";

// Clamp requested widths to a few sane sizes. An open `maxWidthPx` would let a
// caller mint unlimited distinct billable URLs; a small allow-list keeps the
// cache dense and the spend bounded.
const ALLOWED_WIDTHS = new Set([400, 800, 1200]);

/** A photo name must look exactly like Google's, or we don't call Google. */
function validName(name) {
  return typeof name === "string" && /^places\/[^/]+\/photos\/[^/]+$/.test(name);
}

/**
 * Framework-agnostic core. Fetches the image bytes once and returns them, so
 * the caller can cache them immutably. Streaming the bytes (rather than handing
 * back Google's temporary photoUri) means the cached copy never expires — the
 * one billed call happens here, and every later view is a CDN hit.
 */
export async function resolvePhoto(query, env = process.env) {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: 500, error: "GOOGLE_MAPS_API_KEY is not set" };

  const name = query?.name;
  if (!validName(name)) return { status: 400, error: "bad photo name" };

  const width = ALLOWED_WIDTHS.has(Number(query?.w)) ? Number(query.w) : 800;

  // No skipHttpRedirect: the media endpoint 302s to the image and fetch follows
  // it, so we receive the actual bytes. The single billed event is this call.
  const url = `${HOST}/${name}/media?maxWidthPx=${width}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    return { status: res.status === 404 ? 404 : 502, error: `photo ${res.status}` };
  }
  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const body = Buffer.from(await res.arrayBuffer());
  return { status: 200, contentType, body };
}
