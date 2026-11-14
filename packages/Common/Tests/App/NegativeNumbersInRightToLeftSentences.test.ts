// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { setCodeApartInSentence } from "../../Types/CodeInSentence";
import { getNumberLocale } from "../../Types/DateLanguage";
import { isRightToLeftLanguage } from "../../Types/ReadingDirection";
import {
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../Helpers/BidiLayout";

/*
 * A NEGATIVE NUMBER IN AN ARABIC OR PERSIAN SENTENCE KEEPS ITS MINUS IN FRONT.
 *
 * To the bidi algorithm a hyphen-minus (and the minus sign, U+2212) is a
 * separator, not part of the number after it. Written before a number in a
 * line read from the right - "سیگنال ضعیف‌تر از -۱۰۰ dBm" - it takes the
 * sentence's direction and is drawn on the number's right: the reader saw
 * "۱۰۰-", a positive number with a stray dash (issue #7102: the IoT
 * example's "۸۷٪ باتری · -۶۱ dBm", four signal help texts, a leap second's
 * "(-۱ ثانیه)" and a Kafka help text). Intl writes a negative number for
 * Persian with a left-to-right mark before its minus sign (U+200E, then
 * U+2212), which ties the minus to the number, as the tile beside the IoT
 * row writes it. Arabic writes Latin digits, and a hyphen-minus before them
 * reads as a flag the page sets apart as code, so its help texts were drawn
 * right; they now say the number with the word for minus ("سالب 100"), as
 * Locales/ARABIC.md writes a negative number and the IoT rows beside them do.
 *
 * This reads every value of every frontend's locale file for a language
 * read from the right, finds each minus at the start of a number, and lays
 * the value out as the page draws it - its code set apart as i18next sets
 * it (CodeReadsAsWritten), in a paragraph read from the right - with a copy
 * of the bidi algorithm (Helpers/BidiLayout): the minus and its number must
 * be drawn as they are written, the minus on the number's left. The values
 * as they were - a hyphen-minus before the number - are the negative
 * control.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..");

const FRONTEND_LOCALE_DIRS: Record<string, string> = {
  Dashboard: "App/FeatureSet/Dashboard/src/Locales",
  StatusPage: "App/FeatureSet/StatusPage/src/Locales",
  Accounts: "App/FeatureSet/Accounts/src/Locales",
  AdminDashboard: "App/FeatureSet/AdminDashboard/src/Locales",
  PublicDashboard: "App/FeatureSet/PublicDashboard/src/Locales",
};

const HYPHEN_MINUS: string = "-";
const MINUS_SIGN: string = String.fromCharCode(0x2212);
const LRM: string = String.fromCharCode(0x200e);

/*
 * A minus at the start of a number: a hyphen-minus or a minus sign right
 * before a digit, with no letter, digit or other dash before it - "-100",
 * "(-1", never the "-03" of "esx-03" or the "-2" of "my-channel-2".
 */
const MINUS_BEFORE_A_NUMBER: RegExp =
  /(?<![\p{L}\p{Nd}\p{M}_.\-\u2212\u002F])[-\u2212](?=\p{Nd})/gu;

// A hyphen-minus right before a digit: "-100".
const HYPHEN_BEFORE_A_DIGIT: RegExp = /-\p{Nd}/u;

// The same at a word's start, where an Arabic sentence would mean a negative number.
const HYPHEN_BEFORE_A_DIGIT_AT_A_WORD_START: RegExp = /(^|\s)-\p{Nd}/u;

const ANY_DIGIT: RegExp = /\p{Nd}/u;

// The digits of a number after its minus: "100", "1.5", in any script.
const NUMBER_AT: RegExp = /^\p{Nd}+(?:[.,\u066B\u066C]\p{Nd}+)*/u;

// Persian's own digits, 0 to 9 in Persian: never in code, always a number the language writes.
const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/u;

type LocaleTree = { [key: string]: string | LocaleTree };

interface Sentence {
  app: string;
  language: string;
  key: string;
  text: string;
}

interface NegativeNumber {
  sentence: Sentence;
  // Where its minus is in the sentence, and where its number ends.
  from: number;
  to: number;
}

// Every leaf of a locale file, keyed by its path of keys.
const leavesOf: (
  tree: LocaleTree,
  prefix?: string,
) => Array<[string, string]> = (
  tree: LocaleTree,
  prefix: string = "",
): Array<[string, string]> => {
  const found: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(tree)) {
    const at: string = prefix ? `${prefix} > ${key}` : key;

    if (typeof value === "string") {
      found.push([at, value]);
    } else {
      found.push(...leavesOf(value, at));
    }
  }

  return found;
};

