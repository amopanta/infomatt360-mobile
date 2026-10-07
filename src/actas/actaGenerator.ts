/**
 * Generador de Actas PDF — InfoMatt360 Mobile.
 *
 * Genera documentos PDF oficiales ("actas") con:
 *   - Datos del participante (nombre, CC, código)
 *   - Nombre del formulario y fecha de aplicación
 *   - Respuestas de todos los campos capturados
 *   - Imágenes de huellas dactilares VISIBLES
 *   - Firma digital si fue capturada
 *   - Coordenadas GPS de la captura
 *
 * Usa PDF 1.4 puro — sin librerías externas.
 * Compatible con Hermes (sin atob/btoa).
 *
 * La huella debe ser VISIBLE y prominente en el acta,
 * accesible tanto por fileUri (disco) como remote_url (servidor).
 */

import * as FileSystem from 'expo-file-system/legacy';
import type { RecordValue } from '../types';

// ── Tipos ───────────────────────────────────────────────────────────

export interface ActaParticipant {
  full_name: string;
  document_type: string;
  document_number: string;
  code: string;
  phone?: string | null;
  email?: string | null;
}

export interface ActaEvidence {
  type: 'fingerprint' | 'signature' | 'photo';
  file_uri: string;
  hand?: 'left' | 'right';
  mime_type: string;
}

export interface ActaData {
  /** Nombre de la organización / proyecto */
  organizationName: string;
  projectName: string;
  /** Datos del participante */
  participant: ActaParticipant;
  /** Nombre del formulario */
  formName: string;
  /** Fecha de aplicación */
  appliedAt: string;
  /** Respuestas del formulario */
  values: RecordValue[];
  /** Mapa de field_id → label legible */
  fieldLabels: Map<string, string>;
  /** Evidencias (huellas, firma, fotos) */
  evidence: ActaEvidence[];
  /** GPS */
  gps?: { lat: number; lng: number; accuracy: number } | null;
  /** Nombre del usuario que capturó */
  capturedBy: string;
}

// ── Constantes de página ────────────────────────────────────────────

const PAGE_W = 595;   // A4 en puntos
const PAGE_H = 842;
const MARGIN_L = 50;
const MARGIN_R = 50;
const MARGIN_T = 50;
const MARGIN_B = 60;
const CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R;
const LINE_HEIGHT = 16;
const SECTION_GAP = 12;

// ── Generador principal ─────────────────────────────────────────────

