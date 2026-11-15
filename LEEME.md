# EnRuta Delivery · Guía del proyecto

Aplicación web para recibir pedidos en **Nuevo Chimbote**, ahora con **servidor local**, **panel privado de administración**, **importación de cartas por OCR** y **registro real de pedidos** en archivos JSON.

La web pública sigue funcionando con la identidad amarillo/negro, el catálogo de locales, licores y primera necesidad, el carrito y el envío por WhatsApp. El panel permite administrar locales, productos, categorías, cartas y pedidos sin tocar archivos a mano.

- WhatsApp / teléfono: **922 504 223** (`51922504223`)
- Correo: **enrutadelivery@gmail.com**
- TikTok / Instagram: **@EnRutaDelivery0**
- Horario Nuevo Chimbote: **12:00 a. m. – 1:00 a. m.** (madrugada)

---

## 1. Qué incluye

| Módulo | Descripción |
|---|---|
| Web pública | Catálogo, buscador, filtros, variantes, extras, carrito y checkout |
| Panel `/admin` | Login real, roles, locales, productos, catálogos globales, pedidos, usuarios y auditoría |
| OCR de cartas | JPG, PNG y PDF multipágina → productos editables antes de publicar |
| Pedidos | Registro sin cuenta, recálculo de precios en servidor y respaldo por WhatsApp |
| Persistencia | JSON privado en `server/datos/`, escritura atómica, respaldos y auditoría |
| Privacidad | Libreta de direcciones local, aviso Ley 29733 y opt-out |

**No se procesan pagos.** El delivery **no se calcula automáticamente**: se cotiza por WhatsApp. **No se guardan tarjetas ni contraseñas de clientes.**

---

## 2. Requisitos y arranque

Necesitas:

- **Windows 10/11** con **PowerShell 5.1** (incluido).
- Navegador moderno (Edge, Chrome, Firefox).
- Paquete de idioma **español (España o Latinoamérica)** con OCR instalado para importar cartas.
- Opcional: proveedor de IA para refinar OCR (desactivado por defecto).

No hay Node, Python, PHP ni base de datos externa.

### 2.1 Crear el administrador (solo la primera vez)

```powershell
cd enruta-delivery
powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1
```

Si no indicas contraseña, el script genera una segura y la muestra **una sola vez**.

Para credenciales de demostración:

```powershell
powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1 -Usuario admin -Password "EnRuta2026Demo"
```

También sirve para restablecer la clave de un administrador existente:

```powershell
powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1 -Usuario admin -Resetear
```

La contraseña se guarda con **PBKDF2-SHA256 (120 000 iteraciones)**; nunca en texto plano ni en el navegador. El usuario de demostración **debe cambiarse antes de publicar**.

### 2.2 Iniciar el servidor

```powershell
powershell -ExecutionPolicy Bypass -File server\servidor.ps1
```

- Web pública: **http://localhost:8780/**
- Panel privado: **http://localhost:8780/admin/**
- Estado de la API: **http://localhost:8780/api/estado**

Opciones:

```powershell
powershell -ExecutionPolicy Bypass -File server\servidor.ps1 -Puerto 8781
powershell -ExecutionPolicy Bypass -File server\servidor.ps1 -Abrir
```

Detén el servidor con `Ctrl + C`. Solo escucha en `localhost` por defecto.

> `tools\servidor.ps1` es un lanzador de compatibilidad: inicia el mismo servidor canónico de `server\servidor.ps1`.

### 2.3 Si el puerto está ocupado

```powershell
netstat -ano | findstr :8780
```

Cierra el proceso que lo ocupa o inicia con `-Puerto 8781`. Tras reiniciar, `http.sys` puede tardar uno o dos segundos en liberar el puerto (puede devolver 502 un instante).

---

## 3. Estructura del proyecto

