import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import RunCron from "../../Utils/Cron";
import AutoCreateBudget from "./AutoCreateBudget";
import logger from "Common/Server/Utils/Logger";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Semaphore, {
  SemaphoreMutex,
} from "Common/Server/Infrastructure/Semaphore";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
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
  DATABASE_OPERATOR_LABEL_KEYS,
  DATABASE_WORKLOAD_NAME_LABEL_VALUES,
  KubernetesContainerLike,
  KubernetesDatabaseCandidate,
  KubernetesDatabaseGroup,
  KubernetesPodLike,
  KubernetesPoolerService,
  attachPoolerServices,
  classifyContainer,
  classifyImage,
  classifyKubernetesPod,
  classifyKubernetesPoolerPod,
  groupKubernetesDatabaseCandidates,
  pickMostSpecificDatabaseSystem,
} from "Common/Types/DatabaseServer/DatabaseContainerClassifier";
import {
  CONTAINER_COMMAND_KNOWN_WORDS,
  containerCommandProjectionSql,
} from "Common/Types/DatabaseServer/DatabaseContainerCommand";
import { getDatabaseSystemFamily } from "Common/Types/DatabaseServer/DatabaseSystem";
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
 *   - per CONNECTED Kubernetes cluster: the pods that could be a
 *     database (one of their KubernetesContainer images is a database
 *     image, or their labels carry an operator / chart key) are
 *     selected in SQL, classified (operator / chart labels, then the
 *     container image), folded into one entry per database workload,
 *     and upserted by workload identity with the workload's Service
 *     DNS names as endpoint aliases and its pods (plus its
 *     Deployments) as member keys, so pod logs and metrics show on the
 *     database's page;
 *   - per CONNECTED Docker / Podman host: its running Container rows
 *     are classified by image and folded by Swarm / Compose service
 *     (else kept per container name), with the container ids as
 *     member keys.
 *
 * What a run does, and does not, trust:
 *
 *   - Inventory rows outlive what they describe by up to 15 minutes
 *     (the stale-resource crons delete them), so a member counts only
 *     when its row was refreshed with the rest of its parent's
 *     inventory (MEMBER_FRESHNESS_WINDOW_MS of the newest row). A
 *     Docker / Podman host whose newest container row is older than
 *     STALE_HOST_INVENTORY_MS (its agent stopped reporting) is left
 *     alone for the run, and of several connected parents with one
 *     identifier (a registration race) only the most recently seen is
 *     visited, so a stale twin never rewrites a database's parent.
 *   - A row is CREATED only for a workload with a running member that
 *     has lived MIN_OBSERVED_LIFETIME_MS — a pod READY that long (a
 *     crash-looping pod turns Ready afresh on every restart), a
 *     container running that long: a CI container, a
 *     `docker run --rm postgres psql` session or a pod that crashed
 *     after a minute never becomes a permanent database. Existing rows
 *     refresh from the first sighting.
 *   - instanceCount counts running members — a pod whose database
 *     container is running, not waiting in CrashLoopBackOff; a workload
 *     of a parent scanned in full that has no member left (scaled to
 *     zero, all containers stopped) has its instanceCount set to 0.
 *
 * Fleet-wide shape: every connected cluster and host (all projects) is
 * listed in a stable order and visited round-robin from a cursor kept
 * in Redis, under a wall-clock budget, so no parent is starved however
 * large the fleet; one run at a time holds a Redis lock (the queue's
 * timeout never stops a running job). Each parent is isolated — one
 * failing never costs another its run — and every stage is capped,
 * with a warning naming what was skipped.
 *
 * A database is always LOOKED UP first without permission to create
 * (see AutoCreateBudget); only a miss asks the project's auto-create
 * budget. Disconnected parents are skipped: their inventory is stale,
 * and a database that really went away is aged out by
 * DatabaseServer:CleanupStaleResources once nothing sees it.
 *
 * Pod specs in the inventory keep direct env values verbatim,
 * passwords included. The spec never leaves Postgres: the pod query
 * projects each container to its name, image, declared ports, its command
 * line reduced to the program (past `env` / `tini` launchers) and the
 * known command names a shell script runs, and its ready / state status.
 * ------------------------------------------------------------------
 */

const JOB_NAME: string = "DatabaseServer:DiscoverContainerDatabases";

// ---- run shape --------------------------------------------------------------

// No parent is started after this much of a run; the rest continue next run.
export const RUN_BUDGET_MS: number = 4 * 60 * 1000;
// The queue's timeout for one run: it stops waiting then, it never stops the work.
export const JOB_TIMEOUT_MS: number = 10 * 60 * 1000;
/*
 * How long a crashed run's lock lingers. The mutex refreshes itself while
 * held, so a slow run keeps it; this only bounds a dead worker's.
 */
const RUN_LOCK_TIMEOUT_MS: number = 20 * 60 * 1000;
const DISCOVERY_CACHE_NAMESPACE: string = "database-server-discovery";
const RUN_LOCK_KEY: string = "discover-container-databases-lock";
const CURSOR_KEY: string = "discover-container-databases-cursor";
const CURSOR_TTL_SECONDS: number = 7 * 24 * 60 * 60;

// Connected parents are listed in pages of this size, up to the cap per platform.
export const PARENT_PAGE_SIZE: number = 1000;
export const MAX_PARENTS_PER_PLATFORM: number = 50000;

// ---- Kubernetes ------------------------------------------------------------

// Distinct container images read per cluster to find the database ones.
export const MAX_DISTINCT_IMAGES_PER_CLUSTER: number = 20000;
// Pods that could be a database (image or labels), classified per cluster per run.
export const MAX_CANDIDATE_PODS_PER_CLUSTER: number = 5000;
// StatefulSet rows read per cluster for their headless Service names.
export const MAX_STATEFULSETS_PER_CLUSTER: number = 2000;
// KubernetesContainer rows read per cluster to fill in images a spec lacks.
export const MAX_CONTAINER_ROWS_PER_CLUSTER: number = 10000;

// ---- Docker / Podman ---------------------------------------------------------

// Container rows are read in pages of this size, up to the cap per host.
export const CONTAINER_PAGE_SIZE: number = 1000;
export const MAX_CONTAINERS_PER_HOST: number = 10000;

// ---- both ---------------------------------------------------------------------

// Database workloads upserted per parent per run.
export const MAX_DATABASES_PER_PARENT: number = 200;
/*
 * A member counts only when its inventory row is at most this much older
 * than the parent's newest row: every live pod / container is refreshed by
 * the same snapshot (Docker's running containers every 30 s), while a
 * deleted one keeps its last timestamp until the stale-resource cron
 * removes it. Relative to the newest row, not to now, so a parent whose
 * inventory stalled keeps its members.
 */
export const MEMBER_FRESHNESS_WINDOW_MS: number = 4 * 60 * 1000;
/*
 * A Docker / Podman host whose newest running-container row is older than
 * this (its agent reports every 30 s) has stopped reporting: its
 * inventory proves nothing about now, so the run leaves its databases
 * alone rather than refreshing them from rows the stale-resource cron is
 * about to delete. Well inside the 15 minutes after which the host is
 * marked disconnected (and skipped anyway).
 */
export const STALE_HOST_INVENTORY_MS: number = 10 * 60 * 1000;
/*
 * A workload gets a NEW row only once a running member has lived this long
 * (its creation — or, without one, its first inventory sighting — to its
 * latest sighting).
 */
export const MIN_OBSERVED_LIFETIME_MS: number = 10 * 60 * 1000;
// Discovered rows of one parent read to find the workloads that scaled to zero.
const MAX_WORKLOAD_ROWS_PER_PARENT: number = 1000;

// Docker / Podman states in which a container is not running anything.
const STOPPED_CONTAINER_STATES: ReadonlyArray<string> = [
  "exited",
  "dead",
  "created",
];
const STOPPED_CONTAINER_STATE_SET: ReadonlySet<string> = new Set<string>(
  STOPPED_CONTAINER_STATES,
);

