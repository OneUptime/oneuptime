import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import AutoCreateBudget from "./AutoCreateBudget";
import logger from "Common/Server/Utils/Logger";
import DatabaseServerService, {
  UpsertWorkloadDatabaseData,
} from "Common/Server/Services/DatabaseServerService";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import KubernetesResourceService from "Common/Server/Services/KubernetesResourceService";
import KubernetesContainerService from "Common/Server/Services/KubernetesContainerService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import DockerResourceService from "Common/Server/Services/DockerResourceService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import PodmanResourceService from "Common/Server/Services/PodmanResourceService";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import DockerResource from "Common/Models/DatabaseModels/DockerResource";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import KubernetesContainer from "Common/Models/DatabaseModels/KubernetesContainer";
import KubernetesResource from "Common/Models/DatabaseModels/KubernetesResource";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import PodmanResource from "Common/Models/DatabaseModels/PodmanResource";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  ContainerDatabaseClassification,
  KubernetesDatabaseCandidate,
  KubernetesDatabaseGroup,
  KubernetesPodLike,
  classifyContainer,
  classifyKubernetesPod,
  groupKubernetesDatabaseCandidates,
} from "Common/Types/DatabaseServer/DatabaseContainerClassifier";
import {
  buildDatabaseServerDisplayName,
  buildKubernetesDatabaseAliases,
  buildWorkloadDatabaseServerIdentifier,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  keyForContainer,
  keyForKubernetesDeployment,
  keyForKubernetesPod,
} from "Common/Utils/Telemetry/EntityKey";

/*
 * ------------------------------------------------------------------
 * DatabaseServer:DiscoverContainerDatabases
 *
 * Runs every 5 minutes and turns the inventory the agents already
 * report into DatabaseServer rows:
 *
 *   - per CONNECTED Kubernetes cluster: its Pod rows are classified
 *     (operator / chart labels, then the container image), folded into
 *     one entry per database workload, and upserted by workload
 *     identity with the workload's Service DNS names as endpoint
 *     aliases and its pods (plus the Deployment, for one) as member
 *     keys, so pod logs and metrics show on the database's page;
 *   - per CONNECTED Docker / Podman host: its Container rows are
 *     classified by image and folded by compose service, with the
 *     container ids as member keys.
 *
 * Disconnected parents are skipped: their inventory is stale, and a
 * database that really went away is aged out by
 * DatabaseServer:CleanupStaleResources once nothing sees it.
 *
 * A database is always LOOKED UP first without permission to create
 * (see AutoCreateBudget); only a miss asks the project's auto-create
 * budget. Each parent is isolated — one cluster failing never costs
 * another its run — and every stage is capped, with a warning naming
 * what was skipped.
 *
 * Pod specs in the inventory keep direct env values verbatim,
 * passwords included. They are loaded (the spec column is one JSON
 * value) but immediately projected down to container name, image and
 * declared ports; env is never read, copied or logged.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "DatabaseServer:DiscoverContainerDatabases";

// Parents (clusters / hosts of each kind) visited per run.
export const MAX_PARENTS_PER_RUN: number = 1000;
// Pod rows classified per cluster per run.
export const MAX_PODS_PER_CLUSTER: number = 5000;
// StatefulSet rows read per cluster for their headless Service names.
export const MAX_STATEFULSETS_PER_CLUSTER: number = 2000;
// KubernetesContainer rows read per cluster to fill in missing images.
export const MAX_CONTAINER_ROWS_PER_CLUSTER: number = 10000;
// Container rows classified per Docker / Podman host per run.
export const MAX_CONTAINERS_PER_HOST: number = 2000;
// Database workloads upserted per parent per run.
export const MAX_DATABASES_PER_PARENT: number = 200;

// Docker / Podman states in which a container is not running anything.
const STOPPED_CONTAINER_STATES: ReadonlySet<string> = new Set<string>([
  "exited",
  "dead",
  "created",
]);

// A full Docker / Podman container id, as `container.id` reports it.
const FULL_CONTAINER_ID_REGEX: RegExp = /^[0-9a-f]{64}$/i;

type ContainerPlatform = "docker" | "podman";

interface DiscoveryStats {
  parents: number;
  failedParents: number;
  databases: number;
  created: number;
  overBudget: number;
}

// One container in a pod spec, reduced to what classification reads.
interface ProjectedContainer {
  name?: string | undefined;
  image?: string | undefined;
  ports?: Array<{ containerPort?: number | undefined }> | undefined;
}

export interface ContainerRowLike {
  name?: string | null | undefined;
  containerId?: string | null | undefined;
  imageName?: string | null | undefined;
  state?: string | null | undefined;
}

export interface ContainerDatabaseGroup {
  system: string;
  workloadName: string;
  containerNames: Array<string>;
  // Full (64-hex) container ids only — the form telemetry is keyed by.
  containerIds: Array<string>;
  version: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function podKey(namespace: string, podName: string): string {
  return `${namespace}\u0000${podName}`;
}

/*
 * Container name, image and declared ports — read property by property,
 * never by spreading or cloning the container, so `env` is never touched.
 */
