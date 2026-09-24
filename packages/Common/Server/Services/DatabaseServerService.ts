import DatabaseService from "./DatabaseService";
import DatabaseServerEndpointService, {
  DatabaseServerEndpointClaimResult,
  DatabaseServerEndpointOwner,
  getOwnedByOtherDatabaseMessage,
} from "./DatabaseServerEndpointService";
import DatabaseServerFeedService from "./DatabaseServerFeedService";
import DatabaseServerLabelRuleEngineService from "./DatabaseServerLabelRuleEngineService";
import DatabaseServerOwnerRuleEngineService from "./DatabaseServerOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../Models/DatabaseModels/DatabaseServerEndpoint";
import { DatabaseServerFeedEventType } from "../../Models/DatabaseModels/DatabaseServerFeed";
import Label from "../../Models/DatabaseModels/Label";
import DatabaseConfig from "../DatabaseConfig";
import GlobalCache from "../Infrastructure/GlobalCache";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import {
  truncateLongText,
  truncateShortText,
} from "../Utils/Database/TruncateColumnValue";
import InProcessMemo from "../Utils/InProcessMemo";
import logger, { LogAttributes } from "../Utils/Logger";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import URL from "../../Types/API/URL";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import DatabaseServerDiscoverySource, {
  getDatabaseServerDiscoverySourceLabel,
} from "../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseEndpoint,
  DatabaseEndpointScope,
  buildDatabaseServerDisplayName,
  buildDatabaseServerIdentifier,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
  parseDatabaseEndpointString,
} from "../../Types/DatabaseServer/DatabaseEndpoint";
import {
  getDatabaseSystemDisplayName,
  normalizeDatabaseSystem,
} from "../../Types/DatabaseServer/DatabaseSystem";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { mergeDatabaseServerMemberKeys } from "../../Utils/Telemetry/DatabaseServerEntityKeys";
import crypto from "crypto";

/*
 * Two heartbeats, two namespaces: a collector reporting engine metrics is a
 * different fact from an application merely querying the database, and one
 * must never be able to suppress the other inside a window.
 */
const LAST_SEEN_CACHE_NAMESPACE: string = "database-server-last-seen";
const SIGHTING_CACHE_NAMESPACE: string = "database-server-sighting";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "database-server-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * How often, fleet-wide, a collector heartbeat may look at whether its row was
 * auto-archived. A row is only ever auto-archived after days without being
 * seen, so a heartbeat restoring it up to ten minutes late costs nothing, and
 * the check stays one primary-key read per database per window.
 */
const AUTO_RESTORE_CHECK_CACHE_NAMESPACE: string =
  "database-server-auto-restore-check";
const AUTO_RESTORE_CHECK_WINDOW_SECONDS: number = 600;

const DEFAULT_COLLECTOR_STALE_MINUTES: number = 15;
const MIN_COLLECTOR_STALE_MINUTES: number = 10;

const DEFAULT_AUTO_ARCHIVE_DAYS: number = 7;
const MIN_AUTO_ARCHIVE_DAYS: number = 1;
// Rows archived per sweep; the rest wait for the next five-minute run.
const AUTO_ARCHIVE_BATCH_SIZE: number = 500;

const DEFAULT_AUTO_CREATE_BUDGET: number = 500;

// Endpoint aliases one workload may claim per discovery run.
const MAX_WORKLOAD_ALIASES: number = 100;

const MAX_PORT: number = 65535;

/*
 * The columns every discovery caller gets back. Enough to key telemetry
 * (id, project, engine, endpoint), name it (name) and decide on archive
 * handling - but not the member-key map, which only the workload path reads.
 */
const DISCOVERY_SELECT: Select<Model> = {
  _id: true,
  projectId: true,
  name: true,
  dbSystem: true,
  databaseIdentifier: true,
  workloadIdentifier: true,
  discoverySource: true,
  serverAddress: true,
  serverPort: true,
  kubernetesClusterId: true,
  kubernetesNamespace: true,
  isArchived: true,
  autoArchivedAt: true,
};

const WORKLOAD_SELECT: Select<Model> = {
  ...DISCOVERY_SELECT,
  memberEntityKeys: true,
};

// The rows discovery never creates or archives on its own.
const NON_AUTO_CREATED_SOURCES: Array<DatabaseServerDiscoverySource> = [
  DatabaseServerDiscoverySource.Manual,
  DatabaseServerDiscoverySource.Collector,
];

export interface FindOrCreateDatabaseServerByEndpointData {
  projectId: ObjectID;
  dbSystem: string;
  endpoint: DatabaseEndpoint;
  discoverySource: DatabaseServerDiscoverySource;
  displayName?: string | undefined;
  allowCreate: boolean;
}

export interface UpsertWorkloadDatabaseData {
  projectId: ObjectID;
  // buildWorkloadDatabaseServerIdentifier.
  workloadIdentifier: string;
  dbSystem: string;
  displayName: string;
  discoverySource: DatabaseServerDiscoverySource;
  // Formatted endpoints (buildKubernetesDatabaseAliases); [] for containers.
  aliases: Array<string>;
  // keyForKubernetesPod / keyForKubernetesDeployment / keyForContainer.
  memberKeysSeenNow: Array<string>;
  instanceCount: number;
  dbVersion?: string | undefined;
  kubernetesClusterId?: ObjectID | undefined;
  kubernetesNamespace?: string | undefined;
  workloadKind: string;
  workloadName: string;
  dockerHostId?: ObjectID | undefined;
  podmanHostId?: ObjectID | undefined;
  allowCreate: boolean;
}

interface WorkloadAlias {
  endpoint: string;
  scope: DatabaseEndpointScope;
  parsed: DatabaseEndpoint;
}

/*
 * The Databases product's root service. A DatabaseServer row is found and
 * created by ENDPOINT (DatabaseServerEndpoint, one owner per endpoint per
 * project) or by WORKLOAD (workloadIdentifier), never by name - two engines
 * can share a host name and a person can rename any row.
 *
 * Invariants every discovery path relies on:
 *   - an endpoint belongs to at most one row; a claim never takes one away
 *     from another row, and an ambiguous match is never tie-broken;
 *   - a LOCAL-scope endpoint (single-label name, unqualified cluster-local
 *     DNS or private IP) never creates a row and never adopts one;
 *   - discovery only ever un-archives a row it archived itself
 *     (autoArchivedAt), never one a person archived.
 */
