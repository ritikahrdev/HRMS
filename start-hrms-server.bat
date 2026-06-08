@echo off
REM Auto-start the Hrika HRMS server. Run quietly in the background.
cd /d "%~dp0"

REM If a server is already listening on port 4000, stop it first (prevents
REM "database is locked" from a stale instance).
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4000" ^| findstr "LISTENING" 2^>nul') do (
  taskkill /PID %%a /F >nul 2>nul
)

REM Give the old process a moment to release the database file.
ping 127.0.0.1 -n 3 >nul

REM Start the server (runs in this hidden window).
node server\index.js
