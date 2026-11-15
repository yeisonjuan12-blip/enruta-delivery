# ============================================================
#  EnRuta Delivery - OCR nativo de Windows + analisis de cartas
#  Windows.Media.Ocr (es-ES) y Windows.Data.Pdf
#  No requiere Tesseract ni servicios externos.
# ============================================================

$script:OcrInicializado = $false
$script:OcrEngine = $null
$script:OcrAsTask = $null
$script:OcrAsTaskAction = $null

function Inicializar-Ocr {
  if ($script:OcrInicializado) { return }
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
  [void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
  [void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
  [void][Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
  [void][Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
  [void][Windows.Globalization.Language, Windows.Globalization, ContentType = WindowsRuntime]

  $script:OcrAsTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]
  $script:OcrAsTaskAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'
    })[0]
  if ($null -eq $script:OcrAsTask -or $null -eq $script:OcrAsTaskAction) {
    throw 'No se pudieron preparar las funciones asincronas de WinRT.'
  }

  $idioma = New-Object Windows.Globalization.Language('es-ES')
  $script:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($idioma)
  if ($null -eq $script:OcrEngine) {
    $script:OcrEngine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if ($null -eq $script:OcrEngine) {
    throw 'Windows no tiene instalado el reconocedor OCR en espanol. Instala el idioma en Configuracion > Hora e idioma.'
  }
  $script:OcrInicializado = $true
}

function Await-WinRt {
  param($Operacion, [Type]$Tipo)
  $metodo = $script:OcrAsTask.MakeGenericMethod($Tipo)
  $tarea = $metodo.Invoke($null, @($Operacion))
  [void]$tarea.Wait(-1)
  return $tarea.Result
}

function Await-WinRtAction {
  param($Operacion)
  $tarea = $script:OcrAsTaskAction.Invoke($null, @($Operacion))
  [void]$tarea.Wait(-1)
}

function Ocr-ImagenArchivo {
  param([string]$Ruta)
  Inicializar-Ocr
  if (-not (Test-Path -LiteralPath $Ruta -PathType Leaf)) { throw "No existe la imagen: $Ruta" }
  $abs = [IO.Path]::GetFullPath($Ruta)
  $archivo = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($abs)) ([Windows.Storage.StorageFile])
  $stream = Await-WinRt ($archivo.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bmp = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $resultado = Await-WinRt ($script:OcrEngine.RecognizeAsync($bmp)) ([Windows.Media.Ocr.OcrResult])
  $lineas = @()
  foreach ($linea in $resultado.Lines) {
    $palabras = @()
    $x1 = [double]::MaxValue; $y1 = [double]::MaxValue; $x2 = 0; $y2 = 0
    foreach ($palabra in $linea.Words) {
      $r = $palabra.BoundingRect
      $palabras += [ordered]@{
        texto = [string]$palabra.Text
        x     = [double]$r.X
        y     = [double]$r.Y
        ancho = [double]$r.Width
        alto  = [double]$r.Height
      }
      if ($r.X -lt $x1) { $x1 = [double]$r.X }
      if ($r.Y -lt $y1) { $y1 = [double]$r.Y }
      if (($r.X + $r.Width) -gt $x2) { $x2 = [double]($r.X + $r.Width) }
      if (($r.Y + $r.Height) -gt $y2) { $y2 = [double]($r.Y + $r.Height) }
    }
    if ($palabras.Count -eq 0) { continue }
    $lineas += [ordered]@{
      texto   = [string]$linea.Text
      palabras = @($palabras)
      x       = $x1
      y       = $y1
      ancho   = [Math]::Max(1, ($x2 - $x1))
      alto    = [Math]::Max(1, ($y2 - $y1))
    }
  }
  $ancho = [double]$bmp.PixelWidth
  $alto = [double]$bmp.PixelHeight
  $bmp.Dispose()
  $stream.Dispose()
  return [ordered]@{
    ancho  = $ancho
    alto   = $alto
    lineas = @($lineas)
  }
}

function Ocr-PdfArchivo {
  param([string]$Ruta, [int]$MaxPaginas = 20)
  Inicializar-Ocr
  $abs = [IO.Path]::GetFullPath($Ruta)
  $archivo = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($abs)) ([Windows.Storage.StorageFile])
  $doc = Await-WinRt ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($archivo)) ([Windows.Data.Pdf.PdfDocument])
  $total = [int]$doc.PageCount
  if ($total -le 0) { throw 'El PDF no tiene paginas legibles.' }
  if ($total -gt $MaxPaginas) {
    throw "El PDF tiene $total paginas y el limite es $MaxPaginas. Divide la carta e importala por partes."
  }
  $paginas = @()
  $dirTemp = Join-Path $script:CarpetaImportaciones ('tmp-' + [Guid]::NewGuid().ToString('N'))
  Asegurar-Carpeta $dirTemp | Out-Null
  try {
    for ($i = 0; $i -lt $total; $i++) {
      $page = $doc.GetPage($i)
      $ms = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
      $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
      $opts.DestinationWidth = [uint32]1700
      Await-WinRtAction ($page.RenderToStreamAsync($ms, $opts))
      $size = [int]$ms.Size
      $reader = New-Object Windows.Storage.Streams.DataReader($ms.GetInputStreamAt(0))
      [void](Await-WinRt ($reader.LoadAsync([uint32]$size)) ([uint32]))
      $bytes = New-Object byte[] $size
      $reader.ReadBytes($bytes)
      $imgRuta = Join-Path $dirTemp ("pagina-{0}.png" -f ($i + 1))
      [IO.File]::WriteAllBytes($imgRuta, $bytes)
      $ocr = Ocr-ImagenArchivo $imgRuta
      $paginas += [ordered]@{
        numero = $i + 1
        ancho  = $ocr.ancho
        alto   = $ocr.alto
        lineas = @($ocr.lineas)
      }
      $reader.Dispose()
      $ms.Dispose()
      $page.Dispose()
    }
  } finally {
    try { Remove-Item -LiteralPath $dirTemp -Recurse -Force -ErrorAction SilentlyContinue } catch { }
    try { $doc.Dispose() } catch { }
  }
  return [ordered]@{ totalPaginas = $total; paginas = @($paginas) }
}

