import { EntityManager } from "typeorm";
import DatabaseService from "./DatabaseService";
import Model, {
  DiscordResourceThreadState,
  DiscordResourceType,
} from "../../Models/DatabaseModels/DiscordResourceThread";
import WorkspaceProjectAuthToken from "../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import IncidentService from "./IncidentService";
import AlertService from "./AlertService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
import HTTPMethod from "../../Types/API/HTTPMethod";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray, JSONObject } from "../../Types/JSON";
import WorkspaceType from "../../Types/Workspace/WorkspaceType";
import WorkspaceNotificationActionType from "../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../Types/Workspace/WorkspaceNotificationStatus";
import DiscordClient, {
  DiscordAPIError,
  DiscordAmbiguousOutcomeError,
} from "../Utils/Workspace/Discord/DiscordClient";
import { WorkspaceChannel } from "../Utils/Workspace/WorkspaceBase";
import NotificationRuleWorkspaceChannel from "../../Types/Workspace/NotificationRules/NotificationRuleWorkspaceChannel";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import PostgresErrorTranslator from "../Utils/Database/PostgresErrorTranslator";

/*
 * Why this service exists (HOM-42): the shared rule path called
 * Discord.createChannel unconditionally and remembered the result only in
 * the resource's postUpdatesToWorkspaceChannels column, written after the
 * remote call. A duplicate delivery, a lost answer, a crash before that
 * write, or a disconnect/reconnect in flight each produced a second thread
 * or attached one to the wrong installation. Every thread now has a
 * DiscordResourceThread row: the INSERT is the claim, the row carries the
 * installation generation, and no remote result is saved without
 * re-checking that generation and the resource state under a lock.
 *
 * Nothing here holds a database transaction across a Discord request.
 */

const CLAIM_WAIT_MS: number = 15_000;
const CLAIM_POLL_MS: number = 500;
// A "creating" row older than this belongs to a worker that died mid-call.
const CLAIM_LEASE_MS: number = 60_000;
const THREAD_CREATE_AUDIT_ACTION: number = 110;

export interface ResourceRef {
  resourceType: DiscordResourceType;
  resourceId: ObjectID;
}

interface Installation {
  id: ObjectID;
  version: number;
  authToken: string;
  guildId: string;
  parentId: string;
  botUserId: string;
}

type FenceOutcome = "written" | "generation-moved" | "state-changed" | "final";

export class ThreadReconcileConflict extends BadDataException {}

