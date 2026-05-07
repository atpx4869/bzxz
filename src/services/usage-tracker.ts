import type Database from 'better-sqlite3';

export function trackEvent(
  db: Database.Database,
  userId: number,
  eventType: string,
  source?: string,
  standardId?: string,
  metadata?: Record<string, unknown>,
): void {
  db.prepare(
    'INSERT INTO usage_events (user_id, event_type, source, standard_id, metadata) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, eventType, source ?? null, standardId ?? null, metadata ? JSON.stringify(metadata) : null);
}
