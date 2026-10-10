import ProjectReferencesService from "./ProjectReferencesService";
import StorageArrayLabelRuleEngineService from "./StorageArrayLabelRuleEngineService";
import StorageArrayOwnerRuleEngineService from "./StorageArrayOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/StorageArray";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import StorageArrayFeedService from "./StorageArrayFeedService";
import { StorageArrayFeedEventType } from "../../Models/DatabaseModels/StorageArrayFeed";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ReceivingCoverage from "../Utils/Telemetry/ReceivingCoverage";
import DiscoveredResourceUpdate, {
  MatchColumn,
  matchedOnName,
} from "../Utils/Telemetry/DiscoveredResourceUpdate";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { mdText, MarkdownText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * The snapshot columns the metrics ingest (StorageArraySnapshotScan) and the
 * fenced discovery path refresh on a StorageArray row. Every key is optional:
 * an absent key is never written.
 */
export interface StorageArraySnapshotExtras {
  storageSystem?: string | undefined;
  reportedName?: string | undefined;
  systemId?: string | undefined;
  osName?: string | undefined;
  osVersion?: string | undefined;
  agentVersion?: string | undefined;
  capacityBytes?: number | undefined;
  usedBytes?: number | undefined;
  capacityUsedPercent?: number | undefined;
  dataReductionRatio?: number | undefined;
  openAlertCount?: number | undefined;
  criticalAlertCount?: number | undefined;
  warningAlertCount?: number | undefined;
  volumeCount?: number | undefined;
  hostCount?: number | undefined;
  podCount?: number | undefined;
  fileSystemCount?: number | undefined;
  bucketCount?: number | undefined;
  hardwareComponentCount?: number | undefined;
  unhealthyHardwareCount?: number | undefined;
  healthStatus?: number | undefined;
}

export const STORAGE_ARRAY_SNAPSHOT_KEYS: Array<
  keyof StorageArraySnapshotExtras
> = [
  "storageSystem",
  "reportedName",
  "systemId",
  "osName",
  "osVersion",
  "agentVersion",
  "capacityBytes",
  "usedBytes",
  "capacityUsedPercent",
  "dataReductionRatio",
  "openAlertCount",
  "criticalAlertCount",
  "warningAlertCount",
  "volumeCount",
  "hostCount",
  "podCount",
  "fileSystemCount",
  "bucketCount",
  "hardwareComponentCount",
  "unhealthyHardwareCount",
  "healthStatus",
];

const LAST_SEEN_CACHE_NAMESPACE: string = "storage-array-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "storage-array-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * A storage array is matched to its telemetry by its name
 * (storage.array.name), so a rename is held to the rules a new storage array
 * is: no spaces around it, never blank, and never another storage array's
 * name (DiscoveredResourceUpdate).
 */
const STORAGE_ARRAY_MATCH_COLUMN: MatchColumn = matchedOnName({
  resourceName: "storage array",
});

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeUpdateUniqueCheck(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await DiscoveredResourceUpdate.checkMatchColumn({
      service: this,
      updateBy,
      matchColumn: STORAGE_ARRAY_MATCH_COLUMN,
    });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Rules run once, on creation only — exact parity with
     * CephClusterService. Label engine first: it syncs the in-memory labels
     * so the owner engine can match rule-added labels.
     */
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await StorageArrayLabelRuleEngineService.applyRulesToStorageArray(
            createdItem,
          );
        })
        .then(async () => {
          await StorageArrayOwnerRuleEngineService.applyRulesToStorageArray(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying storage array rules in StorageArrayService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              storageArrayId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this storage array looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeStorageArrayCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByName(data: {
    projectId: ObjectID;
    name: string;
  }): Promise<Model> {
    /*
     * A storage array is keyed by the `storage.array.name` OTel resource
     * attribute, which the user configures on the agent. Look it up
     * case-insensitively: the unique guard (checkUniqueColumnBy ->
     * findWithSameText) compares case-insensitively, so a case-sensitive
     * lookup would miss an existing row that differs only by case, then
     * fail to create it — wedging ingest for that array. The configured
     * name's casing is stable, so we preserve the user's casing on create
     * instead of canonicalizing to lowercase (same as CephClusterService).
     */
    const name: string = data.name.trim();

    const existingArray: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        name: QueryHelper.findWithSameText(name),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingArray) {
      return existingArray;
    }

    try {
      const newArray: Model = new Model();
      newArray.projectId = data.projectId;
      newArray.name = name;
      newArray.otelCollectorStatus = "connected";
      newArray.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdArray: Model = await this.create({
        data: newArray,
        props: {
          isRoot: true,
        },
      });

      return createdArray;
    } catch {
      /*
       * Either two ingest workers raced to create the same array (an
       * agent's array, volumes and hosts scrapes all arrive at once), or an
       * array with this name in a different case already existed and the
       * unique guard rejected the insert. Re-resolve case-insensitively so
       * the caller still gets the existing row instead of throwing.
       */
      const reFetchedArray: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          name: QueryHelper.findWithSameText(name),
        },
        select: {
          _id: true,
          projectId: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedArray) {
        return reFetchedArray;
      }

      throw new Error("Failed to create or find storage array: " + name);
    }
  }

  /*
   * Refresh lastSeenAt / connection status and (optionally) the snapshot
   * columns the list page renders. Identity, count, health and capacity
   * columns ride this extras path with COALESCE-per-column semantics: a key
   * that is undefined is simply not written, so a partial batch (a
   * FlashArray's /metrics/volumes scrape carries no alert or capacity
   * series) never zeroes a column.
   *
   * One array reports through several scrape jobs — a FlashArray's array,
   * volumes, hosts, pods and directories endpoints, a FlashBlade's array,
   * file system and object store endpoints — and each job's batch carries a
   * different SHAPE of extras (only the volumes scrape can count volumes).
   * ResourceHeartbeat admits one enrichment write per window per cache key,
   * so with a single key the first shape to arrive in each window would win
   * and the others would be dropped — volumeCount could go stale for as
   * long as the volumes batch kept arriving second. The heartbeat is
   * therefore keyed per shape (the set of extras keys present): each scrape
   * job gets its own window, bounding writes at one per job per window,
   * never one per batch. The fenced autoDiscoverStorageArray maintenance
   * path is one more shape — agentVersion alone, the oneuptime.agent.version
   * every shipped agent config stamps — so the version lands in a window of
   * its own instead of waiting behind a scrape's snapshot.
   */
  @CaptureSpan()
  public async updateLastSeen(
    arrayId: ObjectID,
    extra?: StorageArraySnapshotExtras,
  ): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
      otelCollectorStatus: "connected",
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};

    for (const key of STORAGE_ARRAY_SNAPSHOT_KEYS) {
      const value: string | number | undefined = extra?.[key];

      if (typeof value === "string") {
        // A blank string is never a better answer than the last one.
        if (value.trim()) {
          metadata[key] = value;
        }
        continue;
      }

      /*
       * Counts, health and capacity: 0 is a legitimate value (healthStatus
       * 0 = OK, volumeCount 0 = an empty array) — gate on undefined, not
       * falsiness. NaN and ±Infinity never reach Postgres: an integer
       * column rejects them, and the whole heartbeat write with them.
       */
      if (typeof value === "number" && Number.isFinite(value)) {
        metadata[key] = value;
      }
    }

    /*
     * The fingerprint and the shape are both taken from what is actually
     * written, so a value dropped above (a blank string, a NaN) neither
     * busts the fingerprint nor opens a heartbeat window of its own.
     */
    const fingerprintSource: JSONObject = {};
    const presentKeys: Array<string> = [];
    for (const key of STORAGE_ARRAY_SNAPSHOT_KEYS) {
      fingerprintSource[key] = metadata[key] ?? null;
      if (metadata[key] !== undefined) {
        presentKeys.push(key);
      }
    }

    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(JSON.stringify(fingerprintSource))
      .digest("hex");

    const shapeSuffix: string =
      presentKeys.length > 0
        ? "-" +
          crypto
            .createHash("sha1")
            .update(presentKeys.join(","))
            .digest("hex")
            .substring(0, 12)
        : "";

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: arrayId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE + shapeSuffix,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `storage array ${arrayId.toString()}`,
    });
  }

  /**
   * Additively attach labels to a storage array. Existing labels are never
   * removed — manual labels set via the UI survive ingest. The set of
   * labelIds passed in is fingerprinted and cached for 60s so the common
   * case (steady-state collector pushing the same label set every batch)
   * costs one in-memory lookup, not a join-table scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    storageArrayId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.storageArrayId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const storageArrayIdStr: string = data.storageArrayId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(storageArrayIdStr)
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
          .of(storageArrayIdStr)
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
        `StorageArrayService.attachLabels failed for storage array ${data.storageArrayId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedArrays(): Promise<void> {
    /*
     * Threshold must stay well above the 5-minute OTel ingest maintenance
     * fence (MAINTENANCE_FENCE_TTL_SECONDS in OtelIngestBaseService) —
     * lastSeenAt is legitimately up to ~5 minutes stale during continuous
     * telemetry, so a threshold equal to the fence TTL flaps healthy
     * resources. 15 minutes gives 3x headroom, and stays above the agent's
     * slowest regular scrape interval (volumes, hosts and pods: 2 minutes).
     */
    /*
     * Measured in time OneUptime was receiving: a stretch when OneUptime
     * itself was down, starting up or catching up on its ingest queue is
     * not silence held against the resource (issue #2825). With no such
     * stretch this is exactly 15 minutes ago.
     */
    const silenceCutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: 15,
    });

    const connectedArrays: Array<Model> = await this.findBy({
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

    for (const array of connectedArrays) {
      if (array._id) {
        await this.updateOneById({
          id: new ObjectID(array._id.toString()),
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
   * Display name for this storage array, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row
   * must not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getStorageArrayName(data: {
    storageArrayId: ObjectID;
  }): Promise<string> {
    const storageArray: Model | null = await this.findOneById({
      id: data.storageArrayId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return storageArray?.name || "";
  }

  @CaptureSpan()
  public async getStorageArrayLinkInDashboard(
    projectId: ObjectID,
    storageArrayId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/storage-arrays/${storageArrayId.toString()}`,
    );
  }

  /**
   * "[Storage Array pure-prod-01](https://…)" - the form every feed item
   * uses to name the resource it is about.
   */
  @CaptureSpan()
  public async getStorageArrayMarkdownLink(
    projectId: ObjectID,
    storageArrayId: ObjectID,
  ): Promise<MarkdownText> {
    const name: string = await this.getStorageArrayName({
      storageArrayId: storageArrayId,
    });
    const link: URL = await this.getStorageArrayLinkInDashboard(
      projectId,
      storageArrayId,
    );

    return mdText`[Storage Array ${name}](${link.toString()})`;
  }

  private async writeStorageArrayCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const storageArrayId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !storageArrayId) {
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
      resourceTypeName: "storage array",
      resourceMarkdownLink: await this.getStorageArrayMarkdownLink(
        projectId,
        storageArrayId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      description: createdItem.description,
    });

    await StorageArrayFeedService.createStorageArrayFeedItem({
      storageArrayId: storageArrayId,
      projectId: projectId,
      storageArrayFeedEventType: StorageArrayFeedEventType.StorageArrayCreated,
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
    this.writeStorageArrayUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  private async writeStorageArrayUpdatedFeed(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<void> {
    const updateData: JSONObject = onUpdate.updateBy
      .data as unknown as JSONObject;

    /*
     * Heartbeats update lastSeenAt / otelCollectorStatus / agentVersion and
     * the snapshot columns constantly. Only the columns a person would
     * recognise as a change earn a feed item - see
     * MEANINGFUL_UPDATE_COLUMNS.
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

    for (const storageArrayId of updatedItemIds) {
      const storageArray: Model | null = await this.findOneById({
        id: storageArrayId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = storageArray?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: MarkdownText =
        await this.getStorageArrayMarkdownLink(projectId, storageArrayId);

      if (isArchiveChange) {
        await StorageArrayFeedService.createStorageArrayFeedItem({
          storageArrayId: storageArrayId,
          projectId: projectId,
          storageArrayFeedEventType: isArchived
            ? StorageArrayFeedEventType.StorageArrayArchived
            : StorageArrayFeedEventType.StorageArrayRestored,
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

        await StorageArrayFeedService.createStorageArrayFeedItem({
          storageArrayId: storageArrayId,
          projectId: projectId,
          storageArrayFeedEventType:
            StorageArrayFeedEventType.StorageArrayUpdated,
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
