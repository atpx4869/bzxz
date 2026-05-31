# 工作交接 / 续作清单

> 跨电脑接续用。最后更新：2026-06-01。
> 换机后第一步：`git pull`，然后照「待提交」核对本地有没有没推上来的改动。

## 0. 换机后必做

```bash
git pull
git log --oneline -8      # 看最近提交，确认和远端一致
git status                # 确认工作区干净（下面"运行时数据"那几个 untracked 可忽略）
```

- 构建/测试**只在 GitHub Actions 跑**，本机不跑 `npm run build`。改完 push，看 Actions 红绿。
- `data/.text-availability-cache.json`、`data/backups/` 是运行时数据，已（或应）进 `.gitignore`，
  `git status` 里出现属正常，**不要提交**。

## 1. 这轮做完、已上线的功能（都在 main 上）

按时间顺序，每块都已 push + 过 CI：

1. **设置面板重设计**（`.set-*` 组件系统）—— 完成。
2. **全站 UI 重构（PAGES-REDESIGN）部分**：Phase A 组件层、Phase B 资质 tab 去内联、
   Phase C 批量骨架 + 五页页头统一。**剩余各页本体（结果卡/表格/步骤卡）+ 移动端 Phase F 未做**
   —— 卡在移动端 `responsive.css` 耦合，需"桌面本体 + 移动选择器一起改"。见 `docs/PAGES-REDESIGN.md`。
3. **运行日志系统**（独立菜单页 `#page-logs`）—— Phase 1+2+3 全完成：四维筛选 + 详细模式 +
   localStorage 持久化 + 后端 log-buffer 汇入 + 按天落文件 + 详情展开。见 `docs/LOG-SYSTEM-REDESIGN.md`。
4. **使用统计增强** —— Phase 1（采集 ip/主机名/客户端/结果/error + 桌面端注入 X-Client-Host）
   + Phase 2（操作明细表 + 折叠 + 结果列 + 失败展开）完成。见 `docs/CHECK-UPDATE-AND-STATS.md`。
5. **标准查新**（独立菜单 `#page-check`）—— 完整：
   - BZ 单源原文直查（不走 StandardResolver）、强制年代号
   - diff 四维度：状态精确比 / 实施日期 / 被代替(insteadStd) / 新版本
   - 非现行状态补 `detail-dm` 拿 insteadStd（被谁代替）+ replacedStd（前身）+ 废止日期
   - 分组：有变动 / 需关注（非现行，已废止有替代标"有新版本"、无替代"无变动"）/ 现行无变动 / 无法核验 / 待查新
   - 限流：单清单≤200、分批50+批间隔、全局串行锁、手动 20 分钟防抖
   - 自动查新：每清单 `auto_interval_days`（默认/下限 15 天），启动 +30s 补跑 + 每 6h 扫
   - 勾选导出 Excel（分类快选 + 单条复选框）
   - **收藏整合**：收藏标准 → 进内置「我的收藏」查新清单（is_saved）、自动关注更新；下载历史页已去掉收藏区块
   - BZ 接口字段备忘见 `docs/BZ-API.md`（含 replacedStd vs insteadStd 方向坑）

## 2. 待提交 / 待确认（换机前在「本机」先处理）

- **`docs/check-update-stats-prototype.html`** 是 untracked，没提交过。要留就 `git add` 它，不要就忽略。
- 确认上面第 5 块（收藏整合 + 徽章修正 + 勾选导出）**最后一个 commit 已 push**：
  `git log --oneline -3` 应能看到 "收藏整合进查新 / 勾选导出" 那条，且 `origin/main` 指向它。
  如果只 commit 没 push，换机后会丢——**今天务必确认 push 成功 + CI 绿**。

## 3. 明确还没做的（下次可接的活）

- **全站 UI 重构剩余**：各页结果卡/表格/步骤卡本体 + 移动端 Phase F（与 responsive.css 一起改）。
- **使用统计 Phase 3**：导出明细 csv、失败率趋势、`open` 事件埋点。
- **标准查新待办**：
  - "代替了谁"(前身)双向已支持；如需更多 detail-dm 字段，参考 `docs/BZ-API.md` 实测样本。
  - 收藏的**搜索结果星标态**目前以本地 localStorage 为准（toggle 时双写后端），
    **未做**"登录时从 `/api/check/saved/codes` 反向同步星标" → 换设备/清缓存本地星标会丢
    （后端收藏清单仍在）。需要的话补这个反向同步。
- **日志/统计**桌面通知（变动/失败弹窗）未做，目前只写运行日志。

## 4. 工程约定（换机也适用，已在 CLAUDE.md）

- 改代码必同步改对应 README/docs（单一真相源）。
- `web/src/styles/*` 与 `public/styles.css` **双文件镜像**（迁移期两份并存，cascade 等价）。
- legacy JS（`public/js/app-*.js`）两个入口经 `/legacy/` 共用同一份，**不需要镜像**。
- 新 `oklch()` 必须有 sRGB fallback（`npm run oklch:fix` / CI `oklch:check`）。
- 凭据只进 `.env.local`（gitignored），绝不进代码/文档/commit。
- commit message 中文：首行扼要 + 空行 + Why/How；本机执行 git（沙箱跑不了）。
