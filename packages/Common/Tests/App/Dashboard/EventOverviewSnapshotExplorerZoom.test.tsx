/** @timezone UTC */

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
 * Issue #4105 on the incident and alert overview pages, for an event whose
 * monitor watched logs, traces or exceptions. The page holds the telemetry
 * snapshot's zoom above the snapshot card's tabs; the primary explorer is
 * pinned to the window that zoom shows and offered the zoom itself, so a
 * drag on its volume histogram zooms the WHOLE snapshot:
 *
 * - every companion tab (Metrics, and whichever of Logs, Traces and
 *   Exceptions the primary is not) queries exactly the dragged window;
 * - the badge offers the card's one "Reset zoom", and it and a double-click
 *   on the histogram return everything to the snapshot window;
 * - the page's background refresh re-reads an equal snapshot and keeps the
 *   zoom, a refresh that brings back another window ends it, and another
 *   event (the page stays mounted) starts unzoomed.
 *
 * The pages are rendered for real with every heavy card stubbed (the stubs
 * of EventOverviewSnapshotZoomAcrossTabs.test), and so are the snapshot
 * card, its tabs and the explorers, the Dashboard ones and the shells they
 * render. The APIs are mocked so every request can be read back; recharts
 * is stood in for so the histograms can be dragged, and the companion
 * metric card's charts by buttons.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <div data-testid="metric-charts" />;
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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return <span data-testid="card-picker" />;
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
      getFriendlyErrorMessage: () => {
        return "error";
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
      count: () => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
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

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  interface StubRow {
    time: string;
  }

  interface StubChartProps {
    data: Array<StubRow>;
    children?: React.ReactNode;
    onMouseDown?: (state: { activeLabel: string }) => void;
    onMouseMove?: (state: { activeLabel: string }) => void;
    onMouseUp?: (state: { activeLabel: string }) => void;
  }

  const chart: (props: StubChartProps) => React.ReactElement = (
    props: StubChartProps,
  ): React.ReactElement => {
    return react.createElement(
      "div",
      null,
      props.data.map((row: StubRow) => {
        return react.createElement("div", {
          key: row.time,
          "data-testid": `bucket-${row.time}`,
          onMouseDown: () => {
            props.onMouseDown?.({ activeLabel: row.time });
          },
          onMouseMove: () => {
            props.onMouseMove?.({ activeLabel: row.time });
          },
          onMouseUp: () => {
            props.onMouseUp?.({ activeLabel: row.time });
          },
        });
      }),
      props.children,
    );
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    LineChart: chart,
    Area: nothing,
    Bar: nothing,
    Line: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
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
import { getTimeRangeButtonLabel } from "../../../UI/Components/Date/TimeRangePickerDropdown";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Log from "../../../Models/AnalyticsModels/Log";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Span from "../../../Models/AnalyticsModels/Span";
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
import TimeRange from "../../../Types/Time/TimeRange";
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
const NEXT_TEXT: string = `${NEXT_START.toISOString()}..${NEXT_END.toISOString()}`;

// The volume charts' bars, a minute each; a drag across all of them.
const BAR_1750: string = "2026-09-14 17:50:00";
const BAR_1754: string = "2026-09-14 17:54:00";
const BARS: Array<string> = [
  BAR_1750,
  "2026-09-14 17:51:00",
  "2026-09-14 17:52:00",
  "2026-09-14 17:53:00",
  BAR_1754,
];
const SLICE_TEXT: string = "2026-09-14T17:50:00.000Z..2026-09-14T17:55:00.000Z";

const LOGS_HISTOGRAM: string = "/telemetry/logs/histogram";
const TRACES_HISTOGRAM: string = "/telemetry/traces/histogram";
const EXCEPTIONS_HISTOGRAM: string = "/telemetry/exceptions/histogram";

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
let mockEventId: string = EVENT_ID;

function textOf(window: { startValue: Date; endValue: Date }): string {
  return `${OneUptimeDate.fromString(window.startValue).toISOString()}..${OneUptimeDate.fromString(window.endValue).toISOString()}`;
}

function labelOf(text: string): string {
  const [startIso, endIso] = text.split("..") as [string, string];
  return getTimeRangeButtonLabel({
    range: TimeRange.CUSTOM,
    startAndEndDate: new InBetween<Date>(new Date(startIso), new Date(endIso)),
  });
}

type WindowSource = () => Array<string>;

function postedWindows(path: string): Array<string> {
  return postMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as {
        url: { toString: () => string };
        data: Record<string, unknown>;
      };
    })
    .filter((args: { url: { toString: () => string } }): boolean => {
      return args.url.toString().includes(path);
    })
    .map((args: { data: Record<string, unknown> }): string => {
      return `${args.data["startTime"]}..${args.data["endTime"]}`;
    });
}

