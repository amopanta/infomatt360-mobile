/** docs/141 §3: respuestas previas del participante, también de otros equipos. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/client', () => ({
  default: {
    get: async (url: string) => {
      if (url === '/participants/p1/history') return { data: [
        { record_id: 'r1', template_id: 't1', template_name: 'Visita 1', status: 'approved', created_at: '2026-10-01T10:00:00' },
        { record_id: 'r-sin-acceso', template_id: 't2', template_name: 'Otra', status: 'submitted', created_at: '2026-10-02T10:00:00' },
      ] };
      if (url === '/runtime/record/r1') return { data: { id: 'r1', values: [
        { field_name: 'nombre', field_value_json: '"Ana"' },
        { field_name: 'integrantes', field_value_json: JSON.stringify([{ id: 'integrantes_1', index: 0, values: { edad: 7 } }]) },
        { field_name: 'soporte', field_value_json: JSON.stringify({ file_asset_id: 'a1', name: 'acta.pdf' }) },
      ] } };
      throw Object.assign(new Error('403'), { response: { status: 403 } });
    },
  },
}));

let history: typeof import('../src/participants/historyCache');
beforeEach(async () => { vi.resetModules(); history = await import('../src/participants/historyCache'); });

describe('historial del participante sin conexión', () => {
  it('guarda en solo lectura lo que el servidor permite y lo muestra legible', async () => {
    expect(await history.downloadParticipantHistory('proj', ['p1'])).toBe(1); // el registro sin acceso se omite
    const [item] = history.participantHistory('p1');
    const values = JSON.parse(item.values_json);
    expect(item.template_name).toBe('Visita 1');
    expect(values['integrantes[0].edad']).toBe(7);
    expect(history.displayValue(values.soporte)).toBe('📎 acta.pdf'); // archivos listados, no descargados
    expect(history.displayValue(true)).toBe('Sí');
  });
});
