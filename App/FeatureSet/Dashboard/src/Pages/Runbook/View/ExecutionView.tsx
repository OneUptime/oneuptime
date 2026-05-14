import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import Icon, { SizeProp } from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { RUNBOOK_URL } from "Common/UI/Config";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import { JSONObject } from "Common/Types/JSON";
import { useAsyncEffect } from "use-async-effect";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";

interface StatusVisual {
  label: string;
  // Tailwind background + text + ring classes for the badge
  badge: string;
  // Color for the timeline dot
  dot: string;
  // Optional icon to render inside the dot
  icon?: IconProp;
}

const EXEC_STATUS_VISUAL: Record<RunbookExecutionStatus, StatusVisual> = {
  [RunbookExecutionStatus.Scheduled]: {
    label: "Scheduled",
    badge: "bg-slate-50 text-slate-700 ring-slate-200",
    dot: "bg-slate-300",
  },
  [RunbookExecutionStatus.Running]: {
    label: "Running",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [RunbookExecutionStatus.WaitingForManualStep]: {
    label: "Waiting for you",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [RunbookExecutionStatus.Completed]: {
    label: "Completed",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [RunbookExecutionStatus.Failed]: {
    label: "Failed",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
  [RunbookExecutionStatus.Cancelled]: {
    label: "Cancelled",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

const STEP_STATUS_VISUAL: Record<RunbookStepExecutionStatus, StatusVisual> = {
  [RunbookStepExecutionStatus.Pending]: {
    label: "Pending",
    badge: "bg-slate-50 text-slate-600 ring-slate-200",
    dot: "bg-slate-300",
  },
  [RunbookStepExecutionStatus.Running]: {
    label: "Running",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
    icon: IconProp.Spinner,
  },
  [RunbookStepExecutionStatus.WaitingForUser]: {
    label: "Waiting for you",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [RunbookStepExecutionStatus.Completed]: {
    label: "Done",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
    icon: IconProp.Check,
  },
  [RunbookStepExecutionStatus.Skipped]: {
    label: "Skipped",
    badge: "bg-gray-100 text-gray-600 ring-gray-200",
    dot: "bg-gray-300",
    icon: IconProp.ChevronRight,
  },
  [RunbookStepExecutionStatus.Failed]: {
    label: "Failed",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
    icon: IconProp.Close,
  },
};

const STEP_TYPE_ICON: Record<RunbookStepType, IconProp> = {
  [RunbookStepType.Manual]: IconProp.Check,
  [RunbookStepType.JavaScript]: IconProp.Code,
  [RunbookStepType.HttpRequest]: IconProp.Globe,
  [RunbookStepType.Bash]: IconProp.Terminal,
};

const STEP_TYPE_LABEL: Record<RunbookStepType, string> = {
  [RunbookStepType.Manual]: "Manual",
  [RunbookStepType.JavaScript]: "JavaScript",
  [RunbookStepType.HttpRequest]: "HTTP",
  [RunbookStepType.Bash]: "Bash",
};

function isTerminal(status?: RunbookExecutionStatus): boolean {
  return (
    status === RunbookExecutionStatus.Completed ||
    status === RunbookExecutionStatus.Failed ||
    status === RunbookExecutionStatus.Cancelled
  );
}

function StatusBadge({
  visual,
}: {
  visual: StatusVisual;
}): ReactElement {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${visual.badge}`}
    >
      <span
        className={`inline-block w-1.5 h-1.5 rounded-full ${visual.dot}`}
      ></span>
      {visual.label}
    </span>
  );
}

const ExecutionView: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const params: Readonly<Record<string, string | undefined>> = useParams();
  const executionId: ObjectID = new ObjectID(params["subModelId"] || "");

  const [execution, setExecution] = useState<RunbookExecution | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [actionInFlight, setActionInFlight] = useState<boolean>(false);
  const pollRef: React.MutableRefObject<NodeJS.Timeout | null> =
    useRef<NodeJS.Timeout | null>(null);

  const load: () => Promise<RunbookExecution | null> =
    async (): Promise<RunbookExecution | null> => {
      try {
        const exec: RunbookExecution | null =
          await ModelAPI.getItem<RunbookExecution>({
            modelType: RunbookExecution,
            id: executionId,
            select: {
              _id: true,
              runbookId: true,
              runbookNameSnapshot: true,
              status: true,
              stepExecutions: true,
              startedAt: true,
              completedAt: true,
              failureReason: true,
              createdAt: true,
            },
            requestOptions: {},
          });
        setExecution(exec);
        return exec;
      } catch (err) {
        setError(API.getFriendlyMessage(err));
        return null;
      }
    };

  useAsyncEffect(async () => {
    await load();
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!execution) {
      return;
    }
    if (isTerminal(execution.status as RunbookExecutionStatus)) {
      return;
    }
    pollRef.current = setInterval(() => {
      void load();
    }, 3000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [execution?.status]);

  const completeStep: (stepId: string) => Promise<void> = async (
    stepId: string,
  ): Promise<void> => {
    setActionInFlight(true);
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            `/execution/${executionId.toString()}/step/${stepId}/complete`,
          ),
          data: {},
        });
      if (result instanceof HTTPErrorResponse) {
        throw result;
      }
      await load();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setActionInFlight(false);
    }
  };

  const skipStep: (stepId: string) => Promise<void> = async (
    stepId: string,
  ): Promise<void> => {
    setActionInFlight(true);
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            `/execution/${executionId.toString()}/step/${stepId}/skip`,
          ),
          data: {},
        });
      if (result instanceof HTTPErrorResponse) {
        throw result;
      }
      await load();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setActionInFlight(false);
    }
  };

  const cancel: () => Promise<void> = async (): Promise<void> => {
    setActionInFlight(true);
    try {
      const result: HTTPErrorResponse | HTTPResponse<JSONObject> =
        await API.post<JSONObject>({
          url: URL.fromString(RUNBOOK_URL.toString()).addRoute(
            `/execution/${executionId.toString()}/cancel`,
          ),
          data: {},
        });
      if (result instanceof HTTPErrorResponse) {
        throw result;
      }
      await load();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setActionInFlight(false);
    }
  };

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (!execution) {
    return (
      <Card title="Runbook Execution" description="Not found.">
        <p className="text-sm text-gray-500">
          This runbook execution could not be loaded. It may have been deleted.
        </p>
      </Card>
    );
  }

  const steps: RunbookStepExecutionState[] =
    (execution.stepExecutions as unknown as RunbookStepExecutionState[]) || [];
  const execStatus: RunbookExecutionStatus =
    (execution.status as RunbookExecutionStatus) ||
    RunbookExecutionStatus.Scheduled;
  const execVisual: StatusVisual = EXEC_STATUS_VISUAL[execStatus];
  const canCancel: boolean = !isTerminal(execStatus);

  const totalSteps: number = steps.length;
  const completedSteps: number = steps.filter(
    (s: RunbookStepExecutionState) => {
      return (
        s.status === RunbookStepExecutionStatus.Completed ||
        s.status === RunbookStepExecutionStatus.Skipped
      );
    },
  ).length;

  return (
    <Fragment>
      <Card
        title={execution.runbookNameSnapshot || "Runbook Execution"}
        description={
          execStatus === RunbookExecutionStatus.WaitingForManualStep
            ? "Waiting on a manual step. Tick it off below to continue."
            : execStatus === RunbookExecutionStatus.Running
              ? "Steps are running. This page refreshes every 3 seconds."
              : execStatus === RunbookExecutionStatus.Completed
                ? "All steps completed successfully."
                : execStatus === RunbookExecutionStatus.Failed
                  ? "A step failed and stopped the run."
                  : execStatus === RunbookExecutionStatus.Cancelled
                    ? "This execution was cancelled."
                    : "Scheduled — waiting to start."
        }
        buttons={
          canCancel
            ? [
                {
                  title: "Cancel Execution",
                  buttonStyle: ButtonStyleType.DANGER_OUTLINE,
                  icon: IconProp.Close,
                  onClick: () => {
                    void cancel();
                  },
                  disabled: actionInFlight,
                },
              ]
            : undefined
        }
      >
        <>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Status
              </div>
              <StatusBadge visual={execVisual} />
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Progress
              </div>
              <div className="text-sm font-medium text-gray-900">
                {completedSteps} of {totalSteps} steps
              </div>
              {totalSteps > 0 && (
                <div className="mt-2 h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 transition-all"
                    style={{
                      width: `${(completedSteps / totalSteps) * 100}%`,
                    }}
                  ></div>
                </div>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                Started
              </div>
              <div className="text-sm text-gray-900">
                {execution.startedAt
                  ? OneUptimeDate.getDateAsLocalFormattedString(
                      execution.startedAt,
                    )
                  : "—"}
              </div>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">
                {execution.completedAt ? "Completed" : "Elapsed"}
              </div>
              <div className="text-sm text-gray-900">
                {execution.completedAt
                  ? OneUptimeDate.getDateAsLocalFormattedString(
                      execution.completedAt,
                    )
                  : execution.startedAt
                    ? "Running..."
                    : "—"}
              </div>
            </div>
          </div>

          {execution.failureReason ? (
            <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-sm px-4 py-3 mb-6 flex items-start gap-3">
              <Icon
                icon={IconProp.Alert}
                size={SizeProp.Regular}
                className="text-rose-500 mt-0.5 shrink-0"
              />
              <div>
                <div className="font-medium">Run failed</div>
                <div className="mt-0.5 text-rose-700">
                  {execution.failureReason}
                </div>
              </div>
            </div>
          ) : null}

          {steps.length === 0 ? (
            <p className="text-sm text-gray-500">
              This runbook had no steps when it ran.
            </p>
          ) : (
            <div className="relative">
              {/* Vertical timeline line */}
              <div
                aria-hidden="true"
                className="absolute left-[1.125rem] top-2 bottom-2 w-px bg-gray-200"
              ></div>

              <ul className="space-y-3">
                {steps.map(
                  (stepExec: RunbookStepExecutionState, idx: number) => {
                    const stepVisual: StatusVisual =
                      STEP_STATUS_VISUAL[stepExec.status];
                    const isWaiting: boolean =
                      stepExec.step.type === RunbookStepType.Manual &&
                      stepExec.status ===
                        RunbookStepExecutionStatus.WaitingForUser;
                    const canSkip: boolean =
                      stepExec.status ===
                        RunbookStepExecutionStatus.WaitingForUser ||
                      stepExec.status === RunbookStepExecutionStatus.Pending;
                    return (
                      <li
                        key={stepExec.step.id}
                        className="relative pl-12"
                      >
                        {/* Timeline dot */}
                        <div className="absolute left-2.5 top-3 z-10">
                          <span
                            className={`flex h-6 w-6 items-center justify-center rounded-full ${stepVisual.dot} text-white shadow ring-4 ring-white`}
                          >
                            {stepVisual.icon ? (
                              <Icon
                                icon={stepVisual.icon}
                                size={SizeProp.Smaller}
                                className="text-white"
                              />
                            ) : (
                              <span className="text-[10px] font-semibold">
                                {idx + 1}
                              </span>
                            )}
                          </span>
                        </div>

                        <div
                          className={`rounded-xl border bg-white px-5 py-4 shadow-sm transition ${
                            isWaiting
                              ? "border-amber-300 ring-1 ring-amber-100"
                              : "border-gray-200"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <span className="text-xs text-gray-400 font-medium">
                                  Step {idx + 1}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-700">
                                  <Icon
                                    icon={
                                      STEP_TYPE_ICON[stepExec.step.type]
                                    }
                                    size={SizeProp.Smaller}
                                    className="text-gray-500"
                                  />
                                  {STEP_TYPE_LABEL[stepExec.step.type]}
                                </span>
                                <StatusBadge visual={stepVisual} />
                              </div>
                              <h3 className="text-sm font-semibold text-gray-900">
                                {stepExec.step.title}
                              </h3>
                              {stepExec.step.description && (
                                <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap leading-relaxed">
                                  {stepExec.step.description}
                                </p>
                              )}
                            </div>
                            <div className="flex-shrink-0 flex items-center gap-2">
                              {isWaiting && (
                                <Button
                                  title="Mark complete"
                                  buttonStyle={ButtonStyleType.PRIMARY}
                                  buttonSize={ButtonSize.Small}
                                  icon={IconProp.Check}
                                  onClick={() => {
                                    void completeStep(stepExec.step.id);
                                  }}
                                  disabled={actionInFlight}
                                />
                              )}
                              {canSkip && (
                                <Button
                                  title="Skip"
                                  buttonStyle={ButtonStyleType.OUTLINE}
                                  buttonSize={ButtonSize.Small}
                                  icon={IconProp.ChevronRight}
                                  onClick={() => {
                                    void skipStep(stepExec.step.id);
                                  }}
                                  disabled={actionInFlight}
                                />
                              )}
                            </div>
                          </div>

                          {(stepExec.startedAt || stepExec.completedAt) && (
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 mt-2">
                              {stepExec.startedAt && (
                                <span>
                                  Started{" "}
                                  {OneUptimeDate.getDateAsLocalFormattedString(
                                    new Date(stepExec.startedAt),
                                  )}
                                </span>
                              )}
                              {stepExec.completedAt && (
                                <span>
                                  Finished{" "}
                                  {OneUptimeDate.getDateAsLocalFormattedString(
                                    new Date(stepExec.completedAt),
                                  )}
                                </span>
                              )}
                            </div>
                          )}

                          {stepExec.errorMessage && (
                            <div className="mt-3 rounded-md bg-rose-50 border border-rose-200 text-rose-800 px-3 py-2 text-xs">
                              <span className="font-medium">Error:</span>{" "}
                              {stepExec.errorMessage}
                            </div>
                          )}

                          {stepExec.output && (
                            <details className="mt-3 group">
                              <summary className="cursor-pointer text-xs font-medium text-gray-600 hover:text-gray-800 select-none">
                                <span className="group-open:hidden">
                                  Show output
                                </span>
                                <span className="hidden group-open:inline">
                                  Hide output
                                </span>
                              </summary>
                              <pre className="mt-2 text-xs bg-gray-900 text-gray-100 rounded-md px-3 py-2 overflow-auto whitespace-pre-wrap max-h-72">
                                {stepExec.output}
                              </pre>
                            </details>
                          )}
                        </div>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          )}
        </>
      </Card>

      {error && (
        <ConfirmModal
          title="Error"
          description={error}
          submitButtonText="Close"
          submitButtonType={ButtonStyleType.NORMAL}
          onSubmit={() => {
            setError("");
          }}
        />
      )}
    </Fragment>
  );
};

export default ExecutionView;
