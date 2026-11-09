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
 * Issue #6460: a query edited in a MetricView - the explorer's, a
 * dashboard's, a Metrics monitor's form - that moves onto a metric of a
 * Service Bus or Event Hubs namespace takes the namespace's aggregation:
 * Sum, its queues' total, for a count at any interval and for an amount
 * held (messages waiting) while the query is read by the minute. Read in
 * the charts' intervals, or in the ones the view is handed
 * (queryReadInterval: a monitor's own). An aggregation someone picked
 * stays (MetricQueryCloudAggregation.withFollowedAggregation).
 *
 * MetricView is the production component; the network (MetricUtil), the
 * charts (MetricCharts) and one query's editor (MetricQueryConfig) are
 * stand-ins, as in MetricViewChartQueries.
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
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricViewData from "../../../Types/Metrics/MetricViewData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";

const SHOP: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/shop";
const WEB_01: string =
  "/subscriptions/3f2b8c1e-5a6d-4e7f-9a0b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/web-01";

const MESSAGES_IN: string = "azure_incomingmessages_total";
const MESSAGES_WAITING: string = "azure_activemessages_average";
const SEND_LATENCY: string = "azure_serversendlatency_average";
const VM_CPU: string = "azure_percentage_cpu_average";

const END: Date = new Date("2026-11-09T12:00:00.000Z");
const HOUR_MS: number = 60 * 60 * 1000;

function windowOf(hours: number): InBetween<Date> {
  return new InBetween<Date>(new Date(END.getTime() - hours * HOUR_MS), END);
}

function queryOf(data: {
  metricName: string;
  resourceId: string;
  aggregationType?: MetricsAggregationType | undefined;
}): MetricQueryConfigData {
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
        metricName: data.metricName,
        attributes: { "azuremonitor.resource_id": data.resourceId },
        ...(data.aggregationType
          ? { aggegationType: data.aggregationType }
          : {}),
      } as never,
    },
  };
}

// The query the editor hands back: another metric or resource, as picked.
function edited(
  query: MetricQueryConfigData,
  change: {
    metricName?: string;
    resourceId?: string;
    aggregationType?: MetricsAggregationType;
  },
): MetricQueryConfigData {
  const filterData: Record<string, unknown> = {
    ...(query.metricQueryData.filterData as unknown as Record<string, unknown>),
  };

  if (change.metricName) {
    filterData["metricName"] = change.metricName;
  }
  if (change.resourceId) {
    filterData["attributes"] = {
      "azuremonitor.resource_id": change.resourceId,
    };
  }
  if (change.aggregationType) {
    filterData["aggegationType"] = change.aggregationType;
  }

  return {
    ...query,
    metricQueryData: {
      ...query.metricQueryData,
      filterData: filterData as never,
    },
  };
}

async function editIn(data: {
  query: MetricQueryConfigData;
  hours: number;
  queryReadInterval?: AggregationInterval | undefined;
  change: {
    metricName?: string;
    resourceId?: string;
    aggregationType?: MetricsAggregationType;
  };
}): Promise<unknown> {
  const onChange: MockFunction = getJestMockFunction();

  render(
    <MetricView
      data={{
        startAndEndDate: windowOf(data.hours),
        queryConfigs: [data.query],
        formulaConfigs: [],
      }}
      queryReadInterval={data.queryReadInterval}
      hideStartAndEndDate={true}
      hideCardInQueryElements={true}
      hideCardInCharts={true}
      onChange={onChange as unknown as (data: MetricViewData) => void}
    />,
  );

  await waitFor(() => {
    expect(editors.length).toBeGreaterThan(0);
  });

  act(() => {
    editors[editors.length - 1]!.onChange!(edited(data.query, data.change));
  });

  const saved: MetricViewData = onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as MetricViewData;

  return saved.queryConfigs[0]!.metricQueryData.filterData.aggegationType;
}

beforeEach(() => {
  fetchResultsMock.mockReset();
  fetchResultsMock.mockReturnValue(
    Promise.resolve([
      { data: [{ timestamp: new Date(), value: 1 }], truncated: false },
    ]),
  );
  editors = [];
});

afterEach(() => {
  cleanup();
});

describe("a query moved onto a namespace's metric, in a MetricView", () => {
  test("a virtual machine's query moved onto the namespace's messages in reads their Sum", async () => {
    expect(
      await editIn({
        query: queryOf({
          metricName: VM_CPU,
          resourceId: WEB_01,
          aggregationType: MetricsAggregationType.Avg,
        }),
        hours: 24,
        change: { metricName: MESSAGES_IN, resourceId: SHOP },
      }),
    ).toBe(MetricsAggregationType.Sum);
  });

  test("messages waiting on a chart of an hour, read by the minute, read their Sum", async () => {
    expect(
      await editIn({
        query: queryOf({ metricName: SEND_LATENCY, resourceId: SHOP }),
        hours: 1,
        change: { metricName: MESSAGES_WAITING },
      }),
    ).toBe(MetricsAggregationType.Sum);
  });

  test("on a chart of 6 hours, read in 5-minute intervals, they keep the average", async () => {
    expect(
      await editIn({
        query: queryOf({
          metricName: SEND_LATENCY,
          resourceId: SHOP,
          aggregationType: MetricsAggregationType.Avg,
        }),
        hours: 6,
        change: { metricName: MESSAGES_WAITING },
      }),
    ).toBe(MetricsAggregationType.Avg);
  });

  test("read in the intervals it is handed - a monitor's own - and not the chart's", async () => {
    // A monitor of 15 minutes, previewed over 6 hours: read by the minute.
    expect(
      await editIn({
        query: queryOf({
          metricName: SEND_LATENCY,
          resourceId: SHOP,
          aggregationType: MetricsAggregationType.Avg,
        }),
        hours: 6,
        queryReadInterval: AggregationInterval.Minute,
        change: { metricName: MESSAGES_WAITING },
      }),
    ).toBe(MetricsAggregationType.Sum);

    cleanup();
    editors = [];

    // A monitor of 6 hours, previewed over an hour: 5-minute intervals.
    expect(
      await editIn({
        query: queryOf({
          metricName: SEND_LATENCY,
          resourceId: SHOP,
          aggregationType: MetricsAggregationType.Avg,
        }),
        hours: 1,
        queryReadInterval: AggregationInterval.FiveMinutes,
        change: { metricName: MESSAGES_WAITING },
      }),
    ).toBe(MetricsAggregationType.Avg);
  });

  test("moved off the namespace's count onto its latency, a query takes the average back", async () => {
    expect(
      await editIn({
        query: queryOf({
          metricName: MESSAGES_IN,
          resourceId: SHOP,
          aggregationType: MetricsAggregationType.Sum,
        }),
        hours: 1,
        change: { metricName: SEND_LATENCY },
      }),
    ).toBe(MetricsAggregationType.Avg);
  });

  test("an aggregation picked stays: one picked before, and one picked in the same edit", async () => {
    expect(
      await editIn({
        query: queryOf({
          metricName: SEND_LATENCY,
          resourceId: SHOP,
          aggregationType: MetricsAggregationType.Max,
        }),
        hours: 1,
        change: { metricName: MESSAGES_WAITING },
      }),
    ).toBe(MetricsAggregationType.Max);

    cleanup();
    editors = [];

    expect(
      await editIn({
        query: queryOf({
          metricName: MESSAGES_IN,
          resourceId: SHOP,
          aggregationType: MetricsAggregationType.Sum,
        }),
        hours: 1,
        change: { aggregationType: MetricsAggregationType.Avg },
      }),
    ).toBe(MetricsAggregationType.Avg);
  });
});
