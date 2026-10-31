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

  it('masks a standalone 32-hex token (FIRMS MAP_KEY shape)', () => {
    const fake = '0123456789abcdef0123456789abcdef';
    expect(redact(`rejected ${fake}`)).toBe('rejected <key>');
    expect(redact(`path /api/area/csv/${fake}/VIIRS_SNPP_NRT/world/1`)).toBe('path /api/area/csv/<key>/VIIRS_SNPP_NRT/world/1');
    expect(redact(`MAP_KEY:${fake}.`)).toBe('MAP_KEY:<key>.');
    expect(redact(fake)).toBe('<key>');
  });

  it('leaves longer hex runs (git SHAs, sha256) alone', () => {
    const sha = '2db06ea1f3b43c4cb04567d9be40b644abcdef01';
    expect(redact(`commit ${sha}`)).toBe(`commit ${sha}`);
    const sha256 = '106a07df4516a9fb583953a742c084f4b373a3b8c5b19650caf68946881d3e02';
    expect(redact(sha256)).toBe(sha256);
  });

  it('leaves ordinary messages alone', () => {
    expect(redact('Request has failed. Status Code: 403')).toBe('Request has failed. Status Code: 403');
  });
});
