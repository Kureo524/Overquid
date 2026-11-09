import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/target/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  // Plugins are plain browser scripts running in their own iframe.
  { files: ['plugins/**/*.js'], languageOptions: { globals: globals.browser } },
  // Build scripts run in Node.
  {
    files: ['**/scripts/**/*.mjs', 'packages/create-overlay-plugin/*.js'],
    languageOptions: { globals: globals.node },
  },
);
