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
 * ISSUE #9961, IN THE OTHER EDITORS OF METRIC QUERIES: THE METRICS EXPLORER
 * AND A METRIC MONITOR'S FORM.
 *
 * Both draw their queries with MetricView, which already offered "Overlay
 * with previous query" on every query after the first. It now hands each of
 * those queries the chart it would join, so the switch can say when its
 * unit cannot be read there, and it sizes its charts per chart drawn: a
 * height per query stretched two overlaid queries' one chart to twice its
 * height, and three to three times.
 *
 * MetricView is the production component; the metrics read, the charts and
 * each query's editor are stand-ins that record what they were handed.
 */

const fetchResultsMock: MockFunction = getJestMockFunction();

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
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryServices: [] });
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
        return React.createElement("div", { "data-testid": "metric-charts" });
      },
    };
  },
);

interface EditorProps {
  data: MetricQueryConfigData;
  canOverlayWithPreviousQuery?: boolean | undefined;
  overlayChartQuery?: MetricQueryConfigData | undefined;
}

let editors: Array<EditorProps> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricQueryConfig",
  () => {
    return {
      __esModule: true,
      default: (props: EditorProps): React.ReactElement => {
        editors.push(props);
        return React.createElement("div", { "data-testid": "query-editor" });
      },
    };
  },
);

import MetricView from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-18T10:00:00.000Z"),
  new Date("2026-11-18T11:00:00.000Z"),
);

function query(
  variable: string,
  metricName: string,
  isOverlaid: boolean = false,
): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: metricName,
      description: "",
      legend: metricName,
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: metricName,
        aggegationType: MetricsAggregationType.Avg,
      },
    },
    ...(isOverlaid ? { overlayWithPreviousQuery: true } : {}),
  } as MetricQueryConfigData;
}

function formula(variable: string): MetricFormulaConfigData {
  return {
    metricAliasData: {
      metricVariable: variable,
      title: undefined,
      description: undefined,
      legend: undefined,
      legendUnit: undefined,
    },
    metricFormulaData: { metricFormula: "a + b" },
  };
}

function dataOf(
  queryConfigs: Array<MetricQueryConfigData>,
  formulaConfigs: Array<MetricFormulaConfigData> = [],
): MetricViewData {
  return {
    startAndEndDate: WINDOW,
    queryConfigs: queryConfigs,
    formulaConfigs: formulaConfigs,
  };
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

interface ViewOptions {
  // A metric monitor's form: its charts drawn without cards.
  isMonitorForm?: boolean | undefined;
}

async function drawView(
  data: MetricViewData,
  options: ViewOptions = {},
): Promise<void> {
  fetchResultsMock.mockReturnValue(
    Promise.resolve(
      [...data.queryConfigs, ...data.formulaConfigs].map(() => {
        return {
          data: [{ timestamp: new Date(), value: 1 }],
          truncated: false,
        };
      }),
    ),
  );

  render(
    <MetricView
      data={data}
      hideStartAndEndDate={true}
      hideCardInQueryElements={options.isMonitorForm}
      hideCardInCharts={options.isMonitorForm}
      onChange={(): void => {}}
    />,
  );

  await settle();
  await waitFor(() => {
    expect(screen.getByTestId("metric-charts")).toBeInTheDocument();
  });
}

// The box the charts are drawn in, and the height it keeps for them.
function chartsHeight(): string {
  return (
    (screen.getByTestId("metric-charts").parentElement as HTMLElement).style
      .minHeight || ""
  );
}

// The editors of the last draw, one per query, in order.
function lastEditors(count: number): Array<EditorProps> {
  expect(editors.length).toBeGreaterThanOrEqual(count);
  return editors.slice(editors.length - count);
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  editors = [];
});

afterEach(() => {
  cleanup();
});

