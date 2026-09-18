import { SpanStatus } from "../../Models/AnalyticsModels/Span";
import ObjectID from "../ObjectID";
import MonitorStep from "./MonitorStep";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import MonitorType from "./MonitorType";
import RollingTime from "../RollingTime/RollingTime";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "../Metrics/MetricFormulaConfigData";
import { ServiceLanguage } from "../Service/ServiceLanguage";

/*
 * The curated alert library for an APM telemetry service — a backend process
 * reporting OpenTelemetry traces, metrics and exceptions under one
 * `service.name`.
 *
 * WHAT MAKES THIS MODULE DIFFERENT FROM THE OTHER NINE
 *
 * Every other `<X>AlertTemplates.ts` returns a constant: every Kubernetes
 * cluster is offered the same eighteen templates. A service's useful alerts
 * are not a constant, because the signals a runtime emits are a property of
 * the runtime. "Heap above 90% of -Xmx" is the single best leading indicator
 * of a Java outage and is meaningless on a Go service, which has no heap
 * limit metric and instead leaks goroutines. Offering JVM templates to a Go
 * service does not produce a wrong alert — it produces a monitor that queries
 * a metric nobody emits and therefore never fires, which is the worst outcome
 * available: the team believes they are covered.
 *
 * So templates carry a `language` discriminator and callers ask for the set
 * that matches the service's detected runtime — see `getServiceAlertTemplates`.
 * Templates with no `language` apply to every service whatever it runs.
 *
 * THREE CONSTRAINTS THE PLATFORM IMPOSES, WHICH SHAPE EVERY TEMPLATE HERE
 *
 *   1. Only one CheckOn exists per telemetry monitor type: `MetricValue` for
 *      Metrics, `SpanCount` for Traces, `ExceptionCount` for Exceptions. There
 *      is no span-duration CheckOn (`TraceMonitorResponse` carries only a
 *      count), so latency alerts MUST be metric monitors over a duration
 *      histogram, never trace monitors.
 *
 *   2. Cumulative monotonic counters are unusable. Ingest stores OTel counters
 *      raw — the per-second-rate transform on `MetricQueryConfigData` is a
 *      chart-side transform the monitor worker never reads — so thresholding
 *      one compares against a since-process-start total that only grows: it
 *      fires once and never clears. That disqualifies the most tempting
 *      metrics in three languages (`dotnet.exceptions`,
 *      `cpython.gc.collections`, `process.runtime.go.gc.count`) and is why
 *      counting signals below go through trace and exception monitors, which
 *      count rows in a rolling window. Everything thresholded here is a gauge,
 *      an UpDownCounter, or a histogram read through a percentile.
 *
 *   3. A monitor holds exactly ONE metric name — there is no server-side
 *      equivalent of the dashboard's candidate probing (`probeRuntimeCharts`,
 *      which tries a stable name then a legacy one and keeps whichever has
 *      data). Every template below therefore targets the STABLE semantic
 *      convention name, and names the pre-stabilization metric in its
 *      description so a team on an older SDK can retarget the created monitor
 *      in one edit rather than wonder why it is silent.
 *
 * The metric names, and the attribute filters that go with them, are taken
 * verbatim from the service overview's runtime charts
 * (`serviceGoldenMetrics.ts`) wherever the two overlap, so a chart the user
 * can see and an alert they can create describe the same number.
 */

export type ServiceAlertTemplateCategory =
  | "Errors"
  | "Latency"
  | "Throughput"
  | "Saturation"
  | "JVM Runtime"
  | ".NET Runtime"
  | "Node.js Runtime"
  | "Python Runtime"
  | "Go Runtime";

export type ServiceAlertTemplateSeverity = "Critical" | "Warning";

export interface ServiceAlertTemplateArgs {
  serviceId: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
}

export interface ServiceAlertTemplate {
  id: string;
  name: string;
  description: string;
  category: ServiceAlertTemplateCategory;
  severity: ServiceAlertTemplateSeverity;
  monitorType: MonitorType;
  /*
   * The runtime this template is for. Undefined means "every service" — the
   * RED signals and the process-level ones, which come from spans, exceptions
   * and the host-metrics instrumentation rather than from any runtime.
   */
  language?: ServiceLanguage | undefined;
  getMonitorStep: (args: ServiceAlertTemplateArgs) => MonitorStep;
}

/*
 * `EvaluateOverTimeType` names the window collapse. The two members these
 * templates use are worth stating once, here, rather than being rediscovered
 * per template:
 *
 *   AnyValue  -> ANY bucket in the rolling window breaching is a breach.
 *                Right for spikes.
 *   AllValues -> EVERY bucket must breach. Right for sustained pressure.
 *
 * The reducing members (`Average`, `Sum`, `MaximumValue`, `MunimumValue`) do
 * now collapse the window to one sample before the comparison —
 * `CompareCriteria.reduceWindow` — so they mean what they say. `AllValues` is
 * still the right default here: a reduced window hides the shape, and a metric
 * that spends half the window fine is not under sustained pressure.
 *
 * A window with no samples at all never reaches the comparator — the
 * evaluator's no-data guard returns "not breaching" under the default
 * `NoDataPolicy.Ignore` — so `AllValues` cannot fire on an empty window.
 *
 * Applying `AllValues` to the healthy criteria too, as these templates do,
 * buys hysteresis for free: a window where some buckets breach and others do
 * not matches neither criteria, so the monitor holds its current status
 * instead of flipping on every evaluation while a metric sits on the
 * threshold. Alerting on a metric that hovers is the fastest way to teach a
 * team to mute it.
 */
const SUSTAINED: EvaluateOverTimeType = EvaluateOverTimeType.AllValues;

/*
 * The resource attribute that identifies ONE process of a service.
 *
 * Every metric template here except the two request-latency percentiles
 * thresholds a property of a single process — a heap, an event loop, a
 * goroutine count, a thread pool. Without a group-by the ClickHouse
 * aggregation collapses every replica of the service into one number, so an
 * `Avg` template on three replicas at 95/20/20 reads 45 and stays green while
 * one of them OOM-kills, and a `Max` template fires on the worst replica with
 * no way to say which. Grouping fixes both at once: the worker emits one
 * series per instance and the alert carries that instance in `seriesLabels`,
 * which `SeriesLabelDisplay` renders into the title and the description block.
 *
 * `service.instance.id` is OPTIONAL in the resource semantic conventions, and
 * this degrades safely when it is absent: the query returns one series whose
 * label value is the empty string (ClickHouse `attributes[k]` on a missing key
 * yields ""), `MetricSeriesFingerprint.extractSeriesLabels` keeps the key so
 * the fingerprint stays stable across evaluations, and
 * `SeriesLabelDisplay.getDisplayLabels` drops empty values rather than
 * rendering "Instance: ". A service that does not report it therefore gets
 * exactly today's single-series behaviour, not silence.
 *
 * The `resource.` prefix is the one OtelMetricsIngestService stamps onto OTel
 * resource attributes (`prefixKeysWithString: "resource"`), the same spelling
 * KubernetesAlertTemplates uses for `resource.k8s.pod.name`.
 */
