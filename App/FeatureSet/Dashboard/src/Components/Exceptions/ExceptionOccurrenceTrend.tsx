import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
  buildExceptionTrendRequest,
  buildExceptionTrendRows,
  formatOccurrenceCount,
  getExceptionTrendWindow,
  summarizeExceptionTrend,
} from "../../Utils/ExceptionDetailPresentation";
import ExceptionSegmentedControl from "./ExceptionSegmentedControl";

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

function formatTick(
  timeMs: number,
  windowKey: ExceptionTrendWindowKey,
): string {
  const date: Date = new Date(timeMs);

  if (windowKey === ExceptionTrendWindowKey.Day) {
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
 */
const ExceptionOccurrenceTrend: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [windowKey, setWindowKey] = useState<ExceptionTrendWindowKey>(
    DEFAULT_EXCEPTION_TREND_WINDOW,
  );
  const [buckets, setBuckets] = useState<Array<ExceptionTrendBucket>>([]);
  const [request, setRequest] = useState<JSONObject | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const trendWindow: ExceptionTrendWindow = getExceptionTrendWindow(windowKey);
  const primaryEntityId: string | undefined = props.primaryEntityId?.toString();

  useEffect(() => {
    const body: JSONObject | null = buildExceptionTrendRequest({
      windowKey,
      fingerprint: props.fingerprint,
      primaryEntityId,
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
  }, [windowKey, props.fingerprint, primaryEntityId]);

  const rows: Array<ExceptionTrendRow> = useMemo(() => {
    return buildExceptionTrendRows(buckets, request);
  }, [buckets, request]);

  const summary: ExceptionTrendSummary = useMemo(() => {
    return summarizeExceptionTrend(buckets);
  }, [buckets]);

  const description: string = !props.fingerprint
    ? "No fingerprint was recorded, so occurrences cannot be charted."
    : isLoading && buckets.length === 0
      ? `Loading occurrences for the ${trendWindow.description}…`
      : `${formatOccurrenceCount(summary.total)} occurrence${
          summary.total === 1 ? "" : "s"
        } in the ${trendWindow.description}`;

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
      return (
        <div
          className="flex h-44 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-200 text-center"
          data-testid="exception-trend-empty"
        >
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 text-emerald-500"
          />
          <p className="text-sm font-medium text-gray-700">
            No occurrences in the {trendWindow.description}
          </p>
          <p className="text-xs text-gray-500">
            Try a longer window to see when it last happened.
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
        </div>
        <div className="h-44 select-none">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={rows}
              margin={{ top: 4, right: 4, bottom: 0, left: -12 }}
              barCategoryGap="20%"
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--ou-chart-grid, #f3f4f6)"
              />
              <XAxis
                dataKey="timeMs"
                tickFormatter={(value: number): string => {
                  return formatTick(value, windowKey);
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
              <Tooltip
                cursor={{ fill: "rgba(99,102,241,0.06)" }}
                content={<TrendTooltip />}
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
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  };

  return (
    <Card
      title="Occurrence Trend"
      description={description}
      rightElement={
        props.fingerprint ? (
          <ExceptionSegmentedControl<ExceptionTrendWindowKey>
            label="Trend window"
            testId="exception-trend-window"
            value={windowKey}
            onChange={setWindowKey}
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
        ) : undefined
      }
    >
      {renderBody()}
    </Card>
  );
};

export default ExceptionOccurrenceTrend;
