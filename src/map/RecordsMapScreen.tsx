/**
 * Mapa de registros capturados con ubicacion GPS.
 *
 * Usa Leaflet via WebView para mostrar marcadores de registros
 * geolocalizados, codificados por color segun estado:
 *   - Verde: sincronizado
 *   - Amarillo: pendiente
 *   - Rojo: error
 *   - Gris: borrador
 *
 * Al tocar un marcador se muestra un popup con info basica
 * y boton para navegar al detalle del registro.
 */

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import WebView from 'react-native-webview';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { getDatabase } from '../db/database';
import { colors, spacing, fontSize, borderRadius } from '../ui/theme';

interface MapRecord {
  local_id: string;
  template_id: number;
  status: string;
  gps_json: string;
  created_at: string;
  form_name: string | null;
  evidence_count: number;
}

interface GpsData {
  lat: number;
  lng: number;
  accuracy?: number;
}

const STATUS_COLORS: Record<string, string> = {
  draft: '#9E9E9E',
  pending: '#FF9800',
  syncing: '#2196F3',
  synced: '#4CAF50',
  error: '#F44336',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Borrador',
  pending: 'Pendiente',
  syncing: 'Enviando',
  synced: 'Sincronizado',
  error: 'Error',
};

function loadGeoRecords(): { record: MapRecord; gps: GpsData }[] {
  const db = getDatabase();
  const rows = db.getAllSync(`
    SELECT
      q.local_id, q.template_id, q.status, q.gps_json,
      q.created_at,
      ft.name as form_name,
      (SELECT COUNT(*) FROM evidence e WHERE e.record_local_id = q.local_id) as evidence_count
    FROM queued_records q
    LEFT JOIN form_templates ft ON ft.id = q.template_id
    WHERE q.gps_json IS NOT NULL AND q.gps_json != ''
    ORDER BY q.created_at DESC
    LIMIT 500
  `) as MapRecord[];

  const results: { record: MapRecord; gps: GpsData }[] = [];
  for (const rec of rows) {
    try {
      const gps: GpsData = JSON.parse(rec.gps_json);
      if (gps.lat && gps.lng) {
        results.push({ record: rec, gps });
      }
    } catch {
      // GPS invalido, omitir
    }
  }
  return results;
}

