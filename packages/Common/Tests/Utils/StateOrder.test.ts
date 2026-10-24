import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../Models/DatabaseModels/AlertState";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentPostmortemStatus from "../../Models/DatabaseModels/IncidentPostmortemStatus";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import { ListOrderSettings } from "../../Types/Database/ListOrderColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ObjectID from "../../Types/ObjectID";
import {
  STATE_LISTS,
  StateListBuiltIn,
  StateListDefinition,
  StateListOrderViolation,
  StateListRow,
  StateListType,
  getStateListBuiltIn,
  getStateListBuiltInRows,
  getStateListDeleteRefusal,
  getStateListDeleteRefusalMessage,
  getStateListInsertValue,
  getStateListOrderViolation,
  getStateListOrderViolationIntroduced,
  getStateListOrderViolationMessage,
  getStateListReachedBuiltIn,
  getStateListRowsAfterCreate,
  getStateListRowsAfterMove,
  sortStateListRows,
  toStateListRow,
} from "../../Utils/StateOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * What the order of a project's states, severities and monitor statuses
 * means (Common/Utils/StateOrder), pinned without a database. The server
 * guards these lists with it and the settings pages show "Counts as" and
 * "Built-in" with it, so both read the same answers:
 *
 *   - an incident counts as acknowledged from the acknowledged state down,
 *     and as resolved from the resolved state down - the comparison the
 *     services make (order >= the built-in's order);
 *   - the built-in states of a path have to keep their order, so a move or
 *     a create that breaks it is caught, and a list that was already out of
 *     order is never held to it;
 *   - a new state goes just above the resolved state, a new monitor status
 *     just above the offline one, a new severity to the end;
 *   - the last row of a built-in kind cannot be deleted.
 */

const INCIDENT: StateListDefinition = STATE_LISTS[StateListType.IncidentState];
const MAINTENANCE: StateListDefinition =
  STATE_LISTS[StateListType.ScheduledMaintenanceState];
const MONITOR: StateListDefinition = STATE_LISTS[StateListType.MonitorStatus];
const SEVERITY: StateListDefinition =
  STATE_LISTS[StateListType.IncidentSeverity];
const POSTMORTEM: StateListDefinition =
  STATE_LISTS[StateListType.IncidentPostmortemStatus];
const CASE_STATUS: StateListDefinition =
  STATE_LISTS[StateListType.SecurityCaseStatus];
const CASE_PRIORITY: StateListDefinition =
  STATE_LISTS[StateListType.SecurityCasePriority];

const row: (
  id: string,
  order: number | null,
  flags?: Array<string>,
  createdAt?: string,
) => StateListRow = (
  id: string,
  order: number | null,
  flags: Array<string> = [],
  createdAt?: string,
): StateListRow => {
  return {
    id: id,
    name: id,
    order: order,
    flags: flags,
    createdAt: createdAt || null,
  };
};

// A project's postmortem statuses as it starts with them.
const SEEDED_POSTMORTEM_STATUSES: Array<StateListRow> = [
  row("Not Started", 1, ["isNotStartedStatus"]),
  row("Draft", 2, ["isDraftStatus"]),
  row("Completed", 3, ["isCompletedStatus"]),
  row("Not Needed", 4),
];

// The seeded incident states, plus a state added between two of them.
const SEEDED_INCIDENT_STATES: Array<StateListRow> = [
  row("Identified", 1, ["isCreatedState"]),
  row("Acknowledged", 2, ["isAcknowledgedState"]),
  row("Resolved", 3, ["isResolvedState"]),
];

const namesInOrder: (rows: Array<StateListRow>) => Array<string> = (
  rows: Array<StateListRow>,
): Array<string> => {
  return sortStateListRows(rows).map((candidate: StateListRow) => {
    return `${candidate.name}:${candidate.order}`;
  });
};

const MODELS: Record<StateListType, { new (): BaseModel }> = {
  [StateListType.IncidentState]: IncidentState,
  [StateListType.AlertState]: AlertState,
  [StateListType.ScheduledMaintenanceState]: ScheduledMaintenanceState,
  [StateListType.MonitorStatus]: MonitorStatus,
  [StateListType.IncidentSeverity]: IncidentSeverity,
  [StateListType.AlertSeverity]: AlertSeverity,
  [StateListType.IncidentPostmortemStatus]: IncidentPostmortemStatus,
  [StateListType.SecurityCaseStatus]: SecurityCaseStatus,
  [StateListType.SecurityCasePriority]: SecurityCasePriority,
};

// A project's security case statuses and priorities as it starts with them.
const SEEDED_CASE_STATUSES: Array<StateListRow> = [
  row("New", 1, ["isNewStatus"]),
  row("Investigating", 2, ["isAcknowledgedStatus"]),
  row("Contained", 3, ["isContainedStatus"]),
  row("Closed", 4, ["isClosedStatus"]),
];

const SEEDED_CASE_PRIORITIES: Array<StateListRow> = [
  row("Critical", 1, ["isCriticalPriority"]),
  row("High", 2, ["isHighPriority"]),
  row("Medium", 3, ["isMediumPriority"]),
  row("Low", 4, ["isLowPriority"]),
  row("Informational", 5, ["isInformationalPriority"]),
];

describe("the nine lists", () => {
  test.each(Object.values(StateListType))(
    "%s is defined by the model it is about",
    (type: StateListType) => {
      const definition: StateListDefinition = STATE_LISTS[type];
      const model: BaseModel = new MODELS[type]();

      expect(definition.type).toBe(type);
      expect(model.tableName).toBe(type);

      // Its order column is the one the model's list order keeps.
      const listOrder: ListOrderSettings | null = model.getListOrder();
      expect(listOrder?.column).toBe(definition.orderColumn);
      expect(listOrder?.scopeColumns).toEqual(["projectId"]);

      // Every built-in is a boolean column of the model.
      for (const builtIn of definition.builtIns) {
        expect(model.getTableColumnMetadata(builtIn.flag)?.type).toBe(
          TableColumnType.Boolean,
        );
        expect(builtIn.role.length).toBeGreaterThan(0);
      }

      if (definition.insertAboveFlag) {
        expect(
          definition.builtIns.map((builtIn: StateListBuiltIn) => {
            return builtIn.flag;
          }),
        ).toContain(definition.insertAboveFlag);
      }
    },
  );

  test("states are paths; monitor statuses and severities are not", () => {
    expect(STATE_LISTS[StateListType.IncidentState].keepsBuiltInOrder).toBe(
      true,
    );
    expect(STATE_LISTS[StateListType.AlertState].keepsBuiltInOrder).toBe(true);
    expect(
      STATE_LISTS[StateListType.ScheduledMaintenanceState].keepsBuiltInOrder,
    ).toBe(true);
    expect(STATE_LISTS[StateListType.MonitorStatus].keepsBuiltInOrder).toBe(
      false,
    );
    expect(STATE_LISTS[StateListType.IncidentSeverity].keepsBuiltInOrder).toBe(
      false,
    );
    expect(STATE_LISTS[StateListType.AlertSeverity].keepsBuiltInOrder).toBe(
      false,
    );
    // Not started, then a draft, then completed: in that order.
    expect(POSTMORTEM.keepsBuiltInOrder).toBe(true);
    // New, acknowledged, contained, closed - and the five severity levels' priorities.
    expect(CASE_STATUS.keepsBuiltInOrder).toBe(true);
    expect(CASE_PRIORITY.keepsBuiltInOrder).toBe(true);
  });

  test("the built-in states are listed in the order an incident meets them", () => {
    const flags: (definition: StateListDefinition) => Array<string> = (
      definition: StateListDefinition,
    ): Array<string> => {
      return definition.builtIns.map((builtIn: StateListBuiltIn) => {
        return builtIn.flag;
      });
    };

    expect(flags(INCIDENT)).toEqual([
      "isCreatedState",
      "isAcknowledgedState",
      "isResolvedState",
    ]);
    expect(flags(STATE_LISTS[StateListType.AlertState])).toEqual([
      "isCreatedState",
      "isAcknowledgedState",
      "isResolvedState",
    ]);
    expect(flags(MAINTENANCE)).toEqual([
      "isScheduledState",
      "isOngoingState",
      "isEndedState",
      "isResolvedState",
    ]);
    expect(flags(MONITOR)).toEqual(["isOperationalState", "isOfflineState"]);
    expect(flags(SEVERITY)).toEqual([]);
    expect(flags(CASE_STATUS)).toEqual([
      "isNewStatus",
      "isAcknowledgedStatus",
      "isContainedStatus",
      "isClosedStatus",
    ]);
    expect(flags(CASE_PRIORITY)).toEqual([
      "isCriticalPriority",
      "isHighPriority",
      "isMediumPriority",
      "isLowPriority",
      "isInformationalPriority",
    ]);
  });

  test("a new state goes above the state that closes the list, a new status above offline, a severity to the end", () => {
    expect(INCIDENT.insertAboveFlag).toBe("isResolvedState");
    expect(MAINTENANCE.insertAboveFlag).toBe("isResolvedState");
    expect(MONITOR.insertAboveFlag).toBe("isOfflineState");
    expect(SEVERITY.insertAboveFlag).toBeUndefined();
    expect(CASE_STATUS.insertAboveFlag).toBe("isClosedStatus");
    expect(CASE_PRIORITY.insertAboveFlag).toBeUndefined();
  });
});

describe("toStateListRow", () => {
  test("reads a model's id, name, place and built-in flags", () => {
    const state: IncidentState = new IncidentState();
    state._id = "11111111-1111-4111-8111-111111111111";
    state.name = "Resolved";
    state.order = 4;
    state.isResolvedState = true;
    state.isCreatedState = false;
    state.createdAt = new Date("2026-01-01T00:00:00Z");

    expect(toStateListRow(INCIDENT, state)).toEqual({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Resolved",
      order: 4,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      flags: ["isResolvedState"],
    });
  });

  test("reads a monitor status's priority as its place", () => {
    const status: MonitorStatus = new MonitorStatus();
    status._id = "22222222-2222-4222-8222-222222222222";
    status.priority = 7;
    status.isOfflineState = true;

    const listRow: StateListRow = toStateListRow(MONITOR, status);

    expect(listRow.order).toBe(7);
    expect(listRow.flags).toEqual(["isOfflineState"]);
  });

  test("reads plain JSON too, with an id as an ObjectID, a string or an object", () => {
    expect(
      toStateListRow(INCIDENT, {
        _id: new ObjectID("33333333-3333-4333-8333-333333333333"),
        order: "2",
        isAcknowledgedState: true,
      }).id,
    ).toBe("33333333-3333-4333-8333-333333333333");

    expect(
      toStateListRow(INCIDENT, {
        id: "44444444-4444-4444-8444-444444444444",
        order: 2,
      }).id,
    ).toBe("44444444-4444-4444-8444-444444444444");

    // A number sent as text still places the row.
    expect(toStateListRow(INCIDENT, { _id: "x", order: "2" }).order).toBe(2);
  });

  test("a row with no place, no name and no flags", () => {
    expect(toStateListRow(INCIDENT, {})).toEqual({
      id: "",
      name: "",
      order: null,
      createdAt: null,
      flags: [],
    });
  });

  test("only `true` sets a flag, and only the list's own flags are read", () => {
    expect(
      toStateListRow(INCIDENT, {
        _id: "x",
        isCreatedState: "true",
        isOperationalState: true,
        isResolvedState: true,
      }).flags,
    ).toEqual(["isResolvedState"]);
  });
});

describe("sortStateListRows", () => {
  test("by place, then the older row first, rows with no place last", () => {
    expect(
      namesInOrder([
        row("c", 3),
        row("none", null),
        row("b-new", 2, [], "2026-02-01T00:00:00Z"),
        row("a", 1),
        row("b-old", 2, [], "2026-01-01T00:00:00Z"),
      ]),
    ).toEqual(["a:1", "b-old:2", "b-new:2", "c:3", "none:null"]);
  });
});

describe("getStateListBuiltIn and getStateListBuiltInRows", () => {
  test("a row is the built-in its first flag names", () => {
    expect(
      getStateListBuiltIn(INCIDENT, row("Resolved", 3, ["isResolvedState"])),
    ).toEqual({ flag: "isResolvedState", role: "resolved state" });
    expect(getStateListBuiltIn(INCIDENT, row("Investigating", 2))).toBeNull();
  });

  test("the row that stands for a built-in is the first one from the top that carries it", () => {
    const rows: Array<StateListRow> = [
      row("Closed", 5, ["isResolvedState"]),
      ...SEEDED_INCIDENT_STATES,
    ];

    const builtInRows: Record<string, StateListRow> = getStateListBuiltInRows(
      INCIDENT,
      rows,
    );

    expect(builtInRows["isResolvedState"]?.name).toBe("Resolved");
    expect(builtInRows["isCreatedState"]?.name).toBe("Identified");
    expect(builtInRows["isAcknowledgedState"]?.name).toBe("Acknowledged");
  });
});

describe("getStateListReachedBuiltIn - what a state counts as", () => {
  const rows: Array<StateListRow> = [
    row("Triage", 1),
    row("Identified", 2, ["isCreatedState"]),
    row("Investigating", 3),
    row("Acknowledged", 4, ["isAcknowledgedState"]),
    row("Mitigated", 5),
    row("Resolved", 6, ["isResolvedState"]),
    row("Postmortem", 7),
  ];

  test.each([
    ["Triage", null],
    ["Identified", "isCreatedState"],
    ["Investigating", "isCreatedState"],
    ["Acknowledged", "isAcknowledgedState"],
    ["Mitigated", "isAcknowledgedState"],
    ["Resolved", "isResolvedState"],
    ["Postmortem", "isResolvedState"],
  ])("%s has reached %s", (name: string, expected: string | null) => {
    const state: StateListRow = rows.find((candidate: StateListRow) => {
      return candidate.name === name;
    })!;

    expect(getStateListReachedBuiltIn(INCIDENT, rows, state)).toBe(expected);
  });

  test("it follows the numbers, not the positions: a gap changes nothing", () => {
    const gapped: Array<StateListRow> = [
      row("Identified", 10, ["isCreatedState"]),
      row("Acknowledged", 20, ["isAcknowledgedState"]),
      row("Watching", 25),
      row("Resolved", 30, ["isResolvedState"]),
    ];

    expect(getStateListReachedBuiltIn(INCIDENT, gapped, gapped[2]!)).toBe(
      "isAcknowledgedState",
    );
  });

  test("a scheduled maintenance state reaches ongoing, ended and completed", () => {
    const maintenance: Array<StateListRow> = [
      row("Scheduled", 1, ["isScheduledState"]),
      row("Ongoing", 2, ["isOngoingState"]),
      row("Extended", 3),
      row("Ended", 4, ["isEndedState"]),
      row("Verifying", 5),
      row("Completed", 6, ["isResolvedState"]),
    ];

    expect(
      maintenance.map((state: StateListRow) => {
        return getStateListReachedBuiltIn(MAINTENANCE, maintenance, state);
      }),
    ).toEqual([
      "isScheduledState",
      "isOngoingState",
      "isOngoingState",
      "isEndedState",
      "isEndedState",
      "isResolvedState",
    ]);
  });

  test("a row with no place has reached nothing", () => {
    expect(
      getStateListReachedBuiltIn(INCIDENT, rows, row("New", null)),
    ).toBeNull();
  });
});

describe("getStateListOrderViolation", () => {
  test("the seeded states are in order", () => {
    expect(
      getStateListOrderViolation(INCIDENT, SEEDED_INCIDENT_STATES),
    ).toBeNull();
  });

  test("states the project added can sit anywhere, the built-ins only keep theirs", () => {
    expect(
      getStateListOrderViolation(INCIDENT, [
        row("Before everything", 1),
        row("Identified", 2, ["isCreatedState"]),
        row("Acknowledged", 3, ["isAcknowledgedState"]),
        row("Resolved", 4, ["isResolvedState"]),
        row("After everything", 5),
      ]),
    ).toBeNull();
  });

  test("the resolved state above the acknowledged one is out of order", () => {
    const violation: StateListOrderViolation | null =
      getStateListOrderViolation(INCIDENT, [
        row("Identified", 1, ["isCreatedState"]),
        row("Resolved", 2, ["isResolvedState"]),
        row("Acknowledged", 3, ["isAcknowledgedState"]),
      ]);

    expect(violation?.earlier.name).toBe("Acknowledged");
    expect(violation?.earlierBuiltIn.flag).toBe("isAcknowledgedState");
    expect(violation?.later.name).toBe("Resolved");
    expect(violation?.laterBuiltIn.flag).toBe("isResolvedState");
  });

  test("the created state below the acknowledged one is out of order", () => {
    expect(
      getStateListOrderViolation(INCIDENT, [
        row("Acknowledged", 1, ["isAcknowledgedState"]),
        row("Identified", 2, ["isCreatedState"]),
        row("Resolved", 3, ["isResolvedState"]),
      ])?.later.name,
    ).toBe("Acknowledged");
  });

  test("two built-ins sharing a number are out of order: both would count as the later", () => {
    expect(
      getStateListOrderViolation(INCIDENT, [
        row("Identified", 1, ["isCreatedState"]),
        row("Acknowledged", 2, ["isAcknowledgedState"]),
        row("Resolved", 2, ["isResolvedState"]),
      ]),
    ).not.toBeNull();
  });

  test("a missing built-in is skipped, not a violation", () => {
    expect(
      getStateListOrderViolation(MAINTENANCE, [
        row("Scheduled", 1, ["isScheduledState"]),
        row("Ongoing", 2, ["isOngoingState"]),
        row("Completed", 3, ["isResolvedState"]),
      ]),
    ).toBeNull();
  });

  test("the maintenance path keeps scheduled, ongoing, ended and completed in order", () => {
    expect(
      getStateListOrderViolation(MAINTENANCE, [
        row("Scheduled", 1, ["isScheduledState"]),
        row("Ended", 2, ["isEndedState"]),
        row("Ongoing", 3, ["isOngoingState"]),
        row("Completed", 4, ["isResolvedState"]),
      ])?.later.name,
    ).toBe("Ended");
  });

  test("monitor statuses and severities have no order to keep", () => {
    expect(
      getStateListOrderViolation(MONITOR, [
        row("Offline", 1, ["isOfflineState"]),
        row("Operational", 2, ["isOperationalState"]),
      ]),
    ).toBeNull();
    expect(
      getStateListOrderViolation(SEVERITY, [row("Minor", 1), row("Major", 2)]),
    ).toBeNull();
  });

  test("one state that is two built-ins at once is not out of order with itself", () => {
    expect(
      getStateListOrderViolation(INCIDENT, [
        row("Open", 1, ["isCreatedState", "isAcknowledgedState"]),
        row("Resolved", 2, ["isResolvedState"]),
      ]),
    ).toBeNull();
  });
});

describe("getStateListOrderViolationIntroduced", () => {
  const broken: Array<StateListRow> = [
    row("Identified", 1, ["isCreatedState"]),
    row("Resolved", 2, ["isResolvedState"]),
    row("Acknowledged", 3, ["isAcknowledgedState"]),
  ];

  test("a change that breaks an ordered list is caught", () => {
    expect(
      getStateListOrderViolationIntroduced({
        definition: INCIDENT,
        rowsBefore: SEEDED_INCIDENT_STATES,
        rowsAfter: broken,
      }),
    ).not.toBeNull();
  });

  test("a list that was already out of order is not held to it, so it can be put right", () => {
    expect(
      getStateListOrderViolationIntroduced({
        definition: INCIDENT,
        rowsBefore: broken,
        rowsAfter: broken,
      }),
    ).toBeNull();
  });

  test("a change that keeps the order is fine", () => {
    expect(
      getStateListOrderViolationIntroduced({
        definition: INCIDENT,
        rowsBefore: SEEDED_INCIDENT_STATES,
        rowsAfter: SEEDED_INCIDENT_STATES,
      }),
    ).toBeNull();
  });
});

describe("getStateListRowsAfterMove - the list as the server will leave it", () => {
  const rows: Array<StateListRow> = [
    ...SEEDED_INCIDENT_STATES,
    row("Investigating", 4),
  ];

  test("a drop onto a row takes its place, and the rows in between step down", () => {
    // Investigating dropped onto Acknowledged: what the dashboard sends.
    expect(
      namesInOrder(
        getStateListRowsAfterMove({
          rows: rows,
          id: "Investigating",
          requestedValue: 2,
        }),
      ),
    ).toEqual([
      "Identified:1",
      "Investigating:2",
      "Acknowledged:3",
      "Resolved:4",
    ]);
  });

  test("moving down steps the rows in between up", () => {
    expect(
      namesInOrder(
        getStateListRowsAfterMove({
          rows: rows,
          id: "Acknowledged",
          requestedValue: 4,
        }),
      ),
    ).toEqual([
      "Identified:1",
      "Resolved:2",
      "Investigating:3",
      "Acknowledged:4",
    ]);
  });

  test("a number nobody holds is kept as written", () => {
    expect(
      namesInOrder(
        getStateListRowsAfterMove({
          rows: rows,
          id: "Investigating",
          requestedValue: 99,
        }),
      ),
    ).toEqual([
      "Identified:1",
      "Acknowledged:2",
      "Resolved:3",
      "Investigating:99",
    ]);
  });

  test("a cleared number sends the row to the end", () => {
    expect(
      namesInOrder(
        getStateListRowsAfterMove({
          rows: rows,
          id: "Identified",
          requestedValue: null,
        }),
      ),
    ).toEqual([
      "Acknowledged:2",
      "Resolved:3",
      "Investigating:4",
      "Identified:5",
    ]);
  });

  test("a row that is not in the list changes nothing", () => {
    expect(
      getStateListRowsAfterMove({
        rows: rows,
        id: "Elsewhere",
        requestedValue: 1,
      }),
    ).toBe(rows);
  });
});

describe("getStateListRowsAfterCreate", () => {
  test("a new row with a number takes that place, and the rows in its way step down", () => {
    expect(
      namesInOrder(
        getStateListRowsAfterCreate({
          rows: SEEDED_INCIDENT_STATES,
          newRow: row("Investigating", 3),
        }),
      ),
    ).toEqual([
      "Identified:1",
      "Acknowledged:2",
      "Investigating:3",
      "Resolved:4",
    ]);
  });

  test("a new row without a number goes to the end", () => {
    expect(
      namesInOrder(
        getStateListRowsAfterCreate({
          rows: SEEDED_INCIDENT_STATES,
          newRow: row("Postmortem", null),
        }),
      ),
    ).toEqual(["Identified:1", "Acknowledged:2", "Resolved:3", "Postmortem:4"]);
  });

  test("a new resolved state at the top would put the path out of order", () => {
    expect(
      getStateListOrderViolationIntroduced({
        definition: INCIDENT,
        rowsBefore: SEEDED_INCIDENT_STATES,
        rowsAfter: getStateListRowsAfterCreate({
          rows: SEEDED_INCIDENT_STATES,
          newRow: row("Closed", 1, ["isResolvedState"]),
        }),
      })?.later.name,
    ).toBe("Closed");
  });
});

describe("getStateListInsertValue - where a row created without a place goes", () => {
  test("a state takes the resolved state's place", () => {
    expect(getStateListInsertValue(INCIDENT, SEEDED_INCIDENT_STATES)).toBe(3);
  });

  test("so a new state lands just above Resolved and counts as acknowledged", () => {
    const after: Array<StateListRow> = getStateListRowsAfterCreate({
      rows: SEEDED_INCIDENT_STATES,
      newRow: row(
        "Mitigated",
        getStateListInsertValue(INCIDENT, SEEDED_INCIDENT_STATES),
      ),
    });

    expect(namesInOrder(after)).toEqual([
      "Identified:1",
      "Acknowledged:2",
      "Mitigated:3",
      "Resolved:4",
    ]);
    expect(
      getStateListReachedBuiltIn(
        INCIDENT,
        after,
        after.find((candidate: StateListRow) => {
          return candidate.name === "Mitigated";
        })!,
      ),
    ).toBe("isAcknowledgedState");
  });

  test("the first resolved state from the top is the one", () => {
    expect(
      getStateListInsertValue(INCIDENT, [
        row("Closed", 9, ["isResolvedState"]),
        row("Resolved", 4, ["isResolvedState"]),
      ]),
    ).toBe(4);
  });

  test("a maintenance state takes the completed state's place", () => {
    expect(
      getStateListInsertValue(MAINTENANCE, [
        row("Scheduled", 1, ["isScheduledState"]),
        row("Ongoing", 2, ["isOngoingState"]),
        row("Ended", 3, ["isEndedState"]),
        row("Completed", 4, ["isResolvedState"]),
      ]),
    ).toBe(4);
  });

  test("a monitor status takes the offline status's place", () => {
    expect(
      getStateListInsertValue(MONITOR, [
        row("Operational", 1, ["isOperationalState"]),
        row("Degraded", 2),
        row("Offline", 3, ["isOfflineState"]),
      ]),
    ).toBe(3);
  });

  test("with nothing to go above, or for a severity, the end of the list", () => {
    expect(getStateListInsertValue(INCIDENT, [row("Identified", 1)])).toBe(
      null,
    );
    expect(
      getStateListInsertValue(SEVERITY, [row("Critical", 1), row("Minor", 2)]),
    ).toBeNull();
  });
});

describe("getStateListDeleteRefusal", () => {
  test("the only resolved state cannot be deleted", () => {
    expect(
      getStateListDeleteRefusal({
        definition: INCIDENT,
        rows: SEEDED_INCIDENT_STATES,
        idsToDelete: ["Resolved"],
      }),
    ).toEqual({
      row: SEEDED_INCIDENT_STATES[2],
      builtIn: { flag: "isResolvedState", role: "resolved state" },
    });
  });

  test("a state the project added can be", () => {
    expect(
      getStateListDeleteRefusal({
        definition: INCIDENT,
        rows: [...SEEDED_INCIDENT_STATES, row("Investigating", 4)],
        idsToDelete: ["Investigating"],
      }),
    ).toBeNull();
  });

  test("a built-in state can be while another of its kind remains", () => {
    expect(
      getStateListDeleteRefusal({
        definition: INCIDENT,
        rows: [
          ...SEEDED_INCIDENT_STATES,
          row("Closed", 4, ["isResolvedState"]),
        ],
        idsToDelete: ["Closed"],
      }),
    ).toBeNull();
  });

  test("but not both of them at once", () => {
    expect(
      getStateListDeleteRefusal({
        definition: INCIDENT,
        rows: [
          ...SEEDED_INCIDENT_STATES,
          row("Closed", 4, ["isResolvedState"]),
        ],
        idsToDelete: ["Closed", "Resolved"],
      })?.row.name,
    ).toBe("Resolved");
  });

  test("the operational and offline statuses are protected; severities have nothing to protect", () => {
    const statuses: Array<StateListRow> = [
      row("Operational", 1, ["isOperationalState"]),
      row("Degraded", 2),
      row("Offline", 3, ["isOfflineState"]),
    ];

    expect(
      getStateListDeleteRefusal({
        definition: MONITOR,
        rows: statuses,
        idsToDelete: ["Offline"],
      })?.builtIn.flag,
    ).toBe("isOfflineState");
    expect(
      getStateListDeleteRefusal({
        definition: MONITOR,
        rows: statuses,
        idsToDelete: ["Degraded"],
      }),
    ).toBeNull();
    expect(
      getStateListDeleteRefusal({
        definition: SEVERITY,
        rows: [row("Critical", 1)],
        idsToDelete: ["Critical"],
      }),
    ).toBeNull();
  });
});

describe("the messages", () => {
  test("a refused move says which state has to stay where, and why", () => {
    const violation: StateListOrderViolation = getStateListOrderViolation(
      INCIDENT,
      [
        row("Identified", 1, ["isCreatedState"]),
        row("Resolved", 2, ["isResolvedState"]),
        row("Acknowledged", 3, ["isAcknowledgedState"]),
      ],
    )!;

    expect(getStateListOrderViolationMessage(INCIDENT, violation)).toBe(
      'Incidents only ever move down this list, so the resolved state ("Resolved") has to stay below the acknowledged state ("Acknowledged").',
    );
  });

  test("a postmortem one says why without claiming a postmortem only moves down", () => {
    const violation: StateListOrderViolation = getStateListOrderViolation(
      POSTMORTEM,
      [
        row("Not Started", 1, ["isNotStartedStatus"]),
        row("Completed", 2, ["isCompletedStatus"]),
        row("Draft", 3, ["isDraftStatus"]),
      ],
    )!;

    expect(getStateListOrderViolationMessage(POSTMORTEM, violation)).toBe(
      'A postmortem is started, drafted and then completed, so the completed status ("Completed") has to stay below the draft status ("Draft").',
    );
    expect(POSTMORTEM.orderReason).toBeTruthy();
    // Every list of states keeps its sentence: its subjects only move down.
    for (const type of Object.values(StateListType)) {
      if (
        type !== StateListType.IncidentPostmortemStatus &&
        type !== StateListType.SecurityCaseStatus &&
        type !== StateListType.SecurityCasePriority
      ) {
        expect(STATE_LISTS[type].orderReason).toBeUndefined();
      }
    }
  });

  test("a security case one says why: a case is reopened, so it is no path", () => {
    const statusViolation: StateListOrderViolation = getStateListOrderViolation(
      CASE_STATUS,
      [
        row("New", 1, ["isNewStatus"]),
        row("Investigating", 2, ["isAcknowledgedStatus"]),
        row("Closed", 3, ["isClosedStatus"]),
        row("Contained", 4, ["isContainedStatus"]),
      ],
    )!;

    expect(getStateListOrderViolationMessage(CASE_STATUS, statusViolation)).toBe(
      'A case is opened, taken on, contained and then closed, so the closed status ("Closed") has to stay below the contained status ("Contained").',
    );

    const priorityViolation: StateListOrderViolation =
      getStateListOrderViolation(CASE_PRIORITY, [
        row("High", 1, ["isHighPriority"]),
        row("Critical", 2, ["isCriticalPriority"]),
        row("Medium", 3, ["isMediumPriority"]),
        row("Low", 4, ["isLowPriority"]),
        row("Informational", 5, ["isInformationalPriority"]),
      ])!;

    expect(
      getStateListOrderViolationMessage(CASE_PRIORITY, priorityViolation),
    ).toBe(
      'Priorities are ranked most urgent first, and detections open their cases at the built-in priority of their severity, so the high priority ("High") has to stay below the critical priority ("Critical").',
    );

    expect(
      getStateListDeleteRefusalMessage(CASE_STATUS, {
        row: row("Closed", 4, ["isClosedStatus"]),
        builtIn: { flag: "isClosedStatus", role: "closed status" },
      }),
    ).toBe(
      '"Closed" is the closed status of this project, and security cases need one. It can be renamed, but not deleted.',
    );
  });

  test("a refused delete of a built-in postmortem status names it and what it is", () => {
    expect(
      getStateListDeleteRefusalMessage(POSTMORTEM, {
        row: row("Completed", 3, ["isCompletedStatus"]),
        builtIn: { flag: "isCompletedStatus", role: "completed status" },
      }),
    ).toBe(
      '"Completed" is the completed status of this project, and postmortems need one. It can be renamed, but not deleted.',
    );
  });

  test("a maintenance one talks about scheduled maintenance events", () => {
    const violation: StateListOrderViolation = getStateListOrderViolation(
      MAINTENANCE,
      [
        row("Ongoing", 1, ["isOngoingState"]),
        row("Scheduled", 2, ["isScheduledState"]),
      ],
    )!;

    expect(getStateListOrderViolationMessage(MAINTENANCE, violation)).toBe(
      'Scheduled maintenance events only ever move down this list, so the ongoing state ("Ongoing") has to stay below the scheduled state ("Scheduled").',
    );
  });

  test("a refused delete names the row and what it is", () => {
    expect(
      getStateListDeleteRefusalMessage(INCIDENT, {
        row: row("Resolved", 3, ["isResolvedState"]),
        builtIn: { flag: "isResolvedState", role: "resolved state" },
      }),
    ).toBe(
      '"Resolved" is the resolved state of this project, and incidents need one. It can be renamed, but not deleted.',
    );
    expect(
      getStateListDeleteRefusalMessage(MONITOR, {
        row: row("Operational", 1, ["isOperationalState"]),
        builtIn: { flag: "isOperationalState", role: "operational status" },
      }),
    ).toBe(
      '"Operational" is the operational status of this project, and monitors need one. It can be renamed, but not deleted.',
    );
  });

  test("a row without a name is still named by what it is", () => {
    const nameless: StateListRow = { ...row("x", 3, ["isResolvedState"]) };
    nameless.name = "";

    expect(
      getStateListDeleteRefusalMessage(INCIDENT, {
        row: nameless,
        builtIn: { flag: "isResolvedState", role: "resolved state" },
      }),
    ).toBe(
      "This state is the resolved state of this project, and incidents need one. It can be renamed, but not deleted.",
    );
  });
});

describe("postmortem statuses", () => {
  test("are built in as not started, draft and completed, in that order", () => {
    expect(
      POSTMORTEM.builtIns.map((builtIn: StateListBuiltIn) => {
        return builtIn.flag;
      }),
    ).toEqual(["isNotStartedStatus", "isDraftStatus", "isCompletedStatus"]);
    expect(POSTMORTEM.subject).toEqual({
      singular: "postmortem",
      plural: "postmortems",
    });
  });

  test("a new status with no place goes just above the completed status", () => {
    expect(
      getStateListInsertValue(POSTMORTEM, SEEDED_POSTMORTEM_STATUSES),
    ).toBe(3);

    const rows: Array<StateListRow> = getStateListRowsAfterCreate({
      rows: SEEDED_POSTMORTEM_STATUSES,
      newRow: row("In Review", 3),
    });

    expect(namesInOrder(rows)).toEqual([
      "Not Started:1",
      "Draft:2",
      "In Review:3",
      "Completed:4",
      "Not Needed:5",
    ]);
  });

  test("what each status counts as follows from where it sits", () => {
    const rows: Array<StateListRow> = [
      row("Not Started", 1, ["isNotStartedStatus"]),
      row("Assigned", 2),
      row("Draft", 3, ["isDraftStatus"]),
      row("In Review", 4),
      row("Completed", 5, ["isCompletedStatus"]),
      row("Not Needed", 6),
    ];

    const reached: (name: string) => string | null = (
      name: string,
    ): string | null => {
      return getStateListReachedBuiltIn(
        POSTMORTEM,
        rows,
        rows.find((candidate: StateListRow) => {
          return candidate.name === name;
        })!,
      );
    };

    expect(reached("Not Started")).toBe("isNotStartedStatus");
    expect(reached("Assigned")).toBe("isNotStartedStatus");
    expect(reached("Draft")).toBe("isDraftStatus");
    expect(reached("In Review")).toBe("isDraftStatus");
    expect(reached("Completed")).toBe("isCompletedStatus");
    expect(reached("Not Needed")).toBe("isCompletedStatus");
  });

  test("a move that puts the draft status below the completed one is caught", () => {
    expect(
      getStateListOrderViolationIntroduced({
        definition: POSTMORTEM,
        rowsBefore: SEEDED_POSTMORTEM_STATUSES,
        rowsAfter: getStateListRowsAfterMove({
          rows: SEEDED_POSTMORTEM_STATUSES,
          id: "Draft",
          requestedValue: 4,
        }),
      }),
    ).not.toBeNull();

    // Not Needed moved above Completed is a status of the project's own: fine.
    expect(
      getStateListOrderViolationIntroduced({
        definition: POSTMORTEM,
        rowsBefore: SEEDED_POSTMORTEM_STATUSES,
        rowsAfter: getStateListRowsAfterMove({
          rows: SEEDED_POSTMORTEM_STATUSES,
          id: "Not Needed",
          requestedValue: 3,
        }),
      }),
    ).toBeNull();
  });

  test("the last status of a built-in kind cannot be deleted; Not Needed can", () => {
    expect(
      getStateListDeleteRefusal({
        definition: POSTMORTEM,
        rows: SEEDED_POSTMORTEM_STATUSES,
        idsToDelete: ["Draft"],
      })?.builtIn.flag,
    ).toBe("isDraftStatus");
    expect(
      getStateListDeleteRefusal({
        definition: POSTMORTEM,
        rows: SEEDED_POSTMORTEM_STATUSES,
        idsToDelete: ["Not Needed"],
      }),
    ).toBeNull();
  });
});

describe("security case statuses", () => {
  test("a new status with no place goes just above the closed status", () => {
    expect(getStateListInsertValue(CASE_STATUS, SEEDED_CASE_STATUSES)).toBe(4);

    expect(
      namesInOrder(
        getStateListRowsAfterCreate({
          rows: SEEDED_CASE_STATUSES,
          newRow: row("Eradicating", 4),
        }),
      ),
    ).toEqual([
      "New:1",
      "Investigating:2",
      "Contained:3",
      "Eradicating:4",
      "Closed:5",
    ]);
  });

  test("what each status counts as follows from where it sits", () => {
    const rows: Array<StateListRow> = [
      row("New", 1, ["isNewStatus"]),
      row("Queued", 2),
      row("Investigating", 3, ["isAcknowledgedStatus"]),
      row("Contained", 4, ["isContainedStatus"]),
      row("Eradicating", 5),
      row("Closed", 6, ["isClosedStatus"]),
      row("Closed - Duplicate", 7),
    ];

    const reached: (name: string) => string | null = (
      name: string,
    ): string | null => {
      return getStateListReachedBuiltIn(
        CASE_STATUS,
        rows,
        rows.find((candidate: StateListRow) => {
          return candidate.name === name;
        })!,
      );
    };

    expect(reached("New")).toBe("isNewStatus");
    expect(reached("Queued")).toBe("isNewStatus");
    expect(reached("Investigating")).toBe("isAcknowledgedStatus");
    expect(reached("Contained")).toBe("isContainedStatus");
    expect(reached("Eradicating")).toBe("isContainedStatus");
    expect(reached("Closed")).toBe("isClosedStatus");
    expect(reached("Closed - Duplicate")).toBe("isClosedStatus");
  });

  test("a move that puts the closed status above the contained one is caught; one of the project's own is not", () => {
    expect(
      getStateListOrderViolationIntroduced({
        definition: CASE_STATUS,
        rowsBefore: SEEDED_CASE_STATUSES,
        rowsAfter: getStateListRowsAfterMove({
          rows: SEEDED_CASE_STATUSES,
          id: "Closed",
          requestedValue: 2,
        }),
      }),
    ).not.toBeNull();

    const withDuplicate: Array<StateListRow> = [
      ...SEEDED_CASE_STATUSES,
      row("Closed - Duplicate", 5),
    ];

    expect(
      getStateListOrderViolationIntroduced({
        definition: CASE_STATUS,
        rowsBefore: withDuplicate,
        rowsAfter: getStateListRowsAfterMove({
          rows: withDuplicate,
          id: "Closed - Duplicate",
          requestedValue: 2,
        }),
      }),
    ).toBeNull();
  });

  test("the last status of a built-in kind cannot be deleted; one of the project's own can", () => {
    for (const [name, flag] of [
      ["New", "isNewStatus"],
      ["Investigating", "isAcknowledgedStatus"],
      ["Contained", "isContainedStatus"],
      ["Closed", "isClosedStatus"],
    ]) {
      expect(
        getStateListDeleteRefusal({
          definition: CASE_STATUS,
          rows: SEEDED_CASE_STATUSES,
          idsToDelete: [name!],
        })?.builtIn.flag,
      ).toBe(flag);
    }

    expect(
      getStateListDeleteRefusal({
        definition: CASE_STATUS,
        rows: [...SEEDED_CASE_STATUSES, row("Eradicating", 5)],
        idsToDelete: ["Eradicating"],
      }),
    ).toBeNull();

    // A second closed status: either one may go, not both.
    const twoClosed: Array<StateListRow> = [
      ...SEEDED_CASE_STATUSES,
      row("Closed - Duplicate", 5, ["isClosedStatus"]),
    ];

    expect(
      getStateListDeleteRefusal({
        definition: CASE_STATUS,
        rows: twoClosed,
        idsToDelete: ["Closed"],
      }),
    ).toBeNull();
    expect(
      getStateListDeleteRefusal({
        definition: CASE_STATUS,
        rows: twoClosed,
        idsToDelete: ["Closed", "Closed - Duplicate"],
      })?.builtIn.flag,
    ).toBe("isClosedStatus");
  });
});

describe("security case priorities", () => {
  test("a new priority with no place goes to the end, as a new severity does", () => {
    // No row to go above: the end of the list.
    expect(
      getStateListInsertValue(CASE_PRIORITY, SEEDED_CASE_PRIORITIES),
    ).toBeNull();
    expect(getStateListInsertValue(SEVERITY, [row("Sev 1", 1)])).toBeNull();
  });

  test("the built-in priorities keep their order; the project's own go anywhere", () => {
    expect(
      getStateListOrderViolationIntroduced({
        definition: CASE_PRIORITY,
        rowsBefore: SEEDED_CASE_PRIORITIES,
        rowsAfter: getStateListRowsAfterMove({
          rows: SEEDED_CASE_PRIORITIES,
          id: "Low",
          requestedValue: 1,
        }),
      }),
    ).not.toBeNull();

    const withEmergency: Array<StateListRow> = [
      ...SEEDED_CASE_PRIORITIES,
      row("Emergency", 6),
    ];

    expect(
      getStateListOrderViolationIntroduced({
        definition: CASE_PRIORITY,
        rowsBefore: withEmergency,
        rowsAfter: getStateListRowsAfterMove({
          rows: withEmergency,
          id: "Emergency",
          requestedValue: 1,
        }),
      }),
    ).toBeNull();
  });

  test("every built-in priority is the last of its kind; the project's own can go", () => {
    for (const priority of SEEDED_CASE_PRIORITIES) {
      expect(
        getStateListDeleteRefusal({
          definition: CASE_PRIORITY,
          rows: SEEDED_CASE_PRIORITIES,
          idsToDelete: [priority.id],
        })?.builtIn.flag,
      ).toBe(priority.flags[0]);
    }

    expect(
      getStateListDeleteRefusal({
        definition: CASE_PRIORITY,
        rows: [...SEEDED_CASE_PRIORITIES, row("Emergency", 6)],
        idsToDelete: ["Emergency"],
      }),
    ).toBeNull();
  });
});
