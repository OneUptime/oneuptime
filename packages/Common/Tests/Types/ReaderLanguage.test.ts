import { describe, expect, test } from "@jest/globals";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../Types/Dashboard/DashboardLanguage";
import { SUPPORTED_STATUS_PAGE_LANGUAGE_CODES } from "../../Types/StatusPage/StatusPageLanguage";
import {
  DEFAULT_READER_LANGUAGE,
  getAcceptLanguageTags,
  getReaderLanguageFromAcceptLanguage,
  getVisitorLanguage,
  isReaderLanguage,
  MAX_ACCEPT_LANGUAGE_LENGTH,
  MAX_ACCEPT_LANGUAGE_TAGS,
  READER_LANGUAGE_CODES,
  toReaderLanguage,
  toSupportedLanguage,
} from "../../Types/ReaderLanguage";
import {
  getVisitorLanguage as getVisitorLanguageOfVisitorLanguage,
  toSupportedLanguage as toSupportedLanguageOfVisitorLanguage,
} from "../../UI/Utils/VisitorLanguage";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";

/*
 * THE LANGUAGES ONEUPTIME WRITES IN, AND WHICH ONE A READER READS.
 *
 * The server reads a reader's language the way every frontend reads a
 * browser's: from a tag ("de-AT", "zh-Hant-HK") and from a request's
 * Accept-Language header, onto the seventeen codes OneUptime writes in.
 */

describe("the languages OneUptime writes in", () => {
  test("are the Dashboard's and the status page's, English first", () => {
    expect(READER_LANGUAGE_CODES).toEqual(SUPPORTED_DASHBOARD_LANGUAGE_CODES);
    expect([...READER_LANGUAGE_CODES].sort()).toEqual(
      [...SUPPORTED_STATUS_PAGE_LANGUAGE_CODES].sort(),
    );
    expect(READER_LANGUAGE_CODES[0]).toBe(DEFAULT_READER_LANGUAGE);
    expect(READER_LANGUAGE_CODES).toHaveLength(17);
  });

  test("a code is one of them only as written", () => {
    expect(isReaderLanguage("de")).toBe(true);
    expect(isReaderLanguage("zh-TW")).toBe(true);
    expect(isReaderLanguage("de-AT")).toBe(false);
    expect(isReaderLanguage("xx")).toBe(false);
    expect(isReaderLanguage(7)).toBe(false);
    expect(isReaderLanguage(null)).toBe(false);
  });
});

describe("toReaderLanguage", () => {
  test.each<[string | null | undefined, string]>([
    ["de", "de"],
    ["de-AT", "de"],
    [" fr-CA ", "fr"],
    ["pt_BR", "pt"],
    ["zh", "zh-CN"],
    ["zh-SG", "zh-CN"],
    ["zh-Hans-CN", "zh-CN"],
    ["zh-HK", "zh-TW"],
    ["zh-Hant-TW", "zh-TW"],
    ["fa-IR", "fa"],
    ["en-GB", "en"],
    ["xx-YY", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
  ])("%p reads as %p", (tag: string | null | undefined, language: string) => {
    expect(toReaderLanguage(tag)).toBe(language);
  });

  test("the browser's tags are read as the public dashboard reads them", () => {
    // VisitorLanguage keeps its two functions, which are these.
    expect(toSupportedLanguageOfVisitorLanguage).toBe(toSupportedLanguage);
    expect(getVisitorLanguageOfVisitorLanguage).toBe(getVisitorLanguage);
    expect(getVisitorLanguage(["xx", "ko-KR"], READER_LANGUAGE_CODES)).toBe(
      "ko",
    );
  });
});

describe("getAcceptLanguageTags", () => {
  test("most wanted first, in the order written when two are wanted as much", () => {
    expect(getAcceptLanguageTags("de-DE,de;q=0.9,en;q=0.8")).toEqual([
      "de-DE",
      "de",
      "en",
    ]);
    expect(getAcceptLanguageTags("en;q=0.2, fr;q=0.9, ja")).toEqual([
      "ja",
      "fr",
      "en",
    ]);
    expect(getAcceptLanguageTags("es, it")).toEqual(["es", "it"]);
  });

  test("a tag weighted 0, '*' and empty entries are left out", () => {
    expect(getAcceptLanguageTags("de;q=0, *, , fr;q=0.5")).toEqual(["fr"]);
    expect(getAcceptLanguageTags("")).toEqual([]);
    expect(getAcceptLanguageTags(null)).toEqual([]);
    expect(getAcceptLanguageTags(undefined)).toEqual([]);
  });

  test("a weight that is not a number counts as not wanted; one above 1 as 1", () => {
    expect(getAcceptLanguageTags("de;q=abc, fr;q=7, ja;q=0.5")).toEqual([
      "fr",
      "ja",
    ]);
  });

  test("a header sent twice is read as one", () => {
    expect(getAcceptLanguageTags(["de;q=0.5", "fa"])).toEqual(["fa", "de"]);
  });

  test("reads only the first languages of a header that names too many", () => {
    const header: string = Array.from(
      { length: MAX_ACCEPT_LANGUAGE_TAGS + 10 },
      (_value: unknown, index: number): string => {
        return `x${index}`;
      },
    ).join(",");

    expect(getAcceptLanguageTags(header)).toHaveLength(
      MAX_ACCEPT_LANGUAGE_TAGS,
    );
  });

  test("reads only the first characters of a long header", () => {
    const header: string = `${"a".repeat(MAX_ACCEPT_LANGUAGE_LENGTH)},de`;

    expect(getAcceptLanguageTags(header)).toEqual([
      "a".repeat(MAX_ACCEPT_LANGUAGE_LENGTH),
    ]);
  });

  /*
   * A header is text from outside: 400,000 characters of its worst shapes
   * are read in time in line with their length.
   */
  test.each<[string, string]>([
    ["commas", ",".repeat(400000)],
    ["semicolons", ";".repeat(400000)],
    ["weights", "de;q=0.5;".repeat(45000)],
    ["equals signs", "a;q".repeat(10) + "=".repeat(400000)],
  ])(
    "400,000 characters of %s are read in time in line with them",
    (_name: string, header: string) => {
      const run: FastestRun<string | null> = fastestRun({
        run: (): string | null => {
          return getReaderLanguageFromAcceptLanguage(`${header}`);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    },
  );
});

describe("getReaderLanguageFromAcceptLanguage", () => {
  test.each<[string, string | null]>([
    ["de-DE,de;q=0.9,en;q=0.8", "de"],
    ["xx-YY, ko;q=0.5", "ko"],
    ["zh-HK", "zh-TW"],
    ["zh-Hans", "zh-CN"],
    ["fa", "fa"],
    ["en-US,en;q=0.9", "en"],
    ["xx, yy", null],
    ["*", null],
    ["", null],
  ])("%p is %p", (header: string, language: string | null) => {
    expect(getReaderLanguageFromAcceptLanguage(header)).toBe(language);
  });

  test("no header names no language", () => {
    expect(getReaderLanguageFromAcceptLanguage(undefined)).toBeNull();
  });
});
