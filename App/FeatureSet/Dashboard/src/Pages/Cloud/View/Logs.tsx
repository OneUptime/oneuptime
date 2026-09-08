import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Card from "Common/UI/Components/Card/Card";
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import CloudResourceConnectBanner from "../../../Components/Cloud/CloudResourceConnectBanner";
import {
  getCloudResourceAttributeFilters,
  isCloudResourceScoped,
} from "../Utils/CloudResourceTelemetryScope";

const CloudResourceLogs: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cloudResource, setCloudResource] = useState<CloudResource | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const item: CloudResource | null = await ModelAPI.getItem({
        modelType: CloudResource,
        id: modelId,
        select: {
          resourceIdentifier: true,
          name: true,
          cloudPlatform: true,
          cloudAccountId: true,
          cloudRegion: true,
        },
      });

      if (!item?.resourceIdentifier) {
        setError("Cloud environment not found.");
        setIsLoading(false);
        return;
      }

      setCloudResource(item);
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

  const logQuery: Query<Log> = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q: any = {
      attributes: getCloudResourceAttributeFilters(cloudResource),
    };
    return q as Query<Log>;
  }, [
    cloudResource?.cloudPlatform,
    cloudResource?.cloudAccountId,
    cloudResource?.cloudRegion,
  ]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloudResource) {
    return <ErrorMessage message="Cloud environment not found." />;
  }

  /*
   * No platform means no attribute filter, and the viewer would fall back
   * to every log in the project. Show what is actually true instead.
   */
  if (!isCloudResourceScoped(cloudResource)) {
    return (
      <CloudResourceConnectBanner
        modelId={modelId}
        environmentKey={cloudResource.resourceIdentifier}
      />
    );
  }

  return (
    <Card
      title="Cloud Environment Logs"
      description="Live OpenTelemetry logs from workloads on this cloud environment. Use the filter bar to scope by severity, trace id, or any resource attribute."
    >
      <DashboardLogsViewer
        id={`cloud-resource-logs-${modelId.toString()}`}
        logQuery={logQuery}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="No logs found for this cloud environment."
      />
    </Card>
  );
};

export default CloudResourceLogs;
