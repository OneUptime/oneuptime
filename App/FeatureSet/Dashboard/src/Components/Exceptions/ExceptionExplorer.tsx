import React, { FunctionComponent, ReactElement, useEffect } from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import ExceptionDetail from "./ExceptionDetail";
import StackFrameViewer from "./StackFrameViewer";
import BreadcrumbTimeline, { BreadcrumbEvent } from "./BreadcrumbTimeline";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import Span, { SpanEvent } from "Common/Models/AnalyticsModels/Span";
import ObjectID from "Common/Types/ObjectID";
import Service from "Common/Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ProjectUtil from "Common/UI/Utils/Project";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import API from "Common/UI/Utils/API/API";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import ActionCard from "Common/UI/Components/ActionCard/ActionCard";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import User from "Common/UI/Utils/User";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import OccouranceTable from "./OccuranceTable";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";

/*
 * The exception's latest AI attempt per task type. AI tasks are CodeFix
 * AIRuns now, so `status` carries AIRunStatus strings (Queued / Running /
 * WaitingForApproval / Completed / Error / Cancelled / Stale); the endpoint
 * keeps its legacy JSON keys and adds `taskType` per task.
 */
interface AIAgentTaskInfo {
  _id: string;
  status: AIRunStatus;
  statusMessage: string | undefined;
  statusTitle: string;
  statusDescription: string;
  createdAt: Date;
  taskType: string;
}

// The task types this page can start (FixException is the legacy default).
type ExceptionAITaskType =
  | CodeFixTaskType.FixException
  | CodeFixTaskType.WriteRegressionTest;

// Wording for one task type's card group (active / failed / completed / start).
interface AITaskPresentation {
  taskType: ExceptionAITaskType;
  activeCardTitle: string;
  activeCardDescription: string;
  failedCardTitle: string;
  failedCardDescription: string;
  retryActionName: string;
  completedStrongTitle: string;
  completedTitle: string;
  startCardTitle: string;
  startCardDescription: string;
  startActionName: string;
  startActionIcon: IconProp;
}

const AI_TASK_PRESENTATION: {
  [key in ExceptionAITaskType]: AITaskPresentation;
} = {
  [CodeFixTaskType.FixException]: {
    taskType: CodeFixTaskType.FixException,
    activeCardTitle: "AI Fix Task Status",
    activeCardDescription: "AI is working on fixing this exception.",
    failedCardTitle: "AI fix attempt failed",
    failedCardDescription:
      "The last AI fix task for this exception did not complete.",
    retryActionName: "Retry Fix",
    completedStrongTitle: "Previous AI fix completed",
    completedTitle:
      "AI has already completed a fix task for this exception. Click to view the completed task.",
    startCardTitle: "Fix this exception with AI",
    startCardDescription:
      "AI will analyze this exception, identify the root cause, and submit a Pull Request with the fix to your code repository.",
    startActionName: "Fix with AI",
    startActionIcon: IconProp.Bolt,
  },
  [CodeFixTaskType.WriteRegressionTest]: {
    taskType: CodeFixTaskType.WriteRegressionTest,
    activeCardTitle: "Regression Test Task Status",
    activeCardDescription:
      "AI is writing a failing regression test that reproduces this exception.",
    failedCardTitle: "Regression test attempt failed",
    failedCardDescription:
      "The last regression test task for this exception did not complete.",
    retryActionName: "Retry Regression Test",
    completedStrongTitle: "Regression test completed",
    completedTitle:
      "AI has already completed a regression test task for this exception. Click to view the completed task.",
    startCardTitle: "Generate Regression Test",
    startCardDescription:
      "AI will write a failing test that reproduces this exception and open a Pull Request with it. This does not fix the bug — the test should fail until the bug is fixed.",
    startActionName: "Generate Regression Test",
    startActionIcon: IconProp.Beaker,
  },
};

// A task still making progress (not in a terminal status).
function isAITaskActive(task: AIAgentTaskInfo): boolean {
  return !AIRunStatusHelper.isTerminalStatus(task.status);
}

