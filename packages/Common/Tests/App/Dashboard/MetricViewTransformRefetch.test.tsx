import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A chart whose query gains its own transformValue after the first fetch is
 * fetched again.
 *
 * The fetch converts each query's stored values to its legend unit
 * (MetricResultUnitConverter) - except for a query with its own
 * transformValue, which makes the legend unit itself and so gets its values
 * as stored. A page that builds the transform from data it loads (the
 * Kubernetes pages divided CPU cores by the node's allocatable CPU once that
 * had loaded) used to fetch once without it: the values came back converted
 * (cores declared "1", times 100 into "%"), and the transform then ran on
 * them when it arrived - a pod using 1.25% of its node drew at 125%.
 * MetricView only refetched on a change to the query itself, its legend unit
 * or the window, so whether a transform was there did not count.
 *
 * The network layer (MetricUtil) and the chart are stand-ins; MetricView is
 * the production component.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        fetchResults: (...args: Array<any>) => {
          return fetchResultsMock(...args);
        },
        getMetricTypes: () => {
          return Promise.resolve([]);
        },
        loadAllMetricsTypes: () => {
          return Promise.resolve({
            metricTypes: [],
            telemetryServices: [],
          });
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
      default: (): React.ReactElement => {
        return React.createElement("div", {
          "data-testid": "metric-charts",
        });
      },
    };
  },
);

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricViewData from "../../../Types/Metrics/MetricViewData";

const WINDOW_START: Date = new Date("2026-10-19T10:00:00.000Z");
const WINDOW_END: Date = new Date("2026-10-19T11:00:00.000Z");

type Transform = MetricQueryConfigData["transformValue"];

function buildData(transformValue?: Transform): MetricViewData {
  return {
    queryConfigs: [
      {
        metricAliasData: {
          metricVariable: "pod_cpu",
          title: "Pod CPU Utilization",
          description: "",
          legend: "CPU",
          legendUnit: "%",
        },
        metricQueryData: {
          filterData: {
            metricName: "k8s.pod.cpu.utilization",
            attributes: {},
            aggegationType: MetricsAggregationType.Avg,
          },
        },
        ...(transformValue ? { transformValue } : {}),
      },
    ],
    formulaConfigs: [],
    startAndEndDate: new InBetween<Date>(WINDOW_START, WINDOW_END),
  } as unknown as MetricViewData;
}

// Whether each fetch so far carried the query's transform.
function fetchedWithTransform(): Array<boolean> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): boolean => {
    const args: { metricViewData: MetricViewData } = call[0] as {
      metricViewData: MetricViewData;
    };
    return Boolean(args.metricViewData.queryConfigs[0]?.transformValue);
  });
}

function settle(): Promise<void> {
  return new Promise((resolve: () => void) => {
    setTimeout(resolve, 30);
  });
}

function percentOfFourCores(value: number): number {
  return (value / 4) * 100;
}

function percentOfEightCores(value: number): number {
  return (value / 8) * 100;
}

function renderView(data: MetricViewData): ReturnType<typeof render> {
  return render(
    <MetricView
      data={data}
      hideQueryElements={true}
      hideStartAndEndDate={true}
      onChange={() => {
        // not exercised
      }}
    />,
  );
}

function rerenderView(
  view: ReturnType<typeof render>,
  data: MetricViewData,
): void {
  view.rerender(
    <MetricView
      data={data}
      hideQueryElements={true}
      hideStartAndEndDate={true}
      onChange={() => {
        // not exercised
      }}
    />,
  );
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([{ data: [], truncated: false }]),
  );
});

afterEach(() => {
  cleanup();
});

describe("MetricView fetches again when a query's own transform comes or goes", () => {
  test("regression: a transform that arrives after the first fetch is fetched with", async () => {
    const view: ReturnType<typeof render> = renderView(buildData());

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    await settle();
    expect(fetchedWithTransform().every((has: boolean) => !has)).toBe(true);

    // The node's allocatable CPU has loaded: the page now has a transform.
    rerenderView(view, buildData(percentOfFourCores));

    await waitFor(() => {
      expect(fetchedWithTransform()[fetchedWithTransform().length - 1]).toBe(
        true,
      );
    });
  });

  test("a transform made anew on every render does not refetch", async () => {
    const view: ReturnType<typeof render> = renderView(
      buildData(percentOfFourCores),
    );

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    await settle();
    const fetchesSoFar: number = fetchResultsMock.mock.calls.length;
    expect(fetchedWithTransform().every((has: boolean) => has)).toBe(true);

    /*
     * The Kubernetes pages build the transform in their render body, so
     * every render hands MetricView a new function - it is applied when the
     * chart draws, from the values as stored.
     */
    rerenderView(view, buildData(percentOfEightCores));
    await settle();
    rerenderView(view, buildData(percentOfFourCores));
    await settle();

    expect(fetchResultsMock.mock.calls.length).toBe(fetchesSoFar);
  });

  test("a transform that goes away is fetched without, so the values are converted again", async () => {
    const view: ReturnType<typeof render> = renderView(
      buildData(percentOfFourCores),
    );

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    await settle();

    rerenderView(view, buildData());

    await waitFor(() => {
      expect(fetchedWithTransform()[fetchedWithTransform().length - 1]).toBe(
        false,
      );
    });
  });
});
