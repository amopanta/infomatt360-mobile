/**
 * Control para campos de archivo: PDF, FILE, MULTIFILE, AUDIO y VIDEO.
 *
 * Todo ocurre en el teléfono y sin red: el archivo elegido, grabado o
 * escaneado se copia a evidencias (persistEvidenceFile) y el valor queda en
 * el registro local; se sube al sincronizar (syncService).
 */

import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { persistEvidenceFile } from '../../evidence/evidenceFiles';
import { acceptsMime, formatSize, mimeFor, type LocalFileType, type LocalFileValue } from '../../evidence/fileValues';
import { borderRadius, colors, fontSize, spacing } from '../../ui/theme';
import AudioRecorderModal from './AudioRecorderModal';

type Kind = 'document' | 'file' | 'multifile' | 'audio' | 'video';

const ICON: Record<LocalFileType, string> = { photo: '🖼️', document: '📄', file: '📎', audio: '🎙️', video: '🎬', fingerprint: '🖐️' };

const PICK_TYPES: Record<Kind, string | string[]> = {
  document: 'application/pdf',
  file: '*/*',
  multifile: '*/*',
  audio: 'audio/*',
  video: 'video/*',
};

function asList(value: unknown): LocalFileValue[] {
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === 'object' && 'uri' in v) as LocalFileValue[];
  if (value && typeof value === 'object' && 'uri' in (value as object)) return [value as LocalFileValue];
  return [];
}

export default function FileFieldControl({
  kind,
  backendType,
  value,
  hasError,
  maxSeconds,
  onChange,
  onScanDocument,
}: {
  kind: Kind;
  backendType?: string;
  value: unknown;
  hasError: boolean;
  maxSeconds?: number;
  onChange: (value: LocalFileValue | LocalFileValue[] | null) => void;
  onScanDocument?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const files = asList(value);
  const multiple = kind === 'multifile';
  const fileType: LocalFileType = kind === 'multifile' ? 'file' : kind;

  async function addFiles(picked: { uri: string; name?: string | null; mimeType?: string | null; size?: number | null }[], type: LocalFileType) {
    setBusy(true);
    try {
      const saved: LocalFileValue[] = [];
      for (const item of picked) {
        const mime = mimeFor({ uri: item.uri, type, fileName: item.name ?? undefined, mimeType: item.mimeType ?? undefined });
        if (!acceptsMime(backendType, mime)) {
          Alert.alert('Tipo de archivo', `"${item.name ?? 'El archivo'}" no corresponde a este campo.`);
          continue;
        }
        saved.push(await persistEvidenceFile(item.uri, { type, fileName: item.name, mimeType: mime, fileSize: item.size }));
      }
      if (!saved.length) return;
      onChange(multiple ? [...files, ...saved] : saved[0]);
    } catch (error) {
      Alert.alert('Archivo', error instanceof Error ? error.message : 'No se pudo guardar el archivo.');
    } finally {
      setBusy(false);
    }
  }

  async function pickDocument() {
    // Sin copia a caché: Expo Go no puede leer la caché del selector; el
    // archivo original (content://) se copia directo a evidencias.
    const result = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES[kind], multiple, copyToCacheDirectory: false });
    if (result.canceled) return;
    await addFiles(result.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })), fileType);
  }

  async function recordVideo() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { Alert.alert('Permiso', 'Se necesita acceso a la cámara.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      videoMaxDuration: maxSeconds ?? 120,
      // Calidad media: un minuto queda muy por debajo del límite de 25 MB.
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium,
    });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    await addFiles([{ uri: a.uri, name: a.fileName ?? 'video.mp4', mimeType: a.mimeType ?? 'video/mp4', size: a.fileSize }], 'video');
  }

  function remove(uri: string) {
    const rest = files.filter((f) => f.uri !== uri);
    onChange(multiple ? (rest.length ? rest : null) : null);
  }

  const canAdd = multiple || files.length === 0;
  const replaceLabel = files.length && !multiple ? 'Reemplazar' : null;

  return (
    <View>
      {files.map((file) => (
        <View key={file.uri} style={styles.fileRow}>
          <Text style={styles.icon}>{ICON[file.type] ?? '📎'}</Text>
          <View style={styles.fileInfo}>
            <Text style={styles.fileName} numberOfLines={1}>{file.fileName ?? 'archivo'}</Text>
            <Text style={styles.fileMeta}>{[formatSize(file.fileSize), 'guardado en el teléfono'].filter(Boolean).join(' · ')}</Text>
          </View>
          <TouchableOpacity onPress={() => remove(file.uri)} accessibilityRole="button" accessibilityLabel={`Quitar ${file.fileName ?? 'archivo'}`}>
            <Text style={styles.remove}>Quitar</Text>
          </TouchableOpacity>
        </View>
      ))}

      {busy ? <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.sm }} /> : (
        <View style={styles.actions}>
          {kind === 'document' && onScanDocument && (canAdd || replaceLabel) ? (
            <Action label="📸 Escanear documento" onPress={onScanDocument} hasError={hasError && !files.length} />
          ) : null}
          {kind === 'audio' && (canAdd || replaceLabel) ? (
            <Action label="🎙️ Grabar audio" onPress={() => setRecording(true)} hasError={hasError && !files.length} />
          ) : null}
          {kind === 'video' && (canAdd || replaceLabel) ? (
            <Action label="🎬 Grabar video" onPress={() => void recordVideo()} hasError={hasError && !files.length} />
          ) : null}
          {canAdd || replaceLabel ? (
            <Action
              label={
                kind === 'document' ? '📄 Elegir PDF' : kind === 'audio' ? '🎵 Elegir audio' : kind === 'video' ? '🎞️ Elegir video'
                  : multiple ? (files.length ? '➕ Agregar más archivos' : '📎 Elegir archivos') : '📎 Elegir archivo'
              }
              secondary={kind !== 'file' && kind !== 'multifile'}
              onPress={() => void pickDocument()}
              hasError={hasError && !files.length}
            />
          ) : null}
        </View>
      )}

      <AudioRecorderModal
        visible={recording}
        maxSeconds={maxSeconds ?? 600}
        onCancel={() => setRecording(false)}
        onDone={(uri) => {
          setRecording(false);
          void addFiles([{ uri, name: `audio_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.m4a`, mimeType: 'audio/mp4' }], 'audio');
        }}
      />
    </View>
  );
}

function Action({ label, onPress, secondary, hasError }: { label: string; onPress: () => void; secondary?: boolean; hasError?: boolean }) {
  return (
    <TouchableOpacity
      style={[styles.action, secondary && styles.actionSecondary, hasError && { borderColor: colors.error }]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.actionText, secondary && styles.actionTextSecondary]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fileRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.background, borderRadius: borderRadius.md ?? 8, padding: spacing.sm, marginBottom: spacing.xs },
  icon: { fontSize: 24, marginRight: spacing.sm },
  fileInfo: { flex: 1 },
  fileName: { fontSize: fontSize.body, fontWeight: '600', color: colors.textPrimary },
  fileMeta: { fontSize: fontSize.caption, color: colors.textSecondary },
  remove: { color: colors.error, fontWeight: '600', padding: spacing.xs },
  actions: { gap: spacing.xs },
  action: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary, borderRadius: borderRadius.md ?? 8, paddingVertical: spacing.md, alignItems: 'center' },
  actionSecondary: { backgroundColor: colors.surface },
  actionText: { color: colors.textOnPrimary, fontWeight: '700', fontSize: fontSize.subtitle },
  actionTextSecondary: { color: colors.primary },
});
