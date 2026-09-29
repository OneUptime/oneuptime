/** @timezone America/New_York */

/*
 * The week and day views on the two days a year a New York day is not 24 hours
 * long.
 *
 * react-big-calendar places blocks by wall-clock minute and always draws the
 * time gutter as a 24-hour day, but the stock moment localizer sized a DST
 * day's column in real minutes: 23 or 25 hour rows. So on those days the
 * blocks drifted up to about 50 minutes away from the gutter's hour labels,
 * and on the 23-hour day everything after 11 PM was clamped to the bottom
 * edge, so a hand-off at 11 PM fell off the column. Calendar.tsx's
 * calendarLocalizer sizes every column in wall-clock minutes instead. This
 * checks, on the 23-hour and 25-hour days, that:
 *
 *  - the column has 24 hour rows, like the gutter and every other day, and a
 *    block sits at its wall-clock position (noon halfway down, 11 PM at 23/24);
 *  - a block ending at the next midnight is still dropped from the next day's
 *    column (the 26 Sep sliver bug), and still drawn to the bottom of its own;
 *  - a block ending at the DST day's opening midnight is dropped from the DST
 *    day and kept in the day before;
 *  - a day of back-to-back hand-offs, including one across the missing or
 *    repeated hour, still tiles the column without gaps, overlaps or lanes.
 *
 * As in CalendarDayLayout.test.ts, positions come from react-big-calendar's
 * real slot metrics, built the way DayColumn builds them, with the calendar's
 * own localizer. The timezone pragma is per file, which is why this is
 * separate from the UTC tests.
 */

