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
 * An alert's Root Cause page (issue #6304): beside the root cause, the
 * metrics behind the alert, as the same card an incident's Root Cause page
 * shows (issue #6249) - the investigation its Overview shows, metrics only:
 * the ranges around the alert, the alert's moments on the charts, Edit
 * metrics, Copy link, Reset and Open in Metric Explorer, under URL names of
 * its own. The page used to show the root cause text alone, so whoever
 * wrote down why a metric alert fired had to switch to its Overview, and an
 * alert created by hand on a metric monitor had no metric card anywhere.
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
      metricQueryData: {
        filterData: { metricName?: unknown; attributes?: unknown };
      };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  timeReferenceLines?:
    | Array<{ date: Date; label?: string; subtitle?: string; kind?: string }>
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

import RootCausePage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/RootCause";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EVENT_METRIC_SCOPE_NOTE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const ALERT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_ALERT_ID: string = "33333333-3333-4333-8333-333333333333";
const NOW: Date = new Date("2026-09-28T13:00:00.000Z");
const CREATED_AT: Date = new Date("2026-09-28T11:30:00.000Z");
// What the monitor evaluated when it created the alert.
const EVALUATED_START: Date = new Date("2026-09-28T11:25:00.000Z");
// Around the start: 30 minutes on either side of the creation.
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
// Start to resolution: 15 minutes before the start to 15 after the resolve.
const START_TO_RESOLUTION: [string, string] = [
  "2026-09-28T11:15:00.000Z",
  "2026-09-28T12:25:00.000Z",
];
// Start to now: 15 minutes before the start, to now.
const START_TO_NOW: [string, string] = [
  "2026-09-28T11:15:00.000Z",
  "2026-09-28T13:00:00.000Z",
];
// The other alert, created earlier that morning.
const OTHER_CREATED_AT: Date = new Date("2026-09-28T09:00:00.000Z");
const OTHER_AROUND_START: [string, string] = [
  "2026-09-28T08:30:00.000Z",
  "2026-09-28T09:30:00.000Z",
];

const PAGE: string = `/dashboard/project-1/alerts/${ALERT_ID}/root-cause`;
const OTHER_PAGE: string = `/dashboard/project-1/alerts/${OTHER_ALERT_ID}/root-cause`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/alerts/view/root-cause"),
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

// The metric snapshot the alert keeps, as the row stores it: JSON.
function metricSnapshot(): Record<string, unknown> {
  return {
    telemetryType: "Metric",
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(EVALUATED_START, CREATED_AT),
      ),
      queryConfigs: [queryConfig("system.cpu.utilization")],
      formulaConfigs: [],
    },
  };
}