function listedWindows(modelType: unknown, field: string): Array<string> {
  return analyticsGetListMock.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { modelType: unknown; query: Record<string, unknown> };
    })
    .filter((request: { modelType: unknown }): boolean => {
      return request.modelType === modelType;
    })
    .map((request: { query: Record<string, unknown> }): string => {
      return textOf(request.query[field] as InBetween<Date>);
    });
}

const LOG_LIST: WindowSource = (): Array<string> => {
  return listedWindows(Log, "time");
};
const LOG_VOLUME: WindowSource = (): Array<string> => {
  return postedWindows(LOGS_HISTOGRAM);
};
const SPAN_LIST: WindowSource = (): Array<string> => {
  return listedWindows(Span, "startTime");
};
const SPAN_VOLUME: WindowSource = (): Array<string> => {
  return postedWindows(TRACES_HISTOGRAM);
};
const EXCEPTION_SCOPE: WindowSource = (): Array<string> => {
  return listedWindows(ExceptionInstance, "time");
};
const EXCEPTION_VOLUME: WindowSource = (): Array<string> => {
  return postedWindows(EXCEPTIONS_HISTOGRAM);
};
const METRIC_LOOKUP: WindowSource = (): Array<string> => {
  return listedWindows(Metric, "time");
};
const METRIC_CHARTS: WindowSource = (): Array<string> => {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): string => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return textOf(data.startAndEndDate!);
  });
};

function last(windows: Array<string>): string | undefined {
  return windows[windows.length - 1];
}

function countsOf(sources: Array<WindowSource>): Array<number> {
  return sources.map((source: WindowSource): number => {
    return source().length;
  });
}

function askedSince(
  sources: Array<WindowSource>,
  counts: Array<number>,
): Array<string> {
  const asked: Array<string> = [];
  sources.forEach((source: WindowSource, index: number) => {
    asked.push(...source().slice(counts[index]));
  });
  return asked;
}

async function expectLatest(
  sources: Array<WindowSource>,
  windowText: string,
): Promise<void> {
  await waitFor(() => {
    expect(
      sources.map((source: WindowSource): string | undefined => {
        return last(source());
      }),
    ).toEqual(
      sources.map((): string => {
        return windowText;
      }),
    );
  });
}

function resetButtons(): Array<HTMLElement> {
  return screen.queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID);
}

function badgeTitle(): string {
  return OneUptimeDate.getInBetweenDatesAsFormattedString(
    new InBetween<Date>(SNAPSHOT_START, SNAPSHOT_END),
  );
}

// The snapshot badge's Reset zoom: the one right before the badge's window.
function badgeResetButtons(): Array<HTMLElement> {
  return resetButtons().filter((button: HTMLElement): boolean => {
    const next: Element | null = button.nextElementSibling;
    return (
      next !== null &&
      within(next as HTMLElement).queryByText(badgeTitle()) !== null
    );
  });
}

interface CompanionCase {
  tab: string;
  sources: Array<WindowSource>;
}

const METRICS: CompanionCase = {
  tab: "Metrics",
  sources: [METRIC_LOOKUP, METRIC_CHARTS],
};
const LOGS: CompanionCase = { tab: "Logs", sources: [LOG_LIST, LOG_VOLUME] };
const TRACES: CompanionCase = {
  tab: "Traces",
  sources: [SPAN_LIST, SPAN_VOLUME],
};
const EXCEPTIONS: CompanionCase = {
  tab: "Exceptions",
  sources: [EXCEPTION_SCOPE, EXCEPTION_VOLUME],
};

