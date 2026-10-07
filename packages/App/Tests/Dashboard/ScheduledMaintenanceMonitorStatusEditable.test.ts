import {
  getMonitorStatusIdFromFormValue,
  getScheduledMaintenanceAffectedResourcesToSave,
  hasScheduledMaintenanceEventStarted,
} from "../../FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceMonitorStatus";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The maintainer's decision: a scheduled maintenance event's Change Monitor
 * Status to can be edited until the event starts, and is read-only once it
 * is ongoing or over, with a line saying why.
 *
 * The rules the event's Affected Resources card follows are checked here
 * directly (Components/ScheduledMaintenance/ScheduledMaintenanceMonitorStatus,
 * React-free): whether the event has started, the id a form value holds,
 * and what the Edit sends. The page and the read-only element are read
 * from source, as React modules an App test must not import. The card
 * itself is drawn for real in Common/Tests/App/Dashboard
 * (ScheduledMaintenanceAffectedResourcesEditForm, ScheduledMaintenanceOverviewPage).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const MONITOR_ID: string = "a0000000-0000-4000-8000-00000000000a";
const HOST_ID: string = "b0000000-0000-4000-8000-00000000000a";
const STATUS_ID: string = "d0000000-0000-4000-8000-000000000001";

interface StateRecord {
  id: string;
  order: number;
  isScheduledState?: boolean;
  isOngoingState?: boolean;
  isEndedState?: boolean;
  isResolvedState?: boolean;
}

// A project's states: the four built-in ones, and two of its own between them.
const SCHEDULED: StateRecord = {
  id: "c0000000-0000-4000-8000-000000000001",
  order: 1,
  isScheduledState: true,
};
const CONFIRMED: StateRecord = {
  id: "c0000000-0000-4000-8000-000000000002",
  order: 2,
};
const ONGOING: StateRecord = {
  id: "c0000000-0000-4000-8000-000000000003",
  order: 3,
  isOngoingState: true,
};
const VERIFYING: StateRecord = {
  id: "c0000000-0000-4000-8000-000000000004",
  order: 4,
};
const ENDED: StateRecord = {
  id: "c0000000-0000-4000-8000-000000000005",
  order: 5,
  isEndedState: true,
};
const COMPLETED: StateRecord = {
  id: "c0000000-0000-4000-8000-000000000006",
  order: 6,
  isResolvedState: true,
};
// A state of its own placed after Completed.
const ARCHIVED: StateRecord = {
  id: "c0000000-0000-4000-8000-000000000007",
  order: 7,
};

const RECORDS: Array<StateRecord> = [
  SCHEDULED,
  CONFIRMED,
  ONGOING,
  VERIFYING,
  ENDED,
  COMPLETED,
  ARCHIVED,
];

// A state as the page reads it: a model, with its place and flags.
function stateModel(record: StateRecord): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = record.id;
  state.order = record.order;
  state.isScheduledState = Boolean(record.isScheduledState);
  state.isOngoingState = Boolean(record.isOngoingState);
  state.isEndedState = Boolean(record.isEndedState);
  state.isResolvedState = Boolean(record.isResolvedState);
  return state;
}

// The same state as its JSON.
function stateJson(record: StateRecord): JSONObject {
  return {
    _id: record.id,
    order: record.order,
    isScheduledState: Boolean(record.isScheduledState),
    isOngoingState: Boolean(record.isOngoingState),
    isEndedState: Boolean(record.isEndedState),
    isResolvedState: Boolean(record.isResolvedState),
  };
}

const PROJECT_STATES: Array<ScheduledMaintenanceState> =
  RECORDS.map(stateModel);

