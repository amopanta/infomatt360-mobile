/**
 * H03: paridad con la web. Los casos de evaluateXlsExpression son los de
 * frontend/src/modules/runtime/xlsExpression.test.ts; el formulario de prueba
 * es el mismo, expresado en el modelo de la app.
 */
import { describe, expect, it } from 'vitest';
import { componentVisible, constraintError, resolveFormValues } from '../src/forms/utils/formLogic';
import { evaluateXlsExpression } from '../src/forms/utils/xlsExpression';
import { validateForm } from '../src/forms/utils/validation';
import type { FormComponent, FormPage } from '../src/types';

describe('XLSForm expressions (mismos casos que la web)', () => {
  it('evaluates field dependencies, selected and calculations safely', () => {
    const values = { visita: 'si', municipio: 'Bogotá', ayudas: ['kit'], edad: 20 };
    expect(evaluateXlsExpression("${visita} = 'si' and ${edad} >= 18", values)).toBe(true);
    expect(evaluateXlsExpression("selected(${ayudas}, 'kit')", values)).toBe(true);
    expect(evaluateXlsExpression('(${edad} + 2) * 3', values)).toBe(66);
    expect(evaluateXlsExpression('municipio = ${municipio}', values, { municipio: 'Bogotá' })).toBe(true);
    expect(evaluateXlsExpression('municipio = ${municipio}', values, { municipio: 'Soacha' })).toBe(false);
  });

  it('evaluates MEAL date and household rules', () => {
    const values = { personas_hogar: 4, tipo_beneficio: ['5'] };
    expect(evaluateXlsExpression("selected(${tipo_beneficio}, '5')", values)).toBe(true);
    expect(evaluateXlsExpression('${personas_hogar} > 1', values)).toBe(true);
    expect(evaluateXlsExpression('. <= ${personas_hogar}', values, {}, 3)).toBe(true);
    expect(evaluateXlsExpression('string-length(.) = 10', values, {}, 3001234567)).toBe(true);
    expect(evaluateXlsExpression('. <= today()', values, {}, '2099-01-01')).toBe(false);
    expect(evaluateXlsExpression('. <= today()', values, {}, '2000-01-01')).toBe(true);
  });
});

const field = (id: string, type: string, backendType: string, config: Record<string, unknown>, extra: Partial<FormComponent> = {}): FormComponent =>
  ({ id, type, label: id, required: Boolean(config.required), config: { ...config, backendType }, ...extra } as FormComponent);

const visita = field('visita', 'text', 'TEXT', { default: 'si' });
const edad = field('edad', 'number', 'NUMBER', { required: true, constraint_expression: '. >= 18', constraint_message: 'Debe ser mayor de edad' });
const doble = field('doble', 'calculate', 'CALCULATE', { calculation: '${edad} * 2' });
const extra = field('extra', 'text', 'TEXT', { relevant_expression: "${visita} = 'si' and ${doble} >= 36" });
const pages: FormPage[] = [{ title: 'P', sections: [{ id: 's', title: 'S', rows: [{ columns: [{ desktopWidth: 12, tabletWidth: 12, mobileWidth: 12, components: [visita, edad, doble, extra] }] }] }] }];

describe('mismo formulario, mismos resultados que la web (H03)', () => {
  it('aplica valores por defecto y cálculos', () => {
    expect(resolveFormValues(pages, {}).visita).toBe('si');
    expect(resolveFormValues(pages, { edad: 20 }).doble).toBe(40);
  });

  it('visibilidad con expresiones, incluso sobre campos calculados', () => {
    expect(componentVisible(extra, resolveFormValues(pages, { edad: 20 }))).toBe(true);
    expect(componentVisible(extra, resolveFormValues(pages, { edad: 17 }))).toBe(false);
    expect(componentVisible(extra, resolveFormValues(pages, { visita: 'no', edad: 20 }))).toBe(false);
  });

  it('reglas constraint con su mensaje', () => {
    expect(constraintError(edad, 16, {})).toBe('Debe ser mayor de edad');
    expect(constraintError(edad, 20, {})).toBeNull();
    const errors = validateForm(pages, resolveFormValues(pages, { edad: 16 }));
    expect(errors.get('edad')).toBe('Debe ser mayor de edad');
    expect(validateForm(pages, resolveFormValues(pages, { edad: 20 })).size).toBe(0);
  });

  it('dentro de un grupo repetible la regla ve los valores de su fila', () => {
    const nombre = field('nombre', 'text', 'TEXT', { required: true });
    const motivo = field('motivo', 'text', 'TEXT', { required: true, relevant_expression: "${asiste} = 'no'" });
    const asiste = field('asiste', 'select', 'SELECT', {});
    const repeatPages: FormPage[] = [{ title: 'P', sections: [{ id: 'g', title: 'Integrantes', repeatable: true, minRepetitions: 1, rows: [{ columns: [{ desktopWidth: 12, tabletWidth: 12, mobileWidth: 12, components: [nombre, asiste, motivo] }] }] }] }];
    const errors = validateForm(repeatPages, { 'g[0].nombre': 'Ana', 'g[0].asiste': 'si', 'g[1].nombre': 'Luis', 'g[1].asiste': 'no' }, { g: 2 });
    expect([...errors.keys()]).toEqual(['g[1].motivo']); // solo la fila que respondió "no"
  });

  it('regla simple: true y "true" valen igual, como en la web', () => {
    const acepta = field('acepta', 'select', 'BOOLEAN', {});
    const detalle = field('detalle', 'text', 'TEXT', {}, { conditionalVisibility: { logic: 'and', rules: [{ fieldId: 'acepta', operator: 'eq', value: 'true' }] } } as never);
    expect(componentVisible(detalle, { acepta: true })).toBe(true);
    expect(componentVisible(detalle, { acepta: 'true' })).toBe(true);
    expect(componentVisible(detalle, { acepta: false })).toBe(false);
    void acepta;
  });
});
