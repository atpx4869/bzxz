// In-memory store for preview auto-download tasks (Phase 2).
//
// 用户点预览未命中本地库时，preview-routes 在后台触发 autoDownload，前端
// 用 taskId 轮询本端点直到 status === 'ready' 拿到 fileId 切预览。
//
// 进程内存即可：
// - 任务最长 ~3 分钟（下载 timeout），重启等于丢任务，用户重新点预览即可
// - 没有跨进程消费者
//
// 简单 GC：超过 10 分钟的任务（无论结果）从 map 里清掉，防止泄漏

import { randomUUID } from 'node:crypto';

export type PreviewTaskStatus =
  | { status: 'pending' | 'downloading'; source?: string }
  | { status: 'ready'; fileId: number; source: string }
  | { status: 'failed'; error: string };

interface Entry {
  status: PreviewTaskStatus;
  createdAt: number;
  updatedAt: number;
}

const TTL_MS = 10 * 60 * 1000;
const tasks = new Map<string, Entry>();

function gcExpired(): void {
  const now = Date.now();
  for (const [id, entry] of tasks) {
    if (now - entry.updatedAt > TTL_MS) tasks.delete(id);
  }
}

export function createTask(): string {
  gcExpired();
  const id = randomUUID();
  const now = Date.now();
  tasks.set(id, { status: { status: 'pending' }, createdAt: now, updatedAt: now });
  return id;
}

export function updateTask(id: string, status: PreviewTaskStatus): void {
  const entry = tasks.get(id);
  if (!entry) return;
  entry.status = status;
  entry.updatedAt = Date.now();
}

export function getTask(id: string): PreviewTaskStatus | null {
  const entry = tasks.get(id);
  return entry ? entry.status : null;
}
