import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentAlertService, {
  AcknowledgeDeclaredAlertsResult,
  getDeclaredAlertAcknowledgementCause,
} from "../../../Server/Services/IncidentAlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import AlertStateChangeAuthorization from "../../../Server/Utils/Alert/AlertStateChangeAuthorization";
import logger from "../../../Server/Utils/Logger";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentAlert from "../../../Models/DatabaseModels/IncidentAlert";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Project from "../../../Models/DatabaseModels/Project";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import {
  INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY,
  INCIDENT_ALERT_IDS_TO_LINK_KEY,
} from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * Declaring an incident from alerts can also acknowledge those alerts, which
 * is what stops their on-call escalation. Pinned here, against stubbed
 * neighbours and no database:
 *
 * - validateAcknowledgeAlertsForNewIncident, the check IncidentService's
 *   onBeforeCreate runs before the incident number is taken: what the
 *   miscDataProps flag may be, what it needs, and who may ask for it;
 * - acknowledgeAlertsDeclaredWithIncident, the fire-and-forget write after
 *   the links exist: who the change is credited to, what "why" it carries
 *   (never naming a private incident), which alerts it leaves alone (already
 *   acknowledged or later, or owned by the linked-alert sync), how each
 *   outcome is classified by reading the alert back, and that it never
 *   throws;
 * - getDeclaredAlertAcknowledgementCause, the "why" itself;
 * - AlertService.changeAlertState's new createdByUserId.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000a1",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "0194c3a9-0000-4000-8000-0000000000a2",
);
const USER_ID: ObjectID = new ObjectID("0194c3a9-0000-4000-8000-0000000000e1");

// Alert ids, named after the state each starts in.
const CREATED_ALERT: string = "0194c3a9-0000-4000-8000-0000000000b1";
const SECOND_CREATED_ALERT: string = "0194c3a9-0000-4000-8000-0000000000b2";
const THIRD_CREATED_ALERT: string = "0194c3a9-0000-4000-8000-0000000000b3";
const ACKNOWLEDGED_ALERT: string = "0194c3a9-0000-4000-8000-0000000000b4";
const INVESTIGATING_ALERT: string = "0194c3a9-0000-4000-8000-0000000000b5";
const RESOLVED_ALERT: string = "0194c3a9-0000-4000-8000-0000000000b6";
// Not in this project: the project-scoped read never returns it.
const FOREIGN_ALERT: string = "0194c3a9-0000-4000-8000-0000000000b7";

const PERMISSION_MESSAGE: string =
  "You do not have permission to acknowledge one or more of these alerts. Declare the incident without acknowledging them, or ask a project admin for permission.";
const NO_ACKNOWLEDGED_STATE_ON_CREATE_MESSAGE: string =
  "This project has no Acknowledged alert state, so the alerts cannot be acknowledged. Declare the incident without acknowledging them, or add an Acknowledged state in the alert settings.";
const NO_ACKNOWLEDGED_STATE_MESSAGE: string =
  "This project has no Acknowledged alert state, so the alerts could not be acknowledged.";
const NOT_FOUND_MESSAGE: string =
  "The alert could not be found in this project.";
const DID_NOT_CHANGE_MESSAGE: string =
  "The alert's state did not change to Acknowledged.";
const PRIVATE_CAUSE: string =
  "Acknowledged because a private incident was declared from this alert.";

interface StateRow {
  id: string;
  name: string;
  order: number;
  isAcknowledged?: boolean;
  isResolved?: boolean;
}

// Incident states. "Monitoring" is a custom state between ack and resolve.
const INCIDENT_CREATED: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000c1",
  name: "Created",
  order: 1,
};
const INCIDENT_ACKNOWLEDGED: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000c2",
  name: "Acknowledged",
  order: 2,
  isAcknowledged: true,
};
const INCIDENT_MONITORING: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000c3",
  name: "Monitoring",
  order: 3,
};
const INCIDENT_RESOLVED: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000c4",
  name: "Resolved",
  order: 4,
  isResolved: true,
};

// Alert states. "Investigating" is a custom state between ack and resolve.
const ALERT_CREATED: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000d1",
  name: "Created",
  order: 1,
};
const ALERT_ACKNOWLEDGED: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000d2",
  name: "Acknowledged",
  order: 2,
  isAcknowledged: true,
};
const ALERT_INVESTIGATING: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000d3",
  name: "Investigating",
  order: 3,
};
const ALERT_RESOLVED: StateRow = {
  id: "0194c3a9-0000-4000-8000-0000000000d4",
  name: "Resolved",
  order: 4,
  isResolved: true,
};

interface IncidentRow {
  incidentNumber: number | undefined;
  incidentNumberWithPrefix: string | undefined;
  title: string;
  isPrivate: boolean;
  stateId: string;
}

interface Tables {
  switches: { acknowledge: boolean; resolve: boolean };
  incidentStates: Array<StateRow>;
  alertStates: Array<StateRow>;
  // The incident being declared; null when it cannot be read.
  incident: IncidentRow | null;
  // Other incidents: id -> current state id.
  otherIncidents: Map<string, string>;
  // alert id -> current state id (this project's alerts only).
  alerts: Map<string, string>;
  links: Array<{ incidentId: string; alertId: string }>;
}

let tables: Tables;

