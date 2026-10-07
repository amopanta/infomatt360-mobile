/**
 * Base de datos SQLite local para operacion offline.
 *
 * Tablas:
 *   - form_templates : cache de plantillas descargadas
 *   - queued_records : cola de registros pendientes de sincronizar
 *   - evidence       : archivos multimedia asociados a registros
 *
 * Usa expo-sqlite (sync API de SQLite 3).
 */

import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export function getDatabase(): SQLite.SQLiteDatabase {
  if (!db) {
    db = SQLite.openDatabaseSync('infomatt360.db');
    initializeDatabase(db);
  }
  return db;
}

function initializeDatabase(database: SQLite.SQLiteDatabase): void {
  database.execSync(`PRAGMA journal_mode = WAL;`);
  database.execSync(`PRAGMA foreign_keys = ON;`);

  // Cache de plantillas de formularios
  database.execSync(`
    CREATE TABLE IF NOT EXISTS form_templates (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      template_id TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      description TEXT,
      schema_json TEXT NOT NULL,
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, template_id)
    );
  `);

  // Cola de registros offline (equivalente a indexedDbQueue.ts del PWA)
  database.execSync(`
    CREATE TABLE IF NOT EXISTS queued_records (
      local_id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL,
      template_id INTEGER NOT NULL,
      participant_id INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',
      data_json TEXT NOT NULL,
      evidence_paths_json TEXT NOT NULL DEFAULT '[]',
      gps_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      synced_at TEXT
    );
  `);

  // Migracion: agregar columnas para deteccion de conflictos
  // updated_at: timestamp de la ultima modificacion local
  // server_data_json: datos del servidor cuando hay conflicto
  // server_record_id: ID del registro en el servidor
  // server_updated_at: timestamp del servidor al detectar conflicto
  try {
    database.execSync(`ALTER TABLE queued_records ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'));`);
  } catch { /* columna ya existe */ }
  try {
    database.execSync(`ALTER TABLE queued_records ADD COLUMN server_data_json TEXT;`);
  } catch { /* columna ya existe */ }
  try {
    database.execSync(`ALTER TABLE queued_records ADD COLUMN server_record_id INTEGER;`);
  } catch { /* columna ya existe */ }
  try {
    database.execSync(`ALTER TABLE queued_records ADD COLUMN server_updated_at TEXT;`);
  } catch { /* columna ya existe */ }

  // Indices para consultas frecuentes (SYNC-004, doc 106)
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_queued_status ON queued_records(status);
  `);
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_queued_created ON queued_records(created_at);
  `);
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_queued_project_template
      ON queued_records(project_id, template_id);
  `);

  // Evidencias multimedia
  database.execSync(`
    CREATE TABLE IF NOT EXISTS evidence (
      local_id TEXT PRIMARY KEY,
      record_local_id TEXT NOT NULL,
      type TEXT NOT NULL,
      file_uri TEXT NOT NULL,
      remote_url TEXT,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      gps_json TEXT,
      uploaded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (record_local_id) REFERENCES queued_records(local_id)
    );
  `);

  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_evidence_record ON evidence(record_local_id);
  `);
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_evidence_uploaded ON evidence(uploaded);
  `);

  // Cache de participantes para vista 360
  database.execSync(`
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      document_type TEXT NOT NULL DEFAULT 'CC',
      document_number TEXT NOT NULL,
      code TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      address TEXT,
      extra_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT,
      downloaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, document_number)
    );
  `);
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_participants_project ON participants(project_id);
  `);
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_participants_search
      ON participants(project_id, full_name, document_number, code);
  `);

  // Registro local de errores y crashes
  database.execSync(`
    CREATE TABLE IF NOT EXISTS crash_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level TEXT NOT NULL DEFAULT 'error',
      message TEXT NOT NULL,
      stack TEXT,
      component TEXT,
      extra_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  database.execSync(`
    CREATE INDEX IF NOT EXISTS idx_crash_logs_created ON crash_logs(created_at);
  `);
}

// ── Operaciones de la cola offline ───────────────────────────────────

