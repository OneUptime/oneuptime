import type { i18n as I18n } from "i18next";

/*
 * Shows the Dashboard in `language` - one of the codes it is written in -
 * with the i18next instance the component reads its words from
 * (react-i18next's useTranslation), so nothing here starts one of its own.
 *
 * Non-English locales are lazy chunks (Utils/i18n.ts), so the language's
 * bundle is loaded BEFORE the switch: otherwise every translated string
 * would briefly render as a raw key while the chunk downloads.
 * loadLanguages resolves at once for anything already loaded (English
 * included), and when the chunk cannot be fetched the switch still
 * happens: i18next then serves the English for the strings it misses.
 */
export const switchDashboardLanguage: (
  i18n: I18n,
  language: string,
) => Promise<void> = async (i18n: I18n, language: string): Promise<void> => {
  try {
    await i18n.loadLanguages(language);
  } catch {
    // Fall through to changeLanguage: the English fallback still applies.
  }

  await i18n.changeLanguage(language);
};

// The language the Dashboard is shown in now.
export const getDashboardLanguage: (i18n: I18n) => string = (
  i18n: I18n,
): string => {
  return i18n.resolvedLanguage || i18n.language || "en";
};
