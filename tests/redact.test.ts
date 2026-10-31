import { describe, expect, it } from 'vitest';
import { redact } from '../src/viewer/redact';

describe('redact', () => {
  it('removes full URLs, including any key or token query parameter', () => {
    // Placeholder host and value: real tile URLs embed credentials as query parameters this way.
    const msg = 'Request failed for https://tiles.example.invalid/root.json?access_token=NOT-A-REAL-TOKEN (403)';
    const out = redact(msg);
    expect(out).not.toContain('NOT-A-REAL-TOKEN');
    expect(out).not.toContain('example.invalid');
    expect(out).toBe('Request failed for <url> (403)');
  });

  it('removes bare key= and access_token= fragments without a URL', () => {
    expect(redact('bad request: key=NOT-A-REAL-KEY&session=1')).toBe('bad request: key=<redacted>&session=1');
    expect(redact('bad request: access_token=NOT-A-REAL-TOKEN')).toBe('bad request: access_token=<redacted>');
  });

  it('removes Bearer headers and JWT-shaped blobs', () => {
    expect(redact('Authorization: Bearer abc.def.ghi')).toBe('Authorization: Bearer <redacted>');
    const jwt = 'eyJ' + 'a'.repeat(12) + '.' + 'b'.repeat(12) + '.' + 'c'.repeat(12);
    expect(redact(`token was ${jwt} here`)).toBe('token was <jwt> here');
  });

  it('leaves ordinary messages alone', () => {
    expect(redact('Request has failed. Status Code: 403')).toBe('Request has failed. Status Code: 403');
  });
});
