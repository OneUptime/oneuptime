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
import ProductBrandingText from "../ProductBrandingText";
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
}

export default class WorkspaceOnCallNow {
  // How many schedules an answer lists; it links to the rest.
  public static readonly MAX_SCHEDULES: number = 20;

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
        "You do not have permission to see the on-call schedules in this project. Ask a project admin for access to them.";

      return {
        markdown: mdText`${message}`.toString(),
        text: message,
      };
    }

    const dashboardUrl: URL | null = await WorkspaceOnCallNow.getDashboardUrl();

    const rows: Array<ScheduleRow> = schedules
      .slice(0, WorkspaceOnCallNow.MAX_SCHEDULES)
      .map((schedule: OnCallDutyPolicySchedule): ScheduleRow => {
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
          current: WorkspaceOnCallNow.toPerson(schedule.currentUserOnRoster),
          next: WorkspaceOnCallNow.toPerson(schedule.nextUserOnRoster),
          handoffAt: schedule.rosterHandoffAt
            ? new Date(schedule.rosterHandoffAt)
            : null,
          nextStartAt: schedule.rosterNextStartAt
            ? new Date(schedule.rosterNextStartAt)
            : null,
        };
      });

    const schedulesLink: string | null = dashboardUrl
      ? WorkspaceOnCallNow.getSchedulesLink(dashboardUrl, data.projectId)
      : null;

    const productName: string = ProductBrandingText.getProductName();

    if (rows.length === 0) {
      return {
        markdown: (schedulesLink
          ? mdText`👥 **No on-call schedules yet.** There are no on-call schedules in this project that you can see. [Add one in ${productName}](${schedulesLink}) under On-Call Duty → Schedules.`
          : mdText`👥 **No on-call schedules yet.** There are no on-call schedules in this project that you can see. Add one in ${productName} under On-Call Duty → Schedules.`
        ).toString(),
        text: "There are no on-call schedules in this project that you can see",
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
        mdText`These are the first ${WorkspaceOnCallNow.MAX_SCHEDULES} schedules. See them all in ${productName}, under On-Call Duty → Schedules.`,
      );
    }

    return {
      markdown: FeedMarkdown.join(lines, "\n").toString(),
      text: WorkspaceOnCallNow.getNotificationText(rows),
    };
  }

  /*
   * "• Primary: Simon Lee until Fri at 9:00 AM, then Ana Ruiz." - the
   * schedule's name links to it.
   */
  private static getRowLine(
    row: ScheduleRow,
    readerUserId: string | undefined,
  ): MarkdownText {
    const schedule: MarkdownText = row.link
      ? mdText`[${row.name}](${row.link})`
      : mdText`${row.name}`;

    if (!row.current) {
      if (row.next && row.nextStartAt) {
        return mdText`- ${schedule}: nobody right now. ${WorkspaceOnCallNow.getPersonMarkdown(
          row.next,
          readerUserId,
        )} is next, from ${WorkspaceMessageTime.dateAndTime(row.nextStartAt)}.`;
      }

      return mdText`- ${schedule}: nobody right now.`;
    }

    const current: MarkdownText = WorkspaceOnCallNow.getPersonMarkdown(
      row.current,
      readerUserId,
    );

    const isNextSomebodyElse: boolean = Boolean(
      row.next && row.next.id !== row.current.id,
    );

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

  // "**Simon Lee**", or "**Simon Lee** (you)" for the person asking.
  private static getPersonMarkdown(
    person: Person,
    readerUserId: string | undefined,
  ): MarkdownText {
    return readerUserId && person.id === readerUserId
      ? mdText`**${person.name}** (you)`
      : mdText`**${person.name}**`;
  }

  // "On call now: Simon Lee (Primary), nobody (Database)"
  private static getNotificationText(rows: Array<ScheduleRow>): string {
    return `On call now: ${rows
      .map((row: ScheduleRow): string => {
        return `${row.current ? row.current.name : "nobody"} (${row.name})`;
      })
      .join(", ")}`;
  }

  private static toPerson(user: User | undefined | null): Person | null {
    const id: string | undefined = user?.id?.toString();

    if (!user || !id) {
      return null;
    }

    const name: string =
      user.name?.toString().trim() || user.email?.toString().trim() || "";

    return { id: id, name: name || "Someone" };
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
