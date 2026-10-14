import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceNoteReactionUtil, {
  WorkspaceNoteType,
} from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import { MicrosoftTeamsAppClientId } from "../../../EnvironmentConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import DatabaseService from "../../../Services/DatabaseService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import IncidentStateService from "../../../Services/IncidentStateService";
import AlertStateService from "../../../Services/AlertStateService";
import ScheduledMaintenanceStateService from "../../../Services/ScheduledMaintenanceStateService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceChannel } from "../WorkspaceBase";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import WorkspaceReactionNote, {
  WorkspaceMessageNoteOutcome,
  WorkspaceMessageNoteResult,
  WorkspaceNoteResource,
  WorkspaceNoteResourceType,
  WorkspaceNoteSaveResult,
} from "../WorkspaceReactionNote";
import MicrosoftTeamsUtil from "./MicrosoftTeams";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import ChatMessageMarkdown, {
  ChatMessageContent,
} from "../../../../Utils/Markdown/ChatMessageMarkdown";
import SavedChatMessage from "../../../../Types/Workspace/SavedChatMessage";
import SavedChatMessageAuthor from "../SavedChatMessageAuthor";
import MicrosoftTeamsMessageReader, {
  MicrosoftTeamsMessageAuthor,
} from "./MicrosoftTeamsMessageReader";
import MicrosoftTeamsActionAnswer from "./MicrosoftTeamsActionAnswer";
import WorkspaceActionAnswers from "../WorkspaceActionAnswers";
import WorkspaceConnectRequest, {
  WorkspaceConnectLink,
  WorkspaceConnectRequestTeamsPlace,
  WorkspacePendingAction,
  WorkspacePendingActionKind,
  WorkspacePendingMessage,
} from "../WorkspaceConnectRequest";
import { WorkspaceEventType } from "../WorkspaceMemberActions";

// A Teams channel OneUptime created for an incident / alert / ...
export interface MicrosoftTeamsWatchedChannel {
  resource: WorkspaceNoteResource;
  channelId: string;
  // Graph team id (AAD group id).
  teamId: string;
}

// One note emoji someone put on a channel message.
export interface MicrosoftTeamsNoteReaction {
  message: JSONObject;
  messageId: string;
  // The thread's first message: the message itself unless it is a reply.
  threadId: string;
  noteType: WorkspaceNoteType;
  // Entra (AAD) object id of the person who reacted.
  reactingUserId: string;
  reactingUserName?: string | undefined;
  reactedAt: Date;
}

export enum MicrosoftTeamsReactionOutcome {
  Saved = "Saved",
  AlreadySaved = "AlreadySaved",
  // Handled by an earlier run, or by another worker right now.
  AlreadyHandled = "AlreadyHandled",
  NotLinked = "NotLinked",
  NotAuthorized = "NotAuthorized",
  // The note's own create refused it: a permission, the plan, or a value.
  Refused = "Refused",
  NoText = "NoText",
  NotSupported = "NotSupported",
}

/*
 * Pin (📌) or megaphone (📣 / 📢) a message in an incident, alert, scheduled
 * maintenance or episode channel in Microsoft Teams, and it becomes a private
 * or public note in OneUptime — the same as in Slack.
 *
 * Slack tells OneUptime about reactions (reaction_added). Teams does not: the
 * Bot Framework only sends messageReaction activities for reactions to the
 * bot's own messages, so a reaction to something a person typed never reaches
 * OneUptime. This reads the reactions instead, once a minute, from the
 * channels OneUptime created, through Microsoft Graph.
 */
export default class MicrosoftTeamsReactionNoteSync {
  // Reactions older than this are left alone.
  public static readonly REACTION_MAX_AGE_IN_MINUTES: number = 24 * 60;

  /*
   * Only reactions this recent get a reply when they cannot be saved (the
   * person has not linked their account, or may not add that note). Older ones
   * were already answered, or are old enough that a reply would be noise.
   */
  public static readonly NOTICE_MAX_AGE_IN_MINUTES: number = 15;

  // Resolved resources stay watched this long after their last change.
  public static readonly RECENTLY_UPDATED_WINDOW_IN_HOURS: number = 24;

  public static readonly MAX_RESOURCES_PER_TYPE: number = 50;

  private static readonly CLAIM_NAMESPACE: string =
    "microsoft-teams-reaction-note";

