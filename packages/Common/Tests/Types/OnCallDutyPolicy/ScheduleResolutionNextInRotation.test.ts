import CalendarEvent from "../../../Types/Calendar/CalendarEvent";
import EventInterval from "../../../Types/Events/EventInterval";
import { LayerProps } from "../../../Types/OnCallDutyPolicy/Layer";
import ScheduleResolution, {
  NextInRotation,
} from "../../../Types/OnCallDutyPolicy/ScheduleResolution";
import UserOverrideUtil, {
  UserOverrideRecord,
} from "../../../Types/OnCallDutyPolicy/UserOverrideUtil";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { at, away, dailyHours, layer, onCallAt } from "./SkipTestFixtures";
import { describe, expect, test } from "@jest/globals";

/*
 * WHO IS NEXT IN THE ROTATION - THE BACKUP TO WHOEVER IS ON CALL.
 *
 * A customer asked for an escalation path that pages the primary on-call
 * person, then - if they do not acknowledge - the next person in the SAME
 * rotation, then the wider team. An escalation rule can now page "Next in
 * rotation" of an on-call schedule: ScheduleResolution.resolveNextInRotation
 * answers who that is, from the same resolution as "who is on call".
 *
 * These pin it: one person, two, several, the end of the list wrapping
 * round, people away (skipped or covered) passed over, the on-call person
 * themselves away, the same person twice in a list, several layers and
 * restricted hours (the rotation is the layer whoever is on call comes
 * from), policy-scoped overrides, nobody on call, purity, and a seeded sweep
 * that holds the answer to the schedule's own skip: the next person in the
 * rotation is exactly who the schedule would page if the person on call were
 * away.
 *
 * The base schedule: A, B, C and D take turns of a day, A first, handing
 * over at 09:00 UTC from Monday 2 March 2026 - A has Mar 2, B Mar 3, C Mar 4,
 * D Mar 5, A again Mar 6.
 */

const ABCD: LayerProps = layer({ people: ["A", "B", "C", "D"] });

function nextAt(data: {
  layers: Array<LayerProps>;
  at: string;
  overrides?: Array<UserOverrideRecord> | undefined;
  policy?: string | undefined;
}): NextInRotation | null {
  return ScheduleResolution.resolveNextInRotation({
    layers: data.layers,
    at: at(data.at),
    overrides: data.overrides || [],
    currentOnCallDutyPolicyId: data.policy,
  });
}

// "A -> B": who is on call, and who is next ("-" for nobody).
function describeNext(result: NextInRotation | null): string {
  if (!result) {
    return "nobody on call";
  }

  return `${result.onCallUserId} -> ${result.nextUserId || "-"}`;
}

describe("the next person in a rotation of several", () => {
  test("on A's turn the next person is B", () => {
    expect(describeNext(nextAt({ layers: [ABCD], at: "2026-03-02 12:00" }))).toBe(
      "A -> B",
    );
  });

  test("each day it is the person after whoever is on call", () => {
    expect(
      [
        "2026-03-02 12:00",
        "2026-03-03 12:00",
        "2026-03-04 12:00",
        "2026-03-05 12:00",
        "2026-03-06 12:00",
      ].map((moment: string): string => {
        return describeNext(nextAt({ layers: [ABCD], at: moment }));
      }),
    ).toEqual(["A -> B", "B -> C", "C -> D", "D -> A", "A -> B"]);
  });

  test("the end of the list wraps round to its start: after D comes A", () => {
    expect(
      describeNext(nextAt({ layers: [ABCD], at: "2026-03-05 23:59" })),
    ).toBe("D -> A");
  });

  test("just before and just after a hand-off, the answer follows the turn", () => {
    expect(
      describeNext(nextAt({ layers: [ABCD], at: "2026-03-03 08:59" })),
    ).toBe("A -> B");
    expect(
      describeNext(nextAt({ layers: [ABCD], at: "2026-03-03 09:01" })),
    ).toBe("B -> C");
  });

  test("it says whose turn it is, and nothing is covered", () => {
    const result: NextInRotation | null = nextAt({
      layers: [ABCD],
      at: "2026-03-02 12:00",
    });

    expect(result?.onCallUserId).toBe("A");
    expect(result?.turnUserId).toBe("A");
    expect(result?.nextUserId).toBe("B");
  });

  test("a weekly rotation: the next person is next week's", () => {
    const weekly: LayerProps = layer({
      people: ["A", "B", "C"],
      every: EventInterval.Week,
    });

    expect(
      describeNext(nextAt({ layers: [weekly], at: "2026-03-04 12:00" })),
    ).toBe("A -> B");
    expect(
      describeNext(nextAt({ layers: [weekly], at: "2026-03-10 12:00" })),
    ).toBe("B -> C");
    expect(
      describeNext(nextAt({ layers: [weekly], at: "2026-03-17 12:00" })),
    ).toBe("C -> A");
  });
});

