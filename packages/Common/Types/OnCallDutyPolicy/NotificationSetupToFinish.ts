/*
 * WHETHER A PERSON HAS THEIR NOTIFICATION SETUP TO FINISH, by their on-call
 * readiness (Common/Server/Services/OnCallReadinessService). One rule, read
 * in every place that says so:
 *
 *   - the setup reminder mails them about it, and skips anybody it is not
 *     true of (OnCallSetupReminderService);
 *   - On-Call > Readiness lets an admin pick them for that reminder
 *     (Pages/OnCallDuty/Readiness.tsx, isRemindable);
 *   - the Dashboard's notification bell asks them, while they are on an
 *     on-call policy, to finish it themselves (#7040).
 *
 * It is so while they are anything but Ready - nothing reaches them, or a
 * severity has no rule of theirs - or, while their project asks everyone on
 * call for a phone method (#7449), they have no verified one: that changes
 * nobody's status, so it is read on its own (isMissingPhoneMethod).
 */

// ReadinessStatus.Ready, as the server writes it (held to it by a test).
export const READY_READINESS_STATUS: string = "Ready";

export interface NotificationSetupReadiness {
  status: string;
  isMissingPhoneMethod?: boolean | undefined;
}

export const hasNotificationSetupToFinish: (
  readiness: NotificationSetupReadiness,
) => boolean = (readiness: NotificationSetupReadiness): boolean => {
  return (
    readiness.status !== READY_READINESS_STATUS ||
    readiness.isMissingPhoneMethod === true
  );
};
