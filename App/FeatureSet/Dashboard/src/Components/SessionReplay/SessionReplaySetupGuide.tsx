import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useRef,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL, DOCS_URL } from "Common/UI/Config";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Navigation from "Common/UI/Utils/Navigation";
import SessionReplayCaptureTrigger from "Common/Types/Rum/SessionReplayCaptureTrigger";
import SessionReplayConsentMode from "Common/Types/Rum/SessionReplayConsentMode";
import { RecordingHealthStatus } from "Common/Types/Rum/SessionReplayHealth";
import {
  formatCountForCopy,
  formatRelativeAge,
  parseHealthTimestamp,
} from "Common/Utils/Rum/SessionReplayHealth";
import { readDtoString } from "Common/Types/Rum/SessionReplayApi";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useSessionReplayHealth, {
  SESSION_REPLAY_HEALTH_POLL_FAST_MS,
  SessionReplayHealthSnapshot,
  describeHealthError,
} from "./useSessionReplayHealth";
import SessionReplayInstallSnippet, {
  buildCspSnippet,
  getOneUptimeUrl,
} from "./SessionReplayInstallSnippet";
import { RecordingHealthDiagnosisBanner } from "./RecordingHealthCard";

/*
 * SessionReplaySetupGuide: "there are no recordings - what now?", as a live
 * stepper rather than a static page.
 *
 * Shown in place of an empty session list for an application that has
 * never recorded. Five steps: an ingestion key, one script tag, the CSP
 * lines, the correlation hook, and then a step that is not an instruction
 * at all but three live checks fed by the same health poll the settings
 * page uses (10s while this guide is on screen). The customer pastes the
 * tag, reloads their site, and watches the rows flip here - no "run the
 * test again" button, no guessing which of the four causes of an empty
 * list applies. Each unchecked row names its most likely cause from the
 * policy and the health counters.
 *
 * "Send a test chunk from the dashboard" was considered and dropped: the
 * origin allowlist would refuse a dashboard-origin post. The live poll is
 * the proof instead.
 */

const SESSION_REPLAY_LIST_ROUTE: string = "/telemetry/rum/session-replay/list";

export interface ComponentProps {
  rumApplicationId: ObjectID;
}

type LiveCheckState = "pending" | "done" | "unknown";

export interface LiveCheck {
  key: "loaded" | "chunk" | "playable";
  state: LiveCheckState;
  title: string;
  /* When done: "12s ago". When pending: the most likely cause. */
  detail: string;
}

/*
 * The three checks, as a pure function of the status so the flips can be
 * pinned in a test with fixed clocks. Order matters: each row's cause
 * assumes the rows above it are done.
 */