function Ocr-ProcesarDocumento {
  param([string]$Ruta, [string]$NombreOriginal)
  $ext = ([IO.Path]::GetExtension($NombreOriginal)).ToLowerInvariant()
  if ($ext -eq '.pdf') {
    $res = Ocr-PdfArchivo $Ruta 20
    return [ordered]@{
      tipo         = 'pdf'
      totalPaginas = $res.totalPaginas
      paginas      = @($res.paginas)
    }
  }
  if ($ext -in @('.jpg', '.jpeg', '.png', '.webp')) {
    $ocr = Ocr-ImagenArchivo $Ruta
    return [ordered]@{
      tipo         = 'imagen'
      totalPaginas = 1
      paginas      = @([ordered]@{ numero = 1; ancho = $ocr.ancho; alto = $ocr.alto; lineas = @($ocr.lineas) })
    }
  }
  throw 'Formato no compatible. Usa JPG, PNG o PDF.'
}

# ------------------------------------------------------------
#  Analisis de texto OCR
# ------------------------------------------------------------
function Unir-FilasPagina {
  param($Pagina)
  $lineas = @($Pagina.lineas)
  if ($lineas.Count -eq 0) { return @() }
  $usadas = New-Object bool[] $lineas.Count
  $filas = @()
  for ($i = 0; $i -lt $lineas.Count; $i++) {
    if ($usadas[$i]) { continue }
    $base = $lineas[$i]
    $grupo = @($i)
    $usadas[$i] = $true
    $centro = [double]$base.y + ([double]$base.alto / 2)
    for ($j = $i + 1; $j -lt $lineas.Count; $j++) {
      if ($usadas[$j]) { continue }
      $otra = $lineas[$j]
      $centroOtra = [double]$otra.y + ([double]$otra.alto / 2)
      $tolerancia = [Math]::Max(10, [Math]::Max([double]$base.alto, [double]$otra.alto) * 0.55)
      if ([Math]::Abs($centro - $centroOtra) -le $tolerancia) {
        $grupo += $j
        $usadas[$j] = $true
      }
    }
    $items = @($grupo | ForEach-Object { $lineas[$_] } | Sort-Object -Property @{ Expression = { [double]$_.x } })
    $texto = (@($items | ForEach-Object { ([string]$_.texto).Trim() }) | Where-Object { $_ }) -join ' '
    if ([string]::IsNullOrWhiteSpace($texto)) { continue }
    $x = [double]::MaxValue; $y = [double]::MaxValue; $x2 = 0; $y2 = 0
    foreach ($it in $items) {
      if ([double]$it.x -lt $x) { $x = [double]$it.x }
      if ([double]$it.y -lt $y) { $y = [double]$it.y }
      if (([double]$it.x + [double]$it.ancho) -gt $x2) { $x2 = [double]$it.x + [double]$it.ancho }
      if (([double]$it.y + [double]$it.alto) -gt $y2) { $y2 = [double]$it.y + [double]$it.alto }
    }
    $filas += [ordered]@{
      texto = $texto
      x     = $x
      y     = $y
      ancho = [Math]::Max(1, ($x2 - $x))
      alto  = [Math]::Max(1, ($y2 - $y))
      pagina = [int]$Pagina.numero
    }
  }
  return @($filas | Sort-Object -Property @{ Expression = { [double]$_.y } }, @{ Expression = { [double]$_.x } })
}

