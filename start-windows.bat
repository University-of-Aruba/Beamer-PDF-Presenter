@echo off
setlocal EnableExtensions DisableDelayedExpansion
title Beamer PDF Presenter
cd /d "%~dp0" 2>nul
if errorlevel 1 goto folder_error
if not exist "package-manifest.json" goto extraction_error
if not exist "launch_windows.py" goto extraction_error
if not exist "serve.py" goto extraction_error
if not exist "runtime\python\python.exe" goto runtime_error

"%~dp0runtime\python\python.exe" -I "%~dp0launch_windows.py"
set "BEAMER_EXIT=%errorlevel%"
echo.
if not "%BEAMER_EXIT%"=="0" echo Beamer PDF Presenter could not continue. Read the message above.
pause
exit /b %BEAMER_EXIT%

:extraction_error
echo The application folder is incomplete.
echo Right-click the downloaded ZIP, choose Extract all, and open
echo start-windows.bat from the extracted folder. Do not run it inside the ZIP.
pause
exit /b 1

:runtime_error
echo The bundled Windows runtime is missing.
echo Right-click the downloaded ZIP and choose Extract all again.
echo If workplace security removed or blocked a file, contact IT.
pause
exit /b 1

:folder_error
echo The application folder could not be opened.
echo Extract the ZIP into a writable local folder, such as Downloads,
echo then open start-windows.bat from that extracted folder.
pause
exit /b 1
