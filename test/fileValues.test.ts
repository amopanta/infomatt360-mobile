import { describe, expect, it } from 'vitest';
import { acceptsMime, collectFileValues, mimeFor } from '../src/evidence/fileValues';

describe('evidencias en los valores del formulario (H04)', () => {
  it('encuentra archivos en campos, repeticiones y MULTIFILE sin repetir', () => {
    const photo = { uri: 'file:///ev/a.jpg', type: 'photo' };
    const found = collectFileValues({
      nombre: 'Ana',
      foto: photo,
      'hogar[0].foto': photo,
      soportes: [{ uri: 'file:///ev/b.pdf', type: 'file' }, { uri: 'content://x/c.mp4', type: 'video' }],
      firma: { dataUri: 'data:image/png;base64,AAA' },
      gps: { lat: 1, lng: 2 },
      huella: { dataUri: 'data:image/png;base64,BBB', fileUri: 'file:///fingerprints/h.png', type: 'fingerprint' },
    });
    expect(found.map((f) => f.uri)).toEqual(['file:///ev/a.jpg', 'file:///ev/b.pdf', 'content://x/c.mp4', 'file:///fingerprints/h.png']);
    expect(found[3].type).toBe('fingerprint');
  });

  it('el tipo MIME sale del archivo real, no siempre image/jpeg', () => {
    expect(mimeFor({ uri: 'file:///scanned_documents/doc.pdf', type: 'document' })).toBe('application/pdf');
    expect(mimeFor({ uri: 'file:///ev/1.m4a', type: 'audio' })).toBe('audio/mp4');
    expect(mimeFor({ uri: 'content://media/42', type: 'video', fileName: 'visita.MOV' })).toBe('video/quicktime');
    expect(mimeFor({ uri: 'file:///ev/x', type: 'file', mimeType: 'application/zip' })).toBe('application/zip');
  });

  it('valida el tipo según el campo, como el accept de la web', () => {
    expect(acceptsMime('AUDIO', 'audio/mp4')).toBe(true);
    expect(acceptsMime('AUDIO', 'video/mp4')).toBe(false);
    expect(acceptsMime('PDF', 'image/jpeg')).toBe(false);
    expect(acceptsMime('FILE', 'application/zip')).toBe(true);
  });
});
