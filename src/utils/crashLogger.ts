/**
 * Logger local de errores y crashes.
 *
 * Captura errores no controlados a nivel global y los almacena
 * en SQLite para revision posterior. Funciona completamente
 * offline sin dependencias de servicios externos.
 *
 * Cuando se configure Sentry o similar, este logger puede
 * actuar como fallback offline.
 *
 * Uso:
 *   - initCrashLogger() al inicio de la app
 *   - logError() para errores capturados manualmente
 *   - logWarning() para advertencias
 */

import { insertCrashLog } from '../db/database';

let initialized = false;

/**
 * Inicializa el crash logger global.
 * Captura errores no controlados y promesas rechazadas.
 */
export function initCrashLogger(): void {
  if (initialized) return;
  initialized = true;

  // Capturar errores globales no controlados
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    try {
      insertCrashLog({
        level: isFatal ? 'fatal' : 'error',
        message: error.message || 'Error desconocido',
        stack: error.stack,
        component: 'GlobalHandler',
        extra: { isFatal },
      });
    } catch {
      // No propagamos errores del logger
    }

    // Llamar al handler original para que React Native muestre el error
    if (originalHandler) {
      originalHandler(error, isFatal);
    }
  });

  // Capturar promesas rechazadas no controladas
  const g = globalThis as any;
  if (g != null) {
    const originalRejectionHandler = g.onunhandledrejection;
    g.onunhandledrejection = (event: any) => {
      try {
        const reason = event?.reason;
        insertCrashLog({
          level: 'error',
          message: reason?.message || String(reason) || 'Promesa rechazada sin motivo',
          stack: reason?.stack,
          component: 'UnhandledRejection',
        });
      } catch {
        // No propagamos errores del logger
      }
      if (originalRejectionHandler) {
        originalRejectionHandler(event);
      }
    };
  }
}

/**
 * Registra un error capturado manualmente.
 */
export function logError(
  error: Error | string,
  component?: string,
  extra?: Record<string, unknown>,
): void {
  try {
    const message = typeof error === 'string' ? error : error.message;
    const stack = typeof error === 'string' ? undefined : error.stack;
    insertCrashLog({ level: 'error', message, stack, component, extra });
  } catch {
    // Silenciar errores del logger
  }
}

/**
 * Registra una advertencia.
 */
export function logWarning(
  message: string,
  component?: string,
  extra?: Record<string, unknown>,
): void {
  try {
    insertCrashLog({ level: 'warning', message, component, extra });
  } catch {
    // Silenciar errores del logger
  }
}
