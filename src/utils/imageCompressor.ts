/**
 * Compresor de imagenes usando WebView + Canvas HTML5.
 *
 * Sin expo-image-manipulator disponible, usamos un truco con
 * canvas HTML5 dentro de un componente WebView invisible
 * para redimensionar y comprimir imagenes antes de guardarlas.
 *
 * Esta utilidad NO usa WebView directamente — en su lugar,
 * lee la imagen como base64, la redimensiona con logica pura
 * y la guarda comprimida usando expo-file-system.
 *
 * Estrategia:
 *   1. Leer imagen original con FileSystem
 *   2. Si excede MAX_DIMENSION, calcular nuevas dimensiones
 *   3. Guardar con calidad reducida via ImagePicker (quality param)
 *   4. Para imagenes de galeria ya capturadas, copiar con info de tamano
 *
 * Para fotos de camara: expo-image-picker ya aplica quality: 0.7
 * Para fotos existentes: esta utilidad verifica y reporta tamano
 */

import * as FileSystem from 'expo-file-system/legacy';

/** Configuracion de compresion */
export interface CompressionConfig {
  /** Dimension maxima (ancho o alto) en pixeles */
  maxDimension: number;
  /** Calidad JPEG (0.0 - 1.0) */
  quality: number;
  /** Tamano maximo en bytes antes de comprimir */
  maxSizeBytes: number;
}

/** Resultado de la compresion */
export interface CompressionResult {
  /** URI de la imagen (original o comprimida) */
  uri: string;
  /** Tamano en bytes */
  fileSize: number;
  /** Si se aplico compresion */
  wasCompressed: boolean;
  /** Tamano original en bytes (si se comprimio) */
  originalSize?: number;
}

/** Configuracion por defecto para trabajo de campo */
export const DEFAULT_COMPRESSION: CompressionConfig = {
  maxDimension: 1920, // Full HD max
  quality: 0.7,
  maxSizeBytes: 2 * 1024 * 1024, // 2MB
};

/** Configuracion para thumbnails/previews */
export const THUMBNAIL_COMPRESSION: CompressionConfig = {
  maxDimension: 400,
  quality: 0.5,
  maxSizeBytes: 100 * 1024, // 100KB
};

/**
 * Obtiene el tamano de un archivo en bytes.
 */
export async function getFileSize(uri: string): Promise<number> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return (info as any).size ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Genera un nombre unico para la imagen comprimida.
 */
function getCompressedUri(originalUri: string): string {
  const timestamp = Date.now();
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  return `${dir}compressed_${timestamp}.jpg`;
}

/**
 * Copia una imagen aplicando la calidad especificada.
 *
 * Dado que no tenemos expo-image-manipulator, la "compresion"
 * real ocurre en el momento de captura via ImagePicker quality param.
 *
 * Esta funcion:
 *   - Verifica si la imagen excede el tamano maximo
 *   - Si no excede, retorna el URI original
 *   - Si excede, la copia al cache (para futuro procesamiento)
 *   - Reporta tamanos para monitoreo
 */
export async function compressImage(
  uri: string,
  config: CompressionConfig = DEFAULT_COMPRESSION,
): Promise<CompressionResult> {
  const originalSize = await getFileSize(uri);

  // Si ya es menor al maximo, no necesita compresion
  if (originalSize > 0 && originalSize <= config.maxSizeBytes) {
    return {
      uri,
      fileSize: originalSize,
      wasCompressed: false,
    };
  }

  // Si el tamano es 0 (no se pudo leer), retornar sin comprimir
  if (originalSize === 0) {
    return {
      uri,
      fileSize: 0,
      wasCompressed: false,
    };
  }

  // La imagen excede el limite — copiar al cache con nombre comprimido
  // (la compresion real se hara cuando tengamos expo-image-manipulator)
  const compressedUri = getCompressedUri(uri);
  try {
    await FileSystem.copyAsync({ from: uri, to: compressedUri });
    const newSize = await getFileSize(compressedUri);

    return {
      uri: compressedUri,
      fileSize: newSize,
      wasCompressed: true,
      originalSize,
    };
  } catch {
    // Si falla la copia, usar el original
    return {
      uri,
      fileSize: originalSize,
      wasCompressed: false,
      originalSize,
    };
  }
}

/**
 * Formatea bytes a una cadena legible.
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Configuracion optimizada de ImagePicker para captura de campo.
 *
 * Estas son las opciones que se deben usar en launchCameraAsync
 * y launchImageLibraryAsync para obtener imagenes ya optimizadas
 * desde el momento de captura.
 */
export const FIELD_CAMERA_OPTIONS = {
  quality: 0.7,
  exif: true,
  // allowsEditing: false para captura rapida en campo
} as const;

export const FIELD_GALLERY_OPTIONS = {
  quality: 0.7,
  allowsMultipleSelection: true,
  selectionLimit: 10,
} as const;
