import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/CloudResource";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ReceivingCoverage from "../Utils/Telemetry/ReceivingCoverage";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DiscoveredResourceCreate, {
  DiscoveredResourceNaming,
  namedAfterCloudEnvironment,
} from "../Utils/Telemetry/DiscoveredResourceCreate";
import CloudResourceFeedService from "./CloudResourceFeedService";
import { CloudResourceFeedEventType } from "../../Models/DatabaseModels/CloudResourceFeed";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import DatabaseConfig from "../DatabaseConfig";
import CloudResourceLabelRuleEngineService from "./CloudResourceLabelRuleEngineService";
import CloudResourceOwnerRuleEngineService from "./CloudResourceOwnerRuleEngineService";
import InProcessMemo from "../Utils/InProcessMemo";
import PartialEntity from "../../Types/Database/PartialEntity";
import { CloudResourceKind } from "../../Types/Cloud/CloudResourceKind";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  getCloudMonitoredResourceNameCandidates,
} from "../../Types/Cloud/CloudMonitoredResource";
import { mdText, MarkdownText } from "../../Utils/Markdown/FeedMarkdown";

const LAST_SEEN_CACHE_NAMESPACE: string = "cloud-resource-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "cloud-resource-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * An environment's telemetry is its workloads' own, sent continuously: it
 * reads "disconnected" 15 minutes after the last batch (well above the
 * 5-minute ingest maintenance fence - see markDisconnectedResources).
 */
export const CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES: number = 15;

/*
 * A resource's metrics are a collector polling the provider's monitoring
 * API - every minute for Azure Monitor and Cloud Monitoring, every five for
 * CloudWatch by default - and a quiet resource can skip a poll or several:
 * Azure Monitor returns nothing for an hour of a Key Vault nobody called.
 * An hour without a single datapoint is what "not reporting" means here.
 */
export const CLOUD_RESOURCE_DISCONNECTED_MINUTES: number = 60;

/*
 * Cloud resources discovered from cloud monitoring. A sighting refreshes the
 * row at most once a minute (and ingest fences it to once per five minutes
 * per resource on top - OtelIngestBaseService).
 */
const MONITORED_RESOURCE_SIGHTING_CACHE_NAMESPACE: string =
  "cloud-monitored-resource-sighting";
const MONITORED_RESOURCE_SIGHTING_THROTTLE_SECONDS: number = 60;

/*
 * A resource the provider no longer reports on - deleted, scaled in, or
 * dropped from the collector's scope - goes out of the list after this many
 * days (CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS), and comes back the moment it
 * reports again.
 */
const DEFAULT_MONITORED_RESOURCE_AUTO_ARCHIVE_DAYS: number = 7;
const MIN_MONITORED_RESOURCE_AUTO_ARCHIVE_DAYS: number = 1;
// Rows archived per sweep; the rest wait for the next five-minute run.
const MONITORED_RESOURCE_AUTO_ARCHIVE_BATCH_SIZE: number = 500;

/*
 * How many live (not archived) discovered resources a project may hold
 * before discovery stops creating more (CLOUD_RESOURCE_AUTO_CREATE_BUDGET).
 * An Azure subscription or an AWS account easily holds thousands of
 * resources; the budget is there so a collector pointed at an entire
 * organisation cannot fill the table without bound.
 */
const DEFAULT_MONITORED_RESOURCE_AUTO_CREATE_BUDGET: number = 5000;

/*
 * The budget count as discovery reads it: one count per project per minute
 * per process, bumped locally by every create in between, so a burst of new
 * resources stops at the budget instead of a minute's worth past it.
 */
const MONITORED_RESOURCE_BUDGET_CACHE_MS: number = 60 * 1000;
// One "budget reached" warning per project per ten minutes per process.
const MONITORED_RESOURCE_BUDGET_WARNING_MS: number = 10 * 60 * 1000;

interface MonitoredResourceCount {
  count: number;
  readAtMs: number;
}

export interface CloudMonitoredResourceFindOrCreateResult {
  // The row, or null when it does not exist and may not be created now.
  cloudResource: Model | null;
  created: boolean;
}