interface PrimaryCase {
  name: string;
  // As the monitor stores it on the event.
  storedType: string;
  windowField: string;
  pickerPrefix: string;
  self: CompanionCase;
  companions: Array<CompanionCase>;
}

const PRIMARIES: Array<PrimaryCase> = [
  {
    name: "Logs",
    storedType: "Log",
    windowField: "time",
    pickerPrefix: "log-time-range-picker",
    self: LOGS,
    companions: [TRACES, METRICS, EXCEPTIONS],
  },
  {
    name: "Traces",
    storedType: "Trace",
    windowField: "startTime",
    pickerPrefix: "telemetry-time-range-picker",
    self: TRACES,
    companions: [LOGS, METRICS, EXCEPTIONS],
  },
  {
    name: "Exceptions",
    storedType: "Exception",
    windowField: "time",
    pickerPrefix: "telemetry-time-range-picker",
    self: EXCEPTIONS,
    companions: [LOGS, TRACES, METRICS],
  },
];

let mockPrimary: PrimaryCase = PRIMARIES[0]!;

/*
 * The telemetryQuery exactly as the row stores it: serialized to JSON, so
 * the window's bounds come back as ISO strings.
 */
function storedSnapshot(): JSONObject {
  return {
    telemetryType: mockPrimary.storedType,
    telemetryQuery: {
      [mockPrimary.windowField]: JSONFunctions.anyObjectToJSONObject(
        new InBetween<Date>(mockStoredWindow.start, mockStoredWindow.end),
      ),
    },
    metricViewData: null,
  };
}

interface PageCase {
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
  stateModel: IncidentState,
  timelineModel: IncidentStateTimeline,
  changeStateKey: "ChangeIncidentState",
  buildEvent: (): Incident => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(mockEventId);
    incident.title = "Checkout errors";
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
  stateModel: AlertState,
  timelineModel: AlertStateTimeline,
  changeStateKey: "ChangeAlertState",
  buildEvent: (): Alert => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(mockEventId);
    alert.title = "Checkout errors";
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

function latestProps(key: string): Record<string, unknown> {
  const calls: Array<Record<string, unknown>> = recordedProps[key] || [];
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]!;
}

// The primary explorer has drawn its volume chart's bars.
async function volumeChartDrawn(): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId(`bucket-${BAR_1750}`)).toBeInTheDocument();
  });
}

async function renderSettled(pageCase: PageCase): Promise<RenderResult> {
  serve(pageCase);
  let rendered: RenderResult | null = null;
  await act(async () => {
    rendered = render(pageCase.page());
  });
  await volumeChartDrawn();
  await expectLatest(mockPrimary.self.sources, SNAPSHOT_TEXT);
  return rendered!;
}

function pickerLabel(): string {
  return (
    screen.getByTestId(`${mockPrimary.pickerPrefix}-button`).textContent || ""
  ).trim();
}

async function openTab(name: string): Promise<void> {
  const tab: HTMLElement = await screen.findByRole("tab", { name: name });
  await act(async () => {
    fireEvent.click(tab);
  });
}

// A drag across the primary's volume chart that zooms the WHOLE snapshot.
async function zoomFromThePrimary(): Promise<void> {
  fireEvent.mouseDown(screen.getByTestId(`bucket-${BAR_1750}`));
  fireEvent.mouseMove(screen.getByTestId(`bucket-${BAR_1754}`));
  fireEvent.mouseUp(screen.getByTestId(`bucket-${BAR_1754}`));

  await waitFor(() => {
    expect(badgeResetButtons()).toHaveLength(1);
  });
  await expectLatest(mockPrimary.self.sources, SLICE_TEXT);
}

// The element the primary's volume histogram takes its double-click on.
function histogramPlot(): HTMLElement {
  return screen.getByTestId(`bucket-${BAR_1750}`).parentElement!.parentElement!
    .parentElement!;
}

