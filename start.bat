@echo off
title bzxz
cd /d "%~dp0"

:: Log everything to file so we can see what happened
set "LOG=%~dp0startup.log"
echo %date% %time% === bzxz startup === > "%LOG%" 2>&1

:: ── Find Node.js ──
:: fnm (most common in China)
for /d %%d in ("%LOCALAPPDATA%\fnm_multishells\*") do (
    if exist "%%d\node.exe" (
        set "PATH=%%d;%PATH%"
        echo found node via fnm: %%d\node.exe >> "%LOG%"
        goto :found
    )
)

:: Standard install
if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;%PATH%"
    echo found node: C:\Program Files\nodejs\node.exe >> "%LOG%"
    goto :found
)

:: system PATH fallback
node --version >nul 2>&1
if not errorlevel 1 (
    echo found node in PATH >> "%LOG%"
    goto :found
)

echo Node.js NOT FOUND >> "%LOG%"
echo.
echo ============================================
echo   Node.js not found.
echo   Please install from https://nodejs.org
echo ============================================
echo.
type "%LOG%"
pause
exit /b 1

:found
node --version >> "%LOG%" 2>&1
echo Node.js ready >> "%LOG%"

:: ── Install dependencies ──
if not exist "node_modules\" (
    echo Installing dependencies... >> "%LOG%"
    call npm install >> "%LOG%" 2>&1
    if errorlevel 1 (
        echo npm install FAILED >> "%LOG%"
        type "%LOG%"
        pause
        exit /b 1
    )
)

:: ── Start ──
echo Starting server... >> "%LOG%"
start "" http://localhost:3000

if exist "dist\src\index.js" (
    echo Running: node dist\src\index.js >> "%LOG%"
    node dist\src\index.js >> "%LOG%" 2>&1
) else (
    echo Running: npx tsx src\index.ts >> "%LOG%"
    npx tsx src\index.ts >> "%LOG%" 2>&1
)

echo %date% %time% server stopped >> "%LOG%"
type "%LOG%"
pause
