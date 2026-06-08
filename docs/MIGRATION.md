# 前端迁移说明

## 当前状态

- 真实运行入口仍是 `public/index.html` + `public/js/*` + `public/styles.css`，由 Express 静态直出。
- `web/index.html` 与 `web/src/styles/*` 是迁移镜像和样式拆分成果，尚未接入独立 Vite/TS 构建。
- 当前仓库没有 `web/package.json`，CI 不运行 `web:*` 脚本。

## 改动规则

- 改页面骨架、sidebar、page 容器、全局控件时，同时核对 `public/index.html` 与 `web/index.html`。
- 改 CSS 时遵守迁移期双轨：`public/styles.css` 仍服务 legacy 入口，`web/src/styles/index.css` 仍导入它。
- legacy 入口废弃前，不要单独删除 `public/styles.css` 已抽出的段落，也不要删除 `index.css` 里的 legacy import。

## CI 卡口

- PR Check：`npm run build` → `npm test` → `npm run oklch:check`。
- `main` 打包 workflow：同样检查后，再跑 Electron portable + NSIS 打包。
- 等 `web/` 真正补齐 Vite/TS 工程后，再新增 `web:typecheck` / `web:test` / `web:build` 并接入 CI。
