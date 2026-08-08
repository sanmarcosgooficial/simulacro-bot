@echo off
title CRM San Marcos - Instalación inicial
color 0A

echo.
echo  ==========================================
echo   CRM IA - Instalación inicial
echo  ==========================================
echo.
echo  Este proceso solo se hace una vez.
echo  Tomará unos minutos. Por favor espera...
echo.

REM Verificar Node.js
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js no está instalado.
    echo  Descárgalo en: https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo  [1/2] Instalando pnpm...
npm install -g pnpm
echo.

echo  [2/2] Instalando dependencias del proyecto...
call pnpm install --ignore-scripts
echo.

echo.
echo  ==========================================
echo   Instalacion completada!
echo  ==========================================
echo.
echo  Ahora puedes usar INICIAR.bat para
echo  arrancar el sistema.
echo.
pause
