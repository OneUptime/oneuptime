import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/RumApplication";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ReceivingCoverage from "../Utils/Telemetry/ReceivingCoverage";
import ResourceHeartbeat, {
  ResourceHeartbeatResult,
} from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import SessionReplayGateCacheStore from "../Utils/SessionReplay/SessionReplayGateCacheStore";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import DiscoveredResourceCreate, {
  DiscoveredResourceNaming,
  namedAfterIdentity,
} from "../Utils/Telemetry/DiscoveredResourceCreate";
import RumApplicationLabelRuleEngineService from "./RumApplicationLabelRuleEngineService";
import RumApplicationOwnerRuleEngineService from "./RumApplicationOwnerRuleEngineService";
import { RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES } from "../../Types/Rum/RumApplicationStatus";
import {
  RUM_TELEMETRY_SIGNAL_COLUMNS,
  RumTelemetrySignal,
  RumTelemetrySignalColumn,
} from "../../Types/Rum/RumTelemetrySignal";
import UpdateBy from "../Types/Database/UpdateBy";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  SessionReplayFrustrationSettingsCheck,
  checkSessionReplayFrustrationSettings,
} from "../../Utils/Rum/SessionReplayFrustrationSettingsValidation";
import { normalizeProductAnalyticsUserPropertyKeys } from "../../Types/Rum/ProductAnalyticsEvents";

const LAST_SEEN_CACHE_NAMESPACE: string = "rum-application-last-seen";
const LAST_SEEN_THROTTLE_SECONDS: number = 60;

const LABELS_APPLIED_CACHE_NAMESPACE: string = "rum-application-labels-applied";
const LABELS_APPLIED_CACHE_TTL_SECONDS: number = 60;

const REPLAY_CHUNK_RECEIVED_CACHE_NAMESPACE: string =
  "rum-application-replay-chunk-received";
const REPLAY_CHUNK_RECEIVED_THROTTLE_SECONDS: number = 60;

const REPLAY_BUDGET_EXCEEDED_CACHE_NAMESPACE: string =
  "rum-application-replay-budget-exceeded";
const REPLAY_BUDGET_EXCEEDED_THROTTLE_SECONDS: number = 300;

/*
 * An application is matched to its telemetry by the service.name its
 * browser or mobile SDK reports, and named after it unless somebody gives
 * it a display name of their own (DiscoveredResourceCreate).
 */
