import WorstStatusTimeline from "../../../Utils/Uptime/WorstStatusTimeline";
import Event from "../../../Utils/Uptime/Event";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * WorstStatusTimeline.merge: one timeline out of the events of several
 * monitors - a monitor group's - in the worst status recorded at each
 * instant.
 *
 * Issue #6697: a status page's day bar for a monitor group added up to
 * sixteen and a half hours on one finished day and to nine days on another.
 * The merge it replaced compared each event with the last one it kept and
 * nothing else, so eight monitors Offline over the same day were all kept
 * (eight days of Offline in one day), and an event that started before the
 * last kept event was cut to end before it began, which took time away from
 * the day. These pin what a day of a group is: each instant once, in one
 * status, and never more than the day.
 */

const HOUR_MS: number = 60 * 60 * 1000;
const DAY_MS: number = 24 * HOUR_MS;
const DAY_START: number = Date.parse("2026-11-07T00:00:00.000Z");

interface StatusDefinition {
  id: ObjectID;
  name: string;
  priority: number;
  color: Color;
}

const OPERATIONAL: StatusDefinition = {
  id: new ObjectID("10000000-0000-4000-8000-000000000001"),
  name: "Operational",
  priority: 1,
  color: new Color("#2ab57d"),
};

const DEGRADED: StatusDefinition = {
  id: new ObjectID("10000000-0000-4000-8000-000000000002"),
  name: "Degraded",
  priority: 2,
  color: new Color("#ffbf53"),
};

const OFFLINE: StatusDefinition = {
  id: new ObjectID("10000000-0000-4000-8000-000000000003"),
  name: "Offline",
  priority: 3,
  color: new Color("#fd625e"),
};

// a custom status above Offline in the project's order that a page does not count as down.
const MAINTENANCE: StatusDefinition = {
  id: new ObjectID("10000000-0000-4000-8000-000000000004"),
  name: "Maintenance",
  priority: 4,
  color: new Color("#5b8def"),
};

const ALL_STATUSES: Array<StatusDefinition> = [
  OPERATIONAL,
  DEGRADED,
  OFFLINE,
  MAINTENANCE,
];

function event(
  status: StatusDefinition,
  startMs: number,
  endMs: number,
): Event {
  return {
    startDate: new Date(startMs),
    endDate: new Date(endMs),
    label: status.name,
    priority: status.priority,
    color: status.color,
    eventStatusId: status.id,
  };
}

function at(hours: number): number {
  return DAY_START + hours * HOUR_MS;
}

interface Piece {
  status: string;
  from: number;
  to: number;
}

function pieces(events: Array<Event>): Array<Piece> {
  return events.map((merged: Event): Piece => {
    return {
      status: merged.label,
      from: merged.startDate.getTime(),
      to: merged.endDate.getTime(),
    };
  });
}

// seconds per status name, the way a day's tooltip adds them up.
function secondsByStatus(
  events: Array<Event>,
  dayStart: number = DAY_START,
  dayEnd: number = DAY_START + DAY_MS,
): Record<string, number> {
  // summed in whole milliseconds, so the totals are exact.
  const totalsInMs: Record<string, number> = {};

  for (const merged of events) {
    const from: number = Math.max(merged.startDate.getTime(), dayStart);
    const to: number = Math.min(merged.endDate.getTime(), dayEnd);

    if (to <= from) {
      continue;
    }

    totalsInMs[merged.label] = (totalsInMs[merged.label] || 0) + (to - from);
  }

  const totals: Record<string, number> = {};

  for (const label of Object.keys(totalsInMs)) {
    totals[label] = totalsInMs[label]! / 1000;
  }

  return totals;
}

// adds seconds that are whole milliseconds without a floating point remainder.
function sum(values: Record<string, number>): number {
  const totalInMs: number = Object.values(values).reduce(
    (total: number, value: number) => {
      return total + Math.round(value * 1000);
    },
    0,
  );

  return totalInMs / 1000;
}

/*
 * The reference: for every span between two consecutive starts or ends,
 * look at every event covering it and take the winner by the documented
 * order - O(n^2), with no heap, nothing shared with the implementation.
 */
