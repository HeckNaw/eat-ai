/**
 * GET /api/photo?name=places/.../photos/...&w=800
 *
 * The one billed Place Photo call happens in resolvePhoto; the immutable cache
 * header then pins the bytes on Vercel's CDN, so each distinct photo bills once
 * and every later view is free. Unauthenticated on purpose — a photo is not a
 * secret, and gating it would defeat CDN caching. The spend is protected by the
 * width allow-list and the strict name check inside resolvePhoto.
 */
import { resolvePhoto } from "../lib/photo.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "GET only" });
    return;
  }
  try {
    const out = await resolvePhoto(req.query ?? {});
    if (out.status !== 200) {
      res.status(out.status).json({ error: out.error });
      return;
    }
    res.setHeader("content-type", out.contentType);
    res.setHeader("cache-control", "public, max-age=31536000, s-maxage=31536000, immutable");
    res.status(200).send(out.body);
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
