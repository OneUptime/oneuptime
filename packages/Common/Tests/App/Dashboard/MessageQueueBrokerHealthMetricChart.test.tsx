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
 *     counter as a rate; it gets no monitor link;
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
import { findMessageQueueCatalogMetric } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import Includes from "../../../Types/BaseDatabase/Includes";
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
     * Create does not read: no criteria is promised, and what to add is said.
     */
    const hint: HTMLElement = screen.getByTestId(
      "message-queue-metric-chart-monitor-hint",
    );
    expect(hint).toHaveTextContent(
      "No starting threshold · 10-minute window. Monitor Create takes no threshold from a formula",
    );
    expect(hint).toHaveTextContent("is above 1,000 messages.");
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
