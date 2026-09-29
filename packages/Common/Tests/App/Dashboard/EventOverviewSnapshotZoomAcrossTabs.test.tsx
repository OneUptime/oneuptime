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
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the incident and alert overview pages: a drag on the
 * telemetry snapshot's metric chart zooms the WHOLE snapshot, so the slice
 * is what the snapshot's Logs, Traces and Exceptions tabs show too. The
 * page holds the zoom, above the tabs:
 *
 * - it survives a switch to another tab and back (the tabs mount only the
 *   open one, so a zoom kept in the chart was gone on the way back);
 * - "Reset zoom" beside the snapshot badge, on any tab, and a double-click
 *   on the chart return every tab to the snapshot window;
 * - the page's background refresh re-reads an equal snapshot and keeps it;
 *   a refresh that brings back a different window ends it;
 * - the page stays mounted when the reader moves to another event, and one
 *   evaluation of a grouped monitor opens several events over the same
 *   window: the next event starts unzoomed, and so does coming back.
 *
 * A Logs snapshot's companion Metrics tab keeps a zoom of its own, and
 * must keep it, and its way back, across the same refresh.
 *
 * The pages are rendered for real with every heavy card stubbed (the same
 * stubs as EventOverviewTelemetrySnapshotZoom.test), and so is the snapshot
 * card with its tabs. The metric charts (the snapshot's own, and the
 * companion card's) are the real MetricView with MetricCharts stood in for
 * by buttons that call exactly the handlers MetricView hands the charts;
 * the logs, traces and exceptions explorers are stubs that record the query
 * each tab hands them.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

const recordedProps: Record<string, Array<Record<string, unknown>>> = {};

function recordProps(key: string, props: Record<string, unknown>): void {
  if (!recordedProps[key]) {
    recordedProps[key] = [];
  }
  recordedProps[key]!.push(props);
}

function stubModule(key: string): {
  __esModule: boolean;
  default: (props: Record<string, unknown>) => ReactElement;
} {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordProps(key, props);
      return React.createElement("div", { "data-testid": `stub-${key}` });
    },
  };
}

interface MockChartsProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

