/**
 * Conversión de los valores capturados en el teléfono al contrato del
 * backend (POST /runtime/session/bulk-save). Módulo sin dependencias de
 * Expo para poder probarlo con vitest (test/backendValues.test.ts).
 */

import type { RecordValue } from '../types';

/** Mismo formato que guarda la web para campos IMAGE/FILE/FINGERPRINT
 * (frontend/src/modules/runtime/api.ts: uploadRuntimeFile). */
export type FileValue = { file_asset_id: string; name: string; mime_type: string; size_bytes: number };

/** Ruta local de un valor de campo: texto con la uri, o {uri}/{fileUri}. */
export function localUriOf(value: unknown): string | null {
  if (typeof value === 'string') return value.startsWith('file:') || value.startsWith('content:') ? value : null;
  if (value && typeof value === 'object') {
    const v = value as { uri?: unknown; fileUri?: unknown };
    if (typeof v.uri === 'string') return v.uri;
    if (typeof v.fileUri === 'string') return v.fileUri;
  }
  return null;
}

/** Reemplaza archivos locales ya subidos por su referencia en el servidor;
 * MULTIFILE guarda una lista de archivos, igual que la web. */
function replaceUploaded(value: unknown, uploaded: Map<string, FileValue>): unknown {
  if (Array.isArray(value)) return value.map((item) => replaceUploaded(item, uploaded));
  const uri = localUriOf(value);
  if (!uri || !uploaded.has(uri)) return value;
  // Se muestra el nombre que vio el gestor ("acta_visita.pdf"), no el interno.
  const fileName = (value as { fileName?: unknown }).fileName;
  const asset = uploaded.get(uri)!;
  return typeof fileName === 'string' && fileName ? { ...asset, name: fileName } : asset;
}

/** Valores locales → contrato del backend (field_value_json como texto JSON).
 * Un campo que apunta a un archivo local ya subido se envía como referencia
 * al archivo del servidor, igual que la web. */
export function toBackendValues(
  values: RecordValue[],
  uploaded: Map<string, FileValue>,
  types: Map<string, string>,
): { field_name: string; field_value_json: string }[] {
  const flat = new Map<string, unknown>();
  for (const v of values) {
    const name = v.field_name || v.field_id;
    if (!name || flat.has(name)) continue;
    let raw = replaceUploaded(v.field_value_json, uploaded);
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
