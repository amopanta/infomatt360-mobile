/**
 * API de formularios — descarga de plantillas para captura offline.
 *
 * Endpoints reales del backend InfoMatt360 (los mismos que usa la web):
 *   GET /builder/templates/{project_id}          → plantillas del proyecto
 *   GET /runtime/template/{template_id}          → páginas/secciones/campos
 *   GET /runtime/template/{id}/records           → registros existentes
 *
 * El backend nombra los tipos en mayúsculas (TEXT, SELECT, IMAGE...) y guarda
 * la configuración de cada campo en `config_json`; aquí se traduce al modelo
 * que pinta FieldRenderer.
 */

import api from './client';
import type { FormComponent, FormPage, FormTemplate, RuntimeRecord } from '../types';

type BackendTemplate = {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  status: string;
  accepting_responses?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

type BackendComponent = { id: string; type: string; name: string; label: string; config_json?: string | null };
type BackendRuntimeTemplate = {
  template_id: string;
  name: string;
  description?: string | null;
  status: string;
  pages: {
    id: string;
    title: string;
    sections: {
      id: string;
      title: string;
      rows: { columns: { desktop_width: number; tablet_width: number; mobile_width: number; components: BackendComponent[] }[] }[];
    }[];
  }[];
};

/** Tipo del backend → tipo que sabe pintar FieldRenderer */
const TYPE_MAP: Record<string, string> = {
  TEXT: 'text', DOCUMENT_ID: 'text', EMAIL: 'text', PHONE: 'text', URL: 'text',
  BARCODE: 'text', QR: 'text', OCR: 'text',
  TEXTAREA: 'textarea',
  NUMBER: 'number', INTEGER: 'number', DECIMAL: 'number', PERCENTAGE: 'number',
  CURRENCY: 'number', RANGE: 'number', NPS: 'number', YEAR: 'number',
  SELECT: 'select', DROPDOWN: 'select', BOOLEAN: 'select',
  LIKERT_5: 'select', LIKERT_7: 'select', RATING: 'select',
  MULTISELECT: 'multiselect', RANKING: 'multiselect',
  DATE: 'date', DATETIME: 'date', TIME: 'date', MONTH: 'date', WEEK: 'date',
  GPS: 'gps', GEOTRACE: 'gps', GEOSHAPE: 'gps',
  IMAGE: 'photo',
  SIGNATURE: 'signature',
  FILE: 'file', PDF: 'document', MULTIFILE: 'file', AUDIO: 'file', VIDEO: 'file',
  FINGERPRINT: 'fingerprint',
};

/** Campos que el servidor calcula solo; no se muestran al encuestador */
const SERVER_ONLY = new Set(['HIDDEN', 'CALCULATE', 'UUID', 'RESPONSE_ID', 'SERIAL_NUMBER', 'INTERVIEW_DURATION', 'CAPTURED_BY', 'CHANGE_HISTORY']);

function toComponent(c: BackendComponent): FormComponent | null {
  if (SERVER_ONLY.has(c.type)) return null;
  let config: Record<string, any> = {};
  try { config = c.config_json ? JSON.parse(c.config_json) : {}; } catch { /* configuración antigua */ }
  let options: { value: string; label: string }[] | undefined = Array.isArray(config.options) ? config.options : undefined;
  if (c.type === 'BOOLEAN') options = [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }];
  return {
    // El backend identifica los valores por `name` (field_name), no por id.
    id: c.name,
    type: TYPE_MAP[c.type] ?? 'text',
    label: c.label,
    required: Boolean(config.required),
    options,
    validations: { min: config.min, max: config.max, minLength: config.min_length, maxLength: config.max_length, pattern: config.pattern },
    config: { ...config, backendType: c.type, componentId: c.id },
    conditionalVisibility: config.relevant?.field
      ? { logic: 'and', rules: [{ fieldId: config.relevant.field, operator: config.relevant.operator === 'not_equals' ? 'neq' : 'eq', value: config.relevant.value }] }
      : undefined,
  };
}

function toPages(runtime: BackendRuntimeTemplate): FormPage[] {
  return runtime.pages.map((page) => ({
    title: page.title,
    sections: page.sections.map((section) => ({
      id: section.id,
      title: section.title,
      rows: section.rows.map((row) => ({
        columns: row.columns.map((column) => ({
          desktopWidth: column.desktop_width,
          tabletWidth: column.tablet_width,
          mobileWidth: column.mobile_width,
          components: column.components.map(toComponent).filter((x): x is FormComponent => x !== null),
        })),
      })),
    })),
  }));
}

/** Descarga las plantillas publicadas del proyecto con su estructura completa */
export async function getProjectForms(projectId: string): Promise<FormTemplate[]> {
  const { data } = await api.get<BackendTemplate[]>(`/builder/templates/${projectId}`);
  const usable = data.filter((t) => t.status === 'published' && t.accepting_responses !== false);
  const forms: FormTemplate[] = [];
  for (const template of usable) {
    try {
      forms.push(await getFormDetail(template.id, template));
    } catch {
      // Una plantilla sin acceso no debe impedir descargar las demás.
    }
  }
  return forms;
}

export async function getFormDetail(formId: string, summary?: BackendTemplate): Promise<FormTemplate> {
  const { data } = await api.get<BackendRuntimeTemplate>(`/runtime/template/${formId}`);
  return {
    id: data.template_id,
    templateId: data.template_id,
    version: 1,
    name: data.name,
    description: data.description ?? undefined,
    project_id: summary?.project_id ?? '',
    pages: toPages(data),
    published: data.status === 'published',
    created_at: summary?.created_at ?? '',
    updated_at: summary?.updated_at ?? '',
  };
}

export async function getTemplateRecords(
  templateId: string,
  params?: { search?: string; status?: string; limit?: number; offset?: number },
): Promise<{ items: RuntimeRecord[]; total: number }> {
  const { data } = await api.get(`/runtime/template/${templateId}/records`, { params });
  const items = Array.isArray(data) ? data : data.items ?? [];
  return { items, total: Array.isArray(data) ? data.length : data.total ?? items.length };
}
