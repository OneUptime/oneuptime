import Route from "Common/Types/API/Route";
import AIInsightEvidence, {
  ExceptionInsightEvidence,
  LogSpikeInsightEvidence,
  MetricDriftInsightEvidence,
} from "Common/Types/AI/AIInsightEvidence";
import AIInsightSeverity from "Common/Types/AI/AIInsightSeverity";
import AIInsightType from "Common/Types/AI/AIInsightType";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import LogSeverity from "Common/Types/Log/LogSeverity";
import {
  CheckOn,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import { MonitorStepExceptionMonitorUtil } from "Common/Types/Monitor/MonitorStepExceptionMonitor";
import { MonitorStepLogMonitorUtil } from "Common/Types/Monitor/MonitorStepLogMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorRecommendationSeverityMapper from "Common/Types/Monitor/Recommendation/MonitorRecommendationSeverityMapper";
import { MonitorRecommendationSeverity } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "Common/Types/ObjectID";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import {
  AggregationTemporality,
  MetricPointType,
} from "Common/Models/AnalyticsModels/Metric";
import {
  translateTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";

/*
 * "Create Monitor" from an AI insight.
 *
 * Insights are a quiet inbox: they never page and never open incidents, and
 * that stays true. What a team that wants to be paged the NEXT time a finding
 * happens needs is a monitor — the thing that already owns thresholds,
 * evaluation windows, severities, on-call policies, incident creation and
 * auto-resolution. So the insight hands Monitor Create a deep link
 * (?aiInsightId=) and Monitor Create opens on the monitor this module builds:
 * the right monitor type, scoped to what the insight is about, with a
 * criteria that opens an incident on the SAME condition the detector used,
 * frozen into a number the person can read and change before saving.
 *
 *   ErrorLogSpike  -> Logs monitor: Error/Fatal lines in the past hour, the
 *                     service when the spike was attributed to one.
 *   ExceptionSpike -> Exceptions monitor: the exception's type (and the stable
 *                     part of its message) in its service, past hour.
 *   NewException   -> Exceptions monitor: the same scope, past 24 hours — the
 *                     detector's own novelty window.
 *   MetricDrift    -> Metrics monitor: the metric's hourly average on the
 *                     entity it drifted on, against the drift bar measured
 *                     from the prior week's mean.
 *   TraceLatencyRegression -> not offered. The regression is a p99 over the
 *                     service's SPANS, and no monitor type evaluates span
 *                     latency: a trace monitor only counts spans, and a metric
 *                     monitor on some duration metric would watch a different
 *                     number (or one the service never reports) while looking
 *                     configured.
 *
 * Pure (no network, no React) for the same reason as AIInsightExplorerLinks
 * and SecurityEventsMonitorPrefill: what it builds is a contract with the step
 * forms, MonitorSteps.fromJSON, the criteria validation and the telemetry
 * evaluator, and only a pure function can be pinned by tests against all of
 * them. The network half (the insight, the project's statuses and severities,
 * the metric's shape) lives in AIInsightMonitorData.
 *
 * NO RAW TELEMETRY IN PROSE. An exception message — and so an exception
 * insight's title — is shaped by whoever can make an instrumented service
 * throw, and incident descriptions render as markdown. So the message only
 * ever reaches the exception monitor's message FILTER (a text input), never a
 * monitor name, monitor description, criteria text or incident text. Names
 * and descriptions are built from the service name, the metric name, the
 * exception type and numbers.
 */

// The Monitor Create query parameter that carries the insight's id.
export const AI_INSIGHT_MONITOR_QUERY_PARAM: string = "aiInsightId";

/*
 * Detector constants, mirrored because Common/Server is server-only. The
 * Common suite pins every one of them to the detector it copies
 * (AIInsightMonitorPrefillDetectorParity.test.ts): a detector retuned
 * without this file would otherwise seed monitors on the old rule.
 */

// ErrorLogSpikeDetector: ERROR_LOG_SPIKE_MIN_RECENT_COUNT / _MIN_MULTIPLIER.
export const ERROR_LOG_SPIKE_MIN_COUNT: number = 100;
export const ERROR_LOG_SPIKE_MULTIPLIER: number = 3;
// ErrorLogSpikeDetector.ERROR_LOG_SEVERITIES.
export const ERROR_LOG_SPIKE_LOG_SEVERITIES: Array<LogSeverity> = [
  LogSeverity.Error,
  LogSeverity.Fatal,
];

// ExceptionSpikeDetector: EXCEPTION_SPIKE_MIN_RECENT_COUNT / _MIN_MULTIPLIER.
export const EXCEPTION_SPIKE_MIN_COUNT: number = 10;
export const EXCEPTION_SPIKE_MULTIPLIER: number = 5;

// NewExceptionDetector: NEW_EXCEPTION_MIN_OCCURRENCE_COUNT.
export const NEW_EXCEPTION_MIN_COUNT: number = 3;

// MetricDriftDetector.METRIC_DRIFT_MIN_RELATIVE_CHANGE.
export const METRIC_DRIFT_RELATIVE_CHANGE: number = 0.5;

/*
 * Evaluation windows, in seconds for the count monitors. The spike detectors
 * compare one recent HOUR against an hourly baseline, so their monitors count
 * one hour; NewExceptionDetector qualifies a failure mode on its first 24
 * hours. Each is one of the step forms' fixed window options — a prefilled
 * value outside them renders as an empty dropdown and is dropped on the
 * first edit (pinned against the form sources in the App suite).
 */
export const SPIKE_MONITOR_WINDOW_SECONDS: number = 3600;
export const NEW_EXCEPTION_MONITOR_WINDOW_SECONDS: number = 86400;

/*
 * The metric drift detector compares means, so the monitor compares a mean:
 * one hour of the metric, averaged. An hour rides out the minute-to-minute
 * noise a week-over-week shift is not about.
 */
export const METRIC_DRIFT_MONITOR_ROLLING_TIME: RollingTime =
  RollingTime.Past1Hour;

// The one query's variable — what the criteria filter names.
export const METRIC_DRIFT_MONITOR_METRIC_ALIAS: string = "a";

// Monitor.name is a ShortText column.
export const MAX_MONITOR_NAME_LENGTH: number = 100;

/*
 * Bounds on the exception message fragment. Shorter than the minimum it is
 * too generic to be worth a filter (the type and service already scope the
 * monitor); longer than the maximum it stops being readable in the form.
 */
export const MIN_EXCEPTION_MESSAGE_FRAGMENT_LENGTH: number = 8;
export const MAX_EXCEPTION_MESSAGE_FRAGMENT_LENGTH: number = 200;

/*
 * Why an insight cannot become a monitor. Shown as the disabled Create
 * Monitor button's tooltip, and in place of the form if a link reaches
 * Monitor Create anyway.
 */
export const AI_INSIGHT_MONITOR_LATENCY_BLOCKER: string = translationKey(
  "Latency regressions are measured on trace spans, and monitors cannot alert on span latency yet. To alert on latency, create a Metrics monitor on your service's request duration metric.",
);
export const AI_INSIGHT_MONITOR_UNKNOWN_TYPE_BLOCKER: string = translationKey(
  "Monitors cannot be created from this kind of insight yet.",
);
export const AI_INSIGHT_MONITOR_EXCEPTION_SCOPE_BLOCKER: string =
  translationKey(
    "This insight does not record which exception it is about, so a monitor could not be scoped to it.",
  );
export const AI_INSIGHT_MONITOR_METRIC_NAME_BLOCKER: string = translationKey(
  "This insight does not record which metric drifted.",
);
export const AI_INSIGHT_MONITOR_METRIC_BASELINE_BLOCKER: string =
  translationKey(
    "This insight does not record the metric's baseline, so there is no threshold to start a monitor from.",
  );
export const AI_INSIGHT_MONITOR_CUMULATIVE_COUNTER_BLOCKER: string =
  translationKey(
    "This metric is a cumulative counter. A monitor compares against its running total, which only grows, so it would fire once and never clear.",
  );
export const AI_INSIGHT_MONITOR_HISTOGRAM_BLOCKER: string = translationKey(
  "This metric is a histogram. The drift was measured on its raw point sums, which a monitor does not read, so a threshold from this insight would not mean the same thing.",
);

/**
 * The insight fields the builder reads. All optional and string-tolerant:
 * rows arrive as JSON, the evidence column is free-form, and a builder that
 * runs on a page must degrade rather than throw.
 */
export interface AIInsightMonitorInput {
  insightType?: string | undefined;
  severity?: string | undefined;
  serviceName?: string | undefined;
  // The insight's telemetryServiceId, as a string.
  telemetryServiceId?: string | undefined;
  metricName?: string | undefined;
  evidence?: AIInsightEvidence | undefined;
}

/*
 * What a metric IS, read from its newest point. Null fields are unknown, and
 * an unknown is never held against the metric.
 */
export interface AIInsightMetricShape {
  pointType: MetricPointType | null;
  isMonotonic: boolean | null;
  aggregationTemporality: AggregationTemporality | null;
}

export interface AIInsightMonitorContext {
  // MetricDrift only. Undefined or null when it was not (or could not be) read.
  metricShape?: AIInsightMetricShape | null | undefined;
}

/*
 * The project's ids the criteria are built with. Statuses may be null and
 * severity lists empty — a project missing them gets a monitor whose
 * criteria leave that part off rather than one that cannot be saved.
 */
export interface AIInsightMonitorSeedIds {
  operationalMonitorStatusId: ObjectID | null;
  offlineMonitorStatusId: ObjectID | null;
  // Most severe first (the API sorts by `order`).
  rankedIncidentSeverityIds: Array<ObjectID>;
  rankedAlertSeverityIds: Array<ObjectID>;
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asObject<T>(value: unknown): T | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as T)
    : null;
}

function getExceptionEvidence(
  input: AIInsightMonitorInput,
): ExceptionInsightEvidence | null {
  return asObject<ExceptionInsightEvidence>(
    asObject<AIInsightEvidence>(input.evidence)?.exception,
  );
}

function getLogSpikeEvidence(
  input: AIInsightMonitorInput,
): LogSpikeInsightEvidence | null {
  return asObject<LogSpikeInsightEvidence>(
    asObject<AIInsightEvidence>(input.evidence)?.logSpike,
  );
}

function getMetricDriftEvidence(
  input: AIInsightMonitorInput,
): MetricDriftInsightEvidence | null {
  return asObject<MetricDriftInsightEvidence>(
    asObject<AIInsightEvidence>(input.evidence)?.metricDrift,
  );
}

// The service the insight is about, when its ObjectID is known.
function getServiceId(input: AIInsightMonitorInput): ObjectID | null {
  const serviceId: string | null = trimmedOrNull(input.telemetryServiceId);

  return serviceId && ObjectID.isValidUUID(serviceId)
    ? new ObjectID(serviceId)
    : null;
}

/*
 * The tokens ExceptionSanitizer leaves in a message: the fingerprint
 * normalizer's placeholders (<UUID>, <HEX_ID>, <NUMBER>, ...) and the secret
 * redactor's markers ([redacted-email], [redacted], ...). Line breaks split
 * too, so a fragment is always one line of the form's single-line input.
 */
const SANITIZER_TOKEN_REGEX: RegExp =
  /<[A-Z][A-Z0-9_]*>|\[redacted(?:-[a-z]+)*\]|[\r\n]+/;

/*
 * Text some normalizer rules write in front of their placeholder that need
 * not be in the original message: "sessionId: 'x'" comes out as
 * "session_id=<SESSION>", "pid 42" as "PID:<PID>", "ID: 7" as "id=<ID>",
 * "bearer xyz" as "Bearer [redacted-token]".
 */
const SYNTHETIC_TEXT_BEFORE_TOKEN_REGEX: RegExp =
  /(?:session_id=|request_id=|correlation_id=|transaction_id=|PID:|TID:|id=|Bearer\s*)$/i;

// Punctuation and space that read as noise at the edges of a fragment.
const FRAGMENT_EDGE_REGEX: RegExp =
  /^[\s()[\]{}<>:;,.='"`|-]+|[\s()[\]{}<>:;,='"`|-]+$/g;

/**
 * The longest run of a SANITIZED exception message that is guaranteed to
 * appear in the raw messages it was sanitized from — "" when there is no run
 * worth filtering on.
 *
 * The insight stores the message only after ExceptionSanitizer replaced its
 * dynamic values (ids, numbers, emails, timestamps...) with placeholders, and
 * the exception monitor matches its message filter as a case-insensitive
 * substring of the RAW message (ILIKE '%...%'). A filter holding a
 * placeholder would match nothing, forever, while looking configured. So the
 * message is cut at every placeholder and redaction marker, the text a
 * normalizer rule invents next to its placeholder is cut off too, and the
 * longest remaining run wins. Every cut only shortens a run, and a piece of a
 * substring is still a substring — so whatever comes back matches every
 * message of the failure mode.
 */
export function getStableExceptionMessageFragment(
  sanitizedMessage: string | undefined,
): string {
  if (typeof sanitizedMessage !== "string" || !sanitizedMessage) {
    return "";
  }

  const runs: Array<string> = sanitizedMessage.split(SANITIZER_TOKEN_REGEX);

  let best: string = "";

  runs.forEach((run: string, index: number) => {
    let candidate: string = run;

    if (index < runs.length - 1) {
      candidate = candidate.replace(SYNTHETIC_TEXT_BEFORE_TOKEN_REGEX, "");
    }

    candidate = candidate.replace(FRAGMENT_EDGE_REGEX, "");

    if (candidate.length > best.length) {
      best = candidate;
    }
  });

  if (best.length > MAX_EXCEPTION_MESSAGE_FRAGMENT_LENGTH) {
    best = best
      .substring(0, MAX_EXCEPTION_MESSAGE_FRAGMENT_LENGTH)
      .replace(FRAGMENT_EDGE_REGEX, "");
  }

  return best.length >= MIN_EXCEPTION_MESSAGE_FRAGMENT_LENGTH ? best : "";
}

/*
 * A counter the store keeps as a running total: thresholding its raw value
 * compares against "everything since the process started", which only grows.
 * The same rule the metric query editor's rate hint uses (MetricQuery.tsx).
 */
function isCumulativeCounter(shape: AIInsightMetricShape): boolean {
  return (
    shape.isMonotonic === true &&
    shape.aggregationTemporality === AggregationTemporality.Cumulative
  );
}

function isDistribution(shape: AIInsightMetricShape): boolean {
  return (
    shape.pointType === MetricPointType.Histogram ||
    shape.pointType === MetricPointType.ExponentialHistogram ||
    shape.pointType === MetricPointType.Summary
  );
}

interface MetricDriftDirection {
  priorWeekMean: number;
  // +1 when the mean went up, -1 when it went down.
  direction: 1 | -1;
}

/*
 * The drift's baseline and direction: the sign of the stored relative change,
 * else of recent - prior. Null when there is no usable prior mean — relative
 * change against zero is undefined, which is also why the detector never
 * files one.
 */
function getMetricDriftDirection(
  evidence: MetricDriftInsightEvidence | null,
): MetricDriftDirection | null {
  const priorWeekMean: number | null = finiteNumberOrNull(
    evidence?.priorWeekMean,
  );

  if (priorWeekMean === null || priorWeekMean === 0) {
    return null;
  }

  const relativeChangePercent: number | null = finiteNumberOrNull(
    evidence?.relativeChangePercent,
  );

  if (relativeChangePercent !== null && relativeChangePercent !== 0) {
    return {
      priorWeekMean: priorWeekMean,
      direction: relativeChangePercent > 0 ? 1 : -1,
    };
  }

  const recentWeekMean: number | null = finiteNumberOrNull(
    evidence?.recentWeekMean,
  );

  if (recentWeekMean === null || recentWeekMean === priorWeekMean) {
    return null;
  }

  return {
    priorWeekMean: priorWeekMean,
    direction: recentWeekMean > priorWeekMean ? 1 : -1,
  };
}

/**
 * Why this insight cannot become a monitor, or null when it can. The metric
 * shape is optional: without it a MetricDrift insight is judged on its own
 * fields alone.
 */
export function getAIInsightMonitorBlocker(
  input: AIInsightMonitorInput,
  context?: AIInsightMonitorContext | undefined,
): string | null {
  switch (input.insightType) {
    case AIInsightType.ErrorLogSpike:
      // Always buildable: with no service it is the detector's own scope.
      return null;

    case AIInsightType.NewException:
    case AIInsightType.ExceptionSpike: {
      const evidence: ExceptionInsightEvidence | null =
        getExceptionEvidence(input);

      if (
        !trimmedOrNull(evidence?.exceptionType) &&
        !getStableExceptionMessageFragment(evidence?.exceptionMessage)
      ) {
        return AI_INSIGHT_MONITOR_EXCEPTION_SCOPE_BLOCKER;
      }

      return null;
    }

    case AIInsightType.MetricDrift: {
      const evidence: MetricDriftInsightEvidence | null =
        getMetricDriftEvidence(input);

      if (
        !trimmedOrNull(input.metricName) &&
        !trimmedOrNull(evidence?.metricName)
      ) {
        return AI_INSIGHT_MONITOR_METRIC_NAME_BLOCKER;
      }

      if (!getMetricDriftDirection(evidence)) {
        return AI_INSIGHT_MONITOR_METRIC_BASELINE_BLOCKER;
      }

      const shape: AIInsightMetricShape | null | undefined =
        context?.metricShape;

      if (shape && isCumulativeCounter(shape)) {
        return AI_INSIGHT_MONITOR_CUMULATIVE_COUNTER_BLOCKER;
      }

      if (shape && isDistribution(shape)) {
        return AI_INSIGHT_MONITOR_HISTOGRAM_BLOCKER;
      }

      return null;
    }

    case AIInsightType.TraceLatencyRegression:
      return AI_INSIGHT_MONITOR_LATENCY_BLOCKER;

    default:
      return AI_INSIGHT_MONITOR_UNKNOWN_TYPE_BLOCKER;
  }
}

/*
 * The insight's severity as the two-level scale MonitorRecommendationSeverity
 * Mapper ranks the project's own severities on: a High insight opens the most
 * severe incident, anything else the next one down. Order-based, never
 * name-based — severities are renameable.
 */
export function getAIInsightMonitorSeverityLevel(
  severity: string | undefined,
): MonitorRecommendationSeverity {
  return severity === AIInsightSeverity.High ? "Critical" : "Warning";
}

function resolveSeverityId(data: {
  level: MonitorRecommendationSeverity;
  rankedIds: Array<ObjectID>;
}): ObjectID | null {
  return (
    MonitorRecommendationSeverityMapper.getMappingFromRankedIds(data.rankedIds)[
      data.level
    ] || null
  );
}

/*
 * Rounded for a person to read and edit — four significant digits — without
 * turning a small-valued metric's threshold into zero.
 */
export function roundMetricThreshold(value: number): number {
  if (!Number.isFinite(value) || value === 0) {
    return 0;
  }

  return Number(value.toPrecision(4));
}

function formatCount(value: number): string {
  return String(Math.round(value));
}

function clampMonitorName(name: string): string {
  const characters: Array<string> = Array.from(name.trim());

  return characters.length > MAX_MONITOR_NAME_LENGTH
    ? characters.slice(0, MAX_MONITOR_NAME_LENGTH).join("").trim()
    : name.trim();
}

/*
 * The threshold the ErrorLogSpike detector applied, frozen as a count: the
 * project's hourly baseline times the spike multiplier, never below the
 * absolute floor. For a monitor scoped to one service it is lowered to what
 * that service logged during THIS spike when that is less — the project-wide
 * bar is measured on every service together, and a service-scoped monitor
 * that would not have fired on the very spike it was made from would be
 * watching nothing in particular.
 */
export interface ErrorLogSpikeThreshold {
  threshold: number;
  projectBar: number;
  isCappedAtServiceSpike: boolean;
}

export function getErrorLogSpikeThreshold(data: {
  evidence: LogSpikeInsightEvidence | null;
  serviceName: string | null;
  isServiceScoped: boolean;
}): ErrorLogSpikeThreshold {
  const baselineHourlyAverage: number =
    finiteNumberOrNull(data.evidence?.baselineHourlyAverage) ?? 0;

  const projectBar: number = Math.max(
    ERROR_LOG_SPIKE_MIN_COUNT,
    Math.ceil(ERROR_LOG_SPIKE_MULTIPLIER * Math.max(baselineHourlyAverage, 1)),
  );

  if (!data.isServiceScoped || !data.serviceName) {
    return {
      threshold: projectBar,
      projectBar: projectBar,
      isCappedAtServiceSpike: false,
    };
  }

  const topServices: Array<unknown> = Array.isArray(data.evidence?.topServices)
    ? (data.evidence?.topServices as Array<unknown>)
    : [];

  let serviceSpikeCount: number | null = null;

  for (const topService of topServices) {
    const entry: { serviceName?: unknown; count?: unknown } | null = asObject<{
      serviceName?: unknown;
      count?: unknown;
    }>(topService);

    if (entry && entry.serviceName === data.serviceName) {
      serviceSpikeCount = finiteNumberOrNull(entry.count);
      break;
    }
  }

  if (serviceSpikeCount === null || serviceSpikeCount >= projectBar) {
    return {
      threshold: projectBar,
      projectBar: projectBar,
      isCappedAtServiceSpike: false,
    };
  }

  const capped: number = Math.max(
    ERROR_LOG_SPIKE_MIN_COUNT,
    Math.floor(serviceSpikeCount),
  );

  return {
    threshold: capped,
    projectBar: projectBar,
    isCappedAtServiceSpike: capped < projectBar,
  };
}

// The ExceptionSpike detector's bar, frozen as a count of one hour.
export function getExceptionSpikeThreshold(
  evidence: ExceptionInsightEvidence | null,
): number {
  const baselineHourlyAverage: number =
    finiteNumberOrNull(evidence?.baselineHourlyAverage) ?? 0;

  return Math.max(
    EXCEPTION_SPIKE_MIN_COUNT,
    Math.ceil(EXCEPTION_SPIKE_MULTIPLIER * Math.max(baselineHourlyAverage, 1)),
  );
}

/*
 * The MetricDrift detector's bar on the prior week's mean: 50% above it for a
 * metric that drifted up, 50% below for one that drifted down. Relative to
 * |prior| as the detector computes it, so a negative-valued metric moves the
 * right way.
 */
export function getMetricDriftThreshold(
  direction: MetricDriftDirection,
): number {
  return roundMetricThreshold(
    direction.priorWeekMean +
      direction.direction *
        METRIC_DRIFT_RELATIVE_CHANGE *
        Math.abs(direction.priorWeekMean),
  );
}

interface CriteriaPairData {
  seeds: AIInsightMonitorSeedIds;
  severityLevel: MonitorRecommendationSeverity;
  checkOn: CheckOn;
  unhealthyFilterType: FilterType;
  healthyFilterType: FilterType;
  threshold: number;
  metricAlias?: string | undefined;
  unhealthyName: string;
  unhealthyDescription: string;
  healthyDescription: string;
  incidentTitle: string;
  incidentDescription: string;
}

/*
 * The unhealthy/healthy pair, the same shape the curated templates ship
 * (ServiceAlertTemplates.buildCriteriaPair): the unhealthy criteria opens an
 * incident that resolves itself, and the mirrored healthy criteria brings the
 * monitor back — without it the monitor would sit in its offline status
 * forever once the incident auto-resolved.
 *
 * The alert is filled in but switched off, like every default offline
 * criteria: the issue asked for incidents, and a team that would rather get
 * an alert flips one switch and finds it ready.
 *
 * Anything the project lacks is left off rather than left invalid: no status
 * means the criteria does not change it, no incident severity means no
 * incident (MonitorCriteriaInstance.getValidationError refuses an incident
 * without one, with no field on screen to fix it from).
 */
function buildCriteriaPair(data: CriteriaPairData): MonitorCriteria {
  const metricMonitorOptions:
    | { metricAggregationType: EvaluateOverTimeType; metricAlias: string }
    | undefined = data.metricAlias
    ? {
        /*
         * One number per window: the window's mean, compared once. The drift
         * detector compares means, not individual samples.
         */
        metricAggregationType: EvaluateOverTimeType.Average,
        metricAlias: data.metricAlias,
      }
    : undefined;

  const incidentSeverityId: ObjectID | null = resolveSeverityId({
    level: data.severityLevel,
    rankedIds: data.seeds.rankedIncidentSeverityIds,
  });

  const alertSeverityId: ObjectID | null = resolveSeverityId({
    level: data.severityLevel,
    rankedIds: data.seeds.rankedAlertSeverityIds,
  });

  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.offlineMonitorStatusId || undefined,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.unhealthyFilterType,
        value: data.threshold,
        // A copy per filter — see ServiceAlertTemplates.buildCriteriaPair.
        metricMonitorOptions: metricMonitorOptions
          ? { ...metricMonitorOptions }
          : undefined,
      },
    ],
    incidents: incidentSeverityId
      ? [
          {
            id: ObjectID.generate().toString(),
            title: data.incidentTitle,
            description: data.incidentDescription,
            incidentSeverityId: incidentSeverityId,
            autoResolveIncident: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    alerts: alertSeverityId
      ? [
          {
            id: ObjectID.generate().toString(),
            title: data.incidentTitle,
            description: data.incidentDescription,
            alertSeverityId: alertSeverityId,
            autoResolveAlert: true,
            onCallPolicyIds: [],
          },
        ]
      : [],
    changeMonitorStatus: Boolean(data.seeds.offlineMonitorStatusId),
    createIncidents: Boolean(incidentSeverityId),
    createAlerts: false,
    isEnabled: true,
    name: data.unhealthyName,
    description: data.unhealthyDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.seeds.operationalMonitorStatusId || undefined,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: data.checkOn,
        filterType: data.healthyFilterType,
        value: data.threshold,
        metricMonitorOptions: metricMonitorOptions
          ? { ...metricMonitorOptions }
          : undefined,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: Boolean(data.seeds.operationalMonitorStatusId),
    createIncidents: false,
    createAlerts: false,
    isEnabled: true,
    name: translateTemplate("Healthy"),
    description: data.healthyDescription,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

/*
 * What a built monitor needs besides its criteria: the step's own sub-config
 * and the words around it.
 */
interface MonitorShape {
  monitorType: MonitorType;
  name: string;
  description: string;
  configureStep: (step: MonitorStep) => void;
  criteria: Omit<CriteriaPairData, "seeds" | "severityLevel">;
}

function buildErrorLogSpikeMonitor(input: AIInsightMonitorInput): MonitorShape {
  const evidence: LogSpikeInsightEvidence | null = getLogSpikeEvidence(input);
  const serviceId: ObjectID | null = getServiceId(input);
  const serviceName: string | null = trimmedOrNull(input.serviceName);

  /*
   * Scoped to the service only when its id is known. A spike attributed to
   * an entity that is not a Service stores no id, and its "name" is then the
   * raw entity id — a filter on that would match nothing. The project-wide
   * monitor is exactly the scope the detector itself measures.
   */
  const isServiceScoped: boolean = Boolean(serviceId && serviceName);

  const threshold: ErrorLogSpikeThreshold = getErrorLogSpikeThreshold({
    evidence: evidence,
    serviceName: serviceName,
    isServiceScoped: isServiceScoped,
  });

  const thresholdText: string = formatCount(threshold.threshold);

  const name: string = isServiceScoped
    ? translateTemplate("Error-log spike in {{serviceName}}", {
        serviceName: serviceName!,
      })
    : translateTemplate("Error-log spike across the project");

  const condition: string = isServiceScoped
    ? translateTemplate(
        "{{serviceName}} logged {{threshold}} or more Error or Fatal lines within an hour.",
        { serviceName: serviceName!, threshold: thresholdText },
      )
    : translateTemplate(
        "The project logged {{threshold}} or more Error or Fatal lines within an hour.",
        { threshold: thresholdText },
      );

  const thresholdReason: string = threshold.isCappedAtServiceSpike
    ? translateTemplate(
        "{{threshold}} is what {{serviceName}} logged during the spike this monitor was created from, below the project's spike bar of {{projectBar}}.",
        {
          threshold: thresholdText,
          serviceName: serviceName!,
          projectBar: formatCount(threshold.projectBar),
        },
      )
    : translateTemplate(
        "{{threshold}} is the bar the AI detector used: {{multiplier}} times the project's hourly baseline, and never below {{floor}}.",
        {
          threshold: thresholdText,
          multiplier: String(ERROR_LOG_SPIKE_MULTIPLIER),
          floor: formatCount(ERROR_LOG_SPIKE_MIN_COUNT),
        },
      );

  return {
    monitorType: MonitorType.Logs,
    name: name,
    description: [
      translateTemplate(
        "Created from an AI insight that found an error-log spike. Opens an incident when this happens again:",
      ),
      condition,
      thresholdReason,
    ].join(" "),
    configureStep: (step: MonitorStep): void => {
      step.setLogMonitor({
        ...MonitorStepLogMonitorUtil.getDefault(),
        severityTexts: [...ERROR_LOG_SPIKE_LOG_SEVERITIES],
        telemetryServiceIds: isServiceScoped && serviceId ? [serviceId] : [],
        lastXSecondsOfLogs: SPIKE_MONITOR_WINDOW_SECONDS,
      });
    },
    criteria: {
      checkOn: CheckOn.LogCount,
      unhealthyFilterType: FilterType.GreaterThanOrEqualTo,
      healthyFilterType: FilterType.LessThan,
      threshold: threshold.threshold,
      unhealthyName: translateTemplate(
        "{{threshold}} or more Error or Fatal logs in an hour",
        { threshold: thresholdText },
      ),
      unhealthyDescription: condition,
      healthyDescription: translateTemplate(
        "Fewer than {{threshold}} Error or Fatal logs in the past hour.",
        { threshold: thresholdText },
      ),
      incidentTitle: name,
      incidentDescription: [
        condition,
        translateTemplate(
          "Open the logs for the past hour to see which errors are new, then check what was deployed or changed recently.",
        ),
      ].join(" "),
    },
  };
}

function buildExceptionMonitor(input: AIInsightMonitorInput): MonitorShape {
  const isNewException: boolean =
    input.insightType === AIInsightType.NewException;
  const evidence: ExceptionInsightEvidence | null = getExceptionEvidence(input);
  const serviceId: ObjectID | null = getServiceId(input);
  const serviceName: string | null = trimmedOrNull(input.serviceName);
  const exceptionType: string | null = trimmedOrNull(evidence?.exceptionType);
  const messageFragment: string = getStableExceptionMessageFragment(
    evidence?.exceptionMessage,
  );

  const threshold: number = isNewException
    ? NEW_EXCEPTION_MIN_COUNT
    : getExceptionSpikeThreshold(evidence);
  const thresholdText: string = formatCount(threshold);

  const windowSeconds: number = isNewException
    ? NEW_EXCEPTION_MONITOR_WINDOW_SECONDS
    : SPIKE_MONITOR_WINDOW_SECONDS;

  /*
   * The type is what the person will recognise; a type-less insight is
   * scoped by its message fragment, which stays out of the name (see the
   * header).
   */
  const subject: string = exceptionType
    ? serviceId && serviceName
      ? translateTemplate("{{exceptionType}} in {{serviceName}}", {
          exceptionType: exceptionType,
          serviceName: serviceName,
        })
      : exceptionType
    : serviceId && serviceName
      ? translateTemplate("an exception in {{serviceName}}", {
          serviceName: serviceName,
        })
      : translateTemplate("an exception");

  const name: string = isNewException
    ? translateTemplate("Exception: {{subject}}", { subject: subject })
    : translateTemplate("Exception spike: {{subject}}", { subject: subject });

  const condition: string = isNewException
    ? translateTemplate(
        "The exception occurred {{threshold}} or more times within 24 hours.",
        { threshold: thresholdText },
      )
    : translateTemplate(
        "The exception occurred {{threshold}} or more times within an hour.",
        { threshold: thresholdText },
      );

  const thresholdReason: string = isNewException
    ? translateTemplate(
        "{{threshold}} occurrences in a day is when the AI detector treats a new exception as recurring rather than a one-off.",
        { threshold: thresholdText },
      )
    : translateTemplate(
        "{{threshold}} is the bar the AI detector used: {{multiplier}} times the exception's hourly baseline, and never below {{floor}}.",
        {
          threshold: thresholdText,
          multiplier: String(EXCEPTION_SPIKE_MULTIPLIER),
          floor: formatCount(EXCEPTION_SPIKE_MIN_COUNT),
        },
      );

  return {
    monitorType: MonitorType.Exceptions,
    name: name,
    description: [
      isNewException
        ? translateTemplate(
            "Created from an AI insight that found a new exception. Opens an incident when it keeps happening:",
          )
        : translateTemplate(
            "Created from an AI insight that found an exception spike. Opens an incident when this happens again:",
          ),
      condition,
      thresholdReason,
      translateTemplate(
        "Resolving or archiving the exception stops it counting until it occurs again.",
      ),
    ].join(" "),
    configureStep: (step: MonitorStep): void => {
      step.setExceptionMonitor({
        ...MonitorStepExceptionMonitorUtil.getDefault(),
        telemetryServiceIds: serviceId ? [serviceId] : [],
        exceptionTypes: exceptionType ? [exceptionType] : [],
        message: messageFragment,
        // Resolving the exception closes the incident, as the description says.
        includeResolved: false,
        includeArchived: false,
        lastXSecondsOfExceptions: windowSeconds,
      });
    },
    criteria: {
      checkOn: CheckOn.ExceptionCount,
      unhealthyFilterType: FilterType.GreaterThanOrEqualTo,
      healthyFilterType: FilterType.LessThan,
      threshold: threshold,
      unhealthyName: isNewException
        ? translateTemplate("{{threshold}} or more occurrences in 24 hours", {
            threshold: thresholdText,
          })
        : translateTemplate("{{threshold}} or more occurrences in an hour", {
            threshold: thresholdText,
          }),
      unhealthyDescription: condition,
      healthyDescription: isNewException
        ? translateTemplate(
            "Fewer than {{threshold}} occurrences in the past 24 hours.",
            { threshold: thresholdText },
          )
        : translateTemplate(
            "Fewer than {{threshold}} occurrences in the past hour.",
            { threshold: thresholdText },
          ),
      incidentTitle: name,
      incidentDescription: [
        condition,
        translateTemplate(
          "Open the exception to see its stack trace, the release it appeared in and how many requests it affected.",
        ),
      ].join(" "),
    },
  };
}

function buildMetricDriftMonitor(
  input: AIInsightMonitorInput,
  direction: MetricDriftDirection,
): MonitorShape {
  const evidence: MetricDriftInsightEvidence | null =
    getMetricDriftEvidence(input);

  const metricName: string =
    trimmedOrNull(input.metricName) || trimmedOrNull(evidence?.metricName)!;

  /*
   * The drift is measured per (metric, entity) cell, so the monitor watches
   * the same cell: Metric rows carry the entity as primaryEntityId, which is
   * exactly what MonitorStepMetricMonitor.telemetryServiceIds filters on.
   */
  const entityIdString: string | null = trimmedOrNull(
    evidence?.primaryEntityId,
  );
  const entityId: ObjectID | null =
    entityIdString && ObjectID.isValidUUID(entityIdString)
      ? new ObjectID(entityIdString)
      : null;

  const threshold: number = getMetricDriftThreshold(direction);
  const thresholdText: string = String(threshold);
  const priorText: string = String(
    roundMetricThreshold(direction.priorWeekMean),
  );
  const isUp: boolean = direction.direction === 1;

  const name: string = translateTemplate("Metric drift: {{metricName}}", {
    metricName: metricName,
  });

  const condition: string = isUp
    ? translateTemplate(
        "The hourly average of {{metricName}} reached {{threshold}} or more.",
        { metricName: metricName, threshold: thresholdText },
      )
    : translateTemplate(
        "The hourly average of {{metricName}} fell to {{threshold}} or less.",
        { metricName: metricName, threshold: thresholdText },
      );

  const thresholdReason: string = isUp
    ? translateTemplate(
        "{{threshold}} is the bar the AI detector used: 50% above the metric's prior-week average of {{prior}}.",
        { threshold: thresholdText, prior: priorText },
      )
    : translateTemplate(
        "{{threshold}} is the bar the AI detector used: 50% below the metric's prior-week average of {{prior}}.",
        { threshold: thresholdText, prior: priorText },
      );

  const sentences: Array<string> = [
    translateTemplate(
      "Created from an AI insight that found this metric drifting week over week. Opens an incident while it stays drifted:",
    ),
    condition,
    thresholdReason,
  ];

  if (entityId) {
    sentences.push(
      translateTemplate(
        "Only the entity the drift was found on is evaluated, so the chart while editing can show more series than the monitor watches.",
      ),
    );
  }

  return {
    monitorType: MonitorType.Metrics,
    name: name,
    description: sentences.join(" "),
    configureStep: (step: MonitorStep): void => {
      step.setMetricMonitor({
        rollingTime: METRIC_DRIFT_MONITOR_ROLLING_TIME,
        telemetryServiceIds: entityId ? [entityId] : [],
        metricViewConfig: {
          queryConfigs: [
            {
              metricAliasData: {
                metricVariable: METRIC_DRIFT_MONITOR_METRIC_ALIAS,
                title: metricName,
                description: metricName,
                legend: metricName,
                legendUnit: undefined,
              },
              metricQueryData: {
                filterData: {
                  metricName: metricName,
                  attributes: {},
                  /*
                   * Avg: the detector's means are means of the raw points,
                   * which for a gauge (or a non-cumulative sum) is what the
                   * monitor's Avg reads. The shapes where they differ are
                   * refused by getAIInsightMonitorBlocker.
                   */
                  aggegationType: AggregationType.Avg,
                  aggregateBy: {},
                },
              },
            },
          ],
          formulaConfigs: [],
        },
      });
    },
    criteria: {
      checkOn: CheckOn.MetricValue,
      unhealthyFilterType: isUp
        ? FilterType.GreaterThanOrEqualTo
        : FilterType.LessThanOrEqualTo,
      healthyFilterType: isUp ? FilterType.LessThan : FilterType.GreaterThan,
      threshold: threshold,
      metricAlias: METRIC_DRIFT_MONITOR_METRIC_ALIAS,
      unhealthyName: isUp
        ? translateTemplate("Hourly average at or above {{threshold}}", {
            threshold: thresholdText,
          })
        : translateTemplate("Hourly average at or below {{threshold}}", {
            threshold: thresholdText,
          }),
      unhealthyDescription: condition,
      healthyDescription: isUp
        ? translateTemplate("The hourly average is back below {{threshold}}.", {
            threshold: thresholdText,
          })
        : translateTemplate("The hourly average is back above {{threshold}}.", {
            threshold: thresholdText,
          }),
      incidentTitle: name,
      incidentDescription: [
        condition,
        translateTemplate(
          "Compare it with the weeks before in the metrics explorer, and check what changed when it moved: a release, a configuration change or a shift in traffic.",
        ),
      ].join(" "),
    },
  };
}

/**
 * Monitor Create's initial values for a monitor made from this insight —
 * name, description, type and steps — or null when the insight cannot become
 * one (getAIInsightMonitorBlocker says why).
 */
export function buildAIInsightMonitorPrefill(data: {
  insight: AIInsightMonitorInput;
  seeds: AIInsightMonitorSeedIds;
  context?: AIInsightMonitorContext | undefined;
}): JSONObject | null {
  if (getAIInsightMonitorBlocker(data.insight, data.context)) {
    return null;
  }

  let shape: MonitorShape | null = null;

  switch (data.insight.insightType) {
    case AIInsightType.ErrorLogSpike:
      shape = buildErrorLogSpikeMonitor(data.insight);
      break;
    case AIInsightType.NewException:
    case AIInsightType.ExceptionSpike:
      shape = buildExceptionMonitor(data.insight);
      break;
    case AIInsightType.MetricDrift: {
      const direction: MetricDriftDirection | null = getMetricDriftDirection(
        getMetricDriftEvidence(data.insight),
      );
      shape = direction
        ? buildMetricDriftMonitor(data.insight, direction)
        : null;
      break;
    }
    default:
      shape = null;
  }

  if (!shape) {
    return null;
  }

  const monitorSteps: MonitorSteps = new MonitorSteps();
  const step: MonitorStep | undefined =
    monitorSteps.data?.monitorStepsInstanceArray[0];

  if (!step?.data) {
    return null;
  }

  const name: string = clampMonitorName(shape.name);

  shape.configureStep(step);

  step.setMonitorCriteria(
    buildCriteriaPair({
      ...shape.criteria,
      incidentTitle: name,
      seeds: data.seeds,
      severityLevel: getAIInsightMonitorSeverityLevel(data.insight.severity),
    }),
  );

  /*
   * A prefilled MonitorSteps must carry its default status itself: the steps
   * form only fills it in when it bootstraps WITHOUT an initial value.
   */
  if (data.seeds.operationalMonitorStatusId) {
    monitorSteps.setDefaultMonitorStatusId(
      data.seeds.operationalMonitorStatusId,
    );
  }

  return {
    name: name,
    description: shape.description,
    monitorType: shape.monitorType,
    monitorSteps: monitorSteps.toJSON(),
  };
}

/**
 * Monitor Create, opened on the monitor made from this insight. The id rides
 * as a query parameter, so Monitor Create reads the insight itself and the
 * link stays short whatever the evidence holds.
 */
export function buildAIInsightMonitorRoute(insightId: string): Route {
  const route: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.MONITOR_CREATE] as Route,
  );

  return new Route(
    `${route.toString()}?${AI_INSIGHT_MONITOR_QUERY_PARAM}=${encodeURIComponent(
      insightId.trim(),
    )}`,
  );
}
