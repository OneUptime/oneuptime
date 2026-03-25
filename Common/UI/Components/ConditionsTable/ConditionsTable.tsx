import React, { FunctionComponent, ReactElement } from "react";
import ExpandableText from "../ExpandableText/ExpandableText";
import Table from "../Table/Table";
import FieldType from "../Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";

export interface Condition {
  type: string;
  status: string;
  reason?: string | undefined;
  message?: string | undefined;
  lastTransitionTime?: string | undefined;
}

export interface ComponentProps {
  conditions: Array<Condition>;
  negativeTypes?: Array<string> | undefined;
  className?: string | undefined;
}

// Default condition types where "True" is bad
const defaultNegativeTypes: Array<string> = [
  "MemoryPressure",
  "DiskPressure",
  "PIDPressure",
  "NetworkUnavailable",
];

function getStatusStyle(
  condition: Condition,
  negativeTypes: Array<string>,
): string {
  const isNegativeType: boolean = negativeTypes.includes(condition.type);
  if (condition.status === "True") {
    return isNegativeType
      ? "bg-gradient-to-r from-red-50 to-red-100 text-red-800 ring-1 ring-inset ring-red-200/80"
      : "bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200/80";
  }
  if (condition.status === "False") {
    return isNegativeType
      ? "bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200/80"
      : "bg-gradient-to-r from-red-50 to-red-100 text-red-800 ring-1 ring-inset ring-red-200/80";
  }
  return "bg-gradient-to-r from-amber-50 to-amber-100 text-amber-800 ring-1 ring-inset ring-amber-200/80";
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

const ConditionsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const negativeTypes: Array<string> =
    props.negativeTypes || defaultNegativeTypes;

  return (
    <div className={props.className || ""}>
      <Table<Condition>
        id="conditions-table"
        data={props.conditions}
        singularLabel="Condition"
        pluralLabel="Conditions"
        isLoading={false}
        error=""
        currentPageNumber={1}
        totalItemsCount={props.conditions.length}
        itemsOnPage={props.conditions.length}
        disablePagination={true}
        noItemsMessage="No conditions available."
        onNavigateToPage={() => {}}
        sortBy={null}
        sortOrder={SortOrder.Ascending}
        onSortChanged={() => {}}
        columns={[
          {
            title: "Type",
            type: FieldType.Element,
            key: "type",
            disableSort: true,
            getElement: (condition: Condition): ReactElement => {
              return (
                <span className="font-medium text-gray-900">
                  {condition.type}
                </span>
              );
            },
          },
          {
            title: "Status",
            type: FieldType.Element,
            key: "status",
            disableSort: true,
            getElement: (condition: Condition): ReactElement => {
              return (
                <span
                  className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusStyle(condition, negativeTypes)}`}
                >
                  {condition.status}
                </span>
              );
            },
          },
          {
            title: "Reason",
            type: FieldType.Element,
            key: "reason",
            disableSort: true,
            getElement: (condition: Condition): ReactElement => {
              return (
                <span className="text-gray-600">
                  {condition.reason || "-"}
                </span>
              );
            },
          },
          {
            title: "Message",
            type: FieldType.Element,
            key: "message",
            disableSort: true,
            getElement: (condition: Condition): ReactElement => {
              return <ExpandableText text={condition.message || "-"} />;
            },
          },
          {
            title: "Last Transition",
            type: FieldType.Element,
            key: "lastTransitionTime",
            disableSort: true,
            getElement: (condition: Condition): ReactElement => {
              return (
                <span
                  className="text-gray-500"
                  title={condition.lastTransitionTime || ""}
                >
                  {formatRelativeTime(condition.lastTransitionTime || "")}
                </span>
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default ConditionsTable;
