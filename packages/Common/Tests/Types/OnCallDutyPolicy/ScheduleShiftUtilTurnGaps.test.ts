import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import { ROTATION_PERIOD_START_KEY } from "../../../Types/OnCallDutyPolicy/Layer";
import ScheduleResolution from "../../../Types/OnCallDutyPolicy/ScheduleResolution";
import ScheduleShiftUtil, {
  OnCallShift,
} from "../../../Types/OnCallDutyPolicy/ScheduleShiftUtil";
import {
  at,
  away,
  dailyHours,
  layer,
  noRestriction,
  wall,
} from "./SkipTestFixtures";

/*
 * groupEventsIntoShifts({ mergeAcrossGaps, bridgeGapsWithinTurnOnly }): the
 * grouping a layer's turns list uses (LayerRotationSummary).
 *
 * mergeAcrossGaps folds one person's run of segments into one turn, absorbing
 * the off-hours inside it ("Alice: Mon 9:00 -> Fri 17:00" rather than five
 * rows). Once somebody can be skipped (task oncall-skip-user-until), a gap
 * between two of one person's segments can also be days nobody in the layer
 * is on call - everybody away, and the turns in between gone. Folding across
 * that listed one person's "current turn" running on for days. With
 * bridgeGapsWithinTurnOnly a gap is bridged only inside one rotation turn
 * (the period LayerUtil stamps on every segment).
 */

function segment(
  userId: string,
  start: string,
  end: string,
  periodStart?: string | undefined,
): CalendarEvent {
  const event: CalendarEvent = {
    id: 0,
    title: userId,
    allDay: false,
    start: at(start),
    end: at(end),
  };

  if (periodStart) {
    (event as unknown as Record<string, unknown>)[ROTATION_PERIOD_START_KEY] =
      at(periodStart).getTime();
  }

  return event;
}

// Hours on call, to the minute: the engine's one-second seams round away.
function describeShifts(shifts: Array<OnCallShift>): Array<string> {
  return shifts.map((shift: OnCallShift): string => {
    const hours: number = Math.round(shift.coverageSeconds / 60) / 60;
    return `${shift.userId} ${wall(shift.start)} -> ${wall(shift.end)} (${hours}h)`;
  });
}

function turns(
  events: Array<CalendarEvent>,
  bridgeGapsWithinTurnOnly: boolean,
): Array<string> {
  return describeShifts(
    ScheduleShiftUtil.groupEventsIntoShifts(events, {
      mergeAcrossGaps: true,
      bridgeGapsWithinTurnOnly,
    }),
  );
}

