import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ChartSkeleton from "../../Skeleton/ChartSkeleton";
import {
  Translator,
  translatableTerm,
  translationKey,
} from "../../../Utils/TranslateTemplate";
import AnalyticsQueryPicker from "../../TelemetryViewer/components/AnalyticsQueryPicker";
import useTranslator from "../../../Utils/UseTranslator";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  AreaChart,
  Area,
  LineChart,
  Line,
  ReferenceArea,
} from "recharts";
import {
  isAdditiveLogAnalyticsAggregation,
  isNumericLogAnalyticsAggregation,
  LogAnalyticsAggregation,
  needsLogAnalyticsAggregationField,
} from "../../../../Types/Log/LogAnalyticsAggregation";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "../../../../Types/Time/RangeStartAndEndDateTime";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import API from "../../../Utils/API/API";
import URL from "../../../../Types/API/URL";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import { JSONObject } from "../../../../Types/JSON";
import { applyLogsFacetExclusionsToRequest } from "../LogsFacetExclusions";
import {
  ResourceEntityFacetSelections,
  collectResourceEntityFacetSelections,
  collectServiceFacetSelections,
} from "../../../../Types/Telemetry/ResourceEntityFacet";
import { APP_API_URL } from "../../../Config";
import ModelAPI from "../../../Utils/ModelAPI/ModelAPI";
import useResizableColumns, {
  ResizableColumns,
} from "../../Table/ColumnResize/useResizableColumns";
import ResizableHeaderCell from "../../Table/ColumnResize/ResizableHeaderCell";
import { ColumnWidthKind } from "../../Table/ColumnResize/ColumnWidths";
import TelemetryLoadErrorMessage from "../../TelemetryViewer/components/TelemetryLoadErrorMessage";
import TelemetryLoadErrorUtil, {
  TelemetryLoadError,
} from "../../../Utils/Telemetry/TelemetryLoadError";
import OneUptimeDate from "../../../../Types/Date";
import useTelemetryEntityNames from "../../../Utils/Telemetry/UseTelemetryEntityNames";
import { TelemetryEntityNameMap } from "../../../Utils/Telemetry/TelemetryEntityNames";
import {
  collectAnalyticsEntityIds,
  getAnalyticsDimensionLabel,
  getAnalyticsGroupValueLabel,
  getAnalyticsSeriesLabel,
  LogsEntityResolutionRequest,
} from "../LogsEntityNames";
import useHistogramRangeSelection, {
  HistogramRangeSelectionState,
} from "../../Charts/Utils/useHistogramRangeSelection";
import {
  ChartTimeRangeZoomContextValue,
  ChartTimeRangeZoomHandlers,
  resolveChartTimeRangeZoom,
  useChartTimeRangeZoom,
} from "../../Charts/TimeRangeZoom/TimeRangeZoomContext";
import { getReaderNumberLocale } from "../../../../Types/DateLanguage";
import {
  formatChartCount,
  formatChartValue,
} from "../../Charts/Utils/ChartCount";
import {
  getChartRowValues,
  getYAxisWidthForValuesInPx,
} from "../../Charts/Utils/YAxisWidth";

type AnalyticsChartType = "timeseries" | "toplist" | "table";
type AnalyticsAggregation = LogAnalyticsAggregation;

interface AnalyticsTimeseriesRow {
  time: string;
  count: number;
  groupValues: Record<string, string>;
}

interface AnalyticsTopItem {
  value: string;
  count: number;
}

interface AnalyticsTableRow {
  groupValues: Record<string, string>;
  count: number;
}

export interface LogsAnalyticsViewProps {
  timeRange: RangeStartAndEndDateTime;
  serviceIds?: Array<string> | undefined;
  /*
   * Base session scope from the host page (e.g. a session replay detail
   * view). Forwarded verbatim so the charts cover the same rows as the list.
   */
  sessionIds?: Array<string> | undefined;
  appliedFacetFilters: Map<string, Set<string>>;
  logAttributes: Array<string>;
  /*
   * Drag-to-zoom for the timeseries chart. Without these the chart zooms
   * whatever the enclosing viewer offers (the logs viewer hands it the same
   * zoom its volume histogram uses), so a drag here retimes the viewer.
   */
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  // Set only while there is a zoom to undo: it holds single clicks open.
  onTimeRangeReset?: (() => void) | undefined;
}

export const LOGS_ANALYTICS_TIMESERIES_TEST_ID: string =
  "logs-analytics-timeseries";
export const LOGS_ANALYTICS_ZOOM_HINT_TEST_ID: string =
  "logs-analytics-zoom-hint";

const CHART_COLORS: Array<string> = [
  "#6366f1", // indigo
  "#ec4899", // pink
  "#10b981", // emerald
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#f43f5e", // rose
  "#14b8a6", // teal
  "#64748b", // slate
  "#84cc16", // lime
];

const CHART_COLORS_MUTED: Array<string> = [
  "rgba(99,102,241,0.15)",
  "rgba(236,72,153,0.15)",
  "rgba(16,185,129,0.15)",
  "rgba(245,158,11,0.15)",
  "rgba(6,182,212,0.15)",
  "rgba(139,92,246,0.15)",
  "rgba(244,63,94,0.15)",
  "rgba(20,184,166,0.15)",
  "rgba(100,116,139,0.15)",
  "rgba(132,204,22,0.15)",
];

/*
 * A log's own fields, named in English, keys of the locales: drawn in the
 * reader's language. An attribute's key is drawn as written.
 */
const DIMENSION_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "severityText", label: "Severity" },
  { value: "primaryEntityId", label: "Service" },
  { value: "traceId", label: "Trace ID" },
  { value: "spanId", label: "Span ID" },
];

/*
 * The query builder's fixed choices, in English, keys of the locales: drawn
 * in the reader's language (#9348).
 */
export const LOGS_ANALYTICS_CHART_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  { value: "timeseries", label: "Timeseries" },
  { value: "toplist", label: "Top List" },
  { value: "table", label: "Table" },
];

/*
 * What the chart measures: its logs, the unique values of a field, or the
 * sum, average, a percentile, the minimum or the maximum of a numeric
 * attribute (#7716) - "P95" of "duration_ms". Count is the default.
 */
export const LOGS_ANALYTICS_MEASURE_OPTIONS: Array<{
  value: AnalyticsAggregation;
  label: string;
}> = [
  { value: "count", label: "Count" },
  { value: "unique", label: "Unique Count" },
  { value: "sum", label: "Sum" },
  { value: "avg", label: "Average" },
  { value: "p50", label: "Median (P50)" },
  { value: "p90", label: "P90" },
  { value: "p95", label: "P95" },
  { value: "p99", label: "P99" },
  { value: "min", label: "Minimum" },
  { value: "max", label: "Maximum" },
];