const PER_INSTANCE_GROUP_BY: Array<string> = ["resource.service.instance.id"];

interface CountCriteriaArgs {
  args: ServiceAlertTemplateArgs;
  checkOn: CheckOn.SpanCount | CheckOn.ExceptionCount;
  unhealthyFilterType: FilterType;
  healthyFilterType: FilterType;
  threshold: number;
  unhealthyName: string;
  unhealthyDescription: string;
  incidentTitle: string;
  incidentDescription: string;
}

interface MetricCriteriaArgs {
  args: ServiceAlertTemplateArgs;
  unhealthyFilterType: FilterType;
  healthyFilterType: FilterType;
  threshold: number;
  metricAlias: string;
  thresholdUnit?: string | undefined;
  unhealthyName: string;
  unhealthyDescription: string;
  incidentTitle: string;
  incidentDescription: string;
}

/*
 * The unhealthy/healthy criteria pair every template ships.
 *
 * Both instances are always produced, with mirrored filter types, because a
 * monitor with no healthy criteria never comes back online: it opens an
 * incident, auto-resolves it (the incidents carry `autoResolveIncident`), and
 * then sits in its offline status forever with nothing to move it back.
 */
function buildCriteriaPair(data: {
  args: ServiceAlertTemplateArgs;
  checkOn: CheckOn;
  unhealthyFilterType: FilterType;
  healthyFilterType: FilterType;
  threshold: number;
  metricAlias?: string | undefined;
  thresholdUnit?: string | undefined;
  unhealthyName: string;
  unhealthyDescription: string;
  incidentTitle: string;
  incidentDescription: string;
  healthyDescription: string;
}): MonitorCriteria {
  const metricMonitorOptions:
    | {
        metricAggregationType: EvaluateOverTimeType;
        metricAlias: string;
        thresholdUnit?: string | undefined;
      }
    | undefined = data.metricAlias
    ? {
        metricAggregationType: SUSTAINED,
        metricAlias: data.metricAlias,
        thresholdUnit: data.thresholdUnit,
      }
    : undefined;

  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.unhealthyFilterType,
        value: data.threshold,
        /*
         * A copy per filter, not the shared object. `MetricMonitorCriteria`
         * writes its `AnyValue` default straight back through this reference
         * when `metricAggregationType` is unset, and the criteria form spreads
         * and re-assigns it on edit — either of which, on a shared object,
         * changes the healthy criteria as a side effect of touching the
         * unhealthy one.
         */
        metricMonitorOptions: metricMonitorOptions
          ? { ...metricMonitorOptions }
          : undefined,
      },
    ],
    incidents: [
      {
        title: data.incidentTitle,
        description: data.incidentDescription,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: data.incidentTitle,
        description: data.incidentDescription,
        alertSeverityId: data.args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    createIncidents: true,
    createAlerts: true,
    name: data.unhealthyName,
    description: data.unhealthyDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.healthyFilterType,
        value: data.threshold,
        // A copy per filter — see the unhealthy filter above.
        metricMonitorOptions: metricMonitorOptions
          ? { ...metricMonitorOptions }
          : undefined,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: data.healthyDescription,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();
  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

function buildCountCriteria(data: CountCriteriaArgs): MonitorCriteria {
  return buildCriteriaPair({
    args: data.args,
    checkOn: data.checkOn,
    unhealthyFilterType: data.unhealthyFilterType,
    healthyFilterType: data.healthyFilterType,
    threshold: data.threshold,
    unhealthyName: data.unhealthyName,
    unhealthyDescription: data.unhealthyDescription,
    incidentTitle: data.incidentTitle,
    incidentDescription: data.incidentDescription,
    healthyDescription: `${data.args.monitorName} is within its recommended threshold.`,
  });
}

function buildMetricCriteria(data: MetricCriteriaArgs): MonitorCriteria {
  return buildCriteriaPair({
    args: data.args,
    checkOn: CheckOn.MetricValue,
    unhealthyFilterType: data.unhealthyFilterType,
    healthyFilterType: data.healthyFilterType,
    threshold: data.threshold,
    metricAlias: data.metricAlias,
    thresholdUnit: data.thresholdUnit,
    unhealthyName: data.unhealthyName,
    unhealthyDescription: data.unhealthyDescription,
    incidentTitle: data.incidentTitle,
    incidentDescription: data.incidentDescription,
    healthyDescription: `${data.args.monitorName} is within its recommended threshold.`,
  });
}

/*
 * One metric query.
 *
 * `metricVariable` is the alias the criteria filter names, and getting it
 * wrong is silent: an alias that matches no query falls back to query result
 * slot 0, so a two-query template with a typo'd alias would threshold the
 * wrong series. Every alias below is passed to both the query config and its
 * criteria from the same local constant for exactly that reason.
 *
 * `legendUnit` is what makes a threshold portable across SDKs that report the
 * same metric in different units: the worker converts each sample from the
 * metric's own reported unit into this one before comparing. Setting it to
 * `"ms"` on a semconv duration histogram (reported in seconds) is what lets
 * the threshold below be written as a readable millisecond count.
 */
function buildQueryConfig(data: {
  metricName: string;
  metricAlias: string;
  title: string;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string> | undefined;
  legendUnit?: string | undefined;
  groupByAttributeKeys?: Array<string> | undefined;
}): MetricQueryConfigData {
  return {
    metricAliasData: {
      metricVariable: data.metricAlias,
      title: data.title,
      description: data.title,
      legend: data.title,
      legendUnit: data.legendUnit,
    },
    metricQueryData: {
      filterData: {
        metricName: data.metricName,
        attributes: data.attributes || {},
        aggegationType: data.aggregationType,
        aggregateBy: {},
      },
      /*
       * Omitted entirely rather than written as [] when there is nothing to
       * group by, so an ungrouped template serializes to exactly the shape it
       * did before this parameter existed.
       */
      ...(data.groupByAttributeKeys && data.groupByAttributeKeys.length > 0
        ? { groupByAttributeKeys: data.groupByAttributeKeys }
        : {}),
    },
  };
}

/*
 * A single-metric threshold template: one query, one criteria pair.
 */
function buildMetricTemplate(data: {
  id: string;
  name: string;
  description: string;
  category: ServiceAlertTemplateCategory;
  severity: ServiceAlertTemplateSeverity;
  language?: ServiceLanguage | undefined;
  metricName: string;
  metricAlias: string;
  aggregationType: MetricsAggregationType;
  attributes?: Record<string, string> | undefined;
  legendUnit?: string | undefined;
  threshold: number;
  thresholdLabel: string;
  rollingTime?: RollingTime | undefined;
  unhealthyFilterType?: FilterType | undefined;
  healthyFilterType?: FilterType | undefined;
  /*
   * Defaults to per-instance. Pass `[]` only for a metric that is a property
   * of the SERVICE rather than of one process — the request latency
   * percentiles are the only two here, and grouping them would quietly change
   * "the service's p95" into "some replica's p95", which is a different alert.
   */
  groupByAttributeKeys?: Array<string> | undefined;
  incidentDescription: string;
}): ServiceAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: data.category,
    severity: data.severity,
    monitorType: MonitorType.Metrics,
    language: data.language,
    getMonitorStep: (args: ServiceAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setMetricMonitor({
        telemetryServiceIds: [new ObjectID(args.serviceId)],
        rollingTime: data.rollingTime || RollingTime.Past5Minutes,
        metricViewConfig: {
          queryConfigs: [
            buildQueryConfig({
              metricName: data.metricName,
              metricAlias: data.metricAlias,
              title: data.name,
              aggregationType: data.aggregationType,
              attributes: data.attributes,
              legendUnit: data.legendUnit,
              groupByAttributeKeys:
                data.groupByAttributeKeys || PER_INSTANCE_GROUP_BY,
            }),
          ],
          formulaConfigs: [],
        },
      });

      step.setMonitorCriteria(
        buildMetricCriteria({
          args: args,
          unhealthyFilterType:
            data.unhealthyFilterType || FilterType.GreaterThanOrEqualTo,
          healthyFilterType: data.healthyFilterType || FilterType.LessThan,
          threshold: data.threshold,
          metricAlias: data.metricAlias,
          thresholdUnit: data.legendUnit,
          unhealthyName: `${data.name} - ${data.thresholdLabel} or worse`,
          unhealthyDescription: `Triggers when ${data.metricName} stays at ${data.thresholdLabel} or worse for the whole evaluation window.`,
          incidentTitle: `[Service] ${data.name} - ${args.monitorName}`,
          incidentDescription: data.incidentDescription,
        }),
      );

      return step;
    },
  };
}

