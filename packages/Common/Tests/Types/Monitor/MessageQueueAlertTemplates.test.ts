import "../../Server/TestingUtils/Init";
import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import Metric from "../../../Models/AnalyticsModels/Metric";
import { MetricService } from "../../../Server/Services/MetricService";
import AggregateBy from "../../../Server/Types/AnalyticsDatabase/AggregateBy";
import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";
import MetricMonitorCriteria, {
  MetricSeriesEvaluationResult,
} from "../../../Server/Utils/Monitor/Criteria/MetricMonitorCriteria";
import AggregateModel from "../../../Types/BaseDatabase/AggregatedModel";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricFormulaConfigData from "../../../Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MetricSeriesResult from "../../../Types/Monitor/MetricMonitor/MetricSeriesResult";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import {
  MESSAGE_QUEUE_ALERT_POLICIES,
  MESSAGE_QUEUE_ALERT_POLICY_OVERRIDES,
  MESSAGE_QUEUE_SERIES_TOTALS,
  MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS,
  MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS,
  MessageQueueAlertPolicy,
  MessageQueueAlertPolicyDefault,
  MessageQueueAlertPolicyOverride,
  MessageQueueAlertTemplate,
  MessageQueueAlertTemplateArgs,
  MessageQueueAlertTemplateCategory,
  MessageQueueAlertTemplateSeverity,
  MessageQueueMetricMonitorQuery,
  MessageQueueMetricMonitorSeed,
  MessageQueueMetricMonitorViewConfig,
  MessageQueueObservedAttributes,
  MessageQueueSeriesTotal,
  MessageQueueSeriesTotalDefinition,
  MessageQueueSourceWindowFloor,
  UNALERTABLE_MESSAGE_QUEUE_COUNTERS,
  UNTEMPLATED_MESSAGE_QUEUE_GAUGES,
  buildMessageQueueMetricMonitorQuery,
  buildMessageQueueMetricMonitorViewConfig,
  formatMessageQueueThreshold,
  getAllMessageQueueAlertTemplates,
  getMessageQueueAlertMeasure,
  getMessageQueueAlertPolicy,
  getMessageQueueAlertTemplateById,
  getMessageQueueAlertTemplateForMetric,
  getMessageQueueAlertTemplates,
  getMessageQueueMetricFilterAttributeKeys,
  getMessageQueueMetricMonitorRollingTime,
  getMessageQueueMetricMonitorSeed,
  getMessageQueueSourceWindowFloor,
  getMessageQueueSystemsWithAlertTemplates,
  isMessageQueueMetricMonitorable,
} from "../../../Types/Monitor/MessageQueueAlertTemplates";
import {
  MESSAGE_QUEUE_METRICS,
  MessageQueueMetricDescriptor,
  MessageQueueSignal,
  getMessageQueueMetricDescriptorsByName,
  getMessageQueueMetricId,
} from "../../../Types/MessageQueue/MessageQueueMetricCatalog";
import {
  getMessagingBrokerMetricsReceivers,
  getMessagingSystemDescriptor,
  MessagingSystemDescriptor,
} from "../../../Types/MessageQueue/MessagingSystem";
import {
  MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
  ResolvedMessagingDestination,
  resolveMessagingMetricDatapoint,
} from "../../../Types/MessageQueue/MessagingTelemetryResolver";
import {
  MessageQueueIdentity,
  buildMessageQueueIdentifier,
  parseMessageQueueIdentifier,
  toMessageQueueIdentity,
} from "../../../Types/MessageQueue/MessageQueueIdentity";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricViewConfigUtil from "../../../Types/Monitor/MonitorStepMetricViewConfigUtil";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import RollingTimeUtil from "../../../Types/RollingTime/RollingTimeUtil";
import MetricExplorerUrl, {
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "../../../Utils/Metrics/MetricExplorerUrl";
import MetricFormulaEvaluator from "../../../Utils/Metrics/MetricFormulaEvaluator";
import MetricResultUnitConverter from "../../../Utils/Metrics/MetricResultUnitConverter";
import {
  FixtureAttributes,
  METRIC_FIXTURES,
  MetricFixture,
  toStoredColumns,
} from "../MessageQueue/MessagingTelemetryFixtures";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The queue alert library is how a Queue gets a monitor without a person
 * hand-building a Metrics monitor on a broker metric they have to find,
 * filter and threshold themselves. Everything that can go wrong with it is
 * silent:
 *
 *   - a filter that does not match the stored values exactly (a lowercased
 *     "orders" against a stored "Orders", `metadata_EntityName` against
 *     `metadata_entityname`) watches nothing;
 *   - a filter that pins too little (no Azure namespace, no resource type)
 *     watches another queue too, and one that pins a series key (RabbitMQ's
 *     `state`) watches half of this one;
 *   - a counter thresholded raw fires once and never clears;
 *   - a total across series folded by the wrong aggregation compares six
 *     times the queue's depth, or half of it — and one alerted per series
 *     never sees a total that no single series reaches;
 *   - a CloudWatch count folded by Max reads CloudWatch's Average (the
 *     engine's Max of a Summary point is its mean), 1 for a failure count;
 *   - a window shorter than a late source's lag never holds a point, so a
 *     level never fires and a count reports healthy;
 *   - a count that goes quiet between events holds the monitor offline
 *     forever unless its recovery reads a silent window as zero.
 *
 * So this suite pins the whole library in one table, proves every template
 * reads a catalog GAUGE through the very query builder the queue page's
 * "Create monitor" link uses, builds that query from the realistic stored
 * datapoints the resolver suites use, EVALUATES the templates against
 * broker-shaped rows through a port of the metric engine's own folds (pinned
 * to the SQL it generates, and to a real ClickHouse on request) and the real
 * metric criteria evaluator, and replays the late receivers' fetch windows
 * against the telemetry worker's evaluations.
 */

// --- fixtures and helpers -------------------------------------------------

const ALL_TEMPLATES: Array<MessageQueueAlertTemplate> =
  getAllMessageQueueAlertTemplates();

const TEMPLATE_CASES: Array<[string, MessageQueueAlertTemplate]> =
  ALL_TEMPLATES.map(
    (
      template: MessageQueueAlertTemplate,
    ): [string, MessageQueueAlertTemplate] => {
      return [template.id, template];
    },
  );

function getTemplate(id: string): MessageQueueAlertTemplate {
  const template: MessageQueueAlertTemplate | undefined =
    getMessageQueueAlertTemplateById(id);

  if (!template) {
    throw new Error(`No message queue alert template ${id}`);
  }

  return template;
}

function getDescriptor(
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

function descriptorOf(
  template: MessageQueueAlertTemplate,
): MessageQueueMetricDescriptor {
  return getDescriptor(template.system, template.metricName);
}

/*
 * The realistic stored datapoint of a template's metric, from the corpus the
 * resolver, catalog and entity-key suites share.
 */
function fixtureFor(template: MessageQueueAlertTemplate): MetricFixture {
  const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
    (candidate: MetricFixture): boolean => {
      return (
        candidate.metricName === template.metricName &&
        candidate.expected?.system === template.system
      );
    },
  );

  if (!fixture) {
    throw new Error(`No stored datapoint fixture for ${template.id}`);
  }

  return fixture;
}

function buildArgs(
  observedSeries: ReadonlyArray<MessageQueueObservedAttributes>,
  overrides?: Partial<MessageQueueAlertTemplateArgs>,
): MessageQueueAlertTemplateArgs {
  return {
    observedSeries: observedSeries,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Queue orders",
    ...overrides,
  };
}

function argsFor(
  template: MessageQueueAlertTemplate,
): MessageQueueAlertTemplateArgs {
  return buildArgs([fixtureFor(template).attributes]);
}

function stepFor(
  template: MessageQueueAlertTemplate,
  args?: MessageQueueAlertTemplateArgs,
): MonitorStep {
  const step: MonitorStep | null = template.getMonitorStep(
    args || argsFor(template),
  );

  if (!step) {
    throw new Error(`${template.id} built no monitor step`);
  }

  return step;
}

function getViewConfig(step: MonitorStep): MetricsViewConfig {
  const viewConfig: MetricsViewConfig | undefined =
    step.data?.metricMonitor?.metricViewConfig;

  if (!viewConfig) {
    throw new Error("The template built no metric monitor config");
  }

  return viewConfig;
}

function onlyQuery(step: MonitorStep): MetricQueryConfigData {
  const queryConfigs: Array<MetricQueryConfigData> =
    getViewConfig(step).queryConfigs;

  expect(queryConfigs).toHaveLength(1);

  return queryConfigs[0]!;
}

function filterAttributes(
  queryConfig: MetricQueryConfigData,
): Record<string, unknown> {
  return (queryConfig.metricQueryData.filterData.attributes || {}) as Record<
    string,
    unknown
  >;
}

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function getUnhealthy(step: MonitorStep): MonitorCriteriaInstance {
  return getCriteriaInstances(step).find(
    (instance: MonitorCriteriaInstance): boolean => {
      return Boolean(instance.data?.createIncidents);
    },
  )!;
}

function getHealthy(step: MonitorStep): MonitorCriteriaInstance {
  return getCriteriaInstances(step).find(
    (instance: MonitorCriteriaInstance): boolean => {
      return !instance.data?.createIncidents;
    },
  )!;
}

function isCatalogGauge(descriptor: MessageQueueMetricDescriptor): boolean {
  return descriptor.kind === "gauge";
}

function isThresholdable(signal: MessageQueueSignal): boolean {
  return MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS.includes(signal);
}

function queryFor(
  descriptor: MessageQueueMetricDescriptor,
  observedSeries: ReadonlyArray<MessageQueueObservedAttributes>,
  identity?: MessageQueueIdentity | null,
): MessageQueueMetricMonitorQuery | null {
  return buildMessageQueueMetricMonitorQuery({
    descriptor: descriptor,
    observedSeries: observedSeries,
    identity: identity,
  });
}

// The canonical identifier of the queue a stored series resolves to.
function resolvedIdentifier(
  metricName: string,
  attributes: Record<string, unknown>,
): string | null {
  const resolved: ResolvedMessagingDestination | null =
    resolveMessagingMetricDatapoint({
      metricName: metricName,
      getAttribute: (key: string): unknown => {
        return Object.prototype.hasOwnProperty.call(attributes, key)
          ? attributes[key]
          : undefined;
      },
    });

  if (!resolved) {
    return null;
  }

  const identity: MessageQueueIdentity | null = toMessageQueueIdentity({
    system: resolved.system,
    brokerScope: resolved.brokerScope,
    destination: resolved.destination,
  });

  return identity ? buildMessageQueueIdentifier(identity) : null;
}

function includesValues(value: unknown): Array<string> {
  expect(value).toBeInstanceOf(Includes);
  return ((value as Includes).values as Array<string>).map(
    (item: string): string => {
      return String(item);
    },
  );
}

// How long a window is, as the telemetry worker computes it.
function rollingTimeSeconds(rollingTime: RollingTime): number {
  const window: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(rollingTime);

  return (window.endValue.getTime() - window.startValue.getTime()) / 1000;
}

// How a template description names a widened window.
function rollingTimeWords(rollingTime: RollingTime): string {
  const words: Record<string, string> = {
    [RollingTime.Past15Minutes]: "fifteen-minute window",
    [RollingTime.Past30Minutes]: "thirty-minute window",
  };

  return words[rollingTime] || rollingTime;
}

function queryConfigsOf(step: MonitorStep): Array<MetricQueryConfigData> {
  return getViewConfig(step).queryConfigs;
}

function formulaConfigsOf(step: MonitorStep): Array<MetricFormulaConfigData> {
  return getViewConfig(step).formulaConfigs || [];
}

// The closed series set declared for a catalog entry, if any.
function seriesTotalDefinitionOf(
  descriptor: MessageQueueMetricDescriptor,
): MessageQueueSeriesTotalDefinition | undefined {
  return MESSAGE_QUEUE_SERIES_TOTALS.find(
    (definition: MessageQueueSeriesTotalDefinition): boolean => {
      return (
        definition.system === descriptor.system &&
        definition.metricName === descriptor.metricName
      );
    },
  );
}

// The alias the template's criteria compare: a formula's, or the query's.
function criteriaAliasOf(step: MonitorStep): string {
  return (
    getUnhealthy(step).data!.filters[0]!.metricMonitorOptions?.metricAlias || ""
  );
}

const SERVICE_BUS_ORDERS: FixtureAttributes = {
  "resource.azuremonitor.subscription_id":
    "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b",
  "azuremonitor.resource_id":
    "/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.ServiceBus/namespaces/orders-prod",
  name: "orders-prod",
  type: "Microsoft.ServiceBus/Namespaces",
  resource_group: "rg-prod",
  location: "westeurope",
  metadata_entityname: "orders",
};

const EVENT_HUBS_TELEMETRY: FixtureAttributes = {
  "azuremonitor.resource_id":
    "/subscriptions/7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b/resourceGroups/rg-prod/providers/Microsoft.EventHub/namespaces/ingest-prod",
  name: "ingest-prod",
  type: "Microsoft.EventHub/namespaces",
  metadata_entityname: "telemetry",
  metadata_operationresult: "serverbusy",
};

function pulsarPartition(topic: string, partition: number): FixtureAttributes {
  return {
    "resource.server.address": "pulsar-broker-0",
    "resource.server.port": "8080",
    "resource.service.name": "pulsar-broker",
    cluster: "standalone",
    namespace: "public/default",
    topic: `persistent://public/default/${topic}-partition-${partition}`,
  };
}

// --- the whole library, pinned ------------------------------------------------

interface ExpectedTemplate {
  id: string;
  system: string;
  metricName: string;
  name: string;
  category: MessageQueueAlertTemplateCategory;
  severity: MessageQueueAlertTemplateSeverity;
  threshold: number;
  thresholdLabel: string;
  evaluation: EvaluateOverTimeType;
  rollingTime: RollingTime;
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys: Array<string>;
  seriesTotal: MessageQueueSeriesTotal | null;
  recoverOnNoData: boolean;
}

type ExpectedPolicy = Pick<
  ExpectedTemplate,
  | "category"
  | "severity"
  | "threshold"
  | "thresholdLabel"
  | "evaluation"
  | "rollingTime"
  | "recoverOnNoData"
>;

const BACKLOG: ExpectedPolicy = {
  category: "Backlog",
  severity: "Warning",
  threshold: 1000,
  thresholdLabel: "at or above 1,000 messages",
  evaluation: EvaluateOverTimeType.AllValues,
  rollingTime: RollingTime.Past10Minutes,
  recoverOnNoData: false,
};

const CONSUMER_LAG: ExpectedPolicy = {
  category: "Consumer Lag",
  severity: "Warning",
  threshold: 10000,
  thresholdLabel: "at or above 10,000 messages",
  evaluation: EvaluateOverTimeType.AllValues,
  rollingTime: RollingTime.Past10Minutes,
  recoverOnNoData: false,
};

const MESSAGE_AGE: ExpectedPolicy = {
  category: "Message Age",
  severity: "Warning",
  threshold: 600,
  thresholdLabel: "at or above 10 minutes",
  evaluation: EvaluateOverTimeType.AllValues,
  rollingTime: RollingTime.Past5Minutes,
  recoverOnNoData: false,
};

const DEAD_LETTERS_WAITING: ExpectedPolicy = {
  category: "Dead Letters",
  severity: "Warning",
  threshold: 1,
  thresholdLabel: "at or above 1 message",
  evaluation: EvaluateOverTimeType.AllValues,
  rollingTime: RollingTime.Past5Minutes,
  recoverOnNoData: false,
};

const DEAD_LETTERS_COUNTED: ExpectedPolicy = {
  category: "Dead Letters",
  severity: "Warning",
  threshold: 1,
  thresholdLabel: "at or above 1 message",
  evaluation: EvaluateOverTimeType.AnyValue,
  rollingTime: RollingTime.Past5Minutes,
  recoverOnNoData: true,
};

const FAILED_REQUESTS: ExpectedPolicy = {
  category: "Errors",
  severity: "Warning",
  threshold: 10,
  thresholdLabel: "at or above 10 requests",
  evaluation: EvaluateOverTimeType.AnyValue,
  rollingTime: RollingTime.Past5Minutes,
  recoverOnNoData: true,
};

const FAILED_MESSAGES: ExpectedPolicy = {
  ...FAILED_REQUESTS,
  thresholdLabel: "at or above 10 messages",
};

const THROTTLED: ExpectedPolicy = {
  ...FAILED_REQUESTS,
  category: "Throttling",
};

const IN_FLIGHT_NEAR_QUOTA: ExpectedPolicy = {
  category: "Backlog",
  severity: "Critical",
  threshold: 108000,
  thresholdLabel: "at or above 108,000 messages",
  evaluation: EvaluateOverTimeType.AllValues,
  rollingTime: RollingTime.Past5Minutes,
  recoverOnNoData: false,
};

/*
 * The late sources' floors (MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS): every
 * template on CloudWatch's pull receiver reads thirty minutes, every one on
 * Cloud Monitoring fifteen — whatever its signal's own window.
 */
const CLOUDWATCH_PULL_WINDOW: Pick<ExpectedTemplate, "rollingTime"> = {
  rollingTime: RollingTime.Past30Minutes,
};

const CLOUD_MONITORING_WINDOW: Pick<ExpectedTemplate, "rollingTime"> = {
  rollingTime: RollingTime.Past15Minutes,
};

type ExpectedShape = Pick<
  ExpectedTemplate,
  "aggregationType" | "groupByAttributeKeys" | "seriesTotal"
>;

const UNGROUPED_MAX: ExpectedShape = {
  aggregationType: MetricsAggregationType.Max,
  groupByAttributeKeys: [],
  seriesTotal: null,
};

const UNGROUPED_SUM: ExpectedShape = {
  aggregationType: MetricsAggregationType.Sum,
  groupByAttributeKeys: [],
  seriesTotal: null,
};

/*
 * Every template, in display order, with everything a reviewer has to agree
 * with: the catalog entry it reads, its name, its threshold and comparison,
 * its window, how its query folds a bucket and what it alerts per.
 * Exhaustive both ways — a catalog change that adds, drops or reshapes a
 * template fails here and has to be looked at.
 */
const EXPECTED_TEMPLATES: Array<ExpectedTemplate> = [
  {
    id: "message-queue-kafka-kafka-consumer-group-lag-sum",
    system: "kafka",
    metricName: "kafka.consumer_group.lag_sum",
    name: "Consumer Lag High",
    ...CONSUMER_LAG,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-rabbitmq-rabbitmq-message-current",
    system: "rabbitmq",
    metricName: "rabbitmq.message.current",
    name: "Queue Depth High",
    ...BACKLOG,
    // Ready + unacknowledged, added up by a formula: the page's depth.
    aggregationType: MetricsAggregationType.Avg,
    groupByAttributeKeys: [],
    seriesTotal: { key: "state", values: ["ready", "unacknowledged"] },
  },
  {
    id: "message-queue-activemq-activemq-message-queue-size",
    system: "activemq",
    metricName: "activemq.message.queue.size",
    name: "Queue Size High",
    ...BACKLOG,
    aggregationType: MetricsAggregationType.Avg,
    groupByAttributeKeys: ["activemq.broker.name", "activemq.destination.type"],
    seriesTotal: null,
  },
  {
    id: "message-queue-activemq-activemq-message-current",
    system: "activemq",
    metricName: "activemq.message.current",
    name: "Queue Size High (legacy names)",
    ...BACKLOG,
    aggregationType: MetricsAggregationType.Avg,
    groupByAttributeKeys: ["broker"],
    seriesTotal: null,
  },
  {
    id: "message-queue-servicebus-azure-activemessages-average",
    system: "servicebus",
    metricName: "azure_activemessages_average",
    name: "Active Messages High",
    ...BACKLOG,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-servicebus-azure-deadletteredmessages-average",
    system: "servicebus",
    metricName: "azure_deadletteredmessages_average",
    name: "Dead-Lettered Messages",
    ...DEAD_LETTERS_WAITING,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-servicebus-azure-abandonmessage-total",
    system: "servicebus",
    metricName: "azure_abandonmessage_total",
    name: "Abandoned Messages",
    ...FAILED_MESSAGES,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-servicebus-azure-servererrors-total",
    system: "servicebus",
    metricName: "azure_servererrors_total",
    name: "Server Errors",
    ...FAILED_REQUESTS,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-servicebus-azure-usererrors-total",
    system: "servicebus",
    metricName: "azure_usererrors_total",
    name: "User Errors",
    ...FAILED_REQUESTS,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-servicebus-azure-throttledrequests-total",
    system: "servicebus",
    metricName: "azure_throttledrequests_total",
    name: "Throttled Requests",
    ...THROTTLED,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-eventhubs-azure-servererrors-total",
    system: "eventhubs",
    metricName: "azure_servererrors_total",
    name: "Server Errors",
    ...FAILED_REQUESTS,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-eventhubs-azure-usererrors-total",
    system: "eventhubs",
    metricName: "azure_usererrors_total",
    name: "User Errors",
    ...FAILED_REQUESTS,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-eventhubs-azure-quotaexceedederrors-total",
    system: "eventhubs",
    metricName: "azure_quotaexceedederrors_total",
    name: "Quota Exceeded Errors",
    ...FAILED_REQUESTS,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-eventhubs-azure-throttledrequests-total",
    system: "eventhubs",
    metricName: "azure_throttledrequests_total",
    name: "Throttled Requests",
    ...THROTTLED,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximatenumberofmessagesvisible",
    system: "aws_sqs",
    metricName: "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
    name: "Messages Visible High",
    ...BACKLOG,
    ...CLOUDWATCH_PULL_WINDOW,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-aws-sqs-approximatenumberofmessagesvisible",
    system: "aws_sqs",
    metricName: "approximatenumberofmessagesvisible",
    name: "Messages Visible High (JSON stream)",
    ...BACKLOG,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximateageofoldestmessage",
    system: "aws_sqs",
    metricName: "amazonaws.com/aws/sqs/approximateageofoldestmessage",
    name: "Oldest Message Age High",
    ...MESSAGE_AGE,
    ...CLOUDWATCH_PULL_WINDOW,
    recoverOnNoData: true,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-aws-sqs-approximateageofoldestmessage",
    system: "aws_sqs",
    metricName: "approximateageofoldestmessage",
    name: "Oldest Message Age High (JSON stream)",
    ...MESSAGE_AGE,
    recoverOnNoData: true,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximatenumberofmessagesnotvisible",
    system: "aws_sqs",
    metricName: "amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible",
    name: "Messages In Flight Near Quota",
    ...IN_FLIGHT_NEAR_QUOTA,
    ...CLOUDWATCH_PULL_WINDOW,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-aws-sqs-approximatenumberofmessagesnotvisible",
    system: "aws_sqs",
    metricName: "approximatenumberofmessagesnotvisible",
    name: "Messages In Flight Near Quota (JSON stream)",
    ...IN_FLIGHT_NEAR_QUOTA,
    ...UNGROUPED_MAX,
  },
  /*
   * CloudWatch counts fold with Sum, CloudWatch's own count for the period:
   * the engine's Max of a Summary point is its mean, and SNS reports every
   * failed delivery as a sample of 1.
   */
  {
    id: "message-queue-aws-sns-amazonaws-com-aws-sns-numberofnotificationsfailed",
    system: "aws.sns",
    metricName: "amazonaws.com/aws/sns/numberofnotificationsfailed",
    name: "Notifications Failed",
    ...FAILED_MESSAGES,
    ...CLOUDWATCH_PULL_WINDOW,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-aws-sns-numberofnotificationsfailed",
    system: "aws.sns",
    metricName: "numberofnotificationsfailed",
    name: "Notifications Failed (JSON stream)",
    ...FAILED_MESSAGES,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-aws-sns-amazonaws-com-aws-sns-numberofnotificationsredriventodlq",
    system: "aws.sns",
    metricName: "amazonaws.com/aws/sns/numberofnotificationsredriventodlq",
    name: "Redriven to Dead-Letter Queue",
    ...DEAD_LETTERS_COUNTED,
    ...CLOUDWATCH_PULL_WINDOW,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-aws-sns-numberofnotificationsredriventodlq",
    system: "aws.sns",
    metricName: "numberofnotificationsredriventodlq",
    name: "Redriven to Dead-Letter Queue (JSON stream)",
    ...DEAD_LETTERS_COUNTED,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-num-undelivered-messages",
    system: "gcp_pubsub",
    metricName: "pubsub.googleapis.com/subscription/num_undelivered_messages",
    name: "Undelivered Messages High",
    ...BACKLOG,
    ...CLOUD_MONITORING_WINDOW,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-oldest-unacked-message-age",
    system: "gcp_pubsub",
    metricName: "pubsub.googleapis.com/subscription/oldest_unacked_message_age",
    name: "Oldest Unacked Message Age High",
    ...MESSAGE_AGE,
    ...CLOUD_MONITORING_WINDOW,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-dead-letter-message-count",
    system: "gcp_pubsub",
    metricName: "pubsub.googleapis.com/subscription/dead_letter_message_count",
    name: "Dead-Lettered Messages",
    ...DEAD_LETTERS_COUNTED,
    ...CLOUD_MONITORING_WINDOW,
    ...UNGROUPED_SUM,
  },
  {
    id: "message-queue-pulsar-pulsar-msg-backlog",
    system: "pulsar",
    metricName: "pulsar_msg_backlog",
    name: "Backlog High",
    ...BACKLOG,
    aggregationType: MetricsAggregationType.Avg,
    groupByAttributeKeys: ["cluster", "topic", "partition"],
    seriesTotal: null,
  },
  {
    id: "message-queue-pulsar-pulsar-subscription-back-log",
    system: "pulsar",
    metricName: "pulsar_subscription_back_log",
    name: "Subscription Backlog High",
    ...CONSUMER_LAG,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-rocketmq-rocketmq-consumer-lag-messages",
    system: "rocketmq",
    metricName: "rocketmq_consumer_lag_messages",
    name: "Consumer Lag High",
    ...CONSUMER_LAG,
    ...UNGROUPED_MAX,
  },
  {
    id: "message-queue-rocketmq-rocketmq-consumer-ready-messages",
    system: "rocketmq",
    metricName: "rocketmq_consumer_ready_messages",
    name: "Ready Messages High",
    ...BACKLOG,
    ...UNGROUPED_MAX,
  },
];

