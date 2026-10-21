import fs from "fs";
import path from "path";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import AlertState from "../../Models/DatabaseModels/AlertState";
import ObjectID from "../../Types/ObjectID";
import AcknowledgedStateUtil, {
  AcknowledgedStateList,
} from "../../Utils/AcknowledgedState";
import ResolvedStateUtil, {
  ResolvedStateTimelineRow,
} from "../../Utils/ResolvedState";
import StartingStageUtil, { StartingStage } from "../../Utils/StartingStage";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ONE ACKNOWLEDGED RULE: a record is acknowledged when its state is at or
 * below its project's acknowledged state - the first state from the top
 * flagged acknowledged - or carries the acknowledged flag itself, or is
 * resolved, which is further along still. A state of the project's own
 * between Acknowledged and Resolved ("Investigating") is acknowledged:
 * Acknowledge is not offered for it, and on-call stops for it. These pin the
 * rule for both lists it reads (incident states, which incident episodes
 * share, and alert states, which alert episodes share), on models and on
 * their JSON alike, and run the table the mobile app's copy runs too.
 */

interface Row {
  _id: string;
  name: string;
  order: number | null;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

const IDENTIFIED: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000b1",
  name: "Identified",
  order: 1,
  isCreatedState: true,
};
const TRIAGE: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000b2",
  name: "Triage",
  order: 2,
};
const ACKNOWLEDGED: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000b3",
  name: "Acknowledged",
  order: 3,
  isAcknowledgedState: true,
};
const INVESTIGATING: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000b4",
  name: "Investigating",
  order: 4,
};
const RESOLVED: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000b5",
  name: "Resolved",
  order: 5,
  isResolvedState: true,
};
const CLOSED: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000b6",
  name: "Closed",
  order: 6,
};

// Listed out of order on purpose: the rule reads the order, not the position.
const ROWS: Array<Row> = [
  CLOSED,
  INVESTIGATING,
  RESOLVED,
  TRIAGE,
  IDENTIFIED,
  ACKNOWLEDGED,
];

const LISTS: Array<[string, AcknowledgedStateList]> = [
  ["incident states", StateListType.IncidentState],
  ["alert states", StateListType.AlertState],
];

function asModels(
  list: AcknowledgedStateList,
  rows: Array<Row>,
): Array<IncidentState | AlertState> {
  return rows.map((row: Row): IncidentState | AlertState => {
    const state: IncidentState | AlertState =
      list === StateListType.IncidentState
        ? new IncidentState()
        : new AlertState();
    state._id = row._id;
    state.name = row.name;
    if (row.order !== null) {
      state.order = row.order;
    }
    state.isCreatedState = Boolean(row.isCreatedState);
    state.isAcknowledgedState = Boolean(row.isAcknowledgedState);
    state.isResolvedState = Boolean(row.isResolvedState);
    return state;
  });
}

function idsOf(states: Array<unknown>): Array<string> {
  return states.map((state: unknown): string => {
    return (state as { _id: string })._id;
  });
}

function toStrings(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID): string => {
    return id.toString();
  });
}