```
enruta-delivery/
├─ index.html                  Web pública
├─ privacidad.html             Aviso de privacidad (Ley 29733)
├─ css/styles.css              Diseño amarillo/negro y responsive
├─ js/
│  ├─ catalogo.js              GENERADO: no editar a mano
│  └─ app.js                   Catálogo, variantes, carrito, libreta y checkout
├─ admin/
│  ├─ index.html               Panel privado
│  ├─ admin.css                Diseño del panel
│  └─ admin.js                 Lógica del panel, OCR y pedidos
├─ assets/marca.jpg            Logo de EnRuta Delivery
├─ data/                       FUENTE PÚBLICA (editable / importada)
│  ├─ config.json              Marca, contactos, zonas y horarios
│  ├─ locales/
│  │  ├─ categorias.json       Rubros de locales
│  │  ├─ locales.json          Orden de carpetas
│  │  └─ local-001/ … local-011/
│  │     ├─ local.json
│  │     ├─ productos.json
│  │     ├─ logo.jpg / portada.jpg / carta.jpg (opcional)
│  │     └─ img/               Fotos de productos (opcional)
│  ├─ licores/                 Catálogo propio EnRuta
│  ├─ primera-necesidad/       Catálogo propio EnRuta
│  └─ reporte-validacion.json  GENERADO por el importador
├─ server/
│  ├─ servidor.ps1             HttpListener: web, /admin y API
│  ├─ lib/
│  │  ├─ comun.ps1             JSON atómico, HTTP, números y utilidades
│  │  ├─ auth.ps1              Usuarios, PBKDF2, sesiones, CSRF y bloqueo
│  │  ├─ datos.ps1             CRUD, pedidos, importaciones y respaldos
│  │  ├─ ocr.ps1               OCR WinRT, PDF, parser y validaciones
│  │  └─ api.ps1               Rutas, permisos y respuestas
│  └─ datos/                   DATOS PRIVADOS: no publicar
│     ├─ usuarios.json         Usuarios con hash
│     ├─ sesiones.json         Sesiones activas
│     ├─ pedidos.json          Pedidos registrados
│     ├─ auditoria.jsonl       Registro de acciones
│     ├─ importaciones/        Texto y resultados de OCR
│     └─ respaldos/            Copias antes de cada guardado de local
├─ tools/
│  ├─ crear-admin.ps1          Crea o restablece el administrador
│  ├─ crear-local.ps1          Crea la carpeta de un local
│  ├─ importar.ps1             Valida data/ y genera js/catalogo.js
│  ├─ importar-tambo.ps1       Importa catálogo desde tambo.pe
│  ├─ verificar-plazavea.ps1   Compara precios de referencia
│  └─ servidor.ps1             Lanzador de compatibilidad
└─ plantillas/local/           Plantilla de referencia (no se publica)
```

**Regla de oro:** el catálogo público se edita en `data/` o desde `/admin`, nunca a mano en `js/catalogo.js`.

---

## 4. Web pública

### 4.1 Catálogo

- **11 locales**, **217 productos publicables** en los catálogos EnRuta (159 de primera necesidad y 58 de licores).
- Pestañas por tipo, filtro por rubro y buscador por local, producto o marca.
- Tarjetas con precio, etiquetas, disponibilidad y aviso **“Ref. Tambo”** cuando el precio es referencial.
- Si falta una imagen se muestra un marcador visual; nunca se inventan logos ni cartas.

### 4.2 Variantes, presentaciones y extras

Un producto puede definir:

```json
{
  "id": "brasa-1",
  "nombre": "1/4 de pollo + papas",
  "precio": 19.9,
  "variantes": [
    { "id": "personal", "nombre": "Personal", "precio": 19.9 },
    { "id": "familiar", "nombre": "Familiar", "precio": 34.9 }
  ],
  "extras": [
    { "nombre": "Crema extra", "precio": 2.5 },
    { "nombre": "Papas extra", "precio": 5 }
  ]
}
```

- El cliente elige presentación y extras en el modal del producto.
- El precio mostrado y el total del carrito se recalculan en el navegador **y otra vez en el servidor**.
- La clave del carrito distingue producto + variante + extras: dos combinaciones distintas no se mezclan.
- Si el producto o una variante deja de estar publicado, el carrito lo elimina al recargar.

### 4.3 Carrito

- Se guarda en `localStorage` (`enruta.cart.v1`).
- Agrupa por local y por catálogo, con subtotales.
- Empaquetado opcional por local (por unidad o por pedido), siempre aparte del precio.
- El delivery aparece como **“Por cotizar”**.

### 4.4 Checkout

1. El cliente completa nombre, celular, zona, dirección, referencia y nota.
2. Puede **recordar sus datos** y guardar **varias direcciones**.
3. Al enviar, la web hace `POST /api/pedidos`.
4. El servidor valida los ítems contra el catálogo, **recalcula precios y totales** y guarda un snapshot del pedido.
5. Luego se abre WhatsApp con el resumen para confirmar la entrega.

Si el servidor no está disponible, el pedido **no se registra** y se abre igualmente WhatsApp con el mensaje completo. La web avisa: *“No se pudo registrar en línea (…). Enviamos el pedido por WhatsApp para confirmarlo.”* El carrito se vacía y no se inventa ningún número de pedido.

