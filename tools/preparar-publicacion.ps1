# ============================================================
#  EnRuta Delivery - Prepara la carpeta para publicar en un hosting
# ------------------------------------------------------------
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\preparar-publicacion.ps1
#    powershell -ExecutionPolicy Bypass -File tools\preparar-publicacion.ps1 -Url "https://midominio.com"
#
#  Genera dist\web con SOLO los archivos publicos (sin admin,
#  sin servidor, sin JSON internos) y un ZIP listo para subir.
# ============================================================

param(
  [string]$Destino = '',
  [string]$Url = '',
  [switch]$Zip
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if ([string]::IsNullOrWhiteSpace($Destino)) {
  $Destino = Join-Path $root 'dist\web'
}

Write-Host ''
Write-Host '  EnRuta Delivery - preparar publicacion' -ForegroundColor Yellow
Write-Host '  --------------------------------------'

if (Test-Path -LiteralPath $Destino) {
  Remove-Item -LiteralPath $Destino -Recurse -Force
}
New-Item -ItemType Directory -Path $Destino -Force | Out-Null

$archivos = @('index.html', 'privacidad.html', '404.html', 'robots.txt', 'ads.txt', 'sitemap.xml')
foreach ($archivo in $archivos) {
  $origen = Join-Path $root $archivo
  if (Test-Path -LiteralPath $origen) {
    Copy-Item -LiteralPath $origen -Destination (Join-Path $Destino $archivo) -Force
    Write-Host "  + $archivo"
  }
}

foreach ($carpeta in @('css', 'js', 'assets')) {
  $origen = Join-Path $root $carpeta
  if (Test-Path -LiteralPath $origen) {
    Copy-Item -LiteralPath $origen -Destination (Join-Path $Destino $carpeta) -Recurse -Force
    Write-Host "  + $carpeta\"
  }
}

# Solo las imagenes de data (los catalogos ya vienen dentro de js\catalogo.js)
$imagenes = Get-ChildItem -LiteralPath (Join-Path $root 'data') -Recurse -File -ErrorAction SilentlyContinue |
  Where-Object { $_.Extension -match '^\.(webp|jpg|jpeg|png|gif|svg)$' }
foreach ($img in $imagenes) {
  $rel = $img.FullName.Substring($root.Length).TrimStart('\')
  $dst = Join-Path $Destino $rel
  $carpetaDst = Split-Path -Parent $dst
  if (-not (Test-Path -LiteralPath $carpetaDst)) {
    New-Item -ItemType Directory -Path $carpetaDst -Force | Out-Null
  }
  Copy-Item -LiteralPath $img.FullName -Destination $dst -Force
}
Write-Host ("  + data\ ({0} imagenes)" -f $imagenes.Count)

# GitHub Pages ignora carpetas que empiezan con guion bajo si no existe .nojekyll
New-Item -ItemType File -Path (Join-Path $Destino '.nojekyll') -Force | Out-Null

# En la copia publica no hay backend: avisa a app.js para no consultar /api/estado
$indexRuta = Join-Path $Destino 'index.html'
if (Test-Path -LiteralPath $indexRuta) {
  $texto = [IO.File]::ReadAllText($indexRuta)
  $texto = $texto -replace '<meta name="enruta-backend" content="auto">', '<meta name="enruta-backend" content="none">'
  [IO.File]::WriteAllText($indexRuta, $texto, (New-Object Text.UTF8Encoding($false)))
}

if (-not [string]::IsNullOrWhiteSpace($Url)) {
  $base = $Url.TrimEnd('/')
  $sitemapRuta = Join-Path $Destino 'sitemap.xml'
  if (Test-Path -LiteralPath $sitemapRuta) {
    $texto = [IO.File]::ReadAllText($sitemapRuta)
    $texto = $texto -replace 'https://yeisonjuan12-blip\.github\.io/enruta-delivery', $base
    [IO.File]::WriteAllText($sitemapRuta, $texto, (New-Object Text.UTF8Encoding($false)))
  }
  $robotsRuta = Join-Path $Destino 'robots.txt'
  if (Test-Path -LiteralPath $robotsRuta) {
    $texto = [IO.File]::ReadAllText($robotsRuta)
    $texto = $texto -replace 'https://yeisonjuan12-blip\.github\.io/enruta-delivery', $base
    [IO.File]::WriteAllText($robotsRuta, $texto, (New-Object Text.UTF8Encoding($false)))
  }

  # La pagina 404 usa rutas absolutas: ajustalas a la ruta del sitio publicado.
  $rutaSitio = ([Uri]$base).AbsolutePath.TrimEnd('/')
  if ([string]::IsNullOrWhiteSpace($rutaSitio)) { $rutaSitio = '/' }
  $errRuta = Join-Path $Destino '404.html'
  if (Test-Path -LiteralPath $errRuta) {
    $texto = [IO.File]::ReadAllText($errRuta)
    $texto = $texto -replace '/enruta-delivery/', ($rutaSitio.TrimEnd('/') + '/')
    [IO.File]::WriteAllText($errRuta, $texto, (New-Object Text.UTF8Encoding($false)))
  }
  Write-Host "  URL publica: $base"
}

if ($Zip) {
  $zipRuta = Join-Path $root 'dist\enruta-web.zip'
  if (Test-Path -LiteralPath $zipRuta) { Remove-Item -LiteralPath $zipRuta -Force }
  Compress-Archive -Path (Join-Path $Destino '*') -DestinationPath $zipRuta -Force
  Write-Host "  ZIP: $zipRuta" -ForegroundColor Green
}

$total = Get-ChildItem -LiteralPath $Destino -Recurse -File | Measure-Object Length -Sum
Write-Host ''
Write-Host ("  Listo: {0} archivos, {1:N1} MB" -f $total.Count, ($total.Sum / 1MB)) -ForegroundColor Green
Write-Host "  Carpeta: $Destino"
Write-Host ''
