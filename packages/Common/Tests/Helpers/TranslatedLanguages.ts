import { SUPPORTED_ACCOUNTS_LANGUAGE_CODES } from "../../Types/Accounts/AccountsLanguage";
import { SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES } from "../../Types/AdminDashboard/AdminDashboardLanguage";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../Types/Dashboard/DashboardLanguage";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../Types/Docs/DocsLanguage";
import { SUPPORTED_STATUS_PAGE_LANGUAGE_CODES } from "../../Types/StatusPage/StatusPageLanguage";

/*
 * The languages each app is translated into, English aside, read from the
 * lists the apps offer their readers. A test that checks a word in every
 * language reads one of these rather than writing the languages out, so a
 * language an app adds is checked the day it is added (Arabic, #6408, was
 * missing from some 240 such lists).
 */

const allButEnglish: (codes: Array<string>) => ReadonlyArray<string> = (
  codes: Array<string>,
): ReadonlyArray<string> => {
  return codes.filter((code: string): boolean => {
    return code !== "en";
  });
};

export const DASHBOARD_LANGUAGES: ReadonlyArray<string> = allButEnglish(
  SUPPORTED_DASHBOARD_LANGUAGE_CODES,
);

export const ADMIN_DASHBOARD_LANGUAGES: ReadonlyArray<string> = allButEnglish(
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
);

export const ACCOUNTS_LANGUAGES: ReadonlyArray<string> = allButEnglish(
  SUPPORTED_ACCOUNTS_LANGUAGE_CODES,
);

export const STATUS_PAGE_LANGUAGES: ReadonlyArray<string> = allButEnglish(
  SUPPORTED_STATUS_PAGE_LANGUAGE_CODES,
);

/*
 * The languages the docs are written in, English aside. Not every language
 * the apps offer has docs (Arabic's are English, #6466), so a test that
 * reads a docs page or the docs' locale file reads it in these.
 */
export const DOCS_LANGUAGES: ReadonlyArray<string> = allButEnglish(
  SUPPORTED_DOCS_LANGUAGE_CODES,
);
