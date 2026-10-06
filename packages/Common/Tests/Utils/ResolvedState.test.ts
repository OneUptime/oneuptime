import IncidentState from "../../Models/DatabaseModels/IncidentState";
import AlertState from "../../Models/DatabaseModels/AlertState";
import ObjectID from "../../Types/ObjectID";
import ResolvedStateUtil, {
  ResolvedStateList,
  ResolvedStateTimelineRow,
} from "../../Utils/ResolvedState";
import { StateListType } from "../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ONE RULE: a record is resolved when its state is at or below its
 * project's resolved state - the first state from the top flagged resolved -
 * or carries the resolved flag itself. These pin it for both lists it reads
 * (incident states, which incident episodes share, and alert states, which
 * alert episodes share), on models and on their JSON alike.
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
  _id: "0193c0de-5a7e-4eee-8fff-0000000000a1",
  name: "Identified",
  order: 1,
  isCreatedState: true,
};
const ACKNOWLEDGED: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000a2",
  name: "Acknowledged",
  order: 2,
  isAcknowledgedState: true,
};
const INVESTIGATING: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000a3",
  name: "Investigating",
  order: 3,
};
const RESOLVED: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000a4",
  name: "Resolved",
  order: 4,
  isResolvedState: true,
};
const CLOSED: Row = {
  _id: "0193c0de-5a7e-4eee-8fff-0000000000a5",
  name: "Closed",
  order: 5,
};

// Listed out of order on purpose: the rule reads the order, not the position.
const ROWS: Array<Row> = [CLOSED, INVESTIGATING, RESOLVED, IDENTIFIED, ACKNOWLEDGED];

const LISTS: Array<[string, ResolvedStateList]> = [
  ["incident states", StateListType.IncidentState],
  ["alert states", StateListType.AlertState],
];

