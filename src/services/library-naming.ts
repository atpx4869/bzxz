// 库文件名模板引擎（Phase 2 of 预览功能）
//
// 把 admin 配置的 library_filename_pattern 渲染成实际文件名。
//
// 支持的占位符：
//   {stdCode}  必填，由 PUT /settings 的 z.refine 校验保证
//   {source}   源标签（BW/BZ/BY），不是 canonical（gbw/bz/by）
//   {year}     4 位年份；缺失时整段连同前后空格 / 分隔符一起删（避免出现 "GB - .pdf"）
//   {title}    标准标题；缺失时同 {year} 处理
//
// 设计要点：
// - 不带 `.pdf` 扩展名（永远是 PDF，调用方加）
// - 非法字符 \ : * ? " < > | 全部剔除（Windows 文件名约束最严，全平台兼容）
//   注意：空格、连字符、中文标点都是合法字符，必须保留 —— 不然 "GB 3324-2024"
//   会被削成 "GB33242024" 反向语义损失
// - `/` 单独替换成 `_` 而非删除，保留 GB/T、GB_T 这种结构信息
// - 占位符内部空白折叠 + trim
// - 总长度限 200 字符（NTFS 255 - 留 buffer 给 ".pdf" 与去重后缀）
// - 缺失字段的占位符的"周围"分隔符也要清理：例如 pattern
//   `{stdCode} - {year} - {source}` 在 year 缺失时变成 `GB 3324 - BW`，
//   而不是 `GB 3324 -  - BW`。
//
// 安全：渲染产物在写入前由调用方再过一遍 path.basename，杜绝任何路径分隔符。

import type { SourceName } from '../domain/standard';

interface Context {
  stdCode: string;
  source: SourceName;
  year?: string;
  title?: string;
}

const SOURCE_LABELS: Record<SourceName, string> = {
  gbw: 'BW',
  bz: 'BZ',
  by: 'BY',
  labr: 'LB',
};

const MAX_BASENAME_LEN = 200;
const ILLEGAL_CHARS = /[\\:*?"<>|]/g;

function sanitizeSegment(s: string): string {
  return s
    .replace(/\//g, '_')
    .replace(ILLEGAL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 渲染模板。pattern 不带扩展名，调用方拼 .pdf。
 *
 * 行为：
 * - {stdCode} 必填且不为空，否则抛 Error
 * - 其它占位符为空时，会把"占位符 + 与相邻字符之间的分隔符（空格/连字符/下划线）"一起删
 * - 模板里出现的未知占位符（如 {foo}）按字面量保留，方便用户后期写自定义元数据
 */
export function renderLibraryFilename(pattern: string, ctx: Context): string {
  const stdCode = sanitizeSegment(ctx.stdCode || '');
  if (!stdCode) throw new Error('renderLibraryFilename: stdCode 不能为空');

  const values: Record<string, string> = {
    stdCode,
    source: SOURCE_LABELS[ctx.source] || ctx.source.toUpperCase(),
    year: sanitizeSegment(ctx.year || ''),
    title: sanitizeSegment(ctx.title || ''),
  };

  // 处理空占位符及其相邻分隔符。例如：
  //   pattern  = "{a} - {b} - {c}"   b 为空 → "{a} - {c}"
  //   pattern  = "{a}_{b}_{c}"       b 为空 → "{a}_{c}"
  //
  // 实现：对每个空字段，匹配 (前导分隔符)?{key}(后随分隔符)? 一并删除。
  // 分隔符集合：空格、`-`、`_`、`·`、`—`
  let result = pattern;
  const SEP = String.raw`[\s\-_·—]*`;
  for (const [key, val] of Object.entries(values)) {
    const tokenRe = new RegExp(`${SEP}\\{${key}\\}${SEP}`, 'g');
    if (!val) {
      result = result.replace(tokenRe, (match, offset, str) => {
        const atStart = offset === 0;
        const atEnd = offset + match.length === str.length;
        if (atStart || atEnd) return '';
        const left = match.match(new RegExp(`^${SEP}`))?.[0] || '';
        const right = match.match(new RegExp(`${SEP}$`))?.[0] || '';
        return left || right || ' ';
      });
    } else {
      result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), val);
    }
  }

  // 收尾：去重空白、剔除非法字符（防 pattern 字面量里写了 `:`）
  let final = result.replace(ILLEGAL_CHARS, '').replace(/\s+/g, ' ').trim();
  // 防止 pattern 写成 "{stdCode}." 留下尾点（Windows 末尾点会被吞）
  final = final.replace(/[.\s]+$/, '');

  if (final.length === 0) {
    // 极端情况：所有字段都空 + pattern 全是占位符 → fallback 到 stdCode + source
    final = `${stdCode} - ${values.source}`;
  }

  if (final.length > MAX_BASENAME_LEN) {
    final = final.slice(0, MAX_BASENAME_LEN).trim();
  }

  return final;
}

/**
 * 渲染并加 `.pdf` 扩展名。
 */
export function renderLibraryFilenameWithExt(pattern: string, ctx: Context): string {
  return `${renderLibraryFilename(pattern, ctx)}.pdf`;
}
