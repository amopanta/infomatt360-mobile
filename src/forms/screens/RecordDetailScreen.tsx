/**
 * Pantalla de detalle de un registro capturado.
 *
 * Muestra:
 *   - Datos capturados campo por campo
 *   - Evidencias adjuntas (thumbnails)
 *   - Ubicacion GPS
 *   - Timeline de estados (creado, sincronizado, error)
 *   - Opciones: editar (si pendiente/error/draft), ver evidencias
 */

import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  getQueuedRecord,
  getRecordEvidence,
  getCachedForm,
} from '../../db/database';
import type { FormPage, FormComponent, RecordValue } from '../../types';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface RecordData {
  local_id: string;
  project_id: number;
  template_id: number;
  status: string;
  data_json: string;
  gps_json: string | null;
  error_message: string | null;
  created_at: string;
  synced_at: string | null;
}

interface EvidenceItem {
  local_id: string;
  type: string;
  file_uri: string;
  remote_url: string | null;
  mime_type: string;
  uploaded: number;
}

/** Extrae todos los componentes de las paginas */
function getAllComponents(pages: FormPage[]): FormComponent[] {
  const comps: FormComponent[] = [];
  for (const page of pages) {
    for (const section of page.sections) {
      for (const row of section.rows) {
        for (const col of row.columns) {
          comps.push(...col.components);
        }
      }
    }
  }
  return comps;
}

const statusConfig: Record<string, { label: string; color: string; icon: string }> = {
  draft: { label: 'Borrador', color: colors.textSecondary, icon: '✎' },
  pending: { label: 'Pendiente de envio', color: colors.warning, icon: '⏳' },
  syncing: { label: 'Enviando...', color: colors.primary, icon: '↑' },
  synced: { label: 'Sincronizado', color: colors.success, icon: '✓' },
  error: { label: 'Error al enviar', color: colors.error, icon: '✗' },
};