import CalendarEvent from "../../../../Types/Calendar/CalendarEvent";
import { calendarLocalizer } from "../../../../UI/Components/Calendar/Calendar";
import {
  DayEventAccessors,
  DayEventStyle,
  DaySlotMetrics,
  DaySlotRange,
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

// The layout's view of the slot metrics, plus the hour rows the column draws.
interface ColumnSlotMetrics extends DaySlotMetrics {
  groups: Array<Array<Date>>;
}

// react-big-calendar/lib/utils/TimeSlots ships no types. This is the one export used here.
interface TimeSlotsModule {
  getSlotMetrics: (options: SlotMetricsOptions) => ColumnSlotMetrics;
}

const timeSlots: TimeSlotsModule = jest.requireActual(
  "react-big-calendar/lib/utils/TimeSlots",
) as TimeSlotsModule;

/*
 * A plain moment localizer, as the calendar used before calendarLocalizer.
 * Only the contrast test at the bottom uses it, to show why Calendar.tsx
 * overrides getTotalMin.
 */
const stockLocalizer: DateLocalizer = momentLocalizer(moment);

const STEP_MINUTES: number = 30;
const TIMESLOTS_PER_GROUP: number = 2;

const MINUTES_PER_DAY: number = 24 * 60;

// Where a wall-clock time sits in a 24-hour column, as a percentage of its height.
const percentOfDay: (hours: number, minutes?: number) => number = (
  hours: number,
  minutes: number = 0,
): number => {
  return ((hours * 60 + minutes) / MINUTES_PER_DAY) * 100;
};

/*
 * react-big-calendar's column ends at 23:59:59, and it positions whole minutes,
 * so a block running to midnight stops at the top of the last minute.
 */
const END_OF_DAY_PERCENT: number = percentOfDay(23, 59);

// Positions are floating-point percentages; this is far below a pixel.
const PRECISION: number = 9;

const accessors: DayEventAccessors<CalendarEvent> = {
  start: (event: CalendarEvent): Date => {
    return event.start;
  },
  end: (event: CalendarEvent): Date => {
    return event.end;
  },
};

/*
 * A wall-clock time in New York. None of the times used here fall in the
 * skipped or repeated hour, so each names exactly one instant.
 */
const at: (wallClock: string) => Date = (wallClock: string): Date => {
  const parsed: moment.Moment = moment(wallClock, "YYYY-MM-DD HH:mm", true);

  if (!parsed.isValid()) {
    throw new Error(`Not a wall-clock time: ${wallClock}`);
  }

  return parsed.toDate();
};

let nextEventId: number = 1;

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
) => ColumnSlotMetrics = (
  day: string,
  localizer: DateLocalizer = calendarLocalizer,
): ColumnSlotMetrics => {
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

// TimeGrid hands a column every event whose start..end touches its date, inclusively.
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
 * Full width, positive height, each block starting where the one before ends.
 * It needs at least one hand-off to check, so a layout that lost a block
 * cannot pass it by default.
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

interface DstDay {
  description: string;
  previousDay: string;
  day: string;
  nextDay: string;
  hoursLong: number;
  // Hand-off times through the day, one of them across the DST change.
  handOffs: Array<string>;
}

const DST_DAYS: Array<DstDay> = [
  {
    description: "2026-03-08, the 23-hour day (2:00 AM does not exist)",
    previousDay: "2026-03-07",
    day: "2026-03-08",
    nextDay: "2026-03-09",
    hoursLong: 23,
    handOffs: ["00:00", "01:30", "03:30", "12:00", "18:00"],
  },
  {
    description: "2026-11-01, the 25-hour day (1:00 AM happens twice)",
    previousDay: "2026-10-31",
    day: "2026-11-01",
    nextDay: "2026-11-02",
    hoursLong: 25,
    handOffs: ["00:00", "00:30", "03:00", "12:00", "18:00"],
  },
];

// Where an "HH:mm" wall-clock time sits in a 24-hour column.
const percentOfTime: (time: string) => number = (time: string): number => {
  const [hours, minutes] = time.split(":").map((part: string): number => {
    return Number(part);
  });

  if (hours === undefined || minutes === undefined) {
    throw new Error(`Not an HH:mm time: ${time}`);
  }

  return percentOfDay(hours, minutes);
};

describe("CalendarDayLayout on DST days in America/New_York", () => {
  for (const dstDay of DST_DAYS) {
    const { previousDay, day, nextDay } = dstDay;

    describe(dstDay.description, () => {
      test("really is a DST day in the pinned process timezone", () => {
        // Guards against the pragma being ignored, which would make every test below vacuous.
        const hours: number =
          (columnDate(nextDay).getTime() - columnDate(day).getTime()) /
          (60 * 60 * 1000);

        expect(hours).toBe(dstDay.hoursLong);
      });

      test("the column has 24 hour rows, like the time gutter and the days around it", () => {
        expect(slotMetricsFor(day).groups.length).toBe(24);
        expect(slotMetricsFor(previousDay).groups.length).toBe(24);
        expect(slotMetricsFor(nextDay).groups.length).toBe(24);
      });

      test("a noon block sits exactly halfway down the column, as it does the day after", () => {
        for (const column of [day, nextDay]) {
          const noon: CalendarEvent = block(
            "Noon",
            `${column} 12:00`,
            `${column} 13:00`,
          );
          const style: DayEventStyle = styleOf(
            layoutColumn(column, [noon]),
            noon,
          );

          expect(style.top).toBe(50);
          expect(bottomOf(style)).toBeCloseTo(percentOfDay(13), PRECISION);
        }
      });

      test("a hand-off at 11 PM sits in the column's last hour row, and the overnight block after it is kept", () => {
        /*
         * On the 23-hour day this block used to be clamped to the bottom edge
         * with no height, so the 11 PM hand-off fell off the column.
         */
        const late: CalendarEvent = block(
          "Late",
          `${day} 22:00`,
          `${day} 23:00`,
        );
        const overnight: CalendarEvent = block(
          "Overnight",
          `${day} 23:00`,
          `${nextDay} 07:00`,
        );

        expect(
          isSpilloverSliver(overnight, slotMetricsFor(day), accessors),
        ).toBe(false);

        const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(day, [
          overnight,
          late,
        ]);

        expect(eventsOf(layout)).toEqual([late, overnight]);
        expectBackToBack(layout);
        expect(styleOf(layout, late).top).toBeCloseTo(
          percentOfDay(22),
          PRECISION,
        );
        expect(styleOf(layout, overnight).top).toBeCloseTo(
          (23 / 24) * 100,
          PRECISION,
        );
        expect(bottomOf(styleOf(layout, overnight))).toBeCloseTo(
          END_OF_DAY_PERCENT,
          PRECISION,
        );

        // The rest of it is drawn from the top of the next day.
        const nextColumn: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          nextDay,
          [overnight],
        );
        expect(styleOf(nextColumn, overnight).top).toBe(0);
        expect(bottomOf(styleOf(nextColumn, overnight))).toBeCloseTo(
          percentOfDay(7),
          PRECISION,
        );
      });

      test("a block ending at the next midnight is dropped from the next day's column", () => {
        const evening: CalendarEvent = block(
          "Evening",
          `${day} 18:00`,
          `${nextDay} 00:00`,
        );
        const nextMorning: CalendarEvent = block(
          "Next morning",
          `${nextDay} 00:00`,
          `${nextDay} 08:00`,
        );
        const events: Array<CalendarEvent> = [evening, nextMorning];

        // react-big-calendar still hands the evening block to the next day.
        expect(eventsHandedToColumn(nextDay, events)).toContain(evening);
        expect(
          isSpilloverSliver(evening, slotMetricsFor(nextDay), accessors),
        ).toBe(true);

        const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          nextDay,
          events,
        );

        expect(eventsOf(layout)).toEqual([nextMorning]);
        expectFullWidth(styleOf(layout, nextMorning));
        expect(styleOf(layout, nextMorning).top).toBe(0);
      });

      test("a block ending at the next midnight is kept in the DST day, from its wall-clock start to the bottom of the column", () => {
        const evening: CalendarEvent = block(
          "Evening",
          `${day} 18:00`,
          `${nextDay} 00:00`,
        );

        expect(isSpilloverSliver(evening, slotMetricsFor(day), accessors)).toBe(
          false,
        );

        const style: DayEventStyle = styleOf(
          layoutColumn(day, [evening]),
          evening,
        );

        /*
         * Where it would be on any other day. With 23 or 25 hour rows, 6 PM
         * was drawn about half an hour off, and on the 25-hour day the
         * column's last hour was left empty below the block.
         */
        expectFullWidth(style);
        expect(style.top).toBeCloseTo(75, PRECISION);
        expect(bottomOf(style)).toBeCloseTo(END_OF_DAY_PERCENT, PRECISION);
      });

      test("a block ending at the DST day's opening midnight stays in the day before and is dropped from the DST day", () => {
        const previousEvening: CalendarEvent = block(
          "Previous evening",
          `${previousDay} 18:00`,
          `${day} 00:00`,
        );
        const earlyMorning: CalendarEvent = block(
          "Early morning",
          `${day} 00:00`,
          `${day} 06:00`,
        );
        const events: Array<CalendarEvent> = [previousEvening, earlyMorning];

        expect(
          isSpilloverSliver(previousEvening, slotMetricsFor(day), accessors),
        ).toBe(true);

        const dstColumn: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          day,
          events,
        );
        expect(eventsOf(dstColumn)).toEqual([earlyMorning]);
        expectFullWidth(styleOf(dstColumn, earlyMorning));
        expect(styleOf(dstColumn, earlyMorning).top).toBe(0);

        const dayBefore: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          previousDay,
          events,
        );
        expect(eventsOf(dayBefore)).toEqual([previousEvening]);
        expectFullWidth(styleOf(dayBefore, previousEvening));
        expect(styleOf(dayBefore, previousEvening).top).toBeCloseTo(
          75,
          PRECISION,
        );
      });

      test("a midnight-to-midnight daily rotation draws one full-height block per day", () => {
        const shifts: Array<CalendarEvent> = [
          block("Day before", `${previousDay} 00:00`, `${day} 00:00`),
          block("DST day", `${day} 00:00`, `${nextDay} 00:00`),
          block("Day after", `${nextDay} 00:00`, `${nextDay} 23:00`),
        ];
        const [dayBeforeShift, dstShift, dayAfterShift] = shifts;

        if (!dayBeforeShift || !dstShift || !dayAfterShift) {
          throw new Error("Missing shift");
        }

        const dstColumn: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          day,
          shifts,
        );
        expect(eventsOf(dstColumn)).toEqual([dstShift]);
        expectFullWidth(styleOf(dstColumn, dstShift));
        expect(styleOf(dstColumn, dstShift).top).toBe(0);
        expect(bottomOf(styleOf(dstColumn, dstShift))).toBeCloseTo(
          END_OF_DAY_PERCENT,
          PRECISION,
        );

        const nextColumn: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          nextDay,
          shifts,
        );
        expect(eventsOf(nextColumn)).toEqual([dayAfterShift]);
        expectFullWidth(styleOf(nextColumn, dayAfterShift));
      });

      test("back-to-back hand-offs, one across the DST change, tile the column at their wall-clock times, without gaps, overlaps or lanes", () => {
        const times: Array<string> = dstDay.handOffs.map(
          (time: string): string => {
            return `${day} ${time}`;
          },
        );
        times.push(`${nextDay} 00:00`);

        const shifts: Array<CalendarEvent> = [
          block("From the day before", `${previousDay} 18:00`, `${day} 00:00`),
        ];

        for (let index: number = 0; index < times.length - 1; index++) {
          const start: string | undefined = times[index];
          const end: string | undefined = times[index + 1];

          if (!start || !end) {
            throw new Error("Missing hand-off time");
          }

          shifts.push(block(`Shift ${index + 1}`, start, end));
        }

        shifts.push(
          block("Into the day after", `${nextDay} 00:00`, `${nextDay} 06:00`),
        );

        const layout: Array<StyledDayEvent<CalendarEvent>> = layoutColumn(
          day,
          [...shifts].reverse(),
        );

        expect(
          layout.map((styled: StyledDayEvent<CalendarEvent>): string => {
            return styled.event.title;
          }),
        ).toEqual(["Shift 1", "Shift 2", "Shift 3", "Shift 4", "Shift 5"]);

        expectBackToBack(layout);

        // Each hand-off lines up with the gutter's label for that time.
        layout.forEach(
          (styled: StyledDayEvent<CalendarEvent>, index: number): void => {
            const handOff: string | undefined = dstDay.handOffs[index];

            if (!handOff) {
              throw new Error(`No hand-off for ${styled.event.title}`);
            }

            expect(styled.style.top).toBeCloseTo(
              percentOfTime(handOff),
              PRECISION,
            );
          },
        );

        const last: StyledDayEvent<CalendarEvent> | undefined =
          layout[layout.length - 1];
        expect(last ? bottomOf(last.style) : undefined).toBeCloseTo(
          END_OF_DAY_PERCENT,
          PRECISION,
        );
      });
    });
  }

  describe("react-big-calendar's stock moment localizer (for contrast)", () => {
    /*
     * Why Calendar.tsx overrides getTotalMin. The stock localizer sizes a
     * column in real minutes but places blocks by wall-clock minute, so a DST
     * day gets 23 or 25 hour rows while the gutter shows 24. If a
     * react-big-calendar upgrade changes these, the override may no longer be
     * needed.
     */
    test("gives the DST days 23 and 25 hour rows", () => {
      expect(slotMetricsFor("2026-03-08", stockLocalizer).groups.length).toBe(
        23,
      );
      expect(slotMetricsFor("2026-11-01", stockLocalizer).groups.length).toBe(
        25,
      );
      expect(slotMetricsFor("2026-03-09", stockLocalizer).groups.length).toBe(
        24,
      );
    });

    test("pushes noon down the 23-hour column and clamps an 11 PM hand-off to its bottom edge", () => {
      const metrics: ColumnSlotMetrics = slotMetricsFor(
        "2026-03-08",
        stockLocalizer,
      );

      // Noon is 720 wall-clock minutes into a column only 1380 minutes tall.
      expect(
        metrics.getRange(at("2026-03-08 12:00"), at("2026-03-08 13:00")).top,
      ).toBeCloseTo((720 / 1380) * 100, PRECISION);

      const overnight: DaySlotRange = metrics.getRange(
        at("2026-03-08 23:00"),
        at("2026-03-09 07:00"),
      );
      expect(overnight.top).toBe(100);
      expect(overnight.height).toBe(0);
    });
  });
});
