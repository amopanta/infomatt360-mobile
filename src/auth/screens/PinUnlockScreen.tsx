/**
 * Pantalla de desbloqueo por PIN.
 *
 * Se muestra al abrir la app si el usuario tiene PIN configurado.
 * Permite desbloquear con el PIN de 4-6 digitos.
 * Tras 5 intentos fallidos, bloquea por 5 minutos.
 *
 * Si el usuario olvido tambien el PIN, puede optar por
 * cerrar sesion (conservando los datos locales pendientes)
 * o resetear el PIN si recuerda su contraseña del servidor.
 */

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Vibration,
  Animated,
  Alert,
} from 'react-native';
import { usePinStore } from '../../store/pinStore';
import { useAuthStore } from '../../store/authStore';
import { stopAutoSync } from '../../sync/syncService';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

const PIN_LENGTH = 4;

export default function PinUnlockScreen() {
  const { verifyPin, failedAttempts, locked, lockedUntil } = usePinStore();
  const logout = useAuthStore((s) => s.logout);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  // Countdown timer for lockout
  useEffect(() => {
    if (!locked || !lockedUntil) {
      setCountdown(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000));
      setCountdown(remaining);
      if (remaining <= 0) {
        usePinStore.setState({ locked: false, lockedUntil: null, failedAttempts: 0 });
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [locked, lockedUntil]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -15, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleDigit = async (digit: string) => {
    if (locked || checking) return;

    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length >= PIN_LENGTH) {
      setChecking(true);
      const ok = await verifyPin(newPin);
      if (!ok) {
        Vibration.vibrate(200);
        shake();
        const remaining = 5 - (failedAttempts + 1);
        if (remaining > 0) {
          setError(`PIN incorrecto. ${remaining} intento${remaining !== 1 ? 's' : ''} restante${remaining !== 1 ? 's' : ''}.`);
        } else {
          setError('Demasiados intentos. Bloqueado por 5 minutos.');
        }
        setPin('');
      }
      // If ok, the store sets unlocked=true and AppNavigator will react
      setChecking(false);
    }
  };

  const handleDelete = () => {
    if (locked || checking) return;
    setPin((p) => p.slice(0, -1));
    setError('');
  };

  const handleForgotPin = () => {
    Alert.alert(
      'Olvide mi PIN',
      'Puede cerrar sesion para iniciar con su contraseña del servidor. Sus registros pendientes se conservan en el dispositivo y se sincronizaran al volver a iniciar sesion.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar sesion',
          style: 'destructive',
          onPress: () => {
            stopAutoSync();
            // No borrar PIN, solo cerrar sesion
            // Al re-loguearse se le pedira configurar nuevo PIN
            logout();
          },
        },
      ],
    );
  };

  const formatCountdown = (secs: number): string => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.lockIcon}>🔒</Text>
        <Text style={styles.title}>InfoMatt360</Text>
        <Text style={styles.subtitle}>Ingrese su PIN para continuar</Text>
      </View>

      {/* PIN dots */}
      <Animated.View style={[styles.dotsRow, { transform: [{ translateX: shakeAnim }] }]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              i < pin.length && styles.dotFilled,
            ]}
          />
        ))}
      </Animated.View>

      {/* Error / lockout message */}
      {locked && countdown > 0 ? (
        <View style={styles.lockoutBanner}>
          <Text style={styles.lockoutText}>
            Bloqueado por {formatCountdown(countdown)}
          </Text>
        </View>
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <View style={styles.errorPlaceholder} />
      )}

      {/* Number pad */}
      <View style={styles.numpad}>
        {[
          ['1', '2', '3'],
          ['4', '5', '6'],
          ['7', '8', '9'],
          ['', '0', 'del'],
        ].map((row, rowIdx) => (
          <View key={rowIdx} style={styles.numpadRow}>
            {row.map((key) => {
              if (key === '') {
                return <View key="empty" style={styles.numpadKeyEmpty} />;
              }
              if (key === 'del') {
                return (
                  <TouchableOpacity
                    key="del"
                    style={styles.numpadKey}
                    onPress={handleDelete}
                    disabled={locked || pin.length === 0}
                  >
                    <Text style={[styles.numpadKeyText, { fontSize: 20 }]}>⌫</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.numpadKey, locked && styles.numpadKeyDisabled]}
                  onPress={() => handleDigit(key)}
                  disabled={locked}
                >
                  <Text style={styles.numpadKeyText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Forgot PIN */}
      <TouchableOpacity style={styles.forgotButton} onPress={handleForgotPin}>
        <Text style={styles.forgotText}>¿Olvido su PIN?</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  headerSection: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  lockIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.headline,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  subtitle: {
    fontSize: fontSize.body,
    color: colors.textOnPrimary + 'CC',
    marginTop: spacing.xs,
  },

  // Dots
  dotsRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  dot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.textOnPrimary,
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: colors.textOnPrimary,
  },

  // Error
  errorText: {
    fontSize: fontSize.caption,
    color: '#FFCDD2',
    textAlign: 'center',
    height: 32,
    lineHeight: 32,
  },
  errorPlaceholder: {
    height: 32,
  },
  lockoutBanner: {
    backgroundColor: '#FFFFFF20',
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    height: 32,
    justifyContent: 'center',
  },
  lockoutText: {
    fontSize: fontSize.caption,
    color: '#FFCDD2',
    fontWeight: '600',
    textAlign: 'center',
  },

  // Numpad
  numpad: {
    marginTop: spacing.lg,
  },
  numpadRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  numpadKey: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FFFFFF20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  numpadKeyEmpty: {
    width: 72,
    height: 72,
  },
  numpadKeyDisabled: {
    opacity: 0.3,
  },
  numpadKeyText: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },

  // Forgot
  forgotButton: {
    marginTop: spacing.xl,
    paddingVertical: spacing.sm,
  },
  forgotText: {
    fontSize: fontSize.body,
    color: colors.textOnPrimary + 'AA',
    textDecorationLine: 'underline',
  },
});
