# Pruebas sin teléfono

```
npm test
```

- `setup.ts` reemplaza `expo-sqlite` por `node:sqlite` (Node 22+): las
  sentencias de `src/db/database.ts` se ejecutan sobre un SQLite real en memoria.
- `database.test.ts`: limpieza local (nunca borra pendientes, errores, conflictos
  ni registros con evidencias sin subir).
- `backendValues.test.ts`: contrato con `POST /runtime/session/bulk-save`
  (repeticiones anidadas, Sí/No, archivos y MULTIFILE).
- `fileValues.test.ts`: evidencias de los campos (tipo MIME, huellas, validación).

La captura con cámara, micrófono y selector se prueba en el emulador
(docs/140 del repositorio principal, sección 8).
