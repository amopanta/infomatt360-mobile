# InfoMatt360 Mobile

Aplicación móvil de **InfoMatt360** — plataforma de operaciones territoriales. Construida con React Native (Expo SDK 57) para captura de formularios offline, evidencias multimedia, geolocalización GPS y sincronización con el backend.

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Framework | React Native via Expo SDK 57 |
| Navegación | React Navigation 7 (native-stack + bottom-tabs) |
| Estado | Zustand + expo-secure-store |
| Base de datos local | expo-sqlite (SQLite síncrono) |
| Cámara/Galería | expo-image-picker |
| GPS | expo-location |
| Seguridad | expo-crypto (SHA-256), expo-secure-store |
| Firma digital | react-native-signature-canvas |
| Mapas | react-native-maps |
| Escaneo de documentos | Procesamiento de bordes con canvas |

## Arquitectura

```
src/
├── actas/        # Generación de actas
├── api/          # Cliente HTTP (axios) y endpoints de sync
├── auth/         # Login, MFA, selección de proyecto, PIN, perfil
├── cases/        # Base local de casos sin conexión (H08, aún sin conectar)
├── config/       # Configuración de entorno (API URL)
├── corrections/  # Registros devueltos: observaciones y sync diferencial (docs/141 §4–§7)
├── db/           # SQLite por usuario: esquema, migraciones, operaciones CRUD
├── evidence/     # Captura y visualización de evidencias multimedia
├── forms/        # Formularios dinámicos, campos, validación
├── map/          # Mapa de registros con react-native-maps
├── monitoring/   # Estado del equipo, recorrido GPS y borrado remoto
├── navigation/   # AppNavigator con tabs y stacks anidados
├── participants/ # Ficha y respuestas previas del participante (solo lectura)
├── scanner/      # Escáner de documentos con cámara
├── screens/      # Pantallas auxiliares (stats, crash logs)
├── store/        # Stores Zustand (auth, pin)
├── sync/         # Sincronización bulk con idempotencia SHA-256
├── types/        # Tipos TypeScript centrales
├── ui/           # Tema visual, componentes compartidos
└── utils/        # Utilidades (compresión, device fingerprint, uuid)
```

## Flujo de navegación

```
Login → MFA (opcional) → PIN Setup/Unlock → Selección de proyecto → Tabs principales
```

### Tabs principales

1. **Formularios** — Lista de formularios publicados, captura de datos, detalle de registros
2. **Borradores** — Borradores (retoman la página donde quedaron) y filtro **Correcciones** con los registros devueltos
3. **Mapa** — Visualización geográfica de registros capturados
4. **Sync** — Estado de sincronización, resolución de conflictos, exportación
5. **Perfil** — Información del usuario, configuración, PIN, estadísticas, logs de errores

## Offline-first

La aplicación opera sin conexión a internet:

- **Una base SQLite por usuario** (`infomatt360_u_<id>.db`): dos gestores en la misma tablet no ven datos ajenos. No se cifra (decisión del proyecto); `allowBackup:false` evita copiarla por respaldo de Android.
- **Paquete del proyecto**: formularios, participantes, asignaciones y respuestas previas (máx. 300) se bajan con conexión; después se pueden **iniciar capturas nuevas sin red**.
- **Registros** se guardan localmente (autoguardado del borrador con su página) y se envían al reconectar con una clave de idempotencia SHA-256 por lote; cada archivo lleva su `client_ref`, así un reintento no duplica registros ni evidencias.
- **Evidencias** (fotos, videos, huellas, firmas) se almacenan como archivos locales y se suben antes o después del registro según su tipo.
- **Correcciones**: cada 2 minutos se consultan los registros devueltos al usuario. Si la tablet ya tiene la versión, solo bajan las observaciones; si no, baja el paquete completo y solo los adjuntos que faltan. Se envían solo los campos cambiados con `expected_lock_version`; un 409 deja el registro "en conflicto" sin perder los cambios.
- **Monitoreo**: latido del equipo, recorrido GPS durante la jornada y borrado remoto confirmado al servidor.

## Captura de huella digital (doc 134)

La aplicación soporta captura de huella digital del participante con dos métodos:

### Método 1: Cámara (primario)
- Usa la cámara del dispositivo para fotografiar la huella
- Recorte cuadrado para centrar la huella
- Guía visual con instrucciones de iluminación y enfoque
- Imagen guardada en alta calidad (0.9) en directorio persistente

### Método 2: Táctil (secundario)
- Presión del pulgar en pantalla con área circular
- Captura del patrón de contacto como imagen PNG
- Guía visual con indicador de posición

### Almacenamiento de huellas

Las imágenes de huellas son **visibles y accesibles** para:

- **Vista previa** en el formulario (data URI base64 inline)
- **Tabla de evidencias** (archivo en disco, tipo `'fingerprint'` en SQLite)
- **Generación de actas** (accesible por `file_uri` local y `remote_url` después de sincronizar)

