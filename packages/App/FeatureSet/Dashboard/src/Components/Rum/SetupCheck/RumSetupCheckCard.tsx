import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import AppLink from "../../AppLink/AppLink";
import useSessionReplayHealth, {
  UseSessionReplayHealthResult,
} from "../../SessionReplay/useSessionReplayHealth";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  RumApplicationArrivalFacts,
  RumSignalDiagnosis,
  diagnoseRumSignal,
  getWebVitalsCheckWindow,
} from "./RumSignalDiagnosis";
import {
  getRumApplicationArrivalFacts,
  getRumClientKind,
  toDateOrNull,
} from "./RumSignalFacts";
import {
  RumClientKind,
  RumPanelSignal,
  RumSetupCheckLine,
  RumSetupCheckSignal,
  RumSetupCheckTone,
  RumSignalAction,
  ROW_UNKNOWN,
  SETUP_CHECK_AGAIN,
  SETUP_CHECK_DESCRIPTION,
  SETUP_CHECK_TITLE,
  getRumSetupCheckLabel,
  getRumSetupCheckLine,
  getSessionReplaySetupCheckLine,
} from "./RumSignalWords";
import RumSignalSetupModal from "./RumSignalSetupModal";
import useRumSetupCheck, {
  RumSetupCheckReads,
  RumSignalArrivalRead,
} from "./useRumSetupCheck";

/*
 * Real User Monitoring > an application > Documentation > SETUP CHECK
 * (issue #5770): what arrives from this application, kind by kind - page
 * loads and requests, exceptions, logs, Web Vitals and Session Replay -
 * each with its state and when the latest came in, and for what is not set
 * up, the step that sets it up.
 *
 * The browser SDK sends page loads and requests on its own and nothing
 * else, so an application can look connected while its Exceptions and
 * Logs stay empty for good. The guide under this card says how to set up
 * each; this says which of them are.
 *
 * A row is a label and its status, side by side once the card is wide
 * enough, one under the other on a phone. A mobile application has no Web
 * Vitals or Session Replay row: neither exists on mobile.
 */

export interface ComponentProps {
  rumApplicationId: ObjectID;
  // The application's service.name, for the setup dialogs.
  appName: string;
}

interface ToneStyle {
  icon: IconProp;
  className: string;
}

export const RUM_SETUP_CHECK_TONES: Record<RumSetupCheckTone, ToneStyle> = {
  ok: { icon: IconProp.CheckCircle, className: "text-emerald-600" },
  warning: { icon: IconProp.Alert, className: "text-amber-500" },
  error: { icon: IconProp.Error, className: "text-red-600" },
  waiting: { icon: IconProp.Clock, className: "text-gray-400" },
  off: { icon: IconProp.MinusCircle, className: "text-gray-400" },
};

const ACTION_CLASS_NAME: string =
  "mt-1.5 inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700";

interface RowProps {
  signal: RumSetupCheckSignal;
  label: string;
  line: RumSetupCheckLine;
  recordingHealthRoute: Route;
  onSetUp: (signal: RumPanelSignal) => void;
}

