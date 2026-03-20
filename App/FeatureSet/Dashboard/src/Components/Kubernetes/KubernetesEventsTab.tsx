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
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import type Columns from "Common/UI/Components/Table/Types/Columns";

export interface ComponentProps {
  clusterIdentifier: string;
  resourceKind: string; // "Pod", "Node", "Deployment", etc.
  resourceName: string;
  namespace?: string | undefined;
}

interface EventRow {
  timestamp: string;
  relativeTime: string;
  type: string;
  reason: string;
  message: string;
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

  const tableData: Array<EventRow> = filteredEvents.map(
    (event: KubernetesEvent): EventRow => {
      return {
        timestamp: event.timestamp,
        relativeTime: formatRelativeTime(event.timestamp),
        type: event.type,
        reason: event.reason,
        message: event.message,
      };
    },
  );

  const columns: Columns<EventRow> = [
    {
      title: "Time",
      type: FieldType.Text,
      key: "relativeTime",
      tooltipText: (item: EventRow): string => {
        return item.timestamp;
      },
    },
    {
      title: "Type",
      type: FieldType.Element,
      key: "type",
      getElement: (item: EventRow): ReactElement => {
        const isWarning: boolean = item.type.toLowerCase() === "warning";
        return (
          <StatusBadge
            text={item.type}
            type={
              isWarning ? StatusBadgeType.Warning : StatusBadgeType.Success
            }
          />
        );
      },
    },
    {
      title: "Reason",
      type: FieldType.Text,
      key: "reason",
    },
    {
      title: "Message",
      type: FieldType.Element,
      key: "message",
      getElement: (item: EventRow): ReactElement => {
        return <ExpandableText text={item.message} maxLength={120} />;
      },
    },
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
              (
              <span className="text-amber-700 font-medium">
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

      <LocalTable
        id="kubernetes-events-table"
        data={tableData}
        columns={columns}
        singularLabel="Event"
        pluralLabel="Events"
      />
    </div>
  );
};

export default KubernetesEventsTab;
