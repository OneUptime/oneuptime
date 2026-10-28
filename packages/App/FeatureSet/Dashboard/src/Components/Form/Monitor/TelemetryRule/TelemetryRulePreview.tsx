import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import TelemetryRulePreviewUtil, {
  TelemetryRulePreviewAnswer,
  TelemetryRulePreviewPoint,
  TelemetryRulePreviewSummary,
} from "Common/Types/Monitor/TelemetryRulePreview";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import BarChartElement from "Common/UI/Components/Charts/Bar/BarChart";
import SeriesPoint from "Common/UI/Components/Charts/Types/SeriesPoints";
import {
  XAxis,
  XAxisAggregateType,
} from "Common/UI/Components/Charts/Types/XAxis/XAxis";
import XAxisPrecision from "Common/UI/Components/Charts/Types/XAxis/XAxisPrecision";
import XAxisType from "Common/UI/Components/Charts/Types/XAxis/XAxisType";
import YAxis, {
  YAxisPrecision,
} from "Common/UI/Components/Charts/Types/YAxis/YAxis";
import YAxisType from "Common/UI/Components/Charts/Types/YAxis/YAxisType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getPreviewCaption,
  getPreviewVerdict,
  TelemetryRuleCopy,
} from "../../../../Utils/Form/Monitor/TelemetryRule/TelemetryRuleText";

/*
 * What a Logs, Traces or Exceptions rule would have caught: the monitor's
 * count for every window of its length, back over the last hours
 * (POST /telemetry/<signal>/monitor-preview, the check's own query), as
 * bars under the rule's threshold - with how many times it would have
 * alerted, what is normal, and a value that would have stayed quiet.
 */

export interface ComponentProps {
  monitorType: MonitorType;
  /*
   * The step's settings for the signal, as the preview endpoint reads them
   * (MonitorStepLogMonitorUtil.toJSON and its kin). The preview reads again
   * when they change, a moment after the last change.
   */
  settings: JSONObject;
  filterType: FilterType;
  threshold: number | undefined;
  // Grouped Logs monitors count each group on their own; the preview does not.
  isGrouped?: boolean | undefined;
  onUseSuggestedThreshold?: ((value: number) => void) | undefined;
}

// How long the preview waits after the last change before it reads again.
export const PREVIEW_READ_DELAY_IN_MS: number = 600;

export const getPreviewRoute: (monitorType: MonitorType) => string = (
  monitorType: MonitorType,
): string => {
  switch (monitorType) {
    case MonitorType.Traces:
      return "/telemetry/traces/monitor-preview";
    case MonitorType.Exceptions:
      return "/telemetry/exceptions/monitor-preview";
    default:
      return "/telemetry/logs/monitor-preview";
  }
};

// The chart's step: the window, or the nearest one the chart has.
const getPrecision: (windowInSeconds: number) => XAxisPrecision = (
  windowInSeconds: number,
): XAxisPrecision => {
  const precisions: Array<[number, XAxisPrecision]> = [
    [86400, XAxisPrecision.EVERY_DAY],
    [43200, XAxisPrecision.EVERY_TWELVE_HOURS],
    [21600, XAxisPrecision.EVERY_SIX_HOURS],
    [3600, XAxisPrecision.EVERY_HOUR],
    [1800, XAxisPrecision.EVERY_THIRTY_MINUTES],
    [900, XAxisPrecision.EVERY_FIFTEEN_MINUTES],
    [600, XAxisPrecision.EVERY_TEN_MINUTES],
    [300, XAxisPrecision.EVERY_FIVE_MINUTES],
    [60, XAxisPrecision.EVERY_MINUTE],
    [30, XAxisPrecision.EVERY_THIRTY_SECONDS],
    [10, XAxisPrecision.EVERY_TEN_SECONDS],
    [5, XAxisPrecision.EVERY_FIVE_SECONDS],
  ];

  for (const [seconds, precision] of precisions) {
    if (windowInSeconds >= seconds) {
      return precision;
    }
  }

  return XAxisPrecision.EVERY_FIVE_SECONDS;
};

const TelemetryRulePreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const settingsKey: string = JSON.stringify(props.settings);

  const [answer, setAnswer] = useState<TelemetryRulePreviewAnswer | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [retryNonce, setRetryNonce] = useState<number>(0);

  useEffect(() => {
    let isCancelled: boolean = false;

    setIsLoading(true);
    setError("");

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          getPreviewRoute(props.monitorType),
        ),
        data: JSON.parse(settingsKey) as JSONObject,
        headers: {
          ...ModelAPI.getCommonHeaders(),
        },
      })
        .then((response: HTTPResponse<JSONObject> | HTTPErrorResponse) => {
          if (isCancelled) {
            return;
          }

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }

          setAnswer(response.data as unknown as TelemetryRulePreviewAnswer);
          setIsLoading(false);
        })
        .catch((err: unknown) => {
          if (isCancelled) {
            return;
          }

          setAnswer(null);
          setError(API.getFriendlyMessage(err as Error));
          setIsLoading(false);
        });
    }, PREVIEW_READ_DELAY_IN_MS);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [settingsKey, props.monitorType, retryNonce]);

  const points: Array<TelemetryRulePreviewPoint> = useMemo(() => {
    return answer ? TelemetryRulePreviewUtil.toPoints(answer) : [];
  }, [answer]);

  const summary: TelemetryRulePreviewSummary = useMemo(() => {
    return TelemetryRulePreviewUtil.summarize({
      points,
      filterType: props.filterType,
      threshold: props.threshold,
    });
  }, [points, props.filterType, props.threshold]);

  const suggestion: number | undefined = useMemo(() => {
    return TelemetryRulePreviewUtil.suggestThreshold({
      points,
      filterType: props.filterType,
    });
  }, [points, props.filterType]);

  if (isLoading) {
    return (
      <div
        className="mt-4 flex h-44 items-center justify-center rounded-lg border border-dashed border-gray-200 text-sm text-gray-500"
        data-testid="telemetry-rule-preview-loading"
        aria-live="polite"
      >
        {translator.translateText("Counting what this rule would have seen…")}
      </div>
    );
  }

  if (error || !answer) {
    return (
      <div
        className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600"
        data-testid="telemetry-rule-preview-error"
        role="status"
      >
        <span className="min-w-0">
          {translator.translateTemplate(
            "The preview could not be counted: {{reason}}",
            { reason: error },
          )}
        </span>
        {/* md:-ml-3 takes back the Button's own md:ml-3. */}
        <div className="md:-ml-3">
          <Button
            title="Try again"
            buttonSize={ButtonSize.Small}
            buttonStyle={ButtonStyleType.NORMAL}
            icon={IconProp.Refresh}
            onClick={() => {
              setRetryNonce(retryNonce + 1);
            }}
          />
        </div>
      </div>
    );
  }

  const windowInSeconds: number = answer.windowInSeconds;
  const startTime: Date = OneUptimeDate.fromString(answer.startTime);
  const endTime: Date = OneUptimeDate.fromString(answer.endTime);
  const rangeInSeconds: number = Math.round(
    (endTime.getTime() - startTime.getTime()) / 1000,
  );

  const series: Array<SeriesPoint> = [
    {
      seriesName: translator.translateText("Matching") || "Matching",
      data: points.map((point: TelemetryRulePreviewPoint) => {
        return { x: point.time, y: point.value };
      }),
    },
  ];

  const xAxis: XAxis = {
    legend: "Time",
    options: {
      type: XAxisType.Time,
      min: startTime,
      max: endTime,
      aggregateType: XAxisAggregateType.Sum,
      precision: getPrecision(windowInSeconds),
    },
  };

  const yAxis: YAxis = {
    legend: "",
    options: {
      type: YAxisType.Number,
      min: 0,
      max: "auto",
      formatter: (value: number): string => {
        return translator.formatNumber(value);
      },
      precision: YAxisPrecision.NoDecimals,
    },
  };

  /*
   * Whether the verdict is a warning: the rule would have alerted, or with
   * nothing in any window, a rule for "no logs" would alert at once.
   */
  const willAlert: boolean = summary.hasData
    ? summary.timesItWouldHaveFired > 0
    : TelemetryRulePreviewUtil.isMatched({
        filterType: props.filterType,
        threshold: props.threshold,
        value: 0,
      });

  const hasThreshold: boolean =
    props.threshold !== undefined &&
    props.filterType !== FilterType.AnomalouslyHigh &&
    props.filterType !== FilterType.AnomalouslyLow &&
    props.filterType !== FilterType.Anomalous;

  return (
    <div className="mt-4" data-testid="telemetry-rule-preview">
      <p className="text-sm text-gray-500">
        {getPreviewCaption({
          monitorType: props.monitorType,
          windowInSeconds,
          rangeInSeconds,
          translator,
        })}
      </p>

      <div className="mt-2 h-44 w-full">
        <BarChartElement
          data={series}
          xAxis={xAxis}
          yAxis={yAxis}
          sync={false}
          syncid="telemetry-rule-preview"
          heightInPx={176}
          showLegend={false}
          disableTimeRangeZoom={true}
          referenceLines={
            hasThreshold
              ? [
                  {
                    value: props.threshold as number,
                    color: "#e11d48",
                    strokeDasharray: "4 4",
                  },
                ]
              : undefined
          }
        />
      </div>

      <div className="mt-3 min-w-0 space-y-1">
        <div
          className="flex items-start gap-2 text-sm font-medium text-gray-900"
          data-testid="telemetry-rule-preview-verdict"
        >
          <Icon
            icon={willAlert ? IconProp.Alert : IconProp.CheckCircle}
            className={`mt-0.5 h-4 w-4 flex-none ${
              willAlert ? "text-rose-600" : "text-emerald-600"
            }`}
          />
          <span>
            {hasThreshold
              ? getPreviewVerdict({
                  summary,
                  windowInSeconds,
                  matchesNothing: TelemetryRulePreviewUtil.isMatched({
                    filterType: props.filterType,
                    threshold: props.threshold,
                    value: 0,
                  }),
                  translator,
                })
              : translator.translateText(TelemetryRuleCopy.anomalyHint)}
          </span>
        </div>
        {summary.hasData ? (
          <p
            className="text-sm text-gray-500"
            data-testid="telemetry-rule-preview-facts"
          >
            {translator.translateTemplate(
              "Highest: {{highest}} · Usually: {{typical}} · Latest: {{latest}}",
              {
                highest: translator.formatNumber(summary.highest),
                typical: translator.formatNumber(summary.typical),
                latest: translator.formatNumber(summary.latest || 0),
              },
            )}
          </p>
        ) : (
          <></>
        )}
        {props.isGrouped ? (
          <p className="text-sm text-gray-500">
            {translator.translateText(TelemetryRuleCopy.groupedHint)}
          </p>
        ) : (
          <></>
        )}
      </div>

      {/*
       * A number the rule would not have passed, said as what it means
       * beside the button that uses it: "Use 48" alone did not say why 48.
       */}
      {suggestion !== undefined &&
      suggestion !== props.threshold &&
      props.onUseSuggestedThreshold ? (
        <div
          className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2"
          data-testid="telemetry-rule-preview-suggestion"
        >
          <p className="min-w-0 text-sm text-gray-600">
            {translator.translateTemplate(
              "At {{value}}, this rule would not have alerted in this time.",
              {
                value: translator.formatNumber(suggestion),
              },
            )}
          </p>
          {/* The wrapper takes off the Button's own dialog-footer margin. */}
          <div className="flex-none [&>button]:ml-0 [&>button]:md:ml-0 [&>*>button]:ml-0 [&>*>button]:md:ml-0">
            <Button
              title={translator.translateTemplate("Use {{value}}", {
                value: translator.formatNumber(suggestion),
              })}
              buttonSize={ButtonSize.Small}
              buttonStyle={ButtonStyleType.NORMAL}
              icon={IconProp.Bolt}
              dataTestId="telemetry-rule-preview-use-suggestion"
              onClick={() => {
                props.onUseSuggestedThreshold?.(suggestion);
              }}
            />
          </div>
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default TelemetryRulePreview;
