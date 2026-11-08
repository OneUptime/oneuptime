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
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident's Root Cause page (issue #6249): beside the root cause, the
 * metrics behind the incident, as the same investigation its Overview
 * shows - the ranges around the incident, the incident's moments on the
 * charts, Edit metrics, Copy link and Reset - metrics only, under URL names
 * of its own. It used to chart a fixed window (30 minutes before the
 * incident to 15 after) with the query builder hidden.
 *
 * Issue #4105's promises hold on it still: a drag zooms in with a way back,
 * and a double-click or Reset zoom returns to the range from before, two
 * drags deep included.
 *
 * The page is rendered for real (the root cause text card stubbed), and so
 * are the card, the investigation and MetricView; MetricCharts is stood in
 * for by buttons that call exactly the handlers MetricView hands the
 * charts, and the reads by mocks that can be read back.
 */

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();
const eventLinesInputs: Array<Record<string, unknown>> = [];

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  timeReferenceLines?:
    | Array<{ date: Date; label?: string; subtitle?: string }>
    | undefined;
  referenceRegions?:
    | Array<{ startDate: Date; endDate: Date; label?: string }>
    | undefined;
}

let mockLatestCharts: MockChartsProps | null = null;

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-28T11:20:00.000Z"),
  end: new Date("2026-09-28T11:35:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        mockLatestCharts = props;
        return (
          <div data-testid="metric-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              Drag across the chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the chart
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<unknown>) => {
          return fetchResultsMock(...args);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({
            metricTypes: [{ name: "system.memory.utilization" }],
            telemetryServices: [],
          });
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
        clearQueryTopNOverridesForScope: () => {
          return undefined;
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (input: Record<string, unknown>) => {
        eventLinesInputs.push(input);
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="root-cause-text" />;
    },
  };
});

import RootCausePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/RootCause";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EVENT_METRIC_SCOPE_NOTE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const INCIDENT_ID: string = "11111111-1111-4111-8111-111111111111";
const NOW: Date = new Date("2026-09-28T13:00:00.000Z");
const DECLARED_AT: Date = new Date("2026-09-28T11:30:00.000Z");
// What the monitor evaluated when it declared the incident.
const EVALUATED_START: Date = new Date("2026-09-28T11:25:00.000Z");
// Around the start: 30 minutes on either side of the declaration.
const AROUND_START: [string, string] = [
  "2026-09-28T11:00:00.000Z",
  "2026-09-28T12:00:00.000Z",
];
const HOUR_BEFORE: [string, string] = [
  "2026-09-28T10:30:00.000Z",
  "2026-09-28T11:30:00.000Z",
];
const DAY_BEFORE: [string, string] = [
  "2026-09-27T11:30:00.000Z",
  "2026-09-28T11:30:00.000Z",
];
const ACKNOWLEDGED_AT: Date = new Date("2026-09-28T11:40:00.000Z");
const RESOLVED_AT: Date = new Date("2026-09-28T12:10:00.000Z");

const PAGE: string = `/dashboard/project-1/incidents/${INCIDENT_ID}/root-cause`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/incidents/view/root-cause"),
  currentProject: null,
  hasPaymentMethod: true,
};

function queryConfig(metricName: string): Record<string, unknown> {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "CPU",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
      groupByAttributeKeys: ["resource.host.name"],
    },
  };
}

// The metric snapshot the incident keeps, as the row stores it: JSON.
function metricSnapshot(): Record<string, unknown> {
  return {
    telemetryType: "Metric",
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(EVALUATED_START, DECLARED_AT),
      ),
      queryConfigs: [queryConfig("system.cpu.utilization")],
      formulaConfigs: [],
    },
  };
}

function metricsMonitor(metricName: string): Record<string, unknown> {
  return {
    monitorType: MonitorType.Metrics,
    monitorSteps: {
      data: {
        monitorStepsInstanceArray: [
          {
            data: {
              id: "step-1",
              metricMonitor: {
                metricViewConfig: {
                  queryConfigs: [queryConfig(metricName)],
                  formulaConfigs: [],
                },
              },
            },
          },
        ],
      },
    },
  };
}

interface IncidentData {
  telemetryQuery?: Record<string, unknown> | null;
  seriesLabels?: Record<string, unknown> | undefined;
  monitors?: Array<Record<string, unknown>>;
}

let mockIncident: IncidentData = {};

