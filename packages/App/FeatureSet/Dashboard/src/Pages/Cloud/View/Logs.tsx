import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import React, {
  Fragment,
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
import DashboardLogsViewer from "../../../Components/Logs/LogsViewer";
import {
  buildSavedViewScope,
  SavedViewScopeKind,
} from "Common/Utils/Telemetry/SavedViewScope";
import Query from "Common/Types/BaseDatabase/Query";
import Log from "Common/Models/AnalyticsModels/Log";
import { STORED_CLOUD_RESOURCE_ID_ATTRIBUTE } from "Common/Types/Cloud/CloudLogGroups";

/*
 * A cloud resource's logs: what an AWS connection's stream delivered from
 * the CloudWatch Logs group AWS names after the resource - a function's
 * /aws/lambda/<name>, a database's /aws/rds/instance/<name>/... The stream
 * stamps each log with the resource's id as the cloud.resource_id resource
 * attribute (CloudLogGroups), and this tab filters on it. The side menu
 * shows the tab only for a kind of resource a log group names.
 */

export const CLOUD_RESOURCE_LOGS_NOT_FOUND: string =
  "Cloud resource not found.";

export function getCloudResourceLogsViewerId(modelId: ObjectID): string {
  return `cloud-resource-streamed-logs-${modelId.toString()}`;
}

// The logs of the resource, by its id - never every log of the project.
export function getCloudResourceLogsQuery(
  providerResourceId: string,
): Query<Log> {
  /*
   * `any` sidesteps a TS2589 deep-instantiation on Query<Log> with inline
   * attribute maps - the workaround every resource's Logs tab uses.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: any = {
    attributes: {
      [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: providerResourceId,
    },
  };

  return query as Query<Log>;
}

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
          name: true,
          providerResourceId: true,
        },
      });

      if (!item?.providerResourceId) {
        setError(CLOUD_RESOURCE_LOGS_NOT_FOUND);
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

  const providerResourceId: string = cloudResource?.providerResourceId || "";

  const logQuery: Query<Log> = useMemo(() => {
    return getCloudResourceLogsQuery(providerResourceId);
  }, [providerResourceId]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cloudResource || !providerResourceId) {
    return <ErrorMessage message={CLOUD_RESOURCE_LOGS_NOT_FOUND} />;
  }

  return (
    <Fragment>
      {/*
       * The filter matches the resource's id, an ARN the locked chip would
       * show whole; the chip names the resource instead, without touching
       * the filter.
       */}
      <DashboardLogsViewer
        id={getCloudResourceLogsViewerId(modelId)}
        savedViewScope={buildSavedViewScope(
          SavedViewScopeKind.CloudMonitoredResource,
          modelId,
        )}
        logQuery={logQuery}
        attributeFilterDisplayKeys={{
          [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: "Resource",
        }}
        attributeFilterDisplayValues={{
          [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]:
            cloudResource.name || providerResourceId,
        }}
        showFilters={true}
        enableRealtime={true}
        noLogsMessage="Logs appear here once its account's connection streams CloudWatch Logs: choose Stream metrics and logs on the connection in Cloud > Connect, with this resource's log group."
      />
    </Fragment>
  );
};

export default CloudResourceLogs;
