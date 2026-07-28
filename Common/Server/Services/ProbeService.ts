import crypto from "crypto";
import User from "../../Models/DatabaseModels/User";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ObjectID from "../../Types/ObjectID";
import Version from "../../Types/Version";
import Model, {
  ProbeConnectionStatus,
} from "../../Models/DatabaseModels/Probe";
import ProbeOwnerUser from "../../Models/DatabaseModels/ProbeOwnerUser";
import ProbeOwnerUserService from "./ProbeOwnerUserService";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ProbeOwnerTeam from "../../Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerTeamService from "./ProbeOwnerTeamService";
import TeamMemberService from "./TeamMemberService";
import BadDataException from "../../Types/Exception/BadDataException";
import ProjectService from "./ProjectService";
import Dictionary from "../../Types/Dictionary";
import OneUptimeDate from "../../Types/Date";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import logger, { LogAttributes } from "../Utils/Logger";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import { SMSMessage } from "../../Types/SMS/SMS";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import DatabaseConfig from "../DatabaseConfig";
import URL from "../../Types/API/URL";
import UpdateBy from "../Types/Database/UpdateBy";
import MonitorService from "./MonitorService";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { IsBillingEnabled } from "../EnvironmentConfig";
import GlobalCache from "../Infrastructure/GlobalCache";
import { createWhatsAppMessageFromTemplate } from "../Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "../../Types/WhatsApp/WhatsAppMessage";

/*
 * Cache namespace for the probe heartbeat throttle: holds the wall-clock of
 * the last attempted lastAlive write per probe, so at most one Postgres
 * write happens per probe per 30 seconds no matter how many requests the
 * probe sends.
 */
const PROBE_LAST_ALIVE_CACHE_NAMESPACE: string = "probe-last-alive";

/*
 * Cache namespace for probe authentication: probeId → SHA-256 of the
 * probe's CURRENT key, written only after the key was verified against the
 * database. Lets the probe-auth middleware skip its per-request Probe
 * SELECT — the exact query that queues behind a starved connection pool and
 * stalls heartbeats. Entries are deleted whenever a probe's key changes or
 * the probe is deleted (see onUpdateSuccess / onDeleteSuccess below), and
 * the TTL bounds the exposure if that invalidation is ever missed.
 */
const PROBE_AUTH_KEY_HASH_CACHE_NAMESPACE: string = "probe-auth-key-hash";
const PROBE_AUTH_KEY_HASH_CACHE_TTL_IN_SECONDS: number = 120;

/*
 * Revocation sentinel. Invalidation WRITES this value (with the normal TTL)
 * instead of deleting the key: a bare DELETE can be silently undone by an
 * in-flight verification that DB-checked the OLD key just before a rotation
 * committed and then re-cached it just after the delete ran. The sentinel —
 * combined with verifyProbeKey's write-only-if-unchanged re-read below —
 * makes the straggler skip its write, so invalidation wins the race. It can
 * never equal a real SHA-256 hex digest, so on the auth path it always
 * behaves as a cache miss.
 */
const PROBE_AUTH_KEY_REVOKED_SENTINEL: string = "revoked";

/*
 * Upper bound for a single Redis cache operation on the probe request path.
 * The ioredis client has no command timeout, so a stalled-but-open Redis
 * socket would otherwise hang the probe-auth middleware forever with no
 * error at all. Cache is an optimization here — on timeout we fall back to
 * the database, exactly as we do when Redis rejects.
 */
