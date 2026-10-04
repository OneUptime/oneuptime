import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * MetricView tells its host what its charts have to show
 * (onResultsStateChange): Loading, then HasData, Empty or Error.
 *
 * The Kubernetes Control Plane and Service Mesh pages used to open on an
 * always-on Helm hint above charts that, on most clusters, worked. They now
 * explain an empty tab in place of its charts, and only when the charts say
 * Empty - so Empty must never be reported while a fetch runs, after a fetch
 * failed, or with a data point on screen. The real MetricView runs here;
 * only the fetch and the chart renderer are stood in for.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();
const loadAllMetricsTypesMock: MockFunction = getJestMockFunction();

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
        loadAllMetricsTypes: (...args: Array<unknown>) => {
          return loadAllMetricsTypesMock(...args);
        },
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: { metricResults: Array<unknown> }) => {
        return (
          <div
            data-testid="metric-charts"
            data-results={props.metricResults.length}
          />
        );
      },
    };
  },
);

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import { MetricResultsState } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricResultsState";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";

const WINDOW_START: Date = new Date("2026-10-04T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-10-04T11:00:00.000Z");

const EMPTY: Array<AggregatedResult> = [{ data: [] }, { data: [] }];
const ONE_POINT: Array<AggregatedResult> = [
  { data: [] },
  { data: [{ timestamp: WINDOW_START, value: 0 }] },
];

