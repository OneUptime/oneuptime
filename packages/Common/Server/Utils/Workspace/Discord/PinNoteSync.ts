import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspaceNoteType } from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { DiscordBotToken } from "../../../EnvironmentConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import DatabaseService from "../../../Services/DatabaseService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import DiscordReactionObservationService, {
  type ObservationClaim,
} from "../../../Services/DiscordReactionObservationService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceReactionNote, {
  WorkspaceNoteResource,
  WorkspaceNoteSaveResult,
} from "../WorkspaceReactionNote";
import DiscordClient from "./DiscordClient";
import DiscordReactionNoteSync, {
  DiscordWatchedChannel,
} from "./ReactionNoteSync";

// One MESSAGE_PIN audit entry: who pinned, and what.
export interface DiscordAuditPin {
  entryId: string;
  actorUserId: string;
  channelId: string;
  messageId: string;
}

export enum DiscordPinOutcome {
  Saved = "Saved",
  AlreadySaved = "AlreadySaved",
  AlreadyHandled = "AlreadyHandled",
  NotLinked = "NotLinked",
  NotAuthorized = "NotAuthorized",
  NoText = "NoText",
  NotWatched = "NotWatched",
  AuditLogUnavailable = "AuditLogUnavailable",
  /*
   * The note save itself failed: no note exists, the observation stays
   * Pending, and the Redis claim is released so the stale-steal window —
   * not the multi-day Redis TTL — sets the retry cadence.
   */
  SaveFailed = "SaveFailed",
  /*
   * The durable dedupe layer could not be read or written. The pin is
   * released and retried on a later run (HOM-43 review 2).
   */
  RetryLater = "RetryLater",
}

/*
 * A native Discord pin does not say who pinned the message. The guild audit
 * log does: a MESSAGE_PIN entry (action type 74) carries the acting user and,
 * in options, the channel and message ids. This sync follows that log with a
 * persisted per-guild cursor and saves the pinned message as a private note
 * authored by the pin ACTOR — never by the message author, who may be someone
 * else entirely.
 *
 * Reading the audit log needs the VIEW_AUDIT_LOG permission, which the bot
 * may not have; a 403 there disables pin capture for that guild (a
 * rate-limited warning is logged) and reaction capture is unaffected. When
 * actor evidence is absent or incomplete, nothing is saved: pin capture
 * fails closed.
 */
export default class DiscordPinNoteSync {
  public static readonly MESSAGE_PIN_ACTION_TYPE: number = 74;

  // Discord caps audit log pages at 100 entries.
  public static readonly AUDIT_LOG_PAGE_LIMIT: number = 100;

  private static readonly CLAIM_NAMESPACE: string = "discord-pin-note";

  private static readonly CURSOR_NAMESPACE: string = "discord-pin-cursor";

  private static readonly CLAIM_TTL_IN_SECONDS: number = 30 * 24 * 60 * 60;

  // Rate limit for the no-audit-permission warning, per guild.
  private static readonly AUDIT_WARN_EVERY_SECONDS: number = 60 * 60;

  private static readonly AUDIT_WARN_NAMESPACE: string =
    "discord-pin-audit-warn";

