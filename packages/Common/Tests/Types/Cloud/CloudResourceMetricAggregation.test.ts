import AggregationInterval from "../../../Types/BaseDatabase/AggregationInterval";
import AggregationIntervalUtil from "../../../Types/BaseDatabase/AggregationIntervalUtil";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import TimeRange from "../../../Types/Time/TimeRange";
import { RangeStartAndEndDateTimeUtil } from "../../../Types/Time/RangeStartAndEndDateTime";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import {
  AWS_KEY_METRICS,
  AZURE_KEY_METRICS,
  AwsKeyMetric,
  AwsNamespaceKeyMetrics,
  AzureTypeKeyMetrics,
  getAwsStoredMetricName,
  getAzureStoredMetricName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  getCloudResourceMetricAggregation,
  hasCloudResourceSummedMetrics,
} from "../../../Types/Cloud/CloudResourceMetricAggregation";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import { describe, expect, test } from "@jest/globals";

/*
 * Which of a cloud resource's own metrics read as the sum of their series
 * (issue #6410). Since #6373 a connected Azure subscription reads a Service
 * Bus or Event Hubs namespace's key metrics once per queue, topic and event
 * hub, as the collector's azure_monitor receiver always did, so the
 * average of the series a namespace's Metrics tab reads is the average
 * queue. These pin which metrics add up to the namespace's number, and that
 * every other metric and resource keeps the average.
 */

const SERVICE_BUS: string = "Microsoft.ServiceBus/namespaces";
const EVENT_HUBS: string = "Microsoft.EventHub/namespaces";

// A read by the minute, as every range up to 3 hours is read.
function aggregationOf(
  type: string,
  metricName: string,
  provider: string = CloudProvider.Azure,
  aggregationInterval: AggregationInterval = AggregationInterval.Minute,
): AggregationType | undefined {
  return getCloudResourceMetricAggregation({
    provider: provider,
    type: type,
    metricName: metricName,
    aggregationInterval: aggregationInterval,
  });
}

// Every interval longer than a minute the aggregate API reads in.
const LONGER_INTERVALS: Array<AggregationInterval> = Object.values(
  AggregationInterval,
).filter((interval: AggregationInterval): boolean => {
  return interval !== AggregationInterval.Minute;
});

// What a connected subscription reads of each namespace, as it stores them.
const CONNECTION_READS: ReadonlyArray<[string, ReadonlyArray<string>]> = [
  [
    SERVICE_BUS,
    [
      "azure_activemessages_average",
      "azure_deadletteredmessages_average",
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
    ],
  ],
  [
    EVENT_HUBS,
    [
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
    ],
  ],
];

