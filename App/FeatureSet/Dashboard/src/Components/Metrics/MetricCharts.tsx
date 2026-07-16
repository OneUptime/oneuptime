import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import OneUptimeDate from "Common/Types/Date";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import ChartGroup, {
  Chart,
  ChartMetricInfo,
  ChartType,
} from "Common/UI/Components/Charts/ChartGroup/ChartGroup";
import Dictionary from "Common/Types/Dictionary";
import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";
import { XAxisAggregateType } from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import MetricQueryConfigData, {
  ChartSeries,
  MetricChartType,
} from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import { YAxisPrecision } from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YScaleMaxMin from "Common/UI/Components/Charts/Types/YAxis/YAxisMaxMin";
import ChartCurve from "Common/UI/Components/Charts/Types/ChartCurve";
import MetricType from "Common/Models/DatabaseModels/MetricType";
import ChartReferenceLineProps from "Common/UI/Components/Charts/Types/ReferenceLineProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ExemplarPoint from "Common/UI/Components/Charts/Types/ExemplarPoint";
import ValueFormatter from "Common/Utils/ValueFormatter";
import {
  AvailableChartColorsKeys,
  ChartColorValue,
  getColorClassName,
  getColorHex,
  isHexColorValue,
} from "Common/UI/Components/Charts/ChartLibrary/Utils/ChartColors";
import { LineChartPalette } from "Common/UI/Components/Charts/Line/LineChart";
import { AreaChartPalette } from "Common/UI/Components/Charts/Area/AreaChart";
import { BarChartPalette } from "Common/UI/Components/Charts/Bar/BarChart";
import MetricUtil, {
  DEFAULT_TOP_N_SERIES,
  SHOW_ALL_SERIES_TOP_N,
  sanitizeAttributeFilters,
} from "./Utils/Metrics";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import HintChip from "./HintChip";
import {
  DictionaryEntryValue,
  DictionaryFilterOperator,
  DictionaryFilterOperatorOption,
  detectOperatorFromValue,
  getOperatorOption,
} from "Common/UI/Components/Dictionary/DictionaryFilterOperator";

export interface ComponentProps {
  metricViewData: MetricViewData;
  metricResults: Array<AggregatedResult>;
  metricTypes: Array<MetricType>;
  hideCard?: boolean | undefined;
  chartCssClass?: string | undefined;
  /*
   * Called with the FULL replacement queryConfigs array when a chart
   * control changes query-level state (currently: the per-chart Top-N /
   * "Show all" controls writing `metricQueryData.topN`). Passing the
   * whole array lets one interaction update several queries (an overlay
   * panel spans many) in a single parent onChange, which also triggers
   * the parent's refetch. When absent, those controls fall back to
   * transient Top-N overrides applied on the next fetch (see
   * MetricUtil.setQueryTopNOverride).
   */
  onQueryConfigsChange?:
    | ((queryConfigs: Array<MetricQueryConfigData>) => void)
    | undefined;
  /*
   * Drag-to-zoom: when set, every panel's chart supports drag-selecting a
   * time range and calls back with the selected [start, end) window. The
   * host is expected to narrow its query window in response.
   */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  /*
   * Time-anchored annotations rendered on EVERY panel (query and formula
   * charts alike): vertical event markers (e.g. incident/alert created)
   * and shaded regions (e.g. incident open windows).
   */
  timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
  referenceRegions?: Array<ChartReferenceRegionProps> | undefined;
}

/*
 * How the per-series node list (the interactive legend below the chart) is
 * ranked and ordered. "peak" (the highest value the series reached over the
 * visible window) is the default so a spiking node — e.g. the one whose RAM
 * briefly maxed out — surfaces at the top of the list instead of being
 * buried in alphabetical order. This orders the node list only; the chart's
 * series keep a stable name order so line colors don't shuffle on refresh.
 */
type SeriesSortBy = "peak" | "avg" | "latest" | "name";

interface SeriesSortOption {
  key: SeriesSortBy;
  // Label shown in the sort dropdown.
  label: string;
  // Short label used in the "· ranked by …" status line.
  rankedByLabel: string;
}

const SERIES_SORT_OPTIONS: Array<SeriesSortOption> = [
  { key: "peak", label: "Peak", rankedByLabel: "peak value" },
  { key: "avg", label: "Average", rankedByLabel: "average value" },
  { key: "latest", label: "Latest", rankedByLabel: "latest value" },
  { key: "name", label: "Name", rankedByLabel: "peak value" },
];

// Choices offered by the per-chart Top-N series selector.
const TOP_N_CHOICES: Array<number> = [5, 10, 25, 50];

type SeriesValueStat = "peak" | "avg" | "latest";

/*
 * Numeric summary of a single series over the visible window. Returns null
 * when the series has no finite data points so callers can sort it last and
 * skip rendering a value for it.
 */
function computeSeriesStat(
  series: SeriesPoint,
  stat: SeriesValueStat,
): number | null {
  let sum: number = 0;
  let count: number = 0;
  let peak: number = Number.NEGATIVE_INFINITY;
  let latestValue: number | null = null;
  let latestX: number = Number.NEGATIVE_INFINITY;

  for (const point of series.data) {
    const y: number | null = Number.isFinite(point.y) ? point.y : null;
    if (y === null) {
      continue;
    }
    count++;
    sum += y;
    if (y > peak) {
      peak = y;
    }
    const xTime: number = point.x.getTime();
    if (xTime >= latestX) {
      latestX = xTime;
      latestValue = y;
    }
  }

  if (count === 0) {
    return null;
  }

  if (stat === "avg") {
    return sum / count;
  }
  if (stat === "latest") {
    return latestValue;
  }
  return peak;
}

