# CMA 一单一库比对 — 页面 UI 重构方案（待实施）

> 跟 `CMA-DIFF-EXPORT-PLAN.md` 并列，是 `cma-diff` tab 主体（commit `5b6f3a0`）的
> UI 增量。本文档收以下用户反馈：
>
> 1. **机构维度比对** 折叠组展开后是一张大表，长机构（产品质量检验大库订阅后）
>    一展开几百行铺满屏幕，扫描不下去 → 需要分类折叠 + 分页让浏览流畅
> 2. **领域订阅与同步卡** 单列纵排，11 个领域吃满垂直空间，挤占机构卡显示位
>    → 改两列布局压缩到一半高度，把垂直空间还给机构比对
> 3. **领域订阅卡整卡可折叠**（第二轮反馈）：这块用得少，默认收起、标题栏给摘要，
>    把视觉重心彻底让给下方对比；展开后才显示两列内容
> 4. **领域订阅卡加批量同步**（第二轮反馈）：卡内加「更新勾选 / 全部更新」按钮，
>    勾几个领域一键同步、或一键全量，不用逐行点「刷新」
> 5. **机构维度三级导出**（第二轮反馈，与 `CMA-DIFF-EXPORT-PLAN.md` 合并落地）：
>    每个状态档头 / 机构组头 / 页面顶部各一个导出入口，粒度从「单档」到「全机构」
>
> 全部纯前端 + 一个导出后端端点，互不冲突，建议同一 commit 一起出。
>
> **可点击预览原型**：[`docs/cma-diff-layout-prototype.html`](./cma-diff-layout-prototype.html)
> （三主题切换验配色 / Part1 折叠 + 前后对比 / Part2 分类折叠分页 + 三级导出按钮）。
>
> ## 实施前必读：6 条对齐现网代码的修正（避免两套真相源）
>
> 1. **配色/文案/排序直接复用 `app-cma-diff.js` 里已有的 `DIFF_STATUS_META`**，
>    不要照抄本文档下方旧色表。现网实际值：`abolished` 色 `#d97706`（非 `#fb923c`）、
>    `not_in_lib` 文案「未入库」（非「完全不在库」）、`cite_only`「废止·可引用」（非「仅限引用」）。
> 2. **统一一个 worst→best `ORDER` 常量**。现网已有两份顺序定义：`STATUS_ORDER`
>    （best→worst，摘要卡用）+ `capLibToggleLab` 里的 `rev` map（worst→best）。
>    新增分组渲染再引第三份会失同步 —— 抽一个模块级 `const GROUP_ORDER =
>    ['not_in_lib','series_only','abolished','cite_only','in_lib']`，分组渲染和 `rev` 都用它。
> 3. **新 CSS 一律走 token**（`var(--surface-h)` / `var(--border)` / `var(--accent)`），
>    禁止写死 `rgba(255,255,255,0.05)` 这类暗色叠加 —— 在 light/paper 主题下会「白上加白」
>    看不见（CLAUDE.md 主题约定）。本文档下方旧 CSS 示例里的硬编码白色已按此修正。
> 4. **两列布局首列收窄后补 ellipsis**：`.cap-lib-dom-name` 加
>    `overflow:hidden;text-overflow:ellipsis;white-space:nowrap` + `title` 兜底，
>    否则「建筑工程及材料质量检验」这类长名在半宽列溢出。进度条 `.cap-lib-prog-bar`
>    宽度 90px 改弹性（`flex:1;max-width:90px`）避免撑爆半宽列。
> 5. **默认展开档懒渲染标记**：首个最严重档 inline 渲染后要同时设
>    `body.dataset.rendered='1'`，否则用户折叠再展开会触发一次冗余重渲。
> 6. **补 `compressPages(cur, pages)` 工具实现**（≤7 页全列，否则 `1 … cur-1 cur cur+1 … last`）；
>    预览原型里已有可直接抄的实现。

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

⚠ **以 `app-cma-diff.js` 的 `DIFF_STATUS_META` 为唯一真相源**（见上方修正 #1）。
下表是现网实际值（截至本文档回写时），仅供查阅，实施时 import / 复用常量，不要手抄：

| 数据档（worst→best） | emoji | label（现网） | color（现网） |
|---|---|---|---|
| `not_in_lib`  | ⛔ | 未入库     | `#7f1d1d` 深红 |
| `series_only` | 🔴 | 年版过期   | `var(--danger)` |
| `abolished`   | 🟠 | 已废止     | `#d97706` 橙 |
| `cite_only`   | ⚠  | 废止·可引用 | `var(--warning)` |
| `in_lib`      | ✅ | 在库       | `var(--ok)` |

