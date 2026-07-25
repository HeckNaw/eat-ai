/**
 * Turn a typed address, intersection or place name into coordinates.
 *
 * Uses Places Text Search rather than the Geocoding API — that keeps everything
 * on the one API already enabled, and the field mask here is deliberately tiny
 * (id, name, address, location) so it bills at the cheapest Text Search tier
 * instead of the Enterprise tier the enrichment run needed.
 *
 * Returns several candidates rather than assuming the first is right: "Dundas"
 * matches a dozen things in Toronto and the user should pick.
 */

const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
].join(",");

export async function handleGeocode(body, env = process.env) {
  const apiKey = env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) return { status: 500, body: { error: "GOOGLE_MAPS_API_KEY is not set" } };

  const query = (body?.query ?? "").trim();
  if (query.length < 3) return { status: 400, body: { error: "Type at least 3 characters" } };

  // Bias toward where the user usually is, so "Dundas & Ossington" resolves
  // locally instead of somewhere else on the continent. Not a restriction — a
  // full address elsewhere still wins.
  const bias =
    typeof body?.lat === "number" && typeof body?.lng === "number"
      ? { circle: { center: { latitude: body.lat, longitude: body.lng }, radius: 50_000 } }
      : {
          circle: {
            center: {
              latitude: Number(env.HOME_LAT ?? 43.6532),
              longitude: Number(env.HOME_LNG ?? -79.3832),
            },
            radius: 50_000,
          },
        };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 6,
      languageCode: "en",
      regionCode: "CA",
      locationBias: bias,
    }),
  });

  if (!res.ok) {
    return { status: 502, body: { error: `Places API ${res.status}`, detail: await res.text() } };
  }

  const places = (await res.json()).places ?? [];
  return {
    status: 200,
    body: {
      results: places
        .filter((p) => p.location?.latitude != null)
        .map((p) => ({
          id: p.id,
          name: p.displayName?.text ?? query,
          address: p.formattedAddress ?? null,
          lat: p.location.latitude,
          lng: p.location.longitude,
        })),
    },
  };
}
