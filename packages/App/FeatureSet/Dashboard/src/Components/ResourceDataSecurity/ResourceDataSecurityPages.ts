import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { DataStoreResourceKind } from "Common/Types/DataSecurity/DataStoreResource";
import ObjectID from "Common/Types/ObjectID";

/*
 * DATA SECURITY ON A RESOURCE'S OWN PAGES (#9547, #9555): the two pages a
 * resource that holds data stores has under its Security section - Data
 * Security (its stores, and what to fix on them) and Compliance (how they
 * stand against each framework, and what is turned off for it) - and the
 * words each page says about the resource.
 *
 * Kept free of React, so the routes and words are pinned in a plain test.
 */

/*
 * Marks an English sentence as a key of the Dashboard's locales, as
 * Common/UI/Utils/TranslateTemplate's translationKey does. Each is looked
 * up where it is drawn.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

export interface ResourceDataSecurityPageKeys {
  dataSecurity: PageMap;
  compliance: PageMap;
}

/*
 * Each kind of resource a data store can belong to, and its two pages:
 * every kind has them, so a database's notice can always link to the
 * cluster or container host whose switches it follows.
 */
export const RESOURCE_DATA_SECURITY_PAGES: Readonly<
  Record<DataStoreResourceKind, ResourceDataSecurityPageKeys>
> = {
  [DataStoreResourceKind.KubernetesCluster]: {
    dataSecurity: PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY,
    compliance: PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE,
  },
  [DataStoreResourceKind.DockerHost]: {
    dataSecurity: PageMap.DOCKER_HOST_VIEW_DATA_SECURITY,
    compliance: PageMap.DOCKER_HOST_VIEW_COMPLIANCE,
  },
  [DataStoreResourceKind.PodmanHost]: {
    dataSecurity: PageMap.PODMAN_HOST_VIEW_DATA_SECURITY,
    compliance: PageMap.PODMAN_HOST_VIEW_COMPLIANCE,
  },
  [DataStoreResourceKind.DatabaseServer]: {
    dataSecurity: PageMap.DATABASE_SERVER_VIEW_DATA_SECURITY,
    compliance: PageMap.DATABASE_SERVER_VIEW_COMPLIANCE,
  },
  [DataStoreResourceKind.CloudResource]: {
    dataSecurity: PageMap.CLOUD_RESOURCE_VIEW_DATA_SECURITY,
    compliance: PageMap.CLOUD_RESOURCE_VIEW_COMPLIANCE,
  },
  [DataStoreResourceKind.Service]: {
    dataSecurity: PageMap.SERVICE_VIEW_DATA_SECURITY,
    compliance: PageMap.SERVICE_VIEW_COMPLIANCE,
  },
};

function routeOf(page: PageMap, id: ObjectID | string): Route | null {
  const route: Route | undefined = RouteMap[page];

  if (!route || !ObjectID.isValidUUID(id.toString())) {
    return null;
  }

  return RouteUtil.populateRouteParams(route, {
    modelId: new ObjectID(id.toString()),
  });
}

// A resource's Data Security page, or null for an id that is not one.
export function getResourceDataSecurityRoute(
  kind: DataStoreResourceKind,
  id: ObjectID | string,
): Route | null {
  const pages: ResourceDataSecurityPageKeys | undefined =
    RESOURCE_DATA_SECURITY_PAGES[kind];

  return pages ? routeOf(pages.dataSecurity, id) : null;
}

// A resource's Compliance page, or null for an id that is not one.
export function getResourceComplianceRoute(
  kind: DataStoreResourceKind,
  id: ObjectID | string,
): Route | null {
  const pages: ResourceDataSecurityPageKeys | undefined =
    RESOURCE_DATA_SECURITY_PAGES[kind];

  return pages ? routeOf(pages.compliance, id) : null;
}

// What each page says the resource's stores are.
export const RESOURCE_DATA_STORES_DESCRIPTIONS: Readonly<
  Record<DataStoreResourceKind, string>
