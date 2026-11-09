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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The metric investigation card (issue #5954), rendered: its time picker
 * with the ranges around the incident, the explorer's query builder under
 * Edit metrics, Reset and Copy link once something changed, the incident's
 * moments on the charts, a drag that zooms, Refresh, and Open in Metric
 * Explorer carrying what is on screen.
 *
 * MetricView, the picker and the card are real. The charts are stood in for
 * by what MetricView hands them, with buttons for the drag and the
 * double-click; the metric reads and the event markers of other incidents
 * are stood in for too.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const eventLinesInputs: Array<Record<string, unknown>> = [];

interface MockChartsProps {
  metricViewData: {
    startAndEndDate: { startValue: Date; endValue: Date } | null;
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  timeReferenceLines?: Array<{ label?: string; subtitle?: string }> | undefined;
  referenceRegions?: Array<{ label?: string }> | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

let lastCharts: MockChartsProps | null = null;

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-11-05T05:30:00.000Z"),
  end: new Date("2026-11-05T05:50:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        lastCharts = props;

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
            metricTypes: [{ name: "pod_cpu_saturation" }],
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
        return {
          lines: [
            {
              date: new Date("2026-11-05T05:40:00.000Z"),
              label: "Deploy: checkout v2",
              subtitle: "Change event",
            },
          ],
          markerCount: 1,
        };
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

import MetricInvestigation from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigation";
import useMetricInvestigation, {
  MetricInvestigationState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/UseMetricInvestigation";
import { MetricInvestigationTimePreset } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Investigation/MetricInvestigationTime";
import {
  EVENT_AROUND_START_SELECTION,
  EVENT_RELATIVE_TIME_RANGES,
  getEventTimePresets,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/EventTimePresets";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import ObjectID from "../../../Types/ObjectID";
import URL from "../../../Types/API/URL";
import ChartReferenceRegionProps from "../../../UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "../../../UI/Components/Charts/Types/TimeReferenceLineProps";
import Navigation from "../../../UI/Utils/Navigation";

const NOW: Date = new Date("2026-11-05T09:00:00.000Z");
const STARTED_AT: Date = new Date("2026-11-05T05:44:00.000Z");
const EVALUATED: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-05T05:39:00.000Z"),
  new Date("2026-11-05T05:44:00.000Z"),
);
const METRIC: string = "pod_memory_limit_saturation";

const QUERY: MetricQueryConfigData = {
  metricAliasData: {
    metricVariable: "a",
    title: "",
    description: "",
    legend: "",
    legendUnit: "",
  },
  metricQueryData: {
    filterData: {
      metricName: METRIC,
      attributes: { "resource.k8s.pod.name": "clickhouse-0" } as never,
      aggegationType: MetricsAggregationType.Avg,
    },
  },
};

const MOMENTS: Array<ChartTimeReferenceLineProps> = [
  { date: STARTED_AT, label: "Declared", subtitle: "This incident" },
  // Long after the window around the start: not drawn there.
  {
    date: new Date("2026-11-05T08:30:00.000Z"),
    label: "Resolved",
    subtitle: "This incident",
  },
];

const REGIONS: Array<ChartReferenceRegionProps> = [
  {
    startDate: EVALUATED.startValue,
    endDate: EVALUATED.endValue,
    label: "What the monitor saw",
  },
];

let navigateSpy: ReturnType<typeof jest.spyOn> | null = null;

const Harness: React.FunctionComponent = (): React.ReactElement => {
  const investigation: MetricInvestigationState = useMetricInvestigation({
    defaultQueries: { queryConfigs: [QUERY], formulaConfigs: [] },
    getPresets: (now: Date): Array<MetricInvestigationTimePreset> => {
      return getEventTimePresets(
        { startedAt: STARTED_AT, evaluationWindow: EVALUATED },
        now,
      );
    },
    defaultSelection: EVENT_AROUND_START_SELECTION,
    urlParamPrefix: "metrics",
  });

  return (
    <MetricInvestigation
      investigation={investigation}
      description="Metrics related to this incident."
      presetsHeading="Around this incident"
      relativeRanges={EVENT_RELATIVE_TIME_RANGES}
      moments={MOMENTS}
      regions={REGIONS}
      excludedIncidentIds={["incident-1"]}
    />
  );
};

function fetchedWindows(): Array<[string, string]> {
  return fetchResultsMock.mock.calls.map(
    (call: Array<unknown>): [string, string] => {
      const data: MetricViewData = (
        call[0] as { metricViewData: MetricViewData }
      ).metricViewData;
      return [
        data.startAndEndDate!.startValue.toISOString(),
        data.startAndEndDate!.endValue.toISOString(),
      ];
    },
  );
}

function lastFetchedWindow(): [string, string] | undefined {
  const windows: Array<[string, string]> = fetchedWindows();
  return windows[windows.length - 1];
}

async function chartsShown(): Promise<void> {
  await waitFor(() => {
    expect(fetchResultsMock).toHaveBeenCalled();
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
}

function pickerButton(): HTMLElement {
  return screen.getByTestId("metric-investigation-time-button");
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
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  navigateSpy?.mockRestore();
  jest.useRealTimers();
});

describe("what the card shows before anybody touches it", () => {
  test("the incident's metric, around the start, named on the picker", async () => {
    render(<Harness />);
    await chartsShown();

    expect(screen.getByText("Metrics")).toBeInTheDocument();
    expect(
      screen.getByText("Metrics related to this incident."),
    ).toBeInTheDocument();
    expect(pickerButton()).toHaveTextContent("Around the start");
    // The window the start of the incident is in the middle of.
    expect(lastFetchedWindow()?.[1]).toBe("2026-11-05T06:14:00.000Z");
    expect(new Date(lastFetchedWindow()![0]).getTime()).toBeLessThanOrEqual(
      new Date("2026-11-05T05:14:00.000Z").getTime(),
    );
    expect(
      String(
        lastCharts?.metricViewData.queryConfigs[0]?.metricQueryData.filterData
          .metricName,
      ),
    ).toBe(METRIC);
  });

  test("no Reset and no Copy link while nothing has changed", async () => {
    render(<Harness />);
    await chartsShown();

    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    expect(screen.queryByText("Copy link")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit metrics" }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("the incident's own moments in the window are marked, with the other events", async () => {
    render(<Harness />);
    await chartsShown();

    const labels: Array<string> = (lastCharts?.timeReferenceLines || []).map(
      (line: { label?: string }): string => {
        return line.label || "";
      },
    );

    expect(labels).toEqual(["Declared", "Deploy: checkout v2"]);
    expect(
      (lastCharts?.referenceRegions || []).map(
        (region: { label?: string }): string => {
          return region.label || "";
        },
      ),
    ).toEqual(["What the monitor saw"]);
  });

  test("the other events are read for the window and metrics shown, without the incident itself", async () => {
    render(<Harness />);
    await chartsShown();

    const input: Record<string, unknown> =
      eventLinesInputs[eventLinesInputs.length - 1]!;

    expect(input["enabled"]).toBe(true);
    expect(input["excludedIncidentIds"]).toEqual(["incident-1"]);
    expect((input["window"] as InBetween<Date>).endValue.toISOString()).toBe(
      "2026-11-05T06:14:00.000Z",
    );
    expect(input["queryConfigs"]).toEqual([QUERY]);
  });
});

describe("the time picker", () => {
  test("lists the ranges around the incident with what they cover, then the ranges relative to now", async () => {
    render(<Harness />);
    await chartsShown();

    fireEvent.click(pickerButton());

    const dropdown: HTMLElement = screen.getByTestId(
      "metric-investigation-time-dropdown",
    );

    expect(within(dropdown).getByText("Around this incident")).toBeVisible();
    expect(within(dropdown).getByText("Relative to now")).toBeVisible();

    for (const label of [
      "Around the start",
      "The hour before it started",
      "The day before it started",
      "Start to now",
      "What the monitor saw",
    ]) {
      expect(within(dropdown).getByText(label)).toBeVisible();
    }

    for (const label of [
      "Past 15 Minutes",
      "Past 1 Hour",
      "Past 3 Hours",
      "Past 1 Day",
      "Past 1 Week",
      "Custom Range...",
    ]) {
      expect(within(dropdown).getByText(label)).toBeVisible();
    }

    // Only the few relative ranges an incident needs.
    expect(within(dropdown).queryByText("Past 3 Months")).toBeNull();

    // The one on screen is marked, and no relative range with it.
    expect(
      screen.getByTestId("metric-investigation-time-moment-around-start"),
    ).toHaveClass("text-indigo-700");
    expect(within(dropdown).getByText("Past 1 Hour")).not.toHaveClass(
      "text-indigo-700",
    );
  });

  test("picking a range around the incident moves the charts, and names it", async () => {
    render(<Harness />);
    await chartsShown();

    fireEvent.click(pickerButton());
    fireEvent.click(screen.getByText("The hour before it started"));

    await waitFor(() => {
      expect(lastFetchedWindow()?.[1]).toBe("2026-11-05T05:44:00.000Z");
    });

    expect(pickerButton()).toHaveTextContent("The hour before it started");
    expect(
      screen.queryByTestId("metric-investigation-time-dropdown"),
    ).toBeNull();
    expect(new URLSearchParams(window.location.search).get("metricsTime")).toBe(
      "hour-before",
    );
    expect(screen.getByRole("button", { name: "Reset" })).toBeVisible();
    expect(screen.getByText("Copy link")).toBeVisible();
  });

  test("a range relative to now ends at now", async () => {
    render(<Harness />);
    await chartsShown();

    fireEvent.click(pickerButton());
    fireEvent.click(screen.getByText("Past 1 Hour"));

    /*
     * Now, as the picker read it: the waits above move the fake clock on
     * by a few ticks, so it is a moment after NOW.
     */
    await waitFor(() => {
      const [start, end]: [string, string] = lastFetchedWindow()!;
      const endMs: number = new Date(end).getTime();

      expect(endMs).toBeGreaterThanOrEqual(NOW.getTime());
      expect(endMs - NOW.getTime()).toBeLessThan(60 * 1000);
      expect(endMs - new Date(start).getTime()).toBeGreaterThanOrEqual(
        60 * 60 * 1000,
      );
    });
    expect(pickerButton()).toHaveTextContent("Past 1 Hour");
  });
});

describe("Edit metrics", () => {
  test("opens the explorer's query builder, and Done folds it away", async () => {
    render(<Harness />);
    await chartsShown();

    expect(screen.queryByRole("button", { name: "Add Metric" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));

    expect(
      await screen.findByRole("button", { name: "Add Metric" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Add Formula" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("button", { name: "Add Metric" })).toBeNull();
  });

  test("a metric added there is charted, says so, and Reset takes it back out", async () => {
    render(<Harness />);
    await chartsShown();

    fireEvent.click(screen.getByRole("button", { name: "Edit metrics" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add Metric" }));

    await waitFor(() => {
      expect(lastCharts?.metricViewData.queryConfigs).toHaveLength(2);
    });
    expect(screen.getByText("The metrics you picked.")).toBeVisible();
    expect(
      new URLSearchParams(window.location.search).get("metricsQueries"),
    ).toContain("pod_cpu_saturation");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));

    await waitFor(() => {
      expect(lastCharts?.metricViewData.queryConfigs).toHaveLength(1);
    });
    expect(screen.getByText("Metrics related to this incident.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
    // Reset folds the builder away too.
    expect(screen.queryByRole("button", { name: "Add Metric" })).toBeNull();
    expect(window.location.search).toBe("");
  });
});

describe("a drag across the chart", () => {
  test("zooms in, and Reset zoom beside the picker goes back", async () => {
    render(<Harness />);
    await chartsShown();

    expect(lastCharts?.onTimeRangeReset).toBeUndefined();

    fireEvent.click(screen.getByText("Drag across the chart"));

    await waitFor(() => {
      expect(lastFetchedWindow()?.[1]).toBe(MOCK_DRAG.end.toISOString());
    });
    expect(lastCharts?.onTimeRangeReset).toBeInstanceOf(Function);

    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));

    await waitFor(() => {
      expect(lastFetchedWindow()?.[1]).toBe("2026-11-05T06:14:00.000Z");
    });
    expect(pickerButton()).toHaveTextContent("Around the start");
    expect(screen.queryByRole("button", { name: "Reset zoom" })).toBeNull();
  });

  test("a double-click on the chart goes back too", async () => {
    render(<Harness />);
    await chartsShown();

    fireEvent.click(screen.getByText("Drag across the chart"));
    await waitFor(() => {
      expect(lastFetchedWindow()?.[1]).toBe(MOCK_DRAG.end.toISOString());
    });

    fireEvent.click(screen.getByText("Double-click the chart"));

    await waitFor(() => {
      expect(lastFetchedWindow()?.[1]).toBe("2026-11-05T06:14:00.000Z");
    });
  });
});

describe("the header's actions", () => {
  test("Refresh reads the charts again past their cache", async () => {
    render(<Harness />);
    await chartsShown();

    const callsBefore: number = fetchResultsMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      expect(fetchResultsMock.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    const lastCall: { refreshNonce?: unknown } = fetchResultsMock.mock.calls[
      fetchResultsMock.mock.calls.length - 1
    ]![0] as { refreshNonce?: unknown };

    expect(lastCall.refreshNonce).toBe(1);
  });

  test("Open in Metric Explorer carries the metrics and the time range on screen", async () => {
    render(<Harness />);
    await chartsShown();

    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Open in Metric Explorer" }),
      );
    });

    expect(navigateSpy).toHaveBeenCalledTimes(1);

    const target: URL = navigateSpy!.mock.calls[0]![0] as URL;
    const query: URLSearchParams = new URLSearchParams(
      target.toString().split("?")[1] || "",
    );

    expect(query.get("metricQueries")).toContain(METRIC);
    expect(query.get("metricQueries")).toContain("clickhouse-0");
    expect(query.get("startTime")).toBe("2026-11-05T05:14:00.000Z");
    expect(query.get("endTime")).toBe("2026-11-05T06:14:00.000Z");
    expect(query.get("range")).toBeNull();
  });
});
