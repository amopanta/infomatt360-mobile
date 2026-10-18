/**
 * API de sincronizacion — envio masivo de registros offline.
 *
 * Usa el endpoint de sesion normal (no API key):
 *   POST /runtime/session/bulk-save   (doc 106)
 *
 * Soporta idempotency_key para reintentos seguros.
 */

import api from './client';
import type { BulkSavePayload, BulkSaveResult } from '../types';

export async function bulkSaveRecords(
  payload: BulkSavePayload,
): Promise<BulkSaveResult> {
  const { data } = await api.post('/runtime/session/bulk-save', payload);
  return data;
}

/**
 * Sube un archivo de evidencia al storage del proyecto.
 */
export async function uploadEvidence(
  projectId: string,
  fileUri: string,
  mimeType: string,
  fileName: string,
  assetType: string,
  participantId?: string | null,
  recordId?: string | null,
): Promise<{ id: string; storage_path: string; size_bytes: number; original_name: string }> {
  // Campos exigidos por backend/app/api/v1/files.py (upload_file_asset)
  const formData = new FormData();
  formData.append('upload', {
    uri: fileUri,
    type: mimeType,
    name: fileName,
  } as any);
  formData.append('project_id', projectId);
  formData.append('asset_type', assetType);
  if (participantId) formData.append('participant_id', participantId);
  if (recordId) formData.append('record_id', recordId);

  const { data } = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000, // archivos grandes: 2 min
  });

  return data;
}
