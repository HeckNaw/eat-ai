/**
 * Passcode check. Costs nothing — it touches no external API — so the client
 * can call it on every boot to find out whether it is already unlocked.
 */
import { handleAuth } from "../lib/auth.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { status, body: out } = handleAuth(body ?? {});
    res.status(status).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
