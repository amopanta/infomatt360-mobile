/**
 * API de formularios — descarga de plantillas para captura offline.
 *
 * Endpoints:
 *   GET /forms/project/{project_id}          → lista de formularios
 *   GET /forms/{form_id}                     → detalle con JSON schema
 *   GET /runtime/template/{id}/records       → registros existentes
 */

import api from './client';
import type { FormTemplate, RuntimeRecord } from '../types';

export async function getProjectForms(projectId: number): Promise<FormTemplate[]> {
  const { data } = await api.get(`/forms/project/${projectId}`);
  return data;
}

export async function getFormDetail(formId: number): Promise<FormTemplate> {
  const { data } = await api.get(`/forms/${formId}`);
  return data;
}

export async function getTemplateRecords(
  templateId: number,
  params?: { search?: string; status?: string; limit?: number; offset?: number },
): Promise<{ items: RuntimeRecord[]; total: number }> {
  const { data } = await api.get(`/runtime/template/${templateId}/records`, { params });
  return data;
}
