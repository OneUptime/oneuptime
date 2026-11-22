import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../DatabaseConfig";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import logger from "../Logger";
import OnCallChatByWorkspace from "../OnCall/OnCallChatByWorkspace";
import OnCallChatText, {
  OnCallNotPagedBecause,
} from "../OnCall/OnCallChatText";
import ProductBrandingText from "../ProductBrandingText";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../TeamMember/PendingInviteeProfiles";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceMessageTime from "./WorkspaceMessageTime";

/*
 * WHO IS ON CALL RIGHT NOW: `/oneuptime oncall` in Slack, "oncall" typed to
 * the Microsoft Teams bot.
 *
 *   👥 On call now
 *   • Database: nobody right now. Ana Ruiz is next, from Mon at 9:00 AM.
 *   • Primary: Simon Lee until Fri at 9:00 AM, then Ana Ruiz.
 *   • Secondary: Ana Ruiz (you) until Mon at 9:00 AM, then Jo Park.
 *   Open the on-call schedules in OneUptime
 *
 * Read from each on-call schedule's roster - who is on call, until when,
 * and who is next - which OneUptime refreshes every minute with overrides
 * and people who are away applied (the RefreshHandoffTime job), and which
 * the schedules list in OneUptime shows as On Call Now. So the chat and
 * OneUptime name the same person. One read, with the asker's own
 * permissions: the schedules they may read, as in OneUptime. Moments read
 * in each reader's own time (WorkspaceMessageTime); names are text.
 *
 * Microsoft Teams posts the answer in the conversation it was asked in, a
 * channel included. So someone only invited to the project (#10412) is
 * named as every on-call line names them (#10616): by the name typed with
 * their invitation, else "someone who hasn't joined the project yet" -
 * never their email address (OnCallChatByWorkspace.getInviteeName). And
 * nothing pages them until they join, so their turn is said as the gap it
 * is, in the words the schedule's hand-off said it in (#10586):
 *
 *   • Primary: nobody is paged until Fri at 9:00 AM, when Ana Ruiz takes
 *     over: Ivy is on call but hasn't joined the project yet.
 *   • Secondary: Simon Lee until Fri at 9:00 AM, then nobody: Ivy is next
 *     but hasn't joined the project yet.
 */

interface ScheduleRow {
  name: string;
  link: string | null;
  current: Person | null;
  next: Person | null;
  handoffAt: Date | null;
  nextStartAt: Date | null;
}

interface Person {
  id: string;
  name: string;
  /*
   * Only invited to the project: nothing pages them until they join. With
   * the name typed for them, which a line may say - "" for none.
   */
  invitee: { displayName: string } | null;
}

export default class WorkspaceOnCallNow {
  // How many schedules an answer lists; it links to the rest.
  public static readonly MAX_SCHEDULES: number = 20;

  /*
   * How many schedules a notification of the answer names - Teams shows it
   * in the activity feed, Slack when the answer comes by direct message -
   * before "and N more".
   */
  public static readonly MAX_SCHEDULES_IN_NOTIFICATION: number = 3;

