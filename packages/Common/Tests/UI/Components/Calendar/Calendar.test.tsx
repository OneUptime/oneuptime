/** @timezone Asia/Singapore */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
import fs from "fs";
import moment from "moment-timezone";
import path from "path";
import React from "react";
import { DateLocalizer, DateRange, momentLocalizer } from "react-big-calendar";
import CalendarElement, {
  ComponentProps,
  DefaultCalendarView,
  calendarLocalizer,
  formatEventTimeRangeStart,
} from "../../../../UI/Components/Calendar/Calendar";
import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import { StyleRule, parseTopLevelRules } from "../../Styles/ThemeStylesheet";

/*
 * The on-call schedule preview draws its shifts with this calendar, and the
 * week view is where people read "who is on call, and when does it hand off".
 * Every test here renders the REAL component (react-big-calendar included) and
 * reads what it put in the DOM, because each bug it pins was a gap between the
 * data being right and the grid drawing it wrong:
 *
 *  - a shift ending at midnight was drawn a second time on the next day as a
 *    thin "– 12:00 AM" sliver that squeezed the real midnight shift into half
 *    the column, and the first fix for that made a shift from 11:59 PM to
 *    midnight vanish from both days;
 *  - a 5:02 PM hand-off was drawn with a gap, because override blocks were
 *    taken out of react-big-calendar's absolute positioning;
 *  - a rotation handing off at midnight left the grid entirely and became bars
 *    in the all-day strip;
 *  - uncovered hours were painted as solid blue blocks, like a real shift;
 *  - the red "now" line used the browser clock on a grid shown in another zone
 *    and disappeared into red shifts;
 *  - the day did not fit without scrolling, and the clip that kept it that way
 *    let a focused block scroll its column's blocks off the hour lines.
 *
 * The timezone is pinned to the one the report came from. Singapore has no
 * DST, so every day in these tests is exactly 1440 minutes long.
 */

const SEPTEMBER: number = 8; // Date months are zero-based.

// A local (Asia/Singapore) wall-clock time in September 2026.
const sep: (
  day: number,
  hour: number,
  minute?: number,
  second?: number,
) => Date = (
  day: number,
  hour: number,
  minute?: number,
  second?: number,
): Date => {
  return new Date(2026, SEPTEMBER, day, hour, minute || 0, second || 0);
};

/*
 * September 2026: Sunday 20 to Saturday 26 is the week of 26 Sep, the second
 * date in the report, and Saturday 12 is the first.
 */
const FRIDAY_25: number = 25;
const SATURDAY_26: number = 26;
const SATURDAY_12: number = 12;

const MINUTES_PER_DAY: number = 24 * 60;

// Where react-big-calendar puts a wall-clock minute, as a percent of the column.
const percentOfDay: (hour: number, minute: number) => number = (
  hour: number,
  minute: number,
): number => {
  return ((hour * 60 + minute) / MINUTES_PER_DAY) * 100;
};

const OVERRIDE_CLASS: string = "oneuptime-calendar-event--override";

let nextEventId: number = 1;

const makeEvent: (
  title: string,
  start: Date,
  end: Date,
  extra?: Partial<CalendarEvent>,
) => CalendarEvent = (
  title: string,
  start: Date,
  end: Date,
  extra?: Partial<CalendarEvent>,
): CalendarEvent => {
  return {
    id: nextEventId++,
    title,
    start,
    end,
    ...(extra || {}),
  };
};

const renderWeek: (
  props: Partial<ComponentProps> & { events: Array<CalendarEvent> },
) => RenderResult = (
  props: Partial<ComponentProps> & { events: Array<CalendarEvent> },
): RenderResult => {
  return render(
    <CalendarElement
      defaultCalendarView={DefaultCalendarView.Week}
      defaultDate={sep(SATURDAY_26, 12)}
      onRangeChange={(): void => {
        // The tests never navigate.
      }}
      {...props}
    />,
  );
};

const getWrapper: (container: HTMLElement) => HTMLElement = (
  container: HTMLElement,
): HTMLElement => {
  const wrapper: HTMLElement | null = container.querySelector<HTMLElement>(
    ".oneuptime-calendar",
  );

  if (!wrapper) {
    throw new Error("The calendar wrapper was not rendered");
  }

  return wrapper;
};

const getDayColumns: (container: HTMLElement) => Array<HTMLElement> = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(".rbc-time-content .rbc-day-slot"),
  );
};

const getDayHeaders: (container: HTMLElement) => Array<HTMLElement> = (
  container: HTMLElement,
): Array<HTMLElement> => {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      ".rbc-time-header-cell .rbc-header",
    ),
  );
};

/*
 * Where a date sits in the week, found through its header ("26 Sat") rather
 * than assumed, so the tests do not depend on which weekday the locale starts on.
 */
const getDayIndex: (container: HTMLElement, date: Date) => number = (
  container: HTMLElement,
  date: Date,
): number => {
  const headers: Array<HTMLElement> = getDayHeaders(container);

  expect(headers).toHaveLength(7);
  expect(getDayColumns(container)).toHaveLength(7);

  const label: string = moment(date).format("DD ddd");
  const index: number = headers.findIndex((header: HTMLElement): boolean => {
    return header.textContent === label;
  });

  if (index === -1) {
    throw new Error(`No day column headed "${label}"`);
  }

  return index;
};

const getDayColumn: (container: HTMLElement, date: Date) => HTMLElement = (
  container: HTMLElement,
  date: Date,
): HTMLElement => {
  return getDayColumns(container)[getDayIndex(container, date)]!;
};

const getDayHeader: (container: HTMLElement, date: Date) => HTMLElement = (
  container: HTMLElement,
  date: Date,
): HTMLElement => {
  return getDayHeaders(container)[getDayIndex(container, date)]!;
};

const getBlocks: (scope: Element) => Array<HTMLElement> = (
  scope: Element,
): Array<HTMLElement> => {
  return Array.from(scope.querySelectorAll<HTMLElement>(".rbc-event"));
};

const titleOf: (block: Element) => string = (block: Element): string => {
  return block.querySelector(".rbc-event-content")?.textContent || "";
};

