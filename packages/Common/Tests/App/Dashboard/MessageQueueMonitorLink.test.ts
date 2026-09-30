import { beforeEach, describe, expect, test } from "@jest/globals";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  MESSAGE_QUEUE_METRIC_MONITOR_DEFAULT_ROLLING_TIME,
  MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM,
  MESSAGE_QUEUE_METRIC_MONITOR_VARIABLE,
  MessageQueueMetricMonitorLink,
  buildMessageQueueMetricMonitorLink,
  buildMessageQueueMetricMonitorRoute,
  getMessageQueueMetricMonitorDescription,
  getMessageQueueMetricMonitorHint,
  getMessageQueueMetricMonitorTitle,
  getMessageQueueMonitorCreateThreshold,
  getMessageQueueRollingTimeAdjective,
  getMessageQueueRollingTimeWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/MessageQueueMetricMonitorLink";
import {
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  buildFormulaConfigsFromSerializedFormulas,
  buildQueryConfigsFromSerializedQueries,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricConfigReconstruct";
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
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import {
  MessageQueueAlertTemplate,
  MessageQueueMetricMonitorSeed,
  buildMessageQueueMetricMonitorQuery,
  getMessageQueueAlertTemplateForMetric,
  getMessageQueueMetricFilterAttributeKeys,
  getMessageQueueMetricMonitorSeed,
  isMessageQueueMetricMonitorable,
} from "../../../Types/Monitor/MessageQueueAlertTemplates";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import MetricExplorerUrl, {
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  toStoredColumns,
} from "../../Types/MessageQueue/MessagingTelemetryFixtures";

/*
 * "Create monitor" beside a queue's broker health gauge. It must build its
 * monitor through the SAME code path the queue alert templates use, from
 * the series the metric was observed with under the queue's key:
 *
 *   - the query is buildMessageQueueMetricMonitorQuery's, fed EVERY observed
 *     series (a partitioned topic has several) and the queue's identity, so
 *     its filters are the exact stored values that name THIS queue — never
 *     another queue's series, never a counter;
 *   - the view is buildMessageQueueMetricMonitorViewConfig's, formulas
 *     included (RabbitMQ's ready + unacknowledged);
 *   - the starting threshold is the metric's template threshold, on the
 *     config that carries the criteria alias, as a warning (or, for a
 *     Critical template, a critical) threshold — and none without a template.
 *     Monitor Create compares "above" where the templates compare "at or
 *     above", so the templates' "any" (1) is seeded as 0;
 *   - the hint states the criteria Monitor Create builds from the link (a
 *     query's threshold, above it, on any point), never the template's: a
 *     threshold on a formula builds none, and a note says what to add;
 *   - the window is the template's (or the link's default), widened to the
 *     source's floor: thirty minutes for CloudWatch, fifteen for Cloud
 *     Monitoring;
 *   - it all travels to Monitor Create in the metric explorer's URL schema,
 *     with "Created from queue <name>." as the description.
 *
 * Every catalog gauge is checked against the realistic stored datapoint the
 * resolver, catalog and template suites share, read back the way the
 * observed-series query returns it (the filter keys only, "" for a key the
 * series lacks).
 */

const QUEUE_NAME: string = "orders";
const MONITOR_CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;

function getter(attributes: FixtureAttributes): (key: string) => unknown {
  return (key: string): unknown => {
    return Object.prototype.hasOwnProperty.call(attributes, key)
      ? attributes[key]
      : undefined;
  };
}

function descriptorOf(
  system: string,
  metricName: string,
): MessageQueueMetricDescriptor {
  const descriptor: MessageQueueMetricDescriptor | undefined =
    getMessageQueueMetricDescriptorsByName(metricName).find(
      (candidate: MessageQueueMetricDescriptor): boolean => {
        return candidate.system === system;
      },
    );
  if (!descriptor) {
    throw new Error(`No catalog entry ${system}:${metricName}`);
  }
  return descriptor;
}

function fixtureOf(descriptor: MessageQueueMetricDescriptor): MetricFixture {
  const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
    (candidate: MetricFixture): boolean => {
      return (
        candidate.metricName === descriptor.metricName &&
        candidate.expected?.system === descriptor.system
      );
    },
  );
  if (!fixture) {
    throw new Error(`No stored datapoint for ${descriptor.metricName}`);
  }
  return fixture;
}

