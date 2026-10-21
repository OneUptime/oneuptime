import EntityType from "Common/Types/Telemetry/EntityType";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import { getInventoryTypeLabel } from "./InventoryTypeCatalog";
import {
  CreateFromRecordAddress,
  CreateFromRecordKind,
} from "../CreateFromRecord/CreateFromRecord";
import {
  getGlobalTranslator,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * How an inventory item reaches the incidents, alerts and maintenance windows
 * that concern it.
 *
 * It does not own any of them. Incident, Alert and ScheduledMaintenance each
 * already relate to Service, Host and KubernetesCluster, and an inventory item
 * that mirrors one of those carries a pointer to it — `resourceType` +
 * `resourceId`, stamped at reconcile time, or resolvable by natural identity.
 * So the item's Incidents tab is that resource's incidents, read through the
 * pointer.
 *
 * The alternative was a set of `Incident.inventoryItems` join tables. That
 * would let a pod or a vendor API be named directly, at the price of two ways
 * to attach the same incident to the same real thing — the item mirroring a
 * Service, and the Service — which can then disagree. One source of truth is
 * worth the narrower reach.
 *
 * The narrower reach is real and must be visible rather than silent: an item
 * with no typed row (a pod, a container, a hand-registered vendor API) has no
 * incidents of its own, and the page says which resource to look at instead
 * rather than rendering an empty table.
 */

/**
 * The typed resources an inventory item can point at that also carry
 * incidents, alerts and scheduled maintenance.
 */
export enum LinkedResourceKind {
  Service = "Service",
  Host = "Host",
  KubernetesCluster = "KubernetesCluster",
}

export interface LinkedResource {
  kind: LinkedResourceKind;
  id: ObjectID;
}

/**
 * The relation each kind is named by on Incident / Alert /
 * ScheduledMaintenance. All three models declare the same three relations, so
 * one map serves all of them.
 */
const QUERY_FIELD: Record<LinkedResourceKind, string> = {
  [LinkedResourceKind.Service]: "services",
  [LinkedResourceKind.Host]: "hosts",
  [LinkedResourceKind.KubernetesCluster]: "kubernetesClusters",
};

/*
 * The record an item's tabs create from: the typed row it points at, which
 * is what a new incident, alert or maintenance event names - an inventory
 * item itself is on none of them. So Declare Incident on a host's item opens
 * with the host picked, and the breadcrumbs go back through the host.
 */
const CREATE_FROM_RECORD_KIND: Record<
  LinkedResourceKind,
  CreateFromRecordKind
> = {
  [LinkedResourceKind.Service]: CreateFromRecordKind.Service,
  [LinkedResourceKind.Host]: CreateFromRecordKind.Host,
  [LinkedResourceKind.KubernetesCluster]:
    CreateFromRecordKind.KubernetesCluster,
};

export type GetCreateFromRecordForLinkedResourceFunction = (
  resource: LinkedResource,
) => CreateFromRecordAddress;

export const getCreateFromRecordForLinkedResource: GetCreateFromRecordForLinkedResourceFunction =
  (resource: LinkedResource): CreateFromRecordAddress => {
    return {
      kind: CREATE_FROM_RECORD_KIND[resource.kind],
      id: resource.id,
    };
  };

export type GetLinkedResourceQueryFieldFunction = (
  kind: LinkedResourceKind,
) => string;

export const getLinkedResourceQueryField: GetLinkedResourceQueryFieldFunction =
  (kind: LinkedResourceKind): string => {
    return QUERY_FIELD[kind];
  };

export type BuildLinkedResourceQueryFunction = (
  resource: LinkedResource,
) => Record<string, Includes>;

/**
 * The query fragment that selects the incidents / alerts / maintenance
 * windows for a linked resource, merged into the table's project-scoped base
 * query.
 */
export const buildLinkedResourceQuery: BuildLinkedResourceQueryFunction = (
  resource: LinkedResource,
): Record<string, Includes> => {
  return {
    [getLinkedResourceQueryField(resource.kind)]: new Includes([resource.id]),
  };
};

/*
 * Which entity types can point at a typed row at all. Deliberately an explicit
 * map rather than "whatever resourceType happens to say": the page decides
 * what to tell a user *before* it has resolved anything, and telling someone
 * with a pod open to go and look for a Host page that will never exist is
 * worse than saying nothing.
 */
const KIND_FOR_ENTITY_TYPE: Partial<Record<EntityType, LinkedResourceKind>> = {
  [EntityType.Service]: LinkedResourceKind.Service,
  [EntityType.Host]: LinkedResourceKind.Host,
  [EntityType.KubernetesCluster]: LinkedResourceKind.KubernetesCluster,
};

export type GetLinkedResourceKindFunction = (
  entityType: string | undefined,
) => LinkedResourceKind | null;

export const getLinkedResourceKindForEntityType: GetLinkedResourceKindFunction =
  (entityType: string | undefined): LinkedResourceKind | null => {
    if (!entityType) {
      return null;
    }

    return KIND_FOR_ENTITY_TYPE[entityType as EntityType] || null;
  };

export type CanHaveLinkedResourceFunction = (
  entityType: string | undefined,
) => boolean;

export const canHaveLinkedResource: CanHaveLinkedResourceFunction = (
  entityType: string | undefined,
): boolean => {
  return getLinkedResourceKindForEntityType(entityType) !== null;
};

/*
 * The signals an item's linked page can be about, as its sentences name them.
 * Listed so the extraction finds each; they go into the sentences as terms.
 */
export const INVENTORY_LINKED_SIGNALS: ReadonlyArray<string> = [
  translationKey("incidents"),
  translationKey("alerts"),
  translationKey("maintenance windows"),
];

// "incidents are raised..." starts a sentence, so its first letter is a capital.
const capitalizeFirst: (text: string) => string = (text: string): string => {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
};

export type DescribeMissingLinkFunction = (
  entityType: string | undefined,
  signal: string,
  translator?: Translator,
) => string;

/**
 * What to tell someone looking at an item that can never have its own
 * incidents. `signal` is the plural noun for the page ("incidents",
 * "alerts", "maintenance windows").
 */
export const describeMissingLink: DescribeMissingLinkFunction = (
  entityType: string | undefined,
  signal: string,
  translator: Translator = getGlobalTranslator(),
): string => {
  const signalTerm: ReturnType<typeof translatableTerm> = translatableTerm(
    signal,
    { inSentence: true },
  );

  if (!entityType) {
    return capitalizeFirst(
      translator.translateTemplate(
        "{{signal}} are raised against services, hosts and Kubernetes clusters. This item does not carry its own — look at the service or host it belongs to, which you can find under Connections.",
        { signal: signalTerm },
      ),
    );
  }

  return capitalizeFirst(
    translator.translateTemplate(
      "{{signal}} are raised against services, hosts and Kubernetes clusters. A {{type}} does not carry its own — look at the service or host it belongs to, which you can find under Connections.",
      {
        signal: signalTerm,
        type: translatableTerm(getInventoryTypeLabel(entityType)),
      },
    ),
  );
};
