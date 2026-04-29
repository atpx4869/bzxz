@echo off
setlocal enabledelayedexpansion
title bzxz
cd /d "%~dp0"

set "LOG=%~dp0startup.log"
echo === bzxz startup %date% %time% === > "%LOG%"

:: --- find node ---
set "OK="

:: fnm versions
if exist "%LOCALAPPDATA%\fnm_multishells\" (
    for /d %%d in ("%LOCALAPPDATA%\fnm_multishells\*") do (
        if not defined OK if exist "%%d\node.exe" (
            set "PATH=%%d;!PATH!" & set "OK=1"
        )
    )
)

:: manual install (node-v* folders)
if exist "%LOCALAPPDATA%\nodejs\" (
    for /d %%d in ("%LOCALAPPDATA%\nodejs\node-v*") do (
        if not defined OK if exist "%%d\node.exe" (
            set "PATH=%%d;!PATH!" & set "OK=1"
        )
    )
)

:: nvm-windows
if not defined OK for %%v in ("%NVM_HOME%" "%APPDATA%\nvm") do (
    if exist "%%~v\node.exe" (
        set "PATH=%%~v;!PATH!" & set "OK=1"
    )
)

:: standard install
if not defined OK if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;!PATH!" & set "OK=1"
)

:: PATH fallback
if not defined OK (
    node --version >nul 2>&1
    if not errorlevel 1 set "OK=1"
)

if not defined OK (
    echo [FAIL] Node.js not found
    echo Please install from https://nodejs.org
    goto :done
)

:: --- check deps ---
if not exist "node_modules\" (
    call npm install
    if errorlevel 1 (
        echo [FAIL] npm install failed
        goto :done
    )
)

:: --- start ---
start "" http://localhost:3000

if exist "dist\src\index.js" (
    node dist\src\index.js 2>> "%LOG%"
) else (
    npx tsx src\index.ts 2>> "%LOG%"
)

:done
echo === end %date% %time% === >> "%LOG%"
type "%LOG%"
pause
