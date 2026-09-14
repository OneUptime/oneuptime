import DatabaseService from "./DatabaseService";
import VMwareVCenterLabelRuleEngineService from "./VMwareVCenterLabelRuleEngineService";
import VMwareVCenterOwnerRuleEngineService from "./VMwareVCenterOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/VMwareVCenter";
import Label from "../../Models/DatabaseModels/Label";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import VMwareVCenterFeedService from "./VMwareVCenterFeedService";
import { VMwareVCenterFeedEventType } from "../../Models/DatabaseModels/VMwareVCenterFeed";
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

const LAST_SEEN_CACHE_NAMESPACE: string = "vmware-vcenter-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "vmware-vcenter-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/**
 * The snapshot columns the metrics ingest flush (and the fenced
 * autoDiscoverVMwareVCenter maintenance path) can refresh alongside the
 * liveness heartbeat. Every count is a whole-inventory rollup computed by
 * deriveVMwareVCenterSnapshotExtras; a key that is absent means "this batch
 * did not carry that kind of resource" and must leave the column alone.
 */
export interface VMwareVCenterLastSeenExtras {
  agentVersion?: string | undefined;
  datacenterCount?: number | undefined;
  clusterCount?: number | undefined;
  hostCount?: number | undefined;
  vmCount?: number | undefined;
  poweredOnVmCount?: number | undefined;
  datastoreCount?: number | undefined;
  resourcePoolCount?: number | undefined;
  datastoreCapacityBytes?: number | undefined;
  datastoreUsedBytes?: number | undefined;
}

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
          await VMwareVCenterLabelRuleEngineService.applyRulesToVMwareVCenter(
            createdItem,
          );
        })
        .then(async () => {
          await VMwareVCenterOwnerRuleEngineService.applyRulesToVMwareVCenter(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying vCenter rules in VMwareVCenterService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              vmwareVCenterId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this vCenter looks like now; only the
     * feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeVMwareVCenterCreatedFeed(createdItem, onCreate).catch(
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
     * A vCenter is keyed by the `vmware.vcenter.name` OTel resource
     * attribute, which the user configures on the VMware Agent
     * (VMWARE_VCENTER_NAME). Look it up case-insensitively: the unique
     * guard (checkUniqueColumnBy -> findWithSameText) compares
     * case-insensitively, so a case-sensitive lookup would miss an existing
     * row that differs only by case, then fail to create it — wedging
     * ingest for that vCenter. Unlike DockerHost.hostIdentifier (host.name
     * casing is unstable on Windows) the configured vCenter name's casing
     * is stable, so we preserve the user's casing on create instead of
     * canonicalizing to lowercase.
     */
    const name: string = data.name.trim();

    const existingVCenter: Model | null = await this.findOneBy({
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

    if (existingVCenter) {
      return existingVCenter;
    }

    try {
      // Create new vCenter
      const newVCenter: Model = new Model();
      newVCenter.projectId = data.projectId;
      newVCenter.name = name;
      newVCenter.otelCollectorStatus = "connected";
      newVCenter.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdVCenter: Model = await this.create({
        data: newVCenter,
        props: {
          isRoot: true,
        },
      });

      return createdVCenter;
    } catch {
      /*
       * Either two ingest workers raced to create the same vCenter, or a
       * vCenter with this name in a different case already existed and the
       * unique guard rejected the insert. Re-resolve case-insensitively so
       * the caller still gets the existing row instead of throwing.
       */
      const reFetchedVCenter: Model | null = await this.findOneBy({
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

      if (reFetchedVCenter) {
        return reFetchedVCenter;
      }

      throw new Error("Failed to create or find vCenter: " + name);
    }
  }

  /*
   * Refresh lastSeenAt / connection status and (optionally) the
   * snapshot columns the list page renders. Count columns ride this
   * extras path with COALESCE-per-column semantics: a key that is
   * undefined is simply not written, so a partial batch (one that
   * carried no resource of that kind) never zeroes a count. The
   * 60-second extras fingerprint cache is the write throttle — the
   * steady state (identical snapshot every collection) costs one Redis
   * read per batch and at most one Postgres UPDATE per minute.
   *
   * Two callers share this throttle with DISJOINT extras shapes: the
   * metrics snapshot flush (inventory counts + datastore capacity, every
   * batch) and the fenced autoDiscoverVMwareVCenter maintenance path
   * (agentVersion only — and usually an all-null fingerprint, since the
   * shipped agent config does not stamp oneuptime.agent.version). The
   * single fingerprint covers the whole extras object, so each alternation
   * between the two shapes busts the throttle: at most one extra Postgres
   * UPDATE per maintenance-fence window (~5 min), which is accepted. Do
   * NOT key the cache per-caller — that would let two callers each refresh
   * lastSeenAt under their own throttle and is not worth the complexity
   * for one UPDATE per 5 minutes.
   */
  @CaptureSpan()
  public async updateLastSeen(
    vcenterId: ObjectID,
    extra?: VMwareVCenterLastSeenExtras,
  ): Promise<void> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
          datacenterCount: extra?.datacenterCount ?? null,
          clusterCount: extra?.clusterCount ?? null,
          hostCount: extra?.hostCount ?? null,
          vmCount: extra?.vmCount ?? null,
          poweredOnVmCount: extra?.poweredOnVmCount ?? null,
          datastoreCount: extra?.datastoreCount ?? null,
          resourcePoolCount: extra?.resourcePoolCount ?? null,
          datastoreCapacityBytes: extra?.datastoreCapacityBytes ?? null,
          datastoreUsedBytes: extra?.datastoreUsedBytes ?? null,
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
     * Counts and byte totals: 0 is a legitimate value (an empty datacenter,
     * every VM powered off) — gate on undefined, not falsiness.
     */
    if (extra?.datacenterCount !== undefined) {
      metadata.datacenterCount = extra.datacenterCount;
    }
    if (extra?.clusterCount !== undefined) {
      metadata.clusterCount = extra.clusterCount;
    }
    if (extra?.hostCount !== undefined) {
      metadata.hostCount = extra.hostCount;
    }
    if (extra?.vmCount !== undefined) {
      metadata.vmCount = extra.vmCount;
    }
    if (extra?.poweredOnVmCount !== undefined) {
      metadata.poweredOnVmCount = extra.poweredOnVmCount;
    }
    if (extra?.datastoreCount !== undefined) {
      metadata.datastoreCount = extra.datastoreCount;
    }
    if (extra?.resourcePoolCount !== undefined) {
      metadata.resourcePoolCount = extra.resourcePoolCount;
    }
    if (extra?.datastoreCapacityBytes !== undefined) {
      metadata.datastoreCapacityBytes = extra.datastoreCapacityBytes;
    }
    if (extra?.datastoreUsedBytes !== undefined) {
      metadata.datastoreUsedBytes = extra.datastoreUsedBytes;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    await ResourceHeartbeat.write({
      service: this,
      id: vcenterId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `vcenter ${vcenterId.toString()}`,
    });
  }

  /**
   * Additively attach labels to a vCenter. Existing labels are never
   * removed — manual labels set via the UI survive ingest. The set of
   * labelIds passed in is fingerprinted and cached for 60s so the common
   * case (steady-state collector pushing the same label set every batch)
   * costs one in-memory lookup, not a join-table scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    vmwareVCenterId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.vmwareVCenterId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const vmwareVCenterIdStr: string = data.vmwareVCenterId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(vmwareVCenterIdStr)
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
          .of(vmwareVCenterIdStr)
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
        `VMwareVCenterService.attachLabels failed for vCenter ${data.vmwareVCenterId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedVCenters(): Promise<void> {
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom, and is also well above the receiver's default
     * 2-minute collection interval.
     */
    const fifteenMinutesAgo: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -15,
    );

    const connectedVCenters: Array<Model> = await this.findBy({
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

    for (const vcenter of connectedVCenters) {
      if (vcenter._id) {
        await this.updateOneById({
          id: new ObjectID(vcenter._id.toString()),
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
   * Display name for this vCenter, or an empty string when the row is gone.
   * Feed writers call this on a best-effort basis, so a missing row must not
   * throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getVMwareVCenterName(data: {
    vmwareVCenterId: ObjectID;
  }): Promise<string> {
    const vmwareVCenter: Model | null = await this.findOneById({
      id: data.vmwareVCenterId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return vmwareVCenter?.name || "";
  }

  @CaptureSpan()
  public async getVMwareVCenterLinkInDashboard(
    projectId: ObjectID,
    vmwareVCenterId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/vmware/${vmwareVCenterId.toString()}`,
    );
  }

  /**
   * "[vCenter vcsa-prod](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getVMwareVCenterMarkdownLink(
    projectId: ObjectID,
    vmwareVCenterId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getVMwareVCenterName({
      vmwareVCenterId: vmwareVCenterId,
    });
    const link: URL = await this.getVMwareVCenterLinkInDashboard(
      projectId,
      vmwareVCenterId,
    );

    return `[vCenter ${name}](${link.toString()})`;
  }

  private async writeVMwareVCenterCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const vmwareVCenterId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !vmwareVCenterId) {
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
      resourceTypeName: "vCenter",
      resourceMarkdownLink: await this.getVMwareVCenterMarkdownLink(
        projectId,
        vmwareVCenterId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      description: createdItem.description,
    });

    await VMwareVCenterFeedService.createVMwareVCenterFeedItem({
      vmwareVCenterId: vmwareVCenterId,
      projectId: projectId,
      vmwareVCenterFeedEventType:
        VMwareVCenterFeedEventType.VMwareVCenterCreated,
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
    this.writeVMwareVCenterUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  private async writeVMwareVCenterUpdatedFeed(
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

    for (const vmwareVCenterId of updatedItemIds) {
      const vmwareVCenter: Model | null = await this.findOneById({
        id: vmwareVCenterId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = vmwareVCenter?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: string =
        await this.getVMwareVCenterMarkdownLink(projectId, vmwareVCenterId);

      if (isArchiveChange) {
        await VMwareVCenterFeedService.createVMwareVCenterFeedItem({
          vmwareVCenterId: vmwareVCenterId,
          projectId: projectId,
          vmwareVCenterFeedEventType: isArchived
            ? VMwareVCenterFeedEventType.VMwareVCenterArchived
            : VMwareVCenterFeedEventType.VMwareVCenterRestored,
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

        await VMwareVCenterFeedService.createVMwareVCenterFeedItem({
          vmwareVCenterId: vmwareVCenterId,
          projectId: projectId,
          vmwareVCenterFeedEventType:
            VMwareVCenterFeedEventType.VMwareVCenterUpdated,
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
