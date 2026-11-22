import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import { WorkspacePayloadMention } from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import User from "../../../Models/DatabaseModels/User";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../Services/OnCallDutyPolicyEscalationRuleScheduleService";
import UserService from "../../Services/UserService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../Services/WorkspaceUserAuthTokenService";
import logger, { LogAttributes } from "../Logger";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import WorkspaceUtil from "../Workspace/Workspace";
import WorkspaceMentions from "../Workspace/WorkspaceMentions";
import WorkspaceMessageTime from "../Workspace/WorkspaceMessageTime";
import { OnCallMomentText } from "./OnCallChatText";

/*
 * AN ON-CALL LINE, AS EACH CONNECTED WORKSPACE READS IT (issues #7549,
 * #7967, #7970).
 *
 * An on-call policy's channels hear of it in one line each: a hand-off
 * (OnCallHandoffPosts), an override added, changed or taken back, a person
 * added to its escalation rules or taken out (OnCallChatText). Each line
 * names its people as each workspace knows them - "@ana.lee" where Ana
 * connected her account there (WorkspaceUtil.getUserStringForWorkspace), her
 * OneUptime name, a link to her page, everywhere else - so one person reads
 * the same in every line of a channel. Only the hand-off lines did; an
 * override's or an escalation rule's named everybody but its author by
 * their OneUptime name.
 *
 * A moment reads in each reader's own zone in Slack and Microsoft Teams
 * (WorkspaceMessageTime.dateAndTime). Mattermost has no way to show one in
 * each reader's zone: there it is said in words on the clock of the zone the
 * policy's shifts are set in (WorkspaceMessageTime.dateAndTimeInZone) - the
 * schedule's, for a hand-off - or in UTC where there is no zone to use.
 *
 * Mattermost breaks every mention a line holds (MattermostUtil
 * .neutralizeMentions), so "@ana.lee" there pings nobody. The policy's feed
 * in OneUptime keeps OneUptime's names: these lines are for chat only.
 *
 * A name pings nobody. A hand-off's line, on a rule that asks for it, may
 * instead mention the person who comes on call (mentionOf, issue #7968):
 * a real mention in each workspace where they connected their account -
 * "<@U0123ABC>", "<at>Ana Lee</at>", "@ana.lee" (WorkspaceMentions) - and
 * their name, as above, everywhere they did not. Nobody who did not
 * connect an account is ever mentioned.
 *
 * One of these per change: the project's connected workspaces are read
 * once, and each person's name in each of them asked once, however many
 * lines name them. It never throws: a line it cannot write for a workspace
 * is left out, and that workspace hears the line with OneUptime's names.
 *
 * SOMEONE ONLY INVITED IS NEVER NAMED BY THEIR EMAIL ADDRESS (#10616). An
 * escalation rule, a schedule's layer, an override or an owner can name
 * someone invited who has not joined the project yet (#10412). A channel
 * can be read by people outside the project - a shared channel, a guest -
 * and so can the policy's feed: its entries are posted to the channels,
 * and workflows and the API take them anywhere. Someone pending has not
 * joined the project, so every on-call line names them by the name typed
 * with their invitation (never their account's own, #9823) and, with no
 * name typed or one that holds an address, as "someone who hasn't joined
 * the project yet" (ON_CALL_CHAT_INVITEE_UNNAMED): the rule a hand-off's
 * coverage gap already followed (#10586). Every on-call line names its
 * people through nameIn - each workspace's line, the line for workspaces
 * with none of their own and the policy's feed (nameIn(null)) alike - so a
 * new line cannot name them any other way (OnCallLinesNamePeopleInOnePlace
 * Guard). Whether someone is only invited is read once per person per
 * change. A member is named as before: by their name, else by the address
 * the project knows them by.
 */

// How a person is named in a line.
export type OnCallNameOf = (userId: ObjectID) => Promise<MarkdownText>;

