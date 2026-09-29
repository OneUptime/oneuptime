import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentAlertService, {
  chooseLinkedAlertTargetState,
  getLinkedAlertStateTargets,
  LinkedAlertStateTargets,
} from "../../../Server/Services/IncidentAlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import logger from "../../../Server/Utils/Logger";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * The opt-in lifecycle sync between an incident and the alerts linked to it.
 *
 * When the project turns the switches on, acknowledging an incident
 * acknowledges its linked alerts (which is what stops their paging) and
 * resolving it resolves them - except an alert another open incident is still
 * tracking. States are compared by order, custom states between Acknowledged
 * and Resolved included; an alert is never moved backwards, never moved to
 * where it already is, and one alert failing never stops the rest.
 *
 * The database is replaced by small in-memory tables. Every read the cascade
 * makes is answered from them, and every state change it asks for is recorded
 * instead of written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194b2f8-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194b2f8-0000-4000-8000-0000000000a1",
);
const OPEN_INCIDENT_ID: ObjectID = new ObjectID(
  "0194b2f8-0000-4000-8000-0000000000a2",
);
const RESOLVED_INCIDENT_ID: ObjectID = new ObjectID(
  "0194b2f8-0000-4000-8000-0000000000a3",
);

// Alert ids, named after the state each starts in.
const CREATED_ALERT: string = "0194b2f8-0000-4000-8000-0000000000b1";
const SECOND_CREATED_ALERT: string = "0194b2f8-0000-4000-8000-0000000000b2";
const ACKNOWLEDGED_ALERT: string = "0194b2f8-0000-4000-8000-0000000000b3";
const INVESTIGATING_ALERT: string = "0194b2f8-0000-4000-8000-0000000000b4";
const RESOLVED_ALERT: string = "0194b2f8-0000-4000-8000-0000000000b5";

interface StateRow {
  id: string;
  name: string;
  order: number;
  isAcknowledged?: boolean;
  isResolved?: boolean;
}

// Incident states. "Monitoring" is a custom state between ack and resolve.
const INCIDENT_CREATED: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000c1",
  name: "Created",
  order: 1,
};
const INCIDENT_ACKNOWLEDGED: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000c2",
  name: "Acknowledged",
  order: 2,
  isAcknowledged: true,
};
const INCIDENT_MONITORING: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000c3",
  name: "Monitoring",
  order: 3,
};
const INCIDENT_RESOLVED: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000c4",
  name: "Resolved",
  order: 4,
  isResolved: true,
};

// Alert states. "Investigating" is a custom state between ack and resolve.
const ALERT_CREATED: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000d1",
  name: "Created",
  order: 1,
};
const ALERT_ACKNOWLEDGED: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000d2",
  name: "Acknowledged",
  order: 2,
  isAcknowledged: true,
};
const ALERT_INVESTIGATING: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000d3",
  name: "Investigating",
  order: 3,
};
const ALERT_RESOLVED: StateRow = {
  id: "0194b2f8-0000-4000-8000-0000000000d4",
  name: "Resolved",
  order: 4,
  isResolved: true,
};

interface Tables {
  switches: { acknowledge: boolean; resolve: boolean } | null;
  incidentStates: Array<StateRow>;
  alertStates: Array<StateRow>;
  // incident id -> current state id
  incidents: Map<string, string>;
  // alert id -> current state id
  alerts: Map<string, string>;
  links: Array<{ incidentId: string; alertId: string }>;
}

let tables: Tables;

interface StateChange {
  alertId: string;
  alertStateId: string;
  rootCause: string | undefined;
  notifyOwners: boolean;
  stateChangeLog: JSONObject | undefined;
  props: DatabaseCommonInteractionProps | undefined;
  projectId: string;
}

let changes: Array<StateChange>;
let changeAlertState: jest.SpyInstance;
let incidentStateLookup: jest.SpyInstance;
let alertStateLookup: jest.SpyInstance;
let linkLookup: jest.SpyInstance;
let alertLookup: jest.SpyInstance;
let errorLog: jest.SpyInstance;

