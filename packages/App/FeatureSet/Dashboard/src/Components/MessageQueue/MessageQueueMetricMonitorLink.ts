import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Dictionary from "Common/Types/Dictionary";
import { MessageQueueIdentity } from "Common/Types/MessageQueue/MessageQueueIdentity";
import { MessageQueueMetricDescriptor } from "Common/Types/MessageQueue/MessageQueueMetricCatalog";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import {
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  MessageQueueAlertTemplate,
  MessageQueueAlertTemplateSeverity,
  MessageQueueMetricMonitorQuery,
  MessageQueueMetricMonitorSeed,
  MessageQueueMetricMonitorViewConfig,
  MessageQueueObservedAttributes,
  MessageQueueSourceWindowFloor,
  buildMessageQueueMetricMonitorQuery,
  buildMessageQueueMetricMonitorViewConfig,
  formatMessageQueueThreshold,
  getMessageQueueAlertTemplateForMetric,
  getMessageQueueMetricMonitorRollingTime,
  getMessageQueueMetricMonitorSeed,
  getMessageQueueSourceWindowFloor,
} from "Common/Types/Monitor/MessageQueueAlertTemplates";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";
import MetricExplorerUrl from "Common/Utils/Metrics/MetricExplorerUrl";
import {
  translatableTerm,
  translateTemplate,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * "Create monitor" beside a broker health gauge on a queue's Overview.
 *
 * The monitor is a plain Metrics monitor built by the SAME code path the
 * queue alert templates use (Types/Monitor/MessageQueueAlertTemplates):
 *
 *   - buildMessageQueueMetricMonitorQuery turns the series the metric was
 *     OBSERVED with under the queue's entity key (all of them: a partitioned
 *     Pulsar topic has one per partition) into exact attribute filters — the
 *     destination, broker-scope and required attributes, with the values
 *     exactly as stored — keeping only series that resolve, through the
 *     ingest resolver, to this queue's identity
 *     (parseMessageQueueIdentifier of the row's queueIdentifier, the FAMILY
 *     identity ingest keys telemetry on). A null query means no monitor: a
 *     counter (the monitor path has no rate), or no series of this queue;
 *   - buildMessageQueueMetricMonitorViewConfig turns that query into the
 *     monitor's queries — one, or one per part of a series total plus the
 *     formula adding them up (a RabbitMQ queue's ready + unacknowledged) —
 *     and names the alias a criteria compares (criteriaAlias);
 *   - the starting threshold is the metric's template threshold
 *     (getMessageQueueAlertTemplateForMetric), placed on the config that
 *     carries criteriaAlias as its warning (or, for a Critical template,
 *     critical) threshold. A gauge without a template (a throughput, a
 *     consumer count, the gauges MessageQueueAlertTemplates leaves
 *     untemplated on purpose) gets none: there is no sensible fixed level to
 *     start from. What Monitor Create makes of it is narrower than the
 *     template (MessageQueueMonitorCreateCriteria): "above" rather than "at
 *     or above", and on any point rather than held for the window — so the
 *     link seeds the template's "any" (1) as "above 0", and its hint states
 *     the criteria Monitor Create builds, never the template's;
 *   - the window starts at the template's (or the link's default) and is
 *     widened to the metric's source floor
 *     (getMessageQueueMetricMonitorRollingTime: 30 minutes for CloudWatch,
 *     15 for Cloud Monitoring, whose points arrive minutes late). Monitor
 *     Create reads the window's length back as the rolling time.
 *
 * Monitor Create is pre-seeded through the metric explorer's URL schema
 * (MetricExplorerUrl.buildQueryParamsFromMetricViewData, which carries the
 * formulas and the thresholds too), exactly like the Database metric
 * chart's link (Pages/Database/Utils/DatabaseMetricMonitorLink.ts).
 */

// The alias of the monitor's one query, or of the formula of a series total.
export const MESSAGE_QUEUE_METRIC_MONITOR_VARIABLE: string = "a";

/*
 * The window a monitor without a template starts at, before the source
 * floor widens it: the shortest window the templates use.
 */
export const MESSAGE_QUEUE_METRIC_MONITOR_DEFAULT_ROLLING_TIME: RollingTime =
  RollingTime.Past5Minutes;

