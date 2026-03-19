import React, { FunctionComponent, ReactElement, useState } from "react";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import DictionaryOfStringsViewer from "Common/UI/Components/Dictionary/DictionaryOfStingsViewer";
import { KubernetesCondition } from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";
import PageLoader from "Common/UI/Components/Loader/PageLoader";

// Conditions where "True" means something is wrong
const negativeConditionTypes: Array<string> = [
  "MemoryPressure",
  "DiskPressure",
  "PIDPressure",
  "NetworkUnavailable",
];

function isConditionBad(condition: KubernetesCondition): boolean {
  const isNegativeType: boolean = negativeConditionTypes.includes(
    condition.type,
  );
  if (isNegativeType) {
    return condition.status === "True";
  }
  // For positive conditions (Ready, Initialized, etc.), False is bad
  return condition.status === "False";
}

function getConditionStatusColor(condition: KubernetesCondition): string {
  const isNegativeType: boolean = negativeConditionTypes.includes(
    condition.type,
  );
  if (condition.status === "True") {
    return isNegativeType
      ? "bg-red-100 text-red-800"
      : "bg-green-100 text-green-800";
  }
  if (condition.status === "False") {
    return isNegativeType
      ? "bg-green-100 text-green-800"
      : "bg-red-100 text-red-800";
  }
  return "bg-yellow-100 text-yellow-800";
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

export interface SummaryField {
  title: string;
  value: string | ReactElement;
}

export interface ComponentProps {
  summaryFields: Array<SummaryField>;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  conditions?: Array<KubernetesCondition> | undefined;
  ownerReferences?: Array<{ kind: string; name: string }> | undefined;
  isLoading: boolean;
  emptyMessage?: string | undefined;
}

const ExpandableMessage: FunctionComponent<{ message: string }> = (
  msgProps: { message: string },
): ReactElement => {
  const [expanded, setExpanded] = useState<boolean>(false);
  const isLong: boolean = msgProps.message.length > 80;

  if (!msgProps.message || msgProps.message === "-") {
    return <span className="text-gray-400">-</span>;
  }

  if (!isLong) {
    return <span className="text-gray-600">{msgProps.message}</span>;
  }

  return (
    <div>
      <span className="text-gray-600">
        {expanded ? msgProps.message : msgProps.message.substring(0, 80) + "..."}
      </span>
      <button
        onClick={() => {
          setExpanded(!expanded);
        }}
        className="ml-1 text-xs text-indigo-600 hover:text-indigo-800"
      >
        {expanded ? "Less" : "More"}
      </button>
    </div>
  );
};

const KubernetesOverviewTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (
    props.summaryFields.length === 0 &&
    Object.keys(props.labels).length === 0
  ) {
    return (
      <div className="text-gray-500 text-sm p-4">
        {props.emptyMessage ||
          "Resource details not yet available. Ensure the kubernetes-agent Helm chart has resourceSpecs.enabled set to true and wait for the next data pull (up to 5 minutes)."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Info Cards */}
      {props.summaryFields.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {props.summaryFields.map((field: SummaryField, index: number) => {
            return (
              <InfoCard key={index} title={field.title} value={field.value} />
            );
          })}
        </div>
      )}

      {/* Owner References */}
      {props.ownerReferences && props.ownerReferences.length > 0 && (
        <Card
          title="Owner References"
          description="Resources that own this object."
        >
          <div className="space-y-1">
            {props.ownerReferences.map(
              (ref: { kind: string; name: string }, index: number) => {
                return (
                  <div key={index} className="text-sm">
                    <span className="font-medium text-gray-700">
                      {ref.kind}:
                    </span>{" "}
                    <span className="text-gray-600">{ref.name}</span>
                  </div>
                );
              },
            )}
          </div>
        </Card>
      )}

      {/* Conditions */}
      {props.conditions && props.conditions.length > 0 && (
        <Card
          title="Conditions"
          description="Current status conditions of this resource."
        >
          <div className="overflow-x-auto">
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
                {props.conditions.map(
                  (condition: KubernetesCondition, index: number) => {
                    const isBad: boolean = isConditionBad(condition);
                    return (
                      <tr
                        key={index}
                        className={isBad ? "bg-red-50" : ""}
                      >
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                          {condition.type}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">
                          <span
                            className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${getConditionStatusColor(condition)}`}
                          >
                            {condition.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                          {condition.reason || "-"}
                        </td>
                        <td className="px-4 py-3 text-sm max-w-md">
                          <ExpandableMessage
                            message={condition.message || "-"}
                          />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                          <span
                            title={condition.lastTransitionTime || ""}
                          >
                            {formatRelativeTime(
                              condition.lastTransitionTime,
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  },
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Labels */}
      {Object.keys(props.labels).length > 0 && (
        <Card
          title="Labels"
          description="Key-value labels attached to this resource."
        >
          <DictionaryOfStringsViewer value={props.labels} />
        </Card>
      )}

      {/* Annotations */}
      {Object.keys(props.annotations).length > 0 && (
        <Card
          title="Annotations"
          description="Metadata annotations on this resource."
        >
          <DictionaryOfStringsViewer value={props.annotations} />
        </Card>
      )}
    </div>
  );
};

export default KubernetesOverviewTab;
