import AggregationInterval from "../BaseDatabase/AggregationInterval";
import AggregationType from "../BaseDatabase/AggregationType";
import { CloudProvider } from "./CloudPlatform";
import { getAzureStoredMetricName } from "./CloudKeyMetrics";

/*
 * HOW A CLOUD RESOURCE'S OWN METRIC ADDS UP, where the average of its series
 * is not the resource's number.
 *
 * A resource's Metrics tab reads every series of a metric that carries the
 * resource's attributes and charts their average per interval: the
 * resource's value, for a resource its provider reports each metric about
 * once. A Service Bus or Event Hubs namespace reports most of its metrics
 * once per queue, topic and event hub, split by Azure Monitor's EntityName
 * dimension: a connected subscription reads them so (CloudKeyMetrics'
 * splitByDimension), and so does the collector's azure_monitor receiver.
 * Their average is the average queue. The namespace's number is their sum,
 * as the namespace's readings and tiles add them up (CloudResourceReadings).
 *
 * So these are read with Sum: the metrics Azure Monitor splits by EntityName
 * whose parts add up to the namespace's (Azure Monitor's metric reference
 * for each type), each under the stored names that add up -
 *   - a count per period (messages, requests, errors, bytes): its total and
 *     the count of its samples. The Sum of an interval is the namespace's
 *     count in it, however long the interval is;
 *   - an amount held at a time (messages waiting, a queue's size): its
 *     average, minimum, maximum and total. Each queue has one point a minute
 *     (the connection reads Azure's one-minute grain), so the Sum of a
 *     minute is the namespace's amount then. An interval of several minutes
 *     holds several points of every queue, whose Sum is no amount the
 *     namespace ever held (a 15-minute interval reads 15 times its backlog),
 *     so an amount is summed only while an interval is a minute - up to a
 *     range of 3 hours (AggregationIntervalUtil) - and keeps the average
 *     past that.
 * A latency, a percentage, a replication lag, and a metric Azure does not
 * split by EntityName (ActiveConnections, the Premium tier's CPU and memory)
 * keep the average, as every metric of every other resource type does.
 */

type SummedMetricKind = "count" | "amount";

interface SummedAzureMetrics {
  // ARM type, as CloudResourceCatalog spells it.
  type: string;
  // Counts per period, as Azure Monitor names them.
  counts: ReadonlyArray<string>;
  // Amounts held at a point in time.
  amounts: ReadonlyArray<string>;
}

// The stored aggregations of a count per period that add up across queues.
const COUNT_AGGREGATIONS: ReadonlyArray<string> = ["total", "count"];

// The stored aggregations of an amount held that add up across queues.
const AMOUNT_AGGREGATIONS: ReadonlyArray<string> = [
  "average",
  "minimum",
  "maximum",
  "total",
];

const SUMMED_AZURE_METRICS: ReadonlyArray<SummedAzureMetrics> = [
  {
    type: "Microsoft.ServiceBus/namespaces",
    counts: [
      "IncomingMessages",
      "OutgoingMessages",
      "CompleteMessage",
      "AbandonMessage",
      "IncomingRequests",
      "SuccessfulRequests",
      "ServerErrors",
      "UserErrors",
      "ThrottledRequests",
      "IncomingBytes",
      "OutgoingBytes",
      "ConnectionsOpened",
      "ConnectionsClosed",
    ],
    amounts: [
      "ActiveMessages",
      "DeadletteredMessages",
      "ScheduledMessages",
      "Messages",
      "Size",
    ],
  },
  {
    type: "Microsoft.EventHub/namespaces",
    counts: [
      "IncomingMessages",
      "OutgoingMessages",
      "IncomingRequests",
      "SuccessfulRequests",
      "ServerErrors",
      "UserErrors",
      "QuotaExceededErrors",
      "ThrottledRequests",
      "IncomingBytes",
      "OutgoingBytes",
      "CapturedMessages",
      "CapturedBytes",
      "ConnectionsOpened",
      "ConnectionsClosed",
    ],
    amounts: ["Size", "CaptureBacklog"],
  },
];

function storedNamesOf(
  metrics: ReadonlyArray<string>,
  aggregations: ReadonlyArray<string>,
  kind: SummedMetricKind,
): Array<[string, SummedMetricKind]> {
  return metrics.flatMap(
    (metric: string): Array<[string, SummedMetricKind]> => {
      return aggregations.map(
        (aggregation: string): [string, SummedMetricKind] => {
          return [getAzureStoredMetricName(metric, aggregation), kind];
        },
      );
    },
  );
}

// ARM type, lowercased → each stored name its namespace sums, and its kind.
const SUMMED_STORED_NAMES_BY_AZURE_TYPE: ReadonlyMap<
  string,
  ReadonlyMap<string, SummedMetricKind>
> = new Map(
  SUMMED_AZURE_METRICS.map(
    (
      entry: SummedAzureMetrics,
    ): [string, ReadonlyMap<string, SummedMetricKind>] => {
      return [
        entry.type.toLowerCase(),
        new Map<string, SummedMetricKind>([
          ...storedNamesOf(entry.counts, COUNT_AGGREGATIONS, "count"),
          ...storedNamesOf(entry.amounts, AMOUNT_AGGREGATIONS, "amount"),
        ]),
      ];
    },
  ),
);

function getSummedStoredNames(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
}): ReadonlyMap<string, SummedMetricKind> | undefined {
  if ((data.provider || "").trim().toLowerCase() !== CloudProvider.Azure) {
    return undefined;
  }

  return SUMMED_STORED_NAMES_BY_AZURE_TYPE.get(
    (data.type || "").trim().toLowerCase(),
  );
}

/*
 * The aggregation a resource's own reading of this stored metric takes, for
 * a read whose intervals are `aggregationInterval` long: Sum for a count
 * whose series are parts of the resource, and for such an amount held while
 * an interval is a minute (above); undefined for every other metric,
 * interval and resource - the reader's own default, the average.
 */
export function getCloudResourceMetricAggregation(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
  metricName: string | null | undefined;
  aggregationInterval: AggregationInterval;
}): AggregationType | undefined {
  const summed: ReadonlyMap<string, SummedMetricKind> | undefined =
    getSummedStoredNames(data);
  const metricName: string = (data.metricName || "").trim().toLowerCase();

  if (!summed || !metricName) {
    return undefined;
  }

  const kind: SummedMetricKind | undefined = summed.get(metricName);

  if (kind === "count") {
    return AggregationType.Sum;
  }

  if (
    kind === "amount" &&
    data.aggregationInterval === AggregationInterval.Minute
  ) {
    return AggregationType.Sum;
  }

  return undefined;
}

// Whether any metric of the resource's type adds up across its series.
export function hasCloudResourceSummedMetrics(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
}): boolean {
  return Boolean(getSummedStoredNames(data));
}