// A series as the observed-series query returns it: the filter keys only.
function observed(
  descriptor: MessageQueueMetricDescriptor,
  attributes: FixtureAttributes,
): Record<string, string> {
  return toStoredColumns(
    attributes,
    getMessageQueueMetricFilterAttributeKeys(descriptor),
  );
}

// The queue a stored datapoint belongs to, as ingest resolves it.
function identityOf(
  descriptor: MessageQueueMetricDescriptor,
  attributes: FixtureAttributes,
): MessageQueueIdentity {
  const resolved: ResolvedMessagingDestination | null =
    resolveMessagingMetricDatapoint({
      metricName: descriptor.metricName,
      getAttribute: getter(attributes),
    });
  const identity: MessageQueueIdentity | null = resolved
    ? toMessageQueueIdentity({
        system: resolved.system,
        brokerScope: resolved.brokerScope,
        destination: resolved.destination,
      })
    : null;
  if (!identity) {
    throw new Error(`${descriptor.metricName} resolves to no queue`);
  }
  return identity;
}

function linkFor(
  descriptor: MessageQueueMetricDescriptor,
  attributes: FixtureAttributes,
): MessageQueueMetricMonitorLink | null {
  return buildMessageQueueMetricMonitorLink({
    descriptor: descriptor,
    observedSeries: [observed(descriptor, attributes)],
    identity: identityOf(descriptor, attributes),
    queueName: QUEUE_NAME,
  });
}

function searchOf(link: MessageQueueMetricMonitorLink): URLSearchParams {
  const [, search] = link.route.toString().split("?");
  return new URLSearchParams(search || "");
}

function seededQueries(
  link: MessageQueueMetricMonitorLink,
): Array<SerializedMetricQuery> {
  return MetricExplorerUrl.parseMetricQueriesParam(
    searchOf(link).get("metricQueries") || "",
  );
}

function seededFormulas(
  link: MessageQueueMetricMonitorLink,
): Array<SerializedMetricFormula> {
  const raw: string | null = searchOf(link).get("metricFormulas");
  return raw ? MetricExplorerUrl.parseMetricFormulasParam(raw) : [];
}

// The window's length, which Monitor Create reads back as the rolling time.
function windowMinutes(link: MessageQueueMetricMonitorLink): number {
  const search: URLSearchParams = searchOf(link);
  const start: number = new Date(search.get("startTime") || "").getTime();
  const end: number = new Date(search.get("endTime") || "").getTime();
  return Math.round((end - start) / 60000);
}

const ROLLING_TIME_MINUTES: Record<string, number> = {
  [RollingTime.Past5Minutes]: 5,
  [RollingTime.Past10Minutes]: 10,
  [RollingTime.Past15Minutes]: 15,
  [RollingTime.Past30Minutes]: 30,
};

const SOURCE_FLOOR_MINUTES: Record<string, number> = {
  aws_cloudwatch: 30,
  googlecloudmonitoring: 15,
};

const GAUGES: Array<[string, MessageQueueMetricDescriptor]> =
  MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.kind === "gauge";
    },
  ).map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): [string, MessageQueueMetricDescriptor] => {
      return [getMessageQueueMetricId(descriptor), descriptor];
    },
  );

const COUNTERS: Array<[string, MessageQueueMetricDescriptor]> =
  MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return descriptor.kind === "counter";
    },
  ).map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): [string, MessageQueueMetricDescriptor] => {
      return [getMessageQueueMetricId(descriptor), descriptor];
    },
  );

beforeEach(() => {
  // Route population reads the project from the page's own URL.
  goTo(`/dashboard/${PROJECT_ID}/queues/${PROJECT_ID}`);
});