function buildData(metricNames: Array<string>): MetricViewData {
  return {
    queryConfigs: metricNames.map((metricName: string, index: number) => {
      return {
        metricAliasData: {
          metricVariable: String.fromCharCode(97 + index),
          title: metricName,
          description: "",
          legend: "",
          legendUnit: "",
        },
        metricQueryData: {
          filterData: {
            metricName: metricName,
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
      };
    }),
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as unknown as MetricViewData;
}

const DATA: MetricViewData = buildData([
  "etcd_mvcc_db_total_size_in_bytes",
  "etcd_server_leader_changes_seen_total",
]);

interface Deferred {
  promise: Promise<Array<AggregatedResult>>;
  resolve: (results: Array<AggregatedResult>) => void;
  reject: (error: Error) => void;
}

function deferred(): Deferred {
  let resolve: (results: Array<AggregatedResult>) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise: Promise<Array<AggregatedResult>> = new Promise<
    Array<AggregatedResult>
  >(
    (
      onResolve: (results: Array<AggregatedResult>) => void,
      onReject: (error: Error) => void,
    ) => {
      resolve = onResolve;
      reject = onReject;
    },
  );
  return { promise, resolve, reject };
}

let reported: Array<MetricResultsState> = [];

function onResultsStateChange(state: MetricResultsState): void {
  reported.push(state);
}

function renderView(props: {
  data?: MetricViewData;
  refreshNonce?: number;
  onResultsStateChange?: (state: MetricResultsState) => void;
}): ReturnType<typeof render> {
  return render(
    <MetricView
      data={props.data || DATA}
      hideQueryElements={true}
      hideStartAndEndDate={true}
      hideCardInCharts={true}
      refreshNonce={props.refreshNonce}
      onChange={() => {
        // Not exercised.
      }}
      onResultsStateChange={props.onResultsStateChange}
    />,
  );
}

function lastReported(): MetricResultsState | undefined {
  return reported[reported.length - 1];
}

beforeEach(() => {
  reported = [];
  fetchResultsMock.mockReset();
  loadAllMetricsTypesMock.mockReset();
  loadAllMetricsTypesMock.mockImplementation(() => {
    return Promise.resolve({ metricTypes: [], telemetryServices: [] });
  });
});

afterEach(() => {
  cleanup();
});

describe("MetricView reports what its charts have to show", () => {
  test("Loading, then Empty when every query comes back without a data point", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve(EMPTY);
    });

    renderView({ onResultsStateChange });

    expect(reported[0]).toBe(MetricResultsState.Loading);

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.Empty);
    });

    // Nothing else changes for the view: its (empty) charts still draw.
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    expect(reported).not.toContain(MetricResultsState.HasData);
    expect(reported).not.toContain(MetricResultsState.Error);
  });

  test("Loading, then HasData when one query has a point", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve(ONE_POINT);
    });

    renderView({ onResultsStateChange });

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.HasData);
    });
    expect(reported).not.toContain(MetricResultsState.Empty);
  });

  test("never Empty while the fetch is still running", async () => {
    const pending: Deferred = deferred();
    fetchResultsMock.mockImplementation(() => {
      return pending.promise;
    });

    renderView({ onResultsStateChange });

    // Let the catalog load and the fetch start; it does not answer.
    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(reported.length).toBeGreaterThan(0);
    for (const state of reported) {
      expect(state).toBe(MetricResultsState.Loading);
    }

    await act(async () => {
      pending.resolve(EMPTY);
      await pending.promise;
    });

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.Empty);
    });
  });

  test("a failed first fetch is an Error, never Empty, and the view shows the error", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.reject(new Error("ClickHouse timed out"));
    });

    renderView({ onResultsStateChange });

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.Error);
    });
    expect(reported).not.toContain(MetricResultsState.Empty);
    expect(screen.getByText("ClickHouse timed out")).toBeInTheDocument();
  });

  test("a metric catalog that cannot be read is an Error", async () => {
    loadAllMetricsTypesMock.mockImplementation(() => {
      return Promise.reject(new Error("Forbidden"));
    });
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve(EMPTY);
    });

    renderView({ onResultsStateChange });

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.Error);
    });
  });

  test("checking again after Empty reports Loading, then what the new fetch found", async () => {
    let answer: Array<AggregatedResult> = EMPTY;
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve(answer);
    });

    const view: ReturnType<typeof render> = renderView({
      onResultsStateChange,
      refreshNonce: 0,
    });

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.Empty);
    });

    // The scrape was turned on; the reader checks again.
    answer = ONE_POINT;
    reported = [];
    view.rerender(
      <MetricView
        data={DATA}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        refreshNonce={1}
        onChange={() => {
          // Not exercised.
        }}
        onResultsStateChange={onResultsStateChange}
      />,
    );

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.HasData);
    });
    expect(reported[0]).toBe(MetricResultsState.Loading);
  });

  test("a refresh that fails after data is an Error, with the earlier charts kept", async () => {
    let fail: boolean = false;
    fetchResultsMock.mockImplementation(() => {
      return fail
        ? Promise.reject(new Error("Network down"))
        : Promise.resolve(ONE_POINT);
    });

    const view: ReturnType<typeof render> = renderView({
      onResultsStateChange,
      refreshNonce: 0,
    });

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.HasData);
    });

    fail = true;
    view.rerender(
      <MetricView
        data={DATA}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        refreshNonce={1}
        onChange={() => {
          // Not exercised.
        }}
        onResultsStateChange={onResultsStateChange}
      />,
    );

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.Error);
    });
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Network down");
  });

  test("each change is reported once, whatever the host's callback identity does", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve(EMPTY);
    });

    const view: ReturnType<typeof render> = renderView({
      onResultsStateChange: (state: MetricResultsState) => {
        reported.push(state);
      },
    });

    await waitFor(() => {
      expect(lastReported()).toBe(MetricResultsState.Empty);
    });

    const countBefore: number = reported.length;

    // A host re-rendering with a fresh callback is not a new state.
    view.rerender(
      <MetricView
        data={DATA}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        onChange={() => {
          // Not exercised.
        }}
        onResultsStateChange={(state: MetricResultsState) => {
          reported.push(state);
        }}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(reported).toHaveLength(countBefore);
    expect(
      reported.filter((state: MetricResultsState): boolean => {
        return state === MetricResultsState.Empty;
      }),
    ).toHaveLength(1);
  });

  test("a view without the callback works as before", async () => {
    fetchResultsMock.mockImplementation(() => {
      return Promise.resolve(EMPTY);
    });

    renderView({});

    await waitFor(() => {
      expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
    });
    expect(reported).toEqual([]);
  });
});
