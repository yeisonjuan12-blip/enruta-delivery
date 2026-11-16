# ============================================================
#  EnRuta Delivery - Servidor local (HttpListener)
#  Sirve la web publica, el panel /admin y la API.
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File server\servidor.ps1
#    powershell -ExecutionPolicy Bypass -File server\servidor.ps1 -Puerto 8780 -Abrir
#
#  Solo escucha en localhost por defecto. Para publicar en internet
#  se necesita un proxy HTTPS (IIS, Caddy, nginx) y cambiar el prefijo.
# ============================================================

param(
  [int]$Puerto = 0,
  [string]$Prefijo = '',
  [switch]$Abrir
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Split-Path -Parent $scriptDir

. (Join-Path $scriptDir 'lib\comun.ps1')
. (Join-Path $scriptDir 'lib\auth.ps1')
. (Join-Path $scriptDir 'lib\datos.ps1')
. (Join-Path $scriptDir 'lib\ocr.ps1')
. (Join-Path $scriptDir 'lib\api.ps1')

$configRuta = Join-Path $scriptDir 'config.json'
$config = Leer-JsonRuta $configRuta $null
if ($null -ne $config) {
  if ($Puerto -le 0 -and $config.puerto) { $Puerto = [int]$config.puerto }
  if ([string]::IsNullOrWhiteSpace($Prefijo) -and $config.prefijo) { $Prefijo = [string]$config.prefijo }
}
if ($Puerto -le 0) { $Puerto = 8780 }
if ([string]::IsNullOrWhiteSpace($Prefijo)) { $Prefijo = "http://localhost:$Puerto/" }
if (-not $Prefijo.EndsWith('/')) { $Prefijo += '/' }

Inicializar-Datos
Limpiar-SesionesExpiradas

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.png'  = 'image/png'
  '.webp' = 'image/webp'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2' = 'font/woff2'
  '.txt'  = 'text/plain; charset=utf-8'
  '.xml'  = 'application/xml; charset=utf-8'
  '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.md'   = 'text/markdown; charset=utf-8'
  '.pdf'  = 'application/pdf'
  '.mp4'  = 'video/mp4'
}

