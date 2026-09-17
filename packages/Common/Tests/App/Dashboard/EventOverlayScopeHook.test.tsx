import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import ObjectID from "../../../Types/ObjectID";
import ChartTimeReferenceLineProps from "../../../UI/Components/Charts/Types/TimeReferenceLineProps";
import ProjectUtil from "../../../UI/Utils/Project";
import useEventTimeReferenceLines, {
  EVENT_OVERLAY_FETCH_LIMIT,
  EventTimeReferenceLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines";

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const isPublicDashboardMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext",
  () => {
    return {
      __esModule: true,
      isPublicDashboard: (...args: Array<any>) => {
        return isPublicDashboardMock(...args);
      },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "9e1b6b0e-0000-4000-8000-000000000011",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "9e1b6b0e-0000-4000-8000-000000000012",
);
const MONITOR_A: string = "aaaaaaaa-0000-4000-8000-000000000001";
const MONITOR_B: string = "bbbbbbbb-0000-4000-8000-000000000002";
const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-08-20T10:00:00.000Z"),
  new Date("2026-08-20T11:00:00.000Z"),
);

interface ProbeProps {
  queryConfigs?: Array<MetricQueryConfigData> | undefined;
  enabled?: boolean | undefined;
  window?: InBetween<Date> | null | undefined;
  refreshTick?: number | undefined;
}

interface EventRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, SortOrder>;
}

interface TestEvent {
  id: ObjectID;
  createdAt: string;
  time: string;
  title: string;
  eventType: string;
  monitorId?: string | undefined;
  monitors?: Array<string> | undefined;
}

interface DeferredEvents {
  promise: Promise<{ data: Array<TestEvent> }>;
  resolve: (data: Array<TestEvent>) => void;
}

function Probe(props: ProbeProps): React.ReactElement {
  const { lines, markerCount }: EventTimeReferenceLines =
    useEventTimeReferenceLines({
      enabled: props.enabled ?? true,
      window: props.window === undefined ? WINDOW : props.window,
      queryConfigs: props.queryConfigs,
      refreshTick: props.refreshTick,
    });

  return (
    <div>
      <span data-testid="marker-count">{markerCount}</span>
      {lines.map((line: ChartTimeReferenceLineProps, index: number) => {
        return (
          <div key={index} data-testid="marker" data-kind={line.kind}>
            {line.label}
          </div>
        );
      })}
    </div>
  );
}

function monitorConfig(monitorId: string): MetricQueryConfigData {
  return {
    metricQueryData: {
      filterData: {
        metricName: "oneuptime.monitor.response_time",
        attributes: { monitorId: monitorId },
      },
    },
  };
}

function event(
  title: string,
  number: number = 1,
  monitorId: string = MONITOR_A,
): TestEvent {
  return {
    id: new ObjectID(
      `11111111-0000-4000-8000-${number.toString().padStart(12, "0")}`,
    ),
    createdAt: new Date(
      new Date("2026-08-20T10:00:00.000Z").getTime() + number * 1000,
    ).toISOString(),
    time: new Date(
      new Date("2026-08-20T10:00:00.000Z").getTime() + number * 1000,
    ).toISOString(),
    title: title,
    eventType: "deployment",
    monitorId: monitorId,
    monitors: [monitorId],
  };
}

function deferredEvents(): DeferredEvents {
  let resolveEvents: (data: Array<TestEvent>) => void = (): void => {};
  const promise: Promise<{ data: Array<TestEvent> }> = new Promise(
    (resolve: (result: { data: Array<TestEvent> }) => void): void => {
      resolveEvents = (data: Array<TestEvent>): void => {
        resolve({ data: data });
      };
    },
  );

  return { promise: promise, resolve: resolveEvents };
}

function queryValues(value: unknown): Array<string> {
  if (value instanceof Includes) {
    return value.values.map((item: string | number | ObjectID): string => {
      return item.toString();
    });
  }
  if (value !== null && typeof value === "object" && "_id" in value) {
    return queryValues(value._id);
  }
  return value === undefined ? [] : [String(value)];
}

