import { ExpressRequest } from "Common/Server/Utils/Express";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import KubernetesClusterService from "Common/Server/Services/KubernetesClusterService";
import DockerHostService from "Common/Server/Services/DockerHostService";
import PodmanHostService from "Common/Server/Services/PodmanHostService";
import ProxmoxClusterService from "Common/Server/Services/ProxmoxClusterService";
import VMwareVCenterService from "Common/Server/Services/VMwareVCenterService";
import IoTFleetService from "Common/Server/Services/IoTFleetService";
import CephClusterService from "Common/Server/Services/CephClusterService";
import StorageArrayService from "Common/Server/Services/StorageArrayService";
import { StorageSystemUtil } from "Common/Types/StorageArray/StorageSystem";
import DockerSwarmClusterService from "Common/Server/Services/DockerSwarmClusterService";
import ProxmoxResourceService from "Common/Server/Services/ProxmoxResourceService";
import HostService from "Common/Server/Services/HostService";
import Host from "Common/Models/DatabaseModels/Host";
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import CloudResourceService, {
  CloudMonitoredResourceFindOrCreateResult,
} from "Common/Server/Services/CloudResourceService";
import RumApplicationService from "Common/Server/Services/RumApplicationService";
import ServerlessFunctionInstanceService from "Common/Server/Services/ServerlessFunctionInstanceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import RumApplicationClientService from "Common/Server/Services/RumApplicationClientService";
import DatabaseServerService, {
  DatabaseServerCollectorReport,
} from "Common/Server/Services/DatabaseServerService";
import DatabaseServerEndpointService, {
  DatabaseServerEndpointClaimResult,
} from "Common/Server/Services/DatabaseServerEndpointService";
import DatabaseServer from "Common/Models/DatabaseModels/DatabaseServer";
import DatabaseServerDiscoverySource from "Common/Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseEndpoint,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
} from "Common/Types/DatabaseServer/DatabaseEndpoint";
import {
  getDatabaseReceiverSystemHint,
  getDatabaseSystemDisplayName,
  isKnownDatabaseSystem,
} from "Common/Types/DatabaseServer/DatabaseSystem";
import {
  DATABASE_AGENT_ATTRIBUTE,
  DATABASE_SERVER_ID_ATTRIBUTE,
  DATABASE_SYSTEM_ATTRIBUTES,
  resolveDatabaseFromResourceAttributes,
} from "Common/Types/DatabaseServer/DatabaseTelemetryResolver";
import LabelService from "Common/Server/Services/LabelService";
import { extractOneuptimeLabelNames } from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import logger from "Common/Server/Utils/Logger";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import InProcessMemo from "Common/Server/Utils/InProcessMemo";
import OTelIngestService, {
  ScalarEntityKeys,
  TelemetryServiceMetadata,
  emptyScalarEntityKeys,
} from "Common/Server/Services/OpenTelemetryIngestService";
import ServiceType from "Common/Types/Telemetry/ServiceType";
import EntityType from "Common/Types/Telemetry/EntityType";
import TelemetryUtil, {
  AttributeType,
} from "Common/Server/Utils/Telemetry/Telemetry";
import InventoryItem, {
  EntityExtractionResult,
  ExtractedEntity,
  ResourceEntityRef,
} from "Common/Server/Utils/Telemetry/TelemetryEntity";
import { reconcileEntityRegistryThrottled } from "Common/Server/Utils/Telemetry/EntityRegistry";
import TelemetryChangeDetector from "Common/Server/Utils/Telemetry/ChangeDetection/TelemetryChangeDetector";
import { TelemetryRequest } from "Common/Server/Middleware/TelemetryIngest";
import {
  canonicalizeEntityValue,
  keyForDatabaseEndpoint,
  keyForDatabaseServerRow,
} from "Common/Utils/Telemetry/EntityKey";
import { normalizeHostIpAddresses } from "Common/Utils/Telemetry/HostIpAddresses";
import Dictionary from "Common/Types/Dictionary";
import {
  FAAS_CLOUD_PLATFORM_VALUES,
  MANAGED_CLOUD_PLATFORM_VALUES,
  buildCloudEnvironmentKey,
  buildCloudEnvironmentName,
  getCloudProviderForPlatform,
  normalizeCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import { resolveCloudInstanceName } from "Common/Utils/Telemetry/CloudInstanceIdentity";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
} from "Common/Types/Cloud/CloudMonitoredResource";
import EventLoop from "Common/Server/Utils/EventLoop";
import SingleFlight from "Common/Server/Utils/SingleFlight";
import PostgresErrorTranslator from "Common/Server/Utils/Database/PostgresErrorTranslator";
import DiscoveredResourceIdCache, {
  DiscoveredResourceKind,
  DiscoveredResourceKindName,
  DiscoveredResourceKinds,
} from "Common/Server/Utils/Telemetry/DiscoveredResourceIdCache";
import { ResourceHeartbeatResult } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";

/*
 * A maintenance fence that one autoDiscover* attempt armed, recorded so
 * that attempt's catch block can release what it armed — and only what it
 * armed, never a fence another worker is holding. See
 * OtelIngestBaseService.releaseMaintenanceFences.
 */
type MaintenanceFence = {
  scope: string;
  id: string;
};

/*
 * A resource ingest discovers, as it names it: its kind, its project and the
 * value its telemetry reports (a host name, a cluster name, a cloud
 * environment's key), plus what a new cloud environment is created with.
 * Plain data - kept for a while (discoveredResourceIdentities) to resolve
 * the resource again when its id turns out gone, it holds on to nothing else
 * of the batch.
 */
export interface DiscoveredResourceIdentity {
  kindName: DiscoveredResourceKindName;
  projectId: ObjectID;
  identity: string;
  cloudEnvironment?:
    | {
        name: string;
        cloudPlatform: string;
        cloudProvider?: string | undefined;
        cloudRegion?: string | undefined;
        cloudAccountId?: string | undefined;
      }
    | undefined;
}

/*
 * A database's id, with the key of the database-server-id cache it was found
 * (or kept) under: an endpoint's, or a linked id's.
 */
type CachedDatabaseServerId = {
  id: string;
  cacheKey: string;
};

/*
 * What resolveDatabaseFromResourceAttributes says about one resource batch:
 * that it is a database's own telemetry (a collector DB receiver, the
 * Database Agent), the engine, and the server — by endpoint, by the
 * `oneuptime.database.server.id` link, or both.
 */
export type DatabaseServerResourceResolution = {
  system: string;
  endpoint: DatabaseEndpoint | null;
  linkedDatabaseServerId: string | null;
  displayName: string | null;
  version: string | null;
  /*
   * Whether the endpoint may become a server's identity — created as a row
   * or claimed as an alias (never a pod IP or a namespace-expanded single
   * label; see isStableCollectorEndpoint).
   */
  endpointIsStable: boolean;
  // Whether the endpoint may create a row by itself (stable + creatable engine).
  allowCreate: boolean;
};

/*
 * Which Serverless Function one resource batch belongs to, as
 * OtelIngestBaseService.resolveServerlessFunctionIdentity decides it — the
 * single rule behind both the ServerlessFunction row's functionIdentifier
 * and the `resource.faas.name` the batch's rows store.
 */
export type ServerlessFunctionIdentity = {
  // Trimmed; what findOrCreateByFunctionIdentifier keys the row on.
  functionIdentifier: string;
  /*
   * Where it came from: the resource's own faas.name, or — on a FaaS
   * cloud.platform whose detector sets no faas.name — its service.name.
   */
  source: "faas.name" | "service.name";
  // Canonical cloud.platform (normalizeCloudPlatform), or null when absent.
  cloudPlatform: string | null;
};

/*
 * What autoDiscoverHost is asked about one resource block: its attributes,
 * whether its metrics carry a host agent's system.* / process.* signal, the
 * resources the block already resolved to (any of which keeps it from being
 * a Host), and the stats the Host's heartbeat records.
 */
type HostDiscovery = {
  projectId: ObjectID;
  attributes: JSONArray;
  hasInfraSignal?: boolean;
  dockerHostId?: ObjectID | null;
  podmanHostId?: ObjectID | null;
  kubernetesClusterId?: ObjectID | null;
  databaseServerId?: ObjectID | null;
  cpuCores?: number | undefined;
  totalMemoryBytes?: number | undefined;
  processCount?: number | undefined;
};

/*
 * A resource block autoDiscoverRum matched: a browser's or a mobile app's
 * telemetry (clientType), from the application its service.name names.
 */
type RumApplicationMatch = {
  clientType: string;
  appIdentifier: string;
};

export default abstract class OtelIngestBaseService {
  private static readonly DOCKER_CONTAINER_NAME_CACHE_NAMESPACE: string =
    "docker-container-name";
  private static readonly DOCKER_CONTAINER_NAME_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  private static readonly PODMAN_CONTAINER_NAME_CACHE_NAMESPACE: string =
    "podman-container-name";
  private static readonly PODMAN_CONTAINER_NAME_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  /*
   * Per-resource Postgres maintenance (updateLastSeen, label promotion)
   * runs on every ingest batch even when nothing has changed. With 100
   * concurrent telemetry workers and many resources per batch, those
   * UPDATEs dominate Postgres pool occupancy and starve dashboard auth
   * queries. Fence each (scope, id) pair behind a short Redis TTL so
   * we only re-run the maintenance work once per window.
   *
   * This fence MUST be race-safe. It used to be a read-then-write, on the
   * reasoning that "two workers re-running updateLastSeen at the same instant
   * is harmless". That held at two workers. At 100 pods and ~25K concurrent
   * jobs it did not: every worker that read the absent key in the same instant
   * proceeded, so a fence meant to admit one writer per window admitted all of
   * them, and the resulting row-lock convoy on ~2,300 Service rows took
   * production down (1,017 connections, 892 parked on locks, the tail waiting
   * 3.7 hours). The claim below is a single atomic SET NX: exactly one caller
   * wins regardless of how many arrive together.
   *
   * The TTL is jittered so a fleet-wide restart cannot re-synchronise every
   * resource's window and rebuild the herd on a five-minute period.
   *
   * lastSeenAt staleness is bounded by this TTL (at most +25% from jitter, so
   * 6.25 minutes), so every markDisconnected* threshold in the *Service
   * classes must stay well above it (they use 15 minutes, still 2.4x). A
   * threshold at or near the TTL flaps healthy resources between connected and
   * disconnected.
   */
  private static readonly MAINTENANCE_FENCE_NAMESPACE: string =
    "otel-maintenance-fence";
  private static readonly MAINTENANCE_FENCE_TTL_SECONDS: number = 5 * 60; // 5 minutes

