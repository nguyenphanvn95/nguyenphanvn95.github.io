@echo off
setlocal
cd /d "%~dp0"

set "HOST=127.0.0.1"
set "PORT=8787"
set "URL=http://%HOST%:%PORT%"

echo Starting Xiangqi localhost clone at %URL%
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%PORT% ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>nul
)
timeout /t 1 /nobreak >nul

where py >nul 2>nul
if %errorlevel%==0 goto run_py

where python >nul 2>nul
if %errorlevel%==0 goto run_python

echo Python was not found. Please install Python 3, then run this file again.
pause
goto :end

:run_py
start "" cmd /c "timeout /t 2 /nobreak >nul && start "" "%URL%""
py -3 local_server.py --host %HOST% --port %PORT%
goto :end

:run_python
start "" cmd /c "timeout /t 2 /nobreak >nul && start "" "%URL%""
python local_server.py --host %HOST% --port %PORT%

:end
endlocal
