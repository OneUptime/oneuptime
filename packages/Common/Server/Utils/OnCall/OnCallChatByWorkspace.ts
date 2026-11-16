import ObjectID from "../../../Types/ObjectID";
import Timezone from "../../../Types/Timezone";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import OnCallDutyPolicyEscalationRuleSchedule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../Services/OnCallDutyPolicyEscalationRuleScheduleService";
import UserService from "../../Services/UserService";
import WorkspaceProjectAuthTokenService from "../../Services/WorkspaceProjectAuthTokenService";
import logger, { LogAttributes } from "../Logger";
import WorkspaceUtil from "../Workspace/Workspace";
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
 * One of these per change: the project's connected workspaces are read
 * once, and each person's name in each of them asked once, however many
 * lines name them. It never throws: a line it cannot write for a workspace
 * is left out, and that workspace hears the line with OneUptime's names.
 */

// How a person is named in a line.
export type OnCallNameOf = (userId: ObjectID) => Promise<MarkdownText>;

// How one workspace writes a line: its names and its moments.
export interface OnCallChatWriter {
  workspaceType: WorkspaceType;
  nameOf: OnCallNameOf;
  moment: OnCallMomentText;
}

// A line for each connected workspace, as Markdown.
export type OnCallChatTextByWorkspaceType = Partial<
  Record<WorkspaceType, string>
>;

// Who a line names when OneUptime has no name for them.
export const ON_CALL_CHAT_NOBODY_NAMED: string = "Somebody";

export default class OnCallChatByWorkspace {
  private readonly projectId: ObjectID;
  private readonly onCallDutyPolicyId: ObjectID | null;
  private timezone: Promise<Timezone | null> | null;
  private workspaceTypes: Promise<Array<WorkspaceType>> | null = null;
  private readonly names: Map<string, Promise<MarkdownText>> = new Map<
    string,
    Promise<MarkdownText>
  >();

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
   * names them. Asked once for each person in each workspace.
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
    const lines: OnCallChatTextByWorkspaceType = {};

    for (const workspaceType of await this.getWorkspaceTypes()) {
      try {
        const markdown: MarkdownText = await line({
          workspaceType: workspaceType,
          nameOf: this.nameIn(workspaceType),
          moment: await this.getMomentIn(workspaceType),
        });

        if (!markdown.isEmpty()) {
          lines[workspaceType] = markdown.toString();
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

    return lines;
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

  private async readName(
    workspaceType: WorkspaceType | null,
    userId: ObjectID,
  ): Promise<MarkdownText> {
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