  // A reaction whose person was asked to connect their account.
  private static readonly PROMPT_NAMESPACE: string =
    "microsoft-teams-reaction-note-prompt";

  /*
   * A handled reaction is remembered for longer than it can be picked up, so
   * a note someone deleted in OneUptime is not re-created from the reaction
   * that is still on the message.
   */
  private static readonly CLAIM_TTL_IN_SECONDS: number = 2 * 24 * 60 * 60;

  @CaptureSpan()
  public static async syncAllProjects(): Promise<void> {
    if (!MicrosoftTeamsAppClientId) {
      // Microsoft Teams is not set up on this deployment.
      return;
    }

    const projectAuths: Array<WorkspaceProjectAuthToken> =
      await WorkspaceProjectAuthTokenService.findBy({
        query: {
          workspaceType: WorkspaceType.MicrosoftTeams,
        },
        select: {
          projectId: true,
          authToken: true,
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
        });
      } catch (err) {
        logger.error("Error syncing Microsoft Teams reactions for project", {
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
  }): Promise<void> {
    const channels: Array<MicrosoftTeamsWatchedChannel> =
      await this.getWatchedChannels({ projectId: data.projectId });

    for (const channel of channels) {
      try {
        await this.syncChannel({
          projectId: data.projectId,
          authToken: data.authToken,
          channel: channel,
        });
      } catch (err) {
        // One unreadable channel (deleted, app removed) must not stop the rest.
        logger.warn("Could not sync reactions in Microsoft Teams channel", {
          projectId: data.projectId.toString(),
          channelId: channel.channelId,
        });
        logger.warn(err, { projectId: data.projectId.toString() });
      }
    }
  }

  /*
   * The Teams channels of every incident, alert, scheduled maintenance and
   * episode that is still open, or changed recently. When two resources list
   * the same channel, the newest one owns it — the same rule Slack uses.
   */
  @CaptureSpan()
  public static async getWatchedChannels(data: {
    projectId: ObjectID;
  }): Promise<Array<MicrosoftTeamsWatchedChannel>> {
    const recentlyUpdatedSince: Date = OneUptimeDate.addRemoveHours(
      OneUptimeDate.getCurrentDate(),
      -this.RECENTLY_UPDATED_WINDOW_IN_HOURS,
    );

    const channelsById: Map<
      string,
      { channel: MicrosoftTeamsWatchedChannel; createdAt: number }
    > = new Map();

    for (const resourceType of WorkspaceReactionNote.getAllResourceTypes()) {
      const service: DatabaseService<DatabaseBaseModel> =
        WorkspaceReactionNote.getResourceService(
          resourceType,
        ) as unknown as DatabaseService<DatabaseBaseModel>;

      const baseQuery: JSONObject = {
        projectId: data.projectId,
        postUpdatesToWorkspaceChannels: QueryHelper.jsonContains([
          { workspaceType: WorkspaceType.MicrosoftTeams },
        ]),
      };

      const queries: Array<JSONObject> = [
        {
          ...baseQuery,
          ...(await this.getOpenResourceQuery({
            resourceType: resourceType,
            projectId: data.projectId,
          })),
        },
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
              workspaceChannel.workspaceType !== WorkspaceType.MicrosoftTeams ||
              !workspaceChannel.id ||
              !workspaceChannel.teamId
            ) {
              continue;
            }

            const existing:
              | { channel: MicrosoftTeamsWatchedChannel; createdAt: number }
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
                teamId: workspaceChannel.teamId,
              },
              createdAt: createdAt,
            });
          }
        }
      }
    }

    return Array.from(channelsById.values()).map(
      (entry: { channel: MicrosoftTeamsWatchedChannel }) => {
        return entry.channel;
      },
    );
  }

  /*
   * The resources of a kind still open in the project. Incidents, alerts
   * and their episodes are open above the project's resolved state - one in
   * a state placed after Resolved is over (Common/Utils/ResolvedState). A
   * scheduled maintenance event is open until it is completed - in the
   * completed state or a state of the project's own after it, such as
   * "Archived" (Common/Utils/ScheduledMaintenanceStart.isComplete).
   */
  public static async getOpenResourceQuery(data: {
    resourceType: WorkspaceNoteResourceType;
    projectId: ObjectID;
  }): Promise<JSONObject> {
    switch (data.resourceType) {
      case WorkspaceNoteResourceType.Incident:
      case WorkspaceNoteResourceType.IncidentEpisode:
        return {
          currentIncidentStateId: QueryHelper.any(
            await IncidentStateService.getUnresolvedIncidentStateIds(
              data.projectId,
            ),
          ),
        };
      case WorkspaceNoteResourceType.Alert:
      case WorkspaceNoteResourceType.AlertEpisode:
        return {
          currentAlertStateId: QueryHelper.any(
            await AlertStateService.getUnresolvedAlertStateIds(data.projectId),
          ),
        };
      case WorkspaceNoteResourceType.ScheduledMaintenance:
        return {
          currentScheduledMaintenanceStateId: QueryHelper.any(
            await ScheduledMaintenanceStateService.getIncompleteScheduledMaintenanceStateIds(
              data.projectId,
            ),
          ),
        };
    }
  }

  @CaptureSpan()
  public static async syncChannel(data: {
    projectId: ObjectID;
    authToken: string;
    channel: MicrosoftTeamsWatchedChannel;
  }): Promise<Array<MicrosoftTeamsReactionOutcome>> {
    const messages: Array<JSONObject> =
      await MicrosoftTeamsUtil.getRecentChannelMessagesWithReplies({
        authToken: data.authToken,
        projectId: data.projectId,
        teamId: data.channel.teamId,
        channelId: data.channel.channelId,
      });

    const now: Date = OneUptimeDate.getCurrentDate();

    const reactions: Array<MicrosoftTeamsNoteReaction> = this.getNoteReactions({
      messages: messages,
      since: OneUptimeDate.addRemoveMinutes(
        now,
        -this.REACTION_MAX_AGE_IN_MINUTES,
      ),
    });

    const outcomes: Array<MicrosoftTeamsReactionOutcome> = [];

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
   * Every note emoji on the messages and their replies, oldest first, that a
   * person added since `since`.
   */
  public static getNoteReactions(data: {
    messages: Array<JSONObject>;
    since: Date;
  }): Array<MicrosoftTeamsNoteReaction> {
    const noteReactions: Array<MicrosoftTeamsNoteReaction> = [];

    const visit: (message: JSONObject, threadId: string) => void = (
      message: JSONObject,
      threadId: string,
    ): void => {
      const messageId: string | undefined = message["id"] as string | undefined;

      if (!messageId || message["deletedDateTime"]) {
        return;
      }

      const messageType: string | undefined = message["messageType"] as
        | string
        | undefined;

      if (messageType && messageType !== "message") {
        return;
      }

      const reactions: Array<JSONObject> =
        (message["reactions"] as Array<JSONObject> | undefined) || [];

      for (const reaction of reactions) {
        const noteType: WorkspaceNoteType | null =
          WorkspaceNoteReactionUtil.getNoteType({
            reactionType: reaction["reactionType"] as string | undefined,
            displayName: reaction["displayName"] as string | undefined,
          });

        if (!noteType) {
          continue;
        }

        // Reactions by apps carry user.application instead of user.user.
        const reactingUser: JSONObject | undefined = (
          reaction["user"] as JSONObject | undefined
        )?.["user"] as JSONObject | undefined;

        const reactingUserId: string | undefined = reactingUser?.["id"] as
          | string
          | undefined;

        if (!reactingUserId) {
          continue;
        }

        const reactedAt: Date | null = this.parseDate(
          reaction["createdDateTime"] as string | undefined,
        );

        if (!reactedAt || reactedAt.getTime() < data.since.getTime()) {
          continue;
        }

        noteReactions.push({
          message: message,
          messageId: messageId,
          threadId: (message["replyToId"] as string | undefined) || threadId,
          noteType: noteType,
          reactingUserId: reactingUserId,
          reactingUserName:
            (reactingUser?.["displayName"] as string | undefined) || undefined,
          reactedAt: reactedAt,
        });
      }
    };

    for (const message of data.messages || []) {
      const threadId: string | undefined = message["id"] as string | undefined;

      if (!threadId) {
        continue;
      }

      visit(message, threadId);

      for (const reply of (message["replies"] as Array<JSONObject>) || []) {
        visit(reply, threadId);
      }
    }

    return noteReactions.sort(
      (a: MicrosoftTeamsNoteReaction, b: MicrosoftTeamsNoteReaction) => {
        return a.reactedAt.getTime() - b.reactedAt.getTime();
      },
    );
  }

  /*
   * Handles one note emoji: claimed first, so it is handled once - not
   * again next minute, and not by two workers at the same time.
   *
   * A reaction from somebody whose Microsoft Teams account is not connected
   * is the one exception: its claim is given back, so a later run saves the
   * message once they have connected - they are asked to, once
   * (promptToConnect), with a Connect button that saves it at once
   * (saveAfterConnect).
   *
   * `quiet` handles it without a reply in the thread, and `report` is told
   * why a reaction was refused: for an answer given elsewhere.
   */
  @CaptureSpan()
  public static async processReaction(data: {
    channel: MicrosoftTeamsWatchedChannel;
    reaction: MicrosoftTeamsNoteReaction;
    now: Date;
    quiet?: boolean | undefined;
    report?: { reason?: string | undefined } | undefined;
  }): Promise<MicrosoftTeamsReactionOutcome> {
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
      return MicrosoftTeamsReactionOutcome.NotSupported;
    }

    const claimKey: string = this.getClaimKey({
      channel: channel,
      reaction: reaction,
    });

    /*
     * Without the cache there is no safe way to tell a new reaction from
     * one already answered, so nothing is done until it is back.
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
        "Could not claim Microsoft Teams reaction; will retry.",
        logAttributes,
      );
      logger.warn(err, logAttributes);
      return MicrosoftTeamsReactionOutcome.AlreadyHandled;
    }

    if (!claimed) {
      return MicrosoftTeamsReactionOutcome.AlreadyHandled;
    }

    let outcome: MicrosoftTeamsReactionOutcome;

    try {
      outcome = await this.handleClaimedReaction({
        channel: channel,
        reaction: reaction,
        now: data.now,
        quiet: data.quiet,
        report: data.report,
      });
    } catch (err) {
      // Something unexpected (Graph or the database): let the next run retry.
      await this.releaseClaim(claimKey, logAttributes);
      throw err;
    }

    // Saved by a later run, once the person has connected their account.
    if (outcome === MicrosoftTeamsReactionOutcome.NotLinked) {
      await this.releaseClaim(claimKey, logAttributes);
    }

    return outcome;
  }

  // What a reaction is claimed by: the record, the note, the message, who, when.
  private static getClaimKey(data: {
    channel: MicrosoftTeamsWatchedChannel;
    reaction: MicrosoftTeamsNoteReaction;
  }): string {
    return [
      data.channel.resource.resourceId.toString(),
      data.reaction.noteType,
      data.channel.channelId,
      data.reaction.messageId,
      data.reaction.reactingUserId,
      data.reaction.reactedAt.getTime().toString(),
    ].join(":");
  }

  private static async releaseClaim(
    claimKey: string,
    logAttributes: { projectId: string; channelId: string },
  ): Promise<void> {
    try {
      await GlobalCache.deleteKey(this.CLAIM_NAMESPACE, claimKey);
    } catch (releaseErr) {
      logger.warn("Could not release Microsoft Teams reaction claim", {
        ...logAttributes,
      });
      logger.warn(releaseErr, logAttributes);
    }
  }

  private static async handleClaimedReaction(data: {
    channel: MicrosoftTeamsWatchedChannel;
    reaction: MicrosoftTeamsNoteReaction;
    now: Date;
    quiet?: boolean | undefined;
    report?: { reason?: string | undefined } | undefined;
  }): Promise<MicrosoftTeamsReactionOutcome> {
    const { channel, reaction } = data;
    const resource: WorkspaceNoteResource = channel.resource;
    const projectId: ObjectID = resource.projectId;

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
      return MicrosoftTeamsReactionOutcome.AlreadySaved;
    }

    const isFresh: boolean =
      reaction.reactedAt.getTime() >=
      OneUptimeDate.addRemoveMinutes(
        data.now,
        -this.NOTICE_MAX_AGE_IN_MINUTES,
      ).getTime();

    // Replies about this reaction: only for a fresh one, never when quiet.
    const reply: (text: MarkdownText) => Promise<void> = async (
      text: MarkdownText,
    ): Promise<void> => {
      if (data.report) {
        data.report.reason = FeedMarkdown.withoutInvisibleBreaks(
          text.toString(),
        );
      }

      if (!isFresh || data.quiet) {
        return;
      }

      await this.replyInThread({
        channel: channel,
        threadId: reaction.threadId,
        text: text.toString(),
      });
    };

    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: reaction.reactingUserId,
          workspaceType: WorkspaceType.MicrosoftTeams,
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
      if (isFresh && !data.quiet) {
        await this.promptToConnect({
          channel: channel,
          reaction: reaction,
        });
      }

      return MicrosoftTeamsReactionOutcome.NotLinked;
    }

    const oneUptimeUserId: ObjectID = userAuth.userId;

    let props: DatabaseCommonInteractionProps;

    try {
      props = await WorkspaceActionAuthorization.authorize({
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

      // The person's name and the refusal are both text.
      await reply(
        reaction.reactingUserName
          ? mdText`${reaction.reactingUserName}, ${err.message}`
          : mdText`${err.message}`,
      );

      return MicrosoftTeamsReactionOutcome.NotAuthorized;
    }

    /*
     * The message as Teams showed it - its formatting, links, mentions,
     * files - and whose words it is, posted when (MicrosoftTeamsMessageReader).
     * A public note leaves out the files and images: a link into the
     * company's Teams opens for nobody on the status page.
     */
    const content: ChatMessageContent = MicrosoftTeamsMessageReader.read(
      reaction.message,
    );
    const note: MarkdownText = ChatMessageMarkdown.toMarkdown(content, {
      withoutAttachments: reaction.noteType === WorkspaceNoteType.Public,
    });

    if (note.isEmpty()) {
      await reply(
        mdText`${WorkspaceReactionNote.getNothingToSaveMessage({
          noteType: reaction.noteType,
          hasAttachments: !ChatMessageMarkdown.isEmpty(content),
        })}`,
      );

      return MicrosoftTeamsReactionOutcome.NoText;
    }

    const author: MicrosoftTeamsMessageAuthor =
      MicrosoftTeamsMessageReader.getAuthor(reaction.message);

    const savedFromChatMessage: SavedChatMessage =
      await SavedChatMessageAuthor.getSavedChatMessage({
        workspaceType: WorkspaceType.MicrosoftTeams,
        projectId: projectId,
        workspaceUserId: author.teamsUserId,
        chatName: author.name,
        postedAt: MicrosoftTeamsMessageReader.getPostedAt(reaction.message),
      });

    let saveResult: WorkspaceNoteSaveResult;

    try {
      saveResult = await WorkspaceReactionNote.saveNote({
        resource: resource,
        noteType: reaction.noteType,
        props: props,
        note: note.toString(),
        sourceMessageKey: sourceMessageKey,
        savedFromChatMessage: savedFromChatMessage,
      });
    } catch (err) {
      /*
       * Saved with the member's props, so the note's own create can still
       * refuse it after the check above - a label, a column, the plan. A
       * refusal is an answer, as the check's is: the claim is kept, so it is
       * not tried again every minute, and the member is told why. Anything
       * else is left for the next run to retry.
       */
      const refusal: string | null = this.getRefusalMessage(err);

      if (refusal === null) {
        throw err;
      }

      await reply(
        reaction.reactingUserName
          ? mdText`${reaction.reactingUserName}, could not save the message as a note: ${refusal}`
          : mdText`Could not save the message as a note: ${refusal}`,
      );

      return MicrosoftTeamsReactionOutcome.Refused;
    }

    if (saveResult === WorkspaceNoteSaveResult.Duplicate) {
      return MicrosoftTeamsReactionOutcome.AlreadySaved;
    }

    // The note is saved; its one confirmation is best effort.
    try {
      const display: { label: string; link: URL } =
        await WorkspaceReactionNote.getResourceDisplay(resource);

      await this.replyInThread({
        channel: channel,
        threadId: reaction.threadId,
        text: WorkspaceReactionNote.getConfirmationMessage({
          noteType: reaction.noteType,
          resourceLabel: display.label,
          resourceLink: display.link.toString(),
        }).toString(),
      });
    } catch (err) {
      logger.error("Error building Microsoft Teams note confirmation", {
        projectId: projectId.toString(),
        channelId: channel.channelId,
      });
      logger.error(err);
    }

    return MicrosoftTeamsReactionOutcome.Saved;
  }

  /*
   * A message somebody reacted to before their Microsoft Teams account was
   * connected, saved at once now that it is (WorkspaceConnectCompletion):
   * the channel's messages read again, and their reaction on this message
   * handled as a run would handle it - with no reply of its own in the
   * thread but the confirmation; the Connect button's answer says the rest.
   */
  @CaptureSpan()
  public static async saveAfterConnect(data: {
    resource: WorkspaceNoteResource;
    noteType: WorkspaceNoteType;
    message: WorkspacePendingMessage;
    // Their Microsoft Entra object id: whose reaction it is.
    workspaceUserId: string;
  }): Promise<WorkspaceMessageNoteResult> {
    const projectId: ObjectID = data.resource.projectId;

    if (!data.message.teamId) {
      return { outcome: WorkspaceMessageNoteOutcome.Failed };
    }

    const projectAuth: WorkspaceProjectAuthToken | null =
      await WorkspaceProjectAuthTokenService.getProjectAuth({
        projectId: projectId,
        workspaceType: WorkspaceType.MicrosoftTeams,
      });

    if (!projectAuth || !projectAuth.authToken) {
      return { outcome: WorkspaceMessageNoteOutcome.Failed };
    }

    const channel: MicrosoftTeamsWatchedChannel = {
      resource: data.resource,
      channelId: data.message.channelId,
      teamId: data.message.teamId,
    };

    const messages: Array<JSONObject> =
      await MicrosoftTeamsUtil.getRecentChannelMessagesWithReplies({
        authToken: projectAuth.authToken,
        projectId: projectId,
        teamId: channel.teamId,
        channelId: channel.channelId,
      });

    const now: Date = OneUptimeDate.getCurrentDate();

    const reactions: Array<MicrosoftTeamsNoteReaction> = this.getNoteReactions({
      messages: messages,
      since: OneUptimeDate.addRemoveMinutes(
        now,
        -this.REACTION_MAX_AGE_IN_MINUTES,
      ),
    }).filter((reaction: MicrosoftTeamsNoteReaction): boolean => {
      return (
        reaction.messageId === data.message.messageId &&
        reaction.noteType === data.noteType &&
        reaction.reactingUserId === data.workspaceUserId
      );
    });

    const reaction: MicrosoftTeamsNoteReaction | undefined =
      reactions[reactions.length - 1];

    if (!reaction) {
      return { outcome: WorkspaceMessageNoteOutcome.NotFound };
    }

    const report: { reason?: string | undefined } = {};

    const outcome: MicrosoftTeamsReactionOutcome = await this.processReaction(
      {
        channel: channel,
        reaction: reaction,
        now: now,
        quiet: true,
        report: report,
      },
    );

    switch (outcome) {
      case MicrosoftTeamsReactionOutcome.Saved:
        return { outcome: WorkspaceMessageNoteOutcome.Saved };
      case MicrosoftTeamsReactionOutcome.AlreadySaved:
        return { outcome: WorkspaceMessageNoteOutcome.AlreadySaved };
      case MicrosoftTeamsReactionOutcome.NotAuthorized:
      case MicrosoftTeamsReactionOutcome.Refused:
        return {
          outcome: WorkspaceMessageNoteOutcome.Refused,
          reason: report.reason,
        };
      case MicrosoftTeamsReactionOutcome.NoText:
        return {
          outcome: WorkspaceMessageNoteOutcome.NothingToSave,
          reason: report.reason,
        };
      case MicrosoftTeamsReactionOutcome.AlreadyHandled:
        // A run is handling it right now: saved, or about to be.
        return (await WorkspaceReactionNote.hasNote({
          resource: data.resource,
          noteType: data.noteType,
          sourceMessageKey: WorkspaceReactionNote.getSourceMessageKey({
            channelId: channel.channelId,
            messageId: reaction.messageId,
          }),
        }))
          ? { outcome: WorkspaceMessageNoteOutcome.Saved }
          : { outcome: WorkspaceMessageNoteOutcome.Failed };
      case MicrosoftTeamsReactionOutcome.NotLinked:
      case MicrosoftTeamsReactionOutcome.NotSupported:
        return { outcome: WorkspaceMessageNoteOutcome.Failed };
    }
  }

  /*
   * The message of a refusal written for the person who asked - a
   * permission, a plan the project is not on, a value the create would not
   * take - or null for anything else, whose text is meant for operators.
   */
  private static getRefusalMessage(error: unknown): string | null {
    if (
      (error instanceof NotAuthorizedException ||
        error instanceof BadDataException ||
        error instanceof PaymentRequiredException) &&
      error.message
    ) {
      return error.message;
    }

    return null;
  }

  private static async replyInThread(data: {
    channel: MicrosoftTeamsWatchedChannel;
    threadId: string;
    text: string;
  }): Promise<void> {
    try {
      await MicrosoftTeamsUtil.sendTextReplyToChannelThread({
        projectId: data.channel.resource.projectId,
        teamId: data.channel.teamId,
        channelId: data.channel.channelId,
        parentMessageId: data.threadId,
        text: data.text,
      });
    } catch (err) {
      logger.error("Error replying in Microsoft Teams thread", {
        projectId: data.channel.resource.projectId.toString(),
        channelId: data.channel.channelId,
      });
      logger.error(err);
    }
  }

  /*
   * Asks somebody who reacted before connecting their Microsoft Teams
   * account to connect it: a card in the message's thread that mentions
   * them, with a Connect button that saves the message at once when they
   * have (saveAfterConnect). Asked once for each reaction
   * (PROMPT_NAMESPACE), however many runs look at it until they connect;
   * without the cache, not at all, rather than at every run.
   */
  private static async promptToConnect(data: {
    channel: MicrosoftTeamsWatchedChannel;
    reaction: MicrosoftTeamsNoteReaction;
  }): Promise<void> {
    const { channel, reaction } = data;
    const resource: WorkspaceNoteResource = channel.resource;
    const projectId: ObjectID = resource.projectId;

    try {
      const isFirst: boolean = await GlobalCache.setStringIfNotExists(
        this.PROMPT_NAMESPACE,
        this.getClaimKey(data),
        "1",
        { expiresInSeconds: this.CLAIM_TTL_IN_SECONDS },
      );

      if (!isFirst) {
        return;
      }
    } catch (err) {
      logger.debug(
        "Could not note a Microsoft Teams Connect prompt; not asking.",
      );
      logger.debug(err);
      return;
    }

    try {
      const kind: WorkspacePendingActionKind =
        reaction.noteType === WorkspaceNoteType.Public
          ? WorkspacePendingActionKind.SavePublicNote
          : WorkspacePendingActionKind.SavePrivateNote;
      const eventType: WorkspaceEventType = WorkspaceReactionNote.getEventType(
        resource.resourceType,
      );
      const purpose: string = WorkspaceActionAnswers.getPendingActionPurpose({
        kind: kind,
        eventType: eventType,
      });

      const place: WorkspaceConnectRequestTeamsPlace | null =
        await MicrosoftTeamsUtil.getChannelThreadPlace({
          projectId: projectId,
          teamId: channel.teamId,
          channelId: channel.channelId,
          parentMessageId: reaction.threadId,
          userTeamsId: reaction.reactingUserId,
          userName: reaction.reactingUserName,
        });

      if (!place) {
        return;
      }

      const pendingAction: WorkspacePendingAction = {
        kind: kind,
        eventType: eventType,
        eventId: resource.resourceId,
        message: {
          channelId: channel.channelId,
          messageId: reaction.messageId,
          teamId: channel.teamId,
        },
      };

      const link: WorkspaceConnectLink =
        await WorkspaceConnectRequest.getConnectLink({
          workspaceType: WorkspaceType.MicrosoftTeams,
          projectId: projectId,
          workspaceUserId: reaction.reactingUserId,
          purpose: purpose,
          pendingAction: pendingAction,
          teams: place,
        });

      await MicrosoftTeamsActionAnswer.sendToPlace({
        place: place,
        answer: WorkspaceActionAnswers.getConnectPrompt({
          workspaceType: WorkspaceType.MicrosoftTeams,
          purpose: purpose,
          pendingAction: pendingAction,
          button: link.button,
        }),
        connectUrl: link.url,
      });
    } catch (err) {
      logger.error("Could not ask a Microsoft Teams member to connect", {
        projectId: projectId.toString(),
        channelId: channel.channelId,
      });
      logger.error(err);
    }
  }

  private static parseDate(value: string | undefined): Date | null {
    if (!value) {
      return null;
    }

    const date: Date = new Date(value);

    return isNaN(date.getTime()) ? null : date;
  }
}
