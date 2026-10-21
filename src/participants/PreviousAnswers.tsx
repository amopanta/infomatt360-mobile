/** Respuestas previas del participante (también de otros equipos), solo lectura. docs/141 §3. */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { colors, fontSize, spacing } from '../ui/theme';
import { displayValue, participantHistory } from './historyCache';

const STATUS: Record<string, string> = {
  submitted: 'Enviado', under_review: 'En revisión', returned: 'Devuelto', corrected: 'Corregido',
  approved: 'Aprobado', rejected: 'No aprobado', synced: 'Sincronizado', draft: 'Borrador',
};

export default function PreviousAnswers({ participantId }: { participantId: string }) {
  const items = participantHistory(participantId);
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Respuestas registradas ({items.length})</Text>
      <Text style={styles.hint}>Incluye las capturadas en otros equipos. Solo lectura.</Text>
      {items.map((item) => {
        const values = JSON.parse(item.values_json) as Record<string, unknown>;
        const expanded = open === item.record_id;
        return (
          <View key={item.record_id} style={styles.item}>
            <TouchableOpacity onPress={() => setOpen(expanded ? null : item.record_id)} accessibilityRole="button" accessibilityState={{ expanded }}>
              <Text style={styles.name}>{expanded ? '▾' : '▸'} {item.template_name}</Text>
              <Text style={styles.meta}>{STATUS[item.status] ?? item.status} · {new Date(item.created_at).toLocaleDateString('es-CO')}</Text>
            </TouchableOpacity>
            {expanded ? Object.entries(values).map(([field, value]) => (
              <View key={field} style={styles.row}>
                <Text style={styles.field}>{field.replace(/\[(\d+)\]\./g, (_, i) => ` ${Number(i) + 1} · `)}</Text>
                <Text style={styles.value}>{displayValue(value)}</Text>
              </View>
            )) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { backgroundColor: colors.surface, borderRadius: 8, padding: spacing.md, margin: spacing.md, marginBottom: 0 },
  title: { fontSize: fontSize.subtitle, fontWeight: '700', color: colors.textPrimary },
  hint: { fontSize: fontSize.caption, color: colors.textSecondary, marginBottom: spacing.sm },
  item: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  name: { fontWeight: '600', color: colors.primary },
  meta: { fontSize: fontSize.caption, color: colors.textSecondary },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: 2 },
  field: { color: colors.textSecondary, flex: 1 },
  value: { color: colors.textPrimary, flex: 1, textAlign: 'right' },
});
