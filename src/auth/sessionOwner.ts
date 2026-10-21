/**
 * Dueño de los datos locales y vigencia de la sesión sin conexión (H07).
 *
 * - Cada usuario usa su propia base (database.ts: setDatabaseOwner). El id
 *   sale del token (`sub`), así se conoce también sin red.
 * - La base de antes de esta versión (infomatt360.db) queda para el primer
 *   usuario que entra después de actualizar: en equipos de un solo gestor
 *   conserva todo lo que ya había capturado.
 * - Sin validar la sesión en línea por más de OFFLINE_SESSION_DAYS días se
 *   pide iniciar sesión de nuevo (los datos no se borran).
 */

import * as SecureStore from 'expo-secure-store';
import { setDatabaseOwner, unsentCountForUser } from '../db/database';
import { userIdFromToken } from './jwt';

export const OFFLINE_SESSION_DAYS = 15;

const LEGACY_OWNER_KEY = 'db_legacy_owner';
const OWNERS_KEY = 'db_owners';
const LAST_ONLINE_KEY = 'last_online_auth_at';

let legacyOwner: string | null = null;
let owners: string[] = [];
let lastOnlineAuthAt: number | null = null;
let hydrated = false;

export async function hydrateOwnership(): Promise<void> {
  if (hydrated) return;
  try {
    const [legacy, list, last] = await Promise.all([
      SecureStore.getItemAsync(LEGACY_OWNER_KEY),
      SecureStore.getItemAsync(OWNERS_KEY),
      SecureStore.getItemAsync(LAST_ONLINE_KEY),
    ]);
    legacyOwner = legacy || null;
    owners = list ? (JSON.parse(list) as string[]) : [];
    lastOnlineAuthAt = last ? Number(last) : null;
  } catch {
    // SecureStore no disponible: se trabaja con valores por defecto
  }
  hydrated = true;
}

/** Activa la base del usuario del token. Sin token válido, la del equipo. */
export function activateUserFromToken(accessToken: string | null): string | null {
  const userId = accessToken ? userIdFromToken(accessToken) : null;
  if (!userId) {
    setDatabaseOwner(null);
    return null;
  }
  if (!legacyOwner) {
    legacyOwner = userId;
    SecureStore.setItemAsync(LEGACY_OWNER_KEY, userId).catch(() => {});
  }
  if (!owners.includes(userId)) {
    owners = [...owners, userId];
    SecureStore.setItemAsync(OWNERS_KEY, JSON.stringify(owners)).catch(() => {});
  }
  setDatabaseOwner({ userId, useLegacyFile: legacyOwner === userId });
  return userId;
}

export function deactivateUser(): void {
  setDatabaseOwner(null);
}

/** Registros sin enviar de otras personas en este equipo (solo el número). */
export function unsentFromOtherUsers(currentUserId: string): number {
  return owners
    .filter((id) => id !== currentUserId)
    .reduce((sum, id) => sum + unsentCountForUser(id, legacyOwner === id), 0);
}

/** Se llama cada vez que el servidor emite tokens (login o renovación). */
export function noteOnlineAuth(): void {
  lastOnlineAuthAt = Date.now();
  SecureStore.setItemAsync(LAST_ONLINE_KEY, String(lastOnlineAuthAt)).catch(() => {});
}

/** ¿La sesión guardada sigue vigente para trabajar sin conexión? */
export function offlineSessionValid(now = Date.now()): boolean {
  // Instalaciones anteriores sin fecha: se da por válida y se fija ahora.
  if (lastOnlineAuthAt === null) { noteOnlineAuth(); return true; }
  return now - lastOnlineAuthAt <= OFFLINE_SESSION_DAYS * 86_400_000;
}
