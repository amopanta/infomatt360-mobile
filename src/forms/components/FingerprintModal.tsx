/**
 * Modal de captura de huella digital del participante (doc 134).
 *
 * Dos métodos:
 *   1. **Cámara** (primario): usa expo-image-picker para fotografiar
 *      la huella. Guía visual, verificación de calidad básica.
 *      La imagen se guarda como archivo accesible para evidencia y
 *      generación de actas.
 *   2. **Táctil** (secundario): captura por presión del pulgar en
 *      pantalla usando react-native-signature-canvas. Genera un PNG.
 *
 * Ambos métodos devuelven:
 *   - fileUri: ruta local del archivo PNG/JPEG guardado en disco
 *   - dataUri: data URI base64 para preview en el formulario
 *   - hand: 'left' | 'right'
 *   - method: 'camera' | 'touch'
 *
 * La imagen queda visible y accesible para:
 *   - Vista previa en el formulario
 *   - Tabla de evidencias (se inserta en evidence)
 *   - Generación de actas (accesible por file_uri y remote_url)
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import SignatureCanvas, { type SignatureViewRef } from 'react-native-signature-canvas';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

/** Resultado de la captura de huella */
export interface FingerprintResult {
  /** Ruta local del archivo en disco (para evidence table) */
  fileUri: string;
  /** Data URI base64 para preview inline en el formulario */
  dataUri: string;
  /** Mano capturada */
  hand: 'left' | 'right';
  /** Método de captura */
  method: 'camera' | 'touch';
  /** Tamaño del archivo en bytes */
  fileSize: number;
}

interface FingerprintModalProps {
  visible: boolean;
  onSave: (result: FingerprintResult) => void;
  onCancel: () => void;
}

type Hand = 'left' | 'right';
type CaptureMethod = 'camera' | 'touch';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CAPTURE_SIZE = Math.min(SCREEN_WIDTH - spacing.lg * 2, 300);