export function enqueueRecord(record: {
  localId: string;
  projectId: number;
  templateId: number;
  participantId?: number;
  data: unknown[];
  evidencePaths: string[];
  gps?: { lat: number; lng: number; accuracy: number };
}): void {
  const db = getDatabase();
  db.runSync(
    `INSERT INTO queued_records
       (local_id, project_id, template_id, participant_id, status, data_json, evidence_paths_json, gps_json)
     VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      record.localId,
      record.projectId,
      record.templateId,
      record.participantId ?? null,
      JSON.stringify(record.data),
      JSON.stringify(record.evidencePaths),
      record.gps ? JSON.stringify(record.gps) : null,
    ],
  );
}

export function listPendingRecords(): {
  local_id: string;
  project_id: number;
  template_id: number;
  participant_id: number | null;
  data_json: string;
  evidence_paths_json: string;
  gps_json: string | null;
  created_at: string;
}[] {
  const db = getDatabase();
  return db.getAllSync(
    `SELECT local_id, project_id, template_id, participant_id,
            data_json, evidence_paths_json, gps_json, created_at
     FROM queued_records
     WHERE status = 'pending'
     ORDER BY created_at ASC`,
  ) as any;
}

export function markRecordSynced(localId: string): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE queued_records SET status = 'synced', synced_at = datetime('now') WHERE local_id = ?`,
    [localId],
  );
}

export function markRecordError(localId: string, error: string): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE queued_records SET status = 'error', error_message = ? WHERE local_id = ?`,
    [error, localId],
  );
}

export function resetErrorRecords(): void {
  const db = getDatabase();
  db.runSync(`UPDATE queued_records SET status = 'pending', error_message = NULL WHERE status = 'error'`);
}

// ── Operaciones de conflictos ───────────────────────────────────────

/** Marca un registro como conflictivo guardando los datos del servidor */
export function markRecordConflict(
  localId: string,
  serverData: unknown[],
  serverRecordId: number | null,
  serverUpdatedAt: string | null,
): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE queued_records
     SET status = 'conflict',
         error_message = 'Conflicto: el registro fue modificado en el servidor',
         server_data_json = ?,
         server_record_id = ?,
         server_updated_at = ?
     WHERE local_id = ?`,
    [
      JSON.stringify(serverData),
      serverRecordId,
      serverUpdatedAt,
      localId,
    ],
  );
}

/** Lista todos los registros en estado de conflicto */
export function listConflictRecords(): {
  local_id: string;
  project_id: number;
  template_id: number;
  participant_id: number | null;
  data_json: string;
  server_data_json: string | null;
  server_record_id: number | null;
  server_updated_at: string | null;
  created_at: string;
  updated_at: string;
}[] {
  const db = getDatabase();
  return db.getAllSync(
    `SELECT local_id, project_id, template_id, participant_id,
            data_json, server_data_json, server_record_id,
            server_updated_at, created_at, updated_at
     FROM queued_records
     WHERE status = 'conflict'
     ORDER BY updated_at DESC`,
  ) as any;
}

/** Resuelve un conflicto manteniendo los datos locales (re-enviar) */
export function resolveConflictKeepLocal(localId: string): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE queued_records
     SET status = 'pending',
         error_message = NULL,
         server_data_json = NULL,
         server_record_id = NULL,
         server_updated_at = NULL,
         updated_at = datetime('now')
     WHERE local_id = ? AND status = 'conflict'`,
    [localId],
  );
}

/** Resuelve un conflicto aceptando los datos del servidor (descartar local) */
export function resolveConflictKeepServer(localId: string): void {
  const db = getDatabase();
  // Obtener datos del servidor
  const record = db.getFirstSync<{ server_data_json: string | null }>(
    `SELECT server_data_json FROM queued_records WHERE local_id = ?`,
    [localId],
  );

  if (record?.server_data_json) {
    // Reemplazar datos locales con los del servidor y marcar como synced
    db.runSync(
      `UPDATE queued_records
       SET status = 'synced',
           data_json = ?,
           error_message = NULL,
           server_data_json = NULL,
           synced_at = datetime('now')
       WHERE local_id = ? AND status = 'conflict'`,
      [record.server_data_json, localId],
    );
  } else {
    // Sin datos del servidor, simplemente marcar como synced
    db.runSync(
      `UPDATE queued_records
       SET status = 'synced',
           error_message = NULL,
           server_data_json = NULL,
           synced_at = datetime('now')
       WHERE local_id = ? AND status = 'conflict'`,
      [localId],
    );
  }
}

/** Resuelve un conflicto con datos manualmente fusionados */
export function resolveConflictMerged(localId: string, mergedData: unknown[]): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE queued_records
     SET status = 'pending',
         data_json = ?,
         error_message = NULL,
         server_data_json = NULL,
         server_record_id = NULL,
         server_updated_at = NULL,
         updated_at = datetime('now')
     WHERE local_id = ? AND status = 'conflict'`,
    [JSON.stringify(mergedData), localId],
  );
}

