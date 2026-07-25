import type { Coords } from "./types";

const R = 6_371_000;

/** Great-circle distance in metres. */
export function distanceM(a: Coords, b: Coords): number {
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = φ2 - φ1;
  const dλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 950) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(m < 9500 ? 1 : 0)}km`;
}

export type PermissionState = "unknown" | "granted" | "denied" | "prompt";

/**
 * Read the permission state WITHOUT triggering the browser prompt, so the app can
 * explain why it needs location before asking. A cold prompt gets denied.
 */
export async function peekPermission(): Promise<PermissionState> {
  if (!("geolocation" in navigator)) return "denied";
  if (!navigator.permissions?.query) return "unknown";
  try {
    const s = await navigator.permissions.query({ name: "geolocation" as PermissionName });
    return s.state as PermissionState;
  } catch {
    return "unknown";
  }
}

export function getPosition(): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("This browser can't share your location."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      (err) => {
        const msg =
          err.code === err.PERMISSION_DENIED
            ? "Location was blocked. You can type a neighbourhood instead."
            : err.code === err.TIMEOUT
              ? "Locating took too long. Try again, or type a neighbourhood."
              : "Couldn't get your location. Try typing a neighbourhood.";
        reject(new Error(msg));
      },
      { enableHighAccuracy: false, timeout: 9_000, maximumAge: 120_000 },
    );
  });
}
