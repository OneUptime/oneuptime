import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import URL from "../../../../Types/API/URL";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../../Types/Date";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceNoteReactionUtil, {
  WorkspaceNoteType,
} from "../../../../Types/Workspace/WorkspaceNoteReaction";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import DatabaseConfig from "../../../DatabaseConfig";
import { MicrosoftTeamsAppClientId } from "../../../EnvironmentConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import DatabaseService from "../../../Services/DatabaseService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
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
import MicrosoftTeamsUtil from "./MicrosoftTeams";

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

  @CaptureSpan()
  public static async processReaction(data: {
    channel: MicrosoftTeamsWatchedChannel;
    reaction: MicrosoftTeamsNoteReaction;
    now: Date;
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

    const claimKey: string = [
      resource.resourceId.toString(),
      reaction.noteType,
      channel.channelId,
      reaction.messageId,
      reaction.reactingUserId,
      reaction.reactedAt.getTime().toString(),
    ].join(":");

    /*
     * Claim the reaction so it is handled once — not again next minute, and
     * not by two workers at the same time. Without the cache there is no safe
     * way to tell a new reaction from one already answered, so do nothing.
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

    try {
      return await this.handleClaimedReaction({
        channel: channel,
        reaction: reaction,
        now: data.now,
      });
    } catch (err) {
      // Something unexpected (Graph or the database): let the next run retry.
      try {
        await GlobalCache.deleteKey(this.CLAIM_NAMESPACE, claimKey);
      } catch (releaseErr) {
        logger.warn("Could not release Microsoft Teams reaction claim", {
          ...logAttributes,
        });
        logger.warn(releaseErr, logAttributes);
      }

      throw err;
    }
  }

  private static async handleClaimedReaction(data: {
    channel: MicrosoftTeamsWatchedChannel;
    reaction: MicrosoftTeamsNoteReaction;
    now: Date;
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
      if (isFresh) {
        await this.replyInThread({
          channel: channel,
          threadId: reaction.threadId,
          text: await this.getNotLinkedMessage({
            projectId: projectId,
            reactingUserName: reaction.reactingUserName,
          }),
        });
      }

      return MicrosoftTeamsReactionOutcome.NotLinked;
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
          channel: channel,
          threadId: reaction.threadId,
          text: reaction.reactingUserName
            ? `${reaction.reactingUserName}, ${err.message}`
            : err.message,
        });
      }

      return MicrosoftTeamsReactionOutcome.NotAuthorized;
    }

    const text: string = this.getMessageText(reaction.message);

    if (!text) {
      return MicrosoftTeamsReactionOutcome.NoText;
    }

    const saveResult: WorkspaceNoteSaveResult =
      await WorkspaceReactionNote.saveNote({
        resource: resource,
        noteType: reaction.noteType,
        userId: oneUptimeUserId,
        note: text,
        sourceMessageKey: sourceMessageKey,
      });

    if (saveResult === WorkspaceNoteSaveResult.Duplicate) {
      return MicrosoftTeamsReactionOutcome.AlreadySaved;
    }

    // The note is saved; the confirmation is best effort.
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
          formatLink: (url: string, linkText: string): string => {
            return `[${linkText}](${url})`;
          },
          formatBold: (boldText: string): string => {
            return `**${boldText}**`;
          },
        }),
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
      settingsLink = ` in [OneUptime → User Settings → Microsoft Teams](${URL.fromString(
        dashboardUrl.toString(),
      )
        .addRoute(
          `/${data.projectId.toString()}/user-settings/microsoft-teams-integration`,
        )
        .toString()})`;
    } catch (err) {
      logger.debug("Could not build the Microsoft Teams settings link");
      logger.debug(err);
    }

    return `${greeting} save messages as notes, first connect your Microsoft Teams account to OneUptime${settingsLink}, then react again.`;
  }

  // The text of a Graph chatMessage: its body, plus any adaptive card it carries.
  public static getMessageText(message: JSONObject): string {
    const body: JSONObject | undefined = message["body"] as
      | JSONObject
      | undefined;

    const content: string = (body?.["content"] as string | undefined) || "";
    const contentType: string = (
      (body?.["contentType"] as string | undefined) || "html"
    ).toLowerCase();

    const parts: Array<string> = [];

    const bodyText: string =
      contentType === "text" ? content.trim() : this.htmlToText(content);

    if (bodyText) {
      parts.push(bodyText);
    }

    for (const attachment of (message["attachments"] as Array<JSONObject>) ||
      []) {
      if (
        attachment["contentType"] !== "application/vnd.microsoft.card.adaptive"
      ) {
        continue;
      }

      let card: JSONObject | null = null;

      try {
        const rawCard: unknown = attachment["content"];
        card =
          typeof rawCard === "string"
            ? (JSON.parse(rawCard) as JSONObject)
            : (rawCard as JSONObject | undefined) ?? null;
      } catch {
        card = null;
      }

      const cardText: string = card ? this.getAdaptiveCardText(card) : "";

      if (cardText) {
        parts.push(cardText);
      }
    }

    return parts.join("\n\n").trim();
  }

  public static htmlToText(html: string): string {
    if (!html) {
      return "";
    }

    return this.decodeHtmlEntities(
      html
        .replace(/<attachment\b[^>]*>[\s\S]*?<\/attachment>/gi, "")
        .replace(/<at\b[^>]*>([\s\S]*?)<\/at>/gi, "@$1")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li\b[^>]*>/gi, "- ")
        .replace(/<\/(p|div|li|h[1-6]|blockquote|pre|tr)>/gi, "\n")
        .replace(/<[^>]*>/g, ""),
    )
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  // The visible text of an adaptive card, one element per line.
  public static getAdaptiveCardText(card: JSONObject): string {
    const lines: Array<string> = [];

    const visit: (element: unknown) => void = (element: unknown): void => {
      if (!element || typeof element !== "object") {
        return;
      }

      if (Array.isArray(element)) {
        for (const child of element) {
          visit(child);
        }
        return;
      }

      const node: JSONObject = element as JSONObject;
      const type: string | undefined = node["type"] as string | undefined;

      if (type === "TextBlock" && typeof node["text"] === "string") {
        lines.push(node["text"] as string);
      }

      if (type === "RichTextBlock" && Array.isArray(node["inlines"])) {
        const text: string = (node["inlines"] as Array<unknown>)
          .map((inline: unknown) => {
            if (typeof inline === "string") {
              return inline;
            }
            return ((inline as JSONObject)?.["text"] as string) || "";
          })
          .join("");

        if (text) {
          lines.push(text);
        }
      }

      if (type === "FactSet" && Array.isArray(node["facts"])) {
        for (const fact of node["facts"] as Array<JSONObject>) {
          const title: string = (fact?.["title"] as string) || "";
          const value: string = (fact?.["value"] as string) || "";

          if (title || value) {
            lines.push(title ? `${title} ${value}`.trim() : value);
          }
        }
      }

      for (const key of ["body", "items", "columns"]) {
        if (node[key]) {
          visit(node[key]);
        }
      }
    };

    visit(card);

    return lines
      .map((line: string) => {
        return line.trim();
      })
      .filter((line: string) => {
        return Boolean(line);
      })
      .join("\n");
  }

  private static decodeHtmlEntities(text: string): string {
    return (
      text
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;|&apos;/gi, "'")
        .replace(/&#(\d+);/g, (_match: string, code: string) => {
          return this.fromCodePoint(parseInt(code, 10));
        })
        .replace(/&#x([0-9a-f]+);/gi, (_match: string, code: string) => {
          return this.fromCodePoint(parseInt(code, 16));
        })
        // Last, so "&amp;lt;" decodes to "&lt;" rather than "<".
        .replace(/&amp;/gi, "&")
    );
  }

  private static fromCodePoint(codePoint: number): string {
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return "";
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
