import { describe, expect, test } from "@jest/globals";
import {
  formatMilliseconds,
  MILLISECONDS_TEMPLATE,
  roundMilliseconds,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Milliseconds";
import { createTranslator, Translator } from "../../../Types/Translator";
import { drawLine, getDrawnText } from "../../Helpers/BidiLayout";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A DURATION IN MILLISECONDS, AS EVERY MONITOR SUMMARY DRAWS IT (#7224).
 *
 * The summaries wrote `responseTimeInMs + " ms"`: on an Arabic or Persian
 * page the browser laid that English out from the right, "ms 411", and a
 * Persian card wrote 411 in Latin digits beside its Persian date. The
 * Dashboard's formatMilliseconds draws the "{{value}} ms" key, worded by
 * every language with its own unit and order, with the figure written the
 * reader's way (translator.formatNumber).
 */

const ZWNJ: string = "\u{200C}";
const PERSIAN_MILLISECONDS: string = `میلی${ZWNJ}ثانیه`;
const ARABIC_MILLISECONDS: string = "ملي ث";

const LATIN_DIGIT: RegExp = /[0-9]/;
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;

const english: Translator = dashboardTranslator("en");
const persian: Translator = dashboardTranslator("fa");
const arabic: Translator = dashboardTranslator("ar");
const german: Translator = dashboardTranslator("de");

// How a page read from the right draws `text`, from left to right.
const drawnFromTheRight: (text: string) => string = (text: string): string => {
  return getDrawnText(drawLine(text, "rtl"));
};

describe("in English, as the summaries always read", () => {
  test("a whole number: '411 ms'", () => {
    expect(formatMilliseconds(english, 411)).toBe("411 ms");
    expect(formatMilliseconds(english, 0)).toBe("0 ms");
    expect(formatMilliseconds(english, 999)).toBe("999 ms");
  });

  test("rounded to the decimals asked for, as Math.round rounds", () => {
    expect(
      formatMilliseconds(english, 411.6, { maximumFractionDigits: 0 }),
    ).toBe("412 ms");
    expect(
      formatMilliseconds(english, 31.2749, { maximumFractionDigits: 2 }),
    ).toBe("31.27 ms");
    expect(
      formatMilliseconds(english, 8.125, { maximumFractionDigits: 2 }),
    ).toBe("8.13 ms");
    expect(
      formatMilliseconds(english, 0.0421, { maximumFractionDigits: 3 }),
    ).toBe("0.042 ms");
  });

  test("a thousand or more takes its separator, as the Retry Attempts lines write it", () => {
    expect(formatMilliseconds(english, 1234)).toBe("1,234 ms");
    expect(formatMilliseconds(english, 30000)).toBe("30,000 ms");
  });

  test("left out, the decimals are formatNumber's own (up to three)", () => {
    expect(formatMilliseconds(english, 12.3456)).toBe("12.346 ms");
    expect(formatMilliseconds(english, 12.5)).toBe("12.5 ms");
  });

  test("a reading that is not a number reads as a missing fact", () => {
    expect(formatMilliseconds(english, Number.NaN)).toBe("-");
    expect(formatMilliseconds(english, Number.POSITIVE_INFINITY)).toBe("-");
    expect(formatMilliseconds(english, undefined as unknown as number)).toBe(
      "-",
    );
  });
});

describe("in Persian: Persian digits, and the unit in Persian after the figure", () => {
  test("whole numbers, thousands and decimals", () => {
    expect(formatMilliseconds(persian, 411)).toBe(
      `۴۱۱ ${PERSIAN_MILLISECONDS}`,
    );
    expect(formatMilliseconds(persian, 1234)).toBe(
      `۱٬۲۳۴ ${PERSIAN_MILLISECONDS}`,
    );
    expect(
      formatMilliseconds(persian, 31.2749, { maximumFractionDigits: 2 }),
    ).toBe(`۳۱٫۲۷ ${PERSIAN_MILLISECONDS}`);
  });

  test("no Latin digit or letter is left in it", () => {
    const drawn: string = withoutIsolateMarks(
      formatMilliseconds(persian, 1234.56, { maximumFractionDigits: 2 }),
    );

    expect(drawn).toMatch(PERSIAN_DIGIT);
    expect(drawn).not.toMatch(LATIN_DIGIT);
    expect(drawn).not.toMatch(LATIN_LETTER);
  });

  test("drawn from the right, the figure comes first", () => {
    const drawn: string = drawnFromTheRight(formatMilliseconds(persian, 411));

    // Left to right on the screen: the unit, then the figure at the right.
    expect(drawn.endsWith("۴۱۱")).toBe(true);
  });
});

describe("in Arabic: Latin digits, as Arabic in OneUptime writes them, and an Arabic unit", () => {
  test("whole numbers, thousands and decimals", () => {
    expect(formatMilliseconds(arabic, 411)).toBe(`411 ${ARABIC_MILLISECONDS}`);
    expect(formatMilliseconds(arabic, 1234)).toBe(
      `1,234 ${ARABIC_MILLISECONDS}`,
    );
    expect(formatMilliseconds(arabic, 8.12, { maximumFractionDigits: 2 })).toBe(
      `8.12 ${ARABIC_MILLISECONDS}`,
    );
  });

  test("never 'ms 411': the figure is read first, with no Latin unit beside it", () => {
    const drawn: string = drawnFromTheRight(formatMilliseconds(arabic, 411));

    expect(drawn.endsWith("411")).toBe(true);
    expect(drawn).not.toMatch(LATIN_LETTER);
  });

  test("negative control: the English the summaries wrote is drawn 'ms 411' from the right", () => {
    expect(drawnFromTheRight("411 ms")).toBe("ms 411");
  });
});

describe("in other languages", () => {
  test("German groups thousands with a dot and writes a decimal comma", () => {
    expect(formatMilliseconds(german, 1234)).toBe("1.234 ms");
    expect(
      formatMilliseconds(german, 31.27, { maximumFractionDigits: 2 }),
    ).toBe("31,27 ms");
  });

  test("each language's own unit where it has one", () => {
    expect(formatMilliseconds(dashboardTranslator("ru"), 411)).toBe("411 мс");
    expect(formatMilliseconds(dashboardTranslator("zh-CN"), 411)).toBe(
      "411 毫秒",
    );
  });
});

describe("the key in every Dashboard language", () => {
  test("English holds the key under its own words", () => {
    expect(MILLISECONDS_TEMPLATE).toBe("{{value}} ms");
    expect(readDashboardLocale("en")[MILLISECONDS_TEMPLATE]).toBe(
      MILLISECONDS_TEMPLATE,
    );
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words it, with the figure's placeholder",
    (language: string) => {
      const value: string | undefined =
        readDashboardLocale(language)[MILLISECONDS_TEMPLATE];

      expect(value).toBeDefined();
      expect(placeholdersOf(value!)).toEqual(["{{value}}"]);
      expect({
        language,
        worded: isWordedInDashboardLocale(MILLISECONDS_TEMPLATE, language),
      }).toEqual({ language, worded: true });
    },
  );

  test.each(["ar", "fa"])(
    "%s writes the unit in its own script, so a page read from the right reads the figure first",
    (language: string) => {
      const value: string =
        readDashboardLocale(language)[MILLISECONDS_TEMPLATE] || "";

      expect(value).not.toBe(MILLISECONDS_TEMPLATE);
      expect(value.replace("{{value}}", "")).not.toMatch(LATIN_LETTER);
      expect(value.startsWith("{{value}} ")).toBe(true);
    },
  );

  test("negative control: a Persian file that left the key in English draws 'ms' beside Persian digits", () => {
    const words: Record<string, string> = {
      ...readDashboardLocale("fa"),
      [MILLISECONDS_TEMPLATE]: MILLISECONDS_TEMPLATE,
    };
    const untranslated: Translator = createTranslator(
      (text: string): string | undefined => {
        return words[text];
      },
      "fa",
    );
    const drawn: string = formatMilliseconds(untranslated, 411);

    expect(drawn).toBe("۴۱۱ ms");
    expect(drawn).toMatch(LATIN_LETTER);
    expect(drawnFromTheRight(drawn)).toBe("ms ۴۱۱");
  });
});

describe("rounding (roundMilliseconds)", () => {
  test("left out, the figure is kept as it is", () => {
    expect(roundMilliseconds(12.3456)).toBe(12.3456);
  });

  test("to whole milliseconds, two decimals, or three at most", () => {
    expect(roundMilliseconds(411.5, 0)).toBe(412);
    expect(roundMilliseconds(31.2749, 2)).toBe(31.27);
    expect(roundMilliseconds(0.04219, 3)).toBe(0.042);
    expect(roundMilliseconds(0.04219, 9)).toBe(0.042);
    expect(roundMilliseconds(12.6, -1)).toBe(13);
  });
});
