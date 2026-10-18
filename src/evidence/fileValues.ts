/**
 * Archivos que el gestor adjunta como respuesta de un campo (foto, PDF,
 * archivo, audio, video, huella). Sin dependencias de Expo: se prueba en
 * test/fileValues.test.ts.
 *
 * Valor guardado en el registro local: { uri, type, fileName, mimeType, fileSize }.
 * MULTIFILE guarda una lista de esos objetos (igual que la web).
 */

export type LocalFileType = 'photo' | 'document' | 'file' | 'audio' | 'video' | 'fingerprint';

export interface LocalFileValue {
  uri: string;
  type: LocalFileType;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
}

/** Límite por archivo; igual al predeterminado del servidor (default_max_file_size_mb). */
export const MAX_EVIDENCE_MB = 25;

const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm',
  m4a: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', amr: 'audio/amr',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', txt: 'text/plain',
};

export function extensionOf(name: string | undefined | null): string {
  const match = /\.([a-z0-9]{1,5})(?:[?#].*)?$/i.exec(name ?? '');
  return match ? match[1].toLowerCase() : '';
}

export function mimeFor(value: Pick<LocalFileValue, 'uri' | 'type'> & Partial<Pick<LocalFileValue, 'fileName' | 'mimeType'>>): string {
  if (value.mimeType && value.mimeType !== 'application/octet-stream') return value.mimeType;
  const fromExt = EXT_MIME[extensionOf(value.fileName) || extensionOf(value.uri)];
  if (fromExt) return fromExt;
  if (value.type === 'photo') return 'image/jpeg';
  if (value.type === 'document') return 'application/pdf';
  if (value.type === 'video') return 'video/mp4';
  if (value.type === 'audio') return 'audio/mp4';
  if (value.type === 'fingerprint') return 'image/png';
  return 'application/octet-stream';
}

/** ¿El tipo de archivo sirve para este campo? (mismo criterio que el `accept` de la web) */
export function acceptsMime(backendType: string | undefined, mime: string): boolean {
  switch (backendType) {
    case 'AUDIO': return mime.startsWith('audio/');
    case 'VIDEO': return mime.startsWith('video/');
    case 'PDF': return mime === 'application/pdf';
    case 'IMAGE': return mime.startsWith('image/');
    default: return true;
  }
}

export function isLocalFileValue(value: unknown): value is LocalFileValue {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value)
    && typeof (value as LocalFileValue).uri === 'string'
    && /^(file|content):/.test((value as LocalFileValue).uri),
  );
}

/**
 * Archivos locales referenciados en los valores del formulario (incluidos
 * grupos repetibles y MULTIFILE), sin repetir. Se registran como evidencia
 * del registro al guardar; así una foto reemplazada o un grupo eliminado no
 * deja evidencias huérfanas para subir.
 */
export function collectFileValues(values: Record<string, unknown>): LocalFileValue[] {
  const found = new Map<string, LocalFileValue>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (isLocalFileValue(value)) { if (!found.has(value.uri)) found.set(value.uri, value); return; }
    // Huella: { dataUri (vista previa), fileUri (archivo PNG) }
    const fp = value as { fileUri?: unknown; fileSize?: number } | null;
    if (fp && typeof fp === 'object' && typeof fp.fileUri === 'string' && /^file:/.test(fp.fileUri) && !found.has(fp.fileUri)) {
      found.set(fp.fileUri, { uri: fp.fileUri, type: 'fingerprint', fileSize: fp.fileSize });
    }
  };
  Object.values(values).forEach(visit);
  return [...found.values()];
}

export function formatSize(bytes: number | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
