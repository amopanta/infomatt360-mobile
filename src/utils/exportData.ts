/**
 * Utilidad de exportacion de datos a Excel, CSV y JSON.
 *
 * Genera archivos exportables en el directorio de documentos
 * del dispositivo, listos para compartir con la hoja nativa.
 *
 * Formatos soportados:
 *   - XLSX: libro de Excel con encabezados legibles (etiquetas de las preguntas)
 *   - CSV: misma tabla, separada por comas (con BOM para Excel)
 *   - JSON: exportacion completa con estructura preservada
 */

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';
import { listAllRecords, getCachedForm } from '../db/database';
import type { FormComponent, FormPage, RecordValue } from '../types';
import { buildXlsxBase64, type XlsxCell } from './xlsxWriter';

export type ExportFormat = 'xlsx' | 'csv' | 'json';

export interface ExportOptions {
  format: ExportFormat;
  projectId?: string;
  templateId?: string;
  status?: string;
  /** Incluir solo registros creados despues de esta fecha (YYYY-MM-DD) */
  fromDate?: string;
  /** Incluir solo registros creados hasta esta fecha (YYYY-MM-DD) */
  toDate?: string;
}

export interface ExportResult {
  filePath: string;
  fileName: string;
  recordCount: number;
}

const MIME: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  json: 'application/json',
};

/**
 * Genera la exportacion y retorna la ruta del archivo.
 */
export async function exportRecords(options: ExportOptions): Promise<ExportResult> {
  const records = listAllRecords({
    projectId: options.projectId,
    templateId: options.templateId,
    status: options.status,
    fromDate: options.fromDate,
    toDate: options.toDate,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const formName = options.templateId ? getCachedForm(options.templateId)?.name : undefined;
  const templateName = options.templateId
    ? formName?.replace(/[^a-zA-Z0-9]/g, '_') ?? `form_${options.templateId}`
    : 'todos';

  if (options.format === 'json') return exportAsJson(records, templateName, timestamp);
  const rows = buildTable(records);
  if (options.format === 'xlsx') return exportAsXlsx(rows, formName ?? 'Registros', templateName, timestamp);
  return exportAsCsv(rows, templateName, timestamp);
}

// ── Tabla común (CSV / Excel) ─────────────────────────────────────────

type ExportRecord = ReturnType<typeof listAllRecords>[number];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendiente', syncing: 'Enviando', synced: 'Sincronizado', error: 'Con error', conflict: 'En conflicto', draft: 'Borrador',
};

/** field_id → etiqueta de la pregunta, según las plantillas guardadas en el teléfono. */
function labelsFor(templateIds: string[]): Map<string, string> {
  const labels = new Map<string, string>();
  const visit = (component: FormComponent) => {
    labels.set(component.id, component.label);
    for (const child of component.children ?? []) visit(child);
  };
  for (const templateId of templateIds) {
    const cached = getCachedForm(templateId);
    if (!cached) continue;
    try {
      for (const page of JSON.parse(cached.schema_json) as FormPage[]) {
        for (const section of page.sections) {
          if (section.repeatable && section.id) labels.set(section.id, section.title);
          for (const row of section.rows) for (const col of row.columns) col.components.forEach(visit);
        }
      }
    } catch {
      // Plantilla con formato antiguo: se usa el nombre técnico como título
    }
  }
  return labels;
}

/** "integrantes[0].contactos[1].nombre" → "Integrantes 1 · Contactos 2 · Nombre" */
function columnTitle(fieldId: string, labels: Map<string, string>): string {
  const parts = fieldId.split('.');
  return parts
    .map((part) => {
      const match = /^(.+)\[(\d+)\]$/.exec(part);
      if (match) return `${labels.get(match[1]) ?? match[1]} ${Number(match[2]) + 1}`;
      return labels.get(part) ?? part;
    })
    .join(' · ');
}

function buildTable(records: ExportRecord[]): XlsxCell[][] {
  const fieldIds: string[] = [];
  const seen = new Set<string>();
  const parsed = records.map((meta) => {
    const values: RecordValue[] = JSON.parse(meta.data_json);
    for (const v of values) {
      if (!seen.has(v.field_id)) { seen.add(v.field_id); fieldIds.push(v.field_id); }
    }
    return { meta, values };
  });
  const labels = labelsFor([...new Set(records.map((r) => r.template_id))]);

  const header: XlsxCell[] = [
    'ID local', 'Proyecto', 'Formulario', 'Participante', 'Estado',
    'Latitud', 'Longitud', 'Precisión GPS (m)', 'Creado', 'Sincronizado',
    ...fieldIds.map((id) => columnTitle(id, labels)),
  ];
  const body = parsed.map(({ meta, values }) => {
    const gps = meta.gps_json ? JSON.parse(meta.gps_json) : null;
    const valueMap = new Map(values.map((v) => [v.field_id, v.field_value_json]));
    return [
      meta.local_id,
      meta.project_id,
      getCachedForm(meta.template_id)?.name ?? meta.template_id,
      meta.participant_id ?? '',
      STATUS_LABELS[meta.status] ?? meta.status,
      gps?.lat ?? '',
      gps?.lng ?? '',
      gps?.accuracy ?? '',
      meta.created_at,
      meta.synced_at ?? '',
      ...fieldIds.map((id) => cellValue(valueMap.get(id))),
    ] as XlsxCell[];
  });
  return [header, ...body];
}

/** Valor de campo → celda: números como número, el resto como texto legible. */
function cellValue(val: unknown): XlsxCell {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') return val;
  if (typeof val === 'boolean') return val ? 'Sí' : 'No';
  if (val === 'true') return 'Sí';
  if (val === 'false') return 'No';
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) return val.map((item) => String(cellValue(item))).join(', ');
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if ('lat' in obj && 'lng' in obj) return `${obj.lat}, ${obj.lng}`;
    if ('dataUri' in obj) return obj.type === 'fingerprint' ? '[huella]' : '[firma]';
    if ('uri' in obj || 'fileUri' in obj) return '[archivo]';
    if ('file_asset_id' in obj) return String(obj.name ?? '[archivo]');
    return JSON.stringify(val);
  }
  return String(val);
}