/*
 * A ratio template: two queries and a formula, thresholded as a percentage.
 *
 * This is the shape worth reaching for whenever the runtime reports both a
 * usage and its limit, because it is the only kind of memory threshold that is
 * portable. "Heap above 2 GB" is a guess about someone else's `-Xmx`; "heap
 * above 90% of the limit the JVM was actually given" is true on a 512 MB
 * sidecar and a 64 GB batch node alike, with no tuning.
 *
 * The criteria filter names the FORMULA's alias, not either query's — the
 * evaluator resolves an alias against the query configs first and the formula
 * configs second, so the three aliases must all differ.
 */
function buildRatioTemplate(data: {
  id: string;
  name: string;
  description: string;
  category: ServiceAlertTemplateCategory;
  severity: ServiceAlertTemplateSeverity;
  language?: ServiceLanguage | undefined;
  numeratorMetricName: string;
  numeratorAttributes?: Record<string, string> | undefined;
  denominatorMetricName: string;
  denominatorAttributes?: Record<string, string> | undefined;
  numeratorAlias: string;
  denominatorAlias: string;
  resultAlias: string;
  thresholdPercent: number;
  groupByAttributeKeys?: Array<string> | undefined;
  incidentDescription: string;
}): ServiceAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: data.category,
    severity: data.severity,
    monitorType: MonitorType.Metrics,
    language: data.language,
    getMonitorStep: (args: ServiceAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Metrics,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      const formulaConfig: MetricFormulaConfigData = {
        metricAliasData: {
          metricVariable: data.resultAlias,
          title: data.name,
          description: data.name,
          legend: data.name,
          legendUnit: "%",
        },
        metricFormulaData: {
          metricFormula: `(${data.numeratorAlias} / ${data.denominatorAlias}) * 100`,
        },
      };

      step.setMetricMonitor({
        telemetryServiceIds: [new ObjectID(args.serviceId)],
        rollingTime: RollingTime.Past5Minutes,
        metricViewConfig: {
          /*
           * Both sides are summed rather than averaged. A runtime reports
           * usage and limit per memory pool, so a service with three heap
           * pools produces three series on each side; summing gives
           * "total used / total limit", which is the number a human means by
           * "heap is 90% full".
           */
          queryConfigs: [
            buildQueryConfig({
              metricName: data.numeratorMetricName,
              metricAlias: data.numeratorAlias,
              title: `${data.name} (used)`,
              aggregationType: MetricsAggregationType.Sum,
              attributes: data.numeratorAttributes,
              /*
               * The SAME key set on both queries. The worker splits every
               * query on the UNION of their keys, so the split itself cannot
               * go wrong from setting only one side — but
               * `MetricMonitorCriteria.buildContext` reads
               * `groupByAttributeKeys` off a SINGLE query config when it
               * builds the alert's "Grouped By" root-cause block, and a
               * one-sided setting renders that block empty for whichever side
               * it read.
               */
              groupByAttributeKeys:
                data.groupByAttributeKeys || PER_INSTANCE_GROUP_BY,
            }),
            buildQueryConfig({
              metricName: data.denominatorMetricName,
              metricAlias: data.denominatorAlias,
              title: `${data.name} (limit)`,
              aggregationType: MetricsAggregationType.Sum,
              attributes: data.denominatorAttributes,
              groupByAttributeKeys:
                data.groupByAttributeKeys || PER_INSTANCE_GROUP_BY,
            }),
          ],
          formulaConfigs: [formulaConfig],
        },
      });

      step.setMonitorCriteria(
        buildMetricCriteria({
          args: args,
          unhealthyFilterType: FilterType.GreaterThanOrEqualTo,
          healthyFilterType: FilterType.LessThan,
          threshold: data.thresholdPercent,
          metricAlias: data.resultAlias,
          thresholdUnit: "%",
          unhealthyName: `${data.name} - ${data.thresholdPercent}% or higher`,
          unhealthyDescription: `Triggers when ${data.numeratorMetricName} stays at ${data.thresholdPercent}% or more of ${data.denominatorMetricName} for the whole evaluation window.`,
          incidentTitle: `[Service] ${data.name} - ${args.monitorName}`,
          incidentDescription: data.incidentDescription,
        }),
      );

      return step;
    },
  };
}

/*
 * A span-count template.
 *
 * `spanStatuses: [SpanStatus.Error]` is what turns "how busy is this service"
 * into "how much of it is failing" — the count query filters to error-status
 * spans server-side, so the threshold is a failure count and not a traffic
 * count.
 */