/*
 * An environment is matched to its telemetry by its key (cloud.platform |
 * cloud.account.id | cloud.region), and named after them - "AWS ECS ·
 * us-east-1 · 123456789012" - unless somebody gives it a display name of
 * their own (DiscoveredResourceCreate).
 */
const CLOUD_ENVIRONMENT_NAMING: DiscoveredResourceNaming<Model> =
  namedAfterCloudEnvironment<Model>();

export class Service extends ProjectReferencesService<Model> {
  // Per project: its live discovered-resource count, as last read.
  private monitoredResourceCountMemo: InProcessMemo<MonitoredResourceCount> =
    new InProcessMemo<MonitoredResourceCount>({
      ttlInMs: MONITORED_RESOURCE_BUDGET_CACHE_MS,
      maxEntries: 10_000,
    });

  // Per project: a "budget reached" warning was logged recently.
  private monitoredResourceBudgetWarningMemo: InProcessMemo<boolean> =
    new InProcessMemo<boolean>({
      ttlInMs: MONITORED_RESOURCE_BUDGET_WARNING_MS,
      maxEntries: 10_000,
    });

  public constructor() {
    super(Model);
  }

  // For tests: forget every cached budget count and budget warning.
  public clearMonitoredResourceBudgetMemo(): void {
    this.monitoredResourceCountMemo.clear();
    this.monitoredResourceBudgetWarningMemo.clear();
  }

  // Named the way ingest names it when nobody gave it a name.
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    DiscoveredResourceCreate.fillName({
      createBy,
      naming: CLOUD_ENVIRONMENT_NAMING,
    });

