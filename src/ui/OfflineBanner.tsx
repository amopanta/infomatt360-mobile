/**
 * Banner de estado offline que se muestra en la parte superior
 * de todas las pantallas cuando no hay conexion a internet.
 *
 * Tambien muestra un indicador cuando la sincronizacion esta activa.
 */

import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useConnectivityStore } from '../store/connectivityStore';
import { onSyncStatusChange, getSyncStatus } from '../sync/syncService';
import { getPendingCount } from '../db/database';
import { colors, spacing, fontSize } from './theme';

export default function OfflineBanner() {
  const isOnline = useConnectivityStore((s) => s.isOnline);
  const [syncStatus, setSyncStatus] = useState(getSyncStatus());
  const [pendingCount, setPendingCount] = useState(0);
  const [slideAnim] = useState(new Animated.Value(-50));

  useEffect(() => {
    const unsub = onSyncStatusChange((s) => {
      setSyncStatus(s);
      setPendingCount(getPendingCount());
    });
    setPendingCount(getPendingCount());
    return unsub;
  }, []);

  // Mostrar u ocultar la barra offline
  const showBanner = !isOnline;

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: showBanner ? 0 : -50,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [showBanner, slideAnim]);

  // Barra de sync activa (cuando esta online y sincronizando)
  const showSyncBar = isOnline && syncStatus === 'syncing';

  return (
    <>
      {/* Banner offline */}
      <Animated.View
        style={[
          styles.offlineBanner,
          { transform: [{ translateY: slideAnim }] },
        ]}
        pointerEvents={showBanner ? 'auto' : 'none'}
      >
        <Text style={styles.offlineText}>
          Sin conexion a internet
        </Text>
        {pendingCount > 0 && (
          <Text style={styles.pendingText}>
            {pendingCount} registro{pendingCount !== 1 ? 's' : ''} pendiente{pendingCount !== 1 ? 's' : ''}
          </Text>
        )}
      </Animated.View>

      {/* Barra de sync */}
      {showSyncBar && (
        <View style={styles.syncBar}>
          <Text style={styles.syncText}>Sincronizando registros...</Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  offlineBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.warning,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 999,
  },
  offlineText: {
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  pendingText: {
    color: '#FFFFFF',
    fontSize: fontSize.caption,
    opacity: 0.9,
  },
  syncBar: {
    backgroundColor: colors.primary + '15',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
  },
  syncText: {
    color: colors.primary,
    fontSize: fontSize.caption,
    fontWeight: '500',
  },
});
