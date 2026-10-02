import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import IncomingCallStatus from "../../../Types/IncomingCall/IncomingCallStatus";
import { MissedIncomingCallReason } from "../../../Types/IncomingCall/MissedIncomingCall";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import Timezone from "../../../Types/Timezone";
import { WhatsAppMessagePayload } from "../../../Types/WhatsApp/WhatsAppMessage";
import PushNotificationUtil from "../PushNotificationUtil";

/*
 * What an Incoming Call Policy's owners are told when a call to it reaches
 * nobody: who called, which number they dialled, why nobody picked up, and
 * who was rung on the way.
 *
 * This file is the pure half - what the message says on every channel.
 * IncomingCallMissedCallNotificationService does the reads and the sends.
 */

export interface MissedCallAttempt {
  // Plain text, as stored. Escaped wherever it is rendered.
  userName: string;
  phoneNumber: string;
  // The escalation rule that rang this person. Empty when the rule is gone.
  ruleName: string;
  status: IncomingCallStatus | undefined;
  // How long the phone rang. Undefined when the attempt never finished.
  ringSeconds: number | undefined;
}

export interface MissedCall {
  // Plain text, exactly as the user typed it. Escaped wherever it is rendered.
  policyName: string;
  projectName: string;
  // Empty when the call provider did not send one.
  callerPhoneNumber: string;
  routingPhoneNumber: string;
  reason: MissedIncomingCallReason;
  // The status message stored on the call log, shown for an unexpected failure.
  statusMessage: string;
  startedAt: Date | undefined;
  endedAt: Date | undefined;
  // In the order they were rung.
  attempts: Array<MissedCallAttempt>;
  incomingCallLogViewLink: string;
}

export interface MissedCallNotificationContent {
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  callRequestMessage: CallRequestMessage;
  pushNotificationMessage: PushNotificationMessage;
  whatsAppMessage: WhatsAppMessagePayload;
}

export default class MissedCallNotification {
  // How many attempts the email lists before it points at the call log.
  public static readonly MAX_ATTEMPTS_IN_EMAIL: number = 25;

  public static readonly EVENT_TYPE: NotificationSettingEventType =
    NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION;

  public static getCallerLabel(call: MissedCall): string {
    return call.callerPhoneNumber.trim() || "an unknown number";
  }

  public static getEmailSubject(call: MissedCall): string {
    return `Missed call from ${MissedCallNotification.getCallerLabel(call)} to ${call.policyName}`;
  }

  // The outcome in a few words: the email's Result field.
  public static getResult(reason: MissedIncomingCallReason): string {
    switch (reason) {
      case MissedIncomingCallReason.NoAnswer:
        return "Nobody answered";
      case MissedIncomingCallReason.CallerHungUp:
        return "Caller hung up before anyone answered";
      case MissedIncomingCallReason.NoOneAvailable:
        return "Nobody was available";
      case MissedIncomingCallReason.PolicyDisabled:
        return "Policy is disabled";
      default:
        return "Call could not be routed";
    }
  }

  // One sentence for SMS, voice and push: "+1… called Support. Nobody answered."
  public static getSummary(call: MissedCall): string {
    return `${MissedCallNotification.getCallerLabel(call)} called ${call.policyName}. ${MissedCallNotification.getResult(call.reason)}.`;
  }

  /*
   * What happened, for the top of the email: what the caller went through and
   * the one thing to check when it is a configuration problem rather than a
   * busy line.
   */
  public static getExplanation(call: MissedCall): string {
    switch (call.reason) {
      case MissedIncomingCallReason.NoAnswer:
        return "Nobody answered. OneUptime went through the escalation rules, then played your No Answer Message to the caller and ended the call.";

      case MissedIncomingCallReason.CallerHungUp: {
        const waitedSeconds: number | undefined =
          MissedCallNotification.getSecondsBetween(
            call.startedAt,
            call.endedAt,
          );

        const waited: string =
          waitedSeconds !== undefined
            ? ` after waiting ${MissedCallNotification.formatDuration(waitedSeconds)}`
            : "";

        return `The caller hung up${waited}, before anyone answered.`;
      }

      case MissedIncomingCallReason.NoOneAvailable:
        return "Nobody was rung. No escalation rule had an on-call user with a verified incoming call number, so OneUptime played your No One Available Message to the caller and ended the call.";

      case MissedIncomingCallReason.PolicyDisabled:
        return "Nobody was rung because this incoming call policy is disabled. The caller was told the service is disabled and the call ended.";

      default:
        return call.statusMessage.trim()
          ? `The call could not be routed to anyone: ${call.statusMessage.trim()}`
          : "The call could not be routed to anyone.";
    }
  }

  // "No answer after 30 seconds", "Line busy", "Caller hung up while ringing".
  public static getAttemptResult(attempt: MissedCallAttempt): string {
    const rang: string =
      attempt.ringSeconds !== undefined
        ? ` after ${MissedCallNotification.formatDuration(attempt.ringSeconds)}`
        : "";

    switch (attempt.status) {
      case IncomingCallStatus.NoAnswer:
        return `No answer${rang}`;
      case IncomingCallStatus.CallerHungUp:
        return `Caller hung up while ringing${rang}`;
      case IncomingCallStatus.Busy:
        return "Line busy";
      case IncomingCallStatus.Failed:
        return "Call failed";
      case IncomingCallStatus.Connected:
      case IncomingCallStatus.Completed:
        return "Answered";
      case IncomingCallStatus.Ringing:
        return "Ringing";
      default:
        return attempt.status ? attempt.status.toString() : "Unknown";
    }
  }

