# ============================================================
#  EnRuta Delivery · Importar catálogo desde Tambo.pe
#  ------------------------------------------------------------
#  Lee las páginas públicas de categorías de tambo.pe y usa el
#  bloque estructurado __remixContext (datos SSR) para obtener:
#
#    - nombre y presentación
#    - precio vigente y precio regular
#    - disponibilidad real
#    - categorías de Tambo
#    - imagen oficial en alta resolución
#    - descripción, cuando existe
#
#  Integra los productos en:
#    data/primera-necesidad/productos.json
#    data/licores/productos.json
#
#  Reglas:
#   - No inventa precios ni stock: solo usa lo publicado.
#   - No borra productos existentes.
#   - No duplica por marca + producto + presentación.
#   - Guarda tienda, URL, id y fecha de consulta.
#   - El precio de venta queda igual a la referencia y marcado
#     como "referencia-tambo": la web lo muestra como referencial
#     y el pedido se confirma por WhatsApp.
#
#  Uso:
#    powershell -ExecutionPolicy Bypass -File tools\importar-tambo.ps1 -Simular
#    powershell -ExecutionPolicy Bypass -File tools\importar-tambo.ps1
#    powershell -ExecutionPolicy Bypass -File tools\importar-tambo.ps1 -SinImportar
#    powershell -ExecutionPolicy Bypass -File tools\importar-tambo.ps1 -SinDescargar
# ============================================================