function projectSpecContainers(spec: unknown): Array<ProjectedContainer> {
  const containers: unknown = isObject(spec) ? spec["containers"] : undefined;
  if (!Array.isArray(containers)) {
    return [];
  }

  const projected: Array<ProjectedContainer> = [];

  for (const container of containers) {
    if (!isObject(container)) {
      continue;
    }

    const name: unknown = container["name"];
    const image: unknown = container["image"];
    const declaredPorts: unknown = container["ports"];

    const ports: Array<{ containerPort?: number | undefined }> = [];
    if (Array.isArray(declaredPorts)) {
      for (const declared of declaredPorts) {
        const port: unknown = isObject(declared)
          ? declared["containerPort"]
          : undefined;
        // The classifier range-checks; a numeric string is accepted too.
        const value: number =
          typeof port === "number"
            ? port
            : typeof port === "string" && port.trim()
              ? Number(port)
              : NaN;
        if (Number.isInteger(value)) {
          ports.push({ containerPort: value });
        }
      }
    }

    projected.push({
      name: typeof name === "string" ? name : undefined,
      image: typeof image === "string" && image.trim() ? image : undefined,
      ports: ports,
    });
  }

  return projected;
}

function projectOwnerReferences(
  value: unknown,
): Array<{ kind?: string | undefined; name?: string | undefined }> {
  // Stored as { items: [...] }; a bare array is tolerated too.
  const items: unknown = Array.isArray(value)
    ? value
    : isObject(value)
      ? value["items"]
      : undefined;

  if (!Array.isArray(items)) {
    return [];
  }

  const owners: Array<{
    kind?: string | undefined;
    name?: string | undefined;
  }> = [];

  for (const item of items) {
    if (!isObject(item)) {
      continue;
    }
    owners.push({
      kind: typeof item["kind"] === "string" ? item["kind"] : undefined,
      name: typeof item["name"] === "string" ? item["name"] : undefined,
    });
  }

  return owners;
}

/**
 * A KubernetesResource Pod row as the classifier's KubernetesPodLike, with
 * the spec reduced to container name / image / ports (see the file header).
 * Images missing from the spec are filled in from the pod's
 * KubernetesContainer rows (name → image) when given. Null without a name.
 */