> 视觉上用户感知 4 档颜色，底层保留 5 档让 `cite_only` 与 `abolished` 各占一组
>（政策含义不同：一个"可引用"、一个"不可引用"），用户能扫到细分但视觉系一致。
> `#7f1d1d` / `#d97706` 是有意的深红 / 橙硬色值（区分 danger 红），属设计常量，
> 跟着 `DIFF_STATUS_META` 走即可，不需 token 化。

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
  grid-template-columns: minmax(120px, 1.4fr) minmax(76px, 0.8fr) minmax(70px, 0.7fr) auto;
  /* 其它属性维持 */
}

/* 修正 #4：长领域名 ellipsis，进度条弹性 */
.cap-lib-dom-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cap-lib-prog-bar { flex: 1; max-width: 90px; }

/* 窄屏塌回单列 */
@media (max-width: 900px) {
  .cap-lib-dom-table { grid-template-columns: 1fr; }
}

/* Part 1b：整卡折叠头（token 化，主题安全） */
.cap-lib-dom-foldhead { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }
.cap-lib-dom-foldarrow { color: var(--text-3); font-size: 12px; width: 12px; }
.cap-lib-dom-foldsummary { margin-left: auto; font-size: 11.5px; color: var(--text-3); }
.cap-lib-dom-card.collapsed .cap-lib-dom-fold-body { display: none; }
```

#### Why 不直接两列 flex

flex 的 `wrap` 让 11 个奇数行的第 11 行末尾占满整行；用 grid `1fr 1fr` 严格切两列、
最后一行第二格留空对齐更整齐（11 个领域，第 6 个开始第二列；最末尾右下角天然空）。

#### 风险（已纳入上方修正 #4）

- 行内 4 子列宽度被砍半后 `synced` 列挤 —— `formatDateTime` 输出缩成 `06-01 14:32`
  （去掉年份，半宽列够用）
- 长领域名溢出 —— `.cap-lib-dom-name` 补 `overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap` + `title="${domain}"`（renderDomains 模板已有 escAttr，加 title 即可）
- 进度条 `.cap-lib-prog-bar { width: 90px }` 撑爆窄列 —— 改 `flex:1; max-width:90px`

---

### Part 1b — 领域订阅卡 整卡可折叠 + 批量同步（第二轮反馈 #3 #4）

#### 整卡折叠

领域订阅这块用得少，**默认收起**，把视觉重心让给下方机构对比。

- `public/index.html` + `web/index.html`：领域订阅 `set-card` 的标题栏改成可点折叠头
  （`onclick="capLibToggleDomCard()"` + 一个 `▸/▾` arrow span + 一个摘要 span）。
  卡 body 包一层 `.cap-lib-dom-fold-body`
- 折叠态默认 collapsed；记 `localStorage('capLib.domCollapsed')`，`renderDomains` 末尾
  按存储值恢复
- **收起时标题栏摘要**：`已订阅 N 个领域 · 最近同步 {最近一次 lastSyncedAt}`
  —— `renderDomains` 拉到 items 后算 `subscribedCount` + `max(lastSyncedAt)` 填进摘要 span，
  不展开也能扫到状态
- `capLibToggleDomCard()`：toggle body 的 `display` + arrow 文本 + 写 localStorage

#### 批量同步「更新勾选 / 全部更新」

卡内（折叠 body 顶部）加两个按钮，**仅 admin 可见/可用**（沿用 `isAdminUser()` 门控）：

```js
// 更新勾选：收集勾中的领域，逐个走现有 capLibSyncOne（带进度条轮询）
window.capLibSyncChecked = async function () {
  if (!isAdminUser()) return;
  const checked = [...document.querySelectorAll('.cap-lib-dom-row input[type=checkbox]:checked')]
    .map(cb => cb.closest('.cap-lib-dom-row')?.getAttribute('data-domain')).filter(Boolean);
  if (!checked.length) { showToast('未勾选任何领域', 'fail'); return; }
  for (const d of checked) {
    const btn = document.querySelector(`.cap-lib-dom-row[data-domain="${cssEsc(d)}"] .cap-lib-dom-actions button`);
    capLibSyncOne(d, btn);   // 复用：内部 pollSyncProgress 已对同 jobId 去重、不会重复轮询
  }
};
// 全部更新：直接走现有 sync-all 端点（已实现，capLibSyncAll 现成）
// → 「全部更新」按钮直接 onclick="capLibSyncAll()"，无需新代码
```

- 「全部更新」= 现有 `capLibSyncAll()`（已实现，挂 `sync-all`），直接复用
- 「更新勾选」= 新 `capLibSyncChecked()`，对勾中领域依次调现有 `capLibSyncOne`，
  每行进度条不变；`pollSyncProgress` 已对同 jobId 去重，安全
- 注意：现有「全部更新」语义是 **sync-all = 同步所有已勾选订阅的领域**（看后端
  `sync-all` 实现）。若用户期望「全部=全部 11 个领域不论是否订阅」，需后端加参数；
  **落地前先确认 `sync-all` 当前是「全部订阅」还是「全部领域」**，按用户原话「全部更新」
  大概率指可见的全部行 → 实测后在文案上写清

#### 风险

- 批量勾选同步会瞬间发 N 个 sync 请求，后端每领域 `pageSize=60000` 长请求 ——
  N 个并发可能压垮上游。**落地时给 `capLibSyncChecked` 串行化**（await 每个完成再发下一个，
  或限并发 2），别一次性 for 循环全发。可参考 check-service 的批次间隔思路

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

---

### Part 2b — 机构维度三级导出（第二轮反馈 #5，合并 EXPORT plan 落地）

导出粒度从细到粗三个挂载点，**统一调一个后端端点** `POST /api/cma-diff/export`
（body `{certNumbers:string[], statuses?:DiffStatus[]}`，详见 `CMA-DIFF-EXPORT-PLAN.md`）：

| 入口 | 位置 | filter | 用途 |
|---|---|---|---|
| 状态档级 | 每个 `.cap-lib-stgroup-head` 右侧「导出」小按钮 | `{certNumbers:[本机构], statuses:[该档]}` | 只导该机构某一档（如未入库 12 条） |
| 单机构 | 每个 `.cap-lib-lab-head` 右侧「导出此机构」 | `{certNumbers:[本机构]}` | 单机构整改清单（最常用） |
| 全部 | 页面顶部 `set-page-head-actions`「导出全部机构」 | `{certNumbers:[]}`（空=全部） | 全集团盘点合并表 |

- 三按钮统一调前端工具函数 `capLibExportDiff(filter, btn)`（见 EXPORT plan 实现，
  fetch blob → `Content-Disposition` 取文件名 → a.click 下载）
- **按钮 `onclick` 必须 `event.stopPropagation()`**：状态档头 / 机构头本身是折叠触发区，
  不阻止冒泡会点导出顺带折叠
- 状态档头导出按钮加 class `.cap-lib-stgroup-export`，机构头加 `.cap-lib-lab-export`
  （CSS 已在上方样式段补，`justify-self:end` 靠右）
- 机构头 grid 列数 +1（末尾加 `auto` 给导出按钮）：
  `grid-template-columns: auto minmax(160px,1.3fr) minmax(110px,auto) 1fr auto auto;`

### `web/src/styles/pages/cap-lib.css` + `public/styles.css` 末尾段

新加样式：

```css
/* ---------- 状态分组（机构内二级折叠）—— 全 token 化，主题安全（修正 #3） ---------- */
.cap-lib-stgroup { margin: 4px 0; border-radius: 6px; overflow: hidden; }
.cap-lib-stgroup-head {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 10px; cursor: pointer;
  background: var(--surface-h);
  font-size: 12.5px; font-weight: 600;
}
.cap-lib-stgroup-head:hover { background: var(--border); }
.cap-lib-stgroup-arrow { color: var(--text-3); font-size: 11px; width: 10px; }
.cap-lib-stgroup-count { margin-left: auto; font-size: 11px; color: var(--text-3); font-weight: 500; }
.cap-lib-stgroup-export { margin-left: 8px; }   /* 状态档头导出按钮（Part 2 三级导出） */
.cap-lib-stgroup-body { padding: 6px 10px 8px; }

