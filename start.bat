@echo off
title HR Software
cd /d "%~dp0"

echo ============================================
echo            Starting HR Software
echo ============================================
echo.

REM Check that Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is NOT installed.
  echo Please install it first from:  https://nodejs.org
  echo Choose the "LTS" version, install it, then run this file again.
  echo.
  pause
  exit /b
)

REM Install dependencies on first run
if not exist node_modules (
  echo First time setup: installing components, please wait...
  call npm install
  echo.
)

REM Open the browser automatically after a short delay
start "" cmd /c "timeout /t 3 >nul & start http://localhost:4000"

echo Opening http://localhost:4000 in your browser...
echo Keep THIS window open while you use the software.
echo To stop the software, close this window.
echo.
node server/index.js

pause