export function toKubernetesPodLike(
  row: KubernetesResource,
  containerImages?: Array<{ name: string; image: string }> | undefined,
): KubernetesPodLike | null {
  const name: string = readText(row?.name);
  if (!name) {
    return null;
  }

  let containers: Array<ProjectedContainer> = projectSpecContainers(row.spec);
  const images: Array<{ name: string; image: string }> = containerImages || [];

  if (containers.length === 0) {
    containers = images.map(
      (entry: { name: string; image: string }): ProjectedContainer => {
        return { name: entry.name, image: entry.image, ports: [] };
      },
    );
  } else if (images.length > 0) {
    containers = containers.map(
      (container: ProjectedContainer): ProjectedContainer => {
        if (container.image) {
          return container;
        }
        const match: { name: string; image: string } | undefined = images.find(
          (entry: { name: string; image: string }): boolean => {
            return entry.name === container.name;
          },
        );
        return match ? { ...container, image: match.image } : container;
      },
    );
  }

  return {
    namespaceKey: readText(row.namespaceKey),
    name: name,
    phase: typeof row.phase === "string" ? row.phase : null,
    labels: isObject(row.labels) ? (row.labels as Record<string, unknown>) : {},
    ownerReferences: { items: projectOwnerReferences(row.ownerReferences) },
    spec: { containers: containers },
  };
}

// True when classification would miss an image the spec does not carry.
function isMissingImages(row: KubernetesResource): boolean {
  const containers: Array<ProjectedContainer> = projectSpecContainers(row.spec);
  return (
    containers.length === 0 ||
    containers.some((container: ProjectedContainer): boolean => {
      return !container.image;
    })
  );
}

function isOwnedByStatefulSet(row: KubernetesResource): boolean {
  return projectOwnerReferences(row.ownerReferences).some(
    (owner: { kind?: string | undefined }): boolean => {
      return (owner.kind || "").toLowerCase() === "statefulset";
    },
  );
}

/**
 * Container rows → one entry per database workload (engine + container name
 * minus the compose replica suffix). Stopped containers are ignored. Only
 * full 64-hex ids become member keys. Deterministic order.
 */
export function groupContainerDatabases(
  rows: Array<ContainerRowLike>,
): Array<ContainerDatabaseGroup> {
  const byKey: Map<string, ContainerDatabaseGroup> = new Map<
    string,
    ContainerDatabaseGroup
  >();

  const sorted: Array<ContainerRowLike> = (Array.isArray(rows) ? rows : [])
    .filter((row: ContainerRowLike): boolean => {
      return isObject(row);
    })
    .sort((a: ContainerRowLike, b: ContainerRowLike): number => {
      const left: string = readText(a.name);
      const right: string = readText(b.name);
      if (left < right) {
        return -1;
      }
      return left > right ? 1 : 0;
    });

  for (const row of sorted) {
    if (STOPPED_CONTAINER_STATES.has(readText(row.state).toLowerCase())) {
      continue;
    }

    const classification: ContainerDatabaseClassification | null =
      classifyContainer({
        name: readText(row.name),
        imageName: row.imageName,
        containerId: row.containerId,
      });

    if (!classification) {
      continue;
    }

    const key: string = `${classification.system}\u0000${classification.workloadName}`;
    let group: ContainerDatabaseGroup | undefined = byKey.get(key);
    if (!group) {
      group = {
        system: classification.system,
        workloadName: classification.workloadName,
        containerNames: [],
        containerIds: [],
        version: null,
      };
      byKey.set(key, group);
    }

    if (!group.containerNames.includes(classification.containerName)) {
      group.containerNames.push(classification.containerName);
    }

    const containerId: string = readText(row.containerId);
    if (
      FULL_CONTAINER_ID_REGEX.test(containerId) &&
      !group.containerIds.includes(containerId)
    ) {
      group.containerIds.push(containerId);
    }

    if (!group.version && classification.version) {
      group.version = classification.version;
    }
  }

  return Array.from(byKey.values()).sort(
    (a: ContainerDatabaseGroup, b: ContainerDatabaseGroup): number => {
      if (a.workloadName !== b.workloadName) {
        return a.workloadName < b.workloadName ? -1 : 1;
      }
      if (a.system !== b.system) {
        return a.system < b.system ? -1 : 1;
      }
      return 0;
    },
  );
}

/*
 * Look the workload up without permission to create; only a miss asks the
 * budget, and only a budget that allows it creates (see AutoCreateBudget).
 */