describe("Create monitor on every broker health gauge", () => {
  test("the catalog has gauges and counters to check", () => {
    expect(GAUGES.length).toBeGreaterThan(40);
    expect(COUNTERS.length).toBeGreaterThan(10);
  });

  test.each(GAUGES)(
    "%s: the templates' query, the exact stored filters, Monitor Create's URL",
    (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      expect(isMessageQueueMetricMonitorable(descriptor)).toBe(true);
      const fixture: MetricFixture = fixtureOf(descriptor);
      const series: Record<string, string> = observed(
        descriptor,
        fixture.attributes,
      );
      const identity: MessageQueueIdentity = identityOf(
        descriptor,
        fixture.attributes,
      );
      const link: MessageQueueMetricMonitorLink | null =
        buildMessageQueueMetricMonitorLink({
          descriptor: descriptor,
          observedSeries: [series],
          identity: identity,
          queueName: QUEUE_NAME,
        });

      expect(link).not.toBeNull();

      // The very query the alert templates build from the same series.
      expect(link!.query).toEqual(
        buildMessageQueueMetricMonitorQuery({
          descriptor: descriptor,
          observedSeries: [series],
          identity: identity,
        }),
      );

      // Every filter value is the series' stored value, casing and all.
      for (const [key, value] of Object.entries(link!.query.attributes)) {
        expect(value).toBe(series[key]);
      }

      expect(link!.route.toString().startsWith(`${MONITOR_CREATE_PATH}?`)).toBe(
        true,
      );
      expect(
        searchOf(link!).get(MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM),
      ).toBe("Created from queue orders.");

      // Monitor Create rebuilds exactly the view the link built.
      const queries: Array<MetricQueryConfigData> =
        buildQueryConfigsFromSerializedQueries(seededQueries(link!));
      const formulas: Array<MetricFormulaConfigData> =
        buildFormulaConfigsFromSerializedFormulas(
          seededFormulas(link!),
          queries.length,
        );
      expect(queries).toHaveLength(link!.viewData.queryConfigs.length);
      expect(formulas).toHaveLength(link!.viewData.formulaConfigs.length);

      const seed: MessageQueueMetricMonitorSeed =
        getMessageQueueMetricMonitorSeed(descriptor)!;
      for (const query of queries) {
        expect(query.metricQueryData.filterData.metricName).toBe(
          descriptor.metricName,
        );
        expect(query.metricQueryData.filterData.aggegationType).toBe(
          seed.aggregationType,
        );
        expect(query.metricQueryData.groupByAttributeKeys || []).toEqual(
          seed.groupByAttributeKeys,
        );
        // Each query carries the queue's filters (a total part adds its value).
        const filters: Record<string, unknown> = query.metricQueryData
          .filterData.attributes as Record<string, unknown>;
        for (const key of Object.keys(link!.query.attributes)) {
          expect(filters[key]).toEqual(link!.query.attributes[key]);
        }
        expect(query.metricAliasData?.legendUnit).toBe(descriptor.unit);
      }

      // The criteria alias is the formula's when there is one, else the query's.
      expect(link!.criteriaAlias).toBe(MESSAGE_QUEUE_METRIC_MONITOR_VARIABLE);
      const aliasOwners: Array<{
        variable: string;
        warningThreshold?: number | undefined;
        criticalThreshold?: number | undefined;
      }> = [
        ...queries.map(
          (
            query: MetricQueryConfigData,
          ): {
            variable: string;
            warningThreshold?: number | undefined;
            criticalThreshold?: number | undefined;
          } => {
            return {
              variable: query.metricAliasData?.metricVariable || "",
              warningThreshold: query.warningThreshold,
              criticalThreshold: query.criticalThreshold,
            };
          },
        ),
        ...formulas.map(
          (
            formula: MetricFormulaConfigData,
          ): {
            variable: string;
            warningThreshold?: number | undefined;
            criticalThreshold?: number | undefined;
          } => {
            return {
              variable: formula.metricAliasData.metricVariable || "",
              warningThreshold: formula.warningThreshold,
              criticalThreshold: formula.criticalThreshold,
            };
          },
        ),
      ];
      const criteriaOwner: {
        variable: string;
        warningThreshold?: number | undefined;
        criticalThreshold?: number | undefined;
      } = aliasOwners.find((owner: { variable: string }): boolean => {
        return owner.variable === link!.criteriaAlias;
      })!;
      expect(criteriaOwner).toBeDefined();

      const template: MessageQueueAlertTemplate | undefined =
        getMessageQueueAlertTemplateForMetric(descriptor);
      if (template) {
        // The template's threshold as Monitor Create's "above" reads it.
        const seeded: number = getMessageQueueMonitorCreateThreshold(template);
        expect(seeded).toBe(template.threshold === 1 ? 0 : template.threshold);
        expect(link!.threshold).toBe(seeded);
        expect(link!.thresholdSeverity).toBe(template.severity);
        if (template.severity === "Critical") {
          expect(criteriaOwner.criticalThreshold).toBe(seeded);
          expect(criteriaOwner.warningThreshold).toBeUndefined();
        } else {
          expect(criteriaOwner.warningThreshold).toBe(seeded);
          expect(criteriaOwner.criticalThreshold).toBeUndefined();
        }
        /*
         * Monitor Create reads the threshold on the query or on a series
         * total's formula alike, so a criteria is always promised.
         */
        expect(link!.criteria).toEqual({
          severity: template.severity,
          alias: link!.criteriaAlias,
          filterType: FilterType.GreaterThan,
          evaluation: EvaluateOverTimeType.AnyValue,
          value: seeded,
          valueLabel: link!.thresholdLabel,
        });
      } else {
        expect(link!.threshold).toBeNull();
        expect(link!.thresholdLabel).toBeNull();
        expect(link!.criteria).toBeNull();
        expect(criteriaOwner.warningThreshold).toBeUndefined();
        expect(criteriaOwner.criticalThreshold).toBeUndefined();
      }

      // The hint says what Monitor Create builds, and nothing else.
      const hint: string = getMessageQueueMetricMonitorHint(link!);
      if (link!.criteria) {
        expect(hint).toBe(
          `${link!.criteria.severity} when any point in the last ${getMessageQueueRollingTimeWords(
            link!.rollingTime,
          )} is above ${link!.criteria.valueLabel}`,
        );
      } else {
        expect(hint).toBe(
          `No starting threshold · ${getMessageQueueRollingTimeAdjective(
            link!.rollingTime,
          )} window`,
        );
      }
      // Only the criteria alias carries a threshold.
      for (const owner of aliasOwners) {
        if (owner.variable !== link!.criteriaAlias) {
          expect(owner.warningThreshold).toBeUndefined();
          expect(owner.criticalThreshold).toBeUndefined();
        }
      }

      // The window: the template's (or the default), never under the floor.
      const preferred: number =
        ROLLING_TIME_MINUTES[
          template
            ? template.rollingTime
            : MESSAGE_QUEUE_METRIC_MONITOR_DEFAULT_ROLLING_TIME
        ]!;
      const floor: number = SOURCE_FLOOR_MINUTES[descriptor.receiver] || 0;
      expect(windowMinutes(link!)).toBe(Math.max(preferred, floor));
      expect(ROLLING_TIME_MINUTES[link!.rollingTime]).toBe(
        Math.max(preferred, floor),
      );
      expect(link!.windowFloor !== null).toBe(floor > 0);

      // The note is the seed's: what the monitor reads that the chart does not.
      expect(link!.note).toBe(seed.note);
    },
  );

  test.each(COUNTERS)(
    "%s: a counter gets no monitor, whatever was observed",
    (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const fixture: MetricFixture = fixtureOf(descriptor);
      expect(linkFor(descriptor, fixture.attributes)).toBeNull();
    },
  );
});

