@echo off
chcp 65001 >nul
title bzxz · 标准检索
cd /d "%~dp0"

echo %date% %time% bzxz starting > startup.log

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found >> startup.log
    msg %username% "bzxz: Node.js not found. Install from https://nodejs.org"
    exit /b 1
)

:: Install dependencies
if not exist "node_modules\" (
    echo Installing dependencies... >> startup.log
    call npm install >> startup.log 2>&1
    if errorlevel 1 (
        echo npm install failed >> startup.log
        msg %username% "bzxz: dependency install failed. Check startup.log"
        pause
        exit /b 1
    )
)

:: Run server (avoid if-block variable expansion issues)
if exist "dist\src\index.js" goto :run_compiled
if exist "node_modules\.bin\tsx.cmd" goto :run_tsx
goto :run_npx

:run_compiled
echo Using compiled build >> startup.log
node dist/src/index.js >> startup.log 2>&1
goto :server_exit

:run_tsx
echo Using tsx (dev mode) >> startup.log
node_modules\.bin\tsx.cmd src/index.ts >> startup.log 2>&1
goto :server_exit

:run_npx
echo Using npx tsx >> startup.log
npx tsx src/index.ts >> startup.log 2>&1
goto :server_exit

:server_exit
echo %date% %time% server exited >> startup.log
msg %username% "bzxz service stopped. Check startup.log for details."
pause