async function upsertWorkload(data: {
  upsert: Omit<UpsertWorkloadDatabaseData, "allowCreate">;
  budget: AutoCreateBudget;
  stats: DiscoveryStats;
}): Promise<DatabaseServer | null> {
  const existing: DatabaseServer | null =
    await DatabaseServerService.upsertWorkloadDatabase({
      ...data.upsert,
      allowCreate: false,
    });

  if (existing) {
    data.stats.databases++;
    return existing;
  }

  if (!(await data.budget.allowsCreate(data.upsert.projectId))) {
    data.stats.overBudget++;
    return null;
  }

  const created: DatabaseServer | null =
    await DatabaseServerService.upsertWorkloadDatabase({
      ...data.upsert,
      allowCreate: true,
    });

  if (created) {
    data.budget.recordCreate(data.upsert.projectId);
    data.stats.databases++;
    data.stats.created++;
  }

  return created;
}

function capGroups<T>(data: {
  groups: Array<T>;
  parentLabel: string;
}): Array<T> {
  if (data.groups.length <= MAX_DATABASES_PER_PARENT) {
    return data.groups;
  }

  logger.warn(
    `${JOB_NAME}: ${data.parentLabel} runs ${data.groups.length} database workloads; only the first ${MAX_DATABASES_PER_PARENT} were upserted this run, ${data.groups.length - MAX_DATABASES_PER_PARENT} skipped`,
  );

  return data.groups.slice(0, MAX_DATABASES_PER_PARENT);
}

// ---- Kubernetes -----------------------------------------------------------

/*
 * Aliases may drop the "@cluster" qualifier only when the project has
 * exactly one cluster — then an unqualified cluster-local name cannot
 * belong to anything else. Counted once per project per run; an unreadable
 * count is treated as "more than one" (qualified aliases only).
 */
async function projectHasExactlyOneCluster(
  projectId: ObjectID,
  memo: Map<string, boolean>,
): Promise<boolean> {
  const key: string = projectId.toString();
  const cached: boolean | undefined = memo.get(key);
  if (cached !== undefined) {
    return cached;
  }

  let exactlyOne: boolean = false;
  try {
    const count: PositiveNumber = await KubernetesClusterService.countBy({
      query: {
        projectId: projectId,
      },
      props: {
        isRoot: true,
      },
    });
    exactlyOne = count.toNumber() === 1;
  } catch (err) {
    logger.error(
      `${JOB_NAME}: counting Kubernetes clusters failed for project ${key}; using cluster-qualified aliases only: ${errorMessage(err)}`,
    );
  }

  memo.set(key, exactlyOne);
  return exactlyOne;
}

// StatefulSet name → spec.serviceName, per namespace.
async function loadHeadlessServiceNames(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  clusterLabel: string;
}): Promise<Map<string, Record<string, string>>> {
  const statefulSets: Array<KubernetesResource> =
    await KubernetesResourceService.findBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.clusterId,
        kind: "StatefulSet",
      },
      select: {
        name: true,
        namespaceKey: true,
        spec: true,
      },
      skip: 0,
      limit: MAX_STATEFULSETS_PER_CLUSTER,
      props: {
        isRoot: true,
      },
    });

  if (statefulSets.length >= MAX_STATEFULSETS_PER_CLUSTER) {
    logger.warn(
      `${JOB_NAME}: ${data.clusterLabel} has at least ${MAX_STATEFULSETS_PER_CLUSTER} StatefulSets; headless Service names beyond them were not read this run`,
    );
  }

  const byNamespace: Map<string, Record<string, string>> = new Map<
    string,
    Record<string, string>
  >();

  for (const statefulSet of statefulSets) {
    const name: string = readText(statefulSet.name);
    const serviceName: string = isObject(statefulSet.spec)
      ? readText(statefulSet.spec["serviceName"])
      : "";
    if (!name || !serviceName) {
      continue;
    }

    const namespace: string = readText(statefulSet.namespaceKey);
    const names: Record<string, string> = byNamespace.get(namespace) || {};
    names[name] = serviceName;
    byNamespace.set(namespace, names);
  }

  return byNamespace;
}

