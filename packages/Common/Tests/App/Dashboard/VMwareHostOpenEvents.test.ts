import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Includes from "../../../Types/BaseDatabase/Includes";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";

/*
 * What is open on one ESXi host (Components/VMware/Host/
 * VMwareHostOpenEvents): a VMware monitor's incident or alert links to the
 * vCenter, and only its series labels say which host crossed the line - so
 * the host's page reads the vCenter's unresolved records and keeps the ones
 * whose labels name the host. Pinned: the scoping of the reads, the label
 * match, the order, and that a kind the role may not read leaves the other.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const VCENTER_ID: ObjectID = new ObjectID(
  "31000000-0000-4000-8000-000000000001",
);
const HOST: string = "esx01.acme.example";
const NOW: number = Date.parse("2026-10-21T12:00:00.000Z");

const UNRESOLVED_INCIDENT_STATE_ID: string =
  "50000000-0000-4000-8000-000000000001";
const UNRESOLVED_ALERT_STATE_ID: string =
  "51000000-0000-4000-8000-000000000001";

interface ListCall {
  modelName: string;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
}

const listCalls: Array<ListCall> = [];
let incidents: Array<Incident> = [];
let alerts: Array<Alert> = [];
let failIncidents: boolean = false;
let failAlerts: boolean = false;
let noUnresolvedStates: boolean = false;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (request: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        limit: number;
      }): Promise<unknown> => {
        const modelName: string =
          new request.modelType().tableName || "unknown";
        listCalls.push({
          modelName,
          query: request.query,
          select: request.select,
          limit: request.limit,
        });
        if (modelName === "Incident") {
          return failIncidents
            ? Promise.reject(new Error("No access to incidents."))
            : Promise.resolve({ data: incidents, count: incidents.length });
        }
        if (modelName === "Alert") {
          return failAlerts
            ? Promise.reject(new Error("No access to alerts."))
            : Promise.resolve({ data: alerts, count: alerts.length });
        }
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (): Promise<Array<unknown>> => {
          return Promise.resolve(
            noUnresolvedStates
              ? []
              : [
                  {
                    id: {
                      toString: () => {
                        return UNRESOLVED_INCIDENT_STATE_ID;
                      },
                    },
                  },
                ],
          );
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (): Promise<Array<unknown>> => {
        return Promise.resolve(
          noUnresolvedStates
            ? []
            : [
                {
                  id: {
                    toString: () => {
                      return UNRESOLVED_ALERT_STATE_ID;
                    },
                  },
                },
              ],
        );
      },
    },
  };
});

import {
  VMWARE_HOST_OPEN_EVENTS_READ_LIMIT,
  VMwareHostOpenEvent,
  VMwareHostOpenEventKind,
  VMwareHostOpenEvents,
  loadVMwareHostOpenEvents,
  sortVMwareHostOpenEvents,
  toVMwareHostOpenAlert,
  toVMwareHostOpenIncident,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VMware/Host/VMwareHostOpenEvents";

function incident(
  number: number,
  minutesAgo: number,
  hostLabel: string | undefined,
  fields: Partial<Record<keyof Incident, unknown>> = {},
): Incident {
  const model: Incident = new Incident();
  Object.assign(model, {
    _id: `60000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    title: `Incident ${number}`,
    incidentNumber: number,
    declaredAt: new Date(NOW - minutesAgo * 60000),
    createdAt: new Date(NOW - minutesAgo * 60000),
    seriesLabels:
      hostLabel === undefined
        ? undefined
        : { "resource.vcenter.host.name": hostLabel },
    incidentSeverity: Object.assign(new IncidentSeverity(), {
      name: "Critical",
      color: new Color("#ef4444"),
    }),
    currentIncidentState: Object.assign(new IncidentState(), {
      name: "Identified",
    }),
    ...fields,
  });
  return model;
}

function alert(
  number: number,
  minutesAgo: number,
  hostLabel: string | undefined,
  fields: Partial<Record<keyof Alert, unknown>> = {},
): Alert {
  const model: Alert = new Alert();
  Object.assign(model, {
    _id: `61000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    title: `Alert ${number}`,
    alertNumber: number,
    createdAt: new Date(NOW - minutesAgo * 60000),
    seriesLabels:
      hostLabel === undefined
        ? undefined
        : { "resource.vcenter.host.name": hostLabel },
    alertSeverity: Object.assign(new AlertSeverity(), {
      name: "Warning",
      color: new Color("#f59e0b"),
    }),
    currentAlertState: Object.assign(new AlertState(), { name: "Created" }),
    ...fields,
  });
  return model;
}

function titles(events: Array<VMwareHostOpenEvent> | null): Array<string> {
  return (events || []).map((event: VMwareHostOpenEvent): string => {
    return event.title;
  });
}

beforeEach(() => {
  listCalls.length = 0;
  incidents = [];
  alerts = [];
  failIncidents = false;
  failAlerts = false;
  noUnresolvedStates = false;
});

describe("what is open on this host", () => {
  test("the vCenter's unresolved records whose labels name the host", async () => {
    incidents = [
      incident(1, 10, HOST),
      incident(2, 12, "esx02.acme.example"),
      incident(3, 14, undefined),
      incident(4, 16, " ESX01.Acme.Example "),
    ];
    alerts = [alert(1, 4, HOST), alert(2, 5, "esx02.acme.example")];

    const open: VMwareHostOpenEvents = await loadVMwareHostOpenEvents({
      projectId: PROJECT_ID,
      vcenterId: VCENTER_ID,
      hostName: HOST,
    });

    expect(titles(open.incidents)).toEqual(["Incident 1", "Incident 4"]);
    expect(titles(open.alerts)).toEqual(["Alert 1"]);
  });

  test("each read is scoped to this vCenter and its unresolved states, newest first", async () => {
    await loadVMwareHostOpenEvents({
      projectId: PROJECT_ID,
      vcenterId: VCENTER_ID,
      hostName: HOST,
    });

    const incidentCall: ListCall = listCalls.find((call: ListCall): boolean => {
      return call.modelName === "Incident";
    })!;
    expect(incidentCall.query["projectId"]).toEqual(PROJECT_ID);
    expect(incidentCall.query["vmwareVCenters"]).toBeInstanceOf(Includes);
    expect(
      (incidentCall.query["vmwareVCenters"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([VCENTER_ID.toString()]);
    expect(
      (incidentCall.query["currentIncidentStateId"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([UNRESOLVED_INCIDENT_STATE_ID]);
    expect(incidentCall.select).toMatchObject({
      title: true,
      seriesLabels: true,
      incidentSeverity: { name: true, color: true },
      currentIncidentState: { name: true },
    });
    expect(incidentCall.limit).toBe(VMWARE_HOST_OPEN_EVENTS_READ_LIMIT);

    const alertCall: ListCall = listCalls.find((call: ListCall): boolean => {
      return call.modelName === "Alert";
    })!;
    expect(
      (alertCall.query["currentAlertStateId"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([UNRESOLVED_ALERT_STATE_ID]);
    expect(alertCall.select).toMatchObject({
      seriesLabels: true,
      alertSeverity: { name: true, color: true },
      currentAlertState: { name: true },
    });
  });

  test("a project with no unresolved states asks nothing and finds nothing", async () => {
    noUnresolvedStates = true;

    const open: VMwareHostOpenEvents = await loadVMwareHostOpenEvents({
      projectId: PROJECT_ID,
      vcenterId: VCENTER_ID,
      hostName: HOST,
    });

    expect(open).toEqual({ incidents: [], alerts: [] });
    expect(listCalls).toEqual([]);
  });

  test("a kind the role may not read is left out; the other still shows", async () => {
    failIncidents = true;
    alerts = [alert(1, 4, HOST)];

    const open: VMwareHostOpenEvents = await loadVMwareHostOpenEvents({
      projectId: PROJECT_ID,
      vcenterId: VCENTER_ID,
      hostName: HOST,
    });

    expect(open.incidents).toBeNull();
    expect(titles(open.alerts)).toEqual(["Alert 1"]);

    failAlerts = true;
    const neither: VMwareHostOpenEvents = await loadVMwareHostOpenEvents({
      projectId: PROJECT_ID,
      vcenterId: VCENTER_ID,
      hostName: HOST,
    });
    expect(neither).toEqual({ incidents: null, alerts: null });
  });
});

describe("one open record, as the card shows it", () => {
  test("an incident: its number, severity, state and when it was declared", () => {
    const event: VMwareHostOpenEvent | null = toVMwareHostOpenIncident(
      incident(12, 7, HOST),
    );
    expect(event).toEqual({
      kind: VMwareHostOpenEventKind.Incident,
      id: new ObjectID("60000000-0000-4000-8000-000000000012"),
      title: "Incident 12",
      number: "#12",
      severityName: "Critical",
      severityColor: new Color("#ef4444"),
      stateName: "Identified",
      createdAt: new Date(NOW - 7 * 60000),
    });
  });

  test("the project's own number prefix wins over #N", () => {
    expect(
      toVMwareHostOpenIncident(
        incident(12, 7, HOST, { incidentNumberWithPrefix: "INC-12" }),
      )?.number,
    ).toBe("INC-12");
    expect(
      toVMwareHostOpenAlert(
        alert(3, 1, HOST, { alertNumberWithPrefix: "ALT-3" }),
      )?.number,
    ).toBe("ALT-3");
  });

  test("an alert: the same, from its own fields", () => {
    const event: VMwareHostOpenEvent | null = toVMwareHostOpenAlert(
      alert(3, 1, HOST),
    );
    expect(event?.kind).toBe(VMwareHostOpenEventKind.Alert);
    expect(event?.number).toBe("#3");
    expect(event?.severityName).toBe("Warning");
    expect(event?.stateName).toBe("Created");
  });

  test("missing pieces read as empty, and a record without an id is skipped", () => {
    const bare: Incident = new Incident();
    bare._id = "60000000-0000-4000-8000-000000000099";
    expect(toVMwareHostOpenIncident(bare)).toEqual({
      kind: VMwareHostOpenEventKind.Incident,
      id: new ObjectID("60000000-0000-4000-8000-000000000099"),
      title: "",
      number: "",
      severityName: "",
      severityColor: null,
      stateName: "",
      createdAt: null,
    });
    expect(toVMwareHostOpenIncident(new Incident())).toBeNull();
    expect(toVMwareHostOpenAlert(new Alert())).toBeNull();
  });

  test("a colour stored as JSON or as a plain string is read too", () => {
    expect(
      toVMwareHostOpenAlert(
        alert(4, 1, HOST, {
          alertSeverity: Object.assign(new AlertSeverity(), {
            name: "Minor",
            color: { _type: "Color", value: "#10b981" },
          }),
        }),
      )?.severityColor?.toString(),
    ).toBe("#10b981");
    expect(
      toVMwareHostOpenAlert(
        alert(5, 1, HOST, {
          alertSeverity: Object.assign(new AlertSeverity(), {
            name: "Minor",
            color: "#6366f1",
          }),
        }),
      )?.severityColor?.toString(),
    ).toBe("#6366f1");
  });
});

describe("the order of what is open", () => {
  test("newest first, incidents and alerts together; a tie by title; no date last", () => {
    const events: Array<VMwareHostOpenEvent> = [
      toVMwareHostOpenIncident(incident(1, 10, HOST))!,
      toVMwareHostOpenAlert(alert(1, 4, HOST))!,
      toVMwareHostOpenAlert(alert(2, 10, HOST, { title: "A tie" }))!,
      toVMwareHostOpenIncident(
        incident(2, 0, HOST, { declaredAt: undefined, createdAt: undefined }),
      )!,
    ];

    expect(titles(sortVMwareHostOpenEvents(events))).toEqual([
      "Alert 1",
      "A tie",
      "Incident 1",
      "Incident 2",
    ]);
    // The input is not reordered in place.
    expect(titles(events)).toEqual([
      "Incident 1",
      "Alert 1",
      "A tie",
      "Incident 2",
    ]);
  });
});
