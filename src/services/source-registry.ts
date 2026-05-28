import type { SourceAdapter, SourceName } from '../domain/standard';
import { BadRequestError } from '../shared/errors';

type AdapterFactory = () => SourceAdapter;

// Partial 而非 Record：labr 不实现 SourceAdapter（独立 sidebar + kind 双路径），
// 所以 FACTORIES 不应该被 TS 要求列出 'labr' 键。get() 自带 missing-factory 抛错。
const FACTORIES: Partial<Record<SourceName, AdapterFactory>> = {
  bz: () => {
    const { BzZhengguiAdapter } = require('../sources/bz-zhenggui/bz-zhenggui-adapter');
    return new BzZhengguiAdapter();
  },
  gbw: () => {
    const { GbwAdapter } = require('../sources/gbw/gbw-adapter');
    return new GbwAdapter();
  },
  by: () => {
    const { ByAdapter } = require('../sources/by/by-adapter');
    return new ByAdapter();
  },
  spc: () => {
    const { getSpcAdapter } = require('../sources/spc/spc-adapter');
    return getSpcAdapter();
  },
};

export class SourceRegistry {
  private readonly cache = new Map<SourceName, SourceAdapter>();

  get(source: SourceName): SourceAdapter {
    if (this.cache.has(source)) return this.cache.get(source)!;
    const factory = FACTORIES[source];
    if (!factory) {
      throw new BadRequestError(`Unsupported source: ${source}`);
    }
    const adapter = factory();
    this.cache.set(source, adapter);
    return adapter;
  }

  list(): SourceName[] {
    return Object.keys(FACTORIES) as SourceName[];
  }

  /** Get GBW text availability cache (returns empty if gbw not loaded) */
  getGbwTextAvailability(ids: string[]): Record<string, boolean> {
    const adapter = this.cache.get('gbw') as any;
    if (adapter && typeof adapter.getTextAvailability === 'function') {
      return adapter.getTextAvailability(ids);
    }
    return {};
  }
}