  @CaptureSpan()
  public static async syncAllProjects(): Promise<void> {
    if (!DiscordBotToken) {
      return;
    }

    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.Discord,
        },
        select: {
          projectId: true,
          authToken: true,
          workspaceProjectId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const projectAuth of projectAuths) {
      if (!projectAuth.projectId || !projectAuth.authToken) {
        continue;
      }

      const guildId: string | undefined =
        projectAuth.workspaceProjectId?.toString();

      if (!guildId) {
        continue;
      }

      try {
        const watched: Array<DiscordWatchedChannel> =
          await DiscordReactionNoteSync.getWatchedChannels({
            projectId: projectAuth.projectId,
          });

        await this.syncGuild({
          projectId: projectAuth.projectId,
          authToken: projectAuth.authToken,
          guildId: guildId,
          watched: watched,
        });
      } catch (err) {
        logger.error("Error syncing Discord pins for project", {
          projectId: projectAuth.projectId.toString(),
        });
        logger.error(err, { projectId: projectAuth.projectId.toString() });
      }
    }
  }

  /*
   * Pins in one guild's watched channels. `watched` is the watched-channel
   * set from DiscordReactionNoteSync (resource per channel), so pin capture
   * only ever writes to resources the reaction sync already trusts.
   */
  @CaptureSpan()
  public static async syncGuild(data: {
    projectId: ObjectID;
    authToken: string;
    guildId: string;
    watched: Array<DiscordWatchedChannel>;
  }): Promise<Array<string>> {
    const watchedByChannel: Map<string, DiscordWatchedChannel> = new Map(
      data.watched.map((channel: DiscordWatchedChannel) => {
        return [channel.channelId, channel];
      }),
    );

    const cursor: string | null = await this.getCursor(data.guildId);

    let entries: Array<JSONObject> = [];

    try {
      const response: JSONObject = (await DiscordClient.getGuildAuditLog({
        authToken: data.authToken,
        guildId: data.guildId,
        actionType: this.MESSAGE_PIN_ACTION_TYPE,
        limit: this.AUDIT_LOG_PAGE_LIMIT,
      })) as JSONObject;

      entries = (response["audit_log_entries"] as Array<JSONObject>) || [];
    } catch (err) {
      const statusCode: number | undefined = (err as { statusCode?: number })
        .statusCode;

      if (statusCode === 403) {
        await this.warnAuditPermissionOnce(data.guildId);
        return [DiscordPinOutcome.AuditLogUnavailable];
      }

      throw err;
    }

    const pins: Array<DiscordAuditPin> = this.getPinsFromAuditLog({
      guildId: data.guildId,
      entries: entries,
    });

    const cursorValue: bigint | null = cursor ? BigInt(cursor) : null;

    let newestSeen: bigint | null = cursorValue;
    const outcomes: Array<string> = [];

    for (const pin of pins) {
      const entryId: bigint = BigInt(pin.entryId);

      if (cursorValue !== null && entryId <= cursorValue) {
        continue;
      }

      if (newestSeen === null || entryId > newestSeen) {
        newestSeen = entryId;
      }

      outcomes.push(
        await this.processPin({
          projectId: data.projectId,
          authToken: data.authToken,
          pin: pin,
          watchedByChannel: watchedByChannel,
        }),
      );
    }

    if (
      newestSeen !== null &&
      newestSeen.toString() !== cursor &&
      cursorValue !== null &&
      newestSeen > cursorValue
    ) {
      await this.setCursor(data.guildId, newestSeen.toString());
    } else if (newestSeen !== null && cursorValue === null) {
      await this.setCursor(data.guildId, newestSeen.toString());
    }

    return outcomes;
  }

  /*
   * MESSAGE_PIN entries with a complete actor, channel and message. Entries
   * that cannot identify their actor or target fail closed: they are
   * dropped, not guessed.
   */
  public static getPinsFromAuditLog(data: {
    guildId: string;
    entries: Array<JSONObject>;
  }): Array<DiscordAuditPin> {
    const pins: Array<DiscordAuditPin> = [];

    for (const entry of data.entries || []) {
      const actionType: number | undefined = entry["action_type"] as
        | number
        | undefined;

      if (actionType !== this.MESSAGE_PIN_ACTION_TYPE) {
        continue;
      }

      const entryId: string | undefined = entry["id"] as string | undefined;
      const actorUserId: string | null | undefined = entry["user_id"] as
        | string
        | null
        | undefined;
      const options: JSONObject | undefined = entry["options"] as
        | JSONObject
        | undefined;

      const channelId: string | null | undefined = options?.["channel_id"] as
        | string
        | null
        | undefined;
      const messageId: string | null | undefined = options?.["message_id"] as
        | string
        | null
        | undefined;

      if (!entryId || !actorUserId || !channelId || !messageId) {
        continue;
      }

      pins.push({
        entryId: entryId,
        actorUserId: actorUserId,
        channelId: channelId,
        messageId: messageId,
      });
    }

    return pins;
  }

  private static async processPin(data: {
    projectId: ObjectID;
    authToken: string;
    pin: DiscordAuditPin;
    watchedByChannel: Map<string, DiscordWatchedChannel>;
  }): Promise<string> {
    const watched: DiscordWatchedChannel | undefined =
      data.watchedByChannel.get(data.pin.channelId);

    if (!watched) {
      return DiscordPinOutcome.NotWatched;
    }

    const resource: WorkspaceNoteResource = watched.resource;

    const claimKey: string = [
      resource.resourceId.toString(),
      WorkspaceNoteType.Private,
      data.pin.channelId,
      data.pin.messageId,
      data.pin.actorUserId,
    ].join(":");

    let claimed: boolean = false;

    try {
      claimed = await GlobalCache.setStringIfNotExists(
        this.CLAIM_NAMESPACE,
        claimKey,
        "1",
        { expiresInSeconds: this.CLAIM_TTL_IN_SECONDS },
      );
    } catch (err) {
      logger.warn("Could not claim Discord pin; will retry.", {
        projectId: data.projectId.toString(),
        channelId: data.pin.channelId,
      });
      logger.warn(err);
      return DiscordPinOutcome.AlreadyHandled;
    }

    if (!claimed) {
      return DiscordPinOutcome.AlreadyHandled;
    }

    /*
     * Durable claim BEFORE any side effect (HOM-43 review 2) — same
     * semantics as the reaction sync. A failure here throws and releases
     * the Redis claim: the pin is retried on a later run. The claim's
     * observedAt token scopes every later state change to this claim.
     */
    let observedAt: Date | undefined;

    try {
      const durableClaim: ObservationClaim =
        await DiscordReactionObservationService.claim({
          projectId: data.projectId,
          claimKey: claimKey,
          source: "pin",
        });

      if (durableClaim.result === "AlreadyObserved") {
        return DiscordPinOutcome.AlreadyHandled;
      }

      observedAt = durableClaim.observedAt;
    } catch (err) {
      logger.warn("Could not claim Discord pin durably; will retry.", {
        projectId: data.projectId.toString(),
        channelId: data.pin.channelId,
      });
      logger.warn(err);
      await this.releaseClaim(claimKey);
      return DiscordPinOutcome.RetryLater;
    }

    if (!observedAt) {
      // Defensive: a won claim always carries a token.
      await this.releaseClaim(claimKey);
      return DiscordPinOutcome.RetryLater;
    }

    try {
      const outcome: string = await this.handleClaimedPin({
        projectId: data.projectId,
        authToken: data.authToken,
        pin: data.pin,
        watched: watched,
        observedAt: observedAt,
      });

      if (outcome === DiscordPinOutcome.RetryLater) {
        /*
         * The dedupe write failed without any side effect running: drop
         * the Redis claim so a later run can retry.
         */
        await this.releaseClaim(claimKey);
      }

      if (outcome === DiscordPinOutcome.SaveFailed) {
        /*
         * No note exists and the durable row stays Pending. Release the
         * Redis claim too: its 30-day TTL would otherwise block the
         * 15-minute stale-steal retry (reaction-sync parity).
         */
        await this.releaseClaim(claimKey);
      }

      return outcome;
    } catch (err) {
      try {
        await GlobalCache.deleteKey(this.CLAIM_NAMESPACE, claimKey);
      } catch (releaseErr) {
        logger.warn("Could not release Discord pin claim");
        logger.warn(releaseErr);
      }

      throw err;
    }
  }

  private static async releaseClaim(claimKey: string): Promise<void> {
    try {
      await GlobalCache.deleteKey(this.CLAIM_NAMESPACE, claimKey);
    } catch (releaseErr) {
      logger.warn("Could not release Discord pin claim");
      logger.warn(releaseErr);
    }
  }

  private static async handleClaimedPin(data: {
    projectId: ObjectID;
    authToken: string;
    pin: DiscordAuditPin;
    watched: DiscordWatchedChannel;
    observedAt: Date;
  }): Promise<string> {
    const resource: WorkspaceNoteResource = data.watched.resource;
    const logAttributes: { projectId: string; channelId: string } = {
      projectId: data.projectId.toString(),
      channelId: data.pin.channelId,
    };
    const claimKey: string = [
      resource.resourceId.toString(),
      WorkspaceNoteType.Private,
      data.pin.channelId,
      data.pin.messageId,
      data.pin.actorUserId,
    ].join(":");
    const sourceMessageKey: string = WorkspaceReactionNote.getSourceMessageKey({
      channelId: data.pin.channelId,
      messageId: data.pin.messageId,
    });

    // The pin path trusts the reaction sync's watched set (HOM-43 review 3);
    // re-verify the live binding before any save, like processReaction.
    if (
      !(await DiscordReactionNoteSync.isLiveInstallation(
        data.watched,
        data.projectId,
      ))
    ) {
      return DiscordPinOutcome.NotWatched;
    }

    // A 📌 reaction on the same message already saved this note.
    if (
      await WorkspaceReactionNote.hasNote({
        resource: resource,
        noteType: WorkspaceNoteType.Private,
        sourceMessageKey: sourceMessageKey,
      })
    ) {
      /*
       * Terminal for this claim, so it must be recorded as Done — the
       * mirror of the reaction sync: without this markDone a crash-after-
       * save steal lands here every stale window and never terminates.
       * A false return means the claim was stolen; the current owner owns
       * the terminal write and no side effect runs here (HOM-43 review 4).
       */
      let done: boolean;
      try {
        done = await DiscordReactionObservationService.markDone({
          projectId: data.projectId,
          claimKey: claimKey,
          observedAt: data.observedAt,
        });
      } catch (err) {
        logger.warn(
          "Could not record Discord pin observation; will retry.",
          logAttributes,
        );
        logger.warn(err, logAttributes);
        return DiscordPinOutcome.RetryLater;
      }

      if (!done) {
        return DiscordPinOutcome.AlreadyHandled;
      }

      return DiscordPinOutcome.AlreadySaved;
    }

    /*
     * The pin ACTOR authors the note. The message author is deliberately not
     * consulted: a pin by an on-call engineer of a message written by a bot
     * or by someone else must not attribute the note to that someone else.
     */
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: data.pin.actorUserId,
          workspaceType: WorkspaceType.Discord,
          projectId: data.projectId,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth || !userAuth.userId) {
      // Fail closed: no actor link, no note, no author fallback.
      return DiscordPinOutcome.NotLinked;
    }

    const oneUptimeUserId: ObjectID = userAuth.userId;

    try {
      await WorkspaceActionAuthorization.authorize({
        userId: oneUptimeUserId,
        projectId: data.projectId,
        modelType: WorkspaceReactionNote.getNoteModelType(
          resource.resourceType,
          WorkspaceNoteType.Private,
        ),
        action: WorkspaceReactionNote.getAuthorizationAction(
          resource.resourceType,
          WorkspaceNoteType.Private,
        ),
        resources: [
          {
            service: WorkspaceReactionNote.getResourceService(
              resource.resourceType,
            ) as unknown as DatabaseService<DatabaseBaseModel>,
            id: resource.resourceId,
          },
        ],
      });
    } catch (err) {
      if (!(err instanceof NotAuthorizedException)) {
        throw err;
      }

      return DiscordPinOutcome.NotAuthorized;
    }

    let message: JSONObject;

    try {
      message = (await DiscordClient.getChannelMessage({
        authToken: data.authToken,
        channelId: data.pin.channelId,
        messageId: data.pin.messageId,
      })) as JSONObject;
    } catch (err) {
      // Deleted message: nothing to save, and the cursor still advances.
      logger.warn("Could not read pinned Discord message", {
        projectId: data.projectId.toString(),
        channelId: data.pin.channelId,
        messageId: data.pin.messageId,
      });
      logger.warn(err);
      return DiscordPinOutcome.NoText;
    }

    const text: string = DiscordReactionNoteSync.getMessageText(message);

    if (!text) {
      /*
       * No text is terminal; a false markDone means the claim was stolen and
       * the current owner records it — no side effect here.
       */
      let done: boolean;
      try {
        done = await DiscordReactionObservationService.markDone({
          projectId: data.projectId,
          claimKey: claimKey,
          observedAt: data.observedAt,
        });
      } catch (err) {
        logger.warn("Could not record Discord pin observation; will retry.", {
          projectId: data.projectId.toString(),
          channelId: data.pin.channelId,
        });
        logger.warn(err);
        return DiscordPinOutcome.RetryLater;
      }
      if (!done) {
        return DiscordPinOutcome.AlreadyHandled;
      }
      return DiscordPinOutcome.NoText;
    }

    /*
     * SAVE FIRST, terminal record after (HOM-43 review 3) — same ordering
     * contract as the reaction sync. A failed save leaves the observation
     * Pending for a later steal; a crash after a successful save is turned
     * into Duplicate by hasNote on the retry.
     */
    let saveResult: WorkspaceNoteSaveResult;

    try {
      saveResult = await WorkspaceReactionNote.saveNote({
        resource: resource,
        noteType: WorkspaceNoteType.Private,
        userId: oneUptimeUserId,
        note: text,
        sourceMessageKey: sourceMessageKey,
      });
    } catch (err) {
      logger.error("Could not save Discord pin note", {
        projectId: data.projectId.toString(),
        channelId: data.pin.channelId,
      });
      logger.error(err);
      return DiscordPinOutcome.SaveFailed;
    }

    let doneAfterSave: boolean;
    try {
      doneAfterSave = await DiscordReactionObservationService.markDone({
        projectId: data.projectId,
        claimKey: claimKey,
        observedAt: data.observedAt,
      });
    } catch (err) {
      logger.warn("Could not record Discord pin observation; will retry.", {
        projectId: data.projectId.toString(),
        channelId: data.pin.channelId,
      });
      logger.warn(err);
      return DiscordPinOutcome.RetryLater;
    }

    /*
     * The claim was stolen while this worker saved. The note exists (the
     * save is idempotent on sourceMessageKey), and the current owner owns
     * the confirmation reply — this worker sends none (HOM-43 review 4).
     */
    if (!doneAfterSave) {
      return DiscordPinOutcome.AlreadySaved;
    }

    if (saveResult === WorkspaceNoteSaveResult.Duplicate) {
      return DiscordPinOutcome.AlreadySaved;
    }

    // The note is saved; the confirmation is best effort.
    try {
      const display: { label: string; link: URL } =
        await WorkspaceReactionNote.getResourceDisplay(resource);

      await DiscordClient.replyToMessage({
        authToken: data.authToken,
        channelId: data.pin.channelId,
        messageId: data.pin.messageId,
        content: WorkspaceReactionNote.getConfirmationMessage({
          noteType: WorkspaceNoteType.Private,
          resourceLabel: display.label,
          resourceLink: display.link.toString(),
          formatLink: (url: string, linkText: string): string => {
            return `[${linkText}](${url})`;
          },
          formatBold: (boldText: string): string => {
            return `**${boldText}**`;
          },
        }),
      });
    } catch (err) {
      logger.error("Error building Discord pin confirmation", {
        projectId: data.projectId.toString(),
      });
      logger.error(err);
    }

    return DiscordPinOutcome.Saved;
  }

  private static async getCursor(guildId: string): Promise<string | null> {
    try {
      return await GlobalCache.getString(this.CURSOR_NAMESPACE, guildId);
    } catch (err) {
      logger.warn("Could not read Discord pin cursor; rescanning page one");
      logger.warn(err);
      return null;
    }
  }

  private static async setCursor(
    guildId: string,
    entryId: string,
  ): Promise<void> {
    try {
      await GlobalCache.setString(this.CURSOR_NAMESPACE, guildId, entryId);
    } catch (err) {
      logger.warn("Could not persist Discord pin cursor");
      logger.warn(err);
    }
  }

  private static async warnAuditPermissionOnce(guildId: string): Promise<void> {
    try {
      const warned: boolean = await GlobalCache.setStringIfNotExists(
        this.AUDIT_WARN_NAMESPACE,
        guildId,
        "1",
        { expiresInSeconds: this.AUDIT_WARN_EVERY_SECONDS },
      );

      if (warned) {
        logger.warn(
          "Discord pin capture disabled: the bot lacks VIEW_AUDIT_LOG. Grant it to capture native pins; reaction capture is unaffected.",
          { guildId: guildId },
        );
      }
    } catch (err) {
      logger.warn("Could not rate-limit the audit permission warning");
      logger.warn(err);
    }
  }
}
