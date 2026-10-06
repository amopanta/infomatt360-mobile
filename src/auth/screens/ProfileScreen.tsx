/**
 * Pantalla de perfil y configuracion.
 *
 * Muestra:
 *   - Informacion del usuario y organizacion
 *   - Proyecto activo con opcion de cambiar
 *   - Diagnostico del dispositivo (GPS, red, almacenamiento)
 *   - Cerrar sesion
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuthStore } from '../../store/authStore';
import { getDatabase, getPendingCount, getPendingEvidenceCount } from '../../db/database';
import { stopAutoSync } from '../../sync/syncService';
import { getDeviceFingerprint } from '../../utils/deviceFingerprint';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

interface DiagInfo {
  gpsEnabled: boolean;
  networkConnected: boolean;
  networkType: string;
  dbRecords: number;
  pendingRecords: number;
  pendingEvidence: number;
  fingerprint: string;
  storageAvailable: string;
}

export default function ProfileScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { session, activeProjectId, activePermissions, logout, selectProject } =
    useAuthStore();
  const [diag, setDiag] = useState<DiagInfo | null>(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  const activeProject = session?.projects.find((p) => p.id === activeProjectId);

  const runDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      // GPS
      const { status: gpsStatus } = await Location.requestForegroundPermissionsAsync();
      const gpsEnabled = gpsStatus === 'granted';

      // Red
      const netState = await Network.getNetworkStateAsync();
      const networkConnected = netState.isConnected ?? false;
      const networkType = netState.type ?? 'unknown';

      // Base de datos
      const db = getDatabase();
      const totalRow = db.getFirstSync<{ count: number }>(
        `SELECT COUNT(*) as count FROM queued_records`,
      );
      const dbRecords = totalRow?.count ?? 0;
      const pendingRecords = getPendingCount();
      const pendingEvidence = getPendingEvidenceCount();

      // Fingerprint
      const fingerprint = await getDeviceFingerprint();

      // Almacenamiento
      const freeBytes = await FileSystem.getFreeDiskStorageAsync();
      const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);

      setDiag({
        gpsEnabled,
        networkConnected,
        networkType: String(networkType),
        dbRecords,
        pendingRecords,
        pendingEvidence,
        fingerprint,
        storageAvailable: `${freeGB} GB`,
      });
    } catch (err: any) {
      Alert.alert('Error', 'No se pudo completar el diagnostico');
    } finally {
      setLoadingDiag(false);
    }
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  const handleLogout = () => {
    Alert.alert('Cerrar sesion', '¿Esta seguro de cerrar sesion? Los registros pendientes se conservan localmente.', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Cerrar sesion',
        style: 'destructive',
        onPress: () => {
          stopAutoSync();
          logout();
        },
      },
    ]);
  };

  const handleChangeProject = () => {
    if (!session || session.projects.length <= 1) {
      Alert.alert('Info', 'Solo tiene un proyecto asignado');
      return;
    }
    // Resetear proyecto para volver al selector
    useAuthStore.setState({ activeProjectId: null, activePermissions: [] });
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Info del usuario */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Usuario</Text>
        <View style={styles.card}>
          <InfoRow label="Nombre" value={session?.full_name ?? '—'} />
          <InfoRow label="Correo" value={session?.email ?? '—'} />
          <InfoRow label="Organizacion" value={session?.organization_name ?? '—'} />
          <InfoRow
            label="MFA"
            value={session?.mfa_enabled ? 'Activado' : 'Desactivado'}
          />
        </View>
      </View>

      {/* Proyecto activo */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Proyecto activo</Text>
        <View style={styles.card}>
          <InfoRow label="Proyecto" value={activeProject?.name ?? '—'} />
          <InfoRow
            label="Permisos"
            value={`${activePermissions.length} asignados`}
          />
          {session && session.projects.length > 1 && (
            <TouchableOpacity style={styles.linkButton} onPress={handleChangeProject}>
              <Text style={styles.linkButtonText}>Cambiar proyecto</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Diagnostico del dispositivo */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Diagnostico</Text>
          <TouchableOpacity onPress={runDiagnostics} disabled={loadingDiag}>
            <Text style={styles.refreshLink}>
              {loadingDiag ? 'Verificando...' : 'Actualizar'}
            </Text>
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {diag ? (
            <>
              <DiagRow
                label="GPS"
                value={diag.gpsEnabled ? 'Habilitado' : 'Deshabilitado'}
                ok={diag.gpsEnabled}
              />
              <DiagRow
                label="Red"
                value={diag.networkConnected ? `Conectado (${diag.networkType})` : 'Sin conexion'}
                ok={diag.networkConnected}
              />
              <DiagRow
                label="Almacenamiento"
                value={diag.storageAvailable}
                ok
              />
              <DiagRow
                label="Registros locales"
                value={String(diag.dbRecords)}
                ok
              />
              <DiagRow
                label="Pendientes de envio"
                value={String(diag.pendingRecords)}
                ok={diag.pendingRecords === 0}
              />
              <DiagRow
                label="Evidencias pendientes"
                value={String(diag.pendingEvidence)}
                ok={diag.pendingEvidence === 0}
              />
              <InfoRow
                label="ID dispositivo"
                value={diag.fingerprint.substring(0, 12) + '...'}
              />
            </>
          ) : (
            <Text style={styles.loading}>Ejecutando diagnostico...</Text>
          )}
        </View>
      </View>

      {/* Estadisticas */}
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('Stats')}
      >
        <Text style={styles.settingsText}>📊  Estadisticas</Text>
      </TouchableOpacity>

      {/* Configuracion */}
      <TouchableOpacity
        style={styles.settingsButton}
        onPress={() => navigation.navigate('Settings')}
      >
        <Text style={styles.settingsText}>⚙️  Configuracion</Text>
      </TouchableOpacity>

      {/* Cerrar sesion */}
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Cerrar sesion</Text>
      </TouchableOpacity>

      <Text style={styles.version}>InfoMatt360 Mobile v1.0.0</Text>
    </ScrollView>
  );
}

// ── Componentes auxiliares ──────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={rowStyles.value}>{value}</Text>
    </View>
  );
}

function DiagRow({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.diagLabel}>
        <View
          style={[
            rowStyles.dot,
            { backgroundColor: ok ? colors.success : colors.warning },
          ]}
        />
        <Text style={rowStyles.label}>{label}</Text>
      </View>
      <Text style={[rowStyles.value, { color: ok ? colors.textPrimary : colors.warning }]}>
        {value}
      </Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  label: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  value: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: '500',
    textAlign: 'right',
    flex: 1,
    marginLeft: spacing.md,
  },
  diagLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.sm,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  refreshLink: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '500',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  linkButton: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
  },
  linkButtonText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '500',
  },
  loading: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    padding: spacing.md,
  },
  settingsButton: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  settingsText: {
    color: colors.primary,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
  },
  logoutButton: {
    backgroundColor: colors.error + '10',
    borderWidth: 1,
    borderColor: colors.error,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  logoutText: {
    color: colors.error,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
  },
  version: {
    textAlign: 'center',
    fontSize: fontSize.caption,
    color: colors.disabled,
  },
});
