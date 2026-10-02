/**
 * Locale files as the browser needs them, for a frontend whose i18next falls
 * back to one statically bundled language (the Dashboard: English).
 *
 * The Dashboard's locale files hold every key, so its translation tooling can
 * track what is left to translate (packages/App/FeatureSet/Dashboard/src/
 * Locales/README.md). Most of those entries change nothing a reader sees:
 *
 *   en.json maps nearly every key to itself ("Save": "Save"). A string is
 *   looked up by its English text with that text as the default value, so a
 *   missing entry renders the same English. en.json is in the entry chunk,
 *   which every page load downloads.
 *
 *   Every other locale holds the English text as a placeholder for each key
 *   it has not translated yet. i18next falls back to English for a missing
 *   key, and English is always loaded, so a missing entry renders the same
 *   English as the placeholder.
 *
 * This plugin ships each locale without those entries. The source files are
 * read as they are: only the bundle changes. What is kept:
 *
 *   en.json  - nested keys (read with t("navbar.items.formsTitle"), whose key
 *              is not the text), plural "_one" forms and any other entry
 *              whose value differs from its key.
 *   others   - every string that differs from the fallback's string at the
 *              same place: the translations.
 *
 * CommonJS, like esbuild-config.js: the frontends' esbuild.config.js files
 * are plain node scripts. Types for TypeScript callers are in
 * esbuild-locales.d.ts.
 */

const fs = require("fs");
const path = require("path");

const RUNTIME_LOCALES_PLUGIN_NAME = "runtime-locales";

/**
 * A JSON object of translations (and not an array or null).
 * @param {unknown} node
 * @returns {boolean}
 */
function isLocaleTree(node) {
  return typeof node === "object" && node !== null && !Array.isArray(node);
}

function hasOwn(tree, key) {
  return Object.prototype.hasOwnProperty.call(tree, key);
}

/**
 * The fallback locale without its flat entries whose value is their own key.
 * Nested objects are kept whole: t("navbar.items.formsTitle") would answer a
 * missing entry with the key, not the text.
 * @param {Object} tree - The parsed fallback locale file
 * @returns {Object} A new object; the input is not changed
 */
function withoutIdentityEntries(tree) {
  const result = {};

  for (const key of Object.keys(tree)) {
    const value = tree[key];

    if (typeof value === "string" && value === key) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * A locale without the strings that read exactly as the fallback's string at
 * the same place, at any depth. A nested object left empty is dropped too.
 * Anything the fallback does not have, or has in another shape, is kept.
 * @param {Object} locale - The parsed locale file
 * @param {Object|undefined} fallback - The parsed fallback locale file
 * @returns {Object} A new object; neither input is changed
 */
function withoutFallbackEntries(locale, fallback) {
  const result = {};

  for (const key of Object.keys(locale)) {
    const value = locale[key];
    const fallbackValue =
      isLocaleTree(fallback) && hasOwn(fallback, key)
        ? fallback[key]
        : undefined;

    if (isLocaleTree(value)) {
      const nested = withoutFallbackEntries(
        value,
        isLocaleTree(fallbackValue) ? fallbackValue : undefined,
      );

      if (Object.keys(nested).length > 0) {
        result[key] = nested;
      }

      continue;
    }

    if (typeof value === "string" && value === fallbackValue) {
      continue;
    }

    result[key] = value;
  }

  return result;
}

/**
 * The copy of one locale that is bundled.
 * @param {Object} options
 * @param {string} options.language - The locale's code, e.g. "de"
 * @param {string} options.fallbackLanguage - The language i18next falls back to, e.g. "en"
 * @param {Object} options.locale - The parsed locale file
 * @param {Object} [options.fallback] - The parsed fallback locale file; required unless language is the fallback
 * @returns {Object}
 */
function getRuntimeLocale(options) {
  const { language, fallbackLanguage, locale, fallback } = options || {};

  if (!isLocaleTree(locale)) {
    throw new Error(
      `getRuntimeLocale: the ${language} locale is not a JSON object.`,
    );
  }

  if (language === fallbackLanguage) {
    return withoutIdentityEntries(locale);
  }

  if (!isLocaleTree(fallback)) {
    throw new Error(
      `getRuntimeLocale: the ${fallbackLanguage} locale is needed to ship ${language}.`,
    );
  }

  return withoutFallbackEntries(locale, fallback);
}

function parseLocaleText(text, filePath) {
  let parsed;

  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `${filePath} is not valid JSON (${error.message}). A merge conflict left in it?`,
    );
  }

  if (!isLocaleTree(parsed)) {
    throw new Error(`${filePath} must hold a JSON object of translations.`);
  }

  return parsed;
}

