import React, { FunctionComponent, ReactElement, useEffect } from "react";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import ExceptionDetail from "./ExceptionDetail";
import ObjectID from "Common/Types/ObjectID";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import RouteMap from "../../Utils/RouteMap";
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
import { JSONObject } from "Common/Types/JSON";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import AIAgentTaskStatus from "Common/Types/AI/AIAgentTaskStatus";
import Card from "Common/UI/Components/Card/Card";

interface AIAgentTaskInfo {
  _id: string;
  status: AIAgentTaskStatus;
  statusMessage: string | undefined;
  statusTitle: string;
  statusDescription: string;
  createdAt: Date;
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
  const [isAIAgentTaskLoading, setIsAIAgentTaskLoading] =
    React.useState<boolean>(false);

  type RefeshExceptionItemFunction = () => Promise<void>;

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
        },
      });

    if (!updatedTelemetryException) {
      throw new Error("Exception not found");
    }

    setTelemetryException(updatedTelemetryException);
    setIsArchived(updatedTelemetryException.isArchived || false);
    setIsResolved(updatedTelemetryException.isResolved || false);
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

        const hasActiveTask: boolean = response.data?.[
          "hasActiveTask"
        ] as boolean;

        if (hasActiveTask && response.data?.["aiAgentTask"]) {
          const taskData: JSONObject = response.data[
            "aiAgentTask"
          ] as JSONObject;
          setAIAgentTask({
            _id: taskData["_id"] as string,
            status: taskData["status"] as AIAgentTaskStatus,
            statusMessage: taskData["statusMessage"] as string | undefined,
            statusTitle: taskData["statusTitle"] as string,
            statusDescription: taskData["statusDescription"] as string,
            createdAt: new Date(taskData["createdAt"] as string),
          });
        } else {
          setAIAgentTask(undefined);
        }
      } catch {
        // Silently fail - don't show error for AI task fetch
        setAIAgentTask(undefined);
      }

      setIsAIAgentTaskLoading(false);
    };

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      await refreshExceptionItem();
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
    if (!aiAgentTask) {
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
  }, [aiAgentTask]);

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
      setTelemetryException(telemetryException);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
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
      setError(API.getFriendlyMessage(err));
    }

    setIsArchiveLoading(false);
  };

  type CreateAIAgentTaskFunction = () => Promise<void>;

  const createAIAgentTask: CreateAIAgentTaskFunction =
    async (): Promise<void> => {
      try {
        setIsCreateAITaskLoading(true);

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
          Navigation.navigate(
            RouteMap[PageMap.AI_AGENT_TASK_VIEW]!.addRouteParam(
              "modelId",
              aiAgentTaskId,
            ),
          );
        }
      } catch (err) {
        setError(API.getFriendlyMessage(err));
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
        case AIAgentTaskStatus.Scheduled:
          return AlertType.INFO;
        case AIAgentTaskStatus.InProgress:
          return AlertType.INFO;
        case AIAgentTaskStatus.Completed:
          return AlertType.SUCCESS;
        case AIAgentTaskStatus.Error:
          return AlertType.DANGER;
        default:
          return AlertType.INFO;
      }
    };

  return (
    <div className="space-y-4 mb-10">
      {/** AI Agent Task Status */}

      {aiAgentTask && !isResolved && (
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
                  Navigation.navigate(
                    RouteMap[PageMap.AI_AGENT_TASK_VIEW]!.addRouteParam(
                      "modelId",
                      aiAgentTask._id,
                    ),
                  );
                }}
              />
            </div>
          </div>
        </Card>
      )}

      {/** Fix with AI Agent Button */}

      {!isResolved && !aiAgentTask && !isAIAgentTaskLoading && (
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
              actionName: "Resolve",
              actionIcon: IconProp.Check,
              actionButtonStyle: ButtonStyleType.SUCCESS,
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

      <ExceptionDetail {...telemetryException} />

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
          Navigation.navigate(RouteMap[PageMap.TELEMETRY] as Route);
        }}
      />
    </div>
  );
};

export default ExceptionExplorer;