function expectationFor(id: string): ExpectedTemplate {
  const expectation: ExpectedTemplate | undefined = EXPECTED_TEMPLATES.find(
    (candidate: ExpectedTemplate): boolean => {
      return candidate.id === id;
    },
  );

  if (!expectation) {
    throw new Error(
      `No expectation for template "${id}". Add a row to EXPECTED_TEMPLATES and decide, deliberately, its threshold, window and group-by.`,
    );
  }

  return expectation;
}

describe("MessageQueueAlertTemplates — the library", () => {
  test("ships exactly the pinned templates, in display order", () => {
    expect(
      ALL_TEMPLATES.map((template: MessageQueueAlertTemplate): string => {
        return template.id;
      }),
    ).toEqual(
      EXPECTED_TEMPLATES.map((expected: ExpectedTemplate): string => {
        return expected.id;
      }),
    );
  });

  test.each(TEMPLATE_CASES)(
    "%s matches its pinned row",
    (id: string, template: MessageQueueAlertTemplate) => {
      const expected: ExpectedTemplate = expectationFor(id);

      expect({
        id: template.id,
        system: template.system,
        metricName: template.metricName,
        name: template.name,
        category: template.category,
        severity: template.severity,
        threshold: template.threshold,
        thresholdLabel: template.thresholdLabel,
        evaluation: template.evaluation,
        rollingTime: template.rollingTime,
        aggregationType: template.aggregationType,
        groupByAttributeKeys: template.groupByAttributeKeys,
        seriesTotal: template.seriesTotal,
        recoverOnNoData: template.recoverOnNoData,
      }).toEqual(expected);
    },
  );

  test("covers every system with a curated thresholdable gauge, and only those", () => {
    expect(getMessageQueueSystemsWithAlertTemplates()).toEqual([
      "kafka",
      "rabbitmq",
      "activemq",
      "servicebus",
      "eventhubs",
      "aws_sqs",
      "aws.sns",
      "gcp_pubsub",
      "pulsar",
      "rocketmq",
    ]);
  });

  test("ids are unique, self-prefixed and kebab-case", () => {
    const ids: Array<string> = ALL_TEMPLATES.map(
      (template: MessageQueueAlertTemplate): string => {
        return template.id;
      },
    );

    expect(new Set<string>(ids).size).toBe(ids.length);

    for (const id of ids) {
      expect(id.startsWith("message-queue-")).toBe(true);
      expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  test("an id is derived from the catalog entry alone, so it survives a retitle", () => {
    for (const template of ALL_TEMPLATES) {
      const slug: (value: string) => string = (value: string): string => {
        return value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");
      };

      expect(template.id).toBe(
        `message-queue-${slug(template.system)}-${slug(template.metricName)}`,
      );
    }
  });

  test("names are unique within the set one queue is offered", () => {
    /*
     * A queue only ever sees one system's set, so that is where a name
     * collision would produce two indistinguishable cards. Across systems
     * "Server Errors" repeats on purpose (Service Bus and Event Hubs).
     */
    for (const system of getMessageQueueSystemsWithAlertTemplates()) {
      const names: Array<string> = getMessageQueueAlertTemplates(system).map(
        (template: MessageQueueAlertTemplate): string => {
          return template.name;
        },
      );

      expect(new Set<string>(names).size).toBe(names.length);
    }
  });

  test.each(TEMPLATE_CASES)(
    "%s is a complete Metrics template",
    (_id: string, template: MessageQueueAlertTemplate) => {
      expect(template.monitorType).toBe(MonitorType.Metrics);
      expect(template.name.trim().length).toBeGreaterThan(0);
      expect(template.name).toBe(template.name.trim());
      expect(["Critical", "Warning"]).toContain(template.severity);
      expect([
        "Backlog",
        "Consumer Lag",
        "Message Age",
        "Dead Letters",
        "Errors",
        "Throttling",
      ]).toContain(template.category);
      expect(template.metricNames).toEqual([template.metricName]);
      expect(template.metricId).toBe(
        `${template.system}:${template.metricName}`,
      );
      expect(template.metricId).toBe(
        getMessageQueueMetricId(descriptorOf(template)),
      );
      expect(template.unit).toBe(descriptorOf(template).unit);
      expect(template.receiver).toBe(descriptorOf(template).receiver);
      expect(template.signal).toBe(descriptorOf(template).signal);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s has a description made of full sentences, naming its metric and threshold",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const descriptor: MessageQueueMetricDescriptor = descriptorOf(template);

      expect(template.description.length).toBeGreaterThan(100);
      expect(template.description).toMatch(/^Alert when /);
      expect(template.description.endsWith(".")).toBe(true);
      expect(template.description).toContain(template.thresholdLabel);
      expect(template.description).toContain(`Reads ${template.metricName}.`);
      // The catalog's own explanation of the metric travels with it.
      expect(template.description).toContain(descriptor.description);

      for (const noise of ["undefined", "NaN", "null", "[object Object]"]) {
        expect(template.description).not.toContain(noise);
      }
    },
  );

  test("the library is not shared state a caller can corrupt", () => {
    const first: Array<MessageQueueAlertTemplate> =
      getAllMessageQueueAlertTemplates();
    first.splice(0, first.length);

    expect(getAllMessageQueueAlertTemplates()).toHaveLength(
      EXPECTED_TEMPLATES.length,
    );
    expect(getMessageQueueAlertTemplates("kafka")).not.toBe(
      getMessageQueueAlertTemplates("kafka"),
    );
  });
});

describe("MessageQueueAlertTemplates — every template reads a catalog gauge, never a counter", () => {
  test.each(TEMPLATE_CASES)(
    "%s reads a curated GAUGE of its own system with a thresholdable signal",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const descriptor: MessageQueueMetricDescriptor = descriptorOf(template);

      expect(MESSAGE_QUEUE_METRICS).toContain(descriptor);
      expect(descriptor.system).toBe(template.system);
      /*
       * THE rule of this library: the monitor path has no rate, so a
       * cumulative counter compared against a threshold fires once and
       * never clears.
       */
      expect(descriptor.kind).toBe("gauge");
      expect(isThresholdable(descriptor.signal)).toBe(true);
      expect(isMessageQueueMetricMonitorable(descriptor)).toBe(true);
    },
  );

  test("no template reads a counter, and every counter is documented as unalertable", () => {
    const counters: Array<MessageQueueMetricDescriptor> =
      MESSAGE_QUEUE_METRICS.filter(
        (descriptor: MessageQueueMetricDescriptor): boolean => {
          return descriptor.kind === "counter";
        },
      );

    expect(counters.length).toBeGreaterThan(5);

    expect(
      UNALERTABLE_MESSAGE_QUEUE_COUNTERS.map(
        (counter: { system: string; metricName: string }): string => {
          return `${counter.system}:${counter.metricName}`;
        },
      ),
    ).toEqual(
      counters.map((descriptor: MessageQueueMetricDescriptor): string => {
        return getMessageQueueMetricId(descriptor);
      }),
    );

    for (const counter of UNALERTABLE_MESSAGE_QUEUE_COUNTERS) {
      expect(counter.wouldAlertOn.trim().length).toBeGreaterThan(5);

      for (const template of ALL_TEMPLATES) {
        expect(template.metricId).not.toBe(
          `${counter.system}:${counter.metricName}`,
        );
      }

      expect(
        getMessageQueueAlertPolicy(
          getDescriptor(counter.system, counter.metricName),
        ),
      ).toBeNull();
    }
  });

  test("every thresholdable catalog gauge has exactly one template or one documented exclusion", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (!isCatalogGauge(descriptor) || !isThresholdable(descriptor.signal)) {
        continue;
      }

      const templated: Array<MessageQueueAlertTemplate> = ALL_TEMPLATES.filter(
        (template: MessageQueueAlertTemplate): boolean => {
          return template.metricId === getMessageQueueMetricId(descriptor);
        },
      );
      const excluded: number = UNTEMPLATED_MESSAGE_QUEUE_GAUGES.filter(
        (entry: { system: string; metricName: string }): boolean => {
          return (
            entry.system === descriptor.system &&
            entry.metricName === descriptor.metricName
          );
        },
      ).length;

      expect({
        metric: getMessageQueueMetricId(descriptor),
        count: templated.length + excluded,
      }).toEqual({ metric: getMessageQueueMetricId(descriptor), count: 1 });
    }
  });

  test("the documented exclusions are catalog gauges with thresholdable signals, each with its reason", () => {
    expect(
      UNTEMPLATED_MESSAGE_QUEUE_GAUGES.map(
        (entry: { system: string; metricName: string }): string => {
          return `${entry.system}:${entry.metricName}`;
        },
      ),
    ).toEqual([
      "kafka:kafka.consumer_group.lag",
      "activemq:activemq.message.enqueue.average_duration",
      "activemq:activemq.message.wait_time.avg",
      "pulsar:pulsar_storage_backlog_age_seconds",
    ]);

    for (const entry of UNTEMPLATED_MESSAGE_QUEUE_GAUGES) {
      const descriptor: MessageQueueMetricDescriptor = getDescriptor(
        entry.system,
        entry.metricName,
      );

      expect(descriptor.kind).toBe("gauge");
      expect(isThresholdable(descriptor.signal)).toBe(true);
      expect(entry.reason.length).toBeGreaterThan(80);
      expect(entry.reason.endsWith(".")).toBe(true);
      expect(getMessageQueueAlertPolicy(descriptor)).toBeNull();
      expect(getMessageQueueAlertTemplateForMetric(descriptor)).toBeUndefined();
      // Excluded from the library, never from the "Create monitor" link.
      expect(getMessageQueueMetricMonitorSeed(descriptor)).not.toBeNull();
    }
  });

  test("ActiveMQ's running averages are left out because they are averages since the broker started", () => {
    for (const metricName of [
      "activemq.message.enqueue.average_duration",
      "activemq.message.wait_time.avg",
    ]) {
      const descriptor: MessageQueueMetricDescriptor = getDescriptor(
        "activemq",
        metricName,
      );

      // The catalog itself says it is an average, not the oldest message.
      expect(descriptor.description).toContain("average");
      expect(descriptor.signal).toBe("oldestMessageAge");
      expect(getMessageQueueAlertTemplateForMetric(descriptor)).toBeUndefined();
    }

    // ...while the queue size a stall shows up in is templated.
    expect(
      getMessageQueueAlertTemplates("activemq").map(
        (template: MessageQueueAlertTemplate): string => {
          return template.metricName;
        },
      ),
    ).toEqual(["activemq.message.queue.size", "activemq.message.current"]);
  });

  test("no template for a signal no static threshold means anything for", () => {
    expect([...MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS].sort()).toEqual(
      [
        "backlog",
        "consumerLag",
        "deadLetter",
        "errors",
        "oldestMessageAge",
        "throttled",
      ].sort(),
    );

    /*
     * Every signal the catalog uses is either thresholdable or one of the
     * three deliberately left out — a new signal fails here and has to be
     * decided.
     */
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect([
        ...MESSAGE_QUEUE_THRESHOLDABLE_SIGNALS,
        "published",
        "consumed",
        "consumers",
      ]).toContain(descriptor.signal);
    }

    for (const template of ALL_TEMPLATES) {
      expect(["published", "consumed", "consumers"]).not.toContain(
        template.signal,
      );
    }

    for (const metricName of [
      "rabbitmq.consumer.count",
      "azure_incomingmessages_total",
      "azure_outgoingmessages_total",
      "azure_completemessage_total",
      "numberofmessagessent",
      "pubsub.googleapis.com/topic/send_request_count",
    ]) {
      for (const descriptor of getMessageQueueMetricDescriptorsByName(
        metricName,
      )) {
        expect(
          getMessageQueueAlertTemplateForMetric(descriptor),
        ).toBeUndefined();
      }
    }
  });

  test("a per-period count is exactly a Sum-aggregated gauge, and counts messages or requests", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (!isCatalogGauge(descriptor)) {
        continue;
      }

      const measure: string = getMessageQueueAlertMeasure(descriptor);

      expect(measure).toBe(
        descriptor.aggregation === MetricsAggregationType.Sum
          ? "count"
          : "level",
      );

      if (measure === "count") {
        expect(["messages", "requests"]).toContain(descriptor.unit);
      }
    }
  });

  test.each(TEMPLATE_CASES)(
    "%s names a component its system's broker metrics come from",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const system: MessagingSystemDescriptor | null =
        getMessagingSystemDescriptor(template.system);

      expect(system).not.toBeNull();
      expect(
        getMessagingBrokerMetricsReceivers(system!.brokerMetrics),
      ).toContain(template.receiver);
    },
  );

  test("a template reading a metric its source does not report by default says so, naming the metric", () => {
    const optional: Array<MessageQueueAlertTemplate> = ALL_TEMPLATES.filter(
      (template: MessageQueueAlertTemplate): boolean => {
        return !descriptorOf(template).enabledByDefault;
      },
    );

    // Pub/Sub's metrics are only read once listed under metrics_list.
    expect(optional.length).toBeGreaterThan(0);

    for (const template of optional) {
      expect(template.description).toContain(template.metricName);
      expect(template.description.toLowerCase()).toContain("enable");

      if (template.receiver === "googlecloudmonitoring") {
        expect(template.description).toContain("metrics_list");
      }
    }

    for (const template of ALL_TEMPLATES) {
      if (descriptorOf(template).enabledByDefault) {
        expect(template.description.toLowerCase()).not.toContain(
          "once it is enabled",
        );
      }
    }
  });

  test("every template's metric has a realistic stored datapoint to build it from", () => {
    for (const template of ALL_TEMPLATES) {
      expect(fixtureFor(template).expected).not.toBeNull();
    }
  });
});