function monitorOf(
  monitorType: MonitorType,
  stepKey: string,
  settings: Record<string, unknown>,
  metricName: string,
): Record<string, unknown> {
  return {
    _id: "monitor-1",
    monitorType: monitorType,
    monitorSteps: {
      data: {
        monitorStepsInstanceArray: [
          {
            data: {
              id: "step-1",
              [stepKey]: {
                ...settings,
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

function metricsMonitor(metricName: string): Record<string, unknown> {
  return monitorOf(MonitorType.Metrics, "metricMonitor", {}, metricName);
}

// A monitor that reads no metrics at all: a website's.
const WEBSITE_MONITOR: Record<string, unknown> = {
  _id: "monitor-2",
  monitorType: MonitorType.Website,
  monitorSteps: {
    data: { monitorStepsInstanceArray: [{ data: { id: "step-1" } }] },
  },
};

interface AlertData {
  createdAt?: Date;
  impactStartedAt?: Date | undefined;
  telemetryQuery?: Record<string, unknown> | null;
  seriesLabels?: Record<string, unknown> | undefined;
  monitor?: Record<string, unknown> | null;
  // Its state timeline: by default created, acknowledged and resolved.
  timeline?: Array<[string, Date]>;
}

let mockAlert: AlertData = {};

const OTHER_ALERT: AlertData = {
  createdAt: OTHER_CREATED_AT,
  telemetryQuery: null,
  monitor: metricsMonitor("system.memory.utilization"),
  timeline: [["created", OTHER_CREATED_AT]],
};

function alertFor(id: string): AlertData {
  return id === OTHER_ALERT_ID ? OTHER_ALERT : mockAlert;
}

function serve(): void {
  getItemMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown; id: ObjectID } = args[0] as {
      modelType: unknown;
      id: ObjectID;
    };

    if (request.modelType !== Alert) {
      return null;
    }

    const alert: AlertData = alertFor(request.id.toString());

    return {
      createdAt: alert.createdAt || CREATED_AT,
      impactStartedAt: alert.impactStartedAt,
      createdCriteriaId: undefined,
      telemetryQuery:
        alert.telemetryQuery === undefined
          ? metricSnapshot()
          : alert.telemetryQuery,
      seriesLabels: alert.seriesLabels,
      monitor: alert.monitor === undefined ? null : alert.monitor,
    };
  });

  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: {
      modelType: unknown;
      query: { alertId?: ObjectID };
    } = args[0] as { modelType: unknown; query: { alertId?: ObjectID } };
    let data: Array<Record<string, unknown>> = [];

    if (request.modelType === AlertState) {
      data = [
        { _id: "created", name: "Created", order: 1 },
        {
          _id: "acknowledged",
          name: "Acknowledged",
          isAcknowledgedState: true,
          order: 2,
        },
        { _id: "resolved", name: "Resolved", isResolvedState: true, order: 3 },
      ];
    }

    if (request.modelType === AlertStateTimeline) {
      const alert: AlertData = alertFor(
        request.query.alertId?.toString() || "",
      );
      const timeline: Array<[string, Date]> = alert.timeline || [
        ["created", CREATED_AT],
        ["acknowledged", ACKNOWLEDGED_AT],
        ["resolved", RESOLVED_AT],
      ];

      data = timeline.map(([stateId, startsAt]: [string, Date]) => {
        return { alertStateId: new ObjectID(stateId), startsAt: startsAt };
      });
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

function lastFetchedQuery(): MetricViewData {
  const call: Array<unknown> =
    fetchResultsMock.mock.calls[fetchResultsMock.mock.calls.length - 1]!;
  return (call[0] as { metricViewData: MetricViewData }).metricViewData;
}

function charts(): MockChartsProps {
  if (!mockLatestCharts) {
    throw new Error("The chart has not rendered");
  }
  return mockLatestCharts;
}

function chartedMetricNames(): Array<string> {
  return charts().metricViewData.queryConfigs.map(
    (queryConfig: {
      metricQueryData: { filterData: { metricName?: unknown } };
    }): string => {
      return String(queryConfig.metricQueryData.filterData.metricName);
    },
  );
}

function momentLabels(): Array<string | undefined> {
  return (charts().timeReferenceLines || []).map((line: { label?: string }) => {
    return line.label;
  });
}

function pickerButton(): HTMLElement {
  return screen.getByTestId("metric-investigation-time-button");
}

function pickerOptions(): HTMLElement {
  fireEvent.click(pickerButton());
  return screen.getByTestId("metric-investigation-time-dropdown");
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

// A page with no card: rendered, and every read it makes landed.
async function renderPageWithoutCard(): Promise<void> {
  await act(async () => {
    render(<RootCausePage {...PAGE_PROPS} />);
  });
  await waitFor(() => {
    expect(screen.queryByText("Metrics")).toBeNull();
  });
}

function pick(label: string): void {
  fireEvent.click(pickerButton());
  fireEvent.click(
    within(screen.getByTestId("metric-investigation-time-dropdown")).getByText(
      label,
    ),
  );
}

interface ItemRead {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

function itemReads(): Array<ItemRead> {
  return getItemMock.mock.calls.map((call: Array<unknown>): ItemRead => {
    return call[0] as ItemRead;
  });
}

/*
 * The card's own reads of an alert: what decides what it charts. The
 * charts read the rule they draw by themselves (useEventMetricRule), as on
 * the alert's Overview: the alert's criteria and monitor id, and nothing
 * the card needs.
 */
function cardReads(): Array<ItemRead> {
  return itemReads().filter((read: ItemRead): boolean => {
    return read.modelType === Alert && Boolean(read.select["createdAt"]);
  });
}

function readsOf(modelType: unknown): number {
  return [...getItemMock.mock.calls, ...getListMock.mock.calls].filter(
    (call: Array<unknown>): boolean => {
      return (call[0] as { modelType: unknown }).modelType === modelType;
    },
  ).length;
}

let consoleErrors: Array<string> = [];

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", PAGE);
  getItemMock.mockReset();
  getListMock.mockReset();
  fetchResultsMock.mockReset();
  eventLinesInputs.length = 0;
  mockLatestCharts = null;
  mockAlert = {};
  consoleErrors = [];
  serve();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
    return new ObjectID(ALERT_ID);
  });
  // What React warns about while the page renders, for the note's test.
  jest
    .spyOn(console, "error")
    .mockImplementation((...args: Array<unknown>): void => {
      consoleErrors.push(args.map(String).join(" "));
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("Root Cause: the alert's metrics, untouched", () => {
  test("charts the metrics around when it was created, beside the root cause, with nothing to reset and nothing in the URL", async () => {
    await renderPage();

    expect(screen.getByTestId("root-cause-text")).toBeInTheDocument();
    expect(lastFetchedWindow()).toEqual(AROUND_START);
    expect(chartedMetricNames()).toEqual(["system.cpu.utilization"]);
    expect(pickerButton()).toHaveTextContent("Around the start");
    expect(screen.getByText("Metrics")).toBeVisible();
    expect(screen.getByText("Metrics for this alert.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    // Charted from what the alert kept: no note that it is the monitor now.
    expect(screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID)).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("an untouched card writes nothing to the URL, refreshed or not", async () => {
    await renderPage();

    const fetches: number = fetchResultsMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(fetchResultsMock.mock.calls.length).toBeGreaterThan(fetches);
    });
    expect(lastFetchedWindow()).toEqual(AROUND_START);
    expect(window.location.search).toBe("");
  });

  test("the metrics alone: no Logs, Traces or Exceptions tabs, which the Overview has", async () => {
    await renderPage();

    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  test("the alert's moments are on the charts, as an alert's: created, acknowledged, resolved", async () => {
    await renderPage();

    expect(
      charts().timeReferenceLines?.map(
        (line: {
          date: Date;
          label?: string;
          subtitle?: string;
          kind?: string;
        }) => {
          return [line.date.toISOString(), line.label, line.subtitle];
        },
      ),
    ).toEqual([
      [CREATED_AT.toISOString(), "Created", "This alert"],
      [ACKNOWLEDGED_AT.toISOString(), "Acknowledged", "This alert"],
    ]);
    // Resolved at 12:10 is past this range's end; a wider range shows it.
    pick("Start to resolution");
    await waitFor(() => {
      expect(momentLabels()).toEqual(["Created", "Acknowledged", "Resolved"]);
    });
  });

  test("when somebody recorded that its impact started earlier, that is marked too", async () => {
    const impactStartedAt: Date = new Date("2026-09-28T11:10:00.000Z");
    mockAlert = { impactStartedAt: impactStartedAt };

    await renderPage();

    expect(
      charts().timeReferenceLines?.map(
        (line: { date: Date; label?: string }) => {
          return [line.date.toISOString(), line.label];
        },
      ),
    ).toEqual([
      [impactStartedAt.toISOString(), "Impact started"],
      [CREATED_AT.toISOString(), "Created"],
      [ACKNOWLEDGED_AT.toISOString(), "Acknowledged"],
    ]);
  });

  test("what the monitor evaluated is shaded, and the alert is not marked twice", async () => {
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
      [
        EVALUATED_START.toISOString(),
        CREATED_AT.toISOString(),
        "What the monitor saw",
      ],
    ]);
    const lastLines: Record<string, unknown> =
      eventLinesInputs[eventLinesInputs.length - 1]!;
    // Among the alerts in the window, this one is left out: it is marked.
    expect(lastLines["excludedAlertIds"]).toEqual([ALERT_ID]);
    expect(lastLines["excludedIncidentIds"]).toBeUndefined();
  });

  test("a grouped monitor's alert is narrowed to its own series, and says so", async () => {
    mockAlert = { seriesLabels: { "resource.host.name": "prod-01" } };

    await renderPage();

    expect(
      screen.getByText(
        "Metrics for this alert, scoped to the affected series (resource.host.name = prod-01).",
      ),
    ).toBeVisible();
    expect(
      lastFetchedQuery().queryConfigs[0]?.metricQueryData.filterData.attributes,
    ).toEqual({ "resource.host.name": "prod-01" });
  });

  test("it reads the alert once, with only what the card needs of it and of its monitor, then the alert's moments", async () => {
    await renderPage();

    // First, before anything is drawn: the alert, with its one monitor.
    const read: ItemRead = itemReads()[0]!;
    expect(read.modelType).toBe(Alert);
    expect(read.id.toString()).toBe(ALERT_ID);
    expect(read.select).toEqual({
      createdAt: true,
      impactStartedAt: true,
      telemetryQuery: true,
      seriesLabels: true,
      createdCriteriaId: true,
      monitor: { _id: true, monitorType: true, monitorSteps: true },
    });
    expect(cardReads()).toHaveLength(1);

    // The charts' own read of the rule they draw: this alert's, as on its Overview.
    for (const other of itemReads().slice(1)) {
      expect(other.modelType).toBe(Alert);
      expect(other.id.toString()).toBe(ALERT_ID);
      expect(other.select).toEqual({
        _id: true,
        createdCriteriaId: true,
        monitorId: true,
      });
    }

    // Its state timeline, and the project's alert states: nothing else.
    expect(getListMock).toHaveBeenCalledTimes(2);
    const timelineRead: {
      query: { alertId: ObjectID };
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = getListMock.mock.calls.find((call: Array<unknown>): boolean => {
      return (
        (call[0] as { modelType: unknown }).modelType === AlertStateTimeline
      );
    })![0] as {
      query: { alertId: ObjectID };
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    };
    expect(timelineRead.query.alertId.toString()).toBe(ALERT_ID);
    expect(timelineRead.select).toEqual({
      _id: true,
      startsAt: true,
      alertStateId: true,
    });
    expect(timelineRead.sort).toEqual({ startsAt: SortOrder.Ascending });
    expect(readsOf(AlertState)).toBe(1);
  });
});

describe("Root Cause: an open alert and a resolved one", () => {
  test("a resolved alert offers its start to its resolution, 15 minutes either side", async () => {
    await renderPage();

    const options: HTMLElement = pickerOptions();
    expect(within(options).getByText("Start to resolution")).toBeVisible();
    expect(within(options).queryByText("Start to now")).toBeNull();
    fireEvent.click(within(options).getByText("Start to resolution"));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(START_TO_RESOLUTION);
    });
  });

  test("an open alert offers its start to now, and marks no resolution", async () => {
    mockAlert = {
      timeline: [
        ["created", CREATED_AT],
        ["acknowledged", ACKNOWLEDGED_AT],
      ],
    };

    await renderPage();

    const options: HTMLElement = pickerOptions();
    expect(within(options).getByText("Start to now")).toBeVisible();
    expect(within(options).queryByText("Start to resolution")).toBeNull();
    fireEvent.click(within(options).getByText("Start to now"));

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(START_TO_NOW);
    });
    expect(momentLabels()).toEqual(["Created", "Acknowledged"]);
  });

  test("an alert reopened after it was resolved is open again: its start to now", async () => {
    const reopenedAt: Date = new Date("2026-09-28T12:20:00.000Z");
    mockAlert = {
      timeline: [
        ["created", CREATED_AT],
        ["resolved", RESOLVED_AT],
        ["acknowledged", reopenedAt],
      ],
    };

    await renderPage();

    const options: HTMLElement = pickerOptions();
    expect(within(options).getByText("Start to now")).toBeVisible();
    expect(within(options).queryByText("Start to resolution")).toBeNull();
  });
});

describe("Root Cause: picking a time range", () => {
  test("the picker offers the ranges around the alert, each with what it covers", async () => {
    await renderPage();

    const dropdown: HTMLElement = pickerOptions();

    expect(within(dropdown).getByText("Around this alert")).toBeVisible();
    expect(within(dropdown).queryByText("Around this incident")).toBeNull();
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
    expect(screen.queryByText("Copy link")).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("what the monitor saw is exactly the window it evaluated", async () => {
    await renderPage();

    pick("What the monitor saw");

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual([
        EVALUATED_START.toISOString(),
        CREATED_AT.toISOString(),
      ]);
    });
    expect(urlParam("rootCauseMetricsTime")).toBe("evaluated");
  });

  test("Copy link copies a link to this page that opens the very same charts", async () => {
    const writeText: MockFunction = getJestMockFunction();
    writeText.mockImplementation(() => {
      return Promise.resolve();
    });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeText },
      configurable: true,
      writable: true,
    });

    await renderPage();
    pick("The day before it started");
    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(DAY_BEFORE);
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Copy link"));
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    const copied: URL = new URL(String(writeText.mock.calls[0]![0]));
    expect(copied.pathname).toBe(PAGE);
    expect(copied.searchParams.get("rootCauseMetricsTime")).toBe("day-before");
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

  test("a reload keeps a range of the reader's own, to the minute", async () => {
    const start: string = "2026-09-28T10:05:00.000Z";
    const end: string = "2026-09-28T10:50:00.000Z";
    window.history.replaceState(
      {},
      "",
      `${PAGE}?rootCauseMetricsTime=custom&rootCauseMetricsStart=${start}&rootCauseMetricsEnd=${end}`,
    );

    await renderPage();

    expect(lastFetchedWindow()).toEqual([start, end]);
    expect(fetchedWindows()).not.toContainEqual(AROUND_START);
    expect(urlParam("rootCauseMetricsStart")).toBe(start);
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
    expect(urlParam("metricsQueries")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(charts().metricViewData.queryConfigs).toHaveLength(1);
    });
    expect(screen.getByText("Metrics for this alert.")).toBeVisible();
    expect(window.location.search).toBe("");
  });

  test("Open in Metric Explorer takes the metrics and the time range charted to the explorer", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {});

    await renderPage();
    pick("The hour before it started");
    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(HOUR_BEFORE);
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Open in Metric Explorer" }),
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    const target: URL = new URL(String(navigate.mock.calls[0]![0]));
    expect(target.searchParams.get("metricQueries")).toContain(
      "system.cpu.utilization",
    );
    expect(target.searchParams.get("startTime")).toBe(HOUR_BEFORE[0]);
    expect(target.searchParams.get("endTime")).toBe(HOUR_BEFORE[1]);
  });
});

describe("Root Cause: a drag across the chart (issue #4105)", () => {
  test("a drag re-queries the dragged window and offers the way back", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Drag across the chart" }),
    );

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
    // The creation stays marked on the zoomed chart.
    expect(charts().timeReferenceLines?.[0]?.date.toISOString()).toBe(
      CREATED_AT.toISOString(),
    );
  });

  test("a double-click returns to the range around the creation, not to now", async () => {
    await renderPage();

    fireEvent.click(
      screen.getByRole("button", { name: "Drag across the chart" }),
    );
    await waitFor(() => {
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Double-click the chart" }),
    );

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

    fireEvent.click(
      screen.getByRole("button", { name: "Drag across the chart" }),
    );
    fireEvent.click(
      await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    );

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(AROUND_START);
    });
  });
});

