import DatabaseService from "./DatabaseService";
import KubernetesClusterLabelRuleEngineService from "./KubernetesClusterLabelRuleEngineService";
import KubernetesClusterOwnerRuleEngineService from "./KubernetesClusterOwnerRuleEngineService";
import RunbookCredentialService from "./RunbookCredentialService";
import RunnerService from "./RunnerService";
import Model from "../../Models/DatabaseModels/KubernetesCluster";
import Label from "../../Models/DatabaseModels/Label";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../Models/DatabaseModels/Runner";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import BadDataException from "../../Types/Exception/BadDataException";
import RunbookCredentialType from "../../Types/Runbook/RunbookCredentialType";
import KubernetesClusterFeedService from "./KubernetesClusterFeedService";
import { KubernetesClusterFeedEventType } from "../../Models/DatabaseModels/KubernetesClusterFeed";
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

const LAST_SEEN_CACHE_NAMESPACE: string = "k8s-cluster-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "k8s-cluster-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * The two spellings each AI-access relation can arrive under: the FK column
 * server-side callers write, and the relation object the dashboard's forms
 * post. See RelationIdUtil for why a hook must read both.
 */
const AI_ACCESS_RUNNER_KEYS: Array<string> = [
  "aiAccessRunnerId",
  "aiAccessRunner",
];
const AI_ACCESS_CREDENTIAL_KEYS: Array<string> = [
  "aiAccessCredentialId",
  "aiAccessCredential",
];

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined =
      createBy.data.projectId ||
      createBy.data.project?.id ||
      createBy.props.tenantId ||
      undefined;

    await this.validateAiAccessBindingsBelongToProject({
      data: createBy.data as unknown as JSONObject,
      projectId,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = (updateBy.data || {}) as unknown as JSONObject;

    if (
      RelationIdUtil.isWritten(Object.keys(data), [
        ...AI_ACCESS_RUNNER_KEYS,
        ...AI_ACCESS_CREDENTIAL_KEYS,
      ])
    ) {
      /*
       * Root/API updates do not always carry a tenantId, so fall back to
       * the project of each cluster the query actually matches — a Runner
       * must belong to every one of them.
       */
      const projectIds: Array<ObjectID> = updateBy.props.tenantId
        ? [updateBy.props.tenantId]
        : await this.getProjectIdsForUpdateQuery(updateBy);

      for (const projectId of projectIds) {
        await this.validateAiAccessBindingsBelongToProject({
          data,
          projectId,
        });
      }

      /*
       * Nothing matched: there is no project to check against, and the
       * update will write nothing — unless the query was empty, which
       * would never happen through updateOneById. Fail closed on a
       * binding that cannot be checked.
       */
      if (projectIds.length === 0) {
        await this.validateAiAccessBindingsBelongToProject({
          data,
          projectId: undefined,
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  /*
   * aiAccessRunnerId / aiAccessCredentialId are editable through ordinary
   * CRUD by every member who may edit a cluster, and nothing in the
   * framework checks that a ManyToOne target belongs to the row's own
   * project (only the tenant relation itself is checked). Unchecked, a
   * member of project A could point a cluster at project B's Runner or
   * credential — and then read that Runner's name, liveness and status,
   * or that credential's name and type, through the relation join, and use
   * the FK as an existence oracle for foreign ids. Same class of guard as
   * MonitorProbeService ("Probe not found or it does not belong to this
   * project.") and IoTDeviceCredentialService.
   *
   * Clearing a binding (null) is always allowed.
   */
  @CaptureSpan()
  private async validateAiAccessBindingsBelongToProject(data: {
    data: JSONObject;
    projectId: ObjectID | undefined;
  }): Promise<void> {
    const runnerId: ObjectID | null = RelationIdUtil.readConsistent(
      data.data,
      AI_ACCESS_RUNNER_KEYS,
      "AI access Runner",
    );

    const credentialId: ObjectID | null = RelationIdUtil.readConsistent(
      data.data,
      AI_ACCESS_CREDENTIAL_KEYS,
      "AI access credential",
    );

    if (!runnerId && !credentialId) {
      return;
    }

    if (!data.projectId) {
      throw new BadDataException(
        "The project of this Kubernetes cluster could not be resolved, so its AI access Runner or credential cannot be checked.",
      );
    }

    if (runnerId) {
      const runner: Runner | null = await RunnerService.findOneBy({
        query: {
          _id: runnerId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true },
        props: { isRoot: true },
      });

      if (!runner) {
        throw new BadDataException(
          "Runner not found or it does not belong to this project.",
        );
      }
    }

    if (credentialId) {
      const credential: RunbookCredential | null =
        await RunbookCredentialService.findOneBy({
          query: {
            _id: credentialId.toString(),
            projectId: data.projectId,
          },
          select: { _id: true, credentialType: true },
          props: { isRoot: true },
        });

      if (!credential) {
        throw new BadDataException(
          "Credential not found or it does not belong to this project.",
        );
      }

      if (credential.credentialType !== RunbookCredentialType.Kubernetes) {
        throw new BadDataException(
          "The AI access credential must be a Kubernetes credential (API server URL and ServiceAccount token).",
        );
      }
    }
  }

  @CaptureSpan()
  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const clusters: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Record<string, ObjectID> = {};

    for (const cluster of clusters) {
      if (cluster.projectId) {
        projectIds[cluster.projectId.toString()] = cluster.projectId;
      }
    }

    return Object.values(projectIds);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await KubernetesClusterLabelRuleEngineService.applyRulesToKubernetesCluster(
            createdItem,
          );
        })
        .then(async () => {
          await KubernetesClusterOwnerRuleEngineService.applyRulesToKubernetesCluster(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying kubernetes cluster rules in KubernetesClusterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              kubernetesClusterId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this Kubernetes cluster looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeKubernetesClusterCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByClusterIdentifier(data: {
    projectId: ObjectID;
    clusterIdentifier: string;
  }): Promise<Model> {
    /*
     * Look up case-insensitively. The unique guard on name/clusterIdentifier
     * (checkUniqueColumnBy -> findWithSameText) compares case-insensitively,
     * so a case-sensitive lookup would miss an existing row on casing drift
     * (k8s.cluster.name), then fail to create it ("KubernetesCluster with the
     * same name already exists") and wedge ingest. Mirrors
     * LabelService.findOrCreateLabelByName. Unlike HostService we keep the
     * stored casing as-is: k8s.cluster.name is not normalized at ingest, so
     * lowering the identifier here would desync it from the raw-cased
     * resource.k8s.cluster.name attribute the detail page filters on.
     */
    const existingCluster: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        clusterIdentifier: QueryHelper.findWithSameText(data.clusterIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        clusterIdentifier: true,
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
      newCluster.name = data.clusterIdentifier;
      newCluster.clusterIdentifier = data.clusterIdentifier;
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
       * Race condition: another request created the cluster concurrently.
       * Re-fetch the existing cluster.
       */
      const reFetchedCluster: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          clusterIdentifier: QueryHelper.findWithSameText(
            data.clusterIdentifier,
          ),
        },
        select: {
          _id: true,
          projectId: true,
          clusterIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedCluster) {
        return reFetchedCluster;
      }

      throw new Error(
        "Failed to create or find cluster: " + data.clusterIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    clusterId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
    },
  ): Promise<void> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
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
      describe: `kubernetes cluster ${clusterId.toString()}`,
    });
  }

  /**
   * Additively attach labels to a Kubernetes cluster. Existing labels
   * are never removed — manual labels set via the UI survive ingest.
   * The set of labelIds passed in is fingerprinted and cached for 60s
   * so the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    kubernetesClusterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.kubernetesClusterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const clusterIdStr: string = data.kubernetesClusterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(clusterIdStr)
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
          .of(clusterIdStr)
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
        `KubernetesClusterService.attachLabels failed for cluster ${data.kubernetesClusterId.toString()}: ${
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
   * Display name for this Kubernetes cluster, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getKubernetesClusterName(data: {
    kubernetesClusterId: ObjectID;
  }): Promise<string> {
    const kubernetesCluster: Model | null = await this.findOneById({
      id: data.kubernetesClusterId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return kubernetesCluster?.name || "";
  }

  @CaptureSpan()
  public async getKubernetesClusterLinkInDashboard(
    projectId: ObjectID,
    kubernetesClusterId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/kubernetes/${kubernetesClusterId.toString()}`,
    );
  }

  /**
   * "[Kubernetes Cluster prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getKubernetesClusterMarkdownLink(
    projectId: ObjectID,
    kubernetesClusterId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getKubernetesClusterName({
      kubernetesClusterId: kubernetesClusterId,
    });
    const link: URL = await this.getKubernetesClusterLinkInDashboard(
      projectId,
      kubernetesClusterId,
    );

    return `[Kubernetes Cluster ${name}](${link.toString()})`;
  }

  private async writeKubernetesClusterCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const kubernetesClusterId: ObjectID | undefined =
      createdItem.id || undefined;

    if (!projectId || !kubernetesClusterId) {
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
      resourceTypeName: "Kubernetes cluster",
      resourceMarkdownLink: await this.getKubernetesClusterMarkdownLink(
        projectId,
        kubernetesClusterId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      identifierName: "Cluster identifier",
      identifierValue: createdItem.clusterIdentifier,
      description: createdItem.description,
    });

    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: kubernetesClusterId,
      projectId: projectId,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.KubernetesClusterCreated,
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
    this.writeKubernetesClusterUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  private async writeKubernetesClusterUpdatedFeed(
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

    for (const kubernetesClusterId of updatedItemIds) {
      const kubernetesCluster: Model | null = await this.findOneById({
        id: kubernetesClusterId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = kubernetesCluster?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: string =
        await this.getKubernetesClusterMarkdownLink(
          projectId,
          kubernetesClusterId,
        );

      if (isArchiveChange) {
        await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
          kubernetesClusterId: kubernetesClusterId,
          projectId: projectId,
          kubernetesClusterFeedEventType: isArchived
            ? KubernetesClusterFeedEventType.KubernetesClusterArchived
            : KubernetesClusterFeedEventType.KubernetesClusterRestored,
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

        await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
          kubernetesClusterId: kubernetesClusterId,
          projectId: projectId,
          kubernetesClusterFeedEventType:
            KubernetesClusterFeedEventType.KubernetesClusterUpdated,
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