// How one workspace writes a line: its names and its moments.
export interface OnCallChatWriter {
  workspaceType: WorkspaceType;
  nameOf: OnCallNameOf;
  moment: OnCallMomentText;
  /*
   * A person mentioned - notified - by the account they connected in the
   * workspace (issue #7968); where they connected none, named as nameOf
   * names them. Only for a line that asks for it: a hand-off's person on
   * call, on a rule that wants them mentioned.
   */
  mentionOf: OnCallNameOf;
}

// A line for each connected workspace, as Markdown.
export type OnCallChatTextByWorkspaceType = Partial<
  Record<WorkspaceType, string>
>;

// The people each workspace's line mentions, as its text writes them.
export type OnCallChatMentionsByWorkspaceType = Partial<
  Record<WorkspaceType, Array<WorkspacePayloadMention>>
>;

// A line for each connected workspace, and whom each mentions.
export interface OnCallChatLines {
  lines: OnCallChatTextByWorkspaceType;
  mentions: OnCallChatMentionsByWorkspaceType;
}

// Who a line names when OneUptime has no name for them.
export const ON_CALL_CHAT_NOBODY_NAMED: string = "Somebody";

/*
 * Who a line names for someone only invited to the project when no name
 * was typed with their invitation, or the name typed holds an address
 * (#10616): never their email address.
 */
export const ON_CALL_CHAT_INVITEE_UNNAMED: string =
  "someone who hasn't joined the project yet";

/*
 * Whether somebody a line names is only invited to the project: with the
 * name a line says for them, or not invited. Null when it could not be read.
 */
type OnCallInviteeStanding =
  | { isInvited: true; name: string }
  | {
      isInvited: false;
    }
  | null;

export default class OnCallChatByWorkspace {
  private readonly projectId: ObjectID;
  private readonly onCallDutyPolicyId: ObjectID | null;
  private timezone: Promise<Timezone | null> | null;
  private workspaceTypes: Promise<Array<WorkspaceType>> | null = null;
  private readonly names: Map<string, Promise<MarkdownText>> = new Map<
    string,
    Promise<MarkdownText>
  >();
  private readonly invitees: Map<string, Promise<OnCallInviteeStanding>> =
    new Map<string, Promise<OnCallInviteeStanding>>();
  private readonly mentions: Map<
    string,
    Promise<WorkspacePayloadMention | null>
  > = new Map<string, Promise<WorkspacePayloadMention | null>>();

  public constructor(data: {
    projectId: ObjectID;
    /*
     * The zone the line's shifts are set in, which Mattermost's moments
     * read in: a hand-off's schedule's...
     */
    timezone?: Timezone | null | undefined;
    /*
     * ...or, without one, the zone of the policy's schedules
     * (getPolicyTimezone), read once a Mattermost line is written. A line
     * with no moment - a person added to the policy - needs neither.
     */
    onCallDutyPolicyId?: ObjectID | null | undefined;
  }) {
    this.projectId = data.projectId;
    this.onCallDutyPolicyId = data.onCallDutyPolicyId || null;
    this.timezone =
      data.timezone || !this.onCallDutyPolicyId
        ? Promise.resolve(data.timezone || null)
        : null;
  }

  /*
   * The workspaces the project has connected, read once: where its lines
   * are posted. None when they cannot be read.
   */
  public getWorkspaceTypes(): Promise<Array<WorkspaceType>> {
    if (!this.workspaceTypes) {
      this.workspaceTypes = OnCallChatByWorkspace.readWorkspaceTypes(
        this.projectId,
      );
    }

    return this.workspaceTypes;
  }

  /*
   * How a line for a workspace names a person - "@ana.lee", or OneUptime's
   * name, a link to their page - and, with no workspace, how OneUptime
   * names them: in the line for workspaces with no line of their own, and
   * in the policy's feed. Someone only invited is named the same in all of
   * them: by the name typed for them, else ON_CALL_CHAT_INVITEE_UNNAMED, as
   * text. Asked once for each person in each workspace.
   */
  public nameIn(workspaceType: WorkspaceType | null): OnCallNameOf {
    return (userId: ObjectID): Promise<MarkdownText> => {
      const key: string = `${workspaceType || ""}:${userId.toString().toLowerCase()}`;
      let name: Promise<MarkdownText> | undefined = this.names.get(key);

      if (!name) {
        name = this.readName(workspaceType, userId);
        this.names.set(key, name);
      }

      return name;
    };
  }

