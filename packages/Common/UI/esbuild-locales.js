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
 *   A count-dependent sentence keeps its English "one" form under its key
 *   plus "_one" ("{{count}} monitors_one": "{{count}} monitor"). The code
 *   hands that sentence to the lookup itself (translatePlural in
 *   Common/UI/Utils/TranslateTemplate.ts), which reads an English "_one"
 *   entry as no translation at all - so English readers never need them.
 *   Another language reads its own "_one" form for the counts its plural
 *   rules call "one", and falls back to the English entry while it has not
 *   translated it.
 *
 * This plugin ships each locale without those entries. The source files are
 * read as they are: only the bundle changes. What is kept:
 *
 *   en.json  - nested keys (read with t("navbar.items.formsTitle"), whose key
 *              is not the text) and any other entry whose value differs from
 *              its key, except the plural "_one" forms. So the entry chunk
 *              does not grow with every count-dependent sentence.
 *   others   - every string that differs from the fallback's string at the
 *              same place: the translations. A language whose plural rules
 *              have a "one" form also ships every "_one" form - its own, or
 *              the English one it would have fallen back to - since en.json
 *              no longer carries them; one without (Japanese, Korean,
 *              Chinese) never reads them.
 *
 * CommonJS, like esbuild-config.js: the frontends' esbuild.config.js files
 * are plain node scripts. Types for TypeScript callers are in
 * esbuild-locales.d.ts.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const RUNTIME_LOCALES_PLUGIN_NAME = "runtime-locales";

const PLURAL_ONE_SUFFIX = "_one";

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
 * The flat keys of a locale that hold the "one" form of a count-dependent
 * sentence: "<key>_one" beside "<key>", which holds the general form (a
 * PluralTemplate, Common/UI/Utils/TranslateTemplate.ts).
 * @param {Object} tree - A parsed locale file
 * @returns {Array<string>} The keys, in the file's order
 */
function getPluralOneFormKeys(tree) {
  return Object.keys(tree).filter((key) => {
    return (
      key.endsWith(PLURAL_ONE_SUFFIX) &&
      typeof tree[key] === "string" &&
      typeof tree[key.slice(0, -PLURAL_ONE_SUFFIX.length)] === "string"
    );
  });
}

/**
 * Whether a language reads "_one" forms at all: its plural rules have a "one"
 * category, as Intl.PluralRules - which the lookup picks a form with - says.
 * Japanese, Korean and Chinese have none.
 * @param {string} language - A language code, e.g. "de"
 * @returns {boolean} True as well when Intl cannot tell
 */
function usesPluralOneForm(language) {
  try {
    return new Intl.PluralRules(language)
      .resolvedOptions()
      .pluralCategories.includes("one");
  } catch {
    return true;
  }
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
    /*
     * The "_one" forms go too: a reader of the fallback language is never
     * shown one - the code hands the lookup the same sentence - and the
     * other languages ship the ones they read (below).
     */
    const shipped = withoutIdentityEntries(locale);

    for (const key of getPluralOneFormKeys(locale)) {
      delete shipped[key];
    }

    return shipped;
  }

  if (!isLocaleTree(fallback)) {
    throw new Error(
      `getRuntimeLocale: the ${fallbackLanguage} locale is needed to ship ${language}.`,
    );
  }

  const shipped = withoutFallbackEntries(locale, fallback);

  if (!usesPluralOneForm(language)) {
    return shipped;
  }

  /*
   * The fallback ships without its "_one" forms, so this language ships every
   * one it reads: its translation, or the fallback's sentence where it has
   * none - what the lookup would have fallen back to from the full files. In
   * the locale's order, then any the locale lacks in the fallback's.
   */
  const oneForms = getPluralOneFormKeys(fallback);
  const isOneForm = new Set(oneForms);
  const result = {};

  for (const key of Object.keys(locale)) {
    if (isOneForm.has(key) && typeof locale[key] === "string") {
      result[key] = locale[key];
    } else if (hasOwn(shipped, key)) {
      result[key] = shipped[key];
    }
  }

  for (const key of oneForms) {
    if (!hasOwn(result, key)) {
      result[key] = fallback[key];
    }
  }

  return result;
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

function digestOf(text) {
  return crypto.createHash("sha1").update(text).digest("base64");
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
   * seventeen 2 MB files is most of a rebuild. A result is kept with digests
   * of the texts it was made from and reused while they are unchanged.
   */
  const results = new Map();
  const parsedFallback = { digest: undefined, tree: undefined };

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
          ? ""
          : fs.readFileSync(fallbackPath, "utf8");
        const fallbackDigest = isFallback ? "" : digestOf(fallbackText);
        const inputs = `${digestOf(text)} ${fallbackDigest}`;
        const cached = results.get(args.path);

        if (cached && cached.inputs === inputs) {
          return cached.result;
        }

        if (!isFallback && parsedFallback.digest !== fallbackDigest) {
          parsedFallback.tree = parseLocaleText(fallbackText, fallbackPath);
          parsedFallback.digest = fallbackDigest;
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

        results.set(args.path, { inputs: inputs, result: result });

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
  getPluralOneFormKeys,
  usesPluralOneForm,
  getRuntimeLocale,
  createRuntimeLocalesPlugin,
};
