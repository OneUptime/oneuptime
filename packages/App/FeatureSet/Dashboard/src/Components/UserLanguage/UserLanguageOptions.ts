import {
  DashboardLanguage,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "Common/Types/Dashboard/DashboardLanguage";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * THE LANGUAGES A PERSON CAN PICK AS THEIR OWN, AS USER PROFILE NAMES THEM.
 *
 * Each in its own words, then its English name when that is not the same -
 * "Deutsch (German)", "日本語 (Japanese)", "English" - as a status page's
 * Languages card names them (StatusPage/StatusPageLanguageOptions), so a
 * reader finds their own language whatever language the page is in.
 */

// A language as the picker and the profile name it.
export const getUserLanguageLabel: (language: DashboardLanguage) => string = (
  language: DashboardLanguage,
): string => {
  return language.nativeName === language.englishName
    ? language.nativeName
    : `${language.nativeName} (${language.englishName})`;
};

/*
 * A code's label ("Deutsch (German)"), or the code itself for one
 * OneUptime does not write in, so a stored value is never hidden.
 */
export const getUserLanguageLabelOfCode: (code: string) => string = (
  code: string,
): string => {
  const language: DashboardLanguage | undefined =
    SUPPORTED_DASHBOARD_LANGUAGES.find(
      (supported: DashboardLanguage): boolean => {
        return supported.code === code;
      },
    );

  return language ? getUserLanguageLabel(language) : code;
};

// Every language a person can pick, as the profile's picker offers it.
export const USER_LANGUAGE_OPTIONS: Array<DropdownOption> =
  SUPPORTED_DASHBOARD_LANGUAGES.map(
    (language: DashboardLanguage): DropdownOption => {
      return {
        value: language.code,
        label: getUserLanguageLabel(language),
      };
    },
  );
