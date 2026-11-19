import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['**/dist/**', '**/.turbo/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
];
