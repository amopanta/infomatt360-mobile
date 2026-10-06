/**
 * Pantalla de configuracion inicial de PIN.
 *
 * Se muestra tras el primer login exitoso si el usuario
 * no tiene PIN configurado. Permite establecer un PIN
 * de 4 digitos con confirmacion.
 *
 * El usuario puede omitir la configuracion.
 */

import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Vibration,
} from 'react-native';
import { usePinStore } from '../../store/pinStore';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

const PIN_LENGTH = 4;

type Step = 'create' | 'confirm';

export default function PinSetupScreen({ onComplete }: { onComplete: () => void }) {
  const setupPin = usePinStore((s) => s.setupPin);
  const [step, setStep] = useState<Step>('create');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [error, setError] = useState('');
  const shakeAnim = useRef(new Animated.Value(0)).current;

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
    const newPin = pin + digit;
    setPin(newPin);
    setError('');

    if (newPin.length >= PIN_LENGTH) {
      if (step === 'create') {
        setFirstPin(newPin);
        setStep('confirm');
        setPin('');
      } else {
        // Confirm step
        if (newPin === firstPin) {
          await setupPin(newPin);
          onComplete();
        } else {
          Vibration.vibrate(200);
          shake();
          setError('Los PINs no coinciden. Intente de nuevo.');
          setPin('');
          setStep('create');
          setFirstPin('');
        }
      }
    }
  };

  const handleDelete = () => {
    setPin((p) => p.slice(0, -1));
    setError('');
  };

  const handleSkip = () => {
    // Allow skipping PIN setup
    usePinStore.setState({ unlocked: true });
    onComplete();
  };

  const subtitle =
    step === 'create'
      ? 'Cree un PIN de 4 digitos para proteger sus datos'
      : 'Confirme su PIN';

  return (
    <View style={styles.container}>
      <View style={styles.headerSection}>
        <Text style={styles.icon}>🔐</Text>
        <Text style={styles.title}>Configurar PIN</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        <Text style={styles.description}>
          El PIN le permite acceder a la app y sus datos locales sin conexion al servidor.
        </Text>
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

      {error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <View style={styles.errorPlaceholder} />
      )}

      {/* Step indicator */}
      <View style={styles.stepRow}>
        <View style={[styles.stepDot, step === 'create' && styles.stepDotActive]} />
        <View style={[styles.stepDot, step === 'confirm' && styles.stepDotActive]} />
      </View>

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
                    disabled={pin.length === 0}
                  >
                    <Text style={[styles.numpadKeyText, { fontSize: 20 }]}>⌫</Text>
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  key={key}
                  style={styles.numpadKey}
                  onPress={() => handleDigit(key)}
                >
                  <Text style={styles.numpadKeyText}>{key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>

      {/* Skip */}
      <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
        <Text style={styles.skipText}>Omitir por ahora</Text>
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
  icon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.headline,
    fontWeight: '700',
    color: colors.textOnPrimary,
  },
  subtitle: {
    fontSize: fontSize.subtitle,
    color: colors.textOnPrimary,
    marginTop: spacing.xs,
    fontWeight: '500',
  },
  description: {
    fontSize: fontSize.caption,
    color: colors.textOnPrimary + 'AA',
    textAlign: 'center',
    marginTop: spacing.sm,
    lineHeight: 18,
    maxWidth: 280,
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
    height: 24,
    lineHeight: 24,
  },
  errorPlaceholder: {
    height: 24,
  },

  // Step indicator
  stepRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FFFFFF40',
  },
  stepDotActive: {
    backgroundColor: colors.textOnPrimary,
    width: 20,
  },

  // Numpad
  numpad: {
    marginTop: spacing.md,
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
  numpadKeyText: {
    fontSize: 28,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },

  // Skip
  skipButton: {
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  skipText: {
    fontSize: fontSize.body,
    color: colors.textOnPrimary + 'AA',
    textDecorationLine: 'underline',
  },
});