// Pod (namespace + name) → its containers' images, from KubernetesContainer.
async function loadContainerImages(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  clusterLabel: string;
  podNames: Array<string>;
}): Promise<Map<string, Array<{ name: string; image: string }>>> {
  const rows: Array<KubernetesContainer> =
    await KubernetesContainerService.findBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.clusterId,
        podName: new Includes(data.podNames),
      },
      select: {
        podNamespaceKey: true,
        podName: true,
        name: true,
        image: true,
      },
      skip: 0,
      limit: MAX_CONTAINER_ROWS_PER_CLUSTER,
      props: {
        isRoot: true,
      },
    });

  if (rows.length >= MAX_CONTAINER_ROWS_PER_CLUSTER) {
    logger.warn(
      `${JOB_NAME}: ${data.clusterLabel} has at least ${MAX_CONTAINER_ROWS_PER_CLUSTER} container rows for pods without images in their spec; the rest were not read this run`,
    );
  }

  const byPod: Map<string, Array<{ name: string; image: string }>> = new Map<
    string,
    Array<{ name: string; image: string }>
  >();

  for (const row of rows) {
    const podName: string = readText(row.podName);
    const name: string = readText(row.name);
    const image: string = readText(row.image);
    if (!podName || !name || !image) {
      continue;
    }

    const key: string = podKey(readText(row.podNamespaceKey), podName);
    const images: Array<{ name: string; image: string }> = byPod.get(key) || [];
    images.push({ name: name, image: image });
    byPod.set(key, images);
  }

  return byPod;
}

