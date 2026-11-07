import { describe, expect, jest, test } from "@jest/globals";

/*
 * The broker's numbers on the Queues topology: which metric says how much
 * is waiting on a queue and how much was dead-lettered, system by system,
 * read exactly as the queue's Broker health section reads it - and only
 * where it can answer.
 */

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return { __esModule: true, default: {} };
});

import {
  EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE,
  MESSAGE_QUEUE_HEADLINE_REPORT_SLACK_MS,
  MessageQueueBrokerHeadline,
  MessageQueueHeadlineDescriptors,
  MessageQueueHeadlineQueue,
  MessageQueueSeriesReader,
  fetchMessageQueueBrokerHeadline,
  getMessageQueueHeadlineDescriptors,
  getMessageQueueHeadlineShortLabel,
  isMessageQueueHeadlineReadable,
  runWithConcurrency,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueBrokerHeadlines";
import { MessageQueueTimePoint } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryQueries";
import { getMessageQueueScopeKeys } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueTelemetryScope";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import { MESSAGING_SYSTEMS } from "../../../Types/MessageQueue/MessagingSystem";

const PROJECT_ID: string = "5f2b7c1e-8d3a-4b6f-9c0d-1e2f3a4b5c6d";
const START: Date = new Date("2026-11-07T11:00:00.000Z");
const END: Date = new Date("2026-11-07T12:00:00.000Z");

function names(list: Array<MessageQueueMetricDescriptor>): Array<string> {
  return list.map((descriptor: MessageQueueMetricDescriptor): string => {
    return descriptor.metricName;
  });
}

function queue(
  extra?: Partial<MessageQueueHeadlineQueue>,
): MessageQueueHeadlineQueue {
  return {
    id: "q1",
    queueIdentifier: "kafka||orders",
    messagingSystem: "kafka",
    brokerScope: "",
    brokerMetricsLastSeenAt: "2026-11-07T11:50:00.000Z",
    ...extra,
  };
}

describe("which metric a system shows", () => {
  test.each([
    ["kafka", ["kafka.consumer_group.lag_sum"], []],
    ["rabbitmq", ["rabbitmq.message.current"], []],
    [
      "activemq",
      ["activemq.message.queue.size", "activemq.message.current"],
      [],
    ],
    [
      "servicebus",
      ["azure_activemessages_average"],
      ["azure_deadletteredmessages_average"],
    ],
    [
      "aws_sqs",
      [
        "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        "approximatenumberofmessagesvisible",
      ],
      [],
    ],
    [
      "aws.sns",
      [],
      [
        "amazonaws.com/aws/sns/numberofnotificationsredriventodlq",
        "numberofnotificationsredriventodlq",
      ],
    ],
    [
      "gcp_pubsub",
      ["pubsub.googleapis.com/subscription/num_undelivered_messages"],
      ["pubsub.googleapis.com/subscription/dead_letter_message_count"],
    ],
    ["pulsar", ["pulsar_subscription_back_log"], []],
    [
      "rocketmq",
      ["rocketmq_consumer_lag_messages"],
      ["rocketmq_send_to_dlq_messages_total"],
    ],
    ["eventhubs", [], []],
    ["nats", [], []],
    ["mqtt", [], []],
  ])(
    "%s: waiting %j, dead letters %j",
    (system: string, waiting: Array<string>, deadLetter: Array<string>) => {
      const descriptors: MessageQueueHeadlineDescriptors =
        getMessageQueueHeadlineDescriptors(system);
      expect(names(descriptors.waiting)).toEqual(waiting);
      expect(names(descriptors.deadLetter)).toEqual(deadLetter);
    },
  );

  test("every system the catalog curates is pinned above, so a new one is chosen on purpose", () => {
    const curated: Set<string> = new Set<string>(
      MESSAGE_QUEUE_METRICS.map((descriptor: MessageQueueMetricDescriptor) => {
        return descriptor.system;
      }),
    );
    expect(Array.from(curated).sort()).toEqual(
      [
        "activemq",
        "aws.sns",
        "aws_sqs",
        "eventhubs",
        "gcp_pubsub",
        "kafka",
        "pulsar",
        "rabbitmq",
        "rocketmq",
        "servicebus",
      ].sort(),
    );
  });

  test("lag wins over backlog, and the other spellings of one metric come with it, never another metric", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const picked: MessageQueueHeadlineDescriptors =
        getMessageQueueHeadlineDescriptors(descriptor.system);
      const signals: Set<string> = new Set<string>(
        picked.waiting.map((entry: MessageQueueMetricDescriptor) => {
          return entry.signal;
        }),
      );
      expect(signals.size).toBeLessThanOrEqual(1);
      const hasLag: boolean = MESSAGE_QUEUE_METRICS.some(
        (entry: MessageQueueMetricDescriptor): boolean => {
          return (
            entry.system === descriptor.system && entry.signal === "consumerLag"
          );
        },
      );
      if (hasLag) {
        expect(Array.from(signals)).toEqual(["consumerLag"]);
      }
      for (const entry of picked.deadLetter) {
        expect(entry.signal).toBe("deadLetter");
      }
    }
  });

  test("a card calls each by its signal", () => {
    expect(getMessageQueueHeadlineShortLabel({ signal: "consumerLag" })).toBe(
      "lag",
    );
    expect(getMessageQueueHeadlineShortLabel({ signal: "backlog" })).toBe(
      "backlog",
    );
    expect(getMessageQueueHeadlineShortLabel({ signal: "deadLetter" })).toBe(
      "dead letters",
    );
  });
});

