/**
 * Lógica del formulario igual a la web (H03): visibilidad con
 * relevant_expression, reglas constraint_expression, valores por defecto y
 * campos calculados (frontend/src/modules/runtime/formLogic.ts). Antes la app
 * solo entendía condiciones simples y descartaba los campos calculate, así
 * que sus registros llegaban sin esos valores.
 */

import type { FormComponent, FormPage } from '../../types';
import { isFieldVisible } from './conditionalVisibility';
import { evaluateXlsExpression } from './xlsExpression';

type Values = Record<string, unknown>;

function config(comp: FormComponent): Record<string, any> {
  return (comp.config ?? {}) as Record<string, any>;
}

export function componentVisible(comp: FormComponent, values: Values): boolean {
  const expression = config(comp).relevant_expression;
  if (typeof expression === 'string' && expression.trim()) {
    try { return Boolean(evaluateXlsExpression(expression, values)); } catch { /* regla simple de respaldo, como la web */ }
  }
  return isFieldVisible(comp.conditionalVisibility, values);
}

/** Mensaje si el valor no cumple constraint_expression (null si cumple o no hay regla). */
export function constraintError(comp: FormComponent, value: unknown, values: Values): string | null {
  const { constraint_expression: expression, constraint_message: message } = config(comp);
  if (typeof expression !== 'string' || !expression.trim()) return null;
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  try {
    return evaluateXlsExpression(expression, values, {}, value) ? null : (message || `El valor de «${comp.label}» no cumple la regla.`);
  } catch {
    return null; // expresión fuera del subconjunto: la valida el servidor/web
  }
}

function topLevelComponents(pages: FormPage[]): FormComponent[] {
  return pages.flatMap((page) => page.sections.filter((s) => !s.repeatable)
    .flatMap((section) => section.rows.flatMap((row) => row.columns.flatMap((col) => col.components))));
}

const NUMERIC = new Set(['NUMBER', 'INTEGER', 'DECIMAL', 'CURRENCY', 'PERCENTAGE']);
const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

/** Valores por defecto y cálculos, con el mismo algoritmo que resolveFormValues de la web. */
export function resolveFormValues(pages: FormPage[], input: Values): Values {
  const values: Values = { ...input };
  const components = topLevelComponents(pages);
  for (const comp of components) {
    const c = config(comp);
    if (values[comp.id] !== undefined || c.default === undefined || c.default === '') continue;
    let value: unknown = c.default;
    if (typeof value === 'string' && (value.includes('${') || /^(?:today|now|true|false)\(/.test(value))) {
      try { value = evaluateXlsExpression(value, values); } catch { continue; }
    }
    if (typeof value === 'string' && NUMERIC.has(String(c.backendType ?? '').toUpperCase()) && Number.isFinite(Number(value))) value = Number(value);
    if (scalar(value)) values[comp.id] = value;
  }
  for (let pass = 0; pass < Math.min(components.length, 5); pass += 1) {
    let changed = false;
    for (const comp of components) {
      const calculation = config(comp).calculation;
      if (typeof calculation !== 'string' || !calculation) continue;
      try {
        const result = evaluateXlsExpression(calculation, values);
        if (scalar(result) && values[comp.id] !== result) { values[comp.id] = result; changed = true; }
      } catch { /* fuera del subconjunto soportado */ }
    }
    if (!changed) break;
  }
  return values;
}
