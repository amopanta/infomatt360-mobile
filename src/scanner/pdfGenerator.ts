/**
 * Generador de PDF minimalista sin dependencias externas.
 *
 * Crea un PDF valido a partir de imagenes JPEG capturadas por la camara.
 * Usa la especificacion PDF 1.4 directamente: cada imagen se embebe
 * como un XObject y se renderiza a pagina completa.
 *
 * Limitacion: solo soporta JPEG (lo que devuelve expo-image-picker).
 */

import * as FileSystem from 'expo-file-system/legacy';

interface PageImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Genera un archivo PDF a partir de imagenes JPEG.
 * @returns URI del archivo PDF generado
 */
export async function generatePdfFromImages(
  pages: PageImage[],
  outputFileName: string,
): Promise<string> {
  if (pages.length === 0) throw new Error('No hay paginas para generar PDF');

  // Leer todas las imagenes como base64
  const imageDataList: { base64: string; width: number; height: number }[] = [];
  for (const page of pages) {
    const base64 = await FileSystem.readAsStringAsync(page.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    imageDataList.push({
      base64,
      width: page.width,
      height: page.height,
    });
  }

  // Construir el PDF
  const pdfBytes = buildPdf(imageDataList);

  // Guardar archivo
  const outputDir = `${FileSystem.documentDirectory}scanned_documents/`;
  await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
  const outputPath = `${outputDir}${outputFileName}`;

  await FileSystem.writeAsStringAsync(outputPath, pdfBytes, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return outputPath;
}

/**
 * Construye un PDF binario como string base64.
 *
 * Estructura PDF simplificada:
 *   - Header
 *   - Objetos: Catalog, Pages, cada Page + Image XObject
 *   - Cross-reference table
 *   - Trailer
 */
function buildPdf(
  images: { base64: string; width: number; height: number }[],
): string {
  // Decodificar base64 a bytes
  const imageBytes: Uint8Array[] = images.map((img) => base64ToBytes(img.base64));

  // Tamano de pagina: ajustamos al tamano de la imagen escalando a A4-ish
  // pero mantenemos la proporcion. Usamos puntos PDF (72 DPI).
  const PAGE_WIDTH = 595; // ~A4
  const PAGE_HEIGHT = 842;

  const objects: string[] = [];
  const offsets: number[] = [];
  let currentOffset = 0;

  // Helper para agregar un objeto PDF
  const addObj = (content: string) => {
    const objNum = objects.length + 1;
    const obj = `${objNum} 0 obj\n${content}\nendobj\n`;
    offsets.push(currentOffset);
    currentOffset += byteLength(obj);
    objects.push(obj);
    return objNum;
  };

  // Obj 1: Catalog
  const catalogObj = addObj(`<< /Type /Catalog /Pages 2 0 R >>`);

  // Reservar Obj 2 para Pages (lo llenamos despues)
  objects.push(''); // placeholder
  offsets.push(0);
  const pagesObjNum = 2;

  // Para cada imagen: crear un Image XObject y una Page
  const pageObjNums: number[] = [];

  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    const imgData = imageBytes[i];

    // Calcular dimensiones de la imagen en la pagina
    const imgAspect = img.width / img.height;
    const pageAspect = PAGE_WIDTH / PAGE_HEIGHT;
    let drawW: number, drawH: number;
    if (imgAspect > pageAspect) {
      drawW = PAGE_WIDTH;
      drawH = PAGE_WIDTH / imgAspect;
    } else {
      drawH = PAGE_HEIGHT;
      drawW = PAGE_HEIGHT * imgAspect;
    }

    // Centrar en la pagina
    const offsetX = (PAGE_WIDTH - drawW) / 2;
    const offsetY = (PAGE_HEIGHT - drawH) / 2;

    // Image XObject (stream con los bytes JPEG)
    const imgObjNum = objects.length + 1;
    const imgDict =
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgData.length} >>`;
    const imgObjStr = `${imgObjNum} 0 obj\n${imgDict}\nstream\n`;
    const imgObjEnd = `\nendstream\nendobj\n`;

    offsets.push(currentOffset);
    currentOffset += byteLength(imgObjStr) + imgData.length + byteLength(imgObjEnd);
    objects.push({ header: imgObjStr, data: imgData, footer: imgObjEnd } as any);

    // Content stream: dibuja la imagen
    const contentStr = `q ${drawW.toFixed(2)} 0 0 ${drawH.toFixed(2)} ${offsetX.toFixed(2)} ${offsetY.toFixed(2)} cm /Img${i} Do Q`;
    const contentObjNum = addObj(
      `<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream`,
    );

    // Page object
    const pageObjNum = addObj(
      `<< /Type /Page /Parent ${pagesObjNum} 0 R ` +
      `/MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Contents ${contentObjNum} 0 R ` +
      `/Resources << /XObject << /Img${i} ${imgObjNum} 0 R >> >> >>`,
    );
    pageObjNums.push(pageObjNum);
  }

  // Ahora llenar el Pages object (Obj 2)
  const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(' ');
  const pagesContent = `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjNums.length} >>`;
  const pagesObj = `${pagesObjNum} 0 obj\n${pagesContent}\nendobj\n`;
  offsets[pagesObjNum - 1] = 0; // se recalcula abajo
  objects[pagesObjNum - 1] = pagesObj;

  // Recalcular offsets
  let pos = byteLength('%PDF-1.4\n');
  for (let i = 0; i < objects.length; i++) {
    offsets[i] = pos;
    const obj = objects[i];
    if (typeof obj === 'string') {
      pos += byteLength(obj);
    } else {
      // Binary image object
      const binObj = obj as any as { header: string; data: Uint8Array; footer: string };
      pos += byteLength(binObj.header) + binObj.data.length + byteLength(binObj.footer);
    }
  }

  // Build xref y trailer
  const xrefOffset = pos;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += `0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }

  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj} 0 R >>\n` +
    `startxref\n${xrefOffset}\n%%EOF`;

  // Ensamblar todo como bytes y convertir a base64
  const parts: (string | Uint8Array)[] = ['%PDF-1.4\n'];
  for (const obj of objects) {
    if (typeof obj === 'string') {
      parts.push(obj);
    } else {
      const binObj = obj as any as { header: string; data: Uint8Array; footer: string };
      parts.push(binObj.header);
      parts.push(binObj.data);
      parts.push(binObj.footer);
    }
  }
  parts.push(xref);
  parts.push(trailer);

  // Combinar en un solo Uint8Array
  let totalLen = 0;
  const encodedParts: Uint8Array[] = parts.map((p) => {
    if (typeof p === 'string') {
      const bytes = stringToBytes(p);
      totalLen += bytes.length;
      return bytes;
    }
    totalLen += p.length;
    return p;
  });

  const allBytes = new Uint8Array(totalLen);
  let writePos = 0;
  for (const part of encodedParts) {
    allBytes.set(part, writePos);
    writePos += part.length;
  }

  return bytesToBase64(allBytes);
}

// ── Utilidades de bajo nivel ──────────────────────────────────────────

function byteLength(str: string): number {
  // PDF strings son Latin-1 mayormente, 1 byte por caracter
  let len = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) len += 1;
    else if (code < 0x800) len += 2;
    else len += 3;
  }
  return len;
}

function stringToBytes(str: string): Uint8Array {
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return new Uint8Array(bytes);
}

function base64ToBytes(base64: string): Uint8Array {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
