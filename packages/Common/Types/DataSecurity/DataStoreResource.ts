/*
 * THE RESOURCES A DATA STORE BELONGS TO (#9547, #9555).
 *
 * Data Security finds every store from somewhere OneUptime already knows of
 * it (DataSecurityDiscovery): a cloud resource (an S3 bucket, an RDS
 * instance), a database the Database product monitors, or a service's
 * telemetry. A monitored database can itself run on a Kubernetes cluster, a
 * Docker host or a Podman host (DatabaseServer.kubernetesClusterId,
 * dockerHostId, podmanHostId). So a store belongs to resources people
 * already open, and their pages show what Data Security says about it:
 *
 *   - a Kubernetes cluster, a Docker host or a Podman host: the stores of
 *     the databases running on it;
 *   - a database: its own store;
 *   - a cloud resource: the store it is;
 *   - a service: its telemetry - the logs, traces, exceptions, replays and
 *     AI conversations it sends.
 *
 * A host has none: no database, bucket or telemetry stream records the host
 * it runs on, and a guess from an address would put a store on the wrong
 * machine's page.
 *
 * Compliance is scoped on one of a store's resources, its compliance owner:
 * the cluster or host its database runs on, else the database itself, the
 * cloud resource, or the service. A store has at most one, so a framework a
 * resource turns off is off for exactly that resource's stores - on its own
 * page and on the project's Compliance page - and two resources never
 * disagree about one store. A store found only on the service map, or added
 * by hand, belongs to no resource and is scoped by the project alone.
 *
 * Pure: the server, the Dashboard and their tests read it.
 */

export enum DataStoreResourceKind {
  KubernetesCluster = "KubernetesCluster",
  DockerHost = "DockerHost",
  PodmanHost = "PodmanHost",
  DatabaseServer = "DatabaseServer",
  CloudResource = "CloudResource",
  Service = "Service",
}

export const ALL_DATA_STORE_RESOURCE_KINDS: ReadonlyArray<DataStoreResourceKind> =
  [
    DataStoreResourceKind.KubernetesCluster,
    DataStoreResourceKind.DockerHost,
    DataStoreResourceKind.PodmanHost,
    DataStoreResourceKind.DatabaseServer,
    DataStoreResourceKind.CloudResource,
    DataStoreResourceKind.Service,
  ];

/*
 * The resources a database runs on, whose pages show its store: the
 * platforms the Database product records a database as a workload of.
 */
export const DATABASE_PLATFORM_KINDS: ReadonlyArray<DataStoreResourceKind> = [
  DataStoreResourceKind.KubernetesCluster,
  DataStoreResourceKind.DockerHost,
  DataStoreResourceKind.PodmanHost,
];

export function isDataStoreResourceKind(
  value: unknown,
): value is DataStoreResourceKind {
  return (
    typeof value === "string" &&
    (ALL_DATA_STORE_RESOURCE_KINDS as ReadonlyArray<string>).includes(value)
  );
}

export interface DataStoreResourceRef {
  kind: DataStoreResourceKind;
  id: string;
}

// Where a monitored database runs, as the Database product records it.
export interface DatabaseServerPlacementInput {
  kubernetesClusterId?: string | null | undefined;
  dockerHostId?: string | null | undefined;
  podmanHostId?: string | null | undefined;
}

// What a store says about where it came from.
export interface DataStorePlacementInput {
  cloudResourceId?: string | null | undefined;
  serviceId?: string | null | undefined;
  databaseServerId?: string | null | undefined;
  // The database's own placement, when the store is a monitored database.
  databaseServer?: DatabaseServerPlacementInput | null | undefined;
}

function readId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

// The platform a database runs on: its cluster, else its Docker or Podman host.
export function getDatabasePlatform(
  placement: DatabaseServerPlacementInput | null | undefined,
): DataStoreResourceRef | null {
  if (!placement) {
    return null;
  }

  const clusterId: string = readId(placement.kubernetesClusterId);

  if (clusterId) {
    return { kind: DataStoreResourceKind.KubernetesCluster, id: clusterId };
  }

  const dockerHostId: string = readId(placement.dockerHostId);

  if (dockerHostId) {
    return { kind: DataStoreResourceKind.DockerHost, id: dockerHostId };
  }

  const podmanHostId: string = readId(placement.podmanHostId);

  if (podmanHostId) {
    return { kind: DataStoreResourceKind.PodmanHost, id: podmanHostId };
  }

  return null;
}

/*
 * Every resource whose pages show the store, the most specific first: a
 * cloud resource, a service, or a database and the platform it runs on.
 */
export function getDataStoreResources(
  store: DataStorePlacementInput,
): Array<DataStoreResourceRef> {
  const cloudResourceId: string = readId(store.cloudResourceId);

  if (cloudResourceId) {
    return [{ kind: DataStoreResourceKind.CloudResource, id: cloudResourceId }];
  }

  const serviceId: string = readId(store.serviceId);

  if (serviceId) {
    return [{ kind: DataStoreResourceKind.Service, id: serviceId }];
  }

  const databaseServerId: string = readId(store.databaseServerId);

  if (!databaseServerId) {
    return [];
  }

  const resources: Array<DataStoreResourceRef> = [
    { kind: DataStoreResourceKind.DatabaseServer, id: databaseServerId },
  ];
  const platform: DataStoreResourceRef | null = getDatabasePlatform(
    store.databaseServer,
  );

  if (platform) {
    resources.push(platform);
  }

  return resources;
}

/*
 * The one resource a store's compliance is scoped on: the platform its
 * database runs on, else the store's own resource. Null for a store no
 * resource holds.
 */
export function getDataStoreComplianceOwner(
  store: DataStorePlacementInput,
): DataStoreResourceRef | null {
  const resources: Array<DataStoreResourceRef> = getDataStoreResources(store);

  return resources.length > 0 ? resources[resources.length - 1]! : null;
}

// One key per resource, the way the scoping and its tests name it.
export function getDataStoreResourceKey(ref: DataStoreResourceRef): string {
  return `${ref.kind}:${ref.id.trim().toLowerCase()}`;
}

export function isSameDataStoreResource(
  a: DataStoreResourceRef | null | undefined,
  b: DataStoreResourceRef | null | undefined,
): boolean {
  return Boolean(
    a && b && getDataStoreResourceKey(a) === getDataStoreResourceKey(b),
  );
}

// Whether the store is shown on the resource's pages.
export function doesDataStoreBelongTo(
  store: DataStorePlacementInput,
  resource: DataStoreResourceRef,
): boolean {
  return getDataStoreResources(store).some(
    (each: DataStoreResourceRef): boolean => {
      return isSameDataStoreResource(each, resource);
    },
  );
}
