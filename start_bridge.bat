@echo off
title MT5 Bridge
echo Starting MT5 Bridge...
echo Make sure MetaTrader 5 is open and logged in!
echo Make sure STRUCT.ai API is running first!
echo.
cd /d "%~dp0artifacts\trading-api\mt5-bridge"
python mt5_bridge.py
pause
