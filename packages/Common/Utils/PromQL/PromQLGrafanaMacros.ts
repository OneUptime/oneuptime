import { DataSourceLimitsUtil } from "../../Types/DataSource/DataSourceLimits";

/*
 * GRAFANA'S INTERVAL MACROS IN A WIDGET'S PROMQL (issue #7697).
 *
 * Grafana fills $__interval, $__rate_interval and $__range into a panel's
 * PromQL before it reaches Prometheus, and most dashboards lean on them:
 * 143 of the 301 queries of Grafana's "Node Exporter Full" read
 * rate(...[$__rate_interval]). A Chart, Value, Gauge or Table widget that
 * runs PromQL - over the project's own metrics, or an outside Prometheus -
 * fills them the same way, from the window and the step its query runs
 * at, so a query moved over from Grafana reads exactly what it read there:
 *
 *   $__interval          the step, never under the scrape interval
 *   $__interval_ms       the same, in milliseconds (a number)
 *   $__rate_interval     max($__interval + scrape interval, 4 x scrape
 *                        interval), as Grafana works it out
 *   $__rate_interval_ms  the same, in milliseconds
 *   $__range             the window's length
 *   $__range_s           the same, in seconds (a number)
 *   $__range_ms          the same, in milliseconds (a number)
 *
 * The scrape interval is Grafana's default for a Prometheus data source,
 * 15 seconds. ${__interval}, Grafana's other spelling, is read too. A
 * query with none of them is returned exactly as it came.
 */

// Grafana's default scrape interval for a Prometheus data source.
export const GRAFANA_DEFAULT_SCRAPE_INTERVAL_IN_SECONDS: number = 15;

export interface PromQLMacroWindow {
  startDate: Date;
  endDate: Date;
  // The step the query runs at; worked out from the window when absent.
  stepInSeconds?: number | undefined;
}

export enum GrafanaIntervalMacro {
  RateIntervalMs = "rate_interval_ms",
  RateInterval = "rate_interval",
  IntervalMs = "interval_ms",
  Interval = "interval",
  RangeMs = "range_ms",
  RangeS = "range_s",
  Range = "range",
}

/*
 * Each macro, as `$__name` or `${__name}`. Longer names first, so
 * $__interval_ms is never read as $__interval followed by "_ms"; a name
 * that goes on in letters or digits ($__intervals) is none of them.
 */
const MACRO_PATTERN: RegExp =
  /\$__(rate_interval_ms|rate_interval|interval_ms|interval|range_ms|range_s|range)(?![A-Za-z0-9_])|\$\{__(rate_interval_ms|rate_interval|interval_ms|interval|range_ms|range_s|range)\}/g;

// Whether a query names any of the macros.
export const hasGrafanaIntervalMacro: (query: string) => boolean = (
  query: string,
): boolean => {
  MACRO_PATTERN.lastIndex = 0;
  const found: boolean = MACRO_PATTERN.test(query || "");
  MACRO_PATTERN.lastIndex = 0;
  return found;
};

export interface GrafanaIntervalValues {
  intervalInSeconds: number;
  rateIntervalInSeconds: number;
  rangeInSeconds: number;
}

// What each macro stands for over a window, as Grafana works it out.
export const getGrafanaIntervalValues: (
  window: PromQLMacroWindow,
) => GrafanaIntervalValues = (
  window: PromQLMacroWindow,
): GrafanaIntervalValues => {
  const step: number =
    window.stepInSeconds && Number.isFinite(window.stepInSeconds)
      ? Math.max(1, Math.floor(window.stepInSeconds))
      : DataSourceLimitsUtil.getStepInSeconds(window.startDate, window.endDate);

  const scrape: number = GRAFANA_DEFAULT_SCRAPE_INTERVAL_IN_SECONDS;
  const interval: number = Math.max(step, scrape);

  return {
    intervalInSeconds: interval,
    rateIntervalInSeconds: Math.max(interval + scrape, 4 * scrape),
    rangeInSeconds: Math.max(
      1,
      Math.round(
        (window.endDate.getTime() - window.startDate.getTime()) / 1000,
      ),
    ),
  };
};

const macroText: (name: string, values: GrafanaIntervalValues) => string = (
  name: string,
  values: GrafanaIntervalValues,
): string => {
  switch (name as GrafanaIntervalMacro) {
    case GrafanaIntervalMacro.Interval:
      return `${values.intervalInSeconds}s`;
    case GrafanaIntervalMacro.IntervalMs:
      return String(values.intervalInSeconds * 1000);
    case GrafanaIntervalMacro.RateInterval:
      return `${values.rateIntervalInSeconds}s`;
    case GrafanaIntervalMacro.RateIntervalMs:
      return String(values.rateIntervalInSeconds * 1000);
    case GrafanaIntervalMacro.Range:
      return `${values.rangeInSeconds}s`;
    case GrafanaIntervalMacro.RangeS:
      return String(values.rangeInSeconds);
    case GrafanaIntervalMacro.RangeMs:
      return String(values.rangeInSeconds * 1000);
    default:
      return "";
  }
};

// The macros filled from fixed values.
export const fillGrafanaIntervalMacros: (
  query: string,
  values: GrafanaIntervalValues,
) => string = (query: string, values: GrafanaIntervalValues): string => {
  if (!query || query.indexOf("$") === -1) {
    return query;
  }

  return query.replace(
    MACRO_PATTERN,
    (
      _match: string,
      bare: string | undefined,
      braced: string | undefined,
    ): string => {
      return macroText(bare || braced || "", values);
    },
  );
};

// The macros filled for the window and step a query runs at.
export const applyGrafanaIntervalMacros: (
  query: string,
  window: PromQLMacroWindow,
) => string = (query: string, window: PromQLMacroWindow): string => {
  if (!hasGrafanaIntervalMacro(query)) {
    return query;
  }

  return fillGrafanaIntervalMacros(query, getGrafanaIntervalValues(window));
};

/*
 * The values a query is checked with before it is run anywhere: an hour's
 * window, as a new dashboard opens on, so a query that parses here parses
 * at every window.
 */
export const GRAFANA_MACRO_CHECK_VALUES: GrafanaIntervalValues = {
  intervalInSeconds: 15,
  rateIntervalInSeconds: 60,
  rangeInSeconds: 3600,
};
