import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import type ChartTimeReferenceLineProps from "../../../UI/Components/Charts/Types/TimeReferenceLineProps";

/*
 * Issue #4472, on the page the customer recorded: Metrics, then a metric,
 * opens the Metric Explorer with Events on. Its markers used to be every
 * incident and alert in the project - a vendor status page monitor's outage
 * drawn on a container's CPU chart - and the Events badge counted them.
 *
 * The explorer is rendered for real, with the real MetricView and the real
 * event-marker hook, opened from the URL the Metrics list builds. Only the
 * data layer and the heavyweight children are replaced: the list endpoint
 * behaves like the real one (it applies the request's filter, then its
 * limit), and MetricCharts draws the markers it is handed.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

// The event-marker hook's incident and alert fetches.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return modelGetListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

// The event-marker hook's change-event fetch.
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

// The chart, reduced to the markers MetricView hands it.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    const react: typeof React = jest.requireActual("react") as typeof React;
    return {
      __esModule: true,
      default: (props: {
        timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
      }): React.ReactElement => {
        return react.createElement(
          "div",
          { "data-testid": "metric-charts" },
          (props.timeReferenceLines || []).map(
            (line: ChartTimeReferenceLineProps, index: number) => {
              return react.createElement(
                "div",
                { key: index, "data-testid": "chart-marker" },
                line.label,
              );
            },
          ),
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricFormulaConfig",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/AddToDashboardModal",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/InvestigationDrawer",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import MetricExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricExplorer";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import TimeRange from "../../../Types/Time/TimeRange";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-0000-4000-8000-000000000001",
);

const CHARTED_METRIC: string = "container_cpu_cfs_periods_total";

interface ListRequest {
  modelType: { name: string };
  query: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface StoredEvent {
  id: ObjectID;
  title: string;
  createdAt: string;
  // What the firing monitor's queries read; absent when no metric fired it.
  metricNames?: Array<string> | undefined;
  // The hosts the event is linked to.
  hostIdentifiers?: Array<string> | undefined;
}

interface ContainmentValue {
  metricViewData?: {
    queryConfigs?: Array<{
      metricQueryData?: { filterData?: { metricName?: string } };
    }>;
  };
}

let eventNumber: number = 0;

function storedEvent(
  title: string,
  links: {
    metricNames?: Array<string> | undefined;
    hostIdentifiers?: Array<string> | undefined;
  } = {},
): StoredEvent {
  eventNumber++;
  return {
    id: new ObjectID(
      `22222222-0000-4000-8000-${eventNumber.toString().padStart(12, "0")}`,
    ),
    title: title,
    createdAt: new Date(Date.now() - eventNumber * 60 * 1000).toISOString(),
    metricNames: links.metricNames,
    hostIdentifiers: links.hostIdentifiers,
  };
}

/*
 * Incidents and alerts as the list endpoint returns them: the request's
 * filter applied, then its limit. A request with no filter is the project.
 */
function serve(records: Array<StoredEvent>): void {
  modelGetListMock.mockImplementation((request: ListRequest) => {
    const containment: ContainmentValue | undefined = request.query[
      "telemetryQuery"
    ] as ContainmentValue | undefined;
    const metricName: string | undefined =
      containment?.metricViewData?.queryConfigs?.[0]?.metricQueryData
        ?.filterData?.metricName;
    const host: { hostIdentifier?: string } | undefined = request.query[
      "hosts"
    ] as { hostIdentifier?: string } | undefined;

    return Promise.resolve({
      data: records
        .filter((record: StoredEvent): boolean => {
          if (host) {
            return (record.hostIdentifiers || []).includes(
              host.hostIdentifier || "",
            );
          }
          if (metricName !== undefined) {
            return (record.metricNames || []).includes(metricName);
          }
          return true;
        })
        .slice(request.skip, request.skip + request.limit),
      count: 0,
      skip: 0,
      limit: 0,
    });
  });
}

function requestsFor(modelName: string): Array<ListRequest> {
  return modelGetListMock.mock.calls
    .map((call: Array<unknown>): ListRequest => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType.name === modelName;
    });
}

