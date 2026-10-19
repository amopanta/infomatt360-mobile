/**
 * Ida y vuelta de correcciones con el servidor (docs/141 §7).
 *
 * Bajar: /review/my-corrections → por cada registro asignado:
 *   - ya en el teléfono con la misma versión: solo se actualizan las
 *     observaciones (sin volver a bajar respuestas ni archivos);
 *   - nuevo o con otra versión (y sin cambios locales): se baja el paquete y
 *     solo los adjuntos que el teléfono no tiene;
 *   - con cambios locales y otra versión en el servidor: conflicto.
 * Lo que ya no está asignado se retira (sin perder cambios sin enviar).
 *
 * Subir: solo los campos que cambiaron, con la versión del registro
 * (expected_lock_version); luego las observaciones marcadas y el reenvío.
 */

import * as FileSystem from 'expo-file-system/legacy';
import api from '../api/client';
import { nestRepeatValues, flattenServerValues } from '../sync/backendValues';
import { useAuthStore } from '../store/authStore';
import { useServerStore } from '../store/serverStore';
import { EVIDENCE_DIR, fileFingerprint } from '../evidence/evidenceFiles';
import { mimeFor, type LocalFileValue } from '../evidence/fileValues';
import { uploadEvidence } from '../api/syncApi';
import {
  correctionsToSend, getCorrectionByServerId, listCorrections, localFileForAsset, markCorrectionSent,
  markCorrectionState, setCorrectionLockVersion, storeCorrection, updateCorrectionObservations, withdrawCorrection,
  type ServerObservation,
} from './correctionStore';

type Assigned = { record_id: string; template_id: string; participant_id: string | null; status: string; lock_version: number };
type Package = {
  record_id: string; project_id: string; template_id: string; participant_id: string | null; lock_version: number;
  values: { field_name: string; field_value_json: string }[];
  observations: ServerObservation[];
  attachments: { file_asset_id: string; name: string; mime_type: string | null; size_bytes: number }[];
};
type FileRef = { file_asset_id: string; name?: string; mime_type?: string; size_bytes?: number };

const isFileRef = (v: unknown): v is FileRef => Boolean(v && typeof v === 'object' && typeof (v as FileRef).file_asset_id === 'string');

/** Archivo del servidor → archivo local para verlo y corregir sin red. */
async function localizeFiles(values: Record<string, unknown>, downloaded: Set<string>): Promise<Record<string, unknown>> {
  const token = useAuthStore.getState().accessToken;
  const base = useServerStore.getState().getEffectiveUrl();
  const localize = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(localize));
    // Ubicación guardada como GeoJSON (web, cargas) → formato de la app
    const geo = value as { type?: unknown; coordinates?: unknown };
    if (geo && typeof geo === 'object' && geo.type === 'Point' && Array.isArray(geo.coordinates) && geo.coordinates.length >= 2) {
      return { lat: Number(geo.coordinates[1]), lng: Number(geo.coordinates[0]), accuracy: 0 };
    }
    if (!isFileRef(value)) return value;
    const ref = value;
    let uri = localFileForAsset(ref.file_asset_id);
    if (!uri) {
      await FileSystem.makeDirectoryAsync(EVIDENCE_DIR, { intermediates: true }).catch(() => {});
      const target = `${EVIDENCE_DIR}srv-${ref.file_asset_id}`;
      const info = await FileSystem.getInfoAsync(target).catch(() => null);
      if (!info?.exists) {
        const result = await FileSystem.downloadAsync(`${base}/files/${ref.file_asset_id}/download`, target, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (result.status !== 200) return value; // sin permiso o caído: queda la referencia
        downloaded.add(ref.file_asset_id);
      }
      uri = target;
    }
    return { uri, type: 'file', fileName: ref.name, mimeType: ref.mime_type, fileSize: ref.size_bytes, server_file: ref };
  };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) out[key] = await localize(value);
  return out;
}

export async function pullCorrections(projectId: string): Promise<{ new: number; observationsOnly: number; conflicts: number; withdrawn: number; filesDownloaded: number }> {
  const { data: assigned } = await api.get<Assigned[]>(`/review/my-corrections/${projectId}`);
  const summary = { new: 0, observationsOnly: 0, conflicts: 0, withdrawn: 0, filesDownloaded: 0 };
  const downloaded = new Set<string>();
  for (const item of assigned) {
    const local = getCorrectionByServerId(item.record_id);
    if (local && local.lock_version === item.lock_version) {
      const { data: observations } = await api.get<ServerObservation[]>(`/review/records/${item.record_id}/observations`);
      if (local.status === 'returned') updateCorrectionObservations(local.local_id, observations);
      summary.observationsOnly += 1;
      continue;
    }
    if (local && local.status === 'correction_pending') {
      markCorrectionState(local.local_id, 'correction_conflict', 'El registro cambió en el servidor mientras se corregía; sus cambios se conservan.');
      summary.conflicts += 1;
      continue;
    }
    const { data: pkg } = await api.get<Package>(`/review/records/${item.record_id}/correction-package`);
    storeCorrection({
      serverRecordId: pkg.record_id, projectId: pkg.project_id, templateId: pkg.template_id, participantId: pkg.participant_id,
      values: await localizeFiles(flattenServerValues(pkg.values), downloaded), lockVersion: pkg.lock_version, observations: pkg.observations,
    });
    summary.new += 1;
  }
  const assignedIds = new Set(assigned.map((a) => a.record_id));
  for (const local of listCorrections(projectId)) {
    if (!assignedIds.has(local.server_record_id) && local.status !== 'correction_error' && withdrawCorrection(local.local_id) === 'removed') summary.withdrawn += 1;
  }
  summary.filesDownloaded = downloaded.size;
  return summary;
}

