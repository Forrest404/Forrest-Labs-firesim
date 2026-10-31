/**
 * Removes anything that could carry an API key from a message before it is shown or logged:
 * full URLs (Google tile URLs embed the key as a query parameter), bare key=... fragments, and
 * standalone 32-hex tokens (the NASA FIRMS MAP_KEY travels as a URL path segment).
 * Pure, no Cesium import, so it is unit-tested in Node.
 */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\bkey=[^&\s'"]*/gi, 'key=<redacted>')
    // Exactly 32 hex chars bounded by a separator: longer hex runs (git SHAs, sha256) stay.
    .replace(/(^|[/\s(:])[0-9a-f]{32}(?=[/\s)?,.]|$)/gi, '$1<key>')
    .trim();
}
