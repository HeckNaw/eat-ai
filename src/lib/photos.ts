/**
 * Client URL for a Google photo resource name, served through our caching proxy.
 *
 * Entries arrive as "places/{placeId}/photos/{photoId}~{signature}". The
 * signature proves the server minted this name, which is what lets /api/photo
 * stay open to <img> tags without being an open tap on the Google bill. We only
 * carry it across — only the server can produce or check one. A bare name with
 * no "~" is an unsigned local dev build, where the proxy doesn't check.
 */
export function photoUrl(entry: string, width: 400 | 800 | 1200 = 800): string {
  const cut = entry.lastIndexOf("~");
  const name = cut === -1 ? entry : entry.slice(0, cut);
  const sig = cut === -1 ? "" : entry.slice(cut + 1);
  return (
    `/api/photo?name=${encodeURIComponent(name)}&w=${width}` +
    (sig ? `&s=${encodeURIComponent(sig)}` : "")
  );
}
