import AlertState from "../../Models/DatabaseModels/AlertState";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import ObjectID from "../../Types/ObjectID";
import {
  STATE_LISTS,
  StateListDefinition,
  StateListType,
} from "../../Utils/StateOrder";
import StartingStageUtil, { StartingStage } from "../../Utils/StartingStage";
import { describe, expect, test } from "@jest/globals";

/*
 * How far along a new incident, alert or episode starts (StartingStage),
 * pinned without a database. The create hooks decide on it what a create
 * sets off: a record that starts open pages its on-call; one that starts
 * acknowledged pages nobody; one that starts resolved also sets off nothing
 * that answers a live problem.
 *
 * Each is what the rest of a record's life reads, so a record never starts
 * as one thing and lives as another:
 *
 *   - resolved is the state's resolved flag, which the state timelines read
 *     to stamp an episode's resolvedAt, to give an incident's monitors back,
 *     to draft its postmortem and grade its AI investigation;
 *   - acknowledged is any other state at or below the acknowledged state in
 *     the project's order (getStateListReachedBuiltIn), as on-call
 *     escalation reads it to stop paging - its place, not its name.
 */

const INCIDENT_STATES: StateListDefinition =
  STATE_LISTS[StateListType.IncidentState];
const ALERT_STATES: StateListDefinition = STATE_LISTS[StateListType.AlertState];

interface Row {
  _id: string;
  name: string;
  order: number | null;
  isCreatedState?: boolean;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}

const TRIAGE: string = "0193c0de-5a7e-4eee-8fff-0000000000a0";
const IDENTIFIED: string = "0193c0de-5a7e-4eee-8fff-0000000000a1";
const INVESTIGATING: string = "0193c0de-5a7e-4eee-8fff-0000000000a2";
const ACKNOWLEDGED: string = "0193c0de-5a7e-4eee-8fff-0000000000a3";
const MITIGATED: string = "0193c0de-5a7e-4eee-8fff-0000000000a4";
const RESOLVED: string = "0193c0de-5a7e-4eee-8fff-0000000000a5";
const POSTMORTEM: string = "0193c0de-5a7e-4eee-8fff-0000000000a6";
const ELSEWHERE: string = "0193c0de-5a7e-4eee-8fff-0000000000f9";

/*
 * A project that added states of its own around the built-ins: one before
 * the created state, one between created and acknowledged, one between
 * acknowledged and resolved, and one after resolved.
 */
const ROWS: Array<Row> = [
  { _id: TRIAGE, name: "Triage", order: 1 },
  { _id: IDENTIFIED, name: "Identified", order: 2, isCreatedState: true },
  { _id: INVESTIGATING, name: "Investigating", order: 3 },
  {
    _id: ACKNOWLEDGED,
    name: "Acknowledged",
    order: 4,
    isAcknowledgedState: true,
  },
  { _id: MITIGATED, name: "Mitigated", order: 5 },
  { _id: RESOLVED, name: "Resolved", order: 6, isResolvedState: true },
  { _id: POSTMORTEM, name: "Postmortem", order: 7 },
];

function stageOf(
  stateId: ObjectID | string,
  rows: Array<unknown> = ROWS,
  definition: StateListDefinition = INCIDENT_STATES,
): StartingStage | null {
  return StartingStageUtil.getStage({
    definition: definition,
    states: rows,
    stateId: stateId,
  });
}