### 4.5 Datos del cliente y privacidad

| Clave | Uso |
|---|---|
| `enruta.cliente.v1` | Nombre, celular, direcciones, referencias e instrucciones |
| `enruta.cliente.optout` | Si el cliente desactiva “recordar mis datos” |

- Todo se guarda **solo en el navegador**; nunca se envían tarjetas ni contraseñas.
- La libreta permite **agregar, editar, elegir y borrar** direcciones.
- Enlace permanente a `privacidad.html` con el aviso de la **Ley 29733** y la forma de ejercer derechos.

### 4.6 Horarios y zonas

Se configuran en `data/config.json` o, sin tocar archivos, desde **Admin → Página**. La lógica admite horarios que cruzan la medianoche:

- Nuevo Chimbote (zona principal): **00:00 – 01:00** (a las 01:00 figura cerrado).
- Chimbote: **00:00 – 01:00**.
- El estado “Abierto/Cerrado” se actualiza cada minuto.

---

## 5. Panel de administración

### 5.1 Acceso

- URL: `http://localhost:8780/admin/`
- La web pública tiene un enlace **“Admin”** en el encabezado y **“Panel de administración”** en el pie.
- **Acceso oculto:** toca **5 veces seguidas** el logo (cabecera o pie) o pulsa el **punto casi invisible** al final del pie. Solo navega al panel cuando el servidor está activo; en la copia estática el enlace y el punto se ocultan.
- Login con usuario y contraseña; la sesión se valida en el servidor.
- Cookie `enruta_sesion` **HttpOnly, SameSite=Strict**, duración 480 minutos.
- Cada petición de escritura exige el encabezado **`X-CSRF-Token`**.
- Tras **5 intentos fallidos** el usuario se bloquea **10 minutos**.
- `server/datos/` **no se sirve** como archivo estático.

### 5.2 Roles y permisos

| Acción | Admin | Encargado de local | Visitante |
|---|---|---|---|
| Ver resumen | Todos los locales | Solo su local | No |
| Ventas y productos más vendidos | Todos | Solo su local | No |
| Crear / eliminar locales | Sí | No | No |
| Editar datos del local | Sí | Solo el suyo (sin cambiar publicación) | No |
| Cambiar publicación del local | Sí | No | No |
| Productos y precios | Todos | Solo su local | No |
| Disponibilidad y horarios | Todos | Solo su local | No |
| Imágenes | Todas | Solo su local | No |
| Catálogos globales (licores / primera necesidad) | Sí | No | No |
| Página pública (marca, contacto, zonas, categorías) | Sí | No | No |
| Pedidos | Todos | Solo los de su local | No |
| Usuarios y auditoría | Sí | No | No |
| OCR | Todos | Solo su local | No |

Los permisos se comprueban **en el servidor** en cada petición, no solo ocultando botones. Cambiar una URL o el cuerpo de una petición no otorga acceso.

### 5.2.1 Perfiles por local

Un administrador puede crear un usuario con rol **Encargado de local** desde **Usuarios** y asignarle una carpeta (`local-001`, `local-002`, …). Ese usuario:

- Solo ve su establecimiento, sus pedidos, sus ventas y sus productos.
- Puede agregar, editar, ocultar, marcar agotado y eliminar **solo sus productos**.
- Ve en la tabla de productos las **unidades vendidas y los ingresos de los últimos 30 días** por producto.
- No puede crear ni eliminar locales, ni cambiar el estado de publicación del local.
- No puede abrir otros locales, los catálogos globales, la página pública, los usuarios ni la auditoría. El servidor devuelve **403** aunque intente cambiar la URL.

Los administradores conservan acceso total y pueden restablecer contraseñas desde el mismo panel.

También se puede crear el acceso sin salir del local: entra al detalle del local, pestaña **Acceso del local**, y pulsa **Crear acceso**. Ahí mismo se listan los encargados del local y hay un botón **Ver ventas** que abre el reporte filtrado a ese establecimiento. En **Usuarios**, cada encargado también tiene un botón **Ventas** con el mismo filtro.

### 5.3 Secciones

