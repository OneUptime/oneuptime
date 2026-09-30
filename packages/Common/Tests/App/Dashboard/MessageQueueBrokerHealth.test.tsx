import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import fs from "fs";
import path from "path";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A queue's Broker health: the curated broker metrics of its messaging
 * system, read under the queue's entity key the way the catalog says, and
 * the card that says where they come from while none has arrived. What it
 * pins:
 *
 *   - the queries: one per catalog metric, scoped by the key and nothing
 *     else; a gauge grouped by its series keys, folded by its aggregation
 *     and combined by its seriesCombine (RabbitMQ's ready + unacknowledged
 *     summed, Kafka's groups at their worst); a counter read per series as
 *     a rate and the rates summed; the series a monitor filter can pin read
 *     only for gauges that have data;
 *   - nothing is sent without a key, and a failed query is an empty chart;
 *   - the section per system: tiles and charts for the metrics with data,
 *     "Create monitor" on gauges only, and — without data — the system's
 *     metrics source from the catalog, linking to its own section of the
 *     Queues guide (every anchor a real heading of queues.md).
 */

const aggregateMock: MockFunction = getJestMockFunction();
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

import MessageQueueBrokerHealthSection, {
  BROKER_HEALTH_METRICS_EXPLORER_LINK_LABEL,
  BROKER_HEALTH_NO_DATA_TITLE,
  BROKER_HEALTH_SETUP_LINK_LABEL,
  BROKER_HEALTH_TITLE,
  getMessageQueueBrokerMonitorLinks,
  renderMessageQueueInlineCode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueBrokerHealthSection";
import {
  MessageQueueBrokerMetricResult,
  MessageQueueMetricListValue,
  MessageQueueObservedSeries,
  MessageQueueTimePoint,
  fetchMessageQueueBrokerMetrics,
  fetchMessageQueueCatalogMetricSeries,
  fetchMessageQueueMetricListValues,
  fetchMessageQueueObservedSeries,
  hasMessageQueueBrokerMetricData,
  toMessageQueueBrokerMetricResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import {
  MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR,
  MESSAGE_QUEUE_BROKER_METRICS_DOCS_ANCHOR,
  MessageQueueBrokerMetricsGuidance,
  getMessageQueueBrokerMetricCaption,
  getMessageQueueBrokerMetricChartTitle,
  getMessageQueueBrokerMetricsGuidance,
  getMessageQueueBrokerMetricsNoDataDescription,
  getMessageQueueMetricListCaption,
  getMessageQueueSystemDocsRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueOverviewPresentation";
import { MessageQueueMetricMonitorLink } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueMetricMonitorLink";
import {
  MessageQueueChartedMetricRow,
  getMessageQueueChartedMetricRows,
  getMessageQueueSystemGuideMarkdown,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/MessageQueue/Utils/DocumentationMarkdown";
import slugify from "../../../Server/Types/MarkdownSlugify";
import Metric from "../../../Models/AnalyticsModels/Metric";
import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import {
  MessageQueueIdentity,
  parseMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  getMessageQueueMetricDescriptorsByName,
  getMessageQueueMetricId,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";
import {
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import { getMessageQueueMetricFilterAttributeKeys } from "../../../Types/Monitor/MessageQueueAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  toStoredColumns,
} from "../../Types/MessageQueue/MessagingTelemetryFixtures";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const MODEL_ID: ObjectID = new ObjectID("5c1e0d2a-7b3c-4d5e-8f60-000000000456");
const KEY: string = "0123456789abcdef";
const START: Date = new Date("2026-09-24T10:00:00.000Z");
const END: Date = new Date("2026-09-24T11:00:00.000Z");

const QUEUES_DOC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
  "telemetry",
  "queues.md",
);

interface AggregateRequest {
  modelType: unknown;
  aggregateBy: Record<string, unknown> & { query: Record<string, unknown> };
}

function at(minute: number): Date {
  return new Date(START.getTime() + minute * 60 * 1000);
}

function descriptorOf(
  system: string,
  metricName: string,
): MessageQueueMetricDescriptor {
  return getMessageQueueMetricDescriptorsByName(metricName).find(
    (candidate: MessageQueueMetricDescriptor): boolean => {
      return candidate.system === system;
    },
  )!;
}

function lastRequest(): AggregateRequest {
  const calls: Array<Array<unknown>> = aggregateMock.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as AggregateRequest;
}

function window(keys: Array<string> = [KEY]): {
  projectId: string;
  keys: Array<string>;
  start: Date;
  end: Date;
} {
  return { projectId: PROJECT_ID, keys: keys, start: START, end: END };
}

function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();
  for (const line of markdown.split("\n")) {
    const match: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (match) {
      slugs.add(slugify(match[1]!));
    }
  }
  return slugs;
}

function points(values: Array<number>): Array<MessageQueueTimePoint> {
  return values.map((value: number, index: number): MessageQueueTimePoint => {
    return { x: at(index), y: value };
  });
}

beforeEach(() => {
  aggregateMock.mockReset();
  chartCardMock.mockReset();
  aggregateMock.mockResolvedValue({ data: [] });
});

afterEach(() => {
  cleanup();
});

describe("reading one catalog metric", () => {
  test("RabbitMQ's queue depth: grouped by state, averaged per series, the states added up", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        { timestamp: at(0), value: 10, attributes: { state: "ready" } },
        {
          timestamp: at(0),
          value: 5,
          attributes: { state: "unacknowledged" },
        },
        { timestamp: at(1), value: 12, attributes: { state: "ready" } },
        {
          timestamp: at(1),
          value: 3,
          attributes: { state: "unacknowledged" },
        },
      ],
    });

    const series: Array<MessageQueueTimePoint> =
      await fetchMessageQueueCatalogMetricSeries({
        ...window(),
        descriptor: descriptorOf("rabbitmq", "rabbitmq.message.current"),
      });

    expect(series).toEqual(points([15, 15]));
    const request: AggregateRequest = lastRequest();
    expect(request.modelType).toBe(Metric);
    expect(request.aggregateBy["aggregationType"]).toBe(AggregationType.Avg);
    expect(request.aggregateBy["groupByAttributeKeys"]).toEqual(["state"]);
    expect(request.aggregateBy["groupBy"]).toBeUndefined();
    expect(request.aggregateBy.query["name"]).toBe("rabbitmq.message.current");
    expect(
      (request.aggregateBy.query["entityKeys"] as Includes).values,
    ).toEqual([KEY]);
    expect(request.aggregateBy.query["time"]).toBeInstanceOf(InBetween);
    expect(String(request.aggregateBy.query["projectId"])).toBe(PROJECT_ID);
    // The key is the queue: no attribute filter.
    expect(request.aggregateBy.query["attributes"]).toBeUndefined();
  });

  test("Kafka's consumer lag: the group furthest behind, pooled on the server as its monitor reads it", async () => {
    // The Max of every group's Max is the Max of all: one row per interval.
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 70 }],
    });

    const series: Array<MessageQueueTimePoint> =
      await fetchMessageQueueCatalogMetricSeries({
        ...window(),
        descriptor: descriptorOf("kafka", "kafka.consumer_group.lag_sum"),
      });

    expect(series).toEqual(points([70]));
    expect(aggregateMock).toHaveBeenCalledTimes(1);
    expect(lastRequest().aggregateBy["aggregationType"]).toBe(
      AggregationType.Max,
    );
    expect(lastRequest().aggregateBy["groupByAttributeKeys"]).toBeUndefined();
    expect(lastRequest().aggregateBy["groupBy"]).toBeUndefined();
  });

  test("a gauge whose fold does not compose is read per series, and read again wider when the row limit cut it off", async () => {
    // ActiveMQ's queue size: each broker's Average, the brokers added up.
    const size: MessageQueueMetricDescriptor = descriptorOf(
      "activemq",
      "activemq.message.queue.size",
    );
    aggregateMock
      .mockResolvedValueOnce({
        data: [
          {
            timestamp: at(1),
            value: 4,
            attributes: { "activemq.broker.name": "a" },
          },
        ],
        truncated: true,
      })
      .mockResolvedValueOnce({
        data: [
          {
            timestamp: at(0),
            value: 3,
            attributes: { "activemq.broker.name": "a" },
          },
          {
            timestamp: at(0),
            value: 5,
            attributes: { "activemq.broker.name": "b" },
          },
        ],
        truncated: false,
      });

    const series: Array<MessageQueueTimePoint> =
      await fetchMessageQueueCatalogMetricSeries({
        ...window(),
        descriptor: size,
      });

    expect(series).toEqual(points([8]));
    const calls: Array<Array<unknown>> = aggregateMock.mock.calls;
    expect(calls).toHaveLength(2);
    const first: AggregateRequest = calls[0]![0] as AggregateRequest;
    const second: AggregateRequest = calls[1]![0] as AggregateRequest;
    expect(first.aggregateBy["groupByAttributeKeys"]).toEqual(size.seriesKeys);
    expect(first.aggregateBy["aggregationInterval"]).toBeUndefined();
    expect(second.aggregateBy["aggregationInterval"]).toBe(
      AggregationInterval.FiveMinutes,
    );
    expect(second.aggregateBy["groupByAttributeKeys"]).toEqual(size.seriesKeys);
  });

  test("a gauge without series keys is read as one pooled series", async () => {
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 42 }],
    });

    const series: Array<MessageQueueTimePoint> =
      await fetchMessageQueueCatalogMetricSeries({
        ...window(),
        descriptor: descriptorOf(
          "aws_sqs",
          "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        ),
      });

    expect(series).toEqual(points([42]));
    expect(lastRequest().aggregateBy["groupByAttributeKeys"]).toBeUndefined();
    expect(lastRequest().aggregateBy["aggregationType"]).toBe(
      AggregationType.Avg,
    );
  });

  test("an Azure count per minute is summed within an interval, never a rate", async () => {
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 120 }],
    });

    const series: Array<MessageQueueTimePoint> =
      await fetchMessageQueueCatalogMetricSeries({
        ...window(),
        descriptor: descriptorOf("servicebus", "azure_incomingmessages_total"),
      });

    expect(series).toEqual(points([120]));
    expect(lastRequest().aggregateBy["aggregationType"]).toBe(
      AggregationType.Sum,
    );
    expect(lastRequest().aggregateBy["groupBy"]).toBeUndefined();
  });

  test("a counter: the Max of each series per interval, a rate per series, the rates added up", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        {
          timestamp: at(0),
          value: 1000,
          attributes: { topic: "orders", group: "billing" },
        },
        {
          timestamp: at(1),
          value: 1060,
          attributes: { topic: "orders", group: "billing" },
        },
        {
          timestamp: at(0),
          value: 500000,
          attributes: { topic: "orders", group: "shipping" },
        },
        {
          timestamp: at(1),
          value: 500120,
          attributes: { topic: "orders", group: "shipping" },
        },
      ],
    });

    const series: Array<MessageQueueTimePoint> =
      await fetchMessageQueueCatalogMetricSeries({
        ...window(),
        descriptor: descriptorOf("kafka", "kafka.consumer_group.offset_sum"),
      });

    // 60/min + 120/min: 3 per second — never the two totals compared.
    expect(series).toHaveLength(1);
    expect(series[0]!.x).toEqual(at(1));
    expect(series[0]!.y).toBeCloseTo(3, 10);
    expect(lastRequest().aggregateBy["aggregationType"]).toBe(
      AggregationType.Max,
    );
    expect(lastRequest().aggregateBy["groupBy"]).toEqual({ attributes: true });
    expect(lastRequest().aggregateBy["groupByAttributeKeys"]).toBeUndefined();
  });

  test("no key, no request; a failed request, an empty chart", async () => {
    const descriptor: MessageQueueMetricDescriptor = descriptorOf(
      "kafka",
      "kafka.consumer_group.lag_sum",
    );

    expect(
      await fetchMessageQueueCatalogMetricSeries({
        ...window([]),
        descriptor,
      }),
    ).toEqual([]);
    expect(
      await fetchMessageQueueCatalogMetricSeries({
        ...window(),
        projectId: "",
        descriptor,
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();

    aggregateMock.mockRejectedValue(new Error("boom"));
    expect(
      await fetchMessageQueueCatalogMetricSeries({ ...window(), descriptor }),
    ).toEqual([]);
  });
});

describe("the series a monitor filter can pin", () => {
  test("one aggregate over the window, grouped by the destination, scope and required keys", async () => {
    aggregateMock.mockResolvedValue({
      data: [
        {
          timestamp: at(0),
          value: 30,
          attributes: {
            metadata_entityname: "orders",
            metadata_EntityName: "",
            name: "orders-prod",
            type: "Microsoft.ServiceBus/Namespaces",
          },
        },
        // The same series again: read once.
        {
          timestamp: at(0),
          value: 30,
          attributes: {
            metadata_entityname: "orders",
            metadata_EntityName: "",
            name: "orders-prod",
            type: "Microsoft.ServiceBus/Namespaces",
          },
        },
      ],
    });

    const series: Array<MessageQueueObservedSeries> =
      await fetchMessageQueueObservedSeries({
        ...window(),
        descriptor: descriptorOf("servicebus", "azure_activemessages_average"),
      });

    expect(series).toEqual([
      {
        metadata_entityname: "orders",
        metadata_EntityName: "",
        name: "orders-prod",
        type: "Microsoft.ServiceBus/Namespaces",
      },
    ]);
    const request: AggregateRequest = lastRequest();
    expect(request.aggregateBy["groupByAttributeKeys"]).toEqual([
      "metadata_entityname",
      "metadata_EntityName",
      "name",
      "type",
    ]);
    expect(request.aggregateBy["aggregationInterval"]).toBe(
      AggregationInterval.Total,
    );
    expect(request.aggregateBy.query["name"]).toBe(
      "azure_activemessages_average",
    );
    expect(
      (request.aggregateBy.query["entityKeys"] as Includes).values,
    ).toEqual([KEY]);
  });

  test("a key a series lacks reads '' and a number reads as its text", async () => {
    aggregateMock.mockResolvedValue({
      data: [{ timestamp: at(0), value: 1, attributes: { topic: 7 } }, {}],
    });

    expect(
      await fetchMessageQueueObservedSeries({
        ...window(),
        descriptor: descriptorOf("kafka", "kafka.consumer_group.lag_sum"),
      }),
    ).toEqual([{ topic: "7" }, { topic: "" }]);
  });

  test("no key, no request; a failed request, no series", async () => {
    const descriptor: MessageQueueMetricDescriptor = descriptorOf(
      "kafka",
      "kafka.consumer_group.lag_sum",
    );
    expect(
      await fetchMessageQueueObservedSeries({ ...window([]), descriptor }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();

    aggregateMock.mockRejectedValue(new Error("boom"));
    expect(
      await fetchMessageQueueObservedSeries({ ...window(), descriptor }),
    ).toEqual([]);
  });
});

describe("every catalog metric of a system", () => {
  test("charted in catalog order; observed series read only for gauges with data", async () => {
    aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
      const by: Record<string, unknown> & { query: Record<string, unknown> } = (
        request as AggregateRequest
      ).aggregateBy;
      const name: string = String(by.query["name"]);
      if (by["aggregationInterval"] === AggregationInterval.Total) {
        return Promise.resolve({
          data: [
            {
              timestamp: at(0),
              value: 1,
              attributes: { "resource.rabbitmq.queue.name": "orders" },
            },
          ],
        });
      }
      if (name === "rabbitmq.message.current") {
        return Promise.resolve({
          data: [
            { timestamp: at(0), value: 7, attributes: { state: "ready" } },
            {
              timestamp: at(0),
              value: 2,
              attributes: { state: "unacknowledged" },
            },
          ],
        });
      }
      if (name === "rabbitmq.message.published") {
        return Promise.resolve({
          data: [
            { timestamp: at(0), value: 100, attributes: { q: "orders" } },
            { timestamp: at(1), value: 160, attributes: { q: "orders" } },
          ],
        });
      }
      return Promise.resolve({ data: [] });
    });

    const results: Array<MessageQueueBrokerMetricResult> =
      await fetchMessageQueueBrokerMetrics({
        ...window(),
        metrics: getMessageQueueMetricsForSystem("rabbitmq"),
      });

    expect(
      results.map((result: MessageQueueBrokerMetricResult): string => {
        return result.descriptor.metricName;
      }),
    ).toEqual(
      getMessageQueueMetricsForSystem("rabbitmq").map(
        (descriptor: MessageQueueMetricDescriptor): string => {
          return descriptor.metricName;
        },
      ),
    );
    const depth: MessageQueueBrokerMetricResult = results[0]!;
    expect(depth.value).toBe(9);
    expect(depth.observedSeries).toEqual([
      { "resource.rabbitmq.queue.name": "orders" },
    ]);
    const published: MessageQueueBrokerMetricResult = results[1]!;
    expect(published.value).toBeCloseTo(1, 10);
    // A counter never gets its series read for a monitor.
    expect(published.observedSeries).toEqual([]);
    // A quiet gauge neither.
    const consumers: MessageQueueBrokerMetricResult = results.find(
      (result: MessageQueueBrokerMetricResult): boolean => {
        return result.descriptor.metricName === "rabbitmq.consumer.count";
      },
    )!;
    expect(consumers.series).toEqual([]);
    expect(consumers.observedSeries).toEqual([]);

    const observedRequests: Array<Array<unknown>> =
      aggregateMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          (call[0] as AggregateRequest).aggregateBy["aggregationInterval"] ===
          AggregationInterval.Total
        );
      });
    expect(observedRequests).toHaveLength(1);
    expect(hasMessageQueueBrokerMetricData(results)).toBe(true);
  });

  test("no key: no request at all", async () => {
    expect(
      await fetchMessageQueueBrokerMetrics({
        ...window([]),
        metrics: getMessageQueueMetricsForSystem("kafka"),
      }),
    ).toEqual([]);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("a gauge's value is its newest point, a counter's its mean rate", () => {
    const lag: MessageQueueBrokerMetricResult =
      toMessageQueueBrokerMetricResult(
        descriptorOf("kafka", "kafka.consumer_group.lag_sum"),
        [
          { x: at(2), y: 5 },
          { x: at(0), y: 9 },
          { x: at(1), y: 7 },
        ],
      );
    expect(lag.value).toBe(5);
    expect(
      lag.series.map((point: MessageQueueTimePoint): number => {
        return point.y;
      }),
    ).toEqual([9, 7, 5]);

    const produced: MessageQueueBrokerMetricResult =
      toMessageQueueBrokerMetricResult(
        descriptorOf("kafka", "kafka.partition.current_offset"),
        points([1, 2, 3]),
      );
    expect(produced.value).toBe(2);
    expect(
      toMessageQueueBrokerMetricResult(
        descriptorOf("kafka", "kafka.partition.current_offset"),
        [],
      ).value,
    ).toBeNull();
    expect(hasMessageQueueBrokerMetricData([produced])).toBe(true);
    expect(
      hasMessageQueueBrokerMetricData([
        toMessageQueueBrokerMetricResult(
          descriptorOf("kafka", "kafka.partition.current_offset"),
          [],
        ),
      ]),
    ).toBe(false);
  });
});