function freshTables(): Tables {
  return {
    switches: { acknowledge: false, resolve: false },
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
    incident: {
      incidentNumber: 42,
      incidentNumberWithPrefix: "INC-42",
      title: "Payroll database is down",
      isPrivate: false,
      stateId: INCIDENT_CREATED.id,
    },
    otherIncidents: new Map(),
    alerts: new Map([
      [CREATED_ALERT, ALERT_CREATED.id],
      [SECOND_CREATED_ALERT, ALERT_CREATED.id],
      [THIRD_CREATED_ALERT, ALERT_CREATED.id],
      [ACKNOWLEDGED_ALERT, ALERT_ACKNOWLEDGED.id],
      [INVESTIGATING_ALERT, ALERT_INVESTIGATING.id],
      [RESOLVED_ALERT, ALERT_RESOLVED.id],
    ]),
    links: [],
  };
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

function stateRowById(id: string): StateRow | undefined {
  return tables.alertStates.find((row: StateRow) => {
    return row.id === id;
  });
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

function acknowledgedAlertStateRow(): StateRow | undefined {
  return tables.alertStates.find((row: StateRow) => {
    return row.isAcknowledged;
  });
}

// Every id in a result list, lower-cased, in order.
function ids(list: Array<ObjectID>): Array<string> {
  return list.map((id: ObjectID) => {
    return id.toString().toLowerCase();
  });
}

interface Outcome {
  acknowledged: Array<string>;
  alreadyAcknowledged: Array<string>;
  leftToSync: Array<string>;
  failed: Array<[string, string]>;
}

function outcome(result: AcknowledgeDeclaredAlertsResult): Outcome {
  return {
    acknowledged: ids(result.acknowledgedAlertIds),
    alreadyAcknowledged: ids(result.alreadyAcknowledgedAlertIds),
    leftToSync: ids(result.leftToLinkedAlertSyncAlertIds),
    failed: result.failed.map(
      (failure: { alertId: ObjectID; message: string }): [string, string] => {
        return [failure.alertId.toString().toLowerCase(), failure.message];
      },
    ),
  };
}

function emptyOutcome(): Outcome {
  return {
    acknowledged: [],
    alreadyAcknowledged: [],
    leftToSync: [],
    failed: [],
  };
}

interface StateChange {
  projectId: ObjectID;
  alertId: ObjectID;
  alertStateId: ObjectID;
  notifyOwners: boolean;
  rootCause: string | undefined;
  stateChangeLog: JSONObject | undefined;
  createdByUserId?: ObjectID | undefined;
  props: DatabaseCommonInteractionProps | undefined;
}

/*
 * What a state change does to the in-memory alert. The default is what the
 * real write does: the alert's current state moves to the one asked for.
 */
type WriteBehaviour = (change: StateChange) => Promise<void>;

function writeThrough(change: StateChange): Promise<void> {
  tables.alerts.set(
    change.alertId.toString().toLowerCase(),
    change.alertStateId.toString(),
  );
  return Promise.resolve();
}

let writeBehaviours: Map<string, WriteBehaviour>;
let changes: Array<StateChange>;

let changeAlertState: jest.SpyInstance;
let isAlertAcknowledged: jest.SpyInstance;
let acknowledgedStateLookup: jest.SpyInstance;
let incidentLookup: jest.SpyInstance;
let alertLookup: jest.SpyInstance;
let projectLookup: jest.SpyInstance;
let incidentStateLookup: jest.SpyInstance;
let alertStatesLookup: jest.SpyInstance;
let linkLookup: jest.SpyInstance;
let otherIncidentLookup: jest.SpyInstance;
let authorization: jest.SpyInstance;
let errorLog: jest.SpyInstance;

beforeEach(() => {
  tables = freshTables();
  changes = [];
  writeBehaviours = new Map();

  errorLog = jest.spyOn(logger, "error").mockImplementation((() => {
    // quiet
  }) as never);

  acknowledgedStateLookup = jest
    .spyOn(AlertStateService, "findOneBy")
    .mockImplementation((async (): Promise<AlertState | null> => {
      const row: StateRow | undefined = acknowledgedAlertStateRow();

      if (!row) {
        return null;
      }

      const state: AlertState = new AlertState();
      state._id = row.id;
      state.order = row.order;
      return state;
    }) as never);

  authorization = jest
    .spyOn(AlertStateChangeAuthorization, "assertCanChangeStateOfAlerts")
    .mockResolvedValue(undefined as never);

  incidentLookup = jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (args: {
      id: ObjectID;
    }): Promise<Incident | null> => {
      const row: IncidentRow | null = tables.incident;

      if (!row || args.id.toString() !== INCIDENT_ID.toString()) {
        return null;
      }

      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID.toString();
      incident.projectId = PROJECT_ID;
      incident.title = row.title;
      incident.isPrivate = row.isPrivate;
      incident.currentIncidentStateId = new ObjectID(row.stateId);

      if (row.incidentNumber !== undefined) {
        incident.incidentNumber = row.incidentNumber;
      }

      if (row.incidentNumberWithPrefix !== undefined) {
        incident.incidentNumberWithPrefix = row.incidentNumberWithPrefix;
      }

      return incident;
    }) as never);

  alertLookup = jest
    .spyOn(AlertService, "findBy")
    .mockImplementation((async (args: {
      query: { _id?: unknown; projectId?: unknown };
      props: DatabaseCommonInteractionProps;
    }): Promise<Array<Alert>> => {
      expect(args.props).toEqual({ isRoot: true });
      expect(String(args.query.projectId)).toBe(PROJECT_ID.toString());

      const filter: Array<string> | null = idsIn(args.query._id);

      return Array.from(tables.alerts.entries())
        .filter(([id]: [string, string]) => {
          return matches(id, filter);
        })
        .map(([id, stateId]: [string, string]) => {
          const alert: Alert = new Alert();
          alert._id = id;
          alert.currentAlertStateId = new ObjectID(stateId);

          const row: StateRow | undefined = stateRowById(stateId);

          if (row) {
            alert.currentAlertState = alertStateModel(row);
          }

          return alert;
        });
    }) as never);

  projectLookup = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation((async (): Promise<Project | null> => {
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

  alertStatesLookup = jest
    .spyOn(AlertStateService, "getAllAlertStates")
    .mockImplementation((async (): Promise<Array<AlertState>> => {
      return tables.alertStates.map(alertStateModel);
    }) as never);

  linkLookup = jest
    .spyOn(IncidentAlertService, "findBy")
    .mockImplementation((async (args: {
      query: { incidentId?: unknown; alertId?: unknown };
    }): Promise<Array<IncidentAlert>> => {
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

  otherIncidentLookup = jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation((async (args: {
      query: { _id?: unknown };
    }): Promise<Array<Incident>> => {
      const filter: Array<string> | null = idsIn(args.query._id);

      return Array.from(tables.otherIncidents.entries())
        .filter(([id]: [string, string]) => {
          return matches(id, filter);
        })
        .map(([id, stateId]: [string, string]) => {
          const incident: Incident = new Incident();
          incident._id = id;
          incident.currentIncidentStateId = new ObjectID(stateId);
          return incident;
        });
    }) as never);

  changeAlertState = jest
    .spyOn(AlertService, "changeAlertState")
    .mockImplementation((async (change: StateChange): Promise<void> => {
      changes.push(change);

      const behaviour: WriteBehaviour =
        writeBehaviours.get(change.alertId.toString().toLowerCase()) ||
        writeThrough;

      await behaviour(change);
    }) as never);

  // Reads the alert back the way AlertService.isAlertAcknowledged does.
  isAlertAcknowledged = jest
    .spyOn(AlertService, "isAlertAcknowledged")
    .mockImplementation((async (args: {
      alertId: ObjectID;
    }): Promise<boolean> => {
      const stateId: string | undefined = tables.alerts.get(
        args.alertId.toString().toLowerCase(),
      );

      if (!stateId) {
        throw new BadDataException("Alert not found");
      }

      const acknowledgedRow: StateRow | undefined = acknowledgedAlertStateRow();
      const row: StateRow | undefined = stateRowById(stateId);

      if (!acknowledgedRow || !row) {
        throw new BadDataException("Alert state not found");
      }

      return row.order >= acknowledgedRow.order;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Pass null for an API key, which acts for no user.
async function acknowledge(
  alertIds: Array<string>,
  options: {
    linkedAlertIds?: Array<string>;
    actor?: ObjectID | null;
  } = {},
): Promise<AcknowledgeDeclaredAlertsResult> {
  const actor: ObjectID | null =
    options.actor === undefined ? USER_ID : options.actor;

  return IncidentAlertService.acknowledgeAlertsDeclaredWithIncident({
    projectId: PROJECT_ID,
    incidentId: INCIDENT_ID,
    alertIds: alertIds.map((id: string) => {
      return new ObjectID(id);
    }),
    linkedAlertIds: (options.linkedAlertIds || alertIds).map((id: string) => {
      return new ObjectID(id);
    }),
    acknowledgedByUserId: actor || undefined,
  });
}

// alert id -> state it was moved to (by name), in the order they were moved.
function moved(): Array<[string, string]> {
  return changes.map((change: StateChange): [string, string] => {
    const row: StateRow | undefined = stateRowById(
      change.alertStateId.toString(),
    );
    return [
      change.alertId.toString().toLowerCase(),
      row?.name || change.alertStateId.toString(),
    ];
  });
}

function declaredInto(state: StateRow): void {
  tables.incident!.stateId = state.id;
}

function setSwitches(acknowledge: boolean, resolve: boolean): void {
  tables.switches = { acknowledge, resolve };
}

function link(alertId: string, incidentId: ObjectID = INCIDENT_ID): void {
  tables.links.push({ incidentId: incidentId.toString(), alertId: alertId });
}

function perAlertErrorLogs(): Array<unknown> {
  return errorLog.mock.calls.filter((call: Array<unknown>) => {
    return String(call[0]).startsWith(
      "IncidentAlertService could not acknowledge alert ",
    );
  });
}

describe("getDeclaredAlertAcknowledgementCause", () => {
  test("names the incident by its prefixed number", () => {
    expect(
      getDeclaredAlertAcknowledgementCause({
        incidentNumber: "INC-42",
        isIncidentPrivate: false,
      }),
    ).toBe(
      "Acknowledged because Incident INC-42 was declared from this alert.",
    );
  });

  test("names the incident by #number when the project has no prefix", () => {
    expect(
      getDeclaredAlertAcknowledgementCause({
        incidentNumber: "#7",
        isIncidentPrivate: false,
      }),
    ).toBe("Acknowledged because Incident #7 was declared from this alert.");
  });

  test("says just 'Incident' when the incident has no number", () => {
    expect(
      getDeclaredAlertAcknowledgementCause({
        incidentNumber: "",
        isIncidentPrivate: false,
      }),
    ).toBe("Acknowledged because Incident was declared from this alert.");
  });

  test("a private incident is not named at all, number or not", () => {
    const numbered: string = getDeclaredAlertAcknowledgementCause({
      incidentNumber: "INC-42",
      isIncidentPrivate: true,
    });
    const unnumbered: string = getDeclaredAlertAcknowledgementCause({
      incidentNumber: "",
      isIncidentPrivate: true,
    });

    expect(numbered).toBe(PRIVATE_CAUSE);
    expect(unnumbered).toBe(PRIVATE_CAUSE);
    expect(numbered).not.toContain("INC-42");
    expect(numbered).not.toContain("42");
  });
});

describe("validateAcknowledgeAlertsForNewIncident", () => {
  const ALERT_IDS: Array<ObjectID> = [
    new ObjectID(CREATED_ALERT),
    new ObjectID(SECOND_CREATED_ALERT),
  ];

  function memberProps(): DatabaseCommonInteractionProps {
    return {
      tenantId: PROJECT_ID,
      userId: USER_ID,
      userType: UserType.User,
    };
  }

  function validate(
    overrides: Partial<{
      projectId: ObjectID | undefined;
      acknowledgeAlerts: unknown;
      alertIds: Array<ObjectID>;
      props: DatabaseCommonInteractionProps;
    }> = {},
  ): Promise<ObjectID | null> {
    return IncidentAlertService.validateAcknowledgeAlertsForNewIncident({
      projectId: PROJECT_ID,
      acknowledgeAlerts: true,
      alertIds: ALERT_IDS,
      props: memberProps(),
      ...overrides,
    });
  }

  async function rejection(promise: Promise<unknown>): Promise<unknown> {
    try {
      await promise;
    } catch (error) {
      return error;
    }

    throw new Error("Expected the promise to reject, but it resolved.");
  }

  test("the key the flag travels under is 'acknowledgeAlertsToLink'", () => {
    expect(INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY).toBe(
      "acknowledgeAlertsToLink",
    );
  });

  test("not asked for (absent, null or false): null, and nothing is read or checked", async () => {
    for (const value of [undefined, null, false]) {
      await expect(validate({ acknowledgeAlerts: value })).resolves.toBeNull();
    }

    // Even with no alerts and no project: not asking is always fine.
    await expect(
      validate({
        acknowledgeAlerts: false,
        alertIds: [],
        projectId: undefined,
      }),
    ).resolves.toBeNull();

    expect(acknowledgedStateLookup).not.toHaveBeenCalled();
    expect(authorization).not.toHaveBeenCalled();
  });

  test("anything but a boolean is refused, naming the key, before anything is read", async () => {
    for (const value of ["true", "false", 1, 0, {}, [], "yes"]) {
      const error: unknown = await rejection(
        validate({ acknowledgeAlerts: value }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "acknowledgeAlertsToLink must be true or false.",
      );
    }

    expect(acknowledgedStateLookup).not.toHaveBeenCalled();
    expect(authorization).not.toHaveBeenCalled();
  });

  test("the type is checked before the alert ids", async () => {
    const error: unknown = await rejection(
      validate({ acknowledgeAlerts: "true", alertIds: [] }),
    );

    expect((error as BadDataException).message).toBe(
      `${INCIDENT_ACKNOWLEDGE_ALERTS_TO_LINK_KEY} must be true or false.`,
    );
  });

  test("true without alerts to link is refused, pointing at alertIdsToLink", async () => {
    const error: unknown = await rejection(validate({ alertIds: [] }));

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      "acknowledgeAlertsToLink only applies when the incident is declared from alerts: send the alert ids in alertIdsToLink.",
    );
    expect((error as BadDataException).message).toContain(
      INCIDENT_ALERT_IDS_TO_LINK_KEY,
    );
    expect(acknowledgedStateLookup).not.toHaveBeenCalled();
    expect(authorization).not.toHaveBeenCalled();
  });

  test("a missing project id is refused before anything is read", async () => {
    const error: unknown = await rejection(validate({ projectId: undefined }));

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      "projectId is required to acknowledge alerts.",
    );
    expect(acknowledgedStateLookup).not.toHaveBeenCalled();
    expect(authorization).not.toHaveBeenCalled();
  });

  test("a project without an Acknowledged alert state is refused, and permissions are not even probed", async () => {
    tables.alertStates = [ALERT_CREATED, ALERT_RESOLVED];

    const error: unknown = await rejection(validate());

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(
      NO_ACKNOWLEDGED_STATE_ON_CREATE_MESSAGE,
    );
    expect((error as BadDataException).message).toContain(
      "Declare the incident without acknowledging them",
    );
    expect(authorization).not.toHaveBeenCalled();
  });

  test("an Acknowledged state row without an id counts as no state", async () => {
    acknowledgedStateLookup.mockResolvedValueOnce(new AlertState() as never);

    const error: unknown = await rejection(validate());

    expect((error as BadDataException).message).toBe(
      NO_ACKNOWLEDGED_STATE_ON_CREATE_MESSAGE,
    );
    expect(authorization).not.toHaveBeenCalled();
  });

  test("the Acknowledged state is read as root, for the project, id only", async () => {
    await validate();

    expect(acknowledgedStateLookup).toHaveBeenCalledTimes(1);
    expect(acknowledgedStateLookup).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_ID,
        isAcknowledgedState: true,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });
  });

  test("a root caller gets the state id without a permission check", async () => {
    const stateId: ObjectID | null = await validate({
      props: { isRoot: true },
    });

    expect(stateId).toBeInstanceOf(ObjectID);
    expect(stateId!.toString()).toBe(ALERT_ACKNOWLEDGED.id);
    expect(authorization).not.toHaveBeenCalled();
  });

  test("a master admin gets the state id without a permission check", async () => {
    const stateId: ObjectID | null = await validate({
      props: { ...memberProps(), isMasterAdmin: true },
    });

    expect(stateId!.toString()).toBe(ALERT_ACKNOWLEDGED.id);
    expect(authorization).not.toHaveBeenCalled();
  });

  test("any other caller must be allowed to change the state of every one of the alerts", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();

    const stateId: ObjectID | null = await validate({ props: props });

    expect(authorization).toHaveBeenCalledTimes(1);
    expect(authorization).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertIds: ALERT_IDS,
      props: props,
    });
    expect((authorization.mock.calls[0]![0] as { props: unknown }).props).toBe(
      props,
    );
    expect(stateId).toBeInstanceOf(ObjectID);
    expect(stateId!.toString()).toBe(ALERT_ACKNOWLEDGED.id);
  });

  test("an API key (no user) is checked too", async () => {
    const props: DatabaseCommonInteractionProps = {
      tenantId: PROJECT_ID,
      userType: UserType.API,
    };

    await validate({ props: props });

    expect(authorization).toHaveBeenCalledTimes(1);
  });

  test("a caller who may not change one of the alerts gets a 400 that says what to do", async () => {
    authorization.mockRejectedValueOnce(
      new NotAuthorizedException(
        "You do not have permission to change the state of one or more of these alerts.",
      ) as never,
    );

    const error: unknown = await rejection(validate());

    expect(error).toBeInstanceOf(BadDataException);
    expect(error).not.toBeInstanceOf(NotAuthorizedException);
    expect((error as BadDataException).message).toBe(PERMISSION_MESSAGE);
  });

  test("a BadDataException from the permission check is answered the same way", async () => {
    authorization.mockRejectedValueOnce(
      new BadDataException("Some permission detail.") as never,
    );

    const error: unknown = await rejection(validate());

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as BadDataException).message).toBe(PERMISSION_MESSAGE);
  });

  test("a lapsed session, an unpaid project or a crash keeps its own answer", async () => {
    const errors: Array<Error> = [
      new NotAuthenticatedException("Session expired."),
      new PaymentRequiredException("Please upgrade your plan."),
      new Error("connection reset"),
    ];

    for (const thrown of errors) {
      authorization.mockRejectedValueOnce(thrown as never);

      const error: unknown = await rejection(validate());

      expect(error).toBe(thrown);
    }
  });

  test("a failing Acknowledged state read is not swallowed", async () => {
    const thrown: Error = new Error("database is down");
    acknowledgedStateLookup.mockRejectedValueOnce(thrown as never);

    await expect(validate()).rejects.toBe(thrown);
    expect(authorization).not.toHaveBeenCalled();
  });
});

describe("acknowledgeAlertsDeclaredWithIncident: what is written", () => {
  test("no alerts: nothing is read or written", async () => {
    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([]);

    expect(outcome(result)).toEqual(emptyOutcome());
    expect(acknowledgedStateLookup).not.toHaveBeenCalled();
    expect(incidentLookup).not.toHaveBeenCalled();
    expect(alertLookup).not.toHaveBeenCalled();
    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("a Created alert is acknowledged as the declaring user, owners told, the incident named", async () => {
    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(changeAlertState).toHaveBeenCalledTimes(1);
    expect(changeAlertState).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      alertId: new ObjectID(CREATED_ALERT),
      alertStateId: new ObjectID(ALERT_ACKNOWLEDGED.id),
      notifyOwners: true,
      rootCause:
        "Acknowledged because Incident INC-42 was declared from this alert.",
      stateChangeLog: undefined,
      createdByUserId: USER_ID,
      props: {
        isRoot: true,
      },
    });
    expect(changes[0]!.createdByUserId).toBe(USER_ID);
    expect(changes[0]!.projectId).toBe(PROJECT_ID);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT],
    });
    expect(tables.alerts.get(CREATED_ALERT)).toBe(ALERT_ACKNOWLEDGED.id);
    expect(errorLog).not.toHaveBeenCalled();
  });

  test("reads the Acknowledged state, the incident and the alerts as root", async () => {
    await acknowledge([CREATED_ALERT, SECOND_CREATED_ALERT]);

    expect(acknowledgedStateLookup).toHaveBeenCalledTimes(1);
    expect(acknowledgedStateLookup).toHaveBeenCalledWith({
      query: {
        projectId: PROJECT_ID,
        isAcknowledgedState: true,
      },
      select: {
        _id: true,
        order: true,
      },
      props: {
        isRoot: true,
      },
    });

    expect(incidentLookup).toHaveBeenCalledTimes(1);
    expect(incidentLookup).toHaveBeenCalledWith({
      id: INCIDENT_ID,
      select: {
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        isPrivate: true,
        currentIncidentStateId: true,
      },
      props: {
        isRoot: true,
      },
    });

    // One project-scoped read for every alert.
    expect(alertLookup).toHaveBeenCalledTimes(1);
    const query: { _id?: unknown; projectId?: unknown } = (
      alertLookup.mock.calls[0]![0] as {
        query: { _id?: unknown; projectId?: unknown };
      }
    ).query;
    expect(idsIn(query._id)).toEqual([CREATED_ALERT, SECOND_CREATED_ALERT]);
    expect(query.projectId).toBe(PROJECT_ID);
  });

  test("each alert is acknowledged once, however often (and in whatever case) it is listed, in first-seen order", async () => {
    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      CREATED_ALERT.toUpperCase(),
      SECOND_CREATED_ALERT,
      CREATED_ALERT,
      SECOND_CREATED_ALERT.toUpperCase(),
    ]);

    expect(moved()).toEqual([
      [CREATED_ALERT, "Acknowledged"],
      [SECOND_CREATED_ALERT, "Acknowledged"],
    ]);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT, SECOND_CREATED_ALERT],
    });
    expect(
      idsIn(
        (alertLookup.mock.calls[0]![0] as { query: { _id?: unknown } }).query
          ._id,
      ),
    ).toEqual([CREATED_ALERT, SECOND_CREATED_ALERT]);
  });

  test("#number when the project has no incident prefix", async () => {
    tables.incident!.incidentNumberWithPrefix = undefined;

    await acknowledge([CREATED_ALERT]);

    expect(changes[0]!.rootCause).toBe(
      "Acknowledged because Incident #42 was declared from this alert.",
    );
  });

  test("an API key declared it: the acknowledgement is credited to nobody", async () => {
    const result: AcknowledgeDeclaredAlertsResult = await acknowledge(
      [CREATED_ALERT],
      { actor: null },
    );

    expect(changeAlertState).toHaveBeenCalledTimes(1);
    expect(changes[0]!.createdByUserId).toBeUndefined();
    expect(changes[0]!.notifyOwners).toBe(true);
    expect(changes[0]!.props).toEqual({ isRoot: true });
    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
  });

  test("a private incident is never named in the alert's 'why'", async () => {
    tables.incident!.isPrivate = true;

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
    ]);

    expect(changes).toHaveLength(2);

    for (const change of changes) {
      expect(change.rootCause).toBe(PRIVATE_CAUSE);
      expect(change.rootCause).not.toContain("INC-42");
      expect(change.rootCause).not.toContain("42");
      expect(change.rootCause).not.toContain("Payroll");
      // Still credited to the user and still telling the owners.
      expect(change.createdByUserId).toBe(USER_ID);
      expect(change.notifyOwners).toBe(true);
    }

    expect(outcome(result).acknowledged).toEqual([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
    ]);
  });

  test("an incident that cannot be read back: acknowledged anyway, as 'Incident', and the sync is not consulted", async () => {
    tables.incident = null;
    setSwitches(true, true);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(changes[0]!.rootCause).toBe(
      "Acknowledged because Incident was declared from this alert.",
    );
    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
    expect(projectLookup).not.toHaveBeenCalled();
  });

  test("alerts already acknowledged, in a later custom state or resolved are left as they are", async () => {
    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      ACKNOWLEDGED_ALERT,
      INVESTIGATING_ALERT,
      RESOLVED_ALERT,
      CREATED_ALERT,
    ]);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT],
      alreadyAcknowledged: [
        ACKNOWLEDGED_ALERT,
        INVESTIGATING_ALERT,
        RESOLVED_ALERT,
      ],
    });
    // Only the alert that was written is read back.
    expect(isAlertAcknowledged).toHaveBeenCalledTimes(1);
    expect(tables.alerts.get(RESOLVED_ALERT)).toBe(ALERT_RESOLVED.id);
    expect(tables.alerts.get(INVESTIGATING_ALERT)).toBe(ALERT_INVESTIGATING.id);
  });

  test("states are compared by order, not by flags: a custom state before Acknowledged is acknowledged", async () => {
    const triage: StateRow = {
      id: "0194c3a9-0000-4000-8000-0000000000d5",
      name: "Triage",
      order: 1,
    };
    // Acknowledged sits at order 5 here, after a custom "Triage".
    tables.alertStates = [
      ALERT_CREATED,
      triage,
      { ...ALERT_ACKNOWLEDGED, order: 5 },
      { ...ALERT_INVESTIGATING, order: 6 },
      { ...ALERT_RESOLVED, order: 7 },
    ];
    tables.alerts.set(CREATED_ALERT, triage.id);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      INVESTIGATING_ALERT,
    ]);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT],
      alreadyAcknowledged: [INVESTIGATING_ALERT],
    });
  });

  test("an alert that is not in this project is reported failed and never written; the rest go on", async () => {
    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      FOREIGN_ALERT,
      CREATED_ALERT,
    ]);

    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT],
      failed: [[FOREIGN_ALERT, NOT_FOUND_MESSAGE]],
    });
  });

  test("a project without an Acknowledged alert state: every alert failed, nothing else read or written", async () => {
    tables.alertStates = [ALERT_CREATED, ALERT_RESOLVED];

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
      CREATED_ALERT,
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      failed: [
        [CREATED_ALERT, NO_ACKNOWLEDGED_STATE_MESSAGE],
        [SECOND_CREATED_ALERT, NO_ACKNOWLEDGED_STATE_MESSAGE],
      ],
    });
    expect(incidentLookup).not.toHaveBeenCalled();
    expect(alertLookup).not.toHaveBeenCalled();
    expect(changeAlertState).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      `IncidentAlertService: ${NO_ACKNOWLEDGED_STATE_MESSAGE}`,
      {
        projectId: PROJECT_ID.toString(),
        incidentId: INCIDENT_ID.toString(),
      },
    );
  });

  test("an Acknowledged state without an order counts as no state", async () => {
    const orderless: AlertState = new AlertState();
    orderless._id = ALERT_ACKNOWLEDGED.id;
    acknowledgedStateLookup.mockResolvedValueOnce(orderless as never);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).failed).toEqual([
      [CREATED_ALERT, NO_ACKNOWLEDGED_STATE_MESSAGE],
    ]);
    expect(changeAlertState).not.toHaveBeenCalled();
  });
});