const PROBE_CACHE_OPERATION_TIMEOUT_IN_MS: number = 2000;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Bounds a cache operation in time. Promise.race subscribes to both
   * promises, so a late settlement of the losing cache operation is
   * observed and can never surface as an unhandled rejection.
   */
  private async boundedCacheOperation<T>(
    operationName: string,
    operation: Promise<T>,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const timeout: Promise<never> = new Promise<never>(
      (_resolve: (value: never) => void, reject: (err: Error) => void) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `${operationName} timed out after ${PROBE_CACHE_OPERATION_TIMEOUT_IN_MS}ms`,
            ),
          );
        }, PROBE_CACHE_OPERATION_TIMEOUT_IN_MS);
      },
    );

    try {
      return await Promise.race([operation, timeout]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  public hashProbeKey(probeKey: string): string {
    return crypto.createHash("sha256").update(probeKey).digest("hex");
  }

  /*
   * Verifies a probeId/probeKey pair, serving repeat verifications from
   * cache. This runs on EVERY authenticated probe request (heartbeats,
   * monitor list fetches, result ingest), so it must stay responsive even
   * when the Postgres pool is saturated — which is exactly when the
   * heartbeat matters most: if this check queues behind a starved pool, the
   * probe's lastAlive goes stale and a healthy probe gets flagged
   * Disconnected.
   *
   * Security invariants:
   * - The cache stores only a SHA-256 hash of the key, never the key.
   * - A cache entry is only ever written from a value that was JUST
   *   verified against the database.
   * - A cache mismatch falls through to the database, so a rotated key
   *   works immediately.
   * - Rotating or deleting a probe overwrites its cache entry cluster-wide
   *   with the revocation sentinel (GlobalCache is Redis-backed), and the
   *   write below is write-only-if-unchanged so an in-flight verification
   *   straddling the rotation cannot resurrect the old hash. The TTL caps
   *   the stale window if the invalidation write itself fails: a REVOKED
   *   key can then still authenticate for at most
   *   PROBE_AUTH_KEY_HASH_CACHE_TTL_IN_SECONDS.
   * - Any cache failure (Redis down, slow, timeout) falls back to the
   *   database check — never open.
   */
  public async verifyProbeKey(data: {
    probeId: ObjectID;
    probeKey: string;
  }): Promise<boolean> {
    if (!data.probeId) {
      throw new BadDataException("probeId is required");
    }

    if (!data.probeKey) {
      throw new BadDataException("probeKey is required");
    }

    const presentedKeyHash: string = this.hashProbeKey(data.probeKey);

    try {
      const cachedKeyHash: string | null = await this.boundedCacheOperation(
        "Probe auth cache read",
        GlobalCache.getString(
          PROBE_AUTH_KEY_HASH_CACHE_NAMESPACE,
          data.probeId.toString(),
        ),
      );

      if (cachedKeyHash && cachedKeyHash === presentedKeyHash) {
        return true;
      }
    } catch (err) {
      logger.error("Error in reading probe auth cache", {
        probeId: data.probeId?.toString(),
      } as LogAttributes);
      logger.error(err, {
        probeId: data.probeId?.toString(),
      } as LogAttributes);
    }

    // Cache miss, mismatch (e.g. key rotated), or cache failure: ask the DB.
    const probe: Model | null = await this.findOneBy({
      query: {
        _id: data.probeId.toString(),
        key: data.probeKey,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!probe) {
      return false;
    }

    try {
      /*
       * Write-only-if-unchanged: re-read the entry right before writing and
       * skip the write when someone else changed it since our first read.
       * The DB verification above can straddle a key rotation — its SELECT
       * resolves against the pre-rotation row, the rotation commits and
       * invalidates, and an unconditional write here would then re-cache
       * the just-revoked key for a fresh TTL. Seeing the revocation
       * sentinel (or any other concurrent write) means skip: the DB check
       * stays the source of truth and caching resumes once the entry
       * expires. The remaining race window is the microseconds between
       * this re-read and the write — down from the full DB round-trip.
       */
      const currentCacheValue: string | null = await this.boundedCacheOperation(
        "Probe auth cache pre-write read",
        GlobalCache.getString(
          PROBE_AUTH_KEY_HASH_CACHE_NAMESPACE,
          data.probeId.toString(),
        ),
      );

      if (
        currentCacheValue === null ||
        currentCacheValue === presentedKeyHash
      ) {
        await this.boundedCacheOperation(
          "Probe auth cache write",
          GlobalCache.setString(
            PROBE_AUTH_KEY_HASH_CACHE_NAMESPACE,
            data.probeId.toString(),
            presentedKeyHash,
            {
              expiresInSeconds: PROBE_AUTH_KEY_HASH_CACHE_TTL_IN_SECONDS,
            },
          ),
        );
      }
    } catch (err) {
      // Next request re-verifies against the DB. Nothing is broken.
      logger.error("Error in writing probe auth cache", {
        probeId: data.probeId?.toString(),
      } as LogAttributes);
      logger.error(err, {
        probeId: data.probeId?.toString(),
      } as LogAttributes);
    }

    return true;
  }

  /*
   * Replaces cached auth entries with the revocation sentinel so a rotated
   * key stops working everywhere immediately (the cache is Redis-backed and
   * shared by all pods). A sentinel WRITE rather than a delete: a deleted
   * key can be silently re-created by an in-flight verification that
   * DB-checked the old key just before the rotation committed, whereas the
   * sentinel makes that straggler's write-only-if-unchanged check fail.
   * Errors are logged loudly but not thrown: the entries also expire via
   * TTL, and failing the surrounding update/delete over a cache hiccup
   * would be worse than a bounded stale window.
   */
  public async invalidateProbeAuthCache(
    probeIds: Array<ObjectID>,
  ): Promise<void> {
    for (const probeId of probeIds) {
      try {
        await this.boundedCacheOperation(
          "Probe auth cache invalidation",
          GlobalCache.setString(
            PROBE_AUTH_KEY_HASH_CACHE_NAMESPACE,
            probeId.toString(),
            PROBE_AUTH_KEY_REVOKED_SENTINEL,
            {
              expiresInSeconds: PROBE_AUTH_KEY_HASH_CACHE_TTL_IN_SECONDS,
            },
          ),
        );
      } catch (err) {
        logger.error(
          `CRITICAL: failed to invalidate probe auth cache for probe ${probeId.toString()} — a rotated/revoked probe key may keep authenticating for up to ${PROBE_AUTH_KEY_HASH_CACHE_TTL_IN_SECONDS}s`,
          { probeId: probeId?.toString() } as LogAttributes,
        );
        logger.error(err, { probeId: probeId?.toString() } as LogAttributes);
      }
    }
  }

  public async saveLastAliveInCache(
    probeId: ObjectID,
    lastAlive: Date,
  ): Promise<void> {
    if (!probeId) {
      throw new BadDataException("probeId is required");
    }

    try {
      await this.boundedCacheOperation(
        "Probe last-alive cache write",
        GlobalCache.setString(
          PROBE_LAST_ALIVE_CACHE_NAMESPACE,
          probeId.toString(),
          OneUptimeDate.toString(lastAlive),
        ),
      );
    } catch (err) {
      logger.error("Error in saving last alive in cache", {
        projectId: probeId?.toString(),
      } as LogAttributes);
      logger.error(err, { projectId: probeId?.toString() } as LogAttributes);
    }
  }

  public async shouldSaveLastAlive(probeId: ObjectID): Promise<boolean> {
    const now: Date = OneUptimeDate.getCurrentDate();

    try {
      // before we hit the database, we need to check if the lastAlive was updated in Global Cache.
      const previousLastAliveCheck: string | null =
        await this.boundedCacheOperation(
          "Probe last-alive cache read",
          GlobalCache.getString(
            PROBE_LAST_ALIVE_CACHE_NAMESPACE,
            probeId.toString(),
          ),
        );

      if (!previousLastAliveCheck) {
        await this.saveLastAliveInCache(probeId, now);
        return true;
      }

      const previousLastAliveCheckDate: Date | null = OneUptimeDate.fromString(
        previousLastAliveCheck,
      );

      // if this date is within 30 seconds of current date, then we will not update the last alive.
      if (previousLastAliveCheckDate) {
        const diff: number = OneUptimeDate.getDifferenceInSeconds(
          now,
          previousLastAliveCheckDate,
        );

        if (diff < 30) {
          return false;
        }
      }

      await this.saveLastAliveInCache(probeId, now);
    } catch (err) {
      // failed to hit the cache, so we will hit the database
      logger.error("Error in getting last alive from cache", {
        probeId: probeId?.toString(),
      } as LogAttributes);
      logger.error(err, { probeId: probeId?.toString() } as LogAttributes);
    }

    return true;
  }

  public async updateLastAlive(probeId: ObjectID): Promise<void> {
    if (!probeId) {
      throw new BadDataException("probeId is required");
    }

    const shouldSaveLastAlive: boolean =
      await this.shouldSaveLastAlive(probeId);

    if (!shouldSaveLastAlive) {
      return;
    }

    const now: Date = OneUptimeDate.getCurrentDate();

    /*
     * Heartbeat write: a single-statement UPDATE with no hooks and no
     * `version` bump. This fires from the probe-auth middleware on every
     * authenticated probe request, so it must not head the hot-row Postgres
     * lock convoy the full updateOneById pipeline causes. A lastAlive-only
     * write never sets connectionStatus, so the connection-status-change
     * hooks (onBeforeUpdate/onUpdateSuccess) are inert here. See
     * ServiceService.updateLastSeen.
     */
    try {
      await this.updateColumnsByIdWithoutHooks({
        id: probeId,
        data: {
          lastAlive: now,
        },
      });
    } catch (err) {
      /*
       * The 30s throttle stamp was written BEFORE this write was attempted
       * (shouldSaveLastAlive sets it — deliberately, as dogpile
       * protection). If we leave it in place after a FAILED write, every
       * request for the next 30 seconds silently skips the retry, lastAlive
       * quietly crosses the connection-status worker's staleness threshold,
       * and a healthy probe gets flagged Disconnected. Clear the stamp so
       * the very next request retries the write.
       */
      await this.clearLastAliveThrottle(probeId);
      throw err;
    }
  }

  // Best-effort: on failure the throttle simply expires on its own.
  private async clearLastAliveThrottle(probeId: ObjectID): Promise<void> {
    try {
      await this.boundedCacheOperation(
        "Probe last-alive throttle clear",
        GlobalCache.deleteKey(
          PROBE_LAST_ALIVE_CACHE_NAMESPACE,
          probeId.toString(),
        ),
      );
    } catch (err) {
      logger.error("Error in clearing last alive throttle", {
        probeId: probeId?.toString(),
      } as LogAttributes);
      logger.error(err, { probeId: probeId?.toString() } as LogAttributes);
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.key) {
      createBy.data.key = ObjectID.generate().toString();
    }

    if (!createBy.data.probeVersion) {
      createBy.data.probeVersion = new Version("1.0.0");
    }

    return { createBy: createBy, carryForward: [] };
  }

  @CaptureSpan()
  public async getOwners(probeId: ObjectID): Promise<Array<User>> {
    if (!probeId) {
      throw new BadDataException("probeId is required");
    }

    const ownerUsers: Array<ProbeOwnerUser> =
      await ProbeOwnerUserService.findBy({
        query: {
          probeId: probeId,
        },
        select: {
          _id: true,
          user: {
            _id: true,
            email: true,
            name: true,
            timezone: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const ownerTeams: Array<ProbeOwnerTeam> =
      await ProbeOwnerTeamService.findBy({
        query: {
          probeId: probeId,
        },
        select: {
          _id: true,
          teamId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const users: Array<User> =
      ownerUsers.map((ownerUser: ProbeOwnerUser) => {
        return ownerUser.user!;
      }) || [];

    if (ownerTeams.length > 0) {
      const teamIds: Array<ObjectID> =
        ownerTeams.map((ownerTeam: ProbeOwnerTeam) => {
          return ownerTeam.teamId!;
        }) || [];

      const teamUsers: Array<User> =
        await TeamMemberService.getUsersInTeams(teamIds);

      for (const teamUser of teamUsers) {
        //check if the user is already added.
        const isUserAlreadyAdded: User | undefined = users.find(
          (user: User) => {
            return user.id!.toString() === teamUser.id!.toString();
          },
        );

        if (!isUserAlreadyAdded) {
          users.push(teamUser);
        }
      }
    }

    return users;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: any = {
      probesToNotifyOwners: [],
    };

    if (updateBy.data.connectionStatus && updateBy.query._id) {
      const probes: Array<Model> = await this.findBy({
        query: updateBy.query,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          connectionStatus: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
      });

      const probesToNotifyOwners: Array<Model> = probes.filter(
        (probe: Model) => {
          return (
            probe.connectionStatus &&
            probe.connectionStatus !== updateBy.data.connectionStatus
          );
        },
      );

      carryForward.probesToNotifyOwners = probesToNotifyOwners;
    }

    return { updateBy: updateBy, carryForward };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    /*
     * Key rotation: the auth middleware trusts a cached hash of the key, so
     * the moment the key column changes the cached entries for the updated
     * probes must go — otherwise the OLD key keeps authenticating until the
     * cache TTL runs out.
     */
    if (onUpdate.updateBy.data.key !== undefined) {
      await this.invalidateProbeAuthCache(updatedItemIds);
    }

    if (
      onUpdate.carryForward &&
      onUpdate.carryForward.probesToNotifyOwners.length > 0
    ) {
      for (const probe of onUpdate.carryForward.probesToNotifyOwners) {
        await MonitorService.refreshProbeStatus(probe.id!);

        await this.notifyOwnersOnStatusChange({
          probeId: probe.id!,
        });
      }
    }

    return Promise.resolve(onUpdate);
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    // A deleted probe's key must stop authenticating.
    await this.invalidateProbeAuthCache(itemIdsBeforeDelete);

    return Promise.resolve(onDelete);
  }

  @CaptureSpan()
  public async notifyOwnersOnStatusChange(data: {
    probeId: ObjectID;
  }): Promise<void> {
    const probe: Model | null = await this.findOneById({
      id: data.probeId,
      props: {
        isRoot: true,
      },
      select: {
        _id: true,
        lastAlive: true,
        connectionStatus: true,
        isGlobalProbe: true,
        name: true,
        description: true,
        projectId: true,
        project: {
          name: true,
        },
      },
    });

    if (!probe || !probe.id) {
      throw new BadDataException("Probe not found");
    }

    if (!probe.projectId) {
      return; // might be global probe. Do not notify.
    }

    if (probe.isGlobalProbe && IsBillingEnabled) {
      return; // do not notify for global probes.
    }

    // notify the probe owner
    let owners: Array<User> = await this.getOwners(probe.id!);

    let doesResourceHasOwners: boolean = true;

    if (owners.length === 0) {
      doesResourceHasOwners = false;

      // find project owners.
      owners = await ProjectService.getOwners(probe.projectId!);
    }

    if (owners.length === 0) {
      return; // no owners to notify.
    }

    const connectionStatus: string =
      probe.connectionStatus === ProbeConnectionStatus.Connected
        ? "Connected"
        : "Disconnected";

    for (const user of owners) {
      try {
        const vars: Dictionary<string> = {
          title: `${probe.name} is ${connectionStatus}`,
          probeName: probe.name || "Probe",
          probeDescription: probe.description || "No description provided",
          projectName: probe.project?.name || "Project",
          probeStatus: connectionStatus || "Unknown",
          lastAlive: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: probe.lastAlive || OneUptimeDate.getCurrentDate(),
            timezones: user.timezone ? [user.timezone] : [],
          }),
          viewProbesLink: (
            await this.getLinkInDashboard(probe.projectId!, probe.id!)
          ).toString(),
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ProbeConnectionStatusChange,
          vars: vars,
          subject: `[Probe ${connectionStatus}] ${probe.name}`,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. Probe ${probe.name} is ${connectionStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. Probe ${probe.name} is ${connectionStatus}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
            },
          ],
        };

        const pushMessageParams: {
          probeName: string;
          projectName: string;
          connectionStatus: string;
          clickAction?: string;
        } = {
          probeName: probe.name!,
          projectName: probe.project?.name || "Project",
          connectionStatus: connectionStatus,
        };

        if (vars["viewProbesLink"]) {
          pushMessageParams.clickAction = vars["viewProbesLink"];
        }

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createProbeStatusChangedNotification(
            pushMessageParams,
          );

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_PROBE_STATUS_CHANGED_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              probe_name: probe.name!,
              probe_status: connectionStatus,
              probe_link: vars["viewProbesLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: probe.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
        });
      } catch (e) {
        logger.error(
          "Error in sending incident created resource notification",
          { projectId: probe.projectId?.toString() } as LogAttributes,
        );
        logger.error(e, {
          projectId: probe.projectId?.toString(),
        } as LogAttributes);
      }
    }
  }

  @CaptureSpan()
  public async getLinkInDashboard(
    projectId: ObjectID,
    probeId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/settings/probes/${probeId.toString()}`,
    );
  }
}

export default new Service();
