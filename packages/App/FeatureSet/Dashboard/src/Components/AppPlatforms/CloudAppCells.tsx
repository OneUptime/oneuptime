import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "Common/Types/Date";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  composedValue,
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
  formatDurationMsInLanguage,
  formatPercent,
} from "../TelemetryResource/telemetryFormat";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import TableEmptyValue, {
  getValueOrQuietDash,
} from "Common/UI/Components/Table/TableEmptyValue";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineValueSkeleton from "Common/UI/Components/Skeleton/InlineValueSkeleton";
import IconProp from "Common/Types/Icon/IconProp";
import { CloudAppPlatformSignals } from "../../Pages/AppPlatforms/Utils/CloudAppPlatformSignals";
import { AZURE_MONITOR_SECTION_TITLE } from "./CloudAppAzureMonitorCard";

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
/*
 * The app went back to the revision it runs: said instead of "Deployed", in
 * amber, as a rollback's marker is on the charts.
 */
export const APP_ROLLED_BACK: string = translationKey("Rolled back {{time}}");
export const APP_SIGNALS_UNKNOWN: string = translationKey(
  "Could not load requests",
);
/*
 * An app that has sent no trace since its arrivals are kept (issue #6770):
 * its requests, errors and latency come from traces, so its "0 requests"
 * was never measured.
 */
export const APP_NO_TRACES: string = translationKey("No traces");
export const APP_NO_TRACES_HINT: string = translationKey(
  "No traces received from this app, so its requests, errors and latency are unknown.",
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
    return <TableEmptyValue />;
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
  /*
   * False for an app that has sent no trace: a count of none it served is
   * a dash, saying why on hover, not a 0. Unset: not known, as before.
   */
  hasTraces?: boolean | undefined;
}