describe("Root Cause: an alert that kept no metric snapshot", () => {
  test("charts its monitor's metrics as the monitor reads them now, around the creation, and says so", async () => {
    mockAlert = {
      telemetryQuery: null,
      monitor: metricsMonitor("system.cpu.utilization"),
    };

    await renderPage();

    expect(lastFetchedWindow()).toEqual(AROUND_START);
    expect(chartedMetricNames()).toEqual(["system.cpu.utilization"]);
    expect(
      screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).toHaveTextContent("Charted for what this monitor checks now.");
    // Nothing the monitor evaluated to shade, or to offer.
    expect(charts().referenceRegions).toBeUndefined();
    expect(
      within(pickerOptions()).queryByText("What the monitor saw"),
    ).toBeNull();
  });

  test("an infrastructure monitor's alert is charted for what the monitor checks, and names it", async () => {
    mockAlert = {
      telemetryQuery: null,
      monitor: monitorOf(
        MonitorType.Host,
        "hostMonitor",
        { hostIdentifier: "web-01" },
        "system.cpu.utilization",
      ),
    };

    await renderPage();

    expect(
      screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID),
    ).toHaveTextContent("Charted for web-01, which this monitor checks now.");
    expect(
      lastFetchedQuery().queryConfigs[0]?.metricQueryData.filterData.attributes,
    ).toEqual(expect.objectContaining({ "resource.host.name": "web-01" }));
  });

  test("the note is one line of its own, a div that holds its icon, and it goes once the reader picks metrics of their own", async () => {
    mockAlert = {
      telemetryQuery: null,
      monitor: metricsMonitor("system.cpu.utilization"),
    };

    await renderPage();

    const note: HTMLElement = screen.getByTestId(
      EVENT_METRIC_SCOPE_NOTE_TEST_ID,
    );
    // The icon draws a div, which a paragraph may not hold.
    expect(note.tagName).toBe("DIV");
    expect(note.closest("p")).toBeNull();
    expect(
      consoleErrors.filter((message: string): boolean => {
        return message.includes("validateDOMNesting");
      }),
    ).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Metric" }));

    await waitFor(() => {
      expect(screen.queryByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID)).toBeNull();
    });
  });

  test("a snapshot of logs is no metric snapshot: the alert's metrics monitor is charted", async () => {
    mockAlert = {
      telemetryQuery: {
        telemetryType: "Log",
        telemetryQuery: {},
        metricViewData: null,
      },
      monitor: metricsMonitor("http.server.errors"),
    };

    await renderPage();

    expect(chartedMetricNames()).toEqual(["http.server.errors"]);
    expect(screen.getByTestId(EVENT_METRIC_SCOPE_NOTE_TEST_ID)).toBeVisible();
  });
});

