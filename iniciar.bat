@echo off
title Moment Motorsport - Sistema de Gestao
cd /d "%~dp0"
echo.
echo  =============================================
echo   Moment Motorsport - Sistema de Gestao
echo  =============================================
echo.
echo  Iniciando servidor...
echo  Abrindo o navegador em: http://localhost:3030
echo.
echo  Pressione Ctrl+C para encerrar
echo.
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3030"
node servidor.js
pause
