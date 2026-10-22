import User from "../../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import { LIMIT_PER_PROJECT } from "../../../../Types/Database/LimitMax";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { WorkspacePayloadMarkdown } from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import UserService from "../../../Services/UserService";
import WorkspaceNotificationRuleService, {
  NotificationFor,
} from "../../../Services/WorkspaceNotificationRuleService";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { WorkspaceUserGroupPerson } from "../UserGroups/WorkspaceUserGroupProvider";
import WorkspaceBase, {
  WorkspaceSendMessageResponse,
  WorkspaceThread,
} from "../WorkspaceBase";
import { ScheduleOnCallPerson } from "../WorkspaceScheduleOnCall";
import MicrosoftTeamsUtil, {
  MicrosoftTeamsRosterMember,
} from "./MicrosoftTeams";
import MicrosoftTeamsActionAnswer from "./MicrosoftTeamsActionAnswer";
import MicrosoftTeamsTags from "./MicrosoftTeamsTags";

/*
 * WHOEVER IS ON CALL, @MENTIONED IN A NEW MICROSOFT TEAMS CHANNEL.
 *
 * A rule that creates a channel for each record can name on-call schedules:
 * whoever is on call in them when the channel is created joins it
 * (WorkspaceScheduleOnCall). Slack adds them to the channel. Microsoft Teams
 * adds nobody to a channel - a standard channel is open to everyone in its
 * team, and changing a channel's members would take Microsoft Graph's
 * ChannelMember permissions in every tenant - so the channel gets one
 * message that @mentions them instead, and Teams notifies each of them:
 *
 *   📟 On call now: @Jane Doe (Payments Primary) and @Raj Patel (Payments
 *   Secondary).
 *
 * Somebody is found in the channel's team as an on-call tag finds them
 * (MicrosoftTeamsTags.findPerson): the Teams account they connected to
 * OneUptime, or else the team member with their OneUptime email address.
 * The team's roster comes from OneUptime's bot, so no Graph permission is
 * needed; when it cannot be read, only connected accounts are mentioned.
 * Somebody not found in the team cannot open its channels, so they are
 * named, not mentioned, and the message says so:
 *
 *   Alex Kim (Database) is on call too, but is not in this team, so
 *   Microsoft Teams cannot show them this channel.
 *
 * The message comes after the record's own first message, as Slack's note
 * of who could not be added does (ChannelMembersNotAddedNotice.noteAll), and
 * is logged against the record with its other messages.
 */

// The most people one message names: a mention is a name, not a roster.
export const MICROSOFT_TEAMS_ON_CALL_MAX_NAMED: number = 25;

// The most schedules named after one person.
const MAX_SCHEDULE_NAMES_PER_PERSON: number = 5;

// A schedule's name is cut to this, as a mention's name is.
const SCHEDULE_NAME_MAX_LENGTH: number = 100;

// A channel the message goes to.
export interface MicrosoftTeamsOnCallMentionChannel {
  id: string;
  name?: string | undefined;
  // The channel's team, by its Microsoft Graph id: what posting to it takes.
  teamId?: string | undefined;
}

// Somebody on call, as the message names them.
export interface MicrosoftTeamsOnCallPerson {
  // Their name: the team's, when they are found in it, else OneUptime's.
  name: string;
  scheduleNames: Array<string>;
  // Their Microsoft Entra object id, to mention them by; null: not in the team.
  aadObjectId: string | null;
}

// The message: the card Teams is sent, and what is shown and logged of it.
export interface MicrosoftTeamsOnCallMessage {
  card: JSONObject;
  // What a notification and the activity feed show: plain text.
  summary: string;
  // The message as Notification Logs list it: names in bold, not mentions.
  markdown: string;
}

