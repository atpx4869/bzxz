# SPC 源勘察脚本

目标：判断 https://www.spc.org.cn 「在线阅读」是否可程序化抽取出可拼合的页序列（JPEG/PNG 直链、或 PDF 直链、或 canvas 像素流）。

## 准备凭据

1. 复制 `.env.example` 为 `.env.local`（仓库根）
2. 填入：

   ```
   SPC_USERNAME=18672333058
   SPC_PASSWORD=...
   ```

3. **永远不要**把账号密码写进 `.ts` / `.md` / commit message。`.env.local` 已被 `.gitignore` 拦截。

## 跑法

```bash
# 1. 匿名搜索勘察（无需登录）
npx tsx scripts/sources/spc/inspect-search.ts

# 2. 在线阅读勘察（需要 .env.local 凭据；headless=false 会弹浏览器窗口）
npx tsx scripts/sources/spc/inspect-reader.ts
```

## 产物

落到仓库根的 `out/` 目录（已 gitignore）：

- `spc-search-requests.json` — 搜索请求/响应清单
- `spc-search-results.json` — 解析出的结果列表（标准号 / 标题 / 详情 URL）
- `spc-reader-requests.json` — 阅读页全部 network 元数据（不含 body，防爆容量）
- `spc-reader-dom.html` — 阅读页 DOM 快照
- `spc-reader-summary.md` — 自动分类总结（图片直链 / canvas / 水印元素）

把 summary.md 贴给 Claude 决定下一步 adapter 走法。
