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

  const fetchItems: PromiseVoidFunction = async (): Promise<void> => {
    try {
      setIsLoading(true);

      // get trace with this id and then get all the parentSpanId with this traceid.

      const telemetryException: TelemetryException | null =
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
          },
        });

      if (!telemetryException) {
        throw new Error("Exception not found");
      }

      setTelemetryException(telemetryException);
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

  return (
    <div className="space-y-4 mb-10">
      {/** Resolve / Unresolve Button */}

      <ExceptionDetail {...telemetryException} />

      {/** Assign / Unassign Button */}

      {/** Occurance Table */}

      {/** Archive / Unarchive Button Button */}

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