describe("where a read can answer", () => {
  test("a queue whose broker reported in or just before the range", () => {
    expect(isMessageQueueHeadlineReadable(queue(), START)).toBe(true);
    expect(
      isMessageQueueHeadlineReadable(
        queue({
          brokerMetricsLastSeenAt: new Date(
            START.getTime() - MESSAGE_QUEUE_HEADLINE_REPORT_SLACK_MS,
          ).toISOString(),
        }),
        START,
      ),
    ).toBe(true);
  });

  test("not a queue whose broker never reported, or reported long before the range", () => {
    expect(
      isMessageQueueHeadlineReadable(
        queue({ brokerMetricsLastSeenAt: null }),
        START,
      ),
    ).toBe(false);
    expect(
      isMessageQueueHeadlineReadable(
        queue({
          brokerMetricsLastSeenAt: new Date(
            START.getTime() - MESSAGE_QUEUE_HEADLINE_REPORT_SLACK_MS - 1,
          ).toISOString(),
        }),
        START,
      ),
    ).toBe(false);
    expect(
      isMessageQueueHeadlineReadable(
        queue({ brokerMetricsLastSeenAt: "not a date" }),
        START,
      ),
    ).toBe(false);
  });

  test("not a queue whose system has no such metric", () => {
    expect(
      isMessageQueueHeadlineReadable(
        queue({
          messagingSystem: "eventhubs",
          queueIdentifier: "eventhubs|ns|orders",
          brokerScope: "ns",
        }),
        START,
      ),
    ).toBe(false);
    expect(
      isMessageQueueHeadlineReadable(queue({ messagingSystem: "nats" }), START),
    ).toBe(false);
  });

  test("not an Azure queue without its namespace: Azure Monitor's metrics never reach it", () => {
    const serviceBus: MessageQueueHeadlineQueue = queue({
      messagingSystem: "servicebus",
      queueIdentifier: "servicebus|orders-prod|orders",
      brokerScope: "orders-prod",
    });
    expect(isMessageQueueHeadlineReadable(serviceBus, START)).toBe(true);
    expect(
      isMessageQueueHeadlineReadable(
        {
          ...serviceBus,
          brokerScope: "",
          queueIdentifier: "servicebus||orders",
        },
        START,
      ),
    ).toBe(false);
  });
});

