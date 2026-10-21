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
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A metric clicked on a queue's Metrics tab, charted in place under the
 * queue's key (the explorer the list opens by default scopes by attributes
 * only, and would chart the metric across every queue in the project):
 *
 *   - a curated broker metric of the queue's system reads exactly as Broker
 *     health reads it — a gauge per series and combined, a counter as a
 *     rate — and a gauge offers the same Create monitor link, built from
 *     the series observed in the chart's window;
 *   - any other metric is charted by what its newest point says it is: a
 *     histogram by percentile (p95 by default, with a picker), a cumulative
 *     counter as a rate; it gets no monitor link. Those rules are the Queues
 *     product's own, with no database engine catalog behind them;
 *   - every request carries the queue's key and nothing else.
 */

const aggregateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const chartCardMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b");
      },
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Normal: 0, Medium: 1, Large: 2 },
    default: (props: {
      title: string;
      description?: string;
      children?: React.ReactNode;
      onClose?: () => void;
    }) => {
      return (
        <section role="dialog" aria-label={props.title}>
          <p data-testid="modal-description">{props.description}</p>
          {props.children}
          <button onClick={props.onClose}>Close</button>
        </section>
      );
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (props: {
        value?: { range?: string };
        onChange: (value: { range: string }) => void;
      }) => {
        return (
          <div data-testid="time-range-picker" data-range={props.value?.range}>
            <button
              onClick={() => {
                props.onChange({ range: "Past 1 Day" });
              }}
            >
              Pick past day
            </button>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }) => {
        chartCardMock(props);
        return <div data-testid="chart-card">{props.title}</div>;
      },
    };
  },
);

