// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
    {
        ignores: ['**/node_modules/', '**/dist/', '**/build/', '**/out/', '**/coverage/', '**/lib/', '**/esm/', '**/cjs/', '**/playwright-report/', '**/playwright-coverage/', '**/playwright-screenshots/', '**/playwright-videos'],
    },
    eslint.configs.recommended,
    ...tseslint.configs.strict,
    eslintPluginPrettierRecommended
);
