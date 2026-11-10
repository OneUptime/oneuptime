import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
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
  RumSetupCheckRefusalNotice,
  RumSetupCheckRow,
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
  shareRumSetupCheckRefusals,
} from "./RumSignalWords";
import RumSignalSetupModal from "./RumSignalSetupModal";
import RumKeySetupModal from "./RumKeySetupModal";
import {
  RumKindRefusal,
  RumRefusalApp,
  RumRefusalKind,
  getRumKindRefusal,
} from "./RumIngestRefusals";
import { getRumActionRoute } from "./RumRefusalRoutes";
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
 *
 * What the ingest endpoints refused (issue #6378) wins over a row's other
 * answers while nothing of its kind has arrived since (RumIngestRefusals):
 * "Refused", when the latest was, why, and the fix - another key in a
 * dialog, the key's page, the budgets or Billing. Rows refused the same way
 * (a turned-off key refuses everything sent with it) say why and the fix
 * once, in a notice above them, and each only that it is refused and when.
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

// In a refusal notice: the notice's own color, underlined, as Alert links are.
const NOTICE_ACTION_CLASS_NAME: string =
  "font-medium underline underline-offset-2 hover:no-underline";

interface ActionProps {
  action: RumSignalAction;
  testId: string;
  className: string;
  // A chevron after the words (an arrow out for a docs page): rows only.
  showIcon: boolean;
  recordingHealthRoute: Route;
  onSetUp: (signal: RumPanelSignal) => void;
  onPickKey: () => void;
}

/*
 * A row's or a notice's action. A guide in the docs opens in a new tab, and
 * its icon says so; the rest stay on this page. Icon turns a chevron round
 * on a right-to-left page by itself.
 */
const SetupCheckAction: FunctionComponent<ActionProps> = (
  props: ActionProps,
): ReactElement => {
  const action: RumSignalAction = props.action;

  const content: ReactElement = (
    <>
      <span>{action.label}</span>
      {props.showIcon ? (
        <Icon
          icon={
            action.kind === "docs"
              ? IconProp.ExternalLink
              : IconProp.ChevronRight
          }
          className={action.kind === "docs" ? "h-3.5 w-3.5" : "h-4 w-4"}
        />
      ) : (
        <></>
      )}
    </>
  );

  const actionRoute: Route | null = getRumActionRoute(action);

  if (action.kind === "pick-key") {
    return (
      <button
        type="button"
        className={props.className}
        data-testid={props.testId}
        onClick={(): void => {
          props.onPickKey();
        }}
      >
        {content}
      </button>
    );
  }

  if (actionRoute) {
    return (
      <AppLink
        to={actionRoute}
        className={props.className}
        dataTestId={props.testId}
      >
        {content}
      </AppLink>
    );
  }

  if (action.kind === "set-up") {
    return (
      <button
        type="button"
        className={props.className}
        data-testid={props.testId}
        onClick={(): void => {
          props.onSetUp(action.signal);
        }}
      >
        {content}
      </button>
    );
  }

  if (action.kind === "docs") {
    return (
      <a
        href={action.url}
        target="_blank"
        rel="noopener noreferrer"
        className={props.className}
        data-testid={props.testId}
      >
        {content}
      </a>
    );
  }

  if (action.kind === "recording-health") {
    return (
      <AppLink
        to={props.recordingHealthRoute}
        className={props.className}
        dataTestId={props.testId}
      >
        {content}
      </AppLink>
    );
  }

  return <></>;
};

interface RowProps {
  signal: RumSetupCheckSignal;
  label: string;
  line: RumSetupCheckLine;
  recordingHealthRoute: Route;
  onSetUp: (signal: RumPanelSignal) => void;
  onPickKey: () => void;
}

const SetupCheckRow: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const tone: ToneStyle = RUM_SETUP_CHECK_TONES[props.line.tone];
  const testId: string = `rum-setup-check-${props.signal}`;

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
          {props.line.action ? (
            <SetupCheckAction
              action={props.line.action}
              testId={`${testId}-action`}
              className={ACTION_CLASS_NAME}
              showIcon={true}
              recordingHealthRoute={props.recordingHealthRoute}
              onSetUp={props.onSetUp}
              onPickKey={props.onPickKey}
            />
          ) : (
            <></>
          )}
        </div>
      </div>
    </li>
  );
};

interface NoticeProps {
  notice: RumSetupCheckRefusalNotice;
  recordingHealthRoute: Route;
  onSetUp: (signal: RumPanelSignal) => void;
  onPickKey: () => void;
}