param(
  [switch]$Simular,
  [switch]$SinImportar,
  [switch]$SinDescargar
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Web.Extensions

$root     = Split-Path -Parent $PSScriptRoot
$dataDir  = Join-Path $root 'data'
$cacheDir = Join-Path ([IO.Path]::GetTempPath()) 'enruta-tambo-cache'
$ua       = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
$hoy      = Get-Date -Format 'yyyy-MM-dd'
$utf8     = New-Object System.Text.UTF8Encoding($false)
$marcador = '__remixContext = '
$serializador = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializador.MaxJsonLength = 200000000

New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null

# ------------------------------------------------------------
#  Fuentes: categorías completas de Tambo (no solo la primera página)
# ------------------------------------------------------------
$paginas = @(
  @{ slug = 'bebidas';  base = 'bebidas';  ruta = '/pedir/categoria/bebidas/9EbkAvNaqaWPprwJ7' }
  @{ slug = 'cervezas'; base = 'cerveza';  ruta = '/pedir/categoria/cervezas/GX3Bu87ww9CWXK5XY' }
  @{ slug = 'licores';  base = 'licor';    ruta = '/pedir/categoria/licores/hqe47peqQQPJDGk9D' }
  @{ slug = 'rtds';     base = 'rtd';      ruta = '/pedir/categoria/rtds/j2FjNSjDuqcXWjnPB' }
  @{ slug = 'snacks';   base = 'snacks';   ruta = '/pedir/categoria/snacks-confiteria/jPBNxZZ8qwwMrdrKb' }
  @{ slug = 'despensa'; base = 'abarrotes';ruta = '/pedir/categoria/despensa/5gSmKE2b3w48nYSsX' }
  @{ slug = 'helados';  base = 'helados';  ruta = '/pedir/categoria/helados/uyZqgDRzCpBnHRTf3' }
)

$nombresCategorias = [ordered]@{
  'bebidas'   = 'Bebidas'
  'snacks'    = 'Snacks'
  'golosinas' = 'Golosinas y chocolates'
  'galletas'  = 'Galletas y dulces'
  'helados'   = 'Helados'
  'lacteos'   = 'Lácteos'
  'abarrotes' = 'Abarrotes'
  'desayuno'  = 'Desayuno'
  'panaderia' = 'Panadería y repostería'
  'limpieza'  = 'Limpieza'
  'higiene'   = 'Higiene personal'
  'mascotas'  = 'Mascotas'
  'otros'     = 'Otros productos'
  'whisky'    = 'Whisky'
  'ron'       = 'Ron'
  'vodka'     = 'Vodka'
  'pisco'     = 'Pisco'
  'vino'      = 'Vino'
  'cerveza'   = 'Cerveza'
  'rtd'       = 'RTD y cócteles'
  'licor'     = 'Licores y aperitivos'
}

# Cuotas por categoría: catálogo amplio sin volver la página inmanejable.
$cuotas = [ordered]@{
  bebidas = 28; cerveza = 12; whisky = 8; ron = 8; vodka = 5; pisco = 5; vino = 5; rtd = 9; licor = 7
  snacks = 22; golosinas = 16; galletas = 12; helados = 8; lacteos = 11; abarrotes = 22
  desayuno = 9; limpieza = 6; higiene = 9; panaderia = 5; mascotas = 5; otros = 4
}

$ordenNec = @('bebidas','snacks','golosinas','galletas','helados','lacteos','abarrotes','desayuno','panaderia','limpieza','higiene','mascotas','otros')
$ordenLic = @('whisky','ron','vodka','pisco','cerveza','vino','rtd','licor')

# ------------------------------------------------------------
#  Utilidades de texto y precios
# ------------------------------------------------------------
function Escribir-Json {
  param([string]$Ruta, $Objeto)
  $json = $Objeto | ConvertTo-Json -Depth 30
  $json = [regex]::Replace($json, '\\u([0-9a-fA-F]{4})', {
    param($m)
    [string][char][Convert]::ToInt32($m.Groups[1].Value, 16)
  })
  [IO.File]::WriteAllText($Ruta, $json + "`n", $utf8)
}

function Limpiar-Texto {
  param([string]$Texto)
  if ($null -eq $Texto) { return '' }
  $s = $Texto -replace '\r', ' ' -replace '\n', ' '
  $s = [regex]::Replace($s, '\s+', ' ').Trim()
  return $s
}

function Normalizar {
  param([string]$Texto)
  if ($null -eq $Texto) { return '' }
  $s = $Texto.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
  $s = [regex]::Replace($s, '\p{Mn}', '')
  $s = [regex]::Replace($s, '[^a-z0-9]+', ' ')
  return ($s -replace '\s+', ' ').Trim()
}

# Compara marcas ignorando apóstrofos, puntos y espacios:
# "Ballantine's" y "Ballantines" deben ser la misma marca.
function Compactar {
  param([string]$Texto)
  if ($null -eq $Texto) { return '' }
  $s = $Texto.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
  $s = [regex]::Replace($s, '\p{Mn}', '')
  return [regex]::Replace($s, '[^a-z0-9]+', '')
}

# Conserva puntos, comas y la letra x para poder leer "1.5 L", "6 x 390 g".
function Normalizar-Suave {
  param([string]$Texto)
  if ($null -eq $Texto) { return '' }
  $s = $Texto.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
  $s = [regex]::Replace($s, '\p{Mn}', '')
  $s = $s.Replace([char]0x00D7, 'x')
  $s = [regex]::Replace($s, '[^a-z0-9\.,x]+', ' ')
  return ($s -replace '\s+', ' ').Trim()
}

function Convertir-Unidad {
  param([string]$Unidad)
  switch ($Unidad.ToLowerInvariant()) {
    'l'   { return 'l' }
    'lt'  { return 'l' }
    'lts' { return 'l' }
    'gr'  { return 'g' }
    'unid' { return 'und' }
    'ud'   { return 'und' }
    'uds'  { return 'und' }
    'unidad' { return 'und' }
    'unidades' { return 'und' }
    'rollo' { return 'und' }
    'rollos' { return 'und' }
    default { return $Unidad.ToLowerInvariant() }
  }
}

function Convertir-Precio {
  param($Valor)
  if ($null -eq $Valor) { return $null }
  $texto = [string]$Valor
  $limpio = $texto -replace '[^\d,\.]', ''
  if ([string]::IsNullOrWhiteSpace($limpio)) { return $null }
  if ($limpio.Contains(',') -and $limpio.Contains('.')) { $limpio = $limpio.Replace(',', '') }
  elseif ($limpio.Contains(',')) { $limpio = $limpio.Replace(',', '.') }
  $numero = 0.0
  if ([double]::TryParse($limpio, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$numero)) {
    if ($numero -gt 0) { return [Math]::Round($numero, 2) }
  }
  return $null
}

function Obtener-Presentacion {
  param([string]$Nombre)
  $n = Normalizar-Suave $Nombre
  $unidad = '(ml|l|lt|lts|g|gr|kg|und|unid|unidades?|uds?|rollos?)'

  $m = [regex]::Match($n, '^(\d+)\s*(?:und|unid|unidades?)\b[^x]{0,45}x\s*(\d+(?:[.,]\d+)?)\s*' + $unidad)
  if ($m.Success) { return (("{0} und · {1} {2}" -f $m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value).Trim()) }

  $m = [regex]::Match($n, '(six\s*pack|four\s*pack|pack\s*\d+)[^x]{0,30}x\s*(\d+(?:[.,]\d+)?)\s*' + $unidad)
  if ($m.Success) {
    $pack = ($m.Groups[1].Value -replace '\s+', ' ')
    return (("{0} · {1} {2}" -f $pack, $m.Groups[2].Value, $m.Groups[3].Value).Trim())
  }

  $m = [regex]::Match($n, '(\d+)\s*(latas?|botellas?|sobres?|unidades?|tarros?)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*' + $unidad)
  if ($m.Success) { return (("{0} {1} · {2} {3}" -f $m.Groups[1].Value, $m.Groups[2].Value, $m.Groups[3].Value, $m.Groups[4].Value).Trim()) }

  $m = [regex]::Match($n, '(?:x)\s*(\d+(?:[.,]\d+)?)\s*' + $unidad)
  if ($m.Success) { return (("{0} {1}" -f $m.Groups[1].Value, (Convertir-Unidad $m.Groups[2].Value)).Trim()) }

  $m = [regex]::Match($n, '\b(\d+(?:[.,]\d+)?)\s*' + $unidad + '\b')
  if ($m.Success) { return (("{0} {1}" -f $m.Groups[1].Value, (Convertir-Unidad $m.Groups[2].Value)).Trim()) }

  return ''
}

function Obtener-Tamanos {
  param([string]$Texto)
  $s = Normalizar-Suave $Texto
  $res = New-Object System.Collections.ArrayList
  $unidad = '(ml|l|lt|lts|g|gr|kg|und|unid|unidades?|uds?|rollos?)'

  $m = [regex]::Match($s, '^(\d+)\s*(?:und|unid|unidades?)\b')
  if ($m.Success) {
    $tam = [regex]::Match($s, '(\d+(?:[.,]\d+)?)\s*(ml|l|lt|lts|g|gr|kg)')
    if ($tam.Success) {
      $u = Convertir-Unidad $tam.Groups[2].Value
      [void]$res.Add(("{0}x{1}{2}" -f [int]$m.Groups[1].Value, ($tam.Groups[1].Value -replace ',', '.'), $u))
    }
  }

  foreach ($m in [regex]::Matches($s, '(\d+)\s*x\s*(\d+(?:[.,]\d+)?)\s*' + $unidad)) {
    $u = Convertir-Unidad $m.Groups[3].Value
    [void]$res.Add(("{0}x{1}{2}" -f [int]$m.Groups[1].Value, ($m.Groups[2].Value -replace ',', '.'), $u))
  }

  foreach ($m in [regex]::Matches($s, '(\d+)\s*(?:latas?|botellas?|sobres?|unidades?|tarros?)\s*(?:de\s*)?(\d+(?:[.,]\d+)?)\s*' + $unidad)) {
    $u = Convertir-Unidad $m.Groups[3].Value
    [void]$res.Add(("{0}x{1}{2}" -f [int]$m.Groups[1].Value, ($m.Groups[2].Value -replace ',', '.'), $u))
  }

  foreach ($m in [regex]::Matches($s, '(?:six|four|pack)\s*(?:pack)?\s*(?:de\s*)?(\d+)?\s*(?:x|por)\s*(\d+(?:[.,]\d+)?)\s*' + $unidad)) {
    $n = 1
    if ($m.Groups[1].Success -and $m.Groups[1].Value) { $n = [int]$m.Groups[1].Value }
    elseif ($s -match '\bsix\b') { $n = 6 }
    elseif ($s -match '\bfour\b') { $n = 4 }
    $u = Convertir-Unidad $m.Groups[3].Value
    if ($n -gt 1) { [void]$res.Add(("{0}x{1}{2}" -f $n, ($m.Groups[2].Value -replace ',', '.'), $u)) }
    else { [void]$res.Add((("{0}{1}" -f ($m.Groups[2].Value -replace ',', '.'), $u))) }
  }

  if ($res.Count -eq 0) {
    $m = [regex]::Match($s, '(\d+(?:[.,]\d+)?)\s*' + $unidad + '\b')
    if ($m.Success) {
      $u = Convertir-Unidad $m.Groups[2].Value
      [void]$res.Add((("{0}{1}" -f ($m.Groups[1].Value -replace ',', '.'), $u)))
    }
  }

  return (($res | Sort-Object -Unique) -join '+')
}

function Extraer-Nucleo {
  param([string]$Nombre, [string]$Presentacion, [string]$Marca)
  $s = Normalizar-Suave ($Nombre + ' ' + $Presentacion)
  if (-not [string]::IsNullOrWhiteSpace($Marca)) {
    $m = Normalizar-Suave $Marca
    if ($m) { $s = $s.Replace($m, ' ') }
  }
  $s = [regex]::Replace($s, '\d+(?:[.,]\d+)?\s*(?:ml|l|lt|lts|g|gr|kg|und|unid|unidades?|rollos?)\b', ' ')
  $s = [regex]::Replace($s, '\b\d+\s*x\s*\d+(?:[.,]\d+)?\b', ' ')
  $s = [regex]::Replace($s, '\b(?:six|four|pack|packs|botella|botellas|bolsa|bolsas|paquete|paquetes|lata|latas|tarro|tarros|unidad|unidades|sobre|sobres|frasco|frascos|caja|cajas|dispensador|conserva|trozos|solido|solida|de|del|la|el|los|las|x|por|und|unid|rollos?)\b', ' ')
  $s = [regex]::Replace($s, '^\d+\s+', ' ')
  $s = [regex]::Replace($s, '[^a-z0-9]+', ' ')
  return ($s -replace '\s+', ' ').Trim()
}

# ------------------------------------------------------------
#  Marcas conocidas (se amplía con las que aparezcan en Tambo)
# ------------------------------------------------------------
$marcasConocidas = @(
  'Coca-Cola','Inca Kola','Pepsi','Sprite','Fanta','San Luis','Cielo','San Mateo','San Carlos','Fontlife','Loa','Evervess','Schweppes','Backus',
  'Cusqueña','Pilsen','Cristal','Heineken','Corona','Budweiser','Tres Cruces','Paceña','Amstel','Miller','Stella Artois','Red Bull','Monster',
  'Speed','Volt','Gatorade','Powerade','Sporade','Free Tea','Frugos','Pulp','Tampico','Cifrut','Gloria','Laive','Pil','Nestlé','Soy Vida',
  'Pura Vida','Villa Natura','Winters','Amayu','Hey Fit','Hula','Ecco','Milo','Nesquik','Ovaltine','Chicolac','Danlac',
  'Johnnie Walker','Ballantine''s','Buchanan''s','Chivas Regal','Jack Daniel''s','Jägermeister','Jagermeister','Absolut','Smirnoff','Belvedere',
  'Grey Goose','Flor de Caña','Havana Club','Cartavio','Bacardí','Bacardi','Tabernero','Santiago Queirolo','Queirolo','Portón','Porton','Four Loko',
  'Mike''s','Piscano','Russkaya','Kick The Rules','Viña Vieja','Intipalka','Tacama','Ocucaje','Vista Alegre','José Cuervo','Jose Cuervo','Sauza',
  'Beefeater','Tanqueray','Bombay Sapphire','Gordon''s','Hendrick''s','Malibu','Campari','Aperol','Baileys','Kahlúa','Kahlua','Underberg','Limoncello',
  'Ciroc','Skyy','Stolichnaya','Ketel One','Finlandia','Tito''s','Wild Turkey','Jim Beam','Maker''s Mark','Bulleit','Woodford','Glenfiddich',
  'Glenlivet','Macallan','Jameson','Tullamore Dew','Bushmills','Canadian Club','Crown Royal','Seagram''s','Old Parr','White Horse','Vat 69',
  'Grant''s','Famous Grouse','Dewar''s','Teacher''s','Cutty Sark','Passport','100 Pipers','Sir Edwards','Sandy Mac','McDowell''s','Bagpiper',
  'Antiquity','Blenders Pride','Royal Stag','Officer''s Choice','Something Special','The Glenlivet','Cuatro Gallos','Pilsen Callao','Arequipeña',
  'San Juan','Pilsen Trujillo','Golden','Huari','Potosina','Kuntsmann','Austral','Calafate',
  'Lay''s','Lays','Pringles','Doritos','Cheetos','Chizitos','Jappy','Karinto','Piqueo','Bimbo','Oreo','Ritz','Crackers','Field','Wafer','Obsesión',
  'Obsesion','Bon o Bon','Snickers','Twix','Sublime','Princesa','La Ibérica','La Iberica','Fini','Halls','Trident','Tic Tac','Glacitas','Tentación',
  'Tentacion','San Jorge','Casino','D''Onofrio','Donofrio','Ferrero','Kinder','Nutella','Hershey''s','Cadbury','Milka','Lindt','Toblerone',
  'Skittles','Starburst','Mentos','Chips Ahoy','Club Social','Animalitos','Margarita','Sayón','Sayon','Dulfina','Sweet Bites','Mr Beast','Feastables',
  'Popflix','Granuts','Voraz','Cuates','Maní','Mani','San Fernando','Bells','Bell''s','Real','Campomar','Florida','Aje','Ajinomen','Nissin',
  'Shin Ramyun','Maruchan','Wantan','Lavaggi','Espiga de Oro','Blanca Flor','Alianza','La Favorita','Capri','Montalvo','Universal','Royal','Yelmo',
  'Alacena','Aji-no-moto','Ajinomoto','Maggi','Knorr','Hellmann''s','Sibarita','Primor','Alicorp','Molitalia','Don Vittorio','Nicolini','Costeño',
  'Costeno','Paisana','Sullana','Paramonga','San Jacinto','Pomalca','Tumán','Tuman','Moche','Casa Grande','Altomayo','Kirby','Nescafé','Nescafe',
  'Marsella','Sapolio','Ayudín','Ayudin','Clorox','Bolívar','Bolivar','Ariel','Ace','Downy','Suavitel','Comfort','Fab','Tide','Persil','Omo','Skip',
  'Rinso','Vanish','Poett','Glade','Air Wick','Higienol','Scott','Paracas','Noble','Elite','Suave','Baby Dove','Huggies','Plenitud','Colgate','Oral-B',
  'Pantene','Head & Shoulders','Sedal','Dove','Rexona','Axe','Nivea','Gillette','Gillette Venus','Protex','Palmolive','Lux','Camay','Johnson''s',
  'Johnsons','Ponds','L''Oréal','Loreal','Garnier','Vogue','Unique','Yanbal','Ésika','Esika','Cyzone','Avon','Natura',
  'Ricocan','Ricocat','Gati','Pedigree','Dog Chow','Cat Chow','Proplan','Hills','Whiskas','Friskies','Felix','Purina','Champion','Mimaskot','Canbo',
  'Nutrapro','Super Can','Super Cat','Tambo','Panettiere','Psyco','Casa Verde','Saborissima','Saborisima','Mc Colins','McColins','Vive Day',
  'Life SOS','La Calera','Bio Amayu'
)

# Marcas adicionales detectadas en el catálogo público de Tambo.
$marcasConocidas += @(
  'Coronita','Michelob','Michelob Ultra','Flying Fish','Jack Daniels','Grants','8 PM','8PM','Ballantines','Dos Maderos','Captain Morgan',
  'Vernost','Embajador','Altos del Sur','Trapiche','Maniak','Wild','Vizzio','Kit Kat','HH Mix','M&M','Reese''s','Reeses','Montblanc',
  'Milky Way','Hablando Huevadas','Chin Chin','Morochas','Nutri Co','Choko Soda','Arcor','Dore','Picaras','Frio Rico','Grand Prix',
  'Vakimú','Vakimu','Lipton','Flashlyte','Dilyte','Score','Coolife','Guarana','Guaraná','Coca Cola','Piqueo Snax','Chifles','Platanitos',
  'Inka Chips','Naturitas','Cua Cua','Marinela','Gansito','Negrito','Chocoramo','Ramo','Colombina','Jet','Jumbo','Mentu','Mentos',
  'Hershey','Bon Bon','Bembos','Pardos','Roky''s','Costa','Cua Cua','Cereal Bar','Vive Day','Life SOS','La Calera','Bio Amayu',
  'Casa Verde','Saborissima','Mc Colins','Panettiere','Psyco','Tambo','Piscano','Kick The Rules','Russkaya','Hey Fit','Hula','Loa',
  'San Carlos','Fontlife','Free Tea','Sporade','Volt','Speed','Amstel','Paceña','Tres Cruces','Corona','Budweiser','Miller','Stella Artois'
)

# Marcas que aparecen en el catálogo de Tambo y faltaban en la lista base.
$marcasConocidas += @(
  'Epic','Seven Up','7Up','Suerox','VoL','Mogu Mogu','Pardal','Caballero de Castilla','Hit','Takis','Cheese Tris','Act II',
  'Manicho','Tostitos','Kryzpo','Charada','Rellenitas','Chomp','Victoria','Gelático','Gelatico','Donito','Tigo','Bonlé','Bonle',
  'Compass','Tari','Nongshim','Corazón del Fundo','Corazon del Fundo','Braedt','Sello Rojo','Durex','Gillette','Gillete',
  'San José','San Jose','PYC','Doguitos','Rex','Kissito','La Calera','Bimbo','Marinela','Pinguino','Pinguino','Bembos',
  'Kellogg''s','Kelloggs','Angel','Chaplin','Gretel','Travesura','Bimbolete','Alaska','Integrakers','Secret','Chocolisto',
  'H&S','Dogchow','Bio','Doña Pepa','Dona Pepa','La Vita','Butter Cookies','Chocodonuts','Black Out','Pepero','Frac','Crackelet','Chocobum','Peziduri','Yamboly','Invite','Corazón del Mar','Corazon del Mar','Redondos'
)


$mapaMarcas = @{}
foreach ($m in $marcasConocidas) {
  $clave = Normalizar $m
  if ($clave -and -not $mapaMarcas.ContainsKey($clave)) { $mapaMarcas[$clave] = $m }
}
$marcasOrdenadas = @($mapaMarcas.Keys | Sort-Object { $_.Length } -Descending)

function Obtener-Marca {
  param([string]$Nombre, $Producto)
  if ([string]::IsNullOrWhiteSpace($Nombre)) { return '' }
  $n = Normalizar $Nombre
  foreach ($clave in $marcasOrdenadas) {
    if ($n -match ('(^| )' + [regex]::Escape($clave) + '( |$)')) { return $mapaMarcas[$clave] }
  }
  # Si el nombre no la trae, se usa un nickname solo cuando coincide
  # exactamente con una marca conocida (evita inferencias inventadas).
  if ($null -ne $Producto) {
    foreach ($nick in @($Producto['nicknames'])) {
      $clave = Normalizar ([string]$nick)
      if ($clave -and $mapaMarcas.ContainsKey($clave)) { return $mapaMarcas[$clave] }
    }
  }
  return ''
}

# ------------------------------------------------------------
#  Deduplicación por marca + núcleo del nombre + presentación
# ------------------------------------------------------------
function Nuevo-Indice {
  $lista = New-Object System.Collections.ArrayList
  return ,$lista
}

function Agregar-AlIndice {
  param($Indice, [string]$Id, [string]$Marca, [string]$Nombre, [string]$Presentacion)
  [void]$Indice.Add([pscustomobject]@{
    id      = $Id
    marca   = (Compactar $Marca)
    nucleo  = (Extraer-Nucleo $Nombre $Presentacion $Marca)
    tamanos = (Obtener-Tamanos ($Nombre + ' ' + $Presentacion))
  })
}

function Buscar-Duplicado {
  param($Indice, [string]$Marca, [string]$Nombre, [string]$Presentacion)
  $b = Compactar $Marca
  $n = Extraer-Nucleo $Nombre $Presentacion $Marca
  $t = Obtener-Tamanos ($Nombre + ' ' + $Presentacion)
  if ([string]::IsNullOrWhiteSpace($n)) { return $null }
  $tokens = @($n -split ' ' | Where-Object { $_ })
  foreach ($it in $Indice) {
    if ($it.tamanos -ne $t) { continue }
    if ($b -and $it.marca -and $b -ne $it.marca) { continue }
    if (-not $b -or -not $it.marca) {
      if ($it.nucleo -eq $n) { return $it.id }
      continue
    }
    if ($it.nucleo -eq $n) { return $it.id }
    $a = @($it.nucleo -split ' ' | Where-Object { $_ })
    if ($tokens.Count -ge 2 -and $a.Count -ge 2) {
      $inter = @($tokens | Where-Object { $a -contains $_ })
      if ($inter.Count -ge 2 -and ($inter.Count -eq $tokens.Count -or $inter.Count -eq $a.Count)) { return $it.id }
    }
  }
  return $null
}

# ------------------------------------------------------------
#  Descarga y lectura del bloque SSR de Tambo
# ------------------------------------------------------------
function Descargar-Pagina {
  param([string]$Slug, [string]$Ruta)
  $archivo = Join-Path $cacheDir ($Slug + '.html')
  if (-not $SinDescargar -and (-not (Test-Path -LiteralPath $archivo) -or (Get-Item -LiteralPath $archivo).Length -lt 100000)) {
    $url = 'https://www.tambo.pe' + $Ruta
    $code = & curl.exe -s -o $archivo -w "%{http_code}" --max-time 60 -L -H "User-Agent: $ua" -H "Accept-Language: es-PE,es;q=0.9" $url
    if ($code -ne '200') { return $null }
  }
  if (-not (Test-Path -LiteralPath $archivo)) { return $null }
  if ((Get-Item -LiteralPath $archivo).Length -lt 100000) { return $null }
  return $archivo
}

function Leer-Contexto {
  param([string]$Html)
  $i = $Html.IndexOf($marcador)
  if ($i -lt 0) { return $null }
  $inicio = $i + $marcador.Length
  $fin = $Html.IndexOf('</script>', $inicio)
  if ($fin -lt 0) { return $null }
  $json = $Html.Substring($inicio, $fin - $inicio).TrimEnd().TrimEnd(';')
  try {
    return $serializador.DeserializeObject($json)
  } catch {
    return $null
  }
}

function Obtener-Productos {
  param($Contexto)
  if ($null -eq $Contexto) { return @() }
  $ld = $Contexto['state']['loaderData']
  if ($null -eq $ld) { return @() }
  foreach ($k in $ld.Keys) {
    $v = $ld[$k]
    if ($v -is [System.Collections.IDictionary] -and $v.ContainsKey('categoryData')) {
      $cd = $v['categoryData']
      if ($cd -is [System.Collections.IDictionary] -and $cd.ContainsKey('products')) {
        return @($cd['products'].Values)
      }
    }
  }
  return @()
}

# ------------------------------------------------------------
#  Clasificación Tambo -> categorías de EnRuta
# ------------------------------------------------------------
function Clasificar-Producto {
  param($Producto, [string]$Base)
  $n = Normalizar ([string]$Producto['name'])
  $cats = @()
  foreach ($c in @($Producto['categories'])) {
    if ($null -ne $c -and $c -is [System.Collections.IDictionary] -and $c.ContainsKey('name')) {
      $cats += (Normalizar ([string]$c['name']))
    }
  }
  $cs = ' ' + ($cats -join ' | ') + ' '

  if ($cs -match ' hielo ') { return 'hielo' }
  if ($cs -match ' packs ') { return 'pack' }

  if ($cs -match ' whisky ') { return 'whisky' }
  if ($cs -match ' ron ') { return 'ron' }
  if ($cs -match ' vodka ') { return 'vodka' }
  if ($cs -match ' pisco ') { return 'pisco' }
  if ($cs -match ' vinos y espumantes ') { return 'vino' }
  if ($cs -match ' cervezas ') { return 'cerveza' }
  if ($cs -match ' rtds | rtd listo para tomar ') { return 'rtd' }
  if ($cs -match ' mas licores | mundo cartavio | mundo diageo ') {
    if ($cs -match ' mundo cartavio ') { return 'ron' }
    if ($n -match 'whisky') { return 'whisky' }
    if ($n -match '\bron\b') { return 'ron' }
    if ($n -match 'vodka') { return 'vodka' }
    if ($n -match 'pisco') { return 'pisco' }
    if ($n -match 'vino|espumante') { return 'vino' }
    if ($n -match 'cerveza') { return 'cerveza' }
    if ($n -match 'rtd|coctel') { return 'rtd' }
    return 'licor'
  }

  if ($cs -match ' lacteos ') { return 'lacteos' }
  if ($cs -match ' cuidado personal ') { return 'higiene' }
  if ($cs -match ' mascotas ') { return 'mascotas' }
  if ($cs -match ' panaderia reposteria ') { return 'panaderia' }

  if ($cs -match ' galletas ') { return 'galletas' }
  if ($cs -match ' chocolates | golosinas | postre ') {
    if ($n -match 'papas|chizito|tortilla|nacho|piqueo|mani|castana|arandano|frutos secos|fruto seco|granola|barra de cereal|aros|chifle|platanito|habas|cancha|palomita|pop corn|cueritos|salchicha|chorizo|aceituna|queso') { return 'snacks' }
    if ($n -match 'galleta|wafer|alfajor|queque|torta|barquillo') { return 'galletas' }
    return 'golosinas'
  }
  if ($cs -match ' confiteria ') {
    if ($n -match 'papas|chizito|tortilla|nacho|piqueo|mani|castana|arandano|frutos secos|fruto seco|granola|barra de cereal|aros|chifle|platanito|habas|cancha|palomita|pop corn|cueritos|salchicha|chorizo|aceituna|queso') { return 'snacks' }
    if ($n -match 'galleta|wafer|alfajor|queque|torta|barquillo') { return 'galletas' }
    return 'golosinas'
  }
  if ($cs -match ' snacks | frutos secos | pop corn | canchita | antojos tambo ') {
    if ($n -match 'chocolate|caramelo|gomita|chupetin|bombon|masmelo|marshmallow') { return 'golosinas' }
    if ($n -match 'galleta|wafer|alfajor|queque|torta') { return 'galletas' }
    return 'snacks'
  }
  if ($cs -match ' helados | helados tambo | personales | para compartir ') { return 'helados' }
  if ($cs -match ' bebidas ') {
    if ($n -match 'cerveza') { return 'cerveza' }
    return 'bebidas'
  }
  if ($cs -match ' comidas ') { return 'otros' }
  if ($cs -match ' despensa | cocina | otros ') {
    if ($n -match 'detergente|lejia|lavavajilla|limpiador|desinfectante|suavizante|papel higienico|bolsa de basura|escoba|trapeador|fregado|multiusos|ambientador|quitamanchas|vanish|cloro|lavavajillas') { return 'limpieza' }
    if ($n -match 'shampoo|jabon|pasta dental|crema dental|desodorante|cepillo|afeitar|toalla higienica|panal|papel higienico|enjuague bucal|acondicionador|crema corporal|protector solar') { return 'higiene' }
    if ($n -match 'cafe|cereal|avena|mermelada|infusion|manzanilla|anis|\bte\b|azucar|miel|mantequilla de mani|chocolate para taza|granola|huevo') { return 'desayuno' }
    if ($n -match 'galleta|wafer|alfajor|queque|torta|postre|gelatina') { return 'galletas' }
    if ($n -match 'chocolate|caramelo|gomita|chupetin|bombon|masmelo|marshmallow') { return 'golosinas' }
    if ($n -match 'papas|snack|chizito|tortilla|nacho|piqueo|frutos secos|mani|castana|arandano|granola|aros|chifle|platanito|habas|cancha|palomita') { return 'snacks' }
    return 'abarrotes'
  }

  switch ($Base) {
    'whisky'  { return 'whisky' }
    'ron'     { return 'ron' }
    'vodka'   { return 'vodka' }
    'pisco'   { return 'pisco' }
    'vino'    { return 'vino' }
    'cerveza' { return 'cerveza' }
    'rtd'     { return 'rtd' }
    'licor' {
      if ($n -match 'whisky') { return 'whisky' }
      if ($n -match '\bron\b') { return 'ron' }
      if ($n -match 'vodka') { return 'vodka' }
      if ($n -match 'pisco') { return 'pisco' }
      if ($n -match 'vino|espumante') { return 'vino' }
      if ($n -match 'cerveza') { return 'cerveza' }
      if ($n -match 'rtd|coctel') { return 'rtd' }
      return 'licor'
    }
    'bebidas'   { return 'bebidas' }
    'helados'   { return 'helados' }
    'lacteos'   { return 'lacteos' }
    'mascotas'  { return 'mascotas' }
    'panaderia' { return 'panaderia' }
    'snacks' {
      if ($n -match 'chocolate|caramelo|gomita|chupetin|bombon') { return 'golosinas' }
      if ($n -match 'galleta|wafer|alfajor|queque|torta') { return 'galletas' }
      return 'snacks'
    }
    default {
      if ($n -match 'detergente|lejia|limpiador|suavizante|papel higienico|bolsa') { return 'limpieza' }
      if ($n -match 'shampoo|jabon|desodorante|pasta dental|panal') { return 'higiene' }
      return 'abarrotes'
    }
  }
}

# ------------------------------------------------------------
#  Catálogo actual (fuente de verdad, no se borra)
# ------------------------------------------------------------
$rutaNec  = Join-Path $dataDir 'primera-necesidad\productos.json'
$rutaLic  = Join-Path $dataDir 'licores\productos.json'
$rutaCatN = Join-Path $dataDir 'primera-necesidad\categorias.json'
$rutaCatL = Join-Path $dataDir 'licores\categorias.json'

$docNec = Get-Content -LiteralPath $rutaNec -Raw -Encoding UTF8 | ConvertFrom-Json
$docLic = Get-Content -LiteralPath $rutaLic -Raw -Encoding UTF8 | ConvertFrom-Json
$catNec = Get-Content -LiteralPath $rutaCatN -Raw -Encoding UTF8 | ConvertFrom-Json
$catLic = Get-Content -LiteralPath $rutaCatL -Raw -Encoding UTF8 | ConvertFrom-Json

$indice = Nuevo-Indice
$idsUsados = @{}
foreach ($p in @($docNec.productos) + @($docLic.productos)) {
  Agregar-AlIndice $indice ([string]$p.id) ([string]$p.marca) ([string]$p.nombre) ([string]$p.presentacion)
  $idsUsados[[string]$p.id] = $true
}

# ------------------------------------------------------------
#  Descarga de categorías y armado del pool único
# ------------------------------------------------------------
Write-Host ''
Write-Host 'EnRuta Delivery · importando catálogo desde Tambo.pe' -ForegroundColor Yellow
Write-Host "Fecha de consulta: $hoy" -ForegroundColor DarkGray
if ($Simular) { Write-Host 'MODO SIMULACIÓN: no se modifica el catálogo.' -ForegroundColor DarkYellow }
Write-Host ''

$pool = @{}
$statsPaginas = New-Object System.Collections.ArrayList
$paginasOk = 0
$paginasError = 0

foreach ($pag in $paginas) {
  $archivo = Descargar-Pagina $pag.slug $pag.ruta
  if ($null -eq $archivo) {
    Write-Host ("  x {0}: no se pudo descargar" -f $pag.slug) -ForegroundColor Red
    $paginasError++
    [void]$statsPaginas.Add([ordered]@{ pagina = $pag.slug; estado = 'error'; productos = 0 })
    continue
  }
  $html = Get-Content -LiteralPath $archivo -Raw -Encoding UTF8
  $ctx = Leer-Contexto $html
  $productos = @(Obtener-Productos $ctx)
  if ($productos.Count -eq 0) {
    Write-Host ("  x {0}: sin datos de productos" -f $pag.slug) -ForegroundColor Red
    $paginasError++
    [void]$statsPaginas.Add([ordered]@{ pagina = $pag.slug; estado = 'sin-datos'; productos = 0 })
    continue
  }
  $nuevos = 0
  foreach ($p in $productos) {
    if ($null -eq $p -or -not $p.ContainsKey('_id')) { continue }
    $id = [string]$p['_id']
    if (-not $pool.ContainsKey($id)) {
      $pool[$id] = [pscustomobject]@{ producto = $p; base = $pag.base; pagina = $pag.slug }
      $nuevos++
    }
  }
  $paginasOk++
  Write-Host ("  + {0,-10} productos {1,4} · nuevos al pool {2,4}" -f $pag.slug, $productos.Count, $nuevos) -ForegroundColor Green
  [void]$statsPaginas.Add([ordered]@{ pagina = $pag.slug; estado = 'ok'; productos = $productos.Count; nuevos = $nuevos })
}

Write-Host ''
Write-Host "Pool único de productos Tambo: $($pool.Count)" -ForegroundColor Yellow

# ------------------------------------------------------------
#  Filtros y candidatos
# ------------------------------------------------------------
$omitidos = [ordered]@{
  pack = 0; hielo = 0; sinPrecio = 0; sinImagen = 0; sinNombre = 0; duplicado = 0; sinCupo = 0; otro = 0
}
$imagenesOk = 0
$imagenesError = 0
$imagenesSinUrl = 0
$marcasVacias = @{}
$candidatos = New-Object System.Collections.ArrayList
$candidatosPorCat = @{}

foreach ($item in $pool.Values) {
  $p = $item.producto
  $nombre = Limpiar-Texto ([string]$p['name'])
  if ([string]::IsNullOrWhiteSpace($nombre)) { $omitidos.sinNombre++; continue }
  if ($nombre -match '(?i)^\s*pack\b|\s\+\s') { $omitidos.pack++; continue }

  $av = $p['availabilityAt']
  if ($null -eq $av) { $omitidos.sinPrecio++; continue }
  if ($av['available'] -ne $true -or $av['visible'] -eq $false) { $omitidos.sinPrecio++; continue }
  $precioPublicado = Convertir-Precio $av['finalPrice']
  if ($null -eq $precioPublicado) { $omitidos.sinPrecio++; continue }
  $precioRegular = Convertir-Precio $av['basePrice']

  $cat = Clasificar-Producto $p $item.base
  if ($cat -eq 'hielo') { $omitidos.hielo++; continue }
  if ($cat -eq 'pack') { $omitidos.pack++; continue }
  if (-not $cuotas.Contains($cat)) { $omitidos.otro++; continue }

  $imgUrl = $null
  $imgs = @($p['images'])
  if ($imgs.Count -gt 0 -and $null -ne $imgs[0]) {
    $rd = $imgs[0]['resizedData']
    if ($null -ne $rd) {
      if ($rd['mediumURL']) { $imgUrl = [string]$rd['mediumURL'] }
      elseif ($rd['smallURL']) { $imgUrl = [string]$rd['smallURL'] }
    }
  }
  if ([string]::IsNullOrWhiteSpace($imgUrl) -and $p['seoImageURL']) { $imgUrl = [string]$p['seoImageURL'] }
  if ([string]::IsNullOrWhiteSpace($imgUrl)) { $omitidos.sinImagen++; $imagenesSinUrl++; continue }

  $marca = Obtener-Marca $nombre $p
  if (-not $marca) { $marcasVacias[$nombre] = $true }

  $presentacion = Obtener-Presentacion $nombre
  if ([string]::IsNullOrWhiteSpace($presentacion)) { $presentacion = 'Unidad' }

  $rutaProducto = [string]$p['path']
  if ([string]::IsNullOrWhiteSpace($rutaProducto)) { $rutaProducto = '/pedir/' + [string]$p['_id'] + '/' }

  $prioridad = 0.0
  if ($null -ne $p['priority']) { try { $prioridad = [double]$p['priority'] } catch { $prioridad = 0 } }

  $categoriasTambo = @()
  foreach ($c in @($p['categories'])) {
    if ($null -ne $c -and $c -is [System.Collections.IDictionary] -and $c.ContainsKey('name')) {
      $categoriasTambo += [string]$c['name']
    }
  }

  $descripcion = Limpiar-Texto ([string]$p['description'])
  if ($descripcion.Length -gt 600) { $descripcion = $descripcion.Substring(0, 600).Trim() + '…' }

  $candidato = [pscustomobject]@{
    id               = 'tambo-' + [string]$p['_id']
    tamboId          = [string]$p['_id']
    sku              = [string]$p['externalId']
    nombre           = $nombre
    marca            = $marca
    categoriaId      = $cat
    presentacion     = $presentacion
    precioPublicado  = $precioPublicado
    precioRegular    = $precioRegular
    prioridad        = $prioridad
    imagenUrl        = $imgUrl
    descripcion      = $descripcion
    url              = 'https://www.tambo.pe' + $rutaProducto
    categoriasTambo  = @($categoriasTambo)
    base             = $item.base
    pagina           = $item.pagina
  }

  [void]$candidatos.Add($candidato)
  if (-not $candidatosPorCat.ContainsKey($cat)) { $candidatosPorCat[$cat] = New-Object System.Collections.ArrayList }
  [void]$candidatosPorCat[$cat].Add($candidato)
}

Write-Host "Candidatos válidos (con precio, stock e imagen): $($candidatos.Count)" -ForegroundColor Yellow
Write-Host "Omitidos: pack=$($omitidos.pack) · hielo=$($omitidos.hielo) · sin precio=$($omitidos.sinPrecio) · sin imagen=$($omitidos.sinImagen)" -ForegroundColor DarkGray

# ------------------------------------------------------------
#  Selección equilibrada por categoría y marca
# ------------------------------------------------------------
function Seleccionar-Categoria {
  param($Lista, [int]$Cupo, [int]$CapMarca)
  if ($null -eq $Lista -or $Lista.Count -eq 0 -or $Cupo -le 0) { return @() }

  $grupos = [ordered]@{}
  foreach ($c in $Lista) {
    $clave = if ($c.marca) { $c.marca } else { '~' + $c.id }
    if (-not $grupos.Contains($clave)) { $grupos[$clave] = New-Object System.Collections.ArrayList }
    [void]$grupos[$clave].Add($c)
  }

  foreach ($g in @($grupos.Keys)) {
    $grupos[$g] = @($grupos[$g] | Sort-Object @{Expression = { -$_.prioridad }}, @{Expression = { $_.nombre }})
  }

  $orden = New-Object System.Collections.ArrayList
  foreach ($g in $grupos.Keys) {
    $max = 0.0
    foreach ($c in $grupos[$g]) { if ($c.prioridad -gt $max) { $max = $c.prioridad } }
    [void]$orden.Add([pscustomobject]@{ clave = $g; max = $max })
  }
  $orden = @($orden | Sort-Object @{Expression = 'max'; Descending = $true}, @{Expression = 'clave'; Ascending = $true})

  $sel = New-Object System.Collections.ArrayList
  $ronda = 0
  while ($sel.Count -lt $Cupo) {
    $agregado = $false
    foreach ($o in $orden) {
      if ($sel.Count -ge $Cupo) { break }
      $lista = $grupos[$o.clave]
      if ($ronda -lt $lista.Count -and $ronda -lt $CapMarca) {
        [void]$sel.Add($lista[$ronda])
        $agregado = $true
      }
    }
    if (-not $agregado) { break }
    $ronda++
  }
  return @($sel)
}

$seleccionados = New-Object System.Collections.ArrayList
$idsSeleccionados = @{}
$resumenCat = [ordered]@{}

foreach ($cat in $cuotas.Keys) {
  $cupo = [int]$cuotas[$cat]
  $esAlcohol = $cat -in @('whisky','ron','vodka','pisco','vino','cerveza','rtd','licor')
  $capMarca = if ($esAlcohol) { 2 } else { 3 }

  $lista = @()
  if ($candidatosPorCat.ContainsKey($cat)) { $lista = @($candidatosPorCat[$cat]) }
  $lista = @($lista | Sort-Object @{Expression = { -$_.prioridad }}, @{Expression = { $_.nombre }})

  $sel = @(Seleccionar-Categoria $lista ($cupo * 3) $capMarca)
  $agregados = 0
  foreach ($c in $sel) {
    if ($agregados -ge $cupo) { break }
    if ($idsSeleccionados.ContainsKey($c.id)) { continue }
    $dup = Buscar-Duplicado $indice $c.marca $c.nombre $c.presentacion
    if ($dup) { $omitidos.duplicado++; continue }
    [void]$seleccionados.Add($c)
    Agregar-AlIndice $indice $c.id $c.marca $c.nombre $c.presentacion
    $idsSeleccionados[$c.id] = $true
    $agregados++
  }

  $resumenCat[$cat] = [ordered]@{ disponibles = $lista.Count; seleccionados = $agregados }
  Write-Host ("  · {0,-10} disponibles {1,3} · seleccionados {2,2}" -f $cat, $lista.Count, $agregados) -ForegroundColor Gray
}

# Jägermeister es un requisito explícito: si no entró por cupo, se agrega.
$jager = @($candidatos | Where-Object { $_.nombre -match '(?i)j[äa]germeister' } | Select-Object -First 1)
if ($jager.Count -gt 0 -and -not $idsSeleccionados.ContainsKey($jager[0].id)) {
  $c = $jager[0]
  $dup = Buscar-Duplicado $indice $c.marca $c.nombre $c.presentacion
  if (-not $dup) {
    [void]$seleccionados.Add($c)
    Agregar-AlIndice $indice $c.id $c.marca $c.nombre $c.presentacion
    $idsSeleccionados[$c.id] = $true
    if (-not $resumenCat.Contains('licor')) { $resumenCat['licor'] = [ordered]@{ disponibles = 0; seleccionados = 0 } }
    $resumenCat['licor'].seleccionados++
    Write-Host '  + Jägermeister agregado explícitamente' -ForegroundColor Green
  }
}

# ------------------------------------------------------------
#  Descarga y validación de imágenes
# ------------------------------------------------------------
function Descargar-Imagen {
  param([string]$Url, [string]$Dir, [string]$IdBase)
  if ($Simular -or [string]::IsNullOrWhiteSpace($Url)) { return $null }
  $tmp = Join-Path $Dir ($IdBase + '.tmp')
  $code = & curl.exe -s -o $tmp -w "%{http_code}" --max-time 45 -L -H "User-Agent: $ua" $Url
  if ($code -ne '200' -or -not (Test-Path -LiteralPath $tmp)) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    return $null
  }
  $bytes = [IO.File]::ReadAllBytes($tmp)
  if ($bytes.Length -lt 800) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    return $null
  }
  $ext = $null
  if ($bytes.Length -gt 12 -and [Text.Encoding]::ASCII.GetString($bytes, 0, 4) -eq 'RIFF' -and [Text.Encoding]::ASCII.GetString($bytes, 8, 4) -eq 'WEBP') { $ext = 'webp' }
  elseif ($bytes.Length -gt 3 -and $bytes[0] -eq 0xFF -and $bytes[1] -eq 0xD8) { $ext = 'jpg' }
  elseif ($bytes.Length -gt 8 -and $bytes[0] -eq 0x89 -and $bytes[1] -eq 0x50) { $ext = 'png' }
  if (-not $ext) {
    Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    return $null
  }
  foreach ($viejo in @('webp','jpg','jpeg','png')) {
    $rutaVieja = Join-Path $Dir ($IdBase + '.' + $viejo)
    if (Test-Path -LiteralPath $rutaVieja) { Remove-Item -LiteralPath $rutaVieja -Force -ErrorAction SilentlyContinue }
  }
  $final = Join-Path $Dir ($IdBase + '.' + $ext)
  Move-Item -LiteralPath $tmp -Destination $final -Force
  return ($IdBase + '.' + $ext)
}

