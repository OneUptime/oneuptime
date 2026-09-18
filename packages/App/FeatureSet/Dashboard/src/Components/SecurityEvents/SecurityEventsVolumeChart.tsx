import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useMemo,
} from "react";
import TelemetryHistogram from "Common/UI/Components/TelemetryViewer/components/TelemetryHistogram";
import { HistogramSeriesOption } from "Common/UI/Components/TelemetryViewer/types";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import {
  SecurityEventSeverityCount,
  SecurityEventVolume,
  getSecurityEventVolumeSeries,
} from "./SecurityEventVolume";

export const SECURITY_EVENTS_VOLUME_TITLE: string = "Security Event Volume";

export const SECURITY_EVENTS_VOLUME_TEST_ID: string = "security-events-volume";

export interface ComponentProps {
  // null until the first count for this window has come back.
  volume: SecurityEventVolume | null;
  isLoading: boolean;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  onTimeRangeSelect?: ((startDate: Date, endDate: Date) => void) | undefined;
  onZoomOut?: (() => void) | undefined;
  // Controls laid out at the end of the totals row (the range picker).
  toolbar?: ReactNode | undefined;
}

/*
 * The totals row: how many events the window holds and how they split by
 * severity. The chart shows *when*; this is the "how many, how bad" read that
 * a stack of bars makes you add up in your head.
 */
const SeverityTotals: FunctionComponent<{
  volume: SecurityEventVolume | null;
  isLoading: boolean;
}> = (props: {
  volume: SecurityEventVolume | null;
  isLoading: boolean;
}): ReactElement => {
  if (!props.volume) {
    return (
      <span
        className="text-sm text-gray-400"
        data-testid={`${SECURITY_EVENTS_VOLUME_TEST_ID}-total`}
      >
        {props.isLoading ? "Counting events..." : ""}
      </span>
    );
  }

  const total: number = props.volume.total;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <span
        className="whitespace-nowrap text-sm text-gray-500"
        data-testid={`${SECURITY_EVENTS_VOLUME_TEST_ID}-total`}
      >
        <span className="font-semibold text-gray-900 tabular-nums">
          {total.toLocaleString()}
        </span>{" "}
        {total === 1 ? "event" : "events"}
      </span>
      {props.volume.countsBySeverity.length > 0 && (
        <ul
          className="flex flex-wrap items-center gap-x-3 gap-y-1"
          aria-label="Events by severity"
        >
          {props.volume.countsBySeverity.map(
            (item: SecurityEventSeverityCount) => {
              return (
                <li
                  key={item.severity}
                  className="flex items-center gap-1.5 whitespace-nowrap text-xs"
                  data-testid={`${SECURITY_EVENTS_VOLUME_TEST_ID}-severity-${item.severity}`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: item.color }}
                    aria-hidden="true"
                  />
                  <span className="text-gray-600">{item.severity}</span>
                  <span className="font-semibold text-gray-900 tabular-nums">
                    {item.count.toLocaleString()}
                  </span>
                </li>
              );
            },
          )}
        </ul>
      )}
    </div>
  );
};

/*
 * Same frame as the histogram's own, for the two states it does not draw: an
 * empty window (an axis with no bars reads as "still loading") and a failed
 * count.
 */
const ChartPlaceholder: FunctionComponent<{
  testId: string;
  children: ReactNode;
}> = (props: { testId: string; children: ReactNode }): ReactElement => {
  return (
    <div
      className="rounded-lg border border-gray-200 bg-white"
      data-testid={props.testId}
    >
      <div className="flex items-center border-b border-gray-100 px-4 py-2">
        <span className="text-xs font-medium text-gray-500">
          {SECURITY_EVENTS_VOLUME_TITLE}
        </span>
      </div>
      <div className="flex min-h-[120px] items-center justify-center px-4 text-center text-xs text-gray-400">
        {props.children}
      </div>
    </div>
  );
};

const SecurityEventsVolumeChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const series: Array<HistogramSeriesOption> = useMemo(() => {
    return getSecurityEventVolumeSeries();
  }, []);

  let chart: ReactElement;

  if (props.error) {
    chart = (
      <ChartPlaceholder testId={`${SECURITY_EVENTS_VOLUME_TEST_ID}-error`}>
        <ErrorMessage message={props.error} onRefreshClick={props.onRetry} />
      </ChartPlaceholder>
    );
  } else if (props.volume && props.volume.total === 0 && !props.isLoading) {
    chart = (
      <ChartPlaceholder testId={`${SECURITY_EVENTS_VOLUME_TEST_ID}-empty`}>
        No security events in this time range.
      </ChartPlaceholder>
    );
  } else {
    chart = (
      <TelemetryHistogram
        buckets={props.volume?.buckets || []}
        series={series}
        isLoading={props.isLoading}
        title={SECURITY_EVENTS_VOLUME_TITLE}
        onTimeRangeSelect={props.onTimeRangeSelect}
        onZoomOut={props.onZoomOut}
      />
    );
  }

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={SECURITY_EVENTS_VOLUME_TEST_ID}
      aria-busy={props.isLoading}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SeverityTotals
          volume={props.error ? null : props.volume}
          isLoading={props.isLoading}
        />
        {props.toolbar && (
          <div className="flex flex-wrap items-center gap-2">
            {props.toolbar}
          </div>
        )}
      </div>
      {chart}
    </div>
  );
};

export default SecurityEventsVolumeChart;
