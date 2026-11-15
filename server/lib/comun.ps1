# ============================================================
#  EnRuta Delivery - Utilidades comunes del servidor
#  PowerShell 5.1 / .NET Framework
# ============================================================

$script:Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:CarpetaServidor = Join-Path $script:Raiz 'server'
$script:CarpetaDatos = Join-Path $script:CarpetaServidor 'datos'
$script:CarpetaDatosPublicos = Join-Path $script:Raiz 'data'
$script:CarpetaImportaciones = Join-Path $script:CarpetaDatos 'importaciones'
$script:Utf8SinBom = New-Object System.Text.UTF8Encoding($false)
$script:Utf8ConBom = New-Object System.Text.UTF8Encoding($true)

function Asegurar-Carpeta {
  param([string]$Ruta)
  if (-not (Test-Path -LiteralPath $Ruta -PathType Container)) {
    New-Item -ItemType Directory -Path $Ruta -Force | Out-Null
  }
  return $Ruta
}

function Leer-JsonRuta {
  param(
    [string]$Ruta,
    $Predeterminado = $null
  )
  if (-not (Test-Path -LiteralPath $Ruta -PathType Leaf)) { return $Predeterminado }
  try {
    $texto = [IO.File]::ReadAllText($Ruta, [Text.Encoding]::UTF8)
    if ([string]::IsNullOrWhiteSpace($texto)) { return $Predeterminado }
    return ($texto | ConvertFrom-Json)
  } catch {
    Escribir-Log "JSON invalido en $Ruta : $($_.Exception.Message)" 'ERROR'
    return $Predeterminado
  }
}

function Convertir-AJsonBonito {
  param($Objeto, [int]$Profundidad = 40)
  $json = $Objeto | ConvertTo-Json -Depth $Profundidad
  if ($null -eq $json) { $json = 'null' }
  # ConvertTo-Json escapa acentos; los dejamos legibles en disco.
  $json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', {
      param($m)
      [string][char][Convert]::ToInt32($m.Groups[1].Value, 16)
    })
  return $json
}

function Convertir-Numero {
  # Convierte numeros y textos con punto o coma decimal sin depender
  # de la cultura del sistema (es-ES interpretaria "12.5" como 125).
  # Devuelve $null cuando el valor no es un numero valido.
  param($Valor)
  if ($null -eq $Valor) { return $null }
  if ($Valor -is [bool]) { return $null }
  if ($Valor -is [double] -or $Valor -is [single] -or $Valor -is [decimal] -or
      $Valor -is [int] -or $Valor -is [long] -or $Valor -is [int16] -or
      $Valor -is [uint16] -or $Valor -is [uint32] -or $Valor -is [uint64] -or
      $Valor -is [byte] -or $Valor -is [sbyte]) {
    return [double]$Valor
  }
  $texto = [string]$Valor
  if ([string]::IsNullOrWhiteSpace($texto)) { return $null }
  $texto = $texto.Trim()
  # Quitar simbolo de moneda y separadores de miles con espacio.
  $texto = $texto -replace '(?i)S/\s*', ''
  $texto = $texto -replace '[^0-9,\.\-\+]', ''
  if ($texto -eq '' -or $texto -eq '-' -or $texto -eq '+' -or $texto -eq '.' -or $texto -eq ',') { return $null }

  $comas = [regex]::Matches($texto, ',').Count
  $puntos = [regex]::Matches($texto, '\.').Count
  if ($comas -gt 0 -and $puntos -gt 0) {
    # El ultimo separador escrito es el decimal; el otro es de miles.
    if ($texto.LastIndexOf(',') -gt $texto.LastIndexOf('.')) {
      $texto = $texto.Replace('.', '').Replace(',', '.')
    } else {
      $texto = $texto.Replace(',', '')
    }
  } elseif ($comas -gt 0) {
    if ($comas -gt 1) { $texto = $texto.Replace(',', '') }
    else { $texto = $texto.Replace(',', '.') }
  } elseif ($puntos -gt 1) {
    $texto = $texto.Replace('.', '')
  }

  $numero = 0.0
  if ([double]::TryParse($texto, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$numero)) {
    return $numero
  }
  return $null
}

