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
const PYTHON_CANDIDATES = process.platform === 'win32'
  ? ['python', 'python3', 'py']
  : ['python3', 'python'];

function getPythonBridge(): string {
  return path.join(getRootDir(), 'scripts', 'ocr_ddddocr.py');
}

export async function ocrCaptcha(base64Image: string): Promise<OcrResult> {
  // Skip ddddocr entirely if a previous attempt proved it's unavailable —
  // otherwise each captcha eats the 8s startup timeout for nothing.
  if (ocrStatus.engine !== 'unavailable') {
    const t0 = Date.now();
    const ddddResult = await tryDdddocr(base64Image);
    if (ddddResult.text.length >= 4) {
      recordSolve('ddddocr', Date.now() - t0);
      return ddddResult;
    }
  }

  const t0 = Date.now();
  const tess = await tryTesseract(base64Image);
  recordSolve('tesseract', Date.now() - t0);
  return tess;
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────
// Exposed via /api/diagnostics/ocr so the user can see what's actually running
// without opening the Electron dev console.

export interface OcrStatus {
  engine: 'ddddocr' | 'tesseract' | 'unavailable' | 'unknown';
  workerPid: number | null;
  startupAttempts: number;
  lastError: string | null;
  pythonCommand: string | null;
  bridgePath: string;
  solves: {
    ddddocr: { count: number; totalMs: number };
    tesseract: { count: number; totalMs: number };
  };
}

const ocrStatus: OcrStatus = {
  engine: 'unknown',
  workerPid: null,
  startupAttempts: 0,
  lastError: null,
  pythonCommand: null,
  bridgePath: getPythonBridge(),
  solves: {
    ddddocr: { count: 0, totalMs: 0 },
    tesseract: { count: 0, totalMs: 0 },
  },
};

function recordSolve(engine: 'ddddocr' | 'tesseract', ms: number): void {
  ocrStatus.solves[engine].count += 1;
  ocrStatus.solves[engine].totalMs += ms;
}

export function getOcrStatus(): OcrStatus {
  return {
    ...ocrStatus,
    solves: {
      ddddocr: { ...ocrStatus.solves.ddddocr },
      tesseract: { ...ocrStatus.solves.tesseract },
    },
  };
}

// ─── Long-lived Python OCR worker ────────────────────────────────────────────

interface PendingRequest {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let worker: ChildProcessWithoutNullStreams | null = null;
let workerReady: Promise<void> | null = null;
const pending = new Map<string, PendingRequest>();

function failAllPending(reason: string) {
  for (const [id, req] of pending) {
    clearTimeout(req.timer);
    req.reject(new Error(reason));
    pending.delete(id);
  }
}

function trySpawnPython(): { proc: ChildProcessWithoutNullStreams; command: string } | null {
  let lastErr: string | null = null;
  for (const command of PYTHON_CANDIDATES) {
    try {
      const proc = spawn(command, ['-u', getPythonBridge()], {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      // Catch immediate spawn errors (ENOENT, EACCES) before returning. Without
      // this `proc.on('error')`, the rejection lands as an unhandled error event.
      let immediateError: Error | null = null;
      proc.once('error', (err) => { immediateError = err; });
      // Small synchronous wait: spawn errors fire on next tick, so anything
      // happening *now* is bookkeeping only. We attach the real error handler
      // in startWorker and just reuse the proc if it didn't die instantly.
      if (immediateError) {
        lastErr = (immediateError as Error).message;
        continue;
      }
      ocrStatus.pythonCommand = command;
      return { proc, command };
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  ocrStatus.lastError = `Could not spawn python (tried ${PYTHON_CANDIDATES.join(', ')}): ${lastErr ?? 'unknown'}`;
  return null;
}

function startWorker(): Promise<void> {
  if (workerReady) return workerReady;
  if (ocrStatus.engine === 'unavailable') {
    return Promise.reject(new Error(ocrStatus.lastError ?? 'ddddocr worker permanently unavailable'));
  }

  ocrStatus.startupAttempts += 1;
  const spawned = trySpawnPython();
  if (!spawned) {
    ocrStatus.engine = 'unavailable';
    return Promise.reject(new Error(ocrStatus.lastError ?? 'no python interpreter found'));
  }
  const proc = spawned.proc;
  worker = proc;

  const stderrBuffer: string[] = [];
  const stderrLines = readline.createInterface({ input: proc.stderr });
  stderrLines.on('line', (line) => {
    if (line) {
      stderrBuffer.push(line);
      if (stderrBuffer.length > 20) stderrBuffer.shift();
      console.warn('[ocr-worker stderr]', line);
    }
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
          ocrStatus.engine = 'ddddocr';
          ocrStatus.workerPid = proc.pid ?? null;
          ocrStatus.lastError = null;
          resolve();
        } else if (line.trim()) {
          console.warn('[ocr-worker stdout]', line);
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
      const reason = `OCR worker exited (code=${code}, signal=${signal})${stderrBuffer.length ? '; stderr: ' + stderrBuffer.slice(-3).join(' | ') : ''}`;
      console.warn(`[ocr-worker] ${reason}`);
      worker = null;
      workerReady = null;
      ocrStatus.workerPid = null;
      // Exit before READY = startup failure (missing ddddocr package, etc.)
      // Mark unavailable permanently so we don't keep wasting startup-timeout
      // budget on every captcha.
      if (!ready) {
        ocrStatus.engine = 'unavailable';
        ocrStatus.lastError = reason;
      }
      failAllPending(reason);
    });
  });

  workerReady.catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[ocr-worker] startup failed:', msg);
    ocrStatus.lastError = msg;
    ocrStatus.engine = 'unavailable';
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
    // Don't log here — startWorker already logged once, and we'd be noisy
    // per-captcha during fallback periods.
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
    return { text: '', confidence: 0, rawText: '' };
  }
}

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
  if (ocrStatus.engine === 'unknown') ocrStatus.engine = 'tesseract';
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
