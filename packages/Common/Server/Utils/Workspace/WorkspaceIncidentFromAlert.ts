import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../Utils/Markdown/FeedMarkdown";
import AlertService from "../../Services/AlertService";
import IncidentAlertService, {
  PRIVATE_ALERTS_TO_LINK_MESSAGE,
} from "../../Services/IncidentAlertService";
import { OnCallPageRecordType } from "../../Services/OnCallPageService";
import { LinkedAffectedResource } from "../AI/Toolbox/AffectedResourceLinks";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceAnswer,
  WorkspaceRecordName,
} from "./WorkspaceActionAnswers";
import WorkspaceAffectedResources from "./WorkspaceAffectedResources";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";
import WorkspaceNotificationText from "./WorkspaceNotificationText";
import WorkspacePageAbout from "./WorkspacePageAbout";

/*
 * AN INCIDENT DECLARED IN AN ALERT'S OWN CHANNEL IS DECLARED FROM THAT
 * ALERT.
 *
 * `/oneuptime incident` in Slack, or "incident" typed to the Microsoft
 * Teams bot, in the channel OneUptime made for an alert, opened the same
 * blank form as anywhere else, and the incident it declared was linked to
 * nothing: not to the alert the channel is about, not to what the alert is
 * linked to. In the Dashboard, Declare Incident on an alert's page links
 * the alert and starts from its title and its resources.
 *
 * Now a form opened in the channel of an alert that is still open - the
 * channel the alert's notification rule created, never a channel many
 * records are posted to (WorkspacePageAbout, the one rule both chats ask) -
 * says it is declared from that alert, starts from the alert's title (when
 * none was typed) and from the resources the alert is linked to, read as
 * the member (WorkspaceAffectedResources.readAlertResources), and the
 * incident it declares is linked to the alert as one declared from it in
 * the Dashboard is (INCIDENT_ALERT_IDS_TO_LINK_KEY): the incident's Alerts
 * tab lists it, and the project's switches move it along with the incident.
 * A private alert's incident is private too, with the alert's owners, as
 * the Dashboard declares it.
 *
 * Its monitor is not linked: a monitor linked to an incident a person
 * declares pauses its checks, so it is the person's pick under Monitors.
 *
 * The form promises only what the member may do: whether they may link the
 * alert is asked as the form opens, and a member who may not is told so on
 * the form, with the reason, instead of a link it cannot make.
 *
 * Nothing about the alert is trusted from the form: its submission names
 * the alert, which is read again as the member who submits it, and linked
 * only when they may link it - otherwise the incident is declared without
 * the link, and the person is told why. Either way a private alert's
 * incident is private: what the form started from - the alert's title and
 * resources - never lands in an incident the whole project sees.
 */

// The open alert a form is declared from, as the member reads it.
export interface WorkspaceDeclaringAlert {
  alertId: ObjectID;
  // "Alert ALT-3", with its link when it could be built.
  name: WorkspaceRecordName;
  title: string;
  isPrivate: boolean;
  // What the alert is linked to, that the member may view.
  resources: Array<LinkedAffectedResource>;
  /*
   * Why the member may not link the alert to an incident - a sentence of
   * its own - or null when they may.
   */
  linkRefusal: string | null;
}

// What a submission links of the alert it was declared from.
export interface WorkspaceAlertToLink {
  // The alert, linked with the incident (its miscDataProps).
  miscDataProps: JSONObject;
  name: WorkspaceRecordName;
  isPrivate: boolean;
}

// Why the alert a submission names is not linked.
export interface WorkspaceAlertNotLinked {
  // The alert, when the member may read it; null when they may not.
  name: WorkspaceRecordName | null;
  // A sentence of its own: "You do not have permission to ...".
  reason: string;
  /*
   * Whether the alert is private - as the member reads it, or as OneUptime
   * does when they may no longer read it, and true when that read fails.
   * The incident is private all the same (getNotLinkedAnswer says so).
   */
  isPrivate: boolean;
}

