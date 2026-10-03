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
}

export interface RuntimeLocalesPluginOptions {
  // Absolute path of the directory holding <code>.json.
  localesDirectory: string;
  // The statically bundled language i18next falls back to, e.g. "en".
  fallbackLanguage: string;
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

export function getRuntimeLocale(
  options: RuntimeLocaleOptions,
): RuntimeLocaleTree;

export function createRuntimeLocalesPlugin(
  options: RuntimeLocalesPluginOptions,
): RuntimeLocalesPlugin;