function buildSpanCountTemplate(data: {
  id: string;
  name: string;
  description: string;
  category: ServiceAlertTemplateCategory;
  severity: ServiceAlertTemplateSeverity;
  spanStatuses: Array<SpanStatus>;
  lastXSecondsOfSpans: number;
  threshold: number;
  unhealthyFilterType: FilterType;
  healthyFilterType: FilterType;
  unhealthyName: string;
  unhealthyDescription: string;
  incidentDescription: string;
}): ServiceAlertTemplate {
  return {
    id: data.id,
    name: data.name,
    description: data.description,
    category: data.category,
    severity: data.severity,
    monitorType: MonitorType.Traces,
    getMonitorStep: (args: ServiceAlertTemplateArgs): MonitorStep => {
      const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
        monitorName: args.monitorName,
        monitorType: MonitorType.Traces,
        onlineMonitorStatusId: args.onlineMonitorStatusId,
        offlineMonitorStatusId: args.offlineMonitorStatusId,
        defaultIncidentSeverityId: args.defaultIncidentSeverityId,
        defaultAlertSeverityId: args.defaultAlertSeverityId,
      });

      step.setTraceMonitor({
        attributes: {},
        spanName: "",
        spanStatuses: data.spanStatuses,
        telemetryServiceIds: [new ObjectID(args.serviceId)],
        entityKeys: [],
        lastXSecondsOfSpans: data.lastXSecondsOfSpans,
      });

      step.setMonitorCriteria(
        buildCountCriteria({
          args: args,
          checkOn: CheckOn.SpanCount,
          unhealthyFilterType: data.unhealthyFilterType,
          healthyFilterType: data.healthyFilterType,
          threshold: data.threshold,
          unhealthyName: data.unhealthyName,
          unhealthyDescription: data.unhealthyDescription,
          incidentTitle: `[Service] ${data.name} - ${args.monitorName}`,
          incidentDescription: data.incidentDescription,
        }),
      );

      return step;
    },
  };
}

// --- Language-agnostic templates ---

/*
 * Ten minutes rather than the five the RUM catalog uses for its equivalent.
 * A browser session is a few seconds long, so RUM wants the shortest window
 * that can hold a signal; a backend service is judged over the window its SLO
 * is written against, and ten minutes rides out the single transient blip that
 * would otherwise page someone for a request that had already been retried
 * successfully.
 *
 * It also keeps this template's coverage fingerprint distinct from
 * `rum-failed-user-operations`, which is otherwise structurally identical to
 * it — same config kind, same error-status filter, same threshold. The
 * fingerprint separates them today by resource identifier (a Service row id
 * can never equal a RumApplication row id), but the evaluation window is what
 * separates them on their own terms. Shortening this back to 300 makes the two
 * indistinguishable to anything that compares templates rather than monitors.
 */
const failedOperationsTemplate: ServiceAlertTemplate = buildSpanCountTemplate({
  id: "service-failed-operations",
  name: "Failed Operations",
  description:
    "Alert when the service reports any error-status span in ten minutes. The earliest signal that requests are failing, whatever the cause.",
  category: "Errors",
  severity: "Warning",
  spanStatuses: [SpanStatus.Error],
  lastXSecondsOfSpans: 600,
  threshold: 0,
  unhealthyFilterType: FilterType.GreaterThan,
  healthyFilterType: FilterType.LessThanOrEqualTo,
  unhealthyName: "Error spans detected",
  unhealthyDescription:
    "Triggers when at least one error-status span is reported in ten minutes.",
  incidentDescription:
    "The service reported an error-status span. Open the trace to see which operation failed, what it was called by, and which downstream dependency it was waiting on.",
});

/*
 * Warning above, Critical here, on the same signal at a much higher bar.
 * A backend service that has never once returned an error is rare; one
 * returning twenty-five in five minutes is having an incident. Shipping both
 * lets a team pick the sensitivity that matches their traffic instead of
 * picking between "pages constantly" and "nothing".
 */
const errorBurstTemplate: ServiceAlertTemplate = buildSpanCountTemplate({
  id: "service-error-burst",
  name: "Error Burst",
  description:
    "Alert when error-status spans exceed 25 in five minutes — a failure rate well past routine noise.",
  category: "Errors",
  severity: "Critical",
  spanStatuses: [SpanStatus.Error],
  lastXSecondsOfSpans: 300,
  threshold: 25,
  unhealthyFilterType: FilterType.GreaterThan,
  healthyFilterType: FilterType.LessThanOrEqualTo,
  unhealthyName: "Error spans above 25 in five minutes",
  unhealthyDescription:
    "Triggers when more than 25 error-status spans are reported in five minutes.",
  incidentDescription:
    "The service is failing at a rate well above routine noise. Group the failing spans by operation and by downstream dependency to find the common factor, and check what deployed recently.",
});

/*
 * Fires when a service goes quiet, so the healthy/unhealthy filter types are
 * inverted relative to every other template here: below the threshold is the
 * bad state.
 *
 * Fifteen minutes rather than five, and Warning rather than Critical, because
 * plenty of legitimate services are idle at 3am. It is offered rather than
 * assumed — for an always-on request path it is the cheapest possible
 * liveness check, needing no health endpoint and no probe.
 */
const trafficStoppedTemplate: ServiceAlertTemplate = buildSpanCountTemplate({
  id: "service-traffic-stopped",
  name: "Traffic Stopped",
  description:
    "Alert when the service produces no spans at all for fifteen minutes. Best on an always-on request path; a service with idle periods will trigger it legitimately.",
  category: "Throughput",
  severity: "Warning",
  spanStatuses: [],
  lastXSecondsOfSpans: 900,
  threshold: 1,
  unhealthyFilterType: FilterType.LessThan,
  healthyFilterType: FilterType.GreaterThanOrEqualTo,
  unhealthyName: "No spans in fifteen minutes",
  unhealthyDescription:
    "Triggers when the service reports no spans at all over fifteen minutes.",
  incidentDescription:
    "The service has stopped producing telemetry. Either it is down, it lost its route to the collector, or its callers stopped calling — check the process, then the exporter, then upstream traffic.",
});