  /*
   * How a person is mentioned in a workspace - notified - by the account
   * they connected there (WorkspaceUserAuthToken), as that workspace writes
   * a mention (WorkspaceMentions); null where they connected none, or what
   * it holds is no account of that workspace's. Asked once for each person
   * in each workspace. Never throws: a mention it cannot read is none.
   */
  public mentionIn(
    workspaceType: WorkspaceType,
  ): (userId: ObjectID) => Promise<WorkspacePayloadMention | null> {
    return (userId: ObjectID): Promise<WorkspacePayloadMention | null> => {
      const key: string = `${workspaceType}:${userId.toString().toLowerCase()}`;
      let mention: Promise<WorkspacePayloadMention | null> | undefined =
        this.mentions.get(key);

      if (!mention) {
        mention = this.readMention(workspaceType, userId);
        this.mentions.set(key, mention);
      }

      return mention;
    };
  }

  /*
   * How a line for a workspace says a moment: in Mattermost, on the clock
   * of the line's zone, read once.
   */
  public async getMomentIn(
    workspaceType: WorkspaceType,
  ): Promise<OnCallMomentText> {
    return OnCallChatByWorkspace.momentIn(
      workspaceType,
      workspaceType === WorkspaceType.Mattermost
        ? await this.getTimezone()
        : null,
    );
  }

  /*
   * Each reader's own zone in Slack and Microsoft Teams; in Mattermost, in
   * words on the clock of `timezone`, or of UTC without one.
   */
  public static momentIn(
    workspaceType: WorkspaceType,
    timezone: Timezone | null | undefined,
  ): OnCallMomentText {
    if (workspaceType === WorkspaceType.Mattermost) {
      return (date: Date): MarkdownText => {
        return WorkspaceMessageTime.dateAndTimeInZone(date, timezone);
      };
    }

    return (date: Date): MarkdownText => {
      return WorkspaceMessageTime.dateAndTime(date);
    };
  }

  /*
   * A line for each connected workspace, written with its own names and
   * moments. A workspace whose line could not be written, or came out
   * empty, is left out: it hears the line with OneUptime's names.
   */
  public async write(
    line: (writer: OnCallChatWriter) => Promise<MarkdownText> | MarkdownText,
  ): Promise<OnCallChatTextByWorkspaceType> {
    return (await this.writeWithMentions(line)).lines;
  }

  /*
   * As write, and whom each workspace's line mentions (mentionOf): what its
   * message carries for the workspace to notify them (issue #7968).
   */
  public async writeWithMentions(
    line: (writer: OnCallChatWriter) => Promise<MarkdownText> | MarkdownText,
  ): Promise<OnCallChatLines> {
    const lines: OnCallChatTextByWorkspaceType = {};
    const mentionsByWorkspaceType: OnCallChatMentionsByWorkspaceType = {};

    for (const workspaceType of await this.getWorkspaceTypes()) {
      try {
        const nameOf: OnCallNameOf = this.nameIn(workspaceType);
        const mentioned: Array<WorkspacePayloadMention> = [];

        const markdown: MarkdownText = await line({
          workspaceType: workspaceType,
          nameOf: nameOf,
          moment: await this.getMomentIn(workspaceType),
          mentionOf: async (userId: ObjectID): Promise<MarkdownText> => {
            const mention: WorkspacePayloadMention | null =
              await this.mentionIn(workspaceType)(userId);

            if (!mention) {
              return await nameOf(userId);
            }

            if (
              !mentioned.some((known: WorkspacePayloadMention): boolean => {
                return known.text === mention.text;
              })
            ) {
              mentioned.push(mention);
            }

            // Written by OneUptime from the account's own id: no escaping.
            return FeedMarkdown.asMarkdown(mention.text);
          },
        });

        if (!markdown.isEmpty()) {
          lines[workspaceType] = markdown.toString();

          if (mentioned.length > 0) {
            mentionsByWorkspaceType[workspaceType] = mentioned;
          }
        }
      } catch (err) {
        logger.error(`Could not write an on-call line for ${workspaceType}.`, {
          projectId: this.projectId.toString(),
        } as LogAttributes);
        logger.error(err, {
          projectId: this.projectId.toString(),
        } as LogAttributes);
      }
    }

    return { lines: lines, mentions: mentionsByWorkspaceType };
  }

