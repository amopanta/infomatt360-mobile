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
  takePurgedEvidenceFiles,
  getPendingCount,
  getConflictCount,
  insertCrashLog,
} from '../db/database';
import { useAuthStore } from '../store/authStore';
import type { BulkSavePayload, RecordValue } from '../types';
import { toBackendValues, type FileValue } from './backendValues';
import { fileFingerprint } from '../evidence/evidenceFiles';
import { extensionOf } from '../evidence/fileValues';
import { pullCorrections, pushCorrections } from '../corrections/correctionSync';

export { nestRepeatValues } from './backendValues';

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

// ── Correcciones de registros devueltos (docs/141) ──────────────────

const CORRECTIONS_INTERVAL = 2 * 60_000;
let lastCorrectionsSync = 0;

/** Envía las correcciones hechas y baja las asignadas (diferencial). */
export async function syncCorrections(): Promise<void> {
  const projectId = useAuthStore.getState().activeProjectId;
  if (!projectId) return;
  lastCorrectionsSync = Date.now();
  try {
    await pushCorrections();
    await pullCorrections(projectId);
  } catch {
    // Sin red o servidor caído: se reintenta en el próximo ciclo.
  }
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
  const networkState = await Network.getNetworkStateAsync().catch(() => null);
  if (!networkState?.isConnected || !networkState.isInternetReachable) {
    setStatus('paused_offline');
    scheduleNext(5_000);
    return;
  }

  // Nada pendiente: dormir al intervalo base
  const pending = getPendingCount();
  if (pending === 0) {
    noteSyncedUpToDate();
    // Sin capturas pendientes igual se revisan las devoluciones asignadas.
    if (Date.now() - lastCorrectionsSync > CORRECTIONS_INTERVAL) await syncCorrections();
    setStatus('idle');
    scheduleNext(currentInterval);
    return;
  }

  // Sincronizar. Un error inesperado no puede apagar el ciclo automático.
  let hadFailures = true;
  try {
    hadFailures = await syncNow();
  } catch {
    hadFailures = true;
  }

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

    // 4b. Correcciones de registros devueltos
    await syncCorrections();

    // 5. Limpieza automatica de sincronizados antiguos (doc 107)
    try {
      purgeOldSynced(ENV.SYNCED_RETENTION_DAYS);
      for (const uri of takePurgedEvidenceFiles()) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } catch {
      // Una limpieza fallida no debe detener el envío; se reintenta luego.
    }
    if (!hadFailures && getPendingCount() === 0) noteSyncedUpToDate();
  } finally {
    isSyncing = false;
    setStatus('idle');
  }

  return hadFailures;
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
  for (const rec of listPendingRecords()) {
    for (const ev of fieldEvidence(rec)) {
      if (ev.uploaded) continue;
      await uploadOneEvidence(ev, rec.project_id, rec.participant_id, null);
    }
  }
}

/** Nombre con la extensión real (el servidor la conserva al guardar). */
function uploadNameOf(ev: { local_id: string; file_uri: string; mime_type: string }): string {
  const ext = extensionOf(ev.file_uri) || (ev.mime_type.split('/')[1] ?? 'bin').replace(/[^a-z0-9]/gi, '').slice(0, 5);
  return `${ev.local_id}.${ext}`;
}

/**
 * Sube una evidencia y solo la da por subida si el servidor confirma el
 * mismo tamaño. El MD5 permite al servidor rechazar archivos dañados y la
 * referencia (local_id) que un reintento devuelva el mismo archivo.
 */
async function uploadOneEvidence(
  ev: { local_id: string; type: string; file_uri: string; mime_type: string },
  projectId: string,
  participantId: string | null,
  recordId: string | null,
): Promise<void> {
  const local = await fileFingerprint(ev.file_uri);
  if (!local) {
    insertCrashLog({ level: 'error', message: `Evidencia no encontrada en el teléfono: ${ev.file_uri.split('/').pop()}`, component: 'sync' });
    return;
  }
  try {
    const result = await uploadEvidence(projectId, ev.file_uri, ev.mime_type, uploadNameOf(ev), assetTypeFor(ev.type, ev.mime_type),
      participantId, recordId, { clientRef: ev.local_id, md5: local.md5 });
    if (local.size && result.size_bytes !== local.size) {
      insertCrashLog({ level: 'warning', message: `El servidor recibió ${result.size_bytes} de ${local.size} bytes; se reintentará`, component: 'sync' });
      return;
    }
    markEvidenceUploaded(ev.local_id, result.id, result.size_bytes);
  } catch {
    // Se reintentará en el próximo ciclo (el servidor no duplica por client_ref)
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
    await uploadOneEvidence(ev, ev.project_id, ev.participant_id, ev.server_record_id);
  }
}