- **Resumen:** pedidos del día, ventas, locales, productos publicados y pendientes, estado del sistema e IA. Para el encargado de local muestra las ventas de los últimos 30 días.
- **Locales:** buscador, alta, edición, publicación, disponibilidad, horarios, imágenes y productos.
- **Importar carta:** OCR de imágenes o PDF y publicación revisada.
- **Ventas:** rango de fechas, filtro por local, ventas por día, productos más vendidos por unidades y por ingresos, ticket promedio y comparativo entre locales.
- **Catálogos:** edición de licores y primera necesidad, categorías y subcategorías.
- **Página:** edición de marca, ciudad, WhatsApp, correo, redes, zonas con días y horarios, mensaje de delivery, aviso de ejemplos y categorías de locales. Al guardar, la web pública se actualiza al instante.
- **Pedidos:** listado, detalle y cambio de estado (`nuevo`, `confirmado`, `en-camino`, `entregado`, `cancelado`).
- **Usuarios:** creación de usuarios de local y administradores, cambio de contraseña y baja.
- **Auditoría:** últimas acciones con usuario, rol, fecha, IP y detalle.
- **Mi cuenta:** cambio de contraseña.

### 5.4 Publicación y guardado

- Cada guardado reejecuta `tools/importar.ps1` para regenerar `js/catalogo.js`.
- Si el importador falla, se restaura el respaldo anterior y se informa el error.
- Guardar un local crea una copia previa en `server/datos/respaldos/`.
- La publicación es **explícita**: un local o producto con `publicado: false` no aparece en la web.

---

## 6. Importación de cartas con OCR

### 6.1 Formatos y límites

| Elemento | Límite |
|---|---|
| Formatos aceptados | JPG, JPEG, PNG y PDF |
| Peso por archivo | **20 MB** |
| Páginas por PDF | **20** |
| WebP | Se convierte a PNG/JPEG en el navegador antes de subirlo |
| Motor | `Windows.Media.Ocr` con idioma **es-ES** |
| PDF | `Windows.Data.Pdf` (renderiza cada página a imagen) |
| IA de refinamiento | Opcional, **desactivada** si no hay proveedor ni credenciales |

El servidor valida extensión, firma real del archivo (cabecera PDF/PNG/JPG), tamaño y página. Si el OCR de español no está instalado, muestra un error claro.

### 6.2 Flujo

1. Eliges el local.
2. Subes una o varias imágenes o PDF.
3. El servidor procesa y devuelve el texto y las filas detectadas.
4. Revisas la tabla editable.
5. Guardas **borrador** o **publicas** solo lo revisado.

### 6.3 Qué extrae

- Nombre, precio, descripción, categoría y subcategoría sugeridas.
- Presentación y variantes (por ejemplo “1/4”, “1/2”, “entero”).
- Secciones y extras (por ejemplo “EXTRA”, “CREMAS”).
- Precios alineados por columnas aunque el texto OCR venga desordenado.
- Une páginas del mismo documento y conserva los precios de los extras.

**No inventa datos.** Si un precio no es claro, deja la fila marcada y no permite publicarla sin confirmación. También corrige confusiones típicas del OCR (`SI` → `S/`, `mi` → `ml`) sin alterar nombres reales.

### 6.4 Tabla editable

- Selección por fila, edición en línea, eliminación y fila manual.
- Campos dudosos resaltados en amarillo.
- Estado por fila: listo, nuevo, revisar u omitir.
- Contador de seleccionadas, por revisar y posibles duplicados.
- **Guardar borrador:** crea o actualiza productos con `publicado: false`.
- **Publicar:** exige nombre y precio válidos. Una fila con baja confianza o marcada para revisión bloquea la publicación hasta corregirla o forzarla explícitamente.
- Puedes retomar un borrador desde **Importaciones**.

### 6.5 Duplicados al reimportar

Se comparan **local + nombre normalizado + variantes**. Si hay coincidencias, el panel ofrece:

| Opción | Efecto |
|---|---|
| **Actualizar coincidencias** | Actualiza los productos existentes |
| **Solo nuevos** | Agrega únicamente los que no existen |
| **Mantener anteriores** | No toca los existentes |
| **Revisar conflictos** | Deja las filas para decisión manual |

**Nunca se sobrescribe un producto sin revisión.** Las importaciones y su texto OCR quedan en `server/datos/importaciones/`.

### 6.6 IA opcional

La IA de refinamiento **no está configurada**. El panel lo indica y el OCR funciona igual. Para activarla se necesita un proveedor, un modelo y una clave **en el servidor**; el frontend nunca recibe credenciales. Si no hay configuración, no se simula el servicio.

---

## 7. Pedidos

