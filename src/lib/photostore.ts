/**
 * Photo resource names, loaded lazily.
 *
 * The names are ~1.7MB — too heavy to sit in the boot payload, and not needed
 * until the swipe deck appears. This fetches them once, in the background, so
 * the app boots on the lean places.json and photos stream in behind skeletons.
 * Off-list places carry their own names inline (from the discovery response),
 * so this map only has to cover the saved list.
 */

type PhotoMap = Record<string, string[]>;

let promise: Promise<PhotoMap> | null = null;

/** Kick off (or reuse) the one background load. Safe to call repeatedly. */
export function loadPhotos(): Promise<PhotoMap> {
  if (!promise) {
    promise = fetch("/photos.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}) as PhotoMap);
  }
  return promise;
}
