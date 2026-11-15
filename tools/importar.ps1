# ============================================================
#  EnRuta Delivery · Importador y validador de catálogo
#  ------------------------------------------------------------
#  Lee data/*.json, valida la información y genera js/catalogo.js
#  para que la web funcione incluso abriendo index.html con file://
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\importar.ps1
#    powershell -ExecutionPolicy Bypass -File tools\importar.ps1 -SoloValidar
#
#  Sale con código 1 si hay errores: en ese caso NO se regenera
#  el catálogo público.
# ============================================================

param(
  [switch]$SoloValidar
)

$ErrorActionPreference = 'Stop'

$root        = Split-Path -Parent $PSScriptRoot
$dataDir     = Join-Path $root 'data'
$salidaJs    = Join-Path $root 'js\catalogo.js'
$reportePath = Join-Path $dataDir 'reporte-validacion.json'

$errores       = New-Object System.Collections.ArrayList
$advertencias  = New-Object System.Collections.ArrayList
$idsRegistrados = @{}
$resumen = [ordered]@{
  locales           = 0
  localesPublicados = 0
  localesEjemplo    = 0
  productosLocales  = 0
  licores           = 0
  primeraNecesidad  = 0
}

function Add-Error {
  param([string]$Mensaje)
  [void]$errores.Add($Mensaje)
}

function Add-Aviso {
  param([string]$Mensaje)
  [void]$advertencias.Add($Mensaje)
}

function Leer-Json {
  param([string]$Ruta, [string]$Contexto)
  if (-not (Test-Path -LiteralPath $Ruta)) {
    Add-Error "$Contexto · no existe el archivo: $Ruta"
    return $null
  }
  try {
    return (Get-Content -LiteralPath $Ruta -Raw -Encoding UTF8 | ConvertFrom-Json)
  } catch {
    Add-Error "$Contexto · JSON inválido: $($_.Exception.Message)"
    return $null
  }
}

function Es-Numero {
  param($Valor)
  return ($Valor -is [int] -or $Valor -is [long] -or $Valor -is [double] -or $Valor -is [decimal] -or $Valor -is [single])
}

function Es-Texto {
  param($Valor)
  return ($Valor -is [string] -and $Valor.Trim().Length -gt 0)
}

function Registrar-Id {
  param([string]$Id, [string]$Contexto)
  if (-not (Es-Texto $Id)) { return }
  if ($idsRegistrados.ContainsKey($Id)) {
    Add-Error "ID duplicado '$Id' · ya existe en $($idsRegistrados[$Id]) y se repite en $Contexto"
  } else {
    $idsRegistrados[$Id] = $Contexto
  }
}

function Ruta-Sitio {
  param([string]$RutaCompleta)
  $full = [IO.Path]::GetFullPath($RutaCompleta)
  if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }
  return $full.Substring($root.Length).TrimStart('\', '/').Replace('\', '/')
}