function referenceMerge(
  events: Array<Event>,
  downtimeIds: Array<string>,
): Array<Piece> {
  const valid: Array<{
    event: Event;
    start: number;
    end: number;
    order: number;
  }> = [];

  events.forEach((candidate: Event, order: number) => {
    const start: number = candidate.startDate.getTime();
    const end: number = candidate.endDate.getTime();

    if (end > start) {
      valid.push({ event: candidate, start, end, order });
    }
  });

  const boundaries: Array<number> = Array.from(
    new Set<number>(
      valid.flatMap((item: { start: number; end: number }) => {
        return [item.start, item.end];
      }),
    ),
  ).sort((a: number, b: number) => {
    return a - b;
  });

  const result: Array<Piece> = [];

  for (let i: number = 0; i < boundaries.length - 1; i++) {
    const from: number = boundaries[i]!;
    const to: number = boundaries[i + 1]!;

    const covering: Array<{
      event: Event;
      start: number;
      end: number;
      order: number;
    }> = valid.filter((item: { start: number; end: number }) => {
      return item.start <= from && item.end >= to;
    });

    if (covering.length === 0) {
      continue;
    }

    covering.sort(
      (
        a: { event: Event; start: number; order: number },
        b: { event: Event; start: number; order: number },
      ): number => {
        const aDown: number = downtimeIds.includes(
          a.event.eventStatusId.toString(),
        )
          ? 1
          : 0;
        const bDown: number = downtimeIds.includes(
          b.event.eventStatusId.toString(),
        )
          ? 1
          : 0;

        return (
          bDown - aDown ||
          b.event.priority - a.event.priority ||
          a.start - b.start ||
          a.order - b.order
        );
      },
    );

    const winner: Event = covering[0]!.event;
    const last: Piece | undefined = result[result.length - 1];

    if (last && last.to === from && last.status === winner.label) {
      last.to = to;
      continue;
    }

    result.push({ status: winner.label, from, to });
  }

  return result;
}

function unionLength(spans: Array<{ from: number; to: number }>): number {
  const sorted: Array<{ from: number; to: number }> = spans
    .filter((span: { from: number; to: number }) => {
      return span.to > span.from;
    })
    .sort((a: { from: number }, b: { from: number }) => {
      return a.from - b.from;
    });

  let total: number = 0;
  let reach: number = -Infinity;

  for (const span of sorted) {
    if (span.to <= reach) {
      continue;
    }

    total += span.to - Math.max(span.from, reach);
    reach = span.to;
  }

  return total;
}