// ---- the section ---------------------------------------------------------

function renderSection(props: {
  messagingSystem: string | null;
  identifier?: string | undefined;
  results: Array<MessageQueueBrokerMetricResult>;
  isLoading?: boolean | undefined;
  brokerMetricsLastSeenAt?: Date | null | undefined;
}): void {
  render(
    <MemoryRouter>
      <MessageQueueBrokerHealthSection
        modelId={MODEL_ID}
        messagingSystem={props.messagingSystem}
        identity={parseMessageQueueIdentifier(
          props.identifier || `${props.messagingSystem || "x"}||orders`,
        )}
        queueName="orders"
        brokerMetricsLastSeenAt={props.brokerMetricsLastSeenAt}
        results={props.results}
        isLoading={Boolean(props.isLoading)}
        windowStart={START}
        windowEnd={END}
      />
    </MemoryRouter>,
  );
}

function emptyResults(system: string): Array<MessageQueueBrokerMetricResult> {
  return getMessageQueueMetricsForSystem(system).map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): MessageQueueBrokerMetricResult => {
      return toMessageQueueBrokerMetricResult(descriptor, []);
    },
  );
}

// Backticks render as code, so the text reads without them.
function withoutBackticks(text: string): string {
  return text.replace(/`/g, "");
}

const SYSTEM_CASES: Array<[string, MessagingSystemDescriptor]> =
  MESSAGING_SYSTEMS.map(
    (
      descriptor: MessagingSystemDescriptor,
    ): [string, MessagingSystemDescriptor] => {
      return [descriptor.system, descriptor];
    },
  );

describe("Broker health with nothing to chart: where the metrics come from", () => {
  const docs: string = fs.readFileSync(QUEUES_DOC, "utf8");
  const slugs: Set<string> = headingSlugs(docs);

  test("the guide's anchors the section links to are real headings", () => {
    expect(slugs.has(MESSAGE_QUEUE_BROKER_METRICS_DOCS_ANCHOR)).toBe(true);
    expect(slugs.has(MESSAGE_QUEUE_BROKER_HEALTH_EMPTY_DOCS_ANCHOR)).toBe(true);
  });

  test.each(SYSTEM_CASES)(
    "%s: its source, in the catalog's words, and its own section of the guide",
    (system: string, descriptor: MessagingSystemDescriptor) => {
      // A Service Bus / Event Hubs queue as discovery keys it: namespaced.
      renderSection({
        messagingSystem: system,
        identifier:
          descriptor.brokerScope === "azure-namespace"
            ? `${system}|orders-prod|orders`
            : undefined,
        results: emptyResults(system),
      });

      const guidance: HTMLElement = screen.getByTestId(
        "message-queue-broker-health-guidance",
      );
      expect(guidance).toHaveAttribute(
        "data-source-kind",
        descriptor.brokerMetrics.kind,
      );
      const source: MessageQueueBrokerMetricsGuidance =
        getMessageQueueBrokerMetricsGuidance(system);
      expect(
        screen.getByTestId("message-queue-broker-health-guidance-text"),
      ).toHaveTextContent(withoutBackticks(source.description));
      const catalogWords: string =
        descriptor.brokerMetrics.kind === "none"
          ? descriptor.brokerMetrics.reason
          : descriptor.brokerMetrics.note;
      expect(guidance.textContent || "").toContain(
        withoutBackticks(catalogWords),
      );

      // The system's own heading of the Queues guide, which exists.
      const link: HTMLElement = within(guidance)
        .getByText(
          `${descriptor.displayName} broker metrics in the Queues guide →`,
        )
        .closest("a")!;
      expect(link).toHaveAttribute(
        "href",
        `/docs/telemetry/queues#${descriptor.docsAnchor}`,
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(slugs.has(descriptor.docsAnchor)).toBe(true);

      /*
       * Only metrics that can name the queue have a setup that fills this
       * section in (the queue's Documentation tab); a source whose metrics
       * never name a queue (NATS, Event Grid) points at the Metrics
       * explorer, and a system with no source at all links nothing more.
       */
      const hasCuratedMetrics: boolean =
        getMessageQueueMetricsForSystem(system).length > 0;
      expect(
        within(guidance).queryByText(BROKER_HEALTH_SETUP_LINK_LABEL) !== null,
      ).toBe(hasCuratedMetrics);
      expect(
        within(guidance).queryByText(
          BROKER_HEALTH_METRICS_EXPLORER_LINK_LABEL,
        ) !== null,
      ).toBe(!hasCuratedMetrics && descriptor.brokerMetrics.kind !== "none");
      expect(source.reachesQueue).toBe(hasCuratedMetrics);

      expect(screen.queryByTestId("message-queue-broker-health")).toBeNull();
      expect(chartCardMock).not.toHaveBeenCalled();
    },
  );

  test("NATS and Event Grid: metrics a collector reads, but that name no queue, are not set up here", () => {
    for (const system of ["nats", "eventgrid"]) {
      cleanup();
      renderSection({ messagingSystem: system, results: [] });

      const guidance: HTMLElement = screen.getByTestId(
        "message-queue-broker-health-guidance",
      );
      expect(guidance).not.toHaveTextContent(/has arrived/);
      expect(
        within(guidance).queryByText(BROKER_HEALTH_SETUP_LINK_LABEL),
      ).toBeNull();
      expect(
        within(guidance)
          .getByText(BROKER_HEALTH_METRICS_EXPLORER_LINK_LABEL)
          .closest("a"),
      ).toHaveAttribute("href", `/dashboard/${PROJECT_ID}/metrics`);
    }
  });

  test.each([["servicebus"], ["eventhubs"]])(
    "a %s queue without a namespace: its broker metrics go to the namespaced queue, and none is offered here",
    (system: string) => {
      renderSection({
        messagingSystem: system,
        identifier: `${system}||orders`,
        results: emptyResults(system),
      });

      const guidance: HTMLElement = screen.getByTestId(
        "message-queue-broker-health-guidance",
      );
      const text: string = withoutBackticks(
        getMessageQueueBrokerMetricsGuidance(system, { brokerScope: "" })
          .description,
      );
      expect(
        screen.getByTestId("message-queue-broker-health-guidance-text"),
      ).toHaveTextContent(text);
      expect(text).toContain(
        "attach to the same destination's queue in their namespace, not to this one",
      );
      expect(text).not.toMatch(/has arrived/);
      expect(
        within(guidance).queryByText(BROKER_HEALTH_SETUP_LINK_LABEL),
      ).toBeNull();
      expect(
        within(guidance).getByText(BROKER_HEALTH_METRICS_EXPLORER_LINK_LABEL),
      ).toBeInTheDocument();

      // With its namespace, the same system's queue is set up as usual.
      cleanup();
      renderSection({
        messagingSystem: system,
        identifier: `${system}|orders-prod|orders`,
        results: emptyResults(system),
      });
      expect(
        screen.getByText(BROKER_HEALTH_SETUP_LINK_LABEL).closest("a"),
      ).toHaveAttribute(
        "href",
        `/dashboard/${PROJECT_ID}/queues/${MODEL_ID.toString()}/documentation`,
      );
    },
  );

  /*
   * Whether a queue is offered a setup at all is
   * canBrokerMetricsReachMessageQueue's call, the one rule the Documentation
   * tab's guide follows too: MessageQueueBrokerMetricsReach.test pins that
   * both follow it, and MessageQueuePresentation.test the rule itself for
   * every catalog system.
   */

  test("a system with curated metrics says none has arrived; one without only says why", () => {
    expect(getMessageQueueBrokerMetricsGuidance("kafka").description).toMatch(
      /^No Apache Kafka broker metric has arrived for this queue yet\. /,
    );
    // Event Grid and NATS have sources but nothing charted on a queue.
    for (const system of ["eventgrid", "nats", "jms", "bullmq"]) {
      expect(getMessageQueueMetricsForSystem(system)).toHaveLength(0);
      expect(
        getMessageQueueBrokerMetricsGuidance(system).description,
      ).not.toMatch(/has arrived/);
    }
  });

  test("a Prometheus source names its port and path", () => {
    const guidance: MessageQueueBrokerMetricsGuidance =
      getMessageQueueBrokerMetricsGuidance("pulsar");
    expect(guidance.sourceKind).toBe("prometheus");
    expect(guidance.description).toContain(
      "serves Prometheus metrics on port 8080 at `/metrics/`",
    );
    expect(guidance.sourceLabel).toBe(
      "Prometheus scrape: Pulsar broker, port 8080, path /metrics/",
    );
  });

  test("a cloud source names its receiver and the alternatives", () => {
    expect(getMessageQueueBrokerMetricsGuidance("aws_sqs").sourceLabel).toBe(
      "Cloud monitoring: the aws_cloudwatch receiver (or awsfirehose)",
    );
    expect(getMessageQueueBrokerMetricsGuidance("servicebus").sourceLabel).toBe(
      "Cloud monitoring: the azure_monitor receiver",
    );
  });

  test("a system OneUptime does not know links the overview of broker metrics", () => {
    renderSection({ messagingSystem: "ibmmq", results: [] });

    const guidance: HTMLElement = screen.getByTestId(
      "message-queue-broker-health-guidance",
    );
    expect(guidance).toHaveAttribute("data-source-kind", "none");
    expect(guidance).toHaveTextContent(
      "OneUptime does not know this messaging system",
    );
    expect(
      within(guidance)
        .getByText("Broker health metrics in the Queues guide →")
        .closest("a"),
    ).toHaveAttribute("href", "/docs/telemetry/queues#broker-health-metrics");
    expect(getMessageQueueSystemDocsRoute(null).toString()).toBe(
      "/docs/telemetry/queues#broker-health-metrics",
    );
  });

  test("an alias reaches its system's guidance", () => {
    expect(getMessageQueueSystemDocsRoute("AmazonSQS").toString()).toBe(
      "/docs/telemetry/queues#amazon-sqs",
    );
    expect(
      getMessageQueueBrokerMetricsGuidance("azure_servicebus").sourceKind,
    ).toBe("cloud-monitoring");
  });

  test("metrics that arrived before, none in this range: when, and where to look", () => {
    const lastSeen: Date = new Date("2026-09-23T08:00:00.000Z");
    renderSection({
      messagingSystem: "kafka",
      results: emptyResults("kafka"),
      brokerMetricsLastSeenAt: lastSeen,
    });

    expect(screen.getByText(BROKER_HEALTH_NO_DATA_TITLE)).toBeInTheDocument();
    const noData: HTMLElement = screen.getByTestId(
      "message-queue-broker-health-no-data",
    );
    expect(
      within(noData).getByText("All metrics →").closest("a"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/queues/${MODEL_ID.toString()}/metrics`,
    );
    expect(
      within(noData).getByText("Broker health stays empty →").closest("a"),
    ).toHaveAttribute(
      "href",
      "/docs/telemetry/queues#broker-health-stays-empty",
    );
    expect(
      getMessageQueueBrokerMetricsNoDataDescription({
        system: "kafka",
        lastReceivedAt: lastSeen,
      }),
    ).toMatch(
      /^No Apache Kafka broker metric arrived for this queue in the selected range\. The last one arrived .+\. Widen the range, or check that the collector still sends them\.$/,
    );
  });

  test("a system with no curated metrics shows its guidance even after a sighting", () => {
    renderSection({
      messagingSystem: "jms",
      results: [],
      brokerMetricsLastSeenAt: new Date(),
    });

    expect(
      screen.getByTestId("message-queue-broker-health-guidance"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("message-queue-broker-health-no-data"),
    ).toBeNull();
  });

  test("the first load shows a loader, not the guidance", () => {
    renderSection({
      messagingSystem: "kafka",
      results: [],
      isLoading: true,
    });

    expect(
      screen.getByTestId("message-queue-broker-health-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("message-queue-broker-health-guidance"),
    ).toBeNull();
  });
});

describe("Broker health with data", () => {
  function rabbitResults(): Array<MessageQueueBrokerMetricResult> {
    return getMessageQueueMetricsForSystem("rabbitmq").map(
      (
        descriptor: MessageQueueMetricDescriptor,
      ): MessageQueueBrokerMetricResult => {
        switch (descriptor.metricName) {
          case "rabbitmq.message.current":
            return toMessageQueueBrokerMetricResult(
              descriptor,
              points([1200, 1500]),
              [{ "resource.rabbitmq.queue.name": "orders" }],
            );
          case "rabbitmq.message.published":
            return toMessageQueueBrokerMetricResult(
              descriptor,
              points([2.5, 3.5]),
            );
          case "rabbitmq.consumer.count":
            // Observed, but only another queue's series.
            return toMessageQueueBrokerMetricResult(
              descriptor,
              points([0, 0]),
              [{ "resource.rabbitmq.queue.name": "payments" }],
            );
          default:
            return toMessageQueueBrokerMetricResult(descriptor, []);
        }
      },
    );
  }

  test("a tile and a chart for each metric with data, and nothing for the rest", () => {
    renderSection({ messagingSystem: "rabbitmq", results: rabbitResults() });

    expect(screen.getByText(BROKER_HEALTH_TITLE)).toBeInTheDocument();
    const tiles: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-broker-metric-tile",
    );
    expect(
      tiles.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-metric-id");
      }),
    ).toEqual([
      "rabbitmq:rabbitmq.message.current",
      "rabbitmq:rabbitmq.message.published",
      "rabbitmq:rabbitmq.consumer.count",
    ]);
    expect(within(tiles[0]!).getByText("1.5k messages")).toBeInTheDocument();
    expect(within(tiles[0]!).getByText("newest value")).toBeInTheDocument();
    expect(within(tiles[1]!).getByText("3 messages/s")).toBeInTheDocument();
    expect(
      within(tiles[1]!).getByText("per second, average over the range"),
    ).toBeInTheDocument();
    expect(within(tiles[2]!).getByText("0 consumers")).toBeInTheDocument();

    const titles: Array<string> = chartCardMock.mock.calls.map(
      (call: Array<unknown>): string => {
        return (call[0] as { title: string }).title;
      },
    );
    expect(titles).toEqual([
      "Queue depth (messages)",
      "Published (per second)",
      "Consumers",
    ]);
  });

  test("the charts share the page's zoom and hover, whole ticks for a count, 0 to 1 when flat at 0", () => {
    renderSection({ messagingSystem: "rabbitmq", results: rabbitResults() });

    const props: Array<Record<string, unknown>> = chartCardMock.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return call[0] as Record<string, unknown>;
      },
    );
    for (const chart of props) {
      expect(chart["syncId"]).toBe(`message-queue-${MODEL_ID.toString()}`);
      expect(chart["windowStart"]).toBe(START);
      expect(chart["windowEnd"]).toBe(END);
    }
    // A count of messages: whole ticks.
    expect(props[0]!["yAllowDecimals"]).toBe(false);
    // A rate is fractional.
    expect(props[1]!["yAllowDecimals"]).toBe(true);
    // Zero consumers throughout: the axis is 0 to 1, not 0 to 4.
    expect(props[2]!["yMax"]).toBe(1);
    const format: (value: number) => string = props[0]!["yFormatter"] as (
      value: number,
    ) => string;
    expect(format(1500)).toBe("1.5k");
  });

  test("Create monitor on the gauge whose series name this queue; none on a counter", () => {
    renderSection({ messagingSystem: "rabbitmq", results: rabbitResults() });

    const links: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-create-monitor",
    );
    expect(
      links.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-metric-id");
      }),
    ).toEqual(["rabbitmq:rabbitmq.message.current"]);
    const href: string = within(links[0]!)
      .getByText("Create monitor")
      .closest("a")!
      .getAttribute("href")!;
    expect(href).toContain(`/dashboard/${PROJECT_ID}/monitors/create?`);
    expect(decodeURIComponent(href)).toContain(
      '"formula":"a_ready + a_unacknowledged"',
    );

    // The consumer count was observed only for another queue: no link.
    const unavailable: Array<HTMLElement> = screen.getAllByTestId(
      "message-queue-create-monitor-unavailable",
    );
    expect(
      unavailable.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-metric-id");
      }),
    ).toEqual(["rabbitmq:rabbitmq.consumer.count"]);

    // The counter's chart: neither.
    const published: HTMLElement = screen
      .getAllByTestId("message-queue-broker-metric-chart")
      .find((element: HTMLElement): boolean => {
        return (
          element.getAttribute("data-metric-id") ===
          "rabbitmq:rabbitmq.message.published"
        );
      })!;
    expect(within(published).queryByText("Create monitor")).toBeNull();
  });

  test("the links map: gauges with a series of the queue, by metric id", () => {
    const links: Map<string, MessageQueueMetricMonitorLink> =
      getMessageQueueBrokerMonitorLinks({
        results: rabbitResults(),
        identity: parseMessageQueueIdentifier("rabbitmq||orders"),
        queueName: "orders",
      });
    expect(Array.from(links.keys())).toEqual([
      "rabbitmq:rabbitmq.message.current",
    ]);
    expect(links.get("rabbitmq:rabbitmq.message.current")!.threshold).toBe(
      1000,
    );

    // Without an identity no series is this queue's.
    expect(
      getMessageQueueBrokerMonitorLinks({
        results: rabbitResults(),
        identity: null,
        queueName: "orders",
      }).size,
    ).toBe(0);
  });

  /*
   * The Documentation tab's guide promises Create monitor on "each gauge and
   * each count per period" of the table it prints (a cloud metric's count
   * is a gauge summed per interval). Held to what the section links: every
   * catalog metric, charted with the series of its realistic stored
   * datapoint, gets a link exactly when its row is typed Gauge or Count per
   * period — never a counter's, which charts a rate.
   */
  test("links each gauge and each count per period, as the guide promises, and no counter", () => {
    const linkedByType: Map<string, Array<boolean>> = new Map();

    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
        (candidate: MetricFixture): boolean => {
          return (
            candidate.metricName === descriptor.metricName &&
            candidate.expected?.system === descriptor.system
          );
        },
      );
      expect(fixture).toBeDefined();
      const attributes: FixtureAttributes = fixture!.attributes;
      const resolved: ResolvedMessagingDestination | null =
        resolveMessagingMetricDatapoint({
          metricName: descriptor.metricName,
          getAttribute: (key: string): unknown => {
            return Object.prototype.hasOwnProperty.call(attributes, key)
              ? attributes[key]
              : undefined;
          },
        });
      const identity: MessageQueueIdentity | null = resolved
        ? toMessageQueueIdentity({
            system: resolved.system,
            brokerScope: resolved.brokerScope,
            destination: resolved.destination,
          })
        : null;
      expect(identity).not.toBeNull();

      const id: string = getMessageQueueMetricId(descriptor);
      const linked: boolean = getMessageQueueBrokerMonitorLinks({
        results: [
          toMessageQueueBrokerMetricResult(descriptor, points([3, 4]), [
            toStoredColumns(
              attributes,
              getMessageQueueMetricFilterAttributeKeys(descriptor),
            ),
          ]),
        ],
        identity: identity,
        queueName: "orders",
      }).has(id);

      const row: MessageQueueChartedMetricRow | undefined =
        getMessageQueueChartedMetricRows(descriptor.system).find(
          (candidate: MessageQueueChartedMetricRow): boolean => {
            return candidate.metric.includes(`\`${descriptor.metricName}\``);
          },
        );
      expect(row).toBeDefined();
      expect({ id, type: row!.type, linked }).toEqual({
        id,
        type: row!.type,
        linked: row!.type === "Gauge" || row!.type === "Count per period",
      });
      linkedByType.set(row!.type, [
        ...(linkedByType.get(row!.type) || []),
        linked,
      ]);
    }

    // Rows of all three types, so none of the above holds vacuously.
    expect(Array.from(linkedByType.keys()).sort()).toEqual([
      "Count per period",
      "Counter, charted per second",
      "Gauge",
    ]);

    // And the guide says so wherever it prints the table.
    for (const descriptor of MESSAGING_SYSTEMS) {
      if (getMessageQueueChartedMetricRows(descriptor.system).length === 0) {
        continue;
      }
      expect(
        getMessageQueueSystemGuideMarkdown(
          { oneuptimeUrl: "https://oneuptime.example.com", apiKey: "key" },
          descriptor.system,
        ),
      ).toContain(
        "under **Broker health**, and each gauge and each count per period has **Create monitor**.",
      );
    }
  });

  test("while a reload runs the charts stay, and no loader replaces them", () => {
    renderSection({
      messagingSystem: "rabbitmq",
      results: rabbitResults(),
      isLoading: true,
    });

    expect(
      screen.getByTestId("message-queue-broker-health"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("message-queue-broker-health-loading"),
    ).toBeNull();
  });

  test("an ActiveMQ gauge shows what its monitor measures instead of the chart's total", () => {
    const size: MessageQueueMetricDescriptor = descriptorOf(
      "activemq",
      "activemq.message.queue.size",
    );
    renderSection({
      messagingSystem: "activemq",
      identifier: "jms||orders",
      results: [
        toMessageQueueBrokerMetricResult(size, points([3, 4]), [
          { "messaging.destination.name": "orders" },
        ]),
      ],
    });

    expect(
      screen.getByTestId("message-queue-create-monitor-note"),
    ).toHaveTextContent("Set a threshold for one series, not for the total.");
    // The criteria Monitor Create builds: above, on any point.
    expect(
      screen.getByTestId("message-queue-create-monitor-hint"),
    ).toHaveTextContent(
      "Warning when any point in the last 10 minutes is above 1,000 messages",
    );
  });

  test("RabbitMQ's queue depth: the Warning criteria Monitor Create builds on the formula adding the states up is promised", () => {
    renderSection({ messagingSystem: "rabbitmq", results: rabbitResults() });

    const chart: HTMLElement = screen
      .getAllByTestId("message-queue-broker-metric-chart")
      .find((element: HTMLElement): boolean => {
        return (
          element.getAttribute("data-metric-id") ===
          "rabbitmq:rabbitmq.message.current"
        );
      })!;
    expect(
      within(chart).getByTestId("message-queue-create-monitor-hint"),
    ).toHaveTextContent(
      "Warning when any point in the last 10 minutes is above 1,000 messages",
    );
  });
});

