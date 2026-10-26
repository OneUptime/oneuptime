import type { i18n as I18nInstance } from "i18next";
import { setDateDisplayLanguage } from "../../Types/DateLanguage";

/*
 * Dates follow the page's language: each frontend hands its i18next instance
 * to this once, at start-up, and OneUptimeDate writes month and weekday
 * names, "vor 5 Stunden" and "2 Tage, 3 Stunden" in the language the reader
 * picked - set as soon as i18next has resolved it, and again on every
 * switch, before the page draws in the new language.
 */
export const followLanguageForDates: (instance: I18nInstance) => void = (
  instance: I18nInstance,
): void => {
  const follow: (language?: string | undefined) => void = (
    language?: string | undefined,
  ): void => {
    setDateDisplayLanguage(
      instance.resolvedLanguage || language || instance.language,
    );
  };

  instance.on("languageChanged", (language: string): void => {
    follow(language);
  });

  if (instance.isInitialized) {
    follow();
  } else {
    instance.on("initialized", (): void => {
      follow();
    });
  }
};
