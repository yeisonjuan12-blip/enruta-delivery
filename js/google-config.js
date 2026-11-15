/* ============================================================
   ENRUTA DELIVERY · Configuración de Google
   ------------------------------------------------------------
   Este es el ÚNICO archivo que debes editar para activar
   Google Analytics y Google AdSense.

   1) Google Analytics (GA4)
      - Entra a https://analytics.google.com
      - Crea una propiedad para tu web y copia el ID de medición.
      - Se ve así: G-ABC123XYZ9
      - Pégalo entre las comillas de "ga4".

   2) Google AdSense
      - Entra a https://adsense.google.com y solicita tu cuenta.
      - Cuando te aprueben, copia tu ID de editor.
      - Se ve así: ca-pub-1234567890123456
      - Pégalo en "adsense".
      - Crea 2 bloques de anuncios en AdSense (responsive) y copia
        el "data-ad-slot" de cada uno en "slots".

   Mientras estos valores estén vacíos, la web funciona normal:
   no carga nada de Google y no muestra espacios de publicidad.
   ============================================================ */

window.ENRUTA_GOOGLE = {
  // ID de medición de Google Analytics 4. Ejemplo: 'G-ABC123XYZ9'
  ga4: '',

  // ID de editor de Google AdSense. Ejemplo: 'ca-pub-1234567890123456'
  adsense: '',

  // Bloques de anuncios (data-ad-slot) creados en AdSense.
  // Deja vacío el que no uses; ese espacio no se mostrará.
  slots: {
    inicio: '',     // anuncio debajo del hero (id="adInicio")
    catalogo: ''    // anuncio antes de "Cómo funciona" (id="adCatalogo")
  },

  // true = muestra el aviso de cookies a los visitantes nuevos.
  // No lo desactives si usas Analytics o AdSense.
  avisoCookies: true
};