describe("how a broker metric reads", () => {
  test.each(
    MESSAGE_QUEUE_METRICS.map(
      (
        descriptor: MessageQueueMetricDescriptor,
      ): [string, MessageQueueMetricDescriptor] => {
        return [`${descriptor.system}:${descriptor.metricName}`, descriptor];
      },
    ),
  )(
    "%s: a counter is titled per second, a gauge never, and one qualifier at most",
    (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const title: string = getMessageQueueBrokerMetricChartTitle(descriptor);
      // The catalog title, its closing qualifier (if any) left open for the unit.
      expect(title.startsWith(descriptor.title.replace(/\)$/, ""))).toBe(true);
      expect(title.endsWith("per second)")).toBe(descriptor.kind === "counter");
      // Never "Queue size (legacy names) (messages)".
      expect(title).not.toMatch(/\)\s*\(/);
      expect(title.match(/\(/g)?.length || 0).toBeLessThanOrEqual(1);
      expect(getMessageQueueBrokerMetricCaption(descriptor)).toBe(
        descriptor.kind === "counter"
          ? "per second, average over the range"
          : descriptor.aggregation === AggregationType.Sum
            ? "newest whole interval"
            : "newest value",
      );
    },
  );

  test("a title that ends in a qualifier takes the unit inside it", () => {
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf("activemq", "activemq.message.current"),
      ),
    ).toBe("Queue size (legacy names, messages)");
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf("aws.sns", "numberofnotificationsdelivered"),
      ),
    ).toBe("Notifications delivered (JSON stream, messages)");
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf("aws.sns", "numberofnotificationsredriventodlq"),
      ),
    ).toBe("Redriven to dead-letter queue (JSON stream, messages)");
    // A qualifier that already names the unit's word is left as it is.
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf("aws_sqs", "approximatenumberofmessagesvisible"),
      ),
    ).toBe("Messages visible (JSON stream)");
    // A counter's rate joins a qualifier the same way.
    expect(
      getMessageQueueBrokerMetricChartTitle({
        title: "Messages in (JSON stream)",
        unit: "messages",
        kind: "counter",
      }),
    ).toBe("Messages in (JSON stream, per second)");
  });

  test("a gauge's title carries its unit word once", () => {
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf("kafka", "kafka.consumer_group.lag_sum"),
      ),
    ).toBe("Consumer lag (messages)");
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf("servicebus", "azure_activemessages_average"),
      ),
    ).toBe("Active messages");
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf("servicebus", "azure_servererrors_total"),
      ),
    ).toBe("Server errors (requests)");
    // Seconds read on the axis.
    expect(
      getMessageQueueBrokerMetricChartTitle(
        descriptorOf(
          "aws_sqs",
          "amazonaws.com/aws/sqs/approximateageofoldestmessage",
        ),
      ),
    ).toBe("Oldest message age");
  });

  test("backticks in catalog words render as code", () => {
    render(
      <p data-testid="text">
        {renderMessageQueueInlineCode(
          "Enable the `kafka_metrics` receiver's `topics` scraper.",
        )}
      </p>,
    );

    const text: HTMLElement = screen.getByTestId("text");
    expect(text).toHaveTextContent(
      "Enable the kafka_metrics receiver's topics scraper.",
    );
    expect(
      Array.from(text.querySelectorAll("code")).map(
        (element: Element): string | null => {
          return element.textContent;
        },
      ),
    ).toEqual(["kafka_metrics", "topics"]);
  });
});