function buildMapHtml(markers: { record: MapRecord; gps: GpsData }[]): string {
  // Calcular centro del mapa
  let centerLat = 4.6;  // Colombia por defecto
  let centerLng = -74.08;
  let zoom = 6;

  if (markers.length > 0) {
    const lats = markers.map((m) => m.gps.lat);
    const lngs = markers.map((m) => m.gps.lng);
    centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    centerLng = (Math.min(...lngs) + Math.max(...lngs)) / 2;

    const latDiff = Math.max(...lats) - Math.min(...lats);
    const lngDiff = Math.max(...lngs) - Math.min(...lngs);
    const maxDiff = Math.max(latDiff, lngDiff);

    if (maxDiff < 0.01) zoom = 16;
    else if (maxDiff < 0.05) zoom = 14;
    else if (maxDiff < 0.2) zoom = 12;
    else if (maxDiff < 1) zoom = 10;
    else if (maxDiff < 5) zoom = 8;
    else zoom = 6;
  }

  const markersJs = markers
    .map((m) => {
      const color = STATUS_COLORS[m.record.status] ?? '#9E9E9E';
      const label = STATUS_LABELS[m.record.status] ?? m.record.status;
      const name = (m.record.form_name ?? `Formulario #${m.record.template_id}`).replace(/'/g, "\\'");
      const date = new Date(m.record.created_at);
      const dateStr = `${date.toLocaleDateString('es-CO')} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      const evCount = m.record.evidence_count;

      return `
        L.circleMarker([${m.gps.lat}, ${m.gps.lng}], {
          radius: 8,
          fillColor: '${color}',
          color: '#fff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.85
        }).addTo(map).bindPopup(
          '<div style="font-family:sans-serif;min-width:160px">' +
          '<b style="font-size:13px">${name}</b><br>' +
          '<span style="color:${color};font-weight:600;font-size:12px">${label}</span><br>' +
          '<span style="color:#666;font-size:11px">${dateStr}</span>' +
          ${evCount > 0 ? `'<br><span style="color:#666;font-size:11px">📎 ${evCount} evidencia${evCount !== 1 ? 's' : ''}</span>'` : "''"} +
          '<br><a href="#" onclick="window.ReactNativeWebView.postMessage(\\'${m.record.local_id}\\');return false;" ' +
          'style="color:#1976D2;font-size:12px;text-decoration:none;font-weight:600">Ver detalle →</a>' +
          '</div>'
        );`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body, #map { width: 100%; height: 100%; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map').setView([${centerLat}, ${centerLng}], ${zoom});
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
      maxZoom: 19
    }).addTo(map);
    ${markersJs}
  </script>
</body>
</html>`;
}

export default function RecordsMapScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [geoRecords, setGeoRecords] = useState<{ record: MapRecord; gps: GpsData }[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapHtml, setMapHtml] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'synced' | 'error'>('all');

  const loadData = useCallback(() => {
    setLoading(true);
    const all = loadGeoRecords();
    const filtered =
      filter === 'all'
        ? all
        : all.filter((m) => m.record.status === filter);
    setGeoRecords(filtered);
    setMapHtml(buildMapHtml(filtered));
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refrescar al volver a la pantalla
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', loadData);
    return unsubscribe;
  }, [navigation, loadData]);

  const handleMessage = (event: { nativeEvent: { data: string } }) => {
    const localId = event.nativeEvent.data;
    if (localId) {
      navigation.navigate('RecordDetail', { recordLocalId: localId });
    }
  };

  const totalRecords = loadGeoRecords().length;
  const noGpsRecords = (() => {
    const db = getDatabase();
    const row = db.getFirstSync(
      `SELECT COUNT(*) as cnt FROM queued_records WHERE gps_json IS NULL OR gps_json = ''`,
    ) as { cnt: number } | null;
    return row?.cnt ?? 0;
  })();

  const filterButtons: { key: typeof filter; label: string; color: string }[] = [
    { key: 'all', label: 'Todos', color: colors.primary },
    { key: 'pending', label: 'Pendientes', color: colors.warning },
    { key: 'synced', label: 'Enviados', color: colors.success },
    { key: 'error', label: 'Errores', color: colors.error },
  ];

  return (
    <View style={styles.container}>
      {/* Filtros */}
      <View style={styles.filters}>
        {filterButtons.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filterBtn,
              filter === f.key && { backgroundColor: f.color },
            ]}
            onPress={() => setFilter(f.key)}
          >
            <Text
              style={[
                styles.filterText,
                filter === f.key && styles.filterTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats */}
      <View style={styles.statsBar}>
        <Text style={styles.statsText}>
          📍 {geoRecords.length} en mapa
          {noGpsRecords > 0 && ` · ${noGpsRecords} sin GPS`}
        </Text>
      </View>

      {/* Mapa */}
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Cargando mapa...</Text>
        </View>
      ) : geoRecords.length === 0 ? (
        <ScrollView
          contentContainerStyle={styles.emptyContainer}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={loadData} colors={[colors.primary]} />
          }
        >
          <Text style={styles.emptyIcon}>🗺️</Text>
          <Text style={styles.emptyTitle}>Sin registros geolocalizados</Text>
          <Text style={styles.emptySubtitle}>
            {filter !== 'all'
              ? `No hay registros con estado "${STATUS_LABELS[filter] ?? filter}" que tengan ubicacion GPS.`
              : 'Capture formularios con GPS activado para verlos en el mapa.'}
          </Text>
        </ScrollView>
      ) : (
        <WebView
          originWhitelist={['*']}
          source={{ html: mapHtml }}
          style={styles.webview}
          onMessage={handleMessage}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.webviewLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          )}
        />
      )}

      {/* Leyenda */}
      {geoRecords.length > 0 && (
        <View style={styles.legend}>
          {Object.entries(STATUS_COLORS).map(([key, color]) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: color }]} />
              <Text style={styles.legendLabel}>
                {STATUS_LABELS[key] ?? key}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filters: {
    flexDirection: 'row',
    padding: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  filterBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.full,
    backgroundColor: colors.background,
  },
  filterText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  filterTextActive: {
    color: colors.textOnPrimary,
  },
  statsBar: {
    backgroundColor: colors.surface,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statsText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  webview: {
    flex: 1,
  },
  webviewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  emptyTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#fff',
  },
  legendLabel: {
    fontSize: 10,
    color: colors.textSecondary,
  },
});