/* ---------- 翻页器 ---------- */
.cap-lib-pager {
  display: flex; align-items: center; justify-content: center; gap: 4px;
  padding: 8px 0; font-size: 11px; color: var(--text-3);
}
.cap-lib-pager button {
  min-width: 26px; height: 24px; padding: 0 6px;
  border: 1px solid var(--border);
  background: transparent; color: var(--text-2);
  border-radius: 4px; cursor: pointer; font-size: 11px;
}
.cap-lib-pager button:hover:not(:disabled):not(.is-active) { background: var(--surface-h); }
.cap-lib-pager button.is-active { background: var(--accent); color: #fff; border-color: var(--accent); }
.cap-lib-pager button:disabled { opacity: 0.4; cursor: not-allowed; }
.cap-lib-pager-gap { color: var(--text-3); padding: 0 2px; }
.cap-lib-pager-info { margin-left: 12px; color: var(--text-3); }
```

按 CSS 迁移期约定，**两端同时加**（`web/src/styles/pages/cap-lib.css` + `public/styles.css` 末尾段）。
**全部用 token**（`--surface-h`/`--border`/`--accent`），不写死 `rgba(255,255,255,…)`，否则
light/paper 主题下「白上加白」看不见（修正 #3）。

### 文档同步（CLAUDE.md 强制约定）

- `CHANGELOG.md` 新一条：`refactor(cma-diff): 领域卡折叠+批量同步 / 机构 5 档分类折叠分页 / 三级导出`
- `README.md` API 表追加 `POST /api/cma-diff/export`
- `docs/ARCHITECTURE.md` 「十二、CMA 一单一库」加 UI 子节 + 导出小节
- 本文档 + `CMA-DIFF-EXPORT-PLAN.md` 实施完成后**一起删除**

## 性能注记

- 一次拉所有 diff 行到前端缓存（与现在一致），200-500 行级别内存可忽略
- 5 档分组在前端做（JS 一次 `for` 循环 O(N)，N=行数）
- 懒渲染：除默认展开的最严重档外，其它 4 组的表 HTML 在点击时才生成，避免 234 行机构进入就渲染 5 张表
- 翻页时只重渲表 + 翻页器，不动外层状态分组容器
- 收起机构时清空 `_capLibGroups` 引用让 GC 回收

## 工作量估算

| 模块 | 估算 |
|---|---|
| Part 1: 领域订阅卡 CSS 两列布局 + ellipsis（两端同步） | 15min |
| Part 1b: 整卡折叠 + localStorage + 摘要 | 20min |
| Part 1b: 批量同步「更新勾选/全部更新」（复用 syncOne/syncAll，串行化） | 30min |
| Part 2: `capLibToggleLab` 改造 + 三个新函数（含 compressPages） | 1h |
| Part 2: CSS（两端同步） | 20min |
| Part 2b: 三级导出按钮挂载（前端，依赖 EXPORT plan 后端端点） | 30min |
| 文档同步 | 15min |
| **合计（不含导出后端）** | **~3h** |
| 导出后端（EXPORT plan service + 路由 + 工具函数） | +1.5h |
| **三件全做合计** | **~4.5h** |

## 接手指南（换电脑 / 新会话）

1. `git pull origin main`
2. 新会话告诉 Claude：
   ```
   按 docs/CMA-DIFF-LABS-LAYOUT-PLAN.md + docs/CMA-DIFF-EXPORT-PLAN.md 一次性实施
   cma-diff 页面重构（含第二轮反馈：Part1 折叠+批量同步、Part2 分类折叠分页+三级导出）。
   先读两份 plan 顶部的「实施前必读 / 已拍板决策」，再读：
   - public/js/app-cma-diff.js（capLibToggleLab/renderDiffRow/renderDomains/capLibSyncAll）
   - src/services/cap-lib-service.ts（diffByLab 返回的 DiffRow 字段）
   - src/api/cap-lib-routes.ts + src/api/check-routes.ts（现有 xlsx 导出风格照抄）
   - public/styles.css 末尾 cap-lib 段 + web/src/styles/pages/cap-lib.css
   - public/index.html + web/index.html 的 #page-cma-diff

   严格遵守两份 plan 顶部的 6 条修正（配色复用 DIFF_STATUS_META、单一 ORDER、
   CSS 全 token、ellipsis、懒渲染标记、compressPages）。
   按方案一次性实施 + 删两份 plan 文档 + commit + 推 main。
   ```
3. 完成后两份 plan 文档一起删掉，git history 即可追溯。

## 与导出方案的关联（已合并）

第二轮反馈把导出并进本轮一起做。导出入口直接落到本方案的新结构上（状态档头 /
机构头 / 顶部三级），**不再有"先做哪个"的取舍** —— 一次性实施。
后端导出端点与 `ExportFilter` 契约见 `CMA-DIFF-EXPORT-PLAN.md`（决策点已全部拍板）。

实施顺序建议（同一会话连做，一条 commit）：

1. Part 1 两列 + ellipsis（纯 CSS）
2. Part 1b 折叠 + 批量同步（JS + CSS）
3. Part 2 分类折叠分页（JS + CSS）
4. EXPORT plan 后端端点 + 前端 `capLibExportDiff`
5. Part 2b 三级导出按钮挂到新结构
