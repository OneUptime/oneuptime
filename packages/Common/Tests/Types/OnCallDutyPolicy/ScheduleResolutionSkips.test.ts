import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import EventInterval from "../../../Types/Events/EventInterval";
import LayerUtil, {
  ExpandedLayers,
  LayerEventsResult,
  LayerProps,
  ROTATION_TURN_INDEX_KEY,
} from "../../../Types/OnCallDutyPolicy/Layer";
import ScheduleResolution from "../../../Types/OnCallDutyPolicy/ScheduleResolution";
import UserOverrideUtil, {
  OverrideEventMeta,
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  at,
  away,
  dailyHours,
  describeEvents,
  layer,
  onCallAt,
} from "./SkipTestFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * SKIPPING SOMEBODY IN THE ROTATION UNTIL A DATE.
 *
 * A user override with nobody named to cover is a skip: while it is in
 * force, each of the person's turns in each layer goes to the next person in
 * that layer's turn order who is not away, and the rotation itself does not
 * move - so when it ends they are back in their usual place. These pin the
 * engine (ScheduleResolution + UserOverrideUtil.applySkipsToLayerEvents):
 * one person, several, the end of the list wrapping round, everybody away,
 * the same person twice in a list, restricted hours, hand-off boundaries,
 * several layers, policy scopes, which override wins when a skip and a
 * named cover overlap, time zones, and a seeded sweep of invariants.
 *
 * The base schedule of most tests: A, B, C and D take turns of a day, A
 * first, handing over at 09:00 UTC from Monday 2 March 2026 - A has Mar 2,
 * B Mar 3, C Mar 4, D Mar 5, A again Mar 6. Every turn after the first
 * starts one second after the hand-off: that is the engine's seam, and the
 * screens and feeds normalise it. A window that starts on a hand-off starts
 * its first segment at the window's own start.
 */

const ABCD: LayerProps = layer({ people: ["A", "B", "C", "D"] });

const WEEK_START: string = "2026-03-02 09:00";
const WEEK_END: string = "2026-03-08 09:00";

function resolve(data: {
  layers: Array<LayerProps>;
  overrides?: Array<UserOverrideRecord> | undefined;
  policy?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
  getNumberOfEvents?: number | undefined;
}): Array<CalendarEvent> {
  return ScheduleResolution.resolve(
    {
      layers: data.layers,
      calendarStartDate: at(data.from || WEEK_START),
      calendarEndDate: at(data.until || WEEK_END),
      overrides: data.overrides,
      currentOnCallDutyPolicyId: data.policy,
    },
    data.getNumberOfEvents !== undefined
      ? { getNumberOfEvents: data.getNumberOfEvents }
      : undefined,
  ).events;
}

/*
 * The pipeline every consumer ran before skips existed: the layers merged
 * by priority, then the covering overrides.
 */
function resolveTheOldWay(data: {
  layers: Array<LayerProps>;
  overrides?: Array<UserOverrideRecord> | undefined;
  policy?: string | undefined;
  from?: string | undefined;
  until?: string | undefined;
}): Array<CalendarEvent> {
  const events: Array<CalendarEvent> = new LayerUtil().getMultiLayerEvents({
    layers: data.layers,
    calendarStartDate: at(data.from || WEEK_START),
    calendarEndDate: at(data.until || WEEK_END),
  });

  if (!data.overrides || data.overrides.length === 0) {
    return events;
  }

  return UserOverrideUtil.applyOverridesToEvents({
    events,
    overrides: data.overrides,
    currentOnCallDutyPolicyId: data.policy,
  });
}

describe("With nobody skipped, the resolution is what it always was", () => {
  const layerSets: Array<{ name: string; layers: Array<LayerProps> }> = [
    { name: "one layer, a turn a day", layers: [ABCD] },
    {
      name: "business hours over a fallback",
      layers: [
        layer({
          people: ["A", "B"],
          restriction: dailyHours("09:00", "17:00"),
          id: "day",
        }),
        layer({ people: ["C", "D"], every: EventInterval.Week, id: "night" }),
      ],
    },
    {
      name: "hourly turns",
      layers: [layer({ people: ["A", "B", "C"], every: EventInterval.Hour })],
    },
    {
      name: "the same person twice",
      layers: [layer({ people: ["A", "B", "A", "C"] })],
    },
  ];

  for (const set of layerSets) {
    test(`${set.name}: no overrides`, () => {
      expect(describeEvents(resolve({ layers: set.layers }))).toEqual(
        describeEvents(resolveTheOldWay({ layers: set.layers })),
      );
    });

    test(`${set.name}: only overrides that name who covers`, () => {
      const overrides: Array<UserOverrideRecord> = [
        away({
          who: "A",
          from: "2026-03-02 12:00",
          until: "2026-03-03 03:00",
          cover: "Z",
        }),
        away({
          who: "C",
          from: "2026-03-04 00:00",
          until: "2026-03-06 00:00",
          cover: "Y",
          policy: "P",
        }),
      ];

      for (const policy of [undefined, "P", "Q"]) {
        expect(
          describeEvents(resolve({ layers: set.layers, overrides, policy })),
        ).toEqual(
          describeEvents(
            resolveTheOldWay({ layers: set.layers, overrides, policy }),
          ),
        );
      }
    });
  }

  test("a skip of somebody who is in none of the layers changes nothing", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({ who: "X", from: WEEK_START, until: WEEK_END }),
          ],
        }),
      ),
    ).toEqual(describeEvents(resolveTheOldWay({ layers: [ABCD] })));
  });

  test("the engine's turn index never reaches the events it hands out", () => {
    const withSkip: Array<CalendarEvent> = resolve({
      layers: [ABCD],
      overrides: [
        away({ who: "B", from: "2026-03-03 12:00", until: "2026-03-05 12:00" }),
      ],
    });
    const withoutSkip: Array<CalendarEvent> = resolve({ layers: [ABCD] });

    for (const event of [...withSkip, ...withoutSkip]) {
      expect(Object.keys(event)).not.toContain(ROTATION_TURN_INDEX_KEY);
    }
  });
});

