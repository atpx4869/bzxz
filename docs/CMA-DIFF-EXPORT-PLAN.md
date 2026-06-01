# CMA 一单一库比对 — 数据导出方案（待实施）

> 这份文档是 `cma-diff` tab 的下一步增量：把订阅机构资质 × 国家库的对比结果
> 导出 Excel。**当前 main 已合并主体功能**（commit `5b6f3a0`），导出是接下来要做的。
>
> 切换电脑或新开会话时：让 Claude 读这份文档 + `CHANGELOG.md` 的 `feat(cma-diff)`
> 那条，就能直接动手。需要先确认下方四个决策点。

## 用户已确认的前置决策

| 项 | 决策 | 在哪体现 |
|---|---|---|
| 独立菜单 | 用 tab key `cma-diff` | sidebar + ALL_TABS |
| 同步触发 | 手动（无 cron） | `/api/cma-diff/sync/*` |
| 状态档 | 4+1 档（5 档完整 / 4 档徽章简化） | `cap-lib-status.ts` |
| 远端删除 | soft delete + 30 天 admin 手动清理 | `cleanupStaleRows` |
| 徽章风格 | A 简洁字符 chip + tooltip | `app-cap-lib-badge.js` |
| 领域订阅 | 按 11 顶层领域分桶 | `cma_capability_lib_meta` |

## 需要拍板的 4 个决策点

### 决策点 1：导出范围 / 入口

| 选项 | 形态 | 适合场景 |
|---|---|---|
| **A. 单机构整表** | 每个机构折叠组标题栏加「导出此机构」按钮 | 给单个机构出整改清单（最常见） |
| **B. 多机构勾选** | 机构列表前加 checkbox + 顶部"导出勾选机构" | 一次出多家合并报告 |
| **C. 全订阅机构** | 顶部 "导出全部" 按钮 | 全集团盘点 |
| **D. 当前筛选结果** | 详情页按当前状态/搜索筛完后只导可见行 | 只想拿"完全不在库" |

**Claude 推荐**：A + B + D 三个同时给。C 等于 B 全选，不必独立按钮。

### 决策点 2：导出格式

| 选项 | 优点 | 缺点 |
|---|---|---|
| **A. Excel (xlsx)** | 直接打开筛选/着色，给领导体面 | — |
| B. CSV | 极简 | 中文乱码（要 BOM） |
| C. JSON | 程序化 | 用户用不上 |

**Claude 推荐**：A。项目里已经有 `xlsx@0.18.5` 依赖（`src/api/check-routes.ts:135` 那段查新导出就在用），直接抄。

### 决策点 3：Excel 列结构

提议：

| 列 | 数据来源 | 备注 |
|---|---|---|
| 机构名称 | `cma_labs.lab_name` | 多机构合并时必须 |
| 证书编号 | `cert_number` | 上游对账 |
| 标准号 | `std_code` | 完整带年版 |
| 标准名称 | `std_name` | |
| 类别 | `category` | |
| 检测项目 | `test_item` | |
| 比对状态 | `diffStatus` 翻译中文 | 在库/仅限引用/已废止/年版过期/完全不在库 |
| 库内 remark | `libRemark` | 如"废止，仅限能力项目库范围内…" |
| 库内领域 | `libDomain` | 库里归到哪个一级领域 |
| 建议替代年版 | `seriesNewCode` | series_only 时有 |
| 替代年版领域 | `seriesDomain` | |
| 导出时间 | now | sheet 注脚 / 单独一行 |

### 决策点 4：加分项

| 项 | 推荐 | 说明 |
|---|---|---|
| 5 档着色 | ✅ 要 | 行背景按状态填色（绿/黄/橙/红/深红），打开一眼看严重程度。`xlsx` 库底层支持 cellStyles，2 行代码事 |
| 自动筛选 | ✅ 要 | 首行加 AutoFilter（`ws['!autofilter'] = { ref: 'A1:K1' }`） |
| 多机构合并形态 | 单 sheet 按机构列排序（推荐） | 用户筛选更灵活；每机构一个 sheet 用户切来切去麻烦 |
| 列宽自适应 | ✅ 要 | 默认列宽 Excel 打开太挤；按估算字符宽度设 `ws['!cols']` |

### 决策点 5：文件命名

- 单机构：`CMA一单一库比对-{机构名}-{YYYYMMDD}.xlsx`
- 多机构：`CMA一单一库比对-{N家机构}-{YYYYMMDD}.xlsx`
- 全部：`CMA一单一库比对-全部-{YYYYMMDD}.xlsx`

机构名里有 `\ / : * ? " < > |` 的非法字符要先 sanitize（参考 `src/shared/library-paths.ts` 或自己 replace）。

---

## 实施清单（决策定了再开干）

### 后端（1 个新路由 + service 加方法）

#### `src/services/cap-lib-service.ts` 新增 `exportDiff()`