    return { createBy, carryForward: null };
  }

  /*
   * An environment that is already there - discovered from its telemetry or
   * added before - is refused as that environment, not as a clash of names.
   */
  @CaptureSpan()
  protected override async onBeforeCreateUniqueCheck(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    await DiscoveredResourceCreate.refuseClash({
      service: this,
      createBy,
      naming: CLOUD_ENVIRONMENT_NAMING,
    });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await CloudResourceLabelRuleEngineService.applyRulesToCloudResource(
            createdItem,
          );
        })
        .then(async () => {
          await CloudResourceOwnerRuleEngineService.applyRulesToCloudResource(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying cloud resource rules in CloudResourceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              cloudResourceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this cloud resource looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeCloudResourceCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByResourceIdentifier(data: {
    projectId: ObjectID;
    resourceIdentifier: string;
    name?: string | undefined;
    cloudPlatform?: string | undefined;
    cloudProvider?: string | undefined;
    cloudRegion?: string | undefined;
    cloudAccountId?: string | undefined;
  }): Promise<Model> {
    const existingResource: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        resourceIdentifier: QueryHelper.findWithSameText(
          data.resourceIdentifier,
        ),
      },
      select: {
        _id: true,
        projectId: true,
        resourceIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingResource) {
      return existingResource;
    }

    try {
      const newResource: Model = new Model();
      newResource.projectId = data.projectId;
      newResource.name = data.name || data.resourceIdentifier;
      newResource.resourceIdentifier = data.resourceIdentifier;
      newResource.otelCollectorStatus = "connected";
      newResource.lastSeenAt = OneUptimeDate.getCurrentDate();
      if (data.cloudPlatform) {
        newResource.cloudPlatform = data.cloudPlatform;
      }
      if (data.cloudProvider) {
        newResource.cloudProvider = data.cloudProvider;
      }
      if (data.cloudRegion) {
        newResource.cloudRegion = data.cloudRegion;
      }
      if (data.cloudAccountId) {
        newResource.cloudAccountId = data.cloudAccountId;
      }

      const createdResource: Model = await this.create({
        data: newResource,
        props: {
          isRoot: true,
        },
      });

      return createdResource;
    } catch {
      const reFetchedResource: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          resourceIdentifier: QueryHelper.findWithSameText(
            data.resourceIdentifier,
          ),
        },
        select: {
          _id: true,
          projectId: true,
          resourceIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedResource) {
        return reFetchedResource;
      }

      throw new Error(
        "Failed to create or find cloud resource: " + data.resourceIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    cloudResourceId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
      cloudPlatform?: string | undefined;
      cloudProvider?: string | undefined;
      cloudRegion?: string | undefined;
      cloudAccountId?: string | undefined;
      runtimeName?: string | undefined;
      runtimeVersion?: string | undefined;
    },
  ): Promise<void> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
          cloudPlatform: extra?.cloudPlatform ?? null,
          cloudProvider: extra?.cloudProvider ?? null,
          cloudRegion: extra?.cloudRegion ?? null,
          cloudAccountId: extra?.cloudAccountId ?? null,
          runtimeName: extra?.runtimeName ?? null,
          runtimeVersion: extra?.runtimeVersion ?? null,
        }),
      )
      .digest("hex");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};

    if (extra?.agentVersion) {
      metadata.agentVersion = extra.agentVersion;
    }
    if (extra?.cloudPlatform) {
      metadata.cloudPlatform = extra.cloudPlatform;
    }
    if (extra?.cloudProvider) {
      metadata.cloudProvider = extra.cloudProvider;
    }
    if (extra?.cloudRegion) {
      metadata.cloudRegion = extra.cloudRegion;
    }
    if (extra?.cloudAccountId) {
      metadata.cloudAccountId = extra.cloudAccountId;
    }
    if (extra?.runtimeName) {
      metadata.runtimeName = extra.runtimeName;
    }
    if (extra?.runtimeVersion) {
      metadata.runtimeVersion = extra.runtimeVersion;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: cloudResourceId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `cloud resource ${cloudResourceId.toString()}`,
    });
  }

  @CaptureSpan()
  public async attachLabels(data: {
    cloudResourceId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.cloudResourceId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const resourceIdStr: string = data.cloudResourceId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(resourceIdStr)
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
          .of(resourceIdStr)
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
        `CloudResourceService.attachLabels failed for resource ${data.cloudResourceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedResources(): Promise<void> {
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom.
     *
     * Environments only: a resource's metrics arrive on the provider's
     * polling cadence, and markUnreportedMonitoredResources gives them the
     * longer window that needs.
     */
    /*
     * Measured in time OneUptime was receiving: a stretch when OneUptime
     * itself was down, starting up or catching up on its ingest queue is
     * not silence held against the resource (issue #2825). With no such
     * stretch this is exactly CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES ago.
     */
    const silenceCutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES,
    });

    const connectedResources: Array<Model> = await this.findBy({
      query: {
        cloudResourceKind: CloudResourceKind.Environment,
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(silenceCutoff),
      },
      select: {
        _id: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const cloudResource of connectedResources) {
      if (cloudResource._id) {
        await this.updateOneById({
          id: new ObjectID(cloudResource._id.toString()),
          data: {
            otelCollectorStatus: "disconnected",
          },
          props: {
            isRoot: true,
          },
        });
      }
    }
  }

  /*
   * ---- Cloud resources discovered from cloud monitoring -------------------
   */

  /**
   * The row for a resource a cloud-monitoring datapoint named
   * (CloudMonitoredResource) - found by its identity, or created.
   *
   * Lookup first, by (projectId, resourceIdentifier): the identifier is a
   * hash of the resource's canonical identity, so the same resource always
   * finds the same row, archived or not - an archived row is returned as it
   * is (the auto-archive sweep restores the ones it archived itself once
   * they report again).
   *
   * When there is no row: `{ cloudResource: null, created: false }` if the
   * project already holds getMonitoredResourceAutoCreateBudget() live
   * resources. Otherwise a row is created as root - through the usual hooks,
   * so the label and owner rules and the "created" feed item run, once, for
   * the insert that won - with the first free name of
   * getCloudMonitoredResourceNameCandidates: names are unique within a
   * project, and the provider's are not.
   *
   * Races: the unique (projectId, resourceIdentifier) index lets one insert
   * win; the loser re-reads the winner's row. A name another writer took in
   * the meantime is retried once under the hash-qualified name, which is
   * unique by construction.
   */
  @CaptureSpan()
  public async findOrCreateMonitoredResource(data: {
    projectId: ObjectID;
    resource: CloudMonitoredResource;
  }): Promise<CloudMonitoredResourceFindOrCreateResult> {
    const resourceIdentifier: string = buildCloudMonitoredResourceIdentifier(
      data.resource,
    );

    const existing: Model | null = await this.findMonitoredResourceRow(
      data.projectId,
      resourceIdentifier,
    );

    if (existing) {
      return { cloudResource: existing, created: false };
    }

    if (
      !(await this.isUnderMonitoredResourceAutoCreateBudgetCached(
        data.projectId,
      ))
    ) {
      this.warnMonitoredResourceBudgetReached(data.projectId);
      return { cloudResource: null, created: false };
    }

    const candidates: Array<string> = getCloudMonitoredResourceNameCandidates(
      data.resource,
    );
    const name: string =
      (await this.findFreeName(data.projectId, candidates)) ||
      candidates[candidates.length - 1]!;

    let created: Model;

    try {
      created = await this.createMonitoredResourceRow({
        projectId: data.projectId,
        resource: data.resource,
        resourceIdentifier: resourceIdentifier,
        name: name,
      });
    } catch (error) {
      const winner: Model | null = await this.findMonitoredResourceRow(
        data.projectId,
        resourceIdentifier,
      );

      if (winner) {
        return { cloudResource: winner, created: false };
      }

      /*
       * Only a name another writer took in the meantime is retried, and
       * under the name that cannot clash: anything else is a real failure
       * - a transient one is retried by the next poll, under the name it
       * should have.
       */
      const uniqueName: string = candidates[candidates.length - 1]!;

      if (uniqueName === name || !isNameClash(error)) {
        throw error;
      }

      created = await this.createMonitoredResourceRow({
        projectId: data.projectId,
        resource: data.resource,
        resourceIdentifier: resourceIdentifier,
        name: uniqueName,
      });
    }

    this.noteMonitoredResourceCreated(data.projectId);

    return { cloudResource: created, created: true };
  }

  /**
   * Liveness for a resource: its metrics were seen. One gated, non-blocking
   * ResourceHeartbeat write per resource per window - lastSeenAt and the
   * status always, and what the provider reports about it (region,
   * account, resource group, type, provider id and the exact attributes
   * that select its metrics) when that has changed. The name is never
   * touched: a person may have renamed it.
   */
  @CaptureSpan()
  public async recordMonitoredResourceSighting(data: {
    cloudResourceId: ObjectID;
    resource: CloudMonitoredResource;
  }): Promise<void> {
    const liveness: PartialEntity<Model> = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    const metadata: PartialEntity<Model> = this.getMonitoredResourceColumns(
      data.resource,
    );

    await ResourceHeartbeat.write({
      service: this,
      id: data.cloudResourceId,
      cacheNamespace: MONITORED_RESOURCE_SIGHTING_CACHE_NAMESPACE,
      throttleInSeconds: MONITORED_RESOURCE_SIGHTING_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: crypto
        .createHash("sha1")
        .update(JSON.stringify(metadata))
        .digest("hex"),
      describe: `cloud resource ${data.cloudResourceId.toString()} (${data.resource.provider} ${data.resource.resourceType})`,
    });
  }

  /**
   * Resources whose metrics stopped for CLOUD_RESOURCE_DISCONNECTED_MINUTES
   * read "not reporting". One set-based UPDATE: a collector that stops can
   * take thousands of resources with it, and each one is only a status.
   * Returns how many rows changed.
   */
  @CaptureSpan()
  public async markUnreportedMonitoredResources(): Promise<number> {
    /*
     * Measured in time OneUptime was receiving, like every other
     * "disconnected" sweep (issue #2825). With no stretch when OneUptime was
     * down or catching up this is exactly CLOUD_RESOURCE_DISCONNECTED_MINUTES
     * ago.
     */
    const cutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: CLOUD_RESOURCE_DISCONNECTED_MINUTES,
    });

    const rows: unknown = await this.getRepository().manager.query(
      `UPDATE "CloudResource"
        SET "otelCollectorStatus" = 'disconnected'
        WHERE "deletedAt" IS NULL
          AND "cloudResourceKind" = $1
          AND "otelCollectorStatus" = 'connected'
          AND "lastSeenAt" < $2
        RETURNING "_id"`,
      [CloudResourceKind.Resource, cutoff],
    );

    return countReturnedRows(rows);
  }

  /*
   * Days a discovered resource may send no metrics before the sweep
   * archives it (CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS). Default 7, at least 1.
   */
  public getMonitoredResourceAutoArchiveDays(): number {
    return readIntegerEnv({
      name: "CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS",
      defaultValue: DEFAULT_MONITORED_RESOURCE_AUTO_ARCHIVE_DAYS,
      min: MIN_MONITORED_RESOURCE_AUTO_ARCHIVE_DAYS,
    });
  }

  /**
   * Archive discovered resources that have sent no metrics for
   * getMonitoredResourceAutoArchiveDays(). Discovery creates rows on its own,
   * and nothing ever reports a resource as deleted: an instance an Auto
   * Scaling group replaced, a volume, a test bucket just stop reporting.
   * Without this they would sit in the list - and count against the
   * auto-create budget - forever.
   *
   * Archiving keeps everything (labels, owners, history); the row comes back
   * by itself the moment the resource reports again
   * (restoreReportingMonitoredResources). The row is marked autoArchivedAt,
   * which is how the two tell a row the sweep archived from one a person
   * archived. A row whose autoArchivedAt is still set and that is NOT
   * archived is one a person restored while it was silent: it is left alone
   * until it reports again, so their Restore sticks.
   *
   * At most MONITORED_RESOURCE_AUTO_ARCHIVE_BATCH_SIZE rows per run, oldest
   * first, in one statement. Raw SQL on purpose: no feed item or hook for a
   * routine sweep. Returns how many rows were archived.
   */
  @CaptureSpan()
  public async archiveUnseenMonitoredResources(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();
    const cutoff: Date = OneUptimeDate.addRemoveDays(
      now,
      -this.getMonitoredResourceAutoArchiveDays(),
    );

    const rows: unknown = await this.getRepository().manager.query(
      `WITH "candidates" AS (
          SELECT cr."_id"
          FROM "CloudResource" cr
          WHERE cr."deletedAt" IS NULL
            AND cr."cloudResourceKind" = $1
            AND cr."isArchived" = false
            AND cr."autoArchivedAt" IS NULL
            AND COALESCE(cr."lastSeenAt", cr."createdAt") < $2
          ORDER BY COALESCE(cr."lastSeenAt", cr."createdAt") ASC
          LIMIT $4
        )
        UPDATE "CloudResource" stale
        SET "isArchived" = true,
          "archivedAt" = $3,
          "autoArchivedAt" = $3,
          "archivedByUserId" = NULL,
          "otelCollectorStatus" = 'disconnected',
          "updatedAt" = CURRENT_TIMESTAMP
        FROM "candidates"
        WHERE stale."_id" = "candidates"."_id"
          AND stale."isArchived" = false
        RETURNING stale."_id"`,
      [
        CloudResourceKind.Resource,
        cutoff,
        now,
        MONITORED_RESOURCE_AUTO_ARCHIVE_BATCH_SIZE,
      ],
    );

    return countReturnedRows(rows);
  }

  /**
   * Bring back the resources the sweep archived that have reported since:
   * a heartbeat keeps refreshing lastSeenAt on an archived row, so "seen
   * after it was archived" is lastSeenAt > autoArchivedAt. Never a row a
   * person archived - their archive clears autoArchivedAt (onUpdateSuccess).
   *
   * A row a person restored while it was silent keeps autoArchivedAt as the
   * sign to leave it be; once it reports, that is cleared too, so the sweep
   * may archive it again should it ever go silent. Returns how many rows
   * were restored.
   */
  @CaptureSpan()
  public async restoreReportingMonitoredResources(): Promise<number> {
    const rows: unknown = await this.getRepository().manager.query(
      `UPDATE "CloudResource"
        SET "isArchived" = false,
          "archivedAt" = NULL,
          "archivedByUserId" = NULL,
          "autoArchivedAt" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "deletedAt" IS NULL
          AND "cloudResourceKind" = $1
          AND "isArchived" = true
          AND "autoArchivedAt" IS NOT NULL
          AND "lastSeenAt" > "autoArchivedAt"
        RETURNING "_id"`,
      [CloudResourceKind.Resource],
    );

    await this.getRepository().manager.query(
      `UPDATE "CloudResource"
        SET "autoArchivedAt" = NULL
        WHERE "deletedAt" IS NULL
          AND "cloudResourceKind" = $1
          AND "isArchived" = false
          AND "autoArchivedAt" IS NOT NULL
          AND "lastSeenAt" > "autoArchivedAt"`,
      [CloudResourceKind.Resource],
    );

    return countReturnedRows(rows);
  }

  /*
   * How many live discovered resources a project may hold before discovery
   * stops creating more (CLOUD_RESOURCE_AUTO_CREATE_BUDGET). Archived rows
   * do not count, so the auto-archive sweep frees budget; environments never
   * count. Default 5000, at least 0 (0 turns resource discovery off).
   */
  public getMonitoredResourceAutoCreateBudget(): number {
    return readIntegerEnv({
      name: "CLOUD_RESOURCE_AUTO_CREATE_BUDGET",
      defaultValue: DEFAULT_MONITORED_RESOURCE_AUTO_CREATE_BUDGET,
      min: 0,
    });
  }

  /**
   * Whether discovery may create another resource for the project: the
   * count is read at most once a minute per project in this process, and
   * every row this process creates in between is added to it.
   */
  @CaptureSpan()
  public async isUnderMonitoredResourceAutoCreateBudgetCached(
    projectId: ObjectID,
  ): Promise<boolean> {
    const budget: number = this.getMonitoredResourceAutoCreateBudget();

    if (budget <= 0) {
      return false;
    }

    const key: string = projectId.toString();
    let cached: MonitoredResourceCount | undefined =
      this.monitoredResourceCountMemo.get(key);

    if (!cached) {
      cached = {
        count: await this.countLiveMonitoredResources(projectId),
        readAtMs: Date.now(),
      };
      this.monitoredResourceCountMemo.set(key, cached);
    }

    return cached.count < budget;
  }

  // Live, non-archived resources of one project.
  @CaptureSpan()
  public async countLiveMonitoredResources(
    projectId: ObjectID,
  ): Promise<number> {
    const rows: unknown = await this.getRepository().manager.query(
      `SELECT COUNT(*)::int AS "count"
        FROM "CloudResource"
        WHERE "projectId" = $1
          AND "deletedAt" IS NULL
          AND "isArchived" = false
          AND "cloudResourceKind" = $2`,
      [projectId.toString(), CloudResourceKind.Resource],
    );

    if (!Array.isArray(rows) || rows.length === 0) {
      return 0;
    }

    const count: number = Number((rows[0] as { count?: unknown })?.count);

    return Number.isFinite(count) ? count : 0;
  }

  /*
   * What a resource's row records about it besides its liveness - written on
   * create, and by every sighting whose values changed.
   */
  private getMonitoredResourceColumns(
    resource: CloudMonitoredResource,
  ): PartialEntity<Model> {
    const columns: PartialEntity<Model> = {
      cloudProvider: resource.provider,
      cloudResourceType: truncate(resource.resourceType),
      providerResourceId: resource.providerResourceId,
      telemetryAttributes: resource.telemetryAttributes,
    };

    if (resource.region) {
      columns.cloudRegion = truncate(resource.region);
    }
    if (resource.accountId) {
      columns.cloudAccountId = truncate(resource.accountId);
    }
    if (resource.resourceGroup) {
      columns.cloudResourceGroup = truncate(resource.resourceGroup);
    }

    return columns;
  }

  private async createMonitoredResourceRow(data: {
    projectId: ObjectID;
    resource: CloudMonitoredResource;
    resourceIdentifier: string;
    name: string;
  }): Promise<Model> {
    const row: Model = new Model();
    row.projectId = data.projectId;
    row.name = data.name;
    row.resourceIdentifier = data.resourceIdentifier;
    row.cloudResourceKind = CloudResourceKind.Resource;
    row.otelCollectorStatus = "connected";
    row.lastSeenAt = OneUptimeDate.getCurrentDate();

    const columns: PartialEntity<Model> = this.getMonitoredResourceColumns(
      data.resource,
    );
    Object.assign(row, columns);

    return await this.create({
      data: row,
      props: {
        isRoot: true,
      },
    });
  }

  private async findMonitoredResourceRow(
    projectId: ObjectID,
    resourceIdentifier: string,
  ): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: projectId,
        resourceIdentifier: QueryHelper.findWithSameText(resourceIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        resourceIdentifier: true,
        cloudResourceKind: true,
        isArchived: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  // The first candidate no row of the project is named (any case), or null.
  private async findFreeName(
    projectId: ObjectID,
    candidates: Array<string>,
  ): Promise<string | null> {
    for (const candidate of candidates) {
      const taken: number = (
        await this.countBy({
          query: {
            projectId: projectId,
            name: QueryHelper.findWithSameText(candidate),
          },
          props: {
            isRoot: true,
          },
        })
      ).toNumber();

      if (taken === 0) {
        return candidate;
      }
    }

    return null;
  }

  // A row was created: count it against the cached budget straight away.
  private noteMonitoredResourceCreated(projectId: ObjectID): void {
    const key: string = projectId.toString();
    const cached: MonitoredResourceCount | undefined =
      this.monitoredResourceCountMemo.get(key);

    if (!cached) {
      return;
    }

    const remainingMs: number =
      cached.readAtMs + MONITORED_RESOURCE_BUDGET_CACHE_MS - Date.now();

    if (remainingMs <= 0) {
      this.monitoredResourceCountMemo.delete(key);
      return;
    }

    this.monitoredResourceCountMemo.set(
      key,
      { count: cached.count + 1, readAtMs: cached.readAtMs },
      remainingMs,
    );
  }

  private warnMonitoredResourceBudgetReached(projectId: ObjectID): void {
    const key: string = projectId.toString();

    if (this.monitoredResourceBudgetWarningMemo.get(key)) {
      return;
    }

    this.monitoredResourceBudgetWarningMemo.set(key, true);

    logger.warn(
      `Cloud resource discovery reached its budget of ${this.getMonitoredResourceAutoCreateBudget()} live resources for project ${key}; new resources are not created until some are archived (CLOUD_RESOURCE_AUTO_CREATE_BUDGET).`,
      { projectId: key } as LogAttributes,
    );
  }

  /**
   * Display name for this cloud resource, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getCloudResourceName(data: {
    cloudResourceId: ObjectID;
  }): Promise<string> {
    const cloudResource: Model | null = await this.findOneById({
      id: data.cloudResourceId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return cloudResource?.name || "";
  }

  @CaptureSpan()
  public async getCloudResourceLinkInDashboard(
    projectId: ObjectID,
    cloudResourceId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/cloud/${cloudResourceId.toString()}`,
    );
  }

  /**
   * "[Cloud Resource prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getCloudResourceMarkdownLink(
    projectId: ObjectID,
    cloudResourceId: ObjectID,
  ): Promise<MarkdownText> {
    const name: string = await this.getCloudResourceName({
      cloudResourceId: cloudResourceId,
    });
    const link: URL = await this.getCloudResourceLinkInDashboard(
      projectId,
      cloudResourceId,
    );

    return mdText`[Cloud Resource ${name}](${link.toString()})`;
  }

  private async writeCloudResourceCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const cloudResourceId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !cloudResourceId) {
      return;
    }

    /*
     * Ingest creates these rows with root props and no acting user; every
     * dashboard, API and Terraform create carries one. That is the whole
     * signal for "was this discovered automatically or added by a person".
     */
    const createdByUserId: ObjectID | undefined =
      createdItem.createdByUserId ||
      onCreate.createBy.props.userId ||
      undefined;

    const markdown: {
      feedInfoInMarkdown: string;
      moreInformationInMarkdown: string;
    } = await ResourceFeedUtil.getCreatedFeedMarkdown({
      resourceTypeName: "cloud resource",
      resourceMarkdownLink: await this.getCloudResourceMarkdownLink(
        projectId,
        cloudResourceId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      /*
       * A resource's identifier is a hash of its identity; the provider's
       * own id is what says which resource it is.
       */
      ...(createdItem.cloudResourceKind === CloudResourceKind.Resource
        ? {
            identifierName: "Provider resource ID",
            identifierValue: createdItem.providerResourceId,
          }
        : {
            identifierName: "Resource identifier",
            identifierValue: createdItem.resourceIdentifier,
          }),
      description: createdItem.description,
    });

    await CloudResourceFeedService.createCloudResourceFeedItem({
      cloudResourceId: cloudResourceId,
      projectId: projectId,
      cloudResourceFeedEventType:
        CloudResourceFeedEventType.CloudResourceCreated,
      displayColor: Green500,
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: markdown.moreInformationInMarkdown,
      userId: createdByUserId,
    });
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * A person archiving a resource takes it out of the auto-archive
     * sweep's hands: without its autoArchivedAt, the sweep never restores
     * it when it reports again. (The sweep's own archive and restore are
     * raw writes and never reach this hook. A person's Restore keeps the
     * mark on purpose - see restoreReportingMonitoredResources.)
     */
    if (
      ResourceFeedUtil.isArchiveChange(updateData) &&
      updateData["isArchived"] === true &&
      updatedItemIds.length > 0
    ) {
      await this.forgetAutoArchive(updatedItemIds);
    }

    this.writeCloudResourceUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  private async forgetAutoArchive(ids: Array<ObjectID>): Promise<void> {
    try {
      await this.getRepository().manager.query(
        `UPDATE "CloudResource"
          SET "autoArchivedAt" = NULL
          WHERE "_id" = ANY($1::uuid[])
            AND "autoArchivedAt" IS NOT NULL`,
        [
          ids.map((id: ObjectID): string => {
            return id.toString();
          }),
        ],
      );
    } catch (error) {
      logger.error(
        `CloudResourceService.forgetAutoArchive failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async writeCloudResourceUpdatedFeed(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * Heartbeats update lastSeenAt / otelCollectorStatus / agentVersion and the
     * rollup counters constantly. Only the columns a person would recognise as
     * a change earn a feed item - see MEANINGFUL_UPDATE_COLUMNS.
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

    for (const cloudResourceId of updatedItemIds) {
      const cloudResource: Model | null = await this.findOneById({
        id: cloudResourceId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = cloudResource?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: MarkdownText =
        await this.getCloudResourceMarkdownLink(projectId, cloudResourceId);

      if (isArchiveChange) {
        await CloudResourceFeedService.createCloudResourceFeedItem({
          cloudResourceId: cloudResourceId,
          projectId: projectId,
          cloudResourceFeedEventType: isArchived
            ? CloudResourceFeedEventType.CloudResourceArchived
            : CloudResourceFeedEventType.CloudResourceRestored,
          displayColor: isArchived ? Yellow500 : Blue500,
          feedInfoInMarkdown: isArchived
            ? mdText`🗄️ ${resourceMarkdownLink} was archived.`.toString()
            : mdText`♻️ ${resourceMarkdownLink} was restored from the archive.`.toString(),
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

        await CloudResourceFeedService.createCloudResourceFeedItem({
          cloudResourceId: cloudResourceId,
          projectId: projectId,
          cloudResourceFeedEventType:
            CloudResourceFeedEventType.CloudResourceUpdated,
          displayColor: Gray500,
          feedInfoInMarkdown: markdown.feedInfoInMarkdown,
          moreInformationInMarkdown: markdown.moreInformationInMarkdown,
          userId: updatedByUserId,
        });
      }
    }
  }
}

function fingerprintLabelIds(labelIds: Array<ObjectID>): string {
  const sorted: Array<string> = labelIds
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
  return crypto.createHash("sha1").update(sorted.join(",")).digest("hex");
}

/*
 * The refusal DatabaseService.checkUniqueColumnBy raises when another row of
 * the project already has the name.
 */
function isNameClash(error: unknown): boolean {
  return (
    error instanceof BadDataException &&
    error.message.includes("with the same name already exists")
  );
}

// The ShortText columns' width.
const SHORT_TEXT_MAX_LENGTH: number = 100;

function truncate(value: string): string {
  return value.length > SHORT_TEXT_MAX_LENGTH
    ? value.slice(0, SHORT_TEXT_MAX_LENGTH)
    : value;
}

// The rows an `UPDATE ... RETURNING` touched, however the driver shapes them.
function countReturnedRows(result: unknown): number {
  if (!Array.isArray(result)) {
    return 0;
  }
  // pg returns [rows, rowCount] for UPDATE ... RETURNING through TypeORM.
  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }
  return result.length;
}

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

export default new Service();