function requestsFor(modelName: string): Array<EventRequest> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): EventRequest => {
      return call[0] as EventRequest;
    })
    .filter((request: EventRequest): boolean => {
      return request.modelType.name === modelName;
    });
}

async function expectMarkerCount(count: number): Promise<void> {
  await waitFor((): void => {
    expect(screen.getByTestId("marker-count").textContent).toBe(String(count));
  });
}

beforeEach((): void => {
  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  isPublicDashboardMock.mockReset();
  getListMock.mockResolvedValue({ data: [] });
  analyticsGetListMock.mockResolvedValue({ data: [] });
  isPublicDashboardMock.mockReturnValue(false);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("resource-scoped event overlay requests", (): void => {
  test("filters every event source by monitor before the newest-50 limit", async (): Promise<void> => {
    const unrelated: Array<TestEvent> = Array.from(
      { length: EVENT_OVERLAY_FETCH_LIMIT + 10 },
      (_value: unknown, index: number): TestEvent => {
        return event(`Unrelated ${index}`, index + 100, MONITOR_B);
      },
    );
    const related: TestEvent = event("Selected monitor is down");
    const unassociated: TestEvent = {
      ...event("Project-wide event", 90),
      monitorId: undefined,
      monitors: [],
    };
    const records: Array<TestEvent> = [
      ...unrelated,
      related,
      unassociated,
    ].sort((first: TestEvent, second: TestEvent): number => {
      return second.createdAt.localeCompare(first.createdAt);
    });

    /*
     * Behave like the list endpoint: apply the request's filter, then its
     * limit. A project-wide fetch followed by client filtering loses the
     * selected monitor because its record is older than 50 unrelated ones.
     */
    getListMock.mockImplementation((request: EventRequest) => {
      const ids: Array<string> = queryValues(
        request.modelType.name === "Incident"
          ? request.query["monitors"]
          : request.query["monitorId"],
      );
      return Promise.resolve({
        data: records
          .filter((record: TestEvent): boolean => {
            return (
              ids.length === 0 ||
              (request.modelType.name === "Incident"
                ? (record.monitors || []).some((id: string): boolean => {
                    return ids.includes(id);
                  })
                : ids.includes(record.monitorId || ""))
            );
          })
          .slice(request.skip, request.skip + request.limit),
      });
    });
    analyticsGetListMock.mockImplementation((request: EventRequest) => {
      const attributes: Record<string, unknown> | undefined = request.query[
        "attributes"
      ] as Record<string, unknown> | undefined;
      const ids: Array<string> = queryValues(attributes?.["monitorId"]);
      return Promise.resolve({
        data: records
          .filter((record: TestEvent): boolean => {
            return ids.length === 0 || ids.includes(record.monitorId || "");
          })
          .slice(request.skip, request.skip + request.limit),
      });
    });

    render(<Probe queryConfigs={[monitorConfig(MONITOR_A)]} />);

    await expectMarkerCount(3);
    expect(
      screen.getByText("Incident: Selected monitor is down"),
    ).toBeVisible();
    expect(screen.getByText("Alert: Selected monitor is down")).toBeVisible();
    expect(screen.getByText("Deploy: Selected monitor is down")).toBeVisible();
    expect(screen.queryByText(/Unrelated/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Project-wide event/)).not.toBeInTheDocument();

    for (const modelName of ["Incident", "Alert"]) {
      const request: EventRequest = requestsFor(modelName)[0]!;
      expect(request.query["projectId"]).toEqual(PROJECT_ID);
      expect(request.query["createdAt"]).toEqual(WINDOW);
      expect(request.limit).toBe(EVENT_OVERLAY_FETCH_LIMIT);
      expect(request.skip).toBe(0);
      expect(request.sort).toEqual({ createdAt: SortOrder.Descending });
      expect(
        queryValues(
          request.query[modelName === "Incident" ? "monitors" : "monitorId"],
        ),
      ).toEqual([MONITOR_A]);
    }
    expect(requestsFor("Incident")[0]!.query["monitors"]).toEqual({
      _id: MONITOR_A,
    });
    expect(analyticsGetListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: {
          projectId: PROJECT_ID,
          time: WINDOW,
          attributes: { monitorId: MONITOR_A },
        },
        limit: EVENT_OVERLAY_FETCH_LIMIT,
      }),
    );
  });

  test.each([
    ["serviceLevelObjectiveId", "serviceLevelObjectives"],
    ["hostId", "hosts"],
    ["dockerHostId", "dockerHosts"],
    ["podmanHostId", "podmanHosts"],
    ["kubernetesClusterId", "kubernetesClusters"],
    ["kubernetesResourceId", "kubernetesResources"],
    ["kubernetesContainerId", "kubernetesContainers"],
    ["dockerResourceId", "dockerResources"],
    ["podmanResourceId", "podmanResources"],
    ["proxmoxClusterId", "proxmoxClusters"],
    ["vmwareVCenterId", "vmwareVCenters"],
    ["cephClusterId", "cephClusters"],
    ["dockerSwarmClusterId", "dockerSwarmClusters"],
    ["iotFleetId", "iotFleets"],
    ["serviceId", "services"],
  ])(
    "carries %s into every event source's request",
    async (attribute: string, relation: string): Promise<void> => {
      getListMock.mockResolvedValue({ data: [event("Related resource")] });
      analyticsGetListMock.mockResolvedValue({
        data: [event("Related release")],
      });

      render(
        <Probe
          queryConfigs={[
            {
              metricQueryData: {
                filterData: {
                  metricName: "resource.metric",
                  attributes: { [attribute]: MONITOR_A },
                },
              },
            },
          ]}
        />,
      );

      await expectMarkerCount(3);
      for (const modelName of ["Incident", "Alert"]) {
        expect(requestsFor(modelName)).toHaveLength(1);
        expect(requestsFor(modelName)[0]!.query).toEqual({
          projectId: PROJECT_ID,
          createdAt: WINDOW,
          [relation]: { _id: MONITOR_A },
        });
      }
      expect(analyticsGetListMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: PROJECT_ID,
            time: WINDOW,
            ...(attribute === "serviceId"
              ? { primaryEntityId: MONITOR_A }
              : { attributes: { [attribute]: MONITOR_A } }),
          },
        }),
      );
    },
  );

  test.each(["networkDeviceId", "cloudResourceId", "rumApplicationId"])(
    "does not fetch project-wide incidents or alerts for unlinked %s resources",
    async (attribute: string): Promise<void> => {
      analyticsGetListMock.mockResolvedValue({
        data: [event("Scoped change")],
      });
      render(
        <Probe
          queryConfigs={[
            {
              metricQueryData: {
                filterData: {
                  metricName: "resource.metric",
                  attributes: { [attribute]: MONITOR_A },
                },
              },
            },
          ]}
        />,
      );

      await expectMarkerCount(1);
      expect(getListMock).not.toHaveBeenCalled();
      expect(screen.getByText("Deploy: Scoped change")).toBeVisible();
      expect(analyticsGetListMock).toHaveBeenCalledWith(
        expect.objectContaining({
          query: {
            projectId: PROJECT_ID,
            time: WINDOW,
            attributes: { [attribute]: MONITOR_A },
          },
        }),
      );
    },
  );

  test("retains the project overview when no metric scope is supplied", async (): Promise<void> => {
    getListMock.mockImplementation((request: EventRequest) => {
      return Promise.resolve({ data: [event(request.modelType.name)] });
    });
    analyticsGetListMock.mockResolvedValue({ data: [event("Release")] });

    render(<Probe />);

    await expectMarkerCount(3);
    for (const request of [
      ...requestsFor("Incident"),
      ...requestsFor("Alert"),
    ]) {
      expect(request.query).toEqual({
        projectId: PROJECT_ID,
        createdAt: WINDOW,
      });
    }
    expect(analyticsGetListMock).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { projectId: PROJECT_ID, time: WINDOW },
      }),
    );
  });

  test("fetches duplicate chart scopes only once and ignores presentation changes", async (): Promise<void> => {
    getListMock.mockImplementation((request: EventRequest) => {
      return Promise.resolve({ data: [event(request.modelType.name)] });
    });
    const { rerender } = render(
      <Probe
        queryConfigs={[monitorConfig(MONITOR_A), monitorConfig(MONITOR_A)]}
      />,
    );
    await expectMarkerCount(2);
    expect(requestsFor("Incident")).toHaveLength(1);
    expect(requestsFor("Alert")).toHaveLength(1);
    const analyticsCalls: number = analyticsGetListMock.mock.calls.length;

    rerender(
      <Probe
        queryConfigs={[
          {
            ...monitorConfig(MONITOR_A),
            id: "new-chart-identity",
            color: "#123456",
            warningThreshold: 100,
            metricAliasData: {
              metricVariable: "a",
              title: "Renamed chart",
              description: "",
              legend: "",
              legendUnit: "",
            },
          },
        ]}
        window={
          new InBetween<Date>(
            new Date(WINDOW.startValue!),
            new Date(WINDOW.endValue!),
          )
        }
      />,
    );
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(requestsFor("Incident")).toHaveLength(1);
    expect(requestsFor("Alert")).toHaveLength(1);
    expect(analyticsGetListMock.mock.calls.length).toBe(analyticsCalls);
    expect(screen.getByTestId("marker-count").textContent).toBe("2");
  });

  test.each(["Incident", "Alert", "ChangeEvent"])(
    "deduplicates overlapping %s results and keeps the newest 50",
    async (source: string): Promise<void> => {
      const shared: TestEvent = event("Shared event", 1000);
      const fetch: (
        request: EventRequest,
      ) => Promise<{ data: Array<TestEvent> }> = (request: EventRequest) => {
        if (request.modelType.name !== source) {
          return Promise.resolve({ data: [] });
        }
        const monitorQuery: unknown =
          source === "ChangeEvent"
            ? (request.query["attributes"] as Record<string, unknown>)[
                "monitorId"
              ]
            : request.query[source === "Incident" ? "monitors" : "monitorId"];
        const isMonitorA: boolean =
          queryValues(monitorQuery).includes(MONITOR_A);
        return Promise.resolve({
          data: [
            shared,
            ...Array.from(
              { length: EVENT_OVERLAY_FETCH_LIMIT - 1 },
              (_value: unknown, index: number): TestEvent => {
                const number: number = index + (isMonitorA ? 1 : 101);
                return event(`Event ${number}`, number);
              },
            ),
          ],
        });
      };
      getListMock.mockImplementation(fetch);
      analyticsGetListMock.mockImplementation(fetch);

      render(
        <Probe
          queryConfigs={[monitorConfig(MONITOR_A), monitorConfig(MONITOR_B)]}
        />,
      );

      await expectMarkerCount(EVENT_OVERLAY_FETCH_LIMIT);
      const label: string = source === "ChangeEvent" ? "Deploy" : source;
      expect(screen.getAllByText(`${label}: Shared event`)).toHaveLength(1);
      expect(screen.getByText(`${label}: Event 149`)).toBeVisible();
      expect(screen.queryByText(`${label}: Event 1`)).not.toBeInTheDocument();
      const requests: Array<EventRequest> =
        source === "ChangeEvent"
          ? analyticsGetListMock.mock.calls.map(
              (call: Array<unknown>): EventRequest => {
                return call[0] as EventRequest;
              },
            )
          : requestsFor(source);
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.limit).toBe(EVENT_OVERLAY_FETCH_LIMIT);
      }
    },
  );

  test("changing the order of chart scopes does not issue new requests", async (): Promise<void> => {
    getListMock.mockImplementation((request: EventRequest) => {
      return Promise.resolve({ data: [event(request.modelType.name)] });
    });
    const { rerender } = render(
      <Probe
        queryConfigs={[monitorConfig(MONITOR_A), monitorConfig(MONITOR_B)]}
      />,
    );
    await expectMarkerCount(2);
    const calls: number = getListMock.mock.calls.length;
    const analyticsCalls: number = analyticsGetListMock.mock.calls.length;

    rerender(
      <Probe
        queryConfigs={[monitorConfig(MONITOR_B), monitorConfig(MONITOR_A)]}
      />,
    );
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(getListMock.mock.calls.length).toBe(calls);
    expect(analyticsGetListMock.mock.calls.length).toBe(analyticsCalls);
  });
});