export default function RecordDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const recordLocalId: string = route.params?.recordLocalId ?? '';

  const [record, setRecord] = useState<RecordData | null>(null);
  const [evidences, setEvidences] = useState<EvidenceItem[]>([]);
  const [formName, setFormName] = useState('');
  const [fieldMap, setFieldMap] = useState<Map<string, FormComponent>>(new Map());
  const [parsedValues, setParsedValues] = useState<RecordValue[]>([]);

  useEffect(() => {
    if (!recordLocalId) return;

    const rec = getQueuedRecord(recordLocalId) as RecordData | null;
    if (!rec) return;
    setRecord(rec);

    // Cargar evidencias
    setEvidences(getRecordEvidence(recordLocalId) as EvidenceItem[]);

    // Cargar formulario para obtener labels
    const cached = getCachedForm(rec.template_id);
    if (cached) {
      setFormName(cached.name);
      const pages: FormPage[] = JSON.parse(cached.schema_json);
      const comps = getAllComponents(pages);
      const map = new Map<string, FormComponent>();
      for (const c of comps) {
        map.set(c.id, c);
      }
      setFieldMap(map);
    }

    // Parsear valores
    const vals: RecordValue[] = JSON.parse(rec.data_json);
    setParsedValues(vals);
  }, [recordLocalId]);

  if (!record) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Registro no encontrado</Text>
      </View>
    );
  }

  const gps = record.gps_json ? JSON.parse(record.gps_json) : null;
  const status = statusConfig[record.status] ?? { label: record.status, color: colors.disabled, icon: '?' };
  const createdDate = new Date(record.created_at);
  const syncedDate = record.synced_at ? new Date(record.synced_at) : null;
  const canEdit = ['draft', 'pending', 'error'].includes(record.status);

  const formatDate = (d: Date) =>
    `${d.toLocaleDateString('es-CO')} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  const formatValue = (val: unknown): string => {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'boolean') return val ? 'Si' : 'No';
    if (typeof val === 'object') {
      if (Array.isArray(val)) return val.join(', ');
      const obj = val as Record<string, unknown>;
      if (obj.lat !== undefined && obj.lng !== undefined) {
        return `${(obj.lat as number).toFixed(5)}, ${(obj.lng as number).toFixed(5)}`;
      }
      if (obj.uri) return '[Foto capturada]';
      if (obj.dataUri) return '[Firma capturada]';
      return JSON.stringify(val);
    }
    return String(val);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header con nombre y estado */}
      <View style={styles.headerCard}>
        <Text style={styles.formName}>{formName || `Formulario #${record.template_id}`}</Text>
        <View style={[styles.statusBadge, { backgroundColor: status.color + '15' }]}>
          <Text style={[styles.statusIcon, { color: status.color }]}>{status.icon}</Text>
          <Text style={[styles.statusLabel, { color: status.color }]}>{status.label}</Text>
        </View>
        {record.error_message && (
          <Text style={styles.errorMessage}>{record.error_message}</Text>
        )}
      </View>

      {/* Timeline */}
      <View style={styles.timelineCard}>
        <Text style={styles.sectionTitle}>Timeline</Text>
        <View style={styles.timelineItem}>
          <View style={[styles.timelineDot, { backgroundColor: colors.primary }]} />
          <View style={styles.timelineContent}>
            <Text style={styles.timelineLabel}>Creado</Text>
            <Text style={styles.timelineDate}>{formatDate(createdDate)}</Text>
          </View>
        </View>
        {syncedDate && (
          <View style={styles.timelineItem}>
            <View style={[styles.timelineDot, { backgroundColor: colors.success }]} />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineLabel}>Sincronizado</Text>
              <Text style={styles.timelineDate}>{formatDate(syncedDate)}</Text>
            </View>
          </View>
        )}
        {record.status === 'error' && (
          <View style={styles.timelineItem}>
            <View style={[styles.timelineDot, { backgroundColor: colors.error }]} />
            <View style={styles.timelineContent}>
              <Text style={styles.timelineLabel}>Error</Text>
              <Text style={styles.timelineDate}>{record.error_message ?? 'Error desconocido'}</Text>
            </View>
          </View>
        )}
      </View>

      {/* GPS */}
      {gps && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ubicacion</Text>
          <Text style={styles.gpsCoords}>
            {gps.lat?.toFixed(6)}, {gps.lng?.toFixed(6)}
          </Text>
          {gps.accuracy && (
            <Text style={styles.gpsAccuracy}>Precision: ±{gps.accuracy.toFixed(0)}m</Text>
          )}
        </View>
      )}

      {/* Datos capturados */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Datos capturados</Text>
        {parsedValues.length === 0 ? (
          <Text style={styles.emptyText}>Sin datos</Text>
        ) : (
          parsedValues.map((rv, idx) => {
            const comp = fieldMap.get(rv.field_id);
            const label = comp?.label ?? rv.field_name ?? rv.field_id;
            const value = rv.field_value_json;

            // Para fotos y firmas, mostrar thumbnail
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              const obj = value as Record<string, unknown>;
              if (obj.uri && typeof obj.uri === 'string') {
                return (
                  <View key={idx} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <Image source={{ uri: obj.uri as string }} style={styles.thumbImage} resizeMode="cover" />
                  </View>
                );
              }
              if (obj.dataUri && typeof obj.dataUri === 'string') {
                return (
                  <View key={idx} style={styles.fieldRow}>
                    <Text style={styles.fieldLabel}>{label}</Text>
                    <Image source={{ uri: obj.dataUri as string }} style={styles.signatureImage} resizeMode="contain" />
                  </View>
                );
              }
            }

            return (
              <View key={idx} style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>{label}</Text>
                <Text style={styles.fieldValue}>{formatValue(value)}</Text>
              </View>
            );
          })
        )}
      </View>

      {/* Evidencias */}
      {evidences.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>
            Evidencias ({evidences.length})
          </Text>
          <View style={styles.evidenceGrid}>
            {evidences.map((ev, idx) => (
              <TouchableOpacity
                key={ev.local_id}
                style={styles.evidenceThumb}
                onPress={() =>
                  navigation.navigate('EvidenceViewer', {
                    recordLocalId: record.local_id,
                    initialIndex: idx,
                  })
                }
                activeOpacity={0.8}
              >
                {ev.type === 'photo' || ev.type === 'fingerprint' || ev.type === 'signature' || ev.type === 'document' ? (
                  <View>
                    <Image source={{ uri: ev.file_uri }} style={styles.evidenceImage} resizeMode="cover" />
                    {ev.type === 'fingerprint' && (
                      <View style={styles.evidenceTypeBadge}>
                        <Text style={styles.evidenceTypeBadgeText}>Huella</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={[styles.evidenceImage, styles.videoPlaceholder]}>
                    <Text style={styles.videoIcon}>▶</Text>
                  </View>
                )}
                <View style={[styles.uploadIndicator, { backgroundColor: ev.uploaded ? colors.success : colors.warning }]} />
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Acciones */}
      <View style={styles.actionsRow}>
        {canEdit && (
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => navigation.navigate('FormEdit', { recordLocalId: record.local_id })}
          >
            <Text style={styles.actionButtonText}>Editar registro</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.actionButton, styles.actionButtonSecondary]}
          onPress={() => navigation.navigate('EvidenceCapture', { recordLocalId: record.local_id })}
        >
          <Text style={[styles.actionButtonText, styles.actionButtonTextSecondary]}>
            {canEdit ? 'Agregar evidencias' : 'Ver evidencias'}
          </Text>
        </TouchableOpacity>
      </View>
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
    paddingBottom: spacing.xl,
  },
  headerCard: {
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
  formName: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
  },
  statusIcon: {
    fontSize: fontSize.body,
    fontWeight: '700',
    marginRight: spacing.xs,
  },
  statusLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  errorMessage: {
    fontSize: fontSize.caption,
    color: colors.error,
    fontStyle: 'italic',
    marginTop: spacing.sm,
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
  sectionTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  // Timeline
  timelineCard: {
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
  timelineItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  timelineDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 4,
    marginRight: spacing.sm,
  },
  timelineContent: {
    flex: 1,
  },
  timelineLabel: {
    fontSize: fontSize.body,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  timelineDate: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  // GPS
  gpsCoords: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontFamily: 'monospace',
  },
  gpsAccuracy: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  // Campos
  fieldRow: {
    marginBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    fontWeight: '500',
    marginBottom: 2,
  },
  fieldValue: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
  },
  thumbImage: {
    width: '100%',
    height: 120,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
  },
  signatureImage: {
    width: '100%',
    height: 80,
    borderRadius: borderRadius.md,
    marginTop: spacing.xs,
    backgroundColor: 'white',
  },
  // Evidencias
  evidenceGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  evidenceThumb: {
    width: 80,
    height: 80,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    position: 'relative',
  },
  evidenceImage: {
    width: 80,
    height: 80,
    backgroundColor: colors.border,
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.textPrimary + '10',
  },
  videoIcon: {
    fontSize: 24,
    color: colors.textSecondary,
  },
  uploadIndicator: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'white',
  },
  evidenceTypeBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: colors.primary + 'DD',
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  evidenceTypeBadgeText: {
    fontSize: 9,
    color: '#FFF',
    fontWeight: '600',
  },
  // Acciones
  actionsRow: {
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  actionButton: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  actionButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  actionButtonSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  actionButtonTextSecondary: {
    color: colors.primary,
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