describe("the queue a monitor watches", () => {
  const LAG: MessageQueueMetricDescriptor = descriptorOf(
    "kafka",
    "kafka.consumer_group.lag_sum",
  );

  test("only the series of this queue are used; another topic's are left out", () => {
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: LAG,
        observedSeries: [{ topic: "orders" }, { topic: "payments" }],
        identity: parseMessageQueueIdentifier("kafka||orders"),
        queueName: QUEUE_NAME,
      });

    expect(link!.query.attributes).toEqual({ topic: "orders" });
  });

  test("only another queue's series: no monitor at all", () => {
    expect(
      buildMessageQueueMetricMonitorLink({
        descriptor: LAG,
        observedSeries: [{ topic: "payments" }],
        identity: parseMessageQueueIdentifier("kafka||orders"),
        queueName: QUEUE_NAME,
      }),
    ).toBeNull();
  });

  test("no observed series: no monitor", () => {
    expect(
      buildMessageQueueMetricMonitorLink({
        descriptor: LAG,
        observedSeries: [],
        identity: parseMessageQueueIdentifier("kafka||orders"),
      }),
    ).toBeNull();
  });

  test("an identity that does not parse builds nothing, rather than taking the first series", () => {
    expect(
      buildMessageQueueMetricMonitorLink({
        descriptor: LAG,
        observedSeries: [{ topic: "orders" }],
        identity: parseMessageQueueIdentifier("not-an-identifier"),
      }),
    ).toBeNull();
    expect(
      buildMessageQueueMetricMonitorLink({
        descriptor: LAG,
        observedSeries: [{ topic: "orders" }],
        identity: null,
      }),
    ).toBeNull();
  });

  test("a stored 'Orders' is filtered as 'Orders', though the identity is lowercase", () => {
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: LAG,
        observedSeries: [{ topic: "Orders" }],
        identity: parseMessageQueueIdentifier("kafka||orders"),
      });

    expect(link!.query.attributes).toEqual({ topic: "Orders" });
  });

  test("a partitioned Pulsar topic: every partition's topic, as an Includes", () => {
    const backlog: MessageQueueMetricDescriptor = descriptorOf(
      "pulsar",
      "pulsar_msg_backlog",
    );
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: backlog,
        observedSeries: [
          { topic: "persistent://public/default/orders-partition-1" },
          { topic: "persistent://public/default/orders-partition-0" },
          { topic: "persistent://public/default/payments-partition-0" },
        ],
        identity: parseMessageQueueIdentifier(
          "pulsar||persistent://public/default/orders",
        ),
      });

    const topic: unknown = link!.query.attributes["topic"];
    expect(topic).toBeInstanceOf(Includes);
    expect((topic as Includes).values).toEqual([
      "persistent://public/default/orders-partition-0",
      "persistent://public/default/orders-partition-1",
    ]);

    // The Includes survives the URL: Monitor Create filters on both.
    const rebuilt: Array<MetricQueryConfigData> =
      buildQueryConfigsFromSerializedQueries(seededQueries(link!));
    const filter: unknown = (
      rebuilt[0]!.metricQueryData.filterData.attributes as Record<
        string,
        unknown
      >
    )["topic"];
    expect(filter).toBeInstanceOf(Includes);
    expect((filter as Includes).values).toEqual([
      "persistent://public/default/orders-partition-0",
      "persistent://public/default/orders-partition-1",
    ]);
    // Per partition: the threshold is one partition's, and the note says so.
    expect(link!.query.groupByAttributeKeys).toEqual([
      "cluster",
      "topic",
      "partition",
    ]);
    expect(link!.note).toContain("alerts on each series separately");
  });

  test("a Service Bus queue pins its namespace and resource type as stored", () => {
    const active: MessageQueueMetricDescriptor = descriptorOf(
      "servicebus",
      "azure_activemessages_average",
    );
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: active,
        observedSeries: [
          {
            metadata_entityname: "orders",
            metadata_EntityName: "",
            name: "orders-prod",
            type: "Microsoft.ServiceBus/Namespaces",
          },
          // The same entity name in another namespace: another queue.
          {
            metadata_entityname: "orders",
            metadata_EntityName: "",
            name: "orders-staging",
            type: "Microsoft.ServiceBus/Namespaces",
          },
        ],
        identity: parseMessageQueueIdentifier("servicebus|orders-prod|orders"),
      });

    expect(link!.query.attributes).toEqual({
      metadata_entityname: "orders",
      name: "orders-prod",
      type: "Microsoft.ServiceBus/Namespaces",
    });
  });

  test("an Event Hubs series never builds a Service Bus monitor", () => {
    const active: MessageQueueMetricDescriptor = descriptorOf(
      "servicebus",
      "azure_incomingmessages_total",
    );
    expect(
      buildMessageQueueMetricMonitorLink({
        descriptor: active,
        observedSeries: [
          {
            metadata_entityname: "telemetry",
            metadata_EntityName: "",
            name: "ingest-prod",
            type: "Microsoft.EventHub/Namespaces",
          },
        ],
        identity: parseMessageQueueIdentifier(
          "servicebus|ingest-prod|telemetry",
        ),
      }),
    ).toBeNull();
  });

  test("an ActiveMQ queue is matched on its JMS family identity", () => {
    const size: MessageQueueMetricDescriptor = descriptorOf(
      "activemq",
      "activemq.message.queue.size",
    );
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: size,
        observedSeries: [{ "messaging.destination.name": "orders" }],
        identity: parseMessageQueueIdentifier("jms||orders"),
      });

    expect(link!.query.attributes).toEqual({
      "messaging.destination.name": "orders",
    });
    expect(link!.threshold).toBe(1000);
  });
});

