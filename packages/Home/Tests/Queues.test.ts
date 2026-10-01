import {
  QueueAlertThresholdEntry,
  QueueAlertThresholdGroup,
  QueueSystemEntry,
  QueueSystemGroup,
  QueueSystemGroupKey,
  QueuesPageContent,
  getQueueAlertThresholdGroups,
  getQueueBrokerHealthCharts,
  getQueueMetricsSourceLabel,
  getQueueSystemGroupKey,
  getQueueSystemGroups,
  getQueuesPageContent,
} from "../Utils/Queues";
import {
  MESSAGING_SYSTEMS,
  MessagingSystemDescriptor,
} from "Common/Types/MessageQueue/MessagingSystem";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  getMessageQueueMetricsForSystem,
} from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import {
  MessageQueueAlertTemplate,
  formatMessageQueueThreshold,
  getMessageQueueAlertTemplateForMetric,
} from "Common/Types/Monitor/MessageQueueAlertTemplates";

/*
 * The Queues product page renders its messaging systems and its starting
 * thresholds from the product's own catalogs, through Utils/Queues.ts.
 * These pin the shaping: every system lands in exactly one group, the group
 * its broker metrics source says, with the charts a queue's Overview really
 * draws for it, and every threshold is the one "Create monitor" really
 * starts from beside that chart.
 */

function descriptorFor(system: string): MessagingSystemDescriptor {
  const descriptor: MessagingSystemDescriptor | undefined =
    MESSAGING_SYSTEMS.find((candidate: MessagingSystemDescriptor): boolean => {
      return candidate.system === system;
    });

  if (!descriptor) {
    throw new Error(`${system} is not in MESSAGING_SYSTEMS`);
  }

  return descriptor;
}

function systemsOf(group: QueueSystemGroup): Array<string> {
  return group.systems.map((entry: QueueSystemEntry): string => {
    return entry.system;
  });
}

// "Messages visible (JSON stream)" → "Messages visible".
function baseTitleOf(title: string): string {
  return title.replace(/\s*\([^()]*\)$/, "");
}

function templatesOf(system: string): Array<{
  metric: MessageQueueMetricDescriptor;
  template: MessageQueueAlertTemplate;
}> {
  return getMessageQueueMetricsForSystem(system)
    .map((metric: MessageQueueMetricDescriptor) => {
      return {
        metric,
        template: getMessageQueueAlertTemplateForMetric(metric),
      };
    })
    .filter(
      (pair: {
        metric: MessageQueueMetricDescriptor;
        template: MessageQueueAlertTemplate | undefined;
      }): pair is {
        metric: MessageQueueMetricDescriptor;
        template: MessageQueueAlertTemplate;
      } => {
        return pair.template !== undefined;
      },
    );
}