function Resolver-Imagen {
  param(
    [string]$BaseDir,
    $Valor,
    [string]$Contexto
  )
  if ($null -eq $Valor -or -not (Es-Texto ([string]$Valor))) {
    Add-Aviso "$Contexto · sin imagen; se usará un marcador visual"
    return $null
  }
  $rel = ([string]$Valor).Trim().Replace('\', '/')
  if ($rel -match '^(https?:)?//' -or $rel -match '^[a-zA-Z]:' -or $rel.StartsWith('/')) {
    Add-Error "$Contexto · la imagen debe ser una ruta relativa dentro de la carpeta del catálogo, no '$rel'"
    return $null
  }
  $destino = Join-Path $BaseDir $rel
  if (-not (Test-Path -LiteralPath $destino -PathType Leaf)) {
    Add-Aviso "$Contexto · no se encontró la imagen '$rel'; se usará un marcador visual"
    return $null
  }
  return (Ruta-Sitio $destino)
}

function Validar-Hora {
  param([string]$Hora)
  if ($Hora -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { return $false }
  return $true
}

# ------------------------------------------------------------
#  1. Configuración general
# ------------------------------------------------------------
Write-Host ""
Write-Host "EnRuta Delivery · validando catálogo" -ForegroundColor Yellow
Write-Host "Carpeta del proyecto: $root"
Write-Host ""

$config = Leer-Json (Join-Path $dataDir 'config.json') 'config.json'
if ($null -eq $config) {
  Write-Host "No se puede continuar sin data/config.json" -ForegroundColor Red
  exit 1
}

if (-not (Es-Texto $config.marca)) { Add-Error 'config.json · falta "marca"' }
if ($null -eq $config.whatsapp -or -not (Es-Texto $config.whatsapp.numero)) {
  Add-Error 'config.json · falta "whatsapp.numero"'
} elseif (($config.whatsapp.numero -replace '\D', '') -ne $config.whatsapp.numero -or $config.whatsapp.numero.Length -lt 9) {
  Add-Error 'config.json · "whatsapp.numero" debe tener solo dígitos e incluir código de país'
}
if (-not (Es-Texto $config.email)) { Add-Aviso 'config.json · no hay correo de contacto' }
if ($null -eq $config.zonas -or @($config.zonas).Count -eq 0) {
  Add-Error 'config.json · falta al menos una zona de atención'
} else {
  $zonasIds = @{}
  foreach ($z in @($config.zonas)) {
    if (-not (Es-Texto $z.id)) { Add-Error 'config.json · zona sin "id"'; continue }
    if ($zonasIds.ContainsKey($z.id)) { Add-Error "config.json · zona duplicada '$($z.id)'" }
    $zonasIds[$z.id] = $true
    if (-not (Es-Texto $z.nombre)) { Add-Error "config.json · zona '$($z.id)' sin nombre" }
    if (-not (Validar-Hora ([string]$z.apertura))) { Add-Error "config.json · zona '$($z.id)' con apertura inválida (use HH:mm)" }
    if (-not (Validar-Hora ([string]$z.cierre))) { Add-Error "config.json · zona '$($z.id)' con cierre inválido (use HH:mm)" }
    if ($null -eq $z.dias -or @($z.dias).Count -eq 0) { Add-Error "config.json · zona '$($z.id)' sin días de atención" }
    if (-not (Es-Texto $z.horarioTexto)) { Add-Aviso "config.json · zona '$($z.id)' sin texto de horario visible" }
  }
}
if ($null -eq $config.delivery -or $config.delivery.cotizacionPendiente -ne $true) {
  Add-Aviso 'config.json · "delivery.cotizacionPendiente" no está activo; la web siempre mostrará el envío por cotizar'
}

# ------------------------------------------------------------
#  2. Categorías de locales
# ------------------------------------------------------------
$catLocales = Leer-Json (Join-Path $dataDir 'locales\categorias.json') 'locales/categorias.json'
$mapaCatLocales = @{}
$catLocalesSalida = @()
if ($null -ne $catLocales) {
  if ($null -eq $catLocales.categorias -or @($catLocales.categorias).Count -eq 0) {
    Add-Error 'locales/categorias.json · no hay categorías'
  } else {
    foreach ($c in @($catLocales.categorias)) {
      if (-not (Es-Texto $c.id)) { Add-Error 'locales/categorias.json · categoría sin id'; continue }
      if (-not (Es-Texto $c.nombre)) { Add-Error "locales/categorias.json · categoría '$($c.id)' sin nombre"; continue }
      if ($mapaCatLocales.ContainsKey($c.id)) { Add-Error "locales/categorias.json · categoría duplicada '$($c.id)'"; continue }
      $mapaCatLocales[$c.id] = $c.nombre
      $catLocalesSalida += [ordered]@{ id = $c.id; nombre = $c.nombre }
    }
  }
}

# ------------------------------------------------------------
#  3. Locales (una carpeta por local)
# ------------------------------------------------------------
$indice = Leer-Json (Join-Path $dataDir 'locales\locales.json') 'locales/locales.json'
$localesSalida = @()
$carpetas = @()
if ($null -eq $indice) {
  Add-Error 'locales/locales.json · no se pudo leer el índice de locales'
} elseif ($null -eq $indice.locales -or @($indice.locales).Count -eq 0) {
  Add-Error 'locales/locales.json · el índice está vacío'
} else {
  $carpetas = @($indice.locales)
}

foreach ($carpeta in $carpetas) {
  $contexto = "locales/$carpeta"
  $dir = Join-Path $dataDir ("locales\" + $carpeta)
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) {
    Add-Error "$contexto · no existe la carpeta del local"
    continue
  }

  $local = Leer-Json (Join-Path $dir 'local.json') "$contexto/local.json"
  $prods = Leer-Json (Join-Path $dir 'productos.json') "$contexto/productos.json"
  if ($null -eq $local -or $null -eq $prods) { continue }

  if (-not (Es-Texto $local.id)) { Add-Error "$contexto · falta el campo obligatorio 'id'"; continue }
  if (-not (Es-Texto $local.nombre)) { Add-Error "$contexto · el local '$($local.id)' no tiene nombre" }
  if (-not (Es-Texto $local.categoriaId)) {
    Add-Error "$contexto · el local '$($local.id)' no tiene 'categoriaId'"
  } elseif (-not $mapaCatLocales.ContainsKey($local.categoriaId)) {
    Add-Error "$contexto · categoría desconocida '$($local.categoriaId)' en el local '$($local.id)'"
  }
  if ($local.tipo -notin @('comida', 'producto', 'productos')) {
    Add-Error "$contexto · 'tipo' debe ser 'comida' o 'productos'"
  }
  if (-not (Es-Texto $local.descripcion)) {
    Add-Aviso "$contexto · local sin descripción"
  }
  if ($prods.localId -ne $local.id) {
    Add-Error "$contexto/productos.json · 'localId' ($($prods.localId)) no coincide con el local ($($local.id))"
  }

  $emp = $local.empaquetado
  $empSalida = [ordered]@{ aplica = $false; monto = 0; porUnidad = $false; concepto = 'Sin recargo' }
  if ($null -eq $emp) {
    Add-Aviso "$contexto · sin configuración de empaquetado; no se cobrará recargo"
  } else {
    $aplica = ($emp.aplica -eq $true)
    $porUnidad = ($emp.porUnidad -eq $true)
    $monto = 0
    if (Es-Numero $emp.monto) { $monto = [double]$emp.monto }
    if ($aplica) {
      if ($monto -le 0) {
        Add-Aviso "$contexto · empaquetado activo con monto 0; no se cobrará recargo"
      }
      $empConcepto = 'Empaquetado'
      if (Es-Texto $emp.concepto) { $empConcepto = $emp.concepto }
      $empSalida = [ordered]@{
        aplica    = ($monto -gt 0)
        monto     = $monto
        porUnidad = $porUnidad
        concepto  = $empConcepto
      }
    }
  }

  Registrar-Id $local.id "$contexto/local.json"

  if ($local.publicado -ne $true) {
    Add-Aviso "$contexto · local no publicado; no aparecerá en la web"
  }
  if ($local.esEjemplo -eq $true) {
    $resumen.localesEjemplo++
  }

  $logo     = Resolver-Imagen $dir $local.logo     "$contexto · logo"
  $portada  = Resolver-Imagen $dir $local.portada  "$contexto · portada"
  $carta    = Resolver-Imagen $dir $local.cartaOriginal "$contexto · carta original"

  $productosSalida = @()
  if ($null -eq $prods.productos) {
    Add-Aviso "$contexto/productos.json · el local no tiene productos; se mostrará la carta original o un aviso"
  } else {
    foreach ($p in @($prods.productos)) {
      $pc = "$contexto/productos.json · producto '$($p.id)'"
      if (-not (Es-Texto $p.id)) { Add-Error "$contexto/productos.json · hay un producto sin id"; continue }
      if (-not (Es-Texto $p.nombre)) { Add-Error "$pc · sin nombre"; continue }
      Registrar-Id $p.id "$pc"

      $disponible = ($p.disponible -ne $false)
      $publicado  = ($p.publicado -ne $false)
      $precioValido = $false
      if (Es-Numero $p.precio) {
        if ([double]$p.precio -gt 0) { $precioValido = $true }
      }

      $variantesSalida = @()
      foreach ($v in @($p.variantes)) {
        if ($null -eq $v) { continue }
        if (-not (Es-Texto $v.nombre)) { Add-Error "$pc · variante sin nombre"; continue }
        if (-not (Es-Numero $v.precio) -or [double]$v.precio -le 0) {
          Add-Error "$pc · la variante '$($v.nombre)' necesita precio mayor a 0"
          continue
        }
        $variantesSalida += [ordered]@{
          id     = if (Es-Texto $v.id) { $v.id } else { 'v' + ($variantesSalida.Count + 1) }
          nombre = $v.nombre
          precio = [double]$v.precio
        }
      }
      $extrasSalida = @()
      foreach ($e in @($p.extras)) {
        if ($null -eq $e) { continue }
        if (-not (Es-Texto $e.nombre)) { Add-Error "$pc · extra sin nombre"; continue }
        $pe = 0
        if (Es-Numero $e.precio) { $pe = [double]$e.precio }
        $extrasSalida += [ordered]@{ nombre = $e.nombre; precio = $pe }
      }

      if ($publicado) {
        if (-not $precioValido -and $variantesSalida.Count -eq 0) {
          if ($null -eq $p.precio -or [string]::IsNullOrWhiteSpace([string]$p.precio)) {
            Add-Error "$pc · un producto publicado necesita precio o una variante con precio"
          } elseif (-not (Es-Numero $p.precio)) {
            Add-Error "$pc · el precio debe ser un número (sin S/ ni comas) o tener variantes con precio"
          } else {
            Add-Error "$pc · el precio debe ser mayor a 0 o tener una variante con precio"
          }
          continue
        }
      } else {
        # Borrador del panel: puede no tener precio todavia. No se publica.
        Add-Aviso "$pc · borrador no publicado; se excluye de la web"
        if ($null -ne $p.precio -and -not [string]::IsNullOrWhiteSpace([string]$p.precio) -and -not $precioValido) {
          Add-Aviso "$pc · borrador con precio incompleto; corrigelo antes de publicar"
        }
      }
      if (-not $disponible) { Add-Aviso "$pc · agotado; se conserva en datos pero se oculta en la web" }
      if (-not $publicado -or -not $disponible) { continue }

      $productosSalida += [ordered]@{
        id           = $p.id
        nombre       = $p.nombre
        descripcion  = $p.descripcion
        precio       = if ($precioValido) { [double]$p.precio } else { 0 }
        grupo        = $p.grupo
        subcategoria = $p.subcategoria
        emoji        = $p.emoji
        etiqueta     = $p.etiqueta
        imagen       = (Resolver-Imagen $dir $p.imagen "$pc · imagen")
        variantes    = @($variantesSalida)
        extras       = @($extrasSalida)
        origen       = $p.origen
      }
    }
  }

  $resumen.locales++
  $resumen.productosLocales += $productosSalida.Count
  if ($local.publicado -eq $true) { $resumen.localesPublicados++ }

  $catNombre = $local.categoriaId
  if (Es-Texto $local.categoriaId -and $mapaCatLocales.ContainsKey($local.categoriaId)) {
    $catNombre = $mapaCatLocales[$local.categoriaId]
  }
  $tipoNormalizado = 'productos'
  if ($local.tipo -eq 'comida') { $tipoNormalizado = 'comida' }

  $localesSalida += [ordered]@{
    id             = $local.id
    nombre         = $local.nombre
    tipo           = $tipoNormalizado
    categoriaId    = $local.categoriaId
    categoriaNombre = $catNombre
    descripcion    = $local.descripcion
    publicado      = ($local.publicado -eq $true)
    disponible     = ($local.disponible -ne $false)
    esEjemplo      = ($local.esEjemplo -eq $true)
    emoji          = $local.emoji
    colores        = @($local.colores)
    logo           = $logo
    portada        = $portada
    cartaOriginal  = $carta
    tiempo         = $local.tiempo
    pedidoMinimo   = $local.pedidoMinimo
    horarioLocal   = $local.horarioLocal
    etiquetas      = @($local.etiquetas)
    empaquetado    = $empSalida
    notas          = $local.notas
    productos      = @($productosSalida)
  }
}

if ($resumen.localesEjemplo -gt 0) {
  Add-Aviso "Hay $($resumen.localesEjemplo) local(es) marcados como 'esEjemplo'. Reemplázalos por negocios reales antes de publicar."
}

# ------------------------------------------------------------
#  4. Catálogos independientes (Licores y Primera necesidad)
# ------------------------------------------------------------
function Cargar-Catalogo {
  param(
    [string]$CatalogoId,
    [string]$NombreVisible,
    [string]$CarpetaRelativa
  )

  $dir = Join-Path $dataDir $CarpetaRelativa
  $cat = Leer-Json (Join-Path $dir 'categorias.json') "$CarpetaRelativa/categorias.json"
  $prod = Leer-Json (Join-Path $dir 'productos.json') "$CarpetaRelativa/productos.json"

  $salida = [ordered]@{
    id         = $CatalogoId
    nombre     = $NombreVisible
    categorias = @()
    productos  = @()
  }
  if ($null -eq $cat -or $null -eq $prod) { return $salida }

  if ($cat.catalogoId -ne $CatalogoId) {
    Add-Error "$CarpetaRelativa/categorias.json · 'catalogoId' debe ser '$CatalogoId'"
  }
  if ($prod.catalogoId -ne $CatalogoId) {
    Add-Error "$CarpetaRelativa/productos.json · 'catalogoId' debe ser '$CatalogoId'"
  }

  $mapaCat = @{}
  foreach ($c in @($cat.categorias)) {
    if (-not (Es-Texto $c.id)) { Add-Error "$CarpetaRelativa/categorias.json · categoría sin id"; continue }
    if (-not (Es-Texto $c.nombre)) { Add-Error "$CarpetaRelativa/categorias.json · categoría '$($c.id)' sin nombre"; continue }
    if ($mapaCat.ContainsKey($c.id)) { Add-Error "$CarpetaRelativa/categorias.json · categoría duplicada '$($c.id)'"; continue }
    $mapaCat[$c.id] = $c.nombre
    $salida.categorias += [ordered]@{ id = $c.id; nombre = $c.nombre }
  }
  if ($salida.categorias.Count -eq 0) {
    Add-Error "$CarpetaRelativa/categorias.json · no hay categorías válidas"
  }

  $productosSalida = @()
  foreach ($p in @($prod.productos)) {
    $pc = "$CarpetaRelativa/productos.json · producto '$($p.id)'"
    if (-not (Es-Texto $p.id)) { Add-Error "$CarpetaRelativa/productos.json · hay un producto sin id"; continue }
    if (-not (Es-Texto $p.nombre)) { Add-Error "$pc · sin nombre"; continue }
    if (-not (Es-Texto $p.marca)) { Add-Aviso "$pc · sin marca" }
    if (-not (Es-Texto $p.categoriaId)) {
      Add-Error "$pc · sin 'categoriaId'"
    } elseif (-not $mapaCat.ContainsKey($p.categoriaId)) {
      Add-Error "$pc · categoría desconocida '$($p.categoriaId)'"
    }
    if (-not (Es-Texto $p.presentacion)) { Add-Aviso "$pc · sin presentación (ml, kg, unidades)" }
    Registrar-Id $p.id $pc

    if ($null -ne $p.precioReferencia) {
      if (-not (Es-Numero $p.precioReferencia) -or [double]$p.precioReferencia -lt 0) {
        Add-Error "$pc · 'precioReferencia' inválido"
      }
    } else {
      Add-Aviso "$pc · sin precio de referencia"
    }

    $fuente = $p.fuente
    if ($null -eq $fuente) {
      Add-Error "$pc · falta el bloque 'fuente' (tienda, url, productoId, fechaVerificacion)"
    } else {
      if (-not (Es-Texto $fuente.tienda)) { Add-Error "$pc · fuente sin tienda" }
      if (-not (Es-Texto $fuente.url) -or -not ([string]$fuente.url).StartsWith('https://')) {
        Add-Error "$pc · fuente con URL inválida"
      }
      if (-not (Es-Texto $fuente.productoId)) { Add-Error "$pc · fuente sin 'productoId'" }
      if (-not (Es-Texto $fuente.fechaVerificacion) -or ([string]$fuente.fechaVerificacion) -notmatch '^\d{4}-\d{2}-\d{2}$') {
        Add-Error "$pc · fuente sin fecha de verificación (AAAA-MM-DD)"
      }
    }

    $publicado  = ($p.publicado -ne $false)
    $disponible = ($p.disponible -ne $false)

    if ($null -eq $p.precioVenta) {
      Add-Aviso "$pc · precio de venta pendiente; NO se publica hasta configurarlo"
    } elseif (-not (Es-Numero $p.precioVenta) -or [double]$p.precioVenta -le 0) {
      Add-Error "$pc · 'precioVenta' debe ser un número mayor a 0"
    }
    if (-not $publicado) { Add-Aviso "$pc · no publicado; se excluye de la web" }
    if (-not $disponible) { Add-Aviso "$pc · agotado; se conserva en datos pero se oculta en la web" }

    if (-not $publicado -or -not $disponible -or $null -eq $p.precioVenta) { continue }
    if (-not (Es-Numero $p.precioVenta) -or [double]$p.precioVenta -le 0) { continue }

    $precioRef = $null
    if (Es-Numero $p.precioReferencia) { $precioRef = [double]$p.precioReferencia }

    $productosSalida += [ordered]@{
      id               = $p.id
      nombre           = $p.nombre
      marca            = $p.marca
      categoriaId      = $p.categoriaId
      presentacion     = $p.presentacion
      imagen           = (Resolver-Imagen $dir $p.imagen "$pc · imagen")
      precioVenta      = [double]$p.precioVenta
      precioReferencia = $precioRef
      fuente           = [ordered]@{
        tienda            = $fuente.tienda
        url               = $fuente.url
        productoId        = [string]$fuente.productoId
        fechaVerificacion = $fuente.fechaVerificacion
      }
      estado           = $p.estado
    }
  }

  $salida.productos = @($productosSalida)
  return $salida
}

$licores = Cargar-Catalogo 'licores' 'Licores' 'licores'
$nec     = Cargar-Catalogo 'primera-necesidad' 'Primera necesidad' 'primera-necesidad'
$resumen.licores = $licores.productos.Count
$resumen.primeraNecesidad = $nec.productos.Count

# ------------------------------------------------------------
#  5. Reporte y salida
# ------------------------------------------------------------
$generado = Get-Date -Format 'yyyy-MM-ddTHH:mm:ss'

$reporte = [ordered]@{
  generadoEn  = $generado
  errores     = @($errores)
  advertencias = @($advertencias)
  resumen     = $resumen
}

$utf8 = New-Object System.Text.UTF8Encoding($false)

function Escribir-Json {
  param([string]$Ruta, $Objeto)
  $json = $Objeto | ConvertTo-Json -Depth 30
  $json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', {
    param($m)
    [string][char][Convert]::ToInt32($m.Groups[1].Value, 16)
  })
  [IO.File]::WriteAllText($Ruta, $json + "`n", $utf8)
}