/** Conteo de registros en conflicto */
export function getConflictCount(): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM queued_records WHERE status = 'conflict'`,
  );
  return row?.count ?? 0;
}

export function getQueuedRecord(localId: string): {
  local_id: string;
  project_id: number;
  template_id: number;
  participant_id: number | null;
  status: string;
  data_json: string;
  evidence_paths_json: string;
  gps_json: string | null;
  created_at: string;
} | null {
  const db = getDatabase();
  return db.getFirstSync(
    `SELECT * FROM queued_records WHERE local_id = ?`,
    [localId],
  ) as any;
}

export function updateQueuedRecord(localId: string, data: unknown[], gps?: { lat: number; lng: number; accuracy: number }): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE queued_records
     SET data_json = ?, gps_json = ?, status = 'pending', error_message = NULL,
         updated_at = datetime('now'), server_data_json = NULL, server_record_id = NULL, server_updated_at = NULL
     WHERE local_id = ?`,
    [
      JSON.stringify(data),
      gps ? JSON.stringify(gps) : null,
      localId,
    ],
  );
}

/** Guarda o actualiza un borrador auto-guardado (status = 'draft') */
export function saveAutoDraft(params: {
  localId: string;
  projectId: number;
  templateId: number;
  data: unknown[];
  gps?: { lat: number; lng: number; accuracy: number } | null;
}): void {
  const db = getDatabase();
  const existing = db.getFirstSync(
    `SELECT local_id FROM queued_records WHERE local_id = ?`,
    [params.localId],
  );
  if (existing) {
    db.runSync(
      `UPDATE queued_records SET data_json = ?, gps_json = ? WHERE local_id = ?`,
      [JSON.stringify(params.data), params.gps ? JSON.stringify(params.gps) : null, params.localId],
    );
  } else {
    db.runSync(
      `INSERT INTO queued_records
         (local_id, project_id, template_id, participant_id, status, data_json, evidence_paths_json, gps_json)
       VALUES (?, ?, ?, NULL, 'draft', ?, '[]', ?)`,
      [
        params.localId,
        params.projectId,
        params.templateId,
        JSON.stringify(params.data),
        params.gps ? JSON.stringify(params.gps) : null,
      ],
    );
  }
}

