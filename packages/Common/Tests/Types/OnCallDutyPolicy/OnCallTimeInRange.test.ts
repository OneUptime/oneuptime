import {
  OnCallStint,
  OnCallTimeRange,
  getMinutesOnCallInRange,
  getOnCallStretchesInRange,
} from "../../../Types/OnCallDutyPolicy/OnCallTimeInRange";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * USER ON-CALL TIME'S ARITHMETIC (On-Call → Reports): how long a person was
 * on call in a range, from their time logs' stints.
 *
 *   - a stint counts only inside the range, cut at its start and end;
 *   - REGRESSION #11023: a stint that ended before the range counts
 *     nothing. The report cut it to a period ending before it starts and
 *     counted that period's length: a week of on-call ninety days before a
 *     month's range made the month ninety days long. Every time log a
 *     deleted policy had left open became such a stint when it was ended;
 *   - a stint still going on counts up to now, never past the range;
 *   - stints that overlap count once (on call through two policies);
 *   - drawn from the shared seeded generator, any stints count exactly the
 *     minutes a minute-by-minute count of the range finds covered.
 */

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

// A fixed "now": 24 November 2026, midnight UTC.
const NOW: Date = new Date(Date.UTC(2026, 10, 24));

// The report's default range: the month before now.
const PAST_MONTH: OnCallTimeRange = {
  startsAt: new Date(NOW.getTime() - 30 * DAY),
  endsAt: NOW,
};

function at(milliseconds: number): Date {
  return new Date(milliseconds);
}

function minutesIn(
  stints: Array<OnCallStint>,
  range: OnCallTimeRange = PAST_MONTH,
  now: Date = NOW,
): number {
  return getMinutesOnCallInRange({ stints, range, now });
}