describe("MessageQueueAlertTemplates — thresholds and comparisons are sane per signal", () => {
  test.each(TEMPLATE_CASES)(
    "%s alerts when the value climbs to a positive, finite threshold",
    (_id: string, template: MessageQueueAlertTemplate) => {
      expect(template.filterType).toBe(FilterType.GreaterThanOrEqualTo);
      expect(Number.isFinite(template.threshold)).toBe(true);
      expect(template.threshold).toBeGreaterThan(0);
      expect(template.thresholdLabel).toBe(
        `at or above ${formatMessageQueueThreshold(
          template.threshold,
          template.unit,
        )}`,
      );
    },
  );

  test("the threshold follows the signal (and a documented override)", () => {
    const expectedBySignal: Record<string, number> = {
      backlog: 1000,
      consumerLag: 10000,
      oldestMessageAge: 600,
      deadLetter: 1,
      errors: 10,
      throttled: 10,
    };

    for (const template of ALL_TEMPLATES) {
      if (template.name.startsWith("Messages In Flight Near Quota")) {
        // 90% of a standard SQS queue's ~120,000 in-flight quota.
        expect(template.threshold).toBe(108000);
        continue;
      }

      expect({ id: template.id, threshold: template.threshold }).toEqual({
        id: template.id,
        threshold: expectedBySignal[template.signal],
      });
    }
  });

  test("a consumer lag threshold sits above a backlog's: committed-offset lag trails a busy topic by design", () => {
    const backlog: MessageQueueAlertPolicyDefault =
      MESSAGE_QUEUE_ALERT_POLICIES.find(
        (policy: MessageQueueAlertPolicyDefault): boolean => {
          return policy.signal === "backlog";
        },
      )!;
    const lag: MessageQueueAlertPolicyDefault =
      MESSAGE_QUEUE_ALERT_POLICIES.find(
        (policy: MessageQueueAlertPolicyDefault): boolean => {
          return policy.signal === "consumerLag";
        },
      )!;

    expect(lag.threshold).toBeGreaterThan(backlog.threshold);
  });

  test("every time threshold is in seconds and far below any retention period", () => {
    for (const template of ALL_TEMPLATES) {
      if (template.signal !== "oldestMessageAge") {
        continue;
      }

      expect(template.unit).toBe("s");
      // Minutes, not days: an age alert is about latency, not data loss.
      expect(template.threshold).toBeGreaterThanOrEqual(60);
      expect(template.threshold).toBeLessThanOrEqual(3600);
    }
  });

  test("a level must hold for the whole window; a count fires on any one minute", () => {
    for (const template of ALL_TEMPLATES) {
      const measure: string = getMessageQueueAlertMeasure(
        descriptorOf(template),
      );

      expect({ id: template.id, evaluation: template.evaluation }).toEqual({
        id: template.id,
        evaluation:
          measure === "count"
            ? EvaluateOverTimeType.AnyValue
            : EvaluateOverTimeType.AllValues,
      });
    }
  });

  test("the windows: backlog and lag ten minutes, everything else five — widened to a late source's floor", () => {
    for (const template of ALL_TEMPLATES) {
      const tenMinutes: boolean =
        (template.signal === "backlog" || template.signal === "consumerLag") &&
        template.severity !== "Critical";
      const signalWindow: RollingTime = tenMinutes
        ? RollingTime.Past10Minutes
        : RollingTime.Past5Minutes;
      const floor: MessageQueueSourceWindowFloor | null =
        getMessageQueueSourceWindowFloor(descriptorOf(template));

      expect({ id: template.id, window: template.rollingTime }).toEqual({
        id: template.id,
        window:
          floor &&
          rollingTimeSeconds(floor.minimumRollingTime) >
            rollingTimeSeconds(signalWindow)
            ? floor.minimumRollingTime
            : signalWindow,
      });
    }
  });

  test("exactly the CloudWatch pull and Cloud Monitoring templates are widened, each saying why", () => {
    const widened: Array<string> = [];

    for (const template of ALL_TEMPLATES) {
      const floor: MessageQueueSourceWindowFloor | null =
        getMessageQueueSourceWindowFloor(descriptorOf(template));

      if (!floor) {
        expect(template.description).not.toContain("so that it always holds");
        continue;
      }

      widened.push(template.id);
      expect(template.rollingTime).toBe(floor.minimumRollingTime);
      // The description names the lag and why the window is this long.
      expect(template.description).toContain(floor.reason);
      expect(template.description).toContain(
        rollingTimeWords(floor.minimumRollingTime),
      );
    }

    expect(widened).toEqual([
      "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximatenumberofmessagesvisible",
      "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximateageofoldestmessage",
      "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximatenumberofmessagesnotvisible",
      "message-queue-aws-sns-amazonaws-com-aws-sns-numberofnotificationsfailed",
      "message-queue-aws-sns-amazonaws-com-aws-sns-numberofnotificationsredriventodlq",
      "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-num-undelivered-messages",
      "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-oldest-unacked-message-age",
      "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-dead-letter-message-count",
    ]);
  });

  test("the window floors: one per late receiver of the catalog, each a full sentence", () => {
    expect(
      MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS.map(
        (floor: MessageQueueSourceWindowFloor): [string, RollingTime] => {
          return [floor.receiver, floor.minimumRollingTime];
        },
      ),
    ).toEqual([
      ["aws_cloudwatch", RollingTime.Past30Minutes],
      ["googlecloudmonitoring", RollingTime.Past15Minutes],
    ]);

    for (const floor of MESSAGE_QUEUE_SOURCE_WINDOW_FLOORS) {
      expect(
        MESSAGE_QUEUE_METRICS.some(
          (descriptor: MessageQueueMetricDescriptor): boolean => {
            return descriptor.receiver === floor.receiver;
          },
        ),
      ).toBe(true);
      expect(floor.reason.endsWith(".")).toBe(true);
      expect(floor.reason).toContain(`\`${floor.receiver}\``);
    }

    /*
     * Not floored, on purpose: Azure Monitor's default path only ever asks
     * for the last time grain (PT1M), so what it delivers is at most a
     * minute or two old; a Metric Stream pushes as CloudWatch publishes.
     */
    expect(
      getMessageQueueSourceWindowFloor(
        getDescriptor("servicebus", "azure_activemessages_average"),
      ),
    ).toBeNull();
    expect(
      getMessageQueueSourceWindowFloor(
        getDescriptor("aws_sqs", "approximatenumberofmessagesvisible"),
      ),
    ).toBeNull();
    expect(
      getMessageQueueSourceWindowFloor(
        null as unknown as MessageQueueMetricDescriptor,
      ),
    ).toBeNull();
  });

  test("a monitor's window is widened to the floor, never shortened", () => {
    const pull: MessageQueueMetricDescriptor = getDescriptor(
      "aws_sqs",
      "amazonaws.com/aws/sqs/numberofmessagessent",
    );

    expect(
      getMessageQueueMetricMonitorRollingTime(pull, RollingTime.Past5Minutes),
    ).toBe(RollingTime.Past30Minutes);
    expect(
      getMessageQueueMetricMonitorRollingTime(pull, RollingTime.Past1Hour),
    ).toBe(RollingTime.Past1Hour);
    expect(
      getMessageQueueMetricMonitorRollingTime(
        getDescriptor("kafka", "kafka.consumer_group.lag_sum"),
        RollingTime.Past1Minute,
      ),
    ).toBe(RollingTime.Past1Minute);
  });

  test("recovery reads silence as zero exactly for counts and for SQS's oldest-message age", () => {
    for (const template of ALL_TEMPLATES) {
      const descriptor: MessageQueueMetricDescriptor = descriptorOf(template);
      const silentWhenEmpty: boolean =
        getMessageQueueAlertMeasure(descriptor) === "count" ||
        (template.system === "aws_sqs" &&
          template.metricName.endsWith("approximateageofoldestmessage"));

      expect({ id: template.id, recover: template.recoverOnNoData }).toEqual({
        id: template.id,
        recover: silentWhenEmpty,
      });

      if (template.metricName.endsWith("approximateageofoldestmessage")) {
        // The catalog is where "silent when empty" comes from.
        expect(descriptor.description).toContain(
          "only while the queue holds a message",
        );
      }
    }
  });

  test("only a queue about to refuse receives is Critical", () => {
    expect(
      ALL_TEMPLATES.filter((template: MessageQueueAlertTemplate): boolean => {
        return template.severity === "Critical";
      }).map((template: MessageQueueAlertTemplate): string => {
        return template.id;
      }),
    ).toEqual([
      "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximatenumberofmessagesnotvisible",
      "message-queue-aws-sqs-approximatenumberofmessagesnotvisible",
    ]);
  });

  test("the category follows the signal", () => {
    const categoryBySignal: Record<string, MessageQueueAlertTemplateCategory> =
      {
        backlog: "Backlog",
        consumerLag: "Consumer Lag",
        oldestMessageAge: "Message Age",
        deadLetter: "Dead Letters",
        errors: "Errors",
        throttled: "Throttling",
      };

    for (const template of ALL_TEMPLATES) {
      expect(template.category).toBe(categoryBySignal[template.signal]);
    }
  });

  test("the policy defaults: one per (signal, measure), each documented in full sentences", () => {
    const keys: Array<string> = MESSAGE_QUEUE_ALERT_POLICIES.map(
      (policy: MessageQueueAlertPolicyDefault): string => {
        return `${policy.signal}/${policy.measure}`;
      },
    );

    expect(new Set<string>(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(
      [
        "backlog/level",
        "consumerLag/level",
        "oldestMessageAge/level",
        "deadLetter/level",
        "deadLetter/count",
        "errors/count",
        "throttled/count",
      ].sort(),
    );

    for (const policy of MESSAGE_QUEUE_ALERT_POLICIES) {
      expect(isThresholdable(policy.signal)).toBe(true);
      expect(policy.threshold).toBeGreaterThan(0);
      expect(["", "High"]).toContain(policy.nameSuffix);
      expect(policy.metricAlias).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(policy.meaning.endsWith(".")).toBe(true);
      expect(policy.incidentDescription.endsWith(".")).toBe(true);
      expect(policy.incidentDescription.length).toBeGreaterThan(60);
      expect(
        policy.measure === "count"
          ? policy.evaluation === EvaluateOverTimeType.AnyValue
          : policy.evaluation === EvaluateOverTimeType.AllValues,
      ).toBe(true);
    }
  });

  test("every override names catalog gauges of its system, and takes effect on each", () => {
    expect(MESSAGE_QUEUE_ALERT_POLICY_OVERRIDES.length).toBeGreaterThan(0);

    for (const override of MESSAGE_QUEUE_ALERT_POLICY_OVERRIDES as Array<MessageQueueAlertPolicyOverride>) {
      expect(override.reason.endsWith(".")).toBe(true);
      expect(override.metricNames.length).toBeGreaterThan(0);

      for (const metricName of override.metricNames) {
        const descriptor: MessageQueueMetricDescriptor = getDescriptor(
          override.system,
          metricName,
        );
        const template: MessageQueueAlertTemplate | undefined =
          getMessageQueueAlertTemplateForMetric(descriptor);

        expect(template).toBeDefined();

        if (override.threshold !== undefined) {
          expect(template!.threshold).toBe(override.threshold);
        }
        if (override.severity !== undefined) {
          expect(template!.severity).toBe(override.severity);
        }
        if (override.rollingTime !== undefined) {
          // A late source's floor still widens an override's window.
          expect(template!.rollingTime).toBe(
            getMessageQueueMetricMonitorRollingTime(
              descriptor,
              override.rollingTime,
            ),
          );
        }
        if (override.recoverOnNoData !== undefined) {
          expect(template!.recoverOnNoData).toBe(override.recoverOnNoData);
        }
        if (override.name !== undefined) {
          expect(template!.name.startsWith(override.name)).toBe(true);
        }
      }
    }
  });

  test("both CloudWatch shapes of one metric get the same alert, the pull one over its longer window", () => {
    for (const template of ALL_TEMPLATES) {
      if (!template.name.endsWith("(JSON stream)")) {
        continue;
      }

      const prefix: string =
        template.system === "aws_sqs"
          ? "amazonaws.com/aws/sqs/"
          : "amazonaws.com/aws/sns/";
      const pull: MessageQueueAlertTemplate = ALL_TEMPLATES.find(
        (candidate: MessageQueueAlertTemplate): boolean => {
          return candidate.metricName === `${prefix}${template.metricName}`;
        },
      )!;

      expect(pull).toBeDefined();
      expect(template.name).toBe(`${pull.name} (JSON stream)`);
      expect({
        threshold: template.threshold,
        severity: template.severity,
        evaluation: template.evaluation,
        recoverOnNoData: template.recoverOnNoData,
        aggregationType: template.aggregationType,
      }).toEqual({
        threshold: pull.threshold,
        severity: pull.severity,
        evaluation: pull.evaluation,
        recoverOnNoData: pull.recoverOnNoData,
        aggregationType: pull.aggregationType,
      });

      /*
       * The JSON stream pushes as CloudWatch publishes and keeps its
       * signal's window; the pull receiver (whose names the OpenTelemetry
       * 1.0 stream shares) fetches ten minutes late and reads thirty.
       */
      expect(pull.rollingTime).toBe(RollingTime.Past30Minutes);
      expect(rollingTimeSeconds(template.rollingTime)).toBeLessThanOrEqual(
        rollingTimeSeconds(RollingTime.Past10Minutes),
      );
    }
  });

  test("a time threshold is converted to the metric's own unit", () => {
    const sqsAge: MessageQueueMetricDescriptor = getDescriptor(
      "aws_sqs",
      "amazonaws.com/aws/sqs/approximateageofoldestmessage",
    );

    // A metric reported in milliseconds reads the same ten minutes.
    const inMilliseconds: MessageQueueAlertPolicy | null =
      getMessageQueueAlertPolicy({
        ...sqsAge,
        metricName: "example.oldest_message_age.ms",
        unit: "ms",
      });

    expect(inMilliseconds).not.toBeNull();
    expect(inMilliseconds!.threshold).toBe(600000);
    expect(inMilliseconds!.thresholdLabel).toBe("at or above 10 minutes");

    const inSeconds: MessageQueueAlertPolicy | null =
      getMessageQueueAlertPolicy({
        ...sqsAge,
        metricName: "example.oldest_message_age.s",
      });

    expect(inSeconds!.threshold).toBe(600);
    expect(inSeconds!.thresholdLabel).toBe("at or above 10 minutes");
  });

  test("no policy for a counter, an untemplated gauge, or a (signal, measure) without a default", () => {
    const kafkaLag: MessageQueueMetricDescriptor = getDescriptor(
      "kafka",
      "kafka.consumer_group.lag_sum",
    );

    expect(getMessageQueueAlertPolicy(kafkaLag)).not.toBeNull();
    expect(
      getMessageQueueAlertPolicy({ ...kafkaLag, kind: "counter" }),
    ).toBeNull();
    expect(
      getMessageQueueAlertPolicy({ ...kafkaLag, signal: "consumed" }),
    ).toBeNull();
    // A backlog counted per period has no default: nothing would fire.
    expect(
      getMessageQueueAlertPolicy({
        ...kafkaLag,
        signal: "backlog",
        aggregation: MetricsAggregationType.Sum,
      }),
    ).toBeNull();
    expect(
      getMessageQueueAlertPolicy(
        getDescriptor("kafka", "kafka.consumer_group.lag"),
      ),
    ).toBeNull();
  });

  test.each([
    [1000, "messages", "1,000 messages"],
    [1, "messages", "1 message"],
    [108000, "messages", "108,000 messages"],
    [10, "requests", "10 requests"],
    [1, "requests", "1 request"],
    [2, "consumers", "2 consumers"],
    [600, "s", "10 minutes"],
    [60, "s", "1 minute"],
    [90, "s", "90 seconds"],
    [1, "s", "1 second"],
    [0.5, "s", "0.5 seconds"],
    [3600, "s", "1 hour"],
    [7200, "s", "2 hours"],
    [600000, "ms", "10 minutes"],
    [1500, "ms", "1,500 milliseconds"],
    [1234567, "", "1,234,567"],
    [2.345, "messages", "2.35 messages"],
  ])(
    "formatMessageQueueThreshold(%p, %p) reads %p",
    (value: number, unit: string, expected: string) => {
      expect(formatMessageQueueThreshold(value, unit)).toBe(expected);
    },
  );
});

describe("MessageQueueAlertTemplates — the query builder the templates and the Create monitor link share", () => {
  const SERVICE_BUS_ACTIVE: MessageQueueMetricDescriptor = getDescriptor(
    "servicebus",
    "azure_activemessages_average",
  );

  /*
   * Every realistic stored datapoint of a curated gauge that names a queue:
   * the corpus the resolver and catalog suites run over.
   */
  const GAUGE_FIXTURE_CASES: Array<
    [string, MetricFixture, MessageQueueMetricDescriptor]
  > = [];

  for (const fixture of METRIC_FIXTURES) {
    if (!fixture.expected) {
      continue;
    }

    const descriptor: MessageQueueMetricDescriptor | undefined =
      getMessageQueueMetricDescriptorsByName(fixture.metricName).find(
        (candidate: MessageQueueMetricDescriptor): boolean => {
          return candidate.system === fixture.expected!.system;
        },
      );

    if (descriptor && isMessageQueueMetricMonitorable(descriptor)) {
      GAUGE_FIXTURE_CASES.push([
        `${fixture.metricName} — ${fixture.name}`,
        fixture,
        descriptor,
      ]);
    }
  }

  test("the corpus covers every monitorable catalog gauge", () => {
    const covered: Set<string> = new Set<string>(
      GAUGE_FIXTURE_CASES.map(
        (
          entry: [string, MetricFixture, MessageQueueMetricDescriptor],
        ): string => {
          return getMessageQueueMetricId(entry[2]);
        },
      ),
    );

    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (isMessageQueueMetricMonitorable(descriptor)) {
        expect(covered.has(getMessageQueueMetricId(descriptor))).toBe(true);
      }
    }
  });

  test.each(GAUGE_FIXTURE_CASES)(
    "%s — filters the destination, scope and required attributes exactly as stored, and nothing else",
    (
      _name: string,
      fixture: MetricFixture,
      descriptor: MessageQueueMetricDescriptor,
    ) => {
      const query: MessageQueueMetricMonitorQuery | null = queryFor(
        descriptor,
        [fixture.attributes],
      );

      expect(query).not.toBeNull();

      const stored: Record<string, string> = toStoredColumns(
        fixture.attributes,
        Object.keys(query!.attributes),
      );

      for (const key of Object.keys(query!.attributes)) {
        // Exactly the stored text: never canonicalized, never trimmed.
        expect(query!.attributes[key]).toBe(stored[key]);
        expect(getMessageQueueMetricFilterAttributeKeys(descriptor)).toContain(
          key,
        );
      }

      // The destination is always pinned — first key the resolver reads.
      const destinationKey: string | undefined = Object.keys(
        query!.attributes,
      )[0];
      expect(descriptor.destinationAttributes).toContain(destinationKey);

      // Every required attribute is pinned, a scope when the series has one.
      for (const key of Object.keys(descriptor.requiredAttributes || {})) {
        expect(Object.keys(query!.attributes)).toContain(key);
      }
      if (fixture.expected!.brokerScope) {
        expect(
          Object.keys(query!.attributes).some((key: string): boolean => {
            return (descriptor.scopeAttributes || []).includes(key);
          }),
        ).toBe(true);
      }

      // The keys that tell a queue's series apart are never filtered on.
      for (const key of descriptor.seriesKeys || []) {
        if (!descriptor.destinationAttributes.includes(key)) {
          expect(Object.keys(query!.attributes)).not.toContain(key);
        }
      }
    },
  );

  test.each(GAUGE_FIXTURE_CASES)(
    "%s — the filter, read as a datapoint, is the same queue as the series it came from",
    (
      _name: string,
      fixture: MetricFixture,
      descriptor: MessageQueueMetricDescriptor,
    ) => {
      const query: MessageQueueMetricMonitorQuery = queryFor(descriptor, [
        fixture.attributes,
      ])!;

      /*
       * The filter pins every attribute the resolver keys the queue on: a
       * datapoint carrying nothing but the filtered values resolves to the
       * same queue, so no datapoint of another queue can pass the filter.
       */
      expect(
        resolvedIdentifier(
          descriptor.metricName,
          query.attributes as Record<string, unknown>,
        ),
      ).toBe(resolvedIdentifier(fixture.metricName, fixture.attributes));
      expect(
        resolvedIdentifier(fixture.metricName, fixture.attributes),
      ).not.toBeNull();
    },
  );

  test.each(GAUGE_FIXTURE_CASES)(
    "%s — builds the same query from the series read back from ClickHouse",
    (
      _name: string,
      fixture: MetricFixture,
      descriptor: MessageQueueMetricDescriptor,
    ) => {
      /*
       * Typed at ingest, strings with "" for every missing key once stored:
       * the "Create monitor" link reads the second shape.
       */
      const row: Record<string, string> = toStoredColumns(
        fixture.attributes,
        MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES,
      );

      expect(queryFor(descriptor, [row])).toEqual(
        queryFor(descriptor, [fixture.attributes]),
      );
    },
  );

  test("the filter keys are ones the discovery cron reads, so an observed series always has them", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      for (const key of getMessageQueueMetricFilterAttributeKeys(descriptor)) {
        expect(MESSAGING_METRIC_RESOLVER_INPUT_ATTRIBUTES).toContain(key);
      }
    }

    expect(
      getMessageQueueMetricFilterAttributeKeys(SERVICE_BUS_ACTIVE),
    ).toEqual(["metadata_entityname", "metadata_EntityName", "name", "type"]);
    expect(
      getMessageQueueMetricFilterAttributeKeys(
        getDescriptor("aws_sqs", "approximatenumberofmessagesvisible"),
      ),
    ).toEqual(["QueueName", "resource.service.name"]);
  });

  test("Service Bus: the entity, the namespace and the resource type — nothing else", () => {
    const query: MessageQueueMetricMonitorQuery = queryFor(SERVICE_BUS_ACTIVE, [
      SERVICE_BUS_ORDERS,
    ])!;

    expect(query).toEqual({
      metricId: "servicebus:azure_activemessages_average",
      metricName: "azure_activemessages_average",
      attributes: {
        metadata_entityname: "orders",
        name: "orders-prod",
        type: "Microsoft.ServiceBus/Namespaces",
      },
      aggregationType: MetricsAggregationType.Max,
      groupByAttributeKeys: [],
      seriesTotal: null,
      unit: "messages",
    });
  });

  test("casing and whitespace stay exactly as stored — the identity is canonical, the filter is not", () => {
    const query: MessageQueueMetricMonitorQuery = queryFor(SERVICE_BUS_ACTIVE, [
      {
        ...SERVICE_BUS_ORDERS,
        name: "Orders-Prod",
        metadata_entityname: "Orders ",
        type: "microsoft.servicebus/namespaces",
      },
    ])!;

    expect(query.attributes).toEqual({
      metadata_entityname: "Orders ",
      name: "Orders-Prod",
      type: "microsoft.servicebus/namespaces",
    });
  });

  test("the documented PascalCase dimension key is the one pinned when that is the key stored", () => {
    const attributes: FixtureAttributes = { ...SERVICE_BUS_ORDERS };
    delete attributes["metadata_entityname"];
    attributes["metadata_EntityName"] = "orders";

    expect(queryFor(SERVICE_BUS_ACTIVE, [attributes])!.attributes).toEqual({
      metadata_EntityName: "orders",
      name: "orders-prod",
      type: "Microsoft.ServiceBus/Namespaces",
    });
  });

  test("a blank first spelling falls through to the next, as the resolver reads it", () => {
    expect(
      queryFor(SERVICE_BUS_ACTIVE, [
        {
          ...SERVICE_BUS_ORDERS,
          metadata_entityname: "   ",
          metadata_EntityName: "orders",
        },
      ])!.attributes,
    ).toEqual({
      metadata_EntityName: "orders",
      name: "orders-prod",
      type: "Microsoft.ServiceBus/Namespaces",
    });
  });

  test("a namespace-scoped series without a namespace is pinned on what it has", () => {
    const attributes: FixtureAttributes = { ...SERVICE_BUS_ORDERS };
    delete attributes["name"];

    expect(queryFor(SERVICE_BUS_ACTIVE, [attributes])!.attributes).toEqual({
      metadata_entityname: "orders",
      type: "Microsoft.ServiceBus/Namespaces",
    });
  });

  test("Amazon SQS: the pull shape pins the dimension, the JSON stream also its service", () => {
    expect(
      queryFor(
        getDescriptor(
          "aws_sqs",
          "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        ),
        [
          {
            "resource.cloud.provider": "aws",
            Namespace: "AWS/SQS",
            MetricName: "ApproximateNumberOfMessagesVisible",
            "Dimensions.QueueName": "orders",
          },
        ],
      )!.attributes,
    ).toEqual({ "Dimensions.QueueName": "orders" });

    expect(
      queryFor(getDescriptor("aws_sqs", "approximatenumberofmessagesvisible"), [
        {
          "resource.cloud.provider": "aws",
          "resource.service.namespace": "AWS",
          "resource.service.name": "SQS",
          QueueName: "orders",
        },
      ])!.attributes,
    ).toEqual({ QueueName: "orders", "resource.service.name": "SQS" });
  });

  test("RabbitMQ: the queue is pinned, and its ready and unacknowledged series are added up, never filtered by the scope", () => {
    const query: MessageQueueMetricMonitorQuery = queryFor(
      getDescriptor("rabbitmq", "rabbitmq.message.current"),
      [
        {
          "resource.rabbitmq.node.name": "rabbit@16c76f2d8aa2",
          "resource.rabbitmq.queue.name": "orders",
          "resource.rabbitmq.vhost.name": "/",
          state: "ready",
        },
        {
          "resource.rabbitmq.node.name": "rabbit@16c76f2d8aa2",
          "resource.rabbitmq.queue.name": "orders",
          "resource.rabbitmq.vhost.name": "/",
          state: "unacknowledged",
        },
      ],
    )!;

    expect(query.attributes).toEqual({
      "resource.rabbitmq.queue.name": "orders",
    });
    expect(query.groupByAttributeKeys).toEqual([]);
    expect(query.seriesTotal).toEqual({
      key: "state",
      values: ["ready", "unacknowledged"],
    });
    expect(query.aggregationType).toBe(MetricsAggregationType.Avg);

    // Whichever state was observed first, the total covers both.
    expect(
      queryFor(getDescriptor("rabbitmq", "rabbitmq.message.current"), [
        { "resource.rabbitmq.queue.name": "orders", state: "unacknowledged" },
      ])!.seriesTotal,
    ).toEqual({ key: "state", values: ["ready", "unacknowledged"] });
  });

  test("the query never hands out the seed's value array", () => {
    const descriptor: MessageQueueMetricDescriptor = getDescriptor(
      "rabbitmq",
      "rabbitmq.message.current",
    );
    const query: MessageQueueMetricMonitorQuery = queryFor(descriptor, [
      { "resource.rabbitmq.queue.name": "orders", state: "ready" },
    ])!;

    query.seriesTotal!.values.push("paged_out");

    expect(MESSAGE_QUEUE_SERIES_TOTALS[0]!.values).toEqual([
      "ready",
      "unacknowledged",
    ]);
    expect(getMessageQueueMetricMonitorSeed(descriptor)!.seriesTotal).toEqual({
      key: "state",
      values: ["ready", "unacknowledged"],
    });
  });

  test("Kafka: the topic is pinned, not the consumer group", () => {
    expect(
      queryFor(getDescriptor("kafka", "kafka.consumer_group.lag_sum"), [
        { group: "billing", topic: "payments" },
        { group: "ledger", topic: "payments" },
      ])!.attributes,
    ).toEqual({ topic: "payments" });
  });

  test("Pulsar: a partitioned topic's partitions become one Includes, sorted", () => {
    const query: MessageQueueMetricMonitorQuery = queryFor(
      getDescriptor("pulsar", "pulsar_msg_backlog"),
      [
        pulsarPartition("payments", 2),
        pulsarPartition("payments", 0),
        pulsarPartition("payments", 1),
        // The same partition twice (two scrapes) is one value.
        pulsarPartition("payments", 1),
      ],
    )!;

    expect(Object.keys(query.attributes)).toEqual(["topic"]);
    expect(includesValues(query.attributes["topic"])).toEqual([
      "persistent://public/default/payments-partition-0",
      "persistent://public/default/payments-partition-1",
      "persistent://public/default/payments-partition-2",
    ]);
    // ...and each partition is its own series.
    expect(query.groupByAttributeKeys).toEqual([
      "cluster",
      "topic",
      "partition",
    ]);
  });

  test("the same queue under two spellings of its value is watched under both", () => {
    const query: MessageQueueMetricMonitorQuery = queryFor(SERVICE_BUS_ACTIVE, [
      SERVICE_BUS_ORDERS,
      { ...SERVICE_BUS_ORDERS, metadata_entityname: "Orders" },
    ])!;

    expect(includesValues(query.attributes["metadata_entityname"])).toEqual([
      "Orders",
      "orders",
    ]);
    expect(query.attributes["name"]).toBe("orders-prod");
  });

  test("a series under the other spelling of the destination key is left out: an AND cannot say 'this key or that'", () => {
    const pascal: FixtureAttributes = { ...SERVICE_BUS_ORDERS };
    delete pascal["metadata_entityname"];
    pascal["metadata_EntityName"] = "Orders";

    expect(
      queryFor(SERVICE_BUS_ACTIVE, [SERVICE_BUS_ORDERS, pascal])!.attributes,
    ).toEqual({
      metadata_entityname: "orders",
      name: "orders-prod",
      type: "Microsoft.ServiceBus/Namespaces",
    });
  });

  test("series of another queue never widen the filter", () => {
    const query: MessageQueueMetricMonitorQuery = queryFor(SERVICE_BUS_ACTIVE, [
      SERVICE_BUS_ORDERS,
      { ...SERVICE_BUS_ORDERS, metadata_entityname: "payments" },
      { ...SERVICE_BUS_ORDERS, name: "orders-staging" },
    ])!;

    expect(query.attributes).toEqual({
      metadata_entityname: "orders",
      name: "orders-prod",
      type: "Microsoft.ServiceBus/Namespaces",
    });
  });

  test("with the queue's identity, only its own series are used — wherever they come in the list", () => {
    const identity: MessageQueueIdentity = parseMessageQueueIdentifier(
      "servicebus|orders-prod|payments",
    )!;

    expect(
      queryFor(
        SERVICE_BUS_ACTIVE,
        [
          SERVICE_BUS_ORDERS,
          { ...SERVICE_BUS_ORDERS, metadata_entityname: "Payments" },
        ],
        identity,
      )!.attributes,
    ).toEqual({
      metadata_entityname: "Payments",
      name: "orders-prod",
      type: "Microsoft.ServiceBus/Namespaces",
    });

    expect(
      queryFor(
        SERVICE_BUS_ACTIVE,
        [SERVICE_BUS_ORDERS],
        parseMessageQueueIdentifier("servicebus|orders-prod|payments"),
      ),
    ).toBeNull();
  });

  test("an ActiveMQ series matches its queue's JMS-family identity", () => {
    // Java clients' JMS spans and the JMX Scraper's metrics are one queue.
    expect(
      queryFor(
        getDescriptor("activemq", "activemq.message.queue.size"),
        [
          {
            "activemq.broker.name": "localhost",
            "activemq.destination.type": "queue",
            "messaging.destination.name": "orders",
          },
        ],
        parseMessageQueueIdentifier("jms||orders"),
      )!.attributes,
    ).toEqual({ "messaging.destination.name": "orders" });
  });

  test("an identity that is not one builds nothing", () => {
    expect(
      queryFor(SERVICE_BUS_ACTIVE, [SERVICE_BUS_ORDERS], {
        system: "servicebus",
        brokerScope: "orders-prod",
        destination: "",
      }),
    ).toBeNull();
  });

  test("a series of the other Azure service sharing the metric name is not this entry's", () => {
    expect(
      queryFor(getDescriptor("servicebus", "azure_servererrors_total"), [
        EVENT_HUBS_TELEMETRY,
      ]),
    ).toBeNull();

    expect(
      queryFor(getDescriptor("eventhubs", "azure_servererrors_total"), [
        EVENT_HUBS_TELEMETRY,
      ])!.attributes,
    ).toEqual({
      metadata_entityname: "telemetry",
      name: "ingest-prod",
      type: "Microsoft.EventHub/namespaces",
    });
  });

  test("a series that names no queue builds nothing", () => {
    const noQueue: Array<[MessageQueueMetricDescriptor, FixtureAttributes]> = [
      // Azure's namespace-level value.
      [
        SERVICE_BUS_ACTIVE,
        { ...SERVICE_BUS_ORDERS, metadata_entityname: "-NamespaceOnlyMetric-" },
      ],
      // Another resource type under the same metric name.
      [
        SERVICE_BUS_ACTIVE,
        { ...SERVICE_BUS_ORDERS, type: "Microsoft.Storage/storageAccounts" },
      ],
      // No resource type at all: the required attribute is missing.
      [SERVICE_BUS_ACTIVE, { metadata_entityname: "orders", name: "ns" }],
      // No destination.
      [
        SERVICE_BUS_ACTIVE,
        { name: "orders-prod", type: "Microsoft.ServiceBus/namespaces" },
      ],
      // A Pulsar system topic.
      [
        getDescriptor("pulsar", "pulsar_msg_backlog"),
        {
          cluster: "standalone",
          topic: "persistent://public/default/__change_events",
        },
      ],
      // An ActiveMQ advisory topic.
      [
        getDescriptor("activemq", "activemq.message.queue.size"),
        {
          "activemq.destination.type": "topic",
          "messaging.destination.name": "ActiveMQ.Advisory.Connection",
        },
      ],
      // A JSON stream series of another AWS service.
      [
        getDescriptor("aws_sqs", "approximatenumberofmessagesvisible"),
        { "resource.service.name": "SNS", QueueName: "orders" },
      ],
    ];

    for (const [descriptor, attributes] of noQueue) {
      expect(queryFor(descriptor, [attributes])).toBeNull();
    }
  });

  test("no monitor on a counter or on an entry whose repeats an equality filter cannot exclude", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.kind !== "counter") {
        continue;
      }

      const fixture: MetricFixture | undefined = METRIC_FIXTURES.find(
        (candidate: MetricFixture): boolean => {
          return (
            candidate.metricName === descriptor.metricName &&
            candidate.expected?.system === descriptor.system
          );
        },
      );

      expect(fixture).toBeDefined();
      expect(queryFor(descriptor, [fixture!.attributes])).toBeNull();
      expect(isMessageQueueMetricMonitorable(descriptor)).toBe(false);
    }

    const withRepeats: MessageQueueMetricDescriptor = {
      ...getDescriptor("pulsar", "pulsar_subscription_back_log"),
      excludeSeriesWithAttributes: ["consumer_name", "consumer_id"],
    };

    expect(isMessageQueueMetricMonitorable(withRepeats)).toBe(false);
    expect(getMessageQueueMetricMonitorSeed(withRepeats)).toBeNull();
    expect(queryFor(withRepeats, [pulsarPartition("payments", 0)])).toBeNull();

    // No curated gauge needs one today, so no template is lost to the rule.
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (descriptor.kind === "gauge") {
        expect(descriptor.excludeSeriesWithAttributes || []).toEqual([]);
      }
    }
  });

  test("nothing observed builds nothing, and hostile input never throws", () => {
    expect(queryFor(SERVICE_BUS_ACTIVE, [])).toBeNull();
    expect(
      queryFor(
        SERVICE_BUS_ACTIVE,
        undefined as unknown as ReadonlyArray<MessageQueueObservedAttributes>,
      ),
    ).toBeNull();
    expect(
      queryFor(
        SERVICE_BUS_ACTIVE,
        "orders" as unknown as ReadonlyArray<MessageQueueObservedAttributes>,
      ),
    ).toBeNull();
    expect(
      buildMessageQueueMetricMonitorQuery(
        null as unknown as {
          descriptor: MessageQueueMetricDescriptor;
          observedSeries: ReadonlyArray<MessageQueueObservedAttributes>;
        },
      ),
    ).toBeNull();

    const junk: Array<unknown> = [
      null,
      undefined,
      42,
      "orders",
      [SERVICE_BUS_ORDERS],
      {},
      { constructor: "orders", toString: "orders" },
      // An inherited destination is not the series' own attribute.
      Object.create(SERVICE_BUS_ORDERS),
      {
        ...SERVICE_BUS_ORDERS,
        metadata_entityname: { value: "orders" },
      },
      { ...SERVICE_BUS_ORDERS, metadata_entityname: Number.NaN },
    ];

    expect(
      queryFor(
        SERVICE_BUS_ACTIVE,
        junk as ReadonlyArray<MessageQueueObservedAttributes>,
      ),
    ).toBeNull();

    // A good series after the junk still builds the query.
    expect(
      queryFor(SERVICE_BUS_ACTIVE, [
        ...(junk as Array<MessageQueueObservedAttributes>),
        SERVICE_BUS_ORDERS,
      ])!.attributes["metadata_entityname"],
    ).toBe("orders");
  });

  test("a series without a prototype is read like any other", () => {
    const bare: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    Object.assign(bare, SERVICE_BUS_ORDERS);

    expect(queryFor(SERVICE_BUS_ACTIVE, [bare])!.attributes).toEqual({
      metadata_entityname: "orders",
      name: "orders-prod",
      type: "Microsoft.ServiceBus/Namespaces",
    });
  });

  test("a numeric value is filtered as the text ClickHouse stores it as", () => {
    expect(
      queryFor(getDescriptor("kafka", "kafka.consumer_group.lag_sum"), [
        { group: "billing", topic: 42 },
      ])!.attributes,
    ).toEqual({ topic: "42" });
  });

  test("the order of the observed series and of their attributes does not matter", () => {
    const series: Array<FixtureAttributes> = [
      pulsarPartition("payments", 1),
      pulsarPartition("payments", 0),
      pulsarPartition("payments", 2),
    ];
    const reversed: Array<FixtureAttributes> = [...series]
      .reverse()
      .map((attributes: FixtureAttributes): FixtureAttributes => {
        const shuffled: FixtureAttributes = {};
        for (const key of Object.keys(attributes).reverse()) {
          shuffled[key] = attributes[key];
        }
        return shuffled;
      });
    const descriptor: MessageQueueMetricDescriptor = getDescriptor(
      "pulsar",
      "pulsar_subscription_back_log",
    );

    expect(queryFor(descriptor, reversed)).toEqual(
      queryFor(descriptor, series),
    );
  });

  test.each(GAUGE_FIXTURE_CASES)(
    "%s — folds and groups the way getMessageQueueMetricMonitorSeed says",
    (
      _name: string,
      fixture: MetricFixture,
      descriptor: MessageQueueMetricDescriptor,
    ) => {
      const query: MessageQueueMetricMonitorQuery = queryFor(descriptor, [
        fixture.attributes,
      ])!;
      const seed: MessageQueueMetricMonitorSeed =
        getMessageQueueMetricMonitorSeed(descriptor)!;

      expect(query.aggregationType).toBe(seed.aggregationType);
      expect(query.groupByAttributeKeys).toEqual(seed.groupByAttributeKeys);
      expect(query.unit).toBe(descriptor.unit);
      expect(query.metricId).toBe(getMessageQueueMetricId(descriptor));
      expect(query.metricName).toBe(descriptor.metricName);
    },
  );
});

