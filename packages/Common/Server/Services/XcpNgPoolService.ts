import ProjectReferencesService from "./ProjectReferencesService";
import XcpNgPoolLabelRuleEngineService from "./XcpNgPoolLabelRuleEngineService";
import XcpNgPoolOwnerRuleEngineService from "./XcpNgPoolOwnerRuleEngineService";
import XcpNgPoolFeedService from "./XcpNgPoolFeedService";
import Model from "../../Models/DatabaseModels/XcpNgPool";
import Label from "../../Models/DatabaseModels/Label";
import { XcpNgPoolFeedEventType } from "../../Models/DatabaseModels/XcpNgPoolFeed";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import ResourceAiAccessSettings, {
  ResourceAiAccessFeedItem,
} from "../Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiDeleteCleanup from "../Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import AiResourceType from "../../Types/ResourceAiAgent/AiResourceType";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ReceivingCoverage from "../Utils/Telemetry/ReceivingCoverage";
import DiscoveredResourceCreate, {
  DiscoveredResourceNaming,
  getDiscoveredResourceNameTakenMessage,
} from "../Utils/Telemetry/DiscoveredResourceCreate";
import DiscoveredResourceUpdate, {
  MatchColumn,
  matchedOnIdentifier,
} from "../Utils/Telemetry/DiscoveredResourceUpdate";
import ResourceHeartbeat, {
  ResourceHeartbeatResult,
} from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { mdText, MarkdownText } from "../../Utils/Markdown/FeedMarkdown";
import { NameHolder } from "../../Types/Exception/NameTakenException";
import { XcpNgTelemetryUtil } from "../../Types/XcpNg/XcpNgTelemetry";

/*
 * Two clocks, two heartbeats, two throttles, as for a Proxmox cluster.
 * lastSeenAt is when the pool was last read (updateLastSeen, from the
 * metrics snapshot flush); agentLastSeenAt is when the agent last sent
 * anything naming it (updateAgentLastSeen, from the fenced ingest
 * maintenance path). They must not share a liveness key: ResourceHeartbeat
 * gates liveness on the key's presence alone.
 */
const LAST_SEEN_CACHE_NAMESPACE: string = "xcp-ng-pool-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const AGENT_LAST_SEEN_CACHE_NAMESPACE: string = "xcp-ng-pool-agent-last-seen";
const AGENT_LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "xcp-ng-pool-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

// What Xen Orchestra last said the pool and its Xen Orchestra are called.
const REPORTED_NAMES_CACHE_NAMESPACE: string = "xcp-ng-pool-reported-names";
const REPORTED_NAMES_CACHE_TTL_SECONDS: number = 10 * 60;

/*
 * A pool is matched to its telemetry by its XAPI UUID (xcp_ng.pool.id), and
 * named after what Xen Orchestra calls it unless somebody names it
 * (DiscoveredResourceCreate). A pool added by hand ahead of its telemetry
 * with no name is called "Pool <start of its UUID>", as one Xen Orchestra
 * reports without a name is.
 */
const XCP_NG_POOL_IDENTITY: {
  identityColumn: string;
  resourceName: string;
  identityName: string;
} = {
  identityColumn: "poolIdentifier",
  resourceName: "XCP-ng pool",
  identityName: "pool UUID",
};

export const XCP_NG_POOL_NAMING: DiscoveredResourceNaming<Model> = {
  identityColumn: XCP_NG_POOL_IDENTITY.identityColumn,
  getDefaultName: (data: Model): string => {
    return XcpNgTelemetryUtil.getDefaultPoolName({
      poolName: null,
      poolIdentifier: data.poolIdentifier || "",
    });
  },
  getIdentityTakenMessage: (identity: string): string => {
    return `An XCP-ng pool with the pool UUID "${identity}" already exists.`;
  },
  getNameTakenMessage: (name: string, holder?: NameHolder): string => {
    return getDiscoveredResourceNameTakenMessage({
      resourceName: XCP_NG_POOL_IDENTITY.resourceName,
      name: name,
      isArchived: holder?.isArchived,
    });
  },
};

const XCP_NG_POOL_MATCH_COLUMN: MatchColumn =
  matchedOnIdentifier(XCP_NG_POOL_IDENTITY);