describe("what the monitor starts with", () => {
  test("RabbitMQ's queue depth: one query per state and the formula adding them, the threshold on the formula", () => {
    const depth: MessageQueueMetricDescriptor = descriptorOf(
      "rabbitmq",
      "rabbitmq.message.current",
    );
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: depth,
        observedSeries: [{ "resource.rabbitmq.queue.name": "orders" }],
        identity: parseMessageQueueIdentifier("rabbitmq||orders"),
        queueName: QUEUE_NAME,
      });

    const queries: Array<SerializedMetricQuery> = seededQueries(link!);
    expect(
      queries.map((query: SerializedMetricQuery): unknown => {
        return {
          variable: query.variable,
          attributes: query.attributes,
          warningThreshold: query.warningThreshold,
        };
      }),
    ).toEqual([
      {
        variable: "a_ready",
        attributes: {
          "resource.rabbitmq.queue.name": "orders",
          state: "ready",
        },
        warningThreshold: undefined,
      },
      {
        variable: "a_unacknowledged",
        attributes: {
          "resource.rabbitmq.queue.name": "orders",
          state: "unacknowledged",
        },
        warningThreshold: undefined,
      },
    ]);

    const formulas: Array<SerializedMetricFormula> = seededFormulas(link!);
    expect(formulas).toHaveLength(1);
    expect(formulas[0]).toEqual(
      expect.objectContaining({
        formula: "a_ready + a_unacknowledged",
        variable: "a",
        warningThreshold: 1000,
      }),
    );
    expect(link!.criteriaAlias).toBe("a");
    /*
     * Monitor Create turns the formula's threshold into a criteria on its
     * alias, so the hint promises the Warning the page builds.
     */
    expect(link!.criteria).toEqual({
      severity: "Warning",
      alias: "a",
      filterType: FilterType.GreaterThan,
      evaluation: EvaluateOverTimeType.AnyValue,
      value: 1000,
      valueLabel: link!.thresholdLabel,
    });
    expect(getMessageQueueMetricMonitorHint(link!)).toBe(
      "Warning when any point in the last 10 minutes is above 1,000 messages",
    );
  });

  test("SQS messages in flight: a critical threshold near the quota, over thirty minutes", () => {
    const inFlight: MessageQueueMetricDescriptor = descriptorOf(
      "aws_sqs",
      "amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible",
    );
    const link: MessageQueueMetricMonitorLink | null = linkFor(
      inFlight,
      fixtureOf(inFlight).attributes,
    );

    expect(link!.thresholdSeverity).toBe("Critical");
    expect(seededQueries(link!)[0]).toEqual(
      expect.objectContaining({
        criticalThreshold: 108000,
      }),
    );
    expect(seededQueries(link!)[0]!.warningThreshold).toBeUndefined();
    // The template's five minutes, widened to CloudWatch's floor.
    expect(link!.rollingTime).toBe(RollingTime.Past30Minutes);
    expect(windowMinutes(link!)).toBe(30);
    expect(link!.windowFloor!.receiver).toBe("aws_cloudwatch");
    expect(getMessageQueueMetricMonitorHint(link!)).toBe(
      "Critical when any point in the last 30 minutes is above 108,000 messages",
    );
  });

  test.each([
    ["servicebus", "azure_deadletteredmessages_average", "5 minutes"],
    [
      "gcp_pubsub",
      "pubsub.googleapis.com/subscription/dead_letter_message_count",
      "15 minutes",
    ],
    [
      "aws.sns",
      "amazonaws.com/aws/sns/numberofnotificationsredriventodlq",
      "30 minutes",
    ],
  ])(
    "%s %s: one dead-lettered message fires, so the template's 'any' is seeded as above 0",
    (system: string, metricName: string, window: string) => {
      const deadLetters: MessageQueueMetricDescriptor = descriptorOf(
        system,
        metricName,
      );
      const template: MessageQueueAlertTemplate =
        getMessageQueueAlertTemplateForMetric(deadLetters)!;
      // The template: at or above one message.
      expect(template.threshold).toBe(1);
      expect(template.filterType).toBe(FilterType.GreaterThanOrEqualTo);

      const link: MessageQueueMetricMonitorLink | null = linkFor(
        deadLetters,
        fixtureOf(deadLetters).attributes,
      );

      expect(link!.threshold).toBe(0);
      expect(link!.criteria).toEqual(
        expect.objectContaining({
          filterType: FilterType.GreaterThan,
          value: 0,
        }),
      );
      // A dead-letter queue holding exactly one message is above 0.
      expect(1 > link!.criteria!.value).toBe(true);
      expect(seededQueries(link!)[0]!.warningThreshold).toBe(0);
      expect(getMessageQueueMetricMonitorHint(link!)).toBe(
        `Warning when any point in the last ${window} is above 0 messages`,
      );
    },
  );

  test("the threshold Monitor Create's 'above' is seeded with", () => {
    expect(
      getMessageQueueMonitorCreateThreshold({
        threshold: 1,
        filterType: FilterType.GreaterThanOrEqualTo,
      }),
    ).toBe(0);
    expect(
      getMessageQueueMonitorCreateThreshold({
        threshold: 1000,
        filterType: FilterType.GreaterThanOrEqualTo,
      }),
    ).toBe(1000);
    // A template that already compares "above" is seeded as it is.
    expect(
      getMessageQueueMonitorCreateThreshold({
        threshold: 1,
        filterType: FilterType.GreaterThan,
      }),
    ).toBe(1);
  });

  test("the same metric from a JSON Metric Stream arrives live: its own window", () => {
    const inFlight: MessageQueueMetricDescriptor = descriptorOf(
      "aws_sqs",
      "approximatenumberofmessagesnotvisible",
    );
    const link: MessageQueueMetricMonitorLink | null = linkFor(
      inFlight,
      fixtureOf(inFlight).attributes,
    );

    expect(link!.rollingTime).toBe(RollingTime.Past5Minutes);
    expect(link!.windowFloor).toBeNull();
  });

  test("an untemplated gauge starts with no threshold, and a Cloud Monitoring one at fifteen minutes", () => {
    const acks: MessageQueueMetricDescriptor = descriptorOf(
      "gcp_pubsub",
      "pubsub.googleapis.com/subscription/ack_message_count",
    );
    const link: MessageQueueMetricMonitorLink | null = linkFor(
      acks,
      fixtureOf(acks).attributes,
    );

    expect(link!.threshold).toBeNull();
    expect(link!.rollingTime).toBe(RollingTime.Past15Minutes);
    expect(getMessageQueueMetricMonitorHint(link!)).toBe(
      "No starting threshold · 15-minute window",
    );
    for (const query of seededQueries(link!)) {
      expect(query.warningThreshold).toBeUndefined();
      expect(query.criticalThreshold).toBeUndefined();
    }
  });

  test("Kafka's partition lag, left untemplated on purpose, still gets a monitor", () => {
    const partitionLag: MessageQueueMetricDescriptor = descriptorOf(
      "kafka",
      "kafka.consumer_group.lag",
    );
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: partitionLag,
        observedSeries: [{ topic: "orders" }],
        identity: parseMessageQueueIdentifier("kafka||orders"),
      });

    expect(link).not.toBeNull();
    expect(link!.threshold).toBeNull();
    expect(link!.rollingTime).toBe(
      MESSAGE_QUEUE_METRIC_MONITOR_DEFAULT_ROLLING_TIME,
    );
  });

  test("the monitor's query is titled with the queue, and the view has no range token", () => {
    const lag: MessageQueueMetricDescriptor = descriptorOf(
      "kafka",
      "kafka.consumer_group.lag_sum",
    );
    const link: MessageQueueMetricMonitorLink | null =
      buildMessageQueueMetricMonitorLink({
        descriptor: lag,
        observedSeries: [{ topic: "orders" }],
        identity: parseMessageQueueIdentifier("kafka||orders"),
        queueName: "Orders topic",
      });

    expect(seededQueries(link!)[0]!.alias?.title).toBe(
      "Orders topic: Consumer lag",
    );
    expect(searchOf(link!).get("range")).toBeNull();
    expect(
      searchOf(link!).get(MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM),
    ).toBe("Created from queue Orders topic.");
  });
});

