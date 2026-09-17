@echo off
chcp 65001 >nul
title Silkroad Online - Serwer gry
cd /d "%~dp0server"

if not exist config.json (
  echo.
  echo [BLAD] Nie znaleziono pliku server\config.json.
  echo.
  echo Najpierw skopiuj plik config.example.json jako config.json i wpisz
  echo w polach "user" / "password" WLASNE dane dostepowe do SQL Servera:
  echo.
  echo     copy config.example.json config.json
  echo     notepad config.json
  echo.
  echo Szczegolowa instrukcja: README.md
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instaluje zaleznosci — jednorazowo przy pierwszym uruchomieniu, wymagany internet...
  call npm install
  if errorlevel 1 (
    echo.
    echo [BLAD] npm install nie powiodl sie. Czy Node.js 18+ jest zainstalowany? https://nodejs.org
    pause
    exit /b 1
  )
)

echo.
echo ============================================
echo   Serwer Silkroad Online uruchamia sie.
echo   Przegladarka: http://localhost:3000
echo ============================================
echo.
node server.js
pause