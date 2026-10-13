import { PERSIAN_PATH_SEPARATOR } from "./DocsProductsMenu";
import { PATH_SEPARATOR } from "./DocsPageShape";
import fs from "fs";
import path from "path";

/*
 * How a docs page names a page of the Admin Dashboard, in each docs language.
 *
 * The Admin Dashboard is an app of its own, with its own locale files
 * (AdminDashboard/src/Locales/<language>.json) keyed by nested keys
 * ("breadcrumbs.globalLlmProviders"), not by the English text as the
 * Dashboard's are. So a page names an Admin Dashboard path by the keys its
 * menus draw it from, and each language reads them from its own file.
 *
 * A path is one bold span with " → " between its segments, as the docs'
 * English pages write it; Persian bolds each segment and joins them with
 * " > ", as it does a Dashboard path (DocsProductsMenu.drawnPath).
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/AdminDashboard/src/Locales",
);

const cache: Map<string, Record<string, unknown>> = new Map();

function adminLocale(language: string): Record<string, unknown> {
  const cached: Record<string, unknown> | undefined = cache.get(language);

  if (cached) {
    return cached;
  }

  const locale: Record<string, unknown> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;

  cache.set(language, locale);

  return locale;
}

// What the Admin Dashboard draws for a label, by its nested key, in a language.
export function adminDashboardLabel(language: string, key: string): string {
  let value: unknown = adminLocale(language);

  for (const part of key.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[part];
  }

  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (language === "en") {
    throw new Error(`The Admin Dashboard has no label keyed ${key}`);
  }

  // A locale without a wording of its own draws the English.
  return adminDashboardLabel("en", key);
}

// An Admin Dashboard path, by its segments' keys, as a page in a language writes it.
export function drawnAdminPath(
  language: string,
  keys: ReadonlyArray<string>,
): string {
  const drawn: Array<string> = keys.map((key: string): string => {
    return adminDashboardLabel(language, key);
  });

  if (language === "fa") {
    return drawn
      .map((segment: string): string => {
        return `**${segment}**`;
      })
      .join(PERSIAN_PATH_SEPARATOR);
  }

  return `**${drawn.join(PATH_SEPARATOR)}**`;
}

/*
 * The Admin Dashboard's Global LLM Providers page, where a server
 * administrator adds and tests the providers every project can fall back
 * to.
 */
export const GLOBAL_LLM_PROVIDERS_PAGE: ReadonlyArray<string> = [
  "breadcrumbs.settings",
  "breadcrumbs.globalLlmProviders",
];
