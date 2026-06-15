@echo off
pushd "%~dp0"
if exist "%~dp0node\node.exe" (
  "%~dp0node\node.exe" server.js
) else (
  node server.js
)
popd
pause
