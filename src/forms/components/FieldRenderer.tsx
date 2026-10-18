/**
 * Renderizador dinamico de campos de formulario.
 *
 * Interpreta el JSON Schema compartido (doc 23) y renderiza
 * el componente nativo correspondiente segun el tipo de campo.
 *
 * Tipos soportados:
 *   text, number, select, date, textarea, gps, photo, signature, checkbox
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Image,
  Platform,
} from 'react-native';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import type { FormComponent } from '../../types';
import { colors, spacing, fontSize, borderRadius } from '../../ui/theme';
import FileFieldControl from './FileFieldControl';

interface FieldRendererProps {
  component: FormComponent;
  value: unknown;
  error?: string;
  onChange: (fieldId: string, value: unknown) => void;
  onCapturePhoto: (fieldId: string) => void;
  onCaptureGps: (fieldId: string) => void;
  onCaptureSignature: (fieldId: string) => void;
  onScanDocument?: (fieldId: string) => void;
  onCaptureFingerprint?: (fieldId: string) => void;
}

export default function FieldRenderer({
  component,
  value,
  error,
  onChange,
  onCapturePhoto,
  onCaptureGps,
  onCaptureSignature,
  onScanDocument,
  onCaptureFingerprint,
}: FieldRendererProps) {
  const { id, type, label, required, options } = component;
  const hasError = !!error;
  const [showDatePicker, setShowDatePicker] = useState(false);
  // Selector de hora / fecha-hora: qué paso está abierto y el día ya elegido.
  const [timeStep, setTimeStep] = useState<'date' | 'time' | null>(null);
  const [pendingDate, setPendingDate] = useState<Date | null>(null);

  const renderLabel = () => (
    <Text style={styles.label}>
      {label}
      {required && <Text style={styles.required}> *</Text>}
    </Text>
  );

  const renderError = () =>
    hasError ? <Text style={styles.errorText}>{error}</Text> : null;

  const inputErrorStyle = hasError ? styles.inputError : undefined;

  switch (type) {
    case 'text':
      return (
        <View style={styles.field}>
          {renderLabel()}
          <TextInput
            style={[styles.input, inputErrorStyle]}
            value={String(value ?? '')}
            onChangeText={(text) => onChange(id, text)}
            placeholder={`Ingrese ${label.toLowerCase()}`}
          />
          {renderError()}
        </View>
      );

    case 'number':
      return (
        <View style={styles.field}>
          {renderLabel()}
          <TextInput
            style={[styles.input, inputErrorStyle]}
            value={value != null ? String(value) : ''}
            // Mientras se escribe ('1,' o '-') se conserva el texto: convertir en
            // cada tecla borraba la coma y hacía imposible escribir decimales.
            onChangeText={(text) => onChange(id, parseNumberInput(text))}
            keyboardType="decimal-pad"
            placeholder="0"
          />
          {renderError()}
        </View>
      );

    case 'textarea':
      return (
        <View style={styles.field}>
          {renderLabel()}
          <TextInput
            style={[styles.input, styles.textarea, inputErrorStyle]}
            value={String(value ?? '')}
            onChangeText={(text) => onChange(id, text)}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          {renderError()}
        </View>
      );

    case 'select':
      return (
        <View style={styles.field}>
          {renderLabel()}
          <View style={[styles.optionsContainer, hasError && { borderColor: colors.error, borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.xs }]}>
            {(options ?? []).map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.option,
                  value === opt.value && styles.optionSelected,
                ]}
                onPress={() => onChange(id, opt.value)}
              >
                <Text
                  style={[
                    styles.optionText,
                    value === opt.value && styles.optionTextSelected,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {renderError()}
        </View>
      );

    case 'multiselect': {
      const selectedValues = Array.isArray(value) ? (value as string[]) : [];
      const toggleOption = (optValue: string) => {
        const next = selectedValues.includes(optValue)
          ? selectedValues.filter((v) => v !== optValue)
          : [...selectedValues, optValue];
        onChange(id, next);
      };
      return (
        <View style={styles.field}>
          {renderLabel()}
          {selectedValues.length > 0 && (
            <Text style={styles.multiSelectCount}>
              {selectedValues.length} seleccionado{selectedValues.length !== 1 ? 's' : ''}
            </Text>
          )}
          <View style={[styles.optionsContainer, hasError && { borderColor: colors.error, borderWidth: 1, borderRadius: borderRadius.md, padding: spacing.xs }]}>
            {(options ?? []).map((opt) => {
              const isSelected = selectedValues.includes(opt.value);
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.option, isSelected && styles.optionSelected]}
                  onPress={() => toggleOption(opt.value)}
                >
                  <Text style={[styles.optionText, isSelected && styles.optionTextSelected]}>
                    {isSelected ? '✓ ' : ''}{opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {renderError()}
        </View>
      );
    }

    case 'checkbox':
      return (
        <View style={styles.field}>
          <View style={styles.checkboxRow}>
            <Switch
              value={Boolean(value)}
              onValueChange={(v) => onChange(id, v)}
              trackColor={{ false: colors.border, true: colors.primaryLight }}
              thumbColor={value ? colors.primary : '#f4f3f4'}
            />
            <Text style={styles.checkboxLabel}>{label}</Text>
          </View>
          {renderError()}
        </View>
      );

    case 'date': {
      // 'YYYY-MM-DD' se interpreta como fecha local: new Date('2026-10-16')
      // es medianoche UTC y en Colombia (UTC-5) se mostraría 15/10.
      const dateValue = parseLocalDate(value);
      const displayDate = dateValue && !isNaN(dateValue.getTime())
        ? dateValue.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' })
        : '';

      const handleDateChange = (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
        if (Platform.OS === 'android') {
          setShowDatePicker(false);
        }
        // toISOString() pasa a UTC y de noche correría la fecha al día siguiente.
        onChange(id, toLocalIsoDate(selectedDate));
      };

      return (
        <View style={styles.field}>
          {renderLabel()}
          <TouchableOpacity
            style={[styles.input, styles.dateInput, inputErrorStyle]}
            onPress={() => setShowDatePicker(true)}
          >
            <Text style={displayDate ? styles.dateText : styles.datePlaceholder}>
              {displayDate || 'Seleccionar fecha'}
            </Text>
          </TouchableOpacity>
          {showDatePicker && (
            <View>
              <DateTimePicker
                value={dateValue && !isNaN(dateValue.getTime()) ? dateValue : new Date()}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onValueChange={handleDateChange}
                onDismiss={() => setShowDatePicker(false)}
                locale="es"
              />
              {Platform.OS === 'ios' && (
                <TouchableOpacity
                  style={styles.dateConfirmButton}
                  onPress={() => setShowDatePicker(false)}
                >
                  <Text style={styles.dateConfirmText}>Listo</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {renderError()}
        </View>
      );
    }

    case 'gps':
      return (
        <View style={styles.field}>
          {renderLabel()}
          <TouchableOpacity
            style={[styles.captureButton, hasError && { borderColor: colors.error }]}
            onPress={() => onCaptureGps(id)}
          >
            <Text style={styles.captureButtonText}>
              {value
                ? `GPS: ${(value as any).lat?.toFixed(5)}, ${(value as any).lng?.toFixed(5)}`
                : 'Capturar ubicacion'}
            </Text>
          </TouchableOpacity>
          {renderError()}
        </View>
      );

    case 'photo': {
      const photoUri = value && typeof value === 'object' ? (value as any).uri : null;
      return (
        <View style={styles.field}>
          {renderLabel()}
          {photoUri ? (
            <View style={styles.photoPreviewContainer}>
              <Image
                source={{ uri: photoUri }}
                style={styles.photoPreview}
                resizeMode="cover"
              />
              <TouchableOpacity
                style={styles.retakeButton}
                onPress={() => onCapturePhoto(id)}
              >
                <Text style={styles.retakeButtonText}>Volver a tomar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.captureButton, hasError && { borderColor: colors.error }]}
              onPress={() => onCapturePhoto(id)}
            >
              <Text style={styles.captureButtonText}>Tomar foto</Text>
            </TouchableOpacity>
          )}
          {renderError()}
        </View>
      );
    }

    case 'signature':
      return (
        <View style={styles.field}>
          {renderLabel()}
          {value && (value as any).dataUri ? (
            <View style={styles.signaturePreviewContainer}>
              <Image
                source={{ uri: (value as any).dataUri }}
                style={styles.signaturePreview}
                resizeMode="contain"
              />
              <TouchableOpacity
                style={styles.resignButton}
                onPress={() => onCaptureSignature(id)}
              >
                <Text style={styles.resignButtonText}>Volver a firmar</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.captureButton, hasError && { borderColor: colors.error }]}
              onPress={() => onCaptureSignature(id)}
            >
              <Text style={styles.captureButtonText}>Capturar firma</Text>
            </TouchableOpacity>
          )}
          {renderError()}
        </View>
      );

    case 'document':
    case 'file':
    case 'multifile':
    case 'audio':
    case 'video': {
      const cfg = (component.config ?? {}) as Record<string, any>;
      return (
        <View style={styles.field}>
          {renderLabel()}
          <FileFieldControl
            kind={type}
            backendType={cfg.backendType}
            value={value}
            hasError={hasError}
            maxSeconds={typeof cfg.max_duration_seconds === 'number' ? cfg.max_duration_seconds : undefined}
            onChange={(next) => onChange(id, next)}
            onScanDocument={onScanDocument ? () => onScanDocument(id) : undefined}
          />
          {renderError()}
        </View>
      );
    }

    case 'fingerprint': {
      const fpValue = value as { dataUri?: string; fileUri?: string; hand?: string; method?: string } | null;
      return (
        <View style={styles.field}>
          {renderLabel()}
          {fpValue?.dataUri ? (
            <View style={styles.fingerprintPreviewContainer}>
              <View style={styles.fingerprintPreviewRow}>
                <Image
                  source={{ uri: fpValue.dataUri }}
                  style={styles.fingerprintPreview}
                  resizeMode="contain"
                />
                <View style={styles.fingerprintInfo}>
                  <Text style={styles.fingerprintHand}>
                    Pulgar {fpValue.hand === 'left' ? 'izquierdo' : 'derecho'}
                  </Text>
                  <Text style={styles.fingerprintStatus}>
                    {fpValue.method === 'camera' ? '📷 Foto' : '👆 Tactil'} - Capturada
                  </Text>
                  <Text style={styles.fingerprintEvidence}>
                    Disponible como evidencia
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.recaptureButton}
                onPress={() => onCaptureFingerprint?.(id)}
              >
                <Text style={styles.recaptureButtonText}>Capturar de nuevo</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.captureButton, hasError && { borderColor: colors.error }]}
              onPress={() => onCaptureFingerprint?.(id)}
            >
              <Text style={styles.fingerprintIcon}>👆</Text>
              <Text style={styles.captureButtonText}>Capturar huella digital</Text>
              <Text style={styles.fingerprintHint}>
                Use la camara o presione el pulgar en pantalla
              </Text>
            </TouchableOpacity>
          )}
          {renderError()}
        </View>
      );
    }

    case 'time':
    case 'datetime': {
      // Hora 'HH:MM' y fecha-hora 'YYYY-MM-DDTHH:MM', mismo formato que la web
      // (input time / datetime-local). Android no tiene selector de fecha y
      // hora juntos: en 'datetime' se elige primero el día y luego la hora.
      const current = parseLocalDateTime(value, type);
      const display = !current
        ? ''
        : type === 'time'
          ? toLocalTime(current)
          : `${current.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' })} ${toLocalTime(current)}`;
      const step = timeStep;
      const handlePicked = (_event: DateTimePickerChangeEvent, picked: Date) => {
        if (type === 'datetime' && step === 'date') {
          setPendingDate(picked);
          setTimeStep('time');
          return;
        }
        setTimeStep(null);
        const base = type === 'datetime' ? pendingDate ?? picked : picked;
        const merged = new Date(base.getFullYear(), base.getMonth(), base.getDate(), picked.getHours(), picked.getMinutes());
        onChange(id, type === 'time' ? toLocalTime(merged) : `${toLocalIsoDate(merged)}T${toLocalTime(merged)}`);
      };
      return (
        <View style={styles.field}>
          {renderLabel()}
          <TouchableOpacity
            style={[styles.input, styles.dateInput, inputErrorStyle]}
            onPress={() => setTimeStep(type === 'datetime' ? 'date' : 'time')}
          >
            <Text style={display ? styles.dateText : styles.datePlaceholder}>
              {display || (type === 'time' ? 'Seleccionar hora' : 'Seleccionar fecha y hora')}
            </Text>
          </TouchableOpacity>
          {step && (
            <DateTimePicker
              value={current ?? new Date()}
              mode={step}
              is24Hour
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onValueChange={handlePicked}
              onDismiss={() => setTimeStep(null)}
              locale="es"
            />
          )}
          {renderError()}
        </View>
      );
    }

    case 'ranking': {
      // Se guarda la lista de valores en el orden elegido (primero = más importante).
      const order = Array.isArray(value) && value.length ? (value as string[]) : (options ?? []).map((o) => o.value);
      const labels = new Map((options ?? []).map((o) => [o.value, o.label]));
      const move = (from: number, to: number) => {
        const next = [...order];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        onChange(id, next);
      };
      return (
        <View style={styles.field}>
          {renderLabel()}
          <Text style={styles.hint}>Use ↑ ↓ para ordenar de más a menos importante.</Text>
          {order.map((item, index) => (
            <View key={item} style={styles.rankRow}>
              <Text style={styles.rankText}>{index + 1}. {labels.get(item) ?? item}</Text>
              <TouchableOpacity accessibilityLabel="Subir" disabled={index === 0} style={[styles.rankButton, index === 0 && styles.rankButtonDisabled]} onPress={() => move(index, index - 1)}>
                <Text style={styles.rankButtonText}>↑</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityLabel="Bajar" disabled={index === order.length - 1} style={[styles.rankButton, index === order.length - 1 && styles.rankButtonDisabled]} onPress={() => move(index, index + 1)}>
                <Text style={styles.rankButtonText}>↓</Text>
              </TouchableOpacity>
            </View>
          ))}
          {renderError()}
        </View>
      );
    }

    case 'webonly':
      // Matriz, subformulario enlazado o vínculo a otro registro: necesitan
      // consultar otros registros o una estructura que la app aún no pinta.
      return (
        <View style={styles.field}>
          {renderLabel()}
          <Text style={styles.unsupported}>Este campo se completa desde la versión web.</Text>
        </View>
      );

    case 'auto':
      // Duración de la entrevista: la app la registra sola al enviar.
      return null;

    default:
      return (
        <View style={styles.field}>
          {renderLabel()}
          <Text style={styles.unsupported}>
            Tipo "{type}" no soportado aun
          </Text>
        </View>
      );
  }
}

/** Hora local 'HH:MM'. */
function toLocalTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 'HH:MM' o 'YYYY-MM-DDTHH:MM' → Date local, sin desfase de zona horaria. */
function parseLocalDateTime(value: unknown, type: 'time' | 'datetime'): Date | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  if (type === 'time') {
    const m = /^(\d{2}):(\d{2})/.exec(value);
    if (!m) return undefined;
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d;
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])) : undefined;
}

