export type SourceName = 'bz' | 'gbw' | 'by';

export interface StandardSummary {
  id: string;
  source: SourceName;
  sourceId: string;
  standardNumber: string;
  title: string;
  standardType?: string;
  status?: string;
  publishDate?: string | null;
  implementDate?: string | null;
  abolishedDate?: string | null;
  previewAvailable: boolean;
  detailUrl: string;
  meta: Record<string, unknown>;
}

export interface StandardDetail extends StandardSummary {
  contentText?: string;
  moreInfo?: Record<string, unknown>;
}

export interface PreviewInfo {
  standardId: string;
  resourceKey?: string;
  totalPages?: number;
  pageWidth?: number;
  pageHeight?: number;
  fileType?: string;
  pageUrls: string[];
  previewUrl?: string;
  downloadUrl?: string;
  captchaRequired?: boolean;
  meta: Record<string, unknown>;
}

export interface ExportResult {
  standardId: string;
  filePath: string;
  fileName: string;
  fileSize?: number;
  totalPages?: number;
}

export interface ExportTask {
  id: string;
  userId: number;
  standardId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  filePath?: string;
  fileName?: string;
  fileSize?: number;
  currentPage?: number;
  totalPages?: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SearchStandardsInput {
  query: string;
}

export interface DownloadSessionInfo {
  id: string;
  standardId: string;
  source: SourceName;
  status: 'captcha_required' | 'verified' | 'downloaded' | 'failed' | 'expired';
  captchaImageBase64?: string;
  captchaContentType?: string;
  createdAt: string;
  updatedAt: string;
  meta: Record<string, unknown>;
}

export interface SourceAdapter {
  readonly source: SourceName;
  searchStandards(input: SearchStandardsInput): Promise<StandardSummary[]>;
  getStandardDetail(id: string): Promise<StandardDetail>;
  detectPreview(id: string): Promise<PreviewInfo>;
  exportStandard(id: string, onProgress?: (current: number, total: number) => void): Promise<ExportResult>;
  // Download-session APIs accept the requesting user id so the underlying
  // store can enforce ownership — without it, any authenticated user could
  // poll or submit captchas against another user's in-flight session.
  createDownloadSession?(id: string, userId: number): Promise<DownloadSessionInfo>;
  submitDownloadCaptcha?(sessionId: string, code: string, userId: number): Promise<DownloadSessionInfo>;
  getDownloadSession?(sessionId: string, userId: number): Promise<DownloadSessionInfo>;
  autoDownload?(id: string, userId: number, maxRetries?: number): Promise<DownloadSessionInfo>;
}