describe("acknowledgeAlertsDeclaredWithIncident: classifying by reading the alert back", () => {
  test("a write refused because somebody acknowledged the alert meanwhile counts as acknowledged", async () => {
    writeBehaviours.set(CREATED_ALERT, async (): Promise<void> => {
      // Somebody pressed Acknowledge first; this write is then refused.
      tables.alerts.set(CREATED_ALERT, ALERT_ACKNOWLEDGED.id);
      throw new BadDataException(
        "Alert state cannot be the same as the previous state.",
      );
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT],
    });
    expect(perAlertErrorLogs()).toHaveLength(0);
  });

  test("a write refused because somebody resolved the alert meanwhile counts as acknowledged too", async () => {
    writeBehaviours.set(CREATED_ALERT, async (): Promise<void> => {
      tables.alerts.set(CREATED_ALERT, ALERT_RESOLVED.id);
      throw new BadDataException(
        "Alert state cannot transition to Acknowledged from Resolved.",
      );
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
    expect(outcome(result).failed).toEqual([]);
  });

  test("a write that throws and leaves the alert where it was is failed with the error's message, and logged", async () => {
    writeBehaviours.set(CREATED_ALERT, async (): Promise<void> => {
      throw new Error("Could not acquire the alert's lock.");
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      failed: [[CREATED_ALERT, "Could not acquire the alert's lock."]],
    });
    expect(errorLog).toHaveBeenCalledWith(
      `IncidentAlertService could not acknowledge alert ${CREATED_ALERT} for the incident it was declared with: Could not acquire the alert's lock.`,
      {
        projectId: PROJECT_ID.toString(),
        incidentId: INCIDENT_ID.toString(),
        alertId: CREATED_ALERT,
      },
    );
  });

  test("a thrown non-Error is reported as its string", async () => {
    writeBehaviours.set(CREATED_ALERT, async (): Promise<void> => {
      throw "lock timeout";
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).failed).toEqual([[CREATED_ALERT, "lock timeout"]]);
  });

  test("a write that returns but leaves the alert unacknowledged is failed as 'did not change'", async () => {
    // changeAlertState returns early when the last timeline row already has the state.
    writeBehaviours.set(CREATED_ALERT, async (): Promise<void> => {
      // no-op
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(changeAlertState).toHaveBeenCalledTimes(1);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      failed: [[CREATED_ALERT, DID_NOT_CHANGE_MESSAGE]],
    });
    expect(perAlertErrorLogs()).toHaveLength(1);
  });

  test("an alert that cannot be read back afterwards is failed, not assumed acknowledged", async () => {
    writeBehaviours.set(CREATED_ALERT, async (): Promise<void> => {
      // Deleted between the write and the read back.
      tables.alerts.delete(CREATED_ALERT);
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(isAlertAcknowledged).toHaveBeenCalledTimes(1);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      failed: [[CREATED_ALERT, DID_NOT_CHANGE_MESSAGE]],
    });
  });

  test("the read back is of the alert that was written", async () => {
    await acknowledge([CREATED_ALERT, SECOND_CREATED_ALERT]);

    expect(isAlertAcknowledged).toHaveBeenCalledTimes(2);
    expect(
      (isAlertAcknowledged.mock.calls[0]![0] as { alertId: ObjectID }).alertId
        .toString()
        .toLowerCase(),
    ).toBe(CREATED_ALERT);
    expect(
      (isAlertAcknowledged.mock.calls[1]![0] as { alertId: ObjectID }).alertId
        .toString()
        .toLowerCase(),
    ).toBe(SECOND_CREATED_ALERT);
  });

  test("one failing alert does not stop the others, and each keeps its place", async () => {
    writeBehaviours.set(SECOND_CREATED_ALERT, async (): Promise<void> => {
      throw new Error("deadlock detected");
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
      THIRD_CREATED_ALERT,
      ACKNOWLEDGED_ALERT,
    ]);

    expect(
      changes.map((change: StateChange) => {
        return change.alertId.toString();
      }),
    ).toEqual([CREATED_ALERT, SECOND_CREATED_ALERT, THIRD_CREATED_ALERT]);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT, THIRD_CREATED_ALERT],
      alreadyAcknowledged: [ACKNOWLEDGED_ALERT],
      failed: [[SECOND_CREATED_ALERT, "deadlock detected"]],
    });
    expect(perAlertErrorLogs()).toHaveLength(1);
  });

  test("the writes are one after another, never two at once", async () => {
    let inFlight: number = 0;
    let maxInFlight: number = 0;

    for (const alertId of [
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
      THIRD_CREATED_ALERT,
    ]) {
      writeBehaviours.set(
        alertId,
        async (change: StateChange): Promise<void> => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 1);
          });
          await writeThrough(change);
          inFlight--;
        },
      );
    }

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
      THIRD_CREATED_ALERT,
    ]);

    expect(maxInFlight).toBe(1);
    expect(outcome(result).acknowledged).toEqual([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
      THIRD_CREATED_ALERT,
    ]);
  });
});

