/** @timezone America/New_York */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import moment from "moment-timezone";
import React from "react";
import { momentLocalizer } from "react-big-calendar";
import CalendarElement, {
  DefaultCalendarView,
  calendarLocalizer,
} from "../../../../UI/Components/Calendar/Calendar";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";

/*
 * The week view on the two days a year a New York day is not 24 hours long.
 * react-big-calendar draws the time gutter as a 24-hour day and places blocks
 * by wall-clock minute, but its moment localizer sized each day column in
 * real minutes. So on a change day:
 *
 *  - the column had 23 or 25 hour rows beside the gutter's 24, and once the
 *    rows share the grid's height every block in it drifted off the gutter's
 *    hour lines, by up to about 50 minutes;
 *  - on the spring-forward day positions stopped at the column's 23rd hour,
 *    so a hand-off at 11 PM fell off the bottom of the day.
 *
 * Every test renders the real calendar and reads the geometry it wrote. The
 * roster is a daily hand-off at noon and at 11 PM, the same every day, so a
 * change day must look exactly like any other.
 */

const MARCH: number = 2; // Date months are zero-based.
const NOVEMBER: number = 10;

const MINUTES_PER_DAY: number = 24 * 60;
const HOURS_PER_DAY: number = 24;

// Where a wall-clock minute belongs, as a percent of a column the gutter lines up with.
const percentOfDay: (hour: number, minute: number) => number = (
  hour: number,
  minute: number,
): number => {
  return ((hour * 60 + minute) / MINUTES_PER_DAY) * 100;
};

// A New York wall-clock time. None used here falls in a skipped or repeated hour.
const newYork: (
  year: number,
  month: number,
  day: number,
  hour?: number,
) => Date = (year: number, month: number, day: number, hour?: number): Date => {
  return new Date(year, month, day, hour || 0);
};

const shiftTitle: (kind: string, day: Date) => string = (
  kind: string,
  day: Date,
): string => {
  return `${kind} ${moment(day).format("MMM D")}`;
};

/*
 * A "Day" block from noon to 11 PM and a "Night" block from 11 PM to noon the
 * next day, for every day of the week and the day before it (whose night
 * shift fills the first morning).
 */
const buildRoster: (weekStart: Date) => Array<CalendarEvent> = (
  weekStart: Date,
): Array<CalendarEvent> => {
  const events: Array<CalendarEvent> = [];

  for (let offset: number = -1; offset < 7; offset++) {
    const year: number = weekStart.getFullYear();
    const month: number = weekStart.getMonth();
    const day: number = weekStart.getDate() + offset;
    const date: Date = newYork(year, month, day);

    events.push({
      id: events.length + 1,
      title: shiftTitle("Day", date),
      start: newYork(year, month, day, 12),
      end: newYork(year, month, day, 23),
    });

    events.push({
      id: events.length + 1,
      title: shiftTitle("Night", date),
      start: newYork(year, month, day, 23),
      end: newYork(year, month, day + 1, 12),
    });
  }

  return events;
};

const renderWeekOf: (weekStart: Date) => RenderResult = (
  weekStart: Date,
): RenderResult => {
  return render(
    <CalendarElement
      defaultCalendarView={DefaultCalendarView.Week}
      defaultDate={weekStart}
      events={buildRoster(weekStart)}
      onRangeChange={(): void => {
        // The tests never navigate.
      }}
    />,
  );
};

const getDayColumns: (container: HTMLElement) => Array<HTMLElement> = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".rbc-time-content .rbc-day-slot"),
  );
};