describe("The engine says whose turn each event is, only when asked", () => {
  test("withTurnIndex stamps each event with its place in the turn order", () => {
    const result: LayerEventsResult = new LayerUtil().getEventsWithMeta(
      {
        ...layer({ people: ["A", "B", "A", "C"] }),
        calendarStartDate: at(WEEK_START),
        calendarEndDate: at("2026-03-07 09:00"),
      },
      { withTurnIndex: true },
    );

    expect(
      result.events.map((event: CalendarEvent): string => {
        return `${event.title}@${String(
          (event as unknown as Record<string, unknown>)[
            ROTATION_TURN_INDEX_KEY
          ],
        )}`;
      }),
    ).toEqual(["A@0", "B@1", "A@2", "C@3", "A@0"]);
  });

  test("without it the events have the shape they always had", () => {
    const events: Array<CalendarEvent> = new LayerUtil().getEvents({
      ...ABCD,
      calendarStartDate: at(WEEK_START),
      calendarEndDate: at(WEEK_END),
    });

    for (const event of events) {
      expect(Object.keys(event)).not.toContain(ROTATION_TURN_INDEX_KEY);
    }
  });

  test("the override utility reads the same key the engine writes", () => {
    /*
     * UserOverrideUtil keeps its own copy of the key so it never imports the
     * engine; a turn index it cannot read would hand the turn of the second
     * of two places in a list to whoever follows the first.
     */
    const events: Array<CalendarEvent> = UserOverrideUtil.applySkipsToLayerEvents(
      {
        events: [
          {
            id: 1,
            title: "A",
            allDay: false,
            start: at("2026-03-04 09:00"),
            end: at("2026-03-05 09:00"),
            [ROTATION_TURN_INDEX_KEY]: 2,
          } as CalendarEvent,
        ],
        userIds: ["A", "B", "A", "C"],
        overrides: [away({ who: "A", from: WEEK_START, until: WEEK_END })],
      },
    );

    expect(describeEvents(events)).toEqual([
      "C 03-04 09:00:00 -> 03-05 09:00:00 (skip for A)",
    ]);
  });
});

describe("One person away: each of their turns goes to the next person", () => {
  test("away for all of a turn: the next person has it, and the rotation does not move", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 00:00",
              until: "2026-03-04 12:00",
            }),
          ],
        }),
      ),
    ).toEqual([
      "A 03-02 09:00:00 -> 03-03 09:00:00",
      "C 03-03 09:00:01 -> 03-04 09:00:00 (skip for B)",
      "C 03-04 09:00:01 -> 03-05 09:00:00",
      "D 03-05 09:00:01 -> 03-06 09:00:00",
      "A 03-06 09:00:01 -> 03-07 09:00:00",
      // Back in her usual place: the turn after A's, as before the skip.
      "B 03-07 09:00:01 -> 03-08 09:00:00",
    ]);
  });

  test("away for two of their turns: both go on, and nobody else's turn changes", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [ABCD],
      overrides: [
        away({ who: "A", from: WEEK_START, until: "2026-03-07 12:00" }),
      ],
      until: "2026-03-11 09:00",
    });

    expect(describeEvents(events)).toEqual([
      "B 03-02 09:00:00 -> 03-03 09:00:00 (skip for A)",
      "B 03-03 09:00:01 -> 03-04 09:00:00",
      "C 03-04 09:00:01 -> 03-05 09:00:00",
      "D 03-05 09:00:01 -> 03-06 09:00:00",
      "B 03-06 09:00:01 -> 03-07 09:00:00 (skip for A)",
      "B 03-07 09:00:01 -> 03-08 09:00:00",
      "C 03-08 09:00:01 -> 03-09 09:00:00",
      "D 03-09 09:00:01 -> 03-10 09:00:00",
      "A 03-10 09:00:01 -> 03-11 09:00:00",
    ]);
  });

  test("the segments handed on name who is away, and for how long", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [ABCD],
      overrides: [
        away({ who: "B", from: "2026-03-03 00:00", until: "2026-03-04 12:00" }),
      ],
    });

    const handedOn: CalendarEvent | undefined = events.find(
      (event: CalendarEvent) => {
        return UserOverrideUtil.getOverrideMeta(event) !== null;
      },
    );

    expect(UserOverrideUtil.getOverrideMeta(handedOn!)).toEqual({
      isOverride: true,
      originalUserId: "B",
      overrideUserId: "C",
      overrideStartsAt: at("2026-03-03 00:00"),
      overrideEndsAt: at("2026-03-04 12:00"),
      onCallDutyPolicyId: null,
      isSkip: true,
    });

    // Turns that are nobody's skip carry no meta at all.
    expect(
      events.filter((event: CalendarEvent) => {
        return UserOverrideUtil.getOverrideMeta(event) !== null;
      }),
    ).toHaveLength(1);
  });
});

