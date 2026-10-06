/**
 * Validacion de campos de formulario segun JSON Schema (doc 23).
 *
 * Soporta:
 *   - required: campo no vacio
 *   - minLength / maxLength: texto
 *   - min / max: numeros
 *   - pattern: regex
 *
 * Retorna un mapa de { fieldId: mensajeError } para los campos invalidos.
 */

import type { FormComponent, FormPage } from '../../types';
import { isFieldVisible } from './conditionalVisibility';
import { getRepeatFieldId } from '../components/RepeatGroupRenderer';

export interface ValidationError {
  fieldId: string;
  message: string;
}

/** Extrae todos los componentes de una lista de paginas (excluyendo secciones repetibles) */
export function getAllComponents(pages: FormPage[]): FormComponent[] {
  const components: FormComponent[] = [];
  for (const page of pages) {
    for (const section of page.sections) {
      if (section.repeatable) continue; // Las repetibles se validan aparte
      for (const row of section.rows) {
        for (const col of row.columns) {
          components.push(...col.components);
        }
      }
    }
  }
  return components;
}

/** Extrae componentes de una seccion */
function getSectionComponents(section: { rows: { columns: { components: FormComponent[] }[] }[] }): FormComponent[] {
  const components: FormComponent[] = [];
  for (const row of section.rows) {
    for (const col of row.columns) {
      components.push(...col.components);
    }
  }
  return components;
}

/** Valida todos los campos y retorna errores (incluye repeat groups) */
export function validateForm(
  pages: FormPage[],
  values: Record<string, unknown>,
  repeatCounts?: Record<string, number>,
): Map<string, string> {
  const errors = new Map<string, string>();

  // 1. Validar campos normales (no repetibles)
  const components = getAllComponents(pages);
  for (const comp of components) {
    if (!isFieldVisible(comp.conditionalVisibility, values)) {
      continue;
    }
    const val = values[comp.id];
    const error = validateField(comp, val);
    if (error) {
      errors.set(comp.id, error);
    }
  }

  // 2. Validar campos de secciones repetibles
  if (repeatCounts) {
    for (const page of pages) {
      for (const section of page.sections) {
        if (!section.repeatable) continue;
        const sectionId = section.id ?? section.title;
        const count = repeatCounts[sectionId] ?? 1;
        const sectionComponents = getSectionComponents(section);

        // Validar minimo de repeticiones
        const minReps = section.minRepetitions ?? 1;
        if (count < minReps) {
          // Agregar error generico al primer campo de la primera instancia
          const firstComp = sectionComponents[0];
          if (firstComp) {
            const key = getRepeatFieldId(sectionId, 0, firstComp.id);
            errors.set(key, `Se requieren al menos ${minReps} ${section.title.toLowerCase()}`);
          }
        }

        for (let i = 0; i < count; i++) {
          for (const comp of sectionComponents) {
            const indexedId = getRepeatFieldId(sectionId, i, comp.id);
            // Visibilidad condicional dentro de la instancia
            if (comp.conditionalVisibility) {
              const instanceValues: Record<string, unknown> = {};
              for (const c of sectionComponents) {
                const k = getRepeatFieldId(sectionId, i, c.id);
                if (values[k] !== undefined) instanceValues[c.id] = values[k];
              }
              if (!isFieldVisible(comp.conditionalVisibility, { ...values, ...instanceValues })) {
                continue;
              }
            }
            const val = values[indexedId];
            const error = validateField(comp, val);
            if (error) {
              errors.set(indexedId, error);
            }
          }
        }
      }
    }
  }

  return errors;
}

/** Valida un campo individual */
export function validateField(
  comp: FormComponent,
  value: unknown,
): string | null {
  const v = comp.validations ?? {};

  // Required
  if (comp.required) {
    if (value === undefined || value === null || value === '') {
      return `${comp.label} es requerido`;
    }
    // Multiselect vacio
    if (Array.isArray(value) && value.length === 0) {
      return `${comp.label} es requerido`;
    }
  }

  // Si no hay valor y no es required, no validar mas
  if (value === undefined || value === null || value === '') {
    return null;
  }
  if (Array.isArray(value) && value.length === 0) {
    return null;
  }

  // Validaciones de texto
  if (typeof value === 'string') {
    const minLength = v.minLength as number | undefined;
    const maxLength = v.maxLength as number | undefined;
    const pattern = v.pattern as string | undefined;

    if (minLength !== undefined && value.length < minLength) {
      return `Minimo ${minLength} caracteres`;
    }
    if (maxLength !== undefined && value.length > maxLength) {
      return `Maximo ${maxLength} caracteres`;
    }
    if (pattern) {
      try {
        const regex = new RegExp(pattern);
        if (!regex.test(value)) {
          return `Formato invalido`;
        }
      } catch {
        // Pattern invalido en el schema — ignorar
      }
    }
  }

  // Validaciones numericas
  if (typeof value === 'number') {
    const min = v.min as number | undefined;
    const max = v.max as number | undefined;

    if (min !== undefined && value < min) {
      return `Valor minimo: ${min}`;
    }
    if (max !== undefined && value > max) {
      return `Valor maximo: ${max}`;
    }
  }

  return null;
}
