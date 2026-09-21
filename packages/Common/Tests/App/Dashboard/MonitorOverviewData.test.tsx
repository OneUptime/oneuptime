/** @timezone UTC */

import { act, cleanup, renderHook } from "@testing-library/react";
import useMonitorOverviewData, {
  MONITOR_OVERVIEW_ACCESS_REASONS,
  MONITOR_OVERVIEW_EVALUATION_RETRY_POLLS,
  MONITOR_OVERVIEW_HEAVY_PROBE_RELOAD_MS,
  MONITOR_OVERVIEW_NOT_FOUND_MESSAGE,
  MONITOR_OVERVIEW_PROBE_RESULTS_UNREADABLE_MESSAGE,
  MONITOR_OVERVIEW_REFRESH_INTERVAL_MS,
  UseMonitorOverviewDataResult,
  getSettledClaimCutoff,
  isEvaluationCaughtUp,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorOverviewData";
import {
  MONITOR_OVERVIEW_BASE_SELECT,
  MONITOR_OVERVIEW_PROBE_FULL_SELECT,
  MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
  MONITOR_OVERVIEW_STATUS_ROW_LIMIT,
  MONITOR_OVERVIEW_STATUS_ROW_SELECT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewSelect";
import MonitorLog from "../../../Models/AnalyticsModels/MonitorLog";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe, {
  MonitorStepProbeResponse,
} from "../../../Models/DatabaseModels/MonitorProbe";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * useMonitorOverviewData owns every read the monitor overview makes of the
 * monitor itself, and its one poll. The tests count requests, because that
 * is what the redesign changed:
 * - refresh-status fires once per monitor and is never awaited or polled;
 * - the Monitor row, the probe rows and the newest status rows start
 *   together, and only the Monitor row can fail the page;
 * - polls read probes without their (screenshot-heavy) results unless a
 *   probe has claimed a newer check, and synthetic results are capped;
 * - the evaluation log is re-read only when a new signal arrived;
 * - a slow or stale response never overwrites newer data or leaks one
 *   monitor's data onto another.
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
// Real UUIDs: ObjectID and ProjectUtil ignore values that are not.
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "9a1f0c2e-5b3d-4c7a-8e1f-2d3c4b5a6978",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "4e5f6071-8293-4a4b-b5c6-d7e8f90a1b2c",
);
const OPERATIONAL_ID: string = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
const OFFLINE_ID: string = "2c3d4e5f-6071-4829-93a4-b5c6d7e8f901";
const ROW_ONE_ID: string = "3d4e5f60-7182-493a-a4b5-c6d7e8f90a1b";
const ROW_TWO_ID: string = "5f607182-93a4-4b5c-86d7-e8f90a1b2c3d";
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROBE_A: string = "11111111-1111-4111-8111-111111111111";
const PROBE_B: string = "22222222-2222-4222-8222-222222222222";

const SECRET_KEY_COLUMNS: Array<string> = [
  "serverMonitorSecretKey",
  "incomingRequestSecretKey",
  "incomingEmailSecretKey",
];

const STEPS: MonitorSteps = {
  data: {
    monitorStepsInstanceArray: [{ data: { id: STEP_ID } }],
  },
} as unknown as MonitorSteps;

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface ItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

interface ApiGetRequest {
  url: URL;
  headers: Dictionary<string>;
}

interface ProbeSpec {
  probeId: string;
  isEnabled?: boolean;
  lastPingAt?: Date;
  nextPingAt?: Date;
  monitoredAt?: Date;
  connectionStatus?: ProbeConnectionStatus;
}

interface FakeServer {
  monitors: Dictionary<Monitor | null>;
  monitorError: Error | null;
  probes: Array<ProbeSpec>;
  probeError: Error | null;
  fullProbeError: Error | null;
  // A full probe read parked until the test releases it.
  heldFullProbeRead: Deferred<void> | null;
  statusRows: Array<MonitorStatusTimeline>;
  statusRowsError: Error | null;
  logs: Array<MonitorLog>;
  logError: Error | null;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};
  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ): void => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
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

function secondsFromNow(seconds: number): Date {
  return new Date(NOW.getTime() + seconds * 1000);
}

function buildStatus(statusId: string): MonitorStatus {
  const status: MonitorStatus = new MonitorStatus();
  status._id = statusId;
  status.name = statusId === OFFLINE_ID ? "Offline" : "Operational";
  status.color = new Color(statusId === OFFLINE_ID ? "#ef4444" : "#10b981");
  status.isOperationalState = statusId !== OFFLINE_ID;
  status.isOfflineState = statusId === OFFLINE_ID;
  return status;
}

// Partial<T> under exactOptionalPropertyTypes forbids an explicit undefined.
type MonitorOverrides = {
  [K in keyof Monitor]?: Monitor[K] | undefined;
};

function buildMonitor(data?: {
  id?: ObjectID;
  type?: MonitorType;
  statusId?: string;
  overrides?: MonitorOverrides;
}): Monitor {
  const statusId: string = data?.statusId || OPERATIONAL_ID;
  const monitor: Monitor = new Monitor();
  monitor._id = (data?.id || MONITOR_ID).toString();
  monitor.monitorType = data?.type || MonitorType.API;
  monitor.monitorSteps = STEPS;
  monitor.monitoringInterval = "* * * * *";
  monitor.createdAt = new Date("2026-01-01T00:00:00.000Z");
  monitor.currentMonitorStatusId = new ObjectID(statusId);
  monitor.currentMonitorStatus = buildStatus(statusId);
  Object.assign(monitor, data?.overrides || {});
  return monitor;
}

function buildStatusRow(data: {
  id: string;
  statusId: string;
  startsAt: Date;
  endsAt?: Date;
}): MonitorStatusTimeline {
  const row: MonitorStatusTimeline = new MonitorStatusTimeline();
  row._id = data.id;
  row.monitorStatusId = new ObjectID(data.statusId);
  row.monitorStatus = buildStatus(data.statusId);
  row.startsAt = data.startsAt;

  if (data.endsAt) {
    row.endsAt = data.endsAt;
  }

  return row;
}

function buildProbeRow(spec: ProbeSpec, isFull: boolean): MonitorProbe {
  const row: MonitorProbe = new MonitorProbe();
  row.createdAt = NOW;
  row.probeId = new ObjectID(spec.probeId);
  row.isEnabled = spec.isEnabled !== false;

  if (spec.lastPingAt) {
    row.lastPingAt = spec.lastPingAt;
  }

  if (spec.nextPingAt) {
    row.nextPingAt = spec.nextPingAt;
  }

  const probe: Probe = new Probe();
  probe._id = spec.probeId;
  probe.name = spec.probeId === PROBE_A ? "Frankfurt" : "Virginia";

  if (spec.connectionStatus) {
    probe.connectionStatus = spec.connectionStatus;
  }

  row.probe = probe;

  if (isFull && spec.monitoredAt) {
    row.lastMonitoringLog = {
      [STEP_ID]: {
        monitoredAt: spec.monitoredAt.toISOString(),
        isOnline: true,
        responseTimeInMs: 100,
      },
    } as unknown as MonitorStepProbeResponse;
  }

  return row;
}

