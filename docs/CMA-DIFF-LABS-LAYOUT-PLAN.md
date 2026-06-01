# CMA 一单一库比对 — 页面 UI 重构方案（待实施）

> 跟 `CMA-DIFF-EXPORT-PLAN.md` 并列，是 `cma-diff` tab 主体（commit `5b6f3a0`）的
> UI 增量。本文档收两条用户反馈：
>
> 1. **机构维度比对** 折叠组展开后是一张大表，长机构（产品质量检验大库订阅后）
>    一展开几百行铺满屏幕，扫描不下去 → 需要分类折叠 + 分页让浏览流畅
> 2. **领域订阅与同步卡** 单列纵排，11 个领域吃满垂直空间，挤占机构卡显示位
>    → 改两列布局压缩到一半高度，把垂直空间还给机构比对
>
> 两条都纯前端改动，互不冲突，建议同一 commit 一起出。

## 用户期望（原话）

> 机构维度：CMA一单一库里面的"机构维度比对"，最好也分个类，不用全部展开，而且根据同
> 国家CMA徽章一样 [国家库✅] / [国家库⚠] / [国家库🔴]，分类折叠显示，然后分页
> 显示，一页50条。就是既分类折叠，分类折叠里面还分页显示。保证阅览流畅度。

> 领域订阅与同步：CMA一单一库的 领域订阅与同步 也分成两列显示，这一块目前占用了太大的位置，
> 其实没必要。位置还是要留给维度对比的显示。

## 当前现状

```
▾ 机构 A  持有 234 行 · ⛔ 12 · 🔴 8 · ✅ 200       <-- 机构折叠组（默认收起）
   [状态筛选 chip ✅⚠🟠🔴⛔（全勾选）]
   ┌─────────────────────────────────────────┐
   │ 状态 / 标准号 / 标准名 / 类别项目 / 替代 │ <-- 一张大表，所有行平铺
   │ ✅ 在库   GB1234-2020   …                │
   │ ✅ 在库   GB1235-2020   …                │
   │ ... 234 行 ...                           │
   └─────────────────────────────────────────┘
```

机构展开后 DOM 一口气塞进 234 个 `<tr>`，长机构容易卡顿 + 视觉淹没。

## 目标布局

```
▾ 机构 A  持有 234 行 · ⛔ 12 · 🔴 8 · 🟠 3 · ⚠ 5 · ✅ 206    <-- 机构折叠组（不变）

   ▾ ⛔ 完全不在库   12 条       [默认展开-最严重档]
      ┌────────────────────────────────────────┐
      │ 标准号 / 标准名 / 类别项目 / 替代/备注 │
      │ ...50 行... │
      └────────────────────────────────────────┘
      [< 1 / 1 >  共 12 条]    (≤50 只显示总数，不出翻页器)

   ▸ 🔴 年版过期       8 条
   ▸ 🟠 已废止         3 条
   ▸ ⚠ 仅限引用       5 条
   ▸ ✅ 在库         206 条       [4 页]
```

- **机构折叠**：保持现状（点机构标题切折叠）
- **二级状态折叠**：5 个分组按严重度排序固定
- **默认展开策略**：进入机构时自动展开第一个 `count > 0` 的最严重档（顺序：
  `not_in_lib → series_only → abolished → cite_only → in_lib`）。让用户一进来
  就看到最需要处理的项，不用再点
- **分页**：每页 50 条；`≤50` 时不渲染翻页器（节流视觉）
- **状态条目计数**：放分组标题里
- **去掉当前的"筛选 chip 多选"**：折叠本身就是筛选，chip 冗余

## 状态分组与配色

跟徽章统一（4 视觉档，5 数据档）：

| 数据档 | 视觉档 | emoji | 配色（用 cap-lib-badge token） |
|---|---|---|---|
| `not_in_lib`  | 4 | ⛔ | `--danger` 深红 |
| `series_only` | 3 | 🔴 | `--danger` 红 |
| `abolished`   | 2 | 🟠 | `#fb923c` 橙 |
| `cite_only`   | 2 | ⚠  | `--warning` 黄 |
| `in_lib`      | 1 | ✅ | `--ok` 绿 |

