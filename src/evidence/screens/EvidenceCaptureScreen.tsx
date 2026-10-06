/**
 * Pantalla de captura de evidencias multimedia.
 *
 * Soporta los tipos definidos en doc 01 §2.3:
 *   - Foto (camara trasera, frontal)
 *   - Video (duracion limitada)
 *   - Seleccion desde galeria
 *
 * Las evidencias se guardan localmente en SQLite y se suben
 * al backend durante la sincronizacion automatica.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  FlatList,
  Dimensions,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { v4 as uuidv4 } from 'uuid';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { insertEvidence, getRecordEvidence } from '../../db/database';
import { compressImage, FIELD_CAMERA_OPTIONS, FIELD_GALLERY_OPTIONS } from '../../utils/imageCompressor';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const THUMB_SIZE = (SCREEN_WIDTH - spacing.md * 3) / 2;

interface LocalEvidence {
  local_id: string;
  type: string;
  file_uri: string;
  remote_url: string | null;
  mime_type: string;
  uploaded: number;
}

export default function EvidenceCaptureScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const recordLocalId: string = route.params?.recordLocalId ?? '';

  const [evidences, setEvidences] = useState<LocalEvidence[]>(() => {
    if (!recordLocalId) return [];
    return getRecordEvidence(recordLocalId) as LocalEvidence[];
  });

  const refreshList = useCallback(() => {
    if (!recordLocalId) return;
    setEvidences(getRecordEvidence(recordLocalId) as LocalEvidence[]);
  }, [recordLocalId]);

  // Obtener GPS actual para geotagging
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

  // Obtener tamano del archivo
  const getFileSize = async (uri: string): Promise<number> => {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      return (info as any).size ?? 0;
    } catch {
      return 0;
    }
  };

  // Guardar evidencia en SQLite
  const saveEvidence = async (
    uri: string,
    type: 'photo' | 'video',
    mimeType: string,
  ) => {
    const gps = await getCurrentGps();
    const fileSize = await getFileSize(uri);
    const localId = uuidv4();

    insertEvidence({
      localId,
      recordLocalId,
      type,
      fileUri: uri,
      mimeType,
      fileSize,
      gps,
    });

    refreshList();
  };

  // Refrescar al volver de DocumentScanner
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', refreshList);
    return unsubscribe;
  }, [navigation, refreshList]);

  // Abrir escaner de documentos
  const scanDocument = () => {
    navigation.navigate('DocumentScanner', { recordLocalId });
  };

  // ── Acciones de captura ──────────────────────────────────────────

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso', 'Se necesita acceso a la camara');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: FIELD_CAMERA_OPTIONS.quality,
      exif: FIELD_CAMERA_OPTIONS.exif,
    });

    if (!result.canceled && result.assets[0]) {
      const compressed = await compressImage(result.assets[0].uri);
      await saveEvidence(
        compressed.uri,
        'photo',
        result.assets[0].mimeType ?? 'image/jpeg',
      );
    }
  };

  const recordVideo = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso', 'Se necesita acceso a la camara');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: 60, // 1 minuto max
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });

    if (!result.canceled && result.assets[0]) {
      await saveEvidence(
        result.assets[0].uri,
        'video',
        result.assets[0].mimeType ?? 'video/mp4',
      );
    }
  };

  const pickFromGallery = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso', 'Se necesita acceso a la galeria');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: FIELD_GALLERY_OPTIONS.quality,
      allowsMultipleSelection: FIELD_GALLERY_OPTIONS.allowsMultipleSelection,
      selectionLimit: FIELD_GALLERY_OPTIONS.selectionLimit,
    });

    if (!result.canceled) {
      for (const asset of result.assets) {
        const isVideo = asset.type === 'video';
        if (isVideo) {
          await saveEvidence(
            asset.uri,
            'video',
            asset.mimeType ?? 'video/mp4',
          );
        } else {
          const compressed = await compressImage(asset.uri);
          await saveEvidence(
            compressed.uri,
            'photo',
            asset.mimeType ?? 'image/jpeg',
          );
        }
      }
    }
  };

  // ── Renderizado ──────────────────────────────────────────────────

  const renderEvidence = ({ item }: { item: LocalEvidence }) => (
    <View style={styles.thumb}>
      {item.type === 'photo' ? (
        <Image source={{ uri: item.file_uri }} style={styles.thumbImage} />
      ) : item.type === 'document' ? (
        <View style={[styles.thumbImage, styles.videoPlaceholder]}>
          <Text style={styles.videoIcon}>📄</Text>
          <Text style={styles.videoLabel}>PDF</Text>
        </View>
      ) : (
        <View style={[styles.thumbImage, styles.videoPlaceholder]}>
          <Text style={styles.videoIcon}>▶</Text>
          <Text style={styles.videoLabel}>Video</Text>
        </View>
      )}
      <View style={styles.thumbInfo}>
        <View
          style={[
            styles.uploadDot,
            { backgroundColor: item.uploaded ? colors.success : colors.warning },
          ]}
        />
        <Text style={styles.thumbStatus}>
          {item.uploaded ? 'Subido' : 'Pendiente'}
        </Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Botones de captura */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={takePhoto}>
          <Text style={styles.actionIcon}>📷</Text>
          <Text style={styles.actionLabel}>Foto</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={recordVideo}>
          <Text style={styles.actionIcon}>🎥</Text>
          <Text style={styles.actionLabel}>Video</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={pickFromGallery}>
          <Text style={styles.actionIcon}>🖼</Text>
          <Text style={styles.actionLabel}>Galeria</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={scanDocument}>
          <Text style={styles.actionIcon}>📄</Text>
          <Text style={styles.actionLabel}>Escanear</Text>
        </TouchableOpacity>
      </View>

      {/* Contador */}
      <Text style={styles.counter}>
        {evidences.length} evidencia{evidences.length !== 1 ? 's' : ''} capturada{evidences.length !== 1 ? 's' : ''}
      </Text>

      {/* Grilla de evidencias */}
      <FlatList
        data={evidences}
        keyExtractor={(e) => e.local_id}
        renderItem={renderEvidence}
        numColumns={2}
        columnWrapperStyle={styles.row}
        contentContainerStyle={styles.grid}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              No hay evidencias. Use los botones de arriba para capturar.
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
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actionBtn: {
    alignItems: 'center',
    padding: spacing.md,
  },
  actionIcon: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  actionLabel: {
    fontSize: fontSize.caption,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  counter: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    padding: spacing.md,
    paddingBottom: spacing.xs,
  },
  grid: {
    padding: spacing.md / 2,
  },
  row: {
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md / 2,
  },
  thumb: {
    width: THUMB_SIZE,
    marginBottom: spacing.md,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    elevation: 2,
  },
  thumbImage: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    backgroundColor: colors.border,
  },
  videoPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.textPrimary + '10',
  },
  videoIcon: {
    fontSize: 32,
    color: colors.textSecondary,
  },
  videoLabel: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  thumbInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
  },
  uploadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  thumbStatus: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  empty: {
    padding: spacing.xl,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
