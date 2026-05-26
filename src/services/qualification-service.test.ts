import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { QualificationService, buildFuzzyLikePattern, extractBaseCode } from './qualification-service';

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

describe('buildFuzzyLikePattern', () => {
  it('splits clean base into prefix%digits% (the core selectivity boost)', () => {
    // 'GB/T 3325-2024' → base 'GB3325' → 'GB%3325%'
    // CNAS 表里 GB 前缀有几万条，加上 3325 数字过滤就收敛到几十条 —— LIMIT 截断不再丢命中行。
    expect(buildFuzzyLikePattern('GB3325')).toBe('GB%3325%');
  });

  it('handles multi-letter prefixes (GBZ, YY, etc.)', () => {
    expect(buildFuzzyLikePattern('GBZ188')).toBe('GBZ%188%');
    expect(buildFuzzyLikePattern('YY0316')).toBe('YY%0316%');
  });

  it('falls back to prefix-only LIKE when base has no digit tail', () => {
    expect(buildFuzzyLikePattern('GB')).toBe('GB%');
  });

  it('returns null for non-letter prefix (regex guard)', () => {
    expect(buildFuzzyLikePattern('123ABC')).toBeNull();
    expect(buildFuzzyLikePattern('')).toBeNull();
  });

  it('returns null when prefix exceeds the 8-char safety cap', () => {
    // 防止恶意/异常输入把 LIKE prefix 撑大、变成全表扫描的 DoS 向量
    expect(buildFuzzyLikePattern('ABCDEFGHI123')).toBeNull();
  });

  it('strips SQL wildcard characters from the digit tail', () => {
    // base 通常已经经过 extractBaseCode 清洗，但这里再做一道防线 —— 万一上游漏了
    // % / _ 不会被原样拼进 LIKE 扩成全表扫描
    expect(buildFuzzyLikePattern('GB33%25')).toBe('GB%3325%');
    expect(buildFuzzyLikePattern('GB33_25')).toBe('GB%3325%');
  });

  it('caps the digit tail to 16 characters', () => {
    const longTail = '12345678901234567890';
    const result = buildFuzzyLikePattern(`GB${longTail}`);
    expect(result).toBe('GB%1234567890123456%');
  });
});

// Helper: tiny in-memory schema covering only what queryByStdCodes touches.
// We don't need the full migration here — just the SELECT/WHERE surface.
function makeTestDb() {
  const db = new BetterSqlite3(':memory:');
  db.exec(`
    CREATE TABLE cnas_qualifications (
      lab_no TEXT, std_code TEXT, std_name TEXT,
      effective_date TEXT, expiry_date TEXT, category TEXT,
      test_object TEXT, test_param TEXT, test_standard TEXT, limit_desc TEXT
    );
    CREATE TABLE cnas_labs (lab_no TEXT, lab_name TEXT);
    CREATE TABLE cma_qualifications (
      cert_number TEXT, std_code TEXT, std_name TEXT,
      effective_date TEXT, expiry_date TEXT, category TEXT,
      test_item TEXT, test_standard TEXT, limit_desc TEXT
    );
    CREATE TABLE cma_labs (cert_number TEXT, lab_name TEXT);
    CREATE TABLE qualification_lab_links (
      display_name TEXT, cnas_lab_no TEXT, cma_cert_number TEXT
    );
  `);
  return db;
}

describe('queryByStdCodes Phase 2 fuzzy fallback (regression)', () => {
  it('finds GB/T 3325-2024 even when CNAS table has thousands of GB rows ahead of it', () => {
    // Repro for the Layer-4 bug: prefix-only LIKE 'GB%' + LIMIT 500 dropped the
    // target row when there were many earlier GB rows. The fix uses
    // 'GB%3325%' instead — selectivity goes 100× tighter so LIMIT no longer bites.
    const db = makeTestDb();
    db.prepare("INSERT INTO cnas_labs (lab_no, lab_name) VALUES ('LAB001', 'Test Lab')").run();
    // Seed 800 unrelated GB rows that would all match 'GB%' but not 'GB%3325%'
    const insertNoise = db.prepare(`
      INSERT INTO cnas_qualifications (lab_no, std_code, std_name, effective_date, expiry_date, category, test_object, test_param, test_standard, limit_desc)
      VALUES ('LAB001', ?, '', '', '', '', '', '', '', '')
    `);
    for (let i = 0; i < 800; i++) {
      insertNoise.run(`GB/T ${10000 + i}-2020`);
    }
    // Target row with CNAS-scraper stray-space variant
    insertNoise.run('GB/T 3325 -2024');

    const svc = new QualificationService(db as any);
    const result = svc.queryByStdCodes(['GB/T 3325-2024']);

    expect(result['GB/T 3325-2024']).toBeDefined();
    expect(result['GB/T 3325-2024'].length).toBeGreaterThanOrEqual(1);
    expect(result['GB/T 3325-2024'][0].source).toBe('CNAS');
    db.close();
  });
});
