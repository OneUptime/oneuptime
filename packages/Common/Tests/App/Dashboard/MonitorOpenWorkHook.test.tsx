/** @timezone UTC */

import { act, cleanup, renderHook } from "@testing-library/react";
import { MonitorOpenWork } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewTypes";
import useMonitorOpenWork, {
  MONITOR_OPEN_WORK_ACCESS_REASONS,
  MONITOR_OPEN_WORK_ROW_LIMIT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorOpenWork";
import useMonitorOwners, {
  MONITOR_OWNERS_ACCESS_REASON,
  MONITOR_OWNERS_PARTIAL_REASONS,
  UseMonitorOwnersResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorOwners";
import AlertStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/AlertState";
import IncidentStateUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * useMonitorOpenWork answers "what is on fire on this monitor": the
 * unresolved incidents and alerts. The rules pinned here are the ones that
 * keep that answer honest: a count is the server's total, never the rows
 * fetched; an unknown count (forbidden or failed) is never zero; incidents
 * and alerts are gated and fail separately; and the two models link to the
 * monitor differently (a `monitors` relation versus a `monitorId` column).
 *
 * useMonitorOwners is covered here too: once per monitor, again only on
 * `refreshToken`, "unavailable" rather than "no owners" on failure, and
 * each owner table gated and read on its own, so the half that can be read
 * is shown.
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "9a1f0c2e-5b3d-4c7a-8e1f-2d3c4b5a6978",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "4e5f6071-8293-4a4b-b5c6-d7e8f90a1b2c",
);
const INCIDENT_STATE_IDS: Array<string> = [
  "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
];
const ALERT_STATE_ID: string = "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1";

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface ListResultLike {
  data: Array<unknown>;
  count: number;
  skip: number;
  limit: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (promiseResolve: (value: T) => void): void => {
      resolve = promiseResolve;
    },
  );

  return { promise: promise, resolve: resolve };
}

/*
 * Rejections are made by an async function, so they are native promises.
 * The UI telemetry in the import graph loads zone.js, whose Promise reports
 * a rejection as unhandled when a native await subscribes to it a tick
 * later, which would fill the log with false alarms.
 */
async function rejectWith(error: unknown): Promise<never> {
  throw error;
}

function buildIncidentState(id: string): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = id;
  return state;
}

function buildAlertState(id: string): AlertState {
  const state: AlertState = new AlertState();
  state._id = id;
  return state;
}

function buildIncident(data: {
  id: string;
  title?: string;
  declaredAt?: Date;
  createdAt?: Date;
}): Incident {
  const incident: Incident = new Incident();
  incident._id = data.id;

  if (data.title) {
    incident.title = data.title;
  }

  if (data.declaredAt) {
    incident.declaredAt = data.declaredAt;
  }

  if (data.createdAt) {
    incident.createdAt = data.createdAt;
  }

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  severity.color = new Color("#dc2626");
  incident.incidentSeverity = severity;

  const state: IncidentState = new IncidentState();
  state.name = "Investigating";
  incident.currentIncidentState = state;

  return incident;
}

function buildAlert(data: { id: string; title: string }): Alert {
  const alert: Alert = new Alert();
  alert._id = data.id;
  alert.title = data.title;
  alert.createdAt = new Date("2026-09-21T11:00:00.000Z");

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";
  severity.color = new Color("#f59e0b");
  alert.alertSeverity = severity;

  const state: AlertState = new AlertState();
  state.name = "Created";
  alert.currentAlertState = state;

  return alert;
}

function listOf(data: Array<unknown>, count?: number): ListResultLike {
  return {
    data: data,
    count: count ?? data.length,
    skip: 0,
    limit: data.length,
  };
}

let permissions: Array<Permission>;
let getListSpy: jest.SpyInstance;
let incidentStatesSpy: jest.SpyInstance;
let alertStatesSpy: jest.SpyInstance;
let listResponses: Map<unknown, () => Promise<unknown>>;

function requestsFor(modelType: unknown): Array<ListRequest> {
  return getListSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest) => {
      return request.modelType === modelType;
    });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 30; i++) {
      await Promise.resolve();
    }
  });
}

type HookProps = { monitorId: ObjectID; refreshToken: number };

function renderOpenWork(props?: Partial<HookProps>): {
  result: { current: MonitorOpenWork };
  rerender: (props: HookProps) => void;
} {
  return renderHook(
    (hookProps: HookProps): MonitorOpenWork => {
      return useMonitorOpenWork(hookProps);
    },
    {
      initialProps: {
        monitorId: props?.monitorId || MONITOR_ID,
        refreshToken: props?.refreshToken ?? 0,
      },
    },
  );
}

