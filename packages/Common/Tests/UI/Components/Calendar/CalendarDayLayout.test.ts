/** @timezone UTC */

/*
 * The on-call schedule's week and day views place blocks with
 * CalendarDayLayout instead of react-big-calendar's default "overlap" layout.
 * Two user reports drove that change:
 *
 *  - 26 Sep: a shift ending at Sat 12:00 AM was ALSO drawn in Saturday's
 *    column, as a 20px sliver labelled "– 12:00 AM", and it squeezed the shift
 *    that really starts at Sat 12:00 AM into part of the column, so two shifts
 *    that meet at midnight looked like they overlapped.
 *  - 12 Sep: shifts meeting at 5:02 PM did not look back-to-back. (Most of
 *    that gap was a stylesheet bug, but the "overlap" layout also puts any two
 *    blocks that start within half an hour of each other in separate lanes,
 *    as if both people were on call at once.)
 *
 * A third came out of review: a block starting at 11:59 PM, such as a shift
 * from 11:59 PM to 12:00 AM, used to be dropped from the day it starts as well
 * as from the next day, so it was not drawn anywhere.
 *
 * These tests run the layout against react-big-calendar's REAL per-column slot
 * metrics, built exactly the way its TimeGrid/DayColumn builds them (min/max
 * merged onto the column's date, 30-minute steps, 2 slots per hour) with the
 * calendar's own localizer, and hand each column the events TimeGrid would hand
 * it. So the positions asserted here are the ones the browser draws. The
 * process timezone is pinned to UTC so every day is 24 hours;
 * CalendarDayLayoutDst.test.ts covers DST days.
 */

import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import { calendarLocalizer } from "../../../../UI/Components/Calendar/Calendar";
import {
  DayEventAccessors,
  DayEventStyle,
  DaySlotMetrics,
  StyledDayEvent,
  isSpilloverSliver,
  layoutDayEvents,
} from "../../../../UI/Components/Calendar/CalendarDayLayout";
import { describe, expect, jest, test } from "@jest/globals";
import moment from "moment-timezone";
import { DateLocalizer, momentLocalizer } from "react-big-calendar";

interface SlotMetricsOptions {
  min: Date;
  max: Date;
  step: number;
  timeslots: number;
  localizer: DateLocalizer;
}

// react-big-calendar/lib/utils/TimeSlots ships no types. This is the one export used here.
interface TimeSlotsModule {
  getSlotMetrics: (options: SlotMetricsOptions) => DaySlotMetrics;
}

interface RbcDayLayoutInput {
  events: Array<CalendarEvent>;
  minimumStartDifference: number;
  slotMetrics: DaySlotMetrics;
  accessors: DayEventAccessors<CalendarEvent>;
}

// react-big-calendar's own "overlap" layout, which the calendar used before this change.
interface RbcOverlapLayoutModule {
  default: (input: RbcDayLayoutInput) => Array<StyledDayEvent<CalendarEvent>>;
}

const timeSlots: TimeSlotsModule = jest.requireActual(
  "react-big-calendar/lib/utils/TimeSlots",
) as TimeSlotsModule;

const rbcOverlapLayout: RbcOverlapLayoutModule = jest.requireActual(
  "react-big-calendar/lib/utils/layout-algorithms/overlap",
) as RbcOverlapLayoutModule;

/*
 * A plain moment localizer, as the calendar used before this change. Only the
 * contrast tests at the bottom use it, to show react-big-calendar's own
 * behaviour; everything else lays days out with calendarLocalizer, exactly as
 * the calendar does. (In UTC the two place blocks identically.)
 */
const stockLocalizer: DateLocalizer = momentLocalizer(moment);

// react-big-calendar's defaults, which Calendar.tsx keeps.
const STEP_MINUTES: number = 30;
const TIMESLOTS_PER_GROUP: number = 2;

// What DayColumn passes the layout: Math.ceil(step * timeslots / 2).
const RBC_MINIMUM_START_DIFFERENCE: number = Math.ceil(
  (STEP_MINUTES * TIMESLOTS_PER_GROUP) / 2,
);

const MINUTES_PER_DAY: number = 24 * 60;

// Where a time of day sits in a 24-hour column, as a percentage of its height.
const percentOfDay: (hours: number, minutes?: number) => number = (
  hours: number,
  minutes: number = 0,
): number => {
  return ((hours * 60 + minutes) / MINUTES_PER_DAY) * 100;
};

const ONE_MINUTE_PERCENT: number = percentOfDay(0, 1);

/*
 * react-big-calendar's column ends at 23:59:59, and it positions whole minutes,
 * so a block running to midnight stops at the top of the last minute.
 */
const END_OF_DAY_PERCENT: number = percentOfDay(23, 59);

// Positions are floating-point percentages; this is far below a pixel.
const PRECISION: number = 9;

// The same tolerance for inequalities, so blocks that only touch do not count as sharing space.
const EPSILON: number = 1e-9;

const accessors: DayEventAccessors<CalendarEvent> = {
  start: (event: CalendarEvent): Date => {
    return event.start;
  },
  end: (event: CalendarEvent): Date => {
    return event.end;
  },
};

// A wall-clock time in the process timezone (UTC in this file).
const at: (wallClock: string) => Date = (wallClock: string): Date => {
  const parsed: moment.Moment = moment(
    wallClock,
    ["YYYY-MM-DD HH:mm:ss", "YYYY-MM-DD HH:mm"],
    true,
  );

  if (!parsed.isValid()) {
    throw new Error(`Not a wall-clock time: ${wallClock}`);
  }

  return parsed.toDate();
};

let nextEventId: number = 1;

// An on-call block, as LayersPreview hands it to the calendar.
const block: (title: string, start: string, end: string) => CalendarEvent = (
  title: string,
  start: string,
  end: string,
): CalendarEvent => {
  const event: CalendarEvent = {
    id: nextEventId,
    title,
    start: at(start),
    end: at(end),
  };

  nextEventId += 1;

  return event;
};

