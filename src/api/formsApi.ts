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
import type { FormComponent, FormPage, FormSection, FormTemplate, RuntimeRecord } from '../types';

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
  access_mode?: string;
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
  CURRENCY: 'number', RANGE: 'number', YEAR: 'number',
  SELECT: 'select', DROPDOWN: 'select', BOOLEAN: 'select',
  LIKERT_5: 'select', LIKERT_7: 'select', RATING: 'select', NPS: 'select',
  MULTISELECT: 'multiselect', RANKING: 'ranking',
  DATE: 'date', MONTH: 'date', WEEK: 'date', TIME: 'time', DATETIME: 'datetime',
  GPS: 'gps', GEOTRACE: 'gps', GEOSHAPE: 'gps',
  IMAGE: 'photo',
  SIGNATURE: 'signature',
  FILE: 'file', PDF: 'document', MULTIFILE: 'multifile', AUDIO: 'audio', VIDEO: 'video',
  FINGERPRINT: 'fingerprint',
  // Necesitan consultar otros registros o una estructura que la app aún no
  // pinta: se muestran como aviso para completarlos desde la web.
  MATRIX: 'webonly', LINKED_SUBFORM: 'webonly', PARENT_CHILD: 'webonly', LOOKUP: 'webonly', REFERENCE: 'webonly',
  // Sin control: la app solo registra la duración al enviar.
  INTERVIEW_DURATION: 'auto',
  REPEAT: 'repeat',
};

/** Campos que el servidor llena solo (ver runtime_record_service._fill_system_fields) */
const SERVER_ONLY = new Set(['HIDDEN', 'CALCULATE', 'UUID', 'RESPONSE_ID', 'SERIAL_NUMBER', 'CAPTURED_BY', 'CHANGE_HISTORY']);

/** Escalas por defecto si el formulario no trae opciones (igual que la web). */
function defaultOptions(type: string): { value: string; label: string }[] | undefined {
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => ({ value: String(from + i), label: String(from + i) }));
  if (type === 'LIKERT_5' || type === 'RATING') return range(1, 5);
  if (type === 'LIKERT_7') return range(1, 7);
  if (type === 'NPS') return range(0, 10);
  return undefined;
}

/** Convierte un campo del backend (componente o campo de un REPEAT) al modelo de la app. */
function fromDefinition(name: string, label: string, type: string, config: Record<string, any>, componentId?: string): FormComponent | null {
  if (SERVER_ONLY.has(type)) return null;
  let options: { value: string; label: string }[] | undefined = Array.isArray(config.options) && config.options.length ? config.options : defaultOptions(type);
  if (type === 'BOOLEAN') options = [{ value: 'true', label: 'Sí' }, { value: 'false', label: 'No' }];
  const component: FormComponent = {
    // El backend identifica los valores por `name` (field_name), no por id.
    id: name,
    type: TYPE_MAP[type] ?? 'text',
    label,
    required: Boolean(config.required),
    options,
    validations: { ...constraintBounds(config.constraint_expression), ...pick({ min: config.min, max: config.max }), minLength: config.min_length, maxLength: config.max_length, pattern: config.pattern },
    config: { ...config, backendType: type, componentId },
    conditionalVisibility: config.relevant?.field
      ? { logic: 'and', rules: [{ fieldId: config.relevant.field, operator: config.relevant.operator === 'not_equals' ? 'neq' : 'eq', value: config.relevant.value }] }
      : undefined,
  };
  if (type === 'REPEAT') component.children = repeatChildren(config.fields);
  return component;
}

function repeatChildren(fields: unknown): FormComponent[] {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((f: any) => fromDefinition(String(f?.name ?? ''), String(f?.label ?? f?.name ?? ''), String(f?.component_type ?? 'TEXT'), f?.config ?? {}))
    .filter((x): x is FormComponent => x !== null && Boolean(x.id));
}

function toComponent(c: BackendComponent): FormComponent | null {
  let config: Record<string, any> = {};
  try { config = c.config_json ? JSON.parse(c.config_json) : {}; } catch { /* configuración antigua */ }
  return fromDefinition(c.name, c.label, c.type, config, c.id);
}

function column(components: FormComponent[]): FormSection['rows'][number] {
  return { columns: [{ desktopWidth: 12, tabletWidth: 12, mobileWidth: 12, components }] };
}

/**
 * Cada REPEAT del backend se vuelve una sección repetible de la app (el
 * mecanismo de RepeatGroupRenderer). Los campos que lo rodean siguen en
 * secciones normales con el mismo título, para conservar el orden.
 */
function toSections(section: BackendRuntimeTemplate['pages'][number]['sections'][number]): FormSection[] {
  const result: FormSection[] = [];
  let pending: FormComponent[] = [];
  const flush = () => {
    if (!pending.length) return;
    result.push({ id: result.length ? `${section.id}-${result.length}` : section.id, title: section.title, rows: [column(pending)] });
    pending = [];
  };
  for (const row of section.rows) {
    for (const col of row.columns) {
      for (const backend of col.components) {
        const component = toComponent(backend);
        if (!component) continue;
        if (component.type !== 'repeat') { pending.push(component); continue; }
        flush();
        const config = (component.config ?? {}) as Record<string, any>;
        result.push({
          id: component.id,
          title: component.label,
          rows: [column(component.children ?? [])],
          repeatable: true,
          minRepetitions: typeof config.min_repeats === 'number' ? config.min_repeats : component.required ? 1 : 0,
          maxRepetitions: typeof config.max_repeats === 'number' ? config.max_repeats : 50,
        });
      }
    }
  }
  flush();
  return result;
}

function toPages(runtime: BackendRuntimeTemplate): FormPage[] {
  return runtime.pages.map((page) => ({
    title: page.title,
    sections: page.sections.flatMap(toSections),
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
    accessMode: data.access_mode ?? 'legacy',
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

function pick(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined && v !== null));
}

/** Reglas XLSForm simples ('. >= 0 and . <= 120') → min/max que valida la app.
 * Las expresiones más complejas se siguen validando en el servidor y la web. */
export function constraintBounds(expression: unknown): { min?: number; max?: number } {
  if (typeof expression !== 'string') return {};
  const bounds: { min?: number; max?: number } = {};
  const min = /\.\s*>=?\s*(-?\d+(?:\.\d+)?)/.exec(expression);
  const max = /\.\s*<=?\s*(-?\d+(?:\.\d+)?)/.exec(expression);
  if (min) bounds.min = Number(min[1]);
  if (max) bounds.max = Number(max[1]);
  return bounds;
}
