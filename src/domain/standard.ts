export type SourceName = 'bz' | 'gbw' | 'by' | 'bzvip';

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
  totalPages?: number;
}

export interface ExportTask {
  id: string;
  standardId: string;
  status: 'queued' | 'running' | 'success' | 'failed';
  filePath?: string;
  fileName?: string;
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
  exportStandard(id: string): Promise<ExportResult>;
  createDownloadSession?(id: string): Promise<DownloadSessionInfo>;
  submitDownloadCaptcha?(sessionId: string, code: string): Promise<DownloadSessionInfo>;
  getDownloadSession?(sessionId: string): Promise<DownloadSessionInfo>;
  autoDownload?(id: string, maxRetries?: number): Promise<DownloadSessionInfo>;
}