export async function generateActaPdf(data: ActaData): Promise<string> {
  // Cargar imágenes de evidencia
  const loadedImages: {
    type: string;
    hand?: string;
    bytes: Uint8Array;
    width: number;
    height: number;
    isJpeg: boolean;
  }[] = [];

  for (const ev of data.evidence) {
    if (ev.type === 'fingerprint' || ev.type === 'signature') {
      try {
        const info = await FileSystem.getInfoAsync(ev.file_uri);
        if (!info.exists) continue;

        const b64 = await FileSystem.readAsStringAsync(ev.file_uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const bytes = base64ToBytes(b64);
        const isJpeg = ev.mime_type === 'image/jpeg' || ev.file_uri.endsWith('.jpg') || ev.file_uri.endsWith('.jpeg');

        // Determinar dimensiones de la imagen
        let w = 150, h = 150;
        if (isJpeg) {
          const dims = getJpegDimensions(bytes);
          if (dims) { w = dims.width; h = dims.height; }
        } else {
          const dims = getPngDimensions(bytes);
          if (dims) { w = dims.width; h = dims.height; }
        }

        loadedImages.push({
          type: ev.type,
          hand: ev.hand,
          bytes,
          width: w,
          height: h,
          isJpeg,
        });
      } catch {
        // Si no puede leer la imagen, continuar sin ella
      }
    }
  }

  // ── Construir contenido del acta como líneas de texto ──────────

  interface ContentLine {
    text: string;
    fontSize: number;
    bold: boolean;
    indent?: number;
    spaceBefore?: number;
    spaceAfter?: number;
    align?: 'left' | 'center';
  }

  interface ContentImage {
    imageIndex: number;
    label: string;
    maxWidth: number;
    maxHeight: number;
    spaceBefore?: number;
  }

  type ContentItem =
    | { kind: 'line'; line: ContentLine }
    | { kind: 'image'; image: ContentImage }
    | { kind: 'separator' };

  const items: ContentItem[] = [];

  const addLine = (text: string, opts?: Partial<ContentLine>) => {
    items.push({
      kind: 'line',
      line: {
        text,
        fontSize: opts?.fontSize ?? 10,
        bold: opts?.bold ?? false,
        indent: opts?.indent,
        spaceBefore: opts?.spaceBefore,
        spaceAfter: opts?.spaceAfter,
        align: opts?.align,
      },
    });
  };

  const addSeparator = () => items.push({ kind: 'separator' });

  // ── ENCABEZADO ──
  addLine('ACTA DE REGISTRO', { fontSize: 16, bold: true, align: 'center', spaceAfter: 4 });
  addLine(data.organizationName.toUpperCase(), { fontSize: 10, bold: true, align: 'center' });
  addLine(`Proyecto: ${data.projectName}`, { fontSize: 10, align: 'center', spaceAfter: 8 });

  addSeparator();

  // ── DATOS DEL PARTICIPANTE ──
  addLine('DATOS DEL PARTICIPANTE', { fontSize: 12, bold: true, spaceBefore: SECTION_GAP, spaceAfter: 4 });
  addLine(`Nombre completo: ${data.participant.full_name}`, { indent: 10 });
  addLine(`Documento: ${data.participant.document_type} ${formatDocNumber(data.participant.document_number)}`, { indent: 10 });
  addLine(`Codigo: ${data.participant.code}`, { indent: 10 });
  if (data.participant.phone) {
    addLine(`Telefono: ${data.participant.phone}`, { indent: 10 });
  }
  if (data.participant.email) {
    addLine(`Correo: ${data.participant.email}`, { indent: 10 });
  }

  addSeparator();

  // ── INFORMACIÓN DEL FORMULARIO ──
  addLine('FORMULARIO APLICADO', { fontSize: 12, bold: true, spaceBefore: SECTION_GAP, spaceAfter: 4 });
  addLine(`Formulario: ${data.formName}`, { indent: 10 });
  addLine(`Fecha de aplicacion: ${formatDate(data.appliedAt)}`, { indent: 10 });
  addLine(`Capturado por: ${data.capturedBy}`, { indent: 10 });
  if (data.gps) {
    addLine(`Ubicacion GPS: ${data.gps.lat.toFixed(6)}, ${data.gps.lng.toFixed(6)} (±${Math.round(data.gps.accuracy)}m)`, { indent: 10 });
  }

  addSeparator();

  // ── RESPUESTAS DEL FORMULARIO ──
  addLine('RESPUESTAS', { fontSize: 12, bold: true, spaceBefore: SECTION_GAP, spaceAfter: 4 });

  for (const rv of data.values) {
    const label = data.fieldLabels.get(rv.field_id) ?? rv.field_name ?? rv.field_id;
    const val = rv.field_value_json;

    // Omitir campos de tipo fingerprint/signature/photo del listado de texto
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const obj = val as Record<string, unknown>;
      if (obj.type === 'fingerprint' || obj.type === 'signature' || obj.dataUri || obj.uri) {
        // Se muestran como imágenes más abajo
        addLine(`${label}: [Ver imagen adjunta]`, { indent: 10 });
        continue;
      }
    }

    const formatted = formatFieldValue(val);
    // Manejar valores largos dividiéndolos en líneas
    const maxChars = 80;
    if (formatted.length > maxChars) {
      addLine(`${label}:`, { indent: 10, bold: true });
      const words = formatted.split(' ');
      let currentLine = '';
      for (const word of words) {
        if ((currentLine + ' ' + word).trim().length > maxChars) {
          addLine(currentLine.trim(), { indent: 20 });
          currentLine = word;
        } else {
          currentLine += ' ' + word;
        }
      }
      if (currentLine.trim()) {
        addLine(currentLine.trim(), { indent: 20 });
      }
    } else {
      addLine(`${label}: ${formatted}`, { indent: 10 });
    }
  }

  // ── HUELLAS DACTILARES ──
  const fingerprintImages = loadedImages.filter((img) => img.type === 'fingerprint');
  if (fingerprintImages.length > 0) {
    addSeparator();
    addLine('HUELLAS DACTILARES', { fontSize: 12, bold: true, spaceBefore: SECTION_GAP, spaceAfter: 8 });

    for (let i = 0; i < fingerprintImages.length; i++) {
      const fp = fingerprintImages[i];
      const handLabel = fp.hand === 'left' ? 'Mano izquierda' : fp.hand === 'right' ? 'Mano derecha' : 'Huella';
      items.push({
        kind: 'image',
        image: {
          imageIndex: loadedImages.indexOf(fp),
          label: handLabel,
          maxWidth: 180,
          maxHeight: 180,
          spaceBefore: i > 0 ? 8 : 0,
        },
      });
    }
  }

  // ── FIRMA ──
  const signatureImages = loadedImages.filter((img) => img.type === 'signature');
  if (signatureImages.length > 0) {
    addSeparator();
    addLine('FIRMA', { fontSize: 12, bold: true, spaceBefore: SECTION_GAP, spaceAfter: 8 });

    for (const sig of signatureImages) {
      items.push({
        kind: 'image',
        image: {
          imageIndex: loadedImages.indexOf(sig),
          label: 'Firma del participante',
          maxWidth: 250,
          maxHeight: 100,
        },
      });
    }
  }

  // ── PIE DE PÁGINA (fecha de generación) ──
  addSeparator();
  addLine(`Documento generado el ${new Date().toLocaleString('es-CO')}`, {
    fontSize: 8,
    spaceBefore: 8,
    align: 'center',
  });
  addLine('InfoMatt360 — Sistema de gestion territorial', {
    fontSize: 8,
    align: 'center',
  });

  // ══════════════════════════════════════════════════════════════════
  // CONSTRUIR PDF
  // ══════════════════════════════════════════════════════════════════

  const pdf = new PdfBuilder();

  // Registrar font Helvetica (built-in, no embedding)
  const fontRegular = pdf.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = pdf.addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  // Registrar imágenes como XObjects
  const imageObjNums: number[] = [];
  for (const img of loadedImages) {
    const filter = img.isJpeg ? '/DCTDecode' : '/FlateDecode';
    const colorSpace = '/DeviceRGB';
    const objNum = pdf.addStreamObject(
      `<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} ` +
      `/ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter ${filter} /Length ${img.bytes.length} >>`,
      img.bytes,
    );
    imageObjNums.push(objNum);
  }

  // ── Paginar el contenido ──────────────────────────────────────

  // Primero, calcular la altura de cada item
  interface MeasuredItem {
    item: ContentItem;
    height: number;
  }

  const measured: MeasuredItem[] = items.map((item) => {
    if (item.kind === 'line') {
      const l = item.line;
      const h = (l.spaceBefore ?? 0) + l.fontSize * 1.3 + (l.spaceAfter ?? 0);
      return { item, height: h };
    } else if (item.kind === 'image') {
      const img = loadedImages[item.image.imageIndex];
      if (!img) return { item, height: 0 };
      const aspect = img.width / img.height;
      let drawW = Math.min(item.image.maxWidth, CONTENT_W);
      let drawH = drawW / aspect;
      if (drawH > item.image.maxHeight) {
        drawH = item.image.maxHeight;
        drawW = drawH * aspect;
      }
      // label line + image + spacing
      const h = (item.image.spaceBefore ?? 0) + 14 + drawH + 8;
      return { item, height: h };
    } else {
      // separator
      return { item, height: 8 };
    }
  });

  // Dividir en páginas
  const usableH = PAGE_H - MARGIN_T - MARGIN_B;
  const pages: MeasuredItem[][] = [[]];
  let currentPageH = 0;

  for (const m of measured) {
    if (currentPageH + m.height > usableH && pages[pages.length - 1].length > 0) {
      pages.push([]);
      currentPageH = 0;
    }
    pages[pages.length - 1].push(m);
    currentPageH += m.height;
  }

  // ── Renderizar cada página ────────────────────────────────────

  const pageObjNums: number[] = [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const pageItems = pages[pageIdx];

    // Build content stream
    let stream = '';
    let y = PAGE_H - MARGIN_T;
    const usedImages: Set<number> = new Set();

    for (const { item } of pageItems) {
      if (item.kind === 'line') {
        const l = item.line;
        y -= (l.spaceBefore ?? 0);

        const font = l.bold ? 'F2' : 'F1';
        const x = l.indent ? MARGIN_L + l.indent : MARGIN_L;

        let textX = x;
        if (l.align === 'center') {
          // Approximate text width: fontSize * 0.5 * chars
          const approxWidth = l.fontSize * 0.5 * l.text.length;
          textX = MARGIN_L + (CONTENT_W - approxWidth) / 2;
          if (textX < MARGIN_L) textX = MARGIN_L;
        }

        y -= l.fontSize; // baseline

        stream += `BT /${font} ${l.fontSize} Tf ${textX.toFixed(1)} ${y.toFixed(1)} Td (${escapePdfText(l.text)}) Tj ET\n`;

        y -= (l.spaceAfter ?? 0);
        y -= (l.fontSize * 0.3); // line gap
      } else if (item.kind === 'image') {
        const imgInfo = item.image;
        y -= (imgInfo.spaceBefore ?? 0);

        const img = loadedImages[imgInfo.imageIndex];
        if (!img) continue;

        // Draw label
        y -= 12;
        stream += `BT /F2 10 Tf ${MARGIN_L.toFixed(1)} ${y.toFixed(1)} Td (${escapePdfText(imgInfo.label)}) Tj ET\n`;
        y -= 4;

        // Draw image
        const aspect = img.width / img.height;
        let drawW = Math.min(imgInfo.maxWidth, CONTENT_W);
        let drawH = drawW / aspect;
        if (drawH > imgInfo.maxHeight) {
          drawH = imgInfo.maxHeight;
          drawW = drawH * aspect;
        }

        // Draw border around image
        const imgX = MARGIN_L;
        const imgY = y - drawH;
        stream += `q 0.8 0.8 0.8 RG 0.5 w ${(imgX - 2).toFixed(1)} ${(imgY - 2).toFixed(1)} ${(drawW + 4).toFixed(1)} ${(drawH + 4).toFixed(1)} re S Q\n`;

        // Draw image
        stream += `q ${drawW.toFixed(1)} 0 0 ${drawH.toFixed(1)} ${imgX.toFixed(1)} ${imgY.toFixed(1)} cm /Img${imgInfo.imageIndex} Do Q\n`;

        usedImages.add(imgInfo.imageIndex);
        y = imgY - 8;
      } else {
        // separator
        y -= 4;
        stream += `q 0.85 0.85 0.85 RG 0.5 w ${MARGIN_L} ${y.toFixed(1)} m ${(PAGE_W - MARGIN_R).toFixed(1)} ${y.toFixed(1)} l S Q\n`;
        y -= 4;
      }
    }

    // Page footer: page number
    const footerText = `Pagina ${pageIdx + 1} de ${pages.length}`;
    stream += `BT /F1 8 Tf ${(PAGE_W / 2 - 30).toFixed(1)} ${(MARGIN_B - 20).toFixed(1)} Td (${escapePdfText(footerText)}) Tj ET\n`;

    const contentObjNum = pdf.addObject(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );

    // Build Resources dict with fonts + used images
    let xobjectDict = '';
    for (const imgIdx of usedImages) {
      xobjectDict += ` /Img${imgIdx} ${imageObjNums[imgIdx]} 0 R`;
    }

    const resourcesStr =
      `<< /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> ` +
      (xobjectDict ? `/XObject <<${xobjectDict} >> ` : '') +
      '>>';

    const pageObjNum = pdf.addObject(
      `<< /Type /Page /Parent 2 0 R ` +
      `/MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Contents ${contentObjNum} 0 R ` +
      `/Resources ${resourcesStr} >>`,
    );
    pageObjNums.push(pageObjNum);
  }

  // Finalizar PDF
  const pdfBase64 = pdf.finalize(pageObjNums);

  // Guardar archivo
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeName = data.participant.document_number.replace(/\s/g, '');
  const fileName = `acta_${safeName}_${timestamp}.pdf`;

  const outputDir = `${FileSystem.documentDirectory}actas/`;
  await FileSystem.makeDirectoryAsync(outputDir, { intermediates: true });
  const outputPath = `${outputDir}${fileName}`;

  await FileSystem.writeAsStringAsync(outputPath, pdfBase64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return outputPath;
}

// ══════════════════════════════════════════════════════════════════════
// PDF Builder — maneja objetos, streams binarios, xref y trailer
// ══════════════════════════════════════════════════════════════════════

class PdfBuilder {
  private objects: (string | { header: string; data: Uint8Array; footer: string })[] = [];

  constructor() {
    // Obj 1: Catalog (siempre)
    this.addObject('<< /Type /Catalog /Pages 2 0 R >>');
    // Obj 2: Pages placeholder
    this.objects.push(''); // se llena en finalize()
  }

  /** Agrega un objeto texto y devuelve su número (1-based) */
  addObject(content: string): number {
    const objNum = this.objects.length + 1;
    this.objects.push(`${objNum} 0 obj\n${content}\nendobj\n`);
    return objNum;
  }

  /** Agrega un objeto con stream binario (para imágenes) */
  addStreamObject(dict: string, data: Uint8Array): number {
    const objNum = this.objects.length + 1;
    const header = `${objNum} 0 obj\n${dict}\nstream\n`;
    const footer = '\nendstream\nendobj\n';
    this.objects.push({ header, data, footer });
    return objNum;
  }

  /** Genera el PDF completo como base64 */
  finalize(pageObjNums: number[]): string {
    // Llenar Pages (Obj 2)
    const kidsStr = pageObjNums.map((n) => `${n} 0 R`).join(' ');
    const pagesContent = `<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjNums.length} >>`;
    this.objects[1] = `2 0 obj\n${pagesContent}\nendobj\n`;

    // Calcular offsets
    const headerStr = '%PDF-1.4\n';
    let pos = byteLength(headerStr);
    const offsets: number[] = [];

    for (const obj of this.objects) {
      offsets.push(pos);
      if (typeof obj === 'string') {
        pos += byteLength(obj);
      } else {
        pos += byteLength(obj.header) + obj.data.length + byteLength(obj.footer);
      }
    }

    // Xref
    const xrefOffset = pos;
    let xref = `xref\n0 ${this.objects.length + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (const offset of offsets) {
      xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }

    const trailer =
      `trailer\n<< /Size ${this.objects.length + 1} /Root 1 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF`;

    // Ensamblar
    const parts: (string | Uint8Array)[] = [headerStr];
    for (const obj of this.objects) {
      if (typeof obj === 'string') {
        parts.push(obj);
      } else {
        parts.push(obj.header);
        parts.push(obj.data);
        parts.push(obj.footer);
      }
    }
    parts.push(xref);
    parts.push(trailer);

    // Combinar en Uint8Array
    let totalLen = 0;
    const encoded: Uint8Array[] = parts.map((p) => {
      if (typeof p === 'string') {
        const b = stringToBytes(p);
        totalLen += b.length;
        return b;
      }
      totalLen += p.length;
      return p;
    });

    const allBytes = new Uint8Array(totalLen);
    let writePos = 0;
    for (const part of encoded) {
      allBytes.set(part, writePos);
      writePos += part.length;
    }

    return bytesToBase64(allBytes);
  }
}

// ══════════════════════════════════════════════════════════════════════
// Utilidades
// ══════════════════════════════════════════════════════════════════════

/** Escapa caracteres especiales para strings PDF () */
function escapePdfText(text: string): string {
  // Reemplazar caracteres especiales de PDF y caracteres no-Latin1
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    // Reemplazar acentos y caracteres especiales con equivalentes ASCII
    .replace(/á/g, 'a').replace(/Á/g, 'A')
    .replace(/é/g, 'e').replace(/É/g, 'E')
    .replace(/í/g, 'i').replace(/Í/g, 'I')
    .replace(/ó/g, 'o').replace(/Ó/g, 'O')
    .replace(/ú/g, 'u').replace(/Ú/g, 'U')
    .replace(/ñ/g, 'n').replace(/Ñ/g, 'N')
    .replace(/ü/g, 'u').replace(/Ü/g, 'U')
    // Eliminar caracteres fuera del rango Latin-1 básico
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x20-\x7E]/g, '');
}

function formatDocNumber(num: string): string {
  return num.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

function formatFieldValue(val: unknown): string {
  if (val === null || val === undefined) return '—';
  if (typeof val === 'boolean') return val ? 'Si' : 'No';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'string') return val || '—';
  if (Array.isArray(val)) return val.map((v) => formatFieldValue(v)).join(', ');
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (obj.lat && obj.lng) return `${obj.lat}, ${obj.lng}`;
    if (obj.label) return String(obj.label);
    if (obj.value) return String(obj.value);
    return JSON.stringify(val);
  }
  return String(val);
}

/** Lee dimensiones de un JPEG desde su cabecera SOF */
function getJpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2; // Skip SOI
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xFF) break;
    const marker = bytes[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      // SOF marker
      const height = (bytes[i + 5] << 8) | bytes[i + 6];
      const width = (bytes[i + 7] << 8) | bytes[i + 8];
      return { width, height };
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    i += 2 + len;
  }
  return null;
}

/** Lee dimensiones de un PNG desde su cabecera IHDR */
function getPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  // PNG signature: 8 bytes, then IHDR chunk
  if (bytes.length < 24) return null;
  // IHDR starts at byte 16 (8 sig + 4 length + 4 type)
  const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
  const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
  return { width, height };
}

// ── Utilidades de bajo nivel (Hermes-compatible) ────────────────────

function byteLength(str: string): number {
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
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const lookup = new Uint8Array(256);
  for (let i = 0; i < chars.length; i++) {
    lookup[chars.charCodeAt(i)] = i;
  }

  let len = base64.length;
  let bufferLength = Math.floor(len * 3 / 4);
  if (base64[len - 1] === '=') bufferLength--;
  if (base64[len - 2] === '=') bufferLength--;

  const bytes = new Uint8Array(bufferLength);
  let p = 0;

  for (let i = 0; i < len; i += 4) {
    const e1 = lookup[base64.charCodeAt(i)];
    const e2 = lookup[base64.charCodeAt(i + 1)];
    const e3 = lookup[base64.charCodeAt(i + 2)];
    const e4 = lookup[base64.charCodeAt(i + 3)];

    bytes[p++] = (e1 << 2) | (e2 >> 4);
    if (p < bufferLength) bytes[p++] = ((e2 & 15) << 4) | (e3 >> 2);
    if (p < bufferLength) bytes[p++] = ((e3 & 3) << 6) | (e4 & 63);
  }

  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
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
