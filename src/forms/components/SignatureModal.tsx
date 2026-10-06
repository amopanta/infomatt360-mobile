/**
 * Modal de captura de firma digital.
 *
 * Usa react-native-signature-canvas (WebView) para dibujar
 * la firma y devuelve el base64 PNG al componente padre.
 */

import React, { useRef } from 'react';
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

interface SignatureModalProps {
  visible: boolean;
  onSave: (signatureBase64: string) => void;
  onCancel: () => void;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export default function SignatureModal({
  visible,
  onSave,
  onCancel,
}: SignatureModalProps) {
  const signatureRef = useRef<SignatureViewRef>(null);

  const handleOK = (signature: string) => {
    // signature es un data URI: "data:image/png;base64,..."
    onSave(signature);
  };

  const handleClear = () => {
    signatureRef.current?.clearSignature();
  };

  const handleConfirm = () => {
    signatureRef.current?.readSignature();
  };

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
  .m-signature-pad--footer {
    display: none;
  }
  body, html {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
  }`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onCancel}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Capturar firma</Text>
          <Text style={styles.subtitle}>Dibuje su firma en el area de abajo</Text>
        </View>

        <View style={styles.canvasContainer}>
          <SignatureCanvas
            ref={signatureRef}
            onOK={handleOK}
            onEmpty={() => {
              // No hacer nada si esta vacio
            }}
            webStyle={webStyle}
            backgroundColor="white"
            penColor="black"
            minWidth={1.5}
            maxWidth={3}
            style={styles.canvas}
          />
        </View>

        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancelar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
            <Text style={styles.clearButtonText}>Limpiar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.saveButton} onPress={handleConfirm}>
            <Text style={styles.saveButtonText}>Guardar</Text>
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
  canvasContainer: {
    flex: 1,
    margin: spacing.md,
    borderWidth: 2,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    borderStyle: 'dashed',
    overflow: 'hidden',
    backgroundColor: 'white',
  },
  canvas: {
    flex: 1,
    width: SCREEN_WIDTH - spacing.md * 2,
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
  saveButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
});