import MessageQueueMetricChartModal, {
  MESSAGE_QUEUE_METRIC_CHART_COUNT_NOTE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueMetricChartModal";
import {
  MESSAGE_QUEUE_METRIC_CHART_COUNTER_NOTE,
  MessageQueueMetricChartSpec,
  MessageQueueMetricShape,
  MessageQueueTimePoint,
  UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE,
  fetchMessageQueueMetricChartSeries,
  fetchMessageQueueMetricShape,
  findMessageQueueCatalogMetric,
  getMessageQueueMetricChartSpec,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import Metric, {
  AggregationTemporality,
  MetricPointType,
} from "../../../Models/AnalyticsModels/Metric";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { parseMessageQueueIdentifier } from "../../../Types/MessageQueue/MessageQueueIdentity";
import TimeRange from "../../../Types/Time/TimeRange";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const KEY: string = "fedcba9876543210";

interface AggregateRequest {
  aggregateBy: Record<string, unknown> & { query: Record<string, unknown> };
}

// Minute-aligned points inside the past hour.
const NOW: number = Date.now();
function minute(index: number): Date {
  return new Date(Math.floor((NOW - (30 - index) * 60 * 1000) / 60000) * 60000);
}

function requests(): Array<AggregateRequest> {
  return aggregateMock.mock.calls.map(
    (call: Array<unknown>): AggregateRequest => {
      return call[0] as AggregateRequest;
    },
  );
}

function renderModal(props: {
  metricName: string;
  unit?: string;
  messagingSystem: string;
  identifier: string;
  keys?: Array<string>;
}): void {
  render(
    <MemoryRouter>
      <MessageQueueMetricChartModal
        metricName={props.metricName}
        unit={props.unit || ""}
        keys={props.keys || [KEY]}
        projectId={PROJECT_ID}
        messagingSystem={props.messagingSystem}
        identity={parseMessageQueueIdentifier(props.identifier)}
        queueName="orders"
        initialTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onClose={() => {}}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  aggregateMock.mockReset();
  getListMock.mockReset();
  chartCardMock.mockReset();
  aggregateMock.mockResolvedValue({ data: [] });
  getListMock.mockResolvedValue({ data: [], count: 0 });
});

afterEach(() => {
  cleanup();
});

describe("a curated broker metric, charted as Broker health reads it", () => {
  test("RabbitMQ's queue depth: its states added up, and Create monitor from the series observed", async () => {
    aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
      const by: AggregateRequest["aggregateBy"] = (request as AggregateRequest)
        .aggregateBy;
      if (by["aggregationInterval"] === AggregationInterval.Total) {
        return Promise.resolve({
          data: [
            {
              timestamp: minute(0),
              value: 3,
              attributes: { "resource.rabbitmq.queue.name": "orders" },
            },
          ],
        });
      }
      return Promise.resolve({
        data: [
          { timestamp: minute(0), value: 10, attributes: { state: "ready" } },
          {
            timestamp: minute(0),
            value: 5,
            attributes: { state: "unacknowledged" },
          },
        ],
      });
    });

    renderModal({
      metricName: "rabbitmq.message.current",
      messagingSystem: "rabbitmq",
      identifier: "rabbitmq||orders",
    });

    const link: HTMLElement = await screen.findByTestId(
      "message-queue-metric-chart-create-monitor",
    );
    expect(link.querySelector("a")!.getAttribute("href")).toContain(
      `/dashboard/${PROJECT_ID}/monitors/create?`,
    );
    /*
     * The threshold sits on the formula adding the states up, which Monitor
     * Create turns into a Warning criteria on the formula's alias.
     */
    const hint: HTMLElement = screen.getByTestId(
      "message-queue-metric-chart-monitor-hint",
    );
    expect(hint).toHaveTextContent(
      "Warning when any point in the last 10 minutes is above 1,000 messages.",
    );
    expect(hint).not.toHaveTextContent("takes no threshold from a formula");
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Queue depth (messages)",
    );
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Charted for this queue only.",
    );

    const [chart, observed] = [
      requests().find((request: AggregateRequest): boolean => {
        return (
          request.aggregateBy["aggregationInterval"] !==
          AggregationInterval.Total
        );
      })!,
      requests().find((request: AggregateRequest): boolean => {
        return (
          request.aggregateBy["aggregationInterval"] ===
          AggregationInterval.Total
        );
      })!,
    ];
    expect(chart.aggregateBy["groupByAttributeKeys"]).toEqual(["state"]);
    expect(chart.aggregateBy["aggregationType"]).toBe(AggregationType.Avg);
    expect(observed.aggregateBy["groupByAttributeKeys"]).toEqual([
      "resource.rabbitmq.queue.name",
    ]);
    for (const request of requests()) {
      expect(
        (request.aggregateBy.query["entityKeys"] as Includes).values,
      ).toEqual([KEY]);
      expect(request.aggregateBy.query["attributes"]).toBeUndefined();
    }

    await waitFor(() => {
      const last: Record<string, unknown> = chartCardMock.mock.calls[
        chartCardMock.mock.calls.length - 1
      ]![0] as Record<string, unknown>;
      const series: Array<{ data: Array<{ y: number }> }> = last[
        "series"
      ] as Array<{ data: Array<{ y: number }> }>;
      expect(
        series[0]!.data.map((point: { y: number }): number => {
          return point.y;
        }),
      ).toEqual([15]);
    });
    // A curated metric's shape is never read.
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a curated counter: a rate, a note that says so, and no monitor", async () => {
    renderModal({
      metricName: "rabbitmq.message.published",
      messagingSystem: "rabbitmq",
      identifier: "rabbitmq||orders",
    });

    expect(
      await screen.findByTestId("message-queue-metric-chart-note"),
    ).toHaveTextContent("A cumulative counter, charted as a per-second rate");
    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalled();
    });
    expect(requests()).toHaveLength(1);
    expect(requests()[0]!.aggregateBy["groupBy"]).toEqual({ attributes: true });
    expect(requests()[0]!.aggregateBy["aggregationType"]).toBe(
      AggregationType.Max,
    );
    expect(
      screen.queryByTestId("message-queue-metric-chart-create-monitor"),
    ).toBeNull();
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Published (per second)",
    );
  });

  test("a curated per-period count: one pooled Sum, a note on whole intervals, and the criteria Monitor Create starts with", async () => {
    aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
      const by: AggregateRequest["aggregateBy"] = (request as AggregateRequest)
        .aggregateBy;
      if (by["aggregationInterval"] === AggregationInterval.Total) {
        return Promise.resolve({
          data: [
            {
              timestamp: minute(0),
              value: 3,
              attributes: {
                metadata_entityname: "orders",
                name: "orders-prod",
                type: "Microsoft.ServiceBus/Namespaces",
              },
            },
          ],
        });
      }
      return Promise.resolve({
        data: [{ timestamp: minute(0), value: 12 }],
      });
    });

    renderModal({
      metricName: "azure_servererrors_total",
      messagingSystem: "servicebus",
      identifier: "servicebus|orders-prod|orders",
    });

    expect(
      await screen.findByTestId("message-queue-metric-chart-note"),
    ).toHaveTextContent(MESSAGE_QUEUE_METRIC_CHART_COUNT_NOTE);
    expect(
      await screen.findByTestId("message-queue-metric-chart-monitor-hint"),
    ).toHaveTextContent(
      "Warning when any point in the last 5 minutes is above 10 requests.",
    );
    const chart: AggregateRequest = requests().find(
      (request: AggregateRequest): boolean => {
        return (
          request.aggregateBy["aggregationInterval"] !==
          AggregationInterval.Total
        );
      },
    )!;
    // Summed across operation results on the server, never carried forward.
    expect(chart.aggregateBy["aggregationType"]).toBe(AggregationType.Sum);
    expect(chart.aggregateBy["groupByAttributeKeys"]).toBeUndefined();
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Server errors (requests)",
    );
  });

  test("a gauge whose observed series are another queue's: no link", async () => {
    aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
      const by: AggregateRequest["aggregateBy"] = (request as AggregateRequest)
        .aggregateBy;
      if (by["aggregationInterval"] === AggregationInterval.Total) {
        return Promise.resolve({
          data: [
            {
              timestamp: minute(0),
              value: 3,
              attributes: { topic: "payments" },
            },
          ],
        });
      }
      return Promise.resolve({
        data: [{ timestamp: minute(0), value: 9, attributes: { group: "g" } }],
      });
    });

    renderModal({
      metricName: "kafka.consumer_group.lag_sum",
      messagingSystem: "kafka",
      identifier: "kafka||orders",
    });

    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalledTimes(2);
    });
    expect(
      screen.queryByTestId("message-queue-metric-chart-create-monitor"),
    ).toBeNull();
  });

  test("the catalog lookup is by the queue's own system and the exact stored name", () => {
    expect(
      findMessageQueueCatalogMetric("kafka", "kafka.consumer_group.lag_sum")
        ?.system,
    ).toBe("kafka");
    // Another system's broker metric is just a metric here.
    expect(
      findMessageQueueCatalogMetric("rabbitmq", "kafka.consumer_group.lag_sum"),
    ).toBeNull();
    // A name a rename rule stored in another casing is another metric.
    expect(
      findMessageQueueCatalogMetric("kafka", "Kafka.Consumer_Group.Lag_Sum"),
    ).toBeNull();
    // Service Bus and Event Hubs share names: the system decides.
    expect(
      findMessageQueueCatalogMetric("eventhubs", "azure_incomingmessages_total")
        ?.system,
    ).toBe("eventhubs");
    expect(findMessageQueueCatalogMetric("jms", "anything")).toBeNull();
    expect(findMessageQueueCatalogMetric("kafka", "  ")).toBeNull();
  });
});