> 用户说的"跟徽章一样"是视觉上 4 档；底层仍保留 5 档让 `cite_only` 与
> `abolished` 各占一组（政策含义不同：一个"可引用"、一个"不可引用"），
> 用户能扫到细分但视觉系一致。

## 实施清单（纯前端，后端不动）

---

### Part 1 — 领域订阅卡 两列布局

#### 现状

- `web/src/styles/pages/cap-lib.css` 的 `.cap-lib-dom-row` 是 4 列 grid：
  `name + counts + synced + actions`，11 行纵排吃满整屏垂直空间
- `public/styles.css` 末尾段同款

#### 目标

11 行排成 2 列网格，每列内仍保留 `name + counts + synced + actions` 4 子列。
桌面端 2 列、窄屏 (≤900px) 自动塌成 1 列。高度直接砍半，腾出空间给下方机构卡。

#### 改动点

**`web/src/styles/pages/cap-lib.css` + `public/styles.css` 末尾段（同步两份）**：

```css
/* 改造：领域订阅外壳从 column flex 改成 2 列 grid */
.cap-lib-dom-table {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 12px;       /* 行间 4px 紧凑 / 列间 12px 透气 */
}

/* 行内 4 列宽度收紧（因为外层一列只有原来 1/2 宽，子 grid 要给出更紧凑的列宽） */
.cap-lib-dom-row {
  grid-template-columns: minmax(140px, 1.4fr) minmax(90px, 0.9fr) minmax(80px, 0.7fr) auto;
  /* 其它属性维持 */
}

/* 窄屏塌回单列 */
@media (max-width: 900px) {
  .cap-lib-dom-table { grid-template-columns: 1fr; }
}
```

#### Why 不直接两列 flex

flex 的 `wrap` 让 11 个奇数行的第 11 行末尾占满整行；用 grid `1fr 1fr` 严格切两列、
最后一行第二格留空对齐更整齐（11 个领域，第 6 个开始第二列；最末尾右下角天然空）。

#### 风险

- 行内 4 子列在原 grid 模板里有 minmax 兜底，但宽度被砍半后 `synced` 那列可能
  显示 `2026-06-01 14:32` 7 字符勉强够（11 个字符含空格），实测如果挤可以缩成
  `06-01 14:32` 或换两行
- 进度条 `.cap-lib-prog-bar { width: 90px }` 可能撑爆窄列 —— 改成 `width: 60px`
  或 `flex: 1; max-width: 90px`，本方案落地时要现场目视调

---

### Part 2 — 机构维度卡 分类折叠 + 分页

#### `public/js/app-cma-diff.js` 改造点

**1. `capLibToggleLab(certNumber)`**：拉到 rows 后不直接渲染大表，按
   `diffStatus` 分 5 组 + 缓存到 `body.dataset.groups`（JSON 序列化）：

```js
const groups = {
  not_in_lib: [], series_only: [], abolished: [], cite_only: [], in_lib: []
};
for (const r of rows) (groups[r.diffStatus] || []).push(r);
body._capLibGroups = groups;   // 直接挂 DOM 引用避免 JSON 反复 parse
```

**2. 渲染 5 个状态折叠卡** —— 新函数 `renderStatusGroups(body, groups)`：

```js
const ORDER = ['not_in_lib', 'series_only', 'abolished', 'cite_only', 'in_lib'];
const PAGE_SIZE = 50;
const firstNonEmpty = ORDER.find(k => (groups[k] || []).length > 0);
let html = '';
for (const status of ORDER) {
  const list = groups[status] || [];
  if (!list.length) continue;        // 空组不渲染
  const meta = DIFF_STATUS_META[status];
  const expanded = status === firstNonEmpty;   // 默认展开第一个最严重档
  const gid = body.id + '_s_' + status;
  html += `
    <div class="cap-lib-stgroup" data-status="${status}">
      <div class="cap-lib-stgroup-head" onclick="capLibToggleStGroup('${gid}')">
        <span class="cap-lib-stgroup-arrow" id="${gid}_arrow">${expanded ? '▾' : '▸'}</span>
        <span style="color:${meta.color}">${meta.emoji} ${escHtml(meta.label)}</span>
        <span class="cap-lib-stgroup-count">${list.length} 条</span>
      </div>
      <div class="cap-lib-stgroup-body" id="${gid}_body"
           data-page="1" style="display:${expanded ? '' : 'none'}">
        ${expanded ? renderPagedTable(list, 1) : ''}
      </div>
    </div>`;
}
body.innerHTML = html;
```

