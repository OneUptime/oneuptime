import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import RumApplication from "Common/Models/DatabaseModels/RumApplication";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import ServiceType from "Common/Types/Telemetry/ServiceType";

const RumApplicationLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [rumApplication, setRumApplication] = useState<RumApplication | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: RumApplication | null = await ModelAPI.getItem({
        modelType: RumApplication,
        id: modelId,
        select: {
          appIdentifier: true,
          name: true,
        },
      });

      if (!item?.appIdentifier) {
        setError("RUM application not found.");
        setIsLoading(false);
        return;
      }

      setRumApplication(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!rumApplication) {
    return <ErrorMessage message="RUM application not found." />;
  }

  return (
    <Fragment>
      {/*
       * Telemetry for a RUM application carries the RumApplication id in
       * primaryEntityId, not a Service id. Tell the viewer so the locked
       * scope chip reads "RUM Application: <name>" instead of
       * "Service: <uuid>".
       */}
      <DashboardLogsViewer
        id={`rum-application-logs-${modelId.toString()}`}
        serviceIds={[modelId]}
        scopeEntityType={ServiceType.RealUserMonitor}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found for this application."
      />
    </Fragment>
  );
};

export default RumApplicationLogs;