describe("any other metric, charted by what it is", () => {
  test("a histogram: p95 by default, from its buckets, with a picker; no monitor", async () => {
    getListMock.mockResolvedValue({
      data: [{ metricPointType: MetricPointType.Histogram }],
      count: 1,
    });

    renderModal({
      metricName: "messaging.client.operation.duration",
      unit: "s",
      messagingSystem: "kafka",
      identifier: "kafka||orders",
    });

    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalled();
    });
    expect(requests()[0]!.aggregateBy["aggregationType"]).toBe(
      AggregationType.P95,
    );
    expect(requests()[0]!.aggregateBy.query["name"]).toBe(
      "messaging.client.operation.duration",
    );
    expect(
      (requests()[0]!.aggregateBy.query["entityKeys"] as Includes).values,
    ).toEqual([KEY]);

    const group: HTMLElement = screen.getByRole("group", {
      name: "Aggregation",
    });
    expect(group).toHaveTextContent("p95");
    fireEvent.click(screen.getByText("Average"));
    await waitFor(() => {
      expect(
        requests()[requests().length - 1]!.aggregateBy["aggregationType"],
      ).toBe(AggregationType.Avg);
    });
    expect(
      screen.queryByTestId("message-queue-metric-chart-create-monitor"),
    ).toBeNull();
    expect(screen.getByTestId("modal-description")).toHaveTextContent(
      "Charted for this queue only: the datapoints tagged with its key.",
    );
  });

  test("a cumulative counter: a per-second rate", async () => {
    getListMock.mockResolvedValue({
      data: [
        {
          metricPointType: MetricPointType.Sum,
          isMonotonic: true,
          aggregationTemporality: "Cumulative",
        },
      ],
      count: 1,
    });

    renderModal({
      metricName: "messaging.client.sent.messages",
      messagingSystem: "kafka",
      identifier: "kafka||orders",
    });

    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalled();
    });
    expect(requests()[0]!.aggregateBy["groupBy"]).toEqual({ attributes: true });
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "messaging.client.sent.messages (per second)",
    );
  });

  test("the picker's range is the chart's", async () => {
    renderModal({
      metricName: "rabbitmq.message.current",
      messagingSystem: "rabbitmq",
      identifier: "rabbitmq||orders",
    });
    await waitFor(() => {
      expect(aggregateMock).toHaveBeenCalled();
    });
    const before: number = aggregateMock.mock.calls.length;

    fireEvent.click(screen.getByText("Pick past day"));

    await waitFor(() => {
      expect(aggregateMock.mock.calls.length).toBeGreaterThan(before);
    });
    const last: AggregateRequest = requests()[requests().length - 1]!;
    const start: Date = last.aggregateBy["startTimestamp"] as Date;
    const end: Date = last.aggregateBy["endTimestamp"] as Date;
    expect(Math.round((end.getTime() - start.getTime()) / 3600000)).toBe(24);
  });

  test("no key: nothing is asked", async () => {
    renderModal({
      metricName: "messaging.client.sent.messages",
      messagingSystem: "kafka",
      identifier: "kafka||orders",
      keys: [],
    });

    await screen.findByTestId("message-queue-metric-chart");
    await waitFor(() => {
      expect(chartCardMock).toHaveBeenCalled();
    });
    expect(aggregateMock).not.toHaveBeenCalled();
    expect(getListMock).not.toHaveBeenCalled();
  });
});

