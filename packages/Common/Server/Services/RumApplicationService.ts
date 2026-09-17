import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/RumApplication";
import Label from "../../Models/DatabaseModels/Label";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import ResourceHeartbeat from "../Utils/Telemetry/ResourceHeartbeat";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import OneUptimeDate from "../../Types/Date";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import GlobalCache from "../Infrastructure/GlobalCache";
import SessionReplayGateCacheStore from "../Utils/SessionReplay/SessionReplayGateCacheStore";
import logger, { LogAttributes } from "../Utils/Logger";
import crypto from "crypto";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import RumApplicationLabelRuleEngineService from "./RumApplicationLabelRuleEngineService";
import RumApplicationOwnerRuleEngineService from "./RumApplicationOwnerRuleEngineService";

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

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
  ): Promise<void> {
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
    await ResourceHeartbeat.write({
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

  @CaptureSpan()
  public async markDisconnectedApplications(): Promise<void> {
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

    const connectedApps: Array<Model> = await this.findBy({
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
