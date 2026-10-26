import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import Timezone from "../../../Types/Timezone";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import EmailColorUtil from "../../../Utils/Email/EmailColorUtil";
import { buildNotificationSms } from "../../../Utils/Sms/NotificationSms";
import PushNotificationUtil from "../PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "../WhatsAppTemplateUtil";

/*
 * WHAT AN INCIDENT'S OWNERS ARE TOLD WHEN ITS SLA IS BREACHED.
 *
 * An incident SLA rule gives an incident a response deadline (it is
 * acknowledged by then) and a resolution deadline (it is resolved by then).
 * When one passes, CheckSlaBreaches (Workers) tells the incident's owners -
 * the project's owners when it has none - on every channel each of them has
 * on for "Incident SLA breached" (SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION).
 *
 * The notice used to borrow the "incident created" event, its email and its
 * WhatsApp template: its email said "A new incident has been created", its
 * WhatsApp message "has been created for project ...", and switching off
 * "Incident created" silenced SLA breaches too. It says what happened now -
 * which deadline was missed, when it was, under which rule - in words of its
 * own, on every channel:
 *
 *   email     IncidentOwnerSlaBreached.hbs: "Resolution Deadline:" and
 *             when it was, in the reader's own time zone;
 *   SMS       OneUptime: Incident INC-42 (Checkout is down) missed its SLA
 *             resolution deadline. Turn off in User Settings > Notification
 *             Settings.
 *   call      the same sentence, read out, and how to stop these calls;
 *   push      "SLA breached: Incident INC-42" over "Checkout is down -
 *             missed its SLA resolution deadline.";
 *   WhatsApp  Meta's approved "still open" reminder template (see
 *             WhatsAppTemplateUtil): the incident, its state and how long
 *             it has been open - all true of a missed deadline.
 *
 * Pure: the job reads the incident and its owners, and this words them.
 */

export type IncidentSlaBreachType = "response" | "resolution";

export interface IncidentSlaBreachFacts {
  breachType: IncidentSlaBreachType;
  // When the missed deadline was; undefined when the SLA did not say.
  deadline: Date | undefined;
  slaRuleName: string | undefined;
  incidentTitle: string;
  incidentNumber: number | undefined;
  incidentNumberWithPrefix: string | undefined;
  projectName: string;
  currentStateName: string | undefined;
  currentStateColor: Color | string | undefined;
  severityName: string | undefined;
  severityColor: Color | string | undefined;
  // When the incident was declared (or created): how long it has been open.
  openedAt: Date | undefined;
  incidentViewLink: string;
  // The moment the breach was found: one moment for every owner told of it.
  now: Date;
}

export interface IncidentSlaBreachRecipient {
  timezone?: Timezone | undefined;
  /*
   * Whether they are told as one of the incident's owners - the email says
   * why it came - or as one of the project's owners, for an incident with
   * none.
   */
  isOwner: boolean;
}

export interface IncidentSlaBreachMessages {
  eventType: NotificationSettingEventType;
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  callRequestMessage: CallRequestMessage;
  pushNotificationMessage: PushNotificationMessage;
  whatsAppMessage: WhatsAppMessagePayload;
}

export default class IncidentSlaBreachNotice {
  public static readonly EVENT_TYPE: NotificationSettingEventType =
    NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION;

  // The push notification's tag: a second breach replaces the first's.
  public static readonly PUSH_TAG: string = "incident-sla-breached";

  // "INC-42", "#42", or "" for an incident without a number.
  public static getIncidentNumberText(facts: IncidentSlaBreachFacts): string {
    if (facts.incidentNumberWithPrefix) {
      return facts.incidentNumberWithPrefix;
    }

    return facts.incidentNumber !== undefined && facts.incidentNumber !== null
      ? `#${facts.incidentNumber}`
      : "";
  }

  // "INC-42 (Checkout is down)", or the title alone without a number.
  public static getIncidentIdentifier(facts: IncidentSlaBreachFacts): string {
    const number: string = IncidentSlaBreachNotice.getIncidentNumberText(facts);

    return number ? `${number} (${facts.incidentTitle})` : facts.incidentTitle;
  }

  /*
   * The email's row for the missed deadline: "Resolution Deadline:" and when
   * it was. One row says both which deadline and when - the sentence above
   * the card has already said it was missed.
   */
  public static getDeadlineLabel(breachType: IncidentSlaBreachType): string {
    return breachType === "response"
      ? "Response Deadline:"
      : "Resolution Deadline:";
  }