  /*
   * A name an on-call line may say of somebody it must never name by their
   * email address: trimmed, and none when it is empty or holds an address -
   * an inviter can type one as the name (#10586).
   */
  public static getDisplayName(name: string | null | undefined): string {
    const trimmed: string = (name || "").trim();

    return trimmed.includes("@") ? "" : trimmed;
  }

  /*
   * How every on-call line names someone only invited to the project
   * (#10616): the name typed with their invitation, else "someone who
   * hasn't joined the project yet" - never an address.
   */
  public static getInviteeName(profile: WithheldProfile): string {
    return (
      OnCallChatByWorkspace.getDisplayName(profile.inviteeName) ||
      ON_CALL_CHAT_INVITEE_UNNAMED
    );
  }

  /*
   * The zone a policy's shifts are set in, for its lines: the zone of the
   * schedules its escalation rules page, when they all share one. Null when
   * it pages no schedule, its schedules are set in different zones, or they
   * cannot be read.
   */
  public static async getPolicyTimezone(
    onCallDutyPolicyId: ObjectID,
  ): Promise<Timezone | null> {
    try {
      const rows: Array<OnCallDutyPolicyEscalationRuleSchedule> =
        await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
          query: {
            onCallDutyPolicyId: onCallDutyPolicyId,
          },
          select: {
            onCallDutyPolicySchedule: {
              timezone: true,
            },
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const zones: Set<string> = new Set<string>();

      for (const row of rows) {
        // A schedule set in no zone of its own hands off in UTC.
        zones.add(
          row.onCallDutyPolicySchedule?.timezone?.toString() || Timezone.UTC,
        );
      }

      return zones.size === 1 ? (Array.from(zones)[0] as Timezone) : null;
    } catch (err) {
      logger.error("Could not read the time zone of an on-call policy.", {
        onCallDutyPolicyId: onCallDutyPolicyId.toString(),
      } as LogAttributes);
      logger.error(err, {
        onCallDutyPolicyId: onCallDutyPolicyId.toString(),
      } as LogAttributes);

      return null;
    }
  }

  // The line's zone: given, or its policy's, read once.
  private getTimezone(): Promise<Timezone | null> {
    if (!this.timezone) {
      this.timezone = this.onCallDutyPolicyId
        ? OnCallChatByWorkspace.getPolicyTimezone(this.onCallDutyPolicyId)
        : Promise.resolve(null);
    }

    return this.timezone;
  }

  private static async readWorkspaceTypes(
    projectId: ObjectID,
  ): Promise<Array<WorkspaceType>> {
    try {
      const projectAuths: Array<WorkspaceProjectAuthToken> =
        (await WorkspaceProjectAuthTokenService.getProjectAuths({
          projectId: projectId,
        })) || [];

      const workspaceTypes: Array<WorkspaceType> = [];

      for (const projectAuth of projectAuths) {
        if (
          projectAuth.authToken &&
          projectAuth.workspaceType &&
          !workspaceTypes.includes(projectAuth.workspaceType)
        ) {
          workspaceTypes.push(projectAuth.workspaceType);
        }
      }

      return workspaceTypes;
    } catch (err) {
      logger.error("Could not read the project's connected workspaces.", {
        projectId: projectId.toString(),
      } as LogAttributes);
      logger.error(err, {
        projectId: projectId.toString(),
      } as LogAttributes);

      return [];
    }
  }

  private async readMention(
    workspaceType: WorkspaceType,
    userId: ObjectID,
  ): Promise<WorkspacePayloadMention | null> {
    try {
      const connection: WorkspaceUserAuthToken | null =
        await WorkspaceUserAuthTokenService.getUserAuth({
          projectId: this.projectId,
          userId: userId,
          workspaceType: workspaceType,
        });

      if (!connection?.workspaceUserId) {
        return null;
      }

      const stored: (field: string) => string = (field: string): string => {
        const value: unknown = connection.miscData?.[field];

        return typeof value === "string" ? value.trim() : "";
      };

      /*
       * The name the mention shows: Mattermost's is the username it reads
       * the mention by; a Teams card's, the display name the account had
       * when it was connected; else OneUptime's, as a log names them.
       */
      const name: string =
        workspaceType === WorkspaceType.Mattermost
          ? stored("username")
          : (workspaceType === WorkspaceType.MicrosoftTeams
              ? stored("displayName")
              : "") || (await this.readOneUptimeName(userId));

      return WorkspaceMentions.getMention({
        workspaceType: workspaceType,
        workspaceUserId: connection.workspaceUserId,
        name: name,
      });
    } catch (err) {
      logger.error(
        `Could not read the ${workspaceType} account to mention somebody on call.`,
        { projectId: this.projectId.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: this.projectId.toString(),
      } as LogAttributes);

      return null;
    }
  }

  // A person's name in OneUptime: their name, else their email address.
  private async readOneUptimeName(userId: ObjectID): Promise<string> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    return user?.name?.toString() || user?.email?.toString() || "";
  }

