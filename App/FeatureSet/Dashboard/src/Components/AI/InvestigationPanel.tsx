import ChatActivityFeed, {
  hasRenderableActivity,
} from "../AIChat/ChatActivityFeed";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunCodeFixRecommendation from "Common/Types/AI/AIRunCodeFixRecommendation";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AI_INVESTIGATION_PANEL_ID } from "./AIInvestigationStatus";

export type InvestigationSubjectType = "incident" | "alert";

export type InvestigationVerdict = "Confirmed" | "Rejected";

export interface ComponentProps {
  subjectType: InvestigationSubjectType;
  subjectId: ObjectID;
  onStatusChange?: ((status: AIRunStatus | null) => void) | undefined;
  onAnalysisAvailable?: (() => void) | undefined;
}

const POLL_INTERVAL_MS: number = 2500;
const SETTLED_POLL_INTERVAL_MS: number = 30_000;
/*
 * A new incident can render before its asynchronous AI run has been enqueued.
 * Retry briefly so queued work appears immediately, then fall back to the
 * quieter settled cadence supported by the completed-report API.
 */
const MAX_DISCOVERY_POLLS: number = 4;
const RECOMMENDATION_SETTLEMENT_MAX_AGE_MS: number = 3 * 60 * 1000;
const MAX_RECOMMENDATION_POLL_RESPONSES: number = Math.ceil(
  RECOMMENDATION_SETTLEMENT_MAX_AGE_MS / POLL_INTERVAL_MS,
);

/*
 * The AI's live "watch it think" panel, shared by the incident and alert
 * view pages. It shows the autonomous investigation narrating its steps in
 * real time (reusing ChatActivityFeed over the run's AIRunEvents) and its
 * status. Renders nothing until an investigation exists for the subject, so
 * it's invisible for projects that haven't enabled AI. Once complete, the
 * published report becomes the primary content and the reasoning trail moves
 * into a quiet disclosure.
 */
const InvestigationPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const subjectType: InvestigationSubjectType = props.subjectType;
  const subjectIdString: string = props.subjectId.toString();
  const subjectKey: string = `${subjectType}:${subjectIdString}`;
  const [runStatus, setRunStatus] = useState<AIRunStatus | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<AIRunEvent>>([]);
  const [analysisMarkdown, setAnalysisMarkdown] = useState<string | null>(null);
  /*
   * The AI-written one-liner shown above the report. Purely a summary of the
   * report below it, so the panel treats it as decoration: it is rendered as
   * plain text (never markdown) and its absence changes nothing else.
   */
  const [analysisTldr, setAnalysisTldr] = useState<string | null>(null);
  const [isAnalysisPending, setIsAnalysisPending] = useState<boolean>(false);
  const [stats, setStats] = useState<{
    toolCallCount: number;
    totalTokens: number;
  } | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const [loadedSubjectKey, setLoadedSubjectKey] = useState<string | null>(null);
  const [supportsSettledPolling, setSupportsSettledPolling] =
    useState<boolean>(false);
  const signatureRef: React.MutableRefObject<string> = useRef<string>("");
  const latestFetchRequestRef: React.MutableRefObject<number> =
    useRef<number>(0);
  const activeSubjectKeyRef: React.MutableRefObject<string> =
    useRef<string>(subjectKey);
  const activeRunIdRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const loadedSubjectKeyRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const notifiedAnalysisRef: React.MutableRefObject<Set<string>> = useRef<
    Set<string>
  >(new Set<string>());
  const previousSubjectKeyRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const onStatusChangeRef: React.MutableRefObject<
    ((status: AIRunStatus | null) => void) | undefined
  > = useRef<((status: AIRunStatus | null) => void) | undefined>(
    props.onStatusChange,
  );
  onStatusChangeRef.current = props.onStatusChange;
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const inFlightFetchRef: React.MutableRefObject<{
    subjectKey: string;
    promise: Promise<void>;
  } | null> = useRef<{
    subjectKey: string;
    promise: Promise<void>;
  } | null>(null);
  const unsettledPollRef: React.MutableRefObject<{
    runId: string | null;
    responseCount: number;
    firstObservedAt: number | null;
  }> = useRef<{
    runId: string | null;
    responseCount: number;
    firstObservedAt: number | null;
  }>({
    runId: null,
    responseCount: 0,
    firstObservedAt: null,
  });

  /*
   * Update during render so a response from the previous route can never
   * commit between this render and the next effect.
   */
  activeSubjectKeyRef.current = subjectKey;

  // "Open Fix PR from this analysis" (the FixFromIncident recipe) state.
  const [codeFixRecommendation, setCodeFixRecommendation] =
    useState<AIRunCodeFixRecommendation | null>(null);
  const [
    recommendationSettlementDeadlineAt,
    setRecommendationSettlementDeadlineAt,
  ] = useState<number | null>(null);
  const [isCreatingFixTask, setIsCreatingFixTask] = useState<boolean>(false);
  const [fixTaskRunId, setFixTaskRunId] = useState<string | null>(null);
  const [fixTaskError, setFixTaskError] = useState<string | null>(null);

  // "Was this analysis correct?" human verdict state.
  const [humanVerdict, setHumanVerdict] = useState<string | null>(null);
  const [isSavingVerdict, setIsSavingVerdict] = useState<boolean>(false);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [isChangingVerdict, setIsChangingVerdict] = useState<boolean>(false);
  /*
   * Guards the polled payload from clobbering the optimistic verdict while
   * a save is in flight; once the POST settles, the server value (returned
   * on every investigation payload) is the source of truth again.
   */
  const isSavingVerdictRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /*
   * This component can survive route changes while the subject id changes.
   * Clear subject-owned state before the next response arrives so actions,
   * verdicts, and reports from the previous subject are never displayed on
   * the new one. Incrementing the generation also invalidates any request
   * that was already in flight for the old route.
   */
  useEffect(() => {
    const isSubjectChange: boolean =
      previousSubjectKeyRef.current !== null &&
      previousSubjectKeyRef.current !== subjectKey;
    previousSubjectKeyRef.current = subjectKey;

    latestFetchRequestRef.current += 1;
    signatureRef.current = "";
    loadedSubjectKeyRef.current = null;
    activeRunIdRef.current = null;
    isSavingVerdictRef.current = false;
    unsettledPollRef.current = {
      runId: null,
      responseCount: 0,
      firstObservedAt: null,
    };

    setRunStatus(null);
    setRunId(null);
    setErrorMessage(null);
    setEvents([]);
    setAnalysisMarkdown(null);
    setAnalysisTldr(null);
    setIsAnalysisPending(false);
    setStats(null);
    setHasLoadedOnce(false);
    setLoadedSubjectKey(null);
    setSupportsSettledPolling(false);
    setCodeFixRecommendation(null);
    setRecommendationSettlementDeadlineAt(null);
    setIsCreatingFixTask(false);
    setFixTaskRunId(null);
    setFixTaskError(null);
    setHumanVerdict(null);
    setIsSavingVerdict(false);
    setVerdictError(null);
    setIsChangingVerdict(false);

    if (isSubjectChange) {
      onStatusChangeRef.current?.(null);
    }
  }, [subjectKey]);

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestId: number = latestFetchRequestRef.current + 1;
      latestFetchRequestRef.current = requestId;
      const requestedSubjectKey: string = subjectKey;
      const isLatestRequest: () => boolean = (): boolean => {
        return (
          isMountedRef.current &&
          requestId === latestFetchRequestRef.current &&
          requestedSubjectKey === activeSubjectKeyRef.current
        );
      };

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + `/ai-investigation/${subjectType}`,
            ),
            data: { [`${subjectType}Id`]: subjectIdString },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (!isLatestRequest()) {
          return;
        }

        if (response instanceof HTTPErrorResponse) {
          if (loadedSubjectKeyRef.current !== requestedSubjectKey) {
            setRunStatus(null);
          }
          loadedSubjectKeyRef.current = requestedSubjectKey;
          setLoadedSubjectKey(requestedSubjectKey);
          setHasLoadedOnce(true);
          return;
        }

        const data: JSONObject = response.data as JSONObject;
        const runJson: JSONObject | null =
          (data["run"] as JSONObject | null) || null;
        const eventsJson: JSONArray = (data["events"] as JSONArray) || [];

        const status: AIRunStatus | null =
          (runJson?.["status"] as AIRunStatus | undefined) || null;
        const nextRunId: string | null =
          (runJson?.["_id"] as string | undefined) || null;
        const verdictFromServer: string | null =
          (runJson?.["humanVerdict"] as string | undefined) || null;
        const rawRecommendationValue: unknown =
          runJson?.["codeFixRecommendation"];
        const rawCodeFixRecommendation: AIRunCodeFixRecommendation | null =
          rawRecommendationValue === AIRunCodeFixRecommendation.Pending ||
          rawRecommendationValue === AIRunCodeFixRecommendation.Recommended ||
          rawRecommendationValue === AIRunCodeFixRecommendation.NotRecommended
            ? rawRecommendationValue
            : null;
        const analysisFromServer: string =
          typeof data["analysisMarkdown"] === "string"
            ? (data["analysisMarkdown"] as string).trim()
            : "";
        const nextAnalysisMarkdown: string | null = analysisFromServer || null;
        /*
         * Only meaningful next to the report it summarizes — an API replica
         * that predates the TL;DR simply omits the field. Rendered as text,
         * so no markdown/HTML from it can reach the DOM.
         */
        const tldrFromServer: string =
          typeof data["analysisTldr"] === "string"
            ? (data["analysisTldr"] as string).trim()
            : "";
        const nextAnalysisTldr: string | null = nextAnalysisMarkdown
          ? tldrFromServer || null
          : null;
        const nextIsAnalysisPending: boolean =
          data["isAnalysisPending"] === true;
        const nextToolCallCount: number =
          (runJson?.["toolCallCount"] as number | undefined) || 0;
        const nextTotalTokens: number =
          (runJson?.["totalTokens"] as number | undefined) || 0;
        const nextErrorMessage: string | null =
          (runJson?.["errorMessage"] as string | undefined) || null;
        const nextSupportsSettledPolling: boolean =
          Object.prototype.hasOwnProperty.call(data, "analysisMarkdown") ||
          Object.prototype.hasOwnProperty.call(data, "isAnalysisPending");

        if (nextRunId !== activeRunIdRef.current) {
          activeRunIdRef.current = nextRunId;
          isSavingVerdictRef.current = false;
          unsettledPollRef.current = {
            runId: nextRunId,
            responseCount: 0,
            firstObservedAt: null,
          };
          setIsCreatingFixTask(false);
          setFixTaskRunId(null);
          setFixTaskError(null);
          setIsSavingVerdict(false);
          setVerdictError(null);
          setIsChangingVerdict(false);
        }

        let codeFixRecommendationFromServer: AIRunCodeFixRecommendation | null =
          rawCodeFixRecommendation;
        let settlementDeadlineAtFromServer: number | null = null;

        /*
         * Completed is persisted before the small code-fix classifier and
         * analysis post finish. During that bounded settlement window,
         * Pending (and a missing value from an older API replica) keeps the
         * panel polling but never exposes the action. A crashed/mixed-version
         * worker must not make every viewer poll forever, so both server age
         * and a local response cap fail closed after three minutes.
         */
        if (
          status === AIRunStatus.Completed &&
          (rawCodeFixRecommendation === null ||
            rawCodeFixRecommendation === AIRunCodeFixRecommendation.Pending)
        ) {
          const now: number = Date.now();
          const completedAtValue: unknown = runJson?.["completedAt"];
          const completedAtInMs: number =
            typeof completedAtValue === "string"
              ? Date.parse(completedAtValue)
              : Number.NaN;
          const pollState: {
            runId: string | null;
            responseCount: number;
            firstObservedAt: number | null;
          } = unsettledPollRef.current;
          const firstObservedAt: number = pollState.firstObservedAt ?? now;
          const localDeadlineAt: number =
            firstObservedAt + RECOMMENDATION_SETTLEMENT_MAX_AGE_MS;
          /*
           * Use the server completion time only when it is not ahead of the
           * browser. A client clock a few seconds behind must not suppress a
           * valid Pending -> Recommended transition. The first-observed local
           * deadline is always present, so failures and skew still terminate.
           */
          const serverDeadlineAt: number = Number.isFinite(completedAtInMs)
            ? completedAtInMs <= now
              ? completedAtInMs + RECOMMENDATION_SETTLEMENT_MAX_AGE_MS
              : localDeadlineAt
            : Number.NEGATIVE_INFINITY;
          /*
           * An explicit Pending value was authored by the upgraded server,
           * so its first-observed local window is authoritative. This avoids
           * a browser clock that is ahead of the server expiring a fresh
           * recommendation immediately. A missing value can be a genuinely
           * old legacy row, so retain the server-age cap for that case.
           */
          const settlementDeadlineAt: number =
            rawCodeFixRecommendation === AIRunCodeFixRecommendation.Pending
              ? localDeadlineAt
              : Math.min(localDeadlineAt, serverDeadlineAt);
          const withinResponseCap: boolean =
            pollState.runId === nextRunId &&
            pollState.responseCount < MAX_RECOMMENDATION_POLL_RESPONSES;
          const withinAgeCap: boolean = now < settlementDeadlineAt;

          if (withinAgeCap && withinResponseCap) {
            codeFixRecommendationFromServer =
              AIRunCodeFixRecommendation.Pending;
            settlementDeadlineAtFromServer = settlementDeadlineAt;
            unsettledPollRef.current = {
              runId: nextRunId,
              responseCount: pollState.responseCount + 1,
              firstObservedAt,
            };
          } else {
            codeFixRecommendationFromServer =
              rawCodeFixRecommendation === AIRunCodeFixRecommendation.Pending
                ? AIRunCodeFixRecommendation.NotRecommended
                : null;
          }
        }

        setRecommendationSettlementDeadlineAt(settlementDeadlineAtFromServer);

        /*
         * The report and recommendation can both arrive after the run first
         * becomes Completed. Include them in the signature so either
         * completion race produces the final render.
         */
        const signature: string = JSON.stringify([
          status,
          nextRunId,
          eventsJson.length,
          verdictFromServer,
          nextErrorMessage,
          nextToolCallCount,
          nextTotalTokens,
          nextAnalysisMarkdown,
          nextAnalysisTldr,
          nextIsAnalysisPending,
          codeFixRecommendationFromServer,
        ]);
        if (signature !== signatureRef.current) {
          signatureRef.current = signature;
          setRunStatus(status);
          setRunId(nextRunId);
          setCodeFixRecommendation(codeFixRecommendationFromServer);
          setErrorMessage(nextErrorMessage);
          setAnalysisMarkdown(nextAnalysisMarkdown);
          setAnalysisTldr(nextAnalysisTldr);
          setIsAnalysisPending(nextIsAnalysisPending);
          if (!isSavingVerdictRef.current) {
            setHumanVerdict(verdictFromServer);
          }
          setEvents(
            AIRunEvent.fromJSONArray(
              eventsJson as Array<JSONObject>,
              AIRunEvent,
            ),
          );
          setStats(
            runJson
              ? {
                  toolCallCount: nextToolCallCount,
                  totalTokens: nextTotalTokens,
                }
              : null,
          );
        }

        loadedSubjectKeyRef.current = requestedSubjectKey;
        setLoadedSubjectKey(requestedSubjectKey);
        setSupportsSettledPolling(nextSupportsSettledPolling);
        setHasLoadedOnce(true);
      } catch {
        if (!isLatestRequest()) {
          return;
        }

        // Best-effort panel — never surface an error here.
        if (loadedSubjectKeyRef.current !== requestedSubjectKey) {
          setRunStatus(null);
        }
        loadedSubjectKeyRef.current = requestedSubjectKey;
        setLoadedSubjectKey(requestedSubjectKey);
        setHasLoadedOnce(true);
      }
    }, [subjectIdString, subjectKey, subjectType]);

  /*
   * Effects can change cadence while a request is still unresolved (for
   * example, when the recommendation deadline expires). Reuse that request
   * for the same subject so an effect restart cannot overlap it. A route
   * change is allowed to start the new subject immediately; stale-response
   * guards keep the old subject from committing later.
   */
  const fetchDataSequentially: () => Promise<void> = useCallback(() => {
    const inFlightFetch: {
      subjectKey: string;
      promise: Promise<void>;
    } | null = inFlightFetchRef.current;

    if (inFlightFetch?.subjectKey === subjectKey) {
      return inFlightFetch.promise;
    }

    const promise: Promise<void> = fetchData().finally(() => {
      if (inFlightFetchRef.current?.promise === promise) {
        inFlightFetchRef.current = null;
      }
    });
    inFlightFetchRef.current = { subjectKey, promise };
    return promise;
  }, [fetchData, subjectKey]);

  useEffect(() => {
    fetchDataSequentially().catch(() => {
      // handled inside fetchData
    });
  }, [fetchDataSequentially]);

  useEffect(() => {
    if (hasLoadedOnce && loadedSubjectKey === subjectKey) {
      onStatusChangeRef.current?.(runStatus);
    }
  }, [hasLoadedOnce, loadedSubjectKey, runStatus, subjectKey]);

  /*
   * Human-triggered `code_fix`: enqueue a FixFromIncident task that takes
   * the posted analysis as context and opens a fix pull request. The server
   * gates (recommended completed investigation, GitHub-App repository, one
   * active run per subject) fail with a message shown inline.
   */
  const createFixTask: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const requestedSubjectKey: string = subjectKey;
      const requestedRunId: string | null = runId;
      const isCurrentRun: () => boolean = (): boolean => {
        return (
          isMountedRef.current &&
          requestedSubjectKey === activeSubjectKeyRef.current &&
          requestedRunId === activeRunIdRef.current
        );
      };

      if (!requestedRunId) {
        setFixTaskError("The investigation run could not be identified.");
        return;
      }

      setIsCreatingFixTask(true);
      setFixTaskError(null);

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + "/ai-investigation/create-fix-task",
            ),
            data: {
              subjectType,
              subjectId: subjectIdString,
              investigationRunId: requestedRunId,
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (!isCurrentRun()) {
          return;
        }

        const aiRunId: string | undefined = (response.data as JSONObject)[
          "aiRunId"
        ] as string | undefined;
        setFixTaskRunId(aiRunId || null);
      } catch (err) {
        if (!isCurrentRun()) {
          return;
        }

        setFixTaskError(API.getFriendlyMessage(err));
      }

      if (isCurrentRun()) {
        setIsCreatingFixTask(false);
      }
    }, [runId, subjectIdString, subjectKey, subjectType]);

  /*
   * Human verdict on a completed analysis ("Was this analysis correct?").
   * Optimistic — the pill renders immediately; a failed POST rolls the
   * verdict back and shows the error inline. Idempotent overwrite on the
   * server, so changing a verdict is the same call.
   */
  const submitVerdict: (verdict: InvestigationVerdict) => Promise<void> =
    useCallback(
      async (verdict: InvestigationVerdict): Promise<void> => {
        const requestedSubjectKey: string = subjectKey;
        const requestedRunId: string | null = runId;
        const previousVerdict: string | null = humanVerdict;
        const isCurrentRun: () => boolean = (): boolean => {
          return (
            isMountedRef.current &&
            requestedSubjectKey === activeSubjectKeyRef.current &&
            requestedRunId === activeRunIdRef.current
          );
        };

        if (!requestedRunId) {
          setVerdictError("The investigation run could not be identified.");
          return;
        }

        setIsSavingVerdict(true);
        isSavingVerdictRef.current = true;
        setVerdictError(null);
        setHumanVerdict(verdict);
        setIsChangingVerdict(false);

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(
                APP_API_URL.toString() + "/ai-investigation/verdict",
              ),
              data: {
                subjectType,
                subjectId: subjectIdString,
                investigationRunId: requestedRunId,
                verdict: verdict,
              },
              headers: ModelAPI.getCommonHeaders(),
            });

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }

          if (!isCurrentRun()) {
            return;
          }

          /*
           * Any GET that started before this mutation carries the old verdict.
           * Invalidate it before releasing the optimistic-state guard.
           */
          latestFetchRequestRef.current += 1;
        } catch (err) {
          if (!isCurrentRun()) {
            return;
          }

          // Roll back the optimistic update.
          setHumanVerdict(previousVerdict);
          setVerdictError(API.getFriendlyMessage(err));
        }

        if (isCurrentRun()) {
          setIsSavingVerdict(false);
          isSavingVerdictRef.current = false;
        }
      },
      [humanVerdict, runId, subjectIdString, subjectKey, subjectType],
    );

  const isRunning: boolean = runStatus === AIRunStatus.Running;
  const isQueued: boolean = runStatus === AIRunStatus.Queued;
  // Poll while the run can still make progress (queued runs get claimed).
  const isActive: boolean = isRunning || isQueued;
  const isDiscoveringRun: boolean =
    hasLoadedOnce && loadedSubjectKey === subjectKey && runStatus === null;
  /*
   * Pending is an explicit, bounded lifecycle state for a newly completed
   * analysis whose code-fix classifier/post has not settled yet.
   */
  const isCodeFixRecommendationPending: boolean =
    runStatus === AIRunStatus.Completed &&
    codeFixRecommendation === AIRunCodeFixRecommendation.Pending;
  /*
   * A run is marked Completed just before its report is posted to the feed.
   * Both post-run states are bounded, so neither can poll forever after a
   * failed or empty post-analysis step.
   */
  const shouldPoll: boolean =
    isActive || isAnalysisPending || isCodeFixRecommendationPending;
  /*
   * Keep a much quieter watch after settlement (and while no run exists), so
   * a new investigation launched elsewhere appears without a page refresh.
   * Active/finalizing runs and the first few no-run discovery checks retain
   * the fast live cadence.
   */
  const nextPollDelayInMs: number | null = shouldPoll
    ? POLL_INTERVAL_MS
    : isDiscoveringRun
      ? POLL_INTERVAL_MS
      : hasLoadedOnce && supportsSettledPolling
        ? SETTLED_POLL_INTERVAL_MS
        : null;

  useEffect(() => {
    if (nextPollDelayInMs === null) {
      return;
    }

    let isCancelled: boolean = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let discoveryPollCount: number = 0;

    const pollAfterDelay: (delayInMs: number) => void = (
      delayInMs: number,
    ): void => {
      timeout = setTimeout(() => {
        fetchDataSequentially()
          .catch(() => {
            // handled inside fetchData
          })
          .finally(() => {
            if (isCancelled) {
              return;
            }

            if (isDiscoveringRun) {
              discoveryPollCount += 1;

              if (discoveryPollCount < MAX_DISCOVERY_POLLS) {
                pollAfterDelay(POLL_INTERVAL_MS);
                return;
              }

              if (supportsSettledPolling) {
                pollAfterDelay(SETTLED_POLL_INTERVAL_MS);
              }
              return;
            }

            pollAfterDelay(nextPollDelayInMs);
          });
      }, delayInMs);
    };

    /*
     * Schedule the next poll only after the previous response settles. Slow
     * deployments therefore cannot invalidate every in-flight response.
     */
    pollAfterDelay(nextPollDelayInMs);

    return () => {
      isCancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [
    fetchDataSequentially,
    isDiscoveringRun,
    nextPollDelayInMs,
    supportsSettledPolling,
  ]);

  /*
   * The deadline is independent of HTTP success. It stops a Pending panel
   * even when every request fails or one request never resolves; sequential
   * polling above also guarantees that a slow request cannot create a request
   * storm. Recommendation stays fail-closed and no error banner is shown.
   */
  useEffect(() => {
    if (
      !isCodeFixRecommendationPending ||
      recommendationSettlementDeadlineAt === null
    ) {
      return;
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(
      () => {
        setCodeFixRecommendation(AIRunCodeFixRecommendation.NotRecommended);
        setRecommendationSettlementDeadlineAt(null);
      },
      Math.max(0, recommendationSettlementDeadlineAt - Date.now()),
    );

    return () => {
      clearTimeout(timeout);
    };
  }, [isCodeFixRecommendationPending, recommendationSettlementDeadlineAt]);

  /*
   * The report's presence proves the matching RootCause feed item exists.
   * Notify the host exactly once so an already-mounted incident/alert feed
   * can refresh at the correct side of the completion race.
   */
  useEffect(() => {
    if (
      loadedSubjectKey !== subjectKey ||
      runStatus !== AIRunStatus.Completed ||
      !analysisMarkdown ||
      !runId
    ) {
      return;
    }

    const notificationKey: string = `${subjectKey}:${runId}`;

    if (notifiedAnalysisRef.current.has(notificationKey)) {
      return;
    }

    notifiedAnalysisRef.current.add(notificationKey);
    props.onAnalysisAvailable?.();
  }, [
    analysisMarkdown,
    loadedSubjectKey,
    props.onAnalysisAvailable,
    runId,
    runStatus,
    subjectKey,
  ]);

  // Nothing to show until an investigation exists for this subject.
  if (!hasLoadedOnce || loadedSubjectKey !== subjectKey || !runStatus) {
    return <></>;
  }

  interface StatusMeta {
    text: string;
    /*
     * Pill classes for the header badge. The status used to be a bare line of
     * coloured text at the top of the body; as a badge in the card header it
     * reads at a glance and gives the body back to the findings.
     */
    className: string;
    icon: IconProp;
  }

  let statusMeta: StatusMeta = {
    text: "Investigation did not finish",
    className: "bg-red-50 text-red-700 ring-red-200",
    icon: IconProp.Alert,
  };
  let isFailed: boolean = true;

  if (runStatus === AIRunStatus.Running) {
    statusMeta = {
      text: "Investigating…",
      className: "bg-indigo-50 text-indigo-700 ring-indigo-200",
      icon: IconProp.Sparkles,
    };
    isFailed = false;
  } else if (runStatus === AIRunStatus.Queued) {
    statusMeta = {
      text: "Queued — waiting for a worker…",
      className: "bg-indigo-50 text-indigo-700 ring-indigo-200",
      icon: IconProp.Sparkles,
    };
    isFailed = false;
  } else if (runStatus === AIRunStatus.Completed) {
    statusMeta = !supportsSettledPolling
      ? {
          text: "Investigation complete",
          className: "bg-green-50 text-green-700 ring-green-200",
          icon: IconProp.Check,
        }
      : isAnalysisPending
        ? {
            text: "Preparing investigation report…",
            className: "bg-indigo-50 text-indigo-700 ring-indigo-200",
            icon: IconProp.Sparkles,
          }
        : analysisMarkdown
          ? {
              text: "Investigation complete",
              className: "bg-green-50 text-green-700 ring-green-200",
              icon: IconProp.Check,
            }
          : {
              text: "Investigation completed without a report",
              className: "bg-amber-50 text-amber-800 ring-amber-200",
              icon: IconProp.Info,
            };
    isFailed = false;
  }

  const isCodeFixRecommended: boolean =
    codeFixRecommendation === AIRunCodeFixRecommendation.Recommended;
  const isVerdictLocked: boolean = isSavingVerdict || !analysisMarkdown;
  const isConfirmed: boolean = humanVerdict === "Confirmed";
  /*
   * Ask the feed whether it will draw anything rather than counting events:
   * several event types only close a step an earlier event opened, so a run
   * can carry events yet render no steps, and a raw count would frame an
   * empty box (or advertise a disclosure that opens onto nothing).
   */
  const hasActivity: boolean = hasRenderableActivity(events);

  const statusBadge: ReactElement = (
    <span
      aria-label="Investigation status"
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusMeta.className}`}
    >
      <Icon icon={statusMeta.icon} className="h-3.5 w-3.5" />
      <span>{statusMeta.text}</span>
      {isActive || isAnalysisPending ? (
        <span className="relative ml-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-indigo-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500" />
        </span>
      ) : (
        <></>
      )}
    </span>
  );

  /*
   * One meta strip for both outcomes: what the run actually cost, plus the
   * read-only guarantee. Responders ask "did this thing touch anything?"
   * before they trust it, so the answer belongs on the card, not only in the
   * report's own footer prose.
   *
   * Gated on isActive, not isRunning: a QUEUED run has a stats object whose
   * counts are all zero, so the strip would tell a reader that the AI ran
   * zero queries and changed nothing — a past-tense report on work that has
   * not begun, sitting directly under "waiting for a worker".
   */
  const usageStrip: ReactElement =
    !isActive && stats ? (
      <div
        aria-label="Investigation usage"
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg bg-gray-50 px-4 py-2.5 text-xs text-gray-500 ring-1 ring-inset ring-gray-200"
      >
        <span className="inline-flex items-center gap-1.5">
          <Icon
            icon={IconProp.Database}
            className="h-3.5 w-3.5 text-gray-400"
          />
          {stats.toolCallCount} telemetry quer
          {stats.toolCallCount === 1 ? "y" : "ies"}
        </span>
        {stats.totalTokens > 0 ? (
          <span className="inline-flex items-center gap-1.5">
            <Icon icon={IconProp.Bolt} className="h-3.5 w-3.5 text-gray-400" />
            {stats.totalTokens.toLocaleString()} tokens
          </span>
        ) : (
          <></>
        )}
        <span className="inline-flex items-center gap-1.5 sm:ml-auto">
          <Icon
            icon={IconProp.ShieldCheck}
            className="h-3.5 w-3.5 text-gray-400"
          />
          Read-only — nothing in your systems was changed
        </span>
      </div>
    ) : (
      <></>
    );

  return (
    <Card
      title="AI Investigation"
      description={
        runStatus === AIRunStatus.Completed
          ? `OneUptime AI's root-cause report for this ${subjectType}.`
          : `OneUptime AI's live root-cause investigation for this ${subjectType}.`
      }
      rightElement={statusBadge}
    >
      <div
        id={AI_INVESTIGATION_PANEL_ID}
        tabIndex={-1}
        role="region"
        aria-label="AI Investigation"
        className="-mt-2 scroll-mt-32 space-y-4 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
      >
        {isFailed && errorMessage ? (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <Icon
              icon={IconProp.Alert}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500"
            />
            <div className="min-w-0">
              <p className="text-sm font-medium text-red-800">
                The investigation stopped before it could report.
              </p>
              <p className="mt-1 break-words text-xs leading-5 text-red-700">
                {errorMessage}
              </p>
            </div>
          </div>
        ) : (
          <></>
        )}

        {runStatus === AIRunStatus.Completed ? (
          <>
            {/*
              The TL;DR is the first thing a paged engineer reads, so it leads
              the card. It is AI-written prose ABOUT the report directly below
              it — rendered as plain text, never markdown, and simply absent
              for older runs or when its bounded generation call failed.
            */}
            {analysisTldr ? (
              <section
                aria-label="Investigation summary"
                className="overflow-hidden rounded-xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-indigo-50/40 to-white px-5 py-4 shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-600 shadow-sm">
                    <Icon
                      icon={IconProp.Sparkles}
                      className="h-4 w-4 text-white"
                    />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                      TL;DR
                    </p>
                    <p className="mt-1 text-[15px] font-medium leading-6 text-gray-900">
                      {analysisTldr}
                    </p>
                  </div>
                </div>
              </section>
            ) : (
              <></>
            )}

            {analysisMarkdown ? (
              <section
                aria-label="Investigation report"
                className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 bg-gray-50/80 px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900">
                      <Icon
                        icon={IconProp.DocumentText}
                        className="h-4 w-4 text-white"
                      />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-gray-900">
                        Investigation report
                      </h3>
                      <p className="mt-0.5 text-xs leading-5 text-gray-500">
                        Root cause, supporting evidence, and recommended next
                        steps from this investigation.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-gray-500 ring-1 ring-inset ring-gray-200">
                      <Icon icon={IconProp.Sparkles} className="h-3 w-3" />
                      AI generated
                    </span>
                    {/*
                      Responders paste the RCA into a channel or a postmortem
                      long before they act on it — make that one click rather
                      than a fiddly selection over a long rendered document.
                    */}
                    <CopyTextButton
                      textToBeCopied={analysisMarkdown}
                      size="sm"
                      variant="ghost"
                      label="Copy report"
                      copiedLabel="Report copied"
                    />
                  </div>
                </div>
                <div className="px-5 py-5 text-sm leading-6 text-gray-700">
                  <MarkdownViewer text={analysisMarkdown} safeMode={true} />
                </div>
              </section>
            ) : isAnalysisPending ? (
              <div
                role="status"
                className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 px-5 py-4"
              >
                <span className="h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                <div>
                  <p className="text-sm font-medium text-gray-800">
                    Preparing the final report
                  </p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    The investigation is complete. OneUptime AI is organizing
                    the findings and evidence.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                <Icon
                  icon={IconProp.Info}
                  className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
                />
                <div>
                  <p className="text-sm font-medium text-amber-800">
                    No investigation report was published.
                  </p>
                  <p className="mt-1 text-xs leading-5 text-amber-700">
                    The run finished without a final analysis. Review the
                    activity below for details.
                  </p>
                </div>
              </div>
            )}

            {hasActivity ? (
              <details className="group rounded-xl border border-gray-200 bg-gray-50/50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium text-gray-600 hover:bg-gray-100/70 hover:text-gray-900">
                  <span className="flex items-center gap-2">
                    <Icon
                      icon={IconProp.Activity}
                      className="h-4 w-4 text-gray-400"
                    />
                    Investigation activity
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-normal text-gray-500 ring-1 ring-inset ring-gray-200">
                      {events.length} event{events.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <Icon
                    icon={IconProp.ChevronDown}
                    className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180"
                  />
                </summary>
                <div className="border-t border-gray-200 px-4 py-4">
                  {/*
                    The disclosure's own summary row already names this
                    section, so the feed drops its bubble and heading here.
                  */}
                  <ChatActivityFeed
                    events={events}
                    hideChrome={true}
                    showLiveIndicator={false}
                    maxVisibleSteps={10}
                  />
                </div>
              </details>
            ) : (
              <></>
            )}
          </>
        ) : (
          /*
           *Before the report exists the reasoning trail IS the content, so it
           *gets the same framed treatment the report gets later: a header
           *that says what is happening in plain words, a progress hairline
           *while the run can still move, and the steps inside. Without the
           *frame this state read as a bare list floating under the title.
           */
          <section
            aria-label={
              isFailed ? "Investigation activity" : "Live investigation"
            }
            className={`overflow-hidden rounded-xl border bg-white shadow-sm ${
              isFailed ? "border-gray-200" : "border-indigo-200"
            }`}
          >
            <div
              className={`flex items-start gap-3 border-b px-5 py-4 ${
                isFailed
                  ? "border-gray-200 bg-gray-50/80"
                  : "border-indigo-100 bg-indigo-50/60"
              }`}
            >
              <div
                className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                  isFailed ? "bg-gray-900" : "bg-indigo-600"
                }`}
              >
                <Icon
                  icon={isFailed ? IconProp.Activity : IconProp.Sparkles}
                  className="h-4 w-4 text-white"
                />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">
                  {isFailed
                    ? "What the investigation got through"
                    : "OneUptime AI is investigating"}
                </h3>
                <p className="mt-0.5 text-xs leading-5 text-gray-500">
                  {isFailed
                    ? "The steps this run completed before it stopped."
                    : isQueued
                      ? "Waiting for a worker to pick this up. Steps appear here the moment it starts."
                      : "Reading this project's own telemetry and narrating every step. Read-only — nothing is changed."}
                </p>
              </div>
            </div>
            {isActive ? (
              <div
                aria-hidden="true"
                className="h-0.5 w-full overflow-hidden bg-indigo-100"
              >
                <div className="h-full w-1/3 motion-safe:animate-pulse bg-indigo-500" />
              </div>
            ) : (
              <></>
            )}
            <div className="px-5 py-4">
              {hasActivity ? (
                <ChatActivityFeed
                  events={events}
                  hideChrome={true}
                  showLiveIndicator={false}
                  maxVisibleSteps={10}
                />
              ) : (
                <p className="text-sm text-gray-500">
                  {isActive
                    ? "Starting investigation…"
                    : "No investigation steps were recorded."}
                </p>
              )}
            </div>
          </section>
        )}

        {usageStrip}

        {/*
          The server-authored recommendation decides whether a completed
          investigation exposes the code-fix action. The human verdict remains
          independent: it records whether the analysis was correct even when
          no pull request is applicable.
        */}
        {runStatus === AIRunStatus.Completed ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 sm:p-5">
            <div
              className={
                isCodeFixRecommended
                  ? "grid gap-5 lg:grid-cols-2 lg:gap-6"
                  : "grid gap-5"
              }
            >
              {isCodeFixRecommended ? (
                <div>
                  <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                    <Icon
                      icon={IconProp.Code}
                      className="h-4 w-4 text-gray-400"
                    />
                    Act on this investigation
                  </p>
                  <p className="mb-3 mt-1 text-xs leading-5 text-gray-500">
                    Create a fix pull request with this report as context.
                  </p>
                  {fixTaskRunId ? (
                    <Alert
                      type={AlertType.SUCCESS}
                      strongTitle="Fix task created"
                      title={
                        <span>
                          AI will open a pull request from this analysis.{" "}
                          <Link
                            className="underline"
                            to={RouteUtil.populateRouteParams(
                              RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
                              { modelId: fixTaskRunId },
                            )}
                          >
                            View task progress
                          </Link>
                          .
                        </span>
                      }
                    />
                  ) : (
                    <>
                      {fixTaskError ? (
                        <div className="mb-3">
                          <Alert
                            type={AlertType.DANGER}
                            strongTitle="Could not create the fix task"
                            title={
                              <span>
                                {fixTaskError}{" "}
                                <Link
                                  className="underline"
                                  to={RouteUtil.populateRouteParams(
                                    RouteMap[PageMap.AI_AGENT_TASKS] as Route,
                                  )}
                                >
                                  View AI tasks
                                </Link>
                                .
                              </span>
                            }
                          />
                        </div>
                      ) : (
                        <></>
                      )}
                      <Button
                        title="Open Fix PR from this analysis"
                        icon={IconProp.Code}
                        buttonStyle={ButtonStyleType.OUTLINE}
                        buttonSize={ButtonSize.Small}
                        isLoading={isCreatingFixTask}
                        disabled={!analysisMarkdown}
                        onClick={() => {
                          createFixTask().catch(() => {
                            // handled inside createFixTask
                          });
                        }}
                      />
                    </>
                  )}
                </div>
              ) : (
                <></>
              )}

              {/*
                A quiet human verdict on the analysis. The server returns
                `humanVerdict` on every investigation payload, so the state
                survives polling refreshes; the buttons update optimistically.
                The two choices sit in one segmented control so they read as a
                single question with two answers rather than two unrelated
                actions, and the prompt collapses to a pill once answered.
              */}
              <div
                className={
                  isCodeFixRecommended
                    ? "lg:border-l lg:border-gray-200 lg:pl-6"
                    : ""
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-semibold text-gray-900">
                      <Icon
                        icon={IconProp.Star}
                        className="h-4 w-4 text-gray-400"
                      />
                      Rate this investigation
                    </p>
                    <p className="mt-1 text-xs leading-5 text-gray-500">
                      Your verdict helps measure OneUptime AI&apos;s public
                      accuracy.
                    </p>
                  </div>

                  <div className="flex-shrink-0">
                    {humanVerdict && !isChangingVerdict ? (
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset ${
                            isConfirmed
                              ? "bg-green-50 text-green-700 ring-green-200"
                              : "bg-rose-50 text-rose-700 ring-rose-200"
                          }`}
                        >
                          <Icon
                            icon={isConfirmed ? IconProp.Check : IconProp.Close}
                            className="h-3.5 w-3.5"
                          />
                          <span>
                            You {isConfirmed ? "confirmed" : "rejected"} this
                            analysis
                          </span>
                        </span>
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 underline-offset-2 hover:bg-gray-100 hover:text-gray-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                          onClick={() => {
                            setIsChangingVerdict(true);
                          }}
                        >
                          Change
                        </button>
                      </div>
                    ) : (
                      <div
                        role="group"
                        aria-label="Rate this investigation"
                        className="inline-flex items-center rounded-lg border border-gray-300 bg-white p-1 shadow-sm"
                      >
                        <button
                          type="button"
                          disabled={isVerdictLocked}
                          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-green-50 hover:text-green-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-gray-600"
                          onClick={() => {
                            submitVerdict("Confirmed").catch(() => {
                              // handled inside submitVerdict
                            });
                          }}
                        >
                          <Icon icon={IconProp.Check} className="h-4 w-4" />
                          Confirmed
                        </button>
                        <span
                          aria-hidden="true"
                          className="mx-0.5 h-5 w-px flex-shrink-0 bg-gray-200"
                        />
                        <button
                          type="button"
                          disabled={isVerdictLocked}
                          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:bg-rose-50 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-gray-600"
                          onClick={() => {
                            submitVerdict("Rejected").catch(() => {
                              // handled inside submitVerdict
                            });
                          }}
                        >
                          <Icon icon={IconProp.Close} className="h-4 w-4" />
                          Rejected
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {verdictError ? (
                  <div className="mt-3">
                    <Alert
                      type={AlertType.DANGER}
                      strongTitle="Could not save your verdict"
                      title={verdictError}
                    />
                  </div>
                ) : (
                  <></>
                )}
              </div>
            </div>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default InvestigationPanel;
