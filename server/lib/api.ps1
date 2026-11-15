# ============================================================
#  EnRuta Delivery - Router de la API
# ============================================================

function Test-AccesoLocal {
  param($Sesion, [string]$Carpeta)
  if ($Sesion.rol -eq 'admin') { return $true }
  return ([string]$Sesion.localCarpeta -eq [string]$Carpeta)
}

function Exigir-Admin {
  param($Sesion)
  if ($Sesion.rol -ne 'admin') { Lanzar-ErrorHttp 403 'Solo un administrador puede realizar esta operacion.' }
}

function Exigir-LocalAsignado {
  param($Sesion, [string]$Carpeta)
  if (-not (Test-AccesoLocal $Sesion $Carpeta)) {
    Lanzar-ErrorHttp 403 'No tienes acceso a ese local.'
  }
}

function Establecer-Campo {
  param($Objeto, [string]$Nombre, $Valor)
  if ($null -eq $Objeto) { return }
  if ($Objeto -is [System.Collections.IDictionary]) {
    $Objeto[$Nombre] = $Valor
    return
  }
  if ($null -ne $Objeto.PSObject.Properties[$Nombre]) {
    $Objeto.$Nombre = $Valor
  } else {
    $Objeto | Add-Member -NotePropertyName $Nombre -NotePropertyValue $Valor -Force
  }
}

function Obtener-ProductosDelCuerpo {
  param($Cuerpo)
  if ($null -eq $Cuerpo -or $null -eq $Cuerpo.productos) { return @() }
  return @($Cuerpo.productos)
}

function Normalizar-ProductoLocal {
  param($P, [string]$LocalId, [hashtable]$Ids)
  $nombre = ([string]$P.nombre).Trim()
  $id = [string]$P.id
  if ([string]::IsNullOrWhiteSpace($id)) {
    $base = Convertir-AId $nombre 'prod'
    $id = $LocalId + '-' + $base
  }
  $sufijo = 2
  $idBase = $id
  while ($Ids.ContainsKey($id)) {
    $id = $idBase + '-' + $sufijo
    $sufijo++
  }
  $Ids[$id] = $true
  $precio = $null
  $n = Convertir-Numero $P.precio
  if ($null -ne $n -and $n -gt 0) { $precio = [Math]::Round($n, 2) }
  $variantes = @()
  $i = 0
  foreach ($v in @($P.variantes)) {
    if ($null -eq $v) { continue }
    $i++
    $pv = Convertir-Numero $v.precio
    if ($null -eq $pv -or $pv -le 0) { continue }
    $variantes += [ordered]@{
      id     = if ($v.id) { [string]$v.id } else { 'v' + $i }
      nombre = ([string]$v.nombre).Trim()
      precio = [Math]::Round($pv, 2)
    }
  }
  $extras = @()
  foreach ($e in @($P.extras)) {
    if ($null -eq $e -or [string]::IsNullOrWhiteSpace([string]$e.nombre)) { continue }
    $pe = Convertir-Numero $e.precio
    if ($null -eq $pe) { $pe = 0 }
    $extras += [ordered]@{ nombre = ([string]$e.nombre).Trim(); precio = [Math]::Round($pe, 2) }
  }
  return [ordered]@{
    id             = $id
    nombre         = $nombre
    descripcion    = ([string]$P.descripcion).Trim()
    precio         = $precio
    grupo          = if ($P.grupo) { ([string]$P.grupo).Trim() } else { 'Carta' }
    subcategoria   = ([string]$P.subcategoria).Trim()
    emoji          = ([string]$P.emoji).Trim()
    etiqueta       = ([string]$P.etiqueta).Trim()
    imagen         = if ($P.imagen) { [string]$P.imagen } else { $null }
    publicado      = ($P.publicado -eq $true)
    disponible     = ($P.disponible -ne $false)
    revisar        = ($P.revisar -eq $true)
    variantes      = @($variantes)
    extras         = @($extras)
    origen         = if ($P.origen) { [string]$P.origen } else { 'manual' }
    camposDudosos  = @($P.camposDudosos)
  }
}

