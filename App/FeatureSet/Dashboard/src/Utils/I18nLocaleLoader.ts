/*
 * Lazy loader for dashboard locale bundles.
 *
 * English is the fallback language and is bundled statically by Utils/i18n.ts;
 * every other supported locale is code-split by esbuild into its own chunk via
 * the template-literal dynamic import below (esbuild turns the
 * `../Locales/${...}.json` pattern into one lazy chunk per matching file), so
 * a user only ever downloads the one locale they actually use instead of all
 * sixteen (~11.8MB of the old entry chunk).
 *
 * Kept free of React and side effects so App/Tests/Dashboard can import it
 * directly under the node test environment.
 */

import {
  DEFAULT_DASHBOARD_LANGUAGE,
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/Dashboard/DashboardLanguage";

export type LocaleResource = Record<string, unknown>;

/*
 * A language can be lazy-loaded when it is a supported dashboard language
 * that is NOT the statically-bundled default (English). Everything else is
 * rejected — this is also what keeps the dynamic import path safe: only
 * codes from the allowlist ever reach the template literal, so no
 * user-influenced value (e.g. a crafted localStorage entry) can be turned
 * into an arbitrary module path.
 */
export const isLazyLoadableLanguageCode: (languageCode: string) => boolean = (
  languageCode: string,
): boolean => {
  return (
    languageCode !== DEFAULT_DASHBOARD_LANGUAGE &&
    SUPPORTED_DASHBOARD_LANGUAGE_CODES.includes(languageCode)
  );
};

export const loadLocaleResource: (
  languageCode: string,
) => Promise<LocaleResource> = async (
  languageCode: string,
): Promise<LocaleResource> => {
  if (!isLazyLoadableLanguageCode(languageCode)) {
    throw new Error(
      `Cannot lazy-load locale "${languageCode}": not a lazily-loaded dashboard language.`,
    );
  }

  /*
   * The import specifier deliberately keeps the "../Locales/" prefix and the
   * ".json" suffix as literals so esbuild can enumerate the candidate files
   * at build time and emit a chunk for each locale.
   */
  const imported: { default?: LocaleResource } = (await import(
    `../Locales/${languageCode}.json`
  )) as { default?: LocaleResource };

  return imported.default || (imported as LocaleResource);
};