const labelOf: (block: Element) => string = (block: Element): string => {
  return block.querySelector(".rbc-event-label")?.textContent || "";
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

// react-big-calendar writes top/height/left/width as "<number>%".
const percent: (value: string) => number = (value: string): number => {
  expect(value).toMatch(/%$/);
  return parseFloat(value);
};

interface BlockBox {
  top: number;
  height: number;
  left: number;
  width: number;
}

const boxOf: (block: HTMLElement) => BlockBox = (
  block: HTMLElement,
): BlockBox => {
  return {
    top: percent(block.style.top),
    height: percent(block.style.height),
    left: percent(block.style.left),
    width: percent(block.style.width),
  };
};

/*
 * 12 Sep: Alex's shift ends at 5:02 PM and two overrides follow it, back to
 * back. Overrides carry the override class and the overridden person's accent.
 */
const buildSaturday12: () => Array<CalendarEvent> =
  (): Array<CalendarEvent> => {
    return [
      makeEvent("Alex", sep(SATURDAY_12, 0), sep(SATURDAY_12, 17, 2)),
      makeEvent(
        "Blair (covering Alex)",
        sep(SATURDAY_12, 17, 2),
        sep(SATURDAY_12, 21, 26),
        {
          color: "#dc2626",
          accentColor: "#16a34a",
          className: OVERRIDE_CLASS,
        },
      ),
      makeEvent(
        "Casey (covering Alex)",
        sep(SATURDAY_12, 21, 26),
        sep(SATURDAY_12, 23, 30),
        {
          color: "#7c3aed",
          accentColor: "#16a34a",
          className: OVERRIDE_CLASS,
        },
      ),
    ];
  };

/*
 * rbc's DayColumn arms a 60s timer for the "now" line and reads the clock for
 * the highlighted day, so every test runs on a fixed clock: Wednesday 23
 * September 2026, 10:00 in Singapore, inside the week most tests show.
 */
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(sep(23, 10));
});

afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe("Calendar week view: a shift that ends at midnight (26 Sep)", () => {
  /*
   * The report: Friday's last shift runs 7:26 PM to midnight and Saturday's
   * first starts at midnight. react-big-calendar handed the Friday shift to
   * Saturday's column too (its day filter is inclusive), drew it as a 20px
   * "– 12:00 AM" sliver at the top, and put it side by side with the real
   * midnight shift, so the two looked like they overlapped.
   */
  const buildHandOff: (handOff: Date) => Array<CalendarEvent> = (
    handOff: Date,
  ): Array<CalendarEvent> => {
    return [
      makeEvent("Alex", sep(FRIDAY_25, 19, 26), handOff),
      makeEvent("Blair", handOff, sep(SATURDAY_26, 9, 52)),
      makeEvent("Casey", sep(SATURDAY_26, 9, 52), sep(SATURDAY_26, 19, 26)),
    ];
  };

  test("the shift ending at midnight is drawn only on Friday, to the bottom of the column, with its end time", () => {
    const { container } = renderWeek({
      events: buildHandOff(sep(SATURDAY_26, 0)),
    });

    const friday: HTMLElement = getDayColumn(container, sep(FRIDAY_25, 0));
    const fridayBlocks: Array<HTMLElement> = getBlocks(friday);

    expect(fridayBlocks.map(titleOf)).toEqual(["Alex"]);

    const alex: HTMLElement = fridayBlocks[0]!;
    const box: BlockBox = boxOf(alex);

    expect(box.top).toBeCloseTo(percentOfDay(19, 26), 6);
    // The column ends at 23:59, so the block reaches the last minute of the day.
    expect(box.top + box.height).toBeCloseTo(percentOfDay(23, 59), 6);
    expect(box.left).toBe(0);
    expect(box.width).toBe(100);

    // Not "7:26 PM –", which reads as "continues tomorrow".
    expect(labelOf(alex)).toBe("7:26 PM – 12:00 AM");
  });

  test("Saturday shows only its own shifts, the midnight one at full width from the top", () => {
    const { container } = renderWeek({
      events: buildHandOff(sep(SATURDAY_26, 0)),
    });

    const saturday: HTMLElement = getDayColumn(container, sep(SATURDAY_26, 0));

    // No sliver of Friday's shift in Saturday's column.
    expect(getBlocks(saturday).map(titleOf)).toEqual(["Blair", "Casey"]);

    const blair: BlockBox = boxOf(getBlock(saturday, "Blair"));
    const casey: BlockBox = boxOf(getBlock(saturday, "Casey"));

    expect(blair.top).toBe(0);
    expect(blair.left).toBe(0);
    expect(blair.width).toBe(100);
    expect(blair.height).toBeCloseTo(percentOfDay(9, 52), 6);
    expect(labelOf(getBlock(saturday, "Blair"))).toBe("12:00 AM – 9:52 AM");

    // The 9:52 AM hand-off is back to back too.
    expect(casey.top).toBeCloseTo(blair.top + blair.height, 6);
    expect(casey.width).toBe(100);
  });

  test("no block anywhere in the week carries a bare '– 12:00 AM' label", () => {
    const { container } = renderWeek({
      events: buildHandOff(sep(SATURDAY_26, 0)),
    });

    const labels: Array<string> = getBlocks(container).map(labelOf);

    expect(labels.length).toBeGreaterThan(0);

    // A label that starts with the dash is a block that only ends in its column.
    for (const label of labels) {
      expect(label.trim().startsWith("–")).toBe(false);
    }
  });

  test("a hand-off a few seconds after midnight is still treated as one at midnight", () => {
    /*
     * The grid works in whole minutes. A rotation computed to the second can
     * hand off at 00:00:30, which must not bring the Saturday sliver back.
     */
    const { container } = renderWeek({
      events: buildHandOff(sep(SATURDAY_26, 0, 0, 30)),
    });

    const friday: HTMLElement = getDayColumn(container, sep(FRIDAY_25, 0));
    const saturday: HTMLElement = getDayColumn(container, sep(SATURDAY_26, 0));

    expect(getBlocks(friday).map(titleOf)).toEqual(["Alex"]);
    expect(labelOf(getBlock(friday, "Alex"))).toBe("7:26 PM – 12:00 AM");

    expect(getBlocks(saturday).map(titleOf)).toEqual(["Blair", "Casey"]);
    expect(boxOf(getBlock(saturday, "Blair")).width).toBe(100);
    expect(boxOf(getBlock(saturday, "Blair")).left).toBe(0);
  });

  test("a shift that really runs past midnight is still drawn on both days", () => {
    // Dropping slivers must not drop the next-day part of an overnight shift.
    const { container } = renderWeek({
      events: [makeEvent("Night", sep(FRIDAY_25, 22), sep(SATURDAY_26, 6))],
    });

    const friday: HTMLElement = getDayColumn(container, sep(FRIDAY_25, 0));
    const saturday: HTMLElement = getDayColumn(container, sep(SATURDAY_26, 0));

    expect(labelOf(getBlock(friday, "Night"))).toBe("10:00 PM – ");
    expect(labelOf(getBlock(saturday, "Night"))).toBe(" – 6:00 AM");

    const morning: BlockBox = boxOf(getBlock(saturday, "Night"));

    expect(morning.top).toBe(0);
    expect(morning.height).toBeCloseTo(percentOfDay(6, 0), 6);
  });

  /*
   * Dropping the sliver must not drop a block from the day it starts in. A
   * block with less than a minute left before midnight has no height in its
   * own column either, and the first version of the fix dropped it there
   * too, so an 11:59 PM hand-off to midnight was drawn on neither day.
   */
  test.each([
    { name: "11:59 PM", second: 0 },
    { name: "11:59:30 PM", second: 30 },
  ])(
    "a block from $name to midnight is drawn exactly once, at the bottom of the day it starts in",
    ({ second }: { second: number }) => {
      const { container } = renderWeek({
        events: [
          makeEvent(
            "Last minute",
            sep(FRIDAY_25, 23, 59, second),
            sep(SATURDAY_26, 0),
          ),
        ],
      });

      // Once in the whole week, all-day strip included.
      const drawn: Array<HTMLElement> = getBlocks(container).filter(
        (block: HTMLElement): boolean => {
          return titleOf(block) === "Last minute";
        },
      );

      expect(drawn).toHaveLength(1);

      const friday: HTMLElement = getDayColumn(container, sep(FRIDAY_25, 0));
      const saturday: HTMLElement = getDayColumn(
        container,
        sep(SATURDAY_26, 0),
      );

      expect(getBlocks(friday)).toEqual(drawn);
      expect(getBlocks(saturday)).toHaveLength(0);

      expect(boxOf(drawn[0]!).top).toBeCloseTo(percentOfDay(23, 59), 6);
      expect(labelOf(drawn[0]!)).toBe("11:59 PM – 12:00 AM");
    },
  );
});