- **No requieren registro ni cuenta.**
- El servidor recalcula cada línea desde el catálogo vigente: ignora cualquier precio enviado por el navegador.
- Valida que el local, producto, variante y extras existan y estén publicados.
- Guarda un snapshot del pedido (líneas, precios, empaquetado, subtotal y total) y el estado `nuevo`.
- Rechaza pedidos con más de **200 líneas**, precios inválidos, productos inexistentes o variantes no válidas.
- Un pedido puede incluir productos de varios locales; se guarda la lista de carpetas implicadas.
- Los usuarios de local solo ven y actualizan pedidos de su local.
- WhatsApp sigue siendo el canal de confirmación y cotización del delivery.

Los pedidos viven en `server/datos/pedidos.json`. **No se guardan números de tarjeta ni contraseñas.**

---

## 8. Datos, respaldos y auditoría

| Ubicación | Contenido | ¿Publicable? |
|---|---|---|
| `data/` | Catálogo y configuración pública | Sí |
| `js/catalogo.js` | Catálogo generado para la web | Sí |
| `server/datos/` | Usuarios, sesiones, pedidos, auditoría e importaciones | **No** |
| `server/datos/respaldos/` | Copias previas a cada guardado | No |

- Escritura **atómica**: archivo temporal + reemplazo, con `.bak` de seguridad.
- `auditoria.jsonl` registra login, cambios de catálogo, OCR, pedidos y usuarios.
- Si el importador falla tras un guardado, se restaura el respaldo y se devuelve el error.
- Para respaldar el negocio, copia `server/datos/` y `data/` con el servidor detenido.
- No edites `usuarios.json` a mano: usa `tools\crear-admin.ps1` o el panel.

---

## 9. Seguridad

- Autenticación **en servidor** con PBKDF2-SHA256 (120 000 iteraciones y sal por usuario).
- Tokens de sesión aleatorios; en disco solo se guarda su **hash**.
- Cookie HttpOnly + SameSite=Strict y **CSRF** en cada escritura.
- Bloqueo temporal tras intentos fallidos y comparación en tiempo constante.
- Permisos por rol comprobados en cada ruta.
- Secretos y claves **fuera del navegador**.
- Validación de tipo, tamaño y contenido de archivos; límites de cuerpo y de líneas.
- Rutas estáticas normalizadas para evitar salir de la carpeta del proyecto.
- `server/datos/` no se expone por HTTP.
- El servidor escucha solo en `localhost` hasta configurar HTTPS y un proxy inverso.

---

## 10. Pruebas realizadas

### 1. Catálogo y web pública intactos

- 11 locales, 217 productos publicables, 21 categorías y 219 imágenes.
- Filtros, buscador, carrito persistente, horarios y enlaces de contacto funcionando.
- Responsive verificado a **390, 768 y 1280 px**, sin desbordes horizontales.

### 2. Panel protegido

- `/admin/` sin sesión muestra solo el login; con credenciales válidas carga el panel.
- Cookie HttpOnly, CSRF obligatorio y bloqueo tras 5 fallos.
- Las rutas privadas responden **401/403** sin sesión o con rol insuficiente.

### 3. Roles

- `admin` ve los 11 locales y los catálogos globales.
- Usuario de local solo ve y edita `local-001`; `local-002`, catálogos globales y creación de locales devuelven **403**.
- No puede cambiar `id` ni `publicado`.
- Visitante no accede a ninguna ruta de administración.

### 4. CRUD de administración

- Alta, edición y baja de locales; edición de productos, precios, disponibilidad, horarios e imágenes.
- Categorías y subcategorías de locales y catálogos globales.
- Publicación explícita y buscador del panel.
- Cada guardado regenera `js/catalogo.js`; si falla, restaura el respaldo.

### 5. OCR de imágenes y PDF

- PDF real de 2 páginas procesado en el panel: 8 productos detectados con nombre, precio, categoría y extras.
- Se conservaron los precios de extras y se corrigieron artefactos `SI` → `S/` y `mi` → `ml`.
- Formatos y límites validados (extensión, firma, tamaño, páginas).

### 6. Tabla OCR, borradores y publicación

- Edición, selección y eliminación de filas; campos dudosos marcados.
- Borrador guardado como `publicado: false`: **invisible** en el catálogo público.
- Publicación posterior: productos visibles y catálogo regenerado.
- Publicación bloqueada con nombre/precio faltante o fila por revisar.

### 7. Reimportación y duplicados

- Reimportación de la misma carta: 8 filas, 8 duplicados detectados.
- “Solo nuevos” dejó 0 seleccionadas.
- “Actualizar”, “Mantener anteriores” y “Revisar conflictos” responden según lo elegido.
- Ningún producto se sobrescribió sin decisión del usuario.

### 8. Pedidos y libreta

