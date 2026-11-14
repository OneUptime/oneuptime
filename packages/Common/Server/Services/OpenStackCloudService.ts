import BadDataException from "../../Types/Exception/BadDataException";
import {
  OpenStackInstanceMetricsOptions,
  normalizeOpenStackInstanceMetricsOptions,
} from "../../Types/OpenStack/OpenStackInstanceMetrics";
import ResourceAiAccessSettings, {
  ResourceAiAccessFeedItem,
  ResourceAiAccessWriteCarryForward,
} from "../Utils/AI/ResourceAccess/ResourceAiAccessSettings";
import ResourceAiDeleteCleanup from "../Utils/AI/ResourceAccess/ResourceAiDeleteCleanup";
import AiResourceType from "../../Types/ResourceAiAgent/AiResourceType";
import DeleteBy from "../Types/Database/DeleteBy";
import ProjectReferencesService, {
  ProjectReferenceWrite,
} from "./ProjectReferencesService";
import { OpenStackInventorySummary } from "./OpenStackResourceService";
import OpenStackCloudLabelRuleEngineService from "./OpenStackCloudLabelRuleEngineService";
import OpenStackCloudOwnerRuleEngineService from "./OpenStackCloudOwnerRuleEngineService";
import Model from "../../Models/DatabaseModels/OpenStackCloud";
import Label from "../../Models/DatabaseModels/Label";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import OpenStackCloudFeedService from "./OpenStackCloudFeedService";
import { OpenStackCloudFeedEventType } from "../../Models/DatabaseModels/OpenStackCloudFeed";
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
import OpenStackCloudConnection, {
  OPENSTACK_CONNECTION_SAVED_SELECT,
  OpenStackConnectionChange,
} from "../Utils/OpenStack/OpenStackCloudConnection";
import OpenStackProbeCollectionStore, {
  OpenStackCollectionReportOutcome,
} from "../Utils/OpenStack/OpenStackProbeCollectionStore";
import OpenStackCheckStore from "../Utils/OpenStack/OpenStackCheckStore";
import {
  OpenStackCollectionJob,
  OpenStackCollectionReport,
} from "../../Types/OpenStack/OpenStackProbeCollection";

const LAST_SEEN_CACHE_NAMESPACE: string = "openstack-cloud-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "openstack-cloud-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

/*
 * A OpenStack cloud is matched to its telemetry by its name (openstack.cloud.name),
 * so a rename is held to the rules a new OpenStack cloud is: no spaces around
 * it, never blank, and never another OpenStack cloud's name
 * (DiscoveredResourceUpdate).
 */
const OPENSTACK_CLOUD_MATCH_COLUMN: MatchColumn = matchedOnName({
  resourceName: "OpenStack cloud",
});

/*
 * The cloud's snapshot columns, recounted from its inventory after each flush
 * (OpenStackResourceService.getInventorySummary).
 */
const OPENSTACK_CLOUD_SNAPSHOT_COLUMNS: ReadonlyArray<
  Exclude<keyof OpenStackInventorySummary, "services" | "closedServices">
> = [
  "regionCount",
  "availabilityZoneCount",
  "hypervisorCount",
  "instanceCount",
  "activeInstanceCount",
  "volumeCount",
  "networkCount",
  "routerCount",
  "floatingIpCount",
  "projectCount",
  "serviceCount",
  "downServiceCount",
  "vcpuCapacity",
  "vcpuAllocated",
  "memoryCapacityBytes",
  "memoryAllocatedBytes",
  "storageCapacityBytes",
  "storageUsedBytes",
];

/*
 * What OpenStackCloudService's write hooks hand on to their success hooks: the collection
 * settings changes.
 */
interface OpenStackCloudWriteCarryForward {
  openStackConnectionChanges?: Array<OpenStackConnectionChange> | undefined;
  /*
   * The AI access settings as they stood, for an operator's write of one. Spread here so
   * ResourceAiAccessSettings.afterUpdate finds it where it looks.
   */
  previousResourceAiAccessSettings?:
    | ResourceAiAccessWriteCarryForward["previousResourceAiAccessSettings"]
    | undefined;
  resourceType?: ResourceAiAccessWriteCarryForward["resourceType"] | undefined;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The collection probe is checked by OpenStackCloudConnection: a probe of the project's
   * own, or, on a self-hosted install, one of the instance's global probes, with another
   * project's probe answered like one that does not exist. The generic check would refuse
   * every global probe.
   */
  protected override getRelationsCheckedByService(
    _write?: ProjectReferenceWrite,
  ): Array<string> {
    return ["collectionProbe"];
  }

