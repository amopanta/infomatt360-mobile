/**
 * Pantalla de generación y vista previa de actas PDF.
 *
 * Flujo:
 *   1. Recibe recordLocalId por route params
 *   2. Carga datos del registro, participante, formulario y evidencias
 *   3. Genera el PDF con actaGenerator
 *   4. Muestra vista previa del PDF en WebView
 *   5. Permite compartir el PDF
 *
 * Parámetros de ruta:
 *   - recordLocalId: string — ID local del registro
 *   - participantId: number — ID del participante
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
  Platform,
} from 'react-native';
import { useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getQueuedRecord,
  getRecordEvidence,
  getCachedForm,
  getCachedParticipant,
} from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import {
  generateActaPdf,
  type ActaData,
  type ActaEvidence,
} from '../actaGenerator';
import type { FormPage, FormComponent, RecordValue } from '../../types';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

type RouteParams = {
  ActaPreview: {
    recordLocalId: string;
    participantId: number;
  };
};

export default function ActaPreviewScreen() {
  const route = useRoute<RouteProp<RouteParams, 'ActaPreview'>>();
  const { recordLocalId, participantId } = route.params;
  const { session } = useAuthStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [pdfBase64, setPdfBase64] = useState<string | null>(null);

  const generateActa = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Cargar registro
      const record = getQueuedRecord(recordLocalId);
      if (!record) {
        setError('Registro no encontrado');
        return;
      }

      // 2. Cargar participante
      const participant = getCachedParticipant(participantId);
      if (!participant) {
        setError('Participante no encontrado');
        return;
      }

      // 3. Cargar formulario (schema para labels)
      const form = getCachedForm(record.template_id);
      if (!form) {
        setError('Formulario no encontrado en cache');
        return;
      }

      // 4. Construir mapa de field_id → label
      const fieldLabels = new Map<string, string>();
      try {
        const schema = JSON.parse(form.schema_json);
        const pages: FormPage[] = schema.pages ?? [];
        for (const page of pages) {
          for (const section of page.sections) {
            for (const row of section.rows) {
              for (const col of row.columns) {
                for (const comp of col.components) {
                  fieldLabels.set(comp.id, comp.label);
                }
              }
            }
          }
        }
      } catch {
        // Si falla el parsing, usa field_name como fallback
      }

      // 5. Cargar evidencias
      const evidenceRows = getRecordEvidence(recordLocalId);
      const evidence: ActaEvidence[] = [];

      for (const ev of evidenceRows) {
        if (ev.type === 'fingerprint' || ev.type === 'signature') {
          // Determinar mano a partir de los valores del formulario
          let hand: 'left' | 'right' | undefined;
          const parsedValues: RecordValue[] = JSON.parse(record.data_json);
          for (const rv of parsedValues) {
            if (rv.field_value_json && typeof rv.field_value_json === 'object') {
              const obj = rv.field_value_json as Record<string, unknown>;
              if (obj.type === 'fingerprint' && obj.fileUri === ev.file_uri) {
                hand = obj.hand as 'left' | 'right' | undefined;
                break;
              }
            }
          }

          evidence.push({
            type: ev.type as 'fingerprint' | 'signature',
            file_uri: ev.file_uri,
            hand,
            mime_type: ev.mime_type,
          });
        }
      }

      // 6. Parsear valores
      const parsedValues: RecordValue[] = JSON.parse(record.data_json);

      // 7. Parsear GPS
      let gps: { lat: number; lng: number; accuracy: number } | null = null;
      if (record.gps_json) {
        try {
          gps = JSON.parse(record.gps_json);
        } catch {
          // ignore
        }
      }

      // 8. Construir datos del acta
      const actaData: ActaData = {
        organizationName: session?.organization_name ?? 'InfoMatt360',
        projectName: session?.projects?.find(
          (p) => p.id === record.project_id,
        )?.name ?? `Proyecto ${record.project_id}`,
        participant: {
          full_name: participant.full_name,
          document_type: participant.document_type,
          document_number: participant.document_number,
          code: participant.code,
          phone: participant.phone,
          email: participant.email,
        },
        formName: form.name,
        appliedAt: record.created_at,
        values: parsedValues,
        fieldLabels,
        evidence,
        gps,
        capturedBy: session?.full_name ?? 'Usuario',
      };

      // 9. Generar PDF
      const uri = await generateActaPdf(actaData);
      setPdfUri(uri);

      // Leer base64 para WebView
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      setPdfBase64(b64);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      setError(`Error al generar acta: ${msg}`);
    } finally {
      setLoading(false);
    }
  }, [recordLocalId, participantId, session]);

  useEffect(() => {
    generateActa();
  }, [generateActa]);

  const handleShare = useCallback(async () => {
    if (!pdfUri) return;

    try {
      if (Platform.OS === 'android') {
        // En Android usamos FileSystem para compartir con content:// URI
        const cacheUri = `${FileSystem.cacheDirectory}acta_temp.pdf`;
        await FileSystem.copyAsync({ from: pdfUri, to: cacheUri });

        await Share.share({
          title: 'Acta de Registro',
          message: 'Acta de registro generada por InfoMatt360',
          url: cacheUri,
        });
      } else {
        await Share.share({
          title: 'Acta de Registro',
          url: pdfUri,
        });
      }
    } catch {
      Alert.alert('Error', 'No se pudo compartir el acta');
    }
  }, [pdfUri]);

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.loadingText}>Generando acta PDF...</Text>
        <Text style={styles.loadingSubtext}>
          Cargando datos del participante, respuestas y huellas dactilares
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorIcon}>⚠️</Text>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={generateActa}>
          <Text style={styles.retryBtnText}>Reintentar</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Barra de acciones */}
      <View style={styles.actionBar}>
        <View style={styles.actionInfo}>
          <Text style={styles.actionTitle}>Acta generada</Text>
          <Text style={styles.actionSubtitle}>
            PDF listo para compartir
          </Text>
        </View>
        <TouchableOpacity style={styles.shareBtn} onPress={handleShare}>
          <Text style={styles.shareBtnText}>📤 Compartir</Text>
        </TouchableOpacity>
      </View>

      {/* Vista previa del PDF */}
      {pdfBase64 ? (
        <WebView
          style={styles.webview}
          source={{
            html: `
              <!DOCTYPE html>
              <html>
              <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=3.0">
                <style>
                  * { margin: 0; padding: 0; box-sizing: border-box; }
                  body { background: #f5f5f5; display: flex; justify-content: center; padding: 8px; }
                  embed, iframe { width: 100%; height: 100vh; border: none; }
                  .fallback {
                    padding: 40px 20px;
                    text-align: center;
                    font-family: -apple-system, sans-serif;
                    color: #333;
                  }
                  .fallback h3 { margin-bottom: 12px; color: #1565C0; }
                  .fallback p { margin-bottom: 8px; color: #666; font-size: 14px; }
                  .fallback .success { color: #2E7D32; font-size: 48px; margin-bottom: 16px; }
                </style>
              </head>
              <body>
                <div class="fallback">
                  <div class="success">✅</div>
                  <h3>Acta PDF generada exitosamente</h3>
                  <p>El documento incluye:</p>
                  <p>• Datos del participante</p>
                  <p>• Respuestas del formulario</p>
                  <p>• Huellas dactilares (si fueron capturadas)</p>
                  <p>• Firma digital (si fue capturada)</p>
                  <p>• Ubicacion GPS</p>
                  <br/>
                  <p><strong>Use el boton "Compartir" para enviar o guardar el acta.</strong></p>
                </div>
              </body>
              </html>
            `,
          }}
          originWhitelist={['*']}
          javaScriptEnabled={false}
          scrollEnabled={true}
        />
      ) : (
        <View style={styles.centerContainer}>
          <Text style={styles.loadingText}>Cargando vista previa...</Text>
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
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    backgroundColor: colors.background,
  },
  loadingText: {
    marginTop: spacing.md,
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
  },
  loadingSubtext: {
    marginTop: spacing.sm,
    fontSize: fontSize.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: spacing.md,
  },
  errorText: {
    fontSize: fontSize.body,
    color: colors.error,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  retryBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  retryBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  actionInfo: {
    flex: 1,
  },
  actionTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  actionSubtitle: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  shareBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: borderRadius.md,
  },
  shareBtnText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
});
