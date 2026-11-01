import React, { FunctionComponent, ReactElement } from "react";
import ResourceOverviewTab, {
  OwnerReference,
  ResourceOverviewDetailsCard,
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
  // The namespace of the object these owners own, which is theirs too.
  namespace?: string | undefined;
  modelId?: ObjectID | undefined;
  isLoading: boolean;
  emptyMessage?: string | undefined;
  /*
   * The summary fields as one Details card, on a page whose hero already
   * says what the object is and how it is doing (KubernetesPartHero).
   */
  detailsCard?: ResourceOverviewDetailsCard | undefined;
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
                /*
                 * An owner lives in its object's namespace; the link keeps it
                 * for every namespaced kind (KubernetesResourceLink).
                 */
                <KubernetesResourceLink
                  modelId={modelId}
                  resourceKind={ref.kind}
                  resourceName={ref.name}
                  namespace={props.namespace}
                />
              );
            }
          : undefined
      }
      isLoading={props.isLoading}
      detailsCard={props.detailsCard}
      emptyMessage={
        props.emptyMessage ||
        "No resource details yet. Set resourceSpecs.enabled to true in the kubernetes-agent Helm chart and wait up to 5 minutes."
      }
    />
  );
};

export default KubernetesOverviewTab;