/*
 * How the chart reads a metric outside the catalog is the Queues product's
 * own (getMessageQueueMetricChartSpec, fetchMessageQueueMetricShape,
 * fetchMessageQueueMetricChartSeries): by the metric's shape alone, with no
 * database engine catalog or engine unit correction behind it.
 */
describe("a metric outside the catalog: how it is charted", () => {
  const NAME: string = "messaging.client.sent.messages";

  const GAUGE_SPEC: MessageQueueMetricChartSpec = {
    metricName: NAME,
    title: NAME,
    mode: "aggregate",
    aggregations: [
      AggregationType.Avg,
      AggregationType.Max,
      AggregationType.Min,
      AggregationType.Sum,
    ],
    defaultAggregation: AggregationType.Avg,
    isRate: false,
    isDistribution: false,
    unit: "",
    note: "",
  };

  test.each([MetricPointType.Histogram, MetricPointType.ExponentialHistogram])(
    "%s points: percentiles from their buckets, p95 first",
    (pointType: MetricPointType) => {
      expect(
        getMessageQueueMetricChartSpec(`  ${NAME} `, {
          pointType: pointType,
          unit: " s ",
        }),
      ).toEqual({
        metricName: NAME,
        title: NAME,
        mode: "aggregate",
        aggregations: [
          AggregationType.P50,
          AggregationType.P90,
          AggregationType.P95,
          AggregationType.P99,
          AggregationType.Avg,
          AggregationType.Max,
          AggregationType.Min,
        ],
        defaultAggregation: AggregationType.P95,
        isRate: false,
        isDistribution: true,
        unit: "s",
        note: "A distribution: percentiles are computed from its buckets, Average is the mean of every observation.",
      });
    },
  );

  test("a cumulative counter: a per-second rate, with nothing to pick", () => {
    const rate: MessageQueueMetricChartSpec = {
      metricName: NAME,
      title: `${NAME} (per second)`,
      mode: "rate",
      aggregations: [],
      defaultAggregation: AggregationType.Max,
      isRate: true,
      isDistribution: false,
      unit: "{message}",
      note: MESSAGE_QUEUE_METRIC_CHART_COUNTER_NOTE,
    };
    expect(
      getMessageQueueMetricChartSpec(NAME, {
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        aggregationTemporality: AggregationTemporality.Cumulative,
        unit: "{message}",
      }),
    ).toEqual(rate);
    // A monotonic Sum that names no temporality reads as cumulative.
    expect(
      getMessageQueueMetricChartSpec(NAME, {
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        unit: "{message}",
      }),
    ).toEqual(rate);
    // The same words as a curated counter's chart.
    expect(MESSAGE_QUEUE_METRIC_CHART_COUNTER_NOTE).toBe(
      "A cumulative counter, charted as a per-second rate: each series' rate, added up.",
    );
  });

  test("a delta counter: the total counted in each interval", () => {
    expect(
      getMessageQueueMetricChartSpec(NAME, {
        pointType: MetricPointType.Sum,
        isMonotonic: true,
        aggregationTemporality: AggregationTemporality.Delta,
      }),
    ).toEqual({
      ...GAUGE_SPEC,
      aggregations: [
        AggregationType.Sum,
        AggregationType.Avg,
        AggregationType.Max,
        AggregationType.Min,
      ],
      defaultAggregation: AggregationType.Sum,
      note: "A delta counter: Sum is the total counted in each interval.",
    });
  });

  test.each([
    [
      "an up-down counter",
      {
        pointType: MetricPointType.Sum,
        isMonotonic: false,
        aggregationTemporality: AggregationTemporality.Cumulative,
      },
    ],
    ["a gauge", { pointType: MetricPointType.Gauge }],
    ["a summary", { pointType: MetricPointType.Summary }],
    ["a metric whose shape is unknown", UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE],
    ["no shape at all", null],
  ])(
    "%s: averaged per interval, any aggregation to pick",
    (_case: string, shape: Partial<MessageQueueMetricShape> | null) => {
      expect(getMessageQueueMetricChartSpec(NAME, shape)).toEqual(GAUGE_SPEC);
    },
  );

  test("a Databases catalog metric's name means nothing here: its shape alone decides", () => {
    /*
     * The Databases chart reads its engine catalog by name and re-reads
     * MariaDB's `mysql.buffer_pool.limit` in pages; neither applies to a
     * metric under a queue's key.
     */
    expect(
      getMessageQueueMetricChartSpec("mysql.buffer_pool.limit", {
        pointType: MetricPointType.Gauge,
        unit: "By",
      }),
    ).toEqual({
      ...GAUGE_SPEC,
      metricName: "mysql.buffer_pool.limit",
      title: "mysql.buffer_pool.limit",
      unit: "By",
    });
    expect(
      getMessageQueueMetricChartSpec("postgresql.backends", {
        pointType: MetricPointType.Sum,
        isMonotonic: false,
      }),
    ).toEqual({
      ...GAUGE_SPEC,
      metricName: "postgresql.backends",
      title: "postgresql.backends",
    });
  });
});

