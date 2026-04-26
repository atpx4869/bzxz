import { describe, expect, it } from 'vitest';

import { buildExportFileName } from './bz-zhenggui-adapter';

describe('BzZhengguiAdapter export naming', () => {
  it('uses standard number and title for export file names', async () => {
    expect(buildExportFileName('GB/T 3324-2017', '木家具通用技术条件')).toBe(
      'GB_T 3324-2017 木家具通用技术条件.pdf',
    );
  });

  it('replaces illegal filename characters', () => {
    expect(buildExportFileName('GB/T 3324-2017', '木家具:通用/技术?条件')).toBe(
      'GB_T 3324-2017 木家具_通用_技术_条件.pdf',
    );
  });
});
