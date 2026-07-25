/**
 * Off-list discovery. Framework-agnostic handler used by both the Vite dev
 * middleware and the Vercel function, so dev and production run identical code.
 *
 * Lives server-side for one reason: the Google key must never reach the browser.
 * It also means the lexicon stays on the server, so the client payload doesn't
 * have to carry it.
 */

import { labelPlacesResult } from "../scripts/lib/labeller.mjs";

const ENDPOINT = "https://places.googleapis.com/v1/places:searchNearby";

// The same mask enrich.mjs used, which is what makes off-list candidates
// structurally identical to saved ones.
const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.shortFormattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.priceLevel",
  "places.rating",
  "places.userRatingCount",
  "places.regularOpeningHours",
  "places.utcOffsetMinutes",
  "places.editorialSummary",
  "places.businessStatus",
  "places.googleMapsUri",
].join(",");

/** Repack into the same short-key shape public/places.json uses. */
function packHours(periods) {
  if (!periods?.length) return null;
  const out = [];
  for (const p of periods) {
    if (p.open?.day == null) continue;
    const od = p.open.day;
    const om = (p.open.hour ?? 0) * 60 + (p.open.minute ?? 0);
    if (p.close?.day == null) { out.push([od, om, -1, -1]); continue; }
    out.push([od, om, p.close.day, (p.close.hour ?? 0) * 60 + (p.close.minute ?? 0)]);
  }
  return out.length ? out : null;
}

function compact(labelled) {
  return {
    i: labelled.placeId,
    n: labelled.name,
    a: labelled.address,
    y: labelled.lat,
    x: labelled.lng,
    c: labelled.cuisine,
    cs: labelled.cuisines?.length ? labelled.cuisines : null,
    f: labelled.cuisineFamily,
    at: labelled.attributes?.length ? labelled.attributes : null,
    r: labelled.rating,
    rc: labelled.reviewCount,
    p: labelled.priceLevel ? labelled.priceLevel.replace("PRICE_LEVEL_", "") : null,
    pe: labelled.priceEstimate?.band ? labelled.priceEstimate.band.replace("PRICE_LEVEL_", "") : null,
    h: packHours(labelled.openingHours),
    tz: labelled.utcOffsetMinutes,
    u: labelled.googleMapsUri,
    l: "new",
    onList: false,
  };
}

export async function handleDiscover(body, env = process.env) {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: 500, body: { error: "GOOGLE_MAPS_API_KEY is not set" } };

  const { lat, lng, radius = 5000, includedPrimaryTypes = [], exclude = [] } = body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { status: 400, body: { error: "lat and lng are required" } };
  }

  const payload = {
    locationRestriction: {
      circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radius, 50_000) },
    },
    maxResultCount: 20,
    // DISTANCE, not the default POPULARITY. Prominence ranking returns the
    // chains and patio spots that years of saving nothing already rejected.
    rankPreference: "DISTANCE",
    languageCode: "en",
    regionCode: "CA",
  };
  if (includedPrimaryTypes.length) payload.includedPrimaryTypes = includedPrimaryTypes.slice(0, 50);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    return { status: 502, body: { error: `Places API ${res.status}`, detail: await res.text() } };
  }

  const skip = new Set(exclude);
  const places = (await res.json()).places ?? [];

  return {
    status: 200,
    body: {
      // Exact dedup on placeId — both sides carry it, so "new" really is new.
      places: places
        .filter((r) => !skip.has(r.id))
        .filter((r) => r.businessStatus !== "CLOSED_PERMANENTLY")
        .map((r) => compact(labelPlacesResult(r))),
      fetched: places.length,
    },
  };
}
