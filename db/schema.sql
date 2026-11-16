-- ============================================================
--  EnRuta Delivery - Esquema D1
--  ------------------------------------------------------------
--  docs      : documentos JSON por clave (config, locales,
--              catálogos, usuarios, importaciones).
--  pedidos   : pedidos del sitio público.
--  servicios : envíos (recojo/entrega) y taximotos.
--  auditoria : historial de acciones del panel.
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS docs (
  clave        TEXT PRIMARY KEY,
  json         TEXT NOT NULL,
  actualizadoEn TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pedidos (
  id            TEXT PRIMARY KEY,
  creadoEn      TEXT NOT NULL,
  estado        TEXT NOT NULL,
  total         REAL NOT NULL DEFAULT 0,
  unidades      INTEGER NOT NULL DEFAULT 0,
  localCarpetas TEXT NOT NULL DEFAULT '[]',
  json          TEXT NOT NULL,
  actualizadoEn TEXT
);

CREATE INDEX IF NOT EXISTS idx_pedidos_creadoEn ON pedidos (creadoEn DESC);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado ON pedidos (estado);

CREATE TABLE IF NOT EXISTS servicios (
  id            TEXT PRIMARY KEY,
  tipo          TEXT NOT NULL,
  creadoEn      TEXT NOT NULL,
  estado        TEXT NOT NULL,
  json          TEXT NOT NULL,
  actualizadoEn TEXT
);

CREATE INDEX IF NOT EXISTS idx_servicios_creadoEn ON servicios (creadoEn DESC);
CREATE INDEX IF NOT EXISTS idx_servicios_tipo ON servicios (tipo);

CREATE TABLE IF NOT EXISTS auditoria (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha   TEXT NOT NULL,
  usuario TEXT,
  rol     TEXT,
  accion  TEXT,
  detalle TEXT,
  ip      TEXT
);

CREATE INDEX IF NOT EXISTS idx_auditoria_id ON auditoria (id DESC);
