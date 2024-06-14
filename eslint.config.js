// @ts-check

import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/build/",
      "**/assets/",
      "**/out/",
      "**/coverage/",
      "**/lib/",
      "**/esm/",
      "**/cjs/",
      "**/playwright-report/",
      "**/playwright-coverage/",
      "**/playwright-screenshots/",
      "**/playwright-videos",
      "**/webpack.config.js", // TODO: Remove this ignore
      "**/service-worker.js", // TODO: Remove this ignore
      "**/Static/", // TODO: Remove this ignore
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended, // TODO: make this strict and not recommended
  eslintPluginPrettierRecommended,
  {
    rules: {
      "no-control-regex": "off", // TODO: Remove this rule
      "@typescript-eslint/no-explicit-any": "off", // TODO: Remove this rule
      "@typescript-eslint/no-var-requires": "off", // TODO: Remove this rule
      "@typescript-eslint/no-duplicate-enum-values": "off", // TODO: Remove this rule
      "no-constant-binary-expression": "off", // TODO: Remove this rule
      "@typescript-eslint/ban-ts-comment": "off", // TODO: Remove this rule
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.jquery,
        ...globals.node,
      },
    },
  },
);
