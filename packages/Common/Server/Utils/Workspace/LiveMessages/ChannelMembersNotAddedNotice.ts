import User from "../../../../Models/DatabaseModels/User";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import URL from "../../../../Types/API/URL";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import {
  CONNECT_ACCOUNT_QUERY_PARAM,
  CONNECT_ACCOUNT_QUERY_VALUE,
} from "../../../../Types/Workspace/ConnectCallback";
import WorkspaceLiveMessageKey, {
  WorkspaceLiveMessageData,
} from "../../../../Types/Workspace/WorkspaceLiveMessageKey";
import { WorkspacePayloadMarkdown } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  mdText,
  MarkdownText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../../DatabaseConfig";
import QueryHelper from "../../../Types/Database/QueryHelper";
import UserService from "../../../Services/UserService";
import WorkspaceLiveMessageService from "../../../Services/WorkspaceLiveMessageService";
import { NotificationFor } from "../../../Services/WorkspaceNotificationRuleService";
import logger, { LogAttributes } from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import MicrosoftTeamsOnCallMention from "../MicrosoftTeams/MicrosoftTeamsOnCallMention";
import { ScheduleOnCallPerson } from "../WorkspaceScheduleOnCall";
import WorkspaceLiveMessages from "./WorkspaceLiveMessages";

// A channel OneUptime could not add somebody to.
export interface ChannelMembersNotAddedChannel {
  id: string;
  name?: string | undefined;
  // A Microsoft Teams channel's team, by its Graph id: what posting to it takes.
  teamId?: string | undefined;
}

/*
 * The people OneUptime could not add to some channels of one workspace: what
 * a channel's note names. Channel setup hands these back (rather than posting
 * the note itself) so the note comes after the record's own first message.
 */
export interface ChannelMembersNotAdded {
  workspaceType: WorkspaceType;
  channels: Array<ChannelMembersNotAddedChannel>;
  userIds: Array<ObjectID>;
  /*
   * Microsoft Teams adds nobody to a channel, so the people on call in the
   * schedules the channels' rules name are @mentioned in them instead
   * (MicrosoftTeamsOnCallMention), and Teams notifies them.
   */
  onCallToMention?: Array<ScheduleOnCallPerson> | undefined;
  // The record the channels are for: the mention is logged against it.
  notificationFor?: NotificationFor | undefined;
}

// The note, as posted: its Markdown, and the line its notification shows.
export interface ChannelMembersNotAddedNote {
  markdown: string;
  text: string;
}

/*
 * "SOME PEOPLE COULD NOT BE ADDED TO THIS CHANNEL", SAID ONCE PER CHANNEL.
 *
 * OneUptime adds people to the Slack channels it creates for an incident,
 * alert or episode - the rule's people and teams, the record's owners, and
 * whoever an on-call policy pages - through the Slack account each of them
 * connected to OneUptime. Somebody who has not connected one cannot be
 * added. That used to be said in a message of its own for every person,
 * every time OneUptime tried to add them: once when the channel was created,
 * again each time an on-call rule paged them, so the same "NB User 3 cannot
 * be invited to the channel" came back every few minutes.
 *
 * Now each channel gets one note naming everybody OneUptime could not add,
 * and how to fix it. Somebody new who cannot be added is added to that note,
 * which is edited in place; somebody it names already changes nothing.
 *
 * The note is read by the people in the channel - the people it names are
 * not in it - so it tells them what they can do: add them, or send them its
 * Connect Slack account link. The link opens the Slack settings page of
 * whoever opens it with `?connectAccount=true`, which connects that
 * person's account straight away (one click, then Slack's own Allow): a
 * link in a message everybody reads cannot be anybody's in particular, so
 * it carries no token and finishes nothing - it only connects the account
 * of the person who opened it, as the page's own Connect button would.
 *
 * In a channel OneUptime has just created, the note comes after the record's
 * own first message ("Incident INC-8 Created"): channel setup hands back who
 * it could not add, and the record's service notes them (noteAll) once that
 * message is posted. So the channel opens on what happened, not on who is
 * missing from it.
 *
 * Slack only. OneUptime never adds people to a Microsoft Teams channel - a
 * standard channel is open to everyone in its team - so connecting a
 * Microsoft Teams account would not add anybody either, and the note would
 * only tell people to do something that changes nothing. What a Teams
 * channel is told at the same moment instead is who is on call in the
 * schedules its rules name, @mentioned so that Teams notifies them
 * (MicrosoftTeamsOnCallMention).
 */