export function resourceFromNotificationFor(notificationFor: {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  alertEpisodeId?: ObjectID | undefined;
  incidentEpisodeId?: ObjectID | undefined;
  scheduledMaintenanceId?: ObjectID | undefined;
  monitorId?: ObjectID | undefined;
  onCallDutyPolicyId?: ObjectID | undefined;
}): ResourceRef | null {
  const pairs: Array<[DiscordResourceType, ObjectID | undefined]> = [
    [DiscordResourceType.Incident, notificationFor.incidentId],
    [DiscordResourceType.Alert, notificationFor.alertId],
    [
      DiscordResourceType.ScheduledMaintenance,
      notificationFor.scheduledMaintenanceId,
    ],
    [DiscordResourceType.OnCallDutyPolicy, notificationFor.onCallDutyPolicyId],
    [DiscordResourceType.Monitor, notificationFor.monitorId],
    [DiscordResourceType.IncidentEpisode, notificationFor.incidentEpisodeId],
    [DiscordResourceType.AlertEpisode, notificationFor.alertEpisodeId],
  ];
  for (const [resourceType, resourceId] of pairs) {
    if (resourceId) {
      return { resourceType, resourceId };
    }
  }
  return null;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * ---- Public entry points ----
   */

  /*
   * Called from createChannelsBasedOnRules for Discord. Returns the channel
   * to attach to the resource, or null when this delivery must not attach
   * anything (ambiguous, failed, orphaned, stale, or resource already
   * final). Never throws for a remote outcome; the row and the notification
   * log carry it.
   */
  @CaptureSpan()
  public async ensureThread(data: {
    projectId: ObjectID;
    authToken: string;
    resource: ResourceRef;
    notificationRuleId: ObjectID;
    channelName: string;
    isPrivate: boolean;
  }): Promise<WorkspaceChannel | null> {
    const installation: Installation = await this.installation(
      data.projectId,
      data.authToken,
    );
    const existing: Model | null = await this.claim({
      ...data,
      installation,
    });
    if (existing) {
      return await this.settle(existing, installation);
    }
    const row: Model = (await this.row({
      projectId: data.projectId,
      resource: data.resource,
      notificationRuleId: data.notificationRuleId,
    }))!;
    return await this.createRemote(row, installation);
  }

  /*
   * Verified active threads for a resource, used by the shared channel
   * lookup, plus the ids it must not post to. The resource's
   * postUpdatesToWorkspaceChannels column caches thread ids,
   * and a cached id outlives the ownership decision (F22). `fenced` is every
   * thread id this service manages for the resource that did not verify as
   * usable just now: stale, orphaned, archived, or active but unverifiable.
   * The rule path must drop those from the cache before posting. Channels
   * that are not ownership rows (destinations a rule names on purpose) are
   * never in this set.
   */
  @CaptureSpan()
  public async channelsForResource(data: {
    projectId: ObjectID;
    resource: ResourceRef;
  }): Promise<{ active: Array<WorkspaceChannel>; fenced: Array<string> }> {
    const rows: Array<Model> = await this.rowsForResource(data);
    const active: Array<WorkspaceChannel> = [];
    const fenced: Array<string> = [];
    if (rows.length === 0) {
      return { active, fenced };
    }
    const installation: Installation | null = await this.liveInstallation(
      data.projectId,
    );
    for (const row of rows) {
      // A retired thread has no owner any more; it is fenced for good (F29).
      for (const retired of row.retiredThreadIds || []) {
        if (!fenced.includes(retired)) {
          fenced.push(retired);
        }
      }
      if (!row.threadId) {
        continue;
      }
      const verified: JSONObject | null =
        row.state === DiscordResourceThreadState.Active
          ? await this.verify(row, installation)
          : null;
      if (verified) {
        active.push(this.channel(row, verified));
      } else if (!fenced.includes(row.threadId)) {
        fenced.push(row.threadId);
      }
    }
    return { active, fenced };
  }

  /*
   * Invitation boundary (F25). The membership path invites by channel name
   * from the resource cache and never verifies, so this is the one place a
   * thread this service manages is checked before a member is added: the
   * row must be active under the live installation. A thread with no row
   * (a destination a rule names on purpose) is not restricted here.
   */
  @CaptureSpan()
  public async assertInvitable(data: {
    projectId: ObjectID;
    threadId: string;
  }): Promise<void> {
    const row: Model | null = await this.findOneBy({
      query: { projectId: data.projectId, threadId: data.threadId },
      select: {
        _id: true,
        state: true,
        installationId: true,
        installationVersion: true,
      },
      props: { isRoot: true },
    });
    if (!row) {
      /*
       * No row owns it now, but a row may have owned it once (F29): an
       * invite that read the cache before a recreate or adoption still
       * holds the replaced thread id. That thread is retired, not
       * unmanaged.
       */
      if (await this.isRetired(data.projectId, data.threadId)) {
        throw new BadDataException(
          "This thread was replaced on its OneUptime record and no longer takes members.",
        );
      }
      return;
    }
    const live: Installation | null = await this.liveInstallation(
      data.projectId,
    );
    if (
      row.state !== DiscordResourceThreadState.Active ||
      !live ||
      live.id.toString() !== row.installationId?.toString() ||
      live.version !== row.installationVersion
    ) {
      throw new BadDataException(
        "This thread is not an active OneUptime thread under the current Discord connection; reconcile it before adding members.",
      );
    }
  }

  // Every row for the resource: the fence is only as complete as this list.
  private async rowsForResource(data: {
    projectId: ObjectID;
    resource: ResourceRef;
  }): Promise<Array<Model>> {
    const rows: Array<Model> = [];
    const pageSize: number = 50;
    for (let skip: number = 0; ; skip += pageSize) {
      const page: Array<Model> = await this.findBy({
        query: {
          projectId: data.projectId,
          resourceType: data.resource.resourceType,
          resourceId: data.resource.resourceId,
        },
        select: this.columns(),
        limit: pageSize,
        skip,
        props: { isRoot: true },
      });
      rows.push(...page);
      if (page.length < pageSize) {
        return rows;
      }
    }
  }

  @CaptureSpan()
  public async markArchived(data: {
    projectId: ObjectID;
    threadIds: Array<string>;
  }): Promise<void> {
    for (const threadId of new Set(data.threadIds)) {
      await this.getRepository().manager.query(
        `UPDATE "DiscordResourceThread"
           SET "state" = $1, "lastVerifiedAt" = now(), "updatedAt" = now(),
               "version" = "version" + 1
         WHERE "projectId" = $2 AND "threadId" = $3 AND "state" = $4
           AND "deletedAt" IS NULL`,
        [
          DiscordResourceThreadState.Archived,
          data.projectId.toString(),
          threadId,
          DiscordResourceThreadState.Active,
        ],
      );
    }
  }

  /*
   * A resource left its final state after its thread was archived. Discord
   * only: Slack and Teams keep their existing behavior. One PATCH per row;
   * a row that is not archived is left alone.
   */
  @CaptureSpan()
  public async reopenArchived(data: {
    projectId: ObjectID;
    resource: ResourceRef;
  }): Promise<void> {
    const installation: Installation | null = await this.liveInstallation(
      data.projectId,
    );
    if (!installation) {
      return;
    }
    const rows: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        resourceType: data.resource.resourceType,
        resourceId: data.resource.resourceId,
        state: DiscordResourceThreadState.Archived,
      },
      select: this.columns(),
      limit: 50,
      skip: 0,
      props: { isRoot: true },
    });
    for (const row of rows) {
      if (!(await this.verify(row, installation))) {
        continue;
      }
      // Unarchive is idempotent, so no lock is held across the request.
      await this.patchArchive(installation, row.threadId!, false);
      const outcome: FenceOutcome = await this.fence({
        row,
        installation,
        expectedState: DiscordResourceThreadState.Archived,
        nextState: DiscordResourceThreadState.Active,
      });
      if (outcome === "final") {
        /*
         * The resource reached its final state while the reopen was in
         * flight (F20). The thread is unarchived remotely; put it back.
         */
        await this.patchArchive(installation, row.threadId!, true);
      }
    }
  }

  /*
   * Explicit reconciliation by a project admin. Without a body the audit log
   * is consulted; with threadId the named thread is adopted after
   * validation; with recreate a fresh create runs under the same row.
   */
  @CaptureSpan()
  public async reconcile(data: {
    projectId: ObjectID;
    rowId: ObjectID;
    threadId?: string | undefined;
    recreate?: boolean | undefined;
  }): Promise<Model> {
    const row: Model | null = await this.row({ id: data.rowId });
    if (!row || row.projectId?.toString() !== data.projectId.toString()) {
      throw new BadDataException("Thread record not found.");
    }
    const installation: Installation | null = await this.liveInstallation(
      data.projectId,
    );
    if (!installation) {
      throw new BadDataException("Discord is not connected.");
    }
    if (data.recreate) {
      if (
        ![
          DiscordResourceThreadState.Failed,
          DiscordResourceThreadState.Stale,
          DiscordResourceThreadState.Orphaned,
        ].includes(row.state!)
      ) {
        throw new ThreadReconcileConflict(
          "Only a failed, stale or orphaned record can be recreated.",
        );
      }
      if (await this.isFinal(row)) {
        throw new ThreadReconcileConflict(
          "The resource is already in its final state; no thread is created.",
        );
      }
      /*
       * The old thread leaves the resource cache before the row forgets it
       * (F26); otherwise nothing fences it once threadId is cleared.
       */
      if (row.threadId) {
        await this.detachFromResource(row, row.threadId);
      }
      /*
       * Re-claim: one conditional UPDATE, so exactly one caller flips the
       * row back to creating (F31), and the replaced thread joins the row's
       * history in the same statement (F29).
       */
      const claimed: boolean = await this.compareAndSet({
        id: row.id!,
        expectedState: row.state!,
        expectedOperationKey: row.operationKey!,
        patch: {
          state: DiscordResourceThreadState.Creating,
          threadId: null as unknown as string,
          operationKey: ObjectID.generate().toString(),
          claimedAt: new Date(),
          remoteCompletedAt: null as unknown as Date,
          failureReason: null as unknown as string,
          installationId: installation.id,
          installationVersion: installation.version,
          guildId: installation.guildId,
          parentChannelId: installation.parentId,
          retiredThreadIds: this.retire(row, row.threadId || null),
        },
      });
      if (!claimed) {
        const settled: Model | null = await this.waitForClaim(row.id!);
        return settled || row;
      }
      const claimedRow: Model = (await this.row({ id: row.id! }))!;
      const created: WorkspaceChannel | null = await this.createRemote(
        claimedRow,
        installation,
      );
      if (created) {
        // Outside the rule path nobody else fills the readers' cache (F26).
        await this.attachToResource(claimedRow, created);
      }
      return (await this.row({ id: row.id! }))!;
    }
    if (data.threadId) {
      this.assertAdoptable(row);
      const threadId: string = DiscordClient.snowflake(data.threadId);
      const remote: JSONObject = await this.remoteThread(
        installation,
        threadId,
      );
      await this.assertAdoptableThread(row, installation, remote);
      if (await this.ownedElsewhere(row, threadId)) {
        throw new BadDataException(
          "That thread already belongs to another record in this project.",
        );
      }
      return await this.adopt(row, installation, remote);
    }
    if (row.state === DiscordResourceThreadState.Orphaned && row.threadId) {
      return await this.archiveOrphan(row, installation);
    }
    if (row.state !== DiscordResourceThreadState.Ambiguous) {
      throw new ThreadReconcileConflict(
        "Only an ambiguous record can be reconciled from the audit log.",
      );
    }
    const found: JSONObject | null = await this.fromAuditLog(row, installation);
    if (!found) {
      throw new ThreadReconcileConflict(
        "No audit log entry matches this operation. Grant VIEW_AUDIT_LOG to the bot or name the thread explicitly.",
      );
    }
    // The audit log names the thread; it earns no fewer checks than an admin.
    await this.assertAdoptableThread(row, installation, found);
    return await this.adopt(row, installation, found);
  }

  /*
   * ---- Claim and create ----
   */

  // Returns the existing row when another delivery already holds the claim.
  private async claim(data: {
    projectId: ObjectID;
    resource: ResourceRef;
    notificationRuleId: ObjectID;
    channelName: string;
    isPrivate: boolean;
    installation: Installation;
  }): Promise<Model | null> {
    try {
      await this.executeTransaction(
        async (manager: EntityManager): Promise<void> => {
          /*
           * Raw insert: the unique index is the claim, and a rejected insert
           * must surface as the driver's unique violation, not a hook error.
           */
          await manager.query(
            `INSERT INTO "DiscordResourceThread"
               ("projectId", "resourceType", "resourceId", "notificationRuleId",
                "installationId", "installationVersion", "guildId", "parentChannelId",
                "threadName", "isPrivate", "state", "operationKey", "claimedAt", "version")
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now(), 1)`,
            [
              data.projectId.toString(),
              data.resource.resourceType,
              data.resource.resourceId.toString(),
              data.notificationRuleId.toString(),
              data.installation.id.toString(),
              data.installation.version,
              data.installation.guildId,
              data.installation.parentId,
              data.channelName,
              data.isPrivate,
              DiscordResourceThreadState.Creating,
              ObjectID.generate().toString(),
            ],
          );
        },
      );
      return null;
    } catch (error) {
      if (!PostgresErrorTranslator.isUniqueViolation(error)) {
        throw error;
      }
      return await this.row({
        projectId: data.projectId,
        resource: data.resource,
        notificationRuleId: data.notificationRuleId,
      });
    }
  }

  // Another delivery owns the row. Wait for it, then hand back what it got.
  private async settle(
    row: Model,
    installation: Installation,
  ): Promise<WorkspaceChannel | null> {
    let current: Model | null = row;
    if (current.state === DiscordResourceThreadState.Creating) {
      const age: number = Date.now() - (current.claimedAt?.getTime() || 0);
      if (age > CLAIM_LEASE_MS) {
        /*
         * The claimant died before it could record an outcome. The remote
         * side may still have created the thread, so this is ambiguous.
         */
        await this.set(current, {
          state: DiscordResourceThreadState.Ambiguous,
          failureReason: "claim lease expired without a recorded outcome",
        });
        await this.logSkip(current, "claim lease expired");
        return null;
      }
      current = await this.waitForClaim(current.id!);
    }
    if (!current) {
      return null;
    }
    if (current.state === DiscordResourceThreadState.Active) {
      const verified: JSONObject | null = await this.verify(
        current,
        installation,
      );
      return verified ? this.channel(current, verified) : null;
    }
    return null;
  }

  private async waitForClaim(id: ObjectID): Promise<Model | null> {
    const deadline: number = Date.now() + CLAIM_WAIT_MS;
    while (Date.now() < deadline) {
      const current: Model | null = await this.row({ id });
      if (!current || current.state !== DiscordResourceThreadState.Creating) {
        return current;
      }
      await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, CLAIM_POLL_MS);
      });
    }
    return await this.row({ id });
  }

  private async createRemote(
    row: Model,
    installation: Installation,
  ): Promise<WorkspaceChannel | null> {
    /*
     * Pre-check: a delayed delivery for a resource that already finished
     * must not open a thread at all.
     */
    if (await this.isFinal(row)) {
      await this.set(row, {
        state: DiscordResourceThreadState.Failed,
        failureReason: "resource already in its final state",
      });
      await this.logSkip(row, "resource already in its final state");
      return null;
    }
    let remote: JSONObject;
    try {
      remote = (await DiscordClient.request({
        authToken: installation.authToken,
        method: HTTPMethod.POST,
        path: "/channels/" + installation.parentId + "/threads",
        body: {
          name: row.threadName,
          type: row.isPrivate ? 12 : 11,
          auto_archive_duration: 1440,
          ...(row.isPrivate ? { invitable: false } : {}),
        },
        auditLogReason: "oneuptime:" + row.operationKey,
      })) as JSONObject;
    } catch (error) {
      /*
       * Only a 4xx is a definite rejection. A 5xx is a processing error with
       * no no-side-effect guarantee (F28): the thread may exist, so the row
       * keeps its operation key and waits for reconciliation like a lost
       * answer does.
       */
      const uncertain: boolean =
        error instanceof DiscordAmbiguousOutcomeError ||
        (error instanceof DiscordAPIError && error.statusCode >= 500);
      if (uncertain) {
        await this.set(row, {
          state: DiscordResourceThreadState.Ambiguous,
          failureReason:
            error instanceof DiscordAPIError
              ? `Discord answered HTTP ${error.statusCode}; the create may have completed`
              : (error as Error).message,
        });
        await this.logSkip(row, "create outcome unknown; needs reconciliation");
        return null;
      }
      const reason: string =
        error instanceof DiscordAPIError
          ? `Discord refused the create (HTTP ${error.statusCode})`
          : (error as Error).message;
      await this.set(row, {
        state: DiscordResourceThreadState.Failed,
        failureReason: reason,
      });
      await this.logSkip(row, reason);
      return null;
    }
    return await this.persist(row, installation, remote);
  }

  /*
   * The remote create answered. Under the binding lock, re-read the row,
   * the installation generation and the resource state before attaching
   * anything. All writes go through the lock's manager.
   */
  private async persist(
    row: Model,
    installation: Installation,
    remote: JSONObject,
  ): Promise<WorkspaceChannel | null> {
    const threadId: string = DiscordClient.snowflake(String(remote["id"]));
    const patch: Partial<Model> = {
      threadId,
      remoteCompletedAt: new Date(),
      lastVerifiedAt: new Date(),
    };
    let decided: DiscordResourceThreadState | null = null;
    let reason: string | null = null;
    await this.bindingLocked(
      row.projectId!,
      async (manager: EntityManager): Promise<void> => {
        const fresh: Model | null = await this.readRow(manager, row.id!);
        if (
          !fresh ||
          fresh.state !== DiscordResourceThreadState.Creating ||
          fresh.operationKey !== row.operationKey
        ) {
          // Someone else moved the row (a reconcile). Not ours to overwrite.
          reason = "row changed while the create was in flight";
          return;
        }
        const live: Installation | null = await this.liveInstallation(
          row.projectId!,
          manager,
        );
        if (
          !live ||
          live.id.toString() !== installation.id.toString() ||
          live.version !== installation.version
        ) {
          decided = DiscordResourceThreadState.Stale;
          reason = "installation changed while the create was in flight";
        } else if (await this.isFinal(row)) {
          decided = DiscordResourceThreadState.Orphaned;
          reason = "resource finished while the create was in flight";
        } else {
          decided = DiscordResourceThreadState.Active;
        }
        await this.writeRow(manager, row.id!, {
          ...patch,
          state: decided,
          failureReason: reason as unknown as string,
        });
      },
    );
    if (decided !== DiscordResourceThreadState.Active) {
      await this.logSkip(row, reason || "create result not attached");
      return null;
    }
    return this.channel(row, remote);
  }

  /*
   * ---- Verification and reconciliation ----
   */

  /*
   * GET the thread and confirm it still belongs to the live installation.
   * Moves the row on the evidence: 404 → orphaned, wrong guild/parent/type/
   * owner or a moved generation → stale, archived by a human → archived.
   * A moved generation is never re-stamped here; only an explicit
   * reconcile does that (F16). Returns the remote object when the row may
   * be used.
   *
   * The installation the caller passed in is only a pre-check. The decision
   * is taken under the binding lock after the GET, against the row and the
   * installation as they are then (F21): a disconnect that lands during the
   * GET must not hand back a usable channel. Every write is conditional on
   * the state and operation key the row was read with, so a concurrent
   * fence or reconcile is never clobbered.
   */
  private async verify(
    row: Model,
    installation: Installation | null,
  ): Promise<JSONObject | null> {
    if (!installation || !row.threadId) {
      return null;
    }
    const demote: (
      state: DiscordResourceThreadState,
      reason: string,
    ) => Promise<void> = async (
      state: DiscordResourceThreadState,
      reason: string,
    ): Promise<void> => {
      await this.compareAndSet({
        id: row.id!,
        expectedState: row.state!,
        expectedOperationKey: row.operationKey!,
        patch: { state, failureReason: reason, lastVerifiedAt: new Date() },
      });
    };
    if (
      row.installationId?.toString() !== installation.id.toString() ||
      row.installationVersion !== installation.version
    ) {
      await demote(
        DiscordResourceThreadState.Stale,
        "installation changed since this thread was claimed; reconcile to reuse it",
      );
      return null;
    }
    let remote: JSONObject;
    try {
      remote = await this.remoteThread(installation, row.threadId);
    } catch (error) {
      if (error instanceof DiscordAPIError && error.statusCode === 404) {
        await demote(
          DiscordResourceThreadState.Orphaned,
          "thread no longer exists in Discord",
        );
        return null;
      }
      // Transient failure: keep the row as it is and let the caller skip.
      logger.error(`Discord thread verification failed: ${error}`);
      return null;
    }
    return await this.bindingLocked(
      row.projectId!,
      async (manager: EntityManager): Promise<JSONObject | null> => {
        const fresh: Model | null = await this.readRow(manager, row.id!);
        if (
          !fresh ||
          fresh.state !== row.state ||
          fresh.operationKey !== row.operationKey
        ) {
          // A fence or reconcile moved the row meanwhile; not ours to judge.
          return null;
        }
        const settle: (
          state: DiscordResourceThreadState,
          reason: string | null,
        ) => Promise<void> = async (
          state: DiscordResourceThreadState,
          reason: string | null,
        ): Promise<void> => {
          await this.writeRow(manager, fresh.id!, {
            state,
            failureReason: reason as unknown as string,
            lastVerifiedAt: new Date(),
          });
        };
        const live: Installation | null = await this.liveInstallation(
          row.projectId!,
          manager,
        );
        if (
          !live ||
          live.id.toString() !== fresh.installationId?.toString() ||
          live.version !== fresh.installationVersion
        ) {
          await settle(
            DiscordResourceThreadState.Stale,
            "installation changed since this thread was claimed; reconcile to reuse it",
          );
          return null;
        }
        if (!this.belongs(remote, live)) {
          await settle(
            DiscordResourceThreadState.Stale,
            "thread is outside the current guild or parent, or not owned by the bot",
          );
          return null;
        }
        const metadata: JSONObject = (remote["thread_metadata"] ||
          {}) as JSONObject;
        if (
          fresh.state === DiscordResourceThreadState.Active &&
          metadata["archived"] === true
        ) {
          await settle(
            DiscordResourceThreadState.Archived,
            "archived outside OneUptime",
          );
          return null;
        }
        await this.writeRow(manager, fresh.id!, { lastVerifiedAt: new Date() });
        return remote;
      },
    );
  }

  private async fromAuditLog(
    row: Model,
    installation: Installation,
  ): Promise<JSONObject | null> {
    let entries: JSONArray;
    try {
      const log: JSONObject = (await DiscordClient.request({
        authToken: installation.authToken,
        method: HTTPMethod.GET,
        path:
          "/guilds/" +
          installation.guildId +
          "/audit-logs?action_type=" +
          THREAD_CREATE_AUDIT_ACTION +
          "&limit=100",
      })) as JSONObject;
      entries = (log["audit_log_entries"] || []) as JSONArray;
    } catch (error) {
      if (error instanceof DiscordAPIError && error.statusCode === 403) {
        return null;
      }
      throw error;
    }
    const matches: Array<JSONObject> = (entries as Array<JSONObject>).filter(
      (entry: JSONObject): boolean => {
        return entry["reason"] === "oneuptime:" + row.operationKey;
      },
    );
    if (matches.length !== 1 || !matches[0]!["target_id"]) {
      return null;
    }
    const remote: JSONObject = await this.remoteThread(
      installation,
      DiscordClient.snowflake(String(matches[0]!["target_id"])),
    );
    return remote;
  }

  private async adopt(
    row: Model,
    installation: Installation,
    remote: JSONObject,
  ): Promise<Model> {
    const threadId: string = DiscordClient.snowflake(String(remote["id"]));
    let decided: DiscordResourceThreadState | null = null;
    await this.bindingLocked(
      row.projectId!,
      async (manager: EntityManager): Promise<void> => {
        const live: Installation | null = await this.liveInstallation(
          row.projectId!,
          manager,
        );
        if (
          !live ||
          live.id.toString() !== installation.id.toString() ||
          live.version !== installation.version
        ) {
          throw new ThreadReconcileConflict(
            "The Discord connection changed during reconciliation. Start again.",
          );
        }
        const fresh: Model | null = await this.readRow(manager, row.id!);
        if (
          !fresh ||
          fresh.state !== row.state ||
          fresh.operationKey !== row.operationKey
        ) {
          /*
           * The row is not what the caller validated against: a recreate
           * claimed it, a fence moved it, or another reconcile won (F24).
           * "Not active" is not enough; a fresh creating claim must survive.
           */
          throw new ThreadReconcileConflict(
            "The record changed during reconciliation. Read it again.",
          );
        }
        if (await this.ownedElsewhere(fresh, threadId, manager)) {
          throw new BadDataException(
            "That thread already belongs to another record in this project.",
          );
        }
        const replaced: string | null =
          fresh.threadId && fresh.threadId !== threadId ? fresh.threadId : null;
        if (replaced) {
          /*
           * Same rule as recreate: the replaced thread leaves the cache
           * first, on this transaction's manager so a rollback below takes
           * the prune with it.
           */
          await this.detachFromResource(fresh, replaced, manager);
        }
        const isFinal: boolean = await this.isFinal(fresh);
        decided = isFinal
          ? DiscordResourceThreadState.Orphaned
          : DiscordResourceThreadState.Active;
        await this.writeRow(manager, fresh.id!, {
          threadId,
          // The adopted thread is owned again; the replaced one is history.
          retiredThreadIds: this.retire(fresh, replaced).filter(
            (id: string): boolean => {
              return id !== threadId;
            },
          ),
          threadName: String(remote["name"] || fresh.threadName),
          installationId: installation.id,
          installationVersion: installation.version,
          guildId: installation.guildId,
          parentChannelId: installation.parentId,
          remoteCompletedAt: fresh.remoteCompletedAt || new Date(),
          lastVerifiedAt: new Date(),
          state: decided,
          failureReason: (isFinal
            ? "resource finished before the thread was adopted"
            : null) as unknown as string,
        });
      },
    );
    const adopted: Model = (await this.row({ id: row.id! }))!;
    if (decided === DiscordResourceThreadState.Orphaned) {
      return await this.archiveOrphan(adopted, installation);
    }
    if (decided === DiscordResourceThreadState.Active) {
      await this.attachToResource(adopted, this.channel(adopted, remote));
    }
    return adopted;
  }

  // An orphan is a real thread nobody may post to. Archive it, keep history.
  private async archiveOrphan(
    row: Model,
    installation: Installation,
  ): Promise<Model> {
    await this.patchArchive(installation, row.threadId!, true);
    await this.fence({
      row,
      installation,
      expectedState: DiscordResourceThreadState.Orphaned,
      nextState: DiscordResourceThreadState.Archived,
      ignoreFinal: true,
    });
    return (await this.row({ id: row.id! }))!;
  }

  /*
   * Adoption happens outside the rule path, so the shared readers' cache on
   * the resource has to be filled here. Only the incident, alert and
   * scheduled maintenance columns are written; the others read the
   * ownership row through channelsForResource.
   */
  private async attachToResource(
    row: Model,
    channel: WorkspaceChannel,
  ): Promise<void> {
    const entry: NotificationRuleWorkspaceChannel = {
      ...channel,
      notificationRuleId: row.notificationRuleId?.toString() || "",
    };
    const id: ObjectID = row.resourceId!;
    const props: { isRoot: boolean } = { isRoot: true };
    const select: { postUpdatesToWorkspaceChannels: true } = {
      postUpdatesToWorkspaceChannels: true,
    };
    let current: Array<NotificationRuleWorkspaceChannel> = [];
    switch (row.resourceType) {
      case DiscordResourceType.Incident:
        current =
          (await IncidentService.findOneById({ id, select, props }))
            ?.postUpdatesToWorkspaceChannels || [];
        break;
      case DiscordResourceType.Alert:
        current =
          (await AlertService.findOneById({ id, select, props }))
            ?.postUpdatesToWorkspaceChannels || [];
        break;
      case DiscordResourceType.ScheduledMaintenance:
        current =
          (await ScheduledMaintenanceService.findOneById({ id, select, props }))
            ?.postUpdatesToWorkspaceChannels || [];
        break;
      default:
        return;
    }
    if (
      current.some((item: NotificationRuleWorkspaceChannel): boolean => {
        return item.id === channel.id;
      })
    ) {
      return;
    }
    const data: {
      postUpdatesToWorkspaceChannels: Array<NotificationRuleWorkspaceChannel>;
    } = {
      postUpdatesToWorkspaceChannels: [...current, entry],
    };
    switch (row.resourceType) {
      case DiscordResourceType.Incident:
        await IncidentService.updateOneById({ id, data, props });
        break;
      case DiscordResourceType.Alert:
        await AlertService.updateOneById({ id, data, props });
        break;
      case DiscordResourceType.ScheduledMaintenance:
        await ScheduledMaintenanceService.updateOneById({ id, data, props });
        break;
    }
  }

  /*
   * The inverse of attachToResource, for a thread this row is about to stop
   * naming. Only the cache entry for that exact thread id is removed;
   * destinations a rule names on purpose have other ids and stay.
   */
  private async detachFromResource(
    row: Model,
    threadId: string,
    manager?: EntityManager,
  ): Promise<void> {
    if (manager) {
      await this.detachOnManager(manager, row, threadId);
      return;
    }
    const id: ObjectID = row.resourceId!;
    const props: { isRoot: boolean } = { isRoot: true };
    const select: { postUpdatesToWorkspaceChannels: true } = {
      postUpdatesToWorkspaceChannels: true,
    };
    let current: Array<NotificationRuleWorkspaceChannel> = [];
    switch (row.resourceType) {
      case DiscordResourceType.Incident:
        current =
          (await IncidentService.findOneById({ id, select, props }))
            ?.postUpdatesToWorkspaceChannels || [];
        break;
      case DiscordResourceType.Alert:
        current =
          (await AlertService.findOneById({ id, select, props }))
            ?.postUpdatesToWorkspaceChannels || [];
        break;
      case DiscordResourceType.ScheduledMaintenance:
        current =
          (await ScheduledMaintenanceService.findOneById({ id, select, props }))
            ?.postUpdatesToWorkspaceChannels || [];
        break;
      default:
        return;
    }
    const kept: Array<NotificationRuleWorkspaceChannel> = current.filter(
      (item: NotificationRuleWorkspaceChannel): boolean => {
        return !(
          item.workspaceType === WorkspaceType.Discord && item.id === threadId
        );
      },
    );
    if (kept.length === current.length) {
      return;
    }
    const data: {
      postUpdatesToWorkspaceChannels: Array<NotificationRuleWorkspaceChannel>;
    } = { postUpdatesToWorkspaceChannels: kept };
    switch (row.resourceType) {
      case DiscordResourceType.Incident:
        await IncidentService.updateOneById({ id, data, props });
        break;
      case DiscordResourceType.Alert:
        await AlertService.updateOneById({ id, data, props });
        break;
      case DiscordResourceType.ScheduledMaintenance:
        await ScheduledMaintenanceService.updateOneById({ id, data, props });
        break;
    }
  }

  /*
   * Cache prune inside a caller's transaction. A service update would commit
   * on its own and survive the ownership write rolling back; the raw UPDATE
   * rides on the manager instead. Only the exact thread id is removed.
   */
  private async detachOnManager(
    manager: EntityManager,
    row: Model,
    threadId: string,
  ): Promise<void> {
    const tables: Partial<Record<DiscordResourceType, string>> = {
      [DiscordResourceType.Incident]: "Incident",
      [DiscordResourceType.Alert]: "Alert",
      [DiscordResourceType.ScheduledMaintenance]: "ScheduledMaintenance",
    };
    const table: string | undefined = tables[row.resourceType!];
    if (!table) {
      return;
    }
    const found: Array<{
      postUpdatesToWorkspaceChannels: Array<NotificationRuleWorkspaceChannel> | null;
    }> = await manager.query(
      `SELECT "postUpdatesToWorkspaceChannels" FROM "${table}" WHERE "_id" = $1 FOR UPDATE`,
      [row.resourceId!.toString()],
    );
    const current: Array<NotificationRuleWorkspaceChannel> =
      found[0]?.postUpdatesToWorkspaceChannels || [];
    const kept: Array<NotificationRuleWorkspaceChannel> = current.filter(
      (item: NotificationRuleWorkspaceChannel): boolean => {
        return !(
          item.workspaceType === WorkspaceType.Discord && item.id === threadId
        );
      },
    );
    if (found.length === 0 || kept.length === current.length) {
      return;
    }
    await manager.query(
      `UPDATE "${table}" SET "postUpdatesToWorkspaceChannels" = $1, "updatedAt" = now()
       WHERE "_id" = $2`,
      [JSON.stringify(kept), row.resourceId!.toString()],
    );
  }

  /*
   * ---- Helpers ----
   */

  // The row's history plus the thread it is about to stop naming (F29).
  private retire(row: Model, threadId: string | null): Array<string> {
    const history: Array<string> = [...(row.retiredThreadIds || [])];
    if (threadId && !history.includes(threadId)) {
      history.push(threadId);
    }
    return history;
  }

  private async isRetired(
    projectId: ObjectID,
    threadId: string,
  ): Promise<boolean> {
    const found: Array<{ found: number }> =
      await this.getRepository().manager.query(
        `SELECT 1 AS found FROM "DiscordResourceThread"
         WHERE "projectId" = $1 AND "retiredThreadIds" @> $2::jsonb
           AND "deletedAt" IS NULL LIMIT 1`,
        [projectId.toString(), JSON.stringify([threadId])],
      );
    return found.length > 0;
  }

  /*
   * A state transition outside the binding lock. DatabaseService.updateBy
   * finds the matching rows and then updates them by id, so a state in its
   * query is checked before the write, not by it: three concurrent
   * recreates all saw "failed" and all claimed (F31). Here the expected
   * state and operation key are in the UPDATE's own WHERE, and the affected
   * count says whether this caller won.
   */
  private async compareAndSet(data: {
    id: ObjectID;
    expectedState: DiscordResourceThreadState;
    expectedOperationKey?: string;
    patch: Partial<Model>;
  }): Promise<boolean> {
    const params: Array<unknown> = [];
    const sets: Array<string> = this.assignments(data.patch, params);
    if (sets.length === 0) {
      return false;
    }
    params.push(data.id.toString(), data.expectedState);
    let where: string = `"_id" = $${params.length - 1} AND "state" = $${params.length}`;
    if (data.expectedOperationKey) {
      params.push(data.expectedOperationKey);
      where += ` AND "operationKey" = $${params.length}`;
    }
    const result: unknown = await this.getRepository().manager.query(
      `UPDATE "DiscordResourceThread" SET ${sets.join(", ")}, "updatedAt" = now(),
       "version" = "version" + 1 WHERE ${where} AND "deletedAt" IS NULL
       RETURNING "_id"`,
      params,
    );
    // TypeORM's Postgres driver answers an UPDATE with [rows, affected].
    const rows: Array<unknown> =
      Array.isArray(result) && Array.isArray(result[0])
        ? (result[0] as Array<unknown>)
        : (result as Array<unknown>) ?? [];
    return rows.length > 0;
  }

  // Whitelisted SET clauses; pushes the bound values onto params.
  private assignments(
    patch: Partial<Model>,
    params: Array<unknown>,
  ): Array<string> {
    const columns: Array<keyof Model> = [
      "state",
      "threadId",
      "threadName",
      "installationId",
      "installationVersion",
      "guildId",
      "parentChannelId",
      "operationKey",
      "claimedAt",
      "remoteCompletedAt",
      "lastVerifiedAt",
      "failureReason",
      "retiredThreadIds",
    ];
    const sets: Array<string> = [];
    for (const column of columns) {
      if (!(column in patch)) {
        continue;
      }
      const value: unknown = (patch as Record<string, unknown>)[column];
      params.push(
        value instanceof ObjectID
          ? value.toString()
          : Array.isArray(value)
            ? JSON.stringify(value)
            : value,
      );
      sets.push(`"${column}" = $${params.length}`);
    }
    return sets;
  }

  private async isFinal(row: Model): Promise<boolean> {
    try {
      switch (row.resourceType) {
        case DiscordResourceType.Incident:
          return await IncidentService.isIncidentResolved({
            incidentId: row.resourceId!,
          });
        case DiscordResourceType.Alert:
          return await AlertService.isAlertResolved({
            alertId: row.resourceId!,
          });
        case DiscordResourceType.ScheduledMaintenance:
          return await ScheduledMaintenanceService.isScheduledMaintenanceCompleted(
            { scheduledMaintenanceId: row.resourceId! },
          );
        default:
          return false;
      }
    } catch (error) {
      // A resource that cannot be read any more is final for our purposes.
      logger.error(`Discord thread final-state check failed: ${error}`);
      return true;
    }
  }

  private async installation(
    projectId: ObjectID,
    authToken: string,
  ): Promise<Installation> {
    const live: Installation | null = await this.liveInstallation(projectId);
    if (!live || live.authToken !== authToken) {
      throw new BadDataException(
        "Discord project installation is missing or credentials do not match.",
      );
    }
    if (!live.parentId) {
      throw new BadDataException(
        "Configure a Discord incident parent channel first.",
      );
    }
    return live;
  }

  private async liveInstallation(
    projectId: ObjectID,
    manager?: EntityManager,
  ): Promise<Installation | null> {
    const auth: WorkspaceProjectAuthToken | null = manager
      ? await manager.getRepository(WorkspaceProjectAuthToken).findOne({
          where: { projectId, workspaceType: WorkspaceType.Discord },
        })
      : await WorkspaceProjectAuthTokenService.findOneBy({
          query: { projectId, workspaceType: WorkspaceType.Discord },
          select: {
            _id: true,
            version: true,
            authToken: true,
            workspaceProjectId: true,
            miscData: true,
          },
          props: { isRoot: true },
        });
    if (
      !auth ||
      auth.deletedAt ||
      !auth.workspaceProjectId ||
      !auth.authToken
    ) {
      return null;
    }
    const misc: JSONObject = (auth.miscData || {}) as JSONObject;
    return {
      id: auth.id!,
      version: auth.version || 0,
      authToken: auth.authToken,
      botUserId: String(misc["botUserId"] || ""),
      guildId: DiscordClient.snowflake(auth.workspaceProjectId),
      parentId:
        typeof misc["incidentChannelId"] === "string"
          ? DiscordClient.snowflake(misc["incidentChannelId"])
          : "",
    };
  }

  private async remoteThread(
    installation: Installation,
    threadId: string,
  ): Promise<JSONObject> {
    return (await DiscordClient.request({
      authToken: installation.authToken,
      method: HTTPMethod.GET,
      path: "/channels/" + DiscordClient.snowflake(threadId),
    })) as JSONObject;
  }

  private belongs(remote: JSONObject, installation: Installation): boolean {
    return (
      remote["guild_id"] === installation.guildId &&
      remote["parent_id"] === installation.parentId &&
      [11, 12].includes(Number(remote["type"])) &&
      String(remote["owner_id"] || "") === installation.botUserId
    );
  }

  // Only a row that has no usable thread may adopt one.
  private assertAdoptable(row: Model): void {
    if (
      ![
        DiscordResourceThreadState.Failed,
        DiscordResourceThreadState.Stale,
        DiscordResourceThreadState.Orphaned,
        DiscordResourceThreadState.Ambiguous,
      ].includes(row.state!)
    ) {
      throw new ThreadReconcileConflict(
        "Only a failed, stale, orphaned or ambiguous record can adopt a thread.",
      );
    }
  }

  /*
   * One rule for every adoption, whether an admin named the thread or the
   * audit log did (F23): bot-created under the configured parent, the type
   * the resource's privacy requires, and not archived unless the resource
   * is already final (then it is adopted as orphaned and stays archived).
   */
  private async assertAdoptableThread(
    row: Model,
    installation: Installation,
    remote: JSONObject,
  ): Promise<void> {
    const metadata: JSONObject = (remote["thread_metadata"] ||
      {}) as JSONObject;
    if (
      !this.belongs(remote, installation) ||
      Number(remote["type"]) !== (row.isPrivate ? 12 : 11) ||
      (metadata["archived"] === true && !(await this.isFinal(row)))
    ) {
      throw new BadDataException(
        "That thread is not an unarchived bot-created thread of the expected type under the configured parent.",
      );
    }
  }

  private async patchArchive(
    installation: Installation,
    threadId: string,
    archived: boolean,
  ): Promise<void> {
    await DiscordClient.request({
      authToken: installation.authToken,
      method: HTTPMethod.PATCH,
      path: "/channels/" + DiscordClient.snowflake(threadId),
      body: { archived, locked: archived },
    });
  }

  /*
   * Final write after a remote call: under the binding lock, the row must
   * still be in the expected state, the installation generation must not
   * have moved, and (unless ignored) the resource must not have reached its
   * final state. Otherwise nothing is written and the outcome says why.
   */
  private async fence(data: {
    row: Model;
    installation: Installation;
    expectedState: DiscordResourceThreadState;
    nextState: DiscordResourceThreadState;
    ignoreFinal?: boolean;
  }): Promise<FenceOutcome> {
    return await this.bindingLocked(
      data.row.projectId!,
      async (manager: EntityManager): Promise<FenceOutcome> => {
        const live: Installation | null = await this.liveInstallation(
          data.row.projectId!,
          manager,
        );
        if (
          !live ||
          live.id.toString() !== data.installation.id.toString() ||
          live.version !== data.installation.version
        ) {
          return "generation-moved";
        }
        const fresh: Model | null = await this.readRow(manager, data.row.id!);
        if (!fresh || fresh.state !== data.expectedState) {
          return "state-changed";
        }
        if (!data.ignoreFinal && (await this.isFinal(fresh))) {
          return "final";
        }
        await this.writeRow(manager, fresh.id!, {
          state: data.nextState,
          lastVerifiedAt: new Date(),
        });
        return "written";
      },
    );
  }

  private async ownedElsewhere(
    row: Model,
    threadId: string,
    manager?: EntityManager,
  ): Promise<boolean> {
    const sql: string = `SELECT COUNT(*)::int AS count FROM "DiscordResourceThread"
      WHERE "projectId" = $1 AND "threadId" = $2 AND "_id" <> $3 AND "deletedAt" IS NULL`;
    const params: Array<string> = [
      row.projectId!.toString(),
      threadId,
      row.id!.toString(),
    ];
    const result: Array<{ count: number }> = manager
      ? await manager.query(sql, params)
      : await this.getRepository().manager.query(sql, params);
    return (result[0]?.count || 0) > 0;
  }

  private async readRow(
    manager: EntityManager,
    id: ObjectID,
  ): Promise<Model | null> {
    return await manager
      .getRepository(Model)
      .findOne({ where: { _id: id.toString() } });
  }

  // Whitelisted column update on the caller's manager (inside its lock).
  private async writeRow(
    manager: EntityManager,
    id: ObjectID,
    patch: Partial<Model>,
  ): Promise<void> {
    const params: Array<unknown> = [];
    const sets: Array<string> = this.assignments(patch, params);
    if (sets.length === 0) {
      return;
    }
    params.push(id.toString());
    await manager.query(
      `UPDATE "DiscordResourceThread" SET ${sets.join(", ")}, "updatedAt" = now(),
       "version" = "version" + 1 WHERE "_id" = $${params.length}`,
      params,
    );
  }

  private async bindingLocked<T>(
    projectId: ObjectID,
    action: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return await this.executeTransaction(
      async (manager: EntityManager): Promise<T> => {
        await manager.query("SET LOCAL lock_timeout = '5s'");
        /*
         * Same key as DiscordBindingService.locked, so install, setParent
         * and disconnect cannot interleave with a generation fence.
         */
        await manager.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          ["discord-binding:" + projectId.toString()],
        );
        return await action(manager);
      },
    );
  }

  private channel(row: Model, remote: JSONObject): WorkspaceChannel {
    return {
      id: DiscordClient.snowflake(String(remote["id"] || row.threadId)),
      name: String(remote["name"] || row.threadName || row.threadId),
      workspaceType: WorkspaceType.Discord,
      teamId: String(remote["guild_id"] || row.guildId || ""),
    };
  }

  private async row(data: {
    id?: ObjectID;
    projectId?: ObjectID;
    resource?: ResourceRef;
    notificationRuleId?: ObjectID;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: data.id
        ? { _id: data.id }
        : {
            projectId: data.projectId!,
            resourceType: data.resource!.resourceType,
            resourceId: data.resource!.resourceId,
            notificationRuleId: data.notificationRuleId!,
          },
      select: this.columns(),
      props: { isRoot: true },
    });
  }

  /*
   * Records this claimant's outcome: only while the row is still creating
   * under its operation key, so a fence's or a later claim's decision is
   * never clobbered.
   */
  private async set(row: Model, data: Partial<Model>): Promise<void> {
    await this.compareAndSet({
      id: row.id!,
      expectedState: DiscordResourceThreadState.Creating,
      expectedOperationKey: row.operationKey!,
      patch: data,
    });
  }

  private async logSkip(row: Model, reason: string): Promise<void> {
    try {
      await WorkspaceNotificationLogService.createWorkspaceLog(
        {
          projectId: row.projectId!,
          workspaceType: WorkspaceType.Discord,
          actionType: WorkspaceNotificationActionType.CreateChannel,
          status: WorkspaceNotificationStatus.Error,
          statusMessage: reason,
          message: `Discord thread "${row.threadName || ""}" was not attached: ${reason}`,
          channelName: row.threadName || "",
          ...(row.threadId ? { channelId: row.threadId } : {}),
          ...(row.resourceType === DiscordResourceType.Incident
            ? { incidentId: row.resourceId }
            : {}),
          ...(row.resourceType === DiscordResourceType.Alert
            ? { alertId: row.resourceId }
            : {}),
          ...(row.resourceType === DiscordResourceType.ScheduledMaintenance
            ? { scheduledMaintenanceId: row.resourceId }
            : {}),
          ...(row.resourceType === DiscordResourceType.OnCallDutyPolicy
            ? { onCallDutyPolicyId: row.resourceId }
            : {}),
          ...(row.resourceType === DiscordResourceType.IncidentEpisode
            ? { incidentEpisodeId: row.resourceId }
            : {}),
          ...(row.resourceType === DiscordResourceType.AlertEpisode
            ? { alertEpisodeId: row.resourceId }
            : {}),
        },
        { isRoot: true },
      );
    } catch (error) {
      logger.error(`Discord thread skip could not be logged: ${error}`);
    }
  }

  private columns(): Select<Model> {
    return {
      _id: true,
      projectId: true,
      resourceType: true,
      resourceId: true,
      notificationRuleId: true,
      installationId: true,
      installationVersion: true,
      guildId: true,
      parentChannelId: true,
      threadId: true,
      threadName: true,
      retiredThreadIds: true,
      isPrivate: true,
      state: true,
      operationKey: true,
      claimedAt: true,
      remoteCompletedAt: true,
      lastVerifiedAt: true,
      failureReason: true,
    };
  }
}

export default new Service();
