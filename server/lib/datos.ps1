# ============================================================
#  EnRuta Delivery - Almacen de datos comerciales
#  Locales, productos, categorias, catalogos, pedidos, auditoria.
# ============================================================

$script:RutaLocales = Join-Path $script:CarpetaDatosPublicos 'locales'
$script:RutaCatalogoLicores = Join-Path $script:CarpetaDatosPublicos 'licores'
$script:RutaCatalogoNec = Join-Path $script:CarpetaDatosPublicos 'primera-necesidad'
$script:RutaPedidos = Join-Path $script:CarpetaDatos 'pedidos.json'
$script:RutaServicios = Join-Path $script:CarpetaDatos 'servicios.json'
$script:RutaAuditoria = Join-Path $script:CarpetaDatos 'auditoria.jsonl'
$script:RutaRespaldos = Join-Path $script:CarpetaDatos 'respaldos'

function Inicializar-Datos {
  Inicializar-Auth
  Asegurar-Carpeta $script:RutaLocales | Out-Null
  Asegurar-Carpeta $script:CarpetaImportaciones | Out-Null
  Asegurar-Carpeta $script:RutaRespaldos | Out-Null
  if (-not (Test-Path -LiteralPath $script:RutaPedidos)) {
    Guardar-JsonAtomico $script:RutaPedidos ([ordered]@{ version = 1; pedidos = @() }) -SinRespaldo
  }
  if (-not (Test-Path -LiteralPath $script:RutaServicios)) {
    Guardar-JsonAtomico $script:RutaServicios ([ordered]@{ version = 1; envios = @(); taximotos = @() }) -SinRespaldo
  }
}

function Registrar-Auditoria {
  param(
    [string]$Usuario,
    [string]$Rol,
    [string]$Accion,
    [string]$Detalle,
    [string]$Ip = ''
  )
  try {
    Inicializar-Datos
    $registro = [ordered]@{
      fecha   = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
      usuario = $Usuario
      rol     = $Rol
      accion  = $Accion
      detalle = $Detalle
      ip      = $Ip
    }
    # JSONL: un registro compacto por linea (Leer-Auditoria lee linea por linea).
    $linea = $registro | ConvertTo-Json -Compress -Depth 8
    [IO.File]::AppendAllText($script:RutaAuditoria, $linea + "`n", $script:Utf8SinBom)
  } catch {
    Escribir-Log "No se pudo escribir auditoria: $($_.Exception.Message)" 'ERROR'
  }
}

function Leer-Auditoria {
  param([int]$Limite = 100)
  if (-not (Test-Path -LiteralPath $script:RutaAuditoria)) { return @() }
  $lineas = [IO.File]::ReadAllLines($script:RutaAuditoria, [Text.Encoding]::UTF8)
  $salida = @()
  for ($i = $lineas.Count - 1; $i -ge 0 -and $salida.Count -lt $Limite; $i--) {
    if ([string]::IsNullOrWhiteSpace($lineas[$i])) { continue }
    try { $salida += ($lineas[$i] | ConvertFrom-Json) } catch { }
  }
  return $salida
}

# ------------------------------------------------------------
#  Respaldos
# ------------------------------------------------------------
function Nuevo-Respaldo {
  param([string]$Etiqueta = 'cambio')
  $sello = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
  $dir = Join-Path $script:RutaRespaldos "$sello-$Etiqueta"
  Asegurar-Carpeta $dir | Out-Null
  return $dir
}

function Copiar-AResplado {
  param([string]$Ruta, [string]$DirRespaldo)
  if (-not (Test-Path -LiteralPath $Ruta -PathType Leaf)) { return }
  $nombre = Split-Path -Leaf $Ruta
  Copy-Item -LiteralPath $Ruta -Destination (Join-Path $DirRespaldo $nombre) -Force
}

# ------------------------------------------------------------
#  Importador publico
# ------------------------------------------------------------
function Ejecutar-Importador {
  $script = Join-Path $script:Raiz 'tools\importar.ps1'
  if (-not (Test-Path -LiteralPath $script)) {
    return [ordered]@{ ok = $false; salida = ''; error = 'No se encontro tools\importar.ps1' }
  }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe')
  $psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $script + '"'
  $psi.WorkingDirectory = $script:Raiz
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.StandardOutputEncoding = $script:Utf8SinBom
  $psi.StandardErrorEncoding = $script:Utf8SinBom
  try {
    $p = [System.Diagnostics.Process]::Start($psi)
    $out = $p.StandardOutput.ReadToEnd()
    $err = $p.StandardError.ReadToEnd()
    if (-not $p.WaitForExit(180000)) {
      try { $p.Kill() } catch { }
      return [ordered]@{ ok = $false; salida = $out; error = 'La validacion tardo mas de 3 minutos.' }
    }
    $codigo = $p.ExitCode
    return [ordered]@{
      ok     = ($codigo -eq 0)
      codigo = $codigo
      salida = $out
      error  = $err
    }
  } catch {
    return [ordered]@{ ok = $false; salida = ''; error = $_.Exception.Message }
  }
}

function Leer-ErroresValidacion {
  $ruta = Join-Path $script:CarpetaDatosPublicos 'reporte-validacion.json'
  $rep = Leer-JsonRuta $ruta $null
  if ($null -eq $rep) { return @() }
  return @($rep.errores)
}

# ------------------------------------------------------------
#  Locales
# ------------------------------------------------------------
function Leer-IndiceLocales {
  $ruta = Join-Path $script:RutaLocales 'locales.json'
  $doc = Leer-JsonRuta $ruta $null
  if ($null -eq $doc -or $null -eq $doc.locales) {
    return [ordered]@{ version = 1; locales = @() }
  }
  return $doc
}

function Guardar-IndiceLocales {
  param($Doc)
  $ruta = Join-Path $script:RutaLocales 'locales.json'
  Guardar-JsonAtomico $ruta $Doc
}

function Test-CarpetaLocal {
  param([string]$Carpeta)
  return ($Carpeta -match '^local-[0-9]{3,4}$')
}

function Obtener-LocalPorCarpeta {
  param([string]$Carpeta)
  if (-not (Test-CarpetaLocal $Carpeta)) { return $null }
  $dir = Join-Path $script:RutaLocales $Carpeta
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { return $null }
  $local = Leer-JsonRuta (Join-Path $dir 'local.json') $null
  $prods = Leer-JsonRuta (Join-Path $dir 'productos.json') $null
  if ($null -eq $local -or $null -eq $prods) { return $null }
  return [ordered]@{
    carpeta   = $Carpeta
    local     = $local
    productos = @($prods.productos)
  }
}

function Buscar-CarpetaPorLocalId {
  param([string]$LocalId)
  $indice = Leer-IndiceLocales
  foreach ($carpeta in @($indice.locales)) {
    $item = Obtener-LocalPorCarpeta ([string]$carpeta)
    if ($null -ne $item -and [string]$item.local.id -eq $LocalId) { return $item }
  }
  return $null
}

function Obtener-LocalesAdmin {
  param([string]$Busqueda = '')
  $indice = Leer-IndiceLocales
  $salida = @()
  $q = Normalizar-Texto $Busqueda
  foreach ($carpeta in @($indice.locales)) {
    $item = Obtener-LocalPorCarpeta ([string]$carpeta)
    if ($null -eq $item) { continue }
    $productos = @($item.productos)
    $publicados = @($productos | Where-Object { $_.publicado -ne $false }).Count
    $pendientes = @($productos | Where-Object { $_.revisar -eq $true -or $_.publicado -eq $false }).Count
    $local = $item.local
    if ($q) {
      $texto = Normalizar-Texto (@($local.nombre, $local.descripcion, $local.id, $local.categoriaId, $local.direccion, $local.telefono) -join ' ')
      if (-not $texto.Contains($q)) { continue }
    }
    $salida += [ordered]@{
      carpeta        = $carpeta
      id             = [string]$local.id
      nombre         = [string]$local.nombre
      tipo           = [string]$local.tipo
      categoriaId    = [string]$local.categoriaId
      descripcion    = [string]$local.descripcion
      publicado      = ($local.publicado -eq $true)
      disponible     = ($local.disponible -ne $false)
      cerradoTemporal = ($local.cerradoTemporal -eq $true)
      esEjemplo      = ($local.esEjemplo -eq $true)
      emoji          = [string]$local.emoji
      logo           = $local.logo
      portada        = $local.portada
      direccion      = [string]$local.direccion
      telefono       = [string]$local.telefono
      horarioLocal   = [string]$local.horarioLocal
      totalProductos = $productos.Count
      publicados     = $publicados
      pendientes     = $pendientes
    }
  }
  return $salida
}

function Validar-Local {
  param($Local, [string]$Carpeta)
  $errores = @()
  if ([string]::IsNullOrWhiteSpace([string]$Local.nombre)) { $errores += 'El nombre del local es obligatorio.' }
  if ([string]::IsNullOrWhiteSpace([string]$Local.id)) { $errores += 'El identificador (slug) es obligatorio.' }
  elseif ([string]$Local.id -notmatch '^[a-z0-9][a-z0-9-]{1,48}$') { $errores += 'El slug solo admite minusculas, numeros y guiones (2 a 49 caracteres).' }
  if ([string]::IsNullOrWhiteSpace([string]$Local.categoriaId)) { $errores += 'Elige una categoria para el local.' }
  else {
    $cats = @((Obtener-CategoriasLocales).categorias)
    if (-not ($cats | Where-Object { $_.id -eq $Local.categoriaId })) { $errores += 'La categoria del local no existe.' }
  }
  if ([string]$Local.tipo -notin @('comida', 'producto', 'productos')) { $errores += 'El tipo de local debe ser comida o productos.' }
  if (-not [string]::IsNullOrWhiteSpace([string]$Local.horarioLocal) -and [string]$Local.horarioLocal -notmatch '^[0-2][0-9]:[0-5][0-9]\s*[-–—]\s*[0-2][0-9]:[0-5][0-9]$') {
    # Se admite texto libre; solo advertimos, no bloqueamos.
  }
  return $errores
}