  /*
   * Claim the clouds a probe collects that are due, and hand them out with their
   * credentials (OpenStackProbeCollectionStore).
   */
  public async claimForCollection(data: {
    probeId: ObjectID;
    runningOpenStackCloudIds: Array<string>;
    limit: number;
  }): Promise<Array<OpenStackCollectionJob>> {
    return await OpenStackProbeCollectionStore.claimDueClouds(this, data);
  }

  // Record what a probe found for a cloud it collected.
  public async recordCollectionReport(data: {
    probeId: ObjectID;
    report: OpenStackCollectionReport;
  }): Promise<OpenStackCollectionReportOutcome> {
    return await OpenStackProbeCollectionStore.recordCollectionReport(
      this,
      data,
    );
  }

  /*
   * The server-only columns a collection settings write decides, written after the save
   * without hooks (see OpenStackCloudConnection.afterWrite).
   */
  private async writeConnectionServerColumns(write: {
    openStackCloudId: ObjectID;
    values: Record<string, unknown>;
    bumpSettingsVersion: boolean;
  }): Promise<void> {
    if (write.bumpSettingsVersion) {
      await this.atomicAddToColumnsByIdWithoutHooks({
        id: write.openStackCloudId,
        add: { collectionSettingsVersion: 1 },
        set: write.values as never,
      });
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: write.openStackCloudId,
      data: write.values as never,
    });
  }

  private async afterConnectionWrites(data: {
    changes: Array<OpenStackConnectionChange>;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    for (const change of data.changes) {
      await OpenStackCloudConnection.afterWrite({
        change: change,
        userId: data.userId,
        writeServerColumns: async (write: {
          openStackCloudId: ObjectID;
          values: Record<string, unknown>;
          bumpSettingsVersion: boolean;
        }): Promise<void> => {
          await this.writeConnectionServerColumns(write);
        },
      });
    }
  }

  // Probe collection settings, checked and normalized in place.
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * A create is held to the same AI access rules as an update, judged against the
     * never-configured defaults a new cloud starts from.
     */
    ResourceAiAccessSettings.checkCreate({
      resourceType: AiResourceType.OpenStackCloud,
      createBy,
    });

    const connectionChange: OpenStackConnectionChange | null =
      await OpenStackCloudConnection.prepareCreate(createBy);

    // Nothing to carry for a cloud that names no collection setting.
    const carryForward: OpenStackCloudWriteCarryForward | null =
      connectionChange
        ? { openStackConnectionChanges: [connectionChange] }
        : null;

    return { createBy, carryForward: carryForward };
  }

  /*
   * Probe collection settings: checked against the row they change (the saved credential is
   * bound to its address, probe and certificates), and normalized in place.
   */
  @CaptureSpan()
  /*
   * What a cloud chose to keep, in the form ingest reads, or refused: a typo here would
   * otherwise keep every instance's series on a cloud that chose to pay for a few.
   */
  private normalizeInstanceMetricsOptions(data: Record<string, unknown>): void {
    if (!("instanceMetricsOptions" in data)) {
      return;
    }
    const normalized:
      | { options: OpenStackInstanceMetricsOptions; error?: undefined }
      | { options?: undefined; error: string } =
      normalizeOpenStackInstanceMetricsOptions(data["instanceMetricsOptions"]);
    if (normalized.error !== undefined) {
      throw new BadDataException(normalized.error);
    }
    data["instanceMetricsOptions"] = normalized.options;
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    this.normalizeInstanceMetricsOptions(
      updateBy.data as unknown as Record<string, unknown>,
    );

    /*
     * An operator's write of an AI access setting is validated and checked against who
     * may make AI do more on this cloud: the rules every resource AI agent's resource
     * shares (ResourceAiAccessSettings).
     */
    const aiAccess: ResourceAiAccessWriteCarryForward | null =
      await ResourceAiAccessSettings.checkUpdate({
        resourceType: AiResourceType.OpenStackCloud,
        service: this,
        updateBy,
      });

    if (
      !OpenStackCloudConnection.isConnectionWrite(
        updateBy.data as unknown as Record<string, unknown>,
      )
    ) {
      return { updateBy, carryForward: aiAccess };
    }

    const saved: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      OPENSTACK_CONNECTION_SAVED_SELECT as Select<Model>,
    );

    const changes: Array<OpenStackConnectionChange> =
      await OpenStackCloudConnection.prepareUpdate({
        updateBy: updateBy,
        saved: saved.map((row: Model) => {
          return {
            _id: row._id?.toString(),
            projectId: row.projectId,
            collectionMethod: row.collectionMethod,
            authUrl: row.authUrl,
            endpointInterface: row.endpointInterface,
            credentialKind: row.credentialKind,
            applicationCredentialId: row.applicationCredentialId,
            keystoneUsername: row.keystoneUsername,
            userDomainName: row.userDomainName,
            projectName: row.projectName,
            projectDomainName: row.projectDomainName,
            isCredentialSet: row.isCredentialSet,
            collectionProbeId: row.collectionProbeId,
            collectionRegions: row.collectionRegions,
            collectionOptions: row.collectionOptions,
            collectionIntervalInMinutes: row.collectionIntervalInMinutes,
            trustedCertificateFingerprints: row.trustedCertificateFingerprints,
            presentedCertificate: row.presentedCertificate,
          };
        }),
      });

    const carryForward: OpenStackCloudWriteCarryForward = {
      ...(aiAccess || {}),
      openStackConnectionChanges: changes,
    };

    return { updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onBeforeUpdateUniqueCheck(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await DiscoveredResourceUpdate.checkMatchColumn({
      service: this,
      updateBy,
      matchColumn: OPENSTACK_CLOUD_MATCH_COLUMN,
    });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * Rules run once, on creation only — exact parity with
     * KubernetesCloudService. Label engine first: it syncs the
     * in-memory labels so the owner engine can match rule-added labels.
     */
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await OpenStackCloudLabelRuleEngineService.applyRulesToOpenStackCloud(
            createdItem,
          );
        })
        .then(async () => {
          await OpenStackCloudOwnerRuleEngineService.applyRulesToOpenStackCloud(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying OpenStack cloud rules in OpenStackCloudService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              openStackCloudId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this OpenStack cloud looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeOpenStackCloudCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    /*
     * A cloud created for probe collection: whether its credential is saved, and that its
     * probe collects it now (OpenStackCloudConnection).
     */
    const carryForward: OpenStackCloudWriteCarryForward | null =
      (onCreate.carryForward as OpenStackCloudWriteCarryForward | null) || null;

    if (createdItem.id && carryForward?.openStackConnectionChanges?.length) {
      await this.afterConnectionWrites({
        changes: carryForward.openStackConnectionChanges.map(
          (change: OpenStackConnectionChange): OpenStackConnectionChange => {
            return {
              ...change,
              openStackCloudId: createdItem.id!,
              // The created feed item already says the cloud exists.
              feedLines: [],
            };
          },
        ),
        userId: onCreate.createBy.props.userId,
      });
    }

    return createdItem;
  }

  @CaptureSpan()
  public async findOrCreateByName(data: {
    projectId: ObjectID;
    name: string;
  }): Promise<Model> {
    /*
     * A OpenStack cloud is keyed by the `openstack.cloud.name` OTel resource
     * attribute, which the user configures on the agent. Look it up
     * case-insensitively: the unique guard (checkUniqueColumnBy ->
     * findWithSameText) compares case-insensitively, so a case-sensitive
     * lookup would miss an existing row that differs only by case, then
     * fail to create it — wedging ingest for that cloud. Unlike
     * DockerHost.hostIdentifier (host.name casing is unstable on Windows)
     * the configured cloud name's casing is stable, so we preserve the
     * user's casing on create instead of canonicalizing to lowercase.
     */
    const name: string = data.name.trim();

    const existingCloud: Model | null = await this.findOneBy({
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

    if (existingCloud) {
      return existingCloud;
    }

    try {
      // Create new cloud
      const newCloud: Model = new Model();
      newCloud.projectId = data.projectId;
      newCloud.name = name;
      newCloud.otelCollectorStatus = "connected";
      newCloud.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdCloud: Model = await this.create({
        data: newCloud,
        props: {
          isRoot: true,
        },
      });

      return createdCloud;
    } catch {
      /*
       * Either two ingest workers raced to create the same cloud, or a
       * cloud with this name in a different case already existed and the
       * unique guard rejected the insert. Re-resolve case-insensitively so
       * the caller still gets the existing row instead of throwing.
       */
      const reFetchedCloud: Model | null = await this.findOneBy({
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

      if (reFetchedCloud) {
        return reFetchedCloud;
      }

      throw new Error("Failed to create or find OpenStack cloud: " + name);
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
   * metrics snapshot flush (counts, every batch) and the
   * fenced autoDiscoverOpenStackCloud maintenance path (agentVersion
   * only — the oneuptime.agent.version the shipped agent config stamps;
   * a cloud that pushes its own metrics sends none, an all-null
   * fingerprint that never touches the enrichment gates). The single
   * fingerprint covers the whole extras object, so each alternation
   * between the two shapes busts the throttle: at most one extra
   * Postgres UPDATE per maintenance-fence window (~5 min), which is
   * accepted. Do NOT key the cache per-caller — that would let two
   * callers each refresh lastSeenAt under their own throttle and is
   * not worth the complexity for one UPDATE per 5 minutes.
   */
  @CaptureSpan()
  public async updateLastSeen(
    cloudId: ObjectID,
    extra?: Partial<OpenStackInventorySummary> & {
      agentVersion?: string | undefined;
    },
  ): Promise<ResourceHeartbeatResult> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
          regionCount: extra?.regionCount ?? null,
          availabilityZoneCount: extra?.availabilityZoneCount ?? null,
          hypervisorCount: extra?.hypervisorCount ?? null,
          instanceCount: extra?.instanceCount ?? null,
          activeInstanceCount: extra?.activeInstanceCount ?? null,
          volumeCount: extra?.volumeCount ?? null,
          networkCount: extra?.networkCount ?? null,
          routerCount: extra?.routerCount ?? null,
          floatingIpCount: extra?.floatingIpCount ?? null,
          projectCount: extra?.projectCount ?? null,
          serviceCount: extra?.serviceCount ?? null,
          downServiceCount: extra?.downServiceCount ?? null,
          vcpuCapacity: extra?.vcpuCapacity ?? null,
          vcpuAllocated: extra?.vcpuAllocated ?? null,
          memoryCapacityBytes: extra?.memoryCapacityBytes ?? null,
          memoryAllocatedBytes: extra?.memoryAllocatedBytes ?? null,
          storageCapacityBytes: extra?.storageCapacityBytes ?? null,
          storageUsedBytes: extra?.storageUsedBytes ?? null,
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
    // Counts: 0 is a legitimate value, so gate on undefined, not falsiness.
    for (const column of OPENSTACK_CLOUD_SNAPSHOT_COLUMNS) {
      const value: number | undefined = extra?.[column];
      if (value !== undefined) {
        metadata[column] = value;
      }
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    return await ResourceHeartbeat.write({
      service: this,
      id: cloudId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `OpenStack cloud ${cloudId.toString()}`,
    });
  }

  /**
   * Additively attach labels to a OpenStack cloud. Existing labels are
   * never removed — manual labels set via the UI survive ingest. The
   * set of labelIds passed in is fingerprinted and cached for 60s so
   * the common case (steady-state collector pushing the same label
   * set every batch) costs one in-memory lookup, not a join-table
   * scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    openStackCloudId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.openStackCloudId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const openStackCloudIdStr: string = data.openStackCloudId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(openStackCloudIdStr)
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
          .of(openStackCloudIdStr)
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
        `OpenStackCloudService.attachLabels failed for OpenStack cloud ${data.openStackCloudId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  @CaptureSpan()
  public async markDisconnectedClouds(): Promise<void> {
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

    const connectedClouds: Array<Model> = await this.findBy({
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

    for (const cloud of connectedClouds) {
      if (cloud._id) {
        await this.updateOneById({
          id: new ObjectID(cloud._id.toString()),
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
   * Display name for this OpenStack cloud, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getOpenStackCloudName(data: {
    openStackCloudId: ObjectID;
  }): Promise<string> {
    const openStackCloud: Model | null = await this.findOneById({
      id: data.openStackCloudId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return openStackCloud?.name || "";
  }

  @CaptureSpan()
  public async getOpenStackCloudLinkInDashboard(
    projectId: ObjectID,
    openStackCloudId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/openstack/${openStackCloudId.toString()}`,
    );
  }

  /**
   * "[OpenStack Cloud prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getOpenStackCloudMarkdownLink(
    projectId: ObjectID,
    openStackCloudId: ObjectID,
  ): Promise<MarkdownText> {
    const name: string = await this.getOpenStackCloudName({
      openStackCloudId: openStackCloudId,
    });
    const link: URL = await this.getOpenStackCloudLinkInDashboard(
      projectId,
      openStackCloudId,
    );

    return mdText`[OpenStack Cloud ${name}](${link.toString()})`;
  }

  private async writeOpenStackCloudCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const openStackCloudId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !openStackCloudId) {
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
      resourceTypeName: "OpenStack cloud",
      resourceMarkdownLink: await this.getOpenStackCloudMarkdownLink(
        projectId,
        openStackCloudId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      description: createdItem.description,
    });

    await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
      openStackCloudId: openStackCloudId,
      projectId: projectId,
      openStackCloudFeedEventType:
        OpenStackCloudFeedEventType.OpenStackCloudCreated,
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
    this.writeOpenStackCloudUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    // Probe collection settings: what only the server writes, and the feed.
    const carryForward: OpenStackCloudWriteCarryForward | null =
      (onUpdate.carryForward as OpenStackCloudWriteCarryForward | null) || null;

    if (carryForward?.openStackConnectionChanges?.length) {
      const updatedIds: Set<string> = new Set(
        updatedItemIds.map((id: ObjectID): string => {
          return id.toString();
        }),
      );

      await this.afterConnectionWrites({
        changes: carryForward.openStackConnectionChanges.filter(
          (change: OpenStackConnectionChange): boolean => {
            return (
              Boolean(change.openStackCloudId) &&
              updatedIds.has(change.openStackCloudId!.toString())
            );
          },
        ),
        userId: onUpdate.updateBy.props.userId,
      });
    }

    /*
     * Unarchived: collected and checked again at once. While it was archived the claims set its
     * collection and its checks aside for up to a quarter of an hour at a time
     * (Utils/Probe/ClaimSetAside), and restoring a cloud must not wait for that. Its own try: the
     * cloud is saved already.
     */
    if (
      updatedItemIds.length > 0 &&
      Service.isUnarchive(onUpdate.updateBy.data)
    ) {
      try {
        await OpenStackProbeCollectionStore.makeDueNow(this, updatedItemIds);
        await OpenStackCheckStore.makeDueNow(this, {
          ids: updatedItemIds,
          byCloud: true,
        });
      } catch (error) {
        logger.error(
          "OpenStackCloudService.onUpdateSuccess: could not make an unarchived cloud's collection and checks due now; the claims pick them up within a quarter of an hour.",
        );
        logger.error(error as Error);
      }
    }

    /*
     * An operator's AI access write: recorded on the feed, and the cloud marked
     * AI-configured.
     */
    await ResourceAiAccessSettings.afterUpdate({
      service: this,
      onUpdate,
      updatedItemIds,
      getResourceMarkdownLink: (
        projectId: ObjectID,
        openStackCloudId: ObjectID,
      ): Promise<MarkdownText> => {
        return this.getOpenStackCloudMarkdownLink(projectId, openStackCloudId);
      },
      createFeedItem: async (item: ResourceAiAccessFeedItem): Promise<void> => {
        await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
          openStackCloudId: item.resourceId,
          projectId: item.projectId,
          openStackCloudFeedEventType:
            OpenStackCloudFeedEventType.OpenStackCloudUpdated,
          displayColor: item.displayColor,
          feedInfoInMarkdown: item.feedInfoInMarkdown,
          moreInformationInMarkdown: item.moreInformationInMarkdown,
          userId: item.userId,
        });
      },
    });

    return onUpdate;
  }

  // Whether an update brings a cloud back from the archive.
  public static isUnarchive(data: unknown): boolean {
    return (
      Boolean(data) &&
      typeof data === "object" &&
      (data as Record<string, unknown>)["isArchived"] === false
    );
  }

  /*
   * Deleting a cloud settles its in-flight AI rounds and removes its resource AI agent:
   * read before the delete, done after it for the clouds actually deleted
   * (ResourceAiDeleteCleanup, shared by every resource AI agent's resource).
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    return {
      deleteBy,
      carryForward: await ResourceAiDeleteCleanup.beforeDelete({
        resourceType: AiResourceType.OpenStackCloud,
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
      resourceType: AiResourceType.OpenStackCloud,
      onDelete,
      deletedItemIds,
    });

    return onDelete;
  }

  private async writeOpenStackCloudUpdatedFeed(
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

    for (const openStackCloudId of updatedItemIds) {
      const openStackCloud: Model | null = await this.findOneById({
        id: openStackCloudId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = openStackCloud?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: MarkdownText =
        await this.getOpenStackCloudMarkdownLink(projectId, openStackCloudId);

      if (isArchiveChange) {
        await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
          openStackCloudId: openStackCloudId,
          projectId: projectId,
          openStackCloudFeedEventType: isArchived
            ? OpenStackCloudFeedEventType.OpenStackCloudArchived
            : OpenStackCloudFeedEventType.OpenStackCloudRestored,
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

        await OpenStackCloudFeedService.createOpenStackCloudFeedItem({
          openStackCloudId: openStackCloudId,
          projectId: projectId,
          openStackCloudFeedEventType:
            OpenStackCloudFeedEventType.OpenStackCloudUpdated,
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