let mockLatestCharts: MockChartsProps | null = null;

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-14T17:52:00.000Z"),
  end: new Date("2026-09-14T17:56:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): ReactElement => {
        mockLatestCharts = props;
        return (
          <div data-testid="metric-charts">
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              Drag across the snapshot chart
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              Double-click the snapshot chart
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
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
        },
        getMetricTypes: () => {
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
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/useServiceNames",
  () => {
    return {
      __esModule: true,
      default: () => {
        return {};
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: () => {
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

// The companion metric card's picker: shows the card's range.
jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: {
        range: string;
        startAndEndDate?: { startValue: Date; endValue: Date };
      };
    }): ReactElement => {
      const window: { startValue: Date; endValue: Date } | undefined =
        props.dashboardStartAndEndDate.startAndEndDate;
      return (
        <span data-testid="card-picker">
          {window
            ? `${props.dashboardStartAndEndDate.range} ${window.startValue.toISOString()}..${window.endValue.toISOString()}`
            : props.dashboardStartAndEndDate.range}
        </span>
      );
    },
  };
});

// The companion metric card looks up which metrics the scope has.
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

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      updateById: () => {
        return Promise.resolve(undefined);
      },
      createOrUpdate: () => {
        return Promise.resolve(undefined);
      },
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      return React.createElement("div", {
        "data-testid": `stub-card-${props["name"] as string}`,
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString() },
          props.children,
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/ChangeState",
  () => {
    return stubModule("ChangeIncidentState");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/ChangeState",
  () => {
    return stubModule("ChangeAlertState");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/InvestigationPanel",
  () => {
    return stubModule("InvestigationPanel");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentFeed",
  () => {
    return stubModule("Feed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertFeed",
  () => {
    return stubModule("Feed");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/AffectedResources",
  () => {
    return stubModule("SeriesResource");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/AffectedResources",
  () => {
    return stubModule("SeriesResource");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSummarySnapshotCard",
  () => {
    return stubModule("MonitorSummary");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Runbook/EntityRunbooks",
  () => {
    return stubModule("Runbooks");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationSuggestionCard",
  () => {
    return stubModule("Remediation");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentMemberRoleAssignment",
  () => {
    return stubModule("Roles");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return stubModule("CustomFields");
  },
);
// The snapshot's companion explorers: record the query each tab hands them.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return stubModule("LogsViewer");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return stubModule("TracesViewer");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return stubModule("ExceptionsViewer");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesDisplay",
  () => {
    return stubModule("AffectedResourcesDisplay");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AffectedResources/AffectedResourcesPicker",
  () => {
    return {
      ...stubModule("AffectedResourcesPicker"),
      isAffectedResourcesPayload: (): boolean => {
        return false;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/StatusPageSubscribers/SubscriberNotificationStatus",
  () => {
    return stubModule("SubscriberNotificationStatus");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicies",
  () => {
    return stubModule("OnCallPolicies");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/User/User",
  () => {
    return stubModule("User");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Monitor",
  () => {
    return stubModule("Monitor");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AlertEpisode/AlertEpisode",
  () => {
    return stubModule("AlertEpisode");
  },
);

import IncidentView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/View/Index";
import AlertView from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import Route from "../../../Types/API/Route";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import User from "../../../UI/Utils/User";

const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";
// Opened by the same evaluation of a grouped monitor: the same window.
const SIBLING_EVENT_ID: string = "22222222-2222-4222-8222-222222222222";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
// The window the monitor evaluated over when it opened the event.
const SNAPSHOT_START: Date = new Date("2026-09-14T17:45:00.000Z");
const SNAPSHOT_END: Date = new Date("2026-09-14T18:00:00.000Z");
// A later evaluation's window, for a refresh that brings back another one.
const NEXT_START: Date = new Date("2026-09-14T18:30:00.000Z");
const NEXT_END: Date = new Date("2026-09-14T18:45:00.000Z");

const SNAPSHOT_TEXT: string = `${SNAPSHOT_START.toISOString()}..${SNAPSHOT_END.toISOString()}`;
const SLICE_TEXT: string = `${MOCK_DRAG.start.toISOString()}..${MOCK_DRAG.end.toISOString()}`;
const NEXT_TEXT: string = `${NEXT_START.toISOString()}..${NEXT_END.toISOString()}`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

// The window the snapshot's stored query is re-read with.
let mockStoredWindow: { start: Date; end: Date } = {
  start: SNAPSHOT_START,
  end: SNAPSHOT_END,
};
// What the monitor that opened the event evaluated.
let mockStoredType: "Metric" | "Log" = "Metric";
let mockEventId: string = EVENT_ID;

function textOf(window: { startValue: Date; endValue: Date }): string {
  return `${OneUptimeDate.fromString(window.startValue).toISOString()}..${OneUptimeDate.fromString(window.endValue).toISOString()}`;
}

function fetchedChartWindows(): Array<string> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): string => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return textOf(data.startAndEndDate!);
  });
}

function chartWindow(): string | undefined {
  const windows: Array<string> = fetchedChartWindows();
  return windows[windows.length - 1];
}

function charts(): MockChartsProps {
  if (!mockLatestCharts) {
    throw new Error("The snapshot chart has not rendered");
  }
  return mockLatestCharts;
}

function latestProps(key: string): Record<string, unknown> {
  const calls: Array<Record<string, unknown>> = recordedProps[key] || [];
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

// The window a companion tab handed its explorer, by the query's own field.
function companionWindow(
  key: string,
  queryProp: string,
  field: string,
): string {
  const query: Record<string, unknown> = latestProps(key)[queryProp] as Record<
    string,
    unknown
  >;
  return textOf(query[field] as InBetween<Date>);
}

function logsWindow(): string {
  return companionWindow("LogsViewer", "logQuery", "time");
}

function tracesWindow(): string {
  return companionWindow("TracesViewer", "spanQuery", "startTime");
}

function exceptionsWindow(): string {
  return companionWindow("ExceptionsViewer", "exceptionInstanceQuery", "time");
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

/*
 * The telemetryQuery exactly as the row stores it: serialized to JSON, so
 * the window's bounds come back as ISO strings.
 */
function storedMetricSnapshot(): JSONObject {
  return {
    telemetryType: "Metric",
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(mockStoredWindow.start, mockStoredWindow.end),
      ),
      queryConfigs: [
        {
          id: "query-1",
          metricAliasData: {
            metricVariable: "a",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: "system.cpu.utilization",
              aggegationType: "Avg",
            },
          },
        },
      ],
      formulaConfigs: [],
    },
  };
}

// A log monitor's snapshot, stored the same way.
function storedLogSnapshot(): JSONObject {
  return {
    telemetryType: "Log",
    telemetryQuery: {
      time: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(mockStoredWindow.start, mockStoredWindow.end),
      ),
    },
    metricViewData: null,
  };
}

function storedSnapshot(): JSONObject {
  return mockStoredType === "Log"
    ? storedLogSnapshot()
    : storedMetricSnapshot();
}

interface PageCase {
  renderPage: () => RenderResult;
  page: () => ReactElement;
  stateModel: typeof IncidentState | typeof AlertState;
  timelineModel: typeof IncidentStateTimeline | typeof AlertStateTimeline;
  changeStateKey: string;
  buildEvent: () => Incident | Alert;
  buildStates: () => Array<IncidentState | AlertState>;
  buildTimeline: () => Array<IncidentStateTimeline | AlertStateTimeline>;
}

const INCIDENT_CASE: PageCase = {
  page: (): ReactElement => {
    return <IncidentView {...PAGE_PROPS} />;
  },
  renderPage: (): RenderResult => {
    return render(<IncidentView {...PAGE_PROPS} />);
  },
  stateModel: IncidentState,
  timelineModel: IncidentStateTimeline,
  changeStateKey: "ChangeIncidentState",
  buildEvent: (): Incident => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(mockEventId);
    incident.title = "Checkout CPU saturated";
    incident.incidentNumber = 42;
    incident.declaredAt = SNAPSHOT_END;
    incident.telemetryQuery = storedSnapshot() as never;
    return incident;
  },
  buildStates: (): Array<IncidentState> => {
    const state: IncidentState = new IncidentState();
    state.id = new ObjectID(CREATED_STATE_ID);
    state.name = "Created";
    state.isCreatedState = true;
    return [state];
  },
  buildTimeline: (): Array<IncidentStateTimeline> => {
    const timeline: IncidentStateTimeline = new IncidentStateTimeline();
    timeline.incidentStateId = new ObjectID(CREATED_STATE_ID);
    timeline.startsAt = SNAPSHOT_END;
    return [timeline];
  },
};

const ALERT_CASE: PageCase = {
  page: (): ReactElement => {
    return <AlertView {...PAGE_PROPS} />;
  },
  renderPage: (): RenderResult => {
    return render(<AlertView {...PAGE_PROPS} />);
  },
  stateModel: AlertState,
  timelineModel: AlertStateTimeline,
  changeStateKey: "ChangeAlertState",
  buildEvent: (): Alert => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(mockEventId);
    alert.title = "Checkout CPU saturated";
    alert.alertNumber = 12;
    alert.createdAt = SNAPSHOT_END;
    alert.telemetryQuery = storedSnapshot() as never;
    return alert;
  },
  buildStates: (): Array<AlertState> => {
    const state: AlertState = new AlertState();
    state.id = new ObjectID(CREATED_STATE_ID);
    state.name = "Created";
    state.isCreatedState = true;
    return [state];
  },
  buildTimeline: (): Array<AlertStateTimeline> => {
    const timeline: AlertStateTimeline = new AlertStateTimeline();
    timeline.alertStateId = new ObjectID(CREATED_STATE_ID);
    timeline.startsAt = SNAPSHOT_END;
    return [timeline];
  },
};

function serve(pageCase: PageCase): void {
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };
    const data: Array<unknown> =
      request.modelType === pageCase.stateModel
        ? pageCase.buildStates()
        : request.modelType === pageCase.timelineModel
          ? pageCase.buildTimeline()
          : [];
    return Promise.resolve({
      data: data,
      count: data.length,
      skip: 0,
      limit: 10000,
    });
  });
  getItemMock.mockImplementation(() => {
    return Promise.resolve(pageCase.buildEvent());
  });
}

/*
 * MetricView draws its charts once before it loads, then shows a loader
 * until its first fetch lands: wait for that fetch and the charts after.
 */
async function chartSettled(): Promise<void> {
  await waitFor(() => {
    expect(fetchedChartWindows().length).toBeGreaterThan(0);
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
}

async function renderSettled(pageCase: PageCase): Promise<RenderResult> {
  serve(pageCase);
  const rendered: RenderResult = pageCase.renderPage();
  await chartSettled();
  return rendered;
}

async function press(label: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

async function openTab(name: string): Promise<void> {
  // Found outside act: the page may still be loading its first read.
  const tab: HTMLElement = await screen.findByRole("tab", { name: name });
  await act(async () => {
    fireEvent.click(tab);
  });
}

async function zoomTheSnapshot(): Promise<void> {
  await press("Drag across the snapshot chart");
  await waitFor(() => {
    expect(chartWindow()).toBe(SLICE_TEXT);
  });
}

async function backOnMetrics(): Promise<void> {
  await openTab("Metrics");
  await chartSettled();
}

// A state change on the page: it re-reads the event in the background.
async function refreshThePage(pageCase: PageCase): Promise<void> {
  const reads: number = getItemMock.mock.calls.length;
  const changeState: { onActionComplete: () => void } = latestProps(
    pageCase.changeStateKey,
  ) as unknown as { onActionComplete: () => void };
  await act(async () => {
    changeState.onActionComplete();
  });
  await waitFor(() => {
    expect(getItemMock.mock.calls.length).toBeGreaterThan(reads);
  });
}

function badgeTitle(): string {
  return OneUptimeDate.getInBetweenDatesAsFormattedString(
    new InBetween<Date>(SNAPSHOT_START, SNAPSHOT_END),
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockLatestCharts = null;
  mockStoredWindow = { start: SNAPSHOT_START, end: SNAPSHOT_END };
  mockStoredType = "Metric";
  mockEventId = EVENT_ID;
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockResolvedValue({
    data: [{ name: "checkout.latency" }],
  });
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
    return new ObjectID(mockEventId);
  });
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return [Permission.ProjectMember];
  });
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  getItemMock.mockReset();
  for (const key of Object.keys(recordedProps)) {
    delete recordedProps[key];
  }
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe.each([
  ["incident", INCIDENT_CASE],
  ["alert", ALERT_CASE],
])(
  "the %s overview's snapshot zooms as one",
  (_name: string, pageCase: PageCase) => {
    test("before any drag, the companion tabs are on the snapshot window", async () => {
      await renderSettled(pageCase);

      expect(chartWindow()).toBe(SNAPSHOT_TEXT);
      await openTab("Logs");
      expect(logsWindow()).toBe(SNAPSHOT_TEXT);
    });

    test("a drag on the chart hands the slice to the Logs, Traces and Exceptions tabs", async () => {
      await renderSettled(pageCase);
      const pageReads: number = getItemMock.mock.calls.length;

      await zoomTheSnapshot();

      await openTab("Logs");
      expect(logsWindow()).toBe(SLICE_TEXT);
      await openTab("Traces");
      expect(tracesWindow()).toBe(SLICE_TEXT);
      await openTab("Exceptions");
      expect(exceptionsWindow()).toBe(SLICE_TEXT);
      // A zoom is not a reload of the page.
      expect(getItemMock.mock.calls.length).toBe(pageReads);
    });

    test("the companion explorers' empty states name the zoomed part of the snapshot window, until a reset", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();

      await openTab("Logs");
      expect(latestProps("LogsViewer")["noLogsMessage"]).toBe(
        "No logs found in the zoomed part of the snapshot window.",
      );
      await openTab("Traces");
      expect(latestProps("TracesViewer")["emptyMessage"]).toBe(
        "No spans found in the zoomed part of the snapshot window.",
      );
      await openTab("Exceptions");
      expect(latestProps("ExceptionsViewer")["emptyMessage"]).toBe(
        "No exceptions found in the zoomed part of the snapshot window.",
      );

      await act(async () => {
        fireEvent.click(
          screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
        );
      });
      expect(latestProps("ExceptionsViewer")["emptyMessage"]).toBe(
        "No exceptions found in the snapshot window.",
      );
      await openTab("Logs");
      expect(latestProps("LogsViewer")["noLogsMessage"]).toBe(
        "No logs found in the snapshot window.",
      );
    });

    test("back on the Metrics tab the chart is still on the slice, with its way back", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();
      await openTab("Logs");

      await backOnMetrics();

      expect(chartWindow()).toBe(SLICE_TEXT);
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      expect(resetButtons()).toHaveLength(1);
    });

    test("every tab's card names the snapshot window and offers Reset zoom while zoomed", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();

      for (const tabName of ["Metrics", "Logs", "Traces", "Exceptions"]) {
        await openTab(tabName);
        const tabPanel: HTMLElement = screen.getByRole("tabpanel");
        expect(within(tabPanel).getByText(badgeTitle())).toBeInTheDocument();
        expect(
          within(tabPanel).getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
        ).toBeVisible();
      }
    });

    test("Reset zoom on the Logs tab returns every tab to the snapshot window", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();
      await openTab("Logs");

      await act(async () => {
        fireEvent.click(
          screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
        );
      });

      expect(logsWindow()).toBe(SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
      await backOnMetrics();
      expect(chartWindow()).toBe(SNAPSHOT_TEXT);
      expect(charts().onTimeRangeReset).toBeUndefined();
      await openTab("Traces");
      expect(tracesWindow()).toBe(SNAPSHOT_TEXT);
    });

    test("a double-click on the chart after a round trip returns every tab to the snapshot window", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();
      await openTab("Exceptions");
      await backOnMetrics();
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);

      await press("Double-click the snapshot chart");

      await waitFor(() => {
        expect(chartWindow()).toBe(SNAPSHOT_TEXT);
      });
      expect(resetButtons()).toHaveLength(0);
      await openTab("Exceptions");
      expect(exceptionsWindow()).toBe(SNAPSHOT_TEXT);
    });

    test("the page's background refresh keeps the zoom on every tab", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();

      await refreshThePage(pageCase);

      expect(chartWindow()).toBe(SLICE_TEXT);
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      expect(resetButtons()).toHaveLength(1);
      await openTab("Logs");
      expect(logsWindow()).toBe(SLICE_TEXT);
    });

    test("a refresh with a tab open hands that tab the very same query", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();
      await openTab("Logs");
      const logQuery: unknown = latestProps("LogsViewer")["logQuery"];

      await refreshThePage(pageCase);

      // Not even a new-but-equal object: nothing for the explorer to redo.
      expect(latestProps("LogsViewer")["logQuery"]).toBe(logQuery);
      expect(logsWindow()).toBe(SLICE_TEXT);
    });

    test("a refresh that brings back a different window ends the zoom on every tab", async () => {
      await renderSettled(pageCase);
      await zoomTheSnapshot();

      mockStoredWindow = { start: NEXT_START, end: NEXT_END };
      await refreshThePage(pageCase);

      await waitFor(() => {
        expect(chartWindow()).toBe(NEXT_TEXT);
      });
      expect(charts().onTimeRangeReset).toBeUndefined();
      expect(resetButtons()).toHaveLength(0);
      await openTab("Logs");
      expect(logsWindow()).toBe(NEXT_TEXT);
    });

    test("another event from the same evaluation (same window) starts unzoomed, and so does coming back", async () => {
      const rendered: RenderResult = await renderSettled(pageCase);
      await zoomTheSnapshot();

      // The reader follows a link to the sibling event: same route, same page.
      mockEventId = SIBLING_EVENT_ID;
      fetchResultsMock.mockClear();
      rendered.rerender(pageCase.page());
      await chartSettled();

      expect(chartWindow()).toBe(SNAPSHOT_TEXT);
      expect(charts().onTimeRangeReset).toBeUndefined();
      expect(resetButtons()).toHaveLength(0);
      await openTab("Logs");
      expect(logsWindow()).toBe(SNAPSHOT_TEXT);

      // And back to the first one: its zoom stayed behind with it.
      mockEventId = EVENT_ID;
      fetchResultsMock.mockClear();
      rendered.rerender(pageCase.page());
      await chartSettled();

      expect(chartWindow()).toBe(SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
    });
  },
);

/*
 * A Logs snapshot: the Metrics tab is a companion, an embedded metric card
 * that zooms on its own terms. The page's background refresh re-reads the
 * snapshot after every acknowledge or edit; it used to reload that card and
 * forget its zoom while the tab kept the zoomed window, leaving the chart on
 * the slice with no Reset zoom and a double-click that did nothing.
 */
describe.each([
  ["incident", INCIDENT_CASE],
  ["alert", ALERT_CASE],
])(
  "the %s overview's Logs snapshot: its companion Metrics tab across the page's refresh",
  (_name: string, pageCase: PageCase) => {
    beforeEach(() => {
      mockStoredType = "Log";
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(new ObjectID("33333333-3333-4333-8333-333333333333"));
    });

    function cardPicker(): string {
      return screen.getByTestId("card-picker").textContent || "";
    }

    async function openTheCompanionCard(): Promise<void> {
      serve(pageCase);
      pageCase.renderPage();
      await openTab("Metrics");
      await chartSettled();
      expect(chartWindow()).toBe(SNAPSHOT_TEXT);
    }

    async function zoomTheCard(): Promise<void> {
      await zoomTheSnapshot();
      await waitFor(() => {
        expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      });
      // The card's own way back: the snapshot itself is not zoomed.
      expect(resetButtons()).toHaveLength(1);
    }

    test("the refresh keeps the card's zoom and its way back, without reloading the card", async () => {
      await openTheCompanionCard();
      await zoomTheCard();
      const lookups: number = analyticsGetListMock.mock.calls.length;
      const chartsBefore: HTMLElement = screen.getByTestId("metric-charts");

      await refreshThePage(pageCase);

      expect(chartWindow()).toBe(SLICE_TEXT);
      expect(cardPicker()).toBe(
        `Custom ${MOCK_DRAG.start.toISOString()}..${MOCK_DRAG.end.toISOString()}`,
      );
      expect(resetButtons()).toHaveLength(1);
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      // Never blanked behind a loader, never looked up again.
      expect(screen.getByTestId("metric-charts")).toBe(chartsBefore);
      expect(analyticsGetListMock.mock.calls.length).toBe(lookups);
    });

    test("a double-click after the refresh returns the card to the snapshot window", async () => {
      await openTheCompanionCard();
      await zoomTheCard();
      await refreshThePage(pageCase);

      await press("Double-click the snapshot chart");

      await waitFor(() => {
        expect(chartWindow()).toBe(SNAPSHOT_TEXT);
      });
      expect(cardPicker()).toBe(
        `Custom ${SNAPSHOT_START.toISOString()}..${SNAPSHOT_END.toISOString()}`,
      );
      expect(resetButtons()).toHaveLength(0);
    });

    test("Reset zoom after the refresh returns the card to the snapshot window", async () => {
      await openTheCompanionCard();
      await zoomTheCard();
      await refreshThePage(pageCase);

      await act(async () => {
        fireEvent.click(
          screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
        );
      });

      await waitFor(() => {
        expect(chartWindow()).toBe(SNAPSHOT_TEXT);
      });
      expect(resetButtons()).toHaveLength(0);
    });
  },
);
