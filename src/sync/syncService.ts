/**
 * Servicio de sincronizacion offline → backend.
 *
 * Replica la logica de docs/106 y docs/107:
 *   - Agrupa pendientes por (project_id, template_id)
 *   - Envia un POST /runtime/session/bulk-save por grupo
 *   - Idempotency key = SHA-256 de los local_ids ordenados
 *   - Backoff exponencial: 30s → 1m → 2m → 4m → techo 5m
 *   - Limpieza automatica de sincronizados > 7 dias
 */

import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import * as FileSystem from 'expo-file-system/legacy';
import * as SecureStore from 'expo-secure-store';
import { ENV } from '../config/env';
import { bulkSaveRecords, uploadEvidence } from '../api/syncApi';
import {
  listPendingRecords,
  markRecordSynced,
  markRecordError,
  noteSyncAttemptFailed,
  markRecordConflict,
  getRecordEvidence,
  getCachedForm,
  replaceRecordData,
  listEvidenceAwaitingRecord,
  markEvidenceUploaded,
  purgeOldSynced,
  getPendingCount,
  getConflictCount,
} from '../db/database';
import { useAuthStore } from '../store/authStore';
import type { BulkSavePayload, RecordValue } from '../types';

// ── Estado del servicio ──────────────────────────────────────────────

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let currentInterval = ENV.SYNC_INTERVAL_BASE;
let isSyncing = false;

type SyncStatus = 'idle' | 'syncing' | 'paused_offline' | 'paused_no_session';
let status: SyncStatus = 'idle';
const listeners = new Set<(s: SyncStatus) => void>();

export function onSyncStatusChange(cb: (s: SyncStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((cb) => cb(s));
}

export function getSyncStatus(): SyncStatus {
  return status;
}

// Última vez que el equipo quedó al día con el servidor (se informa en el
// latido de monitoreo). Se guarda para conservarla entre reinicios.
const LAST_SYNC_KEY = 'last_successful_sync_at';
let lastSuccessfulSyncAt: string | null = null;
SecureStore.getItemAsync(LAST_SYNC_KEY).then((v) => { lastSuccessfulSyncAt = lastSuccessfulSyncAt ?? v; }).catch(() => {});

function noteSyncedUpToDate(): void {
  lastSuccessfulSyncAt = new Date().toISOString();
  SecureStore.setItemAsync(LAST_SYNC_KEY, lastSuccessfulSyncAt).catch(() => {});
}

export function getLastSuccessfulSyncAt(): string | null {
  return lastSuccessfulSyncAt;
}

// ── Control del ciclo ────────────────────────────────────────────────

export function startAutoSync(): void {
  if (syncTimer) return; // idempotente
  scheduleNext(0); // primer intento inmediato
}

/**
 * Envía en cuanto se pueda, p. ej. justo después de guardar un registro:
 * con red sincroniza ya; sin red no hace nada y lo enviará el ciclo
 * automático o el aviso de reconexión (connectivityStore).
 */
export async function requestSync(): Promise<void> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (!state.isConnected || !state.isInternetReachable) return;
  } catch {
    return;
  }
  currentInterval = ENV.SYNC_INTERVAL_BASE;
  await syncNow();
}

export function stopAutoSync(): void {
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
  setStatus('idle');
}

function scheduleNext(delayMs: number): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(tick, delayMs);
}

async function tick(): Promise<void> {
  syncTimer = null;

  // Sin sesion: no intentar
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) {
    setStatus('paused_no_session');
    scheduleNext(5_000);
    return;
  }

  // Sin red: esperar
  const networkState = await Network.getNetworkStateAsync();
  if (!networkState.isConnected || !networkState.isInternetReachable) {
    setStatus('paused_offline');
    scheduleNext(5_000);
    return;
  }

  // Nada pendiente: dormir al intervalo base
  const pending = getPendingCount();
  if (pending === 0) {
    noteSyncedUpToDate();
    setStatus('idle');
    scheduleNext(currentInterval);
    return;
  }

  // Sincronizar
  const hadFailures = await syncNow();

  if (hadFailures) {
    currentInterval = Math.min(currentInterval * 2, ENV.SYNC_INTERVAL_MAX);
  } else {
    currentInterval = ENV.SYNC_INTERVAL_BASE;
  }

  scheduleNext(currentInterval);
}

// ── Sincronizacion principal ─────────────────────────────────────────