# ------------------------------------------------------------
#  Registros finales
# ------------------------------------------------------------
$nuevosNec = New-Object System.Collections.ArrayList
$nuevosLic = New-Object System.Collections.ArrayList
$productosReporte = New-Object System.Collections.ArrayList

foreach ($c in $seleccionados) {
  $esLicor = $c.categoriaId -in @('whisky','ron','vodka','pisco','vino','cerveza','rtd','licor')
  $carpeta = if ($esLicor) { 'licores' } else { 'primera-necesidad' }
  $dirImg = Join-Path (Join-Path $dataDir $carpeta) 'img'
  New-Item -ItemType Directory -Path $dirImg -Force | Out-Null

  $imgRel = $null
  if ($Simular) {
    $imgRel = 'img/' + $c.id + '.webp'
  } else {
    $archivoImg = Descargar-Imagen $c.imagenUrl $dirImg $c.id
    if ($archivoImg) { $imgRel = 'img/' + $archivoImg; $imagenesOk++ }
    else { $imagenesError++ }
  }

  # En licores se usa el precio más alto verificado (publicado o regular)
  # para no quedar por debajo del precio de venta de la tienda.
  $precio = [double]$c.precioPublicado
  if ($esLicor -and $null -ne $c.precioRegular -and [double]$c.precioRegular -gt $precio) {
    $precio = [double]$c.precioRegular
  }
  $precio = [Math]::Round($precio, 2)
  if ($precio -le 0) { $omitidos.otro++; continue }

  $descripcion = $c.descripcion
  if ([string]::IsNullOrWhiteSpace($descripcion)) { $descripcion = $null }

  $registro = [ordered]@{
    id                  = $c.id
    nombre              = $c.nombre
    marca               = $c.marca
    categoriaId         = $c.categoriaId
    presentacion        = $c.presentacion
    imagen              = $imgRel
    descripcion         = $descripcion
    precioReferencia    = $precio
    precioVenta         = $precio
    precioPublicadoTambo = $c.precioPublicado
    precioRegularTambo  = $c.precioRegular
    margenConfigurado   = 0
    fuente              = [ordered]@{
      tienda            = 'Tambo'
      url               = $c.url
      productoId        = $c.tamboId
      sku               = $c.sku
      fechaVerificacion = $hoy
      metodo            = 'Catálogo público tambo.pe (datos estructurados)'
    }
    categoriasTambo     = @($c.categoriasTambo)
    disponible          = $true
    publicado           = $true
    estado              = 'referencia-tambo'
    notas               = 'Precio referencial publicado en tambo.pe el ' + $hoy + '. EnRuta confirma precio y disponibilidad por WhatsApp.'
  }

  if ($esLicor) { [void]$nuevosLic.Add($registro) } else { [void]$nuevosNec.Add($registro) }

  [void]$productosReporte.Add([ordered]@{
    id                  = $c.id
    nombre              = $c.nombre
    marca               = $c.marca
    categoriaId         = $c.categoriaId
    presentacion        = $c.presentacion
    precio              = $precio
    precioPublicadoTambo = $c.precioPublicado
    precioRegularTambo  = $c.precioRegular
    imagen              = $imgRel
    imagenOrigen        = $c.imagenUrl
    fuente              = $c.url
    simulado            = [bool]$Simular
  })
}

