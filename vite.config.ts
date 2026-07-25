import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Geolocation needs a secure context. localhost counts as secure, so plain
    // http works in dev — but only on localhost, not on a LAN IP.
    host: "localhost",
    port: 5173,
  },
});