/*
 * The query parameter carrying the new monitor's description, which Monitor
 * Create reads (MONITOR_DESCRIPTION_QUERY_PARAM in Pages/Monitor/Create.tsx).
 */
export const MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM: string =
  "monitorDescription";

/** "Created from queue orders." — or "" without a name. */
export function getMessageQueueMetricMonitorDescription(
  queueName: string | null | undefined,
): string {
  const name: string = (queueName || "").trim();
  return name
    ? translateTemplate("Created from queue {{name}}.", { name: name })
    : "";
}

/** "orders: Queue depth" — what the monitor's query is titled. */
export function getMessageQueueMetricMonitorTitle(
  descriptor: Pick<MessageQueueMetricDescriptor, "title">,
  queueName: string | null | undefined,
): string {
  const name: string = (queueName || "").trim();
  return name ? `${name}: ${descriptor.title}` : descriptor.title;
}

// "Past 10 Minutes" → "10 minutes".
export function getMessageQueueRollingTimeWords(
  rollingTime: RollingTime,
): string {
  const words: string = String(rollingTime).replace(/^Past\s+/i, "");
  return words.toLowerCase();
}

// "Past 10 Minutes" → "10-minute", for "a 10-minute window".
export function getMessageQueueRollingTimeAdjective(
  rollingTime: RollingTime,
): string {
  const words: string = getMessageQueueRollingTimeWords(rollingTime);
  const match: RegExpMatchArray | null = words.match(/^(\d+)\s+([a-z]+?)s?$/);
  return match ? `${match[1]}-${match[2]}` : words;
}

/*
 * What Monitor Create makes of a link's threshold
 * (preSeedFromMetricExplorerLink in Pages/Monitor/Create.tsx): the
 * warningThreshold / criticalThreshold of a query or a formula becomes a
 * Warning / Critical criteria on that config's alias — a series total's
 * formula included — that fires when ANY point in the window is ABOVE it.
 * MessageQueueMonitorLinkMonitorCreate.test opens every gauge's link in the
 * real page and holds these to what it builds.
 */
export const MONITOR_CREATE_LINK_FILTER_TYPE: FilterType =
  FilterType.GreaterThan;
export const MONITOR_CREATE_LINK_EVALUATION: EvaluateOverTimeType =
  EvaluateOverTimeType.AnyValue;

// The criteria Monitor Create starts a monitor opened from a link with.
export interface MessageQueueMonitorCreateCriteria {
  severity: MessageQueueAlertTemplateSeverity;
  // The query alias the criteria compares.
  alias: string;
  filterType: FilterType;
  evaluation: EvaluateOverTimeType;
  // What a point has to be above, in the metric's own unit.
  value: number;
  // "1,000 messages".
  valueLabel: string;
}

/**
 * The threshold a link seeds for a template's. Monitor Create compares
 * "above", the templates "at or above" (FilterType.GreaterThanOrEqualTo),
 * and the two part only at the threshold itself. That matters for one
 * threshold: 1, the templates' "any" — a single dead-lettered message is one
 * too many — which "above 1" would never fire on. Such a threshold is seeded
 * as "above 0", for a count of whole messages exactly the same alert. Any
 * other is seeded as it is: "above 1,000" and "at or above 1,000" differ
 * only at exactly 1,000.
 */
export function getMessageQueueMonitorCreateThreshold(
  template: Pick<MessageQueueAlertTemplate, "threshold" | "filterType">,
): number {
  return template.filterType === FilterType.GreaterThanOrEqualTo &&
    template.threshold === 1
    ? 0
    : template.threshold;
}

export interface MessageQueueMetricMonitorLink {
  // Monitor Create with the metric explorer's params and the description.
  route: Route;
  // What the route carries, for callers and tests.
  viewData: MetricViewData;
  query: MessageQueueMetricMonitorQuery;
  // The alias the seeded threshold (and any criteria) compares.
  criteriaAlias: string;
  /*
   * The starting threshold the link seeds, in the metric's own unit — the
   * template's, as Monitor Create's "above" reads it
   * (getMessageQueueMonitorCreateThreshold) — or null without a template.
   */
  threshold: number | null;
  // "1,000 messages" — the threshold in words, or null.
  thresholdLabel: string | null;
  // Which criteria the threshold seeds, or null without one.
  thresholdSeverity: MessageQueueAlertTemplateSeverity | null;
  /*
   * The criteria Monitor Create builds from the link — on the query, or on
   * a series total's formula — or null without a template.
   */
  criteria: MessageQueueMonitorCreateCriteria | null;
  rollingTime: RollingTime;
  /*
   * The source floor that set the window (a CloudWatch or Cloud Monitoring
   * metric), or null when its points arrive live.
   */
  windowFloor: MessageQueueSourceWindowFloor | null;
  /*
   * One sentence when the monitor does not evaluate exactly the number the
   * chart shows (getMessageQueueMetricMonitorSeed's note), else null.
   */
  note: string | null;
}