const unhandledExceptionsTemplate: ServiceAlertTemplate = {
  id: "service-unhandled-exceptions",
  name: "Unhandled Exceptions",
  description:
    "Alert when the service reports any unresolved exception in ten minutes. Exceptions already marked resolved or archived are excluded, so acknowledging one closes the alert.",
  category: "Errors",
  severity: "Critical",
  monitorType: MonitorType.Exceptions,
  getMonitorStep: (args: ServiceAlertTemplateArgs): MonitorStep => {
    const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
      monitorName: args.monitorName,
      monitorType: MonitorType.Exceptions,
      onlineMonitorStatusId: args.onlineMonitorStatusId,
      offlineMonitorStatusId: args.offlineMonitorStatusId,
      defaultIncidentSeverityId: args.defaultIncidentSeverityId,
      defaultAlertSeverityId: args.defaultAlertSeverityId,
    });

    step.setExceptionMonitor({
      telemetryServiceIds: [new ObjectID(args.serviceId)],
      entityKeys: [],
      exceptionTypes: [],
      message: "",
      includeResolved: false,
      includeArchived: false,
      // Ten minutes, for the reasons given on failedOperationsTemplate.
      lastXSecondsOfExceptions: 600,
    });

    step.setMonitorCriteria(
      buildCountCriteria({
        args: args,
        checkOn: CheckOn.ExceptionCount,
        unhealthyFilterType: FilterType.GreaterThan,
        healthyFilterType: FilterType.LessThanOrEqualTo,
        threshold: 0,
        unhealthyName: "Unhandled exception detected",
        unhealthyDescription:
          "Triggers when at least one unresolved exception is reported in ten minutes.",
        incidentTitle: `[Service] Unhandled exception - ${args.monitorName}`,
        incidentDescription:
          "The service reported an unresolved exception. Inspect the exception group, its stack trace, the release it appeared in, and how many distinct requests it affected.",
      }),
    );

    return step;
  },
};

/*
 * Latency has to be a metric monitor: trace monitors can only count spans,
 * and no span-duration criterion exists anywhere in the evaluator.
 *
 * `http.server.request.duration` is the histogram the percentile path was
 * built for — the metric service fans its buckets into weighted samples and
 * runs a real quantile rather than taking a percentile of per-row sums.
 *
 * `legendUnit: "ms"` normalizes the two units this metric arrives in: the
 * semantic convention says seconds, while OneUptime's own instrumentation
 * reports milliseconds. Converting both to milliseconds before comparing is
 * what makes one threshold correct for both.
 */
const latencyP95Template: ServiceAlertTemplate = buildMetricTemplate({
  id: "service-latency-p95",
  name: "High Request Latency (p95)",
  description:
    "Alert when the 95th-percentile server request duration stays at or above one second. Reads http.server.request.duration; older SDKs report this as http.server.duration.",
  category: "Latency",
  severity: "Warning",
  metricName: "http.server.request.duration",
  metricAlias: "service_latency_p95",
  aggregationType: MetricsAggregationType.P95,
  legendUnit: "ms",
  /*
   * Not grouped, unlike every other metric template here. A request latency
   * percentile is a property of the SERVICE — it is the number the SLO is
   * written against — and splitting it per instance would turn "the service's
   * p95 is above a second" into "one replica's p95 is above a second", which
   * fires on a single slow pod and means something else.
   */
  groupByAttributeKeys: [],
  threshold: 1000,
  thresholdLabel: "1,000 ms",
  incidentDescription:
    "One in twenty requests is now taking a second or more. Break the latency down by route and by downstream call to find where the time is going.",
});

const latencyP99Template: ServiceAlertTemplate = buildMetricTemplate({
  id: "service-latency-p99",
  name: "Severe Request Latency (p99)",
  description:
    "Alert when the 99th-percentile server request duration stays at or above 2.5 seconds — the tail users abandon.",
  category: "Latency",
  severity: "Critical",
  metricName: "http.server.request.duration",
  metricAlias: "service_latency_p99",
  aggregationType: MetricsAggregationType.P99,
  legendUnit: "ms",
  // Service-level, not per instance — see latencyP95Template.
  groupByAttributeKeys: [],
  threshold: 2500,
  thresholdLabel: "2,500 ms",
  incidentDescription:
    "The slowest one percent of requests are taking 2.5 seconds or more. Look for a saturated dependency, a lock, or a slow query on the affected route.",
});

/*
 * `process.cpu.utilization` and `process.memory.usage` come from the
 * host-metrics / system-metrics instrumentation rather than from any language
 * runtime, which is why they sit in the agnostic set. They are opt-in in every
 * SDK: a service that has not enabled that instrumentation gets a monitor that
 * never fires, which is why both say so in their descriptions.
 *
 * The threshold is a raw [0, 1] ratio, matching how the host templates already
 * express utilization (`0.85 == 85%`) and how the SDKs report it. It is
 * deliberately NOT converted to a percentage: that conversion depends on the
 * metric's declared unit being present, and a missing unit would silently turn
 * "85%" into a threshold no fraction can ever reach.
 */
const processCpuTemplate: ServiceAlertTemplate = buildMetricTemplate({
  id: "service-process-cpu-saturation",
  name: "Process CPU Saturation",
  description:
    "Alert when the process stays above 85% CPU utilization. Needs the host-metrics instrumentation enabled in the service's SDK.",
  category: "Saturation",
  severity: "Warning",
  metricName: "process.cpu.utilization",
  metricAlias: "service_process_cpu",
  aggregationType: MetricsAggregationType.Avg,
  threshold: 0.85,
  thresholdLabel: "85%",
  unhealthyFilterType: FilterType.GreaterThan,
  healthyFilterType: FilterType.LessThanOrEqualTo,
  incidentDescription:
    "The process has been pinned above 85% CPU for the whole window. Requests will be queueing behind it — check for a hot loop, a retry storm, or a workload that outgrew its CPU allocation.",
});

const processMemoryTemplate: ServiceAlertTemplate = buildMetricTemplate({
  id: "service-process-memory-high",
  name: "Process Memory High",
  description:
    "Alert when process resident memory stays above 1 GB. An absolute budget — retune it to your container limit. Needs the host-metrics instrumentation enabled.",
  category: "Saturation",
  severity: "Warning",
  metricName: "process.memory.usage",
  metricAlias: "service_process_memory",
  aggregationType: MetricsAggregationType.Avg,
  threshold: 1073741824,
  thresholdLabel: "1 GB",
  unhealthyFilterType: FilterType.GreaterThan,
  healthyFilterType: FilterType.LessThanOrEqualTo,
  incidentDescription:
    "Process memory has stayed above its budget for the whole window. If it only ever climbs, it is a leak; if it climbs and drops, the workload has outgrown the container limit and will be OOM-killed next.",
});

// --- Java ---