describe.each(LISTS)(
  "the acknowledged rule over %s",
  (_name: string, list: AcknowledgedStateList) => {
    describe.each([
      [
        "their JSON",
        (rows: Array<Row>): Array<unknown> => {
          return rows;
        },
      ],
      [
        "models",
        (rows: Array<Row>): Array<unknown> => {
          return asModels(list, rows);
        },
      ],
    ] as Array<[string, (rows: Array<Row>) => Array<unknown>]>)(
      "read from %s",
      (_shape: string, shape: (rows: Array<Row>) => Array<unknown>) => {
        const states: Array<unknown> = shape(ROWS);

        test("the acknowledged state is the one flagged, wherever it is listed", () => {
          const acknowledged: unknown =
            AcknowledgedStateUtil.getAcknowledgedState({ list, states });

          expect((acknowledged as { _id: string })._id).toBe(ACKNOWLEDGED._id);
          expect(
            AcknowledgedStateUtil.getAcknowledgedOrder({ list, states }),
          ).toBe(3);
        });

        test.each([
          ["Identified", IDENTIFIED, false],
          ["a state of its own before Acknowledged", TRIAGE, false],
          ["Acknowledged", ACKNOWLEDGED, true],
          [
            "a state of its own between Acknowledged and Resolved, not flagged",
            INVESTIGATING,
            true,
          ],
          ["Resolved: further along still", RESOLVED, true],
          ["a state of its own placed after Resolved", CLOSED, true],
        ] as Array<[string, Row, boolean]>)(
          "%s: acknowledged %s",
          (_label: string, row: Row, acknowledged: boolean) => {
            expect(
              AcknowledgedStateUtil.isAcknowledged({
                list,
                states,
                stateId: row._id,
              }),
            ).toBe(acknowledged);
            expect(
              AcknowledgedStateUtil.isAcknowledged({
                list,
                states,
                stateId: new ObjectID(row._id),
              }),
            ).toBe(acknowledged);
            expect(
              AcknowledgedStateUtil.isStateAcknowledged({
                list,
                states,
                state: row,
              }),
            ).toBe(acknowledged);
          },
        );

        test("ids are read whatever their case and surrounding spaces", () => {
          expect(
            AcknowledgedStateUtil.isAcknowledged({
              list,
              states,
              stateId: ` ${INVESTIGATING._id.toUpperCase()} `,
            }),
          ).toBe(true);
        });

        test("a state that is none of the project's, or no state, is not acknowledged", () => {
          for (const stateId of [
            "0193c0de-5a7e-4eee-8fff-0000000000ff",
            "",
            null,
            undefined,
          ]) {
            expect(
              AcknowledgedStateUtil.isAcknowledged({ list, states, stateId }),
            ).toBe(false);
          }

          expect(
            AcknowledgedStateUtil.isStateAcknowledged({
              list,
              states,
              state: null,
            }),
          ).toBe(false);
        });

        test("splits the project's states, in the order given", () => {
          expect(
            idsOf(
              AcknowledgedStateUtil.getAcknowledgedStates({ list, states }),
            ),
          ).toEqual([
            CLOSED._id,
            INVESTIGATING._id,
            RESOLVED._id,
            ACKNOWLEDGED._id,
          ]);
          expect(
            idsOf(
              AcknowledgedStateUtil.getUnacknowledgedStates({ list, states }),
            ),
          ).toEqual([TRIAGE._id, IDENTIFIED._id]);
          expect(
            idsOf(
              AcknowledgedStateUtil.getAcknowledgedUnresolvedStates({
                list,
                states,
              }),
            ),
          ).toEqual([INVESTIGATING._id, ACKNOWLEDGED._id]);
        });

        test("and gives their ids as ObjectIDs, for a query", () => {
          expect(
            toStrings(
              AcknowledgedStateUtil.getAcknowledgedStateIds({ list, states }),
            ),
          ).toEqual([
            CLOSED._id,
            INVESTIGATING._id,
            RESOLVED._id,
            ACKNOWLEDGED._id,
          ]);
          expect(
            toStrings(
              AcknowledgedStateUtil.getUnacknowledgedStateIds({ list, states }),
            ),
          ).toEqual([TRIAGE._id, IDENTIFIED._id]);
          expect(
            toStrings(
              AcknowledgedStateUtil.getAcknowledgedUnresolvedStateIds({
                list,
                states,
              }),
            ),
          ).toEqual([INVESTIGATING._id, ACKNOWLEDGED._id]);
        });

        test("the three lists cover every state exactly once", () => {
          const acknowledged: Set<string> = new Set(
            idsOf(
              AcknowledgedStateUtil.getAcknowledgedStates({ list, states }),
            ),
          );
          const unacknowledged: Array<string> = idsOf(
            AcknowledgedStateUtil.getUnacknowledgedStates({ list, states }),
          );

          for (const id of unacknowledged) {
            expect(acknowledged.has(id)).toBe(false);
          }

          expect(acknowledged.size + unacknowledged.length).toBe(ROWS.length);
        });
      },
    );

    test("the acknowledged state is the first flagged from the top when two are", () => {
      const escalated: Row = {
        _id: "0193c0de-5a7e-4eee-8fff-0000000000b7",
        name: "Escalated",
        order: 4,
        isAcknowledgedState: true,
      };

      for (const states of [
        [escalated, ...ROWS],
        [...ROWS, escalated],
      ]) {
        expect(
          (AcknowledgedStateUtil.getAcknowledgedState({ list, states }) as Row)
            ._id,
        ).toBe(ACKNOWLEDGED._id);
      }
    });

    test("a flagged state with a place is preferred over one without", () => {
      const unplaced: Row = {
        _id: "0193c0de-5a7e-4eee-8fff-0000000000b8",
        name: "Unplaced",
        order: null,
        isAcknowledgedState: true,
      };

      expect(
        (
          AcknowledgedStateUtil.getAcknowledgedState({
            list,
            states: [unplaced, ACKNOWLEDGED],
          }) as Row
        )._id,
      ).toBe(ACKNOWLEDGED._id);
    });

    test("a flagged state is acknowledged wherever it sits, and so is a resolved one", () => {
      const earlyAcknowledged: Row = {
        ...TRIAGE,
        isAcknowledgedState: true,
      };
      const earlyResolved: Row = { ...TRIAGE, isResolvedState: true };

      expect(
        AcknowledgedStateUtil.isStateAcknowledged({
          list,
          states: ROWS,
          state: earlyAcknowledged,
        }),
      ).toBe(true);
      expect(
        AcknowledgedStateUtil.isStateAcknowledged({
          list,
          states: ROWS,
          state: earlyResolved,
        }),
      ).toBe(true);
    });

    test("without an acknowledged state, only resolving or the flag acknowledges", () => {
      const states: Array<Row> = [IDENTIFIED, TRIAGE, RESOLVED, CLOSED];

      expect(
        AcknowledgedStateUtil.getAcknowledgedState({ list, states }),
      ).toBeNull();
      expect(
        AcknowledgedStateUtil.getAcknowledgedOrder({ list, states }),
      ).toBeNull();
      expect(
        AcknowledgedStateUtil.isAcknowledged({
          list,
          states,
          stateId: TRIAGE._id,
        }),
      ).toBe(false);
      expect(
        AcknowledgedStateUtil.isAcknowledged({
          list,
          states,
          stateId: CLOSED._id,
        }),
      ).toBe(true);
    });

    test("a project with no states at all has none of either", () => {
      expect(
        AcknowledgedStateUtil.getAcknowledgedState({ list, states: [] }),
      ).toBeNull();
      expect(
        AcknowledgedStateUtil.getAcknowledgedStates({ list, states: [] }),
      ).toEqual([]);
      expect(
        AcknowledgedStateUtil.getUnacknowledgedStateIds({ list, states: [] }),
      ).toEqual([]);
    });

    test("every state that counts as resolved counts as acknowledged", () => {
      const resolved: Array<string> = idsOf(
        ResolvedStateUtil.getResolvedStates({ list, states: ROWS }),
      );
      const acknowledged: Set<string> = new Set(
        idsOf(
          AcknowledgedStateUtil.getAcknowledgedStates({ list, states: ROWS }),
        ),
      );

      expect(resolved.length).toBeGreaterThan(0);

      for (const id of resolved) {
        expect(acknowledged.has(id)).toBe(true);
      }
    });

    test("it says what StartingStage says: acknowledged is every stage but Open", () => {
      for (const row of ROWS) {
        const stage: StartingStage | null = StartingStageUtil.getStage({
          definition: STATE_LISTS[list],
          states: ROWS,
          stateId: row._id,
        });

        expect(stage).not.toBeNull();
        expect(stage !== StartingStage.Open).toBe(
          AcknowledgedStateUtil.isAcknowledged({
            list,
            states: ROWS,
            stateId: row._id,
          }),
        );
      }
    });
  },
);

