import { execFileSync } from 'node:child_process';
import path from 'node:path';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';

interface OcrResult {
  text: string;
  confidence: number;
  rawText: string;
}

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const PYTHON_BRIDGE = path.join(process.cwd(), 'scripts', 'ocr_ddddocr.py');

export async function ocrCaptcha(base64Image: string): Promise<OcrResult> {
  const ddddResult = await tryDdddocr(base64Image);
  if (ddddResult.text.length >= 4) {
    return ddddResult;
  }

  return tryTesseract(base64Image);
}

async function tryDdddocr(base64Image: string): Promise<OcrResult> {
  try {
    const raw = execFileSync('python', [PYTHON_BRIDGE], {
      input: base64Image,
      encoding: 'utf-8',
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });

    const text = raw.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    return {
      text,
      confidence: text.length >= 4 ? 100 : 0,
      rawText: raw.trim(),
    };
  } catch {
    return { text: '', confidence: 0, rawText: '' };
  }
}

async function tryTesseract(base64Image: string): Promise<OcrResult> {
  const buffer = Buffer.from(base64Image, 'base64');

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