// A full Docker / Podman container id, as `container.id` reports it.
const FULL_CONTAINER_ID_REGEX: RegExp = /^[0-9a-f]{64}$/i;

export type DiscoveryPlatform = "kubernetes" | "docker" | "podman";

const PLATFORMS: ReadonlyArray<DiscoveryPlatform> = [
  "kubernetes",
  "docker",
  "podman",
];

export interface DiscoveryParent {
  platform: DiscoveryPlatform;
  id: string;
  projectId: string;
  // clusterIdentifier / hostIdentifier.
  identifier: string;
  // The cluster's / host's own lastSeenAt, in epoch ms; null when unknown.
  lastSeenAt?: number | null | undefined;
}

interface DiscoveryStats {
  parents: number;
  failedParents: number;
  databases: number;
  created: number;
  overBudget: number;
  deferred: number;
  scaledToZero: number;
}

export interface MemberTiming {
  lastSeenAt?: Date | string | null | undefined;
  resourceCreationTimestamp?: Date | string | null | undefined;
  createdAt?: Date | string | null | undefined;
}

// A Pod row as the candidate-pod query returns it (spec projected, no env).
export interface KubernetesPodRow extends MemberTiming {
  namespaceKey?: string | null | undefined;
  name?: string | null | undefined;
  phase?: string | null | undefined;
  labels?: unknown;
  ownerReferences?: unknown;
  // Each also carries its containerStatuses entry's `ready` and `state`.
  containers?: unknown;
  // The pod's Ready condition: { status, lastTransitionTime }, or null.
  readyCondition?: unknown;
}

export interface ContainerRowLike extends MemberTiming {
  name?: string | null | undefined;
  containerId?: string | null | undefined;
  imageName?: string | null | undefined;
  state?: string | null | undefined;
  labels?: unknown;
}

