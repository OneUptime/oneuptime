import {
  AZURE_MAX_SPLIT_SERIES_PER_METRIC,
  isAzureKeyMetricStoredName,
} from "../Cloud/CloudKeyMetrics";
import { normalizeMessagingSystem } from "./MessagingSystem";

/*
 * WHAT A CLOUD CONNECTION READS OF A QUEUE.
 *
 * An Azure cloud connection (Cloud > Connect) reads every Service Bus and
 * Event Hubs namespace of its subscriptions: their key metrics
 * (CloudKeyMetrics), split by queue, topic and event hub, each series
 * written as the collector's azure_monitor receiver writes it - so it
 * reaches its queue's page. A queue's other catalog metrics (a Service Bus
 * queue's scheduled messages, its size) only the receiver reads. Where both
 * read one queue's metric, the collector's is kept (CloudCollectorQueues).
 *
 * The Broker metrics card reads this to tell a metric the connection does
 * not read from one that went missing.
 */

// The ARM type of each system's namespace, whose metrics a connection splits per queue.
const AZURE_NAMESPACE_TYPE_OF_SYSTEM: Readonly<Record<string, string>> = {
  servicebus: "Microsoft.ServiceBus/namespaces",
  eventhubs: "Microsoft.EventHub/namespaces",
};

// How many queues, topics or event hubs of one namespace a connection reads.
export const CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE: number =
  AZURE_MAX_SPLIT_SERIES_PER_METRIC;

function namespaceTypeOf(system: string | null | undefined): string | null {
  return (
    AZURE_NAMESPACE_TYPE_OF_SYSTEM[normalizeMessagingSystem(system) || ""] ||
    null
  );
}

/**
 * Whether a cloud connection reads the system's metrics per queue: Azure
 * Service Bus and Event Hubs.
 */
export function isCloudConnectionPerQueueSystem(
  system: string | null | undefined,
): boolean {
  return namespaceTypeOf(system) !== null;
}

/**
 * Whether a cloud connection reads this catalog metric of a queue, by its
 * stored name, whatever aggregation the metric's definition calls primary:
 * true or false for a system it reads per queue, null for any other.
 */
export function doesCloudConnectionReadQueueMetric(descriptor: {
  system: string;
  metricName: string;
}): boolean | null {
  const type: string | null = namespaceTypeOf(descriptor.system);

  if (!type) {
    return null;
  }

  return isAzureKeyMetricStoredName(type, descriptor.metricName);
}
