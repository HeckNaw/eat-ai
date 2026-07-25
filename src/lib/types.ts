/** Packed opening period: [openDay, openMinuteOfDay, closeDay, closeMinuteOfDay]. -1 close = 24h. */
export type Period = [number, number, number, number];

/** A place as it arrives from public/places.json — short keys to keep the payload small. */
export interface Place {
  i: string;              // Google placeId
  n: string;              // name
  a: string | null;       // short address
  y: number;              // lat
  x: number;              // lng
  c: string | null;       // primary cuisine
  cs: string[] | null;    // every cuisine matched
  f: string | null;       // cuisine family
  at: string[] | null;    // attributes
  r: number | null;       // rating
  rc: number | null;      // review count
  p: string | null;       // priceLevel, PRICE_LEVEL_ prefix stripped
  pe: string | null;      // estimated price band
  h: Period[] | null;     // opening hours
  tz: number | null;      // utcOffsetMinutes
  u: string | null;       // Google Maps URL
  l: string;              // which list it came from (provenance only)
  tmp?: true;             // temporarily closed
  onList?: boolean;       // set true for saved places, false for discoveries
}

export interface Taste {
  cuisineAffinity: Record<string, number>;
  familyAffinity: Record<string, number>;
  attributeAffinity: Record<string, number>;
  clusters: [number, number, number][]; // lat, lng, count
  areas: Area[];                        // named clusters, for the location fallback
  hierarchy: Record<Mode, Family[]>;
  chips: Record<"savoury" | "sweet", Chip[]>;
  defaultSearchTypes: Record<"savoury" | "sweet", string[]>;
}

export interface Area {
  lat: number;
  lng: number;
  count: number;
  name: string;
  topCuisines: string[];
}

export type Mode = "savoury" | "sweet" | "retail" | "either";

export interface Family {
  family: string;
  count: number;
  styles: { cuisine: string; count: number; weight: number; googleTypes: string[] }[];
}

export interface Chip {
  cuisine: string;
  count: number;
  family: string | null;
  googleTypes: string[];
}

export interface Coords { lat: number; lng: number }

export interface Answers {
  mode: "savoury" | "sweet" | "either";
  when: "now" | "hour" | { at: string };
  radiusM: number;
  cuisines: string[];
}

export type OpenState = "open" | "soon" | "shut" | "unknown";

export interface Scored {
  place: Place;
  distanceM: number;
  open: OpenState;
  closesInMin: number | null;
  score: number;
  why: string;
}
