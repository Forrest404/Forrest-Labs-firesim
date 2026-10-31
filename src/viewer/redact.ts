/**
 * Removes anything that could carry a credential from a message before it is shown or logged:
 * full URLs (tile URLs embed keys or tokens as query parameters), key=... / access_token=...
 * fragments, Bearer headers and JWT-looking blobs. Pure, no Cesium import, unit-tested in Node.
 */
export function redact(text: string): string {
  return text
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/\b(key|access_token|token)=[^&\s'"]*/gi, '$1=<redacted>')
    .replace(/\bBearer\s+\S+/gi, 'Bearer <redacted>')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<jwt>')
    .trim();
}