describe("Calendar week view: a hand-off at 5:02 PM (12 Sep)", () => {
  /*
   * The report: one shift ends at 5:02 PM, the next begins at 5:02 PM, but the
   * grid showed a gap between them. The later blocks were overrides, whose
   * stylesheet rule took them out of rbc's absolute positioning (see the
   * stylesheet tests below, which place the blocks the way a browser would).
   * Here the inline geometry rbc receives from the layout is pinned: full
   * width, and each block starts exactly where the one before it ends.
   */
  test("consecutive shifts are full width and meet at the hand-off minute", () => {
    const { container } = renderWeek({
      defaultDate: sep(SATURDAY_12, 12),
      events: buildSaturday12(),
    });

    const saturday: HTMLElement = getDayColumn(container, sep(SATURDAY_12, 0));

    expect(getBlocks(saturday).map(titleOf)).toEqual([
      "Alex",
      "Blair (covering Alex)",
      "Casey (covering Alex)",
    ]);

    const alex: BlockBox = boxOf(getBlock(saturday, "Alex"));
    const blair: BlockBox = boxOf(getBlock(saturday, "Blair (covering Alex)"));
    const casey: BlockBox = boxOf(getBlock(saturday, "Casey (covering Alex)"));

    for (const box of [alex, blair, casey]) {
      expect(box.left).toBe(0);
      expect(box.width).toBe(100);
    }

    expect(alex.top).toBe(0);
    expect(blair.top).toBeCloseTo(percentOfDay(17, 2), 6);
    expect(blair.top).toBeCloseTo(alex.top + alex.height, 6);
    expect(casey.top).toBeCloseTo(percentOfDay(21, 26), 6);
    expect(casey.top).toBeCloseTo(blair.top + blair.height, 6);
  });

  test("the override block carries its class and the overridden person's colour as a custom property", () => {
    /*
     * The stripe on an override is drawn by the stylesheet from
     * --oneuptime-event-accent; if the property or the class stops reaching
     * the grid block, an override looks like an ordinary shift.
     */
    const { container } = renderWeek({
      defaultDate: sep(SATURDAY_12, 12),
      events: buildSaturday12(),
    });

    const saturday: HTMLElement = getDayColumn(container, sep(SATURDAY_12, 0));
    const blair: HTMLElement = getBlock(saturday, "Blair (covering Alex)");
    const alex: HTMLElement = getBlock(saturday, "Alex");

    expect(blair).toHaveClass("rbc-event");
    expect(blair).toHaveClass(OVERRIDE_CLASS);
    expect(blair.style.getPropertyValue("--oneuptime-event-accent")).toBe(
      "#16a34a",
    );
    // The block itself is in the substitute's colour.
    expect(blair.style.backgroundColor).toBe("rgb(220, 38, 38)");

    expect(alex).not.toHaveClass(OVERRIDE_CLASS);
    expect(alex.style.getPropertyValue("--oneuptime-event-accent")).toBe("");
  });

  test("blocks that really overlap still share the column side by side", () => {
    /*
     * The layout keeps back-to-back shifts at full width, but two people who
     * really are on call at once must stay visible as two lanes.
     */
    const { container } = renderWeek({
      events: [
        makeEvent("Long", sep(23, 9), sep(23, 12)),
        makeEvent("Short", sep(23, 10), sep(23, 11)),
        makeEvent("Evening", sep(23, 18), sep(23, 20)),
      ],
    });

    const wednesday: HTMLElement = getDayColumn(container, sep(23, 0));
    const long: BlockBox = boxOf(getBlock(wednesday, "Long"));
    const short: BlockBox = boxOf(getBlock(wednesday, "Short"));
    const evening: BlockBox = boxOf(getBlock(wednesday, "Evening"));

    expect(long.left).toBe(0);
    expect(long.width).toBe(50);
    expect(short.left).toBe(50);
    expect(short.width).toBe(50);

    // An overlap in the morning does not narrow the evening.
    expect(evening.left).toBe(0);
    expect(evening.width).toBe(100);
  });
});

