/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import fs from "fs";
import path from "path";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import CalendarElement, {
  CalendarDayName,
  DefaultCalendarView,
  getNarrowDayNameFormats,
  hasShortWeekdayNames,
  LONG_DAY_NAMES_CLASS_NAME,
  NarrowDayNameFormats,
} from "../../../../UI/Components/Calendar/Calendar";
import {
  getSoftEventStyle,
  SOFT_EVENT_DARK_SHADOW_PROPERTY,
  SoftEventStyle,
} from "../../../../UI/Components/Calendar/CalendarEventTone";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";

/*
 * A CALENDAR ON A PAGE READ RIGHT TO LEFT.
 *
 * - A day's name above its column. Persian has no short names for the days
 *   of the week: Intl's short names are its full ones ("چهارشنبه"), and a
 *   narrow month cut them to "چها…". Each name above a column now carries
 *   its one-letter name too ("چ"), which a column too narrow for the full
 *   one shows instead (Calendar.css, a container query). Every other
 *   language names its days as it did.
 * - The current-time line's dot, the lines between the days and a block's
 *   stripe sit on the start side - the right one on a Persian page: the dot
 *   sat at the far end of today's column, the lines one day off, and a
 *   block's stripe on its trailing edge.
 *
 * jsdom applies no styles: the markup and the stylesheet's rules are read
 * here; Chromium's half is the ReadingDirection browser suite ("a calendar
 * read right to left").
 */