describe("a metric outside the catalog: read under the queue's key", () => {
  const NAME_OF_COUNTER: string = "messaging.client.consumed.messages";
  const START: Date = new Date("2026-09-24T10:00:00.000Z");
  const WINDOW: {
    projectId: string;
    keys: Array<string>;
    start: Date;
    end: Date;
  } = {
    projectId: PROJECT_ID,
    keys: [KEY],
    start: START,
    end: new Date("2026-09-24T11:00:00.000Z"),
  };

  function at(minuteIndex: number): Date {
    return new Date(START.getTime() + minuteIndex * 60 * 1000);
  }

  // The query every read sends: the metric under the key, nothing more.
  function expectKeyedQuery(
    query: Record<string, unknown>,
    metricName: string,
  ): void {
    expect(Object.keys(query).sort()).toEqual([
      "entityKeys",
      "name",
      "projectId",
      "time",
    ]);
    expect(query["name"]).toBe(metricName);
    expect((query["entityKeys"] as Includes).values).toEqual([KEY]);
    expect(String(query["projectId"])).toBe(PROJECT_ID);
    expect(query["time"]).toBeInstanceOf(InBetween);
  }

  test("its shape: the newest point under the key, and nothing else", async () => {
    getListMock.mockResolvedValue({
      data: [
        {
          metricPointType: MetricPointType.Histogram,
          isMonotonic: false,
          aggregationTemporality: AggregationTemporality.Delta,
        },
      ],
      count: 1,
    });

    const shape: MessageQueueMetricShape = await fetchMessageQueueMetricShape({
      ...WINDOW,
      metricName: " messaging.client.operation.duration ",
      unit: " s ",
    });

    expect(shape).toEqual({
      unit: "s",
      pointType: MetricPointType.Histogram,
      isMonotonic: false,
      aggregationTemporality: AggregationTemporality.Delta,
    });
    expect(getListMock).toHaveBeenCalledTimes(1);
    const request: Record<string, unknown> & {
      query: Record<string, unknown>;
    } = getListMock.mock.calls[0]![0] as Record<string, unknown> & {
      query: Record<string, unknown>;
    };
    expect(request["modelType"]).toBe(Metric);
    expectKeyedQuery(request.query, "messaging.client.operation.duration");
    expect(request["select"]).toEqual({
      metricPointType: true,
      isMonotonic: true,
      aggregationTemporality: true,
    });
    expect(request["sort"]).toEqual({ time: SortOrder.Descending });
    expect(request["limit"]).toBe(1);
  });

  test("a shape it cannot read is unknown: odd values, no point, a failure, no key", async () => {
    const unknown: MessageQueueMetricShape = {
      ...UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE,
      unit: "By",
    };

    getListMock.mockResolvedValue({
      data: [
        {
          metricPointType: "Bogus",
          isMonotonic: "yes",
          aggregationTemporality: "Sometimes",
        },
      ],
      count: 1,
    });
    expect(
      await fetchMessageQueueMetricShape({
        ...WINDOW,
        metricName: "m",
        unit: "By",
      }),
    ).toEqual(unknown);

    getListMock.mockResolvedValue({ data: [], count: 0 });
    expect(
      await fetchMessageQueueMetricShape({
        ...WINDOW,
        metricName: "m",
        unit: "By",
      }),
    ).toEqual(unknown);

    getListMock.mockRejectedValue(new Error("unavailable"));
    expect(
      await fetchMessageQueueMetricShape({
        ...WINDOW,
        metricName: "m",
        unit: "By",
      }),
    ).toEqual(unknown);

    getListMock.mockReset();
    expect(
      await fetchMessageQueueMetricShape({
        ...WINDOW,
        keys: [],
        metricName: "m",
      }),
    ).toEqual(UNKNOWN_MESSAGE_QUEUE_METRIC_SHAPE);
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a cumulative counter: each series' Max per interval, a rate per series, the rates added up", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: at(1), value: 0, attributes: { host: "a" } },
        { timestamp: at(2), value: 60, attributes: { host: "a" } },
        { timestamp: at(3), value: 180, attributes: { host: "a" } },
        { timestamp: at(1), value: 0, attributes: { host: "b" } },
        { timestamp: at(2), value: 120, attributes: { host: "b" } },
      ],
    });

    const points: Array<MessageQueueTimePoint> =
      await fetchMessageQueueMetricChartSeries({
        ...WINDOW,
        spec: getMessageQueueMetricChartSpec(NAME_OF_COUNTER, {
          pointType: MetricPointType.Sum,
          isMonotonic: true,
          aggregationTemporality: AggregationTemporality.Cumulative,
        }),
        // The picker's choice means nothing to a rate.
        aggregationType: AggregationType.Avg,
      });

    // 1/s + 2/s, then 2/s.
    expect(points).toEqual([
      { x: at(2), y: 3 },
      { x: at(3), y: 2 },
    ]);
    expect(requests()).toHaveLength(1);
    const request: AggregateRequest = requests()[0]!;
    expect(request.aggregateBy["aggregationType"]).toBe(AggregationType.Max);
    expect(request.aggregateBy["groupBy"]).toEqual({ attributes: true });
    expect(request.aggregateBy["aggregateColumnName"]).toBe("value");
    expect(request.aggregateBy["aggregationTimestampColumnName"]).toBe("time");
    expectKeyedQuery(request.aggregateBy.query, NAME_OF_COUNTER);
  });

  test("anything else: every series pooled with the picked aggregation", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: at(2), value: 7 },
        { timestamp: at(1), value: 5 },
      ],
    });

    const points: Array<MessageQueueTimePoint> =
      await fetchMessageQueueMetricChartSeries({
        ...WINDOW,
        spec: getMessageQueueMetricChartSpec(
          "messaging.client.operation.duration",
          {
            pointType: MetricPointType.Histogram,
          },
        ),
        aggregationType: AggregationType.P99,
      });

    expect(points).toEqual([
      { x: at(1), y: 5 },
      { x: at(2), y: 7 },
    ]);
    const request: AggregateRequest = requests()[0]!;
    expect(request.aggregateBy["aggregationType"]).toBe(AggregationType.P99);
    expect(request.aggregateBy["groupBy"]).toBeUndefined();
    expectKeyedQuery(
      request.aggregateBy.query,
      "messaging.client.operation.duration",
    );
  });

  test("no key or no project: nothing is asked; a failed read is an empty chart", async () => {
    const spec: MessageQueueMetricChartSpec = getMessageQueueMetricChartSpec(
      "m",
      null,
    );

    expect(
      await fetchMessageQueueMetricChartSeries({
        ...WINDOW,
        keys: [],
        spec: spec,
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
    expect(
      await fetchMessageQueueMetricChartSeries({
        ...WINDOW,
        projectId: "",
        spec: spec,
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();

    aggregateMock.mockRejectedValue(new Error("unavailable"));
    expect(
      await fetchMessageQueueMetricChartSeries({
        ...WINDOW,
        spec: spec,
        aggregationType: AggregationType.Avg,
      }),
    ).toEqual([]);
  });
});
