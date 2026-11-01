import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import {
  CLOUD_APP_STATE_LABELS,
  CloudAppErrorRateTone,
  CloudAppSignals,
  CloudAppState,
  getCloudAppErrorRateTone,
  getCloudAppState,
  getShortRevision,
} from "../../Pages/AppPlatforms/Utils/CloudApps";
import {
  formatCompact,
  formatDurationMs,
  formatPercent,
} from "../TelemetryResource/telemetryFormat";

/*
 * The cells an App Platforms app shows in a list - All Apps, an
 * environment's Apps - and on its own page's header: whether it runs and on
 * how many instances, the revision it runs and since when, and its
 * requests, error rate and p95.
 */

export const APP_INSTANCE_COUNT: PluralTemplate = {
  one: "{{count}} instance",
  other: "{{count}} instances",
};
export const APP_LAST_SEEN: string = translationKey("Last seen {{time}}");
export const APP_DEPLOYED: string = translationKey("Deployed {{time}}");
export const APP_SIGNALS_UNKNOWN: string = translationKey(
  "Could not load requests",
);

// The dot before an app's state, by state.
const STATE_DOT_CLASS_NAMES: Readonly<Record<CloudAppState, string>> = {
  [CloudAppState.Running]: "bg-emerald-500",
  [CloudAppState.NotReporting]: "bg-amber-500",
};

const STATE_TEXT_CLASS_NAMES: Readonly<Record<CloudAppState, string>> = {
  [CloudAppState.Running]: "text-gray-900",
  [CloudAppState.NotReporting]: "text-amber-700",
};

export interface CloudAppStateCellProps {
  lastSeenAt: Date | string | null | undefined;
  // Live instances, when they were read; undefined while they load.
  liveInstances?: number | undefined;
}

/*
 * "● Running" with "3 instances" under it, or "● Not reporting" with when
 * it was last seen - in amber, as a quiet environment's row is on the
 * Overview.
 */