function Procesar-ImportacionProductos {
  param(
    [string]$Carpeta,
    $Importacion,
    [object[]]$Entrantes,
    [string]$Modo,
    $Sesion,
    [string]$Ip
  )
  $item = Obtener-LocalPorCarpeta $Carpeta
  if ($null -eq $item) { Lanzar-ErrorHttp 404 'El local no existe.' }
  Exigir-LocalAsignado $Sesion $Carpeta
  $local = $item.local
  $existentes = @($item.productos)
  $porId = @{}
  foreach ($e in $existentes) { $porId[[string]$e.id] = $e }

  $ids = @{}
  foreach ($e in $existentes) { $ids[[string]$e.id] = $true }

  $finales = @{}
  foreach ($e in $existentes) { $finales[[string]$e.id] = $e }

  $errores = @()
  $publicados = 0
  $borradores = 0
  $omitidos = 0
  $actualizados = 0
  $nuevos = 0

  foreach ($p in @($Entrantes)) {
    if ($null -eq $p) { continue }
    $accion = [string]$p.accion
    if ([string]::IsNullOrWhiteSpace($accion)) { $accion = 'revisar' }
    if ($accion -eq 'omitir' -or $accion -eq 'mantener') { $omitidos++; continue }

    $nombre = ([string]$p.nombre).Trim()
    $precio = Convertir-Numero $p.precio
    $tienePrecio = ($null -ne $precio -and $precio -gt 0)
    if (-not $tienePrecio) {
      foreach ($v in @($p.variantes)) {
        if ($null -eq $v) { continue }
        $pv = Convertir-Numero $v.precio
        if ($null -ne $pv -and $pv -gt 0) {
          $tienePrecio = $true
          break
        }
      }
    }

    if ($Modo -eq 'publicar') {
      if ([string]::IsNullOrWhiteSpace($nombre)) { $errores += 'Hay un producto sin nombre.'; continue }
      if (-not $tienePrecio) { $errores += "El producto '$nombre' no tiene precio valido."; continue }
      if (($p.revisar -eq $true -or $accion -eq 'revisar') -and $accion -ne 'forzar') {
        $errores += "El producto '$nombre' esta marcado para revision. Corrigelo o usa 'Publicar de todos modos'."
        continue
      }
    }

    $idDestino = $null
    if (($accion -eq 'actualizar' -or $accion -eq 'forzar') -and $p.coincidencia -and $p.coincidencia.productoId) {
      $idDestino = [string]$p.coincidencia.productoId
    } elseif (-not [string]::IsNullOrWhiteSpace([string]$p.id) -and $porId.ContainsKey([string]$p.id)) {
      $idDestino = [string]$p.id
    }

    $registro = Normalizar-ProductoLocal $p ([string]$local.id) $ids
    if ($Modo -eq 'publicar') {
      $registro.publicado = $true
      if ($accion -ne 'revisar') { $registro.revisar = $false }
      $publicados++
    } else {
      $registro.publicado = $false
      $registro.revisar = $true
      $borradores++
    }
    $registro.origen = 'ocr'

    if ($idDestino -and $porId.ContainsKey($idDestino)) {
      $anterior = $porId[$idDestino]
      $registro.id = $idDestino
      if ($Modo -eq 'borrador' -and $anterior.publicado -ne $false) {
        # Un borrador no debe despublicar un producto que ya estaba visible.
        $registro.publicado = $anterior.publicado
      }
      if ($Modo -eq 'publicar' -and $anterior.publicado -ne $false) {
        $registro.publicado = $true
      }
      $finales[$idDestino] = $registro
      $actualizados++
    } else {
      $finales[$registro.id] = $registro
      $nuevos++
    }
  }

  if ($errores.Count -gt 0) {
    return [ordered]@{ ok = $false; errores = @($errores); publicados = 0; borradores = 0 }
  }

  $lista = @($finales.Values)
  $resultado = Guardar-LocalCompleto $Carpeta $local $lista $Sesion.usuario $Sesion.rol $Ip

  if ($null -ne $Importacion) {
    $Importacion.estado = if ($Modo -eq 'publicar') { 'publicado' } else { 'borrador' }
    $Importacion.publicados = $publicados
    $Importacion.borradores = $borradores
    $Importacion.productos = @($Entrantes)
    $Importacion.guardadoEn = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    Guardar-Importacion $Importacion
  }

  Registrar-Auditoria $Sesion.usuario $Sesion.rol "ocr.$Modo" "Local ${Carpeta}: $publicados publicados, $borradores borradores, $omitidos omitidos" $Ip
  return [ordered]@{
    ok           = $true
    modo         = $Modo
    importacionId = if ($Importacion) { [string]$Importacion.id } else { $null }
    publicados   = $publicados
    borradores   = $borradores
    omitidos     = $omitidos
    actualizados = $actualizados
    nuevos       = $nuevos
    total        = @($lista).Count
  }
}

