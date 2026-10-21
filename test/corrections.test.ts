/** docs/141 §7 y §11: corrección en la tablet con sincronización diferencial. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const server = vi.hoisted(() => ({
  assigned: [] as any[],
  packages: new Map<string, any>(),
  observations: new Map<string, any[]>(),
  lock: new Map<string, number>(),
  patches: [] as any[],
  obsPatches: [] as string[],
  actions: [] as string[],
  downloads: 0,
  packageCalls: 0,
}));

vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID(), CryptoDigestAlgorithm: { SHA256: 'SHA-256' } }));
vi.mock('expo-network', () => ({ getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true }) }));
vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/', cacheDirectory: 'file:///cache/',
  makeDirectoryAsync: async () => {}, getInfoAsync: async () => ({ exists: false }),
  downloadAsync: async (_url: string, target: string) => { server.downloads += 1; return { status: 200, uri: target }; },
  deleteAsync: async () => {},
}));
vi.mock('../src/api/syncApi', () => ({ uploadEvidence: async () => ({ id: 'new-asset', size_bytes: 1, original_name: 'nuevo.jpg' }) }));
vi.mock('../src/api/client', () => ({
  default: {
    get: async (url: string) => {
      if (url.startsWith('/review/my-corrections/')) return { data: server.assigned };
      const obs = url.match(/^\/review\/records\/(.+)\/observations$/);
      if (obs) return { data: server.observations.get(obs[1]) ?? [] };
      const pkg = url.match(/^\/review\/records\/(.+)\/correction-package$/);
      if (pkg) { server.packageCalls += 1; return { data: server.packages.get(pkg[1]) }; }
      throw new Error(`GET no simulado ${url}`);
    },
    patch: async (url: string, body: any) => {
      const fix = url.match(/^\/runtime\/record\/(.+)\/correction$/);
      if (fix) {
        const current = server.lock.get(fix[1]) ?? 1;
        if (body.expected_lock_version !== current) throw Object.assign(new Error('conflict'), { response: { status: 409, data: { detail: 'El registro fue modificado por otro usuario' } } });
        server.patches.push({ id: fix[1], ...body });
        server.lock.set(fix[1], current + 1);
        return { data: { lock_version: current + 1 } };
      }
      server.obsPatches.push(url);
      return { data: {} };
    },
    post: async (_url: string, body: any) => { server.actions.push(body.to_status); return { data: {} }; },
  },
}));

let store: typeof import('../src/corrections/correctionStore');
let sync: typeof import('../src/corrections/correctionSync');

beforeEach(async () => {
  Object.assign(server, { assigned: [], patches: [], obsPatches: [], actions: [], downloads: 0, packageCalls: 0 });
  server.packages.clear(); server.observations.clear(); server.lock.clear();
  vi.resetModules();
  store = await import('../src/corrections/correctionStore');
  sync = await import('../src/corrections/correctionSync');
});

function returnedToMe(id: string) {
  server.assigned = [{ record_id: id, template_id: 't1', participant_id: 'p1', status: 'returned', lock_version: 1 }];
  server.lock.set(id, 1);
  const observations = [{ id: 'o1', field_name: 'fecha', repeat_path: null, reason: 'Fecha inválida', requested_action: null, status: 'pending' },
    { id: 'o2', field_name: 'firma', repeat_path: 'integrantes[0].firma', reason: 'Falta firma', requested_action: null, status: 'pending' }];
  server.observations.set(id, observations);
  server.packages.set(id, {
    record_id: id, project_id: 'proj', template_id: 't1', participant_id: 'p1', lock_version: 1, observations,
    values: [
      { field_name: 'fecha', field_value_json: JSON.stringify('2026-13-01') },
      { field_name: 'ubicacion', field_value_json: JSON.stringify({ type: 'Point', coordinates: [-74.08, 4.6] }) },
      { field_name: 'integrantes', field_value_json: JSON.stringify([{ id: 'integrantes_1', index: 0, values: { nombre: 'Ana', foto: { file_asset_id: 'a1', name: 'ana.jpg', mime_type: 'image/jpeg', size_bytes: 5 } } }]) },
    ],
    attachments: [{ file_asset_id: 'a1', name: 'ana.jpg', mime_type: 'image/jpeg', size_bytes: 5 }],
  });
}

const valuesOf = (localId: string) => Object.fromEntries((JSON.parse(store.getCorrection(localId)!.data_json) as any[]).map((v) => [v.field_name, v.field_value_json]));

describe('corrección en otra tablet (docs/141)', () => {
  it('recibe respuestas, integrantes REPEAT, archivos y observaciones; la segunda vez solo observaciones', async () => {
    returnedToMe('rec-1');
    const first = await sync.pullCorrections('proj');
    expect(first).toMatchObject({ new: 1, filesDownloaded: 1 });
    const local = store.getCorrectionByServerId('rec-1')!;
    expect(local.status).toBe('returned');
    const values = valuesOf(local.local_id);
    expect(values.fecha).toBe('2026-13-01');
    expect(values.ubicacion).toEqual({ lat: 4.6, lng: -74.08, accuracy: 0 }); // GeoJSON → formato de la app
    expect(values['integrantes[0].nombre']).toBe('Ana');
    expect(values['integrantes[0].foto'].uri).toMatch(/^file:/);
    expect(JSON.parse(local.observations_json!)).toHaveLength(2);

    const again = await sync.pullCorrections('proj'); // misma versión: diferencial
    expect(again).toMatchObject({ new: 0, observationsOnly: 1, filesDownloaded: 0 });
    expect(server.packageCalls).toBe(1);
    expect(server.downloads).toBe(1);
  });

  it('envía solo lo que cambió, con la versión, marca observaciones y reenvía', async () => {
    returnedToMe('rec-2');
    await sync.pullCorrections('proj');
    const local = store.getCorrectionByServerId('rec-2')!;
    store.saveCorrectionEdits(local.local_id, { ...valuesOf(local.local_id), fecha: '2026-01-13' }, ['o1']);
    expect(await sync.pushCorrections()).toEqual({ sent: 1, conflicts: 0, errors: 0 });
    expect(server.patches.map((p) => [p.field_name, p.expected_lock_version])).toEqual([['fecha', 1]]); // el REPEAT no cambió
    expect(server.obsPatches).toEqual(['/review/observations/o1']);
    expect(server.actions).toEqual(['corrected', 'submitted']);
    expect(store.getCorrection(local.local_id)!.status).toBe('synced');
  });

  it('conflicto: si cambió en el servidor no se sobrescribe y se conservan los cambios', async () => {
    returnedToMe('rec-3');
    await sync.pullCorrections('proj');
    const local = store.getCorrectionByServerId('rec-3')!;
    store.saveCorrectionEdits(local.local_id, { ...valuesOf(local.local_id), fecha: '2026-02-02' }, []);
    server.lock.set('rec-3', 4); // otro usuario corrigió entretanto
    expect(await sync.pushCorrections()).toMatchObject({ conflicts: 1 });
    const after = store.getCorrection(local.local_id)!;
    expect(after.status).toBe('correction_conflict');
    expect(valuesOf(local.local_id).fecha).toBe('2026-02-02');
    expect(server.actions).toEqual([]);
  });

  it('si ya no le corresponde se retira; con cambios sin enviar se conserva', async () => {
    returnedToMe('rec-4');
    returnedToMe('rec-5');
    server.assigned = [
      { record_id: 'rec-4', template_id: 't1', participant_id: 'p1', status: 'returned', lock_version: 1 },
      { record_id: 'rec-5', template_id: 't1', participant_id: 'p1', status: 'returned', lock_version: 1 },
    ];
    server.packages.set('rec-4', { ...server.packages.get('rec-5'), record_id: 'rec-4' });
    await sync.pullCorrections('proj');
    const edited = store.getCorrectionByServerId('rec-5')!;
    store.saveCorrectionEdits(edited.local_id, { ...valuesOf(edited.local_id), fecha: 'x' }, []);
    server.assigned = []; // reasignadas a otra persona
    expect(await sync.pullCorrections('proj')).toMatchObject({ withdrawn: 1 });
    expect(store.getCorrectionByServerId('rec-4')).toBeNull();
    expect(store.getCorrection(edited.local_id)!.status).toBe('correction_error');
  });
});
