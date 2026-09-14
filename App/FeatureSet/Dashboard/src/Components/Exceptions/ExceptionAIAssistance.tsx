import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import {
  AIFixReadiness,
  AIFixReadinessCheck,
} from "Common/Types/AI/AIFixReadiness";
import CodeFixTaskType from "Common/Types/AI/CodeFixTaskType";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import {
  AIAgentTaskInfo,
  AIReadinessProgress,
  AITaskCardState,
  AITaskPresentation,
  AITaskTone,
  AI_TASK_PRESENTATION,
  EXCEPTION_AI_TASK_TYPES,
  ExceptionAITaskType,
  ReadinessCheckLink,
  findLatestAITask,
  getAIReadinessProgress,
  getAITaskCardState,
  getReadinessCheckLink,
  isAITaskActive,
  parseAIAgentTasksResponse,
  parseAIFixReadinessResponse,
} from "../../Utils/ExceptionAIAssistance";
import { formatRelativeTime } from "../../Utils/ExceptionDetailPresentation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

// How often an active task is re-read.
export const AI_TASK_POLL_INTERVAL_MS: number = 5000;

export const AI_TASK_TONE_CLASS_NAMES: Record<AITaskTone, string> = {
  neutral: "bg-gray-50 text-gray-600 ring-gray-500/20",
  info: "bg-sky-50 text-sky-700 ring-sky-600/20",
  success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/20",
  danger: "bg-red-50 text-red-700 ring-red-600/20",
};

export interface ComponentProps {
  telemetryExceptionId: ObjectID;
  isResolved: boolean;
  isArchived: boolean;
}

interface PendingStart {
  taskType: ExceptionAITaskType;
  label: string;
}