// ── Excel ─────────────────────────────────────────────────────────────

async function exportAsXlsx(rows: XlsxCell[][], sheetName: string, templateName: string, timestamp: string): Promise<ExportResult> {
  const fileName = `infomatt360_${templateName}_${timestamp}.xlsx`;
  const filePath = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(filePath, buildXlsxBase64(sheetName, rows), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { filePath, fileName, recordCount: rows.length - 1 };
}

// ── CSV ───────────────────────────────────────────────────────────────

async function exportAsCsv(rows: XlsxCell[][], templateName: string, timestamp: string): Promise<ExportResult> {
  const lines = rows.map((row) => row.map((cell) => escapeCsvField(cell === null || cell === undefined ? '' : String(cell))).join(','));
  // BOM para que Excel reconozca UTF-8 (tildes y ñ)
  const csv = '﻿' + lines.join('\n');
  const fileName = `infomatt360_${templateName}_${timestamp}.csv`;
  const filePath = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(filePath, csv, { encoding: FileSystem.EncodingType.UTF8 });
  return { filePath, fileName, recordCount: rows.length - 1 };
}

/** Escapa un campo para CSV (comillas dobles si contiene delimitadores) */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ── JSON ──────────────────────────────────────────────────────────────

async function exportAsJson(records: ExportRecord[], templateName: string, timestamp: string): Promise<ExportResult> {
  const exportData = records.map((rec) => {
    const values: RecordValue[] = JSON.parse(rec.data_json);
    const gps = rec.gps_json ? JSON.parse(rec.gps_json) : null;
    return {
      local_id: rec.local_id,
      project_id: rec.project_id,
      template_id: rec.template_id,
      participant_id: rec.participant_id,
      status: rec.status,
      gps,
      values: values.map((v) => ({ field_id: v.field_id, field_name: v.field_name, value: v.field_value_json })),
      created_at: rec.created_at,
      synced_at: rec.synced_at,
    };
  });
  const json = JSON.stringify({ exported_at: new Date().toISOString(), record_count: exportData.length, records: exportData }, null, 2);
  const fileName = `infomatt360_${templateName}_${timestamp}.json`;
  const filePath = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(filePath, json, { encoding: FileSystem.EncodingType.UTF8 });
  return { filePath, fileName, recordCount: exportData.length };
}

// ── Compartir ─────────────────────────────────────────────────────────

/**
 * Comparte el archivo con la hoja nativa (WhatsApp, correo, Drive...).
 * Antes en Android se compartía el contenido como texto, no el archivo.
 */
export async function shareExportFile(filePath: string): Promise<void> {
  const fileName = filePath.split('/').pop() ?? 'export';
  const extension = (fileName.split('.').pop() ?? 'csv') as ExportFormat;
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(filePath, { mimeType: MIME[extension] ?? 'application/octet-stream', dialogTitle: `InfoMatt360 - ${fileName}` });
    return;
  }
  await Share.share({ title: 'Exportar datos InfoMatt360', message: `Archivo exportado: ${filePath}` });
}

/**
 * Lista archivos exportados previamente.
 */
export async function listExportFiles(): Promise<{ name: string; uri: string; size: number; modTime: number }[]> {
  const dir = FileSystem.documentDirectory;
  if (!dir) return [];

  try {
    const files = await FileSystem.readDirectoryAsync(dir);
    const exports: { name: string; uri: string; size: number; modTime: number }[] = [];

    for (const file of files) {
      if (file.startsWith('infomatt360_') && /\.(xlsx|csv|json)$/.test(file)) {
        const info = await FileSystem.getInfoAsync(dir + file);
        exports.push({
          name: file,
          uri: dir + file,
          size: (info as any).size ?? 0,
          modTime: (info as any).modificationTime ?? 0,
        });
      }
    }

    return exports.sort((a, b) => b.modTime - a.modTime);
  } catch {
    return [];
  }
}

/**
 * Elimina un archivo exportado.
 */
export async function deleteExportFile(uri: string): Promise<void> {
  await FileSystem.deleteAsync(uri, { idempotent: true });
}
