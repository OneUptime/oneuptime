import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  fetchK8sEventsForResource,
  KubernetesEvent,
} from "../../Pages/Kubernetes/Utils/KubernetesObjectFetcher";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";

export interface ComponentProps {
  clusterIdentifier: string;
  resourceKind: string; // "Pod", "Node", "Deployment", etc.
  resourceName: string;
  namespace?: string | undefined;
}

const KubernetesEventsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [events, setEvents] = useState<Array<KubernetesEvent>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const fetchEvents: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const result: Array<KubernetesEvent> = await fetchK8sEventsForResource({
          clusterIdentifier: props.clusterIdentifier,
          resourceKind: props.resourceKind,
          resourceName: props.resourceName,
          namespace: props.namespace,
        });
        setEvents(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch events");
      }
      setIsLoading(false);
    };

    fetchEvents().catch(() => {});
  }, [
    props.clusterIdentifier,
    props.resourceKind,
    props.resourceName,
    props.namespace,
  ]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (events.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No events found for this {props.resourceKind.toLowerCase()} in the last
        24 hours.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Time
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Type
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Reason
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Message
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {events.map((event: KubernetesEvent, index: number) => {
            const isWarning: boolean = event.type.toLowerCase() === "warning";
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
                <td className="px-4 py-3 text-sm text-gray-500 max-w-lg">
                  {event.message}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default KubernetesEventsTab;