function Validar-ProductoLocal {
  param($Producto, [ref]$IdsVistos)
  $errores = @()
  $productoId = [string]$Producto.id
  if ([string]::IsNullOrWhiteSpace($productoId)) { $errores += 'Hay un producto sin identificador.' }
  elseif ($IdsVistos.Value.ContainsKey($productoId)) { $errores += "Identificador de producto duplicado: $productoId" }
  else { $IdsVistos.Value[$productoId] = $true }
  if ([string]::IsNullOrWhiteSpace([string]$Producto.nombre)) { $errores += "Producto '$productoId': falta el nombre." }

  $publicado = ($Producto.publicado -ne $false)
  $precioValido = $false
  $precio = $Producto.precio
  $n = Convertir-Numero $precio
  if ($null -ne $n -and $n -gt 0) { $precioValido = $true }
  $variantesValidas = 0
  foreach ($v in @($Producto.variantes)) {
    if ($null -eq $v) { continue }
    if ([string]::IsNullOrWhiteSpace([string]$v.nombre)) { $errores += "Producto '$productoId': variante sin nombre." }
    $pv = Convertir-Numero $v.precio
    if ($null -eq $pv -or $pv -le 0) {
      $errores += "Producto '$productoId': la variante '$($v.nombre)' necesita precio mayor a 0."
    } else {
      $variantesValidas++
    }
  }
  if ($publicado -and -not $precioValido -and $variantesValidas -eq 0) {
    if ($null -eq $precio -or [string]::IsNullOrWhiteSpace([string]$precio)) {
      $errores += "Producto '$productoId': un producto publicado necesita precio o una variante con precio."
    } else {
      $errores += "Producto '$productoId': el precio debe ser mayor a 0 o tener una variante con precio."
    }
  }
  foreach ($e in @($Producto.extras)) {
    if ($null -eq $e) { continue }
    if ([string]::IsNullOrWhiteSpace([string]$e.nombre)) { $errores += "Producto '$productoId': extra sin nombre." }
    if ($null -ne $e.precio -and -not [string]::IsNullOrWhiteSpace([string]$e.precio)) {
      $pe = Convertir-Numero $e.precio
      if ($null -eq $pe -or $pe -lt 0) {
        $errores += "Producto '$productoId': el extra '$($e.nombre)' tiene precio invalido."
      }
    }
  }
  return $errores
}

function Convertir-AOrdenado {
  param($Objeto)
  if ($null -eq $Objeto) { return [ordered]@{} }
  if ($Objeto -is [System.Collections.IDictionary]) { return $Objeto }
  $mapa = [ordered]@{}
  foreach ($prop in $Objeto.PSObject.Properties) { $mapa[$prop.Name] = $prop.Value }
  return $mapa
}

function Guardar-LocalCompleto {
  param(
    [string]$Carpeta,
    $Local,
    [object[]]$Productos,
    [string]$Usuario = 'sistema',
    [string]$Rol = 'sistema',
    [string]$Ip = ''
  )
  if (-not (Test-CarpetaLocal $Carpeta)) { Lanzar-ErrorHttp 400 'Carpeta de local invalida.' }
  $dir = Join-Path $script:RutaLocales $Carpeta
  if (-not (Test-Path -LiteralPath $dir -PathType Container)) { Lanzar-ErrorHttp 404 'El local no existe.' }

  $existentes = Obtener-LocalPorCarpeta $Carpeta
  if ($null -eq $existentes) { Lanzar-ErrorHttp 404 'No se pudo leer el local.' }

  # Trabajar con un mapa permite completar campos nuevos sin fallar
  # cuando un local antiguo todavia no los tiene (por ejemplo cerradoTemporal).
  $Local = Convertir-AOrdenado $Local

  # El id no puede chocar con otro local.
  foreach ($otro in @((Leer-IndiceLocales).locales)) {
    if ([string]$otro -eq $Carpeta) { continue }
    $item = Obtener-LocalPorCarpeta ([string]$otro)
    if ($null -ne $item -and [string]$item.local.id -eq [string]$Local.id) {
      Lanzar-ErrorHttp 409 "El identificador '$($Local.id)' ya lo usa el local $($item.local.nombre)."
    }
  }

  $errores = @(Validar-Local $Local $Carpeta)
  $ids = @{}
  $refIds = [ref]$ids
  $productosLimpios = @()
  foreach ($p in @($Productos)) {
    if ($null -eq $p) { continue }
    $errores += @(Validar-ProductoLocal $p $refIds)
    $productosLimpios += $p
  }
  if ($errores.Count -gt 0) {
    Lanzar-ErrorHttp 400 (@($errores) -join ' ')
  }

  $Local.id = [string]$Local.id
  $Local.publicado = ($Local.publicado -eq $true)
  $Local.disponible = ($Local.disponible -ne $false)
  $Local.cerradoTemporal = ($Local.cerradoTemporal -eq $true)

  $dirResp = Nuevo-Respaldo "local-$Carpeta"
  Copiar-AResplado (Join-Path $dir 'local.json') $dirResp
  Copiar-AResplado (Join-Path $dir 'productos.json') $dirResp

  $antesLocal = Leer-TextoPlano (Join-Path $dir 'local.json')
  $antesProd = Leer-TextoPlano (Join-Path $dir 'productos.json')

  try {
    Guardar-JsonAtomico (Join-Path $dir 'local.json') $Local
    Guardar-JsonAtomico (Join-Path $dir 'productos.json') ([ordered]@{
        localId   = [string]$Local.id
        productos = @($productosLimpios)
      })
    $res = Ejecutar-Importador
    if (-not $res.ok) {
      # Restaurar el estado anterior y regenerar el catalogo publico.
      [IO.File]::WriteAllText((Join-Path $dir 'local.json'), $antesLocal, $script:Utf8SinBom)
      [IO.File]::WriteAllText((Join-Path $dir 'productos.json'), $antesProd, $script:Utf8SinBom)
      [void](Ejecutar-Importador)
      $detalle = @(Leer-ErroresValidacion)
      if ($detalle.Count -eq 0) { $detalle = @($res.error, $res.salida) | Where-Object { $_ } }
      Lanzar-ErrorHttp 422 ('No se pudo publicar: ' + (@($detalle) -join ' '))
    }
  } catch {
    if ($_.Exception.Data.Contains('httpStatus')) { throw }
    Lanzar-ErrorHttp 500 "Error al guardar el local: $($_.Exception.Message)"
  }

  Registrar-Auditoria $Usuario $Rol 'local.guardar' "Local $Carpeta ($($Local.nombre)) con $($productosLimpios.Count) productos" $Ip
  return [ordered]@{
    ok        = $true
    carpeta   = $Carpeta
    productos = $productosLimpios.Count
  }
}

function Eliminar-ProductosLocal {
  param(
    [string]$Carpeta,
    [object[]]$Ids,
    [string]$Usuario = 'sistema',
    [string]$Rol = 'admin',
    [string]$Ip = ''
  )
  if (-not (Test-CarpetaLocal $Carpeta)) { Lanzar-ErrorHttp 400 'Carpeta de local invalida.' }
  $item = Obtener-LocalPorCarpeta $Carpeta
  if ($null -eq $item) { Lanzar-ErrorHttp 404 'Local no encontrado.' }

  $objetivo = @{}
  foreach ($id in @($Ids)) {
    $id = [string]$id
    if ($id) { $objetivo[$id] = $true }
  }
  if ($objetivo.Count -eq 0) { Lanzar-ErrorHttp 400 'No se indico ningun producto para eliminar.' }

  $lista = @($item.productos)
  $borrados = @($lista | Where-Object { $objetivo.ContainsKey([string]$_.id) })
  if ($borrados.Count -eq 0) { Lanzar-ErrorHttp 404 'Ninguno de los productos indicados existe en este local.' }

  $restantes = @($lista | Where-Object { -not $objetivo.ContainsKey([string]$_.id) })
  $res = Guardar-LocalCompleto $Carpeta $item.local $restantes $Usuario $Rol $Ip
  $nombres = @($borrados | ForEach-Object { [string]$_.nombre }) -join ', '
  Registrar-Auditoria $Usuario $Rol 'producto.eliminar' "Local $Carpeta ($($item.local.nombre)): $($borrados.Count) producto(s) eliminados: $nombres" $Ip
  return [ordered]@{
    ok         = $true
    eliminados = $borrados.Count
    restantes  = $restantes.Count
    ids        = @($borrados | ForEach-Object { [string]$_.id })
  }
}

function Nuevo-Local {
  param($Local, [string]$Usuario, [string]$Rol, [string]$Ip)
  Inicializar-Datos
  $indice = Leer-IndiceLocales
  $max = 0
  foreach ($c in @($indice.locales)) {
    if ([string]$c -match '^local-([0-9]+)$') {
      $n = [int]$Matches[1]
      if ($n -gt $max) { $max = $n }
    }
  }
  $carpeta = 'local-{0:D3}' -f ($max + 1)

  $errores = @(Validar-Local $Local $carpeta)
  if ($errores.Count -gt 0) { Lanzar-ErrorHttp 400 (@($errores) -join ' ') }
  foreach ($otro in @($indice.locales)) {
    $item = Obtener-LocalPorCarpeta ([string]$otro)
    if ($null -ne $item -and [string]$item.local.id -eq [string]$Local.id) {
      Lanzar-ErrorHttp 409 "El identificador '$($Local.id)' ya existe."
    }
  }

  $dir = Join-Path $script:RutaLocales $carpeta
  Asegurar-Carpeta $dir | Out-Null
  Asegurar-Carpeta (Join-Path $dir 'img') | Out-Null

  $localFinal = [ordered]@{
    id             = [string]$Local.id
    nombre         = [string]$Local.nombre
    tipo           = if ([string]$Local.tipo -eq 'comida') { 'comida' } else { 'productos' }
    categoriaId    = [string]$Local.categoriaId
    descripcion    = [string]$Local.descripcion
    publicado      = ($Local.publicado -eq $true)
    disponible     = ($Local.disponible -ne $false)
    cerradoTemporal = ($Local.cerradoTemporal -eq $true)
    esEjemplo      = $false
    emoji          = if ($Local.emoji) { [string]$Local.emoji } else { '🏪' }
    colores        = if ($Local.colores) { @($Local.colores) } else { @('#fdd303', '#111111') }
    logo           = $null
    portada        = $null
    cartaOriginal  = $null
    tiempo         = [string]$Local.tiempo
    pedidoMinimo   = if ($null -ne (Convertir-Numero $Local.pedidoMinimo)) { [double](Convertir-Numero $Local.pedidoMinimo) } else { 0 }
    horarioLocal   = [string]$Local.horarioLocal
    direccion      = [string]$Local.direccion
    telefono       = [string]$Local.telefono
    etiquetas      = @($Local.etiquetas)
    empaquetado    = [ordered]@{
      porUnidad = ($Local.empaquetado -and $Local.empaquetado.porUnidad -eq $true)
      aplica    = ($Local.empaquetado -and $Local.empaquetado.aplica -eq $true)
      monto     = if ($Local.empaquetado -and $null -ne (Convertir-Numero $Local.empaquetado.monto)) { [double](Convertir-Numero $Local.empaquetado.monto) } else { 0 }
      concepto  = if ($Local.empaquetado -and $Local.empaquetado.concepto) { [string]$Local.empaquetado.concepto } else { 'Empaquetado' }
    }
    notas          = [string]$Local.notas
  }

  try {
    Guardar-JsonAtomico (Join-Path $dir 'local.json') $localFinal
    Guardar-JsonAtomico (Join-Path $dir 'productos.json') ([ordered]@{ localId = $localFinal.id; productos = @() })
    $nuevoIndice = [ordered]@{ version = 1; locales = @(@($indice.locales) + $carpeta) }
    Guardar-IndiceLocales $nuevoIndice
    $res = Ejecutar-Importador
    if (-not $res.ok) {
      $detalle = @(Leer-ErroresValidacion)
      if ($detalle.Count -eq 0) { $detalle = @($res.error) }
      throw (New-Object System.Exception(($detalle -join ' ')))
    }
  } catch {
    try { if (Test-Path -LiteralPath $dir) { Remove-Item -LiteralPath $dir -Recurse -Force } } catch { }
    try { Guardar-IndiceLocales $indice } catch { }
    [void](Ejecutar-Importador)
    if ($_.Exception.Data.Contains('httpStatus')) { throw }
    Lanzar-ErrorHttp 422 ("No se pudo crear el local: " + $_.Exception.Message)
  }

  Registrar-Auditoria $Usuario $Rol 'local.crear' "Local $carpeta ($($localFinal.nombre))" $Ip
  return [ordered]@{ ok = $true; carpeta = $carpeta; local = $localFinal }
}