function Normalizar-NumeroOcr {
  param([string]$Texto)
  $t = $Texto.Replace('O', '0').Replace('o', '0').Replace('I', '1').Replace('l', '1').Replace('|', '1')
  $t = $t.Replace(',', '.')
  return $t
}

function Extraer-PreciosLinea {
  param([string]$Texto)
  $resultados = @()
  $patronMoneda = '(?i)(?:S\s*[/\\]\s*\.?|S\/\.?|S[I1l](?=\s*[0-9OoIl|])|PEN|\$)\s*([0-9OoIl|]{1,4}(?:[.,][0-9OoIl|]{1,2})?)'
  foreach ($m in [regex]::Matches($Texto, $patronMoneda)) {
    $num = Normalizar-NumeroOcr $m.Groups[1].Value
    $valor = 0.0
    if ([double]::TryParse($num, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$valor)) {
      if ($valor -gt 0 -and $valor -le 5000) {
        $resultados += [ordered]@{ indice = $m.Index; largo = $m.Length; valor = [Math]::Round($valor, 2); crudo = $m.Value }
      }
    }
  }
  if ($resultados.Count -eq 0) {
    $patronSuelto = '(?<![\d])([0-9]{1,3}[.,][0-9]{2})(?![\d])'
    foreach ($m in [regex]::Matches($Texto, $patronSuelto)) {
      $num = Normalizar-NumeroOcr $m.Groups[1].Value
      $valor = 0.0
      if ([double]::TryParse($num, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$valor)) {
        if ($valor -gt 0 -and $valor -le 5000) {
          $resultados += [ordered]@{ indice = $m.Index; largo = $m.Length; valor = [Math]::Round($valor, 2); crudo = $m.Value }
        }
      }
    }
  }
  return @($resultados | Sort-Object -Property @{ Expression = { [int]$_.indice } })
}

function Limpiar-NombreProducto {
  param([string]$Texto)
  $t = ([string]$Texto).Trim()
  $t = [regex]::Replace($t, '^[\s\-–—•*·:;,.|]+', '')
  $t = [regex]::Replace($t, '[\s\-–—•*·:;,|/]+$', '')
  $t = [regex]::Replace($t, '\s{2,}', ' ')
  $t = [regex]::Replace($t, '(?i)\bS\s*[/\\]\s*\.?$', '').Trim()
  # El OCR suele leer "S/" como "SI"; si quedo pegado al nombre, se retira.
  $t = [regex]::Replace($t, '(?i)\s+S[I1l]\s*\.?$', '').Trim()
  # Confusion tipica de OCR en unidades de volumen: "500 mi" -> "500 ml".
  $t = [regex]::Replace($t, '(?i)\b(\d{2,4})\s*mi\b', '$1 ml')
  if ([string]::IsNullOrWhiteSpace($t)) { return '' }
  $letras = @($t.ToCharArray() | Where-Object { [char]::IsLetter($_) })
  $mayus = @($letras | Where-Object { [char]::IsUpper($_) }).Count
  if ($letras.Count -gt 3 -and ($mayus / $letras.Count) -gt 0.85) {
    $t = [Globalization.CultureInfo]::GetCultureInfo('es-PE').TextInfo.ToTitleCase($t.ToLowerInvariant())
  }
  return $t
}

