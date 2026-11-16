import fs from "fs";
import path from "path";
import {
  DEFAULT_ADMIN_DASHBOARD_LANGUAGE,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGE_CODES,
} from "../../Types/AdminDashboard/AdminDashboardLanguage";
import {
  getMarkedLocale,
  getRuntimeLocale,
  RuntimeLocaleTree,
} from "../../UI/esbuild-locales";

/*
 * The Admin Dashboard's locale files, and its same-as-English lists: for a
 * test that reads the Admin's words as its build ships them
 * (App/FeatureSet/AdminDashboard/esbuild.config.js). Each locale ships as
 * the Dashboard's do since #8146: English, in the entry chunk, without the
 * keys that map to themselves and without its plural "_one" forms; every
 * other language, a lazy chunk, without the strings English reads the same,
 * with every "_one" form it reads and a mark beside each one its language
 * words as English does on purpose (getRuntimeLocale,
 * Common/UI/esbuild-locales.js).
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
  return getRuntimeLocale({
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

/*
 * `language`'s whole file, with the same marks: what its lists say it
 * reads, against which the shipped copy, without what English reads the
 * same, must read the same (AdminRuntimeLocales).
 */
export function markedAdminDashboardLocale(
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
