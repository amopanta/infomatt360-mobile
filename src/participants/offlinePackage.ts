/**
 * Paquete sin conexión del proyecto (H02): participantes autorizados y
 * asignaciones del gestor. El servidor ya filtra por permisos y territorio
 * (allowed_participant_ids); aquí se reemplaza la copia local completa en una
 * sola transacción.
 */

import api from '../api/client';
import { getProjectParticipants } from '../api/participantsApi';
import { replaceProjectSnapshot, type CachedAssignment } from '../db/database';

type MyAssignment = {
  template_id: string;
  participant_id: string;
  access_mode: string;
  assignment_status: string;
  record_id?: string | null;
};

export async function downloadProjectPackage(projectId: string): Promise<{ participants: number; assignments: number }> {
  // Sin límite: antes se guardaban solo los primeros 1000 participantes.
  const [{ items }, assignments] = await Promise.all([
    getProjectParticipants(projectId),
    api.get<MyAssignment[]>(`/form-assignments/mine/${projectId}`)
      .then((r) => r.data)
      // Sin permiso de captura no hay asignaciones propias.
      .catch((err) => (err?.response?.status === 403 ? [] : Promise.reject(err))),
  ]);
  const rows: CachedAssignment[] = assignments.map((a) => ({
    template_id: a.template_id,
    participant_id: a.participant_id,
    access_mode: a.access_mode,
    assignment_status: a.assignment_status,
    record_id: a.record_id ?? null,
  }));
  replaceProjectSnapshot(projectId, items.map((p) => ({
    id: p.id,
    projectId,
    fullName: p.full_name,
    documentType: p.document_type,
    documentNumber: p.document_number,
    code: p.code,
    phone: p.phone,
    email: p.email,
    address: p.address,
    extraJson: p.extra_json,
    createdAt: p.created_at,
    updatedAt: p.updated_at,
  })), rows);
  return { participants: items.length, assignments: rows.length };
}