describe("A skip that starts or ends in the middle of a turn", () => {
  test("hands over at the moment it starts, and back at the moment it ends", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 12:00",
              until: "2026-03-03 18:30",
            }),
          ],
          from: "2026-03-03 09:00",
          until: "2026-03-04 09:00",
        }),
      ),
    ).toEqual([
      "B 03-03 09:00:00 -> 03-03 12:00:00",
      "C 03-03 12:00:00 -> 03-03 18:30:00 (skip for B)",
      "B 03-03 18:30:00 -> 03-04 09:00:00",
    ]);
  });

  test("starting before the turn and ending in it: the start of the turn goes on", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-01 00:00",
              until: "2026-03-03 15:00",
            }),
          ],
          from: "2026-03-03 09:00",
          until: "2026-03-04 09:00",
        }),
      ),
    ).toEqual([
      "C 03-03 09:00:00 -> 03-03 15:00:00 (skip for B)",
      "B 03-03 15:00:00 -> 03-04 09:00:00",
    ]);
  });

  test("ending exactly at a hand-off leaves no sliver behind", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [ABCD],
      overrides: [
        away({ who: "B", from: "2026-03-03 06:00", until: "2026-03-04 09:00" }),
      ],
      from: "2026-03-03 09:00",
      until: "2026-03-05 09:00",
    });

    expect(describeEvents(events)).toEqual([
      "C 03-03 09:00:00 -> 03-04 09:00:00 (skip for B)",
      "C 03-04 09:00:01 -> 03-05 09:00:00",
    ]);

    for (const event of events) {
      expect(event.end.getTime()).toBeGreaterThan(event.start.getTime());
    }
  });

  test("starting exactly at a hand-off takes the whole turn", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "C",
              from: "2026-03-04 09:00",
              until: "2026-03-05 09:00",
            }),
          ],
          from: "2026-03-04 09:00",
          until: "2026-03-06 09:00",
        }),
      ),
    ).toEqual([
      "D 03-04 09:00:00 -> 03-05 09:00:00 (skip for C)",
      "D 03-05 09:00:01 -> 03-06 09:00:00",
    ]);
  });

  test("ending a minute into the next person's turn does not touch that turn", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 06:00",
              until: "2026-03-04 09:01",
            }),
          ],
          from: "2026-03-03 09:00",
          until: "2026-03-05 09:00",
        }),
      ),
    ).toEqual([
      "C 03-03 09:00:00 -> 03-04 09:00:00 (skip for B)",
      "C 03-04 09:00:01 -> 03-05 09:00:00",
    ]);
  });
});

describe("Several people away: the turn goes to the next one who is not", () => {
  test("two people in a row away: both of their turns go to the one after them", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 00:00",
              until: "2026-03-05 12:00",
            }),
            away({
              who: "C",
              from: "2026-03-03 00:00",
              until: "2026-03-05 12:00",
            }),
          ],
        }),
      ),
    ).toEqual([
      "A 03-02 09:00:00 -> 03-03 09:00:00",
      "D 03-03 09:00:01 -> 03-04 09:00:00 (skip for B)",
      "D 03-04 09:00:01 -> 03-05 09:00:00 (skip for C)",
      "D 03-05 09:00:01 -> 03-06 09:00:00",
      "A 03-06 09:00:01 -> 03-07 09:00:00",
      "B 03-07 09:00:01 -> 03-08 09:00:00",
    ]);
  });

  test("the last person in the list hands on to the first (wrap-around)", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "D",
              from: "2026-03-05 00:00",
              until: "2026-03-06 12:00",
            }),
          ],
          from: "2026-03-05 09:00",
          until: "2026-03-07 09:00",
        }),
      ),
    ).toEqual([
      "A 03-05 09:00:00 -> 03-06 09:00:00 (skip for D)",
      "A 03-06 09:00:01 -> 03-07 09:00:00",
    ]);
  });

  test("the last two away: the turn wraps round past both", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "C",
              from: "2026-03-04 00:00",
              until: "2026-03-06 12:00",
            }),
            away({
              who: "D",
              from: "2026-03-04 00:00",
              until: "2026-03-06 12:00",
            }),
          ],
          from: "2026-03-04 09:00",
          until: "2026-03-06 09:00",
        }),
      ),
    ).toEqual([
      "A 03-04 09:00:00 -> 03-05 09:00:00 (skip for C)",
      "A 03-05 09:00:01 -> 03-06 09:00:00 (skip for D)",
    ]);
  });

  test("somebody away with a named cover is never picked as the next person", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 00:00",
              until: "2026-03-05 12:00",
            }),
            away({
              who: "C",
              from: "2026-03-03 00:00",
              until: "2026-03-05 12:00",
              cover: "Z",
            }),
          ],
          from: "2026-03-03 09:00",
          until: "2026-03-05 09:00",
        }),
      ),
    ).toEqual([
      // B's turn skips C, who is away too, to D.
      "D 03-03 09:00:00 -> 03-04 09:00:00 (skip for B)",
      // C's own turn goes to the cover C named.
      "Z 03-04 09:00:01 -> 03-05 09:00:00 (cover for C)",
    ]);
  });

  test("the next person away for part of the turn: the turn passes along with them", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 00:00",
              until: "2026-03-04 12:00",
            }),
            away({
              who: "C",
              from: "2026-03-03 13:00",
              until: "2026-03-03 17:00",
            }),
          ],
          from: "2026-03-03 09:00",
          until: "2026-03-04 09:00",
        }),
      ),
    ).toEqual([
      "C 03-03 09:00:00 -> 03-03 13:00:00 (skip for B)",
      "D 03-03 13:00:00 -> 03-03 17:00:00 (skip for B)",
      "C 03-03 17:00:00 -> 03-04 09:00:00 (skip for B)",
    ]);
  });
});

