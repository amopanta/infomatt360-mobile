import { defineConfig } from 'vitest/config';

// Pruebas de lógica sin teléfono: SQL real (node:sqlite en lugar de
// expo-sqlite), conversión de valores y exportación. Ver test/README.md.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['test/setup.ts'],
  },
  define: { __DEV__: 'true' },
});
