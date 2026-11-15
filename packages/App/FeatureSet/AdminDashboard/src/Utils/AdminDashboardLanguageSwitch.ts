import type { i18n as I18n } from "i18next";

/*
 * Shows the Admin Dashboard in `language` - one of the codes it is written
 * in - with the i18next instance the component reads its words from
 * (react-i18next's useTranslation), so nothing here starts one of its own.
 *
 * Every language but English is a lazy chunk (Utils/i18n.ts, #8146), so the
 * language's words are loaded BEFORE the switch: otherwise every string would
 * read English for a moment while the chunk downloads. loadLanguages resolves
 * at once for a language already loaded (English included), and when the
 * chunk cannot be fetched the switch still happens: i18next then serves the
 * English for the strings it misses. As the Dashboard switches
 * (Dashboard/src/Utils/DashboardLanguageSwitch.ts).
 */
export const switchAdminDashboardLanguage: (
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
