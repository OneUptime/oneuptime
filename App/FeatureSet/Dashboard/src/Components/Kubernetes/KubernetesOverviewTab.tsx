import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import DictionaryOfStringsViewer from "Common/UI/Components/Dictionary/DictionaryOfStingsViewer";
import { KubernetesCondition } from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConditionsTable, {
  type Condition,
} from "Common/UI/Components/ConditionsTable/ConditionsTable";
import ObjectID from "Common/Types/ObjectID";
import KubernetesResourceLink from "./KubernetesResourceLink";

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
  modelId?: ObjectID | undefined;
  isLoading: boolean;
  emptyMessage?: string | undefined;
}

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

  // Convert KubernetesCondition[] to generic Condition[] for ConditionsTable
  const conditions: Array<Condition> | undefined = props.conditions?.map(
    (c: KubernetesCondition): Condition => {
      return {
        type: c.type,
        status: c.status,
        reason: c.reason,
        message: c.message,
        lastTransitionTime: c.lastTransitionTime,
      };
    },
  );

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
                    {props.modelId ? (
                      <KubernetesResourceLink
                        modelId={props.modelId}
                        resourceKind={ref.kind}
                        resourceName={ref.name}
                      />
                    ) : (
                      <span className="text-gray-600">{ref.name}</span>
                    )}
                  </div>
                );
              },
            )}
          </div>
        </Card>
      )}

      {/* Conditions */}
      {conditions && conditions.length > 0 && (
        <Card
          title="Conditions"
          description="Current status conditions of this resource."
        >
          <ConditionsTable conditions={conditions} />
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
