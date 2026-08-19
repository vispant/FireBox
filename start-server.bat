@echo off
title FireBox - Server
cd /d "%~dp0"
echo Starting the FireBox server...
echo.
echo Once you see "Serving HTTP" below, open this link in your browser:
echo.
echo     http://localhost:5500
echo.
echo Keep this window open while you play. Closing this window stops the server.
echo.
python -m http.server 5500
pause