function freshTables(): Tables {
  return {
    switches: { acknowledge: true, resolve: true },
    incidentStates: [
      INCIDENT_CREATED,
      INCIDENT_ACKNOWLEDGED,
      INCIDENT_MONITORING,
      INCIDENT_RESOLVED,
    ],
    alertStates: [
      ALERT_CREATED,
      ALERT_ACKNOWLEDGED,
      ALERT_INVESTIGATING,
      ALERT_RESOLVED,
    ],
    incidents: new Map([
      [INCIDENT_ID.toString(), INCIDENT_CREATED.id],
      [OPEN_INCIDENT_ID.toString(), INCIDENT_ACKNOWLEDGED.id],
      [RESOLVED_INCIDENT_ID.toString(), INCIDENT_RESOLVED.id],
    ]),
    alerts: new Map([
      [CREATED_ALERT, ALERT_CREATED.id],
      [SECOND_CREATED_ALERT, ALERT_CREATED.id],
      [ACKNOWLEDGED_ALERT, ALERT_ACKNOWLEDGED.id],
      [INVESTIGATING_ALERT, ALERT_INVESTIGATING.id],
      [RESOLVED_ALERT, ALERT_RESOLVED.id],
    ]),
    links: [],
  };
}

function link(alertId: string, incidentId: ObjectID = INCIDENT_ID): void {
  tables.links.push({ incidentId: incidentId.toString(), alertId: alertId });
}

// The ids a QueryHelper.any(...) filter matches, or the one plain value.
function idsIn(value: unknown): Array<string> | null {
  if (value === undefined) {
    return null;
  }

  if (value instanceof FindOperator) {
    const parameters: Array<unknown> = Object.values(
      value.objectLiteralParameters || {},
    );
    return ((parameters[0] as Array<string>) || []).map((id: string) => {
      return id.toLowerCase();
    });
  }

  return [String(value).toLowerCase()];
}

function matches(value: string, filter: Array<string> | null): boolean {
  return filter === null || filter.includes(value.toLowerCase());
}

function incidentStateModel(row: StateRow): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = row.id;
  state.name = row.name;
  state.order = row.order;
  state.isAcknowledgedState = Boolean(row.isAcknowledged);
  state.isResolvedState = Boolean(row.isResolved);
  state.isCreatedState = row.order === 1;
  return state;
}

function alertStateModel(row: StateRow): AlertState {
  const state: AlertState = new AlertState();
  state._id = row.id;
  state.name = row.name;
  state.order = row.order;
  state.isAcknowledgedState = Boolean(row.isAcknowledged);
  state.isResolvedState = Boolean(row.isResolved);
  state.isCreatedState = row.order === 1;
  return state;
}

function incidentModel(id: string): Incident | null {
  const stateId: string | undefined = tables.incidents.get(id);

  if (!stateId) {
    return null;
  }

  const incident: Incident = new Incident();
  incident._id = id;
  incident.projectId = PROJECT_ID;
  incident.currentIncidentStateId = new ObjectID(stateId);
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";
  return incident;
}