/** Promueve un borrador auto-guardado a pendiente */
export function promoteDraftToPending(localId: string): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE queued_records SET status = 'pending' WHERE local_id = ? AND status = 'draft'`,
    [localId],
  );
}

/** Elimina un borrador auto-guardado */
export function deleteAutoDraft(localId: string): void {
  const db = getDatabase();
  db.runSync(`DELETE FROM queued_records WHERE local_id = ? AND status = 'draft'`, [localId]);
}

export function deleteQueuedRecord(localId: string): void {
  const db = getDatabase();
  // Eliminar evidencias asociadas primero
  db.runSync(`DELETE FROM evidence WHERE record_local_id = ?`, [localId]);
  // Eliminar el registro
  db.runSync(`DELETE FROM queued_records WHERE local_id = ?`, [localId]);
}

/** Conteo de registros agrupados por template_id y status */
export function getRecordCountsByTemplate(): Record<number, { pending: number; synced: number; error: number; draft: number; conflict: number }> {
  const db = getDatabase();
  const rows = db.getAllSync<{ template_id: number; status: string; count: number }>(
    `SELECT template_id, status, COUNT(*) as count FROM queued_records GROUP BY template_id, status`,
  );
  const result: Record<number, { pending: number; synced: number; error: number; draft: number; conflict: number }> = {};
  for (const row of rows) {
    if (!result[row.template_id]) {
      result[row.template_id] = { pending: 0, synced: 0, error: 0, draft: 0, conflict: 0 };
    }
    const key = row.status as 'pending' | 'synced' | 'error' | 'draft' | 'conflict';
    if (key in result[row.template_id]) {
      result[row.template_id][key] = row.count;
    }
  }
  return result;
}

/**
 * Estadísticas por formulario filtradas por rango de fechas.
 */
export function getStatsByTemplate(dateFrom?: string, dateTo?: string): {
  templateId: number;
  templateName: string;
  total: number;
  synced: number;
  pending: number;
  error: number;
  draft: number;
  conflict: number;
  evidenceCount: number;
}[] {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (dateFrom) {
    conditions.push(`qr.created_at >= ?`);
    params.push(dateFrom);
  }
  if (dateTo) {
    // Include the full end day
    conditions.push(`qr.created_at < datetime(?, '+1 day')`);
    params.push(dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.getAllSync<{
    template_id: number;
    template_name: string;
    total: number;
    synced: number;
    pending: number;
    error: number;
    draft: number;
    conflict: number;
    evidence_count: number;
  }>(
    `SELECT
       qr.template_id,
       COALESCE(ft.name, 'Formulario #' || qr.template_id) as template_name,
       COUNT(DISTINCT qr.local_id) as total,
       SUM(CASE WHEN qr.status = 'synced' THEN 1 ELSE 0 END) as synced,
       SUM(CASE WHEN qr.status = 'pending' OR qr.status = 'syncing' THEN 1 ELSE 0 END) as pending,
       SUM(CASE WHEN qr.status = 'error' THEN 1 ELSE 0 END) as error,
       SUM(CASE WHEN qr.status = 'draft' THEN 1 ELSE 0 END) as draft,
       SUM(CASE WHEN qr.status = 'conflict' THEN 1 ELSE 0 END) as conflict,
       COUNT(e.local_id) as evidence_count
     FROM queued_records qr
     LEFT JOIN form_templates ft ON ft.id = qr.template_id
     LEFT JOIN evidence e ON e.record_local_id = qr.local_id
     ${whereClause}
     GROUP BY qr.template_id
     ORDER BY total DESC`,
    params,
  );

  return rows.map((r) => ({
    templateId: r.template_id,
    templateName: r.template_name,
    total: r.total,
    synced: r.synced,
    pending: r.pending,
    error: r.error,
    draft: r.draft,
    conflict: r.conflict,
    evidenceCount: r.evidence_count,
  }));
}

/**
 * Totales globales filtrados por rango de fechas.
 */
export function getGlobalStats(dateFrom?: string, dateTo?: string): {
  total: number;
  synced: number;
  pending: number;
  error: number;
  draft: number;
  conflict: number;
  evidenceCount: number;
  templateCount: number;
} {
  const db = getDatabase();
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (dateFrom) {
    conditions.push(`created_at >= ?`);
    params.push(dateFrom);
  }
  if (dateTo) {
    conditions.push(`created_at < datetime(?, '+1 day')`);
    params.push(dateTo);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const row = db.getFirstSync<{
    total: number;
    synced: number;
    pending: number;
    error: number;
    draft: number;
    conflict: number;
    template_count: number;
  }>(
    `SELECT
       COUNT(*) as total,
       SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) as synced,
       SUM(CASE WHEN status = 'pending' OR status = 'syncing' THEN 1 ELSE 0 END) as pending,
       SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error,
       SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft,
       SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) as conflict,
       COUNT(DISTINCT template_id) as template_count
     FROM queued_records ${whereClause}`,
    params,
  );

  const evRow = db.getFirstSync<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM evidence WHERE record_local_id IN (
       SELECT local_id FROM queued_records ${whereClause}
     )`,
    params,
  );

  return {
    total: row?.total ?? 0,
    synced: row?.synced ?? 0,
    pending: row?.pending ?? 0,
    error: row?.error ?? 0,
    draft: row?.draft ?? 0,
    conflict: row?.conflict ?? 0,
    evidenceCount: evRow?.cnt ?? 0,
    templateCount: row?.template_count ?? 0,
  };
}