function asModels(
  list: ResolvedStateList,
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

describe.each(LISTS)("the one rule over %s", (_name: string, list: ResolvedStateList) => {
  describe.each([
    ["their JSON", (rows: Array<Row>): Array<unknown> => {
      return rows;
    }],
    ["models", (rows: Array<Row>): Array<unknown> => {
      return asModels(list, rows);
    }],
  ] as Array<[string, (rows: Array<Row>) => Array<unknown>]>)(
    "read from %s",
    (_shape: string, shape: (rows: Array<Row>) => Array<unknown>) => {
      const states: Array<unknown> = shape(ROWS);

      test("the resolved state is the one flagged, wherever it is listed", () => {
        const resolved: unknown = ResolvedStateUtil.getResolvedState({
          list,
          states,
        });

        expect((resolved as { _id: string })._id).toBe(RESOLVED._id);
        expect(ResolvedStateUtil.getResolvedOrder({ list, states })).toBe(4);
      });

      test.each([
        ["Identified", IDENTIFIED, false],
        ["Acknowledged", ACKNOWLEDGED, false],
        ["a state of its own before Resolved", INVESTIGATING, false],
        ["Resolved", RESOLVED, true],
        ["a state of its own placed after Resolved, not flagged", CLOSED, true],
      ] as Array<[string, Row, boolean]>)(
        "%s: resolved %s",
        (_label: string, row: Row, resolved: boolean) => {
          expect(
            ResolvedStateUtil.isResolved({ list, states, stateId: row._id }),
          ).toBe(resolved);
          expect(
            ResolvedStateUtil.isResolved({
              list,
              states,
              stateId: new ObjectID(row._id),
            }),
          ).toBe(resolved);
          expect(
            ResolvedStateUtil.isStateResolved({ list, states, state: row }),
          ).toBe(resolved);
        },
      );

      test("ids are read whatever their case", () => {
        expect(
          ResolvedStateUtil.isResolved({
            list,
            states,
            stateId: CLOSED._id.toUpperCase(),
          }),
        ).toBe(true);
      });

      test("splits the project's states, in the order given", () => {
        expect(
          ResolvedStateUtil.getResolvedStates({ list, states }).map(
            (state: unknown): string => {
              return (state as { _id: string })._id;
            },
          ),
        ).toEqual([CLOSED._id, RESOLVED._id]);
        expect(
          ResolvedStateUtil.getUnresolvedStates({ list, states }).map(
            (state: unknown): string => {
              return (state as { _id: string })._id;
            },
          ),
        ).toEqual([INVESTIGATING._id, IDENTIFIED._id, ACKNOWLEDGED._id]);
      });

      test("and gives their ids as ObjectIDs, for a query", () => {
        expect(
          ResolvedStateUtil.getResolvedStateIds({ list, states }).map(
            (id: ObjectID): string => {
              return id.toString();
            },
          ),
        ).toEqual([CLOSED._id, RESOLVED._id]);
        expect(
          ResolvedStateUtil.getUnresolvedStateIds({ list, states }).map(
            (id: ObjectID): string => {
              return id.toString();
            },
          ),
        ).toEqual([INVESTIGATING._id, IDENTIFIED._id, ACKNOWLEDGED._id]);
      });
    },
  );

  test("the resolved state is the first flagged from the top when two are", () => {
    const autoClosed: Row = {
      _id: "0193c0de-5a7e-4eee-8fff-0000000000a6",
      name: "Auto-closed",
      order: 6,
      isResolvedState: true,
    };
    const states: Array<Row> = [autoClosed, ...ROWS];

    expect(
      (
        ResolvedStateUtil.getResolvedState({ list, states }) as Row
      )._id,
    ).toBe(RESOLVED._id);
    // Both flagged ones, and Closed between them, are resolved.
    expect(
      ResolvedStateUtil.isResolved({ list, states, stateId: autoClosed._id }),
    ).toBe(true);
  });

  test("a flagged state is resolved wherever it is placed", () => {
    const early: Row = {
      _id: "0193c0de-5a7e-4eee-8fff-0000000000a7",
      name: "Done early",
      order: 1,
      isResolvedState: true,
    };

    expect(
      ResolvedStateUtil.isResolved({
        list,
        states: [early, { ...IDENTIFIED, order: 2 }],
        stateId: early._id,
      }),
    ).toBe(true);
  });

  test("a state none of the project's, or no state, is not resolved", () => {
    expect(
      ResolvedStateUtil.isResolved({
        list,
        states: ROWS,
        stateId: "0193c0de-5a7e-4eee-8fff-0000000000ff",
      }),
    ).toBe(false);
    expect(
      ResolvedStateUtil.isResolved({ list, states: ROWS, stateId: undefined }),
    ).toBe(false);
    expect(
      ResolvedStateUtil.isResolved({ list, states: ROWS, stateId: null }),
    ).toBe(false);
    expect(
      ResolvedStateUtil.isStateResolved({ list, states: ROWS, state: null }),
    ).toBe(false);
  });

  test("without a resolved state, only a flag says resolved", () => {
    const states: Array<Row> = [IDENTIFIED, CLOSED];

    expect(ResolvedStateUtil.getResolvedState({ list, states })).toBeNull();
    expect(ResolvedStateUtil.getResolvedOrder({ list, states })).toBeNull();
    expect(
      ResolvedStateUtil.isResolved({ list, states, stateId: CLOSED._id }),
    ).toBe(false);
    expect(ResolvedStateUtil.getUnresolvedStates({ list, states })).toEqual(
      states,
    );
  });

  test("a state with no place is resolved only by its own flag", () => {
    const unplaced: Row = {
      _id: "0193c0de-5a7e-4eee-8fff-0000000000a8",
      name: "Unplaced",
      order: null,
    };

    expect(
      ResolvedStateUtil.isResolved({
        list,
        states: [...ROWS, unplaced],
        stateId: unplaced._id,
      }),
    ).toBe(false);
  });
});

describe("when a record became resolved, off its timeline", () => {
  const list: ResolvedStateList = StateListType.IncidentState;

  function at(minutes: number): Date {
    return new Date(Date.UTC(2026, 9, 6, 8, minutes, 0));
  }

  function row(state: Row, minutes: number): ResolvedStateTimelineRow {
    return { stateId: state._id, startsAt: at(minutes) };
  }

  function resolutions(
    timeline: Array<ResolvedStateTimelineRow>,
  ): Array<Date | null | undefined> {
    return ResolvedStateUtil.getResolutionRows({
      list,
      states: ROWS,
      timeline,
    }).map((entry: ResolvedStateTimelineRow) => {
      return entry.startsAt;
    });
  }

  test("a resolve is the move into a resolved state from one that is not", () => {
    expect(
      resolutions([row(IDENTIFIED, 0), row(ACKNOWLEDGED, 5), row(RESOLVED, 30)]),
    ).toEqual([at(30)]);
  });

  test("moving on from Resolved into a state after it is no second resolve", () => {
    expect(
      resolutions([row(IDENTIFIED, 0), row(RESOLVED, 30), row(CLOSED, 45)]),
    ).toEqual([at(30)]);
  });

  test("a move straight into a state after Resolved is the resolve", () => {
    expect(resolutions([row(IDENTIFIED, 0), row(CLOSED, 20)])).toEqual([
      at(20),
    ]);
  });

  test("reopened and resolved again: two resolves", () => {
    expect(
      resolutions([
        row(IDENTIFIED, 0),
        row(RESOLVED, 10),
        row(INVESTIGATING, 20),
        row(CLOSED, 40),
      ]),
    ).toEqual([at(10), at(40)]);
  });

  test("a record that starts resolved resolved when it started", () => {
    expect(resolutions([row(CLOSED, 0)])).toEqual([at(0)]);
  });

  test("the timeline is read by when each row starts, in any order, and undated rows are left out", () => {
    expect(
      resolutions([
        row(RESOLVED, 30),
        { stateId: CLOSED._id, startsAt: null },
        row(IDENTIFIED, 0),
        row(CLOSED, 45),
      ]),
    ).toEqual([at(30)]);
  });

  test("a row in a state none of the project's is not resolved", () => {
    expect(
      resolutions([
        row(IDENTIFIED, 0),
        { stateId: "0193c0de-5a7e-4eee-8fff-0000000000ff", startsAt: at(5) },
      ]),
    ).toEqual([]);
  });

  test("the first resolve, and the one it is resolved by now", () => {
    const timeline: Array<ResolvedStateTimelineRow> = [
      row(IDENTIFIED, 0),
      row(RESOLVED, 10),
      row(INVESTIGATING, 20),
      row(RESOLVED, 40),
      row(CLOSED, 50),
    ];

    expect(
      ResolvedStateUtil.getFirstResolvedAt({ list, states: ROWS, timeline }),
    ).toEqual(at(10));
    expect(
      ResolvedStateUtil.getCurrentResolvedAt({ list, states: ROWS, timeline }),
    ).toEqual(at(40));
  });

  test("an open record - reopened since - has no current resolve, and keeps its first", () => {
    const timeline: Array<ResolvedStateTimelineRow> = [
      row(IDENTIFIED, 0),
      row(RESOLVED, 10),
      row(INVESTIGATING, 20),
    ];

    expect(
      ResolvedStateUtil.getCurrentResolvedAt({ list, states: ROWS, timeline }),
    ).toBeUndefined();
    expect(
      ResolvedStateUtil.getFirstResolvedAt({ list, states: ROWS, timeline }),
    ).toEqual(at(10));
  });

  test("a record never resolved has neither", () => {
    const timeline: Array<ResolvedStateTimelineRow> = [row(IDENTIFIED, 0)];

    expect(
      ResolvedStateUtil.getFirstResolvedAt({ list, states: ROWS, timeline }),
    ).toBeUndefined();
    expect(
      ResolvedStateUtil.getCurrentResolvedAt({ list, states: ROWS, timeline }),
    ).toBeUndefined();
  });
});