describe("getMinutesOnCallInRange", () => {
  test("a stint inside the range counts its length", () => {
    const start: number = PAST_MONTH.startsAt.getTime() + 2 * DAY;

    expect(
      minutesIn([{ startsAt: at(start), endsAt: at(start + 7 * DAY) }]),
    ).toBe(7 * 24 * 60);
  });

  test("REGRESSION #11023: a stint that ended before the range starts counts nothing, however long ago", () => {
    const rangeStart: number = PAST_MONTH.startsAt.getTime();

    // A week of on-call that ended ninety days before the month: the report said ninety days.
    expect(
      minutesIn([
        {
          startsAt: at(rangeStart - 97 * DAY),
          endsAt: at(rangeStart - 90 * DAY),
        },
      ]),
    ).toBe(0);

    // Many of them, as a rotation leaves: still nothing.
    const stints: Array<OnCallStint> = [];

    for (let week: number = 2; week < 40; week += 2) {
      stints.push({
        startsAt: at(rangeStart - (week + 1) * 7 * DAY),
        endsAt: at(rangeStart - week * 7 * DAY),
      });
    }

    expect(minutesIn(stints)).toBe(0);

    // Ending exactly as the range starts: nothing either.
    expect(
      minutesIn([{ startsAt: at(rangeStart - DAY), endsAt: at(rangeStart) }]),
    ).toBe(0);
  });

  test("REGRESSION #11023: a log a deleted policy left open, once ended, counts only what was inside the range", () => {
    const rangeStart: number = PAST_MONTH.startsAt.getTime();
    const started: number = rangeStart - 200 * DAY;

    // Left open: on call around the clock, the whole month.
    expect(minutesIn([{ startsAt: at(started), endsAt: null }])).toBe(
      30 * 24 * 60,
    );

    // Ended when its policy was deleted, a hundred days before the month: nothing in it.
    expect(
      minutesIn([
        { startsAt: at(started), endsAt: at(rangeStart - 100 * DAY) },
      ]),
    ).toBe(0);

    // Ended at its own start, the end nothing else could place: nothing, here or anywhere.
    expect(
      minutesIn([{ startsAt: at(started), endsAt: at(started) }], {
        startsAt: at(started - DAY),
        endsAt: NOW,
      }),
    ).toBe(0);

    // Ended ten days into the month: those ten days.
    expect(
      minutesIn([{ startsAt: at(started), endsAt: at(rangeStart + 10 * DAY) }]),
    ).toBe(10 * 24 * 60);
  });

  test("a stint that starts after the range ends counts nothing", () => {
    expect(
      minutesIn([
        {
          startsAt: at(NOW.getTime() + DAY),
          endsAt: at(NOW.getTime() + 2 * DAY),
        },
        { startsAt: at(NOW.getTime() + DAY), endsAt: null },
        // Starting exactly as the range ends.
        { startsAt: NOW, endsAt: at(NOW.getTime() + DAY) },
      ]),
    ).toBe(0);
  });

  test("a stint across either end of the range is cut to it", () => {
    const rangeStart: number = PAST_MONTH.startsAt.getTime();

    expect(
      minutesIn([
        { startsAt: at(rangeStart - 5 * DAY), endsAt: at(rangeStart + DAY) },
      ]),
    ).toBe(24 * 60);

    expect(
      minutesIn([
        {
          startsAt: at(NOW.getTime() - 2 * DAY),
          endsAt: at(NOW.getTime() + 5 * DAY),
        },
      ]),
    ).toBe(2 * 24 * 60);

    // Across both: the whole range.
    expect(
      minutesIn([
        {
          startsAt: at(rangeStart - DAY),
          endsAt: at(NOW.getTime() + DAY),
        },
      ]),
    ).toBe(30 * 24 * 60);
  });

  test("a stint still going on counts up to now, and never past the range", () => {
    const rangeStart: number = PAST_MONTH.startsAt.getTime();

    // Up to now, inside a range that ends later.
    expect(
      minutesIn([{ startsAt: at(NOW.getTime() - 3 * DAY), endsAt: null }], {
        startsAt: PAST_MONTH.startsAt,
        endsAt: at(NOW.getTime() + 7 * DAY),
      }),
    ).toBe(3 * 24 * 60);

    // Up to the range's end, when now is later.
    expect(
      minutesIn([{ startsAt: at(rangeStart), endsAt: undefined }], {
        startsAt: PAST_MONTH.startsAt,
        endsAt: at(rangeStart + DAY),
      }),
    ).toBe(24 * 60);

    // A range wholly after now: nothing has happened in it yet.
    expect(
      minutesIn([{ startsAt: at(rangeStart), endsAt: null }], {
        startsAt: at(NOW.getTime() + DAY),
        endsAt: at(NOW.getTime() + 2 * DAY),
      }),
    ).toBe(0);
  });

  test("time on call through two policies at once counts once", () => {
    const start: number = PAST_MONTH.startsAt.getTime() + DAY;

    expect(
      minutesIn([
        // Policy A: days 1 to 4; policy B: days 3 to 6; and B again inside A's.
        { startsAt: at(start), endsAt: at(start + 3 * DAY) },
        { startsAt: at(start + 2 * DAY), endsAt: at(start + 5 * DAY) },
        { startsAt: at(start + DAY), endsAt: at(start + 2 * DAY) },
      ]),
    ).toBe(5 * 24 * 60);

    // The same stint twice (two queries used to return it twice): once.
    const twice: OnCallStint = {
      startsAt: at(start),
      endsAt: at(start + DAY),
    };

    expect(minutesIn([twice, twice])).toBe(24 * 60);
  });

  test("stints that touch are one stretch; whole minutes of each stretch are counted", () => {
    const start: number = PAST_MONTH.startsAt.getTime() + DAY;

    expect(
      getOnCallStretchesInRange({
        stints: [
          {
            startsAt: at(start + 90 * MINUTE),
            endsAt: at(start + 120 * MINUTE),
          },
          { startsAt: at(start), endsAt: at(start + 90 * MINUTE) },
          {
            startsAt: at(start + 200 * MINUTE),
            endsAt: at(start + 230 * MINUTE),
          },
        ],
        range: PAST_MONTH,
        now: NOW,
      }),
    ).toEqual([
      { startsAt: at(start), endsAt: at(start + 120 * MINUTE) },
      { startsAt: at(start + 200 * MINUTE), endsAt: at(start + 230 * MINUTE) },
    ]);

    // 90 seconds and 90 seconds apart: a minute each, not three in all.
    expect(
      minutesIn([
        { startsAt: at(start), endsAt: at(start + 90 * 1000) },
        {
          startsAt: at(start + 10 * MINUTE),
          endsAt: at(start + 10 * MINUTE + 90 * 1000),
        },
      ]),
    ).toBe(2);
  });

  test("a stint that ends before it starts counts nothing", () => {
    const start: number = PAST_MONTH.startsAt.getTime() + DAY;

    expect(minutesIn([{ startsAt: at(start), endsAt: at(start - DAY) }])).toBe(
      0,
    );
  });

  test("drawn at random, any stints count exactly the minutes of the range they cover", () => {
    const random: SeededRandom = seededRandom(11023);
    // A timeline of 10 hours, by the minute.
    const origin: number = Date.UTC(2026, 0, 1);
    const LENGTH: number = 600;

    for (let round: number = 0; round < 400; round++) {
      const stints: Array<OnCallStint> = [];
      const count: number = random(8);

      for (let index: number = 0; index < count; index++) {
        const from: number = random(LENGTH);
        const isOpen: boolean = random(5) === 0;
        const to: number = from + random(LENGTH - from + 1);

        stints.push({
          startsAt: at(origin + from * MINUTE),
          endsAt: isOpen ? null : at(origin + to * MINUTE),
        });
      }

      const rangeFrom: number = random(LENGTH);
      const rangeTo: number = rangeFrom + random(LENGTH - rangeFrom + 1);
      const nowAt: number = random(LENGTH + 1);

      // Each minute of the range, covered by some stint or not.
      let covered: number = 0;

      for (let minute: number = rangeFrom; minute < rangeTo; minute++) {
        const isCovered: boolean = stints.some(
          (stint: OnCallStint): boolean => {
            const from: number = (stint.startsAt.getTime() - origin) / MINUTE;
            const to: number = stint.endsAt
              ? (stint.endsAt.getTime() - origin) / MINUTE
              : nowAt;

            return from <= minute && minute + 1 <= to;
          },
        );

        if (isCovered) {
          covered++;
        }
      }

      expect(
        minutesIn(
          stints,
          {
            startsAt: at(origin + rangeFrom * MINUTE),
            endsAt: at(origin + rangeTo * MINUTE),
          },
          at(origin + nowAt * MINUTE),
        ),
      ).toBe(covered);

      // The stretches are in order, apart, and inside the range.
      const stretches: Array<OnCallTimeRange> = getOnCallStretchesInRange({
        stints,
        range: {
          startsAt: at(origin + rangeFrom * MINUTE),
          endsAt: at(origin + rangeTo * MINUTE),
        },
        now: at(origin + nowAt * MINUTE),
      });

      stretches.forEach((stretch: OnCallTimeRange, index: number): void => {
        expect(stretch.endsAt.getTime()).toBeGreaterThan(
          stretch.startsAt.getTime(),
        );
        expect(stretch.startsAt.getTime()).toBeGreaterThanOrEqual(
          origin + rangeFrom * MINUTE,
        );
        expect(stretch.endsAt.getTime()).toBeLessThanOrEqual(
          origin + rangeTo * MINUTE,
        );

        if (index > 0) {
          expect(stretch.startsAt.getTime()).toBeGreaterThan(
            stretches[index - 1]!.endsAt.getTime(),
          );
        }
      });
    }
  });
});