// What ingest knows about a pool when it first sees it, besides its UUID.
export interface XcpNgPoolDiscovery {
  projectId: ObjectID;
  poolIdentifier: string;
  // pool_name, as Xen Orchestra reports it; may be empty.
  reportedName?: string | undefined;
  // The Xen Orchestra the agent reads (xen_orchestra.name).
  xenOrchestraName?: string | undefined;
}

// The pool's counts and capacity, as one batch's snapshot derived them.
export interface XcpNgPoolSnapshotExtras {
  hostCount?: number | undefined;
  runningHostCount?: number | undefined;
  disabledHostCount?: number | undefined;
  vmCount?: number | undefined;
  runningVmCount?: number | undefined;
  storageRepositoryCount?: number | undefined;
  vdiCount?: number | undefined;
  storageCapacityBytes?: number | undefined;
  storageUsedBytes?: number | undefined;
}

const SNAPSHOT_EXTRA_COLUMNS: ReadonlyArray<keyof XcpNgPoolSnapshotExtras> = [
  "hostCount",
  "runningHostCount",
  "disabledHostCount",
  "vmCount",
  "runningVmCount",
  "storageRepositoryCount",
  "vdiCount",
  "storageCapacityBytes",
  "storageUsedBytes",
];

/*
 * The name a pool should have now that Xen Orchestra reports `reportedName`
 * for it, or null to leave its name alone. A pool follows Xen Orchestra's
 * name while nobody has renamed it here: while its name is still the one Xen
 * Orchestra last reported, or the placeholder given to a pool that had none.
 * Pure, so it is held to its cases by a unit test.
 */
