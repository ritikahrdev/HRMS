@echo off
title Hrika HRMS
cd /d "%~dp0"
color 0A

echo.
echo  ============================================
echo       Hrika HRMS - Starting...
echo  ============================================
echo.

REM Kill any existing server on port 4000
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":4000" ^| findstr "LISTENING"') do (
    taskkill /PID %%a /F >nul 2>nul
)

REM Check that Node.js is installed
where node >nul 2>nul
if errorlevel 1 (
  echo  ERROR: Node.js is NOT installed.
  echo  Please install from: https://nodejs.org  (choose LTS version)
  echo.
  pause
  exit /b
)

REM Install dependencies on first run
if not exist node_modules (
  echo  First-time setup: installing packages, please wait...
  call npm install
  echo.
)

echo  Server is starting...
echo  Keep this window open while using the app.
echo  Close this window to stop the server.
echo.

REM Open browser after 3 seconds - try Edge first, then Chrome
start "" cmd /c "timeout /t 3 >nul && (start msedge http://localhost:4000 2>nul || start chrome http://localhost:4000 2>nul || start http://localhost:4000)"

echo  ============================================
echo   App will open at: http://localhost:4000
echo  ============================================
echo.

REM Start the server
node server/index.js

pause
