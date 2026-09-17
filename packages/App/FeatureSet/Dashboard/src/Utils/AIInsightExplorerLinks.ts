import Dictionary from "Common/Types/Dictionary";
import Route from "Common/Types/API/Route";
import AIInsightType from "Common/Types/AI/AIInsightType";
import IconProp from "Common/Types/Icon/IconProp";
import TimeRange from "Common/Types/Time/TimeRange";
import RouteMap, { RouteUtil } from "./RouteMap";
import PageMap from "./PageMap";
/*
 * Sibling-relative on purpose: the `Common` package specifier resolves
 * through App/node_modules, which may symlink a checkout that predates
 * this module; the relative path always resolves the sibling source this
 * branch ships with (identical to the specifier once merged).
 */
import {
  CrossSignalQueryParams,
  TelemetryCrossSignalScope,
  toLogsExplorerQueryParams,
  toMetricsExplorerQueryParams,
  toTracesExplorerQueryParams,
} from "../../../../../Common/Utils/Telemetry/CrossSignalScope";

/*
 * Deep links from an AI insight to the explorer that can prove or disprove
 * it. Every deterministic detector (Common/Server/Utils/AI/SRE/Insights/
 * Detectors) maps 1:1 to one explorer surface:
 *
 *   MetricDrift            -> metric explorer (metricQueries for the metric
 *                             name + the week-over-week comparison window)
 *   ErrorLogSpike          -> logs explorer (Error/Fatal severities +
 *                             service scope + the spike window)
 *   TraceLatencyRegression -> traces explorer (service scope + the recent
 *                             p99 window)
 *   NewException /         -> the exception group's own detail page when
 *   ExceptionSpike            the insight stores its telemetryExceptionId,
 *                             else the exceptions list scoped to the
 *                             service + a detection-sized window
 *
 * Everything here is pure (no network, no React) so App/Tests/Dashboard can
 * exercise the whole matrix in plain Node; the caller resolves service
 * names to ObjectIDs (MetricsCrossSignalPivot.resolveServiceIdsByNames)
 * and passes the result in as `serviceId`.
 */

/*
 * Detection-window sizes, mirroring the detector constants the client
 * cannot import (Common/Server is server-only):
 *  - ErrorLogSpikeDetector.ERROR_LOG_SPIKE_RECENT_WINDOW_MINUTES (the
 *    evidence's own windowMinutes wins when present),
 *  - TraceLatencyRegressionDetector.LATENCY_RECENT_WINDOW_HOURS,
 *  - MetricDriftDetector's week-over-week comparison (both weeks, so the
 *    drift is visible on the chart rather than just the drifted level),
 *  - the exception detectors' 24-hour novelty/baseline window.
 */
export const ERROR_LOG_SPIKE_DEFAULT_WINDOW_MINUTES: number = 60;
export const LATENCY_REGRESSION_WINDOW_MINUTES: number = 60;
export const METRIC_DRIFT_WINDOW_MINUTES: number = 14 * 24 * 60;
export const EXCEPTION_INSIGHT_WINDOW_MINUTES: number = 24 * 60;

/*
 * The severities ErrorLogSpikeDetector counts
 * (ErrorLogSpikeDetector.ERROR_LOG_SEVERITIES — server-only module).
 */
export const ERROR_LOG_SPIKE_SEVERITIES: Array<string> = ["Error", "Fatal"];

/*
 * The service resource attribute logs/spans/metrics carry at ingest — the
 * degraded (no-ObjectID) service scope. Deliberately a local literal
 * rather than an import of MetricsCrossSignalPivot's identical export:
 * that module's graph reaches ModelAPI and its React component imports,
 * which this pure util must stay free of. The jest suite pins the two
 * constants equal.
 */
export const SERVICE_NAME_ATTRIBUTE_KEY: string = "resource.service.name";

export type InsightExplorerTarget =
  | "metrics"
  | "logs"
  | "traces"
  | "exceptions";

/**
 * The insight fields the link builder reads. All optional and
 * string-tolerant on purpose: rows arrive from JSON, so any field can be
 * absent or malformed, and the builder must degrade instead of crash.
 */