// Found through its header ("08 Sun"), not assumed from the locale's first weekday.
const getDayColumn: (container: HTMLElement, date: Date) => HTMLElement = (
  container: HTMLElement,
  date: Date,
): HTMLElement => {
  const headers: Array<HTMLElement> = Array.from(
    container.querySelectorAll<HTMLElement>(
      ".rbc-time-header-cell .rbc-header",
    ),
  );
  const columns: Array<HTMLElement> = getDayColumns(container);

  expect(headers).toHaveLength(7);
  expect(columns).toHaveLength(7);

  const label: string = moment(date).format("DD ddd");
  const index: number = headers.findIndex((header: HTMLElement): boolean => {
    return header.textContent === label;
  });

  if (index === -1) {
    throw new Error(`No day column headed "${label}"`);
  }

  return columns[index]!;
};

const getBlocks: (scope: Element) => Array<HTMLElement> = (
  scope: Element,
): Array<HTMLElement> => {
  return Array.from(scope.querySelectorAll<HTMLElement>(".rbc-event"));
};

const titleOf: (block: Element) => string = (block: Element): string => {
  return block.querySelector(".rbc-event-content")?.textContent || "";
};

const getBlock: (scope: Element, title: string) => HTMLElement = (
  scope: Element,
  title: string,
): HTMLElement => {
  const block: HTMLElement | undefined = getBlocks(scope).find(
    (candidate: HTMLElement): boolean => {
      return titleOf(candidate) === title;
    },
  );

  if (!block) {
    throw new Error(`No block titled "${title}"`);
  }

  return block;
};

// react-big-calendar writes top as "<number>%".
const topOf: (element: HTMLElement) => number = (
  element: HTMLElement,
): number => {
  expect(element.style.top).toMatch(/%$/);
  return parseFloat(element.style.top);
};

const hourRowCount: (column: Element) => number = (column: Element): number => {
  return Array.from(column.children).filter((child: Element): boolean => {
    return child.classList.contains("rbc-timeslot-group");
  }).length;
};

interface DstCase {
  name: string;
  // The Sunday the clocks change, which is also the first day of its week.
  changeDay: Date;
  monday: Date;
  realHours: number;
}

const DST_CASES: Array<DstCase> = [
  {
    name: "spring forward, Sunday 8 March 2026",
    changeDay: newYork(2026, MARCH, 8),
    monday: newYork(2026, MARCH, 9),
    realHours: 23,
  },
  {
    name: "fall back, Sunday 1 November 2026",
    changeDay: newYork(2026, NOVEMBER, 1),
    monday: newYork(2026, NOVEMBER, 2),
    realHours: 25,
  },
];

// A clock outside both weeks, for the tests that do not look at the current-time line.
const A_DAY_IN_NEITHER_WEEK: Date = newYork(2026, MARCH, 20, 10);

// How long a day really is in this process, to prove the timezone pragma took effect.
const realHoursOf: (day: Date) => number = (day: Date): number => {
  return moment(day).add(1, "day").diff(moment(day), "hours");
};

