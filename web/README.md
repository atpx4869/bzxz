# web/ — 前端 Vite + TypeScript 源码

新的前端构建链。详细背景与下一步路线参见 [`../docs/MIGRATION.md`](../docs/MIGRATION.md)。

## 快速开始

```powershell
npm install
npm run web:typecheck    # 仅检查类型
npm run web:dev          # 开发模式，proxy /api → BZXZ_API_PORT (默认 18301)
npm run web:build        # 构建到 ../public/dist/
```

## 目录速览

| 路径 | 作用 |
|------|------|
| `vite.config.ts` | 构建配置，dev server + 反代 + 输出到 `public/dist/` |
| `tsconfig.json`  | 前端 TS 配置（strict、ES2022、bundler 解析） |
| `index.html`     | 入口 HTML 骨架（待补全完整 page-* 内容） |
| `src/main.ts`    | 装配模块 + 挂 window 兼容 legacy 脚本 |
| `src/lib/`       | api 客户端、storage、state |
| `src/modules/`   | tabs / auth / admin / detail / result / ui（toast/confirm） |
| `src/styles/`    | 全量模块化 CSS（详见下文） |
| `src/types/`     | 全局类型声明 |

## CSS 结构（P1 已完成）

`public/styles.css`（1179 行单文件）已按 [`src/styles/SECTIONS.md`](./src/styles/SECTIONS.md) 拆为
31 个文件，`src/styles/index.css` 统一汇总。当前布局：

```
src/styles/
├── base.css            # :root tokens + reset + 全站滚动条 + countIn 工具动画
├── layout/             # topbar / sidebar / content / log-panel
├── components/         # 18 个组件（buttons / search-bar / modal / result-card / ...）
├── pages/              # stats / users / qualifications / completion / announcement / admin
├── responsive.css      # 跨组件 @media 汇总（1100 / 900 / 640px）
├── theme/glass.css     # 全局玻璃主题，cascade 最后赢
└── index.css           # 汇总 @import（含目标顺序）
```

过渡模式：`index.css` 同时 `@import '../../../public/styles.css'`，新文件与原段落
"重复加载、cascade 等价"。待 legacy `public/index.html` 入口废弃时执行两步切换：
①删 `public/styles.css` 对应段落 ②删 `index.css` 里对 `public/styles.css` 的 `@import`。

跨文件 `@keyframes` 依赖：`btn-spin` 定义于 buttons.css、`panelIn` 定义于 modal.css、
`toastIn` 定义于 toast.css，对应消费者文件必须排在它们之后。`index.css` 顶部注释已锁顺序。

## 设计原则

1. **零回归优先**：`public/` 完整保留。Vite 产物落到 `public/dist/`
   作为新构建产物，老路径继续可用。
2. **渐进迁移**：新 TS 模块通过 `window.xxx` 暴露，未迁的 `public/js/*`
   一行不改照旧工作。
3. **单一状态源**：`lib/state.ts` 管 settings + uiState + currentUser$。
   旧 `let downloadSources` 通过 `Object.defineProperty` 重定向到 state。
4. **类型契约**：前后端共享类型留口子（`web/src/types/api.d.ts` 后续
   再 link 后端 `src/shared/types/`）。
