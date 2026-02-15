import { fileURLToPath } from "url";
import { dirname } from "path";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettierRecommended from "eslint-plugin-prettier/recommended";
import globals from "globals";
import unusedImports from "eslint-plugin-unused-imports";
import react from "eslint-plugin-react";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
      "**/service-worker.js", // TODO: Remove this ignore
      "**/Static/", // TODO: Remove this ignore
      "**/*.js", // TODO: Remove this ignore
      "**/tmp/",
      "**/temp/",
      "**/.tmp/",
      "**/.temp/",
      "**/logs/",
      "**/*.log",
      "**/greenlock/",
      "**/Certs/",
      "**/Backups/",
      "**/.git/",
      "**/.vscode/",
      "**/.eslintcache",
      "**/views/",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended, // TODO: make this strict and not recommended
  eslintPluginPrettierRecommended,
  {
    plugins: {
      "unused-imports": unusedImports,
      react: react,
    },

    rules: {
      "react/prop-types": "off", // TODO: Remove this rule
      "no-control-regex": "error", // TODO: Remove this rule
      "@typescript-eslint/no-explicit-any": "off", // TODO: Remove this rule
      "@typescript-eslint/no-var-requires": "error",
      "@typescript-eslint/no-duplicate-enum-values": "off", // TODO: Remove this rule
      "no-constant-binary-expression": "error", 
      "@typescript-eslint/ban-ts-comment": "error",
      "multiline-comment-style": "error",
      "@typescript-eslint/no-floating-promises": "off", // TODO: Remove this rule
      "no-fallthrough": "error",
      "no-unreachable": "error",
      "no-cond-assign": "error",
      "valid-typeof": "error",
      "no-func-assign": "error",
      curly: "error",
      "no-extra-semi": "error",
      "no-else-return": "error",
      "no-div-regex": "error",
      "no-octal": "error",
      "no-extra-bind": "error",
      "unicode-bom": "error",
      "no-extra-boolean-cast": "error",
      "wrap-regex": "error",
      "wrap-iife": "error",
      "yield-star-spacing": "error",
      "no-implicit-coercion": "error",
      "no-extra-label": "error",

      "no-lonely-if": "error",
      "no-floating-decimal": "error",
      eqeqeq: "error",
      "dot-notation": "off", // Off because it messes up with typescript compiler.
      "@typescript-eslint/dot-notation": "off", //temp off.
      "linebreak-style": ["error", "unix"],
      "@typescript-eslint/no-empty-interface": [
        "error",
        {
          allowSingleExtends: true,
        },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-extra-non-null-assertion": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/explicit-member-accessibility": ["error"],
      "no-console": "error",
      "no-undef": "error",
      "no-empty": "error",
      "prefer-arrow-callback": "error",
      "constructor-super": "error",
      "no-case-declarations": "error",
      "no-mixed-spaces-and-tabs": "error",
      "no-useless-escape": "error",
      "prettier/prettier": "error",
      "react/jsx-no-undef": "error",
      "react/jsx-no-bind": [
        "error",
        {
          allowArrowFunctions: true,
          allowBind: false,
          ignoreRefs: false,
        },
      ],
      "react/no-children-prop": "error",
      "react/no-deprecated": "error",
      "react/boolean-prop-naming": "error",
      "react/no-is-mounted": "error",
      "react/no-find-dom-node": "error",
      "one-var-declaration-per-line": "error",
      "arrow-parens": "error",
      "arrow-body-style": ["error", "always"],
      "@typescript-eslint/typedef": [
        "error",
        {
          arrowParameter: true,
          variableDeclaration: true,
        },
      ],
      "@typescript-eslint/strict-boolean-expressions": "off", //Need to enable this very soon
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        {
          allowExpressions: true,
        },
      ],
      "react/no-did-update-set-state": "error",
      "react/no-unknown-property": "error",
      "react/no-unused-prop-types": "error",
      "react/jsx-no-duplicate-props": "error",
      "react/no-unused-state": "error",
      "react/jsx-uses-vars": "error",

      "react/react-in-jsx-scope": "error",

      "react/no-string-refs": "error",
      "jsx-a11y/href-no-hash": [0],
      "react/no-unescaped-entities": "error",
      "react/display-name": "error",
      "react/jsx-pascal-case": "error",
      "array-callback-return": "error",
      "no-loop-func": "error",
      "no-duplicate-imports": "error",
      "no-promise-executor-return": "error",
      "capitalized-comments": "off", // this is turned off because some commented code should not be capitalized.
      "for-direction": "error",
      "getter-return": "error",
      "no-async-promise-executor": "error",
      "prefer-const": [
        "error",
        {
          destructuring: "any",
          ignoreReadBeforeAssign: false,
        },
      ],
      "no-var": "error",
      "object-curly-spacing": ["error", "always"],
      "no-unneeded-ternary": "error",
      "@typescript-eslint/no-restricted-types": [
        "error",
        {
          types: {
            String: {
              message: "Use 'string' instead of 'String'",
              fixWith: "string"
            },
            Boolean: {
              message: "Use 'boolean' instead of 'Boolean'",
              fixWith: "boolean"
            },
            Number: {
              message: "Use 'number' instead of 'Number'",
              fixWith: "number"
            },
            "{}": {
              message: "Use 'Record<string, unknown>' instead of '{}'"
            },
            Object: {
              message: "Use 'Record<string, unknown>' instead of 'Object'"
            },
            object: {
              message: "Use 'Record<string, unknown>' instead of 'object'"
            },
            Function: {
              message: "Use a specific function type instead of 'Function'"
            }
          }
        },
      ],
    },
    settings: {
      react: {
        version: "18.1.0",
      },
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        JSX: true,
        require: true,
        process: true,
        module: true,
        __dirname: true,
        exports: true,
        "NodeJS": true,
        "PromiseSettledResult": true
      },
      parserOptions: {
        projectService: true,
        createDefaultProgram: false,
        tsconfigRootDir: __dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: false, // Disable for performance
    },
  },
);
