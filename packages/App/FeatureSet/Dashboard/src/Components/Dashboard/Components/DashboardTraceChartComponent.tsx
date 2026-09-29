import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import DashboardTraceChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardTraceChartComponent";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import JSONFunctions from "Common/Types/JSONFunctions";
import DashboardResourceList from "../Utils/DashboardResourceList";
import { HistogramRangeSelectionState } from "Common/UI/Components/Charts/Utils/useHistogramRangeSelection";
import DashboardWidgetTimeRangeZoom, {
  DashboardHistogramWindow,
  DashboardWidgetTimeRangeZoomHandlers,
} from "../Utils/DashboardWidgetTimeRangeZoom";
import useDashboardHistogramZoom from "../Utils/UseDashboardHistogramZoom";
import DashboardWidgetZoomHint from "./DashboardWidgetZoomHint";
import {
  TimeseriesRow,
  buildTraceAnalyticsRequest,
  formatCount,
  formatDurationMs,
  formatTickTime,
  hexToRgba,
  isDurationMetric,
  pivotTimeseries,
  resolveTraceSeriesColor,
} from "./TraceChartData";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardTraceChartComponent;
}

const DashboardTraceChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [rows, setRows] = useState<Array<TimeseriesRow>>([]);
  /*
   * The window and bucket width `rows` were fetched for, replaced together
   * with them. A drag across the chart reads it to turn the bars it covered
   * into a time window (see useDashboardHistogramZoom).
   */
  const [chartWindow, setChartWindow] =
    useState<DashboardHistogramWindow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Staleness guard — see TracesAnalyticsView for rationale.
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const metric: string = props.component.arguments.metric || "count";
  const isDuration: boolean = isDurationMetric(metric);
  const groupByAttribute: string | undefined =
    props.component.arguments.groupByAttribute?.trim() || undefined;

  const fetchData: () => Promise<void> = useCallback(async () => {
    const requestSequence: number = ++requestSequenceRef.current;
    const isStale: () => boolean = (): boolean => {
      return requestSequence !== requestSequenceRef.current;
    };

    /*
     * The trace analytics endpoint requires an authenticated project
     * session — public dashboards have neither.
     */
    if (DashboardResourceList.isPublic()) {
      setIsLoading(false);
      setError("Trace charts are not available on public dashboards.");
      return;
    }

    setIsLoading(true);

    const startAndEndDate: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(
        props.dashboardStartAndEndDate,
      );

    if (!startAndEndDate.startValue || !startAndEndDate.endValue) {
      setIsLoading(false);
      setError("Please select a valid start and end date.");
      return;
    }

    try {
      const requestData: JSONObject = buildTraceAnalyticsRequest({
        arguments: props.component.arguments,
        startTime: startAndEndDate.startValue,
        endTime: startAndEndDate.endValue,
        variables: props.variables,
      });

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/telemetry/traces/analytics",
          ),
          data: requestData,
          headers: {
            ...ModelAPI.getCommonHeaders(),
          },
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      if (isStale()) {
        return;
      }
      const data: unknown = response.data["data"] || [];
      setRows(data as Array<TimeseriesRow>);
      setChartWindow({
        startTime: startAndEndDate.startValue,
        endTime: startAndEndDate.endValue,
        bucketSizeInMinutes: Number(requestData["bucketSizeInMinutes"]),
      });
      setError(null);
    } catch (err: unknown) {
      if (isStale()) {
        return;
      }
      setError(API.getFriendlyErrorMessage(err as Error));
    }

    if (!isStale()) {
      setIsLoading(false);
    }
  }, [
    props.dashboardStartAndEndDate,
    metric,
    groupByAttribute,
    props.component.arguments.spanNameContains,
    props.component.arguments.attributeFilters,
    props.component.arguments.topLimit,
    props.component.arguments.includeChildSpans,
    props.variables,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData, props.refreshTick]);

  const { pivotedData, seriesKeys } = useMemo(() => {
    return pivotTimeseries(rows, metric);
  }, [rows, metric]);

  /*
   * Drag-to-zoom retimes the whole board, the gesture every time-series
   * panel on it answers to: the window goes up to the dashboard shell and
   * comes back down as dashboardStartAndEndDate, which refetches this chart
   * with it. None in edit mode; the reset only while zoomed.
   */
  const timeRangeZoom: DashboardWidgetTimeRangeZoomHandlers =
    DashboardWidgetTimeRangeZoom.getHandlers(props);

  const selection: HistogramRangeSelectionState = useDashboardHistogramZoom({
    zoom: timeRangeZoom,
    fetchedWindow: chartWindow,
  });

  // The one condition the plot is drawn on; the hint reads it too.
  const isChartShown: boolean = !error && pivotedData.length > 0;

  /*
   * recharts sets cursor: default inline on its own wrapper, so a crosshair
   * class on the box around the chart never shows over the plot. The chart
   * root takes it as a style instead, and only while a drag can zoom.
   */
  const chartCursor: { style?: React.CSSProperties } =
    timeRangeZoom.onTimeRangeSelect ? { style: { cursor: "crosshair" } } : {};

  const colorForSeries: (seriesKey: string, index: number) => string = (
    seriesKey: string,
    index: number,
  ): string => {
    return resolveTraceSeriesColor(seriesKey, index, {
      color: props.component.arguments.color,
      colorsByGroup: props.component.arguments.colorsByGroup,
      groupByAttribute,
    });
  };

  const valueFormatter: (value: number) => string = isDuration
    ? formatDurationMs
    : formatCount;

  const renderChart: () => ReactElement = (): ReactElement => {
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
          tick={{ fontSize: 10, fill: "var(--ou-chart-tick, #94a3b8)" }}
          axisLine={{ stroke: "var(--ou-chart-grid, #e2e8f0)" }}
          tickLine={false}
          minTickGap={40}
          interval="preserveStartEnd"
          dy={4}
        />
        <YAxis
          tick={{ fontSize: 10, fill: "var(--ou-chart-tick, #94a3b8)" }}
          axisLine={false}
          tickLine={false}
          width={56}
          allowDecimals={isDuration}
          tickFormatter={valueFormatter}
        />
        <Tooltip
          formatter={(value: unknown): string => {
            return valueFormatter(Number(value));
          }}
          labelFormatter={(label: unknown): string => {
            return formatTickTime(String(label ?? ""));
          }}
          /*
           * Recharts hardcodes a white tooltip background inline, and the label
           * inherits the page text colour, so it turns white-on-white in dark mode.
           */
          contentStyle={{
            fontSize: "11px",
            backgroundColor: "var(--ou-surface-primary)",
            border: "1px solid var(--ou-border-default)",
            borderRadius: "6px",
          }}
          labelStyle={{ color: "var(--ou-text-secondary)" }}
          /*
           * Pinned shut for the length of a drag: it would otherwise sit
           * over the very buckets the reader is picking a window from.
           */
          {...(selection.isDragging ? { active: false } : {})}
        />
      </>
    );

    // The window a drag in progress has covered so far.
    const selectionBand: ReactElement | null =
      selection.selectionStart && selection.selectionEnd ? (
        <ReferenceArea
          x1={selection.selectionStart}
          x2={selection.selectionEnd}
          fill="rgba(99,102,241,0.12)"
          stroke="rgba(99,102,241,0.5)"
          strokeWidth={1}
        />
      ) : null;

    if (isDuration) {
      if (seriesKeys.length === 1) {
        const singleSeriesColor: string = colorForSeries(
          seriesKeys[0] || "value",
          0,
        );
        return (
          <AreaChart
            data={pivotedData}
            margin={{ top: 6, right: 12, bottom: 2, left: 0 }}
            onMouseDown={selection.onMouseDown}
            onMouseMove={selection.onMouseMove}
            onMouseUp={selection.onMouseUp}
            {...chartCursor}
          >
            {sharedAxes}
            <Area
              dataKey={seriesKeys[0] || "value"}
              stroke={singleSeriesColor}
              strokeWidth={2}
              fill={hexToRgba(singleSeriesColor, 0.08)}
              dot={false}
              connectNulls={true}
              isAnimationActive={false}
            />
            {selectionBand}
          </AreaChart>
        );
      }
      return (
        <LineChart
          data={pivotedData}
          margin={{ top: 6, right: 12, bottom: 2, left: 0 }}
          onMouseDown={selection.onMouseDown}
          onMouseMove={selection.onMouseMove}
          onMouseUp={selection.onMouseUp}
          {...chartCursor}
        >
          {sharedAxes}
          {seriesKeys.map((key: string, index: number) => {
            return (
              <Line
                key={key}
                dataKey={key}
                stroke={colorForSeries(key, index)}
                strokeWidth={1.75}
                dot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            );
          })}
          {selectionBand}
        </LineChart>
      );
    }

    return (
      <BarChart
        data={pivotedData}
        margin={{ top: 6, right: 12, bottom: 2, left: 0 }}
        barCategoryGap="18%"
        barGap={0}
        onMouseDown={selection.onMouseDown}
        onMouseMove={selection.onMouseMove}
        onMouseUp={selection.onMouseUp}
        {...chartCursor}
      >
        {sharedAxes}
        {seriesKeys.map((key: string, index: number) => {
          return (
            <Bar
              key={key}
              dataKey={key}
              stackId="group"
              fill={colorForSeries(key, index)}
              isAnimationActive={false}
              maxBarSize={28}
            />
          );
        })}
        {selectionBand}
      </BarChart>
    );
  };

  return (
    <div className="group/zoomhint relative flex h-full w-full flex-col">
      {props.component.arguments.title && (
        <div className="mb-1 flex items-baseline gap-2 px-1">
          <div className="min-w-0 text-sm font-medium text-gray-700">
            {props.component.arguments.title}
          </div>
          <DashboardWidgetZoomHint
            zoom={timeRangeZoom}
            isChartShown={isChartShown}
            className="ml-auto"
          />
        </div>
      )}
      {seriesKeys.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 pb-1">
          {seriesKeys.map((key: string, index: number) => {
            return (
              <div key={key} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{
                    backgroundColor: colorForSeries(key, index),
                  }}
                />
                <span className="max-w-[180px] truncate text-[10px] text-gray-500">
                  {key}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {/*
       * The double-click lands here rather than on the chart so that it also
       * works on the "No data" state: a zoom into a quiet stretch leaves no
       * buckets to double-click, and the way back should be where the
       * pointer already is. It does nothing unless the board is zoomed, and
       * while it is armed the words in here are not selectable: a
       * double-click on text would also select a word.
       */}
      <div
        className={`min-h-0 flex-1 ${
          timeRangeZoom.onTimeRangeReset ? "select-none" : ""
        }`}
        onDoubleClick={selection.onDoubleClick}
      >
        {/*
         * The spinner stands in only while there is nothing to show yet (or
         * only an error). A reload with a chart on screen - a zoom refetches
         * straight away - dims the chart instead of swapping it out, so the
         * buckets the reader just dragged across stay put, and stay
         * double-clickable, until the answer lands.
         */}
        {isLoading && (pivotedData.length === 0 || Boolean(error)) && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && pivotedData.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            No data for the selected time range
          </div>
        )}
        {isChartShown && (
          <div
            className={`h-full w-full ${
              timeRangeZoom.onTimeRangeSelect
                ? "cursor-crosshair select-none"
                : ""
            }`}
            style={{
              opacity: isLoading ? 0.5 : 1,
              transition: "opacity 0.2s ease-in-out",
            }}
          >
            <ResponsiveContainer width="100%" height="100%">
              {renderChart()}
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/*
       * Untitled, which is how a new widget starts, there is no header row
       * for the hint, and adding one would take height from a small widget
       * for a line shown only on hover. It floats over the top corner
       * instead: after the chart, so the chart does not paint over it, and
       * it never takes the pointer from the chart beneath.
       */}
      {!props.component.arguments.title && (
        <DashboardWidgetZoomHint
          zoom={timeRangeZoom}
          isChartShown={isChartShown}
          className="absolute right-1 top-0"
        />
      )}
    </div>
  );
};

function arePropsEqual(prev: ComponentProps, next: ComponentProps): boolean {
  if (
    prev.componentId.toString() !== next.componentId.toString() ||
    prev.refreshTick !== next.refreshTick ||
    prev.isEditMode !== next.isEditMode ||
    prev.isSelected !== next.isSelected ||
    !DashboardWidgetTimeRangeZoom.isSameZoom(prev, next) ||
    prev.dashboardComponentWidthInPx !== next.dashboardComponentWidthInPx ||
    prev.dashboardComponentHeightInPx !== next.dashboardComponentHeightInPx
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(
      prev.dashboardStartAndEndDate,
      next.dashboardStartAndEndDate,
    )
  ) {
    return false;
  }

  if (
    !JSONFunctions.deepEqual(prev.component.arguments, next.component.arguments)
  ) {
    return false;
  }

  /*
   * Variable selections feed the request's attribute filter, so a toolbar
   * pick has to get past the memo — without this the widget keeps rendering
   * the pre-selection data.
   */
  return JSONFunctions.deepEqual(prev.variables, next.variables);
}

export default React.memo(DashboardTraceChartComponentElement, arePropsEqual);