describe("Everybody in a layer away: the layer has nobody, and falls through", () => {
  const everyoneAwayOnTuesday: Array<UserOverrideRecord> = [
    "A",
    "B",
    "C",
    "D",
  ].map((who: string): UserOverrideRecord => {
    return away({ who, from: "2026-03-03 09:00", until: "2026-03-04 09:00" });
  });

  test("one layer: nobody is on call while everyone is away", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [ABCD],
      overrides: everyoneAwayOnTuesday,
      from: "2026-03-02 09:00",
      until: "2026-03-05 09:00",
    });

    expect(describeEvents(events)).toEqual([
      "A 03-02 09:00:00 -> 03-03 09:00:00",
      "C 03-04 09:00:01 -> 03-05 09:00:00",
    ]);
    expect(onCallAt(events, at("2026-03-03 15:00"))).toBeNull();
  });

  test("with a layer below: it covers, as it does for an empty layer", () => {
    const fallback: LayerProps = layer({
      people: ["E", "F"],
      every: EventInterval.Week,
    });

    const events: Array<CalendarEvent> = resolve({
      layers: [ABCD, fallback],
      overrides: everyoneAwayOnTuesday,
      from: "2026-03-02 09:00",
      until: "2026-03-05 09:00",
    });

    expect(onCallAt(events, at("2026-03-02 15:00"))).toBe("A");
    expect(onCallAt(events, at("2026-03-03 15:00"))).toBe("E");
    expect(onCallAt(events, at("2026-03-04 15:00"))).toBe("C");

    // The fallback's time is its own, not anyone's skip.
    const tuesday: CalendarEvent | undefined = events.find(
      (event: CalendarEvent) => {
        return event.title === "E";
      },
    );
    expect(UserOverrideUtil.getOverrideMeta(tuesday!)).toBeNull();
  });

  test("a layer of one person away falls through to the layer below", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [
        layer({ people: ["A"] }),
        layer({ people: ["E", "F"], every: EventInterval.Week }),
      ],
      overrides: [
        away({ who: "A", from: "2026-03-03 00:00", until: "2026-03-04 00:00" }),
      ],
      from: "2026-03-02 09:00",
      until: "2026-03-05 09:00",
    });

    expect(onCallAt(events, at("2026-03-02 23:00"))).toBe("A");
    expect(onCallAt(events, at("2026-03-03 12:00"))).toBe("E");
    expect(onCallAt(events, at("2026-03-04 12:00"))).toBe("A");
  });

  test("everyone in the fallback away too: a gap, which ends when somebody is back", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [layer({ people: ["A"] }), layer({ people: ["E"] })],
      overrides: [
        away({ who: "A", from: "2026-03-03 00:00", until: "2026-03-04 00:00" }),
        away({ who: "E", from: "2026-03-03 06:00", until: "2026-03-03 18:00" }),
      ],
      from: "2026-03-02 09:00",
      until: "2026-03-05 09:00",
    });

    expect(onCallAt(events, at("2026-03-03 03:00"))).toBe("E");
    expect(onCallAt(events, at("2026-03-03 12:00"))).toBeNull();
    expect(onCallAt(events, at("2026-03-03 20:00"))).toBe("E");
    expect(onCallAt(events, at("2026-03-04 03:00"))).toBe("A");
  });
});

describe("The same person twice in a rotation", () => {
  test("each of their turns goes to whoever follows THAT turn", () => {
    expect(
      describeEvents(
        resolve({
          layers: [layer({ people: ["A", "B", "A", "C"] })],
          overrides: [
            away({ who: "A", from: "2026-03-01 00:00", until: "2026-03-08 00:00" }),
          ],
          until: "2026-03-07 09:00",
        }),
      ),
    ).toEqual([
      "B 03-02 09:00:00 -> 03-03 09:00:00 (skip for A)",
      "B 03-03 09:00:01 -> 03-04 09:00:00",
      // The second A follows B in the list, so C - not B again - has it.
      "C 03-04 09:00:01 -> 03-05 09:00:00 (skip for A)",
      "C 03-05 09:00:01 -> 03-06 09:00:00",
      "B 03-06 09:00:01 -> 03-07 09:00:00 (skip for A)",
    ]);
  });

  test("a person never takes over their own turn from another place in the list", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [layer({ people: ["A", "A"] })],
      overrides: [
        away({ who: "A", from: "2026-03-03 00:00", until: "2026-03-04 00:00" }),
      ],
      from: "2026-03-02 09:00",
      until: "2026-03-05 09:00",
    });

    expect(onCallAt(events, at("2026-03-03 12:00"))).toBeNull();
  });
});

