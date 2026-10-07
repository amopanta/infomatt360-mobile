/**
 * Detalle de participante — Vista 360.
 *
 * Muestra la información del participante seleccionado y la lista
 * de formularios asociados con su estado de aplicación:
 *   - Aplicado (verde) con fecha y botón "Ver respuestas"
 *   - No aplicado (gris) con botón para capturar
 *
 * Permite navegar a:
 *   - RecordDetail: para ver respuestas de formularios aplicados
 *   - FormCapture: para aplicar un formulario pendiente
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import {
  getCachedParticipant,
  getParticipantFormStatus,
} from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

type RouteParams = { ParticipantDetail: { participantId: number } };

interface FormStatusItem {
  template_id: number;
  form_name: string;
  applied: boolean;
  applied_at: string | null;
  record_local_id: string | null;
  record_status: string | null;
}

export default function ParticipantDetailScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<RouteProp<RouteParams, 'ParticipantDetail'>>();
  const { participantId } = route.params;
  const { activeProjectId } = useAuthStore();

  const [participant, setParticipant] = useState<{
    id: number;
    full_name: string;
    document_type: string;
    document_number: string;
    code: string;
    phone: string | null;
    email: string | null;
  } | null>(null);
  const [forms, setForms] = useState<FormStatusItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(() => {
    const p = getCachedParticipant(participantId);
    setParticipant(p);

    if (activeProjectId) {
      const formStatuses = getParticipantFormStatus(participantId, activeProjectId);
      // Convertir applied de 0/1 a boolean
      setForms(
        formStatuses.map((f) => ({
          ...f,
          applied: !!f.applied,
        })),
      );
    }
  }, [participantId, activeProjectId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Recargar al volver (después de capturar un formulario)
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadData);
    return unsubscribe;
  }, [navigation, loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
    setRefreshing(false);
  }, [loadData]);

  const appliedCount = useMemo(
    () => forms.filter((f) => f.applied).length,
    [forms],
  );

  const formatDocNumber = (num: string): string =>
    num.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('es-CO', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // Configurar título del header
  useEffect(() => {
    if (participant) {
      navigation.setOptions({ title: 'Participante' });
    }
  }, [navigation, participant]);

  const renderFormItem = ({ item }: { item: FormStatusItem }) => (
    <View style={styles.formCard}>
      <View style={styles.formCardContent}>
        <Text style={styles.formName} numberOfLines={2}>
          {item.form_name}
        </Text>

        {item.applied ? (
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, styles.statusApplied]}>
              <Text style={styles.statusAppliedText}>
                ✓ Aplicado
              </Text>
            </View>
            {item.applied_at && (
              <Text style={styles.appliedDate}>
                {formatDate(item.applied_at)}
              </Text>
            )}
          </View>
        ) : (
          <View style={styles.statusRow}>
            <View style={[styles.statusBadge, styles.statusNotApplied]}>
              <Text style={styles.statusNotAppliedText}>
                ○ No aplicado
              </Text>
            </View>
          </View>
        )}
      </View>

      {item.applied && item.record_local_id ? (
        <View style={styles.appliedActions}>
          <TouchableOpacity
            style={styles.viewBtn}
            onPress={() =>
              navigation.navigate('RecordDetail', {
                recordLocalId: item.record_local_id,
              })
            }
          >
            <Text style={styles.viewBtnText}>Ver</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actaBtn}
            onPress={() =>
              navigation.navigate('ActaPreview', {
                recordLocalId: item.record_local_id,
                participantId,
              })
            }
          >
            <Text style={styles.actaBtnText}>Acta</Text>
          </TouchableOpacity>
        </View>
      ) : !item.applied ? (
        <TouchableOpacity
          style={styles.captureBtn}
          onPress={() =>
            navigation.navigate('FormCapture', {
              formId: item.template_id,
              participantId,
            })
          }
        >
          <Text style={styles.captureBtnText}>Aplicar</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (!participant) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Participante no encontrado</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header del participante */}
      <View style={styles.header}>
        <Text style={styles.headerLabel}>PARTICIPANTE SELECCIONADO</Text>
        <Text style={styles.headerName}>{participant.full_name}</Text>
        <Text style={styles.headerDoc}>
          {participant.document_type} {formatDocNumber(participant.document_number)}
          {' · '}
          {participant.code}
        </Text>
        {participant.phone && (
          <Text style={styles.headerExtra}>Tel: {participant.phone}</Text>
        )}
      </View>

      {/* Contador de aplicados */}
      {forms.length > 0 && (
        <View style={styles.counterBar}>
          <Text style={styles.counterText}>
            {appliedCount} de {forms.length} aplicado{forms.length !== 1 ? 's' : ''}
          </Text>
          <View style={styles.progressBar}>
            <View
              style={[
                styles.progressFill,
                {
                  width:
                    forms.length > 0
                      ? `${Math.round((appliedCount / forms.length) * 100)}%`
                      : '0%',
                },
              ]}
            />
          </View>
        </View>
      )}

      {/* Lista de formularios */}
      <FlatList
        data={forms}
        keyExtractor={(f) => String(f.template_id)}
        renderItem={renderFormItem}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            colors={[colors.primary]}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyFormsList}>
            <Text style={styles.emptyFormsIcon}>📋</Text>
            <Text style={styles.emptyFormsText}>
              No hay formularios asignados a este participante.
            </Text>
            <Text style={styles.emptyFormsSubtext}>
              Descargue los formularios del proyecto desde la pestaña Formularios.
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
  header: {
    backgroundColor: colors.primary,
    padding: spacing.lg,
    paddingTop: spacing.md,
  },
  headerLabel: {
    fontSize: fontSize.caption,
    color: colors.textOnPrimary,
    opacity: 0.8,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  headerName: {
    fontSize: fontSize.headline,
    fontWeight: '700',
    color: colors.textOnPrimary,
    marginBottom: spacing.xs,
  },
  headerDoc: {
    fontSize: fontSize.body,
    color: colors.textOnPrimary,
    opacity: 0.9,
  },
  headerExtra: {
    fontSize: fontSize.caption,
    color: colors.textOnPrimary,
    opacity: 0.7,
    marginTop: spacing.xs,
  },
  counterBar: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  counterText: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  progressBar: {
    height: 6,
    backgroundColor: colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.success,
    borderRadius: 3,
  },
  list: {
    padding: spacing.md,
  },
  formCard: {
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
  formCardContent: {
    flex: 1,
    marginRight: spacing.sm,
  },
  formName: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
  },
  statusApplied: {
    backgroundColor: colors.success + '20',
  },
  statusAppliedText: {
    fontSize: fontSize.caption,
    color: colors.success,
    fontWeight: '600',
  },
  statusNotApplied: {
    backgroundColor: colors.textSecondary + '15',
  },
  statusNotAppliedText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  appliedDate: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  appliedActions: {
    gap: spacing.xs,
  },
  viewBtn: {
    backgroundColor: colors.primary + '15',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  viewBtnText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'center' as const,
  },
  actaBtn: {
    backgroundColor: colors.success + '15',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  actaBtnText: {
    fontSize: fontSize.caption,
    color: colors.success,
    fontWeight: '600',
    textAlign: 'center' as const,
  },
  captureBtn: {
    backgroundColor: colors.accent + '15',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
  },
  captureBtnText: {
    fontSize: fontSize.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  emptyFormsList: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyFormsIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyFormsText: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptyFormsSubtext: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
