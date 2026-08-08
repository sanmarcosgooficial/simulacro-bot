@echo off
title CRM San Marcos - Iniciando...
color 0B

echo.
echo  ==========================================
echo   CRM IA - Simulacros San Marcos
echo  ==========================================
echo.

echo  [1/2] Iniciando Backend...
start "Backend CRM" cmd /k "cd backend && npx @nestjs/cli start --watch"

timeout /t 5 /nobreak >nul

echo  [2/2] Iniciando Frontend...
start "Frontend CRM" cmd /k "cd frontend && npx next dev -p 3000"

echo.
echo  ==========================================
echo   Sistema iniciado correctamente!
echo  ==========================================
echo.
echo  Abre tu navegador en:
echo   http://localhost:3000
echo.
echo  Usuario: admin@sanmarcos.com
echo  Clave:   Admin1234!
echo.
timeout /t 8 /nobreak >nul
start http://localhost:3000