function serve(): void {
  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType !== Incident) {
      return null;
    }

    return {
      declaredAt: DECLARED_AT,
      createdCriteriaId: undefined,
      telemetryQuery:
        mockIncident.telemetryQuery === undefined
          ? metricSnapshot()
          : mockIncident.telemetryQuery,
      seriesLabels: mockIncident.seriesLabels,
      monitors: mockIncident.monitors || [],
    };
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };
    let data: Array<Record<string, unknown>> = [];

    if (request.modelType === IncidentState) {
      data = [
        { _id: "identified", name: "Identified", order: 1 },
        {
          _id: "acknowledged",
          name: "Acknowledged",
          isAcknowledgedState: true,
          order: 2,
        },
        { _id: "resolved", name: "Resolved", isResolvedState: true, order: 3 },
      ];
    }

    if (request.modelType === IncidentStateTimeline) {
      data = [
        { incidentStateId: new ObjectID("identified"), startsAt: DECLARED_AT },
        {
          incidentStateId: new ObjectID("acknowledged"),
          startsAt: ACKNOWLEDGED_AT,
        },
        { incidentStateId: new ObjectID("resolved"), startsAt: RESOLVED_AT },
      ];
    }

    return { data: data, count: data.length, skip: 0, limit: 10000 };
  });
}

type Window = [string, string];

function fetchedWindows(): Array<Window> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): Window => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return [
      data.startAndEndDate!.startValue.toISOString(),
      data.startAndEndDate!.endValue.toISOString(),
    ];
  });
}

function lastFetchedWindow(): Window | undefined {
  const windows: Array<Window> = fetchedWindows();
  return windows[windows.length - 1];
}

function charts(): MockChartsProps {
  if (!mockLatestCharts) {
    throw new Error("The chart has not rendered");
  }
  return mockLatestCharts;
}

function pickerButton(): HTMLElement {
  return screen.getByTestId("metric-investigation-time-button");
}

function urlParam(name: string): string | null {
  return new URLSearchParams(window.location.search).get(name);
}

