/**
 * Pantalla de resolucion de conflictos de sincronizacion.
 *
 * Cuando un registro local fue modificado en el servidor
 * desde la ultima sincronizacion, el usuario puede:
 *   - Mantener la version local (re-enviar al servidor)
 *   - Aceptar la version del servidor (descartar local)
 *   - Resolver todos de golpe
 *
 * Los conflictos se detectan durante la sincronizacion
 * cuando el servidor responde con status 'conflict' o HTTP 409.
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  listConflictRecords,
  resolveConflictKeepLocal,
  resolveConflictKeepServer,
  getConflictCount,
  getCachedForm,
} from '../db/database';
import type { RecordValue } from '../types';
import { colors, spacing, fontSize, borderRadius } from '../ui/theme';

interface ConflictItem {
  local_id: string;
  project_id: number;
  template_id: number;
  participant_id: number | null;
  data_json: string;
  server_data_json: string | null;
  server_record_id: number | null;
  server_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Encuentra las diferencias entre datos locales y del servidor */
function findDifferences(
  localValues: RecordValue[],
  serverValues: RecordValue[],
): { fieldName: string; localValue: unknown; serverValue: unknown }[] {
  const diffs: { fieldName: string; localValue: unknown; serverValue: unknown }[] = [];
  const serverMap = new Map(serverValues.map((v) => [v.field_id, v]));
  const seenIds = new Set<string>();

  for (const local of localValues) {
    seenIds.add(local.field_id);
    const server = serverMap.get(local.field_id);
    const localStr = JSON.stringify(local.field_value_json);
    const serverStr = server ? JSON.stringify(server.field_value_json) : undefined;

    if (localStr !== serverStr) {
      diffs.push({
        fieldName: local.field_name || local.field_id,
        localValue: local.field_value_json,
        serverValue: server?.field_value_json ?? '(no existe)',
      });
    }
  }

  // Campos que solo existen en el servidor
  for (const server of serverValues) {
    if (!seenIds.has(server.field_id)) {
      diffs.push({
        fieldName: server.field_name || server.field_id,
        localValue: '(no existe)',
        serverValue: server.field_value_json,
      });
    }
  }

  return diffs;
}

/** Formatea un valor para mostrar en la UI */
function formatValue(val: unknown): string {
  if (val === null || val === undefined) return '(vacio)';
  if (typeof val === 'string') return val || '(vacio)';
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') {
    // GPS coordinates
    if ('lat' in (val as any) && 'lng' in (val as any)) {
      const gps = val as { lat: number; lng: number };
      return `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`;
    }
    // Signature / fingerprint
    if ('dataUri' in (val as any)) return '(firma/huella)';
    return JSON.stringify(val).substring(0, 80);
  }
  return String(val);
}

