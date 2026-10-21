/**
 * Almacenamiento local de evidencias (H04).
 *
 * Toda foto, PDF, audio, video o archivo adjunto se copia a
 * documentDirectory/evidence/, que Android no vacía (la caché sí, cuando falta
 * espacio, y ahí quedaban las fotos comprimidas). Solo se borra tras el acuse
 * del servidor, en la limpieza de sincronizados (purgeOldSynced).
 */

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';
import { insertEvidence } from '../db/database';
import { collectFileValues, extensionOf, MAX_EVIDENCE_MB, mimeFor, type LocalFileType, type LocalFileValue } from './fileValues';

export const EVIDENCE_DIR = `${FileSystem.documentDirectory}evidence/`;

export class EvidenceTooLargeError extends Error {
  constructor(sizeMb: number) {
    super(`El archivo pesa ${sizeMb.toFixed(1)} MB; el máximo es ${MAX_EVIDENCE_MB} MB.`);
  }
}

/** Copia el archivo capturado o elegido al almacenamiento permanente de la app. */
export async function persistEvidenceFile(
  sourceUri: string,
  meta: { type: LocalFileType; fileName?: string | null; mimeType?: string | null; fileSize?: number | null },
): Promise<LocalFileValue> {
  const mimeType = mimeFor({ uri: sourceUri, type: meta.type, fileName: meta.fileName ?? undefined, mimeType: meta.mimeType ?? undefined });
  const ext = extensionOf(meta.fileName) || extensionOf(sourceUri) || (mimeType.split('/')[1] ?? '').replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
  await FileSystem.makeDirectoryAsync(EVIDENCE_DIR, { intermediates: true }).catch(() => {});
  const target = `${EVIDENCE_DIR}${Crypto.randomUUID()}.${ext}`;
  await FileSystem.copyAsync({ from: sourceUri, to: target });
  const info = await FileSystem.getInfoAsync(target);
  if (!info.exists) throw new Error('No se pudo guardar el archivo en el teléfono.');
  const size = (info as { size?: number }).size ?? meta.fileSize ?? 0;
  if (size > MAX_EVIDENCE_MB * 1024 * 1024) {
    await FileSystem.deleteAsync(target, { idempotent: true });
    throw new EvidenceTooLargeError(size / (1024 * 1024));
  }
  // La copia temporal (caché de cámara o selector) ya no hace falta.
  if (sourceUri.startsWith(FileSystem.cacheDirectory ?? '\u0000')) await FileSystem.deleteAsync(sourceUri, { idempotent: true }).catch(() => {});
  return { uri: target, type: meta.type, fileName: meta.fileName ?? `${meta.type}.${ext}`, mimeType, fileSize: size };
}

/** Registra como evidencia del registro cada archivo usado en sus respuestas
 * (una sola vez por archivo: `known` son los ya registrados). */
export function registerFieldEvidence(recordLocalId: string, values: Record<string, unknown>, known: Set<string> = new Set()): void {
  for (const file of collectFileValues(values)) {
    if (known.has(file.uri)) continue;
    insertEvidence({
      localId: Crypto.randomUUID(),
      recordLocalId,
      type: file.type,
      fileUri: file.uri,
      mimeType: mimeFor(file),
      fileSize: file.fileSize ?? 0,
    });
  }
}

/** Tamaño y MD5 calculados por el sistema (sin cargar el archivo en memoria). */
export async function fileFingerprint(uri: string): Promise<{ size: number; md5: string | null } | null> {
  const info = await FileSystem.getInfoAsync(uri, { md5: true }).catch(() => null);
  if (!info?.exists) return null;
  return { size: (info as { size?: number }).size ?? 0, md5: (info as { md5?: string }).md5 ?? null };
}
