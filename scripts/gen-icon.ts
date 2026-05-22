/**
 * 从仓库根目录的 logo.png 生成应用图标：
 *   - public/favicon-32.png
 *   - public/favicon-256.png
 *
 * 用法：npx tsx scripts/gen-icon.ts
 *
 * 注意：原 logo 含底部 StandardsBox / 标准盒子 文字，favicon 只裁取图形部分，
 * 否则缩到 16-32px 时文字会糊成一团。裁剪坐标基于 1024×1024 原图。
 *
 * favicon.ico 由 Python 单独生成（PIL 支持多分辨率 ICO）：
 *   python -c "from PIL import Image; im=Image.open('public/favicon-256.png'); \
 *     im.save('public/favicon.ico', sizes=[(16,16),(24,24),(32,32),(48,48),(64,64),(128,128),(256,256)])"
 */
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import path from 'node:path';

(async () => {
  const src = path.resolve('logo.png');
  if (!existsSync(src)) {
    console.error('logo.png not found at repo root');
    process.exit(1);
  }

  // 1024×1024 原图：图形部分约 (260,170) – (770,580)
  const cropped = await sharp(src)
    .extract({ left: 260, top: 170, width: 510, height: 410 })
    .toBuffer();

  // 居中放入正方形画布并留出约 8% 内边距
  const square = await sharp({
    create: { width: 600, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: cropped, top: 95, left: 45 }])
    .png()
    .toBuffer();

  await sharp(square).resize(256, 256).png().toFile('public/favicon-256.png');
  await sharp(square).resize(32, 32).png().toFile('public/favicon-32.png');
  console.log('favicon-256.png + favicon-32.png written');
})();
