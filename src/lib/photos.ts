/** Client URL for a Google photo resource name, served through our caching proxy. */
export function photoUrl(name: string, width: 400 | 800 | 1200 = 800): string {
  return `/api/photo?name=${encodeURIComponent(name)}&w=${width}`;
}
