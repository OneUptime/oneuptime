import fs from "fs";
import path from "path";
import {
  DEFAULT_ADMIN_DASHBOARD_LANGUAGE,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
} from "../../Types/AdminDashboard/AdminDashboardLanguage";
import { getMarkedLocale, RuntimeLocaleTree } from "../../UI/esbuild-locales";

/*
 * The Admin Dashboard's locale files, and its same-as-English lists: for a
 * test that reads the Admin's words as its build ships them
 * (App/FeatureSet/AdminDashboard/esbuild.config.js). Every locale ships
 * whole, with a mark beside each plural "_one" form its language words as
 * English does on purpose (getMarkedLocale, Common/UI/esbuild-locales.js).
 */

export const ADMIN_DASHBOARD_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../App/FeatureSet/AdminDashboard",
);

export const ADMIN_DASHBOARD_LOCALES_DIRECTORY: string = path.join(
  ADMIN_DASHBOARD_DIRECTORY,
  "src",
  "Locales",
);

// Each language's same-as-English list: <code>.json, its "sameAsEnglish".
export const ADMIN_DASHBOARD_PROGRESS_DIRECTORY: string = path.join(
  ADMIN_DASHBOARD_DIRECTORY,
  "i18n",
  "Progress",
);

export const ADMIN_DASHBOARD_ENGLISH: string = DEFAULT_ADMIN_DASHBOARD_LANGUAGE;

const localeCache: Map<string, RuntimeLocaleTree> = new Map<
  string,
  RuntimeLocaleTree
>();

// `language`'s file in src/Locales, as it is written.
export function readAdminDashboardLocale(language: string): RuntimeLocaleTree {
  const cached: RuntimeLocaleTree | undefined = localeCache.get(language);

  if (cached) {
    return cached;
  }

  const locale: RuntimeLocaleTree = JSON.parse(
    fs.readFileSync(
      path.join(ADMIN_DASHBOARD_LOCALES_DIRECTORY, `${language}.json`),
      "utf8",
    ),
  ) as RuntimeLocaleTree;

  localeCache.set(language, locale);

  return locale;
}

/*
 * The English `language` keeps on purpose in the Admin Dashboard: its
 * progress file's "sameAsEnglish" list, or none when it has no file.
 */
export function readAdminDashboardSameAsEnglish(
  language: string,
): ReadonlyArray<string> {
  const progressPath: string = path.join(
    ADMIN_DASHBOARD_PROGRESS_DIRECTORY,
    `${language}.json`,
  );

  if (!fs.existsSync(progressPath)) {
    return [];
  }

  const progress: { sameAsEnglish?: Array<string> } = JSON.parse(
    fs.readFileSync(progressPath, "utf8"),
  ) as { sameAsEnglish?: Array<string> };

  return progress.sameAsEnglish || [];
}

/*
 * `language`'s locale as the Admin Dashboard's build ships it, from `list`
 * (its same-as-English list unless a test hands it another).
 */
export function shippedAdminDashboardLocale(
  language: string,
  list: ReadonlyArray<string> = readAdminDashboardSameAsEnglish(language),
): RuntimeLocaleTree {
  return getMarkedLocale({
    language: language,
    fallbackLanguage: ADMIN_DASHBOARD_ENGLISH,
    locale: readAdminDashboardLocale(language),
    fallback:
      language === ADMIN_DASHBOARD_ENGLISH
        ? undefined
        : readAdminDashboardLocale(ADMIN_DASHBOARD_ENGLISH),
    sameAsEnglish: list,
  });
}

// Every language the Admin Dashboard offers, English first.
export const ADMIN_DASHBOARD_CODES: ReadonlyArray<string> =
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES;