/** Valor local → contrato del servidor (archivos bajados vuelven a su referencia). */
function toServer(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toServer);
  if (value && typeof value === 'object' && 'server_file' in (value as object)) return (value as { server_file: FileRef }).server_file;
  return value;
}

function nested(dataJson: string | null): Map<string, unknown> {
  const flat = new Map<string, unknown>();
  for (const v of JSON.parse(dataJson || '[]') as { field_name: string; field_value_json: unknown }[]) flat.set(v.field_name, toServer(v.field_value_json));
  return nestRepeatValues(flat);
}

const ASSET_TYPE: Record<string, string> = { photo: 'IMAGE', document: 'PDF', audio: 'AUDIO', video: 'VIDEO', fingerprint: 'FINGERPRINT', file: 'FILE' };

/** Archivos nuevos de la corrección: se suben al registro y quedan como referencia del servidor. */
async function uploadNewFiles(dataJson: string, projectId: string, recordId: string, participantId: string | null): Promise<string> {
  const rows = JSON.parse(dataJson || '[]') as { field_id: string; field_name: string; field_value_json: unknown }[];
  const upload = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(upload));
    const file = value as LocalFileValue & { server_file?: FileRef };
    if (!file || typeof file !== 'object' || typeof file.uri !== 'string' || file.server_file || !/^(file|content):/.test(file.uri)) return value;
    const mime = mimeFor(file);
    const local = await fileFingerprint(file.uri);
    const uploaded = await uploadEvidence(projectId, file.uri, mime, file.fileName ?? 'archivo', ASSET_TYPE[file.type] ?? 'FILE', participantId, recordId,
      { clientRef: `corr-${recordId}-${file.uri.split('/').pop()}`, md5: local?.md5 });
    const ref: FileRef = { file_asset_id: uploaded.id, name: file.fileName ?? uploaded.original_name, mime_type: mime, size_bytes: uploaded.size_bytes };
    return { ...file, server_file: ref };
  };
  for (const row of rows) row.field_value_json = await upload(row.field_value_json);
  return JSON.stringify(rows);
}

export async function pushCorrections(): Promise<{ sent: number; conflicts: number; errors: number }> {
  const result = { sent: 0, conflicts: 0, errors: 0 };
  for (const row of correctionsToSend()) {
    const before = nested(row.server_data_json);
    let after: Map<string, unknown>;
    try {
      after = nested(await uploadNewFiles(row.data_json, row.project_id, row.server_record_id, row.participant_id));
    } catch {
      continue; // sin red: se reintenta en el próximo ciclo
    }
    let lock = row.lock_version ?? 1;
    try {
      for (const [field, value] of after) {
        if (JSON.stringify(before.get(field)) === JSON.stringify(value)) continue;
        const { data } = await api.patch<{ lock_version: number }>(`/runtime/record/${row.server_record_id}/correction`, {
          field_name: field, field_value_json: JSON.stringify(value ?? null), expected_lock_version: lock,
        });
        lock = data.lock_version;
        setCorrectionLockVersion(row.local_id, lock);
      }
      for (const obs of JSON.parse(row.observations_json || '[]') as (ServerObservation & { local?: boolean })[]) {
        if (obs.local && obs.status === 'corrected') await api.patch(`/review/observations/${obs.id}`, { status: 'corrected' });
      }
      for (const toStatus of ['corrected', 'submitted']) {
        await api.post('/review/actions', { project_id: row.project_id, record_id: row.server_record_id, to_status: toStatus, action: toStatus })
          .catch((err) => { if (!(toStatus === 'corrected' && err?.response?.status === 400)) throw err; }); // ya estaba corregido
      }
      markCorrectionSent(row.local_id);
      result.sent += 1;
    } catch (err: any) {
      const code: number | undefined = err?.response?.status;
      if (!code) continue; // sin red: sigue en cola
      const detail = typeof err.response?.data?.detail === 'string' ? err.response.data.detail : err.message;
      if (code === 409) {
        markCorrectionState(row.local_id, 'correction_conflict', detail);
        result.conflicts += 1;
      } else {
        markCorrectionState(row.local_id, 'correction_error', detail);
        result.errors += 1;
      }
    }
  }
  return result;
}
