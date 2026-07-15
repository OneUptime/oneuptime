import PageComponentProps from "../../PageComponentProps";
import React, {
  Fragment,
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
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import FieldType from "Common/UI/Components/Types/FieldType";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import ChatActivityFeed from "../../../Components/AIChat/ChatActivityFeed";
import CodeFixRunStatusPill, {
  CodeFixRunStatusText,
  getCodeFixRunStatusText,
  getCodeFixTaskTypeLabel,
} from "../../../Components/AIAgentTask/CodeFixRunStatus";
import CodeFixRunDuration from "../../../Components/AIAgentTask/CodeFixRunDuration";

const POLL_INTERVAL_MS: number = 5000;
// The server caps the event trail at 500 — show all of it.
const MAX_VISIBLE_STEPS: number = 500;

/*
 * The run flattened for the Detail component. `taskType` is the task-type
 * discriminator on the /code-fix-run/get response (never null — the server
 * normalizes legacy rows to "FixException"), so it is read from the raw JSON
 * rather than the AIRun model.
 */
interface TaskDetail {
  taskType: string;
  status: AIRunStatus | undefined;
  createdAt: Date | undefined;
  startedAt: Date | undefined;
  completedAt: Date | undefined;
  totalTokens: number | undefined;
  llmCallCount: number | undefined;
  toolCallCount: number | undefined;
  attemptCount: number | undefined;
  triggeredByTelemetryExceptionId: ObjectID | undefined;
  errorMessage: string;
}

type ToTaskDetailFunction = (runJson: JSONObject) => TaskDetail;

const toTaskDetail: ToTaskDetailFunction = (
  runJson: JSONObject,
): TaskDetail => {
  const run: AIRun = AIRun.fromJSONObject(runJson, AIRun);

  return {
    taskType: (runJson["codeFixTaskType"] as string) || "FixException",
    status: run.status,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    totalTokens: run.totalTokens,
    llmCallCount: run.llmCallCount,
    toolCallCount: run.toolCallCount,
    attemptCount: run.attemptCount,
    triggeredByTelemetryExceptionId: run.triggeredByTelemetryExceptionId,
    errorMessage: run.errorMessage || "",
  };
};

/*
 * The AI fix task detail: the CodeFix AIRun's status plus its glass-box
 * event trail (the same ChatActivityFeed rendering AI investigations use).
 * Data comes from the dedicated /code-fix-run/get endpoint because
 * project-scoped code-fix runs are hidden from the generic AIRun CRUD by its
 * per-user privacy pin.
 */
const AIAgentTaskViewPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();

  const [detail, setDetail] = useState<TaskDetail | undefined>(undefined);
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
            setDetail(toTaskDetail(runJson));
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
    detail?.status && !AIRunStatusHelper.isTerminalStatus(detail.status),
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

  if (!hasLoadedOnce) {
    return <PageLoader isVisible={true} />;
  }

  if (error && !detail) {
    return <ErrorMessage message={error} />;
  }

  if (!detail) {
    return <ErrorMessage message="Task not found" />;
  }

  const statusText: CodeFixRunStatusText = getCodeFixRunStatusText(
    detail.status,
  );

  const fields: Array<Field<TaskDetail>> = [
    {
      key: "taskType",
      title: "Task",
      getElement: (item: TaskDetail): ReactElement => {
        return <>{getCodeFixTaskTypeLabel(item.taskType)}</>;
      },
    },
    {
      key: "status",
      title: "Status",
      getElement: (item: TaskDetail): ReactElement => {
        return (
          <div className="flex items-center gap-3">
            <CodeFixRunStatusPill status={item.status} />
            {isActive ? (
              <span className="inline-block h-2 w-2 animate-ping rounded-full bg-indigo-500" />
            ) : (
              <></>
            )}
          </div>
        );
      },
    },
    {
      key: "completedAt",
      title: "Duration",
      getElement: (item: TaskDetail): ReactElement => {
        return (
          <CodeFixRunDuration
            status={item.status}
            startedAt={item.startedAt}
            completedAt={item.completedAt}
          />
        );
      },
    },
    {
      key: "createdAt",
      title: "Created At",
      fieldType: FieldType.DateTime,
      placeholder: "-",
    },
    {
      key: "startedAt",
      title: "Started At",
      fieldType: FieldType.DateTime,
      placeholder: "-",
    },
    {
      key: "triggeredByTelemetryExceptionId",
      title: "Triggered By",
      showIf: (item: TaskDetail): boolean => {
        return Boolean(item.triggeredByTelemetryExceptionId);
      },
      getElement: (item: TaskDetail): ReactElement => {
        return (
          <Link
            to={RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS_VIEW] as Route,
              { modelId: item.triggeredByTelemetryExceptionId! },
            )}
            className="text-indigo-600 hover:underline"
          >
            <>View exception</>
          </Link>
        );
      },
    },
    {
      key: "llmCallCount",
      title: "LLM Calls",
      fieldType: FieldType.Number,
      placeholder: "-",
    },
    {
      key: "toolCallCount",
      title: "Tool Calls",
      fieldType: FieldType.Number,
      placeholder: "-",
    },
    {
      key: "totalTokens",
      title: "Tokens Used",
      fieldType: FieldType.Number,
      placeholder: "-",
    },
    {
      key: "attemptCount",
      title: "Attempts",
      fieldType: FieldType.Number,
      placeholder: "-",
      // A retried run is worth surfacing; a first-try run is just noise.
      showIf: (item: TaskDetail): boolean => {
        return Boolean(item.attemptCount && item.attemptCount > 1);
      },
    },
  ];

  return (
    <Fragment>
      <div className="space-y-5">
        {detail.errorMessage ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle="This task failed"
            title={detail.errorMessage}
          />
        ) : (
          <></>
        )}

        <Card
          title="Task Status"
          description={
            statusText.description || "Current state of this AI task."
          }
        >
          <Detail<TaskDetail>
            id="ai-agent-task-detail"
            item={detail}
            fields={fields}
            showDetailsInNumberOfColumns={3}
          />
        </Card>

        <Card
          title="AI Activity"
          description="What AI did, step by step — the run's glass-box event trail."
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
                ? "Waiting for AI to report its first step…"
                : "No activity was recorded for this task."}
            </p>
          )}
        </Card>
      </div>
    </Fragment>
  );
};

export default AIAgentTaskViewPage;
