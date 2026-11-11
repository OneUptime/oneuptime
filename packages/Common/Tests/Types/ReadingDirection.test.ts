import {
  getReadingDirection,
  getTextReadingDirection,
  getTextReadingDirectionByMostLetters,
  hasRightToLeftWords,
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
  test("Persian and Arabic read right to left, and every other language OneUptime is translated into left to right", () => {
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

      expect(rightToLeft).toEqual(["fa", "ar"]);
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
    ["ar-SA", RIGHT_TO_LEFT],
    ["ar_AE", RIGHT_TO_LEFT],
    ["AR", RIGHT_TO_LEFT],
    // Arabic written in Latin letters (Arabizi) reads left to right.
    ["ar-Latn", LEFT_TO_RIGHT],
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

  describe("what reads as written in any language", () => {
    const LRI: string = String.fromCharCode(0x2066);
    const RLI: string = String.fromCharCode(0x2067);
    const FSI: string = String.fromCharCode(0x2068);
    const PDI: string = String.fromCharCode(0x2069);
    // 27 Persian letters, and 32 Latin ones, 28 of them in its path.
    const PERSIAN_OIDC_HELP: string =
      "نشانی سند کشف OIDC — معمولاً به /.well-known/openid-configuration ختم می‌شود.";
    const SET_APART: string = `نشانی سند کشف OIDC — معمولاً به ${LRI}/.well-known/openid-configuration${PDI} ختم می‌شود.`;

    test("an isolate decides nothing about the words round it: a Persian sentence round its code is Persian", () => {
      // Its code counted, it was read from the left, its words turned round.
      expect(getTextReadingDirectionByMostLetters(PERSIAN_OIDC_HELP)).toBe(
        LEFT_TO_RIGHT,
      );
      expect(getTextReadingDirectionByMostLetters(SET_APART)).toBe(
        RIGHT_TO_LEFT,
      );
    });

    test("an English sentence round a long Persian value is English", () => {
      const value: string = "سرویس پرداخت فروشگاه اینترنتی مرکزی";

      expect(
        getTextReadingDirectionByMostLetters(`Paged ${value} again.`),
      ).toBe(RIGHT_TO_LEFT);
      expect(
        getTextReadingDirectionByMostLetters(
          `Paged ${FSI}${value}${PDI} again.`,
        ),
      ).toBe(LEFT_TO_RIGHT);
    });

    test.each([
      ["LRI", LRI],
      ["RLI", RLI],
      ["FSI", FSI],
    ])("%s opens an isolate", (_name: string, opening: string) => {
      expect(
        getTextReadingDirectionByMostLetters(`ابت ${opening}abcdefgh${PDI}`),
      ).toBe(RIGHT_TO_LEFT);
      expect(
        getTextReadingDirectionByMostLetters(`abc ${opening}ابتثجحخد${PDI}`),
      ).toBe(LEFT_TO_RIGHT);
    });

    test("an isolate in an isolate closes with its own PDI, and the outer one with the next", () => {
      expect(
        getTextReadingDirectionByMostLetters(
          `ابت ${LRI}abc ${FSI}def${PDI} ghi${PDI} jk`,
        ),
      ).toBe(RIGHT_TO_LEFT);
      // Past both PDIs, the Latin letters count again.
      expect(
        getTextReadingDirectionByMostLetters(
          `ابت ${LRI}a ${FSI}b${PDI} c${PDI} defg`,
        ),
      ).toBe(LEFT_TO_RIGHT);
    });

    test("a PDI with no isolate open closes nothing", () => {
      expect(getTextReadingDirectionByMostLetters(`ابت${PDI} abcd`)).toBe(
        LEFT_TO_RIGHT,
      );
      expect(
        getTextReadingDirectionByMostLetters(
          `abcd${PDI}${PDI} ${LRI}ابتثجح${PDI}`,
        ),
      ).toBe(LEFT_TO_RIGHT);
    });

    test("an isolate left open runs to the text's end", () => {
      expect(getTextReadingDirectionByMostLetters(`ابت ${LRI}abcdefgh`)).toBe(
        RIGHT_TO_LEFT,
      );
    });

    test("a text that is all isolates is read by the letters inside them", () => {
      expect(getTextReadingDirectionByMostLetters(`${FSI}پرداخت${PDI}`)).toBe(
        RIGHT_TO_LEFT,
      );
      expect(getTextReadingDirectionByMostLetters(`${LRI}--help${PDI}.`)).toBe(
        LEFT_TO_RIGHT,
      );
      expect(
        getTextReadingDirectionByMostLetters(`${FSI}ab${PDI} ${FSI}ابت${PDI}`),
      ).toBe(RIGHT_TO_LEFT);
      // As many each way inside: the first letter inside decides.
      expect(
        getTextReadingDirectionByMostLetters(`${FSI}abc${PDI} ${FSI}ابت${PDI}`),
      ).toBe(LEFT_TO_RIGHT);
    });

    test("a tie outside goes to the first letter outside, whatever is inside", () => {
      expect(
        getTextReadingDirectionByMostLetters(`${LRI}abcdefgh${PDI} ابت abc`),
      ).toBe(RIGHT_TO_LEFT);
    });

    test("a web address reads as written, and decides nothing about the words round it either", () => {
      // 4 Arabic letters, 22 Latin ones in the address.
      expect(
        getTextReadingDirectionByMostLetters(
          "افتح https://status.example.com/incidents",
        ),
      ).toBe(RIGHT_TO_LEFT);
      expect(
        getTextReadingDirectionByMostLetters(
          "نشانی S3: s3://backups-prod/postgres/daily یا https://minio.example.com:9000/backups.",
        ),
      ).toBe(RIGHT_TO_LEFT);
      // The words round it are English: English.
      expect(
        getTextReadingDirectionByMostLetters(
          "Open https://وضعیت.example.com/حوادث-امروز-پرداخت",
        ),
      ).toBe(LEFT_TO_RIGHT);
      // Nothing but an address: its letters decide.
      expect(
        getTextReadingDirectionByMostLetters("https://status.example.com/"),
      ).toBe(LEFT_TO_RIGHT);
      expect(
        getTextReadingDirectionByMostLetters(
          `${LRI}https://status.example.com/${PDI} https://وضعیت.example.com/پرداخت-امروز`,
        ),
      ).toBe(LEFT_TO_RIGHT);
    });

    test("an address starts at a scheme at the start of a word, and ends at a space", () => {
      // No "://": a name, counted.
      expect(
        getTextReadingDirectionByMostLetters("افتح Node.js mailto:ops"),
      ).toBe(LEFT_TO_RIGHT);
      // The words after the address count again.
      expect(
        getTextReadingDirectionByMostLetters(
          "ابت https://example.com then the rest of it",
        ),
      ).toBe(LEFT_TO_RIGHT);
      // A scheme of up to 32 signs; a longer run before "://" is no scheme.
      expect(
        getTextReadingDirectionByMostLetters(`ابتث ${"a".repeat(32)}://x`),
      ).toBe(RIGHT_TO_LEFT);
      expect(
        getTextReadingDirectionByMostLetters(`ابتث ${"a".repeat(33)}://x`),
      ).toBe(LEFT_TO_RIGHT);
    });

    test("a text of hundreds of almost-addresses is read in a moment", () => {
      const almost: string = `${"a.b-".repeat(300)} ${"x:/".repeat(300)} ${"ab".repeat(600)}://`;

      expect(almost.length).toBeLessThan(TEXT_DIRECTION_SCAN_LENGTH);

      const read: FastestRun<ReadingDirection | null> = fastestRun({
        run: (): ReadingDirection | null => {
          return getTextReadingDirectionByMostLetters(almost);
        },
        limitInMs: 200,
      });

      expect(read.result).toBe(LEFT_TO_RIGHT);
      expect(read.inMs).toBeLessThan(200);
    });

    // Whether a text's first letter is an Arabic one.
    const FIRST_LETTER_ARABIC: RegExp = /^[^\p{L}]*\p{Script=Arabic}/u;

    test("with no isolate and no address, a text is read as it always was", () => {
      for (const text of [
        "Watches the checkout endpoint every minute.",
        "API پرداخت از کار افتاده.",
        "abc ابت",
        "ابت abc",
        PERSIAN_OIDC_HELP,
      ]) {
        const counted: { rightToLeft: number; leftToRight: number } = {
          rightToLeft: (text.match(/\p{Script=Arabic}/gu) || []).length,
          leftToRight: (text.match(/\p{Script=Latin}/gu) || []).length,
        };
        const startsArabic: boolean = FIRST_LETTER_ARABIC.test(text);
        const expected: ReadingDirection =
          counted.rightToLeft === counted.leftToRight
            ? startsArabic
              ? RIGHT_TO_LEFT
              : LEFT_TO_RIGHT
            : counted.rightToLeft > counted.leftToRight
              ? RIGHT_TO_LEFT
              : LEFT_TO_RIGHT;

        expect({
          text,
          read: getTextReadingDirectionByMostLetters(text),
        }).toEqual({ text, read: expected });
      }
    });
  });

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

/*
 * Whether a text has right-to-left words of its own: a translated line on
 * an Arabic or Persian page is drawn the page's way however many names it
 * gives in Latin letters (UI/Utils/LineDirection's
 * getTranslatedLineDirection), and an English one is not.
 */
describe("whether a text has right-to-left words of its own", () => {
  const LRI: string = String.fromCharCode(0x2066);
  const FSI: string = String.fromCharCode(0x2068);
  const PDI: string = String.fromCharCode(0x2069);

  test.each([
    // The 2FA help: 31 Arabic letters, 49 Latin ones in its product names.
    "احصل على رمز لمرة واحدة من تطبيق مثل Google Authenticator، 1Password أو Microsoft Authenticator.",
    // Its product's name first.
    "Microsoft Teams غير متصل بعد!",
    "نام میزبان سرور SMTP. نمونه‌ها: smtp.office365.com (Microsoft 365)، smtp.gmail.com (Google)",
    "שלום world peace",
  ])(
    "a sentence in a right-to-left script that names more in Latin letters has: %p",
    (text: string) => {
      expect(getTextReadingDirectionByMostLetters(text)).toBe(LEFT_TO_RIGHT);
      expect(hasRightToLeftWords(text)).toBe(true);
    },
  );

  test("an English sentence has none", () => {
    expect(hasRightToLeftWords("Turn this on to page the team.")).toBe(false);
    expect(hasRightToLeftWords("Привет")).toBe(false);
  });

  test("what a text sets apart is not its own words: an English sentence round a Persian name set apart has none", () => {
    expect(hasRightToLeftWords(`Paged ${FSI}سارا احمدی${PDI} again.`)).toBe(
      false,
    );
    expect(hasRightToLeftWords(`${LRI}پرداخت${PDI}`)).toBe(false);
    // Nor is an address, Persian letters and all.
    expect(hasRightToLeftWords("Open https://وضعیت.example.com/حوادث")).toBe(
      false,
    );
    // Past the isolate, the words count again.
    expect(hasRightToLeftWords(`${FSI}abc${PDI} ب`)).toBe(true);
  });

  test("an English sentence round a Persian name that is not set apart has", () => {
    expect(hasRightToLeftWords("Paged the پرداخت team about it.")).toBe(true);
  });

  test.each([undefined, null, "", "   ", "12:30 - 99.9%", "۱۲:۳۰"])(
    "a text with no letter (%p) has none",
    (text: string | null | undefined) => {
      expect(hasRightToLeftWords(text)).toBe(false);
    },
  );

  test("only the start of a text is read", () => {
    expect(
      hasRightToLeftWords(
        `${"a".repeat(TEXT_DIRECTION_SCAN_LENGTH)}${"ف".repeat(10)}`,
      ),
    ).toBe(false);
  });
});