/*
 * The acknowledged stage - acknowledged but not resolved - is what a badge,
 * a filter or a metric's "acknowledged" attribute names; and what the
 * services that acknowledge say instead of moving a record back up its list.
 */
describe.each(LISTS)(
  "the acknowledged stage and the refusal over %s",
  (_name: string, list: AcknowledgedStateList) => {
    test.each([
      [IDENTIFIED, false],
      [TRIAGE, false],
      [ACKNOWLEDGED, true],
      [INVESTIGATING, true],
      [RESOLVED, false],
      [CLOSED, false],
    ] as Array<[Row, boolean]>)(
      "a record in $name is in the acknowledged stage: %s",
      (row: Row, expected: boolean) => {
        expect(
          AcknowledgedStateUtil.isAcknowledgedUnresolved({
            list: list,
            states: ROWS,
            stateId: row._id,
          }),
        ).toBe(expected);
      },
    );

    test("a state that is none of the project's is in no stage", () => {
      expect(
        AcknowledgedStateUtil.isAcknowledgedUnresolved({
          list: list,
          states: ROWS,
          stateId: "0193c0de-5a7e-4eee-8fff-0000000000ff",
        }),
      ).toBe(false);
    });

    test.each([
      [IDENTIFIED, null],
      [TRIAGE, null],
      [ACKNOWLEDGED, "Incident is already acknowledged."],
      [INVESTIGATING, "Incident is already acknowledged."],
      [RESOLVED, "Incident is already resolved."],
      [CLOSED, "Incident is already resolved."],
    ] as Array<[Row, string | null]>)(
      "acknowledging a record in %s is refused with: %s",
      (row: Row, expected: string | null) => {
        expect(
          AcknowledgedStateUtil.getAcknowledgeRefusal({
            list: list,
            states: ROWS,
            stateId: row._id,
            subject: "Incident",
          }),
        ).toBe(expected);
      },
    );

    test("the refusal names the record as asked", () => {
      expect(
        AcknowledgedStateUtil.getAcknowledgeRefusal({
          list: list,
          states: ROWS,
          stateId: INVESTIGATING._id,
          subject: "Episode",
        }),
      ).toBe("Episode is already acknowledged.");
    });

    test("a record whose state is none of the project's may be acknowledged", () => {
      expect(
        AcknowledgedStateUtil.getAcknowledgeRefusal({
          list: list,
          states: ROWS,
          stateId: undefined,
          subject: "Alert",
        }),
      ).toBeNull();
    });
  },
);

