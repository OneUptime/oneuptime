import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import Card from "Common/UI/Components/Card/Card";
import ResetTimeRangeZoomButton from "Common/UI/Components/Charts/TimeRangeZoom/ResetTimeRangeZoomButton";
import { TimeRangeZoomProvider } from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext";
import TimeRangeZoomHint from "Common/UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";
import useTimeRangeZoom, {
  TimeRangeZoom,
} from "Common/UI/Components/Charts/TimeRangeZoom/UseTimeRangeZoom";
import useHistogramRangeSelection, {
  HistogramRangeSelectionState,
} from "Common/UI/Components/Charts/Utils/useHistogramRangeSelection";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DEFAULT_EXCEPTION_TREND_WINDOW,
  EXCEPTION_TREND_WINDOWS,
  ExceptionTrendBucket,
  ExceptionTrendRow,
  ExceptionTrendSummary,
  ExceptionTrendWindow,
  ExceptionTrendWindowKey,
  buildExceptionTrendRows,
  formatOccurrenceCount,
  getExceptionTrendWindow,
  summarizeExceptionTrend,
} from "../../Utils/ExceptionDetailPresentation";
import ExceptionSegmentedControl from "./ExceptionSegmentedControl";
import {
  buildExceptionTrendZoomRequest,
  describeExceptionTrendZoomWindow,
  getExceptionTrendPresetTimeRange,
  isExceptionTrendIntraday,
} from "./ExceptionTrendZoom";

export const EXCEPTION_TREND_COLORS: { unhandled: string; handled: string } = {
  unhandled: "#ef4444",
  handled: "#f59e0b",
};

export interface ComponentProps {
  fingerprint: string | undefined;
  primaryEntityId?: ObjectID | undefined;
}

interface TrendTooltipProps {
  active?: boolean;
  payload?: Array<{ payload?: ExceptionTrendRow }>;
}

/*
 * A row as the chart draws it: the bucket start also as an ISO string, the
 * category label the drag selection reads back as a date (epoch
 * milliseconds would not parse as one).
 */
interface ExceptionTrendChartRow extends ExceptionTrendRow {
  time: string;
}

function formatTick(time: string, isIntraday: boolean): string {
  const date: Date = OneUptimeDate.fromString(time);

  if (isNaN(date.getTime())) {
    return time;
  }

  if (isIntraday) {
    return OneUptimeDate.getLocalTimeString(date, {
      use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
    });
  }

  return OneUptimeDate.getDateAsLocalDayMonthString(date);
}