function buildLog(data: { probeId: string; time: Date }): MonitorLog {
  const log: MonitorLog = new MonitorLog();
  log.time = data.time;
  log.logBody = {
    probeId: data.probeId,
    evaluationSummary: {
      criteriaResults: [{ criteriaId: "up", criteriaName: "Up", met: true }],
      events: [],
    },
  } as unknown as JSONObject;
  return log;
}

function listOf<T>(data: Array<T>): {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} {
  return { data: data, count: data.length, skip: 0, limit: data.length };
}

let server: FakeServer;
let permissions: Array<Permission>;
let visibilityState: DocumentVisibilityState;
let getItemSpy: jest.SpyInstance;
let getListSpy: jest.SpyInstance;
let analyticsGetListSpy: jest.SpyInstance;
let apiGetSpy: jest.SpyInstance;

function listRequests(modelType: unknown): Array<ListRequest> {
  return getListSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest) => {
      return request.modelType === modelType;
    });
}

function probeRequestWeights(): Array<string> {
  return listRequests(MonitorProbe).map((request: ListRequest) => {
    return request.select["lastMonitoringLog"] ? "full" : "light";
  });
}

function itemRequests(): Array<ItemRequest> {
  return getItemSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ItemRequest;
  });
}

function apiGetRequests(): Array<ApiGetRequest> {
  return apiGetSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ApiGetRequest;
  });
}

// Lets every settled promise run its continuations, inside act.
async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 50; i++) {
      await Promise.resolve();
    }
  });
}

async function advance(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
  await flush();
}

async function poll(): Promise<void> {
  await advance(MONITOR_OVERVIEW_REFRESH_INTERVAL_MS);
}

type RenderedHook = {
  result: { current: UseMonitorOverviewDataResult };
  rerender: (props: { monitorId: ObjectID }) => void;
  unmount: () => void;
};

function renderData(monitorId: ObjectID = MONITOR_ID): RenderedHook {
  return renderHook(
    (props: { monitorId: ObjectID }): UseMonitorOverviewDataResult => {
      return useMonitorOverviewData({ monitorId: props.monitorId });
    },
    { initialProps: { monitorId: monitorId } },
  );
}

