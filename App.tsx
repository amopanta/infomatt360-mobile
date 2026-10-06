/**
 * Punto de entrada de InfoMatt360 Mobile.
 *
 * Inicializa:
 *   - SafeAreaProvider para manejo de notch/islands
 *   - QueryClientProvider para cache de requests
 *   - Monitoreo de conectividad
 *   - Navegacion principal
 */

import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AppNavigator from './src/navigation/AppNavigator';
import ErrorBoundary from './src/ui/ErrorBoundary';
import { initCrashLogger } from './src/utils/crashLogger';
import { useConnectivityStore } from './src/store/connectivityStore';

// Inicializar crash logger lo antes posible
initCrashLogger();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 2,
      staleTime: 5 * 60_000, // 5 minutos
    },
  },
});

export default function App() {
  const startMonitoring = useConnectivityStore((s) => s.startMonitoring);
  const stopMonitoring = useConnectivityStore((s) => s.stopMonitoring);

  useEffect(() => {
    startMonitoring();
    return () => stopMonitoring();
  }, [startMonitoring, stopMonitoring]);

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <AppNavigator />
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