> = {
  [DataStoreResourceKind.KubernetesCluster]: translationKey(
    "The databases running on this cluster, as Data Security reads them: the sensitive data they hold and how exposed they are.",
  ),
  [DataStoreResourceKind.DockerHost]: translationKey(
    "The databases running on this host, as Data Security reads them: the sensitive data they hold and how exposed they are.",
  ),
  [DataStoreResourceKind.PodmanHost]: translationKey(
    "The databases running on this host, as Data Security reads them: the sensitive data they hold and how exposed they are.",
  ),
  [DataStoreResourceKind.DatabaseServer]: translationKey(
    "This database, as Data Security reads it: the sensitive data it holds and how exposed it is.",
  ),
  [DataStoreResourceKind.CloudResource]: translationKey(
    "This resource, as Data Security reads it: the sensitive data it holds and how exposed it is.",
  ),
  [DataStoreResourceKind.Service]: translationKey(
    "This service's telemetry, as Data Security reads it: the sensitive data its logs, traces and exceptions hold.",
  ),
};

// What a resource with no store yet is told, by its kind.
export const RESOURCE_NO_DATA_STORES_DESCRIPTIONS: Readonly<
  Record<DataStoreResourceKind, string>
> = {
  [DataStoreResourceKind.KubernetesCluster]: translationKey(
    "A database running on this cluster appears here once the Database product finds it.",
  ),
  [DataStoreResourceKind.DockerHost]: translationKey(
    "A database running on this host appears here once the Database product finds it.",
  ),
  [DataStoreResourceKind.PodmanHost]: translationKey(
    "A database running on this host appears here once the Database product finds it.",
  ),
  [DataStoreResourceKind.DatabaseServer]: translationKey(
    "This database appears here once Data Security has read it.",
  ),
  [DataStoreResourceKind.CloudResource]: translationKey(
    "This resource appears here once a cloud connection with Data Security turned on has read it.",
  ),
  [DataStoreResourceKind.Service]: translationKey(
    "This service's telemetry appears here once Data Security has scanned it.",
  ),
};

// The Compliance card's description, by the kind of resource.
export const RESOURCE_COMPLIANCE_DESCRIPTIONS: Readonly<
  Record<DataStoreResourceKind, string>
> = {
  [DataStoreResourceKind.KubernetesCluster]: translationKey(
    "How the databases on this cluster stand against each framework, from their open issues. Turn off what does not apply to this cluster.",
  ),
  [DataStoreResourceKind.DockerHost]: translationKey(
    "How the databases on this host stand against each framework, from their open issues. Turn off what does not apply to this host.",
  ),
  [DataStoreResourceKind.PodmanHost]: translationKey(
    "How the databases on this host stand against each framework, from their open issues. Turn off what does not apply to this host.",
  ),
  [DataStoreResourceKind.DatabaseServer]: translationKey(
    "How this database stands against each framework, from its open issues. Turn off what does not apply to it.",
  ),
  [DataStoreResourceKind.CloudResource]: translationKey(
    "How this resource stands against each framework, from its open issues. Turn off what does not apply to it.",
  ),
  [DataStoreResourceKind.Service]: translationKey(
    "How this service's telemetry stands against each framework, from its open issues. Turn off what does not apply to it.",
  ),
};

/*
 * A kind of resource, as a label: what the project's Compliance page names
 * a resource by when the reader may not read its name (#9629).
 */
export const RESOURCE_KIND_LABELS: Readonly<
  Record<DataStoreResourceKind, string>
> = {
  [DataStoreResourceKind.KubernetesCluster]:
    translationKey("Kubernetes Cluster"),
  [DataStoreResourceKind.DockerHost]: translationKey("Docker Host"),
  [DataStoreResourceKind.PodmanHost]: translationKey("Podman Host"),
  [DataStoreResourceKind.DatabaseServer]: translationKey("Database"),
  [DataStoreResourceKind.CloudResource]: translationKey("Cloud Resource"),
  [DataStoreResourceKind.Service]: translationKey("Service"),
};
