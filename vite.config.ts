import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Serve the /api routes during `npm run dev`.
 *
 * Vite has no notion of serverless functions, so without this the discovery and
 * geocode calls 404 locally. Imports the same handlers the Vercel functions use,
 * so dev and production are not two code paths.
 */
const ROUTES = [
  { path: "/api/discover", module: "/api/discover.mjs", fn: "handleDiscover" },
  { path: "/api/geocode", module: "/api/geocode.mjs", fn: "handleGeocode" },
] as const;

function apiDev(env: Record<string, string>): Plugin {
  return {
    name: "chudly-api-dev",
    configureServer(server) {
      for (const route of ROUTES) {
        server.middlewares.use(route.path, async (req, res) => {
          if (req.method !== "POST") {
            res.statusCode = 405;
            res.end(JSON.stringify({ error: "POST only" }));
            return;
          }
          try {
            const chunks: Buffer[] = [];
            for await (const c of req) chunks.push(c as Buffer);
            const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");

            const mod = await server.ssrLoadModule(route.module);
            // Pass the loaded .env explicitly. Vite only exposes VITE_-prefixed
            // vars to the client and does not populate process.env server-side,
            // so the Google key has to be handed over here — which also keeps it
            // out of the browser bundle by construction.
            const out = await mod[route.fn](body, { ...process.env, ...env });

            res.statusCode = out.status;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify(out.body));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ error: String((err as Error)?.message ?? err) }));
          }
        });
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
  plugins: [react(), apiDev(env)],
  server: {
    // Geolocation needs a secure context. localhost counts as secure, so plain
    // http works — but only on localhost, not on a LAN IP. To test on a phone,
    // tunnel it (see README) rather than using http://192.168.x.x.
    host: "localhost",
    port: 5173,
  },
  build: { target: "es2022" },
  };
});
