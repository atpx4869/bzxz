import { describe, expect, it } from 'vitest';

import {
  extractTokenFromHtml,
  inferStandclass,
  mergeCookies,
  stripHighlightTags,
} from './spc-client';

// 协议层网络方法（searchByKeyword / getReaderToken / downloadPdf）走 spc-adapter 的
// live integration test，本文件只覆盖纯函数解析层，回归点：
// 1. stripHighlightTags 把 queryfocus 的 <font> / <mark> 高亮剥干净
// 2. inferStandclass 对常见前缀映射正确（CN / ISO / GW）
// 3. extractTokenFromHtml 从 stdonline HTML 里抠 var rc = "..." 时不被其它 var 干扰
// 4. mergeCookies 后者覆盖前者同 key

describe('stripHighlightTags — 剥 spc queryfocus 高亮', () => {
  it('剥 <font color="red"> 标签', () => {
    expect(stripHighlightTags(`<font color='red'>185</font>84-2024`)).toBe('18584-2024');
  });
  it('剥多个 <font> + 大小写不敏感', () => {
    expect(stripHighlightTags(`<FONT color='red'>GB</FONT> <font>3325</font>-2024`)).toBe('GB 3325-2024');
  });
  it('剥 <mark> 兜底', () => {
    expect(stripHighlightTags('<mark>ISO</mark> 4287')).toBe('ISO 4287');
  });
  it('无标签原样返回', () => {
    expect(stripHighlightTags('GB 18584-2024')).toBe('GB 18584-2024');
  });
  it('空串安全', () => {
    expect(stripHighlightTags('')).toBe('');
  });
});

describe('inferStandclass — 从 a100 前缀映射 standclass', () => {
  it('GB / GB/T → CN', () => {
    expect(inferStandclass('GB 18584-2024')).toBe('CN');
    expect(inferStandclass('GB/T 3325-2024')).toBe('CN');
  });
  it('JJF / JJG → CN', () => {
    expect(inferStandclass('JJF 1001-2011')).toBe('CN');
    expect(inferStandclass('JJG 99-2022')).toBe('CN');
  });
  it('DB / 行标 → CN', () => {
    expect(inferStandclass('DB11/T 1234-2020')).toBe('CN');
    expect(inferStandclass('HG/T 2020-2018')).toBe('CN');
  });
  it('ISO / IEC → ISO', () => {
    expect(inferStandclass('ISO 9001:2015')).toBe('ISO');
    expect(inferStandclass('IEC 60068-1')).toBe('ISO');
    expect(inferStandclass('ISO/IEC 27001')).toBe('ISO');
  });
  it('ASTM / BS / DIN / ANSI / JIS / NF / EN → GW', () => {
    expect(inferStandclass('ASTM D638-14')).toBe('GW');
    expect(inferStandclass('BS EN 12345')).toBe('GW');
    expect(inferStandclass('DIN 50125')).toBe('GW');
    expect(inferStandclass('ANSI Z21.1')).toBe('GW');
    expect(inferStandclass('JIS B 0101')).toBe('GW');
    expect(inferStandclass('EN 13501-1')).toBe('GW');
  });
  it('未知前缀默认 CN', () => {
    expect(inferStandclass('XXX 999')).toBe('CN');
    expect(inferStandclass('')).toBe('CN');
  });
});

describe('extractTokenFromHtml — 抠 var rc', () => {
  it('单 var rc 命中', () => {
    const html = `<script>var rc = "WmNrMGh5NDMyMA==";var other = "ignore";</script>`;
    expect(extractTokenFromHtml(html)).toBe('WmNrMGh5NDMyMA==');
  });
  it('多 var 中 rc 仍能精确命中', () => {
    const html = `var a = "x"; var bc = "y"; var rc = "TARGET"; var rcx = "noise";`;
    expect(extractTokenFromHtml(html)).toBe('TARGET');
  });
  it('找不到 var rc 返回空串', () => {
    expect(extractTokenFromHtml('<html>no token here</html>')).toBe('');
  });
  it('空 html 安全', () => {
    expect(extractTokenFromHtml('')).toBe('');
  });
  it('token 含特殊 base64 字符 (= + /)', () => {
    const html = `var rc = "abc+def/ghi==";`;
    expect(extractTokenFromHtml(html)).toBe('abc+def/ghi==');
  });
});

describe('mergeCookies — 后者覆盖同 key', () => {
  it('合并不同 key', () => {
    expect(mergeCookies('A=1', 'B=2')).toBe('A=1; B=2');
  });
  it('后者覆盖前者同 key', () => {
    expect(mergeCookies('JSESSIONID=old; X=1', 'JSESSIONID=new')).toContain('JSESSIONID=new');
    expect(mergeCookies('JSESSIONID=old; X=1', 'JSESSIONID=new')).toContain('X=1');
  });
  it('空 incoming 返回 existing', () => {
    expect(mergeCookies('A=1', '')).toBe('A=1');
  });
  it('空 existing 返回 incoming', () => {
    expect(mergeCookies('', 'B=2')).toBe('B=2');
  });
});
