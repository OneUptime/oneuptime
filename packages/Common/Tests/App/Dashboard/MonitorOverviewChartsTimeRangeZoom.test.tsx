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
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission from "../../../Types/Permission";

/*
 * Issue #4105 on a monitor's Overview. The page owns no time range: each
 * chart on it is a card with a window of its own, so each zooms and resets
 * itself.
 *
 * - The response-time card (probe monitors) is an EmbeddedMetricCard over
 *   "Past 1 Day": a drag narrows the card, a double-click or its Reset
 *   zoom returns to the past day, and the page's minute poll must not drop
 *   the zoom.
 * - The metrics preview (metric monitors) charts the step's rolling range;
 *   MetricView zooms it through the preview's own state. The header, which
 *   used to keep naming a rolling range the chart no longer showed, names
 *   the zoomed window; picking a range, even the same one, ends the zoom.
 *
 * Real cards, real MetricView; only MetricCharts is stood in for, with
 * buttons that call exactly the handlers MetricView hands the charts.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  metricViewData: {
    queryConfigs: Array<{
      metricQueryData: { filterData: { metricName?: unknown } };
    }>;
  };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
}

const mockChartsByMetric: Record<string, MockChartsProps> = {};

const MOCK_DRAG: { start: Date; end: Date } = {
  start: new Date("2026-09-28T11:20:00.000Z"),
  end: new Date("2026-09-28T11:30:00.000Z"),
};

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: MockChartsProps): React.ReactElement => {
        const metricName: string = String(
          props.metricViewData.queryConfigs[0]?.metricQueryData.filterData
            .metricName || "",
        );
        mockChartsByMetric[metricName] = props;

        return (
          <div data-testid={`charts-${metricName}`}>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeSelect?.(MOCK_DRAG.start, MOCK_DRAG.end);
              }}
            >
              {`Drag across ${metricName}`}
            </button>
            <button
              type="button"
              onClick={() => {
                props.onTimeRangeReset?.();
              }}
            >
              {`Double-click ${metricName}`}
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

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: { dashboardStartAndEndDate: { range: string } }) => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
      );
    },
  };
});

// The rolling-range picker in the preview's modal, as a plain select.
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    default: (props: {
      options: Array<{ label: string; value: unknown }>;
      value?: { value: unknown } | undefined;
      onChange?: ((value: unknown) => void) | undefined;
    }) => {
      return (
        <select
          data-testid="rolling-time-dropdown"
          value={String(props.value?.value ?? "")}
          onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
            props.onChange?.(event.target.value);
          }}
        >
          <option value="">Select</option>
          {props.options.map((option: { label: string; value: unknown }) => {
            return (
              <option key={String(option.value)} value={String(option.value)}>
                {option.label}
              </option>
            );
          })}
        </select>
      );
    },
  };
});

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

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import MonitorResponseTimeCard, {
  ComponentProps as ResponseTimeCardProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorResponseTimeCard";
import MonitorTelemetryPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorTelemetryPreview";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import Probe from "../../../Models/DatabaseModels/Probe";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import TimeRange from "../../../Types/Time/TimeRange";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import { getZoomedWindowLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MetricMonitor/MetricMonitorPreview";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const DAY_AGO: Date = new Date("2026-09-27T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");
const SIX_HOURS_AGO: Date = new Date("2026-09-28T06:00:00.000Z");

const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESPONSE_TIME: string = String(MonitorMetricType.ResponseTime);
const PREVIEW_METRIC: string = "system.cpu.utilization";

type Window = [number, number];

function windowOf(start: Date, end: Date): Window {
  return [start.getTime(), end.getTime()];
}

function fetchedWindowsFor(metricName: string): Array<Window> {
  const windows: Array<Window> = [];
  for (const call of fetchResultsMock.mock.calls) {
    const data: MetricViewData = (call[0] as { metricViewData: MetricViewData })
      .metricViewData;
    const queried: boolean = data.queryConfigs.some(
      (queryConfig: MetricViewData["queryConfigs"][number]): boolean => {
        return (
          String(queryConfig.metricQueryData.filterData.metricName) ===
          metricName
        );
      },
    );
    if (queried && data.startAndEndDate) {
      windows.push([
        data.startAndEndDate.startValue.getTime(),
        data.startAndEndDate.endValue.getTime(),
      ]);
    }
  }
  return windows;
}

function lastFetchedWindowFor(metricName: string): Window | undefined {
  const windows: Array<Window> = fetchedWindowsFor(metricName);
  return windows[windows.length - 1];
}

function chartsOf(metricName: string): MockChartsProps {
  const charts: MockChartsProps | undefined = mockChartsByMetric[metricName];
  if (!charts) {
    throw new Error(`No charts rendered for ${metricName}`);
  }
  return charts;
}

/*
 * Waits for the control to be on screen first: a chart sits behind
 * MetricView's loader until its latest fetch lands.
 */
