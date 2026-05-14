import PageComponentProps from "../../PageComponentProps";
import URL from "Common/Types/API/URL";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import OneUptimeDate from "Common/Types/Date";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill from "Common/UI/Components/Pill/Pill";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { RUNBOOK_URL } from "Common/UI/Config";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import RunbookExecutionStatus from "Common/Types/Runbook/RunbookExecutionStatus";
import RunbookStepExecutionStatus from "Common/Types/Runbook/RunbookStepExecutionStatus";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { RunbookStepExecutionState } from "Common/Types/Runbook/RunbookStepExecution";
import { JSONObject } from "Common/Types/JSON";
import {
  Gray500,
  Green500,
  Red500,
  Yellow500,
  Blue500,
  Slate500,
} from "Common/Types/BrandColors";
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

function executionStatusPill(status: RunbookExecutionStatus): ReactElement {
  switch (status) {
    case RunbookExecutionStatus.Completed:
      return <Pill text="Completed" color={Green500} isMinimal={true} />;
    case RunbookExecutionStatus.Failed:
      return <Pill text="Failed" color={Red500} isMinimal={true} />;
    case RunbookExecutionStatus.Running:
      return <Pill text="Running" color={Blue500} isMinimal={true} />;
    case RunbookExecutionStatus.WaitingForManualStep:
      return (
        <Pill
          text="Waiting for manual step"
          color={Yellow500}
          isMinimal={true}
        />
      );
    case RunbookExecutionStatus.Cancelled:
      return <Pill text="Cancelled" color={Gray500} isMinimal={true} />;
    case RunbookExecutionStatus.Scheduled:
    default:
      return (
        <Pill text={status || "Scheduled"} color={Slate500} isMinimal={true} />
      );
  }
}

function stepStatusPill(status: RunbookStepExecutionStatus): ReactElement {
  switch (status) {
    case RunbookStepExecutionStatus.Completed:
      return <Pill text="Done" color={Green500} isMinimal={true} />;
    case RunbookStepExecutionStatus.Failed:
      return <Pill text="Failed" color={Red500} isMinimal={true} />;
    case RunbookStepExecutionStatus.Running:
      return <Pill text="Running" color={Blue500} isMinimal={true} />;
    case RunbookStepExecutionStatus.WaitingForUser:
      return <Pill text="Waiting for you" color={Yellow500} isMinimal={true} />;
    case RunbookStepExecutionStatus.Skipped:
      return <Pill text="Skipped" color={Gray500} isMinimal={true} />;
    case RunbookStepExecutionStatus.Pending:
    default:
      return <Pill text="Pending" color={Slate500} isMinimal={true} />;
  }
}

function isTerminal(status?: RunbookExecutionStatus): boolean {
  return (
    status === RunbookExecutionStatus.Completed ||
    status === RunbookExecutionStatus.Failed ||
    status === RunbookExecutionStatus.Cancelled
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
      <div className="text-sm text-gray-500">Runbook execution not found.</div>
    );
  }

  const steps: RunbookStepExecutionState[] =
    (execution.stepExecutions as unknown as RunbookStepExecutionState[]) || [];
  const canCancel: boolean = !isTerminal(
    execution.status as RunbookExecutionStatus,
  );

  return (
    <Fragment>
      <Card
        title={execution.runbookNameSnapshot || "Runbook Execution"}
        description={
          execution.startedAt
            ? `Started ${OneUptimeDate.getDateAsLocalFormattedString(
                execution.startedAt,
              )}`
            : "Not yet started."
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
          <div className="flex items-center gap-3 mb-4">
            {executionStatusPill(execution.status as RunbookExecutionStatus)}
            {execution.completedAt ? (
              <span className="text-xs text-gray-500">
                Completed{" "}
                {OneUptimeDate.getDateAsLocalFormattedString(
                  execution.completedAt,
                )}
              </span>
            ) : null}
          </div>

          {execution.failureReason ? (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-md px-3 py-2 mb-4">
              {execution.failureReason}
            </div>
          ) : null}

          <div className="flex flex-col gap-3">
            {steps.length === 0 && (
              <div className="text-sm text-gray-500">
                No steps in this runbook.
              </div>
            )}
            {steps.map((stepExec: RunbookStepExecutionState, idx: number) => {
              const isManualWaiting: boolean =
                stepExec.step.type === RunbookStepType.Manual &&
                stepExec.status === RunbookStepExecutionStatus.WaitingForUser;
              return (
                <div
                  key={stepExec.step.id}
                  className="border border-gray-200 rounded-lg p-4 bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-800">
                          {idx + 1}. {stepExec.step.title}
                        </span>
                        {stepStatusPill(stepExec.status)}
                      </div>
                      {stepExec.step.description && (
                        <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">
                          {stepExec.step.description}
                        </p>
                      )}
                      {stepExec.errorMessage && (
                        <p className="text-xs text-red-600 mt-1">
                          Error: {stepExec.errorMessage}
                        </p>
                      )}
                      {stepExec.output && (
                        <details className="mt-2">
                          <summary className="text-xs text-gray-500 cursor-pointer">
                            Output
                          </summary>
                          <pre className="text-xs bg-gray-50 border border-gray-200 rounded p-2 mt-1 overflow-auto whitespace-pre-wrap">
                            {stepExec.output}
                          </pre>
                        </details>
                      )}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      {isManualWaiting && (
                        <Button
                          title="Mark Complete"
                          buttonStyle={ButtonStyleType.PRIMARY}
                          icon={IconProp.Check}
                          onClick={() => {
                            void completeStep(stepExec.step.id);
                          }}
                          disabled={actionInFlight}
                        />
                      )}
                      {(stepExec.status ===
                        RunbookStepExecutionStatus.WaitingForUser ||
                        stepExec.status ===
                          RunbookStepExecutionStatus.Pending) && (
                        <Button
                          title="Skip"
                          buttonStyle={ButtonStyleType.OUTLINE}
                          icon={IconProp.ChevronRight}
                          onClick={() => {
                            void skipStep(stepExec.step.id);
                          }}
                          disabled={actionInFlight}
                        />
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