async function renderLoaded(
  monitorId: ObjectID = MONITOR_ID,
): Promise<RenderedHook> {
  const rendered: RenderedHook = renderData(monitorId);
  await flush();
  expect(rendered.result.current.hasLoaded).toBe(true);
  return rendered;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(NOW);

  server = {
    monitors: {
      [MONITOR_ID.toString()]: buildMonitor(),
      [OTHER_MONITOR_ID.toString()]: buildMonitor({ id: OTHER_MONITOR_ID }),
    },
    monitorError: null,
    probes: [
      {
        probeId: PROBE_A,
        lastPingAt: secondsFromNow(-60),
        monitoredAt: secondsFromNow(-30),
        nextPingAt: secondsFromNow(30),
      },
      {
        probeId: PROBE_B,
        lastPingAt: secondsFromNow(-50),
        monitoredAt: secondsFromNow(-20),
      },
    ],
    probeError: null,
    fullProbeError: null,
    heldFullProbeRead: null,
    statusRows: [
      buildStatusRow({
        id: ROW_ONE_ID,
        statusId: OPERATIONAL_ID,
        startsAt: secondsFromNow(-3600),
      }),
    ],
    statusRowsError: null,
    // Newest first, as the server sorts it: each result's own verdict.
    logs: [
      buildLog({ probeId: PROBE_B, time: secondsFromNow(-20) }),
      buildLog({ probeId: PROBE_A, time: secondsFromNow(-30) }),
    ],
    logError: null,
  };
  permissions = [Permission.ProjectOwner];
  visibilityState = "visible";

  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return visibilityState;
    },
  });

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return permissions;
  });

  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  getItemSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    if (server.monitorError) {
      return rejectWith(server.monitorError);
    }

    const request: ItemRequest = args[0] as ItemRequest;
    return Promise.resolve(server.monitors[request.id.toString()] ?? null);
  });

  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: ListRequest = args[0] as ListRequest;

    if (request.modelType === MonitorProbe) {
      const isFull: boolean = Boolean(request.select["lastMonitoringLog"]);
      const failure: Error | null = isFull
        ? server.fullProbeError || server.probeError
        : server.probeError;

      if (failure) {
        return rejectWith(failure);
      }

      const respond: () => unknown = (): unknown => {
        return listOf(
          server.probes.map((spec: ProbeSpec) => {
            return buildProbeRow(spec, isFull);
          }),
        );
      };
      const held: Deferred<void> | null = isFull
        ? server.heldFullProbeRead
        : null;

      if (held) {
        server.heldFullProbeRead = null;
        return held.promise.then(respond);
      }

      return Promise.resolve(respond());
    }

    if (request.modelType === MonitorStatusTimeline) {
      if (server.statusRowsError) {
        return rejectWith(server.statusRowsError);
      }

      return Promise.resolve(listOf(server.statusRows));
    }

    return Promise.resolve(listOf([]));
  });

  analyticsGetListSpy = jest.spyOn(AnalyticsModelAPI, "getList");
  analyticsGetListSpy.mockImplementation((): Promise<unknown> => {
    if (server.logError) {
      return rejectWith(server.logError);
    }

    return Promise.resolve(listOf(server.logs));
  });

  apiGetSpy = jest.spyOn(API, "get");
  apiGetSpy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("useMonitorOverviewData: the first load", () => {
  test("R1, R2 and R3 start together, and the page commits once all three land", async () => {
    const monitorDeferred: Deferred<Monitor | null> =
      createDeferred<Monitor | null>();
    getItemSpy.mockImplementationOnce(() => {
      return monitorDeferred.promise;
    });

    const { result } = renderData();

    // All three requests are out before the Monitor row has answered.
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(listRequests(MonitorProbe)).toHaveLength(1);
    expect(listRequests(MonitorStatusTimeline)).toHaveLength(1);

    const probeRequest: ListRequest = listRequests(MonitorProbe)[0]!;
    expect(probeRequest.query).toEqual({ monitorId: MONITOR_ID });
    expect(probeRequest.select).toBe(MONITOR_OVERVIEW_PROBE_FULL_SELECT);
    expect(probeRequest.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(probeRequest.limit).toBe(LIMIT_PER_PROJECT);

    const statusRequest: ListRequest = listRequests(MonitorStatusTimeline)[0]!;
    expect(statusRequest.query).toEqual({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });
    expect(statusRequest.select).toBe(MONITOR_OVERVIEW_STATUS_ROW_SELECT);
    expect(statusRequest.sort).toEqual({ startsAt: SortOrder.Descending });
    expect(statusRequest.limit).toBe(MONITOR_OVERVIEW_STATUS_ROW_LIMIT);

    await flush();

    // Probes and status rows are in, but nothing is shown without the row.
    expect(result.current.hasLoaded).toBe(false);
    expect(result.current.monitor).toBeNull();
    expect(result.current.probes.status).toBe("loading");
    expect(analyticsGetListSpy).not.toHaveBeenCalled();

    await act(async () => {
      monitorDeferred.resolve(server.monitors[MONITOR_ID.toString()]!);
    });
    await flush();

    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.error).toBe("");
    expect(result.current.monitor?._id?.toString()).toBe(MONITOR_ID.toString());
    expect(result.current.refreshCount).toBe(1);
    expect(result.current.lastLoadedAt).toEqual(NOW);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.probes.status).toBe("loaded");
    expect(result.current.probes.value!.rows).toHaveLength(2);
    expect(result.current.probes.value!.fullLoadedAt).toEqual(NOW);
    expect(
      result.current.probes.value!.attached.probes.map((probe: Probe) => {
        return probe.name;
      }),
    ).toEqual(["Frankfurt", "Virginia"]);
    expect(result.current.statusRows.status).toBe("loaded");
    expect(result.current.statusRows.value).toHaveLength(1);
    expect(result.current.statusFingerprint).toBe(
      `${OPERATIONAL_ID}|${ROW_ONE_ID}|`,
    );
    expect(result.current.resultFingerprint).toBe(
      secondsFromNow(-20).toISOString(),
    );
  });

  test("refresh-status fires once per id with tenantid and is not awaited", async () => {
    // A refresh-status that never answers must not hold up the page.
    apiGetSpy.mockImplementation(() => {
      return new Promise<never>(() => {
        // Never settles.
      });
    });

    const { result, rerender } = renderData();
    await flush();

    expect(result.current.hasLoaded).toBe(true);
    expect(apiGetRequests()).toHaveLength(1);

    const request: ApiGetRequest = apiGetRequests()[0]!;
    expect(request.url.toString()).toContain(
      `/monitor/refresh-status/${MONITOR_ID.toString()}`,
    );
    expect(request.headers["tenantid"]).toBe(PROJECT_ID.toString());

    act(() => {
      result.current.refresh();
    });
    await flush();
    act(() => {
      result.current.retryFirstLoad();
    });
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(3);
    expect(apiGetRequests()).toHaveLength(1);

    rerender({ monitorId: OTHER_MONITOR_ID });
    await flush();

    expect(apiGetRequests()).toHaveLength(2);
    expect(apiGetRequests()[1]!.url.toString()).toContain(
      `/monitor/refresh-status/${OTHER_MONITOR_ID.toString()}`,
    );
  });

  test("refresh-status is never sent on a poll or on a visibility catch-up", async () => {
    await renderLoaded();

    await poll();
    await poll();
    await poll();

    // Hidden across a tick, then back: one catch-up.
    visibilityState = "hidden";
    await poll();
    visibilityState = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(5);
    expect(apiGetRequests()).toHaveLength(1);
  });

  test("a rejected refresh-status still loads", async () => {
    apiGetSpy.mockImplementation(() => {
      return rejectWith(new Error("refresh-status is down"));
    });

    const { result } = await renderLoaded();

    expect(result.current.error).toBe("");
    expect(result.current.monitor).not.toBeNull();
  });

  test("a refresh-status that resolves with an error response still loads", async () => {
    apiGetSpy.mockImplementation(() => {
      return Promise.resolve(
        new HTTPErrorResponse(422, { message: "Not a member." }, {}),
      );
    });

    const { result } = await renderLoaded();

    expect(result.current.error).toBe("");
    expect(result.current.refreshError).toBe("");
  });

  test("an R1 failure fails the first load; retryFirstLoad recovers without refresh-status", async () => {
    server.monitorError = new Error("You do not have permission.");

    const { result } = renderData();
    await flush();

    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.error).toBe("You do not have permission.");
    expect(result.current.refreshError).toBe("");
    expect(result.current.monitor).toBeNull();

    // No poll retries a page that never loaded; the retry button does.
    await poll();
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(result.current.pollCount).toBe(0);

    server.monitorError = null;
    act(() => {
      result.current.retryFirstLoad();
    });

    // Straight back to the skeleton.
    expect(result.current.hasLoaded).toBe(false);
    expect(result.current.error).toBe("");

    await flush();

    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.error).toBe("");
    expect(result.current.monitor).not.toBeNull();
    expect(apiGetRequests()).toHaveLength(1);
  });

  test("an error response from the row read is reported with its own message", async () => {
    server.monitorError = new HTTPErrorResponse(
      403,
      { message: "You are not authorized to access this project's data." },
      {},
    ) as unknown as Error;

    const { result } = renderData();
    await flush();

    expect(result.current.error).toBe(
      "You are not authorized to access this project's data.",
    );
  });

  test("a null row gives the not-found text", async () => {
    server.monitors[MONITOR_ID.toString()] = null;

    const { result } = renderData();
    await flush();

    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.monitor).toBeNull();
    expect(result.current.error).toBe(MONITOR_OVERVIEW_NOT_FOUND_MESSAGE);
    expect(MONITOR_OVERVIEW_NOT_FOUND_MESSAGE).toBe(
      "This monitor could not be found. It may have been deleted, or you may not have permission to view it.",
    );
  });

  test("R2/R3 failures stay in their sections and never fail the page", async () => {
    server.probeError = new Error("Probes are unavailable.");
    server.statusRowsError = new Error("The timeline is unavailable.");

    const { result } = await renderLoaded();

    expect(result.current.error).toBe("");
    expect(result.current.monitor).not.toBeNull();
    expect(result.current.probes.status).toBe("error");
    expect(result.current.probes.value).toBeNull();
    expect(result.current.probes.error).toBe("Probes are unavailable.");
    expect(result.current.statusRows.status).toBe("error");
    expect(result.current.statusRows.value).toBeNull();
    expect(result.current.statusRows.error).toBe(
      "The timeline is unavailable.",
    );
    // With no rows there is no status row to fingerprint.
    expect(result.current.statusFingerprint).toBe(`${OPERATIONAL_ID}||`);
  });

  test("a definite gate denial sends no request; the section is forbidden, never empty", async () => {
    permissions = [Permission.ReadProjectMonitor];

    const { result } = await renderLoaded();

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(listRequests(MonitorProbe)).toHaveLength(0);
    expect(listRequests(MonitorStatusTimeline)).toHaveLength(0);
    expect(result.current.probes.status).toBe("forbidden");
    expect(result.current.probes.value).toBeNull();
    expect(result.current.probes.error).toBe(
      MONITOR_OVERVIEW_ACCESS_REASONS.probes,
    );
    expect(result.current.statusRows.status).toBe("forbidden");
    expect(result.current.statusRows.error).toBe(
      MONITOR_OVERVIEW_ACCESS_REASONS.statusRows,
    );

    // ReadProjectMonitor may read MonitorLog, so the evaluation still loads.
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);
    expect(result.current.evaluation.status).toBe("loaded");

    // A poll respects the gate too.
    await poll();
    expect(listRequests(MonitorProbe)).toHaveLength(0);
    expect(listRequests(MonitorStatusTimeline)).toHaveLength(0);
  });

  test("an empty permission snapshot cannot decide, so every read is still sent", async () => {
    permissions = [];

    const { result } = await renderLoaded();

    expect(listRequests(MonitorProbe)).toHaveLength(1);
    expect(listRequests(MonitorStatusTimeline)).toHaveLength(1);
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);
    expect(result.current.probes.status).toBe("loaded");
    expect(result.current.statusRows.status).toBe("loaded");
  });

  test("the secret-key select is spread at call time, not frozen into a constant", async () => {
    const { result } = await renderLoaded();

    const ownerSelect: Record<string, unknown> = itemRequests()[0]!.select;

    for (const key of Object.keys(MONITOR_OVERVIEW_BASE_SELECT)) {
      expect(ownerSelect).toHaveProperty(key);
    }

    for (const column of SECRET_KEY_COLUMNS) {
      expect(ownerSelect[column]).toBe(true);
    }

    // The snapshot changes (a Viewer): the next read must not ask for keys.
    permissions = [Permission.Viewer];
    act(() => {
      result.current.refresh();
    });
    await flush();

    const viewerSelect: Record<string, unknown> = itemRequests()[1]!.select;

    for (const column of SECRET_KEY_COLUMNS) {
      expect(viewerSelect).not.toHaveProperty(column);
    }

    expect(Object.keys(viewerSelect).sort()).toEqual(
      Object.keys(MONITOR_OVERVIEW_BASE_SELECT).sort(),
    );

    // And the shared constant was never written to.
    for (const column of SECRET_KEY_COLUMNS) {
      expect(MONITOR_OVERVIEW_BASE_SELECT).not.toHaveProperty(column);
    }
  });
});