describe("a namespace's metrics that arrive once per queue", () => {
  test.each(CONNECTION_READS)(
    "every metric a connection reads of a %s namespace reads as the sum of its queues",
    (type: string, storedNames: ReadonlyArray<string>) => {
      for (const storedName of storedNames) {
        expect([storedName, aggregationOf(type, storedName)]).toEqual([
          storedName,
          AggregationType.Sum,
        ]);
      }
    },
  );

  test("every key metric of a type the connection splits by queue adds up, so a new one has to be decided on", () => {
    const splitTypes: Array<AzureTypeKeyMetrics> = AZURE_KEY_METRICS.filter(
      (entry: AzureTypeKeyMetrics): boolean => {
        return Boolean(entry.splitByDimension);
      },
    );

    expect(
      splitTypes.map((entry: AzureTypeKeyMetrics): string => {
        return entry.type;
      }),
    ).toEqual([SERVICE_BUS, EVENT_HUBS]);

    for (const entry of splitTypes) {
      for (const metric of entry.metrics) {
        // Whichever aggregation Azure calls the metric's primary one.
        const summedUnder: Array<string> = ["average", "total"]
          .map((aggregation: string): string => {
            return getAzureStoredMetricName(metric, aggregation);
          })
          .filter((storedName: string): boolean => {
            return (
              aggregationOf(entry.type, storedName) === AggregationType.Sum
            );
          });

        expect([entry.type, metric, summedUnder.length > 0]).toEqual([
          entry.type,
          metric,
          true,
        ]);
      }
    }
  });

  /*
   * What the Queues guide's receiver configuration collects for each
   * namespace (MessageQueueMetricCatalog's Azure entries): all of it adds
   * up but a send's latency, which is per send.
   */
  test("the receiver's metrics add up too, except Service Bus's send latency", () => {
    const azure: Array<MessageQueueMetricDescriptor> =
      MESSAGE_QUEUE_METRICS.filter(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return descriptor.metricName.startsWith("azure_");
        },
      );

    expect(azure.length).toBeGreaterThanOrEqual(19);

    for (const descriptor of azure) {
      const type: string =
        descriptor.system === "servicebus" ? SERVICE_BUS : EVENT_HUBS;
      expect(["servicebus", "eventhubs"]).toContain(descriptor.system);

      const expected: AggregationType | undefined =
        descriptor.signal === "latency" ? undefined : AggregationType.Sum;

      expect([
        descriptor.system,
        descriptor.metricName,
        aggregationOf(type, descriptor.metricName),
      ]).toEqual([descriptor.system, descriptor.metricName, expected]);
    }

    expect(aggregationOf(SERVICE_BUS, "azure_serversendlatency_average")).toBe(
      undefined,
    );
  });

  test.each([
    // An amount held: each queue's average, lowest, highest and total add up.
    [SERVICE_BUS, "azure_activemessages_minimum"],
    [SERVICE_BUS, "azure_activemessages_maximum"],
    [SERVICE_BUS, "azure_messages_average"],
    [SERVICE_BUS, "azure_size_maximum"],
    [EVENT_HUBS, "azure_capturebacklog_total"],
    [EVENT_HUBS, "azure_size_average"],
    // A count per period: its total and its count of samples add up.
    [SERVICE_BUS, "azure_incomingrequests_total"],
    [SERVICE_BUS, "azure_successfulrequests_total"],
    [SERVICE_BUS, "azure_incomingbytes_total"],
    [SERVICE_BUS, "azure_incomingmessages_count"],
    [EVENT_HUBS, "azure_outgoingbytes_total"],
    [EVENT_HUBS, "azure_capturedmessages_total"],
    [EVENT_HUBS, "azure_connectionsopened_total"],
  ])("%s's %s adds up across its queues", (type: string, name: string) => {
    expect(aggregationOf(type, name)).toBe(AggregationType.Sum);
  });

  test.each([
    // Per send, per queue: never a sum.
    [SERVICE_BUS, "azure_serversendlatency_average"],
    // Not split by queue: the namespace's own series, read as before.
    [SERVICE_BUS, "azure_activeconnections_total"],
    [EVENT_HUBS, "azure_activeconnections_average"],
    [SERVICE_BUS, "azure_pendingcheckpointoperationcount_total"],
    // Percentages of the namespace, per replica.
    [SERVICE_BUS, "azure_namespacecpuusage_maximum"],
    [EVENT_HUBS, "azure_namespacememoryusage_maximum"],
    // A replication lag is how far behind, not how much.
    [SERVICE_BUS, "azure_replicationlagduration_maximum"],
    [EVENT_HUBS, "azure_replicationlagcount_maximum"],
    // A count's per-sample statistics do not add up to the namespace's.
    [SERVICE_BUS, "azure_incomingmessages_average"],
    [EVENT_HUBS, "azure_incomingmessages_maximum"],
    // Service Bus has its connections opened as an average only.
    [SERVICE_BUS, "azure_connectionsopened_average"],
    // Another type's metric with a namespace's name.
    [EVENT_HUBS, "azure_activemessages_average"],
    // Neither a stored name nor anything at all.
    [SERVICE_BUS, "IncomingMessages"],
    [SERVICE_BUS, ""],
    [SERVICE_BUS, "azure_incomingmessages_total_extra"],
  ])("%s's %s keeps the average", (type: string, name: string) => {
    expect(aggregationOf(type, name)).toBeUndefined();
  });

  test("names and types are matched as Azure and ingest spell them", () => {
    // Azure Monitor answers the type as `Namespaces`; ingest lowercases names.
    expect(
      aggregationOf(
        "Microsoft.ServiceBus/Namespaces",
        "azure_activemessages_average",
      ),
    ).toBe(AggregationType.Sum);
    expect(
      aggregationOf(
        " microsoft.eventhub/namespaces ",
        " AZURE_IncomingMessages_Total ",
      ),
    ).toBe(AggregationType.Sum);
    expect(
      getCloudResourceMetricAggregation({
        provider: "Azure",
        type: SERVICE_BUS,
        metricName: "azure_incomingmessages_total",
        aggregationInterval: AggregationInterval.Minute,
      }),
    ).toBe(AggregationType.Sum);
  });
});

