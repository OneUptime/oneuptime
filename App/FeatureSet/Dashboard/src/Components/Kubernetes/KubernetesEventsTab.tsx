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
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import type { FilterButtonOption } from "Common/UI/Components/FilterButtons/FilterButtons";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import ExpandableText from "Common/UI/Components/ExpandableText/ExpandableText";

export interface ComponentProps {
  clusterIdentifier: string;
  resourceKind: string; // "Pod", "Node", "Deployment", etc.
  resourceName: string;
  namespace?: string | undefined;
}

function formatRelativeTime(timestamp: string): string {
  if (!timestamp) {
    return "-";
  }
  const date: Date = new Date(timestamp);
  const now: Date = new Date();
  const diffMs: number = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return timestamp;
  }
  const diffSec: number = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin: number = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHrs: number = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return `${diffHrs}h ago`;
  }
  const diffDays: number = Math.floor(diffHrs / 24);
  return `${diffDays}d ago`;
}

const KubernetesEventsTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [events, setEvents] = useState<Array<KubernetesEvent>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  useEffect(() => {
    const fetchEvents: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      try {
        const result: Array<KubernetesEvent> =
          await fetchK8sEventsForResource({
            clusterIdentifier: props.clusterIdentifier,
            resourceKind: props.resourceKind,
            resourceName: props.resourceName,
            namespace: props.namespace,
          });
        setEvents(result);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to fetch events",
        );
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

  const warningCount: number = events.filter(
    (e: KubernetesEvent) => e.type.toLowerCase() === "warning",
  ).length;
  const normalCount: number = events.length - warningCount;

  const filteredEvents: Array<KubernetesEvent> = events.filter(
    (e: KubernetesEvent) => {
      if (typeFilter === "warning") {
        return e.type.toLowerCase() === "warning";
      }
      if (typeFilter === "normal") {
        return e.type.toLowerCase() !== "warning";
      }
      return true;
    },
  );

  const filterOptions: Array<FilterButtonOption> = [
    { label: "All", value: "all" },
    { label: "Warnings", value: "warning", badge: warningCount },
    { label: "Normal", value: "normal", badge: normalCount },
  ];

  return (
    <div>
      {/* Summary and Filters */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="text-sm text-gray-600">
          <span className="font-medium">{events.length}</span> events
          {warningCount > 0 && (
            <span>
              {" "}
              (<span className="text-amber-700 font-medium">
                {warningCount}
              </span>{" "}
              warning{warningCount !== 1 ? "s" : ""},{" "}
              <span className="text-emerald-700 font-medium">
                {normalCount}
              </span>{" "}
              normal)
            </span>
          )}
        </div>
        <FilterButtons
          options={filterOptions}
          selectedValue={typeFilter}
          onSelect={setTypeFilter}
        />
      </div>

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
            {filteredEvents.map(
              (event: KubernetesEvent, index: number) => {
                const isWarning: boolean =
                  event.type.toLowerCase() === "warning";
                return (
                  <tr
                    key={index}
                    className={isWarning ? "bg-amber-50/50" : ""}
                  >
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                      <span title={event.timestamp}>
                        {formatRelativeTime(event.timestamp)}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm">
                      <StatusBadge
                        text={event.type}
                        type={
                          isWarning
                            ? StatusBadgeType.Warning
                            : StatusBadgeType.Success
                        }
                      />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                      {event.reason}
                    </td>
                    <td className="px-4 py-3 text-sm max-w-lg">
                      <ExpandableText
                        text={event.message}
                        maxLength={120}
                      />
                    </td>
                  </tr>
                );
              },
            )}
          </tbody>
        </table>
      </div>
      {filteredEvents.length === 0 && (
        <div className="text-gray-500 text-sm p-4 text-center">
          No {typeFilter} events found.
        </div>
      )}
    </div>
  );
};

export default KubernetesEventsTab;
