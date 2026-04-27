@echo off
title Installing Requirements
echo ============================================================
echo   STRUCT.ai — Installing Python Requirements
echo ============================================================
echo.
echo Step 1/3 — Installing STRUCT.ai API packages...
pip install --user fastapi "uvicorn[standard]" pandas numpy httpx websockets python-dotenv
echo.
echo Step 2/3 — Installing MT5 Bridge packages...
pip install --user MetaTrader5 requests
echo.
echo Step 3/3 — Done!
echo.
echo You can now run start_api.bat and start_bridge.bat
echo.
pause
