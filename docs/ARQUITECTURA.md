# Arquitectura de InfoMatt360 Mobile

## Modelo de datos local (SQLite)

Actualizado: 2026-10-18 (esquema real en `src/db/database.ts` y en los módulos indicados).

**Una base por usuario:** `infomatt360_u_<id>.db`. La base antigua
`infomatt360.db` la reclama el primer usuario que inicia sesión tras la
actualización. Al cambiar de usuario se abre su propia base; ningún gestor ve
capturas, participantes ni correcciones de otro en la misma tablet. La base
**no se cifra** (decisión del proyecto); `allowBackup:false` en `app.json`
impide copiarla con el respaldo de Android y el borrado remoto la elimina.

Los identificadores del servidor son UUID en texto.

| Tabla | Módulo | Contenido |
|---|---|---|
| `form_templates` | db | Plantillas publicadas: `schema_json`, `version`, `version_hash`, `access_mode`, `retired` |
| `queued_records` | db | Capturas, borradores y correcciones (ver estados abajo). Columnas: `data_json`, `evidence_paths_json`, `gps_json`, `server_record_id`, `server_data_json`, `lock_version`, `observations_json`, `draft_page`, `template_version` |
| `evidence` | db | Archivos locales (`photo`, `video`, `audio`, `document`, `signature`, `fingerprint`), `uploaded`, `remote_url` |
| `participants` | db | Participantes del paquete del proyecto |
| `form_assignments_cache` | db | Asignaciones formulario ↔ participante con su estado |
| `offline_packages` | db | Fecha y tamaño del último paquete por proyecto |
| `route_points` | db | Recorrido GPS de la jornada pendiente de enviar |
| `crash_logs` | db | Errores capturados para diagnóstico |
| `participant_history_cache` | participants/historyCache | Respuestas previas en solo lectura (máx. 300 por proyecto) |
| `app_settings` | store/settingsStore | Preferencias locales |
| `cases_cache`, `case_events_cache`, `case_outbox` | cases/caseStore | Casos sin conexión (H08). **Base creada, aún sin conectar a pantallas ni al servidor** |

### Estados de `queued_records`

- Captura propia: `draft` → `pending` → `syncing` → `synced`, o `error` / `conflict`.
- Registro devuelto (docs/141 §4–§7): `returned` (editable solo por su destinatario) → `correction_pending` (corregido, por enviar) → `synced`. Si el servidor responde 409 queda `correction_conflict` con los cambios conservados; si la corrección ya no le corresponde, `correction_error`.

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

### Correcciones (registros devueltos)

`syncService` llama a `syncCorrections` cada 2 minutos, aunque no haya capturas
pendientes (`src/corrections/correctionSync.ts`):

1. `GET /review/my-corrections/{project_id}` lista los devueltos al usuario con su `lock_version`.
2. Si la tablet tiene la misma versión, solo baja las observaciones (`/review/records/{id}/observations`). Si no, `GET /review/records/{id}/correction-package` trae respuestas, integrantes REPEAT y el manifiesto de adjuntos; solo se descargan los que faltan.
3. El gestor corrige (banner con "Ir a la pregunta" y "Ya la corregí") y reenvía: se suben los archivos nuevos, `PATCH /runtime/record/{id}/correction` con **solo los campos cambiados** y `expected_lock_version`, `PATCH /review/observations/{id}` y `POST /review/actions`.
4. Un 409 marca `correction_conflict` sin sobrescribir; un registro que dejó de estar asignado se retira de la lista.

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
