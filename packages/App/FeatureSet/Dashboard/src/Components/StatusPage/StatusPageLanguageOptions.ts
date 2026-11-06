import {
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
} from "Common/Types/StatusPage/StatusPageLanguage";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * THE LANGUAGES A STATUS PAGE AND ITS SUBSCRIBERS ARE WRITTEN IN, AS THE
 * DASHBOARD NAMES THEM.
 *
 * Each in its own words, then its English name when that is not the same -
 * "Deutsch (German)", "日本語 (Japanese)", "English" - so a reader finds
 * their own language whatever language they read the Dashboard in, and a
 * teammate can tell the others apart. The page's Languages card (Branding)
 * and every subscriber list's Language field and column name them so.
 */

// A language as its pickers and lists name it.
export const getStatusPageLanguageLabel: (
  language: StatusPageLanguage,
) => string = (language: StatusPageLanguage): string => {
  return language.nativeName === language.englishName
    ? language.nativeName
    : `${language.nativeName} (${language.englishName})`;
};

// The language of a code, or undefined for one a status page cannot show.
export const findStatusPageLanguage: (
  code: string | null | undefined,
) => StatusPageLanguage | undefined = (
  code: string | null | undefined,
): StatusPageLanguage | undefined => {
  if (!code) {
    return undefined;
  }

  return SUPPORTED_STATUS_PAGE_LANGUAGES.find(
    (language: StatusPageLanguage): boolean => {
      return language.code === code;
    },
  );
};

/*
 * A code's label ("Deutsch (German)"); the code itself for a language a
 * status page cannot show, so a stored value is never hidden.
 */
export const getStatusPageLanguageLabelOfCode: (code: string) => string = (
  code: string,
): string => {
  const language: StatusPageLanguage | undefined =
    findStatusPageLanguage(code);

  return language ? getStatusPageLanguageLabel(language) : code;
};

// A code's own name ("Deutsch"); the code itself for one a page cannot show.
export const getStatusPageLanguageNativeName: (code: string) => string = (
  code: string,
): string => {
  return findStatusPageLanguage(code)?.nativeName || code;
};

// Every language a status page can be written in, as a picker offers it.
export const STATUS_PAGE_LANGUAGE_OPTIONS: Array<DropdownOption> =
  SUPPORTED_STATUS_PAGE_LANGUAGES.map(
    (language: StatusPageLanguage): DropdownOption => {
      return {
        value: language.code,
        label: getStatusPageLanguageLabel(language),
      };
    },
  );
