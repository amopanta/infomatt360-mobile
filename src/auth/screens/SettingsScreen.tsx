/**
 * Pantalla de configuracion de la aplicacion.
 *
 * Permite al usuario ajustar:
 *   - Precision GPS y timeout
 *   - Intervalo de sincronizacion y retencion
 *   - Comportamiento de captura (auto-guardado, confirmacion)
 *   - Informacion de almacenamiento y limpieza
 *   - Restaurar valores por defecto
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  StyleSheet,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSettingsStore } from '../../store/settingsStore';
import { usePinStore } from '../../store/pinStore';
import { useServerStore } from '../../store/serverStore';
import { ENV } from '../../config/env';
import { getDatabase, getCrashLogCount, clearCrashLogs } from '../../db/database';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

// ── Helpers ─────────────────────────────────────────────────────────

interface StorageInfo {
  totalRecords: number;
  pendingRecords: number;
  syncedRecords: number;
  errorRecords: number;
  draftRecords: number;
  totalEvidence: number;
  pendingEvidence: number;
  templateCount: number;
}

function getStorageInfo(): StorageInfo {
  const db = getDatabase();
  const counts = db.getFirstSync(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'synced' THEN 1 ELSE 0 END) as synced,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errors,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts
    FROM queued_records
  `) as { total: number; pending: number; synced: number; errors: number; drafts: number };

  const evCounts = db.getFirstSync(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN uploaded = 0 THEN 1 ELSE 0 END) as pending
    FROM evidence
  `) as { total: number; pending: number };

  const templates = db.getFirstSync('SELECT COUNT(*) as cnt FROM form_templates') as { cnt: number };

  return {
    totalRecords: counts?.total ?? 0,
    pendingRecords: counts?.pending ?? 0,
    syncedRecords: counts?.synced ?? 0,
    errorRecords: counts?.errors ?? 0,
    draftRecords: counts?.drafts ?? 0,
    totalEvidence: evCounts?.total ?? 0,
    pendingEvidence: evCounts?.pending ?? 0,
    templateCount: templates?.cnt ?? 0,
  };
}

// ── Componentes auxiliares ───────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionHeader}>{title}</Text>;
}

function SettingRow({
  label,
  description,
  right,
}: {
  label: string;
  description?: string;
  right: React.ReactNode;
}) {
  return (
    <View style={styles.settingRow}>
      <View style={styles.settingTextContainer}>
        <Text style={styles.settingLabel}>{label}</Text>
        {description && <Text style={styles.settingDescription}>{description}</Text>}
      </View>
      {right}
    </View>
  );
}

function OptionSelector<T extends string | number>({
  options,
  selected,
  onChange,
}: {
  options: { value: T; label: string }[];
  selected: T;
  onChange: (val: T) => void;
}) {
  return (
    <View style={styles.optionRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={String(opt.value)}
          style={[
            styles.optionBtn,
            selected === opt.value && styles.optionBtnActive,
          ]}
          onPress={() => onChange(opt.value)}
        >
          <Text
            style={[
              styles.optionText,
              selected === opt.value && styles.optionTextActive,
            ]}
          >
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Pantalla principal ──────────────────────────────────────────────

export default function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const settings = useSettingsStore();
  const { pinEnabled, changePin, removePin } = usePinStore();
  const { customUrl, setServerUrl: saveServerUrl, resetToDefault, getEffectiveUrl } = useServerStore();
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [crashCount, setCrashCount] = useState(0);
  const [editingServer, setEditingServer] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState(customUrl ?? '');

  useEffect(() => {
    if (!settings.loaded) settings.load();
  }, [settings.loaded]);

  useEffect(() => {
    setStorageInfo(getStorageInfo());
    setCrashCount(getCrashLogCount());
  }, []);

  const refreshStorage = useCallback(() => {
    setStorageInfo(getStorageInfo());
  }, []);

  const handleClearSynced = () => {
    Alert.alert(
      'Limpiar registros sincronizados',
      'Se eliminaran todos los registros ya enviados al servidor. Los borradores y pendientes NO se afectan.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpiar',
          style: 'destructive',
          onPress: () => {
            const db = getDatabase();
            // Eliminar evidencias de registros sincronizados
            db.runSync(`
              DELETE FROM evidence WHERE record_local_id IN (
                SELECT local_id FROM queued_records WHERE status = 'synced'
              )
            `);
            // Eliminar registros sincronizados
            db.runSync(`DELETE FROM queued_records WHERE status = 'synced'`);
            refreshStorage();
            Alert.alert('Listo', 'Registros sincronizados eliminados.');
          },
        },
      ],
    );
  };

  const handleClearTemplateCache = () => {
    Alert.alert(
      'Limpiar cache de formularios',
      'Se eliminaran las plantillas descargadas. Se volveran a descargar automaticamente.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpiar',
          style: 'destructive',
          onPress: () => {
            const db = getDatabase();
            db.runSync('DELETE FROM form_templates');
            refreshStorage();
            Alert.alert('Listo', 'Cache de formularios limpiada.');
          },
        },
      ],
    );
  };

  const handleResetDefaults = () => {
    Alert.alert(
      'Restaurar valores por defecto',
      'Todas las configuraciones volveran a sus valores originales.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Restaurar',
          onPress: () => {
            settings.reset();
            Alert.alert('Listo', 'Configuracion restaurada.');
          },
        },
      ],
    );
  };

  const gpsAccuracyOptions: { value: 'high' | 'balanced' | 'low'; label: string }[] = [
    { value: 'high', label: 'Alta' },
    { value: 'balanced', label: 'Media' },
    { value: 'low', label: 'Baja' },
  ];

  const syncIntervalOptions: { value: number; label: string }[] = [
    { value: 15_000, label: '15s' },
    { value: 30_000, label: '30s' },
    { value: 60_000, label: '1m' },
    { value: 300_000, label: '5m' },
  ];

  const retentionOptions: { value: number; label: string }[] = [
    { value: 3, label: '3 dias' },
    { value: 7, label: '7 dias' },
    { value: 14, label: '14 dias' },
    { value: 30, label: '30 dias' },
  ];

  const gpsTimeoutOptions: { value: number; label: string }[] = [
    { value: 10_000, label: '10s' },
    { value: 15_000, label: '15s' },
    { value: 30_000, label: '30s' },
    { value: 60_000, label: '60s' },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Servidor API */}
      <SectionHeader title="Servidor API" />
      <View style={styles.card}>
        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>URL del servidor</Text>
            <Text style={styles.settingDescription} numberOfLines={2}>
              {getEffectiveUrl()}
            </Text>
          </View>
          <View style={[styles.levelBadge, customUrl ? styles.levelBadgeCustom : styles.levelBadgeOk]}>
            <Text style={[styles.levelBadgeText, { color: customUrl ? colors.accent : colors.success }]}>
              {customUrl ? 'CUSTOM' : 'DEFAULT'}
            </Text>
          </View>
        </View>
        <View style={styles.separator} />
        {editingServer ? (
          <View>
            <TextInput
              style={styles.serverInput}
              placeholder={ENV.API_BASE_URL}
              value={serverUrlInput}
              onChangeText={setServerUrlInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
              <TouchableOpacity
                style={[styles.serverActionBtn, { backgroundColor: colors.primary }]}
                onPress={() => {
                  if (serverUrlInput.trim()) {
                    saveServerUrl(serverUrlInput.trim());
                    Alert.alert(
                      'Servidor actualizado',
                      'La URL ha sido guardada. Cierre sesion e inicie de nuevo para conectar al nuevo servidor.',
                    );
                  }
                  setEditingServer(false);
                }}
              >
                <Text style={{ color: colors.textOnPrimary, fontSize: fontSize.caption, fontWeight: '600' }}>
                  Guardar
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.serverActionBtn, { borderWidth: 1, borderColor: colors.border }]}
                onPress={() => {
                  setServerUrlInput(customUrl ?? '');
                  setEditingServer(false);
                }}
              >
                <Text style={{ color: colors.textSecondary, fontSize: fontSize.caption, fontWeight: '600' }}>
                  Cancelar
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <>
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => setEditingServer(true)}
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>Cambiar servidor</Text>
              <Text style={styles.actionIcon}>🔧</Text>
            </TouchableOpacity>
            {customUrl && (
              <>
                <View style={styles.separator} />
                <TouchableOpacity
                  style={styles.actionRow}
                  onPress={() => {
                    Alert.alert(
                      'Restaurar servidor',
                      `Se usara el servidor por defecto:\n${ENV.API_BASE_URL}`,
                      [
                        { text: 'Cancelar', style: 'cancel' },
                        {
                          text: 'Restaurar',
                          onPress: () => {
                            resetToDefault();
                            setServerUrlInput('');
                            Alert.alert('Listo', 'Cierre sesion e inicie de nuevo para conectar al servidor por defecto.');
                          },
                        },
                      ],
                    );
                  }}
                >
                  <Text style={styles.actionText}>Restaurar servidor por defecto</Text>
                  <Text style={styles.actionIcon}>↩️</Text>
                </TouchableOpacity>
              </>
            )}
          </>
        )}
      </View>

      {/* GPS */}
      <SectionHeader title="GPS y ubicacion" />
      <View style={styles.card}>
        <SettingRow
          label="Precision GPS"
          description="Alta consume mas bateria pero es mas precisa"
          right={
            <OptionSelector
              options={gpsAccuracyOptions}
              selected={settings.gpsAccuracy}
              onChange={(val) => settings.update('gpsAccuracy', val)}
            />
          }
        />
        <View style={styles.separator} />
        <SettingRow
          label="Timeout GPS"
          description="Tiempo maximo para obtener ubicacion"
          right={
            <OptionSelector
              options={gpsTimeoutOptions}
              selected={
                gpsTimeoutOptions.find((o) => o.value === settings.gpsTimeoutMs)
                  ? settings.gpsTimeoutMs
                  : 15_000
              }
              onChange={(val) => settings.update('gpsTimeoutMs', val)}
            />
          }
        />
        <View style={styles.separator} />
        <SettingRow
          label="Mostrar GPS al capturar"
          description="Ver coordenadas durante la captura"
          right={
            <Switch
              value={settings.showGpsOnCapture}
              onValueChange={(val) => settings.update('showGpsOnCapture', val)}
              trackColor={{ false: colors.border, true: colors.primary + '60' }}
              thumbColor={settings.showGpsOnCapture ? colors.primary : '#ccc'}
            />
          }
        />
      </View>

      {/* Sincronizacion */}
      <SectionHeader title="Sincronizacion" />
      <View style={styles.card}>
        <SettingRow
          label="Intervalo de sincronizacion"
          description="Cada cuanto se intenta enviar registros pendientes"
          right={
            <OptionSelector
              options={syncIntervalOptions}
              selected={
                syncIntervalOptions.find((o) => o.value === settings.syncIntervalBaseMs)
                  ? settings.syncIntervalBaseMs
                  : 30_000
              }
              onChange={(val) => settings.update('syncIntervalBaseMs', val)}
            />
          }
        />
        <View style={styles.separator} />
        <SettingRow
          label="Retencion de sincronizados"
          description="Dias que se conservan registros ya enviados"
          right={
            <OptionSelector
              options={retentionOptions}
              selected={
                retentionOptions.find((o) => o.value === settings.syncedRetentionDays)
                  ? settings.syncedRetentionDays
                  : 7
              }
              onChange={(val) => settings.update('syncedRetentionDays', val)}
            />
          }
        />
        <View style={styles.separator} />
        <SettingRow
          label="Sincronizar al guardar"
          description="Intentar enviar inmediatamente al guardar un registro"
          right={
            <Switch
              value={settings.autoSyncOnCapture}
              onValueChange={(val) => settings.update('autoSyncOnCapture', val)}
              trackColor={{ false: colors.border, true: colors.primary + '60' }}
              thumbColor={settings.autoSyncOnCapture ? colors.primary : '#ccc'}
            />
          }
        />
      </View>

      {/* Captura */}
      <SectionHeader title="Captura de datos" />
      <View style={styles.card}>
        <SettingRow
          label="Auto-guardar borradores"
          description="Guardar automaticamente mientras se llena el formulario"
          right={
            <Switch
              value={settings.autoSaveDrafts}
              onValueChange={(val) => settings.update('autoSaveDrafts', val)}
              trackColor={{ false: colors.border, true: colors.primary + '60' }}
              thumbColor={settings.autoSaveDrafts ? colors.primary : '#ccc'}
            />
          }
        />
        <View style={styles.separator} />
        <SettingRow
          label="Confirmar antes de enviar"
          description="Pedir confirmacion al guardar un registro"
          right={
            <Switch
              value={settings.confirmBeforeSubmit}
              onValueChange={(val) => settings.update('confirmBeforeSubmit', val)}
              trackColor={{ false: colors.border, true: colors.primary + '60' }}
              thumbColor={settings.confirmBeforeSubmit ? colors.primary : '#ccc'}
            />
          }
        />
      </View>

      {/* Almacenamiento */}
      <SectionHeader title="Almacenamiento" />
      <View style={styles.card}>
        {storageInfo && (
          <>
            <View style={styles.storageGrid}>
              <StorageStat label="Registros" value={storageInfo.totalRecords} />
              <StorageStat label="Pendientes" value={storageInfo.pendingRecords} color={colors.warning} />
              <StorageStat label="Enviados" value={storageInfo.syncedRecords} color={colors.success} />
              <StorageStat label="Errores" value={storageInfo.errorRecords} color={colors.error} />
              <StorageStat label="Borradores" value={storageInfo.draftRecords} color={colors.textSecondary} />
              <StorageStat label="Evidencias" value={storageInfo.totalEvidence} />
              <StorageStat label="Ev. pendientes" value={storageInfo.pendingEvidence} color={colors.warning} />
              <StorageStat label="Plantillas" value={storageInfo.templateCount} />
            </View>
            <View style={styles.separator} />
          </>
        )}
        <TouchableOpacity style={styles.actionRow} onPress={handleClearSynced}>
          <Text style={styles.actionText}>Limpiar registros sincronizados</Text>
          <Text style={styles.actionIcon}>🗑️</Text>
        </TouchableOpacity>
        <View style={styles.separator} />
        <TouchableOpacity style={styles.actionRow} onPress={handleClearTemplateCache}>
          <Text style={styles.actionText}>Limpiar cache de formularios</Text>
          <Text style={styles.actionIcon}>📋</Text>
        </TouchableOpacity>
        <View style={styles.separator} />
        <TouchableOpacity style={styles.actionRow} onPress={refreshStorage}>
          <Text style={[styles.actionText, { color: colors.primary }]}>Actualizar estadisticas</Text>
          <Text style={styles.actionIcon}>🔄</Text>
        </TouchableOpacity>
      </View>

      {/* Seguridad - PIN */}
      <SectionHeader title="Seguridad" />
      <View style={styles.card}>
        <View style={styles.actionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.settingLabel}>PIN de desbloqueo</Text>
            <Text style={styles.settingDescription}>
              {pinEnabled
                ? 'PIN configurado. Protege el acceso a la app.'
                : 'Sin PIN. Cualquiera puede abrir la app.'}
            </Text>
          </View>
          <View style={[styles.levelBadge, pinEnabled ? styles.levelBadgeOk : styles.levelBadgeError]}>
            <Text style={[styles.levelBadgeText, { color: pinEnabled ? colors.success : colors.error }]}>
              {pinEnabled ? 'ON' : 'OFF'}
            </Text>
          </View>
        </View>
        {pinEnabled && (
          <>
            <View style={styles.separator} />
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                Alert.prompt
                  ? Alert.prompt(
                      'Cambiar PIN',
                      'Ingrese su PIN actual:',
                      (currentPin) => {
                        if (!currentPin || currentPin.length < 4) return;
                        Alert.prompt(
                          'Nuevo PIN',
                          'Ingrese el nuevo PIN (4 digitos):',
                          async (newPin) => {
                            if (!newPin || newPin.length < 4) return;
                            const ok = await changePin(currentPin, newPin);
                            Alert.alert(
                              ok ? 'Listo' : 'Error',
                              ok ? 'PIN actualizado correctamente.' : 'PIN actual incorrecto.',
                            );
                          },
                          'secure-text',
                        );
                      },
                      'secure-text',
                    )
                  : Alert.alert('Cambiar PIN', 'Use la pantalla de perfil para cambiar su PIN.');
              }}
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>Cambiar PIN</Text>
              <Text style={styles.actionIcon}>🔑</Text>
            </TouchableOpacity>
            <View style={styles.separator} />
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                Alert.alert(
                  'Desactivar PIN',
                  'Al desactivar el PIN, cualquier persona podra abrir la app. ¿Desea continuar?',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Desactivar',
                      style: 'destructive',
                      onPress: () => {
                        if (Alert.prompt) {
                          Alert.prompt(
                            'Confirmar',
                            'Ingrese su PIN actual para desactivar:',
                            async (pin) => {
                              if (!pin) return;
                              const ok = await removePin(pin);
                              Alert.alert(
                                ok ? 'Listo' : 'Error',
                                ok ? 'PIN desactivado.' : 'PIN incorrecto.',
                              );
                            },
                            'secure-text',
                          );
                        } else {
                          Alert.alert('Info', 'Para desactivar el PIN, use la opcion desde la pantalla de perfil.');
                        }
                      },
                    },
                  ],
                );
              }}
            >
              <Text style={styles.actionText}>Desactivar PIN</Text>
              <Text style={styles.actionIcon}>🔓</Text>
            </TouchableOpacity>
          </>
        )}
        {!pinEnabled && (
          <>
            <View style={styles.separator} />
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                // Redirigir al setup de PIN forzando el flag en el store
                usePinStore.setState({ unlocked: false });
              }}
            >
              <Text style={[styles.actionText, { color: colors.primary }]}>Configurar PIN</Text>
              <Text style={styles.actionIcon}>🔐</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Diagnosticos */}
      <SectionHeader title="Diagnosticos" />
      <View style={styles.card}>
        <View style={styles.actionRow}>
          <Text style={[styles.settingLabel, { flex: 1 }]}>
            Errores registrados
          </Text>
          <View style={[styles.levelBadge, crashCount > 0 ? styles.levelBadgeError : styles.levelBadgeOk]}>
            <Text style={[styles.levelBadgeText, crashCount > 0 ? { color: colors.error } : { color: colors.success }]}>
              {crashCount}
            </Text>
          </View>
        </View>
        <View style={styles.separator} />
        <TouchableOpacity
          style={styles.actionRow}
          onPress={() => navigation.navigate('CrashLogs')}
        >
          <Text style={[styles.actionText, { color: colors.primary }]}>Ver registro de errores</Text>
          <Text style={styles.actionIcon}>📋</Text>
        </TouchableOpacity>
        {crashCount > 0 && (
          <>
            <View style={styles.separator} />
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => {
                Alert.alert(
                  'Limpiar logs',
                  'Se eliminaran todos los registros de errores.',
                  [
                    { text: 'Cancelar', style: 'cancel' },
                    {
                      text: 'Limpiar',
                      style: 'destructive',
                      onPress: () => {
                        clearCrashLogs();
                        setCrashCount(0);
                      },
                    },
                  ],
                );
              }}
            >
              <Text style={styles.actionText}>Limpiar logs de errores</Text>
              <Text style={styles.actionIcon}>🗑️</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Restaurar */}
      <TouchableOpacity style={styles.resetButton} onPress={handleResetDefaults}>
        <Text style={styles.resetText}>Restaurar valores por defecto</Text>
      </TouchableOpacity>

      {/* Version */}
      <Text style={styles.versionText}>InfoMatt360 Mobile v1.0.0</Text>
    </ScrollView>
  );
}

function StorageStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, color ? { color } : undefined]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  sectionHeader: {
    fontSize: fontSize.caption,
    fontWeight: '700',
    color: colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
    marginLeft: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    marginBottom: spacing.sm,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  settingRow: {
    paddingVertical: spacing.sm,
  },
  settingTextContainer: {
    marginBottom: spacing.sm,
  },
  settingLabel: {
    fontSize: fontSize.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  settingDescription: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.sm,
  },
  // Option selector
  optionRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  optionBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  optionText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  optionTextActive: {
    color: colors.textOnPrimary,
  },
  // Storage
  storageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statItem: {
    alignItems: 'center',
    minWidth: 70,
    paddingVertical: spacing.xs,
  },
  statValue: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 2,
    textAlign: 'center',
  },
  // Actions
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  actionText: {
    fontSize: fontSize.body,
    color: colors.error,
    fontWeight: '500',
  },
  actionIcon: {
    fontSize: 16,
  },
  // Reset
  resetButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    backgroundColor: colors.surface,
  },
  resetText: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  // Diagnostics badge
  levelBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    minWidth: 28,
    alignItems: 'center' as const,
  },
  levelBadgeError: {
    backgroundColor: colors.error + '15',
  },
  levelBadgeOk: {
    backgroundColor: colors.success + '15',
  },
  levelBadgeCustom: {
    backgroundColor: colors.accent + '15',
  },
  serverInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    fontSize: fontSize.caption,
    backgroundColor: colors.background,
  },
  serverActionBtn: {
    flex: 1,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center' as const,
  },
  levelBadgeText: {
    fontSize: fontSize.body,
    fontWeight: '700' as const,
  },
  // Version
  versionText: {
    fontSize: fontSize.caption,
    color: colors.disabled,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