function Manejar-Api {
  param([System.Net.HttpListenerContext]$Contexto)
  $req = $Contexto.Request
  $metodo = $req.HttpMethod
  $ruta = [uri]::UnescapeDataString($req.Url.AbsolutePath)
  if ($ruta.Length -gt 1) { $ruta = $ruta.TrimEnd('/') }

  # ---------------- Publico ----------------
  if ($ruta -eq '/api/estado' -and $metodo -eq 'GET') {
    Responder-Json $Contexto 200 ([ordered]@{
        ok      = $true
        servicio = 'EnRuta Delivery'
        version = '2.0'
        hora    = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        ocr     = 'Windows.Media.Ocr'
      })
    return
  }

  if ($ruta -eq '/api/pedidos' -and $metodo -eq 'POST') {
    $cuerpo = Leer-CuerpoJson $Contexto 1048576
    if ($null -eq $cuerpo) { Lanzar-ErrorHttp 400 'Pedido vacio.' }
    $res = Guardar-PedidoPublico $cuerpo $Contexto
    Responder-Json $Contexto 201 $res
    return
  }

  # ---------------- Autenticacion ----------------
  if ($ruta -eq '/api/auth/login' -and $metodo -eq 'POST') {
    $cuerpo = Leer-CuerpoJson $Contexto 65536
    if ($null -eq $cuerpo) { Lanzar-ErrorHttp 400 'Faltan credenciales.' }
    $ip = Obtener-IpCliente $Contexto
    $usuario = Verificar-Credenciales ([string]$cuerpo.usuario) ([string]$cuerpo.password) $ip
    if ($null -eq $usuario) { Lanzar-ErrorHttp 401 'Usuario o contrasena incorrectos.' }
    $sesion = Crear-Sesion $usuario $Contexto
    Registrar-Auditoria $sesion.usuario $sesion.rol 'auth.login' 'Inicio de sesion correcto' $ip
    Responder-Json $Contexto 200 ([ordered]@{ ok = $true; sesion = $sesion })
    return
  }

  if ($ruta -eq '/api/auth/logout' -and $metodo -eq 'POST') {
    $sesion = Obtener-Sesion $Contexto
    if ($null -ne $sesion) {
      Validar-Csrf $Contexto $sesion
      Registrar-Auditoria $sesion.usuario $sesion.rol 'auth.logout' 'Cierre de sesion' (Obtener-IpCliente $Contexto)
    }
    Cerrar-Sesion $Contexto
    Responder-Json $Contexto 200 ([ordered]@{ ok = $true })
    return
  }

  if ($ruta -eq '/api/auth/sesion' -and $metodo -eq 'GET') {
    $sesion = Obtener-Sesion $Contexto
    if ($null -eq $sesion) {
      Responder-Json $Contexto 200 ([ordered]@{ autenticado = $false })
    } else {
      Responder-Json $Contexto 200 ([ordered]@{
          autenticado  = $true
          usuario      = $sesion.usuario
          nombre       = $sesion.nombre
          rol          = $sesion.rol
          localCarpeta = $sesion.localCarpeta
          csrf         = $sesion.csrf
          expiraEn     = $sesion.expiraEn
        })
    }
    return
  }

  if ($ruta -eq '/api/auth/password' -and $metodo -eq 'POST') {
    $sesion = Requerir-Sesion $Contexto
    Validar-Csrf $Contexto $sesion
    $cuerpo = Leer-CuerpoJson $Contexto 65536
    $verificado = Verificar-Credenciales $sesion.usuario ([string]$cuerpo.actual) (Obtener-IpCliente $Contexto)
    if ($null -eq $verificado) { Lanzar-ErrorHttp 401 'La contrasena actual no es correcta.' }
    Actualizar-PasswordUsuario $sesion.usuario ([string]$cuerpo.nueva)
    Registrar-Auditoria $sesion.usuario $sesion.rol 'auth.password' 'Contrasena actualizada' (Obtener-IpCliente $Contexto)
    Responder-Json $Contexto 200 ([ordered]@{ ok = $true })
    return
  }

  # ---------------- A partir de aqui todo requiere sesion ----------------
  if ($ruta.StartsWith('/api/admin/')) {
    $sesion = Requerir-Sesion $Contexto
    Validar-Csrf $Contexto $sesion
    $ip = Obtener-IpCliente $Contexto

    if ($ruta -eq '/api/admin/estado-sistema' -and $metodo -eq 'GET') {
      $ocrOk = $true; $ocrMensaje = 'OCR nativo de Windows disponible (es-ES).'
      try { Inicializar-Ocr } catch { $ocrOk = $false; $ocrMensaje = $_.Exception.Message }
      Responder-Json $Contexto 200 ([ordered]@{
          ocr           = $ocrOk
          ocrMensaje    = $ocrMensaje
          iaConfigurada = $false
          iaMensaje     = 'No hay proveedor ni credenciales configuradas.'
          version       = '2.0'
        })
      return
    }

    if ($ruta -eq '/api/admin/resumen' -and $metodo -eq 'GET') {
      Responder-Json $Contexto 200 (Obtener-ResumenAdmin $sesion)
      return
    }

    if ($ruta -eq '/api/admin/estadisticas' -and $metodo -eq 'GET') {
      $desde = ''; $hasta = ''; $local = ''
      if ($req.QueryString['desde']) { $desde = [string]$req.QueryString['desde'] }
      if ($req.QueryString['hasta']) { $hasta = [string]$req.QueryString['hasta'] }
      if ($req.QueryString['local']) { $local = [string]$req.QueryString['local'] }
      Responder-Json $Contexto 200 (Obtener-EstadisticasVentas $sesion $desde $hasta $local)
      return
    }

    if ($ruta -eq '/api/admin/config') {
      Exigir-Admin $sesion
      if ($metodo -eq 'GET') {
        Responder-Json $Contexto 200 ([ordered]@{ config = (Obtener-ConfigPublica) })
        return
      }
      if ($metodo -eq 'PUT') {
        $cuerpo = Leer-CuerpoJson $Contexto 262144
        $config = if ($null -ne $cuerpo.config) { $cuerpo.config } else { $cuerpo }
        $res = Guardar-ConfigPublica $config $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 200 $res
        return
      }
    }

    if ($ruta -eq '/api/admin/auditoria' -and $metodo -eq 'GET') {
      if ($sesion.rol -ne 'admin') { Lanzar-ErrorHttp 403 'Solo administradores.' }
      Responder-Json $Contexto 200 ([ordered]@{ registros = @(Leer-Auditoria 200) })
      return
    }

    # ----- Locales -----
    if ($ruta -eq '/api/admin/locales' -and $metodo -eq 'GET') {
      $q = ''
      if ($req.QueryString['q']) { $q = [string]$req.QueryString['q'] }
      $lista = @(Obtener-LocalesAdmin $q)
      if ($sesion.rol -eq 'local') {
        $lista = @($lista | Where-Object { $_.carpeta -eq [string]$sesion.localCarpeta })
      }
      Responder-Json $Contexto 200 ([ordered]@{ locales = @($lista) })
      return
    }

    if ($ruta -eq '/api/admin/locales' -and $metodo -eq 'POST') {
      Exigir-Admin $sesion
      $cuerpo = Leer-CuerpoJson $Contexto
      $res = Nuevo-Local $cuerpo $sesion.usuario $sesion.rol $ip
      Responder-Json $Contexto 201 $res
      return
    }

    if ($ruta -match '^/api/admin/locales/([^/]+)$') {
      $carpeta = $Matches[1]
      Exigir-LocalAsignado $sesion $carpeta
      if ($metodo -eq 'GET') {
        $item = Obtener-LocalPorCarpeta $carpeta
        if ($null -eq $item) { Lanzar-ErrorHttp 404 'Local no encontrado.' }
        Responder-Json $Contexto 200 ([ordered]@{
            carpeta   = $carpeta
            local     = $item.local
            productos = @($item.productos)
          })
        return
      }
      if ($metodo -eq 'PUT') {
        $cuerpo = Leer-CuerpoJson $Contexto
        $existente = Obtener-LocalPorCarpeta $carpeta
        if ($null -eq $existente) { Lanzar-ErrorHttp 404 'Local no encontrado.' }
        $local = $cuerpo.local
        if ($null -eq $local) { $local = $cuerpo }
        if ($sesion.rol -ne 'admin') {
          # Un usuario de local no puede cambiar la publicacion ni el identificador.
          Establecer-Campo $local 'publicado' $existente.local.publicado
          Establecer-Campo $local 'id' $existente.local.id
          Establecer-Campo $local 'esEjemplo' $existente.local.esEjemplo
        }
        $productos = if ($null -ne $cuerpo.productos) { @($cuerpo.productos) } else { @($existente.productos) }
        $res = Guardar-LocalCompleto $carpeta $local $productos $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 200 $res
        return
      }
      if ($metodo -eq 'DELETE') {
        Exigir-Admin $sesion
        $res = Eliminar-Local $carpeta $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 200 $res
        return
      }
    }

    if ($ruta -match '^/api/admin/locales/([^/]+)/duplicar$' -and $metodo -eq 'POST') {
      Exigir-Admin $sesion
      $res = Duplicar-Local $Matches[1] $sesion.usuario $sesion.rol $ip
      Responder-Json $Contexto 200 $res
      return
    }

    # ----- Productos de un local -----
    if ($ruta -match '^/api/admin/locales/([^/]+)/productos$') {
      $carpeta = $Matches[1]
      Exigir-LocalAsignado $sesion $carpeta
      $item = Obtener-LocalPorCarpeta $carpeta
      if ($null -eq $item) { Lanzar-ErrorHttp 404 'Local no encontrado.' }
      if ($metodo -eq 'PUT') {
        $cuerpo = Leer-CuerpoJson $Contexto
        $lista = @(Obtener-ProductosDelCuerpo $cuerpo)
        $normalizados = @()
        $ids = @{}
        foreach ($p in $lista) { $normalizados += (Normalizar-ProductoLocal $p ([string]$item.local.id) $ids) }
        $res = Guardar-LocalCompleto $carpeta $item.local $normalizados $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 200 $res
        return
      }
      if ($metodo -eq 'POST') {
        $cuerpo = Leer-CuerpoJson $Contexto
        $p = $cuerpo.producto
        if ($null -eq $p) { $p = $cuerpo }
        $ids = @{}
        foreach ($x in @($item.productos)) { $ids[[string]$x.id] = $true }
        $nuevo = Normalizar-ProductoLocal $p ([string]$item.local.id) $ids
        $lista = @($item.productos) + @($nuevo)
        $res = Guardar-LocalCompleto $carpeta $item.local $lista $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 201 $res
        return
      }
    }

    if ($ruta -match '^/api/admin/locales/([^/]+)/productos/eliminar$' -and $metodo -eq 'POST') {
      $carpeta = $Matches[1]
      Exigir-LocalAsignado $sesion $carpeta
      $cuerpo = Leer-CuerpoJson $Contexto
      $ids = @($cuerpo.ids)
      $res = Eliminar-ProductosLocal $carpeta $ids $sesion.usuario $sesion.rol $ip
      Responder-Json $Contexto 200 $res
      return
    }

    if ($ruta -match '^/api/admin/locales/([^/]+)/productos/([^/]+)$') {
      $carpeta = $Matches[1]
      $productoId = $Matches[2]
      Exigir-LocalAsignado $sesion $carpeta
      $item = Obtener-LocalPorCarpeta $carpeta
      if ($null -eq $item) { Lanzar-ErrorHttp 404 'Local no encontrado.' }
      $lista = @($item.productos)
      $indice = -1
      for ($i = 0; $i -lt $lista.Count; $i++) { if ([string]$lista[$i].id -eq $productoId) { $indice = $i; break } }
      if ($indice -lt 0) { Lanzar-ErrorHttp 404 'Producto no encontrado.' }
      if ($metodo -eq 'PUT') {
        $cuerpo = Leer-CuerpoJson $Contexto
        $p = $cuerpo.producto
        if ($null -eq $p) { $p = $cuerpo }
        $ids = @{}
        foreach ($x in $lista) { if ([string]$x.id -ne $productoId) { $ids[[string]$x.id] = $true } }
        $actualizado = Normalizar-ProductoLocal $p ([string]$item.local.id) $ids
        $actualizado.id = $productoId
        $lista[$indice] = $actualizado
        $res = Guardar-LocalCompleto $carpeta $item.local $lista $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 200 $res
        return
      }
      if ($metodo -eq 'DELETE') {
        $nuevaLista = @($lista | Where-Object { [string]$_.id -ne $productoId })
        $res = Guardar-LocalCompleto $carpeta $item.local $nuevaLista $sesion.usuario $sesion.rol $ip
        Registrar-Auditoria $sesion.usuario $sesion.rol 'producto.eliminar' "Local $carpeta producto $productoId" $ip
        Responder-Json $Contexto 200 $res
        return
      }
    }

    # ----- Categorias de locales -----
    if ($ruta -eq '/api/admin/categorias-locales') {
      if ($metodo -eq 'GET') {
        Responder-Json $Contexto 200 (Obtener-CategoriasLocales)
        return
      }
      if ($metodo -eq 'PUT') {
        Exigir-Admin $sesion
        $cuerpo = Leer-CuerpoJson $Contexto
        $res = Guardar-CategoriasLocales @($cuerpo.categorias) $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 200 $res
        return
      }
    }

    # ----- Catalogos globales -----
    if ($ruta -match '^/api/admin/catalogos/([^/]+)$') {
      Exigir-Admin $sesion
      $catId = $Matches[1]
      if ($metodo -eq 'GET') {
        Responder-Json $Contexto 200 (Obtener-Catalogo $catId)
        return
      }
      if ($metodo -eq 'PUT') {
        $cuerpo = Leer-CuerpoJson $Contexto
        $res = Guardar-Catalogo $catId @($cuerpo.categorias) @($cuerpo.productos) $sesion.usuario $sesion.rol $ip
        Responder-Json $Contexto 200 $res
        return
      }
    }

    # ----- Imagenes -----
    if ($ruta -eq '/api/admin/imagenes' -and $metodo -eq 'POST') {
      $cuerpo = Leer-CuerpoJson $Contexto 14000000
      $tipo = [string]$cuerpo.tipoDestino
      $carpeta = [string]$cuerpo.carpeta
      if ($tipo -eq 'local') {
        Exigir-LocalAsignado $sesion $carpeta
        $dir = Join-Path (Join-Path $script:RutaLocales $carpeta) 'img'
      } elseif ($tipo -eq 'catalogo') {
        Exigir-Admin $sesion
        if ($carpeta -notin @('licores', 'primera-necesidad')) { Lanzar-ErrorHttp 400 'Catalogo invalido.' }
        $dir = Join-Path (Join-Path $script:CarpetaDatosPublicos $carpeta) 'img'
      } else {
        Lanzar-ErrorHttp 400 'Destino de imagen invalido.'
      }
      $res = Guardar-ImagenBase64 $dir ([string]$cuerpo.nombre) ([string]$cuerpo.tipoMime) ([string]$cuerpo.datosBase64) ([string]$cuerpo.prefijo)
      Registrar-Auditoria $sesion.usuario $sesion.rol 'imagen.subir' "$tipo/$carpeta -> $($res.ruta)" $ip
      Responder-Json $Contexto 201 $res
      return
    }

    # ----- OCR -----
    if ($ruta -eq '/api/admin/ocr/procesar' -and $metodo -eq 'POST') {
      $cuerpo = Leer-CuerpoJson $Contexto 26214400
      $carpeta = [string]$cuerpo.localCarpeta
      Exigir-LocalAsignado $sesion $carpeta
      $item = Obtener-LocalPorCarpeta $carpeta
      if ($null -eq $item) { Lanzar-ErrorHttp 404 'Local no encontrado.' }
      $nombre = [string]$cuerpo.nombre
      $ext = ([IO.Path]::GetExtension($nombre)).ToLowerInvariant()
      if ($ext -notin @('.jpg', '.jpeg', '.png', '.pdf')) {
        Lanzar-ErrorHttp 415 'Formato no permitido. Sube JPG, PNG o PDF (WEBP se convierte en el navegador).'
      }
      $base64 = [string]$cuerpo.datosBase64
      if ($base64 -match '^data:[^;]+;base64,') { $base64 = $base64.Substring($base64.IndexOf(',') + 1) }
      try { $bytes = [Convert]::FromBase64String($base64) } catch { Lanzar-ErrorHttp 400 'El archivo no es base64 valido.' }
      if ($bytes.Length -gt 22000000) { Lanzar-ErrorHttp 413 'El archivo supera el limite de 20 MB.' }
      $dirTemp = Join-Path $script:CarpetaImportaciones ('tmp-' + [Guid]::NewGuid().ToString('N'))
      Asegurar-Carpeta $dirTemp | Out-Null
      $rutaTemp = Join-Path $dirTemp ('archivo' + $ext)
      [IO.File]::WriteAllBytes($rutaTemp, $bytes)
      try {
        if ($ext -eq '.pdf') {
          if ($bytes.Length -lt 5 -or $bytes[0] -ne 0x25 -or $bytes[1] -ne 0x50 -or $bytes[2] -ne 0x44 -or $bytes[3] -ne 0x46) {
            Lanzar-ErrorHttp 400 'El archivo no es un PDF valido.'
          }
        } else {
          $esPng = ($bytes.Length -gt 8 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50)
          $esJpg = ($bytes.Length -gt 3 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8)
          if (-not ($esPng -or $esJpg)) { Lanzar-ErrorHttp 400 'La imagen no es JPG o PNG valida.' }
        }
        $doc = Ocr-ProcesarDocumento $rutaTemp $nombre
        $productos = @(Analizar-Carta $doc.paginas ([string]$item.local.id))
        $productos = @(Marcar-Duplicados $productos @($item.productos))
        $texto = @()
        foreach ($pg in @($doc.paginas)) {
          $texto += "--- Pagina $($pg.numero) ---"
          foreach ($f in @(Unir-FilasPagina $pg)) { $texto += [string]$f.texto }
        }
        Responder-Json $Contexto 200 ([ordered]@{
            ok           = $true
            archivo      = $nombre
            tipo         = $doc.tipo
            totalPaginas = $doc.totalPaginas
            productos    = @($productos)
            texto        = (@($texto) -join "`n")
          })
      } finally {
        try { Remove-Item -LiteralPath $dirTemp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
      }
      return
    }

    if ($ruta -eq '/api/admin/ocr/guardar' -and $metodo -eq 'POST') {
      $cuerpo = Leer-CuerpoJson $Contexto 26214400
      $carpeta = [string]$cuerpo.localCarpeta
      Exigir-LocalAsignado $sesion $carpeta
      $item = Obtener-LocalPorCarpeta $carpeta
      if ($null -eq $item) { Lanzar-ErrorHttp 404 'Local no encontrado.' }
      $modo = if ([string]$cuerpo.modo -eq 'publicar') { 'publicar' } else { 'borrador' }
      $id = [string]$cuerpo.importacionId
      $importacion = $null
      if ($id -and (Ruta-Importacion $id)) {
        $rutaImp = Ruta-Importacion $id
        if (Test-Path -LiteralPath $rutaImp) { $importacion = Leer-JsonRuta $rutaImp $null }
      }
      if ($null -eq $importacion) {
        $id = 'imp-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + (Convertir-Base64Url (Generar-BytesAleatorios 3))
        $importacion = [ordered]@{
          id           = $id
          localCarpeta = $carpeta
          localId      = [string]$item.local.id
          localNombre  = [string]$item.local.nombre
          creadoEn     = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
          creadoPor    = $sesion.usuario
          estado       = 'borrador'
          archivos     = @()
          texto        = ''
          productos    = @()
        }
      }
      if ($cuerpo.archivos) {
        $importacion.archivos = @($cuerpo.archivos | ForEach-Object { [ordered]@{ nombre = [string]$_.nombre; paginas = [int]$_.paginas } })
      }
      if ($cuerpo.texto) { $importacion.texto = [string]$cuerpo.texto }
      $productos = @($cuerpo.productos)
      $res = Procesar-ImportacionProductos $carpeta $importacion $productos $modo $sesion $ip
      Responder-Json $Contexto 200 $res
      return
    }

    if ($ruta -eq '/api/admin/importaciones' -and $metodo -eq 'GET') {
      Responder-Json $Contexto 200 ([ordered]@{ importaciones = @(Listar-Importaciones $sesion 60) })
      return
    }

    if ($ruta -match '^/api/admin/importaciones/([^/]+)/publicar$' -and $metodo -eq 'POST') {
      $impId = $Matches[1]
      $imp = Obtener-Importacion $impId $sesion
      $cuerpo = Leer-CuerpoJson $Contexto 26214400
      $productos = if ($cuerpo -and $null -ne $cuerpo.productos) { @($cuerpo.productos) } else { @($imp.productos) }
      $modo = if ([string]$cuerpo.modo -eq 'borrador') { 'borrador' } else { 'publicar' }
      $res = Procesar-ImportacionProductos ([string]$imp.localCarpeta) $imp $productos $modo $sesion $ip
      Responder-Json $Contexto 200 $res
      return
    }

    if ($ruta -match '^/api/admin/importaciones/([^/]+)$' -and $metodo -eq 'GET') {
      $imp = Obtener-Importacion $Matches[1] $sesion
      Responder-Json $Contexto 200 $imp
      return
    }

    # ----- Pedidos -----
    if ($ruta -eq '/api/admin/pedidos' -and $metodo -eq 'GET') {
      $estado = ''
      if ($req.QueryString['estado']) { $estado = [string]$req.QueryString['estado'] }
      Responder-Json $Contexto 200 ([ordered]@{ pedidos = @(Obtener-PedidosAdmin $sesion $estado 200) })
      return
    }

    if ($ruta -match '^/api/admin/pedidos/([^/]+)$' -and $metodo -eq 'PUT') {
      $cuerpo = Leer-CuerpoJson $Contexto 65536
      $res = Cambiar-EstadoPedido $Matches[1] ([string]$cuerpo.estado) $sesion $ip
      Responder-Json $Contexto 200 $res
      return
    }

    # ----- Usuarios -----
    if ($ruta -eq '/api/admin/usuarios' -and $metodo -eq 'GET') {
      Exigir-Admin $sesion
      Responder-Json $Contexto 200 ([ordered]@{ usuarios = @(Listar-UsuariosSeguro) })
      return
    }

    if ($ruta -eq '/api/admin/usuarios' -and $metodo -eq 'POST') {
      Exigir-Admin $sesion
      $cuerpo = Leer-CuerpoJson $Contexto 65536
      if ([string]$cuerpo.rol -eq 'local') {
        $item = Obtener-LocalPorCarpeta ([string]$cuerpo.localCarpeta)
        if ($null -eq $item) { Lanzar-ErrorHttp 400 'El local asignado no existe.' }
      }
      $u = Nuevo-RegistroUsuario ([string]$cuerpo.usuario) ([string]$cuerpo.nombre) ([string]$cuerpo.password) ([string]$cuerpo.rol) ([string]$cuerpo.localCarpeta)
      Registrar-Auditoria $sesion.usuario $sesion.rol 'usuario.crear' "Usuario $($u.usuario) rol $($u.rol)" $ip
      Responder-Json $Contexto 201 ([ordered]@{ ok = $true; usuario = $u.usuario })
      return
    }

    if ($ruta -match '^/api/admin/usuarios/([^/]+)$') {
      Exigir-Admin $sesion
      $objetivo = $Matches[1]
      $doc = Leer-Usuarios
      $encontrado = $null
      foreach ($u in @($doc.usuarios)) { if ([string]$u.usuario -eq $objetivo) { $encontrado = $u } }
      if ($null -eq $encontrado) { Lanzar-ErrorHttp 404 'Usuario no encontrado.' }
      if ($metodo -eq 'PUT') {
        $cuerpo = Leer-CuerpoJson $Contexto 65536
        if ($null -ne $cuerpo.nombre) { $encontrado.nombre = ([string]$cuerpo.nombre).Trim() }
        if ($null -ne $cuerpo.activo) {
          if ($objetivo -eq $sesion.usuario -and $cuerpo.activo -eq $false) { Lanzar-ErrorHttp 400 'No puedes desactivar tu propia cuenta.' }
          $encontrado.activo = ($cuerpo.activo -eq $true)
        }
        if ($null -ne $cuerpo.rol -and [string]$cuerpo.rol -in @('admin', 'local')) {
          if ($objetivo -eq $sesion.usuario -and [string]$cuerpo.rol -ne 'admin') { Lanzar-ErrorHttp 400 'No puedes quitarte el rol de administrador.' }
          $encontrado.rol = [string]$cuerpo.rol
        }
        if ($null -ne $cuerpo.localCarpeta) {
          if ([string]$encontrado.rol -eq 'local') {
            $item = Obtener-LocalPorCarpeta ([string]$cuerpo.localCarpeta)
            if ($null -eq $item) { Lanzar-ErrorHttp 400 'El local asignado no existe.' }
            $encontrado.localCarpeta = [string]$cuerpo.localCarpeta
          }
        }
        if ($cuerpo.password) {
          Test-PoliticaPassword ([string]$cuerpo.password)
          $salNueva = Generar-BytesAleatorios 16
          $encontrado.passwordSalt = [Convert]::ToBase64String($salNueva)
          $encontrado.passwordHash = Calcular-HashPassword ([string]$cuerpo.password) $salNueva
          $encontrado.iteraciones = $script:IteracionesPbkdf2
          $encontrado.intentos = 0
          $encontrado.bloqueadoHasta = $null
        }
        Guardar-Usuarios $doc
        Registrar-Auditoria $sesion.usuario $sesion.rol 'usuario.editar' "Usuario $objetivo" $ip
        Responder-Json $Contexto 200 ([ordered]@{ ok = $true })
        return
      }
      if ($metodo -eq 'DELETE') {
        if ($objetivo -eq $sesion.usuario) { Lanzar-ErrorHttp 400 'No puedes eliminar tu propia cuenta.' }
        $doc.usuarios = @(@($doc.usuarios) | Where-Object { [string]$_.usuario -ne $objetivo })
        Guardar-Usuarios $doc
        Registrar-Auditoria $sesion.usuario $sesion.rol 'usuario.eliminar' "Usuario $objetivo" $ip
        Responder-Json $Contexto 200 ([ordered]@{ ok = $true })
        return
      }
    }

    Lanzar-ErrorHttp 404 'Ruta de administracion no encontrada.'
  }

  Lanzar-ErrorHttp 404 'Ruta no encontrada.'
}