/*
 * What the value axis says it reads - the measure and the field it is of,
 * "P95 of duration_ms" - as the top list's and the table's headers say it
 * too. A sentence each, so a language words each one whole.
 */
export const LOGS_ANALYTICS_VALUE_LABELS: Record<AnalyticsAggregation, string> =
  {
    count: translationKey("Count"),
    unique: translationKey("Unique count of {{attribute}}"),
    sum: translationKey("Sum of {{attribute}}"),
    avg: translationKey("Average of {{attribute}}"),
    p50: translationKey("Median of {{attribute}}"),
    p90: translationKey("P90 of {{attribute}}"),
    p95: translationKey("P95 of {{attribute}}"),
    p99: translationKey("P99 of {{attribute}}"),
    min: translationKey("Minimum of {{attribute}}"),
    max: translationKey("Maximum of {{attribute}}"),
  };

/*
 * Where the chart goes while a measure that reads a field has none yet:
 * what to pick, instead of a chart of something else.
 */
export const LOGS_ANALYTICS_CHOOSE_ATTRIBUTE: string = translationKey(
  "Choose the numeric attribute to chart.",
);

export const LOGS_ANALYTICS_CHOOSE_FIELD: string = translationKey(
  "Choose which field's unique values to count.",
);

export const LOGS_ANALYTICS_VALUE_LABEL_TEST_ID: string =
  "logs-analytics-value-label";
export const LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID: string =
  "logs-analytics-choose-field";

const NO_FIELD_CHOICE: { value: string; label: string } = {
  value: "",
  label: "Select field...",
};

const NO_GROUP_CHOICE: { value: string; label: string } = {
  value: "",
  label: "None",
};

// The captions before each of the query builder's controls.
export const LOGS_ANALYTICS_CAPTIONS: {
  chart: string;
  measure: string;
  of: string;
  groupBy: string;
  thenBy: string;
  limit: string;
} = {
  chart: translationKey("Chart"),
  measure: translationKey("Measure"),
  of: translationKey("of"),
  groupBy: translationKey("Group by"),
  thenBy: translationKey("then by"),
  limit: translationKey("Limit"),
};

const TOP_LIST_LIMITS: Array<number> = [5, 10, 25, 50];

interface PivotedTimeseriesRow {
  time: string;
  [key: string]: number | string;
}

/*
 * Series keys stay the raw joined group values (ids for an entity
 * dimension) so two entities that share a name remain two series;
 * `seriesLabels` carries what the legend and tooltip print for each key.
 * The one series of an ungrouped chart is named `ungroupedLabel` when
 * given - what it measures, "P95 of duration_ms" - and "count" otherwise.
 */
export function pivotTimeseriesData(
  rows: Array<AnalyticsTimeseriesRow>,
  entityNameMap?: TelemetryEntityNameMap | undefined,
  ungroupedLabel?: string | undefined,
): {
  pivotedData: Array<PivotedTimeseriesRow>;
  seriesKeys: Array<string>;
  seriesLabels: Record<string, string>;
} {
  const map: Map<string, PivotedTimeseriesRow> = new Map();
  const seriesKeysSet: Set<string> = new Set();
  const seriesLabels: Record<string, string> = {};

  for (const row of rows) {
    let pivotRow: PivotedTimeseriesRow | undefined = map.get(row.time);

    if (!pivotRow) {
      pivotRow = { time: row.time };
      map.set(row.time, pivotRow);
    }

    const groupValues: Record<string, string> = row.groupValues || {};
    const groupKey: string = Object.values(groupValues).join(" / ") || "count";
    seriesKeysSet.add(groupKey);
    if (seriesLabels[groupKey] === undefined) {
      seriesLabels[groupKey] =
        getAnalyticsSeriesLabel(groupValues, entityNameMap) ||
        (Object.keys(groupValues).length === 0 ? ungroupedLabel : undefined) ||
        groupKey;
    }
    pivotRow[groupKey] = ((pivotRow[groupKey] as number) || 0) + row.count;
  }

  return {
    pivotedData: Array.from(map.values()),
    seriesKeys: Array.from(seriesKeysSet),
    seriesLabels,
  };
}