$script:CategoriasPorPalabra = [ordered]@{
  'hamburguesa' = 'Hamburguesas'; 'burger' = 'Hamburguesas'; 'cheeseburger' = 'Hamburguesas'
  'pizza' = 'Pizzas'; 'pizzeria' = 'Pizzas'
  'pollo' = 'Pollo a la brasa'; 'brasa' = 'Pollo a la brasa'; 'broaster' = 'Pollo a la brasa'
  'salchipapa' = 'Salchipapas'; 'salchipollo' = 'Salchipapas'
  'papa' = 'Papas y acompañamientos'; 'papas' = 'Papas y acompañamientos'; 'acompañamiento' = 'Papas y acompañamientos'
  'ceviche' = 'Ceviche y mariscos'; 'marisco' = 'Ceviche y mariscos'; 'pescado' = 'Ceviche y mariscos'; 'camaron' = 'Ceviche y mariscos'
  'chifa' = 'Chifa'; 'chaufa' = 'Chifa'; 'tallarin' = 'Chifa'; 'wantan' = 'Chifa'
  'sopa' = 'Sopas'; 'caldo' = 'Sopas'; 'crema' = 'Sopas'
  'ensalada' = 'Ensaladas'
  'postre' = 'Postres y café'; 'torta' = 'Postres y café'; 'helado' = 'Postres y café'; 'cafe' = 'Postres y café'; 'café' = 'Postres y café'
  'gaseosa' = 'Bebidas'; 'bebida' = 'Bebidas'; 'jugo' = 'Bebidas'; 'agua' = 'Bebidas'; 'chicha' = 'Bebidas'; 'refresco' = 'Bebidas'; 'limonada' = 'Bebidas'
  'cerveza' = 'Cervezas'; 'chela' = 'Cervezas'
  'whisky' = 'Whisky'; 'ron' = 'Ron'; 'vodka' = 'Vodka'; 'pisco' = 'Pisco'; 'vino' = 'Vino'
  'combo' = 'Combos'; 'familiar' = 'Combos'
  'extra' = 'Extras'; 'adicional' = 'Extras'; 'complemento' = 'Extras'; 'agregado' = 'Extras'
}

function Sugerir-CategoriaProducto {
  param([string]$Nombre, [string]$Descripcion, [string]$CategoriaLocal = '')
  $t = Normalizar-Texto ($Nombre + ' ' + $Descripcion)
  foreach ($clave in $script:CategoriasPorPalabra.Keys) {
    if ($t -match ('(^|\s)' + [regex]::Escape((Normalizar-Texto $clave)) + '(\s|$)')) {
      return $script:CategoriasPorPalabra[$clave]
    }
  }
  if ($CategoriaLocal) { return $CategoriaLocal }
  return 'Carta'
}

function Test-EncabezadoCategoria {
  param([string]$Texto, [object[]]$Precios)
  if (@($Precios).Count -gt 0) { return $false }
  $t = $Texto.Trim()
  if ($t.Length -lt 2 -or $t.Length -gt 46) { return $false }
  if ($t -match '\d') { return $false }
  if ($t -match '^(carta|menu|menú|lista de precios|precios|delivery|enruta)$') { return $false }
  $letras = @($t.ToCharArray() | Where-Object { [char]::IsLetter($_) })
  if ($letras.Count -eq 0) { return $false }
  $mayus = @($letras | Where-Object { [char]::IsUpper($_) }).Count
  $ratio = $mayus / $letras.Count
  $conocida = $false
  foreach ($clave in $script:CategoriasPorPalabra.Keys) {
    if ((Normalizar-Texto $t) -eq (Normalizar-Texto $clave)) { $conocida = $true; break }
  }
  if ($conocida) { return $true }
  if ($ratio -ge 0.75 -and $t.Split(' ').Count -le 5) { return $true }
  if ($t.EndsWith(':') -and $t.Length -le 40) { return $true }
  return $false
}

