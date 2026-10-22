@echo off
cd /d "%~dp0"
title Vornetic
if not exist node_modules (
  echo Paketler kuruluyor...
  call npm install
)
start "" http://localhost:3300
node --env-file-if-exists=.env server.js
pause