export function buildLiveChecks(
  status: RecordingHealthStatus | null,
  nowUnixMs: number,
): Array<LiveCheck> {
  if (!status) {
    return [
      {
        key: "loaded",
        state: "unknown",
        title: "Recorder loaded on your site",
        detail: "Waiting for the health status.",
      },
      {
        key: "chunk",
        state: "unknown",
        title: "First chunk received",
        detail: "Waiting for the health status.",
      },
      {
        key: "playable",
        state: "unknown",
        title: "First session ready to watch",
        detail: "Waiting for the health status.",
      },
    ];
  }

  const loadedAt: number | null = parseHealthTimestamp(
    status.lastConfigFetchAt,
  );
  const chunkAt: number | null = parseHealthTimestamp(
    status.lastChunkReceivedAt,
  );

  /* A chunk proves the recorder loaded even on a server that never stamps lastConfigFetchAt. */
  const hasLoaded: boolean = loadedAt !== null || chunkAt !== null;

  const loaded: LiveCheck = {
    key: "loaded",
    state: hasLoaded ? "done" : "pending",
    title: "Recorder loaded on your site",
    detail: hasLoaded
      ? loadedAt !== null
        ? `Policy fetched ${formatRelativeAge(loadedAt, nowUnixMs)}.`
        : "A chunk arrived, so the recorder has loaded."
      : !status.policy.isProjectEnabled
        ? "The recorder can still load, but session replay is switched off for this project, so it will record nothing. Turn it on first."
        : !status.policy.isApplicationEnabled
          ? "The recorder can still load, but session replay is switched off for this application, so it will record nothing. Turn it on first."
          : "No page has fetched this application's policy yet. Paste the tag above, reload a page that carries it, and this flips within about 10 seconds. If it stays here: the tag is not on the page, its identifier does not match, or a CSP script-src rule blocked it.",
  };

  const sample: number = status.policy.samplePercentage;

  let chunkCause: string;

  if (!hasLoaded) {
    chunkCause = "Waits on the recorder loading.";
  } else if (sample <= 0) {
    chunkCause =
      "Sampling is 0%, so no session is recorded. Set it to 100% to record the next visitor.";
  } else if (
    status.policy.consentMode === SessionReplayConsentMode.RequireExplicit
  ) {
    chunkCause =
      "Consent is required and no page has called OneUptimeReplay.grantConsent() yet; nothing uploads until one does.";
  } else if (
    status.policy.captureTrigger ===
    SessionReplayCaptureTrigger.OnErrorOrFrustration
  ) {
    chunkCause =
      "The trigger is On error or frustration, so a visit where nothing goes wrong uploads nothing. Throw an error on an instrumented page, call OneUptimeReplay.captureSession(), or switch the trigger to Always.";
  } else if (sample < 100) {
    chunkCause = `Sampling is ${sample}%, so about 1 in ${Math.max(
      1,
      Math.round(100 / sample),
    )} visits records. Load a few pages, or set sampling to 100% while testing.`;
  } else {
    chunkCause =
      "The policy is fetched but no chunk has landed. Uploads flush every 15s, so a request is being blocked on the way: check the browser console for a CSP connect-src or ad-blocker refusal of the ingest URL.";
  }

  const chunk: LiveCheck = {
    key: "chunk",
    state: chunkAt !== null ? "done" : "pending",
    title: "First chunk received",
    detail:
      chunkAt !== null
        ? `Last chunk ${formatRelativeAge(chunkAt, nowUnixMs)}.`
        : chunkCause,
  };

  let playableState: LiveCheckState;
  let playableDetail: string;

  if (chunkAt === null) {
    playableState = "pending";
    playableDetail = "Waits on the first chunk.";
  } else if (status.playableSessionsLast24h === null) {
    playableState = "unknown";
    playableDetail =
      "Chunks are arriving but the session count could not be read. Refresh the list; the session is most likely there.";
  } else if (status.playableSessionsLast24h > 0) {
    playableState = "done";
    playableDetail = `${formatCountForCopy(status.playableSessionsLast24h)} playable session${
      status.playableSessionsLast24h === 1 ? "" : "s"
    } in the last 24h.`;
  } else {
    playableState = "pending";
    playableDetail =
      "A chunk arrived but no session is playable yet: the session is still being written, or its only chunk was dropped after acceptance. This usually resolves within a minute.";
  }

  const playable: LiveCheck = {
    key: "playable",
    state: playableState,
    title: "First session ready to watch",
    detail: playableDetail,
  };

  return [loaded, chunk, playable];
}

/*
 * The docs page this guide summarises. Each step that has a fuller section
 * links to that section's anchor rather than to the top of the page (WP-DOC
 * request): a customer who needs more than the step's paragraph should land
 * on the paragraph that continues it, not scroll a 500-line page.
 */
export const SETUP_GUIDE_DOCS_PATH: string = "/telemetry/session-replay";