describe("useMonitorOverviewData: drift", () => {
  test("drift triggers exactly one background refresh, after refresh-status resolves", async () => {
    // The newest row says Offline; the Monitor row still says Operational.
    server.statusRows = [
      buildStatusRow({
        id: ROW_TWO_ID,
        statusId: OFFLINE_ID,
        startsAt: secondsFromNow(-120),
      }),
    ];

    const refreshStatus: Deferred<unknown> = createDeferred<unknown>();
    apiGetSpy.mockImplementation(() => {
      return refreshStatus.promise;
    });

    const { result } = await renderLoaded();

    // The page is up, drifted, and waiting for the repair.
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(result.current.monitor?.currentMonitorStatusId?.toString()).toBe(
      OPERATIONAL_ID,
    );

    // The server repairs the row.
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      statusId: OFFLINE_ID,
    });

    await act(async () => {
      refreshStatus.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
    });
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(2);
    expect(result.current.monitor?.currentMonitorStatusId?.toString()).toBe(
      OFFLINE_ID,
    );
    // The heal is a background refresh: light probes, no refresh-status.
    expect(probeRequestWeights()).toEqual(["full", "light"]);
    expect(apiGetRequests()).toHaveLength(1);
    expect(result.current.statusChangeCount).toBe(1);

    await flush();
    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });

  test("drift is healed at most once, even if the repair did not take", async () => {
    server.statusRows = [
      buildStatusRow({
        id: ROW_TWO_ID,
        statusId: OFFLINE_ID,
        startsAt: secondsFromNow(-120),
      }),
    ];

    await renderLoaded();
    await flush();

    // refresh-status resolved at once: one heal, and no second one.
    expect(getItemSpy).toHaveBeenCalledTimes(2);

    await flush();
    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });

  test("no drift, no extra refresh", async () => {
    await renderLoaded();
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(1);
  });

  test("a newer load that already ran makes the heal unnecessary", async () => {
    server.statusRows = [
      buildStatusRow({
        id: ROW_TWO_ID,
        statusId: OFFLINE_ID,
        startsAt: secondsFromNow(-120),
      }),
    ];

    const refreshStatus: Deferred<unknown> = createDeferred<unknown>();
    apiGetSpy.mockImplementation(() => {
      return refreshStatus.promise;
    });

    const { result } = await renderLoaded();

    act(() => {
      result.current.refresh();
    });
    await flush();
    expect(getItemSpy).toHaveBeenCalledTimes(2);

    await act(async () => {
      refreshStatus.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
    });
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });
});

