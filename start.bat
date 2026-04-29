@echo off
chcp 65001 >nul
title bzxz · 标准检索
cd /d "%~dp0"

:: Minimize window on startup
if not "%1"=="min" (
    start "" /min "%~f0" min
    exit
)

echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo   bzxz · 多源标准检索与批量下载
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo ❌ 未找到 Node.js，请先安装 Node.js
    echo    下载地址：https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies
if not exist "node_modules\" (
    echo [1/3] 安装依赖...
    call npm install
    if errorlevel 1 (
        echo ❌ 依赖安装失败
        pause
        exit /b 1
    )
) else (
    echo [1/3] 依赖已就绪
)

:: Build if needed, else use tsx directly
set "SERVER_CMD="
if exist "dist\src\index.js" (
    echo [2/3] 使用编译版本启动
    set "SERVER_CMD=node dist/src/index.js"
) else (
    echo [2/3] 使用 tsx 启动 ^(开发模式^)
    set "SERVER_CMD=npx tsx src/index.ts"
)

:: Get LAN IP
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4" 2^>nul') do (
    for /f "tokens=*" %%b in ("%%a") do (
        set "LAN_IP=%%b"
        goto :gotip
    )
)
:gotip

echo [3/3] 启动服务...
echo.
echo   ▸ 本机访问：http://localhost:3000
if defined LAN_IP echo   ▸ 局域网访问：http://%LAN_IP%:3000
echo   ▸ 关闭窗口即可停止服务
echo.

:: Open browser
start "" http://localhost:3000

:: Run server
cmd /c %SERVER_CMD%

:: If server exits unexpectedly
echo.
echo ❌ 服务已停止
pause