describe("getQueueSystemGroups", () => {
  const groups: Array<QueueSystemGroup> = getQueueSystemGroups();

  test("puts every catalog system in exactly one group", () => {
    const grouped: Array<string> = groups.flatMap(systemsOf);

    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(
      MESSAGING_SYSTEMS.map((descriptor: MessagingSystemDescriptor): string => {
        return descriptor.system;
      }).sort(),
    );
  });

  test("groups each system by where its broker metrics come from", () => {
    const expectedKind: Record<QueueSystemGroupKey, string> = {
      "collector-receiver": "receiver",
      "cloud-monitoring": "cloud-monitoring",
      prometheus: "prometheus",
      "external-scraper": "external-scraper",
      "traces-only": "none",
    };

    for (const group of groups) {
      for (const system of systemsOf(group)) {
        const descriptor: MessagingSystemDescriptor = descriptorFor(system);

        expect(getQueueSystemGroupKey(descriptor)).toBe(group.key);
        expect({ system, kind: descriptor.brokerMetrics.kind }).toEqual({
          system,
          kind: expectedKind[group.key],
        });
      }
    }
  });

  test("files exactly the systems the Queues docs read with a collector receiver", () => {
    /*
     * docs/telemetry/queues.md: Kafka's `kafka_metrics` receiver and
     * RabbitMQ's `rabbitmq` receiver read the brokers themselves.
     */
    const receiverGroup: QueueSystemGroup | undefined = groups.find(
      (group: QueueSystemGroup): boolean => {
        return group.key === "collector-receiver";
      },
    );

    expect(receiverGroup).toBeDefined();
    expect(systemsOf(receiverGroup!).sort()).toEqual(["kafka", "rabbitmq"]);
  });

  test("leads with the collector receivers and leaves no group empty", () => {
    const keys: Array<QueueSystemGroupKey> = groups.map(
      (group: QueueSystemGroup): QueueSystemGroupKey => {
        return group.key;
      },
    );

    expect(keys[0]).toBe("collector-receiver");
    expect(new Set(keys).size).toBe(keys.length);

    for (const group of groups) {
      expect(group.systems.length).toBeGreaterThan(0);
      expect(group.title.trim().length).toBeGreaterThan(0);
      expect(group.description.trim()).toMatch(/\.$/);
    }
  });

  test("orders the systems of a group by name", () => {
    for (const group of groups) {
      const names: Array<string> = group.systems.map(
        (entry: QueueSystemEntry): string => {
          return entry.displayName;
        },
      );
      const sorted: Array<string> = [...names].sort(
        (a: string, b: string): number => {
          return a.localeCompare(b, "en", { sensitivity: "base" });
        },
      );

      expect(names).toEqual(sorted);
    }
  });

  test("shows each system under the catalog's display name and metrics source", () => {
    for (const group of groups) {
      for (const entry of group.systems) {
        const descriptor: MessagingSystemDescriptor = descriptorFor(
          entry.system,
        );

        expect(entry.displayName).toBe(descriptor.displayName);
        expect(entry.metricsSource).toBe(
          getQueueMetricsSourceLabel(descriptor.brokerMetrics),
        );
        expect(entry.brokerHealthCharts).toEqual(
          getQueueBrokerHealthCharts(entry.system),
        );
      }
    }
  });
});

describe("getQueueMetricsSourceLabel", () => {
  test("names the receiver a collector config names", () => {
    expect(
      getQueueMetricsSourceLabel(descriptorFor("kafka").brokerMetrics),
    ).toBe("kafka_metrics");
    expect(
      getQueueMetricsSourceLabel(descriptorFor("rabbitmq").brokerMetrics),
    ).toBe("rabbitmq");
  });

  test("names every receiver that reads a cloud provider's metrics", () => {
    expect(
      getQueueMetricsSourceLabel(descriptorFor("aws_sqs").brokerMetrics),
    ).toBe("aws_cloudwatch or awsfirehose");
    expect(
      getQueueMetricsSourceLabel(descriptorFor("servicebus").brokerMetrics),
    ).toBe("azure_monitor");
    expect(
      getQueueMetricsSourceLabel(descriptorFor("gcp_pubsub").brokerMetrics),
    ).toBe("googlecloudmonitoring");
  });

  test("names a Prometheus endpoint by its exporter, port and path", () => {
    expect(
      getQueueMetricsSourceLabel(descriptorFor("pulsar").brokerMetrics),
    ).toBe("Pulsar broker :8080/metrics/");
    expect(
      getQueueMetricsSourceLabel(descriptorFor("nats").brokerMetrics),
    ).toBe("prometheus-nats-exporter :7777/metrics");
  });

  test("names the scraper beside the broker, and nothing when there is none", () => {
    expect(
      getQueueMetricsSourceLabel(descriptorFor("activemq").brokerMetrics),
    ).toBe("OpenTelemetry JMX Scraper");
    expect(
      getQueueMetricsSourceLabel(descriptorFor("bullmq").brokerMetrics),
    ).toBe("");
    expect(getQueueMetricsSourceLabel(descriptorFor("jms").brokerMetrics)).toBe(
      "",
    );
  });
});

