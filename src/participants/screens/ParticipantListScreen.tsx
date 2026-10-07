/**
 * Lista de participantes para formularios cerrados (Vista 360).
 *
 * Muestra participantes del proyecto activo con búsqueda
 * por nombre, cédula o código. Al seleccionar un participante
 * navega al detalle con sus formularios asociados.
 *
 * Flujo offline-first:
 *   1. Muestra participantes cacheados en SQLite inmediatamente
 *   2. Descarga actualizaciones del backend si hay red
 *   3. Almacena en cache local para uso sin conexión
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
import { getProjectParticipants } from '../../api/participantsApi';
import {
  getCachedParticipants,
  cacheParticipant,
  getParticipantCount,
} from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface CachedParticipant {
  id: number;
  full_name: string;
  document_type: string;
  document_number: string;
  code: string;
  phone: string | null;
}

export default function ParticipantListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { activeProjectId } = useAuthStore();
  const [participants, setParticipants] = useState<CachedParticipant[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [totalCount, setTotalCount] = useState(0);

  const loadCached = useCallback(() => {
    if (!activeProjectId) return;
    const cached = getCachedParticipants(activeProjectId, searchQuery || undefined);
    setParticipants(cached);
    setTotalCount(getParticipantCount(activeProjectId));
  }, [activeProjectId, searchQuery]);

  const downloadParticipants = useCallback(async () => {
    if (!activeProjectId) return;
    setRefreshing(true);
    try {
      const remote = await getProjectParticipants(activeProjectId, { limit: 1000 });
      for (const p of remote.items) {
        cacheParticipant({
          id: p.id,
          projectId: activeProjectId,
          fullName: p.full_name,
          documentType: p.document_type,
          documentNumber: p.document_number,
          code: p.code,
          phone: p.phone,
          email: p.email,
          address: p.address,
          extraJson: p.extra_json,
          createdAt: p.created_at,
          updatedAt: p.updated_at,
        });
      }
      loadCached();
    } catch {
      if (participants.length === 0) {
        Alert.alert(
          'Sin conexion',
          'No hay participantes descargados. Conectese a internet para descargar.',
        );
      }
    } finally {
      setRefreshing(false);
    }
  }, [activeProjectId, loadCached, participants.length]);

  useEffect(() => {
    loadCached();
    downloadParticipants();
  }, []);

  // Recargar al buscar
  useEffect(() => {
    loadCached();
  }, [loadCached]);

  // Recargar al volver a la pantalla
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadCached);
    return unsubscribe;
  }, [navigation, loadCached]);

  const formatDocNumber = (num: string): string => {
    // Formato con puntos: 1234567 → 1.234.567
    return num.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  };

  const renderParticipant = ({ item }: { item: CachedParticipant }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() =>
        navigation.navigate('ParticipantDetail', { participantId: item.id })
      }
      activeOpacity={0.7}
    >
      <View style={styles.avatarContainer}>
        <Text style={styles.avatarText}>
          {item.full_name.charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.participantName} numberOfLines={1}>
          {item.full_name}
        </Text>
        <Text style={styles.participantDoc}>
          {item.document_type} {formatDocNumber(item.document_number)}
        </Text>
        <Text style={styles.participantCode}>{item.code}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {/* Barra de búsqueda */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre, cedula o codigo"
          placeholderTextColor={colors.textSecondary}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        <Text style={styles.searchCount}>
          {participants.length} de {totalCount} participante{totalCount !== 1 ? 's' : ''}
        </Text>
      </View>

      <FlatList
        data={participants}
        keyExtractor={(p) => String(p.id)}
        renderItem={renderParticipant}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={downloadParticipants}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyTitle}>
              {refreshing
                ? 'Descargando participantes...'
                : searchQuery
                  ? 'Sin resultados para la busqueda'
                  : 'No hay participantes disponibles'}
            </Text>
            <Text style={styles.emptySubtitle}>
              {!searchQuery && !refreshing
                ? 'Deslice hacia abajo para descargar desde el servidor.'
                : ''}
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
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: spacing.md,
  },
  avatarText: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  cardContent: {
    flex: 1,
  },
  participantName: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  participantDoc: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    marginTop: 2,
  },
  participantCode: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '500',
    marginTop: 2,
  },
  chevron: {
    fontSize: 24,
    color: colors.textSecondary,
    marginLeft: spacing.sm,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