function Eliminar-Local {
  param([string]$Carpeta, [string]$Usuario, [string]$Rol, [string]$Ip)
  if (-not (Test-CarpetaLocal $Carpeta)) { Lanzar-ErrorHttp 400 'Carpeta de local invalida.' }
  $indice = Leer-IndiceLocales
  if (@($indice.locales) -notcontains $Carpeta) { Lanzar-ErrorHttp 404 'El local no existe.' }
  $item = Obtener-LocalPorCarpeta $Carpeta
  $dir = Join-Path $script:RutaLocales $Carpeta
  $dirResp = Nuevo-Respaldo "eliminado-$Carpeta"
  $destino = Join-Path $dirResp $Carpeta
  try {
    $nuevo = @(@($indice.locales) | Where-Object { [string]$_ -ne $Carpeta })
    Guardar-IndiceLocales ([ordered]@{ version = 1; locales = $nuevo })
    if (Test-Path -LiteralPath $dir) { Move-Item -LiteralPath $dir -Destination $destino -Force }
    $res = Ejecutar-Importador
    if (-not $res.ok) {
      # Restaurar.
      if (Test-Path -LiteralPath $destino) { Move-Item -LiteralPath $destino -Destination $dir -Force }
      Guardar-IndiceLocales $indice
      [void](Ejecutar-Importador)
      Lanzar-ErrorHttp 422 'No se pudo eliminar el local porque el catalogo quedaria invalido.'
    }
  } catch {
    if ($_.Exception.Data.Contains('httpStatus')) { throw }
    Lanzar-ErrorHttp 500 "Error al eliminar: $($_.Exception.Message)"
  }
  $nombre = if ($item) { $item.local.nombre } else { $Carpeta }
  Registrar-Auditoria $Usuario $Rol 'local.eliminar' "Local $Carpeta ($nombre). Respaldo: $destino" $Ip
  return [ordered]@{ ok = $true; respaldo = $destino }
}

function Duplicar-Local {
  param([string]$Carpeta, [string]$Usuario = 'sistema', [string]$Rol = 'admin', [string]$Ip = '')
  if (-not (Test-CarpetaLocal $Carpeta)) { Lanzar-ErrorHttp 400 'Carpeta de local invalida.' }
  $indice = Leer-IndiceLocales
  if (@($indice.locales) -notcontains $Carpeta) { Lanzar-ErrorHttp 404 'El local no existe.' }
  $origen = Obtener-LocalPorCarpeta $Carpeta
  if ($null -eq $origen) { Lanzar-ErrorHttp 404 'No se pudo leer el local.' }
  # Siguiente carpeta libre: local-012, local-013...
  $maxNum = 0
  foreach ($c in @($indice.locales)) {
    if ([string]$c -match '^local-([0-9]+)$') {
      $n = [int]$Matches[1]
      if ($n -gt $maxNum) { $maxNum = $n }
    }
  }
  $nuevaCarpeta = 'local-{0:D3}' -f ($maxNum + 1)
  $dirOrigen = Join-Path $script:RutaLocales $Carpeta
  $dirDestino = Join-Path $script:RutaLocales $nuevaCarpeta
  if (Test-Path -LiteralPath $dirDestino) { Lanzar-ErrorHttp 409 "Ya existe la carpeta $nuevaCarpeta." }

  # Copiar imagenes y estructura, sin tocar los JSON originales.
  try {
    Asegurar-Carpeta $dirDestino | Out-Null
    Get-ChildItem -LiteralPath $dirOrigen -Force | Where-Object {
      $_.Name -notin @('local.json', 'productos.json')
    } | ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dirDestino $_.Name) -Recurse -Force
    }
  } catch {
    Remove-Item -LiteralPath $dirDestino -Recurse -Force -ErrorAction SilentlyContinue
    Lanzar-ErrorHttp 500 "No se pudo copiar la carpeta del local: $($_.Exception.Message)"
  }

  # Recolectar ids de productos usados en todo el proyecto para no repetirlos.
  $idsUsados = @{}
  foreach ($c in @($indice.locales)) {
    $it = Obtener-LocalPorCarpeta ([string]$c)
    if ($null -eq $it) { continue }
    foreach ($p in @($it.productos)) { if ($p.id) { $idsUsados[[string]$p.id] = $true } }
  }
  foreach ($cat in @('licores', 'primera-necesidad')) {
    $doc = Leer-JsonRuta (Join-Path $script:RutaDatos "$cat\productos.json") $null
    if ($null -ne $doc) { foreach ($p in @($doc.productos)) { if ($p.id) { $idsUsados[[string]$p.id] = $true } } }
  }

  # Clonar el local con un id nuevo y dejarlo sin publicar hasta revisarlo.
  $localNuevo = (Convertir-AJsonBonito $origen.local) | ConvertFrom-Json
  $localNuevo.id = $nuevaCarpeta
  $localNuevo.nombre = ([string]$localNuevo.nombre).Trim() + ' (copia)'
  $localNuevo.publicado = $false
  $localNuevo.esEjemplo = $false

  # Clonar productos con ids nuevos.
  $productosNuevos = @()
  foreach ($p in @($origen.productos)) {
    if ($null -eq $p) { continue }
    $clon = (Convertir-AJsonBonito $p) | ConvertFrom-Json
    $base = Convertir-AId ([string]$p.nombre) 'prod'
    $nuevoId = $base
    $sufijo = 2
    while ($idsUsados.ContainsKey($nuevoId)) { $nuevoId = "$base-$sufijo"; $sufijo++ }
    $idsUsados[$nuevoId] = $true
    $clon.id = $nuevoId
    $productosNuevos += $clon
  }

  try {
    Guardar-JsonAtomico (Join-Path $dirDestino 'local.json') $localNuevo
    Guardar-JsonAtomico (Join-Path $dirDestino 'productos.json') ([ordered]@{
        version   = 1
        localId   = [string]$nuevaCarpeta
        productos = @($productosNuevos)
      })
    $nuevoIndice = @(@($indice.locales) + $nuevaCarpeta)
    Guardar-IndiceLocales ([ordered]@{ version = 1; locales = $nuevoIndice })
    $res = Ejecutar-Importador
    if (-not $res.ok) {
      Guardar-IndiceLocales $indice
      Remove-Item -LiteralPath $dirDestino -Recurse -Force -ErrorAction SilentlyContinue
      [void](Ejecutar-Importador)
      Lanzar-ErrorHttp 422 'No se pudo duplicar el local porque el catalogo quedaria invalido.'
    }
  } catch {
    if ($_.Exception.Data.Contains('httpStatus')) { throw }
    Guardar-IndiceLocales $indice
    Remove-Item -LiteralPath $dirDestino -Recurse -Force -ErrorAction SilentlyContinue
    [void](Ejecutar-Importador)
    Lanzar-ErrorHttp 500 "Error al duplicar el local: $($_.Exception.Message)"
  }

  Registrar-Auditoria $Usuario $Rol 'local.duplicar' "Local $Carpeta duplicado a $nuevaCarpeta con $($productosNuevos.Count) productos" $Ip
  return [ordered]@{
    ok           = $true
    carpeta      = $nuevaCarpeta
    nuevaCarpeta = $nuevaCarpeta
    nombre       = $localNuevo.nombre
    productos    = $productosNuevos.Count
  }
}

# ------------------------------------------------------------
#  Categorias de locales
# ------------------------------------------------------------
function Obtener-CategoriasLocales {
  $ruta = Join-Path $script:RutaLocales 'categorias.json'
  $doc = Leer-JsonRuta $ruta $null
  if ($null -eq $doc) { return [ordered]@{ version = 1; categorias = @() } }
  return $doc
}

function Guardar-CategoriasLocales {
  param($Categorias, [string]$Usuario, [string]$Rol, [string]$Ip)
  $ids = @{}
  $limpias = @()
  foreach ($c in @($Categorias)) {
    $id = Convertir-AId ([string]$c.id) 'cat'
    $nombre = ([string]$c.nombre).Trim()
    if ([string]::IsNullOrWhiteSpace($nombre)) { Lanzar-ErrorHttp 400 'Cada categoria necesita nombre.' }
    if ($ids.ContainsKey($id)) { Lanzar-ErrorHttp 400 "Categoria duplicada: $id" }
    $ids[$id] = $true
    $limpias += [ordered]@{ id = $id; nombre = $nombre }
  }
  # No permitir dejar sin categoria a locales existentes.
  $usadas = @()
  foreach ($carpeta in @((Leer-IndiceLocales).locales)) {
    $item = Obtener-LocalPorCarpeta ([string]$carpeta)
    if ($null -ne $item -and $item.local.categoriaId) { $usadas += [string]$item.local.categoriaId }
  }
  foreach ($u in $usadas) {
    if (-not $ids.ContainsKey($u)) {
      Lanzar-ErrorHttp 400 "No puedes eliminar la categoria '$u' porque hay locales que la usan."
    }
  }
  $ruta = Join-Path $script:RutaLocales 'categorias.json'
  $dirResp = Nuevo-Respaldo 'categorias-locales'
  Copiar-AResplado $ruta $dirResp
  Guardar-JsonAtomico $ruta ([ordered]@{ version = 1; categorias = @($limpias) })
  $res = Ejecutar-Importador
  if (-not $res.ok) {
    Copiar-AResplado (Join-Path $dirResp 'categorias.json') $ruta
    [void](Ejecutar-Importador)
    Lanzar-ErrorHttp 422 'No se pudieron guardar las categorias.'
  }
  Registrar-Auditoria $Usuario $Rol 'categorias.guardar' "$($limpias.Count) categorias" $Ip
  return [ordered]@{ ok = $true; categorias = $limpias }
}

