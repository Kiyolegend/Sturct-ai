@echo off
title STRUCT.ai
echo ============================================================
echo   STRUCT.ai — Full Setup and Launch
echo ============================================================
echo.

set "ROOT=%~dp0"
set "ROOT=%ROOT:~0,-1%"
set "PATH=%APPDATA%\npm;%PATH%"

:: Step 1 — Install Python requirements
echo [1/4] Installing Python requirements...
pip install --user fastapi "uvicorn[standard]" pandas numpy httpx websockets python-dotenv requests MetaTrader5 >nul 2>&1
echo       Done.
echo.

:: Step 2 — Install dashboard dependencies if needed
echo [2/4] Installing dashboard dependencies...
if not exist "%ROOT%\node_modules" (
    cd /d "%ROOT%"
    call pnpm install
    call pnpm add -D @rollup/rollup-win32-x64-msvc -w >nul 2>&1
) else (
    echo       Already installed.
)
echo.

:: Step 3 — Start all three services
echo [3/4] Starting STRUCT.ai API (localhost:8001)...
start "STRUCT.ai - Trading API" cmd /k "cd /d "%ROOT%\artifacts\trading-api" && python main.py"
timeout /t 4 /nobreak >nul

echo [4/4] Starting Dashboard + MT5 Bridge...
start "STRUCT.ai - Dashboard" cmd /k "set PATH=%APPDATA%\npm;%PATH% && cd /d "%ROOT%" && pnpm --filter @workspace/trading-dashboard run dev"
timeout /t 6 /nobreak >nul
start "STRUCT.ai - MT5 Bridge" cmd /k "python "%ROOT%\artifacts\trading-api\mt5-bridge\mt5_bridge.py""

timeout /t 3 /nobreak >nul
start http://localhost:5173

echo.
echo ============================================================
echo   STRUCT.ai is running!
echo   Dashboard : http://localhost:5173
echo   API       : http://localhost:8001
echo   Close the 3 black windows to stop.
echo ============================================================
pause