describe("whether the event has started", () => {
  test.each([
    ["Scheduled", false, SCHEDULED],
    ["a state of the project's own before Ongoing", false, CONFIRMED],
    ["Ongoing", true, ONGOING],
    ["a state of the project's own while it runs", true, VERIFYING],
    ["Ended", true, ENDED],
    ["Completed", true, COMPLETED],
    ["a state of the project's own after Completed", true, ARCHIVED],
  ])(
    "in %s, started: %s",
    (_name: string, started: boolean, record: StateRecord) => {
      // The event's state as the page selects it: its id, place and flags.
      expect(
        hasScheduledMaintenanceEventStarted({
          states: PROJECT_STATES,
          currentState: stateModel(record),
        }),
      ).toBe(started);

      // Read as JSON, the same.
      expect(
        hasScheduledMaintenanceEventStarted({
          states: RECORDS.map(stateJson),
          currentState: stateJson(record),
        }),
      ).toBe(started);
    },
  );

  test("the list places the event's state even when the event's copy carries no place", () => {
    const bare: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    bare._id = VERIFYING.id.toUpperCase();

    expect(
      hasScheduledMaintenanceEventStarted({
        states: PROJECT_STATES,
        currentState: bare,
      }),
    ).toBe(true);

    const confirmed: ScheduledMaintenanceState =
      new ScheduledMaintenanceState();
    confirmed._id = CONFIRMED.id;

    expect(
      hasScheduledMaintenanceEventStarted({
        states: PROJECT_STATES,
        currentState: confirmed,
      }),
    ).toBe(false);
  });

  test("without the list, a built-in state decides by its flag", () => {
    for (const [record, started] of [
      [SCHEDULED, false],
      [ONGOING, true],
      [ENDED, true],
      [COMPLETED, true],
    ] as Array<[StateRecord, boolean]>) {
      expect(
        hasScheduledMaintenanceEventStarted({
          states: [],
          currentState: stateModel(record),
        }),
      ).toBe(started);
    }
  });

  test("without the list, a state of the project's own is placed by its own order", () => {
    expect(
      hasScheduledMaintenanceEventStarted({
        states: [],
        currentState: stateModel(VERIFYING),
      }),
    ).toBe(false);
    // Its place among the states the list holds is what says it has started.
    expect(
      hasScheduledMaintenanceEventStarted({
        states: [stateModel(ONGOING)],
        currentState: stateModel(VERIFYING),
      }),
    ).toBe(true);
  });

  test("an event in no state, or one the page could not read, has not started", () => {
    for (const currentState of [undefined, null, "", 3]) {
      expect(
        hasScheduledMaintenanceEventStarted({
          states: PROJECT_STATES,
          currentState: currentState,
        }),
      ).toBe(false);
    }
  });

  test("a flag on the event's own state outweighs its place", () => {
    // Flagged ongoing, placed first: started.
    expect(
      hasScheduledMaintenanceEventStarted({
        states: PROJECT_STATES,
        currentState: stateModel({ ...ONGOING, order: 0 }),
      }),
    ).toBe(true);
    // Flagged scheduled, placed last: not started.
    expect(
      hasScheduledMaintenanceEventStarted({
        states: PROJECT_STATES,
        currentState: stateModel({ ...SCHEDULED, order: 99 }),
      }),
    ).toBe(false);
  });
});

describe("the id a form value holds for the status", () => {
  test.each([
    ["an id", STATUS_ID, STATUS_ID],
    ["an id with spaces around it", `  ${STATUS_ID} `, STATUS_ID],
    ["an ObjectID", new ObjectID(STATUS_ID), STATUS_ID],
    ["a relation carrying _id", { _id: STATUS_ID }, STATUS_ID],
    ["a relation carrying id", { id: STATUS_ID }, STATUS_ID],
    [
      "a relation carrying an ObjectID",
      { _id: new ObjectID(STATUS_ID) },
      STATUS_ID,
    ],
  ])("%s", (_name: string, value: unknown, expected: string) => {
    expect(getMonitorStatusIdFromFormValue(value)).toBe(expected);
  });

  test("a status model is read by its id", () => {
    const status: MonitorStatus = new MonitorStatus();
    status._id = STATUS_ID;

    expect(getMonitorStatusIdFromFormValue(status)).toBe(STATUS_ID);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty id", ""],
    ["spaces", "   "],
    ["a number", 7],
    ["a relation without an id", { name: "Degraded" }],
    ["a relation whose id is another relation", { _id: { _id: STATUS_ID } }],
  ])("none for %s", (_name: string, value: unknown) => {
    expect(getMonitorStatusIdFromFormValue(value)).toBeNull();
  });
});

