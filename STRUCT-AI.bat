::[Bat To Exe Converter]
::
::YAwzoRdxOk+EWAjk
::fBw5plQjdG8=
::YAwzuBVtJxjWCl3EqQJgSA==
::ZR4luwNxJguZRRnk
::Yhs/ulQjdF+5
::cxAkpRVqdFKZSjk=
::cBs/ulQjdF+5
::ZR41oxFsdFKZSDk=
::eBoioBt6dFKZSDk=
::cRo6pxp7LAbNWATEpCI=
::egkzugNsPRvcWATEpCI=
::dAsiuh18IRvcCxnZtBJQ
::cRYluBh/LU+EWAnk
::YxY4rhs+aU+JeA==
::cxY6rQJ7JhzQF1fEqQJQ
::ZQ05rAF9IBncCkqN+0xwdVs0
::ZQ05rAF9IAHYFVzEqQJQ
::eg0/rx1wNQPfEVWB+kM9LVsJDGQ=
::fBEirQZwNQPfEVWB+kM9LVsJDGQ=
::cRolqwZ3JBvQF1fEqQJQ
::dhA7uBVwLU+EWDk=
::YQ03rBFzNR3SWATElA==
::dhAmsQZ3MwfNWATElA==
::ZQ0/vhVqMQ3MEVWAtB9wSA==
::Zg8zqx1/OA3MEVWAtB9wSA==
::dhA7pRFwIByZRRnk
::Zh4grVQjdCyDJGyX8VAjFBpOTQWMAE+1EbsQ5+n//Na0ln8od9ZyWaaW76SKIfQW7nnXQaQY9U4XueJCHw9ZbAaufEExsWsi
::YB416Ek+ZG8=
::
::
::978f952a14a936cc963da21a135fa983
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
