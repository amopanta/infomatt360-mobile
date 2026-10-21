/**
 * Casos longitudinales sin conexión (H08).
 *
 * - cases_cache: copia de los casos visibles para el gestor (con su versión).
 * - case_events_cache: cronología (incluye cambios hechos sin red).
 * - case_outbox: cola de cambios en orden; se envía al reconectar
 *   (caseSync.ts). Un caso creado sin red tiene id "local-..." hasta que el
 *   servidor le asigna el suyo.
 *
 * Un cambio sin enviar nunca se pisa con la copia del servidor: si el caso
 * también cambió allá, queda en conflicto y el gestor decide.
 */

import * as Crypto from 'expo-crypto';
import { getDatabase } from '../db/database';

export interface LocalCase {
  id: string;
  project_id: string;
  participant_id: string;
  case_type: string;
  parent_case_id: string | null;
  title: string;
  status: string;
  assigned_user_id: string | null;
  due_at: string | null;
  properties_json: string;
  version: number;
  updated_at: string | null;
  local_only: number;
}

export interface ServerCase {
  id: string;
  project_id: string;
  participant_id: string;
  case_type: string;
  parent_case_id: string | null;
  title: string;
  status: string;
  assigned_user_id: string | null;
  due_at: string | null;
  properties: Record<string, unknown>;
  version: number;
  updated_at: string | null;
}

export interface ServerCaseEvent { id: string; case_id: string; event_type: string; note: string | null; from_user_id: string; occurred_at?: string | null; created_at: string }

export interface OutboxItem {
  seq: number;
  op: 'create' | 'update';
  case_id: string;
  client_ref: string;
  payload_json: string;
  base_version: number | null;
  occurred_at: string;
  status: 'pending' | 'conflict' | 'error' | 'done' | 'discarded';
  error: string | null;
  server_json: string | null;
}

// Se prepara una vez por base abierta: cada usuario tiene la suya (H07).
const prepared = new WeakSet<object>();
function db() {
  const database = getDatabase();
  if (!prepared.has(database)) {
    database.execSync(`
      CREATE TABLE IF NOT EXISTS cases_cache (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, participant_id TEXT NOT NULL,
        case_type TEXT NOT NULL DEFAULT 'general', parent_case_id TEXT, title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open', assigned_user_id TEXT, due_at TEXT,
        properties_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT, local_only INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_cases_participant ON cases_cache(participant_id);
      CREATE TABLE IF NOT EXISTS case_events_cache (
        id TEXT PRIMARY KEY, case_id TEXT NOT NULL, event_type TEXT NOT NULL, note TEXT,
        from_user_id TEXT, occurred_at TEXT NOT NULL, pending INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_case_events_case ON case_events_cache(case_id, occurred_at);
      CREATE TABLE IF NOT EXISTS case_outbox (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, op TEXT NOT NULL, case_id TEXT NOT NULL,
        client_ref TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL, base_version INTEGER,
        occurred_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, server_json TEXT
      );
    `);
    prepared.add(database);
  }
  return database;
}


function hasOpenChanges(caseId: string): boolean {
  return Boolean(db().getFirstSync(`SELECT 1 FROM case_outbox WHERE case_id = ? AND status IN ('pending', 'conflict', 'error')`, [caseId]));
}

function upsertServerCase(c: ServerCase): void {
  db().runSync(
    `INSERT OR REPLACE INTO cases_cache
       (id, project_id, participant_id, case_type, parent_case_id, title, status, assigned_user_id, due_at, properties_json, version, updated_at, local_only)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [c.id, c.project_id, c.participant_id, c.case_type, c.parent_case_id, c.title, c.status, c.assigned_user_id, c.due_at,
      JSON.stringify(c.properties ?? {}), c.version ?? 1, c.updated_at],
  );
}

/**
 * Copia del servidor para el proyecto. Los casos con cambios sin enviar y los
 * creados sin red se conservan tal como están en el teléfono.
 */
export function applyCasesSnapshot(projectId: string, cases: ServerCase[], events: ServerCaseEvent[]): void {
  const database = db();
  database.execSync('BEGIN');
  try {
    const keep = new Set(
      database.getAllSync<{ id: string }>(
        `SELECT id FROM cases_cache WHERE project_id = ? AND (local_only = 1 OR id IN (SELECT case_id FROM case_outbox WHERE status IN ('pending','conflict','error')))`,
        [projectId],
      ).map((r) => r.id),
    );
    database.runSync(
      `DELETE FROM case_events_cache WHERE pending = 0 AND case_id IN (SELECT id FROM cases_cache WHERE project_id = ?)`,
      [projectId],
    );
    database.runSync(`DELETE FROM cases_cache WHERE project_id = ? AND local_only = 0 AND id NOT IN (${[...keep].map(() => '?').join(',') || "''"})`, [projectId, ...keep]);
    for (const c of cases) if (!keep.has(c.id)) upsertServerCase(c);
    for (const e of events) {
      database.runSync(
        `INSERT OR REPLACE INTO case_events_cache (id, case_id, event_type, note, from_user_id, occurred_at, pending) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [e.id, e.case_id, e.event_type, e.note, e.from_user_id, e.occurred_at ?? e.created_at],
      );
    }
    database.execSync('COMMIT');
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
}