describe("Restricted hours", () => {
  const businessHours: LayerProps = layer({
    people: ["A", "B", "C"],
    restriction: dailyHours("09:00", "17:00"),
  });

  test("only the on-call hours of the skipped turn are handed on", () => {
    expect(
      describeEvents(
        resolve({
          layers: [businessHours],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 00:00",
              until: "2026-03-04 00:00",
            }),
          ],
          from: "2026-03-02 09:00",
          until: "2026-03-05 09:00",
        }),
      ),
    ).toEqual(
      describeEvents(
        resolve({
          layers: [businessHours],
          from: "2026-03-02 09:00",
          until: "2026-03-05 09:00",
        }),
      ).map((line: string): string => {
        return line.startsWith("B 03-03")
          ? `C${line.slice(1)} (skip for B)`
          : line;
      }),
    );
  });

  test("the hours outside the restriction stay with the layer below, skip or not", () => {
    const night: LayerProps = layer({
      people: ["E", "F"],
      every: EventInterval.Week,
    });

    const events: Array<CalendarEvent> = resolve({
      layers: [businessHours, night],
      overrides: [
        away({ who: "B", from: "2026-03-03 00:00", until: "2026-03-04 00:00" }),
      ],
      from: "2026-03-02 09:00",
      until: "2026-03-05 09:00",
    });

    expect(onCallAt(events, at("2026-03-03 12:00"))).toBe("C");
    expect(onCallAt(events, at("2026-03-03 20:00"))).toBe("E");
    expect(onCallAt(events, at("2026-03-04 12:00"))).toBe("C");
  });

  test("a skip that only covers off-hours changes nothing", () => {
    const overrides: Array<UserOverrideRecord> = [
      away({ who: "B", from: "2026-03-03 18:00", until: "2026-03-04 08:00" }),
    ];

    expect(
      describeEvents(
        resolve({
          layers: [businessHours],
          overrides,
          from: "2026-03-02 09:00",
          until: "2026-03-05 09:00",
        }),
      ),
    ).toEqual(
      describeEvents(
        resolve({
          layers: [businessHours],
          from: "2026-03-02 09:00",
          until: "2026-03-05 09:00",
        }),
      ),
    );
  });
});

describe("Several layers", () => {
  test("a person in two layers is skipped in both, each from its own turn order", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [
        layer({
          people: ["A", "B"],
          restriction: dailyHours("09:00", "17:00"),
          id: "day",
        }),
        layer({ people: ["B", "C"], id: "night" }),
      ],
      overrides: [
        away({ who: "B", from: "2026-03-02 00:00", until: "2026-03-06 00:00" }),
      ],
      from: "2026-03-02 09:00",
      until: "2026-03-04 09:00",
    });

    for (const instant of [
      "2026-03-02 12:00",
      "2026-03-02 20:00",
      "2026-03-03 12:00",
      "2026-03-03 20:00",
    ]) {
      expect(onCallAt(events, at(instant))).not.toBe("B");
    }

    // Day layer: B's turn (Mar 3) goes to A. Night layer: B's turn (Mar 2) goes to C.
    expect(onCallAt(events, at("2026-03-03 12:00"))).toBe("A");
    expect(onCallAt(events, at("2026-03-02 20:00"))).toBe("C");
  });

  test("the segments say which layer they came from, handed on or not", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [
        layer({ people: ["A", "B"], id: "primary" }),
        layer({ people: ["C"], id: "secondary" }),
      ],
      overrides: [
        away({ who: "B", from: "2026-03-03 00:00", until: "2026-03-04 12:00" }),
      ],
      from: "2026-03-02 09:00",
      until: "2026-03-05 09:00",
    });

    for (const event of events) {
      expect((event as unknown as Record<string, unknown>)["layerId"]).toBe(
        "primary",
      );
    }
  });
});

describe("Policy scopes", () => {
  const scopedSkip: UserOverrideRecord = away({
    who: "B",
    from: "2026-03-03 00:00",
    until: "2026-03-04 12:00",
    policy: "P",
  });

  test("a policy's own skip applies only when that policy pages", () => {
    expect(
      onCallAt(
        resolve({ layers: [ABCD], overrides: [scopedSkip], policy: "P" }),
        at("2026-03-03 12:00"),
      ),
    ).toBe("C");

    for (const policy of [undefined, "Q"]) {
      expect(
        onCallAt(
          resolve({ layers: [ABCD], overrides: [scopedSkip], policy }),
          at("2026-03-03 12:00"),
        ),
      ).toBe("B");
    }
  });

  test("a global skip applies for every policy, and with none", () => {
    for (const policy of [undefined, "P", "Q"]) {
      expect(
        onCallAt(
          resolve({
            layers: [ABCD],
            overrides: [{ ...scopedSkip, onCallDutyPolicyId: null }],
            policy,
          }),
          at("2026-03-03 12:00"),
        ),
      ).toBe("C");
    }
  });

  test("the handed-on segment says which policy's skip it was", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [ABCD],
      overrides: [scopedSkip],
      policy: "P",
    });

    const meta: OverrideEventMeta | null = UserOverrideUtil.getOverrideMeta(
      events.find((event: CalendarEvent) => {
        return UserOverrideUtil.getOverrideMeta(event) !== null;
      })!,
    );

    expect(meta?.onCallDutyPolicyId).toBe("P");
    expect(meta?.isSkip).toBe(true);
  });
});

