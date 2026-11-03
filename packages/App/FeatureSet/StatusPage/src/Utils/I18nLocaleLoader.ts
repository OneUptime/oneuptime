/*
 * Lazy loader for the status pages' locale bundles, as the Dashboard has
 * one (Dashboard/src/Utils/I18nLocaleLoader.ts).
 *
 * English is the fallback language and is bundled statically by
 * Utils/i18n.ts; every other supported locale is code-split by esbuild into
 * its own chunk via the template-literal dynamic import below (esbuild turns
 * the `../Locales/${...}.json` pattern into one lazy chunk per matching
 * file), so a visitor downloads the one language they read instead of all
 * seventeen: about 105 KB gzipped of a status page's first load
 * (issue #5614).
 *
 * Kept free of React and side effects so App/Tests can import it directly
 * under the node test environment.
 */
import {
  DEFAULT_STATUS_PAGE_LANGUAGE,
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
} from "Common/Types/StatusPage/StatusPageLanguage";

export type LocaleResource = Record<string, unknown>;

/*
 * A language can be lazy-loaded when it is a supported status page language
 * that is NOT the statically-bundled default (English). Everything else is
 * rejected - this is also what keeps the dynamic import path safe: only
 * codes from the allowlist ever reach the template literal, so no
 * user-influenced value (e.g. a crafted localStorage entry) can be turned
 * into an arbitrary module path.
 */
export const isLazyLoadableLanguageCode: (languageCode: string) => boolean = (
  languageCode: string,
): boolean => {
  return (
    languageCode !== DEFAULT_STATUS_PAGE_LANGUAGE &&
    SUPPORTED_STATUS_PAGE_LANGUAGE_CODES.includes(languageCode)
  );
};

export const loadLocaleResource: (
  languageCode: string,
) => Promise<LocaleResource> = async (
  languageCode: string,
): Promise<LocaleResource> => {
  if (!isLazyLoadableLanguageCode(languageCode)) {
    throw new Error(
      `Cannot lazy-load locale "${languageCode}": not a lazily-loaded status page language.`,
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