Write-Host ''
Write-Host "Seleccionados: $($seleccionados.Count) · primera necesidad: $($nuevosNec.Count) · licores: $($nuevosLic.Count)" -ForegroundColor Yellow

# ------------------------------------------------------------
#  Categorías: conservar las existentes y agregar las nuevas
# ------------------------------------------------------------
function Asegurar-Categorias {
  param($Doc, [string[]]$Ids, [string[]]$Orden)
  $existentes = [ordered]@{}
  foreach ($c in @($Doc.categorias)) { $existentes[[string]$c.id] = [string]$c.nombre }

  $lista = New-Object System.Collections.ArrayList
  $usados = @{}

  foreach ($id in $Orden) {
    if ($existentes.Contains($id)) {
      [void]$lista.Add([ordered]@{ id = $id; nombre = $existentes[$id] })
      $usados[$id] = $true
    } elseif (($Ids -contains $id) -and $nombresCategorias.Contains($id)) {
      [void]$lista.Add([ordered]@{ id = $id; nombre = $nombresCategorias[$id] })
      $usados[$id] = $true
    }
  }

  foreach ($c in @($Doc.categorias)) {
    $id = [string]$c.id
    if (-not $usados.ContainsKey($id)) {
      [void]$lista.Add([ordered]@{ id = $id; nombre = [string]$c.nombre })
      $usados[$id] = $true
    }
  }

  foreach ($id in $Ids) {
    if (-not $usados.ContainsKey($id) -and $nombresCategorias.Contains($id)) {
      [void]$lista.Add([ordered]@{ id = $id; nombre = $nombresCategorias[$id] })
      $usados[$id] = $true
    }
  }

  $Doc.categorias = @($lista)
  return $Doc
}

