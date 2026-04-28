# sync.ps1 - 拉取最新代码并安装依赖
Write-Host "git pull..." -ForegroundColor Cyan
git pull

Write-Host "npm install..." -ForegroundColor Cyan
npm install

Write-Host "pip install ddddocr..." -ForegroundColor Cyan
pip install ddddocr

Write-Host "npm run build..." -ForegroundColor Cyan
npm run build

Write-Host "Done. Run: node dist/src/index.js" -ForegroundColor Green
