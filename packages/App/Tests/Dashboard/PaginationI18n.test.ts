import PaginationCopy, {
  getPaginationUiStrings,
} from "Common/UI/Components/Pagination/PaginationCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The pagination control under every table, list, log and trace view draws
 * its own words - the rows-per-page label, the arrows' and pages' names, the
 * page indicator, the summary and the jump dialog - by looking their English
 * text up in the Dashboard's locale files. A string with no entry silently
 * stays English, so this pins:
 *
 *   - en.json maps every string to itself;
 *   - all sixteen other locales carry a translation of their own that keeps
 *     its {{placeholders}};
 *   - the control takes its words from PaginationCopy and puts each through
 *     translation, so none is left hard-coded in English.
 */

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const PAGINATION_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Common",
  "UI",
  "Components",
  "Pagination",
  "Pagination.tsx",
);

const OTHER_LOCALES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

/*
 * Strings the control shares with the rest of the Dashboard. They were in
 * every locale already.
 */
const SHARED_STRINGS: Array<string> = ["Loading..."];

/*
 * Rightly the same as the English in a locale: "Page 3" is "Page 3" in
 * French.
 */
const SAME_AS_ENGLISH: Record<string, Array<string>> = {
  fr: ["Page {{page}}"],
};

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

const STRINGS: Array<string> = getPaginationUiStrings();

const NEW_STRINGS: Array<string> = STRINGS.filter((text: string) => {
  return !SHARED_STRINGS.includes(text);
});

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("the pagination control's strings", () => {
  test("there are strings to check, and every shared one is in use", () => {
    expect(NEW_STRINGS.length).toBeGreaterThanOrEqual(14);
    expect(new Set(STRINGS).size).toBe(STRINGS.length);

    for (const text of SHARED_STRINGS) {
      expect(STRINGS).toContain(text);
    }
  });

  const en: Record<string, unknown> = readLocale("en");

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(en[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(STRINGS)("has %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(placeholders(value as string)).toEqual(placeholders(text));
    });

    test("translates every new string rather than repeating the English", () => {
      const allowed: Array<string> = SAME_AS_ENGLISH[locale] || [];

      const untranslated: Array<string> = NEW_STRINGS.filter(
        (text: string): boolean => {
          return translations[text] === text && !allowed.includes(text);
        },
      );

      expect(untranslated).toEqual([]);
    });

    /*
     * The summary falls back to the English sentence, noun and all, for a
     * locale whose noun-free sentence looks up to the English one - so each
     * locale's must really differ.
     */
    test("has noun-free summaries of its own", () => {
      for (const text of [
        PaginationCopy.showingRangeOfTotal,
        PaginationCopy.showingRange,
        PaginationCopy.noItems,
      ]) {
        expect(translations[text]).not.toBe(text);
      }
    });
  });
});

describe("the pagination control draws its words from PaginationCopy", () => {
  const source: string = fs
    .readFileSync(PAGINATION_SOURCE, "utf8")
    .replace(/\s+/g, " ");

  test.each([
    "translate(PaginationCopy.rowsPerPage)",
    "translate(PaginationCopy.previousPage)",
    "translate(PaginationCopy.nextPage)",
    "translate(PaginationCopy.pagesInBetween)",
    "translate(PaginationCopy.goToPage)",
    "translate(PaginationCopy.pageNumber)",
    "translate(PaginationCopy.loading)",
    "translateTemplate(PaginationCopy.regionLabel,",
    "translateTemplate(PaginationCopy.pageOfPages,",
    "translateTemplate(PaginationCopy.goToPageDescription,",
    "PaginationCopy.goToPageNumber",
    "title={PaginationCopy.goToPage}",
    "submitButtonText={PaginationCopy.goToPage}",
    "getPaginationSummary({",
  ])("Pagination.tsx uses %s", (snippet: string) => {
    expect(source).toContain(snippet);
  });

  test.each([
    ">Rows per page<",
    '"Go to previous page"',
    '"Go to next page"',
    '"Go to a page in between"',
    "`Page ${",
    "`Go to page ${",
    "`Showing ${",
    '"Loading…"',
  ])("Pagination.tsx no longer hard-codes %s", (snippet: string) => {
    expect(source).not.toContain(snippet);
  });
});
