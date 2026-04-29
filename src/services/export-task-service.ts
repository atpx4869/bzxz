import { NotFoundError } from '../shared/errors';
import type { SourceAdapter, ExportTask } from '../domain/standard';
import { ExportTaskStore } from './export-task-store';
import { stat } from 'node:fs/promises';

export class ExportTaskService {
  constructor(
    private readonly adapter: SourceAdapter,
    private readonly store: ExportTaskStore,
  ) {}

  createTask(standardId: string): ExportTask {
    const task = this.store.create(standardId);

    void this.runTask(task.id, standardId);

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
