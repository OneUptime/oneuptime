import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
  SessionReplayHealthSnapshot,
  describeHealthError,
} from "./useSessionReplayHealth";
import {
  RecordingHealthActionButton,
  RecordingHealthCardView,
  SEVERITY_STYLES,
  SeverityStyle,
} from "./RecordingHealthCard";

/*
 * RecordingHealthStrip: the one line above the session list.
 *
 * "Recording healthy - last chunk 12s ago - 143 sessions in 24h - sampling
 * 100%" when things work, and the diagnosis title (with its one action)
 * when they do not. A chevron expands it into the full health card so the
 * facts are one click away without leaving the list. It can be dismissed
 * for the browser session ONLY while healthy: a warning that could be
 * hidden would be hidden, and the next person to open the list would
 * inherit an empty list with no explanation - which is issue #3527.
 */

export const HEALTH_STRIP_DISMISSED_KEY_PREFIX: string =
  "oneuptime.replay.healthStrip.dismissed.";

/* Per-viewer, per-application, per-browser-session; every access guarded. */
function readDismissed(rumApplicationId: string): boolean {
  try {
    return (
      sessionStorage.getItem(
        `${HEALTH_STRIP_DISMISSED_KEY_PREFIX}${rumApplicationId}`,
      ) === "1"
    );
  } catch {
    return false;
  }
}

function writeDismissed(rumApplicationId: string, dismissed: boolean): void {
  try {
    if (dismissed) {
      sessionStorage.setItem(
        `${HEALTH_STRIP_DISMISSED_KEY_PREFIX}${rumApplicationId}`,
        "1",
      );
    } else {
      sessionStorage.removeItem(
        `${HEALTH_STRIP_DISMISSED_KEY_PREFIX}${rumApplicationId}`,
      );
    }
  } catch {
    /* Storage blocked: the dismissal lasts for this render tree only. */
  }
}

export interface RecordingHealthStripViewProps {
  rumApplicationId: ObjectID | string;
  health: SessionReplayHealthSnapshot;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  onDismiss?: (() => void) | undefined;
}

/* Pure: renders one snapshot. */
export const RecordingHealthStripView: FunctionComponent<
  RecordingHealthStripViewProps
> = (props: RecordingHealthStripViewProps): ReactElement => {
  const { health } = props;

  /* The word the E2E test reads: the diagnosis state, or the load state. */
  const level: string = health.isLoading
    ? "loading"
    : health.status === null && health.error
      ? "error"
      : health.diagnosis.state;

  const style: SeverityStyle = health.isLoading
    ? SEVERITY_STYLES["info"]
    : health.status === null && health.error
      ? SEVERITY_STYLES["info"]
      : SEVERITY_STYLES[health.diagnosis.severity];

  let title: string;
  let detail: string;

  if (health.isLoading) {
    title = "Checking recording health…";
    detail = "";
  } else if (health.status === null && health.error) {
    const described: { title: string; detail: string } = describeHealthError(
      health.error,
    );

    title = described.title;
    detail = described.detail;
  } else {
    title = health.diagnosis.title;
    detail = health.diagnosis.detail;
  }

  const isHealthy: boolean =
    !health.isLoading && health.diagnosis.state === "healthy";
  const canExpand: boolean = !health.isLoading;

  return (
    <div
      className={`mb-4 rounded-lg border ${style.border} ${style.background}`}
      data-testid="health-strip"
      data-state={level}
    >
      <div className="flex items-center gap-3 px-4 py-2">
        <span
          className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1 text-sm">
          <span className={`font-medium ${style.text}`}>{title}</span>
          <span className="sr-only" data-testid="health-strip-level">
            {level}
          </span>
          {!props.isExpanded && detail && !isHealthy && (
            <span className="ml-2 hidden text-gray-700 md:inline">
              {detail}
            </span>
          )}
          {!props.isExpanded && isHealthy && (
            <span className="ml-2 hidden text-gray-700 md:inline">
              {health.diagnosis.detail}
            </span>
          )}
        </div>

        {!props.isExpanded && health.diagnosis.action && !health.isLoading && (
          <RecordingHealthActionButton
            action={health.diagnosis.action}
            rumApplicationId={props.rumApplicationId}
            className="hidden shrink-0 text-xs font-medium text-indigo-700 hover:text-indigo-900 sm:inline"
          />
        )}

        {canExpand && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-gray-500 hover:bg-white/60 hover:text-gray-800"
            aria-expanded={props.isExpanded}
            aria-label={
              props.isExpanded
                ? "Hide recording health details"
                : "Show recording health details"
            }
            data-testid="health-strip-toggle"
            onClick={props.onToggleExpanded}
          >
            <Icon
              icon={
                props.isExpanded ? IconProp.ChevronUp : IconProp.ChevronDown
              }
              className="h-4 w-4"
            />
          </button>
        )}

        {isHealthy && props.onDismiss && (
          <button
            type="button"
            className="shrink-0 rounded p-1 text-gray-500 hover:bg-white/60 hover:text-gray-800"
            aria-label="Dismiss recording health"
            data-testid="health-strip-dismiss"
            onClick={props.onDismiss}
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        )}
      </div>

      {props.isExpanded && (
        <div className="border-t border-white/70 bg-white px-4 py-4">
          <RecordingHealthCardView
            rumApplicationId={props.rumApplicationId}
            health={health}
            embedded={true}
          />
        </div>
      )}
    </div>
  );
};

export interface ComponentProps {
  rumApplicationId: ObjectID | string;
  pollIntervalMs?: number | undefined;
}

/* Connected: subscribes to the shared poller; owns expand and dismiss. */
const RecordingHealthStrip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const applicationId: string = props.rumApplicationId.toString();

  const health: SessionReplayHealthSnapshot = useSessionReplayHealth(
    props.rumApplicationId,
    {
      pollIntervalMs:
        props.pollIntervalMs ?? SESSION_REPLAY_HEALTH_POLL_SLOW_MS,
    },
  );

  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isDismissed, setIsDismissed] = useState<boolean>((): boolean => {
    return readDismissed(applicationId);
  });

  useEffect((): void => {
    setIsDismissed(readDismissed(applicationId));
    setIsExpanded(false);
  }, [applicationId]);

  /*
   * A dismissal only ever hides a HEALTHY strip. The moment the diagnosis
   * changes to anything else the strip comes back, and the stale dismissal
   * is cleared so it does not re-hide the next healthy state either.
   */
  const isHealthy: boolean =
    !health.isLoading && health.diagnosis.state === "healthy";

  useEffect((): void => {
    if (!health.isLoading && !isHealthy && isDismissed) {
      setIsDismissed(false);
      writeDismissed(applicationId, false);
    }
  }, [health.isLoading, isHealthy, isDismissed, applicationId]);

  if (isDismissed && isHealthy) {
    return <></>;
  }

  return (
    <RecordingHealthStripView
      rumApplicationId={props.rumApplicationId}
      health={health}
      isExpanded={isExpanded}
      onToggleExpanded={(): void => {
        setIsExpanded(!isExpanded);
      }}
      onDismiss={(): void => {
        setIsDismissed(true);
        writeDismissed(applicationId, true);
      }}
    />
  );
};

export default RecordingHealthStrip;
