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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * MetricView's first results must land, whatever order its two mount-time
 * loads finish in (found while pinning where its own "Reset zoom" sits,
 * issue #4105).
 *
 * On mount the view loads the metric catalog and, once it is in, fetched
 * the results with the data of its FIRST render. Its fetch effect also
 * fetches whenever the view has a window it has not fetched - and a host
 * that sets its window after mount (the monitor step forms, the Criteria
 * page's step preview) gets there before the catalog is in. The catalog's
 * late fetch then superseded that one with the first render's data: with
 * no window it dropped the only result (the preview stayed empty, and the
 * first zoom swapped the charts, and the Reset zoom with them, for a
 * loader); with an earlier window it drew that stale window's results.
 *
 * Here the catalog answers at once, after the host has set its window:
 * the order that lost the first result.
 */

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const fetchResultsMock: MockFunction = getJestMockFunction();

interface MockChartsProps {
  metricResults: Array<{ data: Array<{ value: number }> }>;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
}

// What each render of the charts was handed.
const mockChartsRenders: Array<MockChartsProps> = [];

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
        mockChartsRenders.push(props);
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
        // The catalog answers at once.
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

jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    default: () => {
      return <select />;
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
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("99999999-9999-4999-8999-999999999999");
      },
    },
  };
});

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import MetricMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/MetricMonitor/MetricMonitorStepForm";
import MonitorStepMetricPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitorSteps/MonitorStepMetricPreview";
import { RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MonitorStepMetricMonitor, {
  MonitorStepMetricMonitorUtil,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const HOUR_AGO: Date = new Date("2026-09-28T11:00:00.000Z");
const TWO_HOURS_AGO: Date = new Date("2026-09-28T10:00:00.000Z");

function viewConfig(): MetricsViewConfig {
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "a",
          title: "cpu",
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: "cpu.usage",
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      },
    ],
    formulaConfigs: [],
  };
}

interface FetchRequest {
  metricViewData: MetricViewData;
}

/*
 * Every fetch answers at once with one row whose value is the start of
 * the window asked for, in epoch minutes: what the charts draw says which
 * window's result the view committed.
 */
function answerWithWindowStart(): void {
  fetchResultsMock.mockImplementation((request: unknown) => {
    const start: Date = (request as FetchRequest).metricViewData
      .startAndEndDate!.startValue;
    return Promise.resolve([
      {
        data: [{ timestamp: start, value: start.getTime() / 60_000 }],
        truncated: false,
      },
    ]);
  });
}

function drawnValues(): Array<number> {
  const last: MockChartsProps | undefined =
    mockChartsRenders[mockChartsRenders.length - 1];
  if (!last) {
    throw new Error("The charts have not rendered");
  }
  return (last.metricResults[0]?.data || []).map(
    (row: { value: number }): number => {
      return row.value;
    },
  );
}

function fetchedStarts(): Array<number> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): number => {
    return (
      call[0] as FetchRequest
    ).metricViewData.startAndEndDate!.startValue.getTime();
  });
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
  jest.setSystemTime(NOW);
}