export interface AIInsightExplorerLinkInput {
  /** The model's insightType — may be an unknown string on a new detector. */
  insightType?: string | undefined;
  serviceName?: string | undefined;
  /**
   * Service ObjectID string: the model's telemetryServiceId, or one the
   * caller resolved from serviceName. When absent the scope degrades to a
   * `resource.service.name` attribute filter (logs/traces carry resource
   * attributes under that key at ingest) or, for the exceptions list —
   * which has no name-shaped filter — to a reported drop.
   */
  serviceId?: string | undefined;
  /** NewException / ExceptionSpike: the exception group behind the insight. */
  telemetryExceptionId?: string | undefined;
  /** MetricDrift: the drifting metric's name. */
  metricName?: string | undefined;
  /** Anchor for the detection window. JSON rows may carry it as a string. */
  lastSeenAt?: Date | string | undefined;
  /** ErrorLogSpike: evidence.logSpike.windowMinutes when available. */
  spikeWindowMinutes?: number | undefined;
}

export interface AIInsightExplorerLink {
  target: InsightExplorerTarget;
  /** Button/affordance title, e.g. "Investigate in Logs". */
  label: string;
  icon: IconProp;
  route: Route;
  /*
   * Scope-field names the target grammar could not carry
   * (TelemetryCrossSignalScope key names, e.g. "serviceIds") — surface via
   * MetricsCrossSignalPivot.formatDroppedScopeHint, never silently.
   */
  dropped: Array<string>;
}

export interface InsightDetectionWindow {
  startTime: Date;
  endTime: Date;
}

