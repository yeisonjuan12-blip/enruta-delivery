# ============================================================
#  EnRuta Delivery - Autenticacion, sesiones y permisos
#  PBKDF2-SHA256, cookies HttpOnly SameSite=Strict, CSRF.
# ============================================================

$script:RutaUsuarios = Join-Path $script:CarpetaDatos 'usuarios.json'
$script:RutaSesiones = Join-Path $script:CarpetaDatos 'sesiones.json'
$script:NombreCookie = 'enruta_sesion'
$script:IteracionesPbkdf2 = 120000
$script:SesionMinutosDefecto = 480

function Inicializar-Auth {
  Asegurar-Carpeta $script:CarpetaDatos | Out-Null
  if (-not (Test-Path -LiteralPath $script:RutaUsuarios)) {
    Guardar-JsonAtomico $script:RutaUsuarios ([ordered]@{
        version        = 1
        sesionMinutos  = $script:SesionMinutosDefecto
        usuarios       = @()
      }) -SinRespaldo
  }
  if (-not (Test-Path -LiteralPath $script:RutaSesiones)) {
    Guardar-JsonAtomico $script:RutaSesiones ([ordered]@{ version = 1; sesiones = @() }) -SinRespaldo
  }
}

function Leer-Usuarios {
  Inicializar-Auth
  $doc = Leer-JsonRuta $script:RutaUsuarios
  if ($null -eq $doc -or $null -eq $doc.usuarios) {
    return [ordered]@{ version = 1; sesionMinutos = $script:SesionMinutosDefecto; usuarios = @() }
  }
  return $doc
}

function Guardar-Usuarios {
  param($Doc)
  Guardar-JsonAtomico $script:RutaUsuarios $Doc
}

function Convertir-AHex {
  param([byte[]]$Bytes)
  return (($Bytes | ForEach-Object { $_.ToString('x2') }) -join '')
}

