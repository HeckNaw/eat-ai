/** Vercel serverless entry. Logic lives in geocode.mjs, shared with dev. */
import { handleGeocode } from "./geocode.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { status, body: out } = await handleGeocode(body);
    res.status(status).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