describe("one or two people", () => {
  test("one person in the rotation: nobody is next", () => {
    const result: NextInRotation | null = nextAt({
      layers: [layer({ people: ["A"] })],
      at: "2026-03-02 12:00",
    });

    expect(describeNext(result)).toBe("A -> -");
    expect(result?.nextUserId).toBeNull();
  });

  test("two people: each is the other's next", () => {
    const pair: LayerProps = layer({ people: ["A", "B"] });

    expect(describeNext(nextAt({ layers: [pair], at: "2026-03-02 12:00" }))).toBe(
      "A -> B",
    );
    expect(describeNext(nextAt({ layers: [pair], at: "2026-03-03 12:00" }))).toBe(
      "B -> A",
    );
  });

  test("the same person listed twice is never their own next", () => {
    const twice: LayerProps = layer({ people: ["A", "A"] });

    expect(
      describeNext(nextAt({ layers: [twice], at: "2026-03-02 12:00" })),
    ).toBe("A -> -");
  });
});

describe("people who are away are passed over", () => {
  test("B skipped (away, nobody named to cover): the next person is C", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: [
            away({ who: "B", from: "2026-03-01 00:00", until: "2026-03-09 00:00" }),
          ],
        }),
      ),
    ).toBe("A -> C");
  });

  test("B away with a cover named: still passed over - the next person is C, not the cover", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: [
            away({
              who: "B",
              cover: "Z",
              from: "2026-03-01 00:00",
              until: "2026-03-09 00:00",
            }),
          ],
        }),
      ),
    ).toBe("A -> C");
  });

  test("B and C away: the next person is D", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: [
            away({ who: "B", from: "2026-03-01 00:00", until: "2026-03-09 00:00" }),
            away({ who: "C", from: "2026-03-01 00:00", until: "2026-03-09 00:00" }),
          ],
        }),
      ),
    ).toBe("A -> D");
  });

  test("everybody else away: nobody is next", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: ["B", "C", "D"].map((who: string): UserOverrideRecord => {
            return away({
              who,
              from: "2026-03-01 00:00",
              until: "2026-03-09 00:00",
            });
          }),
        }),
      ),
    ).toBe("A -> -");
  });

  test("wrapping round passes over the away too: D on call, A away, the next is B", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-05 12:00",
          overrides: [
            away({ who: "A", from: "2026-03-05 00:00", until: "2026-03-05 23:00" }),
          ],
        }),
      ),
    ).toBe("D -> B");
  });

  test("time away that has not started yet, or has ended, changes nothing", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: [
            away({ who: "B", from: "2026-03-02 13:00", until: "2026-03-02 18:00" }),
          ],
        }),
      ),
    ).toBe("A -> B");

    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 19:00",
          overrides: [
            away({ who: "B", from: "2026-03-02 13:00", until: "2026-03-02 18:00" }),
          ],
        }),
      ),
    ).toBe("A -> B");
  });

  test("while B's time away is in force, C is next; once it ends, B again", () => {
    const overrides: Array<UserOverrideRecord> = [
      away({ who: "B", from: "2026-03-02 13:00", until: "2026-03-02 18:00" }),
    ];

    expect(
      [
        "2026-03-02 12:59",
        "2026-03-02 13:30",
        "2026-03-02 17:59",
        "2026-03-02 18:01",
      ].map((moment: string): string => {
        return describeNext(nextAt({ layers: [ABCD], at: moment, overrides }));
      }),
    ).toEqual(["A -> B", "A -> C", "A -> C", "A -> B"]);
  });
});