export default class MicrosoftTeamsOnCallMention {
  /*
   * Mentions whoever is on call in each channel. Never throws: a message
   * that cannot be sent is logged, and the record's other messages go on.
   */
  @CaptureSpan()
  public static async mentionInChannels(data: {
    projectId: ObjectID;
    channels: Array<MicrosoftTeamsOnCallMentionChannel>;
    people: Array<ScheduleOnCallPerson>;
    notificationFor?: NotificationFor | undefined;
  }): Promise<void> {
    if (data.people.length === 0 || data.channels.length === 0) {
      return;
    }

    try {
      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.getProjectAuth({
          projectId: data.projectId,
          workspaceType: WorkspaceType.MicrosoftTeams,
        });

      if (!projectAuth?.authToken) {
        return;
      }

      const people: Array<WorkspaceUserGroupPerson & { name: string }> =
        await MicrosoftTeamsOnCallMention.getPeople({
          projectId: data.projectId,
          userIds: data.people.map((person: ScheduleOnCallPerson): ObjectID => {
            return person.userId;
          }),
        });

      // A team's roster, read once for its channels.
      const rosters: Map<
        string,
        Promise<Array<MicrosoftTeamsRosterMember> | null>
      > = new Map<string, Promise<Array<MicrosoftTeamsRosterMember> | null>>();

      const seenChannelIds: Set<string> = new Set<string>();

      for (const channel of data.channels) {
        if (!channel.id || !channel.teamId || seenChannelIds.has(channel.id)) {
          continue;
        }

        seenChannelIds.add(channel.id);

        const teamId: string = channel.teamId;

        let roster:
          | Promise<Array<MicrosoftTeamsRosterMember> | null>
          | undefined = rosters.get(teamId);

        if (!roster) {
          roster = MicrosoftTeamsOnCallMention.getRoster({
            projectId: data.projectId,
            teamId: teamId,
          });
          rosters.set(teamId, roster);
        }

        const message: MicrosoftTeamsOnCallMessage | null =
          MicrosoftTeamsOnCallMention.buildMessage({
            people: MicrosoftTeamsOnCallMention.findInTeam({
              onCall: data.people,
              people: people,
              roster: await roster,
            }),
          });

        if (!message) {
          continue;
        }

        await MicrosoftTeamsOnCallMention.send({
          projectId: data.projectId,
          authToken: projectAuth.authToken,
          channel: channel,
          teamId: teamId,
          message: message,
          notificationFor: data.notificationFor,
        });
      }
    } catch (err) {
      logger.error(
        "Could not mention who is on call in the new Microsoft Teams channels.",
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
    }
  }

  /*
   * The people on call as one team knows them: each with the schedules they
   * are on call in, mentioned by the team member they are, or - not found
   * in the team - named by their OneUptime name. Without a roster, the
   * Teams account somebody connected is mentioned as it is.
   */
  public static findInTeam(data: {
    onCall: Array<ScheduleOnCallPerson>;
    people: Array<WorkspaceUserGroupPerson & { name: string }>;
    roster: Array<MicrosoftTeamsRosterMember> | null;
  }): Array<MicrosoftTeamsOnCallPerson> {
    const found: Array<MicrosoftTeamsOnCallPerson> = [];

    for (const onCall of data.onCall) {
      const key: string = onCall.userId.toString().toLowerCase();

      const person: (WorkspaceUserGroupPerson & { name: string }) | undefined =
        data.people.find(
          (candidate: WorkspaceUserGroupPerson & { name: string }): boolean => {
            return candidate.userId.toString().toLowerCase() === key;
          },
        );

      if (!person) {
        continue;
      }

      let name: string = person.name;
      let aadObjectId: string | null = null;

      if (data.roster) {
        const member: MicrosoftTeamsRosterMember | null =
          MicrosoftTeamsTags.findPerson({
            roster: data.roster,
            person: person,
          });

        if (member) {
          aadObjectId = member.aadObjectId;
          name = member.name || name;
        }
      } else if (person.connectedWorkspaceUserId) {
        aadObjectId = person.connectedWorkspaceUserId;
      }

      found.push({
        name: name,
        scheduleNames: onCall.scheduleNames,
        aadObjectId: aadObjectId,
      });
    }

    return found;
  }

  /*
   * The message: who is mentioned, then who is on call but not in the team,
   * then how many more there are when there are more than one message
   * names. Null when it names nobody.
   */
  public static buildMessage(data: {
    people: Array<MicrosoftTeamsOnCallPerson>;
  }): MicrosoftTeamsOnCallMessage | null {
    const named: Array<MicrosoftTeamsOnCallPerson> = data.people.slice(
      0,
      MICROSOFT_TEAMS_ON_CALL_MAX_NAMED,
    );

    const notNamedCount: number = data.people.length - named.length;

    const inTeam: Array<
      MicrosoftTeamsOnCallPerson & { mentionName: string; aadObjectId: string }
    > = [];
    const notInTeam: Array<MicrosoftTeamsOnCallPerson> = [];

    for (const person of named) {
      /*
       * Left without the characters the card's Markdown or the <at> tag
       * would read (MicrosoftTeamsActionAnswer.getMentionName): Teams matches
       * the tag's text against the mention's, so the name is the same in
       * both, and mdText has nothing left in it to escape.
       */
      const mentionName: string = MicrosoftTeamsActionAnswer.getMentionName(
        person.name,
      );

      if (person.aadObjectId && mentionName) {
        inTeam.push({
          ...person,
          mentionName: mentionName,
          aadObjectId: person.aadObjectId,
        });
      } else {
        notInTeam.push(person);
      }
    }

    if (inTeam.length === 0 && notInTeam.length === 0) {
      return null;
    }

    const cardLines: Array<MarkdownText> = [];
    const logLines: Array<MarkdownText> = [];

    if (inTeam.length > 0) {
      cardLines.push(
        mdText`📟 On call now: ${MicrosoftTeamsOnCallMention.listPeople(
          inTeam.map(
            (
              person: MicrosoftTeamsOnCallPerson & { mentionName: string },
            ): MarkdownText => {
              return mdText`<at>${person.mentionName}</at>${MicrosoftTeamsOnCallMention.getSchedulesText(person)}`;
            },
          ),
        )}.`,
      );

      logLines.push(
        mdText`📟 On call now: ${MicrosoftTeamsOnCallMention.listPeople(
          inTeam.map((person: MicrosoftTeamsOnCallPerson): MarkdownText => {
            return mdText`**${person.name}**${MicrosoftTeamsOnCallMention.getSchedulesText(person)}`;
          }),
        )}.`,
      );
    }

    if (notInTeam.length > 0) {
      const names: MarkdownText = MicrosoftTeamsOnCallMention.listPeople(
        notInTeam.map((person: MicrosoftTeamsOnCallPerson): MarkdownText => {
          return mdText`**${person.name}**${MicrosoftTeamsOnCallMention.getSchedulesText(person)}`;
        }),
      );

      const line: MarkdownText =
        notInTeam.length === 1
          ? inTeam.length > 0
            ? mdText`${names} is on call too, but is not in this team, so Microsoft Teams cannot show them this channel.`
            : mdText`${names} is on call, but is not in this team, so Microsoft Teams cannot show them this channel.`
          : inTeam.length > 0
            ? mdText`${names} are on call too, but are not in this team, so Microsoft Teams cannot show them this channel.`
            : mdText`${names} are on call, but are not in this team, so Microsoft Teams cannot show them this channel.`;

      cardLines.push(line);
      logLines.push(line);
    }

    if (notNamedCount > 0) {
      const line: MarkdownText =
        notNamedCount === 1
          ? mdText`1 more person is on call.`
          : mdText`${notNamedCount.toString()} more people are on call.`;

      cardLines.push(line);
      logLines.push(line);
    }

    const card: JSONObject = {
      type: "AdaptiveCard",
      $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
      version: "1.5",
      body: cardLines.map((line: MarkdownText): JSONObject => {
        return {
          type: "TextBlock",
          text: line.toString(),
          wrap: true,
        };
      }),
    };

    if (inTeam.length > 0) {
      card["msteams"] = {
        entities: inTeam.map(
          (person: {
            mentionName: string;
            aadObjectId: string;
          }): JSONObject => {
            return {
              type: "mention",
              text: `<at>${person.mentionName}</at>`,
              mentioned: {
                id: person.aadObjectId,
                name: person.mentionName,
              },
            };
          },
        ),
      };
    }

    const summaryNames: Array<string> = [...inTeam, ...notInTeam].map(
      (person: MicrosoftTeamsOnCallPerson): string => {
        return person.name;
      },
    );

    return {
      card: card,
      summary: `On call now: ${summaryNames.join(", ")}`,
      markdown: FeedMarkdown.join(logLines, "\n\n").toString(),
    };
  }

  // " (Payments Primary, Database)", or nothing for a schedule without a name.
  private static getSchedulesText(
    person: MicrosoftTeamsOnCallPerson,
  ): MarkdownText {
    const scheduleNames: Array<string> = person.scheduleNames
      .map((scheduleName: string): string => {
        return scheduleName.trim().substring(0, SCHEDULE_NAME_MAX_LENGTH);
      })
      .filter((scheduleName: string): boolean => {
        return Boolean(scheduleName);
      });

    if (scheduleNames.length === 0) {
      return mdText``;
    }

    const shown: Array<string> = scheduleNames.slice(
      0,
      MAX_SCHEDULE_NAMES_PER_PERSON,
    );

    const more: number = scheduleNames.length - shown.length;

    return more > 0
      ? mdText` (${FeedMarkdown.join(shown, ", ")} and ${more.toString()} more)`
      : mdText` (${FeedMarkdown.join(shown, ", ")})`;
  }

  // "A", "A and B", "A, B and C".
  private static listPeople(people: Array<MarkdownText>): MarkdownText {
    if (people.length === 1) {
      return people[0]!;
    }

    return mdText`${FeedMarkdown.join(people.slice(0, -1), ", ")} and ${people[people.length - 1]!}`;
  }

  // The people's names, email addresses and connected Teams accounts.
  private static async getPeople(data: {
    projectId: ObjectID;
    userIds: Array<ObjectID>;
  }): Promise<Array<WorkspaceUserGroupPerson & { name: string }>> {
    if (data.userIds.length === 0) {
      return [];
    }

    const [users, connections]: [Array<User>, Array<WorkspaceUserAuthToken>] =
      await Promise.all([
        UserService.findBy({
          query: {
            _id: QueryHelper.any(data.userIds),
          },
          select: {
            _id: true,
            name: true,
            email: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
        WorkspaceUserAuthTokenService.findBy({
          query: {
            projectId: data.projectId,
            workspaceType: WorkspaceType.MicrosoftTeams,
            userId: QueryHelper.any(data.userIds),
          },
          select: {
            userId: true,
            workspaceUserId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
      ]);

    const people: Array<WorkspaceUserGroupPerson & { name: string }> = [];

    for (const userId of data.userIds) {
      const key: string = userId.toString().toLowerCase();

      const user: User | undefined = users.find((candidate: User): boolean => {
        return candidate.id?.toString().toLowerCase() === key;
      });

      if (!user) {
        continue;
      }

      const connection: WorkspaceUserAuthToken | undefined = connections.find(
        (candidate: WorkspaceUserAuthToken): boolean => {
          return candidate.userId?.toString().toLowerCase() === key;
        },
      );

      const email: string = user.email?.toString().trim() || "";

      people.push({
        userId: userId,
        email: email,
        connectedWorkspaceUserId: connection?.workspaceUserId || null,
        name: user.name?.toString().trim() || email || "Someone",
      });
    }

    return people;
  }

  // The team's members, or null when the bot cannot read them.
  private static async getRoster(data: {
    projectId: ObjectID;
    teamId: string;
  }): Promise<Array<MicrosoftTeamsRosterMember> | null> {
    try {
      return await MicrosoftTeamsUtil.getTeamRoster({
        projectId: data.projectId,
        teamId: data.teamId,
      });
    } catch (err) {
      logger.error(
        "Could not read a Microsoft Teams team's members to mention who is on call: only connected accounts are mentioned.",
        { projectId: data.projectId.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
      return null;
    }
  }

  // Sends the message to one channel, and logs it against the record.
  private static async send(data: {
    projectId: ObjectID;
    authToken: string;
    channel: MicrosoftTeamsOnCallMentionChannel;
    teamId: string;
    message: MicrosoftTeamsOnCallMessage;
    notificationFor?: NotificationFor | undefined;
  }): Promise<void> {
    const response: WorkspaceSendMessageResponse = {
      threads: [],
      workspaceType: WorkspaceType.MicrosoftTeams,
      errors: [],
    };

    const channel: {
      id: string;
      name: string;
      workspaceType: WorkspaceType;
      teamId: string;
    } = {
      id: data.channel.id,
      name: data.channel.name || data.channel.id,
      workspaceType: WorkspaceType.MicrosoftTeams,
      teamId: data.teamId,
    };

    try {
      const thread: WorkspaceThread =
        await MicrosoftTeamsUtil.sendAdaptiveCardToChannel({
          authToken: data.authToken,
          teamId: data.teamId,
          workspaceChannel: channel,
          adaptiveCard: data.message.card,
          projectId: data.projectId,
          summary: data.message.summary,
        });

      response.threads.push(thread);
    } catch (err) {
      logger.error(
        "Could not mention who is on call in a new Microsoft Teams channel.",
        {
          projectId: data.projectId.toString(),
          channelId: data.channel.id,
        } as LogAttributes,
      );
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);

      response.errors!.push({
        channel: channel,
        error: WorkspaceBase.getSendErrorMessage(err),
      });
    }

    if (!data.notificationFor) {
      return;
    }

    try {
      const messageBlock: WorkspacePayloadMarkdown = {
        _type: "WorkspacePayloadMarkdown",
        text: data.message.markdown,
      };

      await WorkspaceNotificationRuleService.logSendResponses({
        projectId: data.projectId,
        notificationFor: data.notificationFor,
        responses: [response],
        messageBlocksByWorkspaceTypes: [
          {
            workspaceType: WorkspaceType.MicrosoftTeams,
            messageBlocks: [messageBlock],
          },
        ],
      });
    } catch (err) {
      logger.error("Could not log a Microsoft Teams message.", {
        projectId: data.projectId.toString(),
      } as LogAttributes);
      logger.error(err, {
        projectId: data.projectId.toString(),
      } as LogAttributes);
    }
  }
}