const javaTemplates: Array<ServiceAlertTemplate> = [
  buildRatioTemplate({
    id: "service-java-heap-utilization",
    name: "JVM Heap Utilization",
    description:
      "Alert when live heap stays at or above 90% of the JVM's configured heap limit — the leading indicator of GC thrashing and OutOfMemoryError.",
    category: "JVM Runtime",
    severity: "Critical",
    language: "java",
    numeratorMetricName: "jvm.memory.used",
    numeratorAttributes: { "jvm.memory.type": "heap" },
    denominatorMetricName: "jvm.memory.limit",
    denominatorAttributes: { "jvm.memory.type": "heap" },
    numeratorAlias: "jvm_heap_used",
    denominatorAlias: "jvm_heap_limit",
    resultAlias: "jvm_heap_percent",
    thresholdPercent: 90,
    incidentDescription:
      "The JVM heap is at or above 90% of its limit. Expect long GC pauses next and an OutOfMemoryError after that. Take a heap dump before restarting — a restart clears the symptom and destroys the evidence.",
  }),
  buildMetricTemplate({
    id: "service-java-live-heap-after-gc",
    name: "Live Heap After GC",
    description:
      "Alert when the bytes still live after the last collection stay above 2 GB. Unlike heap used, this ignores allocation churn, so a rise here is a genuine leak. Retune to roughly 85% of your -Xmx.",
    category: "JVM Runtime",
    severity: "Warning",
    language: "java",
    metricName: "jvm.memory.used_after_last_gc",
    metricAlias: "jvm_heap_after_gc",
    aggregationType: MetricsAggregationType.Max,
    attributes: { "jvm.memory.type": "heap" },
    threshold: 2147483648,
    thresholdLabel: "2 GB",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Memory that survives every collection keeps growing, which is what a leak looks like from the outside. Compare heap dumps taken an hour apart and look at which retained set grew.",
  }),
  buildMetricTemplate({
    id: "service-java-gc-pause-p99",
    name: "Long GC Pauses",
    description:
      "Alert when the 99th-percentile garbage collection pause stays at or above one second. Reads jvm.gc.duration; older agents report process.runtime.jvm.gc.duration.",
    category: "JVM Runtime",
    severity: "Critical",
    language: "java",
    metricName: "jvm.gc.duration",
    metricAlias: "jvm_gc_pause_p99",
    aggregationType: MetricsAggregationType.P99,
    legendUnit: "ms",
    threshold: 1000,
    thresholdLabel: "1,000 ms",
    incidentDescription:
      "The JVM is stopping the world for a second or more at the tail. Every request in flight during a pause pays for it, so this shows up to callers as latency with no slow query behind it. Check heap headroom and collector choice.",
  }),
  buildMetricTemplate({
    id: "service-java-cpu-saturation",
    name: "JVM CPU Saturation",
    description:
      "Alert when the JVM's recent CPU utilization stays above 85%. Reads jvm.cpu.recent_utilization; older agents report process.runtime.jvm.cpu.utilization.",
    category: "JVM Runtime",
    severity: "Warning",
    language: "java",
    metricName: "jvm.cpu.recent_utilization",
    metricAlias: "jvm_cpu",
    aggregationType: MetricsAggregationType.Avg,
    threshold: 0.85,
    thresholdLabel: "85%",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "The JVM has been pinned above 85% CPU for the whole window. If GC pause time rose with it, this is GC thrashing rather than application work — check heap utilization first.",
  }),
  buildMetricTemplate({
    id: "service-java-thread-explosion",
    name: "Thread Count Explosion",
    description:
      "Alert when live thread count stays above 500 — an unbounded pool, a leaked executor, or thread-per-request under load. Reads jvm.thread.count; older agents report process.runtime.jvm.threads.count.",
    category: "JVM Runtime",
    severity: "Warning",
    language: "java",
    metricName: "jvm.thread.count",
    metricAlias: "jvm_threads",
    aggregationType: MetricsAggregationType.Max,
    threshold: 500,
    thresholdLabel: "500 threads",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Live threads have stayed above 500. Each one costs stack memory and scheduler time, and a count that only climbs means threads are being created faster than they finish. Take a thread dump and look for the pool that has no bound.",
  }),
  buildMetricTemplate({
    id: "service-java-non-heap-growth",
    name: "Non-Heap Memory Growth",
    description:
      "Alert when non-heap memory — metaspace, code cache, compressed class space — stays above 512 MB. Usually a classloader leak, dynamic proxy churn, or an agent gone wrong.",
    category: "JVM Runtime",
    severity: "Warning",
    language: "java",
    metricName: "jvm.memory.used",
    metricAlias: "jvm_non_heap_used",
    aggregationType: MetricsAggregationType.Sum,
    attributes: { "jvm.memory.type": "non_heap" },
    threshold: 536870912,
    thresholdLabel: "512 MB",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Non-heap memory has grown past its budget. Heap dumps will not show this — look at loaded class count over time, and at anything generating classes at runtime.",
  }),
];

// --- .NET ---

const dotnetTemplates: Array<ServiceAlertTemplate> = [
  buildMetricTemplate({
    id: "service-dotnet-threadpool-starvation",
    name: "Thread Pool Starvation",
    description:
      "Alert when work items queue behind a saturated thread pool. The classic sync-over-async death spiral, and it presents as latency everywhere at once.",
    category: ".NET Runtime",
    severity: "Critical",
    language: "dotnet",
    metricName: "dotnet.thread_pool.queue.length",
    metricAlias: "dotnet_threadpool_queue",
    aggregationType: MetricsAggregationType.Max,
    threshold: 50,
    thresholdLabel: "50 queued work items",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Work is queueing because no pool thread is free. Look for blocking calls on pool threads — .Result, .Wait(), or a synchronous I/O call inside an async path — rather than for slow work.",
  }),
  buildMetricTemplate({
    id: "service-dotnet-threadpool-growth",
    name: "Thread Pool Growth",
    description:
      "Alert when the runtime has injected far more pool threads than the machine has cores, which it only does when existing threads are blocked.",
    category: ".NET Runtime",
    severity: "Warning",
    language: "dotnet",
    metricName: "dotnet.thread_pool.thread.count",
    metricAlias: "dotnet_threadpool_threads",
    aggregationType: MetricsAggregationType.Max,
    threshold: 200,
    thresholdLabel: "200 threads",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "The thread pool has injected threads well past core count, which the runtime only does to work around blocked threads. Pairs with queue length — this one rises first.",
  }),
  buildMetricTemplate({
    id: "service-dotnet-gen2-heap-growth",
    name: "Gen 2 Heap Growth",
    description:
      "Alert when the gen 2 heap after the last collection stays above 1 GB. Objects that survive into gen 2 and stay there are the .NET leak signature.",
    category: ".NET Runtime",
    severity: "Warning",
    language: "dotnet",
    metricName: "dotnet.gc.last_collection.heap.size",
    metricAlias: "dotnet_gen2_heap",
    aggregationType: MetricsAggregationType.Avg,
    attributes: { "dotnet.gc.heap.generation": "gen2" },
    threshold: 1073741824,
    thresholdLabel: "1 GB",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "The gen 2 heap keeps growing across collections. Take two dumps an hour apart and diff the object graph — a static collection or an event handler that is never unsubscribed is the usual cause.",
  }),
  buildMetricTemplate({
    id: "service-dotnet-working-set",
    name: "Working Set High",
    description:
      "Alert when the process working set stays above 1.5 GB. An absolute budget — retune it to your container limit.",
    category: ".NET Runtime",
    severity: "Warning",
    language: "dotnet",
    metricName: "dotnet.process.memory.working_set",
    metricAlias: "dotnet_working_set",
    aggregationType: MetricsAggregationType.Avg,
    threshold: 1610612736,
    thresholdLabel: "1.5 GB",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "The working set has stayed above its budget. If gen 2 heap is flat, the growth is unmanaged — native handles, pinned buffers, or a native library holding memory.",
  }),
];