const RIGHT_TO_LEFT_SENTENCES: Array<Sentence> = Object.entries(
  FRONTEND_LOCALE_DIRS,
).flatMap(([app, directory]: [string, string]): Array<Sentence> => {
  const folder: string = path.join(PACKAGES, directory);

  return fs
    .readdirSync(folder)
    .filter((file: string): boolean => {
      return (
        file.endsWith(".json") &&
        isRightToLeftLanguage(file.slice(0, -".json".length))
      );
    })
    .flatMap((file: string): Array<Sentence> => {
      const language: string = file.slice(0, -".json".length);
      const tree: LocaleTree = JSON.parse(
        fs.readFileSync(path.join(folder, file), "utf8"),
      ) as LocaleTree;

      return leavesOf(tree).map(([key, text]: [string, string]): Sentence => {
        return { app, language, key, text };
      });
    });
});

// Every minus at the start of a number in `sentence`, with its number.
const negativeNumbersIn: (sentence: Sentence) => Array<NegativeNumber> = (
  sentence: Sentence,
): Array<NegativeNumber> => {
  const found: Array<NegativeNumber> = [];

  for (const match of sentence.text.matchAll(MINUS_BEFORE_A_NUMBER)) {
    const from: number = match.index ?? 0;
    const digits: RegExpExecArray | null = NUMBER_AT.exec(
      sentence.text.slice(from + 1),
    );

    found.push({
      sentence,
      from,
      to: from + 1 + (digits ? digits[0].length : 0),
    });
  }

  return found;
};

/*
 * Whether the minus and the number after it are drawn as written - the
 * minus on the number's left - in the sentence as the page draws it: its
 * code set apart by i18next, in a paragraph read from the right.
 */
const isDrawnWithItsMinusInFront: (negative: NegativeNumber) => boolean = (
  negative: NegativeNumber,
): boolean => {
  const { sentence, from, to } = negative;
  const piece: string = sentence.text.slice(from, to);
  const shown: string = setCodeApartInSentence(
    sentence.text,
    sentence.language,
  );
  // The same occurrence of the piece once code is set apart.
  const occurrence: number = sentence.text.slice(0, from).split(piece).length;
  let start: number = -1;

  for (let seen: number = 0; seen < occurrence; seen++) {
    start = shown.indexOf(piece, start + 1);
  }

  expect({ piece, found: start >= 0 }).toEqual({ piece, found: true });

  return isDrawnAsWritten(drawLine(shown, "rtl"), start, start + piece.length);
};

const describeNegative: (negative: NegativeNumber) => string = (
  negative: NegativeNumber,
): string => {
  const { sentence, from, to } = negative;

  return `${sentence.app} ${sentence.language} "${sentence.key}": ${sentence.text.slice(
    Math.max(0, from - 12),
    to + 6,
  )}`;
};

const NEGATIVE_NUMBERS: Array<NegativeNumber> =
  RIGHT_TO_LEFT_SENTENCES.flatMap(negativeNumbersIn);

const dashboardValue: (language: string, key: string) => string = (
  language: string,
  key: string,
): string => {
  const sentence: Sentence | undefined = RIGHT_TO_LEFT_SENTENCES.find(
    (candidate: Sentence): boolean => {
      return (
        candidate.app === "Dashboard" &&
        candidate.language === language &&
        candidate.key === key
      );
    },
  );

  expect(sentence).toBeDefined();

  return sentence?.text || "";
};

const IOT_ROW: string = "87% battery · -61 dBm";
const SIGNAL_HELP: string =
  "Wireless signal strength in dBm from each device's most recent report. Values are negative: closer to 0 is stronger, and below -100 dBm is weak.";
const LEAP_SECOND: string = "Leap second today (-1 s)";

// The issue's own sentences: each English holds a negative number.
const ISSUE_SENTENCES: Array<string> = [
  IOT_ROW,
  "79% battery · -70 dBm",
  SIGNAL_HELP,
  "Wireless signal strength from this device's most recent report, in dBm. Values are negative and closer to 0 is stronger: around -50 is excellent, while below -100 is weak and data may drop.",
  "The average wireless signal strength of the devices that report one, using each device's most recent readings in the selected time range. It is in dBm, which is negative: closer to 0 is stronger, around -50 is excellent and below -100 is weak.",
  "Devices marked offline, plus devices whose latest reading shows battery below 20% or signal weaker than -100 dBm. Battery and signal only count if the device reported in the last 15 minutes, and this list ignores the time range picker.",
  LEAP_SECOND,
  "Age of the oldest unacknowledged entry in the topic's backlog, for the partition furthest behind; -1 while the broker cannot tell.",
];

