/**
 * Escaner de documentos integrado.
 *
 * Permite capturar multiples paginas desde la camara,
 * reordenarlas, eliminar paginas individuales,
 * y generar un PDF que se guarda como evidencia.
 *
 * Flujo:
 *   1. Usuario toma fotos de cada pagina del documento
 *   2. Vista previa con miniaturas reordenables
 *   3. Al confirmar, se genera un PDF y se guarda como evidencia
 *
 * Navegacion:
 *   - Desde EvidenceCaptureScreen (boton "Escanear documento")
 *   - Desde FieldRenderer tipo "document" (campo de formulario)
 *   - Retorna el URI del PDF generado via route params callback
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  FlatList,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { v4 as uuidv4 } from 'uuid';
import { generatePdfFromImages } from './pdfGenerator';
import { insertEvidence } from '../db/database';
import * as FileSystem from 'expo-file-system/legacy';
import * as Location from 'expo-location';
import { colors, spacing, fontSize, borderRadius } from '../ui/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_SIZE = (SCREEN_WIDTH - spacing.md * 4) / 3;

interface ScannedPage {
  id: string;
  uri: string;
  width: number;
  height: number;
}

export default function DocumentScannerScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  // Si viene de evidencias, se asocia al registro
  const recordLocalId: string | undefined = route.params?.recordLocalId;
  // Si viene de un campo de formulario, retorna el URI via callback
  const fieldId: string | undefined = route.params?.fieldId;
  const onDocumentScanned: ((uri: string, fileName: string) => void) | undefined =
    route.params?.onDocumentScanned;

  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [generating, setGenerating] = useState(false);
  const [selectedPage, setSelectedPage] = useState<string | null>(null);

  // ── Captura de paginas ──────────────────────────────────────────

  const capturePage = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso', 'Se necesita acceso a la camara para escanear');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      exif: false,
    });

    if (!result.canceled && result.assets[0]) {
      const asset = result.assets[0];
      const newPage: ScannedPage = {
        id: uuidv4(),
        uri: asset.uri,
        width: asset.width ?? 1000,
        height: asset.height ?? 1414,
      };
      setPages((prev) => [...prev, newPage]);
    }
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso', 'Se necesita acceso a la galeria');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: 20,
      orderedSelection: true,
    });

    if (!result.canceled) {
      const newPages: ScannedPage[] = result.assets.map((asset) => ({
        id: uuidv4(),
        uri: asset.uri,
        width: asset.width ?? 1000,
        height: asset.height ?? 1414,
      }));
      setPages((prev) => [...prev, ...newPages]);
    }
  };

  // ── Gestion de paginas ──────────────────────────────────────────

  const removePage = useCallback(
    (pageId: string) => {
      Alert.alert('Eliminar pagina', '¿Desea eliminar esta pagina del documento?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: () => {
            setPages((prev) => prev.filter((p) => p.id !== pageId));
            if (selectedPage === pageId) setSelectedPage(null);
          },
        },
      ]);
    },
    [selectedPage],
  );

  const movePageUp = useCallback((pageId: string) => {
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.id === pageId);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  }, []);

  const movePageDown = useCallback((pageId: string) => {
    setPages((prev) => {
      const idx = prev.findIndex((p) => p.id === pageId);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  }, []);

  // ── Generacion de PDF ──────────────────────────────────────────

  const getCurrentGps = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return undefined;
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      return {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? 0,
      };
    } catch {
      return undefined;
    }
  };

  const handleGeneratePdf = async () => {
    if (pages.length === 0) {
      Alert.alert('Sin paginas', 'Capture al menos una pagina para generar el documento');
      return;
    }

    setGenerating(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
      const fileName = `scan_${timestamp}.pdf`;

      const pdfUri = await generatePdfFromImages(pages, fileName);

      // Obtener tamano del archivo generado
      const fileInfo = await FileSystem.getInfoAsync(pdfUri);
      const fileSize = (fileInfo as any).size ?? 0;

      if (recordLocalId) {
        // Guardar como evidencia asociada al registro
        const gps = await getCurrentGps();
        const localId = uuidv4();
        insertEvidence({
          localId,
          recordLocalId,
          type: 'document',
          fileUri: pdfUri,
          mimeType: 'application/pdf',
          fileSize,
          gps,
        });

        Alert.alert(
          'Documento generado',
          `PDF de ${pages.length} pagina${pages.length !== 1 ? 's' : ''} guardado como evidencia.`,
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      } else if (onDocumentScanned) {
        // Retornar al campo del formulario
        onDocumentScanned(pdfUri, fileName);
        navigation.goBack();
      } else {
        // Caso generico: notificar y volver
        Alert.alert(
          'Documento generado',
          `PDF guardado: ${fileName}`,
          [{ text: 'Aceptar', onPress: () => navigation.goBack() }],
        );
      }
    } catch (err: any) {
      Alert.alert('Error', `No se pudo generar el PDF: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // ── Renderizado ──────────────────────────────────────────────────

  const renderPage = ({ item, index }: { item: ScannedPage; index: number }) => {
    const isSelected = selectedPage === item.id;
    return (
      <TouchableOpacity
        style={[styles.pageThumb, isSelected && styles.pageThumbSelected]}
        onPress={() => setSelectedPage(isSelected ? null : item.id)}
        onLongPress={() => removePage(item.id)}
        activeOpacity={0.7}
      >
        <Image source={{ uri: item.uri }} style={styles.pageImage} resizeMode="cover" />
        <View style={styles.pageNumber}>
          <Text style={styles.pageNumberText}>{index + 1}</Text>
        </View>
        {isSelected && (
          <View style={styles.pageActions}>
            <TouchableOpacity
              style={[styles.pageActionBtn, index === 0 && styles.pageActionBtnDisabled]}
              onPress={() => movePageUp(item.id)}
              disabled={index === 0}
            >
              <Text style={styles.pageActionText}>◀</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.pageActionBtn}
              onPress={() => removePage(item.id)}
            >
              <Text style={[styles.pageActionText, { color: colors.error }]}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.pageActionBtn,
                index === pages.length - 1 && styles.pageActionBtnDisabled,
              ]}
              onPress={() => movePageDown(item.id)}
              disabled={index === pages.length - 1}
            >
              <Text style={styles.pageActionText}>▶</Text>
            </TouchableOpacity>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header info */}
      <View style={styles.infoBar}>
        <Text style={styles.infoText}>
          📄 {pages.length} pagina{pages.length !== 1 ? 's' : ''} capturada{pages.length !== 1 ? 's' : ''}
        </Text>
        {pages.length > 0 && (
          <Text style={styles.infoHint}>
            Toque para reordenar · Mantenga presionado para eliminar
          </Text>
        )}
      </View>

      {/* Grilla de paginas */}
      {pages.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>📸</Text>
          <Text style={styles.emptyTitle}>Escanear documento</Text>
          <Text style={styles.emptySubtitle}>
            Tome fotos de cada pagina del documento.{'\n'}
            Las paginas se compilaran en un archivo PDF.
          </Text>
        </View>
      ) : (
        <FlatList
          data={pages}
          keyExtractor={(p) => p.id}
          renderItem={renderPage}
          numColumns={3}
          columnWrapperStyle={styles.pageRow}
          contentContainerStyle={styles.pageGrid}
        />
      )}

      {/* Botones de accion */}
      <View style={styles.bottomBar}>
        <View style={styles.captureActions}>
          <TouchableOpacity
            style={styles.captureBtn}
            onPress={capturePage}
            disabled={generating}
          >
            <Text style={styles.captureBtnIcon}>📷</Text>
            <Text style={styles.captureBtnLabel}>Camara</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.captureBtn}
            onPress={pickFromGallery}
            disabled={generating}
          >
            <Text style={styles.captureBtnIcon}>🖼</Text>
            <Text style={styles.captureBtnLabel}>Galeria</Text>
          </TouchableOpacity>
        </View>

        {pages.length > 0 && (
          <TouchableOpacity
            style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
            onPress={handleGeneratePdf}
            disabled={generating}
          >
            {generating ? (
              <View style={styles.generatingRow}>
                <ActivityIndicator size="small" color={colors.textOnPrimary} />
                <Text style={styles.generateBtnText}>Generando PDF...</Text>
              </View>
            ) : (
              <Text style={styles.generateBtnText}>
                Generar PDF ({pages.length} pag{pages.length !== 1 ? 's' : ''})
              </Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  infoBar: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoText: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  infoHint: {
    fontSize: fontSize.caption - 1,
    color: colors.textSecondary,
    marginTop: 2,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 56,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  emptySubtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  pageGrid: {
    padding: spacing.sm,
  },
  pageRow: {
    justifyContent: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.sm,
  },
  pageThumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE * 1.4,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pageThumbSelected: {
    borderColor: colors.primary,
  },
  pageImage: {
    width: '100%',
    height: '100%',
  },
  pageNumber: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pageNumberText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  pageActions: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingVertical: 6,
  },
  pageActionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 2,
  },
  pageActionBtnDisabled: {
    opacity: 0.3,
  },
  pageActionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  bottomBar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.md,
    paddingBottom: spacing.lg,
  },
  captureActions: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.xl,
    marginBottom: spacing.md,
  },
  captureBtn: {
    alignItems: 'center',
    padding: spacing.sm,
  },
  captureBtnIcon: {
    fontSize: 28,
    marginBottom: 4,
  },
  captureBtnLabel: {
    fontSize: fontSize.caption,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  generateBtn: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
  },
  generateBtnDisabled: {
    opacity: 0.6,
  },
  generateBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
  },
  generatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