describe("bridgeGapsWithinTurnOnly, on hand-built segments", () => {
  test("off-hours inside one turn are still absorbed", () => {
    // A's weekly turn, on call 9-17 each day.
    const events: Array<CalendarEvent> = [
      segment("A", "2026-03-02 09:00", "2026-03-02 17:00", "2026-03-02 09:00"),
      segment("A", "2026-03-03 09:00", "2026-03-03 17:00", "2026-03-02 09:00"),
      segment("A", "2026-03-04 09:00", "2026-03-04 17:00", "2026-03-02 09:00"),
    ];

    expect(turns(events, true)).toEqual([
      "A 03-02 09:00:00 -> 03-04 17:00:00 (24h)",
    ]);
  });

  test("a gap between two different turns of one person is not bridged", () => {
    // A's turn, then days nobody in the layer has, then A's next turn.
    const events: Array<CalendarEvent> = [
      segment("A", "2026-03-02 09:00", "2026-03-02 12:00", "2026-03-02 09:00"),
      segment("A", "2026-03-05 09:00", "2026-03-06 09:00", "2026-03-05 09:00"),
    ];

    expect(turns(events, true)).toEqual([
      "A 03-02 09:00:00 -> 03-02 12:00:00 (3h)",
      "A 03-05 09:00:00 -> 03-06 09:00:00 (24h)",
    ]);
  });

  test("two turns of one person that touch still read as one run", () => {
    // [A, A, B]: A's two turns back to back, across the engine's seam.
    const events: Array<CalendarEvent> = [
      segment("A", "2026-03-02 09:00", "2026-03-03 09:00", "2026-03-02 09:00"),
      segment(
        "A",
        "2026-03-03 09:00:01",
        "2026-03-04 09:00",
        "2026-03-03 09:00",
      ),
      segment(
        "B",
        "2026-03-04 09:00:01",
        "2026-03-05 09:00",
        "2026-03-04 09:00",
      ),
    ];

    expect(turns(events, true)).toEqual([
      "A 03-02 09:00:00 -> 03-04 09:00:00 (48h)",
      "B 03-04 09:00:01 -> 03-05 09:00:00 (24h)",
    ]);
  });

  test("segments that carry no turn bridge gaps as they always did", () => {
    const events: Array<CalendarEvent> = [
      segment("A", "2026-03-02 09:00", "2026-03-02 12:00"),
      segment("A", "2026-03-05 09:00", "2026-03-06 09:00"),
    ];

    expect(turns(events, true)).toEqual([
      "A 03-02 09:00:00 -> 03-06 09:00:00 (27h)",
    ]);
  });

  test("left off, nothing changes: different turns are folded across the gap", () => {
    const events: Array<CalendarEvent> = [
      segment("A", "2026-03-02 09:00", "2026-03-02 12:00", "2026-03-02 09:00"),
      segment("A", "2026-03-05 09:00", "2026-03-06 09:00", "2026-03-05 09:00"),
    ];

    expect(turns(events, false)).toEqual([
      "A 03-02 09:00:00 -> 03-06 09:00:00 (27h)",
    ]);
  });

  test("without mergeAcrossGaps it does nothing: only touching segments merge", () => {
    const events: Array<CalendarEvent> = [
      segment("A", "2026-03-02 09:00", "2026-03-02 17:00", "2026-03-02 09:00"),
      segment("A", "2026-03-03 09:00", "2026-03-03 17:00", "2026-03-02 09:00"),
    ];

    expect(
      describeShifts(
        ScheduleShiftUtil.groupEventsIntoShifts(events, {
          bridgeGapsWithinTurnOnly: true,
        }),
      ),
    ).toEqual([
      "A 03-02 09:00:00 -> 03-02 17:00:00 (8h)",
      "A 03-03 09:00:00 -> 03-03 17:00:00 (8h)",
    ]);
  });

  test("never mutates the caller's events", () => {
    const events: Array<CalendarEvent> = [
      segment("A", "2026-03-05 09:00", "2026-03-06 09:00", "2026-03-05 09:00"),
      segment("A", "2026-03-02 09:00", "2026-03-02 12:00", "2026-03-02 09:00"),
    ];
    const before: string = JSON.stringify(events);

    turns(events, true);

    expect(JSON.stringify(events)).toBe(before);
  });
});

describe("bridgeGapsWithinTurnOnly, on a resolved schedule", () => {
  /*
   * Daily turns A -> B -> C from Monday 2 March 09:00, on call 09:00-17:00.
   * Everybody is away from Monday 12:00 to Thursday 12:00: A's turn stops at
   * noon, B's and C's turns are nobody's, and A's next turn (Thursday) is
   * hers from noon.
   */
  const events: Array<CalendarEvent> = ScheduleResolution.resolve(
    {
      layers: [
        layer({
          people: ["A", "B", "C"],
          restriction: dailyHours("09:00", "17:00"),
        }),
      ],
      calendarStartDate: at("2026-03-02 00:00"),
      calendarEndDate: at("2026-03-07 00:00"),
      overrides: ["A", "B", "C"].map((who: string) => {
        return away({
          who,
          from: "2026-03-02 12:00",
          until: "2026-03-05 12:00",
        });
      }),
    },
    {},
  ).events;

  test("A's two turns stay two rows, with the days between nobody's", () => {
    expect(turns(events, true)).toEqual([
      "A 03-02 09:00:00 -> 03-02 12:00:00 (3h)",
      "A 03-05 12:00:00 -> 03-05 17:00:00 (5h)",
      "B 03-06 09:00:01 -> 03-06 17:00:00 (8h)",
    ]);
  });

  test("folded across the gap instead, A's turn would run from Monday to Thursday", () => {
    expect(turns(events, false)[0]).toBe(
      "A 03-02 09:00:00 -> 03-05 17:00:00 (8h)",
    );
  });

  test("a 24/7 layer the same: nobody's days are no one's turn", () => {
    const allDay: Array<CalendarEvent> = ScheduleResolution.resolve(
      {
        layers: [
          layer({ people: ["A", "B", "C"], restriction: noRestriction() }),
        ],
        calendarStartDate: at("2026-03-02 00:00"),
        calendarEndDate: at("2026-03-06 00:00"),
        overrides: ["A", "B", "C"].map((who: string) => {
          return away({
            who,
            from: "2026-03-02 12:00",
            until: "2026-03-05 12:00",
          });
        }),
      },
      {},
    ).events;

    const rows: Array<string> = turns(allDay, true);

    expect(rows[0]).toBe("A 03-02 09:00:00 -> 03-02 12:00:00 (3h)");
    expect(rows[1]).toMatch(/^A 03-05 12:00:00 -> /);
  });
});
