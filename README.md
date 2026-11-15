# EnRuta Delivery

Web pública, panel de administración y API para un servicio de delivery en Nuevo Chimbote (Perú).

- **Sitio publicado:** https://yeisonjuan12-blip.github.io/enruta-delivery/
- **Stack:** HTML + CSS + JavaScript sin frameworks, y un servidor en **PowerShell 5.1** (`HttpListener`) con almacenamiento en archivos **JSON**.

## Ramas

| Rama | Contenido |
| --- | --- |
| `codigo` | Código fuente completo (esta rama): web, panel, servidor y herramientas. |
| `main` | Sitio publicado, generado con `tools/preparar-publicacion.ps1` y servido por GitHub Pages. |

## Arrancar en local

Requiere Windows 10/11 con PowerShell 5.1. No necesita Node, PHP ni base de datos.

```powershell
# 1) Crear el administrador (solo la primera vez)
powershell -ExecutionPolicy Bypass -File tools\crear-admin.ps1

# 2) Arrancar el servidor
powershell -ExecutionPolicy Bypass -File server\servidor.ps1
```

- Web pública: http://localhost:8780/
- Panel privado: http://localhost:8780/admin/
- Estado de la API: http://localhost:8780/api/estado

El acceso al panel se abre con **5 toques en el logo** o entrando directo a `/admin/`. Las credenciales se crean con el script y **no se guardan en el repositorio**.

## Servicios destacados

Taximoto y Recojo y envío aparecen como tarjetas con fotografía dentro de `#locales`. Al tocarlas se abre un *bottom sheet* con el formulario, validación y envío a WhatsApp. Las solicitudes se registran en `server/datos/servicios.json` cuando hay backend.

## Publicar

```powershell
powershell -ExecutionPolicy Bypass -File tools/preparar-publicacion.ps1
```

Genera `dist/web` con el backend desactivado (`enruta-backend = none`) y los assets versionados. Ese contenido es el que se publica en la rama `main`.

## Datos privados

`server/datos/` (usuarios, sesiones, pedidos, solicitudes y respaldos) está excluido con `.gitignore`. El repositorio solo contiene el catálogo público y el código.

## Documentación

La guía completa está en [`LEEME.md`](LEEME.md): estructura, panel, roles, OCR, pedidos, respaldos y pruebas realizadas.

## Créditos de fotografías

Las tarjetas de servicios usan fotos de **Pixabay** y **Burst by Shopify**, de uso libre. Ver `LEEME.md`, sección 18.
