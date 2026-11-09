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

/*
 * A Service Bus or Event Hubs namespace's Metrics tab (Cloud > All
 * Resources > the namespace), issue #6410.
 *
 * Since #6373 a connected Azure subscription reads a namespace's key
 * metrics once per queue, topic and event hub, as the collector's
 * azure_monitor receiver always did. Every one of those series carries the
 * namespace's resource id, so the tab, which charted the per-minute average
 * of every series of a metric, charted the average queue: a namespace of
 * three queues sending 10, 20 and 30 messages a minute read 20 where it read
 * 60 before. This mounts the REAL page, the REAL metric list and the REAL
 * aggregate builder, answers the aggregate API as the server would for those
 * three queues (Sum 60, Avg 20), and reads what each row shows and what a
 * click opens - for a namespace a connection reads, one the receiver reads,
 * an Event Hubs namespace, and resources whose metrics are not split, which
 * must read exactly as they did.
 */

const mockRowProps: Array<Record<string, unknown>> = [];
let mockResource: Record<string, unknown> | null = null;
let mockMetricNames: Array<string> = [];
const mockAggregateRequests: Array<Record<string, unknown>> = [];

// What the server answers for the namespace's three queues: 10, 20 and 30.
const QUEUE_TOTAL: number = 60;
const QUEUE_AVERAGE: number = 20;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: {
      items: Array<{ name: string }>;
      renderRow: (metric: { name: string }) => React.ReactElement;
    }) => {
      return (
        <div>
          {props.items.map((item: { name: string }) => {
            return (
              <React.Fragment key={item.name}>
                {props.renderRow(item)}
              </React.Fragment>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricRow",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        mockRowProps.push(props);
        const name: string = (props["metric"] as { name: string }).name;
        return (
          <button
            data-testid={`row-${name}`}
            onClick={props["onClick"] as () => void}
          >
            {name}
          </button>
        );
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      // As the API does: the row's id and the columns the page selected.
      getItem: (request: {
        select?: Record<string, unknown>;
      }): Promise<unknown> => {
        if (!mockResource) {
          return Promise.resolve(null);
        }
        const selected: Record<string, unknown> = { _id: mockResource["_id"] };
        for (const column of Object.keys(request.select || {})) {
          selected[column] = mockResource[column];
        }
        return Promise.resolve(selected);
      },
      getList: (request: { modelType: { name: string } }) => {
        if (request.modelType.name !== "MetricType") {
          return Promise.resolve({ data: [], count: 0 });
        }
        const rows: Array<{ name: string }> = mockMetricNames.map(
          (name: string) => {
            return { name: name };
          },
        );
        return Promise.resolve({ data: rows, count: rows.length });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      // The names the resource's attribute filter matches, grouped by name.
      getList: () => {
        return Promise.resolve({
          data: mockMetricNames.map((name: string) => {
            return { name: name };
          }),
        });
      },
      aggregate: (request: { aggregateBy: Record<string, unknown> }) => {
        mockAggregateRequests.push(request.aggregateBy);
        const value: number =
          request.aggregateBy["aggregationType"] === "Sum"
            ? QUEUE_TOTAL
            : QUEUE_AVERAGE;
        return Promise.resolve({
          data: [{ timestamp: new Date("2026-11-09T10:00:00.000Z"), value }],
        });
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve({ data: { attributes: [], facets: {} } });
      },
      getFriendlyMessage: (error: unknown) => {
        return String(error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import CloudResourceMetrics from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/View/Metrics";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
  CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Cloud/Utils/CloudMonitoredResourceScope";
import { buildQueryConfigsFromSerializedQueries } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
import MetricExplorerUrl, {
  MetricExplorerUrlParam,
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import MetricQueryServices from "../../../Utils/Metrics/MetricQueryServices";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import TimeRange from "../../../Types/Time/TimeRange";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "21075038-d9f1-4d3a-b878-f64ae861f7be",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "5b1c9e2a-7d3f-4a6b-8c9d-0e1f2a3b4c5d",
);
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const RESOURCE_ID_ATTRIBUTE: string = "azuremonitor.resource_id";

function armId(type: string, name: string): string {
  return `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/${type}/${name}`;
}

interface Resource {
  provider: string;
  type: string;
  telemetryAttributes: Record<string, string>;
}

const SERVICE_BUS: Resource = {
  provider: CloudProvider.Azure,
  type: "Microsoft.ServiceBus/namespaces",
  telemetryAttributes: {
    [RESOURCE_ID_ATTRIBUTE]: armId("Microsoft.ServiceBus/namespaces", "shop"),
  },
};

const EVENT_HUBS: Resource = {
  provider: CloudProvider.Azure,
  type: "Microsoft.EventHub/namespaces",
  telemetryAttributes: {
    [RESOURCE_ID_ATTRIBUTE]: armId("Microsoft.EventHub/namespaces", "clicks"),
  },
};

const VIRTUAL_MACHINE: Resource = {
  provider: CloudProvider.Azure,
  type: "Microsoft.Compute/virtualMachines",
  telemetryAttributes: {
    [RESOURCE_ID_ATTRIBUTE]: armId(
      "Microsoft.Compute/virtualMachines",
      "web-01",
    ),
  },
};

const SQS_QUEUE: Resource = {
  provider: CloudProvider.AWS,
  type: "AWS::SQS::Queue",
  telemetryAttributes: {
    Namespace: "AWS/SQS",
    "Dimensions.QueueName": "orders",
    "resource.cloud.account.id": "123456789012",
    "resource.cloud.region": "eu-west-1",
  },
};

// The six a connected subscription reads of a Service Bus namespace.
const SERVICE_BUS_CONNECTION_METRICS: Array<string> = [
  "azure_activemessages_average",
  "azure_deadletteredmessages_average",
  "azure_incomingmessages_total",
  "azure_outgoingmessages_total",
  "azure_servererrors_total",
  "azure_throttledrequests_total",
];

let navigateSpy: ReturnType<typeof jest.spyOn>;

async function openTab(
  resource: Resource,
  metricNames: Array<string>,
): Promise<ReturnType<typeof render>> {
  mockResource = {
    _id: RESOURCE_ID.toString(),
    resourceIdentifier: `${resource.provider}|${resource.type}|resource`,
    name: "resource",
    cloudResourceKind: CloudResourceKind.Resource,
    telemetryAttributes: resource.telemetryAttributes,
    cloudProvider: resource.provider,
    cloudResourceType: resource.type,
  };
  mockMetricNames = metricNames;

  let view: ReturnType<typeof render> | undefined = undefined;
  await act(async () => {
    view = render(<CloudResourceMetrics {...({} as PageComponentProps)} />);
  });

  await waitFor(() => {
    for (const name of metricNames) {
      expect(lastRowOf(name)["lastValue"]).toBeDefined();
    }
  });

  return view!;
}

function lastRowOf(name: string): Record<string, unknown> {
  const rows: Array<Record<string, unknown>> = mockRowProps.filter(
    (props: Record<string, unknown>): boolean => {
      return (props["metric"] as { name: string }).name === name;
    },
  );
  expect(rows.length).toBeGreaterThan(0);
  return rows[rows.length - 1]!;
}

// The aggregate the row's sparkline was read with.
function requestOf(name: string): Record<string, unknown> {
  const requests: Array<Record<string, unknown>> = mockAggregateRequests.filter(
    (request: Record<string, unknown>) => {
      return (request["query"] as { name: string }).name === name;
    },
  );
  expect(requests).toHaveLength(1);
  return requests[0]!;
}

// What a row shows: the aggregation it was read with, its value, its caption.
function readingOf(name: string): {
  aggregationType: unknown;
  value: unknown;
  caption: unknown;
} {
  const row: Record<string, unknown> = lastRowOf(name);
  return {
    aggregationType: requestOf(name)["aggregationType"],
    value: row["lastValue"],
    caption: row["valueCaption"],
  };
}

const TOTAL: { aggregationType: unknown; value: unknown; caption: unknown } = {
  aggregationType: MetricsAggregationType.Sum,
  value: QUEUE_TOTAL,
  caption: CLOUD_RESOURCE_SUMMED_ROW_CAPTION,
};

// The metric explorer a row's click opens, as its URL says.
function clickRow(name: string): {
  query: MetricQueryConfigData;
  params: URLSearchParams;
} {
  navigateSpy.mockClear();
  fireEvent.click(screen.getByTestId(`row-${name}`));
  expect(navigateSpy).toHaveBeenCalledTimes(1);
  const url: globalThis.URL = new globalThis.URL(
    navigateSpy.mock.calls[0]![0]!.toString(),
  );
  const queries: Array<SerializedMetricQuery> =
    MetricExplorerUrl.parseMetricQueriesParam(
      url.searchParams.get(MetricExplorerUrlParam.MetricQueries)!,
    );
  expect(queries).toHaveLength(1);
  return {
    query: buildQueryConfigsFromSerializedQueries(queries)[0]!,
    params: url.searchParams,
  };
}

beforeEach(() => {
  mockRowProps.length = 0;
  mockAggregateRequests.length = 0;
  mockResource = null;
  mockMetricNames = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(RESOURCE_ID);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  // The list keeps its range in the page's URL.
  window.history.replaceState({}, "", "/");
});

describe("a split namespace's Metrics tab reads each metric as its queues' total", () => {
  test("a Service Bus namespace a connection reads: all six of its metrics read the total, not the average queue", async () => {
    await openTab(SERVICE_BUS, SERVICE_BUS_CONNECTION_METRICS);

    for (const name of SERVICE_BUS_CONNECTION_METRICS) {
      expect([name, readingOf(name)]).toEqual([name, TOTAL]);
      // Still the namespace's own series, by its resource id.
      expect(requestOf(name)["query"]).toMatchObject({
        attributes: SERVICE_BUS.telemetryAttributes,
      });
    }
  });

  test("a Service Bus namespace the collector's receiver reads: its queue metrics read the total, its send latency the average", async () => {
    await openTab(SERVICE_BUS, [
      "azure_activemessages_average",
      "azure_scheduledmessages_average",
      "azure_size_average",
      "azure_completemessage_total",
      "azure_abandonmessage_total",
      "azure_usererrors_total",
      "azure_serversendlatency_average",
      // A metric of the namespace with no queue in it.
      "azure_activeconnections_total",
    ]);

    for (const name of [
      "azure_activemessages_average",
      "azure_scheduledmessages_average",
      "azure_size_average",
      "azure_completemessage_total",
      "azure_abandonmessage_total",
      "azure_usererrors_total",
    ]) {
      expect([name, readingOf(name)]).toEqual([name, TOTAL]);
    }

    for (const name of [
      "azure_serversendlatency_average",
      "azure_activeconnections_total",
    ]) {
      expect([name, readingOf(name)]).toEqual([
        name,
        {
          aggregationType: MetricsAggregationType.Avg,
          value: QUEUE_AVERAGE,
          caption: CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
        },
      ]);
    }
  });

  test("an Event Hubs namespace reads its event hubs' total", async () => {
    const names: Array<string> = [
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
      "azure_quotaexceedederrors_total",
      "azure_size_average",
    ];
    await openTab(EVENT_HUBS, names);

    for (const name of names) {
      expect([name, readingOf(name)]).toEqual([name, TOTAL]);
    }
  });

  /*
   * The list reads its rows again whenever getRowAggregation changes, so a
   * page that built a new one on each render would read every row's
   * aggregate again each time it renders.
   */
  test("the tab reads its rows once, not again on each of the page's renders", async () => {
    const view: ReturnType<typeof render> = await openTab(SERVICE_BUS, [
      "azure_incomingmessages_total",
      "azure_serversendlatency_average",
    ]);
    const requestsBefore: number = mockAggregateRequests.length;
    const rowsBefore: number = mockRowProps.length;

    for (let pass: number = 0; pass < 2; pass++) {
      await act(async () => {
        view.rerender(<CloudResourceMetrics {...({} as PageComponentProps)} />);
      });
    }
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 50);
      });
    });

    // The page did render again, and read nothing again.
    expect(mockRowProps.length).toBeGreaterThan(rowsBefore);
    expect(mockAggregateRequests.length).toBe(requestsBefore);
    expect(readingOf("azure_incomingmessages_total")).toEqual(TOTAL);
  });
});

/*
 * Past 3 hours the aggregate API reads in intervals of 15 minutes and
 * longer (AggregationIntervalUtil), where a Sum of messages waiting would
 * add up every queue's every minute - 15 times the namespace's backlog over
 * a day. There the counts still read the queues' total, and messages
 * waiting read the average of series, as they did before #6410.
 */
describe("a split namespace's Metrics tab over a day", () => {
  test("its counts read the queues' total and its messages waiting their average, and each row opens so", async () => {
    window.history.replaceState(
      {},
      "",
      `/?range=${encodeURIComponent(TimeRange.PAST_ONE_DAY)}`,
    );
    await openTab(SERVICE_BUS, SERVICE_BUS_CONNECTION_METRICS);

    for (const name of [
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
    ]) {
      expect([name, readingOf(name)]).toEqual([name, TOTAL]);
    }

    for (const name of [
      "azure_activemessages_average",
      "azure_deadletteredmessages_average",
    ]) {
      expect([name, readingOf(name)]).toEqual([
        name,
        {
          aggregationType: MetricsAggregationType.Avg,
          value: QUEUE_AVERAGE,
          caption: CLOUD_RESOURCE_AVERAGED_ROW_CAPTION,
        },
      ]);
    }

    // The day the URL asked for is the day read.
    const read: Record<string, unknown> = requestOf(
      "azure_activemessages_average",
    );
    expect(
      (read["endTimestamp"] as Date).getTime() -
        (read["startTimestamp"] as Date).getTime(),
    ).toBe(24 * 60 * 60 * 1000);

    const waiting: { query: MetricQueryConfigData; params: URLSearchParams } =
      clickRow("azure_activemessages_average");
    expect(waiting.query.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Avg,
    );
    expect(waiting.params.get(MetricExplorerUrlParam.Range)).toBe(
      TimeRange.PAST_ONE_DAY,
    );
    expect(
      clickRow("azure_incomingmessages_total").query.metricQueryData.filterData
        .aggegationType,
    ).toBe(MetricsAggregationType.Sum);
  });
});

describe("a resource whose metrics are not split reads exactly as before", () => {
  test.each([
    [
      "an Azure virtual machine",
      "azure_percentage_cpu_average",
      VIRTUAL_MACHINE,
    ],
    [
      "an Azure virtual machine",
      "azure_network_in_total_total",
      VIRTUAL_MACHINE,
    ],
    [
      "an SQS queue",
      "amazonaws.com/AWS/SQS/ApproximateNumberOfMessagesVisible",
      SQS_QUEUE,
    ],
  ])(
    "%s's %s reads as the average, with no caption",
    async (_label: string, name: string, resource: Resource) => {
      await openTab(resource, [name]);

      expect(readingOf(name)).toEqual({
        aggregationType: MetricsAggregationType.Avg,
        value: QUEUE_AVERAGE,
        caption: undefined,
      });
      expect(
        clickRow(name).query.metricQueryData.filterData.aggegationType,
      ).toBe(MetricsAggregationType.Avg);
    },
  );
});

describe("what a row opens, and the monitor created from it", () => {
  test("a summed row opens the explorer with Sum, the namespace's filter and its markers", async () => {
    await openTab(SERVICE_BUS, [
      "azure_incomingmessages_total",
      "azure_serversendlatency_average",
    ]);

    const opened: { query: MetricQueryConfigData; params: URLSearchParams } =
      clickRow("azure_incomingmessages_total");

    expect(opened.query.metricQueryData.filterData).toMatchObject({
      metricName: "azure_incomingmessages_total",
      aggegationType: MetricsAggregationType.Sum,
      attributes: SERVICE_BUS.telemetryAttributes,
    });
    expect(opened.query.eventScope).toEqual({
      cloudResourceId: RESOURCE_ID.toString(),
    });
    expect(opened.params.get(MetricExplorerUrlParam.Range)).toBe(
      TimeRange.PAST_ONE_HOUR,
    );

    // A row the namespace averages opens with the average.
    expect(
      clickRow("azure_serversendlatency_average").query.metricQueryData
        .filterData.aggegationType,
    ).toBe(MetricsAggregationType.Avg);
  });

  /*
   * The explorer reads its view from the URL, "Create monitor from this
   * view" writes the view back into Monitor Create's URL, and Monitor
   * Create seeds the Metrics monitor's step from it - each with the
   * functions those pages call. The step's query is what the worker reads
   * (MonitorTelemetryMonitor.monitorMetric: filterData.aggegationType).
   */
  test("a monitor created from the chart reads the namespace's total too", async () => {
    await openTab(SERVICE_BUS, ["azure_activemessages_average"]);

    const opened: { query: MetricQueryConfigData; params: URLSearchParams } =
      clickRow("azure_activemessages_average");

    const explorerQueries: Array<MetricQueryConfigData> =
      buildQueryConfigsFromSerializedQueries(
        MetricExplorerUrl.parseMetricQueriesParam(
          opened.params.get(MetricExplorerUrlParam.MetricQueries)!,
        ),
      );
    const monitorParams: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData({
        startAndEndDate: new InBetween<Date>(
          new Date(opened.params.get(MetricExplorerUrlParam.StartTime)!),
          new Date(opened.params.get(MetricExplorerUrlParam.EndTime)!),
        ),
        rangeToken: opened.params.get(MetricExplorerUrlParam.Range)!,
        queryConfigs: explorerQueries,
        formulaConfigs: [],
      });

    const seeded: {
      queryConfigs: Array<MetricQueryConfigData>;
      serviceIds: Array<string>;
    } = MetricQueryServices.takeServiceIds(
      buildQueryConfigsFromSerializedQueries(
        MetricExplorerUrl.parseMetricQueriesParam(
          monitorParams[MetricExplorerUrlParam.MetricQueries]!,
        ),
      ),
    );

    expect(seeded.serviceIds).toEqual([]);
    expect(seeded.queryConfigs).toHaveLength(1);
    expect(seeded.queryConfigs[0]!.metricQueryData.filterData).toMatchObject({
      metricName: "azure_activemessages_average",
      aggegationType: MetricsAggregationType.Sum,
      attributes: SERVICE_BUS.telemetryAttributes,
    });
  });
});