describe("useMonitorOverviewData: the poll", () => {
  test("one poll per 60 s; a hidden tab is skipped; visibilitychange catches up; unmount stops it", async () => {
    const { result, unmount } = await renderLoaded();

    await advance(MONITOR_OVERVIEW_REFRESH_INTERVAL_MS - 1);
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(result.current.pollCount).toBe(0);

    await advance(1);
    expect(getItemSpy).toHaveBeenCalledTimes(2);
    expect(result.current.pollCount).toBe(1);
    expect(result.current.refreshCount).toBe(2);

    visibilityState = "hidden";
    await poll();
    expect(getItemSpy).toHaveBeenCalledTimes(2);
    expect(result.current.pollCount).toBe(1);

    visibilityState = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(3);
    expect(result.current.pollCount).toBe(2);

    unmount();
    await poll();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();

    expect(getItemSpy).toHaveBeenCalledTimes(3);
  });

  test("polls read probes LIGHT, and lay the light fields over the last full results", async () => {
    const { result } = await renderLoaded();

    server.probes[0]!.nextPingAt = secondsFromNow(90);
    await poll();

    expect(probeRequestWeights()).toEqual(["full", "light"]);
    expect(listRequests(MonitorProbe)[1]!.select).toBe(
      MONITOR_OVERVIEW_PROBE_LIGHT_SELECT,
    );
    expect(MONITOR_OVERVIEW_PROBE_LIGHT_SELECT).not.toHaveProperty(
      "lastMonitoringLog",
    );

    const rowA: MonitorProbe = result.current.probes.value!.rows.find(
      (row: MonitorProbe) => {
        return row.probeId?.toString() === PROBE_A;
      },
    )!;

    // The light field is new, the result is the one from the full read.
    expect(rowA.nextPingAt).toEqual(secondsFromNow(90));
    expect(rowA.lastMonitoringLog).toBeDefined();
    expect(result.current.probes.value!.fullLoadedAt).toEqual(NOW);
    expect(result.current.probes.value!.attached.probeResponses).toHaveLength(
      2,
    );
  });

  test("a probe that claimed a check newer than its last result triggers one FULL read", async () => {
    const { result } = await renderLoaded();

    // Probe A claims a check after its last result, and the result lands.
    server.probes[0]!.lastPingAt = secondsFromNow(40);
    server.probes[0]!.monitoredAt = secondsFromNow(45);
    await poll();

    expect(probeRequestWeights()).toEqual(["full", "light", "full"]);

    const rowA: MonitorProbe = result.current.probes.value!.rows.find(
      (row: MonitorProbe) => {
        return row.probeId?.toString() === PROBE_A;
      },
    )!;
    const log: JSONObject = rowA.lastMonitoringLog![
      STEP_ID
    ] as unknown as JSONObject;

    expect(log["monitoredAt"]).toBe(secondsFromNow(45).toISOString());
    expect(result.current.probes.value!.fullLoadedAt).toEqual(
      secondsFromNow(60),
    );

    // Nothing pending any more: the next poll is light only.
    await poll();
    expect(probeRequestWeights()).toEqual(["full", "light", "full", "light"]);
  });

  test("switching a probe off counts as pending and re-reads in full", async () => {
    const { result } = await renderLoaded();

    server.probes[1]!.isEnabled = false;
    await poll();

    expect(probeRequestWeights()).toEqual(["full", "light", "full"]);
    expect(result.current.probes.value!.attached.disabledProbeIds).toEqual([
      PROBE_B,
    ]);
  });

  test("SyntheticMonitor FULL reloads are capped at one per 5 minutes", async () => {
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      type: MonitorType.SyntheticMonitor,
    });
    // Always a claim newer than the result held: always "pending".
    server.probes[0]!.lastPingAt = secondsFromNow(24 * 3600);

    await renderLoaded();

    for (let i: number = 0; i < 4; i++) {
      await poll();
    }

    // Four minutes in: light reads only, the screenshots are not re-sent.
    expect(probeRequestWeights()).toEqual([
      "full",
      "light",
      "light",
      "light",
      "light",
    ]);

    await poll();

    expect(MONITOR_OVERVIEW_HEAVY_PROBE_RELOAD_MS).toBe(5 * 60 * 1000);
    expect(probeRequestWeights()).toEqual([
      "full",
      "light",
      "light",
      "light",
      "light",
      "light",
      "full",
    ]);
  });

  test("other probe checks re-read in full on every poll that has something pending", async () => {
    server.probes[0]!.lastPingAt = secondsFromNow(24 * 3600);

    await renderLoaded();
    await poll();
    await poll();

    expect(probeRequestWeights()).toEqual([
      "full",
      "light",
      "full",
      "light",
      "full",
    ]);
  });

  test("a failed FULL read on a poll keeps the merged rows and records the failure", async () => {
    const { result } = await renderLoaded();

    server.probes[0]!.lastPingAt = secondsFromNow(40);
    server.fullProbeError = new Error("Results are unavailable.");
    await poll();

    expect(result.current.probes.status).toBe("loaded");
    expect(result.current.probes.refreshError).toBe("Results are unavailable.");
    expect(result.current.probes.value!.rows).toHaveLength(2);
    expect(result.current.probes.value!.fullLoadedAt).toEqual(NOW);
  });

  test("types that are not probe checks read probes on the first load only", async () => {
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      type: MonitorType.IncomingRequest,
    });

    const { result } = await renderLoaded();

    // The type is unknown until the row lands, so the first load reads them.
    expect(probeRequestWeights()).toEqual(["full"]);

    await poll();
    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(probeRequestWeights()).toEqual(["full"]);
    expect(result.current.probes.status).toBe("loaded");
    expect(listRequests(MonitorStatusTimeline)).toHaveLength(3);
  });

  test("a failed poll keeps the last row and reports itself", async () => {
    const { result } = await renderLoaded();

    server.monitorError = new Error("Network error.");
    await poll();

    expect(result.current.refreshError).toBe("Network error.");
    expect(result.current.error).toBe("");
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.monitor).not.toBeNull();
    expect(result.current.refreshCount).toBe(1);
    expect(result.current.isRefreshing).toBe(false);

    server.monitorError = null;
    await poll();

    expect(result.current.refreshError).toBe("");
    expect(result.current.refreshCount).toBe(2);
  });

  test("a failed section refresh keeps the last value and records refreshError", async () => {
    const { result } = await renderLoaded();

    server.statusRowsError = new Error("The timeline is unavailable.");
    await poll();

    expect(result.current.statusRows.status).toBe("loaded");
    expect(result.current.statusRows.value).toHaveLength(1);
    expect(result.current.statusRows.refreshError).toBe(
      "The timeline is unavailable.",
    );
    expect(result.current.refreshError).toBe("");
  });
});

async function setVisibility(state: DocumentVisibilityState): Promise<void> {
  visibilityState = state;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flush();
}

describe("useMonitorOverviewData: coming back to the tab", () => {
  test("switching away and back within the minute does not poll", async () => {
    const { result } = await renderLoaded();

    await advance(20 * 1000);
    await setVisibility("hidden");
    await advance(10 * 1000);
    await setVisibility("visible");

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(result.current.pollCount).toBe(0);

    // The regular tick still comes a minute after the load.
    await advance(30 * 1000);
    expect(getItemSpy).toHaveBeenCalledTimes(2);
    expect(result.current.pollCount).toBe(1);
  });

  test("a tick missed while hidden is caught up once, and the next tick is a full interval later", async () => {
    const { result } = await renderLoaded();

    await setVisibility("hidden");
    await advance(65 * 1000);
    expect(getItemSpy).toHaveBeenCalledTimes(1);

    await setVisibility("visible");
    expect(getItemSpy).toHaveBeenCalledTimes(2);
    expect(result.current.pollCount).toBe(1);

    // Not at 120 s, 55 s after the catch-up, but a whole interval after it.
    await advance(55 * 1000);
    expect(getItemSpy).toHaveBeenCalledTimes(2);

    await advance(5 * 1000);
    expect(getItemSpy).toHaveBeenCalledTimes(3);
    expect(result.current.pollCount).toBe(2);
  });

  test("a hidden tab's throttled timer that never ran is caught up by the time that passed", async () => {
    await renderLoaded();

    await setVisibility("hidden");
    // The clock moves on; the timer does not run.
    jest.setSystemTime(secondsFromNow(90));
    await setVisibility("visible");

    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });
});

describe("useMonitorOverviewData: a poll during a Refresh", () => {
  test("a poll that starts while a Refresh is out takes it over and reads in full", async () => {
    const { result } = await renderLoaded();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);

    const slowRead: Deferred<Monitor | null> = createDeferred<Monitor | null>();
    getItemSpy.mockImplementationOnce(() => {
      return slowRead.promise;
    });

    act(() => {
      result.current.refresh();
    });

    // The minute tick lands while the Refresh is still out, and cancels it.
    await poll();

    // The poll did what the Refresh would have: full results, fresh verdicts.
    expect(probeRequestWeights()).toEqual(["full", "full", "full"]);
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.refreshCount).toBe(2);
    expect(result.current.isRefreshing).toBe(false);

    await act(async () => {
      slowRead.resolve(server.monitors[MONITOR_ID.toString()]!);
    });
    await flush();

    expect(result.current.refreshCount).toBe(2);

    // With nothing of the reader's in flight, a poll is a light one again.
    await poll();
    expect(probeRequestWeights()).toEqual(["full", "full", "full", "light"]);
  });

  test("a details save in flight is taken over the same way", async () => {
    const { result } = await renderLoaded();

    const slowRead: Deferred<Monitor | null> = createDeferred<Monitor | null>();
    getItemSpy.mockImplementationOnce(() => {
      return slowRead.promise;
    });

    act(() => {
      result.current.refresh({ reason: "details-saved" });
    });
    await poll();

    expect(probeRequestWeights()).toEqual(["full", "full", "full"]);
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.manualRefreshCount).toBe(0);
  });
});