/*
 * The config whose alias the criteria compare — the series total's formula
 * when there is one, else the query — with the threshold set on it.
 */
function withThreshold(data: {
  view: MessageQueueMetricMonitorViewConfig;
  threshold: number | null;
  severity: MessageQueueAlertTemplateSeverity | null;
}): {
  queryConfigs: Array<MetricQueryConfigData>;
  formulaConfigs: Array<MetricFormulaConfigData>;
} {
  const alias: string = data.view.criteriaAlias;
  const thresholdFields: {
    warningThreshold?: number | undefined;
    criticalThreshold?: number | undefined;
  } =
    data.threshold === null
      ? {}
      : data.severity === "Critical"
        ? { criticalThreshold: data.threshold }
        : { warningThreshold: data.threshold };

  const formulaConfigs: Array<MetricFormulaConfigData> =
    data.view.metricViewConfig.formulaConfigs.map(
      (formula: MetricFormulaConfigData): MetricFormulaConfigData => {
        return formula.metricAliasData.metricVariable === alias
          ? { ...formula, ...thresholdFields }
          : formula;
      },
    );
  const formulaCarriesAlias: boolean = formulaConfigs.some(
    (formula: MetricFormulaConfigData): boolean => {
      return formula.metricAliasData.metricVariable === alias;
    },
  );

  const queryConfigs: Array<MetricQueryConfigData> =
    data.view.metricViewConfig.queryConfigs.map(
      (queryConfig: MetricQueryConfigData): MetricQueryConfigData => {
        return !formulaCarriesAlias &&
          queryConfig.metricAliasData?.metricVariable === alias
          ? { ...queryConfig, ...thresholdFields }
          : queryConfig;
      },
    );

  return { queryConfigs, formulaConfigs };
}

/**
 * Monitor Create, pre-seeded with a metric view — the route with the metric
 * explorer's query params (metricQueries, metricFormulas, the window) and,
 * when the queue's name is known, the monitor's description.
 */
export function buildMessageQueueMetricMonitorRoute(
  viewData: MetricViewData,
  options?: { queueName?: string | null | undefined },
): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );
  const params: Dictionary<string> = {
    ...MetricExplorerUrl.buildQueryParamsFromMetricViewData(viewData),
  };
  const description: string = getMessageQueueMetricMonitorDescription(
    options?.queueName,
  );
  if (description) {
    params[MESSAGE_QUEUE_METRIC_MONITOR_DESCRIPTION_PARAM] = description;
  }
  const query: string = Object.keys(params)
    .map((name: string): string => {
      return `${encodeURIComponent(name)}=${encodeURIComponent(
        params[name] as string,
      )}`;
    })
    .join("&");
  return new Route(query ? `${route.toString()}?${query}` : route.toString());
}

/**
 * The "Create monitor" link for one broker health metric of one queue, or
 * null when no monitor can watch it: a counter (or any entry a monitor
 * cannot evaluate), or no observed series that resolves to the queue — the
 * link never opens a monitor that would watch nothing or another queue.
 */
