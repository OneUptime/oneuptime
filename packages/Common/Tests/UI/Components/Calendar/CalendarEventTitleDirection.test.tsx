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
  DefaultCalendarView,
  EVENT_TITLE_DIRECTION_CLASS_NAMES,
  getEventTitleClassName,
} from "../../../../UI/Components/Calendar/Calendar";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";

/*
 * A CALENDAR BLOCK'S TITLE READS THE WAY IT IS WRITTEN.
 *
 * A month's day is narrow, and a block's title is cut short to it. On a
 * Persian page an English title - a maintenance event, a person on call -
 * was cut at its start ("...rade" for "Database upgrade"): the block's words
 * read right to left, as the page's do, and a line ends at the left. A block
 * whose title reads the other way from the page now carries a class
 * (getEventTitleClassName) that turns its words that way (Calendar.css), so
 * the title loses its end. And every block's words start where the page's
 * lines do: react-big-calendar's own text-align: left put a Persian title at
 * the left of its block.
 *
 * jsdom applies no styles: the classes are read here, and the rules from
 * Calendar.css; Chromium's half is the ReadingDirection browser suite ("a
 * narrow month's events").
 */

const ENGLISH_TITLE: string = "Database upgrade";
const PERSIAN_TITLE: string = "به‌روزرسانی سرور پایگاه داده";

// A run of white space: the stylesheet is read with each run as one space.
const WHITESPACE_RUN_REGEX: RegExp = /\s+/g;

// Calendar.css, as one line: Prettier breaks a long selector where it likes.
const CALENDAR_CSS: string = fs
  .readFileSync(
    path.resolve(__dirname, "../../../../UI/Components/Calendar/Calendar.css"),
    "utf8",
  )
  .replace(WHITESPACE_RUN_REGEX, " ");

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, fa: { translation: {} } },
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
    title: ENGLISH_TITLE,
    start: october(14, 9),
    end: october(14, 11),
  },
  {
    id: 2,
    title: PERSIAN_TITLE,
    start: october(15, 9),
    end: october(15, 11),
  },
];

function drawMonth(
  language: string,
  backgroundEvents?: Array<CalendarEvent>,
): HTMLElement {
  return render(
    <I18nextProvider i18n={instances[language]!}>
      <CalendarElement
        events={EVENTS}
        backgroundEvents={backgroundEvents}
        defaultDate={october(20, 12)}
        defaultCalendarView={DefaultCalendarView.Month}
        views={[DefaultCalendarView.Month]}
        onRangeChange={() => {}}
      />
    </I18nextProvider>,
  ).container;
}

function blockOf(container: HTMLElement, title: string): HTMLElement {
  const found: HTMLElement | undefined = Array.from(
    container.querySelectorAll<HTMLElement>(".rbc-event"),
  ).find((element: HTMLElement): boolean => {
    return Boolean(element.textContent?.includes(title));
  });

  expect({ title, found: Boolean(found) }).toEqual({ title, found: true });

  return found!;
}

describe("getEventTitleClassName", () => {
  test("names the way a title reads only where that is not the page's", () => {
    expect(getEventTitleClassName(ENGLISH_TITLE, "fa")).toBe(
      EVENT_TITLE_DIRECTION_CLASS_NAMES.ltr,
    );
    expect(getEventTitleClassName(PERSIAN_TITLE, "en")).toBe(
      EVENT_TITLE_DIRECTION_CLASS_NAMES.rtl,
    );
    expect(getEventTitleClassName(PERSIAN_TITLE, "fa")).toBeUndefined();
    expect(getEventTitleClassName(ENGLISH_TITLE, "en")).toBeUndefined();
    expect(getEventTitleClassName(ENGLISH_TITLE, "de")).toBeUndefined();
  });

  test("a title with no letters reads as the page does", () => {
    expect(getEventTitleClassName("2026-10-14 09:00", "fa")).toBeUndefined();
    expect(getEventTitleClassName("", "fa")).toBeUndefined();
    expect(getEventTitleClassName(undefined, "fa")).toBeUndefined();
  });
});

describe("a month's blocks", () => {
  test("on a Persian page an English title's block reads left to right, a Persian one's as the page does", () => {
    const container: HTMLElement = drawMonth("fa");

    expect(blockOf(container, ENGLISH_TITLE)).toHaveClass(
      EVENT_TITLE_DIRECTION_CLASS_NAMES.ltr,
    );

    const persian: HTMLElement = blockOf(container, PERSIAN_TITLE);

    expect(persian).not.toHaveClass(EVENT_TITLE_DIRECTION_CLASS_NAMES.ltr);
    expect(persian).not.toHaveClass(EVENT_TITLE_DIRECTION_CLASS_NAMES.rtl);
  });

  test("on an English page an English title's block is drawn as before; a Persian one's reads right to left", () => {
    const container: HTMLElement = drawMonth("en");
    const english: HTMLElement = blockOf(container, ENGLISH_TITLE);

    expect(english).not.toHaveClass(EVENT_TITLE_DIRECTION_CLASS_NAMES.ltr);
    expect(english).not.toHaveClass(EVENT_TITLE_DIRECTION_CLASS_NAMES.rtl);
    expect(blockOf(container, PERSIAN_TITLE)).toHaveClass(
      EVENT_TITLE_DIRECTION_CLASS_NAMES.rtl,
    );
  });
});

describe("Calendar.css", () => {
  test("turns a block's words the way its title reads, lined up as the page's", () => {
    for (const direction of ["ltr", "rtl"] as const) {
      const className: string = EVENT_TITLE_DIRECTION_CLASS_NAMES[direction];
      const rule: string =
        CALENDAR_CSS.split(
          `.oneuptime-calendar .rbc-event.${className} .rbc-event-content`,
        )[1]?.split("}")[0] || "";

      expect({ direction, rule }).toEqual({
        direction,
        rule: expect.stringContaining(`direction: ${direction};`),
      });
      expect(rule).toContain("text-align: end;");
      // The day's "+N more" list draws the same blocks.
      expect(CALENDAR_CSS).toContain(
        `.rbc-overlay .rbc-event.${className} .rbc-event-content`,
      );
    }
  });

  test("starts every block's words where the page's lines do", () => {
    const blockRule: string =
      CALENDAR_CSS.split(
        ".oneuptime-calendar .rbc-event, .oneuptime-calendar .rbc-day-slot .rbc-background-event {",
      )[1]?.split("}")[0] || "";
    const overlayRule: string =
      CALENDAR_CSS.split(".rbc-overlay .rbc-event {")[1]?.split("}")[0] || "";

    expect(blockRule).toContain("text-align: start;");
    expect(overlayRule).toContain("text-align: start;");
  });
});