export function listParticipantCases(participantId: string): (LocalCase & { sync_state: 'synced' | 'pending' | 'conflict' | 'error' })[] {
  const rows = db().getAllSync<LocalCase>(`SELECT * FROM cases_cache WHERE participant_id = ? ORDER BY updated_at DESC`, [participantId]);
  return rows.map((row) => {
    const states = db().getAllSync<{ status: string }>(`SELECT status FROM case_outbox WHERE case_id = ? AND status IN ('pending','conflict','error')`, [row.id]).map((s) => s.status);
    const sync_state = states.includes('conflict') ? 'conflict' : states.includes('error') ? 'error' : states.length ? 'pending' : 'synced';
    return { ...row, sync_state };
  });
}

export function getLocalCase(caseId: string): LocalCase | null {
  return db().getFirstSync<LocalCase>(`SELECT * FROM cases_cache WHERE id = ?`, [caseId]);
}

export function listCaseEvents(caseId: string): { id: string; event_type: string; note: string | null; occurred_at: string; pending: number }[] {
  return db().getAllSync(`SELECT id, event_type, note, occurred_at, pending FROM case_events_cache WHERE case_id = ? ORDER BY occurred_at ASC`, [caseId]) as any;
}

function addEvent(caseId: string, eventType: string, note: string | null, occurredAt: string): void {
  db().runSync(
    `INSERT INTO case_events_cache (id, case_id, event_type, note, from_user_id, occurred_at, pending) VALUES (?, ?, ?, ?, NULL, ?, 1)`,
    [`local-${Crypto.randomUUID()}`, caseId, eventType, note, occurredAt],
  );
}