  /*
   * Who is on call now in each schedule `props` may read, in name order.
   * A member who may not read schedules is told so. Throws only when the
   * read fails for another reason.
   */
  @CaptureSpan()
  public static async getOnCallNowAnswer(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceAnswer> {
    let schedules: Array<OnCallDutyPolicySchedule>;

    try {
      schedules = await OnCallDutyPolicyScheduleService.findBy({
        query: {
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
          currentUserOnRoster: {
            _id: true,
            name: true,
            email: true,
          },
          nextUserOnRoster: {
            _id: true,
            name: true,
            email: true,
          },
          rosterHandoffAt: true,
          rosterNextStartAt: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
        limit: WorkspaceOnCallNow.MAX_SCHEDULES + 1,
        skip: 0,
        props: data.props,
      });
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }

      const message: string =
        "You do not have permission to see the on-call schedules in this project. Ask a Project Admin for access to them.";

      return {
        markdown: mdText`${message}`.toString(),
        text: message,
      };
    }

    const dashboardUrl: URL | null = await WorkspaceOnCallNow.getDashboardUrl();

    const listed: Array<OnCallDutyPolicySchedule> = schedules.slice(
      0,
      WorkspaceOnCallNow.MAX_SCHEDULES,
    );

    // Who of them is only invited: one read for the answer (#10616).
    const invited: Map<string, WithheldProfile> =
      await WorkspaceOnCallNow.readInvited({
        projectId: data.projectId,
        schedules: listed,
      });

    const rows: Array<ScheduleRow> = listed.map(
      (schedule: OnCallDutyPolicySchedule): ScheduleRow => {
        return {
          name: schedule.name?.toString().trim() || "Unnamed schedule",
          link:
            dashboardUrl && schedule.id
              ? WorkspaceOnCallNow.getScheduleLink(
                  dashboardUrl,
                  data.projectId,
                  schedule.id,
                )
              : null,
          current: WorkspaceOnCallNow.toPerson(
            schedule.currentUserOnRoster,
            invited,
          ),
          next: WorkspaceOnCallNow.toPerson(schedule.nextUserOnRoster, invited),
          handoffAt: schedule.rosterHandoffAt
            ? new Date(schedule.rosterHandoffAt)
            : null,
          nextStartAt: schedule.rosterNextStartAt
            ? new Date(schedule.rosterNextStartAt)
            : null,
        };
      },
    );

    const schedulesLink: string | null = dashboardUrl
      ? WorkspaceOnCallNow.getSchedulesLink(dashboardUrl, data.projectId)
      : null;

    const productName: string = ProductBrandingText.getProductName();

    /*
     * Said as the schedules list in OneUptime says it, which shows each
     * person the schedules they may read too.
     */
    if (rows.length === 0) {
      return {
        markdown: (schedulesLink
          ? mdText`👥 **No on-call schedules yet.** [Add one in ${productName}](${schedulesLink}) under On-Call → On-Call Schedules.`
          : mdText`👥 **No on-call schedules yet.** Add one in ${productName} under On-Call → On-Call Schedules.`
        ).toString(),
        text: "No on-call schedules yet",
      };
    }

    const lines: Array<MarkdownText> = [mdText`👥 **On call now**`];

    for (const row of rows) {
      lines.push(
        WorkspaceOnCallNow.getRowLine(row, data.props.userId?.toString()),
      );
    }

    const isCut: boolean = schedules.length > WorkspaceOnCallNow.MAX_SCHEDULES;

    /*
     * After a blank line: a line right after the list would be read as part
     * of its last item.
     */
    if (schedulesLink) {
      lines.push(FeedMarkdown.empty());
      lines.push(
        isCut
          ? mdText`These are the first ${WorkspaceOnCallNow.MAX_SCHEDULES} schedules. [See them all in ${productName}](${schedulesLink}).`
          : mdText`[Open the on-call schedules in ${productName}](${schedulesLink})`,
      );
    } else if (isCut) {
      lines.push(FeedMarkdown.empty());
      lines.push(
        mdText`These are the first ${WorkspaceOnCallNow.MAX_SCHEDULES} schedules. See them all in ${productName}, under On-Call → On-Call Schedules.`,
      );
    }

    return {
      markdown: FeedMarkdown.join(lines, "\n").toString(),
      text: WorkspaceOnCallNow.getNotificationText(rows, isCut),
    };
  }

  /*
   * "• Primary: Simon Lee until Fri at 9:00 AM, then Ana Ruiz." - the
   * schedule's name links to it. Someone only invited is no one on call:
   * nobody is paged through the schedule in their turn (#10586).
   */
  private static getRowLine(
    row: ScheduleRow,
    readerUserId: string | undefined,
  ): MarkdownText {
    const schedule: MarkdownText = row.link
      ? mdText`[${row.name}](${row.link})`
      : mdText`${row.name}`;

    if (!row.current) {
      if (row.next && row.nextStartAt && row.next.invitee) {
        return mdText`- ${schedule}: nobody right now, and nobody will be paged from ${WorkspaceMessageTime.dateAndTime(
          row.nextStartAt,
        )} either: ${WorkspaceOnCallNow.getWhyNotPaged(row.next, true)}.`;
      }

      if (row.next && row.nextStartAt) {
        return mdText`- ${schedule}: nobody right now. ${WorkspaceOnCallNow.getPersonMarkdown(
          row.next,
          readerUserId,
        )} is next, from ${WorkspaceMessageTime.dateAndTime(row.nextStartAt)}.`;
      }

      return mdText`- ${schedule}: nobody right now.`;
    }

    const isNextSomebodyElse: boolean = Boolean(
      row.next && row.next.id !== row.current.id,
    );

    if (row.current.invitee) {
      return WorkspaceOnCallNow.getNobodyPagedLine({
        row: row,
        schedule: schedule,
        // Who takes over then: somebody a page reaches.
        next:
          isNextSomebodyElse && !row.next!.invitee
            ? WorkspaceOnCallNow.getPersonMarkdown(row.next!, readerUserId)
            : null,
      });
    }

    const current: MarkdownText = WorkspaceOnCallNow.getPersonMarkdown(
      row.current,
      readerUserId,
    );

    if (row.handoffAt && isNextSomebodyElse && row.next!.invitee) {
      return mdText`- ${schedule}: ${current} until ${WorkspaceMessageTime.dateAndTime(
        row.handoffAt,
      )}, then nobody: ${WorkspaceOnCallNow.getWhyNotPaged(row.next!, true)}.`;
    }

    if (row.handoffAt && isNextSomebodyElse) {
      return mdText`- ${schedule}: ${current} until ${WorkspaceMessageTime.dateAndTime(
        row.handoffAt,
      )}, then ${row.next!.name}${
        readerUserId && row.next!.id === readerUserId ? " (you)" : ""
      }.`;
    }

    if (row.handoffAt) {
      return mdText`- ${schedule}: ${current} until ${WorkspaceMessageTime.dateAndTime(
        row.handoffAt,
      )}.`;
    }

    return mdText`- ${schedule}: ${current}.`;
  }

  /*
   * A turn of someone only invited: "• Primary: nobody is paged until Fri
   * at 9:00 AM, when Ana Ruiz takes over: Ivy is on call but hasn't joined
   * the project yet."
   */
  private static getNobodyPagedLine(data: {
    row: ScheduleRow;
    schedule: MarkdownText;
    next: MarkdownText | null;
  }): MarkdownText {
    const why: MarkdownText = WorkspaceOnCallNow.getWhyNotPaged(
      data.row.current!,
      false,
    );

    if (data.row.handoffAt && data.next) {
      return mdText`- ${data.schedule}: nobody is paged until ${WorkspaceMessageTime.dateAndTime(
        data.row.handoffAt,
      )}, when ${data.next} takes over: ${why}.`;
    }

    if (data.row.handoffAt) {
      return mdText`- ${data.schedule}: nobody is paged until ${WorkspaceMessageTime.dateAndTime(
        data.row.handoffAt,
      )}: ${why}.`;
    }

    return mdText`- ${data.schedule}: nobody is paged: ${why}.`;
  }

  /*
   * "Ivy is on call but hasn't joined the project yet", as the hand-off
   * says it (OnCallChatText.whyNotPaged) - "the person on call ..." when no
   * name was typed for them.
   */
  private static getWhyNotPaged(person: Person, isNext: boolean): MarkdownText {
    const displayName: string = person.invitee?.displayName || "";

    return OnCallChatText.whyNotPaged({
      person: {
        name: displayName ? mdText`**${displayName}**` : FeedMarkdown.empty(),
        because: OnCallNotPagedBecause.NotJoinedYet,
      },
      isNext: isNext,
    });
  }

  // "**Simon Lee**", or "**Simon Lee** (you)" for the person asking.
  private static getPersonMarkdown(
    person: Person,
    readerUserId: string | undefined,
  ): MarkdownText {
    return readerUserId && person.id === readerUserId
      ? mdText`**${person.name}** (you)`
      : mdText`**${person.name}**`;
  }

  /*
   * "On call now: nobody (Database), Simon Lee (Primary), Ana Ruiz
   * (Secondary) and 4 more": the first few schedules, so a notification
   * reads as one line - "and more" when the answer itself was cut.
   */
  private static getNotificationText(
    rows: Array<ScheduleRow>,
    isCut: boolean,
  ): string {
    const named: Array<string> = rows
      .slice(0, WorkspaceOnCallNow.MAX_SCHEDULES_IN_NOTIFICATION)
      .map((row: ScheduleRow): string => {
        // Someone only invited is paged by nothing: nobody, until they join.
        return `${row.current && !row.current.invitee ? row.current.name : "nobody"} (${row.name})`;
      });

    const more: number = rows.length - named.length;

    if (isCut) {
      return `On call now: ${named.join(", ")} and more`;
    }

    return `On call now: ${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
  }

  /*
   * A person on a roster, as the answer names them: someone only invited
   * by the name typed for them, else "someone who hasn't joined the project
   * yet" - never the address they were invited at, which the asker's own
   * read shows of them (#10175, #10616); anyone else by their name, else
   * their address.
   */
  private static toPerson(
    user: User | undefined | null,
    invited: Map<string, WithheldProfile>,
  ): Person | null {
    const id: string | undefined = user?.id?.toString();

    if (!user || !id) {
      return null;
    }

    const profile: WithheldProfile | undefined =
      PendingInviteeProfiles.getWithheldProfile({
        userId: id,
        withheld: invited,
      });

    if (profile) {
      return {
        id: id,
        name: OnCallChatByWorkspace.getInviteeName(profile),
        invitee: {
          displayName: OnCallChatByWorkspace.getDisplayName(
            profile.inviteeName,
          ),
        },
      };
    }

    const name: string =
      user.name?.toString().trim() || user.email?.toString().trim() || "";

    return { id: id, name: name || "Someone", invitee: null };
  }

  /*
   * Who of the people on the schedules' rosters is only invited to the
   * project, in one read. A read that fails is thrown, as the schedules'
   * own: the answer must not name them by what it cannot tell apart.
   */
  private static async readInvited(data: {
    projectId: ObjectID;
    schedules: Array<OnCallDutyPolicySchedule>;
  }): Promise<Map<string, WithheldProfile>> {
    const userIds: Array<string> = [];

    for (const schedule of data.schedules) {
      for (const user of [
        schedule.currentUserOnRoster,
        schedule.nextUserOnRoster,
      ]) {
        const id: string | undefined = user?.id?.toString();

        if (id && !userIds.includes(id)) {
          userIds.push(id);
        }
      }
    }

    if (userIds.length === 0) {
      return new Map<string, WithheldProfile>();
    }

    return await PendingInviteeProfiles.readWithheldProfilesInProject({
      userIds: userIds,
      projectId: data.projectId,
    });
  }

  private static async getDashboardUrl(): Promise<URL | null> {
    try {
      return await DatabaseConfig.getDashboardUrl();
    } catch (err) {
      logger.debug(
        "No dashboard address to link the on-call schedules to; answering without links.",
      );
      logger.debug(err);
      return null;
    }
  }

  private static getSchedulesLink(
    dashboardUrl: URL,
    projectId: ObjectID,
  ): string {
    return URL.fromString(dashboardUrl.toString())
      .addRoute(`/${projectId.toString()}/on-call-duty/schedules`)
      .toString();
  }

  private static getScheduleLink(
    dashboardUrl: URL,
    projectId: ObjectID,
    scheduleId: ObjectID,
  ): string {
    return URL.fromString(dashboardUrl.toString())
      .addRoute(
        `/${projectId.toString()}/on-call-duty/schedules/${scheduleId.toString()}`,
      )
      .toString();
  }
}
