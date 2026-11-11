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
import FoldedSection from "Common/UI/Components/FoldedSection/FoldedSection";
import { FoldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  AI_TASKS_NOT_ALLOWED_SENTENCE,
  AIAgentTaskInfo,
  AIReadinessProgress,
  AITaskCardState,
  AITaskPresentation,
  AI_TASK_PRESENTATION,
  AI_TASK_TONE_CLASS_NAMES,
  EXCEPTION_AI_HOW_IT_WORKS_STEPS,
  ExceptionAITaskType,
  PRIMARY_AI_TASK_PRESENTATION,
  PrimaryExceptionAITaskType,
  ReadinessCheckLink,
  findLatestAITask,
  getAIReadinessProgress,
  getAITaskCardState,
  getOtherExceptionAITaskTypes,
  getPrimaryExceptionAITaskType,
  getReadinessCheckLink,
  isAITaskActive,
  parseAIAgentTasksResponse,
  parseAIFixReadinessResponse,
} from "../../Utils/ExceptionAIAssistance";
import { exceptionTimeValue } from "../../Utils/ExceptionDetailPresentation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import CodeBlockerNotice from "../Code/CodeBlockerNotice";
import FixProductionVerdict from "../AI/FixProductionVerdict";
import { CodeTaskBlockerType } from "Common/Types/AI/CodeTask";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  ComposedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * FIX WITH AI, ON AN EXCEPTION.
 *
 * One task, not a menu of them: "Fix with AI" opens a pull request with the
 * fix OneUptime AI's triage calls for - a fix of the code, or, for an
 * exception it found to be an expected error (bad input, an intentional
 * denial), better handling of it - with what it will do and how it works
 * said right there. The page used to offer three cards side by side - fix
 * it, write a regression test, improve the error handling - and left the
 * reader to work out which one they wanted: "Why not just one?" (#6855).
 *
 * The other two stay a click away, folded under it as Other AI tasks: the
 * other kind of fix, for when the reader knows better than the triage, and
 * a regression test. The fold opens by itself once one of them has a task,
 * so nothing that ran is hidden.
 *
 * What is missing before AI can work - an LLM provider, a repository, a
 * Runner - is a checklist above the task, each item with the page that
 * fixes it; once all is set, one quiet line under How it works says so.
 */

// How often an active task is re-read.
export const AI_TASK_POLL_INTERVAL_MS: number = 5000;

// Kept here too, where it was first exported.
export { AI_TASK_TONE_CLASS_NAMES };

export const OTHER_AI_TASKS_TITLE: string = translationKey("Other AI tasks");

export interface ComponentProps {
  telemetryExceptionId: ObjectID;
  isResolved: boolean;
  isArchived: boolean;
  /*
   * OneUptime AI triage's verdict on the exception (errorClass): an expected
   * error is fixed by handling it better, anything else by fixing the code.
   */
  errorClass?: string | undefined;
}

interface PendingStart {
  taskType: ExceptionAITaskType;
  presentation: AITaskPresentation;
  label: string;
}

const ExceptionAIAssistance: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const exceptionId: string = props.telemetryExceptionId.toString();
  const primaryTaskType: PrimaryExceptionAITaskType =
    getPrimaryExceptionAITaskType(props.errorClass);
  const otherTaskTypes: Array<ExceptionAITaskType> =
    getOtherExceptionAITaskTypes(primaryTaskType);
  /*
   * A task works in the exception's repository, so starting one takes
   * permission to edit repositories - what the server asks. A person who
   * may only read sees the tasks and why they cannot start one.
   */
  const startGate: PermissionGateResult = useMemo((): PermissionGateResult => {
    return PermissionGate.checkPermissions(
      PermissionGate.getModelPermissions(
        new CodeRepository(),
        ModelAction.Update,
      ),
      { sentence: AI_TASKS_NOT_ALLOWED_SENTENCE },
    );
  }, []);
  const startRefusedReason: string | undefined = startGate.isAllowed
    ? undefined
    : startGate.disabledReason ||
      translator.translateText(AI_TASKS_NOT_ALLOWED_SENTENCE);
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
   * Errors from task actions render inline above the task — a failed
   * button click must not blank the page.
   */
  const [taskError, setTaskError] = useState<string | undefined>(undefined);

  const fetchTasks: () => Promise<void> =
    useCallback(async (): Promise<void> => {
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
        // Quiet: without task data the page simply offers to start a task.
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
    void fetchTasks();
  }, [exceptionId]);

  /*
   * Readiness only matters while the exception is unresolved. It is keyed on
   * isResolved too: the header can reopen the exception while this page is
   * open, and the checklist has to appear then, not on the next visit.
   */
  useEffect(() => {
    if (props.isResolved) {
      setHasLoadedReadiness(true);
      return;
    }

    void fetchReadiness();
  }, [exceptionId, props.isResolved]);

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
      RouteUtil.populateRouteParams(RouteMap[PageMap.CODE_TASK_VIEW] as Route, {
        modelId: taskId,
      }),
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

  /*
   * AI switched off for the project: nothing here can be started (the menu
   * does not offer this page then), so a link that still leads here says
   * so in Code's own words - the tasks this page starts are Code's - with
   * the one step that changes it: Turn AI on, for whoever may change Enable
   * AI, and who can for everyone else. Nothing else.
   */
  if (!isAiOffered) {
    return (
      <div className="space-y-4" data-testid="exception-ai-assistance">
        <div data-testid="exception-ai-off">
          <CodeBlockerNotice
            blocker={{
              type: CodeTaskBlockerType.AiDisabled,
              message: "AI is turned off for this project.",
            }}
          />
        </div>
      </div>
    );
  }

  if (!hasLoadedTasks || !hasLoadedReadiness) {
    return (
      <Card
        title="Fix with AI"
        description="Checking AI setup and earlier tasks for this exception…"
      >
        <ComponentLoader />
      </Card>
    );
  }

  /*
   * What is missing before AI can work, while something is: a checklist
   * above the task, each missing item with the page that sets it up.
   */
  const renderSetupChecklist: () => ReactElement = (): ReactElement => {
    if (
      !readiness ||
      readiness.ready ||
      readiness.checks.length === 0 ||
      props.isResolved
    ) {
      return <></>;
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
            {translator.translateTemplate("{{passed}} of {{total}} ready", {
              passed: progress.passed,
              total: progress.total,
            })}
          </span>
        }
      >
        <div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-gray-100"
            role="progressbar"
            aria-label={translator.translateText("AI setup progress")}
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
                      icon={
                        check.ok ? IconProp.CheckCircle : IconProp.CircleClose
                      }
                      className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                        check.ok ? "text-emerald-500" : "text-red-500"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">
                        {translator.translateText(check.title)}
                      </p>
                      {!check.ok && check.detail && (
                        <p className="mt-0.5 text-sm text-gray-600">
                          {translator.translateText(check.detail)}
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
                        {translator.translateText(checkLink.title)}
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

  // Everything set up: one quiet line, under How it works.
  const renderReadyLine: () => ReactElement = (): ReactElement => {
    if (
      !readiness ||
      !readiness.ready ||
      readiness.checks.length === 0 ||
      props.isResolved
    ) {
      return <></>;
    }

    return (
      <div
        className="mt-4 flex flex-col gap-2 border-t border-gray-200 pt-4 text-sm sm:flex-row sm:items-center"
        data-testid="exception-ai-ready"
      >
        <div className="flex items-center gap-2 font-medium text-emerald-700">
          <Icon
            icon={IconProp.CheckCircle}
            className="h-5 w-5 flex-shrink-0 text-emerald-600"
          />
          {translator.translateText("AI is ready to work on this exception")}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600 sm:ms-auto">
          {readiness.checks.map((check: AIFixReadinessCheck) => {
            return (
              <li key={check.id} className="flex items-center gap-1">
                <Icon
                  icon={IconProp.Check}
                  className="h-3.5 w-3.5 text-emerald-600"
                />
                {translator.translateText(check.title)}
              </li>
            );
          })}
        </ul>
      </div>
    );
  };

  // What a task is doing or did: its status, its words, what production showed.
  const getTaskState: (
    taskType: ExceptionAITaskType,
    presentation: AITaskPresentation,
  ) => { task: AIAgentTaskInfo | undefined; state: AITaskCardState } = (
    taskType: ExceptionAITaskType,
    presentation: AITaskPresentation,
  ): { task: AIAgentTaskInfo | undefined; state: AITaskCardState } => {
    const task: AIAgentTaskInfo | undefined = findLatestAITask(tasks, taskType);

    return {
      task,
      state: getAITaskCardState({
        task,
        presentation,
        isResolved: props.isResolved,
        isArchived: props.isArchived,
        isTasksLoading,
        isBlockedBySetup,
        startRefusedReason,
      }),
    };
  };

  const renderStatusPill: (state: AITaskCardState) => ReactElement = (
    state: AITaskCardState,
  ): ReactElement => {
    return (
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
        {translator.translateText(state.statusLabel)}
      </span>
    );
  };

  const renderTaskProgress: (
    task: AIAgentTaskInfo | undefined,
    state: AITaskCardState,
  ) => ReactElement = (
    task: AIAgentTaskInfo | undefined,
    state: AITaskCardState,
  ): ReactElement => {
    if (!task) {
      return <></>;
    }

    // In the sentence's own language (exceptionTimeValue).
    const startedAgo: ComposedValue | undefined = exceptionTimeValue(
      task.createdAt,
    );

    return (
      <>
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
              {translator.translateTemplate("Latest task started {{time}}", {
                time: startedAgo,
              })}
            </p>
          )}
        </div>
        {/*
          Merged is not fixed: what production showed once the fix
          shipped (FixProductionVerifier).
        */}
        {task.production && (
          <FixProductionVerdict
            production={task.production}
            testId="exception-ai-task-production"
            className="mt-3"
          />
        )}
      </>
    );
  };

  // View task and the task's one move: start, again, or try again.
  const renderTaskButtons: (data: {
    taskType: ExceptionAITaskType;
    presentation: AITaskPresentation;
    task: AIAgentTaskInfo | undefined;
    state: AITaskCardState;
    isPrimary: boolean;
  }) => ReactElement = (data: {
    taskType: ExceptionAITaskType;
    presentation: AITaskPresentation;
    task: AIAgentTaskInfo | undefined;
    state: AITaskCardState;
    isPrimary: boolean;
  }): ReactElement => {
    const { taskType, presentation, task, state } = data;

    return (
      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2 [&>*>button]:ml-0 [&>*>button]:md:ml-0 [&>button]:ml-0 [&>button]:md:ml-0">
        {state.canViewTask && task && (
          <Button
            title="View task"
            icon={IconProp.ExternalLink}
            buttonStyle={ButtonStyleType.OUTLINE}
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
            buttonStyle={
              data.isPrimary ? ButtonStyleType.PRIMARY : ButtonStyleType.OUTLINE
            }
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
                presentation,
                label: state.primaryAction!.label,
              });
            }}
          />
        )}
      </div>
    );
  };

  // Fix with AI: the one task the page leads with, and how it works.
  const renderPrimaryTask: () => ReactElement = (): ReactElement => {
    const presentation: AITaskPresentation =
      PRIMARY_AI_TASK_PRESENTATION[primaryTaskType];
    const { task, state } = getTaskState(primaryTaskType, presentation);

    return (
      <section
        className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
        data-testid={`exception-ai-task-${primaryTaskType}`}
        data-primary="true"
        aria-label={translator.translateText(presentation.title)}
      >
        <div className="p-5 md:p-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-50">
              <Icon
                icon={presentation.icon}
                className="h-5 w-5 text-indigo-600"
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-gray-900">
                  {translator.translateText(presentation.title)}
                </h2>
                {renderStatusPill(state)}
              </div>
              <p
                className="mt-1 max-w-3xl text-sm leading-6 text-gray-600"
                data-testid="exception-ai-task-description"
              >
                {translator.translateText(presentation.description)}
              </p>
              {renderTaskProgress(task, state)}
            </div>

            {renderTaskButtons({
              taskType: primaryTaskType,
              presentation,
              task,
              state,
              isPrimary: true,
            })}
          </div>
        </div>

        <div
          className="border-t border-gray-100 bg-gray-50/60 px-5 py-4 md:px-6"
          data-testid="exception-ai-how-it-works"
        >
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            {translator.translateText("How it works")}
          </h3>
          <ol className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
            {EXCEPTION_AI_HOW_IT_WORKS_STEPS.map(
              (step: string, index: number): ReactElement => {
                return (
                  <li key={step} className="flex items-start gap-2.5">
                    <span
                      aria-hidden="true"
                      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700"
                    >
                      {index + 1}
                    </span>
                    <span className="text-sm leading-5 text-gray-700">
                      {translator.translateText(step)}
                    </span>
                  </li>
                );
              },
            )}
          </ol>
          {renderReadyLine()}
        </div>
      </section>
    );
  };

  // One of the other tasks, as a row of the fold.
  const renderOtherTask: (taskType: ExceptionAITaskType) => ReactElement = (
    taskType: ExceptionAITaskType,
  ): ReactElement => {
    const presentation: AITaskPresentation = AI_TASK_PRESENTATION[taskType];
    const { task, state } = getTaskState(taskType, presentation);

    return (
      <li
        key={taskType}
        className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 md:flex-row md:items-start"
        data-testid={`exception-ai-task-${taskType}`}
        aria-label={translator.translateText(presentation.title)}
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
          <Icon icon={presentation.icon} className="h-4 w-4 text-gray-600" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900">
              {translator.translateText(presentation.title)}
            </h3>
            {task ? renderStatusPill(state) : <></>}
          </div>
          <p className="mt-0.5 max-w-3xl text-sm leading-6 text-gray-600">
            {translator.translateText(presentation.description)}
          </p>
          {renderTaskProgress(task, state)}
        </div>
        {renderTaskButtons({
          taskType,
          presentation,
          task,
          state,
          isPrimary: false,
        })}
      </li>
    );
  };

  /*
   * The other tasks, folded: named in the fold's header with the status of
   * any that ran, and open by itself once one of them has a task.
   */
  const renderOtherTasks: () => ReactElement = (): ReactElement => {
    const items: Array<FoldedSectionItem> = otherTaskTypes.map(
      (taskType: ExceptionAITaskType): FoldedSectionItem => {
        const presentation: AITaskPresentation = AI_TASK_PRESENTATION[taskType];
        const { task, state } = getTaskState(taskType, presentation);

        return {
          key: taskType,
          title: presentation.title,
          isSet: Boolean(task),
          value: task ? state.statusLabel : undefined,
          translateValue: true,
        };
      },
    );
    const hasOtherTask: boolean = items.some(
      (item: FoldedSectionItem): boolean => {
        return item.isSet;
      },
    );

    return (
      <FoldedSection
        title={OTHER_AI_TASKS_TITLE}
        icon={IconProp.Sparkles}
        description="Other pull requests OneUptime AI can open for this exception."
        items={items}
        defaultCollapsed={!hasOtherTask}
        isElevated={true}
        dataTestId="exception-ai-other-tasks"
      >
        <ul className="divide-y divide-gray-100">
          {otherTaskTypes.map(renderOtherTask)}
        </ul>
      </FoldedSection>
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

      {renderSetupChecklist()}

      {renderPrimaryTask()}

      {renderOtherTasks()}

      {pendingStart && (
        <ConfirmModal
          title={translator.translateText(pendingStart.presentation.title)}
          description={translator.translateText(
            pendingStart.presentation.description,
          )}
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