describe("a negative number in a sentence read from the right", () => {
  test("the frontends' Arabic and Persian files are read, and hold negative numbers", () => {
    const languages: Set<string> = new Set<string>(
      RIGHT_TO_LEFT_SENTENCES.map((sentence: Sentence): string => {
        return sentence.language;
      }),
    );

    expect([...languages].sort()).toEqual(expect.arrayContaining(["ar", "fa"]));
    expect(RIGHT_TO_LEFT_SENTENCES.length).toBeGreaterThan(20000);
    // The Persian IoT rows and signal texts are among them.
    expect(
      NEGATIVE_NUMBERS.filter((negative: NegativeNumber): boolean => {
        return negative.sentence.language === "fa";
      }).length,
    ).toBeGreaterThanOrEqual(8);
  });

  test("is drawn with its minus in front of it", () => {
    expect(
      NEGATIVE_NUMBERS.filter((negative: NegativeNumber): boolean => {
        return !isDrawnWithItsMinusInFront(negative);
      }).map(describeNegative),
    ).toEqual([]);
  });

  test("in Persian digits is written as Intl writes it: a left-to-right mark, then the minus sign", () => {
    const written: Array<string> = [];

    for (const negative of NEGATIVE_NUMBERS) {
      const { sentence, from, to } = negative;

      if (!PERSIAN_DIGIT.test(sentence.text.slice(from, to))) {
        continue;
      }

      if (
        sentence.text[from] !== MINUS_SIGN ||
        sentence.text[from - 1] !== LRM
      ) {
        written.push(describeNegative(negative));
      }
    }

    expect(written).toEqual([]);
  });

  test("no Persian or Arabic value puts a hyphen-minus right before a number of the language's own", () => {
    const hyphens: Array<string> = NEGATIVE_NUMBERS.filter(
      (negative: NegativeNumber): boolean => {
        return (
          negative.sentence.text[negative.from] === HYPHEN_MINUS &&
          PERSIAN_DIGIT.test(
            negative.sentence.text.slice(negative.from, negative.to),
          )
        );
      },
    ).map(describeNegative);

    expect(hyphens).toEqual([]);
  });
});

describe("the issue's sentences", () => {
  test("Persian writes each negative number as Intl.NumberFormat('fa') does", () => {
    const intlMinusSixtyOne: string = (-61).toLocaleString(
      getNumberLocale("fa"),
    );

    // Intl's own Persian negative: a left-to-right mark, the minus sign, the digits.
    expect(intlMinusSixtyOne).toBe(`${LRM}${MINUS_SIGN}۶۱`);
    expect(dashboardValue("fa", IOT_ROW)).toBe(
      `۸۷٪ باتری · ${intlMinusSixtyOne} dBm`,
    );
    expect(dashboardValue("fa", "79% battery · -70 dBm")).toContain(
      (-70).toLocaleString(getNumberLocale("fa")),
    );
    expect(dashboardValue("fa", SIGNAL_HELP)).toContain(
      `${(-100).toLocaleString(getNumberLocale("fa"))} dBm`,
    );
    expect(dashboardValue("fa", LEAP_SECOND)).toContain(
      `(${(-1).toLocaleString(getNumberLocale("fa"))} ثانیه)`,
    );

    for (const key of ISSUE_SENTENCES) {
      const persian: string = dashboardValue("fa", key);

      expect({
        key,
        hyphenBeforeADigit: HYPHEN_BEFORE_A_DIGIT.test(persian),
      }).toEqual({
        key,
        hyphenBeforeADigit: false,
      });
      expect({ key, minusSign: persian.includes(MINUS_SIGN) }).toEqual({
        key,
        minusSign: true,
      });
    }
  });

  test("Arabic says each one with its word for minus, as Locales/ARABIC.md writes a negative number", () => {
    for (const key of ISSUE_SENTENCES) {
      const arabic: string = dashboardValue("ar", key);

      if (key === LEAP_SECOND) {
        // Said in words: "a second is taken away".
        expect(arabic).not.toMatch(ANY_DIGIT);
        continue;
      }

      expect({ key, hasMinusWord: arabic.includes("سالب ") }).toEqual({
        key,
        hasMinusWord: true,
      });
      expect({
        key,
        hyphenBeforeADigit: HYPHEN_BEFORE_A_DIGIT_AT_A_WORD_START.test(arabic),
      }).toEqual({ key, hyphenBeforeADigit: false });
    }
  });

  test("the Persian IoT row is drawn with the minus before 61, and reads in logical order", () => {
    const row: string = dashboardValue("fa", IOT_ROW);
    const drawn: string = getDrawnText(drawLine(row, "rtl"));

    // Logical order: the percent, the battery, the separator, then minus 61 and its unit.
    expect(row.indexOf("۸۷٪")).toBeLessThan(row.indexOf(MINUS_SIGN));
    expect(row.indexOf(MINUS_SIGN)).toBe(row.indexOf("۶۱") - 1);
    expect(row[row.indexOf(MINUS_SIGN) - 1]).toBe(LRM);
    // Drawn from the right: the minus stays on the left of its number.
    expect(drawn).toContain(`${MINUS_SIGN}۶۱`);
    expect(drawn).not.toContain(`۶۱${MINUS_SIGN}`);
  });
});

