/**
 * Vercel serverless entry. The logic lives in lib/discover.mjs, shared with the
 * Vite dev middleware — deliberately outside this directory, because Vercel
 * turns every file under api/ into its own function and a shared module has no
 * default export to serve.
 */
import { handleDiscover } from "../lib/discover.mjs";
import { authorized, DENIED } from "../lib/auth.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "POST only" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!authorized(body)) {
      res.status(DENIED.status).json(DENIED.body);
      return;
    }
    const { status, body: out } = await handleDiscover(body);
    res.status(status).json(out);
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err) });
  }
}
