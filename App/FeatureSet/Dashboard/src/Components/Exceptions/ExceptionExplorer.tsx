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
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";

/*
 * The exception's latest AI fix attempt. Fix tasks are CodeFix AIRuns now,
 * so `status` carries AIRunStatus strings (Queued / Running /
 * WaitingForApproval / Completed / Error / Cancelled / Stale); the endpoint
 * keeps its legacy JSON keys.
 */
interface AIAgentTaskInfo {
  _id: string;
  status: AIRunStatus;
  statusMessage: string | undefined;
  statusTitle: string;
  statusDescription: string;
  createdAt: Date;
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
  const [isCreateAITaskLoading, setIsCreateAITaskLoading] =
    React.useState<boolean>(false);
  const [aiAgentTask, setAIAgentTask] = React.useState<
    AIAgentTaskInfo | undefined
  >(undefined);
  /*
   * The get-ai-agent-task endpoint returns the LATEST task of any status
   * (terminal tasks included, so failed fixes stay visible). This tracks the
   * server's hasActiveTask flag: true only for non-terminal tasks.
   */
  const [hasActiveAITask, setHasActiveAITask] = React.useState<boolean>(false);
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

        const hasActiveTask: boolean = Boolean(
          response.data?.["hasActiveTask"],
        );

        /*
         * The endpoint returns the LATEST task of ANY status — keep terminal
         * (Completed / Error) tasks in state so failed fixes stay visible
         * instead of silently vanishing behind the "Fix with AI Agent" button.
         */
        if (response.data?.["aiAgentTask"]) {
          const taskData: JSONObject = response.data[
            "aiAgentTask"
          ] as JSONObject;
          setAIAgentTask({
            _id: taskData["_id"] as string,
            status: taskData["status"] as AIRunStatus,
            statusMessage: taskData["statusMessage"] as string | undefined,
            statusTitle: taskData["statusTitle"] as string,
            statusDescription: taskData["statusDescription"] as string,
            createdAt: new Date(taskData["createdAt"] as string),
          });
          setHasActiveAITask(hasActiveTask);
        } else {
          setAIAgentTask(undefined);
          setHasActiveAITask(false);
        }
      } catch {
        // Silently fail - don't show error for AI task fetch
        setAIAgentTask(undefined);
        setHasActiveAITask(false);
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

  // Poll for AI agent task status updates every 5 seconds if there's an active task
  useEffect(() => {
    // Terminal tasks (Completed / Error) never change again — don't poll them.
    if (!aiAgentTask || !hasActiveAITask) {
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
  }, [aiAgentTask, hasActiveAITask]);

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

  type CreateAIAgentTaskFunction = () => Promise<void>;

  const createAIAgentTask: CreateAIAgentTaskFunction =
    async (): Promise<void> => {
      try {
        setIsCreateAITaskLoading(true);
        setAITaskError(undefined);

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/telemetry-exception/create-ai-agent-task/${props.telemetryExceptionId.toString()}`,
            ),
            data: {},
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

      setIsCreateAITaskLoading(false);
    };

  type GetAIAgentTaskAlertTypeFunction = () => AlertType;

  const getAIAgentTaskAlertType: GetAIAgentTaskAlertTypeFunction =
    (): AlertType => {
      if (!aiAgentTask) {
        return AlertType.INFO;
      }

      switch (aiAgentTask.status) {
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

  // The latest task has finished (terminal status) — or there is none.
  const isAITaskTerminal: boolean = Boolean(aiAgentTask) && !hasActiveAITask;

  /*
   * Stale runs (agent stopped reporting progress) are failed attempts too —
   * keep them visible with a retry, like Error.
   */
  const isLatestAITaskError: boolean =
    isAITaskTerminal &&
    (aiAgentTask?.status === AIRunStatus.Error ||
      aiAgentTask?.status === AIRunStatus.Stale);

  const isLatestAITaskCompleted: boolean =
    isAITaskTerminal && aiAgentTask?.status === AIRunStatus.Completed;

  /*
   * A new AI fix can be started when there is no task, or the latest task is
   * terminal (the server allows creating a new task after Completed / Error).
   */
  const canStartAIFix: boolean =
    !isResolved && !isAIAgentTaskLoading && (!aiAgentTask || isAITaskTerminal);

  const isAIFixBlockedBySetup: boolean = Boolean(
    aiFixReadiness && !aiFixReadiness.ready,
  );

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

      {/** AI Agent Task Status (a task is scheduled or in progress) */}

      {aiAgentTask && hasActiveAITask && !isResolved && (
        <Card
          title="AI Agent Task Status"
          description="An AI agent is working on fixing this exception."
        >
          <div className="space-y-3">
            <Alert
              type={getAIAgentTaskAlertType()}
              strongTitle={aiAgentTask.statusTitle}
              title={aiAgentTask.statusDescription}
            />
            {aiAgentTask.statusMessage && (
              <p className="text-sm text-gray-600">
                {aiAgentTask.statusMessage}
              </p>
            )}
            <div className="flex items-center space-x-4">
              <Button
                title="View Task Details"
                icon={IconProp.Bolt}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  navigateToAIAgentTask(aiAgentTask._id);
                }}
              />
            </div>
          </div>
        </Card>
      )}

      {/** Latest AI fix attempt failed — keep it visible and offer a retry. */}

      {aiAgentTask && isLatestAITaskError && !isResolved && (
        <Card
          title="AI fix attempt failed"
          description="The last AI Agent task for this exception did not complete."
        >
          <div className="space-y-3">
            <Alert
              type={AlertType.DANGER}
              strongTitle={aiAgentTask.statusTitle}
              title={aiAgentTask.statusMessage || aiAgentTask.statusDescription}
            />
            <div className="flex items-center space-x-4">
              <Button
                title="Retry Fix"
                icon={IconProp.Bolt}
                buttonStyle={ButtonStyleType.PRIMARY}
                isLoading={isCreateAITaskLoading}
                onClick={() => {
                  createAIAgentTask().catch(() => {
                    // Errors surface via aiTaskError.
                  });
                }}
              />
              <Button
                title="View Task Details"
                icon={IconProp.ExternalLink}
                buttonStyle={ButtonStyleType.OUTLINE}
                onClick={() => {
                  navigateToAIAgentTask(aiAgentTask._id);
                }}
              />
            </div>
          </div>
        </Card>
      )}

      {/** Latest AI fix completed — small note linking to the finished task. */}

      {aiAgentTask && isLatestAITaskCompleted && !isResolved && (
        <Alert
          type={AlertType.SUCCESS}
          strongTitle="Previous AI fix completed"
          title="An AI Agent has already completed a fix task for this exception. Click to view the completed task."
          onClick={() => {
            navigateToAIAgentTask(aiAgentTask._id);
          }}
        />
      )}

      {/** Inline error for AI task actions (create / retry) */}

      {aiTaskError && !isResolved && (
        <Alert
          type={AlertType.DANGER}
          strongTitle="Could not start AI fix"
          title={aiTaskError}
          onClose={() => {
            setAITaskError(undefined);
          }}
        />
      )}

      {/** Setup checklist — prerequisites are missing, so no Fix button yet. */}

      {canStartAIFix && isAIFixBlockedBySetup && aiFixReadiness && (
        <Card
          title="Set up AI fix for this exception"
          description="AI Agent can analyze this exception and submit a Pull Request with the fix — a few things need to be set up first."
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
                        <p className="text-sm text-gray-500">{check.detail}</p>
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

      {/** Fix with AI Agent Button (retry after an error lives in the failure card) */}

      {canStartAIFix && !isAIFixBlockedBySetup && !isLatestAITaskError && (
        <ActionCard
          title="Fix this exception with AI Agent"
          description="AI Agent will analyze this exception, identify the root cause, and submit a Pull Request with the fix to your code repository."
          actions={[
            {
              actionName: "Fix with AI Agent",
              actionIcon: IconProp.Bolt,
              actionButtonStyle: ButtonStyleType.PRIMARY,
              isLoading: isCreateAITaskLoading,
              onConfirmAction: async () => {
                await createAIAgentTask();
              },
            },
          ]}
        />
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
