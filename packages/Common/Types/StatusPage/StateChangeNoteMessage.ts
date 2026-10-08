import Text from "../Text";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";

/*
 * WHAT A PUBLIC NOTE POSTED WITH A STATE CHANGE ADDS TO ITS MESSAGES.
 *
 * With "Notify Status Page Subscribers" on, the public note posted with a
 * state change is the one message subscribers get about the change, for
 * incidents and scheduled maintenance alike
 * (StateChangeSubscriberNotification). The note's default messages never
 * said what the change was, so subscribers did not learn the state. Such a
 * note now carries the state the event moved to
 * (Server/Utils/StatusPage/StateChangePublicNote), and every default message
 * of it names that state, in the words the state change's own message used:
 *
 *   - the email: a "Status" row in its details, and the subject the state
 *     change email had ("[Resolved Incident] Checkout is down");
 *   - the SMS: "Incident Checkout is down on Acme Status is Resolved.";
 *   - Slack and Microsoft Teams: a "**Status:** Resolved" line;
 *   - the webhook payload: `incidentState` / `scheduledMaintenanceState` in
 *     `data`, named as in the state change's own payload.
 *
 * A note posted on its own carries no state, and its messages are as they
 * always were. Custom templates already have the state, as
 * {{incidentState}} and {{scheduledMaintenanceState}}: for a note posted
 * with a state change it is the state the change moved to.
 */
export default class StateChangeNoteMessage {
  // The label of the line every chat message and email names the state on.
  public static readonly statusLabel: string = "Status";

  // A state as the state change messages always wrote it: "Resolved".
  public static formatStateName(stateName: string): string {
    return Text.uppercaseFirstLetter(stateName.trim());
  }

  // The default incident email's subject: "[Resolved Incident] <title>".
  public static getIncidentEmailSubject(data: {
    stateName: string;
    incidentTitle: string;
  }): string {
    return `[${this.formatStateName(data.stateName)} Incident] ${data.incidentTitle}`;
  }

  /*
   * A custom incident email template's subject when it has none of its own:
   * "[Incident Resolved] <title>", as the state change's was.
   */
  public static getIncidentCustomTemplateEmailSubject(data: {
    stateName: string;
    incidentTitle: string;
  }): string {
    return `[Incident ${this.formatStateName(data.stateName)}] ${data.incidentTitle}`;
  }

  /*
   * The default scheduled maintenance email's subject:
   * "[Ongoing Scheduled Maintenance] <title>".
   */
  public static getScheduledMaintenanceEmailSubject(data: {
    stateName: string;
    eventTitle: string;
  }): string {
    return `[${this.formatStateName(data.stateName)} Scheduled Maintenance] ${data.eventTitle}`;
  }

  /*
   * A custom scheduled maintenance email template's subject when it has
   * none of its own: "[Scheduled Maintenance Ongoing] <title>".
   */
  public static getScheduledMaintenanceCustomTemplateEmailSubject(data: {
    stateName: string;
    eventTitle: string;
  }): string {
    return `[Scheduled Maintenance ${this.formatStateName(data.stateName)}] ${data.eventTitle}`;
  }

  // How the default incident SMS starts: "Incident <title> on <page> is Resolved."
  public static getIncidentSmsHeadline(data: {
    stateName: string;
    incidentTitle: string;
    statusPageName: string;
  }): string {
    return `Incident ${data.incidentTitle} on ${data.statusPageName} is ${this.formatStateName(data.stateName)}.`;
  }

  /*
   * How the default scheduled maintenance SMS starts:
   * "Maintenance <title> on <page> is Ongoing."
   */
  public static getScheduledMaintenanceSmsHeadline(data: {
    stateName: string;
    eventTitle: string;
    statusPageName: string;
  }): string {
    return `Maintenance ${data.eventTitle} on ${data.statusPageName} is ${this.formatStateName(data.stateName)}.`;
  }

  /*
   * The line a default Slack or Microsoft Teams message names the state on.
   * The state's name is plain text in a Markdown message, placed as text
   * (mdText), so it reads as typed.
   */
  public static getChatStatusLine(stateName: string): MarkdownText {
    return mdText`**${this.statusLabel}:** ${stateName.trim()}`;
  }
}
