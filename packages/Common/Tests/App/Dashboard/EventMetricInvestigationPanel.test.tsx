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
 * The telemetry card of an incident, alert or episode a metrics monitor
 * opened (issue #5954): the metric investigation on its Metrics tab, and
 * the Logs, Traces and Exceptions tabs on the same time range - picked on
 * any tab, or zoomed on the metric chart - with the event's moments marked.
 *
 * The panel, the investigation, MetricView and the companion tabs are
 * real; the charts, the metric reads, the other events' markers and the
 * explorers inside the companion tabs are stood in for.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const eventLinesInputs: Array<Record<string, unknown>> = [];
// The query each stood-in explorer was handed last, by explorer.
const viewerQueries: Record<string, Record<string, unknown>> = {};

interface MockChartsProps {
  metricViewData: {
    startAndEndDate: { startValue: Date; endValue: Date } | null;
  };
  timeReferenceLines?:
    | Array<{ label?: string; subtitle?: string; color?: string }>
    | undefined;
  referenceRegions?: Array<{ label?: string; subtitle?: string }> | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
}

let lastCharts: MockChartsProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        lastCharts = props;
        return (
          <button
            type="button"
            onClick={() => {
              props.onTimeRangeSelect?.(
                new Date("2026-11-05T05:40:00.000Z"),
                new Date("2026-11-05T05:50:00.000Z"),
              );
            }}
          >
            Drag across the chart
          </button>
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

function mockViewer(name: string, queryProp: string): unknown {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): React.ReactElement => {
      viewerQueries[name] = props[queryProp] as Record<string, unknown>;
      return <div data-testid={`viewer-${name}`} />;
    },
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return mockViewer("logs", "logQuery");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer",
  () => {
    return mockViewer("traces", "spanQuery");
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer",
  () => {
    return mockViewer("exceptions", "exceptionInstanceQuery");
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

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import EventMetricInvestigationPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/EventMetricInvestigationPanel";
import TelemetrySnapshotPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySnapshotPanel";
import { EventMetricSubject } from "../../../../App/FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryQuery } from "../../../Types/Telemetry/TelemetryQuery";
import TelemetryType from "../../../Types/Telemetry/TelemetryType";

const NOW: Date = new Date("2026-11-05T09:00:00.000Z");
const STARTED_AT: Date = new Date("2026-11-05T05:44:00.000Z");
const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:39:00.000Z"),
  new Date("2026-11-05T05:44:00.000Z"),
);

function metricQuery(queryCount: number = 1): TelemetryQuery {
  return {
    telemetryType: TelemetryType.Metric,
    telemetryQuery: null,
    metricViewData: {
      startAndEndDate: EVALUATED,
      queryConfigs: Array.from({ length: queryCount }).map(() => {
        return {
          metricAliasData: {
            metricVariable: "a",
            title: "",
            description: "",
            legend: "",
            legendUnit: "",
          },
          metricQueryData: {
            filterData: {
              metricName: "pod_memory_limit_saturation",
              attributes: {
                "resource.k8s.pod.name": "clickhouse-0",
              } as never,
              aggegationType: MetricsAggregationType.Avg,
            },
            groupByAttributeKeys: ["resource.k8s.pod.name"],
          },
        };
      }),
      formulaConfigs: [],
    },
  };
}

const STATES: Array<{
  _id: string;
  name: string;
  isAcknowledgedState?: boolean;
  isResolvedState?: boolean;
}> = [
  { _id: "identified", name: "Identified" },
  { _id: "acknowledged", name: "Acknowledged", isAcknowledgedState: true },
  { _id: "resolved", name: "Resolved", isResolvedState: true },
];

const TIMELINE: Array<{ stateId: string; startsAt: Date }> = [
  { stateId: "identified", startsAt: STARTED_AT },
  { stateId: "acknowledged", startsAt: new Date("2026-11-05T05:52:00.000Z") },
  { stateId: "resolved", startsAt: new Date("2026-11-05T06:05:00.000Z") },
];

function renderIncident(
  overrides?: Partial<
    React.ComponentProps<typeof EventMetricInvestigationPanel>
  >,
): RenderResult {
  return render(
    <EventMetricInvestigationPanel
      telemetryQuery={metricQuery()}
      evaluationWindow={EVALUATED}
      seriesSummary="resource.k8s.pod.name = clickhouse-0"
      subject={EventMetricSubject.Incident}
      eventId="incident-1"
      startedAt={STARTED_AT}
      endedAt={new Date("2026-11-05T06:05:00.000Z")}
      stateTimeline={TIMELINE}
      states={STATES}
      {...overrides}
    />,
  );
}

function lastFetchedEnd(): string | undefined {
  const calls: Array<Array<unknown>> = fetchResultsMock.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];

  return (
    last?.[0] as
      | { metricViewData: { startAndEndDate: InBetween<Date> } }
      | undefined
  )?.metricViewData.startAndEndDate.endValue.toISOString();
}

function windowOf(
  query: Record<string, unknown> | undefined,
): [string, string] {
  const window: InBetween<Date> = (query?.["time"] ||
    query?.["startTime"]) as InBetween<Date>;

  return [window.startValue.toISOString(), window.endValue.toISOString()];
}

async function metricsShown(): Promise<void> {
  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Drag across the chart" }),
    ).toBeInTheDocument();
  });
}