// Natural-sort comparator for series names (cpu0 < cpu2 < cpu10).
function compareSeriesByName(a: SeriesPoint, b: SeriesPoint): number {
  return a.seriesName.localeCompare(b.seriesName, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/*
 * Returns a new array of series ordered for display. Value modes sort
 * descending (highest first) so the node with the highest RAM/CPU/etc. is
 * at the top of the node list; series with no finite data sort last. Ties
 * (and the "name" mode) fall back to natural name order so equal series
 * keep a stable order between renders.
 *
 * Each series' stat is computed exactly once into a lookup map before
 * sorting (decorate–sort), rather than re-scanning a series' data points
 * inside the comparator — the comparator runs O(n log n) times and each
 * scan is O(datapoints), so caching keeps high-cardinality charts snappy.
 */
function sortSeriesForDisplay(
  series: Array<SeriesPoint>,
  sortBy: SeriesSortBy,
): Array<SeriesPoint> {
  if (sortBy === "name") {
    return series.slice().sort(compareSeriesByName);
  }

  const valueByName: Map<string, number | null> = new Map<
    string,
    number | null
  >();
  for (const s of series) {
    valueByName.set(s.seriesName, computeSeriesStat(s, sortBy));
  }

  return series.slice().sort((a: SeriesPoint, b: SeriesPoint) => {
    const aValue: number | null = valueByName.get(a.seriesName) ?? null;
    const bValue: number | null = valueByName.get(b.seriesName) ?? null;
    if (aValue === null && bValue === null) {
      return compareSeriesByName(a, b);
    }
    if (aValue === null) {
      return 1;
    }
    if (bValue === null) {
      return -1;
    }
    if (bValue !== aValue) {
      return bValue - aValue;
    }
    return compareSeriesByName(a, b);
  });
}

/*
 * Value stat used to rank series for the Top-N cut. Name sort still ranks
 * by peak so the most relevant nodes are the ones kept — only the node
 * list's order changes.
 */
function getRankingStat(sortBy: SeriesSortBy): SeriesValueStat {
  return sortBy === "name" ? "peak" : sortBy;
}

// Per-chart user controls for high-cardinality series charts.
interface SeriesControlsState {
  searchQuery: string;
  // Series the user has explicitly hidden via legend click.
  hiddenSeries: Set<string>;
  // When true, lift the Top-N cap and render every series.
  showAllSeries: boolean;
  // How the node list is ranked and ordered (defaults to peak value).
  sortBy: SeriesSortBy;
  /*
   * Local Top-N choice, used only when no onQueryConfigsChange hook is
   * wired (the choice then can't be persisted onto the query config, so
   * this keeps the selector and the display cap responsive while the
   * transient fetch override takes effect on the next fetch).
   */
  topNOverride: number | undefined;
}

const defaultSeriesControlsState: SeriesControlsState = {
  searchQuery: "",
  hiddenSeries: new Set<string>(),
  showAllSeries: false,
  sortBy: "peak",
  topNOverride: undefined,
};

/*
 * Returns the color palette used by the chart wrapper for the given
 * chart type. Keeping this mapping local-but-derived ensures the
 * legend chips always show the same color the chart actually renders,
 * even if a chart type is added without wiring colors here (falls
 * back to the Line palette).
 */
function getChartPalette(
  chartType: ChartType,
): Array<AvailableChartColorsKeys> {
  if (chartType === ChartType.AREA) {
    return AreaChartPalette;
  }
  if (chartType === ChartType.BAR) {
    return BarChartPalette;
  }
  return LineChartPalette;
}

/*
 * Split a composed grouped-series name back into its "key=value" segments,
 * using the known group keys so it stays correct when a value itself contains
 * the ", " that also joins multi-key segments. A single-key group-by has
 * exactly one segment (the whole name), so a comma in the value can never be
 * mis-split. For multi-key names, a fragment that doesn't start with a known
 * "key=" prefix is treated as a continuation of the previous value.
 */
function splitSeriesNameIntoSegments(
  seriesName: string,
  groupByKeys: Array<string>,
): Array<string> {
  if (groupByKeys.length <= 1) {
    return [seriesName];
  }
  const startsWithKnownKey: (fragment: string) => boolean = (
    fragment: string,
  ): boolean => {
    return groupByKeys.some((key: string): boolean => {
      return fragment.startsWith(`${key}=`);
    });
  };
  const segments: Array<string> = [];
  for (const fragment of seriesName.split(", ")) {
    if (segments.length > 0 && !startsWithKnownKey(fragment)) {
      segments[segments.length - 1] += `, ${fragment}`;
    } else {
      segments.push(fragment);
    }
  }
  return segments;
}

/*
 * Resolve the color for one series. Per-group pins win first: `colorsByGroup`
 * is keyed by the "key=value" segment the series renderer emits, matched via
 * the key-aware split above. Otherwise fall back to the effective palette by
 * position — `effectivePalette` already leads with the query's single `color`,
 * so a color-only query keeps its exact prior behavior. Used by both the
 * chart's colors array and the legend chips so they always agree.
 */
function resolveSeriesColor(
  seriesName: string,
  index: number,
  opts: {
    colorsByGroup: Record<string, string>;
    effectivePalette: Array<ChartColorValue>;
    groupByKeys: Array<string>;
  },
): ChartColorValue {
  const segments: Array<string> = splitSeriesNameIntoSegments(
    seriesName,
    opts.groupByKeys,
  );
  for (const segment of segments) {
    const pinned: string | undefined = opts.colorsByGroup[segment];
    if (pinned) {
      return pinned;
    }
  }
  return opts.effectivePalette[index % opts.effectivePalette.length]!;
}

// Maps a series' display name and position to its rendered color.
type SeriesColorResolver = (
  seriesName: string,
  index: number,
) => ChartColorValue;

/*
 * Stable identity for a query's chart panel and its per-chart UI state
 * (hidden series, search, Top-N, sort). Prefers the query's persistent
 * `id` (assigned at creation sites), then its metric variable — unique
 * within a view and stable across remove/reorder — then the metric name,
 * and only as a last resort the array position. Callers dedupe collisions
 * via a used-id set so two id-less queries on the same metric still get
 * distinct state buckets.
 */
function getStableQueryChartId(
  queryConfig: MetricQueryConfigData,
  index: number,
): string {
  if (queryConfig.id) {
    return `id-${queryConfig.id}`;
  }
  const metricVariable: string | undefined =
    queryConfig.metricAliasData?.metricVariable;
  if (metricVariable) {
    return `var-${metricVariable}`;
  }
  const metricName: string =
    queryConfig.metricQueryData.filterData.metricName?.toString() || "";
  return metricName ? `metric-${metricName}` : `query-${index}`;
}

function dedupeChartId(candidate: string, usedIds: Set<string>): string {
  let unique: string = candidate;
  let suffix: number = 2;
  while (usedIds.has(unique)) {
    unique = `${candidate}-${suffix}`;
    suffix++;
  }
  usedIds.add(unique);
  return unique;
}

// Composite key for exemplar fetch/state: metric name + sanitized filters.
function getExemplarStateKey(queryConfig: MetricQueryConfigData): string {
  const metricName: string =
    queryConfig.metricQueryData.filterData.metricName?.toString() || "";
  const sanitized: Dictionary<DictionaryEntryValue> | undefined =
    sanitizeAttributeFilters(
      queryConfig.metricQueryData.filterData.attributes as
        | Dictionary<DictionaryEntryValue>
        | undefined,
    );
  return `${metricName}::${MetricUtil.serializeAttributeFiltersForKey(sanitized)}`;
}

function getXAxisAggregationTypeForQuery(
  queryConfig: MetricQueryConfigData,
): XAxisAggregateType {
  const aggregationType: MetricsAggregationType | undefined = queryConfig
    .metricQueryData.filterData.aggegationType as
    | MetricsAggregationType
    | undefined;

  if (
    aggregationType === MetricsAggregationType.Sum ||
    aggregationType === MetricsAggregationType.Count
  ) {
    return XAxisAggregateType.Sum;
  }
  if (aggregationType === MetricsAggregationType.Max) {
    return XAxisAggregateType.Max;
  }
  if (aggregationType === MetricsAggregationType.Min) {
    return XAxisAggregateType.Min;
  }
  return XAxisAggregateType.Average;
}

function getChartTypeForConfig(
  chartType: MetricChartType | undefined,
): ChartType {
  if (chartType === MetricChartType.BAR) {
    return ChartType.BAR;
  }
  if (chartType === MetricChartType.LINE) {
    return ChartType.LINE;
  }
  return ChartType.AREA;
}

/*
 * Warning/critical threshold reference lines. Shared by query panels
 * (each overlaid query contributes its own thresholds, formatted in its
 * own display unit) and formula charts.
 */
function buildThresholdReferenceLines(input: {
  warningThreshold?: number | undefined;
  criticalThreshold?: number | undefined;
  unit: string;
  formatterOptions?: { metricName: string } | undefined;
}): Array<ChartReferenceLineProps> {
  const referenceLines: Array<ChartReferenceLineProps> = [];

  if (input.warningThreshold !== undefined && input.warningThreshold !== null) {
    referenceLines.push({
      value: input.warningThreshold,
      label: `Warning: ${ValueFormatter.formatValue(input.warningThreshold, input.unit, input.formatterOptions)}`,
      color: "#f59e0b", // amber
    });
  }

  if (
    input.criticalThreshold !== undefined &&
    input.criticalThreshold !== null
  ) {
    referenceLines.push({
      value: input.criticalThreshold,
      label: `Critical: ${ValueFormatter.formatValue(input.criticalThreshold, input.unit, input.formatterOptions)}`,
      color: "#ef4444", // red
    });
  }

  return referenceLines;
}

/*
 * Build one query's chart series from its aggregated result: the
 * grouped-series splitter (explicit getSeries, or synthesized from
 * groupByAttributeKeys), the optional per-datapoint value transform, and
 * the optional per-second rate transform. Extracted so overlay panels can
 * build each member query's series independently before merging.
 */
function buildQuerySeries(
  queryConfig: MetricQueryConfigData,
  result: AggregatedResult,
): Array<SeriesPoint> {
  const chartSeries: Array<SeriesPoint> = [];

  /*
   * If the user picked attribute keys to group by (e.g. host.name)
   * and no explicit getSeries was provided, synthesize one so the
   * chart splits rows into one line per unique label combination.
   * Without this, all groupByAttributeKeys series would collapse
   * onto a single line indistinguishable from whole-monitor mode.
   */
  const groupByAttributeKeys: Array<string> =
    queryConfig.metricQueryData.groupByAttributeKeys || [];

  const effectiveGetSeries:
    | ((data: AggregatedModel) => ChartSeries)
    | undefined = queryConfig.getSeries
    ? queryConfig.getSeries
    : groupByAttributeKeys.length > 0
      ? (item: AggregatedModel): ChartSeries => {
          const attributes: Record<string, unknown> =
            ((item as unknown as Dictionary<unknown>)["attributes"] as
              | Record<string, unknown>
              | undefined) || {};

          const parts: Array<string> = groupByAttributeKeys.map(
            (key: string) => {
              const value: unknown = attributes[key];
              const displayValue: string =
                value === undefined || value === null || value === ""
                  ? "(unset)"
                  : String(value);
              return `${key}=${displayValue}`;
            },
          );

          return {
            title: parts.join(", "),
          };
        }
      : undefined;

  /*
   * Optional per-datapoint value transform (e.g. divide K8s CPU
   * cores by the node's allocatable CPU to get a true percentage).
   * Reads grouped attributes off the datapoint, so it must run
   * before the series points are built.
   */
  const transformPointValue: (item: AggregatedModel) => number = (
    item: AggregatedModel,
  ): number => {
    return queryConfig.transformValue
      ? queryConfig.transformValue(item.value, item)
      : item.value;
  };

  if (effectiveGetSeries) {
    for (const item of result.data) {
      const series: ChartSeries = effectiveGetSeries(item);
      const seriesName: string = series.title;

      const existingSeries: SeriesPoint | undefined = chartSeries.find(
        (s: SeriesPoint) => {
          return s.seriesName === seriesName;
        },
      );

      if (existingSeries) {
        existingSeries.data.push({
          x: OneUptimeDate.fromString(item.timestamp),
          y: transformPointValue(item),
        });
      } else {
        const newSeries: SeriesPoint = {
          seriesName: seriesName,
          data: [
            {
              x: OneUptimeDate.fromString(item.timestamp),
              y: transformPointValue(item),
            },
          ],
        };

        chartSeries.push(newSeries);
      }
    }
  } else {
    chartSeries.push({
      seriesName:
        queryConfig.metricAliasData?.legend ||
        queryConfig.metricQueryData.filterData.metricName?.toString() ||
        "",
      data: result.data.map((item: AggregatedModel) => {
        return {
          x: OneUptimeDate.fromString(item.timestamp),
          y: transformPointValue(item),
        };
      }),
    });
  }

  /*
   * Cumulative-counter rate transform. OTel hostmetrics emits metrics
   * like `system.disk.io` and `system.network.io` as cumulative counters
   * (bytes since process start). Plotting the raw value gives a
   * monotonically-growing line that's hard to read. With
   * `transformAsRate`, each series is converted to a per-second rate
   * of change: `(yi - y(i-1)) / Δt`. Negative deltas — which happen
   * when the agent restarts and the counter resets to 0 — clamp to 0
   * so the chart doesn't show a spurious dive.
   */
  if (queryConfig.transformAsRate) {
    for (const series of chartSeries) {
      const sortedPoints: typeof series.data = [...series.data].sort(
        (a: { x: Date; y: number }, b: { x: Date; y: number }) => {
          return a.x.getTime() - b.x.getTime();
        },
      );
      const ratePoints: typeof series.data = [];
      for (let i: number = 1; i < sortedPoints.length; i++) {
        const current: { x: Date; y: number } = sortedPoints[i]!;
        const prev: { x: Date; y: number } = sortedPoints[i - 1]!;
        const dtSeconds: number =
          (current.x.getTime() - prev.x.getTime()) / 1000;
        if (dtSeconds <= 0) {
          continue;
        }
        const delta: number = current.y - prev.y;
        const rate: number = delta < 0 ? 0 : delta / dtSeconds;
        ratePoints.push({ x: current.x, y: rate });
      }
      series.data = ratePoints;
    }
  }

  return chartSeries;
}

// One query's contribution to a chart panel.
interface PanelMember {
  queryConfig: MetricQueryConfigData;
  // Position in metricViewData.queryConfigs (== index into metricResults).
  queryConfigIndex: number;
  result: AggregatedResult;
  series: Array<SeriesPoint>;
  // Effective display unit: metricAliasData.legendUnit || MetricType.unit.
  unit: string;
  metricName: string;
}

/*
 * A chart panel: one rendered chart card. Normally one query, but
 * consecutive queries with `overlayWithPreviousQuery` chain onto the
 * previous query's panel and share its axes.
 */
interface ChartPanel {
  id: string;
  members: Array<PanelMember>;
}

/*
 * Disambiguate series names that collide across a panel's member queries.
 * Within one query, rows of the same name merge into one series (that's
 * the grouped-series contract) — but across overlaid queries a name
 * collision means two DIFFERENT series (e.g. both queries left their
 * default legend, or both group by the same key values), so colliding
 * names are prefixed with the owning query's alias/legend. Non-colliding
 * names are left untouched.
 */
function applyPanelSeriesNaming(members: Array<PanelMember>): void {
  if (members.length <= 1) {
    return;
  }

  const memberCountByName: Map<string, number> = new Map<string, number>();
  for (const member of members) {
    const namesInMember: Set<string> = new Set<string>(
      member.series.map((series: SeriesPoint) => {
        return series.seriesName;
      }),
    );
    for (const name of namesInMember) {
      memberCountByName.set(name, (memberCountByName.get(name) || 0) + 1);
    }
  }

  members.forEach((member: PanelMember, memberIndex: number) => {
    const label: string =
      member.queryConfig.metricAliasData?.legend ||
      member.metricName ||
      `Query ${memberIndex + 1}`;
    for (const series of member.series) {
      if ((memberCountByName.get(series.seriesName) || 0) <= 1) {
        continue;
      }
      /*
       * When the series name IS the query label (the ungrouped default is
       * legend||metricName), prefixing would just double it — disambiguate
       * with the query variable (or position) instead.
       */
      series.seriesName =
        label === series.seriesName
          ? `${series.seriesName} (${member.queryConfig.metricAliasData?.metricVariable || String(memberIndex + 1)})`
          : `${label}: ${series.seriesName}`;
    }
  });
}

/**
 * Render the per-chart control panel for a high-cardinality metric
 * chart. Combines a compact toolbar (search, Top-N selector, show-all
 * toggle, reset hidden) with an interactive colored legend that doubles
 * as the chart's legend — the Recharts built-in legend is suppressed when
 * this panel is present (see ChartGroup). Each chip shows the same
 * color as its line on the chart, and clicking a chip toggles
 * visibility so users can isolate one series out of hundreds.
 */
function renderSeriesControls(input: {
  chartId: string;
  controls: SeriesControlsState;
  updateControls: (
    chartId: string,
    updates: Partial<SeriesControlsState>,
  ) => void;
  fullSeries: Array<SeriesPoint>;
  displayableSeries: Array<SeriesPoint>;
  totalSeries: number;
  hiddenFromTopN: number;
  needsTopN: boolean;
  // Effective Top-N cap for this chart (query topN or the default).
  effectiveTopN: number;
  // Whether the Top-N cap is currently lifted (client toggle or topN write).
  isShowAllActive: boolean;
  onToggleShowAll: () => void;
  /*
   * When set, renders the Top-N count selector (5/10/25/50) — provided by
   * query panels, which persist the choice as `metricQueryData.topN`.
   * Formula charts (client-side evaluation, nothing to refetch) omit it.
   */
  onTopNChange?: ((topN: number) => void) | undefined;
  /*
   * Total number of matching groups reported by the server's Top-K
   * ranking phase — drives the "Showing top k of N series" banner when
   * it exceeds what was fetched.
   */
  serverTotalGroups?: number | undefined;
  // Result hit a server LIMIT without Top-K metadata — completeness unknown.
  serverTruncatedWithoutTopK?: boolean | undefined;
  /*
   * Maps a displayed series (by name + display position) to the exact
   * color the chart renders it in, so chips and lines always agree.
   */
  resolveColor: SeriesColorResolver;
  /*
   * Rendered in the panel's reserved meta slot — used for the
   * mixed-display-unit warning on overlay panels.
   */
  warningElement?: ReactElement | undefined;
  /*
   * Human-readable display unit shown as the panel's unit badge. Empty
   * string hides the badge (dimensionless metrics).
   */
  unitLabel: string;
  /*
   * Formats a series value (peak/avg/latest) for display next to its name,
   * using the same unit/precision as the chart's y-axis.
   */
  valueFormatter: (value: number) => string;
}): ReactElement {
  const {
    chartId,
    controls,
    updateControls,
    fullSeries,
    displayableSeries,
    totalSeries,
    hiddenFromTopN,
    needsTopN,
    effectiveTopN,
    isShowAllActive,
    onToggleShowAll,
    onTopNChange,
    serverTotalGroups,
    serverTruncatedWithoutTopK,
    resolveColor,
    warningElement,
    unitLabel,
    valueFormatter,
  } = input;

  const sortBy: SeriesSortBy = controls.sortBy;
  /*
   * The value shown next to each node reflects the active sort. Name sort
   * has no value of its own, so we still show peak — the most useful "how
   * high did this get" number.
   */
  const displayStat: SeriesValueStat = getRankingStat(sortBy);
  const rankedByLabel: string =
    SERIES_SORT_OPTIONS.find((option: SeriesSortOption) => {
      return option.key === sortBy;
    })?.rankedByLabel || "peak value";

  /*
   * Map each currently-rendered series to the same color the chart
   * assigned it (position-based over the displayed series). Series that
   * aren't on the chart right now (hidden by user or filtered out) get
   * no color and render as a muted dot below.
   */
  const colorByName: Map<string, ChartColorValue> = new Map<
    string,
    ChartColorValue
  >();
  displayableSeries.forEach((series: SeriesPoint, i: number) => {
    colorByName.set(series.seriesName, resolveColor(series.seriesName, i));
  });

  /*
   * Chips mirror the search filter too — otherwise typing "foo" would
   * narrow the chart but leave a noisy, unrelated chip row above.
   */
  const searchQuery: string = controls.searchQuery.trim().toLowerCase();
  const seriesForChips: Array<SeriesPoint> =
    searchQuery === ""
      ? fullSeries
      : fullSeries.filter((s: SeriesPoint) => {
          return s.seriesName.toLowerCase().includes(searchQuery);
        });

  /*
   * Top-N is picked from the value-ranked list, then the chips are ordered
   * by the user's chosen sort (default: peak value, highest first) so the
   * node with the highest value sits at the top of the list. Ordering the
   * node list — not the chart series — is what keeps line colors stable
   * across refreshes (colors are assigned by chart-series position).
   */
  const visibleForChips: Array<SeriesPoint> = sortSeriesForDisplay(
    isShowAllActive ? seriesForChips : seriesForChips.slice(0, effectiveTopN),
    sortBy,
  );

  const toggleSeries: (seriesName: string) => void = (
    seriesName: string,
  ): void => {
    const next: Set<string> = new Set<string>(controls.hiddenSeries);
    if (next.has(seriesName)) {
      next.delete(seriesName);
    } else {
      next.add(seriesName);
    }
    updateControls(chartId, { hiddenSeries: next });
  };

  const serverHasMoreSeries: boolean =
    serverTotalGroups !== undefined && serverTotalGroups > totalSeries;

  const hasStatus: boolean =
    hiddenFromTopN > 0 || controls.hiddenSeries.size > 0;

  const visibleCount: number = displayableSeries.length;

  /*
   * Every visible series was hidden via the legend (not by a search
   * filter, which has its own "no match" message) — the chart body above
   * is empty, so say why.
   */
  const allSeriesHidden: boolean =
    visibleCount === 0 &&
    totalSeries > 0 &&
    controls.hiddenSeries.size > 0 &&
    searchQuery === "";

  // Single-series charts keep the meta strip + legend chip but skip the
  // search/sort toolbar — there is nothing to filter or rank.
  const showToolbar: boolean =
    totalSeries > 1 ||
    needsTopN ||
    isShowAllActive ||
    controls.hiddenSeries.size > 0;

  /*
   * Label the show-all toggle with the true group count when the server
   * told us it kept only the top K of a larger set.
   */
  const showAllCount: number = serverHasMoreSeries
    ? serverTotalGroups!
    : totalSeries;
  const revertTopNLabel: number =
    effectiveTopN >= SHOW_ALL_SERIES_TOP_N
      ? DEFAULT_TOP_N_SERIES
      : effectiveTopN;

  const topNSelectValue: string =
    effectiveTopN >= SHOW_ALL_SERIES_TOP_N ? "all" : String(effectiveTopN);
  const topNChoices: Array<number> = TOP_N_CHOICES.includes(effectiveTopN)
    ? TOP_N_CHOICES
    : effectiveTopN >= SHOW_ALL_SERIES_TOP_N
      ? TOP_N_CHOICES
      : [...TOP_N_CHOICES, effectiveTopN].sort((a: number, b: number) => {
          return a - b;
        });

  return (
    <div className="space-y-2">
      {/*
       * Reserved meta slot — unit badge, series count, and every
       * truncation/mismatch banner live here so they always appear in
       * the same place instead of floating between controls.
       */}
      <div className="flex flex-wrap items-center gap-2">
        {unitLabel ? (
          <span className="text-xs text-gray-500">{unitLabel}</span>
        ) : null}
        <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
          {totalSeries} series
        </span>
        {serverHasMoreSeries ? (
          <span className="text-xs text-gray-500">
            Showing top{" "}
            <span className="font-medium text-gray-700">{totalSeries}</span> of{" "}
            <span className="font-medium text-gray-700">
              {serverTotalGroups}
            </span>{" "}
            series
          </span>
        ) : null}
        {serverTruncatedWithoutTopK ? (
          <HintChip variant="amber">
            Results truncated by server row limit — data may be incomplete.
          </HintChip>
        ) : null}
        {warningElement || null}
      </div>

      {allSeriesHidden ? (
        <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-center">
          <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-gray-100">
            <Icon icon={IconProp.EyeSlash} className="h-4 w-4 text-gray-400" />
          </div>
          <p className="mt-2 text-sm font-medium text-gray-900">
            All series hidden
          </p>
          <p className="mt-0.5 text-xs text-gray-500">
            Every series on this chart is hidden — click a series below to show
            it again.
          </p>
          <button
            type="button"
            className="mt-3 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
            onClick={(): void => {
              updateControls(chartId, { hiddenSeries: new Set<string>() });
            }}
          >
            Show all series
          </button>
        </div>
      ) : null}

      {showToolbar ? (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <svg
              aria-hidden="true"
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M9 3.5a5.5 5.5 0 1 0 3.352 9.858l3.645 3.645a.75.75 0 1 0 1.06-1.06l-3.644-3.645A5.5 5.5 0 0 0 9 3.5ZM5 9a4 4 0 1 1 8 0 4 4 0 0 1-8 0Z"
              />
            </svg>
            <input
              type="text"
              value={controls.searchQuery}
              aria-label="Filter series by name"
              onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
                updateControls(chartId, { searchQuery: e.target.value });
              }}
              placeholder={`Filter ${totalSeries} series`}
              className="w-full rounded-md border border-gray-200 bg-white pl-8 pr-3 py-1.5 text-xs text-gray-700 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor={`series-sort-${chartId}`} className="sr-only">
              Sort series by
            </label>
            <select
              id={`series-sort-${chartId}`}
              value={sortBy}
              title="Sort the node list by"
              onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
                updateControls(chartId, {
                  sortBy: e.target.value as SeriesSortBy,
                });
              }}
              className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
            >
              {SERIES_SORT_OPTIONS.map((option: SeriesSortOption) => {
                return (
                  <option key={option.key} value={option.key}>
                    {`Sort: ${option.label}`}
                  </option>
                );
              })}
            </select>
            {onTopNChange &&
            (needsTopN ||
              isShowAllActive ||
              effectiveTopN !== DEFAULT_TOP_N_SERIES) ? (
              <>
                <label htmlFor={`series-top-n-${chartId}`} className="sr-only">
                  Number of series to show
                </label>
                <select
                  id={`series-top-n-${chartId}`}
                  value={topNSelectValue}
                  title="How many series to fetch and plot"
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
                    if (e.target.value === "all") {
                      return;
                    }
                    onTopNChange(Number(e.target.value));
                  }}
                  className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                >
                  {topNChoices.map((choice: number) => {
                    return (
                      <option key={choice} value={String(choice)}>
                        {`Top ${choice}`}
                      </option>
                    );
                  })}
                  {topNSelectValue === "all" ? (
                    <option value="all">All series</option>
                  ) : null}
                </select>
              </>
            ) : null}
            {needsTopN || isShowAllActive ? (
              <button
                type="button"
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={(): void => {
                  onToggleShowAll();
                }}
              >
                {isShowAllActive
                  ? `Top ${revertTopNLabel}`
                  : `Show all ${showAllCount}`}
              </button>
            ) : null}
            {controls.hiddenSeries.size > 0 ? (
              <button
                type="button"
                className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                onClick={(): void => {
                  updateControls(chartId, {
                    hiddenSeries: new Set<string>(),
                  });
                }}
              >
                Show {controls.hiddenSeries.size} hidden
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {hasStatus ? (
        <div className="text-xs text-gray-500">
          <span className="font-medium text-gray-700">{visibleCount}</span>
          <span> of </span>
          <span className="font-medium text-gray-700">{totalSeries}</span>
          <span> series shown</span>
          {hiddenFromTopN > 0 ? (
            <span className="text-gray-400"> · ranked by {rankedByLabel}</span>
          ) : null}
          {controls.hiddenSeries.size > 0 ? (
            <span className="text-gray-400">
              {" "}
              · {controls.hiddenSeries.size} hidden
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 max-h-16 overflow-y-auto">
        {visibleForChips.length === 0 ? (
          <div className="py-1 text-xs italic text-gray-400">
            No series match &ldquo;{controls.searchQuery}&rdquo;
          </div>
        ) : (
          visibleForChips.map((series: SeriesPoint) => {
            const isHidden: boolean = controls.hiddenSeries.has(
              series.seriesName,
            );
            const color: ChartColorValue | undefined = colorByName.get(
              series.seriesName,
            );
            const showColor: boolean = Boolean(color) && !isHidden;
            const showCustomColor: boolean =
              showColor && isHexColorValue(color);
            const statValue: number | null = computeSeriesStat(
              series,
              displayStat,
            );
            const valueLabel: string | null =
              statValue === null ? null : valueFormatter(statValue);
            return (
              <button
                key={series.seriesName}
                type="button"
                aria-pressed={!isHidden}
                onClick={(): void => {
                  toggleSeries(series.seriesName);
                }}
                className={`group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                  isHidden
                    ? "border-gray-100 bg-white text-gray-400 hover:border-gray-200 hover:text-gray-500"
                    : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50 hover:text-gray-900"
                }`}
                title={
                  isHidden
                    ? `${series.seriesName} — click to show`
                    : `${series.seriesName} — click to hide`
                }
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    showColor
                      ? showCustomColor
                        ? ""
                        : getColorClassName(color!, "bg")
                      : "bg-gray-300"
                  }`}
                  style={
                    showCustomColor
                      ? { backgroundColor: getColorHex(color!) }
                      : undefined
                  }
                />
                <span
                  className={`max-w-[240px] truncate ${
                    isHidden ? "line-through" : ""
                  }`}
                >
                  {series.seriesName}
                </span>
                {valueLabel !== null ? (
                  <span
                    className={`shrink-0 tabular-nums font-medium ${
                      isHidden ? "text-gray-300" : "text-gray-500"
                    }`}
                  >
                    {valueLabel}
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

const MetricCharts: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Exemplar data keyed by (metric name + sanitized attribute filters) —
   * see getExemplarStateKey. Two differently-filtered charts of the same
   * metric get their own (matching) dot sets; identically-filtered charts
   * share one fetch.
   */
  const [exemplarsByQueryKey, setExemplarsByQueryKey] = useState<
    Record<string, Array<ExemplarPoint>>
  >({});

  // Per-chart controls (search, hidden set, show-all) keyed by chart id.
  const [seriesControlsByChart, setSeriesControlsByChart] = useState<
    Record<string, SeriesControlsState>
  >({});

  const getControls: (chartId: string) => SeriesControlsState = (
    chartId: string,
  ): SeriesControlsState => {
    return seriesControlsByChart[chartId] || defaultSeriesControlsState;
  };

  const updateControls: (
    chartId: string,
    updates: Partial<SeriesControlsState>,
  ) => void = (
    chartId: string,
    updates: Partial<SeriesControlsState>,
  ): void => {
    setSeriesControlsByChart((prev: Record<string, SeriesControlsState>) => {
      const current: SeriesControlsState =
        prev[chartId] || defaultSeriesControlsState;
      return {
        ...prev,
        [chartId]: { ...current, ...updates },
      };
    });
  };

  /*
   * Build a stable dependency for the exemplar effect. Previously this
   * depended on `props.metricViewData.queryConfigs` (a fresh array on
   * every parent render) which kicked off N exemplar requests per
   * widget per re-render. We now key off the start/end timestamps and
   * the deduplicated set of (metric name + sanitized filters) targets —
   * re-runs only when the time window, metric set, or filters actually
   * change.
   */
  const startMs: number | undefined =
    props.metricViewData.startAndEndDate?.startValue instanceof Date
      ? (props.metricViewData.startAndEndDate.startValue as Date).getTime()
      : undefined;
  const endMs: number | undefined =
    props.metricViewData.startAndEndDate?.endValue instanceof Date
      ? (props.metricViewData.startAndEndDate.endValue as Date).getTime()
      : undefined;

  interface ExemplarTarget {
    key: string;
    metricName: string;
    attributes: Dictionary<DictionaryEntryValue> | undefined;
  }

  const exemplarTargets: Array<ExemplarTarget> = (() => {
    const targetsByKey: Map<string, ExemplarTarget> = new Map<
      string,
      ExemplarTarget
    >();
    for (const queryConfig of props.metricViewData.queryConfigs) {
      const metricName: string =
        queryConfig.metricQueryData.filterData.metricName?.toString() || "";
      if (!metricName) {
        continue;
      }
      const key: string = getExemplarStateKey(queryConfig);
      if (targetsByKey.has(key)) {
        continue;
      }
      targetsByKey.set(key, {
        key,
        metricName,
        attributes: sanitizeAttributeFilters(
          queryConfig.metricQueryData.filterData.attributes as
            | Dictionary<DictionaryEntryValue>
            | undefined,
        ),
      });
    }
    return Array.from(targetsByKey.values());
  })();

  const exemplarTargetsKey: string = exemplarTargets
    .map((target: ExemplarTarget) => {
      return target.key;
    })
    .sort()
    .join("\n");

  useEffect(() => {
    if (startMs === undefined || endMs === undefined) {
      return;
    }

    if (exemplarTargets.length === 0) {
      return;
    }

    const startAndEndDate: InBetween<Date> = new InBetween<Date>(
      new Date(startMs),
      new Date(endMs),
    );

    /*
     * Fetch exemplars once per unique (metric name + sanitized filters)
     * pair — identically-configured charts share one request, while
     * differently-filtered charts of the same metric each get dots that
     * match the rows they actually plot.
     */
    for (const target of exemplarTargets) {
      MetricUtil.fetchExemplars({
        metricName: target.metricName,
        startAndEndDate,
        attributes: target.attributes,
      })
        .then((exemplars: Array<ExemplarPoint>) => {
          setExemplarsByQueryKey(
            (prev: Record<string, Array<ExemplarPoint>>) => {
              return {
                ...prev,
                [target.key]: exemplars,
              };
            },
          );
        })
        .catch(() => {
          // Best-effort: don't break charts if exemplar fetch fails
        });
    }
  }, [startMs, endMs, exemplarTargetsKey]);

  const handleExemplarClick: (exemplar: ExemplarPoint) => void = useCallback(
    (exemplar: ExemplarPoint): void => {
      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.TRACE_VIEW]!,
        {
          modelId: exemplar.traceId,
        },
      );

      if (exemplar.spanId) {
        const routeWithQuery: Route = new Route(route.toString());
        routeWithQuery.addQueryParams({ spanId: exemplar.spanId });
        Navigation.navigate(routeWithQuery);
      } else {
        Navigation.navigate(route);
      }
    },
    [],
  );

  type GetChartXAxisTypeFunction = () => XAxisType;

  const getChartXAxisType: GetChartXAxisTypeFunction = (): XAxisType => {
    if (
      props.metricViewData.startAndEndDate?.startValue &&
      props.metricViewData.startAndEndDate?.endValue
    ) {
      const hourDifference: number = OneUptimeDate.getHoursBetweenTwoDates(
        props.metricViewData.startAndEndDate.startValue as Date,
        props.metricViewData.startAndEndDate.endValue as Date,
      );

      if (hourDifference <= 24) {
        return XAxisType.Time;
      }
    }

    return XAxisType.Date;
  };

  /*
   * Write a new Top-N onto every member query of a panel. Preferred path:
   * hand the parent a full replacement queryConfigs array (persists
   * `metricQueryData.topN` and triggers the parent's fetch). Fallback when
   * no parent hook is wired (read-only chart surfaces): register transient
   * overrides that Utils/Metrics.fetchResults applies on the NEXT fetch.
   */
  const writePanelTopN: (
    members: Array<PanelMember>,
    topN: number | undefined,
  ) => void = (members: Array<PanelMember>, topN: number | undefined): void => {
    if (props.onQueryConfigsChange) {
      const memberIndexes: Set<number> = new Set<number>(
        members.map((member: PanelMember) => {
          return member.queryConfigIndex;
        }),
      );
      const updatedQueryConfigs: Array<MetricQueryConfigData> =
        props.metricViewData.queryConfigs.map(
          (queryConfig: MetricQueryConfigData, index: number) => {
            if (!memberIndexes.has(index)) {
              return queryConfig;
            }
            return {
              ...queryConfig,
              metricQueryData: {
                ...queryConfig.metricQueryData,
                topN,
              },
            };
          },
        );
      props.onQueryConfigsChange(updatedQueryConfigs);
      return;
    }

    for (const member of members) {
      MetricUtil.setQueryTopNOverride(
        MetricUtil.getQueryConfigTopNKey(
          member.queryConfig,
          member.queryConfigIndex,
        ),
        topN,
      );
    }
  };

  /*
   * Shared display pipeline for one chart's series: rank by the active
   * value stat (so breaching series are retained by the Top-N cut), apply
   * the user's search filter, hidden set, and Top-N cap, then restore a
   * stable natural-name order (colors are assigned by chart-series
   * position, so a value-ordered chart would reshuffle every series'
   * color whenever the ranking changed on refresh). Also builds the
   * controls panel. Used by query panels and formula charts alike.
   */
  const buildSeriesPresentation: (input: {
    chartId: string;
    allSeries: Array<SeriesPoint>;
    effectiveTopN: number;
    makeResolveColor: (
      displayableSeries: Array<SeriesPoint>,
    ) => SeriesColorResolver;
    hasColorCustomization: boolean;
    unitLabel: string;
    valueFormatter: (value: number) => string;
    onShowAllToggled?: ((nextShowAll: boolean) => void) | undefined;
    onTopNChange?: ((topN: number) => void) | undefined;
    serverTotalGroups?: number | undefined;
    serverTruncatedWithoutTopK?: boolean | undefined;
    warningElement?: ReactElement | undefined;
  }) => {
    displayableSeries: Array<SeriesPoint>;
    colorsOverride: Array<ChartColorValue> | undefined;
    seriesControls: ReactElement | undefined;
  } = (input: {
    chartId: string;
    allSeries: Array<SeriesPoint>;
    effectiveTopN: number;
    makeResolveColor: (
      displayableSeries: Array<SeriesPoint>,
    ) => SeriesColorResolver;
    hasColorCustomization: boolean;
    unitLabel: string;
    valueFormatter: (value: number) => string;
    onShowAllToggled?: ((nextShowAll: boolean) => void) | undefined;
    onTopNChange?: ((topN: number) => void) | undefined;
    serverTotalGroups?: number | undefined;
    serverTruncatedWithoutTopK?: boolean | undefined;
    warningElement?: ReactElement | undefined;
  }): {
    displayableSeries: Array<SeriesPoint>;
    colorsOverride: Array<ChartColorValue> | undefined;
    seriesControls: ReactElement | undefined;
  } => {
    const controls: SeriesControlsState = getControls(input.chartId);
    const rankingStat: SeriesValueStat = getRankingStat(controls.sortBy);
    const rankedSeries: Array<SeriesPoint> = sortSeriesForDisplay(
      input.allSeries,
      rankingStat,
    );

    const totalSeries: number = rankedSeries.length;
    const isShowAllActive: boolean =
      controls.showAllSeries || input.effectiveTopN >= SHOW_ALL_SERIES_TOP_N;
    const serverHasMoreSeries: boolean =
      input.serverTotalGroups !== undefined &&
      input.serverTotalGroups > totalSeries;
    const needsTopN: boolean =
      totalSeries > input.effectiveTopN || serverHasMoreSeries;

    let displayableSeries: Array<SeriesPoint> = rankedSeries;

    if (controls.searchQuery.trim() !== "") {
      const q: string = controls.searchQuery.toLowerCase();
      displayableSeries = displayableSeries.filter((s: SeriesPoint) => {
        return s.seriesName.toLowerCase().includes(q);
      });
    }

    if (controls.hiddenSeries.size > 0) {
      displayableSeries = displayableSeries.filter((s: SeriesPoint) => {
        return !controls.hiddenSeries.has(s.seriesName);
      });
    }

    const topNCutApplied: boolean =
      totalSeries > input.effectiveTopN && !isShowAllActive;

    if (topNCutApplied) {
      displayableSeries = displayableSeries.slice(0, input.effectiveTopN);
    }

    displayableSeries = displayableSeries.slice().sort(compareSeriesByName);

    const resolveColor: SeriesColorResolver =
      input.makeResolveColor(displayableSeries);

    const colorsOverride: Array<ChartColorValue> | undefined =
      input.hasColorCustomization
        ? displayableSeries.map((s: SeriesPoint, i: number) => {
            return resolveColor(s.seriesName, i);
          })
        : undefined;

    const hiddenFromTopN: number = topNCutApplied
      ? Math.max(0, totalSeries - input.effectiveTopN)
      : 0;

    const onToggleShowAll: () => void = (): void => {
      const nextShowAll: boolean = !isShowAllActive;
      updateControls(input.chartId, { showAllSeries: nextShowAll });
      input.onShowAllToggled?.(nextShowAll);
    };

    /*
     * The controls panel doubles as the chart's reserved meta slot (unit
     * badge, series count, truncation banners) and its legend, so it
     * renders whenever the chart has series at all — single-series charts
     * just skip the search/sort toolbar inside it.
     */
    const showControls: boolean =
      totalSeries > 0 ||
      serverHasMoreSeries ||
      Boolean(input.serverTruncatedWithoutTopK) ||
      Boolean(input.warningElement);

    const seriesControls: ReactElement | undefined = showControls
      ? renderSeriesControls({
          chartId: input.chartId,
          controls,
          updateControls,
          fullSeries: rankedSeries,
          displayableSeries,
          totalSeries,
          hiddenFromTopN,
          needsTopN,
          effectiveTopN: input.effectiveTopN,
          isShowAllActive,
          onToggleShowAll,
          onTopNChange: input.onTopNChange,
          serverTotalGroups: input.serverTotalGroups,
          serverTruncatedWithoutTopK: input.serverTruncatedWithoutTopK,
          resolveColor,
          warningElement: input.warningElement,
          unitLabel: input.unitLabel,
          valueFormatter: input.valueFormatter,
        })
      : undefined;

    return { displayableSeries, colorsOverride, seriesControls };
  };

  type GetChartsFunction = () => Array<Chart>;

  const getCharts: GetChartsFunction = (): Array<Chart> => {
    const charts: Array<Chart> = [];

    if (!props.metricResults) {
      return [];
    }

    /*
     * Group queries into chart panels. Normally one query = one panel;
     * a query flagged `overlayWithPreviousQuery` chains onto the
     * previous query's panel so both plot on shared axes. Panel (and
     * per-chart state) identity comes from the FIRST member's stable id,
     * so removing/reordering queries doesn't transfer one chart's
     * hidden-series/search state to another.
     */
    const usedChartIds: Set<string> = new Set<string>();
    const panels: Array<ChartPanel> = [];
    let previousPanel: ChartPanel | null = null;

    props.metricViewData.queryConfigs.forEach(
      (queryConfig: MetricQueryConfigData, queryConfigIndex: number) => {
        const result: AggregatedResult | undefined =
          props.metricResults[queryConfigIndex];
        if (!result) {
          previousPanel = null;
          return;
        }

        const metricType: MetricType | undefined = props.metricTypes.find(
          (m: MetricType) => {
            return m.name === queryConfig.metricQueryData.filterData.metricName;
          },
        );

        const member: PanelMember = {
          queryConfig,
          queryConfigIndex,
          result,
          series: buildQuerySeries(queryConfig, result),
          unit:
            queryConfig.metricAliasData?.legendUnit || metricType?.unit || "",
          metricName:
            queryConfig.metricQueryData.filterData.metricName?.toString() || "",
        };

        if (queryConfig.overlayWithPreviousQuery === true && previousPanel) {
          previousPanel.members.push(member);
          return;
        }

        const panel: ChartPanel = {
          id: dedupeChartId(
            getStableQueryChartId(queryConfig, queryConfigIndex),
            usedChartIds,
          ),
          members: [member],
        };
        panels.push(panel);
        previousPanel = panel;
      },
    );

    for (const panel of panels) {
      const members: Array<PanelMember> = panel.members;
      const firstMember: PanelMember = members[0]!;
      const firstQuery: MetricQueryConfigData = firstMember.queryConfig;

      applyPanelSeriesNaming(members);

      /*
       * Merged panel series + owner lookup (which member query a series
       * came from) — the owner drives per-series color pins and threshold
       * attribution for overlay panels.
       */
      const panelSeries: Array<SeriesPoint> = [];
      const seriesOwnerByName: Map<string, PanelMember> = new Map<
        string,
        PanelMember
      >();
      for (const member of members) {
        for (const series of member.series) {
          panelSeries.push(series);
          seriesOwnerByName.set(series.seriesName, member);
        }
      }

      /*
       * Per-panel singletons resolve first-query-wins: chart type, x-axis
       * aggregation, display unit / y-axis formatter, and the percent-scale
       * heuristics below all come from the panel's first query.
       */
      const xAxisAggregationType: XAxisAggregateType =
        getXAxisAggregationTypeForQuery(firstQuery);
      const chartType: ChartType = getChartTypeForConfig(firstQuery.chartType);

      const unit: string = firstMember.unit;
      const queryMetricName: string = firstMember.metricName;
      const formatterOptions: { metricName: string } = {
        metricName: queryMetricName,
      };

      /*
       * Show "%" on the y-axis legend for any percent-like metric — both
       * OTel ratio names (`.utilization`, `.ratio`, …) reported with unit "1"
       * and explicit percent units like "%", "percent", "percentage", "pct".
       * Otherwise keep the raw unit code so other axes (e.g. "By", "ms") look
       * unchanged.
       */
      const isFractionScale: boolean =
        unit === "1" && ValueFormatter.isFractionMetric(queryMetricName);
      const isPercentChart: boolean =
        isFractionScale || ValueFormatter.isPercentUnit(unit);
      const yAxisLegend: string = isPercentChart ? "%" : unit;
      let yAxisMin: YScaleMaxMin = "auto";
      let yAxisMax: YScaleMaxMin = "auto";

      /*
       * Thresholds concatenate across the panel: every overlaid query's
       * warning/critical lines render, each formatted in its own unit.
       */
      const referenceLines: Array<ChartReferenceLineProps> = [];
      for (const member of members) {
        referenceLines.push(
          ...buildThresholdReferenceLines({
            warningThreshold: member.queryConfig.warningThreshold,
            criticalThreshold: member.queryConfig.criticalThreshold,
            unit: member.unit,
            formatterOptions: { metricName: member.metricName },
          }),
        );
      }

      /*
       * Unit safety for overlay panels: data arrives converted to each
       * query's display unit, so two members with different display units
       * share one axis but not one scale. Warn (don't block).
       */
      const distinctUnits: Array<string> = Array.from(
        new Set<string>(
          members
            .map((member: PanelMember) => {
              return member.unit;
            })
            .filter((memberUnit: string) => {
              return memberUnit !== "";
            }),
        ),
      );
      const unitMismatchWarning: ReactElement | undefined =
        distinctUnits.length > 1 ? (
          <HintChip variant="amber">
            Overlaid queries use different units ({distinctUnits.join(", ")}) —
            they share one axis, so values may not be directly comparable.
          </HintChip>
        ) : undefined;

      /*
       * Build metric info for the info icon modal (first query's).
       * Skip empty key/value entries and surface the operator alongside
       * the value so users can see what's actually filtered.
       */
      const metricAttributes: Dictionary<string> = {};
      const filterAttributes: Dictionary<unknown> | undefined = firstQuery
        .metricQueryData.filterData.attributes as
        | Dictionary<unknown>
        | undefined;

      if (filterAttributes) {
        for (const key of Object.keys(filterAttributes)) {
          const value: unknown = filterAttributes[key];
          if (key.trim() === "" || value === undefined || value === null) {
            continue;
          }
          const detected: {
            operator: DictionaryFilterOperator;
            rawValue: string;
          } = detectOperatorFromValue(value);
          const option: DictionaryFilterOperatorOption = getOperatorOption(
            detected.operator,
          );
          if (!option.hidesValueInput && detected.rawValue.trim() === "") {
            continue;
          }
          metricAttributes[key] = option.hidesValueInput
            ? option.symbol
            : `${option.symbol} ${detected.rawValue}`;
        }
      }

      const metricInfo: ChartMetricInfo = {
        metricName: queryMetricName,
        aggregationType:
          firstQuery.metricQueryData.filterData.aggegationType?.toString() ||
          "",
        attributes:
          Object.keys(metricAttributes).length > 0
            ? metricAttributes
            : undefined,
        groupByAttribute:
          firstQuery.metricQueryData.filterData.groupByAttribute?.toString(),
        unit,
      };

      /*
       * Exemplar dots: union across the panel's members, deduped (two
       * overlaid queries of the same metric+filters share one exemplar
       * set).
       */
      const chartExemplars: Array<ExemplarPoint> = [];
      const seenExemplarKeys: Set<string> = new Set<string>();
      for (const member of members) {
        const memberExemplars: Array<ExemplarPoint> =
          exemplarsByQueryKey[getExemplarStateKey(member.queryConfig)] || [];
        for (const exemplar of memberExemplars) {
          const exemplarKey: string = `${exemplar.traceId}-${exemplar.x.getTime()}-${exemplar.y}`;
          if (seenExemplarKeys.has(exemplarKey)) {
            continue;
          }
          seenExemplarKeys.add(exemplarKey);
          chartExemplars.push(exemplar);
        }
      }

      const chartId: string = panel.id;

      /*
       * Effective Top-N (display cap AND the server-side topK count the
       * fetch layer sends for grouped queries) — first-query-wins like the
       * other panel singletons; the write path below updates every member.
       */
      const effectiveTopN: number =
        getControls(chartId).topNOverride ??
        firstQuery.metricQueryData.topN ??
        DEFAULT_TOP_N_SERIES;

      /*
       * Server truncation metadata: totalGroups sums across members (each
       * member's grouped fetch reports its own group universe); a
       * truncated result WITHOUT totalGroups means a plain row-limit hit
       * whose completeness is unknown.
       */
      let serverTotalGroups: number | undefined = undefined;
      let serverTruncatedWithoutTopK: boolean = false;
      for (const member of members) {
        if (member.result.totalGroups !== undefined) {
          serverTotalGroups =
            (serverTotalGroups ?? 0) + member.result.totalGroups;
        } else if (member.result.truncated) {
          serverTruncatedWithoutTopK = true;
        }
      }

      /*
       * Per-series colors. Single-query panels keep the exact prior
       * behavior (per-group pins by "key=value" segment, then the query's
       * lead color heading the palette). Overlay panels compose: each
       * series resolves against its OWNING query's pins, the owner's lead
       * color goes to that query's first displayed series, and everything
       * else falls back to the shared palette by position.
       */
      const chartBasePalette: Array<AvailableChartColorsKeys> =
        getChartPalette(chartType);
      const hasColorCustomization: boolean = members.some(
        (member: PanelMember) => {
          return (
            Boolean(member.queryConfig.color) ||
            Object.keys(member.queryConfig.colorsByGroup || {}).length > 0
          );
        },
      );

      const makeResolveColor: (
        displayableSeries: Array<SeriesPoint>,
      ) => SeriesColorResolver = (
        displayableSeries: Array<SeriesPoint>,
      ): SeriesColorResolver => {
        if (members.length === 1) {
          const effectivePalette: Array<ChartColorValue> = firstQuery.color
            ? [firstQuery.color, ...chartBasePalette]
            : chartBasePalette;
          return (seriesName: string, index: number): ChartColorValue => {
            return resolveSeriesColor(seriesName, index, {
              colorsByGroup: firstQuery.colorsByGroup || {},
              effectivePalette,
              groupByKeys:
                firstQuery.metricQueryData.groupByAttributeKeys || [],
            });
          };
        }

        const firstDisplayIndexByOwner: Map<PanelMember, number> = new Map<
          PanelMember,
          number
        >();
        displayableSeries.forEach((series: SeriesPoint, index: number) => {
          const owner: PanelMember | undefined = seriesOwnerByName.get(
            series.seriesName,
          );
          if (owner && !firstDisplayIndexByOwner.has(owner)) {
            firstDisplayIndexByOwner.set(owner, index);
          }
        });

        return (seriesName: string, index: number): ChartColorValue => {
          const owner: PanelMember | undefined =
            seriesOwnerByName.get(seriesName);
          if (owner) {
            const pins: Record<string, string> =
              owner.queryConfig.colorsByGroup || {};
            const segments: Array<string> = splitSeriesNameIntoSegments(
              seriesName,
              owner.queryConfig.metricQueryData.groupByAttributeKeys || [],
            );
            for (const segment of segments) {
              const pinned: string | undefined = pins[segment];
              if (pinned) {
                return pinned;
              }
            }
            if (
              owner.queryConfig.color &&
              firstDisplayIndexByOwner.get(owner) === index
            ) {
              return owner.queryConfig.color;
            }
          }
          return chartBasePalette[index % chartBasePalette.length]!;
        };
      };

      /*
       * Formats a series value for the node list using the same unit and
       * precision as the chart's y-axis, so "52.75%" in the list matches
       * the axis and tooltip.
       */
      const seriesValueFormatter: (value: number) => string = (
        value: number,
      ): string => {
        if (firstQuery.yAxisValueFormatter) {
          return firstQuery.yAxisValueFormatter(value);
        }
        return ValueFormatter.formatValue(value, unit, formatterOptions);
      };

      const {
        displayableSeries,
        colorsOverride,
        seriesControls,
      }: {
        displayableSeries: Array<SeriesPoint>;
        colorsOverride: Array<ChartColorValue> | undefined;
        seriesControls: ReactElement | undefined;
      } = buildSeriesPresentation({
        chartId,
        allSeries: panelSeries,
        effectiveTopN,
        makeResolveColor,
        hasColorCustomization,
        unitLabel: unit
          ? ValueFormatter.getReadableUnit(unit, formatterOptions)
          : "",
        valueFormatter: seriesValueFormatter,
        onShowAllToggled: (nextShowAll: boolean): void => {
          /*
           * "Show all" is a refetch concern only when the server actually
           * held series back (topK truncation) — otherwise every series
           * is already client-side and the display toggle suffices.
           * Toggling back off a lifted topN reverts to the default cap.
           */
          if (nextShowAll) {
            if (
              serverTotalGroups !== undefined &&
              serverTotalGroups > panelSeries.length
            ) {
              writePanelTopN(members, SHOW_ALL_SERIES_TOP_N);
            }
          } else if (effectiveTopN >= SHOW_ALL_SERIES_TOP_N) {
            writePanelTopN(members, undefined);
          }
        },
        onTopNChange: (topN: number): void => {
          /*
           * Without a parent write-path, also track the choice locally so
           * the selector and the display cap respond immediately (the
           * transient fetch override only applies on the next fetch).
           */
          updateControls(chartId, {
            showAllSeries: false,
            ...(props.onQueryConfigsChange ? {} : { topNOverride: topN }),
          });
          writePanelTopN(members, topN);
        },
        serverTotalGroups,
        serverTruncatedWithoutTopK,
        warningElement: unitMismatchWarning,
      });

      /*
       * Soft 0–100% range computed from the currently visible series, so
       * hiding the dominant series via the legend rescales the axis to
       * what's actually on screen instead of staying anchored to the
       * peak of a hidden line. Default to the full percent scale so 25%
       * reads like 25% of the axis (not a peak). If a visible series
       * exceeds 100% — e.g. summed-across-cores or mis-tagged data —
       * expand to fit so nothing clips. If the visible data sits well
       * below 100% — e.g. a near-empty 120 GB disk at ~2% — auto-fit
       * to the data so the line is visible instead of hugging the bottom.
       * Negative values pull the floor below 0. The baseline differs by
       * data scale: utilization metrics live in [0, 1], explicit percent
       * units live in [0, 100].
       */
      if (isPercentChart) {
        const baseline: number = isFractionScale ? 1 : 100;
        let observedMax: number = Number.NEGATIVE_INFINITY;
        let observedMin: number = 0;
        let hasFinitePoint: boolean = false;
        for (const series of displayableSeries) {
          for (const point of series.data) {
            if (typeof point.y === "number" && Number.isFinite(point.y)) {
              hasFinitePoint = true;
              if (point.y > observedMax) {
                observedMax = point.y;
              }
              if (point.y < observedMin) {
                observedMin = point.y;
              }
            }
          }
        }
        if (!hasFinitePoint) {
          yAxisMax = baseline;
          yAxisMin = 0;
        } else if (observedMax < baseline * 0.25) {
          const headroom: number = observedMax > 0 ? observedMax * 0.25 : 0;
          yAxisMax = observedMax + headroom;
          yAxisMin = observedMin;
        } else {
          yAxisMax = Math.max(observedMax, baseline);
          yAxisMin = observedMin;
        }
      }

      const chart: Chart = {
        id: chartId,
        type: chartType,
        title:
          firstQuery.metricAliasData?.title ||
          firstQuery.metricAliasData?.legend ||
          queryMetricName ||
          "",
        description: firstQuery.metricAliasData?.description || "",
        metricInfo,
        exemplarPoints: chartExemplars.length > 0 ? chartExemplars : undefined,
        onExemplarClick: handleExemplarClick,
        seriesControls: seriesControls,
        props: {
          data: displayableSeries,
          xAxis: {
            legend: "Time",
            options: {
              type: getChartXAxisType(),
              max:
                props.metricViewData.startAndEndDate?.endValue ||
                OneUptimeDate.getCurrentDate(),
              min:
                props.metricViewData.startAndEndDate?.startValue ||
                OneUptimeDate.addRemoveHours(
                  OneUptimeDate.getCurrentDate(),
                  -1,
                ),
              aggregateType: xAxisAggregationType,
            },
          },
          yAxis: {
            legend: yAxisLegend,
            options: {
              type: YAxisType.Number,
              formatter: (value: number) => {
                if (firstQuery.yAxisValueFormatter) {
                  return firstQuery.yAxisValueFormatter(value);
                }

                return ValueFormatter.formatValue(
                  value,
                  unit,
                  formatterOptions,
                );
              },
              precision: YAxisPrecision.NoDecimals,
              max: yAxisMax,
              min: yAxisMin,
            },
          },
          curve: ChartCurve.MONOTONE,
          sync: true,
          colors: colorsOverride,
          referenceLines:
            referenceLines.length > 0 ? referenceLines : undefined,
          onTimeRangeSelect: props.onTimeRangeSelect,
          timeReferenceLines: props.timeReferenceLines,
          referenceRegions: props.referenceRegions,
        },
      };

      charts.push(chart);
    }

    /*
     * Render a chart for each formula, after the query charts. Results
     * for formulas live at indices [queryConfigs.length, queryConfigs.length + formulaConfigs.length)
     * in props.metricResults (Metrics.fetchResults appends them in order).
     */
    const formulaConfigs: Array<MetricFormulaConfigData> =
      props.metricViewData.formulaConfigs || [];

    for (
      let formulaIndex: number = 0;
      formulaIndex < formulaConfigs.length;
      formulaIndex++
    ) {
      const formulaConfig: MetricFormulaConfigData =
        formulaConfigs[formulaIndex]!;
      const resultsIndex: number =
        props.metricViewData.queryConfigs.length + formulaIndex;
      const formulaResult: AggregatedResult | undefined =
        props.metricResults[resultsIndex];

      if (!formulaResult) {
        continue;
      }

      const formulaExpression: string =
        formulaConfig.metricFormulaData?.metricFormula || "";

      const formulaChartType: ChartType = getChartTypeForConfig(
        formulaConfig.chartType,
      );

      const formulaUnit: string =
        formulaConfig.metricAliasData?.legendUnit || "";

      const formulaBaseName: string =
        formulaConfig.metricAliasData?.legend ||
        formulaConfig.metricAliasData?.title ||
        formulaExpression ||
        "Formula";

      const formulaChartVariable: string | undefined =
        formulaConfig.metricAliasData?.metricVariable;
      const formulaChartId: string = dedupeChartId(
        formulaChartVariable
          ? `formula-var-${formulaChartVariable}`
          : `formula-${formulaIndex}`,
        usedChartIds,
      );

      /*
       * Multi-series formulas: the evaluator stamps each output row with
       * the group's `attributes` (same shape grouped query rows use), so
       * split rows into one series per group — mirroring the query-chart
       * splitter — and let them flow through the same Top-N/legend
       * machinery. Ungrouped formulas keep their single named series.
       */
      const formulaGroupKeys: Array<string> = (() => {
        const keys: Set<string> = new Set<string>();
        for (const row of formulaResult.data) {
          const attributes: Record<string, unknown> | undefined = (
            row as unknown as Dictionary<unknown>
          )["attributes"] as Record<string, unknown> | undefined;
          if (attributes) {
            for (const key of Object.keys(attributes)) {
              keys.add(key);
            }
          }
        }
        return Array.from(keys).sort();
      })();

      const formulaAllSeries: Array<SeriesPoint> = [];

      if (formulaGroupKeys.length > 0) {
        for (const row of formulaResult.data) {
          const attributes: Record<string, unknown> =
            ((row as unknown as Dictionary<unknown>)["attributes"] as
              | Record<string, unknown>
              | undefined) || {};
          const seriesName: string = formulaGroupKeys
            .map((key: string) => {
              const value: unknown = attributes[key];
              const displayValue: string =
                value === undefined || value === null || value === ""
                  ? "(unset)"
                  : String(value);
              return `${key}=${displayValue}`;
            })
            .join(", ");

          const existingSeries: SeriesPoint | undefined = formulaAllSeries.find(
            (s: SeriesPoint) => {
              return s.seriesName === seriesName;
            },
          );

          const point: { x: Date; y: number } = {
            x: OneUptimeDate.fromString(row.timestamp),
            y: row.value,
          };

          if (existingSeries) {
            existingSeries.data.push(point);
          } else {
            formulaAllSeries.push({
              seriesName,
              data: [point],
            });
          }
        }
      } else {
        formulaAllSeries.push({
          seriesName: formulaBaseName,
          data: formulaResult.data.map((point: AggregatedModel) => {
            return {
              x: OneUptimeDate.fromString(point.timestamp),
              y: point.value,
            };
          }),
        });
      }

      const formulaReferenceLines: Array<ChartReferenceLineProps> =
        buildThresholdReferenceLines({
          warningThreshold: formulaConfig.warningThreshold,
          criticalThreshold: formulaConfig.criticalThreshold,
          unit: formulaUnit,
        });

      const formulaMetricInfo: ChartMetricInfo = {
        metricName:
          formulaConfig.metricAliasData?.title ||
          formulaExpression ||
          "Formula",
        aggregationType: "Formula",
        unit: formulaUnit,
      };

      const formulaBasePalette: Array<AvailableChartColorsKeys> =
        getChartPalette(formulaChartType);
      const formulaEffectivePalette: Array<ChartColorValue> =
        formulaConfig.color
          ? [formulaConfig.color, ...formulaBasePalette]
          : formulaBasePalette;

      /*
       * Structurally invalid formula (Metrics.fetchResults attaches the
       * evaluator's message): render the error in the chart slot instead
       * of a silent empty chart. The empty series keeps the chart body
       * rendering exactly like the old failure path.
       */
      const formulaHasError: boolean = Boolean(formulaResult.errorMessage);

      const {
        displayableSeries: formulaDisplayableSeries,
        colorsOverride: formulaColorsOverride,
        seriesControls: formulaSeriesControls,
      }: {
        displayableSeries: Array<SeriesPoint>;
        colorsOverride: Array<ChartColorValue> | undefined;
        seriesControls: ReactElement | undefined;
      } = formulaHasError
        ? {
            displayableSeries: [
              {
                seriesName: formulaBaseName,
                data: [],
              },
            ],
            colorsOverride: undefined,
            seriesControls: (
              <ErrorMessage
                message={`Formula error: ${formulaResult.errorMessage}`}
              />
            ),
          }
        : buildSeriesPresentation({
            chartId: formulaChartId,
            allSeries: formulaAllSeries,
            effectiveTopN: DEFAULT_TOP_N_SERIES,
            makeResolveColor: (): SeriesColorResolver => {
              return (seriesName: string, index: number): ChartColorValue => {
                return resolveSeriesColor(seriesName, index, {
                  colorsByGroup: {},
                  effectivePalette: formulaEffectivePalette,
                  groupByKeys: formulaGroupKeys,
                });
              };
            },
            hasColorCustomization: Boolean(formulaConfig.color),
            unitLabel: formulaUnit
              ? ValueFormatter.getReadableUnit(formulaUnit)
              : "",
            valueFormatter: (value: number): string => {
              return ValueFormatter.formatValue(value, formulaUnit);
            },
          });

      const formulaChart: Chart = {
        id: formulaChartId,
        type: formulaChartType,
        title:
          formulaConfig.metricAliasData?.title ||
          `Formula: ${formulaExpression}`,
        description:
          formulaConfig.metricAliasData?.description ||
          `Evaluates: ${formulaExpression}`,
        metricInfo: formulaMetricInfo,
        seriesControls: formulaSeriesControls,
        props: {
          data: formulaDisplayableSeries,
          xAxis: {
            legend: "Time",
            options: {
              type: getChartXAxisType(),
              max:
                props.metricViewData.startAndEndDate?.endValue ||
                OneUptimeDate.getCurrentDate(),
              min:
                props.metricViewData.startAndEndDate?.startValue ||
                OneUptimeDate.addRemoveHours(
                  OneUptimeDate.getCurrentDate(),
                  -1,
                ),
              aggregateType: XAxisAggregateType.Average,
            },
          },
          yAxis: {
            legend: formulaUnit,
            options: {
              type: YAxisType.Number,
              formatter: (value: number) => {
                return ValueFormatter.formatValue(value, formulaUnit);
              },
              precision: YAxisPrecision.NoDecimals,
              max: "auto",
              min: "auto",
            },
          },
          curve: ChartCurve.MONOTONE,
          sync: true,
          colors: formulaColorsOverride,
          referenceLines:
            formulaReferenceLines.length > 0
              ? formulaReferenceLines
              : undefined,
          onTimeRangeSelect: props.onTimeRangeSelect,
          timeReferenceLines: props.timeReferenceLines,
          referenceRegions: props.referenceRegions,
        },
      };

      charts.push(formulaChart);
    }

    return charts;
  };

  return (
    <ChartGroup
      charts={getCharts()}
      hideCard={props.hideCard}
      chartCssClass={props.chartCssClass}
    />
  );
};

export default MetricCharts;
