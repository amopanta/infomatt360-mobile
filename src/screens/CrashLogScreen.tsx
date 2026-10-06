/**
 * Pantalla de visualizacion de crash logs.
 *
 * Muestra los errores y advertencias registrados localmente
 * con nivel, mensaje, timestamp y stack trace expandible.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { getCrashLogs, getCrashLogCount, clearCrashLogs } from '../db/database';
import { colors, spacing, fontSize, borderRadius } from '../ui/theme';

interface CrashLog {
  id: number;
  level: string;
  message: string;
  stack: string | null;
  component: string | null;
  extra_json: string | null;
  created_at: string;
}

const levelColors: Record<string, string> = {
  fatal: '#DC2626',
  error: colors.error,
  warning: colors.warning,
};

const levelLabels: Record<string, string> = {
  fatal: 'FATAL',
  error: 'ERROR',
  warning: 'WARN',
};

export default function CrashLogScreen() {
  const [logs, setLogs] = useState<CrashLog[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const refresh = useCallback(() => {
    const rows = getCrashLogs(200) as CrashLog[];
    setLogs(rows);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleClear = () => {
    Alert.alert(
      'Limpiar logs',
      'Se eliminaran todos los registros de errores. Esta accion no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpiar',
          style: 'destructive',
          onPress: () => {
            clearCrashLogs();
            refresh();
          },
        },
      ],
    );
  };

  const toggleExpand = (id: number) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('es-MX', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  const renderItem = ({ item }: { item: CrashLog }) => {
    const expanded = expandedId === item.id;
    const color = levelColors[item.level] ?? colors.textSecondary;

    return (
      <TouchableOpacity
        style={[styles.logCard, { borderLeftColor: color }]}
        onPress={() => toggleExpand(item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.logHeader}>
          <View style={[styles.levelBadge, { backgroundColor: color + '20' }]}>
            <Text style={[styles.levelText, { color }]}>
              {levelLabels[item.level] ?? item.level.toUpperCase()}
            </Text>
          </View>
          <Text style={styles.logDate}>{formatDate(item.created_at)}</Text>
        </View>

        {item.component && (
          <Text style={styles.logComponent}>{item.component}</Text>
        )}

        <Text style={styles.logMessage} numberOfLines={expanded ? undefined : 2}>
          {item.message}
        </Text>

        {expanded && item.stack && (
          <View style={styles.stackContainer}>
            <Text style={styles.stackTitle}>Stack trace:</Text>
            <Text style={styles.stackText}>{item.stack}</Text>
          </View>
        )}

        {expanded && item.extra_json && (
          <View style={styles.stackContainer}>
            <Text style={styles.stackTitle}>Extra:</Text>
            <Text style={styles.stackText}>{item.extra_json}</Text>
          </View>
        )}

        <Text style={styles.expandHint}>
          {expanded ? 'Toca para colapsar' : 'Toca para ver detalles'}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {logs.length > 0 && (
        <View style={styles.toolbar}>
          <Text style={styles.countText}>{logs.length} registro(s)</Text>
          <TouchableOpacity onPress={handleClear}>
            <Text style={styles.clearText}>Limpiar todos</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={logs}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderItem}
        contentContainerStyle={
          logs.length === 0 ? styles.emptyContainer : styles.listContent
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>Sin errores registrados</Text>
            <Text style={styles.emptyMessage}>
              No se han capturado errores ni advertencias.
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
  toolbar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  countText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  clearText: {
    fontSize: fontSize.caption,
    color: colors.error,
    fontWeight: '600',
  },
  listContent: {
    padding: spacing.md,
  },
  logCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 4,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  levelBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
  },
  levelText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  logDate: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  logComponent: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '500',
    marginBottom: 2,
  },
  logMessage: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    lineHeight: 20,
  },
  stackContainer: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  stackTitle: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 4,
  },
  stackText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  expandHint: {
    fontSize: 10,
    color: colors.disabled,
    textAlign: 'right',
    marginTop: spacing.xs,
  },
  // Empty state
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  emptyMessage: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
