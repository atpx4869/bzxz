import type Database from 'better-sqlite3';
import type { Request } from 'express';

// 客户端上下文 + 操作结果。从请求注入（见 extractUsageCtx）。
export interface UsageCtx {
  ip?: string | null;
  hostname?: string | null;   // 仅桌面端能取到（os.hostname() 经 X-Client-Host 头带上）
  client?: string | null;     // 'web' | 'desktop' | 'mobile'
  result?: 'success' | 'fail';
  error?: string | null;      // result='fail' 时的原因 / 日志摘要
}

// 从请求里解析 ip / hostname / client。auth 之后任意调用点都可调；
// hostname 来自 Electron 主进程注入的 X-Client-Host（浏览器拿不到客户机名）。
// client 由自定义头优先、否则按 UA 粗判（移动 UA → mobile，其余 → web）。
export function extractUsageCtx(req: Request): UsageCtx {
  const hostname = (req.get('x-client-host') || '').trim() || null;
  let client = (req.get('x-client-type') || '').trim().toLowerCase();
  if (client !== 'desktop' && client !== 'web' && client !== 'mobile') {
    const ua = (req.get('user-agent') || '').toLowerCase();
    if (/electron/.test(ua)) client = 'desktop';
    else if (/android|iphone|ipad|mobile/.test(ua)) client = 'mobile';
    else client = 'web';
  }
  // req.ip 受 app.set('trust proxy') 影响；局域网部署下即客户端内网 IP。
  const ip = (req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
  return { ip, hostname, client };
}

export function trackEvent(
  db: Database.Database,
  userId: number,
  eventType: string,
  source?: string,
  standardId?: string,
  metadata?: Record<string, unknown>,
  ctx?: UsageCtx,
): void {
  db.prepare(
    `INSERT INTO usage_events
       (user_id, event_type, source, standard_id, metadata, ip, hostname, client, result, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    userId,
    eventType,
    source ?? null,
    standardId ?? null,
    metadata ? JSON.stringify(metadata) : null,
    ctx?.ip ?? null,
    ctx?.hostname ?? null,
    ctx?.client ?? null,
    ctx?.result ?? null,
    ctx?.error ?? null,
  );
}
