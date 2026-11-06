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
import { CloudProvider } from "Common/Types/Cloud/CloudPlatform";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A cloud resource's logs: what its connection's stream delivered about
 * it - for AWS, the CloudWatch Logs group AWS names after the resource (a
 * function's /aws/lambda/<name>, a database's /aws/rds/instance/<name>/...);
 * for Azure, the resource logs its diagnostic setting sends, under its ARM
 * id; for Google Cloud, the log entries Cloud Logging files under its
 * monitored resource. The stream stamps each log with the resource's id as
 * the cloud.resource_id resource attribute (CloudLogGroups), and this tab
 * filters on it. The side menu shows the tab only for a kind of resource
 * that has logs of its own.
 *
 * Its empty list says what is true of the resource's account, in its
 * cloud's words: before its connection streams, how to start; once it
 * does, that nothing came from the resource in the time range - which can
 * be older, as a function that stopped running shows - and what to check.
 */

export const CLOUD_RESOURCE_LOGS_NOT_FOUND: string =
  "Cloud resource not found.";

export const CLOUD_RESOURCE_NO_STREAMED_LOGS: string = translationKey(
  "Logs appear here once this resource's AWS account streams its log group: in Cloud > Connect, choose Stream metrics and logs in the account's row.",
);
export const CLOUD_RESOURCE_NO_LOGS_IN_RANGE: string = translationKey(
  "Nothing arrived from this resource's log group in this time range. Choose a longer range, or check that its account streams this log group: in Cloud > Connect, open Stream metrics and logs in the account's row.",
);

// An Azure resource's: its subscription streams resource logs, or metrics alone.
export const AZURE_RESOURCE_NO_STREAMED_LOGS: string = translationKey(
  "Logs appear here once this resource's Azure subscription streams its resource logs: in Cloud > Connect, choose Stream metrics and logs in the account's row.",
);
export const AZURE_RESOURCE_NO_LOGS_IN_RANGE: string = translationKey(
  "Nothing arrived from this resource in this time range. Choose a longer range, or check that its subscription streams logs, not metrics alone: in Cloud > Connect, open Stream metrics and logs in the account's row.",
);

// A Google Cloud resource's: its project's logs come through the stream's filter.
export const GCP_RESOURCE_NO_STREAMED_LOGS: string = translationKey(
  "Logs appear here once this resource's Google Cloud project streams its logs: in Cloud > Connect, choose Stream logs in the account's row.",
);
export const GCP_RESOURCE_NO_LOGS_IN_RANGE: string = translationKey(
  "Nothing arrived from this resource in this time range. Choose a longer range, or check that the stream's filter takes its logs: in Cloud > Connect, open Stream logs in the account's row.",
);

export interface CloudResourceNoLogsMessages {
  // Before the account's connection streams: how to start.
  notStreaming: string;
  // Once it streams: nothing came in the time range, and what to check.
  inRange: string;
}

export const CLOUD_RESOURCE_NO_LOGS_MESSAGES: Record<
  CloudProvider,
  CloudResourceNoLogsMessages
> = {
  [CloudProvider.AWS]: {
    notStreaming: CLOUD_RESOURCE_NO_STREAMED_LOGS,
    inRange: CLOUD_RESOURCE_NO_LOGS_IN_RANGE,
  },
  [CloudProvider.Azure]: {
    notStreaming: AZURE_RESOURCE_NO_STREAMED_LOGS,
    inRange: AZURE_RESOURCE_NO_LOGS_IN_RANGE,
  },
  [CloudProvider.GCP]: {
    notStreaming: GCP_RESOURCE_NO_STREAMED_LOGS,
    inRange: GCP_RESOURCE_NO_LOGS_IN_RANGE,
  },
};

/*
 * What the empty list says, in the resource's cloud's words (AWS's when it
 * names none): whether its account's connection streams yet.
 */
export function getCloudResourceNoLogsMessage(
  resource:
    | Pick<CloudResource, "cloudConnection" | "cloudProvider">
    | null
    | undefined,
): string {
  const provider: string = (resource?.cloudProvider || "").toLowerCase();
  const messages: CloudResourceNoLogsMessages =
    provider === CloudProvider.Azure || provider === CloudProvider.GCP
      ? CLOUD_RESOURCE_NO_LOGS_MESSAGES[provider]
      : CLOUD_RESOURCE_NO_LOGS_MESSAGES[CloudProvider.AWS];

  return resource?.cloudConnection?.streamKeyCreatedAt
    ? messages.inRange
    : messages.notStreaming;
}

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
          // Its cloud, and whether its account's connection streams: what the empty list says.
          cloudProvider: true,
          cloudConnection: {
            streamKeyCreatedAt: true,
          },
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
        noLogsMessage={getCloudResourceNoLogsMessage(cloudResource)}
      />
    </Fragment>
  );
};

export default CloudResourceLogs;
