import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftVersionChanged, planFormUpdate } from '../src/forms/formPackagePlan';

describe('plan de actualización de formularios (H01)', () => {
  it('descarga solo lo nuevo o cambiado y retira lo que ya no se ofrece', () => {
    const cached = new Map<string, string | null>([['a', 'h1'], ['b', 'h2'], ['viejo', 'h9'], ['sin-huella', null]]);
    const plan = planFormUpdate(cached, [
      { template_id: 'a', version_hash: 'h1' },
      { template_id: 'b', version_hash: 'h2-nueva' },
      { template_id: 'c', version_hash: 'h3' },
      { template_id: 'sin-huella', version_hash: 'h4' },
    ]);
    expect(plan).toEqual({ download: ['b', 'c', 'sin-huella'], unchanged: ['a'], retire: ['viejo'] });
  });

  it('detecta borradores empezados con otra versión', () => {
    expect(draftVersionChanged('h1', 'h2')).toBe(true);
    expect(draftVersionChanged('h1', 'h1')).toBe(false);
    // Borradores de antes de H01 no tienen versión: no se alarma al gestor
    expect(draftVersionChanged(null, 'h2')).toBe(false);
  });
});

describe('paquete de formularios en el teléfono (SQL real)', () => {
  let db: typeof import('../src/db/database');
  beforeEach(async () => { vi.resetModules(); db = await import('../src/db/database'); });
  const form = (id: string, hash: string) => ({ id, projectId: 'p1', templateId: id, name: `Formulario ${id}`, schemaJson: '[]', versionHash: hash });

  it('retira sin perder borradores ni pendientes; borra el resto', () => {
    db.applyFormPackage('p1', [form('a', 'h1'), form('b', 'h1'), form('c', 'h1')], ['a', 'b', 'c']);
    db.saveAutoDraft({ localId: 'draft-b', projectId: 'p1', templateId: 'b', participantId: 'part-1', data: [] });
    const result = db.applyFormPackage('p1', [], ['a']);
    expect(result).toEqual({ retired: 2, removed: 1 });
    expect(db.getCachedForms('p1').map((f) => f.id)).toEqual(['a']);
    // El borrador sigue abriendo su formulario y conserva el participante
    expect(db.getCachedForm('b')).not.toBeNull();
    expect(db.getCachedForm('c')).toBeNull();
    expect(db.getQueuedRecord('draft-b')?.participant_id).toBe('part-1');
  });

  it('un formulario que vuelve a publicarse deja de estar retirado', () => {
    db.applyFormPackage('p1', [form('a', 'h1')], ['a']);
    db.saveAutoDraft({ localId: 'd', projectId: 'p1', templateId: 'a', data: [] });
    db.applyFormPackage('p1', [], []);
    expect(db.getCachedForms('p1')).toEqual([]);
    db.applyFormPackage('p1', [], ['a']);
    expect(db.getCachedForms('p1').map((f) => f.id)).toEqual(['a']);
  });

  it('cada registro recuerda la versión con la que se empezó', () => {
    db.applyFormPackage('p1', [form('a', 'h1')], ['a']);
    db.saveAutoDraft({ localId: 'd1', projectId: 'p1', templateId: 'a', data: [] });
    db.enqueueRecord({ localId: 'r1', projectId: 'p1', templateId: 'a', data: [], evidencePaths: [] });
    db.applyFormPackage('p1', [form('a', 'h2')], ['a']);
    expect(db.getRecordTemplateVersion('d1')).toBe('h1');
    expect(db.getRecordTemplateVersion('r1')).toBe('h1');
    expect(db.getFormVersion('a')?.version_hash).toBe('h2');
  });

  it('si algo falla a mitad, quedan las versiones anteriores completas', () => {
    db.applyFormPackage('p1', [form('a', 'h1')], ['a']);
    expect(() => db.applyFormPackage('p1', [form('a', 'h2'), { ...form('b', 'h1'), schemaJson: null as never }], ['a', 'b'])).toThrow();
    expect(db.getFormVersion('a')?.version_hash).toBe('h1');
    expect(db.getCachedForm('b')).toBeNull();
  });
});
