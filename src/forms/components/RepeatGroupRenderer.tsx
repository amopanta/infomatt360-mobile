/**
 * Renderizador de secciones repetibles (repeat groups).
 *
 * Permite al usuario agregar multiples instancias de una seccion
 * de formulario (ej: miembros de familia, mediciones, actividades).
 *
 * Los valores se almacenan con clave indexada:
 *   {sectionId}[{index}].{fieldId}
 *
 * Ejemplo: "familia[0].nombre", "familia[1].nombre"
 */

import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import FieldRenderer from './FieldRenderer';
import { isFieldVisible } from '../utils/conditionalVisibility';
import type { FormSection, FormComponent } from '../../types';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface RepeatGroupRendererProps {
  section: FormSection;
  /** Numero de instancias activas de este grupo */
  instanceCount: number;
  /** Todos los valores del formulario (incluye claves indexadas) */
  values: Record<string, unknown>;
  /** Mapa de errores por fieldId (incluye claves indexadas) */
  errors: Map<string, string>;
  /** Callback para cambiar un valor */
  onChange: (fieldId: string, value: unknown) => void;
  /** Callback para agregar una instancia */
  onAddInstance: () => void;
  /** Callback para eliminar una instancia (por indice) */
  onRemoveInstance: (index: number) => void;
  /** Callbacks de captura */
  onCapturePhoto: (fieldId: string) => void;
  onCaptureGps: (fieldId: string) => void;
  onCaptureSignature: (fieldId: string) => void;
  onScanDocument?: (fieldId: string) => void;
  onCaptureFingerprint?: (fieldId: string) => void;
}

/** Extrae todos los componentes de una seccion */
function getSectionComponents(section: FormSection): FormComponent[] {
  const components: FormComponent[] = [];
  for (const row of section.rows) {
    for (const col of row.columns) {
      components.push(...col.components);
    }
  }
  return components;
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

export default function RepeatGroupRenderer({
  section,
  instanceCount,
  values,
  errors,
  onChange,
  onAddInstance,
  onRemoveInstance,
  onCapturePhoto,
  onCaptureGps,
  onCaptureSignature,
  onScanDocument,
  onCaptureFingerprint,
}: RepeatGroupRendererProps) {
  const sectionId = section.id ?? section.title;
  const baseComponents = useMemo(() => getSectionComponents(section), [section]);
  const minReps = section.minRepetitions ?? 1;
  const maxReps = section.maxRepetitions ?? 50;
  const canAdd = instanceCount < maxReps;
  const canRemove = instanceCount > minReps;

  const handleRemove = useCallback(
    (index: number) => {
      Alert.alert(
        'Eliminar',
        `¿Eliminar ${section.title} #${index + 1}?`,
        [
          { text: 'Cancelar', style: 'cancel' },
          {
            text: 'Eliminar',
            style: 'destructive',
            onPress: () => onRemoveInstance(index),
          },
        ],
      );
    },
    [section.title, onRemoveInstance],
  );

  return (
    <View style={styles.container}>
      {/* Header del grupo */}
      <View style={styles.groupHeader}>
        <Text style={styles.groupTitle}>{section.title}</Text>
        <Text style={styles.groupCount}>
          {instanceCount} de {maxReps}
        </Text>
      </View>

      {/* Instancias */}
      {Array.from({ length: instanceCount }).map((_, idx) => {
        // Filtrar componentes visibles para esta instancia
        const visibleComponents = baseComponents.filter((comp) => {
          if (!comp.conditionalVisibility) return true;
          // Para visibilidad condicional dentro de un repeat group,
          // verificar contra los valores indexados de esta instancia
          const instanceValues: Record<string, unknown> = {};
          for (const c of baseComponents) {
            const key = getRepeatFieldId(sectionId, idx, c.id);
            if (values[key] !== undefined) {
              instanceValues[c.id] = values[key];
            }
          }
          return isFieldVisible(comp.conditionalVisibility, { ...values, ...instanceValues });
        });

        return (
          <View key={idx} style={styles.instance}>
            {/* Cabecera de instancia */}
            <View style={styles.instanceHeader}>
              <Text style={styles.instanceTitle}>
                {section.title} #{idx + 1}
              </Text>
              {canRemove && (
                <TouchableOpacity
                  style={styles.removeButton}
                  onPress={() => handleRemove(idx)}
                >
                  <Text style={styles.removeButtonText}>✕</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Campos de esta instancia */}
            {visibleComponents.map((comp) => {
              const indexedId = getRepeatFieldId(sectionId, idx, comp.id);
              return (
                <FieldRenderer
                  key={indexedId}
                  component={{ ...comp, id: indexedId }}
                  value={values[indexedId]}
                  error={errors.get(indexedId)}
                  onChange={onChange}
                  onCapturePhoto={onCapturePhoto}
                  onCaptureGps={onCaptureGps}
                  onCaptureSignature={onCaptureSignature}
                  onScanDocument={onScanDocument}
                  onCaptureFingerprint={onCaptureFingerprint}
                />
              );
            })}
          </View>
        );
      })}

      {/* Boton agregar */}
      {canAdd && (
        <TouchableOpacity style={styles.addButton} onPress={onAddInstance}>
          <Text style={styles.addButtonText}>
            + Agregar {section.title.toLowerCase()}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.md,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primaryLight + '15',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    marginBottom: spacing.sm,
  },
  groupTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.primary,
  },
  groupCount: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  instance: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  instanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
    paddingBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  instanceTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  removeButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.error + '15',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeButtonText: {
    fontSize: fontSize.body,
    color: colors.error,
    fontWeight: '600',
  },
  addButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.primaryLight + '08',
  },
  addButtonText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '500',
  },
});