async function expectCompanionsOn(windowText: string): Promise<void> {
  for (const companion of mockPrimary.companions) {
    const counts: Array<number> = countsOf(companion.sources);
    await openTab(companion.tab);
    await waitFor(() => {
      countsOf(companion.sources).forEach((count: number, index: number) => {
        expect(count).toBeGreaterThan(counts[index]!);
      });
    });
    for (const window of askedSince(companion.sources, counts)) {
      expect(`${companion.tab}: ${window}`).toBe(
        `${companion.tab}: ${windowText}`,
      );
    }
  }
}

async function backOnThePrimary(): Promise<void> {
  await openTab(mockPrimary.self.tab);
  await volumeChartDrawn();
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

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockStoredWindow = { start: SNAPSHOT_START, end: SNAPSHOT_END };
  mockEventId = EVENT_ID;
  getListMock.mockReset();
  getItemMock.mockReset();
  analyticsGetListMock.mockReset();
  postMock.mockReset();
  fetchResultsMock.mockReset();
  analyticsGetListMock.mockImplementation(
    async (request: { modelType: unknown }) => {
      if (request.modelType === Metric) {
        return { data: [{ name: "checkout.latency" }], count: 1 };
      }
      return { data: [], count: 0 };
    },
  );
  postMock.mockImplementation(
    async (args: { url: { toString: () => string } }) => {
      const url: string = args.url.toString();

      if (url.includes(LOGS_HISTOGRAM)) {
        return {
          data: {
            bucketSizeInMinutes: 1,
            buckets: BARS.map((time: string) => {
              return { time, severity: "Error", count: 2 };
            }),
          },
        };
      }

      if (
        url.includes(TRACES_HISTOGRAM) ||
        url.includes(EXCEPTIONS_HISTOGRAM)
      ) {
        return {
          data: {
            buckets: BARS.map((time: string) => {
              return { time, series: "ok", count: 3 };
            }),
          },
        };
      }

      return { data: {} };
    },
  );
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
    return new ObjectID(mockEventId);
  });
  jest.spyOn(PermissionUtil, "getAllPermissions").mockImplementation(() => {
    return [Permission.ProjectMember];
  });
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("33333333-3333-4333-8333-333333333333"));
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  for (const key of Object.keys(recordedProps)) {
    delete recordedProps[key];
  }
  jest.restoreAllMocks();
  jest.useRealTimers();
  window.history.replaceState({}, "", "/");
});

const CASES: Array<[string, PageCase, string, PrimaryCase]> = [];
for (const [pageName, pageCase] of [
  ["incident", INCIDENT_CASE],
  ["alert", ALERT_CASE],
] as Array<[string, PageCase]>) {
  for (const primary of PRIMARIES) {
    CASES.push([pageName, pageCase, primary.name, primary]);
  }
}