export default function FingerprintModal({
  visible,
  onSave,
  onCancel,
}: FingerprintModalProps) {
  const signatureRef = useRef<SignatureViewRef>(null);
  const [selectedHand, setSelectedHand] = useState<Hand>('right');
  const [captureMethod, setCaptureMethod] = useState<CaptureMethod>('camera');
  const [hasTouch, setHasTouch] = useState(false);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [capturedFileUri, setCapturedFileUri] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const resetState = useCallback(() => {
    setHasTouch(false);
    setPreviewUri(null);
    setCapturedFileUri(null);
    setCapturing(false);
    signatureRef.current?.clearSignature();
  }, []);

  // ── Guardar base64 a archivo en disco ──────────────────────────────
  const saveBase64ToFile = useCallback(async (base64Data: string): Promise<{ fileUri: string; fileSize: number }> => {
    const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
    const timestamp = Date.now();
    const fileName = `fingerprint_${selectedHand}_${timestamp}.png`;
    const fileUri = `${dir}fingerprints/${fileName}`;

    // Crear directorio si no existe
    const dirPath = `${dir}fingerprints`;
    const dirInfo = await FileSystem.getInfoAsync(dirPath);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
    }

    // Quitar el prefijo data:image/png;base64, si existe
    const rawBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
    await FileSystem.writeAsStringAsync(fileUri, rawBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const info = await FileSystem.getInfoAsync(fileUri);
    const fileSize = (info as any).size ?? 0;

    return { fileUri, fileSize };
  }, [selectedHand]);

  // ── Captura con cámara (método primario, doc 134) ──────────────────
  const handleCameraCapture = useCallback(async () => {
    setCapturing(true);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para fotografiar la huella.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.9, // Alta calidad para huellas
        allowsEditing: true,
        aspect: [1, 1], // Recorte cuadrado para centrar la huella
        exif: true,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const sourceUri = asset.uri;

      // Copiar a directorio persistente de huellas
      const dir = FileSystem.documentDirectory ?? FileSystem.cacheDirectory ?? '';
      const timestamp = Date.now();
      const fileName = `fingerprint_${selectedHand}_camera_${timestamp}.jpg`;
      const destUri = `${dir}fingerprints/${fileName}`;

      const dirPath = `${dir}fingerprints`;
      const dirInfo = await FileSystem.getInfoAsync(dirPath);
      if (!dirInfo.exists) {
        await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
      }

      await FileSystem.copyAsync({ from: sourceUri, to: destUri });
      const info = await FileSystem.getInfoAsync(destUri);
      const fileSize = (info as any).size ?? 0;

      // Leer como base64 para preview
      const base64 = await FileSystem.readAsStringAsync(destUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const dataUri = `data:image/jpeg;base64,${base64}`;

      setPreviewUri(dataUri);
      setCapturedFileUri(destUri);

      // Guardar resultado
      onSave({
        fileUri: destUri,
        dataUri,
        hand: selectedHand,
        method: 'camera',
        fileSize,
      });
      resetState();
    } catch (err: any) {
      Alert.alert('Error', `No se pudo capturar la imagen: ${err.message}`);
    } finally {
      setCapturing(false);
    }
  }, [selectedHand, onSave, resetState]);

  // ── Captura táctil (método secundario) ─────────────────────────────
  const handleTouchOK = useCallback(async (signature: string) => {
    try {
      const { fileUri, fileSize } = await saveBase64ToFile(signature);

      onSave({
        fileUri,
        dataUri: signature,
        hand: selectedHand,
        method: 'touch',
        fileSize,
      });
      resetState();
    } catch (err: any) {
      Alert.alert('Error', `No se pudo guardar la huella: ${err.message}`);
    }
  }, [selectedHand, onSave, resetState, saveBase64ToFile]);

  const handleClear = () => {
    signatureRef.current?.clearSignature();
    setHasTouch(false);
    setPreviewUri(null);
    setCapturedFileUri(null);
  };

  const handleConfirmTouch = () => {
    signatureRef.current?.readSignature();
  };

  const handleBegin = () => {
    setHasTouch(true);
  };

  const handleCancel = () => {
    resetState();
    onCancel();
  };

  // CSS para el canvas táctil
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
      onRequestClose={handleCancel}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Captura de huella digital</Text>
          <Text style={styles.subtitle}>
            {captureMethod === 'camera'
              ? 'Fotografíe la huella del participante'
              : 'Presione el pulgar firmemente en el área circular'}
          </Text>
        </View>

        {/* Selector de método */}
        <View style={styles.methodSelector}>
          <TouchableOpacity
            style={[
              styles.methodButton,
              captureMethod === 'camera' && styles.methodButtonActive,
            ]}
            onPress={() => {
              setCaptureMethod('camera');
              handleClear();
            }}
          >
            <Text style={styles.methodIcon}>📷</Text>
            <Text
              style={[
                styles.methodLabel,
                captureMethod === 'camera' && styles.methodLabelActive,
              ]}
            >
              Cámara
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.methodButton,
              captureMethod === 'touch' && styles.methodButtonActive,
            ]}
            onPress={() => {
              setCaptureMethod('touch');
              handleClear();
            }}
          >
            <Text style={styles.methodIcon}>👆</Text>
            <Text
              style={[
                styles.methodLabel,
                captureMethod === 'touch' && styles.methodLabelActive,
              ]}
            >
              Táctil
            </Text>
          </TouchableOpacity>
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

        {/* Área de captura */}
        <View style={styles.captureArea}>
          {captureMethod === 'camera' ? (
            // ── Modo cámara ──
            <View style={styles.cameraArea}>
              {previewUri ? (
                <View style={styles.previewContainer}>
                  <Image
                    source={{ uri: previewUri }}
                    style={styles.previewImage}
                    resizeMode="contain"
                  />
                  <Text style={styles.previewLabel}>
                    Huella capturada - Pulgar {selectedHand === 'left' ? 'izquierdo' : 'derecho'}
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.cameraButton}
                  onPress={handleCameraCapture}
                  disabled={capturing}
                >
                  {capturing ? (
                    <ActivityIndicator size="large" color={colors.primary} />
                  ) : (
                    <>
                      <Text style={styles.cameraIcon}>📷</Text>
                      <Text style={styles.cameraText}>
                        Toque para abrir la cámara
                      </Text>
                      <Text style={styles.cameraHint}>
                        Centre la huella del participante{'\n'}en el encuadre cuadrado
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          ) : (
            // ── Modo táctil ──
            <View style={styles.touchArea}>
              <View style={styles.captureCircleOuter}>
                <View style={styles.captureCircle}>
                  <SignatureCanvas
                    ref={signatureRef}
                    onOK={handleTouchOK}
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

                  {!hasTouch && (
                    <View style={styles.guideOverlay} pointerEvents="none">
                      <Text style={styles.guideIcon}>👆</Text>
                      <Text style={styles.guideText}>
                        Coloque su{'\n'}pulgar aquí
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          <Text style={styles.handIndicator}>
            Pulgar {selectedHand === 'left' ? 'izquierdo' : 'derecho'}
          </Text>
        </View>

        {/* Instrucciones según método */}
        <View style={styles.instructions}>
          {captureMethod === 'camera' ? (
            <>
              <Text style={styles.instructionText}>
                1. Seleccione la mano correspondiente
              </Text>
              <Text style={styles.instructionText}>
                2. Abra la cámara y centre la huella del participante
              </Text>
              <Text style={styles.instructionText}>
                3. Asegúrese de buena iluminación y enfoque
              </Text>
              <Text style={styles.instructionText}>
                4. Recorte para centrar la huella y confirme
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.instructionText}>
                1. Seleccione la mano correspondiente
              </Text>
              <Text style={styles.instructionText}>
                2. Presione firmemente el pulgar en el círculo
              </Text>
              <Text style={styles.instructionText}>
                3. Mantenga 2-3 segundos sin mover
              </Text>
              <Text style={styles.instructionText}>
                4. Presione "Capturar" para guardar
              </Text>
            </>
          )}
        </View>

        {/* Nota de evidencia */}
        <View style={styles.evidenceNote}>
          <Text style={styles.evidenceNoteText}>
            La imagen quedará disponible como evidencia y para la generación de actas
          </Text>
        </View>

        {/* Botones de acción */}
        <View style={styles.actions}>
          <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
            <Text style={styles.cancelButtonText}>Cancelar</Text>
          </TouchableOpacity>

          {captureMethod === 'touch' && (
            <>
              <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
                <Text style={styles.clearButtonText}>Limpiar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.saveButton, !hasTouch && styles.saveButtonDisabled]}
                onPress={handleConfirmTouch}
                disabled={!hasTouch}
              >
                <Text style={styles.saveButtonText}>Capturar</Text>
              </TouchableOpacity>
            </>
          )}

          {captureMethod === 'camera' && previewUri && (
            <TouchableOpacity style={styles.clearButton} onPress={handleClear}>
              <Text style={styles.clearButtonText}>Repetir</Text>
            </TouchableOpacity>
          )}
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
  // ── Selector de método ──
  methodSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  methodButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 2,
    borderColor: colors.border,
    gap: spacing.xs,
  },
  methodButtonActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '15',
  },
  methodIcon: {
    fontSize: 18,
  },
  methodLabel: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  methodLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  // ── Selector de mano ──
  handSelector: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  handButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.xs,
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
  // ── Área de captura ──
  captureArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },
  // Cámara
  cameraArea: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  cameraButton: {
    width: CAPTURE_SIZE + 40,
    height: CAPTURE_SIZE + 40,
    borderRadius: borderRadius.lg,
    borderWidth: 3,
    borderColor: colors.primary,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
  cameraIcon: {
    fontSize: 48,
    marginBottom: spacing.sm,
  },
  cameraText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '600',
    textAlign: 'center',
  },
  cameraHint: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  previewContainer: {
    alignItems: 'center',
  },
  previewImage: {
    width: CAPTURE_SIZE + 40,
    height: CAPTURE_SIZE + 40,
    borderRadius: borderRadius.lg,
    borderWidth: 2,
    borderColor: colors.success,
  },
  previewLabel: {
    fontSize: fontSize.body,
    color: colors.success,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  // Táctil
  touchArea: {
    alignItems: 'center',
    justifyContent: 'center',
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
    marginTop: spacing.sm,
  },
  // ── Instrucciones ──
  instructions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
    gap: spacing.xs,
  },
  instructionText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  // ── Nota de evidencia ──
  evidenceNote: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    backgroundColor: colors.primary + '15',
    borderRadius: borderRadius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.primary,
  },
  evidenceNoteText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontStyle: 'italic',
  },
  // ── Botones ──
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
