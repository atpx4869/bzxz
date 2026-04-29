@echo off
title bzxz
cd /d "%~dp0"

:: Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js not found
    pause
    exit /b 1
)

:: Install if needed
if not exist "node_modules\" (
    call npm install
    if errorlevel 1 pause && exit /b 1
)

:: Start
if exist "dist\src\index.js" (
    start "" http://localhost:3000
    node dist\src\index.js
) else (
    start "" http://localhost:3000
    npx tsx src\index.ts
)

pause
