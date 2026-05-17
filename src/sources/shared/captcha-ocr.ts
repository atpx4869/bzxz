import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { getRootDir } from '../../shared/fs';

interface OcrResult {
  text: string;
  confidence: number;
  rawText: string;
}

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const READY_SENTINEL = '__BZXZ_OCR_READY__';
const REQUEST_TIMEOUT_MS = 8000;
const STARTUP_TIMEOUT_MS = 20_000;

function getPythonBridge(): string {
  return path.join(getRootDir(), 'scripts', 'ocr_ddddocr.py');
}

export async function ocrCaptcha(base64Image: string): Promise<OcrResult> {
  const ddddResult = await tryDdddocr(base64Image);
  if (ddddResult.text.length >= 4) {
    return ddddResult;
  }

  return tryTesseract(base64Image);
}

// ─── Long-lived Python OCR worker ────────────────────────────────────────────
// The worker is started lazily on the first OCR request. It survives across
// many solves so we pay the ~1-3s `import ddddocr` cost only once. If it dies
// (crash, OOM, killed by Windows), the next OCR call transparently restarts it.

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: ChildProcessWithoutNullStreams | null = null;
let workerReady: Promise<void> | null = null;
const pending = new Map<string, PendingRequest>();
let workerLastError: string | null = null;

function failAllPending(reason: string) {
  workerLastError = reason;
  for (const [id, req] of pending) {
    clearTimeout(req.timer);
    req.reject(new Error(reason));
    pending.delete(id);
  }
}

function startWorker(): Promise<void> {
  if (workerReady) return workerReady;

  const proc = spawn('python', ['-u', getPythonBridge()], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  worker = proc;

  const stderrLines = readline.createInterface({ input: proc.stderr });
  stderrLines.on('line', (line) => {
    if (line) console.warn('[ocr-worker stderr]', line);
  });

  workerReady = new Promise<void>((resolve, reject) => {
    const startupTimer = setTimeout(() => {
      reject(new Error(`OCR worker did not become ready within ${STARTUP_TIMEOUT_MS}ms`));
    }, STARTUP_TIMEOUT_MS);

    const stdoutLines = readline.createInterface({ input: proc.stdout });
    let ready = false;
    stdoutLines.on('line', (line) => {
      if (!ready) {
        if (line.includes(READY_SENTINEL)) {
          ready = true;
          clearTimeout(startupTimer);
          resolve();
        } else {
          // Pre-ready noise (warnings, etc.) — log and ignore
          if (line.trim()) console.warn('[ocr-worker stdout]', line);
        }
        return;
      }
      handleLine(line);
    });

    proc.on('error', (err) => {
      clearTimeout(startupTimer);
      reject(err);
    });

    proc.on('exit', (code, signal) => {
      const reason = `OCR worker exited (code=${code}, signal=${signal})`;
      console.warn(`[ocr-worker] ${reason}`);
      worker = null;
      workerReady = null;
      failAllPending(reason);
    });
  });

  workerReady.catch((err) => {
    console.warn('[ocr-worker] startup failed:', err.message);
    worker = null;
    workerReady = null;
    try { proc.kill(); } catch { /* ignore */ }
  });

  return workerReady;
}

function handleLine(line: string): void {
  if (!line.trim()) return;
  let parsed: { id?: string; text?: string; error?: string };
  try {
    parsed = JSON.parse(line);
  } catch {
    console.warn('[ocr-worker] invalid json from worker:', line);
    return;
  }
  const id = parsed.id || '';
  const req = pending.get(id);
  if (!req) return;
  pending.delete(id);
  clearTimeout(req.timer);
  if (parsed.error) {
    req.reject(new Error(parsed.error));
  } else {
    req.resolve(parsed.text ?? '');
  }
}

async function tryDdddocr(base64Image: string): Promise<OcrResult> {
  try {
    await startWorker();
  } catch (err) {
    console.warn('[captcha-ocr] worker unavailable, falling back to tesseract:', err instanceof Error ? err.message : String(err));
    return { text: '', confidence: 0, rawText: '' };
  }
  if (!worker || !worker.stdin.writable) {
    return { text: '', confidence: 0, rawText: '' };
  }

  const id = randomUUID();
  try {
    const text = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`OCR request timed out after ${REQUEST_TIMEOUT_MS}ms`));
      }, REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      try {
        worker!.stdin.write(JSON.stringify({ id, img: base64Image }) + '\n');
      } catch (err) {
        pending.delete(id);
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    const normalized = text.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return {
      text: normalized,
      confidence: normalized.length >= 4 ? 100 : 0,
      rawText: text.trim(),
    };
  } catch (err) {
    console.warn('[captcha-ocr] worker request failed, falling back to tesseract:', err instanceof Error ? err.message : String(err));
    return { text: '', confidence: 0, rawText: '' };
  }
}

// Best-effort cleanup if the host process is going away (Electron quit, etc.).
function shutdown() {
  if (worker) {
    try { worker.kill(); } catch { /* ignore */ }
    worker = null;
    workerReady = null;
  }
  failAllPending('host process exiting');
}
process.once('exit', shutdown);
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

async function tryTesseract(base64Image: string): Promise<OcrResult> {
  const buffer = Buffer.from(base64Image, 'base64');

  const { default: sharp } = await import('sharp');
  const { createWorker } = await import('tesseract.js');

  const preprocessed = await sharp(buffer)
    .resize({ width: 200, fit: 'inside' })
    .grayscale()
    .normalize()
    .toFormat('png')
    .toBuffer();

  const worker = await createWorker('eng', 1, {
    logger: () => {},
    errorHandler: () => {},
  });

  try {
    await worker.setParameters({
      tessedit_char_whitelist: CHARSET,
      tessedit_pageseg_mode: '7' as unknown as undefined,
    });

    const { data } = await worker.recognize(preprocessed);
    const text = data.text.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().trim();

    return {
      text,
      confidence: data.confidence,
      rawText: data.text,
    };
  } finally {
    await worker.terminate();
  }
}
