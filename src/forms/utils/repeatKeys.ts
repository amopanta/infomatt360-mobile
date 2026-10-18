/**
 * Claves de los grupos repetibles ("grupo[0].campo"). Sin dependencias de
 * React Native, para usarlas en validaciones y pruebas.
 */

import type { FormComponent, FormSection } from '../../types';

/** Sección sintética para un repeat anidado; su id es la clave de la fila padre. */
export function nestedSection(comp: FormComponent, indexedId: string): FormSection {
  return {
    id: indexedId,
    title: comp.label,
    rows: [{ columns: [{ desktopWidth: 12, tabletWidth: 12, mobileWidth: 12, components: comp.children ?? [] }] }],
    repeatable: true,
    minRepetitions: comp.required ? 1 : 0,
    maxRepetitions: 50,
  };
}

/** Genera el ID indexado para un campo en una instancia */
export function getRepeatFieldId(sectionId: string, index: number, fieldId: string): string {
  return `${sectionId}[${index}].${fieldId}`;
}

/** Detecta si un fieldId pertenece a un repeat group y extrae sus partes */
export function parseRepeatFieldId(compositeId: string): {
  sectionId: string;
  index: number;
  fieldId: string;
} | null {
  const match = compositeId.match(/^(.+)\[(\d+)\]\.(.+)$/);
  if (!match) return null;
  return {
    sectionId: match[1],
    index: parseInt(match[2], 10),
    fieldId: match[3],
  };
}
