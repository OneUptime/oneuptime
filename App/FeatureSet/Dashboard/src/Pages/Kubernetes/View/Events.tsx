import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import Log from "Common/Models/AnalyticsModels/Log";
import ProjectUtil from "Common/UI/Utils/Project";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
import { JSONObject } from "Common/Types/JSON";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import { getKvValue, getKvStringValue } from "../Utils/KubernetesObjectParser";
import { KubernetesEvent } from "../Utils/KubernetesObjectFetcher";

const KubernetesClusterEvents: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [events, setEvents] = useState<Array<KubernetesEvent>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          clusterIdentifier: true,
        },
      });
      setCluster(item);

      if (!item?.clusterIdentifier) {
        setIsLoading(false);
        return;
      }

      const endDate: Date = OneUptimeDate.getCurrentDate();
      const startDate: Date = OneUptimeDate.addRemoveHours(endDate, -24);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const eventsQueryOptions: any = {
        modelType: Log,
        query: {
          projectId: ProjectUtil.getCurrentProjectId()!.toString(),
          time: new InBetween<Date>(startDate, endDate),
          attributes: {
            "logAttributes.event.domain": "k8s",
            "logAttributes.k8s.resource.name": "events",
          },
        },
        limit: 500,
        skip: 0,
        select: {
          time: true,
          body: true,
          severityText: true,
          attributes: true,
        },
        sort: {
          time: SortOrder.Descending,
        },
        requestOptions: {},
      };
      const listResult: ListResult<Log> =
        await AnalyticsModelAPI.getList<Log>(eventsQueryOptions);

      const k8sEvents: Array<KubernetesEvent> = [];

      for (const log of listResult.data) {
        const attrs: JSONObject = log.attributes || {};

        // Filter to only k8s events from this cluster
        if (
          attrs["resource.k8s.cluster.name"] !== item.clusterIdentifier &&
          attrs["k8s.cluster.name"] !== item.clusterIdentifier
        ) {
          continue;
        }

        // Parse the body which is OTLP kvlistValue JSON
        let bodyObj: JSONObject | null = null;
        try {
          if (typeof log.body === "string") {
            bodyObj = JSON.parse(log.body) as JSONObject;
          }
        } catch {
          continue;
        }

        if (!bodyObj) {
          continue;
        }

        const topKvList: JSONObject | undefined = bodyObj["kvlistValue"] as
          | JSONObject
          | undefined;
        if (!topKvList) {
          continue;
        }

        // Get the "object" which is the actual k8s Event
        const objectVal: string | JSONObject | null = getKvValue(
          topKvList,
          "object",
        );
        if (!objectVal || typeof objectVal === "string") {
          continue;
        }
        const objectKvList: JSONObject = objectVal;

        const eventType: string = getKvStringValue(objectKvList, "type") || "";
        const reason: string = getKvStringValue(objectKvList, "reason") || "";
        const note: string = getKvStringValue(objectKvList, "note") || "";

        // Get regarding object details using shared parser
        const regardingKv: string | JSONObject | null = getKvValue(
          objectKvList,
          "regarding",
        );
        const regardingObj: JSONObject | undefined =
          regardingKv && typeof regardingKv !== "string"
            ? regardingKv
            : undefined;

        const objectKind: string = regardingObj
          ? getKvStringValue(regardingObj, "kind")
          : "";
        const objectName: string = regardingObj
          ? getKvStringValue(regardingObj, "name")
          : "";

        const metadataKv: string | JSONObject | null = getKvValue(
          objectKvList,
          "metadata",
        );
        const metadataObj: JSONObject | undefined =
          metadataKv && typeof metadataKv !== "string" ? metadataKv : undefined;

        const namespace: string =
          (regardingObj ? getKvStringValue(regardingObj, "namespace") : "") ||
          (metadataObj ? getKvStringValue(metadataObj, "namespace") : "") ||
          "";

        if (eventType || reason) {
          k8sEvents.push({
            timestamp: log.time
              ? OneUptimeDate.getDateAsLocalFormattedString(log.time)
              : "",
            type: eventType || "Unknown",
            reason: reason || "Unknown",
            objectKind: objectKind || "Unknown",
            objectName: objectName || "Unknown",
            namespace: namespace || "default",
            message: note || "",
          });
        }
      }

      setEvents(k8sEvents);
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

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  return (
    <Fragment>
      <Card
        title="Kubernetes Events"
        description="Events from the last 24 hours collected by the k8sobjects receiver. Warning events may indicate issues that need attention."
      >
        {events.length === 0 ? (
          <p className="text-gray-500 text-sm">
            No Kubernetes events found in the last 24 hours. Events will appear
            here once the kubernetes-agent is sending data.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Time
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Reason
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Object
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Namespace
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Message
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {events.map((event: KubernetesEvent, index: number) => {
                  const isWarning: boolean =
                    event.type.toLowerCase() === "warning";
                  return (
                    <tr key={index} className={isWarning ? "bg-yellow-50" : ""}>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {event.timestamp}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm">
                        <span
                          className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            isWarning
                              ? "bg-yellow-100 text-yellow-800"
                              : "bg-green-100 text-green-800"
                          }`}
                        >
                          {event.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {event.reason}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                        {event.objectKind}/{event.objectName}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                        {event.namespace}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 max-w-md truncate">
                        {event.message}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterEvents;
