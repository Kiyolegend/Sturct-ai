@echo off
title STRUCT.ai Launcher
echo ============================================
echo   STRUCT.ai Trading Platform
echo ============================================
echo.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"

:: Add npm global folder to PATH so pnpm is found even if freshly installed
set "PATH=%APPDATA%\npm;%PATH%"

:: Install pnpm if not found
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing pnpm...
    call npm install -g pnpm
)

:: Install dashboard dependencies (fresh install to get Windows native modules)
echo Installing dashboard dependencies... (first time only, may take a few minutes)
cd /d "%ROOT%"
if exist "%ROOT%\node_modules" rmdir /s /q "%ROOT%\node_modules"
call pnpm install
call pnpm add -D @rollup/rollup-win32-x64-msvc --ignore-workspace-root-check 2>nul

echo [1/3] Starting Trading API...
start "STRUCT.ai - Trading API" cmd /k "cd /d "%ROOT%\artifacts\trading-api" && python main.py"

echo Waiting for API to start...
timeout /t 4 /nobreak > nul

echo [2/3] Starting Dashboard...
start "STRUCT.ai - Dashboard" cmd /k "set PATH=%APPDATA%\npm;%PATH% && cd /d "%ROOT%" && pnpm --filter @workspace/trading-dashboard run dev"

echo Waiting for dashboard to compile...
timeout /t 8 /nobreak > nul

echo [3/3] Starting MT5 Bridge...
start "STRUCT.ai - MT5 Bridge" cmd /k "python "%ROOT%\artifacts\trading-api\mt5-bridge\mt5_bridge.py""

echo Opening browser...
timeout /t 2 /nobreak > nul
start http://localhost:5173

echo.
echo ============================================
echo   STRUCT.ai is running!
echo   Dashboard: http://localhost:5173
echo   Close the 3 black windows to stop.
echo ============================================
pause
