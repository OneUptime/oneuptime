import Alert from "../../../Models/DatabaseModels/Alert";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { INCIDENT_ALERT_IDS_TO_LINK_KEY } from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { MarkdownText, mdText } from "../../../Utils/Markdown/FeedMarkdown";
import IncidentAlertService from "../../Services/IncidentAlertService";
import { OnCallPageRecordType } from "../../Services/OnCallPageService";
import { LinkedAffectedResource } from "../AI/Toolbox/AffectedResourceLinks";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import WorkspaceActionAnswers, {
  WorkspaceRecordName,
} from "./WorkspaceActionAnswers";
import WorkspaceAffectedResources from "./WorkspaceAffectedResources";
import WorkspaceMemberActions, {
  WorkspaceEventRecord,
  WorkspaceEventType,
} from "./WorkspaceMemberActions";
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
 * Nothing about the alert is trusted from the form: its submission names
 * the alert, which is read again as the member who submits it, and linked
 * only when they may link it - otherwise the incident is declared without
 * the link, and the confirmation says why.
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
  reason: string;
}

// The kind word a form's value names an alert by (WorkspacePageAbout.toValue).
const ALERT_VALUE_PREFIX: string = "alert:";

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

      const [name, resources]: [
        WorkspaceRecordName,
        Array<LinkedAffectedResource>,
      ] = await Promise.all([
        WorkspaceActionAnswers.getRecordName(found.event),
        WorkspaceAffectedResources.readAlertResources({
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
      };
    } catch (error) {
      logger.debug(
        `Could not tell whether a chat's incident form was opened in an alert's channel: ${error}`,
      );
      return null;
    }
  }

  /*
   * The form's line, under its heading: "This incident will be linked to
   * **[Alert ALT-3](link)**, Disk almost full." - and, for a private
   * alert, that the incident is private like it.
   */
  public static getFormLine(alert: WorkspaceDeclaringAlert): MarkdownText {
    const name: MarkdownText = WorkspaceActionAnswers.getRecordMarkdown(
      alert.name,
    );
    const title: string = alert.title.trim();
    const about: MarkdownText = title ? mdText`${name}, ${title}` : name;

    return alert.isPrivate
      ? mdText`This incident will be linked to ${about}, and private like it.`
      : mdText`This incident will be linked to ${about}.`;
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
   * is not, for the confirmation: the incident is declared all the same.
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
      };
    }

    const name: WorkspaceRecordName =
      await WorkspaceActionAnswers.getRecordName(event);

    try {
      const alertIds: Array<ObjectID> =
        await IncidentAlertService.validateAlertIdsForNewIncident({
          projectId: data.projectId,
          alertIds: [data.alertId.toString()],
          props: data.props,
        });

      return {
        miscDataProps: {
          [INCIDENT_ALERT_IDS_TO_LINK_KEY]: alertIds.map(
            (id: ObjectID): string => {
              return id.toString();
            },
          ),
        },
        name: name,
        isPrivate: alert.isPrivate === true,
      };
    } catch (error) {
      return { name: name, reason: this.getReason(error) };
    }
  }

  public static isLinked(
    result: WorkspaceAlertToLink | WorkspaceAlertNotLinked,
  ): result is WorkspaceAlertToLink {
    return Boolean((result as WorkspaceAlertToLink).miscDataProps);
  }

  /*
   * The line for an alert that was not linked, to the person who declared
   * the incident: "The incident was not linked to **Alert ALT-3**: <why>"
   * - the reason as text.
   */
  public static getNotLinkedLine(result: WorkspaceAlertNotLinked): MarkdownText {
    const reason: string = result.reason.trim();

    if (!result.name) {
      return mdText`The incident was not linked to this channel's alert: ${reason}`;
    }

    return mdText`The incident was not linked to ${WorkspaceActionAnswers.getRecordMarkdown(result.name)}: ${reason}`;
  }

  // The same line as plain text, for a notification.
  public static getNotLinkedText(result: WorkspaceAlertNotLinked): string {
    const reason: string = result.reason.trim();

    return result.name
      ? `The incident was not linked to ${result.name.label}: ${reason}`
      : `The incident was not linked to this channel's alert: ${reason}`;
  }

  // A refusal's words, for the person; a generic line for anything else.
  private static getReason(error: unknown): string {
    if (
      error instanceof NotAuthorizedException ||
      error instanceof BadDataException
    ) {
      return error.message;
    }

    logger.debug(`Could not link an alert to an incident from a chat: ${error}`);

    return "It could not be read just now.";
  }
}
