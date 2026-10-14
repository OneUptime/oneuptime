import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import WorkspaceOpenRecordKind from "../../../Types/Workspace/WorkspaceOpenRecordKind";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../DatabaseConfig";
import QueryHelper from "../../Types/Database/QueryHelper";
import AlertService from "../../Services/AlertService";
import AlertStateService from "../../Services/AlertStateService";
import IncidentService from "../../Services/IncidentService";
import IncidentStateService from "../../Services/IncidentStateService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { WorkspaceAnswer } from "./WorkspaceActionAnswers";
import WorkspaceActionAuthorization from "./WorkspaceActionAuthorization";
import WorkspaceMessageTime from "./WorkspaceMessageTime";

/*
 * WHAT IS OPEN RIGHT NOW, AS THE PERSON ASKING MAY SEE IT.
 *
 * The open incidents, the open alerts, the scheduled maintenance still to
 * come and the maintenance in progress - for the Microsoft Teams bot's
 * "show active incidents" and its three other lists, and for the Home of
 * the OneUptime app in Slack and in Teams (WorkspaceHome). Every read is
 * made with the asker's own props, as the same list in OneUptime is: a role
 * limited to some labels sees the records carrying them, a role that may
 * not read incidents is told so, and nobody outside the project sees
 * anything. (The Teams lists used to read as OneUptime itself, so anybody
 * in a connected Microsoft 365 organization could list a project's open
 * incidents, connected or not.)
 *
 * One line a record, newest first, the time in each reader's own zone:
 *
 *   🚨 Open incidents
 *   • INC-12 Checkout is down · Critical · Identified · since Oct 8 at 5:15 PM
 *   • INC-11 Slow search · Minor · Acknowledged · since Oct 8 at 9:02 AM
 *   See every incident in OneUptime
 *
 * Titles, severities and states are text, never Markdown.
 */

export { WorkspaceOpenRecordKind };

export interface WorkspaceOpenRecord {
  // "INC-12", "AL-7", "SM-3": the record's number as OneUptime shows it.
  number: string;
  title: string;
  // The record's page in OneUptime, when the server knows its address.
  link: string | null;
  severity: string | null;
  state: string | null;
  // Declared or created; for maintenance, when it starts.
  startsAt: Date | null;
  // Maintenance only: when it is due to end.
  endsAt: Date | null;
}

export interface WorkspaceOpenRecordList {
  kind: WorkspaceOpenRecordKind;
  // The first records, newest (or soonest) first.
  records: Array<WorkspaceOpenRecord>;
  // More are open than the list holds.
  isCut: boolean;
  // The list's page in OneUptime.
  listLink: string | null;
}

// The words of each list.
interface OpenRecordWords {
  emoji: string;
  title: string;
  // Nothing open: good news for incidents and alerts.
  emptyEmoji: string;
  empty: string;
  // "incidents": what a refused read names.
  noun: string;
  seeAll: string;
}

const WORDS: Record<WorkspaceOpenRecordKind, OpenRecordWords> = {
  [WorkspaceOpenRecordKind.Incidents]: {
    emoji: "🚨",
    title: "Open incidents",
    emptyEmoji: "✅",
    empty: "No open incidents.",
    noun: "incidents",
    seeAll: "See every incident in",
  },
  [WorkspaceOpenRecordKind.Alerts]: {
    emoji: "⚠️",
    title: "Open alerts",
    emptyEmoji: "✅",
    empty: "No open alerts.",
    noun: "alerts",
    seeAll: "See every alert in",
  },
  [WorkspaceOpenRecordKind.UpcomingMaintenance]: {
    emoji: "🛠️",
    title: "Scheduled maintenance coming up",
    emptyEmoji: "🛠️",
    empty: "No scheduled maintenance coming up.",
    noun: "scheduled maintenance events",
    seeAll: "See every scheduled maintenance event in",
  },
  [WorkspaceOpenRecordKind.OngoingMaintenance]: {
    emoji: "🔧",
    title: "Maintenance in progress",
    emptyEmoji: "🔧",
    empty: "No maintenance in progress.",
    noun: "scheduled maintenance events",
    seeAll: "See every scheduled maintenance event in",
  },
};