/*
 * rbc's DayColumn arms a 60s timer for the current-time line in the column
 * holding "now", so the clock is fake and every render is torn down.
 */
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("Calendar week view across a daylight-saving change (New York)", () => {
  test.each(DST_CASES)(
    "$name: every day column has the gutter's 24 hour rows",
    ({ changeDay, realHours }: DstCase) => {
      expect(realHoursOf(changeDay)).toBe(realHours);

      jest.setSystemTime(A_DAY_IN_NEITHER_WEEK);

      const { container } = renderWeekOf(changeDay);

      const gutter: HTMLElement | null = container.querySelector<HTMLElement>(
        ".rbc-time-content .rbc-time-gutter",
      );

      expect(gutter).not.toBeNull();
      expect(hourRowCount(gutter!)).toBe(HOURS_PER_DAY);

      const columns: Array<HTMLElement> = getDayColumns(container);

      expect(columns).toHaveLength(7);

      for (const column of columns) {
        expect(hourRowCount(column)).toBe(HOURS_PER_DAY);
      }

      // The change day's column among them, which used to get 23 or 25.
      expect(hourRowCount(getDayColumn(container, changeDay))).toBe(
        HOURS_PER_DAY,
      );
    },
  );

  test.each(DST_CASES)(
    "$name: the noon hand-off is halfway down the column, as on Monday",
    ({ changeDay, monday }: DstCase) => {
      // 10 AM on the change day, after the clocks have changed.
      jest.setSystemTime(
        newYork(
          changeDay.getFullYear(),
          changeDay.getMonth(),
          changeDay.getDate(),
          10,
        ),
      );

      const { container } = renderWeekOf(changeDay);

      const sunday: HTMLElement = getDayColumn(container, changeDay);
      const mondayColumn: HTMLElement = getDayColumn(container, monday);

      /*
       * Exactly 50%, the gutter's noon line. The column used to be 23 or 25
       * hours long, which put noon at about 52% or 48%.
       */
      expect(getBlock(sunday, shiftTitle("Day", changeDay)).style.top).toBe(
        "50%",
      );
      expect(getBlock(mondayColumn, shiftTitle("Day", monday)).style.top).toBe(
        "50%",
      );

      // The current-time line on the change day lines up with the gutter too.
      const indicator: HTMLElement | null = sunday.querySelector<HTMLElement>(
        ".rbc-current-time-indicator",
      );

      expect(indicator).not.toBeNull();
      expect(topOf(indicator!)).toBeCloseTo(percentOfDay(10, 0), 6);
    },
  );

  test.each(DST_CASES)(
    "$name: the 11 PM hand-off is drawn in the change day's last hour",
    ({ changeDay }: DstCase) => {
      jest.setSystemTime(A_DAY_IN_NEITHER_WEEK);

      const { container } = renderWeekOf(changeDay);

      const sunday: HTMLElement = getDayColumn(container, changeDay);
      const saturday: Date = newYork(
        changeDay.getFullYear(),
        changeDay.getMonth(),
        changeDay.getDate() - 1,
      );

      // Saturday night's morning, Sunday's day shift, and Sunday night's start.
      expect(getBlocks(sunday).map(titleOf)).toEqual([
        shiftTitle("Night", saturday),
        shiftTitle("Day", changeDay),
        shiftTitle("Night", changeDay),
      ]);

      /*
       * At 23/24 of the column, the gutter's 11 PM line. On the spring-forward
       * day it used to be pinned to the bottom of a 23-hour column.
       */
      const night: HTMLElement = getBlock(
        sunday,
        shiftTitle("Night", changeDay),
      );

      expect(topOf(night)).toBeCloseTo(percentOfDay(23, 0), 4);

      for (const block of getBlocks(sunday)) {
        expect(topOf(block)).toBeLessThanOrEqual(100);
      }
    },
  );
});

describe("calendarLocalizer.getTotalMin", () => {
  /*
   * How long react-big-calendar makes a day column, from the column's first
   * to its last minute. It must be the gutter's 24-hour day on every date.
   */
  const DAY_CASES: Array<{ name: string; day: Date; realHours: number }> = [
    ...DST_CASES.map((dstCase: DstCase) => {
      return {
        name: dstCase.name,
        day: dstCase.changeDay,
        realHours: dstCase.realHours,
      };
    }),
    {
      name: "an ordinary day, Monday 9 March 2026",
      day: newYork(2026, MARCH, 9),
      realHours: 24,
    },
  ];

  test.each(DAY_CASES)(
    "$name: a whole day is 1439 wall-clock minutes",
    ({ day, realHours }: { day: Date; realHours: number }) => {
      const start: Date = moment(day).startOf("day").toDate();
      const end: Date = moment(day).endOf("day").toDate();

      expect(realHoursOf(day)).toBe(realHours);

      // react-big-calendar's moment localizer counts real minutes: 1379 or 1499 on a change day.
      expect(momentLocalizer(moment).getTotalMin(start, end)).toBe(
        realHours * 60 - 1,
      );

      expect(calendarLocalizer.getTotalMin(start, end)).toBe(
        MINUTES_PER_DAY - 1,
      );
    },
  );
});
