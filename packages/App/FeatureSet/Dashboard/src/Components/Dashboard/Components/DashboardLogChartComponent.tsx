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
import DashboardLogChartComponent from "Common/Types/Dashboard/DashboardComponents/DashboardLogChartComponent";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { RangeStartAndEndDateTimeUtil } from "Common/Types/Time/RangeStartAndEndDateTime";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import JSONFunctions from "Common/Types/JSONFunctions";
import HistogramTooltip from "Common/UI/Components/LogsViewer/components/HistogramTooltip";
import {
  SeverityColor,
  getSeverityColor,
} from "Common/UI/Components/LogsViewer/components/severityColors";
import { DashboardBaseComponentProps } from "./DashboardBaseComponent";
import {
  LogHistogramBucket,
  LogChartTimeRange,
  buildLogHistogramRequest,
  formatLogChartTickTime,
  formatLogCount,
  pivotLogHistogramBuckets,
  resolveLogChartType,
} from "./LogChartData";
import DashboardResourceList from "../Utils/DashboardResourceList";
import DashboardChartType from "Common/Types/Dashboard/Chart/ChartType";
import { HistogramRangeSelectionState } from "Common/UI/Components/Charts/Utils/useHistogramRangeSelection";
import DashboardWidgetTimeRangeZoom, {
  DashboardWidgetTimeRangeZoomHandlers,
} from "../Utils/DashboardWidgetTimeRangeZoom";
import useDashboardHistogramZoom from "../Utils/UseDashboardHistogramZoom";
import DashboardWidgetZoomHint from "./DashboardWidgetZoomHint";

export interface ComponentProps extends DashboardBaseComponentProps {
  component: DashboardLogChartComponent;
}

