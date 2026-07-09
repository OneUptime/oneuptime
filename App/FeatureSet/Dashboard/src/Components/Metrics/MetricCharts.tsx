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
import {
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
import ExemplarPoint from "Common/UI/Components/Charts/Types/ExemplarPoint";
import ValueFormatter from "Common/Utils/ValueFormatter";
import {
  AvailableChartColorsKeys,
  getColorClassName,
} from "Common/UI/Components/Charts/ChartLibrary/Utils/ChartColors";
import { LineChartPalette } from "Common/UI/Components/Charts/Line/LineChart";
import { AreaChartPalette } from "Common/UI/Components/Charts/Area/AreaChart";
import { BarChartPalette } from "Common/UI/Components/Charts/Bar/BarChart";
import MetricUtil from "./Utils/Metrics";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import {
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
}

/*
 * Default cap on visible series per chart. Above this, we keep the
 * top-K by peak value and surface a "Show all N" toggle so the chart
 * (and its legend) stays readable at high cardinality.
 */
const DEFAULT_TOP_N_SERIES: number = 10;

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
}

const defaultSeriesControlsState: SeriesControlsState = {
  searchQuery: "",
  hiddenSeries: new Set<string>(),
  showAllSeries: false,
  sortBy: "peak",
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

/**
 * Render the per-chart control panel for a high-cardinality metric
 * chart. Combines a compact toolbar (search, Top-N toggle, reset
 * hidden) with an interactive colored legend that doubles as the
 * chart's legend — the Recharts built-in legend is suppressed when
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
  chartType: ChartType;
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
    chartType,
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
   * Map each currently-rendered series to the same palette color the
   * chart library assigned it (position-based: colors[index % len]).
   * Series that aren't on the chart right now (hidden by user or
   * filtered out) get no color and render as a muted dot below.
   */
  const palette: Array<AvailableChartColorsKeys> = getChartPalette(chartType);
  const colorByName: Map<string, AvailableChartColorsKeys> = new Map<
    string,
    AvailableChartColorsKeys
  >();
  displayableSeries.forEach((series: SeriesPoint, i: number) => {
    colorByName.set(series.seriesName, palette[i % palette.length]!);
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
    controls.showAllSeries
      ? seriesForChips
      : seriesForChips.slice(0, DEFAULT_TOP_N_SERIES),
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

  const hasStatus: boolean =
    hiddenFromTopN > 0 || controls.hiddenSeries.size > 0;

  const visibleCount: number = displayableSeries.length;

  return (
    <div className="space-y-2">
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
          {needsTopN ? (
            <button
              type="button"
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
              onClick={(): void => {
                updateControls(chartId, {
                  showAllSeries: !controls.showAllSeries,
                });
              }}
            >
              {controls.showAllSeries
                ? `Top ${DEFAULT_TOP_N_SERIES}`
                : `Show all ${totalSeries}`}
            </button>
          ) : null}
          {controls.hiddenSeries.size > 0 ? (
            <button
              type="button"
              className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900"
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
            const color: AvailableChartColorsKeys | undefined = colorByName.get(
              series.seriesName,
            );
            const showColor: boolean = Boolean(color) && !isHidden;
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
                className={`group inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition ${
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
                    showColor ? getColorClassName(color!, "bg") : "bg-gray-300"
                  }`}
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
  // Exemplar data keyed by metric name
  const [exemplarsByMetric, setExemplarsByMetric] = useState<
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
   * the deduplicated set of metric names — re-runs only when the time
   * window or metric set actually changes.
   */
  const startMs: number | undefined =
    props.metricViewData.startAndEndDate?.startValue instanceof Date
      ? (props.metricViewData.startAndEndDate.startValue as Date).getTime()
      : undefined;
  const endMs: number | undefined =
    props.metricViewData.startAndEndDate?.endValue instanceof Date
      ? (props.metricViewData.startAndEndDate.endValue as Date).getTime()
      : undefined;

  const uniqueMetricNamesKey: string = (() => {
    const names: Set<string> = new Set<string>();
    for (const queryConfig of props.metricViewData.queryConfigs) {
      const name: string =
        queryConfig.metricQueryData.filterData.metricName?.toString() || "";
      if (name) {
        names.add(name);
      }
    }
    return Array.from(names).sort().join("|");
  })();

  useEffect(() => {
    if (startMs === undefined || endMs === undefined) {
      return;
    }

    const metricNames: Array<string> = uniqueMetricNamesKey
      ? uniqueMetricNamesKey.split("|")
      : [];

    if (metricNames.length === 0) {
      return;
    }

    const startAndEndDate: InBetween<Date> = new InBetween<Date>(
      new Date(startMs),
      new Date(endMs),
    );

    /*
     * Fetch exemplars per unique metric name (was: per queryConfig, which
     * caused 5 charts of the same metric to issue 5 identical requests).
     */
    for (const metricName of metricNames) {
      MetricUtil.fetchExemplars({
        metricName,
        startAndEndDate,
      })
        .then((exemplars: Array<ExemplarPoint>) => {
          setExemplarsByMetric((prev: Record<string, Array<ExemplarPoint>>) => {
            return {
              ...prev,
              [metricName]: exemplars,
            };
          });
        })
        .catch(() => {
          // Best-effort: don't break charts if exemplar fetch fails
        });
    }
  }, [startMs, endMs, uniqueMetricNamesKey]);

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

  type GetChartsFunction = () => Array<Chart>;

  const getCharts: GetChartsFunction = (): Array<Chart> => {
    const charts: Array<Chart> = [];

    let index: number = 0;

    if (!props.metricResults) {
      return [];
    }

    for (const queryConfig of props.metricViewData.queryConfigs) {
      if (!props.metricResults[index]) {
        continue;
      }

      let xAxisAggregationType: XAxisAggregateType = XAxisAggregateType.Average;

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Sum
      ) {
        xAxisAggregationType = XAxisAggregateType.Sum;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Count
      ) {
        xAxisAggregationType = XAxisAggregateType.Sum;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Max
      ) {
        xAxisAggregationType = XAxisAggregateType.Max;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Min
      ) {
        xAxisAggregationType = XAxisAggregateType.Min;
      }

      if (
        queryConfig.metricQueryData.filterData.aggegationType ===
        MetricsAggregationType.Avg
      ) {
        xAxisAggregationType = XAxisAggregateType.Average;
      }

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
        for (const item of props.metricResults[index]!.data) {
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
          data: props.metricResults[index]!.data.map(
            (result: AggregatedModel) => {
              return {
                x: OneUptimeDate.fromString(result.timestamp),
                y: transformPointValue(result),
              };
            },
          ),
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

      let chartType: ChartType;
      if (queryConfig.chartType === MetricChartType.BAR) {
        chartType = ChartType.BAR;
      } else if (queryConfig.chartType === MetricChartType.AREA) {
        chartType = ChartType.AREA;
      } else if (queryConfig.chartType === MetricChartType.LINE) {
        chartType = ChartType.LINE;
      } else {
        chartType = ChartType.AREA;
      }

      // Resolve the unit for formatting
      const metricType: MetricType | undefined = props.metricTypes.find(
        (m: MetricType) => {
          return m.name === queryConfig.metricQueryData.filterData.metricName;
        },
      );
      const unit: string =
        queryConfig.metricAliasData?.legendUnit || metricType?.unit || "";
      const queryMetricName: string =
        queryConfig.metricQueryData.filterData.metricName?.toString() || "";
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

      // Build reference lines from thresholds
      const referenceLines: Array<ChartReferenceLineProps> = [];

      if (
        queryConfig.warningThreshold !== undefined &&
        queryConfig.warningThreshold !== null
      ) {
        referenceLines.push({
          value: queryConfig.warningThreshold,
          label: `Warning: ${ValueFormatter.formatValue(queryConfig.warningThreshold, unit, formatterOptions)}`,
          color: "#f59e0b", // amber
        });
      }

      if (
        queryConfig.criticalThreshold !== undefined &&
        queryConfig.criticalThreshold !== null
      ) {
        referenceLines.push({
          value: queryConfig.criticalThreshold,
          label: `Critical: ${ValueFormatter.formatValue(queryConfig.criticalThreshold, unit, formatterOptions)}`,
          color: "#ef4444", // red
        });
      }

      /*
       * Build metric info for the info icon modal.
       * Skip empty key/value entries and surface the operator alongside
       * the value so users can see what's actually filtered.
       */
      const metricAttributes: Dictionary<string> = {};
      const filterAttributes: Dictionary<unknown> | undefined = queryConfig
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
        metricName:
          queryConfig.metricQueryData.filterData.metricName?.toString() || "",
        aggregationType:
          queryConfig.metricQueryData.filterData.aggegationType?.toString() ||
          "",
        attributes:
          Object.keys(metricAttributes).length > 0
            ? metricAttributes
            : undefined,
        groupByAttribute:
          queryConfig.metricQueryData.filterData.groupByAttribute?.toString(),
        unit,
      };

      // Get exemplar data for this metric
      const metricNameStr: string =
        queryConfig.metricQueryData.filterData.metricName?.toString() || "";
      const chartExemplars: Array<ExemplarPoint> =
        exemplarsByMetric[metricNameStr] || [];

      const chartId: string = index.toString();

      /*
       * High-cardinality handling: rank series by the active value stat
       * (default: peak value) so the breaching series surface first and
       * are always retained by the Top-N cut, then apply the user's search
       * filter, hidden set, and Top-N cap. The original chartSeries length
       * is preserved for the controls panel so the "Show all N" button can
       * show the true count.
       */
      const controls: SeriesControlsState = getControls(chartId);
      const rankingStat: SeriesValueStat = getRankingStat(controls.sortBy);
      const rankedSeries: Array<SeriesPoint> = sortSeriesForDisplay(
        chartSeries,
        rankingStat,
      );

      const totalSeries: number = rankedSeries.length;
      const needsTopN: boolean = totalSeries > DEFAULT_TOP_N_SERIES;

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

      if (needsTopN && !controls.showAllSeries) {
        displayableSeries = displayableSeries.slice(0, DEFAULT_TOP_N_SERIES);
      }

      /*
       * The series drawn on the chart keep a stable natural-name order,
       * regardless of the node-list sort. Line/legend colors are assigned
       * by chart-series position, so ordering the chart by a live value
       * (e.g. peak) would reshuffle every node's color whenever the ranking
       * changed on refresh — making it impossible to track "the red line".
       * The user-selected sort is applied to the node list (chips) only;
       * the Top-N cut above still uses the value ranking so the highest
       * nodes are the ones shown.
       */
      displayableSeries = displayableSeries.slice().sort(compareSeriesByName);

      const hiddenFromTopN: number =
        needsTopN && !controls.showAllSeries
          ? Math.max(0, totalSeries - DEFAULT_TOP_N_SERIES)
          : 0;

      /*
       * Formats a series value for the node list using the same unit and
       * precision as the chart's y-axis, so "52.75%" in the list matches
       * the axis and tooltip.
       */
      const seriesValueFormatter: (value: number) => string = (
        value: number,
      ): string => {
        if (queryConfig.yAxisValueFormatter) {
          return queryConfig.yAxisValueFormatter(value);
        }
        return ValueFormatter.formatValue(value, unit, formatterOptions);
      };

      // Build the controls panel — only when series cardinality warrants it.
      const seriesControls: ReactElement | undefined =
        totalSeries > 1
          ? renderSeriesControls({
              chartId,
              controls,
              updateControls,
              fullSeries: rankedSeries,
              displayableSeries,
              totalSeries,
              hiddenFromTopN,
              needsTopN,
              chartType,
              valueFormatter: seriesValueFormatter,
            })
          : undefined;

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
        title: queryConfig.metricAliasData?.title || metricNameStr || "",
        description: queryConfig.metricAliasData?.description || "",
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
                if (queryConfig.yAxisValueFormatter) {
                  return queryConfig.yAxisValueFormatter(value);
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
          referenceLines:
            referenceLines.length > 0 ? referenceLines : undefined,
        },
      };

      charts.push(chart);

      index++;
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

      const formulaChartSeries: Array<SeriesPoint> = [
        {
          seriesName:
            formulaConfig.metricAliasData?.legend ||
            formulaConfig.metricAliasData?.title ||
            formulaExpression ||
            "Formula",
          data: formulaResult.data.map((point: AggregatedModel) => {
            return {
              x: OneUptimeDate.fromString(point.timestamp),
              y: point.value,
            };
          }),
        },
      ];

      let formulaChartType: ChartType;
      if (formulaConfig.chartType === MetricChartType.BAR) {
        formulaChartType = ChartType.BAR;
      } else if (formulaConfig.chartType === MetricChartType.LINE) {
        formulaChartType = ChartType.LINE;
      } else {
        formulaChartType = ChartType.AREA;
      }

      const formulaUnit: string =
        formulaConfig.metricAliasData?.legendUnit || "";

      const formulaReferenceLines: Array<ChartReferenceLineProps> = [];

      if (
        formulaConfig.warningThreshold !== undefined &&
        formulaConfig.warningThreshold !== null
      ) {
        formulaReferenceLines.push({
          value: formulaConfig.warningThreshold,
          label: `Warning: ${ValueFormatter.formatValue(
            formulaConfig.warningThreshold,
            formulaUnit,
          )}`,
          color: "#f59e0b",
        });
      }

      if (
        formulaConfig.criticalThreshold !== undefined &&
        formulaConfig.criticalThreshold !== null
      ) {
        formulaReferenceLines.push({
          value: formulaConfig.criticalThreshold,
          label: `Critical: ${ValueFormatter.formatValue(
            formulaConfig.criticalThreshold,
            formulaUnit,
          )}`,
          color: "#ef4444",
        });
      }

      const formulaMetricInfo: ChartMetricInfo = {
        metricName:
          formulaConfig.metricAliasData?.title ||
          formulaExpression ||
          "Formula",
        aggregationType: "Formula",
        unit: formulaUnit,
      };

      const formulaChart: Chart = {
        id: `formula-${formulaIndex}`,
        type: formulaChartType,
        title:
          formulaConfig.metricAliasData?.title ||
          `Formula: ${formulaExpression}`,
        description:
          formulaConfig.metricAliasData?.description ||
          `Evaluates: ${formulaExpression}`,
        metricInfo: formulaMetricInfo,
        props: {
          data: formulaChartSeries,
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
          referenceLines:
            formulaReferenceLines.length > 0
              ? formulaReferenceLines
              : undefined,
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
