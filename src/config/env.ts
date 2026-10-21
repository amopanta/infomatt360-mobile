/**
 * Configuracion del entorno de la app InfoMatt360 Mobile.
 *
 * API_BASE_URL apunta al backend unificado; el project_id del usuario
 * activo se envia en cada request como header o parametro — no hay
 * endpoints separados por proyecto.
 */

export const ENV = {
  /** URL base de la API (sin barra final) */
  API_BASE_URL: __DEV__
    ? 'http://10.0.2.2:8000/api/v1' // emulador Android → localhost host
    : 'https://infomatt360.tecnomatt.com/api/v1',

  /** Tiempo maximo de espera para requests HTTP (ms) */
  REQUEST_TIMEOUT: 30_000,

  /** Intervalo base de reintento de sincronizacion (ms) */
  SYNC_INTERVAL_BASE: 30_000,

  /** Techo maximo de backoff para reintentos (ms) */
  SYNC_INTERVAL_MAX: 5 * 60_000,

  /** Dias de retencion de registros sincronizados en SQLite */
  SYNCED_RETENTION_DAYS: 7,

  /** Tamano maximo de lote para bulk-save */
  BULK_BATCH_SIZE: 200,

  /** Versión que la app informa al servidor (igual a app.json) */
  APP_VERSION: '1.0.0',

  /** Cada cuánto informa la app su estado al servidor (ms) */
  HEARTBEAT_INTERVAL: 5 * 60_000,

  /** Recorrido del gestor: un punto cada 2 min o al moverse 30 m */
  ROUTE_INTERVAL: 2 * 60_000,
  ROUTE_DISTANCE_M: 30,
};