$arrNec = @($nuevosNec)
$arrLic = @($nuevosLic)
$idsNec = @($arrNec | ForEach-Object { [string]$_['categoriaId'] } | Sort-Object -Unique)
$idsLic = @($arrLic | ForEach-Object { [string]$_['categoriaId'] } | Sort-Object -Unique)

$catNec = Asegurar-Categorias $catNec $idsNec $ordenNec
$catLic = Asegurar-Categorias $catLic $idsLic $ordenLic

# ------------------------------------------------------------
#  Guardar (nunca en simulación)
# ------------------------------------------------------------
$hayNuevos = (($arrNec.Count + $arrLic.Count) -gt 0)
if (-not $Simular -and $hayNuevos) {
  $docNec.productos = @(@($docNec.productos) + $arrNec)
  $docLic.productos = @(@($docLic.productos) + $arrLic)
  Escribir-Json $rutaNec $docNec
  Escribir-Json $rutaLic $docLic
  Escribir-Json $rutaCatN $catNec
  Escribir-Json $rutaCatL $catLic
}

# ------------------------------------------------------------
#  Reporte
# ------------------------------------------------------------
$catReporte = New-Object System.Collections.ArrayList
foreach ($cat in $cuotas.Keys) {
  if (-not $resumenCat.Contains($cat)) { continue }
  $r = $resumenCat[$cat]
  $catalogo = if ($cat -in @('whisky','ron','vodka','pisco','vino','cerveza','rtd','licor')) { 'licores' } else { 'primera-necesidad' }
  [void]$catReporte.Add([ordered]@{
    catalogo     = $catalogo
    id           = $cat
    nombre       = $nombresCategorias[$cat]
    disponibles  = $r.disponibles
    seleccionados = $r.seleccionados
  })
}

