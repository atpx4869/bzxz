import type { SourceName, StandardSummary } from '../domain/standard';
import { StandardService } from './standard-service';
import type { SourceRegistry } from './source-registry';

export interface ResolvedItem {
  input: string;
  standardId: string;
  standardNumber: string;
  title: string;
  source: SourceName;
  status?: string;
  publishDate?: string | null;
  implementDate?: string | null;
  abolishedDate?: string | null;   // 废止日期（BZ 有，GBW 恒 null）
  replacedStd?: string | null;     // 被代替关系（仅 BZ meta.replacedStd 可靠）
}

export interface UnmatchedItem {
  input: string;
  reason: string;
}

export interface ResolveResult {
  resolved: ResolvedItem[];
  unmatched: UnmatchedItem[];
}

interface ParsedNumber {
  prefix: string;
  number: string;
  yearCode: string | null;
  raw: string;
}

const STD_REGEX = /^\s*([A-Z]{2,4}(?:\d{2})?(?:\/[TZQ])?)\s*(\d+(?:\.\d+)*)\s*(?:[–\-—]?\s*(?:(\d{4}))?)\s*$/i;

function parseStandardNumber(line: string): ParsedNumber | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const m = trimmed.match(STD_REGEX);
  if (!m) return null;

  return {
    prefix: m[1].toUpperCase(),
    number: m[2],
    yearCode: m[3] || null,
    raw: trimmed,
  };
}

const STATUS_ACTIVE = new Set(['现行有效', '即将实施']);
const RESOLVE_CONCURRENCY = 6;

export class StandardResolver {
  constructor(private readonly registry: SourceRegistry) {}

  async resolve(lines: string[], sources: SourceName[]): Promise<ResolveResult> {
    const resolved: ResolvedItem[] = [];
    const unmatched: UnmatchedItem[] = [];

    const parsedList = lines.map((line) => ({
      line: line.trim(),
      parsed: parseStandardNumber(line),
    }));

    const tasks = new Map<string, { parsed: ParsedNumber; promise?: Promise<ResolvedItem | null> }>();
    const taskKeys: (string | null)[] = [];

    for (const { line, parsed } of parsedList) {
      if (!line || !parsed) {
        taskKeys.push(null);
        continue;
      }

      const key = this.resolveCacheKey(parsed, sources);
      if (!tasks.has(key)) tasks.set(key, { parsed });
      taskKeys.push(key);
    }

    await mapLimit([...tasks.entries()], RESOLVE_CONCURRENCY, async ([_key, task]) => {
      task.promise = this.findMatch('', task.parsed, sources);
      await task.promise;
    });

    for (let i = 0; i < parsedList.length; i++) {
      const { line, parsed } = parsedList[i];
      if (!line) continue;
      if (!parsed) {
        unmatched.push({ input: line, reason: '无法识别为标准号格式' });
        continue;
      }

      const match = await tasks.get(taskKeys[i]!)?.promise;
      if (match) resolved.push({ ...match, input: line });
      else unmatched.push({ input: line, reason: `未找到匹配标准 (已搜: ${sources.join(', ')})` });
    }

    return { resolved, unmatched };
  }

  private resolveCacheKey(parsed: ParsedNumber, sources: SourceName[]): string {
    return [
      parsed.prefix,
      parsed.number,
      parsed.yearCode ?? '',
      sources.join(','),
    ].join('|');
  }

  private async findMatch(
    input: string,
    parsed: ParsedNumber,
    sources: SourceName[],
  ): Promise<ResolvedItem | null> {
    const query = parsed.yearCode
      ? `${parsed.prefix} ${parsed.number}-${parsed.yearCode}`
      : `${parsed.prefix} ${parsed.number}`;

    for (const source of sources) {
      try {
        const service = new StandardService(this.registry.get(source));
        const results = await service.searchStandards({ query });

        const match = this.pickBest(input, results, parsed, source);
        if (match) return match;
      } catch (err) {
        console.error(`[resolver] source ${source} error for query "${query}":`, (err as Error).message);
      }
    }

    return null;
  }

  private pickBest(
    input: string,
    results: StandardSummary[],
    parsed: ParsedNumber,
    source: SourceName,
  ): ResolvedItem | null {
    if (results.length === 0) return null;

    const prefix = parsed.prefix;
    const num = parsed.number;

    // Narrow by same prefix+number (word-boundary match)
    const escNum = num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const numPattern = new RegExp(`\\b${escNum}\\b`);
    const sameBase = results.filter((r) => {
      const sn = r.standardNumber.toUpperCase();
      return sn.includes(prefix) && numPattern.test(sn);
    });

    const pool = sameBase.length > 0 ? sameBase : results;

    if (parsed.yearCode) {
      // Exact year match required
      const exact = pool.find((r) => {
        const m = r.standardNumber.match(new RegExp(`\\b${parsed.yearCode}\\b`));
        return !!m;
      });
      if (exact) return toResolved(input, exact, source);
      // No exact match with yearCode: skip this source, try next
      return null;
    }

    // No yearCode: prefer current active
    const active = pool.filter((r) => r.status && STATUS_ACTIVE.has(r.status));
    const candidates = active.length > 0 ? active : pool;

    candidates.sort((a, b) => {
      const aTime = a.implementDate ? new Date(a.implementDate).getTime() : 0;
      const bTime = b.implementDate ? new Date(b.implementDate).getTime() : 0;
      const aDate = Number.isNaN(aTime) ? 0 : aTime;
      const bDate = Number.isNaN(bTime) ? 0 : bTime;
      return bDate - aDate;
    });

    return toResolved(input, candidates[0], source);
  }
}

function toResolved(input: string, r: StandardSummary, source: SourceName): ResolvedItem {
  const replaced = r.meta && typeof r.meta.replacedStd === 'string' ? (r.meta.replacedStd as string) : null;
  return {
    input,
    standardId: r.id,
    standardNumber: r.standardNumber,
    title: r.title,
    source,
    status: r.status,
    publishDate: r.publishDate,
    implementDate: r.implementDate,
    abolishedDate: r.abolishedDate ?? null,
    replacedStd: replaced || null,
  };
}

async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item) await fn(item);
    }
  });
  await Promise.all(workers);
}
