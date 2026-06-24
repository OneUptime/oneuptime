import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  AutoRefreshInterval,
  getAutoRefreshIntervalInMs,
  getAutoRefreshIntervalLabel,
} from "Common/Types/Dashboard/DashboardViewConfig";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

interface CountdownCircleProps {
  // Length of one auto-refresh cycle.
  durationMs: number;
  /*
   * Bumps whenever a refresh completes (the page's last-refreshed timestamp)
   * so the ring restarts in sync with the data actually reloading.
   */
  resetKey: number;
  isRefreshing: boolean;
}

/*
 * A small grey ring that drains over one auto-refresh interval, restarting
 * each time the page refreshes. It replaces the old "Updated X ago" text — a
 * glanceable countdown to the next refresh instead of a timestamp.
 */
const CountdownCircle: FunctionComponent<CountdownCircleProps> = (
  props: CountdownCircleProps,
): ReactElement => {
  const SIZE: number = 18;
  const STROKE_WIDTH: number = 2;

  const [progress, setProgress] = useState<number>(0);
  const startTimeRef: React.MutableRefObject<number> = useRef<number>(
    Date.now(),
  );
  const animationFrameRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);

  const animate: () => void = useCallback((): void => {
    const elapsed: number = Date.now() - startTimeRef.current;
    const newProgress: number = Math.min(elapsed / props.durationMs, 1);
    setProgress(newProgress);
    if (newProgress >= 1) {
      // Roll straight into the next cycle so the ring never sits empty.
      startTimeRef.current = Date.now();
    }
    animationFrameRef.current = requestAnimationFrame(animate);
  }, [props.durationMs]);

  useEffect(() => {
    startTimeRef.current = Date.now();
    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [props.durationMs, animate]);

  /*
   * Restart the ring the moment a refresh kicks off or completes so it always
   * tracks the real refresh cadence rather than drifting on its own clock.
   */
  useEffect(() => {
    startTimeRef.current = Date.now();
    setProgress(0);
  }, [props.resetKey, props.isRefreshing]);

  const radius: number = (SIZE - STROKE_WIDTH) / 2;
  const circumference: number = 2 * Math.PI * radius;
  const strokeDashoffset: number = circumference * (1 - progress);
  const center: number = SIZE / 2;
  const remainingSec: number = Math.ceil(
    (props.durationMs * (1 - progress)) / 1000,
  );

  return (
    <span
      className="relative inline-flex flex-shrink-0 items-center justify-center"
      style={{ width: SIZE, height: SIZE }}
      title={`Next refresh in ${remainingSec}s`}
    >
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#e5e7eb"
          strokeWidth={STROKE_WIDTH}
        />
        {/* Countdown */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#9ca3af"
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
};

export interface AutoRefreshControlProps {
  autoRefreshInterval: AutoRefreshInterval;
  onAutoRefreshIntervalChange: (interval: AutoRefreshInterval) => void;
  onManualRefresh: () => void;
  isRefreshing: boolean;
  lastRefreshedAt: Date | null;
  /*
   * Optional time-range picker rendered to the left of the refresh button.
   * The ResourceOverview pages pass their TelemetryTimeRangePicker here so the
   * picker and refresh controls read as one cluster; cluster pages that keep
   * their picker elsewhere simply omit it.
   */
  timeRangePicker?: ReactElement | undefined;
}

/*
 * Shared hero control for the telemetry/infrastructure overview pages: a
 * manual refresh button, an auto-refresh interval selector, and a grey
 * countdown ring that shows time until the next refresh. Pairs with
 * useAutoRefresh, which owns the interval state and the scheduling timer.
 */
const AutoRefreshControl: FunctionComponent<AutoRefreshControlProps> = (
  props: AutoRefreshControlProps,
): ReactElement => {
  const intervals: Array<AutoRefreshInterval> = [
    AutoRefreshInterval.OFF,
    AutoRefreshInterval.THIRTY_SECONDS,
    AutoRefreshInterval.ONE_MINUTE,
    AutoRefreshInterval.FIVE_MINUTES,
    AutoRefreshInterval.FIFTEEN_MINUTES,
  ];

  const durationMs: number | null = getAutoRefreshIntervalInMs(
    props.autoRefreshInterval,
  );

  return (
    <div className="flex items-center gap-2">
      {props.timeRangePicker ?? null}
      <button
        type="button"
        onClick={props.onManualRefresh}
        disabled={props.isRefreshing}
        title="Refresh now"
        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Icon
          icon={IconProp.Refresh}
          className={`h-3.5 w-3.5 ${
            props.isRefreshing ? "animate-spin text-gray-400" : "text-gray-500"
          }`}
        />
        <span className="hidden sm:inline">Refresh</span>
      </button>
      <label className="flex items-center gap-1.5 text-xs text-gray-500">
        <span className="hidden sm:inline">Auto-refresh</span>
        {durationMs !== null ? (
          <CountdownCircle
            durationMs={durationMs}
            resetKey={
              props.lastRefreshedAt ? props.lastRefreshedAt.getTime() : 0
            }
            isRefreshing={props.isRefreshing}
          />
        ) : null}
        <select
          value={props.autoRefreshInterval}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>): void => {
            props.onAutoRefreshIntervalChange(
              e.target.value as AutoRefreshInterval,
            );
          }}
          className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
        >
          {intervals.map((interval: AutoRefreshInterval): ReactElement => {
            return (
              <option key={interval} value={interval}>
                {interval === AutoRefreshInterval.OFF
                  ? "Off"
                  : `Every ${getAutoRefreshIntervalLabel(interval)}`}
              </option>
            );
          })}
        </select>
      </label>
    </div>
  );
};

export default AutoRefreshControl;