function openTab(name: string): void {
  fireEvent.click(screen.getByRole("tab", { name: name }));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/dashboard/p/incidents/incident-1");
  fetchResultsMock.mockReset();
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
  eventLinesInputs.length = 0;
  lastCharts = null;
  for (const key of Object.keys(viewerQueries)) {
    delete viewerQueries[key];
  }
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("an incident a metrics monitor opened", () => {
  test("its Metrics tab comes first, with the investigation around the start", async () => {
    renderIncident();
    await metricsShown();

    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return tab.textContent || "";
      }),
    ).toEqual(["Metrics", "Logs", "Traces", "Exceptions"]);
    expect(
      screen.getByText(
        "Metrics related to this incident, scoped to the affected series (resource.k8s.pod.name = clickhouse-0).",
      ),
    ).toBeVisible();
    expect(
      screen.getByTestId("metric-investigation-time-button"),
    ).toHaveTextContent("Around the start");
    expect(lastFetchedEnd()).toBe("2026-11-05T06:14:00.000Z");
  });

  test("its moments are marked, and what the monitor evaluated is shaded", async () => {
    renderIncident();
    await metricsShown();

    expect(
      (lastCharts?.timeReferenceLines || []).map(
        (line: { label?: string; subtitle?: string }): string => {
          return `${line.label} (${line.subtitle})`;
        },
      ),
    ).toEqual([
      "Declared (This incident)",
      "Acknowledged (This incident)",
      "Resolved (This incident)",
    ]);
    expect(
      (lastCharts?.referenceRegions || []).map(
        (region: { label?: string; subtitle?: string }): string => {
          return `${region.label}: ${region.subtitle}`;
        },
      ),
    ).toEqual([
      "What the monitor saw: What the monitor evaluated when it opened this incident.",
    ]);
  });

  test("the incident itself is left out of the other events marked", async () => {
    renderIncident();
    await metricsShown();

    const input: Record<string, unknown> =
      eventLinesInputs[eventLinesInputs.length - 1]!;

    expect(input["excludedIncidentIds"]).toEqual(["incident-1"]);
    expect(input["excludedAlertIds"]).toBeUndefined();
  });

  test("the other tabs show the time range the metrics show, and say so", async () => {
    renderIncident();
    await metricsShown();

    openTab("Logs");

    expect(
      screen.getByText(
        "Logs in this incident's telemetry scope during the selected time range.",
      ),
    ).toBeVisible();
    expect(windowOf(viewerQueries["logs"])).toEqual([
      "2026-11-05T05:14:00.000Z",
      "2026-11-05T06:14:00.000Z",
    ]);
    // The same picker sits on this tab's card, naming the same range.
    expect(
      screen.getByTestId("metric-investigation-time-button"),
    ).toHaveTextContent("Around the start");
  });

  test("a range picked on another tab moves every tab, the metrics included", async () => {
    renderIncident();
    await metricsShown();

    openTab("Traces");
    fireEvent.click(screen.getByTestId("metric-investigation-time-button"));
    fireEvent.click(screen.getByText("The hour before it started"));

    await waitFor(() => {
      expect(windowOf(viewerQueries["traces"])).toEqual([
        "2026-11-05T04:44:00.000Z",
        "2026-11-05T05:44:00.000Z",
      ]);
    });

    openTab("Metrics");

    await waitFor(() => {
      expect(lastFetchedEnd()).toBe("2026-11-05T05:44:00.000Z");
    });
    expect(
      screen.getByTestId("metric-investigation-time-button"),
    ).toHaveTextContent("The hour before it started");
  });

  test("a drag on the metric chart zooms every tab, and Reset zoom on another tab goes back", async () => {
    renderIncident();
    await metricsShown();

    fireEvent.click(
      screen.getByRole("button", { name: "Drag across the chart" }),
    );

    await waitFor(() => {
      expect(lastFetchedEnd()).toBe("2026-11-05T05:50:00.000Z");
    });

    openTab("Exceptions");

    expect(windowOf(viewerQueries["exceptions"])).toEqual([
      "2026-11-05T05:40:00.000Z",
      "2026-11-05T05:50:00.000Z",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    await waitFor(() => {
      expect(windowOf(viewerQueries["exceptions"])).toEqual([
        "2026-11-05T05:14:00.000Z",
        "2026-11-05T06:14:00.000Z",
      ]);
    });
  });

  test("the investigation outlives a switch of tabs", async () => {
    renderIncident();
    await metricsShown();

    fireEvent.click(screen.getByTestId("metric-investigation-time-button"));
    fireEvent.click(screen.getByText("Start to resolution"));

    openTab("Logs");
    openTab("Metrics");

    await waitFor(() => {
      expect(
        screen.getByTestId("metric-investigation-time-button"),
      ).toHaveTextContent("Start to resolution");
    });
    expect(lastFetchedEnd()).toBe("2026-11-05T06:20:00.000Z");
  });
});

