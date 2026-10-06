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
  projectId: number,
  fileUri: string,
  mimeType: string,
  fileName: string,
): Promise<{ file_id: string; url: string }> {
  const formData = new FormData();
  formData.append('file', {
    uri: fileUri,
    type: mimeType,
    name: fileName,
  } as any);
  formData.append('project_id', String(projectId));

  const { data } = await api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 120_000, // archivos grandes: 2 min
  });

  return data;
}