- Pedido sin registro guardado con snapshot, totales y estado `nuevo`.
- Variante + extra suman correctamente en web y servidor.
- Libreta: guardar, editar, elegir y borrar direcciones; persiste al recargar.
- Opt-out desactiva el guardado de datos.

### 9. Privacidad

- Aviso de **Ley 29733** enlazado desde el formulario y en `privacidad.html`.
- Solo se guardan datos de contacto y direcciones en el navegador.
- No se solicitan ni almacenan tarjetas, contraseñas ni datos sensibles.

### 10. Validación del servidor

- Precio manipulado en la petición → el servidor usa el precio real del catálogo.
- Variante o extra inexistente → **400**.
- Producto no publicado o local ajeno → rechazado.
- Pedido con más de 200 líneas → rechazado.
- Decimales con punto y coma (`12.5`, `19,9`) convertidos correctamente pese a la cultura `es-ES`.

### 11. Fallback a WhatsApp

- Con el servidor detenido, el pedido **no se registra** y se abre WhatsApp con el mensaje completo.
- Aviso correcto: *“No se pudo registrar en línea (El servidor no está disponible en este momento). Enviamos el pedido por WhatsApp para confirmarlo.”*
- La URL de WhatsApp no incluye número de pedido ni “Total registrado”.
- Carrito vaciado y botón habilitado tras el intento.

### 12. Persistencia, respaldos y auditoría

- Pedido de prueba `PED-20261026-6BXQAA` con subtotal `74.8` y total `76.8` guardado en disco.
- Respaldos creados antes de cada guardado y restauración verificada ante fallo del importador.
- Auditoría con usuario, rol, acción, detalle e IP.
- Estado final limpio: 0 pedidos de prueba, 0 importaciones, 0 auditoría y los 8 productos originales de La Brasa.

### 13. Ventas por local y por producto

- `GET /api/admin/estadisticas?desde=&hasta=&local=` devuelve resumen, serie diaria, productos, top por unidades, top por ingresos y comparativo por local.
- Pedido de prueba en `local-001`: 2 unidades, `S/ 32`, top por unidades y por ingresos correctos.
- Los pedidos `cancelado` no se cuentan.
- Un encargado de local recibe solo su carpeta aunque envíe `local=` con otro valor.
- Rango por defecto: últimos 30 días; los atajos 7/30/90 y el filtro de fechas responden.

### 14. Página pública editable

- `GET/PUT /api/admin/config` valida marca, ciudad, moneda, WhatsApp, correo, redes, zonas, días, horarios y mensaje de delivery.
- Guardar crea respaldo, escribe el JSON de forma atómica, regenera el catálogo y restaura si el importador falla.
- Roundtrip de configuración sin cambios devolvió `ok: true` y la web pública reflejó los valores.
- Categorías de locales editables desde **Página** con `PUT /api/admin/categorias-locales` (solo admin).

### 15. Perfiles de local y permisos

- Se creó un usuario con rol **Encargado de local** asignado a una carpeta.
- Solo ve su local, sus pedidos, sus ventas y sus productos.
- Las rutas de otros locales, catálogos globales, usuarios, auditoría y página devuelven **403**.
- La tabla de productos muestra unidades e ingresos de los últimos 30 días.
- Duplicar local y eliminación múltiple de productos siguen funcionando.

### Comprobaciones finales

- `/`, `/privacidad.html`, `/admin/`, `/api/estado`, `/js/catalogo.js`, `/css/styles.css` y `/js/app.js` responden **200**.
- Panel y web pública sin errores en consola.
- Sintaxis de todos los `.ps1` validada y archivos guardados en UTF-8 con BOM.

---

## 11. Configuración pendiente

1. **Cambiar la contraseña de demostración** (`admin` / `EnRuta2026Demo`) y crear usuarios reales.
2. **Publicar con HTTPS** en un servidor o proxy inverso (ver sección 12).
3. Configurar el proveedor de **IA de refinamiento OCR** si se desea; hoy está desactivado.
4. Reemplazar los **11 locales de ejemplo** por establecimientos reales.
5. Subir **logos, portadas y cartas originales** reales.
6. Cargar **productos y precios reales** de cada local.
7. Revisar los **199 precios referenciales de Tambo** y decidir si se mantienen o llevan margen.
8. Definir el **empaquetado** de cada local.
9. Confirmar los perfiles de **TikTok e Instagram** (`verificado: false` en `config.json`).
10. Confirmar el horario de la zona **Chimbote** (hoy usa el mismo de Nuevo Chimbote).
11. Configurar el precio de **`lic-009`** o dejarlo oculto.
12. Revisar **`nec-011`** (agotado) y la marca vacía de “Carbón al Fuego x 3 kg” (Tambo no la expone).
13. Completar la categoría **Limpieza**: Mass sigue pendiente de carga manual.
14. Revisar los precios de licores consultados el **2026-10-25** antes de publicar.
15. Probar un pedido real desde un celular y confirmar el flujo de WhatsApp.

