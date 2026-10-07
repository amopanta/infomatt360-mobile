/**
 * Pantalla de inicio de sesion.
 *
 * - Mismo usuario que web y escritorio (principio arquitectonico).
 * - Envia device_fingerprint para asset lock y sesion extendida (doc 91).
 * - Maneja flujo MFA si el usuario lo tiene activo.
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { login, verifyMfa, getSession } from '../../api/authApi';
import { useAuthStore } from '../../store/authStore';
import { useServerStore } from '../../store/serverStore';
import { ENV } from '../../config/env';
import { getDeviceFingerprint } from '../../utils/deviceFingerprint';
import { startAutoSync } from '../../sync/syncService';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [showServerConfig, setShowServerConfig] = useState(false);
  const [serverUrl, setServerUrl] = useState('');

  // Estado MFA
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [totpCode, setTotpCode] = useState('');

  const { setTokens, setSession } = useAuthStore();
  const { customUrl, setServerUrl: saveServerUrl, resetToDefault } = useServerStore();

  // Cargar URL actual al montar
  useEffect(() => {
    setServerUrl(customUrl ?? '');
  }, [customUrl]);

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Ingrese correo y contrasena');
      return;
    }

    setLoading(true);
    try {
      const fingerprint = await getDeviceFingerprint();

      const result = await login({
        email: email.trim(),
        password,
        organization_slug: orgSlug.trim() || undefined,
        device_fingerprint: fingerprint,
      });

      // Si requiere MFA, mostrar campo TOTP
      if (result.mfa_required && result.mfa_token) {
        setMfaToken(result.mfa_token);
        setMfaRequired(true);
        setLoading(false);
        return;
      }

      // Login exitoso
      await completeLogin(result.access_token, result.refresh_token);
    } catch (err: any) {
      const msg =
        err.response?.data?.detail ?? err.message ?? 'Error de conexion';
      Alert.alert('Error de acceso', String(msg));
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async () => {
    if (totpCode.length !== 6) {
      Alert.alert('Error', 'Ingrese el codigo de 6 digitos');
      return;
    }

    setLoading(true);
    try {
      const fingerprint = await getDeviceFingerprint();
      const result = await verifyMfa({
        mfa_token: mfaToken,
        totp_code: totpCode,
        device_fingerprint: fingerprint,
      });
      await completeLogin(result.access_token, result.refresh_token);
    } catch (err: any) {
      const msg = err.response?.data?.detail ?? 'Codigo incorrecto';
      Alert.alert('Error MFA', String(msg));
    } finally {
      setLoading(false);
    }
  };

  const completeLogin = async (accessToken: string, refreshToken: string) => {
    setTokens(accessToken, refreshToken);
    const session = await getSession();
    setSession(session);
    startAutoSync();
  };

  // ── Formulario MFA ──────────────────────────────────────────────

  if (mfaRequired) {
    return (
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Verificacion MFA</Text>
          <Text style={styles.subtitle}>
            Ingrese el codigo de su aplicacion de autenticacion
          </Text>
          <TextInput
            style={styles.input}
            placeholder="000000"
            value={totpCode}
            onChangeText={setTotpCode}
            keyboardType="number-pad"
            maxLength={6}
            autoFocus
          />
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleMfaVerify}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.buttonText}>Verificar</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Formulario principal ────────────────────────────────────────

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.card}>
          <Text style={styles.title}>InfoMatt360</Text>
          <Text style={styles.subtitle}>Aplicacion de Campo</Text>

          {/* Indicador del servidor actual */}
          <TouchableOpacity
            style={styles.serverIndicator}
            onPress={() => setShowServerConfig(!showServerConfig)}
          >
            <Text style={styles.serverIndicatorLabel}>
              Servidor: {customUrl ? 'Personalizado' : 'Por defecto'}
            </Text>
            <Text style={styles.serverIndicatorIcon}>
              {showServerConfig ? '▲' : '▼'}
            </Text>
          </TouchableOpacity>

          {/* Panel de configuracion del servidor */}
          {showServerConfig && (
            <View style={styles.serverPanel}>
              <Text style={styles.serverPanelLabel}>URL del servidor</Text>
              <TextInput
                style={styles.input}
                placeholder={ENV.API_BASE_URL}
                value={serverUrl}
                onChangeText={setServerUrl}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
              <View style={styles.serverActions}>
                <TouchableOpacity
                  style={styles.serverBtn}
                  onPress={() => {
                    if (serverUrl.trim()) {
                      saveServerUrl(serverUrl.trim());
                      Alert.alert('Servidor actualizado', 'La URL del servidor ha sido guardada.');
                    }
                    setShowServerConfig(false);
                  }}
                >
                  <Text style={styles.serverBtnText}>Guardar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.serverBtn, styles.serverBtnSecondary]}
                  onPress={() => {
                    resetToDefault();
                    setServerUrl('');
                    setShowServerConfig(false);
                    Alert.alert('Servidor restaurado', 'Se usara el servidor por defecto.');
                  }}
                >
                  <Text style={styles.serverBtnSecondaryText}>Usar defecto</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.serverHint}>
                Ejemplo: https://miservidor.com/api/v1
              </Text>
            </View>
          )}

          <TextInput
            style={styles.input}
            placeholder="Organizacion (opcional)"
            value={orgSlug}
            onChangeText={setOrgSlug}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder="Correo electronico"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <TextInput
            style={styles.input}
            placeholder="Contrasena"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <Text style={styles.buttonText}>Iniciar Sesion</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: borderRadius.lg,
    padding: spacing.lg,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  title: {
    fontSize: fontSize.headline,
    fontWeight: '700',
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: fontSize.subtitle,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.body,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
  buttonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
  },
  // Server config
  serverIndicator: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  serverIndicatorLabel: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  serverIndicatorIcon: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  serverPanel: {
    backgroundColor: colors.background,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  serverPanelLabel: {
    fontSize: fontSize.caption,
    fontWeight: '600',
    color: colors.primary,
    marginBottom: spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  serverActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  serverBtn: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  serverBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  serverBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.border,
  },
  serverBtnSecondaryText: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
    fontWeight: '600',
  },
  serverHint: {
    fontSize: 10,
    color: colors.textSecondary,
    fontStyle: 'italic',
  },
});