/*
 * Why several rows are refused, and the fix, once above them: the reason's
 * sentence, then its fix as a link in the notice's own color.
 */
const SetupCheckRefusalNotice: FunctionComponent<NoticeProps> = (
  props: NoticeProps,
): ReactElement => {
  const notice: RumSetupCheckRefusalNotice = props.notice;

  return (
    <div
      className="mb-4"
      data-testid="rum-setup-check-refusal"
      data-tone={notice.tone}
      data-signals={notice.signals.join(" ")}
    >
      <Alert
        type={notice.tone === "error" ? AlertType.DANGER : AlertType.WARNING}
        title={
          <span>
            <span data-testid="rum-setup-check-refusal-text">
              {notice.text}
            </span>
            {notice.action ? (
              <>
                {" "}
                <SetupCheckAction
                  action={notice.action}
                  testId="rum-setup-check-refusal-action"
                  className={NOTICE_ACTION_CLASS_NAME}
                  showIcon={false}
                  recordingHealthRoute={props.recordingHealthRoute}
                  onSetUp={props.onSetUp}
                  onPickKey={props.onPickKey}
                />
              </>
            ) : (
              <></>
            )}
          </span>
        }
      />
    </div>
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
  const [isPickingKey, setIsPickingKey] = useState<boolean>(false);

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

  /*
   * Whether each kind the application sends is refused at ingest: nothing
   * is said until its record is read, since a refusal speaks for a kind
   * only beside when that kind last arrived.
   */
  const refusalApp: RumRefusalApp = {
    client,
    appIdentifier: props.appName || null,
  };

  const refusalOf: (
    kind: RumRefusalKind,
    lastArrivalAt: unknown,
  ) => RumKindRefusal | null = (
    kind: RumRefusalKind,
    lastArrivalAt: unknown,
  ): RumKindRefusal | null => {
    if (!application) {
      return null;
    }

    return getRumKindRefusal({
      refusals: reads.refusals,
      kind,
      lastArrivalAt: toDateOrNull(lastArrivalAt),
      app: refusalApp,
      now,
    });
  };

  // Exceptions are span events: they travel with the traces.
  const tracesRefusal: RumKindRefusal | null = refusalOf(
    "traces",
    application?.tracesLastReceivedAt,
  );

  const vitalsWindow: { otherNamesArrive: boolean; since: Date } =
    getWebVitalsCheckWindow({
      metricsLastReceivedAt: toDateOrNull(application?.metricsLastReceivedAt),
      trackedSince,
      now,
    });

  const rows: Array<RumSetupCheckRow> = [
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
        refusal: tracesRefusal,
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
        refusal: tracesRefusal,
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
        refusal: refusalOf("logs", application?.logsLastReceivedAt),
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
        // Web Vitals are metrics.
        refusal: refusalOf("metrics", application?.metricsLastReceivedAt),
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
        refusal: refusalOf(
          "sessionReplay",
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

  // Rows refused the same way say why once, above them.
  const shared: {
    notices: Array<RumSetupCheckRefusalNotice>;
    rows: Array<RumSetupCheckRow>;
  } = shareRumSetupCheckRefusals(rows);

  const onSetUp: (signal: RumPanelSignal) => void = (
    signal: RumPanelSignal,
  ): void => {
    setSetUpSignal(signal);
  };

  const onPickKey: () => void = (): void => {
    setIsPickingKey(true);
  };

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
            <>
              {shared.notices.map(
                (notice: RumSetupCheckRefusalNotice): ReactElement => {
                  return (
                    <SetupCheckRefusalNotice
                      key={notice.signals.join(" ")}
                      notice={notice}
                      recordingHealthRoute={recordingHealthRoute}
                      onSetUp={onSetUp}
                      onPickKey={onPickKey}
                    />
                  );
                },
              )}
              <ul
                className="divide-y divide-gray-100"
                aria-label={
                  translator.translateText(SETUP_CHECK_TITLE) ||
                  SETUP_CHECK_TITLE
                }
              >
                {shared.rows.map((row: RumSetupCheckRow): ReactElement => {
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
                      onSetUp={onSetUp}
                      onPickKey={onPickKey}
                    />
                  );
                })}
              </ul>
            </>
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

      {isPickingKey ? (
        <RumKeySetupModal
          clientType={client}
          onClose={(): void => {
            setIsPickingKey(false);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default RumSetupCheckCard;
