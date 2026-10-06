# Arquitectura de InfoMatt360 Mobile

## Modelo de datos local (SQLite)

### Tablas

#### `form_templates`
Cache local de plantillas de formularios descargadas del backend.

| Columna | Tipo | Descripción |
|---|---|---|
| id | INTEGER PK | ID del template en el backend |
| template_id | TEXT | UUID del template |
| version | INTEGER | Versión del esquema |
| name | TEXT | Nombre del formulario |
| project_id | INTEGER | Proyecto al que pertenece |
| schema_json | TEXT | JSON Schema completo (páginas, secciones, campos) |
| updated_at | TEXT | Última actualización |

#### `queued_records`
Cola offline de registros capturados pendientes de sincronización.

| Columna | Tipo | Descripción |
|---|---|---|
| local_id | TEXT PK | UUID v4 generado localmente |
| project_id | INTEGER | Proyecto |
| template_id | INTEGER | Formulario usado |
| participant_id | INTEGER | Participante (opcional) |
| status | TEXT | `pending` → `syncing` → `synced` / `error` / `conflict` |
| data_json | TEXT | Valores capturados como JSON (`RecordValue[]`) |
| evidence_paths_json | TEXT | Array JSON de rutas locales de archivos |
| gps_json | TEXT | `{lat, lng, accuracy}` |
| error_message | TEXT | Mensaje si status = error |
| created_at | TEXT | Timestamp de creación |
| synced_at | TEXT | Timestamp de sincronización exitosa |

#### `evidence`
Archivos de evidencia (fotos, videos, huellas, firmas, documentos).

| Columna | Tipo | Descripción |
|---|---|---|
| local_id | TEXT PK | UUID v4 |
| record_local_id | TEXT FK | Registro al que pertenece |
| type | TEXT | `photo`, `video`, `audio`, `document`, `signature`, `fingerprint` |
| file_uri | TEXT | Ruta local del archivo en el dispositivo |
| remote_url | TEXT | URL en el backend después de subir |
| mime_type | TEXT | Tipo MIME del archivo |
| file_size | INTEGER | Tamaño en bytes |
| gps_json | TEXT | Geolocalización de la captura |
| uploaded | INTEGER | 0 = pendiente, 1 = subido |
| created_at | TEXT | Timestamp |

#### `crash_logs`
Registro de errores capturados para diagnóstico.

| Columna | Tipo | Descripción |
|---|---|---|
| id | INTEGER PK | Autoincrement |
| severity | TEXT | `error`, `warning`, `info` |
| message | TEXT | Mensaje del error |
| stack | TEXT | Stack trace |
| context_json | TEXT | Contexto adicional |
| screen | TEXT | Pantalla donde ocurrió |
| created_at | TEXT | Timestamp |

## Flujo de sincronización

```
┌─────────────────┐
│  Captura offline │
│  (FormCapture)   │
└────────┬────────┘
         │ enqueueRecord() + insertEvidence()
         ▼
┌─────────────────┐
│   SQLite local   │
│  status=pending  │
└────────┬────────┘
         │ syncService (timer 30s, backoff hasta 5min)
         ▼
┌─────────────────┐     ┌─────────────────┐
│ uploadEvidence() │────▶│ POST /files/    │
│ (cada archivo)   │     │ upload          │
└────────┬────────┘     └─────────────────┘
         │ markEvidenceUploaded(localId, url)
         ▼
┌─────────────────┐     ┌─────────────────┐
│ bulkSaveRecords()│────▶│ POST /runtime/  │
│ (por template)   │     │ session/bulk-   │
└────────┬────────┘     │ save            │
         │              └─────────────────┘
         ▼
┌─────────────────┐
│   Resultado:     │
│ synced / error / │
│ conflict         │
└─────────────────┘
```

### Idempotencia

Cada lote de registros genera una clave SHA-256 a partir de los `local_id` ordenados. Si el backend ya procesó esa clave, retorna `replayed` sin duplicar datos.

### Conflictos

Cuando el backend detecta que un registro fue modificado tanto local como remotamente, retorna `conflict` con los valores del servidor. El usuario puede resolver eligiendo:
- **Mantener local** — Re-enviar los datos locales
- **Aceptar servidor** — Descartar cambios locales
- **Combinar** — Merge campo por campo

## Flujo de autenticación

```
┌──────────┐     ┌─────────────┐     ┌──────────────┐
│  Login   │────▶│ MFA verify  │────▶│ PIN setup/   │
│ (email+  │     │ (TOTP code) │     │ unlock       │
│ password)│     │ (si aplica) │     │ (4 dígitos)  │
└──────────┘     └─────────────┘     └──────┬───────┘
                                            │
                                            ▼
                                   ┌──────────────┐
                                   │ Project      │
                                   │ select       │
                                   │ (si >1)      │
                                   └──────┬───────┘
                                          │
                                          ▼
                                   ┌──────────────┐
                                   │ Main Tabs    │
                                   └──────────────┘
```