function Convertir-Base64Url {
  param([byte[]]$Bytes)
  return [Convert]::ToBase64String($Bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Generar-BytesAleatorios {
  param([int]$Cantidad = 32)
  $b = New-Object byte[] $Cantidad
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($b) } finally { $rng.Dispose() }
  return $b
}

function Calcular-HashPassword {
  param([string]$Password, [byte[]]$Sal, [int]$Iteraciones = $script:IteracionesPbkdf2)
  $kdf = New-Object Security.Cryptography.Rfc2898DeriveBytes($Password, $Sal, $Iteraciones, [Security.Cryptography.HashAlgorithmName]::SHA256)
  try { return [Convert]::ToBase64String($kdf.GetBytes(32)) } finally { $kdf.Dispose() }
}

function Comparar-TiempoConstante {
  param([string]$A, [string]$B)
  if ($null -eq $A -or $null -eq $B) { return $false }
  $ba = $script:Utf8SinBom.GetBytes($A)
  $bb = $script:Utf8SinBom.GetBytes($B)
  if ($ba.Length -ne $bb.Length) { return $false }
  $dif = 0
  for ($i = 0; $i -lt $ba.Length; $i++) { $dif = $dif -bor ($ba[$i] -bxor $bb[$i]) }
  return ($dif -eq 0)
}

function Normalizar-Usuario {
  param([string]$Usuario)
  return ([string]$Usuario).Trim().ToLowerInvariant()
}

# Convierte una fecha guardada en ISO-8601 a UTC. Comparar un DateTime
# local contra uno UTC (o viceversa) hace que las sesiones parezcan
# expiradas al instante, por eso se normaliza siempre antes de comparar.
function Convertir-FechaUtc {
  param([string]$Texto)
  if ([string]::IsNullOrWhiteSpace($Texto)) { return [DateTime]::MinValue }
  try {
    return [DateTime]::Parse($Texto, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime()
  } catch {
    return [DateTime]::MinValue
  }
}

function Buscar-Usuario {
  param([string]$Nombre)
  $doc = Leer-Usuarios
  $u = Normalizar-Usuario $Nombre
  foreach ($item in @($doc.usuarios)) {
    if ((Normalizar-Usuario $item.usuario) -eq $u) { return $item }
  }
  return $null
}

function Test-PoliticaPassword {
  param([string]$Password)
  if ($null -eq $Password -or $Password.Length -lt 10) {
    Lanzar-ErrorHttp 400 'La contrasena debe tener al menos 10 caracteres.'
  }
  if ($Password -notmatch '[A-Za-z]' -or $Password -notmatch '[0-9]') {
    Lanzar-ErrorHttp 400 'La contrasena debe combinar letras y numeros.'
  }
}

function Nuevo-RegistroUsuario {
  param(
    [string]$Usuario,
    [string]$Nombre,
    [string]$Password,
    [string]$Rol = 'local',
    [string]$LocalCarpeta = $null
  )
  $usuarioLimpio = Normalizar-Usuario $Usuario
  if ($usuarioLimpio -notmatch '^[a-z0-9._-]{3,40}$') {
    Lanzar-ErrorHttp 400 'El usuario debe tener entre 3 y 40 caracteres: letras, numeros, punto, guion o guion bajo.'
  }
  if ($Rol -notin @('admin', 'local')) { Lanzar-ErrorHttp 400 'Rol invalido.' }
  if ($Rol -eq 'local' -and [string]::IsNullOrWhiteSpace($LocalCarpeta)) {
    Lanzar-ErrorHttp 400 'Un usuario de local necesita un local asignado.'
  }
  Test-PoliticaPassword $Password

  $doc = Leer-Usuarios
  if ($null -ne (Buscar-Usuario $usuarioLimpio)) {
    Lanzar-ErrorHttp 409 'Ese usuario ya existe.'
  }
  $sal = Generar-BytesAleatorios 16
  $registro = [ordered]@{
    usuario       = $usuarioLimpio
    nombre        = if ([string]::IsNullOrWhiteSpace($Nombre)) { $usuarioLimpio } else { $Nombre.Trim() }
    rol           = $Rol
    localCarpeta  = if ($Rol -eq 'local') { $LocalCarpeta } else { $null }
    passwordHash  = (Calcular-HashPassword $Password $sal)
    passwordSalt  = [Convert]::ToBase64String($sal)
    iteraciones   = $script:IteracionesPbkdf2
    creadoEn      = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    activo        = $true
    intentos      = 0
    bloqueadoHasta = $null
    ultimoAcceso  = $null
  }
  $lista = @($doc.usuarios) + @($registro)
  $doc.usuarios = $lista
  Guardar-Usuarios $doc
  return $registro
}

function Actualizar-PasswordUsuario {
  param([string]$Usuario, [string]$PasswordNueva)
  Test-PoliticaPassword $PasswordNueva
  $doc = Leer-Usuarios
  $u = Normalizar-Usuario $Usuario
  $encontrado = $false
  foreach ($item in @($doc.usuarios)) {
    if ((Normalizar-Usuario $item.usuario) -eq $u) {
      $sal = Generar-BytesAleatorios 16
      $item.passwordSalt = [Convert]::ToBase64String($sal)
      $item.passwordHash = Calcular-HashPassword $PasswordNueva $sal
      $item.iteraciones = $script:IteracionesPbkdf2
      $item.intentos = 0
      $item.bloqueadoHasta = $null
      $encontrado = $true
    }
  }
  if (-not $encontrado) { Lanzar-ErrorHttp 404 'Usuario no encontrado.' }
  Guardar-Usuarios $doc
}

function Verificar-Credenciales {
  param([string]$Usuario, [string]$Password, [string]$Ip)
  $u = Buscar-Usuario $Usuario
  if ($null -eq $u) {
    # Retardo minimo para no filtrar si el usuario existe.
    Start-Sleep -Milliseconds 250
    return $null
  }
  if ($u.activo -eq $false) { return $null }
  if ($u.bloqueadoHasta) {
    $bloqueo = Convertir-FechaUtc $u.bloqueadoHasta
    if ($bloqueo -gt [DateTime]::UtcNow) {
      Lanzar-ErrorHttp 429 'Demasiados intentos fallidos. Espera unos minutos antes de volver a intentar.'
    }
  }
  $sal = [Convert]::FromBase64String([string]$u.passwordSalt)
  $iter = if ($u.iteraciones) { [int]$u.iteraciones } else { $script:IteracionesPbkdf2 }
  $calculado = Calcular-HashPassword $Password $sal $iter
  if (-not (Comparar-TiempoConstante $calculado ([string]$u.passwordHash))) {
    $doc = Leer-Usuarios
    foreach ($item in @($doc.usuarios)) {
      if ((Normalizar-Usuario $item.usuario) -eq (Normalizar-Usuario $Usuario)) {
        $item.intentos = [int]$item.intentos + 1
        if ($item.intentos -ge 5) {
          $item.bloqueadoHasta = [DateTime]::UtcNow.AddMinutes(10).ToString('o')
          $item.intentos = 0
        }
      }
    }
    Guardar-Usuarios $doc
    Escribir-Log "Login fallido para '$Usuario' desde $Ip" 'AVISO'
    return $null
  }
  # Login correcto: limpiar intentos y registrar acceso.
  $doc = Leer-Usuarios
  foreach ($item in @($doc.usuarios)) {
    if ((Normalizar-Usuario $item.usuario) -eq (Normalizar-Usuario $Usuario)) {
      $item.intentos = 0
      $item.bloqueadoHasta = $null
      $item.ultimoAcceso = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    }
  }
  Guardar-Usuarios $doc
  return (Buscar-Usuario $Usuario)
}

function Leer-Sesiones {
  Inicializar-Auth
  $doc = Leer-JsonRuta $script:RutaSesiones
  if ($null -eq $doc -or $null -eq $doc.sesiones) {
    return [ordered]@{ version = 1; sesiones = @() }
  }
  return $doc
}

function Guardar-Sesiones {
  param($Doc)
  Guardar-JsonAtomico $script:RutaSesiones $Doc
}

function Nuevo-HashToken {
  param([string]$Token)
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return (Convertir-AHex $sha.ComputeHash($script:Utf8SinBom.GetBytes($Token))) } finally { $sha.Dispose() }
}

function Crear-Sesion {
  param($UsuarioRegistro, [System.Net.HttpListenerContext]$Contexto)
  $docUsuarios = Leer-Usuarios
  $minutos = if ($docUsuarios.sesionMinutos) { [int]$docUsuarios.sesionMinutos } else { $script:SesionMinutosDefecto }
  if ($minutos -lt 15) { $minutos = 15 }
  if ($minutos -gt 1440) { $minutos = 1440 }

  $token = Convertir-Base64Url (Generar-BytesAleatorios 32)
  $csrf = Convertir-Base64Url (Generar-BytesAleatorios 24)
  $doc = Leer-Sesiones
  $ahora = [DateTime]::UtcNow
  $activas = @()
  foreach ($s in @($doc.sesiones)) {
    $exp = Convertir-FechaUtc $s.expiraEn
    if ($exp -gt $ahora) { $activas += $s }
  }
  $activas += [ordered]@{
    tokenHash = (Nuevo-HashToken $token)
    usuario   = [string]$UsuarioRegistro.usuario
    nombre    = [string]$UsuarioRegistro.nombre
    rol       = [string]$UsuarioRegistro.rol
    localCarpeta = [string]$UsuarioRegistro.localCarpeta
    csrf      = $csrf
    creadoEn  = $ahora.ToString('o')
    expiraEn  = $ahora.AddMinutes($minutos).ToString('o')
    ip        = (Obtener-IpCliente $Contexto)
  }
  $doc.sesiones = $activas
  Guardar-Sesiones $doc

  $cookie = "$script:NombreCookie=$token; Path=/; HttpOnly; SameSite=Strict; Max-Age=$($minutos * 60)"
  $Contexto.Response.AppendHeader('Set-Cookie', $cookie)
  return [ordered]@{
    usuario      = [string]$UsuarioRegistro.usuario
    nombre       = [string]$UsuarioRegistro.nombre
    rol          = [string]$UsuarioRegistro.rol
    localCarpeta = [string]$UsuarioRegistro.localCarpeta
    csrf         = $csrf
    expiraEn     = $ahora.AddMinutes($minutos).ToString('o')
  }
}

function Obtener-Sesion {
  param([System.Net.HttpListenerContext]$Contexto)
  $cookie = $null
  try { $cookie = $Contexto.Request.Cookies[$script:NombreCookie] } catch { $cookie = $null }
  if ($null -eq $cookie -or [string]::IsNullOrWhiteSpace($cookie.Value)) { return $null }
  $hash = Nuevo-HashToken $cookie.Value
  $doc = Leer-Sesiones
  $ahora = [DateTime]::UtcNow
  $encontrada = $null
  $vigentes = @()
  foreach ($s in @($doc.sesiones)) {
    $exp = Convertir-FechaUtc $s.expiraEn
    if ($exp -le $ahora) { continue }
    $vigentes += $s
    if ((Comparar-TiempoConstante $s.tokenHash $hash)) { $encontrada = $s }
  }
  if ($vigentes.Count -ne @($doc.sesiones).Count) {
    $doc.sesiones = $vigentes
    Guardar-Sesiones $doc
  }
  if ($null -eq $encontrada) { return $null }
  # La cuenta pudo desactivarse o cambiar de rol despues de iniciar sesion.
  $usuario = Buscar-Usuario $encontrada.usuario
  if ($null -eq $usuario -or $usuario.activo -eq $false) { return $null }
  return [ordered]@{
    usuario      = [string]$encontrada.usuario
    nombre       = [string]$usuario.nombre
    rol          = [string]$usuario.rol
    localCarpeta = [string]$usuario.localCarpeta
    csrf         = [string]$encontrada.csrf
    expiraEn     = [string]$encontrada.expiraEn
    tokenHash    = [string]$encontrada.tokenHash
  }
}

function Cerrar-Sesion {
  param([System.Net.HttpListenerContext]$Contexto)
  $cookie = $null
  try { $cookie = $Contexto.Request.Cookies[$script:NombreCookie] } catch { }
  if ($null -ne $cookie -and -not [string]::IsNullOrWhiteSpace($cookie.Value)) {
    $hash = Nuevo-HashToken $cookie.Value
    $doc = Leer-Sesiones
    $doc.sesiones = @(@($doc.sesiones) | Where-Object { -not (Comparar-TiempoConstante $_.tokenHash $hash) })
    Guardar-Sesiones $doc
  }
  $Contexto.Response.AppendHeader('Set-Cookie', "$script:NombreCookie=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
}

function Requerir-Sesion {
  param(
    [System.Net.HttpListenerContext]$Contexto,
    [string[]]$Roles = @('admin', 'local')
  )
  $sesion = Obtener-Sesion $Contexto
  if ($null -eq $sesion) { Lanzar-ErrorHttp 401 'Debes iniciar sesion.' }
  if ($Roles -and ($Roles -notcontains $sesion.rol)) {
    Lanzar-ErrorHttp 403 'No tienes permisos para esta operacion.'
  }
  return $sesion
}

function Validar-Csrf {
  param([System.Net.HttpListenerContext]$Contexto, $Sesion)
  $metodo = $Contexto.Request.HttpMethod
  if ($metodo -in @('GET', 'HEAD', 'OPTIONS')) { return }
  $enviado = $Contexto.Request.Headers['X-CSRF-Token']
  if ([string]::IsNullOrWhiteSpace($enviado) -or -not (Comparar-TiempoConstante $enviado ([string]$Sesion.csrf))) {
    Lanzar-ErrorHttp 403 'Token CSRF invalido o ausente. Recarga la pagina.'
  }
}

function Limpiar-SesionesExpiradas {
  $doc = Leer-Sesiones
  $ahora = [DateTime]::UtcNow
  $vigentes = @(@($doc.sesiones) | Where-Object { (Convertir-FechaUtc $_.expiraEn) -gt $ahora })
  if ($vigentes.Count -ne @($doc.sesiones).Count) {
    $doc.sesiones = $vigentes
    Guardar-Sesiones $doc
  }
}

function Listar-UsuariosSeguro {
  $doc = Leer-Usuarios
  return @(@($doc.usuarios) | ForEach-Object {
      [ordered]@{
        usuario      = $_.usuario
        nombre       = $_.nombre
        rol          = $_.rol
        localCarpeta = $_.localCarpeta
        activo       = ($_.activo -ne $false)
        creadoEn     = $_.creadoEn
        ultimoAcceso = $_.ultimoAcceso
      }
    })
}
