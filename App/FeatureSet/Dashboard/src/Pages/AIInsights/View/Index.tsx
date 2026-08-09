import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getHumanVerdictElement,
  getInsightTypeElement,
  getInsightTypeIcon,
  getSeverityElement,
  getSeverityTileClasses,
  getStatusElement,
  getStatusLabel,
} from "../../../Components/AIInsights/InsightPresentation";
import InsightFactsList, {
  InsightFact,
} from "../../../Components/AIInsights/InsightFactsList";
import InsightPanel from "../../../Components/AIInsights/InsightPanel";
import ChatActivityFeed from "../../../Components/AIChat/ChatActivityFeed";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIInsight from "Common/Models/DatabaseModels/AIInsight";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import AIInsightHumanVerdict from "Common/Types/AI/AIInsightHumanVerdict";
import AIInsightStatus, {
  AIInsightStatusHelper,
} from "Common/Types/AI/AIInsightStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Link from "Common/UI/Components/Link/Link";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";

const POLL_INTERVAL_MS: number = 5000;
// The server caps the triage event trail at 500 — show all of it.
const MAX_VISIBLE_STEPS: number = 500;

type InsightAction = "confirm" | "dismiss" | "resolve";

/*
 * The insight detail: the deterministic evidence (detail markdown written
 * by the detector), the live AI triage panel (same glass-box ChatActivityFeed
 * the AI investigations use), a link to the fix task when one was
 * queued, and the one-click human actions (confirm/dismiss/resolve) that
 * feed the AI's measured per-detector precision.
 */
const AIInsightViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  /*
   * The id must come from useParams (a stable string), NOT from
   * Navigation.getLastParamAsObjectID(): that helper mints a fresh ObjectID
   * object on every render, and using it as a useCallback dependency made
   * every render rebuild the fetchers, which re-ran the fetch effect, whose
   * setState re-rendered — an unbounded refetch loop that kept the page
   * spinning forever.
   */
  const { id } = useParams();
  const modelId: ObjectID = useMemo(() => {
    return new ObjectID(id || "");
  }, [id]);

  const [insight, setInsight] = useState<AIInsight | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  /*
   * Status and verdict live outside the insight object so the action
   * buttons can update them optimistically and roll back on error without
   * cloning the model.
   */
  const [status, setStatus] = useState<AIInsightStatus | null>(null);
  const [humanVerdict, setHumanVerdict] =
    useState<AIInsightHumanVerdict | null>(null);

  const [triageRun, setTriageRun] = useState<AIRun | null>(null);
  const [triageEvents, setTriageEvents] = useState<Array<AIRunEvent>>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const triageSignatureRef: React.MutableRefObject<string> = useRef<string>("");

  const [isSavingAction, setIsSavingAction] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /*
   * Guards a polled refetch from clobbering the optimistic status/verdict
   * while a save is in flight; once the POST settles, the server value is
   * the source of truth again.
   */
  const isSavingActionRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const fetchInsight: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const item: AIInsight | null = await ModelAPI.getItem<AIInsight>({
          modelType: AIInsight,
          id: modelId,
          select: {
            title: true,
            insightType: true,
            severity: true,
            status: true,
            humanVerdict: true,
            serviceName: true,
            metricName: true,
            firstSeenAt: true,
            lastSeenAt: true,
            occurrenceCount: true,
            detailMarkdown: true,
            triageSummaryMarkdown: true,
            fixAiRunId: true,
          },
        });

        setInsight(item);
        if (item && !isSavingActionRef.current) {
          setStatus(item.status || null);
          setHumanVerdict(item.humanVerdict || null);
        }
        setInsightError(null);
      } catch (err) {
        // Rendered only while no insight has loaded (see below).
        setInsightError(API.getFriendlyMessage(err));
      }
    }, [modelId]);

  /*
   * The live triage panel: {run, events} from the dedicated endpoint —
   * triage runs are system-authored AIRuns hidden from the generic CRUD.
   * Best-effort: a missing run simply renders nothing.
   */
  const fetchTriage: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/ai-insight/triage-run",
            ),
            data: { insightId: modelId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          return;
        }

        const data: JSONObject = response.data as JSONObject;
        const runJson: JSONObject | null =
          (data["run"] as JSONObject | null) || null;
        const eventsJson: JSONArray = (data["events"] as JSONArray) || [];

        if (!runJson) {
          return;
        }

        // Skip re-render when nothing changed (status + event count).
        const runStatus: string =
          (runJson["status"] as string | undefined) || "none";
        const signature: string = `${runStatus}:${eventsJson.length}`;
        if (signature !== triageSignatureRef.current) {
          triageSignatureRef.current = signature;
          setTriageRun(AIRun.fromJSONObject(runJson, AIRun));
          setTriageEvents(
            AIRunEvent.fromJSONArray(
              eventsJson as Array<JSONObject>,
              AIRunEvent,
            ),
          );
        }
      } catch {
        // Best-effort panel — never surface an error here.
      }
    }, [modelId]);

  useEffect(() => {
    Promise.all([fetchInsight(), fetchTriage()])
      .catch(() => {
        // handled inside the fetchers
      })
      .finally(() => {
        setHasLoadedOnce(true);
      });
  }, [fetchInsight, fetchTriage]);

  // Poll while the triage run can still make progress.
  const isTriageActive: boolean = Boolean(
    triageRun?.status && !AIRunStatusHelper.isTerminalStatus(triageRun.status),
  );

  useEffect(() => {
    if (!isTriageActive) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchTriage().catch(() => {
        // handled inside fetchTriage
      });
    }, POLL_INTERVAL_MS);

    return () => {
      return clearInterval(interval);
    };
  }, [isTriageActive, fetchTriage]);

  /*
   * When the triage run lands, refetch the insight once — the runner posts
   * triageSummaryMarkdown onto the insight as it completes.
   */
  const wasTriageActiveRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  useEffect(() => {
    if (wasTriageActiveRef.current && !isTriageActive) {
      fetchInsight().catch(() => {
        // handled inside fetchInsight
      });
    }
    wasTriageActiveRef.current = isTriageActive;
  }, [isTriageActive, fetchInsight]);

  /*
   * The one-click human actions. Optimistic — the pills update immediately;
   * a failed POST rolls status/verdict back and shows the error inline.
   * Confirm records the verdict and leaves the status; Dismiss also closes
   * the insight; Resolve closes it as handled (implying Confirmed when no
   * verdict was recorded — the server does the same).
   */
  const performAction: (action: InsightAction) => Promise<void> = useCallback(
    async (action: InsightAction): Promise<void> => {
      const previousStatus: AIInsightStatus | null = status;
      const previousVerdict: AIInsightHumanVerdict | null = humanVerdict;

      setIsSavingAction(true);
      isSavingActionRef.current = true;
      setActionError(null);

      if (action === "confirm") {
        setHumanVerdict(AIInsightHumanVerdict.Confirmed);
      } else if (action === "dismiss") {
        setHumanVerdict(AIInsightHumanVerdict.Dismissed);
        setStatus(AIInsightStatus.Dismissed);
      } else {
        setStatus(AIInsightStatus.Resolved);
        if (!previousVerdict) {
          setHumanVerdict(AIInsightHumanVerdict.Confirmed);
        }
      }

      try {
        const routePath: string =
          action === "resolve" ? "/ai-insight/resolve" : "/ai-insight/verdict";
        const payload: JSONObject =
          action === "resolve"
            ? { insightId: modelId.toString() }
            : {
                insightId: modelId.toString(),
                verdict:
                  action === "confirm"
                    ? AIInsightHumanVerdict.Confirmed
                    : AIInsightHumanVerdict.Dismissed,
              };

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(routePath),
            data: payload,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
      } catch (err) {
        // Roll back the optimistic update.
        setStatus(previousStatus);
        setHumanVerdict(previousVerdict);
        setActionError(API.getFriendlyMessage(err));
      }

      setIsSavingAction(false);
      isSavingActionRef.current = false;
    },
    [status, humanVerdict, modelId],
  );

  if (!hasLoadedOnce) {
    return <PageLoader isVisible={true} />;
  }

  if (insightError && !insight) {
    return <ErrorMessage message={insightError} />;
  }

  if (!insight) {
    return <ErrorMessage message="Insight not found" />;
  }

  const isTerminal: boolean = Boolean(
    status && AIInsightStatusHelper.isTerminalStatus(status),
  );
  const isConfirmed: boolean = humanVerdict === AIInsightHumanVerdict.Confirmed;

  /*
   * The triage strip: a tinted panel rather than a bare colored line, so a
   * run that is still working, one that finished and one that died are
   * distinguishable at a glance and not just by reading the sentence.
   */
  interface TriageStatusMeta {
    text: string;
    className: string;
    icon: IconProp;
  }

  let triageStatusMeta: TriageStatusMeta = {
    text: "Triage did not finish",
    className: "border-red-100 bg-red-50 text-red-700",
    icon: IconProp.Alert,
  };
  let isTriageFailed: boolean = true;

  if (triageRun?.status === AIRunStatus.Running) {
    triageStatusMeta = {
      text: "Triaging…",
      className: "border-indigo-100 bg-indigo-50 text-indigo-700",
      icon: IconProp.Sparkles,
    };
    isTriageFailed = false;
  } else if (triageRun?.status === AIRunStatus.Queued) {
    triageStatusMeta = {
      text: "Queued — waiting for a worker…",
      className: "border-indigo-100 bg-indigo-50 text-indigo-700",
      icon: IconProp.Sparkles,
    };
    isTriageFailed = false;
  } else if (triageRun?.status === AIRunStatus.Completed) {
    triageStatusMeta = {
      text: "Triage complete",
      className: "border-green-100 bg-green-50 text-green-700",
      icon: IconProp.Check,
    };
    isTriageFailed = false;
  }

  const facts: Array<InsightFact> = [];

  if (insight.serviceName) {
    facts.push({
      label: "Service",
      icon: IconProp.Cube,
      value: insight.serviceName,
    });
  }

  if (insight.metricName) {
    facts.push({
      label: "Metric",
      icon: IconProp.ChartBar,
      value: insight.metricName,
    });
  }

  facts.push({
    label: "Detections",
    icon: IconProp.Refresh,
    value:
      insight.occurrenceCount === 1
        ? "Once"
        : `${insight.occurrenceCount || 0} times`,
  });

  if (insight.firstSeenAt) {
    facts.push({
      label: "First seen",
      icon: IconProp.Clock,
      value: OneUptimeDate.fromNow(insight.firstSeenAt),
      title: OneUptimeDate.getDateAsLocalFormattedString(insight.firstSeenAt),
    });
  }

  if (insight.lastSeenAt) {
    facts.push({
      label: "Last seen",
      icon: IconProp.Clock,
      value: OneUptimeDate.fromNow(insight.lastSeenAt),
      title: OneUptimeDate.getDateAsLocalFormattedString(insight.lastSeenAt),
    });
  }

  return (
    <div className="space-y-5">
      {/* Overview: what was found, where it stands, and the one-click actions. */}
      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="px-5 py-6 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <span
                className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl ${getSeverityTileClasses(
                  insight.severity,
                )}`}
              >
                <Icon
                  icon={getInsightTypeIcon(insight.insightType)}
                  className="h-6 w-6"
                />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-6 text-gray-900">
                  {insight.title}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {getInsightTypeElement(insight.insightType)}
                  {getSeverityElement(insight.severity)}
                  {getStatusElement(status || undefined)}
                  {getHumanVerdictElement(humanVerdict)}
                </div>
              </div>
            </div>

            {!isTerminal ? (
              <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
                <Button
                  title="Confirm"
                  icon={IconProp.Check}
                  buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
                  buttonSize={ButtonSize.Small}
                  disabled={isSavingAction || isConfirmed}
                  onClick={() => {
                    performAction("confirm").catch(() => {
                      // handled inside performAction
                    });
                  }}
                />
                <Button
                  title="Dismiss"
                  icon={IconProp.Close}
                  buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                  buttonSize={ButtonSize.Small}
                  disabled={isSavingAction}
                  onClick={() => {
                    performAction("dismiss").catch(() => {
                      // handled inside performAction
                    });
                  }}
                />
                <Button
                  title="Resolve"
                  icon={IconProp.CheckCircle}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  buttonSize={ButtonSize.Small}
                  disabled={isSavingAction}
                  onClick={() => {
                    performAction("resolve").catch(() => {
                      // handled inside performAction
                    });
                  }}
                />
              </div>
            ) : (
              <></>
            )}
          </div>

          {actionError ? (
            <div className="mt-4">
              <Alert
                type={AlertType.DANGER}
                strongTitle="Could not save your action"
                title={actionError}
              />
            </div>
          ) : (
            <></>
          )}
        </div>

        {/*
         * A closed insight loses its action buttons, which on its own reads
         * as a page that failed to render them — say why instead.
         */}
        <p className="border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-500 md:px-6">
          {isTerminal
            ? `This insight is closed as ${getStatusLabel(
                status || undefined,
              )}. Detectors never reopen a closed insight — a new occurrence files a new one.`
            : "Confirm or dismiss to record whether this insight was worth surfacing — verdicts measure each detector's precision. Resolve it once it has been handled."}
        </p>
      </section>

      {/*
       * Two columns from xl up: the evidence and the AI's reasoning are prose
       * and want a readable measure, not the full width of a 27" display,
       * and the facts read better as a scannable rail beside them.
       */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <InsightPanel
            title="Evidence"
            icon={IconProp.ClipboardDocumentCheck}
            description="The deterministic evidence behind this insight — real counts, baselines and multipliers written by the detector at detect time. Not AI output."
          >
            {insight.detailMarkdown ? (
              /*
               * safeMode is mandatory here: the detectors interpolate raw
               * telemetry into this markdown (NewExceptionDetector and
               * ExceptionSpikeDetector push `exception.message` in verbatim,
               * not even fenced), and an exception message is
               * attacker-influenceable — anything that reaches an
               * instrumented service can shape it. Without safeMode a message
               * carrying `![](https://attacker/p.png)` becomes a zero-click
               * tracking beacon that fires in a privileged member's browser,
               * and `[click](https://attacker/…)` becomes a phishing link
               * wearing our chrome. safeMode neutralizes links, images and
               * mermaid on the PARSED tree, so no CommonMark syntax trick can
               * smuggle either past the parser.
               */
              <MarkdownViewer text={insight.detailMarkdown} safeMode={true} />
            ) : (
              <p className="text-sm text-gray-500">No evidence was recorded.</p>
            )}
          </InsightPanel>

          {triageRun || insight.triageSummaryMarkdown ? (
            <InsightPanel
              title="AI Triage"
              icon={IconProp.Sparkles}
              description="A budgeted, read-only AI analysis of this insight — probable root cause, blast radius and suggested action, with citations."
            >
              <div className="space-y-3">
                {insight.triageSummaryMarkdown ? (
                  /*
                   * safeMode is mandatory here too: this summary is LLM output
                   * produced from a prompt that embeds the insight's detail
                   * markdown and the telemetry behind it, so it is
                   * prompt-injectable — the model can be talked into emitting
                   * an image or link the attacker chose. Same defense the AI
                   * chat uses for the same reason
                   * (Components/AIChat/SafeChatMarkdown).
                   */
                  <MarkdownViewer
                    text={insight.triageSummaryMarkdown}
                    safeMode={true}
                  />
                ) : (
                  <div>
                    <div
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${triageStatusMeta.className}`}
                    >
                      <span className="flex-shrink-0">
                        <Icon
                          icon={triageStatusMeta.icon}
                          className="h-4 w-4"
                        />
                      </span>
                      <span>{triageStatusMeta.text}</span>
                      {isTriageActive ? (
                        <span className="ml-auto inline-block h-2 w-2 animate-ping rounded-full bg-indigo-500" />
                      ) : (
                        <></>
                      )}
                    </div>
                    {isTriageFailed && triageRun?.errorMessage ? (
                      <p className="mt-2 text-xs text-red-500">
                        {triageRun.errorMessage}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                )}

                {triageEvents.length > 0 ? (
                  <ChatActivityFeed
                    events={triageEvents}
                    title={isTriageActive ? "Triaging…" : "Activity"}
                    showLiveIndicator={isTriageActive}
                    maxVisibleSteps={MAX_VISIBLE_STEPS}
                  />
                ) : (
                  <></>
                )}
              </div>
            </InsightPanel>
          ) : (
            <></>
          )}
        </div>

        <div className="min-w-0 space-y-5">
          <InsightPanel title="Details" icon={IconProp.List}>
            <InsightFactsList facts={facts} />
          </InsightPanel>

          {insight.fixAiRunId ? (
            <InsightPanel
              title="Fix Task"
              icon={IconProp.Code}
              description="OneUptime AI queued an agent task for this insight. Fix pull requests are always drafts and always human-reviewed."
            >
              {/*
               * A real anchor (not a Button) so cmd/ctrl-click, middle-click
               * and "open in new tab" work — Link always sets href.
               */}
              <Link
                to={RouteUtil.populateRouteParams(
                  RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
                  { modelId: insight.fixAiRunId },
                )}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-500"
              >
                <span>View the fix task and pull request</span>
                <Icon icon={IconProp.ArrowRight} className="h-4 w-4" />
              </Link>
            </InsightPanel>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIInsightViewPage;