```ts
export interface ExportFilter {
  certNumbers: string[];     // 空数组 = 所有订阅机构
  statuses?: DiffStatus[];   // 空/未传 = 所有状态
  keyword?: string;          // 可选关键词，与 diffByLab 后筛同款逻辑
}

exportDiff(filter: ExportFilter): Array<DiffRow & { certNumber: string; labName: string }> {
  // 1) 解析 certNumbers：空 → SELECT cert_number FROM cma_labs WHERE subscribed_at IS NOT NULL
  // 2) 对每个 certNumber 调 diffByLab + JOIN lab_name
  // 3) 按 filter.statuses 过滤
  // 4) 按 filter.keyword 过滤（stdCode/stdName/testItem，与详情页一致）
  // 5) 排序：最差状态在前（not_in_lib → series_only → abolished → cite_only → in_lib），
  //         同状态按 labName + stdCode
  // 返回扁平数组（每行带 certNumber/labName，便于 Excel 单 sheet 渲染）
}
```

#### `src/api/cap-lib-routes.ts` 新增端点

```ts
router.post('/api/cma-diff/export', requireCmaDiff, (req, res, next) => {
  try {
    const schema = z.object({
      certNumbers: z.array(z.string().trim()).max(200),  // 0 个 = 全部
      statuses: z.array(z.enum(DIFF_STATUS_VALUES)).optional(),
      keyword: z.string().trim().max(200).optional(),
    });
    const filter = schema.parse(req.body);
    const rows = svc.exportDiff(filter);

    // 生成 xlsx buffer，复用 check-routes 风格：
    const XLSX = require('xlsx');
    const aoa = [HEADER, ...rows.map(r => [...])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!autofilter'] = { ref: 'A1:K1' };
    ws['!cols'] = [{ wch: 24 }, { wch: 18 }, ...];
    // 着色：xlsx 0.18 的 cellStyles 要 xlsx-style 或手动写 s 属性
    // 简化版：状态列前加 emoji（✅⚠🟠🔴⛔），不动行底色 —— 兼容性最稳
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'CMA一单一库比对');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const filename = encodeURIComponent(buildExportFilename(filter, rows));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
    res.send(buf);
  } catch (e) { next(normalizeError(e)); }
});
```

> **注意 cellStyles**：原生 `xlsx@0.18.5` 不写 cellStyles，要么换 `xlsx-style`，要么用更稳的 emoji 前缀方案。建议先 emoji 前缀（零依赖、稳）；后续真有人要看色块再升级 `xlsx-style`。

### 前端

#### `public/js/app-cma-diff.js`

1. **机构折叠组标题栏**加「导出此机构」按钮（决策 A）
2. **顶部 head-actions** 加「导出勾选机构」按钮（决策 B）+ 机构列表加复选框
3. **详情面板筛选条**右侧加「导出当前筛选」按钮（决策 D）
4. 三个按钮统一调 `capLibExportDiff(filter)` 工具函数：

```js
async function capLibExportDiff(filter, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch('/api/cma-diff/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filter),
    });
    if (!res.ok) { showToast('导出失败：' + res.status, 'fail'); return; }
    // 下载触发：响应头里的 filename* 直接用
    const blob = await res.blob();
    const cd = res.headers.get('Content-Disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)/);
    const fn = m ? decodeURIComponent(m[1]) : 'CMA一单一库比对.xlsx';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fn; document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    showToast('已导出：' + fn);
  } catch (e) { showToast('导出失败：' + e.message, 'fail'); }
  finally { if (btn) btn.disabled = false; }
}
```

#### `public/index.html`

- `set-page-head-actions` 区里在「同步勾选领域」按钮前加：
  ```html
  <button class="btn btn-sm btn-ghost" id="capLibExportSelectedBtn"
          onclick="capLibExportSelected()" disabled>导出勾选机构</button>
  ```

### CSS（极少量）

机构组左侧加复选框对齐：`grid-template-columns` 头部加一列 `auto`。

### 文档同步（CLAUDE.md 强制约定）

- `README.md` API 表追加 `POST /api/cma-diff/export`
- `CHANGELOG.md` 新一条 `feat(cma-diff): 数据导出 Excel`
- `docs/ARCHITECTURE.md` 「十二、CMA 一单一库」加导出小节
- 本文档（CMA-DIFF-EXPORT-PLAN.md）**实施完成后删掉**，避免和实际代码漂移

---

## 工作量估算

| 模块 | 估算 |
|---|---|
| 后端 service + 路由 | 1.5h |
| 前端三处按钮 + 工具函数 + 复选框 | 2h |
| 文档同步 | 0.5h |
| **合计** | **~4h** |

---

## 接手指南（换电脑 / 新会话）

1. `git pull origin main` 拿最新代码
2. 让 Claude 读：
   - 本文档 `docs/CMA-DIFF-EXPORT-PLAN.md`
   - `src/services/cap-lib-service.ts`（看 `diffByLab` 返回的 DiffRow 字段）
   - `src/api/check-routes.ts:135` 附近（看现有 xlsx 导出怎么写的，照抄风格）
   - `public/js/app-cma-diff.js`（看现有机构组渲染、找按钮挂载点）
3. 先逐个回复决策点 1-5（"都按推荐"也算确认）
4. 让 Claude 一次性按本文档实施 + 删除本文档 + commit + push

完成后这份 plan 文件应当被删除，留 git history 即可追溯。