/*
 * Failed attempts (agent errored, or stopped reporting progress and went
 * Stale) stay visible with a retry.
 */
function isAITaskFailed(task: AIAgentTaskInfo): boolean {
  return (
    !isAITaskActive(task) &&
    (task.status === AIRunStatus.Error || task.status === AIRunStatus.Stale)
  );
}

function isAITaskCompleted(task: AIAgentTaskInfo): boolean {
  return !isAITaskActive(task) && task.status === AIRunStatus.Completed;
}

function getAIAgentTaskAlertType(task: AIAgentTaskInfo): AlertType {
  switch (task.status) {
    case AIRunStatus.Queued:
      return AlertType.INFO;
    case AIRunStatus.Running:
      return AlertType.INFO;
    case AIRunStatus.WaitingForApproval:
      return AlertType.INFO;
    case AIRunStatus.Completed:
      return AlertType.SUCCESS;
    case AIRunStatus.Error:
      return AlertType.DANGER;
    case AIRunStatus.Stale:
      return AlertType.DANGER;
    default:
      return AlertType.INFO;
  }
}

type AIFixReadinessCheckId =
  | "llmProvider"
  | "repositoryResolved"
  | "agentAvailable";

interface AIFixReadinessCheck {
  id: AIFixReadinessCheckId;
  ok: boolean;
  title: string;
  // Empty when ok — otherwise says exactly what to do next.
  detail: string;
}

interface AIFixReadinessInfo {
  ready: boolean;
  checks: Array<AIFixReadinessCheck>;
}

// A deep link that takes the user to the page where a failing check is fixed.
interface ReadinessCheckLink {
  title: string;
  route: Route;
}

export interface ComponentProps {
  telemetryExceptionId: ObjectID;
}

