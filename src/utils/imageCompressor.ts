/**
 * Compresor de imagenes usando re-codificacion base64.
 *
 * Sin expo-image-manipulator disponible, implementamos compresion
 * real leyendo la imagen, y para imagenes que exceden el limite,
 * generamos una version recodificada con menor calidad.
 *
 * Estrategia:
 *   1. Leer tamano de la imagen original
 *   2. Si esta por debajo del limite, retornar sin cambios
 *   3. Si excede, re-guardar con calidad reducida iterativamente
 *   4. Para fotos de camara: expo-image-picker ya aplica quality configurable
 *
 * Limitacion: sin expo-image-manipulator no podemos redimensionar,
 * pero podemos re-codificar JPEG con menor calidad via FileSystem,
 * y recomendar parametros de captura optimizados.
 */

import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

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

/** Lado mayor máximo de una foto de evidencia: suficiente para leer
 * documentos y reconocer lugares, y deja la mayoría bajo 2 MB. */
const MAX_DIMENSION = 1920;

/**
 * Comprime una foto volviéndola a codificar como JPEG (expo-image-manipulator).
 *
 * Si supera el tamaño máximo, reduce su lado mayor a MAX_DIMENSION y baja la
 * calidad en pasos hasta quedar por debajo. Nunca recorta bytes del archivo:
 * truncar un JPEG lo deja corrupto. Si algo falla, devuelve la original.
 */
export async function compressImage(
  uri: string,
  config: CompressionConfig = DEFAULT_COMPRESSION,
): Promise<CompressionResult> {
  const originalSize = await getFileSize(uri);

  // Si ya es menor al maximo (o no se pudo medir), se usa tal cual
  if (originalSize === 0 || originalSize <= config.maxSizeBytes) {
    return { uri, fileSize: originalSize, wasCompressed: false };
  }

  try {
    const context = ImageManipulator.manipulate(uri);
    const probe = await context.renderAsync();
    const longest = Math.max(probe.width, probe.height);
    if (longest > MAX_DIMENSION) {
      context.resize(probe.width >= probe.height ? { width: MAX_DIMENSION } : { height: MAX_DIMENSION });
    }
    const image = longest > MAX_DIMENSION ? await context.renderAsync() : probe;

    let best: CompressionResult | null = null;
    for (const quality of [config.quality, 0.55, 0.4]) {
      const saved = await image.saveAsync({ compress: quality, format: SaveFormat.JPEG });
      const size = await getFileSize(saved.uri);
      if (size > 0 && (!best || size < best.fileSize)) {
        best = { uri: saved.uri, fileSize: size, wasCompressed: true, originalSize };
      }
      if (size > 0 && size <= config.maxSizeBytes) break;
    }
    if (best && best.fileSize < originalSize) return best;
  } catch {
    // Formato no soportado o sin memoria: se conserva la foto original intacta
  }
  return { uri, fileSize: originalSize, wasCompressed: false, originalSize };
}

/**
 * Comprime multiples imagenes en paralelo.
 */
export async function compressImages(
  uris: string[],
  config: CompressionConfig = DEFAULT_COMPRESSION,
): Promise<CompressionResult[]> {
  return Promise.all(uris.map((uri) => compressImage(uri, config)));
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
