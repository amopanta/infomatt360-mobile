/**
 * Lista de formularios disponibles en el proyecto activo.
 *
 * Flujo offline-first:
 *   1. Muestra formularios cacheados en SQLite inmediatamente.
 *   2. Descarga actualizaciones del backend si hay red.
 *   3. Almacena en cache local para uso sin conexion.
 *
 * Incluye barra de busqueda y contadores de registros por formulario.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getProjectForms } from '../../api/formsApi';
import { getCachedForms, cacheFormTemplate, getRecordCountsByTemplate } from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface CachedForm {
  id: number;
  name: string;
  description: string | null;
  version: number;
  template_id: string;
}

type RecordCounts = Record<number, { pending: number; synced: number; error: number; draft: number }>;

export default function FormListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { activeProjectId } = useAuthStore();
  const [forms, setForms] = useState<CachedForm[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recordCounts, setRecordCounts] = useState<RecordCounts>({});

  // Cargar desde cache local
  const loadCached = useCallback(() => {
    if (!activeProjectId) return;
    const cached = getCachedForms(activeProjectId);
    setForms(cached);
    setRecordCounts(getRecordCountsByTemplate());
  }, [activeProjectId]);

  // Descargar desde el backend y actualizar cache
  const downloadForms = useCallback(async () => {
    if (!activeProjectId) return;
    setRefreshing(true);
    try {
      const remote = await getProjectForms(activeProjectId);
      for (const form of remote) {
        cacheFormTemplate({
          id: form.id,
          projectId: activeProjectId,
          templateId: form.templateId,
          version: form.version,
          name: form.name,
          description: form.description,
          schemaJson: JSON.stringify(form.pages),
        });
      }
      loadCached();
    } catch (err: any) {
      if (forms.length === 0) {
        Alert.alert(
          'Sin conexion',
          'No hay formularios descargados. Conectese a internet para descargar.',
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [activeProjectId, loadCached, forms.length]);

  useEffect(() => {
    loadCached();
    downloadForms();
  }, [loadCached, downloadForms]);

  // Recargar contadores al volver a la pantalla
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setRecordCounts(getRecordCountsByTemplate());
    });
    return unsubscribe;
  }, [navigation]);

  // Filtrar por busqueda
  const filteredForms = useMemo(() => {
    if (!searchQuery.trim()) return forms;
    const q = searchQuery.toLowerCase();
    return forms.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        (f.description && f.description.toLowerCase().includes(q)),
    );
  }, [forms, searchQuery]);

  const renderForm = ({ item }: { item: CachedForm }) => {
    const counts = recordCounts[item.id];
    const totalRecords = counts
      ? counts.pending + counts.synced + counts.error + counts.draft
      : 0;

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate('FormCapture', { formId: item.id })}
        activeOpacity={0.7}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.formName} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={styles.versionBadge}>v{item.version}</Text>
        </View>
        {item.description ? (
          <Text style={styles.formDesc} numberOfLines={2}>
            {item.description}
          </Text>
        ) : null}
        {totalRecords > 0 && (
          <View style={styles.countsRow}>
            {(counts?.synced ?? 0) > 0 && (
              <View style={[styles.countBadge, { backgroundColor: colors.success + '20' }]}>
                <Text style={[styles.countText, { color: colors.success }]}>
                  ✓ {counts!.synced}
                </Text>
              </View>
            )}
            {(counts?.pending ?? 0) > 0 && (
              <View style={[styles.countBadge, { backgroundColor: colors.warning + '20' }]}>
                <Text style={[styles.countText, { color: colors.warning }]}>
                  ⏳ {counts!.pending}
                </Text>
              </View>
            )}
            {(counts?.draft ?? 0) > 0 && (
              <View style={[styles.countBadge, { backgroundColor: colors.textSecondary + '20' }]}>
                <Text style={[styles.countText, { color: colors.textSecondary }]}>
                  ✎ {counts!.draft}
                </Text>
              </View>
            )}
            {(counts?.error ?? 0) > 0 && (
              <View style={[styles.countBadge, { backgroundColor: colors.error + '20' }]}>
                <Text style={[styles.countText, { color: colors.error }]}>
                  ✗ {counts!.error}
                </Text>
              </View>
            )}
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Barra de busqueda */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar formulario..."
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {searchQuery.length > 0 && (
          <Text style={styles.searchCount}>
            {filteredForms.length} resultado{filteredForms.length !== 1 ? 's' : ''}
          </Text>
        )}
      </View>

      <FlatList
        data={filteredForms}
        keyExtractor={(f) => String(f.id)}
        renderItem={renderForm}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={downloadForms}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {refreshing
                ? 'Descargando formularios...'
                : searchQuery
                  ? 'Sin resultados para la busqueda'
                  : 'No hay formularios disponibles'}
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
  searchContainer: {
    padding: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.body,
    backgroundColor: colors.background,
    color: colors.textPrimary,
  },
  searchCount: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  list: {
    padding: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
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
  versionBadge: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    backgroundColor: colors.background,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
  },
  formDesc: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  countsRow: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  countBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
  },
  countText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
});
