/**
 * Evaluacion de visibilidad condicional de campos.
 *
 * Permite mostrar/ocultar campos basados en los valores
 * de otros campos del formulario, segun las reglas definidas
 * en el JSON Schema (conditionalVisibility).
 */

import type { ConditionalRule, ConditionalVisibility } from '../../types';

/** Evalua una regla individual contra los valores actuales */
function evaluateRule(
  rule: ConditionalRule,
  values: Record<string, unknown>,
): boolean {
  const fieldValue = values[rule.fieldId];

  switch (rule.operator) {
    case 'empty':
      return fieldValue === undefined || fieldValue === null || fieldValue === '';

    case 'notEmpty':
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== '';

    case 'eq':
      return fieldValue === rule.value;

    case 'neq':
      return fieldValue !== rule.value;

    case 'gt':
      return typeof fieldValue === 'number' && typeof rule.value === 'number'
        ? fieldValue > rule.value
        : false;

    case 'lt':
      return typeof fieldValue === 'number' && typeof rule.value === 'number'
        ? fieldValue < rule.value
        : false;

    case 'gte':
      return typeof fieldValue === 'number' && typeof rule.value === 'number'
        ? fieldValue >= rule.value
        : false;

    case 'lte':
      return typeof fieldValue === 'number' && typeof rule.value === 'number'
        ? fieldValue <= rule.value
        : false;

    case 'contains':
      return typeof fieldValue === 'string' && typeof rule.value === 'string'
        ? fieldValue.toLowerCase().includes(rule.value.toLowerCase())
        : false;

    default:
      return true; // Operador desconocido — mostrar por defecto
  }
}

/** Evalua si un campo debe ser visible dados los valores actuales */
export function isFieldVisible(
  visibility: ConditionalVisibility | undefined,
  values: Record<string, unknown>,
): boolean {
  if (!visibility || !visibility.rules || visibility.rules.length === 0) {
    return true; // Sin reglas — siempre visible
  }

  const results = visibility.rules.map((rule) => evaluateRule(rule, values));

  if (visibility.logic === 'or') {
    return results.some((r) => r);
  }

  // Default: 'and'
  return results.every((r) => r);
}