describe("MessageQueueAlertTemplates — how a monitor reads each catalog gauge (the seed)", () => {
  const GAUGE_CASES: Array<[string, MessageQueueMetricDescriptor]> =
    MESSAGE_QUEUE_METRICS.filter(isCatalogGauge).map(
      (
        descriptor: MessageQueueMetricDescriptor,
      ): [string, MessageQueueMetricDescriptor] => {
        return [getMessageQueueMetricId(descriptor), descriptor];
      },
    );

  test.each(GAUGE_CASES)(
    "%s: the monitor evaluates the number the queue page shows",
    (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const seed: MessageQueueMetricMonitorSeed | null =
        getMessageQueueMetricMonitorSeed(descriptor);
      const seriesTotal: MessageQueueSeriesTotalDefinition | undefined =
        seriesTotalDefinitionOf(descriptor);

      expect(seed).not.toBeNull();

      if (descriptor.aggregation === MetricsAggregationType.Sum) {
        /*
         * A per-period count, whatever the combine: the bucket's Sum is the
         * count (never Max, which on a CloudWatch Summary is the Average).
         * "sum" adds the series up; "max" with series keys alerts per
         * series, and without them has one series per queue.
         */
        expect(seed!.aggregationType).toBe(MetricsAggregationType.Sum);
        expect(seed!.groupByAttributeKeys).toEqual(
          descriptor.seriesCombine === "max"
            ? [...(descriptor.seriesKeys || [])]
            : [],
        );
        expect(seed!.seriesTotal).toBeNull();
      } else {
        switch (descriptor.seriesCombine) {
          case "max":
            // Max of everything IS the worst series.
            expect(seed!.aggregationType).toBe(MetricsAggregationType.Max);
            expect(seed!.groupByAttributeKeys).toEqual([]);
            expect(seed!.seriesTotal).toBeNull();
            break;
          case "avg":
            expect(seed!.aggregationType).toBe(descriptor.aggregation);
            expect(seed!.groupByAttributeKeys).toEqual([]);
            expect(seed!.seriesTotal).toBeNull();
            break;
          default:
            expect(seed!.aggregationType).toBe(descriptor.aggregation);

            if (seriesTotal) {
              // A closed set of parts: one query each, added by a formula.
              expect(seed!.groupByAttributeKeys).toEqual([]);
              expect(seed!.seriesTotal).toEqual({
                key: seriesTotal.seriesKey,
                values: [...seriesTotal.values],
              });
            } else {
              // An open set cannot be added up: alert per series.
              expect(seed!.groupByAttributeKeys).toEqual([
                ...(descriptor.seriesKeys || []),
              ]);
              expect(seed!.seriesTotal).toBeNull();
            }
        }
      }

      // The late sources' floor travels with the seed, for the link.
      expect(seed!.minimumRollingTime).toBe(
        getMessageQueueSourceWindowFloor(descriptor)?.minimumRollingTime ??
          null,
      );

      // A note exactly when the monitor reads something other than the chart.
      expect(seed!.note !== null).toBe(
        seed!.groupByAttributeKeys.length > 0 ||
          seed!.aggregationType !== descriptor.aggregation,
      );

      if (seed!.note) {
        expect(seed!.note.endsWith(".")).toBe(true);
        expect(seed!.note).not.toContain("cannot add series together");
      }
      if (seed!.groupByAttributeKeys.length > 0) {
        expect(seed!.note).toContain("alerts on each series separately");
      }
    },
  );

  test("the notes, as the Create monitor dialog shows them", () => {
    // RabbitMQ's depth is the page's own total: no note to show.
    expect(
      getMessageQueueMetricMonitorSeed(
        getDescriptor("rabbitmq", "rabbitmq.message.current"),
      ),
    ).toEqual({
      aggregationType: MetricsAggregationType.Avg,
      groupByAttributeKeys: [],
      seriesTotal: { key: "state", values: ["ready", "unacknowledged"] },
      minimumRollingTime: null,
      note: null,
    });

    expect(
      getMessageQueueMetricMonitorSeed(
        getDescriptor("activemq", "activemq.message.queue.size"),
      ),
    ).toEqual({
      aggregationType: MetricsAggregationType.Avg,
      groupByAttributeKeys: [
        "activemq.broker.name",
        "activemq.destination.type",
      ],
      seriesTotal: null,
      minimumRollingTime: null,
      note: "The chart adds this metric's series up (one per activemq.broker.name / activemq.destination.type). They are not a fixed set, so a monitor cannot add them together the way the chart does: this one alerts on each series separately. Set a threshold for one series, not for the total.",
    });

    expect(
      getMessageQueueMetricMonitorSeed(
        getDescriptor(
          "aws_sqs",
          "amazonaws.com/aws/sqs/approximatenumberofmessagesvisible",
        ),
      ),
    ).toEqual({
      aggregationType: MetricsAggregationType.Max,
      groupByAttributeKeys: [],
      seriesTotal: null,
      minimumRollingTime: RollingTime.Past30Minutes,
      note: "The chart shows the highest of this metric's series. A monitor folds every series and sample into one number, so this one takes their Max instead of each series' Average.",
    });

    // A CloudWatch count reads CloudWatch's Sum, exactly as charted.
    expect(
      getMessageQueueMetricMonitorSeed(
        getDescriptor(
          "aws.sns",
          "amazonaws.com/aws/sns/numberofnotificationsfailed",
        ),
      ),
    ).toEqual({
      aggregationType: MetricsAggregationType.Sum,
      groupByAttributeKeys: [],
      seriesTotal: null,
      minimumRollingTime: RollingTime.Past30Minutes,
      note: null,
    });

    expect(
      getMessageQueueMetricMonitorSeed(
        getDescriptor("servicebus", "azure_servererrors_total"),
      ),
    ).toEqual({
      aggregationType: MetricsAggregationType.Sum,
      groupByAttributeKeys: [],
      seriesTotal: null,
      minimumRollingTime: null,
      note: null,
    });
  });

  test("a per-period count whose worst series is shown alerts per series when it has series keys", () => {
    expect(
      getMessageQueueMetricMonitorSeed({
        ...getDescriptor("aws.sns", "numberofnotificationsfailed"),
        seriesKeys: ["subscription"],
      }),
    ).toEqual({
      aggregationType: MetricsAggregationType.Sum,
      groupByAttributeKeys: ["subscription"],
      seriesTotal: null,
      minimumRollingTime: null,
      note: "The chart shows the highest of this metric's series (one per subscription). A monitor would add them up, so this one alerts on each series separately, which fires exactly when the highest one crosses the threshold.",
    });
  });

  test("an 'avg' combine keeps the entry's own aggregation, ungrouped", () => {
    expect(
      getMessageQueueMetricMonitorSeed({
        ...getDescriptor("rabbitmq", "rabbitmq.message.current"),
        seriesCombine: "avg",
      }),
    ).toEqual({
      aggregationType: MetricsAggregationType.Avg,
      groupByAttributeKeys: [],
      seriesTotal: null,
      minimumRollingTime: null,
      note: null,
    });
  });

  test("a total of levels with no series keys is one series, read as the chart reads it", () => {
    expect(
      getMessageQueueMetricMonitorSeed(
        getDescriptor("rabbitmq", "rabbitmq.consumer.count"),
      ),
    ).toEqual({
      aggregationType: MetricsAggregationType.Min,
      groupByAttributeKeys: [],
      seriesTotal: null,
      minimumRollingTime: null,
      note: null,
    });
  });

  test("a series total applies only while the entry's series key is exactly the declared one", () => {
    const depth: MessageQueueMetricDescriptor = getDescriptor(
      "rabbitmq",
      "rabbitmq.message.current",
    );

    /*
     * Were the catalog to split the depth by another key too, the declared
     * formula would no longer cover every series: back to per-series.
     */
    expect(
      getMessageQueueMetricMonitorSeed({
        ...depth,
        seriesKeys: ["state", "resource.rabbitmq.vhost.name"],
      }),
    ).toMatchObject({
      groupByAttributeKeys: ["state", "resource.rabbitmq.vhost.name"],
      seriesTotal: null,
    });
    expect(
      getMessageQueueMetricMonitorSeed({ ...depth, seriesKeys: [] }),
    ).toMatchObject({ groupByAttributeKeys: [], seriesTotal: null });
    // A per-period count adds up with a plain Sum, needing no formula.
    expect(
      getMessageQueueMetricMonitorSeed({
        ...depth,
        aggregation: MetricsAggregationType.Sum,
      }),
    ).toMatchObject({
      aggregationType: MetricsAggregationType.Sum,
      seriesTotal: null,
    });
  });

  test("the seed never hands out the catalog's own series-key array", () => {
    const descriptor: MessageQueueMetricDescriptor = getDescriptor(
      "activemq",
      "activemq.message.queue.size",
    );
    const seed: MessageQueueMetricMonitorSeed =
      getMessageQueueMetricMonitorSeed(descriptor)!;

    seed.groupByAttributeKeys.push("resource.service.name");

    expect(descriptor.seriesKeys).toEqual([
      "activemq.broker.name",
      "activemq.destination.type",
    ]);
    expect(
      getMessageQueueMetricMonitorSeed(descriptor)!.groupByAttributeKeys,
    ).toEqual(["activemq.broker.name", "activemq.destination.type"]);
  });
});

describe("MessageQueueAlertTemplates — series totals a formula adds up", () => {
  test("RabbitMQ's depth is the one closed set: ready and unacknowledged", () => {
    expect(
      MESSAGE_QUEUE_SERIES_TOTALS.map(
        (
          definition: MessageQueueSeriesTotalDefinition,
        ): [string, string, Array<string>] => {
          return [
            `${definition.system}:${definition.metricName}`,
            definition.seriesKey,
            [...definition.values],
          ];
        },
      ),
    ).toEqual([
      [
        "rabbitmq:rabbitmq.message.current",
        "state",
        ["ready", "unacknowledged"],
      ],
    ]);
  });

  test.each(
    MESSAGE_QUEUE_SERIES_TOTALS.map(
      (
        definition: MessageQueueSeriesTotalDefinition,
      ): [string, MessageQueueSeriesTotalDefinition] => {
        return [`${definition.system}:${definition.metricName}`, definition];
      },
    ),
  )(
    "%s is a total of levels over exactly its one series key, from a live source",
    (_id: string, definition: MessageQueueSeriesTotalDefinition) => {
      const descriptor: MessageQueueMetricDescriptor = getDescriptor(
        definition.system,
        definition.metricName,
      );

      expect(descriptor.kind).toBe("gauge");
      expect(descriptor.seriesCombine).toBe("sum");
      expect(descriptor.aggregation).not.toBe(MetricsAggregationType.Sum);
      expect(descriptor.seriesKeys).toEqual([definition.seriesKey]);
      // A formula over a late source would join buckets that never align.
      expect(getMessageQueueSourceWindowFloor(descriptor)).toBeNull();
      expect(new Set<string>(definition.values).size).toBe(
        definition.values.length,
      );
      expect(definition.values.length).toBeGreaterThan(1);
      expect(definition.reason.endsWith(".")).toBe(true);
      // The catalog itself says the page adds these series up.
      expect(descriptor.description.toLowerCase()).toContain("added up");
    },
  );

  test("the open sets stay per series: ActiveMQ brokers and Pulsar partitions", () => {
    for (const [system, metricName] of [
      ["activemq", "activemq.message.queue.size"],
      ["activemq", "activemq.message.current"],
      ["pulsar", "pulsar_msg_backlog"],
    ]) {
      const seed: MessageQueueMetricMonitorSeed =
        getMessageQueueMetricMonitorSeed(getDescriptor(system!, metricName!))!;

      expect(seed.seriesTotal).toBeNull();
      expect(seed.groupByAttributeKeys.length).toBeGreaterThan(0);
    }
  });
});