async function discoverKubernetesCluster(data: {
  cluster: KubernetesCluster;
  budget: AutoCreateBudget;
  clusterCountMemo: Map<string, boolean>;
  stats: DiscoveryStats;
}): Promise<void> {
  const cluster: KubernetesCluster = data.cluster;
  const clusterIdentifier: string = readText(cluster.clusterIdentifier);

  if (!cluster._id || !cluster.projectId || !clusterIdentifier) {
    return;
  }

  const clusterId: ObjectID = new ObjectID(cluster._id.toString());
  const projectId: ObjectID = new ObjectID(cluster.projectId.toString());
  const clusterLabel: string = `Kubernetes cluster ${clusterId.toString()} (project ${projectId.toString()})`;

  const pods: Array<KubernetesResource> =
    await KubernetesResourceService.findBy({
      query: {
        projectId: projectId,
        kubernetesClusterId: clusterId,
        kind: "Pod",
      },
      select: {
        name: true,
        namespaceKey: true,
        phase: true,
        labels: true,
        ownerReferences: true,
        spec: true,
      },
      sort: {
        namespaceKey: SortOrder.Ascending,
        name: SortOrder.Ascending,
      },
      skip: 0,
      limit: MAX_PODS_PER_CLUSTER,
      props: {
        isRoot: true,
      },
    });

  if (pods.length >= MAX_PODS_PER_CLUSTER) {
    logger.warn(
      `${JOB_NAME}: ${clusterLabel} has at least ${MAX_PODS_PER_CLUSTER} pods; only the first ${MAX_PODS_PER_CLUSTER} were classified this run`,
    );
  }

  if (pods.length === 0) {
    return;
  }

  const headlessServiceNames: Map<string, Record<string, string>> = pods.some(
    isOwnedByStatefulSet,
  )
    ? await loadHeadlessServiceNames({
        projectId: projectId,
        clusterId: clusterId,
        clusterLabel: clusterLabel,
      })
    : new Map<string, Record<string, string>>();

  const podsMissingImages: Array<string> = Array.from(
    new Set<string>(
      pods
        .filter(isMissingImages)
        .map((pod: KubernetesResource): string => {
          return readText(pod.name);
        })
        .filter((name: string): boolean => {
          return name.length > 0;
        }),
    ),
  );

  const containerImages: Map<
    string,
    Array<{ name: string; image: string }>
  > = podsMissingImages.length > 0
    ? await loadContainerImages({
        projectId: projectId,
        clusterId: clusterId,
        clusterLabel: clusterLabel,
        podNames: podsMissingImages,
      })
    : new Map<string, Array<{ name: string; image: string }>>();

  const candidates: Array<KubernetesDatabaseCandidate> = [];

  for (const pod of pods) {
    const namespace: string = readText(pod.namespaceKey);
    const podLike: KubernetesPodLike | null = toKubernetesPodLike(
      pod,
      containerImages.get(podKey(namespace, readText(pod.name))),
    );
    if (!podLike) {
      continue;
    }

    const candidate: KubernetesDatabaseCandidate | null = classifyKubernetesPod(
      podLike,
      {
        statefulSetServiceNames: headlessServiceNames.get(namespace) || {},
      },
    );
    if (candidate) {
      candidates.push(candidate);
    }
  }

  const groups: Array<KubernetesDatabaseGroup> = capGroups({
    groups: groupKubernetesDatabaseCandidates(candidates),
    parentLabel: clusterLabel,
  });

  if (groups.length === 0) {
    return;
  }

  const includeUnqualified: boolean = await projectHasExactlyOneCluster(
    projectId,
    data.clusterCountMemo,
  );
  const projectIdText: string = projectId.toString();

  for (const group of groups) {
    try {
      const memberKeysSeenNow: Array<string> = group.podNames.map(
        (podName: string): string => {
          return keyForKubernetesPod(projectIdText, {
            clusterName: clusterIdentifier,
            namespace: group.namespace,
            podName: podName,
          });
        },
      );

      if (group.workloadKind === "Deployment") {
        memberKeysSeenNow.push(
          keyForKubernetesDeployment(projectIdText, {
            clusterName: clusterIdentifier,
            namespace: group.namespace,
            deploymentName: group.workloadName,
          }),
        );
      }

      await upsertWorkload({
        upsert: {
          projectId: projectId,
          workloadIdentifier: buildWorkloadDatabaseServerIdentifier({
            system: group.system,
            platform: "kubernetes",
            parentName: clusterIdentifier,
            namespace: group.namespace,
            workloadKind: group.workloadKind,
            workloadName: group.workloadName,
          }),
          dbSystem: group.system,
          displayName: buildDatabaseServerDisplayName({
            system: group.system,
            namespace: group.namespace,
            workloadName: group.workloadName,
          }),
          discoverySource: DatabaseServerDiscoverySource.Kubernetes,
          aliases: buildKubernetesDatabaseAliases({
            system: group.system,
            namespace: group.namespace,
            clusterName: clusterIdentifier,
            serviceNames: group.serviceNames,
            podServiceNames: group.podServiceNames,
            ports: group.ports,
            includeUnqualified: includeUnqualified,
          }),
          memberKeysSeenNow: memberKeysSeenNow,
          instanceCount: group.podNames.length,
          dbVersion: group.version || undefined,
          kubernetesClusterId: clusterId,
          kubernetesNamespace: group.namespace || undefined,
          workloadKind: group.workloadKind,
          workloadName: group.workloadName,
        },
        budget: data.budget,
        stats: data.stats,
      });
    } catch (err) {
      logger.error(
        `${JOB_NAME}: upserting ${group.system} workload ${group.namespace}/${group.workloadKind}/${group.workloadName} failed for ${clusterLabel}: ${errorMessage(err)}`,
      );
    }
  }
}

