import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #6264: a MetricView whose charts read its queries narrowed - a
 * monitor step form's, to the cluster or host the monitor watches - while
 * its query editor edits them as written and its onChange hands those back.
 *
 * MetricView is the production component; the network (MetricUtil), the
 * charts (MetricCharts) and one query's editor (MetricQueryConfig) are
 * stand-ins that record what they were handed.
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

interface ChartsProps {
  metricViewData: MetricViewData;
  onQueryConfigsChange?:
    | ((queryConfigs: Array<MetricQueryConfigData>) => void)
    | undefined;
}

let lastCharts: ChartsProps | null = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricCharts",
  () => {
    return {
      __esModule: true,
      default: (props: ChartsProps): React.ReactElement => {
        lastCharts = props;
        return React.createElement("div", { "data-testid": "metric-charts" });
      },
    };
  },
);

interface EditorProps {
  data: MetricQueryConfigData;
  onChange?: ((data: MetricQueryConfigData) => void) | undefined;
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
import Wildcard from "../../../Types/BaseDatabase/Wildcard";
import Dictionary from "../../../Types/Dictionary";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

const WINDOW: InBetween<Date> = new InBetween<Date>(
  new Date("2026-11-07T10:00:00.000Z"),
  new Date("2026-11-07T11:00:00.000Z"),
);

const queryOf: (attributes?: Dictionary<unknown>) => MetricQueryConfigData = (
  attributes?: Dictionary<unknown>,
): MetricQueryConfigData => {
  return {
    metricAliasData: {
      metricVariable: "a",
      title: "CPU",
      description: "",
      legend: "",
      legendUnit: "",
    },
    metricQueryData: {
      filterData: {
        metricName: "pve_cpu_usage_ratio",
        aggegationType: MetricsAggregationType.Avg,
        ...(attributes ? { attributes } : {}),
      } as never,
    },
  };
};

const WRITTEN: MetricQueryConfigData = queryOf({ "pve.scope": "node" });

const chartedFor: (cluster: string) => MetricQueryConfigData = (
  cluster: string,
): MetricQueryConfigData => {
  return queryOf({
    "pve.scope": "node",
    "resource.proxmox.cluster.name": cluster,
  });
};

const dataOf: (queryConfigs: Array<MetricQueryConfigData>) => MetricViewData = (
  queryConfigs: Array<MetricQueryConfigData>,
): MetricViewData => {
  return {
    startAndEndDate: WINDOW,
    queryConfigs: queryConfigs,
    formulaConfigs: [],
  };
};

// The attributes each fetch so far read its first query with.
function fetchedAttributes(): Array<unknown> {
  return fetchResultsMock.mock.calls.map((call: Array<unknown>): unknown => {
    return (call[0] as { metricViewData: MetricViewData }).metricViewData
      .queryConfigs[0]?.metricQueryData.filterData.attributes;
  });
}

function lastEditor(): EditorProps {
  expect(editors.length).toBeGreaterThan(0);
  return editors[editors.length - 1]!;
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 5; round++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

interface ViewProps {
  chartQueryConfigs?: Array<MetricQueryConfigData> | undefined;
  onChange?: (data: MetricViewData) => void;
  localChartZoom?: boolean;
}

function viewOf(props: ViewProps): React.ReactElement {
  return (
    <MetricView
      data={dataOf([WRITTEN])}
      chartQueryConfigs={props.chartQueryConfigs}
      hideStartAndEndDate={true}
      hideCardInQueryElements={true}
      hideCardInCharts={true}
      localChartZoom={props.localChartZoom}
      onChange={props.onChange || ((): void => {})}
    />
  );
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([
      {
        data: [{ timestamp: new Date(), value: 1 }],
        truncated: false,
      },
    ]),
  );
  lastCharts = null;
  editors = [];
});

afterEach(() => {
  cleanup();
});

