/**
 * Aviso único al gestor antes de registrar su recorrido. Hasta que lo
 * acepta no se toma ningún punto GPS de recorrido.
 */

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, spacing } from '../ui/theme';
import { acknowledgeRouteNotice, hasAcknowledgedRouteNotice } from './deviceMonitor';

export default function RouteNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    void hasAcknowledgedRouteNotice().then((ack) => setVisible(!ack));
  }, []);
  if (!visible) return null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>📍 Registro de recorrido</Text>
          <Text style={styles.body}>
            Mientras tenga la aplicación abierta, se guardará su ubicación cada pocos minutos para registrar el recorrido de la jornada.
          </Text>
          <Text style={styles.body}>
            También se informa al servidor cuántos registros tiene sin enviar y si hubo errores, para que su supervisor pueda ayudarle.
          </Text>
          <Text style={styles.body}>
            Solo lo ven supervisión y administración del proyecto. Funciona sin señal: se envía cuando vuelva la conexión.
          </Text>
          <Pressable
            style={styles.button}
            accessibilityRole="button"
            onPress={() => { setVisible(false); void acknowledgeRouteNotice(); }}
          >
            <Text style={styles.buttonText}>Entendido</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.lg },
  title: { fontSize: fontSize.title, fontWeight: '700', color: colors.textPrimary, marginBottom: spacing.md },
  body: { fontSize: fontSize.subtitle, color: colors.textPrimary, marginBottom: spacing.sm, lineHeight: 22 },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: spacing.md, alignItems: 'center', marginTop: spacing.md },
  buttonText: { color: colors.textOnPrimary, fontSize: fontSize.subtitle, fontWeight: '700' },
});
