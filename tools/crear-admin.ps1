# ============================================================
#  EnRuta Delivery - Crear / restablecer el administrador
#  ------------------------------------------------------------
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1
#    powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1 -Usuario admin -Password "MiClaveSegura123"
#    powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1 -Resetear
#
#  La contrasena se guarda con PBKDF2-SHA256 (120000 iteraciones).
#  Nunca se escribe en texto plano ni se muestra en la web.
# ============================================================

param(
  [string]$Usuario = 'admin',
  [string]$Nombre = 'Administrador',
  [string]$Password = '',
  [switch]$Resetear
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $root 'server\lib\comun.ps1')
. (Join-Path $root 'server\lib\auth.ps1')

Inicializar-Auth

function Nueva-PasswordAleatoria {
  $letras = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  $numeros = '23456789'
  $simbolos = '!@#$%&*?'
  $todos = $letras + $numeros + $simbolos
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 64
  $rng.GetBytes($bytes)
  $rng.Dispose()
  $chars = New-Object System.Collections.ArrayList
  [void]$chars.Add($letras[$bytes[0] % $letras.Length])
  [void]$chars.Add($numeros[$bytes[1] % $numeros.Length])
  [void]$chars.Add($simbolos[$bytes[2] % $simbolos.Length])
  for ($i = 3; $i -lt 18; $i++) {
    [void]$chars.Add($todos[$bytes[$i] % $todos.Length])
  }
  # Mezclar
  for ($i = $chars.Count - 1; $i -gt 0; $i--) {
    $j = $bytes[20 + ($i % 20)] % ($i + 1)
    $tmp = $chars[$i]; $chars[$i] = $chars[$j]; $chars[$j] = $tmp
  }
  return (-join $chars)
}

$usuarios = @((Leer-Usuarios).usuarios)
$existe = $null
foreach ($u in $usuarios) { if ([string]$u.usuario -eq (Normalizar-Usuario $Usuario)) { $existe = $u } }

if ($null -ne $existe -and -not $Resetear) {
  Write-Host ''
  Write-Host "El usuario '$Usuario' ya existe." -ForegroundColor Yellow
  Write-Host 'Para cambiar su contrasena usa -Resetear.' -ForegroundColor Yellow
  Write-Host ''
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  $Password = Nueva-PasswordAleatoria
  $generada = $true
} else {
  $generada = $false
  if ($Password.Length -lt 10 -or $Password -notmatch '[A-Za-z]' -or $Password -notmatch '[0-9]') {
    Write-Host 'La contrasena debe tener al menos 10 caracteres y combinar letras y numeros.' -ForegroundColor Red
    exit 1
  }
}

if ($null -ne $existe) {
  Actualizar-PasswordUsuario $Usuario $Password
  if ($Nombre -and $Nombre -ne 'Administrador') {
    $doc = Leer-Usuarios
    foreach ($u in @($doc.usuarios)) { if ([string]$u.usuario -eq (Normalizar-Usuario $Usuario)) { $u.nombre = $Nombre } }
    Guardar-Usuarios $doc
  }
  Write-Host ''
  Write-Host "Contrasena restablecida para '$Usuario'." -ForegroundColor Green
} else {
  $registro = Nuevo-RegistroUsuario $Usuario $Nombre $Password 'admin' $null
  Write-Host ''
  Write-Host "Administrador '$($registro.usuario)' creado." -ForegroundColor Green
}

Write-Host ''
Write-Host '  Usuario   : ' -NoNewline; Write-Host $Usuario -ForegroundColor Yellow
if ($generada) {
  Write-Host '  Contrasena: ' -NoNewline; Write-Host $Password -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Guarda esta contrasena ahora. No se volvera a mostrar.' -ForegroundColor Red
  Write-Host '  Cambiala despues de tu primer ingreso (pestana Cuenta).' -ForegroundColor DarkYellow
} else {
  Write-Host '  Contrasena: (la que indicaste en el parametro)' -ForegroundColor DarkGray
}
Write-Host ''
Write-Host '  Ingresa en: /admin  (con el servidor iniciado)' -ForegroundColor DarkGray
Write-Host ''

# Desactivar el archivo heredado con hash debil (ya no se usa).
$legado = Join-Path $root 'data\admin.json'
try {
  $contenido = [ordered]@{
    version     = 1
    deshabilitado = $true
    nota        = 'Este archivo pertenece al panel antiguo y ya no se usa. La autenticacion real esta en server/datos/usuarios.json.'
  }
  [IO.File]::WriteAllText($legado, ((Convertir-AJsonBonito $contenido) + "`n"), (New-Object Text.UTF8Encoding($false)))
} catch { }