describe("Calendar week view: a rotation that hands off at midnight", () => {
  /*
   * A daily rotation handing off at 00:00 gives blocks whose start and end are
   * both exactly midnight. react-big-calendar calls that shape all-day and
   * moved every such shift out of the grid into the strip above it, leaving
   * the week looking empty.
   */
  const PEOPLE: Array<string> = [
    "Sun person",
    "Mon person",
    "Tue person",
    "Wed person",
    "Thu person",
    "Fri person",
    "Sat person",
  ];

  const buildRotation: () => Array<CalendarEvent> =
    (): Array<CalendarEvent> => {
      return PEOPLE.map((person: string, index: number): CalendarEvent => {
        return makeEvent(person, sep(20 + index, 0), sep(21 + index, 0));
      });
    };

  test("every shift is drawn in its own day column, none in the all-day strip", () => {
    const { container } = renderWeek({ events: buildRotation() });

    expect(
      container.querySelectorAll(".rbc-allday-cell .rbc-event"),
    ).toHaveLength(0);

    PEOPLE.forEach((person: string, index: number) => {
      const column: HTMLElement = getDayColumn(container, sep(20 + index, 0));
      const blocks: Array<HTMLElement> = getBlocks(column);

      // Only that day's person: yesterday's shift ends at this midnight.
      expect(blocks.map(titleOf)).toEqual([person]);

      const box: BlockBox = boxOf(blocks[0]!);

      expect(box.top).toBe(0);
      expect(box.top + box.height).toBeCloseTo(percentOfDay(23, 59), 6);
      expect(box.left).toBe(0);
      expect(box.width).toBe(100);
      expect(labelOf(blocks[0]!)).toBe("12:00 AM – 12:00 AM");
    });
  });

  test("the calendar's localizer never calls a midnight-to-midnight block date-only", () => {
    // react-big-calendar's own moment localizer does: that is the all-day test it applies.
    expect(
      momentLocalizer(moment).startAndEndAreDateOnly(sep(23, 0), sep(24, 0)),
    ).toBe(true);

    expect(
      calendarLocalizer.startAndEndAreDateOnly(sep(23, 0), sep(24, 0)),
    ).toBe(false);
    // Nor a block spanning several whole days.
    expect(
      calendarLocalizer.startAndEndAreDateOnly(sep(20, 0), sep(27, 0)),
    ).toBe(false);
  });

  test("without all-day events the wrapper asks the stylesheet to hide the empty strip", () => {
    const { container } = renderWeek({ events: buildRotation() });

    expect(getWrapper(container)).toHaveClass("oneuptime-calendar");
    expect(getWrapper(container)).toHaveClass("oneuptime-calendar--no-all-day");
  });

  test("an event marked allDay still goes to the all-day strip, which then stays visible", () => {
    const { container } = renderWeek({
      events: [
        ...buildRotation(),
        makeEvent("Company holiday", sep(23, 0), sep(24, 0), { allDay: true }),
      ],
    });

    expect(getWrapper(container)).not.toHaveClass(
      "oneuptime-calendar--no-all-day",
    );

    const allDayBlocks: Array<HTMLElement> = getBlocks(
      container.querySelector(".rbc-allday-cell")!,
    );

    expect(allDayBlocks.map(titleOf)).toEqual(["Company holiday"]);

    // The rotation itself stays in the grid.
    const wednesday: HTMLElement = getDayColumn(container, sep(23, 0));

    expect(getBlocks(wednesday).map(titleOf)).toEqual(["Wed person"]);
  });
});

describe("Calendar colours: shifts and uncovered hours", () => {
  /*
   * Uncovered hours are passed as background events and drawn by the
   * stylesheet as a pale hatch. The block styling used to run over them too
   * and paint them solid Blue500, which is one of the colours a real person's
   * shift can have.
   */
  const BLUE_500: string = "rgb(59, 130, 246)";

  test("background events get no block colour unless the caller gave one", () => {
    const uncovered: CalendarEvent = makeEvent(
      "No one on call",
      sep(23, 0),
      sep(23, 9),
    );
    const colouredGap: CalendarEvent = makeEvent(
      "Tinted gap",
      sep(23, 21),
      sep(23, 23),
      { color: "#fbbf24", className: "custom-gap" },
    );

    const { container } = renderWeek({
      events: [
        makeEvent("Alex", sep(23, 9), sep(23, 21), { color: "#1e3a8a" }),
      ],
      backgroundEvents: [uncovered, colouredGap],
    });

    const wednesday: HTMLElement = getDayColumn(container, sep(23, 0));
    const backgrounds: Array<HTMLElement> = Array.from(
      wednesday.querySelectorAll<HTMLElement>(".rbc-background-event"),
    );

    expect(backgrounds.map(titleOf)).toEqual(["No one on call", "Tinted gap"]);

    const plain: HTMLElement = backgrounds[0]!;

    expect(plain.style.backgroundColor).not.toBe(BLUE_500);
    expect(plain.style.backgroundColor).toBe("");
    expect(plain.style.color).toBe("");
    /*
     * No block styling at all: an inline border-radius or display: block
     * would beat the stylesheet's flat band. Only rbc's own geometry is left.
     */
    expect(Array.from(plain.style).sort()).toEqual([
      "height",
      "left",
      "top",
      "width",
    ]);
    // Still a background band, not a block: the hatch comes from this class.
    expect(plain).toHaveClass("rbc-background-event");
    expect(plain).not.toHaveClass("rbc-event");

    const tinted: HTMLElement = backgrounds[1]!;

    expect(tinted.style.backgroundColor).toBe("rgb(251, 191, 36)");
    expect(tinted.style.color).toBe("");
    expect(tinted).toHaveClass("rbc-background-event");
    expect(tinted).toHaveClass("custom-gap");
  });

  test("shifts keep their colour and a readable text colour", () => {
    // A background event is passed too: telling bands apart must not unstyle shifts.
    const { container } = renderWeek({
      events: [
        makeEvent("Dark", sep(23, 0), sep(23, 6), { color: "#1e3a8a" }),
        makeEvent("Light", sep(23, 6), sep(23, 12), { color: "#fde047" }),
        makeEvent("Default", sep(23, 12), sep(23, 18)),
        makeEvent("Explicit text", sep(23, 18), sep(23, 23), {
          color: "#1e3a8a",
          textColor: "#000000",
        }),
      ],
      backgroundEvents: [makeEvent("Gap", sep(23, 23), sep(23, 23, 30))],
    });

    const wednesday: HTMLElement = getDayColumn(container, sep(23, 0));

    const dark: HTMLElement = getBlock(wednesday, "Dark");
    expect(dark.style.backgroundColor).toBe("rgb(30, 58, 138)");
    expect(dark.style.color).toBe("rgb(255, 255, 255)");

    const light: HTMLElement = getBlock(wednesday, "Light");
    expect(light.style.backgroundColor).toBe("rgb(253, 224, 71)");
    expect(light.style.color).toBe("rgb(17, 24, 39)");

    // A shift without a colour still gets the default block colour.
    const fallback: HTMLElement = getBlock(wednesday, "Default");
    expect(fallback.style.backgroundColor).toBe(BLUE_500);
    expect(fallback.style.color).toBe("rgb(255, 255, 255)");

    const explicit: HTMLElement = getBlock(wednesday, "Explicit text");
    expect(explicit.style.color).toBe("rgb(0, 0, 0)");
  });
});