describe("every query after the first offers the switch, and knows the chart it would join", () => {
  test("Query 1 is never offered it; each later query is", async () => {
    await drawView(
      dataOf([
        query("a", "mem_used"),
        query("b", "mem_total"),
        query("c", "mem_free"),
      ]),
    );

    expect(
      lastEditors(3).map((editor: EditorProps): boolean => {
        return Boolean(editor.canOverlayWithPreviousQuery);
      }),
    ).toEqual([false, true, true]);
  });

  test("each later query is handed the first query of the chart it would join", async () => {
    await drawView(
      dataOf([
        query("a", "mem_used"),
        query("b", "mem_total", true),
        query("c", "mem_free", true),
        query("d", "cpu"),
        query("e", "cpu_2", true),
      ]),
    );

    expect(
      lastEditors(5).map((editor: EditorProps): string | undefined => {
        return editor.overlayChartQuery?.metricAliasData?.metricVariable;
      }),
    ).toEqual([undefined, "a", "a", "a", "d"]);
  });

  test("a metric monitor's form offers it the same way", async () => {
    await drawView(dataOf([query("a", "mem_used"), query("b", "mem_total")]), {
      isMonitorForm: true,
    });

    const [first, second] = lastEditors(2);

    expect(first!.canOverlayWithPreviousQuery).toBe(false);
    expect(second!.canOverlayWithPreviousQuery).toBe(true);
    expect(second!.overlayChartQuery?.metricAliasData?.metricVariable).toBe(
      "a",
    );
  });
});

describe("the charts are given room per chart drawn, not per query", () => {
  test("two queries on charts of their own: two charts' height", async () => {
    await drawView(dataOf([query("a", "mem_used"), query("b", "mem_total")]));

    expect(chartsHeight()).toBe("40rem");
  });

  test("two queries overlaid: one chart, one chart's height", async () => {
    await drawView(
      dataOf([query("a", "mem_used"), query("b", "mem_total", true)]),
    );

    expect(chartsHeight()).toBe("20rem");
  });

  test("three queries, two of them overlaid: one chart's height", async () => {
    await drawView(
      dataOf([
        query("a", "mem_used"),
        query("b", "mem_total", true),
        query("c", "mem_free", true),
      ]),
    );

    expect(chartsHeight()).toBe("20rem");
  });

  test("three queries, only Query 3 overlaid: two charts' height", async () => {
    await drawView(
      dataOf([
        query("a", "mem_used"),
        query("b", "mem_total"),
        query("c", "mem_free", true),
      ]),
    );

    expect(chartsHeight()).toBe("40rem");
  });

  test("a formula's chart is a chart of its own", async () => {
    await drawView(
      dataOf(
        [query("a", "mem_used"), query("b", "mem_total", true)],
        [formula("c")],
      ),
    );

    expect(chartsHeight()).toBe("40rem");
  });

  test("a first query saved overlaid still draws, and is still counted", async () => {
    await drawView(dataOf([query("a", "mem_used", true)]));

    expect(chartsHeight()).toBe("20rem");
  });

  test("a metric monitor's form sizes its charts the same way", async () => {
    await drawView(
      dataOf([query("a", "mem_used"), query("b", "mem_total", true)]),
      { isMonitorForm: true },
    );

    expect(chartsHeight()).toBe("20rem");
  });
});

describe("the Charts heading counts charts, not queries", () => {
  function chartsCount(): string | null {
    const heading: HTMLElement = screen.getByText("Charts")
      .parentElement as HTMLElement;
    const count: Element | null = heading.querySelector("span.rounded-full");

    return count ? count.textContent : null;
  }

  test("two charts: it says 2", async () => {
    await drawView(dataOf([query("a", "mem_used"), query("b", "mem_total")]));

    expect(chartsCount()).toBe("2");
  });

  test("two queries overlaid on one chart: no count, as for any one chart", async () => {
    await drawView(
      dataOf([query("a", "mem_used"), query("b", "mem_total", true)]),
    );

    expect(chartsCount()).toBeNull();
  });

  test("three queries, Query 3 overlaid, and a formula: three charts", async () => {
    await drawView(
      dataOf(
        [
          query("a", "mem_used"),
          query("b", "mem_total"),
          query("c", "mem_free", true),
        ],
        [formula("d")],
      ),
    );

    expect(chartsCount()).toBe("3");
  });
});