/** Abre un caso sin red. Devuelve su id local ("local-..."). */
export function createCaseOffline(input: { projectId: string; participantId: string; title: string; caseType: string; note?: string; parentCaseId?: string | null }): string {
  const id = `local-${Crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const database = db();
  database.execSync('BEGIN');
  try {
    database.runSync(
      `INSERT INTO cases_cache (id, project_id, participant_id, case_type, parent_case_id, title, status, properties_json, version, updated_at, local_only)
       VALUES (?, ?, ?, ?, ?, ?, 'open', '{}', 0, ?, 1)`,
      [id, input.projectId, input.participantId, input.caseType, input.parentCaseId ?? null, input.title, now],
    );
    database.runSync(
      `INSERT INTO case_outbox (op, case_id, client_ref, payload_json, base_version, occurred_at) VALUES ('create', ?, ?, ?, NULL, ?)`,
      [id, id, JSON.stringify({ participant_id: input.participantId, title: input.title, case_type: input.caseType, parent_case_id: input.parentCaseId ?? null, note: input.note ?? null }), now],
    );
    addEvent(id, 'created', input.note ?? null, now);
    database.execSync('COMMIT');
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
  return id;
}

/** Cambia el estado o agrega una nota sin red. Se aplica de inmediato en el teléfono. */
export function updateCaseOffline(caseId: string, change: { status?: string; note?: string }): void {
  const current = getLocalCase(caseId);
  if (!current) throw new Error('Caso no encontrado en el teléfono');
  const now = new Date().toISOString();
  const database = db();
  database.execSync('BEGIN');
  try {
    if (change.status) database.runSync(`UPDATE cases_cache SET status = ?, updated_at = ? WHERE id = ?`, [change.status, now, caseId]);
    database.runSync(
      `INSERT INTO case_outbox (op, case_id, client_ref, payload_json, base_version, occurred_at) VALUES ('update', ?, ?, ?, ?, ?)`,
      [caseId, `upd-${Crypto.randomUUID()}`, JSON.stringify(change), current.local_only ? null : current.version, now],
    );
    addEvent(caseId, change.status ? 'updated' : 'note', change.note ?? (change.status ? `Estado: ${change.status}` : null), now);
    database.execSync('COMMIT');
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
}

export function pendingOutbox(): OutboxItem[] {
  return db().getAllSync<OutboxItem>(`SELECT * FROM case_outbox WHERE status = 'pending' ORDER BY seq ASC`);
}

export function caseConflicts(): OutboxItem[] {
  return db().getAllSync<OutboxItem>(`SELECT * FROM case_outbox WHERE status = 'conflict' ORDER BY seq ASC`);
}

/** El servidor creó el caso: el id local pasa a ser el del servidor en todas partes. */
export function confirmCreate(item: OutboxItem, server: ServerCase): void {
  const database = db();
  database.execSync('BEGIN');
  try {
    database.runSync(`DELETE FROM cases_cache WHERE id = ?`, [item.case_id]);
    upsertServerCase(server);
    database.runSync(`UPDATE case_outbox SET case_id = ? WHERE case_id = ?`, [server.id, item.case_id]);
    database.runSync(`UPDATE case_events_cache SET case_id = ? WHERE case_id = ?`, [server.id, item.case_id]);
    database.runSync(`UPDATE cases_cache SET parent_case_id = ? WHERE parent_case_id = ?`, [server.id, item.case_id]);
    database.runSync(`UPDATE case_outbox SET payload_json = REPLACE(payload_json, ?, ?) WHERE status = 'pending' AND op = 'create'`, [item.case_id, server.id]);
    // Las ediciones hechas sobre el caso local parten de la versión recién creada
    database.runSync(`UPDATE case_outbox SET base_version = ? WHERE case_id = ? AND op = 'update' AND base_version IS NULL`, [server.version, server.id]);
    database.runSync(`UPDATE case_outbox SET status = 'done' WHERE seq = ?`, [item.seq]);
    database.execSync('COMMIT');
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
}

export function confirmUpdate(item: OutboxItem, server: ServerCase): void {
  const database = db();
  database.execSync('BEGIN');
  try {
    database.runSync(`UPDATE case_outbox SET status = 'done' WHERE seq = ?`, [item.seq]);
    // La siguiente edición pendiente del mismo caso parte de la versión nueva
    database.runSync(`UPDATE case_outbox SET base_version = ? WHERE case_id = ? AND status = 'pending' AND op = 'update'`, [server.version, server.id]);
    if (!hasOpenChanges(server.id)) upsertServerCase(server);
    else database.runSync(`UPDATE cases_cache SET version = ? WHERE id = ?`, [server.version, server.id]);
    database.execSync('COMMIT');
  } catch (error) {
    database.execSync('ROLLBACK');
    throw error;
  }
}

export function markConflict(item: OutboxItem, server: ServerCase): void {
  db().runSync(`UPDATE case_outbox SET status = 'conflict', server_json = ? WHERE seq = ?`, [JSON.stringify(server), item.seq]);
}

export function markOutboxError(item: OutboxItem, message: string): void {
  db().runSync(`UPDATE case_outbox SET status = 'error', error = ? WHERE seq = ?`, [message.slice(0, 500), item.seq]);
}

/** Conflicto: conservar lo del servidor y descartar mi cambio. */
export function resolveKeepServer(seq: number): void {
  const item = db().getFirstSync<OutboxItem>(`SELECT * FROM case_outbox WHERE seq = ?`, [seq]);
  if (!item?.server_json) return;
  db().runSync(`UPDATE case_outbox SET status = 'discarded' WHERE seq = ?`, [seq]);
  if (!hasOpenChanges(item.case_id)) upsertServerCase(JSON.parse(item.server_json));
}

/** Conflicto: volver a aplicar mi cambio sobre la versión actual del servidor. */
export function resolveApplyMine(seq: number): void {
  const item = db().getFirstSync<OutboxItem>(`SELECT * FROM case_outbox WHERE seq = ?`, [seq]);
  if (!item?.server_json) return;
  const server = JSON.parse(item.server_json) as ServerCase;
  db().runSync(`UPDATE case_outbox SET status = 'pending', base_version = ?, server_json = NULL WHERE seq = ?`, [server.version, seq]);
}
