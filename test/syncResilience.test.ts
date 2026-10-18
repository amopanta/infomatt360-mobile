/**
 * H06 en la app: ciclo de sincronización real (syncNow) contra un servidor
 * simulado con la misma regla de idempotencia que bulk-save.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Item = { index: number; id: string | null; status: string; error?: string | null };
const server = vi.hoisted(() => ({
  batches: new Map<string, Item[]>(),
  created: [] as string[],
  calls: 0,
  loseNextResponse: false,
  failNames: new Set<string>(),
}));

vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_: string, value: string) => createHash('sha256').update(value).digest('hex'),
  randomUUID: () => crypto.randomUUID(),
}));
vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) }));
vi.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file:///cache/', documentDirectory: 'file:///docs/',
  deleteAsync: async () => {}, writeAsStringAsync: async () => {}, getInfoAsync: async () => ({ exists: false }),
  EncodingType: { Base64: 'base64' },
}));
vi.mock('../src/api/syncApi', () => ({
  uploadEvidence: async () => { throw new Error('sin evidencias en esta prueba'); },
  bulkSaveRecords: async (payload: { idempotency_key: string; records: { values: { field_name: string; field_value_json: string }[] }[] }) => {
    server.calls += 1;
    let results = server.batches.get(payload.idempotency_key);
    if (!results) {
      results = payload.records.map((record, index) => {
        const name = JSON.parse(record.values.find((v) => v.field_name === 'nombre')?.field_value_json ?? '""');
        if (server.failNames.has(name)) return { index, id: null, status: 'failed', error: 'El participante indicado no existe' };
        server.created.push(name);
        return { index, id: `srv-${server.created.length}`, status: 'created', error: null };
      });
      server.batches.set(payload.idempotency_key, results);
    } else {
      return { replayed: true, results };
    }
    if (server.loseNextResponse) {
      server.loseNextResponse = false;
      throw Object.assign(new Error('Network Error'), { response: undefined }); // el servidor guardó, la respuesta no llegó
    }
    return { replayed: false, results };
  },
}));

let db: typeof import('../src/db/database');
let sync: typeof import('../src/sync/syncService');

beforeEach(async () => {
  server.batches.clear(); server.created = []; server.calls = 0; server.loseNextResponse = false; server.failNames.clear();
  vi.resetModules();
  db = await import('../src/db/database');
  sync = await import('../src/sync/syncService');
});

const capture = (localId: string, nombre: string) => db.enqueueRecord({
  localId, projectId: 'p1', templateId: 't1', evidencePaths: [],
  data: [{ field_id: 'nombre', field_name: 'nombre', field_value_json: nombre }],
});
const status = (localId: string) => db.getDatabase().getFirstSync<{ status: string; error_message: string | null }>(
  `SELECT status, error_message FROM queued_records WHERE local_id = ?`, [localId]);

describe('sincronización resistente (H06)', () => {
  it('respuesta perdida: el reenvío no duplica y el registro queda sincronizado', async () => {
    capture('r1', 'Ana');
    server.loseNextResponse = true;
    await sync.syncNow();
    expect(status('r1')?.status).toBe('pending'); // sigue pendiente, no en error
    await sync.syncNow();
    await sync.syncNow();
    expect(status('r1')?.status).toBe('synced');
    expect(server.created).toEqual(['Ana']); // una sola respuesta definitiva
  });

  it('un registro rechazado no bloquea a los demás del lote', async () => {
    capture('a', 'Ana'); capture('b', 'Mal'); capture('c', 'Luis');
    server.failNames.add('Mal');
    await sync.syncNow();
    expect([status('a')?.status, status('b')?.status, status('c')?.status]).toEqual(['synced', 'error', 'synced']);
    expect(status('b')?.error_message).toMatch(/participante/);
    // Los siguientes ciclos no reenvían lo ya confirmado
    await sync.syncNow();
    expect(server.created).toEqual(['Ana', 'Luis']);
  });
});