describe("acknowledgeAlertsDeclaredWithIncident: never throws", () => {
  test("the Acknowledged state read failing: resolves with every alert failed with that message", async () => {
    acknowledgedStateLookup.mockRejectedValueOnce(
      new Error("connection reset") as never,
    );

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
      CREATED_ALERT.toUpperCase(),
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      failed: [
        [CREATED_ALERT, "connection reset"],
        [SECOND_CREATED_ALERT, "connection reset"],
      ],
    });
    expect(changeAlertState).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      "IncidentAlertService could not acknowledge the alerts an incident was declared from: Error: connection reset",
      {
        projectId: PROJECT_ID.toString(),
        incidentId: INCIDENT_ID.toString(),
      },
    );
  });

  test("the incident read failing: every alert failed, none written", async () => {
    incidentLookup.mockRejectedValueOnce(new Error("timeout") as never);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).failed).toEqual([[CREATED_ALERT, "timeout"]]);
    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("the alerts read failing: every alert failed, none written", async () => {
    alertLookup.mockRejectedValueOnce(new Error("too many clients") as never);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      ACKNOWLEDGED_ALERT,
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      failed: [
        [CREATED_ALERT, "too many clients"],
        [ACKNOWLEDGED_ALERT, "too many clients"],
      ],
    });
    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("the linked-alert sync lookup failing: every alert failed, none written", async () => {
    setSwitches(true, false);
    declaredInto(INCIDENT_ACKNOWLEDGED);
    projectLookup.mockRejectedValueOnce(
      new Error("project read failed") as never,
    );

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).failed).toEqual([
      [CREATED_ALERT, "project read failed"],
    ]);
    expect(changeAlertState).not.toHaveBeenCalled();
  });

  test("a failure part-way keeps what was settled and fails only the rest, each alert once", async () => {
    /*
     * Nothing inside the loop throws on its own (each write and each read
     * back is caught), so a logger that throws stands in for "anything else
     * going wrong" part-way through.
     */
    let thrown: boolean = false;
    errorLog.mockImplementation(((message: string): void => {
      if (
        !thrown &&
        message.startsWith("IncidentAlertService could not acknowledge alert ")
      ) {
        thrown = true;
        throw new Error("log sink down");
      }
    }) as never);

    writeBehaviours.set(SECOND_CREATED_ALERT, async (): Promise<void> => {
      throw new Error("deadlock detected");
    });

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      ACKNOWLEDGED_ALERT,
      SECOND_CREATED_ALERT,
      THIRD_CREATED_ALERT,
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT],
      alreadyAcknowledged: [ACKNOWLEDGED_ALERT],
      failed: [
        [SECOND_CREATED_ALERT, "deadlock detected"],
        [THIRD_CREATED_ALERT, "log sink down"],
      ],
    });
    // Writes were attempted for the first and second alerts only, never the third.
    expect(moved()).toEqual([
      [CREATED_ALERT, "Acknowledged"],
      [SECOND_CREATED_ALERT, "Acknowledged"],
    ]);
  });
});

