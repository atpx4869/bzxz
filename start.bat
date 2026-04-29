@echo off
setlocal enabledelayedexpansion
title bzxz
cd /d "%~dp0"
set "LOG=%~dp0startup.log"
echo %date% %time% === start === > "%LOG%"

:: Find node
set "FOUND="

:: fnm
for /d %%d in ("%LOCALAPPDATA%\fnm_multishells\*") do if not defined FOUND if exist "%%d\node.exe" (
    set "PATH=%%d;!PATH!"
    set "FOUND=1"
    echo fnm: %%d\node.exe >> "%LOG%"
)

:: standard
if not defined FOUND if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;!PATH!"
    set "FOUND=1"
    echo standard: C:\Program Files\nodejs\node.exe >> "%LOG%"
)

:: PATH fallback
if not defined FOUND (
    node --version >nul 2>&1 && set "FOUND=1" && echo PATH >> "%LOG%"
)

if not defined FOUND (
    echo Node.js not found >> "%LOG%"
    echo.
    echo Node.js not found. Install from https://nodejs.org
    goto :end
)

node --version >> "%LOG%" 2>&1

:: deps
if not exist "node_modules\" (
    echo npm install... >> "%LOG%"
    call npm install >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo npm install failed >> "%LOG%"
        goto :end
    )
)

:: go
start "" http://localhost:3000
if exist "dist\src\index.js" (
    echo node dist\src\index.js >> "%LOG%"
    node dist\src\index.js
) else (
    echo npx tsx src\index.ts >> "%LOG%"
    npx tsx src\index.ts
)

:end
echo %date% %time% === end === >> "%LOG%"
echo.
echo --- startup.log ---
type "%LOG%"
pause