// An uncovered band, shaped like LayersPreview's background events: no title.
const uncovered: (
  index: number,
  start: string,
  end: string,
) => CalendarEvent = (
  index: number,
  start: string,
  end: string,
): CalendarEvent => {
  return {
    id: -1 * (index + 1),
    title: "",
    allDay: false,
    start: at(start),
    end: at(end),
  };
};

const columnDate: (day: string) => Date = (day: string): Date => {
  return at(`${day} 00:00`);
};

/*
 * Exactly what TimeGrid passes each DayColumn, which then builds its slot
 * metrics. The week view's default min/max are the start and end of TODAY,
 * but merge keeps only their time of day (00:00:00 and 23:59:59), so the
 * column's own date gives the same bounds without reading the machine clock.
 */
const slotMetricsFor: (
  day: string,
  localizer?: DateLocalizer,
) => DaySlotMetrics = (
  day: string,
  localizer: DateLocalizer = calendarLocalizer,
): DaySlotMetrics => {
  const date: Date = columnDate(day);
  const min: Date | null = localizer.merge(
    date,
    localizer.startOf(date, "day"),
  );
  const max: Date | null = localizer.merge(date, localizer.endOf(date, "day"));

  if (!min || !max) {
    throw new Error(`Could not build the ${day} column`);
  }

  return timeSlots.getSlotMetrics({
    min,
    max,
    step: STEP_MINUTES,
    timeslots: TIMESLOTS_PER_GROUP,
    localizer,
  });
};

/*
 * TimeGrid hands a column every event whose start..end touches its DATE,
 * inclusively, which is how a block ending at Sat 00:00 reaches Saturday.
 */
const eventsHandedToColumn: (
  day: string,
  events: Array<CalendarEvent>,
) => Array<CalendarEvent> = (
  day: string,
  events: Array<CalendarEvent>,
): Array<CalendarEvent> => {
  const date: Date = columnDate(day);

  return events.filter((event: CalendarEvent): boolean => {
    return calendarLocalizer.inRange(date, event.start, event.end, "day");
  });
};

const layoutColumn: (
  day: string,
  events: Array<CalendarEvent>,
) => Array<StyledDayEvent<CalendarEvent>> = (
  day: string,
  events: Array<CalendarEvent>,
): Array<StyledDayEvent<CalendarEvent>> => {
  return layoutDayEvents<CalendarEvent>({
    events: eventsHandedToColumn(day, events),
    slotMetrics: slotMetricsFor(day),
    accessors,
  });
};

const rbcOverlapColumn: (
  day: string,
  events: Array<CalendarEvent>,
) => Array<StyledDayEvent<CalendarEvent>> = (
  day: string,
  events: Array<CalendarEvent>,
): Array<StyledDayEvent<CalendarEvent>> => {
  return rbcOverlapLayout.default({
    events: eventsHandedToColumn(day, events),
    minimumStartDifference: RBC_MINIMUM_START_DIFFERENCE,
    slotMetrics: slotMetricsFor(day, stockLocalizer),
    accessors,
  });
};

const styleOf: (
  layout: Array<StyledDayEvent<CalendarEvent>>,
  event: CalendarEvent,
) => DayEventStyle = (
  layout: Array<StyledDayEvent<CalendarEvent>>,
  event: CalendarEvent,
): DayEventStyle => {
  const found: StyledDayEvent<CalendarEvent> | undefined = layout.find(
    (styled: StyledDayEvent<CalendarEvent>): boolean => {
      return styled.event === event;
    },
  );

  if (!found) {
    throw new Error(`"${event.title}" was not laid out`);
  }

  return found.style;
};

const eventsOf: (
  layout: Array<StyledDayEvent<CalendarEvent>>,
) => Array<CalendarEvent> = (
  layout: Array<StyledDayEvent<CalendarEvent>>,
): Array<CalendarEvent> => {
  return layout.map((styled: StyledDayEvent<CalendarEvent>): CalendarEvent => {
    return styled.event;
  });
};

const bottomOf: (style: DayEventStyle) => number = (
  style: DayEventStyle,
): number => {
  return style.top + style.height;
};

const expectFullWidth: (style: DayEventStyle) => void = (
  style: DayEventStyle,
): void => {
  expect(style.width).toBe(100);
  expect(style.xOffset).toBe(0);
};

/*
 * Every block spans the whole column and starts exactly where the block before
 * it ends: no gap, no overlap, no lanes. It needs at least one hand-off to
 * check, so a layout that lost a block cannot pass it by default.
 */
const expectBackToBack: (
  layout: Array<StyledDayEvent<CalendarEvent>>,
) => void = (layout: Array<StyledDayEvent<CalendarEvent>>): void => {
  expect(layout.length).toBeGreaterThanOrEqual(2);

  let previous: DayEventStyle | undefined = undefined;

  for (const styled of layout) {
    expectFullWidth(styled.style);
    expect(styled.style.height).toBeGreaterThan(0);

    if (previous) {
      expect(styled.style.top).toBeCloseTo(bottomOf(previous), PRECISION);
    }

    previous = styled.style;
  }
};

/*
 * The promise of lanes: two people on call at the same time are both visible.
 * No block may sit on top of another block that shares any of its time, and
 * every block stays inside the column. Lists the offending pairs by title so a
 * failure says which blocks collide.
 */
