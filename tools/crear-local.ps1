# ============================================================
#  EnRuta Delivery · Crear un local nuevo
#  ------------------------------------------------------------
#  Crea la carpeta data\locales\<id> con local.json y
#  productos.json vacío, y registra el local en locales.json.
#
#  El local se crea como NO publicado para que puedas completar
#  fotos, carta y precios reales antes de mostrarlo en la web.
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\crear-local.ps1 ^
#      -Id "pizzeria-napoli" ^
#      -Nombre "Pizzería Napoli" ^
#      -CategoriaId "pizzas" ^
#      -Tipo "comida"
#
#  Categorías disponibles: data\locales\categorias.json
#  Tipos válidos: comida | productos
# ============================================================

param(
  [Parameter(Mandatory = $true)][string]$Id,
  [Parameter(Mandatory = $true)][string]$Nombre,
  [Parameter(Mandatory = $true)][string]$CategoriaId,
  [ValidateSet('comida', 'productos')][string]$Tipo = 'comida',
  [string]$Descripcion = 'Completa aquí una descripción breve y real del local.',
  [string]$Emoji = '🛍️',
  [string]$HorarioLocal = '',
  [switch]$Publicado
)

$ErrorActionPreference = 'Stop'

$root     = Split-Path -Parent $PSScriptRoot
$locales  = Join-Path $root 'data\locales'
$indice   = Join-Path $locales 'locales.json'
$catsPath = Join-Path $locales 'categorias.json'

$slug = $Id.Trim().ToLowerInvariant()
if ($slug -notmatch '^[a-z0-9][a-z0-9-]{1,40}$') {
  Write-Host "ERROR: el id debe usar minúsculas, números y guiones (2 a 41 caracteres)." -ForegroundColor Red
  exit 1
}
if (-not (Test-Path -LiteralPath $catsPath)) {
  Write-Host "ERROR: no existe data\locales\categorias.json" -ForegroundColor Red
  exit 1
}

$cats = Get-Content -LiteralPath $catsPath -Raw -Encoding UTF8 | ConvertFrom-Json
$mapa = @{}
foreach ($c in @($cats.categorias)) { $mapa[$c.id] = $c.nombre }
if (-not $mapa.ContainsKey($CategoriaId)) {
  Write-Host "ERROR: la categoría '$CategoriaId' no existe. Valores permitidos:" -ForegroundColor Red
  $mapa.Keys | Sort-Object | ForEach-Object { Write-Host "  - $_" }
  exit 1
}

$destino = Join-Path $locales $slug
if (Test-Path -LiteralPath $destino) {
  Write-Host "ERROR: ya existe la carpeta data\locales\$slug" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path -LiteralPath $indice)) {
  Write-Host "ERROR: no existe data\locales\locales.json" -ForegroundColor Red
  exit 1
}
$idx = Get-Content -LiteralPath $indice -Raw -Encoding UTF8 | ConvertFrom-Json
$carpetas = @($idx.locales)
if ($carpetas -contains $slug) {
  Write-Host "ERROR: '$slug' ya está registrado en locales.json" -ForegroundColor Red
  exit 1
}

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Unescape-Json($s) {
  return [regex]::Replace($s, '\\u([0-9a-fA-F]{4})', {
    param($m)
    [string][char][Convert]::ToInt32($m.Groups[1].Value, 16)
  })
}
function Escribir-Json {
  param([string]$Ruta, $Objeto)
  $json = $Objeto | ConvertTo-Json -Depth 20
  $json = Unescape-Json $json
  [IO.File]::WriteAllText($Ruta, $json + "`n", $utf8)
}

$local = [ordered]@{
  id            = $slug
  nombre        = $Nombre.Trim()
  tipo          = $Tipo
  categoriaId   = $CategoriaId
  descripcion   = $Descripcion
  publicado     = [bool]$Publicado
  disponible    = $true
  esEjemplo     = $false
  emoji         = $Emoji
  colores       = @('#fdd303', '#f59e0b')
  logo          = $null
  portada       = $null
  cartaOriginal = $null
  tiempo        = ''
  pedidoMinimo  = 0
  horarioLocal  = $HorarioLocal
  etiquetas     = @()
  empaquetado   = [ordered]@{
    aplica    = $false
    monto     = 0
    porUnidad = $false
    concepto  = 'Empaquetado'
  }
  notas         = 'Local creado con tools\crear-local.ps1. Completar información real antes de publicar.'
}

$productos = [ordered]@{
  version   = 1
  localId   = $slug
  productos = @()
}

New-Item -ItemType Directory -Path $destino | Out-Null
New-Item -ItemType Directory -Path (Join-Path $destino 'img') | Out-Null

Escribir-Json (Join-Path $destino 'local.json') $local
Escribir-Json (Join-Path $destino 'productos.json') $productos

$idx.locales = @($carpetas + $slug)
Escribir-Json $indice $idx

Write-Host ""
Write-Host "Local creado: data\locales\$slug" -ForegroundColor Green
Write-Host "  Nombre:     $($local.nombre)"
Write-Host "  Categoría:  $CategoriaId ($($mapa[$CategoriaId]))"
Write-Host "  Tipo:       $Tipo"
Write-Host "  Publicado:  $([bool]$Publicado)"
Write-Host ""
Write-Host "Siguientes pasos:" -ForegroundColor Yellow
Write-Host "  1. Copia el logo en data\locales\$slug\logo.jpg"
Write-Host "  2. Copia la portada en data\locales\$slug\portada.jpg"
Write-Host "  3. Copia la carta original en data\locales\$slug\carta.jpg (referencia)"
Write-Host "  4. Edita data\locales\$slug\local.json y completa descripción, horario y empaquetado."
Write-Host "  5. Agrega productos REALES con precios verificados en productos.json."
Write-Host "  6. Ejecuta: powershell -ExecutionPolicy Bypass -File tools\importar.ps1"
Write-Host "  7. Cuando todo esté validado, cambia `"publicado`": false a true y vuelve a importar."
Write-Host ""
exit 0