async function discoverKubernetesDatabases(data: {
  budget: AutoCreateBudget;
  stats: DiscoveryStats;
}): Promise<void> {
  const clusters: Array<KubernetesCluster> =
    await KubernetesClusterService.findBy({
      query: {
        otelCollectorStatus: "connected",
      },
      select: {
        _id: true,
        projectId: true,
        clusterIdentifier: true,
      },
      skip: 0,
      limit: MAX_PARENTS_PER_RUN,
      props: {
        isRoot: true,
      },
    });

  if (clusters.length >= MAX_PARENTS_PER_RUN) {
    logger.warn(
      `${JOB_NAME}: at least ${MAX_PARENTS_PER_RUN} connected Kubernetes clusters; clusters beyond them were not scanned this run`,
    );
  }

  const clusterCountMemo: Map<string, boolean> = new Map<string, boolean>();

  for (const cluster of clusters) {
    data.stats.parents++;
    try {
      await discoverKubernetesCluster({
        cluster: cluster,
        budget: data.budget,
        clusterCountMemo: clusterCountMemo,
        stats: data.stats,
      });
    } catch (err) {
      data.stats.failedParents++;
      logger.error(
        `${JOB_NAME}: discovery failed for Kubernetes cluster ${cluster._id?.toString() || "unknown"} (project ${cluster.projectId?.toString() || "unknown"}): ${errorMessage(err)}`,
      );
    }
  }
}

// ---- Docker / Podman ------------------------------------------------------

async function loadContainerRows(data: {
  platform: ContainerPlatform;
  projectId: ObjectID;
  hostId: ObjectID;
}): Promise<Array<ContainerRowLike>> {
  const select: {
    name: true;
    containerId: true;
    imageName: true;
    state: true;
  } = {
    name: true,
    containerId: true,
    imageName: true,
    state: true,
  };

  if (data.platform === "docker") {
    const rows: Array<DockerResource> = await DockerResourceService.findBy({
      query: {
        projectId: data.projectId,
        dockerHostId: data.hostId,
        kind: "Container",
      },
      select: select,
      sort: {
        name: SortOrder.Ascending,
      },
      skip: 0,
      limit: MAX_CONTAINERS_PER_HOST,
      props: {
        isRoot: true,
      },
    });
    return rows;
  }

  const rows: Array<PodmanResource> = await PodmanResourceService.findBy({
    query: {
      projectId: data.projectId,
      podmanHostId: data.hostId,
      kind: "Container",
    },
    select: select,
    sort: {
      name: SortOrder.Ascending,
    },
    skip: 0,
    limit: MAX_CONTAINERS_PER_HOST,
    props: {
      isRoot: true,
    },
  });
  return rows;
}

async function discoverContainerHost(data: {
  platform: ContainerPlatform;
  host: DockerHost | PodmanHost;
  budget: AutoCreateBudget;
  stats: DiscoveryStats;
}): Promise<void> {
  const host: DockerHost | PodmanHost = data.host;
  const hostIdentifier: string = readText(host.hostIdentifier);

  if (!host._id || !host.projectId || !hostIdentifier) {
    return;
  }

  const hostId: ObjectID = new ObjectID(host._id.toString());
  const projectId: ObjectID = new ObjectID(host.projectId.toString());
  const platformName: string = data.platform === "docker" ? "Docker" : "Podman";
  const hostLabel: string = `${platformName} host ${hostId.toString()} (project ${projectId.toString()})`;

  const rows: Array<ContainerRowLike> = await loadContainerRows({
    platform: data.platform,
    projectId: projectId,
    hostId: hostId,
  });

  if (rows.length >= MAX_CONTAINERS_PER_HOST) {
    logger.warn(
      `${JOB_NAME}: ${hostLabel} has at least ${MAX_CONTAINERS_PER_HOST} containers; only the first ${MAX_CONTAINERS_PER_HOST} were classified this run`,
    );
  }

  const groups: Array<ContainerDatabaseGroup> = capGroups({
    groups: groupContainerDatabases(rows),
    parentLabel: hostLabel,
  });

  const projectIdText: string = projectId.toString();

  for (const group of groups) {
    try {
      await upsertWorkload({
        upsert: {
          projectId: projectId,
          workloadIdentifier: buildWorkloadDatabaseServerIdentifier({
            system: group.system,
            platform: data.platform,
            parentName: hostIdentifier,
            workloadName: group.workloadName,
          }),
          dbSystem: group.system,
          displayName: buildDatabaseServerDisplayName({
            system: group.system,
            workloadName: group.workloadName,
          }),
          discoverySource:
            data.platform === "docker"
              ? DatabaseServerDiscoverySource.Docker
              : DatabaseServerDiscoverySource.Podman,
          aliases: [],
          memberKeysSeenNow: group.containerIds.map(
            (containerId: string): string => {
              return keyForContainer(projectIdText, containerId);
            },
          ),
          instanceCount: group.containerNames.length,
          dbVersion: group.version || undefined,
          workloadKind: "Container",
          workloadName: group.workloadName,
          ...(data.platform === "docker"
            ? { dockerHostId: hostId }
            : { podmanHostId: hostId }),
        },
        budget: data.budget,
        stats: data.stats,
      });
    } catch (err) {
      logger.error(
        `${JOB_NAME}: upserting ${group.system} container workload ${group.workloadName} failed for ${hostLabel}: ${errorMessage(err)}`,
      );
    }
  }
}

