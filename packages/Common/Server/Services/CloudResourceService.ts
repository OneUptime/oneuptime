import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/CloudResource";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CloudResourceFeedService from "./CloudResourceFeedService";
import { CloudResourceFeedEventType } from "../../Models/DatabaseModels/CloudResourceFeed";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { Blue500, Gray500, Green500, Yellow500 } from "../../Types/BrandColors";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import CloudResourceLabelRuleEngineService from "./CloudResourceLabelRuleEngineService";
import CloudResourceOwnerRuleEngineService from "./CloudResourceOwnerRuleEngineService";

const LAST_SEEN_CACHE_NAMESPACE: string = "cloud-resource-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "cloud-resource-labels-applied";
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
     */
    const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -15,
    );

    const connectedResources: Array<Model> = await this.findBy({
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
  ): Promise<string> {
    const name: string = await this.getCloudResourceName({
      cloudResourceId: cloudResourceId,
    });
    const link: URL = await this.getCloudResourceLinkInDashboard(
      projectId,
      cloudResourceId,
    );

    return `[Cloud Resource ${name}](${link.toString()})`;
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
      identifierName: "Resource identifier",
      identifierValue: createdItem.resourceIdentifier,
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
    this.writeCloudResourceUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
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

      const resourceMarkdownLink: string =
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

export default new Service();
