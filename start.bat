@echo off
title bzxz
cd /d "%~dp0"

:: ── Locate Node.js ──
set "NODE_EXE="

:: 1) Try PATH first
node --version >nul 2>&1 && set "NODE_EXE=node" && goto :found

:: 2) fnm (Fast Node Manager) — common in China
if exist "%LOCALAPPDATA%\fnm\fnm.exe" (
    for /f "tokens=*" %%i in ('"%LOCALAPPDATA%\fnm\fnm.exe" env --shell cmd 2^>nul ^| findstr /r "^set PATH="') do %%i
    node --version >nul 2>&1 && set "NODE_EXE=node" && goto :found
)

:: 3) nvm-windows
for %%v in ("%NVM_HOME%" "%APPDATA%\nvm" "%USERPROFILE%\AppData\Roaming\nvm") do (
    if exist "%%~v\node.exe" (
        set "PATH=%%~v;%PATH%"
        node --version >nul 2>&1 && set "NODE_EXE=node" && goto :found
    )
)

:: 4) Standard install paths
for %%v in ("%ProgramFiles%\nodejs" "%ProgramFiles(x86)%\nodejs" "%LOCALAPPDATA%\Programs\nodejs") do (
    if exist "%%~v\node.exe" (
        set "PATH=%%~v;%PATH%"
        node --version >nul 2>&1 && set "NODE_EXE=node" && goto :found
    )
)

:: 5) Volta
for %%v in ("%LOCALAPPDATA%\Volta") do (
    if exist "%%~v\volta.exe" (
        set "PATH=%%~v;%PATH%"
        node --version >nul 2>&1 && set "NODE_EXE=node" && goto :found
    )
)

echo Node.js not found. Please install from https://nodejs.org
pause
exit /b 1

:found
echo Node.js found: %NODE_EXE%

:: ── Install dependencies ──
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo npm install failed
        pause
        exit /b 1
    )
)

:: ── Start browser & server ──
start "" http://localhost:3000

if exist "dist\src\index.js" (
    node dist\src\index.js
) else (
    npx tsx src\index.ts
)

pause