describe("A skip and a named cover at the same time: which one decides", () => {
  test("same scope: the named cover wins where it applies, the skip elsewhere", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 00:00",
              until: "2026-03-06 00:00",
            }),
            away({
              who: "B",
              from: "2026-03-03 12:00",
              until: "2026-03-03 18:00",
              cover: "Z",
            }),
          ],
          from: "2026-03-03 09:00",
          until: "2026-03-04 09:00",
        }),
      ),
    ).toEqual([
      "C 03-03 09:00:00 -> 03-03 12:00:00 (skip for B)",
      "Z 03-03 12:00:00 -> 03-03 18:00:00 (cover for B)",
      "C 03-03 18:00:00 -> 03-04 09:00:00 (skip for B)",
    ]);
  });

  test("the order the overrides come in does not matter", () => {
    const skip: UserOverrideRecord = away({
      who: "B",
      from: "2026-03-03 00:00",
      until: "2026-03-06 00:00",
    });
    const cover: UserOverrideRecord = away({
      who: "B",
      from: "2026-03-03 12:00",
      until: "2026-03-03 18:00",
      cover: "Z",
    });

    expect(
      describeEvents(resolve({ layers: [ABCD], overrides: [cover, skip] })),
    ).toEqual(
      describeEvents(resolve({ layers: [ABCD], overrides: [skip, cover] })),
    );
  });

  test("a policy's own skip beats a global cover, for that policy", () => {
    const overrides: Array<UserOverrideRecord> = [
      away({
        who: "B",
        from: "2026-03-03 00:00",
        until: "2026-03-04 12:00",
        cover: "Z",
      }),
      away({
        who: "B",
        from: "2026-03-03 00:00",
        until: "2026-03-04 12:00",
        policy: "P",
      }),
    ];

    expect(
      onCallAt(
        resolve({ layers: [ABCD], overrides, policy: "P" }),
        at("2026-03-03 12:00"),
      ),
    ).toBe("C");

    // Any other policy (and none) has only the global cover.
    expect(
      onCallAt(
        resolve({ layers: [ABCD], overrides, policy: "Q" }),
        at("2026-03-03 12:00"),
      ),
    ).toBe("Z");
  });

  test("a policy's own cover beats a global skip, for that policy", () => {
    const overrides: Array<UserOverrideRecord> = [
      away({ who: "B", from: "2026-03-03 00:00", until: "2026-03-04 12:00" }),
      away({
        who: "B",
        from: "2026-03-03 00:00",
        until: "2026-03-04 12:00",
        cover: "Z",
        policy: "P",
      }),
    ];

    expect(
      onCallAt(
        resolve({ layers: [ABCD], overrides, policy: "P" }),
        at("2026-03-03 12:00"),
      ),
    ).toBe("Z");

    expect(
      onCallAt(
        resolve({ layers: [ABCD], overrides, policy: "Q" }),
        at("2026-03-03 12:00"),
      ),
    ).toBe("C");
  });

  test("precedence, in full: policy cover, policy skip, global cover, global skip", () => {
    const record: (cover: string | undefined, policy: string | undefined) => UserOverrideRecord =
      (cover: string | undefined, policy: string | undefined): UserOverrideRecord => {
        return away({
          who: "B",
          from: WEEK_START,
          until: WEEK_END,
          cover,
          policy,
        });
      };

    expect(UserOverrideUtil.getPrecedence(record("Z", "P"))).toBe(0);
    expect(UserOverrideUtil.getPrecedence(record(undefined, "P"))).toBe(1);
    expect(UserOverrideUtil.getPrecedence(record("Z", undefined))).toBe(2);
    expect(UserOverrideUtil.getPrecedence(record(undefined, undefined))).toBe(
      3,
    );
  });

  test("a turn handed on by a skip is never handed on again by a cover", () => {
    const events: Array<CalendarEvent> = resolve({
      layers: [ABCD],
      overrides: [
        away({ who: "B", from: "2026-03-03 00:00", until: "2026-03-04 12:00" }),
        // C is away for two hours of the turn C took over, with a cover named.
        away({
          who: "C",
          from: "2026-03-04 06:00",
          until: "2026-03-04 08:00",
          cover: "Z",
        }),
      ],
      from: "2026-03-03 09:00",
      until: "2026-03-04 09:00",
    });

    expect(describeEvents(events)).toEqual([
      "C 03-03 09:00:00 -> 03-04 06:00:00 (skip for B)",
      // C is away 06:00-08:00, so the rotation moves on to D - not to C's cover.
      "D 03-04 06:00:00 -> 03-04 08:00:00 (skip for B)",
      "C 03-04 08:00:00 -> 03-04 09:00:00 (skip for B)",
    ]);
  });
});

describe("Time zones", () => {
  test("Kolkata: a skip from one 09:00 hand-off to another hands on exactly those turns", () => {
    const kolkata: string = "Asia/Kolkata";
    const events: Array<CalendarEvent> = ScheduleResolution.resolve({
      layers: [
        layer({
          people: ["A", "B", "C", "D"],
          startsAt: "2026-03-02 09:00",
          tz: kolkata,
        }),
      ],
      calendarStartDate: at("2026-03-02 09:00", kolkata),
      calendarEndDate: at("2026-03-06 09:00", kolkata),
      overrides: [
        away({
          who: "B",
          from: "2026-03-03 09:00",
          until: "2026-03-04 09:00",
          tz: kolkata,
        }),
      ],
    }).events;

    expect(describeEvents(events, kolkata)).toEqual([
      "A 03-02 09:00:00 -> 03-03 09:00:00",
      "C 03-03 09:00:01 -> 03-04 09:00:00 (skip for B)",
      "C 03-04 09:00:01 -> 03-05 09:00:00",
      "D 03-05 09:00:01 -> 03-06 09:00:00",
    ]);
  });

  test("New York across the spring-forward change: turns still hand on at 09:00 local", () => {
    const newYork: string = "America/New_York";
    // 8 March 2026 is when New York moves from EST to EDT.
    const events: Array<CalendarEvent> = ScheduleResolution.resolve({
      layers: [
        layer({
          people: ["A", "B", "C"],
          startsAt: "2026-03-06 09:00",
          tz: newYork,
        }),
      ],
      calendarStartDate: at("2026-03-06 09:00", newYork),
      calendarEndDate: at("2026-03-10 09:00", newYork),
      overrides: [
        away({
          who: "C",
          from: "2026-03-08 00:00",
          until: "2026-03-09 12:00",
          tz: newYork,
        }),
      ],
    }).events;

    expect(describeEvents(events, newYork)).toEqual([
      "A 03-06 09:00:00 -> 03-07 09:00:00",
      "B 03-07 09:00:01 -> 03-08 09:00:00",
      "A 03-08 09:00:01 -> 03-09 09:00:00 (skip for C)",
      "A 03-09 09:00:01 -> 03-10 09:00:00",
    ]);
  });
});

