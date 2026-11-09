import { describe, expect, test } from "@jest/globals";
import {
  AZURE_MAX_SPLIT_SERIES_PER_METRIC,
  getAzureKeyMetrics,
  getAzureStoredMetricName,
} from "../../../Types/Cloud/CloudKeyMetrics";
import {
  CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE,
  doesCloudConnectionReadQueueMetric,
  isCloudConnectionPerQueueSystem,
} from "../../../Types/MessageQueue/MessageQueueCloudConnectionMetrics";
import {
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";

/*
 * WHAT A CLOUD CONNECTION READS OF A QUEUE (MessageQueueCloudConnectionMetrics).
 *
 * An Azure cloud connection reads a Service Bus or Event Hubs namespace's
 * key metrics split per queue, topic and event hub, filed on each queue as
 * the collector's azure_monitor receiver files them. The Broker metrics card
 * asks this which of a queue's catalog metrics the connection reads, so a
 * metric only the receiver reads is "Collector only", never "missing".
 */

function readByConnection(system: string): Array<string> {
  return getMessageQueueMetricsForSystem(system)
    .filter((descriptor: MessageQueueMetricDescriptor): boolean => {
      return (
        doesCloudConnectionReadQueueMetric({
          system: system,
          metricName: descriptor.metricName,
        }) === true
      );
    })
    .map((descriptor: MessageQueueMetricDescriptor): string => {
      return descriptor.metricName;
    });
}

describe("the systems a cloud connection reads per queue", () => {
  test("Azure Service Bus and Event Hubs, in any spelling the catalog accepts", () => {
    for (const system of [
      "servicebus",
      "eventhubs",
      "ServiceBus",
      "azure_servicebus",
      "azure.servicebus",
      "microsoft.servicebus",
      "azure_eventhubs",
      "Microsoft.EventHub",
    ]) {
      expect({
        system,
        perQueue: isCloudConnectionPerQueueSystem(system),
      }).toEqual({ system, perQueue: true });
    }
  });

  test("no other system: Event Grid's metrics name no queue, and the rest have no namespace split", () => {
    const perQueue: Array<string> = MESSAGING_SYSTEMS.filter(
      (descriptor: MessagingSystemDescriptor): boolean => {
        return isCloudConnectionPerQueueSystem(descriptor.system);
      },
    ).map((descriptor: MessagingSystemDescriptor): string => {
      return descriptor.system;
    });
    expect(perQueue.sort()).toEqual(["eventhubs", "servicebus"]);
    for (const system of ["eventgrid", "kafka", "aws_sqs", "gcp_pubsub", ""]) {
      expect(isCloudConnectionPerQueueSystem(system)).toBe(false);
    }
    expect(isCloudConnectionPerQueueSystem(null)).toBe(false);
    expect(isCloudConnectionPerQueueSystem(undefined)).toBe(false);
  });

  test("as many queues of a namespace as a read takes", () => {
    expect(CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE).toBe(1000);
    expect(CLOUD_CONNECTION_MAX_QUEUES_PER_NAMESPACE).toBe(
      AZURE_MAX_SPLIT_SERIES_PER_METRIC,
    );
  });
});

describe("which of a queue's metrics a cloud connection reads", () => {
  test("Service Bus: the six key metrics, not the receiver's other six", () => {
    expect(readByConnection("servicebus")).toEqual([
      "azure_activemessages_average",
      "azure_deadletteredmessages_average",
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
    ]);
    for (const metricName of [
      "azure_scheduledmessages_average",
      "azure_size_average",
      "azure_completemessage_total",
      "azure_abandonmessage_total",
      "azure_usererrors_total",
      "azure_serversendlatency_average",
    ]) {
      expect({
        metricName,
        reads: doesCloudConnectionReadQueueMetric({
          system: "servicebus",
          metricName,
        }),
      }).toEqual({ metricName, reads: false });
    }
  });

  test("Event Hubs: its four counts, not user errors, quota errors or size", () => {
    expect(readByConnection("eventhubs")).toEqual([
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_servererrors_total",
      "azure_throttledrequests_total",
    ]);
    for (const metricName of [
      "azure_usererrors_total",
      "azure_quotaexceedederrors_total",
      "azure_size_average",
      // A Service Bus metric is not an Event Hubs one.
      "azure_activemessages_average",
    ]) {
      expect(
        doesCloudConnectionReadQueueMetric({ system: "eventhubs", metricName }),
      ).toBe(false);
    }
  });

  test("each is a key metric of its namespace type, under the name the read stores", () => {
    for (const [system, type] of [
      ["servicebus", "Microsoft.ServiceBus/namespaces"],
      ["eventhubs", "Microsoft.EventHub/namespaces"],
    ] as Array<[string, string]>) {
      const stored: Array<string> = getAzureKeyMetrics(type)!.metrics.flatMap(
        (metric: string): Array<string> => {
          return ["Total", "Average", "Minimum", "Maximum", "Count"].map(
            (aggregation: string): string => {
              return getAzureStoredMetricName(metric, aggregation);
            },
          );
        },
      );
      for (const metricName of readByConnection(system)) {
        expect({
          system,
          metricName,
          stored: stored.includes(metricName),
        }).toEqual({ system, metricName, stored: true });
      }
    }
  });

  test("whatever case the stored name is in, and whatever aggregation the key metric has", () => {
    expect(
      doesCloudConnectionReadQueueMetric({
        system: "Azure_ServiceBus",
        metricName: "AZURE_ActiveMessages_Average",
      }),
    ).toBe(true);
    expect(
      doesCloudConnectionReadQueueMetric({
        system: "servicebus",
        metricName: "azure_activemessages_maximum",
      }),
    ).toBe(true);
    expect(
      doesCloudConnectionReadQueueMetric({
        system: "servicebus",
        metricName: "",
      }),
    ).toBe(false);
  });

  test("any other system: not known, so nothing is claimed", () => {
    for (const system of ["kafka", "eventgrid", "aws_sqs", "gcp_pubsub", ""]) {
      expect(
        doesCloudConnectionReadQueueMetric({
          system,
          metricName: "azure_incomingmessages_total",
        }),
      ).toBeNull();
    }
  });
});
