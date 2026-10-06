/**
 * Pantalla de exportacion de datos.
 *
 * Permite al usuario:
 *   - Seleccionar formato (CSV o JSON)
 *   - Filtrar por estado (todos, pendientes, sincronizados, etc.)
 *   - Exportar y compartir el archivo generado
 *   - Ver y gestionar exportaciones anteriores
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuthStore } from '../store/authStore';
import {
  exportRecords,
  shareExportFile,
  listExportFiles,
  deleteExportFile,
  type ExportFormat,
} from '../utils/exportData';
import { getPendingCount } from '../db/database';
import { formatFileSize } from '../utils/imageCompressor';
import { colors, spacing, fontSize, borderRadius } from '../ui/theme';

type StatusFilter = 'all' | 'pending' | 'synced' | 'error' | 'draft' | 'conflict';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'synced', label: 'Sincronizados' },
  { value: 'error', label: 'Con error' },
  { value: 'draft', label: 'Borradores' },
  { value: 'conflict', label: 'Conflictos' },
];

export default function ExportScreen() {
  const { activeProjectId } = useAuthStore();
  const [format, setFormat] = useState<ExportFormat>('csv');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [exporting, setExporting] = useState(false);
  const [previousExports, setPreviousExports] = useState<
    { name: string; uri: string; size: number; modTime: number }[]
  >([]);

  const refreshExports = useCallback(async () => {
    const files = await listExportFiles();
    setPreviousExports(files);
  }, []);

  useFocusEffect(
    useCallback(() => {
      refreshExports();
    }, [refreshExports]),
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportRecords({
        format,
        projectId: activeProjectId ?? undefined,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });

      if (result.recordCount === 0) {
        Alert.alert('Exportacion', 'No hay registros que coincidan con los filtros seleccionados.');
        return;
      }

      await refreshExports();

      Alert.alert(
        'Exportacion exitosa',
        `${result.recordCount} registro(s) exportado(s) a ${result.fileName}`,
        [
          { text: 'Cerrar', style: 'cancel' },
          {
            text: 'Compartir',
            onPress: () => shareExportFile(result.filePath),
          },
        ],
      );
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo exportar los datos.');
    } finally {
      setExporting(false);
    }
  };

  const handleShare = async (uri: string) => {
    try {
      await shareExportFile(uri);
    } catch {
      Alert.alert('Error', 'No se pudo compartir el archivo.');
    }
  };

  const handleDelete = (uri: string, name: string) => {
    Alert.alert(
      'Eliminar exportacion',
      `Se eliminara el archivo "${name}". Esta accion no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            await deleteExportFile(uri);
            await refreshExports();
          },
        },
      ],
    );
  };

  const renderExportFile = ({
    item,
  }: {
    item: { name: string; uri: string; size: number; modTime: number };
  }) => {
    const isCSV = item.name.endsWith('.csv');
    const date = item.modTime > 0
      ? new Date(item.modTime * 1000).toLocaleString()
      : 'Desconocida';

    return (
      <View style={styles.fileCard}>
        <View style={styles.fileInfo}>
          <Text style={styles.fileIcon}>{isCSV ? '📊' : '📄'}</Text>
          <View style={styles.fileDetails}>
            <Text style={styles.fileName} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.fileMeta}>
              {formatFileSize(item.size)} · {date}
            </Text>
          </View>
        </View>
        <View style={styles.fileActions}>
          <TouchableOpacity
            style={styles.fileBtn}
            onPress={() => handleShare(item.uri)}
          >
            <Text style={styles.fileBtnText}>Compartir</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.fileBtn, styles.fileBtnDanger]}
            onPress={() => handleDelete(item.uri, item.name)}
          >
            <Text style={[styles.fileBtnText, styles.fileBtnDangerText]}>Eliminar</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Configuracion de exportacion */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Formato</Text>
        <View style={styles.toggleRow}>
          <TouchableOpacity
            style={[styles.toggleBtn, format === 'csv' && styles.toggleBtnActive]}
            onPress={() => setFormat('csv')}
          >
            <Text
              style={[styles.toggleBtnText, format === 'csv' && styles.toggleBtnTextActive]}
            >
              CSV (Excel)
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggleBtn, format === 'json' && styles.toggleBtnActive]}
            onPress={() => setFormat('json')}
          >
            <Text
              style={[styles.toggleBtnText, format === 'json' && styles.toggleBtnTextActive]}
            >
              JSON
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Filtrar por estado</Text>
        <View style={styles.chipsRow}>
          {STATUS_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.value}
              style={[styles.chip, statusFilter === opt.value && styles.chipActive]}
              onPress={() => setStatusFilter(opt.value)}
            >
              <Text
                style={[styles.chipText, statusFilter === opt.value && styles.chipTextActive]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Boton de exportar */}
      <TouchableOpacity
        style={[styles.exportButton, exporting && styles.buttonDisabled]}
        onPress={handleExport}
        disabled={exporting}
      >
        {exporting ? (
          <ActivityIndicator color={colors.textOnPrimary} />
        ) : (
          <Text style={styles.exportButtonText}>
            Exportar como {format.toUpperCase()}
          </Text>
        )}
      </TouchableOpacity>

      {/* Exportaciones anteriores */}
      <View style={styles.previousSection}>
        <Text style={styles.sectionTitle}>Exportaciones anteriores</Text>
      </View>

      <FlatList
        data={previousExports}
        keyExtractor={(item) => item.uri}
        renderItem={renderExportFile}
        contentContainerStyle={styles.fileList}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No hay exportaciones anteriores.
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
  section: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: 1,
  },
  sectionTitle: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  toggleBtnActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  toggleBtnText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  toggleBtnTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + '15',
  },
  chipText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  exportButton: {
    backgroundColor: colors.primary,
    margin: spacing.md,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  exportButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  previousSection: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  fileList: {
    padding: spacing.md,
    paddingTop: spacing.sm,
  },
  fileCard: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 1,
  },
  fileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  fileIcon: {
    fontSize: 24,
    marginRight: spacing.sm,
  },
  fileDetails: {
    flex: 1,
  },
  fileName: {
    fontSize: fontSize.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  fileMeta: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  fileActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  fileBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.xs,
    alignItems: 'center',
  },
  fileBtnText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.primary,
  },
  fileBtnDanger: {
    borderColor: colors.error,
  },
  fileBtnDangerText: {
    color: colors.error,
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