async function renderPage(): Promise<RenderResult> {
  let rendered: RenderResult | null = null;
  await act(async () => {
    rendered = render(<RootCausePage {...PAGE_PROPS} />);
  });
  /*
   * MetricView draws its charts once before it loads, then shows a loader
   * until its first fetch lands: wait for that fetch and the charts after.
   */
  await waitFor(() => {
    expect(fetchedWindows().length).toBeGreaterThan(0);
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
  return rendered!;
}

function pick(label: string): void {
  fireEvent.click(pickerButton());
  fireEvent.click(
    within(screen.getByTestId("metric-investigation-time-dropdown")).getByText(
      label,
    ),
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", PAGE);
  getItemMock.mockReset();
  getListMock.mockReset();
  fetchResultsMock.mockReset();
  eventLinesInputs.length = 0;
  mockLatestCharts = null;
  mockIncident = {};
  serve();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
    return new ObjectID(INCIDENT_ID);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("Root Cause: the incident's metrics, untouched", () => {
  test("charts the metrics around when it was declared, beside the root cause, with nothing to reset and nothing in the URL", async () => {
    await renderPage();

    expect(screen.getByTestId("root-cause-text")).toBeInTheDocument();
    expect(lastFetchedWindow()).toEqual(AROUND_START);
    expect(pickerButton()).toHaveTextContent("Around the start");
    expect(screen.getByText("Metrics related to this incident.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("the metrics alone: no Logs, Traces or Exceptions tabs, which the Overview has", async () => {
    await renderPage();

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  test("the incident's moments are on the charts: declared, acknowledged, resolved", async () => {
    await renderPage();

    expect(
      charts().timeReferenceLines?.map(
        (line: { date: Date; label?: string; subtitle?: string }) => {
          return [line.date.toISOString(), line.label, line.subtitle];
        },
      ),
    ).toEqual([
      [DECLARED_AT.toISOString(), "Declared", "This incident"],
      [ACKNOWLEDGED_AT.toISOString(), "Acknowledged", "This incident"],
    ]);
    // Resolved at 12:10 is past this range's end; a wider range shows it.
    pick("Start to resolution");
    await waitFor(() => {
      expect(
        charts().timeReferenceLines?.map((line: { label?: string }) => {
          return line.label;
        }),
      ).toEqual(["Declared", "Acknowledged", "Resolved"]);
    });
  });

  test("what the monitor evaluated is shaded, and the incident is not marked twice", async () => {
    await renderPage();

    expect(
      charts().referenceRegions?.map(
        (region: { startDate: Date; endDate: Date; label?: string }) => {
          return [
            region.startDate.toISOString(),
            region.endDate.toISOString(),
            region.label,
          ];
        },
      ),
    ).toEqual([
      [EVALUATED_START.toISOString(), DECLARED_AT.toISOString(), "What the monitor saw"],
    ]);
    expect(eventLinesInputs[eventLinesInputs.length - 1]!["excludedIncidentIds"]).toEqual([
      INCIDENT_ID,
    ]);
  });

  test("a grouped monitor's incident is narrowed to its own series, and says so", async () => {
    mockIncident = { seriesLabels: { "resource.host.name": "prod-01" } };

    await renderPage();

    expect(
      screen.getByText(
        "Metrics related to this incident, scoped to the affected series (resource.host.name = prod-01).",
      ),
    ).toBeVisible();
    const call: Array<unknown> =
      fetchResultsMock.mock.calls[fetchResultsMock.mock.calls.length - 1]!;
    expect(
      (call[0] as { metricViewData: MetricViewData }).metricViewData
        .queryConfigs[0]?.metricQueryData.filterData.attributes,
    ).toEqual({ "resource.host.name": "prod-01" });
  });
});

describe("Root Cause: picking a time range", () => {
  test("the picker offers the ranges around the incident, each with what it covers", async () => {
    await renderPage();

    fireEvent.click(pickerButton());
    const dropdown: HTMLElement = screen.getByTestId(
      "metric-investigation-time-dropdown",
    );

    expect(within(dropdown).getByText("Around this incident")).toBeVisible();
    for (const label of [
      "Around the start",
      "The hour before it started",
      "The day before it started",
      "Start to resolution",
      "What the monitor saw",
      "Relative to now",
      "Past 1 Hour",
      "Custom Range...",
    ]) {
      expect(within(dropdown).getByText(label)).toBeVisible();
    }
  });

  test("a range picked re-queries it, is kept in the URL under the page's own names, and offers Copy link and Reset", async () => {
    await renderPage();

    pick("The hour before it started");

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(HOUR_BEFORE);
    });
    expect(pickerButton()).toHaveTextContent("The hour before it started");
    expect(urlParam("rootCauseMetricsTime")).toBe("hour-before");
    // Never the Overview's names: the two cards keep their own.
    expect(urlParam("metricsTime")).toBeNull();
    expect(screen.getByText("Copy link")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(AROUND_START);
    });
    expect(window.location.search).toBe("");
  });

  test("a reload keeps the range picked", async () => {
    window.history.replaceState(
      {},
      "",
      `${PAGE}?rootCauseMetricsTime=day-before`,
    );

    await renderPage();

    expect(lastFetchedWindow()).toEqual(DAY_BEFORE);
    expect(fetchedWindows()).not.toContainEqual(AROUND_START);
    expect(pickerButton()).toHaveTextContent("The day before it started");
    expect(urlParam("rootCauseMetricsTime")).toBe("day-before");
  });

  test("the Overview's range in the address is not this card's", async () => {
    window.history.replaceState({}, "", `${PAGE}?metricsTime=hour-before`);

    await renderPage();

    expect(lastFetchedWindow()).toEqual(AROUND_START);
    expect(urlParam("metricsTime")).toBe("hour-before");
  });
});

describe("Root Cause: changing the metrics", () => {
  test("a metric added in Edit metrics is charted and kept in the URL; Reset brings back the monitor's", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Metric" }));

    await waitFor(() => {
      expect(charts().metricViewData.queryConfigs).toHaveLength(2);
    });
    expect(
      screen.getByText(
        "The metrics you picked. Reset brings back the metrics the monitor watched.",
      ),
    ).toBeVisible();
    expect(urlParam("rootCauseMetricsQueries")).toContain(
      "system.cpu.utilization",
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(charts().metricViewData.queryConfigs).toHaveLength(1);
    });
    expect(screen.getByText("Metrics related to this incident.")).toBeVisible();
    expect(window.location.search).toBe("");
  });

  test("Open in Metric Explorer is there, beside the picker", async () => {
    await renderPage();

    expect(
      screen.getByRole("button", { name: "Open in Metric Explorer" }),
    ).toBeVisible();
  });
});

describe("Root Cause: a drag across the chart (issue #4105)", () => {
  test("a drag re-queries the dragged window and offers the way back", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Drag across the chart" }));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual([
        MOCK_DRAG.start.toISOString(),
        MOCK_DRAG.end.toISOString(),
      ]);
    });
    expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    // The declaration stays marked on the zoomed chart.
    expect(charts().timeReferenceLines?.[0]?.date.toISOString()).toBe(
      DECLARED_AT.toISOString(),
    );
  });

  test("a double-click returns to the range around the declaration, not to now", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Drag across the chart" }));
    await waitFor(() => {
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    });
    fireEvent.click(screen.getByRole("button", { name: "Double-click the chart" }));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(AROUND_START);
    });
    expect(charts().onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("Reset zoom does what a double-click does", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Drag across the chart" }));
    fireEvent.click(
      await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(AROUND_START);
    });
  });

  test("two drags deep, one double-click still returns to the range around the declaration", async () => {
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Drag across the chart" }));
    await waitFor(() => {
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    });
    const deeperStart: Date = new Date("2026-09-28T11:25:00.000Z");
    const deeperEnd: Date = new Date("2026-09-28T11:28:00.000Z");
    act(() => {
      charts().onTimeRangeSelect?.(deeperStart, deeperEnd);
    });
    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual([
        deeperStart.toISOString(),
        deeperEnd.toISOString(),
      ]);
    });

    fireEvent.click(screen.getByRole("button", { name: "Double-click the chart" }));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(AROUND_START);
    });
  });
});

