@echo off
setlocal enabledelayedexpansion
title bzxz
cd /d "%~dp0"

set "LOG=%~dp0startup.log"
set "PORTFILE=%~dp0data\.server-port"
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

:: --- clear stale port file from a previous run ---
if exist "%PORTFILE%" del /q "%PORTFILE%"

:: --- start server in background, wait for port file, then open browser ---
if exist "dist\src\index.js" (
    start "" /B cmd /c "node dist\src\index.js 2>> "%LOG%""
) else (
    start "" /B cmd /c "npx tsx src\index.ts 2>> "%LOG%""
)

:: Poll up to ~30 seconds (60 x 0.5s) for the server to publish its port.
set "PORT="
for /l %%i in (1,1,60) do (
    if exist "%PORTFILE%" (
        set /p PORT=<"%PORTFILE%"
        if defined PORT goto :launched
    )
    >nul timeout /t 1 /nobreak 2>nul || ping -n 2 127.0.0.1 >nul
)

echo [FAIL] server did not write port file within 30s; check startup.log
goto :wait_server

:launched
echo Server ready on port !PORT!
start "" http://localhost:!PORT!

:wait_server
:: Keep the launcher window open so closing it stops the server. The node
:: child writes its logs to startup.log; tail-style follow is overkill for now.
echo.
echo Server running on http://localhost:!PORT!  (close this window to stop)
echo Logs: %LOG%
:loop
>nul timeout /t 30 /nobreak 2>nul || ping -n 31 127.0.0.1 >nul
if exist "%PORTFILE%" goto :loop

:done
echo === end %date% %time% === >> "%LOG%"
pause