// The list pages in OneUptime, under the project.
const LIST_PATHS: Record<WorkspaceOpenRecordKind, string> = {
  [WorkspaceOpenRecordKind.Incidents]: "incidents",
  [WorkspaceOpenRecordKind.Alerts]: "alerts",
  [WorkspaceOpenRecordKind.UpcomingMaintenance]: "scheduled-maintenance-events",
  [WorkspaceOpenRecordKind.OngoingMaintenance]: "scheduled-maintenance-events",
};

// A title longer than this is cut on its line: the record's page has it all.
const MAX_TITLE_LENGTH: number = 120;

const WHITESPACE_RUN: RegExp = /\s+/g;

export default class WorkspaceOpenRecords {
  // How many records a list shows; it links to the rest.
  public static readonly MAX_RECORDS: number = 10;

  /*
   * How many records a notification of a list names - Teams shows it in the
   * activity feed - before "and N more".
   */
  public static readonly MAX_RECORDS_IN_NOTIFICATION: number = 3;

  /*
   * The open records of a kind that `props` may read, newest first (soonest
   * first for maintenance still to come), at most `limit` of them.
   * Throws a read refusal (WorkspaceActionAuthorization.isReadRefusal) when
   * the member may not read that kind at all.
   */
  @CaptureSpan()
  public static async read(data: {
    kind: WorkspaceOpenRecordKind;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    limit?: number | undefined;
  }): Promise<WorkspaceOpenRecordList> {
    const limit: number = Math.max(
      1,
      data.limit || WorkspaceOpenRecords.MAX_RECORDS,
    );

    const dashboardUrl: URL | null =
      await WorkspaceOpenRecords.getDashboardUrl();

    let records: Array<WorkspaceOpenRecord>;

    switch (data.kind) {
      case WorkspaceOpenRecordKind.Incidents:
        records = await WorkspaceOpenRecords.readIncidents({
          projectId: data.projectId,
          props: data.props,
          limit: limit + 1,
          dashboardUrl: dashboardUrl,
        });
        break;
      case WorkspaceOpenRecordKind.Alerts:
        records = await WorkspaceOpenRecords.readAlerts({
          projectId: data.projectId,
          props: data.props,
          limit: limit + 1,
          dashboardUrl: dashboardUrl,
        });
        break;
      case WorkspaceOpenRecordKind.UpcomingMaintenance:
      case WorkspaceOpenRecordKind.OngoingMaintenance:
        records = await WorkspaceOpenRecords.readMaintenance({
          isOngoing: data.kind === WorkspaceOpenRecordKind.OngoingMaintenance,
          projectId: data.projectId,
          props: data.props,
          limit: limit + 1,
          dashboardUrl: dashboardUrl,
        });
        break;
    }

    return {
      kind: data.kind,
      records: records.slice(0, limit),
      isCut: records.length > limit,
      listLink: dashboardUrl
        ? WorkspaceOpenRecords.getListLink({
            dashboardUrl: dashboardUrl,
            projectId: data.projectId,
            kind: data.kind,
          })
        : null,
    };
  }

