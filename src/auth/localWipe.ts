/**
 * Borra los datos del usuario activo en este equipo (H07): su base local,
 * sus evidencias y su sesión. Lo usan el borrado remoto pedido por un
 * administrador y "Cerrar sesión y borrar mis datos" en equipos compartidos.
 * Los datos de otros usuarios del equipo no se tocan.
 */

import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import api from '../api/client';
import { getDeviceFingerprint } from '../utils/deviceFingerprint';
import { deleteActiveUserDatabase } from '../db/database';
import { stopDeviceMonitor } from '../monitoring/deviceMonitor';
import { useAuthStore } from '../store/authStore';
import { stopAutoSync, syncNow } from '../sync/syncService';

export async function wipeLocalUserData(): Promise<void> {
  stopAutoSync();
  stopDeviceMonitor();
  const files = deleteActiveUserDatabase();
  for (const uri of files) await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
  useAuthStore.getState().logout();
}

let wiping = false;

/**
 * Borrado remoto pedido por un administrador (Equipos de campo en la web).
 * Primero intenta enviar lo pendiente, para no perder capturas de una tablet
 * reasignada; luego confirma al servidor (aún con sesión) y borra.
 */
export async function runRemoteWipe(): Promise<void> {
  if (wiping) return;
  wiping = true;
  try {
    await syncNow().catch(() => true);
    await api.post('/field-devices/wipe-ack', { device_id: await getDeviceFingerprint() }).catch(() => {});
    await wipeLocalUserData();
    Alert.alert('Datos borrados', 'Un administrador pidió borrar sus datos de este equipo. Inicie sesión de nuevo para seguir trabajando.');
  } finally {
    wiping = false;
  }
}