// --- Node.js ---

const nodejsTemplates: Array<ServiceAlertTemplate> = [
  buildMetricTemplate({
    id: "service-nodejs-event-loop-saturated",
    name: "Event Loop Saturated",
    description:
      "Alert when the event loop is busy more than 90% of wall time. The single best saturation signal Node has: past this point every new request just queues.",
    category: "Node.js Runtime",
    severity: "Critical",
    language: "nodejs",
    metricName: "nodejs.eventloop.utilization",
    metricAlias: "nodejs_eventloop_utilization",
    aggregationType: MetricsAggregationType.Avg,
    threshold: 0.9,
    thresholdLabel: "90%",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "The event loop has almost no idle time left. One process cannot serve more than this — find the synchronous work blocking the loop (JSON of a huge payload, crypto, a tight loop) or add instances.",
  }),
  buildMetricTemplate({
    id: "service-nodejs-event-loop-lag",
    name: "Event Loop Lag",
    description:
      "Alert when 99th-percentile event-loop scheduling lag stays at or above 200 ms, meaning callbacks and timers are being starved.",
    category: "Node.js Runtime",
    severity: "Warning",
    language: "nodejs",
    metricName: "nodejs.eventloop.delay.p99",
    metricAlias: "nodejs_eventloop_delay",
    aggregationType: MetricsAggregationType.Avg,
    legendUnit: "ms",
    threshold: 200,
    thresholdLabel: "200 ms",
    incidentDescription:
      "Callbacks are waiting 200 ms or more just to be scheduled. Every response pays that on top of its real work — look for a synchronous block on the main thread.",
  }),
  /*
   * Deliberately unfiltered by heap space, on both sides.
   *
   * `v8js.memory.heap.used` is reported per heap space (the service overview's
   * own chart labels it "avg across V8 heap spaces"), so the obvious version
   * of this template filters both queries to `old_space` — that is the space
   * that actually kills a Node process. Summing every space instead is correct
   * whichever way the SDK reports it: if the series are split, the sums are
   * total used over total limit; if they are not, the values pass through
   * unchanged. Filtering on an attribute the SDK turns out not to emit
   * produces no data, and a metric monitor with no data never fires — a
   * silent, permanently-green monitor is a worse outcome than a slightly
   * blunter one.
   */
  buildRatioTemplate({
    id: "service-nodejs-heap-pressure",
    name: "V8 Heap Pressure",
    description:
      "Alert when the V8 heap stays at or above 90% of its hard limit — the last warning before a fatal, unrecoverable out-of-memory crash.",
    category: "Node.js Runtime",
    severity: "Critical",
    language: "nodejs",
    numeratorMetricName: "v8js.memory.heap.used",
    denominatorMetricName: "v8js.memory.heap.limit",
    numeratorAlias: "v8_heap_used",
    denominatorAlias: "v8_heap_limit",
    resultAlias: "v8_heap_percent",
    thresholdPercent: 90,
    incidentDescription:
      "The V8 heap is nearly full. Node does not degrade here — it aborts the process. Capture a heap snapshot now, and raise --max-old-space-size only as a stopgap.",
  }),
  /*
   * Unfiltered by GC type for the same reason as the template above: a p99
   * across every collection is dominated by the major ones anyway, and it
   * cannot be silenced by an attribute the SDK does not emit.
   */
  buildMetricTemplate({
    id: "service-nodejs-gc-pause-p99",
    name: "Long GC Pauses",
    description:
      "Alert when the 99th-percentile garbage collection pause stays at or above 200 ms. On a single-threaded event loop, a GC pause blocks everything.",
    category: "Node.js Runtime",
    severity: "Warning",
    language: "nodejs",
    metricName: "v8js.gc.duration",
    metricAlias: "v8_gc_pause_p99",
    aggregationType: MetricsAggregationType.P99,
    legendUnit: "ms",
    threshold: 200,
    thresholdLabel: "200 ms",
    incidentDescription:
      "Collections are pausing the loop for 200 ms or more at the tail. Usually the tail end of heap pressure — check heap utilization before tuning the collector.",
  }),
];

// --- Python ---

const pythonTemplates: Array<ServiceAlertTemplate> = [
  /*
   * The only genuinely default-on Python metric here: the ASGI and WSGI
   * instrumentations emit it, so FastAPI, Django and Flask services get it
   * without any extra package. The other two need
   * `opentelemetry-instrumentation-system-metrics`.
   */
  buildMetricTemplate({
    id: "service-python-request-concurrency",
    name: "Request Concurrency Saturated",
    description:
      "Alert when in-flight requests reach the worker budget, meaning new requests are queueing. Retune the threshold to your workers × threads.",
    category: "Python Runtime",
    severity: "Critical",
    language: "python",
    metricName: "http.server.active_requests",
    metricAlias: "python_active_requests",
    aggregationType: MetricsAggregationType.Max,
    threshold: 40,
    thresholdLabel: "40 in-flight requests",
    incidentDescription:
      "Every worker is busy and requests are queueing behind them. With a GIL, adding threads rarely helps — look at what the workers are blocked on, and at process count.",
  }),
  buildMetricTemplate({
    id: "service-python-rss-memory",
    name: "Resident Memory High",
    description:
      "Alert when a worker's resident memory stays above 1 GB — the signal that precedes an OOM kill. Needs the system-metrics instrumentation enabled. Reads process.runtime.cpython.memory with type=rss; newer opentelemetry-python releases report this as process.memory.usage, which the language-agnostic Process Memory High template already covers.",
    category: "Python Runtime",
    severity: "Warning",
    language: "python",
    metricName: "process.runtime.cpython.memory",
    metricAlias: "python_rss",
    aggregationType: MetricsAggregationType.Avg,
    attributes: { type: "rss" },
    threshold: 1073741824,
    thresholdLabel: "1 GB",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "A worker's resident memory has stayed above its budget. Python rarely returns memory to the OS, so a plateau after a spike is normal and a steady climb is not — look for an unbounded cache or a growing module-level structure.",
  }),
  buildMetricTemplate({
    id: "service-python-thread-growth",
    name: "Thread Count Growth",
    description:
      "Alert when thread count stays above 200, which usually means a leaked executor or an unclosed client pool. Needs the system-metrics instrumentation enabled. Reads process.runtime.cpython.thread_count; newer opentelemetry-python releases report this as process.thread.count — retarget the created monitor in one edit if your SDK emits that instead.",
    category: "Python Runtime",
    severity: "Warning",
    language: "python",
    metricName: "process.runtime.cpython.thread_count",
    metricAlias: "python_threads",
    aggregationType: MetricsAggregationType.Max,
    threshold: 200,
    thresholdLabel: "200 threads",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Thread count has stayed above 200. Under a GIL these mostly wait rather than work, so a climbing count is a leak — look for ThreadPoolExecutors created per request and clients never closed.",
  }),
];