describe("every other resource keeps the average", () => {
  test("no other Azure type's key metric adds up", () => {
    for (const entry of AZURE_KEY_METRICS) {
      if (entry.splitByDimension) {
        continue;
      }

      expect([
        entry.type,
        hasCloudResourceSummedMetrics({
          provider: CloudProvider.Azure,
          type: entry.type,
        }),
      ]).toEqual([entry.type, false]);

      for (const metric of entry.metrics) {
        for (const aggregation of ["average", "total", "maximum", "count"]) {
          const storedName: string = getAzureStoredMetricName(
            metric,
            aggregation,
          );
          expect([
            entry.type,
            storedName,
            aggregationOf(entry.type, storedName),
          ]).toEqual([entry.type, storedName, undefined]);
        }
      }
    }
  });

  test("no AWS or Google Cloud resource's metric adds up, not even a queue's", () => {
    for (const namespace of AWS_KEY_METRICS as ReadonlyArray<AwsNamespaceKeyMetrics>) {
      for (const metric of namespace.metrics as ReadonlyArray<AwsKeyMetric>) {
        const storedName: string = getAwsStoredMetricName(
          namespace.namespace,
          metric.metricName,
        );
        expect(
          aggregationOf(namespace.namespace, storedName, CloudProvider.AWS),
        ).toBe(undefined);
      }
    }

    expect(
      hasCloudResourceSummedMetrics({
        provider: CloudProvider.GCP,
        type: "pubsub_subscription",
      }),
    ).toBe(false);
  });

  test("a namespace's type under another provider, or none, adds nothing up", () => {
    for (const provider of [
      CloudProvider.AWS,
      CloudProvider.GCP,
      "",
      null,
      undefined,
    ]) {
      expect(
        hasCloudResourceSummedMetrics({
          provider: provider,
          type: SERVICE_BUS,
        }),
      ).toBe(false);
      expect(
        getCloudResourceMetricAggregation({
          provider: provider,
          type: SERVICE_BUS,
          metricName: "azure_incomingmessages_total",
          aggregationInterval: AggregationInterval.Minute,
        }),
      ).toBeUndefined();
    }

    expect(
      hasCloudResourceSummedMetrics({
        provider: CloudProvider.Azure,
        type: null,
      }),
    ).toBe(false);
    expect(
      hasCloudResourceSummedMetrics({
        provider: CloudProvider.Azure,
        type: SERVICE_BUS,
      }),
    ).toBe(true);
    expect(
      hasCloudResourceSummedMetrics({
        provider: CloudProvider.Azure,
        type: EVENT_HUBS,
      }),
    ).toBe(true);
  });
});

/*
 * Sum adds up every point of an interval. A count's points are each one
 * period's count, so their Sum is the namespace's count in the interval,
 * however long. An amount held has one point a minute per queue: the Sum
 * of a minute is the namespace's amount, the Sum of 15 minutes 15 times it.
 */