  /*
   * L1 short-circuit for the fence above. The SET NX claim is atomic but it
   * is still one Redis round trip PER DISCOVERED RESOURCE PER RESOURCE
   * BLOCK, serialized — a hostmetrics payload with hundreds of
   * ResourceMetrics pays hundreds of round trips per job even when the
   * fence has been held for minutes. Once this process has SEEN the fence
   * refused for a (scope, id), that refusal stays true for the rest of the
   * fence window, so re-asking Redis every block buys nothing.
   *
   * ONLY the negative outcome ("fence already held — do not run") is
   * memoed, never the positive. A cached positive would tell this pod "you
   * hold the fence, run the maintenance" for work a COMPETING pod may have
   * armed-and-failed in the meantime (releaseMaintenanceFences deletes the
   * Redis key precisely so the next attempt anywhere retries immediately) —
   * suppressing a retry another pod is entitled to. A cached negative
   * merely delays THIS pod's next claim attempt by at most the memo TTL,
   * which the 5-minute fence window (and the 15-minute markDisconnected*
   * thresholds sized against it) already tolerates.
   *
   * 30 seconds = min(60s, MAINTENANCE_FENCE_TTL_SECONDS / 10): a released
   * fence is retried by this pod within 30s (other pods immediately), and
   * lastSeenAt staleness grows by at most 30s over the fence TTL's own
   * bound. clearMaintenanceFence deletes the local entry too, so a release
   * this process performs is visible to itself immediately.
   */
  private static readonly MAINTENANCE_FENCE_NEGATIVE_MEMO_TTL_SECONDS: number = 30; // min(60s, MAINTENANCE_FENCE_TTL_SECONDS / 10)
  private static readonly maintenanceFenceNegativeMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs:
        OtelIngestBaseService.MAINTENANCE_FENCE_NEGATIVE_MEMO_TTL_SECONDS *
        1000,
      maxEntries: 10_000,
    });

  protected static async shouldRunMaintenance(
    scope: string,
    id: string,
  ): Promise<boolean> {
    const fenceKey: string = `${scope}:${id}`;

    // L1: a recently observed refusal. Zero network cost.
    if (this.maintenanceFenceNegativeMemo.get(fenceKey)) {
      return false;
    }

    try {
      const acquired: boolean = await GlobalCache.setStringIfNotExists(
        this.MAINTENANCE_FENCE_NAMESPACE,
        fenceKey,
        "1",
        {
          expiresInSeconds: GlobalCache.withJitter(
            this.MAINTENANCE_FENCE_TTL_SECONDS,
          ),
        },
      );

      /*
       * Cache ONLY the refusal — see the memo comment above for why a
       * cached positive would be unsafe under a competing pod's release.
       */
      if (!acquired) {
        this.maintenanceFenceNegativeMemo.set(fenceKey, true);
      }

      return acquired;
    } catch {
      // If the cache is down, default to running the maintenance.
      return true;
    }
  }

  /*
   * Release the maintenance fence for a (scope, id) pair after the
   * gated work (updateLastSeen + label promotion) failed. The fence is
   * armed on *attempt* — inside shouldRunMaintenance, before the work
   * runs — to collapse the steady-state write storm from many workers.
   * If the work then throws, the fence would otherwise suppress every
   * retry for the full TTL window, leaving lastSeenAt stale and
   * stranding the resource as "disconnected" even while telemetry keeps
   * flowing. Clearing it lets the next ingest batch retry immediately.
   * Best-effort: if the cache is unavailable the fence just expires on
   * its own TTL.
   */
  protected static async clearMaintenanceFence(
    scope: string,
    id: string,
  ): Promise<void> {
    /*
     * Drop the local negative memo first so this process retries on its
     * very next batch — without this, a fence released here (because the
     * gated work failed) would still look "held" to this pod for up to the
     * memo TTL even though the Redis key is gone.
     */
    this.maintenanceFenceNegativeMemo.delete(`${scope}:${id}`);
    try {
      await GlobalCache.deleteKey(
        this.MAINTENANCE_FENCE_NAMESPACE,
        `${scope}:${id}`,
      );
    } catch {
      // best-effort — the fence TTL will expire the key regardless.
    }
  }

  /*
   * Release every fence an autoDiscover* attempt armed. Each of those
   * methods records its fences in a local `armedFences` array as it arms
   * them and calls this from its catch block, so a transient failure
   * anywhere in the method (Postgres contention on a hot row, a label
   * upsert that lost a race) costs one retry rather than a full 5-minute
   * window of suppressed lastSeenAt refreshes.
   *
   * Recording what was armed — rather than re-deriving a key in the catch —
   * is what keeps this safe under concurrency: when shouldRunMaintenance
   * says another worker already holds the fence, nothing is recorded, so a
   * failure here can never clear a window that worker is relying on.
   *
   * It is deliberately all-or-nothing WITHIN one attempt: a method with two
   * fences (the *-instance / rum-client live-inventory fences run under
   * their own) releases both even if only the later one failed. The cost of
   * that is bounded and small — updateLastSeen and attachLabels each carry
   * their own 60-second throttle, so redoing them next batch is at most one
   * extra UPDATE per minute, the same tradeoff already accepted for two
   * callers sharing one extras fingerprint. Tracking per-fence success to
   * shave that off is not worth the extra invariant.
   */
  protected static async releaseMaintenanceFences(
    fences: Array<MaintenanceFence>,
  ): Promise<void> {
    for (const fence of fences) {
      await this.clearMaintenanceFence(fence.scope, fence.id);
    }
  }

  /*
   * What an autoDiscover* method discovers in one resource block - a
   * cluster's name, a function's identity, a database's endpoint - read
   * before any span starts. Most blocks carry nothing a given method
   * discovers, and its span, one per block, used to end right there in
   * microseconds: about 25 spans of a ~120-span telemetry job's trace. So
   * each autoDiscover* method reads its match here, undecorated, and only a
   * match goes on to the discovery: a method of its own that keeps the
   * span's name, and keeps the try/catch that releases the fences it arms.
   * It is named discoverMatched*: never autoDiscover*, which the fence and
   * L1-memo suites enumerate, and nothing a subclass might call its own
   * static - a static is called through `this`, so a subclass's method of
   * the same name would run instead.
   *
   * A read that throws - a null attribute entry - fails the discovery as it
   * always has: logged, and nothing discovered.
   */
  private static readDiscoveryMatch<T>(data: {
    resource: string;
    read: () => T | null;
  }): T | null {
    try {
      return data.read();
    } catch (err) {
      logger.error(
        `Error auto-discovering ${data.resource}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /*
   * The ids of discovered resources - "(project, what the telemetry
   * reports) -> Postgres row id", one Redis namespace per kind (host-id,
   * docker-host-id, k8s-cluster-id, …) - are kept by
   * DiscoveredResourceIdCache (Common/Server/Utils/Telemetry): a 60-second
   * L1 in this process in front of Redis, so the steady state costs no
   * network round trip at all, and a hostmetrics payload with hundreds of
   * ResourceMetrics does not pay hundreds of GETs per job for ids that have
   * not changed in days.
   *
   * Deleting a resource forgets its ids in Redis and in the deleting
   * process's L1 (DatabaseService calls DiscoveredResourceIdCache.afterDelete
   * for every delete). Another process keeps an id it read before the
   * delete for at most the L1's minute - or less: the moment a write finds
   * its row gone, ingest resolves the resource again
   * (resolveGoneDiscoveredResourceId), which is also what corrects an id
   * cached before deletes forgot anything (issue #5214).
   *
   * How each id was resolved, by `<namespace>:<id>`, so a write that finds
   * the row gone can resolve the resource again. Ten minutes: longer than a
   * batch takes from discovery to its last flush.
   */
  private static readonly discoveredResourceIdentities: InProcessMemo<DiscoveredResourceIdentity> =
    new InProcessMemo<DiscoveredResourceIdentity>({
      ttlInMs: 10 * 60 * 1000,
      maxEntries: 10_000,
    });

  /*
   * The row that answers for a resource now, by `<namespace>:<gone id>`: the
   * later writes of a batch that found the row gone go to it without asking
   * Postgres again.
   */
  private static readonly discoveredResourceReplacements: InProcessMemo<string> =
    new InProcessMemo<string>({
      ttlInMs: 60 * 1000,
      maxEntries: 10_000,
    });

  /*
   * L1 for the docker/podman container id -> name Redis caches
   * (getDockerServiceName / getPodmanServiceName): otherwise every
   * docker_stats metrics block pays one serialized SETEX and every filelog
   * log block one GET, per resource block per job. Entries store the RAW
   * (pre-normalization) name so memo hits and Redis hits normalize through
   * the same function, and only POSITIVES are memoed — a memoed miss would
   * delay first-contact name resolution and route that container's log rows
   * to the DockerHost/PodmanHost entity for the TTL. On the write path the
   * memo is set only after a successful Redis write, so an outage retries
   * on the next block exactly as before. Same 60-second L1 in front of a day
   * in Redis as the discovered resources' ids.
   */
  private static readonly containerNameL1Memo: InProcessMemo<string> =
    new InProcessMemo<string>({
      ttlInMs: 60 * 1000,
      maxEntries: 10_000,
    });

  /**
   * Read a discovered entity id through L1 -> L2 (Redis). Returns null when
   * neither layer has it — the caller then runs its findOrCreate* path and
   * stores the result via setEntityIdInCaches. Redis errors propagate
   * exactly as GlobalCache.getString's always have (each autoDiscover*
   * catch block turns them into a skipped discovery), EXCEPT when the L1
   * already holds the id — an L1 hit never touches the network, so a
   * recently resolved entity keeps resolving through a Redis outage.
   */
  private static async getEntityIdFromCaches(
    namespace: string,
    cacheKey: string,
  ): Promise<string | null> {
    return await DiscoveredResourceIdCache.get(namespace, cacheKey);
  }

  /**
   * Store a freshly resolved entity id in both layers. The L1 write happens
   * first so a Redis outage (setString throws, surfacing to the caller's
   * catch block exactly as before) still leaves this process able to serve
   * the id for the L1 TTL.
   */
  private static async setEntityIdInCaches(
    namespace: string,
    cacheKey: string,
    entityIdStr: string,
    redisExpiresInSeconds: number,
  ): Promise<void> {
    await DiscoveredResourceIdCache.set(
      namespace,
      cacheKey,
      entityIdStr,
      redisExpiresInSeconds,
    );
  }

  /**
   * Drop every in-process L1 memo (entity ids, container names, fence
   * refusals). For tests only — suites that reuse one resource id across
   * cases need a way to simulate the TTLs expiring, the same way they
   * already clear their fake Redis maps between cases.
   */
  public static clearInProcessMemos(): void {
    DiscoveredResourceIdCache.clearInProcessMemo();
    this.discoveredResourceIdentities.clear();
    this.discoveredResourceReplacements.clear();
    this.containerNameL1Memo.clear();
    this.maintenanceFenceNegativeMemo.clear();
    this.unresolvedDatabaseServerMemo.clear();
    this.unresolvedCloudMonitoredResourceMemo.clear();
  }

  /*
   * The id of a discovered resource: from this process's L1, else Redis,
   * else Postgres - found, or created as on first contact
   * (findOrCreateDiscoveredResource) - and then kept in both layers.
   * Resolutions of one new resource that meet in this process share one
   * lookup; across processes, the unique index each kind has on what it is
   * found by keeps it to one row (the create that loses reads the row that
   * won). Remembers how the id was resolved, so a write that finds the row
   * gone can resolve the resource again (resolveGoneDiscoveredResourceId).
   */
  protected static async resolveDiscoveredResourceId(
    resource: DiscoveredResourceIdentity,
  ): Promise<string | null> {
    const kind: DiscoveredResourceKind =
      DiscoveredResourceKinds[resource.kindName];
    const key: string = DiscoveredResourceIdCache.keyFor(
      resource.projectId,
      resource.identity,
    );

    let id: string | null = await this.getEntityIdFromCaches(
      kind.namespace,
      key,
    );

    if (!id) {
      id = await SingleFlight.run(
        `discovered-resource:${kind.namespace}:${key}`,
        async (): Promise<string | null> => {
          const found: string | null =
            await this.findOrCreateDiscoveredResource(resource, {
              fresh: false,
            });

          if (found) {
            await this.setEntityIdInCaches(
              kind.namespace,
              key,
              found,
              kind.expiresInSeconds,
            );
          }

          return found;
        },
      );
    }

    if (id) {
      this.discoveredResourceIdentities.set(
        `${kind.namespace}:${id}`,
        resource,
      );
    }

    return id;
  }

  /*
   * The row a discovered resource names, found - or created, as on first
   * contact - by its kind's service. `fresh` asks past any memo of the
   * answer the service keeps (HostService keeps one for a minute), for a
   * resolution after the cached id turned out gone. The id, or null when no
   * row answers.
   */
  protected static async findOrCreateDiscoveredResource(
    resource: DiscoveredResourceIdentity,
    options: { fresh: boolean },
  ): Promise<string | null> {
    const projectId: ObjectID = resource.projectId;
    const identity: string = resource.identity;

    let row: { _id?: string | undefined; id?: ObjectID | null } | null = null;

    switch (resource.kindName) {
      case "KubernetesCluster":
        row = await KubernetesClusterService.findOrCreateByClusterIdentifier({
          projectId: projectId,
          clusterIdentifier: identity,
        });
        break;
      case "ProxmoxCluster":
        row = await ProxmoxClusterService.findOrCreateByName({
          projectId: projectId,
          name: identity,
        });
        break;
      case "VMwareVCenter":
        row = await VMwareVCenterService.findOrCreateByName({
          projectId: projectId,
          name: identity,
        });
        break;
      case "IoTFleet":
        row = await IoTFleetService.findOrCreateByName({
          projectId: projectId,
          name: identity,
        });
        break;
      case "DockerSwarmCluster":
        row = await DockerSwarmClusterService.findOrCreateByName({
          projectId: projectId,
          name: identity,
        });
        break;
      case "CephCluster":
        row = await CephClusterService.findOrCreateByName({
          projectId: projectId,
          name: identity,
        });
        break;
      case "StorageArray":
        row = await StorageArrayService.findOrCreateByName({
          projectId: projectId,
          name: identity,
        });
        break;
      case "ServerlessFunction":
        row = await ServerlessFunctionService.findOrCreateByFunctionIdentifier({
          projectId: projectId,
          functionIdentifier: identity,
        });
        break;
      case "CloudResource":
        row = await CloudResourceService.findOrCreateByResourceIdentifier({
          projectId: projectId,
          resourceIdentifier: identity,
          name: resource.cloudEnvironment?.name,
          cloudPlatform: resource.cloudEnvironment?.cloudPlatform,
          cloudProvider: resource.cloudEnvironment?.cloudProvider,
          cloudRegion: resource.cloudEnvironment?.cloudRegion,
          cloudAccountId: resource.cloudEnvironment?.cloudAccountId,
        });
        break;
      case "RumApplication":
        row = await RumApplicationService.findOrCreateByAppIdentifier({
          projectId: projectId,
          appIdentifier: identity,
        });
        break;
      case "DockerHost":
        row = await DockerHostService.findOrCreateByHostIdentifier({
          projectId: projectId,
          hostIdentifier: identity,
        });
        break;
      case "PodmanHost":
        row = await PodmanHostService.findOrCreateByHostIdentifier({
          projectId: projectId,
          hostIdentifier: identity,
        });
        break;
      case "Host":
        row = await HostService.findOrCreateByHostIdentifier({
          projectId: projectId,
          hostIdentifier: identity,
          ...(options.fresh ? { bypassMemo: true } : {}),
        });
        break;
      default:
        // Resolved their own way: by endpoint, by a cloud resource, by name.
        return null;
    }

    if (!row) {
      return null;
    }

    if (row._id) {
      return row._id.toString();
    }

    return row.id ? row.id.toString() : null;
  }

  /*
   * A discovered resource's id turned out to name no row: its heartbeat
   * found nothing to write to, or a write of its rows was refused by the
   * foreign key to it. The resource was deleted while the id sat in a cache
   * (issue #5214) - another process's L1, Redis from before deletes forgot
   * anything, or a worker that read the row just before the delete and put
   * it back. The id is forgotten in both layers - in Redis only while it
   * still names the gone row, so an answer another worker already found
   * stays - and the resource resolved again past every memo: the row that
   * answers for it now, or a new one created as on first contact, so its
   * heartbeat, resources and labels go there. Resolutions in this process
   * share one lookup; across processes the unique index keeps it to one row.
   * Null when this process does not know how the id was resolved, or no row
   * answers.
   */
  protected static async resolveGoneDiscoveredResourceId(data: {
    kind: DiscoveredResourceKind;
    goneId: string;
  }): Promise<string | null> {
    const memoKey: string = `${data.kind.namespace}:${data.goneId}`;

    const replaced: string | undefined =
      this.discoveredResourceReplacements.get(memoKey);

    if (replaced) {
      return replaced;
    }

    const resource: DiscoveredResourceIdentity | undefined =
      this.discoveredResourceIdentities.get(memoKey);

    if (!resource) {
      return null;
    }

    return await SingleFlight.run(
      `discovered-resource-gone:${memoKey}`,
      async (): Promise<string | null> => {
        const key: string = DiscoveredResourceIdCache.keyFor(
          resource.projectId,
          resource.identity,
        );

        await DiscoveredResourceIdCache.forget({
          namespace: data.kind.namespace,
          key: key,
          id: data.goneId,
        });

        const id: string | null = await this.findOrCreateDiscoveredResource(
          resource,
          { fresh: true },
        );

        if (!id || id === data.goneId) {
          return null;
        }

        try {
          await this.setEntityIdInCaches(
            data.kind.namespace,
            key,
            id,
            data.kind.expiresInSeconds,
          );
        } catch (err) {
          // The L1 has it; Redis is told by the next resolution that misses.
          logger.warn(
            `Could not cache the id of ${data.kind.tableName} "${resource.identity}": ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        this.discoveredResourceIdentities.set(
          `${data.kind.namespace}:${id}`,
          resource,
        );
        this.discoveredResourceReplacements.set(memoKey, id);

        logger.info(
          `${data.kind.tableName} ${data.goneId} ("${resource.identity}") is gone - it was deleted while its id was cached. Its data now goes to ${id}.`,
        );

        return id;
      },
    );
  }

  /*
   * The fenced maintenance of a discovered resource the batch resolved - its
   * heartbeat (lastSeenAt, status, what the agent reports), then its labels
   * - once per resource per fence window however many batches arrive. When
   * the heartbeat finds the row gone, the resource is resolved again
   * (resolveGoneDiscoveredResourceId) and the batch goes on with the row
   * that answers now: it gets the heartbeat and the labels at once. Returns
   * the id the batch carries; null when no row answers.
   */
  protected static async maintainDiscoveredResource(data: {
    kind: DiscoveredResourceKind;
    id: string;
    fenceScope: string;
    armedFences: Array<MaintenanceFence>;
    heartbeat: (id: ObjectID) => Promise<ResourceHeartbeatResult>;
    promoteLabels?: ((id: ObjectID) => Promise<void>) | undefined;
  }): Promise<string | null> {
    let id: string = data.id;

    if (!(await this.shouldRunMaintenance(data.fenceScope, id))) {
      return id;
    }

    data.armedFences.push({ scope: data.fenceScope, id: id });

    const heartbeat: ResourceHeartbeatResult | undefined = await data.heartbeat(
      new ObjectID(id),
    );

    if (heartbeat?.isRowGone) {
      const replacement: string | null =
        await this.resolveGoneDiscoveredResourceId({
          kind: data.kind,
          goneId: id,
        });

      if (!replacement) {
        return null;
      }

      id = replacement;

      if (await this.shouldRunMaintenance(data.fenceScope, id)) {
        data.armedFences.push({ scope: data.fenceScope, id: id });
        await data.heartbeat(new ObjectID(id));
      }
    }

    if (data.promoteLabels) {
      await data.promoteLabels(new ObjectID(id));
    }

    return id;
  }

  /*
   * A write of rows that belong to a discovered resource - its containers,
   * its inventory, an instance - against the id this batch resolved. When
   * the foreign key to the resource refuses it because that row is gone (it
   * was deleted while the id was cached), the write is not lost: the
   * resource is resolved again and the write runs once more, against the
   * row that answers now. Returns the id the write landed on, for the rest
   * of the same flush. Any other failure, or a resource that cannot be
   * resolved again, is thrown as before.
   */
  protected static async writeForDiscoveredResource(data: {
    kind: DiscoveredResourceKind;
    id: string;
    write: (id: ObjectID) => Promise<void>;
  }): Promise<string> {
    try {
      await data.write(new ObjectID(data.id));
      return data.id;
    } catch (error) {
      if (!PostgresErrorTranslator.isMissingRowOf(error, data.kind.tableName)) {
        throw error;
      }

      const replacement: string | null =
        await this.resolveGoneDiscoveredResourceId({
          kind: data.kind,
          goneId: data.id,
        });

      if (!replacement) {
        throw error;
      }

      await data.write(new ObjectID(replacement));

      return replacement;
    }
  }

  /*
   * Resolves a real (user-facing) service name from OTel resource
   * attributes. Returns null when the batch is host- / docker-host-
   * level telemetry that should be routed to the matching Host or
   * DockerHost record via `primaryEntityId` instead of synthesising a
   * phantom Service row. The caller (OTelIngestService.resolveTelemetryResource)
   * is responsible for that routing decision and picks the right
   * `ServiceType` discriminator for the analytics row.
   *
   * Returns null for batches with no signal at all (no service.name,
   * no docker container, no host / k8s / docker resource signal) too —
   * the caller tags those with the projectId under ServiceType.Unknown
   * rather than synthesising a shared "Unknown Service" Service row.
   */
  protected static async getServiceNameFromAttributes(
    req: ExpressRequest,
    attributes: JSONArray,
  ): Promise<string | null> {
    /*
     * Client / RUM telemetry (browser.* / device.*) is owned by its
     * RumApplication, not a Service. Return null so
     * resolveTelemetryResource routes the batch to the RealUserMonitor
     * branch (primaryEntityId = rumApplicationId) instead of synthesising a
     * duplicate Service row for the same browser / mobile app. There is no
     * OTel attribute that identifies a RUM app other than service.name, so
     * we keep service.name as the RumApplication's dedup key but never let
     * it create a Service.
     */
    if (this.getRumClientType(attributes)) {
      return null;
    }

    for (const attribute of attributes) {
      if (
        attribute["key"] === "service.name" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        if (
          typeof (attribute["value"] as JSONObject)["stringValue"] === "string"
        ) {
          return (attribute["value"] as JSONObject)["stringValue"] as string;
        }
      }
    }

    const serviceName: string = req.headers[
      "x-oneuptime-service-name"
    ] as string;

    if (serviceName) {
      return serviceName;
    }

    /*
     * Docker-aware fallback: when telemetry arrives from a OneUptime Docker
     * Agent (container.runtime == "docker"), there is no explicit
     * service.name. Synthesize a per-container service name so each
     * container shows up as its own service in the OneUptime UI instead of
     * every Docker log collapsing into "Unknown Service". A container
     * name is a meaningful logical service (e.g. "oneuptime-postgres")
     * and is intentionally still backed by a Service row. Batches that
     * only carry container.id with no resolvable name fall through to
     * null and get routed to the DockerHost record instead.
     */
    if (this.isDockerRuntime(attributes)) {
      const dockerServiceName: string | null = await this.getDockerServiceName(
        req,
        attributes,
      );
      if (dockerServiceName) {
        return dockerServiceName;
      }
    }

    /*
     * Podman-aware fallback: when telemetry arrives from a OneUptime Podman
     * Agent (container.runtime == "podman"), there is no explicit
     * service.name. Synthesize a per-container service name so each
     * container shows up as its own service in the OneUptime UI instead of
     * every Podman log collapsing into "Unknown Service". A container
     * name is a meaningful logical service (e.g. "oneuptime-postgres")
     * and is intentionally still backed by a Service row. Batches that
     * only carry container.id with no resolvable name fall through to
     * null and get routed to the PodmanHost record instead.
     */
    if (this.isPodmanRuntime(attributes)) {
      const podmanServiceName: string | null = await this.getPodmanServiceName(
        req,
        attributes,
      );
      if (podmanServiceName) {
        return podmanServiceName;
      }
    }

    /*
     * Host-level telemetry (OTel hostmetrics receiver, infrastructure
     * agent over OTLP, eBPF profiler) without an explicit service.name
     * used to be folded into a synthetic `host/<name>` Service row,
     * which duplicated the Host record we already create via
     * `autoDiscoverHost`. Return null here so the caller routes the
     * batch through the resource's own id in `resolveTelemetryResource`
     * — Host id when `autoDiscoverHost` accepted the batch, otherwise
     * DockerHost / KubernetesCluster id.
     *
     * Phantom-host gating still lives in `autoDiscoverHost` — if the
     * batch only carries application-SDK-detected host.name (no
     * os.type / container.runtime), no Host row is created. K8s
     * batches carrying any supported Kubernetes identity are also rejected by
     * `autoDiscoverHost` so they route via their Kubernetes entity instead.
     */
    const hostName: string | null = this.getHostNameFromAttributes(attributes);
    if (hostName && this.hasHostResourceSignal(attributes)) {
      return null;
    }

    /*
     * No service.name, no header, no docker container name, no host
     * resource signal. Return null so the caller routes this batch to
     * the projectId-backed ServiceType.Unknown bucket instead of a
     * synthesised "Unknown Service" Service row.
     */
    return null;
  }

  /*
   * One-stop resolver used by every OTel / syslog / fluent ingest
   * path. Takes the already-discovered Host / DockerHost /
   * KubernetesCluster ids for this batch and dispatches:
   *
   *   1. Explicit service.name / x-oneuptime-service-name header
   *      / docker container name  →  ServiceType.OpenTelemetry,
   *      primaryEntityId = Service._id (created on first contact via
   *      `telemetryServiceFromName`).
   *   1b. Else if a DatabaseServer was discovered — the batch is that
   *      database's engine telemetry (collector DB receiver or the
   *      Database Agent) → ServiceType.DatabaseServer, primaryEntityId =
   *      DatabaseServer._id, serviceName `database/<name>`. Above the Host
   *      and KubernetesCluster branches — deliberately: such a batch
   *      carries the host.name / os.type (or k8s.cluster.name) of where the
   *      collector runs, which is not what it describes, so a receiver
   *      batch that used to land on that Host or cluster now belongs to the
   *      database, with the database's retention. The only exception is a
   *      single resource block that itself also carries host metrics
   *      (system.* / process.*): the metrics caller then passes no
   *      databaseServerId and the block stays a Host. A collector's
   *      receivers each emit their own resource block, so a database
   *      receiver added to a hostmetrics pipeline is NOT such a block.
   *   2. Else if a Host was auto-discovered for this batch →
   *      ServiceType.Host, primaryEntityId = Host._id. Avoids the old
   *      `host/<name>` phantom-Service duplication.
   *   3. Else if a DockerHost was discovered →
   *      ServiceType.DockerHost, primaryEntityId = DockerHost._id.
   *      Catches docker batches that carry only container.id but
   *      no resolvable container name.
   *   4. Else if a KubernetesCluster was discovered →
   *      ServiceType.KubernetesCluster, primaryEntityId = Cluster._id.
   *      Rare in practice — most k8s batches also carry host.name
   *      and route via #2.
   *   4b. Else if a ProxmoxCluster / CephCluster was discovered →
   *      ServiceType.ProxmoxCluster / ServiceType.CephCluster,
   *      primaryEntityId = cluster row id. The shipped Proxmox / Ceph
   *      agent configs use the OTel prometheus receiver, which
   *      synthesizes `service.name` (= scrape job name) on every batch;
   *      both configs therefore explicitly DELETE service.name /
   *      service.instance.id in their resource processor and stamp only
   *      `proxmox.cluster.name` / `ceph.cluster.name`, so their batches
   *      land here instead of registering a phantom Service via #1.
   *      The PVE 9+ native OTLP push stamps service.name="proxmox-ve";
   *      the metrics ingest drops it (and fills proxmox.cluster.name
   *      from PVE's own proxmox.cluster) before routing — see
   *      ProxmoxNativePush.normalizeProxmoxNativePushInPlace — so it
   *      lands here too. Any other source that keeps a service.name
   *      still routes via #1 — cluster discovery and the
   *      attribute-scoped dashboards work regardless, but per-cluster
   *      retention only applies to batches that land here.
   *   4b'. Else if a StorageArray was discovered → ServiceType.StorageArray,
   *      primaryEntityId = array row id, serviceName `storage-array/<name>`.
   *      Same reason as Ceph: the shipped Storage Array Agent configs use the
   *      prometheus receiver, which synthesizes service.name, so they DELETE
   *      service.name / service.instance.id and stamp only
   *      `storage.array.name` (+ `storage.system`).
   *   4c. Else if a VMwareVCenter was discovered → ServiceType.VMwareVCenter,
   *      primaryEntityId = vCenter row id, serviceName `vmware/<name>`.
   *      The OTel `vcenter` receiver does not synthesize a service.name,
   *      so the shipped VMware Agent config only has to stamp
   *      `vmware.vcenter.name` (it still deletes service.name /
   *      service.instance.id defensively, so an OTEL_RESOURCE_ATTRIBUTES
   *      override cannot route the batch to a phantom Service via #1 and
   *      bypass per-vCenter retention).
   *   5. Fallback: no Service row at all. primaryEntityId = projectId,
   *      ServiceType.Unknown. The read side groups these under a
   *      synthetic "Unknown Service" bucket. No oneuptime.label.*
   *      promotion happens here — there is no owning resource, which
   *      is what stops label-less telemetry from collapsing into one
   *      row that accumulates every label.
   */
  @CaptureSpan()
  protected static async resolveTelemetryResource(data: {
    req: ExpressRequest;
    attributes: JSONArray;
    projectId: ObjectID;
    hostId?: ObjectID | null;
    dockerHostId?: ObjectID | null;
    podmanHostId?: ObjectID | null;
    kubernetesClusterId?: ObjectID | null;
    proxmoxClusterId?: ObjectID | null;
    vmwareVCenterId?: ObjectID | null;
    cephClusterId?: ObjectID | null;
    storageArrayId?: ObjectID | null;
    dockerSwarmClusterId?: ObjectID | null;
    serverlessFunctionId?: ObjectID | null;
    cloudResourceId?: ObjectID | null;
    rumApplicationId?: ObjectID | null;
    iotFleetId?: ObjectID | null;
    /*
     * The database this block is the engine telemetry of AND describes —
     * the primary-entity candidate. Also keeps the heuristic Host entity
     * (the collector machine's host.name) off the block's entity keys.
     */
    databaseServerId?: ObjectID | null;
    databaseServerName?: string | null;
    /*
     * The database whose `oneuptime.database.server.id` the block's rows are
     * stamped with, primary or not (a host agent's block that also scrapes a
     * database keeps its Host primary). Its row key is appended, so the
     * rows are that database's telemetry whatever endpoint — or none — the
     * batch reported. `databaseServerId` is keyed the same way.
     */
    stampedDatabaseServerId?: ObjectID | null;
    /*
     * The database endpoint whose key the rows carry (see
     * getDatabaseEndpointForEntityKey): the batch's endpoint when no row
     * claimed the batch by id. Keys the rows even when no DatabaseServer row
     * exists for it (a LOCAL-scope endpoint), so a row created or aliased
     * later finds the telemetry that came before it.
     */
    databaseServerEndpoint?: DatabaseEndpoint | null;
    /*
     * OTLP `Resource.entity_refs` decoded for this batch (see
     * `OtelPayloadDecoder.getEntityRefsFromResource`). When present and
     * non-empty they are the authoritative entity source; the extractor
     * falls back to its heuristic resolvers otherwise.
     */
    entityRefs?: Array<ResourceEntityRef> | undefined;
  }): Promise<TelemetryServiceMetadata> {
    /*
     * (a) pick the single primary entity via the precedence ladder — the
     * `primaryEntityId`/`primaryEntityType` contract is unchanged — and
     * (b) derive the full multi-entity membership set from the same
     * resource attributes, so the row can belong to many entities
     * (service + host + k8s.pod + ...) while still being primarily owned
     * by one. (b) is additive; see OpenTelemetryEntities.md.
     */
    const metadata: TelemetryServiceMetadata =
      await this.selectPrimaryEntity(data);

    /*
     * Entity derivation is pure + synchronous (a hash of the attributes +
     * projectId), so stamping `entityKeys` never blocks ingest on a
     * registry lookup. Raw resource attributes are flattened with an empty
     * prefix so keys stay semconv-native (`service.name`, `host.id`,
     * `k8s.pod.name`, ...) — the form the extractor expects.
     */
    const flatAttributes: Dictionary<AttributeType | Array<AttributeType>> =
      TelemetryUtil.getAttributes({
        items: data.attributes,
        prefixKeysWithString: "",
      });

    /*
     * Branch #1 of the ladder above resolves a Service the resource itself
     * never names: from the `x-oneuptime-service-name` header, or from the
     * container name a Docker / Podman Agent batch carries in place of a
     * `service.name`. The heuristic Service resolver reads `service.name`
     * and nothing else, so those batches were stamped with an empty
     * `serviceEntityKey` and an `entityKeys` set with no service in it —
     * while `primaryEntityId` pointed straight at that same Service row.
     * Every per-service read (grouping, a `serviceEntityKey` filter, the
     * per-service rollups) therefore missed them.
     *
     * Put the resolved name back into the attribute the resolver reads, so
     * one extraction feeds the primary entity, the membership keys and the
     * registry alike, and the key matches the `keyForService` the
     * name-only paths (syslog / fluent) already stamp.
     *
     * Only when the resource is silent — a `service.name` the producer sent
     * is never replaced — and only on the heuristic path: a producer that
     * sent `entity_refs` is authoritative and is not second-guessed, even
     * when none of its refs is usable and extraction falls back to the
     * heuristic resolvers.
     */
    if (
      metadata.primaryEntityType === ServiceType.OpenTelemetry &&
      metadata.serviceName &&
      !flatAttributes["service.name"] &&
      !(data.entityRefs && data.entityRefs.length > 0)
    ) {
      flatAttributes["service.name"] = metadata.serviceName;
    }

    /*
     * A database's own engine telemetry carries the host.name of the
     * machine its collector runs on (or, for the sqlserver / oracledb
     * receivers, the database server's name) — not a Host this batch
     * describes. The heuristic Host entity would mint an Inventory Host for
     * it and put the database's rows on that Host's pages, so it is left
     * out; a producer's explicit entity_refs still win.
     */
    const extraction: EntityExtractionResult =
      InventoryItem.extractEntitiesWithRetirements({
        projectId: data.projectId.toString(),
        attributes: flatAttributes,
        entityRefs: data.entityRefs,
        ...(data.databaseServerId
          ? { suppressHeuristicEntityTypes: [EntityType.Host] }
          : {}),
      });
    const entities: Array<ExtractedEntity> = extraction.entities;

    /*
     * One extraction feeds both columns (extractEntityKeys would re-run
     * the whole extraction): the sorted membership set (entities are
     * already deduped by key) and the per-type scalar key map.
     */
    metadata.entityKeys = entities
      .map((e: ExtractedEntity) => {
        return e.entityKey;
      })
      .sort();
    metadata.scalarEntityKeys = this.scalarEntityKeysFromEntities(entities);

    /*
     * A database's own telemetry also belongs to its row and/or its
     * endpoint. Both keys are membership-only (EntityType.DatabaseServer is
     * never resolver-emitted nor promoted to an InventoryItem), so they are
     * appended here, after the extraction, and never reach the registry
     * reconciliation below.
     */
    metadata.entityKeys = this.withDatabaseEndpointEntityKey({
      entityKeys: metadata.entityKeys,
      projectId: data.projectId,
      endpoint: data.databaseServerEndpoint,
    });
    metadata.entityKeys = this.withDatabaseServerRowEntityKeys({
      entityKeys: metadata.entityKeys,
      projectId: data.projectId,
      databaseServerIds: [data.databaseServerId, data.stampedDatabaseServerId],
    });

    /*
     * Forward-only, throttled, best-effort registry reconciliation.
     * Fire-and-forget: all errors are swallowed inside, so it can never
     * fail or delay signal ingest.
     */
    void reconcileEntityRegistryThrottled({
      projectId: data.projectId,
      entities,
      retiredEntities: extraction.retiredEntities,
    });

    /*
     * A new service.version, or a Deployment's new ReplicaSet, is a change
     * worth recording (TelemetryChangeDetector). Fire-and-forget like the
     * registry above: it answers from an in-process memo in the steady
     * state and never fails or delays ingest.
     */
    TelemetryChangeDetector.observeResource({
      projectId: data.projectId,
      metadata,
      attributes: data.attributes,
      kubernetesClusterId: data.kubernetesClusterId,
      observedAt: (data.req as TelemetryRequest).receivedAt,
    });

    return metadata;
  }

  /*
   * Project the extracted entity set onto the six scalar per-type key
   * columns ('' when that type is absent from the resource). First
   * entity of a type wins — the heuristic resolvers emit at most one
   * per type, and entity_refs duplicates are already deduped by key.
   */
  private static scalarEntityKeysFromEntities(
    entities: Array<ExtractedEntity>,
  ): ScalarEntityKeys {
    const scalar: ScalarEntityKeys = emptyScalarEntityKeys();

    for (const entity of entities) {
      switch (entity.entityType) {
        case EntityType.Service:
          scalar.serviceEntityKey = scalar.serviceEntityKey || entity.entityKey;
          break;
        case EntityType.Host:
          scalar.hostEntityKey = scalar.hostEntityKey || entity.entityKey;
          break;
        case EntityType.KubernetesPod:
          scalar.k8sPodEntityKey = scalar.k8sPodEntityKey || entity.entityKey;
          break;
        case EntityType.KubernetesNode:
          scalar.k8sNodeEntityKey = scalar.k8sNodeEntityKey || entity.entityKey;
          break;
        case EntityType.KubernetesCluster:
          scalar.k8sClusterEntityKey =
            scalar.k8sClusterEntityKey || entity.entityKey;
          break;
        case EntityType.Container:
          scalar.containerEntityKey =
            scalar.containerEntityKey || entity.entityKey;
          break;
        default:
          break;
      }
    }

    return scalar;
  }

  @CaptureSpan()
  private static async selectPrimaryEntity(data: {
    req: ExpressRequest;
    attributes: JSONArray;
    projectId: ObjectID;
    hostId?: ObjectID | null;
    dockerHostId?: ObjectID | null;
    podmanHostId?: ObjectID | null;
    kubernetesClusterId?: ObjectID | null;
    proxmoxClusterId?: ObjectID | null;
    vmwareVCenterId?: ObjectID | null;
    cephClusterId?: ObjectID | null;
    storageArrayId?: ObjectID | null;
    dockerSwarmClusterId?: ObjectID | null;
    serverlessFunctionId?: ObjectID | null;
    cloudResourceId?: ObjectID | null;
    rumApplicationId?: ObjectID | null;
    iotFleetId?: ObjectID | null;
    databaseServerId?: ObjectID | null;
    databaseServerName?: string | null;
  }): Promise<TelemetryServiceMetadata> {
    const serviceName: string | null = await this.getServiceNameFromAttributes(
      data.req,
      data.attributes,
    );

    if (serviceName !== null) {
      return await OTelIngestService.telemetryServiceFromName({
        serviceName,
        projectId: data.projectId,
        resourceAttributes: data.attributes,
      });
    }

    /*
     * Above the Host branch: a collector that scrapes a database usually
     * carries the host.name / os.type of the machine it runs on, and that
     * machine is not what the batch describes. autoDiscoverHost already
     * refused to create a Host for it; this keeps a Host that exists anyway
     * (discovered from another batch) from owning the database's data.
     */
    if (data.databaseServerId) {
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: data.databaseServerName
          ? `database/${data.databaseServerName}`
          : this.DATABASE_SERVER_FALLBACK_NAME,
        resourceId: data.databaseServerId,
        primaryEntityType: ServiceType.DatabaseServer,
        projectId: data.projectId,
      });
    }

    const hostName: string | null = this.getHostNameFromAttributes(
      data.attributes,
    );

    if (data.hostId) {
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: hostName ? `host/${hostName}` : "Host",
        resourceId: data.hostId,
        primaryEntityType: ServiceType.Host,
        projectId: data.projectId,
      });
    }

    if (data.dockerHostId) {
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: hostName ? `docker-host/${hostName}` : "Docker Host",
        resourceId: data.dockerHostId,
        primaryEntityType: ServiceType.DockerHost,
        projectId: data.projectId,
      });
    }

    if (data.podmanHostId) {
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: hostName ? `podman-host/${hostName}` : "Podman Host",
        resourceId: data.podmanHostId,
        primaryEntityType: ServiceType.PodmanHost,
        projectId: data.projectId,
      });
    }

    if (data.kubernetesClusterId) {
      const clusterName: string | null = this.getClusterNameFromAttributes(
        data.attributes,
      );
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: clusterName ? `k8s/${clusterName}` : "Kubernetes Cluster",
        resourceId: data.kubernetesClusterId,
        primaryEntityType: ServiceType.KubernetesCluster,
        projectId: data.projectId,
      });
    }

    if (data.proxmoxClusterId) {
      const clusterName: string | null =
        this.getProxmoxClusterNameFromAttributes(data.attributes);
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: clusterName ? `proxmox/${clusterName}` : "Proxmox Cluster",
        resourceId: data.proxmoxClusterId,
        primaryEntityType: ServiceType.ProxmoxCluster,
        projectId: data.projectId,
      });
    }

    if (data.cephClusterId) {
      const clusterName: string | null = this.getCephClusterNameFromAttributes(
        data.attributes,
      );
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: clusterName ? `ceph/${clusterName}` : "Ceph Cluster",
        resourceId: data.cephClusterId,
        primaryEntityType: ServiceType.CephCluster,
        projectId: data.projectId,
      });
    }

    if (data.storageArrayId) {
      const arrayName: string | null = this.getStorageArrayNameFromAttributes(
        data.attributes,
      );
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: arrayName ? `storage-array/${arrayName}` : "Storage Array",
        resourceId: data.storageArrayId,
        primaryEntityType: ServiceType.StorageArray,
        projectId: data.projectId,
      });
    }

    if (data.dockerSwarmClusterId) {
      const clusterName: string | null =
        this.getDockerSwarmClusterNameFromAttributes(data.attributes);
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: clusterName
          ? `docker-swarm/${clusterName}`
          : "Docker Swarm Cluster",
        resourceId: data.dockerSwarmClusterId,
        primaryEntityType: ServiceType.DockerSwarmCluster,
        projectId: data.projectId,
      });
    }

    if (data.vmwareVCenterId) {
      const vcenterName: string | null =
        this.getVMwareVCenterNameFromAttributes(data.attributes);
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: vcenterName ? `vmware/${vcenterName}` : "vCenter",
        resourceId: data.vmwareVCenterId,
        primaryEntityType: ServiceType.VMwareVCenter,
        projectId: data.projectId,
      });
    }

    if (data.serverlessFunctionId) {
      const faasName: string | null =
        this.getStringAttribute(data.attributes, "faas.name") ||
        this.getStringAttribute(data.attributes, "service.name");
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: faasName
          ? `serverless/${faasName}`
          : "Serverless Function",
        resourceId: data.serverlessFunctionId,
        primaryEntityType: ServiceType.ServerlessFunction,
        projectId: data.projectId,
      });
    }

    if (data.cloudResourceId) {
      const resourceName: string | null =
        this.getStringAttribute(data.attributes, "service.name") ||
        this.getStringAttribute(data.attributes, "host.name");
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: resourceName ? `cloud/${resourceName}` : "Cloud Resource",
        resourceId: data.cloudResourceId,
        primaryEntityType: ServiceType.CloudResource,
        projectId: data.projectId,
      });
    }

    if (data.rumApplicationId) {
      const appName: string | null = this.getStringAttribute(
        data.attributes,
        "service.name",
      );
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: appName ? `rum/${appName}` : "RUM Application",
        resourceId: data.rumApplicationId,
        primaryEntityType: ServiceType.RealUserMonitor,
        projectId: data.projectId,
      });
    }

    if (data.iotFleetId) {
      const fleetName: string | null = this.getIoTFleetNameFromAttributes(
        data.attributes,
      );
      return await OTelIngestService.buildResourceMetadataForNonService({
        serviceName: fleetName ? `iot/${fleetName}` : "IoT Fleet",
        resourceId: data.iotFleetId,
        primaryEntityType: ServiceType.IoTDevice,
        projectId: data.projectId,
      });
    }

    /*
     * Truly nameless telemetry: no service.name, no docker container,
     * and no host / docker / k8s resource was discovered for this
     * batch. Tag it with the projectId in the primaryEntityId slot under
     * ServiceType.Unknown and create no Service row. Crucially we go
     * through buildResourceMetadataForNonService (not
     * telemetryServiceFromName), so no oneuptime.label.* attributes are
     * promoted — that is what prevents every label-less source from
     * collapsing into a single "Unknown Service" row that accumulates
     * all labels. Retention falls back to the project default.
     */
    return await OTelIngestService.buildResourceMetadataForNonService({
      serviceName: "Unknown Service",
      resourceId: data.projectId,
      primaryEntityType: ServiceType.Unknown,
      projectId: data.projectId,
    });
  }

  private static async getDockerServiceName(
    req: ExpressRequest,
    attributes: JSONArray,
  ): Promise<string | null> {
    const containerName: string | null = this.getStringAttribute(
      attributes,
      "container.name",
    );
    const containerId: string | null = this.getStringAttribute(
      attributes,
      "container.id",
    );

    /*
     * docker_stats metric batches carry both container.id and
     * container.name as resource attributes, while filelog-originated log
     * batches only carry container.id (the filelog receiver has no way to
     * query the Docker API for names). Cache the id -> name mapping off
     * the metrics path so later log batches for the same container can
     * resolve to a proper service name.
     */
    if (containerId && containerName) {
      try {
        const projectId: ObjectID | undefined = (
          req as ExpressRequest & { projectId?: ObjectID }
        ).projectId;
        if (projectId) {
          const l1Key: string = `${this.DOCKER_CONTAINER_NAME_CACHE_NAMESPACE}:${projectId.toString()}:${containerId}`;
          // Skip the SETEX when this process already wrote this exact name.
          if (this.containerNameL1Memo.get(l1Key) !== containerName) {
            await GlobalCache.setString(
              this.DOCKER_CONTAINER_NAME_CACHE_NAMESPACE,
              `${projectId.toString()}:${containerId}`,
              containerName,
              {
                expiresInSeconds:
                  this.DOCKER_CONTAINER_NAME_CACHE_EXPIRY_SECONDS,
              },
            );
            // Only after a successful write — a failed write must retry.
            this.containerNameL1Memo.set(l1Key, containerName);
          }
        }
      } catch (err) {
        logger.error(
          "Error caching Docker container name: " + (err as Error).message,
        );
      }
    }

    if (containerName) {
      return this.normalizeDockerContainerName(containerName);
    }

    // Logs path: try the id -> name cache populated by the metrics path.
    if (containerId) {
      try {
        const projectId: ObjectID | undefined = (
          req as ExpressRequest & { projectId?: ObjectID }
        ).projectId;
        if (projectId) {
          const l1Key: string = `${this.DOCKER_CONTAINER_NAME_CACHE_NAMESPACE}:${projectId.toString()}:${containerId}`;
          const memoed: string | undefined =
            this.containerNameL1Memo.get(l1Key);
          if (memoed !== undefined) {
            return this.normalizeDockerContainerName(memoed);
          }
          const cached: string | null = await GlobalCache.getString(
            this.DOCKER_CONTAINER_NAME_CACHE_NAMESPACE,
            `${projectId.toString()}:${containerId}`,
          );
          if (cached) {
            // Positives only — see containerNameL1Memo.
            this.containerNameL1Memo.set(l1Key, cached);
            return this.normalizeDockerContainerName(cached);
          }
        }
      } catch (err) {
        logger.error(
          "Error reading Docker container name cache: " +
            (err as Error).message,
        );
      }
    }

    /*
     * No resolvable container identity. Used to synthesise
     * `docker/<hostName>/<shortId>` / `docker/<hostName>` / `docker/<shortId>`
     * service rows, which created a duplicate alongside the DockerHost
     * record `autoDiscoverDockerHost` had just upserted from the same
     * batch. The caller now routes the batch through the DockerHost id
     * with ServiceType.DockerHost.
     */
    return null;
  }

  private static async getPodmanServiceName(
    req: ExpressRequest,
    attributes: JSONArray,
  ): Promise<string | null> {
    const containerName: string | null = this.getStringAttribute(
      attributes,
      "container.name",
    );
    const containerId: string | null = this.getStringAttribute(
      attributes,
      "container.id",
    );

    /*
     * docker_stats metric batches carry both container.id and
     * container.name as resource attributes, while filelog-originated log
     * batches only carry container.id (the filelog receiver has no way to
     * query the Podman API for names). Cache the id -> name mapping off
     * the metrics path so later log batches for the same container can
     * resolve to a proper service name.
     */
    if (containerId && containerName) {
      try {
        const projectId: ObjectID | undefined = (
          req as ExpressRequest & { projectId?: ObjectID }
        ).projectId;
        if (projectId) {
          const l1Key: string = `${this.PODMAN_CONTAINER_NAME_CACHE_NAMESPACE}:${projectId.toString()}:${containerId}`;
          // Skip the SETEX when this process already wrote this exact name.
          if (this.containerNameL1Memo.get(l1Key) !== containerName) {
            await GlobalCache.setString(
              this.PODMAN_CONTAINER_NAME_CACHE_NAMESPACE,
              `${projectId.toString()}:${containerId}`,
              containerName,
              {
                expiresInSeconds:
                  this.PODMAN_CONTAINER_NAME_CACHE_EXPIRY_SECONDS,
              },
            );
            // Only after a successful write — a failed write must retry.
            this.containerNameL1Memo.set(l1Key, containerName);
          }
        }
      } catch (err) {
        logger.error(
          "Error caching Podman container name: " + (err as Error).message,
        );
      }
    }

    if (containerName) {
      return this.normalizePodmanContainerName(containerName);
    }

    // Logs path: try the id -> name cache populated by the metrics path.
    if (containerId) {
      try {
        const projectId: ObjectID | undefined = (
          req as ExpressRequest & { projectId?: ObjectID }
        ).projectId;
        if (projectId) {
          const l1Key: string = `${this.PODMAN_CONTAINER_NAME_CACHE_NAMESPACE}:${projectId.toString()}:${containerId}`;
          const memoed: string | undefined =
            this.containerNameL1Memo.get(l1Key);
          if (memoed !== undefined) {
            return this.normalizePodmanContainerName(memoed);
          }
          const cached: string | null = await GlobalCache.getString(
            this.PODMAN_CONTAINER_NAME_CACHE_NAMESPACE,
            `${projectId.toString()}:${containerId}`,
          );
          if (cached) {
            // Positives only — see containerNameL1Memo.
            this.containerNameL1Memo.set(l1Key, cached);
            return this.normalizePodmanContainerName(cached);
          }
        }
      } catch (err) {
        logger.error(
          "Error reading Podman container name cache: " +
            (err as Error).message,
        );
      }
    }

    /*
     * No resolvable container identity. Used to synthesise
     * `podman/<hostName>/<shortId>` / `podman/<hostName>` / `podman/<shortId>`
     * service rows, which created a duplicate alongside the PodmanHost
     * record `autoDiscoverPodmanHost` had just upserted from the same
     * batch. The caller now routes the batch through the PodmanHost id
     * with ServiceType.PodmanHost.
     */
    return null;
  }

  /**
   * Strip Docker Compose's replica index suffix (e.g. "-1", "-2") from a
   * container name so that multiple replicas of the same service — and the
   * same service running on different hosts — roll up into a single
   * OneUptime telemetry service.
   *
   * Docker Compose names containers as "{project}-{service}-{index}" (or
   * "{project}_{service}_{index}" with the legacy separator), so the
   * trailing "-N" or "_N" is always the replica index. We only strip it
   * when the prefix still looks like a valid service identifier, to avoid
   * mangling container names that legitimately end in a digit.
   *
   * Examples:
   *   oneuptime-postgres-1   -> oneuptime-postgres
   *   oneuptime-probe-1-2    -> oneuptime-probe-1   (only the last "-2")
   *   my-app_3               -> my-app
   *   redis                  -> redis               (unchanged)
   */
  private static normalizeDockerContainerName(name: string): string {
    const trimmed: string = name.trim();
    if (!trimmed) {
      return trimmed;
    }

    /*
     * Docker Compose's "/" prefix on the raw inspect output (e.g. "/oneuptime-app-1")
     * is already stripped by the docker_stats receiver, but handle it defensively.
     */
    const withoutSlash: string = trimmed.startsWith("/")
      ? trimmed.substring(1)
      : trimmed;

    const match: RegExpMatchArray | null =
      withoutSlash.match(/^(.+)[-_](\d+)$/);

    if (!match || !match[1]) {
      return withoutSlash;
    }

    return match[1];
  }

  /**
   * Strip Compose's replica index suffix (e.g. "-1", "-2") from a Podman
   * container name so that multiple replicas of the same service — and the
   * same service running on different hosts — roll up into a single
   * OneUptime telemetry service.
   *
   * Podman Compose names containers as "{project}-{service}-{index}" (or
   * "{project}_{service}_{index}" with the legacy separator), so the
   * trailing "-N" or "_N" is the replica index. We only strip it
   * when the prefix still looks like a valid service identifier, to avoid
   * mangling container names that legitimately end in a digit.
   *
   * Examples:
   *   oneuptime-postgres-1   -> oneuptime-postgres
   *   oneuptime-probe-1-2    -> oneuptime-probe-1   (only the last "-2")
   *   my-app_3               -> my-app
   *   redis                  -> redis               (unchanged)
   */
  private static normalizePodmanContainerName(name: string): string {
    const trimmed: string = name.trim();
    if (!trimmed) {
      return trimmed;
    }

    /*
     * Compose's "/" prefix on the raw inspect output (e.g. "/oneuptime-app-1")
     * is already stripped by the docker_stats receiver, but handle it defensively.
     */
    const withoutSlash: string = trimmed.startsWith("/")
      ? trimmed.substring(1)
      : trimmed;

    const match: RegExpMatchArray | null =
      withoutSlash.match(/^(.+)[-_](\d+)$/);

    if (!match || !match[1]) {
      return withoutSlash;
    }

    return match[1];
  }

  protected static getClusterNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "k8s.cluster.name" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        const value: JSONValue = (attribute["value"] as JSONObject)[
          "stringValue"
        ];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
    return null;
  }

  protected static async autoDiscoverKubernetesCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const clusterName: string | null = this.readDiscoveryMatch({
      resource: "Kubernetes cluster",
      read: (): string | null => {
        return this.getClusterNameFromAttributes(data.attributes);
      },
    });

    if (!clusterName) {
      return null;
    }

    return await this.discoverMatchedKubernetesCluster({
      projectId: data.projectId,
      attributes: data.attributes,
      clusterName: clusterName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverKubernetesCluster" })
  private static async discoverMatchedKubernetesCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    clusterName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const clusterIdStr: string | null =
        await this.resolveDiscoveredResourceId({
          kindName: "KubernetesCluster",
          projectId: data.projectId,
          identity: data.clusterName,
        });

      if (!clusterIdStr) {
        return null;
      }

      /*
       * Skip the per-batch UPDATE + label upsert when we've already
       * run it for this cluster in the current fence window. With
       * 100 telemetry workers each touching the same handful of
       * clusters, this is the single biggest Postgres write hot
       * spot on the ingest path; the staleness on `lastSeenAt` is
       * bounded by the TTL.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.KubernetesCluster,
        id: clusterIdStr,
        fenceScope: "k8s-cluster",
        armedFences: armedFences,
        heartbeat: async (
          clusterId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await KubernetesClusterService.updateLastSeen(clusterId, {
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (clusterId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToCluster({
            projectId: data.projectId,
            kubernetesClusterId: clusterId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Kubernetes cluster: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Kubernetes
   * cluster. Mirrors the host/service label promotion. Throttled
   * per-cluster inside `attachLabels` so steady-state ingest with
   * unchanged labels costs one in-memory cache lookup.
   */
  protected static async promoteOneuptimeLabelsToCluster(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await KubernetesClusterService.attachLabels({
        kubernetesClusterId: data.kubernetesClusterId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Kubernetes cluster label promotion failed for ${data.kubernetesClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * `proxmox.cluster.name` is the Proxmox join key — a OneUptime-defined
   * resource attribute (no upstream semconv exists) stamped by the
   * Proxmox Agent collector config from the PROXMOX_CLUSTER_NAME env.
   */
  protected static getProxmoxClusterNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return this.getStringAttribute(attributes, "proxmox.cluster.name");
  }

  protected static async autoDiscoverProxmoxCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const clusterName: string | null = this.readDiscoveryMatch({
      resource: "Proxmox cluster",
      read: (): string | null => {
        return this.getProxmoxClusterNameFromAttributes(data.attributes);
      },
    });

    if (!clusterName) {
      return null;
    }

    return await this.discoverMatchedProxmoxCluster({
      projectId: data.projectId,
      attributes: data.attributes,
      clusterName: clusterName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverProxmoxCluster" })
  private static async discoverMatchedProxmoxCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    clusterName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const clusterIdStr: string | null =
        await this.resolveDiscoveredResourceId({
          kindName: "ProxmoxCluster",
          projectId: data.projectId,
          identity: data.clusterName,
        });

      if (!clusterIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes path — skip the
       * per-batch maintenance UPDATE + label upsert when we
       * already ran it within the fence window.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.ProxmoxCluster,
        id: clusterIdStr,
        fenceScope: "proxmox-cluster",
        armedFences: armedFences,
        heartbeat: async (
          clusterId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await ProxmoxClusterService.updateLastSeen(clusterId, {
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (clusterId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToProxmoxCluster({
            projectId: data.projectId,
            proxmoxClusterId: clusterId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Proxmox cluster: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Proxmox
   * cluster. Mirrors the Kubernetes cluster label promotion.
   * Throttled per-cluster inside `attachLabels` so steady-state
   * ingest with unchanged labels costs one in-memory cache lookup.
   */
  protected static async promoteOneuptimeLabelsToProxmoxCluster(data: {
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await ProxmoxClusterService.attachLabels({
        proxmoxClusterId: data.proxmoxClusterId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Proxmox cluster label promotion failed for ${data.proxmoxClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * `vmware.vcenter.name` is the VMware join key — a OneUptime-defined
   * resource attribute (no upstream semconv exists; the vcenter receiver
   * only stamps per-object `vcenter.*` attributes) that the VMware Agent
   * collector config stamps from the VMWARE_VCENTER_NAME env through a
   * resource processor. One value = one vSphere endpoint (a vCenter
   * Server, or a standalone ESXi host).
   */
  protected static getVMwareVCenterNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return this.getStringAttribute(attributes, "vmware.vcenter.name");
  }

  protected static async autoDiscoverVMwareVCenter(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const vcenterName: string | null = this.readDiscoveryMatch({
      resource: "VMware vCenter",
      read: (): string | null => {
        return this.getVMwareVCenterNameFromAttributes(data.attributes);
      },
    });

    if (!vcenterName) {
      return null;
    }

    return await this.discoverMatchedVMwareVCenter({
      projectId: data.projectId,
      attributes: data.attributes,
      vcenterName: vcenterName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverVMwareVCenter" })
  private static async discoverMatchedVMwareVCenter(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    vcenterName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const vcenterIdStr: string | null =
        await this.resolveDiscoveredResourceId({
          kindName: "VMwareVCenter",
          projectId: data.projectId,
          identity: data.vcenterName,
        });

      if (!vcenterIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes / Proxmox paths — skip
       * the per-batch maintenance UPDATE + label upsert when we
       * already ran it within the fence window. The vcenter receiver
       * emits one ResourceMetrics per vSphere object, so a single
       * collection of a mid-sized vCenter is hundreds of resource
       * blocks: without the fence every one of them would heartbeat.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.VMwareVCenter,
        id: vcenterIdStr,
        fenceScope: "vmware-vcenter",
        armedFences: armedFences,
        heartbeat: async (
          vcenterId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await VMwareVCenterService.updateLastSeen(vcenterId, {
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (vcenterId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToVMwareVCenter({
            projectId: data.projectId,
            vmwareVCenterId: vcenterId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering VMware vCenter: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered vCenter. Mirrors
   * the Kubernetes / Proxmox cluster label promotion. Throttled
   * per-vCenter inside `attachLabels` so steady-state ingest with
   * unchanged labels costs one in-memory cache lookup.
   */
  protected static async promoteOneuptimeLabelsToVMwareVCenter(data: {
    projectId: ObjectID;
    vmwareVCenterId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await VMwareVCenterService.attachLabels({
        vmwareVCenterId: data.vmwareVCenterId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `vCenter label promotion failed for ${data.vmwareVCenterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * `iot.fleet.name` is the IoT Fleet join key — a OneUptime-defined
   * resource attribute (no upstream semconv exists) stamped by the IoT
   * device / gateway SDK from the IOT_FLEET_NAME env (via
   * OTEL_RESOURCE_ATTRIBUTES). Some flattened forms prefix resource
   * attributes with `resource.`, so accept that alias too.
   */
  protected static getIoTFleetNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return (
      this.getStringAttribute(attributes, "iot.fleet.name") ||
      this.getStringAttribute(attributes, "resource.iot.fleet.name")
    );
  }

  protected static async autoDiscoverIoTFleet(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const fleetName: string | null = this.readDiscoveryMatch({
      resource: "IoT fleet",
      read: (): string | null => {
        return this.getIoTFleetNameFromAttributes(data.attributes);
      },
    });

    if (!fleetName) {
      return null;
    }

    return await this.discoverMatchedIoTFleet({
      projectId: data.projectId,
      attributes: data.attributes,
      fleetName: fleetName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverIoTFleet" })
  private static async discoverMatchedIoTFleet(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    fleetName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const fleetIdStr: string | null = await this.resolveDiscoveredResourceId({
        kindName: "IoTFleet",
        projectId: data.projectId,
        identity: data.fleetName,
      });

      if (!fleetIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes path — skip the
       * per-batch maintenance UPDATE + label upsert when we
       * already ran it within the fence window.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.IoTFleet,
        id: fleetIdStr,
        fenceScope: "iot-fleet",
        armedFences: armedFences,
        heartbeat: async (
          fleetId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await IoTFleetService.updateLastSeen(fleetId, {
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (fleetId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToIoTFleet({
            projectId: data.projectId,
            iotFleetId: fleetId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering IoT fleet: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered IoT fleet.
   * Mirrors the Proxmox cluster label promotion. Throttled
   * per-fleet inside `attachLabels` so steady-state ingest with
   * unchanged labels costs one in-memory cache lookup.
   */
  protected static async promoteOneuptimeLabelsToIoTFleet(data: {
    projectId: ObjectID;
    iotFleetId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await IoTFleetService.attachLabels({
        iotFleetId: data.iotFleetId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `IoT fleet label promotion failed for ${data.iotFleetId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * `docker.swarm.cluster.name` is the Docker Swarm join key — a
   * OneUptime-defined resource attribute (no upstream semconv exists)
   * stamped by the Docker Swarm Agent collector config from the
   * DOCKER_SWARM_CLUSTER_NAME env.
   */
  protected static getDockerSwarmClusterNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return this.getStringAttribute(attributes, "docker.swarm.cluster.name");
  }

  protected static async autoDiscoverDockerSwarmCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const clusterName: string | null = this.readDiscoveryMatch({
      resource: "Docker Swarm cluster",
      read: (): string | null => {
        return this.getDockerSwarmClusterNameFromAttributes(data.attributes);
      },
    });

    if (!clusterName) {
      return null;
    }

    return await this.discoverMatchedDockerSwarmCluster({
      projectId: data.projectId,
      attributes: data.attributes,
      clusterName: clusterName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverDockerSwarmCluster" })
  private static async discoverMatchedDockerSwarmCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    clusterName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const clusterIdStr: string | null =
        await this.resolveDiscoveredResourceId({
          kindName: "DockerSwarmCluster",
          projectId: data.projectId,
          identity: data.clusterName,
        });

      if (!clusterIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes path — one heartbeat and one
       * label pass per cluster per fence window.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.DockerSwarmCluster,
        id: clusterIdStr,
        fenceScope: "docker-swarm-cluster",
        armedFences: armedFences,
        heartbeat: async (
          clusterId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await DockerSwarmClusterService.updateLastSeen(clusterId, {
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (clusterId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToDockerSwarmCluster({
            projectId: data.projectId,
            dockerSwarmClusterId: clusterId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Docker Swarm cluster: " +
          (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Docker Swarm
   * cluster. Mirrors the Proxmox cluster label promotion.
   */
  protected static async promoteOneuptimeLabelsToDockerSwarmCluster(data: {
    projectId: ObjectID;
    dockerSwarmClusterId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await DockerSwarmClusterService.attachLabels({
        dockerSwarmClusterId: data.dockerSwarmClusterId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Docker Swarm cluster label promotion failed for ${data.dockerSwarmClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * `ceph.cluster.name` is the Ceph join key — a OneUptime-defined
   * resource attribute (no upstream semconv exists) stamped by the
   * Ceph Agent collector config from the CEPH_CLUSTER_NAME env.
   */
  protected static getCephClusterNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return this.getStringAttribute(attributes, "ceph.cluster.name");
  }

  protected static async autoDiscoverCephCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const clusterName: string | null = this.readDiscoveryMatch({
      resource: "Ceph cluster",
      read: (): string | null => {
        return this.getCephClusterNameFromAttributes(data.attributes);
      },
    });

    if (!clusterName) {
      return null;
    }

    return await this.discoverMatchedCephCluster({
      projectId: data.projectId,
      attributes: data.attributes,
      clusterName: clusterName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverCephCluster" })
  private static async discoverMatchedCephCluster(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    clusterName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const clusterIdStr: string | null =
        await this.resolveDiscoveredResourceId({
          kindName: "CephCluster",
          projectId: data.projectId,
          identity: data.clusterName,
        });

      if (!clusterIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes path — skip the
       * per-batch maintenance UPDATE + label upsert when we
       * already ran it within the fence window.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.CephCluster,
        id: clusterIdStr,
        fenceScope: "ceph-cluster",
        armedFences: armedFences,
        heartbeat: async (
          clusterId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          // Optional fsid stamping (ships commented-out in the agent config).
          const fsid: string | null = this.getStringAttribute(
            data.attributes,
            "ceph.cluster.fsid",
          );
          return await CephClusterService.updateLastSeen(clusterId, {
            agentVersion: agentVersion || undefined,
            fsid: fsid || undefined,
          });
        },
        promoteLabels: async (clusterId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToCephCluster({
            projectId: data.projectId,
            cephClusterId: clusterId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Ceph cluster: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Ceph cluster.
   * Mirrors the Kubernetes cluster label promotion. Throttled
   * per-cluster inside `attachLabels` so steady-state ingest with
   * unchanged labels costs one in-memory cache lookup.
   */
  protected static async promoteOneuptimeLabelsToCephCluster(data: {
    projectId: ObjectID;
    cephClusterId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await CephClusterService.attachLabels({
        cephClusterId: data.cephClusterId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Ceph cluster label promotion failed for ${data.cephClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * `storage.array.name` is the storage array join key — a OneUptime-defined
   * resource attribute (no upstream semconv exists) stamped by the Storage
   * Array Agent collector config from the STORAGE_ARRAY_NAME env.
   */
  protected static getStorageArrayNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return this.getStringAttribute(attributes, "storage.array.name");
  }

  /*
   * The platform the agent declares in `storage.system` (STORAGE_SYSTEM in
   * its .env), normalized; null when absent or malformed. Only a fallback
   * for the platform the metric names imply — see
   * OtelMetricsIngestService.flushStorageArraySnapshotBuffers.
   */
  protected static getDeclaredStorageSystemFromAttributes(
    attributes: JSONArray,
  ): string | null {
    return StorageSystemUtil.normalize(
      this.getStringAttribute(attributes, "storage.system"),
    );
  }

  protected static async autoDiscoverStorageArray(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const arrayName: string | null = this.readDiscoveryMatch({
      resource: "storage array",
      read: (): string | null => {
        return this.getStorageArrayNameFromAttributes(data.attributes);
      },
    });

    if (!arrayName) {
      return null;
    }

    return await this.discoverMatchedStorageArray({
      projectId: data.projectId,
      attributes: data.attributes,
      arrayName: arrayName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverStorageArray" })
  private static async discoverMatchedStorageArray(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    arrayName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const arrayIdStr: string | null = await this.resolveDiscoveredResourceId({
        kindName: "StorageArray",
        projectId: data.projectId,
        identity: data.arrayName,
      });

      if (!arrayIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Ceph path — skip the per-batch
       * maintenance UPDATE + label upsert when we already ran it within
       * the fence window.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.StorageArray,
        id: arrayIdStr,
        fenceScope: "storage-array",
        armedFences: armedFences,
        heartbeat: async (
          arrayId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          /*
           * The platform is deliberately not written here. The metrics
           * snapshot derives it from the metric names (purefa_ / purefb_),
           * which a collector config cannot get wrong, and takes the
           * declared `storage.system` only for a platform it has no
           * catalog for (OtelMetricsIngestService.
           * flushStorageArraySnapshotBuffers). Writing it from both made
           * the column flip whenever the two disagreed: a FlashBlade .env
           * without STORAGE_SYSTEM gets the compose default,
           * purestorage.flasharray.
           */
          return await StorageArrayService.updateLastSeen(arrayId, {
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (arrayId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToStorageArray({
            projectId: data.projectId,
            storageArrayId: arrayId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering storage array: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into project
   * labels and attach them to the discovered storage array. Mirrors the
   * Ceph cluster label promotion. Throttled per-array inside `attachLabels`
   * so steady-state ingest with unchanged labels costs one in-memory cache
   * lookup.
   */
  protected static async promoteOneuptimeLabelsToStorageArray(data: {
    projectId: ObjectID;
    storageArrayId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await StorageArrayService.attachLabels({
        storageArrayId: data.storageArrayId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Storage array label promotion failed for ${data.storageArrayId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * cloud.platform values that denote a Function-as-a-Service runtime live
   * in the shared registry (FAAS_CLOUD_PLATFORM_VALUES in
   * Common/Types/Cloud/CloudPlatform) so the Serverless and Cloud
   * Environment products can never both claim the same platform. An
   * explicit faas.name, or a cloud.platform in that set, routes the batch
   * to a ServerlessFunction resource.
   */

  /*
   * getStringAttribute's reading rule — the first `key` entry whose
   * stringValue is a string with non-whitespace content, trimmed — without
   * its one hazard: a null or non-object entry is skipped instead of
   * throwing. Serverless reads every attribute through this: the identity,
   * which stampServerlessFunctionNameAttribute applies in the ingest
   * pre-pass, outside every discovery try/catch (the reason
   * normalizeCloudPlatformAttribute is null-safe too), and everything
   * autoDiscoverServerless reads after it, so the stamp and discovery read
   * each attribute the same way.
   */
  private static readTrimmedStringAttribute(
    attributes: JSONArray | null | undefined,
    key: string,
  ): string | null {
    if (!Array.isArray(attributes)) {
      return null;
    }
    for (const attribute of attributes) {
      if (
        !attribute ||
        typeof attribute !== "object" ||
        attribute["key"] !== key
      ) {
        continue;
      }
      const value: JSONValue | undefined = (
        attribute["value"] as JSONObject | null | undefined
      )?.["stringValue"];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
    return null;
  }

  /*
   * The one rule that says which Serverless Function a resource batch
   * belongs to. autoDiscoverServerless keys the ServerlessFunction row on
   * it (functionIdentifier) and stampServerlessFunctionNameAttribute writes
   * it onto the batch as faas.name, which every span, log, metric and
   * profile row stores as `resource.faas.name` — the attribute the
   * Serverless pages, the resource facet and the AI resource tools filter
   * on. Two copies of this rule would let those two values drift apart and
   * leave a function's pages empty again, so there is only this one:
   *
   *   1. a usable faas.name is the identity, on any platform;
   *   2. otherwise, on a FaaS cloud.platform (after alias normalisation, so
   *      the Node detector's dotted "azure.functions" counts), the
   *      service.name ATTRIBUTE is — never the x-oneuptime-service-name
   *      header, which names a Service rather than describing a function;
   *   3. otherwise the batch is not a function's (null).
   *
   * Pure, synchronous and null-safe.
   */
  protected static resolveServerlessFunctionIdentity(
    attributes: JSONArray | null | undefined,
  ): ServerlessFunctionIdentity | null {
    const cloudPlatform: string | null = normalizeCloudPlatform(
      this.readTrimmedStringAttribute(attributes, "cloud.platform"),
    );

    const faasName: string | null = this.readTrimmedStringAttribute(
      attributes,
      "faas.name",
    );
    if (faasName) {
      return {
        functionIdentifier: faasName,
        source: "faas.name",
        cloudPlatform,
      };
    }

    if (!cloudPlatform || !FAAS_CLOUD_PLATFORM_VALUES.has(cloudPlatform)) {
      return null;
    }

    const serviceName: string | null = this.readTrimmedStringAttribute(
      attributes,
      "service.name",
    );
    if (!serviceName) {
      return null;
    }

    return {
      functionIdentifier: serviceName,
      source: "service.name",
      cloudPlatform,
    };
  }

  /*
   * Give a FaaS resource the faas.name its Serverless Function is keyed on
   * when the platform's own resource detector sets none. The Azure
   * Functions host, the .NET isolated worker
   * (Microsoft.Azure.Functions.Worker.OpenTelemetry) and the Node detector
   * (@opentelemetry/resource-detector-azure) all describe a Function App by
   * service.name (by default the app's name, WEBSITE_SITE_NAME) and
   * cloud.platform, never faas.name, so discovery keys the function on
   * service.name — and every row of its telemetry was stored without
   * `resource.faas.name`, the attribute its pages filter by, so they showed
   * nothing. Stamping the identity onto the wire-shaped list, before the
   * discovery gates read it and before each signal's flatten stores it,
   * puts the same value on the function row and on the rows.
   *
   * Acts only when resolveServerlessFunctionIdentity fell back to
   * service.name, so a usable faas.name — even one that differs from
   * service.name — is never touched. Any faas.name entries present are then
   * all unusable (empty, whitespace, not a string), and each is rewritten in
   * place instead of a second entry being appended: the flatten keeps the
   * LAST entry for a key while the identity reads the FIRST usable one, so a
   * leftover unusable entry would still win on the rows.
   *
   * Runs right after normalizeCloudPlatformAttribute in the four signal
   * services, deliberately not inside autoDiscoverServerless: the ingest
   * test harnesses stub that method, and it gives up when a cache or
   * Postgres call throws, but the rows need the attribute either way.
   * Routing does not change — selectPrimaryEntity still makes the Function
   * App an OpenTelemetry Service by its service.name — and entity extraction
   * never reads faas.*. Rows ingested before this existed keep no
   * faas.name; there is no backfill. Not named autoDiscover*: the fence and
   * L1-memo coverage suites enumerate that prefix.
   */
  protected static stampServerlessFunctionNameAttribute(
    attributes: JSONArray,
  ): void {
    if (!Array.isArray(attributes)) {
      return;
    }

    const identity: ServerlessFunctionIdentity | null =
      this.resolveServerlessFunctionIdentity(attributes);
    if (!identity || identity.source !== "service.name") {
      return;
    }

    let rewroteExistingEntry: boolean = false;
    for (const attribute of attributes) {
      if (
        !attribute ||
        typeof attribute !== "object" ||
        attribute["key"] !== "faas.name"
      ) {
        continue;
      }
      attribute["value"] = { stringValue: identity.functionIdentifier };
      rewroteExistingEntry = true;
    }

    if (!rewroteExistingEntry) {
      attributes.push({
        key: "faas.name",
        value: { stringValue: identity.functionIdentifier },
      });
    }
  }

  /*
   * Auto-discover a Serverless / FaaS function from OTel resource
   * attributes. The identity — an explicit faas.name, else service.name on a
   * FaaS cloud.platform — is resolveServerlessFunctionIdentity's, the same
   * rule stampServerlessFunctionNameAttribute used to write it onto the
   * batch as faas.name before this runs. Runs on every ingest path, so the
   * function's telemetry tabs (which filter by resource.faas.name) work
   * whether the function was named by faas.name or by service.name, and
   * even when service.name also makes the batch a Service's — the
   * discriminator choice happens in resolveTelemetryResource.
   */
  protected static async autoDiscoverServerless(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const identity: ServerlessFunctionIdentity | null = this.readDiscoveryMatch(
      {
        resource: "Serverless function",
        read: (): ServerlessFunctionIdentity | null => {
          return this.resolveServerlessFunctionIdentity(data.attributes);
        },
      },
    );

    // Gate: no function identity, no function.
    if (!identity) {
      return null;
    }

    return await this.discoverMatchedServerless({
      projectId: data.projectId,
      attributes: data.attributes,
      identity: identity,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverServerless" })
  private static async discoverMatchedServerless(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    identity: ServerlessFunctionIdentity;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const functionIdentifier: string = data.identity.functionIdentifier;
      const cloudPlatform: string | null = data.identity.cloudPlatform;

      const functionIdStr: string | null =
        await this.resolveDiscoveredResourceId({
          kindName: "ServerlessFunction",
          projectId: data.projectId,
          identity: functionIdentifier,
        });

      if (!functionIdStr) {
        return null;
      }

      let liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.ServerlessFunction,
        id: functionIdStr,
        fenceScope: "serverless-function",
        armedFences: armedFences,
        heartbeat: async (
          functionId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          /*
           * Read through the same null-safe reader as the identity, so a
           * malformed entry cannot stop discovery half-way — the row found
           * or created above, its heartbeat never written.
           */
          const agentVersion: string | null = this.readTrimmedStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await ServerlessFunctionService.updateLastSeen(functionId, {
            agentVersion: agentVersion || undefined,
            cloudPlatform: cloudPlatform || undefined,
            cloudProvider:
              this.readTrimmedStringAttribute(
                data.attributes,
                "cloud.provider",
              ) || undefined,
            cloudRegion:
              this.readTrimmedStringAttribute(
                data.attributes,
                "cloud.region",
              ) || undefined,
            cloudAccountId:
              this.readTrimmedStringAttribute(
                data.attributes,
                "cloud.account.id",
              ) || undefined,
            functionVersion:
              this.readTrimmedStringAttribute(
                data.attributes,
                "faas.version",
              ) || undefined,
            runtimeName:
              this.readTrimmedStringAttribute(
                data.attributes,
                "process.runtime.name",
              ) || undefined,
            runtimeVersion:
              this.readTrimmedStringAttribute(
                data.attributes,
                "process.runtime.version",
              ) || undefined,
          });
        },
        promoteLabels: async (functionId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToServerlessFunction({
            projectId: data.projectId,
            serverlessFunctionId: functionId,
            attributes: data.attributes,
          });
        },
      });

      if (!liveIdStr) {
        return null;
      }

      // Live inventory: record this function instance (faas.instance).
      const faasInstance: string | null = this.readTrimmedStringAttribute(
        data.attributes,
        "faas.instance",
      );
      if (
        faasInstance &&
        (await this.shouldRunMaintenance(
          "serverless-fn-instance",
          `${liveIdStr}:${faasInstance}`,
        ))
      ) {
        armedFences.push({
          scope: "serverless-fn-instance",
          id: `${liveIdStr}:${faasInstance}`,
        });
        liveIdStr = await this.writeForDiscoveredResource({
          kind: DiscoveredResourceKinds.ServerlessFunction,
          id: liveIdStr,
          write: async (functionId: ObjectID): Promise<void> => {
            await ServerlessFunctionInstanceService.recordInstance({
              projectId: data.projectId,
              serverlessFunctionId: functionId,
              instanceName: faasInstance,
            });
          },
        });
      }
      return new ObjectID(liveIdStr);
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Serverless function: " + (err as Error).message,
      );
      return null;
    }
  }

  protected static async promoteOneuptimeLabelsToServerlessFunction(data: {
    projectId: ObjectID;
    serverlessFunctionId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await ServerlessFunctionService.attachLabels({
        serverlessFunctionId: data.serverlessFunctionId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Serverless function label promotion failed for ${data.serverlessFunctionId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * Auto-discover a managed cloud-compute *environment* from OTel resource
   * attributes. Gated on cloud.platform being in the managed-compute set
   * (MANAGED_CLOUD_PLATFORM_VALUES in Common/Types/Cloud/CloudPlatform —
   * the same registry the dashboard create form, the connect guide and the
   * docs read, so the four can never disagree about which platforms are a
   * Cloud Environment). Raw VM platforms (aws_ec2, gcp_compute_engine,
   * azure_vm) are deliberately absent from that set so they remain Hosts;
   * k8s platforms route via k8s.* attributes.
   *
   * Identity is the environment — cloud.platform + cloud.account.id +
   * cloud.region — NOT service.name, so a single CloudResource aggregates
   * every workload running on that platform/account/region (per-service
   * breakdown lives under Services). This deliberately avoids the
   * service.name overlap that would otherwise mirror a Service row. Runs on
   * every ingest path so the environment's telemetry tabs stay populated.
   */
  protected static async autoDiscoverCloudResource(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const cloudPlatform: string | null = this.readDiscoveryMatch({
      resource: "Cloud resource",
      read: (): string | null => {
        /*
         * normalizeCloudPlatformAttribute has normally already rewritten
         * the attribute in place, but normalise again here so the gate, the
         * key and the stored platform are canonical even for a caller that
         * hands this method attributes straight from the wire.
         */
        const platform: string | null = normalizeCloudPlatform(
          this.getStringAttribute(data.attributes, "cloud.platform"),
        );
        if (!platform || !MANAGED_CLOUD_PLATFORM_VALUES.has(platform)) {
          return null;
        }
        return platform;
      },
    });

    if (!cloudPlatform) {
      return null;
    }

    return await this.discoverMatchedCloudResource({
      projectId: data.projectId,
      attributes: data.attributes,
      cloudPlatform: cloudPlatform,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverCloudResource" })
  private static async discoverMatchedCloudResource(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    cloudPlatform: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const cloudPlatform: string = data.cloudPlatform;

      /*
       * Every resource detector that stamps cloud.platform also stamps
       * cloud.provider, but a hand-written OTEL_RESOURCE_ATTRIBUTES (the
       * documented route on App Runner and Container Instances, which have
       * no detector, and part of the route on Container Apps, whose
       * detectors set neither region nor account) often carries only the
       * platform. The platform implies the provider, so fill it in rather
       * than leaving the column blank.
       */
      const cloudProvider: string | null =
        this.getStringAttribute(data.attributes, "cloud.provider") ||
        getCloudProviderForPlatform(cloudPlatform);
      const cloudRegion: string | null = this.getStringAttribute(
        data.attributes,
        "cloud.region",
      );
      const cloudAccountId: string | null = this.getStringAttribute(
        data.attributes,
        "cloud.account.id",
      );

      /*
       * Composite environment key ("aws_ecs|123456789012|us-east-1") —
       * stable across every service on this env, and built by the shared
       * helper so a manually created environment carrying the same key is
       * found here instead of being duplicated. Empty segments are kept
       * rather than dropped (see buildCloudEnvironmentKey).
       */
      const resourceIdentifier: string = buildCloudEnvironmentKey({
        platform: cloudPlatform,
        accountId: cloudAccountId,
        region: cloudRegion,
      });

      // "AWS ECS · us-east-1 · 123456789012" — the same shape the create form suggests.
      const name: string = buildCloudEnvironmentName({
        platform: cloudPlatform,
        accountId: cloudAccountId,
        region: cloudRegion,
      });

      const resourceIdStr: string | null =
        await this.resolveDiscoveredResourceId({
          kindName: "CloudResource",
          projectId: data.projectId,
          identity: resourceIdentifier,
          cloudEnvironment: {
            name: name,
            cloudPlatform: cloudPlatform,
            cloudProvider: cloudProvider || undefined,
            cloudRegion: cloudRegion || undefined,
            cloudAccountId: cloudAccountId || undefined,
          },
        });

      if (!resourceIdStr) {
        return null;
      }

      let liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.CloudResource,
        id: resourceIdStr,
        fenceScope: "cloud-resource",
        armedFences: armedFences,
        heartbeat: async (
          cloudResourceId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          return await CloudResourceService.updateLastSeen(cloudResourceId, {
            cloudPlatform: cloudPlatform || undefined,
            cloudProvider: cloudProvider || undefined,
            cloudRegion: cloudRegion || undefined,
            cloudAccountId: cloudAccountId || undefined,
          });
        },
        promoteLabels: async (cloudResourceId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToCloudResource({
            projectId: data.projectId,
            cloudResourceId,
            attributes: data.attributes,
          });
        },
      });

      if (!liveIdStr) {
        return null;
      }

      /*
       * Live inventory: record this instance / task. service.instance.id
       * is preferred, but almost nothing on a managed platform sets it —
       * the ECS detector stamps the task ARN, Cloud Run stamps
       * faas.instance — so the identity walks the shared fallback chain.
       * The metrics snapshot fold (OtelMetricsIngestService) resolves the
       * same chain over the same attributes, which is what lets the CPU /
       * memory point land on the row this call creates.
       */
      const instanceName: string | null = resolveCloudInstanceName(
        (key: string): string | null => {
          return this.getStringAttribute(data.attributes, key);
        },
      );
      if (
        instanceName &&
        (await this.shouldRunMaintenance(
          "cloud-resource-instance",
          `${liveIdStr}:${instanceName}`,
        ))
      ) {
        armedFences.push({
          scope: "cloud-resource-instance",
          id: `${liveIdStr}:${instanceName}`,
        });
        liveIdStr = await this.writeForDiscoveredResource({
          kind: DiscoveredResourceKinds.CloudResource,
          id: liveIdStr,
          write: async (cloudResourceId: ObjectID): Promise<void> => {
            await CloudResourceInstanceService.recordInstance({
              projectId: data.projectId,
              cloudResourceId,
              instanceName,
            });
          },
        });
      }
      return new ObjectID(liveIdStr);
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Cloud resource: " + (err as Error).message,
      );
      return null;
    }
  }

  protected static async promoteOneuptimeLabelsToCloudResource(data: {
    projectId: ObjectID;
    cloudResourceId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await CloudResourceService.attachLabels({
        cloudResourceId: data.cloudResourceId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Cloud resource label promotion failed for ${data.cloudResourceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * How many resources one request may look up in Postgres - the ones no
   * cache knows yet. A collector's first poll of a large subscription names
   * thousands of resources; the rest are found by the next polls, each a
   * minute or five apart, instead of one request holding a worker for all
   * of them.
   */
  public static readonly CLOUD_MONITORED_RESOURCE_MAX_LOOKUPS_PER_REQUEST: number = 200;

  /*
   * L1 for resources that could not be resolved to a row - in practice, a
   * project at its auto-create budget. Without it every poll would look up
   * every such resource again. One minute: a budget freed by the archive
   * sweep is picked up on the next poll after that.
   */
  private static readonly unresolvedCloudMonitoredResourceMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: 60 * 1000,
      maxEntries: 10_000,
    });

  /*
   * Cloud resources from cloud monitoring: the distinct resources one
   * request's metric rows named (CloudMonitoredResourceCollector), each
   * found or created as a Cloud Resource and sighted.
   *
   * Unlike the other autoDiscover* methods this is not about the request's
   * OTel resource. A cloud-monitoring receiver sends a whole account's or
   * subscription's resources under one OTel resource, and names each
   * datapoint's own resource on the datapoint - so the work is per
   * resource the rows named, after the rows are written:
   *
   *   - the row id goes through the same L1 memo / Redis cache as every
   *     discovered entity; only a miss reaches Postgres, and at most
   *     CLOUD_MONITORED_RESOURCE_MAX_LOOKUPS_PER_REQUEST of those per request;
   *   - the sighting (lastSeenAt, status, what the provider reports) runs
   *     behind the same maintenance fence, once per resource per window;
   *   - a failure costs that resource its sighting this time, never the
   *     request: the fences it armed are released, and it is logged once.
   *
   * Returns how many resources were sighted or already known.
   */
  protected static async autoDiscoverCloudMonitoredResources(data: {
    projectId: ObjectID;
    resources: Array<CloudMonitoredResource>;
  }): Promise<number> {
    // Most requests name no cloud resource: nothing to do, and no span.
    if (data.resources.length === 0) {
      return 0;
    }

    return await this.discoverMatchedCloudMonitoredResources(data);
  }

  @CaptureSpan({
    name: "OtelIngestBaseService.autoDiscoverCloudMonitoredResources",
  })
  private static async discoverMatchedCloudMonitoredResources(data: {
    projectId: ObjectID;
    resources: Array<CloudMonitoredResource>;
  }): Promise<number> {
    const kind: DiscoveredResourceKind =
      DiscoveredResourceKinds.CloudMonitoredResource;
    let lookups: number = 0;
    let resolved: number = 0;
    let failures: number = 0;
    let firstFailure: string = "";

    for (let index: number = 0; index < data.resources.length; index++) {
      if (index > 0 && index % 25 === 0) {
        await EventLoop.yieldToEventLoop();
      }

      const resource: CloudMonitoredResource = data.resources[index]!;
      const armedFences: Array<MaintenanceFence> = [];

      try {
        const resourceIdentifier: string =
          buildCloudMonitoredResourceIdentifier(resource);
        const cacheKey: string = DiscoveredResourceIdCache.keyFor(
          data.projectId,
          resourceIdentifier,
        );

        if (this.unresolvedCloudMonitoredResourceMemo.get(cacheKey)) {
          continue;
        }

        let cloudResourceIdStr: string | null =
          await this.getEntityIdFromCaches(kind.namespace, cacheKey);

        if (!cloudResourceIdStr) {
          if (
            lookups >= this.CLOUD_MONITORED_RESOURCE_MAX_LOOKUPS_PER_REQUEST
          ) {
            continue;
          }
          lookups++;

          const found: CloudMonitoredResourceFindOrCreateResult =
            await CloudResourceService.findOrCreateMonitoredResource({
              projectId: data.projectId,
              resource: resource,
            });

          if (!found.cloudResource?._id) {
            this.unresolvedCloudMonitoredResourceMemo.set(cacheKey, true);
            continue;
          }

          cloudResourceIdStr = found.cloudResource._id.toString();
          await this.setEntityIdInCaches(
            kind.namespace,
            cacheKey,
            cloudResourceIdStr,
            kind.expiresInSeconds,
          );
        }

        resolved++;

        if (
          await this.shouldRunMaintenance(
            "cloud-monitored-resource",
            cloudResourceIdStr,
          )
        ) {
          armedFences.push({
            scope: "cloud-monitored-resource",
            id: cloudResourceIdStr,
          });
          const sighting: ResourceHeartbeatResult =
            await CloudResourceService.recordMonitoredResourceSighting({
              cloudResourceId: new ObjectID(cloudResourceIdStr),
              resource: resource,
            });

          /*
           * Deleted while its id was cached: forget the id, and find or
           * create the resource again as on its first poll - the next poll
           * sights the row that answers now.
           */
          if (sighting?.isRowGone) {
            await DiscoveredResourceIdCache.forget({
              namespace: kind.namespace,
              key: cacheKey,
              id: cloudResourceIdStr,
            });

            const found: CloudMonitoredResourceFindOrCreateResult =
              await CloudResourceService.findOrCreateMonitoredResource({
                projectId: data.projectId,
                resource: resource,
              });

            if (found.cloudResource?._id) {
              await this.setEntityIdInCaches(
                kind.namespace,
                cacheKey,
                found.cloudResource._id.toString(),
                kind.expiresInSeconds,
              );
            }
          }
        }
      } catch (err) {
        await this.releaseMaintenanceFences(armedFences);
        failures++;
        if (!firstFailure) {
          firstFailure = err instanceof Error ? err.message : String(err);
        }
      }
    }

    if (failures > 0) {
      logger.error(
        `Cloud resource discovery failed for ${failures} of ${data.resources.length} resource(s) in project ${data.projectId.toString()}; they are retried on the next request. First error: ${firstFailure}`,
      );
    }

    return resolved;
  }

  /*
   * A database's id is cached for an hour, not the day the other entity-id
   * caches use (DiscoveredResourceKinds.DatabaseServer): it is found through
   * an ENDPOINT, and endpoint ownership moves — a person deletes a
   * discovered row, or moves an alias to another database on the Endpoints
   * tab — so a cached answer has to turn over within the hour. A delete
   * cannot forget it by key (any endpoint the database answered for may be
   * one); ingest forgets it the moment its heartbeat finds the row gone.
   */

  /*
   * In-process memo of lookups that found NO row and may not create one — a
   * LOCAL-scope endpoint nobody owns yet (a collector scraping `localhost`
   * whose own host.name is a single-label name, a private IP), or a linked
   * `oneuptime.database.server.id` that is not in the project. Those are
   * never cached as ids, so without this every batch from such a collector
   * would pay one Postgres read. 60 seconds: a database created (or an alias
   * added) by hand starts receiving the telemetry within a minute.
   */
  private static readonly unresolvedDatabaseServerMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: 60 * 1000,
      maxEntries: 10_000,
    });

  /*
   * The pure half of database discovery: is this resource batch a
   * database's own telemetry, and which server? Delegates to the shared
   * resolveDatabaseFromResourceAttributes after a cheap pre-check — a batch
   * with no known receiver hint, no `oneuptime.database.server.id` and no
   * engine resource attribute (`db.system.name`, or the legacy `db.system`
   * a receiver such as saphana stamps; the resolver reads the same list)
   * can never pass that resolver, so application batches are refused
   * without flattening their attributes. Never touches a cache or a table.
   */
  protected static resolveDatabaseServerResource(data: {
    attributes: JSONArray;
    receiverSystemHint?: string | null | undefined;
  }): DatabaseServerResourceResolution | null {
    if (!data || !Array.isArray(data.attributes)) {
      return null;
    }

    if (
      !isKnownDatabaseSystem(data.receiverSystemHint) &&
      !this.hasAttributeKey(data.attributes, DATABASE_SERVER_ID_ATTRIBUTE) &&
      !DATABASE_SYSTEM_ATTRIBUTES.some((key: string): boolean => {
        return this.hasAttributeKey(data.attributes, key);
      })
    ) {
      return null;
    }

    return resolveDatabaseFromResourceAttributes({
      attributes: TelemetryUtil.getAttributes({
        items: data.attributes,
        prefixKeysWithString: "",
      }),
      receiverSystemHint: data.receiverSystemHint,
    });
  }

  /*
   * The engine of the first collector-contrib DB receiver among a block's
   * scopes (`scopeMetrics` / `scopeLogs`), read from each scope's
   * instrumentation scope name — the receiver system hint
   * resolveDatabaseServerResource and autoDiscoverDatabaseServer take.
   */
  protected static getDatabaseReceiverSystemHintFromScopes(
    scopeEnvelopes: JSONArray | undefined,
  ): string | null {
    if (!scopeEnvelopes || !Array.isArray(scopeEnvelopes)) {
      return null;
    }

    const scopeNames: Array<string> = [];
    for (const envelope of scopeEnvelopes) {
      const scope: JSONObject | undefined = (envelope as JSONObject)?.[
        "scope"
      ] as JSONObject | undefined;
      const name: JSONValue | undefined = scope?.["name"];
      if (typeof name === "string" && name) {
        scopeNames.push(name);
      }
    }

    return getDatabaseReceiverSystemHint(scopeNames);
  }

  /*
   * What a database's telemetry is called when its batch names neither an
   * engine nor an endpoint (a bare `oneuptime.database.server.id` link): the
   * `database/<name>` service name falls back to it, and so does the
   * `oneuptime.database.server.name` stamp — the id stamp monitors link by
   * is never skipped for want of a name.
   */
  protected static readonly DATABASE_SERVER_FALLBACK_NAME: string = "Database";

  /*
   * The name ingest shows for a database's telemetry — the
   * `oneuptime.database.server.name` stamp and the `database/<name>` service
   * name: the endpoint's display name ("PostgreSQL db.prod:5432"), else the
   * engine's name for a batch identified only by its linked id.
   */
  protected static getDatabaseServerDisplayName(
    resolved: DatabaseServerResourceResolution | null,
  ): string | null {
    if (!resolved) {
      return null;
    }
    if (resolved.displayName) {
      return resolved.displayName;
    }
    return resolved.system
      ? getDatabaseSystemDisplayName(resolved.system)
      : null;
  }

  /*
   * True when a metrics block is a database's engine telemetry and NOT also
   * a host agent's (no system.* / process.* metric). Such a block describes
   * the database, not the machine the collector runs on, so the batch-level
   * Host enrichment must skip it exactly as autoDiscoverHost refuses it.
   */
  protected static isDatabaseEngineResourceWithoutHostMetrics(
    attributes: JSONArray,
    scopeMetrics: JSONArray | undefined,
  ): boolean {
    const resolved: DatabaseServerResourceResolution | null =
      this.resolveDatabaseServerResource({
        attributes: attributes,
        receiverSystemHint:
          this.getDatabaseReceiverSystemHintFromScopes(scopeMetrics),
      });

    if (!resolved) {
      return false;
    }

    return !this.scanHostInfraStatsFromMetrics(scopeMetrics).hasInfraSignal;
  }

  /*
   * `entityKeys` plus the database endpoint's key, as a NEW array (the
   * input may be shared). Unchanged when there is no endpoint or the key is
   * already present.
   */
  protected static withDatabaseEndpointEntityKey(data: {
    entityKeys: Array<string> | undefined;
    projectId: ObjectID;
    endpoint: DatabaseEndpoint | null | undefined;
  }): Array<string> {
    const entityKeys: Array<string> = data.entityKeys || [];

    if (!data.endpoint || !data.endpoint.host) {
      return entityKeys;
    }

    const endpointKey: string = keyForDatabaseEndpoint(
      data.projectId.toString(),
      data.endpoint,
    );

    if (entityKeys.includes(endpointKey)) {
      return entityKeys;
    }

    return [...entityKeys, endpointKey];
  }

  /*
   * `entityKeys` plus the row key of each database given (nulls skipped,
   * duplicates collapsed), as a NEW array when anything was added — the
   * input may be shared. The row key is what makes linked telemetry the
   * database's: a batch whose endpoint the row does not own (or that
   * reported none) still carries it.
   */
  protected static withDatabaseServerRowEntityKeys(data: {
    entityKeys: Array<string> | undefined;
    projectId: ObjectID;
    databaseServerIds: Array<ObjectID | null | undefined>;
  }): Array<string> {
    const entityKeys: Array<string> = data.entityKeys || [];
    const added: Array<string> = [];

    for (const databaseServerId of data.databaseServerIds || []) {
      const id: string = databaseServerId ? databaseServerId.toString() : "";
      if (!id) {
        continue;
      }
      const rowKey: string = keyForDatabaseServerRow(
        data.projectId.toString(),
        id,
      );
      if (!entityKeys.includes(rowKey) && !added.includes(rowKey)) {
        added.push(rowKey);
      }
    }

    return added.length > 0 ? [...entityKeys, ...added] : entityKeys;
  }

  /*
   * The endpoint whose key a database batch's rows carry, given what the
   * pure gate resolved and the row discovery returned:
   *
   *   - no resolution, or no endpoint → none;
   *   - the batch names a row by `oneuptime.database.server.id` and
   *     discovery returned THAT row → none. The row key places the rows;
   *     the reported address may be owned by another database (its page
   *     must not show them) or by no one yet (a row that claims it later
   *     must not inherit them), so it never keys them;
   *   - the batch names a row but discovery returned nothing (the link was
   *     not in the project and the endpoint resolved to no row, or
   *     discovery failed) → none: the batch is not provably anyone's but
   *     the row it names;
   *   - otherwise (resolved by its endpoint, or not resolved at all) → the
   *     endpoint. Discovery by endpoint returns the endpoint's owner, so
   *     the key is that row's; unresolved, it waits for a row to own it.
   */
  protected static getDatabaseEndpointForEntityKey(data: {
    resolution: DatabaseServerResourceResolution | null;
    databaseServerId: ObjectID | null;
  }): DatabaseEndpoint | null {
    const resolution: DatabaseServerResourceResolution | null = data.resolution;

    if (!resolution || !resolution.endpoint) {
      return null;
    }

    if (resolution.linkedDatabaseServerId) {
      if (!data.databaseServerId) {
        return null;
      }
      if (
        data.databaseServerId.toString().toLowerCase() ===
        resolution.linkedDatabaseServerId.toLowerCase()
      ) {
        return null;
      }
    }

    return resolution.endpoint;
  }

  private static hasAttributeKey(attributes: JSONArray, key: string): boolean {
    for (const attribute of attributes) {
      if (attribute && (attribute as JSONObject)["key"] === key) {
        return true;
      }
    }
    return false;
  }

  /*
   * Auto-discover the DatabaseServer a collector DB receiver (or the
   * OneUptime Database Agent) is reporting engine telemetry for.
   *
   * The gate is the pure resolveDatabaseServerResource: it runs before any
   * cache or database call, and an application batch — whatever its
   * attributes — is never a database. Identity, in order:
   *
   *   1. `oneuptime.database.server.id` (the agent config from the in-app
   *      docs stamps it): that row, if it is in this project. The endpoint
   *      the batch reports is claimed for it as an alias when it is a
   *      stable (GLOBAL-scope, not a pod IP) endpoint nobody owns, so
   *      application traces to the same address join the row too. An
   *      endpoint another row owns is never taken. The rows reach the
   *      database's pages through its row key either way (see
   *      getDatabaseEndpointForEntityKey), whatever address they report.
   *   2. Otherwise (or when the linked row is gone) the endpoint:
   *      DatabaseServerService.findOrCreateByEndpoint with discovery source
   *      "collector". Only a stable endpoint of an auto-creatable engine
   *      may create a row (resolution.allowCreate); any other endpoint —
   *      LOCAL scope, a pod IP, a namespace-expanded single label, an
   *      unknown engine — only ever joins a row that already owns it.
   *      findOrCreateByEndpoint may also decline to create (the project's
   *      auto-create budget); the batch then simply resolves to no row.
   *
   * Then, behind the "database-server" maintenance fence, the collector
   * heartbeat (agent and engine versions, and the engine the batch reports)
   * and oneuptime.label.* promotion.
   * Never throws: null (no row) is always a valid answer, and the caller
   * then routes the batch as it would any other.
   */
  protected static async autoDiscoverDatabaseServer(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    receiverSystemHint?: string | null | undefined;
  }): Promise<ObjectID | null> {
    const resolved: DatabaseServerResourceResolution | null =
      this.readDiscoveryMatch({
        resource: "database server",
        read: (): DatabaseServerResourceResolution | null => {
          return this.resolveDatabaseServerResource({
            attributes: data.attributes,
            receiverSystemHint: data.receiverSystemHint,
          });
        },
      });

    if (!resolved) {
      return null;
    }

    return await this.discoverMatchedDatabaseServer({
      projectId: data.projectId,
      attributes: data.attributes,
      resolved: resolved,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverDatabaseServer" })
  private static async discoverMatchedDatabaseServer(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    resolved: DatabaseServerResourceResolution;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const resolved: DatabaseServerResourceResolution = data.resolved;

      const agentVersion: string | null = this.getStringAttribute(
        data.attributes,
        "oneuptime.agent.version",
      );

      const resolveRow: () => Promise<CachedDatabaseServerId | null> =
        async (): Promise<CachedDatabaseServerId | null> => {
          let row: CachedDatabaseServerId | null = null;

          if (resolved.linkedDatabaseServerId) {
            row = await this.findLinkedDatabaseServerId({
              projectId: data.projectId,
              linkedDatabaseServerId: resolved.linkedDatabaseServerId,
              endpoint: resolved.endpoint,
              endpointIsStable: resolved.endpointIsStable,
            });
          }

          if (!row && resolved.endpoint) {
            row = await this.findOrCreateDatabaseServerIdByEndpoint({
              projectId: data.projectId,
              resolved: resolved,
              endpoint: resolved.endpoint,
              /*
               * A row this batch creates starts with its versions (see
               * FindOrCreateDatabaseServerByEndpointData.collector): the
               * heartbeat below can lose its write to the create's own
               * side effects, and nothing retries it until the fence
               * expires.
               */
              collector: {
                agentVersion: agentVersion || undefined,
                dbVersion: resolved.version || undefined,
                reportedByDatabaseAgent: this.hasAttributeKey(
                  data.attributes,
                  DATABASE_AGENT_ATTRIBUTE,
                ),
              },
            });
          }

          return row;
        };

      /*
       * The engine rides along as collector evidence: the endpoint path
       * weighs it in findOrCreateByEndpoint, but a batch linked by id
       * never goes there, so this is the only place its engine can
       * correct (or refine to a fork) one an image or spans guessed.
       */
      const heartbeat: (
        databaseServerId: ObjectID,
      ) => Promise<ResourceHeartbeatResult> = async (
        databaseServerId: ObjectID,
      ): Promise<ResourceHeartbeatResult> => {
        return await DatabaseServerService.recordCollectorHeartbeat(
          databaseServerId,
          {
            agentVersion: agentVersion || undefined,
            dbVersion: resolved.version || undefined,
            dbSystem: resolved.system || undefined,
          },
        );
      };

      let row: CachedDatabaseServerId | null = await resolveRow();

      if (!row) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes path — one heartbeat write
       * and one label pass per database per fence window, however many
       * batches its collector sends.
       */
      if (await this.shouldRunMaintenance("database-server", row.id)) {
        armedFences.push({ scope: "database-server", id: row.id });

        const written: ResourceHeartbeatResult = await heartbeat(
          new ObjectID(row.id),
        );

        /*
         * The database was deleted while its id was cached (an endpoint's
         * key, or a linked id's): forget that key and find the database
         * again, as on first contact - the row that owns the endpoint now,
         * or a new one where one may be created.
         */
        if (written?.isRowGone) {
          await DiscoveredResourceIdCache.forget({
            namespace: DiscoveredResourceKinds.DatabaseServer.namespace,
            key: row.cacheKey,
            id: row.id,
          });

          row = await resolveRow();

          if (!row) {
            return null;
          }

          if (await this.shouldRunMaintenance("database-server", row.id)) {
            armedFences.push({ scope: "database-server", id: row.id });
            await heartbeat(new ObjectID(row.id));
          }
        }

        await this.promoteOneuptimeLabelsToDatabaseServer({
          projectId: data.projectId,
          databaseServerId: new ObjectID(row.id),
          attributes: data.attributes,
        });
      }

      return new ObjectID(row.id);
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering database server: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * The row a batch's `oneuptime.database.server.id` names, when it exists
   * in this project; null otherwise (the caller then falls back to the
   * endpoint). The id is untrusted input, hence findByIdInProject.
   *
   * Cached per (id, observed endpoint), not per id: the claim of the
   * observed endpoint runs only on a miss, so an id-only key would claim at
   * most one address per id per TTL — a changed DATABASE_SERVER_ADDRESS, or
   * several agents (primary, replicas) sharing one id, would leave every
   * other address unclaimed for up to an hour.
   */
  private static async findLinkedDatabaseServerId(data: {
    projectId: ObjectID;
    linkedDatabaseServerId: string;
    endpoint: DatabaseEndpoint | null;
    endpointIsStable: boolean;
  }): Promise<CachedDatabaseServerId | null> {
    const namespace: string = DiscoveredResourceKinds.DatabaseServer.namespace;
    const cacheKey: string = `${data.projectId.toString()}:id:${
      data.linkedDatabaseServerId
    }:${data.endpoint ? formatDatabaseEndpoint(data.endpoint) : "-"}`;

    const cachedId: string | null = await this.getEntityIdFromCaches(
      namespace,
      cacheKey,
    );
    if (cachedId) {
      return { id: cachedId, cacheKey: cacheKey };
    }

    const unresolvedKey: string = `${namespace}:${cacheKey}`;
    if (this.unresolvedDatabaseServerMemo.get(unresolvedKey)) {
      return null;
    }

    const databaseServer: DatabaseServer | null =
      await DatabaseServerService.findByIdInProject(
        data.projectId,
        new ObjectID(data.linkedDatabaseServerId),
      );

    if (!databaseServer || !databaseServer._id) {
      this.unresolvedDatabaseServerMemo.set(unresolvedKey, true);
      return null;
    }

    const databaseServerIdStr: string = databaseServer._id.toString();

    const claimSettled: boolean = await this.claimObservedDatabaseEndpoint({
      projectId: data.projectId,
      databaseServerId: new ObjectID(databaseServerIdStr),
      endpoint: data.endpoint,
      endpointIsStable: data.endpointIsStable,
    });

    /*
     * A claim that failed (not one that found the endpoint taken) leaves the
     * id uncached, so the next batch retries the claim instead of waiting
     * out the cache TTL. The id itself is still good for this batch.
     */
    if (claimSettled) {
      await this.setEntityIdInCaches(
        namespace,
        cacheKey,
        databaseServerIdStr,
        DiscoveredResourceKinds.DatabaseServer.expiresInSeconds,
      );
    }

    return { id: databaseServerIdStr, cacheKey: cacheKey };
  }

  /*
   * Claim the endpoint a linked batch reports as an alias of its row, so
   * application traces to that address join the row too. (The batch's own
   * rows do not need it: they carry the row key.) Only a stable endpoint is
   * ever claimed — a single-label name or an unqualified private IP means
   * different servers in different networks, and a pod IP is reassigned on
   * every restart, so none of them becomes anyone's alias automatically —
   * and only when it is free: "owned-by-other" is a final answer, never a
   * takeover. Returns false only when the claim itself failed.
   */
  private static async claimObservedDatabaseEndpoint(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    endpoint: DatabaseEndpoint | null;
    endpointIsStable: boolean;
  }): Promise<boolean> {
    if (
      !data.endpoint ||
      !data.endpointIsStable ||
      getDatabaseEndpointScope(data.endpoint) !== "global"
    ) {
      return true;
    }

    const formattedEndpoint: string = formatDatabaseEndpoint(data.endpoint);

    try {
      const result: DatabaseServerEndpointClaimResult =
        await DatabaseServerEndpointService.claimEndpoint({
          projectId: data.projectId,
          databaseServerId: data.databaseServerId,
          endpoint: formattedEndpoint,
          isPrimary: false,
          source: "auto",
        });

      if (result === "owned-by-other") {
        logger.debug(
          `Database ${data.databaseServerId.toString()} reports endpoint ${formattedEndpoint}, which another database already owns; not claimed.`,
        );
      }

      return true;
    } catch (err) {
      logger.warn(
        `Claiming endpoint ${formattedEndpoint} for database ${data.databaseServerId.toString()} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  /*
   * The row that owns this endpoint, or a new one (discovery source
   * "collector") when the resolution allows creating one. Null when nothing
   * owns it and none may be created — a LOCAL-scope endpoint, an ephemeral
   * one (a pod IP), an unknown engine, or a project over its auto-create
   * budget — which is memoed briefly rather than cached.
   */
  private static async findOrCreateDatabaseServerIdByEndpoint(data: {
    projectId: ObjectID;
    resolved: DatabaseServerResourceResolution;
    endpoint: DatabaseEndpoint;
    collector: DatabaseServerCollectorReport;
  }): Promise<CachedDatabaseServerId | null> {
    const namespace: string = DiscoveredResourceKinds.DatabaseServer.namespace;
    const cacheKey: string = `${data.projectId.toString()}:${formatDatabaseEndpoint(
      data.endpoint,
    )}`;

    const cachedId: string | null = await this.getEntityIdFromCaches(
      namespace,
      cacheKey,
    );
    if (cachedId) {
      return { id: cachedId, cacheKey: cacheKey };
    }

    const allowCreate: boolean = data.resolved.allowCreate === true;

    /*
     * The memo remembers "no row, and this batch could not make one". A
     * batch that MAY create one (the same endpoint reported from a stable
     * context) must not be turned away by it, so the answer is memoed per
     * permission.
     */
    const unresolvedKey: string = `${namespace}:${cacheKey}:${
      allowCreate ? "create" : "join"
    }`;
    if (this.unresolvedDatabaseServerMemo.get(unresolvedKey)) {
      return null;
    }

    const databaseServer: DatabaseServer | null =
      await DatabaseServerService.findOrCreateByEndpoint({
        projectId: data.projectId,
        dbSystem: data.resolved.system,
        endpoint: data.endpoint,
        discoverySource: DatabaseServerDiscoverySource.Collector,
        displayName: data.resolved.displayName || undefined,
        allowCreate: allowCreate,
        collector: data.collector,
      });

    if (!databaseServer || !databaseServer._id) {
      this.unresolvedDatabaseServerMemo.set(unresolvedKey, true);
      return null;
    }

    const databaseServerIdStr: string = databaseServer._id.toString();

    await this.setEntityIdInCaches(
      namespace,
      cacheKey,
      databaseServerIdStr,
      DiscoveredResourceKinds.DatabaseServer.expiresInSeconds,
    );

    return { id: databaseServerIdStr, cacheKey: cacheKey };
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into project
   * labels and attach them to the discovered database. Mirrors the other
   * resources; throttled per database inside `attachLabels`.
   */
  protected static async promoteOneuptimeLabelsToDatabaseServer(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await DatabaseServerService.attachLabels({
        databaseServerId: data.databaseServerId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Database label promotion failed for ${data.databaseServerId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * Classify a batch as browser- or mobile-RUM from its resource
   * attributes, or null when it's not client-side telemetry.
   *
   * `browser.*`, `device.id` and `device.model.identifier` are clean
   * signals — nothing but a client SDK sets them. `device.manufacturer`
   * used to be treated the same way, but it is also how a machine's make
   * is reported for host inventory, so it now needs the host-identity
   * check below to stay unambiguous.
   */
  protected static getRumClientType(attributes: JSONArray): string | null {
    const hasBrowser: boolean = Boolean(
      this.getStringAttribute(attributes, "browser.platform") ||
        this.getStringAttribute(attributes, "browser.language") ||
        this.getStringArrayAttribute(attributes, "browser.brands").length > 0,
    );
    if (hasBrowser) {
      return "browser";
    }
    const hasDevice: boolean = Boolean(
      this.getStringAttribute(attributes, "device.id") ||
        this.getStringAttribute(attributes, "device.model.identifier"),
    );
    if (hasDevice) {
      return "mobile";
    }

    /*
     * `device.manufacturer` on its own is no longer proof of a phone.
     * OneUptime now reads a machine's make and model as host inventory
     * metadata (issue #3866), and an operator stamps those onto the
     * collector's resource — often machine-wide through
     * OTEL_RESOURCE_ATTRIBUTES, which every process on the box inherits.
     *
     * Classifying those batches as RUM is not a cosmetic mislabel: it
     * makes `getServiceNameFromAttributes` return null, so the host's
     * real Service row stops being created, and it makes
     * `autoDiscoverRum` mint a Mobile RUM Application named after that
     * service. A genuine mobile resource carries no host identity — the
     * mobile SDKs set `device.*` and `os.*` and nothing in the `host.*`
     * namespace — so require its absence before trusting the weaker
     * signal. `device.id` and `device.model.identifier` above are
     * unambiguous and stay unconditional.
     *
     * Host identity is read through `getHostNameFromAttributes` rather than
     * a raw `host.name` lookup, so a node whose collector labels it with
     * `k8s.node.name` instead — the DaemonSet install, the eBPF profiler —
     * counts as a machine too. `getServiceNameFromAttributes` uses the same
     * accessor, so both host branches of this file agree on what host
     * identity means.
     */
    const hasDeviceManufacturerOnly: boolean = Boolean(
      this.getStringAttribute(attributes, "device.manufacturer") &&
        !this.getHostNameFromAttributes(attributes) &&
        !this.getStringAttribute(attributes, "host.id"),
    );
    if (hasDeviceManufacturerOnly) {
      return "mobile";
    }

    return null;
  }

  /*
   * Auto-discover a Browser / Mobile RUM application from OTel resource
   * attributes. Gated on a browser.* / device.* client signal; identity is
   * the application (service.name), NEVER the per-end-user device. Runs on
   * every ingest path so the app's telemetry tabs work even when service.name
   * is also a backend service — the discriminator choice happens in
   * resolveTelemetryResource.
   */
  protected static async autoDiscoverRum(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const application: RumApplicationMatch | null = this.readDiscoveryMatch({
      resource: "RUM application",
      read: (): RumApplicationMatch | null => {
        const clientType: string | null = this.getRumClientType(
          data.attributes,
        );
        if (!clientType) {
          return null;
        }

        const appIdentifier: string | null = this.getStringAttribute(
          data.attributes,
          "service.name",
        );
        if (!appIdentifier) {
          return null;
        }

        return { clientType: clientType, appIdentifier: appIdentifier };
      },
    });

    if (!application) {
      return null;
    }

    return await this.discoverMatchedRum({
      projectId: data.projectId,
      attributes: data.attributes,
      clientType: application.clientType,
      appIdentifier: application.appIdentifier,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverRum" })
  private static async discoverMatchedRum(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    clientType: string;
    appIdentifier: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const clientType: string = data.clientType;

      const appIdStr: string | null = await this.resolveDiscoveredResourceId({
        kindName: "RumApplication",
        projectId: data.projectId,
        identity: data.appIdentifier,
      });

      if (!appIdStr) {
        return null;
      }

      let liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.RumApplication,
        id: appIdStr,
        fenceScope: "rum-application",
        armedFences: armedFences,
        heartbeat: async (
          rumApplicationId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null =
            this.getStringAttribute(data.attributes, "telemetry.sdk.version") ||
            this.getStringAttribute(data.attributes, "oneuptime.agent.version");
          const sdkLanguage: string | null = this.getStringAttribute(
            data.attributes,
            "telemetry.sdk.language",
          );
          return await RumApplicationService.updateLastSeen(rumApplicationId, {
            agentVersion: agentVersion || undefined,
            clientType: clientType || undefined,
            sdkLanguage: sdkLanguage || undefined,
          });
        },
        promoteLabels: async (rumApplicationId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToRumApplication({
            projectId: data.projectId,
            rumApplicationId,
            attributes: data.attributes,
          });
        },
      });

      if (!liveIdStr) {
        return null;
      }

      // Live inventory: record this client platform (coarse, not per-device).
      const clientName: string | null =
        this.getStringAttribute(data.attributes, "browser.platform") ||
        this.getStringAttribute(data.attributes, "device.model.identifier");
      if (
        clientName &&
        (await this.shouldRunMaintenance(
          "rum-client",
          `${liveIdStr}:${clientName}`,
        ))
      ) {
        armedFences.push({
          scope: "rum-client",
          id: `${liveIdStr}:${clientName}`,
        });
        liveIdStr = await this.writeForDiscoveredResource({
          kind: DiscoveredResourceKinds.RumApplication,
          id: liveIdStr,
          write: async (rumApplicationId: ObjectID): Promise<void> => {
            await RumApplicationClientService.recordClient({
              projectId: data.projectId,
              rumApplicationId,
              clientName,
              clientType: clientType || undefined,
            });
          },
        });
      }
      return new ObjectID(liveIdStr);
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering RUM application: " + (err as Error).message,
      );
      return null;
    }
  }

  protected static async promoteOneuptimeLabelsToRumApplication(data: {
    projectId: ObjectID;
    rumApplicationId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await RumApplicationService.attachLabels({
        rumApplicationId: data.rumApplicationId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `RUM application label promotion failed for ${data.rumApplicationId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  protected static getHostNameFromAttributes(
    attributes: JSONArray,
  ): string | null {
    /*
     * Fall back to k8s.node.name when host.name is absent. The OTel
     * eBPF profiler (and any DaemonSet-style collector relying on the
     * k8sattributes processor for resource detection) labels its
     * resource with k8s.node.name instead of host.name, which left
     * every profile from a k8s node collapsing into "Unknown Service"
     * because the host-name service-name fallback in
     * getServiceNameFromAttributes missed entirely. A k8s node IS a
     * host, so reusing the same synthesised "host/{name}" identity
     * keeps profiles, metrics, logs and traces from the same node
     * grouped together.
     */
    return (
      this.getStringAttribute(attributes, "host.name") ||
      this.getStringAttribute(attributes, "k8s.node.name")
    );
  }

  /**
   * Canonical form of the OTel `host.name` resource attribute when it is
   * used as host identity: trimmed + lower-cased.
   *
   * host.name casing is not stable across batches. Windows in particular
   * surfaces the computer name upper-cased (COMPUTERNAME-style, e.g.
   * PRIMARY01) from some resource detectors and lower-cased from others,
   * so the same physical host arrives as both `PRIMARY01` and `primary01`.
   * This mirrors QueryHelper.findWithSameText — the comparison the Host
   * unique guard already uses — so identity stays consistent end to end.
   * Delegates to the shared entity-key canonicalization so host identity
   * here and in `computeEntityKey` can never drift apart.
   */
  public static canonicalizeHostName(hostName: string): string {
    return canonicalizeEntityValue(hostName);
  }

  /**
   * Canonicalize the `host.name` resource attribute, in place, across a
   * batch of OTel resource envelopes (resourceMetrics / resourceLogs /
   * resourceSpans — each element carries `resource.attributes`).
   *
   * Run once at the top of each pillar's ingest so that BOTH the host
   * identity we resolve (HostService.findOrCreateByHostIdentifier) AND the
   * `resource.host.name` attribute we persist on every analytics row use
   * the same casing. That keeps the host-detail pages' query
   * (`resource.host.name = host.hostIdentifier`) matching via ClickHouse's
   * fast case-sensitive Map subscript rather than forcing a slower
   * case-insensitive scan (see the StatementGenerator map-filter notes).
   */
  public static normalizeHostNameAttributesInPlace(
    resourceEnvelopes: JSONArray,
  ): void {
    if (!resourceEnvelopes || !Array.isArray(resourceEnvelopes)) {
      return;
    }

    for (const envelope of resourceEnvelopes) {
      const attributes: JSONArray | undefined = (
        (envelope as JSONObject)?.["resource"] as JSONObject | undefined
      )?.["attributes"] as JSONArray | undefined;

      if (!attributes || !Array.isArray(attributes)) {
        continue;
      }

      for (const attribute of attributes) {
        const attr: JSONObject = attribute as JSONObject;
        if (attr["key"] !== "host.name" || !attr["value"]) {
          continue;
        }

        const value: JSONObject = attr["value"] as JSONObject;
        const stringValue: JSONValue = value["stringValue"];
        if (typeof stringValue === "string" && stringValue.length > 0) {
          value["stringValue"] = this.canonicalizeHostName(stringValue);
        }
      }
    }
  }

  /*
   * Rewrite a non-canonical cloud.platform value in place, before anything
   * reads the resource: the auto-discovery gates decide on it, and the
   * per-signal flatten stores it as `resource.cloud.platform` on every span,
   * log and metric row. The dashboard scopes an environment's telemetry by
   * exact attribute match, so the value on the environment row and the
   * value on the rows have to be the same spelling — which is why this
   * happens once, on the wire shape, rather than at each reader. See
   * CLOUD_PLATFORM_ALIASES for the spellings involved (the Node and .NET
   * Azure detectors emit "azure.container_apps" where the convention says
   * "azure_container_apps").
   */
  protected static normalizeCloudPlatformAttribute(
    attributes: JSONArray,
  ): void {
    for (const attribute of attributes) {
      if (!attribute || attribute["key"] !== "cloud.platform") {
        continue;
      }
      const valueObject: JSONObject | undefined = attribute["value"] as
        | JSONObject
        | undefined;
      const raw: JSONValue | undefined = valueObject?.["stringValue"];
      if (typeof raw !== "string") {
        continue;
      }
      const canonical: string | null = normalizeCloudPlatform(raw);
      if (canonical && canonical !== raw && valueObject) {
        valueObject["stringValue"] = canonical;
      }
    }
  }

  protected static getStringAttribute(
    attributes: JSONArray,
    key: string,
  ): string | null {
    for (const attribute of attributes) {
      if (
        attribute["key"] === key &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"]
      ) {
        const value: JSONValue = (attribute["value"] as JSONObject)[
          "stringValue"
        ];
        if (typeof value === "string" && value.trim()) {
          return value.trim();
        }
      }
    }
    return null;
  }

  /**
   * Whether this OTLP resource identifies a supported Kubernetes entity.
   * Keep Host-producing ingest paths on the same predicate as InventoryItem
   * extraction so adding a semconv identity cannot reopen phantom Hosts in a
   * second pipeline.
   */
  protected static hasKubernetesIdentity(attributes: JSONArray): boolean {
    return InventoryItem.hasKubernetesIdentity(
      TelemetryUtil.getAttributes({
        items: attributes,
        prefixKeysWithString: "",
      }),
    );
  }

  /**
   * Read an OTel attribute that may be either a single string or an
   * array of strings, returning the values as a list. Used for
   * attributes like host.ip whose schema is "array of IP addresses".
   * Falls back to a single stringValue if the attribute uses that
   * shape (some SDKs flatten single-element arrays to a string).
   */
  protected static getStringArrayAttribute(
    attributes: JSONArray,
    key: string,
  ): Array<string> {
    for (const attribute of attributes) {
      if (attribute["key"] !== key || !attribute["value"]) {
        continue;
      }
      const value: JSONObject = attribute["value"] as JSONObject;

      const arrayValue: JSONObject | undefined = value["arrayValue"] as
        | JSONObject
        | undefined;
      if (arrayValue && Array.isArray(arrayValue["values"])) {
        const out: Array<string> = [];
        for (const v of arrayValue["values"] as JSONArray) {
          const sv: JSONValue = (v as JSONObject)["stringValue"];
          if (typeof sv === "string" && sv.trim()) {
            out.push(sv.trim());
          }
        }
        if (out.length > 0) {
          return out;
        }
      }

      const stringValue: JSONValue = value["stringValue"];
      if (typeof stringValue === "string" && stringValue.trim()) {
        return [stringValue.trim()];
      }
    }
    return [];
  }

  protected static isDockerRuntime(attributes: JSONArray): boolean {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "container.runtime" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"] === "docker"
      ) {
        return true;
      }
    }
    return false;
  }

  protected static isPodmanRuntime(attributes: JSONArray): boolean {
    for (const attribute of attributes) {
      if (
        attribute["key"] === "container.runtime" &&
        attribute["value"] &&
        (attribute["value"] as JSONObject)["stringValue"] === "podman"
      ) {
        return true;
      }
    }
    return false;
  }

  /*
   * True when resource attributes carry a strong "this is a real host"
   * signal — os.type (set by the OTel system resourcedetector via
   * native OS calls, which app SDKs typically don't include), a
   * container runtime, or a k8s cluster name. Used to gate the
   * synthesized "host/{hostName}" service name so application SDKs
   * auto-detecting hostname inside a pod don't create phantom
   * per-pod services.
   */
  protected static hasHostResourceSignal(attributes: JSONArray): boolean {
    return Boolean(
      this.getStringAttribute(attributes, "os.type") ||
        this.getStringAttribute(attributes, "container.runtime") ||
        this.getClusterNameFromAttributes(attributes),
    );
  }

  protected static async autoDiscoverDockerHost(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const hostName: string | null = this.readDiscoveryMatch({
      resource: "Docker host",
      read: (): string | null => {
        if (!this.isDockerRuntime(data.attributes)) {
          return null;
        }

        return this.getHostNameFromAttributes(data.attributes);
      },
    });

    if (!hostName) {
      return null;
    }

    return await this.discoverMatchedDockerHost({
      projectId: data.projectId,
      attributes: data.attributes,
      hostName: hostName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverDockerHost" })
  private static async discoverMatchedDockerHost(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    hostName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const hostIdStr: string | null = await this.resolveDiscoveredResourceId({
        kindName: "DockerHost",
        projectId: data.projectId,
        identity: data.hostName,
      });

      if (!hostIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes path — skip the
       * per-batch maintenance UPDATE + label upsert when we
       * already ran it within the fence window.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.DockerHost,
        id: hostIdStr,
        fenceScope: "docker-host",
        armedFences: armedFences,
        heartbeat: async (
          hostId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const osType: string | null = this.getStringAttribute(
            data.attributes,
            "os.type",
          );
          const osVersion: string | null =
            this.getStringAttribute(data.attributes, "os.description") ||
            this.getStringAttribute(data.attributes, "os.version");
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await DockerHostService.updateLastSeen(hostId, {
            osType: osType || undefined,
            osVersion: osVersion || undefined,
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (hostId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToDockerHost({
            projectId: data.projectId,
            dockerHostId: hostId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Docker host: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Docker host.
   * Mirrors the host/service label promotion. Throttled per-host
   * inside `attachLabels` so steady-state ingest with unchanged
   * labels costs one in-memory cache lookup.
   */
  protected static async promoteOneuptimeLabelsToDockerHost(data: {
    projectId: ObjectID;
    dockerHostId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await DockerHostService.attachLabels({
        dockerHostId: data.dockerHostId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Docker host label promotion failed for ${data.dockerHostId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  protected static async autoDiscoverPodmanHost(data: {
    projectId: ObjectID;
    attributes: JSONArray;
  }): Promise<ObjectID | null> {
    const hostName: string | null = this.readDiscoveryMatch({
      resource: "Podman host",
      read: (): string | null => {
        if (!this.isPodmanRuntime(data.attributes)) {
          return null;
        }

        return this.getHostNameFromAttributes(data.attributes);
      },
    });

    if (!hostName) {
      return null;
    }

    return await this.discoverMatchedPodmanHost({
      projectId: data.projectId,
      attributes: data.attributes,
      hostName: hostName,
    });
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverPodmanHost" })
  private static async discoverMatchedPodmanHost(data: {
    projectId: ObjectID;
    attributes: JSONArray;
    hostName: string;
  }): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const hostIdStr: string | null = await this.resolveDiscoveredResourceId({
        kindName: "PodmanHost",
        projectId: data.projectId,
        identity: data.hostName,
      });

      if (!hostIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the Kubernetes path — skip the
       * per-batch maintenance UPDATE + label upsert when we
       * already ran it within the fence window.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.PodmanHost,
        id: hostIdStr,
        fenceScope: "podman-host",
        armedFences: armedFences,
        heartbeat: async (
          hostId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const osType: string | null = this.getStringAttribute(
            data.attributes,
            "os.type",
          );
          const osVersion: string | null =
            this.getStringAttribute(data.attributes, "os.description") ||
            this.getStringAttribute(data.attributes, "os.version");
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          return await PodmanHostService.updateLastSeen(hostId, {
            osType: osType || undefined,
            osVersion: osVersion || undefined,
            agentVersion: agentVersion || undefined,
          });
        },
        promoteLabels: async (hostId: ObjectID): Promise<void> => {
          await this.promoteOneuptimeLabelsToPodmanHost({
            projectId: data.projectId,
            podmanHostId: hostId,
            attributes: data.attributes,
          });
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error(
        "Error auto-discovering Podman host: " + (err as Error).message,
      );
      return null;
    }
  }

  /*
   * Promote `oneuptime.label.<dim>=<val>` resource attributes into
   * project labels and attach them to the discovered Podman host.
   * Mirrors the host/service label promotion. Throttled per-host
   * inside `attachLabels` so steady-state ingest with unchanged
   * labels costs one in-memory cache lookup.
   */
  protected static async promoteOneuptimeLabelsToPodmanHost(data: {
    projectId: ObjectID;
    podmanHostId: ObjectID;
    attributes: JSONArray;
  }): Promise<void> {
    try {
      const labelNames: Array<string> = extractOneuptimeLabelNames(
        data.attributes,
      );
      if (labelNames.length === 0) {
        return;
      }
      const labelIds: Array<ObjectID> =
        await LabelService.findOrCreateLabelsByNames({
          projectId: data.projectId,
          labelNames,
        });
      if (labelIds.length === 0) {
        return;
      }
      await PodmanHostService.attachLabels({
        podmanHostId: data.podmanHostId,
        labelIds,
      });
    } catch (err) {
      logger.warn(
        `Podman host label promotion failed for ${data.podmanHostId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Auto-discover a Host (generic OTel host) from resource attributes.
   *
   * Phantom-host gate: only register a row when the batch carries a
   * strong signal that this is real host telemetry, not an application
   * SDK auto-detecting hostname inside a pod and not a Kubernetes node
   * or pod (those have their own KubernetesCluster home). Requires:
   *
   *   1. Explicit `host.name` resource attribute. The k8s.node.name
   *      fallback used by `getHostNameFromAttributes` for service-name
   *      synthesis is NOT accepted here — kubeletstats labels pod and
   *      node metrics with k8s.node.name only, which would otherwise
   *      flood the Hosts list with k8s node names.
   *   2. No supported Kubernetes identity resource attribute. This uses the
   *      same predicate as InventoryItem extraction, including pod/node UIDs,
   *      namespace and deployment identities as well as pod/node/cluster
   *      names. Keeping one shared gate prevents one path from suppressing a
   *      phantom registry Host while this path recreates its typed Host row.
   *   3. The same batch did not already resolve to a DockerHost or
   *      KubernetesCluster row. Docker hosts and K8s clusters/nodes have
   *      their own dedicated tables; we don't want a duplicate Host row
   *      pointing back at them via dockerHostId / kubernetesClusterId.
   *      Nor to a DatabaseServer: a collector DB receiver's batch carries
   *      the host.name / os.type of the machine the collector runs on, not
   *      of anything the batch describes. (The metrics caller passes no
   *      databaseServerId for a resource block that itself also carries
   *      system.* / process.* metrics, which stays a Host. Each collector
   *      receiver emits its own block, so a DB receiver next to hostmetrics
   *      in one pipeline is still the database's.)
   *   4. One of:
   *        - os.type resource attribute (set by the resourcedetection
   *          system detector via native OS calls — app SDKs typically
   *          don't include it)
   *        - container.runtime resource attribute (non-Docker container
   *          host — Docker is already excluded by gate (3))
   *        - hasInfraSignal=true (caller saw system.* / process.*
   *          metrics that only a host agent emits)
   *
   * Notably we DO NOT accept host.id or host.arch alone — both are
   * commonly auto-detected by application SDKs from inside a container,
   * so trusting them would flood the Hosts list with pod-name rows.
   * They are still captured into the Host record if present, just not
   * sufficient to create a row by themselves.
   */
  protected static async autoDiscoverHost(
    data: HostDiscovery,
  ): Promise<ObjectID | null> {
    const hostName: string | null = this.readDiscoveryMatch({
      resource: "Host",
      read: (): string | null => {
        return this.getDiscoverableHostName(data);
      },
    });

    if (!hostName) {
      return null;
    }

    return await this.discoverMatchedHost({ ...data, hostName: hostName });
  }

  /*
   * autoDiscoverHost's gate, as described above it: the host.name a
   * resource block registers its Host by, or null when the block is not a
   * Host's telemetry.
   */
  private static getDiscoverableHostName(data: HostDiscovery): string | null {
    /*
     * Docker hosts, Podman hosts, Kubernetes clusters/nodes and databases
     * live in their own tables. If this batch already resolved to one, do
     * not also create a Host row.
     */
    if (
      data.dockerHostId ||
      data.podmanHostId ||
      data.kubernetesClusterId ||
      data.databaseServerId
    ) {
      return null;
    }

    const hostName: string | null = this.getStringAttribute(
      data.attributes,
      "host.name",
    );

    if (!hostName) {
      return null;
    }

    if (this.hasKubernetesIdentity(data.attributes)) {
      return null;
    }

    /*
     * Managed / serverless compute (ECS, Fargate, Cloud Run, App Engine,
     * Lambda, …) is owned by the CloudResource / ServerlessFunction tables,
     * not Host. Skip so we don't also create a phantom Host row for those
     * platforms. Raw VM platforms (aws_ec2, gcp_compute_engine, azure_vm)
     * are intentionally NOT in these sets, so VMs still become Hosts.
     */
    const hostCloudPlatform: string | null = normalizeCloudPlatform(
      this.getStringAttribute(data.attributes, "cloud.platform"),
    );
    if (
      hostCloudPlatform &&
      (FAAS_CLOUD_PLATFORM_VALUES.has(hostCloudPlatform) ||
        MANAGED_CLOUD_PLATFORM_VALUES.has(hostCloudPlatform))
    ) {
      return null;
    }

    const osType: string | null = this.getStringAttribute(
      data.attributes,
      "os.type",
    );
    const containerRuntime: string | null = this.getStringAttribute(
      data.attributes,
      "container.runtime",
    );

    const hasResourceSignal: boolean = Boolean(osType || containerRuntime);

    if (!hasResourceSignal && !data.hasInfraSignal) {
      return null;
    }

    return hostName;
  }

  @CaptureSpan({ name: "OtelIngestBaseService.autoDiscoverHost" })
  private static async discoverMatchedHost(
    data: HostDiscovery & { hostName: string },
  ): Promise<ObjectID | null> {
    /*
     * Fences armed below, released by the catch block. See
     * releaseMaintenanceFences.
     */
    const armedFences: Array<MaintenanceFence> = [];
    try {
      const hostName: string = data.hostName;
      const hostIdAttr: string | null = this.getStringAttribute(
        data.attributes,
        "host.id",
      );
      const hostArch: string | null = this.getStringAttribute(
        data.attributes,
        "host.arch",
      );
      const hostType: string | null = this.getStringAttribute(
        data.attributes,
        "host.type",
      );
      const ipAddresses: Array<string> = this.getStringArrayAttribute(
        data.attributes,
        "host.ip",
      );
      const hostIpJoined: string | null = normalizeHostIpAddresses(ipAddresses);
      const osType: string | null = this.getStringAttribute(
        data.attributes,
        "os.type",
      );
      const osVersion: string | null =
        this.getStringAttribute(data.attributes, "os.description") ||
        this.getStringAttribute(data.attributes, "os.version");
      const containerRuntime: string | null = this.getStringAttribute(
        data.attributes,
        "container.runtime",
      );

      const hostIdStr: string | null = await this.resolveDiscoveredResourceId({
        kindName: "Host",
        projectId: data.projectId,
        identity: hostName,
      });

      if (!hostIdStr) {
        return null;
      }

      /*
       * Same fence rationale as the K8s / Docker paths — bound the
       * per-batch updateLastSeen UPDATE to one Postgres write per
       * (host, fence-window). Host's update includes infra stats
       * (cpu/memory/process counts) but those are sampled over
       * minutes, so a 5-minute stale window is acceptable.
       */
      const liveIdStr: string | null = await this.maintainDiscoveredResource({
        kind: DiscoveredResourceKinds.Host,
        id: hostIdStr,
        fenceScope: "host",
        armedFences: armedFences,
        heartbeat: async (
          hostId: ObjectID,
        ): Promise<ResourceHeartbeatResult> => {
          const agentVersion: string | null = this.getStringAttribute(
            data.attributes,
            "oneuptime.agent.version",
          );
          const deploymentEnvironment: string | null =
            this.getStringAttribute(
              data.attributes,
              "deployment.environment.name",
            ) ||
            this.getStringAttribute(data.attributes, "deployment.environment");
          const runtimeName: string | null = this.getStringAttribute(
            data.attributes,
            "process.runtime.name",
          );
          const runtimeVersion: string | null = this.getStringAttribute(
            data.attributes,
            "process.runtime.version",
          );
          const cloudProvider: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.provider",
          );
          const cloudPlatform: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.platform",
          );
          const cloudRegion: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.region",
          );
          const cloudAccountId: string | null = this.getStringAttribute(
            data.attributes,
            "cloud.account.id",
          );
          const heartbeat: ResourceHeartbeatResult =
            await HostService.updateLastSeen(hostId, {
              osType: osType || undefined,
              osVersion: osVersion || undefined,
              hostId: hostIdAttr || undefined,
              hostArch: hostArch || undefined,
              hostType: hostType || undefined,
              hostIpAddresses: hostIpJoined || undefined,
              cpuCores: data.cpuCores,
              totalMemoryBytes: data.totalMemoryBytes,
              processCount: data.processCount,
              containerRuntime: containerRuntime || undefined,
              dockerHostId: data.dockerHostId || undefined,
              kubernetesClusterId: data.kubernetesClusterId || undefined,
              agentVersion: agentVersion || undefined,
              deploymentEnvironment: deploymentEnvironment || undefined,
              runtimeName: runtimeName || undefined,
              runtimeVersion: runtimeVersion || undefined,
              cloudProvider: cloudProvider || undefined,
              cloudPlatform: cloudPlatform || undefined,
              cloudRegion: cloudRegion || undefined,
              cloudAccountId: cloudAccountId || undefined,
            });

          if (heartbeat?.isRowGone) {
            return heartbeat;
          }

          /*
           * Proxmox guest cross-link heuristic (best-effort): when this
           * host's identifier matches a ProxmoxResource guest name in
           * the same project, stamp Host.proxmoxClusterId so the
           * GuestDetail page can show the linked Host card. Rides the
           * same maintenance fence as updateLastSeen — at most one
           * lookup per host per fence window.
           */
          await this.tryLinkHostToProxmoxGuest({
            projectId: data.projectId,
            hostId: hostId,
            hostName,
          });

          return heartbeat;
        },
      });

      return liveIdStr ? new ObjectID(liveIdStr) : null;
    } catch (err) {
      await this.releaseMaintenanceFences(armedFences);
      logger.error("Error auto-discovering Host: " + (err as Error).message);
      return null;
    }
  }

  private static readonly HOST_PROXMOX_LINK_CACHE_NAMESPACE: string =
    "host-proxmox-guest-link";
  private static readonly HOST_PROXMOX_LINK_CACHE_EXPIRY_SECONDS: number =
    24 * 60 * 60; // 1 day

  /**
   * WI-17 ingest heuristic: a Host whose hostIdentifier
   * case-insensitively equals a ProxmoxResource guest `name` in the
   * same project is (almost certainly) the host agent running inside
   * that VM — stamp Host.proxmoxClusterId so the two products
   * cross-link. Best-effort and additive only:
   *
   *   - NEVER overwrites a non-null proxmoxClusterId (a manual or
   *     earlier link wins; guest names are not guaranteed unique
   *     across clusters).
   *   - A successful (or already-present) link is cached for a day so
   *     the steady state costs one Redis read.
   *   - A miss is NOT negatively cached — the guest inventory may
   *     simply not have been scraped yet; we retry on the next
   *     maintenance fence window (≤ one indexed SELECT per host per
   *     5 minutes).
   *   - Failures are logged and swallowed; host discovery must never
   *     depend on the Proxmox inventory.
   */
  protected static async tryLinkHostToProxmoxGuest(data: {
    projectId: ObjectID;
    hostId: ObjectID;
    hostName: string;
  }): Promise<void> {
    try {
      const cacheKey: string = `${data.projectId.toString()}:${data.hostId.toString()}`;
      const alreadyLinked: string | null = await GlobalCache.getString(
        this.HOST_PROXMOX_LINK_CACHE_NAMESPACE,
        cacheKey,
      );
      if (alreadyLinked) {
        return;
      }

      const host: Host | null = await HostService.findOneById({
        id: data.hostId,
        select: {
          _id: true,
          proxmoxClusterId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!host) {
        return;
      }

      if (host.proxmoxClusterId) {
        // Already linked — cache so we skip the SELECT next window.
        await GlobalCache.setString(
          this.HOST_PROXMOX_LINK_CACHE_NAMESPACE,
          cacheKey,
          "1",
          { expiresInSeconds: this.HOST_PROXMOX_LINK_CACHE_EXPIRY_SECONDS },
        );
        return;
      }

      const proxmoxClusterId: ObjectID | null =
        await ProxmoxResourceService.findGuestClusterIdByName({
          projectId: data.projectId,
          name: data.hostName,
        });

      if (!proxmoxClusterId) {
        return; // No matching guest (yet) — retry next fence window.
      }

      await HostService.updateOneById({
        id: data.hostId,
        data: {
          proxmoxClusterId: proxmoxClusterId,
        },
        props: {
          isRoot: true,
        },
      });

      await GlobalCache.setString(
        this.HOST_PROXMOX_LINK_CACHE_NAMESPACE,
        cacheKey,
        "1",
        { expiresInSeconds: this.HOST_PROXMOX_LINK_CACHE_EXPIRY_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `Host → Proxmox guest link failed for host ${data.hostId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Pre-scan a resourceMetric's scopeMetrics to detect host-level
   * infrastructure signals and capture stats that the Host row caches
   * (cpuCores, totalMemoryBytes, processCount). Returning a single
   * struct lets the caller pass everything through to autoDiscoverHost
   * + HostService.updateLastSeen in one DB write per batch.
   *
   * O(metrics) per resource — same magnitude as the existing inner
   * loops; no datapoint walk beyond the small set we care about.
   */
  protected static scanHostInfraStatsFromMetrics(
    scopeMetrics: JSONArray | undefined,
  ): {
    hasInfraSignal: boolean;
    cpuCores?: number;
    totalMemoryBytes?: number;
    processCount?: number;
  } {
    const result: {
      hasInfraSignal: boolean;
      cpuCores?: number;
      totalMemoryBytes?: number;
      processCount?: number;
    } = {
      hasInfraSignal: false,
    };

    if (!scopeMetrics || !Array.isArray(scopeMetrics)) {
      return result;
    }

    for (const scopeMetric of scopeMetrics) {
      const metrics: JSONArray | undefined = (scopeMetric as JSONObject)?.[
        "metrics"
      ] as JSONArray | undefined;
      if (!metrics || !Array.isArray(metrics)) {
        continue;
      }

      for (const metric of metrics) {
        const m: JSONObject = metric as JSONObject;
        const name: string = ((m["name"] as string) || "").toLowerCase();

        if (name.startsWith("system.") || name.startsWith("process.")) {
          result.hasInfraSignal = true;
        }

        if (name === "system.cpu.logical.count") {
          const v: number | null = this.firstDatapointNumber(m);
          if (v !== null) {
            result.cpuCores = Math.round(v);
          }
          continue;
        }

        if (name === "system.memory.usage") {
          const v: number | null = this.sumDatapointNumbers(m);
          if (v !== null) {
            result.totalMemoryBytes = Math.round(v);
          }
          continue;
        }

        if (name === "system.processes.count") {
          /*
           * `system.processes.count` is partitioned by
           * `process.status` (running, sleeping, idle, …), so each
           * datapoint is one status's count. Summing across statuses
           * gives the canonical total — what `top` / `ps -e` show.
           * `firstDatapointNumber` would only return one status.
           */
          const v: number | null = this.sumDatapointNumbers(m);
          if (v !== null) {
            result.processCount = Math.round(v);
          }
          continue;
        }
      }
    }

    return result;
  }

  private static datapointValue(dp: JSONObject): number | null {
    const asInt: JSONValue = dp["asInt"];
    if (typeof asInt === "string" || typeof asInt === "number") {
      const n: number = Number(asInt);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    const asDouble: JSONValue = dp["asDouble"];
    if (typeof asDouble === "string" || typeof asDouble === "number") {
      const n: number = Number(asDouble);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return null;
  }

  private static metricDataPoints(metric: JSONObject): JSONArray | null {
    const wrapper: JSONObject | undefined =
      (metric["sum"] as JSONObject | undefined) ||
      (metric["gauge"] as JSONObject | undefined);
    const points: JSONArray | undefined = wrapper?.["dataPoints"] as
      | JSONArray
      | undefined;
    if (!points || !Array.isArray(points)) {
      return null;
    }
    return points;
  }

  private static firstDatapointNumber(metric: JSONObject): number | null {
    const points: JSONArray | null = this.metricDataPoints(metric);
    if (!points) {
      return null;
    }
    for (const dp of points) {
      const v: number | null = this.datapointValue(dp as JSONObject);
      if (v !== null) {
        return v;
      }
    }
    return null;
  }

  private static sumDatapointNumbers(metric: JSONObject): number | null {
    const points: JSONArray | null = this.metricDataPoints(metric);
    if (!points) {
      return null;
    }
    let sum: number = 0;
    let any: boolean = false;
    for (const dp of points) {
      const v: number | null = this.datapointValue(dp as JSONObject);
      if (v !== null) {
        sum += v;
        any = true;
      }
    }
    return any ? sum : null;
  }

  protected static getServiceNameFromHeaders(
    req: ExpressRequest,
    defaultName: string = "Unknown Service",
  ): string {
    const headerValue: string | string[] | undefined =
      req.headers["x-oneuptime-service-name"];

    if (typeof headerValue === "string" && headerValue.trim()) {
      return headerValue.trim();
    }

    if (Array.isArray(headerValue) && headerValue.length > 0) {
      const value: string = headerValue.find((item: string) => {
        return item && item.trim();
      }) as string;

      if (value && value.trim()) {
        return value.trim();
      }
    }

    return defaultName;
  }
}
