/** @timezone UTC */

import { act, cleanup, renderHook } from "@testing-library/react";
import useMonitorUptimeSummary, {
  MONITOR_UPTIME_ACCESS_REASONS,
  MONITOR_UPTIME_SUMMARY_UNREADABLE_MESSAGE,
  UseMonitorUptimeSummaryResult,
  getServerClockOffsetMs,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/useMonitorUptimeSummary";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  MonitorUptimeSummary,
  MonitorUptimeWindowKey,
} from "../../../Types/Monitor/MonitorUptimeSummary";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import MonitorUptimeSummaryUtil from "../../../Utils/Monitor/MonitorUptimeSummaryUtil";

/*
 * useMonitorUptimeSummary reads the monitor's uptime history from the
 * server aggregate (GET /monitor/uptime-summary/:monitorId) and the
 * incidents to mark on it. It replaced a 10,000-row timeline fetch whose
 * truncation painted the oldest days as 100%, so the tests pin the route,
 * its tenant header and time zone, that an error is never mistaken for a
 * summary, and that it reloads only when the page asks it to.
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
const OPERATIONAL_ID: string = "1b2c3d4e-5f60-4718-8293-a4b5c6d7e8f9";
const INCIDENT_ID: string = "6071a2b3-c4d5-4e6f-8a9b-0c1d2e3f4a5b";

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface ApiGetRequest {
  url: URL;
  headers: Dictionary<string>;
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

function buildSummary(monitorId: ObjectID): MonitorUptimeSummary {
  const startDate: Date = new Date("2026-06-24T00:00:00.000Z");

  return {
    monitorId: monitorId,
    timezone: "UTC",
    generatedAt: NOW,
    startDate: startDate,
    endDate: NOW,
    buckets: [
      {
        bucketStart: new Date("2026-09-21T00:00:00.000Z"),
        bucketEnd: NOW,
        daySeconds: 43200,
        coveredSeconds: 43200,
        statusDurations: [
          { monitorStatusId: new ObjectID(OPERATIONAL_ID), seconds: 43200 },
        ],
      },
    ],
    windows: [
      {
        key: MonitorUptimeWindowKey.Last24Hours,
        startDate: new Date("2026-09-20T12:00:00.000Z"),
        endDate: NOW,
        windowSeconds: 86400,
        coveredSeconds: 86400,
        statusDurations: [
          { monitorStatusId: new ObjectID(OPERATIONAL_ID), seconds: 86400 },
        ],
      },
    ],
    isComplete: true,
    completeFrom: null,
    statuses: [
      {
        id: new ObjectID(OPERATIONAL_ID),
        name: "Operational",
        color: "#10b981",
        isOperationalState: true,
        isOfflineState: false,
        priority: 1,
      },
    ],
  };
}

function okResponse(json: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, json, {});
}

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID;
  incident.title = "Checkout is down";
  incident.declaredAt = new Date("2026-09-20T08:00:00.000Z");

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  severity.color = new Color("#dc2626");
  incident.incidentSeverity = severity;

  const state: IncidentState = new IncidentState();
  state.name = "Investigating";
  incident.currentIncidentState = state;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  incident.monitors = [monitor];

  return incident;
}

let permissions: Array<Permission>;
let apiGetSpy: jest.SpyInstance;
let getListSpy: jest.SpyInstance;

function apiGetRequests(): Array<ApiGetRequest> {
  return apiGetSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as ApiGetRequest;
  });
}

function incidentRequests(): Array<ListRequest> {
  return getListSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest) => {
      return request.modelType === Incident;
    });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 30; i++) {
      await Promise.resolve();
    }
  });
}

type HookProps = { monitorId: ObjectID; refreshKey: string };

type RenderedHook = {
  result: { current: UseMonitorUptimeSummaryResult };
  rerender: (props: HookProps) => void;
};

function renderSummary(props?: Partial<HookProps>): RenderedHook {
  return renderHook(
    (hookProps: HookProps): UseMonitorUptimeSummaryResult => {
      return useMonitorUptimeSummary(hookProps);
    },
    {
      initialProps: {
        monitorId: props?.monitorId || MONITOR_ID,
        refreshKey: props?.refreshKey || "a",
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
  jest
    .spyOn(MonitorUptimeSummaryUtil, "getBrowserTimezone")
    .mockReturnValue("America/New_York");

  apiGetSpy = jest.spyOn(API, "get");
  apiGetSpy.mockImplementation((...args: Array<unknown>): Promise<unknown> => {
    const request: ApiGetRequest = args[0] as ApiGetRequest;
    const monitorId: ObjectID = request.url
      .toString()
      .includes(OTHER_MONITOR_ID.toString())
      ? OTHER_MONITOR_ID
      : MONITOR_ID;

    return Promise.resolve(
      okResponse(MonitorUptimeSummaryUtil.toJSON(buildSummary(monitorId))),
    );
  });

  getListSpy = jest.spyOn(ModelAPI, "getList");
  getListSpy.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      data: [buildIncident()],
      count: 1,
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("useMonitorUptimeSummary", () => {
  test("URL, tenantid and encoded timezone", async () => {
    const { result } = renderSummary();

    expect(result.current.summary.status).toBe("loading");

    await flush();

    expect(apiGetRequests()).toHaveLength(1);

    const request: ApiGetRequest = apiGetRequests()[0]!;
    const url: string = request.url.toString();

    expect(url).toContain(
      `/monitor/uptime-summary/${MONITOR_ID.toString()}?timezone=America%2FNew_York`,
    );
    // Encoded once: the slash must not reach the server as a path separator.
    expect(url).not.toContain("America/New_York");
    expect(url).not.toContain("%252F");
    expect(request.headers["tenantid"]).toBe(PROJECT_ID.toString());

    expect(result.current.summary.status).toBe("loaded");
    expect(result.current.summary.loadedFor).toBe(MONITOR_ID.toString());

    const summary: MonitorUptimeSummary = result.current.summary.value!;
    expect(summary.monitorId.toString()).toBe(MONITOR_ID.toString());
    expect(summary.startDate).toEqual(new Date("2026-06-24T00:00:00.000Z"));
    expect(summary.buckets).toHaveLength(1);
    expect(summary.windows[0]!.key).toBe(MonitorUptimeWindowKey.Last24Hours);
    expect(summary.statuses[0]!.name).toBe("Operational");
  });

  test("the incident overlay covers exactly the summary's window, and maps markers", async () => {
    const { result } = renderSummary();
    await flush();

    expect(incidentRequests()).toHaveLength(1);

    const request: ListRequest = incidentRequests()[0]!;
    expect(request.query["projectId"]).toBe(PROJECT_ID);
    expect((request.query["monitors"] as Includes).values).toEqual([
      MONITOR_ID,
    ]);

    const declaredAt: InBetween<Date> = request.query[
      "declaredAt"
    ] as InBetween<Date>;
    expect(declaredAt).toBeInstanceOf(InBetween);
    expect(declaredAt.startValue).toEqual(new Date("2026-06-24T00:00:00.000Z"));
    expect(declaredAt.endValue).toEqual(NOW);
    // Every list that selects a relation also selects its sort column.
    expect(request.select["declaredAt"]).toBe(true);
    expect(request.sort).toEqual({ declaredAt: SortOrder.Descending });
    expect(request.limit).toBe(LIMIT_PER_PROJECT);

    expect(result.current.incidents.status).toBe("loaded");

    const markers: Array<UptimeBarTooltipIncident> =
      result.current.incidents.value!;
    expect(markers).toHaveLength(1);
    expect(markers[0]!.id).toBe(INCIDENT_ID);
    expect(markers[0]!.title).toBe("Checkout is down");
    expect(markers[0]!.declaredAt).toEqual(
      new Date("2026-09-20T08:00:00.000Z"),
    );
    expect(markers[0]!.incidentSeverity?.name).toBe("Critical");
    expect(markers[0]!.incidentSeverity?.color.toString()).toBe("#dc2626");
    // A state with no colour is drawn black rather than dropped.
    expect(markers[0]!.currentIncidentState?.name).toBe("Investigating");
    expect(markers[0]!.currentIncidentState?.color.toString()).toBe("#000000");
    expect(
      markers[0]!.monitorIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([MONITOR_ID.toString()]);
  });

  test("an HTTPErrorResponse that resolves becomes an error section, not a summary", async () => {
    apiGetSpy.mockImplementation(() => {
      return Promise.resolve(
        new HTTPErrorResponse(
          403,
          {
            message:
              "You do not have permission to read this monitor's status history.",
          },
          {},
        ),
      );
    });

    const { result } = renderSummary();
    await flush();

    expect(result.current.summary.status).toBe("error");
    expect(result.current.summary.value).toBeNull();
    expect(result.current.summary.error).toBe(
      "You do not have permission to read this monitor's status history.",
    );
    // No window, so no markers: and they say so rather than show none.
    expect(incidentRequests()).toHaveLength(0);
    expect(result.current.incidents.status).toBe("error");
  });

  test("a rejected request is an error section too", async () => {
    apiGetSpy.mockImplementation(() => {
      return rejectWith(new Error("Network error."));
    });

    const { result } = renderSummary();
    await flush();

    expect(result.current.summary.status).toBe("error");
    expect(result.current.summary.error).toBe("Network error.");
  });

  test("an unparsable body is an error", async () => {
    apiGetSpy.mockImplementation(() => {
      return Promise.resolve(okResponse({ unexpected: true }));
    });

    const { result } = renderSummary();
    await flush();

    expect(result.current.summary.status).toBe("error");
    expect(result.current.summary.error).toBe(
      MONITOR_UPTIME_SUMMARY_UNREADABLE_MESSAGE,
    );
    expect(MONITOR_UPTIME_SUMMARY_UNREADABLE_MESSAGE).toBe(
      "The uptime summary could not be read.",
    );
  });

  test("reloads only when refreshKey changes, keeping the summary on screen meanwhile", async () => {
    const { result, rerender } = renderSummary({ refreshKey: "a" });
    await flush();

    expect(apiGetRequests()).toHaveLength(1);

    rerender({ monitorId: MONITOR_ID, refreshKey: "a" });
    await flush();
    expect(apiGetRequests()).toHaveLength(1);

    const reload: Deferred<unknown> = createDeferred<unknown>();
    apiGetSpy.mockImplementationOnce(() => {
      return reload.promise;
    });

    rerender({ monitorId: MONITOR_ID, refreshKey: "b" });
    await flush();

    expect(apiGetRequests()).toHaveLength(2);
    // Still the last summary, not a skeleton, while the reload is out.
    expect(result.current.summary.status).toBe("loaded");
    expect(result.current.summary.value).not.toBeNull();

    await act(async () => {
      reload.resolve(
        okResponse(MonitorUptimeSummaryUtil.toJSON(buildSummary(MONITOR_ID))),
      );
    });
    await flush();

    expect(result.current.summary.status).toBe("loaded");
    expect(incidentRequests()).toHaveLength(2);
  });

  test("a failed reload keeps the last summary and records refreshError", async () => {
    const { result, rerender } = renderSummary({ refreshKey: "a" });
    await flush();

    apiGetSpy.mockImplementationOnce(() => {
      return rejectWith(new Error("Network error."));
    });
    rerender({ monitorId: MONITOR_ID, refreshKey: "b" });
    await flush();

    expect(result.current.summary.status).toBe("loaded");
    expect(result.current.summary.value).not.toBeNull();
    expect(result.current.summary.refreshError).toBe("Network error.");
    // The markers that were already loaded stay too.
    expect(result.current.incidents.status).toBe("loaded");
    expect(result.current.incidents.value).toHaveLength(1);
  });

  test("retry reloads after an error, showing the skeleton meanwhile", async () => {
    apiGetSpy.mockImplementationOnce(() => {
      return rejectWith(new Error("Network error."));
    });

    const { result } = renderSummary();
    await flush();

    expect(result.current.summary.status).toBe("error");

    act(() => {
      result.current.retry();
    });

    expect(result.current.summary.status).toBe("loading");

    await flush();

    expect(apiGetRequests()).toHaveLength(2);
    expect(result.current.summary.status).toBe("loaded");
  });

  test("the timeline gate is checked first: a definite denial sends nothing", async () => {
    // ReadProjectMonitor can read the monitor, not its status timeline.
    permissions = [Permission.ReadProjectMonitor];

    const { result } = renderSummary();
    await flush();

    expect(apiGetRequests()).toHaveLength(0);
    expect(incidentRequests()).toHaveLength(0);
    expect(result.current.summary.status).toBe("forbidden");
    expect(result.current.summary.error).toBe(
      MONITOR_UPTIME_ACCESS_REASONS.summary,
    );
    expect(result.current.incidents.status).toBe("forbidden");
  });

  test("the incident overlay is gated and isolated: a MonitorViewer gets the history without markers", async () => {
    permissions = [Permission.MonitorViewer];

    const { result } = renderSummary();
    await flush();

    expect(apiGetRequests()).toHaveLength(1);
    expect(incidentRequests()).toHaveLength(0);
    expect(result.current.summary.status).toBe("loaded");
    expect(result.current.incidents.status).toBe("forbidden");
    expect(result.current.incidents.error).toBe(
      MONITOR_UPTIME_ACCESS_REASONS.incidents,
    );
  });

  test("a failed incident overlay never takes the history down with it", async () => {
    getListSpy.mockImplementation(() => {
      return rejectWith(new Error("Incidents are unavailable."));
    });

    const { result } = renderSummary();
    await flush();

    expect(result.current.summary.status).toBe("loaded");
    expect(result.current.incidents.status).toBe("error");
    expect(result.current.incidents.error).toBe("Incidents are unavailable.");
  });

  test("an empty permission snapshot still asks", async () => {
    permissions = [];

    const { result } = renderSummary();
    await flush();

    expect(apiGetRequests()).toHaveLength(1);
    expect(incidentRequests()).toHaveLength(1);
    expect(result.current.summary.status).toBe("loaded");
  });

  test("a result for another id is ignored", async () => {
    const slowA: Deferred<unknown> = createDeferred<unknown>();
    apiGetSpy.mockImplementationOnce(() => {
      return slowA.promise;
    });

    const { result, rerender } = renderSummary({ monitorId: MONITOR_ID });
    await flush();

    rerender({ monitorId: OTHER_MONITOR_ID, refreshKey: "a" });

    // Monitor B reads as loading, never as A's history.
    expect(result.current.summary.status).toBe("loading");

    await flush();

    expect(result.current.summary.status).toBe("loaded");
    expect(result.current.summary.value!.monitorId.toString()).toBe(
      OTHER_MONITOR_ID.toString(),
    );

    // A's answer arrives last and must not replace B's.
    await act(async () => {
      slowA.resolve(
        okResponse(MonitorUptimeSummaryUtil.toJSON(buildSummary(MONITOR_ID))),
      );
    });
    await flush();

    expect(result.current.summary.loadedFor).toBe(OTHER_MONITOR_ID.toString());
    expect(result.current.summary.value!.monitorId.toString()).toBe(
      OTHER_MONITOR_ID.toString(),
    );
    // Only B's markers were requested after A was abandoned.
    expect(incidentRequests()).toHaveLength(1);
    expect(
      (incidentRequests()[0]!.query["monitors"] as Includes).values,
    ).toEqual([OTHER_MONITOR_ID]);
  });
});

describe("useMonitorUptimeSummary: while the page hides the history", () => {
  type ShownProps = {
    monitorId: ObjectID;
    refreshKey: string;
    isShown: boolean;
  };

  function renderShown(initialProps: ShownProps): {
    result: { current: UseMonitorUptimeSummaryResult };
    rerender: (props: ShownProps) => void;
  } {
    return renderHook(
      (hookProps: ShownProps): UseMonitorUptimeSummaryResult => {
        return useMonitorUptimeSummary(hookProps);
      },
      { initialProps: initialProps },
    );
  }

  test("reads once per monitor, holds reloads back, and reloads once when shown", async () => {
    const { result, rerender } = renderShown({
      monitorId: MONITOR_ID,
      refreshKey: "a",
      isShown: false,
    });
    await flush();

    // The first read is not held back: it stays off the critical path.
    expect(apiGetRequests()).toHaveLength(1);
    expect(incidentRequests()).toHaveLength(1);
    expect(result.current.summary.status).toBe("loaded");

    // Polls and refreshes move the key; nothing is shown, so nothing reloads.
    rerender({ monitorId: MONITOR_ID, refreshKey: "b", isShown: false });
    await flush();
    rerender({ monitorId: MONITOR_ID, refreshKey: "c", isShown: false });
    await flush();

    expect(apiGetRequests()).toHaveLength(1);
    expect(incidentRequests()).toHaveLength(1);

    // The sections appear: one reload, for the key that is current now.
    rerender({ monitorId: MONITOR_ID, refreshKey: "c", isShown: true });
    await flush();

    expect(apiGetRequests()).toHaveLength(2);
    expect(incidentRequests()).toHaveLength(2);

    rerender({ monitorId: MONITOR_ID, refreshKey: "c", isShown: true });
    await flush();
    expect(apiGetRequests()).toHaveLength(2);
  });

  test("hiding the history while its read is out does not drop the answer", async () => {
    const slow: Deferred<unknown> = createDeferred<unknown>();
    apiGetSpy.mockImplementationOnce(() => {
      return slow.promise;
    });

    const { result, rerender } = renderShown({
      monitorId: MONITOR_ID,
      refreshKey: "a",
      isShown: true,
    });
    await flush();

    // The first commit says the monitor is still waiting for data.
    rerender({ monitorId: MONITOR_ID, refreshKey: "a", isShown: false });
    await flush();

    await act(async () => {
      slow.resolve(
        okResponse(MonitorUptimeSummaryUtil.toJSON(buildSummary(MONITOR_ID))),
      );
    });
    await flush();

    expect(apiGetRequests()).toHaveLength(1);
    expect(result.current.summary.status).toBe("loaded");
    expect(incidentRequests()).toHaveLength(1);
  });

  test("another monitor and Try again are still read while hidden", async () => {
    apiGetSpy.mockImplementationOnce(() => {
      return rejectWith(new Error("Network error."));
    });

    const { result, rerender } = renderShown({
      monitorId: MONITOR_ID,
      refreshKey: "a",
      isShown: false,
    });
    await flush();

    expect(result.current.summary.status).toBe("error");

    act(() => {
      result.current.retry();
    });
    await flush();

    expect(apiGetRequests()).toHaveLength(2);
    expect(result.current.summary.status).toBe("loaded");

    rerender({ monitorId: OTHER_MONITOR_ID, refreshKey: "a", isShown: false });
    await flush();

    expect(apiGetRequests()).toHaveLength(3);
    expect(result.current.summary.value!.monitorId.toString()).toBe(
      OTHER_MONITOR_ID.toString(),
    );
  });
});

describe("useMonitorUptimeSummary: the server's clock", () => {
  test("a browser clock seven minutes fast is measured from generatedAt, and reported", async () => {
    // The server stamps NOW; the browser believes it is 12:07.
    jest.setSystemTime(new Date(NOW.getTime() + 7 * 60 * 1000));

    const reported: Array<number> = [];
    const { result } = renderHook((): UseMonitorUptimeSummaryResult => {
      return useMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        refreshKey: "a",
        onServerClockOffset: (offsetMs: number): void => {
          reported.push(offsetMs);
        },
      });
    });

    expect(result.current.serverClockOffsetMs).toBe(0);

    await flush();

    expect(result.current.serverClockOffsetMs).toBe(-7 * 60 * 1000);
    expect(reported).toEqual([-7 * 60 * 1000]);
  });

  test("a clock that agrees within the round trip is left alone", async () => {
    const reported: Array<number> = [];
    const { result } = renderHook((): UseMonitorUptimeSummaryResult => {
      return useMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        refreshKey: "a",
        onServerClockOffset: (offsetMs: number): void => {
          reported.push(offsetMs);
        },
      });
    });
    await flush();

    expect(result.current.serverClockOffsetMs).toBe(0);
    expect(reported).toEqual([0]);
  });

  test("a failed summary measures nothing", async () => {
    jest.setSystemTime(new Date(NOW.getTime() + 7 * 60 * 1000));
    apiGetSpy.mockImplementation(() => {
      return rejectWith(new Error("Network error."));
    });

    const reported: Array<number> = [];
    const { result } = renderHook((): UseMonitorUptimeSummaryResult => {
      return useMonitorUptimeSummary({
        monitorId: MONITOR_ID,
        refreshKey: "a",
        onServerClockOffset: (offsetMs: number): void => {
          reported.push(offsetMs);
        },
      });
    });
    await flush();

    expect(result.current.serverClockOffsetMs).toBe(0);
    expect(reported).toEqual([]);
  });
});

describe("getServerClockOffsetMs", () => {
  const at: (seconds: number) => Date = (seconds: number): Date => {
    return new Date(NOW.getTime() + seconds * 1000);
  };

  test("a server time inside the round trip means the clocks agree", () => {
    for (const serverSeconds of [0, 0.4, 1]) {
      expect(
        getServerClockOffsetMs({
          serverTime: at(serverSeconds),
          sentAt: at(0),
          receivedAt: at(1),
        }),
      ).toBe(0);
    }
  });

  test("a browser running fast is corrected back, by the least that fits", () => {
    // Sent at 12:07:00 and back at 12:07:01 by the browser; stamped 12:00:00.
    expect(
      getServerClockOffsetMs({
        serverTime: at(0),
        sentAt: at(420),
        receivedAt: at(421),
      }),
    ).toBe(-420 * 1000);
  });

  test("a browser running slow is corrected forward, by the least that fits", () => {
    expect(
      getServerClockOffsetMs({
        serverTime: at(300),
        sentAt: at(0),
        receivedAt: at(2),
      }),
    ).toBe(298 * 1000);
  });

  test("an unreadable time measures nothing", () => {
    expect(
      getServerClockOffsetMs({
        serverTime: new Date("not a date"),
        sentAt: at(0),
        receivedAt: at(1),
      }),
    ).toBe(0);
  });
});