async function discoverContainerHostDatabases(data: {
  platform: ContainerPlatform;
  budget: AutoCreateBudget;
  stats: DiscoveryStats;
}): Promise<void> {
  const query: { otelCollectorStatus: string } = {
    otelCollectorStatus: "connected",
  };
  const select: { _id: true; projectId: true; hostIdentifier: true } = {
    _id: true,
    projectId: true,
    hostIdentifier: true,
  };

  const hosts: Array<DockerHost | PodmanHost> =
    data.platform === "docker"
      ? await DockerHostService.findBy({
          query: query,
          select: select,
          skip: 0,
          limit: MAX_PARENTS_PER_RUN,
          props: { isRoot: true },
        })
      : await PodmanHostService.findBy({
          query: query,
          select: select,
          skip: 0,
          limit: MAX_PARENTS_PER_RUN,
          props: { isRoot: true },
        });

  const platformName: string = data.platform === "docker" ? "Docker" : "Podman";

  if (hosts.length >= MAX_PARENTS_PER_RUN) {
    logger.warn(
      `${JOB_NAME}: at least ${MAX_PARENTS_PER_RUN} connected ${platformName} hosts; hosts beyond them were not scanned this run`,
    );
  }

  for (const host of hosts) {
    data.stats.parents++;
    try {
      await discoverContainerHost({
        platform: data.platform,
        host: host,
        budget: data.budget,
        stats: data.stats,
      });
    } catch (err) {
      data.stats.failedParents++;
      logger.error(
        `${JOB_NAME}: discovery failed for ${platformName} host ${host._id?.toString() || "unknown"} (project ${host.projectId?.toString() || "unknown"}): ${errorMessage(err)}`,
      );
    }
  }
}

RunCron(
  JOB_NAME,
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async (): Promise<void> => {
    const budget: AutoCreateBudget = new AutoCreateBudget();
    const stats: DiscoveryStats = {
      parents: 0,
      failedParents: 0,
      databases: 0,
      created: 0,
      overBudget: 0,
    };

    // Each platform in its own try: a Kubernetes outage never stops Docker.
    try {
      await discoverKubernetesDatabases({ budget: budget, stats: stats });
    } catch (err) {
      logger.error(
        `${JOB_NAME}: Kubernetes discovery failed: ${errorMessage(err)}`,
      );
    }

    for (const platform of ["docker", "podman"] as Array<ContainerPlatform>) {
      try {
        await discoverContainerHostDatabases({
          platform: platform,
          budget: budget,
          stats: stats,
        });
      } catch (err) {
        logger.error(
          `${JOB_NAME}: ${platform} discovery failed: ${errorMessage(err)}`,
        );
      }
    }

    if (stats.overBudget > 0) {
      logger.warn(
        `${JOB_NAME}: ${stats.overBudget} new database workload(s) were not created because their project reached its auto-create budget (DATABASE_SERVER_AUTO_CREATE_BUDGET)`,
      );
    }

    if (stats.databases > 0 || stats.failedParents > 0) {
      logger.debug(
        `${JOB_NAME}: upserted ${stats.databases} database workload(s) (${stats.created} new) across ${stats.parents} connected cluster(s) / host(s); ${stats.failedParents} failed`,
      );
    }
  },
);