function Step(props: {
  index: number;
  title: string;
  children: ReactElement | Array<ReactElement>;
  isLast?: boolean | undefined;
  /* Heading slug on SETUP_GUIDE_DOCS_PATH that continues this step. */
  docsAnchor?: string | undefined;
}): ReactElement {
  return (
    <div className="flex gap-3" data-testid={`setup-step-${props.index}`}>
      <div className="flex flex-col items-center">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200">
          {props.index}
        </div>
        {!props.isLast && <div className="mt-1 w-px flex-1 bg-gray-200" />}
      </div>
      <div className="min-w-0 flex-1 pb-6">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-sm font-medium text-gray-900">
            {props.title}
          </span>
          {props.docsAnchor && (
            <Link
              className="text-xs font-medium text-indigo-600 hover:text-indigo-800"
              openInNewTab={true}
              id={`setup-step-${props.index}-docs`}
              to={URL.fromString(
                `${DOCS_URL.toString()}${SETUP_GUIDE_DOCS_PATH}#${props.docsAnchor}`,
              )}
            >
              <span data-testid={`setup-step-${props.index}-docs`}>
                Read the docs on this
              </span>
            </Link>
          )}
        </div>
        <div className="mt-1.5 text-sm text-gray-600">{props.children}</div>
      </div>
    </div>
  );
}