describe("Who is on call now, and next", () => {
  test("now inside a skipped turn: the person who has it, then the next turn", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 12:00",
              until: "2026-03-04 12:00",
            }),
          ],
          from: "2026-03-03 13:00",
          until: "2026-03-10 13:00",
          getNumberOfEvents: 2,
        }),
      ),
    ).toEqual([
      "C 03-03 13:00:00 -> 03-04 09:00:00 (skip for B)",
      "C 03-04 09:00:01 -> 03-05 09:00:00",
    ]);
  });

  test("now just before a skip starts: the person now, then who takes over", () => {
    expect(
      describeEvents(
        resolve({
          layers: [ABCD],
          overrides: [
            away({
              who: "B",
              from: "2026-03-03 12:00",
              until: "2026-03-04 12:00",
            }),
          ],
          from: "2026-03-03 11:00",
          until: "2026-03-10 11:00",
          getNumberOfEvents: 2,
        }),
      ),
    ).toEqual([
      "B 03-03 11:00:00 -> 03-03 12:00:00",
      "C 03-03 12:00:00 -> 03-04 09:00:00 (skip for B)",
    ]);
  });
});

describe("One expansion, several policy contexts", () => {
  const overrides: Array<UserOverrideRecord> = [
    away({ who: "B", from: "2026-03-03 00:00", until: "2026-03-04 12:00" }),
    away({
      who: "C",
      from: "2026-03-04 00:00",
      until: "2026-03-05 12:00",
      policy: "P",
    }),
    away({
      who: "D",
      from: "2026-03-05 12:00",
      until: "2026-03-05 18:00",
      cover: "Z",
    }),
  ];

  test("resolving an expansion in each context gives what resolving afresh gives", () => {
    const expanded: ExpandedLayers = ScheduleResolution.expand({
      layers: [ABCD],
      calendarStartDate: at(WEEK_START),
      calendarEndDate: at(WEEK_END),
    });

    for (const policy of [undefined, "P", "Q", "P", undefined]) {
      expect(
        describeEvents(
          ScheduleResolution.resolveExpanded(expanded, {
            overrides,
            currentOnCallDutyPolicyId: policy,
          }),
        ),
      ).toEqual(describeEvents(resolve({ layers: [ABCD], overrides, policy })));
    }
  });

  test("resolving leaves the expansion as it was", () => {
    const expanded: ExpandedLayers = ScheduleResolution.expand({
      layers: [
        ABCD,
        layer({ people: ["E", "F"], every: EventInterval.Week }),
      ],
      calendarStartDate: at(WEEK_START),
      calendarEndDate: at(WEEK_END),
    });

    const before: string = JSON.stringify(expanded);

    ScheduleResolution.resolveExpanded(expanded, {
      overrides,
      currentOnCallDutyPolicyId: "P",
    });
    ScheduleResolution.resolveExpanded(expanded, { getNumberOfEvents: 1 });

    expect(JSON.stringify(expanded)).toBe(before);
  });

  test("an expansion cut short by the iteration cap says so", () => {
    const result: LayerEventsResult = ScheduleResolution.resolve(
      {
        layers: [
          layer({
            people: ["A", "B"],
            every: EventInterval.Hour,
            restriction: dailyHours("09:00", "10:00"),
            startsAt: "2020-01-01 09:00",
          }),
        ],
        calendarStartDate: at(WEEK_START),
        calendarEndDate: at(WEEK_END),
        overrides,
      },
      { maxSimulationIterations: 10 },
    );

    expect(result.truncated).toBe(true);
  });
});