describe("the Metrics tab's rows of curated metrics", () => {
  test("read as Broker health reads them, for the curated names only", async () => {
    aggregateMock.mockImplementation((request: unknown): Promise<unknown> => {
      const name: string = String(
        (request as AggregateRequest).aggregateBy.query["name"],
      );
      if (name === "kafka.consumer_group.lag_sum") {
        // Pooled on the server: the Max of groups a (4) and b (9).
        return Promise.resolve({
          data: [{ timestamp: at(0), value: 9 }],
        });
      }
      return Promise.resolve({
        data: [
          { timestamp: at(0), value: 100, attributes: { group: "a" } },
          { timestamp: at(1), value: 160, attributes: { group: "a" } },
        ],
      });
    });

    const values: Map<string, MessageQueueMetricListValue> =
      await fetchMessageQueueMetricListValues({
        ...window(),
        messagingSystem: "kafka",
        metricNames: [
          "kafka.consumer_group.lag_sum",
          "kafka.consumer_group.offset_sum",
          "messaging.client.consumed.messages",
          "rabbitmq.message.current",
        ],
      });

    expect(Array.from(values.keys())).toEqual([
      "kafka.consumer_group.lag_sum",
      "kafka.consumer_group.offset_sum",
    ]);
    expect(values.get("kafka.consumer_group.lag_sum")).toEqual(
      expect.objectContaining({ value: 9, isRate: false }),
    );
    expect(values.get("kafka.consumer_group.offset_sum")!.isRate).toBe(true);
    expect(values.get("kafka.consumer_group.offset_sum")!.value).toBeCloseTo(
      1,
      10,
    );
    // The client metric and the other system's metric are never read.
    expect(aggregateMock).toHaveBeenCalledTimes(2);
  });

  test("no key: no request, no values", async () => {
    expect(
      (
        await fetchMessageQueueMetricListValues({
          ...window([]),
          messagingSystem: "kafka",
          metricNames: ["kafka.consumer_group.lag_sum"],
        })
      ).size,
    ).toBe(0);
    expect(aggregateMock).not.toHaveBeenCalled();
  });

  test("each row's caption says how its series combine", () => {
    expect(
      getMessageQueueMetricListCaption(
        descriptorOf("rabbitmq", "rabbitmq.message.current"),
      ),
    ).toBe("total of series");
    expect(
      getMessageQueueMetricListCaption(
        descriptorOf("kafka", "kafka.consumer_group.lag_sum"),
      ),
    ).toBe("highest series");
    expect(
      getMessageQueueMetricListCaption(
        descriptorOf("kafka", "kafka.partition.current_offset"),
      ),
    ).toBe("per second, all series");
    expect(
      getMessageQueueMetricListCaption({ kind: "gauge", seriesCombine: "avg" }),
    ).toBe("average of series");
  });
});