describe("useMonitorOverviewData: probe results that could not be read", () => {
  test("light rows are never shown without results: the section stays an error until a full read works", async () => {
    // The first load's full read fails (a synthetic payload that times out).
    server.fullProbeError = new Error("Results are unavailable.");

    const { result } = await renderLoaded();

    expect(result.current.probes.status).toBe("error");

    // The poll's light read works; the full read it leads to fails again.
    await poll();

    expect(probeRequestWeights()).toEqual(["full", "light", "full"]);
    expect(result.current.probes.status).toBe("error");
    expect(result.current.probes.value).toBeNull();
    expect(result.current.probes.error).toBe("Results are unavailable.");
    expect(MONITOR_OVERVIEW_PROBE_RESULTS_UNREADABLE_MESSAGE).toBe(
      "The probe results could not be read.",
    );

    server.fullProbeError = null;
    await poll();

    expect(result.current.probes.status).toBe("loaded");
    expect(result.current.probes.value!.rows).toHaveLength(2);
    expect(result.current.probes.value!.fullLoadedAt).toEqual(
      secondsFromNow(120),
    );
  });

  test("a monitor with no probes attached is still a known empty list", async () => {
    server.fullProbeError = new Error("Results are unavailable.");
    server.probes = [];

    const { result } = await renderLoaded();

    server.fullProbeError = null;
    await poll();

    // Nothing is attached, so there are no results to be missing.
    expect(probeRequestWeights()).toEqual(["full", "light"]);
    expect(result.current.probes.status).toBe("loaded");
    expect(result.current.probes.value!.rows).toEqual([]);
  });
});

describe("useMonitorOverviewData: the synthetic reload cap", () => {
  test("is timed from when the full read was sent, so a slow download does not push it to the sixth poll", async () => {
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      type: MonitorType.SyntheticMonitor,
    });
    // Always a claim newer than the result held: always "pending".
    server.probes[0]!.lastPingAt = secondsFromNow(24 * 3600);

    // The first load's screenshots take 20 seconds to download.
    const slowFull: Deferred<void> = createDeferred<void>();
    server.heldFullProbeRead = slowFull;

    const { result } = renderData();
    await flush();
    await advance(20 * 1000);
    await act(async () => {
      slowFull.resolve();
    });
    await flush();

    expect(result.current.hasLoaded).toBe(true);
    // Stamped when it was sent, not when it arrived.
    expect(result.current.probes.value!.fullLoadedAt).toEqual(NOW);

    // The ticks at 60, 120, 180 and 240 s: light reads only.
    for (let i: number = 0; i < 4; i++) {
      await poll();
    }

    expect(probeRequestWeights()).toEqual([
      "full",
      "light",
      "light",
      "light",
      "light",
    ]);

    // The tick at 300 s, five minutes after the full read was sent.
    await poll();

    expect(probeRequestWeights()).toEqual([
      "full",
      "light",
      "light",
      "light",
      "light",
      "light",
      "full",
    ]);
  });
});

describe("useMonitorOverviewData: which probe claims are followed", () => {
  test("a disconnected probe that never reported does not cost a full read on every poll", async () => {
    server.probes[1] = {
      probeId: PROBE_B,
      lastPingAt: secondsFromNow(-50),
      connectionStatus: ProbeConnectionStatus.Disconnected,
    };

    await renderLoaded();
    await poll();
    await poll();
    await poll();

    expect(probeRequestWeights()).toEqual(["full", "light", "light", "light"]);
  });

  test("a probe that never reported is followed only while its claim could still produce a result", async () => {
    // Probe B claimed its first check 50 s ago and has not reported yet.
    server.probes[1] = { probeId: PROBE_B, lastPingAt: secondsFromNow(-50) };

    await renderLoaded();

    // Up to one cadence plus grace (60 + 300 s) after the claim.
    for (let i: number = 0; i < 5; i++) {
      await poll();
    }

    expect(probeRequestWeights()).toEqual([
      "full",
      "light",
      "full",
      "light",
      "full",
      "light",
      "full",
      "light",
      "full",
      "light",
      "full",
    ]);

    // Past that the probe is late (the Probes card says so), not pending.
    await poll();
    await poll();

    expect(probeRequestWeights().slice(-2)).toEqual(["light", "light"]);
  });

  test("a claim the last full read saw before its result landed is followed on the next poll", async () => {
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      overrides: { monitoringInterval: "*/5 * * * *" },
    });

    const { result } = await renderLoaded();

    // Probe A claims its next check just before the poll; it is still running.
    server.probes[0]!.lastPingAt = secondsFromNow(50);
    await poll();

    expect(probeRequestWeights()).toEqual(["full", "light", "full"]);

    // Its result lands after that full read was sent.
    server.probes[0]!.monitoredAt = secondsFromNow(65);
    await poll();

    // Read now, not when the probe next claims, five minutes later.
    expect(probeRequestWeights()).toEqual([
      "full",
      "light",
      "full",
      "light",
      "full",
    ]);
    expect(result.current.resultFingerprint).toBe(
      secondsFromNow(65).toISOString(),
    );
  });

  test("a claim that is never answered stops costing a full read once it is older than cadence plus grace", async () => {
    await renderLoaded();

    // Probe A claims a check 30 s in and dies before reporting it.
    server.probes[0]!.lastPingAt = secondsFromNow(30);

    // 60 to 360 s: the result could still land, so every poll reads it.
    for (let i: number = 0; i < 6; i++) {
      await poll();
    }

    expect(
      probeRequestWeights().filter((weight: string) => {
        return weight === "full";
      }),
    ).toHaveLength(7);

    await poll();
    await poll();

    expect(probeRequestWeights().slice(-2)).toEqual(["light", "light"]);
  });

  test("a browser clock minutes fast does not make a young claim look settled", async () => {
    // The browser believes it is seven minutes later than the server does.
    jest.setSystemTime(secondsFromNow(7 * 60));
    // Probe B claimed its first check 50 s ago by the server's clock.
    server.probes[1] = { probeId: PROBE_B, lastPingAt: secondsFromNow(-50) };

    const { result } = await renderLoaded();

    act(() => {
      result.current.setServerClockOffset(-7 * 60 * 1000);
    });

    expect(result.current.serverClockOffsetMs).toBe(-7 * 60 * 1000);

    await poll();

    // 110 s old on the server's clock: its result may be in, so it is read.
    expect(probeRequestWeights()).toEqual(["full", "light", "full"]);
  });
});