  // "47 seconds", "1 minute", "2 minutes 5 seconds", "1 hour 2 minutes".
  public static formatDuration(totalSeconds: number): string {
    const seconds: number = Math.max(0, Math.round(totalSeconds));
    const hours: number = Math.floor(seconds / 3600);
    const minutes: number = Math.floor((seconds % 3600) / 60);
    const remainingSeconds: number = seconds % 60;

    const parts: Array<string> = [];

    const unit: (value: number, name: string) => string = (
      value: number,
      name: string,
    ): string => {
      return `${value} ${name}${value === 1 ? "" : "s"}`;
    };

    if (hours > 0) {
      parts.push(unit(hours, "hour"));
    }

    if (minutes > 0) {
      parts.push(unit(minutes, "minute"));
    }

    // Seconds are noise next to hours.
    if ((remainingSeconds > 0 && hours === 0) || parts.length === 0) {
      parts.push(unit(remainingSeconds, "second"));
    }

    return parts.join(" ");
  }

  public static getSecondsBetween(
    from: Date | undefined,
    to: Date | undefined,
  ): number | undefined {
    if (!from || !to) {
      return undefined;
    }

    const seconds: number = Math.round(
      (new Date(to).getTime() - new Date(from).getTime()) / 1000,
    );

    return seconds >= 0 ? seconds : undefined;
  }

  public static buildContent(data: {
    call: MissedCall;
    // False when the policy has no owners and this is a project owner.
    isOwner: boolean;
    // The recipient's, for the call time. Undefined shows the usual zones.
    timezone?: Timezone | undefined;
  }): MissedCallNotificationContent {
    const call: MissedCall = data.call;
    const callerLabel: string = MissedCallNotification.getCallerLabel(call);
    const result: string = MissedCallNotification.getResult(call.reason);
    const summary: string = MissedCallNotification.getSummary(call);

    const attemptsShown: Array<MissedCallAttempt> = call.attempts.slice(
      0,
      MissedCallNotification.MAX_ATTEMPTS_IN_EMAIL,
    );
    const moreAttemptsCount: number =
      call.attempts.length - attemptsShown.length;

    const vars: Dictionary<string | JSONObject> = {
      policyName: call.policyName,
      projectName: call.projectName,
      callerPhoneNumber: callerLabel,
      routingPhoneNumber: call.routingPhoneNumber.trim(),
      result: result,
      explanation: MissedCallNotification.getExplanation(call),
      /*
       * Trusted HTML: the date helper emits its own <br/> between zones, and
       * the template renders this through the raw `text` slot for that reason.
       */
      callStartedAt: call.startedAt
        ? OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
            date: call.startedAt,
            timezones: data.timezone ? [data.timezone] : [],
          })
        : "",
      hasAttempts: attemptsShown.length > 0 ? "true" : "false",
      attempts: attemptsShown.map(
        (attempt: MissedCallAttempt, index: number): JSONObject => {
          const details: Array<string> = [];

          if (attempt.ruleName.trim()) {
            details.push(attempt.ruleName.trim());
          }

          if (attempt.phoneNumber.trim()) {
            details.push(attempt.phoneNumber.trim());
          }

          details.push(MissedCallNotification.getAttemptResult(attempt));

          return {
            position: (index + 1).toString(),
            userName: attempt.userName.trim() || "Unknown user",
            details: details.join(" · "),
          };
        },
      ) as unknown as JSONObject,
      hasMoreAttempts: moreAttemptsCount > 0 ? "true" : "false",
      moreAttemptsCount: moreAttemptsCount.toString(),
      incomingCallLogViewLink: call.incomingCallLogViewLink,
    };

    // Picks the OwnerInfo sentence, as on every other owner email.
    if (data.isOwner) {
      vars["isOwner"] = "true";
    }

    const emailEnvelope: EmailEnvelope = {
      templateType: EmailTemplateType.IncomingCallPolicyOwnerMissedCall,
      vars: vars,
      subject: MissedCallNotification.getEmailSubject(call),
      // The policy name is user text; the mailer must not compile it.
      isSubjectLiteral: true,
    };

    const smsMessage: SMSMessage = {
      message: `This is a message from OneUptime. Missed call: ${summary} To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
    };

    const callRequestMessage: CallRequestMessage = {
      data: [
        {
          sayMessage: `This is a message from OneUptime. Missed call. ${summary} To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
        },
      ],
    };

    const pushNotificationMessage: PushNotificationMessage =
      PushNotificationUtil.createGenericNotification({
        title: `Missed call to ${call.policyName}`,
        body: `${callerLabel} called. ${result}. Tap to open the call log.`,
        clickAction: call.incomingCallLogViewLink,
        tag: "incoming-call-missed",
        requireInteraction: false,
      });

    /*
     * No WhatsApp template is registered for this event, and
     * createWhatsAppMessageFromTemplate throws without one. A plain body is
     * sent instead, as the SLO notifications do.
     */
    const whatsAppMessage: WhatsAppMessagePayload = {
      body: smsMessage.message,
    };

    return {
      emailEnvelope,
      smsMessage,
      callRequestMessage,
      pushNotificationMessage,
      whatsAppMessage,
    };
  }
}
