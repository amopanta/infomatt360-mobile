/**
 * Utilidad de exportacion de datos a CSV y JSON.
 *
 * Genera archivos exportables en el directorio de documentos
 * del dispositivo, listos para compartir via Share API nativa.
 *
 * Formatos soportados:
 *   - JSON: exportacion completa con estructura preservada
 *   - CSV: tabla plana con columnas de campos dinamicos
 */

import * as FileSystem from 'expo-file-system/legacy';
import { Share, Platform } from 'react-native';
import { listAllRecords, getCachedForm } from '../db/database';
import type { RecordValue } from '../types';

export type ExportFormat = 'json' | 'csv';

export interface ExportOptions {
  format: ExportFormat;
  projectId?: number;
  templateId?: number;
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

  const filtered = records;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
  const templateName = options.templateId
    ? getCachedForm(options.templateId)?.name?.replace(/[^a-zA-Z0-9]/g, '_') ?? `form_${options.templateId}`
    : 'todos';

  if (options.format === 'json') {
    return exportAsJson(filtered, templateName, timestamp);
  } else {
    return exportAsCsv(filtered, templateName, timestamp);
  }
}

// ── JSON ──────────────────────────────────────────────────────────────

async function exportAsJson(
  records: ReturnType<typeof listAllRecords>,
  templateName: string,
  timestamp: string,
): Promise<ExportResult> {
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
      values: values.map((v) => ({
        field_id: v.field_id,
        field_name: v.field_name,
        value: v.field_value_json,
      })),
      created_at: rec.created_at,
      synced_at: rec.synced_at,
    };
  });

  const json = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      record_count: exportData.length,
      records: exportData,
    },
    null,
    2,
  );

  const fileName = `infomatt360_${templateName}_${timestamp}.json`;
  const filePath = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(filePath, json, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return { filePath, fileName, recordCount: exportData.length };
}

// ── CSV ───────────────────────────────────────────────────────────────

async function exportAsCsv(
  records: ReturnType<typeof listAllRecords>,
  templateName: string,
  timestamp: string,
): Promise<ExportResult> {
  // Recolectar todos los campos unicos para las columnas
  const fieldColumns = new Map<string, string>(); // field_id → field_name
  const parsedRecords: {
    meta: ReturnType<typeof listAllRecords>[0];
    values: RecordValue[];
  }[] = [];

  for (const rec of records) {
    const values: RecordValue[] = JSON.parse(rec.data_json);
    parsedRecords.push({ meta: rec, values });
    for (const v of values) {
      if (!fieldColumns.has(v.field_id)) {
        fieldColumns.set(v.field_id, v.field_name || v.field_id);
      }
    }
  }

  // Construir encabezados
  const fixedHeaders = [
    'local_id',
    'project_id',
    'template_id',
    'participant_id',
    'status',
    'gps_lat',
    'gps_lng',
    'gps_accuracy',
    'created_at',
    'synced_at',
  ];
  const fieldIds = Array.from(fieldColumns.keys());
  const fieldNames = fieldIds.map((id) => fieldColumns.get(id) ?? id);
  const allHeaders = [...fixedHeaders, ...fieldNames];

  // Construir filas
  const rows: string[] = [allHeaders.map(escapeCsvField).join(',')];

  for (const { meta, values } of parsedRecords) {
    const gps = meta.gps_json ? JSON.parse(meta.gps_json) : null;
    const valueMap = new Map(values.map((v) => [v.field_id, v.field_value_json]));

    const fixedValues = [
      meta.local_id,
      String(meta.project_id),
      String(meta.template_id),
      meta.participant_id != null ? String(meta.participant_id) : '',
      meta.status,
      gps?.lat != null ? String(gps.lat) : '',
      gps?.lng != null ? String(gps.lng) : '',
      gps?.accuracy != null ? String(gps.accuracy) : '',
      meta.created_at,
      meta.synced_at ?? '',
    ];

    const fieldValues = fieldIds.map((id) => {
      const val = valueMap.get(id);
      return formatCsvValue(val);
    });

    rows.push([...fixedValues, ...fieldValues].map(escapeCsvField).join(','));
  }

  // BOM para Excel compatibility + contenido
  const bom = '﻿';
  const csv = bom + rows.join('\n');

  const fileName = `infomatt360_${templateName}_${timestamp}.csv`;
  const filePath = `${FileSystem.documentDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(filePath, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  return { filePath, fileName, recordCount: parsedRecords.length };
}

/** Formatea un valor de campo para CSV */
function formatCsvValue(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    // GPS
    if ('lat' in (val as any) && 'lng' in (val as any)) {
      const gps = val as { lat: number; lng: number };
      return `${gps.lat},${gps.lng}`;
    }
    // Signature/fingerprint: solo indicar tipo
    if ('dataUri' in (val as any)) return '[firma/huella]';
    // Archivos
    if ('uri' in (val as any)) return '[archivo]';
    return JSON.stringify(val);
  }
  return String(val);
}

/** Escapa un campo para CSV (comillas dobles si contiene delimitadores) */
function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Comparte el archivo exportado usando la Share API nativa.
 *
 * En Android, Share.share no soporta archivos directamente sin
 * expo-sharing. Usamos un content:// URI via FileSystem para
 * que el intent de compartir funcione correctamente.
 */
export async function shareExportFile(filePath: string): Promise<void> {
  if (Platform.OS === 'ios') {
    // En iOS, Share puede compartir archivos directamente
    await Share.share({ url: filePath });
  } else {
    // En Android, leer el archivo como texto y compartir el contenido
    // directamente, lo que permite copiarlo a cualquier app
    try {
      const content = await FileSystem.readAsStringAsync(filePath, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      const fileName = filePath.split('/').pop() ?? 'export';
      const isJson = fileName.endsWith('.json');

      // Para archivos pequenos (<100KB), compartir contenido inline
      // Para archivos grandes, compartir la ruta con instrucciones
      if (content.length < 100_000) {
        await Share.share({
          title: `InfoMatt360 - ${fileName}`,
          message: isJson
            ? content
            : `${fileName}\n\n${content}`,
        });
      } else {
        // Archivo grande: notificar ruta y tamano
        const sizeKb = Math.round(content.length / 1024);
        await Share.share({
          title: `InfoMatt360 - ${fileName}`,
          message:
            `Archivo exportado: ${fileName} (${sizeKb} KB)\n\n` +
            `Ubicacion: ${filePath}\n\n` +
            `Puedes acceder al archivo desde un gestor de archivos ` +
            `o conectar el dispositivo a un computador para copiarlo.`,
        });
      }
    } catch {
      // Fallback: compartir solo la ruta
      await Share.share({
        title: 'Exportar datos InfoMatt360',
        message: `Archivo exportado: ${filePath}`,
      });
    }
  }
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
      if (file.startsWith('infomatt360_') && (file.endsWith('.csv') || file.endsWith('.json'))) {
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
