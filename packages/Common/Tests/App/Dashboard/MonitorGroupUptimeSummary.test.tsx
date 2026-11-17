import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A MONITOR GROUP'S UPTIME GRAPH, FROM THE SERVER'S DAYS (issue #6886).
 *
 * The Dashboard's monitor group page drew its Uptime Graph and its 90-day
 * percentage from the group's timeline rows, which arrive under a 10,000
 * row cap, oldest first: a group with more status changes than that in 90
 * days - one flapping monitor is enough - drew its newest days as no data
 * and measured its percentage over its oldest days only. It now draws both
 * from the group's days as the server measures them from every row
 * (GET /monitor-group/uptime-summary/:monitorGroupId), cut in the user's
 * zone, and reads the rows only when the server cannot answer.
 *
 * The page is the real one; the API, the details card (drawn as its fields)
 * and the permission gate are stubbed.
 */

const mockGetList: MockFunction = getJestMockFunction();
const mockCount: MockFunction = getJestMockFunction();
const mockPost: MockFunction = getJestMockFunction();
const mockMonitoringSummary: MockFunction = getJestMockFunction();
const mockSetMonitoring: MockFunction = getJestMockFunction();
const mockUptimeSummary: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return mockGetList(...args);
      },
      count: (...args: Array<unknown>): unknown => {
        return mockCount(...args);
      },
      post: (...args: Array<unknown>): unknown => {
        return mockPost(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringAPI",
  () => {
    return {
      __esModule: true,
      fetchMonitorGroupMonitoringSummary: (
        ...args: Array<unknown>
      ): unknown => {
        return mockMonitoringSummary(...args);
      },
      setMonitorGroupMonitoring: (...args: Array<unknown>): unknown => {
        return mockSetMonitoring(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupUptimeSummaryAPI",
  () => {
    return {
      __esModule: true,
      fetchMonitorGroupUptimeSummary: (...args: Array<unknown>): unknown => {
        return mockUptimeSummary(...args);
      },
    };
  },
);

interface MockDetailField {
  title?: string;
  getElement?: (item: unknown) => ReactElement;
}

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: {
      modelDetailProps: { fields: Array<MockDetailField> };
    }): ReactElement => {
      return (
        <div data-testid="group-details">
          {props.modelDetailProps.fields.map(
            (field: MockDetailField, index: number): ReactElement => {
              return (
                <div key={index} data-testid={`detail-${field.title}`}>
                  {field.getElement ? field.getElement({}) : null}
                </div>
              );
            },
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDClass: new (id: string) => unknown = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          }
        ).default;
        return new ObjectIDClass("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import { MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/MonitorGroup/MonitorGroupMonitoringCopy";
import MonitorGroupView from "../../../../App/FeatureSet/Dashboard/src/Pages/MonitorGroup/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import { MonitorGroupUptimeSummary } from "../../../Types/Monitor/MonitorGroupUptimeSummary";
import ObjectID from "../../../Types/ObjectID";
import { UptimeDayBucket } from "../../../Types/StatusPage/UptimeDailyAggregate";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { MonitorGroupMonitoringSummary } from "../../../Utils/Monitor/MonitorGroupMonitoring";
import { NO_DATA_BAR_CLASS_NAME } from "../../../Utils/StatusPage/HistoryChartBarColors";

const GROUP_ID: string = "6a6a6a6a-6a6a-4a6a-8a6a-6a6a6a6a6a6a";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/monitor-groups/view"),
  currentProject: null,
  hasPaymentMethod: true,
};

const DAY_MS: number = 24 * 60 * 60 * 1000;

function status(
  id: string,
  name: string,
  color: string,
  operational: boolean,
): MonitorStatus {
  const item: MonitorStatus = new MonitorStatus();
  item._id = id;
  item.name = name;
  item.color = new Color(color);
  item.isOperationalState = operational;
  item.priority = operational ? 1 : 3;
  return item;
}

const OPERATIONAL: MonitorStatus = status(
  "68860000-0000-4000-8000-000000000001",
  "Operational",
  "#10b981",
  true,
);
const OFFLINE: MonitorStatus = status(
  "68860000-0000-4000-8000-000000000003",
  "Offline",
  "#ef4444",
  false,
);

/*
 * The server's 90 days of the group, in UTC: up every day, an hour Offline
 * on the newest day - the day a capped, oldest-first read of the rows
 * loses first - and no data on the first ten, before its monitors were
 * checked.
 */
function serverSummary(data?: {
  isNothingMeasured?: boolean | undefined;
}): MonitorGroupUptimeSummary {
  const now: Date = OneUptimeDate.getCurrentDate();
  const today: Date = OneUptimeDate.getStartOfDay(now, "UTC");
  const startDate: Date = new Date(today.getTime() - 89 * DAY_MS);
  const buckets: Array<UptimeDayBucket> = [];

  for (let day: number = 0; day < 90; day++) {
    const bucketStart: Date = new Date(startDate.getTime() + day * DAY_MS);
    const bucketEnd: Date =
      day === 89 ? now : new Date(bucketStart.getTime() + DAY_MS);
    const daySeconds: number =
      (bucketEnd.getTime() - bucketStart.getTime()) / 1000;
    const isMeasured: boolean = !data?.isNothingMeasured && day >= 10;
    const offline: number = isMeasured && day === 89 ? 3600 : 0;

    buckets.push({
      bucketStart: bucketStart,
      bucketEnd: bucketEnd,
      daySeconds: daySeconds,
      coveredSeconds: isMeasured ? daySeconds : 0,
      statusDurations: isMeasured
        ? [
            {
              monitorStatusId: OPERATIONAL.id!,
              seconds: daySeconds - offline,
            },
            ...(offline > 0
              ? [{ monitorStatusId: OFFLINE.id!, seconds: offline }]
              : []),
          ]
        : [],
    });
  }

  const coveredSeconds: number = buckets.reduce(
    (sum: number, bucket: UptimeDayBucket) => {
      return sum + bucket.coveredSeconds;
    },
    0,
  );

  return {
    monitorGroupId: new ObjectID(GROUP_ID),
    timezone: "UTC",
    generatedAt: now,
    startDate: startDate,
    endDate: now,
    buckets: buckets,
    coveredSeconds: coveredSeconds,
    downtimeSeconds: coveredSeconds > 0 ? 3600 : 0,
  };
}

let uptimeSummary: MonitorGroupUptimeSummary | null = null;
let monitoringSummary: MonitorGroupMonitoringSummary = {
  monitorCount: 2,
  monitoringOffCount: 0,
};

function timelineReads(): number {
  return mockGetList.mock.calls.filter((call: Array<unknown>): boolean => {
    return (
      (call[0] as { modelType: unknown }).modelType === MonitorStatusTimeline
    );
  }).length;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(new Date("2026-09-21T12:00:00.000Z"));

  uptimeSummary = serverSummary();
  monitoringSummary = { monitorCount: 2, monitoringOffCount: 0 };

  mockGetList.mockReset();
  mockGetList.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };
    const data: Array<unknown> =
      request.modelType === MonitorStatus ? [OPERATIONAL, OFFLINE] : [];
    return { data, count: data.length, skip: 0, limit: 10 };
  });

  mockCount.mockReset();
  mockCount.mockImplementation(async () => {
    return 2;
  });

  mockPost.mockReset();
  mockPost.mockImplementation(async () => {
    return OPERATIONAL;
  });

  mockMonitoringSummary.mockReset();
  mockMonitoringSummary.mockImplementation(async () => {
    return monitoringSummary;
  });

  mockSetMonitoring.mockReset();

  mockUptimeSummary.mockReset();
  mockUptimeSummary.mockImplementation(async () => {
    return uptimeSummary;
  });

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(GROUP_ID));
  jest.spyOn(PermissionGate, "check").mockReturnValue({
    isAllowed: true,
  } as PermissionGateResult);
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockReturnValue({
    isAllowed: true,
  } as PermissionGateResult);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <MonitorGroupView {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await screen.findByTestId("group-details");
  await flush();
}

function bars(): Array<HTMLElement> {
  return within(screen.getByTestId("day-uptime-graph")).getAllByTestId(
    "uptime-bar",
  );
}

function uptimePercent(): HTMLElement | null {
  return screen.queryByTestId("monitor-group-uptime-percent");
}

describe("the monitor group page draws its Uptime Graph from the server's days (issue #6886)", () => {
  test("asks for this group's days in the zone the user reads times in, and reads no rows", async () => {
    await renderOverview();

    expect(mockUptimeSummary).toHaveBeenCalledTimes(1);

    const request: { monitorGroupId: ObjectID; timezone: string } =
      mockUptimeSummary.mock.calls[0]![0] as {
        monitorGroupId: ObjectID;
        timezone: string;
      };

    expect(request.monitorGroupId.toString()).toBe(GROUP_ID);
    expect(request.timezone).toBe(OneUptimeDate.getCurrentTimezone());
    // The capped rows are no longer read at all.
    expect(timelineReads()).toBe(0);
  });

  test("ninety bars, the newest day painted with the hour it was down", async () => {
    await renderOverview();

    const strip: Array<HTMLElement> = bars();

    expect(strip).toHaveLength(90);

    const today: HTMLElement = strip[strip.length - 1]!;

    expect(today).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(today.getAttribute("aria-label")).toMatch(/^Sep 21, 2026: /);
    expect(today.getAttribute("aria-label")).not.toContain("no data");
    expect(today.getAttribute("aria-label")).not.toContain("100% uptime");

    // The days before its monitors were first checked: no data, not up.
    expect(strip[0]).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(strip[9]).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    expect(strip[10]).not.toHaveClass(NO_DATA_BAR_CLASS_NAME);
  });

  test("its percentage is the server's, over every day it measured", async () => {
    await renderOverview();

    const summary: MonitorGroupUptimeSummary = serverSummary();
    const expected: number =
      Math.floor(
        ((summary.coveredSeconds - 3600) / summary.coveredSeconds) * 100 * 1000,
      ) / 1000;

    expect(uptimePercent()).toHaveTextContent(`${expected}% uptime`);
    expect(expected).toBeLessThan(100);
  });

  test("a group nothing was measured for has no percentage, not 100%", async () => {
    uptimeSummary = serverSummary({ isNothingMeasured: true });

    await renderOverview();

    expect(screen.getByText("Uptime Graph")).toBeVisible();
    expect(uptimePercent()).toBeNull();
    expect(screen.queryByText(/100% uptime/)).toBeNull();

    for (const bar of bars()) {
      expect(bar).toHaveClass(NO_DATA_BAR_CLASS_NAME);
    }
  });

  test("monitoring turned back on from the card reads the group's days again", async () => {
    monitoringSummary = { monitorCount: 2, monitoringOffCount: 2 };
    mockSetMonitoring.mockResolvedValue({
      monitorCount: 2,
      monitoringOffCount: 0,
    } as never);

    await renderOverview();
    expect(mockUptimeSummary).toHaveBeenCalledTimes(1);

    act(() => {
      screen.getByTestId(MONITOR_GROUP_TURN_MONITORING_ON_TEST_ID).click();
    });
    await flush();

    expect(mockUptimeSummary).toHaveBeenCalledTimes(2);
    expect(timelineReads()).toBe(0);
  });

  test("a server that cannot answer: the page draws from the group's rows, as before", async () => {
    uptimeSummary = null;

    await renderOverview();

    expect(timelineReads()).toBe(1);
    expect(screen.getByTestId("day-uptime-graph")).toBeInTheDocument();
  });
});