export default class ChannelMembersNotAddedNotice {
  /*
   * Notes everybody channel setup could not add, channel by channel, and
   * mentions who is on call in a Microsoft Teams channel. Never throws: a
   * note that cannot be posted is logged, and the record's other messages
   * go on.
   */
  @CaptureSpan()
  public static async noteAll(data: {
    projectId: ObjectID | undefined | null;
    membersNotAdded: Array<ChannelMembersNotAdded> | undefined | null;
  }): Promise<void> {
    if (!data.projectId || !data.membersNotAdded) {
      return;
    }

    for (const membersNotAdded of data.membersNotAdded) {
      try {
        if (
          membersNotAdded.workspaceType === WorkspaceType.MicrosoftTeams &&
          membersNotAdded.onCallToMention &&
          membersNotAdded.onCallToMention.length > 0
        ) {
          await MicrosoftTeamsOnCallMention.mentionInChannels({
            projectId: data.projectId,
            channels: membersNotAdded.channels,
            people: membersNotAdded.onCallToMention,
            notificationFor: membersNotAdded.notificationFor,
          });
        }

        await this.noteMembersNotAdded({
          projectId: data.projectId,
          workspaceType: membersNotAdded.workspaceType,
          channels: membersNotAdded.channels,
          userIds: membersNotAdded.userIds,
        });
      } catch (err) {
        logger.error(
          "Could not tell the new channels who OneUptime could not add to them.",
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        logger.error(err, {
          projectId: data.projectId.toString(),
        } as LogAttributes);
      }
    }
  }

  @CaptureSpan()
  public static async noteMembersNotAdded(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    channels: Array<ChannelMembersNotAddedChannel>;
    userIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.workspaceType !== WorkspaceType.Slack) {
      return;
    }

    const userIds: Array<string> = this.getUniqueIds(data.userIds);

    if (userIds.length === 0) {
      return;
    }

    const messageKey: string =
      WorkspaceLiveMessageKey.forChannelMembersNotAdded();

    const seenChannelIds: Set<string> = new Set<string>();

    for (const channel of data.channels) {
      if (!channel.id || seenChannelIds.has(channel.id)) {
        continue;
      }

      seenChannelIds.add(channel.id);

      try {
        await WorkspaceLiveMessages.withLock(
          `${data.projectId.toString()}:${messageKey}:${channel.id}`,
          async (): Promise<void> => {
            await this.noteInChannel({
              projectId: data.projectId,
              workspaceType: data.workspaceType,
              channel: channel,
              messageKey: messageKey,
              userIds: userIds,
            });
          },
        );
      } catch (err) {
        logger.error(
          "Could not tell a channel who OneUptime could not add to it.",
          {
            projectId: data.projectId.toString(),
            channelId: channel.id,
          } as LogAttributes,
        );
        logger.error(err, {
          projectId: data.projectId.toString(),
        } as LogAttributes);
      }
    }
  }

  private static async noteInChannel(data: {
    projectId: ObjectID;
    workspaceType: WorkspaceType;
    channel: ChannelMembersNotAddedChannel;
    messageKey: string;
    userIds: Array<string>;
  }): Promise<void> {
    const keptMessage: WorkspaceLiveMessage | undefined = (
      await WorkspaceLiveMessageService.findByMessageKey({
        projectId: data.projectId,
        messageKey: data.messageKey,
        channelId: data.channel.id,
      })
    )[0];

    const namedAlready: Array<string> = this.getNamedUserIds(keptMessage);

    const named: Array<string> = [...namedAlready];

    for (const userId of data.userIds) {
      if (!named.includes(userId)) {
        named.push(userId);
      }
    }

    if (keptMessage && named.length === namedAlready.length) {
      // Everybody is named already: nothing to say.
      return;
    }

    const note: ChannelMembersNotAddedNote = await this.getNote({
      projectId: data.projectId,
      userIds: named,
    });

    const messageBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: note.markdown,
    };

    const messageData: WorkspaceLiveMessageData = { userIds: named };

    if (keptMessage) {
      await WorkspaceLiveMessages.updateKept({
        keptMessage: keptMessage,
        messageBlocks: [messageBlock],
        text: note.text,
        messageData: messageData,
      });
      return;
    }