describe("MessageQueueAlertTemplates — the metric monitor view config", () => {
  const PULSAR_BACKLOG_QUERY: MessageQueueMetricMonitorQuery = queryFor(
    getDescriptor("pulsar", "pulsar_msg_backlog"),
    [pulsarPartition("payments", 0), pulsarPartition("payments", 1)],
  )!;

  const RABBITMQ_DEPTH_QUERY: MessageQueueMetricMonitorQuery = queryFor(
    getDescriptor("rabbitmq", "rabbitmq.message.current"),
    [{ "resource.rabbitmq.queue.name": "orders", state: "ready" }],
  )!;

  function onlyConfig(
    view: MessageQueueMetricMonitorViewConfig,
  ): MetricQueryConfigData {
    expect(view.metricViewConfig.queryConfigs).toHaveLength(1);
    expect(view.metricViewConfig.formulaConfigs).toEqual([]);

    return view.metricViewConfig.queryConfigs[0]!;
  }

  test("one query: the alias, the exact filter, the fold, the grouping and the catalog unit", () => {
    const view: MessageQueueMetricMonitorViewConfig =
      buildMessageQueueMetricMonitorViewConfig({
        query: queryFor(
          getDescriptor("servicebus", "azure_activemessages_average"),
          [SERVICE_BUS_ORDERS],
        )!,
        metricVariable: "a",
        title: "Active messages",
      });
    const config: MetricQueryConfigData = onlyConfig(view);

    expect(view.criteriaAlias).toBe("a");
    expect(config).toEqual({
      metricAliasData: {
        metricVariable: "a",
        title: "Active messages",
        description: "Active messages",
        legend: "Active messages",
        legendUnit: "messages",
      },
      metricQueryData: {
        filterData: {
          metricName: "azure_activemessages_average",
          attributes: {
            metadata_entityname: "orders",
            name: "orders-prod",
            type: "Microsoft.ServiceBus/Namespaces",
          },
          aggegationType: MetricsAggregationType.Max,
          aggregateBy: {},
        },
      },
    });
    // Ungrouped: every alert reads as this queue.
    expect(config.metricQueryData.groupByAttributeKeys).toBeUndefined();
  });

  test("a series total: one query per part, each pinned to its value, and the formula adding them up", () => {
    const view: MessageQueueMetricMonitorViewConfig =
      buildMessageQueueMetricMonitorViewConfig({
        query: RABBITMQ_DEPTH_QUERY,
        metricVariable: "queue_backlog",
        title: "Queue Depth High",
        description: "Messages in the queue.",
      });

    expect(view.criteriaAlias).toBe("queue_backlog");
    expect(view.metricViewConfig.queryConfigs).toEqual([
      {
        metricAliasData: {
          metricVariable: "queue_backlog_ready",
          title: "Queue Depth High (ready)",
          description: "Messages in the queue.",
          legend: "Queue Depth High (ready)",
          legendUnit: "messages",
        },
        metricQueryData: {
          filterData: {
            metricName: "rabbitmq.message.current",
            attributes: {
              "resource.rabbitmq.queue.name": "orders",
              state: "ready",
            },
            aggegationType: MetricsAggregationType.Avg,
            aggregateBy: {},
          },
        },
      },
      {
        metricAliasData: {
          metricVariable: "queue_backlog_unacknowledged",
          title: "Queue Depth High (unacknowledged)",
          description: "Messages in the queue.",
          legend: "Queue Depth High (unacknowledged)",
          legendUnit: "messages",
        },
        metricQueryData: {
          filterData: {
            metricName: "rabbitmq.message.current",
            attributes: {
              "resource.rabbitmq.queue.name": "orders",
              state: "unacknowledged",
            },
            aggegationType: MetricsAggregationType.Avg,
            aggregateBy: {},
          },
        },
      },
    ]);
    expect(view.metricViewConfig.formulaConfigs).toEqual([
      {
        metricAliasData: {
          metricVariable: "queue_backlog",
          title: "Queue Depth High",
          description: "Messages in the queue.",
          legend: "Queue Depth High",
          legendUnit: "messages",
        },
        metricFormulaData: {
          metricFormula: "queue_backlog_ready + queue_backlog_unacknowledged",
        },
      },
    ]);
  });

  test("the formula adds the parts bucket by bucket, as the metric formula evaluator runs it", () => {
    const view: MessageQueueMetricMonitorViewConfig =
      buildMessageQueueMetricMonitorViewConfig({
        query: RABBITMQ_DEPTH_QUERY,
        metricVariable: "a",
        title: "Depth",
      });
    const formula: MetricFormulaConfigData =
      view.metricViewConfig.formulaConfigs[0]!;

    expect(
      MetricFormulaEvaluator.evaluateFormula({
        formula: formula.metricFormulaData.metricFormula,
        queryConfigs: view.metricViewConfig.queryConfigs,
        formulaConfigs: [],
        results: [toResult([999, 1200]), toResult([999, 50])],
      }).data.map((point: AggregateModel): number => {
        return point.value;
      }),
    ).toEqual([1998, 1250]);
  });

  test("a grouped query carries its keys, and the config never aliases the query's arrays", () => {
    const config: MetricQueryConfigData = onlyConfig(
      buildMessageQueueMetricMonitorViewConfig({
        query: PULSAR_BACKLOG_QUERY,
        metricVariable: "a",
        title: "Backlog",
        description: "Entries backlogged on the topic.",
      }),
    );

    expect(config.metricAliasData?.description).toBe(
      "Entries backlogged on the topic.",
    );
    expect(config.metricQueryData.groupByAttributeKeys).toEqual([
      "cluster",
      "topic",
      "partition",
    ]);

    const configAttributes: Record<string, unknown> = config.metricQueryData
      .filterData.attributes as Record<string, unknown>;

    config.metricQueryData.groupByAttributeKeys!.push("subscription");
    configAttributes["cluster"] = "standalone";
    ((configAttributes["topic"] as Includes).values as Array<string>).push(
      "persistent://public/default/orders",
    );

    expect(PULSAR_BACKLOG_QUERY.groupByAttributeKeys).toEqual([
      "cluster",
      "topic",
      "partition",
    ]);
    expect(Object.keys(PULSAR_BACKLOG_QUERY.attributes)).toEqual(["topic"]);
    expect(includesValues(PULSAR_BACKLOG_QUERY.attributes["topic"])).toEqual([
      "persistent://public/default/payments-partition-0",
      "persistent://public/default/payments-partition-1",
    ]);

    // Nor does a series total's per-part filter edit the query.
    const parts: Array<MetricQueryConfigData> =
      buildMessageQueueMetricMonitorViewConfig({
        query: RABBITMQ_DEPTH_QUERY,
        metricVariable: "a",
        title: "Depth",
      }).metricViewConfig.queryConfigs;

    (
      parts[0]!.metricQueryData.filterData.attributes as Record<string, unknown>
    )["resource.rabbitmq.queue.name"] = "payments";

    expect(RABBITMQ_DEPTH_QUERY.attributes).toEqual({
      "resource.rabbitmq.queue.name": "orders",
    });
  });

  test("a series total survives the metric explorer's URL schema, formula included", () => {
    const view: MessageQueueMetricMonitorViewConfig =
      buildMessageQueueMetricMonitorViewConfig({
        query: RABBITMQ_DEPTH_QUERY,
        metricVariable: "a",
        title: "Depth",
      });
    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData({
        queryConfigs: view.metricViewConfig.queryConfigs,
        formulaConfigs: view.metricViewConfig.formulaConfigs,
        startAndEndDate: null,
      });
    const queries: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(params["metricQueries"] || "");
    const formulas: Array<SerializedMetricFormula> =
      MetricExplorerUrl.parseMetricFormulasParam(
        params["metricFormulas"] || "",
      );

    expect(
      queries.map((query: SerializedMetricQuery): unknown => {
        return query.attributes;
      }),
    ).toEqual([
      { "resource.rabbitmq.queue.name": "orders", state: "ready" },
      { "resource.rabbitmq.queue.name": "orders", state: "unacknowledged" },
    ]);
    expect(formulas).toHaveLength(1);
    expect(formulas[0]!.formula).toBe("a_ready + a_unacknowledged");
    expect(formulas[0]!.variable).toBe("a");
  });

  test("survives the metric explorer's URL schema the Create monitor link travels in", () => {
    const config: MetricQueryConfigData = onlyConfig(
      buildMessageQueueMetricMonitorViewConfig({
        query: PULSAR_BACKLOG_QUERY,
        metricVariable: "a",
        title: "Backlog",
      }),
    );
    const params: Dictionary<string> =
      MetricExplorerUrl.buildQueryParamsFromMetricViewData({
        queryConfigs: [config],
        formulaConfigs: [],
        startAndEndDate: null,
      });
    const parsed: Array<SerializedMetricQuery> =
      MetricExplorerUrl.parseMetricQueriesParam(params["metricQueries"] || "");

    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.metricName).toBe("pulsar_msg_backlog");
    expect(parsed[0]!.aggregationType).toBe(MetricsAggregationType.Avg);
    expect(parsed[0]!.groupByAttributeKeys).toEqual([
      "cluster",
      "topic",
      "partition",
    ]);
    expect(parsed[0]!.alias?.legendUnit).toBe("messages");
    expect(includesValues(parsed[0]!.attributes!["topic"])).toEqual([
      "persistent://public/default/payments-partition-0",
      "persistent://public/default/payments-partition-1",
    ]);
  });
});

/*
 * The group-by contract (see TemplateGroupByKeys.test.ts): a template must
 * never silently lose, or gain, its per-series group-by. An ungrouped
 * template over series the chart adds up would fold them into a number
 * nobody sees; a grouped one over series the chart takes the worst of would
 * page once per consumer group.
 */
describe("MessageQueueAlertTemplates — group-by contract", () => {
  test("every template has a group-by expectation (exhaustive both ways)", () => {
    expect(
      ALL_TEMPLATES.map((template: MessageQueueAlertTemplate): string => {
        return template.id;
      }).sort(),
    ).toEqual(
      EXPECTED_TEMPLATES.map((expected: ExpectedTemplate): string => {
        return expected.id;
      }).sort(),
    );
  });

  test.each(TEMPLATE_CASES)(
    "%s groups by the expected attribute keys",
    (id: string, template: MessageQueueAlertTemplate) => {
      const step: MonitorStep = stepFor(template);

      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(
        expectationFor(id).groupByAttributeKeys,
      );
      expect(template.groupByAttributeKeys).toEqual(
        expectationFor(id).groupByAttributeKeys,
      );
    },
  );

  test("exactly the totals of levels over an open set are grouped, by their catalog series keys; a closed set is added up", () => {
    for (const template of ALL_TEMPLATES) {
      const descriptor: MessageQueueMetricDescriptor = descriptorOf(template);
      const totalOfLevels: boolean =
        descriptor.seriesCombine === "sum" &&
        descriptor.aggregation !== MetricsAggregationType.Sum;
      const closedSet: boolean =
        seriesTotalDefinitionOf(descriptor) !== undefined;

      expect({
        id: template.id,
        grouped: template.groupByAttributeKeys,
        added: template.seriesTotal !== null,
      }).toEqual({
        id: template.id,
        grouped:
          totalOfLevels && !closedSet ? [...(descriptor.seriesKeys || [])] : [],
        added: totalOfLevels && closedSet,
      });

      if (totalOfLevels) {
        // Every total of levels has series keys to group by or add up.
        expect((descriptor.seriesKeys || []).length).toBeGreaterThan(0);
      }
    }
  });

  test("the grouped templates, explicitly", () => {
    expect(
      ALL_TEMPLATES.filter((template: MessageQueueAlertTemplate): boolean => {
        return template.groupByAttributeKeys.length > 0;
      }).map((template: MessageQueueAlertTemplate): [string, Array<string>] => {
        return [template.id, template.groupByAttributeKeys];
      }),
    ).toEqual([
      [
        "message-queue-activemq-activemq-message-queue-size",
        ["activemq.broker.name", "activemq.destination.type"],
      ],
      ["message-queue-activemq-activemq-message-current", ["broker"]],
      [
        "message-queue-pulsar-pulsar-msg-backlog",
        ["cluster", "topic", "partition"],
      ],
    ]);
  });

  test("the templates that add series up with a formula, explicitly", () => {
    expect(
      ALL_TEMPLATES.filter((template: MessageQueueAlertTemplate): boolean => {
        return template.seriesTotal !== null;
      }).map(
        (
          template: MessageQueueAlertTemplate,
        ): [string, MessageQueueSeriesTotal | null] => {
          return [template.id, template.seriesTotal];
        },
      ),
    ).toEqual([
      [
        "message-queue-rabbitmq-rabbitmq-message-current",
        { key: "state", values: ["ready", "unacknowledged"] },
      ],
    ]);
  });

  test("no template groups by the queue's scope or its required attributes", () => {
    for (const template of ALL_TEMPLATES) {
      const descriptor: MessageQueueMetricDescriptor = descriptorOf(template);

      for (const key of template.groupByAttributeKeys) {
        expect(descriptor.seriesKeys || []).toContain(key);
        expect(descriptor.scopeAttributes || []).not.toContain(key);
        expect(Object.keys(descriptor.requiredAttributes || {})).not.toContain(
          key,
        );
      }
    }
  });
});

describe("MessageQueueAlertTemplates — the monitor step each template builds", () => {
  test.each(TEMPLATE_CASES)(
    "%s passes monitor validation as a Metrics monitor",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: [stepFor(template)],
        defaultMonitorStatusId: ObjectID.generate(),
      };

      expect(MonitorSteps.getValidationError(steps, MonitorType.Metrics)).toBe(
        null,
      );
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s queries exactly what the Create monitor link would, for the same series",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const fixture: MetricFixture = fixtureFor(template);
      const step: MonitorStep = stepFor(template);
      const link: MessageQueueMetricMonitorViewConfig =
        buildMessageQueueMetricMonitorViewConfig({
          query: queryFor(descriptorOf(template), [fixture.attributes])!,
          metricVariable: "a",
          title: "whatever the link calls it",
        });
      const queryConfigs: Array<MetricQueryConfigData> = queryConfigsOf(step);

      // ONE code path: same queries, filters, folds, groupings and units.
      expect(queryConfigs).toHaveLength(
        link.metricViewConfig.queryConfigs.length,
      );
      expect(formulaConfigsOf(step)).toHaveLength(
        link.metricViewConfig.formulaConfigs.length,
      );

      queryConfigs.forEach(
        (queryConfig: MetricQueryConfigData, index: number): void => {
          const linkConfig: MetricQueryConfigData =
            link.metricViewConfig.queryConfigs[index]!;

          expect(queryConfig.metricQueryData.filterData).toEqual(
            linkConfig.metricQueryData.filterData,
          );
          expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual(
            linkConfig.metricQueryData.groupByAttributeKeys,
          );
          expect(queryConfig.metricAliasData?.legendUnit).toBe(
            linkConfig.metricAliasData?.legendUnit,
          );
          expect(queryConfig.metricAliasData?.legendUnit).toBe(template.unit);
          expect(queryConfig.metricQueryData.filterData.metricName).toBe(
            template.metricName,
          );
          expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
            template.aggregationType,
          );
        },
      );

      // The criteria read the query, or the formula adding the parts up.
      const compared: MetricQueryConfigData | MetricFormulaConfigData =
        template.seriesTotal ? formulaConfigsOf(step)[0]! : queryConfigs[0]!;

      expect(compared.metricAliasData?.metricVariable).toBe(
        criteriaAliasOf(step),
      );
      expect(compared.metricAliasData?.title).toBe(template.name);
      expect(compared.metricAliasData?.legendUnit).toBe(template.unit);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s scopes its queries to the observed queue, and nothing else",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const fixture: MetricFixture = fixtureFor(template);
      const step: MonitorStep = stepFor(template);

      for (const queryConfig of queryConfigsOf(step)) {
        const attributes: Record<string, unknown> =
          filterAttributes(queryConfig);

        expect(Object.keys(attributes).length).toBeGreaterThan(0);
        expect(resolvedIdentifier(template.metricName, attributes)).toBe(
          resolvedIdentifier(fixture.metricName, fixture.attributes),
        );
      }

      /*
       * Not scoped by primaryEntityId: a broker metric belongs to no
       * service, and the scope is the filter.
       */
      expect(step.data?.metricMonitor?.telemetryServiceIds || []).toEqual([]);
      expect(step.data?.metricMonitor?.rollingTime).toBe(template.rollingTime);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s has distinct aliases, and every criteria alias resolves to one",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const step: MonitorStep = stepFor(template);
      const aliases: Array<string> = [
        ...queryConfigsOf(step).map(
          (queryConfig: MetricQueryConfigData): string => {
            return queryConfig.metricAliasData?.metricVariable || "";
          },
        ),
        ...formulaConfigsOf(step).map(
          (formulaConfig: MetricFormulaConfigData): string => {
            return formulaConfig.metricAliasData?.metricVariable || "";
          },
        ),
      ];

      expect(aliases).not.toContain("");
      expect(new Set<string>(aliases).size).toBe(aliases.length);

      // A formula exactly when the template adds a series total up.
      expect(formulaConfigsOf(step)).toHaveLength(template.seriesTotal ? 1 : 0);
      expect(queryConfigsOf(step)).toHaveLength(
        template.seriesTotal ? template.seriesTotal.values.length : 1,
      );

      const offered: Array<string> =
        MonitorStepMetricViewConfigUtil.getMetricVariables(step.data);

      for (const instance of getCriteriaInstances(step)) {
        for (const filter of instance.data?.filters || []) {
          expect(filter.checkOn).toBe(CheckOn.MetricValue);
          expect(offered).toContain(filter.metricMonitorOptions?.metricAlias);
          expect(filter.metricMonitorOptions?.metricAlias).toBe(
            criteriaAliasOf(step),
          );
        }
      }
    },
  );

  test("RabbitMQ's depth monitor: a query per state and the criteria on their sum", () => {
    const step: MonitorStep = stepFor(
      getTemplate("message-queue-rabbitmq-rabbitmq-message-current"),
    );

    expect(
      queryConfigsOf(step).map(
        (queryConfig: MetricQueryConfigData): [string, unknown] => {
          return [
            queryConfig.metricAliasData?.metricVariable || "",
            filterAttributes(queryConfig)["state"],
          ];
        },
      ),
    ).toEqual([
      ["queue_backlog_ready", "ready"],
      ["queue_backlog_unacknowledged", "unacknowledged"],
    ]);
    expect(formulaConfigsOf(step)[0]!.metricFormulaData.metricFormula).toBe(
      "queue_backlog_ready + queue_backlog_unacknowledged",
    );
    expect(criteriaAliasOf(step)).toBe("queue_backlog");
    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);
    expect(getUnhealthy(step).data!.description).toContain(
      "rabbitmq.message.current (resource.rabbitmq.queue.name = orders), state ready + unacknowledged",
    );
  });

  test.each(TEMPLATE_CASES)(
    "%s ships one breach and one recovery criteria",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const args: MessageQueueAlertTemplateArgs = argsFor(template);
      const step: MonitorStep = stepFor(template, args);
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);

      expect(instances.length).toBe(2);

      const unhealthy: MonitorCriteriaInstance = getUnhealthy(step);
      const healthy: MonitorCriteriaInstance = getHealthy(step);

      expect(unhealthy.data!.createIncidents).toBe(true);
      expect(unhealthy.data!.createAlerts).toBe(true);
      expect(unhealthy.data!.monitorStatusId).toEqual(
        args.offlineMonitorStatusId,
      );
      expect(unhealthy.data!.incidents[0]!.title).toBe(
        `[Queue] ${template.name} - ${args.monitorName}`,
      );
      expect(unhealthy.data!.incidents[0]!.incidentSeverityId).toEqual(
        args.defaultIncidentSeverityId,
      );
      expect(unhealthy.data!.alerts[0]!.alertSeverityId).toEqual(
        args.defaultAlertSeverityId,
      );
      expect(unhealthy.data!.incidents[0]!.autoResolveIncident).toBe(true);
      expect(unhealthy.data!.alerts[0]!.autoResolveAlert).toBe(true);
      expect(unhealthy.data!.incidents[0]!.description?.endsWith(".")).toBe(
        true,
      );
      expect(unhealthy.data!.name).toBe(
        `${template.name} - ${template.thresholdLabel}`,
      );
      expect(unhealthy.data!.description).toMatch(/^Triggers when /);
      expect(unhealthy.data!.description).toContain(template.metricName);
      expect(unhealthy.data!.description).toContain(template.thresholdLabel);
      expect(unhealthy.data!.description).not.toContain("undefined");

      expect(healthy.data!.name).toBe("Healthy");
      expect(healthy.data!.createIncidents).toBe(false);
      expect(healthy.data!.createAlerts).toBe(false);
      expect(healthy.data!.monitorStatusId).toEqual(args.onlineMonitorStatusId);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s breaches at its threshold and recovers below a dead band, over the whole window",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const step: MonitorStep = stepFor(template);
      const breach: CriteriaFilter = getUnhealthy(step).data!.filters[0]!;
      const recovery: CriteriaFilter = getHealthy(step).data!.filters[0]!;

      expect(getUnhealthy(step).data!.filters).toHaveLength(1);
      expect(getHealthy(step).data!.filters).toHaveLength(1);

      expect(breach.filterType).toBe(FilterType.GreaterThanOrEqualTo);
      expect(breach.value).toBe(template.threshold);
      expect(breach.metricMonitorOptions?.metricAggregationType).toBe(
        template.evaluation,
      );

      expect(recovery.filterType).toBe(FilterType.LessThan);
      expect(recovery.value).toBeCloseTo(template.threshold * 0.9, 6);
      expect(recovery.metricMonitorOptions?.metricAggregationType).toBe(
        EvaluateOverTimeType.AllValues,
      );

      // No template ever fires on silence...
      expect(breach.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();
      // ...and recovery reads silence as zero exactly where it means zero.
      expect(recovery.metricMonitorOptions?.onNoDataPolicy).toBe(
        template.recoverOnNoData ? NoDataPolicy.TreatAsZero : undefined,
      );
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s survives the JSON round trip a saved monitor takes",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const step: MonitorStep = stepFor(template);
      const restored: MonitorStep = MonitorStep.fromJSON(
        JSON.parse(JSON.stringify(step.toJSON())),
      );

      expect(queryConfigsOf(restored)).toHaveLength(
        queryConfigsOf(step).length,
      );
      queryConfigsOf(step).forEach(
        (queryConfig: MetricQueryConfigData, index: number): void => {
          const restoredConfig: MetricQueryConfigData =
            queryConfigsOf(restored)[index]!;

          expect(restoredConfig.metricQueryData.filterData).toEqual(
            queryConfig.metricQueryData.filterData,
          );
          expect(restoredConfig.metricQueryData.groupByAttributeKeys).toEqual(
            queryConfig.metricQueryData.groupByAttributeKeys,
          );
        },
      );
      // A series total's formula, and the alias its criteria compare.
      expect(formulaConfigsOf(restored)).toEqual(formulaConfigsOf(step));
      expect(criteriaAliasOf(restored)).toBe(criteriaAliasOf(step));
      expect(
        getUnhealthy(restored).data!.filters[0]!.metricMonitorOptions,
      ).toEqual(getUnhealthy(step).data!.filters[0]!.metricMonitorOptions);
      expect(
        getHealthy(restored).data!.filters[0]!.metricMonitorOptions,
      ).toEqual(getHealthy(step).data!.filters[0]!.metricMonitorOptions);
    },
  );

  test("a partitioned topic's Includes survives the round trip as an Includes", () => {
    const template: MessageQueueAlertTemplate = getTemplate(
      "message-queue-pulsar-pulsar-subscription-back-log",
    );
    const step: MonitorStep = stepFor(
      template,
      buildArgs([
        { ...pulsarPartition("payments", 0), subscription: "ledger" },
        { ...pulsarPartition("payments", 1), subscription: "ledger" },
      ]),
    );
    const restored: MonitorStep = MonitorStep.fromJSON(
      JSON.parse(JSON.stringify(step.toJSON())),
    );

    expect(
      includesValues(filterAttributes(onlyQuery(restored))["topic"]),
    ).toEqual([
      "persistent://public/default/payments-partition-0",
      "persistent://public/default/payments-partition-1",
    ]);
  });

  test("the scope follows the queue it is built for", () => {
    const template: MessageQueueAlertTemplate = getTemplate(
      "message-queue-servicebus-azure-activemessages-average",
    );

    expect(
      filterAttributes(
        onlyQuery(
          stepFor(
            template,
            buildArgs([
              { ...SERVICE_BUS_ORDERS, metadata_entityname: "payments" },
            ]),
          ),
        ),
      )["metadata_entityname"],
    ).toBe("payments");
  });

  test("a template given nothing it can scope builds no monitor", () => {
    const template: MessageQueueAlertTemplate = getTemplate(
      "message-queue-servicebus-azure-servererrors-total",
    );

    expect(template.getMonitorStep(buildArgs([]))).toBeNull();
    // Event Hubs' series under the same metric name is another entry's.
    expect(
      template.getMonitorStep(buildArgs([EVENT_HUBS_TELEMETRY])),
    ).toBeNull();
    // The queue's identity rules out another queue's series.
    expect(
      template.getMonitorStep(
        buildArgs([SERVICE_BUS_ORDERS], {
          identity: parseMessageQueueIdentifier(
            "servicebus|orders-prod|payments",
          ),
        }),
      ),
    ).toBeNull();
    expect(
      template.getMonitorStep(null as unknown as MessageQueueAlertTemplateArgs),
    ).toBeNull();
  });

  test("the identity the queue row stores scopes the step", () => {
    const template: MessageQueueAlertTemplate = getTemplate(
      "message-queue-servicebus-azure-activemessages-average",
    );

    expect(
      template.getMonitorStep(
        buildArgs([SERVICE_BUS_ORDERS], {
          identity: parseMessageQueueIdentifier(
            "servicebus|orders-prod|orders",
          ),
        }),
      ),
    ).not.toBeNull();
  });
});

