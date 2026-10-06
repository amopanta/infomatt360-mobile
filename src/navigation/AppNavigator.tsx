/**
 * Navegacion principal de InfoMatt360 Mobile.
 *
 * Flujo:
 *   1. Login → (MFA si aplica)
 *   2. Seleccion de proyecto (si hay multiples)
 *   3. Tab navigator: Formularios | Borradores | Sincronizacion | Perfil
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import LoginScreen from '../auth/screens/LoginScreen';
import ProjectSelectScreen from '../auth/screens/ProjectSelectScreen';
import ProfileScreen from '../auth/screens/ProfileScreen';
import SettingsScreen from '../auth/screens/SettingsScreen';
import PinUnlockScreen from '../auth/screens/PinUnlockScreen';
import PinSetupScreen from '../auth/screens/PinSetupScreen';
import { usePinStore } from '../store/pinStore';
import CrashLogScreen from '../screens/CrashLogScreen';
import StatsScreen from '../screens/StatsScreen';
import DocumentScannerScreen from '../scanner/DocumentScannerScreen';
import FormListScreen from '../forms/screens/FormListScreen';
import FormCaptureScreen from '../forms/screens/FormCaptureScreen';
import DraftsScreen from '../forms/screens/DraftsScreen';
import EvidenceCaptureScreen from '../evidence/screens/EvidenceCaptureScreen';
import EvidenceViewerScreen from '../evidence/screens/EvidenceViewerScreen';
import FormEditScreen from '../forms/screens/FormEditScreen';
import RecordDetailScreen from '../forms/screens/RecordDetailScreen';
import RecordsMapScreen from '../map/RecordsMapScreen';
import SyncStatusScreen from '../sync/SyncStatusScreen';
import ConflictResolutionScreen from '../sync/ConflictResolutionScreen';
import ExportScreen from '../sync/ExportScreen';
import OfflineBanner from '../ui/OfflineBanner';
import { useAuthStore } from '../store/authStore';
import { getPendingCount } from '../db/database';
import { onSyncStatusChange } from '../sync/syncService';
import { colors, fontSize } from '../ui/theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// ── Icono simple con texto ───────────────────────────────────────────

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Formularios: '📋',
    Borradores: '📂',
    Mapa: '🗺️',
    Sync: '🔄',
    Perfil: '👤',
  };
  return (
    <View style={{ alignItems: 'center' }}>
      <Text style={{ fontSize: 20 }}>{icons[label] ?? '📄'}</Text>
      <Text
        style={{
          fontSize: fontSize.caption - 2,
          color: focused ? colors.primary : colors.textSecondary,
          fontWeight: focused ? '600' : '400',
        }}
      >
        {label}
      </Text>
    </View>
  );
}

// ── Tabs principales ─────────────────────────────────────────────────

function SyncBadge() {
  const [count, setCount] = useState(getPendingCount());
  useEffect(() => {
    const unsub = onSyncStatusChange(() => setCount(getPendingCount()));
    return unsub;
  }, []);
  if (count === 0) return null;
  return (
    <View
      style={{
        position: 'absolute',
        top: -2,
        right: -10,
        backgroundColor: colors.warning,
        borderRadius: 8,
        minWidth: 16,
        height: 16,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 3,
      }}
    >
      <Text style={{ color: '#FFF', fontSize: 10, fontWeight: '700' }}>
        {count > 99 ? '99+' : count}
      </Text>
    </View>
  );
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarShowLabel: false,
        tabBarStyle: {
          height: 60,
          paddingBottom: 6,
          paddingTop: 6,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textOnPrimary,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="FormsTab"
        component={FormsStack}
        options={{
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Formularios" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="DraftsTab"
        component={DraftsStack}
        options={{
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Borradores" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="MapTab"
        component={MapStack}
        options={{
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Mapa" focused={focused} />
          ),
        }}
      />
      <Tab.Screen
        name="SyncTab"
        component={SyncStack}
        options={{
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <View>
              <TabIcon label="Sync" focused={focused} />
              <SyncBadge />
            </View>
          ),
        }}
      />
      <Tab.Screen
        name="ProfileTab"
        component={ProfileStack}
        options={{
          headerShown: false,
          tabBarIcon: ({ focused }) => (
            <TabIcon label="Perfil" focused={focused} />
          ),
        }}
      />
    </Tab.Navigator>
  );
}

// ── Stack de formularios ─────────────────────────────────────────────

function FormsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textOnPrimary,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="FormList"
        component={FormListScreen}
        options={{ title: 'Formularios' }}
      />
      <Stack.Screen
        name="FormCapture"
        component={FormCaptureScreen}
        options={{ title: 'Captura' }}
      />
      <Stack.Screen
        name="RecordDetail"
        component={RecordDetailScreen}
        options={{ title: 'Detalle de registro' }}
      />
      <Stack.Screen
        name="EvidenceCapture"
        component={EvidenceCaptureScreen}
        options={{ title: 'Evidencias' }}
      />
      <Stack.Screen
        name="EvidenceViewer"
        component={EvidenceViewerScreen}
        options={{
          title: '',
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="DocumentScanner"
        component={DocumentScannerScreen}
        options={{ title: 'Escanear documento' }}
      />
    </Stack.Navigator>
  );
}

// ── Stack de borradores ──────────────────────────────────────────────

function DraftsStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textOnPrimary,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="DraftsList"
        component={DraftsScreen}
        options={{ title: 'Borradores' }}
      />
      <Stack.Screen
        name="FormEdit"
        component={FormEditScreen}
        options={{ title: 'Editar borrador' }}
      />
      <Stack.Screen
        name="RecordDetail"
        component={RecordDetailScreen}
        options={{ title: 'Detalle de registro' }}
      />
      <Stack.Screen
        name="EvidenceCapture"
        component={EvidenceCaptureScreen}
        options={{ title: 'Evidencias' }}
      />
      <Stack.Screen
        name="EvidenceViewer"
        component={EvidenceViewerScreen}
        options={{
          title: '',
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="DocumentScanner"
        component={DocumentScannerScreen}
        options={{ title: 'Escanear documento' }}
      />
    </Stack.Navigator>
  );
}

// ── Stack de mapa ───────────────────────────────────────────────────

function MapStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textOnPrimary,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="RecordsMap"
        component={RecordsMapScreen}
        options={{ title: 'Mapa de registros' }}
      />
      <Stack.Screen
        name="RecordDetail"
        component={RecordDetailScreen}
        options={{ title: 'Detalle de registro' }}
      />
      <Stack.Screen
        name="EvidenceCapture"
        component={EvidenceCaptureScreen}
        options={{ title: 'Evidencias' }}
      />
      <Stack.Screen
        name="EvidenceViewer"
        component={EvidenceViewerScreen}
        options={{
          title: '',
          headerShown: false,
          animation: 'fade',
        }}
      />
      <Stack.Screen
        name="DocumentScanner"
        component={DocumentScannerScreen}
        options={{ title: 'Escanear documento' }}
      />
    </Stack.Navigator>
  );
}

// ── Stack de sincronizacion ─────────────────────────────────────────

function SyncStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textOnPrimary,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="SyncStatus"
        component={SyncStatusScreen}
        options={{ title: 'Sincronizacion' }}
      />
      <Stack.Screen
        name="ConflictResolution"
        component={ConflictResolutionScreen}
        options={{ title: 'Resolver conflictos' }}
      />
      <Stack.Screen
        name="Export"
        component={ExportScreen}
        options={{ title: 'Exportar datos' }}
      />
    </Stack.Navigator>
  );
}

// ── Stack de perfil ────────────────────────────────────────────────

function ProfileStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: colors.textOnPrimary,
        headerTitleStyle: { fontWeight: '600' },
      }}
    >
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Perfil' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: 'Configuracion' }}
      />
      <Stack.Screen
        name="CrashLogs"
        component={CrashLogScreen}
        options={{ title: 'Registro de errores' }}
      />
      <Stack.Screen
        name="Stats"
        component={StatsScreen}
        options={{ title: 'Estadisticas' }}
      />
    </Stack.Navigator>
  );
}

// ── Navegacion raiz ──────────────────────────────────────────────────

export default function AppNavigator() {
  const { accessToken, session, activeProjectId, hydrate } = useAuthStore();
  const { pinEnabled, unlocked, hydrate: hydratePin } = usePinStore();
  const [loading, setLoading] = useState(true);
  const [showPinSetup, setShowPinSetup] = useState(false);

  useEffect(() => {
    Promise.all([hydrate(), hydratePin()]).finally(() => setLoading(false));
  }, [hydrate, hydratePin]);

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text
          style={{
            marginTop: 12,
            color: colors.textSecondary,
            fontSize: fontSize.body,
          }}
        >
          Cargando...
        </Text>
      </View>
    );
  }

  const isLoggedIn = !!accessToken;
  const hasSession = !!session;
  const needsProjectSelect =
    hasSession && session.projects.length > 1 && !activeProjectId;

  // PIN gate: si esta logueado, tiene PIN habilitado y no ha desbloqueado
  const needsPinUnlock = isLoggedIn && pinEnabled && !unlocked;
  // Ofrecer configurar PIN tras primer login si no tiene PIN
  const shouldOfferPinSetup = isLoggedIn && !pinEnabled && !unlocked && showPinSetup;

  // Mostrar pin setup despues de login exitoso
  useEffect(() => {
    if (isLoggedIn && !pinEnabled && !unlocked) {
      setShowPinSetup(true);
    }
  }, [isLoggedIn, pinEnabled, unlocked]);

  return (
    <NavigationContainer>
      <View style={{ flex: 1 }}>
        {isLoggedIn && !needsPinUnlock && !shouldOfferPinSetup && <OfflineBanner />}
        {needsPinUnlock ? (
          <PinUnlockScreen />
        ) : shouldOfferPinSetup ? (
          <PinSetupScreen onComplete={() => setShowPinSetup(false)} />
        ) : (
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            {!isLoggedIn ? (
              <Stack.Screen name="Login" component={LoginScreen} />
            ) : needsProjectSelect ? (
              <Stack.Screen name="ProjectSelect" component={ProjectSelectScreen} />
            ) : (
              <Stack.Screen name="Main" component={MainTabs} />
            )}
          </Stack.Navigator>
        )}
      </View>
    </NavigationContainer>
  );
}