describe("the person on call is away themselves", () => {
  test("A skipped: B has A's turn and is on call, so the next person is C", () => {
    const result: NextInRotation | null = nextAt({
      layers: [ABCD],
      at: "2026-03-02 12:00",
      overrides: [
        away({ who: "A", from: "2026-03-01 00:00", until: "2026-03-03 00:00" }),
      ],
    });

    expect(result).toEqual({
      onCallUserId: "B",
      turnUserId: "A",
      nextUserId: "C",
    });
  });

  test("A covered by Z, who is not in the rotation: Z is on call, B is next", () => {
    const result: NextInRotation | null = nextAt({
      layers: [ABCD],
      at: "2026-03-02 12:00",
      overrides: [
        away({
          who: "A",
          cover: "Z",
          from: "2026-03-01 00:00",
          until: "2026-03-03 00:00",
        }),
      ],
    });

    expect(result).toEqual({
      onCallUserId: "Z",
      turnUserId: "A",
      nextUserId: "B",
    });
  });

  test("A covered by B, the next person: B is on call, so C is next", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: [
            away({
              who: "A",
              cover: "B",
              from: "2026-03-01 00:00",
              until: "2026-03-03 00:00",
            }),
          ],
        }),
      ),
    ).toBe("B -> C");
  });

  test("A covered by C, further down the list: C is on call, B is still next", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: [
            away({
              who: "A",
              cover: "C",
              from: "2026-03-01 00:00",
              until: "2026-03-03 00:00",
            }),
          ],
        }),
      ),
    ).toBe("C -> B");
  });

  test("A skipped and B away as well: C has the turn, D is next", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides: [
            away({ who: "A", from: "2026-03-01 00:00", until: "2026-03-03 00:00" }),
            away({ who: "B", from: "2026-03-01 00:00", until: "2026-03-03 00:00" }),
          ],
        }),
      ),
    ).toBe("C -> D");
  });
});

describe("the same person twice in one rotation", () => {
  const twice: LayerProps = layer({ people: ["A", "B", "A", "C"] });

  test("after A's first turn comes B; after A's second turn comes C", () => {
    expect(
      describeNext(nextAt({ layers: [twice], at: "2026-03-02 12:00" })),
    ).toBe("A -> B");
    expect(
      describeNext(nextAt({ layers: [twice], at: "2026-03-04 12:00" })),
    ).toBe("A -> C");
  });

  test("B away after A's first turn: A's other place is not A's backup, so C is next", () => {
    expect(
      describeNext(
        nextAt({
          layers: [twice],
          at: "2026-03-02 12:00",
          overrides: [
            away({ who: "B", from: "2026-03-01 00:00", until: "2026-03-09 00:00" }),
          ],
        }),
      ),
    ).toBe("A -> C");
  });
});

describe("several layers, restricted hours: the rotation is the layer whoever is on call comes from", () => {
  // Business hours (09:00-17:00) A and B take turns; around the clock below, C and D.
  const businessHours: LayerProps = layer({
    people: ["A", "B"],
    restriction: dailyHours("09:00", "17:00"),
    id: "Business hours",
  });
  const aroundTheClock: LayerProps = layer({
    people: ["C", "D"],
    id: "Around the clock",
  });

  test("in business hours: A is on call in the top layer, and B is next", () => {
    const result: NextInRotation | null = nextAt({
      layers: [businessHours, aroundTheClock],
      at: "2026-03-02 12:00",
    });

    expect(describeNext(result)).toBe("A -> B");
    expect(result?.layerName).toBe("Business hours");
    expect(result?.layerId).toBe("Business hours");
  });

  test("out of hours: C is on call in the layer below, and D is next - never somebody from the business-hours rotation", () => {
    const result: NextInRotation | null = nextAt({
      layers: [businessHours, aroundTheClock],
      at: "2026-03-02 20:00",
    });

    expect(describeNext(result)).toBe("C -> D");
    expect(result?.layerName).toBe("Around the clock");
  });

  test("the next person is the next in turn order, whether or not their own turn falls in the restricted hours", () => {
    // B's own turns are in business hours too, but B is A's backup now.
    expect(
      describeNext(
        nextAt({
          layers: [businessHours, aroundTheClock],
          at: "2026-03-02 16:59",
        }),
      ),
    ).toBe("A -> B");
  });

  test("a one-person top layer has nobody next: the layers below are other rotations", () => {
    expect(
      describeNext(
        nextAt({
          layers: [layer({ people: ["A"] }), aroundTheClock],
          at: "2026-03-02 12:00",
        }),
      ),
    ).toBe("A -> -");
  });

  test("everybody in the top layer away: the layer below has the time, and the next person comes from it", () => {
    expect(
      describeNext(
        nextAt({
          layers: [layer({ people: ["A", "B"] }), aroundTheClock],
          at: "2026-03-02 12:00",
          overrides: ["A", "B"].map((who: string): UserOverrideRecord => {
            return away({
              who,
              from: "2026-03-01 00:00",
              until: "2026-03-09 00:00",
            });
          }),
        }),
      ),
    ).toBe("C -> D");
  });

  test("an empty top layer leaves the layer below in charge", () => {
    expect(
      describeNext(
        nextAt({
          layers: [layer({ people: [] }), aroundTheClock],
          at: "2026-03-02 12:00",
        }),
      ),
    ).toBe("C -> D");
  });
});