export const CloudAppStateCell: FunctionComponent<CloudAppStateCellProps> = (
  props: CloudAppStateCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const state: CloudAppState = getCloudAppState(props.lastSeenAt);
  const label: string =
    translator.translateText(CLOUD_APP_STATE_LABELS[state]) ||
    CLOUD_APP_STATE_LABELS[state];

  let detail: string = "";

  /*
   * An app that runs with no instance of its own reported - its telemetry
   * names no task or replica - says nothing rather than "0 instances".
   */
  if (
    state === CloudAppState.Running &&
    props.liveInstances !== undefined &&
    props.liveInstances > 0
  ) {
    detail = translator.translatePlural(
      APP_INSTANCE_COUNT,
      props.liveInstances,
    );
  } else if (state === CloudAppState.NotReporting && props.lastSeenAt) {
    detail = translator.translateTemplate(APP_LAST_SEEN, {
      time: OneUptimeDate.fromNow(OneUptimeDate.fromString(props.lastSeenAt)),
    });
  }

  return (
    <div className="min-w-0" data-testid="cloud-app-state" data-state={state}>
      <div className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${STATE_DOT_CLASS_NAMES[state]}`}
        />
        <span
          className={`text-sm font-medium ${STATE_TEXT_CLASS_NAMES[state]}`}
        >
          {label}
        </span>
      </div>
      {detail ? (
        <div className="mt-0.5 ps-3.5 text-xs text-gray-500">{detail}</div>
      ) : (
        <></>
      )}
    </div>
  );
};

export interface CloudAppRevisionCellProps {
  revision: string | null | undefined;
  since: Date | string | null | undefined;
  appName: string | null | undefined;
}

// "42" with "Deployed 2 hours ago" under it; a dash for no revision.
export const CloudAppRevisionCell: FunctionComponent<
  CloudAppRevisionCellProps
> = (props: CloudAppRevisionCellProps): ReactElement => {
  const translator: Translator = useTranslator();
  const revision: string = getShortRevision({
    revision: props.revision,
    appName: props.appName,
  });

  if (!revision) {
    return <span className="text-sm text-gray-400">—</span>;
  }

  return (
    <div className="min-w-0" data-testid="cloud-app-revision">
      <div
        className="truncate font-mono text-sm text-gray-900"
        title={props.revision || undefined}
      >
        <bdi>{revision}</bdi>
      </div>
      {props.since ? (
        <div className="mt-0.5 text-xs text-gray-500">
          {translator.translateTemplate(APP_DEPLOYED, {
            time: OneUptimeDate.fromNow(OneUptimeDate.fromString(props.since)),
          })}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

const ERROR_RATE_CLASS_NAMES: Readonly<Record<CloudAppErrorRateTone, string>> =
  {
    [CloudAppErrorRateTone.Unknown]: "text-gray-400",
    [CloudAppErrorRateTone.Healthy]: "text-gray-700",
    [CloudAppErrorRateTone.Warning]: "font-medium text-amber-700",
    [CloudAppErrorRateTone.Danger]: "font-medium text-red-700",
  };

export enum CloudAppSignalKind {
  Requests = "requests",
  ErrorRate = "error-rate",
  P95 = "p95",
}

export interface CloudAppSignalCellProps {
  kind: CloudAppSignalKind;
  // Undefined while the signals load; null when they could not be read.
  signals: CloudAppSignals | null | undefined;
  isLoading?: boolean | undefined;
}

// One of an app's numbers over the last hour, or a dash.
export const CloudAppSignalCell: FunctionComponent<CloudAppSignalCellProps> = (
  props: CloudAppSignalCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.signals === undefined) {
    return props.isLoading ? (
      <span
        className="inline-block h-3 w-10 animate-pulse rounded bg-gray-100"
        aria-hidden="true"
      />
    ) : (
      <span className="text-sm text-gray-400">—</span>
    );
  }

  if (props.signals === null) {
    return (
      <span
        className="text-sm text-gray-400"
        title={translator.translateText(APP_SIGNALS_UNKNOWN)}
      >
        —
      </span>
    );
  }

  const signals: CloudAppSignals = props.signals;

  if (props.kind === CloudAppSignalKind.Requests) {
    return (
      <span
        className="text-sm tabular-nums text-gray-700"
        data-testid="cloud-app-requests"
      >
        {formatCompact(signals.requests)}
      </span>
    );
  }

  if (props.kind === CloudAppSignalKind.P95) {
    return (
      <span
        className="text-sm tabular-nums text-gray-700"
        data-testid="cloud-app-p95"
      >
        {formatDurationMs(signals.p95Ms)}
      </span>
    );
  }

  const tone: CloudAppErrorRateTone = getCloudAppErrorRateTone(
    signals.errorRatePercent,
  );

  return (
    <span
      className={`text-sm tabular-nums ${ERROR_RATE_CLASS_NAMES[tone]}`}
      data-testid="cloud-app-error-rate"
      data-tone={tone}
    >
      {formatPercent(signals.errorRatePercent)}
    </span>
  );
};

export const APP_ERRORS_SUMMARY: string = translationKey("{{rate}} errors");
export const APP_REQUESTS_SUMMARY: string = translationKey(
  "{{requests}} requests",
);
export const APP_P95_SUMMARY: string = translationKey("p95 {{latency}}");
export const APP_NO_REQUESTS: string = translationKey("No requests");

export interface CloudAppSignalsSummaryCellProps {
  // Undefined while the signals load; null when they could not be read.
  signals: CloudAppSignals | null | undefined;
  isLoading?: boolean | undefined;
}

/*
 * An app's last hour in one cell, the way a list has room for it: its error
 * rate first - in amber from 1% and red from 5% - and its requests and p95
 * under it. An app that served no request says so.
 */
export const CloudAppSignalsSummaryCell: FunctionComponent<
  CloudAppSignalsSummaryCellProps
> = (props: CloudAppSignalsSummaryCellProps): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.signals === undefined || props.signals === null) {
    return (
      <CloudAppSignalCell
        kind={CloudAppSignalKind.ErrorRate}
        signals={props.signals}
        isLoading={props.isLoading}
      />
    );
  }

  const signals: CloudAppSignals = props.signals;

  if (signals.requests <= 0) {
    return (
      <span
        className="text-sm text-gray-400"
        data-testid="cloud-app-no-requests"
      >
        {translator.translateText(APP_NO_REQUESTS)}
      </span>
    );
  }

  const tone: CloudAppErrorRateTone = getCloudAppErrorRateTone(
    signals.errorRatePercent,
  );

  return (
    <div className="min-w-0" data-testid="cloud-app-signals">
      <div
        className={"text-sm tabular-nums " + ERROR_RATE_CLASS_NAMES[tone]}
        data-testid="cloud-app-error-rate"
        data-tone={tone}
      >
        {translator.translateTemplate(APP_ERRORS_SUMMARY, {
          rate: formatPercent(signals.errorRatePercent),
        })}
      </div>
      <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-gray-500">
        <span data-testid="cloud-app-requests">
          {translator.translateTemplate(APP_REQUESTS_SUMMARY, {
            requests: formatCompact(signals.requests),
          })}
        </span>
        {" · "}
        <span data-testid="cloud-app-p95">
          {translator.translateTemplate(APP_P95_SUMMARY, {
            latency: formatDurationMs(signals.p95Ms),
          })}
        </span>
      </div>
    </div>
  );
};
