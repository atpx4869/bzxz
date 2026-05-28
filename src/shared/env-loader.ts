/**
 * 加载 `.env.local` 到 process.env。
 *
 * - 单次幂等：内部用 module 级 flag 防重复加载
 * - override: false：真实环境变量（CI / shell `set` / pm2 注入）优先级最高，
 *   .env.local 只做本机默认值兜底
 * - 不抛错：dotenv 找不到文件时静默跳过；解析错误打 warn 后继续，
 *   毕竟 .env.local 缺失是 Electron 打包后的正常状态（凭据通过其它手段注入）
 *
 * 搜索路径（按顺序，命中第一个就停，不做合并）：
 *   1. process.cwd()/.env.local              开发 / portable / npm start
 *   2. dirname(process.execPath)/.env.local  Electron 安装版（NSIS 把模板复制到 $INSTDIR）
 *      —— Node 启动时此路径是 node.exe 所在目录，通常不会命中，等同跳过
 *
 * 加载入口（按调用顺序）：
 *   1. src/index.ts          — Web 后端进程
 *   2. electron/main.ts      — Electron 主进程
 *   3. scripts/sources/**\/inspect-*.ts — 勘察脚本
 */

import path from 'node:path';
import { existsSync } from 'node:fs';

let loaded = false;

export function loadDotEnvLocal(): { loaded: boolean; path?: string } {
  if (loaded) return { loaded: true };
  loaded = true;

  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(path.dirname(process.execPath), '.env.local'),
  ];

  const envPath = candidates.find(p => existsSync(p));
  if (!envPath) return { loaded: false };

  try {
    // 延迟 require：dotenv 是可选依赖（npm i 漏装也不应让进程崩）
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dotenv = require('dotenv') as typeof import('dotenv');
    const result = dotenv.config({ path: envPath, override: false });
    if (result.error) {
      console.warn('[env] .env.local parse error:', result.error.message);
      return { loaded: false };
    }
    console.log('[env] loaded .env.local from:', envPath);
    return { loaded: true, path: envPath };
  } catch (e) {
    console.warn('[env] dotenv not installed, skipped .env.local:', e instanceof Error ? e.message : String(e));
    return { loaded: false };
  }
}
