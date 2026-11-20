@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "NODE_EXE="
where node >nul 2>nul && set "NODE_EXE=node"

rem fallback: the portable node shipped with WorkBuddy on this machine
if not defined NODE_EXE (
  for /d %%D in ("%USERPROFILE%\.workbuddy\binaries\node\versions\*") do (
    if exist "%%D\node.exe" set "NODE_EXE=%%D\node.exe"
  )
)

if not defined NODE_EXE (
  echo [x] node not found. install Node.js 18+ from https://nodejs.org
  pause
  exit /b 1
)

"%NODE_EXE%" bin\skilltidy.js %*
if errorlevel 1 pause
