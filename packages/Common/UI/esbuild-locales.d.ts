/*
 * Types for esbuild-locales.js, which stays CommonJS so the frontends'
 * esbuild.config.js files can require it as plain node scripts.
 */

export type RuntimeLocaleNode = string | RuntimeLocaleTree;

export interface RuntimeLocaleTree {
  [key: string]: RuntimeLocaleNode;
}

export interface RuntimeLocaleOptions {
  // The locale's code, e.g. "de".
  language: string;
  // The language i18next falls back to, e.g. "en".
  fallbackLanguage: string;
  // The parsed locale file.
  locale: RuntimeLocaleTree;
  // The parsed fallback locale file; required unless language is the fallback.
  fallback?: RuntimeLocaleTree | undefined;
  /*
   * The fallback's texts the language holds as they are, on purpose (its
   * same-as-English list): its "_one" forms among them ship with a mark.
   */
  sameAsEnglish?: ReadonlyArray<string> | undefined;
}

export interface SameAsEnglishMarksOptions {
  // The locale's code, e.g. "fr".
  language: string;
  // The parsed locale file.
  locale: RuntimeLocaleTree;
  // The parsed fallback locale file.
  fallback: RuntimeLocaleTree;
  // The fallback's texts the language holds as they are, on purpose.
  sameAsEnglish?: ReadonlyArray<string> | undefined;
}

export interface RuntimeLocalesPluginOptions {
  // Absolute path of the directory holding <code>.json.
  localesDirectory: string;
  // The statically bundled language i18next falls back to, e.g. "en".
  fallbackLanguage: string;
  /*
   * Absolute path of the JSON array of the fallback's texts every language
   * holds as they are (the Dashboard's i18n/SameAsEnglish.json).
   */
  sameAsEnglishFile?: string | undefined;
  /*
   * Absolute path of the directory holding each language's <code>.json
   * progress file, whose "sameAsEnglish" array lists the texts that language
   * holds as they are (the Dashboard's i18n/Progress).
   */
  progressDirectory?: string | undefined;
}

export interface RuntimeLocalesPlugin {
  name: string;
  setup: (build: unknown) => void;
}

export const RUNTIME_LOCALES_PLUGIN_NAME: string;

export function isLocaleTree(node: unknown): node is RuntimeLocaleTree;

export function withoutIdentityEntries(
  tree: RuntimeLocaleTree,
): RuntimeLocaleTree;

export function withoutFallbackEntries(
  locale: RuntimeLocaleTree,
  fallback: RuntimeLocaleTree | undefined,
): RuntimeLocaleTree;

// The flat "<key>_one" keys beside a "<key>": a plural's "one" forms.
export function getPluralOneFormKeys(tree: RuntimeLocaleTree): Array<string>;

// Whether the language's plural rules have a "one" form (Intl.PluralRules).
export function usesPluralOneForm(language: string): boolean;

/*
 * The suffix of a "_one" form's mark, which says the language words that form
 * as English does on purpose (SAME_AS_ENGLISH_MARK in Common/Types/
 * Translator.ts).
 */
export const SAME_AS_ENGLISH_MARK: string;

// The marks of the "_one" forms the language words as the fallback does.
export function getSameAsEnglishMarks(
  options: SameAsEnglishMarksOptions,
): Record<string, string>;

export function getRuntimeLocale(
  options: RuntimeLocaleOptions,
): RuntimeLocaleTree;

export function createRuntimeLocalesPlugin(
  options: RuntimeLocalesPluginOptions,
): RuntimeLocalesPlugin;