// One of an app's numbers over the last hour, or a dash.
export const CloudAppSignalCell: FunctionComponent<CloudAppSignalCellProps> = (
  props: CloudAppSignalCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (
    props.hasTraces === false &&
    props.signals &&
    props.signals.requests <= 0
  ) {
    return (
      <span data-testid="cloud-app-signal-no-traces">
        <TableEmptyValue title={translator.translateText(APP_NO_TRACES_HINT)} />
      </span>
    );
  }

  if (props.signals === undefined) {
    return props.isLoading ? (
      <span
        className="inline-block h-3 w-10 animate-pulse rounded bg-gray-100"
        aria-hidden="true"
      />
    ) : (
      <TableEmptyValue />
    );
  }

  if (props.signals === null) {
    return (
      <TableEmptyValue title={translator.translateText(APP_SIGNALS_UNKNOWN)} />
    );
  }

  const signals: CloudAppSignals = props.signals;

  if (props.kind === CloudAppSignalKind.Requests) {
    return (
      <span
        className="text-sm tabular-nums text-gray-700"
        data-testid="cloud-app-requests"
      >
        {getValueOrQuietDash(formatCompact(signals.requests, translator))}
      </span>
    );
  }

  if (props.kind === CloudAppSignalKind.P95) {
    return (
      <span
        className="text-sm tabular-nums text-gray-700"
        data-testid="cloud-app-p95"
      >
        {getValueOrQuietDash(
          formatDurationMsInLanguage(signals.p95Ms, translator),
        )}
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
      {getValueOrQuietDash(formatPercent(signals.errorRatePercent, translator))}
    </span>
  );
};

export const APP_ERRORS_SUMMARY: string = translationKey("{{rate}} errors");
export const APP_REQUESTS_SUMMARY: string = translationKey(
  "{{requests}} requests",
);
export const APP_P95_SUMMARY: string = translationKey("p95 {{latency}}");
export const APP_NO_REQUESTS: string = translationKey("No requests");

/*
 * An App Service app that sends no traces, in a list (#10406): its site's
 * numbers from Azure Monitor - 5xx answers, not every error a trace calls
 * one, and a mean response time, not a p95 - each said as what it is, and
 * the source named under them, so no one reads them as traced requests.
 */
export const APP_PLATFORM_SERVER_ERRORS_SUMMARY: string = translationKey(
  "{{rate}} server errors",
);
export const APP_PLATFORM_RESPONSE_TIME_SUMMARY: string = translationKey(
  "{{latency}} on average",
);
export const APP_PLATFORM_SIGNALS_SOURCE: string = AZURE_MONITOR_SECTION_TITLE;
export const APP_PLATFORM_SIGNALS_HINT: string = translationKey(
  "No traces received from this app. These are its site's numbers from Azure Monitor: every request the site answered, the share answered with a 5xx status, and the average response time.",
);

export interface CloudAppPlatformSignalsSummaryProps {
  signals: CloudAppPlatformSignals;
}

interface PlatformSignalDetail {
  key: string;
  text: string;
}

/*
 * An App Service app's site's last hour, as Azure Monitor counted it: its
 * 5xx share first - toned as a traced error rate is - then its requests
 * and mean response time, and "Azure Monitor" under them. A site that
 * answered nothing says so; a number Azure Monitor did not report is left
 * out, never written as 0.
 */
export const CloudAppPlatformSignalsSummary: FunctionComponent<
  CloudAppPlatformSignalsSummaryProps
> = (props: CloudAppPlatformSignalsSummaryProps): ReactElement => {
  const translator: Translator = useTranslator();
  const signals: CloudAppPlatformSignals = props.signals;
  const requests: number = signals.requests || 0;
  const tone: CloudAppErrorRateTone = getCloudAppErrorRateTone(
    signals.serverErrorRatePercent,
  );
  const requestsText: string = translator.translateTemplate(
    APP_REQUESTS_SUMMARY,
    { requests: formatCompact(requests, translator) },
  );
  const responseTimeMs: number | null = signals.responseTimeMs;
  const responseText: string | null =
    responseTimeMs === null
      ? null
      : translator.translateTemplate(APP_PLATFORM_RESPONSE_TIME_SUMMARY, {
          latency: composedValue((sentence: Translator): string => {
            return formatDurationMsInLanguage(responseTimeMs, sentence);
          }),
        });
  const hasRate: boolean = signals.serverErrorRatePercent !== null;

  // What the first line does not say, in the line under it.
  const details: Array<PlatformSignalDetail> = [];

  if (requests > 0 && hasRate) {
    details.push({ key: "requests", text: requestsText });
  }

  if (requests > 0 && responseText) {
    details.push({ key: "response-time", text: responseText });
  }

  let firstLine: ReactElement;

  if (requests <= 0) {
    firstLine = (
      <div
        className="text-sm text-gray-500"
        data-testid="cloud-app-platform-no-requests"
      >
        {translator.translateText(APP_NO_REQUESTS)}
      </div>
    );
  } else if (hasRate) {
    firstLine = (
      <div
        className={"text-sm tabular-nums " + ERROR_RATE_CLASS_NAMES[tone]}
        data-testid="cloud-app-platform-server-errors"
        data-tone={tone}
      >
        {translator.translateTemplate(APP_PLATFORM_SERVER_ERRORS_SUMMARY, {
          rate: formatPercent(signals.serverErrorRatePercent, translator),
        })}
      </div>
    );
  } else {
    firstLine = (
      <div
        className="text-sm tabular-nums text-gray-700"
        data-testid="cloud-app-platform-requests"
      >
        {requestsText}
      </div>
    );
  }

  return (
    <div
      className="min-w-0"
      title={translator.translateText(APP_PLATFORM_SIGNALS_HINT)}
      data-testid="cloud-app-platform-signals"
    >
      {firstLine}
      {details.length > 0 ? (
        <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-gray-500">
          {details.map(
            (detail: PlatformSignalDetail, index: number): ReactElement => {
              return (
                <React.Fragment key={detail.key}>
                  {index > 0 ? <InlineSeparator /> : <></>}
                  <span data-testid={`cloud-app-platform-${detail.key}`}>
                    {detail.text}
                  </span>
                </React.Fragment>
              );
            },
          )}
        </div>
      ) : (
        <></>
      )}
      <div
        className="mt-0.5 flex items-center gap-1 text-xs text-gray-500"
        data-testid="cloud-app-platform-source"
      >
        <Icon
          icon={IconProp.Cloud}
          className="h-3 w-3 flex-shrink-0 text-gray-400"
        />
        <span>{translator.translateText(APP_PLATFORM_SIGNALS_SOURCE)}</span>
      </div>
    </div>
  );
};

export interface CloudAppSignalsSummaryCellProps {
  // Undefined while the signals load; null when they could not be read.
  signals: CloudAppSignals | null | undefined;
  isLoading?: boolean | undefined;
  /*
   * False for an app that has sent no trace since its arrivals are kept
   * (CloudApp.tracesLastReceivedAt): it reads "No traces", not "No
   * requests". Unset: not known, as before.
   */
  hasTraces?: boolean | undefined;
  /*
   * For such an app on App Service, its site's numbers from Azure Monitor
   * (#10406), shown where "No traces" would be. Unset: none to show.
   */
  platformSignals?: CloudAppPlatformSignals | undefined;
  // Its site's numbers are still being read: a skeleton, not "No traces" first.
  isLoadingPlatformSignals?: boolean | undefined;
}

/*
 * An app's last hour in one cell, the way a list has room for it: its error
 * rate first - in amber from 1% and red from 5% - and its requests and p95
 * under it. An app that served no request says so - and one that sends no
 * traces says that instead, its requests never having been counted, unless
 * Azure Monitor counted its App Service site's (#10406): those are shown,
 * marked as Azure Monitor's.
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

  if (signals.requests <= 0 && props.hasTraces === false) {
    if (props.isLoadingPlatformSignals) {
      return (
        <span data-testid="cloud-app-platform-signals-loading">
          <InlineValueSkeleton widthClassName="w-24" />
        </span>
      );
    }

    if (props.platformSignals && props.platformSignals.requests !== null) {
      return <CloudAppPlatformSignalsSummary signals={props.platformSignals} />;
    }

    return (
      <span
        className="text-sm text-gray-500"
        title={translator.translateText(APP_NO_TRACES_HINT)}
        data-testid="cloud-app-no-traces"
      >
        {translator.translateText(APP_NO_TRACES)}
      </span>
    );
  }

  if (signals.requests <= 0) {
    return (
      <span
        className="text-sm text-gray-500"
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
          rate: formatPercent(signals.errorRatePercent, translator),
        })}
      </div>
      <div className="mt-0.5 whitespace-nowrap text-xs tabular-nums text-gray-500">
        <span data-testid="cloud-app-requests">
          {translator.translateTemplate(APP_REQUESTS_SUMMARY, {
            requests: formatCompact(signals.requests, translator),
          })}
        </span>
        <InlineSeparator />
        <span data-testid="cloud-app-p95">
          {translator.translateTemplate(APP_P95_SUMMARY, {
            latency: composedValue((sentence: Translator): string => {
              return formatDurationMsInLanguage(signals.p95Ms, sentence);
            }),
          })}
        </span>
      </div>
    </div>
  );
};
