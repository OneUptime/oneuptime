import DatabaseService from "./DatabaseService";
import DatabaseServerEndpointService, {
  DatabaseServerEndpointClaimResult,
  DatabaseServerEndpointOwner,
  ENDPOINT_MATCH_REFRESH_SECONDS,
  getOwnedByOtherDatabaseMessage,
} from "./DatabaseServerEndpointService";
import DatabaseServerFeedService from "./DatabaseServerFeedService";
import DatabaseServerLabelRuleEngineService from "./DatabaseServerLabelRuleEngineService";
import DatabaseServerOwnerRuleEngineService from "./DatabaseServerOwnerRuleEngineService";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Model from "../../Models/DatabaseModels/DatabaseServer";
import DatabaseServerEndpoint from "../../Models/DatabaseModels/DatabaseServerEndpoint";
import { DatabaseServerFeedEventType } from "../../Models/DatabaseModels/DatabaseServerFeed";
import Label from "../../Models/DatabaseModels/Label";
import DatabaseConfig from "../DatabaseConfig";
import GlobalCache from "../Infrastructure/GlobalCache";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
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
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PartialEntity from "../../Types/Database/PartialEntity";
import DatabaseServerDiscoverySource, {
  getDatabaseServerDiscoverySourceLabel,
} from "../../Types/DatabaseServer/DatabaseServerDiscoverySource";
import {
  DatabaseEndpoint,
  DatabaseEndpointScope,
  ManualDatabaseEndpoint,
  buildDatabaseServerDisplayName,
  buildDatabaseServerIdentifier,
  formatDatabaseEndpoint,
  getDatabaseEndpointScope,
  isKubernetesServiceDnsHost,
  parseDatabaseEndpointString,
  parseManualDatabaseEndpoint,
} from "../../Types/DatabaseServer/DatabaseEndpoint";
import {
  DATABASE_SYSTEMS,
  DatabaseSystemDescriptor,
  getDatabaseSystemDisplayName,
  getDatabaseSystemFamily,
  getMoreSpecificDatabaseSystem,
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

/*
 * A person's Restore holds the sweep off this long (or the archive window,
 * if that is longer) unless discovery sees the database again first.
 */
const MANUAL_RESTORE_GRACE_DAYS: number = 30;

const DEFAULT_AUTO_CREATE_BUDGET: number = 500;

/*
 * The auto-create budget as the ingest hot path reads it: one count per
 * project per minute per process, bumped locally by every create in between.
 */
const AUTO_CREATE_BUDGET_CACHE_MS: number = 60 * 1000;
// One "budget reached" warning per project per ten minutes per process.
const AUTO_CREATE_BUDGET_WARNING_MS: number = 10 * 60 * 1000;

// Endpoint aliases one workload may claim per discovery run.
const MAX_WORKLOAD_ALIASES: number = 100;

/*
 * A workload discovery has not seen for this long is gone: the endpoints its
 * row holds may be handed to the workload that serves them now, and seeing
 * one of them in a trace no longer brings its archived row back. Discovery
 * runs every five minutes, so this is a dozen missed runs.
 */
const WORKLOAD_GONE_MINUTES: number = 60;

/*
 * A "workload" alias its workload has stopped producing is released once it
 * has not been produced for this long. Produced aliases are re-stamped at
 * least hourly (ENDPOINT_MATCH_REFRESH_SECONDS), so this is comfortably
 * longer than any gap a healthy workload leaves, and one partial run
 * releases nothing.
 */
const WORKLOAD_ALIAS_RELEASE_MINUTES: number = 120;

/*
 * A workload row whose columns discovery would write back unchanged is only
 * rewritten once this long has passed since it was last written: discovery
 * runs every five minutes, and rewriting every row every run (the member-key
 * JSON included) costs a write per database per run for nothing. Its
 * lastSeenAt is then at most this plus one discovery interval old - inside
 * the dashboard's 30-minute "seen recently" window
 * (DATABASE_SERVER_LIVE_WINDOW_MINUTES), and far inside
 * WORKLOAD_GONE_MINUTES and the auto-archive sweep's one-hour margin behind
 * its parent - so a skipped write never makes a live workload look inactive
 * or gone.
 */
const WORKLOAD_REFRESH_MINUTES: number = 15;

// How many of the project's cluster names a manual-create refusal lists.
const MAX_LISTED_CLUSTER_NAMES: number = 10;

/*
 * The columns every discovery caller gets back. Enough to key telemetry
 * (id, project, engine, endpoint), name it (name), decide on archive
 * handling and weigh new engine evidence - but not the member-key map,
 * which only the workload path reads.
 */
const DISCOVERY_SELECT: Select<Model> = {
  _id: true,
  projectId: true,
  name: true,
  dbSystem: true,
  dbSystemSource: true,
  databaseIdentifier: true,
  workloadIdentifier: true,
  workloadName: true,
  workloadLastSeenAt: true,
  discoverySource: true,
  serverAddress: true,
  serverPort: true,
  kubernetesClusterId: true,
  kubernetesNamespace: true,
  isArchived: true,
  autoArchivedAt: true,
};

/*
 * The workload path also compares what it would write with what the row
 * holds (see workloadColumnsChanged), so it reads every column it writes.
 */
const WORKLOAD_SELECT: Select<Model> = {
  ...DISCOVERY_SELECT,
  memberEntityKeys: true,
  dbVersion: true,
  collectorLastSeenAt: true,
  instanceCount: true,
  workloadKind: true,
  dockerHostId: true,
  podmanHostId: true,
  lastSeenAt: true,
};

/*
 * "Nobody invested in this row", as one SQL predicate over `ds` (a
 * DatabaseServer row): no retention override, and no label, owner, incident
 * / alert / scheduled-maintenance link or person-added endpoint - each
 * checked against the row's own project and live rows only. Labels and
 * owners that rules or ingest attached on their own (automaticAssignments)
 * do not count: a catch-all rule would otherwise keep every discovered row
 * alive forever. Shared by the auto-archive sweep and by the workload path
 * deciding whether a trace-discovered duplicate may hand over its endpoints.
 */
const UNTOUCHED_DATABASE_SERVER_PREDICATE: string = `ds."retainTelemetryDataForDays" IS NULL
            AND (ds."telemetryRetentionConfig" IS NULL OR ds."telemetryRetentionConfig"::text IN ('null', '{}'))
            AND NOT EXISTS (
              SELECT 1 FROM "DatabaseServerLabel" l
              INNER JOIN "Label" lbl ON lbl."_id" = l."labelId"
              WHERE l."databaseServerId" = ds."_id"
                AND lbl."projectId" = ds."projectId"
                AND lbl."deletedAt" IS NULL
                AND NOT (COALESCE(ds."automaticAssignments" -> 'labelIds', '[]'::jsonb) @> jsonb_build_array(l."labelId"::text))
            )
            AND NOT EXISTS (
              SELECT 1 FROM "DatabaseServerOwnerUser" ou
              WHERE ou."databaseServerId" = ds."_id"
                AND ou."projectId" = ds."projectId"
                AND ou."deletedAt" IS NULL
                AND NOT (COALESCE(ds."automaticAssignments" -> 'ownerUserIds', '[]'::jsonb) @> jsonb_build_array(ou."userId"::text))
            )
            AND NOT EXISTS (
              SELECT 1 FROM "DatabaseServerOwnerTeam" ot
              WHERE ot."databaseServerId" = ds."_id"
                AND ot."projectId" = ds."projectId"
                AND ot."deletedAt" IS NULL
                AND NOT (COALESCE(ds."automaticAssignments" -> 'ownerTeamIds', '[]'::jsonb) @> jsonb_build_array(ot."teamId"::text))
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
            )`;

/*
 * The labels and owners rules and ingest attach on their own, recorded per
 * row in DatabaseServer.automaticAssignments under these keys.
 */
export type DatabaseServerAutomaticAssignmentKind =
  | "labelIds"
  | "ownerUserIds"
  | "ownerTeamIds";

const AUTOMATIC_ASSIGNMENT_KINDS: ReadonlyArray<DatabaseServerAutomaticAssignmentKind> =
  ["labelIds", "ownerUserIds", "ownerTeamIds"];

/*
 * What a row's engine (dbSystem) was determined from, strongest first:
 *   - manual: a person chose it;
 *   - collector: an OTel Collector receiver or the Database Agent - the
 *     engine reporting on itself;
 *   - container: the image or Helm chart of a Kubernetes / Docker / Podman
 *     workload;
 *   - client-spans: what an application's client library called it. A
 *     wire-compatible client names the engine it speaks to, not the engine
 *     it reached (pgx says "postgresql" to CockroachDB).
 */
export enum DatabaseSystemEvidence {
  Manual = "manual",
  Collector = "collector",
  Container = "container",
  ClientSpans = "client-spans",
}

const DATABASE_SYSTEM_EVIDENCE_RANK: Record<DatabaseSystemEvidence, number> = {
  [DatabaseSystemEvidence.Manual]: 4,
  [DatabaseSystemEvidence.Collector]: 3,
  [DatabaseSystemEvidence.Container]: 2,
  [DatabaseSystemEvidence.ClientSpans]: 1,
};

const DATABASE_SYSTEM_EVIDENCE_LABEL: Record<DatabaseSystemEvidence, string> = {
  [DatabaseSystemEvidence.Manual]: "a person",
  [DatabaseSystemEvidence.Collector]:
    "its OpenTelemetry Collector receiver or Database Agent",
  [DatabaseSystemEvidence.Container]: "its container image",
  [DatabaseSystemEvidence.ClientSpans]: "application traces",
};

export interface DatabaseSystemDetermination {
  system: string;
  evidence: DatabaseSystemEvidence;
}

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

// A stored DatabaseServerEndpoint row, as the workload path weighs it.
interface StoredEndpoint {
  endpointId: ObjectID | null;
  databaseServerId: string;
  source: string;
  isPrimary: boolean;
  lastMatchedAt: Date | null;
}

interface HeldAlias {
  alias: WorkloadAlias;
  stored: StoredEndpoint;
}

interface AutoCreateCount {
  count: number;
  readAtMs: number;
}

/*
 * The Databases product's root service. A DatabaseServer row is found and
 * created by ENDPOINT (DatabaseServerEndpoint, one owner per endpoint per
 * project) or by WORKLOAD (workloadIdentifier), never by name - two engines
 * can share a host name and a person can rename any row.
 *
 * Invariants every discovery path relies on:
 *   - an endpoint belongs to at most one row, and an ambiguous match is never
 *     tie-broken. A claim never takes an endpoint away from a live row: the
 *     only moves are the workload path handing a DISCOVERED ("auto" /
 *     "workload") endpoint from a workload that is gone, or from an untouched
 *     trace-discovered duplicate, to the workload that serves it now. A
 *     person's ("user") endpoint is never moved or released by discovery;
 *   - a LOCAL-scope endpoint (single-label name, unqualified cluster-local
 *     DNS or private IP) never creates a row and never adopts one;
 *   - discovery only ever un-archives a row it archived itself
 *     (autoArchivedAt), never one a person archived;
 *   - an engine a person chose is never changed, and a weaker source never
 *     changes an engine a stronger one determined (DatabaseSystemEvidence)
 *     - except to refine it to a fork, which any source may do and none
 *     undoes (decideDatabaseSystem, getMoreSpecificDatabaseSystem).
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

  // Per project: its auto-created row count, as last read (see getAutoCreateCount).
  private autoCreateCountMemo: InProcessMemo<AutoCreateCount> =
    new InProcessMemo<AutoCreateCount>({
      ttlInMs: AUTO_CREATE_BUDGET_CACHE_MS,
      maxEntries: 10_000,
    });

  // Per project: a "budget reached" warning was logged recently.
  private autoCreateBudgetWarningMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: AUTO_CREATE_BUDGET_WARNING_MS,
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
   *
   * The create permission is checked FIRST, before any lookup: the refusals
   * below name databases, and a caller who may not add a database must not
   * be able to use them to learn what exists.
   *
   * The typed address is read by parseManualDatabaseEndpoint, whose refusals
   * say what to change (`user@host`, a cluster qualifier on a public host, a
   * loopback name, a port out of range), and a Kubernetes Service name typed
   * without its cluster is refused in a project that has clusters (see
   * refuseUnqualifiedKubernetesServiceName).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.props.isRoot) {
      return { createBy: createBy, carryForward: null };
    }

    const data: Model = createBy.data;

    ModelPermission.checkCreatePermissions(Model, data, createBy.props);

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

    const manual: ManualDatabaseEndpoint = parseManualEndpoint({
      serverAddress: data.serverAddress,
      serverPort: data.serverPort,
      dbSystem: dbSystem,
    });
    const endpoint: DatabaseEndpoint = manual.endpoint!;

    const formatted: string = formatDatabaseEndpoint(endpoint);

    const owner: DatabaseServerEndpointOwner | null =
      await DatabaseServerEndpointService.findOwnerByEndpoint(
        projectId,
        formatted,
      );

    if (owner) {
      throw new BadDataException(
        await getOwnedByOtherDatabaseMessage(formatted, owner, createBy.props),
      );
    }

    await this.refuseUnqualifiedKubernetesServiceName({
      projectId: projectId,
      manual: manual,
      serverAddress: data.serverAddress,
      serverPort: data.serverPort,
      dbSystem: dbSystem,
    });

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
      // Named only when the caller may read it.
      const sameIdentityName: string = sameIdentity.id
        ? await this.getDatabaseServerNameIfReadable({
            databaseServerId: sameIdentity.id,
            props: createBy.props,
          })
        : "";

      throw new BadDataException(
        `A ${getDatabaseSystemDisplayName(dbSystem)} database at ${formatted} already exists${
          sameIdentityName ? `: "${sameIdentityName}"` : ""
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
        props: onCreate.createBy.props,
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
     * hands: from now on only a person restores it. A person's Restore also
     * holds off the auto-archive sweep (manuallyRestoredAt), which would
     * otherwise re-archive a stale row within minutes. Discovery's own
     * archive and restore are raw writes, so they never reach this hook.
     */
    if (
      ResourceFeedUtil.isArchiveChange(updateData) &&
      !("autoArchivedAt" in updateData)
    ) {
      await this.recordArchiveDecisionByPerson(
        updatedItemIds,
        !updateData["isArchived"],
      );
    }

    /*
     * Labels a person saves on a row are theirs, whichever rule or
     * collector first attached them: they now count as investment.
     */
    if ("labels" in updateData) {
      const labelIds: Array<string> = readRelationIds(updateData["labels"]);

      for (const databaseServerId of updatedItemIds) {
        await this.forgetAutomaticAssignments({
          databaseServerId: databaseServerId,
          kind: "labelIds",
          ids: labelIds,
        });
      }
    }

    // An engine a person set is never overridden by discovery.
    if ("dbSystem" in updateData) {
      await this.recordDatabaseSystemSetByPerson(updatedItemIds);
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
   * endpoint and no row may be created for it (creation not allowed, a
   * LOCAL-scope endpoint, which only ever joins an existing row, or - for
   * the collector path, which has no budget of its own - a project that has
   * reached its auto-create budget).
   *
   * An owner that is found is also told about the sighting: the endpoint's
   * lastMatchedAt moves (throttled), the reported engine is weighed against
   * the row's (a stronger source may correct or refine it, a weaker one
   * never does), and a row discovery archived is restored - unless it is
   * the row of a workload that is gone, which a stale alias must not bring
   * back.
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

      await DatabaseServerEndpointService.markEndpointMatched(owner);

      if (ownerRow) {
        const evidence: DatabaseSystemEvidence | null =
          getDatabaseSystemEvidenceForSource(data.discoverySource);

        if (evidence) {
          await this.applyDatabaseSystemEvidence(ownerRow, {
            system: data.dbSystem,
            evidence: evidence,
          });
        }

        if (!this.isWorkloadGone(ownerRow)) {
          await this.restoreIfAutoArchived(ownerRow);
        }
      }

      return ownerRow;
    }

    if (!data.allowCreate) {
      return null;
    }

    if (getDatabaseEndpointScope(data.endpoint) === "local") {
      return null;
    }

    // An unknown engine is kept verbatim, so clamp it to its column.
    const dbSystem: string | null = cleanShortText(
      normalizeDatabaseSystem(data.dbSystem),
    );

    if (!dbSystem) {
      return null;
    }

    /*
     * The trace and container paths ask the budget themselves, once per run
     * (AutoCreateBudget). The collector path runs on the ingest hot path and
     * has no run to hang that on, so it is asked here - from a per-process
     * cache, so a steady stream of known endpoints costs nothing.
     */
    if (
      data.discoverySource === DatabaseServerDiscoverySource.Collector &&
      !(await this.allowsCollectorAutoCreate(data.projectId, formatted))
    ) {
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
   * and the agent / engine versions when they change. The engine version the
   * collector reports is the one the row shows: the workload path's image
   * tag never overwrites it while the collector is live.
   *
   * At most once per ten minutes per database, fleet-wide, the row is also
   * reconciled with what the collector says: one it brings back after it was
   * auto-archived is restored, and `dbSystem` (the engine the receiver or the
   * agent reported) is weighed as collector evidence - it corrects an engine
   * a container image or client spans guessed, and refines a family engine
   * to a fork, but never overrides a person's choice or downgrades a fork.
   */
  @CaptureSpan()
  public async recordCollectorHeartbeat(
    databaseServerId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
      dbVersion?: string | undefined;
      dbSystem?: string | undefined;
    },
  ): Promise<void> {
    const agentVersion: string | null = cleanShortText(extra?.agentVersion);
    const dbVersion: string | null = cleanShortText(extra?.dbVersion);

    const extrasFingerprint: string = crypto
      .createHash("sha256")
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

    await this.reconcileAfterHeartbeat(databaseServerId, extra?.dbSystem);
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
   * join-table scan. The labels this adds are recorded as automatic, so they
   * never count as somebody investing in the row (a label a person already
   * put on the row is not re-added, and stays theirs).
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

        await this.recordAutomaticAssignments({
          databaseServerId: data.databaseServerId,
          kind: "labelIds",
          ids: toAddIds,
        });
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
   * labels or owners a PERSON added (not the ones rules or ingest attached
   * on their own), a link from an incident / alert / scheduled maintenance,
   * an endpoint a person added, or a retention override. Every one of those
   * checks is done in SQL, scoped to the row's project and to live rows
   * (UNTOUCHED_DATABASE_SERVER_PREDICATE).
   *
   * Two more rows are left alone:
   *   - one a person restored from the archive, until discovery sees it
   *     again or the grace period passes - their Restore must stick;
   *   - one whose Kubernetes cluster / Docker / Podman host has gone quiet:
   *     discovery only visits connected parents, so while the parent is dark
   *     its databases are unseen for a reason that says nothing about them.
   *     Staleness is anchored to the parent's own last contact - a row is
   *     only stale if it went unseen well before its parent did - the way
   *     the Kubernetes and Docker inventory cleanups keep last-known state.
   *     A row whose parent was deleted ages out on its own.
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
    const restoreGraceCutoff: Date = OneUptimeDate.addRemoveDays(
      now,
      -Math.max(MANUAL_RESTORE_GRACE_DAYS, days),
    );

    const archived: Array<{ _id: string; projectId: string }> =
      await this.getRepository().manager.query(
        `WITH "candidates" AS (
          SELECT ds."_id"
          FROM "DatabaseServer" ds
          LEFT JOIN "KubernetesCluster" kc
            ON kc."_id" = ds."kubernetesClusterId" AND kc."deletedAt" IS NULL
          LEFT JOIN "DockerHost" dh
            ON dh."_id" = ds."dockerHostId" AND dh."deletedAt" IS NULL
          LEFT JOIN "PodmanHost" ph
            ON ph."_id" = ds."podmanHostId" AND ph."deletedAt" IS NULL
          WHERE ds."deletedAt" IS NULL
            AND ds."isArchived" = false
            AND ds."discoverySource" IS NOT NULL
            AND ds."discoverySource" <> $3
            AND COALESCE(ds."lastSeenAt", ds."createdAt") < $1
            AND COALESCE(ds."lastSeenAt", ds."createdAt") < COALESCE(kc."lastSeenAt", dh."lastSeenAt", ph."lastSeenAt", $2) - INTERVAL '1 hour'
            AND (
              ds."manuallyRestoredAt" IS NULL
              OR ds."manuallyRestoredAt" < $5
              OR COALESCE(ds."lastSeenAt", ds."createdAt") > ds."manuallyRestoredAt"
            )
            AND ${UNTOUCHED_DATABASE_SERVER_PREDICATE}
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
          restoreGraceCutoff,
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
   * How many discovered databases (collector, client spans, Kubernetes,
   * Docker, Podman) a project may accumulate before discovery stops creating
   * more on its own. Manual rows do not count and are never blocked, and a
   * database linked to its agent by DATABASE_SERVER_ID never needs a create.
   * Collector rows count: a collector keyed on pod IPs or pod host names
   * would otherwise mint rows without bound. Default 500, at least 0 (0
   * turns auto-creation off).
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
   * the auto-archive sweep frees budget. Always reads the count - the
   * workers call it once per project per run (AutoCreateBudget).
   */
  @CaptureSpan()
  public async isUnderAutoCreateBudget(projectId: ObjectID): Promise<boolean> {
    const budget: number = this.getAutoCreateBudget();

    if (budget <= 0) {
      return false;
    }

    return (await this.countAutoCreatedDatabaseServers(projectId)) < budget;
  }

  /**
   * isUnderAutoCreateBudget for the ingest hot path: the count is read at
   * most once a minute per project in this process, and every row this
   * process creates in between is added to it, so a burst of new endpoints
   * stops at the budget instead of a minute's worth past it.
   */
  @CaptureSpan()
  public async isUnderAutoCreateBudgetCached(
    projectId: ObjectID,
  ): Promise<boolean> {
    const budget: number = this.getAutoCreateBudget();

    if (budget <= 0) {
      return false;
    }

    const key: string = projectId.toString();
    let cached: AutoCreateCount | undefined = this.autoCreateCountMemo.get(key);

    if (!cached) {
      cached = {
        count: await this.countAutoCreatedDatabaseServers(projectId),
        readAtMs: Date.now(),
      };
      this.autoCreateCountMemo.set(key, cached);
    }

    return cached.count < budget;
  }

  // Live, non-archived, non-manual rows of one project.
  @CaptureSpan()
  public async countAutoCreatedDatabaseServers(
    projectId: ObjectID,
  ): Promise<number> {
    const rows: Array<{ count: number | string }> =
      await this.getRepository().manager.query(
        `SELECT COUNT(*)::int AS "count"
        FROM "DatabaseServer"
        WHERE "projectId" = $1
          AND "deletedAt" IS NULL
          AND "isArchived" = false
          AND COALESCE("discoverySource", '') <> $2`,
        [projectId.toString(), DatabaseServerDiscoverySource.Manual],
      );

    return readCount(rows);
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

  /**
   * The database's name - but only when `props` may read that row (project,
   * label and Owned scopes applied); "" otherwise, or on any error. Refusal
   * messages use it, so a caller with scoped permissions is never told the
   * name of a database they cannot see. Without props (or as root) the name
   * is read as root.
   */
  @CaptureSpan()
  public async getDatabaseServerNameIfReadable(data: {
    databaseServerId: ObjectID;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<string> {
    if (!data.props || data.props.isRoot) {
      return await this.getDatabaseServerName({
        databaseServerId: data.databaseServerId,
      });
    }

    try {
      const readable: Model | null = await this.findOneBy({
        query: {
          _id: data.databaseServerId.toString(),
        },
        select: {
          name: true,
        },
        props: data.props,
      });

      return readable?.name || "";
    } catch {
      return "";
    }
  }

  /**
   * Validate the database a child row (an owner, a feed note) is created
   * for by a caller: the FK column and the relation object must agree
   * (TypeORM would persist the relation object's id over the column's), and
   * the database must be in the caller's project. Leaves the validated FK
   * column as the only reference. Root creates are the caller's business.
   */
  @CaptureSpan()
  public async assertDatabaseServerReferenceInProject<TModel extends BaseModel>(
    createBy: CreateBy<TModel>,
  ): Promise<ObjectID> {
    const data: TModel = createBy.data;

    const projectId: ObjectID | undefined =
      createBy.props.tenantId ||
      (data.getColumnValue("projectId") as ObjectID | undefined) ||
      undefined;

    if (!projectId) {
      throw new BadDataException("Project ID is required.");
    }

    const databaseServerId: ObjectID | null = RelationIdUtil.readConsistent(
      data as unknown as Record<string, unknown>,
      ["databaseServerId", "databaseServer"],
      "database",
    );

    data.setColumnValue("databaseServer", undefined);

    if (!databaseServerId) {
      throw new BadDataException("Select a database.");
    }

    const databaseServer: Model | null = await this.findOneBy({
      query: {
        _id: databaseServerId.toString(),
        projectId: projectId,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!databaseServer) {
      throw new BadDataException("Database not found.");
    }

    data.setColumnValue("databaseServerId", databaseServerId);

    return databaseServerId;
  }

  /**
   * Record labels or owners that a rule or ingest attached to a database on
   * its own (DatabaseServer.automaticAssignments), so the auto-archive sweep
   * does not mistake them for a person's investment. One atomic statement;
   * ids deduped. Never throws - it only annotates a write that happened.
   */
  @CaptureSpan()
  public async recordAutomaticAssignments(data: {
    databaseServerId: ObjectID;
    kind: DatabaseServerAutomaticAssignmentKind;
    ids: Array<ObjectID | string>;
  }): Promise<void> {
    const ids: Array<string> = normalizeAssignmentIds(data.ids);

    if (ids.length === 0 || !AUTOMATIC_ASSIGNMENT_KINDS.includes(data.kind)) {
      return;
    }

    try {
      await this.getRepository().manager.query(
        `UPDATE "DatabaseServer"
        SET "automaticAssignments" =
          (CASE WHEN jsonb_typeof("automaticAssignments") = 'object' THEN "automaticAssignments" ELSE '{}'::jsonb END)
          || jsonb_build_object(
            $2::text,
            (
              SELECT COALESCE(jsonb_agg(DISTINCT assigned.id), '[]'::jsonb)
              FROM jsonb_array_elements_text(
                (CASE WHEN jsonb_typeof("automaticAssignments" -> $2::text) = 'array' THEN "automaticAssignments" -> $2::text ELSE '[]'::jsonb END)
                || $3::jsonb
              ) AS assigned(id)
            )
          )
        WHERE "_id" = $1`,
        [data.databaseServerId.toString(), data.kind, JSON.stringify(ids)],
      );
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not record automatic ${data.kind} on database ${data.databaseServerId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The opposite of recordAutomaticAssignments: a person (re)added these
   * labels or owners, so from now on they count as investment. Never throws.
   */
  @CaptureSpan()
  public async forgetAutomaticAssignments(data: {
    databaseServerId: ObjectID;
    kind: DatabaseServerAutomaticAssignmentKind;
    ids: Array<ObjectID | string>;
  }): Promise<void> {
    const ids: Array<string> = normalizeAssignmentIds(data.ids);

    if (ids.length === 0 || !AUTOMATIC_ASSIGNMENT_KINDS.includes(data.kind)) {
      return;
    }

    try {
      await this.getRepository().manager.query(
        `UPDATE "DatabaseServer"
        SET "automaticAssignments" = "automaticAssignments" || jsonb_build_object(
          $2::text,
          (
            SELECT COALESCE(jsonb_agg(assigned.id), '[]'::jsonb)
            FROM jsonb_array_elements_text("automaticAssignments" -> $2::text) AS assigned(id)
            WHERE NOT (assigned.id = ANY($3::text[]))
          )
        )
        WHERE "_id" = $1
          AND jsonb_typeof("automaticAssignments") = 'object'
          AND jsonb_typeof("automaticAssignments" -> $2::text) = 'array'`,
        [data.databaseServerId.toString(), data.kind, ids],
      );
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not forget automatic ${data.kind} on database ${data.databaseServerId.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
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

  // For tests: forget the cached auto-create counts and budget warnings.
  public clearAutoCreateBudgetMemo(): void {
    this.autoCreateCountMemo.clear();
    this.autoCreateBudgetWarningMemo.clear();
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

    const dbSystem: string | null = cleanShortText(
      normalizeDatabaseSystem(data.dbSystem),
    );

    if (!dbSystem) {
      return null;
    }

    const projectId: ObjectID = data.projectId;
    const aliases: Array<WorkloadAlias> = canonicalizeWorkloadAliases(
      data.aliases,
      dbSystem,
    );

    // Who owns each alias today: one query, reused by adoption and claiming.
    const ownersByEndpoint: Map<string, StoredEndpoint> =
      await this.findEndpointOwners(
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
      row = await this.adoptSameWorkloadOfEngineFamily({
        projectId: projectId,
        workloadIdentifier: workloadIdentifier,
        dbSystem: dbSystem,
      });
    }

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

    const now: Date = OneUptimeDate.getCurrentDate();

    await this.claimWorkloadAliases({
      projectId: projectId,
      databaseServerId: row.id,
      workloadIdentifier: workloadIdentifier,
      discoverySource: data.discoverySource,
      aliases: aliases,
      ownersByEndpoint: ownersByEndpoint,
      primaryEndpoint: createdHere ? aliases[0]?.endpoint : undefined,
      now: now,
    });

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
      workloadLastSeenAt: now,
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

    /*
     * The image tag is the version of last resort: while a collector is
     * reporting the engine's own version (recordCollectorHeartbeat), that
     * one stands - otherwise the two writers would flip the column between
     * "16" and "16.4" all day.
     */
    const dbVersion: string | null = cleanShortText(data.dbVersion);
    if (dbVersion && (!this.isCollectorFresh(row, now) || !row.dbVersion)) {
      update["dbVersion"] = dbVersion;
    }

    /*
     * The image is evidence of the engine: it corrects what client spans
     * guessed for a row this workload adopted, and refines a family engine
     * to a fork (redis -> valkey). A row created here already has it.
     */
    const previousSystem: string | undefined = row.dbSystem;
    const engine: DatabaseSystemDetermination | null = createdHere
      ? null
      : decideDatabaseSystem({
          current: {
            system: row.dbSystem,
            evidence: getStoredDatabaseSystemEvidence(row),
          },
          incoming: {
            system: dbSystem,
            evidence: DatabaseSystemEvidence.Container,
          },
        });

    if (engine) {
      update["dbSystemSource"] = engine.evidence;

      if (engine.system !== normalizeDatabaseSystem(row.dbSystem)) {
        update["dbSystem"] = engine.system;

        const renamed: string | null = renameForDatabaseSystem(
          row,
          engine.system,
        );

        if (renamed) {
          update["name"] = renamed;
        }
      }
    }

    row.workloadIdentifier = workloadIdentifier;

    /*
     * Nothing but the liveness stamps would change, and the row was written
     * recently: skip the write (see WORKLOAD_REFRESH_MINUTES). The row is
     * returned as it was read. Aliases and the auto-archive restore above
     * and below still run on every sighting.
     */
    if (
      workloadColumnsChanged(row, update) ||
      !this.isWorkloadRowFresh(row, now)
    ) {
      await this.updateColumnsByIdWithoutHooks({
        id: row.id,
        data: update as unknown as PartialEntity<Model>,
      });

      row.memberEntityKeys = memberEntityKeys;
      row.instanceCount = instanceCount;
      row.lastSeenAt = now;
      row.workloadLastSeenAt = now;

      if (engine) {
        row.dbSystemSource = engine.evidence;
        if (typeof update["dbSystem"] === "string") {
          row.dbSystem = update["dbSystem"];
        }
        if (typeof update["name"] === "string") {
          row.name = update["name"];
        }
      }

      if (typeof update["dbVersion"] === "string") {
        row.dbVersion = update["dbVersion"];
      }
    }

    if (engine && previousSystem && row.dbSystem !== previousSystem) {
      await this.writeEngineCorrectedFeed({
        row: row,
        previousSystem: previousSystem,
        evidence: engine.evidence,
      });
    }

    await this.restoreIfAutoArchived(row);

    return row;
  }

  /**
   * Weigh new evidence of a row's engine (see decideDatabaseSystem) and, if
   * it wins, write it: the engine, the evidence behind it, and the
   * auto-generated name when the row still carries the old one - a name a
   * person chose is kept. A compare-and-set on the engine read, so two
   * writers weighing at once cannot interleave. Never throws.
   */
  private async applyDatabaseSystemEvidence(
    row: Model,
    incoming: {
      system: string | null | undefined;
      evidence: DatabaseSystemEvidence;
    },
  ): Promise<void> {
    if (!row.id || !row.dbSystem) {
      return;
    }

    const decision: DatabaseSystemDetermination | null = decideDatabaseSystem({
      current: {
        system: row.dbSystem,
        evidence: getStoredDatabaseSystemEvidence(row),
      },
      incoming: incoming,
    });

    if (!decision) {
      return;
    }

    const previousSystem: string = row.dbSystem;
    const engineChanged: boolean =
      decision.system !== normalizeDatabaseSystem(previousSystem);

    const update: PartialEntity<Model> = {
      dbSystemSource: decision.evidence,
    };

    if (engineChanged) {
      update.dbSystem = decision.system;

      const renamed: string | null = renameForDatabaseSystem(
        row,
        decision.system,
      );

      if (renamed) {
        update.name = renamed;
      }
    }

    try {
      await this.updateColumnsByIdWithoutHooks({
        id: row.id,
        data: update,
        expectedData: {
          dbSystem: previousSystem,
        },
        // Recording stronger evidence for the same engine is bookkeeping.
        skipUpdateDateColumn: !engineChanged,
      });
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not update the engine of database ${row.id.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return;
    }

    row.dbSystemSource = decision.evidence;

    if (!engineChanged) {
      return;
    }

    row.dbSystem = decision.system;

    if (update.name) {
      row.name = update.name as string;
    }

    await this.writeEngineCorrectedFeed({
      row: row,
      previousSystem: previousSystem,
      evidence: decision.evidence,
    });
  }

  private async writeEngineCorrectedFeed(data: {
    row: Model;
    previousSystem: string;
    evidence: DatabaseSystemEvidence;
  }): Promise<void> {
    const row: Model = data.row;

    if (!row.id || !row.projectId) {
      return;
    }

    try {
      logger.info(
        `DatabaseServerService: database ${row.id.toString()} is now identified as ${row.dbSystem} (was ${data.previousSystem}), from ${data.evidence} evidence.`,
        { projectId: row.projectId.toString() } as LogAttributes,
      );

      await DatabaseServerFeedService.createDatabaseServerFeedItem({
        databaseServerId: row.id,
        projectId: row.projectId,
        databaseServerFeedEventType:
          DatabaseServerFeedEventType.DatabaseServerUpdated,
        displayColor: Gray500,
        feedInfoInMarkdown: `🔎 ${await this.getDatabaseServerMarkdownLink(
          row.projectId,
          row.id,
        )} is now identified as **${getDatabaseSystemDisplayName(
          row.dbSystem,
        )}** (it was shown as ${getDatabaseSystemDisplayName(
          data.previousSystem,
        )}), from ${DATABASE_SYSTEM_EVIDENCE_LABEL[data.evidence]}.`,
        moreInformationInMarkdown: `Client libraries of wire-compatible databases report the engine they speak to, so a database first seen in application traces can be named after the wrong engine. A stronger source - a container image, a collector receiver or the Database Agent - corrects it, and a fork (MariaDB, Valkey, ScyllaDB ...) refines the engine it forks. An engine a person chose is never changed.`,
      });
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not record the engine change of database ${row.id.toString()}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private isCollectorFresh(row: Model, now: Date): boolean {
    if (!row.collectorLastSeenAt) {
      return false;
    }

    return (
      new Date(row.collectorLastSeenAt).getTime() >
      OneUptimeDate.addRemoveMinutes(
        now,
        -this.getCollectorStaleThresholdMinutes(),
      ).getTime()
    );
  }

  /*
   * True when the workload path wrote this row within
   * WORKLOAD_REFRESH_MINUTES: both liveness stamps it writes are that fresh.
   */
  private isWorkloadRowFresh(row: Model, now: Date): boolean {
    const freshAfter: number = OneUptimeDate.addRemoveMinutes(
      now,
      -WORKLOAD_REFRESH_MINUTES,
    ).getTime();

    for (const stamp of [row.lastSeenAt, row.workloadLastSeenAt]) {
      const time: number = stamp ? new Date(stamp).getTime() : NaN;

      if (!Number.isFinite(time) || time <= freshAfter) {
        return false;
      }
    }

    return true;
  }

  /*
   * True for the row of a Kubernetes / Docker / Podman workload that
   * discovery has not seen for WORKLOAD_GONE_MINUTES: its endpoints may move
   * to the workload that replaced it, and a trace still naming one of them
   * does not bring the row back from the archive.
   */
  private isWorkloadGone(
    row: Model,
    now: Date = OneUptimeDate.getCurrentDate(),
  ): boolean {
    if (!row.workloadIdentifier) {
      return false;
    }

    if (!row.workloadLastSeenAt) {
      return true;
    }

    return (
      new Date(row.workloadLastSeenAt).getTime() <
      OneUptimeDate.addRemoveMinutes(now, -WORKLOAD_GONE_MINUTES).getTime()
    );
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

  // endpoint -> the stored endpoint row, for the endpoints that have one.
  private async findEndpointOwners(
    projectId: ObjectID,
    endpoints: Array<string>,
  ): Promise<Map<string, StoredEndpoint>> {
    const owners: Map<string, StoredEndpoint> = new Map<
      string,
      StoredEndpoint
    >();

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
          source: true,
          isPrimary: true,
          lastMatchedAt: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const endpointRow of rows) {
      if (endpointRow.endpoint && endpointRow.databaseServerId) {
        owners.set(endpointRow.endpoint, {
          endpointId: endpointRow._id
            ? new ObjectID(endpointRow._id.toString())
            : null,
          databaseServerId: endpointRow.databaseServerId.toString(),
          source: endpointRow.source || "auto",
          isPrimary: Boolean(endpointRow.isPrimary),
          lastMatchedAt: endpointRow.lastMatchedAt
            ? new Date(endpointRow.lastMatchedAt)
            : null,
        });
      }
    }

    return owners;
  }

  /*
   * The row of the SAME workload stored under another identifier of its
   * engine family. Identifiers are family-keyed
   * (buildWorkloadDatabaseServerIdentifier: a Valkey workload keys as
   * `redis|...`), so a workload re-classified within its family (Redis to
   * Valkey, MySQL to MariaDB) keeps its identifier and never gets here. What
   * does get here is a row written under the old ENGINE-keyed identifiers
   * (`valkey|...`, `mariadb|...`), whatever engine the workload reports
   * now - the fork itself included. Without this adoption it would become a
   * second database: a new row with none of the endpoints, history, labels
   * or incident links of the old one. Instead the old row is re-keyed to the
   * family key (a compare-and-set, like adoption) and the engine evidence is
   * weighed as usual. Two candidates is ambiguous and adopts neither.
   */
  private async adoptSameWorkloadOfEngineFamily(data: {
    projectId: ObjectID;
    workloadIdentifier: string;
    dbSystem: string;
  }): Promise<Model | null> {
    const separator: number = data.workloadIdentifier.indexOf("|");

    if (separator <= 0) {
      return null;
    }

    const workload: string = data.workloadIdentifier.substring(separator + 1);
    // Every engine of the family - the reported one too - but the key itself.
    const candidates: Array<string> = getDatabaseSystemsOfFamily(data.dbSystem)
      .map((system: string): string => {
        return truncateLongText(`${system}|${workload}`.toLowerCase());
      })
      .filter((candidate: string): boolean => {
        return candidate !== data.workloadIdentifier;
      });

    if (candidates.length === 0) {
      return null;
    }

    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        workloadIdentifier: QueryHelper.any(candidates),
      },
      select: {
        _id: true,
        workloadIdentifier: true,
      },
      limit: 2,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    if (rows.length !== 1 || !rows[0]!.id || !rows[0]!.workloadIdentifier) {
      return null;
    }

    const previousId: ObjectID = rows[0]!.id!;
    const previousWorkload: string = rows[0]!.workloadIdentifier!;

    try {
      await this.updateColumnsByIdWithoutHooks({
        id: previousId,
        data: {
          workloadIdentifier: data.workloadIdentifier,
        },
        expectedData: {
          workloadIdentifier: previousWorkload,
        },
      });

      logger.info(
        `DatabaseServerService: workload ${previousWorkload} is now ${data.workloadIdentifier} - the same workload under an engine of the same family; database ${previousId.toString()} kept.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.debug(
        `DatabaseServerService: re-keying database ${previousId.toString()} to workload ${data.workloadIdentifier} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Whatever happened, the workload index now holds the truth.
    return await this.findByWorkloadIdentifier(
      data.projectId,
      data.workloadIdentifier,
    );
  }

  private async adoptEndpointDatabaseServer(data: {
    projectId: ObjectID;
    workloadIdentifier: string;
    aliases: Array<WorkloadAlias>;
    ownersByEndpoint: Map<string, StoredEndpoint>;
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
      )?.databaseServerId;

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
    newRow.workloadLastSeenAt = now;
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

  /*
   * Reconcile the workload's endpoints with the aliases this run produced:
   *   1. claim the unowned ones (source "workload");
   *   2. take over the ones a DISCOVERED endpoint of another row holds when
   *      that row is a workload that is gone (a Deployment moved to a
   *      StatefulSet, an engine reclassified) or an untouched duplicate that
   *      application traces created (the create race) - never a person's
   *      endpoint, never a live workload's, collector's or manual row's;
   *   3. re-stamp lastMatchedAt on the ones already ours (at most hourly);
   *   4. release this row's "workload" aliases that the workload has not
   *      produced for WORKLOAD_ALIAS_RELEASE_MINUTES - an unqualified alias
   *      once the project gained a second cluster, a Service that was
   *      renamed. Never its primary endpoint, never an "auto" or "user" one.
   * Each step is best-effort: one failing never stops the next.
   */
  private async claimWorkloadAliases(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    workloadIdentifier: string;
    discoverySource: DatabaseServerDiscoverySource;
    aliases: Array<WorkloadAlias>;
    ownersByEndpoint: Map<string, StoredEndpoint>;
    primaryEndpoint: string | undefined;
    now: Date;
  }): Promise<void> {
    const ownId: string = data.databaseServerId.toString();
    const refreshBefore: Date = OneUptimeDate.addRemoveSeconds(
      data.now,
      -ENDPOINT_MATCH_REFRESH_SECONDS,
    );

    const heldByOthers: Array<HeldAlias> = [];
    const racedByOthers: Array<string> = [];
    const ownedToRefresh: Array<string> = [];
    let primaryClaimed: boolean = false;

    for (const alias of data.aliases) {
      const stored: StoredEndpoint | undefined = data.ownersByEndpoint.get(
        alias.endpoint,
      );

      if (stored && stored.databaseServerId === ownId) {
        if (
          !stored.lastMatchedAt ||
          stored.lastMatchedAt.getTime() < refreshBefore.getTime()
        ) {
          ownedToRefresh.push(alias.endpoint);
        }
        continue;
      }

      if (stored) {
        heldByOthers.push({ alias: alias, stored: stored });
        continue;
      }

      try {
        const isPrimary: boolean = alias.endpoint === data.primaryEndpoint;
        const result: DatabaseServerEndpointClaimResult =
          await DatabaseServerEndpointService.claimEndpoint({
            projectId: data.projectId,
            databaseServerId: data.databaseServerId,
            endpoint: alias.endpoint,
            isPrimary: isPrimary,
            source: "workload",
          });

        if (result === "owned-by-other") {
          racedByOthers.push(alias.endpoint);
        } else if (result === "claimed" && isPrimary) {
          primaryClaimed = true;
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

    let notTaken: Array<string> = heldByOthers.map(
      (held: HeldAlias): string => {
        return held.alias.endpoint;
      },
    );

    try {
      notTaken = await this.takeOverWorkloadAliases({
        projectId: data.projectId,
        databaseServerId: data.databaseServerId,
        workloadIdentifier: data.workloadIdentifier,
        heldByOthers: heldByOthers,
        /*
         * A row created in this run whose first alias could not be claimed
         * has no primary endpoint yet; any other row is asked (lazily).
         */
        needsPrimary: data.primaryEndpoint ? !primaryClaimed : undefined,
        now: data.now,
      });
    } catch (error) {
      logger.warn(
        `DatabaseServerService: taking over endpoints for workload ${data.workloadIdentifier} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }

    if (ownedToRefresh.length > 0) {
      try {
        await DatabaseServerEndpointService.refreshMatchedEndpoints({
          projectId: data.projectId,
          databaseServerId: data.databaseServerId,
          endpoints: ownedToRefresh,
          now: data.now,
          staleBefore: refreshBefore,
        });
      } catch (error) {
        logger.warn(
          `DatabaseServerService: refreshing endpoints of workload ${data.workloadIdentifier} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
      }
    }

    // Only Kubernetes workloads produce aliases, so only they can drop one.
    if (data.discoverySource === DatabaseServerDiscoverySource.Kubernetes) {
      try {
        const released: Array<string> =
          await DatabaseServerEndpointService.releaseUnproducedWorkloadEndpoints(
            {
              projectId: data.projectId,
              databaseServerId: data.databaseServerId,
              keepEndpoints: data.aliases.map(
                (alias: WorkloadAlias): string => {
                  return alias.endpoint;
                },
              ),
              staleBefore: OneUptimeDate.addRemoveMinutes(
                data.now,
                -WORKLOAD_ALIAS_RELEASE_MINUTES,
              ),
            },
          );

        if (released.length > 0) {
          logger.info(
            `DatabaseServerService: released ${released.length} endpoint(s) workload ${data.workloadIdentifier} no longer serves: ${released.join(", ")}`,
            { projectId: data.projectId.toString() } as LogAttributes,
          );
        }
      } catch (error) {
        logger.warn(
          `DatabaseServerService: releasing endpoints of workload ${data.workloadIdentifier} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
      }
    }

    const ownedByOthers: Array<string> = [...notTaken, ...racedByOthers];

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

  /*
   * Step 2 of claimWorkloadAliases. Returns the aliases left with their
   * current owners.
   */
  private async takeOverWorkloadAliases(data: {
    projectId: ObjectID;
    databaseServerId: ObjectID;
    workloadIdentifier: string;
    heldByOthers: Array<HeldAlias>;
    needsPrimary: boolean | undefined;
    now: Date;
  }): Promise<Array<string>> {
    const notTaken: Array<string> = [];
    const candidates: Array<HeldAlias> = [];

    for (const held of data.heldByOthers) {
      if (held.stored.source === "user" || !held.stored.endpointId) {
        notTaken.push(held.alias.endpoint);
      } else {
        candidates.push(held);
      }
    }

    if (candidates.length === 0) {
      return notTaken;
    }

    const ownerIds: Array<string> = Array.from(
      new Set<string>(
        candidates.map((held: HeldAlias): string => {
          return held.stored.databaseServerId;
        }),
      ),
    );

    const owners: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(ownerIds),
      },
      select: {
        _id: true,
        workloadIdentifier: true,
        workloadLastSeenAt: true,
        discoverySource: true,
      },
      limit: ownerIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const ownersById: Map<string, Model> = new Map<string, Model>();

    for (const owner of owners) {
      if (owner.id) {
        ownersById.set(owner.id.toString(), owner);
      }
    }

    const traceDuplicateIds: Set<string> = await this.findUntouchedTraceRows(
      data.projectId,
      owners
        .filter((owner: Model): boolean => {
          return (
            Boolean(owner.id) &&
            !owner.workloadIdentifier &&
            owner.discoverySource === DatabaseServerDiscoverySource.ClientSpans
          );
        })
        .map((owner: Model): string => {
          return owner.id!.toString();
        }),
    );

    let needsPrimary: boolean | undefined = data.needsPrimary;

    for (const held of candidates) {
      const owner: Model | undefined = ownersById.get(
        held.stored.databaseServerId,
      );

      const goneWorkload: boolean = Boolean(
        owner &&
          owner.workloadIdentifier &&
          owner.workloadIdentifier !== data.workloadIdentifier &&
          this.isWorkloadGone(owner, data.now),
      );
      const traceDuplicate: boolean = traceDuplicateIds.has(
        held.stored.databaseServerId.toLowerCase(),
      );

      if (!goneWorkload && !traceDuplicate) {
        notTaken.push(held.alias.endpoint);
        continue;
      }

      if (needsPrimary === undefined) {
        needsPrimary = !(await DatabaseServerEndpointService.hasPrimaryEndpoint(
          {
            projectId: data.projectId,
            databaseServerId: data.databaseServerId,
          },
        ));
      }

      const moved: boolean =
        await DatabaseServerEndpointService.transferEndpoint({
          projectId: data.projectId,
          endpointId: held.stored.endpointId!,
          fromDatabaseServerId: new ObjectID(held.stored.databaseServerId),
          toDatabaseServerId: data.databaseServerId,
          isPrimary: needsPrimary,
          now: data.now,
        });

      if (!moved) {
        notTaken.push(held.alias.endpoint);
        continue;
      }

      needsPrimary = false;

      logger.info(
        `DatabaseServerService: moved endpoint ${held.alias.endpoint} from database ${held.stored.databaseServerId} (${
          goneWorkload
            ? "its workload is gone"
            : "an untouched duplicate application traces created"
        }) to workload ${data.workloadIdentifier}.`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );
    }

    return notTaken;
  }

  /*
   * Of `databaseServerIds`, the trace-discovered rows nobody invested in
   * (UNTOUCHED_DATABASE_SERVER_PREDICATE): duplicates of a workload whose
   * endpoints the workload may take over.
   */
  private async findUntouchedTraceRows(
    projectId: ObjectID,
    databaseServerIds: Array<string>,
  ): Promise<Set<string>> {
    if (databaseServerIds.length === 0) {
      return new Set<string>();
    }

    const rows: unknown = await this.getRepository().manager.query(
      `SELECT ds."_id" AS "_id"
        FROM "DatabaseServer" ds
        WHERE ds."projectId" = $1
          AND ds."_id" = ANY($2::uuid[])
          AND ds."deletedAt" IS NULL
          AND ds."workloadIdentifier" IS NULL
          AND ds."discoverySource" = $3
          AND ${UNTOUCHED_DATABASE_SERVER_PREDICATE}`,
      [
        projectId.toString(),
        databaseServerIds,
        DatabaseServerDiscoverySource.ClientSpans,
      ],
    );

    const ids: Set<string> = new Set<string>();

    for (const row of Array.isArray(rows) ? rows : []) {
      const id: unknown = (row as { _id?: unknown })?._id;
      if (id) {
        ids.add(String(id).toLowerCase());
      }
    }

    return ids;
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
     * other source leaves otelCollectorStatus empty - no collector has
     * reported, so none has "disconnected" either (the column has no
     * default).
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
      // Same engine family + endpoint created by a racing writer.
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
        // The same sighting findOrCreateByEndpoint gives an owner it finds first.
        const evidence: DatabaseSystemEvidence | null =
          getDatabaseSystemEvidenceForSource(data.discoverySource);

        if (evidence) {
          await this.applyDatabaseSystemEvidence(ownerRow, {
            system: data.dbSystem,
            evidence: evidence,
          });
        }

        if (!this.isWorkloadGone(ownerRow)) {
          await this.restoreIfAutoArchived(ownerRow);
        }
      }

      return ownerRow;
    }

    if (createdHere) {
      this.noteAutoCreated(data.projectId);
      this.runCreatedSideEffects(row, undefined);
    } else {
      await this.restoreIfAutoArchived(row);
    }

    return row;
  }

  /*
   * The collector path's budget gate (see findOrCreateByEndpoint): false
   * when the project has reached its auto-create budget - warned about once
   * per project per ten minutes, since ingest would otherwise repeat it for
   * every batch - or when the count cannot be read (fail closed, like the
   * workers' AutoCreateBudget).
   */
  private async allowsCollectorAutoCreate(
    projectId: ObjectID,
    formattedEndpoint: string,
  ): Promise<boolean> {
    let underBudget: boolean = false;

    try {
      underBudget = await this.isUnderAutoCreateBudgetCached(projectId);
    } catch (error) {
      logger.error(
        `DatabaseServerService: auto-create budget check failed for project ${projectId.toString()}; not creating a database for collector endpoint ${formattedEndpoint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: projectId.toString() } as LogAttributes,
      );

      return false;
    }

    if (!underBudget) {
      const key: string = projectId.toString();

      if (!this.autoCreateBudgetWarningMemo.get(key)) {
        this.autoCreateBudgetWarningMemo.set(key, true);

        logger.warn(
          `DatabaseServerService: project ${key} reached its auto-create budget (DATABASE_SERVER_AUTO_CREATE_BUDGET=${this.getAutoCreateBudget()}); not creating a database for collector endpoint ${formattedEndpoint} (and further new collector endpoints for the next ten minutes). Raise the budget, or add the database manually and link its agent with DATABASE_SERVER_ID.`,
          { projectId: key } as LogAttributes,
        );
      }
    }

    return underBudget;
  }

  // A row was auto-created: count it against the cached budget straight away.
  private noteAutoCreated(projectId: ObjectID): void {
    const key: string = projectId.toString();
    const cached: AutoCreateCount | undefined =
      this.autoCreateCountMemo.get(key);

    if (!cached) {
      return;
    }

    const remainingMs: number =
      cached.readAtMs + AUTO_CREATE_BUDGET_CACHE_MS - Date.now();

    if (remainingMs <= 0) {
      this.autoCreateCountMemo.delete(key);
      return;
    }

    this.autoCreateCountMemo.set(
      key,
      { count: cached.count + 1, readAtMs: cached.readAtMs },
      remainingMs,
    );
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
    props: DatabaseCommonInteractionProps;
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
        ? await getOwnedByOtherDatabaseMessage(data.endpoint, owner, data.props)
        : `${data.endpoint} already belongs to another database. An endpoint can belong to only one database in a project.`,
    );
  }

  /*
   * A Kubernetes Service name typed without its cluster
   * (`pg.shop.svc.cluster.local`, no `@<cluster>`) in a project that has
   * Kubernetes clusters. Pods whose telemetry goes through the Kubernetes
   * agent report their cluster, so their calls are keyed
   * `<endpoint>@<cluster>`: a row holding only the unqualified name would
   * stay empty while discovery creates a second row for the qualified one.
   * The person is asked to name the cluster instead, from the project's own
   * cluster names.
   *
   * Only Service names: a private IP or a private-zone name (`.internal`,
   * `.local`) is also what virtual machines and the Database Agent report,
   * unqualified, so it stays a valid manual endpoint. And only in a project
   * with clusters - without one, nothing could report the qualified form.
   * If the clusters cannot be read the create goes ahead: the advice is not
   * worth failing the create for.
   */
  private async refuseUnqualifiedKubernetesServiceName(data: {
    projectId: ObjectID;
    manual: ManualDatabaseEndpoint;
    serverAddress: unknown;
    serverPort: unknown;
    dbSystem: string;
  }): Promise<void> {
    const endpoint: DatabaseEndpoint | null = data.manual.endpoint;

    if (
      !endpoint ||
      !data.manual.clusterQualifierHint ||
      !isKubernetesServiceDnsHost(endpoint.host)
    ) {
      return;
    }

    let clusterNames: Array<string> = [];

    try {
      clusterNames = await this.findKubernetesClusterNames(data.projectId);
    } catch (error) {
      logger.warn(
        `DatabaseServerService: could not read the Kubernetes clusters of project ${data.projectId.toString()}; adding ${formatDatabaseEndpoint(endpoint)} unqualified: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { projectId: data.projectId.toString() } as LogAttributes,
      );

      return;
    }

    if (clusterNames.length === 0) {
      return;
    }

    // The same value again, now with the cluster names the advice lists.
    const advice: string | null = parseManualDatabaseEndpoint(
      data.serverAddress,
      {
        system: data.dbSystem,
        port: data.serverPort,
        knownClusterNames: clusterNames,
      },
    ).clusterQualifierHint;

    throw new BadDataException(
      `${advice || data.manual.clusterQualifierHint} To also match a Database Agent or applications that do not report their cluster, add ${formatDatabaseEndpoint(
        endpoint,
      )} as an endpoint on the database's Endpoints tab once it is created.`,
    );
  }

  // The project's Kubernetes cluster names (k8s.cluster.name), a few, sorted.
  private async findKubernetesClusterNames(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const rows: unknown = await this.getRepository().manager.query(
      `SELECT DISTINCT kc."clusterIdentifier" AS "clusterIdentifier"
        FROM "KubernetesCluster" kc
        WHERE kc."projectId" = $1
          AND kc."deletedAt" IS NULL
          AND kc."clusterIdentifier" IS NOT NULL
          AND kc."clusterIdentifier" <> ''
        ORDER BY kc."clusterIdentifier" ASC
        LIMIT $2`,
      [projectId.toString(), MAX_LISTED_CLUSTER_NAMES],
    );

    const names: Array<string> = [];

    for (const row of Array.isArray(rows) ? rows : []) {
      const name: unknown = (row as { clusterIdentifier?: unknown })
        ?.clusterIdentifier;

      if (typeof name === "string" && name.trim()) {
        names.push(name.trim());
      }
    }

    return names;
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

  /*
   * A person archived (restored = false) or restored a row: it is no longer
   * discovery's archive (autoArchivedAt cleared), and a restore is stamped
   * so the sweep leaves the row alone until it is seen again or the grace
   * period passes (manuallyRestoredAt; cleared again on an archive).
   */
  private async recordArchiveDecisionByPerson(
    databaseServerIds: Array<ObjectID>,
    restored: boolean,
  ): Promise<void> {
    const now: Date = OneUptimeDate.getCurrentDate();

    for (const databaseServerId of databaseServerIds) {
      try {
        await this.updateColumnsByIdWithoutHooks({
          id: databaseServerId,
          data: {
            autoArchivedAt: null,
            manuallyRestoredAt: restored ? now : null,
          },
          skipUpdateDateColumn: true,
        });
      } catch (error) {
        logger.warn(
          `DatabaseServerService: could not record the ${
            restored ? "restore" : "archive"
          } of database ${databaseServerId.toString()}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  private async recordDatabaseSystemSetByPerson(
    databaseServerIds: Array<ObjectID>,
  ): Promise<void> {
    for (const databaseServerId of databaseServerIds) {
      try {
        await this.updateColumnsByIdWithoutHooks({
          id: databaseServerId,
          data: {
            dbSystemSource: DatabaseSystemEvidence.Manual,
          },
          skipUpdateDateColumn: true,
        });
      } catch (error) {
        logger.warn(
          `DatabaseServerService: could not record the engine a person set on database ${databaseServerId.toString()}: ${
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

  /*
   * The throttled part of a collector heartbeat (see recordCollectorHeartbeat):
   * one primary-key read per database per window, fleet-wide, then the
   * auto-archive restore and the engine evidence.
   */
  private async reconcileAfterHeartbeat(
    databaseServerId: ObjectID,
    reportedSystem: string | undefined,
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
        select: DISCOVERY_SELECT,
        props: {
          isRoot: true,
        },
      });

      if (row) {
        if (reportedSystem) {
          await this.applyDatabaseSystemEvidence(row, {
            system: reportedSystem,
            evidence: DatabaseSystemEvidence.Collector,
          });
        }

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
        } while the Kubernetes cluster or container host it was found on (if any) kept reporting, and nobody has labelled it, owned it, linked it to an incident, alert or scheduled maintenance, added an endpoint to it, changed its retention or recently restored it from the archive. Labels and owners that rules or telemetry attached on their own do not count. It is restored automatically as soon as it is seen again.`,
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
 * The endpoint a person typed into the create form, read by
 * parseManualDatabaseEndpoint: the port field, when filled, replaces any
 * port in the address (and a SQL Server `\instance`), the engine's default
 * port fills a missing one, and a value that cannot be used is refused with
 * a message saying what to change. The result always has an endpoint.
 */
function parseManualEndpoint(data: {
  serverAddress: unknown;
  serverPort: unknown;
  dbSystem: string;
}): ManualDatabaseEndpoint {
  const manual: ManualDatabaseEndpoint = parseManualDatabaseEndpoint(
    data.serverAddress,
    {
      system: data.dbSystem,
      port: data.serverPort,
    },
  );

  if (!manual.endpoint) {
    throw new BadDataException(
      manual.error ||
        "Enter the host name or IP address applications use to reach this database, for example orders-db.example.com:5432.",
    );
  }

  return manual;
}

/*
 * True when writing `update` (the workload path's columns) would change the
 * row beyond its liveness: a member key added or aged out, the instance
 * count, the version, the workload's kind / name / namespace / parent, or
 * the engine. lastSeenAt / workloadLastSeenAt and the member keys' own
 * timestamps are liveness, refreshed at least every
 * WORKLOAD_REFRESH_MINUTES anyway.
 */
export function workloadColumnsChanged(
  row: Model,
  update: Record<string, unknown>,
): boolean {
  for (const [column, value] of Object.entries(update)) {
    if (column === "lastSeenAt" || column === "workloadLastSeenAt") {
      continue;
    }

    if (column === "memberEntityKeys") {
      if (!hasSameMemberKeys(row.memberEntityKeys, value)) {
        return true;
      }
      continue;
    }

    if (
      !isSameColumnValue(
        (row as unknown as Record<string, unknown>)[column],
        value,
      )
    ) {
      return true;
    }
  }

  return false;
}

// An id compares by its text (ObjectID or string), anything else strictly.
function isSameColumnValue(current: unknown, next: unknown): boolean {
  if (current instanceof ObjectID || next instanceof ObjectID) {
    return (
      current !== null &&
      current !== undefined &&
      next !== null &&
      next !== undefined &&
      String(current).toLowerCase() === String(next).toLowerCase()
    );
  }

  return current === next;
}

// The same member keys, whatever their timestamps.
function hasSameMemberKeys(stored: unknown, merged: unknown): boolean {
  const keysOf: (value: unknown) => Array<string> = (
    value: unknown,
  ): Array<string> => {
    return value && typeof value === "object" && !Array.isArray(value)
      ? Object.keys(value as Record<string, unknown>).sort()
      : [];
  };

  const storedKeys: Array<string> = keysOf(stored);
  const mergedKeys: Array<string> = keysOf(merged);

  return (
    storedKeys.length === mergedKeys.length &&
    storedKeys.every((key: string, index: number): boolean => {
      return key === mergedKeys[index];
    })
  );
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

/**
 * The evidence a discovery source's own engine report carries: what the
 * collector path, the trace path and the container paths each know. A row's
 * discoverySource read through this is the evidence its engine was first
 * set from.
 */
export function getDatabaseSystemEvidenceForSource(
  source: string | null | undefined,
): DatabaseSystemEvidence | null {
  switch (source) {
    case DatabaseServerDiscoverySource.Manual:
      return DatabaseSystemEvidence.Manual;
    case DatabaseServerDiscoverySource.Collector:
      return DatabaseSystemEvidence.Collector;
    case DatabaseServerDiscoverySource.Kubernetes:
    case DatabaseServerDiscoverySource.Docker:
    case DatabaseServerDiscoverySource.Podman:
      return DatabaseSystemEvidence.Container;
    case DatabaseServerDiscoverySource.ClientSpans:
      return DatabaseSystemEvidence.ClientSpans;
    default:
      return null;
  }
}

/*
 * The evidence behind a row's current engine: dbSystemSource once anything
 * refined it, else the source that created the row.
 */
export function getStoredDatabaseSystemEvidence(row: {
  dbSystemSource?: string | undefined;
  discoverySource?: string | undefined;
}): DatabaseSystemEvidence | null {
  const stored: string | undefined = row.dbSystemSource;

  if (
    stored &&
    Object.values(DatabaseSystemEvidence).includes(
      stored as DatabaseSystemEvidence,
    )
  ) {
    return stored as DatabaseSystemEvidence;
  }

  return getDatabaseSystemEvidenceForSource(row.discoverySource);
}

/**
 * The engine (and the evidence for it) a row should carry once `incoming`
 * evidence arrives, or null to leave the row as it is:
 *   - an engine a person chose is never changed;
 *   - within one family, SPECIFICITY decides, whatever the source - the
 *     rule getMoreSpecificDatabaseSystem encodes, and the one the docs
 *     describe: a fork refines the family's own engine (mysql -> mariadb,
 *     postgresql -> cockroachdb), because a client, an image or a receiver
 *     can each be the only one that knows; and the family's engine never
 *     undoes a fork, because a client or a family receiver cannot tell them
 *     apart (a span or the mysql receiver saying "mysql" leaves MariaDB);
 *   - any other different engine - another family, a sibling fork, an
 *     unknown engine - replaces the current one only on strictly stronger
 *     evidence (the image says CockroachDB where a client said MySQL);
 *     equal or weaker evidence never flips it back and forth;
 *   - the same engine on stronger evidence keeps the engine but records the
 *     stronger evidence, so weaker evidence cannot move it later.
 * A row with no engine takes the incoming one. Pure.
 */
export function decideDatabaseSystem(data: {
  current: {
    system: string | null | undefined;
    evidence: DatabaseSystemEvidence | null;
  };
  incoming: {
    system: string | null | undefined;
    evidence: DatabaseSystemEvidence;
  };
}): DatabaseSystemDetermination | null {
  const incomingSystem: string | null = cleanShortText(
    normalizeDatabaseSystem(data.incoming.system),
  );

  if (!incomingSystem) {
    return null;
  }

  const incoming: DatabaseSystemDetermination = {
    system: incomingSystem,
    evidence: data.incoming.evidence,
  };

  const currentSystem: string | null = normalizeDatabaseSystem(
    data.current.system,
  );

  if (!currentSystem) {
    return incoming;
  }

  if (data.current.evidence === DatabaseSystemEvidence.Manual) {
    return null;
  }

  const currentRank: number = data.current.evidence
    ? DATABASE_SYSTEM_EVIDENCE_RANK[data.current.evidence]
    : 0;
  const incomingRank: number = DATABASE_SYSTEM_EVIDENCE_RANK[incoming.evidence];

  if (incomingSystem === currentSystem) {
    return incomingRank > currentRank
      ? { system: currentSystem, evidence: incoming.evidence }
      : null;
  }

  // The incoming engine is a fork of the current one: a refinement.
  if (
    getMoreSpecificDatabaseSystem(currentSystem, incomingSystem) ===
    incomingSystem
  ) {
    return incoming;
  }

  // The current engine is a fork of the incoming one: never undone.
  if (
    getMoreSpecificDatabaseSystem(incomingSystem, currentSystem) ===
    currentSystem
  ) {
    return null;
  }

  return incomingRank > currentRank ? incoming : null;
}

/**
 * The row's name for a new engine - but only when the row still carries the
 * name discovery generated for its old engine (endpoint form "PostgreSQL
 * db:5432" or workload form "PostgreSQL ns/name"). A name a person chose is
 * kept: null.
 */
export function renameForDatabaseSystem(
  row: {
    name?: string | undefined;
    dbSystem?: string | undefined;
    serverAddress?: string | undefined;
    serverPort?: number | undefined;
    kubernetesNamespace?: string | undefined;
    workloadName?: string | undefined;
  },
  newSystem: string,
): string | null {
  const name: string = typeof row.name === "string" ? row.name.trim() : "";

  if (!name || !row.dbSystem) {
    return null;
  }

  const forms: Array<{
    endpoint?: DatabaseEndpoint | undefined;
    namespace?: string | undefined;
    workloadName?: string | undefined;
  }> = [];

  if (row.serverAddress) {
    forms.push({
      endpoint: {
        host: row.serverAddress,
        port:
          typeof row.serverPort === "number" && row.serverPort > 0
            ? row.serverPort
            : null,
      },
    });
  }

  if (row.workloadName) {
    forms.push({
      namespace: row.kubernetesNamespace,
      workloadName: row.workloadName,
    });
  }

  for (const form of forms) {
    const generated: string = truncateShortText(
      buildDatabaseServerDisplayName({ system: row.dbSystem, ...form }),
    );

    if (generated === name) {
      const renamed: string = truncateShortText(
        buildDatabaseServerDisplayName({ system: newSystem, ...form }),
      );

      return renamed !== name ? renamed : null;
    }
  }

  return null;
}

/*
 * Every catalogued engine of `system`'s family, the family's own engine
 * first ("valkey" -> redis, valkey, keydb, ...). An engine outside the
 * catalog is a family of one.
 */
export function getDatabaseSystemsOfFamily(system: string): Array<string> {
  const family: string | null = getDatabaseSystemFamily(system);

  if (!family) {
    return [];
  }

  const systems: Array<string> = [family];

  for (const descriptor of DATABASE_SYSTEMS as ReadonlyArray<DatabaseSystemDescriptor>) {
    if (
      (descriptor.family || descriptor.system) === family &&
      !systems.includes(descriptor.system)
    ) {
      systems.push(descriptor.system);
    }
  }

  return systems;
}

/*
 * The ids in a relation payload (an update's `labels`): model instances,
 * `{ _id }` / `{ id }` objects, ObjectIDs or id strings. Anything else is
 * skipped.
 */
function readRelationIds(value: unknown): Array<string> {
  const ids: Array<string> = [];

  for (const item of Array.isArray(value) ? value : []) {
    let id: unknown = item;

    if (item && typeof item === "object" && !(item instanceof ObjectID)) {
      id =
        (item as { _id?: unknown; id?: unknown })._id ||
        (item as { _id?: unknown; id?: unknown }).id;
    }

    const text: string =
      id instanceof ObjectID || typeof id === "string" ? id.toString() : "";

    if (text) {
      ids.push(text);
    }
  }

  return ids;
}

/*
 * Assignment ids as automaticAssignments stores them: lowercase UUID strings
 * (what Postgres prints for a uuid column), deduped, invalid ones dropped.
 */
function normalizeAssignmentIds(ids: Array<ObjectID | string>): Array<string> {
  const result: Array<string> = [];

  for (const id of Array.isArray(ids) ? ids : []) {
    const text: string = (id ? id.toString() : "").trim().toLowerCase();

    if (text && ObjectID.isValidUUID(text) && !result.includes(text)) {
      result.push(text);
    }
  }

  return result;
}

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha256").update(sorted.join(",")).digest("hex");
}

export default new Service();
