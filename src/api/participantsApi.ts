/**
 * API de participantes — descarga de participantes para vista 360.
 *
 * Endpoints reales del backend InfoMatt360 (FastAPI):
 *   GET /participants/project/{project_id}         → lista (arreglo plano)
 *   GET /participants/{id}                         → detalle
 *   GET /participants/{id}/activities              → formularios asignados y su estado
 */

import api from './client';
import type { Participant } from '../types';

/** Forma que devuelve el backend (schemas/participants.py: ParticipantRead) */
type BackendParticipant = {
  id: string;
  project_id: string;
  external_code?: string | null;
  document_id?: string | null;
  full_name: string;
  metadata_json?: string | null;
  department?: string | null;
  municipality?: string | null;
  group_name?: string | null;
};

function toParticipant(p: BackendParticipant): Participant {
  let extra: Record<string, unknown> = {};
  try { extra = p.metadata_json ? JSON.parse(p.metadata_json) : {}; } catch { /* metadata libre */ }
  return {
    id: p.id,
    project_id: p.project_id,
    full_name: p.full_name,
    document_type: typeof extra.document_type === 'string' ? extra.document_type : 'CC',
    // La cache local exige un documento unico por proyecto; sin documento se usa el id.
    document_number: p.document_id || p.id,
    code: p.external_code || '',
    phone: typeof extra.phone === 'string' ? extra.phone : undefined,
    email: typeof extra.email === 'string' ? extra.email : undefined,
    address: [p.municipality, p.department].filter(Boolean).join(', ') || undefined,
    extra_json: p.metadata_json ?? undefined,
    created_at: new Date().toISOString(),
  };
}

/** Lista participantes de un proyecto (la búsqueda se hace en el cliente) */
export async function getProjectParticipants(
  projectId: string,
  params?: { search?: string; limit?: number; offset?: number },
): Promise<{ items: Participant[]; total: number }> {
  const { data } = await api.get<BackendParticipant[]>(`/participants/project/${projectId}`);
  let items = data.map(toParticipant);
  const q = params?.search?.trim().toLowerCase();
  if (q) items = items.filter((p) => p.full_name.toLowerCase().includes(q) || p.document_number.toLowerCase().includes(q));
  const total = items.length;
  const offset = params?.offset ?? 0;
  if (params?.limit) items = items.slice(offset, offset + params.limit);
  return { items, total };
}

/** Detalle de un participante */
export async function getParticipantDetail(participantId: string): Promise<Participant> {
  const { data } = await api.get<BackendParticipant>(`/participants/${participantId}`);
  return toParticipant(data);
}

type BackendActivity = {
  template_id: string;
  template_name: string;
  assignment_status: string;
  record_id?: string | null;
  record_status?: string | null;
};

/** Formularios asignados a un participante con estado de aplicación */
export async function getParticipantForms(
  participantId: string,
): Promise<{
  participant_id: string;
  forms: {
    template_id: string;
    form_name: string;
    applied: boolean;
    applied_at?: string;
    record_id?: string;
  }[];
}> {
  const { data } = await api.get<BackendActivity[]>(`/participants/${participantId}/activities`);
  return {
    participant_id: participantId,
    forms: data.map((a) => ({
      template_id: a.template_id,
      form_name: a.template_name,
      applied: Boolean(a.record_id),
      record_id: a.record_id ?? undefined,
    })),
  };
}