describe("WorstStatusTimeline.merge", () => {
  describe("the days in issue #6697", () => {
    test("eight monitors Offline all day and one Operational all day make one day of Offline, not nine days", () => {
      /*
       * 7 November 2026 in the issue: Offline 7d23h59m59s and Operational
       * 23h59m59s in one day - every monitor's day added up side by side.
       */
      const events: Array<Event> = [];

      for (let monitor: number = 0; monitor < 8; monitor++) {
        events.push(event(OFFLINE, at(-12 - monitor), at(30 + monitor)));
      }

      events.push(event(OPERATIONAL, at(-48), at(48)));

      const merged: Array<Event> = WorstStatusTimeline.merge(events);
      const day: Record<string, number> = secondsByStatus(merged);

      expect(day).toEqual({ Offline: 86400 });
      expect(sum(day)).toBe(86400);
    });

    test("a day the old merge cut short adds up to the time the group was recorded", () => {
      /*
       * Operational for the whole day on A; B Offline from 01:00 to 09:00;
       * C Operational from 02:00 on. The old merge kept A's tail
       * (09:00-24:00), then let C - which starts before that tail - end it
       * at 02:00, before it began: minus seven hours. The day read short of
       * the time any monitor was recorded, as on 6 November in the issue.
       */
      const events: Array<Event> = [
        event(OPERATIONAL, at(0), at(24)),
        event(OFFLINE, at(1), at(9)),
        event(OPERATIONAL, at(2), at(24)),
      ];

      const merged: Array<Event> = WorstStatusTimeline.merge(events);

      expect(pieces(merged)).toEqual([
        { status: "Operational", from: at(0), to: at(1) },
        { status: "Offline", from: at(1), to: at(9) },
        { status: "Operational", from: at(9), to: at(24) },
      ]);

      expect(secondsByStatus(merged)).toEqual({
        Operational: 16 * 3600,
        Offline: 8 * 3600,
      });
    });

    test("a monitor that runs on Operational does not cut another monitor's outage short", () => {
      // A Offline 10:00-11:00, B Operational 10:30-12:00: the whole hour is down.
      const merged: Array<Event> = WorstStatusTimeline.merge([
        event(OFFLINE, at(10), at(11)),
        event(OPERATIONAL, at(10.5), at(12)),
      ]);

      expect(pieces(merged)).toEqual([
        { status: "Offline", from: at(10), to: at(11) },
        { status: "Operational", from: at(11), to: at(12) },
      ]);
    });
  });

  test("the group is in the worst status of any monitor recorded at each instant", () => {
    const merged: Array<Event> = WorstStatusTimeline.merge([
      event(OPERATIONAL, at(0), at(24)),
      event(DEGRADED, at(4), at(8)),
      event(OFFLINE, at(6), at(7)),
      event(OPERATIONAL, at(0), at(24)),
    ]);

    expect(pieces(merged)).toEqual([
      { status: "Operational", from: at(0), to: at(4) },
      { status: "Degraded", from: at(4), to: at(6) },
      { status: "Offline", from: at(6), to: at(7) },
      { status: "Degraded", from: at(7), to: at(8) },
      { status: "Operational", from: at(8), to: at(24) },
    ]);
  });

  test("time no monitor recorded stays out of the timeline", () => {
    const merged: Array<Event> = WorstStatusTimeline.merge([
      event(OPERATIONAL, at(0), at(3)),
      event(OFFLINE, at(10), at(11)),
      event(OPERATIONAL, at(20), at(24)),
    ]);

    expect(pieces(merged)).toEqual([
      { status: "Operational", from: at(0), to: at(3) },
      { status: "Offline", from: at(10), to: at(11) },
      { status: "Operational", from: at(20), to: at(24) },
    ]);

    // eight hours recorded: the gaps are neither up nor down.
    expect(sum(secondsByStatus(merged))).toBe(8 * 3600);
  });

  test("pieces of one status that meet are joined, from one monitor or several", () => {
    const merged: Array<Event> = WorstStatusTimeline.merge([
      event(OPERATIONAL, at(0), at(5)),
      event(OPERATIONAL, at(5), at(9)),
      event(OPERATIONAL, at(3), at(12)),
    ]);

    expect(pieces(merged)).toEqual([
      { status: "Operational", from: at(0), to: at(12) },
    ]);
  });

  test("events that cover nothing are left out", () => {
    const merged: Array<Event> = WorstStatusTimeline.merge([
      event(OFFLINE, at(5), at(5)),
      event(OFFLINE, at(9), at(2)),
      event(OPERATIONAL, at(0), at(1)),
    ]);

    expect(pieces(merged)).toEqual([
      { status: "Operational", from: at(0), to: at(1) },
    ]);
    expect(WorstStatusTimeline.merge([])).toEqual([]);
  });

  test("an event with a date it cannot read is left out rather than thrown on", () => {
    const broken: Event = {
      ...event(OFFLINE, at(1), at(2)),
      startDate: new Date("not a date"),
    };

    expect(
      pieces(
        WorstStatusTimeline.merge([broken, event(OPERATIONAL, at(0), at(3))]),
      ),
    ).toEqual([{ status: "Operational", from: at(0), to: at(3) }]);
  });

  describe("statuses that count as downtime", () => {
    test("by default the project's order decides: a status above Offline wins", () => {
      const merged: Array<Event> = WorstStatusTimeline.merge([
        event(OFFLINE, at(0), at(10)),
        event(MAINTENANCE, at(2), at(4)),
      ]);

      expect(pieces(merged)).toEqual([
        { status: "Offline", from: at(0), to: at(2) },
        { status: "Maintenance", from: at(2), to: at(4) },
        { status: "Offline", from: at(4), to: at(10) },
      ]);
    });

    test("named, they outrank every status that is not down, so the group is down while any monitor is", () => {
      const merged: Array<Event> = WorstStatusTimeline.merge(
        [event(OFFLINE, at(0), at(10)), event(MAINTENANCE, at(2), at(4))],
        { downtimeMonitorStatusIds: [OFFLINE.id] },
      );

      expect(pieces(merged)).toEqual([
        { status: "Offline", from: at(0), to: at(10) },
      ]);
    });

    test("among downtime statuses, and among the rest, the project's order still decides", () => {
      const merged: Array<Event> = WorstStatusTimeline.merge(
        [
          event(DEGRADED, at(0), at(10)),
          event(OFFLINE, at(2), at(4)),
          event(MAINTENANCE, at(12), at(14)),
          event(OPERATIONAL, at(10), at(20)),
        ],
        { downtimeMonitorStatusIds: [DEGRADED.id, OFFLINE.id.toString()] },
      );

      expect(pieces(merged)).toEqual([
        { status: "Degraded", from: at(0), to: at(2) },
        { status: "Offline", from: at(2), to: at(4) },
        { status: "Degraded", from: at(4), to: at(10) },
        { status: "Operational", from: at(10), to: at(12) },
        { status: "Maintenance", from: at(12), to: at(14) },
        { status: "Operational", from: at(14), to: at(20) },
      ]);
    });
  });

  test("of two statuses of the same rank, the one that started first keeps the time", () => {
    const sameRank: StatusDefinition = {
      ...DEGRADED,
      id: new ObjectID("10000000-0000-4000-8000-000000000009"),
      name: "Partial outage",
    };

    const merged: Array<Event> = WorstStatusTimeline.merge([
      event(sameRank, at(3), at(8)),
      event(DEGRADED, at(1), at(5)),
    ]);

    expect(pieces(merged)).toEqual([
      { status: "Degraded", from: at(1), to: at(5) },
      { status: "Partial outage", from: at(5), to: at(8) },
    ]);
  });

  test("the result does not depend on the order the events come in", () => {
    const events: Array<Event> = [
      event(OPERATIONAL, at(0), at(24)),
      event(OFFLINE, at(3), at(5)),
      event(DEGRADED, at(4), at(9)),
      event(OPERATIONAL, at(8), at(30)),
      event(OFFLINE, at(20), at(21)),
    ];

    const forwards: Array<Piece> = pieces(WorstStatusTimeline.merge(events));
    const backwards: Array<Piece> = pieces(
      WorstStatusTimeline.merge([...events].reverse()),
    );

    expect(backwards).toEqual(forwards);
  });

  test("the events it is handed are not changed", () => {
    const events: Array<Event> = [
      event(OPERATIONAL, at(0), at(24)),
      event(OFFLINE, at(3), at(5)),
    ];
    const before: string = JSON.stringify(events);

    WorstStatusTimeline.merge(events);

    expect(JSON.stringify(events)).toBe(before);
  });

  describe("against a reference, on drawn timelines", () => {
    /*
     * Up to nine monitors, each a run of rows with gaps between some, every
     * status, rows that overlap their own monitor's, zero-length and
     * inverted rows - checked against the O(n^2) reference above, and for
     * the two things a day bar needs: no instant counted twice, and the
     * downtime the time at least one monitor was down.
     */
    const random: SeededRandom = seededRandom(6697);

    function drawEvents(): Array<Event> {
      const monitors: number = 1 + random(9);
      const events: Array<Event> = [];

      for (let monitor: number = 0; monitor < monitors; monitor++) {
        let cursor: number = DAY_START - random(36) * HOUR_MS;
        const rows: number = 1 + random(12);

        for (let row: number = 0; row < rows; row++) {
          // sometimes a gap before the row, sometimes an overlap with the last one.
          const shape: number = random(10);

          if (shape < 2) {
            cursor += random(6 * 60) * 60 * 1000;
          } else if (shape === 2) {
            cursor -= random(3 * 60) * 60 * 1000;
          }

          const length: number =
            random(10) === 0 ? 0 : random(14 * 60 * 60) * 1000 + 1;
          const status: StatusDefinition =
            ALL_STATUSES[random(ALL_STATUSES.length)]!;

          events.push(
            random(25) === 0
              ? event(status, cursor + length, cursor)
              : event(status, cursor, cursor + length),
          );

          cursor += length;
        }
      }

      return events;
    }

    test("matches the reference on 2,000 drawn groups, with and without downtime statuses", () => {
      for (let draw: number = 0; draw < 2000; draw++) {
        const events: Array<Event> = drawEvents();
        const downtimeIds: Array<string> =
          draw % 2 === 0 ? [] : [OFFLINE.id.toString(), DEGRADED.id.toString()];

        const merged: Array<Event> = WorstStatusTimeline.merge(events, {
          downtimeMonitorStatusIds: downtimeIds,
        });

        expect(pieces(merged)).toEqual(referenceMerge(events, downtimeIds));
      }
    });

    test("never counts an instant twice: a day adds up to the time any monitor was recorded in it, at most the day", () => {
      for (let draw: number = 0; draw < 1000; draw++) {
        const events: Array<Event> = drawEvents();
        const merged: Array<Event> = WorstStatusTimeline.merge(events);

        for (let i: number = 1; i < merged.length; i++) {
          expect(merged[i]!.startDate.getTime()).toBeGreaterThanOrEqual(
            merged[i - 1]!.endDate.getTime(),
          );
        }

        for (let day: number = -2; day <= 2; day++) {
          const dayStart: number = DAY_START + day * DAY_MS;
          const dayEnd: number = dayStart + DAY_MS;
          const total: number = sum(secondsByStatus(merged, dayStart, dayEnd));

          const recorded: number =
            unionLength(
              events.map((candidate: Event) => {
                return {
                  from: Math.max(candidate.startDate.getTime(), dayStart),
                  to: Math.min(candidate.endDate.getTime(), dayEnd),
                };
              }),
            ) / 1000;

          expect(total).toBeCloseTo(recorded, 6);
          expect(total).toBeLessThanOrEqual(86400);
        }
      }
    });

    test("with downtime statuses named, its downtime is exactly the time at least one monitor was down", () => {
      const downtimeIds: Array<string> = [
        OFFLINE.id.toString(),
        DEGRADED.id.toString(),
      ];

      for (let draw: number = 0; draw < 1000; draw++) {
        const events: Array<Event> = drawEvents();
        const merged: Array<Event> = WorstStatusTimeline.merge(events, {
          downtimeMonitorStatusIds: downtimeIds,
        });

        const mergedDowntime: number = merged
          .filter((piece: Event) => {
            return downtimeIds.includes(piece.eventStatusId.toString());
          })
          .reduce((total: number, piece: Event) => {
            return (
              total + (piece.endDate.getTime() - piece.startDate.getTime())
            );
          }, 0);

        const unionOfDowntime: number = unionLength(
          events
            .filter((candidate: Event) => {
              return downtimeIds.includes(candidate.eventStatusId.toString());
            })
            .map((candidate: Event) => {
              return {
                from: candidate.startDate.getTime(),
                to: candidate.endDate.getTime(),
              };
            }),
        );

        expect(mergedDowntime).toBe(unionOfDowntime);
      }
    });
  });

  test("merges a page's worth of rows quickly", () => {
    // ten flapping monitors, a status change every 20 seconds for a day each.
    const events: Array<Event> = [];

    for (let monitor: number = 0; monitor < 10; monitor++) {
      for (let row: number = 0; row < 4320; row++) {
        const start: number = DAY_START + row * 20_000 + monitor * 1000;
        events.push(
          event(row % 2 === 0 ? OPERATIONAL : OFFLINE, start, start + 20_000),
        );
      }
    }

    const startedAt: number = Date.now();
    const merged: Array<Event> = WorstStatusTimeline.merge(events);
    const elapsed: number = Date.now() - startedAt;

    expect(merged.length).toBeGreaterThan(0);
    expect(
      sum(secondsByStatus(merged, DAY_START, DAY_START + 2 * DAY_MS)),
    ).toBe((4320 * 20 + 9) * 1);
    expect(elapsed).toBeLessThan(2000);
  });
});