$reporte = [ordered]@{
  generadoEn    = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
  simulacion    = [bool]$Simular
  fuente        = 'https://www.tambo.pe/pedir'
  fechaConsulta = $hoy
  paginasOk     = $paginasOk
  paginasError  = $paginasError
  poolProductos = $pool.Count
  candidatos    = $candidatos.Count
  agregados     = [ordered]@{
    primeraNecesidad = $arrNec.Count
    licores          = $arrLic.Count
    total            = ($arrNec.Count + $arrLic.Count)
  }
  imagenes      = [ordered]@{
    descargadas = $imagenesOk
    fallidas    = $imagenesError
    sinUrl      = $imagenesSinUrl
  }
  omitidos      = $omitidos
  paginas       = @($statsPaginas)
  categorias    = @($catReporte)
  marcasSinDetectar = @($marcasVacias.Keys | Sort-Object)
  productos     = @($productosReporte)
  nota          = 'Precios y stock publicados en tambo.pe el día indicado. Son referenciales: pueden variar por tienda, promoción o disponibilidad. EnRuta confirma por WhatsApp.'
}

$rutaReporte = Join-Path $dataDir $(if ($Simular) { 'reporte-tambo-simulacion.json' } else { 'reporte-tambo.json' })
Escribir-Json $rutaReporte $reporte