/** Estadisticas de cobertura de participantes */
export function getParticipantCoverageStats(projectId: number): {
  totalParticipants: number;
  withRecords: number;
  withoutRecords: number;
  coveragePercent: number;
} {
  const db = getDatabase();

  const total = db.getFirstSync<{ cnt: number }>(
    'SELECT COUNT(*) as cnt FROM participants WHERE project_id = ?',
    [projectId],
  );

  const withRecs = db.getFirstSync<{ cnt: number }>(
    `SELECT COUNT(DISTINCT participant_id) as cnt
     FROM queued_records
     WHERE project_id = ? AND participant_id IS NOT NULL AND status != 'draft'`,
    [projectId],
  );

  const totalCount = total?.cnt ?? 0;
  const withCount = withRecs?.cnt ?? 0;

  return {
    totalParticipants: totalCount,
    withRecords: withCount,
    withoutRecords: totalCount - withCount,
    coveragePercent: totalCount > 0 ? Math.round((withCount / totalCount) * 100) : 0,
  };
}

/** Actividad diaria — registros por dia en un rango de fechas */
export function getDailyActivity(
  fromDate?: string,
  toDate?: string,
  days: number = 14,
): {
  date: string;
  count: number;
  synced: number;
  pending: number;
}[] {
  const db = getDatabase();

  let whereClause: string;
  let params: (string | number)[];

  if (fromDate && toDate) {
    whereClause = `WHERE created_at >= ? AND created_at < datetime(?, '+1 day')`;
    params = [fromDate, toDate];
  } else {
    whereClause = `WHERE created_at >= date('now', ? || ' days')`;
    params = [`-${days}`];
  }

  const rows = db.getAllSync<{
    day: string;
    total: number;
    synced: number;
    pending: number;
  }>(
    `SELECT
       date(created_at) as day,
       COUNT(*) as total,
       SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) as synced,
       SUM(CASE WHEN status IN ('pending', 'syncing', 'error') THEN 1 ELSE 0 END) as pending
     FROM queued_records
     ${whereClause}
     GROUP BY date(created_at)
     ORDER BY day ASC`,
    params,
  );

  return rows.map((r) => ({
    date: r.day,
    count: r.total,
    synced: r.synced,
    pending: r.pending,
  }));
}

/** Productividad — registros por hora del dia */
export function getHourlyDistribution(
  fromDate?: string,
  toDate?: string,
): { hour: number; count: number }[] {
  const db = getDatabase();

  let dateFilter = '';
  const params: string[] = [];

  if (fromDate && toDate) {
    dateFilter = ` AND created_at >= ? AND created_at < datetime(?, '+1 day')`;
    params.push(fromDate, toDate);
  }

  const rows = db.getAllSync<{ h: number; cnt: number }>(
    `SELECT CAST(strftime('%H', created_at) AS INTEGER) as h, COUNT(*) as cnt
     FROM queued_records
     WHERE status != 'draft'${dateFilter}
     GROUP BY h
     ORDER BY h ASC`,
    params,
  );
  return rows.map((r) => ({ hour: r.h, count: r.cnt }));
}