describe("a MetricView handed the queries its charts read", () => {
  test.each([
    ["its own window", false],
    ["a window it zooms by itself, as the step forms do", true],
  ])(
    "with %s: fetches and draws the chart's queries; the editor edits the written ones",
    async (_name: string, localChartZoom: boolean) => {
      render(
        viewOf({
          chartQueryConfigs: [chartedFor("pve-prod")],
          localChartZoom: localChartZoom,
        }),
      );

      await waitFor(() => {
        expect(fetchResultsMock).toHaveBeenCalled();
        expect(lastCharts).not.toBeNull();
      });

      // Every fetch reads the cluster the monitor watches.
      for (const attributes of fetchedAttributes()) {
        expect(attributes).toEqual({
          "pve.scope": "node",
          "resource.proxmox.cluster.name": "pve-prod",
        });
      }

      // The charts draw (and fetch exemplars for) the same queries.
      expect(
        lastCharts!.metricViewData.queryConfigs[0]!.metricQueryData.filterData
          .attributes,
      ).toEqual({
        "pve.scope": "node",
        "resource.proxmox.cluster.name": "pve-prod",
      });

      // The query editor shows the query as the step saves it.
      expect(lastEditor().data).toBe(WRITTEN);
    },
  );

  test("an edit in the query editor hands back the written queries, without the narrowing", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      viewOf({ chartQueryConfigs: [chartedFor("pve-prod")], onChange }),
    );
    await waitFor(() => {
      expect(editors.length).toBeGreaterThan(0);
    });

    const edited: MetricQueryConfigData = {
      ...WRITTEN,
      metricQueryData: {
        ...WRITTEN.metricQueryData,
        filterData: {
          ...WRITTEN.metricQueryData.filterData,
          aggegationType: MetricsAggregationType.Max,
        },
      },
    };

    act(() => {
      lastEditor().onChange!(edited);
    });

    const saved: MetricViewData = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as MetricViewData;
    expect(saved.queryConfigs).toEqual([edited]);
    expect(saved.queryConfigs[0]!.metricQueryData.filterData.attributes).toEqual(
      { "pve.scope": "node" },
    );
  });

  test("a Top-N set on a chart is saved on the written query, without the narrowing", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      viewOf({ chartQueryConfigs: [chartedFor("pve-prod")], onChange }),
    );
    await waitFor(() => {
      expect(lastCharts?.onQueryConfigsChange).toBeDefined();
    });

    const charted: MetricQueryConfigData =
      lastCharts!.metricViewData.queryConfigs[0]!;

    act(() => {
      lastCharts!.onQueryConfigsChange!([
        {
          ...charted,
          metricQueryData: { ...charted.metricQueryData, topN: 5 },
        },
      ]);
    });

    const saved: MetricViewData = onChange.mock.calls[
      onChange.mock.calls.length - 1
    ]![0] as MetricViewData;
    expect(saved.queryConfigs).toEqual([
      {
        ...WRITTEN,
        metricQueryData: { ...WRITTEN.metricQueryData, topN: 5 },
      },
    ]);
  });

  test("a new cluster is fetched at once; the same scope worked out again is not fetched twice", async () => {
    const view: ReturnType<typeof render> = render(
      viewOf({ chartQueryConfigs: [chartedFor("pve-prod")] }),
    );
    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });
    await settle();
    const fetchesSoFar: number = fetchResultsMock.mock.calls.length;

    // A step form works its chart queries out again on every render.
    view.rerender(viewOf({ chartQueryConfigs: [chartedFor("pve-prod")] }));
    await settle();
    expect(fetchResultsMock.mock.calls.length).toBe(fetchesSoFar);

    view.rerender(viewOf({ chartQueryConfigs: [chartedFor("pve-lab")] }));
    await waitFor(() => {
      expect(fetchedAttributes()[fetchedAttributes().length - 1]).toEqual({
        "pve.scope": "node",
        "resource.proxmox.cluster.name": "pve-lab",
      });
    });
  });

  test("an operator-valued scope reaches the fetch as the operator it is", async () => {
    render(
      viewOf({
        chartQueryConfigs: [
          queryOf({
            "pve.scope": "node",
            "resource.iot.fleet.name": new Wildcard<string>(["sensors"]),
          }),
        ],
      }),
    );

    await waitFor(() => {
      expect(fetchResultsMock).toHaveBeenCalled();
    });

    const fleet: unknown = (
      fetchedAttributes()[0] as Dictionary<unknown>
    )["resource.iot.fleet.name"];
    expect(fleet).toBeInstanceOf(Wildcard);
    expect((fleet as Wildcard<string>).values).toEqual(["sensors"]);
  });

  test.each([
    ["no chart queries", undefined],
    ["chart queries that do not line up", [chartedFor("a"), chartedFor("b")]],
  ])(
    "%s: fetches and draws its own queries, as it always did",
    async (_name: string, chartQueryConfigs: unknown) => {
      render(
        viewOf({
          chartQueryConfigs: chartQueryConfigs as
            | Array<MetricQueryConfigData>
            | undefined,
        }),
      );

      await waitFor(() => {
        expect(fetchResultsMock).toHaveBeenCalled();
        expect(lastCharts).not.toBeNull();
      });

      expect(fetchedAttributes()).toContainEqual({ "pve.scope": "node" });
      for (const attributes of fetchedAttributes()) {
        expect(attributes).toEqual({ "pve.scope": "node" });
      }
      expect(lastCharts!.metricViewData.queryConfigs[0]).toBe(WRITTEN);
    },
  );
});