describe("Root Cause: an alert with no metrics behind it shows no card, and reads nothing more", () => {
  test.each([
    ["no monitor and no snapshot", { telemetryQuery: null, monitor: null }],
    [
      "a monitor that reads no metrics, and no snapshot",
      { telemetryQuery: null, monitor: WEBSITE_MONITOR },
    ],
    [
      "a snapshot of logs, and no monitor",
      {
        telemetryQuery: {
          telemetryType: "Log",
          telemetryQuery: {},
          metricViewData: null,
        },
        monitor: null,
      },
    ],
    [
      "a metrics monitor with no metric picked yet, and no snapshot",
      { telemetryQuery: null, monitor: metricsMonitor("") },
    ],
  ])("%s", async (_name: string, alert: AlertData) => {
    mockAlert = alert;

    await renderPageWithoutCard();

    expect(screen.getByTestId("root-cause-text")).toBeInTheDocument();
    expect(screen.queryByText("Metrics for this alert.")).toBeNull();
    // The alert, read once; its moments are read only for a card there is.
    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(readsOf(Alert)).toBe(1);
    expect(getListMock).not.toHaveBeenCalled();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("an alert it cannot find shows no card either", async () => {
    getItemMock.mockImplementation(async () => {
      return null;
    });

    await renderPageWithoutCard();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(getListMock).not.toHaveBeenCalled();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });
});

describe("Root Cause: reading the alert", () => {
  test("a read of the alert that fails says so, in the card", async () => {
    getItemMock.mockImplementation(async () => {
      throw new Error("The alert could not be read");
    });

    await act(async () => {
      render(<RootCausePage {...PAGE_PROPS} />);
    });

    expect(
      await screen.findByText("The alert could not be read"),
    ).toBeVisible();
    expect(screen.getByText("Metrics")).toBeVisible();
    expect(screen.getByText("Metrics for this alert.")).toBeVisible();
    expect(getListMock).not.toHaveBeenCalled();
    expect(fetchResultsMock).not.toHaveBeenCalled();
  });

  test("a read of its moments that fails says so too, in the card, as on an incident's page", async () => {
    getListMock.mockImplementation(async () => {
      throw new Error("The alert's states could not be read");
    });

    await act(async () => {
      render(<RootCausePage {...PAGE_PROPS} />);
    });

    expect(
      await screen.findByText("The alert's states could not be read"),
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
    expect(screen.getByText("Metrics for this alert.")).toBeVisible();
    expect(screen.queryByTestId("metric-charts")).toBeNull();
    expect(getListMock).not.toHaveBeenCalled();

    // An alert it cannot find, once read: no card at all.
    await act(async () => {
      finish?.();
    });
    expect(screen.queryByText("Metrics")).toBeNull();
  });

  test("another alert's page starts on that alert's own metrics and range, not on what the reader picked here", async () => {
    const rendered: RenderResult = await renderPage();

    pick("The hour before it started");
    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(HOUR_BEFORE);
    });

    // The reader follows a link to another alert's Root Cause page.
    window.history.replaceState({}, "", OTHER_PAGE);
    jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
      return new ObjectID(OTHER_ALERT_ID);
    });
    await act(async () => {
      rendered.rerender(<RootCausePage {...PAGE_PROPS} />);
    });

    await waitFor(() => {
      expect(lastFetchedWindow()).toEqual(OTHER_AROUND_START);
    });
    expect(chartedMetricNames()).toEqual(["system.memory.utilization"]);
    expect(pickerButton()).toHaveTextContent("Around the start");
    expect(window.location.search).toBe("");
    // Read afresh for that alert, once.
    expect(
      cardReads().map((read: ItemRead): string => {
        return read.id.toString();
      }),
    ).toEqual([ALERT_ID, OTHER_ALERT_ID]);
  });
});