function assertNonEmptyString(value, name) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`createRuntimeLocalesPlugin: "${name}" is required.`);
  }
}

/**
 * The esbuild plugin: every <code>.json directly in localesDirectory is
 * bundled as getRuntimeLocale() makes it, whether it is imported statically
 * (en.json) or through a template-literal dynamic import (the lazy chunks).
 * Other JSON files are left to esbuild.
 * @param {Object} options
 * @param {string} options.localesDirectory - Absolute path of the directory holding <code>.json
 * @param {string} options.fallbackLanguage - The statically bundled language i18next falls back to, e.g. "en"
 * @returns {{ name: string, setup: Function }}
 */
function createRuntimeLocalesPlugin(options) {
  const { localesDirectory, fallbackLanguage } = options || {};

  assertNonEmptyString(localesDirectory, "localesDirectory");
  assertNonEmptyString(fallbackLanguage, "fallbackLanguage");

  if (!path.isAbsolute(localesDirectory)) {
    throw new Error(
      `createRuntimeLocalesPlugin: "localesDirectory" must be absolute (got "${localesDirectory}").`,
    );
  }

  /*
   * In watch mode esbuild calls onLoad again on every rebuild, and parsing
   * seventeen 2 MB files is most of a rebuild. A result is kept with the
   * texts it was made from and reused while they are unchanged.
   */
  const results = new Map();
  const parsedFallback = { text: undefined, tree: undefined };

  return {
    name: RUNTIME_LOCALES_PLUGIN_NAME,
    setup(build) {
      // A missing directory fails the build here rather than shipping it all.
      const directory = fs.realpathSync(localesDirectory);
      const fallbackPath = path.join(directory, `${fallbackLanguage}.json`);

      build.onLoad({ filter: /\.json$/, namespace: "file" }, (args) => {
        if (fs.realpathSync(path.dirname(args.path)) !== directory) {
          return undefined;
        }

        const language = path.basename(args.path, ".json");
        const isFallback = language === fallbackLanguage;
        const text = fs.readFileSync(args.path, "utf8");
        const fallbackText = isFallback
          ? undefined
          : fs.readFileSync(fallbackPath, "utf8");

        const cached = results.get(args.path);

        if (
          cached &&
          cached.text === text &&
          cached.fallbackText === fallbackText
        ) {
          return cached.result;
        }

        if (!isFallback && parsedFallback.text !== fallbackText) {
          parsedFallback.tree = parseLocaleText(fallbackText, fallbackPath);
          parsedFallback.text = fallbackText;
        }

        const result = {
          contents: JSON.stringify(
            getRuntimeLocale({
              language: language,
              fallbackLanguage: fallbackLanguage,
              locale: parseLocaleText(text, args.path),
              fallback: isFallback ? undefined : parsedFallback.tree,
            }),
          ),
          loader: "json",
          // A change to the fallback changes what this locale ships.
          watchFiles: isFallback ? [] : [fallbackPath],
        };

        results.set(args.path, {
          text: text,
          fallbackText: fallbackText,
          result: result,
        });

        return result;
      });
    },
  };
}

module.exports = {
  RUNTIME_LOCALES_PLUGIN_NAME,
  isLocaleTree,
  withoutIdentityEntries,
  withoutFallbackEntries,
  getRuntimeLocale,
  createRuntimeLocalesPlugin,
};
