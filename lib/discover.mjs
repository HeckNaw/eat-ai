/**
 * Off-list discovery. Framework-agnostic handler used by both the Vite dev
 * middleware and the Vercel function, so dev and production run identical code.
 *
 * Lives server-side for one reason: the Google key must never reach the browser.
 * It also means the lexicon stays on the server, so the client payload doesn't
 * have to carry it.
 */

import { labelPlacesResult } from "../scripts/lib/labeller.mjs";
import { isCorporateChain } from "../scripts/lib/chains.mjs";

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
  // Photo resource names come free with this call (photos is a Pro field, the
  // mask is already Enterprise). The images themselves are fetched on demand.
  "places.photos",
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
    co: isCorporateChain(labelled.name) || undefined,
    ph: labelled.photos?.length ? labelled.photos : undefined,
    onList: false,
  };
}

/**
 * Types Places will happily return on a place record but rejects as a Nearby
 * Search filter, with `400 Unsupported types` — and it rejects the *whole*
 * request, not just the offending entry. One bad type in a list of thirty kills
 * the entire search.
 *
 * They stay in lexicon.json deliberately: they are perfectly valid for
 * labelling results that come back. The restriction is on searching, so it is
 * enforced here, at the boundary where it applies.
 *
 * Discovered by submitting all 99 types the lexicon can emit, in two batches,
 * and reading the offenders out of the error. Both default sets were poisoned —
 * jamaican_restaurant in savoury, bubble_tea_store in sweet — which meant an
 * unfiltered "Feed me" failed every time in both modes.
 */
const NOT_SEARCHABLE = new Set([
  "bubble_tea_store",
  "canadian_restaurant",
  "georgian_restaurant",
  "ghanaian_restaurant",
  "jamaican_restaurant",
  "laotian_restaurant",
  "nepalese_restaurant",
  "nigerian_restaurant",
  "poke_restaurant",
  "salvadoran_restaurant",
  "singaporean_restaurant",
  "venezuelan_restaurant",
]);

/**
 * The floor when filtering leaves nothing to search for.
 *
 * Sending no `includedPrimaryTypes` is not "a wider food search" — it is not a
 * food search at all. An unrestricted Nearby Search downtown returns estate
 * agents and phone-case shops, verified. So a query that loses all its types
 * falls back to the food umbrella rather than to nothing.
 */
const FOOD_FLOOR = ["restaurant", "cafe", "bakery"];

/** Pull the offending types out of a 400 so a new one can be retried away. */
function unsupportedFrom(detail) {
  const match = /Unsupported types:\s*([^."]+)/.exec(detail ?? "");
  return match ? match[1].split(",").map((t) => t.trim()).filter(Boolean) : [];
}

export async function handleDiscover(body, env = process.env) {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: 500, body: { error: "GOOGLE_MAPS_API_KEY is not set" } };

  const { lat, lng, radius = 5000, includedPrimaryTypes = [], exclude = [] } = body ?? {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return { status: 400, body: { error: "lat and lng are required" } };
  }

  const base = {
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

  const asked = includedPrimaryTypes.filter((t) => !NOT_SEARCHABLE.has(t)).slice(0, 50);
  let types = asked.length ? asked : FOOD_FLOOR;

  const call = (t) =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({ ...base, includedPrimaryTypes: t.length ? t : FOOD_FLOOR }),
    });

  let res = await call(types);

  // Self-healing: Google's supported list changes, and the set above will drift.
  // Rather than fail until someone redeploys, read the offenders out of the
  // rejection and retry once without them. Costs one extra call, and only when
  // a genuinely new type appears.
  if (!res.ok && res.status === 400 && types.length) {
    const detail = await res.text();
    const offenders = unsupportedFrom(detail);
    if (offenders.length) {
      types = types.filter((t) => !offenders.includes(t));
      res = await call(types);
    } else {
      return { status: 502, body: { error: "Places API 400", detail } };
    }
  }

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
