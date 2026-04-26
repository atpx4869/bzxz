import type { SourceAdapter, SourceName } from '../domain/standard';
import { BadRequestError } from '../shared/errors';
import { BzZhengguiAdapter } from '../sources/bz-zhenggui/bz-zhenggui-adapter';
import { GbwAdapter } from '../sources/gbw/gbw-adapter';

export class SourceRegistry {
  private readonly adapters: Record<SourceName, SourceAdapter>;

  constructor() {
    this.adapters = {
      bz: new BzZhengguiAdapter(),
      gbw: new GbwAdapter(),
    };
  }

  get(source: SourceName): SourceAdapter {
    const adapter = this.adapters[source];
    if (!adapter) {
      throw new BadRequestError(`Unsupported source: ${source}`);
    }

    return adapter;
  }

  list(): SourceName[] {
    return Object.keys(this.adapters) as SourceName[];
  }
}
