import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import ServiceFeedService from "./ServiceFeedService";
import { ServiceFeedEventType } from "../../Models/DatabaseModels/ServiceFeed";
import ResourceFeedUtil from "../Utils/ResourceFeed/ResourceFeedUtil";
import { JSONObject } from "../../Types/JSON";
import URL from "../../Types/API/URL";
import DatabaseConfig from "../DatabaseConfig";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import ServiceLabelRuleEngineService from "./ServiceLabelRuleEngineService";
import ServiceOwnerRuleEngineService from "./ServiceOwnerRuleEngineService";
import ArrayUtil from "../../Utils/Array";
import {
  Blue500,
  BrightColors,
  Gray500,
  Green500,
  Yellow500,
} from "../../Types/BrandColors";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import Model from "../../Models/DatabaseModels/Service";
import Label from "../../Models/DatabaseModels/Label";
import Project from "../../Models/DatabaseModels/Project";
import GlobalCache from "../Infrastructure/GlobalCache";
import SingleFlight from "../Utils/SingleFlight";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";

const DEFAULT_TELEMETRY_RETENTION_IN_DAYS: number = 15;

const LAST_SEEN_CACHE_NAMESPACE: string = "service-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

/*
 * Enrichment (the descriptive, collector-supplied columns) is gated
 * separately from liveness — see the long note on updateLastSeen. The
 * fingerprint key detects a genuine change; the write-window key bounds how
 * often a service whose producers permanently disagree can act on one.
 */
const METADATA_FINGERPRINT_CACHE_NAMESPACE: string =
  "service-metadata-fingerprint";
const METADATA_FINGERPRINT_TTL_SECONDS: number = 60 * 60;

const METADATA_WRITE_WINDOW_CACHE_NAMESPACE: string =
  "service-metadata-write-window";
