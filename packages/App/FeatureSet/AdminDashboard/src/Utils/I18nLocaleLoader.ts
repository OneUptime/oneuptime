/*
 * Lazy loader for the Admin Dashboard's locale bundles (#8146).
 *
 * English is the fallback language and is bundled statically by Utils/i18n.ts;
 * every other language the Admin Dashboard speaks is code-split by esbuild
 * into a chunk of its own through the template-literal dynamic import below
 * (esbuild turns the `../Locales/${...}.json` pattern into one lazy chunk per
 * matching file). So a page load downloads only the reader's language, not
 * all eighteen: they came to about 4.2 MB of the entry chunk. Each chunk holds
 * the language's translations, the plural "_one" forms its language reads,
 * which the English bundle leaves out, and a mark beside each "_one" form the
 * language words as English does on purpose: the build leaves out the strings
 * that read the same as the English fallback (Common/UI/esbuild-locales.js).
 *
 * The Dashboard loads its languages the same way (Dashboard/src/Utils/
 * I18nLocaleLoader.ts). Kept free of React and side effects so App/Tests can
 * import it directly under the node test environment.
 */

import {
  DEFAULT_ADMIN_DASHBOARD_LANGUAGE,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
} from "Common/Types/AdminDashboard/AdminDashboardLanguage";

export type LocaleResource = Record<string, unknown>;

/*
 * A language can be lazy-loaded when it is a language the Admin Dashboard
 * speaks that is NOT the statically bundled default (English). Everything
 * else is refused - which is also what keeps the dynamic import path safe:
 * only codes from the allowlist ever reach the template literal, so no
 * value a person can set (a crafted localStorage entry) can be turned into
 * an arbitrary module path.
 */
export const isLazyLoadableLanguageCode: (languageCode: string) => boolean = (
  languageCode: string,
): boolean => {
  return (
    languageCode !== DEFAULT_ADMIN_DASHBOARD_LANGUAGE &&
    SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES.includes(languageCode)
  );
};

export const loadLocaleResource: (
  languageCode: string,
) => Promise<LocaleResource> = async (
  languageCode: string,
): Promise<LocaleResource> => {
  if (!isLazyLoadableLanguageCode(languageCode)) {
    throw new Error(
      `Cannot lazy-load locale "${languageCode}": not a lazily-loaded Admin Dashboard language.`,
    );
  }

  /*
   * The import specifier keeps the "../Locales/" prefix and the ".json"
   * suffix as literals, so esbuild can list the candidate files at build
   * time and emit a chunk for each locale.
   */
  const imported: { default?: LocaleResource } = (await import(
    `../Locales/${languageCode}.json`
  )) as { default?: LocaleResource };

  return imported.default || (imported as LocaleResource);
};
