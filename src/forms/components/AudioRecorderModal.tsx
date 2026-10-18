/**
 * Grabadora de audio para campos AUDIO. Graba en el teléfono (sin red) y
 * entrega el archivo .m4a; el control lo copia a evidencias.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { borderRadius, colors, fontSize, spacing } from '../../ui/theme';

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function AudioRecorderModal({
  visible,
  maxSeconds = 600,
  onDone,
  onCancel,
}: {
  visible: boolean;
  maxSeconds?: number;
  onDone: (uri: string, durationMs: number) => void;
  onCancel: () => void;
}) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [starting, setStarting] = useState(false);

  async function start() {
    setStarting(true);
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permiso', 'Se necesita acceso al micrófono para grabar.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
    } catch {
      Alert.alert('Audio', 'No se pudo iniciar la grabación.');
    } finally {
      setStarting(false);
    }
  }

  async function stop() {
    const duration = state.durationMillis;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
    if (recorder.uri) onDone(recorder.uri, duration);
    else onCancel();
  }

  async function cancel() {
    if (state.isRecording) await recorder.stop().catch(() => {});
    onCancel();
  }

  // Tope de duración: se detiene sola para no superar el tamaño permitido.
  useEffect(() => {
    if (state.isRecording && state.durationMillis >= maxSeconds * 1000) void stop();
  }, [state.isRecording, state.durationMillis]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => void cancel()}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>🎙️ Grabar audio</Text>
          <Text style={styles.clock}>{clock(state.durationMillis)}</Text>
          <Text style={styles.hint}>
            {state.isRecording ? 'Grabando… hable cerca del teléfono.' : 'Funciona sin señal. Máximo ' + Math.round(maxSeconds / 60) + ' minutos.'}
          </Text>
          {state.isRecording ? (
            <TouchableOpacity style={[styles.button, styles.stop]} onPress={() => void stop()} accessibilityRole="button">
              <Text style={styles.buttonText}>■ Detener y guardar</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.button} disabled={starting} onPress={() => void start()} accessibilityRole="button">
              <Text style={styles.buttonText}>● Empezar a grabar</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.cancel} onPress={() => void cancel()} accessibilityRole="button">
            <Text style={styles.cancelText}>Cancelar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  card: { backgroundColor: colors.surface, borderRadius: borderRadius.lg ?? 12, padding: spacing.lg, alignItems: 'center' },
  title: { fontSize: fontSize.title, fontWeight: '700', color: colors.textPrimary },
  clock: { fontSize: 48, fontWeight: '300', color: colors.textPrimary, marginVertical: spacing.md, fontVariant: ['tabular-nums'] },
  hint: { fontSize: fontSize.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md },
  button: { backgroundColor: colors.primary, borderRadius: 8, paddingVertical: spacing.md, paddingHorizontal: spacing.lg, alignSelf: 'stretch', alignItems: 'center' },
  stop: { backgroundColor: colors.error },
  buttonText: { color: colors.textOnPrimary, fontSize: fontSize.subtitle, fontWeight: '700' },
  cancel: { marginTop: spacing.md, padding: spacing.sm },
  cancelText: { color: colors.textSecondary, fontSize: fontSize.subtitle },
});
