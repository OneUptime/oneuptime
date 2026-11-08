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
  screen,
  waitFor,
} from "@testing-library/react";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #4105 on the incident and alert overview pages. Their "Telemetry
 * snapshot" charts the metric the monitor evaluated, pinned to the window
 * it evaluated over. That window is a record of what happened, not a range
 * anyone picks, so the chart refused a drag. A drag now zooms the whole
 * snapshot:
 *
 * - it re-queries the metric over the dragged window and hands that window
 *   to the snapshot's other tabs, without the page reloading;
 * - a double-click, or Reset zoom beside the card's time picker, returns to
 *   the range picked before;
 * - the page's background refresh (any state change or note) rebuilds the
 *   snapshot and must not throw the zoom away.
 *
 * Issue #5954 made a metrics monitor's snapshot a metric investigation: it
 * charts the metric around the event's start rather than the window the
 * monitor evaluated (which it shades), names that range on its picker, and
 * zooms, resets and keeps its zoom across the refresh as above, every tab
 * following it.
 *
 * The pages are rendered for real with every heavy card stubbed (the same
 * stubs as EventOverviewPages.test). The snapshot card hands the page's
 * primary element through untouched and records the window the page hands
 * its other tabs; the metric chart in it is the real MetricView with
 * MetricCharts stood in for by buttons that call exactly the handlers
 * MetricView hands the charts. EventOverviewSnapshotZoomAcrossTabs.test
 * renders the real tabs.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
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

interface MockChartsProps {
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  timeReferenceLines?: Array<{ label?: string; subtitle?: string }> | undefined;
  referenceRegions?: Array<{ label?: string }> | undefined;
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

// Other incidents, alerts and changes on the charts: none here.
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

// The snapshot card: records what the page hands it, renders the primary.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetryCompanionSignalTabs",
  () => {
    return {
      __esModule: true,
      default: (props: {
        primarySignalElement: ReactElement;
        snapshotWindow: unknown;
      }): ReactElement => {
        recordProps("Telemetry", props as unknown as Record<string, unknown>);
        return (
          <div data-testid="telemetry-snapshot">
            {props.primarySignalElement}
          </div>
        );
      },
    };
  },
);

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
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";

const EVENT_ID: string = "11111111-1111-4111-8111-111111111111";
const CREATED_STATE_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const NOW: Date = new Date("2026-09-14T19:00:00.000Z");
// The window the monitor evaluated over when it opened the event.
const SNAPSHOT_START: Date = new Date("2026-09-14T17:45:00.000Z");
const SNAPSHOT_END: Date = new Date("2026-09-14T18:00:00.000Z");
/*
 * What the investigation charts first: thirty minutes either side of the
 * event's start (SNAPSHOT_END), which takes in all that was evaluated.
 */
const AROUND_START_START: Date = new Date("2026-09-14T17:30:00.000Z");
const AROUND_START_END: Date = new Date("2026-09-14T18:30:00.000Z");

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function fetchedWindows(): Array<Window> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): Window => {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    return [
      data.startAndEndDate!.startValue.getTime(),
      data.startAndEndDate!.endValue.getTime(),
    ];
  });
}

function lastFetchedWindow(): Window | undefined {
  const windows: Array<Window> = fetchedWindows();
  return windows[windows.length - 1];
}

function charts(): MockChartsProps {
  if (!mockLatestCharts) {
    throw new Error("The snapshot chart has not rendered");
  }
  return mockLatestCharts;
}

// The window the page last handed the snapshot card for its other tabs.
function windowHandedToTheTabs(): Window {
  const telemetryCard: Array<Record<string, unknown>> =
    recordedProps["Telemetry"] || [];
  expect(telemetryCard.length).toBeGreaterThan(0);
  const window: InBetween<Date> = telemetryCard[telemetryCard.length - 1]![
    "snapshotWindow"
  ] as InBetween<Date>;
  return windowOf(window.startValue, window.endValue);
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
        new InBetween<Date>(SNAPSHOT_START, SNAPSHOT_END),
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

interface PageCase {
  noun: string;
  renderPage: () => void;
  stateModel: typeof IncidentState | typeof AlertState;
  timelineModel: typeof IncidentStateTimeline | typeof AlertStateTimeline;
  changeStateKey: string;
  buildEvent: () => Incident | Alert;
  buildStates: () => Array<IncidentState | AlertState>;
  buildTimeline: () => Array<IncidentStateTimeline | AlertStateTimeline>;
}

const INCIDENT_CASE: PageCase = {
  noun: "incident",
  renderPage: (): void => {
    render(<IncidentView {...PAGE_PROPS} />);
  },
  stateModel: IncidentState,
  timelineModel: IncidentStateTimeline,
  changeStateKey: "ChangeIncidentState",
  buildEvent: (): Incident => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(EVENT_ID);
    incident.title = "Checkout CPU saturated";
    incident.incidentNumber = 42;
    incident.declaredAt = SNAPSHOT_END;
    incident.telemetryQuery = storedMetricSnapshot() as never;
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
  noun: "alert",
  renderPage: (): void => {
    render(<AlertView {...PAGE_PROPS} />);
  },
  stateModel: AlertState,
  timelineModel: AlertStateTimeline,
  changeStateKey: "ChangeAlertState",
  buildEvent: (): Alert => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(EVENT_ID);
    alert.title = "Checkout CPU saturated";
    alert.alertNumber = 12;
    alert.createdAt = SNAPSHOT_END;
    alert.telemetryQuery = storedMetricSnapshot() as never;
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

async function renderSettled(pageCase: PageCase): Promise<void> {
  serve(pageCase);
  pageCase.renderPage();
  /*
   * MetricView draws its charts once before it loads, then shows a loader
   * until its first fetch lands: wait for that fetch and the charts after.
   */
  await waitFor(() => {
    expect(fetchedWindows().length).toBeGreaterThan(0);
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
}

async function press(label: string): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: label }));
}