  /*
   * A list as an answer (see the header), or - for a member who may not
   * read that kind of record - why not, and who to ask.
   */
  @CaptureSpan()
  public static async getListAnswer(data: {
    kind: WorkspaceOpenRecordKind;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceAnswer> {
    let list: WorkspaceOpenRecordList;

    try {
      list = await WorkspaceOpenRecords.read(data);
    } catch (err) {
      if (!WorkspaceActionAuthorization.isReadRefusal(err)) {
        throw err;
      }

      return WorkspaceOpenRecords.getRefusalAnswer(data.kind);
    }

    return WorkspaceOpenRecords.toAnswer(list);
  }

  // What a member who may not read a kind of record is told.
  public static getRefusalAnswer(
    kind: WorkspaceOpenRecordKind,
  ): WorkspaceAnswer {
    const message: string = `You do not have permission to see the ${WORDS[kind].noun} in this project. Ask a project admin for access to them.`;

    return {
      markdown: mdText`${message}`.toString(),
      text: message,
    };
  }

  // A list as an answer: its title, a line a record, and its page.
  public static toAnswer(list: WorkspaceOpenRecordList): WorkspaceAnswer {
    const words: OpenRecordWords = WORDS[list.kind];

    if (list.records.length === 0) {
      return {
        markdown: mdText`${words.emptyEmoji} **${words.empty}**`.toString(),
        text: words.empty,
      };
    }

    const lines: Array<MarkdownText> = [
      mdText`${words.emoji} **${words.title}**`,
    ];

    for (const record of list.records) {
      lines.push(mdText`- ${WorkspaceOpenRecords.getLine(list.kind, record)}`);
    }

    const footer: MarkdownText | null = WorkspaceOpenRecords.getFooter(list);

    /*
     * After a blank line: a line right after the list would be read as part
     * of its last item.
     */
    if (footer) {
      lines.push(FeedMarkdown.empty());
      lines.push(footer);
    }

    return {
      markdown: FeedMarkdown.join(lines, "\n").toString(),
      text: WorkspaceOpenRecords.getNotificationText(list),
    };
  }

  /*
   * One record: "**[INC-12](link)** Checkout is down · Critical · Identified
   * · since Oct 8 at 5:15 PM". Maintenance says when it starts and ends.
   */
  public static getLine(
    kind: WorkspaceOpenRecordKind,
    record: WorkspaceOpenRecord,
  ): MarkdownText {
    const number: MarkdownText = record.link
      ? mdText`**[${record.number}](${record.link})**`
      : mdText`**${record.number}**`;

    const parts: Array<MarkdownText> = [
      mdText`${number} ${WorkspaceOpenRecords.cutTitle(record.title)}`,
    ];

    if (record.severity) {
      parts.push(mdText`${record.severity}`);
    }

    if (record.state) {
      parts.push(mdText`${record.state}`);
    }

    const when: MarkdownText | null = WorkspaceOpenRecords.getWhen(
      kind,
      record,
    );

    if (when) {
      parts.push(when);
    }

    return FeedMarkdown.join(parts, " · ");
  }

  /*
   * "3 open incidents: INC-12 Checkout is down, INC-11 Slow search and 1
   * more" - what Teams shows in the activity feed for the answer.
   */
  public static getNotificationText(list: WorkspaceOpenRecordList): string {
    const words: OpenRecordWords = WORDS[list.kind];

    if (list.records.length === 0) {
      return words.empty;
    }

    const named: Array<string> = list.records
      .slice(0, WorkspaceOpenRecords.MAX_RECORDS_IN_NOTIFICATION)
      .map((record: WorkspaceOpenRecord): string => {
        return `${record.number} ${WorkspaceOpenRecords.cutTitle(record.title)}`;
      });

    const more: number = list.records.length - named.length;

    const tail: string = list.isCut
      ? " and more"
      : more > 0
        ? ` and ${more} more`
        : "";

    return `${words.title}: ${named.join(", ")}${tail}`;
  }

  private static getWhen(
    kind: WorkspaceOpenRecordKind,
    record: WorkspaceOpenRecord,
  ): MarkdownText | null {
    if (kind === WorkspaceOpenRecordKind.UpcomingMaintenance) {
      if (record.startsAt && record.endsAt) {
        return mdText`from ${WorkspaceMessageTime.dateAndTime(
          record.startsAt,
        )} to ${WorkspaceMessageTime.dateAndTime(record.endsAt)}`;
      }

      return record.startsAt
        ? mdText`from ${WorkspaceMessageTime.dateAndTime(record.startsAt)}`
        : null;
    }

    if (kind === WorkspaceOpenRecordKind.OngoingMaintenance) {
      return record.endsAt
        ? mdText`until ${WorkspaceMessageTime.dateAndTime(record.endsAt)}`
        : null;
    }

    return record.startsAt
      ? mdText`since ${WorkspaceMessageTime.dateAndTime(record.startsAt)}`
      : null;
  }

  private static getFooter(list: WorkspaceOpenRecordList): MarkdownText | null {
    const words: OpenRecordWords = WORDS[list.kind];
    const productName: string = ProductBrandingText.getProductName();

    if (list.isCut) {
      return list.listLink
        ? mdText`These are the first ${list.records.length}. [${words.seeAll} ${productName}](${list.listLink})`
        : mdText`These are the first ${list.records.length}. ${words.seeAll} ${productName}.`;
    }

    return list.listLink
      ? mdText`[${words.seeAll} ${productName}](${list.listLink})`
      : null;
  }

  private static cutTitle(title: string): string {
    const oneLine: string = title.replace(WHITESPACE_RUN, " ").trim();

    if (oneLine.length <= MAX_TITLE_LENGTH) {
      return oneLine || "Untitled";
    }

    return `${oneLine.substring(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
  }

  private static async readIncidents(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    limit: number;
    dashboardUrl: URL | null;
  }): Promise<Array<WorkspaceOpenRecord>> {
    // Which states are open is the project's set-up, read as OneUptime.
    const openStateIds: Array<ObjectID> =
      await IncidentStateService.getUnresolvedIncidentStateIds(data.projectId);

    if (openStateIds.length === 0) {
      return [];
    }

    const incidents: Array<Incident> = await IncidentService.findBy({
      query: {
        projectId: data.projectId,
        currentIncidentStateId: QueryHelper.any(openStateIds),
      },
      select: {
        _id: true,
        incidentNumber: true,
        incidentNumberWithPrefix: true,
        title: true,
        declaredAt: true,
        createdAt: true,
        currentIncidentState: {
          name: true,
        },
        incidentSeverity: {
          name: true,
        },
      },
      sort: {
        declaredAt: SortOrder.Descending,
        createdAt: SortOrder.Descending,
      },
      limit: data.limit,
      skip: 0,
      props: data.props,
    });

    return incidents.map((incident: Incident): WorkspaceOpenRecord => {
      return {
        number:
          incident.incidentNumberWithPrefix ||
          `#${incident.incidentNumber ?? ""}`,
        title: incident.title || "",
        link:
          data.dashboardUrl && incident.id
            ? WorkspaceOpenRecords.getRecordLink(
                data.dashboardUrl,
                data.projectId,
                `incidents/${incident.id.toString()}`,
              )
            : null,
        severity: incident.incidentSeverity?.name || null,
        state: incident.currentIncidentState?.name || null,
        startsAt: WorkspaceOpenRecords.toDate(
          incident.declaredAt || incident.createdAt,
        ),
        endsAt: null,
      };
    });
  }

  private static async readAlerts(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    limit: number;
    dashboardUrl: URL | null;
  }): Promise<Array<WorkspaceOpenRecord>> {
    const openStateIds: Array<ObjectID> =
      await AlertStateService.getUnresolvedAlertStateIds(data.projectId);

    if (openStateIds.length === 0) {
      return [];
    }

    const alerts: Array<Alert> = await AlertService.findBy({
      query: {
        projectId: data.projectId,
        currentAlertStateId: QueryHelper.any(openStateIds),
      },
      select: {
        _id: true,
        alertNumber: true,
        alertNumberWithPrefix: true,
        title: true,
        createdAt: true,
        currentAlertState: {
          name: true,
        },
        alertSeverity: {
          name: true,
        },
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: data.limit,
      skip: 0,
      props: data.props,
    });

    return alerts.map((alert: Alert): WorkspaceOpenRecord => {
      return {
        number: alert.alertNumberWithPrefix || `#${alert.alertNumber ?? ""}`,
        title: alert.title || "",
        link:
          data.dashboardUrl && alert.id
            ? WorkspaceOpenRecords.getRecordLink(
                data.dashboardUrl,
                data.projectId,
                `alerts/${alert.id.toString()}`,
              )
            : null,
        severity: alert.alertSeverity?.name || null,
        state: alert.currentAlertState?.name || null,
        startsAt: WorkspaceOpenRecords.toDate(alert.createdAt),
        endsAt: null,
      };
    });
  }

  private static async readMaintenance(data: {
    isOngoing: boolean;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    limit: number;
    dashboardUrl: URL | null;
  }): Promise<Array<WorkspaceOpenRecord>> {
    /*
     * In progress: the project's ongoing state, or one of its own placed
     * between Ongoing and Ended. Still to come: waiting for its start, in
     * the scheduled state or one of the project's own placed after it and
     * before Ongoing (Common/Utils/ScheduledMaintenanceStart).
     */
    const stateIds: Array<ObjectID> = data.isOngoing
      ? await ScheduledMaintenanceStateService.getInProgressScheduledMaintenanceStateIds(
          data.projectId,
        )
      : await ScheduledMaintenanceStateService.getWaitingToStartScheduledMaintenanceStateIds(
          data.projectId,
        );

    if (stateIds.length === 0) {
      return [];
    }

    const events: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: data.projectId,
          currentScheduledMaintenanceStateId: QueryHelper.any(stateIds),
        },
        select: {
          _id: true,
          scheduledMaintenanceNumber: true,
          scheduledMaintenanceNumberWithPrefix: true,
          title: true,
          startsAt: true,
          endsAt: true,
          currentScheduledMaintenanceState: {
            name: true,
          },
        },
        sort: {
          startsAt: data.isOngoing ? SortOrder.Descending : SortOrder.Ascending,
        },
        limit: data.limit,
        skip: 0,
        props: data.props,
      });

    return events.map((event: ScheduledMaintenance): WorkspaceOpenRecord => {
      return {
        number:
          event.scheduledMaintenanceNumberWithPrefix ||
          `#${event.scheduledMaintenanceNumber ?? ""}`,
        title: event.title || "",
        link:
          data.dashboardUrl && event.id
            ? WorkspaceOpenRecords.getRecordLink(
                data.dashboardUrl,
                data.projectId,
                `scheduled-maintenance-events/${event.id.toString()}`,
              )
            : null,
        severity: null,
        // Every event still to come is scheduled; one in progress names its state.
        state: data.isOngoing
          ? event.currentScheduledMaintenanceState?.name || null
          : null,
        startsAt: WorkspaceOpenRecords.toDate(event.startsAt),
        endsAt: WorkspaceOpenRecords.toDate(event.endsAt),
      };
    });
  }

  private static toDate(value: Date | string | undefined | null): Date | null {
    if (!value) {
      return null;
    }

    const date: Date = new Date(value);

    return isNaN(date.getTime()) ? null : date;
  }

  private static getRecordLink(
    dashboardUrl: URL,
    projectId: ObjectID,
    path: string,
  ): string {
    return URL.fromString(dashboardUrl.toString())
      .addRoute(`/${projectId.toString()}/${path}`)
      .toString();
  }

  private static getListLink(data: {
    dashboardUrl: URL;
    projectId: ObjectID;
    kind: WorkspaceOpenRecordKind;
  }): string {
    return WorkspaceOpenRecords.getRecordLink(
      data.dashboardUrl,
      data.projectId,
      LIST_PATHS[data.kind],
    );
  }

  private static async getDashboardUrl(): Promise<URL | null> {
    try {
      return await DatabaseConfig.getDashboardUrl();
    } catch (err) {
      logger.debug(
        "No dashboard address to link the open records to; answering without links.",
      );
      logger.debug(err);
      return null;
    }
  }
}