// --- Go ---

const goTemplates: Array<ServiceAlertTemplate> = [
  buildMetricTemplate({
    id: "service-go-goroutine-leak",
    name: "Goroutine Leak",
    description:
      "Alert when live goroutines stay above 10,000 — leaked contexts, unbounded fan-out, or sends on a channel nobody reads. Reads go.goroutine.count; older builds report process.runtime.go.goroutines.",
    category: "Go Runtime",
    severity: "Warning",
    language: "go",
    metricName: "go.goroutine.count",
    metricAlias: "go_goroutines",
    aggregationType: MetricsAggregationType.Max,
    threshold: 10000,
    thresholdLabel: "10,000 goroutines",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Goroutine count has stayed above 10,000. A count that only climbs is a leak: take a goroutine profile and look at the top stack — it is almost always a channel send or receive with no timeout and no cancelled context.",
  }),
  buildMetricTemplate({
    id: "service-go-heap-memory",
    name: "Runtime Memory High",
    description:
      "Alert when non-stack runtime memory stays above 1 GB. An absolute budget — retune it to your container limit.",
    category: "Go Runtime",
    severity: "Warning",
    language: "go",
    metricName: "go.memory.used",
    metricAlias: "go_heap_memory",
    aggregationType: MetricsAggregationType.Avg,
    /*
     * The filter is load-bearing, not a refinement: `go.memory.used` splits
     * into `stack` and `other` series, so an unfiltered average of the two
     * reports roughly half the heap and the threshold would be wrong by that
     * factor. "other" is the heap-dominated half.
     */
    attributes: { "go.memory.type": "other" },
    threshold: 1073741824,
    thresholdLabel: "1 GB",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Heap memory has stayed above its budget. Take a heap profile and compare allocation sites — in Go this is usually a slice or map that is appended to and never bounded.",
  }),
  buildMetricTemplate({
    id: "service-go-stack-memory",
    name: "Goroutine Stack Memory",
    description:
      "Alert when total goroutine stack memory stays above 256 MB. An independent read on the same leak goroutine count catches, and it often moves first.",
    category: "Go Runtime",
    severity: "Warning",
    language: "go",
    metricName: "go.memory.used",
    metricAlias: "go_stack_memory",
    aggregationType: MetricsAggregationType.Avg,
    attributes: { "go.memory.type": "stack" },
    threshold: 268435456,
    thresholdLabel: "256 MB",
    unhealthyFilterType: FilterType.GreaterThan,
    healthyFilterType: FilterType.LessThanOrEqualTo,
    incidentDescription:
      "Stack memory has grown past its budget. Either there are far too many goroutines, or some of them recurse deeply — the goroutine profile answers which.",
  }),
  buildMetricTemplate({
    id: "service-go-scheduler-latency-p99",
    name: "Scheduler Latency",
    description:
      "Alert when the 99th-percentile time a runnable goroutine waits to be scheduled stays at or above 50 ms — P contention or a GOMAXPROCS set below the real CPU budget.",
    category: "Go Runtime",
    severity: "Warning",
    language: "go",
    metricName: "go.schedule.duration",
    metricAlias: "go_schedule_p99",
    aggregationType: MetricsAggregationType.P99,
    legendUnit: "ms",
    threshold: 50,
    thresholdLabel: "50 ms",
    incidentDescription:
      "Runnable goroutines are waiting 50 ms or more for a processor. Check GOMAXPROCS against the container's real CPU limit, and look for CPU-bound work starving the scheduler.",
  }),
];

/*
 * Declaration order is the display order — the recommendations page renders
 * category sections in the order the templates first mention them, so the
 * agnostic RED signals come first and the runtime section lands underneath.
 */
const ALL_SERVICE_ALERT_TEMPLATES: Array<ServiceAlertTemplate> = [
  failedOperationsTemplate,
  errorBurstTemplate,
  unhandledExceptionsTemplate,
  latencyP95Template,
  latencyP99Template,
  trafficStoppedTemplate,
  processCpuTemplate,
  processMemoryTemplate,
  ...javaTemplates,
  ...dotnetTemplates,
  ...nodejsTemplates,
  ...pythonTemplates,
  ...goTemplates,
];

export function getAllServiceAlertTemplates(): Array<ServiceAlertTemplate> {
  return [...ALL_SERVICE_ALERT_TEMPLATES];
}

/*
 * The templates to offer ONE service, given its detected runtime.
 *
 * Always the agnostic set, plus the runtime's own set when there is one. The
 * two rules that matter:
 *
 *   - An unknown language (null/undefined) yields the agnostic set, never an
 *     empty list and never a guess. A service whose SDK has not reported
 *     `telemetry.sdk.language` yet still has spans and exceptions, so the RED
 *     recommendations are all valid for it.
 *
 *   - A known language with no templates of its own — Ruby, PHP, Rust, and the
 *     rest — also yields exactly the agnostic set. That is a deliberate
 *     omission rather than a gap to be filled later with plausible-looking
 *     entries: those ecosystems have no default OpenTelemetry runtime-metrics
 *     instrumentation, so any runtime template written for them would query a
 *     metric name nobody emits. A shorter honest list beats a longer list of
 *     monitors that can never fire.
 */
export function getServiceAlertTemplates(
  language?: ServiceLanguage | null | undefined,
): Array<ServiceAlertTemplate> {
  return ALL_SERVICE_ALERT_TEMPLATES.filter(
    (template: ServiceAlertTemplate) => {
      if (!template.language) {
        return true;
      }

      return Boolean(language) && template.language === language;
    },
  );
}

export function getServiceAlertTemplateById(
  id: string,
): ServiceAlertTemplate | undefined {
  return ALL_SERVICE_ALERT_TEMPLATES.find((template: ServiceAlertTemplate) => {
    return template.id === id;
  });
}

/*
 * The languages this module ships runtime templates for.
 *
 * Derived from the templates rather than hand-listed, so it cannot drift: a
 * new runtime template makes its language appear here automatically, and the
 * tests assert the two agree.
 */
export function getLanguagesWithServiceAlertTemplates(): Array<ServiceLanguage> {
  const languages: Array<ServiceLanguage> = [];

  for (const template of ALL_SERVICE_ALERT_TEMPLATES) {
    if (template.language && !languages.includes(template.language)) {
      languages.push(template.language);
    }
  }

  return languages;
}