function LiveCheckRow(props: {
  check: LiveCheck;
  action?: ReactElement | undefined;
}): ReactElement {
  const { check } = props;

  const icon: IconProp =
    check.state === "done"
      ? IconProp.CheckCircle
      : check.state === "unknown"
        ? IconProp.Info
        : IconProp.Spinner;

  const iconColor: string =
    check.state === "done"
      ? "text-emerald-600"
      : check.state === "unknown"
        ? "text-gray-400"
        : "text-indigo-500";

  return (
    <div
      className="flex items-start gap-3 py-2"
      data-testid={`live-check-${check.key}`}
      data-state={check.state}
    >
      <Icon
        icon={icon}
        className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor} ${
          check.state === "pending" ? "animate-spin" : ""
        }`}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-900">{check.title}</div>
        <div className="text-xs text-gray-500">{check.detail}</div>
      </div>
      {props.action}
    </div>
  );
}

const SessionReplaySetupGuide: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const health: SessionReplayHealthSnapshot = useSessionReplayHealth(
    props.rumApplicationId,
    { pollIntervalMs: SESSION_REPLAY_HEALTH_POLL_FAST_MS },
  );

  const [isOpeningSession, setIsOpeningSession] = useState<boolean>(false);
  const [watchError, setWatchError] = useState<string>("");
  const watchGenerationRef: React.MutableRefObject<number> = useRef<number>(0);

  const oneuptimeUrl: string = getOneUptimeUrl();
  const appIdentifier: string = health.status?.appIdentifier ?? "";
  const checks: Array<LiveCheck> = buildLiveChecks(
    health.status,
    health.nowUnixMs,
  );

  /*
   * "Watch it": the newest playable session, via the list endpoint with
   * limit 1. Deliberately NOT the manifest endpoint: opening a manifest
   * writes an audit row, and the guide must not record a "view" the
   * person has not made yet.
   */
  const openNewestSession: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      watchGenerationRef.current += 1;
      const generation: number = watchGenerationRef.current;

      setIsOpeningSession(true);
      setWatchError("");

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              SESSION_REPLAY_LIST_ROUTE,
            ),
            data: {
              rumApplicationId: props.rumApplicationId.toString(),
              limit: 1,
              filters: { isPlayable: true },
            },
            headers: { ...ModelAPI.getCommonHeaders() },
          });

        if (generation !== watchGenerationRef.current) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const sessions: unknown = response.data["sessions"];
        const first: Record<string, unknown> | null =
          Array.isArray(sessions) && sessions.length > 0
            ? (sessions[0] as Record<string, unknown>)
            : null;
        const sessionId: string = first
          ? readDtoString(first, "sessionId")
          : "";

        if (!sessionId) {
          setWatchError(
            "No playable session came back from the list. The count and the list disagree for a moment while a session is being written; try again in a few seconds.",
          );
          return;
        }

        Navigation.navigate(
          RouteUtil.populateRouteParams(
            RouteMap[PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_VIEW] as Route,
            { modelId: props.rumApplicationId, subModelId: sessionId },
          ),
        );
      } catch (err: unknown) {
        if (generation === watchGenerationRef.current) {
          setWatchError(
            `Could not open the newest session: ${API.getFriendlyMessage(err as HTTPErrorResponse)}`,
          );
        }
      } finally {
        if (generation === watchGenerationRef.current) {
          setIsOpeningSession(false);
        }
      }
    }, [props.rumApplicationId.toString()]);

  const playableCheck: LiveCheck | undefined = checks.find(
    (check: LiveCheck): boolean => {
      return check.key === "playable";
    },
  );

  return (
    <Card
      title="No recordings yet - here's how to get the first one"
      description="Session replay needs one script tag on your site. The checks at the end of this page update live while you set it up."
    >
      <div data-testid="setup-guide">
        {/*
         * The diagnosis, first. session-list-11: the guide used to show the
         * same four generic steps whether the recorder was never installed,
         * switched off, sampling 0% or error-triggered. Now the cause leads.
         */}
        {!health.isLoading && health.status !== null && (
          <div className="mb-5" data-testid="setup-guide-diagnosis">
            <RecordingHealthDiagnosisBanner
              diagnosis={health.diagnosis}
              rumApplicationId={props.rumApplicationId}
            />
          </div>
        )}

        {!health.isLoading && health.status === null && health.error && (
          <div
            className="mb-5 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
            data-testid="setup-guide-health-error"
          >
            <span className="font-medium text-gray-900">
              {describeHealthError(health.error).title}.
            </span>{" "}
            {describeHealthError(health.error).detail} The steps below still
            apply.
          </div>
        )}

        <Step index={1} title="Create a telemetry ingestion key">
          <>
            The recorder authenticates with an ingestion key. Create one under{" "}
            <Link
              className="text-indigo-600 hover:text-indigo-800"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.SETTINGS_TELEMETRY_INGESTION_KEYS] as Route,
              )}
            >
              Project Settings &gt; Telemetry Ingestion Keys
            </Link>
            , then open it to read the token. It sits in your page&apos;s
            JavaScript, so treat it as public: it grants ingestion only and
            cannot read anything back out of your project. If you give the key
            its own allowed origins, they must include your site too.
          </>
        </Step>

        <Step
          index={2}
          title="Add one script tag to your site"
          docsAnchor="identify-your-users"
        >
          <>
            Put this on every page you want recorded. The tab picks the
            framework; the tag is the same.
            <div className="mt-2">
              <SessionReplayInstallSnippet
                appIdentifier={appIdentifier}
                oneuptimeUrl={oneuptimeUrl}
                showIdentify={true}
              />
            </div>
          </>
        </Step>

        <Step
          index={3}
          title="Allow the recorder through your CSP"
          docsAnchor="content-security-policy"
        >
          <>
            If your site sets a Content-Security-Policy, <code>script-src</code>{" "}
            decides whether the recorder loads and <code>connect-src</code>{" "}
            whether it uploads. Both fail silently in your users&apos; browsers,
            so this is the most common cause of a list that stays empty. Add{" "}
            <code>{oneuptimeUrl}</code> to your existing <code>script-src</code>{" "}
            and <code>connect-src</code> values - keep{" "}
            <code>&apos;self&apos;</code> and everything else already there:
            <div className="mt-2" data-testid="setup-csp-snippet">
              <CodeBlock
                code={buildCspSnippet(oneuptimeUrl)}
                language="plaintext"
              />
            </div>
            <div className="mt-1 text-xs text-gray-500">
              No CSP on your site? Skip this step.
            </div>
          </>
        </Step>

        <Step
          index={4}
          title="Correlate recordings with your logs and traces"
          docsAnchor="correlating-with-your-other-telemetry"
        >
          <>
            A recording lines up with the logs, spans and exceptions from the
            same browser through <code>session.id</code> on your OpenTelemetry
            resource. Set it from the recorder&apos;s session hook, and add your
            API origins to <em>Trace propagation origins</em> in this
            application&apos;s replay policy so requests carry a{" "}
            <code>traceparent</code> header without a browser tracing SDK.
            <div className="mt-2" data-testid="setup-correlation-snippet">
              <SessionReplayInstallSnippet
                appIdentifier={appIdentifier}
                oneuptimeUrl={oneuptimeUrl}
                showIdentify={false}
                showCorrelation={true}
              />
            </div>
            <div className="mt-2 text-xs text-gray-500">
              Optional. Recordings work without it; the rail beside the player
              just will not show your backend signals.
            </div>
          </>
        </Step>

        <Step index={5} title="Waiting for your first session" isLast={true}>
          <>
            <div
              className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-1"
              aria-live="polite"
              data-testid="setup-live-checks"
            >
              {checks.map((check: LiveCheck): ReactElement => {
                const isWatchRow: boolean =
                  check.key === "playable" && check.state === "done";

                return (
                  <LiveCheckRow
                    key={check.key}
                    check={check}
                    action={
                      isWatchRow ? (
                        <Button
                          title="Watch it"
                          icon={IconProp.Play}
                          buttonStyle={ButtonStyleType.PRIMARY}
                          isLoading={isOpeningSession}
                          dataTestId="setup-watch-newest"
                          onClick={(): void => {
                            void openNewestSession();
                          }}
                        />
                      ) : undefined
                    }
                  />
                );
              })}
              {health.isLoading && (
                <div className="py-2 text-xs text-gray-500">
                  Reading the health status…
                </div>
              )}
              {!health.isLoading && (
                <div className="py-2 text-xs text-gray-500">
                  {health.error && health.status !== null
                    ? `The last refresh failed; showing the status read ${
                        health.fetchedAtUnixMs === null
                          ? "earlier"
                          : formatRelativeAge(
                              health.fetchedAtUnixMs,
                              health.nowUnixMs,
                            )
                      }. `
                    : ""}
                  Checks refresh every{" "}
                  {Math.round(SESSION_REPLAY_HEALTH_POLL_FAST_MS / 1000)}s while
                  this page is open
                  {playableCheck?.state === "done"
                    ? "; the list above refreshes with them."
                    : "."}
                </div>
              )}
            </div>
            {watchError && (
              <div
                className="mt-2 text-xs text-rose-700"
                data-testid="setup-watch-error"
              >
                {watchError}
              </div>
            )}
          </>
        </Step>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="flex items-start gap-2">
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
            />
            <div className="text-xs text-gray-600">
              <span className="font-medium text-gray-800">
                Still nothing after all that?
              </span>{" "}
              The installation test on this application&apos;s Replay Policy
              page lists every switch, budget and refusal reason the server
              knows, and explains the recorder&apos;s own diagnostics from the
              browser.
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {/*
             * settings-setup-17: this used to open the PROJECT settings page,
             * whose installation test selected the first application
             * alphabetically. The test now lives on this application's own
             * page, so the button lands on the right application.
             */}
            <Button
              title="Run the installation test"
              icon={IconProp.Check}
              buttonStyle={ButtonStyleType.OUTLINE}
              dataTestId="setup-open-install-test"
              onClick={(): void => {
                Navigation.navigate(
                  RouteUtil.populateRouteParams(
                    RouteMap[
                      PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_SETTINGS
                    ] as Route,
                    { modelId: props.rumApplicationId },
                  ),
                );
              }}
            />
            <Link
              className="inline-flex items-center gap-1.5 rounded-md bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
              openInNewTab={true}
              to={URL.fromString(
                `${DOCS_URL.toString()}${SETUP_GUIDE_DOCS_PATH}`,
              )}
            >
              <>
                <Icon icon={IconProp.Book} className="h-4 w-4" />
                Full documentation
              </>
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
};

export default SessionReplaySetupGuide;