const TrendTooltip: FunctionComponent<TrendTooltipProps> = (
  props: TrendTooltipProps,
): ReactElement => {
  const row: ExceptionTrendRow | undefined = props.payload?.[0]?.payload;

  if (!props.active || !row) {
    return <></>;
  }

  const total: number = row.unhandled + row.handled;

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-medium text-gray-900">
        {OneUptimeDate.getDateAsLocalShortDateTimeString(new Date(row.timeMs))}
      </div>
      <div className="mt-1 text-gray-600">
        {formatOccurrenceCount(total)} occurrence{total === 1 ? "" : "s"}
      </div>
      {total > 0 && (
        <div className="mt-1 space-y-0.5">
          {row.unhandled > 0 && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: EXCEPTION_TREND_COLORS.unhandled }}
              />
              Unhandled {formatOccurrenceCount(row.unhandled)}
            </div>
          )}
          {row.handled > 0 && (
            <div className="flex items-center gap-1.5 text-gray-600">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ backgroundColor: EXCEPTION_TREND_COLORS.handled }}
              />
              Handled {formatOccurrenceCount(row.handled)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/*
 * Occurrences of this one exception group over a selectable window, split
 * into unhandled and handled. The "is it getting worse, and since when?"
 * question the old metadata list could not answer.
 *
 * Drag across the bars to zoom into that stretch (issue #4105); a
 * double-click, or "Reset zoom" beside the window control, goes back to the
 * whole preset window. The zoom is the card's own: nothing else on the
 * Overview is windowed, and picking another preset ends it.
 */
const ExceptionOccurrenceTrend: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [windowKey, setWindowKey] = useState<ExceptionTrendWindowKey>(
    DEFAULT_EXCEPTION_TREND_WINDOW,
  );
  const [zoomWindow, setZoomWindow] = useState<InBetween<Date> | null>(null);
  const [buckets, setBuckets] = useState<Array<ExceptionTrendBucket>>([]);
  const [request, setRequest] = useState<JSONObject | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const trendWindow: ExceptionTrendWindow = getExceptionTrendWindow(windowKey);
  const primaryEntityId: string | undefined = props.primaryEntityId?.toString();

  /*
   * The chart's window as a range: the preset (relative, so going back to
   * it lands on "the last 24 hours" as of now) or the window a drag zoomed
   * to. The shared zoom keeps the preset to return to.
   */
  const presetRange: RangeStartAndEndDateTime = useMemo(() => {
    return { range: getExceptionTrendPresetTimeRange(windowKey) };
  }, [windowKey]);

  const chartRange: RangeStartAndEndDateTime = useMemo(() => {
    if (!zoomWindow) {
      return presetRange;
    }

    return { range: TimeRange.CUSTOM, startAndEndDate: zoomWindow };
  }, [zoomWindow, presetRange]);

  const applyChartRange: (range: RangeStartAndEndDateTime) => void =
    useCallback((range: RangeStartAndEndDateTime): void => {
      setZoomWindow(
        range.range === TimeRange.CUSTOM && range.startAndEndDate
          ? range.startAndEndDate
          : null,
      );
    }, []);

  const zoom: TimeRangeZoom = useTimeRangeZoom({
    timeRange: chartRange,
    onTimeRangeChange: applyChartRange,
  });

  useEffect(() => {
    const body: JSONObject | null = buildExceptionTrendZoomRequest({
      windowKey,
      fingerprint: props.fingerprint,
      primaryEntityId,
      zoomWindow,
    });

    setRequest(body);

    if (!body) {
      setBuckets([]);
      return;
    }

    let isCurrent: boolean = true;

    const load: () => Promise<void> = async (): Promise<void> => {
      // The previous window's buckets do not line up with the new axis.
      setBuckets([]);
      setIsLoading(true);
      setError(undefined);

      try {
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/exceptions/histogram",
            ),
            data: body,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (isCurrent) {
          setBuckets(
            ((response.data?.["buckets"] as unknown) ||
              []) as Array<ExceptionTrendBucket>,
          );
        }
      } catch (err) {
        if (isCurrent) {
          // Inline: a failed chart must not blank the Overview.
          setBuckets([]);
          setError(API.getFriendlyMessage(err));
        }
      }

      if (isCurrent) {
        setIsLoading(false);
      }
    };

    void load();

    return () => {
      isCurrent = false;
    };
  }, [windowKey, zoomWindow, props.fingerprint, primaryEntityId]);

  const rows: Array<ExceptionTrendChartRow> = useMemo(() => {
    return buildExceptionTrendRows(buckets, request).map(
      (row: ExceptionTrendRow): ExceptionTrendChartRow => {
        return { ...row, time: new Date(row.timeMs).toISOString() };
      },
    );
  }, [buckets, request]);

  const summary: ExceptionTrendSummary = useMemo(() => {
    return summarizeExceptionTrend(buckets);
  }, [buckets]);

  // How much time one bar covers, from the request that drew the bars.
  const bucketIntervalMs: number | undefined = useMemo(() => {
    const minutes: number = Number(request?.["bucketSizeInMinutes"]);

    return Number.isFinite(minutes) && minutes > 0
      ? minutes * 60 * 1000
      : undefined;
  }, [request]);

  /*
   * Only a drag zooms; a plain click on a bar does not. The shared selection
   * hook zooms into one bar on a click whenever it knows the bucket width -
   * right for an explorer's volume chart, which exists to narrow the list
   * beneath it - but here a click is how a reader points at a bar to read
   * its tooltip. So the width is withheld from the hook, which makes a
   * single bar no window at all, and added back here for a real drag: the
   * hook hands over the starts of the first and last bars dragged across,
   * and the zoom runs to the end of the last one.
   */
  const zoomToDraggedBars: (
    firstBucketStart: Date,
    lastBucketStart: Date,
  ) => void = useCallback(
    (firstBucketStart: Date, lastBucketStart: Date): void => {
      zoom.zoomToTimeRange(
        firstBucketStart,
        new Date(lastBucketStart.getTime() + (bucketIntervalMs || 0)),
      );
    },
    [zoom.zoomToTimeRange, bucketIntervalMs],
  );

  const selection: HistogramRangeSelectionState = useHistogramRangeSelection({
    onTimeRangeSelect: zoomToDraggedBars,
    onZoomOut: zoom.isZoomed ? zoom.resetZoom : undefined,
  });

  const isIntraday: boolean = zoomWindow
    ? isExceptionTrendIntraday(
        zoomWindow.endValue.getTime() - zoomWindow.startValue.getTime(),
      )
    : windowKey === ExceptionTrendWindowKey.Day;

  const windowPhrase: string = zoomWindow
    ? describeExceptionTrendZoomWindow(zoomWindow)
    : `in the ${trendWindow.description}`;

  const description: string = !props.fingerprint
    ? "No fingerprint was recorded, so occurrences cannot be charted."
    : isLoading && buckets.length === 0
      ? zoomWindow
        ? "Loading occurrences for the selected window…"
        : `Loading occurrences for the ${trendWindow.description}…`
      : `${formatOccurrenceCount(summary.total)} occurrence${
          summary.total === 1 ? "" : "s"
        } ${windowPhrase}`;

  const renderBody: () => ReactElement = (): ReactElement => {
    if (!props.fingerprint) {
      return <></>;
    }

    if (error) {
      return (
        <div
          className="flex h-44 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 text-center"
          data-testid="exception-trend-error"
        >
          <Icon icon={IconProp.Alert} className="h-5 w-5 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">
            Could not load the occurrence trend
          </p>
          <p className="text-xs text-gray-500">{error}</p>
        </div>
      );
    }

    if (isLoading && buckets.length === 0) {
      return (
        <div className="flex h-44 items-center justify-center">
          <ComponentLoader />
        </div>
      );
    }

    if (summary.total === 0) {
      /*
       * A zoom into a quiet stretch lands here, with no bars left to
       * double-click. The empty area takes the double-click instead, so the
       * way back is where the reader's pointer already is. select-none: a
       * double-click on the message would otherwise also select a word.
       */
      return (
        <div
          className="flex h-44 select-none flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 text-center"
          data-testid="exception-trend-empty"
          onDoubleClick={zoom.isZoomed ? zoom.resetZoom : undefined}
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 text-emerald-500"
          />
          <p className="text-sm font-medium text-gray-700">
            {zoomWindow
              ? "No occurrences in the selected window"
              : `No occurrences in the ${trendWindow.description}`}
          </p>
          <p className="text-xs text-gray-500">
            {zoomWindow
              ? `Double-click here or reset the zoom to see the ${trendWindow.description}.`
              : "Try a longer window to see when it last happened."}
          </p>
        </div>
      );
    }

    return (
      <div data-testid="exception-trend-chart">
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: EXCEPTION_TREND_COLORS.unhandled }}
            />
            Unhandled
            <span className="font-semibold tabular-nums text-gray-900">
              {formatOccurrenceCount(summary.unhandled)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: EXCEPTION_TREND_COLORS.handled }}
            />
            Handled
            <span className="font-semibold tabular-nums text-gray-900">
              {formatOccurrenceCount(summary.handled)}
            </span>
          </span>
          {summary.peakTime && (
            <span className="text-gray-500">
              Peak{" "}
              <span className="font-semibold tabular-nums text-gray-900">
                {formatOccurrenceCount(summary.peakCount)}
              </span>{" "}
              at{" "}
              {OneUptimeDate.getDateAsLocalShortDateTimeString(
                OneUptimeDate.fromString(summary.peakTime),
              )}
            </span>
          )}
          <TimeRangeZoomHint className="ml-auto" />
        </div>
        <div
          className="h-44 select-none"
          style={{ cursor: "crosshair" }}
          data-testid="exception-trend-plot"
          onDoubleClick={selection.onDoubleClick}
        >
          {/*
           * The crosshair goes on the chart root itself: recharts sets an
           * inline `cursor: default` on the .recharts-wrapper that fills the
           * plot, so the cursor on the box around it never shows over the
           * bars. The card always zooms, so it is always there.
           */}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
              barCategoryGap="20%"
              onMouseDown={selection.onMouseDown}
              {...selection.chartRootProps}
              onMouseMove={selection.onMouseMove}
              onMouseUp={selection.onMouseUp}
              style={{ cursor: "crosshair" }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--ou-chart-grid, #f3f4f6)"
              />
              <XAxis
                dataKey="time"
                tickFormatter={(value: string): string => {
                  return formatTick(value, isIntraday);
                }}
                tick={{ fontSize: 11, fill: "var(--ou-chart-tick, #9ca3af)" }}
                axisLine={{ stroke: "var(--ou-chart-grid, #e5e7eb)" }}
                tickLine={false}
                minTickGap={32}
                interval="preserveStartEnd"
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: "var(--ou-chart-tick, #9ca3af)" }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              {/*
               * Pinned shut for the length of a drag: it would otherwise sit
               * over the very bars the reader is picking.
               */}
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                content={<TrendTooltip />}
                {...(selection.isDragging ? { active: false } : {})}
              />
              <Bar
                dataKey="unhandled"
                stackId="occurrences"
                fill={EXCEPTION_TREND_COLORS.unhandled}
                isAnimationActive={false}
                maxBarSize={28}
              />
              <Bar
                dataKey="handled"
                stackId="occurrences"
                fill={EXCEPTION_TREND_COLORS.handled}
                radius={[2, 2, 0, 0]}
                isAnimationActive={false}
                maxBarSize={28}
              />
              {selection.selectionStart && selection.selectionEnd && (
                <ReferenceArea
                  x1={selection.selectionStart}
                  x2={selection.selectionEnd}
                  fill="rgba(99,102,241,0.12)"
                  stroke="rgba(99,102,241,0.5)"
                  strokeWidth={1}
                  radius={2}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  /*
   * The card's zoom reaches its own header ("Reset zoom", the only way back
   * for keyboard users) and hint. It also keeps any zoom a surrounding page
   * might offer away from this chart, which has its own window.
   */
  return (
    <TimeRangeZoomProvider zoom={zoom}>
      <Card
        title="Occurrence Trend"
        description={description}
        rightElement={
          props.fingerprint ? (
            <div className="flex items-center gap-2">
              <ResetTimeRangeZoomButton />
              <ExceptionSegmentedControl<ExceptionTrendWindowKey>
                label="Trend window"
                testId="exception-trend-window"
                value={windowKey}
                onChange={(key: ExceptionTrendWindowKey): void => {
                  // A new preset is a new starting point; any zoom is over.
                  setZoomWindow(null);
                  setWindowKey(key);
                }}
                options={EXCEPTION_TREND_WINDOWS.map(
                  (option: ExceptionTrendWindow) => {
                    return {
                      value: option.key,
                      label: option.label,
                      title: `Show the ${option.description}`,
                    };
                  },
                )}
              />
            </div>
          ) : undefined
        }
      >
        {renderBody()}
      </Card>
    </TimeRangeZoomProvider>
  );
};

export default ExceptionOccurrenceTrend;
