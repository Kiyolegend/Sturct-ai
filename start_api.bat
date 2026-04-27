@echo off
title STRUCT.ai API
echo Starting STRUCT.ai API on localhost:8001...
cd /d "%~dp0artifacts\trading-api"
python main.py
pause