export default function ConflictResolutionScreen() {
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [templateNames, setTemplateNames] = useState<Record<number, string>>({});

  const refresh = useCallback(() => {
    const items = listConflictRecords() as ConflictItem[];
    setConflicts(items);

    // Cargar nombres de templates
    const names: Record<number, string> = {};
    const seenTemplates = new Set<number>();
    for (const item of items) {
      if (!seenTemplates.has(item.template_id)) {
        seenTemplates.add(item.template_id);
        const form = getCachedForm(item.template_id);
        names[item.template_id] = form?.name ?? `Formulario #${item.template_id}`;
      }
    }
    setTemplateNames(names);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleKeepLocal = (localId: string) => {
    Alert.alert(
      'Mantener version local',
      'Se re-enviara la version local al servidor, sobreescribiendo los datos del servidor. Esta accion no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mantener local',
          style: 'destructive',
          onPress: () => {
            resolveConflictKeepLocal(localId);
            refresh();
          },
        },
      ],
    );
  };

  const handleKeepServer = (localId: string) => {
    Alert.alert(
      'Aceptar version del servidor',
      'Se descartaran los cambios locales y se mantendran los datos del servidor. Esta accion no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aceptar servidor',
          style: 'destructive',
          onPress: () => {
            resolveConflictKeepServer(localId);
            refresh();
          },
        },
      ],
    );
  };

  const handleResolveAllLocal = () => {
    Alert.alert(
      'Mantener todas las versiones locales',
      `Se re-enviaran ${conflicts.length} registro(s) al servidor. Esta accion no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Mantener todos local',
          style: 'destructive',
          onPress: () => {
            for (const c of conflicts) {
              resolveConflictKeepLocal(c.local_id);
            }
            refresh();
          },
        },
      ],
    );
  };

  const handleResolveAllServer = () => {
    Alert.alert(
      'Aceptar todas las versiones del servidor',
      `Se descartaran los cambios locales de ${conflicts.length} registro(s). Esta accion no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Aceptar todos servidor',
          style: 'destructive',
          onPress: () => {
            for (const c of conflicts) {
              resolveConflictKeepServer(c.local_id);
            }
            refresh();
          },
        },
      ],
    );
  };

  const renderConflict = ({ item }: { item: ConflictItem }) => {
    const isExpanded = expandedId === item.local_id;
    const localValues: RecordValue[] = JSON.parse(item.data_json);
    const serverValues: RecordValue[] = item.server_data_json
      ? JSON.parse(item.server_data_json)
      : [];
    const diffs = findDifferences(localValues, serverValues);

    return (
      <View style={styles.conflictCard}>
        {/* Header */}
        <TouchableOpacity
          style={styles.conflictHeader}
          onPress={() => setExpandedId(isExpanded ? null : item.local_id)}
        >
          <View style={styles.conflictHeaderLeft}>
            <Text style={styles.conflictIcon}>⚠️</Text>
            <View>
              <Text style={styles.conflictTitle}>
                {templateNames[item.template_id] ?? `Formulario #${item.template_id}`}
              </Text>
              <Text style={styles.conflictMeta}>
                {new Date(item.updated_at).toLocaleString()} · {diffs.length} campo{diffs.length !== 1 ? 's' : ''} diferente{diffs.length !== 1 ? 's' : ''}
              </Text>
            </View>
          </View>
          <Text style={styles.expandIcon}>{isExpanded ? '▲' : '▼'}</Text>
        </TouchableOpacity>

        {/* Detalle expandido */}
        {isExpanded && (
          <View style={styles.conflictDetail}>
            {/* Diferencias */}
            {diffs.length > 0 ? (
              <View style={styles.diffsContainer}>
                <Text style={styles.diffsSectionTitle}>Diferencias detectadas:</Text>
                {diffs.map((diff, idx) => (
                  <View key={idx} style={styles.diffRow}>
                    <Text style={styles.diffFieldName}>{diff.fieldName}</Text>
                    <View style={styles.diffValues}>
                      <View style={[styles.diffValueBox, styles.diffLocal]}>
                        <Text style={styles.diffValueLabel}>Local</Text>
                        <Text style={styles.diffValueText} numberOfLines={3}>
                          {formatValue(diff.localValue)}
                        </Text>
                      </View>
                      <View style={[styles.diffValueBox, styles.diffServer]}>
                        <Text style={styles.diffValueLabel}>Servidor</Text>
                        <Text style={styles.diffValueText} numberOfLines={3}>
                          {formatValue(diff.serverValue)}
                        </Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.noDiffs}>
                No se pudieron determinar las diferencias especificas.
              </Text>
            )}

            {/* Botones de resolucion */}
            <View style={styles.resolveActions}>
              <TouchableOpacity
                style={[styles.resolveBtn, styles.keepLocalBtn]}
                onPress={() => handleKeepLocal(item.local_id)}
              >
                <Text style={styles.resolveBtnText}>Mantener local</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.resolveBtn, styles.keepServerBtn]}
                onPress={() => handleKeepServer(item.local_id)}
              >
                <Text style={styles.resolveBtnText}>Aceptar servidor</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    );
  };

  if (conflicts.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>✅</Text>
        <Text style={styles.emptyTitle}>Sin conflictos</Text>
        <Text style={styles.emptyText}>
          No hay conflictos de sincronizacion pendientes de resolver.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header con conteo y acciones masivas */}
      <View style={styles.headerBar}>
        <Text style={styles.headerText}>
          {conflicts.length} conflicto{conflicts.length !== 1 ? 's' : ''} pendiente{conflicts.length !== 1 ? 's' : ''}
        </Text>
        {conflicts.length > 1 && (
          <View style={styles.bulkActions}>
            <TouchableOpacity
              style={styles.bulkBtn}
              onPress={handleResolveAllLocal}
            >
              <Text style={styles.bulkBtnText}>Todos local</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bulkBtn, styles.bulkBtnServer]}
              onPress={handleResolveAllServer}
            >
              <Text style={styles.bulkBtnText}>Todos servidor</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Lista de conflictos */}
      <FlatList
        data={conflicts}
        keyExtractor={(item) => item.local_id}
        renderItem={renderConflict}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBar: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerText: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.error,
    marginBottom: spacing.sm,
  },
  bulkActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bulkBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  bulkBtnServer: {
    backgroundColor: colors.warning,
  },
  bulkBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  list: {
    padding: spacing.md,
  },
  conflictCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    marginBottom: spacing.md,
    overflow: 'hidden',
    elevation: 2,
    borderLeftWidth: 4,
    borderLeftColor: colors.error,
  },
  conflictHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  conflictHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  conflictIcon: {
    fontSize: 24,
  },
  conflictTitle: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  conflictMeta: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  expandIcon: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    paddingLeft: spacing.sm,
  },
  conflictDetail: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
  },
  diffsContainer: {
    marginBottom: spacing.md,
  },
  diffsSectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  diffRow: {
    marginBottom: spacing.md,
  },
  diffFieldName: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  diffValues: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  diffValueBox: {
    flex: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
  diffLocal: {
    backgroundColor: colors.primary + '15',
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  diffServer: {
    backgroundColor: colors.warning + '15',
    borderWidth: 1,
    borderColor: colors.warning + '30',
  },
  diffValueLabel: {
    fontSize: fontSize.caption - 1,
    fontWeight: '700',
    color: colors.textSecondary,
    marginBottom: 2,
    textTransform: 'uppercase',
  },
  diffValueText: {
    fontSize: fontSize.caption,
    color: colors.textPrimary,
  },
  noDiffs: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    fontStyle: 'italic',
    marginBottom: spacing.md,
  },
  resolveActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  resolveBtn: {
    flex: 1,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  keepLocalBtn: {
    backgroundColor: colors.primary,
  },
  keepServerBtn: {
    backgroundColor: colors.warning,
  },
  resolveBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
