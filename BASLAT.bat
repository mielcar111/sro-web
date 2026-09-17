@echo off
chcp 65001 >nul
title Silkroad Online - Oyun Sunucusu
cd /d "%~dp0server"

if not exist config.json (
  echo.
  echo [HATA] server\config.json bulunamadi.
  echo.
  echo Once config.example.json dosyasini config.json adiyla kopyalayin ve
  echo icindeki "user" / "password" alanlarina KENDI SQL bilgilerinizi yazin:
  echo.
  echo     copy config.example.json config.json
  echo     notepad config.json
  echo.
  echo Ayrintili kurulum: README.md
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Bagimliliklar kuruluyor - ilk calistirmada bir kez, internet gerekir...
  call npm install
  if errorlevel 1 (
    echo.
    echo [HATA] npm install basarisiz. Node.js 18+ kurulu mu? https://nodejs.org
    pause
    exit /b 1
  )
)

echo.
echo ============================================
echo   Serwer Silkroad Online uruchamia się.
echo   Tarayici: http://localhost:3000
echo ============================================
echo.
node server.js
pause