---

## 12. Publicar en internet

### 12.1 Web completa con panel y pedidos (servidor Windows)

Esta versión **no es un sitio estático completo**: el panel, el OCR y el registro de pedidos necesitan el servidor PowerShell y `server/datos/`.

1. Instala el proyecto en un equipo o servidor Windows que quede encendido.
2. Ejecuta `server\servidor.ps1` con una cuenta de servicio.
3. Coloca delante un proxy **HTTPS** (IIS, Caddy o nginx) que reenvíe a `http://localhost:8780/`.
4. Cambia el prefijo del servidor para el dominio real y protege el acceso al puerto interno.
5. Programa **respaldos diarios** de `server/datos/` y `data/`.
6. No publiques `server/datos/`, `tools/` ni `plantillas/`.
7. Exige HTTPS para que la cookie de sesión viaje segura.
8. Verifica el alta del administrador con una contraseña nueva y el bloqueo por intentos fallidos.

### 12.2 Versión estática en GitHub Pages (solo web pública)

Sirve para revisar la página y compartirla sin encender el PC. El panel y el registro de pedidos en servidor **no funcionan** en esta modalidad; el pedido se envía por WhatsApp.

- Repositorio: `https://github.com/yeisonjuan12-blip/enruta-delivery`
- Sitio: `https://yeisonjuan12-blip.github.io/enruta-delivery/`

Para regenerar la carpeta publicable:

```powershell
powershell -ExecutionPolicy Bypass -File tools\preparar-publicacion.ps1 -Url "https://yeisonjuan12-blip.github.io/enruta-delivery" -Zip
```

Esto crea `dist\web` (solo archivos públicos, sin panel ni JSON internos) y `dist\enruta-web.zip`. En esa copia el enlace **Admin** se oculta automáticamente y el checkout envía el pedido directo a WhatsApp.

### 12.3 Google Analytics y Google AdSense

1. Abre `js/google-config.js` y pega tu ID de medición de GA4 (`G-...`) en `ga4`.
2. Si ya tienes AdSense aprobado, pega tu ID de editor (`ca-pub-...`) en `adsense`.
3. Crea dos bloques de anuncios responsive en AdSense y copia su `data-ad-slot` en `slots.inicio` y `slots.catalogo`.
4. Reemplaza la línea de ejemplo de `ads.txt` por la que te indique AdSense (sin el `#`).
5. Vuelve a ejecutar `tools\preparar-publicacion.ps1` y sube los cambios.

Mientras los IDs estén vacíos, la web **no carga nada de Google ni muestra espacios de publicidad**. El aviso de cookies aparece una vez y guarda la elección del visitante; el enlace **“Configurar cookies”** del pie permite cambiarla.

Para AdSense conviene usar un **dominio propio**: el archivo `ads.txt` debe estar en la raíz del dominio (`https://tudominio.com/ads.txt`). En una URL de GitHub Pages por subcarpeta (`/enruta-delivery/`) no se puede controlar la raíz del dominio, así que AdSense puede rechazar la verificación. GitHub Pages sirve para probar la web; la monetización estable debe ir con dominio propio.

Mientras no exista hosting con HTTPS, el sistema completo está pensado para **uso local** en `localhost`.

---

## 13. Problemas frecuentes

**“No se pudo iniciar el servidor”**
El puerto está ocupado. Ciérralo o usa `-Puerto 8781`. Espera unos segundos tras detener una instancia anterior.

**El panel no deja entrar**
Verifica que exista `server/datos/usuarios.json`. Si no, ejecuta `tools\crear-admin.ps1`. Tras 5 fallos, espera 10 minutos.

**“Windows no tiene instalado el reconocedor OCR en español”**
Instala el idioma español con OCR en *Configuración → Hora e idioma → Idioma y región*.

**El OCR detecta mal un precio**
Corrígelo en la tabla. Mientras la fila esté marcada, no se publica.

**Se ven caracteres raros**
Guarda los `.json` en **UTF-8**. Los `.ps1` deben conservar **BOM UTF-8**; los archivos incluidos ya lo tienen.