async function click(label: string): Promise<void> {
  const control: HTMLElement = await screen.findByRole("button", {
    name: label,
  });
  // findByRole ticks the fake clock; a relative range resolves from NOW.
  jest.setSystemTime(NOW);
  fireEvent.click(control);
}

/*
 * MetricView draws its charts once before it loads, then shows a loader
 * until its first fetch lands. Wait for that fetch and the charts after it,
 * so a gesture never lands on a chart about to be swapped for the loader.
 */
async function chartsSettled(metricName: string): Promise<void> {
  await waitFor(() => {
    expect(fetchedWindowsFor(metricName).length).toBeGreaterThan(0);
    expect(screen.getByTestId(`charts-${metricName}`)).toBeInTheDocument();
  });
  // waitFor ticks the fake clock; "now" is where the assertions read it.
  jest.setSystemTime(NOW);
}

/*
 * The header names a zoom compactly, as the explorers' pickers name a
 * custom range (getZoomedWindowLabel, pinned in its own suite).
 */
function zoomedHeaderTitle(start: Date, end: Date): string {
  return getZoomedWindowLabel(new InBetween<Date>(start, end));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  fetchResultsMock.mockReset();
  for (const key of Object.keys(mockChartsByMetric)) {
    delete mockChartsByMetric[key];
  }
  fetchResultsMock.mockImplementation(() => {
    return Promise.resolve([{ data: [], truncated: false }]);
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the Overview's response-time card zooms itself", () => {
  const probe: (id: string, name: string) => Probe = (
    id: string,
    name: string,
  ): Probe => {
    const model: Probe = new Probe();
    model._id = id;
    model.name = name;
    return model;
  };

  const cardProps: (probes: Array<Probe>) => ResponseTimeCardProps = (
    probes: Array<Probe>,
  ): ResponseTimeCardProps => {
    return {
      monitorId: MONITOR_ID,
      monitorType: MonitorType.API,
      metric: MonitorMetricType.ResponseTime,
      probes: probes,
      responseTime: {
        medianMs: 120,
        minMs: 95,
        maxMs: 180,
        respondedCount: 2,
        totalCount: 2,
      },
    };
  };

  const PROBES: Array<Probe> = [
    probe("33333333-3333-4333-8333-333333333333", "London"),
    probe("44444444-4444-4444-8444-444444444444", "Ohio"),
  ];

  async function renderCard(): Promise<RenderResult> {
    const result: RenderResult = render(
      <MemoryRouter>
        <MonitorResponseTimeCard {...cardProps(PROBES)} />
      </MemoryRouter>,
    );
    await chartsSettled(RESPONSE_TIME);
    return result;
  }

  test("the card charts the past day, offers a drag and no reset yet", async () => {
    await renderCard();

    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
    expect(chartsOf(RESPONSE_TIME).onTimeRangeSelect).toBeInstanceOf(Function);
    expect(chartsOf(RESPONSE_TIME).onTimeRangeReset).toBeUndefined();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("a drag re-queries the dragged window and puts Reset zoom in the card's controls", async () => {
    await renderCard();

    await click(`Drag across ${RESPONSE_TIME}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(RESPONSE_TIME)).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );

    // The controls row keeps "Open metrics" and gains the way back.
    const resetButton: HTMLElement = screen.getByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    const controls: HTMLElement = resetButton.parentElement as HTMLElement;
    expect(within(controls).getByText("Open metrics")).toBeInTheDocument();
    expect(chartsOf(RESPONSE_TIME).onTimeRangeReset).toBeInstanceOf(Function);
  });

  test("a double-click brings the past day back", async () => {
    await renderCard();

    await click(`Drag across ${RESPONSE_TIME}`);
    await waitFor(() => {
      expect(chartsOf(RESPONSE_TIME).onTimeRangeReset).toBeInstanceOf(Function);
    });
    await click(`Double-click ${RESPONSE_TIME}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(RESPONSE_TIME)).toEqual(
        windowOf(DAY_AGO, NOW),
      );
    });
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("Reset zoom does what a double-click does", async () => {
    await renderCard();

    await click(`Drag across ${RESPONSE_TIME}`);
    const resetButton: HTMLElement = await screen.findByTestId(
      RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID,
    );
    jest.setSystemTime(NOW);
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(lastFetchedWindowFor(RESPONSE_TIME)).toEqual(
        windowOf(DAY_AGO, NOW),
      );
    });
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.PAST_ONE_DAY,
    );
  });

  test("the overview's poll (fresh props, same probes) keeps the zoom", async () => {
    const result: RenderResult = await renderCard();

    await click(`Drag across ${RESPONSE_TIME}`);
    await waitFor(() => {
      expect(screen.getByTestId("card-picker")).toHaveTextContent(
        TimeRange.CUSTOM,
      );
    });
    const fetchesBefore: number = fetchResultsMock.mock.calls.length;

    // Every poll hands the card new objects describing the same probes.
    result.rerender(
      <MemoryRouter>
        <MonitorResponseTimeCard
          {...cardProps([
            probe("33333333-3333-4333-8333-333333333333", "London"),
            probe("44444444-4444-4444-8444-444444444444", "Ohio"),
          ])}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    expect(fetchResultsMock.mock.calls.length).toBe(fetchesBefore);
  });

  test("a renamed probe relabels the chart without dropping the zoomed window", async () => {
    const result: RenderResult = await renderCard();

    await click(`Drag across ${RESPONSE_TIME}`);
    await waitFor(() => {
      expect(screen.getByTestId("card-picker")).toHaveTextContent(
        TimeRange.CUSTOM,
      );
    });
    const chartsBefore: MockChartsProps = chartsOf(RESPONSE_TIME);

    result.rerender(
      <MemoryRouter>
        <MonitorResponseTimeCard
          {...cardProps([
            probe("33333333-3333-4333-8333-333333333333", "London (eu-west)"),
            probe("44444444-4444-4444-8444-444444444444", "Ohio"),
          ])}
        />
      </MemoryRouter>,
    );

    // New query configs reached the chart, on the zoomed window still.
    await waitFor(() => {
      expect(chartsOf(RESPONSE_TIME)).not.toBe(chartsBefore);
    });
    expect(lastFetchedWindowFor(RESPONSE_TIME)).toEqual(
      windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
    );
    expect(screen.getByTestId("card-picker")).toHaveTextContent(
      TimeRange.CUSTOM,
    );
    expect(chartsOf(RESPONSE_TIME).onTimeRangeReset).toBeInstanceOf(Function);
  });
});

describe("the Overview's metrics preview zooms itself", () => {
  const stepsWith: (rollingTime: RollingTime) => MonitorSteps = (
    rollingTime: RollingTime,
  ): MonitorSteps => {
    return {
      data: {
        monitorStepsInstanceArray: [
          {
            data: {
              metricMonitor: {
                rollingTime: rollingTime,
                metricViewConfig: {
                  queryConfigs: [
                    {
                      metricAliasData: {
                        metricVariable: "a",
                        title: "CPU",
                        description: "",
                        legend: "",
                        legendUnit: "",
                      },
                      metricQueryData: {
                        filterData: {
                          metricName: PREVIEW_METRIC,
                          aggegationType: MetricsAggregationType.Avg,
                        },
                      },
                    },
                  ],
                  formulaConfigs: [],
                },
              },
            },
          },
        ],
      },
    } as unknown as MonitorSteps;
  };

  async function renderPreview(): Promise<RenderResult> {
    const result: RenderResult = render(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Metrics}
        monitorSteps={stepsWith(RollingTime.Past1Hour)}
      />,
    );
    await chartsSettled(PREVIEW_METRIC);
    return result;
  }

  // The rolling window the preview first charted (resolved at mount).
  function initialWindow(): Window {
    const first: Window | undefined = fetchedWindowsFor(PREVIEW_METRIC)[0];
    if (!first) {
      throw new Error("The preview never fetched");
    }
    return first;
  }

  async function zoom(): Promise<void> {
    await click(`Drag across ${PREVIEW_METRIC}`);
    await waitFor(() => {
      expect(lastFetchedWindowFor(PREVIEW_METRIC)).toEqual(
        windowOf(MOCK_DRAG.start, MOCK_DRAG.end),
      );
    });
  }

  function openRangeModalAndSave(pick?: RollingTime): void {
    fireEvent.click(
      screen.getByText(zoomedHeaderTitle(MOCK_DRAG.start, MOCK_DRAG.end)),
    );
    if (pick) {
      fireEvent.change(screen.getByTestId("rolling-time-dropdown"), {
        target: { value: pick },
      });
    }
    jest.setSystemTime(NOW);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  }

  test("the header names the rolling range, and the chart offers a drag with no reset yet", async () => {
    await renderPreview();

    expect(screen.getByText(RollingTime.Past1Hour)).toBeInTheDocument();
    expect(chartsOf(PREVIEW_METRIC).onTimeRangeSelect).toBeInstanceOf(Function);
    expect(chartsOf(PREVIEW_METRIC).onTimeRangeReset).toBeUndefined();
    const [start, end] = initialWindow();
    expect(end - start).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  test("a drag re-queries the zoomed window and the header names that window", async () => {
    await renderPreview();

    await zoom();

    expect(
      screen.getByText(zoomedHeaderTitle(MOCK_DRAG.start, MOCK_DRAG.end)),
    ).toBeInTheDocument();
    expect(screen.queryByText(RollingTime.Past1Hour)).toBeNull();
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    expect(chartsOf(PREVIEW_METRIC).onTimeRangeReset).toBeInstanceOf(Function);
  });

  test("a double-click brings the rolling window back, and the header its range", async () => {
    await renderPreview();
    const rollingWindow: Window = initialWindow();

    await zoom();
    await click(`Double-click ${PREVIEW_METRIC}`);

    await waitFor(() => {
      expect(lastFetchedWindowFor(PREVIEW_METRIC)).toEqual(rollingWindow);
    });
    expect(screen.getByText(RollingTime.Past1Hour)).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
    expect(chartsOf(PREVIEW_METRIC).onTimeRangeReset).toBeUndefined();
  });

  test("Reset zoom does what a double-click does", async () => {
    await renderPreview();
    const rollingWindow: Window = initialWindow();

    await zoom();
    fireEvent.click(screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID));

    await waitFor(() => {
      expect(lastFetchedWindowFor(PREVIEW_METRIC)).toEqual(rollingWindow);
    });
    expect(screen.getByText(RollingTime.Past1Hour)).toBeInTheDocument();
  });

  test("picking the SAME rolling range in the header ends the zoom", async () => {
    await renderPreview();

    await zoom();
    openRangeModalAndSave();

    await waitFor(() => {
      expect(lastFetchedWindowFor(PREVIEW_METRIC)).toEqual(
        windowOf(HOUR_AGO, NOW),
      );
    });
    expect(screen.getByText(RollingTime.Past1Hour)).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("picking another rolling range ends the zoom and charts that range", async () => {
    await renderPreview();

    await zoom();
    openRangeModalAndSave(RollingTime.Past6Hours);

    await waitFor(() => {
      expect(lastFetchedWindowFor(PREVIEW_METRIC)).toEqual(
        windowOf(SIX_HOURS_AGO, NOW),
      );
    });
    expect(screen.getByText(RollingTime.Past6Hours)).toBeInTheDocument();
    expect(
      screen.queryByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeNull();
  });

  test("re-picking the same range while NOT zoomed changes nothing", async () => {
    await renderPreview();
    const fetchesBefore: number = fetchResultsMock.mock.calls.length;

    fireEvent.click(screen.getByText(RollingTime.Past1Hour));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText(RollingTime.Past1Hour)).toBeInTheDocument();
    expect(fetchResultsMock.mock.calls.length).toBe(fetchesBefore);
  });

  test("the overview's poll (an equal step, new objects) keeps the zoom", async () => {
    const result: RenderResult = await renderPreview();

    await zoom();
    const fetchesBefore: number = fetchResultsMock.mock.calls.length;

    result.rerender(
      <MonitorTelemetryPreview
        monitorType={MonitorType.Metrics}
        monitorSteps={stepsWith(RollingTime.Past1Hour)}
      />,
    );

    expect(
      screen.getByText(zoomedHeaderTitle(MOCK_DRAG.start, MOCK_DRAG.end)),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    expect(fetchResultsMock.mock.calls.length).toBe(fetchesBefore);
  });
});
