/**
 * Genera y persiste un fingerprint unico del dispositivo.
 *
 * Se usa para:
 *   1. Asset lock (doc 91): vincular el dispositivo al gestor.
 *   2. Sesion extendida: si el fingerprint coincide con el bloqueado,
 *      el backend emite un token de 10 horas en vez de 60 minutos.
 */

import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

const FINGERPRINT_KEY = 'infomatt360_device_fingerprint';

let cached: string | null = null;

export async function getDeviceFingerprint(): Promise<string> {
  if (cached) return cached;

  // Intentar leer uno ya generado
  const stored = await SecureStore.getItemAsync(FINGERPRINT_KEY);
  if (stored) {
    cached = stored;
    return stored;
  }

  // Generar uno nuevo (UUID v4 via crypto seguro)
  const fp = Crypto.randomUUID();
  await SecureStore.setItemAsync(FINGERPRINT_KEY, fp);
  cached = fp;
  return fp;
}
