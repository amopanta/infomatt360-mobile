import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userIdFromToken } from '../src/auth/jwt';

const token = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub, exp: 1 })).toString('base64url')}.firma`;

describe('usuario del token (H07)', () => {
  it('lee sub sin red, también con caracteres no ASCII', () => {
    expect(userIdFromToken(token('user-a'))).toBe('user-a');
    expect(userIdFromToken(token('ñandú-1'))).toBe('ñandú-1');
    expect(userIdFromToken('basura')).toBeNull();
  });
});

describe('datos separados por usuario en un equipo compartido (H07)', () => {
  let db: typeof import('../src/db/database');
  let owner: typeof import('../src/auth/sessionOwner');
  beforeEach(async () => {
    vi.resetModules();
    db = await import('../src/db/database');
    owner = await import('../src/auth/sessionOwner');
    await owner.hydrateOwnership();
  });
  const capture = (localId: string) =>
    db.enqueueRecord({ localId, projectId: 'p1', templateId: 't1', data: [], evidencePaths: [] });

  it('el segundo usuario no ve ni envía lo pendiente del primero', () => {
    owner.activateUserFromToken(token('user-a'));
    capture('de-ana');
    db.cacheParticipant({ id: 'x', projectId: 'p1', fullName: 'Participante de Ana', documentType: 'CC', documentNumber: '1', code: '' });

    owner.activateUserFromToken(token('user-b'));
    expect(db.listPendingRecords()).toEqual([]);
    expect(db.getCachedParticipants('p1')).toEqual([]);
    expect(owner.unsentFromOtherUsers('user-b')).toBe(1);

    owner.activateUserFromToken(token('user-a'));
    expect(db.listPendingRecords().map((r) => r.local_id)).toEqual(['de-ana']);
    expect(owner.unsentFromOtherUsers('user-a')).toBe(0);
  });

  it('la base anterior a la actualización queda para el primer usuario que entra', () => {
    // Datos de antes de H07, en infomatt360.db
    db.setDatabaseOwner({ userId: 'cualquiera', useLegacyFile: true });
    capture('antiguo');
    db.setDatabaseOwner(null);

    owner.activateUserFromToken(token('primero'));
    expect(db.listPendingRecords().map((r) => r.local_id)).toEqual(['antiguo']);
    owner.activateUserFromToken(token('segundo'));
    expect(db.listPendingRecords()).toEqual([]);
  });

  it('sin sesión se usa la base del equipo, sin datos de nadie', () => {
    owner.activateUserFromToken(token('user-a'));
    capture('de-ana');
    owner.deactivateUser();
    expect(db.listPendingRecords()).toEqual([]);
  });

  it('borrar los datos del usuario no toca los de otros', () => {
    owner.activateUserFromToken(token('user-a'));
    capture('de-ana');
    owner.activateUserFromToken(token('user-b'));
    capture('de-beto');
    db.insertEvidence({ localId: 'e', recordLocalId: 'de-beto', type: 'photo', fileUri: 'file:///ev/b.jpg', mimeType: 'image/jpeg', fileSize: 1 });
    expect(db.deleteActiveUserDatabase()).toEqual(['file:///ev/b.jpg']);
    expect(db.listPendingRecords()).toEqual([]);
    owner.activateUserFromToken(token('user-a'));
    expect(db.listPendingRecords().map((r) => r.local_id)).toEqual(['de-ana']);
  });

  it('la sesión sin conexión vence a los 15 días sin validar en línea', () => {
    const now = Date.now();
    owner.noteOnlineAuth();
    expect(owner.offlineSessionValid(now + 14 * 86_400_000)).toBe(true);
    expect(owner.offlineSessionValid(now + 16 * 86_400_000)).toBe(false);
  });
});