function Obtener-ConfigPublica {
  $ruta = Join-Path $script:CarpetaDatosPublicos 'config.json'
  $doc = Leer-JsonRuta $ruta $null
  if ($null -eq $doc) { Lanzar-ErrorHttp 404 'No se encontro data/config.json.' }
  return $doc
}

function Guardar-ConfigPublica {
  param($Config, [string]$Usuario, [string]$Rol, [string]$Ip)
  if ($null -eq $Config) { Lanzar-ErrorHttp 400 'Faltan los datos de configuracion.' }
  $ruta = Join-Path $script:CarpetaDatosPublicos 'config.json'
  $actual = Leer-JsonRuta $ruta $null
  if ($null -eq $actual) { Lanzar-ErrorHttp 404 'No se encontro data/config.json.' }

  $marca = ([string]$Config.marca).Trim()
  if ($marca.Length -lt 2 -or $marca.Length -gt 60) { Lanzar-ErrorHttp 400 'La marca debe tener entre 2 y 60 caracteres.' }
  $ciudad = ([string]$Config.ciudad).Trim()
  if ($ciudad.Length -lt 2 -or $ciudad.Length -gt 60) { Lanzar-ErrorHttp 400 'La ciudad debe tener entre 2 y 60 caracteres.' }
  $moneda = ([string]$Config.moneda).Trim()
  if ($moneda.Length -lt 1 -or $moneda.Length -gt 5) { Lanzar-ErrorHttp 400 'La moneda debe tener entre 1 y 5 caracteres.' }

  $waNumero = (([string]$Config.whatsapp.numero) -replace '\D', '')
  if ($waNumero.Length -lt 9 -or $waNumero.Length -gt 15) { Lanzar-ErrorHttp 400 'El numero de WhatsApp debe tener entre 9 y 15 digitos (con codigo de pais).' }
  $waVisible = ([string]$Config.whatsapp.visible).Trim()
  if ($waVisible.Length -lt 6 -or $waVisible.Length -gt 24) { Lanzar-ErrorHttp 400 'El numero visible de WhatsApp no es valido.' }

  $email = ([string]$Config.email).Trim()
  if ($email -and $email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') { Lanzar-ErrorHttp 400 'El correo electronico no es valido.' }

  $redes = [ordered]@{}
  foreach ($clave in @('tiktok', 'instagram')) {
    $entrada = $null
    if ($null -ne $Config.redes) { $entrada = $Config.redes.$clave }
    $usuarioRed = ''
    $urlRed = ''
    if ($null -ne $entrada) {
      $usuarioRed = ([string]$entrada.usuario).Trim()
      $urlRed = ([string]$entrada.url).Trim()
    }
    if ($urlRed -and $urlRed -notmatch '^https?://') { Lanzar-ErrorHttp 400 "La URL de $clave debe iniciar con http:// o https://." }
    $redes[$clave] = [ordered]@{
      usuario    = $usuarioRed
      url        = $urlRed
      verificado = ($null -ne $entrada -and $entrada.verificado -eq $true)
      nota       = if ($null -ne $entrada) { [string]$entrada.nota } else { '' }
    }
  }

  $zonas = @()
  $idsZona = @{}
  $zonasEntrada = @($Config.zonas)
  if ($zonasEntrada.Count -eq 0) { Lanzar-ErrorHttp 400 'Debe existir al menos una zona de entrega.' }
  foreach ($z in $zonasEntrada) {
    if ($null -eq $z) { continue }
    $idZona = Convertir-AId ([string]$z.id) ''
    if (-not $idZona) { $idZona = Convertir-AId ([string]$z.nombre) 'zona' }
    if ($idsZona.ContainsKey($idZona)) { Lanzar-ErrorHttp 400 "Zona duplicada: $idZona" }
    $idsZona[$idZona] = $true
    $nombreZona = ([string]$z.nombre).Trim()
    if ($nombreZona.Length -lt 2 -or $nombreZona.Length -gt 60) { Lanzar-ErrorHttp 400 'Cada zona necesita un nombre de 2 a 60 caracteres.' }
    $apertura = ([string]$z.apertura).Trim()
    $cierre = ([string]$z.cierre).Trim()
    if ($apertura -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { Lanzar-ErrorHttp 400 "Hora de apertura invalida en $nombreZona (usa HH:mm)." }
    if ($cierre -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') { Lanzar-ErrorHttp 400 "Hora de cierre invalida en $nombreZona (usa HH:mm)." }
    $dias = @()
    foreach ($dia in @($z.dias)) {
      $n = Convertir-Numero $dia
      if ($null -ne $n -and $n -ge 0 -and $n -le 6) { $dias += [int]$n }
    }
    $dias = @($dias | Sort-Object -Unique)
    if ($dias.Count -eq 0) { $dias = @(0, 1, 2, 3, 4, 5, 6) }
    $zonas += [ordered]@{
      id           = $idZona
      nombre       = $nombreZona
      horarioTexto = ([string]$z.horarioTexto).Trim()
      dias         = @($dias)
      apertura     = $apertura
      cierre       = $cierre
      nota         = ([string]$z.nota).Trim()
    }
  }
  if ($zonas.Count -eq 0) { Lanzar-ErrorHttp 400 'Debe existir al menos una zona de entrega valida.' }

  $zonaPrincipal = ([string]$Config.zonaPrincipal).Trim()
  if (-not $idsZona.ContainsKey($zonaPrincipal)) { $zonaPrincipal = [string]$zonas[0].id }

  $delivery = $actual.delivery
  if ($null -ne $Config.delivery) { $delivery = $Config.delivery }
  $mensajeDelivery = if ($null -ne $delivery) { ([string]$delivery.mensaje).Trim() } else { '' }
  if ($mensajeDelivery.Length -gt 800) { Lanzar-ErrorHttp 400 'El mensaje de delivery es demasiado largo.' }
  $notaDelivery = if ($null -ne $delivery) { ([string]$delivery.nota).Trim() } else { '' }
  if ($notaDelivery.Length -gt 400) { Lanzar-ErrorHttp 400 'La nota de delivery es demasiado larga.' }

  $nueva = [ordered]@{
    version        = 1
    marca          = $marca
    ciudad         = $ciudad
    zonaPrincipal  = $zonaPrincipal
    moneda         = $moneda
    whatsapp       = [ordered]@{ numero = $waNumero; visible = $waVisible }
    email          = $email
    redes          = $redes
    zonas          = @($zonas)
    delivery       = [ordered]@{
      cotizacionPendiente = ($null -eq $delivery -or $delivery.cotizacionPendiente -ne $false)
      mensaje             = $mensajeDelivery
      nota                = $notaDelivery
    }
    avisoEjemplos  = ($Config.avisoEjemplos -eq $true)
    plazavea       = $actual.plazavea
  }

  $dirResp = Nuevo-Respaldo 'config-publica'
  Copiar-AResplado $ruta $dirResp
  Guardar-JsonAtomico $ruta $nueva
  $res = Ejecutar-Importador
  if (-not $res.ok) {
    Copiar-AResplado (Join-Path $dirResp 'config.json') $ruta
    [void](Ejecutar-Importador)
    $detalle = @(Leer-ErroresValidacion)
    if ($detalle.Count -eq 0) { $detalle = @($res.error, $res.salida) | Where-Object { $_ } }
    Lanzar-ErrorHttp 422 ('No se pudo guardar la configuracion: ' + (@($detalle) -join ' '))
  }

  Registrar-Auditoria $Usuario $Rol 'config.guardar' "Configuracion publica actualizada ($marca, $ciudad, $($zonas.Count) zonas)" $Ip
  return [ordered]@{ ok = $true; config = $nueva }
}


function Ruta-Catalogo {
  param([string]$CatalogoId)
  switch ($CatalogoId) {
    'licores' { return $script:RutaCatalogoLicores }
    'primera-necesidad' { return $script:RutaCatalogoNec }
    default { return $null }
  }
}

function Obtener-Catalogo {
  param([string]$CatalogoId)
  $dir = Ruta-Catalogo $CatalogoId
  if ($null -eq $dir) { Lanzar-ErrorHttp 404 'Catalogo no encontrado.' }
  $cats = Leer-JsonRuta (Join-Path $dir 'categorias.json') ([ordered]@{ categorias = @() })
  $prods = Leer-JsonRuta (Join-Path $dir 'productos.json') ([ordered]@{ productos = @() })
  return [ordered]@{
    id         = $CatalogoId
    carpeta    = [string]$CatalogoId
    categorias = @($cats.categorias)
    productos  = @($prods.productos)
  }
}

function Validar-ProductoCatalogo {
  param($Producto, [hashtable]$Categorias, [hashtable]$Ids)
  $errores = @()
  $productoId = [string]$Producto.id
  if ([string]::IsNullOrWhiteSpace($productoId)) { $errores += 'Producto sin identificador.' }
  elseif ($Ids.ContainsKey($productoId)) { $errores += "Producto duplicado: $productoId" }
  else { $Ids[$productoId] = $true }
  if ([string]::IsNullOrWhiteSpace([string]$Producto.nombre)) { $errores += "Producto '$productoId' sin nombre." }
  if ([string]::IsNullOrWhiteSpace([string]$Producto.categoriaId) -or -not $Categorias.ContainsKey([string]$Producto.categoriaId)) {
    $errores += "Producto '$productoId' con categoria invalida."
  }
  if ($null -eq $Producto.fuente -or [string]::IsNullOrWhiteSpace([string]$Producto.fuente.url)) {
    $errores += "Producto '$productoId' necesita el bloque de fuente."
  }
  $publicado = ($Producto.publicado -ne $false)
  if ($publicado) {
    $precio = Convertir-Numero $Producto.precioVenta
    if ($null -eq $precio -or $precio -le 0) {
      $errores += "Producto '$productoId' publicado sin precio de venta valido."
    }
  }
  return $errores
}

function Guardar-Catalogo {
  param(
    [string]$CatalogoId,
    [object[]]$Categorias,
    [object[]]$Productos,
    [string]$Usuario,
    [string]$Rol,
    [string]$Ip
  )
  $dir = Ruta-Catalogo $CatalogoId
  if ($null -eq $dir) { Lanzar-ErrorHttp 404 'Catalogo no encontrado.' }

  $mapa = @{}
  $catsLimpias = @()
  foreach ($c in @($Categorias)) {
    $id = Convertir-AId ([string]$c.id) 'cat'
    $nombre = ([string]$c.nombre).Trim()
    if ([string]::IsNullOrWhiteSpace($nombre)) { Lanzar-ErrorHttp 400 'Cada categoria necesita nombre.' }
    if ($mapa.ContainsKey($id)) { Lanzar-ErrorHttp 400 "Categoria duplicada: $id" }
    $mapa[$id] = $nombre
    $catsLimpias += [ordered]@{ id = $id; nombre = $nombre }
  }
  if ($catsLimpias.Count -eq 0) { Lanzar-ErrorHttp 400 'El catalogo necesita al menos una categoria.' }

  $ids = @{}
  $errores = @()
  $prodsLimpios = @()
  $hoy = Get-Date -Format 'yyyy-MM-dd'
  foreach ($p in @($Productos)) {
    if ($null -eq $p) { continue }
    if ([string]::IsNullOrWhiteSpace([string]$p.id)) { $p.id = Convertir-AId ([string]$p.nombre) 'prod' }
    if ($null -eq $p.fuente -or [string]::IsNullOrWhiteSpace([string]$p.fuente.url)) {
      $p | Add-Member -NotePropertyName fuente -NotePropertyValue ([ordered]@{
          tienda            = 'EnRuta Delivery'
          url               = 'https://wa.me/51922504223'
          productoId        = [string]$p.id
          fechaVerificacion = $hoy
          metodo            = 'Alta manual en panel'
        }) -Force
    }
    if ([string]::IsNullOrWhiteSpace([string]$p.presentacion)) { $p.presentacion = 'Unidad' }
    if ([string]::IsNullOrWhiteSpace([string]$p.marca)) { $p.marca = 'Sin marca' }
    $errores += @(Validar-ProductoCatalogo $p $mapa $ids)
    $prodsLimpios += $p
  }
  if ($errores.Count -gt 0) { Lanzar-ErrorHttp 400 (@($errores) -join ' ') }

  $dirResp = Nuevo-Respaldo "catalogo-$CatalogoId"
  Copiar-AResplado (Join-Path $dir 'categorias.json') $dirResp
  Copiar-AResplado (Join-Path $dir 'productos.json') $dirResp
  $antesCat = Leer-TextoPlano (Join-Path $dir 'categorias.json')
  $antesProd = Leer-TextoPlano (Join-Path $dir 'productos.json')
  $aviso = 'Precios y disponibilidad sujetos a confirmacion. La fuente indica el origen del dato.'
  try {
    Guardar-JsonAtomico (Join-Path $dir 'categorias.json') ([ordered]@{ version = 1; catalogoId = $CatalogoId; categorias = @($catsLimpias) })
    Guardar-JsonAtomico (Join-Path $dir 'productos.json') ([ordered]@{ version = 1; catalogoId = $CatalogoId; avisoPrecios = $aviso; productos = @($prodsLimpios) })
    $res = Ejecutar-Importador
    if (-not $res.ok) {
      [IO.File]::WriteAllText((Join-Path $dir 'categorias.json'), $antesCat, $script:Utf8SinBom)
      [IO.File]::WriteAllText((Join-Path $dir 'productos.json'), $antesProd, $script:Utf8SinBom)
      [void](Ejecutar-Importador)
      $detalle = @(Leer-ErroresValidacion)
      if ($detalle.Count -eq 0) { $detalle = @($res.error) }
      Lanzar-ErrorHttp 422 ('No se pudo publicar: ' + (@($detalle) -join ' '))
    }
  } catch {
    if ($_.Exception.Data.Contains('httpStatus')) { throw }
    Lanzar-ErrorHttp 500 "Error al guardar el catalogo: $($_.Exception.Message)"
  }
  Registrar-Auditoria $Usuario $Rol "catalogo.guardar" "Catalogo $CatalogoId con $($prodsLimpios.Count) productos" $Ip
  return [ordered]@{ ok = $true; productos = $prodsLimpios.Count }
}

# ------------------------------------------------------------
#  Imagenes
# ------------------------------------------------------------
function Guardar-ImagenBase64 {
  param(
    [string]$Carpeta,
    [string]$NombreOriginal,
    [string]$Tipo,
    [string]$Base64,
    [string]$Prefijo = 'img'
  )
  if ([string]::IsNullOrWhiteSpace($Base64)) { Lanzar-ErrorHttp 400 'No se recibio la imagen.' }
  if ($Base64.Length -gt 12000000) { Lanzar-ErrorHttp 413 'La imagen supera el limite de 8 MB.' }
  $limpio = $Base64
  if ($limpio -match '^data:[^;]+;base64,') { $limpio = $limpio.Substring($limpio.IndexOf(',') + 1) }
  try { $bytes = [Convert]::FromBase64String($limpio) } catch { Lanzar-ErrorHttp 400 'La imagen no es base64 valido.' }
  if ($bytes.Length -gt 9000000) { Lanzar-ErrorHttp 413 'La imagen supera el limite de 8 MB.' }

  $esPng = ($bytes.Length -gt 8 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50 -and $bytes[2] -eq 0x4E -and $bytes[3] -eq 0x47)
  $esJpg = ($bytes.Length -gt 3 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8)
  $esWebp = ($bytes.Length -gt 12 -and $bytes[0] -eq 0x52 -and $bytes[1] -eq 0x49 -and $bytes[2] -eq 0x46 -and $bytes[3] -eq 0x46 -and $bytes[8] -eq 0x57 -and $bytes[9] -eq 0x45 -and $bytes[10] -eq 0x42 -and $bytes[11] -eq 0x50)
  if (-not ($esPng -or $esJpg -or $esWebp)) {
    Lanzar-ErrorHttp 400 'Formato de imagen no permitido. Usa JPG, PNG o WEBP.'
  }
  if ($esWebp) {
    Lanzar-ErrorHttp 415 'Este servidor no decodifica WEBP. Convierte la imagen a JPG o PNG antes de subirla.'
  }

  $dir = $Carpeta
  Asegurar-Carpeta $dir | Out-Null
  $base = Convertir-AId ([IO.Path]::GetFileNameWithoutExtension($NombreOriginal)) 'imagen'
  if ($base.Length -gt 40) { $base = $base.Substring(0, 40) }
  $nombreArchivo = $Prefijo + '-' + (Get-Date -Format 'yyyyMMddHHmmss') + '-' + $base
  $ext = if ($esPng) { '.png' } else { '.jpg' }
  $destino = Join-Path $dir ($nombreArchivo + $ext)

  # Redimensionar para no guardar fotos gigantes.
  try {
    Add-Type -AssemblyName System.Drawing -ErrorAction SilentlyContinue
    $ms = New-Object IO.MemoryStream(,$bytes)
    $img = [System.Drawing.Image]::FromStream($ms)
    $max = 1600
    $w = $img.Width; $h = $img.Height
    if ($w -gt $max -or $h -gt $max) {
      $ratio = [Math]::Min($max / $w, $max / $h)
      $nw = [int][Math]::Round($w * $ratio)
      $nh = [int][Math]::Round($h * $ratio)
      $bmp = New-Object System.Drawing.Bitmap($nw, $nh)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $g.DrawImage($img, 0, 0, $nw, $nh)
      $g.Dispose()
      if ($esPng) { $bmp.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png) } else { $bmp.Save($destino, [System.Drawing.Imaging.ImageFormat]::Jpeg) }
      $bmp.Dispose()
    } else {
      [IO.File]::WriteAllBytes($destino, $bytes)
    }
    $img.Dispose()
    $ms.Dispose()
  } catch {
    [IO.File]::WriteAllBytes($destino, $bytes)
  }

  $rel = $destino.Substring($script:Raiz.Length).TrimStart('\', '/').Replace('\', '/')
  return [ordered]@{ ok = $true; ruta = ('img/' + [IO.Path]::GetFileName($destino)); url = $rel; nombre = [IO.Path]::GetFileName($destino) }
}

# ------------------------------------------------------------
#  Pedidos
# ------------------------------------------------------------
function Leer-Pedidos {
  Inicializar-Datos
  $doc = Leer-JsonRuta $script:RutaPedidos $null
  if ($null -eq $doc -or $null -eq $doc.pedidos) { return [ordered]@{ version = 1; pedidos = @() } }
  return $doc
}

function Buscar-ProductoParaPedido {
  param([string]$Tipo, [string]$LocalId, [string]$CatalogoId, [string]$ProductoId)
  if ($Tipo -eq 'local') {
    $item = Buscar-CarpetaPorLocalId $LocalId
    if ($null -eq $item) { return $null }
    $local = $item.local
    if ($local.publicado -ne $true -or $local.disponible -eq $false -or $local.cerradoTemporal -eq $true) { return $null }
    $p = @($item.productos) | Where-Object { [string]$_.id -eq $ProductoId } | Select-Object -First 1
    if ($null -eq $p) { return $null }
    if ($p.publicado -eq $false) { return $null }
    return [ordered]@{
      tipo      = 'local'
      localId   = [string]$local.id
      localCarpeta = [string]$item.carpeta
      localNombre = [string]$local.nombre
      producto  = $p
      empaquetado = $local.empaquetado
    }
  } else {
    $cat = Obtener-Catalogo $CatalogoId
    $p = @($cat.productos) | Where-Object { [string]$_.id -eq $ProductoId } | Select-Object -First 1
    if ($null -eq $p) { return $null }
    if ($p.publicado -eq $false -or $p.disponible -eq $false) { return $null }
    return [ordered]@{
      tipo      = 'catalogo'
      catalogoId = [string]$CatalogoId
      producto  = $p
      empaquetado = $null
    }
  }
}

function Precio-ProductoPedido {
  param($Producto, [string]$VarianteId, [object[]]$ExtrasSolicitados = @())
  $precioBase = Convertir-Numero $Producto.precio
  if ($null -eq $precioBase) { $precioBase = 0.0 }
  $varianteNombre = ''
  $varianteIdSalida = $null
  if ($VarianteId) {
    $v = @($Producto.variantes) | Where-Object { $null -ne $_ -and [string]$_.id -eq $VarianteId } | Select-Object -First 1
    if ($null -eq $v) { Lanzar-ErrorHttp 400 'La variante elegida ya no esta disponible.' }
    $precioBase = Convertir-Numero $v.precio
    if ($null -eq $precioBase) { $precioBase = 0.0 }
    $varianteNombre = [string]$v.nombre
    $varianteIdSalida = [string]$v.id
  }
  if ($precioBase -le 0) {
    Lanzar-ErrorHttp 400 ('El producto "' + [string]$Producto.nombre + '" no tiene un precio valido. Elige una variante disponible.')
  }

  $extras = @()
  $extrasPrecio = 0.0
  $vistos = @{}
  foreach ($solicitado in @($ExtrasSolicitados)) {
    if ($null -eq $solicitado) { continue }
    $nombre = ([string]$solicitado).Trim()
    if ([string]::IsNullOrWhiteSpace($nombre)) { continue }
    $clave = Normalizar-Texto $nombre
    if ($vistos.ContainsKey($clave)) { continue }
    $e = @($Producto.extras) | Where-Object { $null -ne $_ -and (Normalizar-Texto ([string]$_.nombre)) -eq $clave } | Select-Object -First 1
    if ($null -eq $e) {
      Lanzar-ErrorHttp 400 ('El extra "' + $nombre + '" ya no esta disponible para este producto.')
    }
    $precioExtra = Convertir-Numero $e.precio
    if ($null -eq $precioExtra) { $precioExtra = 0.0 }
    $extras += [ordered]@{ nombre = [string]$e.nombre; precio = [Math]::Round($precioExtra, 2) }
    $extrasPrecio += $precioExtra
    $vistos[$clave] = $true
  }
  if (@($extras).Count -gt 20) { Lanzar-ErrorHttp 400 'Demasiados extras en un producto.' }

  $precioTotal = [Math]::Round($precioBase + $extrasPrecio, 2)
  if ($precioTotal -le 0) { Lanzar-ErrorHttp 400 'El precio del producto no es valido.' }
  return [ordered]@{
    precio       = $precioTotal
    precioBase   = [Math]::Round($precioBase, 2)
    varianteId   = $varianteIdSalida
    variante     = $varianteNombre
    extras       = @($extras)
    extrasPrecio = [Math]::Round($extrasPrecio, 2)
  }
}

function Calcular-PedidoServidor {
  param([object[]]$Items)
  if (@($Items).Count -gt 200) { Lanzar-ErrorHttp 400 'El pedido tiene demasiadas lineas.' }
  $grupos = @{}
  $localCarpetas = @()
  $totalUnidades = 0
  foreach ($raw in @($Items)) {
    if ($null -eq $raw) { continue }
    $tipo = if ([string]$raw.tipo -eq 'local') { 'local' } else { 'catalogo' }
    $cantidadNum = Convertir-Numero $raw.cantidad
    if ($null -eq $cantidadNum) { Lanzar-ErrorHttp 400 'Cantidad invalida en el pedido.' }
    $cantidad = [int][Math]::Round($cantidadNum)
    if ($cantidad -lt 1 -or $cantidad -gt 99) { Lanzar-ErrorHttp 400 'Cantidad invalida en el pedido.' }
    $encontrado = Buscar-ProductoParaPedido $tipo ([string]$raw.localId) ([string]$raw.catalogoId) ([string]$raw.productoId)
    if ($null -eq $encontrado) { Lanzar-ErrorHttp 400 'Un producto del pedido ya no esta disponible.' }
    $p = $encontrado.producto
    $extrasSolicitados = @()
    foreach ($extraRaw in @($raw.extras)) {
      if ($null -eq $extraRaw) { continue }
      if ($extraRaw -is [string]) { $extrasSolicitados += [string]$extraRaw }
      elseif ($null -ne $extraRaw.nombre) { $extrasSolicitados += [string]$extraRaw.nombre }
    }
    $precioInfo = Precio-ProductoPedido $p ([string]$raw.varianteId) $extrasSolicitados
    $nombre = [string]$p.nombre
    if ($precioInfo.variante) { $nombre += ' · ' + $precioInfo.variante }
    $nombresExtras = @($precioInfo.extras | ForEach-Object { [string]$_.nombre })
    if ($nombresExtras.Count -gt 0) { $nombre += ' + ' + ($nombresExtras -join ', ') }
    $clave = if ($tipo -eq 'local') { 'local:' + $encontrado.localId } else { 'cat:' + $encontrado.catalogoId }
    if (-not $grupos.ContainsKey($clave)) {
      $grupos[$clave] = [ordered]@{
        clave      = $clave
        tipo       = $tipo
        localId    = $encontrado.localId
        localCarpeta = $encontrado.localCarpeta
        catalogoId = $encontrado.catalogoId
        nombre     = if ($tipo -eq 'local') { $encontrado.localNombre } else { (Obtener-Catalogo $encontrado.catalogoId).id }
        etiqueta   = if ($tipo -eq 'local') { 'Local' } else { 'Catalogo EnRuta' }
        empaquetado = $encontrado.empaquetado
        items      = @()
        subtotal   = 0.0
        unidades   = 0
      }
    }
    $item = [ordered]@{
      tipo         = $tipo
      productoId   = [string]$p.id
      nombre       = $nombre
      varianteId   = $precioInfo.varianteId
      variante     = $precioInfo.variante
      extras       = @($precioInfo.extras)
      precioBase   = [double]$precioInfo.precioBase
      precioExtras = [double]$precioInfo.extrasPrecio
      precio       = [double]$precioInfo.precio
      cantidad     = $cantidad
      subtotal     = [Math]::Round([double]$precioInfo.precio * $cantidad, 2)
    }
    $grupos[$clave].items += $item
    $grupos[$clave].subtotal += $item.subtotal
    $grupos[$clave].unidades += $cantidad
    $totalUnidades += $cantidad
    if ($tipo -eq 'local' -and $localCarpetas -notcontains $encontrado.localCarpeta) {
      $localCarpetas += [string]$encontrado.localCarpeta
    }
  }
  if ($grupos.Count -eq 0) { Lanzar-ErrorHttp 400 'El pedido esta vacio.' }

  $empaquetadoTotal = 0.0
  $gruposSalida = @()
  foreach ($k in $grupos.Keys) {
    $g = $grupos[$k]
    $emp = $g.empaquetado
    $monto = 0.0
    $montoBase = if ($emp) { Convertir-Numero $emp.monto } else { $null }
    if ($null -eq $montoBase) { $montoBase = 0.0 }
    if ($emp -and $emp.aplica -eq $true -and $montoBase -gt 0) {
      $monto = if ($emp.porUnidad -eq $true) { $montoBase * $g.unidades } else { $montoBase }
    }
    $g.empaquetadoMonto = [Math]::Round($monto, 2)
    $empaquetadoTotal += $monto
    $g.subtotal = [Math]::Round($g.subtotal, 2)
    $gruposSalida += $g
  }
  $subtotal = 0.0
  foreach ($g in $gruposSalida) { $subtotal += $g.subtotal }

  return [ordered]@{
    grupos          = @($gruposSalida)
    unidades        = $totalUnidades
    subtotal        = [Math]::Round($subtotal, 2)
    empaquetado     = [Math]::Round($empaquetadoTotal, 2)
    total           = [Math]::Round($subtotal + $empaquetadoTotal, 2)
    localCarpetas   = @($localCarpetas)
  }
}

function Guardar-PedidoPublico {
  param($Datos, [System.Net.HttpListenerContext]$Contexto)
  $nombre = ([string]$Datos.nombre).Trim()
  $telefono = ([string]$Datos.telefono).Trim()
  $direccion = ([string]$Datos.direccion).Trim()
  $zonaId = ([string]$Datos.zonaId).Trim()
  $referencia = ([string]$Datos.referencia).Trim()
  $nota = ([string]$Datos.nota).Trim()
  if ($nombre.Length -lt 3 -or $nombre.Length -gt 120) { Lanzar-ErrorHttp 400 'Nombre invalido.' }
  $soloDigitos = ($telefono -replace '\D', '')
  if ($soloDigitos.Length -lt 9 -or $soloDigitos.Length -gt 15) { Lanzar-ErrorHttp 400 'Celular invalido.' }
  if ($direccion.Length -lt 8 -or $direccion.Length -gt 240) { Lanzar-ErrorHttp 400 'Direccion invalida.' }
  if ($nota.Length -gt 600 -or $referencia.Length -gt 240) { Lanzar-ErrorHttp 400 'Texto demasiado largo.' }

  $config = Leer-JsonRuta (Join-Path $script:CarpetaDatosPublicos 'config.json') $null
  $zonaNombre = $zonaId
  if ($null -ne $config) {
    $z = @($config.zonas) | Where-Object { [string]$_.id -eq $zonaId } | Select-Object -First 1
    if ($null -eq $z) { Lanzar-ErrorHttp 400 'Zona de entrega invalida.' }
    $zonaNombre = [string]$z.nombre
  }

  $calculo = Calcular-PedidoServidor @($Datos.items)
  $doc = Leer-Pedidos
  $id = 'PED-' + (Get-Date -Format 'yyyyMMdd') + '-' + (Convertir-Base64Url (Generar-BytesAleatorios 4)).ToUpperInvariant()
  $pedido = [ordered]@{
    id           = $id
    creadoEn     = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    estado       = 'nuevo'
    nombre       = $nombre
    telefono     = $telefono
    zonaId       = $zonaId
    zonaNombre   = $zonaNombre
    direccion    = $direccion
    referencia   = $referencia
    nota         = $nota
    programado   = ($Datos.programado -eq $true)
    fechaEntrega = if ($Datos.fecha) { [string]$Datos.fecha } else { $null }
    cuandoTexto  = ([string]$Datos.cuandoTexto)
    localCarpetas = @($calculo.localCarpetas)
    items        = @($calculo.grupos)
    unidades     = $calculo.unidades
    subtotal     = $calculo.subtotal
    empaquetado  = $calculo.empaquetado
    total        = $calculo.total
    origen       = 'web'
    ip           = (Obtener-IpCliente $Contexto)
    userAgent    = ([string]$Contexto.Request.UserAgent)
  }
  $lista = @($doc.pedidos) + @($pedido)
  $doc.pedidos = $lista
  Guardar-JsonAtomico $script:RutaPedidos $doc
  Registrar-Auditoria 'cliente-web' 'publico' 'pedido.crear' "Pedido $id por $($calculo.total) con $($calculo.unidades) unidades" (Obtener-IpCliente $Contexto)
  return [ordered]@{ ok = $true; pedidoId = $id; total = $calculo.total; unidades = $calculo.unidades }
}

function Obtener-PedidosAdmin {
  param($Sesion, [string]$Estado = '', [int]$Limite = 100)
  $doc = Leer-Pedidos
  $salida = @()
  foreach ($p in @($doc.pedidos)) {
    if ($Sesion.rol -eq 'local') {
      if (@($p.localCarpetas) -notcontains [string]$Sesion.localCarpeta) { continue }
    }
    if ($Estado -and [string]$p.estado -ne $Estado) { continue }
    $salida += $p
    if ($salida.Count -ge $Limite) { break }
  }
  # Mas recientes primero.
  return @($salida | Sort-Object -Property creadoEn -Descending)
}

function Cambiar-EstadoPedido {
  param([string]$Id, [string]$Estado, $Sesion, [string]$Ip)
  $validos = @('nuevo', 'confirmado', 'en-camino', 'entregado', 'cancelado')
  if ($validos -notcontains $Estado) { Lanzar-ErrorHttp 400 'Estado invalido.' }
  $doc = Leer-Pedidos
  $encontrado = $null
  foreach ($p in @($doc.pedidos)) {
    if ([string]$p.id -eq $Id) {
      if ($Sesion.rol -eq 'local' -and (@($p.localCarpetas) -notcontains [string]$Sesion.localCarpeta)) {
        Lanzar-ErrorHttp 403 'Ese pedido no pertenece a tu local.'
      }
      $p.estado = $Estado
      $p | Add-Member -NotePropertyName actualizadoEn -NotePropertyValue (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Force
      $encontrado = $p
    }
  }
  if ($null -eq $encontrado) { Lanzar-ErrorHttp 404 'Pedido no encontrado.' }
  Guardar-JsonAtomico $script:RutaPedidos $doc
  Registrar-Auditoria $Sesion.usuario $Sesion.rol 'pedido.estado' "Pedido $Id -> $Estado" $Ip
  return [ordered]@{ ok = $true; pedido = $encontrado }
}

# ------------------------------------------------------------
#  Servicios: recojo/envio de productos y taximoto
# ------------------------------------------------------------
function Leer-Servicios {
  Inicializar-Datos
  $doc = Leer-JsonRuta $script:RutaServicios $null
  if ($null -eq $doc) { return [ordered]@{ version = 1; envios = @(); taximotos = @() } }
  if ($null -eq $doc.envios) { $doc | Add-Member -NotePropertyName envios -NotePropertyValue @() -Force }
  if ($null -eq $doc.taximotos) { $doc | Add-Member -NotePropertyName taximotos -NotePropertyValue @() -Force }
  return $doc
}

function Validar-TelefonoServicio {
  param([string]$Telefono, [string]$Campo)
  $digitos = ($Telefono -replace '\D', '')
  if ($digitos.Length -lt 9 -or $digitos.Length -gt 15) {
    Lanzar-ErrorHttp 400 ("Telefono invalido: " + $Campo + ".")
  }
  return $Telefono.Trim()
}

function Validar-CuandoServicio {
  param($Datos)
  $cuando = ([string]$Datos.cuando).Trim().ToLowerInvariant()
  if ($cuando -ne 'programado') { $cuando = 'urgente' }
  $fecha = $null
  if ($cuando -eq 'programado') {
    $texto = ([string]$Datos.fecha).Trim()
    if ([string]::IsNullOrWhiteSpace($texto)) { Lanzar-ErrorHttp 400 'Indica la fecha y hora del servicio.' }
    try {
      $fecha = [DateTime]::Parse($texto, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
    } catch {
      Lanzar-ErrorHttp 400 'La fecha y hora no son validas.'
    }
    if ($fecha -lt (Get-Date).AddMinutes(-5)) { Lanzar-ErrorHttp 400 'La fecha y hora deben ser futuras.' }
  }
  return [ordered]@{
    cuando      = $cuando
    fecha       = if ($null -ne $fecha) { $fecha.ToString('yyyy-MM-ddTHH:mm') } else { $null }
    cuandoTexto = if ($cuando -eq 'urgente') { 'Urgente (lo antes posible)' } else { 'Programado: ' + $fecha.ToString('dd/MM/yyyy HH:mm') }
  }
}

function Guardar-ServicioPublico {
  param([string]$Tipo, $Datos, [System.Net.HttpListenerContext]$Contexto)
  if ($null -eq $Datos) { Lanzar-ErrorHttp 400 'Solicitud vacia.' }
  if (@('envio', 'taximoto') -notcontains $Tipo) { Lanzar-ErrorHttp 400 'Tipo de servicio invalido.' }
  $cuando = Validar-CuandoServicio $Datos
  $origen = ([string]$Datos.origen).Trim()
  $destino = ([string]$Datos.destino).Trim()
  if ($origen.Length -lt 6 -or $origen.Length -gt 240) { Lanzar-ErrorHttp 400 'Direccion de origen invalida.' }
  if ($destino.Length -lt 6 -or $destino.Length -gt 240) { Lanzar-ErrorHttp 400 'Direccion de destino invalida.' }

  $prefijo = if ($Tipo -eq 'taximoto') { 'TAX' } else { 'ENV' }
  $id = $prefijo + '-' + (Get-Date -Format 'yyyyMMdd') + '-' + (Convertir-Base64Url (Generar-BytesAleatorios 4)).ToUpperInvariant()
  $servicio = [ordered]@{
    id              = $id
    tipo            = $Tipo
    creadoEn        = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    estado          = 'pendiente'
    origen          = $origen
    destino         = $destino
    cuando          = $cuando.cuando
    fecha           = $cuando.fecha
    cuandoTexto     = $cuando.cuandoTexto
    origenSolicitud = 'web'
    ip              = (Obtener-IpCliente $Contexto)
    userAgent       = ([string]$Contexto.Request.UserAgent)
  }

  $doc = Leer-Servicios
  if ($Tipo -eq 'taximoto') {
    $nombre = ([string]$Datos.nombreCliente).Trim()
    if ($nombre.Length -lt 3 -or $nombre.Length -gt 120) { Lanzar-ErrorHttp 400 'Nombre del cliente invalido.' }
    $servicio.nombreCliente = $nombre
    $servicio.telefono = Validar-TelefonoServicio ([string]$Datos.telefono) 'del cliente'
    $doc.taximotos = @($doc.taximotos) + @($servicio)
    Guardar-JsonAtomico $script:RutaServicios $doc
    Registrar-Auditoria 'cliente-web' 'publico' 'taximoto.crear' "Taximoto $id de $origen a $destino" (Obtener-IpCliente $Contexto)
    return [ordered]@{ ok = $true; servicioId = $id; tipo = 'taximoto' }
  }

  $nombreEnvia = ([string]$Datos.nombreEnvia).Trim()
  if ($nombreEnvia.Length -lt 3 -or $nombreEnvia.Length -gt 120) { Lanzar-ErrorHttp 400 'Nombre de quien envia invalido.' }
  $telefonoEnvia = Validar-TelefonoServicio ([string]$Datos.telefonoEnvia) 'de quien envia'
  $nombreRecibe = ([string]$Datos.nombreRecibe).Trim()
  if ($nombreRecibe.Length -lt 3 -or $nombreRecibe.Length -gt 120) { Lanzar-ErrorHttp 400 'Nombre de quien recibe invalido.' }
  $telefonoRecibe = Validar-TelefonoServicio ([string]$Datos.telefonoRecibe) 'de quien recibe'
  $descripcion = ([string]$Datos.descripcion).Trim()
  if ($descripcion.Length -lt 3 -or $descripcion.Length -gt 400) { Lanzar-ErrorHttp 400 'Describe el producto que se envia.' }
  $observaciones = ([string]$Datos.observaciones).Trim()
  if ($observaciones.Length -gt 600) { Lanzar-ErrorHttp 400 'Las observaciones son demasiado largas.' }

  $servicio.nombreEnvia = $nombreEnvia
  $servicio.telefonoEnvia = $telefonoEnvia
  $servicio.nombreRecibe = $nombreRecibe
  $servicio.telefonoRecibe = $telefonoRecibe
  $servicio.descripcion = $descripcion
  $servicio.observaciones = $observaciones
  $doc.envios = @($doc.envios) + @($servicio)
  Guardar-JsonAtomico $script:RutaServicios $doc
  Registrar-Auditoria 'cliente-web' 'publico' 'envio.crear' "Envio $id de $origen a $destino" (Obtener-IpCliente $Contexto)
  return [ordered]@{ ok = $true; servicioId = $id; tipo = 'envio' }
}

function Obtener-ServiciosAdmin {
  param([string]$Tipo = '', [int]$Limite = 300)
  $doc = Leer-Servicios
  $salida = @()
  if ($Tipo -ne 'taximoto') { $salida += @($doc.envios) }
  if ($Tipo -ne 'envio') { $salida += @($doc.taximotos) }
  return @($salida | Sort-Object -Property creadoEn -Descending | Select-Object -First $Limite)
}

function Cambiar-EstadoServicio {
  param([string]$Tipo, [string]$Id, [string]$Estado, $Sesion, [string]$Ip)
  if (@('envio', 'taximoto') -notcontains $Tipo) { Lanzar-ErrorHttp 400 'Tipo de servicio invalido.' }
  $validos = @('pendiente', 'en camino', 'entregado')
  if ($validos -notcontains $Estado) { Lanzar-ErrorHttp 400 'Estado invalido.' }
  $doc = Leer-Servicios
  $lista = if ($Tipo -eq 'taximoto') { $doc.taximotos } else { $doc.envios }
  $encontrado = $null
  foreach ($s in @($lista)) {
    if ([string]$s.id -eq $Id) {
      $s.estado = $Estado
      $s | Add-Member -NotePropertyName actualizadoEn -NotePropertyValue (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') -Force
      $encontrado = $s
    }
  }
  if ($null -eq $encontrado) { Lanzar-ErrorHttp 404 'Solicitud no encontrada.' }
  if ($Tipo -eq 'taximoto') { $doc.taximotos = $lista } else { $doc.envios = $lista }
  Guardar-JsonAtomico $script:RutaServicios $doc
  Registrar-Auditoria $Sesion.usuario $Sesion.rol ($Tipo + '.estado') "Solicitud $Id -> $Estado" $Ip
  return [ordered]@{ ok = $true; servicio = $encontrado }
}

function Obtener-ResumenAdmin {
  param($Sesion)
  $locales = @(Obtener-LocalesAdmin)
  if ($Sesion.rol -eq 'local') {
    $locales = @($locales | Where-Object { $_.carpeta -eq [string]$Sesion.localCarpeta })
  }
  $pedidos = @(Obtener-PedidosAdmin $Sesion '' 1000)
  $hoy = Get-Date -Format 'yyyy-MM-dd'
  $pedidosHoy = @($pedidos | Where-Object { ([string]$_.creadoEn).StartsWith($hoy) })
  $totalProductos = 0; $publicados = 0; $pendientes = 0
  foreach ($l in $locales) {
    $totalProductos += [int]$l.totalProductos
    $publicados += [int]$l.publicados
    $pendientes += [int]$l.pendientes
  }
  $catL = Obtener-Catalogo 'licores'
  $catN = Obtener-Catalogo 'primera-necesidad'
  return [ordered]@{
    locales        = $locales.Count
    productos      = $totalProductos
    publicados     = $publicados
    pendientes     = $pendientes
    pedidosHoy     = $pedidosHoy.Count
    pedidosNuevos  = @($pedidos | Where-Object { [string]$_.estado -eq 'nuevo' }).Count
    ventasHoy      = [Math]::Round((@($pedidosHoy) | Measure-Object -Property total -Sum).Sum, 2)
    catalogoLicores = @($catL.productos).Count
    catalogoNec    = @($catN.productos).Count
    generadoEn     = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
  }
}

function Obtener-EstadisticasVentas {
  param($Sesion, [string]$Desde = '', [string]$Hasta = '', [string]$Local = '')

  $hoy = (Get-Date).Date
  $dHasta = $hoy
  $dDesde = $hoy.AddDays(-29)
  $tmp = [datetime]::MinValue
  $cultura = [Globalization.CultureInfo]::InvariantCulture
  if ($Hasta -and [datetime]::TryParseExact($Hasta, 'yyyy-MM-dd', $cultura, [Globalization.DateTimeStyles]::None, [ref]$tmp)) { $dHasta = $tmp }
  if ($Desde -and [datetime]::TryParseExact($Desde, 'yyyy-MM-dd', $cultura, [Globalization.DateTimeStyles]::None, [ref]$tmp)) { $dDesde = $tmp }
  if ($dDesde -gt $dHasta) { $cambio = $dDesde; $dDesde = $dHasta; $dHasta = $cambio }
  if (($dHasta - $dDesde).Days -gt 366) { $dDesde = $dHasta.AddDays(-366) }
  $desdeTxt = $dDesde.ToString('yyyy-MM-dd')
  $hastaTxt = $dHasta.ToString('yyyy-MM-dd')

  $filtroLocal = $Local
  if ($Sesion.rol -eq 'local') { $filtroLocal = [string]$Sesion.localCarpeta }

  $nombresLocales = @{}
  foreach ($l in @(Obtener-LocalesAdmin)) { $nombresLocales[[string]$l.carpeta] = [string]$l.nombre }

  # Serie diaria completa (incluye dias sin ventas).
  $porDia = [ordered]@{}
  $cursor = $dDesde
  while ($cursor -le $dHasta) {
    $f = $cursor.ToString('yyyy-MM-dd')
    $porDia[$f] = [ordered]@{ fecha = $f; pedidos = 0; unidades = 0; ventas = 0.0 }
    $cursor = $cursor.AddDays(1)
  }

  $porProducto = @{}
  $porLocal = @{}
  $pedidosTotal = 0
  $unidadesTotal = 0
  $ventasTotal = 0.0

  $doc = Leer-Pedidos
  foreach ($p in @($doc.pedidos)) {
    if ([string]$p.estado -eq 'cancelado') { continue }
    $creado = [string]$p.creadoEn
    $fecha = if ($creado.Length -ge 10) { $creado.Substring(0, 10) } else { '' }
    if (-not $fecha -or $fecha -lt $desdeTxt -or $fecha -gt $hastaTxt) { continue }

    $localesDelPedido = @{}
    $pedidoCuenta = $false
    $ventasPedido = 0.0
    $unidadesPedido = 0

    foreach ($g in @($p.items)) {
      if ($null -eq $g) { continue }
      $carpeta = [string]$g.localCarpeta
      if (-not $carpeta -and [string]$g.tipo -eq 'catalogo') { $carpeta = 'catalogo:' + [string]$g.catalogoId }
      if (-not $carpeta) { continue }
      if ($filtroLocal -and $carpeta -ne $filtroLocal) { continue }

      $nombreLocal = ''
      if ($nombresLocales.ContainsKey($carpeta)) { $nombreLocal = [string]$nombresLocales[$carpeta] }
      elseif ($carpeta.StartsWith('catalogo:')) { $nombreLocal = 'Catalogo EnRuta (' + $carpeta.Substring(9) + ')' }
      else { $nombreLocal = $carpeta }

      $ventaGrupo = [double]$g.subtotal + [double]$g.empaquetadoMonto
      $unidadesGrupo = [int]$g.unidades

      if (-not $porLocal.ContainsKey($carpeta)) {
        $porLocal[$carpeta] = [ordered]@{ carpeta = $carpeta; nombre = $nombreLocal; pedidos = 0; unidades = 0; ventas = 0.0 }
      }
      $porLocal[$carpeta].unidades += $unidadesGrupo
      $porLocal[$carpeta].ventas += $ventaGrupo

      foreach ($it in @($g.items)) {
        if ($null -eq $it) { continue }
        $clave = $carpeta + '|' + [string]$it.productoId
        if (-not $porProducto.ContainsKey($clave)) {
          $porProducto[$clave] = [ordered]@{
            productoId = [string]$it.productoId
            nombre     = [string]$it.nombre
            tipo       = [string]$g.tipo
            localCarpeta = $carpeta
            localNombre  = $nombreLocal
            unidades   = 0
            ventas     = 0.0
            pedidos    = @{}
          }
        }
        $porProducto[$clave].unidades += [int]$it.cantidad
        $porProducto[$clave].ventas += [double]$it.subtotal
        $porProducto[$clave].pedidos[[string]$p.id] = $true
      }

      $localesDelPedido[$carpeta] = $true
      $pedidoCuenta = $true
      $ventasPedido += $ventaGrupo
      $unidadesPedido += $unidadesGrupo
    }

    if (-not $pedidoCuenta) { continue }
    $pedidosTotal++
    $unidadesTotal += $unidadesPedido
    $ventasTotal += $ventasPedido
    if ($porDia.Contains($fecha)) {
      $porDia[$fecha].pedidos++
      $porDia[$fecha].unidades += $unidadesPedido
      $porDia[$fecha].ventas += $ventasPedido
    }
    foreach ($c in $localesDelPedido.Keys) {
      if ($porLocal.ContainsKey($c)) { $porLocal[$c].pedidos++ }
    }
  }

  $productosSalida = @()
  foreach ($clave in $porProducto.Keys) {
    $x = $porProducto[$clave]
    $productosSalida += [ordered]@{
      productoId   = $x.productoId
      nombre       = $x.nombre
      tipo         = $x.tipo
      localCarpeta = $x.localCarpeta
      localNombre  = $x.localNombre
      unidades     = [int]$x.unidades
      ventas       = [Math]::Round([double]$x.ventas, 2)
      pedidos      = @($x.pedidos.Keys).Count
    }
  }
  $productosSalida = @($productosSalida | Sort-Object -Property @{ Expression = { $_.unidades }; Descending = $true }, @{ Expression = { $_.ventas }; Descending = $true })
  $porVentas = @($productosSalida | Sort-Object -Property @{ Expression = { $_.ventas }; Descending = $true }, @{ Expression = { $_.unidades }; Descending = $true })

  $localesSalida = @()
  foreach ($clave in $porLocal.Keys) {
    $x = $porLocal[$clave]
    $localesSalida += [ordered]@{
      carpeta  = $x.carpeta
      nombre   = $x.nombre
      pedidos  = [int]$x.pedidos
      unidades = [int]$x.unidades
      ventas   = [Math]::Round([double]$x.ventas, 2)
    }
  }
  $localesSalida = @($localesSalida | Sort-Object -Property @{ Expression = { $_.ventas }; Descending = $true })

  $diasSalida = @()
  foreach ($f in $porDia.Keys) {
    $d = $porDia[$f]
    $diasSalida += [ordered]@{ fecha = $d.fecha; pedidos = [int]$d.pedidos; unidades = [int]$d.unidades; ventas = [Math]::Round([double]$d.ventas, 2) }
  }

  $ticket = 0.0
  if ($pedidosTotal -gt 0) { $ticket = [Math]::Round($ventasTotal / $pedidosTotal, 2) }

  return [ordered]@{
    ok          = $true
    desde       = $desdeTxt
    hasta       = $hastaTxt
    local       = $filtroLocal
    resumen     = [ordered]@{
      pedidos          = $pedidosTotal
      unidades         = $unidadesTotal
      ventas           = [Math]::Round($ventasTotal, 2)
      ticketPromedio   = $ticket
      productosVendidos = @($productosSalida).Count
    }
    porDia      = @($diasSalida)
    productos   = @($productosSalida)
    topUnidades = @($productosSalida | Select-Object -First 10)
    topVentas   = @($porVentas | Select-Object -First 10)
    locales     = @($localesSalida)
  }
}


function Ruta-Importacion {
  param([string]$Id)
  if ($Id -notmatch '^imp-[a-z0-9-]{4,40}$') { return $null }
  return (Join-Path $script:CarpetaImportaciones ($Id + '.json'))
}

function Guardar-Importacion {
  param($Importacion)
  Inicializar-Datos
  $ruta = Ruta-Importacion ([string]$Importacion.id)
  if ($null -eq $ruta) { Lanzar-ErrorHttp 400 'Identificador de importacion invalido.' }
  [void](Guardar-JsonAtomico $ruta $Importacion)
}

function Listar-Importaciones {
  param($Sesion, [int]$Limite = 50)
  Inicializar-Datos
  $salida = @()
  if (-not (Test-Path -LiteralPath $script:CarpetaImportaciones)) { return @() }
  $archivos = Get-ChildItem -LiteralPath $script:CarpetaImportaciones -Filter 'imp-*.json' -File | Sort-Object LastWriteTime -Descending
  foreach ($f in $archivos) {
    if ($salida.Count -ge $Limite) { break }
    $imp = Leer-JsonRuta $f.FullName $null
    if ($null -eq $imp) { continue }
    if ($Sesion.rol -eq 'local' -and [string]$imp.localCarpeta -ne [string]$Sesion.localCarpeta) { continue }
    $salida += [ordered]@{
      id             = $imp.id
      localCarpeta   = $imp.localCarpeta
      localNombre    = $imp.localNombre
      creadoEn       = $imp.creadoEn
      creadoPor      = $imp.creadoPor
      estado         = $imp.estado
      archivos       = @($imp.archivos | ForEach-Object { $_.nombre })
      totalProductos = @($imp.productos).Count
      publicados     = $imp.publicados
    }
  }
  return $salida
}

function Obtener-Importacion {
  param([string]$Id, $Sesion)
  $ruta = Ruta-Importacion $Id
  if ($null -eq $ruta -or -not (Test-Path -LiteralPath $ruta)) { Lanzar-ErrorHttp 404 'Importacion no encontrada.' }
  $imp = Leer-JsonRuta $ruta $null
  if ($null -eq $imp) { Lanzar-ErrorHttp 404 'Importacion no encontrada.' }
  if ($Sesion.rol -eq 'local' -and [string]$imp.localCarpeta -ne [string]$Sesion.localCarpeta) {
    Lanzar-ErrorHttp 403 'Esa importacion no pertenece a tu local.'
  }
  return $imp
}
