import { describe, expect, it } from 'vitest';
import { nestRepeatValues, toBackendValues } from '../src/sync/backendValues';

const parsed = (rows: { field_name: string; field_value_json: string }[]) =>
  Object.fromEntries(rows.map((r) => [r.field_name, JSON.parse(r.field_value_json)]));

describe('contrato de valores con el backend (H03/H06)', () => {
  it('agrupa repeticiones anidadas como la web: [{id, index, values}]', () => {
    const nested = nestRepeatValues(new Map<string, unknown>([
      ['nombre', 'Ana'],
      ['integrantes[0].nombre', 'Luis'],
      ['integrantes[0].contactos[1].tel', '300'],
      ['integrantes[0].contactos[0].tel', '310'],
      ['integrantes[2].nombre', 'Eva'],
    ]));
    expect(nested.get('nombre')).toBe('Ana');
    expect(nested.get('integrantes')).toEqual([
      { id: 'integrantes_1', index: 0, values: { nombre: 'Luis', contactos: [
        { id: 'contactos_1', index: 0, values: { tel: '310' } },
        { id: 'contactos_2', index: 1, values: { tel: '300' } },
      ] } },
      { id: 'integrantes_3', index: 1, values: { nombre: 'Eva' } },
    ]);
  });

  it('serialización estable: mismas entradas, mismo resultado', () => {
    const values = [
      { field_id: 'acepta', field_name: 'acepta', field_value_json: 'true' },
      { field_id: 'g[0].acepta', field_name: 'g[0].acepta', field_value_json: 'false' },
      { field_id: 'edad', field_name: 'edad', field_value_json: 34 },
    ] as never[];
    const types = new Map([['acepta', 'BOOLEAN']]);
    const a = toBackendValues(values, new Map(), types);
    expect(a).toEqual(toBackendValues(values, new Map(), types));
    expect(parsed(a)).toEqual({ acepta: true, edad: 34, g: [{ id: 'g_1', index: 0, values: { acepta: false } }] });
  });

  it('archivos subidos se envían como referencia del servidor, también en MULTIFILE', () => {
    const asset = (id: string) => ({ file_asset_id: id, name: `${id}.pdf`, mime_type: 'application/pdf', size_bytes: 10 });
    const uploaded = new Map([['file:///ev/a.pdf', asset('A')], ['file:///ev/b.pdf', asset('B')]]);
    const out = parsed(toBackendValues([
      { field_id: 'acta', field_name: 'acta', field_value_json: { uri: 'file:///ev/a.pdf', type: 'document' } },
      { field_id: 'soportes', field_name: 'soportes', field_value_json: [{ uri: 'file:///ev/a.pdf' }, { uri: 'file:///ev/b.pdf' }] },
    ] as never[], uploaded, new Map()));
    expect(out.acta).toEqual(asset('A'));
    const named = parsed(toBackendValues([{ field_id: 'x', field_name: 'x', field_value_json: { uri: 'file:///ev/a.pdf', fileName: 'acta_visita.pdf' } }] as never[], uploaded, new Map()));
    expect(named.x).toEqual({ ...asset('A'), name: 'acta_visita.pdf' });
    expect(out.soportes).toEqual([asset('A'), asset('B')]);
  });
});

describe('registro devuelto del servidor a la tablet (docs/141)', () => {
  it('flattenServerValues es el inverso de nestRepeatValues', async () => {
    const { flattenServerValues } = await import('../src/sync/backendValues');
    const flat = new Map<string, unknown>([
      ['nombre', 'Ana'],
      ['integrantes[0].nombre', 'Luis'],
      ['integrantes[0].contactos[0].tel', '310'],
      ['integrantes[1].nombre', 'Eva'],
    ]);
    const server = [...nestRepeatValues(flat)].map(([field_name, value]) => ({ field_name, field_value_json: JSON.stringify(value) }));
    expect(flattenServerValues(server)).toEqual(Object.fromEntries(flat));
  });
});