// The kind word a form's value names an alert by (WorkspacePageAbout.toValue).
const ALERT_VALUE_PREFIX: string = "alert:";

// What a form and an answer add for a private alert's incident.
const PRIVATE_LIKE_THE_ALERT: string = "It will be private, as the alert is.";
const PRIVATE_AS_THE_ALERT_IS: string = "It is private, as the alert is.";

/*
 * The one alert a chat form links, refused for being private: said of it,
 * rather than of "some of the alerts" a declaration from many links.
 */
const PRIVATE_ALERT_NOT_LINKABLE: string =
  "It is private, and none of your teams that own it may link it to an incident.";

// Whether the member may link an alert: the ids to link, or why not.
type AlertLinkCheck = { alertIds: Array<ObjectID> } | { reason: string };

/*
 * Where a Microsoft Teams card carries the alert it is declared from: its
 * Create Incident button's data. (A Slack form carries it as its value.)
 */
export const WORKSPACE_DECLARED_FROM_FIELD: string = "declaredFrom";

export default class WorkspaceIncidentFromAlert {
  /*
   * The open alert the channel was made for, read as the member - or null:
   * another channel, a resolved alert's, an incident's, one they may not
   * read. Never throws: an incident form opens either way.
   */
  @CaptureSpan()
  public static async readChannelAlert(data: {
    projectId: ObjectID;
    channelId: string | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceDeclaringAlert | null> {
    if (!(data.channelId || "").trim()) {
      return null;
    }

    try {
      // Which channels are a record's own is the pages' one rule.
      const owner: { type: OnCallPageRecordType; id: ObjectID } | null =
        await WorkspacePageAbout.findChannelRecord({
          projectId: data.projectId,
          channelId: data.channelId,
        });

      if (!owner || owner.type !== OnCallPageRecordType.Alert) {
        return null;
      }

      const found: { record: Alert; event: WorkspaceEventRecord } =
        await WorkspaceMemberActions.readEventForMember<Alert>({
          event: { type: WorkspaceEventType.Alert, id: owner.id },
          props: data.props,
          select: { title: true, isPrivate: true },
          action: "declare an incident from this alert",
        });

      // A resolved alert's channel is no longer the alert's, as for a page.
      if ((await WorkspaceMemberActions.getStanding(found.event)).isResolved) {
        return null;
      }

      /*
       * Whether the member may link it is asked now, as the submission will
       * ask it, so the form says what will happen.
       */
      const [name, resources, linkCheck]: [
        WorkspaceRecordName,
        Array<LinkedAffectedResource>,
        AlertLinkCheck,
      ] = await Promise.all([
        WorkspaceActionAnswers.getRecordName(found.event),
        WorkspaceAffectedResources.readAlertResources({
          projectId: data.projectId,
          alertId: owner.id,
          props: data.props,
        }),
        this.checkMayLink({
          projectId: data.projectId,
          alertId: owner.id,
          props: data.props,
        }),
      ]);

      return {
        alertId: owner.id,
        name: name,
        title: found.record.title?.toString() || "",
        isPrivate: found.record.isPrivate === true,
        resources: resources,
        linkRefusal: "reason" in linkCheck ? linkCheck.reason : null,
      };
    } catch (error) {
      logger.debug(
        `Could not tell whether a chat's incident form was opened in an alert's channel: ${error}`,
      );
      return null;
    }
  }

  /*
   * The form's line, under its heading - the alert by its number, as its
   * title is the form's title already: "This incident will be linked to
   * **[Alert ALT-3](link)**." For a member who may not link it, that it
   * will not be, and why. For a private alert, that the incident will be
   * private too.
   */
  public static getFormLine(alert: WorkspaceDeclaringAlert): MarkdownText {
    const name: MarkdownText = WorkspaceActionAnswers.getRecordMarkdown(
      alert.name,
    );
    const privately: MarkdownText = alert.isPrivate
      ? mdText` ${PRIVATE_LIKE_THE_ALERT}`
      : FeedMarkdown.empty();

    if (alert.linkRefusal) {
      return mdText`This incident will not be linked to ${name}. ${alert.linkRefusal.trim()}${privately}`;
    }

    return mdText`This incident will be linked to ${name}.${privately}`;
  }

  // What a form carries of the alert it is declared from: "alert:<id>".
  public static toValue(alertId: ObjectID): string {
    return `${ALERT_VALUE_PREFIX}${alertId.toString()}`;
  }

  // The alert a form's value names; null for any other value.
  public static readValue(value: unknown): ObjectID | null {
    if (typeof value !== "string") {
      return null;
    }

    const parsed: { type: OnCallPageRecordType; id: ObjectID } | null =
      WorkspacePageAbout.parseValue(value);

    return parsed?.type === OnCallPageRecordType.Alert ? parsed.id : null;
  }

  /*
   * The alert a submission names, read again as the member who submits it:
   * linked when they may read it and may link it to an incident - the
   * check a declaration from alerts runs before anything is written
   * (IncidentAlertService.validateAlertIdsForNewIncident). Otherwise why it
   * is not, for the person: the incident is declared all the same - and
   * whether the alert is private, which its incident then is too.
   */
  @CaptureSpan()
  public static async checkLink(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<WorkspaceAlertToLink | WorkspaceAlertNotLinked> {
    let event: WorkspaceEventRecord;
    let alert: Alert;

    try {
      const found: { record: Alert; event: WorkspaceEventRecord } =
        await WorkspaceMemberActions.readEventForMember<Alert>({
          event: { type: WorkspaceEventType.Alert, id: data.alertId },
          props: data.props,
          select: { isPrivate: true },
          action: "link this alert to an incident",
        });

      event = found.event;
      alert = found.record;
    } catch (error) {
      return {
        name: null,
        reason: this.getReason(error),
        isPrivate: await this.isPrivateAsOneUptimeReadsIt(data),
      };
    }

    const name: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(event);
    const isPrivate: boolean = alert.isPrivate === true;
    const linkCheck: AlertLinkCheck = await this.checkMayLink(data);

    if ("reason" in linkCheck) {
      return { name: name, reason: linkCheck.reason, isPrivate: isPrivate };
    }

    return {
      miscDataProps: {
        [INCIDENT_ALERT_IDS_TO_LINK_KEY]: linkCheck.alertIds.map(
          (id: ObjectID): string => {
            return id.toString();
          },
        ),
      },
      name: name,
      isPrivate: isPrivate,
    };
  }

  public static isLinked(
    result: WorkspaceAlertToLink | WorkspaceAlertNotLinked,
  ): result is WorkspaceAlertToLink {
    return Boolean((result as WorkspaceAlertToLink).miscDataProps);
  }

  /*
   * What the person who declared an incident from a chat is told of what
   * they asked for and is not linked - only them (Slack: a message only
   * they see; Microsoft Teams: a reply that mentions them) - or null when
   * everything was linked. It names the incident, as it may be read away
   * from the confirmation (a direct message), and each part's reason in a
   * sentence of its own:
   *
   *   **[Incident INC-43](link)** is not linked to 2 resources you picked:
   *   they were deleted or archived, or you may no longer view them.
   *   It is not linked to **[Alert ALT-3](link)** either. You do not have
   *   permission to link alerts to incidents in this project. It is
   *   private, as the alert is.
   */
  public static getNotLinkedAnswer(data: {
    incident: WorkspaceRecordName;
    notLinkedCount: number;
    alertNotLinked: WorkspaceAlertNotLinked | null;
  }): WorkspaceAnswer | null {
    const lines: Array<MarkdownText> = [];
    let subject: MarkdownText = WorkspaceActionAnswers.getRecordMarkdown(
      data.incident,
    );

    const resourcesLine: MarkdownText | null =
      WorkspaceAffectedResources.getNotLinkedLine({
        subject: subject,
        count: data.notLinkedCount,
      });

    if (resourcesLine) {
      lines.push(resourcesLine);
      subject = mdText`It`;
    }

    const alert: WorkspaceAlertNotLinked | null = data.alertNotLinked;

    if (alert) {
      const either: MarkdownText = resourcesLine
        ? mdText` either`
        : FeedMarkdown.empty();
      const name: MarkdownText = alert.name
        ? WorkspaceActionAnswers.getRecordMarkdown(alert.name)
        : mdText`this channel's alert`;
      const privately: MarkdownText = alert.isPrivate
        ? mdText` ${PRIVATE_AS_THE_ALERT_IS}`
        : FeedMarkdown.empty();

      lines.push(
        mdText`${subject} is not linked to ${name}${either}. ${alert.reason.trim()}${privately}`,
      );
    }

    if (lines.length === 0) {
      return null;
    }

    const markdown: string = FeedMarkdown.join(lines, "\n\n").toString();

    return {
      markdown: markdown,
      text: WorkspaceNotificationText.fromMarkdown(markdown),
    };
  }

  /*
   * getNotLinkedAnswer for an incident a chat just declared, named and
   * linked as its answers name records - or null, without reading anything,
   * when everything was linked.
   */
  @CaptureSpan()
  public static async readNotLinkedAnswer(data: {
    projectId: ObjectID;
    incident: Incident;
    notLinkedCount: number;
    alertNotLinked: WorkspaceAlertNotLinked | null;
  }): Promise<WorkspaceAnswer | null> {
    if (data.notLinkedCount <= 0 && !data.alertNotLinked) {
      return null;
    }

    const incident: WorkspaceRecordName = data.incident.id
      ? await WorkspaceActionAnswers.getRecordName({
          type: WorkspaceEventType.Incident,
          id: data.incident.id,
          projectId: data.projectId,
          currentStateId: undefined,
          number: data.incident.incidentNumber ?? null,
          numberWithPrefix: data.incident.incidentNumberWithPrefix || null,
        })
      : { label: "The incident", link: null };

    return this.getNotLinkedAnswer({
      incident: incident,
      notLinkedCount: data.notLinkedCount,
      alertNotLinked: data.alertNotLinked,
    });
  }

  /*
   * Whether the member may link the alert to a new incident, as a
   * declaration from alerts asks it before anything is written
   * (IncidentAlertService.validateAlertIdsForNewIncident): the ids to link,
   * or why not. Read with a copy of their props, which the permission
   * layer writes to.
   */
  private static async checkMayLink(data: {
    projectId: ObjectID;
    alertId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<AlertLinkCheck> {
    try {
      return {
        alertIds: await IncidentAlertService.validateAlertIdsForNewIncident({
          projectId: data.projectId,
          alertIds: [data.alertId.toString()],
          props: { ...data.props },
        }),
      };
    } catch (error) {
      return { reason: this.getReason(error) };
    }
  }

  /*
   * Whether an alert the member may no longer read is private, read as
   * OneUptime in the project - only to keep a private alert's incident
   * private, never to tell them anything of it. An alert that is gone is
   * not; a read that fails counts as private.
   */
  private static async isPrivateAsOneUptimeReadsIt(data: {
    projectId: ObjectID;
    alertId: ObjectID;
  }): Promise<boolean> {
    try {
      const alert: Alert | null = await AlertService.findOneBy({
        query: { _id: data.alertId, projectId: data.projectId },
        select: { isPrivate: true },
        props: { isRoot: true },
      });

      return alert?.isPrivate === true;
    } catch (error) {
      logger.debug(
        `Could not tell whether the alert a chat's incident was declared from is private: ${error}`,
      );
      return true;
    }
  }

  // A refusal's words, for the person; a generic line for anything else.
  private static getReason(error: unknown): string {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof BadDataException
    ) {
      // A declaration from many alerts says "some of the alerts"; this links one.
      return error.message === PRIVATE_ALERTS_TO_LINK_MESSAGE
        ? PRIVATE_ALERT_NOT_LINKABLE
        : error.message;
    }

    logger.debug(
      `Could not link an alert to an incident from a chat: ${error}`,
    );

    return "It could not be read just now.";
  }
}
