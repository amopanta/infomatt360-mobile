/**
 * Pantalla de borradores y registros locales.
 *
 * Muestra todos los registros en la cola offline SQLite:
 *   - Pendientes de envio
 *   - Con error (reintentables)
 *   - Sincronizados recientes
 *
 * Equivalente a la cola de envio descrita en doc 01 §2.3.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDatabase, resetErrorRecords, deleteQueuedRecord } from '../../db/database';
import { syncNow } from '../../sync/syncService';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface LocalRecord {
  local_id: string;
  project_id: number;
  template_id: number;
  status: string;
  data_json: string;
  gps_json: string | null;
  error_message: string | null;
  created_at: string;
  synced_at: string | null;
  evidence_count: number;
  form_name: string | null;
}

export default function DraftsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [records, setRecords] = useState<LocalRecord[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'error' | 'synced'>('all');

  const loadRecords = useCallback(() => {
    const db = getDatabase();
    const whereClause = filter === 'all' ? '' : `WHERE q.status = '${filter}'`;
    const rows = db.getAllSync(`
      SELECT
        q.local_id, q.project_id, q.template_id, q.status,
        q.data_json, q.gps_json, q.error_message,
        q.created_at, q.synced_at,
        (SELECT COUNT(*) FROM evidence e WHERE e.record_local_id = q.local_id) as evidence_count,
        ft.name as form_name
      FROM queued_records q
      LEFT JOIN form_templates ft ON ft.id = q.template_id
      ${whereClause}
      ORDER BY q.created_at DESC
      LIMIT 100
    `) as LocalRecord[];
    setRecords(rows);
  }, [filter]);

  useEffect(() => {
    loadRecords();
  }, [loadRecords]);

  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadRecords);
    return unsubscribe;
  }, [navigation, loadRecords]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await syncNow();
    loadRecords();
    setRefreshing(false);
  };

  const handleRetryErrors = () => {
    resetErrorRecords();
    loadRecords();
    Alert.alert('Listo', 'Los registros con error se reintentaran.');
  };

  const handleDeleteRecord = (item: LocalRecord) => {
    if (item.status === 'synced') {
      Alert.alert('No permitido', 'No se puede eliminar un registro ya sincronizado.');
      return;
    }
    Alert.alert(
      'Eliminar borrador',
      `¿Eliminar "${item.form_name ?? `Formulario #${item.template_id}`}"?\n\nSe eliminaran tambien las evidencias asociadas. Esta accion no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            deleteQueuedRecord(item.local_id);
            loadRecords();
          },
        },
      ],
    );
  };

  const statusConfig: Record<string, { label: string; color: string }> = {
    draft: { label: 'Borrador', color: colors.textSecondary },
    pending: { label: 'Pendiente', color: colors.warning },
    syncing: { label: 'Enviando', color: colors.primary },
    synced: { label: 'Sincronizado', color: colors.success },
    error: { label: 'Error', color: colors.error },
  };

  const renderRecord = ({ item }: { item: LocalRecord }) => {
    const cfg = statusConfig[item.status] ?? { label: item.status, color: colors.disabled };
    const gps = item.gps_json ? JSON.parse(item.gps_json) : null;
    const date = new Date(item.created_at);
    const dateStr = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => {
          if (item.status === 'draft' || item.status === 'pending' || item.status === 'error') {
            navigation.navigate('FormEdit', {
              recordLocalId: item.local_id,
            });
          } else {
            navigation.navigate('RecordDetail', {
              recordLocalId: item.local_id,
            });
          }
        }}
        onLongPress={() => handleDeleteRecord(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.formName} numberOfLines={1}>
            {item.form_name ?? `Formulario #${item.template_id}`}
          </Text>
          <View style={[styles.badge, { backgroundColor: cfg.color + '20' }]}>
            <View style={[styles.badgeDot, { backgroundColor: cfg.color }]} />
            <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
          </View>
        </View>

        <Text style={styles.date}>{dateStr}</Text>

        <View style={styles.metaRow}>
          {gps && (
            <Text style={styles.metaItem}>
              📍 {gps.lat?.toFixed(4)}, {gps.lng?.toFixed(4)}
            </Text>
          )}
          {item.evidence_count > 0 && (
            <Text style={styles.metaItem}>
              📎 {item.evidence_count} evidencia{item.evidence_count !== 1 ? 's' : ''}
            </Text>
          )}
        </View>

        {item.error_message && (
          <Text style={styles.errorText} numberOfLines={2}>
            {item.error_message}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  // Contar por estado
  const counts = {
    all: records.length,
    pending: records.filter((r) => r.status === 'pending').length,
    error: records.filter((r) => r.status === 'error').length,
    synced: records.filter((r) => r.status === 'synced').length,
  };

  const filterButtons: { key: typeof filter; label: string }[] = [
    { key: 'all', label: `Todos` },
    { key: 'pending', label: `Pendientes` },
    { key: 'error', label: `Errores` },
    { key: 'synced', label: `Enviados` },
  ];

  return (
    <View style={styles.container}>
      {/* Filtros */}
      <View style={styles.filters}>
        {filterButtons.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterBtn, filter === f.key && styles.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text
              style={[
                styles.filterText,
                filter === f.key && styles.filterTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Accion de reintentar errores */}
      {filter === 'error' && counts.error > 0 && (
        <TouchableOpacity style={styles.retryBar} onPress={handleRetryErrors}>
          <Text style={styles.retryText}>
            Reintentar {counts.error} registro{counts.error !== 1 ? 's' : ''} con error
          </Text>
        </TouchableOpacity>
      )}

      {/* Lista */}
      <FlatList
        data={records}
        keyExtractor={(r) => r.local_id}
        renderItem={renderRecord}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No hay registros {filter !== 'all' ? `con estado "${filter}"` : 'locales'}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filters: {
    flexDirection: 'row',
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  filterBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background,
  },
  filterBtnActive: {
    backgroundColor: colors.primary,
  },
  filterText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  filterTextActive: {
    color: colors.textOnPrimary,
  },
  retryBar: {
    backgroundColor: colors.error + '15',
    padding: spacing.md,
    alignItems: 'center',
  },
  retryText: {
    fontSize: fontSize.body,
    color: colors.error,
    fontWeight: '500',
  },
  list: {
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  formName: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.sm,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
  },
  badgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  badgeText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  date: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  metaItem: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: fontSize.caption,
    color: colors.error,
    marginTop: spacing.sm,
    fontStyle: 'italic',
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
