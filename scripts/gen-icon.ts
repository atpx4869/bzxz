import sharp from 'sharp';

(async () => {
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256">
  <rect width="256" height="256" rx="48" fill="#1a1a2e"/>
  <text x="128" y="160" text-anchor="middle" font-family="Arial Black,sans-serif" font-size="120" font-weight="bold" fill="#58a6ff">BZ</text>
</svg>`;

await sharp(Buffer.from(svg)).resize(32, 32).png().toFile('public/favicon-32.png');
await sharp(Buffer.from(svg)).resize(256, 256).png().toFile('public/favicon-256.png');
console.log('Icons generated');
})();