describe("when a record was acknowledged, by its timeline", () => {
  const list: AcknowledgedStateList = StateListType.IncidentState;
  const START: number = Date.parse("2026-10-07T09:00:00.000Z");

  interface TimelineRow extends ResolvedStateTimelineRow {
    id: string;
  }

  function at(id: string, row: Row, minutes: number): TimelineRow {
    return {
      id: id,
      stateId: row._id,
      startsAt: new Date(START + minutes * 60 * 1000),
    };
  }

  function acknowledgementIds(timeline: Array<TimelineRow>): Array<string> {
    return AcknowledgedStateUtil.getAcknowledgementRows({
      list,
      states: ROWS,
      timeline,
    }).map((row: TimelineRow): string => {
      return row.id;
    });
  }

  test("the move into Acknowledged is the acknowledgement; moving on is not another", () => {
    const timeline: Array<TimelineRow> = [
      at("t1", IDENTIFIED, 0),
      at("t2", ACKNOWLEDGED, 5),
      at("t3", INVESTIGATING, 20),
      at("t4", RESOLVED, 60),
      at("t5", CLOSED, 90),
    ];

    expect(acknowledgementIds(timeline)).toEqual(["t2"]);
    expect(
      AcknowledgedStateUtil.getFirstAcknowledgedAt({
        list,
        states: ROWS,
        timeline,
      }),
    ).toEqual(new Date(START + 5 * 60 * 1000));
  });

  test("a move straight into a state after Acknowledged acknowledges it then", () => {
    const timeline: Array<TimelineRow> = [
      at("t1", IDENTIFIED, 0),
      at("t2", TRIAGE, 3),
      at("t3", INVESTIGATING, 12),
      at("t4", RESOLVED, 40),
    ];

    expect(acknowledgementIds(timeline)).toEqual(["t3"]);
    expect(
      AcknowledgedStateUtil.getFirstAcknowledgedAt({
        list,
        states: ROWS,
        timeline,
      }),
    ).toEqual(new Date(START + 12 * 60 * 1000));
  });

  test("a record resolved straight away was acknowledged by that resolve", () => {
    const timeline: Array<TimelineRow> = [
      at("t1", IDENTIFIED, 0),
      at("t2", RESOLVED, 30),
    ];

    expect(acknowledgementIds(timeline)).toEqual(["t2"]);
  });

  test("a record reopened and acknowledged again has two acknowledgements, and the first is when it was first acknowledged", () => {
    const timeline: Array<TimelineRow> = [
      at("t1", IDENTIFIED, 0),
      at("t2", ACKNOWLEDGED, 5),
      at("t3", RESOLVED, 20),
      at("t4", IDENTIFIED, 60),
      at("t5", INVESTIGATING, 75),
    ];

    expect(acknowledgementIds(timeline)).toEqual(["t2", "t5"]);
    expect(
      AcknowledgedStateUtil.getFirstAcknowledgedAt({
        list,
        states: ROWS,
        timeline,
      }),
    ).toEqual(new Date(START + 5 * 60 * 1000));
  });

  test("a record created acknowledged was acknowledged at its first row", () => {
    expect(
      acknowledgementIds([at("t1", ACKNOWLEDGED, 0), at("t2", RESOLVED, 9)]),
    ).toEqual(["t1"]);
  });

  test("the timeline may arrive in any order; undated rows and other projects' states count for nothing", () => {
    const timeline: Array<TimelineRow> = [
      at("t4", RESOLVED, 60),
      { id: "undated", stateId: ACKNOWLEDGED._id, startsAt: null },
      at("t1", IDENTIFIED, 0),
      {
        id: "foreign",
        stateId: "0193c0de-5a7e-4eee-8fff-0000000000ff",
        startsAt: new Date(START + 2 * 60 * 1000),
      },
      at("t3", INVESTIGATING, 20),
    ];

    expect(acknowledgementIds(timeline)).toEqual(["t3"]);
  });

  test("a record that was never acknowledged has no acknowledgement time", () => {
    const timeline: Array<TimelineRow> = [
      at("t1", IDENTIFIED, 0),
      at("t2", TRIAGE, 4),
    ];

    expect(acknowledgementIds(timeline)).toEqual([]);
    expect(
      AcknowledgedStateUtil.getFirstAcknowledgedAt({
        list,
        states: ROWS,
        timeline,
      }),
    ).toBeUndefined();
    expect(
      AcknowledgedStateUtil.getFirstAcknowledgedAt({
        list,
        states: ROWS,
        timeline: [],
      }),
    ).toBeUndefined();
  });
});