describe("Invariants over a seeded sweep of schedules and time away", () => {
  const POOL: Array<string> = ["A", "B", "C", "D", "E", "F"];

  interface Scenario {
    layers: Array<LayerProps>;
    peopleByLayerId: Map<string, Array<string>>;
    overrides: Array<UserOverrideRecord>;
  }

  const SWEEP_START: Date = at("2026-03-02 00:00");
  const SWEEP_HOURS: number = 24 * 8;

  function draw(random: SeededRandom, index: number): Scenario {
    const layers: Array<LayerProps> = [];
    const peopleByLayerId: Map<string, Array<string>> = new Map();
    const layerCount: number = 1 + random(3);

    for (let i: number = 0; i < layerCount; i++) {
      const people: Array<string> = [];
      const size: number = 1 + random(4);

      for (let j: number = 0; j < size; j++) {
        people.push(POOL[random(POOL.length)]!);
      }

      const id: string = `L${index}-${i}`;
      peopleByLayerId.set(id, people);

      layers.push(
        layer({
          people,
          id,
          every: [EventInterval.Day, EventInterval.Hour, EventInterval.Week][
            random(3)
          ],
          startsAt: `2026-03-0${1 + random(3)} 0${random(10)}:00`,
          restriction:
            random(3) === 0
              ? dailyHours(`0${random(10)}:00`, `1${random(10)}:00`)
              : undefined,
        }),
      );
    }

    const overrides: Array<UserOverrideRecord> = [];
    const overrideCount: number = random(7);

    for (let i: number = 0; i < overrideCount; i++) {
      const startHour: number = random(SWEEP_HOURS);
      const hours: number = 1 + random(72);

      const record: UserOverrideRecord = {
        overrideUserId: POOL[random(POOL.length)]!,
        startsAt: new Date(SWEEP_START.getTime() + startHour * 3600000),
        endsAt: new Date(
          SWEEP_START.getTime() + (startHour + hours) * 3600000,
        ),
        onCallDutyPolicyId: random(3) === 0 ? "P" : null,
      };

      if (random(3) === 0) {
        record.routeAlertsToUserId = ["Z", ...POOL][random(POOL.length + 1)]!;
      }

      overrides.push(record);
    }

    return { layers, peopleByLayerId, overrides };
  }

  function isAwayDuring(
    overrides: Array<UserOverrideRecord>,
    who: string,
    event: CalendarEvent,
  ): boolean {
    return overrides.some((record: UserOverrideRecord) => {
      return (
        record.overrideUserId === who &&
        record.startsAt.getTime() < event.end.getTime() &&
        record.endsAt.getTime() > event.start.getTime()
      );
    });
  }

  const random: SeededRandom = seededRandom(4183);
  const scenarios: Array<Scenario> = [];

  for (let i: number = 0; i < 120; i++) {
    scenarios.push(draw(random, i));
  }

  test("segments never overlap, and nobody away is on call through the rotation", () => {
    for (const [index, scenario] of scenarios.entries()) {
      for (const policy of [undefined, "P"]) {
        const applicable: Array<UserOverrideRecord> =
          UserOverrideUtil.getApplicableOverrides(scenario.overrides, policy);

        const events: Array<CalendarEvent> = ScheduleResolution.resolve({
          layers: scenario.layers,
          calendarStartDate: SWEEP_START,
          calendarEndDate: new Date(
            SWEEP_START.getTime() + SWEEP_HOURS * 3600000,
          ),
          overrides: scenario.overrides,
          currentOnCallDutyPolicyId: policy,
        }).events;

        for (let i: number = 1; i < events.length; i++) {
          expect({
            index,
            overlap: events[i]!.start.getTime() < events[i - 1]!.end.getTime(),
          }).toEqual({ index, overlap: false });
        }

        for (const event of events) {
          const meta: OverrideEventMeta | null =
            UserOverrideUtil.getOverrideMeta(event);

          /*
           * A named cover is who it names, away or not (overrides do not
           * chain). Everybody else on call is not away at that time.
           */
          if (meta && !meta.isSkip) {
            continue;
          }

          expect({
            index,
            policy,
            who: event.title,
            away: isAwayDuring(applicable, event.title, event),
          }).toEqual({ index, policy, who: event.title, away: false });
        }
      }
    }
  });

  test("a turn handed on goes to somebody in the same layer as the person away", () => {
    for (const scenario of scenarios) {
      const events: Array<CalendarEvent> = ScheduleResolution.resolve({
        layers: scenario.layers,
        calendarStartDate: SWEEP_START,
        calendarEndDate: new Date(
          SWEEP_START.getTime() + SWEEP_HOURS * 3600000,
        ),
        overrides: scenario.overrides,
      }).events;

      for (const event of events) {
        const meta: OverrideEventMeta | null =
          UserOverrideUtil.getOverrideMeta(event);

        if (!meta?.isSkip) {
          continue;
        }

        const people: Array<string> =
          scenario.peopleByLayerId.get(
            (event as unknown as Record<string, string>)["layerId"]!,
          ) || [];

        expect(people).toContain(meta.originalUserId);
        expect(people).toContain(event.title);
        expect(event.title).not.toBe(meta.originalUserId);
      }
    }
  });

  test("while nobody is skipped, who is on call is what it always was", () => {
    for (const [index, scenario] of scenarios.entries()) {
      const windowEnd: Date = new Date(
        SWEEP_START.getTime() + SWEEP_HOURS * 3600000,
      );

      const events: Array<CalendarEvent> = ScheduleResolution.resolve({
        layers: scenario.layers,
        calendarStartDate: SWEEP_START,
        calendarEndDate: windowEnd,
        overrides: scenario.overrides,
      }).events;

      const old: Array<CalendarEvent> = UserOverrideUtil.applyOverridesToEvents(
        {
          events: new LayerUtil().getMultiLayerEvents({
            layers: scenario.layers,
            calendarStartDate: SWEEP_START,
            calendarEndDate: windowEnd,
          }),
          overrides: scenario.overrides,
        },
      );

      const skips: Array<UserOverrideRecord> =
        UserOverrideUtil.getApplicableOverrides(scenario.overrides).filter(
          (record: UserOverrideRecord) => {
            return UserOverrideUtil.isSkip(record);
          },
        );

      // Every 37 minutes, wherever no skip of anybody is in force.
      for (
        let instant: number = SWEEP_START.getTime() + 60000;
        instant < windowEnd.getTime();
        instant += 37 * 60000
      ) {
        const isSkipInForce: boolean = skips.some(
          (record: UserOverrideRecord) => {
            return (
              record.startsAt.getTime() <= instant + 1000 &&
              record.endsAt.getTime() >= instant - 1000
            );
          },
        );

        if (isSkipInForce) {
          continue;
        }

        expect({
          index,
          instant: new Date(instant).toISOString(),
          who: onCallAt(events, new Date(instant)),
        }).toEqual({
          index,
          instant: new Date(instant).toISOString(),
          who: onCallAt(old, new Date(instant)),
        });
      }
    }
  });
});