describe("reading a queue's numbers", () => {
  function reader(answers: Record<string, Array<MessageQueueTimePoint>>): {
    read: MessageQueueSeriesReader;
    calls: Array<{ metric: string; keys: ReadonlyArray<string> }>;
  } {
    const calls: Array<{ metric: string; keys: ReadonlyArray<string> }> = [];
    return {
      calls: calls,
      read: async (data: Parameters<MessageQueueSeriesReader>[0]) => {
        calls.push({ metric: data.descriptor.metricName, keys: data.keys });
        return answers[data.descriptor.metricName] || [];
      },
    };
  }

  test("a gauge's newest value, read over the queue's own key", async () => {
    const { read, calls } = reader({
      "kafka.consumer_group.lag_sum": [
        { x: new Date("2026-11-07T11:58:00.000Z"), y: 900 },
        { x: new Date("2026-11-07T11:59:00.000Z"), y: 1200 },
      ],
    });
    const headline: MessageQueueBrokerHeadline =
      await fetchMessageQueueBrokerHeadline({
        projectId: PROJECT_ID,
        queue: queue(),
        start: START,
        end: END,
        readSeries: read,
      });
    expect(headline.waiting?.value).toBe(1200);
    expect(headline.waiting?.descriptor.metricName).toBe(
      "kafka.consumer_group.lag_sum",
    );
    expect(headline.deadLetter).toBeNull();
    expect(calls).toEqual([
      {
        metric: "kafka.consumer_group.lag_sum",
        keys: getMessageQueueScopeKeys({
          projectId: PROJECT_ID,
          queueIdentifier: "kafka||orders",
        }),
      },
    ]);
  });

  test("the first spelling with data wins; one without is read, then passed over", async () => {
    const { read, calls } = reader({
      approximatenumberofmessagesvisible: [
        { x: new Date("2026-11-07T11:50:00.000Z"), y: 42 },
      ],
    });
    const headline: MessageQueueBrokerHeadline =
      await fetchMessageQueueBrokerHeadline({
        projectId: PROJECT_ID,
        queue: queue({
          messagingSystem: "aws_sqs",
          queueIdentifier: "aws_sqs||orders",
        }),
        start: START,
        end: END,
        readSeries: read,
      });
    expect(headline.waiting?.value).toBe(42);
    expect(headline.waiting?.descriptor.metricName).toBe(
      "approximatenumberofmessagesvisible",
    );
    expect(
      calls.map((call: { metric: string }) => {
        return call.metric;
      }),
    ).toEqual([
      "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
      "approximatenumberofmessagesvisible",
    ]);
  });

  test("a counter's mean rate; nothing at all for no data", async () => {
    const { read } = reader({
      rocketmq_send_to_dlq_messages_total: [
        { x: new Date("2026-11-07T11:58:00.000Z"), y: 0.2 },
        { x: new Date("2026-11-07T11:59:00.000Z"), y: 0.4 },
      ],
    });
    const headline: MessageQueueBrokerHeadline =
      await fetchMessageQueueBrokerHeadline({
        projectId: PROJECT_ID,
        queue: queue({
          messagingSystem: "rocketmq",
          queueIdentifier: "rocketmq||orders",
        }),
        start: START,
        end: END,
        readSeries: read,
      });
    expect(headline.waiting).toBeNull();
    expect(headline.deadLetter?.value).toBeCloseTo(0.3, 10);
  });

  test("a queue whose identifier names no queue costs no read", async () => {
    const { read, calls } = reader({});
    expect(
      await fetchMessageQueueBrokerHeadline({
        projectId: PROJECT_ID,
        queue: queue({ queueIdentifier: "nonsense" }),
        start: START,
        end: END,
        readSeries: read,
      }),
    ).toEqual(EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE);
    expect(
      await fetchMessageQueueBrokerHeadline({
        projectId: null,
        queue: queue(),
        start: START,
        end: END,
        readSeries: read,
      }),
    ).toEqual(EMPTY_MESSAGE_QUEUE_BROKER_HEADLINE);
    expect(calls).toEqual([]);
  });
});

describe("a few at a time", () => {
  test("never more than the limit at once, every item done, in order", async () => {
    let running: number = 0;
    let most: number = 0;
    const done: Array<number> = [];
    await runWithConcurrency(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      3,
      async (item: number): Promise<void> => {
        running += 1;
        most = Math.max(most, running);
        await new Promise<void>((resolve: () => void): void => {
          setTimeout(resolve, item % 3);
        });
        done.push(item);
        running -= 1;
      },
    );
    expect(most).toBe(3);
    expect(
      done.sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  test("one failure leaves the others; a cancel starts nothing more", async () => {
    const done: Array<number> = [];
    await runWithConcurrency([1, 2, 3], 1, async (item: number) => {
      if (item === 2) {
        throw new Error("one queue failed");
      }
      done.push(item);
    });
    expect(done).toEqual([1, 3]);

    let cancelled: boolean = false;
    const started: Array<number> = [];
    await runWithConcurrency(
      [1, 2, 3, 4],
      1,
      async (item: number) => {
        started.push(item);
        cancelled = item === 2;
      },
      () => {
        return cancelled;
      },
    );
    expect(started).toEqual([1, 2]);
  });

  test("no item, no work", async () => {
    const work: jest.Mock = jest.fn() as unknown as jest.Mock;
    await runWithConcurrency([], 4, work as never);
    expect(work).not.toHaveBeenCalled();
  });
});