/*
 * The table the mobile app's copy of the rules runs too
 * (MobileApp/src/utils/acknowledgedState.test.ts), case for case.
 */
interface StateRuleCase {
  name: string;
  states: Array<Record<string, unknown>>;
  acknowledgedStateId: string | null;
  resolvedStateId: string | null;
  acknowledged: Array<string>;
  unacknowledged: Array<string>;
  resolved: Array<string>;
  unresolved: Array<string>;
}

interface StateRuleLookup {
  stateId: string | null;
  acknowledged: boolean;
  resolved: boolean;
}

interface StateRuleTable {
  cases: Array<StateRuleCase>;
  lookups: { case: string; rows: Array<StateRuleLookup> };
}

const STATE_RULE_CASES_PATH: string = path.resolve(
  __dirname,
  "../../../MobileApp/src/__tests__/stateRuleCases.json",
);

const TABLE: StateRuleTable = JSON.parse(
  fs.readFileSync(STATE_RULE_CASES_PATH, "utf8"),
) as StateRuleTable;

function idOf(state: unknown): string | null {
  return state ? (state as { _id: string })._id ?? null : null;
}

describe.each(LISTS)(
  "the cases the mobile app's copy is checked against, over %s",
  (_name: string, list: AcknowledgedStateList) => {
    test("the table has cases to check", () => {
      expect(TABLE.cases.length).toBeGreaterThan(10);
    });

    test.each(
      TABLE.cases.map((ruleCase: StateRuleCase): [string, StateRuleCase] => {
        return [ruleCase.name, ruleCase];
      }),
    )("%s", (_caseName: string, ruleCase: StateRuleCase) => {
      const states: Array<unknown> = ruleCase.states;

      expect(
        idOf(AcknowledgedStateUtil.getAcknowledgedState({ list, states })),
      ).toBe(ruleCase.acknowledgedStateId);
      expect(idOf(ResolvedStateUtil.getResolvedState({ list, states }))).toBe(
        ruleCase.resolvedStateId,
      );
      expect(
        idsOf(AcknowledgedStateUtil.getAcknowledgedStates({ list, states })),
      ).toEqual(ruleCase.acknowledged);
      expect(
        idsOf(AcknowledgedStateUtil.getUnacknowledgedStates({ list, states })),
      ).toEqual(ruleCase.unacknowledged);
      expect(
        idsOf(ResolvedStateUtil.getResolvedStates({ list, states })),
      ).toEqual(ruleCase.resolved);
      expect(
        idsOf(ResolvedStateUtil.getUnresolvedStates({ list, states })),
      ).toEqual(ruleCase.unresolved);

      for (const state of ruleCase.states) {
        const stateId: string = state["_id"] as string;

        expect(
          AcknowledgedStateUtil.isAcknowledged({ list, states, stateId }),
        ).toBe(ruleCase.acknowledged.includes(stateId));
        expect(ResolvedStateUtil.isResolved({ list, states, stateId })).toBe(
          ruleCase.resolved.includes(stateId),
        );
      }
    });

    test.each(
      TABLE.lookups.rows.map(
        (row: StateRuleLookup): [string, StateRuleLookup] => {
          return [JSON.stringify(row.stateId), row];
        },
      ),
    )("looking up %s", (_rowName: string, row: StateRuleLookup) => {
      const ruleCase: StateRuleCase | undefined = TABLE.cases.find(
        (candidate: StateRuleCase) => {
          return candidate.name === TABLE.lookups.case;
        },
      );

      expect(ruleCase).toBeDefined();
      expect(
        AcknowledgedStateUtil.isAcknowledged({
          list,
          states: ruleCase!.states,
          stateId: row.stateId,
        }),
      ).toBe(row.acknowledged);
      expect(
        ResolvedStateUtil.isResolved({
          list,
          states: ruleCase!.states,
          stateId: row.stateId,
        }),
      ).toBe(row.resolved);
    });
  },
);
