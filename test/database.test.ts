import { beforeEach, describe, expect, it, vi } from 'vitest';

// Base nueva por prueba: se recarga el módulo (cada carga abre su SQLite en memoria).
let db: typeof import('../src/db/database');
beforeEach(async () => {
  vi.resetModules();
  db = await import('../src/db/database');
});

function savedRecord(localId: string) {
  db.enqueueRecord({ localId, projectId: 'p1', templateId: 't1', participantId: null, data: [], evidencePaths: [] } as never);
  return localId;
}

describe('limpieza local (H04/H05)', () => {
  it('purgar sincronizados antiguos con evidencias no rompe el ciclo', () => {
    const id = savedRecord('r1');
    db.insertEvidence({ localId: 'e1', recordLocalId: id, type: 'photo', fileUri: 'file:///ev/e1.jpg', mimeType: 'image/jpeg', fileSize: 1 });
    db.markEvidenceUploaded('e1', 'asset-1', 1);
    db.markRecordSynced(id, 'server-1');
    db.getDatabase().runSync(`UPDATE queued_records SET synced_at = datetime('now', '-30 days')`);
    expect(() => db.purgeOldSynced(7)).not.toThrow();
    expect(db.getRecordEvidence(id)).toEqual([]);
  });

  it('nunca purga un registro cuyas evidencias aún no se han subido', () => {
    const id = savedRecord('r2');
    db.insertEvidence({ localId: 'e2', recordLocalId: id, type: 'video', fileUri: 'file:///ev/e2.mp4', mimeType: 'video/mp4', fileSize: 1 });
    db.markRecordSynced(id, 'server-2');
    db.getDatabase().runSync(`UPDATE queued_records SET synced_at = datetime('now', '-30 days')`);
    db.purgeOldSynced(7);
    expect(db.getRecordEvidence(id)).toHaveLength(1);
    expect(db.getQueuedRecord(id)).not.toBeNull();
  });

  it('nunca purga pendientes, errores ni conflictos', () => {
    for (const [id, mark] of [['a', () => {}], ['b', () => db.markRecordError('b', 'x')], ['c', () => db.markRecordConflict('c', [], null, null)]] as const) {
      savedRecord(id); mark();
    }
    db.getDatabase().runSync(`UPDATE queued_records SET created_at = datetime('now', '-90 days')`);
    db.purgeOldSynced(0);
    expect(['a', 'b', 'c'].map((id) => db.getQueuedRecord(id) !== null)).toEqual([true, true, true]);
  });
});
