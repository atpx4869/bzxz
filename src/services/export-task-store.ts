import type { ExportResult, ExportTask } from '../domain/standard';

const TTL_MS = 60 * 60 * 1000; // 1 hour

export class ExportTaskStore {
  private readonly tasks = new Map<string, ExportTask>();
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  create(standardId: string): ExportTask {
    const now = new Date().toISOString();
    const task: ExportTask = {
      id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      standardId,
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(task.id, task);
    this.ensureCleanup();
    return task;
  }

  markRunning(taskId: string): void {
    this.update(taskId, { status: 'running' });
  }

  markSuccess(taskId: string, result: ExportResult): void {
    this.update(taskId, {
      status: 'success',
      filePath: result.filePath,
      fileName: result.fileName,
      totalPages: result.totalPages,
    });
  }

  markFailed(taskId: string, errorMessage: string): void {
    this.update(taskId, {
      status: 'failed',
      errorMessage,
    });
  }

  get(taskId: string): ExportTask | undefined {
    return this.tasks.get(taskId);
  }

  private update(taskId: string, partial: Partial<ExportTask>): void {
    const current = this.tasks.get(taskId);
    if (!current) {
      return;
    }

    this.tasks.set(taskId, {
      ...current,
      ...partial,
      updatedAt: new Date().toISOString(),
    });
  }

  private ensureCleanup(): void {
    if (this._cleanupTimer) return;
    this._cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - TTL_MS;
      for (const [id, task] of this.tasks) {
        if (new Date(task.createdAt).getTime() < cutoff) {
          this.tasks.delete(id);
        }
      }
      if (this.tasks.size === 0 && this._cleanupTimer) {
        clearInterval(this._cleanupTimer);
        this._cleanupTimer = null;
      }
    }, 600_000); // every 10 min
  }
}