describe("StartingStageUtil.getStage - where a record starts, by its state's flag and place", () => {
  test.each([
    [
      "a state the project put above the created state",
      StartingStage.Open,
      TRIAGE,
    ],
    ["the created state", StartingStage.Open, IDENTIFIED],
    [
      "a state of the project's own before acknowledged",
      StartingStage.Open,
      INVESTIGATING,
    ],
    ["the acknowledged state", StartingStage.Acknowledged, ACKNOWLEDGED],
    [
      "a state of the project's own between acknowledged and resolved",
      StartingStage.Acknowledged,
      MITIGATED,
    ],
    ["the resolved state", StartingStage.Resolved, RESOLVED],
    [
      "a state the project put after resolved, without the resolved flag,",
      StartingStage.Acknowledged,
      POSTMORTEM,
    ],
  ] as Array<[string, StartingStage, string]>)(
    "%s starts %s",
    (_name: string, expected: StartingStage, stateId: string) => {
      expect(stageOf(stateId)).toBe(expected);
    },
  );

  test("alert states follow the same rule", () => {
    expect(stageOf(INVESTIGATING, ROWS, ALERT_STATES)).toBe(StartingStage.Open);
    expect(stageOf(MITIGATED, ROWS, ALERT_STATES)).toBe(
      StartingStage.Acknowledged,
    );
    expect(stageOf(RESOLVED, ROWS, ALERT_STATES)).toBe(StartingStage.Resolved);
    expect(stageOf(POSTMORTEM, ROWS, ALERT_STATES)).toBe(
      StartingStage.Acknowledged,
    );
  });

  test("it follows the numbers, not the positions in the list it is handed", () => {
    const shuffled: Array<Row> = [
      ROWS[5]!,
      ROWS[0]!,
      ROWS[3]!,
      ROWS[6]!,
      ROWS[1]!,
      ROWS[4]!,
      ROWS[2]!,
    ];

    expect(stageOf(MITIGATED, shuffled)).toBe(StartingStage.Acknowledged);
    expect(stageOf(INVESTIGATING, shuffled)).toBe(StartingStage.Open);
    expect(stageOf(RESOLVED, shuffled)).toBe(StartingStage.Resolved);
    expect(stageOf(POSTMORTEM, shuffled)).toBe(StartingStage.Acknowledged);
  });

  test("gaps in the numbering change nothing", () => {
    const gapped: Array<Row> = ROWS.map((row: Row): Row => {
      return { ...row, order: (row.order || 0) * 10 };
    });

    expect(stageOf(INVESTIGATING, gapped)).toBe(StartingStage.Open);
    expect(stageOf(MITIGATED, gapped)).toBe(StartingStage.Acknowledged);
    expect(stageOf(RESOLVED, gapped)).toBe(StartingStage.Resolved);
  });

  test("a state flagged resolved or acknowledged counts as that, even with no place in the list", () => {
    const unplaced: Array<Row> = ROWS.map((row: Row): Row => {
      return row._id === RESOLVED || row._id === ACKNOWLEDGED
        ? { ...row, order: null }
        : row;
    });

    expect(stageOf(RESOLVED, unplaced)).toBe(StartingStage.Resolved);
    expect(stageOf(ACKNOWLEDGED, unplaced)).toBe(StartingStage.Acknowledged);
  });

  test("a state of the project's own with no place counts as open", () => {
    const unplaced: Array<Row> = ROWS.map((row: Row): Row => {
      return row._id === MITIGATED ? { ...row, order: null } : row;
    });

    expect(stageOf(MITIGATED, unplaced)).toBe(StartingStage.Open);
  });

  test("a state the list does not hold has no stage: it is not one of the project's states", () => {
    expect(stageOf(ELSEWHERE)).toBeNull();
    expect(stageOf(RESOLVED, [])).toBeNull();
  });

  test("an empty id names no state, not even a row read without an id", () => {
    const withoutId: Array<Record<string, unknown>> = [
      { name: "Nameless", order: 9, isResolvedState: true },
      ...ROWS,
    ];

    expect(stageOf("", withoutId)).toBeNull();
    expect(stageOf("   ", withoutId)).toBeNull();
  });

  test("only the resolved flag makes a state resolved, wherever it sits", () => {
    /*
     * The resolved state dragged above acknowledged (the settings page
     * refuses that order, but a list read from the database is taken as it
     * is): still resolved, and the acknowledged state below it acknowledged.
     */
    const resolvedFirst: Array<Row> = [
      { _id: IDENTIFIED, name: "Identified", order: 1, isCreatedState: true },
      { _id: RESOLVED, name: "Resolved", order: 2, isResolvedState: true },
      {
        _id: ACKNOWLEDGED,
        name: "Acknowledged",
        order: 3,
        isAcknowledgedState: true,
      },
    ];

    expect(stageOf(RESOLVED, resolvedFirst)).toBe(StartingStage.Resolved);
    expect(stageOf(ACKNOWLEDGED, resolvedFirst)).toBe(
      StartingStage.Acknowledged,
    );
  });

  test("a state flagged both acknowledged and resolved is resolved", () => {
    const both: Array<Row> = ROWS.map((row: Row): Row => {
      return row._id === ACKNOWLEDGED ? { ...row, isResolvedState: true } : row;
    });

    expect(stageOf(ACKNOWLEDGED, both)).toBe(StartingStage.Resolved);
  });

  test("with two states flagged resolved, each is resolved and a state of the project's own between them is acknowledged", () => {
    const twice: Array<Row> = [
      ...ROWS,
      { _id: ELSEWHERE, name: "Closed", order: 8, isResolvedState: true },
    ];

    expect(stageOf(RESOLVED, twice)).toBe(StartingStage.Resolved);
    expect(stageOf(POSTMORTEM, twice)).toBe(StartingStage.Acknowledged);
    expect(stageOf(ELSEWHERE, twice)).toBe(StartingStage.Resolved);
  });

  test("the id is read in any letter case, as an ObjectID or a string", () => {
    expect(stageOf(RESOLVED.toUpperCase())).toBe(StartingStage.Resolved);
    expect(stageOf(new ObjectID(ACKNOWLEDGED))).toBe(
      StartingStage.Acknowledged,
    );
    expect(stageOf(new ObjectID(MITIGATED.toUpperCase()))).toBe(
      StartingStage.Acknowledged,
    );
  });

  test("the services' models read the same as their JSON", () => {
    const models: Array<IncidentState> = ROWS.map((row: Row): IncidentState => {
      const state: IncidentState = new IncidentState();
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

    const alertModels: Array<AlertState> = ROWS.map((row: Row): AlertState => {
      const state: AlertState = new AlertState();
      state._id = row._id;
      if (row.order !== null) {
        state.order = row.order;
      }
      state.isCreatedState = Boolean(row.isCreatedState);
      state.isAcknowledgedState = Boolean(row.isAcknowledgedState);
      state.isResolvedState = Boolean(row.isResolvedState);
      return state;
    });

    for (const row of ROWS) {
      expect(stageOf(row._id, models)).toBe(stageOf(row._id));
      expect(stageOf(row._id, alertModels, ALERT_STATES)).toBe(
        stageOf(row._id),
      );
    }
  });

  test("a project whose built-ins are only the three it was seeded with", () => {
    const seeded: Array<Row> = [
      { _id: IDENTIFIED, name: "Identified", order: 1, isCreatedState: true },
      {
        _id: ACKNOWLEDGED,
        name: "Acknowledged",
        order: 2,
        isAcknowledgedState: true,
      },
      { _id: RESOLVED, name: "Resolved", order: 3, isResolvedState: true },
    ];

    expect(stageOf(IDENTIFIED, seeded)).toBe(StartingStage.Open);
    expect(stageOf(ACKNOWLEDGED, seeded)).toBe(StartingStage.Acknowledged);
    expect(stageOf(RESOLVED, seeded)).toBe(StartingStage.Resolved);
  });

  test("the first row from the top that carries a flag is the one that counts, as the services read it", () => {
    /*
     * Two rows flagged acknowledged, at 3 and 5: "the" acknowledged state is
     * the one at 3, so the plain state at 4 already counts as acknowledged.
     */
    const twice: Array<Row> = [
      { _id: IDENTIFIED, name: "Identified", order: 1, isCreatedState: true },
      {
        _id: INVESTIGATING,
        name: "Investigating",
        order: 3,
        isAcknowledgedState: true,
      },
      { _id: TRIAGE, name: "Triage", order: 4 },
      {
        _id: ACKNOWLEDGED,
        name: "Acknowledged",
        order: 5,
        isAcknowledgedState: true,
      },
      { _id: RESOLVED, name: "Resolved", order: 6, isResolvedState: true },
    ];

    expect(stageOf(TRIAGE, twice)).toBe(StartingStage.Acknowledged);
    expect(stageOf(IDENTIFIED, twice)).toBe(StartingStage.Open);
  });
});

describe("what each stage sets off", () => {
  test.each([
    [StartingStage.Open, true, true],
    [StartingStage.Acknowledged, false, true],
    [StartingStage.Resolved, false, false],
  ] as Array<[StartingStage, boolean, boolean]>)(
    "%s: pages on-call %s, answers a live problem %s",
    (stage: StartingStage, pagesOnCall: boolean, isOngoing: boolean) => {
      expect(StartingStageUtil.pagesOnCall(stage)).toBe(pagesOnCall);
      expect(StartingStageUtil.isOngoing(stage)).toBe(isOngoing);
    },
  );

  test("a record that pages its on-call is always one that is ongoing", () => {
    for (const stage of Object.values(StartingStage)) {
      if (StartingStageUtil.pagesOnCall(stage)) {
        expect(StartingStageUtil.isOngoing(stage)).toBe(true);
      }
    }
  });
});

describe("StartingStageUtil.fromCarryForward - what the create hook handed over", () => {
  test.each(Object.values(StartingStage))(
    "%s is read back as it was handed over",
    (stage: StartingStage) => {
      expect(StartingStageUtil.fromCarryForward({ startingStage: stage })).toBe(
        stage,
      );
      expect(
        StartingStageUtil.fromCarryForward({
          startingStage: stage,
          alertIdsToLink: [],
        }),
      ).toBe(stage);
    },
  );

  test.each([
    ["no carry-forward (a success hook called on its own)", null],
    ["an undefined carry-forward", undefined],
    ["a carry-forward without a stage", { alertIdsToLink: [] }],
    ["a stage this code does not know", { startingStage: "Closed" }],
    ["a stage in another case", { startingStage: "resolved" }],
    ["a stage that is not a string", { startingStage: 2 }],
    ["a list", ["Resolved"]],
    ["a bare string", "Resolved"],
  ] as Array<[string, unknown]>)(
    "%s is open: what a record created in the created state sets off",
    (_name: string, carryForward: unknown) => {
      expect(StartingStageUtil.fromCarryForward(carryForward)).toBe(
        StartingStage.Open,
      );
    },
  );
});
