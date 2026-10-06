/**
 * Store de PIN de desbloqueo local (Zustand).
 *
 * Permite al usuario configurar un PIN de 4-6 digitos para
 * acceder a la app sin conexion y sin perder sus datos locales
 * aunque olvide la contraseña del servidor.
 *
 * El PIN se almacena como hash SHA-256 en SecureStore.
 * No reemplaza la autenticacion del backend; es una capa
 * de proteccion local para los datos offline.
 */

import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const PIN_HASH_KEY = 'infomatt360_pin_hash';
const PIN_ENABLED_KEY = 'infomatt360_pin_enabled';
const PIN_ATTEMPTS_KEY = 'infomatt360_pin_attempts';
const MAX_ATTEMPTS = 5;

interface PinState {
  /** PIN esta configurado */
  pinEnabled: boolean;
  /** App esta desbloqueada en esta sesion */
  unlocked: boolean;
  /** Intentos fallidos acumulados */
  failedAttempts: number;
  /** Bloqueado por exceder intentos */
  locked: boolean;
  /** Timestamp hasta cuando esta bloqueado */
  lockedUntil: number | null;

  // Acciones
  hydrate: () => Promise<void>;
  setupPin: (pin: string) => Promise<void>;
  verifyPin: (pin: string) => Promise<boolean>;
  changePin: (currentPin: string, newPin: string) => Promise<boolean>;
  removePin: (pin: string) => Promise<boolean>;
  unlock: () => void;
}

async function hashPin(pin: string): Promise<string> {
  // Salt fijo por dispositivo para evitar ataques de diccionario basicos
  const salt = 'infomatt360_pin_salt_v1';
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    salt + pin,
  );
}

export const usePinStore = create<PinState>((set, get) => ({
  pinEnabled: false,
  unlocked: false,
  failedAttempts: 0,
  locked: false,
  lockedUntil: null,

  hydrate: async () => {
    try {
      const [enabled, attemptsStr] = await Promise.all([
        SecureStore.getItemAsync(PIN_ENABLED_KEY),
        SecureStore.getItemAsync(PIN_ATTEMPTS_KEY),
      ]);
      const attempts = attemptsStr ? Number(attemptsStr) : 0;
      set({
        pinEnabled: enabled === 'true',
        failedAttempts: attempts,
        locked: attempts >= MAX_ATTEMPTS,
      });
    } catch {
      // SecureStore no disponible
    }
  },

  setupPin: async (pin: string) => {
    const hash = await hashPin(pin);
    await SecureStore.setItemAsync(PIN_HASH_KEY, hash);
    await SecureStore.setItemAsync(PIN_ENABLED_KEY, 'true');
    await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, '0');
    set({
      pinEnabled: true,
      unlocked: true,
      failedAttempts: 0,
      locked: false,
      lockedUntil: null,
    });
  },

  verifyPin: async (pin: string) => {
    const { failedAttempts, lockedUntil } = get();

    // Verificar si sigue bloqueado por tiempo
    if (lockedUntil && Date.now() < lockedUntil) {
      return false;
    }

    // Si estaba bloqueado pero ya paso el tiempo, desbloquear
    if (lockedUntil && Date.now() >= lockedUntil) {
      set({ locked: false, lockedUntil: null, failedAttempts: 0 });
      await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, '0');
    }

    const stored = await SecureStore.getItemAsync(PIN_HASH_KEY);
    if (!stored) return false;

    const hash = await hashPin(pin);

    if (hash === stored) {
      // PIN correcto: resetear intentos
      set({ unlocked: true, failedAttempts: 0, locked: false, lockedUntil: null });
      await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, '0');
      return true;
    }

    // PIN incorrecto
    const newAttempts = failedAttempts + 1;
    await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, String(newAttempts));

    if (newAttempts >= MAX_ATTEMPTS) {
      // Bloquear por 5 minutos
      const until = Date.now() + 5 * 60 * 1000;
      set({
        failedAttempts: newAttempts,
        locked: true,
        lockedUntil: until,
      });
    } else {
      set({ failedAttempts: newAttempts });
    }

    return false;
  },

  changePin: async (currentPin: string, newPin: string) => {
    const stored = await SecureStore.getItemAsync(PIN_HASH_KEY);
    if (!stored) return false;

    const currentHash = await hashPin(currentPin);
    if (currentHash !== stored) return false;

    const newHash = await hashPin(newPin);
    await SecureStore.setItemAsync(PIN_HASH_KEY, newHash);
    return true;
  },

  removePin: async (pin: string) => {
    const stored = await SecureStore.getItemAsync(PIN_HASH_KEY);
    if (!stored) return false;

    const hash = await hashPin(pin);
    if (hash !== stored) return false;

    await SecureStore.deleteItemAsync(PIN_HASH_KEY);
    await SecureStore.setItemAsync(PIN_ENABLED_KEY, 'false');
    await SecureStore.setItemAsync(PIN_ATTEMPTS_KEY, '0');
    set({
      pinEnabled: false,
      unlocked: true,
      failedAttempts: 0,
      locked: false,
      lockedUntil: null,
    });
    return true;
  },

  unlock: () => {
    set({ unlocked: true });
  },
}));
