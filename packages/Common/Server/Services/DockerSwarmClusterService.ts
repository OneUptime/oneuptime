import ProjectReferencesService from "./ProjectReferencesService";
import DockerSwarmClusterLabelRuleEngineService from "./DockerSwarmClusterLabelRuleEngineService";
import DockerSwarmClusterOwnerRuleEngineService from "./DockerSwarmClusterOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/DockerSwarmCluster";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import ResourceAiAccessSettings, {
  ResourceAiAccessFeedItem,
} from "../Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiDeleteCleanup from "../Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import AiResourceType from "../../Types/ResourceAiAgent/AiResourceType";
import DockerSwarmClusterFeedService from "./DockerSwarmClusterFeedService";
import { DockerSwarmClusterFeedEventType } from "../../Models/DatabaseModels/DockerSwarmClusterFeed";
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

const LAST_SEEN_CACHE_NAMESPACE: string = "docker-swarm-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string =
  "docker-swarm-cluster-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * A Docker Swarm cluster is matched to its telemetry by its name (docker.swarm.cluster.name),
 * so a rename is held to the rules a new Docker Swarm cluster is: no spaces around
 * it, never blank, and never another Docker Swarm cluster's name
 * (DiscoveredResourceUpdate).
 */
const DOCKER_SWARM_CLUSTER_MATCH_COLUMN: MatchColumn = matchedOnName({
  resourceName: "Docker Swarm cluster",
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
      matchColumn: DOCKER_SWARM_CLUSTER_MATCH_COLUMN,
    });
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
          await DockerSwarmClusterLabelRuleEngineService.applyRulesToDockerSwarmCluster(
            createdItem,
          );
        })
        .then(async () => {
          await DockerSwarmClusterOwnerRuleEngineService.applyRulesToDockerSwarmCluster(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying dockerSwarm cluster rules in DockerSwarmClusterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              dockerSwarmClusterId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this Docker Swarm cluster looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeDockerSwarmClusterCreatedFeed(createdItem, onCreate).catch(
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
     * A DockerSwarm cluster is keyed by the `docker.swarm.cluster.name` OTel resource
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

      throw new Error("Failed to create or find DockerSwarm cluster: " + name);
    }
  }

  /*
   * Refresh lastSeenAt / connection status and (optionally) the
   * snapshot columns the list page renders. Count columns ride this
   * extras path with COALESCE-per-column semantics: a key that is
   * undefined is simply not written, so a partial batch (one that
   * lacked the matching *_info series) never zeroes a count. The
   * 60-second extras fingerprint cache is the write throttle — the
   * steady state (identical snapshot every scrape) costs one Redis
   * read per batch and at most one Postgres UPDATE per minute.
   *
   * Two callers share this throttle with DISJOINT extras shapes: the
   * inventory snapshot flush (counts, every batch) and the fenced
   * autoDiscoverDockerSwarmCluster maintenance path (agentVersion only —
   * the oneuptime.agent.version the shipped agent config stamps from
   * APP_VERSION). The single
   * fingerprint covers the whole extras object, so each alternation
   * between the two shapes busts the throttle: at most one extra
   * Postgres UPDATE per maintenance-fence window (~5 min), which is
   * accepted. Do NOT key the cache per-caller — that would let two
   * callers each refresh lastSeenAt under their own throttle and is
   * not worth the complexity for one UPDATE per 5 minutes.
   */
  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      dockerVersion?: string | undefined;
      swarmId?: string | undefined;
      agentVersion?: string | undefined;
      nodeCount?: number | undefined;
      readyNodeCount?: number | undefined;
      managerNodeCount?: number | undefined;
      serviceCount?: number | undefined;
      taskCount?: number | undefined;
      runningTaskCount?: number | undefined;
      stackCount?: number | undefined;
      networkCount?: number | undefined;
    },
  ): Promise<void> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          dockerVersion: extra?.dockerVersion ?? null,
          swarmId: extra?.swarmId ?? null,
          agentVersion: extra?.agentVersion ?? null,
          nodeCount: extra?.nodeCount ?? null,
          readyNodeCount: extra?.readyNodeCount ?? null,
          managerNodeCount: extra?.managerNodeCount ?? null,
          serviceCount: extra?.serviceCount ?? null,
          taskCount: extra?.taskCount ?? null,
          runningTaskCount: extra?.runningTaskCount ?? null,
          stackCount: extra?.stackCount ?? null,
          networkCount: extra?.networkCount ?? null,
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

    if (extra?.dockerVersion) {
      metadata.dockerVersion = extra.dockerVersion;
    }
    if (extra?.swarmId) {
      metadata.swarmId = extra.swarmId;
    }
    if (extra?.agentVersion) {
      metadata.agentVersion = extra.agentVersion;
    }
    // Counts: 0 is a legitimate value — gate on undefined, not falsiness.
    if (extra?.nodeCount !== undefined) {
      metadata.nodeCount = extra.nodeCount;
    }
    if (extra?.readyNodeCount !== undefined) {
      metadata.readyNodeCount = extra.readyNodeCount;
    }
    if (extra?.managerNodeCount !== undefined) {
      metadata.managerNodeCount = extra.managerNodeCount;
    }
    if (extra?.serviceCount !== undefined) {
      metadata.serviceCount = extra.serviceCount;
    }
    if (extra?.taskCount !== undefined) {
      metadata.taskCount = extra.taskCount;
    }
    if (extra?.runningTaskCount !== undefined) {
      metadata.runningTaskCount = extra.runningTaskCount;
    }
    if (extra?.stackCount !== undefined) {
      metadata.stackCount = extra.stackCount;
    }
    if (extra?.networkCount !== undefined) {
      metadata.networkCount = extra.networkCount;
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
      describe: `docker swarm cluster ${clusterId.toString()}`,
    });
  }

  /**
   * Additively attach labels to a DockerSwarm cluster. Existing labels are
   * never removed — manual labels set via the UI survive ingest. The
   * set of labelIds passed in is fingerprinted and cached for 60s so
   * the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    dockerSwarmClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.dockerSwarmClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const dockerSwarmClusterIdStr: string =
        data.dockerSwarmClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(dockerSwarmClusterIdStr)
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
          .of(dockerSwarmClusterIdStr)
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
        `DockerSwarmClusterService.attachLabels failed for dockerSwarm cluster ${data.dockerSwarmClusterId.toString()}: ${
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
    /*
     * Measured in time OneUptime was receiving: a stretch when OneUptime
     * itself was down, starting up or catching up on its ingest queue is
     * not silence held against the resource (issue #2825). With no such
     * stretch this is exactly 15 minutes ago.
     */
    const silenceCutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: 15,
    });

    const connectedClusters: Array<Model> = await this.findBy({
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
   * Display name for this Docker Swarm cluster, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getDockerSwarmClusterName(data: {
    dockerSwarmClusterId: ObjectID;
  }): Promise<string> {
    const dockerSwarmCluster: Model | null = await this.findOneById({
      id: data.dockerSwarmClusterId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return dockerSwarmCluster?.name || "";
  }

  @CaptureSpan()
  public async getDockerSwarmClusterLinkInDashboard(
    projectId: ObjectID,
    dockerSwarmClusterId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/docker-swarm/${dockerSwarmClusterId.toString()}`,
    );
  }

  /**
   * "[Docker Swarm Cluster prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getDockerSwarmClusterMarkdownLink(
    projectId: ObjectID,
    dockerSwarmClusterId: ObjectID,
  ): Promise<MarkdownText> {
    const name: string = await this.getDockerSwarmClusterName({
      dockerSwarmClusterId: dockerSwarmClusterId,
    });
    const link: URL = await this.getDockerSwarmClusterLinkInDashboard(
      projectId,
      dockerSwarmClusterId,
    );

    return mdText`[Docker Swarm Cluster ${name}](${link.toString()})`;
  }

  private async writeDockerSwarmClusterCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const dockerSwarmClusterId: ObjectID | undefined =
      createdItem.id || undefined;

    if (!projectId || !dockerSwarmClusterId) {
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
      resourceTypeName: "Docker Swarm cluster",
      resourceMarkdownLink: await this.getDockerSwarmClusterMarkdownLink(
        projectId,
        dockerSwarmClusterId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      description: createdItem.description,
    });

    await DockerSwarmClusterFeedService.createDockerSwarmClusterFeedItem({
      dockerSwarmClusterId: dockerSwarmClusterId,
      projectId: projectId,
      dockerSwarmClusterFeedEventType:
        DockerSwarmClusterFeedEventType.DockerSwarmClusterCreated,
      displayColor: Green500,
      feedInfoInMarkdown: markdown.feedInfoInMarkdown,
      moreInformationInMarkdown: markdown.moreInformationInMarkdown,
      userId: createdByUserId,
    });
  }

  /*
   * Deleting a Docker Swarm cluster settles its in-flight AI remediation rounds
   * and removes its resource AI agent — read before the delete, done after it
   * for the Docker Swarm clusters actually deleted (ResourceAiDeleteCleanup,
   * shared by every resource AI agent's resource).
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    return {
      deleteBy,
      carryForward: await ResourceAiDeleteCleanup.beforeDelete({
        resourceType: AiResourceType.DockerSwarmCluster,
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
      resourceType: AiResourceType.DockerSwarmCluster,
      onDelete,
      deletedItemIds,
    });

    return onDelete;
  }

  /*
   * A create is held to the same AI access rules as an update, judged
   * against the never-configured defaults a new Docker Swarm cluster starts from: an
   * unusable mode or allowlist is refused for every caller, and the
   * server-only aiAccess* columns for every caller but root (a master admin
   * included, whom the create column ACLs never check).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    ResourceAiAccessSettings.checkCreate({
      resourceType: AiResourceType.DockerSwarmCluster,
      createBy,
    });

    return { createBy, carryForward: null };
  }

  /*
   * An operator's write of an AI access setting (the investigation switch, the
   * remediation mode, the command allowlist) is validated and checked against
   * who may make AI do more on this Docker Swarm cluster — the rules every
   * resource AI agent's resource shares (ResourceAiAccessSettings).
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    return {
      updateBy,
      carryForward: await ResourceAiAccessSettings.checkUpdate({
        resourceType: AiResourceType.DockerSwarmCluster,
        service: this,
        updateBy,
      }),
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    this.writeDockerSwarmClusterUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    /*
     * An operator's AI access write: recorded on the feed, and the Docker Swarm
     * cluster marked AI-configured.
     */
    await ResourceAiAccessSettings.afterUpdate({
      service: this,
      onUpdate,
      updatedItemIds,
      getResourceMarkdownLink: (
        projectId: ObjectID,
        dockerSwarmClusterId: ObjectID,
      ): Promise<MarkdownText> => {
        return this.getDockerSwarmClusterMarkdownLink(
          projectId,
          dockerSwarmClusterId,
        );
      },
      createFeedItem: async (item: ResourceAiAccessFeedItem): Promise<void> => {
        await DockerSwarmClusterFeedService.createDockerSwarmClusterFeedItem({
          dockerSwarmClusterId: item.resourceId,
          projectId: item.projectId,
          dockerSwarmClusterFeedEventType:
            DockerSwarmClusterFeedEventType.DockerSwarmClusterUpdated,
          displayColor: item.displayColor,
          feedInfoInMarkdown: item.feedInfoInMarkdown,
          moreInformationInMarkdown: item.moreInformationInMarkdown,
          userId: item.userId,
        });
      },
    });

    return onUpdate;
  }

  private async writeDockerSwarmClusterUpdatedFeed(
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

    for (const dockerSwarmClusterId of updatedItemIds) {
      const dockerSwarmCluster: Model | null = await this.findOneById({
        id: dockerSwarmClusterId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = dockerSwarmCluster?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: MarkdownText =
        await this.getDockerSwarmClusterMarkdownLink(
          projectId,
          dockerSwarmClusterId,
        );

      if (isArchiveChange) {
        await DockerSwarmClusterFeedService.createDockerSwarmClusterFeedItem({
          dockerSwarmClusterId: dockerSwarmClusterId,
          projectId: projectId,
          dockerSwarmClusterFeedEventType: isArchived
            ? DockerSwarmClusterFeedEventType.DockerSwarmClusterArchived
            : DockerSwarmClusterFeedEventType.DockerSwarmClusterRestored,
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

        await DockerSwarmClusterFeedService.createDockerSwarmClusterFeedItem({
          dockerSwarmClusterId: dockerSwarmClusterId,
          projectId: projectId,
          dockerSwarmClusterFeedEventType:
            DockerSwarmClusterFeedEventType.DockerSwarmClusterUpdated,
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
