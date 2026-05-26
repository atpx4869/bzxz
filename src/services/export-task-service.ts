import { NotFoundError } from '../shared/errors';
import type { SourceAdapter, ExportTask } from '../domain/standard';
import { ExportTaskStore } from './export-task-store';
import { stat } from 'node:fs/promises';

export class ExportTaskService {
  constructor(
    private readonly adapter: SourceAdapter,
    private readonly store: ExportTaskStore,
  ) {}

  createTask(standardId: string, userId: number): ExportTask {
    const task = this.store.create(standardId, userId);
    // 仅 'queued' 才是真正新建：复用活跃任务时 store 返回的是已存在的 task（status
    // 可能是 queued 或 running）。这里如果对复用 task 也跑 runTask，会重复调 adapter，
    // 整个去重就废了 —— 用 createdAt === updatedAt && status === 'queued' 也行，
    // 但 subscribers 检查更简洁：新建时 subscribers.length === 1，复用时 ≥ 2。
    if (task.subscribers.length === 1 && task.status === 'queued') {
      void this.runTask(task.id, standardId);
    }

    return task;
  }

  getTask(taskId: string): ExportTask {
    const task = this.store.get(taskId);
    if (!task) {
      throw new NotFoundError(`Export task not found: ${taskId}`);
    }

    return task;
  }

  private async runTask(taskId: string, standardId: string): Promise<void> {
    this.store.markRunning(taskId);

    try {
      const result = await this.adapter.exportStandard(standardId,
        (current, total) => this.store.markProgress(taskId, current, total));
      let fileSize = result.fileSize;
      if (!fileSize) {
        try { fileSize = (await stat(result.filePath)).size; } catch {}
      }
      this.store.markSuccess(taskId, { ...result, fileSize });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown export error';
      this.store.markFailed(taskId, message);
    }
  }
}
