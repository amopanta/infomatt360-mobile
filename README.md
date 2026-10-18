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
├── api/          # Cliente HTTP (axios) y endpoints de sync
├── auth/         # Login, MFA, selección de proyecto, PIN, perfil
├── config/       # Configuración de entorno (API URL)
├── db/           # SQLite: esquema, migraciones, operaciones CRUD
├── evidence/     # Captura y visualización de evidencias multimedia
├── forms/        # Formularios dinámicos, campos, validación
├── map/          # Mapa de registros con react-native-maps
├── navigation/   # AppNavigator con tabs y stacks anidados
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
2. **Borradores** — Registros guardados como borrador, edición antes de enviar
3. **Mapa** — Visualización geográfica de registros capturados
4. **Sync** — Estado de sincronización, resolución de conflictos, exportación
5. **Perfil** — Información del usuario, configuración, PIN, estadísticas, logs de errores

## Offline-first

La aplicación opera sin conexión a internet:

- **Formularios** se cachean en SQLite al sincronizar
- **Registros** se guardan localmente y se sincronizan cuando hay red
- **Evidencias** (fotos, videos, huellas, firmas) se almacenan como archivos locales
- **Sincronización** usa bulk-save con claves de idempotencia SHA-256 para evitar duplicados
- **Conflictos** se detectan y permiten resolución manual (local vs servidor vs merge)

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

# Lint
npx expo lint
```

## Variables de entorno

Configurar en `src/config/env.ts`:

```typescript
export const API_BASE_URL = 'https://tu-servidor.com/api/v1';
```

## Relación con el backend

La app se conecta al backend InfoMatt360 (FastAPI + PostgreSQL + PostGIS):

- `POST /auth/login` — Login con device_fingerprint opcional
- `POST /auth/mfa/verify` — Verificación MFA
- `GET /auth/session` — Datos del usuario y proyectos
- `GET /runtime/templates` — Plantillas de formularios
- `POST /runtime/session/bulk-save` — Guardado masivo de registros
- `POST /files/upload` — Subida de evidencias (multipart)

## Documentación relacionada

- [Captura de huella del participante](../amopanta/infomatt360/docs/134_CAPTURA_HUELLA_PARTICIPANTE.md)
- [Asset lock y sesión extendida](../amopanta/infomatt360/docs/91_ASSET_LOCK_Y_SESION_EXTENDIDA_CAMPO.md)
- [Sistema de diseño](../amopanta/infomatt360/docs/123_SISTEMA_DE_DISENO.md)

## Contrato con el backend (actualizado 2026-10-17)

Esta es la **app móvil oficial** de InfoMatt360. El antiguo módulo `mobile/` del repositorio principal (Express + Capacitor) se retiró porque usaba su propia base de datos.

| Función | Endpoint del backend principal |
|---|---|
| Login / MFA | `POST /auth/login` (reto `mfa_challenge_token`) → `POST /auth/mfa/verify` `{challenge_token, code}`. Toda petición lleva `X-Client-Platform: native`: así el backend entrega el refresh token en el cuerpo (se guarda en SecureStore) |
| Renovar sesión | `POST /auth/refresh` `{refresh_token}` → nuevo par rotado |
| Formularios | `GET /builder/templates/{project_id}` (solo `published`) + `GET /runtime/template/{id}` |
| Participantes | `GET /participants/project/{project_id}`, `GET /participants/{id}`, `GET /participants/{id}/activities` |
| Sincronización | `POST /runtime/session/bulk-save` — cada registro lleva `project_id`, `template_id` y `values: [{field_name, field_value_json}]` (JSON en texto) |
| Evidencias | `POST /files/upload` (multipart: `upload`, `project_id`, `asset_type`, `record_id` opcional). Orden: fotos de campo y firmas → registro → adjuntos con el `record_id` del servidor. Los campos de archivo se envían como `{file_asset_id, name, mime_type, size_bytes}` |

Los identificadores son UUID (texto). Al actualizar, la app recrea una vez las tablas de caché local (`form_templates`, `participants`) sin tocar la cola de capturas pendientes. Detalle en `docs/140_REESTRUCTURACION_UX_Y_CLIENTE_MOVIL_UNICO.md` del repositorio principal.

Pruebas en emulador Android y errores corregidos: sección 5 de `docs/140` del repositorio principal.
