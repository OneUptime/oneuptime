import DatabaseService from "./DatabaseService";
import CephClusterLabelRuleEngineService from "./CephClusterLabelRuleEngineService";
import CephClusterOwnerRuleEngineService from "./CephClusterOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/CephCluster";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CephClusterFeedService from "./CephClusterFeedService";
import { CephClusterFeedEventType } from "../../Models/DatabaseModels/CephClusterFeed";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";

const LAST_SEEN_CACHE_NAMESPACE: string = "ceph-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "ceph-cluster-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Rules run once, on creation only — exact parity with
     * KubernetesClusterService. Label engine first: it syncs the
     * in-memory labels so the owner engine can match rule-added labels.
     */
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await CephClusterLabelRuleEngineService.applyRulesToCephCluster(
            createdItem,
          );
        })
        .then(async () => {
          await CephClusterOwnerRuleEngineService.applyRulesToCephCluster(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying ceph cluster rules in CephClusterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              cephClusterId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this Ceph cluster looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeCephClusterCreatedFeed(createdItem, onCreate).catch(
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
     * A Ceph cluster is keyed by the `ceph.cluster.name` OTel resource
     * attribute, which the user configures on the agent. Look it up
     * case-insensitively: the unique guard (checkUniqueColumnBy ->
     * findWithSameText) compares case-insensitively, so a case-sensitive
     * lookup would miss an existing row that differs only by case, then
     * fail to create it — wedging ingest for that cluster. Unlike
     * DockerHost.hostIdentifier (host.name casing is unstable on Windows)
     * the configured cluster name's casing is stable, so we preserve the
     * user's casing on create instead of canonicalizing to lowercase.
     */
    const name: string = data.name.trim();

    const existingCluster: Model | null = await this.findOneBy({
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

    if (existingCluster) {
      return existingCluster;
    }

    try {
      // Create new cluster
      const newCluster: Model = new Model();
      newCluster.projectId = data.projectId;
      newCluster.name = name;
      newCluster.otelCollectorStatus = "connected";
      newCluster.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdCluster: Model = await this.create({
        data: newCluster,
        props: {
          isRoot: true,
        },
      });

      return createdCluster;
    } catch {
      /*
       * Either two ingest workers raced to create the same cluster, or a
       * cluster with this name in a different case already existed and the
       * unique guard rejected the insert. Re-resolve case-insensitively so
       * the caller still gets the existing row instead of throwing.
       */
      const reFetchedCluster: Model | null = await this.findOneBy({
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

      if (reFetchedCluster) {
        return reFetchedCluster;
      }

      throw new Error("Failed to create or find Ceph cluster: " + name);
    }
  }

  /*
   * Refresh lastSeenAt / connection status and (optionally) the
   * snapshot columns the list page renders. Count/health columns ride
   * this extras path with COALESCE-per-column semantics: a key that is
   * undefined is simply not written, so a partial batch (one that
   * lacked the matching *_metadata series) never zeroes a count. The
   * 60-second extras fingerprint cache is the write throttle — the
   * steady state (identical snapshot every scrape) costs one Redis
   * read per batch and at most one Postgres UPDATE per minute.
   *
   * Two callers share this throttle with DISJOINT extras shapes: the
   * metrics snapshot flush (version + counts/health, every batch) and
   * the fenced autoDiscoverCephCluster maintenance path (agentVersion
   * + optional fsid only — and usually an all-null fingerprint, since
   * the shipped agent config stamps neither oneuptime.agent.version
   * nor ceph.cluster.fsid by default). The single fingerprint covers
   * the whole extras object, so each alternation between the two
   * shapes busts the throttle: at most one extra Postgres UPDATE per
   * maintenance-fence window (~5 min), which is accepted. Do NOT key
   * the cache per-caller — that would let two callers each refresh
   * lastSeenAt under their own throttle and is not worth the
   * complexity for one UPDATE per 5 minutes.
   */
  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      cephVersion?: string | undefined;
      fsid?: string | undefined;
      agentVersion?: string | undefined;
      monCount?: number | undefined;
      osdCount?: number | undefined;
      osdUpCount?: number | undefined;
      osdInCount?: number | undefined;
      poolCount?: number | undefined;
      healthStatus?: number | undefined;
      capacityUsedPercent?: number | undefined;
    },
  ): Promise<void> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          cephVersion: extra?.cephVersion ?? null,
          fsid: extra?.fsid ?? null,
          agentVersion: extra?.agentVersion ?? null,
          monCount: extra?.monCount ?? null,
          osdCount: extra?.osdCount ?? null,
          osdUpCount: extra?.osdUpCount ?? null,
          osdInCount: extra?.osdInCount ?? null,
          poolCount: extra?.poolCount ?? null,
          healthStatus: extra?.healthStatus ?? null,
          capacityUsedPercent: extra?.capacityUsedPercent ?? null,
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

    if (extra?.cephVersion) {
      metadata.cephVersion = extra.cephVersion;
    }
    if (extra?.fsid) {
      metadata.fsid = extra.fsid;
    }
    if (extra?.agentVersion) {
      metadata.agentVersion = extra.agentVersion;
    }
    /*
     * Counts and health: 0 is a legitimate value (healthStatus 0 = OK,
     * osdUpCount 0 = every OSD down) — gate on undefined, not falsiness.
     */
    if (extra?.monCount !== undefined) {
      metadata.monCount = extra.monCount;
    }
    if (extra?.osdCount !== undefined) {
      metadata.osdCount = extra.osdCount;
    }
    if (extra?.osdUpCount !== undefined) {
      metadata.osdUpCount = extra.osdUpCount;
    }
    if (extra?.osdInCount !== undefined) {
      metadata.osdInCount = extra.osdInCount;
    }
    if (extra?.poolCount !== undefined) {
      metadata.poolCount = extra.poolCount;
    }
    if (extra?.healthStatus !== undefined) {
      metadata.healthStatus = extra.healthStatus;
    }
    if (extra?.capacityUsedPercent !== undefined) {
      metadata.capacityUsedPercent = extra.capacityUsedPercent;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: clusterId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `ceph cluster ${clusterId.toString()}`,
    });
  }

  /**
   * Additively attach labels to a Ceph cluster. Existing labels are
   * never removed — manual labels set via the UI survive ingest. The
   * set of labelIds passed in is fingerprinted and cached for 60s so
   * the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    cephClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.cephClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const cephClusterIdStr: string = data.cephClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(cephClusterIdStr)
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
          .of(cephClusterIdStr)
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
        `CephClusterService.attachLabels failed for ceph cluster ${data.cephClusterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedClusters(): Promise<void> {
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom.
     */
    const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -15,
    );

    const connectedClusters: Array<Model> = await this.findBy({
      query: {
        otelCollectorStatus: "connected",
        lastSeenAt: QueryHelper.lessThan(fifteenMinutesAgo),
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

    for (const cluster of connectedClusters) {
      if (cluster._id) {
        await this.updateOneById({
          id: new ObjectID(cluster._id.toString()),
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
   * Display name for this Ceph cluster, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getCephClusterName(data: {
    cephClusterId: ObjectID;
  }): Promise<string> {
    const cephCluster: Model | null = await this.findOneById({
      id: data.cephClusterId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return cephCluster?.name || "";
  }

  @CaptureSpan()
  public async getCephClusterLinkInDashboard(
    projectId: ObjectID,
    cephClusterId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/ceph/${cephClusterId.toString()}`,
    );
  }

  /**
   * "[Ceph Cluster prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getCephClusterMarkdownLink(
    projectId: ObjectID,
    cephClusterId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getCephClusterName({
      cephClusterId: cephClusterId,
    });
    const link: URL = await this.getCephClusterLinkInDashboard(
      projectId,
      cephClusterId,
    );

    return `[Ceph Cluster ${name}](${link.toString()})`;
  }

  private async writeCephClusterCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const cephClusterId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !cephClusterId) {
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
      resourceTypeName: "Ceph cluster",
      resourceMarkdownLink: await this.getCephClusterMarkdownLink(
        projectId,
        cephClusterId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      description: createdItem.description,
    });

    await CephClusterFeedService.createCephClusterFeedItem({
      cephClusterId: cephClusterId,
      projectId: projectId,
      cephClusterFeedEventType: CephClusterFeedEventType.CephClusterCreated,
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
    this.writeCephClusterUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  private async writeCephClusterUpdatedFeed(
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

    for (const cephClusterId of updatedItemIds) {
      const cephCluster: Model | null = await this.findOneById({
        id: cephClusterId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = cephCluster?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: string =
        await this.getCephClusterMarkdownLink(projectId, cephClusterId);

      if (isArchiveChange) {
        await CephClusterFeedService.createCephClusterFeedItem({
          cephClusterId: cephClusterId,
          projectId: projectId,
          cephClusterFeedEventType: isArchived
            ? CephClusterFeedEventType.CephClusterArchived
            : CephClusterFeedEventType.CephClusterRestored,
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

        await CephClusterFeedService.createCephClusterFeedItem({
          cephClusterId: cephClusterId,
          projectId: projectId,
          cephClusterFeedEventType: CephClusterFeedEventType.CephClusterUpdated,
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
