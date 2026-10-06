/**
 * Visor de evidencias a pantalla completa.
 *
 * Permite:
 *   - Ver fotos a tamaño completo con zoom (pinch)
 *   - Navegar entre evidencias con swipe horizontal
 *   - Indicador de posicion (1/N)
 *   - Boton de cerrar
 *   - Indicador de estado de subida
 *
 * Se accede desde RecordDetailScreen al tocar un thumbnail.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  StatusBar,
  Platform,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { getRecordEvidence } from '../../db/database';
import { colors, spacing, fontSize } from '../../ui/theme';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface EvidenceItem {
  local_id: string;
  type: string;
  file_uri: string;
  remote_url: string | null;
  mime_type: string;
  uploaded: number;
}

export default function EvidenceViewerScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation();
  const recordLocalId: string = route.params?.recordLocalId ?? '';
  const initialIndex: number = route.params?.initialIndex ?? 0;

  const [evidences] = useState<EvidenceItem[]>(() => {
    if (!recordLocalId) return [];
    return getRecordEvidence(recordLocalId) as EvidenceItem[];
  });

  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ index: number | null }> }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  if (evidences.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.emptyText}>Sin evidencias</Text>
      </View>
    );
  }

  const current = evidences[currentIndex];
  const isUploaded = current?.uploaded === 1;

  const renderItem = ({ item }: { item: EvidenceItem }) => {
    if (item.type === 'video') {
      return (
        <View style={styles.slide}>
          <View style={styles.videoPlaceholder}>
            <Text style={styles.videoIcon}>▶</Text>
            <Text style={styles.videoLabel}>Video</Text>
            <Text style={styles.videoPath} numberOfLines={2}>
              {item.file_uri.split('/').pop()}
            </Text>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.slide}>
        <Image
          source={{ uri: item.file_uri }}
          style={styles.fullImage}
          resizeMode="contain"
        />
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      {/* Galeria horizontal */}
      <FlatList
        ref={flatListRef}
        data={evidences}
        keyExtractor={(e) => e.local_id}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={initialIndex}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
      />

      {/* Header overlay */}
      <View style={styles.headerOverlay}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.counter}>
          {currentIndex + 1} / {evidences.length}
        </Text>
        <View style={styles.closeButton} />
      </View>

      {/* Footer overlay con info */}
      <View style={styles.footerOverlay}>
        <View style={styles.footerContent}>
          <Text style={styles.typeLabel}>
            {current?.type === 'fingerprint' ? '👆 Huella' : current?.type === 'photo' ? '📷 Foto' : '🎥 Video'}
          </Text>
          <View
            style={[
              styles.uploadBadge,
              { backgroundColor: isUploaded ? colors.success + '30' : colors.warning + '30' },
            ]}
          >
            <Text
              style={[
                styles.uploadText,
                { color: isUploaded ? colors.success : colors.warning },
              ]}
            >
              {isUploaded ? '✓ Subida' : '⏳ Pendiente'}
            </Text>
          </View>
        </View>
        <Text style={styles.fileName} numberOfLines={1}>
          {current?.file_uri.split('/').pop()}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  slide: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fullImage: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.8,
  },
  // Video placeholder
  videoPlaceholder: {
    width: SCREEN_WIDTH * 0.7,
    height: SCREEN_WIDTH * 0.7,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoIcon: {
    fontSize: 48,
    color: '#fff',
    marginBottom: spacing.sm,
  },
  videoLabel: {
    fontSize: fontSize.subtitle,
    color: '#ccc',
    fontWeight: '600',
  },
  videoPath: {
    fontSize: fontSize.caption,
    color: '#888',
    marginTop: spacing.sm,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  // Header
  headerOverlay: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 50 : 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeText: {
    fontSize: 18,
    color: '#fff',
    fontWeight: '700',
  },
  counter: {
    fontSize: fontSize.body,
    color: '#fff',
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingVertical: 4,
    paddingHorizontal: spacing.md,
    borderRadius: 12,
    overflow: 'hidden',
  },
  // Footer
  footerOverlay: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 20,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  footerContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  typeLabel: {
    fontSize: fontSize.body,
    color: '#fff',
    fontWeight: '500',
  },
  uploadBadge: {
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
  },
  uploadText: {
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  fileName: {
    fontSize: fontSize.caption,
    color: '#999',
  },
  emptyText: {
    fontSize: fontSize.body,
    color: '#999',
    textAlign: 'center',
    marginTop: SCREEN_HEIGHT * 0.4,
  },
});
