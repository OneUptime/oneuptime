import React, { FunctionComponent, ReactElement } from "react";
import Card from "Common/UI/Components/Card/Card";
import InfoCard from "Common/UI/Components/InfoCard/InfoCard";
import DictionaryOfStringsViewer from "Common/UI/Components/Dictionary/DictionaryOfStingsViewer";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ConditionsTable, {
  type Condition,
} from "Common/UI/Components/ConditionsTable/ConditionsTable";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../ResourcePart/ResourcePartDetailsCard";

/*
 * Product-neutral overview tab for infrastructure resource detail
 * pages: a summary-field grid, optional owner references, an optional
 * conditions table, and labels / annotations dictionaries. Kubernetes
 * wraps it in Components/Kubernetes/KubernetesOverviewTab.tsx; Proxmox
 * and Ceph detail pages use it directly.
 *
 * A page whose part has a hero above its tabs (ResourcePartHero) - its
 * name, status and where it sits already said - draws its summary fields
 * as one Details card instead (detailsCard): each name over its value, as
 * every detail card in the product is, rather than a card per value. A
 * Kubernetes Deployment's ten facts were ten cards, one stacked under the
 * other on a phone; the Proxmox part pages draw theirs this way.
 */

export interface SummaryField {
  title: string;
  value: string | ReactElement;
  // What the value means, shown in an (i) tooltip beside the title.
  description?: string | undefined;
  // What the value's copy button copies, in a Details card; none without it.
  copyText?: string | undefined;
}

export interface OwnerReference {
  kind: string;
  name: string;
}

// The summary fields as one Details card (ResourcePartDetailsCard).
export interface ResourceOverviewDetailsCard {
  testId: string;
  // Defaults to "Details".
  title?: string | undefined;
  description: string;
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
  detailsCard?: ResourceOverviewDetailsCard | undefined;
}

// What a field's title is not made of, in its row's key ("Pod IP" -> "pod-ip").
const NOT_A_KEY_CHARACTER: RegExp = /[^a-z0-9]+/g;

export function getSummaryFieldKey(title: string): string {
  return title.toLowerCase().replace(NOT_A_KEY_CHARACTER, "-");
}

const ResourceOverviewTab: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  if (props.isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (
    props.summaryFields.length === 0 &&
    Object.keys(props.labels).length === 0
  ) {
    return (
      <div className="text-gray-500 text-sm p-4">
        {translator.translateText(
          props.emptyMessage || "Resource details not yet available.",
        )}
      </div>
    );
  }

  const ownerReferences: Array<OwnerReference> = props.ownerReferences || [];

  const renderOwner: (ref: OwnerReference) => ReactElement = (
    ref: OwnerReference,
  ): ReactElement => {
    return props.renderOwnerReference ? (
      props.renderOwnerReference(ref)
    ) : (
      <span className="text-gray-600">{ref.name}</span>
    );
  };

  const otherCards: ReactElement = (
    <>
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
    </>
  );

  if (props.detailsCard) {
    const rows: Array<ResourcePartDetailRow> = props.summaryFields.map(
      (field: SummaryField): ResourcePartDetailRow => {
        return {
          key: getSummaryFieldKey(field.title),
          label: field.title,
          value: field.value,
          description: field.description,
          copyText: field.copyText,
        };
      },
    );

    // What owns it, as kubectl describe says it: a row of the card.
    if (ownerReferences.length > 0) {
      rows.push({
        key: "owner-references",
        label: "Owner References",
        value: (
          <div className="space-y-1">
            {ownerReferences.map((ref: OwnerReference, index: number) => {
              return (
                <div key={index}>
                  <span className="text-gray-500">
                    <bdi>{ref.kind}</bdi>
                  </span>{" "}
                  {renderOwner(ref)}
                </div>
              );
            })}
          </div>
        ),
      });
    }

    return (
      <div>
        <ResourcePartDetailsCard
          testId={props.detailsCard.testId}
          title={props.detailsCard.title}
          description={props.detailsCard.description}
          rows={rows}
        />
        <div className="space-y-6">{otherCards}</div>
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
              <InfoCard
                key={index}
                title={field.title}
                value={field.value}
                tooltip={field.description}
              />
            );
          })}
        </div>
      )}

      {/* Owner References */}
      {ownerReferences.length > 0 && (
        <Card
          title="Owner References"
          description="Resources that own this object."
        >
          <div className="space-y-1">
            {ownerReferences.map((ref: OwnerReference, index: number) => {
              return (
                <div key={index} className="text-sm">
                  <span className="font-medium text-gray-700">{ref.kind}:</span>{" "}
                  {renderOwner(ref)}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {otherCards}
    </div>
  );
};

export default ResourceOverviewTab;
