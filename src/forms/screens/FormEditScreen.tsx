/**
 * Pantalla de edicion de borradores.
 *
 * Permite modificar un registro pendiente o con error
 * antes de que se sincronice. Reutiliza FieldRenderer
 * y carga los datos guardados desde SQLite.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { v4 as uuidv4 } from 'uuid';
import FieldRenderer from '../components/FieldRenderer';
import RepeatGroupRenderer, { getRepeatFieldId, parseRepeatFieldId } from '../components/RepeatGroupRenderer';
import PageProgressBar from '../components/PageProgressBar';
import SignatureModal from '../components/SignatureModal';
import FingerprintModal, { type FingerprintResult } from '../components/FingerprintModal';
import { validateForm } from '../utils/validation';
import { isFieldVisible } from '../utils/conditionalVisibility';
import {
  getCachedForm,
  getQueuedRecord,
  updateQueuedRecord,
  insertEvidence,
} from '../../db/database';
import type { FormPage, FormSection, FormComponent, GpsCoordinate, RecordValue } from '../../types';
import { compressImage, FIELD_CAMERA_OPTIONS } from '../../utils/imageCompressor';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

export default function FormEditScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const recordLocalId: string = route.params?.recordLocalId ?? '';

  const [formName, setFormName] = useState('');
  const [pages, setPages] = useState<FormPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [gps, setGps] = useState<GpsCoordinate | null>(null);
  const [newEvidencePaths, setNewEvidencePaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [signatureFieldId, setSignatureFieldId] = useState<string | null>(null);
  const [fingerprintFieldId, setFingerprintFieldId] = useState<string | null>(null);
  const [repeatCounts, setRepeatCounts] = useState<Record<string, number>>({});

  // Cargar registro y formulario
  useEffect(() => {
    if (!recordLocalId) {
      Alert.alert('Error', 'No se especifico un registro');
      navigation.goBack();
      return;
    }

    const record = getQueuedRecord(recordLocalId);
    if (!record) {
      Alert.alert('Error', 'Registro no encontrado');
      navigation.goBack();
      return;
    }

    // Cargar formulario desde cache
    const cached = getCachedForm(record.template_id);
    let parsedPages: FormPage[] = [];
    if (cached) {
      setFormName(cached.name);
      parsedPages = JSON.parse(cached.schema_json);
      setPages(parsedPages);
    }

    // Restaurar valores guardados
    const savedValues: RecordValue[] = JSON.parse(record.data_json);
    const restoredValues: Record<string, unknown> = {};
    for (const rv of savedValues) {
      restoredValues[rv.field_id] = rv.field_value_json;
    }
    setValues(restoredValues);

    // Restaurar contadores de repeat groups desde los valores guardados
    const counts: Record<string, number> = {};
    for (const p of parsedPages) {
      for (const s of p.sections) {
        if (!s.repeatable) continue;
        const sid = s.id ?? s.title;
        const minReps = s.minRepetitions ?? 1;
        // Detectar cuantas instancias existen en los valores guardados
        let maxIdx = -1;
        for (const key of Object.keys(restoredValues)) {
          const parsed = parseRepeatFieldId(key);
          if (parsed && parsed.sectionId === sid) {
            maxIdx = Math.max(maxIdx, parsed.index);
          }
        }
        counts[sid] = Math.max(minReps, maxIdx + 1);
      }
    }
    if (Object.keys(counts).length > 0) {
      setRepeatCounts(counts);
    }

    // Restaurar GPS
    if (record.gps_json) {
      setGps(JSON.parse(record.gps_json));
    }
  }, [recordLocalId, navigation]);

  const handleFieldChange = useCallback((fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setErrors((prev) => {
      if (!prev.has(fieldId)) return prev;
      const next = new Map(prev);
      next.delete(fieldId);
      return next;
    });
  }, []);

  const handleCapturePhoto = useCallback(
    async (fieldId: string) => {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso', 'Se necesita acceso a la camara');
        return;
      }
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: FIELD_CAMERA_OPTIONS.quality,
        exif: FIELD_CAMERA_OPTIONS.exif,
      });
      if (!result.canceled && result.assets[0]) {
        const compressed = await compressImage(result.assets[0].uri);
        handleFieldChange(fieldId, { uri: compressed.uri, type: 'photo', fileSize: compressed.fileSize });
        setNewEvidencePaths((prev) => [...prev, compressed.uri]);
      }
    },
    [handleFieldChange],
  );

  const handleCaptureGps = useCallback(
    async (fieldId: string) => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso', 'Se necesita acceso a la ubicacion');
        return;
      }
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        const gpsValue = {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy: loc.coords.accuracy ?? 0,
        };
        handleFieldChange(fieldId, gpsValue);
        setGps({
          ...gpsValue,
          altitude: loc.coords.altitude ?? undefined,
          timestamp: loc.timestamp,
        });
      } catch {
        Alert.alert('Error', 'No se pudo obtener la ubicacion');
      }
    },
    [handleFieldChange],
  );

  const handleCaptureSignature = useCallback((fieldId: string) => {
    setSignatureFieldId(fieldId);
  }, []);

  const handleCaptureFingerprint = useCallback((fieldId: string) => {
    setFingerprintFieldId(fieldId);
  }, []);

  const handleScanDocument = useCallback(
    (fieldId: string) => {
      navigation.navigate('DocumentScanner', {
        fieldId,
        onDocumentScanned: (uri: string, fileName: string) => {
          handleFieldChange(fieldId, { uri, fileName, type: 'document' });
        },
      });
    },
    [navigation, handleFieldChange],
  );

  const handleSignatureSave = useCallback(
    (signatureBase64: string) => {
      if (signatureFieldId) {
        handleFieldChange(signatureFieldId, { dataUri: signatureBase64, type: 'signature' });
      }
      setSignatureFieldId(null);
    },
    [signatureFieldId, handleFieldChange],
  );

  const handleFingerprintSave = useCallback(
    (result: FingerprintResult) => {
      if (fingerprintFieldId) {
        handleFieldChange(fingerprintFieldId, {
          dataUri: result.dataUri,
          fileUri: result.fileUri,
          hand: result.hand,
          method: result.method,
          fileSize: result.fileSize,
          type: 'fingerprint',
        });
      }
      setFingerprintFieldId(null);
    },
    [fingerprintFieldId, handleFieldChange],
  );

  // Repeat group: agregar instancia
  const handleAddRepeatInstance = useCallback((sectionId: string, maxReps: number) => {
    setRepeatCounts((prev) => {
      const current = prev[sectionId] ?? 1;
      if (current >= maxReps) return prev;
      return { ...prev, [sectionId]: current + 1 };
    });
  }, []);

  // Repeat group: eliminar instancia y reasignar valores
  const handleRemoveRepeatInstance = useCallback((sectionId: string, index: number, components: FormComponent[]) => {
    setRepeatCounts((prev) => {
      const current = prev[sectionId] ?? 1;
      return { ...prev, [sectionId]: Math.max(1, current - 1) };
    });
    setValues((prev) => {
      const next = { ...prev };
      const count = repeatCounts[sectionId] ?? 1;
      for (const comp of components) {
        delete next[getRepeatFieldId(sectionId, index, comp.id)];
      }
      for (let i = index + 1; i < count; i++) {
        for (const comp of components) {
          const oldKey = getRepeatFieldId(sectionId, i, comp.id);
          const newKey = getRepeatFieldId(sectionId, i - 1, comp.id);
          if (next[oldKey] !== undefined) {
            next[newKey] = next[oldKey];
          }
          delete next[oldKey];
        }
      }
      return next;
    });
    setErrors((prev) => {
      const next = new Map(prev);
      for (const key of next.keys()) {
        if (key.startsWith(`${sectionId}[`)) {
          next.delete(key);
        }
      }
      return next;
    });
  }, [repeatCounts]);

  // Guardar cambios
  const handleSave = useCallback(async () => {
    // Validar antes de guardar (incluye repeat groups)
    const validationErrors = validateForm(pages, values, repeatCounts);
    if (validationErrors.size > 0) {
      setErrors(validationErrors);
      Alert.alert(
        'Campos incompletos',
        `Hay ${validationErrors.size} campo${validationErrors.size !== 1 ? 's' : ''} con errores. Revise los campos marcados en rojo.`,
      );
      return;
    }

    setSaving(true);
    try {
      const recordValues: RecordValue[] = Object.entries(values).map(
        ([fieldId, val]) => ({
          field_id: fieldId,
          field_name: fieldId,
          field_value_json: val,
        }),
      );

      updateQueuedRecord(
        recordLocalId,
        recordValues,
        gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : undefined,
      );

      // Registrar nuevas evidencias
      for (const uri of newEvidencePaths) {
        insertEvidence({
          localId: uuidv4(),
          recordLocalId,
          type: 'photo',
          fileUri: uri,
          mimeType: 'image/jpeg',
          fileSize: 0,
        });
      }

      Alert.alert('Guardado', 'Borrador actualizado. Se sincronizara automaticamente.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }, [recordLocalId, pages, values, repeatCounts, gps, newEvidencePaths, navigation]);

  // Secciones de la pagina actual
  const page = pages[currentPage];
  const currentSections: FormSection[] = page?.sections ?? [];

  const isLastPage = currentPage >= pages.length - 1;

  // Calcular estado de cada pagina
  const { pagesWithErrors, pagesCompleted } = useMemo(() => {
    const withErrors = new Set<number>();
    const completed = new Set<number>();

    pages.forEach((pg, pgIdx) => {
      let hasErrors = false;
      let allFilled = true;

      for (const section of pg.sections) {
        if (section.repeatable) {
          const sid = section.id ?? section.title;
          const count = repeatCounts[sid] ?? (section.minRepetitions ?? 1);
          const comps: FormComponent[] = [];
          for (const row of section.rows) {
            for (const col of row.columns) comps.push(...col.components);
          }
          for (let i = 0; i < count; i++) {
            for (const comp of comps) {
              const key = getRepeatFieldId(sid, i, comp.id);
              if (errors.has(key)) hasErrors = true;
              if (comp.required && (values[key] === undefined || values[key] === null || values[key] === '')) {
                allFilled = false;
              }
            }
          }
        } else {
          for (const row of section.rows) {
            for (const col of row.columns) {
              for (const comp of col.components) {
                if (!isFieldVisible(comp.conditionalVisibility, values)) continue;
                if (errors.has(comp.id)) hasErrors = true;
                if (comp.required && (values[comp.id] === undefined || values[comp.id] === null || values[comp.id] === '')) {
                  allFilled = false;
                }
              }
            }
          }
        }
      }

      if (hasErrors) withErrors.add(pgIdx);
      if (allFilled && pg.sections.length > 0) completed.add(pgIdx);
    });

    return { pagesWithErrors: withErrors, pagesCompleted: completed };
  }, [pages, values, errors, repeatCounts]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.formTitle}>{formName || 'Editar borrador'}</Text>
        <View style={styles.gpsIndicator}>
          <View
            style={[styles.gpsDot, { backgroundColor: gps ? colors.success : colors.warning }]}
          />
          <Text style={styles.gpsText}>
            {gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Sin GPS'}
          </Text>
        </View>
      </View>

      <PageProgressBar
        pages={pages}
        currentPage={currentPage}
        pagesWithErrors={pagesWithErrors}
        pagesCompleted={pagesCompleted}
        onPagePress={setCurrentPage}
      />

      <ScrollView style={styles.fields} contentContainerStyle={styles.fieldsContent}>
        {currentSections.map((section, sIdx) => {
          if (section.repeatable) {
            const sectionId = section.id ?? section.title;
            return (
              <RepeatGroupRenderer
                key={`repeat-${sectionId}-${sIdx}`}
                section={section}
                instanceCount={repeatCounts[sectionId] ?? (section.minRepetitions ?? 1)}
                values={values}
                errors={errors}
                onChange={handleFieldChange}
                onAddInstance={() => handleAddRepeatInstance(sectionId, section.maxRepetitions ?? 50)}
                onRemoveInstance={(index) => {
                  const comps: FormComponent[] = [];
                  for (const row of section.rows) {
                    for (const col of row.columns) {
                      comps.push(...col.components);
                    }
                  }
                  handleRemoveRepeatInstance(sectionId, index, comps);
                }}
                onCapturePhoto={handleCapturePhoto}
                onCaptureGps={handleCaptureGps}
                onCaptureSignature={handleCaptureSignature}
                onScanDocument={handleScanDocument}
                onCaptureFingerprint={handleCaptureFingerprint}
              />
            );
          }

          const sectionComponents: FormComponent[] = [];
          for (const row of section.rows) {
            for (const col of row.columns) {
              sectionComponents.push(...col.components);
            }
          }
          const visibleComps = sectionComponents.filter((comp) =>
            isFieldVisible(comp.conditionalVisibility, values),
          );
          if (visibleComps.length === 0) return null;

          return (
            <View key={`section-${sIdx}`}>
              {section.title && currentSections.length > 1 && (
                <Text style={styles.sectionTitle}>{section.title}</Text>
              )}
              {visibleComps.map((comp) => (
                <FieldRenderer
                  key={comp.id}
                  component={comp}
                  value={values[comp.id]}
                  error={errors.get(comp.id)}
                  onChange={handleFieldChange}
                  onCapturePhoto={handleCapturePhoto}
                  onCaptureGps={handleCaptureGps}
                  onCaptureSignature={handleCaptureSignature}
                  onScanDocument={handleScanDocument}
                  onCaptureFingerprint={handleCaptureFingerprint}
                />
              ))}
            </View>
          );
        })}
      </ScrollView>

      {/* Modal de firma */}
      <SignatureModal
        visible={signatureFieldId !== null}
        onSave={handleSignatureSave}
        onCancel={() => setSignatureFieldId(null)}
      />

      {/* Modal de huella digital */}
      <FingerprintModal
        visible={fingerprintFieldId !== null}
        onSave={handleFingerprintSave}
        onCancel={() => setFingerprintFieldId(null)}
      />

      <View style={styles.footer}>
        {currentPage > 0 && (
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => setCurrentPage((p) => p - 1)}
          >
            <Text style={styles.navButtonText}>Anterior</Text>
          </TouchableOpacity>
        )}
        <View style={{ flex: 1 }} />
        {isLastPage ? (
          <TouchableOpacity
            style={[styles.submitButton, saving && styles.buttonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.submitButtonText}>
              {saving ? 'Guardando...' : 'Guardar cambios'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.navButton}
            onPress={() => setCurrentPage((p) => p + 1)}
          >
            <Text style={styles.navButtonText}>Siguiente</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  formTitle: {
    fontSize: fontSize.title,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  gpsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing.xs,
  },
  gpsText: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
  },
  fields: {
    flex: 1,
  },
  fieldsContent: {
    padding: spacing.md,
  },
  sectionTitle: {
    fontSize: fontSize.subtitle,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  footer: {
    flexDirection: 'row',
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  navButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  navButtonText: {
    color: colors.primary,
    fontSize: fontSize.body,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: colors.accent,
    borderRadius: borderRadius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  submitButtonText: {
    color: colors.textOnPrimary,
    fontSize: fontSize.body,
    fontWeight: '600',
  },
  buttonDisabled: {
    backgroundColor: colors.disabled,
  },
});