**3. `renderPagedTable(list, page)`** —— 按 50/页切片 + 翻页器：

```js
function renderPagedTable(list, page) {
  const total = list.length;
  const pages = Math.ceil(total / PAGE_SIZE) || 1;
  const p = Math.min(Math.max(1, page), pages);
  const slice = list.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE);
  const tableHtml = `
    <table class="cap-lib-diff-table">
      <thead><tr><th>状态</th><th>标准号</th><th>标准名</th><th>类别/项目</th><th>替代/备注</th></tr></thead>
      <tbody>${slice.map(renderDiffRow).join('')}</tbody>
    </table>`;
  const pagerHtml = pages > 1
    ? renderPager(p, pages, total)
    : `<div class="cap-lib-pager">共 ${total} 条</div>`;
  return tableHtml + pagerHtml;
}
```

**4. 翻页器** —— 复用项目内 `.set-pager` 风格（见 `public/styles.css`）：

```js
function renderPager(current, pages, total) {
  // 简化版：上一页 / 1 ... current ... pages / 下一页
  // 数字 ≤7 全部列出，否则压缩成「1 … cur-1 cur cur+1 … last」
  const btns = compressPages(current, pages);
  return `<div class="cap-lib-pager">
    <button onclick="capLibPageGo(this, ${current - 1})" ${current === 1 ? 'disabled' : ''}>‹</button>
    ${btns.map(p => p === '…'
      ? '<span class="cap-lib-pager-gap">…</span>'
      : `<button class="${p === current ? 'is-active' : ''}" onclick="capLibPageGo(this, ${p})">${p}</button>`
    ).join('')}
    <button onclick="capLibPageGo(this, ${current + 1})" ${current === pages ? 'disabled' : ''}>›</button>
    <span class="cap-lib-pager-info">共 ${total} 条</span>
  </div>`;
}

// 翻页 click 处理：找到所在 stgroup-body，dataset.page = 新页，重渲表 + 翻页器
window.capLibPageGo = function (btn, page) {
  const body = btn.closest('.cap-lib-stgroup-body');
  const group = btn.closest('.cap-lib-stgroup');
  const status = group.getAttribute('data-status');
  const labBody = body.closest('.cap-lib-lab-body');
  const list = (labBody._capLibGroups || {})[status] || [];
  body.dataset.page = String(page);
  body.innerHTML = renderPagedTable(list, page);
  body.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
};

window.capLibToggleStGroup = function (gid) {
  const body = document.getElementById(gid + '_body');
  const arrow = document.getElementById(gid + '_arrow');
  if (!body) return;
  if (body.style.display === 'none') {
    // 首次展开懒渲染
    if (!body.dataset.rendered) {
      const group = body.closest('.cap-lib-stgroup');
      const status = group.getAttribute('data-status');
      const labBody = body.closest('.cap-lib-lab-body');
      const list = (labBody._capLibGroups || {})[status] || [];
      body.innerHTML = renderPagedTable(list, Number(body.dataset.page) || 1);
      body.dataset.rendered = '1';
    }
    body.style.display = '';
    if (arrow) arrow.textContent = '▾';
  } else {
    body.style.display = 'none';
    if (arrow) arrow.textContent = '▸';
  }
};
```

**5. 删掉旧的状态筛选 chip** —— `capLibApplyFilter` 整个函数可删，折叠取代筛选。

**6. `capLibToggleLab` 收起机构时清缓存**：避免长期占用内存。`body._capLibGroups = null`。

### `web/src/styles/pages/cap-lib.css` + `public/styles.css` 末尾段

新加样式：

