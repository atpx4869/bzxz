import type { DownloadSessionInfo } from '../../domain/standard';

export interface GbwDownloadSessionRecord extends DownloadSessionInfo {
  cookies: string[];
  showUrl: string;
  hcno: string;
}

export class GbwDownloadSessionStore {
  private readonly sessions = new Map<string, GbwDownloadSessionRecord>();

  create(record: Omit<GbwDownloadSessionRecord, 'id' | 'createdAt' | 'updatedAt'>): GbwDownloadSessionRecord {
    const now = new Date().toISOString();
    const created: GbwDownloadSessionRecord = {
      ...record,
      id: `gbw_dl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(created.id, created);
    return created;
  }

  get(id: string): GbwDownloadSessionRecord | undefined {
    return this.sessions.get(id);
  }

  update(id: string, partial: Partial<GbwDownloadSessionRecord>): GbwDownloadSessionRecord | undefined {
    const current = this.sessions.get(id);
    if (!current) {
      return undefined;
    }

    const next: GbwDownloadSessionRecord = {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(id, next);
    return next;
  }
}