const expectNoBlockCoversAnother: (
  layout: Array<StyledDayEvent<CalendarEvent>>,
) => void = (layout: Array<StyledDayEvent<CalendarEvent>>): void => {
  expect(layout.length).toBeGreaterThanOrEqual(2);

  const collisions: Array<string> = [];

  layout.forEach((a: StyledDayEvent<CalendarEvent>, index: number) => {
    expect(a.style.xOffset).toBeGreaterThanOrEqual(0);
    expect(a.style.xOffset + a.style.width).toBeLessThanOrEqual(100 + EPSILON);

    for (const b of layout.slice(index + 1)) {
      const shareTime: boolean =
        a.style.top < bottomOf(b.style) - EPSILON &&
        b.style.top < bottomOf(a.style) - EPSILON;
      const shareSpace: boolean =
        a.style.xOffset < b.style.xOffset + b.style.width - EPSILON &&
        b.style.xOffset < a.style.xOffset + a.style.width - EPSILON;

      if (shareTime && shareSpace) {
        collisions.push(`${a.event.title} / ${b.event.title}`);
      }
    }
  });

  expect(collisions).toEqual([]);
};

describe("CalendarDayLayout", () => {
  describe("a block that ends exactly at midnight (the 26 Sep report)", () => {
    const friday: CalendarEvent = block(
      "Friday evening",
      "2026-09-25 19:26",
      "2026-09-26 00:00",
    );
    const saturday: CalendarEvent = block(
      "Saturday morning",
      "2026-09-26 00:00",
      "2026-09-26 08:00",
    );

    test("is handed to the next day's column by react-big-calendar, where it covers nothing", () => {
      /*
       * The premise of the bug: TimeGrid's day filter is inclusive, so
       * Saturday's column receives the Friday block even though none of it
       * falls on Saturday.
       */
      expect(eventsHandedToColumn("2026-09-26", [friday, saturday])).toEqual([
        friday,
        saturday,
      ]);

      const range: { start: number; end: number } = slotMetricsFor(
        "2026-09-26",
      ).getRange(friday.start, friday.end);

      expect(range.start).toBe(0);
      expect(range.end).toBe(0);
    });

    test("is dropped from the next day's column, so the block starting at 12:00 AM keeps the full width", () => {
      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-26",
        [friday, saturday],
      );

      expect(eventsOf(layout)).toEqual([saturday]);

      const style: DayEventStyle = styleOf(layout, saturday);
      expectFullWidth(style);
      expect(style.top).toBe(0);
      expect(bottomOf(style)).toBeCloseTo(percentOfDay(8), PRECISION);
    });

    test("stays in its own column, from its start to the bottom of the day", () => {
      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-25",
        [friday, saturday],
      );

      // Saturday's block does not touch Friday at all.
      expect(eventsOf(layout)).toEqual([friday]);

      const style: DayEventStyle = styleOf(layout, friday);
      expectFullWidth(style);
      expect(style.top).toBeCloseTo(percentOfDay(19, 26), PRECISION);
      expect(bottomOf(style)).toBeCloseTo(END_OF_DAY_PERCENT, PRECISION);
      expect(100 - bottomOf(style)).toBeLessThanOrEqual(
        ONE_MINUTE_PERCENT + EPSILON,
      );
    });

    test("isSpilloverSliver flags it only in the column it merely touches", () => {
      expect(
        isSpilloverSliver(friday, slotMetricsFor("2026-09-26"), accessors),
      ).toBe(true);
      expect(
        isSpilloverSliver(friday, slotMetricsFor("2026-09-25"), accessors),
      ).toBe(false);
      expect(
        isSpilloverSliver(saturday, slotMetricsFor("2026-09-26"), accessors),
      ).toBe(false);
    });

    test("a daily rotation handing off at midnight draws exactly one full-height block per day", () => {
      const days: Array<string> = ["2026-09-25", "2026-09-26", "2026-09-27"];
      const shifts: Array<CalendarEvent> = [
        block("Thursday", "2026-09-24 00:00", "2026-09-25 00:00"),
        block("Friday", "2026-09-25 00:00", "2026-09-26 00:00"),
        block("Saturday", "2026-09-26 00:00", "2026-09-27 00:00"),
        block("Sunday", "2026-09-27 00:00", "2026-09-28 00:00"),
      ];

      days.forEach((day: string, index: number) => {
        const own: CalendarEvent | undefined = shifts[index + 1];
        if (!own) {
          throw new Error(`No shift for ${day}`);
        }

        // The previous day's shift reaches this column too, and is dropped.
        expect(eventsHandedToColumn(day, shifts)).toContain(shifts[index]);

        const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          day,
          shifts,
        );

        expect(eventsOf(layout)).toEqual([own]);

        const style: DayEventStyle = styleOf(layout, own);
        expectFullWidth(style);
        expect(style.top).toBe(0);
        expect(bottomOf(style)).toBeCloseTo(END_OF_DAY_PERCENT, PRECISION);
      });
    });
  });

  describe("whole minutes, as the grid draws them", () => {
    test("a tail ending seconds after midnight is still a midnight hand-off, and is dropped", () => {
      const friday: CalendarEvent = block(
        "Friday evening",
        "2026-09-25 19:26",
        "2026-09-26 00:00:30",
      );
      const saturday: CalendarEvent = block(
        "Saturday morning",
        "2026-09-26 00:00",
        "2026-09-26 08:00",
      );

      expect(
        isSpilloverSliver(friday, slotMetricsFor("2026-09-26"), accessors),
      ).toBe(true);

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-26",
        [friday, saturday],
      );

      expect(eventsOf(layout)).toEqual([saturday]);
      expectFullWidth(styleOf(layout, saturday));
    });

    test("a tail reaching a whole minute into the next day is real, and is kept", () => {
      const friday: CalendarEvent = block(
        "Friday evening",
        "2026-09-25 19:26",
        "2026-09-26 00:01",
      );
      const saturday: CalendarEvent = block(
        "Saturday morning",
        "2026-09-26 00:01",
        "2026-09-26 08:00",
      );

      expect(
        isSpilloverSliver(friday, slotMetricsFor("2026-09-26"), accessors),
      ).toBe(false);

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-26",
        [saturday, friday],
      );

      expect(eventsOf(layout)).toEqual([friday, saturday]);
      expect(styleOf(layout, friday).top).toBe(0);
      expect(styleOf(layout, friday).height).toBeCloseTo(
        ONE_MINUTE_PERCENT,
        PRECISION,
      );
      expectBackToBack(layout);
    });

    test("a block starting in the column's last minute stays in its start day, at the bottom, and continues at the top of the next", () => {
      /*
       * Only a tail is ever dropped. A block starting at 11:59 PM has no whole
       * minute of its start day to show, but it still belongs there: it gets
       * a zero-height place at the very bottom of the column (the stylesheet
       * clips it to the column), and the next day draws the rest.
       */
      const lastMinute: CalendarEvent = block(
        "Starts at 11:59 PM",
        "2026-09-25 23:59",
        "2026-09-26 06:00",
      );
      const lastSeconds: CalendarEvent = block(
        "Starts at 11:59:30 PM",
        "2026-09-25 23:59:30",
        "2026-09-26 06:00",
      );

      for (const event of [lastMinute, lastSeconds]) {
        expect(
          isSpilloverSliver(event, slotMetricsFor("2026-09-25"), accessors),
        ).toBe(false);

        const own: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          "2026-09-25",
          [event],
        );
        expect(eventsOf(own)).toEqual([event]);
        expectFullWidth(styleOf(own, event));
        expect(styleOf(own, event).top).toBeCloseTo(
          END_OF_DAY_PERCENT,
          PRECISION,
        );
        expect(styleOf(own, event).height).toBe(0);

        const next: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          "2026-09-26",
          [event],
        );
        expect(eventsOf(next)).toEqual([event]);
        expect(styleOf(next, event).top).toBe(0);
        expect(bottomOf(styleOf(next, event))).toBeCloseTo(
          percentOfDay(6),
          PRECISION,
        );
      }
    });

    test("a block from 11:59 PM to midnight is drawn exactly once, in the day it starts", () => {
      /*
       * Neither column has a whole minute of these. Dropping every block with
       * no whole minute in a column made them vanish from both days; only the
       * next day's tail may go.
       */
      const toMidnight: CalendarEvent = block(
        "11:59 PM to 12:00 AM",
        "2026-09-25 23:59",
        "2026-09-26 00:00",
      );
      const thirtySecondsEachSide: CalendarEvent = block(
        "11:59:30 PM to 12:00:30 AM",
        "2026-09-25 23:59:30",
        "2026-09-26 00:00:30",
      );

      for (const event of [toMidnight, thirtySecondsEachSide]) {
        // react-big-calendar hands the block to both columns.
        expect(eventsHandedToColumn("2026-09-25", [event])).toEqual([event]);
        expect(eventsHandedToColumn("2026-09-26", [event])).toEqual([event]);

        expect(
          isSpilloverSliver(event, slotMetricsFor("2026-09-25"), accessors),
        ).toBe(false);
        expect(
          isSpilloverSliver(event, slotMetricsFor("2026-09-26"), accessors),
        ).toBe(true);

        const own: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          "2026-09-25",
          [event],
        );
        expect(eventsOf(own)).toEqual([event]);
        expect(styleOf(own, event).top).toBeCloseTo(
          END_OF_DAY_PERCENT,
          PRECISION,
        );
        expect(styleOf(own, event).height).toBe(0);

        expect(layoutColumn("2026-09-26", [event])).toEqual([]);
      }
    });

    test("a zero-height block at the bottom neither opens a lane nor narrows the block ending there", () => {
      // A rotation handing off at 11:59 PM: the evening shift runs to the bottom of the column.
      const evening: CalendarEvent = block(
        "Evening",
        "2026-09-25 17:02",
        "2026-09-25 23:59",
      );
      const overnight: CalendarEvent = block(
        "Overnight",
        "2026-09-25 23:59",
        "2026-09-26 06:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-25",
        [overnight, evening],
      );

      expect(eventsOf(layout)).toEqual([evening, overnight]);
      expectFullWidth(styleOf(layout, evening));
      expectFullWidth(styleOf(layout, overnight));
      expect(bottomOf(styleOf(layout, evening))).toBeCloseTo(
        END_OF_DAY_PERCENT,
        PRECISION,
      );
      expect(styleOf(layout, overnight).top).toBeCloseTo(
        END_OF_DAY_PERCENT,
        PRECISION,
      );
      expect(styleOf(layout, overnight).height).toBe(0);
    });

    test("a block that sits inside the day is never dropped, however short", () => {
      /*
       * These have no whole-minute extent either, but they belong to this day:
       * they are real (if brief) events, and react-big-calendar's minimum
       * height keeps them visible.
       */
      const atMidnight: CalendarEvent = block(
        "Zero length at 12:00 AM",
        "2026-09-25 00:00",
        "2026-09-25 00:00",
      );
      const zeroLength: CalendarEvent = block(
        "Zero length at 10:00 AM",
        "2026-09-25 10:00",
        "2026-09-25 10:00",
      );
      const subMinute: CalendarEvent = block(
        "Forty seconds at 3:00 PM",
        "2026-09-25 15:00:00",
        "2026-09-25 15:00:40",
      );
      const lastSeconds: CalendarEvent = block(
        "Thirty seconds at 11:59 PM",
        "2026-09-25 23:59:00",
        "2026-09-25 23:59:30",
      );
      const events: Array<CalendarEvent> = [
        lastSeconds,
        subMinute,
        zeroLength,
        atMidnight,
      ];
      const metrics: DaySlotMetrics = slotMetricsFor("2026-09-25");

      for (const event of events) {
        expect(isSpilloverSliver(event, metrics, accessors)).toBe(false);
      }

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-25",
        events,
      );

      expect(eventsOf(layout)).toEqual([
        atMidnight,
        zeroLength,
        subMinute,
        lastSeconds,
      ]);
      expect(styleOf(layout, atMidnight).top).toBe(0);
      expect(styleOf(layout, zeroLength).top).toBeCloseTo(
        percentOfDay(10),
        PRECISION,
      );
      expect(styleOf(layout, subMinute).top).toBeCloseTo(
        percentOfDay(15),
        PRECISION,
      );
      expect(styleOf(layout, lastSeconds).top).toBeCloseTo(
        percentOfDay(23, 59),
        PRECISION,
      );

      for (const styled of layout) {
        expect(styled.style.height).toBe(0);
        expectFullWidth(styled.style);
      }
    });
  });

  describe("hand-offs within a day (the 12 Sep report)", () => {
    test("a shift ending at 5:02 PM and the next starting at 5:02 PM meet exactly, both full width", () => {
      /*
       * react-big-calendar's old layout also drew this pair correctly: the
       * visible gap was the override stylesheet bug, which Calendar.test.tsx
       * pins. This guards the new layout against adding a gap or a lane here.
       */
      const first: CalendarEvent = block(
        "Alice",
        "2026-09-12 09:00",
        "2026-09-12 17:02",
      );
      const second: CalendarEvent = block(
        "Bob",
        "2026-09-12 17:02",
        "2026-09-12 23:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [second, first],
      );

      expect(eventsOf(layout)).toEqual([first, second]);

      const firstStyle: DayEventStyle = styleOf(layout, first);
      const secondStyle: DayEventStyle = styleOf(layout, second);

      expectFullWidth(firstStyle);
      expectFullWidth(secondStyle);
      expect(firstStyle.top).toBeCloseTo(percentOfDay(9), PRECISION);
      expect(bottomOf(firstStyle)).toBeCloseTo(percentOfDay(17, 2), PRECISION);
      expect(secondStyle.top).toBeCloseTo(bottomOf(firstStyle), PRECISION);
      expect(bottomOf(secondStyle)).toBeCloseTo(percentOfDay(23), PRECISION);
    });

    test("the rotation engine's one-second seams do not open a second lane", () => {
      /*
       * LayerUtil resumes each shift one second after the previous one ends,
       * and the multi-layer merge trims to the second before. Neither is a
       * real overlap, so neither may put the two people side by side.
       */
      const endsOnTheMinute: CalendarEvent = block(
        "Alice",
        "2026-09-12 09:00:00",
        "2026-09-12 17:02:00",
      );
      const resumesASecondLater: CalendarEvent = block(
        "Bob",
        "2026-09-12 17:02:01",
        "2026-09-12 23:00:00",
      );

      const resumed: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [endsOnTheMinute, resumesASecondLater],
      );

      expect(eventsOf(resumed)).toEqual([endsOnTheMinute, resumesASecondLater]);
      expectBackToBack(resumed);
      expect(styleOf(resumed, resumesASecondLater).top).toBeCloseTo(
        percentOfDay(17, 2),
        PRECISION,
      );

      const endsASecondEarly: CalendarEvent = block(
        "Alice",
        "2026-09-12 09:00:00",
        "2026-09-12 17:01:59",
      );
      const startsOnTheMinute: CalendarEvent = block(
        "Bob",
        "2026-09-12 17:02:00",
        "2026-09-12 23:00:00",
      );

      const trimmed: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [endsASecondEarly, startsOnTheMinute],
      );

      expect(eventsOf(trimmed)).toEqual([endsASecondEarly, startsOnTheMinute]);
      expectFullWidth(styleOf(trimmed, endsASecondEarly));
      expectFullWidth(styleOf(trimmed, startsOnTheMinute));

      // The grid floors to whole minutes, so at most one minute separates them.
      const seam: number =
        styleOf(trimmed, startsOnTheMinute).top -
        bottomOf(styleOf(trimmed, endsASecondEarly));
      expect(seam).toBeGreaterThanOrEqual(0);
      expect(seam).toBeLessThanOrEqual(ONE_MINUTE_PERCENT + EPSILON);
    });

    test("a short block followed within half an hour by the next shift stays full width", () => {
      /*
       * react-big-calendar's "overlap" layout put these two side by side
       * because they START within 30 minutes of each other (see the contrast
       * tests at the bottom of this file).
       */
      const short: CalendarEvent = block(
        "Ten minutes",
        "2026-09-12 09:30",
        "2026-09-12 09:40",
      );
      const long: CalendarEvent = block(
        "Rest of the day",
        "2026-09-12 09:40",
        "2026-09-12 17:02",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [long, short],
      );

      expect(eventsOf(layout)).toEqual([short, long]);
      expectBackToBack(layout);
      expect(styleOf(layout, long).top).toBeCloseTo(
        percentOfDay(9, 40),
        PRECISION,
      );
    });

    test("a whole day of hand-offs tiles the column from top to bottom", () => {
      const events: Array<CalendarEvent> = [
        block("Previous night", "2026-09-11 18:00", "2026-09-12 00:00"),
        block("Night", "2026-09-12 00:00", "2026-09-12 06:00"),
        block("Early", "2026-09-12 06:00", "2026-09-12 09:30"),
        block("Cover", "2026-09-12 09:30", "2026-09-12 09:40"),
        block("Day", "2026-09-12 09:40", "2026-09-12 17:02"),
        block("Evening", "2026-09-12 17:02", "2026-09-13 00:00"),
        block("Next night", "2026-09-13 00:00", "2026-09-13 06:00"),
      ];

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        events,
      );

      expect(
        layout.map((styled: StyledDayEvent<CalendarEvent>): string => {
          return styled.event.title;
        }),
      ).toEqual(["Night", "Early", "Cover", "Day", "Evening"]);

      expectBackToBack(layout);

      const first: StyledDayEvent<CalendarEvent> | undefined = layout[0];
      const last: StyledDayEvent<CalendarEvent> | undefined =
        layout[layout.length - 1];
      expect(first?.style.top).toBe(0);
      expect(last ? bottomOf(last.style) : undefined).toBeCloseTo(
        END_OF_DAY_PERCENT,
        PRECISION,
      );
    });
  });

  describe("blocks that really overlap", () => {
    test("two people on call at the same time split the column 50/50", () => {
      const alice: CalendarEvent = block(
        "Alice",
        "2026-09-12 09:00",
        "2026-09-12 12:00",
      );
      const bob: CalendarEvent = block(
        "Bob",
        "2026-09-12 09:00",
        "2026-09-12 12:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [alice, bob],
      );

      expect(styleOf(layout, alice)).toEqual({
        top: percentOfDay(9),
        height: percentOfDay(12) - percentOfDay(9),
        width: 50,
        xOffset: 0,
      });
      expect(styleOf(layout, bob).width).toBe(50);
      expect(styleOf(layout, bob).xOffset).toBe(50);
      expect(styleOf(layout, bob).top).toBeCloseTo(percentOfDay(9), PRECISION);
      expectNoBlockCoversAnother(layout);
    });

    test("a block inside a longer one sits beside it, and both narrow", () => {
      const long: CalendarEvent = block(
        "All day",
        "2026-09-12 09:00",
        "2026-09-12 17:00",
      );
      const inside: CalendarEvent = block(
        "Lunch cover",
        "2026-09-12 12:00",
        "2026-09-12 13:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [inside, long],
      );

      expect(eventsOf(layout)).toEqual([long, inside]);
      expect(styleOf(layout, long).width).toBe(50);
      expect(styleOf(layout, long).xOffset).toBe(0);
      expect(styleOf(layout, inside).width).toBe(50);
      expect(styleOf(layout, inside).xOffset).toBe(50);
      expectNoBlockCoversAnother(layout);
    });

    test("a block that starts as another ends reuses its lane instead of opening a third", () => {
      const long: CalendarEvent = block(
        "Long",
        "2026-09-12 08:00",
        "2026-09-12 12:00",
      );
      const firstCover: CalendarEvent = block(
        "First cover",
        "2026-09-12 08:00",
        "2026-09-12 10:00",
      );
      const secondCover: CalendarEvent = block(
        "Second cover",
        "2026-09-12 10:00",
        "2026-09-12 11:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [secondCover, firstCover, long],
      );

      expect(styleOf(layout, long).width).toBe(50);
      expect(styleOf(layout, long).xOffset).toBe(0);
      expect(styleOf(layout, firstCover).width).toBe(50);
      expect(styleOf(layout, firstCover).xOffset).toBe(50);
      expect(styleOf(layout, secondCover).width).toBe(50);
      expect(styleOf(layout, secondCover).xOffset).toBe(50);
      expect(styleOf(layout, secondCover).top).toBeCloseTo(
        bottomOf(styleOf(layout, firstCover)),
        PRECISION,
      );
      expectNoBlockCoversAnother(layout);
    });

    test("a block widens into lanes to its right that stay free while it runs", () => {
      /*
       * Three lanes are needed at 8:30 AM. From 10:00 AM only the long block
       * is still running, so the blocks that reuse lane 1 later may take lane
       * 2 as well. That includes the 10:00 AM block, which starts exactly as
       * lane 2's block ends: a hand-off, not an overlap. The long block in
       * lane 0 shares time with lane 1 and so stays one lane wide.
       */
      const long: CalendarEvent = block(
        "Long",
        "2026-09-12 08:00",
        "2026-09-12 18:00",
      );
      const early: CalendarEvent = block(
        "Early",
        "2026-09-12 08:00",
        "2026-09-12 09:00",
      );
      const overlapping: CalendarEvent = block(
        "Overlapping",
        "2026-09-12 08:30",
        "2026-09-12 10:00",
      );
      const handOff: CalendarEvent = block(
        "Picks up at ten",
        "2026-09-12 10:00",
        "2026-09-12 11:00",
      );
      const noon: CalendarEvent = block(
        "Noon",
        "2026-09-12 12:00",
        "2026-09-12 13:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [noon, handOff, overlapping, early, long],
      );

      const third: number = 100 / 3;

      expect(styleOf(layout, long).xOffset).toBe(0);
      expect(styleOf(layout, long).width).toBeCloseTo(third, PRECISION);

      expect(styleOf(layout, early).xOffset).toBeCloseTo(third, PRECISION);
      expect(styleOf(layout, early).width).toBeCloseTo(third, PRECISION);

      expect(styleOf(layout, overlapping).xOffset).toBeCloseTo(
        2 * third,
        PRECISION,
      );
      expect(styleOf(layout, overlapping).width).toBeCloseTo(third, PRECISION);

      expect(styleOf(layout, handOff).xOffset).toBeCloseTo(third, PRECISION);
      expect(styleOf(layout, handOff).width).toBeCloseTo(2 * third, PRECISION);

      expect(styleOf(layout, noon).xOffset).toBeCloseTo(third, PRECISION);
      expect(styleOf(layout, noon).width).toBeCloseTo(2 * third, PRECISION);

      expectNoBlockCoversAnother(layout);
    });

    test("a widening block stops at the first lane to its right that is busy, even when a nearer lane is free", () => {
      /*
       * Two people cover 8 to 9 AM while an override runs from 8:30 AM to
       * noon, so the override takes lane 2. The 10 AM block reuses lane 0 and
       * may spread over lane 1, which is free by then, but it must stop short
       * of lane 2: widening all the way would draw it over the override, and
       * the override's person would vanish from 10 to 11 AM.
       */
      const coverA: CalendarEvent = block(
        "Cover A",
        "2026-09-12 08:00",
        "2026-09-12 09:00",
      );
      const coverB: CalendarEvent = block(
        "Cover B",
        "2026-09-12 08:00",
        "2026-09-12 09:00",
      );
      const override: CalendarEvent = block(
        "Override",
        "2026-09-12 08:30",
        "2026-09-12 12:00",
      );
      const later: CalendarEvent = block(
        "Ten o'clock",
        "2026-09-12 10:00",
        "2026-09-12 11:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [later, override, coverB, coverA],
      );

      const third: number = 100 / 3;

      expect(styleOf(layout, override).xOffset).toBeCloseTo(
        2 * third,
        PRECISION,
      );
      expect(styleOf(layout, override).width).toBeCloseTo(third, PRECISION);

      expect(styleOf(layout, later).xOffset).toBe(0);
      expect(styleOf(layout, later).width).toBeCloseTo(2 * third, PRECISION);

      expectNoBlockCoversAnother(layout);
    });

    test("a busier overlap that starts as an earlier one ends does not narrow the earlier one", () => {
      /*
       * Two people overlap until noon, then three from noon. Sharing one set
       * of lanes would squeeze the morning pair into thirds of the column for
       * the whole morning.
       */
      const morningA: CalendarEvent = block(
        "Morning A",
        "2026-09-12 09:00",
        "2026-09-12 12:00",
      );
      const morningB: CalendarEvent = block(
        "Morning B",
        "2026-09-12 10:00",
        "2026-09-12 12:00",
      );
      const noonTrio: Array<CalendarEvent> = [
        block("Noon A", "2026-09-12 12:00", "2026-09-12 13:00"),
        block("Noon B", "2026-09-12 12:00", "2026-09-12 13:00"),
        block("Noon C", "2026-09-12 12:00", "2026-09-12 13:00"),
      ];

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [...noonTrio, morningB, morningA],
      );

      expect(styleOf(layout, morningA)).toMatchObject({
        width: 50,
        xOffset: 0,
      });
      expect(styleOf(layout, morningB)).toMatchObject({
        width: 50,
        xOffset: 50,
      });

      noonTrio.forEach((event: CalendarEvent, lane: number) => {
        const style: DayEventStyle = styleOf(layout, event);
        expect(style.width).toBeCloseTo(100 / 3, PRECISION);
        expect(style.xOffset).toBeCloseTo((lane * 100) / 3, PRECISION);
      });
      expectNoBlockCoversAnother(layout);
    });

    test("lanes are shared only within a chain of overlaps: a morning overlap does not narrow the evening", () => {
      const morningA: CalendarEvent = block(
        "Morning A",
        "2026-09-12 09:00",
        "2026-09-12 11:00",
      );
      const morningB: CalendarEvent = block(
        "Morning B",
        "2026-09-12 10:00",
        "2026-09-12 12:00",
      );
      // Overlaps only Morning B, but joins the same cluster through it.
      const midday: CalendarEvent = block(
        "Midday",
        "2026-09-12 11:30",
        "2026-09-12 13:00",
      );
      const afternoon: CalendarEvent = block(
        "Afternoon",
        "2026-09-12 13:00",
        "2026-09-12 17:02",
      );
      const evening: CalendarEvent = block(
        "Evening",
        "2026-09-12 17:02",
        "2026-09-12 23:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [evening, afternoon, midday, morningB, morningA],
      );

      expect(styleOf(layout, morningA)).toMatchObject({
        width: 50,
        xOffset: 0,
      });
      expect(styleOf(layout, morningB)).toMatchObject({
        width: 50,
        xOffset: 50,
      });
      // Morning A's lane is free again at 11:30, so Midday reuses it.
      expect(styleOf(layout, midday)).toMatchObject({
        width: 50,
        xOffset: 0,
      });

      expectFullWidth(styleOf(layout, afternoon));
      expectFullWidth(styleOf(layout, evening));
      expect(styleOf(layout, afternoon).top).toBeCloseTo(
        bottomOf(styleOf(layout, midday)),
        PRECISION,
      );
      expect(styleOf(layout, evening).top).toBeCloseTo(
        bottomOf(styleOf(layout, afternoon)),
        PRECISION,
      );
      expectNoBlockCoversAnother(layout);
    });
  });

  describe("a block spanning several days", () => {
    const multiDay: CalendarEvent = block(
      "Long weekend",
      "2026-09-24 18:00",
      "2026-09-26 06:00",
    );

    test("fills the whole of a day it runs through, and only its own part of the first and last day", () => {
      const middle: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-25",
        [multiDay],
      );
      expect(
        isSpilloverSliver(multiDay, slotMetricsFor("2026-09-25"), accessors),
      ).toBe(false);
      expectFullWidth(styleOf(middle, multiDay));
      expect(styleOf(middle, multiDay).top).toBe(0);
      expect(styleOf(middle, multiDay).height).toBeCloseTo(
        END_OF_DAY_PERCENT,
        PRECISION,
      );

      const first: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-24",
        [multiDay],
      );
      expect(styleOf(first, multiDay).top).toBeCloseTo(
        percentOfDay(18),
        PRECISION,
      );
      expect(bottomOf(styleOf(first, multiDay))).toBeCloseTo(
        END_OF_DAY_PERCENT,
        PRECISION,
      );

      const last: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-26",
        [multiDay],
      );
      expect(styleOf(last, multiDay).top).toBe(0);
      expect(bottomOf(styleOf(last, multiDay))).toBeCloseTo(
        percentOfDay(6),
        PRECISION,
      );
    });

    test("shares a day with a concurrent block like any other overlap", () => {
      const concurrent: CalendarEvent = block(
        "Friday cover",
        "2026-09-25 09:00",
        "2026-09-25 10:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-25",
        [concurrent, multiDay],
      );

      expect(eventsOf(layout)).toEqual([multiDay, concurrent]);
      expect(styleOf(layout, multiDay)).toMatchObject({
        top: 0,
        width: 50,
        xOffset: 0,
      });
      expect(styleOf(layout, concurrent)).toMatchObject({
        width: 50,
        xOffset: 50,
      });
      expectNoBlockCoversAnother(layout);
    });
  });

  describe("uncovered bands (background events)", () => {
    test("title-less bands are laid out like blocks, and a band ending at the column's midnight is dropped", () => {
      const endsAtMidnight: CalendarEvent = uncovered(
        0,
        "2026-09-25 22:00",
        "2026-09-26 00:00",
      );
      const afternoon: CalendarEvent = uncovered(
        1,
        "2026-09-26 13:00",
        "2026-09-26 14:00",
      );
      const overnight: CalendarEvent = uncovered(
        2,
        "2026-09-26 22:00",
        "2026-09-27 06:00",
      );
      const bands: Array<CalendarEvent> = [
        overnight,
        afternoon,
        endsAtMidnight,
      ];

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-26",
        bands,
      );

      expect(eventsOf(layout)).toEqual([afternoon, overnight]);
      expectFullWidth(styleOf(layout, afternoon));
      expectFullWidth(styleOf(layout, overnight));
      expect(styleOf(layout, afternoon).top).toBeCloseTo(
        percentOfDay(13),
        PRECISION,
      );
      expect(styleOf(layout, overnight).top).toBeCloseTo(
        percentOfDay(22),
        PRECISION,
      );
      expect(bottomOf(styleOf(layout, overnight))).toBeCloseTo(
        END_OF_DAY_PERCENT,
        PRECISION,
      );

      // The overnight band continues at the top of Sunday.
      const sunday: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-27",
        bands,
      );
      expect(eventsOf(sunday)).toEqual([overnight]);
      expect(styleOf(sunday, overnight).top).toBe(0);
    });
  });

  describe("what the layout returns", () => {
    test("lists blocks earliest first, the longer of a tie first, so a later block paints over an earlier one", () => {
      /*
       * A short block's minimum height can overhang the start of the next
       * block. Painting the next block later puts it on top, where it really
       * starts.
       */
      const evening: CalendarEvent = block(
        "Evening",
        "2026-09-12 17:02",
        "2026-09-12 23:00",
      );
      const shortAtNine: CalendarEvent = block(
        "Short at nine",
        "2026-09-12 09:00",
        "2026-09-12 09:10",
      );
      const longAtNine: CalendarEvent = block(
        "Long at nine",
        "2026-09-12 09:00",
        "2026-09-12 12:00",
      );
      const night: CalendarEvent = block(
        "Night",
        "2026-09-12 00:00",
        "2026-09-12 06:00",
      );
      const afterShort: CalendarEvent = block(
        "After the short one",
        "2026-09-12 09:10",
        "2026-09-12 09:20",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
        "2026-09-12",
        [evening, afterShort, shortAtNine, night, longAtNine],
      );

      expect(eventsOf(layout)).toEqual([
        night,
        longAtNine,
        shortAtNine,
        afterShort,
        evening,
      ]);
    });

    test("returns the caller's own event objects and leaves the input alone", () => {
      /*
       * Calendar.tsx tells uncovered bands from shifts by object identity
       * (a Set of the background events), so the layout must hand back the
       * very objects it was given.
       */
      const later: CalendarEvent = block(
        "Later",
        "2026-09-12 12:00",
        "2026-09-12 17:02",
      );
      const earlier: CalendarEvent = block(
        "Earlier",
        "2026-09-12 06:00",
        "2026-09-12 12:00",
      );
      const events: Array<CalendarEvent> = [later, earlier];
      const snapshot: Array<CalendarEvent> = events.map(
        (event: CalendarEvent): CalendarEvent => {
          return {
            ...event,
            start: new Date(event.start),
            end: new Date(event.end),
          };
        },
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = layoutDayEvents({
        events,
        slotMetrics: slotMetricsFor("2026-09-12"),
        accessors,
      });

      expect(layout[0]?.event).toBe(earlier);
      expect(layout[1]?.event).toBe(later);
      expect(events[0]).toBe(later);
      expect(events[1]).toBe(earlier);
      expect(events).toEqual(snapshot);
    });

    test("returns numbers, which react-big-calendar turns into percentages itself", () => {
      const event: CalendarEvent = block(
        "Shift",
        "2026-09-12 06:00",
        "2026-09-12 12:00",
      );

      const style: DayEventStyle = styleOf(
        layoutColumn("2026-09-12", [event]),
        event,
      );

      expect(Object.keys(style).sort()).toEqual([
        "height",
        "top",
        "width",
        "xOffset",
      ]);
      for (const value of Object.values(style)) {
        expect(typeof value).toBe("number");
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(style).toEqual({
        top: 25,
        height: 25,
        width: 100,
        xOffset: 0,
      });
    });

    test("an empty column lays out nothing", () => {
      expect(layoutColumn("2026-09-12", [])).toEqual([]);
    });
  });

  describe("react-big-calendar's own 'overlap' layout, used before this change (for contrast)", () => {
    /*
     * These pin the reported failures on the layout the calendar used to
     * use, so the scenarios above are the real bugs and not strawmen. If a
     * react-big-calendar upgrade changes these, the reasons given in
     * CalendarDayLayout.ts need revisiting.
     */
    test("drew the Friday block in Saturday's column and squeezed the Saturday block", () => {
      const friday: CalendarEvent = block(
        "Friday evening",
        "2026-09-25 19:26",
        "2026-09-26 00:00",
      );
      const saturday: CalendarEvent = block(
        "Saturday morning",
        "2026-09-26 00:00",
        "2026-09-26 08:00",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = rbcOverlapColumn(
        "2026-09-26",
        [friday, saturday],
      );

      expect(eventsOf(layout)).toContain(friday);
      expect(styleOf(layout, saturday).width).toBeLessThan(100);
      expect(styleOf(layout, friday).xOffset).toBeGreaterThan(0);
    });

    test("put a 10-minute block and the shift after it side by side", () => {
      const short: CalendarEvent = block(
        "Ten minutes",
        "2026-09-12 09:30",
        "2026-09-12 09:40",
      );
      const long: CalendarEvent = block(
        "Rest of the day",
        "2026-09-12 09:40",
        "2026-09-12 17:02",
      );

      const layout: Array<StyledDayEvent<CalendarEvent>> = rbcOverlapColumn(
        "2026-09-12",
        [short, long],
      );

      expect(styleOf(layout, long).xOffset).toBeGreaterThan(0);
      expect(styleOf(layout, long).width).toBeLessThan(100);
    });
  });
});
