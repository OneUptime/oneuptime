import React, { FunctionComponent, ReactElement } from "react";
import ResourceOverviewTab, {
  OwnerReference,
  SummaryField,
} from "../Infrastructure/ResourceOverviewTab";
import { KubernetesCondition } from "../../Pages/Kubernetes/Utils/KubernetesObjectParser";
import { type Condition } from "Common/UI/Components/ConditionsTable/ConditionsTable";
import ObjectID from "Common/Types/ObjectID";
import KubernetesResourceLink from "./KubernetesResourceLink";

/*
 * Thin Kubernetes wrapper around the shared infrastructure
 * ResourceOverviewTab (Components/Infrastructure/ResourceOverviewTab.tsx).
 * Keeps the original public API (KubernetesCondition conditions,
 * modelId-driven owner-reference links, the kubernetes-agent empty
 * message) so existing Kubernetes detail pages compile unchanged.
 */

export type { SummaryField };

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

  const modelId: ObjectID | undefined = props.modelId;

  return (
    <ResourceOverviewTab
      summaryFields={props.summaryFields}
      labels={props.labels}
      annotations={props.annotations}
      conditions={conditions}
      ownerReferences={props.ownerReferences}
      renderOwnerReference={
        modelId
          ? (ref: OwnerReference): ReactElement => {
              return (
                <KubernetesResourceLink
                  modelId={modelId}
                  resourceKind={ref.kind}
                  resourceName={ref.name}
                />
              );
            }
          : undefined
      }
      isLoading={props.isLoading}
      emptyMessage={
        props.emptyMessage ||
        "No resource details yet. Set resourceSpecs.enabled to true in the kubernetes-agent Helm chart and wait up to 5 minutes."
      }
    />
  );
};

export default KubernetesOverviewTab;
