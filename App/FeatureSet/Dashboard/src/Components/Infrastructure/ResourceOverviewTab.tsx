import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import DictionaryOfStringsViewer from "Common/UI/Components/Dictionary/DictionaryOfStingsViewer";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConditionsTable, {
  type Condition,
} from "Common/UI/Components/ConditionsTable/ConditionsTable";

/*
 * Product-neutral overview tab for infrastructure resource detail
 * pages: a summary-field grid, optional owner references, an optional
 * conditions table, and labels / annotations dictionaries. Kubernetes
 * wraps it in Components/Kubernetes/KubernetesOverviewTab.tsx; Proxmox
 * and Ceph detail pages use it directly.
 */

export interface SummaryField {
  title: string;
  value: string | ReactElement;
}

export interface OwnerReference {
  kind: string;
  name: string;
}

export interface ComponentProps {
  summaryFields: Array<SummaryField>;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  conditions?: Array<Condition> | undefined;
  ownerReferences?: Array<OwnerReference> | undefined;
  /*
   * Renders the owner-reference name (e.g. as a link to the owning
   * resource's detail page). Falls back to plain text when omitted.
   */
  renderOwnerReference?: ((ref: OwnerReference) => ReactElement) | undefined;
  isLoading: boolean;
  emptyMessage?: string | undefined;
}

const ResourceOverviewTab: FunctionComponent<ComponentProps> = (
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
        {props.emptyMessage || "Resource details not yet available."}
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
            {props.ownerReferences.map((ref: OwnerReference, index: number) => {
              return (
                <div key={index} className="text-sm">
                  <span className="font-medium text-gray-700">{ref.kind}:</span>{" "}
                  {props.renderOwnerReference ? (
                    props.renderOwnerReference(ref)
                  ) : (
                    <span className="text-gray-600">{ref.name}</span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Conditions */}
      {props.conditions && props.conditions.length > 0 && (
        <Card
          title="Conditions"
          description="Current status conditions of this resource."
        >
          <ConditionsTable conditions={props.conditions} />
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

export default ResourceOverviewTab;
