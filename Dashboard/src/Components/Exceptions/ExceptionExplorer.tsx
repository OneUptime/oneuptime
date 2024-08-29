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
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import OccouranceTable from "./OccuranceTable";

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

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);
      await refreshExceptionItem();
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

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage error={error} />;
  }

  if (!telemetryException) {
    return <ErrorMessage error="Exception not found" />;
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

  return (
    <div className="space-y-4 mb-10">
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
              actionButtonStyle: ButtonStyleType.DANGER,
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
              actionButtonStyle: ButtonStyleType.DANGER,
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