describe("useMonitorOverviewData: the evaluation log catching up", () => {
  test("a verdict still in the worker's buffer is read again until it lands", async () => {
    const { result } = await renderLoaded();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);

    // Probe B reports; its verdict is not in the log yet.
    server.probes[1]!.lastPingAt = secondsFromNow(100);
    server.probes[1]!.monitoredAt = new Date(
      secondsFromNow(105).getTime() + 700,
    );
    await poll();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.evaluation.value!.latestAt).toEqual(
      secondsFromNow(-20),
    );

    // Still the previous verdict: read again on the next poll.
    await poll();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(3);

    // The verdict lands, stamped without its milliseconds.
    server.logs = [
      buildLog({ probeId: PROBE_B, time: secondsFromNow(105) }),
      ...server.logs,
    ];
    await poll();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(4);
    expect(result.current.evaluation.value!.latestAt).toEqual(
      secondsFromNow(105),
    );

    // Caught up: nothing more until the next result.
    await poll();
    await poll();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(4);
  });

  test("a result whose verdict never lands costs a few extra reads, not one per poll", async () => {
    await renderLoaded();

    server.probes[1]!.lastPingAt = secondsFromNow(100);
    server.probes[1]!.monitoredAt = secondsFromNow(105);
    await poll();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);

    for (
      let i: number = 0;
      i < MONITOR_OVERVIEW_EVALUATION_RETRY_POLLS + 3;
      i++
    ) {
      await poll();
    }

    expect(MONITOR_OVERVIEW_EVALUATION_RETRY_POLLS).toBe(3);
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(
      2 + MONITOR_OVERVIEW_EVALUATION_RETRY_POLLS,
    );
  });
});

describe("getSettledClaimCutoff", () => {
  const rowsClaimedAt: (seconds: Array<number>) => Array<MonitorProbe> = (
    seconds: Array<number>,
  ): Array<MonitorProbe> => {
    return seconds.map((offset: number, index: number) => {
      return buildProbeRow(
        {
          probeId: index === 0 ? PROBE_A : PROBE_B,
          lastPingAt: secondsFromNow(offset),
        },
        true,
      );
    });
  };

  test("a claim settles only once the last full read saw it and it is older than cadence plus grace", () => {
    const fullRows: Array<MonitorProbe> = rowsClaimedAt([-50, 30]);

    // At 100 s the newest claim seen (30 s) is young: only claims before
    // 100 - (60 + 300) s have settled.
    expect(
      getSettledClaimCutoff({
        fullRows: fullRows,
        now: secondsFromNow(100),
        cadenceSeconds: 60,
      }),
    ).toEqual(secondsFromNow(-260));

    // At 500 s everything the read saw has settled, and nothing after it.
    expect(
      getSettledClaimCutoff({
        fullRows: fullRows,
        now: secondsFromNow(500),
        cadenceSeconds: 60,
      }),
    ).toEqual(secondsFromNow(30));
  });

  test("with no full read there is nothing settled", () => {
    expect(
      getSettledClaimCutoff({
        fullRows: [],
        now: NOW,
        cadenceSeconds: 60,
      }),
    ).toBeNull();
  });
});

describe("isEvaluationCaughtUp", () => {
  test("compares to the second, and a missing log never covers a signal", () => {
    const signal: Date = new Date(secondsFromNow(105).getTime() + 700);

    expect(
      isEvaluationCaughtUp({ latestAt: secondsFromNow(105), signalAt: signal }),
    ).toBe(true);
    expect(
      isEvaluationCaughtUp({ latestAt: secondsFromNow(104), signalAt: signal }),
    ).toBe(false);
    expect(
      isEvaluationCaughtUp({ latestAt: undefined, signalAt: signal }),
    ).toBe(false);
    // Nothing to judge: nothing to wait for.
    expect(
      isEvaluationCaughtUp({ latestAt: undefined, signalAt: undefined }),
    ).toBe(true);
  });
});

describe("useMonitorOverviewData: the evaluation log", () => {
  test("R4 runs after the first commit, again only on a result change, and always on a manual refresh", async () => {
    const monitorDeferred: Deferred<Monitor | null> =
      createDeferred<Monitor | null>();
    getItemSpy.mockImplementationOnce(() => {
      return monitorDeferred.promise;
    });

    const { result } = renderData();
    await flush();
    expect(analyticsGetListSpy).not.toHaveBeenCalled();

    await act(async () => {
      monitorDeferred.resolve(server.monitors[MONITOR_ID.toString()]!);
    });
    await flush();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);

    const request: ListRequest = analyticsGetListSpy.mock
      .calls[0]![0] as ListRequest;
    expect(request.modelType).toBe(MonitorLog);
    expect(request.query).toEqual({
      projectId: PROJECT_ID.toString(),
      monitorId: MONITOR_ID.toString(),
    });
    // Two enabled probes: twice as many rows, so each probe's newest is found.
    expect(request.limit).toBe(4);
    expect(request.select).toEqual({ time: true, logBody: true });
    expect(request.sort).toEqual({ time: SortOrder.Descending });

    expect(result.current.evaluation.status).toBe("loaded");
    expect(
      Object.keys(result.current.evaluation.value!.byProbeId).sort(),
    ).toEqual([PROBE_A, PROBE_B].sort());
    expect(result.current.evaluation.value!.latestAt).toEqual(
      secondsFromNow(-20),
    );

    // Nothing new came in: no second read.
    await poll();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);

    // A new result lands (a claim, then a full read with a newer result).
    server.probes[1]!.lastPingAt = secondsFromNow(100);
    server.probes[1]!.monitoredAt = secondsFromNow(110);
    await poll();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.resultFingerprint).toBe(
      secondsFromNow(110).toISOString(),
    );

    act(() => {
      result.current.refresh();
    });
    await flush();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(3);
  });

  test("never for Manual, where nothing is evaluated", async () => {
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      type: MonitorType.Manual,
    });

    const { result } = await renderLoaded();
    await poll();
    act(() => {
      result.current.refresh();
    });
    await flush();

    expect(analyticsGetListSpy).not.toHaveBeenCalled();
    expect(result.current.evaluation.status).toBe("loaded");
    expect(result.current.evaluation.value).toEqual({ byProbeId: {} });
  });

  test("telemetry monitors re-read the log when the last evaluation moves", async () => {
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      type: MonitorType.Logs,
      overrides: { telemetryMonitorLastMonitorAt: secondsFromNow(-40) },
    });

    await renderLoaded();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);
    expect((analyticsGetListSpy.mock.calls[0]![0] as ListRequest).limit).toBe(
      1,
    );

    await poll();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);

    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      type: MonitorType.Logs,
      overrides: { telemetryMonitorLastMonitorAt: secondsFromNow(20) },
    });
    await poll();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);
  });

  test("network device monitors re-read the log on every fifth poll", async () => {
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      type: MonitorType.NetworkDevice,
    });

    await renderLoaded();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);

    for (let i: number = 0; i < 4; i++) {
      await poll();
    }
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(1);

    await poll();
    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);
  });

  test("a failed evaluation read is an error section, retried on the next poll", async () => {
    server.logError = new Error("Logs are unavailable.");

    const { result } = await renderLoaded();

    expect(result.current.error).toBe("");
    expect(result.current.evaluation.status).toBe("error");
    expect(result.current.evaluation.error).toBe("Logs are unavailable.");

    server.logError = null;
    await poll();

    expect(analyticsGetListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.evaluation.status).toBe("loaded");
  });

  test("a forbidden evaluation log is a forbidden section", async () => {
    // Incident access only: no MonitorLog read.
    permissions = [Permission.IncidentViewer];

    const { result } = await renderLoaded();

    expect(analyticsGetListSpy).not.toHaveBeenCalled();
    expect(result.current.evaluation.status).toBe("forbidden");
    expect(result.current.evaluation.error).toBe(
      MONITOR_OVERVIEW_ACCESS_REASONS.evaluation,
    );
  });
});

