import React, { FunctionComponent, ReactElement } from "react";
import ExpandableText from "../ExpandableText/ExpandableText";

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

function isConditionBad(
  condition: Condition,
  negativeTypes: Array<string>,
): boolean {
  if (negativeTypes.includes(condition.type)) {
    return condition.status === "True";
  }
  return condition.status === "False";
}

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

  if (props.conditions.length === 0) {
    return (
      <div className="text-gray-500 text-sm p-4">
        No conditions available.
      </div>
    );
  }

  return (
    <div className={`overflow-x-auto ${props.className || ""}`}>
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Type
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Status
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Reason
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Message
            </th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
              Last Transition
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {props.conditions.map((condition: Condition, index: number) => {
            const isBad: boolean = isConditionBad(condition, negativeTypes);
            return (
              <tr key={index} className={isBad ? "bg-red-50/50" : ""}>
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                  {condition.type}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm">
                  <span
                    className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getStatusStyle(condition, negativeTypes)}`}
                  >
                    {condition.status}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                  {condition.reason || "-"}
                </td>
                <td className="px-4 py-3 text-sm max-w-md">
                  <ExpandableText text={condition.message || "-"} />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                  <span title={condition.lastTransitionTime || ""}>
                    {formatRelativeTime(condition.lastTransitionTime || "")}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ConditionsTable;