describe("whose overrides apply", () => {
  test("a policy's own time away counts for that policy's pages only", () => {
    const overrides: Array<UserOverrideRecord> = [
      away({
        who: "B",
        policy: "policy-1",
        from: "2026-03-01 00:00",
        until: "2026-03-09 00:00",
      }),
    ];

    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides,
          policy: "policy-1",
        }),
      ),
    ).toBe("A -> C");

    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          overrides,
          policy: "policy-2",
        }),
      ),
    ).toBe("A -> B");

    expect(
      describeNext(nextAt({ layers: [ABCD], at: "2026-03-02 12:00", overrides })),
    ).toBe("A -> B");
  });

  test("global time away counts for every policy", () => {
    expect(
      describeNext(
        nextAt({
          layers: [ABCD],
          at: "2026-03-02 12:00",
          policy: "policy-1",
          overrides: [
            away({ who: "B", from: "2026-03-01 00:00", until: "2026-03-09 00:00" }),
          ],
        }),
      ),
    ).toBe("A -> C");
  });
});

describe("nobody on call", () => {
  test("no layers: nobody on call, so nobody is next", () => {
    expect(nextAt({ layers: [], at: "2026-03-02 12:00" })).toBeNull();
  });

  test("a layer with nobody in it", () => {
    expect(
      nextAt({ layers: [layer({ people: [] })], at: "2026-03-02 12:00" }),
    ).toBeNull();
  });

  test("outside a restricted layer's hours, with nothing below it", () => {
    expect(
      nextAt({
        layers: [
          layer({
            people: ["A", "B"],
            restriction: dailyHours("09:00", "17:00"),
          }),
        ],
        at: "2026-03-02 20:00",
      }),
    ).toBeNull();
  });

  test("before the rotation starts", () => {
    expect(nextAt({ layers: [ABCD], at: "2026-03-01 12:00" })).toBeNull();
  });

  test("everybody away: nobody is on call", () => {
    expect(
      nextAt({
        layers: [ABCD],
        at: "2026-03-02 12:00",
        overrides: ["A", "B", "C", "D"].map(
          (who: string): UserOverrideRecord => {
            return away({
              who,
              from: "2026-03-01 00:00",
              until: "2026-03-09 00:00",
            });
          },
        ),
      }),
    ).toBeNull();
  });
});

describe("it is pure", () => {
  test("the same question twice has the same answer, and changes neither the layers nor the overrides", () => {
    const overrides: Array<UserOverrideRecord> = [
      away({ who: "B", from: "2026-03-01 00:00", until: "2026-03-09 00:00" }),
    ];
    const layersBefore: string = JSON.stringify([ABCD]);
    const overridesBefore: string = JSON.stringify(overrides);

    const first: NextInRotation | null = nextAt({
      layers: [ABCD],
      at: "2026-03-02 12:00",
      overrides,
    });
    const second: NextInRotation | null = nextAt({
      layers: [ABCD],
      at: "2026-03-02 12:00",
      overrides,
    });

    expect(first).toEqual(second);
    expect(JSON.stringify([ABCD])).toBe(layersBefore);
    expect(JSON.stringify(overrides)).toBe(overridesBefore);
  });

  test("an expansion answered twice is answered the same: resolving does not change it", () => {
    const expanded: ReturnType<typeof ScheduleResolution.expand> =
      ScheduleResolution.expand({
        layers: [ABCD],
        calendarStartDate: at("2026-03-02 12:00"),
        calendarEndDate: at("2026-03-02 12:00:01"),
      });

    const options: {
      at: Date;
      overrides: Array<UserOverrideRecord>;
    } = {
      at: at("2026-03-02 12:00"),
      overrides: [
        away({ who: "A", from: "2026-03-01 00:00", until: "2026-03-03 00:00" }),
      ],
    };

    expect(
      ScheduleResolution.resolveNextInRotationExpanded(expanded, options),
    ).toEqual(
      ScheduleResolution.resolveNextInRotationExpanded(expanded, options),
    );
  });
});