describe("MessageQueueMetricMonitorLink helpers", () => {
  test("the description names the queue, or is left out", () => {
    expect(getMessageQueueMetricMonitorDescription("  orders ")).toBe(
      "Created from queue orders.",
    );
    expect(getMessageQueueMetricMonitorDescription("  ")).toBe("");
    expect(getMessageQueueMetricMonitorDescription(null)).toBe("");
  });

  test("the title carries the queue when known", () => {
    expect(
      getMessageQueueMetricMonitorTitle({ title: "Queue depth" }, "orders"),
    ).toBe("orders: Queue depth");
    expect(
      getMessageQueueMetricMonitorTitle({ title: "Queue depth" }, undefined),
    ).toBe("Queue depth");
  });

  test("rolling times read as words", () => {
    expect(getMessageQueueRollingTimeWords(RollingTime.Past5Minutes)).toBe(
      "5 minutes",
    );
    expect(getMessageQueueRollingTimeWords(RollingTime.Past30Minutes)).toBe(
      "30 minutes",
    );
    expect(getMessageQueueRollingTimeAdjective(RollingTime.Past10Minutes)).toBe(
      "10-minute",
    );
    expect(getMessageQueueRollingTimeAdjective(RollingTime.Past1Hour)).toBe(
      "1-hour",
    );
    // "Past 1 Day" is the enum's misnamed Past1Hours.
    expect(getMessageQueueRollingTimeAdjective(RollingTime.Past1Hours)).toBe(
      "1-day",
    );
  });

  test("a route without a description leaves the parameter out", () => {
    const route: string = buildMessageQueueMetricMonitorRoute({
      queryConfigs: [],
      formulaConfigs: [],
      startAndEndDate: null,
    }).toString();

    expect(route).toBe(MONITOR_CREATE_PATH);
  });

  test("the description travels in the parameter Monitor Create reads", () => {
    expect(MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM).toBe(
      "monitorDescription",
    );
    expect(MESSAGE_QUEUE_METRIC_MONITOR_VARIABLE).toBe("a");
  });
});