const METADATA_WRITE_THROTTLE_SECONDS: number = 5 * 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "service-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Select a random color when the caller did not provide one. API
     * clients (e.g. Terraform) may set an explicit color; overwriting it
     * made the field impossible to manage declaratively.
     */
    if (!createBy.data.serviceColor) {
      createBy.data.serviceColor = ArrayUtil.selectItemByRandom(BrightColors);
    }

    return {
      carryForward: null,
      createBy: createBy,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await ServiceLabelRuleEngineService.applyRulesToService(createdItem);
        })
        .then(async () => {
          await ServiceOwnerRuleEngineService.applyRulesToService(createdItem);
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying service rules in ServiceService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              serviceId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    /*
     * The overview page can say what this service looks like now; only
     * the feed can say why it exists at all - whether a person added it or
     * ingest registered it the first time telemetry named it. Fire and
     * forget: a feed write must never fail the create it describes.
     */
    this.writeServiceCreatedFeed(createdItem, onCreate).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return createdItem;
  }

  @CaptureSpan()
  public async getTelemetryDataRetentionInDays(
    serviceId: ObjectID,
  ): Promise<number> {
    const service: Model | null = await this.findOneById({
      id: serviceId,
      select: {
        projectId: true,
        retainTelemetryDataForDays: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!service) {
      throw new BadDataException("Service not found");
    }

    if (service.retainTelemetryDataForDays) {
      return service.retainTelemetryDataForDays;
    }

    // Fall back to project-level default.
    if (service.projectId) {
      const project: Project | null = await ProjectService.findOneById({
        id: service.projectId,
        select: {
          defaultTelemetryRetentionInDays: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (project?.defaultTelemetryRetentionInDays) {
        return project.defaultTelemetryRetentionInDays;
      }
    }

    return DEFAULT_TELEMETRY_RETENTION_IN_DAYS;
  }

  /*
   * Refresh `lastSeenAt` (and, occasionally, the descriptive columns) for a
   * service. This is the single hottest UPDATE in the system: every
   * metric/log/trace/profile batch re-resolves the same serviceId, and every
   * OTLP resource inside a batch does it again.
   *
   * It is also the write that took production down, so the throttling here is
   * deliberate in a way worth reading before changing.
   *
   * WHAT WENT WRONG. The throttle used to key on the serviceId but STORE a
   * fingerprint of the metadata, and skip only when the stored fingerprint
   * matched. That works when one producer owns a row. It collapses when two
   * producers of the SAME row disagree, because `Service` is unique on
   * (projectId, name) alone: the same service.name running in dev and prod
   * inside one project is ONE row with two permanently disagreeing
   * fingerprints. A writes fp_A, B reads fp_A, sees a mismatch, writes fp_B, A
   * reads fp_B, sees a mismatch... forever. The same holds for active-active
   * deployments differing in cloud.region or cloud.account.id, and transiently
   * for every rolling deploy (service.version). For those rows the throttle
   * admitted not one write per minute but one write per BATCH — and with the
   * autoscaler at 100 pods (~25K concurrent jobs) that was thousands of
   * simultaneous UPDATEs onto ~2,300 rows. Postgres queues row-lock waiters
   * strictly, so they did not collide and retry, they lined up: 1,017 active
   * connections, 892 parked on locks, the tail waiting 3.7 hours. The database
   * was never short of capacity.
   *
   * The shape below separates the two things that were tangled together:
   *
   *   LIVENESS (`lastSeenAt`) is gated on key PRESENCE, never on metadata. One
   *   heartbeat per service per window, full stop — no payload can bust it, so
   *   disagreeing producers cannot flap it.
   *
   *   ENRICHMENT (the descriptive columns) is gated on TWO keys: a fingerprint
   *   claim so a genuinely changed attribute still lands promptly, plus a
   *   presence-only rate limiter so a permanently-flapping service costs one
   *   enrichment write per rate-limit window instead of one per batch. The
   *   fingerprint key alone does not fix flapping — a longer TTL just makes
   *   each flap more expensive.
   *
   * Both claims are ATOMIC (SET NX / compare-and-claim in one round trip).
   * The old read-then-write was check-then-act, and at this concurrency the
   * losers of that race do not politely retry — they all proceed.
   *
   * Underneath both, the write itself is non-blocking (SKIP LOCKED), so a
   * convoy cannot form even if every gate above fails open at once — which is
   * exactly what a Redis outage does. That layering is what makes fail-open
   * affordable here, and fail-open is required: a suppressed heartbeat strands
   * a healthy service as "disconnected" while its telemetry keeps arriving.
   */
  @CaptureSpan()
  public async updateLastSeen(
    serviceId: ObjectID,
    extra?: {
      serviceVersion?: string | undefined;
      deploymentEnvironment?: string | undefined;
      serviceNamespace?: string | undefined;
      runtimeName?: string | undefined;
      runtimeVersion?: string | undefined;
      telemetrySdkLanguage?: string | undefined;
      cloudProvider?: string | undefined;
      cloudPlatform?: string | undefined;
      cloudRegion?: string | undefined;
      cloudAccountId?: string | undefined;
    },
  ): Promise<void> {
    const cacheKey: string = serviceId.toString();

    /*
     * Collapse duplicate concurrent callers inside THIS process first. One
     * OTLP batch resolves the same service once per resource — the shipped
     * host-metrics collector config produces hundreds per batch — and without
     * this every one of them independently asks Redis the same question.
     */
    await SingleFlight.run(
      `${LAST_SEEN_CACHE_NAMESPACE}:${cacheKey}:${this.fingerprintLastSeenExtras(
        extra,
      )}`,
      async () => {
        await this.writeLastSeen(serviceId, cacheKey, extra);
      },
    );
  }

  private async writeLastSeen(
    serviceId: ObjectID,
    cacheKey: string,
    extra?: {
      serviceVersion?: string | undefined;
      deploymentEnvironment?: string | undefined;
      serviceNamespace?: string | undefined;
      runtimeName?: string | undefined;
      runtimeVersion?: string | undefined;
      telemetrySdkLanguage?: string | undefined;
      cloudProvider?: string | undefined;
      cloudPlatform?: string | undefined;
      cloudRegion?: string | undefined;
      cloudAccountId?: string | undefined;
    },
  ): Promise<void> {
    const fingerprint: string = this.fingerprintLastSeenExtras(extra);

    /*
     * Liveness gate. Presence-only and jittered: a fleet-wide restart would
     * otherwise re-synchronise every service's window and rebuild the herd on
     * a one-minute period.
     */
    let writeLiveness: boolean = true;
    try {
      writeLiveness = await GlobalCache.setStringIfNotExists(
        LAST_SEEN_CACHE_NAMESPACE,
        cacheKey,
        "1",
        {
          expiresInSeconds: GlobalCache.withJitter(LAST_SEEN_THROTTLE_SECONDS),
        },
      );
    } catch {
      /*
       * Cache unavailable — fail OPEN and refresh liveness anyway. Suppressing
       * the heartbeat during a Redis outage is how a healthy service gets
       * shown as disconnected while its data keeps arriving (issue #3006's
       * failure mode). Affordable only because the write below cannot queue.
       */
      writeLiveness = true;
    }

    /*
     * Enrichment gate 1: has the payload actually changed? Compare-and-claim,
     * so a deploy's new service.version is written promptly rather than
     * waiting out a window.
     */
    let metadataChanged: boolean = false;
    try {
      metadataChanged = await GlobalCache.setStringIfChanged(
        METADATA_FINGERPRINT_CACHE_NAMESPACE,
        cacheKey,
        fingerprint,
        {
          expiresInSeconds: GlobalCache.withJitter(
            METADATA_FINGERPRINT_TTL_SECONDS,
          ),
        },
      );
    } catch {
      /*
       * Fail CLOSED for enrichment (unlike liveness). These columns are
       * descriptive, not operational — nothing is mis-reported by writing them
       * a little later, and letting a Redis outage open this gate would
       * restore the per-batch write storm this method exists to prevent.
       */
      metadataChanged = false;
    }

    /*
     * Enrichment gate 2: rate limiter. A service whose producers permanently
     * disagree (dev + prod under one name, active-active regions) reports a
     * "change" on every batch forever. Gate 1 cannot tell that apart from a
     * real deploy, so this bounds it regardless.
     */
    let writeMetadata: boolean = false;
    if (metadataChanged) {
      try {
        writeMetadata = await GlobalCache.setStringIfNotExists(
          METADATA_WRITE_WINDOW_CACHE_NAMESPACE,
          cacheKey,
          "1",
          {
            expiresInSeconds: GlobalCache.withJitter(
              METADATA_WRITE_THROTTLE_SECONDS,
            ),
          },
        );
      } catch {
        writeMetadata = false;
      }
    }

    if (!writeLiveness && !writeMetadata) {
      // Nothing to say. Issue no statement at all.
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const liveness: any = {
      lastSeenAt: OneUptimeDate.getCurrentDate(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metadata: any = {};

    if (writeMetadata) {
      if (extra?.serviceVersion) {
        metadata.serviceVersion = extra.serviceVersion;
      }
      if (extra?.deploymentEnvironment) {
        metadata.deploymentEnvironment = extra.deploymentEnvironment;
      }
      if (extra?.serviceNamespace) {
        metadata.serviceNamespace = extra.serviceNamespace;
      }
      if (extra?.runtimeName) {
        metadata.runtimeName = extra.runtimeName;
      }
      if (extra?.runtimeVersion) {
        metadata.runtimeVersion = extra.runtimeVersion;
      }
      if (extra?.telemetrySdkLanguage) {
        metadata.telemetrySdkLanguage = extra.telemetrySdkLanguage;
      }
      if (extra?.cloudProvider) {
        metadata.cloudProvider = extra.cloudProvider;
      }
      if (extra?.cloudPlatform) {
        metadata.cloudPlatform = extra.cloudPlatform;
      }
      if (extra?.cloudRegion) {
        metadata.cloudRegion = extra.cloudRegion;
      }
      if (extra?.cloudAccountId) {
        metadata.cloudAccountId = extra.cloudAccountId;
      }
    }

    const hasMetadata: boolean = Object.keys(metadata).length > 0;

    /*
     * `lastSeenAt` rides along even on an enrichment-only write: refreshing it
     * early is harmless (it is a liveness floor, not a sample), and splitting
     * the two into separate statements would double the writes we just went to
     * such lengths to halve.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = { ...liveness, ...metadata };

    /*
     * Heartbeat write. Deliberately NOT the full updateOneById pipeline
     * (permission SELECT -> _findBy SELECT -> save() with `version = version +
     * 1` -> workflow/realtime/audit hooks): that pipeline holds the row's
     * write lock across several round trips inside an open transaction, which
     * is precisely how a stalled event loop becomes the head of a lock convoy.
     * It also intentionally drops the per-update workflow trigger that
     * Service's @EnableWorkflow({ update: true }) fired on every heartbeat — a
     * liveness ping should not trigger user workflows.
     *
     * And it is the SKIP LOCKED variant: contended writers yield instead of
     * queueing, capping backends blocked on any one Service row at one.
     */
    let wrote: boolean = false;

    try {
      wrote = await this.updateColumnsByIdIfUnlockedWithoutHooks({
        id: serviceId,
        data: data,
      });
    } catch (err) {
      /*
       * Liveness must survive bad metadata. Every enrichment value is a
       * collector-supplied resource attribute, so if one of them makes
       * Postgres reject the statement it takes `lastSeenAt` down with it and
       * the service silently stops looking alive. Retry with liveness only, so
       * enrichment is what gets dropped, never the heartbeat. (Issue #3006 was
       * this exact failure on Host.)
       */
      logger.warn(
        `ServiceService.updateLastSeen: metadata write failed for service ${serviceId.toString()}, falling back to a liveness-only update: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );

      await this.clearLastSeenGates(cacheKey, hasMetadata);

      await this.updateColumnsByIdIfUnlockedWithoutHooks({
        id: serviceId,
        data: liveness,
      });

      return;
    }

    if (!wrote && hasMetadata) {
      /*
       * The row was locked, so this write was SKIPPED rather than applied. For
       * liveness that is a non-event — whoever holds the lock is storing the
       * same timestamp. Enrichment is different: the holder may be writing an
       * older payload, and the gates we just claimed would suppress ours for
       * the rest of the window. Release them so the next batch re-attempts.
       *
       * This cannot become a retry storm — each attempt is a non-blocking
       * statement that returns immediately when contended.
       */
      await this.clearLastSeenGates(cacheKey, true);
    }
  }

  /**
   * Re-open the gates so the next batch retries. Liveness is only re-opened
   * when there was no enrichment at stake; otherwise the enrichment gates are
   * the ones that must not stay claimed after a write that never happened.
   */
  private async clearLastSeenGates(
    cacheKey: string,
    hadMetadata: boolean,
  ): Promise<void> {
    const namespaces: Array<string> = hadMetadata
      ? [
          METADATA_FINGERPRINT_CACHE_NAMESPACE,
          METADATA_WRITE_WINDOW_CACHE_NAMESPACE,
        ]
      : [LAST_SEEN_CACHE_NAMESPACE];

    for (const namespace of namespaces) {
      try {
        await GlobalCache.deleteKey(namespace, cacheKey);
      } catch {
        // Best effort — the retry below is what actually matters.
      }
    }
  }

  private fingerprintLastSeenExtras(extra?: {
    serviceVersion?: string | undefined;
    deploymentEnvironment?: string | undefined;
    serviceNamespace?: string | undefined;
    runtimeName?: string | undefined;
    runtimeVersion?: string | undefined;
    telemetrySdkLanguage?: string | undefined;
    cloudProvider?: string | undefined;
    cloudPlatform?: string | undefined;
    cloudRegion?: string | undefined;
    cloudAccountId?: string | undefined;
  }): string {
    const normalized: Record<string, string | null> = {
      serviceVersion: extra?.serviceVersion ?? null,
      deploymentEnvironment: extra?.deploymentEnvironment ?? null,
      serviceNamespace: extra?.serviceNamespace ?? null,
      runtimeName: extra?.runtimeName ?? null,
      runtimeVersion: extra?.runtimeVersion ?? null,
      telemetrySdkLanguage: extra?.telemetrySdkLanguage ?? null,
      cloudProvider: extra?.cloudProvider ?? null,
      cloudPlatform: extra?.cloudPlatform ?? null,
      cloudRegion: extra?.cloudRegion ?? null,
      cloudAccountId: extra?.cloudAccountId ?? null,
    };

    return crypto
      .createHash("sha1")
      .update(JSON.stringify(normalized))
      .digest("hex");
  }

  /**
   * Additively attach labels to a telemetry service. Existing labels
   * are never removed — manual labels set via the UI survive ingest.
   * The set of labelIds passed in is fingerprinted and cached for
   * 60s so the steady-state OTel collector pushing the same labels
   * every batch costs one in-memory lookup, not a join-table scan.
   */
  @CaptureSpan()
  public async attachLabels(data: {
    serviceId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.serviceId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const serviceIdStr: string = data.serviceId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(serviceIdStr)
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
          .of(serviceIdStr)
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
        `ServiceService.attachLabels failed for service ${data.serviceId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Display name for this service, or an empty string when the row is
   * gone. Feed writers call this on a best-effort basis, so a missing row must
   * not throw and take the surrounding write down with it.
   */
  @CaptureSpan()
  public async getServiceName(data: { serviceId: ObjectID }): Promise<string> {
    const service: Model | null = await this.findOneById({
      id: data.serviceId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return service?.name || "";
  }

  @CaptureSpan()
  public async getServiceLinkInDashboard(
    projectId: ObjectID,
    serviceId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/service/${serviceId.toString()}`,
    );
  }

  /**
   * "[Service prod-1](https://…)" - the form every feed item uses to
   * name the resource it is about.
   */
  @CaptureSpan()
  public async getServiceMarkdownLink(
    projectId: ObjectID,
    serviceId: ObjectID,
  ): Promise<string> {
    const name: string = await this.getServiceName({ serviceId: serviceId });
    const link: URL = await this.getServiceLinkInDashboard(
      projectId,
      serviceId,
    );

    return `[Service ${name}](${link.toString()})`;
  }

  private async writeServiceCreatedFeed(
    createdItem: Model,
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    const projectId: ObjectID | undefined = createdItem.projectId;
    const serviceId: ObjectID | undefined = createdItem.id || undefined;

    if (!projectId || !serviceId) {
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
      resourceTypeName: "service",
      resourceMarkdownLink: await this.getServiceMarkdownLink(
        projectId,
        serviceId,
      ),
      projectId: projectId,
      createdByUserId: createdByUserId,
      description: createdItem.description,
    });

    await ServiceFeedService.createServiceFeedItem({
      serviceId: serviceId,
      projectId: projectId,
      serviceFeedEventType: ServiceFeedEventType.ServiceCreated,
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
    this.writeServiceUpdatedFeed(onUpdate, updatedItemIds).catch(
      (error: Error) => {
        logger.error(error);
      },
    );

    return onUpdate;
  }

  private async writeServiceUpdatedFeed(
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

    for (const serviceId of updatedItemIds) {
      const service: Model | null = await this.findOneById({
        id: serviceId,
        select: {
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      const projectId: ObjectID | undefined = service?.projectId;

      if (!projectId) {
        continue;
      }

      const resourceMarkdownLink: string = await this.getServiceMarkdownLink(
        projectId,
        serviceId,
      );

      if (isArchiveChange) {
        await ServiceFeedService.createServiceFeedItem({
          serviceId: serviceId,
          projectId: projectId,
          serviceFeedEventType: isArchived
            ? ServiceFeedEventType.ServiceArchived
            : ServiceFeedEventType.ServiceRestored,
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

        await ServiceFeedService.createServiceFeedItem({
          serviceId: serviceId,
          projectId: projectId,
          serviceFeedEventType: ServiceFeedEventType.ServiceUpdated,
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
