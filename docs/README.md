# 文档目录

主开发指南位于仓库根目录的 [`DEVELOPMENT.md`](../DEVELOPMENT.md)，覆盖：

- 快速开始 / 本地启动
- 后端目录结构、`SourceAdapter` 接口
- 前端模块拆分（`public/js/app-*.js`）
- 持久化文件（`data/*.json`、`bzxz.db`）
- 前端键盘快捷键
- 新增源的步骤
- API 速查

变更记录见 [`CHANGELOG.md`](../CHANGELOG.md)。

## sources

各数据源的勘察与实现细节：

- [`sources/by-source-implementation.md`](sources/by-source-implementation.md) — `by` 源（内网 `172.16.100.72:8080`，ASP.NET WebForms）
- [`sources/gbw-source-implementation.md`](sources/gbw-source-implementation.md) — `gbw` 源（`std.samr.gov.cn` / `openstd.samr.gov.cn`），含验证码 OCR 流程
- [`sources/labr-source-plan.md`](sources/labr-source-plan.md) — `labr` 标准库补给源（labr.cc），独立 service / kind=0/1 双路径 / Bearer 限速 5 次/天
- [`sources/spc-source-plan.md`](sources/spc-source-plan.md) — `spc` 中国标准在线服务网（spc.org.cn），纯 HTTP 4 步链路 + admin 面板手动粘 Cookie