const DashboardLogChartComponentElement: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [buckets, setBuckets] = useState<Array<LogHistogramBucket>>([]);
  const [chartTimeRange, setChartTimeRange] =
    useState<LogChartTimeRange | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const requestSequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestSequence: number = ++requestSequenceRef.current;
      const isStale: () => boolean = (): boolean => {
        return requestSequence !== requestSequenceRef.current;
      };

      setIsLoading(true);

      if (DashboardResourceList.isPublic()) {
        setBuckets([]);
        setChartTimeRange(null);
        setIsLoading(false);
        setError("Log charts are not available on public dashboards.");
        return;
      }

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
        const requestData: JSONObject = buildLogHistogramRequest({
          arguments: props.component.arguments,
          startTime: startAndEndDate.startValue,
          endTime: startAndEndDate.endValue,
          variables: props.variables,
        });

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/logs/histogram",
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

        setBuckets(
          (response.data["buckets"] ||
            []) as unknown as Array<LogHistogramBucket>,
        );
        setChartTimeRange({
          startTime: startAndEndDate.startValue,
          endTime: startAndEndDate.endValue,
          bucketSizeInMinutes: Number(requestData["bucketSizeInMinutes"]),
        });
        setError(null);
      } catch (err: unknown) {
        if (isStale()) {
          return;
        }
        setBuckets([]);
        setChartTimeRange(null);
        setError(API.getFriendlyErrorMessage(err as Error));
      }

      if (!isStale()) {
        setIsLoading(false);
      }
    }, [
      props.dashboardStartAndEndDate,
      props.component.arguments.severityFilters,
      props.component.arguments.bodyContains,
      props.component.arguments.attributeFilters,
      props.component.arguments.attributeFilterQuery,
      props.variables,
    ]);

  useEffect(() => {
    void fetchData();
  }, [fetchData, props.refreshTick]);

  const { pivotedData, severities } = useMemo(() => {
    return pivotLogHistogramBuckets(buckets, chartTimeRange || undefined);
  }, [buckets, chartTimeRange]);

  /*
   * Drag-to-zoom retimes the whole board, the gesture every time-series
   * panel on it answers to: the window goes up to the dashboard shell and
   * comes back down as dashboardStartAndEndDate, which refetches this
   * histogram with it. None in edit mode; the reset only while zoomed.
   */
  const timeRangeZoom: DashboardWidgetTimeRangeZoomHandlers =
    DashboardWidgetTimeRangeZoom.getHandlers(props);

  const selection: HistogramRangeSelectionState = useDashboardHistogramZoom({
    zoom: timeRangeZoom,
    fetchedWindow: chartTimeRange,
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

  const includeDateInTicks: boolean = Boolean(
    chartTimeRange &&
      chartTimeRange.endTime.getTime() - chartTimeRange.startTime.getTime() >
        24 * 60 * 60 * 1000,
  );
  const chartType: DashboardChartType = resolveLogChartType(
    props.component.arguments.chartType,
  );

  const sharedChartElements: ReactElement = (
    <>
      <CartesianGrid
        strokeDasharray="none"
        stroke="var(--ou-chart-grid, #f1f5f9)"
        vertical={false}
      />
      <XAxis
        dataKey="time"
        tickFormatter={(time: string): string => {
          return formatLogChartTickTime(time, includeDateInTicks);
        }}
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
        allowDecimals={false}
        tickFormatter={formatLogCount}
      />
      {/*
       * Pinned shut for the length of a drag: it would otherwise sit over
       * the very bars the reader is picking a window from. Dropping the
       * prop hands control back to recharts once the drag ends.
       */}
      <Tooltip
        content={<HistogramTooltip />}
        cursor={{ fill: "rgba(99,102,241,0.04)" }}
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

  const renderChart: () => ReactElement = (): ReactElement => {
    const margin: { top: number; right: number; bottom: number; left: number } =
      { top: 6, right: 12, bottom: 2, left: 0 };

    if (chartType === DashboardChartType.Line) {
      return (
        <LineChart
          data={pivotedData}
          margin={margin}
          onMouseDown={selection.onMouseDown}
          {...selection.chartRootProps}
          onMouseMove={selection.onMouseMove}
          onMouseUp={selection.onMouseUp}
          {...chartCursor}
        >
          {sharedChartElements}
          {severities.map((severity: string) => {
            return (
              <Line
                key={severity}
                dataKey={severity}
                stroke={getSeverityColor(severity).fill}
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

    if (chartType === DashboardChartType.Area) {
      return (
        <AreaChart
          data={pivotedData}
          margin={margin}
          onMouseDown={selection.onMouseDown}
          {...selection.chartRootProps}
          onMouseMove={selection.onMouseMove}
          onMouseUp={selection.onMouseUp}
          {...chartCursor}
        >
          {sharedChartElements}
          {severities.map((severity: string) => {
            const fill: string = getSeverityColor(severity).fill;
            return (
              <Area
                key={severity}
                dataKey={severity}
                stackId="severity"
                stroke={fill}
                strokeWidth={1.5}
                fill={fill}
                fillOpacity={0.28}
                dot={false}
                connectNulls={true}
                isAnimationActive={false}
              />
            );
          })}
          {selectionBand}
        </AreaChart>
      );
    }

    return (
      <BarChart
        data={pivotedData}
        margin={margin}
        barCategoryGap="18%"
        barGap={0}
        onMouseDown={selection.onMouseDown}
        {...selection.chartRootProps}
        onMouseMove={selection.onMouseMove}
        onMouseUp={selection.onMouseUp}
        {...chartCursor}
      >
        {sharedChartElements}
        {severities.map((severity: string, index: number) => {
          return (
            <Bar
              key={severity}
              dataKey={severity}
              stackId="severity"
              fill={getSeverityColor(severity).fill}
              radius={
                index === severities.length - 1 ? [3, 3, 0, 0] : [0, 0, 0, 0]
              }
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

      {severities.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-1 pb-1">
          {severities.map((severity: string) => {
            const color: SeverityColor = getSeverityColor(severity);
            return (
              <div key={severity} className="flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-[2px]"
                  style={{ backgroundColor: color.fill }}
                />
                <span className="text-[10px] text-gray-500">
                  {color.label || severity}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/*
       * The double-click lands here rather than on the chart so that it also
       * works on the "No logs" state: a zoom into a quiet stretch leaves no
       * bars to double-click, and the way back should be where the pointer
       * already is. It does nothing unless the board is zoomed, and while it
       * is armed the words in here are not selectable: a double-click on
       * text would also select a word.
       */}
      <div
        className={`min-h-0 flex-1 ${
          timeRangeZoom.onTimeRangeReset ? "select-none" : ""
        }`}
        onDoubleClick={selection.onDoubleClick}
      >
        {isLoading && buckets.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <ComponentLoader />
          </div>
        )}
        {!isLoading && error && <ErrorMessage message={error} />}
        {!isLoading && !error && pivotedData.length === 0 && (
          <div className="flex h-full items-center justify-center text-xs text-gray-400">
            No logs for the selected time range and filters
          </div>
        )}
        {isChartShown && (
          /*
           * Dimmed, not replaced, while a new window loads: a zoom refetches
           * straight away, and the bars the reader just dragged across
           * should stay put (and double-clickable) until the answer lands.
           */
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

  return (
    JSONFunctions.deepEqual(
      prev.component.arguments,
      next.component.arguments,
    ) && JSONFunctions.deepEqual(prev.variables, next.variables)
  );
}

export default React.memo(DashboardLogChartComponentElement, arePropsEqual);