const SetupCheckRow: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const tone: ToneStyle = RUM_SETUP_CHECK_TONES[props.line.tone];
  const action: RumSignalAction | undefined = props.line.action;
  const testId: string = `rum-setup-check-${props.signal}`;

  const actionContent: ReactElement | null = action ? (
    <>
      <span>{action.label}</span>
      <Icon icon={IconProp.ChevronRight} className="h-4 w-4 rtl:rotate-180" />
    </>
  ) : null;

  let actionElement: ReactElement = <></>;

  if (action && actionContent) {
    if (action.kind === "set-up") {
      actionElement = (
        <button
          type="button"
          className={ACTION_CLASS_NAME}
          data-testid={`${testId}-action`}
          onClick={(): void => {
            props.onSetUp(action.signal);
          }}
        >
          {actionContent}
        </button>
      );
    } else if (action.kind === "docs") {
      actionElement = (
        <a
          href={action.url}
          target="_blank"
          rel="noopener noreferrer"
          className={ACTION_CLASS_NAME}
          data-testid={`${testId}-action`}
        >
          {actionContent}
        </a>
      );
    } else if (action.kind === "recording-health") {
      actionElement = (
        <AppLink
          to={props.recordingHealthRoute}
          className={ACTION_CLASS_NAME}
          dataTestId={`${testId}-action`}
        >
          {actionContent}
        </AppLink>
      );
    }
  }

  return (
    <li
      className="min-w-0 py-3 first:pt-0 last:pb-0 [@container(min-width:40rem)]:flex [@container(min-width:40rem)]:items-start [@container(min-width:40rem)]:gap-4"
      data-testid={testId}
      data-tone={props.line.tone}
    >
      <div className="min-w-0 text-sm font-medium text-gray-900 [@container(min-width:40rem)]:w-56 [@container(min-width:40rem)]:flex-none">
        {props.label}
      </div>
      <div className="mt-1 flex min-w-0 items-start gap-2 [@container(min-width:40rem)]:mt-0 [@container(min-width:40rem)]:flex-1">
        <div className="mt-0.5 flex-shrink-0" aria-hidden={true}>
          <Icon icon={tone.icon} className={`h-4 w-4 ${tone.className}`} />
        </div>
        <div className="min-w-0">
          <div
            className="break-words text-sm text-gray-900"
            data-testid={`${testId}-text`}
          >
            {props.line.text}
          </div>
          {props.line.detail ? (
            <div
              className="mt-0.5 break-words text-sm text-gray-500"
              data-testid={`${testId}-detail`}
            >
              {props.line.detail}
            </div>
          ) : (
            <></>
          )}
          {actionElement}
        </div>
      </div>
    </li>
  );
};

interface DiagnoseOptions {
  otherNamesArrive?: boolean;
  // Exceptions: kept for all time, so none means none ever.
  recordsAllTime?: boolean;
  // Web Vitals: the date its own read vouches for.
  since?: Date;
}

function arrivalOf(
  application: RumApplication | null,
  applicationFailed: boolean,
  column: "tracesLastReceivedAt" | "logsLastReceivedAt",
): RumSignalArrivalRead | null {
  if (application) {
    return { at: toDateOrNull(application[column]), failed: false };
  }

  return applicationFailed ? { at: null, failed: true } : null;
}

const RumSetupCheckCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [reloadToken, setReloadToken] = useState<number>(0);
  const [setUpSignal, setSetUpSignal] = useState<RumPanelSignal | null>(null);

  const reads: RumSetupCheckReads = useRumSetupCheck(
    props.rumApplicationId,
    reloadToken,
  );
  const health: UseSessionReplayHealthResult = useSessionReplayHealth(
    props.rumApplicationId,
  );

  const application: RumApplication | null = reads.application;
  const client: RumClientKind = application
    ? getRumClientKind(application)
    : "browser";
  const facts: RumApplicationArrivalFacts = application
    ? getRumApplicationArrivalFacts(application)
    : { anythingArrived: false, lastHeardFromAt: null, replayOnly: false };
  const trackedSince: Date | null = toDateOrNull(
    application?.signalArrivalsTrackedSince,
  );
  const now: Date = reads.checkedAt;

  const diagnose: (
    lastArrival: RumSignalArrivalRead | null,
    options?: DiagnoseOptions,
  ) => RumSignalDiagnosis = (
    lastArrival: RumSignalArrivalRead | null,
    options?: DiagnoseOptions,
  ): RumSignalDiagnosis => {
    // Nothing is known of the app until its record is read.
    if (!application && !reads.applicationFailed) {
      return diagnoseRumSignal({
        lastArrival: null,
        trackedSince: null,
        app: facts,
        now,
      });
    }

    return diagnoseRumSignal({
      lastArrival: lastArrival,
      trackedSince: options?.recordsAllTime
        ? null
        : options?.since || trackedSince,
      otherNamesArrive: options?.otherNamesArrive,
      app: facts,
      now,
    });
  };

  const vitalsWindow: { otherNamesArrive: boolean; since: Date } =
    getWebVitalsCheckWindow({
      metricsLastReceivedAt: toDateOrNull(application?.metricsLastReceivedAt),
      trackedSince,
      now,
    });

  const rows: Array<{
    signal: RumSetupCheckSignal;
    line: RumSetupCheckLine;
  }> = [
    {
      signal: "traces",
      line: getRumSetupCheckLine({
        signal: "traces",
        diagnosis: diagnose(
          arrivalOf(
            application,
            reads.applicationFailed,
            "tracesLastReceivedAt",
          ),
        ),
        client,
        translator,
        now,
      }),
    },
    {
      signal: "exceptions",
      line: getRumSetupCheckLine({
        signal: "exceptions",
        // Exceptions are rows of their own, kept for all time.
        diagnosis: diagnose(reads.newestException, { recordsAllTime: true }),
        client,
        translator,
        now,
      }),
    },
    {
      signal: "logs",
      line: getRumSetupCheckLine({
        signal: "logs",
        diagnosis: diagnose(
          arrivalOf(application, reads.applicationFailed, "logsLastReceivedAt"),
        ),
        client,
        translator,
        now,
      }),
    },
  ];

  if (client === "browser") {
    rows.push({
      signal: "webVitals",
      line: getRumSetupCheckLine({
        signal: "webVitals",
        diagnosis: diagnose(reads.newestWebVital, {
          otherNamesArrive: vitalsWindow.otherNamesArrive,
          since: vitalsWindow.since,
        }),
        client,
        translator,
        now,
      }),
    });

    const replayLine: RumSetupCheckLine | null = getSessionReplaySetupCheckLine(
      {
        isLoading: health.isLoading,
        error: health.error,
        state: health.diagnosis.state,
        lastChunkReceivedAt: toDateOrNull(
          application?.sessionReplayLastChunkReceivedAt,
        ),
        translator,
        now,
      },
    );

    if (replayLine) {
      rows.push({ signal: "sessionReplay", line: replayLine });
    }
  }

  const recordingHealthRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_HEALTH] as Route,
    { modelId: props.rumApplicationId },
  );

  const isChecking: boolean = reads.isRefreshing || health.isRefreshing;

  return (
    <div data-testid="rum-setup-check" aria-busy={isChecking}>
      <Card
        title={SETUP_CHECK_TITLE}
        description={SETUP_CHECK_DESCRIPTION}
        buttons={[
          {
            title: SETUP_CHECK_AGAIN,
            icon: IconProp.Refresh,
            buttonStyle: ButtonStyleType.NORMAL,
            isLoading: isChecking,
            onClick: () => {
              setReloadToken((value: number): number => {
                return value + 1;
              });
              health.refresh().catch(() => {
                // The row says "Couldn't be checked"; nothing else to do.
              });
            },
          },
        ]}
      >
        {/* The card's width, for the rows' side-by-side layout. */}
        <div className="[container-type:inline-size]">
          {reads.applicationFailed && !application ? (
            <div
              className="flex items-start gap-2 text-sm text-gray-900"
              data-testid="rum-setup-check-failed"
            >
              <Icon
                icon={RUM_SETUP_CHECK_TONES.off.icon}
                className={`mt-0.5 h-4 w-4 flex-shrink-0 ${RUM_SETUP_CHECK_TONES.off.className}`}
              />
              <span>
                {translator.translateText(ROW_UNKNOWN) || ROW_UNKNOWN}
              </span>
            </div>
          ) : (
            <ul
              className="divide-y divide-gray-100"
              aria-label={
                translator.translateText(SETUP_CHECK_TITLE) || SETUP_CHECK_TITLE
              }
            >
              {rows.map(
                (row: {
                  signal: RumSetupCheckSignal;
                  line: RumSetupCheckLine;
                }): ReactElement => {
                  return (
                    <SetupCheckRow
                      key={row.signal}
                      signal={row.signal}
                      label={getRumSetupCheckLabel(
                        row.signal,
                        client,
                        translator,
                      )}
                      line={row.line}
                      recordingHealthRoute={recordingHealthRoute}
                      onSetUp={(signal: RumPanelSignal): void => {
                        setSetUpSignal(signal);
                      }}
                    />
                  );
                },
              )}
            </ul>
          )}
        </div>
      </Card>

      {setUpSignal ? (
        <RumSignalSetupModal
          signal={setUpSignal}
          appName={props.appName}
          onClose={(): void => {
            setSetUpSignal(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default RumSetupCheckCard;
