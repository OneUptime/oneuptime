import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import URL from "Common/Types/API/URL";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONObject } from "Common/Types/JSON";
import OneUptimeDate from "Common/Types/Date";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import StatusBadge, {
  StatusBadgeType,
} from "Common/UI/Components/StatusBadge/StatusBadge";
import ExpandableText from "Common/UI/Components/ExpandableText/ExpandableText";
import LocalTable from "Common/UI/Components/Table/LocalTable";
import FieldType from "Common/UI/Components/Types/FieldType";
import type Columns from "Common/UI/Components/Table/Types/Columns";

export interface ComponentProps {
  clusterId: ObjectID;
  kind: string; // PascalCase singular, e.g. "Deployment"
  name: string;
  namespace?: string | undefined;
}

interface TimelineChangedField {
  path: string;
  oldValue: string;
  newValue: string;
}

interface TimelineItemRow {
  timestamp: string;
  relativeTime: string;
  source: string; // "SpecChange" | "Deleted" | "KubernetesEvent"
  eventType: string;
  title: string;
  message: string;
  changedFields: Array<TimelineChangedField>;
}

function formatRelativeTime(date: Date | null): string {
  if (!date || isNaN(date.getTime())) {
    return "-";
  }
  const now: Date = new Date();
  const diffMs: number = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return OneUptimeDate.getDateAsLocalFormattedString(date);
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

/**
 * Message cell: the item message plus an expandable list of changed
 * spec fields (present only for SpecChange items).
 */
const TimelineMessage: FunctionComponent<{
  message: string;
  changedFields: Array<TimelineChangedField>;
}> = (props: {
  message: string;
  changedFields: Array<TimelineChangedField>;
}): ReactElement => {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  return (
    <div>
      <ExpandableText text={props.message || "-"} maxLength={120} />
      {props.changedFields.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => {
              setIsExpanded(!isExpanded);
            }}
            aria-expanded={isExpanded}
            className="inline-flex items-center rounded text-xs font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1 transition-colors"
          >
            {isExpanded
              ? "Hide changed fields"
              : `Show ${props.changedFields.length} changed field${
                  props.changedFields.length !== 1 ? "s" : ""
                }`}
          </button>
          {isExpanded && (
            <div className="mt-1">
              {props.changedFields.map(
                (field: TimelineChangedField, index: number) => {
                  return (
                    <div
                      key={index}
                      className="text-xs text-gray-900 font-mono break-all mt-1"
                    >
                      {field.path}: {field.oldValue} → {field.newValue}
                    </div>
                  );
                },
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const KubernetesWorkloadTimelineTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [items, setItems] = useState<Array<TimelineItemRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    const fetchTimeline: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const timelineUrl: URL = URL.fromString(APP_API_URL.toString())
          .addRoute("/kubernetes-cluster/workload-timeline/")
          .addRoute(props.clusterId.toString());

        const requestBody: JSONObject = {
          kind: props.kind,
          name: props.name,
        };
        if (props.namespace) {
          requestBody["namespace"] = props.namespace;
        }

        const timelineResponse: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: timelineUrl,
            data: requestBody,
            headers: {
              ...ModelAPI.getCommonHeaders(),
            },
          });

        if (timelineResponse instanceof HTTPErrorResponse) {
          throw timelineResponse;
        }

        const itemsRaw: unknown = timelineResponse.data["items"];
        const rows: Array<TimelineItemRow> = [];

        if (Array.isArray(itemsRaw)) {
          for (const itemRaw of itemsRaw) {
            const item: JSONObject = (itemRaw as JSONObject) || {};
            const details: JSONObject = (item["details"] as JSONObject) || {};

            const occurredAtRaw: unknown = item["occurredAt"];
            const occurredAt: Date | null =
              typeof occurredAtRaw === "string"
                ? new Date(occurredAtRaw)
                : null;

            const changedFieldsRaw: unknown = details["changedFields"];
            const changedFields: Array<TimelineChangedField> = Array.isArray(
              changedFieldsRaw,
            )
              ? changedFieldsRaw.map(
                  (fieldRaw: unknown): TimelineChangedField => {
                    const field: JSONObject = (fieldRaw as JSONObject) || {};
                    return {
                      path:
                        typeof field["path"] === "string" ? field["path"] : "",
                      oldValue:
                        typeof field["oldValue"] === "string"
                          ? field["oldValue"]
                          : "",
                      newValue:
                        typeof field["newValue"] === "string"
                          ? field["newValue"]
                          : "",
                    };
                  },
                )
              : [];

            rows.push({
              timestamp:
                occurredAt && !isNaN(occurredAt.getTime())
                  ? OneUptimeDate.getDateAsLocalFormattedString(occurredAt)
                  : "",
              relativeTime: formatRelativeTime(occurredAt),
              source: typeof item["source"] === "string" ? item["source"] : "",
              eventType:
                typeof details["eventType"] === "string"
                  ? details["eventType"]
                  : "",
              title: typeof item["title"] === "string" ? item["title"] : "",
              message:
                typeof item["message"] === "string" ? item["message"] : "",
              changedFields: changedFields,
            });
          }
        }

        setItems(rows);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
      setIsLoading(false);
    };

    fetchTimeline().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.clusterId.toString(), props.kind, props.name, props.namespace]);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (items.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No timeline activity found for this {props.kind.toLowerCase()} in the
        last 24 hours. Spec changes, deletions, and Kubernetes events will
        appear here.
      </div>
    );
  }

  const specChangeCount: number = items.filter((item: TimelineItemRow) => {
    return item.source === "SpecChange" || item.source === "Deleted";
  }).length;
  const eventCount: number = items.length - specChangeCount;

  const columns: Columns<TimelineItemRow> = [
    {
      title: "Time",
      type: FieldType.Text,
      key: "relativeTime",
      tooltipText: (item: TimelineItemRow): string => {
        return item.timestamp;
      },
    },
    {
      title: "Source",
      type: FieldType.Element,
      key: "source",
      getElement: (item: TimelineItemRow): ReactElement => {
        if (item.source === "SpecChange") {
          return (
            <StatusBadge text="Spec change" type={StatusBadgeType.Info} />
          );
        }
        if (item.source === "Deleted") {
          return <StatusBadge text="Deleted" type={StatusBadgeType.Danger} />;
        }
        const isWarning: boolean =
          item.eventType.toLowerCase() === "warning";
        return (
          <StatusBadge
            text={isWarning ? "Warning event" : "Event"}
            type={
              isWarning ? StatusBadgeType.Warning : StatusBadgeType.Success
            }
          />
        );
      },
    },
    {
      title: "Title",
      type: FieldType.Element,
      key: "title",
      getElement: (item: TimelineItemRow): ReactElement => {
        return <span className="font-medium text-gray-900">{item.title}</span>;
      },
    },
    {
      title: "Message",
      type: FieldType.Element,
      key: "message",
      getElement: (item: TimelineItemRow): ReactElement => {
        return (
          <TimelineMessage
            message={item.message}
            changedFields={item.changedFields}
          />
        );
      },
    },
  ];

  return (
    <div>
      {/* Summary */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200">
        <div className="text-sm text-gray-600">
          <span className="font-medium">{items.length}</span> timeline items in
          the last 24 hours
          {specChangeCount > 0 && (
            <span>
              {" "}
              (
              <span className="text-indigo-700 font-medium">
                {specChangeCount}
              </span>{" "}
              change{specChangeCount !== 1 ? "s" : ""},{" "}
              <span className="text-gray-700 font-medium">{eventCount}</span>{" "}
              event{eventCount !== 1 ? "s" : ""})
            </span>
          )}
        </div>
      </div>

      <LocalTable<TimelineItemRow>
        id="kubernetes-workload-timeline-table"
        data={items}
        columns={columns}
        singularLabel="Timeline Item"
        pluralLabel="Timeline Items"
      />
    </div>
  );
};

export default KubernetesWorkloadTimelineTab;