export function formatTickTime(time: string): string {
  const date: Date = OneUptimeDate.fromString(time);

  if (isNaN(date.getTime())) {
    return time;
  }

  return OneUptimeDate.getLocalTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

/** The bucket a tooltip is pointing at, dated because it can be any day in the window. */
export function formatTooltipLabel(label: string | undefined): string {
  if (!label) {
    return "";
  }

  const date: Date = OneUptimeDate.fromString(label);

  if (isNaN(date.getTime())) {
    return label;
  }

  return OneUptimeDate.getDateAsLocalShortDateTimeString(date, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

function computeDefaultBucketSize(startTime: Date, endTime: Date): number {
  const diffMs: number = endTime.getTime() - startTime.getTime();
  const diffMinutes: number = diffMs / (1000 * 60);

  if (diffMinutes <= 60) {
    return 1;
  }

  if (diffMinutes <= 360) {
    return 5;
  }

  if (diffMinutes <= 1440) {
    return 15;
  }

  if (diffMinutes <= 10080) {
    return 60;
  }

  if (diffMinutes <= 43200) {
    return 360;
  }

  return 1440;
}

/*
 * A value the chart measured, in the reader's digits: a count as it always
 * was, an average or a percentile with at most two decimals ("182.25"), or
 * three figures below one ("0.0123") so a small one does not read as 0.
 */
export function formatAnalyticsValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }

  const magnitude: number = Math.abs(value);

  return value.toLocaleString(
    getReaderNumberLocale(),
    magnitude > 0 && magnitude < 1
      ? { maximumSignificantDigits: 3 }
      : { maximumFractionDigits: 2 },
  );
}

interface AnalyticsTooltipProps {
  active?: boolean;
  label?: string;
  // Series key -> printed label (entity names instead of ids).
  seriesLabels?: Record<string, string> | undefined;
  /*
   * Whether the series add up: a count's and a sum's do, and get a total.
   * An average's, a percentile's, a minimum's or a maximum's do not - nor a
   * unique count's - so each value is listed alone, a 0 or a negative one
   * too.
   */
  isAdditive?: boolean | undefined;
  payload?: Array<{
    dataKey: string;
    value: number;
    color: string;
  }>;
}

const AnalyticsTooltip: FunctionComponent<AnalyticsTooltipProps> = (
  props: AnalyticsTooltipProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();

  if (!props.active || !props.payload || props.payload.length === 0) {
    return null;
  }

  const isAdditive: boolean = props.isAdditive !== false;

  const entries: Array<{ key: string; value: number; color: string }> =
    props.payload
      .filter((entry: { value: number }): boolean => {
        if (typeof entry.value !== "number" || !Number.isFinite(entry.value)) {
          return false;
        }

        // A bucket a series has nothing in reads 0 in a stack: left out.
        return isAdditive ? entry.value > 0 : true;
      })
      .map(
        (entry: {
          dataKey: string;
          value: number;
          color: string;
        }): { key: string; value: number; color: string } => {
          return {
            key: entry.dataKey,
            value: entry.value,
            color: entry.color,
          };
        },
      );

  if (entries.length === 0) {
    return null;
  }

  const total: number = entries.reduce(
    (sum: number, e: { value: number }): number => {
      return sum + e.value;
    },
    0,
  );

  return (
    <div className="rounded-lg border border-gray-200/80 bg-white/95 px-3.5 py-2.5 shadow-lg backdrop-blur-sm">
      <p className="mb-2 border-b border-gray-100 pb-2 font-mono text-xs font-medium text-gray-500">
        {formatTooltipLabel(props.label)}
      </p>
      <div className="space-y-1">
        {entries.map((entry: { key: string; value: number; color: string }) => {
          return (
            <div
              key={entry.key}
              className="flex items-center justify-between gap-8"
            >
              <div className="flex items-center gap-2">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[3px]"
                  style={{ backgroundColor: entry.color }}
                />
                <span className="text-xs text-gray-600">
                  {props.seriesLabels?.[entry.key] || entry.key}
                </span>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums text-gray-800">
                {formatAnalyticsValue(entry.value)}
              </span>
            </div>
          );
        })}
      </div>
      {isAdditive && entries.length > 1 && (
        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-2">
          <span className="text-xs font-medium text-gray-500">
            {translator.translateText("Total")}
          </span>
          <span className="font-mono text-xs font-bold tabular-nums text-gray-900">
            {formatAnalyticsValue(total)}
          </span>
        </div>
      )}
    </div>
  );
};

const LogsAnalyticsView: FunctionComponent<LogsAnalyticsViewProps> = (
  props: LogsAnalyticsViewProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  /*
   * The query builder's own words - its charts, its measures, a log's own
   * fields, None - in the reader's language. An attribute's key and the
   * Limit's numbers are drawn as written.
   */
  const translateOptions: (
    options: ReadonlyArray<{ value: string | number; label: string }>,
  ) => Array<{ value: string | number; label: string }> = (
    options: ReadonlyArray<{ value: string | number; label: string }>,
  ): Array<{ value: string | number; label: string }> => {
    return options.map(
      (option: {
        value: string | number;
        label: string;
      }): { value: string | number; label: string } => {
        return {
          value: option.value,
          label: translator.translateText(option.label) || option.label,
        };
      },
    );
  };

  const [chartType, setChartType] = useState<AnalyticsChartType>("timeseries");
  const [aggregation, setAggregation] = useState<AnalyticsAggregation>("count");
  const [aggregationField, setAggregationField] = useState<string>("");
  const [groupByFields, setGroupByFields] = useState<Array<string>>([
    "severityText",
  ]);
  const [topListLimit, setTopListLimit] = useState<number>(10);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  /*
   * Why the chart's read did not come back (issue #4707): it says so where
   * the chart goes, rather than "No data available" for a window that was
   * too wide to finish.
   */
  const [loadError, setLoadError] = useState<TelemetryLoadError | undefined>(
    undefined,
  );
  const [timeseriesData, setTimeseriesData] = useState<
    Array<AnalyticsTimeseriesRow>
  >([]);
  /*
   * How much time one timeseries bucket covers, as the request that
   * produced the rows on screen bucketed them. Kept next to the rows so a
   * refetch in flight cannot pair these bars with another window's width;
   * it is what lets a click on one bar zoom into that bar.
   */
  const [timeseriesBucketMs, setTimeseriesBucketMs] = useState<
    number | undefined
  >(undefined);
  const [topListData, setTopListData] = useState<Array<AnalyticsTopItem>>([]);
  const [tableData, setTableData] = useState<Array<AnalyticsTableRow>>([]);
  /*
   * The group-by the data on screen was fetched with. The picker can move
   * ahead of the data while a refetch is in flight, and labels must follow
   * the data (a top list row's value belongs to this dimension).
   */
  const [resultGroupByFields, setResultGroupByFields] = useState<Array<string>>(
    [],
  );
  /*
   * The measure the data on screen was read with, for the same reason: an
   * axis must not call a count "P95 of duration_ms" while the P95 is still
   * on its way.
   */
  const [resultMeasure, setResultMeasure] = useState<{
    aggregation: AnalyticsAggregation;
    field: string;
  }>({ aggregation: "count", field: "" });

  /*
   * A measure that reads a field, with none picked yet: the chart says what
   * to pick rather than draw something else under the measure's name.
   */
  const isAwaitingField: boolean =
    needsLogAnalyticsAggregationField(aggregation) && !aggregationField;

  /*
   * Staleness guard. A zoom, its reset and the picker can change the window
   * faster than an analytics request returns, and a wide window answers
   * slower than a narrow one: without a sequence check the older response
   * lands last and paints the window the reader just left under the one
   * the picker, the list and the histogram show.
   */
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const allDimensionOptions: Array<{ value: string; label: string }> =
    useMemo(() => {
      const attributeOptions: Array<{ value: string; label: string }> =
        props.logAttributes
          .filter((attr: string) => {
            return !DIMENSION_OPTIONS.some((opt: { value: string }) => {
              return opt.value === attr;
            });
          })
          .map((attr: string) => {
            return { value: attr, label: attr };
          });

      // A log's own fields in the reader's language; an attribute as written.
      const logFieldOptions: Array<{ value: string; label: string }> =
        DIMENSION_OPTIONS.map(
          (option: {
            value: string;
            label: string;
          }): { value: string; label: string } => {
            return {
              value: option.value,
              label: translator.translateText(option.label) || option.label,
            };
          },
        );

      return [...logFieldOptions, ...attributeOptions];
    }, [props.logAttributes, translator]);

  /*
   * What a sum, an average, a percentile, a minimum or a maximum can be of:
   * the logs' attributes, as written. A log's own fields - its severity,
   * service, trace and span - hold no number.
   */
  const numericFieldOptions: Array<{ value: string; label: string }> =
    useMemo(() => {
      return allDimensionOptions.filter((option: { value: string }) => {
        return !DIMENSION_OPTIONS.some((field: { value: string }) => {
          return field.value === option.value;
        });
      });
    }, [allDimensionOptions]);

  /*
   * A measure picked: a field a unique count read that no number lives in
   * (Severity) is let go when a number is measured, so the picker beside it
   * offers attributes and holds none of them.
   */
  const onMeasureChange: (value: string) => void = (value: string): void => {
    const next: AnalyticsAggregation = value as AnalyticsAggregation;

    setAggregation(next);

    if (
      isNumericLogAnalyticsAggregation(next) &&
      DIMENSION_OPTIONS.some((field: { value: string }) => {
        return field.value === aggregationField;
      })
    ) {
      setAggregationField("");
    }
  };

  const fetchAnalytics: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };

      /*
       * Nothing to read until the measure has its field: what is on screen
       * goes, and the chart says what to pick (isAwaitingField).
       */
      if (needsLogAnalyticsAggregationField(aggregation) && !aggregationField) {
        setIsLoading(false);
        setLoadError(undefined);
        setTimeseriesData([]);
        setTimeseriesBucketMs(undefined);
        setTopListData([]);
        setTableData([]);
        return;
      }

      try {
        setIsLoading(true);
        setLoadError(undefined);

        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(props.timeRange);

        const startTime: Date = dateRange.startValue;
        const endTime: Date = dateRange.endValue;
        const bucketSizeInMinutes: number = computeDefaultBucketSize(
          startTime,
          endTime,
        );

        const requestData: JSONObject = {
          chartType,
          aggregation,
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          bucketSizeInMinutes: bucketSizeInMinutes,
        } as JSONObject;

        const requestGroupBy: Array<string> =
          groupByFields.length > 0 &&
          groupByFields[0] &&
          groupByFields[0].length > 0
            ? groupByFields.filter((f: string) => {
                return f.length > 0;
              })
            : [];

        if (requestGroupBy.length > 0) {
          (requestData as Record<string, unknown>)["groupBy"] = requestGroupBy;
        }

        // The field a unique count counts, or the attribute a number is of.
        if (needsLogAnalyticsAggregationField(aggregation)) {
          (requestData as Record<string, unknown>)["aggregationField"] =
            aggregationField;
        }

        if (chartType === "toplist" || chartType === "table") {
          (requestData as Record<string, unknown>)["limit"] = topListLimit;
        }

        if (props.serviceIds) {
          (requestData as Record<string, unknown>)["serviceIds"] =
            props.serviceIds;
        }

        if (props.sessionIds) {
          (requestData as Record<string, unknown>)["sessionIds"] =
            props.sessionIds;
        }

        // Apply facet filters
        const severityValues: Set<string> | undefined =
          props.appliedFacetFilters.get("severityText");

        if (severityValues && severityValues.size > 0) {
          (requestData as Record<string, unknown>)["severityTexts"] =
            Array.from(severityValues);
        }

        const serviceFilterValues: Array<string> =
          collectServiceFacetSelections(props.appliedFacetFilters.entries());

        if (serviceFilterValues.length > 0) {
          (requestData as Record<string, unknown>)["serviceIds"] =
            serviceFilterValues;
        }

        /*
         * Host / docker / podman / Kubernetes chips ride their own field —
         * their ids are not `primaryEntityId` values for telemetry that
         * carries a service.name, so the server resolves them to the
         * resource's entity key. Without this the analytics tab silently
         * ignored a cluster the sidebar was filtering by.
         */
        const resourceFilters: ResourceEntityFacetSelections =
          collectResourceEntityFacetSelections(
            props.appliedFacetFilters.entries(),
          );

        if (Object.keys(resourceFilters).length > 0) {
          (requestData as Record<string, unknown>)["resourceFilters"] =
            resourceFilters;
        }

        const traceFilterValues: Set<string> | undefined =
          props.appliedFacetFilters.get("traceId");

        if (traceFilterValues && traceFilterValues.size > 0) {
          (requestData as Record<string, unknown>)["traceIds"] =
            Array.from(traceFilterValues);
        }

        const spanFilterValues: Set<string> | undefined =
          props.appliedFacetFilters.get("spanId");

        if (spanFilterValues && spanFilterValues.size > 0) {
          (requestData as Record<string, unknown>)["spanIds"] =
            Array.from(spanFilterValues);
        }

        /*
         * And what the chips leave out ("Severity is not debug"), so the
         * analytics count the rows the list shows.
         */
        applyLogsFacetExclusionsToRequest(
          requestData,
          props.appliedFacetFilters,
        );

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/analytics",
            ),
            data: requestData,
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        /*
         * Superseded: drop it whole, labels included - a stale group-by
         * would relabel the newer rows.
         */
        if (isStale()) {
          return;
        }

        const data: unknown = response.data["data"] || [];

        setResultGroupByFields(requestGroupBy);
        setResultMeasure({
          aggregation,
          field: needsLogAnalyticsAggregationField(aggregation)
            ? aggregationField
            : "",
        });

        if (chartType === "timeseries") {
          setTimeseriesData(data as Array<AnalyticsTimeseriesRow>);
          setTimeseriesBucketMs(bucketSizeInMinutes * 60 * 1000);
        } else if (chartType === "toplist") {
          setTopListData(data as Array<AnalyticsTopItem>);
        } else {
          setTableData(data as Array<AnalyticsTableRow>);
        }
      } catch (err) {
        // A late failure of a superseded request must not blank newer data.
        if (isStale()) {
          return;
        }

        setLoadError(TelemetryLoadErrorUtil.fromError(err));
        setTimeseriesData([]);
        setTimeseriesBucketMs(undefined);
        setTopListData([]);
        setTableData([]);
      } finally {
        // Only the latest request may take the loader down.
        if (!isStale()) {
          setIsLoading(false);
        }
      }
    }, [
      chartType,
      aggregation,
      aggregationField,
      groupByFields,
      topListLimit,
      props.timeRange,
      props.serviceIds,
      props.sessionIds,
      props.appliedFacetFilters,
    ]);

  useEffect(() => {
    void fetchAnalytics();
  }, [fetchAnalytics]);

  /*
   * Group values of an entity dimension (primaryEntityId, hostId, …) are
   * ids — for a RUM application's logs the RumApplication id. One resolver
   * request names every id the current result shows. Grouped rows are read
   * by their own groupValues keys, not resultGroupByFields: after a chart
   * type switch the rows on screen may predate the last fetch's group-by.
   */
  const entityResolutionRequest: LogsEntityResolutionRequest = useMemo(() => {
    return collectAnalyticsEntityIds({
      groupByFields: resultGroupByFields,
      groupedRows:
        chartType === "timeseries"
          ? timeseriesData
          : chartType === "table"
            ? tableData
            : [],
      topListItems: chartType === "toplist" ? topListData : [],
    });
  }, [resultGroupByFields, chartType, timeseriesData, tableData, topListData]);

  const entityNameMap: TelemetryEntityNameMap = useTelemetryEntityNames(
    entityResolutionRequest.ids,
    { typeHints: entityResolutionRequest.typeHints },
  );

  /*
   * What the values on screen measure, in the reader's language: "Count",
   * "P95 of duration_ms", "Unique count of severity". An attribute is named
   * as written; a log's own field is a term of the sentence, worded with it.
   */
  const valueLabel: string = useMemo(() => {
    const template: string =
      LOGS_ANALYTICS_VALUE_LABELS[resultMeasure.aggregation];

    if (!needsLogAnalyticsAggregationField(resultMeasure.aggregation)) {
      return translator.translateText(template) || template;
    }

    const logField: { value: string; label: string } | undefined =
      DIMENSION_OPTIONS.find((field: { value: string }) => {
        return field.value === resultMeasure.field;
      });

    return translator.translateTemplate(
      template,
      {
        attribute: logField
          ? translatableTerm(logField.label, { inSentence: true })
          : resultMeasure.field,
      },
      { setsValuesApart: true },
    );
  }, [resultMeasure, translator]);

  /*
   * A count's and a sum's groups add up: stacked, totalled, shared out. An
   * average's, a percentile's, a minimum's, a maximum's and a unique
   * count's do not, so their series are lines of their own and their top
   * list has no share.
   */
  const isAdditive: boolean = isAdditiveLogAnalyticsAggregation(
    resultMeasure.aggregation,
  );

  const { pivotedData, seriesKeys, seriesLabels } = useMemo(() => {
    return pivotTimeseriesData(timeseriesData, entityNameMap, valueLabel);
  }, [timeseriesData, entityNameMap, valueLabel]);

  /*
   * The table's columns as wide as a person makes them (Table/ColumnResize),
   * after each row's number: the values of what the rows are grouped by,
   * and the count.
   */
  const tableGroupKeys: Array<string> = Object.keys(
    tableData[0]?.groupValues || {},
  );
  const resizableColumns: ResizableColumns = useResizableColumns({
    tableKey: "logs-analytics-table",
    columns: [
      ...tableGroupKeys.map(
        (key: string, index: number): { id: string; cellNumber: number } => {
          return { id: `group:${key}`, cellNumber: index + 2 };
        },
      ),
      { id: "count", cellNumber: tableGroupKeys.length + 2 },
    ],
  });

  /*
   * Only the timeseries has a time axis: a window dragged across a top
   * list or a table would not be a time range. Handlers the host passes win
   * over the zoom the enclosing viewer offers.
   */
  const pageZoom: ChartTimeRangeZoomContextValue | null =
    useChartTimeRangeZoom();
  const zoomHandlers: ChartTimeRangeZoomHandlers = resolveChartTimeRangeZoom({
    onTimeRangeSelect: props.onTimeRangeSelect,
    onTimeRangeReset: props.onTimeRangeReset,
    isTimeAxis: chartType === "timeseries",
    pageZoom: pageZoom,
  });

  /*
   * The same click-or-drag selection the volume histogram above uses, over
   * the same bucket-start labels: a drag zooms into every bucket it covered,
   * a click into one bucket, and a double-click zooms back out.
   */
  const selection: HistogramRangeSelectionState = useHistogramRangeSelection({
    onTimeRangeSelect: zoomHandlers.onTimeRangeSelect,
    onZoomOut: zoomHandlers.onTimeRangeReset,
    bucketIntervalMs: timeseriesBucketMs,
  });

  const canZoom: boolean = Boolean(zoomHandlers.onTimeRangeSelect);

  /*
   * The crosshair goes on the chart root itself: recharts sets an inline
   * `cursor: default` on the .recharts-wrapper that fills the plot, so a
   * cursor on any element around it never shows over the chart. Left off
   * entirely when nothing can be dragged, so recharts keeps its default.
   */
  const chartRootCursorProps: { style?: React.CSSProperties } = canZoom
    ? { style: { cursor: "crosshair" } }
    : {};

  const renderSelectControl: (
    label: string,
    value: string | number,
    onChange: (val: string) => void,
    options: Array<{ value: string | number; label: string }>,
  ) => ReactElement = (
    label: string,
    value: string | number,
    onChange: (val: string) => void,
    options: Array<{ value: string | number; label: string }>,
  ): ReactElement => {
    // The caption is English, a key of the locales: drawn in the reader's language.
    const caption: string = translator.translateText(label) || label;

    return (
      <div className="flex items-center">
        <span className="mr-2 text-[11px] font-medium uppercase tracking-wider text-gray-500">
          {caption}
        </span>
        {/*
         * The choices come in the reader's language already (translateOptions),
         * an attribute's key among them as written.
         */}
        <AnalyticsQueryPicker
          ariaLabel={caption}
          isAriaLabelTranslated={true}
          value={value}
          onChange={onChange}
          options={options}
          labels="translated"
        />
      </div>
    );
  };

  const renderQueryBuilder: () => ReactElement = (): ReactElement => {
    return (
      <div className="flex flex-wrap items-center gap-4 border-b border-gray-100 px-5 py-3">
        {renderSelectControl(
          LOGS_ANALYTICS_CAPTIONS.chart,
          chartType,
          (val: string) => {
            setChartType(val as AnalyticsChartType);
          },
          translateOptions(LOGS_ANALYTICS_CHART_OPTIONS),
        )}

        <div className="h-4 w-px bg-gray-200" />

        {renderSelectControl(
          LOGS_ANALYTICS_CAPTIONS.measure,
          aggregation,
          onMeasureChange,
          translateOptions(LOGS_ANALYTICS_MEASURE_OPTIONS),
        )}

        {/*
         * What the measure is of: any field for a unique count, an
         * attribute for a number ("P95" of "duration_ms").
         */}
        {needsLogAnalyticsAggregationField(aggregation) &&
          renderSelectControl(
            LOGS_ANALYTICS_CAPTIONS.of,
            aggregationField,
            (val: string) => {
              setAggregationField(val);
            },
            [
              ...translateOptions([NO_FIELD_CHOICE]),
              ...(isNumericLogAnalyticsAggregation(aggregation)
                ? numericFieldOptions
                : allDimensionOptions),
            ],
          )}

        <div className="h-4 w-px bg-gray-200" />

        {renderSelectControl(
          LOGS_ANALYTICS_CAPTIONS.groupBy,
          groupByFields[0] || "",
          (val: string) => {
            setGroupByFields((prev: Array<string>) => {
              const next: Array<string> = [...prev];
              next[0] = val;
              return next.filter((f: string) => {
                return f.length > 0;
              });
            });
          },
          [...translateOptions([NO_GROUP_CHOICE]), ...allDimensionOptions],
        )}

        {groupByFields[0] &&
          groupByFields[0].length > 0 &&
          renderSelectControl(
            LOGS_ANALYTICS_CAPTIONS.thenBy,
            groupByFields[1] || "",
            (val: string) => {
              setGroupByFields((prev: Array<string>) => {
                const next: Array<string> = [prev[0] || ""];

                if (val.length > 0) {
                  next.push(val);
                }

                return next.filter((f: string) => {
                  return f.length > 0;
                });
              });
            },
            [
              ...translateOptions([NO_GROUP_CHOICE]),
              ...allDimensionOptions.filter((opt: { value: string }) => {
                return opt.value !== groupByFields[0];
              }),
            ],
          )}

        {(chartType === "toplist" || chartType === "table") && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            {renderSelectControl(
              LOGS_ANALYTICS_CAPTIONS.limit,
              topListLimit,
              (val: string) => {
                setTopListLimit(Number(val));
              },
              TOP_LIST_LIMITS.map((limit: number) => {
                return { value: limit, label: String(limit) };
              }),
            )}
          </>
        )}
      </div>
    );
  };

  const renderZoomHint: () => ReactElement | null = (): ReactElement | null => {
    if (!canZoom) {
      return null;
    }

    return (
      <span
        className="ml-auto shrink-0 whitespace-nowrap text-xs text-gray-500"
        data-testid={LOGS_ANALYTICS_ZOOM_HINT_TEST_ID}
      >
        {translator.translateText(
          selection.canClickToZoom
            ? zoomHandlers.onTimeRangeReset
              ? "Click or drag to zoom · double-click to reset"
              : "Click or drag to zoom"
            : zoomHandlers.onTimeRangeReset
              ? "Drag to zoom · double-click to reset"
              : "Drag to zoom",
        )}
      </span>
    );
  };

  const renderLegend: () => ReactElement = (): ReactElement => {
    if (seriesKeys.length <= 1) {
      return canZoom ? (
        <div className="flex items-center px-5 pb-2">{renderZoomHint()}</div>
      ) : (
        <></>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 pb-2">
        {seriesKeys.map((key: string, index: number) => {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-[3px]"
                style={{
                  backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                }}
              />
              <span className="text-xs text-gray-500">
                {seriesLabels[key] || key}
              </span>
            </div>
          );
        })}
        {renderZoomHint()}
      </div>
    );
  };

  /*
   * The band a drag paints across the buckets it covers, in the same colours
   * the volume histogram uses.
   */
  const renderSelectionBand: () => ReactElement | null =
    (): ReactElement | null => {
      if (!selection.selectionStart || !selection.selectionEnd) {
        return null;
      }

      return (
        <ReferenceArea
          x1={selection.selectionStart}
          x2={selection.selectionEnd}
          fill="rgba(99,102,241,0.12)"
          stroke="rgba(99,102,241,0.5)"
          strokeWidth={1}
          radius={2}
        />
      );
    };

  /*
   * The value axis writes a figure as the tooltip beside it does, in the
   * reader's digits ("1,5K", "۱٫۵K"), and is as wide as its widest tick at
   * its 11 px - a stack's total among them - never narrower than its 52 px
   * (#8349). A count keeps whole numbers; an average, a percentile, a
   * minimum or a maximum of a number shows its fractions ("0.25", "182").
   * One formatter while the language and the measure stay: the axis keeps
   * its series.
   */
  const formatYAxisTick: (value: number) => string = useMemo(() => {
    return (value: number): string => {
      return isNumericLogAnalyticsAggregation(resultMeasure.aggregation)
        ? formatChartValue(value, translator.language)
        : formatChartCount(value, translator.language);
    };
  }, [translator.language, resultMeasure.aggregation]);

  /*
   * Only a count's and a sum's series stack (isAdditive): the axis of a
   * stack reaches its total, the axis of lines its highest point.
   */
  const isStacked: boolean = isAdditive && seriesKeys.length !== 1;

  const yAxisWidth: number = useMemo(() => {
    return getYAxisWidthForValuesInPx({
      values: getChartRowValues(pivotedData, seriesKeys, {
        isStacked: isStacked,
      }),
      formatter: formatYAxisTick,
      minWidthInPx: 52,
      tickFontSizeInPx: 11,
    });
  }, [pivotedData, seriesKeys, isStacked, formatYAxisTick]);

  /*
   * The tooltip is pinned shut for the length of a drag: it would otherwise
   * sit over the very buckets the reader is picking. Dropping the prop hands
   * control back to recharts once the drag ends.
   */
  const tooltipDragProps: { active?: boolean } = selection.isDragging
    ? { active: false }
    : {};

  /*
   * What the value axis reads, over it, where the axis starts: "P95 of
   * duration_ms". The top list and the table say it in their headers.
   */
  const renderValueLabel: () => ReactElement = (): ReactElement => {
    return (
      <p
        className="truncate pb-1 text-xs font-medium text-gray-500"
        title={valueLabel}
        data-testid={LOGS_ANALYTICS_VALUE_LABEL_TEST_ID}
      >
        {valueLabel}
      </p>
    );
  };

  const renderTimeseries: () => ReactElement = (): ReactElement => {
    if (pivotedData.length === 0) {
      /*
       * A zoom into a quiet stretch lands here, with no chart left to
       * double-click; the empty area takes the double-click instead, so the
       * way back is where the reader's pointer already is. select-none: a
       * double-click on the message would otherwise also select a word.
       */
      return (
        <div
          className="select-none"
          onDoubleClick={zoomHandlers.onTimeRangeReset}
        >
          {renderEmptyState()}
        </div>
      );
    }

    const useAreaChart: boolean = seriesKeys.length === 1;

    /*
     * The grid, both axes and the tooltip, alike for the area, the lines
     * and the bars. A count's whole numbers keep whole ticks; a number's
     * axis may fall between them ("0.25").
     */
    const sharedAxes: ReactElement = (
      <>
        <CartesianGrid
          strokeDasharray="none"
          stroke="var(--ou-chart-grid, #f1f5f9)"
          vertical={false}
        />
        <XAxis
          dataKey="time"
          tickFormatter={formatTickTime}
          tick={{
            fontSize: 11,
            fill: "var(--ou-chart-tick, #94a3b8)",
          }}
          axisLine={{ stroke: "var(--ou-chart-grid, #e2e8f0)" }}
          tickLine={false}
          minTickGap={50}
          interval="preserveStartEnd"
          dy={8}
        />
        <YAxis
          tick={{
            fontSize: 11,
            fill: "var(--ou-chart-tick, #94a3b8)",
          }}
          axisLine={false}
          tickLine={false}
          width={yAxisWidth}
          allowDecimals={isNumericLogAnalyticsAggregation(
            resultMeasure.aggregation,
          )}
          tickFormatter={formatYAxisTick}
        />
        <Tooltip
          content={
            <AnalyticsTooltip
              seriesLabels={seriesLabels}
              isAdditive={isAdditive}
            />
          }
          cursor={
            isStacked
              ? { fill: "rgba(99,102,241,0.04)" }
              : {
                  stroke: "var(--ou-accent-muted, #c7d2fe)",
                  strokeWidth: 1,
                  strokeDasharray: "4 4",
                }
          }
          {...tooltipDragProps}
        />
      </>
    );

    const chartRootProps: {
      data: Array<PivotedTimeseriesRow>;
      margin: { top: number; right: number; bottom: number; left: number };
    } = {
      data: pivotedData,
      margin: { top: 8, right: 20, bottom: 4, left: 0 },
    };

    return (
      <div className="px-2 pt-4 pb-2">
        {renderLegend()}
        {renderValueLabel()}
        <div
          className="select-none"
          style={{
            height: 320,
            cursor: canZoom ? "crosshair" : "default",
          }}
          data-testid={LOGS_ANALYTICS_TIMESERIES_TEST_ID}
          onDoubleClick={selection.onDoubleClick}
        >
          <ResponsiveContainer width="100%" height="100%">
            {useAreaChart ? (
              <AreaChart
                {...chartRootProps}
                onMouseDown={selection.onMouseDown}
                {...selection.chartRootProps}
                onMouseMove={selection.onMouseMove}
                onMouseUp={selection.onMouseUp}
                {...chartRootCursorProps}
              >
                <defs>
                  <linearGradient
                    id="areaGradient0"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor={CHART_COLORS[0]}
                      stopOpacity={0.2}
                    />
                    <stop
                      offset="95%"
                      stopColor={CHART_COLORS[0]}
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                {sharedAxes}
                <Area
                  dataKey={seriesKeys[0] || "count"}
                  stroke={CHART_COLORS[0]!}
                  strokeWidth={2}
                  fill="url(#areaGradient0)"
                  dot={false}
                  activeDot={{
                    r: 4,
                    fill: CHART_COLORS[0]!,
                    stroke: "var(--ou-chart-marker-ring, #ffffff)",
                    strokeWidth: 2,
                  }}
                  isAnimationActive={false}
                />
                {renderSelectionBand()}
              </AreaChart>
            ) : isStacked ? (
              <BarChart
                {...chartRootProps}
                barCategoryGap="20%"
                barGap={0}
                onMouseDown={selection.onMouseDown}
                {...selection.chartRootProps}
                onMouseMove={selection.onMouseMove}
                onMouseUp={selection.onMouseUp}
                {...chartRootCursorProps}
              >
                {sharedAxes}
                {seriesKeys.map((key: string, index: number) => {
                  return (
                    <Bar
                      key={key}
                      dataKey={key}
                      stackId="group"
                      fill={CHART_COLORS[index % CHART_COLORS.length]!}
                      radius={
                        index === seriesKeys.length - 1
                          ? [3, 3, 0, 0]
                          : [0, 0, 0, 0]
                      }
                      isAnimationActive={false}
                      maxBarSize={40}
                    />
                  );
                })}
                {renderSelectionBand()}
              </BarChart>
            ) : (
              /*
               * An average, a percentile, a minimum or a maximum per group
               * is never stacked: three services' p95s on top of each other
               * read as a latency nobody had. One line each.
               */
              <LineChart
                {...chartRootProps}
                onMouseDown={selection.onMouseDown}
                {...selection.chartRootProps}
                onMouseMove={selection.onMouseMove}
                onMouseUp={selection.onMouseUp}
                {...chartRootCursorProps}
              >
                {sharedAxes}
                {seriesKeys.map((key: string, index: number) => {
                  return (
                    <Line
                      key={key}
                      dataKey={key}
                      stroke={CHART_COLORS[index % CHART_COLORS.length]!}
                      strokeWidth={1.75}
                      dot={false}
                      connectNulls={true}
                      isAnimationActive={false}
                    />
                  );
                })}
                {renderSelectionBand()}
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  /*
   * A group-by dimension's header: a log's own field in the reader's
   * language ("Schweregrad"), an entity type by its name, an attribute's
   * key as written.
   */
  const getDimensionHeader: (key: string, values: Array<string>) => string = (
    key: string,
    values: Array<string>,
  ): string => {
    const label: string = getAnalyticsDimensionLabel(
      key,
      values,
      entityNameMap,
    );

    return label === key ? key : translator.translateText(label) || label;
  };

  /*
   * How long a value's bar is: its share of the largest value on screen,
   * by size - a minimum of -7 beside 40 is a bar, not nothing.
   */
  const getBarScale: (values: Array<number>) => number = (
    values: Array<number>,
  ): number => {
    return (
      Math.max(
        ...values.map((value: number): number => {
          return Number.isFinite(value) ? Math.abs(value) : 0;
        }),
      ) || 1
    );
  };

  const renderTopList: () => ReactElement = (): ReactElement => {
    if (topListData.length === 0) {
      return renderEmptyState();
    }

    const barScale: number = getBarScale(
      topListData.map((item: AnalyticsTopItem): number => {
        return item.count;
      }),
    );

    const totalCount: number = topListData.reduce(
      (sum: number, item: AnalyticsTopItem) => {
        return sum + item.count;
      },
      0,
    );

    const dimensionKey: string | undefined = resultGroupByFields[0];

    return (
      <div className="p-5">
        {/*
         * What the rows are and what their numbers measure: "http.route" ·
         * "P95 of duration_ms".
         */}
        <div className="flex items-center justify-between gap-4 px-3 pb-2 text-xs font-medium text-gray-500">
          <span className="min-w-0 truncate">
            {dimensionKey
              ? getDimensionHeader(
                  dimensionKey,
                  topListData.map((item: AnalyticsTopItem): string => {
                    return item.value;
                  }),
                )
              : ""}
          </span>
          <span
            className="min-w-0 truncate text-right"
            data-testid={LOGS_ANALYTICS_VALUE_LABEL_TEST_ID}
          >
            {valueLabel}
          </span>
        </div>
        <div className="space-y-1.5">
          {topListData.map((item: AnalyticsTopItem, index: number) => {
            const percentage: number = (Math.abs(item.count) / barScale) * 100;
            const sharePercent: number =
              totalCount > 0 ? Math.round((item.count / totalCount) * 100) : 0;
            const color: string =
              CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0]!;
            const mutedColor: string =
              CHART_COLORS_MUTED[index % CHART_COLORS_MUTED.length] ||
              CHART_COLORS_MUTED[0]!;

            return (
              <div
                key={index}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-gray-50/80"
              >
                <span className="w-5 text-right font-mono text-xs font-medium text-gray-500">
                  {index + 1}
                </span>
                <div
                  className="h-2 w-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="w-44 min-w-0 truncate text-sm font-medium text-gray-700">
                  {getAnalyticsGroupValueLabel(
                    resultGroupByFields[0],
                    item.value,
                    entityNameMap,
                  ) || "(empty)"}
                </div>
                <div className="flex-1">
                  <div className="relative h-7 w-full overflow-hidden rounded-md bg-gray-50">
                    <div
                      className="absolute left-0 top-0 h-full rounded-md transition-all duration-300"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: mutedColor,
                        borderInlineStart: `3px solid ${color}`,
                      }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="font-mono text-sm font-semibold tabular-nums text-gray-800">
                    {formatAnalyticsValue(item.count)}
                  </span>
                  {/*
                   * A share of the whole, for what adds up to one: a
                   * route's share of the logs, not of a sum of p95s.
                   */}
                  {isAdditive && (
                    <span className="w-10 text-right font-mono text-xs tabular-nums text-gray-500">
                      {sharePercent}%
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderTable: () => ReactElement = (): ReactElement => {
    if (tableData.length === 0) {
      return renderEmptyState();
    }

    const groupKeys: Array<string> = Object.keys(
      tableData[0]?.groupValues || {},
    );

    const barScale: number = getBarScale(
      tableData.map((row: AnalyticsTableRow): number => {
        return row.count;
      }),
    );

    return (
      <div className="p-5">
        {/*
         * Scrolls sideways when its columns are made wider than the box,
         * rather than cut off at its rounded edge.
         */}
        <div className="overflow-x-auto rounded-lg border border-gray-200/80">
          {resizableColumns.styles}
          <table
            className={resizableColumns.getTableWidthClassName("min-w-full")}
            {...resizableColumns.tableAttributes}
          >
            <thead>
              <tr className="border-b border-gray-200/80 bg-gray-50/80">
                <th className="w-10 px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                  #
                </th>
                {groupKeys.map((key: string, keyIndex: number) => {
                  const label: string = getDimensionHeader(
                    key,
                    tableData.map((row: AnalyticsTableRow): string => {
                      return row.groupValues?.[key] || "";
                    }),
                  );

                  return (
                    <ResizableHeaderCell
                      key={key}
                      className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                      resize={resizableColumns.getResize(
                        `group:${key}`,
                        label,
                        keyIndex === 0
                          ? ColumnWidthKind.Name
                          : ColumnWidthKind.Text,
                      )}
                    >
                      <span>{label}</span>
                    </ResizableHeaderCell>
                  );
                })}
                {/*
                 * What the numbers measure: "Count", or "P95 of
                 * duration_ms".
                 */}
                <ResizableHeaderCell
                  className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-500"
                  resize={resizableColumns.getResize(
                    "count",
                    valueLabel,
                    ColumnWidthKind.Whole,
                  )}
                >
                  <span data-testid={LOGS_ANALYTICS_VALUE_LABEL_TEST_ID}>
                    {valueLabel}
                  </span>
                </ResizableHeaderCell>
                <th className="w-48 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400" />
              </tr>
            </thead>
            <tbody>
              {tableData.map((row: AnalyticsTableRow, index: number) => {
                const barWidth: number = (Math.abs(row.count) / barScale) * 100;
                const color: string =
                  CHART_COLORS[index % CHART_COLORS.length] || CHART_COLORS[0]!;
                const mutedColor: string =
                  CHART_COLORS_MUTED[index % CHART_COLORS_MUTED.length] ||
                  CHART_COLORS_MUTED[0]!;

                return (
                  <tr
                    key={index}
                    className="border-b border-gray-100/80 transition-colors last:border-b-0 hover:bg-gray-50/50"
                  >
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                      {index + 1}
                    </td>
                    {groupKeys.map((key: string) => {
                      return (
                        <td
                          key={key}
                          className="whitespace-nowrap px-4 py-2.5 text-sm text-gray-700"
                        >
                          {getAnalyticsGroupValueLabel(
                            key,
                            row.groupValues[key] || "",
                            entityNameMap,
                          ) || "(empty)"}
                        </td>
                      );
                    })}
                    <td className="whitespace-nowrap px-4 py-2.5 text-right font-mono text-sm font-semibold tabular-nums text-gray-800">
                      {formatAnalyticsValue(row.count)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="h-5 w-full overflow-hidden rounded bg-gray-50">
                        <div
                          className="h-full rounded transition-all duration-300"
                          style={{
                            width: `${barWidth}%`,
                            backgroundColor: mutedColor,
                            borderInlineStart: `2px solid ${color}`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  /*
   * Where the chart goes when there is none to draw: the chart's icon over
   * one line, in the reader's words.
   */
  const renderPlaceholder: (
    message: string | undefined,
    testId?: string | undefined,
  ) => ReactElement = (
    message: string | undefined,
    testId?: string | undefined,
  ): ReactElement => {
    return (
      <div
        className="flex h-72 flex-col items-center justify-center gap-3 px-6 text-center"
        data-testid={testId}
      >
        <svg
          className="h-10 w-10 text-gray-200"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z"
          />
        </svg>
        <p className="text-sm text-gray-500">{message}</p>
      </div>
    );
  };

  const renderEmptyState: () => ReactElement = (): ReactElement => {
    return renderPlaceholder(
      translator.translateText("No data available for the selected query"),
    );
  };

  const renderChart: () => ReactElement = (): ReactElement => {
    /*
     * A measure that reads a field has none picked: say which to pick,
     * rather than chart something the measure is not.
     */
    if (isAwaitingField) {
      return renderPlaceholder(
        translator.translateText(
          isNumericLogAnalyticsAggregation(aggregation)
            ? LOGS_ANALYTICS_CHOOSE_ATTRIBUTE
            : LOGS_ANALYTICS_CHOOSE_FIELD,
        ),
        LOGS_ANALYTICS_CHOOSE_FIELD_TEST_ID,
      );
    }

    if (isLoading) {
      /*
       * A zoom refetches, and until the new window lands the loader stands
       * where the timeseries was - just when a reader double-clicks to undo
       * the zoom (issue #4116). It takes that double-click as the chart
       * does, even when the chart replaces it mid-double-click (see
       * placeholderProps).
       */
      return (
        <div
          className="flex h-72 select-none items-center justify-center"
          {...(chartType === "timeseries" ? selection.placeholderProps : {})}
        >
          <ChartSkeleton heightInPx={288} hasLegend={false} />
        </div>
      );
    }

    if (loadError) {
      /*
       * Where the timeseries would be, it takes a double-click as the chart
       * does, like the loader above and the histogram cards' messages.
       */
      return (
        <div
          className="flex h-72 select-none items-center justify-center"
          {...(chartType === "timeseries" ? selection.placeholderProps : {})}
        >
          <TelemetryLoadErrorMessage
            error={loadError}
            subject="chart"
            onRetry={() => {
              void fetchAnalytics();
            }}
          />
        </div>
      );
    }

    if (chartType === "timeseries") {
      return renderTimeseries();
    }

    if (chartType === "toplist") {
      return renderTopList();
    }

    return renderTable();
  };

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200/80 bg-white shadow-sm">
      {renderQueryBuilder()}
      {renderChart()}
    </div>
  );
};

export default LogsAnalyticsView;