export function getPendingCount(): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM queued_records WHERE status = 'pending'`,
  );
  return row?.count ?? 0;
}

export function purgeOldSynced(retentionDays: number = 7): number {
  const db = getDatabase();
  const result = db.runSync(
    `DELETE FROM queued_records
     WHERE status = 'synced'
       AND synced_at < datetime('now', ? || ' days')`,
    [`-${retentionDays}`],
  );
  return result.changes;
}

/** Lista todos los registros (para exportacion) */
export function listAllRecords(filters?: {
  projectId?: number;
  templateId?: number;
  status?: string;
  fromDate?: string;
  toDate?: string;
}): {
  local_id: string;
  project_id: number;
  template_id: number;
  participant_id: number | null;
  status: string;
  data_json: string;
  gps_json: string | null;
  created_at: string;
  updated_at: string;
  synced_at: string | null;
}[] {
  const db = getDatabase();
  let query = `SELECT local_id, project_id, template_id, participant_id,
                      status, data_json, gps_json, created_at, updated_at, synced_at
               FROM queued_records WHERE 1=1`;
  const params: (string | number | null)[] = [];

  if (filters?.projectId) {
    query += ` AND project_id = ?`;
    params.push(filters.projectId);
  }
  if (filters?.templateId) {
    query += ` AND template_id = ?`;
    params.push(filters.templateId);
  }
  if (filters?.status) {
    query += ` AND status = ?`;
    params.push(filters.status);
  }
  if (filters?.fromDate) {
    query += ` AND created_at >= ?`;
    params.push(filters.fromDate);
  }
  if (filters?.toDate) {
    query += ` AND created_at < datetime(?, '+1 day')`;
    params.push(filters.toDate);
  }

  query += ` ORDER BY created_at DESC`;
  return db.getAllSync(query, params) as any;
}

// ── Operaciones de evidencias ────────────────────────────────────────

export function insertEvidence(evidence: {
  localId: string;
  recordLocalId: string;
  type: string;
  fileUri: string;
  mimeType: string;
  fileSize: number;
  gps?: { lat: number; lng: number; accuracy: number };
}): void {
  const db = getDatabase();
  db.runSync(
    `INSERT INTO evidence
       (local_id, record_local_id, type, file_uri, mime_type, file_size, gps_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      evidence.localId,
      evidence.recordLocalId,
      evidence.type,
      evidence.fileUri,
      evidence.mimeType,
      evidence.fileSize,
      evidence.gps ? JSON.stringify(evidence.gps) : null,
    ],
  );
}

export function getRecordEvidence(recordLocalId: string): {
  local_id: string;
  type: string;
  file_uri: string;
  remote_url: string | null;
  mime_type: string;
  uploaded: number;
}[] {
  const db = getDatabase();
  return db.getAllSync(
    `SELECT local_id, type, file_uri, remote_url, mime_type, uploaded
     FROM evidence WHERE record_local_id = ?`,
    [recordLocalId],
  ) as any;
}

export function markEvidenceUploaded(localId: string, remoteUrl: string): void {
  const db = getDatabase();
  db.runSync(
    `UPDATE evidence SET uploaded = 1, remote_url = ? WHERE local_id = ?`,
    [remoteUrl, localId],
  );
}

export function getPendingEvidenceCount(): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM evidence WHERE uploaded = 0`,
  );
  return row?.count ?? 0;
}

// ── Cache de formularios ─────────────────────────────────────────────

export function cacheFormTemplate(template: {
  id: number;
  projectId: number;
  templateId: string;
  version: number;
  name: string;
  description?: string;
  schemaJson: string;
}): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO form_templates
       (id, project_id, template_id, version, name, description, schema_json, downloaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      template.id,
      template.projectId,
      template.templateId,
      template.version,
      template.name,
      template.description ?? null,
      template.schemaJson,
    ],
  );
}

export function getCachedForms(projectId: number): {
  id: number;
  project_id: number;
  template_id: string;
  version: number;
  name: string;
  description: string | null;
  schema_json: string;
}[] {
  const db = getDatabase();
  return db.getAllSync(
    `SELECT * FROM form_templates WHERE project_id = ? ORDER BY name`,
    [projectId],
  ) as any;
}

export function getCachedForm(formId: number): {
  id: number;
  schema_json: string;
  name: string;
  version: number;
} | null {
  const db = getDatabase();
  return db.getFirstSync(
    `SELECT id, schema_json, name, version FROM form_templates WHERE id = ?`,
    [formId],
  ) as any;
}

// ── Crash logs ──────────────────────────────────────────────────────

export function insertCrashLog(log: {
  level: 'error' | 'warning' | 'fatal';
  message: string;
  stack?: string;
  component?: string;
  extra?: Record<string, unknown>;
}): void {
  const db = getDatabase();
  db.runSync(
    `INSERT INTO crash_logs (level, message, stack, component, extra_json)
     VALUES (?, ?, ?, ?, ?)`,
    [
      log.level,
      log.message,
      log.stack ?? null,
      log.component ?? null,
      log.extra ? JSON.stringify(log.extra) : null,
    ],
  );
}

export function getCrashLogs(limit: number = 50): {
  id: number;
  level: string;
  message: string;
  stack: string | null;
  component: string | null;
  extra_json: string | null;
  created_at: string;
}[] {
  const db = getDatabase();
  return db.getAllSync(
    `SELECT * FROM crash_logs ORDER BY created_at DESC LIMIT ?`,
    [limit],
  ) as any;
}

export function getCrashLogCount(): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM crash_logs`,
  );
  return row?.count ?? 0;
}