describe("Calendar current time: getNow", () => {
  /*
   * The schedule preview shifts every event into the schedule's display zone.
   * The grid's "now" came from the browser clock, so with the browser in
   * another zone the red line and the highlighted day were drawn at the
   * browser's time on a grid showing the schedule's. getNow lets the caller
   * shift "now" the same way as the events.
   */
  const MONDAY_21_0900: Date = sep(21, 9);
  const WEDNESDAY_23_1430: Date = sep(23, 14, 30);

  const indicatorTop: (column: HTMLElement) => number = (
    column: HTMLElement,
  ): number => {
    const indicator: HTMLElement | null = column.querySelector<HTMLElement>(
      ".rbc-current-time-indicator",
    );

    if (!indicator) {
      throw new Error("The current-time line was not drawn in this column");
    }

    return percent(indicator.style.top);
  };

  test("the day and line come from getNow, not from the system clock", () => {
    jest.setSystemTime(MONDAY_21_0900);

    // Reads the clock on every call, shifted, the way the schedule preview does.
    const offset: number =
      WEDNESDAY_23_1430.getTime() - MONDAY_21_0900.getTime();

    const { container } = renderWeek({
      defaultDate: sep(23, 12),
      events: [],
      getNow: (): Date => {
        return new Date(Date.now() + offset);
      },
    });

    const monday: HTMLElement = getDayColumn(container, sep(21, 0));
    const wednesday: HTMLElement = getDayColumn(container, sep(23, 0));

    expect(wednesday).toHaveClass("rbc-today");
    expect(wednesday).toHaveClass("rbc-now");
    expect(monday).not.toHaveClass("rbc-today");

    // The day header is highlighted from the same "now".
    expect(getDayHeader(container, sep(23, 0))).toHaveClass("rbc-today");
    expect(getDayHeader(container, sep(21, 0))).not.toHaveClass("rbc-today");

    expect(
      container.querySelectorAll(".rbc-current-time-indicator"),
    ).toHaveLength(1);
    expect(indicatorTop(wednesday)).toBeCloseTo(percentOfDay(14, 30), 6);

    // A minute later the line has moved with getNow's clock.
    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });

    expect(indicatorTop(wednesday)).toBeCloseTo(percentOfDay(14, 31), 6);
  });

  test("without getNow the system clock decides", () => {
    jest.setSystemTime(MONDAY_21_0900);

    const { container } = renderWeek({
      defaultDate: sep(23, 12),
      events: [],
    });

    const monday: HTMLElement = getDayColumn(container, sep(21, 0));
    const wednesday: HTMLElement = getDayColumn(container, sep(23, 0));

    expect(monday).toHaveClass("rbc-today");
    expect(wednesday).not.toHaveClass("rbc-today");
    expect(getDayHeader(container, sep(21, 0))).toHaveClass("rbc-today");
    expect(indicatorTop(monday)).toBeCloseTo(percentOfDay(9, 0), 6);
  });
});

describe("formatEventTimeRangeStart", () => {
  /*
   * The label of a block that starts in a column and runs past its end.
   * react-big-calendar writes "7:26 PM – ", meaning "continues tomorrow". A
   * block that ends exactly at the midnight closing its column does not
   * continue (tomorrow has nothing of it to show), so it gets its end time.
   */
  const FRIDAY_1926: Date = sep(FRIDAY_25, 19, 26);
  const localizer: DateLocalizer = momentLocalizer(moment);

  interface FormatCase {
    name: string;
    end: Date;
    expected: string;
  }

  const CASES: Array<FormatCase> = [
    {
      name: "ends exactly at the following midnight",
      end: sep(SATURDAY_26, 0),
      expected: "7:26 PM – 12:00 AM",
    },
    {
      name: "ends 30 seconds after the following midnight (same minute)",
      end: sep(SATURDAY_26, 0, 0, 30),
      expected: "7:26 PM – 12:00 AM",
    },
    {
      name: "ends one minute after the following midnight",
      end: sep(SATURDAY_26, 0, 1),
      expected: "7:26 PM – ",
    },
    {
      name: "ends in the middle of the next day",
      end: sep(SATURDAY_26, 9, 52),
      expected: "7:26 PM – ",
    },
    {
      name: "ends at the midnight two days later",
      end: sep(27, 0),
      expected: "7:26 PM – ",
    },
  ];

  test.each(CASES)(
    "without a localizer: $name",
    ({ end, expected }: FormatCase) => {
      expect(formatEventTimeRangeStart({ start: FRIDAY_1926, end })).toBe(
        expected,
      );
    },
  );

  test.each(CASES)(
    "with react-big-calendar's moment localizer: $name",
    ({ end, expected }: FormatCase) => {
      expect(
        formatEventTimeRangeStart({ start: FRIDAY_1926, end }, "en", localizer),
      ).toBe(expected);
    },
  );

  test("a whole day from midnight to midnight is labelled with both ends", () => {
    expect(
      formatEventTimeRangeStart({
        start: sep(FRIDAY_25, 0),
        end: sep(SATURDAY_26, 0),
      }),
    ).toBe("12:00 AM – 12:00 AM");
  });

  test("times are formatted through the localizer and culture it is given", () => {
    const calls: Array<{
      value: Date;
      format: string;
      culture?: string | undefined;
    }> = [];

    const recordingLocalizer: DateLocalizer = {
      format: (value: Date, format: string, culture?: string): string => {
        calls.push({ value, format, culture });
        return `<${moment(value).format("HH:mm")}>`;
      },
    } as unknown as DateLocalizer;

    const range: DateRange = { start: FRIDAY_1926, end: sep(SATURDAY_26, 0) };

    expect(formatEventTimeRangeStart(range, "en-GB", recordingLocalizer)).toBe(
      "<19:26> – <00:00>",
    );
    expect(calls).toEqual([
      { value: range.start, format: "LT", culture: "en-GB" },
      { value: range.end, format: "LT", culture: "en-GB" },
    ]);

    expect(
      formatEventTimeRangeStart(
        { start: FRIDAY_1926, end: sep(SATURDAY_26, 9, 52) },
        "en-GB",
        recordingLocalizer,
      ),
    ).toBe("<19:26> – ");
  });
});