describe("what the Edit sends for the event", () => {
  function eventWithStatus(): ScheduledMaintenance {
    const status: MonitorStatus = new MonitorStatus();
    status._id = STATUS_ID;

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.title = "Database upgrade";
    event.changeMonitorStatusTo = status;
    event.changeMonitorStatusToId = new ObjectID(STATUS_ID);

    return event;
  }

  function sentStatusOf(event: ScheduledMaintenance): {
    relation: unknown;
    id: unknown;
  } {
    const json: JSONObject = BaseModel.toJSON(event, ScheduledMaintenance);

    return {
      relation: (json["changeMonitorStatusTo"] as JSONObject | undefined)?.[
        "_id"
      ],
      id: json["changeMonitorStatusToId"],
    };
  }

  test("before the event starts, with a monitor picked: the status picked, under both names", () => {
    const event: ScheduledMaintenance = eventWithStatus();

    const sent: ScheduledMaintenance =
      getScheduledMaintenanceAffectedResourcesToSave({
        item: event,
        formValues: { monitors: [MONITOR_ID] },
        hasEventStarted: false,
      });

    expect(sent).toBe(event);
    expect(sentStatusOf(sent).relation).toBe(STATUS_ID);
    expect(sent.changeMonitorStatusToId?.toString()).toBe(STATUS_ID);
  });

  test("before the event starts, with no monitor: no status, and the rest as it was", () => {
    const sent: ScheduledMaintenance =
      getScheduledMaintenanceAffectedResourcesToSave({
        item: eventWithStatus(),
        formValues: { monitors: [], hosts: [HOST_ID] },
        hasEventStarted: false,
      });

    expect(sentStatusOf(sent)).toEqual({ relation: undefined, id: undefined });
    expect(sent.title).toBe("Database upgrade");
  });

  test.each([
    ["with a monitor picked", { monitors: [MONITOR_ID] }],
    ["with none", { monitors: [] }],
    [
      "with a monitor picked as a relation",
      { monitors: [{ _id: MONITOR_ID }] },
    ],
  ])(
    "once the event has started, %s: no status at all, and the rest as it was",
    (_name: string, formValues: JSONObject) => {
      const sent: ScheduledMaintenance =
        getScheduledMaintenanceAffectedResourcesToSave({
          item: eventWithStatus(),
          formValues: formValues,
          hasEventStarted: true,
        });

      expect(sent.changeMonitorStatusTo).toBeUndefined();
      expect(sent.changeMonitorStatusToId).toBeUndefined();
      expect(sentStatusOf(sent)).toEqual({
        relation: undefined,
        id: undefined,
      });
      expect(sent.title).toBe("Database upgrade");
    },
  );

  test("an event the form holds no status for sends none, started or not", () => {
    for (const hasEventStarted of [false, true]) {
      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event.title = "Database upgrade";

      const sent: ScheduledMaintenance =
        getScheduledMaintenanceAffectedResourcesToSave({
          item: event,
          formValues: { monitors: [MONITOR_ID] },
          hasEventStarted: hasEventStarted,
        });

      expect(sentStatusOf(sent)).toEqual({
        relation: undefined,
        id: undefined,
      });
    }
  });
});