export function clearCrashLogs(): void {
  const db = getDatabase();
  db.runSync(`DELETE FROM crash_logs`);
}

// ── Operaciones de participantes (Vista 360) ───────────────────────

/** Guarda o actualiza un participante en cache local */
export function cacheParticipant(p: {
  id: number;
  projectId: number;
  fullName: string;
  documentType: string;
  documentNumber: string;
  code: string;
  phone?: string;
  email?: string;
  address?: string;
  extraJson?: string;
  createdAt?: string;
  updatedAt?: string;
}): void {
  const db = getDatabase();
  db.runSync(
    `INSERT OR REPLACE INTO participants
       (id, project_id, full_name, document_type, document_number, code,
        phone, email, address, extra_json, created_at, updated_at, downloaded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      p.id,
      p.projectId,
      p.fullName,
      p.documentType,
      p.documentNumber,
      p.code,
      p.phone ?? null,
      p.email ?? null,
      p.address ?? null,
      p.extraJson ?? null,
      p.createdAt ?? new Date().toISOString(),
      p.updatedAt ?? null,
    ],
  );
}

/** Lista participantes de un proyecto con búsqueda opcional */
export function getCachedParticipants(
  projectId: number,
  search?: string,
): {
  id: number;
  project_id: number;
  full_name: string;
  document_type: string;
  document_number: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
}[] {
  const db = getDatabase();

  if (search && search.trim()) {
    const q = `%${search.trim()}%`;
    return db.getAllSync(
      `SELECT id, project_id, full_name, document_type, document_number,
              code, phone, email, address
       FROM participants
       WHERE project_id = ?
         AND (full_name LIKE ? OR document_number LIKE ? OR code LIKE ?)
       ORDER BY full_name COLLATE NOCASE
       LIMIT 200`,
      [projectId, q, q, q],
    ) as any;
  }

  return db.getAllSync(
    `SELECT id, project_id, full_name, document_type, document_number,
            code, phone, email, address
     FROM participants
     WHERE project_id = ?
     ORDER BY full_name COLLATE NOCASE
     LIMIT 200`,
    [projectId],
  ) as any;
}

/** Obtiene un participante por ID */
export function getCachedParticipant(participantId: number): {
  id: number;
  project_id: number;
  full_name: string;
  document_type: string;
  document_number: string;
  code: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  extra_json: string | null;
} | null {
  const db = getDatabase();
  return db.getFirstSync(
    `SELECT id, project_id, full_name, document_type, document_number,
            code, phone, email, address, extra_json
     FROM participants WHERE id = ?`,
    [participantId],
  ) as any;
}

/** Obtiene los formularios asociados a un participante con estado de aplicación */
export function getParticipantFormStatus(
  participantId: number,
  projectId: number,
): {
  template_id: number;
  form_name: string;
  applied: boolean;
  applied_at: string | null;
  record_local_id: string | null;
  record_status: string | null;
}[] {
  const db = getDatabase();

  // Obtener todos los formularios cerrados (que tienen registros con participant_id)
  // y cruzar con los registros del participante
  return db.getAllSync(
    `SELECT
       ft.id as template_id,
       ft.name as form_name,
       CASE WHEN qr.local_id IS NOT NULL THEN 1 ELSE 0 END as applied,
       qr.created_at as applied_at,
       qr.local_id as record_local_id,
       qr.status as record_status
     FROM form_templates ft
     LEFT JOIN queued_records qr
       ON qr.template_id = ft.id
       AND qr.participant_id = ?
       AND qr.status != 'draft'
     WHERE ft.project_id = ?
     ORDER BY ft.name`,
    [participantId, projectId],
  ) as any;
}

/** Conteo de participantes en cache por proyecto */
export function getParticipantCount(projectId: number): number {
  const db = getDatabase();
  const row = db.getFirstSync<{ count: number }>(
    `SELECT COUNT(*) as count FROM participants WHERE project_id = ?`,
    [projectId],
  );
  return row?.count ?? 0;
}