describe("resource-scoped event overlay lifecycle", (): void => {
  test("an invalid resource scope clears previous markers and never falls back to the project", async (): Promise<void> => {
    getListMock.mockResolvedValue({ data: [event("Valid monitor")] });
    const { rerender } = render(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} />,
    );
    await expectMarkerCount(2);
    const calls: number = getListMock.mock.calls.length;
    const analyticsCalls: number = analyticsGetListMock.mock.calls.length;

    rerender(<Probe queryConfigs={[monitorConfig("invalid-monitor-id")]} />);

    expect(screen.getByTestId("marker-count").textContent).toBe("0");
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    expect(getListMock.mock.calls.length).toBe(calls);
    expect(analyticsGetListMock.mock.calls.length).toBe(analyticsCalls);
  });

  test("clears the previous resource while its replacement request is loading", async (): Promise<void> => {
    const next: DeferredEvents = deferredEvents();
    getListMock.mockImplementation((request: EventRequest) => {
      if (request.modelType.name !== "Incident") {
        return Promise.resolve({ data: [] });
      }
      return queryValues(request.query["monitors"]).includes(MONITOR_A)
        ? Promise.resolve({ data: [event("Monitor A")] })
        : next.promise;
    });
    const { rerender } = render(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} />,
    );
    await expectMarkerCount(1);

    rerender(<Probe queryConfigs={[monitorConfig(MONITOR_B)]} />);

    expect(screen.getByTestId("marker-count").textContent).toBe("0");
    expect(screen.queryByText("Incident: Monitor A")).not.toBeInTheDocument();
    await act(async (): Promise<void> => {
      next.resolve([event("Monitor B", 2, MONITOR_B)]);
      await next.promise;
    });
    await expectMarkerCount(1);
    expect(screen.getByText("Incident: Monitor B")).toBeVisible();
  });

  test("an older resource response cannot overwrite the current resource", async (): Promise<void> => {
    const first: DeferredEvents = deferredEvents();
    const second: DeferredEvents = deferredEvents();
    getListMock.mockImplementation((request: EventRequest) => {
      if (request.modelType.name !== "Incident") {
        return Promise.resolve({ data: [] });
      }
      return queryValues(request.query["monitors"]).includes(MONITOR_A)
        ? first.promise
        : second.promise;
    });
    const { rerender } = render(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} />,
    );
    rerender(<Probe queryConfigs={[monitorConfig(MONITOR_B)]} />);

    await act(async (): Promise<void> => {
      second.resolve([event("Current monitor", 2, MONITOR_B)]);
      await second.promise;
    });
    await expectMarkerCount(1);
    await act(async (): Promise<void> => {
      first.resolve([event("Stale monitor")]);
      await first.promise;
    });

    expect(screen.getByText("Incident: Current monitor")).toBeVisible();
    expect(
      screen.queryByText("Incident: Stale monitor"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("marker-count").textContent).toBe("1");
  });

  test("switching project refetches and immediately removes the old project markers", async (): Promise<void> => {
    const nextProject: DeferredEvents = deferredEvents();
    getListMock.mockImplementation((request: EventRequest) => {
      if (request.modelType.name !== "Incident") {
        return Promise.resolve({ data: [] });
      }
      return String(request.query["projectId"]) === PROJECT_ID.toString()
        ? Promise.resolve({ data: [event("Old project")] })
        : nextProject.promise;
    });
    const { rerender } = render(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} />,
    );
    await expectMarkerCount(1);

    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(OTHER_PROJECT_ID);
    rerender(<Probe queryConfigs={[monitorConfig(MONITOR_A)]} />);

    expect(screen.getByTestId("marker-count").textContent).toBe("0");
    expect(requestsFor("Incident")).toHaveLength(2);
    expect(requestsFor("Incident")[1]!.query["projectId"]).toEqual(
      OTHER_PROJECT_ID,
    );
    await act(async (): Promise<void> => {
      nextProject.resolve([event("New project")]);
      await nextProject.promise;
    });
    await expectMarkerCount(1);
    expect(screen.getByText("Incident: New project")).toBeVisible();
    expect(screen.queryByText("Incident: Old project")).not.toBeInTheDocument();
  });

  test("an equivalent project ID object does not trigger another fetch", async (): Promise<void> => {
    getListMock.mockImplementation((request: EventRequest) => {
      return Promise.resolve({ data: [event(request.modelType.name)] });
    });
    const { rerender } = render(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} />,
    );
    await expectMarkerCount(2);
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID.toString()));

    rerender(<Probe queryConfigs={[monitorConfig(MONITOR_A)]} />);
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });

    expect(requestsFor("Incident")).toHaveLength(1);
    expect(requestsFor("Alert")).toHaveLength(1);
  });

  test("refresh refetches the same scope and ignores an earlier unfinished refresh", async (): Promise<void> => {
    const earlierRefresh: DeferredEvents = deferredEvents();
    const latestRefresh: DeferredEvents = deferredEvents();
    let incidentCalls: number = 0;
    getListMock.mockImplementation((request: EventRequest) => {
      if (request.modelType.name !== "Incident") {
        return Promise.resolve({ data: [] });
      }
      incidentCalls++;
      if (incidentCalls === 1) {
        return Promise.resolve({ data: [event("Initial result")] });
      }
      return incidentCalls === 2
        ? earlierRefresh.promise
        : latestRefresh.promise;
    });
    const { rerender } = render(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} refreshTick={0} />,
    );
    await expectMarkerCount(1);

    rerender(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} refreshTick={1} />,
    );
    rerender(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} refreshTick={2} />,
    );
    expect(incidentCalls).toBe(3);
    await act(async (): Promise<void> => {
      latestRefresh.resolve([event("Latest refresh")]);
      await latestRefresh.promise;
    });
    await expectMarkerCount(1);
    await act(async (): Promise<void> => {
      earlierRefresh.resolve([event("Earlier refresh")]);
      await earlierRefresh.promise;
    });

    expect(screen.getByText("Incident: Latest refresh")).toBeVisible();
    expect(
      screen.queryByText("Incident: Earlier refresh"),
    ).not.toBeInTheDocument();
  });

  test("a different time window hides old markers and constrains every new request", async (): Promise<void> => {
    getListMock.mockImplementation((request: EventRequest) => {
      return Promise.resolve({ data: [event(request.modelType.name)] });
    });
    const { rerender } = render(<Probe />);
    await expectMarkerCount(2);
    const next: DeferredEvents = deferredEvents();
    getListMock.mockReturnValue(next.promise);
    analyticsGetListMock.mockReturnValue(next.promise);
    const nextWindow: InBetween<Date> = new InBetween<Date>(
      new Date("2026-08-21T10:00:00.000Z"),
      new Date("2026-08-21T11:00:00.000Z"),
    );

    rerender(<Probe window={nextWindow} />);

    expect(screen.getByTestId("marker-count").textContent).toBe("0");
    expect(requestsFor("Incident")[1]!.query["createdAt"]).toEqual(nextWindow);
    expect(requestsFor("Alert")[1]!.query["createdAt"]).toEqual(nextWindow);
    expect(analyticsGetListMock.mock.calls[1]![0].query["time"]).toEqual(
      nextWindow,
    );
    await act(async (): Promise<void> => {
      next.resolve([]);
      await next.promise;
    });
  });

  test.each(["disabled", "public", "windowless", "projectless"])(
    "%s charts do not fetch scoped event data",
    async (state: string): Promise<void> => {
      if (state === "public") {
        isPublicDashboardMock.mockReturnValue(true);
      }
      if (state === "projectless") {
        jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
      }
      render(
        <Probe
          queryConfigs={[monitorConfig(MONITOR_A)]}
          enabled={state !== "disabled"}
          window={state === "windowless" ? null : WINDOW}
        />,
      );
      await act(async (): Promise<void> => {
        await Promise.resolve();
      });

      expect(getListMock).not.toHaveBeenCalled();
      expect(analyticsGetListMock).not.toHaveBeenCalled();
      expect(screen.getByTestId("marker-count").textContent).toBe("0");
    },
  );

  test.each(["disabled", "public", "windowless", "projectless"])(
    "entering the %s state removes existing markers without another request",
    async (state: string): Promise<void> => {
      getListMock.mockImplementation((request: EventRequest) => {
        return Promise.resolve({ data: [event(request.modelType.name)] });
      });
      const { rerender } = render(
        <Probe queryConfigs={[monitorConfig(MONITOR_A)]} />,
      );
      await expectMarkerCount(2);
      const calls: number = getListMock.mock.calls.length;
      const analyticsCalls: number = analyticsGetListMock.mock.calls.length;
      if (state === "public") {
        isPublicDashboardMock.mockReturnValue(true);
      }
      if (state === "projectless") {
        jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(null);
      }

      rerender(
        <Probe
          queryConfigs={[monitorConfig(MONITOR_A)]}
          enabled={state !== "disabled"}
          window={state === "windowless" ? null : WINDOW}
        />,
      );

      expect(screen.getByTestId("marker-count").textContent).toBe("0");
      expect(getListMock.mock.calls.length).toBe(calls);
      expect(analyticsGetListMock.mock.calls.length).toBe(analyticsCalls);
    },
  );

  test("a request that resolves after disabling cannot reappear on re-enabling", async (): Promise<void> => {
    const old: DeferredEvents = deferredEvents();
    const current: DeferredEvents = deferredEvents();
    let incidentCalls: number = 0;
    getListMock.mockImplementation((request: EventRequest) => {
      if (request.modelType.name !== "Incident") {
        return Promise.resolve({ data: [] });
      }
      incidentCalls++;
      return incidentCalls === 1 ? old.promise : current.promise;
    });
    const { rerender } = render(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} />,
    );
    rerender(
      <Probe queryConfigs={[monitorConfig(MONITOR_A)]} enabled={false} />,
    );
    await act(async (): Promise<void> => {
      old.resolve([event("Cancelled result")]);
      await old.promise;
    });
    rerender(<Probe queryConfigs={[monitorConfig(MONITOR_A)]} />);

    expect(screen.getByTestId("marker-count").textContent).toBe("0");
    await act(async (): Promise<void> => {
      current.resolve([event("Fresh result")]);
      await current.promise;
    });
    await expectMarkerCount(1);
    expect(screen.getByText("Incident: Fresh result")).toBeVisible();
    expect(
      screen.queryByText("Incident: Cancelled result"),
    ).not.toBeInTheDocument();
  });

  test("an individual scope failure preserves another scope's incidents and alerts", async (): Promise<void> => {
    getListMock.mockImplementation((request: EventRequest) => {
      const monitorIds: Array<string> = queryValues(
        request.query[
          request.modelType.name === "Incident" ? "monitors" : "monitorId"
        ],
      );
      if (monitorIds.includes(MONITOR_A)) {
        return Promise.reject(
          new Error("First monitor is temporarily unavailable"),
        );
      }
      return Promise.resolve({ data: [event("Other monitor", 2, MONITOR_B)] });
    });
    render(
      <Probe
        queryConfigs={[monitorConfig(MONITOR_A), monitorConfig(MONITOR_B)]}
      />,
    );

    await expectMarkerCount(2);
    expect(screen.getByText("Incident: Other monitor")).toBeVisible();
    expect(screen.getByText("Alert: Other monitor")).toBeVisible();
  });
});