function Guardar-JsonAtomico {
  param(
    [string]$Ruta,
    $Objeto,
    [switch]$SinRespaldo
  )
  $dir = Split-Path -Parent $Ruta
  Asegurar-Carpeta $dir | Out-Null
  $json = (Convertir-AJsonBonito $Objeto) + "`n"
  $tmp = $Ruta + '.tmp-' + [Guid]::NewGuid().ToString('N')
  [IO.File]::WriteAllText($tmp, $json, $script:Utf8SinBom)
  try {
    if (-not $SinRespaldo -and (Test-Path -LiteralPath $Ruta -PathType Leaf)) {
      try { Copy-Item -LiteralPath $Ruta -Destination ($Ruta + '.bak') -Force } catch { }
    }
    if (Test-Path -LiteralPath $Ruta -PathType Leaf) {
      # File.Replace conserva el original hasta completar la escritura.
      try {
        [IO.File]::Replace($tmp, $Ruta, $null, $true)
        return
      } catch {
        # En algunos sistemas de archivos Replace falla; fallback atomico.
        Move-Item -LiteralPath $tmp -Destination $Ruta -Force
        return
      }
    }
    Move-Item -LiteralPath $tmp -Destination $Ruta -Force
  } finally {
    if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
}

function Leer-CuerpoTexto {
  param(
    [System.Net.HttpListenerContext]$Contexto,
    [int]$MaximoBytes = 26214400
  )
  $req = $Contexto.Request
  if (-not $req.HasEntityBody) { return '' }
  if ($req.ContentLength64 -gt $MaximoBytes) {
    Lanzar-ErrorHttp 413 'El archivo o peticion supera el limite permitido (25 MB).'
  }
  $ms = New-Object IO.MemoryStream
  try {
    $buffer = New-Object byte[] 65536
    $total = 0
    while (($leido = $req.InputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
      $total += $leido
      if ($total -gt $MaximoBytes) { Lanzar-ErrorHttp 413 'La peticion es demasiado grande.' }
      $ms.Write($buffer, 0, $leido)
    }
    return $script:Utf8SinBom.GetString($ms.ToArray())
  } finally {
    $ms.Dispose()
  }
}

function Leer-CuerpoJson {
  param(
    [System.Net.HttpListenerContext]$Contexto,
    [int]$MaximoBytes = 26214400
  )
  $texto = Leer-CuerpoTexto $Contexto $MaximoBytes
  if ([string]::IsNullOrWhiteSpace($texto)) { return $null }
  try {
    return ($texto | ConvertFrom-Json)
  } catch {
    Lanzar-ErrorHttp 400 'El cuerpo de la peticion no es JSON valido.'
  }
}

function Escribir-Respuesta {
  param(
    [System.Net.HttpListenerContext]$Contexto,
    [int]$Codigo,
    [byte[]]$Bytes,
    [string]$TipoContenido = 'text/plain; charset=utf-8'
  )
  try {
    $Contexto.Response.StatusCode = $Codigo
    $Contexto.Response.ContentType = $TipoContenido
    $Contexto.Response.ContentLength64 = $Bytes.Length
    $Contexto.Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Contexto.Response.Headers['X-Frame-Options'] = 'DENY'
    $Contexto.Response.Headers['Referrer-Policy'] = 'same-origin'
    $Contexto.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
  } catch {
    # El cliente pudo cerrar la conexion.
  } finally {
    try { $Contexto.Response.OutputStream.Close() } catch { }
    try { $Contexto.Response.Close() } catch { }
  }
}

function Responder-Json {
  param(
    [System.Net.HttpListenerContext]$Contexto,
    [int]$Codigo,
    $Objeto
  )
  $json = Convertir-AJsonBonito $Objeto
  $bytes = $script:Utf8SinBom.GetBytes($json)
  Escribir-Respuesta $Contexto $Codigo $bytes 'application/json; charset=utf-8'
}

function Responder-Texto {
  param(
    [System.Net.HttpListenerContext]$Contexto,
    [int]$Codigo,
    [string]$Texto,
    [string]$Tipo = 'text/plain; charset=utf-8'
  )
  Escribir-Respuesta $Contexto $Codigo ($script:Utf8SinBom.GetBytes($Texto)) $Tipo
}

function Lanzar-ErrorHttp {
  param([int]$Codigo, [string]$Mensaje)
  $ex = New-Object System.Exception($Mensaje)
  $ex.Data['httpStatus'] = $Codigo
  throw $ex
}

function Escribir-Log {
  param([string]$Mensaje, [string]$Nivel = 'INFO')
  try {
    Asegurar-Carpeta $script:CarpetaDatos | Out-Null
    $ruta = Join-Path $script:CarpetaDatos 'servidor.log'
    $linea = '{0} [{1}] {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Nivel, $Mensaje
    [IO.File]::AppendAllText($ruta, $linea + "`r`n", $script:Utf8SinBom)
  } catch { }
}

function Normalizar-Texto {
  param([string]$Texto)
  if ($null -eq $Texto) { return '' }
  $t = $Texto.Normalize([Text.NormalizationForm]::FormD)
  $sb = New-Object Text.StringBuilder
  foreach ($c in $t.ToCharArray()) {
    if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($c) -ne [Globalization.UnicodeCategory]::NonSpacingMark) {
      [void]$sb.Append($c)
    }
  }
  $t = $sb.ToString().Normalize([Text.NormalizationForm]::FormC).ToLowerInvariant()
  $t = [regex]::Replace($t, '[^a-z0-9]+', ' ')
  return $t.Trim()
}

function Convertir-AId {
  param([string]$Texto, [string]$Prefijo = 'item')
  $n = Normalizar-Texto $Texto
  $n = $n -replace '\s+', '-'
  if ($n.Length -gt 48) { $n = $n.Substring(0, 48).TrimEnd('-') }
  if ([string]::IsNullOrWhiteSpace($n)) { $n = $Prefijo }
  return $n
}

function Obtener-IpCliente {
  param([System.Net.HttpListenerContext]$Contexto)
  try {
    $ip = $Contexto.Request.RemoteEndPoint.Address.ToString()
    return $ip
  } catch { return 'desconocida' }
}

function Test-RutaDentro {
  param([string]$Ruta, [string]$Base)
  $r = [IO.Path]::GetFullPath($Ruta)
  $b = [IO.Path]::GetFullPath($Base).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
  return $r.StartsWith($b, [StringComparison]::OrdinalIgnoreCase)
}

function Obtener-FechaUtc {
  return [DateTime]::UtcNow.ToString('o')
}

function Test-HoraValida {
  param([string]$Hora)
  return ($Hora -match '^([01][0-9]|2[0-3]):[0-5][0-9]$')
}

function Leer-TextoPlano {
  param([string]$Ruta)
  if (-not (Test-Path -LiteralPath $Ruta -PathType Leaf)) { return '' }
  return [IO.File]::ReadAllText($Ruta, [Text.Encoding]::UTF8)
}
