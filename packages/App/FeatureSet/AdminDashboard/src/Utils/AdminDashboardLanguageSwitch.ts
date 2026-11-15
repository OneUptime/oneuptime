/*
 * What the switch needs of the i18next instance a component reads its words
 * from (react-i18next's useTranslation): an instance satisfies it as it is.
 * Written out rather than imported from i18next, so App/Tests can type-check
 * the switch where the Admin Dashboard's own dependencies are not installed.
 */
export interface SwitchableI18n {
  loadLanguages: (language: string) => Promise<unknown>;
  changeLanguage: (language: string) => Promise<unknown>;
}

/*
 * Shows the Admin Dashboard in `language` - one of the codes it is written
 * in - with the i18next instance the component reads its words from, so
 * nothing here starts one of its own.
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
  i18n: SwitchableI18n,
  language: string,
) => Promise<void> = async (
  i18n: SwitchableI18n,
  language: string,
): Promise<void> => {
  try {
    await i18n.loadLanguages(language);
  } catch {
    // Fall through to changeLanguage: the English fallback still applies.
  }

  await i18n.changeLanguage(language);
};