describe("acknowledgeAlertsDeclaredWithIncident: one writer per alert with the linked-alert sync", () => {
  test("switches off (the default): nothing is left to the sync, even for an incident declared resolved", async () => {
    setSwitches(false, false);
    declaredInto(INCIDENT_RESOLVED);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT, SECOND_CREATED_ALERT],
    });
    expect(projectLookup).toHaveBeenCalledTimes(1);
    expect(incidentStateLookup).not.toHaveBeenCalled();
    expect(alertStatesLookup).not.toHaveBeenCalled();
  });

  test("switches on, incident declared in Created (the usual): the sync does nothing, so the alerts are acknowledged here", async () => {
    setSwitches(true, true);
    declaredInto(INCIDENT_CREATED);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
    ]);

    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT, SECOND_CREATED_ALERT],
    });
    expect(incidentStateLookup).toHaveBeenCalledTimes(1);
    // The incident's state calls for nothing, so alert states are not needed.
    expect(alertStatesLookup).not.toHaveBeenCalled();
  });

  test("acknowledge switch on, incident declared Acknowledged: linked Created alerts are left to the sync, unlinked ones acknowledged here", async () => {
    setSwitches(true, false);
    declaredInto(INCIDENT_ACKNOWLEDGED);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge(
      [CREATED_ALERT, SECOND_CREATED_ALERT, ACKNOWLEDGED_ALERT],
      // The second alert's link failed, so the sync never runs for it.
      { linkedAlertIds: [CREATED_ALERT, ACKNOWLEDGED_ALERT] },
    );

    expect(moved()).toEqual([[SECOND_CREATED_ALERT, "Acknowledged"]]);
    expect(changes[0]!.createdByUserId).toBe(USER_ID);
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [SECOND_CREATED_ALERT],
      alreadyAcknowledged: [ACKNOWLEDGED_ALERT],
      leftToSync: [CREATED_ALERT],
    });
    expect(tables.alerts.get(CREATED_ALERT)).toBe(ALERT_CREATED.id);
  });

  test("a custom incident state after Acknowledged counts as acknowledged for the sync", async () => {
    setSwitches(true, false);
    declaredInto(INCIDENT_MONITORING);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      leftToSync: [CREATED_ALERT],
    });
  });

  test("linked ids are matched whatever their case", async () => {
    setSwitches(true, false);
    declaredInto(INCIDENT_ACKNOWLEDGED);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge(
      [CREATED_ALERT],
      { linkedAlertIds: [CREATED_ALERT.toUpperCase()] },
    );

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(outcome(result).leftToSync).toEqual([CREATED_ALERT]);
  });

  test("no linked alerts at all: the sync is not consulted, every alert is acknowledged here", async () => {
    setSwitches(true, true);
    declaredInto(INCIDENT_ACKNOWLEDGED);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge(
      [CREATED_ALERT],
      { linkedAlertIds: [] },
    );

    expect(projectLookup).not.toHaveBeenCalled();
    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
  });

  test("acknowledge switch on but the incident is only Created: nothing left to the sync", async () => {
    setSwitches(true, false);
    declaredInto(INCIDENT_CREATED);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
    expect(outcome(result).leftToSync).toEqual([]);
  });

  test("resolve switch only, incident declared Acknowledged: the sync does nothing, so the alerts are acknowledged here", async () => {
    setSwitches(false, true);
    declaredInto(INCIDENT_ACKNOWLEDGED);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
    expect(outcome(result).leftToSync).toEqual([]);
  });

  test("resolve switch, incident declared Resolved: linked alerts before Resolved are left to the sync", async () => {
    setSwitches(false, true);
    declaredInto(INCIDENT_RESOLVED);
    link(CREATED_ALERT);
    link(INVESTIGATING_ALERT);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      INVESTIGATING_ALERT,
    ]);

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      // Already past Acknowledged: nothing to do here, whatever the sync does.
      alreadyAcknowledged: [INVESTIGATING_ALERT],
      leftToSync: [CREATED_ALERT],
    });
  });

  test("resolve switch only, alert held open by another open incident: the sync will not move it, so it is acknowledged here", async () => {
    setSwitches(false, true);
    declaredInto(INCIDENT_RESOLVED);
    tables.otherIncidents.set(
      OTHER_INCIDENT_ID.toString(),
      INCIDENT_ACKNOWLEDGED.id,
    );
    link(CREATED_ALERT);
    link(SECOND_CREATED_ALERT);
    link(CREATED_ALERT, OTHER_INCIDENT_ID);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
      SECOND_CREATED_ALERT,
    ]);

    expect(linkLookup).toHaveBeenCalled();
    expect(otherIncidentLookup).toHaveBeenCalled();
    expect(moved()).toEqual([[CREATED_ALERT, "Acknowledged"]]);
    expect(changes[0]!.rootCause).toBe(
      "Acknowledged because Incident INC-42 was declared from this alert.",
    );
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      acknowledged: [CREATED_ALERT],
      leftToSync: [SECOND_CREATED_ALERT],
    });
  });

  test("both switches on, alert held open by another open incident: the sync acknowledges it instead of resolving, so it is left to the sync", async () => {
    setSwitches(true, true);
    declaredInto(INCIDENT_RESOLVED);
    tables.otherIncidents.set(
      OTHER_INCIDENT_ID.toString(),
      INCIDENT_CREATED.id,
    );
    link(CREATED_ALERT);
    link(CREATED_ALERT, OTHER_INCIDENT_ID);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(outcome(result)).toEqual({
      ...emptyOutcome(),
      leftToSync: [CREATED_ALERT],
    });
  });

  test("resolve switch only, the other incident is itself resolved: nothing holds the alert, so it is left to the sync", async () => {
    setSwitches(false, true);
    declaredInto(INCIDENT_RESOLVED);
    tables.otherIncidents.set(
      OTHER_INCIDENT_ID.toString(),
      INCIDENT_RESOLVED.id,
    );
    link(CREATED_ALERT);
    link(CREATED_ALERT, OTHER_INCIDENT_ID);

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(changeAlertState).not.toHaveBeenCalled();
    expect(outcome(result).leftToSync).toEqual([CREATED_ALERT]);
  });

  test("the incident's state is not one of the project's: nothing is left to the sync", async () => {
    setSwitches(true, true);
    tables.incident!.stateId = "0194c3a9-0000-4000-8000-0000000000cf";

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
    expect(outcome(result).leftToSync).toEqual([]);
  });

  test("a linked alert whose state is unknown to the project is not assumed to be the sync's", async () => {
    setSwitches(true, false);
    declaredInto(INCIDENT_ACKNOWLEDGED);
    // A state the project's state list does not have.
    tables.alerts.set(CREATED_ALERT, "0194c3a9-0000-4000-8000-0000000000df");

    const result: AcknowledgeDeclaredAlertsResult = await acknowledge([
      CREATED_ALERT,
    ]);

    // Written here (its order is unknown, so it is not "already acknowledged").
    expect(changeAlertState).toHaveBeenCalledTimes(1);
    expect(outcome(result).leftToSync).toEqual([]);
    expect(outcome(result).acknowledged).toEqual([CREATED_ALERT]);
  });
});