describe("MessageQueueAlertTemplates — system matching", () => {
  test("a system gets exactly its own templates, in display order", () => {
    for (const system of getMessageQueueSystemsWithAlertTemplates()) {
      expect(
        getMessageQueueAlertTemplates(system).map(
          (template: MessageQueueAlertTemplate): string => {
            return template.id;
          },
        ),
      ).toEqual(
        EXPECTED_TEMPLATES.filter((expected: ExpectedTemplate): boolean => {
          return expected.system === system;
        }).map((expected: ExpectedTemplate): string => {
          return expected.id;
        }),
      );
    }
  });

  test.each([
    ["AmazonSQS", "aws_sqs"],
    ["  aws.sqs  ", "aws_sqs"],
    ["SQS", "aws_sqs"],
    ["aws_sns", "aws.sns"],
    ["azure_servicebus", "servicebus"],
    ["Microsoft.ServiceBus", "servicebus"],
    ["azure.eventhubs", "eventhubs"],
    ["artemis", "activemq"],
    ["apache_pulsar", "pulsar"],
    ["gcp.pubsub", "gcp_pubsub"],
    ["KAFKA", "kafka"],
  ])("accepts %p as %p", (spelling: string, system: string) => {
    expect(getMessageQueueAlertTemplates(spelling)).toEqual(
      getMessageQueueAlertTemplates(system),
    );
    expect(getMessageQueueAlertTemplates(spelling).length).toBeGreaterThan(0);
  });

  test("a system without curated broker metrics, an unknown and an empty one get nothing", () => {
    for (const system of [
      "jms",
      "nats",
      "bullmq",
      "eventgrid",
      "ibmmq",
      "spring_integration",
      "",
      "   ",
      null,
      undefined,
      "not a system",
    ]) {
      expect(getMessageQueueAlertTemplates(system)).toEqual([]);
    }

    expect(getMessageQueueAlertTemplates(42 as unknown as string)).toEqual([]);
  });

  test("never offers one Azure service's templates to the other", () => {
    const serviceBus: Array<string> = getMessageQueueAlertTemplates(
      "servicebus",
    ).map((template: MessageQueueAlertTemplate): string => {
      return template.id;
    });

    for (const template of getMessageQueueAlertTemplates("eventhubs")) {
      expect(serviceBus).not.toContain(template.id);
      expect(template.system).toBe("eventhubs");
    }
  });

  test("by id: the template, or nothing", () => {
    expect(
      getMessageQueueAlertTemplateById(
        "message-queue-kafka-kafka-consumer-group-lag-sum",
      )?.name,
    ).toBe("Consumer Lag High");
    expect(getMessageQueueAlertTemplateById("database-mysql-restarted")).toBe(
      undefined,
    );
    expect(getMessageQueueAlertTemplateById("")).toBe(undefined);
  });

  test("by catalog entry: where the Create monitor link reads its default threshold", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      const template: MessageQueueAlertTemplate | undefined =
        getMessageQueueAlertTemplateForMetric(descriptor);
      const policy: MessageQueueAlertPolicy | null =
        getMessageQueueAlertPolicy(descriptor);

      if (!policy) {
        expect(template).toBeUndefined();
        continue;
      }

      expect(template).toBeDefined();
      expect(template!.metricId).toBe(getMessageQueueMetricId(descriptor));
      expect(template!.threshold).toBe(policy.threshold);
    }

    // Service Bus and Event Hubs share the name, not the template.
    expect(
      getMessageQueueAlertTemplateForMetric(
        getDescriptor("servicebus", "azure_throttledrequests_total"),
      )!.id,
    ).toBe("message-queue-servicebus-azure-throttledrequests-total");
    expect(
      getMessageQueueAlertTemplateForMetric(
        getDescriptor("eventhubs", "azure_throttledrequests_total"),
      )!.id,
    ).toBe("message-queue-eventhubs-azure-throttledrequests-total");
    expect(
      getMessageQueueAlertTemplateForMetric(
        null as unknown as MessageQueueMetricDescriptor,
      ),
    ).toBeUndefined();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Behaviour: run templates against broker-shaped data through a port of the
 * metric engine's folds, the real unit conversion, the real formula
 * evaluator and the real metric criteria evaluator.
 * ---------------------------------------------------------------------------
 */

type SamplesByAlias = Record<string, Array<number>>;

/*
 * The unit each source declares, as the worker loads it from MetricType:
 * Kafka's dimensionless "1", RabbitMQ's annotation, Azure Monitor's
 * "Count", CloudWatch's "Count" / "Seconds", Cloud Monitoring's "1" / "s".
 * A Prometheus scrape declares none. The legend unit the templates carry
 * decides how the alert reads; these decide what conversion runs first.
 */
const NATIVE_UNITS_BY_METRIC_NAME: Record<string, string> = {
  "kafka.consumer_group.lag_sum": "1",
  "rabbitmq.message.current": "{messages}",
  azure_activemessages_average: "Count",
  azure_deadletteredmessages_average: "Count",
  azure_abandonmessage_total: "Count",
  azure_servererrors_total: "Count",
  azure_usererrors_total: "Count",
  azure_throttledrequests_total: "Count",
  "amazonaws.com/aws/sqs/approximateageofoldestmessage": "Seconds",
  approximateageofoldestmessage: "Seconds",
  "amazonaws.com/aws/sqs/approximatenumberofmessagesnotvisible": "Count",
  "amazonaws.com/aws/sns/numberofnotificationsfailed": "Count",
  numberofnotificationsfailed: "Count",
  "amazonaws.com/aws/sns/numberofnotificationsredriventodlq": "Count",
  numberofnotificationsredriventodlq: "Count",
  "pubsub.googleapis.com/subscription/dead_letter_message_count": "1",
  "pubsub.googleapis.com/subscription/oldest_unacked_message_age": "s",
};

const START: number = Date.UTC(2026, 8, 30, 12, 0, 0);

// One sample per minute from START.
function toResult(samples: Array<number>): AggregatedResult {
  return {
    data: samples.map((value: number, index: number): AggregateModel => {
      return {
        timestamp: new Date(START + index * 60000),
        value: value,
      } as AggregateModel;
    }),
  };
}

// A folded bucket: the minute (from START) and its value.
interface MinutePoint {
  minute: number;
  value: number;
}

function toMinuteResult(points: Array<MinutePoint>): AggregatedResult {
  return {
    data: points.map((point: MinutePoint): AggregateModel => {
      return {
        timestamp: new Date(START + point.minute * 60000),
        value: point.value,
      } as AggregateModel;
    }),
  };
}

/*
 * What the telemetry worker hands the evaluator for an ungrouped monitor
 * (monitorMetric in MonitorTelemetryMonitor): each query's aggregated
 * result, converted from the metric's native unit into the query's legend
 * unit, then each formula evaluated over them in order.
 */
function buildResponseFromResults(
  step: MonitorStep,
  results: Array<AggregatedResult>,
): MetricMonitorResponse {
  const viewConfig: MetricsViewConfig = getViewConfig(step);
  const withFormulas: Array<AggregatedResult> = [
    ...MetricResultUnitConverter.convertQueryResultsToDisplayUnit({
      queryConfigs: viewConfig.queryConfigs,
      results: results,
      nativeUnitByMetricName: new Map<string, string>(
        Object.entries(NATIVE_UNITS_BY_METRIC_NAME),
      ),
    }),
  ];
  const formulaConfigs: Array<MetricFormulaConfigData> =
    viewConfig.formulaConfigs || [];

  formulaConfigs.forEach(
    (formulaConfig: MetricFormulaConfigData, index: number): void => {
      withFormulas.push(
        MetricFormulaEvaluator.evaluateFormula({
          formula: formulaConfig.metricFormulaData.metricFormula,
          queryConfigs: viewConfig.queryConfigs,
          formulaConfigs: formulaConfigs.slice(0, index),
          results: withFormulas,
        }),
      );
    },
  );

  return {
    projectId: ObjectID.generate(),
    metricResult: withFormulas,
    metricViewConfig: viewConfig,
    monitorId: ObjectID.generate(),
    nativeUnitsByMetricName: NATIVE_UNITS_BY_METRIC_NAME,
  };
}

function buildResponse(
  step: MonitorStep,
  samplesByAlias: SamplesByAlias,
): MetricMonitorResponse {
  return buildResponseFromResults(
    step,
    queryConfigsOf(step).map(
      (queryConfig: MetricQueryConfigData): AggregatedResult => {
        return toResult(
          samplesByAlias[queryConfig.metricAliasData?.metricVariable || ""] ||
            [],
        );
      },
    ),
  );
}

/*
 * Samples for whatever the criteria compare: the one query's own, or — for
 * a series total — an even share for each part, which the formula adds
 * back up to the sample.
 */
function criteriaSamples(
  step: MonitorStep,
  samples: Array<number>,
): SamplesByAlias {
  const queryConfigs: Array<MetricQueryConfigData> = queryConfigsOf(step);
  const parts: number =
    formulaConfigsOf(step).length > 0 ? queryConfigs.length : 1;
  const samplesByAlias: SamplesByAlias = {};

  for (const queryConfig of queryConfigs) {
    samplesByAlias[queryConfig.metricAliasData?.metricVariable || ""] =
      samples.map((value: number): number => {
        return value / parts;
      });
  }

  return samplesByAlias;
}

// The root cause one criteria filter writes, or null when it is not met.
async function getRootCause(
  step: MonitorStep,
  filter: CriteriaFilter,
  response: MetricMonitorResponse,
): Promise<string | null> {
  return await MetricMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
    dataToProcess: response,
    // A copy: the evaluator writes its context back onto the filter.
    criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
    monitorStep: step,
  });
}

async function isInstanceMet(
  step: MonitorStep,
  instance: MonitorCriteriaInstance,
  response: MetricMonitorResponse,
): Promise<boolean> {
  const results: Array<boolean> = [];

  for (const filter of instance.data!.filters) {
    results.push((await getRootCause(step, filter, response)) !== null);
  }

  return instance.data!.filterCondition === FilterCondition.All
    ? results.every((met: boolean): boolean => {
        return met;
      })
    : results.some((met: boolean): boolean => {
        return met;
      });
}

interface Outcome {
  breached: boolean;
  healthy: boolean;
}

async function outcomeOf(
  step: MonitorStep,
  response: MetricMonitorResponse,
): Promise<Outcome> {
  return {
    breached: await isInstanceMet(step, getUnhealthy(step), response),
    healthy: await isInstanceMet(step, getHealthy(step), response),
  };
}

async function evaluate(
  templateId: string,
  samples: Array<number>,
): Promise<Outcome> {
  const step: MonitorStep = stepFor(getTemplate(templateId));

  return await outcomeOf(
    step,
    buildResponse(step, criteriaSamples(step, samples)),
  );
}

// --- the metric engine's folds ------------------------------------------------

/*
 * One stored Metric row, as far as a fold reads it: `value`, and for a
 * distribution point (a histogram or a summary: `count` set) its count,
 * sum, min and max. A CloudWatch point is a Summary — count = SampleCount,
 * sum = Sum (mirrored into value) — with no min or max column, because a
 * Summary proto carries none (OtelMetricsIngestService reads the point's
 * `min` / `max`, which only a histogram has).
 */
interface StoredPoint {
  value: number | null;
  count?: number | null | undefined;
  sum?: number | null | undefined;
  min?: number | null | undefined;
  max?: number | null | undefined;
}

function isPresent(value: number | null | undefined): value is number {
  return value !== null && value !== undefined;
}

/*
 * How the metric engine folds one bucket of rows for a scalar aggregation:
 * a port of MetricService.getDistributionAwareAggregationExpression, which
 * every template query compiles to (its attribute filter keeps it off the
 * rollups). "the metric engine's folds" below pins the SQL this ports, and
 * runs it on a real ClickHouse when TEST_CLICKHOUSE_URL is set.
 */
function engineFold(
  points: Array<StoredPoint>,
  aggregationType: MetricsAggregationType,
): number | null {
  const observationTotal: (point: StoredPoint) => number | null = (
    point: StoredPoint,
  ): number | null => {
    return isPresent(point.sum) ? point.sum : point.value;
  };
  const isDistribution: (point: StoredPoint) => boolean = (
    point: StoredPoint,
  ): boolean => {
    return isPresent(point.count) && isPresent(observationTotal(point));
  };
  const bound: (
    point: StoredPoint,
    stored: number | null | undefined,
  ) => number | null = (
    point: StoredPoint,
    stored: number | null | undefined,
  ): number | null => {
    if (isPresent(stored)) {
      return stored;
    }
    if (isDistribution(point) && point.count! > 0) {
      return observationTotal(point)! / point.count!;
    }
    return isPresent(point.value) ? point.value : null;
  };

  let total: number = 0;
  let observations: number = 0;

  for (const point of points) {
    if (isDistribution(point)) {
      total += observationTotal(point)!;
      observations += point.count!;
    } else if (isPresent(point.value)) {
      total += point.value;
      observations += 1;
    }
  }

  const bounds: (
    pick: (point: StoredPoint) => number | null,
  ) => Array<number> = (
    pick: (point: StoredPoint) => number | null,
  ): Array<number> => {
    return points
      .map((point: StoredPoint): number | null => {
        return pick(point);
      })
      .filter((value: number | null): value is number => {
        return value !== null;
      });
  };

  switch (aggregationType) {
    case MetricsAggregationType.Sum:
      return total;
    case MetricsAggregationType.Count:
      return observations;
    case MetricsAggregationType.Avg:
      return observations === 0 ? 0 : total / observations;
    case MetricsAggregationType.Min: {
      const values: Array<number> = bounds(
        (point: StoredPoint): number | null => {
          return bound(point, point.min);
        },
      );
      return values.length > 0 ? Math.min(...values) : null;
    }
    case MetricsAggregationType.Max: {
      const values: Array<number> = bounds(
        (point: StoredPoint): number | null => {
          return bound(point, point.max);
        },
      );
      return values.length > 0 ? Math.max(...values) : null;
    }
    default:
      throw new Error(`No engine fold for ${aggregationType}`);
  }
}

/*
 * One datapoint row as ingest stores it: the metric, its flattened
 * attributes, the second of the window it was taken at, and its value
 * (with count / sum for a Summary point).
 */
interface BrokerRow extends StoredPoint {
  second: number;
  metricName: string;
  attributes: Record<string, string>;
  value: number;
}

function matchesFilter(value: string | undefined, filter: unknown): boolean {
  if (filter instanceof Includes) {
    return (filter.values as Array<string>).includes(value || "");
  }

  return value === filter;
}

/*
 * What the worker's ClickHouse query does with raw rows for one query: keep
 * the rows of the query's metric whose attributes pass every filter, split
 * them into one series per value of the group-by keys, and fold each
 * one-minute bucket of each series the way the engine folds it.
 */
function aggregateQueryRows(
  queryConfig: MetricQueryConfigData,
  rows: Array<BrokerRow>,
): Array<{ labels: Record<string, string>; points: Array<MinutePoint> }> {
  const filters: Record<string, unknown> = filterAttributes(queryConfig);
  const groupBy: Array<string> =
    queryConfig.metricQueryData.groupByAttributeKeys || [];
  const bySeries: Map<string, Map<number, Array<BrokerRow>>> = new Map<
    string,
    Map<number, Array<BrokerRow>>
  >();

  for (const row of rows) {
    const matches: boolean =
      row.metricName === queryConfig.metricQueryData.filterData.metricName &&
      Object.keys(filters).every((key: string): boolean => {
        return matchesFilter(row.attributes[key], filters[key]);
      });

    if (!matches) {
      continue;
    }

    const labels: Record<string, string> = {};
    for (const key of groupBy) {
      labels[key] = row.attributes[key] || "";
    }

    const seriesKey: string = JSON.stringify(labels);
    const minutes: Map<number, Array<BrokerRow>> = bySeries.get(seriesKey) ||
    new Map<number, Array<BrokerRow>>();
    const minute: number = Math.floor(row.second / 60);

    minutes.set(minute, [...(minutes.get(minute) || []), row]);
    bySeries.set(seriesKey, minutes);
  }

  return Array.from(bySeries.keys()).map(
    (
      seriesKey: string,
    ): { labels: Record<string, string>; points: Array<MinutePoint> } => {
      const minutes: Map<number, Array<BrokerRow>> = bySeries.get(seriesKey)!;
      const points: Array<MinutePoint> = [];

      for (const minute of Array.from(minutes.keys()).sort(
        (a: number, b: number): number => {
          return a - b;
        },
      )) {
        const value: number | null = engineFold(
          minutes.get(minute)!,
          queryConfig.metricQueryData.filterData
            .aggegationType as MetricsAggregationType,
        );

        if (value !== null) {
          points.push({ minute: minute, value: value });
        }
      }

      return {
        labels: JSON.parse(seriesKey) as Record<string, string>,
        points: points,
      };
    },
  );
}

// An ungrouped monitor over raw rows: every query folded, formulas added.
function buildResponseFromRows(
  step: MonitorStep,
  rows: Array<BrokerRow>,
): MetricMonitorResponse {
  expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual([]);

  return buildResponseFromResults(
    step,
    queryConfigsOf(step).map(
      (queryConfig: MetricQueryConfigData): AggregatedResult => {
        const series: Array<{
          labels: Record<string, string>;
          points: Array<MinutePoint>;
        }> = aggregateQueryRows(queryConfig, rows);

        // Ungrouped: everything the filter lets through is one series.
        expect(series.length).toBeLessThanOrEqual(1);

        return toMinuteResult(series[0]?.points || []);
      },
    ),
  );
}

/*
 * A monitor evaluated the way the worker evaluates it over raw rows: an
 * ungrouped one as one number for the queue ("queue"), a grouped one per
 * series, each judged on its own (keyed by its labels).
 */
async function evaluateRows(
  step: MonitorStep,
  rows: Array<BrokerRow>,
): Promise<Record<string, Outcome>> {
  if (MonitorStep.getGroupByAttributeKeys(step).length === 0) {
    return { queue: await outcomeOf(step, buildResponseFromRows(step, rows)) };
  }

  // The grouped templates each read one query (see the group-by contract).
  expect(queryConfigsOf(step)).toHaveLength(1);

  const series: Array<{
    labels: Record<string, string>;
    points: Array<MinutePoint>;
  }> = aggregateQueryRows(queryConfigsOf(step)[0]!, rows);
  const response: MetricMonitorResponse = buildResponse(step, {});

  response.seriesBreakdown = series.map(
    (entry: {
      labels: Record<string, string>;
      points: Array<MinutePoint>;
    }): MetricSeriesResult => {
      return {
        fingerprint: JSON.stringify(entry.labels),
        labels: entry.labels,
        aggregatedResults: [toMinuteResult(entry.points)],
      };
    },
  );

  const outcome: Record<string, Outcome> = {};

  for (const [key, instance] of [
    ["breached", getUnhealthy(step)],
    ["healthy", getHealthy(step)],
  ] as Array<[keyof Outcome, MonitorCriteriaInstance]>) {
    const evaluations: Array<MetricSeriesEvaluationResult> =
      await MetricMonitorCriteria.evaluateAllSeries({
        dataToProcess: response,
        criteriaFilter: JSON.parse(
          JSON.stringify(instance.data!.filters[0]!),
        ) as CriteriaFilter,
        monitorStep: step,
      });

    for (const evaluation of evaluations) {
      const label: string = Object.values(evaluation.labels).join(" / ");
      outcome[label] = outcome[label] || { breached: false, healthy: false };
      outcome[label]![key] = evaluation.rootCause !== null;
    }
  }

  return outcome;
}

const RABBITMQ_QUEUE: Record<string, string> = {
  "resource.rabbitmq.node.name": "rabbit@16c76f2d8aa2",
  "resource.rabbitmq.queue.name": "orders",
  "resource.rabbitmq.vhost.name": "/",
};

/*
 * The rabbitmq receiver's default scrape: every ten seconds, both `state`
 * series of the queue under the scrape's one timestamp, for ten minutes.
 */
function rabbitScrapes(depth: {
  ready: number;
  unacknowledged: number;
}): Array<BrokerRow> {
  const rows: Array<BrokerRow> = [];

  for (let second: number = 0; second < 600; second += 10) {
    for (const state of ["ready", "unacknowledged"] as Array<
      "ready" | "unacknowledged"
    >) {
      rows.push({
        second: second,
        metricName: "rabbitmq.message.current",
        attributes: { ...RABBITMQ_QUEUE, state: state },
        value: depth[state],
      });
    }
  }

  return rows;
}

/*
 * CloudWatch's one-minute periods of a metric as the pull receiver or a
 * Metric Stream stores them: one Summary point per period, SampleCount in
 * `count` and Sum in `sum` (and `value`), no min or max. `samples` holds, per
 * period, the samples CloudWatch received — SNS reports each failed delivery
 * as one sample of 1.
 */
function cloudWatchPeriods(
  template: MessageQueueAlertTemplate,
  samplesPerPeriod: Array<Array<number>>,
): Array<BrokerRow> {
  const fixture: MetricFixture = fixtureFor(template);
  const attributes: Record<string, string> = toStoredColumns(
    fixture.attributes,
    Object.keys(fixture.attributes),
  );

  return samplesPerPeriod.map(
    (samples: Array<number>, period: number): BrokerRow => {
      const sum: number = samples.reduce(
        (total: number, value: number): number => {
          return total + value;
        },
        0,
      );

      return {
        second: period * 60,
        metricName: template.metricName,
        attributes: attributes,
        value: sum,
        count: samples.length,
        sum: sum,
        min: null,
        max: null,
      };
    },
  );
}

// `count` samples of 1 — how SNS reports `count` failed deliveries.
function ones(count: number): Array<number> {
  return new Array<number>(count).fill(1);
}

