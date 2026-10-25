@echo off
setlocal EnableDelayedExpansion
title Compilar SkylandersApp

REM ============================================================
REM  Coloca este archivo en la carpeta raiz del proyecto
REM  (la que contiene config.xml, package.json y la carpeta www)
REM ============================================================
cd /d "%~dp0"

if not exist "config.xml" (
    echo [ERROR] No encuentro config.xml. Pon este .bat en la raiz del proyecto.
    pause
    exit /b 1
)

echo.
echo ================= COMPROBANDO REQUISITOS =================

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado. Descargalo en https://nodejs.org
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo Node.js: %%v

where java >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Java JDK no esta instalado. Cordova Android 14 necesita JDK 17.
    pause
    exit /b 1
)

if "%ANDROID_HOME%"=="" if "%ANDROID_SDK_ROOT%"=="" (
    if exist "%LOCALAPPDATA%\Android\Sdk" (
        set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
    ) else (
        echo [ERROR] No encuentro el Android SDK. Instala Android Studio o define ANDROID_HOME.
        pause
        exit /b 1
    )
)
if "%ANDROID_HOME%"=="" set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
if "%ANDROID_SDK_ROOT%"=="" set "ANDROID_SDK_ROOT=%ANDROID_HOME%"
echo Android SDK: %ANDROID_HOME%

where cordova >nul 2>nul
if errorlevel 1 (
    echo Cordova no esta instalado. Instalando...
    call npm install -g cordova
    if errorlevel 1 (
        echo [ERROR] No se pudo instalar Cordova.
        pause
        exit /b 1
    )
)

REM ---- Gradle: Cordova lo necesita para generar el wrapper ----
set "GRADLE_VER=8.13"
set "GRADLE_DIR=%LOCALAPPDATA%\gradle-%GRADLE_VER%"
where gradle >nul 2>nul
if not errorlevel 1 goto gradle_ok
if exist "%GRADLE_DIR%\bin\gradle.bat" goto gradle_path
echo Gradle no esta instalado. Descargando Gradle %GRADLE_VER% (una sola vez)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://services.gradle.org/distributions/gradle-%GRADLE_VER%-bin.zip' -OutFile '%TEMP%\gradle-%GRADLE_VER%.zip'"
if errorlevel 1 goto gradle_fail
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -Force '%TEMP%\gradle-%GRADLE_VER%.zip' '%LOCALAPPDATA%'"
if errorlevel 1 goto gradle_fail
if not exist "%GRADLE_DIR%\bin\gradle.bat" goto gradle_fail
:gradle_path
set "PATH=%GRADLE_DIR%\bin;%PATH%"
:gradle_ok
for /f "delims=" %%v in ('gradle -v ^| findstr /b "Gradle"') do echo %%v
goto gradle_done
:gradle_fail
echo [ERROR] No se pudo instalar Gradle automaticamente.
echo Descargalo de https://gradle.org/releases (binary-only), descomprimelo
echo y anade su carpeta bin al PATH de Windows.
pause
exit /b 1
:gradle_done

if not exist "node_modules" (
    echo Instalando dependencias del proyecto...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install ha fallado.
        pause
        exit /b 1
    )
)

if not exist "platforms\android" (
    echo Anadiendo la plataforma Android...
    call cordova platform add android
    if errorlevel 1 (
        echo [ERROR] No se pudo anadir la plataforma Android.
        pause
        exit /b 1
    )
)

:menu
echo.
echo ======================== MENU ============================
echo   1. Compilar DEBUG (APK instalable directamente)
echo   2. Limpiar y compilar DEBUG desde cero
echo   3. Compilar RELEASE (sin firmar)
echo   4. Compilar DEBUG e instalar en el movil por USB (adb)
echo   5. Salir
echo ==========================================================
set /p opcion="Elige una opcion [1-5]: "

if "%opcion%"=="1" goto debug
if "%opcion%"=="2" goto clean
if "%opcion%"=="3" goto release
if "%opcion%"=="4" goto install
if "%opcion%"=="5" exit /b 0
goto menu

:clean
echo Limpiando...
call cordova clean android
if exist "platforms\android\app\build" rmdir /s /q "platforms\android\app\build"
goto debug

:debug
echo.
echo Copiando www a la plataforma Android...
call cordova prepare android
if errorlevel 1 goto fallo
echo Compilando DEBUG...
call cordova build android --debug
if errorlevel 1 goto fallo
set "APK=platforms\android\app\build\outputs\apk\debug\app-debug.apk"
goto copiar

:release
echo.
call cordova prepare android
if errorlevel 1 goto fallo
echo Compilando RELEASE...
call cordova build android --release
if errorlevel 1 goto fallo
set "APK=platforms\android\app\build\outputs\apk\release\app-release-unsigned.apk"
echo.
echo AVISO: el APK release sale SIN FIRMAR y Android no lo instala hasta firmarlo.
goto copiar

:install
call cordova prepare android
if errorlevel 1 goto fallo
call cordova build android --debug
if errorlevel 1 goto fallo
set "APK=platforms\android\app\build\outputs\apk\debug\app-debug.apk"
set "ADB=%ANDROID_HOME%\platform-tools\adb.exe"
if not exist "%ADB%" (
    echo [ERROR] No encuentro adb en %ADB%
    goto copiar
)
echo Instalando en el movil (activa la depuracion USB)...
"%ADB%" install -r "%APK%"
if errorlevel 1 echo [AVISO] La instalacion por adb ha fallado.
goto copiar

:copiar
if not exist "%APK%" (
    echo [ERROR] No se genero el APK esperado: %APK%
    goto fallo
)
if not exist "salida" mkdir "salida"
set "DESTINO=salida\SkylandersApp_%date:~-4%%date:~3,2%%date:~0,2%_%time:~0,2%%time:~3,2%.apk"
set "DESTINO=!DESTINO: =0!"
copy /y "%APK%" "!DESTINO!" >nul
echo.
echo ==========================================================
echo  LISTO. APK guardado en: !DESTINO!
echo ==========================================================
start "" "salida"
pause
exit /b 0

:fallo
echo.
echo ==========================================================
echo  [ERROR] La compilacion ha fallado. Revisa los mensajes de arriba.
echo ==========================================================
pause
exit /b 1