const LANGUAGES: Array<string> = [
  "en",
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

// A run of white space: the stylesheet is read with each run as one space.
const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;

// A declaration of a physical side: "left: 0;", "border-left: none;".
const PHYSICAL_SIDE_DECLARATION_REGEX: RegExp =
  /(?<![\w-])(?:left|right|padding-left|padding-right|border-left|border-right|margin-left|margin-right):[^;]*;/g;

const CALENDAR_CSS_PATH: string = path.resolve(
  __dirname,
  "../../../../UI/Components/Calendar/Calendar.css",
);

// Calendar.css, as one line: Prettier breaks a long selector where it likes.
const CALENDAR_CSS: string = fs
  .readFileSync(CALENDAR_CSS_PATH, "utf8")
  .replace(WHITESPACE_RUN_REGEX, " ");

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "de", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { [language]: { translation: {} } },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function october(day: number, hour: number): Date {
  return new Date(Date.UTC(2026, 9, day, hour, 0, 0));
}

const EVENTS: Array<CalendarEvent> = [
  {
    id: 1,
    title: "Scheduled maintenance",
    start: october(27, 9),
    end: october(27, 13),
    color: "#d97706",
    appearance: "soft",
  },
];

function draw(language: string, view: DefaultCalendarView): HTMLElement {
  return render(
    <I18nextProvider i18n={instances[language]!}>
      <CalendarElement
        events={EVENTS}
        defaultDate={october(26, 15)}
        getNow={() => {
          return october(26, 15);
        }}
        defaultCalendarView={view}
        views={[view]}
        onRangeChange={() => {}}
      />
    </I18nextProvider>,
  ).container;
}

function headersOf(container: HTMLElement): Array<HTMLElement> {
  return Array.from(container.querySelectorAll<HTMLElement>(".rbc-header"));
}

describe("hasShortWeekdayNames", () => {
  test("Persian alone writes its days' short names as their full ones", () => {
    for (const language of LANGUAGES) {
      expect({ language, hasShort: hasShortWeekdayNames(language) }).toEqual({
        language,
        hasShort: language !== "fa",
      });
    }
  });

  test("a regional tag reads as its language, and an unknown one as English", () => {
    expect(hasShortWeekdayNames("fa-IR")).toBe(false);
    expect(hasShortWeekdayNames("en-GB")).toBe(true);
    expect(hasShortWeekdayNames(undefined)).toBe(true);
    expect(hasShortWeekdayNames("xx-notalanguage")).toBe(true);
  });
});

describe("getNarrowDayNameFormats", () => {
  test("Persian's one-letter names, Sunday to Saturday", () => {
    const narrow: NarrowDayNameFormats = getNarrowDayNameFormats("fa");

    expect(
      [25, 26, 27, 28, 29, 30, 31].map((day: number): string => {
        return narrow.weekday(october(day, 12));
      }),
    ).toEqual(["ی", "د", "س", "چ", "پ", "ج", "ش"]);
  });

  test("a week's column with its day of the month, in the language's digits", () => {
    expect(getNarrowDayNameFormats("fa").weekdayAndDay(october(26, 12))).toBe(
      "د ۲۶",
    );
  });
});

describe("CalendarDayName", () => {
  test("carries the full name and the one-letter one, and is read out whole", () => {
    const { container } = render(
      <CalendarDayName label="چهارشنبه" narrowLabel="چ" />,
    );

    const name: HTMLElement = container.querySelector(
      ".oneuptime-calendar-day-name",
    )!;

    expect(name).toHaveAttribute("role", "columnheader");
    expect(
      name.querySelector(".oneuptime-calendar-day-name__full"),
    ).toHaveTextContent("چهارشنبه");
    expect(
      name.querySelector(".oneuptime-calendar-day-name__full"),
    ).toHaveAttribute("aria-hidden", "true");
    expect(
      name.querySelector(".oneuptime-calendar-day-name__narrow"),
    ).toHaveTextContent("چ");
    expect(
      name.querySelector(".oneuptime-calendar-day-name__narrow"),
    ).toHaveAttribute("aria-hidden", "true");
    // A screen reader reads the full name, whichever one is drawn.
    expect(name.querySelector(".sr-only")).toHaveTextContent("چهارشنبه");
  });
});

describe("a Persian calendar's day names", () => {
  test("a month's columns each carry the full name and the one-letter one", () => {
    const container: HTMLElement = draw("fa", DefaultCalendarView.Month);
    const headers: Array<HTMLElement> = headersOf(container);

    expect(headers).toHaveLength(7);
    expect(
      headers.map((header: HTMLElement): string => {
        return (
          header.querySelector(".oneuptime-calendar-day-name__narrow")
            ?.textContent || ""
        );
      }),
    ).toEqual(["ی", "د", "س", "چ", "پ", "ج", "ش"]);
    expect(
      headers[3]!.querySelector(".oneuptime-calendar-day-name__full"),
    ).toHaveTextContent("چهارشنبه");
    // The columns measure themselves only on a calendar that needs it.
    expect(container.querySelector(".oneuptime-calendar")).toHaveClass(
      LONG_DAY_NAMES_CLASS_NAME,
    );
  });

  test("a week's columns carry the day of the month in both", () => {
    const container: HTMLElement = draw("fa", DefaultCalendarView.Week);
    const monday: HTMLElement = headersOf(container).find(
      (header: HTMLElement): boolean => {
        return Boolean(header.textContent?.includes("۲۶"));
      },
    )!;

    expect(
      monday.querySelector(".oneuptime-calendar-day-name__narrow"),
    ).toHaveTextContent("د ۲۶");
    expect(
      monday.querySelector(".oneuptime-calendar-day-name__full"),
    ).toHaveTextContent("دوشنبه ۲۶");
  });

  test.each(["en", "de"])(
    "%s: the names are the ones the calendar always drew, nothing added",
    (language: string) => {
      const container: HTMLElement = draw(language, DefaultCalendarView.Month);

      expect(container.querySelector(".oneuptime-calendar-day-name")).toBe(
        null,
      );
      expect(container.querySelector(".oneuptime-calendar")).not.toHaveClass(
        LONG_DAY_NAMES_CLASS_NAME,
      );
      expect(headersOf(container)[0]).toHaveTextContent(
        language === "en" ? "Sun" : "So",
      );
    },
  );
});

describe("a block's stripe on its leading edge", () => {
  test("left to right, the stripe is on the left, as it always was", () => {
    const style: SoftEventStyle = getSoftEventStyle("#d97706");

    expect(style.boxShadow.startsWith("inset 3px 0 0 ")).toBe(true);
    expect(getSoftEventStyle("#d97706", "ltr")).toEqual(style);
  });

  test("right to left, the stripe is on the right, in both themes", () => {
    const style: SoftEventStyle = getSoftEventStyle("#d97706", "rtl");

    expect(style.boxShadow.startsWith("inset -3px 0 0 ")).toBe(true);
    expect(
      String(style[SOFT_EVENT_DARK_SHADOW_PROPERTY]).startsWith(
        "inset -3px 0 0 ",
      ),
    ).toBe(true);
    // Only the stripe's side is turned: its colour, the ring and the wash stay.
    expect(style.boxShadow.replace("inset -3px", "inset 3px")).toBe(
      getSoftEventStyle("#d97706").boxShadow,
    );
    expect(style.backgroundColor).toBe(
      getSoftEventStyle("#d97706").backgroundColor,
    );
  });

  test("a Persian calendar's soft block draws its stripe on the right", () => {
    const container: HTMLElement = draw("fa", DefaultCalendarView.Week);
    const block: HTMLElement = container.querySelector<HTMLElement>(
      ".rbc-event.oneuptime-calendar-event--soft",
    )!;

    expect(block.style.boxShadow.startsWith("inset -3px 0 0 ")).toBe(true);
  });

  test("an English calendar's soft block keeps its stripe on the left", () => {
    const container: HTMLElement = draw("en", DefaultCalendarView.Week);
    const block: HTMLElement = container.querySelector<HTMLElement>(
      ".rbc-event.oneuptime-calendar-event--soft",
    )!;

    expect(block.style.boxShadow.startsWith("inset 3px 0 0 ")).toBe(true);
  });
});

describe("Calendar.css: the start side, whichever way the page reads", () => {
  test("the current-time dot sits at the line's start", () => {
    expect(CALENDAR_CSS).toContain(
      '.oneuptime-calendar .rbc-current-time-indicator::before { content: ""; position: absolute; top: 50%; inset-inline-start: -0.3125rem;',
    );
  });

  test.each([
    ".oneuptime-calendar .rbc-header + .rbc-header, .oneuptime-calendar .rbc-time-header-content .rbc-header + .rbc-header {",
    ".oneuptime-calendar .rbc-time-header-content {",
    ".oneuptime-calendar .rbc-day-bg + .rbc-day-bg {",
    ".oneuptime-calendar .rbc-time-content > * + * > * {",
  ])(
    "the line between two days is drawn on the day's start side: %s",
    (selector: string) => {
      const start: number = CALENDAR_CSS.indexOf(selector);

      expect(start).toBeGreaterThanOrEqual(0);

      const rule: string = CALENDAR_CSS.slice(
        start,
        CALENDAR_CSS.indexOf("}", start),
      );

      // react-big-calendar's own left line is cleared first, then the start side drawn.
      expect(rule).toContain("border-left: none;");
      expect(rule).toContain("border-inline-start: 1px solid");
      expect(rule.indexOf("border-left: none;")).toBeLessThan(
        rule.indexOf("border-inline-start"),
      );
    },
  );

  test("a day's blocks keep their gap at the day's end", () => {
    expect(CALENDAR_CSS).toContain(
      ".oneuptime-calendar .rbc-day-slot .rbc-events-container { margin-right: 0; margin-inline-end: 10px; }",
    );
  });

  test("a block's stripe and its room are on the start side", () => {
    expect(CALENDAR_CSS).toContain("padding-inline-start: calc(0.5rem + 3px);");
    expect(CALENDAR_CSS).toContain("padding-inline-start: 0.75rem;");
    expect(CALENDAR_CSS).toContain("inset-inline-start: 0.4375rem;");
    expect(CALENDAR_CSS).toContain(
      "border-inline-start: 1px dotted currentColor;",
    );
  });

  test("no rule places anything on a physical side, but to clear react-big-calendar's", () => {
    const physical: Array<string> = (
      CALENDAR_CSS.match(PHYSICAL_SIDE_DECLARATION_REGEX) || []
    ).map((declaration: string): string => {
      return declaration.replace(WHITESPACE_RUN_REGEX, " ");
    });

    expect(physical.sort()).toEqual(
      [
        // The day's number and its action, as in every language (renderDayAction).
        "margin-left: auto;",
        // react-big-calendar's own lines and gap, cleared for the start side's.
        "border-left: none;",
        "border-left: none;",
        "border-left: none;",
        "border-left: none;",
        "margin-right: 0;",
        // react-big-calendar's own line on an overflowing header, cleared.
        "border-right: none;",
      ].sort(),
    );
  });

  test("a narrow column shows a day's one-letter name, and only on a calendar that has them", () => {
    expect(CALENDAR_CSS).toContain(
      `.oneuptime-calendar.${LONG_DAY_NAMES_CLASS_NAME} .rbc-header { container-type: inline-size; }`,
    );
    expect(CALENDAR_CSS).toContain(
      ".oneuptime-calendar .oneuptime-calendar-day-name__narrow { display: none; }",
    );
    expect(CALENDAR_CSS).toContain(
      "@container (max-width: 4.25rem) { .oneuptime-calendar .rbc-month-header .oneuptime-calendar-day-name__full { display: none; } .oneuptime-calendar .rbc-month-header .oneuptime-calendar-day-name__narrow { display: inline; } }",
    );
    expect(CALENDAR_CSS).toContain(
      "@container (max-width: 5.25rem) { .oneuptime-calendar .rbc-time-header-content .oneuptime-calendar-day-name__full { display: none; } .oneuptime-calendar .rbc-time-header-content .oneuptime-calendar-day-name__narrow { display: inline; } }",
    );
  });
});