Escribir-Json $reportePath $reporte

Write-Host ""
Write-Host "Resumen" -ForegroundColor Yellow
Write-Host "  Locales:                  $($resumen.locales) (publicados: $($resumen.localesPublicados), de ejemplo: $($resumen.localesEjemplo))"
Write-Host "  Productos de locales:     $($resumen.productosLocales)"
Write-Host "  Licores publicables:      $($resumen.licores)"
Write-Host "  Primera necesidad:        $($resumen.primeraNecesidad)"
Write-Host "  Errores:                  $($errores.Count)"
Write-Host "  Advertencias:             $($advertencias.Count)"

if ($advertencias.Count -gt 0) {
  Write-Host ""
  Write-Host "Advertencias (no bloquean la publicación):" -ForegroundColor DarkYellow
  $max = [Math]::Min($advertencias.Count, 40)
  for ($i = 0; $i -lt $max; $i++) { Write-Host "  - $($advertencias[$i])" -ForegroundColor DarkYellow }
  if ($advertencias.Count -gt $max) {
    Write-Host "  ... y $($advertencias.Count - $max) más. Ver data/reporte-validacion.json" -ForegroundColor DarkYellow
  }
}

if ($errores.Count -gt 0) {
  Write-Host ""
  Write-Host "Errores (corrige antes de publicar):" -ForegroundColor Red
  foreach ($e in $errores) { Write-Host "  - $e" -ForegroundColor Red }
  Write-Host ""
  Write-Host "No se generó js/catalogo.js porque hay errores." -ForegroundColor Red
  exit 1
}

if ($SoloValidar) {
  Write-Host ""
  Write-Host "Validación correcta. No se regeneró el catálogo (-SoloValidar)." -ForegroundColor Green
  exit 0
}

$bundle = [ordered]@{
  generadoEn         = $generado
  config             = $config
  categoriasLocales  = @($catLocalesSalida)
  locales            = @($localesSalida)
  catalogos          = @($licores, $nec)
  resumen            = $resumen
}

$js  = "/* ARCHIVO GENERADO AUTOMÁTICAMENTE por tools/importar.ps1. No editar a mano. */`n"
$js += "window.ENRUTA_DATA = " + (($bundle | ConvertTo-Json -Depth 30 -Compress)) + ";`n"
$js = [regex]::Replace($js, '\\u([0-9a-fA-F]{4})', {
  param($m)
  [string][char][Convert]::ToInt32($m.Groups[1].Value, 16)
})
[IO.File]::WriteAllText($salidaJs, $js, $utf8)

Write-Host ""
Write-Host "Catálogo generado: js/catalogo.js" -ForegroundColor Green
Write-Host "Reporte: data/reporte-validacion.json" -ForegroundColor Green
exit 0
