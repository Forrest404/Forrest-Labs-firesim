/**
 * Removes anything that could carry an API key from a message before it is shown or logged:
 * full URLs (Google tile URLs embed the key as a query parameter) and bare key=... fragments.
 * Pure, no Cesium import, so it is unit-tested in Node.
 */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\bkey=[^&\s'"]*/gi, 'key=<redacted>')
    .trim();
}
