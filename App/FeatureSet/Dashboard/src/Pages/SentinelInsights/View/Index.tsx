import PageComponentProps from "../../PageComponentProps";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getInsightTypeElement,
  getSeverityElement,
  getStatusElement,
} from "../Insights";
import ChatActivityFeed from "../../../Components/AIChat/ChatActivityFeed";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import SentinelInsight from "Common/Models/DatabaseModels/SentinelInsight";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import SentinelInsightHumanVerdict from "Common/Types/AI/SentinelInsightHumanVerdict";
import SentinelInsightStatus, {
  SentinelInsightStatusHelper,
} from "Common/Types/AI/SentinelInsightStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const POLL_INTERVAL_MS: number = 5000;
// The server caps the triage event trail at 500 — show all of it.
const MAX_VISIBLE_STEPS: number = 500;

type InsightAction = "confirm" | "dismiss" | "resolve";

/*
 * The insight detail: the deterministic evidence (detail markdown written
 * by the detector), the live AI triage panel (same glass-box ChatActivityFeed
 * the Sentinel investigations use), a link to the fix task when one was
 * queued, and the one-click human actions (confirm/dismiss/resolve) that
 * feed Sentinel's measured per-detector precision.
 */
const SentinelInsightViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [insight, setInsight] = useState<SentinelInsight | null>(null);
  const [insightError, setInsightError] = useState<string | null>(null);
  /*
   * Status and verdict live outside the insight object so the action
   * buttons can update them optimistically and roll back on error without
   * cloning the model.
   */
  const [status, setStatus] = useState<SentinelInsightStatus | null>(null);
  const [humanVerdict, setHumanVerdict] =
    useState<SentinelInsightHumanVerdict | null>(null);

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
  // Flipping this makes the CardModelDetail refetch after an action lands.
  const [detailRefresher, setDetailRefresher] = useState<boolean>(false);

  const fetchInsight: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const item: SentinelInsight | null =
          await ModelAPI.getItem<SentinelInsight>({
            modelType: SentinelInsight,
            id: modelId,
            select: {
              status: true,
              humanVerdict: true,
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
              "/sentinel-insight/triage-run",
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
      const previousStatus: SentinelInsightStatus | null = status;
      const previousVerdict: SentinelInsightHumanVerdict | null = humanVerdict;

      setIsSavingAction(true);
      isSavingActionRef.current = true;
      setActionError(null);

      if (action === "confirm") {
        setHumanVerdict(SentinelInsightHumanVerdict.Confirmed);
      } else if (action === "dismiss") {
        setHumanVerdict(SentinelInsightHumanVerdict.Dismissed);
        setStatus(SentinelInsightStatus.Dismissed);
      } else {
        setStatus(SentinelInsightStatus.Resolved);
        if (!previousVerdict) {
          setHumanVerdict(SentinelInsightHumanVerdict.Confirmed);
        }
      }

      try {
        const routePath: string =
          action === "resolve"
            ? "/sentinel-insight/resolve"
            : "/sentinel-insight/verdict";
        const payload: JSONObject =
          action === "resolve"
            ? { insightId: modelId.toString() }
            : {
                insightId: modelId.toString(),
                verdict:
                  action === "confirm"
                    ? SentinelInsightHumanVerdict.Confirmed
                    : SentinelInsightHumanVerdict.Dismissed,
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

        // Make the detail card pick up the new status/verdict.
        setDetailRefresher((value: boolean) => {
          return !value;
        });
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
    status && SentinelInsightStatusHelper.isTerminalStatus(status),
  );
  const isConfirmed: boolean =
    humanVerdict === SentinelInsightHumanVerdict.Confirmed;

  interface TriageStatusMeta {
    text: string;
    className: string;
    icon: IconProp;
  }

  let triageStatusMeta: TriageStatusMeta = {
    text: "Triage did not finish",
    className: "text-red-600",
    icon: IconProp.Alert,
  };
  let isTriageFailed: boolean = true;

  if (triageRun?.status === AIRunStatus.Running) {
    triageStatusMeta = {
      text: "Triaging…",
      className: "text-indigo-600",
      icon: IconProp.Sparkles,
    };
    isTriageFailed = false;
  } else if (triageRun?.status === AIRunStatus.Queued) {
    triageStatusMeta = {
      text: "Queued — waiting for a worker…",
      className: "text-indigo-600",
      icon: IconProp.Sparkles,
    };
    isTriageFailed = false;
  } else if (triageRun?.status === AIRunStatus.Completed) {
    triageStatusMeta = {
      text: "Triage complete",
      className: "text-green-600",
      icon: IconProp.Check,
    };
    isTriageFailed = false;
  }

  return (
    <div className="space-y-4">
      <CardModelDetail<SentinelInsight>
        name="Insight Details"
        cardProps={{
          title: "Insight Details",
          description:
            "What Sentinel's deterministic sensors found, and where this insight stands.",
        }}
        refresher={detailRefresher}
        modelDetailProps={{
          showDetailsInNumberOfColumns: 2,
          modelType: SentinelInsight,
          id: "model-detail-sentinel-insight",
          fields: [
            {
              field: {
                insightType: true,
              },
              title: "Type",
              fieldType: FieldType.Element,
              getElement: (item: SentinelInsight): ReactElement => {
                return getInsightTypeElement(item.insightType);
              },
            },
            {
              field: {
                severity: true,
              },
              title: "Severity",
              fieldType: FieldType.Element,
              getElement: (item: SentinelInsight): ReactElement => {
                return getSeverityElement(item.severity);
              },
            },
            {
              field: {
                status: true,
              },
              title: "Status",
              fieldType: FieldType.Element,
              getElement: (item: SentinelInsight): ReactElement => {
                return getStatusElement(item.status);
              },
            },
            {
              field: {
                humanVerdict: true,
              },
              title: "Human Verdict",
              fieldType: FieldType.Text,
              placeholder: "None yet",
            },
            {
              field: {
                serviceName: true,
              },
              title: "Service",
              fieldType: FieldType.Text,
              placeholder: "-",
            },
            {
              field: {
                firstSeenAt: true,
              },
              title: "First Seen",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                lastSeenAt: true,
              },
              title: "Last Seen",
              fieldType: FieldType.DateTime,
            },
            {
              field: {
                occurrenceCount: true,
              },
              title: "Occurrences",
              fieldType: FieldType.Number,
            },
          ],
          modelId: modelId,
        }}
      />

      <Card
        title="Evidence"
        description="The deterministic evidence behind this insight — real counts, baselines and multipliers written by the detector at detect time. Not AI output."
      >
        {insight.detailMarkdown ? (
          /*
           * safeMode is mandatory here: the detectors interpolate raw
           * telemetry into this markdown (NewExceptionDetector and
           * ExceptionSpikeDetector push `exception.message` in verbatim, not
           * even fenced), and an exception message is attacker-influenceable
           * — anything that reaches an instrumented service can shape it.
           * Without safeMode a message carrying `![](https://attacker/p.png)`
           * becomes a zero-click tracking beacon that fires in a privileged
           * member's browser, and `[click](https://attacker/…)` becomes a
           * phishing link wearing our chrome. safeMode neutralizes links,
           * images and mermaid on the PARSED tree, so no CommonMark syntax
           * trick can smuggle either past the parser.
           */
          <MarkdownViewer text={insight.detailMarkdown} safeMode={true} />
        ) : (
          <p className="text-sm text-gray-500">No evidence was recorded.</p>
        )}
      </Card>

      {triageRun || insight.triageSummaryMarkdown ? (
        <Card
          title="Sentinel Triage"
          description="Sentinel's budgeted, read-only AI analysis of this insight — probable root cause, blast radius and suggested action, with citations."
        >
          <div className="space-y-3">
            {insight.triageSummaryMarkdown ? (
              /*
               * safeMode is mandatory here too: this summary is LLM output
               * produced from a prompt that embeds the insight's detail
               * markdown and the telemetry behind it, so it is
               * prompt-injectable — the model can be talked into emitting an
               * image or link the attacker chose. Same defense the AI chat
               * uses for the same reason (Components/AIChat/SafeChatMarkdown).
               */
              <MarkdownViewer
                text={insight.triageSummaryMarkdown}
                safeMode={true}
              />
            ) : (
              <div>
                <div
                  className={`flex items-center gap-2 text-sm font-medium ${triageStatusMeta.className}`}
                >
                  <Icon icon={triageStatusMeta.icon} className="h-4 w-4" />
                  <span>{triageStatusMeta.text}</span>
                  {isTriageActive ? (
                    <span className="ml-1 inline-block h-2 w-2 animate-ping rounded-full bg-indigo-500" />
                  ) : (
                    <></>
                  )}
                </div>
                {isTriageFailed && triageRun?.errorMessage ? (
                  <p className="mt-1 text-xs text-red-500">
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
        </Card>
      ) : (
        <></>
      )}

      {insight.fixAiRunId ? (
        <Card
          title="Fix Task"
          description="Sentinel queued an AI agent task for this insight. Fix pull requests are always drafts and always human-reviewed."
        >
          <Link
            className="text-sm underline"
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
              { modelId: insight.fixAiRunId },
            )}
          >
            View the fix task and pull request
          </Link>
        </Card>
      ) : (
        <></>
      )}

      <Card
        title="Act on This Insight"
        description="Confirm or dismiss to record whether this insight was worth surfacing — verdicts measure each detector's precision. Resolve it once it has been handled."
      >
        <div className="space-y-3">
          {actionError ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle="Could not save your action"
              title={actionError}
            />
          ) : (
            <></>
          )}

          {isConfirmed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
              <Icon icon={IconProp.Check} className="h-3 w-3" />
              <span>Confirmed by a human</span>
            </span>
          ) : (
            <></>
          )}

          {humanVerdict === SentinelInsightHumanVerdict.Dismissed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
              <Icon icon={IconProp.Close} className="h-3 w-3" />
              <span>Dismissed by a human</span>
            </span>
          ) : (
            <></>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              title="Confirm"
              icon={IconProp.Check}
              buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
              buttonSize={ButtonSize.Small}
              disabled={isSavingAction || isTerminal || isConfirmed}
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
              disabled={isSavingAction || isTerminal}
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
              disabled={isSavingAction || isTerminal}
              onClick={() => {
                performAction("resolve").catch(() => {
                  // handled inside performAction
                });
              }}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default SentinelInsightViewPage;