function Resolver-Encabezado {
  param([string]$Texto)
  $t = (Limpiar-NombreProducto $Texto).TrimEnd(':').Trim()
  $norm = Normalizar-Texto $t
  foreach ($clave in $script:CategoriasPorPalabra.Keys) {
    $nk = Normalizar-Texto $clave
    # Coincidencia por palabra completa: "BEBIDAS" -> Bebidas, pero "CARTA DEMO" no fuerza categoria.
    if ($norm -eq $nk -or $norm -match ('(^|\s)' + [regex]::Escape($nk) + '(\s|$)')) {
      return [ordered]@{ categoria = [string]$script:CategoriasPorPalabra[$clave]; titulo = $t }
    }
  }
  if ($t.Length -gt 42) { $t = $t.Substring(0, 42).Trim() }
  return [ordered]@{ categoria = ''; titulo = $t }
}

function Es-SeccionExtras {
  param([string]$Categoria)
  $n = Normalizar-Texto $Categoria
  return ($n -match 'extra|adicional|complemento|agregado')
}

function Es-Descripcion {
  param([string]$Texto)
  $t = $Texto.Trim()
  if ($t.Length -lt 6 -or $t.Length -gt 160) { return $false }
  if ($t -match '^[a-záéíóúñ]') { return $true }
  if ($t -match '^(con|incluye|acompa|servido|bañado|relleno|preparado|hecho|elaborado)\b') { return $true }
  if ($t -match '[,;]' -and $t.Split(' ').Count -ge 3) { return $true }
  return $false
}

$script:PalabrasTamano = @(
  'personal', 'familiar', 'mediano', 'mediana', 'grande', 'pequeño', 'pequeña',
  'individual', 'entero', 'entera', 'medio', 'media', 'cuarto', 'jumbo', 'mega',
  'litro', 'litros', 'ml', 'onzas', 'porcion', 'porción', 'unidad', 'unidades'
)

function Buscar-Tamano {
  param([string]$Texto)
  $crudo = Normalizar-Texto $Texto
  $t = Normalizar-Texto $Texto
  foreach ($p in $script:PalabrasTamano) {
    $np = Normalizar-Texto $p
    if ($t -match ('(^|\s)' + [regex]::Escape($np) + '(\s|$)')) { return $p }
  }
  if ($Texto -match '(?i)(^|\s)(1\s*/\s*[24]|x\s*[23])(\s|$)') { return $Matches[2] }
  return ''
}

function Quitar-Tamano {
  param([string]$Texto, [string]$Tamano)
  if (-not $Tamano) { return $Texto }
  $patron = '(?i)\b' + [regex]::Escape($Tamano) + '\b'
  $t = [regex]::Replace($Texto, $patron, '')
  $t = [regex]::Replace($t, '\s{2,}', ' ').Trim(' ', '-', '–', '—', ':')
  return $t
}

function Nuevo-ProductoOcr {
  param(
    [string]$Nombre,
    [double]$Precio,
    [string]$Descripcion,
    [string]$Categoria,
    [string]$LocalId,
    [int]$Pagina,
    [double]$Confianza,
    [string[]]$Dudosos = @(),
    [object[]]$Variantes = @(),
    [object[]]$Extras = @()
  )
  $accionInicial = 'nuevo'
  if (@($Dudosos).Count -gt 0 -or $Precio -le 0) { $accionInicial = 'revisar' }
  return [ordered]@{
    id             = $null
    nombre         = $Nombre
    descripcion    = $Descripcion
    precio         = [Math]::Round($Precio, 2)
    grupo          = $Categoria
    subcategoria   = ''
    variantes      = @($Variantes)
    extras         = @($Extras)
    imagen         = $null
    imagenPendiente = $true
    publicado      = $false
    disponible     = $true
    revisar        = (@($Dudosos).Count -gt 0 -or $Confianza -lt 0.75)
    confianza      = [Math]::Round($Confianza, 2)
    camposDudosos  = @($Dudosos)
    origen         = 'ocr'
    pagina         = $Pagina
    accion         = $accionInicial
    coincidencia   = $null
  }
}