describe("useMonitorOverviewData: counters and refreshes", () => {
  test("statusChangeCount bumps on a fingerprint change only", async () => {
    const { result } = await renderLoaded();

    expect(result.current.statusChangeCount).toBe(0);

    await poll();
    expect(result.current.statusChangeCount).toBe(0);

    // The monitor goes offline: a new newest row and a new current status.
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      statusId: OFFLINE_ID,
    });
    server.statusRows = [
      buildStatusRow({
        id: ROW_TWO_ID,
        statusId: OFFLINE_ID,
        startsAt: secondsFromNow(100),
      }),
      buildStatusRow({
        id: ROW_ONE_ID,
        statusId: OPERATIONAL_ID,
        startsAt: secondsFromNow(-3600),
        endsAt: secondsFromNow(100),
      }),
    ];
    await poll();

    expect(result.current.statusChangeCount).toBe(1);
    expect(result.current.statusFingerprint).toBe(
      `${OFFLINE_ID}|${ROW_TWO_ID}|`,
    );

    await poll();
    expect(result.current.statusChangeCount).toBe(1);

    // The newest row closes.
    server.statusRows = [
      buildStatusRow({
        id: ROW_TWO_ID,
        statusId: OFFLINE_ID,
        startsAt: secondsFromNow(100),
        endsAt: secondsFromNow(200),
      }),
    ];
    await poll();

    expect(result.current.statusChangeCount).toBe(2);
  });

  test("manual refresh reads probes in full and bumps manualRefreshCount; details-saved does not", async () => {
    const { result } = await renderLoaded();

    const monitorDeferred: Deferred<Monitor | null> =
      createDeferred<Monitor | null>();
    getItemSpy.mockImplementationOnce(() => {
      return monitorDeferred.promise;
    });

    act(() => {
      result.current.refresh();
    });

    expect(result.current.manualRefreshCount).toBe(1);
    expect(result.current.isRefreshing).toBe(true);
    // A refresh never goes back to the skeleton.
    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.monitor).not.toBeNull();

    await act(async () => {
      monitorDeferred.resolve(server.monitors[MONITOR_ID.toString()]!);
    });
    await flush();

    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.refreshCount).toBe(2);
    expect(probeRequestWeights()).toEqual(["full", "full"]);

    act(() => {
      result.current.refresh({ reason: "details-saved" });
    });
    await flush();

    expect(result.current.manualRefreshCount).toBe(1);
    expect(result.current.refreshCount).toBe(3);
    expect(probeRequestWeights()).toEqual(["full", "full", "full"]);
    expect(apiGetRequests()).toHaveLength(1);
  });

  test("an older generation landing last is ignored", async () => {
    const { result } = await renderLoaded();

    // A manual refresh whose Monitor read is slow...
    const slowRead: Deferred<Monitor | null> = createDeferred<Monitor | null>();
    getItemSpy.mockImplementationOnce(() => {
      return slowRead.promise;
    });
    act(() => {
      result.current.refresh();
    });

    // ...is overtaken by a poll that sees the monitor go offline.
    server.monitors[MONITOR_ID.toString()] = buildMonitor({
      statusId: OFFLINE_ID,
    });
    await poll();

    expect(result.current.monitor?.currentMonitorStatusId?.toString()).toBe(
      OFFLINE_ID,
    );
    const refreshCountAfterPoll: number = result.current.refreshCount;

    // The slow, older answer lands last and must not win.
    await act(async () => {
      slowRead.resolve(buildMonitor({ statusId: OPERATIONAL_ID }));
    });
    await flush();

    expect(result.current.monitor?.currentMonitorStatusId?.toString()).toBe(
      OFFLINE_ID,
    );
    expect(result.current.refreshCount).toBe(refreshCountAfterPoll);
    expect(result.current.isRefreshing).toBe(false);
  });

  test("an id change resets and never leaks the previous monitor", async () => {
    const { result, rerender } = await renderLoaded();

    // A refresh for monitor A that is still in flight when the user leaves.
    const lateA: Deferred<Monitor | null> = createDeferred<Monitor | null>();
    const slowB: Deferred<Monitor | null> = createDeferred<Monitor | null>();
    getItemSpy
      .mockImplementationOnce(() => {
        return lateA.promise;
      })
      .mockImplementationOnce(() => {
        return slowB.promise;
      });

    act(() => {
      result.current.refresh();
    });

    rerender({ monitorId: OTHER_MONITOR_ID });

    // Monitor B: skeleton at once, and nothing of A's.
    expect(result.current.hasLoaded).toBe(false);
    expect(result.current.monitor).toBeNull();
    expect(result.current.probes.status).toBe("loading");
    expect(result.current.probes.value).toBeNull();
    expect(result.current.statusRows.status).toBe("loading");
    expect(result.current.evaluation.status).toBe("loading");
    expect(result.current.statusFingerprint).toBe("");
    expect(result.current.resultFingerprint).toBe("");
    expect(result.current.lastLoadedAt).toBeNull();

    // A's late answer lands on B's page and is dropped.
    await act(async () => {
      lateA.resolve(server.monitors[MONITOR_ID.toString()]!);
    });
    await flush();

    expect(result.current.hasLoaded).toBe(false);
    expect(result.current.monitor).toBeNull();

    await act(async () => {
      slowB.resolve(server.monitors[OTHER_MONITOR_ID.toString()]!);
    });
    await flush();

    expect(result.current.hasLoaded).toBe(true);
    expect(result.current.monitor?._id?.toString()).toBe(
      OTHER_MONITOR_ID.toString(),
    );
    expect(result.current.statusChangeCount).toBe(0);
    expect(result.current.probes.loadedFor).toBe(OTHER_MONITOR_ID.toString());

    // B's first load was a first load: full probes for B.
    const lastProbeRequest: ListRequest = listRequests(MonitorProbe).pop()!;
    expect(lastProbeRequest.query).toEqual({ monitorId: OTHER_MONITOR_ID });
    expect(lastProbeRequest.select).toBe(MONITOR_OVERVIEW_PROBE_FULL_SELECT);
  });
});