function renderOwners(props?: Partial<HookProps>): {
  result: { current: UseMonitorOwnersResult };
  rerender: (props: HookProps) => void;
} {
  return renderHook(
    (hookProps: HookProps): UseMonitorOwnersResult => {
      return useMonitorOwners(hookProps);
    },
    {
      initialProps: {
        monitorId: props?.monitorId || MONITOR_ID,
        refreshToken: props?.refreshToken ?? 0,
      },
    },
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(NOW);
  permissions = [Permission.ProjectOwner];

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });

  incidentStatesSpy = jest.spyOn(
    IncidentStateUtil,
    "getUnresolvedIncidentStates",
  );
  incidentStatesSpy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(INCIDENT_STATE_IDS.map(buildIncidentState));
  });

  alertStatesSpy = jest.spyOn(AlertStateUtil, "getUnresolvedAlertStates");
  alertStatesSpy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve([buildAlertState(ALERT_STATE_ID)]);
  });

  listResponses = new Map<unknown, () => Promise<unknown>>();
  listResponses.set(Incident, () => {
    return Promise.resolve(
      listOf(
        [
          buildIncident({
            id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
            title: "Checkout is down",
            declaredAt: new Date("2026-09-21T10:00:00.000Z"),
            createdAt: new Date("2026-09-21T10:05:00.000Z"),
          }),
          buildIncident({
            id: "c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2",
            createdAt: new Date("2026-09-21T09:00:00.000Z"),
          }),
        ],
        12,
      ),
    );
  });
  listResponses.set(Alert, () => {
    return Promise.resolve(
      listOf([
        buildAlert({
          id: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
          title: "Latency is high",
        }),
      ]),
    );
  });

  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: ListRequest = args[0] as ListRequest;
    const respond: (() => Promise<unknown>) | undefined = listResponses.get(
      request.modelType,
    );

    return respond ? respond() : Promise.resolve(listOf([]));
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("useMonitorOpenWork", () => {
  test("unresolved state ids feed Includes, scoped to this monitor's incidents", async () => {
    renderOpenWork();
    await flush();

    expect(incidentStatesSpy).toHaveBeenCalledWith(PROJECT_ID);
    expect(requestsFor(Incident)).toHaveLength(1);

    const request: ListRequest = requestsFor(Incident)[0]!;
    expect(request.query["projectId"]).toBe(PROJECT_ID);
    expect((request.query["monitors"] as Includes).values).toEqual([
      MONITOR_ID,
    ]);
    expect(
      (request.query["currentIncidentStateId"] as Includes).values.map(
        (id: unknown) => {
          return String(id);
        },
      ),
    ).toEqual(INCIDENT_STATE_IDS);
    expect(request.limit).toBe(MONITOR_OPEN_WORK_ROW_LIMIT);
    expect(MONITOR_OPEN_WORK_ROW_LIMIT).toBe(5);
    expect(request.sort).toEqual({ declaredAt: SortOrder.Descending });
    // The sort column is selected (paginated relation join).
    expect(request.select["declaredAt"]).toBe(true);
  });

  test("Alert uses monitorId, not monitors", async () => {
    renderOpenWork();
    await flush();

    expect(alertStatesSpy).toHaveBeenCalledWith(PROJECT_ID);

    const request: ListRequest = requestsFor(Alert)[0]!;
    expect(request.query["monitorId"]).toBe(MONITOR_ID);
    expect(request.query).not.toHaveProperty("monitors");
    expect(
      (request.query["currentAlertStateId"] as Includes).values.map(
        (id: unknown) => {
          return String(id);
        },
      ),
    ).toEqual([ALERT_STATE_ID]);
    expect(request.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(request.select["createdAt"]).toBe(true);
    expect(request.limit).toBe(MONITOR_OPEN_WORK_ROW_LIMIT);
  });

  test("count is the tile number: the server's total, not the rows fetched", async () => {
    const { result } = renderOpenWork();
    await flush();

    expect(result.current.incidents.status).toBe("loaded");
    expect(result.current.incidents.value!.count).toBe(12);
    expect(result.current.incidents.value!.rows).toHaveLength(2);
    expect(result.current.alerts.value!.count).toBe(1);
  });

  test("rows carry what the card shows, with declaredAt preferred over createdAt", async () => {
    const { result } = renderOpenWork();
    await flush();

    const [first, second] = result.current.incidents.value!.rows;

    expect(first).toEqual({
      key: "incident-c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
      kind: "Incident",
      id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1",
      title: "Checkout is down",
      startedAt: new Date("2026-09-21T10:00:00.000Z"),
      severityName: "Critical",
      severityColor: "#dc2626",
      stateName: "Investigating",
    });
    // No declaredAt: created is the fallback; no title: a readable one.
    expect(second!.startedAt).toEqual(new Date("2026-09-21T09:00:00.000Z"));
    expect(second!.title).toBe("Untitled incident");

    expect(result.current.alerts.value!.rows[0]).toEqual({
      key: "alert-d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
      kind: "Alert",
      id: "d1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1",
      title: "Latency is high",
      startedAt: new Date("2026-09-21T11:00:00.000Z"),
      severityName: "Warning",
      severityColor: "#f59e0b",
      stateName: "Created",
    });
  });

  test("an empty state list sends no request and is a known zero", async () => {
    incidentStatesSpy.mockImplementation((): Promise<unknown> => {
      return Promise.resolve([]);
    });

    const { result } = renderOpenWork();
    await flush();

    expect(requestsFor(Incident)).toHaveLength(0);
    expect(result.current.incidents.status).toBe("loaded");
    expect(result.current.incidents.value).toEqual({ count: 0, rows: [] });
    // The other side is unaffected.
    expect(requestsFor(Alert)).toHaveLength(1);
  });

  test("sides gated separately: incident access only", async () => {
    permissions = [Permission.IncidentViewer];

    const { result } = renderOpenWork();
    await flush();

    expect(requestsFor(Incident)).toHaveLength(1);
    expect(requestsFor(Alert)).toHaveLength(0);
    expect(alertStatesSpy).not.toHaveBeenCalled();
    expect(result.current.incidents.status).toBe("loaded");
    expect(result.current.alerts.status).toBe("forbidden");
    expect(result.current.alerts.value).toBeNull();
    expect(result.current.alerts.error).toBe(
      MONITOR_OPEN_WORK_ACCESS_REASONS.alerts,
    );
  });

  test("sides gated separately: alert access only", async () => {
    permissions = [Permission.AlertViewer];

    const { result } = renderOpenWork();
    await flush();

    expect(requestsFor(Incident)).toHaveLength(0);
    expect(incidentStatesSpy).not.toHaveBeenCalled();
    expect(requestsFor(Alert)).toHaveLength(1);
    expect(result.current.incidents.status).toBe("forbidden");
    expect(result.current.incidents.error).toBe(
      MONITOR_OPEN_WORK_ACCESS_REASONS.incidents,
    );
    expect(result.current.alerts.status).toBe("loaded");
  });

  test("a MonitorViewer can read neither: both unknown, never zero", async () => {
    permissions = [Permission.MonitorViewer];

    const { result } = renderOpenWork();
    await flush();

    expect(getListSpy).not.toHaveBeenCalled();
    expect(result.current.incidents.status).toBe("forbidden");
    expect(result.current.alerts.status).toBe("forbidden");
    expect(result.current.incidents.value).toBeNull();
    expect(result.current.alerts.value).toBeNull();
  });

  test("an empty permission snapshot still asks", async () => {
    permissions = [];

    renderOpenWork();
    await flush();

    expect(requestsFor(Incident)).toHaveLength(1);
    expect(requestsFor(Alert)).toHaveLength(1);
  });

  test("one side failing does not hide the other", async () => {
    listResponses.set(Incident, () => {
      return rejectWith(new Error("Incidents are unavailable."));
    });
    alertStatesSpy.mockImplementation((): Promise<unknown> => {
      return Promise.resolve([buildAlertState(ALERT_STATE_ID)]);
    });

    const { result } = renderOpenWork();
    await flush();

    expect(result.current.incidents.status).toBe("error");
    expect(result.current.incidents.value).toBeNull();
    expect(result.current.incidents.error).toBe("Incidents are unavailable.");
    expect(result.current.alerts.status).toBe("loaded");
  });

  test("a failed state lookup is an error for that side", async () => {
    alertStatesSpy.mockImplementation((): Promise<unknown> => {
      return rejectWith(new Error("States are unavailable."));
    });

    const { result } = renderOpenWork();
    await flush();

    expect(requestsFor(Alert)).toHaveLength(0);
    expect(result.current.alerts.status).toBe("error");
    expect(result.current.alerts.error).toBe("States are unavailable.");
    expect(result.current.incidents.status).toBe("loaded");
  });

  test("reloads on refreshToken only, and a failed reload keeps the last counts", async () => {
    const { result, rerender } = renderOpenWork({ refreshToken: 1 });
    await flush();

    rerender({ monitorId: MONITOR_ID, refreshToken: 1 });
    await flush();
    expect(requestsFor(Incident)).toHaveLength(1);

    listResponses.set(Incident, () => {
      return rejectWith(new Error("Network error."));
    });
    rerender({ monitorId: MONITOR_ID, refreshToken: 2 });
    await flush();

    expect(requestsFor(Incident)).toHaveLength(2);
    expect(result.current.incidents.status).toBe("loaded");
    expect(result.current.incidents.value!.count).toBe(12);
    expect(result.current.incidents.refreshError).toBe("Network error.");
  });

  test("a result for another id is ignored", async () => {
    const slowA: Deferred<unknown> = createDeferred<unknown>();
    listResponses.set(Incident, () => {
      return slowA.promise;
    });

    const { result, rerender } = renderOpenWork({ monitorId: MONITOR_ID });
    await flush();

    listResponses.set(Incident, () => {
      return Promise.resolve(listOf([], 0));
    });
    rerender({ monitorId: OTHER_MONITOR_ID, refreshToken: 0 });

    expect(result.current.incidents.status).toBe("loading");
    expect(result.current.alerts.status).toBe("loading");

    await flush();

    expect(result.current.incidents.value!.count).toBe(0);

    await act(async () => {
      slowA.resolve(
        listOf(
          [buildIncident({ id: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1" })],
          9,
        ),
      );
    });
    await flush();

    expect(result.current.incidents.loadedFor).toBe(
      OTHER_MONITOR_ID.toString(),
    );
    expect(result.current.incidents.value!.count).toBe(0);
  });
});

describe("useMonitorOwners", () => {
  beforeEach(() => {
    const ownerUser: MonitorOwnerUser = new MonitorOwnerUser();
    ownerUser.user = new User();
    ownerUser.user._id = "e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1";

    const orphanUser: MonitorOwnerUser = new MonitorOwnerUser();

    const ownerTeam: MonitorOwnerTeam = new MonitorOwnerTeam();
    ownerTeam.team = new Team();
    ownerTeam.team._id = "f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1";
    ownerTeam.team.name = "Payments";

    listResponses.set(MonitorOwnerUser, () => {
      return Promise.resolve(listOf([ownerUser, orphanUser]));
    });
    listResponses.set(MonitorOwnerTeam, () => {
      return Promise.resolve(listOf([ownerTeam]));
    });
  });

  test("loads users then teams, scoped to the monitor, oldest owner first", async () => {
    const { result } = renderOwners();

    expect(result.current.owners.status).toBe("loading");

    await flush();

    expect(result.current.owners.status).toBe("loaded");
    expect(
      result.current.owners.value!.map((entry: { kind: "user" | "team" }) => {
        return entry.kind;
      }),
    ).toEqual(["user", "team"]);

    for (const modelType of [MonitorOwnerUser, MonitorOwnerTeam]) {
      const request: ListRequest = requestsFor(modelType)[0]!;
      expect(request.query).toEqual({
        monitorId: MONITOR_ID,
        projectId: PROJECT_ID,
      });
      expect(request.sort).toEqual({ createdAt: SortOrder.Ascending });
      expect(request.select["createdAt"]).toBe(true);
      expect(request.limit).toBe(LIMIT_PER_PROJECT);
    }

    expect(requestsFor(MonitorOwnerUser)[0]!.select["user"]).toEqual({
      _id: true,
      name: true,
      email: true,
      profilePictureId: true,
    });
    expect(requestsFor(MonitorOwnerTeam)[0]!.select["team"]).toEqual({
      _id: true,
      name: true,
    });
  });

  test("a definite denial is forbidden, and nothing is requested", async () => {
    permissions = [Permission.ReadProjectMonitor];

    const { result } = renderOwners();
    await flush();

    expect(getListSpy).not.toHaveBeenCalled();
    expect(result.current.owners.status).toBe("forbidden");
    expect(result.current.owners.value).toBeNull();
    expect(result.current.owners.error).toBe(MONITOR_OWNERS_ACCESS_REASON);
  });

  test("a failed half shows the owners the other half names, and records the failure", async () => {
    listResponses.set(MonitorOwnerTeam, () => {
      return rejectWith(new Error("Teams are unavailable."));
    });

    const { result } = renderOwners();
    await flush();

    expect(result.current.owners.status).toBe("loaded");
    expect(
      result.current.owners.value!.map((entry: { kind: "user" | "team" }) => {
        return entry.kind;
      }),
    ).toEqual(["user"]);
    expect(result.current.owners.refreshError).toBe("Teams are unavailable.");
  });

  test("an empty half next to an unreadable one is unknown, never 'no owners'", async () => {
    listResponses.set(MonitorOwnerUser, () => {
      return Promise.resolve(listOf([]));
    });
    listResponses.set(MonitorOwnerTeam, () => {
      return rejectWith(new Error("Teams are unavailable."));
    });

    const { result } = renderOwners();
    await flush();

    expect(result.current.owners.status).toBe("error");
    expect(result.current.owners.value).toBeNull();
    expect(result.current.owners.error).toBe("Teams are unavailable.");
  });

  test("both halves failing is an error with no owners", async () => {
    listResponses.set(MonitorOwnerUser, () => {
      return rejectWith(new Error("Users are unavailable."));
    });
    listResponses.set(MonitorOwnerTeam, () => {
      return rejectWith(new Error("Teams are unavailable."));
    });

    const { result } = renderOwners();
    await flush();

    expect(result.current.owners.status).toBe("error");
    expect(result.current.owners.value).toBeNull();
    expect(result.current.owners.error).toBe("Users are unavailable.");
  });

  test("a half that fails on Refresh keeps the last complete answer", async () => {
    const { result, rerender } = renderOwners({ refreshToken: 0 });
    await flush();

    expect(result.current.owners.value).toHaveLength(2);

    listResponses.set(MonitorOwnerTeam, () => {
      return rejectWith(new Error("Teams are unavailable."));
    });
    rerender({ monitorId: MONITOR_ID, refreshToken: 1 });
    await flush();

    // Dropping the team for a transient failure would say it is no owner.
    expect(result.current.owners.status).toBe("loaded");
    expect(
      result.current.owners.value!.map((entry: { kind: "user" | "team" }) => {
        return entry.kind;
      }),
    ).toEqual(["user", "team"]);
    expect(result.current.owners.refreshError).toBe("Teams are unavailable.");
  });

  test("each list is gated on its own permission: owner users only", async () => {
    permissions = [
      Permission.ReadProjectMonitor,
      Permission.ReadMonitorOwnerUser,
    ];

    const { result } = renderOwners();
    await flush();

    expect(requestsFor(MonitorOwnerUser)).toHaveLength(1);
    expect(requestsFor(MonitorOwnerTeam)).toHaveLength(0);
    expect(result.current.owners.status).toBe("loaded");
    expect(
      result.current.owners.value!.map((entry: { kind: "user" | "team" }) => {
        return entry.kind;
      }),
    ).toEqual(["user"]);
    expect(result.current.owners.refreshError).toBe(
      MONITOR_OWNERS_PARTIAL_REASONS.teams,
    );
  });

  test("each list is gated on its own permission: owner teams only", async () => {
    permissions = [
      Permission.ReadProjectMonitor,
      Permission.ReadMonitorOwnerTeam,
    ];

    const { result } = renderOwners();
    await flush();

    expect(requestsFor(MonitorOwnerUser)).toHaveLength(0);
    expect(requestsFor(MonitorOwnerTeam)).toHaveLength(1);
    expect(result.current.owners.status).toBe("loaded");
    expect(
      result.current.owners.value!.map((entry: { kind: "user" | "team" }) => {
        return entry.kind;
      }),
    ).toEqual(["team"]);
    expect(result.current.owners.refreshError).toBe(
      MONITOR_OWNERS_PARTIAL_REASONS.users,
    );
  });

  test("a readable half that names nobody, next to a forbidden one, is not 'no owners'", async () => {
    permissions = [
      Permission.ReadProjectMonitor,
      Permission.ReadMonitorOwnerUser,
    ];
    listResponses.set(MonitorOwnerUser, () => {
      return Promise.resolve(listOf([]));
    });

    const { result } = renderOwners();
    await flush();

    expect(result.current.owners.status).toBe("forbidden");
    expect(result.current.owners.value).toBeNull();
    expect(result.current.owners.error).toBe(
      MONITOR_OWNERS_PARTIAL_REASONS.teams,
    );
  });

  test("loads once per monitor, again only when refreshToken changes", async () => {
    const { rerender } = renderOwners({ refreshToken: 0 });
    await flush();

    rerender({ monitorId: MONITOR_ID, refreshToken: 0 });
    await flush();
    expect(requestsFor(MonitorOwnerUser)).toHaveLength(1);

    rerender({ monitorId: MONITOR_ID, refreshToken: 1 });
    await flush();
    expect(requestsFor(MonitorOwnerUser)).toHaveLength(2);

    rerender({ monitorId: OTHER_MONITOR_ID, refreshToken: 1 });
    await flush();
    expect(requestsFor(MonitorOwnerUser)).toHaveLength(3);
    expect(requestsFor(MonitorOwnerUser)[2]!.query["monitorId"]).toBe(
      OTHER_MONITOR_ID,
    );
  });
});