describe("AlertService.changeAlertState", () => {
  const ALERT_ID: ObjectID = new ObjectID(CREATED_ALERT);
  const ACKNOWLEDGED_STATE_ID: ObjectID = new ObjectID(ALERT_ACKNOWLEDGED.id);

  let lastTimelineLookup: jest.SpyInstance;
  let timelineCreate: jest.SpyInstance;
  let lastTimeline: AlertStateTimeline | null;

  beforeEach(() => {
    // The service's own method, not the stub the other blocks use.
    changeAlertState.mockRestore();

    lastTimeline = new AlertStateTimeline();
    lastTimeline._id = "0194c3a9-0000-4000-8000-0000000000f1";
    lastTimeline.alertStateId = new ObjectID(ALERT_CREATED.id);

    lastTimelineLookup = jest
      .spyOn(AlertStateTimelineService, "findOneBy")
      .mockImplementation((async (): Promise<AlertStateTimeline | null> => {
        return lastTimeline;
      }) as never);

    timelineCreate = jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation((async (args: {
        data: AlertStateTimeline;
      }): Promise<AlertStateTimeline> => {
        return args.data;
      }) as never);
  });

  function createdRow(): AlertStateTimeline {
    expect(timelineCreate).toHaveBeenCalledTimes(1);
    return (timelineCreate.mock.calls[0]![0] as { data: AlertStateTimeline })
      .data;
  }

  test("credits the new timeline row to the user it is given", async () => {
    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: true,
      rootCause:
        "Acknowledged because Incident INC-42 was declared from this alert.",
      stateChangeLog: undefined,
      createdByUserId: USER_ID,
      props: { isRoot: true },
    });

    const row: AlertStateTimeline = createdRow();

    expect(row).toBeInstanceOf(AlertStateTimeline);
    expect(row.createdByUserId).toBe(USER_ID);
    expect(row.alertId).toBe(ALERT_ID);
    expect(row.alertStateId).toBe(ACKNOWLEDGED_STATE_ID);
    expect(row.projectId).toBe(PROJECT_ID);
    expect(row.rootCause).toBe(
      "Acknowledged because Incident INC-42 was declared from this alert.",
    );
    expect(row.isOwnerNotified).toBe(false);
    expect(
      (timelineCreate.mock.calls[0]![0] as { props: unknown }).props,
    ).toEqual({ isRoot: true });
  });

  test("leaves the row uncredited when no user is given (a system change)", async () => {
    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: false,
      rootCause:
        "Acknowledged because linked Incident INC-42 was acknowledged.",
      stateChangeLog: undefined,
      props: { isRoot: true },
    });

    expect(createdRow().createdByUserId).toBeUndefined();
  });

  test("an explicit undefined user leaves the row uncredited too", async () => {
    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: true,
      rootCause: undefined,
      stateChangeLog: undefined,
      createdByUserId: undefined,
      props: { isRoot: true },
    });

    const row: AlertStateTimeline = createdRow();
    expect(row.createdByUserId).toBeUndefined();
    expect(row.rootCause).toBeUndefined();
    expect(row.stateChangeLog).toBeUndefined();
  });

  test("isOwnerNotified is the opposite of notifyOwners", async () => {
    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: false,
      rootCause: undefined,
      stateChangeLog: undefined,
      createdByUserId: USER_ID,
      props: { isRoot: true },
    });

    expect(createdRow().isOwnerNotified).toBe(true);

    timelineCreate.mockClear();

    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: true,
      rootCause: undefined,
      stateChangeLog: undefined,
      createdByUserId: USER_ID,
      props: { isRoot: true },
    });

    expect(createdRow().isOwnerNotified).toBe(false);
  });

  test("keeps the state change log and passes empty props when given none", async () => {
    const log: JSONObject = { reason: "declared" };

    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: true,
      rootCause: undefined,
      stateChangeLog: log,
      createdByUserId: USER_ID,
      props: undefined,
    });

    expect(createdRow().stateChangeLog).toBe(log);
    expect(
      (timelineCreate.mock.calls[0]![0] as { props: unknown }).props,
    ).toEqual({});
  });

  test("reads the alert's latest timeline row, as root", async () => {
    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: true,
      rootCause: undefined,
      stateChangeLog: undefined,
      createdByUserId: USER_ID,
      props: { isRoot: true },
    });

    expect(lastTimelineLookup).toHaveBeenCalledTimes(1);
    expect(lastTimelineLookup).toHaveBeenCalledWith({
      query: {
        alertId: ALERT_ID,
        projectId: PROJECT_ID,
      },
      select: {
        _id: true,
        alertStateId: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      props: {
        isRoot: true,
      },
    });
  });

  test("still returns early, writing nothing, when the latest row already has the state", async () => {
    // A different ObjectID instance for the same id.
    lastTimeline!.alertStateId = new ObjectID(ALERT_ACKNOWLEDGED.id);

    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: true,
      rootCause:
        "Acknowledged because Incident INC-42 was declared from this alert.",
      stateChangeLog: undefined,
      createdByUserId: USER_ID,
      props: { isRoot: true },
    });

    expect(timelineCreate).not.toHaveBeenCalled();
  });

  test("an alert with no timeline yet gets its first row", async () => {
    lastTimeline = null;

    await AlertService.changeAlertState({
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
      alertStateId: ACKNOWLEDGED_STATE_ID,
      notifyOwners: true,
      rootCause: undefined,
      stateChangeLog: undefined,
      createdByUserId: USER_ID,
      props: { isRoot: true },
    });

    expect(createdRow().createdByUserId).toBe(USER_ID);
  });
});