// The explorer URL MetricsViewer's row click builds (handleRowClick).
async function openFromMetricsList(
  query: Record<string, unknown>,
): Promise<void> {
  const end: Date = new Date();
  const start: Date = new Date(end.getTime() - 60 * 60 * 1000);
  const params: URLSearchParams = new URLSearchParams({
    metricQueries: JSON.stringify([
      { aggregationType: MetricsAggregationType.Avg, ...query },
    ]),
    startTime: OneUptimeDate.toString(start),
    endTime: OneUptimeDate.toString(end),
    range: TimeRange.PAST_ONE_HOUR,
  });
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/metrics/view?${params.toString()}`,
  );

  await act(async () => {
    render(<MetricExplorer />);
  });
  await waitFor(() => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
}

function eventsToggle(): HTMLElement {
  return screen.getByRole("button", {
    name: "Toggle incident and alert markers",
  });
}

function drawnMarkers(): Array<string> {
  return screen
    .queryAllByTestId("chart-marker")
    .map((marker: HTMLElement): string => {
      return marker.textContent || "";
    })
    .sort();
}

const STATUS_PAGE_OUTAGES: Array<string> = [
  "Claude | Official status reports incident or outage",
  "FreedomPay | Official vendor status has an active incident or outage",
];

beforeEach(() => {
  eventNumber = 0;
  window.localStorage.clear();
  fetchResultsMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
  modelGetListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("Metric Explorer event markers", () => {
  test("a metric opened from the Metrics list draws what was raised on it, never a status page's outage", async () => {
    serve([
      ...STATUS_PAGE_OUTAGES.map((title: string): StoredEvent => {
        return storedEvent(title);
      }),
      storedEvent("Website is down"),
      storedEvent("Container CPU throttled", {
        metricNames: [CHARTED_METRIC],
      }),
      storedEvent("Node memory pressure", {
        metricNames: ["container_memory_working_set_bytes"],
      }),
    ]);
    analyticsGetListMock.mockResolvedValue({
      data: [
        {
          time: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
          title: "v2.31.0",
          eventType: "deployment",
        },
      ],
      count: 0,
      skip: 0,
      limit: 0,
    });

    await openFromMetricsList({ metricName: CHARTED_METRIC });

    await waitFor(() => {
      expect(drawnMarkers()).toEqual([
        "Alert: Container CPU throttled",
        "Deploy: v2.31.0",
        "Incident: Container CPU throttled",
      ]);
    });
    expect(within(eventsToggle()).getByText("3")).toBeInTheDocument();
    for (const title of [
      ...STATUS_PAGE_OUTAGES,
      "Website is down",
      "Node memory pressure",
    ]) {
      expect(document.body.textContent).not.toContain(title);
    }

    for (const modelName of ["Incident", "Alert"]) {
      expect(requestsFor(modelName)).toHaveLength(1);
      expect(requestsFor(modelName)[0]!.query["telemetryQuery"]).toEqual({
        metricViewData: {
          queryConfigs: [
            { metricQueryData: { filterData: { metricName: CHARTED_METRIC } } },
          ],
        },
      });
      expect(requestsFor(modelName)[0]!.query["projectId"]).toEqual(PROJECT_ID);
    }
  });

  test("a metric nothing was raised on draws no incident or alert and counts none", async () => {
    serve(
      STATUS_PAGE_OUTAGES.map((title: string): StoredEvent => {
        return storedEvent(title);
      }),
    );

    await openFromMetricsList({ metricName: CHARTED_METRIC });

    await waitFor(() => {
      expect(requestsFor("Incident")).toHaveLength(1);
      expect(requestsFor("Alert")).toHaveLength(1);
    });
    // Both list calls have answered; let the hook settle on their result.
    await act(async () => {
      await Promise.resolve();
    });

    expect(drawnMarkers()).toEqual([]);
    expect(eventsToggle().textContent).toBe("Events");
  });

  test("a metric opened from a host's Metrics tab draws that host's events", async () => {
    serve([
      ...STATUS_PAGE_OUTAGES.map((title: string): StoredEvent => {
        return storedEvent(title);
      }),
      storedEvent("web-1 is unreachable", { hostIdentifiers: ["web-1"] }),
      storedEvent("web-2 disk is full", { hostIdentifiers: ["web-2"] }),
    ]);

    // Host/View/Metrics scopes its list, and the row click carries it along.
    await openFromMetricsList({
      metricName: "system.cpu.utilization",
      attributes: { "resource.host.name": "web-1" },
      eventScope: { "resource.host.name": "web-1" },
    });

    await waitFor(() => {
      expect(drawnMarkers()).toEqual([
        "Alert: web-1 is unreachable",
        "Incident: web-1 is unreachable",
      ]);
    });
    expect(within(eventsToggle()).getByText("2")).toBeInTheDocument();
    for (const modelName of ["Incident", "Alert"]) {
      expect(requestsFor(modelName)).toHaveLength(1);
      expect(requestsFor(modelName)[0]!.query["hosts"]).toEqual({
        hostIdentifier: "web-1",
      });
      expect(requestsFor(modelName)[0]!.query).not.toHaveProperty(
        "telemetryQuery",
      );
    }
  });
});
