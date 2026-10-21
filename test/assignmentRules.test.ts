import { beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCapture, packageAgeDays } from '../src/participants/assignmentRules';

const assigned = (status: string, record_id: string | null = null) => ({ assignment_status: status, record_id });

describe('reglas de captura sin conexión (H02, igual a require_capture_assignment)', () => {
  it('formulario legacy: libre, salvo que ya se aplicó en el teléfono', () => {
    expect(checkCapture({ accessMode: 'legacy', assignment: null, localRecordStatus: null, hasPackage: false }).allowed).toBe(true);
    expect(checkCapture({ accessMode: 'legacy', assignment: null, localRecordStatus: 'pending', hasPackage: true }).allowed).toBe(false);
  });

  it('abierto o cerrado: exige asignación activa al gestor', () => {
    for (const mode of ['open', 'closed']) {
      expect(checkCapture({ accessMode: mode, assignment: null, localRecordStatus: null, hasPackage: true }).label).toBe('Sin asignar');
      expect(checkCapture({ accessMode: mode, assignment: assigned('assigned'), localRecordStatus: null, hasPackage: true }).allowed).toBe(true);
      expect(checkCapture({ accessMode: mode, assignment: assigned('in_progress'), localRecordStatus: null, hasPackage: true }).label).toBe('En curso');
    }
  });

  it('bloquea actividades enviadas, cerradas o ya capturadas en el teléfono', () => {
    const base = { accessMode: 'closed', localRecordStatus: null, hasPackage: true };
    expect(checkCapture({ ...base, assignment: assigned('completed') }).label).toBe('Enviado');
    expect(checkCapture({ ...base, assignment: assigned('in_progress', 'rec-1') }).label).toBe('Enviado');
    expect(checkCapture({ ...base, assignment: assigned('closed') }).label).toBe('Cerrado');
    expect(checkCapture({ ...base, assignment: assigned('assigned'), localRecordStatus: 'synced' }).allowed).toBe(false);
  });

  it('sin paquete descargado no inventa permisos', () => {
    const r = checkCapture({ accessMode: 'closed', assignment: null, localRecordStatus: null, hasPackage: false });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Descargue/);
  });

  it('antigüedad del paquete en días', () => {
    const now = Date.parse('2026-10-18T12:00:00Z');
    expect(packageAgeDays('2026-10-10T11:00:00Z', now)).toBe(8);
    expect(packageAgeDays(null, now)).toBeNull();
  });
});

describe('paquete local de participantes (SQL real)', () => {
  let db: typeof import('../src/db/database');
  beforeEach(async () => { vi.resetModules(); db = await import('../src/db/database'); });
  const person = (id: string, doc: string) => ({ id, projectId: 'p1', fullName: `Persona ${id}`, documentType: 'CC', documentNumber: doc, code: '' });

  it('reemplazo atómico: quien ya no está autorizado desaparece; otro proyecto no se toca', () => {
    db.replaceProjectSnapshot('p1', [person('a', '1'), person('b', '2')], [
      { template_id: 't1', participant_id: 'a', access_mode: 'closed', assignment_status: 'assigned', record_id: null },
    ]);
    db.cacheParticipant({ ...person('z', '9'), projectId: 'p2' });
    db.replaceProjectSnapshot('p1', [person('b', '2')], []);
    expect(db.getCachedParticipants('p1').map((p) => p.id)).toEqual(['b']);
    expect(db.getCachedParticipants('p2').map((p) => p.id)).toEqual(['z']);
    expect(db.getCachedAssignment('p1', 't1', 'a')).toBeNull();
    expect(db.getOfflinePackage('p1')?.participant_count).toBe(1);
  });

  it('un error a mitad deja el paquete anterior intacto', () => {
    db.replaceProjectSnapshot('p1', [person('a', '1')], []);
    // Un participante inválido (nombre nulo) a mitad de la descarga.
    expect(() => db.replaceProjectSnapshot('p1', [person('b', '2'), { ...person('c', '3'), fullName: null as never }], [])).toThrow();
    expect(db.getCachedParticipants('p1').map((p) => p.id)).toEqual(['a']);
  });

  it('busca por documento sin red', () => {
    db.replaceProjectSnapshot('p1', [person('a', '1001'), person('b', '2002')], []);
    expect(db.getCachedParticipants('p1', '2002').map((p) => p.id)).toEqual(['b']);
  });
});