const styles = StyleSheet.create({
  field: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: fontSize.body,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  required: {
    color: colors.error,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    padding: spacing.md,
    fontSize: fontSize.body,
    backgroundColor: colors.surface,
  },
  textarea: {
    minHeight: 100,
  },
  optionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  option: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  optionSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryLight + '20',
  },
  optionText: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
  },
  optionTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  checkboxLabel: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    flex: 1,
  },
  captureButton: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: borderRadius.md,
    borderStyle: 'dashed',
    padding: spacing.lg,
    alignItems: 'center',
    backgroundColor: colors.primaryLight + '10',
  },
  captureButtonText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '500',
  },
  multiSelectCount: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  dateInput: {
    justifyContent: 'center',
  },
  dateText: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
  },
  datePlaceholder: {
    fontSize: fontSize.body,
    color: colors.textSecondary,
  },
  dateConfirmButton: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  dateConfirmText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '600',
  },
  photoPreviewContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  photoPreview: {
    width: '100%',
    height: 180,
    backgroundColor: colors.background,
  },
  retakeButton: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  retakeButtonText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '500',
  },
  signaturePreviewContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
    backgroundColor: 'white',
  },
  signaturePreview: {
    width: '100%',
    height: 120,
    backgroundColor: 'white',
  },
  resignButton: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  resignButtonText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '500',
  },
  errorText: {
    fontSize: fontSize.caption,
    color: colors.error,
    marginTop: spacing.xs,
  },
  inputError: {
    borderColor: colors.error,
  },
  documentPreviewContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  documentPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  documentIcon: {
    fontSize: 36,
  },
  documentInfo: {
    flex: 1,
  },
  documentName: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  documentType: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rescanButton: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  rescanButtonText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '500',
  },
  scanIcon: {
    fontSize: 28,
    marginBottom: spacing.xs,
  },
  scanHint: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  fingerprintPreviewContainer: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.md,
    overflow: 'hidden',
  },
  fingerprintPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  fingerprintPreview: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: colors.border,
  },
  fingerprintInfo: {
    flex: 1,
  },
  fingerprintHand: {
    fontSize: fontSize.body,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  fingerprintStatus: {
    fontSize: fontSize.caption,
    color: colors.success,
    marginTop: 2,
  },
  fingerprintEvidence: {
    fontSize: fontSize.caption - 1,
    color: colors.primary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  recaptureButton: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  recaptureButtonText: {
    fontSize: fontSize.caption,
    color: colors.primary,
    fontWeight: '500',
  },
  fingerprintIcon: {
    fontSize: 32,
    marginBottom: spacing.xs,
  },
  fingerprintHint: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  unsupported: {
    fontSize: fontSize.caption,
    color: colors.warning,
    fontStyle: 'italic',
  },
  hint: {
    fontSize: fontSize.caption,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rankText: {
    flex: 1,
    fontSize: fontSize.body,
    color: colors.textPrimary,
  },
  rankButton: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankButtonDisabled: {
    opacity: 0.3,
  },
  rankButtonText: {
    fontSize: fontSize.body,
    color: colors.primary,
    fontWeight: '700',
  },
});

/** 'YYYY-MM-DD' → Date local (sin desfase de zona horaria). */
function parseLocalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  return isNaN(date.getTime()) ? undefined : date;
}

/** Date → 'YYYY-MM-DD' con el día del calendario local. */
function toLocalIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Texto de un campo numérico → número si está completo (acepta coma decimal,
 * '1,5' → 1.5); si no, el texto tal cual para que validation.ts lo marque. */
export function parseNumberInput(text: string): number | string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^-?\d+([.,]\d+)?$/.test(trimmed)) return Number(trimmed.replace(',', '.'));
  return text;
}