describe.each(CASES)(
  "the %s overview's %s snapshot: a drag on the primary explorer's histogram zooms the whole snapshot",
  (
    _pageName: string,
    pageCase: PageCase,
    _primaryName: string,
    primary: PrimaryCase,
  ) => {
    beforeEach(() => {
      mockPrimary = primary;
    });

    test("every companion tab queries exactly the dragged window, and a zoom is not a reload of the page", async () => {
      await renderSettled(pageCase);
      const pageReads: number = getItemMock.mock.calls.length;

      await zoomFromThePrimary();

      expect(pickerLabel()).toBe(labelOf(SLICE_TEXT));
      await expectCompanionsOn(SLICE_TEXT);
      expect(getItemMock.mock.calls.length).toBe(pageReads);
    });

    test("the badge offers the card's one Reset zoom, which returns everything to the snapshot window", async () => {
      await renderSettled(pageCase);
      await zoomFromThePrimary();

      const tabPanel: HTMLElement = screen.getByRole("tabpanel");
      expect(
        within(tabPanel).queryAllByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toEqual(badgeResetButtons());
      expect(badgeResetButtons()).toHaveLength(1);

      fireEvent.click(badgeResetButtons()[0]!);

      await expectLatest(mockPrimary.self.sources, SNAPSHOT_TEXT);
      expect(pickerLabel()).toBe(labelOf(SNAPSHOT_TEXT));
      expect(resetButtons()).toHaveLength(0);
      await expectCompanionsOn(SNAPSHOT_TEXT);
    });

    test("a double-click on the primary's histogram returns everything to the snapshot window", async () => {
      await renderSettled(pageCase);
      await zoomFromThePrimary();
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });

      fireEvent.doubleClick(histogramPlot());

      await expectLatest(mockPrimary.self.sources, SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
      await expectCompanionsOn(SNAPSHOT_TEXT);
    });

    test("the page's background refresh keeps the zoom: the primary stays on the slice, with its ways back", async () => {
      await renderSettled(pageCase);
      await zoomFromThePrimary();
      const counts: Array<number> = countsOf(mockPrimary.self.sources);

      await refreshThePage(pageCase);

      expect(pickerLabel()).toBe(labelOf(SLICE_TEXT));
      expect(badgeResetButtons()).toHaveLength(1);
      expect(resetButtons()).toHaveLength(1);
      for (const window of askedSince(mockPrimary.self.sources, counts)) {
        expect(window).toBe(SLICE_TEXT);
      }

      // And the double-click still resets the whole snapshot.
      await waitFor(() => {
        expect(screen.getByText("Double-click to reset")).toBeInTheDocument();
      });
      fireEvent.doubleClick(histogramPlot());
      await expectLatest(mockPrimary.self.sources, SNAPSHOT_TEXT);
      expect(resetButtons()).toHaveLength(0);
    });

    test("after the refresh, every companion tab is still on the slice", async () => {
      await renderSettled(pageCase);
      await zoomFromThePrimary();

      await refreshThePage(pageCase);

      await expectCompanionsOn(SLICE_TEXT);
    });

    test("a refresh that brings back a different window ends the zoom on every tab", async () => {
      await renderSettled(pageCase);
      await zoomFromThePrimary();

      mockStoredWindow = { start: NEXT_START, end: NEXT_END };
      await refreshThePage(pageCase);

      await expectLatest(mockPrimary.self.sources, NEXT_TEXT);
      expect(pickerLabel()).toBe(labelOf(NEXT_TEXT));
      expect(resetButtons()).toHaveLength(0);
      await expectCompanionsOn(NEXT_TEXT);
    });

    test("another event from the same evaluation (same window) starts unzoomed, and so does coming back", async () => {
      const rendered: RenderResult = await renderSettled(pageCase);
      await zoomFromThePrimary();

      // The reader follows a link to the sibling event: same route, same page.
      mockEventId = SIBLING_EVENT_ID;
      await act(async () => {
        rendered.rerender(pageCase.page());
      });
      await volumeChartDrawn();

      await expectLatest(mockPrimary.self.sources, SNAPSHOT_TEXT);
      expect(pickerLabel()).toBe(labelOf(SNAPSHOT_TEXT));
      expect(resetButtons()).toHaveLength(0);

      // And back to the first one: its zoom stayed behind with it.
      mockEventId = EVENT_ID;
      await act(async () => {
        rendered.rerender(pageCase.page());
      });
      await volumeChartDrawn();

      await expectLatest(mockPrimary.self.sources, SNAPSHOT_TEXT);
      expect(pickerLabel()).toBe(labelOf(SNAPSHOT_TEXT));
      expect(resetButtons()).toHaveLength(0);
    });

    test("the zoom outlives a switch to another tab and back", async () => {
      await renderSettled(pageCase);
      await zoomFromThePrimary();
      await openTab(mockPrimary.companions[0]!.tab);
      const counts: Array<number> = countsOf(mockPrimary.self.sources);

      await backOnThePrimary();

      await waitFor(() => {
        expect(
          askedSince(mockPrimary.self.sources, counts).length,
        ).toBeGreaterThan(0);
      });
      for (const window of askedSince(mockPrimary.self.sources, counts)) {
        expect(window).toBe(SLICE_TEXT);
      }
      expect(pickerLabel()).toBe(labelOf(SLICE_TEXT));
      expect(badgeResetButtons()).toHaveLength(1);
    });
  },
);