Cada huella se vincula a: `project_id`, `template_id`, `record_local_id`, `field_id` y usuario capturador, conforme a la especificación del doc 134.

## Seguridad

- **PIN de 4 dígitos** — Bloqueo de la app con hash SHA-256, lockout de 5 minutos tras 5 intentos fallidos
- **Device fingerprint** — UUID v4 persistido en SecureStore, usado para asset lock (1 dispositivo por gestor) y sesión extendida de 10 horas (doc 91)
- **Tokens JWT** — Almacenados en expo-secure-store, refresh automático
- **MFA** — Soporte para TOTP en el flujo de login

## Tipos de evidencia

| Tipo | Extensión | Captura |
|---|---|---|
| `photo` | JPEG | Cámara o galería |
| `video` | MP4 | Cámara (max 60s) |
| `document` | JPEG/PNG | Escáner de documentos |
| `signature` | PNG | Firma en pantalla |
| `fingerprint` | JPEG/PNG | Cámara o pantalla táctil |

## Desarrollo

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo
npx expo start

# Verificar tipos
npx tsc --noEmit

# Pruebas (vitest, SQLite simulado con node:sqlite)
npm test

# Lint
npx expo lint
```

## Variables de entorno

Configurar en `src/config/env.ts`:

```typescript
export const API_BASE_URL = 'https://tu-servidor.com/api/v1';
```

## Documentación relacionada

Repositorio principal `amopanta/infomatt360`, carpeta `docs/`:

- [140 — UX y cliente móvil único](https://github.com/amopanta/infomatt360/blob/main/docs/140_REESTRUCTURACION_UX_Y_CLIENTE_MOVIL_UNICO.md)
- [141 — Funcionalidades oficiales](https://github.com/amopanta/infomatt360/blob/main/docs/141_FUNCIONALIDADES_ADICIONADAS_Y_PLAN_DE_IMPLEMENTACION.md) y [142 — su validación](https://github.com/amopanta/infomatt360/blob/main/docs/142_VALIDACION_FUNCIONALIDADES_DOCS141.md)
- [134 — Captura de huella del participante](https://github.com/amopanta/infomatt360/blob/main/docs/134_CAPTURA_HUELLA_PARTICIPANTE.md)
- [91 — Asset lock y sesión extendida](https://github.com/amopanta/infomatt360/blob/main/docs/91_ASSET_LOCK_Y_SESION_EXTENDIDA_CAMPO.md)
- [123 — Sistema de diseño](https://github.com/amopanta/infomatt360/blob/main/docs/123_SISTEMA_DE_DISENO.md)
- Arquitectura de esta app: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)

## Contrato con el backend (actualizado 2026-10-18)

Esta es la **app móvil oficial** de InfoMatt360. El antiguo módulo `mobile/` del repositorio principal (Express + Capacitor) se retiró porque usaba su propia base de datos.

| Función | Endpoint del backend principal |
|---|---|
| Login / MFA | `POST /auth/login` (reto `mfa_challenge_token`) → `POST /auth/mfa/verify` `{challenge_token, code}`. Toda petición lleva `X-Client-Platform: native`: así el backend entrega el refresh token en el cuerpo (se guarda en SecureStore) |
| Renovar sesión | `POST /auth/refresh` `{refresh_token}` → nuevo par rotado |
| Formularios | `GET /builder/templates/{project_id}` (solo `published`) + `GET /runtime/template/{id}` |
| Participantes | `GET /participants/project/{project_id}`, `GET /participants/{id}`, `GET /participants/{id}/activities` |
| Sincronización | `POST /runtime/session/bulk-save` — cada registro lleva `project_id`, `template_id` y `values: [{field_name, field_value_json}]` (JSON en texto) |
| Asignaciones y paquete | `GET /form-assignments/mine/{project_id}`, `GET /runtime/offline-manifest/{project_id}` |
| Respuestas previas | `GET /participants/{id}/history` + `GET /runtime/record/{id}` (solo lectura) |
| Correcciones | `GET /review/my-corrections/{project_id}`, `GET /review/records/{id}/correction-package`, `GET /review/records/{id}/observations`, `PATCH /runtime/record/{id}/correction`, `PATCH /review/observations/{id}`, `POST /review/actions` (reenviar) |
| Equipo | `POST /field-devices/heartbeat`, `POST /field-devices/wipe-ack` |
| Evidencias | `POST /files/upload` (multipart: `upload`, `project_id`, `asset_type`, `record_id` opcional). Orden: fotos de campo y firmas → registro → adjuntos con el `record_id` del servidor. Los campos de archivo se envían como `{file_asset_id, name, mime_type, size_bytes}` |

Los identificadores son UUID (texto). Al actualizar, la app recrea una vez las tablas de caché local (`form_templates`, `participants`) sin tocar la cola de capturas pendientes. Detalle en `docs/140_REESTRUCTURACION_UX_Y_CLIENTE_MOVIL_UNICO.md` del repositorio principal.

Pruebas en emulador Android y errores corregidos: sección 5 de `docs/140` del repositorio principal.
