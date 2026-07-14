import ChatActivityFeed from "../AIChat/ChatActivityFeed";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
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
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type InvestigationSubjectType = "incident" | "alert";

export type InvestigationVerdict = "Confirmed" | "Rejected";

export interface ComponentProps {
  subjectType: InvestigationSubjectType;
  subjectId: ObjectID;
}

const POLL_INTERVAL_MS: number = 2500;

/*
 * Sentinel's live "watch it think" panel, shared by the incident and alert
 * view pages. It shows the autonomous investigation narrating its steps in
 * real time (reusing ChatActivityFeed over the run's AIRunEvents) and its
 * status. Renders nothing until an investigation exists for the subject, so
 * it's invisible for projects that haven't enabled Sentinel. The full cited
 * root cause lands in the subject's timeline below; this panel is the
 * reasoning trail.
 */
const InvestigationPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<AIRunEvent>>([]);
  const [stats, setStats] = useState<{
    toolCallCount: number;
    totalTokens: number;
  } | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const signatureRef: React.MutableRefObject<string> = useRef<string>("");

  // "Open Fix PR from this analysis" (the FixFromIncident recipe) state.
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

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + `/ai-investigation/${props.subjectType}`,
            ),
            data: { [`${props.subjectType}Id`]: props.subjectId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          setHasLoadedOnce(true);
          return;
        }

        const data: JSONObject = response.data as JSONObject;
        const runJson: JSONObject | null =
          (data["run"] as JSONObject | null) || null;
        const eventsJson: JSONArray = (data["events"] as JSONArray) || [];

        const status: string | null =
          (runJson?.["status"] as string | undefined) || null;
        const verdictFromServer: string | null =
          (runJson?.["humanVerdict"] as string | undefined) || null;

        // Skip re-render when nothing changed (status + event count + verdict).
        const signature: string = `${status || "none"}:${eventsJson.length}:${verdictFromServer || "none"}`;
        if (signature !== signatureRef.current) {
          signatureRef.current = signature;
          setRunStatus(status);
          setErrorMessage(
            (runJson?.["errorMessage"] as string | undefined) || null,
          );
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
                  toolCallCount:
                    (runJson["toolCallCount"] as number | undefined) || 0,
                  totalTokens:
                    (runJson["totalTokens"] as number | undefined) || 0,
                }
              : null,
          );
        }

        setHasLoadedOnce(true);
      } catch {
        // Best-effort panel — never surface an error here.
        setHasLoadedOnce(true);
      }
    }, [props.subjectType, props.subjectId]);

  useEffect(() => {
    fetchData().catch(() => {
      // handled inside fetchData
    });
  }, [fetchData]);

  /*
   * Human-triggered `code_fix`: enqueue a FixFromIncident task that takes
   * the posted analysis as context and opens a fix pull request. The server
   * gates (completed investigation, GitHub-App repository, one active run
   * per subject) fail with a message shown inline.
   */
  const createFixTask: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      setIsCreatingFixTask(true);
      setFixTaskError(null);

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + "/ai-investigation/create-fix-task",
            ),
            data: {
              subjectType: props.subjectType,
              subjectId: props.subjectId.toString(),
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const aiRunId: string | undefined = (response.data as JSONObject)[
          "aiRunId"
        ] as string | undefined;

        setFixTaskRunId(aiRunId || null);
      } catch (err) {
        setFixTaskError(API.getFriendlyMessage(err));
      }

      setIsCreatingFixTask(false);
    }, [props.subjectType, props.subjectId]);

  /*
   * Human verdict on a completed analysis ("Was this analysis correct?").
   * Optimistic — the pill renders immediately; a failed POST rolls the
   * verdict back and shows the error inline. Idempotent overwrite on the
   * server, so changing a verdict is the same call.
   */
  const submitVerdict: (verdict: InvestigationVerdict) => Promise<void> =
    useCallback(
      async (verdict: InvestigationVerdict): Promise<void> => {
        const previousVerdict: string | null = humanVerdict;

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
                subjectType: props.subjectType,
                subjectId: props.subjectId.toString(),
                verdict: verdict,
              },
              headers: ModelAPI.getCommonHeaders(),
            });

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }
        } catch (err) {
          // Roll back the optimistic update.
          setHumanVerdict(previousVerdict);
          setVerdictError(API.getFriendlyMessage(err));
        }

        setIsSavingVerdict(false);
        isSavingVerdictRef.current = false;
      },
      [props.subjectType, props.subjectId, humanVerdict],
    );

  const isRunning: boolean = runStatus === AIRunStatus.Running;
  const isQueued: boolean = runStatus === AIRunStatus.Queued;
  // Poll while the run can still make progress (queued runs get claimed).
  const isActive: boolean = isRunning || isQueued;

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchData().catch(() => {
        // handled inside fetchData
      });
    }, POLL_INTERVAL_MS);

    return () => {
      return clearInterval(interval);
    };
  }, [isActive, fetchData]);

  // Nothing to show until an investigation exists for this subject.
  if (!hasLoadedOnce || !runStatus) {
    return <></>;
  }

  interface StatusMeta {
    text: string;
    className: string;
    icon: IconProp;
  }

  let statusMeta: StatusMeta = {
    text: "Investigation did not finish",
    className: "text-red-600",
    icon: IconProp.Alert,
  };
  let isFailed: boolean = true;

  if (runStatus === AIRunStatus.Running) {
    statusMeta = {
      text: "Investigating…",
      className: "text-indigo-600",
      icon: IconProp.Sparkles,
    };
    isFailed = false;
  } else if (runStatus === AIRunStatus.Queued) {
    statusMeta = {
      text: "Queued — waiting for a worker…",
      className: "text-indigo-600",
      icon: IconProp.Sparkles,
    };
    isFailed = false;
  } else if (runStatus === AIRunStatus.Completed) {
    statusMeta = {
      text: "Investigation complete",
      className: "text-green-600",
      icon: IconProp.Check,
    };
    isFailed = false;
  }

  return (
    <Card
      title="Sentinel Investigation"
      description={`Sentinel's live root-cause investigation for this ${props.subjectType}.`}
    >
      <div className="-mt-4">
        <div
          className={`flex items-center gap-2 text-sm font-medium ${statusMeta.className}`}
        >
          <Icon icon={statusMeta.icon} className="h-4 w-4" />
          <span>{statusMeta.text}</span>
          {isActive ? (
            <span className="ml-1 inline-block h-2 w-2 animate-ping rounded-full bg-indigo-500" />
          ) : (
            <></>
          )}
        </div>

        {isFailed && errorMessage ? (
          <p className="mt-1 text-xs text-red-500">{errorMessage}</p>
        ) : (
          <></>
        )}

        <div className="mt-3">
          {events.length > 0 ? (
            <ChatActivityFeed events={events} />
          ) : (
            <p className="text-sm text-gray-500">
              {isActive
                ? "Starting investigation…"
                : "No investigation steps were recorded."}
            </p>
          )}
        </div>

        {!isRunning && stats ? (
          <p className="mt-3 text-xs text-gray-400">
            {stats.toolCallCount} quer
            {stats.toolCallCount === 1 ? "y" : "ies"} across your telemetry
            {stats.totalTokens > 0
              ? ` · ${stats.totalTokens.toLocaleString()} tokens`
              : ""}
            . The full cited root cause is in the {props.subjectType} timeline
            below.
          </p>
        ) : (
          <></>
        )}

        {/*
          Two quiet actions under a completed analysis: hand the posted
          root-cause analysis to the AI agent as context for a fix pull
          request (the FixFromIncident recipe), and record a human verdict
          on whether the analysis was correct. Human-triggered by design —
          the user judges whether the analysis is worth a PR, and their
          verdicts feed Sentinel's measured accuracy.
        */}
        {runStatus === AIRunStatus.Completed ? (
          <div className="mt-4">
            {fixTaskRunId ? (
              <Alert
                type={AlertType.SUCCESS}
                strongTitle="Fix task created"
                title={
                  <span>
                    Sentinel will open a pull request from this analysis.{" "}
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
                            View Sentinel tasks
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
                  onClick={() => {
                    createFixTask().catch(() => {
                      // handled inside createFixTask
                    });
                  }}
                />
              </>
            )}

            {/*
              A quiet human verdict on the analysis. The server returns
              `humanVerdict` on every investigation payload, so the state
              survives polling refreshes; the buttons update optimistically.
            */}
            <div className="mt-4">
              {verdictError ? (
                <div className="mb-3">
                  <Alert
                    type={AlertType.DANGER}
                    strongTitle="Could not save your verdict"
                    title={verdictError}
                  />
                </div>
              ) : (
                <></>
              )}
              {humanVerdict && !isChangingVerdict ? (
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                      humanVerdict === "Confirmed"
                        ? "bg-green-50 text-green-700"
                        : "bg-gray-100 text-gray-600"
                    }`}
                  >
                    <Icon
                      icon={
                        humanVerdict === "Confirmed"
                          ? IconProp.Check
                          : IconProp.Close
                      }
                      className="h-3 w-3"
                    />
                    <span>
                      You{" "}
                      {humanVerdict === "Confirmed" ? "confirmed" : "rejected"}{" "}
                      this analysis
                    </span>
                  </span>
                  <Link
                    className="cursor-pointer text-xs text-gray-400 underline"
                    onClick={() => {
                      setIsChangingVerdict(true);
                    }}
                  >
                    Change
                  </Link>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-gray-600">
                    Was this analysis correct?
                  </span>
                  <Button
                    title="Confirmed"
                    icon={IconProp.Check}
                    buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
                    buttonSize={ButtonSize.Small}
                    disabled={isSavingVerdict}
                    onClick={() => {
                      submitVerdict("Confirmed").catch(() => {
                        // handled inside submitVerdict
                      });
                    }}
                  />
                  <Button
                    title="Rejected"
                    icon={IconProp.Close}
                    buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                    buttonSize={ButtonSize.Small}
                    disabled={isSavingVerdict}
                    onClick={() => {
                      submitVerdict("Rejected").catch(() => {
                        // handled inside submitVerdict
                      });
                    }}
                  />
                </div>
              )}
              <p className="mt-1.5 text-xs text-gray-400">
                Verdicts train Sentinel&apos;s public accuracy score.
              </p>
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