describe("an alert a metrics monitor opened", () => {
  test("speaks of the alert, and leaves the alert out of the other events marked", async () => {
    renderIncident({
      subject: EventMetricSubject.Alert,
      eventId: "alert-1",
      seriesSummary: "",
    });
    await metricsShown();

    expect(screen.getByText("Metrics for this alert.")).toBeVisible();
    expect(lastCharts?.timeReferenceLines?.[0]?.label).toBe("Created");
    expect(lastCharts?.timeReferenceLines?.[0]?.subtitle).toBe("This alert");

    const input: Record<string, unknown> =
      eventLinesInputs[eventLinesInputs.length - 1]!;

    expect(input["excludedAlertIds"]).toEqual(["alert-1"]);
    expect(input["excludedIncidentIds"]).toBeUndefined();

    fireEvent.click(screen.getByTestId("metric-investigation-time-button"));

    expect(
      within(
        screen.getByTestId("metric-investigation-time-dropdown"),
      ).getByText("Around this alert"),
    ).toBeVisible();
  });
});

describe("a snapshot with nothing to chart", () => {
  test("leaves the card out, as it always did", () => {
    const rendered: RenderResult = renderIncident({
      telemetryQuery: metricQuery(0),
    });

    expect(rendered.container).toBeEmptyDOMElement();
  });
});

describe("an episode's snapshot", () => {
  test("is the same investigation, anchored on the episode, its members left marked", async () => {
    render(
      <TelemetrySnapshotPanel
        telemetryQuery={metricQuery()}
        snapshotWindow={EVALUATED}
        seriesSummary=""
        eventNoun="incident"
        metricSubject={EventMetricSubject.IncidentEpisode}
        startedAt={STARTED_AT}
        stateTimeline={TIMELINE.slice(0, 2)}
        states={STATES}
      />,
    );
    await metricsShown();

    expect(
      screen.getByTestId("metric-investigation-time-button"),
    ).toHaveTextContent("Around the start");
    expect(lastCharts?.timeReferenceLines?.[0]?.subtitle).toBe("This episode");

    const input: Record<string, unknown> =
      eventLinesInputs[eventLinesInputs.length - 1]!;

    expect(input["excludedIncidentIds"]).toBeUndefined();
  });

  test("an alert episode reads as one without saying which", async () => {
    render(
      <TelemetrySnapshotPanel
        telemetryQuery={metricQuery()}
        snapshotWindow={EVALUATED}
        seriesSummary=""
        eventNoun="alert"
      />,
    );
    await metricsShown();

    fireEvent.click(screen.getByTestId("metric-investigation-time-button"));

    expect(
      within(
        screen.getByTestId("metric-investigation-time-dropdown"),
      ).getByText("Around this episode"),
    ).toBeVisible();
    expect(screen.getByText("Metrics for this alert.")).toBeVisible();
  });
});