// Comment-stripped, whitespace-squashed source.
function dense(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

describe("the read-only status, once the event has started", () => {
  const element: string = dense(
    "Components/ScheduledMaintenance/StartedEventMonitorStatus.tsx",
  );

  test("draws the status the event holds, as a monitor's status is drawn, without the pulse", () => {
    expect(element).toContain(
      "const monitorStatusId: string | null = getMonitorStatusIdFromFormValue( props.monitorStatus, );",
    );
    expect(element).toContain(
      "<FetchMonitorStatuses monitorStatusIds={[new ObjectID(monitorStatusId)]} shouldAnimate={false} />",
    );
  });

  test("with no status, says what that means: the monitors keep theirs", () => {
    expect(element).toContain(
      'translator.translateText("Monitors keep their status.")',
    );
  });

  test("offers nothing to change it with", () => {
    for (const control of [
      "<Dropdown",
      "<EntityDropdown",
      "<input",
      "<button",
      "<Button",
      "onChange",
    ]) {
      expect(`${control}: ${element.includes(control)}`).toBe(
        `${control}: false`,
      );
    }
  });
});

describe("the event's page", () => {
  const page: string = dense("Pages/ScheduledMaintenanceEvents/View/Index.tsx");

  test("reads the project's states with the event, in their order, with what tells them apart", () => {
    expect(page).toContain(
      "await ModelAPI.getList<ScheduledMaintenanceState>({ modelType: ScheduledMaintenanceState, query: { projectId: projectId, }, limit: LIMIT_PER_PROJECT, skip: 0, select: { _id: true, order: true, isScheduledState: true, isOngoingState: true, isEndedState: true, isResolvedState: true, }, sort: { order: SortOrder.Ascending, }, });",
    );
    // Sent before the event's own read, and awaited after it.
    const statesRequest: number = page.indexOf(
      "const statesRequest: Promise<Array<ScheduledMaintenanceState>> = fetchScheduledMaintenanceStates();",
    );
    const eventRead: number = page.indexOf(
      "await ModelAPI.getItem<ScheduledMaintenance>({",
    );
    const statesAwaited: number = page.indexOf(
      "const states: Array<ScheduledMaintenanceState> = await statesRequest;",
    );

    expect(statesRequest).toBeGreaterThan(-1);
    expect(statesRequest).toBeLessThan(eventRead);
    expect(statesAwaited).toBeGreaterThan(eventRead);
  });

  test("a failed read of the states answers none, and never fails the page", () => {
    expect(page).toContain("return states.data; } catch { return []; }");
  });

  test("selects the event's state with its place and every flag", () => {
    expect(page).toContain(
      "currentScheduledMaintenanceState: { _id: true, order: true, isScheduledState: true, isOngoingState: true, isEndedState: true, isResolvedState: true, },",
    );
  });

  test("tells the Affected Resources card whether the event has started, for its Edit and its save", () => {
    expect(page).toContain(
      "const hasEventStarted: boolean = hasScheduledMaintenanceEventStarted({ states: loadedEvent?.states || [], currentState: scheduledMaintenance?.currentScheduledMaintenanceState, });",
    );
    expect(page).toContain(
      "formFields={getScheduledMaintenanceAffectedResourcesFormFields({ hasEventStarted: hasEventStarted, })}",
    );
    expect(page).toContain(
      "onBeforeUpdate={getScheduledMaintenanceAffectedResourcesOnBeforeUpdate( { hasEventStarted: hasEventStarted, }, )}",
    );
  });

  test("the card shows the status under the monitors, while the event has one", () => {
    expect(page).toContain(
      'field: { changeMonitorStatusTo: { name: true, color: true, }, }, title: "Change Monitor Status to", fieldType: FieldType.Entity, showIf: (item: ScheduledMaintenance): boolean => { return (item.monitors || []).length > 0; }, getElement: (item: ScheduledMaintenance): ReactElement => { return ( <ChangeMonitorStatusToElement monitorStatus={item.changeMonitorStatusTo} /> ); },',
    );
  });
});