export const getXcpNgPoolNameToFollow: (data: {
  currentName: string | null | undefined;
  previousReportedName: string | null | undefined;
  reportedName: string | null | undefined;
  poolIdentifier: string;
}) => string | null = (data: {
  currentName: string | null | undefined;
  previousReportedName: string | null | undefined;
  reportedName: string | null | undefined;
  poolIdentifier: string;
}): string | null => {
  const reported: string = (data.reportedName || "").trim();
  if (!reported) {
    // A pool losing its name in Xen Orchestra keeps the one it has here.
    return null;
  }

  const current: string = (data.currentName || "").trim();
  if (current === reported) {
    return null;
  }

  const placeholder: string = XcpNgTelemetryUtil.getDefaultPoolName({
    poolName: null,
    poolIdentifier: data.poolIdentifier,
  });
  const previous: string = (data.previousReportedName || "").trim();

  const isStillXenOrchestrasName: boolean =
    current === placeholder ||
    current ===
      `${placeholder} (${XcpNgTelemetryUtil.getShortIdentifier(data.poolIdentifier)})` ||
    (previous !== "" &&
      (current === previous ||
        current ===
          `${previous} (${XcpNgTelemetryUtil.getShortIdentifier(data.poolIdentifier)})`));

  return isStillXenOrchestrasName ? reported : null;
};

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A person's create: the UUID is stored the way telemetry reports it
   * (trimmed, lower case), and a pool given no name is named after it.
   * Ingest's own creates are already normalized and named.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * Held to the same AI access rules as an update, judged against the
     * never-configured defaults a new pool starts from: an unusable mode or
     * allowlist is refused for every caller, and the server-only aiAccess*
     * columns for every caller but root.
     */
    ResourceAiAccessSettings.checkCreate({
      resourceType: AiResourceType.XcpNgPool,
      createBy,
    });

    const data: Model = createBy.data;
    if (typeof data.poolIdentifier === "string") {
      data.poolIdentifier = XcpNgTelemetryUtil.normalizePoolIdentifier(
        data.poolIdentifier,
      );
    }

    DiscoveredResourceCreate.fillName({
      createBy,
      naming: XCP_NG_POOL_NAMING,
    });

    return { createBy, carryForward: null };
  }

  /*
   * A pool that is already there - discovered from its telemetry or added
   * before - is refused by its UUID, not as a clash of names.
   */
  @CaptureSpan()
  protected override async onBeforeCreateUniqueCheck(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    await DiscoveredResourceCreate.refuseClash({
      service: this,
      createBy,
      naming: XCP_NG_POOL_NAMING,
    });
  }

  /*
   * The UUID, edited under Advanced on the pool's Settings, is held to what
   * creating a pool holds it to (DiscoveredResourceUpdate).
   */
  @CaptureSpan()
  protected override async onBeforeUpdateUniqueCheck(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;
    if (typeof data["poolIdentifier"] === "string") {
      data["poolIdentifier"] = XcpNgTelemetryUtil.normalizePoolIdentifier(
        data["poolIdentifier"] as string,
      );
    }

    await DiscoveredResourceUpdate.checkMatchColumn({
      service: this,
      updateBy,
      matchColumn: XCP_NG_POOL_MATCH_COLUMN,
    });
  }

  /*
   * The column telemetry is matched on is held to one pool each by
   * checkMatchColumn above, in its own words: the generic check of an update
   * leaves it out (#10318).
   */
  protected override getUniqueColumnsCheckedOnUpdate(): ReadonlyArray<string> {
    return [XCP_NG_POOL_MATCH_COLUMN.column];
  }

  /*
   * An operator's write of an AI access setting (the investigation switch,
   * the remediation mode, the command allowlist) is validated and checked
   * against who may make AI do more on this pool - the rules every resource
   * AI agent's resource shares (ResourceAiAccessSettings). Its carry-forward
   * is read back by ResourceAiAccessSettings.afterUpdate in onUpdateSuccess.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    return {
      updateBy,
      carryForward: await ResourceAiAccessSettings.checkUpdate({
        resourceType: AiResourceType.XcpNgPool,
        service: this,
        updateBy,
      }),
    };
  }

  /*
   * Deleting a pool settles its in-flight AI remediation rounds and removes
   * its XCP-ng AI agent - read before the delete, done after it for the
   * pools actually deleted (ResourceAiDeleteCleanup, shared by every resource
   * AI agent's resource).
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    return {
      deleteBy,
      carryForward: await ResourceAiDeleteCleanup.beforeDelete({
        resourceType: AiResourceType.XcpNgPool,
        service: this,
        deleteBy,
      }),
    };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    await ResourceAiDeleteCleanup.afterDelete({
      resourceType: AiResourceType.XcpNgPool,
      onDelete,
      deletedItemIds,
    });

    return onDelete;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Rules run once, on creation only, as for every other product. The
     * label engine first: it syncs the in-memory labels so the owner engine
     * can match rule-added labels.
     */
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await XcpNgPoolLabelRuleEngineService.applyRulesToXcpNgPool(
            createdItem,
          );
        })
        .then(async () => {
          await XcpNgPoolOwnerRuleEngineService.applyRulesToXcpNgPool(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying XCP-ng pool rules in XcpNgPoolService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              xcpNgPoolId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }

    /*
     * The feed says why the pool exists at all: a person added it, or ingest
     * registered it the first time Xen Orchestra reported it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeXcpNgPoolCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return createdItem;
  }

  /*
   * The pool a batch names, found by its UUID or created as on first
   * contact. Looked up case-insensitively, as the unique guard compares.
   * The name a new pool gets is Xen Orchestra's, made unique in the project
   * by the start of its UUID when another pool already has it (two Xen
   * Orchestras can each manage a pool called "Production").
   */
  @CaptureSpan()
  public async findOrCreateByIdentifier(
    data: XcpNgPoolDiscovery,
  ): Promise<Model> {
    const poolIdentifier: string = XcpNgTelemetryUtil.normalizePoolIdentifier(
      data.poolIdentifier,
    );
    if (!poolIdentifier) {
      throw new Error("An XCP-ng pool needs a UUID to be found or created.");
    }

    const existingPool: Model | null = await this.findByIdentifier({
      projectId: data.projectId,
      poolIdentifier,
    });

    if (existingPool) {
      return existingPool;
    }

    const name: string = await this.getUnusedName({
      projectId: data.projectId,
      name: XcpNgTelemetryUtil.getDefaultPoolName({
        poolName: data.reportedName,
        poolIdentifier,
      }),
      poolIdentifier,
    });

    try {
      /*
       * A new pool is not Connected until it is read: its status stays the
       * column's "disconnected" and lastSeenAt empty until a batch that
       * carries the pool reaches the snapshot flush, usually the very batch
       * that created it.
       */
      const newPool: Model = new Model();
      newPool.projectId = data.projectId;
      newPool.poolIdentifier = poolIdentifier;
      newPool.name = name;
      if (data.reportedName && data.reportedName.trim()) {
        newPool.reportedName = data.reportedName.trim();
      }
      if (data.xenOrchestraName && data.xenOrchestraName.trim()) {
        newPool.xenOrchestraName = data.xenOrchestraName.trim();
      }

      return await this.create({
        data: newPool,
        props: {
          isRoot: true,
        },
      });
    } catch {
      /*
       * Two ingest workers raced to create the same pool, or a pool with
       * this UUID in another case existed and the unique guard refused the
       * insert. Read it again so the caller still gets the row.
       */
      const reFetchedPool: Model | null = await this.findByIdentifier({
        projectId: data.projectId,
        poolIdentifier,
      });

      if (reFetchedPool) {
        return reFetchedPool;
      }

      throw new Error(
        "Failed to create or find XCP-ng pool: " + poolIdentifier,
      );
    }
  }

  private async findByIdentifier(data: {
    projectId: ObjectID;
    poolIdentifier: string;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        poolIdentifier: QueryHelper.findWithSameText(data.poolIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        poolIdentifier: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * `name`, or - when another pool of the project (archived ones included)
   * already has it - `name (<start of the UUID>)`, which no other pool can
   * hold, since the UUID is unique in the project.
   */
  private async getUnusedName(data: {
    projectId: ObjectID;
    name: string;
    poolIdentifier: string;
    exceptPoolId?: ObjectID | undefined;
  }): Promise<string> {
    const holder: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(data.name),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !holder ||
      (data.exceptPoolId &&
        holder._id?.toString() === data.exceptPoolId.toString())
    ) {
      return data.name;
    }

    return `${data.name} (${XcpNgTelemetryUtil.getShortIdentifier(data.poolIdentifier)})`;
  }

  /*
   * What Xen Orchestra calls the pool and itself, as a batch reported them:
   * kept on the pool (reportedName, xenOrchestraName), and the pool's own
   * name follows Xen Orchestra's while nobody has renamed it here
   * (getXcpNgPoolNameToFollow). Every batch carries these, so the last
   * values written are remembered in Redis and the row is read and written
   * only when one changes.
   */
  @CaptureSpan()
  public async recordReportedNames(data: {
    xcpNgPoolId: ObjectID;
    reportedName?: string | undefined;
    xenOrchestraName?: string | undefined;
  }): Promise<void> {
    const reportedName: string = (data.reportedName || "").trim();
    const xenOrchestraName: string = (data.xenOrchestraName || "").trim();
    if (!reportedName && !xenOrchestraName) {
      return;
    }

    const cacheKey: string = data.xcpNgPoolId.toString();
    const fingerprint: string = JSON.stringify([
      reportedName,
      xenOrchestraName,
    ]);

    try {
      const cached: string | null = await GlobalCache.getString(
        REPORTED_NAMES_CACHE_NAMESPACE,
        cacheKey,
      );
      if (cached === fingerprint) {
        return;
      }
    } catch {
      // A cache that cannot be read is a cache miss.
    }

    try {
      const pool: Model | null = await this.findOneById({
        id: data.xcpNgPoolId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          reportedName: true,
          xenOrchestraName: true,
          poolIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!pool || !pool.projectId || !pool.poolIdentifier) {
        return;
      }

      const update: {
        name?: string;
        reportedName?: string;
        xenOrchestraName?: string;
      } = {};
      if (reportedName && reportedName !== (pool.reportedName || "")) {
        update.reportedName = reportedName;
      }
      if (
        xenOrchestraName &&
        xenOrchestraName !== (pool.xenOrchestraName || "")
      ) {
        update.xenOrchestraName = xenOrchestraName;
      }

      const nameToFollow: string | null = getXcpNgPoolNameToFollow({
        currentName: pool.name,
        previousReportedName: pool.reportedName,
        reportedName,
        poolIdentifier: pool.poolIdentifier,
      });
      if (nameToFollow) {
        const name: string = await this.getUnusedName({
          projectId: pool.projectId,
          name: nameToFollow,
          poolIdentifier: pool.poolIdentifier,
          exceptPoolId: data.xcpNgPoolId,
        });
        if (name !== pool.name) {
          update.name = name;
        }
      }

      if (Object.keys(update).length > 0) {
        await this.updateOneById({
          id: data.xcpNgPoolId,
          data: update,
          props: {
            isRoot: true,
          },
        });
      }

      await GlobalCache.setString(
        REPORTED_NAMES_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        { expiresInSeconds: REPORTED_NAMES_CACHE_TTL_SECONDS },
      );
    } catch (err) {
      logger.warn(
        `XcpNgPoolService.recordReportedNames failed for XCP-ng pool ${data.xcpNgPoolId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * THE POOL WAS READ: refresh lastSeenAt / connection status and the
   * snapshot columns the list page renders. Only the metrics snapshot flush
   * calls this, for a batch that carried the pool's series. Count columns
   * ride with COALESCE-per-column semantics: a key that is undefined is not
   * written, so a partial batch never zeroes a count. The 60-second
   * fingerprint is the write throttle.
   */
  @CaptureSpan()
  public async updateLastSeen(
    xcpNgPoolId: ObjectID,
    extra?: XcpNgPoolSnapshotExtras,
  ): Promise<ResourceHeartbeatResult> {
    const fingerprintSource: Record<string, number | null> = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};

    for (const column of SNAPSHOT_EXTRA_COLUMNS) {
      const value: number | undefined = extra?.[column];
      fingerprintSource[column] = value === undefined ? null : value;
      // 0 is a reading: gate on undefined, never on falsiness.
      if (value !== undefined && Number.isFinite(value)) {
        metadata[column] = value;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    return await ResourceHeartbeat.write({
      service: this,
      id: xcpNgPoolId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: crypto
        .createHash("sha1")
        .update(JSON.stringify(fingerprintSource))
        .digest("hex"),
      describe: `XCP-ng pool ${xcpNgPoolId.toString()}`,
    });
  }

  /*
   * THE AGENT WAS HEARD: refresh agentLastSeenAt and the agent's version
   * (oneuptime.agent.version, stamped by the shipped agent config). The
   * fenced ingest maintenance path calls this for every batch that names
   * the pool. It never writes lastSeenAt or otelCollectorStatus.
   */
  @CaptureSpan()
  public async updateAgentLastSeen(
    xcpNgPoolId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
    },
  ): Promise<ResourceHeartbeatResult> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      agentLastSeenAt: OneUptimeDate.getCurrentDate(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};
    if (extra?.agentVersion) {
      metadata.agentVersion = extra.agentVersion;
    }

    return await ResourceHeartbeat.write({
      service: this,
      id: xcpNgPoolId,
      cacheNamespace: AGENT_LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: AGENT_LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: crypto
        .createHash("sha1")
        .update(JSON.stringify({ agentVersion: extra?.agentVersion ?? null }))
        .digest("hex"),
      describe: `XCP-ng pool ${xcpNgPoolId.toString()} (agent)`,
    });
  }

  /**
   * Additively attach labels to a pool (oneuptime.label.* resource
   * attributes). Existing labels are never removed - labels set in the
   * dashboard survive ingest. The label set is fingerprinted and cached for
   * 60s, so a steady agent costs one cache lookup per batch.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    xcpNgPoolId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.xcpNgPoolId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const xcpNgPoolIdStr: string = data.xcpNgPoolId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(xcpNgPoolIdStr)
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
          .of(xcpNgPoolIdStr)
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
        `XcpNgPoolService.attachLabels failed for XCP-ng pool ${data.xcpNgPoolId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * Disconnected means NOT READ for 15 minutes of time OneUptime was
   * receiving (ReceivingCoverage). A pool Xen Orchestra lost stops being
   * reported while its Xen Orchestra's other pools carry on, so it turns
   * Disconnected on its own.
   */
  @CaptureSpan()
  public async markDisconnectedPools(): Promise<void> {
    const silenceCutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: 15,
    });

    const connectedPools: Array<Model> = await this.findBy({
      query: {
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

    for (const pool of connectedPools) {
      if (pool._id) {
        await this.updateOneById({
          id: new ObjectID(pool._id.toString()),
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

  /**
   * The pool's name, or an empty string when the row is gone. Feed writers
   * call this on a best-effort basis, so a missing row must not throw.
   */
  @CaptureSpan()
  public async getXcpNgPoolName(data: {
    xcpNgPoolId: ObjectID;
  }): Promise<string> {
    const xcpNgPool: Model | null = await this.findOneById({
      id: data.xcpNgPoolId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return xcpNgPool?.name || "";
  }

  @CaptureSpan()
  public async getXcpNgPoolLinkInDashboard(
    projectId: ObjectID,
    xcpNgPoolId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/xcp-ng/${xcpNgPoolId.toString()}`,
    );
  }

  /**
   * "[XCP-ng Pool Production](https://…)": the form every feed item uses to
   * name the pool it is about.
   */
  @CaptureSpan()
  public async getXcpNgPoolMarkdownLink(
    projectId: ObjectID,
    xcpNgPoolId: ObjectID,
  ): Promise<MarkdownText> {
    const name: string = await this.getXcpNgPoolName({
      xcpNgPoolId: xcpNgPoolId,
    });
    const link: URL = await this.getXcpNgPoolLinkInDashboard(
      projectId,
      xcpNgPoolId,
    );

    return mdText`[XCP-ng Pool ${name}](${link.toString()})`;
  }

  private async writeXcpNgPoolCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const xcpNgPoolId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !xcpNgPoolId) {
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
      resourceTypeName: "XCP-ng pool",
      resourceMarkdownLink: await this.getXcpNgPoolMarkdownLink(
        projectId,
        xcpNgPoolId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      description: createdItem.description,
    });

    await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
      xcpNgPoolId: xcpNgPoolId,
      projectId: projectId,
      xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.XcpNgPoolCreated,
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
    this.writeXcpNgPoolUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    /*
     * An operator's AI access write: recorded on the feed, and the pool
     * marked AI-configured.
     */
    await ResourceAiAccessSettings.afterUpdate({
      service: this,
      onUpdate,
      updatedItemIds,
      getResourceMarkdownLink: (
        projectId: ObjectID,
        xcpNgPoolId: ObjectID,
      ): Promise<MarkdownText> => {
        return this.getXcpNgPoolMarkdownLink(projectId, xcpNgPoolId);
      },
      createFeedItem: async (item: ResourceAiAccessFeedItem): Promise<void> => {
        await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
          xcpNgPoolId: item.resourceId,
          projectId: item.projectId,
          xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.XcpNgPoolUpdated,
          displayColor: item.displayColor,
          feedInfoInMarkdown: item.feedInfoInMarkdown,
          moreInformationInMarkdown: item.moreInformationInMarkdown,
          userId: item.userId,
        });
      },
    });

    return onUpdate;
  }

  private async writeXcpNgPoolUpdatedFeed(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * Heartbeats write lastSeenAt / otelCollectorStatus / agentVersion and
     * the counts constantly. Only the columns a person would recognise as a
     * change earn a feed item (MEANINGFUL_UPDATE_COLUMNS) - which includes
     * the pool's name, so a rename in Xen Orchestra the pool followed is on
     * its feed too.
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

    for (const xcpNgPoolId of updatedItemIds) {
      const xcpNgPool: Model | null = await this.findOneById({
        id: xcpNgPoolId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = xcpNgPool?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: MarkdownText =
        await this.getXcpNgPoolMarkdownLink(projectId, xcpNgPoolId);

      if (isArchiveChange) {
        await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
          xcpNgPoolId: xcpNgPoolId,
          projectId: projectId,
          xcpNgPoolFeedEventType: isArchived
            ? XcpNgPoolFeedEventType.XcpNgPoolArchived
            : XcpNgPoolFeedEventType.XcpNgPoolRestored,
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

        await XcpNgPoolFeedService.createXcpNgPoolFeedItem({
          xcpNgPoolId: xcpNgPoolId,
          projectId: projectId,
          xcpNgPoolFeedEventType: XcpNgPoolFeedEventType.XcpNgPoolUpdated,
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

export default new Service();