describe("UserOverrideUtil.getNextInRotation on its own", () => {
  const start: Date = at("2026-03-02 12:00");
  const end: Date = at("2026-03-02 12:00:01");

  test("the person after the turn, wrapping round", () => {
    expect(
      UserOverrideUtil.getNextInRotation({
        userIds: ["A", "B", "C"],
        turnIndex: 2,
        start,
        end,
        overrides: [],
      }),
    ).toBe("A");
  });

  test("passes over the people it is told to, and the people away", () => {
    expect(
      UserOverrideUtil.getNextInRotation({
        userIds: ["A", "B", "C", "D"],
        turnIndex: 0,
        start,
        end,
        overrides: [
          away({ who: "C", from: "2026-03-01 00:00", until: "2026-03-09 00:00" }),
        ],
        excludeUserIds: ["B"],
      }),
    ).toBe("D");
  });

  test("a turn index outside the list, an empty list, or no time at all: nobody", () => {
    for (const turnIndex of [-1, 3, 1.5, Number.NaN]) {
      expect(
        UserOverrideUtil.getNextInRotation({
          userIds: ["A", "B", "C"],
          turnIndex,
          start,
          end,
          overrides: [],
        }),
      ).toBeNull();
    }

    expect(
      UserOverrideUtil.getNextInRotation({
        userIds: [],
        turnIndex: 0,
        start,
        end,
        overrides: [],
      }),
    ).toBeNull();

    expect(
      UserOverrideUtil.getNextInRotation({
        userIds: ["A", "B"],
        turnIndex: 0,
        start: end,
        end: start,
        overrides: [],
      }),
    ).toBeNull();
  });
});

/*
 * THE NEXT PERSON IS WHO THE SCHEDULE WOULD PAGE IF THE PERSON ON CALL WERE
 * AWAY - a seeded sweep that holds the two answers to each other.
 *
 * For a rotation with people skipped (no named covers), skipping the person
 * on call - and whose turn it is - at the moment makes the schedule hand
 * the turn to the first person after it who is not away: exactly the next
 * person in the rotation. Where nobody is next, the schedule has nobody on
 * call then either.
 */
describe("a seeded sweep: the next person is who the schedule pages when the person on call is skipped", () => {
  const PEOPLE: Array<string> = ["A", "B", "C", "D", "E", "F"];
  const MOMENTS: number = 400;

  test(`${MOMENTS} random rotations, people away and moments agree with the skip`, () => {
    const random: SeededRandom = seededRandom(4021);
    let checked: number = 0;
    let withNobodyNext: number = 0;

    for (let round: number = 0; round < MOMENTS; round++) {
      // 1 to 6 people, a person sometimes listed twice.
      const size: number = 1 + random(PEOPLE.length);
      const people: Array<string> = [];

      for (let i: number = 0; i < size; i++) {
        people.push(PEOPLE[random(PEOPLE.length)]!);
      }

      const every: EventInterval =
        random(2) === 0 ? EventInterval.Day : EventInterval.Hour;

      const rotationLayer: LayerProps = layer({ people, every });

      // Somewhere in the first week, on the minute.
      const moment: Date = at("2026-03-02 09:00");
      moment.setUTCMinutes(moment.getUTCMinutes() + 1 + random(7 * 24 * 60));

      // Up to three people away around the moment, all skipped.
      const overrides: Array<UserOverrideRecord> = [];
      const awayCount: number = random(4);

      for (let i: number = 0; i < awayCount; i++) {
        overrides.push({
          overrideUserId: PEOPLE[random(PEOPLE.length)]!,
          startsAt: new Date(moment.getTime() - (1 + random(600)) * 60000),
          endsAt: new Date(moment.getTime() + (1 + random(600)) * 60000),
        });
      }

      const result: NextInRotation | null =
        ScheduleResolution.resolveNextInRotation({
          layers: [rotationLayer],
          at: moment,
          overrides,
        });

      const withTheOnCallPersonAway: Array<CalendarEvent> = result
        ? ScheduleResolution.resolve({
            layers: [rotationLayer],
            calendarStartDate: moment,
            calendarEndDate: new Date(moment.getTime() + 1000),
            overrides: [
              ...overrides,
              ...[result.onCallUserId, result.turnUserId].map(
                (who: string): UserOverrideRecord => {
                  return {
                    overrideUserId: who,
                    startsAt: new Date(moment.getTime() - 60000),
                    endsAt: new Date(moment.getTime() + 60000),
                  };
                },
              ),
            ],
          }).events
        : [];

      if (!result) {
        continue;
      }

      checked++;

      if (!result.nextUserId) {
        withNobodyNext++;
      }

      expect({
        people,
        moment: moment.toISOString(),
        next: result.nextUserId,
      }).toEqual({
        people,
        moment: moment.toISOString(),
        next: onCallAt(withTheOnCallPersonAway, moment),
      });
    }

    // The sweep met both answers, many times.
    expect(checked).toBeGreaterThan(MOMENTS / 2);
    expect(withNobodyNext).toBeGreaterThan(10);
    expect(checked - withNobodyNext).toBeGreaterThan(MOMENTS / 4);
  });
});
