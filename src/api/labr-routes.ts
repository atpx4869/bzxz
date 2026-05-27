// labr.cc API 路由 —— 独立 sidebar 入口，不挂在 standards-routes 下。
//
// 路由清单：
//   GET  /api/labr/search?keyword=...&page=1&pageSize=100
//        翻页搜索（首屏内联 + rec-list 合并）。pageSize 上限 500（labr 上游接受）。
//   GET  /api/labr/detail/:did
//        资料详情 + state.info / state.detail，供前端展示元信息 + 决定 kind 路径。
//   POST /api/labr/download
//        Body: { did }；单条下载（走 labr semaphore，遇限速直接抛错给前端）。
//        Resp.data：{ fileId, fileName, ext, size, stdCode, cleanTitle, reused }
//   POST /api/labr/batch-download
//        Body: { items: [{did}] }；批量下载，limit 100。
//        Resp.data：{ results: LabrBatchItemResult[] }；撞限速后续 kind=1 短路、kind=0 继续
//
// 错误处理：service 抛出的 LabrAuthError / LabrRateLimitError 都是 UpstreamError 子类，
// 透传给全局错误处理器（app.ts 末端 handler）转 502。前端按 error.code 区分提示文案。
//
// 鉴权：全部 requireAuth（含 guest）。不强求 admin —— labr 下载是用户日常操作，admin
// 只用于配置层（凭据等）。

import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response, NextFunction } from 'express';

import { respond, respondError } from '../shared/response';
import { normalizeError } from '../shared/errors';
import { getLabrService } from '../sources/labr/labr-service';

export function createLabrRoutes(
  requireAuth: (req: Request, res: Response, next: NextFunction) => void,
) {
  const router = Router();
  const service = getLabrService();

  /**
   * GET /api/labr/search
   *
   * labr 翻页语义：pageNo=1 通常返回空（首屏 dataList 已用），实际从 2 开始翻。
   * 我们把 page=1 映射成"首屏 dataList"，page≥2 映射成"rec-list 第 N 页"。
   * 这样前端 page 参数就是 1-based 连续整数，无需感知 labr 的 1/2 不对称。
   */
  router.get('/api/labr/search', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({
        keyword: z.string().trim().min(1).max(200),
        page: z.coerce.number().int().min(1).max(200).default(1),
        pageSize: z.coerce.number().int().min(1).max(500).default(100),
      });
      const { keyword, page, pageSize } = schema.parse(req.query);

      if (page === 1) {
        // page=1 → 首屏 dataList（≤4 条，匿名抓 SSR）。total 此时未知，先报 list 长度
        const list = await service.searchInline(keyword);
        respond(res, { page, pageSize, total: list.length, list, hasMore: list.length >= 4 });
        return;
      }
      // page≥2 → rec-list。labr 自己 pageNo 同名 → 直接传
      const r = await service.recList(keyword, page, { pageSize });
      respond(res, {
        page,
        pageSize: r.pageSize,
        total: r.total,
        list: r.list,
        hasMore: page < r.pageCount,
      });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.get('/api/labr/detail/:did', requireAuth, async (req, res, next) => {
    try {
      const did = Number(req.params.did);
      if (!Number.isInteger(did) || did <= 0) {
        respondError(res, 400, 'BAD_REQUEST', 'Invalid did');
        return;
      }
      const r = await service.getDetail(did);
      respond(res, r);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/labr/download', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({ did: z.number().int().positive() });
      const { did } = schema.parse(req.body);
      const result = await service.download(did);
      respond(res, result);
    } catch (error) {
      next(normalizeError(error));
    }
  });

  router.post('/api/labr/batch-download', requireAuth, async (req, res, next) => {
    try {
      const schema = z.object({
        items: z.array(z.object({ did: z.number().int().positive() })).min(1).max(100),
      });
      const { items } = schema.parse(req.body);
      const results = await service.batchDownload(items);
      // 即便部分失败也给 200 —— results 里每条带 ok 字段，前端逐条处理
      respond(res, { results });
    } catch (error) {
      next(normalizeError(error));
    }
  });

  return router;
}
