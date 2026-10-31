import { describe, expect, it } from 'vitest';
import { redact } from '../src/viewer/redact';

describe('redact', () => {
  it('removes full URLs, including any key query parameter', () => {
    // Placeholder host and value: real tile URLs embed the key as ?key=... in the same way.
    const msg = 'Request failed for https://tiles.example.invalid/root.json?key=NOT-A-REAL-KEY (403)';
    const out = redact(msg);
    expect(out).not.toContain('NOT-A-REAL-KEY');
    expect(out).not.toContain('example.invalid');
    expect(out).toBe('Request failed for <url> (403)');
  });

  it('removes bare key= fragments without a URL', () => {
    expect(redact('bad request: key=NOT-A-REAL-KEY&session=1')).toBe('bad request: key=<redacted>&session=1');
  });

  it('leaves ordinary messages alone', () => {
    expect(redact('Request has failed. Status Code: 403')).toBe('Request has failed. Status Code: 403');
  });
});
