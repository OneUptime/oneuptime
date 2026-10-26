import {
  getReadingDirection,
  getTextReadingDirection,
  getTextReadingDirectionByMostLetters,
  isRightToLeftLanguage,
  LEFT_TO_RIGHT,
  ReadingDirection,
  RIGHT_TO_LEFT,
  RIGHT_TO_LEFT_LANGUAGES,
  RIGHT_TO_LEFT_SCRIPTS,
  TEXT_DIRECTION_SCAN_LENGTH,
} from "../../Types/ReadingDirection";
import {
  AccountsLanguage,
  SUPPORTED_ACCOUNTS_LANGUAGES,
} from "../../Types/Accounts/AccountsLanguage";
import {
  AdminDashboardLanguage,
  SUPPORTED_ADMIN_DASHBOARD_LANGUAGES,
} from "../../Types/AdminDashboard/AdminDashboardLanguage";
import {
  DashboardLanguage,
  SUPPORTED_DASHBOARD_LANGUAGES,
} from "../../Types/Dashboard/DashboardLanguage";
import {
  DocsLanguage,
  SUPPORTED_DOCS_LANGUAGES,
} from "../../Types/Docs/DocsLanguage";
import {
  StatusPageLanguage,
  SUPPORTED_STATUS_PAGE_LANGUAGES,
} from "../../Types/StatusPage/StatusPageLanguage";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * Which way a language is read, and which way a text someone wrote is read.
 * A page sets <html dir> from the first (Common/UI/Utils/PageLanguage); the
 * Markdown viewer and editor lay a note out by the second.
 */

describe("which way a language is read", () => {
  test("Persian reads right to left, and every other language OneUptime is translated into left to right", () => {
    const registries: Array<
      Array<
        | AccountsLanguage
        | AdminDashboardLanguage
        | DashboardLanguage
        | StatusPageLanguage
      >
    > = [
      SUPPORTED_DASHBOARD_LANGUAGES,
      SUPPORTED_ADMIN_DASHBOARD_LANGUAGES,
      SUPPORTED_ACCOUNTS_LANGUAGES,
      SUPPORTED_STATUS_PAGE_LANGUAGES,
    ];

    for (const registry of registries) {
      const rightToLeft: Array<string> = registry
        .filter(
          (
            language:
              | AccountsLanguage
              | AdminDashboardLanguage
              | DashboardLanguage
              | StatusPageLanguage,
          ): boolean => {
            return isRightToLeftLanguage(language.code);
          },
        )
        .map(
          (
            language:
              | AccountsLanguage
              | AdminDashboardLanguage
              | DashboardLanguage
              | StatusPageLanguage,
          ): string => {
            return language.code;
          },
        );

      expect(rightToLeft).toEqual(["fa"]);
    }
  });

  test("agrees with the direction the docs record for each of their languages", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGES) {
      expect({
        code: language.code,
        direction: getReadingDirection(language.code),
      }).toEqual({
        code: language.code,
        direction: (language as DocsLanguage).direction,
      });
    }
  });

  test.each([
    ["fa", RIGHT_TO_LEFT],
    ["fa-IR", RIGHT_TO_LEFT],
    ["fa_IR", RIGHT_TO_LEFT],
    ["FA", RIGHT_TO_LEFT],
    [" fa ", RIGHT_TO_LEFT],
    ["ar", RIGHT_TO_LEFT],
    ["ar-EG", RIGHT_TO_LEFT],
    ["he", RIGHT_TO_LEFT],
    ["iw", RIGHT_TO_LEFT],
    ["ur-PK", RIGHT_TO_LEFT],
    ["ps", RIGHT_TO_LEFT],
    ["ckb", RIGHT_TO_LEFT],
    ["yi", RIGHT_TO_LEFT],
    ["en", LEFT_TO_RIGHT],
    ["en-US", LEFT_TO_RIGHT],
    ["de", LEFT_TO_RIGHT],
    ["zh-CN", LEFT_TO_RIGHT],
    ["zh-TW", LEFT_TO_RIGHT],
    ["zh-Hant-TW", LEFT_TO_RIGHT],
    ["hi", LEFT_TO_RIGHT],
    ["ja", LEFT_TO_RIGHT],
    ["no", LEFT_TO_RIGHT],
    // A script subtag decides: Azerbaijani in Arabic script, Kurdish in Latin.
    ["az-Arab", RIGHT_TO_LEFT],
    ["az-Arab-IR", RIGHT_TO_LEFT],
    ["az", LEFT_TO_RIGHT],
    ["pa-Arab", RIGHT_TO_LEFT],
    ["pa", LEFT_TO_RIGHT],
    ["ku-Latn", LEFT_TO_RIGHT],
    ["fa-Latn", LEFT_TO_RIGHT],
    ["uz-Arab-AF", RIGHT_TO_LEFT],
    ["sr-Cyrl", LEFT_TO_RIGHT],
  ])("%p reads %p", (language: string, expected: ReadingDirection) => {
    expect(getReadingDirection(language)).toBe(expected);
    expect(isRightToLeftLanguage(language)).toBe(expected === RIGHT_TO_LEFT);
  });

  test.each([undefined, null, "", "   ", "-", "_"])(
    "no language (%p) is read left to right",
    (language: string | null | undefined) => {
      expect(getReadingDirection(language)).toBe(LEFT_TO_RIGHT);
      expect(isRightToLeftLanguage(language)).toBe(false);
    },
  );

  test("a four-letter subtag after the language is read as its script, a two-letter one as a region", () => {
    // "IR" is a region: Persian stays right to left.
    expect(getReadingDirection("fa-IR")).toBe(RIGHT_TO_LEFT);
    // "Latn" is a script: Persian written in Latin letters reads left to right.
    expect(getReadingDirection("fa-Latn-IR")).toBe(LEFT_TO_RIGHT);
    // A script that is not right to left decides even for a right-to-left language.
    expect(getReadingDirection("ar-Cyrl")).toBe(LEFT_TO_RIGHT);
  });

  test("its lists are lower-case codes, every one of them read right to left", () => {
    for (const code of RIGHT_TO_LEFT_LANGUAGES) {
      expect(code).toBe(code.toLowerCase());
      expect(getReadingDirection(code)).toBe(RIGHT_TO_LEFT);
    }

    for (const script of RIGHT_TO_LEFT_SCRIPTS) {
      expect(script).toMatch(/^[a-z]{4}$/);
      expect(getReadingDirection(`en-${script}`)).toBe(RIGHT_TO_LEFT);
    }
  });
});

