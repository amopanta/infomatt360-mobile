/**
 * Modal de captura de huella digital tactil.
 *
 * Usa react-native-signature-canvas con un area circular
 * donde el usuario presiona el pulgar/dedo. El patron de
 * contacto se captura como imagen PNG base64.
 *
 * Incluye guia visual con indicador de dedo y opcion
 * de capturar ambas manos (pulgar izquierdo/derecho).
 */

import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface FingerprintModalProps {
  visible: boolean;
  onSave: (fingerprintBase64: string, hand: 'left' | 'right') => void;
  onCancel: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAPTURE_SIZE = Math.min(SCREEN_WIDTH - spacing.lg * 2, 300);

type Hand = 'left' | 'right';

export default function FingerprintModal({
  visible,
  onSave,
  onCancel,
}: FingerprintModalProps) {
  const signatureRef = useRef<SignatureViewRef>(null);
  const [selectedHand, setSelectedHand] = useState<Hand>('right');
  const [hasTouch, setHasTouch] = useState(false);

  const handleOK = (signature: string) => {
    // signature es un data URI: "data:image/png;base64,..."
    onSave(signature, selectedHand);
    setHasTouch(false);
  };

  const handleClear = () => {
    signatureRef.current?.clearSignature();
    setHasTouch(false);
  };

  const handleConfirm = () => {
    signatureRef.current?.readSignature();
  };

  const handleBegin = () => {
    setHasTouch(true);
  };

  // CSS para el canvas: fondo gris claro, trazo mas grueso para simular huella
  const webStyle = `.m-signature-pad {
    box-shadow: none;
    border: none;
    margin: 0;
    width: 100%;
    height: 100%;
  }
  .m-signature-pad--body {
    border: none;
    width: 100%;
    height: 100%;
  }
  .m-signature-pad--body canvas {
    border-radius: 50%;
  }
  .m-signature-pad--footer {
    display: none;
  }
  body, html {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background-color: #F5F5F5;
    overflow: hidden;
  }`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onCancel}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Captura de huella digital</Text>
          <Text style={styles.subtitle}>
            Presione el pulgar firmemente en el area circular
          </Text>
        </View>

        {/* Selector de mano */}
        <View style={styles.handSelector}>
          <TouchableOpacity
            style={[
              styles.handButton,
              selectedHand === 'left' && styles.handButtonActive,
            ]}
            onPress={() => {
              setSelectedHand('left');
              handleClear();
            }}
          >
            <Text style={styles.handEmoji}>🤚</Text>
            <Text
              style={[
                styles.handLabel,
                selectedHand === 'left' && styles.handLabelActive,
              ]}
            >
              Izquierda
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.handButton,
              selectedHand === 'right' && styles.handButtonActive,
            ]}
            onPress={() => {
              setSelectedHand('right');
              handleClear();
            }}
          >
            <Text style={[styles.handEmoji, { transform: [{ scaleX: -1 }] }]}>
              🤚
            </Text>
            <Text
              style={[
                styles.handLabel,
                selectedHand === 'right' && styles.handLabelActive,
              ]}
            >
              Derecha
            </Text>
          </TouchableOpacity>
        </View>

        {/* Area de captura circular */}
        <View style={styles.captureArea}>
          <View style={styles.captureCircleOuter}>
            <View style={styles.captureCircle}>
              <SignatureCanvas
                ref={signatureRef}
                onOK={handleOK}
                onBegin={handleBegin}
                onEmpty={() => setHasTouch(false)}
                webStyle={webStyle}
                backgroundColor="#F5F5F5"
                penColor="#333333"
                minWidth={4}
                maxWidth={8}
                dotSize={6}
                style={styles.canvas}
              />

              {/* Guia visual cuando no hay toque */}
              {!hasTouch && (
                <View style={styles.guideOverlay} pointerEvents="none">
                  <Text style={styles.guideIcon}>👆</Text>
                  <Text style={styles.guideText}>
                    Coloque su{'\n'}pulgar aqui
                  </Text>
                </View>
              )}
            </View>
          </View>

          <Text style={styles.handIndicator}>
            Pulgar {selectedHand === 'left' ? 'izquierdo' : 'derecho'}
          </Text>
        </View>

        {/* Instrucciones */}
        <View style={styles.instructions}>
          <Text style={styles.instructionText}>
            1. Seleccione la mano correspondiente
          </Text>
          <Text style={styles.instructionText}>
            2. Presione firmemente el pulgar en el circulo
          </Text>
          <Text style={styles.instructionText}>
            3. Mantenga 2-3 segundos sin mover
          </Text>
          <Text style={styles.instructionText}>
            4. Presione "Capturar" para guardar
          </Text>
        </View>

        {/* Botones de accion */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
            <Text style={styles.clearButtonText}>Limpiar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, !hasTouch && styles.saveButtonDisabled]}
            onPress={handleConfirm}
            disabled={!hasTouch}
          >
            <Text style={styles.saveButtonText}>Capturar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    padding: spacing.md,
    paddingTop: spacing.xl,
    backgroundColor: colors.primary,
  },
  title: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  subtitle: {
    fontSize: fontSize.caption,
    color: colors.textOnPrimary + 'CC',
    marginTop: spacing.xs,
  },
  handSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  handButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  handButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '15',
  },
  handEmoji: {
    fontSize: 24,
  },
  handLabel: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  handLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  captureArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  captureCircleOuter: {
    width: CAPTURE_SIZE + 12,
    height: CAPTURE_SIZE + 12,
    borderRadius: (CAPTURE_SIZE + 12) / 2,
    borderWidth: 3,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureCircle: {
    width: CAPTURE_SIZE,
    height: CAPTURE_SIZE,
    borderRadius: CAPTURE_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: '#F5F5F5',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  canvas: {
    width: CAPTURE_SIZE,
    height: CAPTURE_SIZE,
  },
  guideOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  guideIcon: {
    fontSize: 48,
    opacity: 0.3,
  },
  guideText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    opacity: 0.5,
  },
  handIndicator: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '600',
    marginTop: spacing.md,
  },
  instructions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  instructionText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    padding: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  clearButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.warning,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  clearButtonText: {
    color: colors.warning,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.success,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  saveButtonDisabled: {
    backgroundColor: colors.disabled,
  },
  saveButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