### Device fingerprint y asset lock

- `getDeviceFingerprint()` genera un UUID v4 la primera vez y lo persiste en `expo-secure-store`
- Se envía en `LoginRequest.device_fingerprint` y `MfaVerifyRequest.device_fingerprint`
- Si coincide con `User.locked_device_fingerprint` en el backend, el token se emite con expiración de 10 horas (sesión extendida para campo)
- Si no coincide o no se envía, la expiración es de 60 minutos (default)

### PIN

- Hash SHA-256 del PIN almacenado en SecureStore
- 5 intentos antes de lockout de 5 minutos
- Se ofrece configurar al primer login; se puede activar/desactivar en Settings

## Formularios dinámicos

Los formularios se definen por JSON Schema en el backend y se cachean localmente:

```
FormTemplate
  └── pages: FormPage[]
       └── sections: FormSection[]
            ├── repeatable?: boolean
            └── rows: FormRow[]
                 └── columns: FormColumn[]
                      └── components: FormComponent[]
                           ├── type: string
                           ├── label: string
                           ├── required?: boolean
                           ├── options?: {value, label}[]
                           ├── validations?: Record
                           └── conditionalVisibility?: {logic, rules[]}
```

### Tipos de campo soportados

| Tipo | Componente | Almacenamiento |
|---|---|---|
| `text` | TextInput | string |
| `number` | TextInput (numeric) | number |
| `select` | Picker/Radio | string |
| `multiselect` | Checkboxes | string[] |
| `date` | DateTimePicker | ISO string |
| `gps` | Auto-captura Location | `{lat, lng, accuracy}` |
| `photo` | ImagePicker (camera) | `{uri, type:'photo', fileSize}` |
| `signature` | SignatureCanvas modal | `{dataUri, type:'signature'}` |
| `fingerprint` | FingerprintModal | `{dataUri, fileUri, hand, method, type:'fingerprint'}` |
| `document` | DocumentScanner | `{uri, fileName, type:'document'}` |
| `textarea` | TextInput multiline | string |
| `checkbox` | Switch | boolean |

### Visibilidad condicional

Los campos pueden tener reglas de visibilidad basadas en valores de otros campos:

```typescript
conditionalVisibility: {
  logic: 'and' | 'or',
  rules: [
    { fieldId: 'tipo_vivienda', operator: 'eq', value: 'rural' },
    { fieldId: 'tiene_servicio', operator: 'eq', value: 'no' }
  ]
}
```

### Repeat groups (secciones repetibles)

Las secciones marcadas con `repeatable: true` permiten agregar/eliminar instancias. Cada instancia genera IDs de campo con formato `{sectionId}[{index}].{fieldId}`.

## Captura de huella digital

### Flujo de captura

```
┌──────────────────┐
│ FormCaptureScreen │
│ campo tipo        │
│ 'fingerprint'     │
└────────┬─────────┘
         │ onCaptureFingerprint(fieldId)
         ▼
┌──────────────────┐
│ FingerprintModal  │
│                   │
│ ┌─────┐ ┌─────┐  │
│ │📷   │ │👆   │  │
│ │Cam. │ │Táct.│  │
│ └─────┘ └─────┘  │
│                   │
│ ┌─────┐ ┌─────┐  │
│ │🤚   │ │ 🤚  │  │
│ │Izq. │ │Der. │  │
│ └─────┘ └─────┘  │
└────────┬─────────┘
         │ FingerprintResult
         ▼
┌──────────────────────────────────────┐
│ 1. Guarda dataUri en values[fieldId] │ ← preview inline
│ 2. Guarda fileUri en evidencePaths[] │ ← para evidence table
│ 3. Al submit: insertEvidence()       │ ← type='fingerprint'
│ 4. Sync: uploadEvidence()            │ ← POST /files/upload
│ 5. Backend: remote_url disponible    │ ← para actas
└──────────────────────────────────────┘
```

### Almacenamiento dual

La huella se almacena de dos formas complementarias:

1. **Inline en `data_json`** del registro — Como `dataUri` (base64) para preview rápido en el formulario y como `fileUri` para referencia al archivo
2. **En tabla `evidence`** — Como archivo independiente con `type='fingerprint'`, sincronizable al backend, accesible por `remote_url` para generación de actas

Esto garantiza que la imagen de la huella sea **visible** tanto para consulta directa como para inclusión en actas y reportes.

### Directorio de huellas

Los archivos se guardan en:
```
{documentDirectory}/fingerprints/fingerprint_{hand}_{method}_{timestamp}.{ext}
```

- Cámara: `.jpg` (JPEG, calidad 0.9)
- Táctil: `.png` (PNG, desde canvas)