describe("which way a text someone wrote is read", () => {
  test.each([
    ["Customers cannot pay.", LEFT_TO_RIGHT],
    ["زمان پاسخ جستجو بیش از ۳ ثانیه است.", RIGHT_TO_LEFT],
    ["שלום עולם", RIGHT_TO_LEFT],
    ["مرحبا بالعالم", RIGHT_TO_LEFT],
    ["Привет", LEFT_TO_RIGHT],
    ["日本語のメモ", LEFT_TO_RIGHT],
    ["नमस्ते", LEFT_TO_RIGHT],
  ])("%p reads %p", (text: string, expected: ReadingDirection) => {
    expect(getTextReadingDirection(text)).toBe(expected);
  });

  test("its first letter decides, after Markdown's marks, digits and punctuation", () => {
    expect(getTextReadingDirection("## 1. **کندی** in search")).toBe(
      RIGHT_TO_LEFT,
    );
    expect(getTextReadingDirection("- [ ] 2026-10-26: Check the پنل")).toBe(
      LEFT_TO_RIGHT,
    );
    expect(getTextReadingDirection("> «جستجو» is slow")).toBe(RIGHT_TO_LEFT);
    expect(getTextReadingDirection("`kubectl` را اجرا کنید")).toBe(
      LEFT_TO_RIGHT,
    );
  });

  test.each([undefined, null, "", "   ", "12:30 - 99.9%", "**", "```\n```"])(
    "a text with no letter (%p) follows the page",
    (text: string | null | undefined) => {
      expect(getTextReadingDirection(text)).toBeNull();
    },
  );

  test("only the start of a text is read: a letter past it decides nothing", () => {
    const punctuation: string = "-".repeat(TEXT_DIRECTION_SCAN_LENGTH);

    expect(getTextReadingDirection(`${punctuation}فارسی`)).toBeNull();
    // The last character read is still read.
    expect(
      getTextReadingDirection(`${"-".repeat(TEXT_DIRECTION_SCAN_LENGTH - 1)}ف`),
    ).toBe(RIGHT_TO_LEFT);
  });

  test("a megabytes-long text without a letter is read in a moment", () => {
    // A log pasted into a note: 400,000 characters of digits and marks.
    const log: string = "12:30:45.123 [::1] -> 200 | ".repeat(15000);

    const read: FastestRun<ReadingDirection | null> = fastestRun({
      run: (): ReadingDirection | null => {
        return getTextReadingDirection(log);
      },
      limitInMs: 2000,
    });

    expect(read.result).toBeNull();
    expect(read.inMs).toBeLessThan(2000);
  });
});

