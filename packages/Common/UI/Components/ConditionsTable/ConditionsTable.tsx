import React, { FunctionComponent, ReactElement } from "react";
import { EMPTY_VALUE_MARK } from "../../../Types/EmptyValueMark";
import ExpandableText from "../ExpandableText/ExpandableText";
import Table from "../Table/Table";
import FieldType from "../Types/FieldType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import TableEmptyValue, { getValueOrQuietDash } from "../Table/TableEmptyValue";
import { getGlobalTranslator, Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import { formatCompactDurationAgo } from "../../../Utils/Milliseconds";

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

/*
 * How long ago a condition last changed: "12s ago", "5m ago", "3h ago", "2d
 * ago" in English, the reader's short units and digits in their language
 * ("vor 5 Min.", "۵ دقیقه پیش"; #8455).
 */
export function formatRelativeTime(
  timestamp: string,
  translator: Translator = getGlobalTranslator(),
  now: Date = new Date(),
): string {
  if (!timestamp) {
    return EMPTY_VALUE_MARK;
  }
  const date: Date = new Date(timestamp);
  const diffMs: number = now.getTime() - date.getTime();
  if (diffMs < 0) {
    return timestamp;
  }
  const diffSec: number = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return formatCompactDurationAgo(translator, { seconds: diffSec });
  }
  const diffMin: number = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return formatCompactDurationAgo(translator, { minutes: diffMin });
  }
  const diffHrs: number = Math.floor(diffMin / 60);
  if (diffHrs < 24) {
    return formatCompactDurationAgo(translator, { hours: diffHrs });
  }
  const diffDays: number = Math.floor(diffHrs / 24);
  return formatCompactDurationAgo(translator, { days: diffDays });
}

const ConditionsTable: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
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
                  {condition.reason || <TableEmptyValue />}
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
              return condition.message ? (
                <ExpandableText text={condition.message} />
              ) : (
                <TableEmptyValue />
              );
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
                  {getValueOrQuietDash(
                    formatRelativeTime(
                      condition.lastTransitionTime || "",
                      translator,
                    ),
                  )}
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