function Analizar-Carta {
  param($Paginas, [string]$LocalId = 'local', [string]$CategoriaLocal = '')
  $productos = @()
  $categoriaActual = ''
  $seccionTitulo = ''
  $modoExtras = $false
  $ultimo = $null
  $pendienteNombre = ''
  $vistos = @{}

  foreach ($pagina in @($Paginas)) {
    $filas = @(Unir-FilasPagina $pagina)
    foreach ($fila in $filas) {
      $texto = ([string]$fila.texto).Trim()
      if ($texto.Length -lt 2) { continue }
      if ($texto -match '^\s*(pag(ina)?\.?\s*)?\d{1,3}\s*$') { continue }
      if ($texto -match '(?i)^(www\.|https?:|tel[eé]fono|whatsapp|direcci[oó]n|s[ií]guenos|instagram|facebook|tiktok)') { continue }

      $precios = @(Extraer-PreciosLinea $texto)
      if (Test-EncabezadoCategoria $texto $precios) {
        $enc = Resolver-Encabezado $texto
        $seccionTitulo = [string]$enc.titulo
        $categoriaActual = [string]$enc.categoria
        $modoExtras = (Es-SeccionExtras $categoriaActual) -or (Es-SeccionExtras $seccionTitulo)
        if ($categoriaActual) { $seccionTitulo = '' }
        $pendienteNombre = ''
        continue
      }

      if ($precios.Count -eq 0) {
        if ($null -ne $ultimo -and (Es-Descripcion $texto) -and [string]::IsNullOrWhiteSpace([string]$ultimo.descripcion)) {
          $ultimo.descripcion = $texto
        } else {
          $pendienteNombre = $texto
        }
        continue
      }

      $categoria = if ($categoriaActual) { $categoriaActual } else { Sugerir-CategoriaProducto $texto '' $CategoriaLocal }

      if ($precios.Count -ge 2) {
        # Varios precios en la misma fila: tallas/variantes o productos distintos.
        $chunks = @()
        $inicio = 0
        for ($i = 0; $i -lt $precios.Count; $i++) {
          $p = $precios[$i]
          $chunks += $texto.Substring($inicio, [Math]::Max(0, $p.indice - $inicio)).Trim()
          $inicio = $p.indice + $p.largo
        }
        $resto = $texto.Substring([Math]::Min($inicio, $texto.Length)).Trim()
        $tamanos = @()
        foreach ($c in $chunks) { $tamanos += (Buscar-Tamano $c) }
        $todosTamano = ($tamanos.Count -gt 0)
        foreach ($t in $tamanos) { if (-not $t) { $todosTamano = $false } }
        $baseNombre = Limpiar-NombreProducto (Quitar-Tamano $chunks[0] $tamanos[0])
        if ($todosTamano -and $baseNombre.Length -ge 3) {
          $variantes = @()
          for ($i = 0; $i -lt $precios.Count; $i++) {
            $etiqueta = (Limpiar-NombreProducto $tamanos[$i])
            if (-not $etiqueta) { $etiqueta = 'Opcion ' + ($i + 1) }
            $variantes += [ordered]@{
              id     = 'v' + ($i + 1)
              nombre = $etiqueta
              precio = [double]$precios[$i].valor
            }
          }
          $prod = Nuevo-ProductoOcr $baseNombre ([double]$precios[0].valor) $resto $categoria $LocalId $fila.pagina 0.82 @() $variantes @()
          $prod.camposDudosos = @('varias presentaciones detectadas: confirma si son variantes')
          $prod.revisar = $false
          $productos += $prod
          $ultimo = $prod
        } else {
          for ($i = 0; $i -lt $precios.Count; $i++) {
            $nombre = Limpiar-NombreProducto $chunks[$i]
            if ([string]::IsNullOrWhiteSpace($nombre) -and $pendienteNombre) { $nombre = Limpiar-NombreProducto $pendienteNombre }
            if ([string]::IsNullOrWhiteSpace($nombre)) { continue }
            $desc = if ($i -eq $precios.Count - 1) { $resto } else { '' }
            $dudosos = @()
            if ($nombre.Length -lt 4) { $dudosos += 'nombre muy corto' }
            $prod = Nuevo-ProductoOcr $nombre ([double]$precios[$i].valor) $desc $categoria $LocalId $fila.pagina 0.8 $dudosos @() @()
            $productos += $prod
            $ultimo = $prod
          }
          $pendienteNombre = ''
        }
        continue
      }

      # Un solo precio.
      $p = $precios[0]
      $antes = $texto.Substring(0, $p.indice).Trim()
      $despues = $texto.Substring([Math]::Min($p.indice + $p.largo, $texto.Length)).Trim()
      $nombre = Limpiar-NombreProducto $antes
      if ($nombre.Length -lt 2 -and $pendienteNombre) {
        $nombre = Limpiar-NombreProducto $pendienteNombre
        $despues = Limpiar-NombreProducto ($antes + ' ' + $despues)
      }
      $pendienteNombre = ''
      if ([string]::IsNullOrWhiteSpace($nombre)) { continue }
      if ($nombre -match '^(precio|precios|total|subtotal|delivery|envio|envío)$') { continue }

      $dudosos = @()
      if ($nombre.Length -lt 4) { $dudosos += 'nombre muy corto' }
      if ([double]$p.valor -gt 999) { $dudosos += 'precio inusualmente alto' }
      if ($despues -and -not (Es-Descripcion $despues) -and $despues.Length -gt 3) {
        # Texto tras el precio que no parece descripcion: puede ser otro producto mal alineado.
        if ($despues -match '^[A-ZÁÉÍÓÚÑ]' -and $despues.Split(' ').Count -ge 2) {
          $dudosos += 'texto adicional despues del precio'
        }
      }
      $descripcion = ''
      if ($despues -and (Es-Descripcion $despues)) { $descripcion = $despues }
      $confianza = 0.9
      if ($dudosos.Count -gt 0) { $confianza = 0.62 }
      $sugerida = Sugerir-CategoriaProducto $nombre $descripcion $CategoriaLocal
      if ($categoriaActual) { $sugerida = $categoriaActual }
      if (-not $categoriaActual -and $seccionTitulo -and $sugerida -eq $CategoriaLocal) { $sugerida = $seccionTitulo }

      if ($modoExtras) {
        # Seccion de extras: se conservan como productos Extras con su precio.
        $prodExtra = Nuevo-ProductoOcr $nombre ([double]$p.valor) $descripcion 'Extras' $LocalId $fila.pagina 0.6 @('producto en seccion de extras: confirma si es extra de otro producto o independiente') @() @()
        $prodExtra.revisar = $true
        $prodExtra.accion = 'revisar'
        $prodExtra.subcategoria = if ($seccionTitulo) { $seccionTitulo } else { 'Extras' }
        $productos += $prodExtra
        $ultimo = $prodExtra
        continue
      }

      $prod = Nuevo-ProductoOcr $nombre ([double]$p.valor) $descripcion $sugerida $LocalId $fila.pagina $confianza $dudosos @() @()
      if (-not $categoriaActual -and $seccionTitulo) { $prod.subcategoria = $seccionTitulo }
      $productos += $prod
      $ultimo = $prod
    }
  }

  # Fusionar filas repetidas exactas dentro de la misma importacion.
  $fusionados = @()
  foreach ($p in $productos) {
    $clave = (Normalizar-Texto $p.nombre) + '|' + (@($p.variantes | ForEach-Object { (Normalizar-Texto $_.nombre) + ':' + $_.precio }) -join ',')
    if ($vistos.ContainsKey($clave)) {
      $existente = $vistos[$clave]
      if ([double]$existente.precio -eq [double]$p.precio) {
        if ($p.descripcion -and -not $existente.descripcion) { $existente.descripcion = $p.descripcion }
        foreach ($e in @($p.extras)) { $existente.extras += $e }
        continue
      }
      $p.revisar = $true
      $p.camposDudosos += 'mismo nombre con otro precio en la carta'
      $p.accion = 'revisar'
    }
    $vistos[$clave] = $p
    $fusionados += $p
  }

  # Asignar ids definitivos y detectar nombres repetidos.
  $contador = 0
  foreach ($p in $fusionados) {
    $contador++
    $slug = Convertir-AId ([string]$p.nombre) ('prod' + $contador)
    if ($slug.Length -gt 36) { $slug = $slug.Substring(0, 36).TrimEnd('-') }
    $p.id = $LocalId + '-' + $slug + '-' + $contador
    if (@($p.camposDudosos).Count -eq 0) { $p.camposDudosos = @() }
  }

  return @($fusionados)
}