const ExceptionExplorer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [telemetryException, setTelemetryException] = React.useState<
    TelemetryException | undefined
  >(undefined);
  const [isLoading, setIsLoading] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [isArchiveLoading, setIsArchiveLoading] =
    React.useState<boolean>(false);
  const [isResolveUnresolveLoading, setIsResolveUnresolveLoading] =
    React.useState<boolean>(false);
  const [isArchived, setIsArchived] = React.useState<boolean>(false);
  const [isResolved, setIsResolved] = React.useState<boolean>(false);
  /*
   * Which task type a create request is in flight for (undefined = none).
   * Drives the per-button loading spinners — only one create runs at a time.
   */
  const [creatingTaskType, setCreatingTaskType] = React.useState<
    ExceptionAITaskType | undefined
  >(undefined);
  /*
   * The get-ai-agent-task endpoint returns the LATEST task per task type,
   * any status (terminal tasks included, so failed attempts stay visible).
   * Whether a task is still active is derived from its status.
   */
  const [aiAgentTasks, setAIAgentTasks] = React.useState<
    Array<AIAgentTaskInfo>
  >([]);
  const [isAIAgentTaskLoading, setIsAIAgentTaskLoading] =
    React.useState<boolean>(false);
  const [aiFixReadiness, setAIFixReadiness] = React.useState<
    AIFixReadinessInfo | undefined
  >(undefined);
  /*
   * Errors from AI-task actions render inline in the AI card area. The
   * page-level `error` state is reserved for page-load failures only —
   * a failed button click must not blank the whole page.
   */
  const [aiTaskError, setAITaskError] = React.useState<string | undefined>(
    undefined,
  );
  // Same idea for resolve/archive actions: inline alert, not a page takeover.
  const [actionError, setActionError] = React.useState<string | undefined>(
    undefined,
  );
  const [latestInstance, setLatestInstance] = React.useState<
    ExceptionInstance | undefined
  >(undefined);
  const [breadcrumbEvents, setBreadcrumbEvents] = React.useState<
    BreadcrumbEvent[]
  >([]);

  /*
   * An exception's primaryEntityId is polymorphic (no Service relation). Load the
   * project's Services so the detail view can resolve a real OpenTelemetry
   * service to its name/colour; other serviceTypes resolve to a label.
   */
  const [services, setServices] = React.useState<Array<Service>>([]);

  useEffect(() => {
    const loadServices: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: { data: Array<Service> } =
          await ModelAPI.getList<Service>({
            modelType: Service,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
            select: { _id: true, name: true, serviceColor: true },
            sort: { name: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });
        setServices(result.data);
      } catch {
        // Non-fatal: the detail view falls back to a primaryEntityType label.
      }
    };
    void loadServices();
  }, []);

  type RefeshExceptionItemFunction = () => Promise<TelemetryException>;

  const refreshExceptionItem: RefeshExceptionItemFunction = async () => {
    const updatedTelemetryException: TelemetryException | null =
      await ModelAPI.getItem<TelemetryException>({
        id: props.telemetryExceptionId,
        modelType: TelemetryException,
        select: {
          _id: true,
          exceptionType: true,
          message: true,
          stackTrace: true,
          fingerprint: true,
          firstSeenAt: true,
          lastSeenAt: true,
          occuranceCount: true,
          isArchived: true,
          isResolved: true,
          firstSeenInRelease: true,
          lastSeenInRelease: true,
          environment: true,
          markedAsArchivedAt: true,
          markedAsArchivedByUser: {
            _id: true,
            name: true,
            email: true,
            profilePictureId: true,
          },
          markedAsResolvedByUser: {
            _id: true,
            name: true,
            email: true,
            profilePictureId: true,
          },
          markedAsResolvedAt: true,
          primaryEntityId: true,
          primaryEntityType: true,
        },
      });

    if (!updatedTelemetryException) {
      throw new Error("Exception not found");
    }

    setTelemetryException(updatedTelemetryException);
    setIsArchived(updatedTelemetryException.isArchived || false);
    setIsResolved(updatedTelemetryException.isResolved || false);

    // Fetch the latest exception instance for parsed frames and additional data
    if (updatedTelemetryException.fingerprint) {
      try {
        const instanceResult: ListResult<ExceptionInstance> =
          await AnalyticsModelAPI.getList<ExceptionInstance>({
            modelType: ExceptionInstance,
            query: {
              fingerprint: updatedTelemetryException.fingerprint,
            },
            limit: 1,
            skip: 0,
            select: {
              parsedFrames: true,
              release: true,
              environment: true,
              traceId: true,
              spanId: true,
              time: true,
            },
            sort: {
              time: SortOrder.Descending,
            },
          });

        if (instanceResult.data.length > 0) {
          setLatestInstance(instanceResult.data[0]!);

          // Fetch span events for breadcrumb timeline
          const instance: ExceptionInstance = instanceResult.data[0]!;
          if (instance.traceId) {
            try {
              const spanResult: ListResult<Span> =
                await AnalyticsModelAPI.getList<Span>({
                  modelType: Span,
                  query: {
                    traceId: instance.traceId,
                  },
                  limit: 50,
                  skip: 0,
                  select: {
                    events: true,
                    name: true,
                    startTime: true,
                  },
                  sort: {
                    startTime: SortOrder.Descending,
                  },
                });

              // Extract span events as breadcrumbs
              const events: BreadcrumbEvent[] = [];
              for (const span of spanResult.data) {
                if (span.events && Array.isArray(span.events)) {
                  for (const event of span.events) {
                    const spanEvent: SpanEvent = event as SpanEvent;
                    events.push({
                      name: spanEvent.name || "",
                      time:
                        spanEvent.time instanceof Date
                          ? spanEvent.time
                          : new Date(
                              spanEvent.time || new Date().toISOString(),
                            ),
                      timeUnixNano: spanEvent.timeUnixNano || 0,
                      attributes: (spanEvent.attributes as JSONObject) || {},
                    });
                  }
                }
              }

              setBreadcrumbEvents(events);
            } catch {
              // Silently fail breadcrumb fetch
              setBreadcrumbEvents([]);
            }
          }
        }
      } catch {
        // Silently fail instance fetch - it's supplementary data
      }
    }

    return updatedTelemetryException;
  };

  type ParseAIAgentTaskFunction = (taskData: JSONObject) => AIAgentTaskInfo;

  const parseAIAgentTask: ParseAIAgentTaskFunction = (
    taskData: JSONObject,
  ): AIAgentTaskInfo => {
    return {
      _id: taskData["_id"] as string,
      status: taskData["status"] as AIRunStatus,
      statusMessage: taskData["statusMessage"] as string | undefined,
      statusTitle: taskData["statusTitle"] as string,
      statusDescription: taskData["statusDescription"] as string,
      createdAt: new Date(taskData["createdAt"] as string),
      // Older servers omit taskType — every task they know about is a fix.
      taskType:
        (taskData["taskType"] as string) || CodeFixTaskType.FixException,
    };
  };

  type FetchAIAgentTaskFunction = () => Promise<void>;

  const fetchAIAgentTask: FetchAIAgentTaskFunction =
    async (): Promise<void> => {
      try {
        setIsAIAgentTaskLoading(true);

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/telemetry-exception/get-ai-agent-task/${props.telemetryExceptionId.toString()}`,
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        /*
         * The endpoint returns the LATEST task per task type, of ANY status
         * — keep terminal (Completed / Error) tasks in state so failed
         * attempts stay visible instead of silently vanishing behind the
         * start buttons.
         */
        const tasksJson: JSONArray =
          (response.data?.["aiAgentTasks"] as JSONArray) || [];

        if (tasksJson.length > 0) {
          setAIAgentTasks(tasksJson.map(parseAIAgentTask));
        } else if (response.data?.["aiAgentTask"]) {
          /*
           * Older servers only send the single latest task (aiAgentTask) —
           * implicitly a fix task.
           */
          setAIAgentTasks([
            parseAIAgentTask(response.data["aiAgentTask"] as JSONObject),
          ]);
        } else {
          setAIAgentTasks([]);
        }
      } catch {
        // Silently fail - don't show error for AI task fetch
        setAIAgentTasks([]);
      }

      setIsAIAgentTaskLoading(false);
    };

  type FetchAIFixReadinessFunction = () => Promise<void>;

  const fetchAIFixReadiness: FetchAIFixReadinessFunction =
    async (): Promise<void> => {
      try {
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/telemetry-exception/ai-fix-readiness/${props.telemetryExceptionId.toString()}`,
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const checksJson: JSONArray =
          (response.data?.["checks"] as JSONArray) || [];

        setAIFixReadiness({
          ready: Boolean(response.data?.["ready"]),
          checks: checksJson.map((check: JSONObject): AIFixReadinessCheck => {
            return {
              id: check["id"] as AIFixReadinessCheckId,
              ok: Boolean(check["ok"]),
              title: (check["title"] as string) || "",
              detail: (check["detail"] as string) || "",
            };
          }),
        });
      } catch {
        /*
         * Fail open: without readiness data, fall back to the plain
         * "Fix with AI Agent" card — the server re-checks on create anyway.
         */
        setAIFixReadiness(undefined);
      }
    };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      const exceptionItem: TelemetryException = await refreshExceptionItem();

      // Readiness only matters while the exception is unresolved.
      if (!exceptionItem.isResolved) {
        await fetchAIFixReadiness();
      }

      await fetchAIAgentTask();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsLoading(false);
  };

  useEffect(() => {
    fetchItems().catch((err: Error) => {
      return setError(API.getFriendlyMessage(err));
    });
  }, []);

  const hasAnyActiveAITask: boolean = aiAgentTasks.some(isAITaskActive);

  // Poll for AI agent task status updates every 5 seconds while EITHER task is active
  useEffect(() => {
    // Terminal tasks (Completed / Error) never change again — don't poll them.
    if (!hasAnyActiveAITask) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchAIAgentTask().catch(() => {
        // Silently fail
      });
    }, 5000);

    return () => {
      clearInterval(interval);
    };
  }, [aiAgentTasks]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!telemetryException) {
    return <ErrorMessage message="Exception not found" />;
  }

  type MarkAsResolvedUnresolvedFunction = (
    isResolved: boolean,
  ) => Promise<void>;

  const markAsResolvedUnresolved: MarkAsResolvedUnresolvedFunction = async (
    isResolved: boolean,
  ): Promise<void> => {
    try {
      setIsResolveUnresolveLoading(true);
      setActionError(undefined);

      await ModelAPI.updateById<TelemetryException>({
        id: props.telemetryExceptionId,
        modelType: TelemetryException,
        data: {
          isResolved: isResolved,
          markedAsResolvedAt: isResolved
            ? OneUptimeDate.getCurrentDate()
            : null,
          markedAsResolvedByUserId: isResolved
            ? User.getUserId() || null
            : null,
        },
      });

      await refreshExceptionItem();

      // Unresolving brings the AI fix section back — refresh its readiness.
      if (!isResolved) {
        await fetchAIFixReadiness();
      }
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsResolveUnresolveLoading(false);
  };

  type ArchiveUnarchiveExceptionFunction = (
    isArchive: boolean,
  ) => Promise<void>;

  const archiveUnarchiveException: ArchiveUnarchiveExceptionFunction = async (
    isArchive: boolean,
  ): Promise<void> => {
    try {
      setIsArchiveLoading(true);
      setActionError(undefined);

      await ModelAPI.updateById<TelemetryException>({
        id: props.telemetryExceptionId,
        modelType: TelemetryException,
        data: {
          isArchived: isArchive,
          markedAsArchivedAt: isArchive ? OneUptimeDate.getCurrentDate() : null,
          markedAsArchivedByUserId: isArchive ? User.getUserId() || null : null,
        },
      });

      await refreshExceptionItem();
    } catch (err) {
      setActionError(API.getFriendlyMessage(err));
    }

    setIsArchiveLoading(false);
  };

  type NavigateToAIAgentTaskFunction = (aiAgentTaskId: string) => void;

  const navigateToAIAgentTask: NavigateToAIAgentTaskFunction = (
    aiAgentTaskId: string,
  ): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
        {
          modelId: aiAgentTaskId,
        },
      ),
    );
  };

  type CreateAIAgentTaskFunction = (
    taskType: ExceptionAITaskType,
  ) => Promise<void>;

  const createAIAgentTask: CreateAIAgentTaskFunction = async (
    taskType: ExceptionAITaskType,
  ): Promise<void> => {
    try {
      setCreatingTaskType(taskType);
      setAITaskError(undefined);

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/telemetry-exception/create-ai-agent-task/${props.telemetryExceptionId.toString()}`,
          ),
          /*
           * taskType is optional on the wire and FixException is the
           * server's default — send {} for fixes so older servers (which
           * predate the field) keep working unchanged.
           */
          data: taskType === CodeFixTaskType.FixException ? {} : { taskType },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      const aiAgentTaskId: string | undefined = response.data?.[
        "aiAgentTaskId"
      ] as string | undefined;

      if (aiAgentTaskId) {
        // Navigate to the AI Agent Task view page
        navigateToAIAgentTask(aiAgentTaskId);
      }
    } catch (err) {
      // Inline — a failed create must not replace the page with an error.
      setAITaskError(API.getFriendlyMessage(err));

      /*
       * The server re-checks prerequisites on create, so a failure here
       * often means the setup regressed — refresh the checklist to show
       * exactly what is missing. Never throws (fails open internally).
       */
      await fetchAIFixReadiness();
    }

    setCreatingTaskType(undefined);
  };

  type GetReadinessCheckLinkFunction = (
    checkId: AIFixReadinessCheckId,
  ) => ReadinessCheckLink | null;

  // Where the user fixes a failing readiness check.
  const getReadinessCheckLink: GetReadinessCheckLinkFunction = (
    checkId: AIFixReadinessCheckId,
  ): ReadinessCheckLink | null => {
    if (checkId === "llmProvider") {
      return {
        title: "Configure LLM Providers",
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_AI_LLM_PROVIDERS] as Route,
        ),
      };
    }

    if (checkId === "repositoryResolved") {
      return {
        title: "View Code Repositories",
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.CODE_REPOSITORY] as Route,
        ),
      };
    }

    if (checkId === "agentAvailable") {
      return {
        title: "View AI Agents",
        route: RouteUtil.populateRouteParams(
          RouteMap[PageMap.SETTINGS_AI_AGENTS] as Route,
        ),
      };
    }

    return null;
  };

  // The latest task per type (the endpoint returns at most one of each).
  const fixTask: AIAgentTaskInfo | undefined = aiAgentTasks.find(
    (task: AIAgentTaskInfo) => {
      return task.taskType === CodeFixTaskType.FixException;
    },
  );

  const regressionTestTask: AIAgentTaskInfo | undefined = aiAgentTasks.find(
    (task: AIAgentTaskInfo) => {
      return task.taskType === CodeFixTaskType.WriteRegressionTest;
    },
  );

  type CanStartAITaskFunction = (task: AIAgentTaskInfo | undefined) => boolean;

  /*
   * A new AI task of a type can be started when there is no task of that
   * type, or the latest one is terminal (the server allows creating a new
   * task after Completed / Error).
   */
  const canStartAITask: CanStartAITaskFunction = (
    task: AIAgentTaskInfo | undefined,
  ): boolean => {
    return (
      !isResolved && !isAIAgentTaskLoading && (!task || !isAITaskActive(task))
    );
  };

  const isAIFixBlockedBySetup: boolean = Boolean(
    aiFixReadiness && !aiFixReadiness.ready,
  );

  type RenderAITaskCardsFunction = (
    task: AIAgentTaskInfo | undefined,
    presentation: AITaskPresentation,
  ) => ReactElement;

  /*
   * One task type's card group: active status card, failure card with a
   * retry, or completed note — mirrors the original fix-only treatment for
   * both task types.
   */
  const renderAITaskCards: RenderAITaskCardsFunction = (
    task: AIAgentTaskInfo | undefined,
    presentation: AITaskPresentation,
  ): ReactElement => {
    if (!task || isResolved) {
      return <></>;
    }

    return (
      <>
        {/** A task of this type is scheduled or in progress */}

        {isAITaskActive(task) && (
          <Card
            title={presentation.activeCardTitle}
            description={presentation.activeCardDescription}
          >
            <div className="space-y-3">
              <Alert
                type={getAIAgentTaskAlertType(task)}
                strongTitle={task.statusTitle}
                title={task.statusDescription}
              />
              {task.statusMessage && (
                <p className="text-sm text-gray-600">{task.statusMessage}</p>
              )}
              <div className="flex items-center space-x-4">
                <Button
                  title="View Task Details"
                  icon={IconProp.Bolt}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  onClick={() => {
                    navigateToAIAgentTask(task._id);
                  }}
                />
              </div>
            </div>
          </Card>
        )}

        {/** Latest attempt failed — keep it visible and offer a retry. */}

        {isAITaskFailed(task) && (
          <Card
            title={presentation.failedCardTitle}
            description={presentation.failedCardDescription}
          >
            <div className="space-y-3">
              <Alert
                type={AlertType.DANGER}
                strongTitle={task.statusTitle}
                title={task.statusMessage || task.statusDescription}
              />
              <div className="flex items-center space-x-4">
                <Button
                  title={presentation.retryActionName}
                  icon={IconProp.Bolt}
                  buttonStyle={ButtonStyleType.PRIMARY}
                  isLoading={creatingTaskType === presentation.taskType}
                  onClick={() => {
                    createAIAgentTask(presentation.taskType).catch(() => {
                      // Errors surface via aiTaskError.
                    });
                  }}
                />
                <Button
                  title="View Task Details"
                  icon={IconProp.ExternalLink}
                  buttonStyle={ButtonStyleType.OUTLINE}
                  onClick={() => {
                    navigateToAIAgentTask(task._id);
                  }}
                />
              </div>
            </div>
          </Card>
        )}

        {/** Latest attempt completed — small note linking to the finished task. */}

        {isAITaskCompleted(task) && (
          <Alert
            type={AlertType.SUCCESS}
            strongTitle={presentation.completedStrongTitle}
            title={presentation.completedTitle}
            onClick={() => {
              navigateToAIAgentTask(task._id);
            }}
          />
        )}
      </>
    );
  };

  type RenderStartAITaskCardFunction = (
    task: AIAgentTaskInfo | undefined,
    presentation: AITaskPresentation,
  ) => ReactElement;

  /*
   * The "start a task" ActionCard for one task type — shown when a new task
   * can be started, setup is complete, and the latest attempt did not fail
   * (retry after an error lives in the failure card).
   */
  const renderStartAITaskCard: RenderStartAITaskCardFunction = (
    task: AIAgentTaskInfo | undefined,
    presentation: AITaskPresentation,
  ): ReactElement => {
    if (
      !canStartAITask(task) ||
      isAIFixBlockedBySetup ||
      (task && isAITaskFailed(task))
    ) {
      return <></>;
    }

    return (
      <ActionCard
        title={presentation.startCardTitle}
        description={presentation.startCardDescription}
        actions={[
          {
            actionName: presentation.startActionName,
            actionIcon: presentation.startActionIcon,
            actionButtonStyle: ButtonStyleType.PRIMARY,
            isLoading: creatingTaskType === presentation.taskType,
            onConfirmAction: async () => {
              await createAIAgentTask(presentation.taskType);
            },
          },
        ]}
      />
    );
  };

  return (
    <div className="space-y-4 mb-10">
      {/** Inline error for resolve / archive actions (page error is load-only) */}

      {actionError && (
        <Alert
          type={AlertType.DANGER}
          strongTitle="Action failed"
          title={actionError}
          onClose={() => {
            setActionError(undefined);
          }}
        />
      )}

      {/** Per-task-type card groups (active / failed / completed) */}

      {renderAITaskCards(
        fixTask,
        AI_TASK_PRESENTATION[CodeFixTaskType.FixException],
      )}
      {renderAITaskCards(
        regressionTestTask,
        AI_TASK_PRESENTATION[CodeFixTaskType.WriteRegressionTest],
      )}

      {/** Inline error for AI task actions (create / retry) */}

      {aiTaskError && !isResolved && (
        <Alert
          type={AlertType.DANGER}
          strongTitle="Could not start AI task"
          title={aiTaskError}
          onClose={() => {
            setAITaskError(undefined);
          }}
        />
      )}

      {/** Setup checklist — prerequisites are missing, so no start buttons yet. Both task types share the gate. */}

      {(canStartAITask(fixTask) || canStartAITask(regressionTestTask)) &&
        isAIFixBlockedBySetup &&
        aiFixReadiness && (
          <Card
            title="Set up AI for this exception"
            description="AI can analyze this exception and submit a Pull Request — a fix or a failing regression test. A few things need to be set up first."
          >
            <div className="mt-4 space-y-3">
              {aiFixReadiness.checks.map(
                (check: AIFixReadinessCheck): ReactElement => {
                  const checkLink: ReadinessCheckLink | null = check.ok
                    ? null
                    : getReadinessCheckLink(check.id);

                  return (
                    <div className="flex items-start" key={check.id}>
                      <Icon
                        icon={
                          check.ok ? IconProp.CheckCircle : IconProp.CircleClose
                        }
                        className={`h-5 w-5 ${
                          check.ok ? "text-green-500" : "text-red-500"
                        } mr-3 mt-0.5 flex-shrink-0`}
                      />
                      <div>
                        <span className="font-medium">{check.title}</span>
                        {!check.ok && check.detail && (
                          <p className="text-sm text-gray-500">
                            {check.detail}
                          </p>
                        )}
                        {checkLink && (
                          <Link
                            to={checkLink.route}
                            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
                          >
                            {checkLink.title}
                          </Link>
                        )}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </Card>
        )}

      {/** Start buttons per task type (retry after an error lives in the failure card) */}

      {renderStartAITaskCard(
        fixTask,
        AI_TASK_PRESENTATION[CodeFixTaskType.FixException],
      )}
      {renderStartAITaskCard(
        regressionTestTask,
        AI_TASK_PRESENTATION[CodeFixTaskType.WriteRegressionTest],
      )}

      {/** Resolve / Unresolve Button */}

      {!isResolved && (
        <ActionCard
          title="Mark as Resolved"
          description="If you have fixed this exception, mark this exception as resolved."
          actions={[
            {
              actionName: "Mark as Resolved",
              actionIcon: IconProp.Check,
              actionButtonStyle: ButtonStyleType.SUCCESS_OUTLINE,
              isLoading: isResolveUnresolveLoading,
              onConfirmAction: async () => {
                // Mark the exception as unresolved
                await markAsResolvedUnresolved(true);
              },
            },
          ]}
        />
      )}

      {isArchived ? (
        <Alert
          type={AlertType.WARNING}
          strongTitle="Archived"
          title="This exception has been archived."
        />
      ) : (
        <></>
      )}

      {isResolved ? (
        <Alert
          type={AlertType.SUCCESS}
          strongTitle="RESOLVED"
          title="This exception has been resolved."
        />
      ) : (
        <></>
      )}

      {/** Exception Details */}

      <ExceptionDetail {...telemetryException} services={services} />

      {/** Parsed Stack Frame Viewer */}
      {telemetryException.stackTrace && (
        <StackFrameViewer
          stackTrace={telemetryException.stackTrace}
          {...(latestInstance?.parsedFrames
            ? { parsedFrames: latestInstance.parsedFrames }
            : {})}
        />
      )}

      {/** Breadcrumb Timeline */}
      {breadcrumbEvents.length > 0 && (
        <BreadcrumbTimeline
          events={breadcrumbEvents}
          {...(latestInstance?.time
            ? { exceptionTime: new Date(latestInstance.time) }
            : telemetryException.lastSeenAt
              ? { exceptionTime: new Date(telemetryException.lastSeenAt) }
              : {})}
        />
      )}

      {/** Assign / Unassign Button */}

      {/** Occurance Table */}

      {telemetryException.fingerprint && (
        <OccouranceTable
          exceptionFingerprint={telemetryException.fingerprint}
        />
      )}

      {/** Archive / Unarchive Button Button */}

      {isResolved && (
        <ActionCard
          title="Mark as Unresolved"
          description="If this exception is still occuring, mark this exception as unresolved."
          actions={[
            {
              actionName: "Unresolve",
              actionIcon: IconProp.Close,
              actionButtonStyle: ButtonStyleType.NORMAL,
              isLoading: isResolveUnresolveLoading,
              onConfirmAction: async () => {
                // Mark the exception as unresolved
                await markAsResolvedUnresolved(false);
              },
            },
          ]}
        />
      )}

      {!isArchived && (
        <ActionCard
          title="Archive"
          description="Archive this exception. You will not be notified when this exception occours."
          actions={[
            {
              actionName: "Archive",
              actionIcon: IconProp.Archive,
              actionButtonStyle: ButtonStyleType.NORMAL,
              isLoading: isArchiveLoading,
              onConfirmAction: async () => {
                // Mark the exception as unresolved
                await archiveUnarchiveException(true);
              },
            },
          ]}
        />
      )}

      {isArchived && (
        <ActionCard
          title="Unarchive"
          description="Unarchive this exception. You will be notified when this exception occours."
          actions={[
            {
              actionName: "Unarchive",
              actionIcon: IconProp.Unarchive,
              actionButtonStyle: ButtonStyleType.NORMAL,
              isLoading: isArchiveLoading,
              onConfirmAction: async () => {
                // Mark the exception as unresolved
                await archiveUnarchiveException(false);
              },
            },
          ]}
        />
      )}

      <ModelDelete
        modelType={TelemetryException}
        modelId={props.telemetryExceptionId}
        onDeleteSuccess={() => {
          Navigation.navigate(
            RouteUtil.populateRouteParams(
              RouteMap[PageMap.EXCEPTIONS] as Route,
            ),
          );
        }}
      />
    </div>
  );
};

export default ExceptionExplorer;
