/**
 * Observaciones del revisor dentro de la corrección (docs/141 §6): el gestor
 * las ve al abrir el registro devuelto, salta a la pregunta y marca las que
 * ya corrigió. No cambian las respuestas por sí solas.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, spacing } from '../ui/theme';
import type { ServerObservation } from './correctionStore';

export default function CorrectionBanner({
  status, errorMessage, observations, checked, labelFor, onToggle, onGoTo, onUseServerVersion,
}: {
  status: string;
  errorMessage: string | null;
  observations: ServerObservation[];
  checked: Set<string>;
  labelFor: (o: ServerObservation) => string;
  onToggle: (id: string) => void;
  onGoTo: (o: ServerObservation) => void;
  onUseServerVersion: () => void;
}) {
  const open = observations.filter((o) => ['pending', 'in_correction', 'rejected'].includes(o.status));
  return (
    <View style={styles.box} accessibilityRole="summary">
      <Text style={styles.title}>📝 Devuelto para corrección</Text>
      {status === 'correction_conflict' || status === 'correction_error' ? (
        <View style={styles.alert}>
          <Text style={styles.alertText}>{errorMessage ?? 'El servidor no aceptó la corrección.'}</Text>
          <TouchableOpacity onPress={onUseServerVersion} accessibilityRole="button">
            <Text style={styles.link}>Descartar mis cambios y usar la versión del servidor</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      <Text style={styles.subtitle}>{open.length ? `${open.length} observación(es) por atender` : 'Sin observaciones pendientes'}</Text>
      {observations.map((o) => {
        const done = checked.has(o.id) || ['corrected', 'verified'].includes(o.status);
        return (
          <View key={o.id} style={[styles.item, done && styles.itemDone]}>
            <Text style={styles.field}>{labelFor(o)}</Text>
            <Text style={styles.reason}>{o.reason}</Text>
            {o.requested_action ? <Text style={styles.requested}>Acción: {o.requested_action}</Text> : null}
            <View style={styles.row}>
              {o.field_name ? (
                <TouchableOpacity onPress={() => onGoTo(o)} accessibilityRole="button">
                  <Text style={styles.link}>Ir a la pregunta</Text>
                </TouchableOpacity>
              ) : null}
              {['pending', 'in_correction', 'rejected'].includes(o.status) ? (
                <TouchableOpacity onPress={() => onToggle(o.id)} accessibilityRole="checkbox" accessibilityState={{ checked: done }}>
                  <Text style={styles.link}>{done ? '☑ Corregida' : '☐ Ya la corregí'}</Text>
                </TouchableOpacity>
              ) : <Text style={styles.state}>{o.status === 'verified' ? 'Verificada' : 'Corregida'}</Text>}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: '#FFF8E1', borderColor: colors.warning, borderWidth: 1, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md },
  title: { fontSize: fontSize.subtitle, fontWeight: '700', color: colors.textPrimary },
  subtitle: { fontSize: fontSize.body, color: colors.textSecondary, marginVertical: spacing.xs },
  alert: { backgroundColor: '#FDECEA', borderRadius: 6, padding: spacing.sm, marginVertical: spacing.xs },
  alertText: { color: colors.error, fontSize: fontSize.body },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  itemDone: { opacity: 0.6 },
  field: { fontWeight: '700', color: colors.textPrimary },
  reason: { color: colors.textPrimary },
  requested: { fontStyle: 'italic', color: colors.textSecondary },
  row: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xs },
  link: { color: colors.primary, fontWeight: '600', paddingVertical: 2 },
  state: { color: colors.success, fontWeight: '600' },
});
