# build-local.ps1
# Script para compilar el instalador ejecutable de Winamp en el disco local C:
# Esto evita los bloqueos de archivos del controlador virtual de Google Drive (G:\).

$TempDir = "C:\Users\agust\winamp-build"
$SourceDir = "G:\Mi unidad\Mis Apps\Winamp"

Write-Host "1. Creando directorio local de compilacion en $TempDir..." -ForegroundColor Green
if (Test-Path $TempDir) {
    Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
}
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

Write-Host "2. Copiando archivos de codigo desde Google Drive..." -ForegroundColor Green
# Copiar excluyendo carpetas conflictivas
Get-ChildItem -Path $SourceDir -Exclude "node_modules", ".git", "dist", "dist-electron" | ForEach-Object {
    Copy-Item -Path $_.FullName -Destination $TempDir -Recurse -Force
}

Write-Host "3. Instalando dependencias en el disco local C: (este paso sera rapido)..." -ForegroundColor Green
Push-Location $TempDir
npm install --no-audit --no-fund

Write-Host "4. Compilando y empaquetando aplicacion para Windows..." -ForegroundColor Green
npm run electron:pack

Write-Host "5. Copiando el ejecutable final de vuelta a Google Drive..." -ForegroundColor Green
if (!(Test-Path "$SourceDir\dist-electron")) {
    New-Item -ItemType Directory -Force -Path "$SourceDir\dist-electron" | Out-Null
}
Copy-Item -Path "$TempDir\dist-electron\*" -Destination "$SourceDir\dist-electron" -Recurse -Force

Write-Host "5.1. Actualizando instalacion local en C:\Users\agust\Winamp..." -ForegroundColor Green
if (Test-Path "C:\Users\agust\Winamp") {
    Copy-Item -Path "$TempDir\dist-electron\win-unpacked\*" -Destination "C:\Users\agust\Winamp" -Recurse -Force
    Get-ChildItem -Path "C:\Users\agust\Winamp" -Recurse | Unblock-File -ErrorAction SilentlyContinue
    Write-Host "Archivos en C:\Users\agust\Winamp actualizados y desbloqueados correctamente." -ForegroundColor Cyan
}

Pop-Location
Write-Host "6. Limpiando archivos temporales locales..." -ForegroundColor Green
Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`n[EXITO] El instalador ejecutable se ha creado y copiado correctamente." -ForegroundColor Cyan
Write-Host "Lo puedes encontrar en: $SourceDir\dist-electron y en C:\Users\agust\Winamp\winamp.exe" -ForegroundColor Cyan