describe("which way a text shown on a page is read", () => {
  test.each([
    ["Watches the checkout endpoint every minute.", LEFT_TO_RIGHT],
    ["زمان پاسخ جستجو بیش از ۳ ثانیه است.", RIGHT_TO_LEFT],
    ["Checkout API (EU)", LEFT_TO_RIGHT],
    ["پنل مدیریت فروشگاه", RIGHT_TO_LEFT],
    ["שלום עולם", RIGHT_TO_LEFT],
    ["Привет", LEFT_TO_RIGHT],
  ])("%p reads %p", (text: string, expected: ReadingDirection) => {
    expect(getTextReadingDirectionByMostLetters(text)).toBe(expected);
  });

  test("a Persian sentence that starts with an English word is Persian", () => {
    // Laid out from its first letter, its Persian words came out in the wrong order.
    expect(getTextReadingDirection("API پرداخت از کار افتاده.")).toBe(
      LEFT_TO_RIGHT,
    );
    expect(
      getTextReadingDirectionByMostLetters("API پرداخت از کار افتاده."),
    ).toBe(RIGHT_TO_LEFT);
    expect(
      getTextReadingDirectionByMostLetters(
        "OneUptime هشدار را برای تیم فرستاد.",
      ),
    ).toBe(RIGHT_TO_LEFT);
  });

  test("an English sentence with a Persian word is English", () => {
    expect(
      getTextReadingDirectionByMostLetters("Paged the پرداخت team about it."),
    ).toBe(LEFT_TO_RIGHT);
  });

  test("as many letters each way: its first letter decides", () => {
    expect(getTextReadingDirectionByMostLetters("abc ابت")).toBe(LEFT_TO_RIGHT);
    expect(getTextReadingDirectionByMostLetters("ابت abc")).toBe(RIGHT_TO_LEFT);
  });

  test("a letter outside the Basic Multilingual Plane counts once", () => {
    // Two mathematical letters (one code point, two UTF-16 units each) to one Persian letter.
    expect(getTextReadingDirectionByMostLetters("\u{1D400}\u{1D401} ب")).toBe(
      LEFT_TO_RIGHT,
    );
    expect(getTextReadingDirectionByMostLetters("\u{1D400} ب ت")).toBe(
      RIGHT_TO_LEFT,
    );
  });

  test.each([undefined, null, "", "   ", "12:30 - 99.9%", "**", "۱۲:۳۰"])(
    "a text with no letter (%p) follows the page",
    (text: string | null | undefined) => {
      expect(getTextReadingDirectionByMostLetters(text)).toBeNull();
    },
  );

  test("only the start of a text is read", () => {
    const english: string = "a".repeat(TEXT_DIRECTION_SCAN_LENGTH);

    // Persian past the start: not read.
    expect(
      getTextReadingDirectionByMostLetters(`${english}${"ف".repeat(10000)}`),
    ).toBe(LEFT_TO_RIGHT);
  });

  test("a megabytes-long text is read in a moment", () => {
    const log: string = "12:30:45.123 GET /checkout 200 ".repeat(15000);

    const read: FastestRun<ReadingDirection | null> = fastestRun({
      run: (): ReadingDirection | null => {
        return getTextReadingDirectionByMostLetters(log);
      },
      limitInMs: 2000,
    });

    expect(read.result).toBe(LEFT_TO_RIGHT);
    expect(read.inMs).toBeLessThan(2000);
  });
});