// The range the investigation's picker names.
function pickedRange(): string {
  return (
    screen.getByTestId("metric-investigation-time-button").textContent || ""
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  // The investigation keeps what the reader changed in the page's URL.
  window.history.replaceState({}, "", "/");
  mockLatestCharts = null;
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockImplementation(() => {
    return new ObjectID(EVENT_ID);
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
  "the %s overview's telemetry snapshot",
  (_name: string, pageCase: PageCase) => {
    test("charts the metric around the start, names the range on its picker, and offers a drag", async () => {
      await renderSettled(pageCase);

      expect(lastFetchedWindow()).toEqual(
        windowOf(AROUND_START_START, AROUND_START_END),
      );
      expect(pickedRange()).toContain("Around the start");
      // What the monitor evaluated is shaded, not the whole chart.
      expect(
        (charts().referenceRegions || []).map(
          (region: { label?: string }): string => {
            return region.label || "";
          },
        ),
      ).toEqual(["What the monitor saw"]);
      // Its start is marked as its own page names it.
      expect(charts().timeReferenceLines?.[0]?.label).toBe(
        pageCase.noun === "incident" ? "Declared" : "Created",
      );
      expect(charts().onTimeRangeSelect).toBeInstanceOf(Function);
      expect(charts().onTimeRangeReset).toBeUndefined();
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
      // The other tabs are handed the same range.
      expect(windowHandedToTheTabs()).toEqual(
        windowOf(AROUND_START_START, AROUND_START_END),
      );
    });

    test("a drag zooms the whole card: no page reload, the other tabs handed the slice", async () => {
      await renderSettled(pageCase);
      const pageReads: number = getItemMock.mock.calls.length;

      await press("Drag across the snapshot chart");

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      });
      expect(getItemMock.mock.calls.length).toBe(pageReads);
      expect(pickedRange()).not.toContain("Around the start");
      // The card's other tabs follow the zoom: they show the slice.
      expect(windowHandedToTheTabs()).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
      expect(
        screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
    });

    test("a reset hands the other tabs the range picked before again", async () => {
      await renderSettled(pageCase);
      await press("Drag across the snapshot chart");
      await waitFor(() => {
        expect(windowHandedToTheTabs()).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      });

      fireEvent.click(
        await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      );

      await waitFor(() => {
        expect(windowHandedToTheTabs()).toEqual(
          windowOf(AROUND_START_START, AROUND_START_END),
        );
      });
      expect(pickedRange()).toContain("Around the start");
    });

    test("a double-click returns to the range picked before", async () => {
      await renderSettled(pageCase);

      await press("Drag across the snapshot chart");
      await waitFor(() => {
        expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      });
      await press("Double-click the snapshot chart");

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(
          windowOf(AROUND_START_START, AROUND_START_END),
        );
      });
      expect(charts().onTimeRangeReset).toBeUndefined();
      expect(
        screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeNull();
    });

    test("Reset zoom returns to it too", async () => {
      await renderSettled(pageCase);

      await press("Drag across the snapshot chart");
      fireEvent.click(
        await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      );

      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(
          windowOf(AROUND_START_START, AROUND_START_END),
        );
      });
    });

    test("the page's background refresh rebuilds the snapshot and keeps the zoom", async () => {
      await renderSettled(pageCase);

      await press("Drag across the snapshot chart");
      await waitFor(() => {
        expect(lastFetchedWindow()).toEqual(
          windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
        );
      });
      const pageReads: number = getItemMock.mock.calls.length;

      // A state change on the page: it re-reads the event in the background.
      const changeState: { onActionComplete: () => void } = recordedProps[
        pageCase.changeStateKey
      ]![recordedProps[pageCase.changeStateKey]!.length - 1] as unknown as {
        onActionComplete: () => void;
      };
      await act(async () => {
        changeState.onActionComplete();
      });
      await waitFor(() => {
        expect(getItemMock.mock.calls.length).toBeGreaterThan(pageReads);
      });

      // Still zoomed, still showing the dragged window, on every tab.
      expect(
        await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      ).toBeVisible();
      expect(lastFetchedWindow()).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
      expect(charts().onTimeRangeReset).toBeInstanceOf(Function);
      expect(windowHandedToTheTabs()).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });

    test("what the reader changed is in the page's address, and only that", async () => {
      await renderSettled(pageCase);

      expect(window.location.search).toBe("");

      await press("Drag across the snapshot chart");

      await waitFor(() => {
        expect(
          new URLSearchParams(window.location.search).get("metricsTime"),
        ).toBe("custom");
      });
      expect(
        new URLSearchParams(window.location.search).get("metricsStart"),
      ).toBe(MOCK_DRAG.start.toISOString());

      fireEvent.click(
        await screen.findByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
      );

      await waitFor(() => {
        expect(window.location.search).toBe("");
      });
    });
  },
);