export function buildMessageQueueMetricMonitorLink(data: {
  descriptor: MessageQueueMetricDescriptor;
  // Every series the metric was observed with under the queue's key.
  observedSeries: ReadonlyArray<MessageQueueObservedAttributes>;
  // parseMessageQueueIdentifier(row.queueIdentifier).
  identity: MessageQueueIdentity | null | undefined;
  queueName?: string | null | undefined;
}): MessageQueueMetricMonitorLink | null {
  const descriptor: MessageQueueMetricDescriptor = data.descriptor;

  // An identity that does not parse would let any queue's series through.
  if (!data.identity) {
    return null;
  }

  const query: MessageQueueMetricMonitorQuery | null =
    buildMessageQueueMetricMonitorQuery({
      descriptor: descriptor,
      observedSeries: data.observedSeries,
      identity: data.identity,
    });
  if (!query) {
    return null;
  }

  const template: MessageQueueAlertTemplate | undefined =
    getMessageQueueAlertTemplateForMetric(descriptor);
  const seed: MessageQueueMetricMonitorSeed | null =
    getMessageQueueMetricMonitorSeed(descriptor);

  const view: MessageQueueMetricMonitorViewConfig =
    buildMessageQueueMetricMonitorViewConfig({
      query: query,
      metricVariable: MESSAGE_QUEUE_METRIC_MONITOR_VARIABLE,
      title: getMessageQueueMetricMonitorTitle(descriptor, data.queueName),
      description: descriptor.description,
    });

  const threshold: number | null = template
    ? getMessageQueueMonitorCreateThreshold(template)
    : null;
  const severity: MessageQueueAlertTemplateSeverity | null = template
    ? template.severity
    : null;
  const thresholdLabel: string | null =
    threshold === null
      ? null
      : formatMessageQueueThreshold(threshold, descriptor.unit);
  // What Monitor Create builds from the threshold (MONITOR_CREATE_LINK_*).
  const criteria: MessageQueueMonitorCreateCriteria | null =
    threshold !== null && severity !== null && thresholdLabel !== null
      ? {
          severity: severity,
          alias: view.criteriaAlias,
          filterType: MONITOR_CREATE_LINK_FILTER_TYPE,
          evaluation: MONITOR_CREATE_LINK_EVALUATION,
          value: threshold,
          valueLabel: thresholdLabel,
        }
      : null;

  const rollingTime: RollingTime = getMessageQueueMetricMonitorRollingTime(
    descriptor,
    template
      ? template.rollingTime
      : MESSAGE_QUEUE_METRIC_MONITOR_DEFAULT_ROLLING_TIME,
  );
  const floor: MessageQueueSourceWindowFloor | null =
    getMessageQueueSourceWindowFloor(descriptor);

  const configs: {
    queryConfigs: Array<MetricQueryConfigData>;
    formulaConfigs: Array<MetricFormulaConfigData>;
  } = withThreshold({ view: view, threshold: threshold, severity: severity });

  /*
   * Monitor Create reads a link's window back as its rolling time (the
   * nearest one to the window's length), so the window IS the rolling time.
   */
  const rollingWindow: InBetween<Date> =
    RollingTimeUtil.convertToStartAndEndDate(rollingTime);

  const viewData: MetricViewData = {
    queryConfigs: configs.queryConfigs,
    formulaConfigs: configs.formulaConfigs,
    startAndEndDate: rollingWindow,
  };

  return {
    route: buildMessageQueueMetricMonitorRoute(viewData, {
      queueName: data.queueName,
    }),
    viewData: viewData,
    query: query,
    criteriaAlias: view.criteriaAlias,
    threshold: threshold,
    thresholdLabel: thresholdLabel,
    thresholdSeverity: severity,
    criteria: criteria,
    rollingTime: rollingTime,
    windowFloor:
      floor && floor.minimumRollingTime === rollingTime ? floor : null,
    note: seed ? seed.note : null,
  };
}

/**
 * The hint beside the link: exactly the criteria Monitor Create starts the
 * monitor with — "Warning when any point in the last 10 minutes is above
 * 1,000 messages" — or, when it builds none, "No starting threshold ·
 * 10-minute window". Never the template's criteria, which Monitor Create
 * does not build (see MONITOR_CREATE_LINK_*).
 */
export function getMessageQueueMetricMonitorHint(
  link: Pick<MessageQueueMetricMonitorLink, "criteria" | "rollingTime">,
): string {
  if (!link.criteria) {
    return translateTemplate("No starting threshold · {{window}} window", {
      window: getMessageQueueRollingTimeAdjective(link.rollingTime),
    });
  }
  return translateTemplate(
    "{{severity}} when any point in the last {{window}} is above {{value}}",
    {
      severity: translatableTerm(link.criteria.severity),
      window: getMessageQueueRollingTimeWords(link.rollingTime),
      value: link.criteria.valueLabel,
    },
  );
}