describe("the guard itself", () => {
  const sentenceOf: (language: string, text: string) => Sentence = (
    language: string,
    text: string,
  ): Sentence => {
    return { app: "Dashboard", language, key: text, text };
  };

  const drawnRight: (language: string, text: string) => Array<boolean> = (
    language: string,
    text: string,
  ): Array<boolean> => {
    return negativeNumbersIn(sentenceOf(language, text)).map(
      isDrawnWithItsMinusInFront,
    );
  };

  test("finds a minus at the start of a number, never inside a name", () => {
    expect(
      negativeNumbersIn(
        sentenceOf("fa", "VM · esx-03 · my-channel-2 · ۱۰-۲۰ · (-۱ ثانیه)"),
      ).map((negative: NegativeNumber): string => {
        return negative.sentence.text.slice(negative.from, negative.to);
      }),
    ).toEqual(["-۱"]);
  });

  test("a hyphen-minus before a number in a Persian or an Arabic sentence is drawn on its right: the negative control", () => {
    // The values as they were before issue #7102.
    expect(drawnRight("fa", "۸۷٪ باتری · -۶۱ dBm")).toEqual([false]);
    expect(
      drawnRight("fa", "هرچه به ۰ نزدیک‌تر، قوی‌تر، و زیر -۱۰۰ dBm ضعیف است."),
    ).toEqual([false]);
    expect(drawnRight("fa", "ثانیهٔ کبیسه امروز (-۱ ثانیه)")).toEqual([false]);
    // Persian digits after Arabic words misdraw the same way.
    expect(drawnRight("ar", "ودون -۱۰۰ dBm ضعيفة")).toEqual([false]);
    // A minus sign alone does no better: it is a separator too.
    expect(drawnRight("fa", `۸۷٪ باتری · ${MINUS_SIGN}۶۱ dBm`)).toEqual([
      false,
    ]);
  });

  test("Intl's left-to-right mark keeps the minus in front", () => {
    expect(drawnRight("fa", `۸۷٪ باتری · ${LRM}${MINUS_SIGN}۶۱ dBm`)).toEqual([
      true,
    ]);
    expect(
      drawnRight(
        "ar",
        `ودون ${(-100).toLocaleString(getNumberLocale("ar"))} dBm`,
      ),
    ).toEqual([true]);
    /*
     * A hyphen-minus before Latin digits is set apart by the page as code
     * (a flag, CodeReadsAsWritten) and so is drawn as written too: the
     * Arabic help texts never misdrew. They now say the number with the
     * word for minus all the same, as the IoT rows beside them do.
     */
    expect(drawnRight("ar", "ودون -100 dBm ضعيفة")).toEqual([true]);
    // In a line of code, as a log line names a time zone, it is drawn as written.
    expect(
      drawnRight("ar", "[10/Oct/2023:13:55:36 -0700] GET /health"),
    ).toEqual([true]);
  });

  test("the Persian rules catch a Persian number left with a hyphen-minus or a bare minus sign", () => {
    const old: Array<NegativeNumber> = negativeNumbersIn(
      sentenceOf("fa", "۸۷٪ باتری · -۶۱ dBm"),
    );
    const bare: Array<NegativeNumber> = negativeNumbersIn(
      sentenceOf("fa", `۸۷٪ باتری · ${MINUS_SIGN}۶۱ dBm`),
    );

    expect(
      old.map((negative: NegativeNumber): string => {
        return negative.sentence.text[negative.from] || "";
      }),
    ).toEqual([HYPHEN_MINUS]);
    expect(bare[0]?.sentence.text[(bare[0]?.from ?? 0) - 1]).not.toBe(LRM);
  });
});