**Un cambio no aparece en la web**
Recarga con `Ctrl + F5`. El panel regenera `js/catalogo.js`; si editaste `data/` a mano, ejecuta `tools\importar.ps1`.

**El importador reporta errores**
Abre `data/reporte-validacion.json`, corrige y vuelve a ejecutar. Mientras haya errores, el catálogo público no se actualiza.

**No se abre WhatsApp**
Revisa `data/config.json` → `whatsapp.numero` (solo dígitos, con código de país) y permite ventanas emergentes.

**La imagen no aparece**
Verifica que la ruta sea relativa a la carpeta del local o del catálogo. Si falta, se usa un marcador visual.

**Un pedido no se guardó**
El aviso indica el motivo (servidor apagado, datos inválidos, producto no disponible). El pedido se envió por WhatsApp como respaldo; revísalo antes de confirmar.

---

## 14. Comandos útiles

```powershell
# Iniciar
powershell -ExecutionPolicy Bypass -File server\servidor.ps1

# Validar el catálogo y regenerar js/catalogo.js
powershell -ExecutionPolicy Bypass -File tools\importar.ps1

# Solo validar, sin regenerar
powershell -ExecutionPolicy Bypass -File tools\importar.ps1 -SoloValidar

# Crear un local
powershell -ExecutionPolicy Bypass -File tools\crear-local.ps1 `
  -Id "pizzeria-napoli" `
  -Nombre "Pizzería Napoli" `
  -CategoriaId "pizzas" `
  -Tipo "comida"

# Restablecer la contraseña del administrador
powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1 -Usuario admin -Resetear

# Comparar precios de referencia (Plaza Vea)
powershell -ExecutionPolicy Bypass -File tools\verificar-plazavea.ps1

# Importar catálogo de Tambo (simulación)
powershell -ExecutionPolicy Bypass -File tools\importar-tambo.ps1 -Simular
```

---

## 15. Reglas de precios y datos

- `precioReferencia` **no se cobra**: es solo una referencia pública.
- `precioVenta` se configura manualmente; **no hay aumentos automáticos**.
- Si `precioVenta` es `null`, el producto **no se publica**.
- Un producto agotado se conserva y se oculta; no se borra.
- Los productos con `estado: "referencia-tambo"` muestran **“Precio referencial”** y **“Ref. Tambo”**.
- Los precios de Tambo pueden variar: el pedido siempre se confirma por WhatsApp.
- Los productos de Plaza Vea conservan `estado: "verificado"` y se muestran como **“Precio EnRuta”**.

---

## 16. Servicios: Taximoto y recojo/envío

- Los dos servicios aparecen como **tarjetas destacadas** al inicio de `#locales`, dentro del contenedor `#servicios` (ancla `#servicios`). Ya no son una sección aparte.
- Al tocar una tarjeta se abre un **bottom sheet** (`#serviceSheet`) con el formulario correspondiente, su botón de cierre y validación de campos obligatorios.
- **Taximoto** (`#taximotoForm`): punto de recojo, destino y referencia opcional. Guarda en `server/datos/servicios.json` (arreglo `taximotos`) con estado `pendiente`. Como el contacto llega por WhatsApp, `nombreCliente` y `telefono` son opcionales en el backend.
- **Recojo y envío** (`#envioForm`): qué se recoge, direcciones de recojo y entrega, nombre, teléfono y observaciones opcionales. El mismo contacto se guarda como remitente y destinatario para conservar el panel actual.
- Endpoints públicos: `POST /api/envios` y `POST /api/taximotos`.
- Endpoints del panel: `GET /api/admin/servicios?tipo=envio|taximoto` y `POST /api/admin/servicios/estado`.
- Estados: `pendiente`, `en camino`, `entregado`. Se cambian desde las vistas **Recojo y envío** y **Taximoto** del panel.
- Validación: direcciones de 6+ caracteres, teléfono de 9 a 15 dígitos en recojo/envío y fecha futura cuando se programa el servicio.
- Al enviar se abre WhatsApp con el resumen. Si la web se publica sin backend, el formulario igualmente abre WhatsApp, pero no registra la solicitud.

## 17. Locales de prueba

Los 8 locales ficticios están en `js/locales-prueba.js` y se fusionan solo en el render público. Todos llevan `esPrueba: true` y `esEjemplo: true`.

Para quitarlos: borra `js/locales-prueba.js` y elimina su etiqueta `<script>` de `index.html`. No afecta la base de datos real ni el panel.

---

Hecho para **EnRuta Delivery** · Nuevo Chimbote 🛵
