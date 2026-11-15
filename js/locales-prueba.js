/* ============================================================
   ENRUTA DELIVERY · LOCALES DE PRUEBA (SEED / MOCK)
   ------------------------------------------------------------
   Datos FICTICIOS solo para demostrar la página.
   Todos los locales llevan esPrueba: true y esEjemplo: true.
   Para quitarlos: borra este archivo y la etiqueta <script> que
   lo carga en index.html (o pon window.ENRUTA_LOCALES_PRUEBA
   con locales vacíos). No hay que tocar la base de datos real.
   ============================================================ */

(function () {
  'use strict';

  // Placeholder SVG en línea: no requiere archivos ni conexión.
  function marcador(texto, color1, color2, emoji) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320" viewBox="0 0 480 320">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0" stop-color="' + color1 + '"/>' +
      '<stop offset="1" stop-color="' + color2 + '"/>' +
      '</linearGradient></defs>' +
      '<rect width="480" height="320" fill="url(#g)"/>' +
      '<circle cx="410" cy="60" r="90" fill="#ffffff" opacity="0.10"/>' +
      '<circle cx="60" cy="280" r="70" fill="#000000" opacity="0.08"/>' +
      '<text x="240" y="150" font-size="92" text-anchor="middle" dominant-baseline="middle">' + emoji + '</text>' +
      '<text x="240" y="245" font-family="Segoe UI, system-ui, sans-serif" font-size="24" font-weight="700" fill="#ffffff" text-anchor="middle">' + texto + '</text>' +
      '<text x="240" y="278" font-family="Segoe UI, system-ui, sans-serif" font-size="14" fill="#ffffff" opacity="0.85" text-anchor="middle">IMAGEN DE EJEMPLO</text>' +
      '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function producto(id, nombre, precio, emoji, descripcion, color1, color2, etiqueta) {
    return {
      id: id,
      nombre: nombre,
      descripcion: descripcion || '',
      precio: precio,
      grupo: 'Carta',
      subcategoria: '',
      emoji: emoji,
      etiqueta: etiqueta || '',
      imagen: marcador(nombre, color1, color2, emoji),
      publicado: true,
      disponible: true,
      revisar: false,
      variantes: [],
      extras: [],
      origen: 'prueba',
      camposDudosos: []
    };
  }

  var categorias = [
    { id: 'menu-criollo', nombre: 'Menú criollo' },
    { id: 'ferreteria', nombre: 'Ferretería' },
    { id: 'panaderia', nombre: 'Panadería' },
    { id: 'licores-tienda', nombre: 'Licores' }
  ];

  var locales = [
    {
      id: 'prueba-criollo',
      nombre: 'Sabor Criollo',
      tipo: 'comida',
      categoriaId: 'menu-criollo',
      descripcion: 'Comida peruana casera: menú del día, secos y guisos con sazón de barrio.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '🍲',
      colores: ['#f59e0b', '#b45309'],
      logo: marcador('Sabor Criollo', '#f59e0b', '#b45309', '🍲'),
      portada: marcador('Sabor Criollo', '#fbbf24', '#92400e', '🍲'),
      cartaOriginal: null,
      tiempo: '25-35 min',
      pedidoMinimo: 12,
      horarioLocal: '11:00 - 22:00',
      etiquetas: ['Casero', 'Menú del día'],
      empaquetado: { aplica: true, monto: 1, porUnidad: true, concepto: 'Empaquetado por unidad' },
      notas: '',
      productos: [
        producto('prueba-criollo-1', 'Menú del día completo', 12, '🍛', 'Sopa, segundo, arroz y refresco.', '#f59e0b', '#b45309', 'Más pedido'),
        producto('prueba-criollo-2', 'Seco de res con frejoles', 15, '🥘', 'Seco de res acompañado de frejoles y arroz.', '#f97316', '#9a3412'),
        producto('prueba-criollo-3', 'Arroz con pollo', 13, '🍗', 'Arroz verde con presa de pollo y ensalada.', '#fbbf24', '#b45309'),
        producto('prueba-criollo-4', 'Lomo saltado', 18, '🥩', 'Lomo de res salteado con papas fritas y arroz.', '#ef4444', '#7f1d1d'),
        producto('prueba-criollo-5', 'Chicha morada 1 L', 6, '🥤', 'Bebida casera de maíz morado.', '#7c3aed', '#4c1d95')
      ]
    },
    {
      id: 'prueba-botica',
      nombre: 'Botica San Rafael',
      tipo: 'productos',
      categoriaId: 'salud',
      descripcion: 'Medicamentos, cuidado personal y primeros auxilios. Atención las 24 horas.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '💊',
      colores: ['#22c55e', '#15803d'],
      logo: marcador('Botica San Rafael', '#22c55e', '#15803d', '💊'),
      portada: marcador('Botica San Rafael', '#4ade80', '#166534', '💊'),
      cartaOriginal: null,
      tiempo: '15-25 min',
      pedidoMinimo: 8,
      horarioLocal: '24 horas',
      etiquetas: ['24 horas', 'Delivery rápido'],
      empaquetado: { aplica: false, monto: 0, porUnidad: false, concepto: '' },
      notas: '',
      productos: [
        producto('prueba-botica-1', 'Paracetamol 500 mg x 10', 4, '💊', 'Tabletas para dolor y fiebre.', '#22c55e', '#15803d'),
        producto('prueba-botica-2', 'Alcohol medicinal 250 ml', 7, '🧴', 'Alcohol etílico de 70°.', '#38bdf8', '#0369a1'),
        producto('prueba-botica-3', 'Mascarillas quirúrgicas x 50', 15, '😷', 'Caja de 50 unidades.', '#94a3b8', '#475569'),
        producto('prueba-botica-4', 'Termómetro digital', 28, '🌡️', 'Termómetro de lectura rápida.', '#f43f5e', '#9f1239'),
        producto('prueba-botica-5', 'Agua oxigenada 120 ml', 5, '🧪', 'Limpieza de heridas menores.', '#06b6d4', '#155e75')
      ]
    },
    {
      id: 'prueba-bodega',
      nombre: 'Bodega La Esquina',
      tipo: 'productos',
      categoriaId: 'abarrotes',
      descripcion: 'Abarrotes, gaseosas y productos de limpieza de la esquina de siempre.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '🛒',
      colores: ['#38bdf8', '#0369a1'],
      logo: marcador('Bodega La Esquina', '#38bdf8', '#0369a1', '🛒'),
      portada: marcador('Bodega La Esquina', '#7dd3fc', '#075985', '🛒'),
      cartaOriginal: null,
      tiempo: '10-20 min',
      pedidoMinimo: 5,
      horarioLocal: '07:00 - 23:00',
      etiquetas: ['Vecindario', 'Precios bajos'],
      empaquetado: { aplica: false, monto: 0, porUnidad: false, concepto: '' },
      notas: '',
      productos: [
        producto('prueba-bodega-1', 'Arroz extra 1 kg', 4.5, '🍚', 'Arroz blanco de grano largo.', '#38bdf8', '#0369a1'),
        producto('prueba-bodega-2', 'Leche evaporada 400 g', 5, '🥛', 'Leche entera enlatada.', '#60a5fa', '#1e40af'),
        producto('prueba-bodega-3', 'Pan de molde grande', 6.5, '🍞', 'Pan blanco de molde.', '#f59e0b', '#92400e'),
        producto('prueba-bodega-4', 'Gaseosa 1.5 L', 6, '🥤', 'Bebida gaseosa de cola.', '#ef4444', '#7f1d1d'),
        producto('prueba-bodega-5', 'Detergente 900 g', 12.5, '🧼', 'Detergente en polvo multiusos.', '#22c55e', '#166534'),
        producto('prueba-bodega-6', 'Huevos x 12', 9, '🥚', 'Huevos blancos de corral.', '#facc15', '#a16207')
      ]
    },
    {
      id: 'prueba-ferreteria',
      nombre: 'Ferretería El Tornillo',
      tipo: 'productos',
      categoriaId: 'ferreteria',
      descripcion: 'Herramientas, pintura y materiales para arreglos de casa. Te asesoramos.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '🔧',
      colores: ['#94a3b8', '#475569'],
      logo: marcador('El Tornillo', '#94a3b8', '#475569', '🔧'),
      portada: marcador('Ferretería El Tornillo', '#cbd5e1', '#334155', '🔧'),
      cartaOriginal: null,
      tiempo: '20-35 min',
      pedidoMinimo: 10,
      horarioLocal: '08:00 - 19:00',
      etiquetas: ['Ferretería', 'Asesoría'],
      empaquetado: { aplica: false, monto: 0, porUnidad: false, concepto: '' },
      notas: '',
      productos: [
        producto('prueba-ferreteria-1', 'Martillo de carpintero', 25, '🔨', 'Mango de madera reforzado.', '#94a3b8', '#334155'),
        producto('prueba-ferreteria-2', 'Destornillador estrella', 12, '🪛', 'Punta magnética, mango antideslizante.', '#f59e0b', '#92400e'),
        producto('prueba-ferreteria-3', 'Cinta métrica 5 m', 16, '📏', 'Cinta retráctil con seguro.', '#eab308', '#854d0e'),
        producto('prueba-ferreteria-4', 'Pintura látex blanca 1 gal', 38, '🎨', 'Pintura lavable para interiores.', '#f8fafc', '#64748b'),
        producto('prueba-ferreteria-5', 'Juego de llaves x 8', 32, '🔧', 'Llaves mixtas de acero.', '#a1a1aa', '#3f3f46')
      ]
    },
    {
      id: 'prueba-moda',
      nombre: 'Moda Express',
      tipo: 'productos',
      categoriaId: 'ropa',
      descripcion: 'Ropa casual y urbana para toda la familia. Cambios sin complicaciones.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '👕',
      colores: ['#ec4899', '#be185d'],
      logo: marcador('Moda Express', '#ec4899', '#be185d', '👕'),
      portada: marcador('Moda Express', '#f472b6', '#9d174d', '👕'),
      cartaOriginal: null,
      tiempo: '30-45 min',
      pedidoMinimo: 20,
      horarioLocal: '10:00 - 21:00',
      etiquetas: ['Moda', 'Tallas surtidas'],
      empaquetado: { aplica: false, monto: 0, porUnidad: false, concepto: '' },
      notas: '',
      productos: [
        producto('prueba-moda-1', 'Polo básico algodón', 25, '👕', 'Polo unisex de algodón peinado.', '#ec4899', '#be185d'),
        producto('prueba-moda-2', 'Jean recto azul', 59, '👖', 'Jean de mezclilla corte recto.', '#3b82f6', '#1e3a8a'),
        producto('prueba-moda-3', 'Casaca con capucha', 79, '🧥', 'Casaca abrigadora con bolsillos.', '#64748b', '#1e293b'),
        producto('prueba-moda-4', 'Zapatillas urbanas', 89, '👟', 'Zapatillas ligeras para todos los días.', '#f97316', '#9a3412'),
        producto('prueba-moda-5', 'Gorra ajustable', 19, '🧢', 'Gorra con cierre regulable.', '#22c55e', '#166534')
      ]
    },
    {
      id: 'prueba-panaderia',
      nombre: 'Panadería El Trigal',
      tipo: 'comida',
      categoriaId: 'panaderia',
      descripcion: 'Pan recién horneado, postres y desayunos. Horneamos varias veces al día.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '🥖',
      colores: ['#f59e0b', '#92400e'],
      logo: marcador('El Trigal', '#f59e0b', '#92400e', '🥖'),
      portada: marcador('Panadería El Trigal', '#fcd34d', '#78350f', '🥖'),
      cartaOriginal: null,
      tiempo: '15-25 min',
      pedidoMinimo: 6,
      horarioLocal: '06:00 - 21:00',
      etiquetas: ['Recién horneado', 'Desayunos'],
      empaquetado: { aplica: false, monto: 0, porUnidad: false, concepto: '' },
      notas: '',
      productos: [
        producto('prueba-panaderia-1', 'Pan francés x 10', 3, '🥖', 'Pan crocante recién horneado.', '#f59e0b', '#92400e', 'Recién horneado'),
        producto('prueba-panaderia-2', 'Pan de yema x 6', 4, '🥐', 'Pan dulce de yema.', '#fbbf24', '#b45309'),
        producto('prueba-panaderia-3', 'Torta de chocolate porción', 6, '🍰', 'Porción de torta húmeda de chocolate.', '#78350f', '#451a03'),
        producto('prueba-panaderia-4', 'Empanada de pollo', 3.5, '🥟', 'Empanada horneada rellena de pollo.', '#f59e0b', '#9a3412'),
        producto('prueba-panaderia-5', 'Café pasado 8 oz', 3, '☕', 'Café peruano recién pasado.', '#78350f', '#3f1d0b')
      ]
    },
    {
      id: 'prueba-licores',
      nombre: 'Licorería La Reserva',
      tipo: 'productos',
      categoriaId: 'licores-tienda',
      descripcion: 'Vinos, cervezas y licores para compartir. Venta solo a mayores de 18 años.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '🍷',
      colores: ['#a78bfa', '#6d28d9'],
      logo: marcador('La Reserva', '#a78bfa', '#6d28d9', '🍷'),
      portada: marcador('Licorería La Reserva', '#c4b5fd', '#5b21b6', '🍷'),
      cartaOriginal: null,
      tiempo: '20-35 min',
      pedidoMinimo: 25,
      horarioLocal: '12:00 - 23:00',
      etiquetas: ['Mayores de 18', 'Para compartir'],
      empaquetado: { aplica: true, monto: 1, porUnidad: false, concepto: 'Empaquetado por pedido' },
      notas: 'Venta exclusiva para mayores de 18 años. Presenta DNI al recibir.',
      productos: [
        producto('prueba-licores-1', 'Vino tinto reserva 750 ml', 39, '🍷', 'Vino tinto seco de uva peruana.', '#7c3aed', '#4c1d95'),
        producto('prueba-licores-2', 'Cerveza artesanal 330 ml', 9, '🍺', 'Cerveza rubia artesanal.', '#f59e0b', '#92400e'),
        producto('prueba-licores-3', 'Pisco quebranta 500 ml', 45, '🥃', 'Pisco peruano de uva quebranta.', '#a78bfa', '#5b21b6'),
        producto('prueba-licores-4', 'Ron añejo 750 ml', 55, '🍹', 'Ron dorado para coctelería.', '#b45309', '#78350f'),
        producto('prueba-licores-5', 'Hielo en bolsa 2 kg', 6, '🧊', 'Hielo en cubos listo para servir.', '#38bdf8', '#0369a1')
      ]
    },
    {
      id: 'prueba-flores',
      nombre: 'Florería Jardín',
      tipo: 'productos',
      categoriaId: 'flores-regalos',
      descripcion: 'Arreglos florales, peluches y regalos para sorprender. Tarjeta incluida.',
      publicado: true,
      disponible: true,
      esPrueba: true,
      esEjemplo: true,
      emoji: '💐',
      colores: ['#f472b6', '#9d174d'],
      logo: marcador('Florería Jardín', '#f472b6', '#9d174d', '💐'),
      portada: marcador('Florería Jardín', '#f9a8d4', '#831843', '💐'),
      cartaOriginal: null,
      tiempo: '40-60 min',
      pedidoMinimo: 20,
      horarioLocal: '09:00 - 20:00',
      etiquetas: ['Regalos', 'Tarjeta gratis'],
      empaquetado: { aplica: false, monto: 0, porUnidad: false, concepto: '' },
      notas: '',
      productos: [
        producto('prueba-flores-1', 'Ramo de rosas x 12', 45, '🌹', 'Rosas rojas con envoltura y lazo.', '#f43f5e', '#9f1239', 'Más pedido'),
        producto('prueba-flores-2', 'Arreglo de girasoles', 38, '🌻', 'Girasoles frescos en base de cerámica.', '#facc15', '#a16207'),
        producto('prueba-flores-3', 'Peluche mediano', 32, '🧸', 'Peluche suave con moño.', '#d97706', '#78350f'),
        producto('prueba-flores-4', 'Caja de chocolates', 25, '🍫', 'Chocolates surtidos en caja.', '#78350f', '#451a03'),
        producto('prueba-flores-5', 'Globo corazón', 8, '🎈', 'Globo metalizado con forma de corazón.', '#ec4899', '#9d174d')
      ]
    }
  ];

  window.ENRUTA_LOCALES_PRUEBA = {
    origen: 'datos de prueba',
    archivo: 'js/locales-prueba.js',
    categorias: categorias,
    locales: locales
  };
})();