  // What missing the deadline means, in a sentence of the email.
  public static getBreachSentence(breachType: IncidentSlaBreachType): string {
    return breachType === "response"
      ? "Nobody acknowledged this incident before its SLA response deadline."
      : "This incident was not resolved before its SLA resolution deadline.";
  }

  // "2 hours 5 minutes": how long the incident has been open at `now`.
  public static getOpenDuration(facts: IncidentSlaBreachFacts): string {
    if (!facts.openedAt) {
      return "";
    }

    return OneUptimeDate.convertSecondsToDaysHoursMinutesAndSeconds(
      Math.max(
        0,
        OneUptimeDate.getDifferenceInSeconds(facts.now, facts.openedAt),
      ),
    );
  }

  // Everything one recipient is told, on each channel (see the top).
  public static getMessages(data: {
    facts: IncidentSlaBreachFacts;
    recipient: IncidentSlaBreachRecipient;
  }): IncidentSlaBreachMessages {
    const { facts, recipient } = data;
    const breachWord: string = facts.breachType;
    const numberText: string =
      IncidentSlaBreachNotice.getIncidentNumberText(facts);
    const identifier: string =
      IncidentSlaBreachNotice.getIncidentIdentifier(facts);
    const stateName: string = facts.currentStateName || "Open";
    const openDuration: string = IncidentSlaBreachNotice.getOpenDuration(facts);
    // "Incident INC-42 (Checkout is down) missed its SLA resolution deadline."
    const missedSentence: string = `Incident ${identifier} missed its SLA ${breachWord} deadline.`;

    const vars: Dictionary<string> = {
      incidentTitle: facts.incidentTitle,
      incidentNumber: numberText,
      projectName: facts.projectName,
      deadlineLabel: IncidentSlaBreachNotice.getDeadlineLabel(facts.breachType),
      breachSentence: IncidentSlaBreachNotice.getBreachSentence(
        facts.breachType,
      ),
      deadline: facts.deadline
        ? OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: facts.deadline,
            timezones: recipient.timezone ? [recipient.timezone] : [],
          })
        : "",
      slaRuleName: facts.slaRuleName || "",
      currentState: stateName,
      ...EmailColorUtil.getTemplateVariables(
        "currentState",
        facts.currentStateColor,
      ),
      openDuration: openDuration,
      incidentSeverity: facts.severityName || "",
      ...EmailColorUtil.getTemplateVariables(
        "incidentSeverity",
        facts.severityColor,
      ),
      incidentViewLink: facts.incidentViewLink,
    };

    if (recipient.isOwner) {
      vars["isOwner"] = "true";
    }

    const subject: string = `[SLA breached] Incident ${numberText ? `${numberText} ` : ""}missed its ${breachWord} deadline - ${facts.incidentTitle}`;

    return {
      eventType: IncidentSlaBreachNotice.EVENT_TYPE,
      emailEnvelope: {
        templateType: EmailTemplateType.IncidentOwnerSlaBreached,
        vars: vars,
        subject: subject,
        // A title is a person's text: never read as template syntax.
        isSubjectLiteral: true,
      },
      smsMessage: {
        message: buildNotificationSms(missedSentence),
      },
      /*
       * The SMS's sentence, read out: the number and the title set apart
       * (a title read straight into "missed its deadline" is heard as one
       * sentence), and how to stop these calls, as every owner call says.
       */
      callRequestMessage: {
        data: [
          {
            sayMessage: `This is a message from OneUptime. ${missedSentence} Please check the incident in the OneUptime Dashboard. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
          },
        ],
      },
      /*
       * The title names the incident by its number; the body is its title,
       * then - set apart from it - what happened. Run together, "Checkout
       * is down missed its deadline" reads as one sentence.
       */
      pushNotificationMessage: PushNotificationUtil.createGenericNotification({
        title: `SLA breached: Incident ${numberText}`.trim(),
        body: `${facts.incidentTitle} - missed its SLA ${breachWord} deadline.`,
        clickAction: facts.incidentViewLink,
        tag: IncidentSlaBreachNotice.PUSH_TAG,
        requireInteraction: true,
      }),
      whatsAppMessage: createWhatsAppMessageFromTemplate({
        eventType: IncidentSlaBreachNotice.EVENT_TYPE,
        templateVariables: {
          incident_title: facts.incidentTitle,
          incident_state: stateName,
          incident_number:
            facts.incidentNumber !== undefined && facts.incidentNumber !== null
              ? facts.incidentNumber.toString()
              : "",
          elapsed_time: openDuration || "less than a minute",
          incident_link: facts.incidentViewLink,
        },
      }),
    };
  }
}
