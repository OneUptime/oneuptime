import PageComponentProps from "../../PageComponentProps";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ChatActivityFeed from "../../../Components/AIChat/ChatActivityFeed";
import CodeFixRunStatusPill, {
  CodeFixRunStatusText,
  getCodeFixRunStatusText,
} from "../../../Components/AIAgentTask/CodeFixRunStatus";

const POLL_INTERVAL_MS: number = 5000;
// The server caps the event trail at 500 — show all of it.
const MAX_VISIBLE_STEPS: number = 500;

/*
 * The AI fix task detail: the CodeFix AIRun's status plus its glass-box
 * event trail (the same ChatActivityFeed rendering Sentinel investigations
 * use). Data comes from the dedicated /code-fix-run/get endpoint because
 * system-authored runs are hidden from the generic AIRun CRUD.
 */
const AIAgentTaskViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();

  const [run, setRun] = useState<AIRun | undefined>(undefined);
  const [events, setEvents] = useState<Array<AIRunEvent>>([]);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const signatureRef: React.MutableRefObject<string> = useRef<string>("");

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/code-fix-run/get/${id || ""}`,
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const data: JSONObject = response.data as JSONObject;
        const runJson: JSONObject | null =
          (data["run"] as JSONObject | null) || null;
        const eventsJson: JSONArray = (data["events"] as JSONArray) || [];

        if (runJson) {
          const status: string =
            (runJson["status"] as string | undefined) || "none";

          // Skip re-render when nothing changed (status + event count).
          const signature: string = `${status}:${eventsJson.length}`;
          if (signature !== signatureRef.current) {
            signatureRef.current = signature;
            setRun(AIRun.fromJSONObject(runJson, AIRun));
            setEvents(
              AIRunEvent.fromJSONArray(
                eventsJson as Array<JSONObject>,
                AIRunEvent,
              ),
            );
          }
          setError(undefined);
        }

        setHasLoadedOnce(true);
      } catch (err) {
        // Keep already-loaded data on transient poll failures.
        if (!signatureRef.current) {
          setError(API.getFriendlyMessage(err));
        }
        setHasLoadedOnce(true);
      }
    }, [id]);

  useEffect(() => {
    fetchData().catch(() => {
      // handled inside fetchData
    });
  }, [fetchData]);

  // Poll while the run can still make progress.
  const isActive: boolean = Boolean(
    run?.status && !AIRunStatusHelper.isTerminalStatus(run.status),
  );

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

  type FormatDateFunction = (date: Date | undefined) => string;

  const formatDate: FormatDateFunction = (date: Date | undefined): string => {
    if (!date) {
      return "-";
    }

    return OneUptimeDate.getDateAsLocalFormattedString(date);
  };

  if (!hasLoadedOnce) {
    return <PageLoader isVisible={true} />;
  }

  if (error && !run) {
    return <ErrorMessage message={error} />;
  }

  if (!run) {
    return <ErrorMessage message="Task not found" />;
  }

  const statusText: CodeFixRunStatusText = getCodeFixRunStatusText(run.status);

  return (
    <div className="space-y-4">
      <Card
        title="Task Status"
        description="Current state of this AI fix task."
      >
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <CodeFixRunStatusPill status={run.status} />
            {isActive ? (
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-indigo-500" />
            ) : (
              <></>
            )}
          </div>

          {statusText.description ? (
            <p className="text-sm text-gray-600">{statusText.description}</p>
          ) : (
            <></>
          )}

          {run.errorMessage ? (
            <Alert
              type={AlertType.DANGER}
              strongTitle="Error"
              title={run.errorMessage}
            />
          ) : (
            <></>
          )}

          <div className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="text-xs text-gray-500">Created At</div>
              <div className="text-sm text-gray-900">
                {formatDate(run.createdAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Started At</div>
              <div className="text-sm text-gray-900">
                {formatDate(run.startedAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Completed At</div>
              <div className="text-sm text-gray-900">
                {formatDate(run.completedAt)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500">Tokens Used</div>
              <div className="text-sm text-gray-900">
                {run.totalTokens ? run.totalTokens.toLocaleString() : "-"}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card
        title="Agent Activity"
        description="What the agent did, step by step — the run's glass-box event trail."
      >
        {events.length > 0 ? (
          <ChatActivityFeed
            events={events}
            title={isActive ? "Working…" : "Activity"}
            showLiveIndicator={isActive}
            maxVisibleSteps={MAX_VISIBLE_STEPS}
          />
        ) : (
          <p className="text-sm text-gray-500">
            {isActive
              ? "Waiting for the agent to report its first step…"
              : "No activity was recorded for this task."}
          </p>
        )}
      </Card>
    </div>
  );
};

export default AIAgentTaskViewPage;
