/**
 * Reglas para iniciar una captura con participante, sin conexión (H02).
 *
 * Replican require_capture_assignment del backend
 * (backend/app/services/form_assignment_service.py): así el gestor se entera
 * en el momento y no días después, cuando el servidor rechaza el envío.
 * Sin dependencias de Expo: test/assignmentRules.test.ts.
 */

export type AccessMode = 'legacy' | 'open' | 'closed' | string;

export interface CaptureCheck {
  allowed: boolean;
  /** Texto para el gestor cuando no se permite */
  reason?: string;
  /** Etiqueta corta del estado de la actividad */
  label: string;
}

const WRITABLE = new Set(['assigned', 'in_progress']);

export function checkCapture(input: {
  accessMode: AccessMode;
  assignment: { assignment_status: string; record_id: string | null } | null;
  /** Registro ya guardado en este teléfono para la actividad (sin borradores) */
  localRecordStatus: string | null;
  /** Hay paquete descargado para el proyecto (si no, no se puede validar) */
  hasPackage: boolean;
}): CaptureCheck {
  const { accessMode, assignment, localRecordStatus, hasPackage } = input;
  // Formularios antiguos sin modo de acceso: el servidor no exige asignación.
  if (accessMode === 'legacy' || !accessMode) {
    return localRecordStatus
      ? { allowed: false, label: 'Aplicado', reason: 'Esta actividad ya tiene una respuesta guardada en este teléfono.' }
      : { allowed: true, label: 'Pendiente' };
  }
  if (localRecordStatus) {
    return { allowed: false, label: 'Aplicado', reason: 'Esta actividad ya tiene una respuesta guardada en este teléfono.' };
  }
  if (!assignment) {
    return hasPackage
      ? { allowed: false, label: 'Sin asignar', reason: 'Este participante no está asignado a usted para este formulario.' }
      : { allowed: false, label: 'Sin datos', reason: 'Descargue los participantes con conexión para validar las asignaciones.' };
  }
  if (assignment.record_id || assignment.assignment_status === 'completed') {
    return { allowed: false, label: 'Enviado', reason: 'Esta actividad ya tiene una respuesta enviada.' };
  }
  if (assignment.assignment_status === 'closed') {
    return { allowed: false, label: 'Cerrado', reason: 'Esta actividad fue aprobada y está cerrada.' };
  }
  if (!WRITABLE.has(assignment.assignment_status)) {
    return { allowed: false, label: assignment.assignment_status, reason: 'La asignación no permite capturar en este momento.' };
  }
  return { allowed: true, label: assignment.assignment_status === 'in_progress' ? 'En curso' : 'Asignado' };
}

/** Días desde la última descarga; más de este tiempo se avisa al gestor. */
export const PACKAGE_STALE_DAYS = 7;

export function packageAgeDays(downloadedAt: string | null | undefined, now = Date.now()): number | null {
  if (!downloadedAt) return null;
  const t = Date.parse(downloadedAt);
  return Number.isNaN(t) ? null : Math.floor((now - t) / 86_400_000);
}