  /*
   * Whether somebody is only invited to the project, read once for every
   * line and workspace of the change.
   */
  private getInviteeStanding(userId: ObjectID): Promise<OnCallInviteeStanding> {
    const key: string = userId.toString().toLowerCase();
    let standing: Promise<OnCallInviteeStanding> | undefined =
      this.invitees.get(key);

    if (!standing) {
      standing = this.readInviteeStanding(userId);
      this.invitees.set(key, standing);
    }

    return standing;
  }

  private async readInviteeStanding(
    userId: ObjectID,
  ): Promise<OnCallInviteeStanding> {
    try {
      const withheld: Map<string, WithheldProfile> =
        await PendingInviteeProfiles.readWithheldProfilesInProject({
          userIds: [userId.toString()],
          projectId: this.projectId,
        });

      const profile: WithheldProfile | undefined =
        PendingInviteeProfiles.getWithheldProfile({
          userId: userId,
          withheld: withheld,
        });

      return profile
        ? {
            isInvited: true,
            name: OnCallChatByWorkspace.getInviteeName(profile),
          }
        : { isInvited: false };
    } catch (err) {
      logger.error(
        "Could not read whether somebody an on-call line names is only invited to the project; the line names them as Somebody.",
        { projectId: this.projectId.toString() } as LogAttributes,
      );
      logger.error(err, {
        projectId: this.projectId.toString(),
      } as LogAttributes);

      return null;
    }
  }

  private async readName(
    workspaceType: WorkspaceType | null,
    userId: ObjectID,
  ): Promise<MarkdownText> {
    const invitee: OnCallInviteeStanding =
      await this.getInviteeStanding(userId);

    // Unread, they may be only invited: no name that could be their address.
    if (!invitee) {
      return mdText`${ON_CALL_CHAT_NOBODY_NAMED}`;
    }

    // As text: the name the inviter typed links nowhere and mentions nobody.
    if (invitee.isInvited) {
      return mdText`${invitee.name}`;
    }

    const name: string = workspaceType
      ? (
          await WorkspaceUtil.getUserStringForWorkspace({
            userId: userId,
            projectId: this.projectId,
            workspaceType: workspaceType,
          })
        ).trim()
      : (
          await UserService.getUserMarkdownString({
            userId: userId,
            projectId: this.projectId,
          })
        ).toString();

    return name
      ? FeedMarkdown.asMarkdown(name)
      : mdText`${ON_CALL_CHAT_NOBODY_NAMED}`;
  }
}
