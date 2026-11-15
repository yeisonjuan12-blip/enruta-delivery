# ============================================================
#  EnRuta Delivery · Verificar precios de referencia (Plaza Vea)
#  ------------------------------------------------------------
#  Consulta el catálogo público de Plaza Vea (API VTEX) para
#  cada producto de Licores y Primera necesidad y compara el
#  precio actual con el guardado en "precioReferencia".
#
#  IMPORTANTE:
#   - NUNCA modifica "precioVenta" ni "margenConfigurado".
#   - Sin -Actualizar solo compara y muestra diferencias.
#   - Con -Actualizar guarda precioReferencia y la fecha de
#     verificación. No cambia la disponibilidad salvo que uses
#     -ActualizarDisponibilidad de forma explícita.
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\verificar-plazavea.ps1
#    powershell -ExecutionPolicy Bypass -File tools\verificar-plazavea.ps1 -Actualizar
#    powershell -ExecutionPolicy Bypass -File tools\verificar-plazavea.ps1 -Actualizar -ActualizarDisponibilidad
# ============================================================

param(
  [switch]$Actualizar,
  [switch]$ActualizarDisponibilidad
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Web.Extensions
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$archivos = @(
  (Join-Path $root 'data\licores\productos.json'),
  (Join-Path $root 'data\primera-necesidad\productos.json')
)
$reportePath = Join-Path $root 'data\reporte-precios.json'
$hoy = Get-Date -Format 'yyyy-MM-dd'

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

$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 50000000

function Consultar-PlazaVea {
  param([string]$ProductoId)
  $url = 'https://www.plazavea.com.pe/api/catalog_system/pub/products/search?fq=productId:' +
    [Uri]::EscapeDataString($ProductoId) + '&_from=0&_to=2'
  $wc = New-Object Net.WebClient
  $wc.Headers.Add('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
  $wc.Headers.Add('Accept', 'application/json')
  $texto = [Text.Encoding]::UTF8.GetString($wc.DownloadData($url))
  $r = $ser.DeserializeObject($texto)
  if ($null -eq $r -or $r.Count -eq 0) { return $null }
  $p = $r[0]
  $oferta = $p['items'][0]['sellers'][0]['commertialOffer']
  if ($null -eq $oferta) { return $null }
  return [ordered]@{
    nombre     = [string]$p['productName']
    precio     = [double]$oferta['Price']
    stock      = [int]$oferta['AvailableQuantity']
    disponible = [bool]$oferta['IsAvailable']
  }
}

$filas = New-Object System.Collections.ArrayList
$cambios = 0
$noEncontrados = 0

Write-Host ""
Write-Host "EnRuta Delivery · verificando precios de referencia en Plaza Vea" -ForegroundColor Yellow
Write-Host "Modo: $(if ($Actualizar) { 'ACTUALIZAR referencia' } else { 'solo comparar (sin cambios)' })"
Write-Host ""

foreach ($archivo in $archivos) {
  if (-not (Test-Path -LiteralPath $archivo)) {
    Write-Host "AVISO: no existe $archivo" -ForegroundColor DarkYellow
    continue
  }
  $doc = Get-Content -LiteralPath $archivo -Raw -Encoding UTF8 | ConvertFrom-Json
  $nombreCat = Split-Path -Parent $archivo | Split-Path -Leaf
  Write-Host "· $nombreCat" -ForegroundColor Cyan

  foreach ($p in @($doc.productos)) {
    $prodId = $null
    if ($null -ne $p.fuente) { $prodId = [string]$p.fuente.productoId }
    if ([string]::IsNullOrWhiteSpace($prodId)) {
      Write-Host "  - $($p.id) · sin productoId en fuente; se omite" -ForegroundColor DarkYellow
      continue
    }

    try {
      $actual = Consultar-PlazaVea $prodId
    } catch {
      Write-Host "  - $($p.id) · error al consultar: $($_.Exception.Message)" -ForegroundColor Red
      continue
    }
    if ($null -eq $actual) {
      Write-Host "  - $($p.id) · no encontrado en Plaza Vea (productoId $prodId)" -ForegroundColor DarkYellow
      $noEncontrados++
      continue
    }

    $refGuardada = $null
    if ($null -ne $p.precioReferencia -and "$($p.precioReferencia)" -ne '') {
      $refGuardada = [double]$p.precioReferencia
    }

    $delta = $null
    if ($null -ne $refGuardada) { $delta = [Math]::Round($actual.precio - $refGuardada, 2) }
    $cambio = ($null -eq $refGuardada) -or ([Math]::Abs([double]$delta) -ge 0.01)

    $stockTxt = "stock $($actual.stock)"
    $estadoTxt = if ($cambio) { "ACTUALIZAR" } else { "igual" }
    if ($cambio) {
      $cambios++
      Write-Host ("  - {0} · {1} · ref {2} -> {3} · {4}" -f `
        $p.id, $actual.nombre, $refGuardada, $actual.precio, $stockTxt) -ForegroundColor Yellow
    } else {
      Write-Host ("  - {0} · ref {1} · {2}" -f $p.id, $refGuardada, $stockTxt)
    }

    if ($Actualizar -and $cambio) {
      $p.precioReferencia = $actual.precio
      $p.fuente.fechaVerificacion = $hoy
      $p.fuente.metodo = 'Catálogo público VTEX'
    }

    $dispCambia = ([bool]($p.disponible -ne $false)) -ne $actual.disponible
    if ($ActualizarDisponibilidad -and $dispCambia) {
      $p.disponible = $actual.disponible
      if ($actual.disponible) {
        if ($p.estado -eq 'agotado') { $p.estado = 'verificado' }
      } else {
        $p.estado = 'agotado'
      }
      Write-Host "      disponibilidad -> $($actual.disponible) (estado $($p.estado))" -ForegroundColor Yellow
    } elseif ($dispCambia) {
      Write-Host "      AVISO: la disponibilidad de la fuente cambió; usa -ActualizarDisponibilidad si corresponde." -ForegroundColor DarkYellow
    }

    [void]$filas.Add([ordered]@{
      archivo             = $nombreCat
      id                  = $p.id
      nombre              = $actual.nombre
      productoId          = $prodId
      precioReferencia    = $refGuardada
      precioFuente        = $actual.precio
      diferencia          = $delta
      stock               = $actual.stock
      disponibleFuente    = $actual.disponible
      disponibleGuardado  = [bool]($p.disponible -ne $false)
      requiereActualizar  = $cambio
    })

    Start-Sleep -Milliseconds 350
  }

  if ($Actualizar) {
    Escribir-Json $archivo $doc
  }
}

$reporte = [ordered]@{
  generadoEn      = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
  modo            = if ($Actualizar) { 'actualizar' } else { 'comparar' }
  actualizoStock  = [bool]$ActualizarDisponibilidad
  cambios         = $cambios
  noEncontrados   = $noEncontrados
  productos       = @($filas)
}
Escribir-Json $reportePath $reporte

Write-Host ""
Write-Host "Resumen" -ForegroundColor Yellow
Write-Host "  Productos revisados: $($filas.Count)"
Write-Host "  Referencias distintas: $cambios"
Write-Host "  No encontrados: $noEncontrados"
Write-Host "  Reporte: data\reporte-precios.json"

if (-not $Actualizar -and $cambios -gt 0) {
  Write-Host ""
  Write-Host "No se modificó ningún archivo. Para guardar solo las referencias:" -ForegroundColor Yellow
  Write-Host "  powershell -ExecutionPolicy Bypass -File tools\verificar-plazavea.ps1 -Actualizar"
}
if ($Actualizar) {
  Write-Host ""
  Write-Host "Referencias actualizadas. precioVenta NO fue modificado." -ForegroundColor Green
  Write-Host "Ejecuta tools\importar.ps1 para regenerar la web." -ForegroundColor Green
}
Write-Host ""
exit 0