describe("an amount held adds up only while an interval is a minute", () => {
  const AMOUNTS: Array<[string, string]> = [
    [SERVICE_BUS, "azure_activemessages_average"],
    [SERVICE_BUS, "azure_deadletteredmessages_average"],
    [SERVICE_BUS, "azure_scheduledmessages_maximum"],
    [SERVICE_BUS, "azure_size_average"],
    [EVENT_HUBS, "azure_capturebacklog_total"],
    [EVENT_HUBS, "azure_size_average"],
  ];

  const COUNTS: Array<[string, string]> = [
    [SERVICE_BUS, "azure_incomingmessages_total"],
    [SERVICE_BUS, "azure_outgoingmessages_total"],
    [SERVICE_BUS, "azure_servererrors_total"],
    [SERVICE_BUS, "azure_throttledrequests_total"],
    [SERVICE_BUS, "azure_completemessage_count"],
    [EVENT_HUBS, "azure_incomingmessages_total"],
    [EVENT_HUBS, "azure_capturedbytes_total"],
  ];

  test.each(AMOUNTS)(
    "%s's %s adds up by the minute and keeps the average over every longer interval",
    (type: string, name: string) => {
      expect(aggregationOf(type, name)).toBe(AggregationType.Sum);

      for (const interval of LONGER_INTERVALS) {
        expect([
          interval,
          aggregationOf(type, name, CloudProvider.Azure, interval),
        ]).toEqual([interval, undefined]);
      }
    },
  );

  test.each(COUNTS)(
    "%s's %s adds up over any interval, the whole window's too",
    (type: string, name: string) => {
      for (const interval of Object.values(AggregationInterval)) {
        expect([
          interval,
          aggregationOf(type, name, CloudProvider.Azure, interval),
        ]).toEqual([interval, AggregationType.Sum]);
      }
    },
  );

  test("a metric that never adds up keeps the average over every interval", () => {
    for (const interval of Object.values(AggregationInterval)) {
      expect(
        aggregationOf(
          SERVICE_BUS,
          "azure_serversendlatency_average",
          CloudProvider.Azure,
          interval,
        ),
      ).toBeUndefined();
    }
  });

  /*
   * What the time picker's ranges read, by the aggregate API's own choice of
   * interval: up to 3 hours by the minute, a day and longer by 15 minutes or
   * more.
   */
  test.each(
    Object.values(TimeRange).filter((range: TimeRange): boolean => {
      return range !== TimeRange.CUSTOM;
    }),
  )(
    "over the picker's %s, a namespace's messages waiting read as the queues' total only when read by the minute",
    (range: TimeRange) => {
      const window: InBetween<Date> =
        RangeStartAndEndDateTimeUtil.getStartAndEndDate({ range: range });
      const interval: AggregationInterval =
        AggregationIntervalUtil.getAggregationIntervalForWindow({
          startDate: window.startValue,
          endDate: window.endValue,
        });
      const byTheMinute: boolean = [
        TimeRange.PAST_FIVE_MINS,
        TimeRange.PAST_FIFTEEN_MINS,
        TimeRange.PAST_THIRTY_MINS,
        TimeRange.PAST_ONE_HOUR,
        TimeRange.PAST_TWO_HOURS,
        TimeRange.PAST_THREE_HOURS,
      ].includes(range);

      expect(interval === AggregationInterval.Minute).toBe(byTheMinute);
      expect(
        aggregationOf(
          SERVICE_BUS,
          "azure_activemessages_average",
          CloudProvider.Azure,
          interval,
        ),
      ).toBe(byTheMinute ? AggregationType.Sum : undefined);
      expect(
        aggregationOf(
          SERVICE_BUS,
          "azure_incomingmessages_total",
          CloudProvider.Azure,
          interval,
        ),
      ).toBe(AggregationType.Sum);
    },
  );
});