const MetricFormHost: React.FunctionComponent = (): React.ReactElement => {
  const [step, setStep] = React.useState<MonitorStepMetricMonitor>({
    ...MonitorStepMetricMonitorUtil.getDefault(),
    metricViewConfig: viewConfig(),
    rollingTime: RollingTime.Past1Hour,
  });
  return (
    <MetricMonitorStepForm monitorStepMetricMonitor={step} onChange={setStep} />
  );
};

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockChartsRenders.length = 0;
  getListMock.mockReset();
  getItemMock.mockReset();
  fetchResultsMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 0 });
  getItemMock.mockResolvedValue(null);
  answerWithWindowStart();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a host that sets its window after mount", () => {
  test("the Metric monitor form's preview draws its first result", async () => {
    render(
      <MemoryRouter>
        <MetricFormHost />
      </MemoryRouter>,
    );
    await settle();

    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    expect(drawnValues()).toEqual([HOUR_AGO.getTime() / 60_000]);
  });

  test("the Criteria page's step preview draws its first result", async () => {
    render(
      <MemoryRouter>
        <MonitorStepMetricPreview
          metricsViewConfig={viewConfig()}
          rollingTime={RollingTime.Past1Hour}
        />
      </MemoryRouter>,
    );
    await settle();

    expect(drawnValues()).toEqual([HOUR_AGO.getTime() / 60_000]);
  });

  test("its window is fetched once, and nothing else is", async () => {
    render(
      <MemoryRouter>
        <MetricFormHost />
      </MemoryRouter>,
    );
    await settle();

    expect(fetchedStarts()).toEqual([HOUR_AGO.getTime()]);
  });

  test("the first zoom's refetch keeps the charts up, and the Reset zoom with them", async () => {
    render(
      <MemoryRouter>
        <MetricFormHost />
      </MemoryRouter>,
    );
    await settle();
    // The zoom's fetch is still out.
    fetchResultsMock.mockImplementation(() => {
      return new Promise(() => {
        // Intentionally never settles.
      });
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Drag across the chart" }),
    );

    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    expect(
      screen.getByTestId(RESET_TIME_RANGE_ZOOM_BUTTON_TEST_ID),
    ).toBeVisible();
    expect(screen.getByText("Refreshing")).toBeInTheDocument();
  });

  test("a window the host moves on from before the catalog is in is never drawn", async () => {
    // The host's first window, replaced at once (as a form resolving it).
    const MovingHost: React.FunctionComponent = (): React.ReactElement => {
      const [window, setWindow] = React.useState<InBetween<Date>>(
        new InBetween<Date>(TWO_HOURS_AGO, HOUR_AGO),
      );
      React.useEffect(() => {
        setWindow(new InBetween<Date>(HOUR_AGO, NOW));
      }, []);
      return (
        <MetricView
          data={{ ...viewConfig(), startAndEndDate: window }}
          hideQueryElements={true}
          hideStartAndEndDate={true}
          onChange={() => {}}
        />
      );
    };

    render(<MovingHost />);
    await settle();

    expect(drawnValues()).toEqual([HOUR_AGO.getTime() / 60_000]);
    // The first window was asked for once, by the effect, and superseded.
    expect(fetchedStarts()[fetchedStarts().length - 1]).toBe(
      HOUR_AGO.getTime(),
    );
  });
});

describe("a host with its window from the start", () => {
  test("the window is fetched once, not again when the catalog is in", async () => {
    render(
      <MetricView
        data={{
          ...viewConfig(),
          startAndEndDate: new InBetween<Date>(HOUR_AGO, NOW),
        }}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        onChange={() => {}}
      />,
    );
    await settle();

    expect(fetchedStarts()).toEqual([HOUR_AGO.getTime()]);
    expect(drawnValues()).toEqual([HOUR_AGO.getTime() / 60_000]);
  });

  test("a host with no window at all fetches nothing, and waits for one", async () => {
    const LateHost: React.FunctionComponent = (): React.ReactElement => {
      const [window, setWindow] = React.useState<InBetween<Date> | null>(null);
      return (
        <>
          <button
            type="button"
            onClick={() => {
              setWindow(new InBetween<Date>(HOUR_AGO, NOW));
            }}
          >
            Set the window
          </button>
          <MetricView
            data={{ ...viewConfig(), startAndEndDate: window }}
            hideQueryElements={true}
            hideStartAndEndDate={true}
            onChange={() => {}}
          />
        </>
      );
    };

    render(<LateHost />);
    await settle();
    expect(fetchResultsMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Set the window" }));
    await settle();

    await waitFor(() => {
      expect(drawnValues()).toEqual([HOUR_AGO.getTime() / 60_000]);
    });
    expect(fetchedStarts()).toEqual([HOUR_AGO.getTime()]);
  });
});