const RUM_APPLICATION_NAMING: DiscoveredResourceNaming<Model> =
  namedAfterIdentity<Model>({
    identityColumn: "appIdentifier",
    resourceName: "RUM application",
    identityName: "app name",
  });

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * What counts as frustration is checked on every write and stored
   * canonical (SessionReplayFrustrationSettingsValidation): a rule outside
   * its range, a selector no browser could read or a page pattern that can
   * never match is refused with words that name it, rather than stored and
   * quietly ignored by every recorder. Run before the reference checks, by
   * the base hooks, on API writes as well as the dashboard's.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    this.canonicalizeFrustrationSignals(data);
    this.canonicalizeProductAnalyticsUserPropertyKeys(data);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: Record<string, unknown> = (updateBy.data || {}) as Record<
      string,
      unknown
    >;

    this.canonicalizeFrustrationSignals(data);
    this.canonicalizeProductAnalyticsUserPropertyKeys(data);
  }

  /*
   * The traits product analytics keeps are stored as the recorders read
   * them: trimmed, no repeats, at most the trait cap. A value that is not a
   * list of keys is refused rather than stored and read as none.
   */
  private canonicalizeProductAnalyticsUserPropertyKeys(
    data: Record<string, unknown>,
  ): void {
    const value: unknown = data["productAnalyticsUserPropertyKeys"];

    if (value === undefined) {
      return;
    }

    if (value === null) {
      data["productAnalyticsUserPropertyKeys"] = [];
      return;
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(
        "Product analytics user properties must be a list of trait keys.",
      );
    }

    data["productAnalyticsUserPropertyKeys"] =
      normalizeProductAnalyticsUserPropertyKeys(value);
  }

  /*
   * What an application created from now on starts with, where the create
   * leaves it unset: product analytics events on. The column defaults stay
   * off, so existing applications - and anything that writes a row without
   * this service - keep what they had.
   */
  public static applyNewApplicationDefaults(data: Model): void {
    if (data.isProductAnalyticsEnabled === undefined) {
      data.isProductAnalyticsEnabled = true;
    }
  }

  private canonicalizeFrustrationSignals(data: Record<string, unknown>): void {
    // A write that leaves the signals alone is not judged on them.
    if (data["sessionReplayFrustrationSignals"] === undefined) {
      return;
    }

    const check: SessionReplayFrustrationSettingsCheck =
      checkSessionReplayFrustrationSettings(
        data["sessionReplayFrustrationSignals"],
        (): string => {
          return ObjectID.generate().toString();
        },
      );

    if (check.problem) {
      throw new BadDataException(check.problem);
    }

    data["sessionReplayFrustrationSignals"] = check.settings;
  }

  // Named after its app name when nobody gave it a name.
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    DiscoveredResourceCreate.fillName({
      createBy,
      naming: RUM_APPLICATION_NAMING,
    });

    Service.applyNewApplicationDefaults(createBy.data);

    return { createBy, carryForward: null };
  }

  /*
   * An application that is already there - discovered from its telemetry or
   * added before - is refused by its app name, not as a clash of names.
   */
  @CaptureSpan()
  protected override async onBeforeCreateUniqueCheck(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    await DiscoveredResourceCreate.refuseClash({
      service: this,
      createBy,
      naming: RUM_APPLICATION_NAMING,
    });
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      Promise.resolve()
        .then(async () => {
          await RumApplicationLabelRuleEngineService.applyRulesToRumApplication(
            createdItem,
          );
        })
        .then(async () => {
          await RumApplicationOwnerRuleEngineService.applyRulesToRumApplication(
            createdItem,
          );
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying RUM application rules in RumApplicationService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              rumApplicationId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }

  /*
   * Session replay policy invalidation.
   *
   * The ingest gate caches the resolved policy for POLICY_CACHE_TTL_MS per
   * pod, and the config endpoint is cached in the browser for 300s on top of
   * that. Without these hooks, switching replay off for an application would
   * keep being accepted for up to ~6 minutes across the fleet - so the kill
   * key exists precisely to be written here.
   *
   * The kill key is per PROJECT, which is coarser than the per-application
   * change that triggered it: disabling one application in a multi-app
   * project briefly refuses the project's other applications too. That is
   * accepted deliberately. The window is KILL_KEY_CACHE_TTL_MS plus the
   * policy TTL, the failure mode is "a few recordings not taken", and the
   * alternative - keying on projectId:appIdentifier - would leave the
   * project-level `isSessionReplayAllowed` switch with no fast path at all.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await this.invalidateSessionReplayPolicy({
      updateData: onUpdate.updateBy.data as Record<string, unknown>,
      itemIds: updatedItemIds,
      tenantId: onUpdate.updateBy.props.tenantId,
    });

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    /*
     * A deleted application can never be re-enabled, so this always takes
     * the "turn it off now" path rather than only clearing the cache.
     */
    await this.invalidateSessionReplayPolicy({
      updateData: { isSessionReplayEnabled: false },
      itemIds: itemIdsBeforeDelete,
      tenantId: onDelete.deleteBy.props.tenantId,
    });

    return onDelete;
  }

  private async invalidateSessionReplayPolicy(data: {
    updateData: Record<string, unknown>;
    itemIds: Array<ObjectID>;
    tenantId: ObjectID | undefined;
  }): Promise<void> {
    /*
     * Only replay-relevant edits invalidate. A lastSeenAt heartbeat or a
     * label change must not write a kill key, and updateLastSeen bypasses
     * hooks entirely for the same reason.
     */
    const touchesReplayPolicy: boolean = Object.keys(data.updateData).some(
      (key: string): boolean => {
        return (
          key.startsWith("sessionReplay") || key === "isSessionReplayEnabled"
        );
      },
    );

    if (!touchesReplayPolicy) {
      return;
    }

    const projectIds: Array<ObjectID> = await this.resolveProjectIds(data);

    const isTurningOff: boolean =
      data.updateData["isSessionReplayEnabled"] === false;

    for (const projectId of projectIds) {
      try {
        SessionReplayGateCacheStore.clearCache(projectId);

        if (isTurningOff) {
          await SessionReplayGateCacheStore.markProjectDisabled(projectId);
        } else {
          /*
           * Any other replay edit (including turning it back ON) must also
           * drop a kill key left over from an earlier disable, or the
           * project stays refused for the remainder of the key's TTL.
           */
          await SessionReplayGateCacheStore.clearProjectDisabled(projectId);
        }
      } catch (err) {
        /*
         * Best effort. The ordinary cache expiry still applies, so a Redis
         * outage degrades the response time of a settings change rather
         * than failing the settings change itself.
         */
        logger.warn(
          `RumApplicationService: could not invalidate the session replay gate cache for project ${projectId.toString()}`,
        );
        logger.warn(err);
      }
    }
  }

  private async resolveProjectIds(data: {
    itemIds: Array<ObjectID>;
    tenantId: ObjectID | undefined;
  }): Promise<Array<ObjectID>> {
    if (data.tenantId) {
      return [data.tenantId];
    }

    /*
     * A root-props update carries no tenantId, so the project has to be read
     * back off the rows that were touched.
     */
    const projectIds: Map<string, ObjectID> = new Map();

    for (const id of data.itemIds) {
      const app: Model | null = await this.findOneById({
        id: id,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (app?.projectId) {
        projectIds.set(app.projectId.toString(), app.projectId);
      }
    }

    return Array.from(projectIds.values());
  }

  @CaptureSpan()
  public async findOrCreateByAppIdentifier(data: {
    projectId: ObjectID;
    appIdentifier: string;
  }): Promise<Model> {
    const existingApp: Model | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        appIdentifier: QueryHelper.findWithSameText(data.appIdentifier),
      },
      select: {
        _id: true,
        projectId: true,
        appIdentifier: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (existingApp) {
      return existingApp;
    }

    try {
      const newApp: Model = new Model();
      newApp.projectId = data.projectId;
      newApp.name = data.appIdentifier;
      newApp.appIdentifier = data.appIdentifier;
      newApp.otelCollectorStatus = "connected";
      newApp.lastSeenAt = OneUptimeDate.getCurrentDate();

      const createdApp: Model = await this.create({
        data: newApp,
        props: {
          isRoot: true,
        },
      });

      return createdApp;
    } catch {
      const reFetchedApp: Model | null = await this.findOneBy({
        query: {
          projectId: data.projectId,
          appIdentifier: QueryHelper.findWithSameText(data.appIdentifier),
        },
        select: {
          _id: true,
          projectId: true,
          appIdentifier: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (reFetchedApp) {
        return reFetchedApp;
      }

      throw new Error(
        "Failed to create or find RUM application: " + data.appIdentifier,
      );
    }
  }

  @CaptureSpan()
  public async updateLastSeen(
    rumApplicationId: ObjectID,
    extra?: {
      agentVersion?: string | undefined;
      clientType?: string | undefined;
      sdkLanguage?: string | undefined;
    },
  ): Promise<ResourceHeartbeatResult> {
    const extrasFingerprint: string = crypto
      .createHash("sha1")
      .update(
        JSON.stringify({
          agentVersion: extra?.agentVersion ?? null,
          clientType: extra?.clientType ?? null,
          sdkLanguage: extra?.sdkLanguage ?? null,
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
    if (extra?.clientType) {
      metadata.clientType = extra.clientType;
    }
    if (extra?.sdkLanguage) {
      metadata.sdkLanguage = extra.sdkLanguage;
    }

    /*
     * One gated, non-blocking heartbeat write. The gates, the fail-open /
     * fail-closed split and the liveness-only fallback all live in
     * ResourceHeartbeat — see there for why this row's throttle used to
     * provide no throttling at all.
     */
    return await ResourceHeartbeat.write({
      service: this,
      id: rumApplicationId,
      cacheNamespace: LAST_SEEN_CACHE_NAMESPACE,
      throttleInSeconds: LAST_SEEN_THROTTLE_SECONDS,
      liveness: liveness,
      metadata: metadata,
      fingerprint: extrasFingerprint,
      describe: `rum application ${rumApplicationId.toString()}`,
    });
  }

  /*
   * Session replay ingest health markers.
   *
   * Both write columns whose names start with "sessionReplay", which the
   * onUpdateSuccess hook treats as a policy edit (cache clear + kill-key
   * churn) - so they MUST go through the hook-free single-statement path,
   * exactly like updateLastSeen. They also skip the updatedAt refresh:
   * configEpoch is derived from updatedAt, and a passive health timestamp
   * broadcasting "configuration changed" to every live recorder once a
   * minute would be self-inflicted config-fetch load.
   *
   * Throttled through GlobalCache so 20k chunks/min becomes at most one
   * Postgres write per application per window across the whole fleet.
   * Failures are swallowed after a warn: this bookkeeping must never make
   * an ingest request fail.
   */
  @CaptureSpan()
  public async markSessionReplayChunkReceived(
    rumApplicationId: ObjectID,
  ): Promise<void> {
    await this.writeReplayHealthColumn({
      rumApplicationId: rumApplicationId,
      cacheNamespace: REPLAY_CHUNK_RECEIVED_CACHE_NAMESPACE,
      throttleSeconds: REPLAY_CHUNK_RECEIVED_THROTTLE_SECONDS,
      column: "sessionReplayLastChunkReceivedAt",
    });
  }

  /*
   * A batch of traces, logs or metrics arrived from this application: its
   * <signal>LastReceivedAt column says so (RumTelemetrySignal, issue #5770).
   *
   * The OpenTelemetry ingest path calls this behind its per-signal
   * maintenance fence (OtelIngestBaseService), so it runs at most once per
   * signal per application per fence window however many batches arrive -
   * no throttle of its own here. Hook-free and without an updatedAt
   * refresh for the reason the replay markers above are: a passive
   * timestamp must not churn configEpoch, which every live recorder
   * watches. It throws on failure, so the caller can release its fence and
   * let the next batch try again.
   */
  @CaptureSpan()
  public async markTelemetrySignalReceived(data: {
    rumApplicationId: ObjectID;
    signal: RumTelemetrySignal;
  }): Promise<void> {
    const column: RumTelemetrySignalColumn | undefined =
      RUM_TELEMETRY_SIGNAL_COLUMNS[data.signal];

    if (!column) {
      return;
    }

    await this.updateColumnsByIdWithoutHooks({
      id: data.rumApplicationId,
      data: {
        [column]: OneUptimeDate.getCurrentDate(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      skipUpdateDateColumn: true,
    });
  }

  @CaptureSpan()
  public async markSessionReplayBudgetExceeded(
    rumApplicationId: ObjectID,
  ): Promise<void> {
    await this.writeReplayHealthColumn({
      rumApplicationId: rumApplicationId,
      cacheNamespace: REPLAY_BUDGET_EXCEEDED_CACHE_NAMESPACE,
      throttleSeconds: REPLAY_BUDGET_EXCEEDED_THROTTLE_SECONDS,
      column: "sessionReplayBudgetExceededAt",
    });
  }

  private async writeReplayHealthColumn(data: {
    rumApplicationId: ObjectID;
    cacheNamespace: string;
    throttleSeconds: number;
    column:
      | "sessionReplayLastChunkReceivedAt"
      | "sessionReplayBudgetExceededAt";
  }): Promise<void> {
    const cacheKey: string = data.rumApplicationId.toString();

    try {
      const cached: string | null = await GlobalCache.getString(
        data.cacheNamespace,
        cacheKey,
      );

      if (cached) {
        return; // written recently, across all pods
      }
    } catch {
      /*
       * Cache unavailable - fail open and write anyway, same stance as
       * updateLastSeen: a stale health column is worse than an occasional
       * extra single-row UPDATE.
       */
    }

    try {
      await GlobalCache.setString(data.cacheNamespace, cacheKey, "1", {
        expiresInSeconds: data.throttleSeconds,
      });
    } catch {
      // Best-effort throttle write; proceed with the DB update regardless.
    }

    try {
      await this.updateColumnsByIdWithoutHooks({
        id: data.rumApplicationId,
        data: {
          [data.column]: OneUptimeDate.getCurrentDate(),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
        skipUpdateDateColumn: true,
      });
    } catch (err) {
      logger.warn(
        `RumApplicationService: could not write ${data.column} for application ${cacheKey}`,
      );
      logger.warn(err);
    }
  }

  @CaptureSpan()
  public async attachLabels(data: {
    rumApplicationId: ObjectID;
    labelIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.labelIds || data.labelIds.length === 0) {
      return;
    }

    const cacheKey: string = data.rumApplicationId.toString();
    const fingerprint: string = fingerprintLabelIds(data.labelIds);
    const cached: string | null = await GlobalCache.getString(
      LABELS_APPLIED_CACHE_NAMESPACE,
      cacheKey,
    );
    if (cached === fingerprint) {
      return;
    }

    try {
      const appIdStr: string = data.rumApplicationId.toString();
      const existingLabels: Array<Label> = await this.getRepository()
        .createQueryBuilder()
        .relation(Model, "labels")
        .of(appIdStr)
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
          .of(appIdStr)
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
        `RumApplicationService.attachLabels failed for application ${data.rumApplicationId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /*
   * "disconnected" is the stored value; the Dashboard says "No recent
   * traffic", in grey (RumApplicationStatus, issue #6191). A RUM
   * application's data comes from the people using the app, so fifteen
   * minutes with nothing is usually nobody using it, not a broken link.
   */
  @CaptureSpan()
  public async markDisconnectedApplications(): Promise<void> {
    /*
     * Threshold must stay well above the 5-minute OTel ingest
     * maintenance fence (MAINTENANCE_FENCE_TTL_SECONDS in
     * OtelIngestBaseService) — lastSeenAt is legitimately up to
     * ~5 minutes stale during continuous telemetry, so a threshold
     * equal to the fence TTL flaps healthy resources. 15 minutes
     * gives 3x headroom. The status's words say the same number, so
     * both read it from RumApplicationStatus.
     */
    /*
     * Measured in time OneUptime was receiving: a stretch when OneUptime
     * itself was down, starting up or catching up on its ingest queue is
     * not silence held against the resource (issue #2825). With no such
     * stretch this is exactly 15 minutes ago.
     */
    const silenceCutoff: Date = await ReceivingCoverage.getSilenceCutoff({
      silenceInMinutes: RUM_APPLICATION_NO_RECENT_TRAFFIC_AFTER_MINUTES,
    });

    const connectedApps: Array<Model> = await this.findBy({
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

    for (const rumApplication of connectedApps) {
      if (rumApplication._id) {
        await this.updateOneById({
          id: new ObjectID(rumApplication._id.toString()),
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
