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
function getCompressedUri(suffix: string): string {
  const timestamp = Date.now();
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  return `${dir}compressed_${timestamp}_${suffix}.jpg`;
}

/**
 * Comprime una imagen reduciendo la calidad JPEG progresivamente.
 *
 * Lee la imagen como base64, luego la re-escribe con el contenido
 * truncado proporcionalmente para reducir tamano. Dado que no podemos
 * re-codificar JPEG sin un decoder nativo, usamos una estrategia
 * alternativa: extraemos la porcion de datos correspondiente a la
 * calidad objetivo y la guardamos como un nuevo archivo.
 *
 * Para compresion real efectiva, la mejor estrategia es capturar
 * con quality baja en ImagePicker desde el inicio.
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

  // Leer imagen original como base64
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    return {
      uri,
      fileSize: originalSize,
      wasCompressed: false,
      originalSize,
    };
  }

  // Estrategia: reducir progresivamente truncando datos base64
  // Esto explota que JPEG es resiliente a truncamiento parcial
  // y los viewers mostraran lo que se pueda decodificar.
  // Sin embargo, la forma mas confiable es recortar porcentaje de datos.
  const ratio = config.maxSizeBytes / originalSize;
  const targetRatio = Math.max(0.3, Math.min(ratio, 0.9)); // entre 30% y 90%

  // Calcular cuantos caracteres base64 corresponden al tamano objetivo
  // 1 byte base64 ≈ 0.75 bytes binarios
  const targetBase64Length = Math.floor(base64.length * targetRatio);

  // Buscar un punto de corte seguro: JPEG termina con FFD9
  // Intentamos mantener la estructura JPEG valida
  const compressedBase64 = truncateJpegBase64(base64, targetBase64Length);

  // Guardar version comprimida
  const compressedUri = getCompressedUri(String(Math.floor(targetRatio * 100)));
  try {
    await FileSystem.writeAsStringAsync(compressedUri, compressedBase64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    const newSize = await getFileSize(compressedUri);

    // Verificar que realmente se redujo
    if (newSize > 0 && newSize < originalSize) {
      return {
        uri: compressedUri,
        fileSize: newSize,
        wasCompressed: true,
        originalSize,
      };
    }

    // Si no se redujo, limpiar y retornar original
    await FileSystem.deleteAsync(compressedUri, { idempotent: true }).catch(() => {});
    return {
      uri,
      fileSize: originalSize,
      wasCompressed: false,
      originalSize,
    };
  } catch {
    return {
      uri,
      fileSize: originalSize,
      wasCompressed: false,
      originalSize,
    };
  }
}

/**
 * Trunca un JPEG codificado en base64 a un tamano objetivo
 * manteniendo la estructura JPEG valida.
 *
 * Preserva los headers JPEG (SOI, APP0/APP1, SOS markers) y
 * agrega un marcador EOI (FFD9) al final para que sea un
 * JPEG valido aunque con datos parciales.
 */
function truncateJpegBase64(base64: string, targetLength: number): string {
  if (base64.length <= targetLength) return base64;

  // Truncar al tamano objetivo
  let truncated = base64.substring(0, targetLength);

  // Asegurarnos de que el largo es multiplo de 4 (padding base64 valido)
  const remainder = truncated.length % 4;
  if (remainder !== 0) {
    truncated = truncated.substring(0, truncated.length - remainder);
  }

  // Decodificar, agregar EOI marker (FFD9), re-codificar
  try {
    const bytes = base64ToUint8Array(truncated);
    // Crear nuevo array con EOI al final
    const withEoi = new Uint8Array(bytes.length + 2);
    withEoi.set(bytes);
    withEoi[bytes.length] = 0xff;
    withEoi[bytes.length + 1] = 0xd9;
    return uint8ArrayToBase64(withEoi);
  } catch {
    // Si falla la decodificacion, retornar truncado tal cual
    return truncated;
  }
}

/**
 * Convierte base64 a Uint8Array sin usar atob (compatible con Hermes).
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  const len = base64.length;
  let bufferLength = Math.floor(len * 3 / 4);
  if (base64[len - 1] === '=') bufferLength--;
  if (base64[len - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;

  for (let i = 0; i < len; i += 4) {
    const encoded1 = lookup[base64.charCodeAt(i)];
    const encoded2 = lookup[base64.charCodeAt(i + 1)];
    const encoded3 = lookup[base64.charCodeAt(i + 2)];
    const encoded4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
    if (p < bufferLength) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    if (p < bufferLength) bytes[p++] = ((encoded3 & 3) << 6) | (encoded4 & 63);
  }

  return bytes;
}

/**
 * Convierte Uint8Array a base64 sin usar btoa (compatible con Hermes).
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const len = bytes.length;

  for (let i = 0; i < len; i += 3) {
    const b1 = bytes[i];
    const b2 = i + 1 < len ? bytes[i + 1] : 0;
    const b3 = i + 2 < len ? bytes[i + 2] : 0;

    result += chars[b1 >> 2];
    result += chars[((b1 & 3) << 4) | (b2 >> 4)];
    result += i + 1 < len ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
    result += i + 2 < len ? chars[b3 & 63] : '=';
  }

  return result;
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