beforeEach(() => {
  tables = freshTables();
  changes = [];

  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (): Promise<Project | null> => {
      if (!tables.switches) {
        return null;
      }
      const project: Project = new Project();
      project._id = PROJECT_ID.toString();
      project.acknowledgeLinkedAlertsWhenIncidentAcknowledged =
        tables.switches.acknowledge;
      project.resolveLinkedAlertsWhenIncidentResolved = tables.switches.resolve;
      return project;
    }) as never);

  incidentStateLookup = jest
    .spyOn(IncidentStateService, "getAllIncidentStates")
    .mockImplementation((async (): Promise<Array<IncidentState>> => {
      return tables.incidentStates.map(incidentStateModel);
    }) as never);

  alertStateLookup = jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockImplementation((async (): Promise<Array<AlertState>> => {
      return tables.alertStates.map(alertStateModel);
    }) as never);

  linkLookup = jest
    .spyOn(IncidentAlertService, "findBy")
    .mockImplementation((async (args: {
      query: { incidentId?: unknown; alertId?: unknown; projectId?: unknown };
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<IncidentAlert>> => {
      expect(args.props).toEqual({ isRoot: true });
      expect(String(args.query.projectId)).toBe(PROJECT_ID.toString());

      const incidentFilter: Array<string> | null = idsIn(args.query.incidentId);
      const alertFilter: Array<string> | null = idsIn(args.query.alertId);

      return tables.links
        .filter((row: { incidentId: string; alertId: string }) => {
          return (
            matches(row.incidentId, incidentFilter) &&
            matches(row.alertId, alertFilter)
          );
        })
        .map((row: { incidentId: string; alertId: string }) => {
          const model: IncidentAlert = new IncidentAlert();
          model.incidentId = new ObjectID(row.incidentId);
          model.alertId = new ObjectID(row.alertId);
          model.projectId = PROJECT_ID;
          return model;
        });
    }) as never);

  alertLookup = jest
    .spyOn(AlertService, "findBy")
    .mockImplementation((async (args: {
      query: { _id?: unknown };
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<Alert>> => {
      expect(args.props).toEqual({ isRoot: true });
      const filter: Array<string> | null = idsIn(args.query._id);

      return Array.from(tables.alerts.entries())
        .filter(([id]: [string, string]) => {
          return matches(id, filter);
        })
        .map(([id, stateId]: [string, string]) => {
          const alert: Alert = new Alert();
          alert._id = id;
          alert.currentAlertStateId = new ObjectID(stateId);
          return alert;
        });
    }) as never);

  jest.spyOn(IncidentService, "findBy").mockImplementation((async (args: {
    query: { _id?: unknown };
  }): Promise<Array<Incident>> => {
    const filter: Array<string> | null = idsIn(args.query._id);

    return Array.from(tables.incidents.keys())
      .filter((id: string) => {
        return matches(id, filter);
      })
      .map((id: string) => {
        return incidentModel(id)!;
      });
  }) as never);

  jest.spyOn(IncidentService, "findOneById").mockImplementation((async (args: {
    id: ObjectID;
  }): Promise<Incident | null> => {
    return incidentModel(args.id.toString());
  }) as never);

  changeAlertState = jest
    .spyOn(AlertService, "changeAlertState")
    .mockImplementation((async (data: {
      projectId: ObjectID;
      alertId: ObjectID;
      alertStateId: ObjectID;
      notifyOwners: boolean;
      rootCause: string | undefined;
      stateChangeLog: JSONObject | undefined;
      props: DatabaseCommonInteractionProps | undefined;
    }): Promise<void> => {
      changes.push({
        alertId: data.alertId.toString(),
        alertStateId: data.alertStateId.toString(),
        rootCause: data.rootCause,
        notifyOwners: data.notifyOwners,
        stateChangeLog: data.stateChangeLog,
        props: data.props,
        projectId: data.projectId.toString(),
      });
    }) as never);

  errorLog = jest.spyOn(logger, "error").mockImplementation((() => {
    // quiet
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function setSwitches(acknowledge: boolean, resolve: boolean): void {
  tables.switches = { acknowledge, resolve };
}

async function cascade(incidentState: StateRow): Promise<void> {
  tables.incidents.set(INCIDENT_ID.toString(), incidentState.id);

  await IncidentAlertService.cascadeIncidentStateToLinkedAlerts({
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    incidentStateId: new ObjectID(incidentState.id),
  });
}

// alert id -> state it was moved to (by name), in the order they were moved.
function moved(): Array<[string, string]> {
  return changes.map((change: StateChange): [string, string] => {
    const state: StateRow | undefined = tables.alertStates.find(
      (row: StateRow) => {
        return row.id === change.alertStateId;
      },
    );
    return [change.alertId, state?.name || change.alertStateId];
  });
}

function linkEveryAlert(): void {
  link(CREATED_ALERT);
  link(ACKNOWLEDGED_ALERT);
  link(INVESTIGATING_ALERT);
  link(RESOLVED_ALERT);
}

describe("the project switches", () => {
  test("both off (the default): nothing about the alerts is even read", async () => {
    setSwitches(false, false);
    linkEveryAlert();

    await cascade(INCIDENT_RESOLVED);

    expect(incidentStateLookup).not.toHaveBeenCalled();
    expect(alertStateLookup).not.toHaveBeenCalled();
    expect(linkLookup).not.toHaveBeenCalled();
    expect(alertLookup).not.toHaveBeenCalled();
    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("a project that cannot be read counts as both off", async () => {
    tables.switches = null;
    linkEveryAlert();

    await cascade(INCIDENT_RESOLVED);

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("acknowledge only: an acknowledged incident acknowledges the alerts behind it", async () => {
    setSwitches(true, false);
    linkEveryAlert();

    await cascade(INCIDENT_ACKNOWLEDGED);

    // Acknowledged, Investigating and Resolved alerts are already there.
    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
  });

  test("acknowledge only: a resolved incident still only acknowledges", async () => {
    setSwitches(true, false);
    linkEveryAlert();

    await cascade(INCIDENT_RESOLVED);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(changes[0]!.rootCause).toBe(
      "Acknowledged because linked Incident INC-42 was resolved.",
    );
  });

  test("resolve only: an acknowledged incident changes nothing", async () => {
    setSwitches(false, true);
    linkEveryAlert();

    await cascade(INCIDENT_ACKNOWLEDGED);

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(alertStateLookup).not.toHaveBeenCalled();
  });

  test("resolve only: a resolved incident resolves every alert that is not yet resolved", async () => {
    setSwitches(false, true);
    linkEveryAlert();

    await cascade(INCIDENT_RESOLVED);

    expect(moved()).toEqual([
      [CREATED_ALERT, "Resolved"],
      [ACKNOWLEDGED_ALERT, "Resolved"],
      [INVESTIGATING_ALERT, "Resolved"],
    ]);
  });

  test("both on: a resolved incident resolves, an acknowledged one acknowledges", async () => {
    setSwitches(true, true);
    linkEveryAlert();

    await cascade(INCIDENT_ACKNOWLEDGED);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);

    changes = [];
    await cascade(INCIDENT_RESOLVED);

    expect(moved()).toEqual([
      [CREATED_ALERT, "Resolved"],
      [ACKNOWLEDGED_ALERT, "Resolved"],
      [INVESTIGATING_ALERT, "Resolved"],
    ]);
  });

  test("an incident back in its created state changes nothing", async () => {
    setSwitches(true, true);
    linkEveryAlert();

    await cascade(INCIDENT_CREATED);

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(linkLookup).not.toHaveBeenCalled();
  });
});

describe("states are compared by order", () => {
  test("an incident in a custom state past Acknowledged counts as acknowledged", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);
    link(INVESTIGATING_ALERT);

    await cascade(INCIDENT_MONITORING);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(changes[0]!.rootCause).toBe(
      "Acknowledged because linked Incident INC-42 was acknowledged.",
    );
  });

  test("an incident in a custom state before Resolved does not resolve anything", async () => {
    setSwitches(false, true);
    link(CREATED_ALERT);

    await cascade(INCIDENT_MONITORING);

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("an alert in a custom state past Acknowledged is not acknowledged again, or moved back", async () => {
    setSwitches(true, false);
    link(INVESTIGATING_ALERT);

    await cascade(INCIDENT_ACKNOWLEDGED);

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("an alert that is already resolved is left alone", async () => {
    setSwitches(true, true);
    link(RESOLVED_ALERT);

    await cascade(INCIDENT_RESOLVED);

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("custom state orders are honoured even when the flags would say otherwise", async () => {
    // A project whose Acknowledged alert state sits after a custom state.
    tables.alertStates = [
      ALERT_CREATED,
      { ...ALERT_INVESTIGATING, order: 2 },
      { ...ALERT_ACKNOWLEDGED, order: 3 },
      ALERT_RESOLVED,
    ];
    setSwitches(true, false);
    link(INVESTIGATING_ALERT);

    await cascade(INCIDENT_ACKNOWLEDGED);

    expect(moved()).toEqual([[INVESTIGATING_ALERT, "Acknowledged"]]);
  });
});

describe("an alert linked to more than one incident", () => {
  test("is not resolved while another linked incident is still open, but is acknowledged", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);
    link(CREATED_ALERT, OPEN_INCIDENT_ID);
    link(SECOND_CREATED_ALERT);
    link(SECOND_CREATED_ALERT, RESOLVED_INCIDENT_ID);

    await cascade(INCIDENT_RESOLVED);

    expect(moved()).toEqual([
      [CREATED_ALERT, "Acknowledged"],
      [SECOND_CREATED_ALERT, "Resolved"],
    ]);
  });

  test("with only the resolve switch on, an alert another open incident tracks is left alone", async () => {
    setSwitches(false, true);
    link(CREATED_ALERT);
    link(CREATED_ALERT, OPEN_INCIDENT_ID);

    await cascade(INCIDENT_RESOLVED);

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("an already-acknowledged alert held open by another incident stays acknowledged", async () => {
    setSwitches(true, true);
    link(ACKNOWLEDGED_ALERT);
    link(ACKNOWLEDGED_ALERT, OPEN_INCIDENT_ID);

    await cascade(INCIDENT_RESOLVED);

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("another incident whose state cannot be placed counts as open", async () => {
    setSwitches(false, true);
    tables.incidents.set(
      OPEN_INCIDENT_ID.toString(),
      "0194b2f8-0000-4000-8000-0000000000ff",
    );
    link(CREATED_ALERT);
    link(CREATED_ALERT, OPEN_INCIDENT_ID);

    await cascade(INCIDENT_RESOLVED);

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("acknowledging does not look at the other incidents at all", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);
    link(CREATED_ALERT, OPEN_INCIDENT_ID);

    await cascade(INCIDENT_ACKNOWLEDGED);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    // Only the incident's own links were read.
    expect(linkLookup).toHaveBeenCalledTimes(1);
  });
});

describe("how each alert is moved", () => {
  test("as root, without notifying owners, with a cause that names the incident", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);

    await cascade(INCIDENT_RESOLVED);

    expect(changes).toEqual([
      {
        alertId: CREATED_ALERT,
        alertStateId: ALERT_RESOLVED.id,
        rootCause: "Resolved because linked Incident INC-42 was resolved.",
        notifyOwners: false,
        stateChangeLog: undefined,
        props: { isRoot: true },
        projectId: PROJECT_ID.toString(),
      },
    ]);
  });

  test("an incident with no prefixed number is named by #number", async () => {
    setSwitches(true, false);
    link(CREATED_ALERT);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockImplementation((async (): Promise<Incident> => {
        const incident: Incident = new Incident();
        incident.incidentNumber = 9;
        return incident;
      }) as never);

    await cascade(INCIDENT_ACKNOWLEDGED);

    expect(changes[0]!.rootCause).toBe(
      "Acknowledged because linked Incident #9 was acknowledged.",
    );
  });

  test("one alert failing does not stop the others", async () => {
    setSwitches(true, false);
    link(CREATED_ALERT);
    link(SECOND_CREATED_ALERT);

    const record: jest.SpyInstance = changeAlertState;
    const recordChange: (data: never) => Promise<void> =
      record.getMockImplementation() as (data: never) => Promise<void>;

    changeAlertState.mockImplementation((async (data: {
      alertId: ObjectID;
    }): Promise<void> => {
      if (data.alertId.toString() === CREATED_ALERT) {
        throw new Error("Alert state cannot be same as previous state.");
      }
      return recordChange(data as never);
    }) as never);

    await expect(cascade(INCIDENT_ACKNOWLEDGED)).resolves.toBeUndefined();

    expect(changeAlertState).toHaveBeenCalledTimes(2);
    expect(moved()).toEqual([[SECOND_CREATED_ALERT, "Acknowledged"]]);
    expect(errorLog).toHaveBeenCalled();
  });

  test("an alert whose current state is unknown is skipped and logged", async () => {
    setSwitches(true, false);
    tables.alerts.set(CREATED_ALERT, "0194b2f8-0000-4000-8000-0000000000ee");
    link(CREATED_ALERT);
    link(SECOND_CREATED_ALERT);

    await cascade(INCIDENT_ACKNOWLEDGED);

    expect(moved()).toEqual([[SECOND_CREATED_ALERT, "Acknowledged"]]);
    expect(errorLog).toHaveBeenCalled();
  });

  test("an incident with no linked alerts reads no alerts", async () => {
    setSwitches(true, true);

    await cascade(INCIDENT_RESOLVED);

    expect(alertLookup).not.toHaveBeenCalled();
    expect(changeAlertState).not.toHaveBeenCalled();
  });
});

describe("a project missing a state never throws", () => {
  test("no Acknowledged alert state: logged, nothing moved", async () => {
    setSwitches(true, false);
    tables.alertStates = [ALERT_CREATED, ALERT_RESOLVED];
    link(CREATED_ALERT);

    await expect(cascade(INCIDENT_ACKNOWLEDGED)).resolves.toBeUndefined();

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  test("no Resolved alert state: logged, and the alerts are still acknowledged", async () => {
    setSwitches(true, true);
    tables.alertStates = [ALERT_CREATED, ALERT_ACKNOWLEDGED];
    link(CREATED_ALERT);

    await cascade(INCIDENT_RESOLVED);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(errorLog).toHaveBeenCalled();
  });

  test("no Acknowledged incident state: acknowledging never triggers", async () => {
    setSwitches(true, false);
    tables.incidentStates = [
      INCIDENT_CREATED,
      INCIDENT_MONITORING,
      INCIDENT_RESOLVED,
    ];
    link(CREATED_ALERT);

    await expect(cascade(INCIDENT_MONITORING)).resolves.toBeUndefined();

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("an incident state that is not in the project: logged, nothing moved", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);

    await IncidentAlertService.cascadeIncidentStateToLinkedAlerts({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      incidentStateId: new ObjectID("0194b2f8-0000-4000-8000-0000000000fe"),
    });

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  test("a lookup that throws is logged, not thrown", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);
    alertStateLookup.mockRejectedValue(
      new Error("Acknowledged Alert State not found for this project") as never,
    );

    await expect(cascade(INCIDENT_RESOLVED)).resolves.toBeUndefined();

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalled();
  });

  test("an incident that no longer exists is skipped", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    await cascade(INCIDENT_RESOLVED);

    expect(changeAlertState).not.toHaveBeenCalled();
  });
});

describe("link-time sync: linking an alert to an incident that has moved on", () => {
  async function sync(alertId: string): Promise<void> {
    await IncidentAlertService.syncAlertWithLinkedIncidentState({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      alertId: new ObjectID(alertId),
    });
  }

  test("an alert linked to an acknowledged incident is acknowledged", async () => {
    setSwitches(true, true);
    tables.incidents.set(INCIDENT_ID.toString(), INCIDENT_ACKNOWLEDGED.id);
    link(CREATED_ALERT);

    await sync(CREATED_ALERT);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(changes[0]!.rootCause).toBe(
      "Acknowledged because linked Incident INC-42 was acknowledged.",
    );
    expect(changes[0]!.notifyOwners).toBe(false);
    expect(changes[0]!.props).toEqual({ isRoot: true });
  });

  test("an alert linked to a resolved incident is resolved", async () => {
    setSwitches(true, true);
    tables.incidents.set(INCIDENT_ID.toString(), INCIDENT_RESOLVED.id);
    link(CREATED_ALERT);

    await sync(CREATED_ALERT);

    expect(moved()).toEqual([[CREATED_ALERT, "Resolved"]]);
  });

  test("only the alert that was linked is touched", async () => {
    setSwitches(true, true);
    tables.incidents.set(INCIDENT_ID.toString(), INCIDENT_RESOLVED.id);
    link(CREATED_ALERT);
    link(SECOND_CREATED_ALERT);

    await sync(SECOND_CREATED_ALERT);

    expect(moved()).toEqual([[SECOND_CREATED_ALERT, "Resolved"]]);
  });

  test("an alert still tracked by another open incident is only acknowledged", async () => {
    setSwitches(true, true);
    tables.incidents.set(INCIDENT_ID.toString(), INCIDENT_RESOLVED.id);
    link(CREATED_ALERT);
    link(CREATED_ALERT, OPEN_INCIDENT_ID);

    await sync(CREATED_ALERT);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
  });

  test("an incident in its created state (a newly declared one) changes nothing", async () => {
    setSwitches(true, true);
    link(CREATED_ALERT);

    await sync(CREATED_ALERT);

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(alertLookup).not.toHaveBeenCalled();
  });

  test("both switches off: the incident is not even read", async () => {
    setSwitches(false, false);
    const incidentRead: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );

    await sync(CREATED_ALERT);

    expect(incidentRead).not.toHaveBeenCalled();
    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("an incident that cannot be read is skipped", async () => {
    setSwitches(true, true);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    await expect(sync(CREATED_ALERT)).resolves.toBeUndefined();

    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("a failure is logged, never thrown", async () => {
    setSwitches(true, true);
    tables.incidents.set(INCIDENT_ID.toString(), INCIDENT_RESOLVED.id);
    alertLookup.mockRejectedValue(new Error("database unavailable") as never);

    await expect(sync(CREATED_ALERT)).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalled();
  });
});

describe("the decision, as pure functions", () => {
  test.each([
    // [incident order, ack switch, resolve switch, expected]
    [1, true, true, { acknowledge: false, resolve: false, reached: false }],
    [2, true, true, { acknowledge: true, resolve: false, reached: false }],
    [3, true, true, { acknowledge: true, resolve: false, reached: false }],
    [4, true, true, { acknowledge: true, resolve: true, reached: true }],
    [4, true, false, { acknowledge: true, resolve: false, reached: true }],
    [4, false, true, { acknowledge: false, resolve: true, reached: true }],
    [4, false, false, { acknowledge: false, resolve: false, reached: true }],
    [2, false, true, { acknowledge: false, resolve: false, reached: false }],
  ])(
    "an incident at order %i with ack=%s resolve=%s",
    (
      incidentStateOrder: number,
      acknowledgeSwitch: boolean,
      resolveSwitch: boolean,
      expected: { acknowledge: boolean; resolve: boolean; reached: boolean },
    ) => {
      const targets: LinkedAlertStateTargets = getLinkedAlertStateTargets({
        incidentStateOrder: incidentStateOrder,
        acknowledgedIncidentStateOrder: 2,
        resolvedIncidentStateOrder: 4,
        acknowledgeSwitch: acknowledgeSwitch,
        resolveSwitch: resolveSwitch,
      });

      expect(targets).toEqual({
        acknowledge: expected.acknowledge,
        resolve: expected.resolve,
        incidentReachedResolved: expected.reached,
      });
    },
  );

  test("a project without the incident state never reaches it", () => {
    expect(
      getLinkedAlertStateTargets({
        incidentStateOrder: 99,
        acknowledgedIncidentStateOrder: undefined,
        resolvedIncidentStateOrder: undefined,
        acknowledgeSwitch: true,
        resolveSwitch: true,
      }),
    ).toEqual({
      acknowledge: false,
      resolve: false,
      incidentReachedResolved: false,
    });
  });

  const ack: { name: string; order: number } = { name: "ack", order: 2 };
  const resolved: { name: string; order: number } = {
    name: "resolved",
    order: 4,
  };

  test.each([
    // [alert order, ack target, resolve target, blocked, expected]
    [1, ack, resolved, false, "resolved"],
    [1, ack, resolved, true, "ack"],
    [3, ack, resolved, true, null],
    [3, ack, resolved, false, "resolved"],
    [4, ack, resolved, false, null],
    [5, ack, resolved, false, null],
    [1, ack, undefined, false, "ack"],
    [2, ack, undefined, false, null],
    [1, undefined, resolved, true, null],
    [1, undefined, undefined, false, null],
  ])(
    "an alert at order %i",
    (
      alertStateOrder: number,
      acknowledgedAlertState: { name: string; order: number } | undefined,
      resolvedAlertState: { name: string; order: number } | undefined,
      isBlockedFromResolve: boolean,
      expected: string | null,
    ) => {
      const target: { name: string; order: number } | null =
        chooseLinkedAlertTargetState({
          alertStateOrder: alertStateOrder,
          acknowledgedAlertState: acknowledgedAlertState,
          resolvedAlertState: resolvedAlertState,
          isBlockedFromResolve: isBlockedFromResolve,
        });

      expect(target?.name ?? null).toBe(expected);
    },
  );
});
