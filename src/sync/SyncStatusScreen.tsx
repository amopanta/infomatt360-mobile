/**
 * Pantalla de estado de sincronizacion.
 *
 * Muestra:
 *   - Registros pendientes de enviar
 *   - Estado de la sincronizacion automatica (doc 107)
 *   - Boton de sincronizacion manual
 *   - Boton de limpieza de registros antiguos
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  getPendingCount,
  getConflictCount,
  purgeOldSynced,
  resetErrorRecords,
} from '../db/database';
import {
  syncNow,
  getSyncStatus,
  onSyncStatusChange,
} from './syncService';
import { ENV } from '../config/env';
import { colors, spacing, fontSize, borderRadius } from '../ui/theme';

export default function SyncStatusScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  const [syncing, setSyncing] = useState(false);

  const refreshCounts = useCallback(() => {
    setPendingCount(getPendingCount());
    setConflictCount(getConflictCount());
  }, []);

  useEffect(() => {
    refreshCounts();
    const unsub = onSyncStatusChange((s) => {
      setSyncStatus(s);
      refreshCounts();
    });
    const interval = setInterval(refreshCounts, 5_000);
    return () => {
      unsub();
      clearInterval(interval);
    };
  }, [refreshCounts]);

  const handleManualSync = async () => {
    setSyncing(true);
    try {
      const hadFailures = await syncNow();
      refreshCounts();
      if (hadFailures) {
        Alert.alert('Sincronizacion', 'Algunos registros tuvieron errores. Se reintentaran automaticamente.');
      } else {
        Alert.alert('Sincronizacion', 'Todos los registros se sincronizaron correctamente.');
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Error de sincronizacion');
    } finally {
      setSyncing(false);
    }
  };

  const handlePurge = () => {
    const deleted = purgeOldSynced(ENV.SYNCED_RETENTION_DAYS);
    if (deleted > 0) {
      Alert.alert('Limpieza', `${deleted} registro(s) sincronizado(s) antiguo(s) eliminado(s) del dispositivo.`);
    } else {
      Alert.alert('Limpieza', `No habia registros sincronizados con mas de ${ENV.SYNCED_RETENTION_DAYS} dias.`);
    }
  };

  const handleResetErrors = () => {
    resetErrorRecords();
    refreshCounts();
    Alert.alert('Reintentar', 'Los registros con error se reintentaran en el proximo ciclo.');
  };

  const statusLabels: Record<string, string> = {
    idle: 'En espera',
    syncing: 'Sincronizando...',
    paused_offline: 'Pausado (sin conexion)',
    paused_no_session: 'Pausado (sin sesion)',
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Estado actual */}
      <View style={styles.statusCard}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusDot,
              {
                backgroundColor:
                  syncStatus === 'syncing'
                    ? colors.primary
                    : syncStatus === 'idle'
                      ? colors.success
                      : colors.warning,
              },
            ]}
          />
          <Text style={styles.statusText}>
            {statusLabels[syncStatus] ?? syncStatus}
          </Text>
        </View>
      </View>

      {/* Contadores */}
      <View style={styles.countersRow}>
        <View style={styles.counter}>
          <Text style={styles.counterNumber}>{pendingCount}</Text>
          <Text style={styles.counterLabel}>Pendientes</Text>
        </View>
        {conflictCount > 0 && (
          <View style={[styles.counter, styles.counterConflict]}>
            <Text style={[styles.counterNumber, { color: colors.error }]}>{conflictCount}</Text>
            <Text style={styles.counterLabel}>Conflictos</Text>
          </View>
        )}
      </View>

      {/* Conflictos pendientes */}
      {conflictCount > 0 && (
        <TouchableOpacity
          style={styles.conflictButton}
          onPress={() => navigation.navigate('ConflictResolution')}
        >
          <Text style={styles.conflictButtonText}>
            Resolver {conflictCount} conflicto{conflictCount !== 1 ? 's' : ''}
          </Text>
        </TouchableOpacity>
      )}

      {/* Acciones */}
      <TouchableOpacity
        style={[styles.actionButton, syncing && styles.buttonDisabled]}
        onPress={handleManualSync}
        disabled={syncing || pendingCount === 0}
      >
        <Text style={styles.actionButtonText}>
          {syncing ? 'Sincronizando...' : `Sincronizar pendientes (${pendingCount})`}
        </Text>
      </TouchableOpacity>

      {pendingCount > 0 && (
        <TouchableOpacity style={styles.secondaryButton} onPress={handleResetErrors}>
          <Text style={styles.secondaryButtonText}>Reintentar registros con error</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity style={styles.secondaryButton} onPress={handlePurge}>
        <Text style={styles.secondaryButtonText}>
          Limpiar sincronizados antiguos ({ENV.SYNCED_RETENTION_DAYS}+ dias)
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => navigation.navigate('Export')}
      >
        <Text style={styles.secondaryButtonText}>Exportar datos (CSV / JSON)</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
  },
  statusCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    elevation: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: spacing.sm,
  },
  statusText: {
    fontSize: fontSize.subtitle,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  countersRow: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  counter: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    alignItems: 'center',
    elevation: 2,
  },
  counterNumber: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.primary,
  },
  counterLabel: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  actionButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  secondaryButtonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  counterConflict: {
    marginLeft: spacing.md,
    borderWidth: 1,
    borderColor: colors.error,
  },
  conflictButton: {
    backgroundColor: colors.error,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  conflictButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
  },
});