# ------------------------------------------------------------
#  Resumen
# ------------------------------------------------------------
Write-Host ''
Write-Host 'Resumen Tambo' -ForegroundColor Yellow
Write-Host "  Primera necesidad: $($arrNec.Count)"
Write-Host "  Licores:           $($arrLic.Count)"
Write-Host "  Total nuevos:      $($arrNec.Count + $arrLic.Count)"
Write-Host "  Imágenes:          $imagenesOk descargadas · $imagenesError fallidas · $imagenesSinUrl sin URL"
Write-Host "  Duplicados:        $($omitidos.duplicado)"
Write-Host "  Marcas sin detectar: $($marcasVacias.Count)"
Write-Host "  Reporte:           $rutaReporte"

if ($Simular) {
  Write-Host ''
  Write-Host 'Simulación completada. No se modificó data/*/productos.json.' -ForegroundColor DarkYellow
  exit 0
}

if (-not $SinImportar) {
  Write-Host ''
  Write-Host 'Validando y regenerando js/catalogo.js...' -ForegroundColor Yellow
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'tools\importar.ps1')
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    Write-Host ''
    Write-Host 'El importador reportó errores. Revisa data\reporte-validacion.json' -ForegroundColor Red
    exit $code
  }
  Write-Host ''
  Write-Host 'Catálogo de Tambo integrado correctamente.' -ForegroundColor Green
}

exit 0
