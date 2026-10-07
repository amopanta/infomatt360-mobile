/**
 * API de participantes — descarga de participantes para vista 360.
 *
 * Endpoints:
 *   GET /participants/project/{project_id}         → lista de participantes
 *   GET /participants/{id}                         → detalle de participante
 *   GET /participants/{id}/forms                   → formularios asociados con estado
 */

import api from './client';
import type { Participant } from '../types';

/** Lista participantes de un proyecto (con búsqueda opcional) */
export async function getProjectParticipants(
  projectId: number,
  params?: { search?: string; limit?: number; offset?: number },
): Promise<{ items: Participant[]; total: number }> {
  const { data } = await api.get(`/participants/project/${projectId}`, { params });
  return data;
}

/** Detalle de un participante */
export async function getParticipantDetail(participantId: number): Promise<Participant> {
  const { data } = await api.get(`/participants/${participantId}`);
  return data;
}

/** Formularios asignados a un participante con estado de aplicación */
export async function getParticipantForms(
  participantId: number,
): Promise<{
  participant_id: number;
  forms: {
    template_id: number;
    form_name: string;
    applied: boolean;
    applied_at?: string;
    record_id?: number;
  }[];
}> {
  const { data } = await api.get(`/participants/${participantId}/forms`);
  return data;
}
