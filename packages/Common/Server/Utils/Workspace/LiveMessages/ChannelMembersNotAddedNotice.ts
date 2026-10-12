import User from "../../../../Models/DatabaseModels/User";
import WorkspaceLiveMessage from "../../../../Models/DatabaseModels/WorkspaceLiveMessage";
import URL from "../../../../Types/API/URL";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
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
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceLiveMessages from "./WorkspaceLiveMessages";

// A channel OneUptime could not add somebody to.
export interface ChannelMembersNotAddedChannel {
  id: string;
  name?: string | undefined;
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
 * In a channel OneUptime has just created, the note comes after the record's
 * own first message ("Incident INC-8 Created"): channel setup hands back who
 * it could not add, and the record's service notes them (noteAll) once that
 * message is posted. So the channel opens on what happened, not on who is
 * missing from it.
 *
 * Slack only. OneUptime never adds people to a Microsoft Teams channel - a
 * standard channel is open to everyone in its team - so connecting a
 * Microsoft Teams account would not add anybody either, and the note would
 * only tell people to do something that changes nothing.
 */
export default class ChannelMembersNotAddedNotice {
  /*
   * Notes everybody channel setup could not add, channel by channel. Never
   * throws: a note that cannot be posted is logged, and the record's other
   * messages go on.
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

    const markdown: string = await this.getMarkdown({
      projectId: data.projectId,
      userIds: named,
    });

    const messageBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: markdown,
    };

    const messageData: WorkspaceLiveMessageData = { userIds: named };

    if (keptMessage) {
      await WorkspaceLiveMessages.updateKept({
        keptMessage: keptMessage,
        messageBlocks: [messageBlock],
        text: "Some people could not be added to this channel",
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
      },
      messageData: messageData,
    });
  }

  /*
   * The note: who could not be added, why, and how to fix it. Names are
   * text: a person's name is theirs to set.
   */
  public static async getMarkdown(data: {
    projectId: ObjectID;
    userIds: Array<string>;
  }): Promise<string> {
    const names: Array<string> = await this.getNames(data.userIds);

    let settingsLink: MarkdownText = mdText`OneUptime under **User Settings → Slack**`;

    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      settingsLink = mdText`[OneUptime → User Settings → Slack](${URL.fromString(
        dashboardUrl.toString(),
      )
        .addRoute(
          `/${data.projectId.toString()}/user-settings/slack-integration`,
        )
        .toString()})`;
    } catch (err) {
      logger.debug("Could not build the Slack settings link.");
      logger.debug(err);
    }

    const people: MarkdownText = FeedMarkdown.join(
      names.map((name: string): MarkdownText => {
        return mdText`**${name}**`;
      }),
      ", ",
    );

    const notConnected: string =
      names.length === 1
        ? "has not connected a Slack account"
        : "have not connected their Slack accounts";

    return mdText`👥 **Not everyone could be added to this channel.** ${people} ${notConnected} to OneUptime, so OneUptime could not add them.

To fix it, they connect Slack in ${settingsLink}, then join this channel or ask someone here to add them.`.toString();
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
