import type { SourceAdapter, SourceName } from '../domain/standard';
import { BadRequestError } from '../shared/errors';

type AdapterFactory = () => SourceAdapter;

const FACTORIES: Record<SourceName, AdapterFactory> = {
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
  bzvip: () => {
    const { BzVipAdapter } = require('../sources/bz-vip/bzvip-adapter');
    return new BzVipAdapter();
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
}