export class Service extends DatabaseService<Model> {
  /*
   * In-process front for the fleet-wide auto-restore gate: a collector
   * heartbeat arrives per batch, and asking Redis per batch whether it is time
   * to look again would cost more than the heartbeat's own gates.
   */
  private autoRestoreCheckMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: 60 * 1000,
      maxEntries: 10_000,
    });

  public constructor() {
    super(Model);
  }

  /*
   * A person adding a database from the dashboard or the API. Root creates -
   * every discovery path - pass through untouched: they compute identity and
   * claim endpoints themselves.
   *
   * Everything set here is a user-creatable column on the model (name,
   * description, dbSystem, serverAddress, serverPort, databaseIdentifier,
   * discoverySource), because the column permission check runs after this
   * hook. Setting a root-only column here would refuse every manual create.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.props.isRoot) {
      return { createBy: createBy, carryForward: null };
    }

    const data: Model = createBy.data;

    // The tenant column is stamped from props.tenantId only after this hook.
    const projectId: ObjectID | undefined =
      createBy.props.tenantId || data.projectId || undefined;

    if (!projectId) {
      throw new BadDataException("Project ID is required to add a database.");
    }

    const dbSystem: string | null = normalizeDatabaseSystem(data.dbSystem);

    if (!dbSystem) {
      throw new BadDataException(
        "Database engine is required. Choose the engine this database runs, for example PostgreSQL or MySQL.",
      );
    }

    const endpoint: DatabaseEndpoint = parseManualEndpoint({
      serverAddress: data.serverAddress,
      serverPort: data.serverPort,
      dbSystem: dbSystem,
    });

    const formatted: string = formatDatabaseEndpoint(endpoint);

    const owner: DatabaseServerEndpointOwner | null =
      await DatabaseServerEndpointService.findOwnerByEndpoint(
        projectId,
        formatted,
      );

    if (owner) {
      throw new BadDataException(
        await getOwnedByOtherDatabaseMessage(formatted, owner),
      );
    }

    const databaseIdentifier: string = buildDatabaseServerIdentifier(
      dbSystem,
      endpoint,
    );

    /*
     * Normally unreachable - the row with this identifier would own the
     * endpoint - but the unique index would otherwise answer with a raw
     * constraint error.
     */
    const sameIdentity: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        databaseIdentifier: databaseIdentifier,
      },
      select: {
        _id: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (sameIdentity) {
      throw new BadDataException(
        `A ${getDatabaseSystemDisplayName(dbSystem)} database at ${formatted} already exists${
          sameIdentity.name ? `: "${sameIdentity.name}"` : ""
        }.`,
      );
    }

    const name: string = typeof data.name === "string" ? data.name.trim() : "";

    data.dbSystem = dbSystem;
    data.serverAddress = endpoint.host;
    if (endpoint.port !== null) {
      data.serverPort = endpoint.port;
    }
    data.databaseIdentifier = databaseIdentifier;
    // First creator wins, and a person creating it is "manual" - whatever was sent.
    data.discoverySource = DatabaseServerDiscoverySource.Manual;
    data.name =
      name ||
      buildDatabaseServerDisplayName({ system: dbSystem, endpoint: endpoint });

    return {
      createBy: createBy,
      carryForward: {
        primaryEndpoint: formatted,
      },
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const primaryEndpoint: string | undefined =
      onCreate.carryForward?.primaryEndpoint;

    if (primaryEndpoint && createdItem.projectId && createdItem.id) {
      await this.claimManualPrimaryEndpoint({
        projectId: createdItem.projectId,
        databaseServerId: createdItem.id,
        endpoint: primaryEndpoint,
      });
    }

    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId ||
      onCreate.createBy.props.userId ||
      undefined;

    this.runCreatedSideEffects(createdItem, createdByUserId);

    return createdItem;
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * A person archiving or restoring a row takes it out of discovery's
     * hands: from now on only a person restores it. Discovery's own archive
     * and restore are raw writes, so they never reach this hook.
     */
    if (
      ResourceFeedUtil.isArchiveChange(updateData) &&
      !("autoArchivedAt" in updateData)
    ) {
      await this.clearAutoArchivedAt(updatedItemIds);
    }

    this.writeDatabaseServerUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  /**
   * The database that owns this endpoint - or, when none does and creating
   * is allowed, a new one that does. Returns null when nothing owns the
   * endpoint and no row may be created for it (creation not allowed, or a
   * LOCAL-scope endpoint, which only ever joins an existing row).
   *
   * Races. Two writers can see the endpoint unowned at once. The row insert
   * is guarded by the (projectId, databaseIdentifier) unique index - the
   * loser re-reads the winner's row - and the endpoint claim by the
   * (projectId, endpoint) one. If our new row loses the endpoint claim to a
   * DIFFERENT row (a wire-compatible engine reported for the same endpoint,
   * say), our row is an orphan with no endpoint: it is deleted before anyone
   * saw it (it was inserted without hooks, so no feed, rule run or
   * notification ever referred to it) and the owner's row is returned.
   */
  @CaptureSpan()
  public async findOrCreateByEndpoint(
    data: FindOrCreateDatabaseServerByEndpointData,
  ): Promise<Model | null> {
    if (!data || !data.endpoint || !data.endpoint.host) {
      return null;
    }

    const formatted: string = formatDatabaseEndpoint(data.endpoint);

    const owner: DatabaseServerEndpointOwner | null =
      await DatabaseServerEndpointService.findOwnerByEndpoint(
        data.projectId,
        formatted,
      );

    if (owner) {
      const ownerRow: Model | null = await this.findByIdInProject(
        data.projectId,
        owner.databaseServerId,
      );

      if (ownerRow) {
        await this.restoreIfAutoArchived(ownerRow);
      }

      return ownerRow;
    }

    if (!data.allowCreate) {
      return null;
    }

    if (getDatabaseEndpointScope(data.endpoint) === "local") {
      return null;
    }

    const dbSystem: string | null = normalizeDatabaseSystem(data.dbSystem);

    if (!dbSystem) {
      return null;
    }

    return await this.createEndpointDatabaseServer({
      projectId: data.projectId,
      dbSystem: dbSystem,
      endpoint: data.endpoint,
      formattedEndpoint: formatted,
      discoverySource: data.discoverySource,
      displayName: data.displayName,
    });
  }

  /**
   * One row by id, only inside this project (an id from a resource attribute
   * is untrusted input), with the columns discovery callers need.
   */
  @CaptureSpan()
  public async findByIdInProject(
    projectId: ObjectID,
    databaseServerId: ObjectID,
  ): Promise<Model | null> {
    if (!projectId || !databaseServerId) {
      return null;
    }

    return await this.findOneBy({
      query: {
        _id: databaseServerId.toString(),
        projectId: projectId,
      },
      select: DISCOVERY_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  /**
   * The row of one Kubernetes / Docker / Podman database workload, found by
   * workloadIdentifier, else ADOPTED from the endpoint row its aliases point
   * at, else created (when allowed). Then: its aliases are claimed (an alias
   * another row owns is skipped, never taken), its member keys merged, its
   * workload columns refreshed and lastSeenAt stamped - never
   * otelCollectorStatus, which only a collector sets.
   *
   * Adoption joins what application traces already found (an endpoint row
   * named after the Service DNS) to the workload serving it, so the database
   * does not show up twice. It happens only when the workload's GLOBAL-scope
   * aliases are owned by exactly ONE row and that row is not already some
   * other workload's. Two owners is ambiguous and is never tie-broken.
   *
   * Root, hook-free writes after the lookup; never throws (a worker run over
   * many workloads must survive one bad one) - failures log and return null.
   */
  @CaptureSpan()
  public async upsertWorkloadDatabase(
    data: UpsertWorkloadDatabaseData,
  ): Promise<Model | null> {
    try {
      return await this.upsertWorkloadDatabaseOrThrow(data);
    } catch (error) {
      logger.error(
        `DatabaseServerService.upsertWorkloadDatabase failed for workload ${
          data?.workloadIdentifier || "(none)"
        }: ${error instanceof Error ? error.message : String(error)}`,
        {
          projectId: data?.projectId?.toString(),
        } as LogAttributes,
      );

      return null;
    }
  }

  /**
   * Collector liveness: an OTel Collector database receiver (or the Database
   * Agent) reported engine telemetry for this database. Refreshes lastSeenAt,
   * collectorLastSeenAt and otelCollectorStatus "connected" once per window,
   * and the agent / engine versions when they change. A row this collector
   * brings back after it was auto-archived is restored.
   */
  @CaptureSpan()
  public async recordCollectorHeartbeat(
    databaseServerId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
      dbVersion?: string | undefined;
    },
  ): Promise<void> {
    const agentVersion: string | null = cleanShortText(extra?.agentVersion);
    const dbVersion: string | null = cleanShortText(extra?.dbVersion);

    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: agentVersion,
          dbVersion: dbVersion,
        }),
      )
      .digest("hex");

    const now: Date = OneUptimeDate.getCurrentDate();

    const liveness: PartialEntity<Model> = {
      lastSeenAt: now,
      collectorLastSeenAt: now,
      otelCollectorStatus: "connected",
    };

    const metadata: PartialEntity<Model> = {};

    if (agentVersion) {
      metadata.agentVersion = agentVersion;
    }

    if (dbVersion) {
      metadata.dbVersion = dbVersion;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: databaseServerId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `database ${databaseServerId.toString()}`,
    });

    await this.restoreAfterHeartbeatIfAutoArchived(databaseServerId);
  }

  /**
   * Any-source liveness: an application called this database (a CLIENT
   * span) or discovery saw it. Only lastSeenAt moves - a database that is
   * merely queried says nothing about whether engine metrics are arriving,
   * so otelCollectorStatus is left alone.
   */
  @CaptureSpan()
  public async recordSighting(databaseServerId: ObjectID): Promise<void> {
    const liveness: PartialEntity<Model> = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
    };

    await ResourceHeartbeat.write({
      service: this,
      id: databaseServerId,
      cacheNamespace: SIGHTING_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      fingerprint: "",
      describe: `database ${databaseServerId.toString()} (sighting)`,
    });
  }

  /**
   * Additively attach labels to a database. Existing labels are never
   * removed - manual labels set via the UI survive ingest. The set of
   * labelIds passed in is fingerprinted and cached for 60s so a collector
   * pushing the same labels every batch costs one cache lookup, not a
   * join-table scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    databaseServerId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.databaseServerId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const databaseServerIdStr: string = data.databaseServerId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(databaseServerIdStr)
        .loadMany();

      const existingIds: Set<string> = new Set();
      for (const lbl of existingLabels) {
        const idStr: string | undefined = lbl._id?.toString();
        if (idStr) {
          existingIds.add(idStr);
        }
      }

      const toAddIds: Array<string> = [];
      const seen: Set<string> = new Set();
      for (const id of data.labelIds) {
        const idStr: string = id.toString();
        if (existingIds.has(idStr) || seen.has(idStr)) {
          continue;
        }
        seen.add(idStr);
        toAddIds.push(idStr);
      }

      if (toAddIds.length > 0) {
        await this.getRepository()
          .createQueryBuilder()
          .relation(Model, "labels")
          .of(databaseServerIdStr)
          .add(toAddIds);
      }

      await GlobalCache.setString(
        LABELS_APPLIED_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: LABELS_APPLIED_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `DatabaseServerService.attachLabels failed for database ${data.databaseServerId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * Threshold must stay well above the 5-minute OTel ingest maintenance
   * fence (MAINTENANCE_FENCE_TTL_SECONDS in OtelIngestBaseService) - the
   * collector heartbeat sits behind that fence, so collectorLastSeenAt is
   * legitimately up to ~7 minutes stale (the fence is jittered) during
   * continuous telemetry. 15 minutes by default; an override below 10 is
   * raised to 10 rather than allowed to flap healthy databases. Anything
   * unparseable falls back to the default.
   */
  public getCollectorStaleThresholdMinutes(): number {
    return readIntegerEnv({
      name: "DATABASE_SERVER_COLLECTOR_STALE_MINUTES",
      defaultValue: DEFAULT_COLLECTOR_STALE_MINUTES,
      min: MIN_COLLECTOR_STALE_MINUTES,
    });
  }

  /**
   * Flip databases whose collector went quiet to "disconnected". Keyed on
   * collectorLastSeenAt, NOT lastSeenAt: an application still querying the
   * database keeps lastSeenAt fresh, and that must not hide a dead collector.
   * One conditional statement, so a heartbeat landing mid-sweep cannot be
   * overwritten. Returns how many rows were flipped.
   */
  @CaptureSpan()
  public async markDisconnectedDatabaseServers(): Promise<number> {
    const threshold: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -this.getCollectorStaleThresholdMinutes(),
    );

    const rows: Array<{ count: number | string }> =
      await this.getRepository().manager.query(
        `WITH "disconnected" AS (
          UPDATE "DatabaseServer"
          SET "otelCollectorStatus" = 'disconnected', "updatedAt" = CURRENT_TIMESTAMP
          WHERE "otelCollectorStatus" = 'connected'
            AND ("collectorLastSeenAt" IS NULL OR "collectorLastSeenAt" < $1)
            AND "deletedAt" IS NULL
          RETURNING "_id"
        )
        SELECT COUNT(*)::int AS "count" FROM "disconnected"`,
        [threshold],
      );

    return readCount(rows);
  }

  /*
   * Days a discovered database may go unseen before the sweep archives it.
   * Default 7, at least 1.
   */
  public getAutoArchiveDays(): number {
    return readIntegerEnv({
      name: "DATABASE_SERVER_AUTO_ARCHIVE_DAYS",
      defaultValue: DEFAULT_AUTO_ARCHIVE_DAYS,
      min: MIN_AUTO_ARCHIVE_DAYS,
    });
  }

  /**
   * Archive discovered databases nobody has seen - and nobody has touched -
   * for getAutoArchiveDays(). Discovery creates rows on its own, so without
   * this a decommissioned database, or a one-off connection string in a
   * trace, would sit in the list forever.
   *
   * "Untouched" is what makes this safe to do unasked: a manually added
   * database is never archived, and neither is one somebody invested in -
   * labels, owners, a link from an incident / alert / scheduled maintenance,
   * an endpoint a person added, or a retention override. Every one of those
   * checks is done in SQL, scoped to the row's project and to live rows.
   *
   * The row is marked autoArchivedAt, which is what lets discovery restore
   * it the moment it is seen again - and never restore one a person
   * archived. Bounded per run. Returns how many rows were archived.
   */
  @CaptureSpan()
  public async autoArchiveStaleDatabaseServers(): Promise<number> {
    const days: number = this.getAutoArchiveDays();
    const now: Date = OneUptimeDate.getCurrentDate();
    const cutoff: Date = OneUptimeDate.addRemoveDays(now, -days);

    const archived: Array<{ _id: string; projectId: string }> =
      await this.getRepository().manager.query(
        `WITH "candidates" AS (
          SELECT ds."_id"
          FROM "DatabaseServer" ds
          WHERE ds."deletedAt" IS NULL
            AND ds."isArchived" = false
            AND ds."discoverySource" IS NOT NULL
            AND ds."discoverySource" <> $3
            AND COALESCE(ds."lastSeenAt", ds."createdAt") < $1
            AND ds."retainTelemetryDataForDays" IS NULL
            AND (ds."telemetryRetentionConfig" IS NULL OR ds."telemetryRetentionConfig"::text IN ('null', '{}'))
            AND NOT EXISTS (
              SELECT 1 FROM "DatabaseServerLabel" l
              INNER JOIN "Label" lbl ON lbl."_id" = l."labelId"
              WHERE l."databaseServerId" = ds."_id"
                AND lbl."projectId" = ds."projectId"
                AND lbl."deletedAt" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "DatabaseServerOwnerUser" ou
              WHERE ou."databaseServerId" = ds."_id"
                AND ou."projectId" = ds."projectId"
                AND ou."deletedAt" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "DatabaseServerOwnerTeam" ot
              WHERE ot."databaseServerId" = ds."_id"
                AND ot."projectId" = ds."projectId"
                AND ot."deletedAt" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "IncidentDatabaseServer" ids
              INNER JOIN "Incident" i ON i."_id" = ids."incidentId"
              WHERE ids."databaseServerId" = ds."_id"
                AND i."projectId" = ds."projectId"
                AND i."deletedAt" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "AlertDatabaseServer" ads
              INNER JOIN "Alert" a ON a."_id" = ads."alertId"
              WHERE ads."databaseServerId" = ds."_id"
                AND a."projectId" = ds."projectId"
                AND a."deletedAt" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "ScheduledMaintenanceDatabaseServer" sds
              INNER JOIN "ScheduledMaintenance" sm ON sm."_id" = sds."scheduledMaintenanceId"
              WHERE sds."databaseServerId" = ds."_id"
                AND sm."projectId" = ds."projectId"
                AND sm."deletedAt" IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM "DatabaseServerEndpoint" e
              WHERE e."databaseServerId" = ds."_id"
                AND e."projectId" = ds."projectId"
                AND e."source" = 'user'
                AND e."deletedAt" IS NULL
            )
          ORDER BY COALESCE(ds."lastSeenAt", ds."createdAt") ASC
          LIMIT $4
        ),
        "archived" AS (
          UPDATE "DatabaseServer" stale
          SET "isArchived" = true,
            "archivedAt" = $2,
            "autoArchivedAt" = $2,
            "archivedByUserId" = NULL,
            "updatedAt" = CURRENT_TIMESTAMP
          FROM "candidates"
          WHERE stale."_id" = "candidates"."_id"
            AND stale."isArchived" = false
          RETURNING stale."_id" AS "_id", stale."projectId" AS "projectId"
        )
        SELECT "_id", "projectId" FROM "archived"`,
        [
          cutoff,
          now,
          DatabaseServerDiscoverySource.Manual,
          AUTO_ARCHIVE_BATCH_SIZE,
        ],
      );

    const rows: Array<{ _id: string; projectId: string }> = Array.isArray(
      archived,
    )
      ? archived
      : [];

    for (const row of rows) {
      if (!row || !row._id || !row.projectId) {
        continue;
      }

      await this.writeAutoArchiveFeed({
        databaseServerId: new ObjectID(row._id.toString()),
        projectId: new ObjectID(row.projectId.toString()),
        days: days,
      });
    }

    return rows.length;
  }

  /*
   * How many discovered databases (client spans, Kubernetes, Docker, Podman)
   * a project may accumulate before discovery stops creating more on its
   * own. Collector-created and manual rows do not count and are never
   * blocked: a collector is configured on purpose. Default 500, at least 0
   * (0 turns auto-creation off).
   */
  public getAutoCreateBudget(): number {
    return readIntegerEnv({
      name: "DATABASE_SERVER_AUTO_CREATE_BUDGET",
      defaultValue: DEFAULT_AUTO_CREATE_BUDGET,
      min: 0,
    });
  }

  /**
   * True while the project holds fewer live, non-archived discovered
   * databases than getAutoCreateBudget(). Archived rows do not count, so
   * the auto-archive sweep frees budget.
   */
  @CaptureSpan()
  public async isUnderAutoCreateBudget(projectId: ObjectID): Promise<boolean> {
    const budget: number = this.getAutoCreateBudget();

    if (budget <= 0) {
      return false;
    }

    const rows: Array<{ count: number | string }> =
      await this.getRepository().manager.query(
        `SELECT COUNT(*)::int AS "count"
        FROM "DatabaseServer"
        WHERE "projectId" = $1
          AND "deletedAt" IS NULL
          AND "isArchived" = false
          AND COALESCE("discoverySource", '') NOT IN ($2, $3)`,
        [
          projectId.toString(),
          NON_AUTO_CREATED_SOURCES[0],
          NON_AUTO_CREATED_SOURCES[1],
        ],
      );

    return readCount(rows) < budget;
  }

  /**
   * Display name for this database, or an empty string when the row is gone.
   * Feed writers call this on a best-effort basis, so a missing row must not
   * throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getDatabaseServerName(data: {
    databaseServerId: ObjectID;
  }): Promise<string> {
    const databaseServer: Model | null = await this.findOneById({
      id: data.databaseServerId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return databaseServer?.name || "";
  }

  @CaptureSpan()
  public async getDatabaseServerLinkInDashboard(
    projectId: ObjectID,
    databaseServerId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/databases/${databaseServerId.toString()}`,
    );
  }

  /**
   * "[Database PostgreSQL orders-db:5432](https://…)" - the form every feed
   * item uses to name the resource it is about.
   */
  @CaptureSpan()
  public async getDatabaseServerMarkdownLink(
    projectId: ObjectID,
    databaseServerId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getDatabaseServerName({
      databaseServerId: databaseServerId,
    });
    const link: URL = await this.getDatabaseServerLinkInDashboard(
      projectId,
      databaseServerId,
    );

    return `[Database ${name}](${link.toString()})`;
  }

  /**
   * For tests: forget which rows this process recently checked for an
   * auto-archive restore, the way suites clear ResourceHeartbeat's memo.
   */
  public clearAutoRestoreCheckMemo(): void {
    this.autoRestoreCheckMemo.clear();
  }

  private async upsertWorkloadDatabaseOrThrow(
    data: UpsertWorkloadDatabaseData,
  ): Promise<Model | null> {
    if (!data || !data.projectId) {
      return null;
    }

    const workloadIdentifier: string = truncateLongText(
      typeof data.workloadIdentifier === "string"
        ? data.workloadIdentifier.trim()
        : "",
    );

    if (!workloadIdentifier) {
      return null;
    }

    const dbSystem: string | null = normalizeDatabaseSystem(data.dbSystem);

    if (!dbSystem) {
      return null;
    }

    const projectId: ObjectID = data.projectId;
    const aliases: Array<WorkloadAlias> = canonicalizeWorkloadAliases(
      data.aliases,
      dbSystem,
    );

    // Who owns each alias today: one query, reused by adoption and claiming.
    const ownersByEndpoint: Map<string, string> = await this.findEndpointOwners(
      projectId,
      aliases.map((alias: WorkloadAlias): string => {
        return alias.endpoint;
      }),
    );

    let row: Model | null = await this.findByWorkloadIdentifier(
      projectId,
      workloadIdentifier,
    );
    let createdHere: boolean = false;

    if (!row) {
      row = await this.adoptEndpointDatabaseServer({
        projectId: projectId,
        workloadIdentifier: workloadIdentifier,
        aliases: aliases,
        ownersByEndpoint: ownersByEndpoint,
      });
    }

    if (!row) {
      if (!data.allowCreate) {
        return null;
      }

      const created: { row: Model | null; createdHere: boolean } =
        await this.createWorkloadDatabaseServer({
          data: data,
          workloadIdentifier: workloadIdentifier,
          dbSystem: dbSystem,
          primaryAlias: aliases[0],
        });

      row = created.row;
      createdHere = created.createdHere;
    }

    if (!row || !row.id) {
      return null;
    }

    await this.claimWorkloadAliases({
      projectId: projectId,
      databaseServerId: row.id,
      workloadIdentifier: workloadIdentifier,
      aliases: aliases,
      ownersByEndpoint: ownersByEndpoint,
      primaryEndpoint: createdHere ? aliases[0]?.endpoint : undefined,
    });

    const now: Date = OneUptimeDate.getCurrentDate();
    const memberEntityKeys: JSONObject = mergeDatabaseServerMemberKeys(
      row.memberEntityKeys,
      Array.isArray(data.memberKeysSeenNow) ? data.memberKeysSeenNow : [],
      now,
    );

    const instanceCount: number = toInstanceCount(data.instanceCount);

    /*
     * A plain record: PartialEntity's deep partial of the JSON member-key
     * column is too deep for the compiler to instantiate.
     */
    const update: Record<string, unknown> = {
      memberEntityKeys: memberEntityKeys,
      instanceCount: instanceCount,
      lastSeenAt: now,
    };

    const workloadKind: string | null = cleanShortText(data.workloadKind);
    if (workloadKind) {
      update["workloadKind"] = workloadKind;
    }

    const workloadName: string | null = cleanLongText(data.workloadName);
    if (workloadName) {
      update["workloadName"] = workloadName;
    }

    const kubernetesNamespace: string | null = cleanShortText(
      data.kubernetesNamespace,
    );
    if (kubernetesNamespace) {
      update["kubernetesNamespace"] = kubernetesNamespace;
    }

    if (data.kubernetesClusterId) {
      update["kubernetesClusterId"] = data.kubernetesClusterId;
    }

    if (data.dockerHostId) {
      update["dockerHostId"] = data.dockerHostId;
    }

    if (data.podmanHostId) {
      update["podmanHostId"] = data.podmanHostId;
    }

    const dbVersion: string | null = cleanShortText(data.dbVersion);
    if (dbVersion) {
      update["dbVersion"] = dbVersion;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: row.id,
      data: update as unknown as PartialEntity<Model>,
    });

    row.memberEntityKeys = memberEntityKeys;
    row.instanceCount = instanceCount;
    row.lastSeenAt = now;
    row.workloadIdentifier = workloadIdentifier;

    await this.restoreIfAutoArchived(row);

    return row;
  }

  private async findByWorkloadIdentifier(
    projectId: ObjectID,
    workloadIdentifier: string,
  ): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: projectId,
        workloadIdentifier: workloadIdentifier,
      },
      select: WORKLOAD_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  // endpoint -> owning databaseServerId, for the endpoints that have one.
  private async findEndpointOwners(
    projectId: ObjectID,
    endpoints: Array<string>,
  ): Promise<Map<string, string>> {
    const owners: Map<string, string> = new Map<string, string>();

    if (endpoints.length === 0) {
      return owners;
    }

    const rows: Array<DatabaseServerEndpoint> =
      await DatabaseServerEndpointService.findBy({
        query: {
          projectId: projectId,
          endpoint: QueryHelper.any(endpoints),
        },
        select: {
          _id: true,
          endpoint: true,
          databaseServerId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const endpointRow of rows) {
      if (endpointRow.endpoint && endpointRow.databaseServerId) {
        owners.set(
          endpointRow.endpoint,
          endpointRow.databaseServerId.toString(),
        );
      }
    }

    return owners;
  }

  private async adoptEndpointDatabaseServer(data: {
    projectId: ObjectID;
    workloadIdentifier: string;
    aliases: Array<WorkloadAlias>;
    ownersByEndpoint: Map<string, string>;
  }): Promise<Model | null> {
    /*
     * Only GLOBAL-scope aliases vote. An unqualified cluster-local name or a
     * bare service name means something different in every cluster and
     * namespace, so it is never evidence that two things are the same
     * database.
     */
    const ownerIds: Set<string> = new Set<string>();

    for (const alias of data.aliases) {
      if (alias.scope !== "global") {
        continue;
      }

      const ownerId: string | undefined = data.ownersByEndpoint.get(
        alias.endpoint,
      );

      if (ownerId) {
        ownerIds.add(ownerId);
      }
    }

    if (ownerIds.size === 0) {
      return null;
    }

    if (ownerIds.size > 1) {
      logger.info(
        `DatabaseServerService: not adopting an existing database for workload ${data.workloadIdentifier} - its endpoints belong to ${ownerIds.size} different databases.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );

      return null;
    }

    const ownerId: string = Array.from(ownerIds)[0]!;
    const candidate: Model | null = await this.findByIdInProject(
      data.projectId,
      new ObjectID(ownerId),
    );

    if (!candidate || !candidate.id) {
      return null;
    }

    if (candidate.workloadIdentifier) {
      // Already another workload's database: two workloads, two rows.
      logger.debug(
        `DatabaseServerService: not adopting database ${ownerId} for workload ${data.workloadIdentifier} - it already belongs to workload ${candidate.workloadIdentifier}.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );

      return null;
    }

    try {
      /*
       * Compare-and-set on the NULL workloadIdentifier: two workloads racing
       * to adopt the same row cannot both win.
       */
      await this.updateColumnsByIdWithoutHooks({
        id: candidate.id,
        data: {
          workloadIdentifier: data.workloadIdentifier,
        },
        expectedData: {
          workloadIdentifier: null,
        },
      });
    } catch (error) {
      // Most likely a racing run created this workload's row first.
      logger.debug(
        `DatabaseServerService: adopting database ${ownerId} for workload ${data.workloadIdentifier} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    /*
     * Whatever happened, the truth is now in the workload index: our
     * adopted row, a row a racing run created, or nothing (another workload
     * adopted the candidate first) - in which case the caller creates.
     */
    return await this.findByWorkloadIdentifier(
      data.projectId,
      data.workloadIdentifier,
    );
  }

  private async createWorkloadDatabaseServer(data: {
    data: UpsertWorkloadDatabaseData;
    workloadIdentifier: string;
    dbSystem: string;
    primaryAlias: WorkloadAlias | undefined;
  }): Promise<{ row: Model | null; createdHere: boolean }> {
    const input: UpsertWorkloadDatabaseData = data.data;
    const now: Date = OneUptimeDate.getCurrentDate();

    const newRow: Model = new Model();
    newRow.projectId = input.projectId;
    newRow.name = truncateShortText(
      (typeof input.displayName === "string" ? input.displayName.trim() : "") ||
        buildDatabaseServerDisplayName({
          system: data.dbSystem,
          namespace: input.kubernetesNamespace,
          workloadName: input.workloadName,
        }),
    );
    newRow.dbSystem = data.dbSystem;
    // A workload row's identity IS its workload.
    newRow.databaseIdentifier = data.workloadIdentifier;
    newRow.workloadIdentifier = data.workloadIdentifier;
    newRow.discoverySource = input.discoverySource;
    newRow.instanceCount = toInstanceCount(input.instanceCount);
    newRow.lastSeenAt = now;
    newRow.memberEntityKeys = mergeDatabaseServerMemberKeys(
      undefined,
      Array.isArray(input.memberKeysSeenNow) ? input.memberKeysSeenNow : [],
      now,
    );

    const workloadKind: string | null = cleanShortText(input.workloadKind);
    if (workloadKind) {
      newRow.workloadKind = workloadKind;
    }

    const workloadName: string | null = cleanLongText(input.workloadName);
    if (workloadName) {
      newRow.workloadName = workloadName;
    }

    const kubernetesNamespace: string | null = cleanShortText(
      input.kubernetesNamespace,
    );
    if (kubernetesNamespace) {
      newRow.kubernetesNamespace = kubernetesNamespace;
    }

    if (input.kubernetesClusterId) {
      newRow.kubernetesClusterId = input.kubernetesClusterId;
    }

    if (input.dockerHostId) {
      newRow.dockerHostId = input.dockerHostId;
    }

    if (input.podmanHostId) {
      newRow.podmanHostId = input.podmanHostId;
    }

    const dbVersion: string | null = cleanShortText(input.dbVersion);
    if (dbVersion) {
      newRow.dbVersion = dbVersion;
    }

    // The address the list shows: the first (primary) alias, when there is one.
    if (data.primaryAlias) {
      newRow.serverAddress = truncateLongText(data.primaryAlias.parsed.host);
      if (data.primaryAlias.parsed.port !== null) {
        newRow.serverPort = data.primaryAlias.parsed.port;
      }
    }

    try {
      const row: Model = await this.create({
        data: newRow,
        props: {
          isRoot: true,
        },
      });

      return { row: row, createdHere: true };
    } catch (error) {
      // A racing run created this workload's row first.
      const existing: Model | null = await this.findByWorkloadIdentifier(
        input.projectId,
        data.workloadIdentifier,
      );

      if (!existing) {
        throw error;
      }

      return { row: existing, createdHere: false };
    }
  }

  private async claimWorkloadAliases(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    workloadIdentifier: string;
    aliases: Array<WorkloadAlias>;
    ownersByEndpoint: Map<string, string>;
    primaryEndpoint: string | undefined;
  }): Promise<void> {
    const ownedByOthers: Array<string> = [];

    for (const alias of data.aliases) {
      const ownerId: string | undefined = data.ownersByEndpoint.get(
        alias.endpoint,
      );

      if (ownerId === data.databaseServerId.toString()) {
        continue;
      }

      if (ownerId) {
        ownedByOthers.push(alias.endpoint);
        continue;
      }

      try {
        const result: DatabaseServerEndpointClaimResult =
          await DatabaseServerEndpointService.claimEndpoint({
            projectId: data.projectId,
            databaseServerId: data.databaseServerId,
            endpoint: alias.endpoint,
            isPrimary: alias.endpoint === data.primaryEndpoint,
            source: "auto",
          });

        if (result === "owned-by-other") {
          ownedByOthers.push(alias.endpoint);
        }
      } catch (error) {
        logger.warn(
          `DatabaseServerService: claiming endpoint ${alias.endpoint} for workload ${data.workloadIdentifier} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
      }
    }

    if (ownedByOthers.length > 0) {
      /*
       * Expected and stable run to run (another database already lists the
       * endpoint), so debug, not info: this runs every five minutes.
       */
      logger.debug(
        `DatabaseServerService: skipped ${ownedByOthers.length} endpoint(s) of workload ${data.workloadIdentifier} that belong to other databases: ${ownedByOthers.join(", ")}`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }
  }

  private async createEndpointDatabaseServer(data: {
    projectId: ObjectID;
    dbSystem: string;
    endpoint: DatabaseEndpoint;
    formattedEndpoint: string;
    discoverySource: DatabaseServerDiscoverySource;
    displayName?: string | undefined;
  }): Promise<Model | null> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const databaseIdentifier: string = truncateLongText(
      buildDatabaseServerIdentifier(data.dbSystem, data.endpoint),
    );

    const newRow: Model = new Model();
    newRow.projectId = data.projectId;
    newRow.name = truncateShortText(
      (typeof data.displayName === "string" ? data.displayName.trim() : "") ||
        buildDatabaseServerDisplayName({
          system: data.dbSystem,
          endpoint: data.endpoint,
        }),
    );
    newRow.dbSystem = data.dbSystem;
    newRow.serverAddress = truncateLongText(data.endpoint.host);
    if (data.endpoint.port !== null) {
      newRow.serverPort = data.endpoint.port;
    }
    newRow.databaseIdentifier = databaseIdentifier;
    newRow.discoverySource = data.discoverySource;
    newRow.lastSeenAt = now;

    /*
     * A collector-created row is connected from its first moment; every
     * other source leaves otelCollectorStatus at its "disconnected" default.
     */
    if (data.discoverySource === DatabaseServerDiscoverySource.Collector) {
      newRow.otelCollectorStatus = "connected";
      newRow.collectorLastSeenAt = now;
    }

    let row: Model;
    let createdHere: boolean = false;

    try {
      /*
       * Without hooks: the Created feed item and the rule engines run only
       * once this row has actually won its endpoint (below), so an orphan
       * that loses the claim leaves no trace behind.
       */
      row = await this.create({
        data: newRow,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      createdHere = true;
    } catch (error) {
      // Same engine + endpoint created by a racing writer.
      const existing: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          databaseIdentifier: databaseIdentifier,
        },
        select: DISCOVERY_SELECT,
        props: {
          isRoot: true,
        },
      });

      if (!existing) {
        throw error;
      }

      row = existing;
    }

    if (!row.id) {
      return null;
    }

    let claim: DatabaseServerEndpointClaimResult;

    try {
      claim = await DatabaseServerEndpointService.claimEndpoint({
        projectId: data.projectId,
        databaseServerId: row.id,
        endpoint: data.formattedEndpoint,
        isPrimary: true,
        source: "auto",
      });
    } catch (error) {
      if (createdHere) {
        await this.deleteOrphanedDatabaseServer(data.projectId, row.id);
      }

      throw error;
    }

    if (claim === "owned-by-other") {
      if (createdHere) {
        await this.deleteOrphanedDatabaseServer(data.projectId, row.id);
      }

      const owner: DatabaseServerEndpointOwner | null =
        await DatabaseServerEndpointService.findOwnerByEndpoint(
          data.projectId,
          data.formattedEndpoint,
        );

      if (!owner) {
        return null;
      }

      const ownerRow: Model | null = await this.findByIdInProject(
        data.projectId,
        owner.databaseServerId,
      );

      if (ownerRow) {
        await this.restoreIfAutoArchived(ownerRow);
      }

      return ownerRow;
    }

    if (createdHere) {
      this.runCreatedSideEffects(row, undefined);
    } else {
      await this.restoreIfAutoArchived(row);
    }

    return row;
  }

  private async deleteOrphanedDatabaseServer(
    projectId: ObjectID,
    databaseServerId: ObjectID,
  ): Promise<void> {
    try {
      await this.deleteBy({
        query: {
          _id: databaseServerId.toString(),
          projectId: projectId,
        },
        limit: 1,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not delete orphaned database ${databaseServerId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: projectId.toString() } as LogAttributes,
      );
    }
  }

  /*
   * A manual create inserts the row first and claims its endpoint second
   * (the claim needs the row's id). onBeforeCreate already refused an owned
   * endpoint, so losing here means a concurrent writer claimed it in
   * between: the new row is removed and the person gets the same message
   * they would have got a moment later.
   */
  private async claimManualPrimaryEndpoint(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    endpoint: string;
  }): Promise<void> {
    let claim: DatabaseServerEndpointClaimResult;

    try {
      claim = await DatabaseServerEndpointService.claimEndpoint({
        projectId: data.projectId,
        databaseServerId: data.databaseServerId,
        endpoint: data.endpoint,
        isPrimary: true,
        source: "user",
      });
    } catch (error) {
      await this.deleteOrphanedDatabaseServer(
        data.projectId,
        data.databaseServerId,
      );
      throw error;
    }

    if (claim !== "owned-by-other") {
      return;
    }

    await this.deleteOrphanedDatabaseServer(
      data.projectId,
      data.databaseServerId,
    );

    const owner: DatabaseServerEndpointOwner | null =
      await DatabaseServerEndpointService.findOwnerByEndpoint(
        data.projectId,
        data.endpoint,
      );

    throw new BadDataException(
      owner
        ? await getOwnedByOtherDatabaseMessage(data.endpoint, owner)
        : `${data.endpoint} already belongs to another database. An endpoint can belong to only one database in a project.`,
    );
  }

  /*
   * Rules run once, on creation only - exact parity with the other resource
   * types. Label engine first: it syncs the in-memory labels so the owner
   * engine can match rule-added labels. Then the Created feed item. Both are
   * fire and forget: neither may fail the create it follows.
   */
  private runCreatedSideEffects(
    createdItem: Model,
    createdByUserId: ObjectID | undefined,
  ): void {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await DatabaseServerLabelRuleEngineService.applyRulesToDatabaseServer(
            createdItem,
          );
        })
        .then(async () => {
          await DatabaseServerOwnerRuleEngineService.applyRulesToDatabaseServer(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying database rules in DatabaseServerService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              databaseServerId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }

    this.writeDatabaseServerCreatedFeed(createdItem, createdByUserId).catch(
      (error: Error) => {
        logger.error(error);
      },
    );
  }

  private async writeDatabaseServerCreatedFeed(
    createdItem: Model,
    createdByUserId: ObjectID | undefined,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const databaseServerId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !databaseServerId) {
      return;
    }

    const markdown: {
      feedInfoInMarkdown: string;
      moreInformationInMarkdown: string;
    } = await ResourceFeedUtil.getCreatedFeedMarkdown({
      resourceTypeName: "database",
      resourceMarkdownLink: await this.getDatabaseServerMarkdownLink(
        projectId,
        databaseServerId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      identifierName: "Database identifier",
      identifierValue: createdItem.databaseIdentifier,
      description: createdItem.description,
    });

    /*
     * "Created automatically from telemetry" covers five very different
     * sources here; say which one found it.
     */
    const moreInformationInMarkdown: string = createdItem.discoverySource
      ? `${markdown.moreInformationInMarkdown}\n\n**Discovered from**: ${getDatabaseServerDiscoverySourceLabel(
          createdItem.discoverySource,
        )}`
      : markdown.moreInformationInMarkdown;

    await DatabaseServerFeedService.createDatabaseServerFeedItem({
      databaseServerId: databaseServerId,
      projectId: projectId,
      databaseServerFeedEventType:
        DatabaseServerFeedEventType.DatabaseServerCreated,
      displayColor: Green500,
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: moreInformationInMarkdown,
      userId: createdByUserId,
    });
  }

  private async writeDatabaseServerUpdatedFeed(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * Heartbeats and discovery write lastSeenAt / otelCollectorStatus /
     * member keys constantly - and hook-free, so they never get here. Only
     * the columns a person would recognise as a change earn a feed item -
     * see MEANINGFUL_UPDATE_COLUMNS.
     */
    const changedColumns: Array<string> =
      ResourceFeedUtil.getUpdatedColumnsWorthRecording(updateData);

    if (changedColumns.length === 0 || updatedItemIds.length === 0) {
      return;
    }

    const isArchiveChange: boolean =
      ResourceFeedUtil.isArchiveChange(updateData);
    const isArchived: boolean = Boolean(updateData["isArchived"]);
    const otherColumns: Array<string> = changedColumns.filter(
      (column: string) => {
        return column !== "isArchived";
      },
    );

    const updatedByUserId: ObjectID | undefined =
      onUpdate.updateBy.props.userId || undefined;

    for (const databaseServerId of updatedItemIds) {
      const databaseServer: Model | null = await this.findOneById({
        id: databaseServerId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = databaseServer?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: string =
        await this.getDatabaseServerMarkdownLink(projectId, databaseServerId);

      if (isArchiveChange) {
        await DatabaseServerFeedService.createDatabaseServerFeedItem({
          databaseServerId: databaseServerId,
          projectId: projectId,
          databaseServerFeedEventType: isArchived
            ? DatabaseServerFeedEventType.DatabaseServerArchived
            : DatabaseServerFeedEventType.DatabaseServerRestored,
          displayColor: isArchived ? Yellow500 : Blue500,
          feedInfoInMarkdown: isArchived
            ? `🗄️ ${resourceMarkdownLink} was archived.`
            : `♻️ ${resourceMarkdownLink} was restored from the archive.`,
          userId: updatedByUserId,
        });
      }

      if (otherColumns.length > 0) {
        const markdown: {
          feedInfoInMarkdown: string;
          moreInformationInMarkdown: string;
        } = ResourceFeedUtil.getUpdatedFeedMarkdown({
          resourceMarkdownLink: resourceMarkdownLink,
          columns: otherColumns,
        });

        await DatabaseServerFeedService.createDatabaseServerFeedItem({
          databaseServerId: databaseServerId,
          projectId: projectId,
          databaseServerFeedEventType:
            DatabaseServerFeedEventType.DatabaseServerUpdated,
          displayColor: Gray500,
          feedInfoInMarkdown: markdown.feedInfoInMarkdown,
          moreInformationInMarkdown: markdown.moreInformationInMarkdown,
          userId: updatedByUserId,
        });
      }
    }
  }

  private async clearAutoArchivedAt(
    databaseServerIds: Array<ObjectID>,
  ): Promise<void> {
    for (const databaseServerId of databaseServerIds) {
      try {
        await this.updateColumnsByIdWithoutHooks({
          id: databaseServerId,
          data: {
            autoArchivedAt: null,
          },
          skipUpdateDateColumn: true,
        });
      } catch (error) {
        logger.warn(
          `DatabaseServerService: could not clear autoArchivedAt on database ${databaseServerId.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /*
   * Restore a row the auto-archive sweep archived, now that it was seen
   * again. The conditions live in the UPDATE itself, so a row a person
   * archived (autoArchivedAt cleared - see onUpdateSuccess) or a row a person
   * restored in the meantime is never touched, and two writers restoring at
   * once record one feed item. Never throws: a restore must not fail the
   * discovery that triggered it.
   */
  private async restoreIfAutoArchived(row: Model): Promise<boolean> {
    if (!row.isArchived || !row.autoArchivedAt || !row.id || !row.projectId) {
      return false;
    }

    try {
      const restored: Array<{ _id: string }> =
        await this.getRepository().manager.query(
          `WITH "restored" AS (
            UPDATE "DatabaseServer"
            SET "isArchived" = false,
              "archivedAt" = NULL,
              "archivedByUserId" = NULL,
              "autoArchivedAt" = NULL,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE "_id" = $1
              AND "projectId" = $2
              AND "isArchived" = true
              AND "autoArchivedAt" IS NOT NULL
              AND "deletedAt" IS NULL
            RETURNING "_id"
          )
          SELECT "_id" FROM "restored"`,
          [row.id.toString(), row.projectId.toString()],
        );

      /*
       * Nothing matched: a person restored it, or archived it themselves, in
       * the meantime. Their state stands - the in-memory row is left as read.
       */
      if (!Array.isArray(restored) || restored.length === 0) {
        return false;
      }

      row.isArchived = false;
      delete row.autoArchivedAt;

      await DatabaseServerFeedService.createDatabaseServerFeedItem({
        databaseServerId: row.id,
        projectId: row.projectId,
        databaseServerFeedEventType:
          DatabaseServerFeedEventType.DatabaseServerRestored,
        displayColor: Blue500,
        feedInfoInMarkdown: `♻️ ${await this.getDatabaseServerMarkdownLink(
          row.projectId,
          row.id,
        )} was restored from the archive automatically - it was seen again after being archived for inactivity.`,
      });

      return true;
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not restore auto-archived database ${row.id.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: row.projectId.toString() } as LogAttributes,
      );

      return false;
    }
  }

  private async restoreAfterHeartbeatIfAutoArchived(
    databaseServerId: ObjectID,
  ): Promise<void> {
    const key: string = databaseServerId.toString();

    if (this.autoRestoreCheckMemo.get(key)) {
      return;
    }

    this.autoRestoreCheckMemo.set(key, true);

    let claimed: boolean = false;

    try {
      claimed = await GlobalCache.setStringIfNotExists(
        AUTO_RESTORE_CHECK_CACHE_NAMESPACE,
        key,
        "1",
        {
          expiresInSeconds: GlobalCache.withJitter(
            AUTO_RESTORE_CHECK_WINDOW_SECONDS,
          ),
        },
      );
    } catch {
      /*
       * Fail closed: a missed restore is retried next window, while failing
       * open would turn a Redis outage into a read per heartbeat.
       */
      claimed = false;
    }

    if (!claimed) {
      return;
    }

    try {
      const row: Model | null = await this.findOneById({
        id: databaseServerId,
        select: {
          _id: true,
          projectId: true,
          isArchived: true,
          autoArchivedAt: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (row) {
        await this.restoreIfAutoArchived(row);
      }
    } catch (error) {
      logger.warn(
        `DatabaseServerService: auto-archive check failed for database ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async writeAutoArchiveFeed(data: {
    databaseServerId: ObjectID;
    projectId: ObjectID;
    days: number;
  }): Promise<void> {
    try {
      await DatabaseServerFeedService.createDatabaseServerFeedItem({
        databaseServerId: data.databaseServerId,
        projectId: data.projectId,
        databaseServerFeedEventType:
          DatabaseServerFeedEventType.DatabaseServerArchived,
        displayColor: Yellow500,
        feedInfoInMarkdown: `🗄️ ${await this.getDatabaseServerMarkdownLink(
          data.projectId,
          data.databaseServerId,
        )} was automatically archived - not seen for ${data.days} ${
          data.days === 1 ? "day" : "days"
        }.`,
        moreInformationInMarkdown: `No collector, application trace or container inventory has reported this database for ${data.days} ${
          data.days === 1 ? "day" : "days"
        }, and nobody has labelled it, owned it, linked it to an incident, alert or scheduled maintenance, added an endpoint to it or changed its retention. It is restored automatically as soon as it is seen again.`,
      });
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not record the auto-archive of database ${data.databaseServerId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

/*
 * The endpoint a person typed into the create form. The port field, when
 * filled, wins over a port inside the address; the engine's default port
 * fills a missing one.
 */
function parseManualEndpoint(data: {
  serverAddress: unknown;
  serverPort: unknown;
  dbSystem: string;
}): DatabaseEndpoint {
  const address: string =
    typeof data.serverAddress === "string" ? data.serverAddress.trim() : "";

  if (!address) {
    throw new BadDataException(
      "Server address is required. Enter the host name or IP address applications use to reach this database.",
    );
  }

  const parsed: DatabaseEndpoint | null = parseDatabaseEndpointString(address, {
    system: data.dbSystem,
  });

  if (!parsed) {
    throw new BadDataException(
      `"${
        address.length > 100 ? `${address.substring(0, 100)}…` : address
      }" is not a valid host[:port] endpoint. Enter a host name or IP address with an optional port, for example orders-db.internal:5432. Loopback addresses such as localhost cannot be used, because every application reaches its own.`,
    );
  }

  const endpoint: DatabaseEndpoint = { ...parsed };

  if (
    data.serverPort !== undefined &&
    data.serverPort !== null &&
    data.serverPort !== ""
  ) {
    const port: number = Number(data.serverPort);

    if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
      throw new BadDataException(
        `Server port must be a whole number between 1 and ${MAX_PORT}.`,
      );
    }

    endpoint.port = port;
  }

  return endpoint;
}

/*
 * The worker's aliases, re-canonicalized (a stored or hand-built alias must
 * compare byte for byte with what ingest keys), deduped, in order, capped.
 */
function canonicalizeWorkloadAliases(
  aliases: Array<string> | null | undefined,
  dbSystem: string,
): Array<WorkloadAlias> {
  const result: Array<WorkloadAlias> = [];
  const seen: Set<string> = new Set<string>();

  for (const alias of Array.isArray(aliases) ? aliases : []) {
    if (result.length >= MAX_WORKLOAD_ALIASES) {
      break;
    }

    const parsed: DatabaseEndpoint | null = parseDatabaseEndpointString(alias, {
      system: dbSystem,
    });

    if (!parsed) {
      continue;
    }

    const endpoint: string = formatDatabaseEndpoint(parsed);

    if (!endpoint || seen.has(endpoint)) {
      continue;
    }

    seen.add(endpoint);
    result.push({
      endpoint: endpoint,
      scope: getDatabaseEndpointScope(parsed),
      parsed: parsed,
    });
  }

  return result;
}

function cleanShortText(value: string | null | undefined): string | null {
  const trimmed: string = typeof value === "string" ? value.trim() : "";
  return trimmed ? truncateShortText(trimmed) : null;
}

function cleanLongText(value: string | null | undefined): string | null {
  const trimmed: string = typeof value === "string" ? value.trim() : "";
  return trimmed ? truncateLongText(trimmed) : null;
}

function toInstanceCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

/*
 * A positive-integer env setting: unset or unparseable → the default, below
 * the floor → the floor.
 */
function readIntegerEnv(data: {
  name: string;
  defaultValue: number;
  min: number;
}): number {
  const raw: string | undefined = process.env[data.name];

  if (raw === undefined || raw.trim() === "") {
    return data.defaultValue;
  }

  const parsed: number = Number(raw.trim());

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return data.defaultValue;
  }

  return Math.max(parsed, data.min);
}

function readCount(rows: unknown): number {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const count: number = Number((rows[0] as { count?: unknown })?.count);

  return Number.isFinite(count) ? count : 0;
}

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

export default new Service();