export interface ContainerDatabaseGroup {
  system: string;
  workloadName: string;
  containerNames: Array<string>;
  // Full (64-hex) container ids only — the form telemetry is keyed by.
  containerIds: Array<string>;
  version: string | null;
  // Members running now.
  instanceCount: number;
  // A running member has lived MIN_OBSERVED_LIFETIME_MS: a new row may be created.
  mayCreate: boolean;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// isObject without narrowing, for rows already typed by their interface.
function isRow(value: unknown): boolean {
  return isObject(value);
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function podKey(namespace: string, podName: string): string {
  return `${namespace}\u0000${podName}`;
}

function compareStrings(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

function toTime(value: unknown): number | null {
  if (value instanceof Date) {
    const time: number = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "string" && value.trim()) {
    const time: number = new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

// 32-bit FNV-1a: a cheap, stable hash for rotating which items a cap keeps.
function hashText(value: string): number {
  let hash: number = 0x811c9dc5;
  for (let index: number = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// ---- member evidence -----------------------------------------------------------

/**
 * The newest `lastSeenAt` among inventory rows, in epoch ms; null when none
 * has one.
 */
export function newestSeenAt(rows: Array<MemberTiming>): number | null {
  let newest: number | null = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    const seen: number | null = toTime(row?.lastSeenAt);
    if (seen !== null && (newest === null || seen > newest)) {
      newest = seen;
    }
  }
  return newest;
}

/**
 * True when an inventory row was refreshed with the rest of its parent's
 * inventory (within MEMBER_FRESHNESS_WINDOW_MS of the newest row). A row or
 * parent without timestamps cannot be judged stale, so it counts.
 */
export function isFreshMember(
  lastSeenAt: unknown,
  newest: number | null,
): boolean {
  const seen: number | null = toTime(lastSeenAt);
  if (seen === null || newest === null) {
    return true;
  }
  return seen >= newest - MEMBER_FRESHNESS_WINDOW_MS;
}

/**
 * How long a member has been alive as far as the inventory shows: from its
 * creation (the pod's / container's own timestamp; else when its row first
 * appeared) to its latest sighting. Null without the timestamps to tell.
 */
export function observedLifetimeMs(member: MemberTiming): number | null {
  const seen: number | null = toTime(member?.lastSeenAt);
  const started: number | null =
    toTime(member?.resourceCreationTimestamp) ?? toTime(member?.createdAt);
  if (seen === null || started === null) {
    return null;
  }
  return seen - started;
}

// True once a member has lived MIN_OBSERVED_LIFETIME_MS.
export function hasProvenLifetime(member: MemberTiming): boolean {
  const lifetime: number | null = observedLifetimeMs(member);
  return lifetime !== null && lifetime >= MIN_OBSERVED_LIFETIME_MS;
}

// A pod phase that serves: Running (or unreported).
function isRunningPhase(phase: unknown): boolean {
  const value: string = readText(phase).toLowerCase();
  return value === "" || value === "running";
}

interface ContainerRunState {
  // containerStatuses[].ready; null when not reported.
  ready: boolean | null;
  // containerStatuses[].state, lowercase ("running", "waiting", …); "" when not reported.
  state: string;
}

/*
 * The status the candidate-pod query projected for one of a pod's
 * containers, or null when there is none to read (no name, no status yet,
 * an agent that does not report container statuses).
 */
function containerRunState(
  row: KubernetesPodRow,
  containerName: string,
): ContainerRunState | null {
  if (!containerName || !Array.isArray(row?.containers)) {
    return null;
  }
  for (const container of row.containers) {
    if (!isObject(container) || container["name"] !== containerName) {
      continue;
    }
    const ready: unknown = container["ready"];
    const state: string = readText(container["state"]).toLowerCase();
    if (typeof ready !== "boolean" && !state) {
      return null;
    }
    return { ready: typeof ready === "boolean" ? ready : null, state: state };
  }
  return null;
}

/**
 * True when a candidate pod is a running instance of its database: its
 * phase serves AND its database container runs. Kubernetes keeps a
 * crash-looping pod in phase Running, so the container's own state decides:
 * "running" counts, "waiting" (CrashLoopBackOff, ImagePullBackOff) and
 * "terminated" do not, and an unreported state counts unless the container
 * says it is not ready. Without a status for that container (none reported
 * yet, an older agent) the phase alone decides, as it always did.
 */
export function isRunningKubernetesMember(
  row: KubernetesPodRow,
  databaseContainerName: string,
): boolean {
  if (!isRunningPhase(row?.phase)) {
    return false;
  }
  const status: ContainerRunState | null = containerRunState(
    row,
    databaseContainerName,
  );
  if (!status) {
    return true;
  }
  if (status.state === "running") {
    return true;
  }
  if (status.state === "waiting" || status.state === "terminated") {
    return false;
  }
  return status.ready !== false;
}

/**
 * A candidate pod's timing for hasProvenLifetime, measured from when it
 * last became Ready rather than from its creation: a crash-looping pod
 * turns Ready afresh on every restart, so it never proves
 * MIN_OBSERVED_LIFETIME_MS however old the pod is. A pod whose Ready
 * condition is not True proves nothing — unless its database container
 * itself is running and ready (a sidecar holds the pod back), which is
 * measured from the pod's creation. A pod with no Ready condition reported
 * (an older agent) is measured from its creation, as it always was.
 */
export function kubernetesMemberTiming(
  row: KubernetesPodRow,
  databaseContainerName: string,
): MemberTiming {
  const created: number | null =
    toTime(row?.resourceCreationTimestamp) ?? toTime(row?.createdAt);
  const condition: unknown = row?.readyCondition;
  const conditionStatus: string = isObject(condition)
    ? readText(condition["status"]).toLowerCase()
    : "";

  let startedAt: number | null = created;

  if (conditionStatus === "true") {
    const readySince: number | null = isObject(condition)
      ? toTime(condition["lastTransitionTime"])
      : null;
    if (readySince !== null) {
      startedAt = created === null ? readySince : Math.max(created, readySince);
    }
  } else if (conditionStatus) {
    const status: ContainerRunState | null = containerRunState(
      row,
      databaseContainerName,
    );
    const databaseContainerServes: boolean =
      status !== null && status.ready === true && status.state === "running";
    startedAt = databaseContainerServes ? created : null;
  }

  return {
    lastSeenAt: row?.lastSeenAt,
    resourceCreationTimestamp: startedAt === null ? null : new Date(startedAt),
    createdAt: null,
  };
}

// ---- parents: listing, rotation, lock ----------------------------------------

export function parentRotationKey(parent: DiscoveryParent): string {
  return `${parent.id}|${parent.platform}`;
}

/**
 * The order this run visits parents in: a stable order (by rotation key),
 * started just after the parent the previous run visited last and wrapped
 * around — so a run that stops at its budget is continued, not restarted,
 * and every parent is reached within a bounded number of runs. Duplicates
 * (a page boundary moving under a listing) are dropped.
 */
export function orderParentsForRun(
  parents: Array<DiscoveryParent>,
  cursor: string | null,
): Array<DiscoveryParent> {
  const byKey: Map<string, DiscoveryParent> = new Map<
    string,
    DiscoveryParent
  >();
  for (const parent of Array.isArray(parents) ? parents : []) {
    if (parent && parent.id) {
      byKey.set(parentRotationKey(parent), parent);
    }
  }

  const sorted: Array<DiscoveryParent> = Array.from(byKey.values()).sort(
    (a: DiscoveryParent, b: DiscoveryParent): number => {
      return compareStrings(parentRotationKey(a), parentRotationKey(b));
    },
  );

  if (!cursor) {
    return sorted;
  }

  const start: number = sorted.findIndex((parent: DiscoveryParent): boolean => {
    return parentRotationKey(parent) > cursor;
  });

  if (start <= 0) {
    return sorted;
  }

  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

function parentIdentityKey(parent: DiscoveryParent): string {
  return `${parent.platform}\u0000${parent.projectId}\u0000${parent.identifier.trim().toLowerCase()}`;
}

/**
 * One parent per platform, project and identifier. Databases are keyed by
 * the identifier (the host / cluster NAME), so two connected parents that
 * share one — a Docker or Podman host registered twice by racing agent
 * batches — would each rewrite the same databases with their own id and
 * their own (possibly long stale) inventory. The most recently seen one
 * is kept (ties: the smaller id); the others are returned as `skipped`.
 * Order is otherwise preserved.
 */
export function dedupeParentsByIdentifier(parents: Array<DiscoveryParent>): {
  kept: Array<DiscoveryParent>;
  skipped: Array<DiscoveryParent>;
} {
  const list: Array<DiscoveryParent> = Array.isArray(parents) ? parents : [];
  const best: Map<string, DiscoveryParent> = new Map<string, DiscoveryParent>();

  const seenAt: (parent: DiscoveryParent) => number = (
    parent: DiscoveryParent,
  ): number => {
    return typeof parent.lastSeenAt === "number" &&
      Number.isFinite(parent.lastSeenAt)
      ? parent.lastSeenAt
      : Number.NEGATIVE_INFINITY;
  };

  for (const parent of list) {
    if (!parent || !parent.id) {
      continue;
    }
    const key: string = parentIdentityKey(parent);
    const current: DiscoveryParent | undefined = best.get(key);
    if (
      !current ||
      seenAt(parent) > seenAt(current) ||
      (seenAt(parent) === seenAt(current) &&
        compareStrings(parent.id, current.id) < 0)
    ) {
      best.set(key, parent);
    }
  }

  const kept: Array<DiscoveryParent> = [];
  const skipped: Array<DiscoveryParent> = [];
  for (const parent of list) {
    if (!parent || !parent.id) {
      continue;
    }
    if (best.get(parentIdentityKey(parent)) === parent) {
      kept.push(parent);
    } else {
      skipped.push(parent);
    }
  }
  return { kept, skipped };
}

function platformName(platform: DiscoveryPlatform): string {
  if (platform === "kubernetes") {
    return "Kubernetes";
  }
  return platform === "docker" ? "Docker" : "Podman";
}

function parentKindLabel(platform: DiscoveryPlatform): string {
  return platform === "kubernetes"
    ? "Kubernetes clusters"
    : `${platformName(platform)} hosts`;
}

function parentLabel(parent: DiscoveryParent): string {
  const kind: string =
    parent.platform === "kubernetes"
      ? "Kubernetes cluster"
      : `${platformName(parent.platform)} host`;
  return `${kind} ${parent.id} (project ${parent.projectId})`;
}

async function findConnectedParentPage(
  platform: DiscoveryPlatform,
  skip: number,
): Promise<Array<DiscoveryParent>> {
  if (platform === "kubernetes") {
    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterService.findBy({
        query: {
          otelCollectorStatus: "connected",
        },
        select: {
          _id: true,
          projectId: true,
          clusterIdentifier: true,
          lastSeenAt: true,
        },
        sort: {
          _id: SortOrder.Ascending,
        },
        skip: skip,
        limit: PARENT_PAGE_SIZE,
        props: {
          isRoot: true,
        },
      });

    return clusters.map((cluster: KubernetesCluster): DiscoveryParent => {
      return {
        platform: platform,
        id: cluster._id?.toString() || "",
        projectId: cluster.projectId?.toString() || "",
        identifier: readText(cluster.clusterIdentifier),
        lastSeenAt: toTime(cluster.lastSeenAt),
      };
    });
  }

  const query: { otelCollectorStatus: string } = {
    otelCollectorStatus: "connected",
  };
  const select: {
    _id: true;
    projectId: true;
    hostIdentifier: true;
    lastSeenAt: true;
  } = {
    _id: true,
    projectId: true,
    hostIdentifier: true,
    lastSeenAt: true,
  };

  const hosts: Array<DockerHost | PodmanHost> =
    platform === "docker"
      ? await DockerHostService.findBy({
          query: query,
          select: select,
          sort: { _id: SortOrder.Ascending },
          skip: skip,
          limit: PARENT_PAGE_SIZE,
          props: { isRoot: true },
        })
      : await PodmanHostService.findBy({
          query: query,
          select: select,
          sort: { _id: SortOrder.Ascending },
          skip: skip,
          limit: PARENT_PAGE_SIZE,
          props: { isRoot: true },
        });

  return hosts.map((host: DockerHost | PodmanHost): DiscoveryParent => {
    return {
      platform: platform,
      id: host._id?.toString() || "",
      projectId: host.projectId?.toString() || "",
      identifier: readText(host.hostIdentifier),
      lastSeenAt: toTime(host.lastSeenAt),
    };
  });
}

/*
 * Every connected parent of one platform, across all projects, paged in a
 * stable order. One without an identifier has nothing to key its databases
 * by and is left out.
 */
async function listConnectedParents(
  platform: DiscoveryPlatform,
): Promise<Array<DiscoveryParent>> {
  const parents: Array<DiscoveryParent> = [];

  for (let skip: number = 0; ; skip += PARENT_PAGE_SIZE) {
    const page: Array<DiscoveryParent> = await findConnectedParentPage(
      platform,
      skip,
    );

    for (const parent of page) {
      if (parent.id && parent.projectId && parent.identifier) {
        parents.push(parent);
      }
    }

    if (page.length < PARENT_PAGE_SIZE) {
      break;
    }

    if (skip + PARENT_PAGE_SIZE >= MAX_PARENTS_PER_PLATFORM) {
      logger.warn(
        `${JOB_NAME}: at least ${MAX_PARENTS_PER_PLATFORM} connected ${parentKindLabel(platform)}; the ones beyond them were not listed this run`,
      );
      break;
    }
  }

  return parents;
}

async function readCursor(): Promise<string | null> {
  try {
    return await GlobalCache.getString(DISCOVERY_CACHE_NAMESPACE, CURSOR_KEY);
  } catch (err) {
    logger.error(
      `${JOB_NAME}: reading the rotation cursor failed; starting from the first connected cluster / host: ${errorMessage(err)}`,
    );
    return null;
  }
}

// Returns false when the write failed (logged once per run by the caller's flag).
async function writeCursor(
  key: string,
  alreadyFailed: boolean,
): Promise<boolean> {
  try {
    await GlobalCache.setString(DISCOVERY_CACHE_NAMESPACE, CURSOR_KEY, key, {
      expiresInSeconds: CURSOR_TTL_SECONDS,
    });
    return true;
  } catch (err) {
    if (!alreadyFailed) {
      logger.error(
        `${JOB_NAME}: saving the rotation cursor failed; the next run may revisit these clusters / hosts first: ${errorMessage(err)}`,
      );
    }
    return false;
  }
}

// ---- upserts ---------------------------------------------------------------------

/*
 * Look the workload up without permission to create; only a miss that the
 * workload's evidence allows (mayCreate) asks the budget, and only a budget
 * that allows it creates (see AutoCreateBudget).
 */
async function upsertWorkload(data: {
  upsert: Omit<UpsertWorkloadDatabaseData, "allowCreate">;
  mayCreate: boolean;
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

  if (!data.mayCreate) {
    data.stats.deferred++;
    return null;
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

/*
 * At most MAX_DATABASES_PER_PARENT workloads per parent per run. Which ones
 * rotates with the run (a salted hash, not the alphabet), so an oversized
 * parent's workloads are all refreshed across runs; the kept ones stay in
 * their original order.
 */
function capGroups<T>(data: {
  groups: Array<T>;
  keyOf: (group: T) => string;
  parentLabel: string;
  runSalt: string;
}): Array<T> {
  if (data.groups.length <= MAX_DATABASES_PER_PARENT) {
    return data.groups;
  }

  logger.warn(
    `${JOB_NAME}: ${data.parentLabel} runs ${data.groups.length} database workloads; ${MAX_DATABASES_PER_PARENT} were upserted this run (a different share each run), ${data.groups.length - MAX_DATABASES_PER_PARENT} skipped`,
  );

  const kept: Set<T> = new Set<T>(
    [...data.groups]
      .sort((a: T, b: T): number => {
        return (
          hashText(`${data.runSalt}\u0000${data.keyOf(a)}`) -
            hashText(`${data.runSalt}\u0000${data.keyOf(b)}`) ||
          compareStrings(data.keyOf(a), data.keyOf(b))
        );
      })
      .slice(0, MAX_DATABASES_PER_PARENT),
  );

  return data.groups.filter((group: T): boolean => {
    return kept.has(group);
  });
}

/*
 * Discovered rows of one parent whose workload was not seen in a run that
 * saw the parent's whole inventory have no running member any more (scaled
 * to zero, containers stopped): their instanceCount goes to 0. Only the
 * count — lastSeenAt keeps aging, so the row still retires on schedule.
 */
async function zeroUnseenWorkloads(data: {
  parent: DiscoveryParent;
  seenIdentifiers: Set<string>;
  stats: DiscoveryStats;
}): Promise<void> {
  const projectId: ObjectID = new ObjectID(data.parent.projectId);
  const parentId: ObjectID = new ObjectID(data.parent.id);

  const select: {
    _id: true;
    workloadIdentifier: true;
    instanceCount: true;
  } = {
    _id: true,
    workloadIdentifier: true,
    instanceCount: true,
  };

  const rows: Array<DatabaseServer> = await DatabaseServerService.findBy({
    query:
      data.parent.platform === "kubernetes"
        ? {
            projectId: projectId,
            kubernetesClusterId: parentId,
            workloadIdentifier: QueryHelper.notNull(),
            instanceCount: QueryHelper.greaterThan(0),
          }
        : data.parent.platform === "docker"
          ? {
              projectId: projectId,
              dockerHostId: parentId,
              workloadIdentifier: QueryHelper.notNull(),
              instanceCount: QueryHelper.greaterThan(0),
            }
          : {
              projectId: projectId,
              podmanHostId: parentId,
              workloadIdentifier: QueryHelper.notNull(),
              instanceCount: QueryHelper.greaterThan(0),
            },
    select: select,
    skip: 0,
    limit: MAX_WORKLOAD_ROWS_PER_PARENT,
    props: {
      isRoot: true,
    },
  });

  for (const row of rows) {
    const identifier: string = readText(row.workloadIdentifier);
    if (
      !row.id ||
      !identifier ||
      typeof row.instanceCount !== "number" ||
      data.seenIdentifiers.has(identifier)
    ) {
      continue;
    }

    try {
      await DatabaseServerService.updateColumnsByIdWithoutHooks({
        id: row.id,
        data: {
          instanceCount: 0,
        },
        // A run upserting the workload meanwhile wins.
        expectedData: {
          instanceCount: row.instanceCount,
        },
      });
      data.stats.scaledToZero++;
    } catch (err) {
      logger.error(
        `${JOB_NAME}: resetting the instance count of database ${row.id.toString()} (${identifier}) failed for ${parentLabel(data.parent)}: ${errorMessage(err)}`,
      );
    }
  }
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

export const DISTINCT_CONTAINER_IMAGES_SQL: string = `/* ${JOB_NAME}: distinct container images */
SELECT DISTINCT k."image" AS "image"
FROM "KubernetesContainer" k
WHERE k."projectId" = $1
  AND k."kubernetesClusterId" = $2
  AND k."deletedAt" IS NULL
  AND k."image" IS NOT NULL
LIMIT $3`;

export const POD_INVENTORY_SQL: string = `/* ${JOB_NAME}: pod inventory */
SELECT COUNT(*)::int AS "podCount", MAX(r."lastSeenAt") AS "newestSeenAt"
FROM "KubernetesResource" r
WHERE r."projectId" = $1
  AND r."kubernetesClusterId" = $2
  AND r."kind" = 'Pod'
  AND r."deletedAt" IS NULL`;

/*
 * The pods that could be a database — an operator / chart label key, a
 * database chart name, or a KubernetesContainer running a database image —
 * each with its spec PROJECTED in Postgres: per container its name, image,
 * declared containerPorts and `command ++ args` REDUCED by
 * containerCommandProjectionSql to what classifyKubernetesPod needs to tell
 * a server from a client, keep-alive or Sentinel run: the program's first
 * word and, for a shell, its flags and the command names each of its
 * arguments would run — every name not on CONTAINER_COMMAND_KNOWN_WORDS
 * replaced by "?". env, argument values, script text and the rest of the
 * spec never leave the database. From the pod's status, only what tells a
 * serving member from a crash-looping one: each container's `ready` and
 * `state` (running / waiting / terminated) and the pod's Ready condition
 * (status and lastTransitionTime) — no reason or message text.
 *
 * Ordered by a per-run salted hash of the namespace, so a cluster over the
 * cap has a different set of namespaces left out each run, never the same
 * alphabetical tail.
 *
 * $1 projectId, $2 kubernetesClusterId, $3 operator label keys,
 * $4 chart names (lowercase), $5 database images, $6 run salt, $7 limit,
 * $8 CONTAINER_COMMAND_KNOWN_WORDS.
 */
export const CANDIDATE_PODS_SQL: string = `/* ${JOB_NAME}: candidate database pods */
SELECT
  r."namespaceKey" AS "namespaceKey",
  r."name" AS "name",
  r."phase" AS "phase",
  r."labels" AS "labels",
  r."ownerReferences" AS "ownerReferences",
  r."lastSeenAt" AS "lastSeenAt",
  r."resourceCreationTimestamp" AS "resourceCreationTimestamp",
  r."createdAt" AS "createdAt",
  COALESCE((
    SELECT jsonb_agg(
      jsonb_build_object(
        'name', c.value -> 'name',
        'image', c.value -> 'image',
        'ports', COALESCE((
          SELECT jsonb_agg(p.value -> 'containerPort' ORDER BY p.ordinality)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(c.value -> 'ports') = 'array'
              THEN c.value -> 'ports' ELSE '[]'::jsonb END
          ) WITH ORDINALITY AS p(value, ordinality)
          WHERE jsonb_typeof(p.value) = 'object'
        ), '[]'::jsonb),
        'command', ${containerCommandProjectionSql({
          argv: "v.argv",
          knownWords: "$8::text[]",
        })},
        'ready', cs.value -> 'ready',
        'state', cs.value -> 'state'
      )
      ORDER BY c.ordinality
    )
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(r."spec" -> 'containers') = 'array'
        THEN r."spec" -> 'containers' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS c(value, ordinality)
    CROSS JOIN LATERAL (
      SELECT
        (CASE WHEN jsonb_typeof(c.value -> 'command') = 'array'
          THEN c.value -> 'command' ELSE '[]'::jsonb END)
        || (CASE WHEN jsonb_typeof(c.value -> 'args') = 'array'
          THEN c.value -> 'args' ELSE '[]'::jsonb END) AS argv
    ) AS v
    LEFT JOIN LATERAL (
      SELECT s.value
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(r."status" -> 'containerStatuses') = 'array'
          THEN r."status" -> 'containerStatuses' ELSE '[]'::jsonb END
      ) AS s(value)
      WHERE jsonb_typeof(s.value) = 'object'
        AND s.value ->> 'name' = c.value ->> 'name'
      LIMIT 1
    ) AS cs ON true
    WHERE jsonb_typeof(c.value) = 'object'
  ), '[]'::jsonb) AS "containers",
  (
    SELECT jsonb_build_object(
      'status', rc.value -> 'status',
      'lastTransitionTime', rc.value -> 'lastTransitionTime'
    )
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(r."status" -> 'conditions') = 'array'
        THEN r."status" -> 'conditions' ELSE '[]'::jsonb END
    ) AS rc(value)
    WHERE jsonb_typeof(rc.value) = 'object'
      AND rc.value ->> 'type' = 'Ready'
    LIMIT 1
  ) AS "readyCondition"
FROM "KubernetesResource" r
WHERE r."projectId" = $1
  AND r."kubernetesClusterId" = $2
  AND r."kind" = 'Pod'
  AND r."deletedAt" IS NULL
  AND (
    r."labels" ?| $3::text[]
    OR lower(btrim(r."labels" ->> 'app.kubernetes.io/name')) = ANY($4::text[])
    OR EXISTS (
      SELECT 1
      FROM "KubernetesContainer" k
      WHERE k."projectId" = r."projectId"
        AND k."kubernetesClusterId" = r."kubernetesClusterId"
        AND k."podNamespaceKey" = r."namespaceKey"
        AND k."podName" = r."name"
        AND k."deletedAt" IS NULL
        AND k."image" = ANY($5::text[])
    )
  )
ORDER BY md5(r."namespaceKey" || $6::text), r."namespaceKey", r."name"
LIMIT $7`;

/*
 * A projected container (see CANDIDATE_PODS_SQL) as the classifier's
 * container — read property by property, never spread.
 */
function projectContainers(value: unknown): Array<KubernetesContainerLike> {
  if (!Array.isArray(value)) {
    return [];
  }

  const containers: Array<KubernetesContainerLike> = [];

  for (const container of value) {
    if (!isObject(container)) {
      continue;
    }

    const name: unknown = container["name"];
    const image: unknown = container["image"];
    const declaredPorts: unknown = container["ports"];
    const command: unknown = container["command"];

    const ports: Array<{ containerPort?: number | undefined }> = [];
    if (Array.isArray(declaredPorts)) {
      for (const declared of declaredPorts) {
        // A bare number (the projection) or a { containerPort } object.
        const port: unknown = isObject(declared)
          ? declared["containerPort"]
          : declared;
        // The classifier range-checks; a numeric string is accepted too.
        const parsed: number =
          typeof port === "number"
            ? port
            : typeof port === "string" && port.trim()
              ? Number(port)
              : NaN;
        if (Number.isInteger(parsed)) {
          ports.push({ containerPort: parsed });
        }
      }
    }

    containers.push({
      name: typeof name === "string" ? name : undefined,
      image: typeof image === "string" && image.trim() ? image : undefined,
      ports: ports,
      command: Array.isArray(command)
        ? command.map((entry: unknown): string | null => {
            return typeof entry === "string" ? entry : null;
          })
        : [],
    });
  }

  return containers;
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
 * A candidate Pod row as the classifier's KubernetesPodLike. Images missing
 * from the projected spec are filled in from the pod's KubernetesContainer
 * rows (name → image) when given; with no spec containers at all, those
 * rows are the containers. Null without a name.
 */
export function toKubernetesPodLike(
  row: KubernetesPodRow,
  containerImages?: Array<{ name: string; image: string }> | undefined,
): KubernetesPodLike | null {
  const name: string = readText(row?.name);
  if (!name) {
    return null;
  }

  let containers: Array<KubernetesContainerLike> = projectContainers(
    row.containers,
  );
  const images: Array<{ name: string; image: string }> = containerImages || [];

  if (containers.length === 0) {
    containers = images.map(
      (entry: { name: string; image: string }): KubernetesContainerLike => {
        return { name: entry.name, image: entry.image, ports: [] };
      },
    );
  } else if (images.length > 0) {
    containers = containers.map(
      (container: KubernetesContainerLike): KubernetesContainerLike => {
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
    labels: isObject(row.labels) ? row.labels : {},
    ownerReferences: { items: projectOwnerReferences(row.ownerReferences) },
    spec: { containers: containers },
  };
}

// True when classification would miss an image the projected spec does not carry.
function isMissingImages(row: KubernetesPodRow): boolean {
  const containers: Array<KubernetesContainerLike> = projectContainers(
    row.containers,
  );
  return (
    containers.length === 0 ||
    containers.some((container: KubernetesContainerLike): boolean => {
      return !container.image;
    })
  );
}

function statefulSetOwnerNames(row: KubernetesPodRow): Array<string> {
  return projectOwnerReferences(row.ownerReferences)
    .filter((owner: { kind?: string | undefined }): boolean => {
      return (owner.kind || "").toLowerCase() === "statefulset";
    })
    .map((owner: { name?: string | undefined }): string => {
      return readText(owner.name);
    })
    .filter((ownerName: string): boolean => {
      return ownerName.length > 0;
    });
}

function asRows<T>(result: unknown): Array<T> {
  return Array.isArray(result) ? (result as Array<T>) : [];
}

// The database images among the cluster's distinct container images.
async function loadDatabaseImages(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  clusterLabel: string;
}): Promise<{ images: Array<string>; truncated: boolean }> {
  const rows: Array<{ image?: unknown }> = asRows<{ image?: unknown }>(
    await KubernetesContainerService.getRepository().manager.query(
      DISTINCT_CONTAINER_IMAGES_SQL,
      [
        data.projectId.toString(),
        data.clusterId.toString(),
        MAX_DISTINCT_IMAGES_PER_CLUSTER,
      ],
    ),
  );

  const truncated: boolean = rows.length >= MAX_DISTINCT_IMAGES_PER_CLUSTER;
  if (truncated) {
    logger.warn(
      `${JOB_NAME}: ${data.clusterLabel} runs at least ${MAX_DISTINCT_IMAGES_PER_CLUSTER} distinct container images; images beyond them were not classified this run`,
    );
  }

  const images: Array<string> = [];
  for (const row of rows) {
    const image: string = readText(row?.image);
    if (image && classifyImage(image).kind === "database") {
      images.push(image);
    }
  }

  return { images, truncated };
}

async function loadPodInventoryState(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
}): Promise<{ podCount: number; newest: number | null }> {
  const rows: Array<{ podCount?: unknown; newestSeenAt?: unknown }> = asRows<{
    podCount?: unknown;
    newestSeenAt?: unknown;
  }>(
    await KubernetesResourceService.getRepository().manager.query(
      POD_INVENTORY_SQL,
      [data.projectId.toString(), data.clusterId.toString()],
    ),
  );

  const row: { podCount?: unknown; newestSeenAt?: unknown } = rows[0] || {};
  const podCount: number = Number(row.podCount);

  return {
    podCount: Number.isFinite(podCount) ? podCount : 0,
    newest: toTime(row.newestSeenAt),
  };
}

async function loadCandidatePods(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  clusterLabel: string;
  databaseImages: Array<string>;
  runSalt: string;
}): Promise<{ rows: Array<KubernetesPodRow>; truncated: boolean }> {
  const rows: Array<KubernetesPodRow> = asRows<KubernetesPodRow>(
    await KubernetesResourceService.getRepository().manager.query(
      CANDIDATE_PODS_SQL,
      [
        data.projectId.toString(),
        data.clusterId.toString(),
        [...DATABASE_OPERATOR_LABEL_KEYS],
        [...DATABASE_WORKLOAD_NAME_LABEL_VALUES],
        data.databaseImages,
        data.runSalt,
        MAX_CANDIDATE_PODS_PER_CLUSTER,
        [...CONTAINER_COMMAND_KNOWN_WORDS],
      ],
    ),
  );

  const truncated: boolean = rows.length >= MAX_CANDIDATE_PODS_PER_CLUSTER;
  if (truncated) {
    logger.warn(
      `${JOB_NAME}: ${data.clusterLabel} has at least ${MAX_CANDIDATE_PODS_PER_CLUSTER} pods that could be databases; ${MAX_CANDIDATE_PODS_PER_CLUSTER} were classified this run (a different share of namespaces each run)`,
    );
  }

  return { rows, truncated };
}

// StatefulSet name → spec.serviceName, per namespace, for the named StatefulSets.
async function loadHeadlessServiceNames(data: {
  projectId: ObjectID;
  clusterId: ObjectID;
  clusterLabel: string;
  statefulSetNames: Array<string>;
}): Promise<Map<string, Record<string, string>>> {
  const byNamespace: Map<string, Record<string, string>> = new Map<
    string,
    Record<string, string>
  >();

  if (data.statefulSetNames.length === 0) {
    return byNamespace;
  }

  const statefulSets: Array<KubernetesResource> =
    await KubernetesResourceService.findBy({
      query: {
        projectId: data.projectId,
        kubernetesClusterId: data.clusterId,
        kind: "StatefulSet",
        name: new Includes(data.statefulSetNames),
      },
      select: {
        name: true,
        namespaceKey: true,
        // A StatefulSet row's spec is parsed down to replicas / serviceName / policies.
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
      `${JOB_NAME}: ${data.clusterLabel} has at least ${MAX_STATEFULSETS_PER_CLUSTER} StatefulSets owning database pods; headless Service names beyond them were not read this run`,
    );
  }

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
  parent: DiscoveryParent;
  budget: AutoCreateBudget;
  clusterCountMemo: Map<string, boolean>;
  stats: DiscoveryStats;
  runSalt: string;
}): Promise<void> {
  const clusterIdentifier: string = data.parent.identifier;
  const clusterId: ObjectID = new ObjectID(data.parent.id);
  const projectId: ObjectID = new ObjectID(data.parent.projectId);
  const clusterLabel: string = parentLabel(data.parent);

  const inventory: { podCount: number; newest: number | null } =
    await loadPodInventoryState({ projectId, clusterId });

  // No pod inventory at all (resource specs off, snapshot not in yet) proves nothing.
  if (inventory.podCount === 0) {
    return;
  }

  const databaseImages: { images: Array<string>; truncated: boolean } =
    await loadDatabaseImages({ projectId, clusterId, clusterLabel });

  const candidatePods: { rows: Array<KubernetesPodRow>; truncated: boolean } =
    await loadCandidatePods({
      projectId: projectId,
      clusterId: clusterId,
      clusterLabel: clusterLabel,
      databaseImages: databaseImages.images,
      runSalt: data.runSalt,
    });

  // Pods deleted since the last snapshot are not members any more.
  const pods: Array<KubernetesPodRow> = candidatePods.rows.filter(
    (row: KubernetesPodRow): boolean => {
      return (
        isRow(row) &&
        readText(row.name).length > 0 &&
        isFreshMember(row.lastSeenAt, inventory.newest)
      );
    },
  );

  const podsByKey: Map<string, KubernetesPodRow> = new Map<
    string,
    KubernetesPodRow
  >();
  for (const pod of pods) {
    podsByKey.set(podKey(readText(pod.namespaceKey), readText(pod.name)), pod);
  }

  const headlessServiceNames: Map<
    string,
    Record<string, string>
  > = await loadHeadlessServiceNames({
    projectId: projectId,
    clusterId: clusterId,
    clusterLabel: clusterLabel,
    statefulSetNames: Array.from(
      new Set<string>(pods.flatMap(statefulSetOwnerNames)),
    ),
  });

  const podsMissingImages: Array<string> = Array.from(
    new Set<string>(
      pods.filter(isMissingImages).map((pod: KubernetesPodRow): string => {
        return readText(pod.name);
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
  const poolers: Array<KubernetesPoolerService> = [];
  // Pod (namespace + name) → the container the classifier took for the database.
  const databaseContainerByPod: Map<string, string> = new Map<string, string>();

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
      databaseContainerByPod.set(
        podKey(candidate.namespace, candidate.podName),
        candidate.containerName,
      );
      continue;
    }

    const pooler: KubernetesPoolerService | null =
      classifyKubernetesPoolerPod(podLike);
    if (pooler) {
      poolers.push(pooler);
    }
  }

  const allGroups: Array<KubernetesDatabaseGroup> = attachPoolerServices(
    groupKubernetesDatabaseCandidates(candidates),
    poolers,
  );

  const identifierOf: (group: KubernetesDatabaseGroup) => string = (
    group: KubernetesDatabaseGroup,
  ): string => {
    return buildWorkloadDatabaseServerIdentifier({
      system: group.system,
      platform: "kubernetes",
      parentName: clusterIdentifier,
      namespace: group.namespace,
      workloadKind: group.workloadKind,
      workloadName: group.workloadName,
    });
  };

  const groups: Array<KubernetesDatabaseGroup> = capGroups({
    groups: allGroups,
    keyOf: identifierOf,
    parentLabel: clusterLabel,
    runSalt: data.runSalt,
  });

  const includeUnqualified: boolean =
    groups.length > 0
      ? await projectHasExactlyOneCluster(projectId, data.clusterCountMemo)
      : false;
  const projectIdText: string = projectId.toString();

  for (const group of groups) {
    try {
      const members: Array<KubernetesPodRow> = group.podNames
        .map((podName: string): KubernetesPodRow | undefined => {
          return podsByKey.get(podKey(group.namespace, podName));
        })
        .filter((member: KubernetesPodRow | undefined): boolean => {
          return Boolean(member);
        }) as Array<KubernetesPodRow>;
      const databaseContainerOf: (member: KubernetesPodRow) => string = (
        member: KubernetesPodRow,
      ): string => {
        return (
          databaseContainerByPod.get(
            podKey(group.namespace, readText(member.name)),
          ) || ""
        );
      };
      const running: Array<KubernetesPodRow> = members.filter(
        (member: KubernetesPodRow): boolean => {
          return isRunningKubernetesMember(member, databaseContainerOf(member));
        },
      );

      const memberKeysSeenNow: Array<string> = group.podNames.map(
        (podName: string): string => {
          return keyForKubernetesPod(projectIdText, {
            clusterName: clusterIdentifier,
            namespace: group.namespace,
            podName: podName,
          });
        },
      );

      // Deployment-scoped telemetry, whatever identity the database got.
      for (const owner of group.ownerWorkloads) {
        if (owner.kind === "Deployment") {
          memberKeysSeenNow.push(
            keyForKubernetesDeployment(projectIdText, {
              clusterName: clusterIdentifier,
              namespace: group.namespace,
              deploymentName: owner.name,
            }),
          );
        }
      }

      await upsertWorkload({
        upsert: {
          projectId: projectId,
          workloadIdentifier: identifierOf(group),
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
          instanceCount: running.length,
          dbVersion: group.version || undefined,
          kubernetesClusterId: clusterId,
          kubernetesNamespace: group.namespace || undefined,
          workloadKind: group.workloadKind,
          workloadName: group.workloadName,
        },
        mayCreate: running.some((member: KubernetesPodRow): boolean => {
          return hasProvenLifetime(
            kubernetesMemberTiming(member, databaseContainerOf(member)),
          );
        }),
        budget: data.budget,
        stats: data.stats,
      });
    } catch (err) {
      logger.error(
        `${JOB_NAME}: upserting ${group.system} workload ${group.namespace}/${group.workloadKind}/${group.workloadName} failed for ${clusterLabel}: ${errorMessage(err)}`,
      );
    }
  }

  // A partial view cannot tell a workload that scaled to zero from one it skipped.
  if (databaseImages.truncated || candidatePods.truncated) {
    return;
  }

  await zeroUnseenWorkloads({
    parent: data.parent,
    seenIdentifiers: new Set<string>(allGroups.map(identifierOf)),
    stats: data.stats,
  });
}

// ---- Docker / Podman ------------------------------------------------------

/**
 * Container rows → one entry per database workload (engine FAMILY + Swarm /
 * Compose service, else the container name - the parts of its family-keyed
 * identifier). The group's engine is the most specific its members report
 * (pickMostSpecificDatabaseSystem: a Compose service moved from redis to
 * valkey is one Valkey database while both run), and its version the first
 * one, by container name, of a member running that engine. Stopped
 * containers and rows the host's latest inventory no longer refreshes are
 * ignored; only full 64-hex ids become member keys; instanceCount counts
 * running members and mayCreate says whether one of them has lived
 * MIN_OBSERVED_LIFETIME_MS. Deterministic order.
 */
export function groupContainerDatabases(
  rows: Array<ContainerRowLike>,
): Array<ContainerDatabaseGroup> {
  const byKey: Map<string, ContainerDatabaseGroup> = new Map<
    string,
    ContainerDatabaseGroup
  >();
  // Per group, the engine and version each member reports, by container name.
  const reportsByKey: Map<
    string,
    Array<{ system: string; version: string | null }>
  > = new Map<string, Array<{ system: string; version: string | null }>>();

  const live: Array<ContainerRowLike> = (
    Array.isArray(rows) ? rows : []
  ).filter((row: ContainerRowLike): boolean => {
    return (
      isRow(row) &&
      !STOPPED_CONTAINER_STATE_SET.has(readText(row.state).toLowerCase())
    );
  });

  const newest: number | null = newestSeenAt(live);

  const sorted: Array<ContainerRowLike> = live
    .filter((row: ContainerRowLike): boolean => {
      return isFreshMember(row.lastSeenAt, newest);
    })
    .sort((a: ContainerRowLike, b: ContainerRowLike): number => {
      return compareStrings(readText(a.name), readText(b.name));
    });

  for (const row of sorted) {
    const classification: ContainerDatabaseClassification | null =
      classifyContainer({
        name: readText(row.name),
        imageName: row.imageName,
        containerId: row.containerId,
        labels: isObject(row.labels) ? row.labels : null,
      });

    if (!classification) {
      continue;
    }

    const family: string =
      getDatabaseSystemFamily(classification.system) || classification.system;
    const key: string = `${family}\u0000${classification.workloadName}`;
    let group: ContainerDatabaseGroup | undefined = byKey.get(key);
    if (!group) {
      group = {
        system: classification.system,
        workloadName: classification.workloadName,
        containerNames: [],
        containerIds: [],
        version: null,
        instanceCount: 0,
        mayCreate: false,
      };
      byKey.set(key, group);
    }

    if (group.containerNames.includes(classification.containerName)) {
      continue;
    }
    group.containerNames.push(classification.containerName);

    const reports: Array<{ system: string; version: string | null }> =
      reportsByKey.get(key) || [];
    reports.push({
      system: classification.system,
      version: classification.version,
    });
    reportsByKey.set(key, reports);

    const containerId: string = readText(row.containerId);
    if (
      FULL_CONTAINER_ID_REGEX.test(containerId) &&
      !group.containerIds.includes(containerId)
    ) {
      group.containerIds.push(containerId);
    }

    const state: string = readText(row.state).toLowerCase();
    if (state === "" || state === "running") {
      group.instanceCount++;
      if (hasProvenLifetime(row)) {
        group.mayCreate = true;
      }
    }
  }

  for (const [key, group] of byKey) {
    const reports: Array<{ system: string; version: string | null }> =
      reportsByKey.get(key) || [];
    const system: string =
      pickMostSpecificDatabaseSystem(
        reports.map(
          (report: { system: string; version: string | null }): string => {
            return report.system;
          },
        ),
      ) || group.system;

    group.system = system;
    group.version =
      reports.find(
        (report: { system: string; version: string | null }): boolean => {
          return report.system === system && Boolean(report.version);
        },
      )?.version || null;
  }

  return Array.from(byKey.values()).sort(
    (a: ContainerDatabaseGroup, b: ContainerDatabaseGroup): number => {
      return (
        compareStrings(a.workloadName, b.workloadName) ||
        compareStrings(a.system, b.system)
      );
    },
  );
}

async function findContainerRowPage(data: {
  platform: "docker" | "podman";
  projectId: ObjectID;
  hostId: ObjectID;
  skip: number;
}): Promise<Array<ContainerRowLike>> {
  const select: {
    name: true;
    containerId: true;
    imageName: true;
    state: true;
    labels: true;
    lastSeenAt: true;
    resourceCreationTimestamp: true;
    createdAt: true;
  } = {
    name: true,
    containerId: true,
    imageName: true,
    state: true,
    // Read for the Compose / Swarm / Testcontainers keys only (see classifyContainer).
    labels: true,
    lastSeenAt: true,
    resourceCreationTimestamp: true,
    createdAt: true,
  };

  if (data.platform === "docker") {
    const rows: Array<DockerResource> = await DockerResourceService.findBy({
      query: {
        projectId: data.projectId,
        dockerHostId: data.hostId,
        kind: "Container",
        state: QueryHelper.notIn([...STOPPED_CONTAINER_STATES]),
      },
      select: select,
      sort: {
        name: SortOrder.Ascending,
      },
      skip: data.skip,
      limit: CONTAINER_PAGE_SIZE,
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
      state: QueryHelper.notIn([...STOPPED_CONTAINER_STATES]),
    },
    select: select,
    sort: {
      name: SortOrder.Ascending,
    },
    skip: data.skip,
    limit: CONTAINER_PAGE_SIZE,
    props: {
      isRoot: true,
    },
  });
  return rows;
}

async function loadContainerRows(data: {
  platform: "docker" | "podman";
  projectId: ObjectID;
  hostId: ObjectID;
  hostLabel: string;
}): Promise<{ rows: Array<ContainerRowLike>; truncated: boolean }> {
  const rows: Array<ContainerRowLike> = [];

  for (let skip: number = 0; ; skip += CONTAINER_PAGE_SIZE) {
    const page: Array<ContainerRowLike> = await findContainerRowPage({
      platform: data.platform,
      projectId: data.projectId,
      hostId: data.hostId,
      skip: skip,
    });
    rows.push(...page);

    if (page.length < CONTAINER_PAGE_SIZE) {
      return { rows, truncated: false };
    }

    if (skip + CONTAINER_PAGE_SIZE >= MAX_CONTAINERS_PER_HOST) {
      logger.warn(
        `${JOB_NAME}: ${data.hostLabel} has at least ${MAX_CONTAINERS_PER_HOST} containers that are not stopped; only the first ${MAX_CONTAINERS_PER_HOST} were classified this run`,
      );
      return { rows, truncated: true };
    }
  }
}

async function discoverContainerHost(data: {
  parent: DiscoveryParent;
  budget: AutoCreateBudget;
  stats: DiscoveryStats;
  runSalt: string;
}): Promise<void> {
  const platform: "docker" | "podman" =
    data.parent.platform === "podman" ? "podman" : "docker";
  const hostIdentifier: string = data.parent.identifier;
  const hostId: ObjectID = new ObjectID(data.parent.id);
  const projectId: ObjectID = new ObjectID(data.parent.projectId);
  const hostLabel: string = parentLabel(data.parent);

  const loaded: { rows: Array<ContainerRowLike>; truncated: boolean } =
    await loadContainerRows({
      platform: platform,
      projectId: projectId,
      hostId: hostId,
      hostLabel: hostLabel,
    });

  // Nothing inventoried at all proves nothing about the databases.
  if (loaded.rows.length === 0) {
    return;
  }

  /*
   * Nor does an inventory the host stopped refreshing: judged against now,
   * not against its own newest row, so a host whose agent went away (or a
   * duplicate registration holding one old row) never counts yesterday's
   * containers as running instances.
   */
  const newest: number | null = newestSeenAt(loaded.rows);
  if (newest !== null && Date.now() - newest > STALE_HOST_INVENTORY_MS) {
    logger.debug(
      `${JOB_NAME}: ${hostLabel} has not refreshed its container inventory for ${Math.round((Date.now() - newest) / 60000)} min; its databases are left as they are this run`,
    );
    return;
  }

  const identifierOf: (group: ContainerDatabaseGroup) => string = (
    group: ContainerDatabaseGroup,
  ): string => {
    return buildWorkloadDatabaseServerIdentifier({
      system: group.system,
      platform: platform,
      parentName: hostIdentifier,
      workloadName: group.workloadName,
    });
  };

  const allGroups: Array<ContainerDatabaseGroup> = groupContainerDatabases(
    loaded.rows,
  );
  const groups: Array<ContainerDatabaseGroup> = capGroups({
    groups: allGroups,
    keyOf: identifierOf,
    parentLabel: hostLabel,
    runSalt: data.runSalt,
  });

  const projectIdText: string = projectId.toString();

  for (const group of groups) {
    try {
      await upsertWorkload({
        upsert: {
          projectId: projectId,
          workloadIdentifier: identifierOf(group),
          dbSystem: group.system,
          displayName: buildDatabaseServerDisplayName({
            system: group.system,
            workloadName: group.workloadName,
          }),
          discoverySource:
            platform === "docker"
              ? DatabaseServerDiscoverySource.Docker
              : DatabaseServerDiscoverySource.Podman,
          aliases: [],
          memberKeysSeenNow: group.containerIds.map(
            (containerId: string): string => {
              return keyForContainer(projectIdText, containerId);
            },
          ),
          instanceCount: group.instanceCount,
          dbVersion: group.version || undefined,
          workloadKind: "Container",
          workloadName: group.workloadName,
          ...(platform === "docker"
            ? { dockerHostId: hostId }
            : { podmanHostId: hostId }),
        },
        mayCreate: group.mayCreate,
        budget: data.budget,
        stats: data.stats,
      });
    } catch (err) {
      logger.error(
        `${JOB_NAME}: upserting ${group.system} container workload ${group.workloadName} failed for ${hostLabel}: ${errorMessage(err)}`,
      );
    }
  }

  if (loaded.truncated) {
    return;
  }

  await zeroUnseenWorkloads({
    parent: data.parent,
    seenIdentifiers: new Set<string>(allGroups.map(identifierOf)),
    stats: data.stats,
  });
}

// ---- the run ------------------------------------------------------------------

async function discoverDatabases(): Promise<void> {
  const startedAt: number = Date.now();
  const deadline: number = startedAt + RUN_BUDGET_MS;
  // Rotates which namespaces / workloads a cap leaves out, run to run.
  const runSalt: string = String(startedAt);

  const budget: AutoCreateBudget = new AutoCreateBudget();
  const stats: DiscoveryStats = {
    parents: 0,
    failedParents: 0,
    databases: 0,
    created: 0,
    overBudget: 0,
    deferred: 0,
    scaledToZero: 0,
  };
  const clusterCountMemo: Map<string, boolean> = new Map<string, boolean>();

  // Each platform listed in its own try: a Kubernetes outage never stops Docker.
  const listed: Array<DiscoveryParent> = [];
  for (const platform of PLATFORMS) {
    try {
      listed.push(...(await listConnectedParents(platform)));
    } catch (err) {
      logger.error(
        `${JOB_NAME}: listing connected ${parentKindLabel(platform)} failed: ${errorMessage(err)}`,
      );
    }
  }

  const deduped: {
    kept: Array<DiscoveryParent>;
    skipped: Array<DiscoveryParent>;
  } = dedupeParentsByIdentifier(listed);
  const parents: Array<DiscoveryParent> = deduped.kept;

  if (deduped.skipped.length > 0) {
    logger.warn(
      `${JOB_NAME}: ${deduped.skipped.length} connected cluster(s) / host(s) share an identifier with a more recently seen one and were not discovered (a duplicate registration): ${deduped.skipped
        .slice(0, 10)
        .map(parentLabel)
        .join(", ")}`,
    );
  }

  if (parents.length === 0) {
    return;
  }

  const ordered: Array<DiscoveryParent> = orderParentsForRun(
    parents,
    await readCursor(),
  );

  let visited: number = 0;
  let cursorWritable: boolean = true;

  for (const parent of ordered) {
    if (visited > 0 && Date.now() >= deadline) {
      break;
    }

    /*
     * The cursor moves BEFORE the work: a parent that kills the worker is
     * passed over by the next run instead of being retried forever.
     */
    cursorWritable = await writeCursor(
      parentRotationKey(parent),
      !cursorWritable,
    );

    visited++;
    stats.parents++;

    try {
      if (parent.platform === "kubernetes") {
        await discoverKubernetesCluster({
          parent: parent,
          budget: budget,
          clusterCountMemo: clusterCountMemo,
          stats: stats,
          runSalt: runSalt,
        });
      } else {
        await discoverContainerHost({
          parent: parent,
          budget: budget,
          stats: stats,
          runSalt: runSalt,
        });
      }
    } catch (err) {
      stats.failedParents++;
      logger.error(
        `${JOB_NAME}: discovery failed for ${parentLabel(parent)}: ${errorMessage(err)}`,
      );
    }
  }

  if (visited < ordered.length) {
    logger.warn(
      `${JOB_NAME}: visited ${visited} of ${ordered.length} connected clusters / hosts within the ${Math.round(RUN_BUDGET_MS / 1000)} s run budget; the next run continues with the rest`,
    );
  }

  if (stats.overBudget > 0) {
    logger.warn(
      `${JOB_NAME}: ${stats.overBudget} new database workload(s) were not created because their project reached its auto-create budget (DATABASE_SERVER_AUTO_CREATE_BUDGET)`,
    );
  }

  if (
    stats.databases > 0 ||
    stats.failedParents > 0 ||
    stats.deferred > 0 ||
    stats.scaledToZero > 0
  ) {
    logger.debug(
      `${JOB_NAME}: upserted ${stats.databases} database workload(s) (${stats.created} new, ${stats.deferred} waiting to prove they are long-lived, ${stats.scaledToZero} scaled to zero) across ${stats.parents} connected cluster(s) / host(s); ${stats.failedParents} failed`,
    );
  }
}

RunCron(
  JOB_NAME,
  {
    schedule: EVERY_FIVE_MINUTE,
    runOnStartup: false,
    timeoutInMS: JOB_TIMEOUT_MS,
  },
  async (): Promise<void> => {
    /*
     * One run at a time, fleet-wide: the queue materializes the next tick
     * while a slow run is still going, and its timeout never cancels one.
     * acquireAttemptsLimit 1 — never queue behind the run in flight; the
     * next tick comes in 5 minutes anyway.
     */
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: RUN_LOCK_KEY,
        namespace: DISCOVERY_CACHE_NAMESPACE,
        lockTimeout: RUN_LOCK_TIMEOUT_MS,
        acquireAttemptsLimit: 1,
      });
    } catch (err) {
      logger.debug(
        `${JOB_NAME}: another run holds the discovery lock (or Redis is unavailable); skipping this tick: ${errorMessage(err)}`,
      );
      return;
    }

    const held: SemaphoreMutex = mutex;

    try {
      await discoverDatabases();
    } catch (err) {
      logger.error(`${JOB_NAME}: discovery failed: ${errorMessage(err)}`);
    } finally {
      try {
        await Semaphore.release(held);
      } catch (err) {
        logger.error(
          `${JOB_NAME}: releasing the discovery lock failed (it expires on its own): ${errorMessage(err)}`,
        );
      }
    }
  },
);
