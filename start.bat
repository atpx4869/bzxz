@echo off
chcp 65001 >nul
title bzxz · 标准检索

cd /d "%~dp0"

echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   bzxz · 多源标准检索与批量下载
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

:: Check dependencies
if not exist "node_modules\" (
    echo [1/2] 安装依赖...
    call npm install
    if errorlevel 1 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [1/2] 依赖已就绪
)

:: Start server
echo [2/2] 启动服务...
echo.
start "" http://localhost:3000

npx tsx src/index.ts

pause