describe("Root Cause: an incident that kept no metric snapshot", () => {
  test("charts its monitor's metrics as the monitor reads them now, around the declaration, and says so", async () => {
    mockIncident = {
      telemetryQuery: null,
      monitors: [metricsMonitor("system.cpu.utilization")],
    };

    await renderPage();

    expect(lastFetchedWindow()).toEqual(AROUND_START);
    expect(screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID)).toHaveTextContent(
      "Charted for what this monitor checks now.",
    );
    // Nothing the monitor evaluated to shade, or to offer.
    expect(charts().referenceRegions).toBeUndefined();
    fireEvent.click(pickerButton());
    expect(
      within(screen.getByTestId("metric-investigation-time-dropdown")).queryByText(
        "What the monitor saw",
      ),
    ).toBeNull();
  });

  test("a snapshot of logs is no metric snapshot: the incident's metrics monitor is charted", async () => {
    mockIncident = {
      telemetryQuery: {
        telemetryType: "Log",
        telemetryQuery: {},
        metricViewData: null,
      },
      monitors: [metricsMonitor("http.server.errors")],
    };

    await renderPage();

    expect(
      String(charts().metricViewData.queryConfigs[0]?.metricQueryData.filterData.metricName),
    ).toBe("http.server.errors");
  });

  test("an incident with no metrics behind it shows no card, and reads nothing more", async () => {
    mockIncident = { telemetryQuery: null, monitors: [] };

    await act(async () => {
      render(<RootCausePage {...PAGE_PROPS} />);
    });

    await waitFor(() => {
      expect(screen.queryByText("Metrics related to this incident.")).toBeNull();
    });
    expect(screen.getByTestId("root-cause-text")).toBeInTheDocument();
    expect(getItemMock).toHaveBeenCalledTimes(1);
    // Its moments are read only for a card there is.
    expect(getListMock).not.toHaveBeenCalled();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("a read that fails says so, in the card", async () => {
    getItemMock.mockImplementation(async () => {
      throw new Error("The incident could not be read");
    });

    await act(async () => {
      render(<RootCausePage {...PAGE_PROPS} />);
    });

    expect(
      await screen.findByText("The incident could not be read"),
    ).toBeVisible();
    expect(screen.getByText("Metrics")).toBeVisible();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("while it reads, the card says it is loading, under the investigation's own title", async () => {
    let finish: (() => void) | null = null;
    getItemMock.mockImplementation(() => {
      return new Promise<null>((resolve: (value: null) => void) => {
        finish = (): void => {
          resolve(null);
        };
      });
    });

    await act(async () => {
      render(<RootCausePage {...PAGE_PROPS} />);
    });

    expect(screen.getByText("Metrics")).toBeVisible();
    expect(screen.getByText("Metrics related to this incident.")).toBeVisible();
    expect(screen.queryByTestId("metric-charts")).toBeNull();

    // An incident it cannot find, once read: no card at all.
    await act(async () => {
      finish?.();
    });
    expect(screen.queryByText("Metrics")).toBeNull();
  });
});
