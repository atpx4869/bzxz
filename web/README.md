# web/ — 前端迁移镜像（计划态，未上线）

> ⚠️ **当前运行时仍是 `../public/`**（原生 ESM + `public/styles.css`，由 `express.static('public/')` 直出）。
> 包括手机适配（Phase 0–4：URL 路由、响应式断点、资质可视化、PWA manifest、设置页徽章）全部落在 `public/` 下，**不在 `web/` 里**。
> 这个目录目前是迁移计划态：保留 `web/index.html` 与 `web/src/styles/*` 作为未来接 Vite/TS 的镜像材料，当前 CI 不运行独立 `web:*` 脚本。下一步路线参见 [`../docs/MIGRATION.md`](../docs/MIGRATION.md)。

## 快速开始

```powershell
npm install
npm run dev              # 当前真实入口：Express 直供 ../public/
npm run build            # CI 同款 TypeScript 编译
npm test                 # CI 同款后端/API/服务测试
npm run oklch:check      # CI 同款 OKLCh fallback 守门
```

## 目录速览

| 路径 | 作用 |
|------|------|
| `index.html`     | legacy `public/index.html` 的迁移镜像；入口结构改动要两边同步核对 |
| `src/styles/`    | 全量模块化 CSS（详见下文），由 `src/styles/index.css` 汇总 |

## CSS 结构（P1 已完成）

`public/styles.css`（1179 行单文件）已按 [`src/styles/SECTIONS.md`](./src/styles/SECTIONS.md) 拆为
31 个文件，`src/styles/index.css` 统一汇总。当前布局：

```
src/styles/
├── base.css            # :root tokens + reset + 全站滚动条 + countIn 工具动画
├── layout/             # topbar / sidebar / content / log-panel
├── components/         # 18 个组件（buttons / search-bar / modal / result-card / preview ...）
│                       #   preview.css 还含 .preview-source-picker（多源切换条）
├── pages/              # stats / users / qualifications / completion / announcement / admin / labr
│                       #   labr.css = labr-row 家族 + std-code 蓝徽章 + kind 绿/橙 + ext 按 office 主色
├── responsive.css      # 跨组件 @media 汇总（1100 / 900 / 640px）
├── theme/glass.css     # 全局玻璃主题，cascade 最后赢
└── index.css           # 汇总 @import（含目标顺序）
```

过渡模式：`index.css` 同时 `@import '../../../public/styles.css'`，新文件与原段落
"重复加载、cascade 等价"。待 legacy `public/index.html` 入口废弃时执行两步切换：
①删 `public/styles.css` 对应段落 ②删 `index.css` 里对 `public/styles.css` 的 `@import`。

主题补丁约定：公告弹窗的基础样式仍在 `pages/announcement.css`，但 dark/light/paper 的
实际弹窗底色由 `theme/glass.css` 末尾 Phase 6 覆盖；legacy 主题在 `theme/legacy.css`
兜底。改公告 popup 时三处要一起核对。

跨文件 `@keyframes` 依赖：`btn-spin` 定义于 buttons.css、`panelIn` 定义于 modal.css、
`toastIn` 定义于 toast.css，对应消费者文件必须排在它们之后。`index.css` 顶部注释已锁顺序。

## 设计原则

1. **零回归优先**：`public/` 是当前真实入口，任何迁移都不能破坏 legacy 直出。
2. **双入口镜像**：改页面骨架（sidebar / page 容器 / 全局控件）时，同时核对
   `public/index.html` 与 `web/index.html`，直到 legacy 入口正式废弃。
3. **样式过渡**：`web/src/styles/index.css` 仍导入 `public/styles.css`；未执行两步切换前，
   不单独删除 legacy CSS 段落。
4. **脚本接通后再启用 CI**：只有补齐 `web/package.json` / Vite 配置 / TS 模块后，才把
   独立 `web:*` 脚本加回 CI。