const ExceptionAIAssistance: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const exceptionId: string = props.telemetryExceptionId.toString();
  const [tasks, setTasks] = useState<Array<AIAgentTaskInfo>>([]);
  const [hasLoadedTasks, setHasLoadedTasks] = useState<boolean>(false);
  const [isTasksLoading, setIsTasksLoading] = useState<boolean>(true);
  const [readiness, setReadiness] = useState<AIFixReadiness | undefined>(
    undefined,
  );
  const [hasLoadedReadiness, setHasLoadedReadiness] = useState<boolean>(false);
  /*
   * Which task type a create request is in flight for (undefined = none).
   * Only one create runs at a time.
   */
  const [creatingTaskType, setCreatingTaskType] = useState<
    ExceptionAITaskType | undefined
  >(undefined);
  const [pendingStart, setPendingStart] = useState<PendingStart | undefined>(
    undefined,
  );
  /*
   * Errors from task actions render inline above the cards — a failed
   * button click must not blank the page.
   */
  const [taskError, setTaskError] = useState<string | undefined>(undefined);

  const fetchTasks: () => Promise<void> = useCallback(async (): Promise<void> => {
    try {
      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.get({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/telemetry-exception/get-ai-agent-task/${exceptionId}`,
          ),
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setTasks(parseAIAgentTasksResponse(response.data));
    } catch {
      // Quiet: without task data the cards simply offer to start a task.
      setTasks([]);
    }

    setHasLoadedTasks(true);
    setIsTasksLoading(false);
  }, [exceptionId]);

  const fetchReadiness: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.get({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/telemetry-exception/ai-fix-readiness/${exceptionId}`,
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setReadiness(parseAIFixReadinessResponse(response.data));
      } catch {
        /*
         * Fail open: without readiness data the start buttons stay enabled —
         * the server re-checks on create anyway.
         */
        setReadiness(undefined);
      }

      setHasLoadedReadiness(true);
    }, [exceptionId]);

  useEffect(() => {
    // Readiness only matters while the exception is unresolved.
    if (!props.isResolved) {
      void fetchReadiness();
    } else {
      setHasLoadedReadiness(true);
    }

    void fetchTasks();
  }, [exceptionId]);

  const hasActiveTask: boolean = tasks.some(isAITaskActive);

  // Terminal tasks never change again — only poll while one is active.
  useEffect(() => {
    if (!hasActiveTask) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      void fetchTasks();
    }, AI_TASK_POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [hasActiveTask, fetchTasks]);

  const navigateToTask: (taskId: string) => void = (taskId: string): void => {
    Navigation.navigate(
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
        { modelId: taskId },
      ),
    );
  };

  const createTask: (taskType: ExceptionAITaskType) => Promise<void> = async (
    taskType: ExceptionAITaskType,
  ): Promise<void> => {
    try {
      setCreatingTaskType(taskType);
      setTaskError(undefined);

      const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/telemetry-exception/create-ai-agent-task/${exceptionId}`,
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

      const taskId: string | undefined = response.data?.["aiAgentTaskId"] as
        | string
        | undefined;

      if (taskId) {
        setCreatingTaskType(undefined);
        navigateToTask(taskId);
        return;
      }

      await fetchTasks();
    } catch (err) {
      setTaskError(API.getFriendlyMessage(err));

      /*
       * The server re-checks prerequisites on create, so a failure here
       * often means the setup regressed — refresh the checklist to show
       * exactly what is missing. Never throws (fails open internally).
       */
      if (!props.isResolved) {
        await fetchReadiness();
      }
    }

    setCreatingTaskType(undefined);
  };

  const isPaused: boolean = props.isResolved || props.isArchived;
  const isBlockedBySetup: boolean = Boolean(readiness && !readiness.ready);
  const progress: AIReadinessProgress = getAIReadinessProgress(readiness);

  if (!hasLoadedTasks || !hasLoadedReadiness) {
    return (
      <Card
        title="AI Assistance"
        description="Checking AI setup and earlier tasks for this exception…"
      >
        <ComponentLoader />
      </Card>
    );
  }

  const renderReadiness: () => ReactElement = (): ReactElement => {
    if (!readiness || readiness.checks.length === 0 || props.isResolved) {
      return <></>;
    }

    if (readiness.ready) {
      return (
        <div
          className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 sm:flex-row sm:items-center"
          data-testid="exception-ai-ready"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-emerald-900">
            <Icon icon={IconProp.CheckCircle} className="h-5 w-5 text-emerald-600" />
            AI is ready to work on this exception
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-emerald-800 sm:ml-auto">
            {readiness.checks.map((check: AIFixReadinessCheck) => {
              return (
                <li key={check.id} className="flex items-center gap-1">
                  <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                  {check.title}
                </li>
              );
            })}
          </ul>
        </div>
      );
    }

    return (
      <Card
        title="Set up AI for this exception"
        description="AI can analyze this exception and open a pull request. Complete these prerequisites first."
        rightElement={
          <span
            className="whitespace-nowrap text-sm font-medium text-gray-700"
            data-testid="exception-ai-readiness-progress"
          >
            {progress.passed} of {progress.total} ready
          </span>
        }
      >
        <div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-gray-100"
            role="progressbar"
            aria-label="AI setup progress"
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.passed}
          >
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
          <ul
            className="mt-4 divide-y divide-gray-100"
            data-testid="exception-ai-readiness-checks"
          >
            {readiness.checks.map(
              (check: AIFixReadinessCheck): ReactElement => {
                const checkLink: ReadinessCheckLink | null = check.ok
                  ? null
                  : getReadinessCheckLink(check.id);

                return (
                  <li
                    className="flex items-start gap-3 py-3"
                    key={check.id}
                    data-testid={`exception-ai-readiness-${check.id}`}
                    data-ok={check.ok ? "true" : "false"}
                  >
                    <Icon
                      icon={check.ok ? IconProp.CheckCircle : IconProp.CircleClose}
                      className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                        check.ok ? "text-emerald-500" : "text-red-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {check.title}
                      </p>
                      {!check.ok && check.detail && (
                        <p className="mt-0.5 text-sm text-gray-600">
                          {check.detail}
                        </p>
                      )}
                    </div>
                    {checkLink && (
                      <Link
                        to={RouteUtil.populateRouteParams(
                          RouteMap[checkLink.pageMap] as Route,
                        )}
                        className="flex-shrink-0 whitespace-nowrap rounded-md bg-white px-2.5 py-1.5 text-xs font-medium text-indigo-600 ring-1 ring-inset ring-gray-200 hover:bg-gray-50"
                      >
                        {checkLink.title}
                      </Link>
                    )}
                  </li>
                );
              },
            )}
          </ul>
        </div>
      </Card>
    );
  };

  const renderTaskCard: (taskType: ExceptionAITaskType) => ReactElement = (
    taskType: ExceptionAITaskType,
  ): ReactElement => {
    const presentation: AITaskPresentation = AI_TASK_PRESENTATION[taskType];
    const task: AIAgentTaskInfo | undefined = findLatestAITask(tasks, taskType);
    const state: AITaskCardState = getAITaskCardState({
      task,
      presentation,
      isResolved: props.isResolved,
      isArchived: props.isArchived,
      isTasksLoading,
      isBlockedBySetup,
    });
    const startedAgo: string | null = task
      ? formatRelativeTime(task.createdAt)
      : null;

    return (
      <section
        key={taskType}
        className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm md:p-6"
        data-testid={`exception-ai-task-${taskType}`}
        aria-label={presentation.title}
      >
        <div className="flex flex-col gap-4 md:flex-row md:items-start">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <Icon icon={presentation.icon} className="h-5 w-5 text-indigo-600" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold text-gray-900">
                {presentation.title}
              </h3>
              <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${AI_TASK_TONE_CLASS_NAMES[state.tone]}`}
                data-testid="exception-ai-task-status"
              >
                {state.isActive && (
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-sky-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-sky-500" />
                  </span>
                )}
                {state.statusLabel}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-gray-600">
              {presentation.description}
            </p>

            {task && (
              <div
                className={`mt-3 max-w-3xl rounded-lg px-3 py-2 text-sm ${
                  state.tone === "danger"
                    ? "bg-red-50 text-red-800"
                    : "bg-gray-50 text-gray-700"
                }`}
                data-testid="exception-ai-task-message"
              >
                {state.message && <p>{state.message}</p>}
                {startedAgo && (
                  <p
                    className={`text-xs ${
                      state.tone === "danger" ? "text-red-600" : "text-gray-500"
                    } ${state.message ? "mt-1" : ""}`}
                  >
                    Latest task started {startedAgo}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex flex-shrink-0 flex-wrap items-center gap-2 md:justify-end">
            {state.canViewTask && task && (
              <Button
                title="View Task"
                icon={IconProp.ExternalLink}
                buttonStyle={ButtonStyleType.NORMAL}
                buttonSize={ButtonSize.Small}
                dataTestId="exception-ai-task-view"
                onClick={() => {
                  navigateToTask(task._id);
                }}
              />
            )}
            {state.primaryAction && (
              <Button
                title={state.primaryAction.label}
                icon={
                  state.primaryAction.kind === "retry"
                    ? IconProp.Refresh
                    : presentation.icon
                }
                buttonStyle={ButtonStyleType.PRIMARY}
                buttonSize={ButtonSize.Small}
                dataTestId="exception-ai-task-start"
                isLoading={creatingTaskType === taskType}
                disabled={
                  state.primaryAction.isDisabled ||
                  (Boolean(creatingTaskType) && creatingTaskType !== taskType)
                }
                tooltip={state.primaryAction.disabledReason}
                onClick={() => {
                  setPendingStart({
                    taskType,
                    label: state.primaryAction!.label,
                  });
                }}
              />
            )}
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="space-y-4" data-testid="exception-ai-assistance">
      {isPaused && (
        <Alert
          type={AlertType.INFO}
          strongTitle="AI assistance is paused"
          title="Mark this exception as unresolved and unarchive it before starting a new AI task."
        />
      )}

      {taskError && (
        <Alert
          type={AlertType.DANGER}
          strongTitle="Could not start AI task"
          title={taskError}
          onClose={() => {
            setTaskError(undefined);
          }}
        />
      )}

      {renderReadiness()}

      <div className="space-y-4">
        {EXCEPTION_AI_TASK_TYPES.map(renderTaskCard)}
      </div>

      {pendingStart && (
        <ConfirmModal
          title={`Confirm ${pendingStart.label}`}
          description={`${AI_TASK_PRESENTATION[pendingStart.taskType].description}\n\nAre you sure you want to ${pendingStart.label}?`}
          submitButtonText={pendingStart.label}
          onSubmit={() => {
            const taskType: ExceptionAITaskType = pendingStart.taskType;
            setPendingStart(undefined);
            void createTask(taskType);
          }}
          onClose={() => {
            setPendingStart(undefined);
          }}
        />
      )}
    </div>
  );
};

export default ExceptionAIAssistance;
