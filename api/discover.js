/** Vercel serverless entry. The logic lives in discover.mjs, shared with dev. */
import { handleDiscover } from "./discover.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { status, body: out } = await handleDiscover(body);
    res.status(status).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
