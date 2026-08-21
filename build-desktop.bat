@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "ROOT=%~dp0"

echo [1/7] Checking toolchain...

set "CODEX_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
set "CODEX_PNPM=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback"
if exist "%CODEX_NODE%\node.exe" set "PATH=%CODEX_NODE%;%PATH%"
if exist "%CODEX_PNPM%\pnpm.cmd" set "PATH=%CODEX_PNPM%;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install Node.js 22.19+ or 24+.
  exit /b 1
)

node -e "const [maj,min]=process.versions.node.split('.').map(Number);const ok=(maj===22&&min>=19)||maj>=24;if(!ok){console.error('Unsupported Node.js '+process.versions.node);process.exit(1)}"
if errorlevel 1 (
  echo ERROR: Node.js 22.19+ or 24+ is required. Found:
  node -p "process.versions.node"
  exit /b 1
)

where pnpm >nul 2>nul
if errorlevel 1 (
  echo ERROR: pnpm was not found.
  exit /b 1
)

where cargo >nul 2>nul
if errorlevel 1 (
  echo ERROR: Rust MSVC toolchain was not found. Install it from https://rustup.rs
  exit /b 1
)

echo Node:
node -p "process.version"
echo pnpm:
call pnpm --version
echo cargo:
call cargo --version

echo.
set "npm_config_confirm_modules_purge=false"
echo [2/7] Installing project dependencies...
call pnpm install
if errorlevel 1 (
  echo ERROR: pnpm install failed.
  exit /b 1
)

echo.
echo [3/7] Building libraries and Web frontend...
call pnpm run build
if errorlevel 1 (
  echo ERROR: dsh build failed.
  exit /b 1
)

echo.
echo [4/7] Preparing embedded dsh bundle and Node runtime...
cd /d "%ROOT%apps\desktop"
call pnpm run prepare:bundle
if errorlevel 1 (
  echo ERROR: desktop bundle preparation failed.
  exit /b 1
)

echo.
echo [5/7] Building desktop shell executable...
call pnpm run build:no-bundle
if errorlevel 1 (
  echo ERROR: desktop shell build failed.
  exit /b 1
)

echo.
echo [6/7] Building desktop installer executable...
set "BUNDLED_NODE=%ROOT%apps\desktop\bundle\node\node.exe"
powershell -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command ^
  "$target=[System.IO.Path]::GetFullPath($env:BUNDLED_NODE); $self=$PID; $victims=Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $self -and ($_.ExecutablePath -eq $target -or ($_.CommandLine -ne $null -and $_.CommandLine.Contains($target))) }; if($victims.Count -gt 0){ $names=($victims | ForEach-Object { ('{0}({1})' -f $_.Name, $_.ProcessId) }) -join ', '; Write-Host ('Stopping processes locking ' + $target + ': ' + $names); $victims | ForEach-Object { Stop-Process -Id $_.ProcessId -Force } }"
if errorlevel 1 (
  echo ERROR: failed to clear processes using %BUNDLED_NODE%.
  exit /b 1
)
cd /d "%ROOT%apps\desktop-installer"
call pnpm run build:setup
if errorlevel 1 (
  echo ERROR: desktop installer build failed. Check the Rust toolchain and network access.
  exit /b 1
)

echo.
echo [7/7] Locating outputs...
echo Desktop shell executable: %ROOT%apps\desktop\src-tauri\target\release\dsh-desktop.exe
echo Installer executable: %ROOT%apps\desktop-installer\src-tauri\target\release\dsh-desktop-installer.exe

echo.
echo Done.
endlocal
