import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceNoteReactionUtil, {
  WorkspaceNoteType,
} from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import DatabaseConfig from "../../../DatabaseConfig";
import { DiscordBotToken } from "../../../EnvironmentConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import DiscordResourceThreadService from "../../../Services/DiscordResourceThreadService";
import DatabaseService from "../../../Services/DatabaseService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import DiscordReactionObservationService, {
  ObservationClaim,
} from "../../../Services/DiscordReactionObservationService";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceChannel } from "../WorkspaceBase";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceReactionNote, {
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../WorkspaceReactionNote";
import DiscordClient from "./DiscordClient";

// A Discord channel OneUptime created for an incident / alert / ...
export interface DiscordWatchedInstallation {
  /*
   * The persisted DiscordResourceThread row's installation tuple at
   * thread-claim time (HOM-42). Reinstall bumps the binding row's version
   * or replaces the row outright, so a mismatch on either means the
   * generation moved. Never populated from the live binding at poll time:
   * that would authorize pre-reinstall threads after a reinstall.
   */
  id: string;
  version: number;
}

export interface DiscordWatchedChannel {
  resource: WorkspaceNoteResource;
  channelId: string;
  guildId: string;
  installation?: DiscordWatchedInstallation;
}

/*
 * One note emoji reaction someone put on a channel message. Discord REST
 * carries no reaction timestamps, so the message timestamp is the only time
 * evidence; reactedAt below is the MESSAGE time, not the reaction time, and
 * the claim key deliberately has no time component.
 */
export interface DiscordNoteReaction {
  channelId: string;
  messageId: string;
  noteType: WorkspaceNoteType;
  // Discord user id of the person who reacted.
  reactingUserId: string;
  reactingUserName?: string | undefined;
  message: JSONObject;
  messageTimestamp: Date;
}

export enum DiscordReactionOutcome {
  Saved = "Saved",
  AlreadySaved = "AlreadySaved",
  // Handled by an earlier run, or by another worker right now.
  AlreadyHandled = "AlreadyHandled",
  NotLinked = "NotLinked",
  NotAuthorized = "NotAuthorized",
  NoText = "NoText",
  NotSupported = "NotSupported",
  // The channel's live guild no longer matches this project's installation.
  StaleInstallation = "StaleInstallation",
  /*
   * The durable dedupe layer could not be read or written. The reaction is
   * released and retried on a later run — a failed dedupe layer must never
   * be laundered into "already processed" (HOM-43 review 2).
   */
  RetryLater = "RetryLater",
  /*
   * The note save itself failed (HOM-43 review 3): no note exists, and the
   * observation stays Pending — stolen and retried after the threshold,
   * never silently terminal.
   */
  SaveFailed = "SaveFailed",
}

/*
 * Pin (📌) or megaphone (📣 / 📢) a message in an incident, alert, scheduled
 * maintenance or episode thread in Discord, and it becomes a private or
 * public note in OneUptime — the same as in Slack and Microsoft Teams.
 *
 * Slack tells OneUptime about reactions (reaction_added) and Teams reads them
 * from Graph with a timestamp per reaction. Discord does neither: interaction
 * webhooks do not carry reaction events, and the REST API does not expose
 * reaction times. So this reads the reactions from each watched channel once
 * a minute, bounded to recent messages, and deduplicates through claims plus
 * the note's own source-message key. What Discord does not expose is not
 * invented: eligibility windows use the message timestamp, and only the first
 * 100 reactors per emoji per message per poll are seen.
 */
export default class DiscordReactionNoteSync {
  // Only messages newer than this are polled; older reactions are left alone.
  public static readonly REACTION_MAX_AGE_IN_MINUTES: number = 24 * 60;

  /*
   * Only reactions on messages this recent get a reply when they cannot be
   * saved. Message time is the only available bound.
   */
  public static readonly NOTICE_MAX_AGE_IN_MINUTES: number = 15;

  // Resolved resources stay watched this long after their last change.
  public static readonly RECENTLY_UPDATED_WINDOW_IN_HOURS: number = 24;

  public static readonly MAX_RESOURCES_PER_TYPE: number = 50;

  public static readonly MESSAGES_PER_CHANNEL: number = 50;

  // Discord caps reactions listings at 100 users per page.
  public static readonly REACTION_USERS_PAGE_LIMIT: number = 100;

  /*
   * Hard cap on reactor-page walks per emoji per message: a viral reaction
   * must not consume the whole run. Beyond this the remaining reactors are
   * not seen this run — the honest boundary.
   */
  public static readonly MAX_REACTOR_PAGES: number = 5;

  private static readonly CLAIM_NAMESPACE: string = "discord-reaction-note";

  /*
   * A handled reaction is remembered for longer than the message stays in
   * the polling window, so a note someone deleted in OneUptime is not
   * re-created from the reaction still on the message.
   */
  private static readonly CLAIM_TTL_IN_SECONDS: number = 2 * 24 * 60 * 60;

  @CaptureSpan()
  public static async syncAllProjects(): Promise<void> {
    if (!DiscordBotToken) {
      // Discord is not set up on this deployment.
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

      try {
        await this.syncProject({
          projectId: projectAuth.projectId,
          authToken: projectAuth.authToken,
          guildId: projectAuth.workspaceProjectId?.toString() || "",
        });
      } catch (err) {
        logger.error("Error syncing Discord reactions for project", {
          projectId: projectAuth.projectId.toString(),
        });
        logger.error(err, { projectId: projectAuth.projectId.toString() });
      }
    }
  }

  @CaptureSpan()
  public static async syncProject(data: {
    projectId: ObjectID;
    authToken: string;
    guildId: string;
  }): Promise<void> {
    const channels: Array<DiscordWatchedChannel> =
      await this.getWatchedChannels({ projectId: data.projectId });

    for (const channel of channels) {
      try {
        await this.syncChannel({
          projectId: data.projectId,
          authToken: data.authToken,
          channel: channel,
          now: OneUptimeDate.getCurrentDate(),
        });
      } catch (err) {
        // One unreadable channel (deleted, bot removed) must not stop the rest.
        logger.warn("Could not sync reactions in Discord channel", {
          projectId: data.projectId.toString(),
          channelId: channel.channelId,
        });
        logger.warn(err, { projectId: data.projectId.toString() });
      }
    }
  }

  /*
   * The Discord channels of every incident, alert, scheduled maintenance and
   * episode that is still open, or changed recently. When two resources list
   * the same channel, the newest one owns it — the same rule Slack and Teams
   * use.
   */
  @CaptureSpan()
  public static async getWatchedChannels(data: {
    projectId: ObjectID;
  }): Promise<Array<DiscordWatchedChannel>> {
    const recentlyUpdatedSince: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -this.RECENTLY_UPDATED_WINDOW_IN_HOURS,
    );

    const channelsById: Map<
      string,
      { channel: DiscordWatchedChannel; createdAt: number }
    > = new Map();

    for (const resourceType of WorkspaceReactionNote.getAllResourceTypes()) {
      const service: DatabaseService<DatabaseBaseModel> =
        WorkspaceReactionNote.getResourceService(
          resourceType,
        ) as unknown as DatabaseService<DatabaseBaseModel>;

      const baseQuery: JSONObject = {
        projectId: data.projectId,
        postUpdatesToWorkspaceChannels: QueryHelper.jsonContains([
          { workspaceType: WorkspaceType.Discord },
        ]),
      };

      const queries: Array<JSONObject> = [
        { ...baseQuery, ...this.getOpenResourceQuery(resourceType) },
        {
          ...baseQuery,
          updatedAt: QueryHelper.greaterThanEqualTo(recentlyUpdatedSince),
        },
      ];

      for (const query of queries) {
        const rows: Array<DatabaseBaseModel> = await service.findBy({
          query: query as Query<DatabaseBaseModel>,
          select: {
            _id: true,
            projectId: true,
            createdAt: true,
            postUpdatesToWorkspaceChannels: true,
          } as any,
          sort: {
            createdAt: SortOrder.Descending,
          },
          limit: this.MAX_RESOURCES_PER_TYPE,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const row of rows) {
          const resourceId: ObjectID | null = row.id;

          if (!resourceId) {
            continue;
          }

          const createdAt: number = row.createdAt
            ? new Date(row.createdAt).getTime()
            : 0;

          const workspaceChannels: Array<WorkspaceChannel> =
            ((row as unknown as JSONObject)[
              "postUpdatesToWorkspaceChannels"
            ] as unknown as Array<WorkspaceChannel> | undefined) || [];

          for (const workspaceChannel of workspaceChannels) {
            if (
              !workspaceChannel ||
              workspaceChannel.workspaceType !== WorkspaceType.Discord ||
              !workspaceChannel.id
            ) {
              continue;
            }

            const existing:
              | { channel: DiscordWatchedChannel; createdAt: number }
              | undefined = channelsById.get(workspaceChannel.id);

            if (existing && existing.createdAt >= createdAt) {
              continue;
            }

            channelsById.set(workspaceChannel.id, {
              channel: {
                resource: {
                  resourceType: resourceType,
                  resourceId: resourceId,
                  projectId: data.projectId,
                },
                channelId: workspaceChannel.id,
                guildId: workspaceChannel.teamId || "",
              },
              createdAt: createdAt,
            });
          }
        }
      }
    }

    const watched: Array<DiscordWatchedChannel> = Array.from(
      channelsById.values(),
    ).map((entry: { channel: DiscordWatchedChannel }) => {
      return entry.channel;
    });

    /*
     * Stamp each watched entry with the persisted lifecycle row's
     * installation tuple (HOM-42), never the live binding: after a
     * reinstall the live row is the NEW installation, and stamping it
     * would authorize pre-reinstall threads. A resource with no lifecycle
     * row (a channel named by a rule, not a created thread) carries no
     * tuple; the live-guild check in isLiveInstallation still governs it.
     */
    const installationByResource: Map<string, DiscordWatchedInstallation | null> =
      new Map();

    for (const entry of watched) {
      const mapKey: string = [
        entry.resource.resourceType,
        entry.resource.resourceId.toString(),
      ].join(":");

      if (installationByResource.has(mapKey)) {
        continue;
      }

      try {
        const rows: Array<{
          installationId?: ObjectID | null;
          installationVersion?: number | null;
          state?: string | null;
          threadId?: string | null;
        }> = (await DiscordResourceThreadService.findBy({
          query: {
            projectId: data.projectId,
            resourceType: entry.resource.resourceType as unknown as string,
            resourceId: entry.resource.resourceId,
          },
          select: {
            installationId: true,
            installationVersion: true,
            state: true,
            threadId: true,
          },
          props: {
            isRoot: true,
          },
        } as never)) as never;

        const owned: {
          installationId?: ObjectID | null;
          installationVersion?: number | null;
          threadId?: string | null;
        } | null =
          rows.find((row: { threadId?: string | null }) =>
            Boolean(row.threadId),
          ) || null;

        installationByResource.set(
          mapKey,
          owned &&
            owned.installationId &&
            typeof owned.installationVersion === "number"
            ? {
                id: owned.installationId.toString(),
                version: owned.installationVersion,
              }
            : null,
        );
      } catch (err) {
        /*
         * Unreadable ownership stamps nothing: the entry falls back to the
         * guild-only check, which is what the pre-scaffold code did. Loud,
         * but the poll continues — one broken resource must not stop the
         * rest of the watch set (same rule as syncChannel).
         */
        logger.warn(
          "Could not read Discord thread ownership for watched entry",
          {
            projectId: data.projectId.toString(),
            channelId: entry.channelId,
          },
        );
        logger.warn(err, { channelId: entry.channelId });
        installationByResource.set(mapKey, null);
      }
    }

    for (const entry of watched) {
      const stamped: DiscordWatchedInstallation | null | undefined =
        installationByResource.get(
          [
            entry.resource.resourceType,
            entry.resource.resourceId.toString(),
          ].join(":"),
        );

      if (stamped) {
        entry.installation = stamped;
      }
    }

    return watched;
  }

  public static getOpenResourceQuery(
    resourceType: WorkspaceNoteResourceType,
  ): JSONObject {
    switch (resourceType) {
      case WorkspaceNoteResourceType.Incident:
      case WorkspaceNoteResourceType.IncidentEpisode:
        return { currentIncidentState: { isResolvedState: false } };
      case WorkspaceNoteResourceType.Alert:
      case WorkspaceNoteResourceType.AlertEpisode:
        return { currentAlertState: { isResolvedState: false } };
      case WorkspaceNoteResourceType.ScheduledMaintenance:
        return { currentScheduledMaintenanceState: { isResolvedState: false } };
    }
  }

  /*
   * Message pages walk back from the newest until the whole 24-hour
   * eligibility window is covered, or a per-run page budget is hit. The
   * window is on MESSAGE age, not reaction age: Discord exposes no reaction
   * timestamps. When the budget is hit first, the oldest message visited is
   * persisted as a checkpoint (Redis-backed, with a TTL covering the
   * eligibility window) and the next run resumes from it — a busy channel
   * is walked to the window floor across runs, never starved past page
   * WINDOW_PAGES_PER_RUN (HOM-43 review 2).
   */
  public static readonly WINDOW_PAGES_PER_RUN: number = 5;

  private static readonly CHECKPOINT_NAMESPACE: string =
    "discord-reaction-window-cursor";

  /*
   * Long enough that a resume never skips live history: the checkpoint is
   * only used to CONTINUE a walk; a lost checkpoint restarts at newest.
   */
  private static readonly CHECKPOINT_TTL_IN_SECONDS: number = 2 * 24 * 60 * 60;

  private static async getCheckpoint(
    channelId: string,
  ): Promise<string | null> {
    try {
      return await GlobalCache.getString(this.CHECKPOINT_NAMESPACE, channelId);
    } catch (err) {
      /*
       * A lost checkpoint means walking from newest again — safe, just
       * redundant. It must not fail the channel sync.
       */
      logger.warn("Could not read Discord pagination checkpoint", {
        channelId: channelId,
      });
      logger.warn(err, { channelId: channelId });
      return null;
    }
  }

  private static async setCheckpoint(
    channelId: string,
    messageId: string,
  ): Promise<void> {
    try {
      await GlobalCache.setString(
        this.CHECKPOINT_NAMESPACE,
        channelId,
        messageId,
        { expiresInSeconds: this.CHECKPOINT_TTL_IN_SECONDS },
      );
    } catch (err) {
      /*
       * Best effort: without a checkpoint the next run walks from newest,
       * which repeats recent pages but never starves older ones.
       */
      logger.warn("Could not persist Discord pagination checkpoint", {
        channelId: channelId,
      });
      logger.warn(err, { channelId: channelId });
    }
  }

  private static async clearCheckpoint(channelId: string): Promise<void> {
    try {
      await GlobalCache.deleteKey(this.CHECKPOINT_NAMESPACE, channelId);
    } catch {
      // Expiry cleans up; ignoring is safe.
    }
  }

  @CaptureSpan()
  public static async getChannelWindowMessages(data: {
    authToken: string;
    channelId: string;
    since: Date;
    now: Date;
  }): Promise<Array<JSONObject>> {
    const collected: Array<JSONObject> = [];

    /*
     * Resume from the last run's checkpoint when one stands, so a busy
     * channel keeps walking down instead of restarting at page 1.
     */
    let before: string | undefined =
      (await this.getCheckpoint(data.channelId)) || undefined;

    /*
     * True when the walk reached the window floor or channel floor: the
     * next run must restart at newest, not resume at the last page.
     */
    let windowCovered: boolean = false;

    for (let page: number = 0; page < this.WINDOW_PAGES_PER_RUN; page++) {
      const messages: Array<JSONObject> =
        (await DiscordClient.getChannelMessages({
          authToken: data.authToken,
          channelId: data.channelId,
          limit: this.MESSAGES_PER_CHANNEL,
          ...(before ? { before: before } : {}),
        })) as Array<JSONObject>;

      if (messages.length === 0) {
        /*
         * Channel history exhausted down to the checkpoint: the window is
         * fully walked. Restart at newest next run.
         */
        windowCovered = true;
        break;
      }

      for (const message of messages) {
        const visited: { message: JSONObject; timestamp: Date } | null =
          this.visitMessage({ message: message, since: data.since });

        if (visited) {
          collected.push(visited.message);
        }
      }

      // Discord returns newest first; the last item is the oldest.
      const oldest: JSONObject = messages[messages.length - 1]!;
      const oldestTimestamp: Date | null = this.parseTimestamp(
        String(oldest["id"] || ""),
      );

      if (
        !oldestTimestamp ||
        oldestTimestamp.getTime() < data.since.getTime()
      ) {
        // The window is fully covered. Restart at newest next run.
        windowCovered = true;
        break;
      }

      before = String(oldest["id"] || "");

      // A short page means Discord has no more history to give.
      if (messages.length < this.MESSAGES_PER_CHANNEL) {
        windowCovered = true;
        break;
      }
    }

    if (windowCovered) {
      await this.clearCheckpoint(data.channelId);
    } else if (before) {
      /*
       * Budget exhausted with the window still open: persist where the walk
       * stopped, and the next run continues from there.
       */
      await this.setCheckpoint(data.channelId, before);
    }

    return collected;
  }

  @CaptureSpan()
  public static async syncChannel(data: {
    projectId: ObjectID;
    authToken: string;
    channel: DiscordWatchedChannel;
    now?: Date;
  }): Promise<Array<DiscordReactionOutcome>> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    const messages: Array<JSONObject> = await this.getChannelWindowMessages({
      authToken: data.authToken,
      channelId: data.channel.channelId,
      since: OneUptimeDate.addRemoveMinutes(
        now,
        -this.REACTION_MAX_AGE_IN_MINUTES,
      ),
      now: now,
    });

    const reactions: Array<DiscordNoteReaction> = await this.getNoteReactions({
      authToken: data.authToken,
      channelId: data.channel.channelId,
      messages: messages,
      since: OneUptimeDate.addRemoveMinutes(
        now,
        -this.REACTION_MAX_AGE_IN_MINUTES,
      ),
    });

    const outcomes: Array<DiscordReactionOutcome> = [];

    for (const reaction of reactions) {
      outcomes.push(
        await this.processReaction({
          channel: data.channel,
          reaction: reaction,
          now: now,
        }),
      );
    }

    return outcomes;
  }

  /*
   * Every note emoji on the most recent messages, oldest message first. For
   * each note emoji the reaction users are fetched once (one bounded page of
   * 100). There is no reaction timestamp to order by; message time is the
   * only ordering evidence Discord gives.
   */
  @CaptureSpan()
  public static async getNoteReactions(data: {
    authToken: string;
    channelId: string;
    messages: Array<JSONObject>;
    since: Date;
  }): Promise<Array<DiscordNoteReaction>> {
    const noteReactions: Array<DiscordNoteReaction> = [];

    const eligible: Array<{ message: JSONObject; timestamp: Date }> = [];

    for (const message of data.messages || []) {
      const visited: { message: JSONObject; timestamp: Date } | null =
        this.visitMessage({ message: message, since: data.since });

      if (visited) {
        eligible.push(visited);
      }
    }

    // Oldest message first.
    eligible.sort((a: { timestamp: Date }, b: { timestamp: Date }): number => {
      return a.timestamp.getTime() - b.timestamp.getTime();
    });

    for (const entry of eligible) {
      const reactionSummaries: Array<JSONObject> =
        (entry.message["reactions"] as Array<JSONObject> | undefined) || [];

      for (const summary of reactionSummaries) {
        const emoji: JSONObject | undefined = summary["emoji"] as
          JSONObject | undefined;
        const emojiName: string | undefined = emoji?.["name"] as
          string | undefined;

        if (!emojiName) {
          continue;
        }

        const noteType: WorkspaceNoteType | null =
          WorkspaceNoteReactionUtil.getNoteType(emojiName);

        if (!noteType) {
          continue;
        }

        // Custom emoji must be probed by name:id; unicode by the character.
        const probeEmoji: string = emoji?.["id"]
          ? `${emojiName}:${emoji["id"]}`
          : emojiName;

        /*
         * Reaction users are walked past the 100-per-page cap: while
         * Discord returns a full page, the next page continues after the
         * last user id. Beyond MAX_REACTOR_PAGES the remainder is not seen
         * this run — the honest limit, stated rather than hidden.
         */
        let after: string | undefined = undefined;

        for (
          let reactorPage: number = 0;
          reactorPage < this.MAX_REACTOR_PAGES;
          reactorPage++
        ) {
          let users: JSONArray = [];

          try {
            users = await DiscordClient.getChannelReactions({
              authToken: data.authToken,
              channelId: data.channelId,
              messageId: String(entry.message["id"] || ""),
              emoji: probeEmoji,
              ...(after ? { after: after } : {}),
            });
          } catch (err) {
            // One unreadable reaction listing must not stop the channel.
            logger.warn("Could not read Discord reaction users", {
              channelId: data.channelId,
              messageId: String(entry.message["id"] || ""),
            });
            logger.warn(err, { channelId: data.channelId });
            break;
          }

          for (const user of users) {
            if (!user || user["bot"] === true) {
              // Bots do not author notes.
              continue;
            }

            const reactingUserId: string | undefined = user["id"] as
              string | undefined;

            if (!reactingUserId) {
              continue;
            }

            noteReactions.push({
              channelId: data.channelId,
              messageId: String(entry.message["id"] || ""),
              noteType: noteType,
              reactingUserId: reactingUserId,
              reactingUserName:
                (user["global_name"] as string | undefined) ||
                (user["username"] as string | undefined) ||
                undefined,
              message: entry.message,
              messageTimestamp: entry.timestamp,
            });
          }

          if (users.length < this.REACTION_USERS_PAGE_LIMIT) {
            // Last page: all reactors seen.
            break;
          }

          after = String(users[users.length - 1]!["id"] || "");

          if (!after) {
            break;
          }
        }
      }
    }

    return noteReactions;
  }

  private static visitMessage(data: {
    message: JSONObject;
    since: Date;
  }): { message: JSONObject; timestamp: Date } | null {
    const messageId: string | undefined = data.message["id"] as
      string | undefined;

    if (!messageId) {
      return null;
    }

    // Default (0) is a user message; anything else is a system message.
    const messageType: number | undefined = data.message["type"] as
      number | undefined;

    if (messageType !== undefined && messageType !== 0) {
      return null;
    }

    const timestamp: Date | null = this.parseTimestamp(messageId);

    if (!timestamp || timestamp.getTime() < data.since.getTime()) {
      return null;
    }

    return { message: data.message, timestamp: timestamp };
  }

  @CaptureSpan()
  public static async processReaction(data: {
    channel: DiscordWatchedChannel;
    reaction: DiscordNoteReaction;
    now: Date;
  }): Promise<DiscordReactionOutcome> {
    const { channel, reaction } = data;
    const resource: WorkspaceNoteResource = channel.resource;
    const projectId: ObjectID = resource.projectId;
    const logAttributes: { projectId: string; channelId: string } = {
      projectId: projectId.toString(),
      channelId: channel.channelId,
    };

    if (
      !WorkspaceReactionNote.supportsNoteType(
        resource.resourceType,
        reaction.noteType,
      )
    ) {
      return DiscordReactionOutcome.NotSupported;
    }

    /*
     * Discord exposes no reaction timestamp, so the claim key cannot include
     * one. A removed and re-added reaction within the claim TTL is therefore
     * not distinguishable, and is intentionally not re-processed.
     */
    const claimKey: string = [
      resource.resourceId.toString(),
      reaction.noteType,
      channel.channelId,
      reaction.messageId,
      reaction.reactingUserId,
    ].join(":");

    /*
     * Claim the reaction so it is handled once — not again next minute, and
     * not by two workers at the same time. Without the cache there is no
     * safe way to tell a new reaction from one already answered, so do
     * nothing.
     */
    let claimed: boolean = false;

    try {
      claimed = await GlobalCache.setStringIfNotExists(
        this.CLAIM_NAMESPACE,
        claimKey,
        "1",
        { expiresInSeconds: this.CLAIM_TTL_IN_SECONDS },
      );
    } catch (err) {
      logger.warn(
        "Could not claim Discord reaction; will retry.",
        logAttributes,
      );
      logger.warn(err, logAttributes);
      return DiscordReactionOutcome.AlreadyHandled;
    }

    if (!claimed) {
      return DiscordReactionOutcome.AlreadyHandled;
    }

    /*
     * Durable claim BEFORE any side effect (HOM-43 review 2): a Pending
     * observation row is written before the note save or user reply, and
     * flipped to Done after. A crash in between leaves an explicit
     * ambiguous state a later run steals — it never reads as "already
     * processed". A read/write failure here throws: the reaction is
     * released and retried; nothing is saved against an unreadable dedupe
     * layer.
     */
    let durableClaim: ObservationClaim;
    let observedAt: Date;

    try {
      durableClaim = await DiscordReactionObservationService.claim({
        projectId: projectId,
        claimKey: claimKey,
        source: "reaction",
      });
    } catch (err) {
      logger.warn(
        "Could not claim Discord reaction durably; will retry.",
        logAttributes,
      );
      logger.warn(err, logAttributes);
      await this.releaseClaim(claimKey, logAttributes);
      return DiscordReactionOutcome.RetryLater;
    }

    if (durableClaim.result === "AlreadyObserved") {
      return DiscordReactionOutcome.AlreadyHandled;
    }

    observedAt = durableClaim.observedAt;

    try {
      /*
       * The resource-to-channel mapping comes from data that can outlive a
       * disconnect/reconnect. Re-verify the live installation before any
       * save: the project's binding must still point at the guild this
       * channel lives in (HOM-43 review 3).
       */
      if (!(await this.isLiveInstallation(channel, projectId))) {
        return DiscordReactionOutcome.StaleInstallation;
      }

      const outcome: DiscordReactionOutcome = await this.handleClaimedReaction({
        channel: channel,
        reaction: reaction,
        now: data.now,
        observedAt: observedAt,
      });

      if (outcome === DiscordReactionOutcome.RetryLater) {
        /*
         * The dedupe write failed without any side effect running: drop
         * the Redis claim so a later run can retry. The Pending row (if
         * any) holds the retry cadence via the stale-steal window.
         */
        await this.releaseClaim(claimKey, logAttributes);
      }

      if (outcome === DiscordReactionOutcome.SaveFailed) {
        /*
         * No note exists and the durable row stays Pending. Release the
         * Redis claim too: its TTL is days, and holding it would block
         * the 15-minute stale-steal retry the Pending row exists for
         * (found in self-review, HOM-43 review 3).
         */
        await this.releaseClaim(claimKey, logAttributes);
      }

      return outcome;
    } catch (err) {
      /*
       * Something unexpected (Discord or the database): release both layers
       * so the next run can retry.
       */
      await this.releaseClaim(claimKey, logAttributes);
      throw err;
    }
  }

  /*
   * The live-binding ownership boundary (HOM-43 review 3): the project's
   * current Discord binding must exist, be undeleted, and name the guild the
   * watched channel's teamId carries. A same-guild reinstall replaces the
   * binding row or bumps its version; this check consults the live row at
   * save time, so a watched set captured under the previous installation
   * cannot smuggle a note in. An entry stamped with the persisted thread
   * row's installation tuple (HOM-42) is live only while the binding is
   * that same row at that same version: the guild alone cannot tell a
   * reinstall apart from the original install.
   */
  public static async isLiveInstallation(
    channel: DiscordWatchedChannel,
    projectId: ObjectID,
  ): Promise<boolean> {
    const liveAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.Discord,
      });

    if (
      !liveAuth ||
      liveAuth.deletedAt ||
      liveAuth.workspaceProjectId?.toString() !==
        (channel.guildId || liveAuth.workspaceProjectId?.toString())
    ) {
      return false;
    }

    if (channel.installation) {
      const liveId: string | undefined = (liveAuth.id || liveAuth._id)
        ?.toString()
        .trim();
      return Boolean(
        liveId &&
          liveId === channel.installation.id &&
          typeof liveAuth.version === "number" &&
          liveAuth.version === channel.installation.version,
      );
    }

    return true;
  }

  /*
   * Releases the Redis claim so a later run can retry. The durable row is
   * deliberately NOT touched: a Pending row is rolled back only by the
   * stale-steal window, never deleted out from under a possible side
   * effect.
   */
  private static async releaseClaim(
    claimKey: string,
    logAttributes: { projectId: string; channelId: string },
  ): Promise<void> {
    try {
      await GlobalCache.deleteKey(this.CLAIM_NAMESPACE, claimKey);
    } catch (releaseErr) {
      logger.warn("Could not release Discord reaction claim", {
        ...logAttributes,
      });
      logger.warn(releaseErr, logAttributes);
    }
  }

  private static async handleClaimedReaction(data: {
    channel: DiscordWatchedChannel;
    reaction: DiscordNoteReaction;
    now: Date;
    observedAt: Date;
  }): Promise<DiscordReactionOutcome> {
    const { channel, reaction } = data;
    const resource: WorkspaceNoteResource = channel.resource;
    const projectId: ObjectID = resource.projectId;
    const logAttributes: { projectId: string; channelId: string } = {
      projectId: projectId.toString(),
      channelId: channel.channelId,
    };

    // Same key processReaction claimed; recomputed here for markDone.
    const claimKey: string = [
      resource.resourceId.toString(),
      reaction.noteType,
      channel.channelId,
      reaction.messageId,
      reaction.reactingUserId,
    ].join(":");

    const sourceMessageKey: string = WorkspaceReactionNote.getSourceMessageKey({
      channelId: channel.channelId,
      messageId: reaction.messageId,
    });

    // Someone else's pin (or this one, before a cache flush) already saved it.
    if (
      await WorkspaceReactionNote.hasNote({
        resource: resource,
        noteType: reaction.noteType,
        sourceMessageKey: sourceMessageKey,
      })
    ) {
      /*
       * Terminal for this claim, so it must be recorded as Done — including
       * the steal-retry path: a crash after save leaves the row Pending, a
       * later run steals it, hasNote is true here, and without this
       * markDone the row would be re-stolen every stale window forever.
       * A false return means the claim was stolen: this worker no longer
       * owns the terminal write, and no user-visible side effect runs
       * (HOM-43 review 4).
       */
      let done: boolean;
      try {
        done = await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: claimKey,
          observedAt: data.observedAt,
        });
      } catch (err) {
        logger.warn(
          "Could not record Discord reaction observation; will retry.",
          logAttributes,
        );
        logger.warn(err, logAttributes);
        return DiscordReactionOutcome.RetryLater;
      }

      if (!done) {
        return DiscordReactionOutcome.AlreadyHandled;
      }

      return DiscordReactionOutcome.AlreadySaved;
    }

    const isFresh: boolean =
      reaction.messageTimestamp.getTime() >=
      OneUptimeDate.addRemoveMinutes(
        data.now,
        -this.NOTICE_MAX_AGE_IN_MINUTES,
      ).getTime();

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: reaction.reactingUserId,
          workspaceType: WorkspaceType.Discord,
          projectId: projectId,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!userAuth || !userAuth.userId) {
      /*
       * Refusal is terminal for this reaction: record it durably BEFORE the
       * user-facing reply, so a crash between the two cannot refire the
       * reply on the next run (HOM-43 review 2). A false return means the
       * claim was stolen and the current owner handles the reply — this
       * worker stays silent (HOM-43 review 4).
       */
      let done: boolean;
      try {
        done = await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: claimKey,
          observedAt: data.observedAt,
        });
      } catch (err) {
        logger.warn(
          "Could not record Discord reaction observation; will retry.",
          logAttributes,
        );
        logger.warn(err, logAttributes);
        return DiscordReactionOutcome.RetryLater;
      }

      if (!done) {
        return DiscordReactionOutcome.AlreadyHandled;
      }

      if (isFresh) {
        await this.replyInThread({
          authToken: await this.authTokenFor(projectId),
          channel: channel,
          messageId: reaction.messageId,
          text: await this.getNotLinkedMessage({
            projectId: projectId,
            reactingUserName: reaction.reactingUserName,
          }),
        });
      }

      return DiscordReactionOutcome.NotLinked;
    }

    const oneUptimeUserId: ObjectID = userAuth.userId;

    try {
      await WorkspaceActionAuthorization.authorize({
        userId: oneUptimeUserId,
        projectId: projectId,
        modelType: WorkspaceReactionNote.getNoteModelType(
          resource.resourceType,
          reaction.noteType,
        ),
        action: WorkspaceReactionNote.getAuthorizationAction(
          resource.resourceType,
          reaction.noteType,
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

      if (isFresh) {
        await this.replyInThread({
          authToken: await this.authTokenFor(projectId),
          channel: channel,
          messageId: reaction.messageId,
          text: reaction.reactingUserName
            ? `${reaction.reactingUserName}, ${err.message}`
            : err.message,
        });
      }

      return DiscordReactionOutcome.NotAuthorized;
    }

    const text: string = this.getMessageText(reaction.message);

    if (!text) {
      /*
       * No text is terminal; a false markDone means the claim was stolen and
       * the current owner records it — no side effect here.
       */
      let done: boolean;
      try {
        done = await DiscordReactionObservationService.markDone({
          projectId: projectId,
          claimKey: claimKey,
          observedAt: data.observedAt,
        });
      } catch (err) {
        logger.warn(
          "Could not record Discord reaction observation; will retry.",
          logAttributes,
        );
        logger.warn(err, logAttributes);
        return DiscordReactionOutcome.RetryLater;
      }
      if (!done) {
        return DiscordReactionOutcome.AlreadyHandled;
      }
      return DiscordReactionOutcome.NoText;
    }

    /*
     * SAVE FIRST, terminal record after (HOM-43 review 3): markDone used to
     * run before saveNote, so a failed save left no note and a Done row —
     * the reaction was never retried and the note was silently lost. Now a
     * failed save throws out with the observation still Pending, which a
     * later run steals and retries. A crash AFTER a successful save leaves
     * the row Pending too; the steal re-runs the save, hasNote turns that
     * into Duplicate, and the row is marked Done then — at-least-once, with
     * no silent loss and no duplicate note.
     */
    let saveResult: WorkspaceNoteSaveResult;

    try {
      saveResult = await WorkspaceReactionNote.saveNote({
        resource: resource,
        noteType: reaction.noteType,
        userId: oneUptimeUserId,
        note: text,
        sourceMessageKey: sourceMessageKey,
      });
    } catch (err) {
      logger.error("Could not save Discord reaction note", logAttributes);
      logger.error(err, logAttributes);
      return DiscordReactionOutcome.SaveFailed;
    }

    let doneAfterSave: boolean;
    try {
      doneAfterSave = await DiscordReactionObservationService.markDone({
        projectId: projectId,
        claimKey: claimKey,
        observedAt: data.observedAt,
      });
    } catch (err) {
      logger.warn(
        "Could not record Discord reaction observation; will retry.",
        logAttributes,
      );
      logger.warn(err, logAttributes);
      return DiscordReactionOutcome.RetryLater;
    }

    /*
     * The claim was stolen while this worker saved. The note exists (the
     * save is idempotent on sourceMessageKey, so the thief's re-save turns
     * into Duplicate), and the current owner owns the confirmation reply —
     * this worker sends none (HOM-43 review 4).
     */
    if (!doneAfterSave) {
      return DiscordReactionOutcome.AlreadySaved;
    }

    if (saveResult === WorkspaceNoteSaveResult.Duplicate) {
      return DiscordReactionOutcome.AlreadySaved;
    }

    // The note is saved; the confirmation is best effort.
    try {
      const display: { label: string; link: URL } =
        await WorkspaceReactionNote.getResourceDisplay(resource);

      await this.replyInThread({
        authToken: await this.authTokenFor(projectId),
        channel: channel,
        messageId: reaction.messageId,
        text: WorkspaceReactionNote.getConfirmationMessage({
          noteType: reaction.noteType,
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
      logger.error("Error building Discord note confirmation", {
        projectId: projectId.toString(),
        channelId: channel.channelId,
      });
      logger.error(err);
    }

    return DiscordReactionOutcome.Saved;
  }

  private static async authTokenFor(_projectId: ObjectID): Promise<string> {
    if (!DiscordBotToken) {
      throw new NotAuthorizedException("Discord bot is not configured.");
    }
    return DiscordBotToken;
  }

  private static async replyInThread(data: {
    authToken: string;
    channel: DiscordWatchedChannel;
    messageId: string;
    text: string;
  }): Promise<void> {
    try {
      await DiscordClient.replyToMessage({
        authToken: data.authToken,
        channelId: data.channel.channelId,
        messageId: data.messageId,
        content: data.text,
      });
    } catch (err) {
      logger.error("Error replying in Discord thread", {
        projectId: data.channel.resource.projectId.toString(),
        channelId: data.channel.channelId,
      });
      logger.error(err);
    }
  }

  private static async getNotLinkedMessage(data: {
    projectId: ObjectID;
    reactingUserName?: string | undefined;
  }): Promise<string> {
    const greeting: string = data.reactingUserName
      ? `${data.reactingUserName}, to`
      : "To";

    let settingsLink: string = "";

    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();
      settingsLink = ` in [OneUptime → User Settings → Discord](${URL.fromString(
        dashboardUrl.toString(),
      )
        .addRoute(
          `/${data.projectId.toString()}/user-settings/discord-integration`,
        )
        .toString()})`;
    } catch (err) {
      logger.debug("Could not build the Discord settings link");
      logger.debug(err);
    }

    return `${greeting} save messages as notes, first connect your Discord account to OneUptime${settingsLink}, then react again.`;
  }

  // The visible text of a Discord message: content plus embed text.
  public static getMessageText(message: JSONObject): string {
    const parts: Array<string> = [];

    const content: string = (message["content"] as string | undefined) || "";
    const contentText: string = content.trim();

    if (contentText) {
      parts.push(contentText);
    }

    for (const embed of (message["embeds"] as Array<JSONObject>) || []) {
      const embedText: string = this.getEmbedText(embed);

      if (embedText) {
        parts.push(embedText);
      }
    }

    return parts.join("\n\n").trim();
  }

  private static getEmbedText(embed: JSONObject): string {
    const lines: Array<string> = [];

    const title: string = (embed["title"] as string | undefined) || "";
    if (title.trim()) {
      lines.push(title.trim());
    }

    const description: string =
      (embed["description"] as string | undefined) || "";
    if (description.trim()) {
      lines.push(description.trim());
    }

    for (const field of (embed["fields"] as Array<JSONObject>) || []) {
      const name: string = (field?.["name"] as string) || "";
      const value: string = (field?.["value"] as string) || "";

      if (name.trim() && value.trim()) {
        lines.push(`${name.trim()} ${value.trim()}`);
      } else if (value.trim()) {
        lines.push(value.trim());
      }
    }

    const footerText: string =
      ((embed["footer"] as JSONObject | undefined)?.["text"] as
        string | undefined) || "";
    if (footerText.trim()) {
      lines.push(footerText.trim());
    }

    return lines.join("\n");
  }

  // Discord snowflakes carry their creation time in the top 42 bits.
  public static parseTimestamp(snowflake: string): Date | null {
    try {
      const id: bigint = BigInt(snowflake);
      const epoch: bigint = BigInt(1420070400000);
      const shift: bigint = BigInt(22);
      const timestamp: number = Number((id >> shift) + epoch);

      if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return null;
      }

      return new Date(timestamp);
    } catch {
      return null;
    }
  }
}