describe("getQueueBrokerHealthCharts", () => {
  test("names each curated metric once, in the catalog's order", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const expected: Array<string> = [];

      for (const metric of getMessageQueueMetricsForSystem(descriptor.system)) {
        const title: string = baseTitleOf(metric.title);

        if (!expected.includes(title)) {
          expected.push(title);
        }
      }

      expect({
        system: descriptor.system,
        charts: getQueueBrokerHealthCharts(descriptor.system),
      }).toEqual({ system: descriptor.system, charts: expected });
    }
  });

  test("folds a metric's second shape into its first", () => {
    // A CloudWatch Metric Stream in JSON format, and the JMX Scraper's legacy names.
    expect(getQueueBrokerHealthCharts("aws_sqs")).toEqual([
      "Messages visible",
      "Oldest message age",
      "Messages in flight",
      "Messages sent",
      "Messages received",
      "Messages deleted",
    ]);
    expect(getQueueBrokerHealthCharts("activemq")).toEqual([
      "Queue size",
      "Enqueued",
      "Dequeued",
      "Expired",
      "Consumers",
      "Average time in queue",
    ]);
  });

  test("charts nothing for the systems whose metrics stay in the Metrics explorer", () => {
    /*
     * docs/telemetry/queues.md: NATS reports JetStream streams and Event
     * Grid its topics, not a queue; JMS and BullMQ have no broker metrics.
     */
    for (const system of ["nats", "eventgrid", "jms", "bullmq"]) {
      expect({ system, charts: getQueueBrokerHealthCharts(system) }).toEqual({
        system,
        charts: [],
      });
    }
  });

  test("charts a curated set for every other system", () => {
    for (const descriptor of MESSAGING_SYSTEMS) {
      const curated: boolean = MESSAGE_QUEUE_METRICS.some(
        (metric: MessageQueueMetricDescriptor): boolean => {
          return metric.system === descriptor.system;
        },
      );

      expect({
        system: descriptor.system,
        charted: getQueueBrokerHealthCharts(descriptor.system).length > 0,
      }).toEqual({ system: descriptor.system, charted: curated });
    }
  });
});