function Similitud-Nombres {
  param([string]$A, [string]$B)
  $a = Normalizar-Texto $A
  $b = Normalizar-Texto $B
  if (-not $a -or -not $b) { return 0 }
  if ($a -eq $b) { return 1 }
  if ($a.Contains($b) -or $b.Contains($a)) {
    $menor = [Math]::Min($a.Length, $b.Length)
    $mayor = [Math]::Max($a.Length, $b.Length)
    if ($menor / $mayor -ge 0.6) { return 0.85 }
  }
  $ta = $a.Split(' '); $tb = $b.Split(' ')
  $comunes = @($ta | Where-Object { $tb -contains $_ }).Count
  if ($comunes -eq 0) { return 0 }
  return [Math]::Round(($comunes / [Math]::Max($ta.Count, $tb.Count)) * 0.7, 2)
}

function Marcar-Duplicados {
  param([object[]]$Productos, [object[]]$Existentes)
  foreach ($p in @($Productos)) {
    $mejor = $null
    $mejorSim = 0
    foreach ($e in @($Existentes)) {
      $sim = Similitud-Nombres ([string]$p.nombre) ([string]$e.nombre)
      if ($sim -gt $mejorSim) { $mejorSim = $sim; $mejor = $e }
    }
    if ($null -ne $mejor -and $mejorSim -ge 0.85) {
      $tipo = if ($mejorSim -ge 1) { 'exacto' } else { 'similar' }
      $mismoPrecio = ([double]$mejor.precio -eq [double]$p.precio)
      $p.coincidencia = [ordered]@{
        productoId      = [string]$mejor.id
        nombre          = [string]$mejor.nombre
        precio          = [double]$mejor.precio
        descripcion     = [string]$mejor.descripcion
        variantes       = @($mejor.variantes)
        publicado       = ($mejor.publicado -ne $false)
        tipo            = $tipo
        mismoPrecio     = $mismoPrecio
      }
      if (-not $mismoPrecio) {
        $p.revisar = $true
        if (@($p.camposDudosos) -notcontains 'posible duplicado con otro precio') {
          $p.camposDudosos += 'posible duplicado con otro precio'
        }
      }
      if ($p.accion -eq 'nuevo') { $p.accion = 'revisar' }
    }
  }
  return @($Productos)
}

function Validar-ProductoImportado {
  param($Producto)
  $errores = @()
  if ([string]::IsNullOrWhiteSpace([string]$Producto.nombre)) { $errores += 'sin nombre' }
  $precio = Convertir-Numero $Producto.precio
  if ($null -eq $precio -or $precio -le 0) {
    $errores += 'sin precio valido'
  }
  if ([string]::IsNullOrWhiteSpace([string]$Producto.grupo)) { $errores += 'sin categoria' }
  foreach ($v in @($Producto.variantes)) {
    $pv = Convertir-Numero $v.precio
    if ($null -eq $pv -or $pv -le 0) { $errores += "variante '$($v.nombre)' sin precio" }
  }
  return $errores
}