export async function syncNow(): Promise<boolean> {
  if (isSyncing) return false;
  isSyncing = true;
  setStatus('syncing');
  let hadFailures = false;

  try {
    // 1. Subir las fotos/archivos que van dentro de un campo del formulario
    await uploadFieldEvidence();
    await uploadSignatures();

    // 2. Obtener registros pendientes y agrupar por (project, template).
    // Un registro con fotos de campo aún sin subir espera al siguiente ciclo,
    // para no enviar al servidor rutas que solo existen en el teléfono.
    const records = listPendingRecords().filter((r) =>
      fieldEvidence(r).every((ev) => ev.uploaded) && !hasInlineSignature(r.data_json),
    );
    const groups = new Map<string, typeof records>();

    for (const rec of records) {
      const key = `${rec.project_id}:${rec.template_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(rec);
    }

    // 3. Enviar un bulk-save por grupo
    for (const [, groupRecords] of groups) {
      try {
        // Idempotency key = SHA-256 de los local_ids ordenados
        const sortedIds = groupRecords.map((r) => r.local_id).sort().join(',');
        const idempotencyKey = await Crypto.digestStringAsync(
          Crypto.CryptoDigestAlgorithm.SHA256,
          sortedIds,
        );

        const { project_id, template_id } = groupRecords[0];
        const payload: BulkSavePayload = {
          project_id,
          template_id,
          idempotency_key: idempotencyKey,
          records: groupRecords.map((r) => ({
            project_id,
            template_id,
            participant_id: r.participant_id ?? null,
            status: 'submitted',
            values: toBackendValues(JSON.parse(r.data_json) as RecordValue[], evidenceIdsFor(r.local_id), fieldTypesFor(template_id)),
          })),
        };

        const result = await bulkSaveRecords(payload);

        // Procesar resultados por item; un item sin respuesta queda en error
        // para reintentarlo (misma regla que la PWA, offlineSync.ts).
        const byIndex = new Map(result.results.map((item) => [item.index, item]));
        groupRecords.forEach((rec, index) => {
          const item = byIndex.get(index);
          if (item?.status === 'created' || item?.status === 'queued') {
            markRecordSynced(rec.local_id, item.id ?? null);
          } else if (item?.status === 'conflict') {
            // Conflicto detectado por el servidor: guardar ambas versiones
            markRecordConflict(
              rec.local_id,
              item.server_values ?? [],
              item.id ?? null,
              item.server_updated_at ?? null,
            );
            hadFailures = true;
          } else {
            markRecordError(rec.local_id, item?.error ?? 'El servidor no confirmó este registro');
            hadFailures = true;
          }
        });
      } catch (err: any) {
        // HTTP 409 Conflict: el servidor indica conflicto a nivel de lote
        if (err?.response?.status === 409) {
          const conflictData = err.response.data;
          for (const rec of groupRecords) {
            markRecordConflict(
              rec.local_id,
              conflictData?.server_values ?? [],
              conflictData?.record_id ?? null,
              conflictData?.server_updated_at ?? null,
            );
          }
          hadFailures = true;
        } else {
          hadFailures = true;
          const httpStatus: number | undefined = err?.response?.status;
          for (const rec of groupRecords) {
            if (httpStatus && httpStatus >= 400 && httpStatus < 500) {
              // El servidor rechazó el lote (datos o permisos): requiere revisión.
              markRecordError(rec.local_id, err?.response?.data?.detail ? String(JSON.stringify(err.response.data.detail)) : err.message ?? 'Rechazado por el servidor');
            } else {
              // Sin red, tiempo agotado o servidor caído: sigue pendiente y el
              // ciclo automático lo reintenta (antes quedaba en error para siempre).
              noteSyncAttemptFailed(rec.local_id, err?.message ?? 'Error de red');
            }
          }
        }
      }
    }

    // 4. Evidencias adjuntas: se suben ya vinculadas al registro del servidor
    await uploadAttachedEvidence();

    // 5. Limpieza automatica de sincronizados antiguos (doc 107)
    purgeOldSynced(ENV.SYNCED_RETENTION_DAYS);
    if (!hadFailures && getPendingCount() === 0) noteSyncedUpToDate();
  } finally {
    isSyncing = false;
    setStatus('idle');
  }

  return hadFailures;
}

/** Mismo formato que guarda la web para campos IMAGE/FILE/FINGERPRINT
 * (frontend/src/modules/runtime/api.ts: uploadRuntimeFile). */
type FileValue = { file_asset_id: string; name: string; mime_type: string; size_bytes: number };

/** Ruta local de un valor de campo: texto con la uri, o {uri}/{fileUri}. */
function localUriOf(value: unknown): string | null {
  if (typeof value === 'string') return value.startsWith('file:') || value.startsWith('content:') ? value : null;
  if (value && typeof value === 'object') {
    const v = value as { uri?: unknown; fileUri?: unknown };
    if (typeof v.uri === 'string') return v.uri;
    if (typeof v.fileUri === 'string') return v.fileUri;
  }
  return null;
}

/** Valores locales → contrato del backend (field_value_json como texto JSON).
 * Un campo que apunta a un archivo local ya subido se envía como referencia
 * al archivo del servidor, igual que la web. */
function toBackendValues(
  values: RecordValue[],
  uploaded: Map<string, FileValue>,
  types: Map<string, string>,
): { field_name: string; field_value_json: string }[] {
  const flat = new Map<string, unknown>();
  for (const v of values) {
    const name = v.field_name || v.field_id;
    if (!name || flat.has(name)) continue;
    const uri = localUriOf(v.field_value_json);
    let raw = uri && uploaded.has(uri) ? uploaded.get(uri) : v.field_value_json;
    // Sí/No se captura como texto 'true'/'false'; la web lo guarda como booleano.
    // En grupos repetibles el tipo se busca por el nombre final ("...].acepta").
    const leaf = name.slice(name.lastIndexOf('.') + 1);
    if ((types.get(name) ?? types.get(leaf)) === 'BOOLEAN' && (raw === 'true' || raw === 'false')) raw = raw === 'true';
    flat.set(name, raw ?? null);
  }
  const out: { field_name: string; field_value_json: string }[] = [];
  for (const [name, value] of nestRepeatValues(flat)) {
    out.push({ field_name: name, field_value_json: JSON.stringify(value) });
  }
  return out;
}

/**
 * La app guarda cada campo de un grupo repetible con clave indexada
 * ("integrantes[0].contactos[1].nombre"); el backend y la web esperan el
 * grupo como lista de filas `[{id, index, values}]`, con los anidados dentro
 * de su fila (frontend/src/modules/runtime/repeatEngine.ts).
 */
export function nestRepeatValues(flat: Map<string, unknown>): Map<string, unknown> {
  const out = new Map<string, unknown>();
  const groups = new Map<string, Map<number, Map<string, unknown>>>();
  for (const [key, value] of flat) {
    const match = /^([^[\]]+)\[(\d+)\]\.(.+)$/.exec(key);
    if (!match) { out.set(key, value); continue; }
    const [, group, index, rest] = match;
    const rows = groups.get(group) ?? new Map<number, Map<string, unknown>>();
    groups.set(group, rows);
    const row = rows.get(Number(index)) ?? new Map<string, unknown>();
    rows.set(Number(index), row);
    row.set(rest, value);
  }
  for (const [group, rows] of groups) {
    const ordered = [...rows.keys()].sort((a, b) => a - b);
    out.set(group, ordered.map((index, position) => ({
      id: `${group}_${index + 1}`,
      index: position,
      values: Object.fromEntries(nestRepeatValues(rows.get(index)!)),
    })));
  }
  return out;
}

/** uri local → archivo en el servidor, para las evidencias ya subidas */
function evidenceIdsFor(recordLocalId: string): Map<string, FileValue> {
  const map = new Map<string, FileValue>();
  for (const ev of getRecordEvidence(recordLocalId)) {
    if (!ev.uploaded || !ev.remote_url) continue;
    map.set(ev.file_uri, {
      file_asset_id: ev.remote_url,
      name: ev.file_uri.split('/').pop() ?? ev.local_id,
      mime_type: ev.mime_type,
      size_bytes: ev.file_size ?? 0,
    });
  }
  return map;
}

/** field_name → tipo del backend, según la plantilla guardada en el teléfono. */
function fieldTypesFor(templateId: string): Map<string, string> {
  const types = new Map<string, string>();
  const cached = getCachedForm(templateId);
  if (!cached) return types;
  try {
    for (const page of JSON.parse(cached.schema_json) as any[]) {
      for (const section of page.sections ?? []) {
        for (const row of section.rows ?? []) {
          for (const column of row.columns ?? []) {
            const visit = (component: any) => {
              if (component?.config?.backendType) types.set(component.id, component.config.backendType);
              for (const child of component?.children ?? []) visit(child);
            };
            for (const component of column.components ?? []) visit(component);
          }
        }
      }
    }
  } catch {
    // Plantilla antigua sin backendType: se envían los valores tal cual
  }
  return types;
}

/** La firma se captura como imagen en base64 dentro del valor. */
function isInlineSignature(value: unknown): value is { dataUri: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as any).dataUri === 'string' && (value as any).dataUri.startsWith('data:image'));
}

function hasInlineSignature(dataJson: string): boolean {
  return dataJson.includes('"dataUri":"data:image');
}

/** Evidencias usadas como valor de algún campo del registro (foto, huella...). */
function fieldEvidence(rec: { local_id: string; data_json: string }) {
  return getRecordEvidence(rec.local_id).filter((ev) => rec.data_json.includes(ev.file_uri));
}

/** Tipo de evidencia local → asset_type aceptado por POST /files/upload */
function assetTypeFor(type: string, mime: string): string {
  if (type === 'signature') return 'SIGNATURE';
  if (type === 'fingerprint') return 'FINGERPRINT';
  if (mime.startsWith('image/')) return 'IMAGE';
  if (mime.startsWith('video/')) return 'VIDEO';
  if (mime.startsWith('audio/')) return 'AUDIO';
  if (mime === 'application/pdf') return 'PDF';
  return 'FILE';
}

// ── Subida de evidencias ─────────────────────────────────────────────

/** Fotos/archivos de campo: se suben antes del registro, sin record_id. */
async function uploadFieldEvidence(): Promise<void> {
  const records = listPendingRecords();

  for (const rec of records) {
    for (const ev of fieldEvidence(rec)) {
      if (ev.uploaded) continue;
      try {
        const result = await uploadEvidence(
          rec.project_id,
          ev.file_uri,
          ev.mime_type,
          `${ev.local_id}.${ev.mime_type.split('/')[1] ?? 'bin'}`,
          assetTypeFor(ev.type, ev.mime_type),
          rec.participant_id,
        );
        markEvidenceUploaded(ev.local_id, result.id, result.size_bytes);
      } catch {
        // Se reintentara en el proximo ciclo
      }
    }
  }
}

/** Firmas: se guardan como PNG y se suben como archivo SIGNATURE, igual que
 * la web (RuntimeSignature.tsx), en vez de viajar en base64 dentro del registro. */
async function uploadSignatures(): Promise<void> {
  for (const rec of listPendingRecords()) {
    if (!hasInlineSignature(rec.data_json)) continue;
    const values = JSON.parse(rec.data_json) as RecordValue[];
    let changed = false;
    for (const v of values) {
      if (!isInlineSignature(v.field_value_json)) continue;
      const fileUri = `${FileSystem.cacheDirectory}firma_${rec.local_id}_${v.field_id}.png`;
      try {
        await FileSystem.writeAsStringAsync(fileUri, v.field_value_json.dataUri.split(',')[1] ?? '', {
          encoding: FileSystem.EncodingType.Base64,
        });
        const result = await uploadEvidence(rec.project_id, fileUri, 'image/png', `firma_${v.field_id}.png`, 'SIGNATURE', rec.participant_id);
        v.field_value_json = { file_asset_id: result.id, name: result.original_name, mime_type: 'image/png', size_bytes: result.size_bytes };
        changed = true;
      } catch {
        // Sin red o error del servidor: el registro espera al siguiente ciclo
      } finally {
        await FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      }
    }
    if (changed) replaceRecordData(rec.local_id, values);
  }
}

/** Evidencias adjuntas (pantalla Evidencias): se suben con record_id para que
 * queden vinculadas al registro en el servidor. */
async function uploadAttachedEvidence(): Promise<void> {
  for (const ev of listEvidenceAwaitingRecord()) {
    try {
      const result = await uploadEvidence(
        ev.project_id,
        ev.file_uri,
        ev.mime_type,
        `${ev.local_id}.${ev.mime_type.split('/')[1] ?? 'bin'}`,
        assetTypeFor(ev.type, ev.mime_type),
        ev.participant_id,
        ev.server_record_id,
      );
      markEvidenceUploaded(ev.local_id, result.id, result.size_bytes);
    } catch {
      // Se reintentara en el proximo ciclo
    }
  }
}