describe("Calendar.css", () => {
  /*
   * Three of the reported problems were stylesheet problems, which jsdom does
   * not apply. These tests read the real Calendar.css (and react-big-calendar's
   * own sheet, which it overrides) and check two things: the rule says what it
   * should, and it actually wins the cascade on the elements the component
   * renders, with selectors matched by the DOM and ranked by specificity.
   */
  const CALENDAR_CSS_PATH: string = path.resolve(
    __dirname,
    "../../../../UI/Components/Calendar/Calendar.css",
  );
  const RBC_CSS_PATH: string = path.resolve(
    __dirname,
    "../../../../node_modules/react-big-calendar/lib/css/react-big-calendar.css",
  );

  const readRules: (file: string) => Array<StyleRule> = (
    file: string,
  ): Array<StyleRule> => {
    // @charset is a statement, not a block; the shared parser expects blocks only.
    return parseTopLevelRules(
      fs.readFileSync(file, "utf8").replace(/@charset[^;]*;/g, ""),
    );
  };

  const CALENDAR_RULES: Array<StyleRule> = readRules(CALENDAR_CSS_PATH);
  // Calendar.tsx imports rbc's sheet first, then its own.
  const CASCADE: Array<StyleRule> = [
    ...readRules(RBC_CSS_PATH),
    ...CALENDAR_RULES,
  ];

  const normalizeSelector: (selector: string) => string = (
    selector: string,
  ): string => {
    return selector
      .replace(/\s*>\s*/g, " > ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // Every declaration Calendar.css makes for exactly this selector, later rules winning.
  const declarationsFor: (selector: string) => Record<string, string> = (
    selector: string,
  ): Record<string, string> => {
    const wanted: string = normalizeSelector(selector);
    const merged: Record<string, string> = {};

    for (const rule of CALENDAR_RULES) {
      if (rule.selectors.map(normalizeSelector).includes(wanted)) {
        Object.assign(merged, rule.declarations);
      }
    }

    return merged;
  };

  /*
   * Every declaration Calendar.css makes for an element carrying `className`,
   * whatever the rest of the selector says: the rules whose last compound
   * selector (the element the rule styles) has that class.
   */
  const declarationsForSubject: (
    className: string,
  ) => Record<string, string> = (className: string): Record<string, string> => {
    const hasClass: RegExp = new RegExp(`\\.${className}(?![\\w-])`);
    const merged: Record<string, string> = {};

    for (const rule of CALENDAR_RULES) {
      const stylesSubject: boolean = rule.selectors.some(
        (selector: string): boolean => {
          const compounds: Array<string> =
            normalizeSelector(selector).split(" ");
          return hasClass.test(compounds[compounds.length - 1] || "");
        },
      );

      if (stylesSubject) {
        Object.assign(merged, rule.declarations);
      }
    }

    return merged;
  };

  const OVERFLOW_PROPERTIES: Array<string> = [
    "overflow",
    "overflow-x",
    "overflow-y",
  ];

  // Any of these makes the element a scroll container.
  const SCROLLING_OVERFLOW: Array<string> = ["hidden", "auto", "scroll"];

  type Specificity = [number, number, number];

  // Enough of the CSS specificity rules for the plain selectors in these sheets.
  const specificityOf: (selector: string) => Specificity = (
    selector: string,
  ): Specificity => {
    const count: (pattern: RegExp) => number = (pattern: RegExp): number => {
      return (selector.match(pattern) || []).length;
    };

    const typesOnly: string = selector
      .replace(/\[[^\]]*\]/g, " ")
      .replace(/[.#:][\w-]+/g, " ")
      .replace(/[()*]/g, " ");

    return [
      count(/#[\w-]+/g),
      count(/\.[\w-]+/g) + count(/\[[^\]]*\]/g) + count(/:(?!not\()[\w-]+/g),
      (typesOnly.match(/[a-zA-Z][\w-]*/g) || []).length,
    ];
  };

  const compareSpecificity: (a: Specificity, b: Specificity) => number = (
    a: Specificity,
    b: Specificity,
  ): number => {
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  };

  /*
   * The value a browser would use for `property` on `element`: an inline style
   * first, otherwise the matching rule with the highest specificity, ties going
   * to the later rule. Neither sheet uses !important.
   */
  const cascadedValue: (
    element: HTMLElement,
    property: string,
  ) => string | undefined = (
    element: HTMLElement,
    property: string,
  ): string | undefined => {
    const inline: string = element.style.getPropertyValue(property);

    if (inline) {
      return inline;
    }

    let winner: { value: string; specificity: Specificity } | undefined =
      undefined;

    for (const rule of CASCADE) {
      const value: string | undefined = rule.declarations[property];

      if (value === undefined) {
        continue;
      }

      for (const selector of rule.selectors) {
        // A pseudo-element styles a generated box, not the element itself.
        if (selector.includes("::")) {
          continue;
        }

        let matches: boolean = false;

        try {
          matches = element.matches(selector);
        } catch {
          // Vendor-prefixed pseudo-classes jsdom cannot parse never match here.
          matches = false;
        }

        if (!matches) {
          continue;
        }

        const specificity: Specificity = specificityOf(selector);

        if (
          !winner ||
          compareSpecificity(specificity, winner.specificity) >= 0
        ) {
          winner = { value, specificity };
        }
      }
    }

    return winner?.value;
  };

  const remToPx: (value: string) => number = (value: string): number => {
    const match: RegExpMatchArray | null = value.match(/^(-?[\d.]+)(rem|px)$/);

    if (!match) {
      throw new Error(`Cannot convert "${value}" to pixels`);
    }

    return match[2] === "rem"
      ? parseFloat(match[1]!) * 16
      : parseFloat(match[1]!);
  };

  describe("rules", () => {
    test("override blocks in the day grid are positioned absolutely again", () => {
      /*
       * The generic override rule sets position: relative (for month rows and
       * the all-day strip). In the grid that made each override block flow
       * below the earlier ones, so a 5:02 PM hand-off was drawn hours late.
       */
      expect(
        declarationsFor(
          `.oneuptime-calendar .rbc-day-slot .rbc-event.${OVERRIDE_CLASS}`,
        )["position"],
      ).toBe("absolute");

      // And it outranks the generic rule instead of relying on source order.
      expect(
        compareSpecificity(
          specificityOf(
            `.oneuptime-calendar .rbc-day-slot .rbc-event.${OVERRIDE_CLASS}`,
          ),
          specificityOf(`.oneuptime-calendar .rbc-event.${OVERRIDE_CLASS}`),
        ),
      ).toBeGreaterThan(0);
    });

    test("hours are allowed to be much shorter than rbc's 40px, so a whole day fits", () => {
      const minHeight: string | undefined = declarationsFor(
        ".oneuptime-calendar .rbc-time-view .rbc-timeslot-group",
      )["min-height"];

      expect(minHeight).toBeDefined();
      expect(remToPx(minHeight!)).toBeGreaterThan(0);
      expect(remToPx(minHeight!)).toBeLessThanOrEqual(24);
    });

    test("the current-time line has a white halo so it shows on a red shift", () => {
      const boxShadow: string | undefined = declarationsFor(
        ".oneuptime-calendar .rbc-current-time-indicator",
      )["box-shadow"];

      expect(boxShadow).toBeDefined();
      expect(boxShadow!.toLowerCase()).toMatch(/#ffffff|#fff\b|white/);

      // The dot at the start of the line is ringed the same way.
      const dotShadow: string | undefined = declarationsFor(
        ".oneuptime-calendar .rbc-current-time-indicator::before",
      )["box-shadow"];

      expect(dotShadow).toBeDefined();
      expect(dotShadow!.toLowerCase()).toMatch(/#ffffff|#fff\b|white/);
    });

    test("day columns clip what hangs below midnight without becoming scroll containers", () => {
      /*
       * A block at rbc's 20px minimum height late in the day, or the
       * current-time dot near midnight, hung below the column and brought the
       * scrollbar back, so the column clips vertically. It must be `clip`:
       * `hidden`, `auto` or `scroll` make the column a scroll container, and
       * tabbing onto a late block then scrolled every block in that column
       * off the hour lines. The other axis must not be one of those either, or
       * the browser turns `clip` into `hidden`.
       */
      const daySlot: Record<string, string> =
        declarationsForSubject("rbc-day-slot");

      expect(daySlot["overflow-y"]).toBe("clip");

      for (const property of OVERFLOW_PROPERTIES) {
        expect(SCROLLING_OVERFLOW).not.toContain(daySlot[property]);
      }

      // No shorthand that would reset overflow-y, wherever it came in the rule.
      expect(daySlot["overflow"]).toBeUndefined();
    });

    test("the events container inside a day column sets no overflow of its own", () => {
      /*
       * The clip used to sit here as overflow: hidden, which made the events
       * container the scroll container: focusing a late block scrolled the
       * blocks while the hour lines, drawn by the column, stayed put.
       */
      const eventsContainer: Record<string, string> = declarationsForSubject(
        "rbc-events-container",
      );

      for (const property of OVERFLOW_PROPERTIES) {
        expect(eventsContainer[property]).toBeUndefined();
      }
    });

    test("focus and selection rings on grid blocks are drawn inside the block", () => {
      /*
       * The column clips vertically, so a ring drawn outside a block at the
       * top or bottom of the day would be cut off. The grid rules pull it
       * inside, and outrank the general ring rule instead of relying on order.
       */
      for (const state of [":focus", ".rbc-selected"]) {
        const gridSelector: string = `.oneuptime-calendar .rbc-day-slot .rbc-event${state}`;
        const outlineOffset: string | undefined =
          declarationsFor(gridSelector)["outline-offset"];

        expect(outlineOffset).toBeDefined();
        expect(remToPx(outlineOffset!)).toBeLessThan(0);

        expect(
          compareSpecificity(
            specificityOf(gridSelector),
            specificityOf(`.oneuptime-calendar .rbc-event${state}`),
          ),
        ).toBeGreaterThan(0);
      }
    });

    test("the empty all-day strip is hidden when the wrapper says there are no all-day events", () => {
      expect(
        declarationsFor(
          ".oneuptime-calendar.oneuptime-calendar--no-all-day .rbc-time-header-content > .rbc-allday-cell",
        )["display"],
      ).toBe("none");
    });

    test("background bands carry no time label or title", () => {
      expect(
        declarationsFor(
          ".oneuptime-calendar .rbc-background-event .rbc-event-label",
        )["display"],
      ).toBe("none");
      expect(
        declarationsFor(
          ".oneuptime-calendar .rbc-background-event .rbc-event-content",
        )["display"],
      ).toBe("none");
    });
  });

  /*
   * Where a browser draws each block of a day column, as a percent of the
   * column, from the cascaded `position`. An absolutely positioned block sits
   * at its `top`. A relatively positioned one is first laid out in normal
   * flow, below every in-flow block before it, and only then moved down by
   * its `top`. That is how override blocks ended up hours after their start.
   */
  const drawnTops: (column: HTMLElement) => Map<string, number> = (
    column: HTMLElement,
  ): Map<string, number> => {
    const eventsContainer: HTMLElement | null =
      column.querySelector<HTMLElement>(".rbc-events-container");

    if (!eventsContainer) {
      throw new Error("The day column has no events container");
    }

    const tops: Map<string, number> = new Map<string, number>();
    let flowOffset: number = 0;

    for (const child of Array.from(eventsContainer.children)) {
      const block: HTMLElement = child as HTMLElement;
      const position: string = cascadedValue(block, "position") || "static";
      const top: number = percent(block.style.top);

      if (position === "absolute") {
        tops.set(titleOf(block), top);
        continue;
      }

      tops.set(
        titleOf(block),
        flowOffset + (position === "relative" ? top : 0),
      );
      flowOffset += percent(block.style.height);
    }

    return tops;
  };

  describe("cascade on the rendered calendar", () => {
    test("override blocks in the grid resolve to position: absolute, so the 5:02 PM hand-off has no gap", () => {
      const { container } = renderWeek({
        defaultDate: sep(SATURDAY_12, 12),
        events: buildSaturday12(),
      });

      const saturday: HTMLElement = getDayColumn(
        container,
        sep(SATURDAY_12, 0),
      );
      const blocks: Array<HTMLElement> = getBlocks(saturday);

      expect(blocks).toHaveLength(3);

      for (const block of blocks) {
        expect(cascadedValue(block, "position")).toBe("absolute");
      }

      // The override rule still applies otherwise: this is its stripe padding.
      expect(
        cascadedValue(
          getBlock(saturday, "Blair (covering Alex)"),
          "padding-left",
        ),
      ).toBe("0.75rem");

      /*
       * Where the blocks are drawn. With `position: relative` the second
       * override was pushed down by the height of the first one, far past
       * 9:26 PM, leaving a gap after Blair.
       */
      const tops: Map<string, number> = drawnTops(saturday);
      const alex: BlockBox = boxOf(getBlock(saturday, "Alex"));
      const blair: BlockBox = boxOf(
        getBlock(saturday, "Blair (covering Alex)"),
      );

      expect(tops.get("Alex")).toBe(0);
      expect(tops.get("Blair (covering Alex)")).toBeCloseTo(
        alex.top + alex.height,
        6,
      );
      expect(tops.get("Blair (covering Alex)")).toBeCloseTo(
        percentOfDay(17, 2),
        6,
      );
      expect(tops.get("Casey (covering Alex)")).toBeCloseTo(
        blair.top + blair.height,
        6,
      );
      expect(tops.get("Casey (covering Alex)")).toBeCloseTo(
        percentOfDay(21, 26),
        6,
      );
    });

    test("outside the grid, an override block keeps position: relative for its stripe", () => {
      /*
       * The grid fix is scoped to day columns. In the all-day strip (and month
       * rows) blocks sit in normal flow, and the stripe needs the block to be
       * its containing block.
       */
      const { container } = renderWeek({
        events: [
          makeEvent("Holiday cover", sep(23, 0), sep(24, 0), {
            allDay: true,
            className: OVERRIDE_CLASS,
            accentColor: "#16a34a",
          }),
        ],
      });

      const cover: HTMLElement = getBlock(
        container.querySelector(".rbc-allday-cell")!,
        "Holiday cover",
      );

      expect(cascadedValue(cover, "position")).toBe("relative");
    });

    test("every hour row is short enough for all 24 to fit in the calendar's height", () => {
      const { container } = renderWeek({ events: [] });

      const wrapper: HTMLElement = getWrapper(container);
      const heightClass: RegExpMatchArray | null =
        wrapper.className.match(/\bh-\[([\d.]+)rem\]/);

      expect(heightClass).not.toBeNull();

      const calendarHeightPx: number = parseFloat(heightClass![1]!) * 16;

      // The time gutter and the seven days, 24 hours each.
      const hourRows: Array<HTMLElement> = Array.from(
        container.querySelectorAll<HTMLElement>(
          ".rbc-time-content .rbc-timeslot-group",
        ),
      );

      expect(hourRows).toHaveLength(8 * 24);

      let tallestMinHeightPx: number = 0;

      for (const hourRow of hourRows) {
        const minHeight: string | undefined = cascadedValue(
          hourRow,
          "min-height",
        );

        expect(minHeight).toBeDefined();
        tallestMinHeightPx = Math.max(tallestMinHeightPx, remToPx(minHeight!));

        // The rows grow to share the height, rather than stay at the floor.
        expect(cascadedValue(hourRow, "flex")).toBe("1");
      }

      /*
       * The toolbar and the day headers take the rest; 8rem is more than both
       * together. With rbc's 40px per hour a day needs 960px, far more than the
       * calendar is tall.
       */
      const TOOLBAR_AND_HEADERS_PX: number = 8 * 16;

      expect(24 * tallestMinHeightPx).toBeLessThanOrEqual(
        calendarHeightPx - TOOLBAR_AND_HEADERS_PX,
      );
    });

    test("the all-day strip is hidden while it is empty, and shown once it has an event", () => {
      const empty: RenderResult = renderWeek({
        events: [makeEvent("Alex", sep(23, 0), sep(24, 0))],
      });

      const emptyCell: HTMLElement | null =
        empty.container.querySelector<HTMLElement>(".rbc-allday-cell");

      expect(emptyCell).not.toBeNull();
      expect(cascadedValue(emptyCell!, "display")).toBe("none");

      empty.unmount();

      const withHoliday: RenderResult = renderWeek({
        events: [
          makeEvent("Alex", sep(23, 0), sep(24, 0)),
          makeEvent("Company holiday", sep(24, 0), sep(25, 0), {
            allDay: true,
          }),
        ],
      });

      const filledCell: HTMLElement | null =
        withHoliday.container.querySelector<HTMLElement>(".rbc-allday-cell");

      expect(filledCell).not.toBeNull();
      expect(cascadedValue(filledCell!, "display")).not.toBe("none");
    });

    test("the current-time line is drawn over a red shift, with the white halo", () => {
      // The clock says Wednesday 10:00; a red shift covers that hour.
      const { container } = renderWeek({
        events: [
          makeEvent("Red shift", sep(23, 9), sep(23, 11), {
            color: "#dc2626",
          }),
        ],
      });

      const wednesday: HTMLElement = getDayColumn(container, sep(23, 0));
      const indicator: HTMLElement | null =
        wednesday.querySelector<HTMLElement>(".rbc-current-time-indicator");
      const redShift: HTMLElement = getBlock(wednesday, "Red shift");
      const shiftBox: BlockBox = boxOf(redShift);

      expect(indicator).not.toBeNull();
      expect(redShift.style.backgroundColor).toBe("rgb(220, 38, 38)");

      // The line really crosses the red block.
      const lineTop: number = percent(indicator!.style.top);

      expect(lineTop).toBeGreaterThan(shiftBox.top);
      expect(lineTop).toBeLessThan(shiftBox.top + shiftBox.height);

      // It is stacked above the block, and ringed in white so red on red shows.
      const zIndexOf: (element: HTMLElement) => number = (
        element: HTMLElement,
      ): number => {
        const value: string | undefined = cascadedValue(element, "z-index");
        return value && value !== "auto" ? Number(value) : 0;
      };
      const lineZ: number = zIndexOf(indicator!);
      const blockZ: number = zIndexOf(redShift);

      expect(lineZ).toBeGreaterThan(blockZ);
      expect(cascadedValue(indicator!, "box-shadow")).toContain("#ffffff");
    });

    test("every rendered day column clips vertically, and nothing in it can scroll", () => {
      const { container } = renderWeek({ events: [] });

      const columns: Array<HTMLElement> = getDayColumns(container);

      expect(columns).toHaveLength(7);

      for (const column of columns) {
        expect(cascadedValue(column, "overflow-y")).toBe("clip");
        expect(cascadedValue(column, "overflow")).toBeUndefined();
        expect(SCROLLING_OVERFLOW).not.toContain(
          cascadedValue(column, "overflow-x"),
        );

        const eventsContainer: HTMLElement | null =
          column.querySelector<HTMLElement>(".rbc-events-container");

        expect(eventsContainer).not.toBeNull();

        for (const property of OVERFLOW_PROPERTIES) {
          expect(cascadedValue(eventsContainer!, property)).toBeUndefined();
        }
      }
    });

    test("a focused or selected grid block has its whole ring inside the block", () => {
      const { container } = renderWeek({
        events: [makeEvent("Alex", sep(23, 9), sep(23, 17))],
      });

      const findAlex: () => HTMLElement = (): HTMLElement => {
        return getBlock(getDayColumn(container, sep(23, 0)), "Alex");
      };

      // The ring's width comes from the general rule, e.g. "2px solid #4f46e5".
      const expectRingInside: (block: HTMLElement) => void = (
        block: HTMLElement,
      ): void => {
        const outline: string | undefined = cascadedValue(block, "outline");
        const outlineOffset: string | undefined = cascadedValue(
          block,
          "outline-offset",
        );

        expect(outline).toBeDefined();
        expect(outlineOffset).toBeDefined();

        const ringWidthPx: number = remToPx(outline!.split(" ")[0]!);

        expect(ringWidthPx).toBeGreaterThan(0);
        expect(remToPx(outlineOffset!)).toBeLessThanOrEqual(-ringWidthPx);
      };

      // Keyboard focus: react-big-calendar makes each grid block tabbable.
      act(() => {
        findAlex().focus();
      });

      expect(document.activeElement).toBe(findAlex());
      expectRingInside(findAlex());

      act(() => {
        findAlex().blur();
      });

      // A click selects the block.
      act(() => {
        fireEvent.click(findAlex());
      });

      expect(findAlex()).toHaveClass("rbc-selected");
      expect(findAlex()).not.toBe(document.activeElement);
      expectRingInside(findAlex());
    });

    test("the rendered background band hides its label and title", () => {
      const { container } = renderWeek({
        events: [],
        backgroundEvents: [makeEvent("No one on call", sep(23, 0), sep(23, 9))],
      });

      const band: HTMLElement | null = container.querySelector<HTMLElement>(
        ".rbc-background-event",
      );

      expect(band).not.toBeNull();

      const label: HTMLElement = band!.querySelector(
        ".rbc-event-label",
      ) as HTMLElement;
      const content: HTMLElement = band!.querySelector(
        ".rbc-event-content",
      ) as HTMLElement;

      expect(cascadedValue(label, "display")).toBe("none");
      expect(cascadedValue(content, "display")).toBe("none");
    });
  });
});