describe("MessageQueueAlertTemplates — behaviour against broker data", () => {
  describe("Kafka consumer lag (the worst consumer group, held)", () => {
    const ID: string = "message-queue-kafka-kafka-consumer-group-lag-sum";

    test("fires when the lag stays at or above 10,000 for the window", async () => {
      expect(await evaluate(ID, [12000, 15000, 11000])).toEqual({
        breached: true,
        healthy: false,
      });
    });

    test("recovers once consumers catch up", async () => {
      expect(await evaluate(ID, [2000, 1500, 1800])).toEqual({
        breached: false,
        healthy: true,
      });
    });

    test("a single spike does not fire, and does not read healthy either", async () => {
      expect(await evaluate(ID, [2000, 25000, 2000])).toEqual({
        breached: false,
        healthy: false,
      });
    });

    test("holds its status inside the recovery dead band instead of flapping", async () => {
      // 9,500: below the 10,000 breach, above the 9,000 recovery.
      expect(await evaluate(ID, [9500, 9500, 9500])).toEqual({
        breached: false,
        healthy: false,
      });
    });

    test("a silent window neither fires nor recovers a level", async () => {
      expect(await evaluate(ID, [])).toEqual({
        breached: false,
        healthy: false,
      });
    });

    test("the alert reads in messages, never as a fraction of the dimensionless '1'", async () => {
      const step: MonitorStep = stepFor(getTemplate(ID));
      const rootCause: string | null = await getRootCause(
        step,
        getUnhealthy(step).data!.filters[0]!,
        buildResponse(step, { consumer_lag: [12000, 12000, 12000] }),
      );

      expect(rootCause).not.toBeNull();
      expect(rootCause).toContain("messages");
      expect(rootCause).toContain("12000");
      expect(rootCause).not.toContain("%");
    });
  });

  describe("RabbitMQ queue depth (ready + unacknowledged, scraped every ten seconds)", () => {
    const ID: string = "message-queue-rabbitmq-rabbitmq-message-current";

    function depthStep(): MonitorStep {
      // Built from the ready series alone: the total still covers both.
      return stepFor(
        getTemplate(ID),
        buildArgs([{ ...RABBITMQ_QUEUE, state: "ready" }]),
      );
    }

    test("the fixture holds the trap: no single fold over both series reads the depth", () => {
      const firstMinute: Array<BrokerRow> = rabbitScrapes({
        ready: 1200,
        unacknowledged: 50,
      }).filter((row: BrokerRow): boolean => {
        return row.second < 60;
      });

      // Six scrapes a minute: a Sum counts each series six times...
      expect(engineFold(firstMinute, MetricsAggregationType.Sum)).toBe(7500);
      // ...and an Average halves ready + unacknowledged.
      expect(engineFold(firstMinute, MetricsAggregationType.Avg)).toBe(625);
    });

    test("a queue deeper than the threshold fires even when neither state alone reaches it", async () => {
      // 999 ready + 999 unacknowledged: the page shows a depth of 1,998.
      expect(
        await evaluateRows(
          depthStep(),
          rabbitScrapes({ ready: 999, unacknowledged: 999 }),
        ),
      ).toEqual({ queue: { breached: true, healthy: false } });
    });

    test("a backlog of ready messages fires", async () => {
      expect(
        await evaluateRows(
          depthStep(),
          rabbitScrapes({ ready: 1200, unacknowledged: 50 }),
        ),
      ).toEqual({ queue: { breached: true, healthy: false } });
    });

    test("messages delivered but never acknowledged fire too", async () => {
      expect(
        await evaluateRows(
          depthStep(),
          rabbitScrapes({ ready: 0, unacknowledged: 4000 }),
        ),
      ).toEqual({ queue: { breached: true, healthy: false } });
    });

    test("a queue that keeps up is healthy, and one inside the dead band holds its status", async () => {
      expect(
        await evaluateRows(
          depthStep(),
          rabbitScrapes({ ready: 10, unacknowledged: 0 }),
        ),
      ).toEqual({ queue: { breached: false, healthy: true } });
      // 470 + 470 = 940: below the 1,000 breach, above the 900 recovery.
      expect(
        await evaluateRows(
          depthStep(),
          rabbitScrapes({ ready: 470, unacknowledged: 470 }),
        ),
      ).toEqual({ queue: { breached: false, healthy: false } });
    });

    test("another queue's rows never reach the monitor", async () => {
      const otherQueue: Array<BrokerRow> = rabbitScrapes({
        ready: 90000,
        unacknowledged: 90000,
      }).map((row: BrokerRow): BrokerRow => {
        return {
          ...row,
          attributes: {
            ...row.attributes,
            "resource.rabbitmq.queue.name": "payments",
          },
        };
      });

      expect(
        await evaluateRows(depthStep(), [
          ...rabbitScrapes({ ready: 10, unacknowledged: 0 }),
          ...otherQueue,
        ]),
      ).toEqual({ queue: { breached: false, healthy: true } });
    });

    test("the alert reads the depth the page shows, in messages", async () => {
      const step: MonitorStep = depthStep();
      const rootCause: string | null = await getRootCause(
        step,
        getUnhealthy(step).data!.filters[0]!,
        buildResponseFromRows(
          step,
          rabbitScrapes({ ready: 999, unacknowledged: 999 }),
        ),
      );

      expect(rootCause).not.toBeNull();
      expect(rootCause).toContain("1998");
      expect(rootCause).toContain("messages");
    });
  });

  describe("Pulsar topic backlog (one series per partition)", () => {
    test("the partition that backs up fires; the others stay healthy", async () => {
      const template: MessageQueueAlertTemplate = getTemplate(
        "message-queue-pulsar-pulsar-msg-backlog",
      );
      const partitions: Array<FixtureAttributes> = [0, 1, 2].map(
        (partition: number): FixtureAttributes => {
          return pulsarPartition("payments", partition);
        },
      );
      const step: MonitorStep = stepFor(template, buildArgs(partitions));
      const rows: Array<BrokerRow> = [];

      for (let second: number = 0; second < 600; second += 15) {
        partitions.forEach((attributes: FixtureAttributes, index: number) => {
          rows.push({
            second: second,
            metricName: "pulsar_msg_backlog",
            attributes: attributes as Record<string, string>,
            value: index === 1 ? 5000 : 20,
          });
        });
      }

      expect(template.groupByAttributeKeys.length).toBeGreaterThan(0);
      expect(await evaluateRows(step, rows)).toEqual({
        "standalone / persistent://public/default/payments-partition-0 / ": {
          breached: false,
          healthy: true,
        },
        "standalone / persistent://public/default/payments-partition-1 / ": {
          breached: true,
          healthy: false,
        },
        "standalone / persistent://public/default/payments-partition-2 / ": {
          breached: false,
          healthy: true,
        },
      });
    });
  });

  describe("Service Bus dead-lettered messages (a level)", () => {
    const ID: string =
      "message-queue-servicebus-azure-deadletteredmessages-average";

    test("any message waiting in the dead-letter queue fires", async () => {
      expect(await evaluate(ID, [3, 3, 3])).toEqual({
        breached: true,
        healthy: false,
      });
    });

    test("recovers only once the dead-letter queue is drained", async () => {
      expect(await evaluate(ID, [0, 0, 0])).toEqual({
        breached: false,
        healthy: true,
      });
      expect(await evaluate(ID, [1, 1, 0])).toEqual({
        breached: false,
        healthy: false,
      });
    });

    test("a silent window holds the status: silence is not an empty dead-letter queue", async () => {
      expect(await evaluate(ID, [])).toEqual({
        breached: false,
        healthy: false,
      });
    });
  });

  describe("Azure errors and throttling (per-minute counts that go quiet between events)", () => {
    test("one minute with a burst fires, even alone in the window", async () => {
      expect(
        await evaluate("message-queue-servicebus-azure-servererrors-total", [
          12,
        ]),
      ).toEqual({ breached: true, healthy: false });
      expect(
        await evaluate(
          "message-queue-eventhubs-azure-throttledrequests-total",
          [0, 0, 25, 0],
        ),
      ).toEqual({ breached: true, healthy: false });
    });

    test("a few failures a minute are absorbed", async () => {
      expect(
        await evaluate(
          "message-queue-servicebus-azure-usererrors-total",
          [3, 2, 4],
        ),
      ).toEqual({ breached: false, healthy: true });
    });

    test("a silent window reads as no errors, so the monitor recovers", async () => {
      for (const id of [
        "message-queue-servicebus-azure-servererrors-total",
        "message-queue-servicebus-azure-throttledrequests-total",
        "message-queue-servicebus-azure-abandonmessage-total",
        "message-queue-eventhubs-azure-quotaexceedederrors-total",
      ]) {
        expect(await evaluate(id, [])).toEqual({
          breached: false,
          healthy: true,
        });
      }
    });

    test("the alert reads in requests", async () => {
      const step: MonitorStep = stepFor(
        getTemplate("message-queue-servicebus-azure-servererrors-total"),
      );
      const rootCause: string | null = await getRootCause(
        step,
        getUnhealthy(step).data!.filters[0]!,
        buildResponse(step, { failures: [14] }),
      );

      expect(rootCause).toContain("requests");
      expect(rootCause).not.toContain("%");
    });
  });

  describe("Amazon SQS", () => {
    const AGE: string =
      "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximateageofoldestmessage";
    const IN_FLIGHT: string =
      "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximatenumberofmessagesnotvisible";

    test("a message waiting ten minutes or more, held, fires", async () => {
      expect(await evaluate(AGE, [720, 780, 840])).toEqual({
        breached: true,
        healthy: false,
      });
    });

    test("messages taken within seconds are healthy", async () => {
      expect(await evaluate(AGE, [30, 45, 60])).toEqual({
        breached: false,
        healthy: true,
      });
    });

    test("an age that has only just crossed does not fire yet", async () => {
      expect(await evaluate(AGE, [300, 700, 800])).toEqual({
        breached: false,
        healthy: false,
      });
    });

    test("a drained queue (CloudWatch stops reporting the age) recovers", async () => {
      expect(await evaluate(AGE, [])).toEqual({
        breached: false,
        healthy: true,
      });
    });

    test("CloudWatch's 'Seconds' is read in seconds, and the alert reads in minutes", async () => {
      const step: MonitorStep = stepFor(getTemplate(AGE));
      const rootCause: string | null = await getRootCause(
        step,
        getUnhealthy(step).data!.filters[0]!,
        buildResponse(step, { oldest_message_age: [720, 720, 720] }),
      );

      expect(rootCause).not.toBeNull();
      expect(rootCause).toContain("min");
      expect(rootCause).not.toContain("%");
    });

    test("messages in flight near the quota fire; a busy queue's normal in-flight count does not", async () => {
      expect(await evaluate(IN_FLIGHT, [110000, 112000, 115000])).toEqual({
        breached: true,
        healthy: false,
      });
      expect(await evaluate(IN_FLIGHT, [5000, 8000, 12000])).toEqual({
        breached: false,
        healthy: true,
      });
    });
  });

  describe("dead letters counted per period (SNS, Pub/Sub)", () => {
    test("one dead-lettered message in any minute fires", async () => {
      expect(
        await evaluate(
          "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-dead-letter-message-count",
          [0, 0, 2, 0],
        ),
      ).toEqual({ breached: true, healthy: false });
      expect(
        await evaluate(
          "message-queue-aws-sns-numberofnotificationsredriventodlq",
          [1],
        ),
      ).toEqual({ breached: true, healthy: false });
    });

    test("a window without any recovers, reported as zeros or not at all", async () => {
      const id: string =
        "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-dead-letter-message-count";

      expect(await evaluate(id, [0, 0, 0])).toEqual({
        breached: false,
        healthy: true,
      });
      expect(await evaluate(id, [])).toEqual({
        breached: false,
        healthy: true,
      });
    });
  });

  describe("backlogs of the brokers that track each message", () => {
    test.each([
      ["message-queue-servicebus-azure-activemessages-average"],
      [
        "message-queue-aws-sqs-amazonaws-com-aws-sqs-approximatenumberofmessagesvisible",
      ],
      [
        "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-num-undelivered-messages",
      ],
      ["message-queue-rocketmq-rocketmq-consumer-ready-messages"],
      ["message-queue-rabbitmq-rabbitmq-message-current"],
    ])(
      "%s fires on a held backlog, ignores one that drains within the window",
      async (id: string) => {
        expect(await evaluate(id, [1500, 1800, 2400])).toEqual({
          breached: true,
          healthy: false,
        });
        expect(await evaluate(id, [4000, 600, 10])).toEqual({
          breached: false,
          healthy: false,
        });
        expect(await evaluate(id, [10, 0, 5])).toEqual({
          breached: false,
          healthy: true,
        });
      },
    );
  });

  describe("every template fires on its own threshold and recovers well below it", () => {
    test.each(TEMPLATE_CASES)(
      "%s",
      async (_id: string, template: MessageQueueAlertTemplate) => {
        const step: MonitorStep = stepFor(template);

        for (const [samples, expected] of [
          [
            [template.threshold, template.threshold, template.threshold],
            { breached: true, healthy: false },
          ],
          [[0, 0, 0], { breached: false, healthy: true }],
        ] as Array<[Array<number>, Outcome]>) {
          const response: MetricMonitorResponse = buildResponse(
            step,
            criteriaSamples(step, samples),
          );

          if (template.groupByAttributeKeys.length > 0) {
            response.seriesBreakdown = [
              {
                fingerprint: "one-series",
                labels: {},
                aggregatedResults: [toResult(samples)],
              },
            ];
          }

          expect(await outcomeOf(step, response)).toEqual(expected);
        }
      },
    );
  });
});

// --- the metric engine's folds -----------------------------------------------

const ENGINE: MetricService = new MetricService();

// The SQL fold the engine compiles a scalar aggregation over `value` to.
function engineExpression(aggregationType: MetricsAggregationType): string {
  return (
    ENGINE as unknown as {
      getDistributionAwareAggregationExpression: (
        aggregationType: AggregationType,
        column: string,
      ) => string;
    }
  ).getDistributionAwareAggregationExpression(aggregationType, "value");
}

/*
 * The aggregate the telemetry worker asks MetricService for, per query of a
 * metric monitor (monitorMetric in MonitorTelemetryMonitor): the metric,
 * the query's attribute filters, its fold and its group-by, over the
 * monitor's window.
 */
function workerAggregateBy(
  step: MonitorStep,
  queryConfig: MetricQueryConfigData,
): AggregateBy<Metric> {
  const end: Date = new Date(START);
  const start: Date = new Date(
    START -
      rollingTimeSeconds(
        step.data?.metricMonitor?.rollingTime || RollingTime.Past1Minute,
      ) *
        1000,
  );
  const groupByAttributeKeys: Array<string> =
    MonitorStep.getGroupByAttributeKeys(step);

  return {
    query: {
      projectId: ObjectID.generate(),
      time: new InBetween(start, end),
      name: queryConfig.metricQueryData.filterData.metricName,
      attributes: queryConfig.metricQueryData.filterData.attributes,
    } as unknown as AggregateBy<Metric>["query"],
    aggregationType: queryConfig.metricQueryData.filterData
      .aggegationType as AggregationType,
    aggregateColumnName: "value",
    aggregationTimestampColumnName: "time",
    startTimestamp: start,
    endTimestamp: end,
    limit: 10000,
    skip: 0,
    ...(groupByAttributeKeys.length > 0
      ? { groupByAttributeKeys: groupByAttributeKeys }
      : {}),
    sort: { time: SortOrder.Ascending } as AggregateBy<Metric>["sort"],
    props: { isRoot: true },
  } as AggregateBy<Metric>;
}

// The CloudWatch counts: Sum-aggregated catalog entries of SQS and SNS.
const CLOUDWATCH_COUNT_CASES: Array<[string, MessageQueueMetricDescriptor]> =
  MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return (
        (descriptor.system === "aws_sqs" || descriptor.system === "aws.sns") &&
        descriptor.aggregation === MetricsAggregationType.Sum
      );
    },
  ).map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): [string, MessageQueueMetricDescriptor] => {
      return [getMessageQueueMetricId(descriptor), descriptor];
    },
  );

describe("MessageQueueAlertTemplates — the metric engine's folds (CloudWatch Summary points)", () => {
  test("the SQL folds the model ports, verbatim", () => {
    const distribution: string =
      "isNotNull(count) AND isNotNull(coalesce(sum, value))";
    const total: string = `sum(multiIf(${distribution}, toFloat64(coalesce(sum, value)), isNotNull(value), toFloat64(value), 0))`;
    const observations: string = `sum(multiIf(${distribution}, toFloat64(count), isNotNull(value), 1, 0))`;
    const mean: string = "toFloat64(coalesce(sum, value)) / toFloat64(count)";

    /*
     * If the engine changes one of these, engineFold must change with it —
     * every behaviour test above folds rows through it.
     */
    expect(engineExpression(MetricsAggregationType.Sum)).toBe(total);
    expect(engineExpression(MetricsAggregationType.Avg)).toBe(
      `if(${observations} = 0, 0, ${total} / ${observations})`,
    );
    expect(engineExpression(MetricsAggregationType.Min)).toBe(
      `min(multiIf(isNotNull(min), toFloat64(min), ${distribution} AND count > 0, ${mean}, isNotNull(value), toFloat64(value), NULL))`,
    );
    expect(engineExpression(MetricsAggregationType.Max)).toBe(
      `max(multiIf(isNotNull(max), toFloat64(max), ${distribution} AND count > 0, ${mean}, isNotNull(value), toFloat64(value), NULL))`,
    );
  });

  test.each(TEMPLATE_CASES)(
    "%s compiles, query by query, to the base-table fold the model ports",
    (_id: string, template: MessageQueueAlertTemplate) => {
      const step: MonitorStep = stepFor(template);

      for (const queryConfig of queryConfigsOf(step)) {
        const statement: { statement: Statement; columns: Array<string> } =
          ENGINE.toAggregateStatement(workerAggregateBy(step, queryConfig));

        // The attribute filter keeps every template off the rollups.
        expect(statement.statement.query).not.toContain("AggMV");
        expect(statement.statement.query).toContain(
          engineExpression(
            queryConfig.metricQueryData.filterData
              .aggegationType as MetricsAggregationType,
          ),
        );
      }
    },
  );

  test("on a CloudWatch Summary point the engine's Max reads the mean — CloudWatch's Average — and Sum the count", () => {
    // Twelve failed deliveries in one period, each a sample of 1.
    const failures: StoredPoint = {
      value: 12,
      count: 12,
      sum: 12,
      min: null,
      max: null,
    };

    expect(engineFold([failures], MetricsAggregationType.Max)).toBe(1);
    expect(engineFold([failures], MetricsAggregationType.Avg)).toBe(1);
    expect(engineFold([failures], MetricsAggregationType.Sum)).toBe(12);
  });

  test("SNS Notifications Failed fires on twelve failed deliveries in a period, each reported as a sample of 1", async () => {
    for (const id of [
      "message-queue-aws-sns-amazonaws-com-aws-sns-numberofnotificationsfailed",
      "message-queue-aws-sns-numberofnotificationsfailed",
    ]) {
      const template: MessageQueueAlertTemplate = getTemplate(id);
      const step: MonitorStep = stepFor(template);

      expect(
        await evaluateRows(
          step,
          cloudWatchPeriods(template, [ones(3), ones(12), ones(5)]),
        ),
      ).toEqual({ queue: { breached: true, healthy: false } });
      // A few failures a period are absorbed.
      expect(
        await evaluateRows(
          step,
          cloudWatchPeriods(template, [ones(2), ones(3), ones(1)]),
        ),
      ).toEqual({ queue: { breached: false, healthy: true } });
    }
  });

  test("Redriven to Dead-Letter Queue reports how many were redriven, not 1", async () => {
    const template: MessageQueueAlertTemplate = getTemplate(
      "message-queue-aws-sns-amazonaws-com-aws-sns-numberofnotificationsredriventodlq",
    );
    const step: MonitorStep = stepFor(template);
    const rootCause: string | null = await getRootCause(
      step,
      getUnhealthy(step).data!.filters[0]!,
      buildResponseFromRows(step, cloudWatchPeriods(template, [ones(7)])),
    );

    expect(rootCause).not.toBeNull();
    expect(rootCause).toContain("7 messages");
  });

  test.each(CLOUDWATCH_COUNT_CASES)(
    "%s: the Create monitor link folds CloudWatch's Sum for the period, the number the page charts",
    (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const seed: MessageQueueMetricMonitorSeed =
        getMessageQueueMetricMonitorSeed(descriptor)!;
      // Forty messages over eight samples in one period.
      const period: StoredPoint = {
        value: 40,
        count: 8,
        sum: 40,
        min: null,
        max: null,
      };

      expect(seed.aggregationType).toBe(MetricsAggregationType.Sum);
      expect(engineFold([period], seed.aggregationType)).toBe(40);
      expect(engineFold([period], descriptor.aggregation)).toBe(40);
    },
  );

  test("the CloudWatch levels read each period's Average through Max, as the page charts them", () => {
    // 5,000 messages visible over five samples: an Average of 1,000.
    const period: StoredPoint = {
      value: 5000,
      count: 5,
      sum: 5000,
      min: null,
      max: null,
    };

    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      if (
        descriptor.receiver !== "aws_cloudwatch" ||
        descriptor.aggregation === MetricsAggregationType.Sum
      ) {
        continue;
      }

      const seed: MessageQueueMetricMonitorSeed =
        getMessageQueueMetricMonitorSeed(descriptor)!;

      expect(seed.aggregationType).toBe(MetricsAggregationType.Max);
      expect(engineFold([period], seed.aggregationType)).toBe(
        engineFold([period], descriptor.aggregation),
      );
    }
  });
});

/*
 * The model against the engine's own SQL on a real ClickHouse server. Opt
 * in with TEST_CLICKHOUSE_URL=http://<user>:<password>@localhost:<port>; the
 * suite only runs SELECTs over literal rows and creates nothing.
 */
const clickHouseEndpoint: string | undefined =
  process.env["TEST_CLICKHOUSE_URL"];
const withClickHouse: typeof describe.skip = clickHouseEndpoint
  ? describe
  : describe.skip;

withClickHouse(
  "MessageQueueAlertTemplates — the engine's folds on a real ClickHouse",
  () => {
    let client: ClickHouseClient;

    beforeAll((): void => {
      // The real ClickHouse HTTP client needs Node timers with unref().
      jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
      jest
        .spyOn(globalThis, "clearTimeout")
        .mockImplementation(nodeClearTimeout);

      const url: URL = new URL(clickHouseEndpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("This suite requires a local ClickHouse server.");
      }

      client = createClient({
        url: `${url.protocol}//${url.host}`,
        username: decodeURIComponent(url.username) || "default",
        password: decodeURIComponent(url.password),
        request_timeout: 60000,
      });
    });

    afterAll(async (): Promise<void> => {
      await client.close();
      jest.restoreAllMocks();
    });

    const BUCKETS: Array<[string, Array<StoredPoint>]> = [
      [
        "one CloudWatch period of twelve failures",
        [{ value: 12, count: 12, sum: 12, min: null, max: null }],
      ],
      [
        "the same CloudWatch period reported twice",
        [
          { value: 12, count: 12, sum: 12, min: null, max: null },
          { value: 12, count: 12, sum: 12, min: null, max: null },
        ],
      ],
      [
        "a CloudWatch level: five samples averaging 1,000",
        [{ value: 5000, count: 5, sum: 5000, min: null, max: null }],
      ],
      [
        "a Summary point with no samples",
        [{ value: 0, count: 0, sum: 0, min: null, max: null }],
      ],
      [
        "scalar gauge samples",
        [{ value: 1200 }, { value: 50 }, { value: 7.5 }],
      ],
      [
        "a histogram point that carries its min and max",
        [{ value: 30, count: 3, sum: 30, min: 2, max: 20 }],
      ],
      [
        "scalar and distribution rows in one bucket",
        [
          { value: 4 },
          { value: 30, count: 3, sum: 30, min: null, max: null },
          { value: 9, count: 1, sum: 9, min: 9, max: 9 },
        ],
      ],
    ];

    function sqlNumber(value: number | null | undefined): string {
      return isPresent(value) ? String(value) : "NULL";
    }

    test.each(BUCKETS)(
      "%s folds exactly as the model says, for every aggregation",
      async (_name: string, points: Array<StoredPoint>) => {
        const rows: string = points
          .map((point: StoredPoint): string => {
            return `(${sqlNumber(point.value)}, ${sqlNumber(
              point.count,
            )}, ${sqlNumber(point.sum)}, ${sqlNumber(point.min)}, ${sqlNumber(
              point.max,
            )})`;
          })
          .join(", ");

        for (const aggregationType of [
          MetricsAggregationType.Sum,
          MetricsAggregationType.Avg,
          MetricsAggregationType.Min,
          MetricsAggregationType.Max,
        ]) {
          const result: { data: Array<{ folded: number | null }> } = (await (
            await client.query({
              query: `SELECT ${engineExpression(
                aggregationType,
              )} AS folded FROM values('value Nullable(Float64), count Nullable(UInt64), sum Nullable(Float64), min Nullable(Float64), max Nullable(Float64)', ${rows})`,
              format: "JSON",
            })
          ).json()) as { data: Array<{ folded: number | null }> };

          expect({
            aggregationType: aggregationType,
            folded: result.data[0]!.folded,
          }).toEqual({
            aggregationType: aggregationType,
            folded: engineFold(points, aggregationType),
          });
        }
      },
    );
  },
);