$bloqueadas = @('\server\', '\tools\', '\.opencode\', '\plantillas\')
$extensionesBloqueadas = @('.ps1', '.json', '.log', '.bak', '.tmp', '.psd1', '.psm1', '.md', '.txt')
$archivosPublicos = @('ads.txt', 'robots.txt', 'sitemap.xml', 'manifest.webmanifest', 'security.txt')
$script:CacheGzip = @{}

function Comprimir-Gzip {
  param([byte[]]$Bytes)
  $salida = New-Object System.IO.MemoryStream
  $gz = New-Object System.IO.Compression.GZipStream($salida, [System.IO.Compression.CompressionLevel]::Optimal, $true)
  try {
    $gz.Write($Bytes, 0, $Bytes.Length)
    $gz.Flush()
  } finally {
    $gz.Dispose()
  }
  try { return $salida.ToArray() } finally { $salida.Dispose() }
}

function Enviar-ArchivoEstatico {
  param([System.Net.HttpListenerContext]$Contexto, [string]$RutaRelativa)
  $req = $Contexto.Request
  if ($RutaRelativa -eq '' -or $RutaRelativa -eq '/') { $RutaRelativa = '/index.html' }
  if ($RutaRelativa -eq '/admin' -or $RutaRelativa -eq '/admin/') { $RutaRelativa = '/admin/index.html' }
  if ($RutaRelativa -eq '/privacidad' -or $RutaRelativa -eq '/privacidad/') { $RutaRelativa = '/privacidad.html' }

  $rel = $RutaRelativa.TrimStart('/').Replace('/', '\')
  $completo = Join-Path $root $rel

  if (-not (Test-RutaDentro $completo $root)) {
    Responder-Texto $Contexto 403 'Acceso denegado.'
    return
  }
  $normalizado = '\' + $rel + '\'
  foreach ($b in $bloqueadas) {
    if ($normalizado.Contains($b) -or $rel.StartsWith($b.TrimStart('\'))) {
      Responder-Texto $Contexto 404 'No encontrado.'
      return
    }
  }
  $ext = ([IO.Path]::GetExtension($completo)).ToLowerInvariant()
  if (($extensionesBloqueadas -contains $ext) -and -not ($archivosPublicos -contains $rel) -and -not ($rel -match '^[a-f0-9]{32}\.txt$')) {
    Responder-Texto $Contexto 404 'No encontrado.'
    return
  }
  # En /data solo se sirven imagenes de las carpetas img; el JSON comercial nunca se expone.
  if ($rel.StartsWith('data\') -or $rel -eq 'data') {
    $permitida = ($ext -in @('.jpg', '.jpeg', '.png', '.webp', '.gif', '.svg')) -and
      ($rel -match '(?i)^data\\(locales\\local-[0-9]{3,4}|licores|primera-necesidad)\\img\\[^\\]+$')
    if (-not $permitida) {
      Responder-Texto $Contexto 404 'No encontrado.'
      return
    }
  }

  if (Test-Path -LiteralPath $completo -PathType Container) {
    $completo = Join-Path $completo 'index.html'
  }
  if (-not (Test-Path -LiteralPath $completo -PathType Leaf)) {
    Responder-Texto $Contexto 404 'No encontrado.'
    return
  }

  $info = New-Object System.IO.FileInfo($completo)
  $etag = '"' + $info.Length.ToString('x') + '-' + $info.LastWriteTimeUtc.Ticks.ToString('x') + '"'
  $cacheControl = if ($ext -in @('.html', '.js', '.css')) { 'no-cache' } else { 'public, max-age=604800' }

  $Contexto.Response.Headers['ETag'] = $etag
  $Contexto.Response.Headers['Cache-Control'] = $cacheControl
  if ($req.Headers['If-None-Match'] -and $req.Headers['If-None-Match'].Contains($etag)) {
    $Contexto.Response.StatusCode = 304
    try { $Contexto.Response.Close() } catch { }
    return
  }

  try {
    $bytes = [IO.File]::ReadAllBytes($completo)
  } catch {
    Responder-Texto $Contexto 500 'No se pudo leer el archivo.'
    return
  }
  $tipo = $mime[$ext]
  if (-not $tipo) { $tipo = 'application/octet-stream' }

  $esTexto = $ext -in @('.html', '.htm', '.css', '.js', '.svg')
  $aceptaGzip = [string]$req.Headers['Accept-Encoding'] -match '(?i)gzip'
  if ($esTexto) { $Contexto.Response.Headers['Vary'] = 'Accept-Encoding' }
  if ($esTexto -and $aceptaGzip -and $bytes.Length -gt 1024) {
    $clave = $completo + '|' + $etag
    if ($script:CacheGzip.ContainsKey($clave)) {
      $comprimido = $script:CacheGzip[$clave]
    } else {
      $comprimido = Comprimir-Gzip $bytes
      if ($script:CacheGzip.Count -gt 24) { $script:CacheGzip.Clear() }
      $script:CacheGzip[$clave] = $comprimido
    }
    $bytes = $comprimido
    $Contexto.Response.Headers['Content-Encoding'] = 'gzip'
  }

  $Contexto.Response.StatusCode = 200
  $Contexto.Response.ContentType = $tipo
  $Contexto.Response.ContentLength64 = $bytes.Length
  $Contexto.Response.Headers['X-Content-Type-Options'] = 'nosniff'
  $Contexto.Response.Headers['X-Frame-Options'] = 'DENY'
  $Contexto.Response.Headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
  if ($ext -eq '.html') {
    $csp = "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; " +
      "img-src 'self' data: https:; font-src 'self' data:; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://pagead2.googlesyndication.com https://partner.googleadservices.com https://tpc.googlesyndication.com https://www.google.com https://www.gstatic.com https://adservice.google.com https://fundingchoicesmessages.google.com; " +
      "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://region1.google-analytics.com https://www.googletagmanager.com https://pagead2.googlesyndication.com https://googleads.g.doubleclick.net https://ep1.adtrafficquality.google https://ep2.adtrafficquality.google https://fundingchoicesmessages.google.com; " +
      "frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://www.google.com https://pagead2.googlesyndication.com https://fundingchoicesmessages.google.com"
    $Contexto.Response.Headers['Content-Security-Policy'] = $csp
  }
  try {
    $Contexto.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch { }
  finally {
    try { $Contexto.Response.OutputStream.Close() } catch { }
    try { $Contexto.Response.Close() } catch { }
  }
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($Prefijo)
try {
  $listener.Start()
} catch {
  Write-Host ''
  Write-Host "No se pudo iniciar el servidor en $Prefijo" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Si el puerto esta ocupado, usa otro: -Puerto 8781' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host '  EnRuta Delivery - servidor local' -ForegroundColor Yellow
Write-Host '  ---------------------------------------------'
Write-Host "  Web publica : $($Prefijo.TrimEnd('/'))/"
Write-Host "  Panel admin : $($Prefijo.TrimEnd('/'))/admin"
Write-Host "  API         : $($Prefijo.TrimEnd('/'))/api/estado"
Write-Host ''
Write-Host '  Sesiones y pedidos: server\datos\' -ForegroundColor DarkGray
Write-Host '  Detener: Ctrl + C' -ForegroundColor DarkGray
Write-Host ''
if (-not (Test-Path -LiteralPath (Join-Path $script:CarpetaDatos 'usuarios.json'))) {
  Write-Host '  Aun no hay usuarios. Crea el admin con:' -ForegroundColor Yellow
  Write-Host '    powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1' -ForegroundColor Yellow
  Write-Host ''
} elseif (@((Leer-Usuarios).usuarios).Count -eq 0) {
  Write-Host '  No hay cuentas creadas. Ejecuta tools\crear-admin.ps1' -ForegroundColor Yellow
  Write-Host ''
}

if ($Abrir) {
  try { Start-Process ($Prefijo.TrimEnd('/') + '/') | Out-Null } catch { }
}

try {
  while ($listener.IsListening) {
    $contexto = $null
    try {
      $contexto = $listener.GetContext()
    } catch {
      if ($listener.IsListening) { Escribir-Log "Error al aceptar conexion: $($_.Exception.Message)" 'ERROR' }
      continue
    }
    if ($null -eq $contexto) { continue }

    try {
      $ruta = $contexto.Request.Url.AbsolutePath
      if ($contexto.Request.HttpMethod -eq 'OPTIONS') {
        $contexto.Response.StatusCode = 204
        $contexto.Response.Headers['Allow'] = 'GET, POST, PUT, DELETE, OPTIONS'
        $contexto.Response.Close()
        continue
      }

      if ($ruta -like '/api/*' -or $ruta -eq '/api') {
        try {
          Manejar-Api $contexto
        } catch {
          $status = 500
          $mensaje = 'Error interno del servidor.'
          if ($_.Exception.Data.Contains('httpStatus')) {
            $status = [int]$_.Exception.Data['httpStatus']
            $mensaje = $_.Exception.Message
          } else {
            $mensaje = $_.Exception.Message
            Escribir-Log "API $ruta : $($_.Exception.Message) | $($_.ScriptStackTrace)" 'ERROR'
          }
          try { Responder-Json $contexto $status ([ordered]@{ ok = $false; error = $mensaje }) } catch { }
        }
      } else {
        Enviar-ArchivoEstatico $contexto $ruta
      }
    } catch {
      Escribir-Log "Error no controlado: $($_.Exception.Message)" 'ERROR'
      try { Responder-Texto $contexto 500 'Error interno.' } catch { }
    }
  }
} finally {
  try { $listener.Stop() } catch { }
  try { $listener.Close() } catch { }
  Write-Host ''
  Write-Host 'Servidor detenido.' -ForegroundColor Yellow
}
