import GlobalCache from "../../Infrastructure/GlobalCache";
import InProcessMemo from "../InProcessMemo";
import logger from "../Logger";
import { canonicalizeEntityValue } from "../../../Utils/Telemetry/EntityKey";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE IDS OF THE RESOURCES INGEST DISCOVERS, AND WHEN ONE STOPS BEING TRUE.
 *
 * Ingest names a resource by what its telemetry reports - a host by its
 * host.name, a Kubernetes cluster by its cluster name, a Ceph cluster by its
 * name - and writes its heartbeats, inventory and labels against the row's
 * id. Finding that row is a Postgres read per resource block, so every
 * autoDiscover* path of the telemetry ingest keeps "(project, what the
 * telemetry reports) -> row id" in two layers:
 *
 *   L1  this process, for a minute (L1_TTL_IN_MS) - no network at all;
 *   L2  Redis (GlobalCache), shared by every process, for a day (the
 *       kind's expiresInSeconds).
 *
 * Nothing used to take an id out of them when its row went away. A person
 * deleted a Docker host while its agent kept sending (issue #5214): for up to
 * a day every batch was written against the deleted id - the heartbeat
 * updated nothing, the containers were refused by DockerResource's foreign
 * key - and nothing created the host again, so a host deleted and its agent
 * installed again never came back, and one the Docker AI agent registered
 * anew never received a heartbeat.
 *
 * WHAT THIS MODULE DOES ABOUT IT
 *
 *   - One key per resource, the way Postgres compares it. A key is the
 *     project and the reported value folded the way QueryHelper.
 *     findWithSameText folds it (canonicalizeEntityValue: trimmed, lower
 *     case), so "PRIMARY01" and "primary01" - one row - are one key, and the
 *     key of a row can be worked out from the row itself.
 *   - A delete forgets the ids it removes (afterDelete), in every layer this
 *     process can reach: Redis, this process's L1, and the memos services
 *     keep of their own (registerLocalLayer: HostService's host memo, the
 *     service-resolution cache). DatabaseService calls it for every delete
 *     of every table - a person's, a bulk one, a workflow's, a hard delete -
 *     so no path is missed; a table that is no kind here costs one Map
 *     lookup.
 *   - A change of what a resource is matched on (a host's identifier, a
 *     cluster's name, edited on its Settings page) forgets the old key and
 *     the new one (afterUpdate): the telemetry that reports the old value no
 *     longer belongs to this row, and the new value may still name an id it
 *     resolved to before.
 *
 * WHAT IT CANNOT REACH, AND WHAT COVERS IT
 *
 * Another process's L1. A worker that read the id before the delete keeps it
 * for at most L1_TTL_IN_MS - one minute - after it last read it from Redis.
 * Then it reads Redis, which no longer has it, and resolves the resource in
 * Postgres again. The ingest path also resolves again the moment Postgres
 * says the row is gone - a heartbeat that finds nothing to write
 * (ResourceHeartbeat), a write its foreign key refuses - and forgets the id
 * in both layers (OtelIngestBaseService), which also covers an id cached
 * before this module existed, one a worker put back between the delete and
 * its own write, and a delete Redis did not hear about.
 *
 * Every method here is best-effort: a delete or an update never fails
 * because a cache could not be told about it.
 */

// How long this process keeps an id it read from Redis or resolved itself.
export const DISCOVERED_RESOURCE_ID_L1_TTL_IN_MS: number = 60 * 1000;

const ONE_DAY_IN_SECONDS: number = 24 * 60 * 60;

export interface DiscoveredResourceKind {
  // The table the resource's rows live in.
  tableName: string;
  /*
   * The GlobalCache namespace its ids are kept under in Redis, and the
   * prefix of its keys in the L1.
   */
  namespace: string;
  /*
   * The column ingest matches the resource on, whose value (folded, with the
   * project) is the key. Null when the keys are not one column's value: a
   * database is found by any of its endpoints, so a deleted one is forgotten
   * once ingest finds its id gone, and within its cache's hour otherwise.
   */
  identityColumn: string | null;
  // How long Redis keeps an id of this kind.
  expiresInSeconds: number;
  /*
   * Whether the cached value is the row's id itself. The service-resolution
   * cache keeps a small JSON object instead (the id and the service's
   * retention), so it is forgotten whatever it holds.
   */
  storesId: boolean;
}

export type DiscoveredResourceKindName =
  | "KubernetesCluster"
  | "ProxmoxCluster"
  | "VMwareVCenter"
  | "IoTFleet"
  | "DockerSwarmCluster"
  | "CephCluster"
  | "StorageArray"
  | "ServerlessFunction"
  | "CloudResource"
  | "CloudMonitoredResource"
  | "DatabaseServer"
  | "RumApplication"
  | "DockerHost"
  | "PodmanHost"
  | "Host"
  | "Service";

/*
 * Every kind of resource ingest discovers and resolves through these caches.
 * The namespaces are the ones the caches have always used, so an upgrade
 * keeps every id already cached.
 */
export const DiscoveredResourceKinds: Readonly<
  Record<DiscoveredResourceKindName, DiscoveredResourceKind>
> = {
  KubernetesCluster: {
    tableName: "KubernetesCluster",
    namespace: "k8s-cluster-id",
    identityColumn: "clusterIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  ProxmoxCluster: {
    tableName: "ProxmoxCluster",
    namespace: "proxmox-cluster-id",
    identityColumn: "name",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  VMwareVCenter: {
    tableName: "VMwareVCenter",
    namespace: "vmware-vcenter-id",
    identityColumn: "name",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  IoTFleet: {
    tableName: "IoTFleet",
    namespace: "iot-fleet-id",
    identityColumn: "name",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  DockerSwarmCluster: {
    tableName: "DockerSwarmCluster",
    namespace: "docker-swarm-cluster-id",
    identityColumn: "name",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  CephCluster: {
    tableName: "CephCluster",
    namespace: "ceph-cluster-id",
    identityColumn: "name",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  StorageArray: {
    tableName: "StorageArray",
    namespace: "storage-array-id",
    identityColumn: "name",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  ServerlessFunction: {
    tableName: "ServerlessFunction",
    namespace: "serverless-function-id",
    identityColumn: "functionIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  // A cloud environment (platform|account|region), from OTel resources.
  CloudResource: {
    tableName: "CloudResource",
    namespace: "cloud-resource-id",
    identityColumn: "resourceIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  // A resource a cloud monitoring receiver names on its datapoints.
  CloudMonitoredResource: {
    tableName: "CloudResource",
    namespace: "cloud-monitored-resource-id",
    identityColumn: "resourceIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  /*
   * One hour, not a day: a database is found through its endpoints, and an
   * endpoint can move to another database (see OtelIngestBaseService).
   */
  DatabaseServer: {
    tableName: "DatabaseServer",
    namespace: "database-server-id",
    identityColumn: null,
    expiresInSeconds: 60 * 60,
    storesId: true,
  },
  RumApplication: {
    tableName: "RumApplication",
    namespace: "rum-application-id",
    identityColumn: "appIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  DockerHost: {
    tableName: "DockerHost",
    namespace: "docker-host-id",
    identityColumn: "hostIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  PodmanHost: {
    tableName: "PodmanHost",
    namespace: "podman-host-id",
    identityColumn: "hostIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  Host: {
    tableName: "Host",
    namespace: "host-id",
    identityColumn: "hostIdentifier",
    expiresInSeconds: ONE_DAY_IN_SECONDS,
    storesId: true,
  },
  /*
   * A service named by service.name: OpenTelemetryIngestService keeps it in
   * a cache of its own (five minutes, its own L1), which this module only
   * ever forgets entries of.
   */
  Service: {
    tableName: "Service",
    namespace: "service-resolution",
    identityColumn: "name",
    expiresInSeconds: 5 * 60,
    storesId: false,
  },
};

/*
 * A row a delete or an update reached, as the layers that keep its id are
 * told about it: its id, its project and the value its identity column held.
 */
export interface DiscoveredResourceRow {
  id: string;
  projectId: string;
  identity: string;
}

/*
 * Forgets what a memo a service keeps of its own holds for one resource -
 * HostService's memo of the host a host name resolves to,
 * OpenTelemetryIngestService's service-resolution L1. Called in this process
 * for the identity of every row of the table that is deleted, and for the
 * old and the new identity of one whose identity changes; must not throw.
 */
export type DiscoveredResourceLocalLayer = (entry: {
  projectId: string;
  identity: string;
}) => void;

type Row = Record<string, unknown>;

const readText: (value: unknown) => string = (value: unknown): string => {
  if (value === undefined || value === null) {
    return "";
  }

  return String(value);
};

const getErrorMessage: (error: unknown) => string = (
  error: unknown,
): string => {
  return error instanceof Error ? error.message : String(error);
};

export default class DiscoveredResourceIdCache {
  /*
   * L1 for every kind but Service, keyed `<namespace>:<key>`, so entries of
   * two kinds never collide. Bounded: the keys come from attributes a
   * collector sends.
   */
  private static readonly l1: InProcessMemo<string> = new InProcessMemo<string>(
    {
      ttlInMs: DISCOVERED_RESOURCE_ID_L1_TTL_IN_MS,
      maxEntries: 10_000,
    },
  );

  // The memos services keep of their own, by table.
  private static readonly localLayers: Map<
    string,
    Array<DiscoveredResourceLocalLayer>
  > = new Map<string, Array<DiscoveredResourceLocalLayer>>();

  /*
   * The kinds a table's rows are cached as - CloudResource is two: an
   * environment, and a resource cloud monitoring names.
   */
  public static getKindsOfTable(
    tableName: string | null | undefined,
  ): Array<DiscoveredResourceKind> {
    if (!tableName) {
      return [];
    }

    return Object.values(DiscoveredResourceKinds).filter(
      (kind: DiscoveredResourceKind): boolean => {
        return kind.tableName === tableName;
      },
    );
  }

  /*
   * The key of a resource: its project and the value its telemetry reports,
   * folded as Postgres compares them (findWithSameText).
   */
  public static keyFor(
    projectId: ObjectID | string,
    identity: string | null | undefined,
  ): string {
    return `${projectId.toString()}:${canonicalizeEntityValue(identity || "")}`;
  }

  /*
   * The id a key resolves to, from this process's L1, else Redis (which then
   * fills the L1). Null when neither has it. A Redis error is thrown, as
   * GlobalCache.getString throws it - except when the L1 has the id, which
   * never touches the network.
   */
  public static async get(
    namespace: string,
    key: string,
  ): Promise<string | null> {
    const l1Key: string = `${namespace}:${key}`;

    const memoed: string | undefined = this.l1.get(l1Key);

    if (memoed !== undefined) {
      return memoed;
    }

    const cached: string | null = await GlobalCache.getString(namespace, key);

    if (cached) {
      this.l1.set(l1Key, cached);
    }

    return cached;
  }

  /*
   * Keeps an id just resolved in both layers. The L1 first, so a Redis
   * outage (setString throws to the caller, as before) still leaves this
   * process able to use the id.
   */
  public static async set(
    namespace: string,
    key: string,
    id: string,
    expiresInSeconds: number,
  ): Promise<void> {
    this.l1.set(`${namespace}:${key}`, id);
    await GlobalCache.setString(namespace, key, id, {
      expiresInSeconds: expiresInSeconds,
    });
  }

  /*
   * Takes a key out of both layers - only while it still names `id`, when
   * given, so a key another worker has already pointed at the row that
   * answers now is left alone. Never throws: a key Redis could not forget
   * runs out on its own, and ingest forgets it again when it finds the row
   * gone.
   */
  public static async forget(data: {
    namespace: string;
    key: string;
    id?: string | undefined;
    storesId?: boolean | undefined;
  }): Promise<void> {
    const l1Key: string = `${data.namespace}:${data.key}`;
    const memoed: string | undefined = this.l1.get(l1Key);

    if (
      memoed !== undefined &&
      (!data.id || data.storesId === false || memoed === data.id)
    ) {
      this.l1.delete(l1Key);
    }

    try {
      if (data.id && data.storesId !== false) {
        await GlobalCache.deleteKeyIfValue(data.namespace, data.key, data.id);
      } else {
        await GlobalCache.deleteKey(data.namespace, data.key);
      }
    } catch (error) {
      logger.warn(
        `Could not forget the cached id of ${data.namespace} "${data.key}": ${getErrorMessage(
          error,
        )}. It runs out on its own, or is forgotten when ingest finds the row gone.`,
      );
    }
  }

  /*
   * Called by a service, once, for a memo of its own that holds rows of this
   * table: it is told about every row of the table this process deletes, or
   * whose identity changes.
   */
  public static registerLocalLayer(
    tableName: string,
    forget: DiscoveredResourceLocalLayer,
  ): void {
    const layers: Array<DiscoveredResourceLocalLayer> =
      this.localLayers.get(tableName) || [];

    if (!layers.includes(forget)) {
      layers.push(forget);
    }

    this.localLayers.set(tableName, layers);
  }

  /*
   * The columns a delete of this table reads before it deletes, so
   * afterDelete can work out each row's keys: the identity columns. The
   * project is the tenant column, which every delete reads anyway.
   */
  public static getColumnsToRead(
    tableName: string | null | undefined,
  ): Array<string> {
    const columns: Set<string> = new Set<string>();

    for (const kind of this.getKindsOfTable(tableName)) {
      if (kind.identityColumn) {
        columns.add(kind.identityColumn);
      }
    }

    return Array.from(columns);
  }

  /*
   * After rows are deleted: every id they had is forgotten - in Redis while
   * it still names the row, and in this process. Best-effort: never fails
   * the delete.
   */
  public static async afterDelete(data: {
    tableName: string | null | undefined;
    rows: Array<unknown>;
  }): Promise<void> {
    const kinds: Array<DiscoveredResourceKind> = this.getKindsOfTable(
      data.tableName,
    );

    if (kinds.length === 0 || data.rows.length === 0) {
      return;
    }

    for (const row of data.rows) {
      for (const kind of kinds) {
        const resource: DiscoveredResourceRow | null = this.readRow(
          kind,
          row as Row,
        );

        if (!resource) {
          continue;
        }

        await this.forgetRow(kind, resource, { onlyWhileItNamesRow: true });
      }
    }

    const identities: Array<{ projectId: string; identity: string }> = [];

    for (const row of data.rows) {
      // A table's kinds share one identity column (CloudResource's two do).
      const resource: DiscoveredResourceRow | null = this.readRow(
        kinds[0]!,
        row as Row,
      );

      if (resource) {
        identities.push({
          projectId: resource.projectId,
          identity: resource.identity,
        });
      }
    }

    this.tellLocalLayers(data.tableName!, identities);
  }

  /*
   * After rows are updated: a row whose identity the write changed (to a
   * value that folds differently) forgets the key of its old identity, and
   * the key of its new one. Best-effort: never fails the update.
   */
  public static async afterUpdate(data: {
    tableName: string | null | undefined;
    rowsBefore: Array<unknown>;
    written: unknown;
  }): Promise<void> {
    const kinds: Array<DiscoveredResourceKind> = this.getKindsOfTable(
      data.tableName,
    );

    if (kinds.length === 0 || data.rowsBefore.length === 0) {
      return;
    }

    const written: Row = (data.written || {}) as Row;
    const changedIdentities: Array<{ projectId: string; identity: string }> =
      [];

    for (const kind of kinds) {
      if (!kind.identityColumn) {
        continue;
      }

      const newValue: unknown = written[kind.identityColumn];

      if (typeof newValue !== "string") {
        continue;
      }

      for (const row of data.rowsBefore) {
        const before: DiscoveredResourceRow | null = this.readRow(
          kind,
          row as Row,
        );

        if (
          !before ||
          canonicalizeEntityValue(before.identity) ===
            canonicalizeEntityValue(newValue)
        ) {
          continue;
        }

        await this.forgetRow(kind, before, { onlyWhileItNamesRow: true });

        // Whatever the new value resolved to before, this row answers now.
        await this.forgetRow(
          kind,
          { ...before, identity: newValue },
          { onlyWhileItNamesRow: false },
        );

        changedIdentities.push(
          { projectId: before.projectId, identity: before.identity },
          { projectId: before.projectId, identity: newValue },
        );
      }
    }

    this.tellLocalLayers(data.tableName!, changedIdentities);
  }

  // Drops this process's L1. For tests.
  public static clearInProcessMemo(): void {
    this.l1.clear();
  }

  private static async forgetRow(
    kind: DiscoveredResourceKind,
    row: DiscoveredResourceRow,
    options: { onlyWhileItNamesRow: boolean },
  ): Promise<void> {
    await this.forget({
      namespace: kind.namespace,
      key: this.keyFor(row.projectId, row.identity),
      id: options.onlyWhileItNamesRow ? row.id : undefined,
      storesId: kind.storesId,
    });
  }

  // A row's id, project and identity, or null when it lacks one of them.
  private static readRow(
    kind: DiscoveredResourceKind,
    row: Row | null | undefined,
  ): DiscoveredResourceRow | null {
    if (!row || !kind.identityColumn) {
      return null;
    }

    const id: string = readText(row["_id"] ?? row["id"]);
    const projectId: string = readText(row["projectId"]);
    const identity: string = readText(row[kind.identityColumn]);

    if (!id || !projectId || !identity.trim()) {
      return null;
    }

    return { id, projectId, identity };
  }

  private static tellLocalLayers(
    tableName: string,
    identities: Array<{ projectId: string; identity: string }>,
  ): void {
    const layers: Array<DiscoveredResourceLocalLayer> | undefined =
      this.localLayers.get(tableName);

    if (!layers || layers.length === 0) {
      return;
    }

    for (const entry of identities) {
      for (const layer of layers) {
        try {
          layer(entry);
        } catch (error) {
          logger.warn(
            `Could not forget ${tableName} "${entry.identity}" in a memo of this process: ${getErrorMessage(
              error,
            )}`,
          );
        }
      }
    }
  }
}
