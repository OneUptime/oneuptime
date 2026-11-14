/** @timezone UTC */
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import i18next from "i18next";
import { formatShiftInstant } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerSummary";
import {
  buildOverrideEventTooltip,
  buildPlainEventTooltip,
  describeOverrideScope,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/OverridePresentation";
import {
  forgetRememberedDateTexts,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import {
  DrawnLine,
  ParagraphDirection,
  drawLine,
} from "../../Helpers/BidiLayout";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { LEFTWARDS_ARROW, RIGHTWARDS_ARROW } from "../../Helpers/PathArrows";

/*
 * AN OVERRIDE'S ARROW POINTS FROM THE FIRST VALUE TO THE SECOND, WHATEVER
 * THE VALUES ARE (#7610).
 *
 * The on-call calendar's hover text says whose shift an override hands to
 * whom, and when: "Override: {{original}} → {{substitute}}", "Override
 * window: {{start}} → {{end}}", a skip's "Away: {{start}} → {{end}}", and
 * an ordinary shift's start and end. The values went into the sentence as
 * they were, and the bidi algorithm drew the arrow with them: between two
 * names in Latin letters, or two dates in English, the arrow was drawn
 * from the left; between two Persian names, from the right. Whether
 * Persian's "→" or Arabic's "←" pointed from the first value to the second
 * turned on who was on call, and a shift's hours were never translated.
 *
 * Each value is now set apart from the sentence (the Translator's
 * setsValuesApart), so the arrow is the sentence's own, and Arabic and
 * Persian both write "←". Each line with an arrow is laid out as a page read
 * from the right draws its hover text (a title attribute's text is drawn in
 * its element's direction), with the test's copy of the bidi algorithm
 * (Helpers/BidiLayout): the first value, then the arrow pointing on, then
 * the second, read from the right - whether the names are in Latin letters
 * or Persian ones, and the dates in English or in Persian digits. A line
 * drawn from the left between two Latin names ("Alice → Bob") is held to
 * that too: a translation can only be right for every name when the arrow
 * is drawn the sentence's way for every name. English, read from the left,
 * is the control.
 */

// A digit Persian writes: U+06F0 to U+06F9.
const PERSIAN_DIGIT: RegExp = new RegExp(
  `[${String.fromCharCode(0x06f0)}-${String.fromCharCode(0x06f9)}]`,
);

const START: Date = new Date("2026-01-01T09:00:00.000Z");
const END: Date = new Date("2026-01-01T17:00:00.000Z");

type Names = "Latin names" | "Persian names";
type Dates = "dates in English" | "dates in Persian digits";

const NAMES: Record<Names, { original: string; substitute: string }> = {
  "Latin names": { original: "Alice Scheduled", substitute: "Bob Covering" },
  "Persian names": { original: "علی رضایی", substitute: "مریم احمدی" },
};

// The language the dates are written in (the Dashboard writes them in the reader's).
const DATE_LANGUAGE: Record<Dates, string> = {
  "dates in English": "en",
  "dates in Persian digits": "fa",
};

const FILLS: Array<[Names, Dates]> = [
  ["Latin names", "dates in English"],
  ["Latin names", "dates in Persian digits"],
  ["Persian names", "dates in English"],
  ["Persian names", "dates in Persian digits"],
];

// A line with an arrow, and the values it leads from and to.
interface ArrowLine {
  line: string;
  first: string;
  second: string;
}

type ArrowLineName =
  | "a cover's names"
  | "a cover's window"
  | "a skip's time away"
  | "a shift's hours";

const ARROWS: string = `${RIGHTWARDS_ARROW}${LEFTWARDS_ARROW}`;

// The one line of a hover text with an arrow and both values on it.
const lineWith: (text: string, first: string, second: string) => ArrowLine = (
  text: string,
  first: string,
  second: string,
): ArrowLine => {
  const lines: Array<string> = text.split("\n").filter((line: string) => {
    return (
      line.includes(first) &&
      line.includes(second) &&
      Array.from(ARROWS).some((arrow: string): boolean => {
        return line.includes(arrow);
      })
    );
  });

  expect(lines).toHaveLength(1);

  return { line: lines[0] as string, first, second };
};

// Each hover text's line with an arrow, filled with these names and dates.
const arrowLinesOf: (
  names: Names,
  dates: Dates,
) => Record<ArrowLineName, ArrowLine> = (
  names: Names,
  dates: Dates,
): Record<ArrowLineName, ArrowLine> => {
  setDateDisplayLanguage(DATE_LANGUAGE[dates]);

  const { original, substitute } = NAMES[names];
  const start: string = formatShiftInstant(START, "UTC");
  const end: string = formatShiftInstant(END, "UTC");
  const override: {
    substituteName: string;
    originalName: string;
    overrideStartsAt: Date;
    overrideEndsAt: Date;
    scope: ReturnType<typeof describeOverrideScope>;
    timezone: string;
  } = {
    substituteName: substitute,
    originalName: original,
    overrideStartsAt: START,
    overrideEndsAt: END,
    scope: describeOverrideScope({ onCallDutyPolicyId: null }),
    timezone: "UTC",
  };
  const cover: string = buildOverrideEventTooltip(override);
  const skip: string = buildOverrideEventTooltip({ ...override, isSkip: true });
  const shift: string = buildPlainEventTooltip({
    userLabel: original,
    start: START,
    end: END,
    timezone: "UTC",
  });

  return {
    "a cover's names": lineWith(cover, original, substitute),
    "a cover's window": lineWith(cover, start, end),
    "a skip's time away": lineWith(skip, start, end),
    "a shift's hours": lineWith(shift, start, end),
  };
};

/*
 * The line's two values and the arrow between them as they are drawn, from
 * left to right: "second ← first" is the first value on the right, then an
 * arrow pointing left, then the second value - read from the right, the
 * arrow leads from the first to the second.
 */
const drawnOrder: (item: ArrowLine, direction: ParagraphDirection) => string = (
  item: ArrowLine,
  direction: ParagraphDirection,
): string => {
  const firstAt: number = item.line.indexOf(item.first);
  const secondAt: number = item.line.indexOf(
    item.second,
    firstAt + item.first.length,
  );

  if (firstAt < 0 || secondAt < 0) {
    return `the values are not in order in "${item.line}"`;
  }

  const between: Array<number> = [];

  for (
    let index: number = firstAt + item.first.length;
    index < secondAt;
    index++
  ) {
    if (ARROWS.includes(item.line.charAt(index))) {
      between.push(index);
    }
  }

  if (between.length !== 1) {
    return `${between.length} arrows between the values in "${item.line}"`;
  }

  const arrowAt: number = between[0] as number;
  const drawn: DrawnLine = drawLine(item.line, direction);

  const piece: (
    name: string,
    from: number,
    length: number,
  ) => { name: string; left: number; right: number } = (
    name: string,
    from: number,
    length: number,
  ): { name: string; left: number; right: number } => {
    const places: Array<number> = drawn.drawnAt.slice(from, from + length);

    return {
      name,
      left: Math.min(...places),
      right: Math.max(...places),
    };
  };

  const pieces: Array<{ name: string; left: number; right: number }> = [
    piece("first", firstAt, item.first.length),
    piece(item.line.charAt(arrowAt), arrowAt, 1),
    piece("second", secondAt, item.second.length),
  ].sort(
    (
      a: { name: string; left: number; right: number },
      b: { name: string; left: number; right: number },
    ): number => {
      return a.left - b.left;
    },
  );

  // Each piece drawn whole, beside the next.
  for (let at: number = 1; at < pieces.length; at++) {
    if ((pieces[at]?.left as number) <= (pieces[at - 1]?.right as number)) {
      return `the values and the arrow are drawn into each other in "${item.line}"`;
    }
  }

  return pieces
    .map((drawnPiece: { name: string; left: number; right: number }) => {
      return drawnPiece.name;
    })
    .join(" ");
};

const drawnLinesOf: (
  names: Names,
  dates: Dates,
  direction: ParagraphDirection,
) => Record<ArrowLineName, string> = (
  names: Names,
  dates: Dates,
  direction: ParagraphDirection,
): Record<ArrowLineName, string> => {
  const lines: Record<ArrowLineName, ArrowLine> = arrowLinesOf(names, dates);

  return {
    "a cover's names": drawnOrder(lines["a cover's names"], direction),
    "a cover's window": drawnOrder(lines["a cover's window"], direction),
    "a skip's time away": drawnOrder(lines["a skip's time away"], direction),
    "a shift's hours": drawnOrder(lines["a shift's hours"], direction),
  };
};

const everyLine: (order: string) => Record<ArrowLineName, string> = (
  order: string,
): Record<ArrowLineName, string> => {
  return {
    "a cover's names": order,
    "a cover's window": order,
    "a skip's time away": order,
    "a shift's hours": order,
  };
};

beforeAll(async () => {
  await i18next.init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      ar: { translation: readDashboardLocale("ar") },
      fa: { translation: readDashboardLocale("fa") },
    },
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  setDateDisplayLanguage(null);
  forgetRememberedDateTexts();
  await i18next.changeLanguage("en");
});

describe("an override's hover text in a language read from the right", () => {
  test("the clock is UTC's, as the docblock asks", () => {
    expect(new Date(0).getTimezoneOffset()).toBe(0);
  });

  test("the dates are filled as each fill says: in English, and in Persian digits", () => {
    setDateDisplayLanguage(DATE_LANGUAGE["dates in English"]);
    expect(formatShiftInstant(START, "UTC")).toMatch(/^[\x20-\x7e]+$/);
    setDateDisplayLanguage(DATE_LANGUAGE["dates in Persian digits"]);
    expect(formatShiftInstant(START, "UTC")).toMatch(PERSIAN_DIGIT);
  });

  describe.each(["ar", "fa"])("%s", (language: string) => {
    test.each(FILLS)(
      "with %s and %s: the first value, the arrow pointing on, then the second",
      async (names: Names, dates: Dates) => {
        await i18next.changeLanguage(language);

        expect(drawnLinesOf(names, dates, "rtl")).toEqual(
          everyLine(`second ${LEFTWARDS_ARROW} first`),
        );
      },
    );
  });
});

describe("the control: the same hover text in English, read from the left", () => {
  /*
   * An English sentence writes a date in English, whatever language the
   * date came in (DateLanguage's getEnglishOf): its fills are the names'.
   */
  test.each(
    FILLS.filter(([, dates]: [Names, Dates]): boolean => {
      return dates === "dates in English";
    }),
  )(
    "with %s and %s: the first value, the arrow pointing on, then the second",
    async (names: Names, dates: Dates) => {
      await i18next.changeLanguage("en");

      expect(drawnLinesOf(names, dates, "ltr")).toEqual(
        everyLine(`first ${RIGHTWARDS_ARROW} second`),
      );
    },
  );
});