    await WorkspaceLiveMessages.postAndKeep({
      projectId: data.projectId,
      messageKey: data.messageKey,
      destination: {
        _type: "WorkspaceMessagePayload",
        workspaceType: data.workspaceType,
        messageBlocks: [messageBlock],
        channelNames: [],
        channelIds: [data.channel.id],
        text: note.text,
      },
      messageData: messageData,
    });
  }

  /*
   * The note: who could not be added, why, and what the people in the
   * channel can do about it - names first, as a person scanning the channel
   * reads them:
   *
   *   👥 NB User 3 and Jane Doe could not be added to this channel: they
   *   have not connected their Slack accounts to OneUptime yet. Add them
   *   here yourself, or send them this link to connect in one click:
   *   Connect Slack account.
   *
   * Without a dashboard address to link to, the settings page is named in
   * words instead. Names are text: a person's name is theirs to set. The
   * product's name is the one the installation goes by
   * (ProductBrandingText).
   */
  public static async getNote(data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<ChannelMembersNotAddedNote> {
    const names: Array<string> = await this.getNames(data.userIds);
    const productName: string = ProductBrandingText.getProductName();

    const accounts: string =
      names.length === 1 ? "their Slack account" : "their Slack accounts";

    const missing: MarkdownText = mdText`👥 ${this.listNames(names)} could not be added to this channel: they have not connected ${accounts} to ${productName} yet.`;

    let whatToDo: MarkdownText = mdText`Add them here yourself, or ask them to connect Slack in ${productName} under **User Settings → Workspace → Slack**.`;

    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      const connectLink: string = URL.fromString(dashboardUrl.toString())
        .addRoute(
          `/${data.projectId.toString()}/user-settings/slack-integration`,
        )
        .addQueryParam(CONNECT_ACCOUNT_QUERY_PARAM, CONNECT_ACCOUNT_QUERY_VALUE)
        .toString();

      whatToDo = mdText`Add them here yourself, or send them this link to connect in one click: [Connect Slack account](${connectLink}).`;
    } catch (err) {
      logger.debug("Could not build the Slack settings link.");
      logger.debug(err);
    }

    return {
      markdown: mdText`${missing} ${whatToDo}`.toString(),
      text: `${this.joinNames(names)} could not be added to this channel`,
    };
  }

  // The note's Markdown (getNote).
  public static async getMarkdown(data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<string> {
    return (await this.getNote(data)).markdown;
  }

  // "**A**", "**A** and **B**", "**A**, **B** and **C**". Names are text.
  private static listNames(names: Array<string>): MarkdownText {
    const bold: Array<MarkdownText> = names.map(
      (name: string): MarkdownText => {
        return mdText`**${name}**`;
      },
    );

    if (bold.length === 1) {
      return bold[0]!;
    }

    return mdText`${FeedMarkdown.join(bold.slice(0, -1), ", ")} and ${bold[bold.length - 1]!}`;
  }

  // "A", "A and B", "A, B and C": the names as plain text.
  private static joinNames(names: Array<string>): string {
    if (names.length <= 1) {
      return names[0] || "";
    }

    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]!}`;
  }

  // The people's names, in the order given: name, else email.
  private static async getNames(
    userIds: Array<string>,
  ): Promise<Array<string>> {
    const users: Array<User> = await UserService.findBy({
      query: {
        _id: QueryHelper.any(
          userIds.map((userId: string): ObjectID => {
            return new ObjectID(userId);
          }),
        ),
      },
      select: {
        _id: true,
        name: true,
        email: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    const names: Array<string> = [];

    for (const userId of userIds) {
      const user: User | undefined = users.find((candidate: User) => {
        return candidate.id?.toString() === userId;
      });

      if (!user) {
        continue;
      }

      const name: string =
        user.name?.toString().trim() || user.email?.toString().trim() || "";

      if (name) {
        names.push(name);
      }
    }

    return names.length > 0 ? names : ["Someone"];
  }

  private static getNamedUserIds(
    keptMessage: WorkspaceLiveMessage | undefined,
  ): Array<string> {
    const userIds: unknown = keptMessage?.messageData?.userIds;

    if (!Array.isArray(userIds)) {
      return [];
    }

    return userIds.filter((userId: unknown): userId is string => {
      return typeof userId === "string" && userId.length > 0;
    });
  }

  private static getUniqueIds(ids: Array<ObjectID>): Array<string> {
    const unique: Array<string> = [];

    for (const id of ids) {
      const value: string = id?.toString() || "";

      if (value && !unique.includes(value)) {
        unique.push(value);
      }
    }

    return unique;
  }
}
