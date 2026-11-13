/*
 * THE ENGLISH LINES A PAGE WRITES ABOUT ONE PERSON, OR ONE TARGET, WHO WAS
 * NOT PAGED.
 *
 * Each is the status message of a line of the run's timeline (and of the
 * person's own notification log): read on the run's Execution Logs, in the
 * record's feed and in the run's Slack and Microsoft Teams message. They
 * stay in English there, as every execution log does.
 *
 * They are kept here, React-free and server-safe, so a reader can tell them
 * apart by what they say: a test page's result reads them back into codes
 * the Dashboard words in the reader's language (OnCallTestPageLine).
 */

/*
 * The status message the zero-rule dead-end wrote before the fallback existed,
 * kept verbatim. A project that sets `disableOnCallNotificationFallback` is
 * asking for precisely the old behaviour, so it must still receive precisely
 * the old words - operators grep their execution logs for this sentence, and a
 * characterisation test pins it character for character.
 */
export const NO_NOTIFICATION_RULES_STATUS_MESSAGE: string =
  "No notification rules found for this user. User should add the rules in User Settings > How to Reach Me.";

/*
 * The line's first sentence, what it is about. A log written before the
 * page was called How to Reach Me (#6820) names the page by its old name
 * after it, and is the same line.
 */
const NO_NOTIFICATION_RULES_FIRST_SENTENCE: string =
  "No notification rules found for this user.";

export function isOnCallNoNotificationRulesStatusMessage(
  statusMessage: string | null | undefined,
): boolean {
  const message: string = (statusMessage || "").trim();

  return (
    message === NO_NOTIFICATION_RULES_FIRST_SENTENCE ||
    message.startsWith(NO_NOTIFICATION_RULES_FIRST_SENTENCE + " ")
  );
}

/*
 * Why an on-call notification log sent nothing at all: the person it pages
 * is not a member of the project (they left, or never accepted their
 * invitation). The rules that choose what a page goes through are read only
 * while the person is a member, so this is what is left when somebody who is
 * not one reaches this far - when the escalation could not read membership
 * and paged as before.
 */
export const NOT_A_PROJECT_MEMBER_STATUS_MESSAGE: string =
  "Not sent because this user is not a member of the project.";

/*
 * The escalation timeline's line for a recipient the rule would have paged
 * who is not a member of the project (they left, or never accepted their
 * invitation): nothing is sent to them.
 */
export const NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE: string =
  "Skipped because this user is not a member of the project.";

// The escalation timeline's line for somebody it is paging now.
export const SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE: string =
  "Sending notification to user.";

// The escalation timeline's line for a schedule with nobody on call.
export const NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE: string =
  "Skipped because no active users are found in this schedule.";

// A run of a policy that has no escalation rules.
export const ON_CALL_POLICY_HAS_NO_ESCALATION_RULES_MESSAGE: string =
  "No Escalation Rules in Policy. Please add escalation rules to this policy.";

/*
 * A person who opted out of pages of the severity: "You have opted out of
 * notifications for Sev4 incidents."
 */
const OPTED_OUT_PREFIX: string = "You have opted out of notifications for ";

export function getOnCallOptedOutStatusMessage(data: {
  severityName: string;
  // What is paged, as a noun: "incidents", "alert episodes".
  pagedFor: string;
}): string {
  return `${OPTED_OUT_PREFIX}${data.severityName} ${data.pagedFor}.`;
}

export function isOnCallOptedOutStatusMessage(
  statusMessage: string | null | undefined,
): boolean {
  const message: string = (statusMessage || "").trim();

  return message.startsWith(OPTED_OUT_PREFIX) && message.endsWith(".");
}

/*
 * A person with no rule for the severity, whose verified methods were paged
 * instead: "No notification rule configured for Sev1; notified via fallback
 * (Push, Email)."
 */
const FALLBACK_NOTIFIED_PREFIX: string = "No notification rule configured for ";
const FALLBACK_NOTIFIED_MIDDLE: string = "; notified via fallback (";

export function getOnCallFallbackNotifiedStatusMessage(data: {
  severityName: string;
  channelsUsed: ReadonlyArray<string>;
}): string {
  return `${FALLBACK_NOTIFIED_PREFIX}${data.severityName}${FALLBACK_NOTIFIED_MIDDLE}${data.channelsUsed.join(", ")}).`;
}

export function isOnCallFallbackNotifiedStatusMessage(
  statusMessage: string | null | undefined,
): boolean {
  const message: string = (statusMessage || "").trim();

  return (
    message.startsWith(FALLBACK_NOTIFIED_PREFIX) &&
    message.includes(FALLBACK_NOTIFIED_MIDDLE) &&
    message.endsWith(").")
  );
}

/*
 * A person with no rule for the severity and no verified method for the
 * fallback: "Jane Doe has no verified notification method, so this page
 * could not be delivered. Ask them to add one in User Settings >
 * Notification Methods."
 */
const NO_VERIFIED_METHOD_SUFFIX: string =
  " has no verified notification method, so this page could not be delivered. Ask them to add one in User Settings > Notification Methods.";

export function getOnCallNoVerifiedMethodStatusMessage(
  responderLabel: string,
): string {
  return `${responderLabel}${NO_VERIFIED_METHOD_SUFFIX}`;
}

export function isOnCallNoVerifiedMethodStatusMessage(
  statusMessage: string | null | undefined,
): boolean {
  const message: string = (statusMessage || "").trim();

  return (
    message.length > NO_VERIFIED_METHOD_SUFFIX.length &&
    message.endsWith(NO_VERIFIED_METHOD_SUFFIX)
  );
}

/*
 * A person with no rule for the severity, whose fallback failed: "Jane Doe
 * has no notification rule for Sev1 and the fallback delivery attempt
 * failed, so this page was not delivered. Check the worker logs, then add a
 * rule in User Settings > How to Reach Me."
 */
const FALLBACK_FAILED_MIDDLE: string = " has no notification rule for ";
const FALLBACK_FAILED_SUFFIX: string =
  " and the fallback delivery attempt failed, so this page was not delivered. Check the worker logs, then add a rule in User Settings > How to Reach Me.";

/*
 * What the line says happened, before the page it sends the reader to: a
 * log written before the page was called How to Reach Me (#6820) names the
 * page by its old name after it, and is the same line.
 */
const FALLBACK_FAILED_REASON: string =
  " and the fallback delivery attempt failed, so this page was not delivered.";

export function getOnCallFallbackFailedStatusMessage(data: {
  responderLabel: string;
  severityName: string;
}): string {
  return `${data.responderLabel}${FALLBACK_FAILED_MIDDLE}${data.severityName}${FALLBACK_FAILED_SUFFIX}`;
}

export function isOnCallFallbackFailedStatusMessage(
  statusMessage: string | null | undefined,
): boolean {
  const message: string = (statusMessage || "").trim();

  return (
    message.includes(FALLBACK_FAILED_MIDDLE) &&
    message.includes(FALLBACK_FAILED_REASON)
  );
}

/*
 * A push that is not sent to a device, or a browser, that no longer
 * receives push notifications (its method is not verified any more).
 */
export const PUSH_NOT_SENT_TO_APP_THAT_NO_LONGER_RECEIVES_MESSAGE: string =
  "Push notification not sent: this device no longer receives push notifications. Open the mobile app on it to register it again.";

export const PUSH_NOT_SENT_TO_BROWSER_THAT_NO_LONGER_RECEIVES_MESSAGE: string =
  "Push notification not sent: this browser no longer receives push notifications. Register it again from User Settings > Notification Methods > Push in that browser.";