function toValidDate(value: Date | string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function trimmedOrNull(value: string | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0 ? trimmed : null;
}

type GetInsightDetectionWindowFunction = (args: {
  insightType?: string | undefined;
  lastSeenAt?: Date | string | undefined;
  spikeWindowMinutes?: number | undefined;
}) => InsightDetectionWindow | null;

/**
 * The [lastSeenAt - detectionWindow, lastSeenAt] window for one insight —
 * the slice of telemetry the detector actually looked at. Null when the
 * insight type is unknown or the anchor date is absent/unparseable, so a
 * link still builds (window-less) instead of pinning a garbage range.
 */
export const getInsightDetectionWindow: GetInsightDetectionWindowFunction =
  (args: {
    insightType?: string | undefined;
    lastSeenAt?: Date | string | undefined;
    spikeWindowMinutes?: number | undefined;
  }): InsightDetectionWindow | null => {
    const endTime: Date | null = toValidDate(args.lastSeenAt);

    if (!endTime) {
      return null;
    }

    let windowMinutes: number;

    switch (args.insightType) {
      case AIInsightType.ErrorLogSpike:
        windowMinutes =
          typeof args.spikeWindowMinutes === "number" &&
          Number.isFinite(args.spikeWindowMinutes) &&
          args.spikeWindowMinutes > 0
            ? args.spikeWindowMinutes
            : ERROR_LOG_SPIKE_DEFAULT_WINDOW_MINUTES;
        break;
      case AIInsightType.TraceLatencyRegression:
        windowMinutes = LATENCY_REGRESSION_WINDOW_MINUTES;
        break;
      case AIInsightType.MetricDrift:
        windowMinutes = METRIC_DRIFT_WINDOW_MINUTES;
        break;
      case AIInsightType.NewException:
      case AIInsightType.ExceptionSpike:
        windowMinutes = EXCEPTION_INSIGHT_WINDOW_MINUTES;
        break;
      default:
        return null;
    }

    return {
      startTime: new Date(endTime.getTime() - windowMinutes * 60 * 1000),
      endTime: endTime,
    };
  };

type EncodeRouteQueryParamValueFunction = (value: string) => string;

/**
 * Route-safe single encoding for one query-param value. encodeURIComponent
 * alone is almost sufficient: its unreserved set (A-Z a-z 0-9 - _ . ! ~ * '
 * ( )) sits inside Route's character whitelist except for "~", which it
 * leaves bare and Route's setter rejects with a throw. Escape the tilde by
 * hand so a "svc~canary" service or metric name builds a working link:
 * every target explorer parses its params through URLSearchParams (a
 * single decode), which turns %7E back into "~". Exported so the jest
 * suite can pin this whitelist agreement.
 */
export const encodeRouteQueryParamValue: EncodeRouteQueryParamValueFunction = (
  value: string,
): string => {
  return encodeURIComponent(value).replace(/~/g, "%7E");
};

/*
 * Append query params to a route, encoding each value exactly once. Null —
 * the same guard ExceptionCorrelation's link builder uses — if Route still
 * rejects a value: these builders run inside row renderers, so a hostile
 * insight field must yield "no link", never a throw out of render.
 */
function withQueryParams(
  route: Route,
  params: Dictionary<string>,
): Route | null {
  const keys: Array<string> = Object.keys(params);

  if (keys.length === 0) {
    return route;
  }

  const encoded: Dictionary<string> = {};

  for (const key of keys) {
    encoded[key] = encodeRouteQueryParamValue(params[key] as string);
  }

  try {
    const result: Route = new Route(route.toString());
    result.addQueryParams(encoded);

    return result;
  } catch {
    return null;
  }
}

interface InsightServiceScope {
  serviceIds?: Array<string> | undefined;
  attributes?: Dictionary<string> | undefined;
}

/*
 * Service scope for the logs/traces serializers: the resolved ObjectID when
 * the caller has one, else the name as a verbatim `resource.service.name`
 * attribute (the same degradation MetricsCrossSignalPivot uses — logs and
 * spans store resource attributes under that key), else nothing.
 */
function buildServiceScope(
  input: AIInsightExplorerLinkInput,
): InsightServiceScope {
  const serviceId: string | null = trimmedOrNull(input.serviceId);

  if (serviceId) {
    return { serviceIds: [serviceId] };
  }

  const serviceName: string | null = trimmedOrNull(input.serviceName);

  if (serviceName) {
    return { attributes: { [SERVICE_NAME_ATTRIBUTE_KEY]: serviceName } };
  }

  return {};
}

type BuildMetricExplorerRouteFunction = (args: {
  metricName?: string | undefined;
  serviceName?: string | undefined;
  lastSeenAt?: Date | string | undefined;
}) => Route | null;

/**
 * Metric-explorer route for one metric name over the metric-drift
 * comparison window (both weeks, so the drift itself is on screen). Used
 * for the MetricDrift investigate action AND to linkify a bare metricName
 * fact. Null when there is no usable metric name.
 */
export const buildMetricExplorerRoute: BuildMetricExplorerRouteFunction =
  (args: {
    metricName?: string | undefined;
    serviceName?: string | undefined;
    lastSeenAt?: Date | string | undefined;
  }): Route | null => {
    const metricName: string | null = trimmedOrNull(args.metricName);

    if (!metricName) {
      return null;
    }

    const window: InsightDetectionWindow | null = getInsightDetectionWindow({
      insightType: AIInsightType.MetricDrift,
      lastSeenAt: args.lastSeenAt,
    });

    const serviceName: string | null = trimmedOrNull(args.serviceName);

    const scope: TelemetryCrossSignalScope = {};

    if (serviceName) {
      /*
       * Metric rows carry the service as the `resource.service.name`
       * attribute at ingest, so unlike the logs/traces targets no ObjectID
       * resolution is needed here.
       */
      scope.attributes = { [SERVICE_NAME_ATTRIBUTE_KEY]: serviceName };
    }

    if (window) {
      scope.startTime = window.startTime;
      scope.endTime = window.endTime;
    }

    const serialized: CrossSignalQueryParams = toMetricsExplorerQueryParams(
      scope,
      metricName,
    );

    return withQueryParams(
      RouteUtil.populateRouteParams(RouteMap[PageMap.METRIC_VIEW] as Route),
      serialized.params,
    );
  };

type BuildInsightInvestigationLinkFunction = (
  input: AIInsightExplorerLinkInput,
) => AIInsightExplorerLink | null;

/**
 * The per-insight-type "Investigate in explorer" deep link. Null — never a
 * throw, never a broken route — when the insight type is unknown or the
 * type's essential field is missing (e.g. a MetricDrift row with no metric
 * name).
 */
export const buildInsightInvestigationLink: BuildInsightInvestigationLinkFunction =
  (input: AIInsightExplorerLinkInput): AIInsightExplorerLink | null => {
    switch (input.insightType) {
      case AIInsightType.MetricDrift: {
        const route: Route | null = buildMetricExplorerRoute({
          metricName: input.metricName,
          serviceName: input.serviceName,
          lastSeenAt: input.lastSeenAt,
        });

        if (!route) {
          return null;
        }

        return {
          target: "metrics",
          label: "Investigate in Metrics",
          icon: IconProp.ChartBar,
          route,
          dropped: [],
        };
      }

      case AIInsightType.ErrorLogSpike: {
        const window: InsightDetectionWindow | null = getInsightDetectionWindow(
          {
            insightType: input.insightType,
            lastSeenAt: input.lastSeenAt,
            spikeWindowMinutes: input.spikeWindowMinutes,
          },
        );

        const serviceScope: InsightServiceScope = buildServiceScope(input);

        const scope: TelemetryCrossSignalScope = {
          severityTexts: [...ERROR_LOG_SPIKE_SEVERITIES],
          serviceIds: serviceScope.serviceIds,
          attributes: serviceScope.attributes,
          startTime: window?.startTime,
          endTime: window?.endTime,
        };

        const serialized: CrossSignalQueryParams =
          toLogsExplorerQueryParams(scope);

        const route: Route | null = withQueryParams(
          RouteUtil.populateRouteParams(RouteMap[PageMap.LOGS] as Route),
          serialized.params,
        );

        if (!route) {
          return null;
        }

        return {
          target: "logs",
          label: "Investigate in Logs",
          icon: IconProp.Logs,
          route,
          dropped: serialized.dropped,
        };
      }

      case AIInsightType.TraceLatencyRegression: {
        const window: InsightDetectionWindow | null = getInsightDetectionWindow(
          {
            insightType: input.insightType,
            lastSeenAt: input.lastSeenAt,
          },
        );

        const serviceScope: InsightServiceScope = buildServiceScope(input);

        const scope: TelemetryCrossSignalScope = {
          serviceIds: serviceScope.serviceIds,
          attributes: serviceScope.attributes,
          startTime: window?.startTime,
          endTime: window?.endTime,
        };

        const serialized: CrossSignalQueryParams =
          toTracesExplorerQueryParams(scope);

        const route: Route | null = withQueryParams(
          RouteUtil.populateRouteParams(RouteMap[PageMap.TRACES] as Route),
          serialized.params,
        );

        if (!route) {
          return null;
        }

        return {
          target: "traces",
          label: "Investigate in Traces",
          icon: IconProp.RectangleStack,
          route,
          dropped: serialized.dropped,
        };
      }

      case AIInsightType.NewException:
      case AIInsightType.ExceptionSpike: {
        const exceptionId: string | null = trimmedOrNull(
          input.telemetryExceptionId,
        );

        if (exceptionId) {
          /*
           * The group's own detail page — no scope to lose. The id rides
           * in the route PATH, whose character whitelist a malformed JSON
           * value can violate (Route's setter throws on e.g. spaces or
           * "~"); such a row falls through to the scoped list below
           * instead of throwing out of a row renderer.
           */
          try {
            return {
              target: "exceptions",
              label: "View Exception Group",
              icon: IconProp.Bug,
              route: RouteUtil.populateRouteParams(
                RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
                { modelId: exceptionId },
              ),
              dropped: [],
            };
          } catch {
            // Unroutable id — the service/window-scoped list still helps.
          }
        }

        /*
         * List fallback (ExceptionsViewer URL grammar): `status=all` keeps
         * resolved/archived groups visible on arrival, `filters` is a JSON
         * array of [facetKey, value] pairs where `primaryEntityId` takes
         * the service ObjectID, and a Custom range needs `range` + `start`
         * + `end`. The list has no name-shaped service filter, so a name
         * that never resolved to an id is reported dropped rather than
         * compiled into a `primaryEntityId = '<name>'` predicate that
         * would match nothing.
         */
        const params: Dictionary<string> = { status: "all" };
        const dropped: Array<string> = [];

        const serviceId: string | null = trimmedOrNull(input.serviceId);

        if (serviceId) {
          params["filters"] = JSON.stringify([["primaryEntityId", serviceId]]);
        } else if (trimmedOrNull(input.serviceName)) {
          dropped.push("serviceIds");
        }

        const window: InsightDetectionWindow | null = getInsightDetectionWindow(
          {
            insightType: input.insightType,
            lastSeenAt: input.lastSeenAt,
          },
        );

        if (window) {
          params["range"] = TimeRange.CUSTOM;
          params["start"] = window.startTime.toISOString();
          params["end"] = window.endTime.toISOString();
        }

        const route: Route | null = withQueryParams(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.EXCEPTIONS_UNRESOLVED] as Route,
          ),
          params,
        );

        if (!route) {
          return null;
        }

        return {
          target: "exceptions",
          label: "Investigate in Exceptions",
          icon: IconProp.Bug,
          route,
          dropped,
        };
      }

      default:
        // Unknown/absent detector type: no action rather than a crash.
        return null;
    }
  };