describe("getQueueAlertThresholdGroups", () => {
  const groups: Array<QueueAlertThresholdGroup> =
    getQueueAlertThresholdGroups();

  test("has one group per system with a template, in the catalog's order", () => {
    const expected: Array<string> = MESSAGING_SYSTEMS.filter(
      (descriptor: MessagingSystemDescriptor): boolean => {
        return templatesOf(descriptor.system).length > 0;
      },
    ).map((descriptor: MessagingSystemDescriptor): string => {
      return descriptor.system;
    });

    expect(
      groups.map((group: QueueAlertThresholdGroup): string => {
        return group.system;
      }),
    ).toEqual(expected);

    for (const group of groups) {
      expect(group.title).toBe(descriptorFor(group.system).displayName);
      expect(group.thresholds.length).toBeGreaterThan(0);
    }
  });

  test("lists the template of each chart, with the threshold and severity Create monitor starts from", () => {
    for (const group of groups) {
      const expected: Array<QueueAlertThresholdEntry> = [];
      const listedCharts: Array<string> = [];

      for (const { metric, template } of templatesOf(group.system)) {
        const chart: string = baseTitleOf(metric.title);

        if (listedCharts.includes(chart)) {
          continue;
        }

        listedCharts.push(chart);
        expected.push({
          name: template.name,
          severity: template.severity,
          threshold: formatMessageQueueThreshold(
            template.threshold,
            template.unit,
          ),
        });
      }

      expect({ system: group.system, thresholds: group.thresholds }).toEqual({
        system: group.system,
        thresholds: expected,
      });
    }
  });

  test("leaves out only a metric's second shape, never a chart of its own", () => {
    /*
     * Every template the catalog builds is listed, or is the same chart in
     * a second shape (a JSON stream, legacy names) of one that is: same
     * system, same chart, same severity and threshold.
     */
    for (const descriptor of MESSAGING_SYSTEMS) {
      const group: QueueAlertThresholdGroup | undefined = groups.find(
        (candidate: QueueAlertThresholdGroup): boolean => {
          return candidate.system === descriptor.system;
        },
      );
      const listedNames: Array<string> = (group?.thresholds || []).map(
        (entry: QueueAlertThresholdEntry): string => {
          return entry.name;
        },
      );

      for (const { metric, template } of templatesOf(descriptor.system)) {
        if (listedNames.includes(template.name)) {
          continue;
        }

        const listedTwin: MessageQueueAlertTemplate | undefined = templatesOf(
          descriptor.system,
        )
          .filter(
            (pair: {
              metric: MessageQueueMetricDescriptor;
              template: MessageQueueAlertTemplate;
            }): boolean => {
              return (
                baseTitleOf(pair.metric.title) === baseTitleOf(metric.title) &&
                listedNames.includes(pair.template.name)
              );
            },
          )
          .map(
            (pair: {
              metric: MessageQueueMetricDescriptor;
              template: MessageQueueAlertTemplate;
            }): MessageQueueAlertTemplate => {
              return pair.template;
            },
          )[0];

        expect({ left: template.name, twin: Boolean(listedTwin) }).toEqual({
          left: template.name,
          twin: true,
        });
        expect(metric.title).toMatch(/\([^()]+\)$/);
        expect(template.severity).toBe(listedTwin!.severity);
        expect(template.threshold).toBe(listedTwin!.threshold);
      }
    }
  });

  test("words thresholds in the metric's own unit", () => {
    const thresholdOf: (system: string, name: string) => string | undefined = (
      system: string,
      name: string,
    ): string | undefined => {
      return groups
        .find((group: QueueAlertThresholdGroup): boolean => {
          return group.system === system;
        })
        ?.thresholds.find((entry: QueueAlertThresholdEntry): boolean => {
          return entry.name === name;
        })?.threshold;
    };

    expect(thresholdOf("kafka", "Consumer Lag High")).toBe("10,000 messages");
    expect(thresholdOf("aws_sqs", "Oldest Message Age High")).toBe(
      "10 minutes",
    );
    expect(thresholdOf("servicebus", "Dead-Lettered Messages")).toBe(
      "1 message",
    );
    expect(thresholdOf("eventhubs", "Throttled Requests")).toBe("10 requests");
  });
});

describe("getQueuesPageContent", () => {
  const content: QueuesPageContent = getQueuesPageContent();

  test("counts come from the product's catalogs", () => {
    expect(content.systemCount).toBe(MESSAGING_SYSTEMS.length);
    expect(content.systemsWithBrokerHealthCount).toBe(
      new Set(
        MESSAGE_QUEUE_METRICS.map(
          (metric: MessageQueueMetricDescriptor): string => {
            return metric.system;
          },
        ),
      ).size,
    );
    expect(content.systemsWithAlertThresholdsCount).toBe(
      MESSAGING_SYSTEMS.filter(
        (descriptor: MessagingSystemDescriptor): boolean => {
          return templatesOf(descriptor.system).length > 0;
        },
      ).length,
    );
  });

  test("the groups add up to the counts the headings print", () => {
    expect(
      content.systemGroups.reduce(
        (total: number, group: QueueSystemGroup): number => {
          return total + group.systems.length;
        },
        0,
      ),
    ).toBe(content.systemCount);

    expect(
      content.systemGroups
        .flatMap((group: QueueSystemGroup): Array<QueueSystemEntry> => {
          return group.systems;
        })
        .filter((entry: QueueSystemEntry): boolean => {
          return entry.brokerHealthCharts.length > 0;
        }).length,
    ).toBe(content.systemsWithBrokerHealthCount);

    expect(
      content.alertThresholdGroups.reduce(
        (total: number, group: QueueAlertThresholdGroup): number => {
          return total + group.thresholds.length;
        },
        0,
      ),
    ).toBe(content.alertThresholdCount);

    expect(content.alertThresholdGroups.length).toBe(
      content.systemsWithAlertThresholdsCount,
    );
  });

  test("is plain data a template can render", () => {
    expect(JSON.parse(JSON.stringify(content))).toEqual(content);
  });
});