// --- late sources ---------------------------------------------------------------

/*
 * A cloud receiver that polls: what one scrape at `scrapeTime` fetches (the
 * timestamps its points are stored at), and how often it scrapes. Seconds.
 */
interface LateSourceModel {
  name: string;
  collectionIntervalSeconds: number;
  fetch: (scrapeTime: number) => Array<number>;
}

function alignDown(seconds: number, period: number): number {
  return Math.floor(seconds / period) * period;
}

/*
 * receiver/awscloudwatchreceiver metrics.go@v0.161.0, scrape():
 *   endTime := alignTimeToPeriod(now.Add(-s.delay), periodSec)
 *   startTime := alignTimeToPeriod(endTime.Add(-s.collectionInterval), periodSec)
 * GetMetricData returns one value per period starting in [startTime,
 * endTime), each stored as a point stamped with its period's start.
 */
function cloudWatchPull(config: {
  name: string;
  periodSeconds: number;
  collectionIntervalSeconds: number;
  delaySeconds: number;
}): LateSourceModel {
  return {
    name: config.name,
    collectionIntervalSeconds: config.collectionIntervalSeconds,
    fetch: (now: number): Array<number> => {
      const endTime: number = alignDown(
        now - config.delaySeconds,
        config.periodSeconds,
      );
      const startTime: number = alignDown(
        endTime - config.collectionIntervalSeconds,
        config.periodSeconds,
      );
      const points: Array<number> = [];

      for (
        let periodStart: number = startTime;
        periodStart < endTime;
        periodStart += config.periodSeconds
      ) {
        points.push(periodStart);
      }

      return points;
    },
  };
}

/*
 * receiver/googlecloudmonitoringreceiver receiver.go@v0.161.0, Scrape() and
 * calculateStartEndTime(): endTime = now - delay (the metric descriptor's
 * ingest delay), startTime = endTime - collection_interval; and
 * metrics_conversion.go stamps each point with its interval's end. Pub/Sub
 * samples every 60 seconds; a sample ending in (startTime, endTime] is
 * fetched by exactly one scrape.
 */
function cloudMonitoringPull(config: {
  name: string;
  ingestDelaySeconds: number;
  collectionIntervalSeconds: number;
  samplePhaseSeconds: number;
}): LateSourceModel {
  return {
    name: config.name,
    collectionIntervalSeconds: config.collectionIntervalSeconds,
    fetch: (now: number): Array<number> => {
      const endTime: number = now - config.ingestDelaySeconds;
      const startTime: number = endTime - config.collectionIntervalSeconds;
      const points: Array<number> = [];
      let sample: number =
        alignDown(startTime - config.samplePhaseSeconds, 60) +
        config.samplePhaseSeconds;

      while (sample <= startTime) {
        sample += 60;
      }

      for (; sample <= endTime; sample += 60) {
        points.push(sample);
      }

      return points;
    },
  };
}

// The documented configuration (queues.md) and the receiver's defaults.
const CLOUDWATCH_CONFIGURATIONS: Array<LateSourceModel> = [
  cloudWatchPull({
    name: "aws_cloudwatch as documented (period 1m, collection_interval 5m, delay 10m)",
    periodSeconds: 60,
    collectionIntervalSeconds: 300,
    delaySeconds: 600,
  }),
  cloudWatchPull({
    name: "aws_cloudwatch defaults (period 5m, collection_interval 5m, delay 10m)",
    periodSeconds: 300,
    collectionIntervalSeconds: 300,
    delaySeconds: 600,
  }),
];

/*
 * Cloud Monitoring's ingest delay per Pub/Sub metric type — "After
 * sampling, data is not visible for up to N seconds" (metrics_gcp_p_z,
 * Pub/Sub), the delay the receiver waits out.
 */
const PUBSUB_INGEST_DELAY_SECONDS: Record<string, number> = {
  "pubsub.googleapis.com/subscription/num_undelivered_messages": 120,
  "pubsub.googleapis.com/subscription/oldest_unacked_message_age": 120,
  "pubsub.googleapis.com/subscription/dead_letter_message_count": 240,
  "pubsub.googleapis.com/subscription/ack_message_count": 181,
  "pubsub.googleapis.com/topic/send_request_count": 181,
};

// As documented (queues.md: 2m) and the receiver's default (300s).
const CLOUD_MONITORING_INTERVALS: Array<[string, number]> = [
  ["as documented (collection_interval 2m)", 120],
  ["with the receiver's default collection_interval 5m", 300],
];

function cloudMonitoringConfigurations(
  metricName: string,
  collectionIntervalSeconds?: number,
): Array<LateSourceModel> {
  const models: Array<LateSourceModel> = [];

  for (const [label, interval] of CLOUD_MONITORING_INTERVALS) {
    if (
      collectionIntervalSeconds !== undefined &&
      interval !== collectionIntervalSeconds
    ) {
      continue;
    }

    for (const samplePhaseSeconds of [0, 23, 41]) {
      models.push(
        cloudMonitoringPull({
          name: `googlecloudmonitoring ${label}, samples at :${samplePhaseSeconds}`,
          ingestDelaySeconds: PUBSUB_INGEST_DELAY_SECONDS[metricName]!,
          collectionIntervalSeconds: interval,
          samplePhaseSeconds: samplePhaseSeconds,
        }),
      );
    }
  }

  return models;
}

function lateSourcesFor(
  descriptor: MessageQueueMetricDescriptor,
): Array<LateSourceModel> {
  if (descriptor.receiver === "aws_cloudwatch") {
    return CLOUDWATCH_CONFIGURATIONS;
  }

  if (descriptor.receiver === "googlecloudmonitoring") {
    return cloudMonitoringConfigurations(descriptor.metricName);
  }

  return [];
}

interface ReplayOutcome {
  evaluations: number;
  // Evaluations whose window held no point at all.
  blindEvaluations: number;
  points: number;
  // Points no evaluation ever had in its window.
  unreadPoints: number;
  // The age of the newest point that had arrived, over the evaluations.
  newestAgeSeconds: { min: number; max: number };
  // How many points the window held, over the evaluations.
  pointsInWindow: { min: number; max: number };
}

// The index of the first entry of a sorted array at or above `value`.
function lowerBound(sorted: Array<number>, value: number): number {
  let low: number = 0;
  let high: number = sorted.length;

  while (low < high) {
    const middle: number = Math.floor((low + high) / 2);

    if (sorted[middle]! < value) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  return low;
}

const REPLAY_SECONDS: number = 10 * 3600;
const REPLAY_WARM_UP_SECONDS: number = 2 * 3600;
// The telemetry worker evaluates every metric monitor once a minute.
const EVALUATION_INTERVAL_SECONDS: number = 60;
// (scrape, evaluation) phases, in seconds.
const REPLAY_PHASES: Array<[number, number]> = [
  [0, 0],
  [17, 29],
  [59, 5],
  [131, 44],
  [239, 59],
];

/*
 * Every alignment of a scrape against a five-minute period (in 10-second
 * steps), each against two evaluation phases: for the bounds themselves.
 */
const DENSE_REPLAY_PHASES: Array<[number, number]> = Array.from(
  { length: 30 },
  (_value: unknown, index: number): Array<[number, number]> => {
    return [
      [index * 10, 0],
      [index * 10, 31],
    ];
  },
).flat();

/*
 * Scrape the source for ten hours, and evaluate a monitor reading
 * [t - window, t] by each point's own timestamp every minute: which
 * evaluations found the window empty, and which points none of them read.
 * `transitSeconds` is the collector's export and OneUptime's ingest.
 */
function replay(data: {
  source: LateSourceModel;
  windowSeconds: number;
  scrapePhaseSeconds: number;
  evaluationPhaseSeconds: number;
  transitSeconds: number;
}): ReplayOutcome {
  const deliveries: Array<{ arrival: number; timestamp: number }> = [];

  for (
    let scrape: number = data.scrapePhaseSeconds;
    scrape < REPLAY_SECONDS;
    scrape += data.source.collectionIntervalSeconds
  ) {
    for (const timestamp of data.source.fetch(scrape)) {
      deliveries.push({
        arrival: scrape + data.transitSeconds,
        timestamp: timestamp,
      });
    }
  }

  const counted: (seconds: number) => boolean = (seconds: number): boolean => {
    return (
      seconds >= REPLAY_WARM_UP_SECONDS && seconds <= REPLAY_SECONDS - 3600
    );
  };

  /*
   * Scrapes fetch consecutive, non-overlapping spans, so the timestamps
   * arrive in order: the arrived ones stay a sorted array.
   */
  const arrived: Array<number> = [];
  let next: number = 0;
  let evaluations: number = 0;
  let blindEvaluations: number = 0;
  let minAge: number = Number.POSITIVE_INFINITY;
  let maxAge: number = Number.NEGATIVE_INFINITY;
  let minInWindow: number = Number.POSITIVE_INFINITY;
  let maxInWindow: number = Number.NEGATIVE_INFINITY;

  for (
    let evaluation: number = data.evaluationPhaseSeconds;
    evaluation < REPLAY_SECONDS;
    evaluation += EVALUATION_INTERVAL_SECONDS
  ) {
    while (
      next < deliveries.length &&
      deliveries[next]!.arrival <= evaluation
    ) {
      // Checked without expect(): this loop runs a million times.
      if (
        deliveries[next]!.timestamp <=
        (arrived[arrived.length - 1] ?? Number.NEGATIVE_INFINITY)
      ) {
        throw new Error(
          `${data.source.name} fetched ${deliveries[next]!.timestamp} twice or out of order`,
        );
      }

      arrived.push(deliveries[next]!.timestamp);
      next++;
    }

    if (!counted(evaluation)) {
      continue;
    }

    const newest: number = arrived[arrived.length - 1]!;
    // Every point is older than its arrival: the window is [t - W, t].
    const inWindow: number =
      arrived.length - lowerBound(arrived, evaluation - data.windowSeconds);

    evaluations++;
    minAge = Math.min(minAge, evaluation - newest);
    maxAge = Math.max(maxAge, evaluation - newest);
    minInWindow = Math.min(minInWindow, inWindow);
    maxInWindow = Math.max(maxInWindow, inWindow);

    if (inWindow === 0) {
      blindEvaluations++;
    }
  }

  let points: number = 0;
  let unreadPoints: number = 0;

  for (const delivery of deliveries) {
    if (!counted(delivery.arrival)) {
      continue;
    }

    points++;

    // The first evaluation after it arrives is its best chance.
    const firstEvaluation: number =
      data.evaluationPhaseSeconds +
      Math.ceil(
        (delivery.arrival - data.evaluationPhaseSeconds) /
          EVALUATION_INTERVAL_SECONDS,
      ) *
        EVALUATION_INTERVAL_SECONDS;

    if (firstEvaluation - data.windowSeconds > delivery.timestamp) {
      unreadPoints++;
    }
  }

  return {
    evaluations: evaluations,
    blindEvaluations: blindEvaluations,
    points: points,
    unreadPoints: unreadPoints,
    newestAgeSeconds: { min: minAge, max: maxAge },
    pointsInWindow: { min: minInWindow, max: maxInWindow },
  };
}

// Every phase, with export and ingest taking half a minute by default.
function replayAllPhases(
  source: LateSourceModel,
  windowSeconds: number,
  transitSeconds: number = 30,
  phases: Array<[number, number]> = REPLAY_PHASES,
): ReplayOutcome {
  const total: ReplayOutcome = {
    evaluations: 0,
    blindEvaluations: 0,
    points: 0,
    unreadPoints: 0,
    newestAgeSeconds: {
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    },
    pointsInWindow: {
      min: Number.POSITIVE_INFINITY,
      max: Number.NEGATIVE_INFINITY,
    },
  };

  for (const [scrapePhaseSeconds, evaluationPhaseSeconds] of phases) {
    const outcome: ReplayOutcome = replay({
      source: source,
      windowSeconds: windowSeconds,
      scrapePhaseSeconds: scrapePhaseSeconds,
      evaluationPhaseSeconds: evaluationPhaseSeconds,
      transitSeconds: transitSeconds,
    });

    total.evaluations += outcome.evaluations;
    total.blindEvaluations += outcome.blindEvaluations;
    total.points += outcome.points;
    total.unreadPoints += outcome.unreadPoints;
    total.newestAgeSeconds.min = Math.min(
      total.newestAgeSeconds.min,
      outcome.newestAgeSeconds.min,
    );
    total.newestAgeSeconds.max = Math.max(
      total.newestAgeSeconds.max,
      outcome.newestAgeSeconds.max,
    );
    total.pointsInWindow.min = Math.min(
      total.pointsInWindow.min,
      outcome.pointsInWindow.min,
    );
    total.pointsInWindow.max = Math.max(
      total.pointsInWindow.max,
      outcome.pointsInWindow.max,
    );
  }

  return total;
}

// The window a template read before late sources had floors.
function signalWindowOf(template: MessageQueueAlertTemplate): RollingTime {
  const descriptor: MessageQueueMetricDescriptor = descriptorOf(template);
  const override: MessageQueueAlertPolicyOverride | undefined =
    MESSAGE_QUEUE_ALERT_POLICY_OVERRIDES.find(
      (candidate: MessageQueueAlertPolicyOverride): boolean => {
        return (
          candidate.system === descriptor.system &&
          candidate.metricNames.includes(descriptor.metricName)
        );
      },
    );
  const defaults: MessageQueueAlertPolicyDefault =
    MESSAGE_QUEUE_ALERT_POLICIES.find(
      (policy: MessageQueueAlertPolicyDefault): boolean => {
        return (
          policy.signal === descriptor.signal &&
          policy.measure === getMessageQueueAlertMeasure(descriptor)
        );
      },
    )!;

  return override?.rollingTime || defaults.rollingTime;
}

const LATE_TEMPLATE_CASES: Array<[string, MessageQueueAlertTemplate]> =
  TEMPLATE_CASES.filter(
    (entry: [string, MessageQueueAlertTemplate]): boolean => {
      return lateSourcesFor(descriptorOf(entry[1])).length > 0;
    },
  );

const LATE_DESCRIPTOR_CASES: Array<[string, MessageQueueMetricDescriptor]> =
  MESSAGE_QUEUE_METRICS.filter(
    (descriptor: MessageQueueMetricDescriptor): boolean => {
      return (
        isMessageQueueMetricMonitorable(descriptor) &&
        getMessageQueueSourceWindowFloor(descriptor) !== null
      );
    },
  ).map(
    (
      descriptor: MessageQueueMetricDescriptor,
    ): [string, MessageQueueMetricDescriptor] => {
      return [getMessageQueueMetricId(descriptor), descriptor];
    },
  );

describe("MessageQueueAlertTemplates — late sources, replayed against the telemetry worker's evaluations", () => {
  test("the late sources are exactly the floored receivers, and every Pub/Sub metric has its ingest delay", () => {
    for (const descriptor of MESSAGE_QUEUE_METRICS) {
      expect({
        metric: getMessageQueueMetricId(descriptor),
        late: lateSourcesFor(descriptor).length > 0,
      }).toEqual({
        metric: getMessageQueueMetricId(descriptor),
        late: getMessageQueueSourceWindowFloor(descriptor) !== null,
      });

      if (descriptor.receiver === "googlecloudmonitoring") {
        expect(
          PUBSUB_INGEST_DELAY_SECONDS[descriptor.metricName],
        ).toBeGreaterThan(0);
      }
    }

    expect(LATE_TEMPLATE_CASES).toHaveLength(8);
  });

  test.each(LATE_TEMPLATE_CASES)(
    "%s: no evaluation finds its window empty, and every point is read",
    (_id: string, template: MessageQueueAlertTemplate) => {
      for (const source of lateSourcesFor(descriptorOf(template))) {
        const outcome: ReplayOutcome = replayAllPhases(
          source,
          rollingTimeSeconds(template.rollingTime),
        );

        expect(outcome.evaluations).toBeGreaterThan(1000);
        expect(outcome.points).toBeGreaterThan(100);
        expect({
          source: source.name,
          blind: outcome.blindEvaluations,
          unread: outcome.unreadPoints,
        }).toEqual({ source: source.name, blind: 0, unread: 0 });
      }
    },
  );

  test.each(LATE_DESCRIPTOR_CASES)(
    "%s: the floor serves the Create monitor link on every metric of the source",
    (_id: string, descriptor: MessageQueueMetricDescriptor) => {
      const windowSeconds: number = rollingTimeSeconds(
        getMessageQueueMetricMonitorRollingTime(
          descriptor,
          RollingTime.Past1Minute,
        ),
      );

      for (const source of lateSourcesFor(descriptor)) {
        const outcome: ReplayOutcome = replayAllPhases(source, windowSeconds);

        expect({
          source: source.name,
          blind: outcome.blindEvaluations,
          unread: outcome.unreadPoints,
        }).toEqual({ source: source.name, blind: 0, unread: 0 });
      }
    },
  );

  test("regression: on CloudWatch's pull receiver the signal's own window found every evaluation empty", () => {
    const pullTemplates: Array<MessageQueueAlertTemplate> =
      ALL_TEMPLATES.filter((template: MessageQueueAlertTemplate): boolean => {
        return template.receiver === "aws_cloudwatch";
      });

    expect(pullTemplates).toHaveLength(5);

    for (const template of pullTemplates) {
      const signalWindow: RollingTime = signalWindowOf(template);

      expect(rollingTimeSeconds(signalWindow)).toBeLessThanOrEqual(600);

      for (const source of CLOUDWATCH_CONFIGURATIONS) {
        const outcome: ReplayOutcome = replayAllPhases(
          source,
          rollingTimeSeconds(signalWindow),
        );

        expect({
          id: template.id,
          source: source.name,
          blind: outcome.blindEvaluations,
        }).toEqual({
          id: template.id,
          source: source.name,
          blind: outcome.evaluations,
        });
      }
    }
  });

  test("regression: a five-minute window never read most of Pub/Sub's dead-lettered samples", () => {
    const template: MessageQueueAlertTemplate = getTemplate(
      "message-queue-gcp-pubsub-pubsub-googleapis-com-subscription-dead-letter-message-count",
    );

    expect(signalWindowOf(template)).toBe(RollingTime.Past5Minutes);

    for (const [, interval] of CLOUD_MONITORING_INTERVALS) {
      for (const source of cloudMonitoringConfigurations(
        template.metricName,
        interval,
      )) {
        const outcome: ReplayOutcome = replayAllPhases(
          source,
          rollingTimeSeconds(RollingTime.Past5Minutes),
        );

        expect({
          source: source.name,
          unreadShare: outcome.unreadPoints / outcome.points > 0.5,
        }).toEqual({ source: source.name, unreadShare: true });
      }
    }
  });

  test("the lags the header and the floors state", () => {
    /*
     * Exact arithmetic over every alignment of scrape and period: no export
     * time, so the bounds are the receivers' own.
     */
    const lag: (source: LateSourceModel) => { min: number; max: number } = (
      source: LateSourceModel,
    ): { min: number; max: number } => {
      return replayAllPhases(source, 3600, 0, DENSE_REPLAY_PHASES)
        .newestAgeSeconds;
    };
    const within: (
      observed: { min: number; max: number },
      bounds: [number, number],
    ) => boolean = (
      observed: { min: number; max: number },
      bounds: [number, number],
    ): boolean => {
      return (
        observed.min >= bounds[0] &&
        observed.min < bounds[0] + 60 &&
        observed.max < bounds[1] &&
        observed.max >= bounds[1] - 60
      );
    };

    // CloudWatch: 11 to 17 minutes as documented, 15 to 25 by default.
    expect(within(lag(CLOUDWATCH_CONFIGURATIONS[0]!), [660, 1020])).toBe(true);
    expect(within(lag(CLOUDWATCH_CONFIGURATIONS[1]!), [900, 1500])).toBe(true);

    // Pub/Sub's levels: up to 5 minutes as documented, 8 by default.
    const levels: string =
      "pubsub.googleapis.com/subscription/num_undelivered_messages";
    for (const [interval, bounds] of [
      [120, [120, 300]],
      [300, [120, 480]],
    ] as Array<[number, [number, number]]>) {
      for (const source of cloudMonitoringConfigurations(levels, interval)) {
        expect({
          source: source.name,
          within: within(lag(source), bounds),
        }).toEqual({ source: source.name, within: true });
      }
    }

    // Dead-lettered counts: up to 7 minutes as documented, 10 by default.
    const deadLetters: string =
      "pubsub.googleapis.com/subscription/dead_letter_message_count";
    for (const [interval, bounds] of [
      [120, [240, 420]],
      [300, [240, 600]],
    ] as Array<[number, [number, number]]>) {
      for (const source of cloudMonitoringConfigurations(
        deadLetters,
        interval,
      )) {
        expect({
          source: source.name,
          within: within(lag(source), bounds),
        }).toEqual({ source: source.name, within: true });
      }
    }
  });

  test("so the widened windows still hold a sustained stretch of points, as the header says", () => {
    const pointsInWindow: (
      source: LateSourceModel,
      windowSeconds: number,
    ) => { min: number; max: number } = (
      source: LateSourceModel,
      windowSeconds: number,
    ): { min: number; max: number } => {
      return replayAllPhases(source, windowSeconds, 0, DENSE_REPLAY_PHASES)
        .pointsInWindow;
    };

    /*
     * One-minute CloudWatch periods as documented: 14 to 20 in thirty
     * minutes, 13 to 19 minutes from the oldest to the newest.
     */
    expect(pointsInWindow(CLOUDWATCH_CONFIGURATIONS[0]!, 1800)).toEqual({
      min: 14,
      max: 20,
    });
    // Five-minute periods by default: two to four.
    expect(pointsInWindow(CLOUDWATCH_CONFIGURATIONS[1]!, 1800)).toEqual({
      min: 2,
      max: 4,
    });

    /*
     * Pub/Sub's one-minute level samples in fifteen minutes: at least 11 as
     * documented, at least 8 with the receiver's default interval, never
     * more than 14.
     */
    for (const [interval, fewest] of [
      [120, 11],
      [300, 8],
    ] as Array<[number, number]>) {
      for (const source of cloudMonitoringConfigurations(
        "pubsub.googleapis.com/subscription/num_undelivered_messages",
        interval,
      )) {
        const points: { min: number; max: number } = pointsInWindow(
          source,
          900,
        );

        expect({
          source: source.name,
          fewest: points.min,
          atMostFourteen: points.max <= 14,
        }).toEqual({
          source: source.name,
          fewest: fewest,
          atMostFourteen: true,
        });
      }
    }
  });
});