```css
/* ---------- 状态分组（机构内二级折叠） ---------- */
.cap-lib-stgroup { margin: 4px 0; border-radius: 6px; overflow: hidden; }
.cap-lib-stgroup-head {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer;
  background: var(--surface-h, rgba(255,255,255,0.03));
  font-size: 12.5px; font-weight: 600;
}
.cap-lib-stgroup-head:hover { background: rgba(255,255,255,0.05); }
.cap-lib-stgroup-arrow { color: var(--text-3); font-size: 11px; width: 10px; }
.cap-lib-stgroup-count { margin-left: auto; font-size: 11px; color: var(--text-3); font-weight: 500; }
.cap-lib-stgroup-body { padding: 6px 10px 8px; }

/* ---------- 翻页器 ---------- */
.cap-lib-pager {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  padding: 8px 0; font-size: 11px; color: var(--text-3);
}
.cap-lib-pager button {
  min-width: 26px; height: 24px; padding: 0 6px;
  border: 1px solid var(--border, rgba(255,255,255,0.1));
  background: transparent; color: var(--text-2);
  border-radius: 4px; cursor: pointer; font-size: 11px;
}
.cap-lib-pager button:hover:not(:disabled):not(.is-active) { background: rgba(255,255,255,0.05); }
.cap-lib-pager button.is-active { background: var(--accent); color: #fff; border-color: var(--accent); }
.cap-lib-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.cap-lib-pager-gap { color: var(--text-3); padding: 0 2px; }
.cap-lib-pager-info { margin-left: 12px; color: var(--text-3); }
```

按 CSS 迁移期约定，**两端同时加**（`web/src/styles/pages/cap-lib.css` + `public/styles.css` 末尾段）。

### 文档同步（CLAUDE.md 强制约定）

- `CHANGELOG.md` 新一条：`refactor(cma-diff): 机构内 5 档分类折叠 + 50/页分页`
- `docs/ARCHITECTURE.md` 「十二、CMA 一单一库」加 UI 子节
- 本文档实施完成后**删除**，与 export plan 同步处置

## 性能注记

- 一次拉所有 diff 行到前端缓存（与现在一致），200-500 行级别内存可忽略
- 5 档分组在前端做（JS 一次 `for` 循环 O(N)，N=行数）
- 懒渲染：除默认展开的最严重档外，其它 4 组的表 HTML 在点击时才生成，避免 234 行机构进入就渲染 5 张表
- 翻页时只重渲表 + 翻页器，不动外层状态分组容器
- 收起机构时清空 `_capLibGroups` 引用让 GC 回收

## 工作量估算

| 模块 | 估算 |
|---|---|
| Part 1: 领域订阅卡 CSS 两列布局（两端同步） | 15min |
| Part 2: `capLibToggleLab` 改造 + 三个新函数 | 1h |
| Part 2: CSS（两端同步） | 20min |
| Part 2: 翻页器交互细节（compressPages 工具 + 滚动条定位） | 20min |
| 文档同步 | 10min |
| **合计** | **~2h** |

## 接手指南（换电脑 / 新会话）

1. `git pull origin main`
2. 新会话告诉 Claude：
   ```
   按 docs/CMA-DIFF-LABS-LAYOUT-PLAN.md 实施 cma-diff 页面两处 UI 重构：
   Part 1 领域订阅卡两列布局 + Part 2 机构维度分类折叠分页。
   读：
   - docs/CMA-DIFF-LABS-LAYOUT-PLAN.md（方案）
   - public/js/app-cma-diff.js capLibToggleLab/renderDiffRow 附近
   - public/styles.css 末尾 cap-lib 段
   - web/src/styles/pages/cap-lib.css

   按方案一次性实施 Part 1+2 + 删 plan 文档 + commit + 推 main。
   ```
3. 完成后这份文档应被删掉，git history 即可追溯。

## 与导出方案的关联

`CMA-DIFF-EXPORT-PLAN.md` 与本方案**互不依赖**，可任意顺序实施。

- 如果**先做本方案再做导出**：导出按钮要挂在新的状态分组头上（"导出此状态"）
  比挂在机构头上更精细，能利用分类
- 如果**先做导出再做本方案**：导出按钮 D（详情页当前筛选）那一档要改成
  "导出当前分组"（因为筛选 chip 没了，按当前展开的分组导）

建议**先 UI 重构再导出**：让导出按钮直接落到新结构里，不用第二次调整。

实施顺序建议（同一会话连做）：

1. Part 1 领域订阅两列（15min，纯 CSS）
2. Part 2 机构分类折叠分页（1.5h，JS + CSS）
3. 完成 cma-diff 导出方案（参考 `CMA-DIFF-EXPORT-PLAN.md`，按钮挂到新分组头）

三件一起做 ~5.5h，一条 commit 推完。
