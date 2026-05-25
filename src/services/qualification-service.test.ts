import { describe, expect, it } from 'vitest';

import { extractBaseCode } from './qualification-service';

describe('extractBaseCode', () => {
  it('strips type designator and year suffix on clean input', () => {
    expect(extractBaseCode('GB/T 23440-2009')).toBe('GB23440');
  });

  it('handles stray space before the year dash (CNAS scraper variant)', () => {
    // Real-world: CNAS DB stores 'GB/T 3325 -2024'.
    expect(extractBaseCode('GB/T 3325 -2024')).toBe('GB3325');
  });

  it('handles trailing whitespace after the year', () => {
    expect(extractBaseCode('GB/T 3325-2024 ')).toBe('GB3325');
  });

  it('produces the same base for clean and stray-space variants (cross-source match)', () => {
    expect(extractBaseCode('GB/T 3325-2024')).toBe(extractBaseCode('GB/T 3325 -2024'));
  });

  it('strips type designator even when no whitespace follows (regression: lookahead bug)', () => {
    // Previous regex used (?=\s) lookahead and would leave the /T in place for clean variants,
    // so 'GB/T 3325-2024' became 'GB/T3325' instead of 'GB3325'.
    expect(extractBaseCode('GB/T 3325-2024')).toBe('GB3325');
  });

  it('handles type designators other than T', () => {
    expect(extractBaseCode('GBZ/T 188-2014')).toBe('GBZ188');
    expect(extractBaseCode('YY/T 0316-2016')).toBe('YY0316');
  });

  it('passes through codes without type designator', () => {
    expect(extractBaseCode('GB 5749-2022')).toBe('GB5749');
  });

  it('uppercases lowercase input', () => {
    expect(extractBaseCode('gb/t 3325-2024')).toBe('GB3325');
  });
});
