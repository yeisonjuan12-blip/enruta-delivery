# ============================================================
#  EnRuta Delivery - Lanzador de compatibilidad
#  ------------------------------------------------------------
#  Este archivo se conserva para no romper habitos o enlaces
#  antiguos. El servidor canonico (web publica, /admin, API,
#  OCR y pedidos) es server\servidor.ps1.
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\servidor.ps1
#    powershell -ExecutionPolicy Bypass -File tools\servidor.ps1 -Puerto 8781 -Abrir
# ============================================================

param(
  [int]$Puerto = 8780,
  [switch]$Abrir
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$servidor = Join-Path $root 'server\servidor.ps1'

if (-not (Test-Path -LiteralPath $servidor)) {
  Write-Host 'No se encontro server\servidor.ps1' -ForegroundColor Red
  exit 1
}

Write-Host ''
Write-Host 'EnRuta Delivery - iniciando servidor canonico...' -ForegroundColor Yellow
Write-Host '  Panel privado: /admin' -ForegroundColor DarkGray
Write-Host ''

$argumentos = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $servidor, '-Puerto', $Puerto)
if ($Abrir) { $argumentos += '-Abrir' }

& powershell @argumentos
exit $LASTEXITCODE
