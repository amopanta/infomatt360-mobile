/**
 * Correcciones asignadas a este usuario (docs/141 §7), en la base local.
 *
 * Estados locales:
 *   returned            → bajado del servidor, se puede corregir
 *   correction_pending  → corregido y guardado, falta enviarlo
 *   correction_conflict → el registro cambió en el servidor mientras se corregía
 *   correction_error    → el servidor lo rechazó (p. ej. ya no le corresponde)
 * La copia original del servidor queda en server_data_json para enviar solo
 * los campos que cambiaron.
 */

import * as Crypto from 'expo-crypto';
import { getDatabase } from '../db/database';

export const CORRECTION_STATUSES = ['returned', 'correction_pending', 'correction_conflict', 'correction_error'] as const;

export interface ServerObservation {
  id: string;
  field_name: string | null;
  repeat_path: string | null;
  reason: string;
  requested_action: string | null;
  status: string;
}

export interface LocalCorrection {
  local_id: string;
  server_record_id: string;
  project_id: string;
  template_id: string;
  participant_id: string | null;
  status: string;
  data_json: string;
  server_data_json: string | null;
  lock_version: number | null;
  observations_json: string | null;
  error_message: string | null;
}

// Las columnas lock_version y observations_json las crea database.ts al abrir la base.
const db = getDatabase;

export function getCorrectionByServerId(serverRecordId: string): LocalCorrection | null {
  return db().getFirstSync<LocalCorrection>(
    `SELECT local_id, server_record_id, project_id, template_id, participant_id, status, data_json, server_data_json, lock_version, observations_json, error_message
     FROM queued_records WHERE server_record_id = ? AND status IN ('returned','correction_pending','correction_conflict','correction_error')`,
    [serverRecordId],
  );
}

export function getCorrection(localId: string): LocalCorrection | null {
  return db().getFirstSync<LocalCorrection>(
    `SELECT local_id, server_record_id, project_id, template_id, participant_id, status, data_json, server_data_json, lock_version, observations_json, error_message
     FROM queued_records WHERE local_id = ?`,
    [localId],
  );
}

export function listCorrections(projectId: string): LocalCorrection[] {
  return db().getAllSync<LocalCorrection>(
    `SELECT local_id, server_record_id, project_id, template_id, participant_id, status, data_json, server_data_json, lock_version, observations_json, error_message
     FROM queued_records WHERE project_id = ? AND status IN ('returned','correction_pending','correction_conflict','correction_error') ORDER BY created_at DESC`,
    [projectId],
  );
}

export function correctionsToSend(): LocalCorrection[] {
  return db().getAllSync<LocalCorrection>(
    `SELECT local_id, server_record_id, project_id, template_id, participant_id, status, data_json, server_data_json, lock_version, observations_json, error_message
     FROM queued_records WHERE status = 'correction_pending' ORDER BY updated_at ASC`,
  );
}

/** Guarda (o reemplaza) la copia del servidor de un registro a corregir. */
export function storeCorrection(input: {
  serverRecordId: string; projectId: string; templateId: string; participantId: string | null;
  values: Record<string, unknown>; lockVersion: number; observations: ServerObservation[];
}): string {
  const existing = getCorrectionByServerId(input.serverRecordId);
  const data = JSON.stringify(Object.entries(input.values).map(([id, v]) => ({ field_id: id, field_name: id, field_value_json: v })));
  if (existing) {
    db().runSync(
      `UPDATE queued_records SET status = 'returned', data_json = ?, server_data_json = ?, lock_version = ?, observations_json = ?, error_message = NULL, updated_at = datetime('now') WHERE local_id = ?`,
      [data, data, input.lockVersion, JSON.stringify(input.observations), existing.local_id],
    );
    return existing.local_id;
  }
  const localId = `corr-${Crypto.randomUUID()}`;
  db().runSync(
    `INSERT INTO queued_records (local_id, project_id, template_id, participant_id, status, data_json, evidence_paths_json, server_record_id, server_data_json, lock_version, observations_json)
     VALUES (?, ?, ?, ?, 'returned', ?, '[]', ?, ?, ?, ?)`,
    [localId, input.projectId, input.templateId, input.participantId, data, input.serverRecordId, data, input.lockVersion, JSON.stringify(input.observations)],
  );
  return localId;
}

/** Sincronización diferencial: misma versión → solo cambian las observaciones. */
export function updateCorrectionObservations(localId: string, observations: ServerObservation[]): void {
  db().runSync(`UPDATE queued_records SET observations_json = ? WHERE local_id = ?`, [JSON.stringify(observations), localId]);
}

/** El gestor guardó su corrección: queda lista para enviar al reconectar. */
export function saveCorrectionEdits(localId: string, values: Record<string, unknown>, correctedObservationIds: string[]): void {
  const row = getCorrection(localId);
  if (!row) throw new Error('Corrección no encontrada en el teléfono');
  const observations = (JSON.parse(row.observations_json || '[]') as ServerObservation[])
    .map((o) => (correctedObservationIds.includes(o.id) && ['pending', 'in_correction', 'rejected'].includes(o.status) ? { ...o, status: 'corrected', local: true } : o));
  db().runSync(
    `UPDATE queued_records SET status = 'correction_pending', data_json = ?, observations_json = ?, error_message = NULL, updated_at = datetime('now') WHERE local_id = ?`,
    [JSON.stringify(Object.entries(values).map(([id, v]) => ({ field_id: id, field_name: id, field_value_json: v }))), JSON.stringify(observations), localId],
  );
}

export function markCorrectionSent(localId: string): void {
  // Ya está en el servidor: se guarda como enviado (solo lectura) para consulta.
  db().runSync(`UPDATE queued_records SET status = 'synced', synced_at = datetime('now'), error_message = NULL WHERE local_id = ?`, [localId]);
}

export function markCorrectionState(localId: string, status: 'correction_conflict' | 'correction_error', message: string): void {
  db().runSync(`UPDATE queued_records SET status = ?, error_message = ? WHERE local_id = ?`, [status, message.slice(0, 500), localId]);
}

export function setCorrectionLockVersion(localId: string, lockVersion: number): void {
  db().runSync(`UPDATE queued_records SET lock_version = ? WHERE local_id = ?`, [lockVersion, localId]);
}

/** Ya no le corresponde (reasignada, aprobada...): se retira si no tiene cambios sin enviar. */
export function withdrawCorrection(localId: string): 'removed' | 'kept' {
  const row = getCorrection(localId);
  if (!row) return 'removed';
  if (row.status === 'returned') {
    db().runSync(`DELETE FROM queued_records WHERE local_id = ?`, [localId]);
    return 'removed';
  }
  if (row.status === 'correction_pending') {
    markCorrectionState(localId, 'correction_error', 'Esta corrección ya no le corresponde; sus cambios se conservan en el teléfono.');
  }
  return 'kept';
}

/** Archivo del servidor que ya está en el teléfono (lo subió este equipo). */
export function localFileForAsset(assetId: string): string | null {
  return db().getFirstSync<{ file_uri: string }>(`SELECT file_uri FROM evidence WHERE remote_url = ? LIMIT 1`, [assetId])?.file_uri ?? null;
}

/** El gestor pidió descartar sus cambios: el próximo ciclo baja la versión vigente del servidor. */
export function discardCorrection(localId: string): void {
  db().runSync(`DELETE FROM queued_records WHERE local_id = ? AND status IN ('returned','correction_pending','correction_conflict','correction_error')`, [localId]);
}
