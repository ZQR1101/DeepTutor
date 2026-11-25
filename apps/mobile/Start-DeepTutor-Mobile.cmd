@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-android.ps1" %*
set "dt_result=%errorlevel%"
if not "%dt_result%"=="0" pause
exit /b %dt_result%
