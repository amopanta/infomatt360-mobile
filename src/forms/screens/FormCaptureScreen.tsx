/**
 * Pantalla de captura de formulario (offline-first).
 *
 * - Renderiza campos desde el JSON Schema cacheado en SQLite.
 * - Guarda en la cola offline local al enviar.
 * - Captura GPS automaticamente al abrir.
 * - Permite tomar fotos y adjuntar evidencias.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useRoute, useNavigation, CommonActions } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { v4 as uuidv4 } from 'uuid';
import FieldRenderer from '../components/FieldRenderer';
import RepeatGroupRenderer, { getRepeatFieldId } from '../components/RepeatGroupRenderer';
import PageProgressBar from '../components/PageProgressBar';
import SignatureModal from '../components/SignatureModal';
import FingerprintModal, { type FingerprintResult } from '../components/FingerprintModal';
import { validateForm, validateField } from '../utils/validation';
import { isFieldVisible } from '../utils/conditionalVisibility';
import {
  getCachedForm,
  enqueueRecord,
  insertEvidence,
  saveAutoDraft,
  promoteDraftToPending,
  deleteAutoDraft,
} from '../../db/database';
import { useAuthStore } from '../../store/authStore';
import type { FormPage, FormSection, FormComponent, GpsCoordinate, RecordValue } from '../../types';
import { compressImage, FIELD_CAMERA_OPTIONS } from '../../utils/imageCompressor';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';

export default function FormCaptureScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const { activeProjectId } = useAuthStore();
  const formId: number = route.params?.formId;

  const [formName, setFormName] = useState('');
  const [pages, setPages] = useState<FormPage[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [gps, setGps] = useState<GpsCoordinate | null>(null);
  const [evidencePaths, setEvidencePaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [signatureFieldId, setSignatureFieldId] = useState<string | null>(null);
  const [fingerprintFieldId, setFingerprintFieldId] = useState<string | null>(null);
  const [repeatCounts, setRepeatCounts] = useState<Record<string, number>>({});
  const draftLocalId = useRef(uuidv4()).current;
  const submittedRef = useRef(false);

  // Cargar formulario desde cache SQLite
  useEffect(() => {
    const cached = getCachedForm(formId);
    if (cached) {
      setFormName(cached.name);
      const parsedPages: FormPage[] = JSON.parse(cached.schema_json);
      setPages(parsedPages);

      // Inicializar contadores de secciones repetibles
      const initialCounts: Record<string, number> = {};
      for (const p of parsedPages) {
        for (const s of p.sections) {
          if (s.repeatable) {
            const sid = s.id ?? s.title;
            initialCounts[sid] = s.minRepetitions ?? 1;
          }
        }
      }
      if (Object.keys(initialCounts).length > 0) {
        setRepeatCounts(initialCounts);
      }
    } else {
      Alert.alert('Error', 'Formulario no encontrado en cache local');
      navigation.goBack();
    }
  }, [formId, navigation]);

  // Capturar GPS automaticamente
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setGps({
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy: loc.coords.accuracy ?? 0,
          altitude: loc.coords.altitude ?? undefined,
          timestamp: loc.timestamp,
        });
      } catch {
        // GPS no disponible — no bloquear la captura
      }
    })();
  }, []);

  // Auto-guardado cada 30 segundos
  useEffect(() => {
    if (!activeProjectId || !formId) return;

    const interval = setInterval(() => {
      if (submittedRef.current) return;
      const hasData = Object.keys(values).length > 0;
      if (!hasData) return;

      const recordValues = Object.entries(values).map(([fieldId, val]) => ({
        field_id: fieldId,
        field_name: fieldId,
        field_value_json: val,
      }));

      saveAutoDraft({
        localId: draftLocalId,
        projectId: activeProjectId,
        templateId: formId,
        data: recordValues,
        gps: gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null,
      });
    }, 30000);

    return () => clearInterval(interval);
  }, [activeProjectId, formId, values, gps, draftLocalId]);

  // Limpiar auto-draft al desmontar si no fue enviado
  useEffect(() => {
    return () => {
      if (!submittedRef.current) {
        // Si hay datos, guardar una ultima vez antes de salir
        const hasData = Object.keys(values).length > 0;
        if (hasData && activeProjectId) {
          const recordValues = Object.entries(values).map(([fieldId, val]) => ({
            field_id: fieldId,
            field_name: fieldId,
            field_value_json: val,
          }));
          saveAutoDraft({
            localId: draftLocalId,
            projectId: activeProjectId,
            templateId: formId,
            data: recordValues,
            gps: gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : null,
          });
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cambiar valor de un campo — limpia error al editar
  const handleFieldChange = useCallback((fieldId: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setErrors((prev) => {
      if (!prev.has(fieldId)) return prev;
      const next = new Map(prev);
      next.delete(fieldId);
      return next;
    });
  }, []);

  // Capturar foto
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
        const asset = result.assets[0];
        const compressed = await compressImage(asset.uri);
        handleFieldChange(fieldId, { uri: compressed.uri, type: 'photo', fileSize: compressed.fileSize });
        setEvidencePaths((prev) => [...prev, compressed.uri]);
      }
    },
    [handleFieldChange],
  );

  // Capturar GPS para un campo especifico
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

  // Capturar firma digital
  const handleCaptureSignature = useCallback((fieldId: string) => {
    setSignatureFieldId(fieldId);
  }, []);

  // Capturar huella digital
  const handleCaptureFingerprint = useCallback((fieldId: string) => {
    setFingerprintFieldId(fieldId);
  }, []);

  // Escanear documento (navega a DocumentScanner)
  const handleScanDocument = useCallback(
    (fieldId: string) => {
      navigation.navigate('DocumentScanner', {
        fieldId,
        onDocumentScanned: (uri: string, fileName: string) => {
          handleFieldChange(fieldId, { uri, fileName, type: 'document' });
          setEvidencePaths((prev) => [...prev, uri]);
        },
      });
    },
    [navigation, handleFieldChange],
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
    // Reasignar valores: mover indices posteriores hacia abajo
    setValues((prev) => {
      const next = { ...prev };
      const count = repeatCounts[sectionId] ?? 1;
      // Eliminar valores de la instancia borrada
      for (const comp of components) {
        delete next[getRepeatFieldId(sectionId, index, comp.id)];
      }
      // Mover instancias posteriores una posicion hacia abajo
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
    // Limpiar errores de la instancia
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
        // Guardar en valores del formulario (dataUri para preview inline,
        // fileUri para acceso a archivo, accesible para actas)
        handleFieldChange(fingerprintFieldId, {
          dataUri: result.dataUri,
          fileUri: result.fileUri,
          hand: result.hand,
          method: result.method,
          fileSize: result.fileSize,
          type: 'fingerprint',
        });
        // Agregar a evidencePaths para que se registre como evidencia
        // al guardar el registro (visible para huellas y actas)
        setEvidencePaths((prev) => [...prev, result.fileUri]);
      }
      setFingerprintFieldId(null);
    },
    [fingerprintFieldId, handleFieldChange],
  );

  // Guardar registro en la cola offline
  const handleSubmit = useCallback(async () => {
    if (!activeProjectId) return;

    // Validar todos los campos antes de guardar (incluye repeat groups)
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
    submittedRef.current = true;

    try {
      // Eliminar auto-draft antes de crear el registro real
      deleteAutoDraft(draftLocalId);

      const recordLocalId = uuidv4();

      // Construir valores para el Record Engine (doc 25)
      const recordValues: RecordValue[] = Object.entries(values).map(
        ([fieldId, val]) => ({
          field_id: fieldId,
          field_name: fieldId,
          field_value_json: val,
        }),
      );

      // Guardar en cola SQLite
      enqueueRecord({
        localId: recordLocalId,
        projectId: activeProjectId,
        templateId: formId,
        data: recordValues,
        evidencePaths,
        gps: gps ? { lat: gps.lat, lng: gps.lng, accuracy: gps.accuracy } : undefined,
      });

      // Registrar evidencias en la tabla de evidencias
      // Detectar huellas digitales por su ruta (directorio fingerprints/)
      for (const uri of evidencePaths) {
        const isFingerprint = uri.includes('/fingerprints/');
        insertEvidence({
          localId: uuidv4(),
          recordLocalId,
          type: isFingerprint ? 'fingerprint' : 'photo',
          fileUri: uri,
          mimeType: isFingerprint && uri.endsWith('.png') ? 'image/png' : 'image/jpeg',
          fileSize: 0, // se actualizara al subir
        });
      }

      Alert.alert(
        'Registro guardado',
        'Se sincronizara automaticamente. ¿Desea agregar evidencias?',
        [
          {
            text: 'Volver al listado',
            style: 'cancel',
            onPress: () => navigation.goBack(),
          },
          {
            text: 'Ver detalle',
            onPress: () => {
              // Reemplazar la pantalla actual con RecordDetail
              navigation.dispatch(
                CommonActions.reset({
                  index: 1,
                  routes: [
                    { name: 'FormList' },
                    { name: 'RecordDetail', params: { recordLocalId } },
                  ],
                }),
              );
            },
          },
          {
            text: 'Agregar evidencias',
            onPress: () => {
              navigation.dispatch(
                CommonActions.reset({
                  index: 2,
                  routes: [
                    { name: 'FormList' },
                    { name: 'RecordDetail', params: { recordLocalId } },
                    { name: 'EvidenceCapture', params: { recordLocalId } },
                  ],
                }),
              );
            },
          },
        ],
      );
    } catch (err: any) {
      submittedRef.current = false; // Permitir auto-guardado de nuevo si fallo
      Alert.alert('Error', err.message ?? 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }, [activeProjectId, formId, draftLocalId, values, repeatCounts, evidencePaths, gps, navigation]);

  // Obtener secciones de la pagina actual
  const page = pages[currentPage];
  const currentSections: FormSection[] = page?.sections ?? [];

  // Componentes normales (no repetibles) de la pagina actual
  const normalComponents: FormComponent[] = [];
  for (const section of currentSections) {
    if (section.repeatable) continue;
    for (const row of section.rows) {
      for (const col of row.columns) {
        normalComponents.push(...col.components);
      }
    }
  }
  const visibleNormalComponents = normalComponents.filter((comp) =>
    isFieldVisible(comp.conditionalVisibility, values),
  );

  // Secciones repetibles de la pagina actual
  const repeatableSections = currentSections.filter((s) => s.repeatable);

  const isLastPage = currentPage >= pages.length - 1;

  // Calcular estado de cada pagina (completada / con errores)
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
      {/* Header con nombre del formulario y GPS */}
      <View style={styles.header}>
        <Text style={styles.formTitle}>{formName}</Text>
        <View style={styles.gpsIndicator}>
          <View
            style={[styles.gpsDot, { backgroundColor: gps ? colors.success : colors.warning }]}
          />
          <Text style={styles.gpsText}>
            {gps ? `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}` : 'Obteniendo GPS...'}
          </Text>
        </View>
      </View>

      {/* Indicador de progreso multi-pagina */}
      <PageProgressBar
        pages={pages}
        currentPage={currentPage}
        pagesWithErrors={pagesWithErrors}
        pagesCompleted={pagesCompleted}
        onPagePress={setCurrentPage}
      />

      {/* Campos */}
      <ScrollView style={styles.fields} contentContainerStyle={styles.fieldsContent}>
        {/* Renderizar secciones en orden: normales intercaladas con repetibles */}
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

          // Seccion normal: renderizar campos visibles
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

      {/* Botones de navegacion */}
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
            onPress={handleSubmit}
            disabled={saving}
          >
            <Text style={styles.submitButtonText}>
              {saving ? 'Guardando...' : 'Enviar'}
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
    backgroundColor: colors.success,
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
