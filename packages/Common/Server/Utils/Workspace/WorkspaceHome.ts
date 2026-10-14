import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceOpenRecordKind from "../../../Types/Workspace/WorkspaceOpenRecordKind";
import {
  WorkspaceMessageBlock,
  WorkspaceMessagePayloadButton,
  WorkspacePayloadButtons,
  WorkspacePayloadDivider,
  WorkspacePayloadHeader,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../DatabaseConfig";
import OnCallDutyPolicyScheduleService from "../../Services/OnCallDutyPolicyScheduleService";
import ProjectService from "../../Services/ProjectService";
import UserService from "../../Services/UserService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceMessageTime from "./WorkspaceMessageTime";
import WorkspaceOpenRecords, {
  WorkspaceOpenRecordList,
} from "./WorkspaceOpenRecords";

/*
 * THE HOME OF THE ONEUPTIME APP, IN SLACK AND IN MICROSOFT TEAMS.
 *
 * Open the OneUptime app in Slack (its Home tab) or in Teams (its chat), and
 * the first thing it shows is what concerns you, right now:
 *
 *   👋 Hi Nitin
 *   Here's what is happening in Acme Production.
 *
 *   📟 Your on-call
 *   🟢 You're on call in Primary until Fri, Oct 17 at 9:00 AM.
 *   ───────────────
 *   🚨 Open incidents
 *   • INC-12 Checkout is down · Critical · Identified · since 5:15 PM
 *   See every incident in OneUptime
 *
 *   ✅ No open alerts.
 *   ───────────────
 *   [Declare incident] [Page someone] [Schedule maintenance] [Who's on call]
 *   Updated at 5:15 PM. Type /oneuptime help to see every command.
 *
 * Everything is read as the member the chat account is connected to, with
 * their own permissions (the lists through WorkspaceOpenRecords): a part
 * they may not read says so, and the rest still shows. The same blocks are
 * Slack's Home view and the Teams card, so the two read alike. Somebody not
 * connected yet is shown what the Home would hold, and one button to
 * connect.
 *
 * The Slack half publishes it (SlackHome); the Teams half sends it to the
 * person's chat with the bot (MicrosoftTeamsHome).
 */

// A shift of the person's: the schedule, and until (or from) when.
export interface WorkspaceHomeShift {
  scheduleName: string;
  scheduleLink: string | null;
  // On call now: when it hands off. Next: when it starts.
  at: Date | null;
}

export interface WorkspaceHomeOnCall {
  // Null: the person may not read the on-call schedules.
  now: Array<WorkspaceHomeShift> | null;
  // The person's next shift, when they are not on call now.
  next: WorkspaceHomeShift | null;
  // More schedules have them on call than `now` lists.
  isNowCut: boolean;
}

// A list the Home shows: what it holds, or why it holds nothing.
export interface WorkspaceHomeList {
  kind: WorkspaceOpenRecordKind;
  // Null when it could not be read (see `refused` and `failed`).
  list: WorkspaceOpenRecordList | null;
  // The member may not read this kind of record.
  refused: boolean;
  // The read failed for another reason.
  failed: boolean;
}

export interface WorkspaceHomeView {
  projectName: string | null;
  // The person's first name, to greet them.
  firstName: string | null;
  onCall: WorkspaceHomeOnCall | null;
  incidents: WorkspaceHomeList;
  alerts: WorkspaceHomeList;
  // The project's home in OneUptime.
  dashboardLink: string | null;
  readAt: Date;
}

// What the Home's buttons do, in each chat's own action ids.
export interface WorkspaceHomeActions {
  declareIncident: string;
  pageSomeone: string;
  scheduleMaintenance?: string | undefined;
  whoIsOnCall: string;
  // Microsoft Teams: a card does not change by itself.
  refresh?: string | undefined;
}

// The words of the Home that both chats share.
export const WORKSPACE_HOME_TEXT: {
  declareIncident: string;
  pageSomeone: string;
  scheduleMaintenance: string;
  whoIsOnCall: string;
  refresh: string;
  connect: Record<WorkspaceType, string>;
} = {
  declareIncident: "🚨 Declare incident",
  pageSomeone: "📟 Page someone",
  scheduleMaintenance: "🛠️ Schedule maintenance",
  whoIsOnCall: "👥 Who's on call",
  refresh: "🔄 Refresh",
  connect: {
    [WorkspaceType.Slack]: "Connect Slack account",
    [WorkspaceType.MicrosoftTeams]: "Connect Microsoft Teams account",
  },
};

export default class WorkspaceHome {
  // How many records each list on the Home shows; it links to the rest.
  public static readonly MAX_RECORDS: number = 5;

  // How many of the person's on-call schedules it names.
  public static readonly MAX_SHIFTS: number = 5;

  /*
   * What the Home shows `userId`, read with their own `props`. A part that
   * cannot be read is marked so; the read itself never throws for one.
   */
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
    // The moment the Home is read, for "Updated at".
    now?: Date | undefined;
  }): Promise<WorkspaceHomeView> {
    const [projectName, firstName, onCall, incidents, alerts, dashboardUrl]: [
      string | null,
      string | null,
      WorkspaceHomeOnCall | null,
      WorkspaceHomeList,
      WorkspaceHomeList,
      URL | null,
    ] = await Promise.all([
      WorkspaceHome.readProjectName(data.projectId),
      WorkspaceHome.readFirstName(data.userId),
      WorkspaceHome.readOnCall(data),
      WorkspaceHome.readList({
        ...data,
        kind: WorkspaceOpenRecordKind.Incidents,
      }),
      WorkspaceHome.readList({
        ...data,
        kind: WorkspaceOpenRecordKind.Alerts,
      }),
      WorkspaceHome.getDashboardUrl(),
    ]);

    return {
      projectName: projectName,
      firstName: firstName,
      onCall: onCall,
      incidents: incidents,
      alerts: alerts,
      dashboardLink: dashboardUrl
        ? URL.fromString(dashboardUrl.toString())
            .addRoute(`/${data.projectId.toString()}/home/`)
            .toString()
        : null,
      readAt: data.now || new Date(),
    };
  }

  // The Home of a member, as blocks both chats draw (see the header).
  public static getBlocks(data: {
    workspaceType: WorkspaceType;
    view: WorkspaceHomeView;
    actions: WorkspaceHomeActions;
  }): Array<WorkspaceMessageBlock> {
    const { view } = data;

    const blocks: Array<WorkspaceMessageBlock> = [
      WorkspaceHome.header(
        view.firstName ? `👋 Hi ${view.firstName}` : "👋 Hi there",
      ),
    ];

    if (view.projectName) {
      blocks.push(
        WorkspaceHome.markdown(
          mdText`Here's what is happening in **${view.projectName}**.`,
        ),
      );
    }

    blocks.push(WorkspaceHome.markdown(WorkspaceHome.getOnCallMarkdown(view)));
    blocks.push(WorkspaceHome.divider());
    blocks.push(
      WorkspaceHome.markdown(WorkspaceHome.getListMarkdown(view.incidents)),
    );
    blocks.push(
      WorkspaceHome.markdown(WorkspaceHome.getListMarkdown(view.alerts)),
    );
    blocks.push(WorkspaceHome.divider());
    blocks.push(WorkspaceHome.getButtons(data.actions));
    blocks.push(
      WorkspaceHome.markdown(
        WorkspaceHome.getFooterMarkdown({
          workspaceType: data.workspaceType,
          view: view,
        }),
      ),
    );

    return blocks;
  }

  /*
   * The Home of somebody whose chat account is not connected yet: what it
   * would show them, and one button to connect - a link to their own
   * settings page in OneUptime, which connects the account that opens it.
   */
  public static getNotConnectedBlocks(data: {
    workspaceType: WorkspaceType;
    connectUrl: string | null;
  }): Array<WorkspaceMessageBlock> {
    const productName: string = ProductBrandingText.getProductName();
    const workspaceName: string =
      data.workspaceType === WorkspaceType.Slack ? "Slack" : "Microsoft Teams";

    const blocks: Array<WorkspaceMessageBlock> = [
      WorkspaceHome.header(`👋 Welcome to ${productName}`),
      WorkspaceHome.markdown(
        mdText`🔗 **Connect your ${workspaceName} account** to see your on-call shifts and the open incidents and alerts here, and to declare incidents and page people from ${workspaceName}. It takes one click.`,
      ),
    ];

    if (data.connectUrl) {
      blocks.push({
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: WORKSPACE_HOME_TEXT.connect[data.workspaceType],
            value: "",
            actionId: WorkspaceHome.CONNECT_ACTION_ID,
            url: URL.fromString(data.connectUrl),
            isPrimary: true,
          },
        ],
      } as WorkspacePayloadButtons);
    } else {
      blocks.push(
        WorkspaceHome.markdown(
          mdText`In ${productName}, go to **User Settings → ${workspaceName}** and connect your account.`,
        ),
      );
    }

    return blocks;
  }

  // The Home of somebody whose account is not a member of the project.
  public static getNotAMemberBlocks(): Array<WorkspaceMessageBlock> {
    return [
      WorkspaceHome.header(`👋 ${ProductBrandingText.getProductName()}`),
      WorkspaceHome.markdown(
        mdText`${WorkspaceActionAuthorization.NOT_A_PROJECT_MEMBER_MESSAGE}`,
      ),
    ];
  }

  // What a notification of the Home says (the Teams card's summary).
  public static getNotificationText(view: WorkspaceHomeView): string {
    const parts: Array<string> = [];

    if (view.onCall?.now && view.onCall.now.length > 0) {
      parts.push(
        `You're on call in ${view.onCall.now
          .map((shift: WorkspaceHomeShift): string => {
            return shift.scheduleName;
          })
          .join(", ")}`,
      );
    }

    const open: Array<string> = [];

    for (const home of [view.incidents, view.alerts]) {
      if (home.list && home.list.records.length > 0) {
        const count: string = `${home.list.records.length}${home.list.isCut ? "+" : ""}`;
        open.push(
          home.kind === WorkspaceOpenRecordKind.Incidents
            ? `${count} open incident${home.list.records.length === 1 && !home.list.isCut ? "" : "s"}`
            : `${count} open alert${home.list.records.length === 1 && !home.list.isCut ? "" : "s"}`,
        );
      }
    }

    if (open.length > 0) {
      parts.push(open.join(", "));
    }

    return parts.length > 0
      ? parts.join(". ")
      : "Nothing is open, and you're not on call";
  }

  // The Connect button's id: a link, whose click only needs an answer.
  public static readonly CONNECT_ACTION_ID: string = "ConnectSlackAccount";

  /*
   * "📟 Your on-call" and the person's shifts: on call now, until when;
   * else their next shift; else that none is coming up.
   */
  public static getOnCallMarkdown(view: WorkspaceHomeView): MarkdownText {
    const title: MarkdownText = mdText`📟 **Your on-call**`;

    if (!view.onCall || view.onCall.now === null) {
      return FeedMarkdown.join(
        [
          title,
          view.onCall
            ? mdText`You do not have permission to see the on-call schedules in this project.`
            : mdText`Your on-call shifts could not be read just now.`,
        ],
        "\n",
      );
    }

    const lines: Array<MarkdownText> = [title];

    if (view.onCall.now.length > 0) {
      for (const shift of view.onCall.now) {
        lines.push(
          shift.at
            ? mdText`🟢 You're on call in ${WorkspaceHome.scheduleMarkdown(shift)} until ${WorkspaceMessageTime.dateAndTime(shift.at)}.`
            : mdText`🟢 You're on call in ${WorkspaceHome.scheduleMarkdown(shift)}.`,
        );
      }

      if (view.onCall.isNowCut) {
        lines.push(mdText`…and in more schedules.`);
      }

      return FeedMarkdown.join(lines, "\n");
    }

    if (view.onCall.next && view.onCall.next.at) {
      lines.push(
        mdText`You're not on call right now. Your next shift: ${WorkspaceHome.scheduleMarkdown(view.onCall.next)}, from ${WorkspaceMessageTime.dateAndTime(view.onCall.next.at)}.`,
      );

      return FeedMarkdown.join(lines, "\n");
    }

    lines.push(
      mdText`You're not on call right now, and no shift of yours is coming up.`,
    );

    return FeedMarkdown.join(lines, "\n");
  }

  // A list on the Home: as Teams' "show" lists say it, or why it is empty.
  public static getListMarkdown(home: WorkspaceHomeList): MarkdownText {
    if (home.refused) {
      return FeedMarkdown.asMarkdown(
        WorkspaceOpenRecords.getRefusalAnswer(home.kind).markdown,
      );
    }

    if (!home.list || home.failed) {
      const what: string =
        home.kind === WorkspaceOpenRecordKind.Incidents
          ? "The open incidents"
          : "The open alerts";

      return mdText`${what} could not be read just now.`;
    }

    return FeedMarkdown.asMarkdown(
      WorkspaceOpenRecords.toAnswer(home.list).markdown,
    );
  }

  private static getButtons(
    actions: WorkspaceHomeActions,
  ): WorkspacePayloadButtons {
    const buttons: Array<WorkspaceMessagePayloadButton> = [
      {
        _type: "WorkspaceMessagePayloadButton",
        title: WORKSPACE_HOME_TEXT.declareIncident,
        value: "",
        actionId: actions.declareIncident,
        isPrimary: true,
      },
      {
        _type: "WorkspaceMessagePayloadButton",
        title: WORKSPACE_HOME_TEXT.pageSomeone,
        value: "",
        actionId: actions.pageSomeone,
      },
    ];

    if (actions.scheduleMaintenance) {
      buttons.push({
        _type: "WorkspaceMessagePayloadButton",
        title: WORKSPACE_HOME_TEXT.scheduleMaintenance,
        value: "",
        actionId: actions.scheduleMaintenance,
      });
    }

    buttons.push({
      _type: "WorkspaceMessagePayloadButton",
      title: WORKSPACE_HOME_TEXT.whoIsOnCall,
      value: "",
      actionId: actions.whoIsOnCall,
    });

    if (actions.refresh) {
      buttons.push({
        _type: "WorkspaceMessagePayloadButton",
        title: WORKSPACE_HOME_TEXT.refresh,
        value: "",
        actionId: actions.refresh,
      });
    }

    return {
      _type: "WorkspacePayloadButtons",
      buttons: buttons,
    };
  }

  /*
   * "Updated at 5:15 PM · Open OneUptime. Type /oneuptime help to see every
   * command." - when the Home was read, in each reader's own time.
   */
  private static getFooterMarkdown(data: {
    workspaceType: WorkspaceType;
    view: WorkspaceHomeView;
  }): MarkdownText {
    const productName: string = ProductBrandingText.getProductName();
    const updated: MarkdownText = mdText`Updated at ${WorkspaceMessageTime.time(data.view.readAt)}`;
    const open: MarkdownText = data.view.dashboardLink
      ? mdText` · [Open ${productName}](${data.view.dashboardLink})`
      : FeedMarkdown.empty();
    const help: MarkdownText =
      data.workspaceType === WorkspaceType.Slack
        ? mdText`Type ${FeedMarkdown.code("/oneuptime help")} to see every command.`
        : mdText`Type **help** to see every command.`;

    return mdText`_${updated}${open}._ ${help}`;
  }

  private static scheduleMarkdown(shift: WorkspaceHomeShift): MarkdownText {
    return shift.scheduleLink
      ? mdText`[${shift.scheduleName}](${shift.scheduleLink})`
      : mdText`**${shift.scheduleName}**`;
  }

  private static header(text: string): WorkspacePayloadHeader {
    return { _type: "WorkspacePayloadHeader", text: text };
  }

  private static markdown(markdown: MarkdownText): WorkspacePayloadMarkdown {
    return { _type: "WorkspacePayloadMarkdown", text: markdown.toString() };
  }

  private static divider(): WorkspacePayloadDivider {
    return { _type: "WorkspacePayloadDivider" };
  }

  private static async readList(data: {
    kind: WorkspaceOpenRecordKind;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceHomeList> {
    try {
      return {
        kind: data.kind,
        list: await WorkspaceOpenRecords.read({
          kind: data.kind,
          projectId: data.projectId,
          props: data.props,
          limit: WorkspaceHome.MAX_RECORDS,
        }),
        refused: false,
        failed: false,
      };
    } catch (err) {
      if (WorkspaceActionAuthorization.isReadRefusal(err)) {
        return { kind: data.kind, list: null, refused: true, failed: false };
      }

      logger.error(`Could not read the ${data.kind} for a chat Home.`, {
        projectId: data.projectId.toString(),
      });
      logger.error(err, { projectId: data.projectId.toString() });

      return { kind: data.kind, list: null, refused: false, failed: true };
    }
  }

  /*
   * The person's shifts: the schedules they are on call in now, read from
   * each schedule's roster (as `/oneuptime oncall` and the schedules list
   * are), and the soonest one they are next in. Null when the read failed.
   */
  private static async readOnCall(data: {
    projectId: ObjectID;
    userId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceHomeOnCall | null> {
    try {
      const dashboardUrl: URL | null = await WorkspaceHome.getDashboardUrl();

      const nowSchedules: Array<OnCallDutyPolicySchedule> =
        await OnCallDutyPolicyScheduleService.findBy({
          query: {
            projectId: data.projectId,
            currentUserIdOnRoster: data.userId,
          },
          select: {
            _id: true,
            name: true,
            rosterHandoffAt: true,
          },
          sort: {
            name: SortOrder.Ascending,
          },
          limit: WorkspaceHome.MAX_SHIFTS + 1,
          skip: 0,
          props: data.props,
        });

      if (nowSchedules.length > 0) {
        return {
          now: nowSchedules
            .slice(0, WorkspaceHome.MAX_SHIFTS)
            .map((schedule: OnCallDutyPolicySchedule): WorkspaceHomeShift => {
              return WorkspaceHome.toShift({
                schedule: schedule,
                at: schedule.rosterHandoffAt,
                dashboardUrl: dashboardUrl,
                projectId: data.projectId,
              });
            }),
          next: null,
          isNowCut: nowSchedules.length > WorkspaceHome.MAX_SHIFTS,
        };
      }

      const nextSchedules: Array<OnCallDutyPolicySchedule> =
        await OnCallDutyPolicyScheduleService.findBy({
          query: {
            projectId: data.projectId,
            nextUserIdOnRoster: data.userId,
          },
          select: {
            _id: true,
            name: true,
            rosterNextStartAt: true,
          },
          sort: {
            rosterNextStartAt: SortOrder.Ascending,
          },
          limit: 1,
          skip: 0,
          props: data.props,
        });

      const next: OnCallDutyPolicySchedule | undefined = nextSchedules[0];

      return {
        now: [],
        next: next
          ? WorkspaceHome.toShift({
              schedule: next,
              at: next.rosterNextStartAt,
              dashboardUrl: dashboardUrl,
              projectId: data.projectId,
            })
          : null,
        isNowCut: false,
      };
    } catch (err) {
      if (WorkspaceActionAuthorization.isReadRefusal(err)) {
        return { now: null, next: null, isNowCut: false };
      }

      logger.error("Could not read the on-call shifts for a chat Home.", {
        projectId: data.projectId.toString(),
      });
      logger.error(err, { projectId: data.projectId.toString() });

      return null;
    }
  }

  private static toShift(data: {
    schedule: OnCallDutyPolicySchedule;
    at: Date | undefined;
    dashboardUrl: URL | null;
    projectId: ObjectID;
  }): WorkspaceHomeShift {
    const at: Date | null = data.at ? new Date(data.at) : null;

    return {
      scheduleName: data.schedule.name?.toString().trim() || "Unnamed schedule",
      scheduleLink:
        data.dashboardUrl && data.schedule.id
          ? URL.fromString(data.dashboardUrl.toString())
              .addRoute(
                `/${data.projectId.toString()}/on-call-duty/schedules/${data.schedule.id.toString()}`,
              )
              .toString()
          : null,
      at: at && !isNaN(at.getTime()) ? at : null,
    };
  }

  private static async readProjectName(
    projectId: ObjectID,
  ): Promise<string | null> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      return project?.name?.toString().trim() || null;
    } catch (err) {
      logger.debug("Could not read the project's name for a chat Home.");
      logger.debug(err);
      return null;
    }
  }

  private static async readFirstName(userId: ObjectID): Promise<string | null> {
    try {
      const user: User | null = await UserService.findOneById({
        id: userId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      const name: string = user?.name?.toString().trim() || "";

      return name ? name.split(" ")[0]! : null;
    } catch (err) {
      logger.debug("Could not read the person's name for a chat Home.");
      logger.debug(err);
      return null;
    }
  }

  private static async getDashboardUrl(): Promise<URL | null> {
    try {
      return await DatabaseConfig.getDashboardUrl();
    } catch (err) {
      logger.debug(
        "No dashboard address to link the chat Home to; showing it without links.",
      );
      logger.debug(err);
      return null;
    }
  }
}
