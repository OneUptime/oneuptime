import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import { PrometheusSeries } from "Common/Utils/PromQL/PrometheusResponse";
import ChartReferenceRegionProps from "Common/UI/Components/Charts/Types/ReferenceRegionProps";
import ChartTimeReferenceLineProps from "Common/UI/Components/Charts/Types/TimeReferenceLineProps";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Icon from "Common/UI/Components/Icon/Icon";
import ChartSkeleton from "Common/UI/Components/Skeleton/ChartSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { PromQLGraph } from "./PromQLQueryView";
import PromQLQueryUtil from "../../../Utils/PromQLQuery";
import { MetricChartThreshold } from "../Utils/MetricChartThresholds";

/*
 * A METRICS MONITOR'S PROMQL EXPRESSION, CHARTED (issue #10227): read as the
 * person viewing may read it, through the PromQL engine and limits of the
 * API (PromQLQueryUtil.queryMonitorRange), for the services the monitor
 * reads - every series of it, or the one an incident or alert opened for -
 * and drawn with the values its criteria alert at, the side that alerts
 * shaded, and the moments the page marks.
 *
 * While it reads, the chart's shape (ChartSkeleton), never a spinner, so
 * the card does not move when the lines arrive. The monitor's Overview
 * card, an incident's or an alert's metric card and the step on the
 * Criteria page all draw it.
 */

export const PROMQL_MONITOR_CHART_TEST_ID: string = "promql-monitor-chart";
export const PROMQL_MONITOR_CHART_EMPTY_TEST_ID: string =
  "promql-monitor-chart-empty";
export const PROMQL_MONITOR_CHART_CUT_TEST_ID: string =
  "promql-monitor-chart-cut";
export const PROMQL_MONITOR_CHART_ERROR_TEST_ID: string =
  "promql-monitor-chart-error";

// The chart's height while it loads: a chart group's plot.
const CHART_SKELETON_HEIGHT_IN_PX: number = 320;

export interface ComponentProps {
  query: string;
  window: InBetween<Date>;
  // The services the monitor reads; none: every service the viewer may read.
  serviceIds?: Array<string> | undefined;
  // The one series an incident or alert opened for; none: every series.
  seriesLabels?: JSONObject | undefined;
  thresholds?: Array<MetricChartThreshold> | undefined;
  timeReferenceLines?: Array<ChartTimeReferenceLineProps> | undefined;
  referenceRegions?: Array<ChartReferenceRegionProps> | undefined;
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  // Moves when the page wants the chart read again (its Refresh).
  refreshKey?: string | number | undefined;
  // Said in the chart's place when the expression returned no series.
  emptyState?: ReactNode | undefined;
}

type ReadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; series: Array<PrometheusSeries>; isCut: boolean };

const PromQLMonitorChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [read, setRead] = useState<ReadState>({ kind: "loading" });
  const readSequence: React.MutableRefObject<number> = useRef<number>(0);

  const startMs: number = props.window.startValue.getTime();
  const endMs: number = props.window.endValue.getTime();
  const serviceIdsKey: string = JSON.stringify(props.serviceIds || []);
  const seriesLabelsKey: string = props.seriesLabels
    ? JSON.stringify(props.seriesLabels)
    : "";

  useEffect(() => {
    const sequence: number = ++readSequence.current;

    // The chart keeps its place while it is read again, as its shape.
    setRead({ kind: "loading" });

    PromQLQueryUtil.queryMonitorRange({
      query: props.query,
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      serviceIds: props.serviceIds,
      seriesLabels: props.seriesLabels,
    })
      .then((answer: { series: Array<PrometheusSeries>; isCut: boolean }) => {
        // A slower, older read never overwrites a newer one.
        if (sequence === readSequence.current) {
          setRead({ kind: "done", series: answer.series, isCut: answer.isCut });
        }
      })
      .catch((error: unknown) => {
        if (sequence === readSequence.current) {
          setRead({ kind: "error", message: API.getFriendlyMessage(error) });
        }
      });
  }, [
    props.query,
    startMs,
    endMs,
    serviceIdsKey,
    seriesLabelsKey,
    props.refreshKey,
  ]);

  if (read.kind === "loading") {
    return <ChartSkeleton heightInPx={CHART_SKELETON_HEIGHT_IN_PX} />;
  }

  if (read.kind === "error") {
    return (
      <div
        className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        role="alert"
        data-testid={PROMQL_MONITOR_CHART_ERROR_TEST_ID}
      >
        <Icon icon={IconProp.Error} className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">
          <ErrorSentence
            template="The query did not run. {{error}}"
            error={read.message}
          />
        </span>
      </div>
    );
  }

  if (read.series.length === 0) {
    return (
      <div data-testid={PROMQL_MONITOR_CHART_EMPTY_TEST_ID}>
        {props.emptyState || (
          <p className="text-sm text-gray-600">
            {translator.translateText(
              "No series matched this query in the time range.",
            )}
          </p>
        )}
      </div>
    );
  }

  const thresholds: Array<MetricChartThreshold> = props.thresholds || [];

  return (
    <div className="space-y-2" data-testid={PROMQL_MONITOR_CHART_TEST_ID}>
      {read.isCut ? (
        <p
          className="flex items-center gap-1.5 text-xs text-gray-500"
          data-testid={PROMQL_MONITOR_CHART_CUT_TEST_ID}
        >
          <Icon icon={IconProp.Info} className="h-3.5 w-3.5 text-gray-400" />
          {translator.translatePlural(
            {
              one: "Showing the first {{count}} series this expression returns.",
              other:
                "Showing the first {{count}} series this expression returns.",
            },
            read.series.length,
          )}
        </p>
      ) : (
        <></>
      )}
      <div className="rounded-lg border border-gray-200 p-2 shadow-sm">
        <PromQLGraph
          series={read.series}
          window={props.window}
          query={props.query}
          thresholds={thresholds.length > 0 ? thresholds : undefined}
          timeReferenceLines={
            props.timeReferenceLines && props.timeReferenceLines.length > 0
              ? props.timeReferenceLines
              : undefined
          }
          referenceRegions={
            props.referenceRegions && props.referenceRegions.length > 0
              ? props.referenceRegions
              : undefined
          }
          onTimeRangeSelect={props.onTimeRangeSelect}
          onTimeRangeReset={props.onTimeRangeReset}
        />
      </div>
    </div>
  );
};

export default PromQLMonitorChart;
