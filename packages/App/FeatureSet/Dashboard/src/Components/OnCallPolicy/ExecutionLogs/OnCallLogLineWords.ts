import { getResultLineSentence } from "../../OnCallTestPage/OnCallTestPageWords";
import OneUptimeDate from "Common/Types/Date";
import { describeOnCallAcknowledgementTimeout } from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  OnCallLogLine,
  OnCallLogLineCode,
  readOnCallLogLine,
} from "Common/Types/OnCallDutyPolicy/OnCallLogLine";
import { CallOutcomeLine } from "Common/Types/OnCallDutyPolicy/OnCallSentLine";
import {
  OnCallPolicyRunLine,
  OnCallPolicyRunLineCode,
  OnCallPolicyRunRecordKind,
  readOnCallPolicyRunLine,
} from "Common/Types/OnCallDutyPolicy/OnCallPolicyRunLine";
import {
  getOnCallPageChannelsOf,
  ON_CALL_PAGE_CHANNELS,
  OnCallPageChannel,
  OnCallPageChannelInfo,
  OnCallPageNotificationMethods,
} from "Common/Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  isOnCallTestPage,
  OnCallTestPageLine,
  OnCallTestPageLineCode,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPage";
import {
  readOnCallTestPageDeliveryLine,
  readOnCallTestPageRunLine,
  readOnCallTestPageStepLine,
} from "Common/Types/OnCallDutyPolicy/OnCallTestPageLine";
import UserNotificationEventType from "Common/Types/UserNotification/UserNotificationEventType";
import NotificationMethodUtil, {
  ColumnValueReader,
} from "Common/UI/Utils/NotificationMethodUtil";
import { errorInSentence } from "Common/UI/Utils/ErrorInSentence";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import {
  PluralTemplate,
  TemplateValue,
  translatableTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * AN ON-CALL LOG'S LINES IN THE READER'S WORDS (#8330).
 *
 * Every row of a page's logs says why in its status message, in English:
 * a notification on a person's on-call timeline (UserOnCallLogTimeline),
 * the person's page (UserOnCallLog), a step of a run's timeline
 * (OnCallDutyPolicyExecutionLogTimeline) and the run itself
 * (OnCallDutyPolicyExecutionLog). A test page's result has read OneUptime's
 * own lines back into codes since #7260, #7550 (OnCallTestPageLine) and
 * worded them in the reader's language (OnCallTestPageWords); the logs'
 * View Status Message dialogs drew the English line as it was: English on a
 * German page, laid out right to left on an Arabic or Persian one, its full
 * stop first and a phone number's "+" after its digits.
 *
 * The logs read the same codes, and a run's own ending too
 * (OnCallPolicyRunLine). Two things set a log apart from a test's result:
 *
 *   - most of its rows are real pages, and a test's sentences say "the
 *     test" ("so the test can't use it", "Already paged by this test"):
 *     a real page's row says what happened to the page instead
 *     (REAL_PAGE_LINE_SENTENCES). A line only a test writes is never
 *     worded as a real page's;
 *   - it is read later, so what a test's live result says of now is said
 *     of then: "Nobody was on call in schedule Primary." (LOG_LINE_SENTENCES).
 *
 * A line with no code is OneUptime's own words only when the Dashboard
 * words it - as the dialog always looked it up - and otherwise drawn as
 * written, a line of its own that reads left to right on an Arabic or
 * Persian page (ResultLine, IsolatedLine).
 */

/*
 * The line in a View Status Message dialog: it wraps, so a line drawn as
 * written on an Arabic or Persian page lines each of its lines up at the
 * page's side (IsolatedLine).
 */
export const ON_CALL_LOG_DIALOG_LINE_CLASS_NAME: string = "break-words";

/*
 * A notification not sent because its method is not verified, on a real
 * page: what the server's line says, the address left to the row's
 * Notification Method column.
 */
export const REAL_PAGE_NOT_VERIFIED_SENTENCES: Readonly<
  Partial<Record<OnCallPageChannel, string>>
> = {
  [OnCallPageChannel.Email]: translationKey(
    "Email notification not sent because this email address is not verified.",
  ),
  [OnCallPageChannel.SMS]: translationKey(
    "SMS not sent because this phone number is not verified.",
  ),
  [OnCallPageChannel.WhatsApp]: translationKey(
    "WhatsApp message not sent because this phone number is not verified.",
  ),
  [OnCallPageChannel.Call]: translationKey(
    "Call not made because this phone number is not verified.",
  ),
  [OnCallPageChannel.Telegram]: translationKey(
    "Telegram message not sent because the Telegram account is not verified.",
  ),
  [OnCallPageChannel.Slack]: translationKey(
    "Slack message not sent because the Slack account is not verified.",
  ),
  [OnCallPageChannel.MicrosoftTeams]: translationKey(
    "Microsoft Teams message not sent because the Microsoft Teams account is not verified.",
  ),
  [OnCallPageChannel.Mattermost]: translationKey(
    "Mattermost message not sent because the Mattermost account is not verified.",
  ),
  [OnCallPageChannel.CustomChannel]: translationKey(
    "Not sent: this custom channel is turned off.",
  ),
};

/*
 * A person's line on a real page, where a test's says "the test": what
 * became of the page.
 */
export const REAL_PAGE_LINE_SENTENCES: Readonly<{
  optedOut: string;
  noRuleNoFallback: string;
  noRuleFallsBack: string;
  alreadyPaged: string;
  sendingToPerson: string;
}> = {
  optedOut: translationKey(
    "Opted out of pages of this severity, so nothing was sent.",
  ),
  noRuleNoFallback: translationKey(
    "No on-call rule covers this severity, and this project does not fall back to verified methods, so nothing was sent.",
  ),
  noRuleFallsBack: translationKey(
    "No on-call rule covers this severity, so the page went to every verified method instead.",
  ),
  alreadyPaged: translationKey("Already paged for this, so not paged again."),
  sendingToPerson: translationKey("Sending notifications to this person."),
};

/*
 * What a log says of then, where a test's live result says now - a test
 * page's rows too, read once it is over.
 */
export const LOG_LINE_SENTENCES: Readonly<{
  nobodyOnCall: string;
  nobodyNextInRotation: string;
  awayWithNobodyCovering: string;
}> = {
  nobodyOnCall: translationKey("Nobody was on call in schedule {{name}}."),
  nobodyNextInRotation: translationKey(
    "Nobody was next in the rotation of schedule {{name}}.",
  ),
  awayWithNobodyCovering: translationKey(
    "{{name}} was away until {{time}}, with nobody covering.",
  ),
};

/*
 * How a policy's run ended (OnCallPolicyRunLine), in the reader's words.
 * English reads as the run's own line, but where the record is named: a
 * whole sentence for each kind, as its grammar asks.
 */
export const RUN_LINE_SENTENCES: Readonly<{
  wentThroughEveryRule: string;
  everybodyEscalated: string;
  nobodyNotified: string;
  policyArchivedNotRun: string;
  policyArchivedStopped: string;
  policyHasNoRules: string;
}> = {
  wentThroughEveryRule: translationKey("Execution completed."),
  everybodyEscalated: translationKey(
    "Execution completed: everybody it paged escalated it.",
  ),
  nobodyNotified: translationKey(
    "Execution completed, but no one was notified: no escalation rule of this policy had anybody to page. This policy's owners should add responders to its escalation rules, or check who is on call in its schedules.",
  ),
  policyArchivedNotRun: translationKey(
    "Not executed: this on-call policy is archived, so it paged no one. Unarchive it to use it again.",
  ),
  policyArchivedStopped: translationKey(
    "Execution stopped because the on-call policy was archived. The remaining escalation rules were not run.",
  ),
  policyHasNoRules: translationKey(
    "This policy has no escalation rules, so nobody was paged. Add escalation rules to it.",
  ),
};

// A run that stopped because its record was acknowledged or resolved.
export const RUN_RECORD_HANDLED_SENTENCES: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "Execution completed because the incident was acknowledged or resolved.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "Execution completed because the alert was acknowledged or resolved.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "Execution completed because the incident episode was acknowledged or resolved.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "Execution completed because the alert episode was acknowledged or resolved.",
  ),
};

// A page again that stopped because its record was resolved.
export const RUN_RECORD_RESOLVED_SENTENCES: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "Execution completed because the incident was resolved.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "Execution completed because the alert was resolved.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "Execution completed because the incident episode was resolved.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "Execution completed because the alert episode was resolved.",
  ),
};

/*
 * THE REST OF A LOG'S OWN LINES (OnCallLogLine, #8434), in the reader's
 * words: a run on its way, a direct page's, a page again's, a run or a
 * page that timed out or ran out of tries, a step skipped because the page
 * was escalated, a person's page, a notification that went out or was
 * acknowledged. A log is read later, so each says what happened then; a
 * real page's never says "test", and a test page's own paging lines are
 * worded on a test page's row only.
 */
export const LOG_OWN_LINE_SENTENCES: Readonly<{
  runScheduled: string;
  runStarted: string;
  runPagingStarted: string;
  runTimedOut: string;
  runNeverStarted: string;
  directPageNobodyPaged: string;
  directPageTimedOut: string;
  directPageNeverStarted: string;
  pagingAgain: string;
  testPageSentToFirstLevel: string;
  levelSkippedByEscalation: string;
  skippedAsEscalated: string;
  directPageNobodyToPage: string;
  pageSent: string;
  pageEscalated: string;
  pageTimedOut: string;
  notificationAcknowledged: string;
  notificationEscalatedFrom: string;
  emailSent: string;
  pushSent: string;
  telegramSent: string;
  whatsAppSent: string;
  workspaceMessageSent: string;
  sentWithMessageId: string;
  callPlaced: string;
  lastTryFailedWith: string;
}> = {
  runScheduled: translationKey("Scheduled to start."),
  runStarted: translationKey("Execution started."),
  runPagingStarted: translationKey("Paging started."),
  runTimedOut: translationKey("Timed out: this run did not finish starting."),
  runNeverStarted: translationKey("Timed out: this run never started."),
  directPageNobodyPaged: translationKey("Nobody was paged."),
  directPageTimedOut: translationKey("Paging timed out."),
  directPageNeverStarted: translationKey(
    "Paging never started and was timed out.",
  ),
  pagingAgain: translationKey(
    "Paging again ({{number}} of {{max}}): still not resolved {{duration}} after it was acknowledged.",
  ),
  testPageSentToFirstLevel: translationKey(
    "Test page sent to the first escalation level.",
  ),
  levelSkippedByEscalation: translationKey(
    "Skipped: the page was escalated past this level.",
  ),
  skippedAsEscalated: translationKey(
    "Skipped because they escalated this page.",
  ),
  directPageNobodyToPage: translationKey(
    "Skipped because there was nobody to page.",
  ),
  pageSent: translationKey("Notifications sent to this person."),
  pageEscalated: translationKey("Escalated: could not take this page."),
  pageTimedOut: translationKey("Timed out: this page did not finish starting."),
  notificationAcknowledged: translationKey(
    "The page was acknowledged from this notification.",
  ),
  notificationEscalatedFrom: translationKey(
    "Escalated from this notification.",
  ),
  emailSent: translationKey(
    "Email sent. OneUptime does not track whether it was delivered: if it did not arrive, the address may be wrong, the sending domain may be blocked, or it may be in spam.",
  ),
  pushSent: translationKey("Push notification sent."),
  telegramSent: translationKey("Telegram message sent."),
  whatsAppSent: translationKey("WhatsApp message sent."),
  workspaceMessageSent: translationKey("Message sent on {{name}}."),
  sentWithMessageId: translationKey("Sent with message ID {{id}}."),
  callPlaced: translationKey("Call placed with call ID {{id}}."),
  lastTryFailedWith: translationKey("The last try failed with: {{error}}"),
};

// A direct page's run: how many people it paged.
export const LOG_DIRECT_PAGE_PAGED: PluralTemplate = {
  one: "{{count}} person was paged.",
  other: "{{count}} people were paged.",
};

// A test page's run, paging: to how many people it was sent.
export const LOG_TEST_PAGE_SENT: PluralTemplate = {
  one: "Test page sent to {{count}} person.",
  other: "Test page sent to {{count}} people.",
};

// A person's page that did not finish starting, handed over to be sent.
export const LOG_PAGE_HANDED_OVER: PluralTemplate = {
  one: "This page did not finish starting within {{count}} minute, so its notifications were sent from then on.",
  other:
    "This page did not finish starting within {{count}} minutes, so its notifications were sent from then on.",
};

/*
 * A run, or a person's page, that ran out of tries (OnCallPolicyRunRetry):
 * how many tries, over how long, and what stopped. The error's own words
 * and what to do follow, each a sentence of its own.
 */
export const LOG_RUN_OUT_OF_TRIES_WAITING: PluralTemplate = {
  one: "OneUptime tried {{count}} time in {{duration}} to start this run, and it failed, so nobody was paged.",
  other:
    "OneUptime tried {{count}} times in {{duration}} to start this run, and every try failed, so nobody was paged.",
};

export const LOG_RUN_OUT_OF_TRIES_PAGING: PluralTemplate = {
  one: "OneUptime tried {{count}} time in {{duration}} to move this run on, and it failed, so it stopped paging.",
  other:
    "OneUptime tried {{count}} times in {{duration}} to move this run on, and every try failed, so it stopped paging.",
};

export const LOG_PAGE_OUT_OF_TRIES: PluralTemplate = {
  one: "OneUptime tried {{count}} time in {{duration}} to send this page's notifications, and it failed, so it stopped.",
  other:
    "OneUptime tried {{count}} times in {{duration}} to send this page's notifications, and every try failed, so it stopped.",
};

// What to do once a run ran out of tries, by the record it pages about.
export const LOG_RUN_OUT_OF_TRIES_NEXT: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "If the incident still needs somebody, page them again.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "If the alert still needs somebody, page them again.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "If the incident episode still needs somebody, page them again.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "If the alert episode still needs somebody, page them again.",
  ),
};

// What to do once a person's page ran out of tries, by its record.
export const LOG_PAGE_OUT_OF_TRIES_NEXT: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "If the incident still needs this person, page them again.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "If the alert still needs this person, page them again.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "If the incident episode still needs this person, page them again.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "If the alert episode still needs this person, page them again.",
  ),
};

/*
 * THE LAST OF A LOG'S OWN LINES (#8551): a person's page that ended, or
 * was acknowledged or seen, a notification an observer saw or the stuck
 * check settled, a provider's delivery report, an email sent without its
 * images.
 */
export const LOG_PAGE_LINE_SENTENCES: Readonly<{
  pageOverPageAcknowledged: string;
  pageOverPageAgainAcknowledged: string;
  pageNamesNoRecord: string;
  pageNoLongerProjectMember: string;
  notificationSeenAsObserver: string;
  providerReported: string;
  providerMessageId: string;
  providerErrorCode: string;
  providerError: string;
  emailSentWithoutImages: string;
  emailDeliveryNotTracked: string;
}> = {
  pageOverPageAcknowledged: translationKey(
    "Execution completed because this page was acknowledged.",
  ),
  pageOverPageAgainAcknowledged: translationKey(
    "Execution completed because this page again was acknowledged.",
  ),
  pageNamesNoRecord: translationKey(
    "Execution completed because this page names no incident, alert or episode.",
  ),
  pageNoLongerProjectMember: translationKey(
    "Stopped because this person is no longer a member of the project. Their remaining notification rules were not run.",
  ),
  notificationSeenAsObserver: translationKey(
    "Marked as seen, paged as an observer.",
  ),
  providerReported: translationKey("The provider reported: {{status}}."),
  providerMessageId: translationKey("Message ID: {{id}}."),
  providerErrorCode: translationKey("Provider error code: {{code}}."),
  providerError: translationKey("Provider error: {{error}}"),
  emailSentWithoutImages: translationKey(
    "Email sent without its images, which the mail service refused: {{answer}}",
  ),
  emailDeliveryNotTracked: translationKey(
    "OneUptime does not track whether it was delivered.",
  ),
};

/*
 * A person's page merged into their open page from another run
 * (OnCallPageMerge): which policy is paging them - or, for a line that names
 * none, another policy - who paged them directly from a chat, or which
 * workflow did (#8859), and the line of one that took the page over.
 */
export const LOG_MERGED_PAGE_SENTENCES: Readonly<{
  merged: string;
  mergedUnnamed: string;
  mergedDirectly: string;
  mergedByWorkflow: string;
  takenOver: string;
  takenOverUnnamed: string;
  takenOverDirectly: string;
  takenOverDirectlyUnnamed: string;
}> = {
  merged: translationKey(
    "Already paged about this by {{name}}, so not paged again.",
  ),
  mergedUnnamed: translationKey(
    "Already paged about this by another on-call policy, so not paged again.",
  ),
  mergedDirectly: translationKey(
    "Already paged directly about this by {{name}}, so not paged again.",
  ),
  mergedByWorkflow: translationKey(
    "Already paged about this through the workflow {{name}}, so not paged again.",
  ),
  takenOver: translationKey(
    "Their page from {{name}} is over, so this policy pages them now.",
  ),
  takenOverUnnamed: translationKey(
    "Their page from another on-call policy is over, so this policy pages them now.",
  ),
  takenOverDirectly: translationKey(
    "Their page from {{name}} is over, so they are paged directly now.",
  ),
  takenOverDirectlyUnnamed: translationKey(
    "Their page from another on-call policy is over, so they are paged directly now.",
  ),
};

// A provider's delivery report, by the status it says (SmsStatus, WhatsAppStatus).
export const LOG_PROVIDER_STATUS_SENTENCES: Readonly<Record<string, string>> = {
  Delivered: translationKey("The provider delivered it."),
  Undelivered: translationKey("The provider could not deliver it."),
  Failed: translationKey("The provider could not send it."),
  Sent: translationKey("The provider sent it."),
  Read: translationKey("The person read it."),
};

// A person's page that stopped because its record was acknowledged.
export const LOG_PAGE_RECORD_ACKNOWLEDGED_SENTENCES: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "Execution completed because the incident was acknowledged.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "Execution completed because the alert was acknowledged.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "Execution completed because the incident episode was acknowledged.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "Execution completed because the alert episode was acknowledged.",
  ),
};

// A person's page that stopped because its record was deleted.
export const LOG_PAGE_RECORD_DELETED_SENTENCES: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "Execution completed because the incident was deleted.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "Execution completed because the alert was deleted.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "Execution completed because the incident episode was deleted.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "Execution completed because the alert episode was deleted.",
  ),
};

// A person's page they acknowledged from one of its notifications.
export const LOG_PAGE_ACKNOWLEDGED_BY_SENTENCES: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "{{name}} acknowledged the incident.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "{{name}} acknowledged the alert.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "{{name}} acknowledged the incident episode.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "{{name}} acknowledged the alert episode.",
  ),
};

// An observer's page they said they have seen.
export const LOG_PAGE_SEEN_BY_OBSERVER_SENTENCES: Readonly<
  Record<OnCallPolicyRunRecordKind, string>
> = {
  [OnCallPolicyRunRecordKind.Incident]: translationKey(
    "Seen by {{name}}, paged as an observer. The incident is not acknowledged by this.",
  ),
  [OnCallPolicyRunRecordKind.Alert]: translationKey(
    "Seen by {{name}}, paged as an observer. The alert is not acknowledged by this.",
  ),
  [OnCallPolicyRunRecordKind.IncidentEpisode]: translationKey(
    "Seen by {{name}}, paged as an observer. The incident episode is not acknowledged by this.",
  ),
  [OnCallPolicyRunRecordKind.AlertEpisode]: translationKey(
    "Seen by {{name}}, paged as an observer. The alert episode is not acknowledged by this.",
  ),
};

/*
 * How a call ended (CallOutcome, #8576): answered - for how long, when
 * Twilio said - rang out, busy or declined, not connected, or answered by
 * voicemail, with a message left or not, or by a fax machine (#6594); after
 * the call's id when Twilio gave one.
 */
export const LOG_CALL_OUTCOME_SENTENCES: Readonly<
  Record<CallOutcomeLine, string>
> = {
  [CallOutcomeLine.Answered]: translationKey("The call was answered."),
  [CallOutcomeLine.RangOut]: translationKey(
    "The call was not answered: it rang out.",
  ),
  [CallOutcomeLine.Busy]: translationKey(
    "The call was not answered: the line was busy, or the call was declined.",
  ),
  [CallOutcomeLine.NotConnected]: translationKey(
    "The call could not be connected.",
  ),
  [CallOutcomeLine.VoicemailMessageLeft]: translationKey(
    "The call was not answered: it went to voicemail, and a message was left.",
  ),
  [CallOutcomeLine.VoicemailNoMessage]: translationKey(
    "The call was not answered: it went to voicemail, and no message was left.",
  ),
  [CallOutcomeLine.Fax]: translationKey(
    "The call was not answered: a fax machine picked up.",
  ),
};

export const LOG_CALL_ANSWERED_AND_LASTED: PluralTemplate = {
  one: "The call was answered and lasted {{count}} second.",
  other: "The call was answered and lasted {{count}} seconds.",
};

export const LOG_CALL_ID: string = translationKey("Call ID: {{id}}.");

// A call's line, its id first: "Call ID: CA…. The call was answered."
function getCallEndedSentence(
  translator: Translator,
  line: OnCallLogLine,
): string | null {
  if (!line.callOutcome) {
    return null;
  }

  const outcome: string =
    line.callOutcome === CallOutcomeLine.Answered && line.seconds !== undefined
      ? translator.translatePlural(LOG_CALL_ANSWERED_AND_LASTED, line.seconds)
      : translator.translateTemplate(
          LOG_CALL_OUTCOME_SENTENCES[line.callOutcome],
        );

  return joinSentences([
    line.id
      ? translator.translateTemplate(
          LOG_CALL_ID,
          { id: line.id },
          { setsValuesApart: true },
        )
      : "",
    outcome,
  ]);
}

// A notification the stuck check settled, by the minutes it waited.
export const LOG_NOTIFICATION_STUCK: PluralTemplate = {
  one: "Sending did not finish within {{count}} minute, so this notification may not have been sent.",
  other:
    "Sending did not finish within {{count}} minutes, so this notification may not have been sent.",
};

// A provider's delivery report: its status, its id and error, each a sentence.
function getProviderDeliverySentence(
  translator: Translator,
  line: OnCallLogLine,
): string | null {
  if (!line.status) {
    return null;
  }

  const statusSentence: string | undefined =
    LOG_PROVIDER_STATUS_SENTENCES[line.status];

  return joinSentences([
    statusSentence
      ? translator.translateTemplate(statusSentence)
      : translator.translateTemplate(
          LOG_PAGE_LINE_SENTENCES.providerReported,
          { status: translator.translateText(line.status) || line.status },
          { setsValuesApart: true },
        ),
    line.id
      ? translator.translateTemplate(
          LOG_PAGE_LINE_SENTENCES.providerMessageId,
          { id: line.id },
          { setsValuesApart: true },
        )
      : "",
    line.errorCode
      ? translator.translateTemplate(
          LOG_PAGE_LINE_SENTENCES.providerErrorCode,
          { code: line.errorCode },
          { setsValuesApart: true },
        )
      : "",
    line.words
      ? translator.translateTemplate(
          LOG_PAGE_LINE_SENTENCES.providerError,
          { error: errorInSentence(line.words) },
          { setsValuesApart: true },
        )
      : "",
  ]);
}

// A person's page's or a notification's line from #8551, in the reader's words.
function getPageLineSentence(
  translator: Translator,
  line: OnCallLogLine,
): string | null {
  switch (line.code) {
    case OnCallLogLineCode.PageOverPageAcknowledged:
      return translator.translateTemplate(
        LOG_PAGE_LINE_SENTENCES.pageOverPageAcknowledged,
      );
    case OnCallLogLineCode.PageOverPageAgainAcknowledged:
      return translator.translateTemplate(
        LOG_PAGE_LINE_SENTENCES.pageOverPageAgainAcknowledged,
      );
    case OnCallLogLineCode.PageNamesNoRecord:
      return translator.translateTemplate(
        LOG_PAGE_LINE_SENTENCES.pageNamesNoRecord,
      );
    case OnCallLogLineCode.PageNoLongerProjectMember:
      return translator.translateTemplate(
        LOG_PAGE_LINE_SENTENCES.pageNoLongerProjectMember,
      );
    case OnCallLogLineCode.NotificationSeenAsObserver:
      return translator.translateTemplate(
        LOG_PAGE_LINE_SENTENCES.notificationSeenAsObserver,
      );
    case OnCallLogLineCode.PageRecordAcknowledged:
      return line.recordKind
        ? translator.translateTemplate(
            LOG_PAGE_RECORD_ACKNOWLEDGED_SENTENCES[line.recordKind],
          )
        : null;
    case OnCallLogLineCode.PageRecordResolved:
      return line.recordKind
        ? translator.translateTemplate(
            RUN_RECORD_RESOLVED_SENTENCES[line.recordKind],
          )
        : null;
    case OnCallLogLineCode.PageRecordDeleted:
      return line.recordKind
        ? translator.translateTemplate(
            LOG_PAGE_RECORD_DELETED_SENTENCES[line.recordKind],
          )
        : null;
    case OnCallLogLineCode.PageAcknowledgedBy:
      return line.recordKind && line.name
        ? translator.translateTemplate(
            LOG_PAGE_ACKNOWLEDGED_BY_SENTENCES[line.recordKind],
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallLogLineCode.PageSeenByObserver:
      return line.recordKind && line.name
        ? translator.translateTemplate(
            LOG_PAGE_SEEN_BY_OBSERVER_SENTENCES[line.recordKind],
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallLogLineCode.PageMerged:
      return line.name
        ? translator.translateTemplate(
            LOG_MERGED_PAGE_SENTENCES.merged,
            { name: line.name },
            { setsValuesApart: true },
          )
        : translator.translateTemplate(LOG_MERGED_PAGE_SENTENCES.mergedUnnamed);
    // Merged into a direct page (#8859): who, or which workflow, paged them.
    case OnCallLogLineCode.PageMergedDirectly:
      return line.name
        ? translator.translateTemplate(
            LOG_MERGED_PAGE_SENTENCES.mergedDirectly,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallLogLineCode.PageMergedByWorkflow:
      return line.name
        ? translator.translateTemplate(
            LOG_MERGED_PAGE_SENTENCES.mergedByWorkflow,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallLogLineCode.PageMergeTakenOver:
      return line.name
        ? translator.translateTemplate(
            LOG_MERGED_PAGE_SENTENCES.takenOver,
            { name: line.name },
            { setsValuesApart: true },
          )
        : translator.translateTemplate(
            LOG_MERGED_PAGE_SENTENCES.takenOverUnnamed,
          );
    case OnCallLogLineCode.PageMergeTakenOverDirectly:
      return line.name
        ? translator.translateTemplate(
            LOG_MERGED_PAGE_SENTENCES.takenOverDirectly,
            { name: line.name },
            { setsValuesApart: true },
          )
        : translator.translateTemplate(
            LOG_MERGED_PAGE_SENTENCES.takenOverDirectlyUnnamed,
          );
    case OnCallLogLineCode.NotificationStuck:
      return line.minutes
        ? translator.translatePlural(LOG_NOTIFICATION_STUCK, line.minutes)
        : null;
    case OnCallLogLineCode.ProviderDelivery:
      return getProviderDeliverySentence(translator, line);
    case OnCallLogLineCode.CallEnded:
      return getCallEndedSentence(translator, line);
    case OnCallLogLineCode.EmailSentWithoutImages:
      return line.words
        ? joinSentences([
            translator.translateTemplate(
              LOG_PAGE_LINE_SENTENCES.emailSentWithoutImages,
              { answer: line.words },
              { setsValuesApart: true },
            ),
            translator.translateTemplate(
              LOG_PAGE_LINE_SENTENCES.emailDeliveryNotTracked,
            ),
          ])
        : null;
    default:
      return null;
  }
}

// The codes each one whole sentence of LOG_OWN_LINE_SENTENCES.
const WHOLE_LINE_SENTENCES: Readonly<
  Partial<Record<OnCallLogLineCode, keyof typeof LOG_OWN_LINE_SENTENCES>>
> = {
  [OnCallLogLineCode.RunScheduled]: "runScheduled",
  [OnCallLogLineCode.RunStarted]: "runStarted",
  [OnCallLogLineCode.RunPagingStarted]: "runPagingStarted",
  [OnCallLogLineCode.RunTimedOut]: "runTimedOut",
  [OnCallLogLineCode.RunNeverStarted]: "runNeverStarted",
  [OnCallLogLineCode.DirectPageNobodyPaged]: "directPageNobodyPaged",
  [OnCallLogLineCode.DirectPageTimedOut]: "directPageTimedOut",
  [OnCallLogLineCode.DirectPageNeverStarted]: "directPageNeverStarted",
  [OnCallLogLineCode.LevelSkippedByEscalation]: "levelSkippedByEscalation",
  [OnCallLogLineCode.SkippedAsEscalated]: "skippedAsEscalated",
  [OnCallLogLineCode.DirectPageNobodyToPage]: "directPageNobodyToPage",
  [OnCallLogLineCode.PageSent]: "pageSent",
  [OnCallLogLineCode.PageEscalated]: "pageEscalated",
  [OnCallLogLineCode.PageTimedOut]: "pageTimedOut",
  [OnCallLogLineCode.NotificationAcknowledged]: "notificationAcknowledged",
  [OnCallLogLineCode.NotificationEscalatedFrom]: "notificationEscalatedFrom",
  [OnCallLogLineCode.EmailSent]: "emailSent",
  [OnCallLogLineCode.PushSent]: "pushSent",
  [OnCallLogLineCode.TelegramSent]: "telegramSent",
  [OnCallLogLineCode.WhatsAppSent]: "whatsAppSent",
};

// The lines only a test page's run writes: worded on a test page's row only.
const TEST_PAGE_ONLY_LOG_CODES: ReadonlyArray<OnCallLogLineCode> = [
  OnCallLogLineCode.TestPageSent,
  OnCallLogLineCode.TestPageSentToFirstLevel,
];

// "less than a minute", "37 minutes": how long the tries went on.
function getTriesDuration(translator: Translator, minutes: number): string {
  return minutes > 0
    ? translator.translatePlural(
        { one: "{{count}} minute", other: "{{count}} minutes" },
        minutes,
      )
    : translator.translateText("less than a minute") || "less than a minute";
}

// A run's or a page's line once it ran out of tries, its sentences joined.
function getOutOfTriesSentence(
  translator: Translator,
  line: OnCallLogLine,
): string | null {
  if (!line.tries) {
    return null;
  }

  const isPage: boolean = line.code === OnCallLogLineCode.PageOutOfTries;
  const what: PluralTemplate = isPage
    ? LOG_PAGE_OUT_OF_TRIES
    : line.wasWaiting
      ? LOG_RUN_OUT_OF_TRIES_WAITING
      : LOG_RUN_OUT_OF_TRIES_PAGING;
  const next: string | undefined = line.recordKind
    ? (isPage ? LOG_PAGE_OUT_OF_TRIES_NEXT : LOG_RUN_OUT_OF_TRIES_NEXT)[
        line.recordKind
      ]
    : undefined;

  return joinSentences([
    translator.translatePlural(
      what,
      line.tries,
      { duration: getTriesDuration(translator, line.minutes || 0) },
      { setsValuesApart: true },
    ),
    line.words
      ? translator.translateTemplate(
          LOG_OWN_LINE_SENTENCES.lastTryFailedWith,
          { error: errorInSentence(line.words) },
          { setsValuesApart: true },
        )
      : "",
    next ? translator.translateTemplate(next) : "",
  ]);
}

/*
 * One of the rest of a log's own lines (OnCallLogLine), in the reader's
 * words; null when it has none for this kind of page.
 */
export function getOnCallLogOwnLineSentence(
  translator: Translator,
  data: {
    line: OnCallLogLine | null | undefined;
    // A test page's row: its own paging lines are worded there only.
    isTestPage: boolean;
  },
): string | null {
  const line: OnCallLogLine | null | undefined = data.line;

  if (!line) {
    return null;
  }

  if (TEST_PAGE_ONLY_LOG_CODES.includes(line.code) && !data.isTestPage) {
    return null;
  }

  const whole: keyof typeof LOG_OWN_LINE_SENTENCES | undefined =
    WHOLE_LINE_SENTENCES[line.code];

  if (whole) {
    return translator.translateTemplate(LOG_OWN_LINE_SENTENCES[whole]);
  }

  switch (line.code) {
    case OnCallLogLineCode.DirectPagePaged:
      return line.count !== undefined
        ? translator.translatePlural(LOG_DIRECT_PAGE_PAGED, line.count)
        : null;
    case OnCallLogLineCode.TestPageSent:
      return line.count !== undefined
        ? translator.translatePlural(LOG_TEST_PAGE_SENT, line.count)
        : null;
    case OnCallLogLineCode.TestPageSentToFirstLevel:
      return translator.translateTemplate(
        LOG_OWN_LINE_SENTENCES.testPageSentToFirstLevel,
      );
    case OnCallLogLineCode.PagingAgain:
      return line.pageAgainNumber && line.pagesAgainAtMost && line.minutes
        ? translator.translateTemplate(
            LOG_OWN_LINE_SENTENCES.pagingAgain,
            {
              number: translator.formatNumber(line.pageAgainNumber),
              max: translator.formatNumber(line.pagesAgainAtMost),
              duration: describeOnCallAcknowledgementTimeout(
                line.minutes,
                translator,
              ),
            },
            { setsValuesApart: true },
          )
        : null;
    case OnCallLogLineCode.PageHandedOver:
      return line.minutes
        ? translator.translatePlural(LOG_PAGE_HANDED_OVER, line.minutes)
        : null;
    case OnCallLogLineCode.RunOutOfTries:
    case OnCallLogLineCode.PageOutOfTries:
      return getOutOfTriesSentence(translator, line);
    case OnCallLogLineCode.WorkspaceMessageSent:
      return line.name
        ? translator.translateTemplate(
            LOG_OWN_LINE_SENTENCES.workspaceMessageSent,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallLogLineCode.SentWithMessageId:
    case OnCallLogLineCode.CallPlaced:
      return line.id
        ? translator.translateTemplate(
            line.code === OnCallLogLineCode.CallPlaced
              ? LOG_OWN_LINE_SENTENCES.callPlaced
              : LOG_OWN_LINE_SENTENCES.sentWithMessageId,
            { id: line.id },
            { setsValuesApart: true },
          )
        : null;
    default:
      return getPageLineSentence(translator, line);
  }
}

// A row's line, read as one of a log's own lines, in the reader's words.
function getOwnLineWords(
  translator: Translator,
  row: {
    statusMessage?: string | undefined;
    userNotificationEventType?: UserNotificationEventType | undefined;
  },
): string | null {
  return getOnCallLogOwnLineSentence(translator, {
    line: readOnCallLogLine(row.statusMessage),
    isTestPage: isTestPageRow(row),
  });
}

/*
 * The lines only a test page writes: a real page's row never says them,
 * and if one did, it is drawn as written rather than as a test's.
 */
const TEST_PAGE_ONLY_CODES: ReadonlyArray<OnCallTestPageLineCode> = [
  OnCallTestPageLineCode.RulesRan,
  OnCallTestPageLineCode.RunUnreadable,
  OnCallTestPageLineCode.NobodyPaged,
  OnCallTestPageLineCode.FirstLevelReachedNobody,
  OnCallTestPageLineCode.EndedUnanswered,
  OnCallTestPageLineCode.WentThroughEveryLevel,
  OnCallTestPageLineCode.PolicyHasNoLevels,
];

// Whether a row is a test page's (OnCallTestPage): its event type says so.
export function isTestPageRow(
  row:
    | { userNotificationEventType?: UserNotificationEventType | undefined }
    | null
    | undefined,
): boolean {
  return isOnCallTestPage({
    userNotificationEventType: row?.userNotificationEventType ?? null,
  });
}

// A name the line does not give is "Someone", as a test's result says it.
function nameOrSomeone(name: string | undefined): TemplateValue {
  return name || translatableTerm("Someone");
}

/*
 * A line of a log, read as a code, in the reader's words; null when the
 * code has none for this kind of page.
 */
export function getOnCallLogLineSentence(
  translator: Translator,
  data: {
    line: OnCallTestPageLine | null | undefined;
    // A test page's row: its lines are worded as a test's result words them.
    isTestPage: boolean;
  },
): string | null {
  const line: OnCallTestPageLine | null | undefined = data.line;

  if (!line) {
    return null;
  }

  // What a live result says of now, a log says of then.
  switch (line.code) {
    case OnCallTestPageLineCode.NobodyOnCall:
      return line.name
        ? translator.translateTemplate(
            LOG_LINE_SENTENCES.nobodyOnCall,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallTestPageLineCode.NobodyNextInRotation:
      return line.name
        ? translator.translateTemplate(
            LOG_LINE_SENTENCES.nobodyNextInRotation,
            { name: line.name },
            { setsValuesApart: true },
          )
        : null;
    case OnCallTestPageLineCode.AwayWithNobodyCovering:
      return line.awayUntil
        ? translator.translateTemplate(
            LOG_LINE_SENTENCES.awayWithNobodyCovering,
            {
              name: nameOrSomeone(line.name),
              time: OneUptimeDate.getDateAsUserFriendlyFormattedString(
                OneUptimeDate.fromString(line.awayUntil),
              ),
            },
            { setsValuesApart: true },
          )
        : null;
    default:
      break;
  }

  if (data.isTestPage) {
    return getResultLineSentence(translator, line);
  }

  // A real page: what became of it, never "the test".
  switch (line.code) {
    case OnCallTestPageLineCode.MethodNotVerified: {
      const sentence: string | undefined = line.channel
        ? REAL_PAGE_NOT_VERIFIED_SENTENCES[line.channel]
        : undefined;

      return sentence ? translator.translateTemplate(sentence) : null;
    }
    case OnCallTestPageLineCode.OptedOut:
      return translator.translateTemplate(REAL_PAGE_LINE_SENTENCES.optedOut);
    case OnCallTestPageLineCode.NoRuleNoFallback:
      return translator.translateTemplate(
        REAL_PAGE_LINE_SENTENCES.noRuleNoFallback,
      );
    case OnCallTestPageLineCode.NoRuleFallsBack:
      return translator.translateTemplate(
        REAL_PAGE_LINE_SENTENCES.noRuleFallsBack,
      );
    case OnCallTestPageLineCode.AlreadyPaged:
      return translator.translateTemplate(
        REAL_PAGE_LINE_SENTENCES.alreadyPaged,
      );
    case OnCallTestPageLineCode.SendingToPerson:
      return translator.translateTemplate(
        REAL_PAGE_LINE_SENTENCES.sendingToPerson,
      );
    default:
      break;
  }

  if (TEST_PAGE_ONLY_CODES.includes(line.code)) {
    return null;
  }

  return getResultLineSentence(translator, line);
}

// How a policy's run ended, in the reader's words; null for no ending.
export function getOnCallPolicyRunLineSentence(
  translator: Translator,
  line: OnCallPolicyRunLine | null | undefined,
): string | null {
  if (!line) {
    return null;
  }

  switch (line.code) {
    case OnCallPolicyRunLineCode.WentThroughEveryRule:
      return translator.translateTemplate(
        RUN_LINE_SENTENCES.wentThroughEveryRule,
      );
    case OnCallPolicyRunLineCode.EverybodyEscalated:
      return translator.translateTemplate(
        RUN_LINE_SENTENCES.everybodyEscalated,
      );
    case OnCallPolicyRunLineCode.NobodyNotified:
      return translator.translateTemplate(RUN_LINE_SENTENCES.nobodyNotified);
    case OnCallPolicyRunLineCode.PolicyArchivedNotRun:
      return translator.translateTemplate(
        RUN_LINE_SENTENCES.policyArchivedNotRun,
      );
    case OnCallPolicyRunLineCode.PolicyArchivedStopped:
      return translator.translateTemplate(
        RUN_LINE_SENTENCES.policyArchivedStopped,
      );
    case OnCallPolicyRunLineCode.PolicyHasNoRules:
      return translator.translateTemplate(RUN_LINE_SENTENCES.policyHasNoRules);
    case OnCallPolicyRunLineCode.RecordHandled:
      return line.recordKind
        ? translator.translateTemplate(
            RUN_RECORD_HANDLED_SENTENCES[line.recordKind],
          )
        : null;
    case OnCallPolicyRunLineCode.RecordResolved:
      return line.recordKind
        ? translator.translateTemplate(
            RUN_RECORD_RESOLVED_SENTENCES[line.recordKind],
          )
        : null;
  }

  return null;
}

/*
 * A line the readers have no code for, in the reader's words when the
 * Dashboard has the line itself as a key - as the dialog always looked its
 * text up - and otherwise null, for it to be drawn as written.
 */
function getWordedLine(
  translator: Translator,
  statusMessage: string | null | undefined,
): string | null {
  const message: string = (statusMessage || "").trim();

  if (!message) {
    return null;
  }

  const words: string | undefined = translator.translateText(message);

  return words && words !== message ? words : null;
}

/*
 * A notification of a person's on-call timeline (UserOnCallLogTimeline), as
 * its row is read: its line, whether it was a test page's, and the method
 * it went by - its notification method columns, or the method itself.
 */
export interface OnCallLogNotificationRow
  extends OnCallPageNotificationMethods {
  statusMessage?: string | undefined;
  userNotificationEventType?: UserNotificationEventType | undefined;
  getColumnValue?: ColumnValueReader["getColumnValue"] | undefined;
}

/*
 * The notification method columns a row says its channel with: read with
 * every row, so a notification whose method was deleted since still says
 * which channel it went by (ON_CALL_PAGE_CHANNELS).
 */
export const ON_CALL_PAGE_CHANNEL_COLUMNS: Readonly<
  Record<keyof OnCallPageNotificationMethods, true>
> = ON_CALL_PAGE_CHANNELS.reduce(
  (
    columns: Record<keyof OnCallPageNotificationMethods, true>,
    info: OnCallPageChannelInfo,
  ): Record<keyof OnCallPageNotificationMethods, true> => {
    return { ...columns, [info.field]: true };
  },
  {} as Record<keyof OnCallPageNotificationMethods, true>,
);

/*
 * The channel a notification of a person's on-call timeline went out by:
 * the notification method column it has set, or, when only its method was
 * read, the method's kind.
 */
export function getOnCallLogNotificationChannel(
  row: OnCallLogNotificationRow,
): OnCallPageChannel | null {
  const fromColumns: OnCallPageChannel | undefined =
    getOnCallPageChannelsOf(row)[0];

  if (fromColumns) {
    return fromColumns;
  }

  if (typeof row.getColumnValue === "function") {
    return (
      NotificationMethodUtil.getDisplayItems(row as ColumnValueReader)[0]
        ?.method || null
    );
  }

  return null;
}

// A notification's row (UserOnCallLogTimeline): why it went, or did not.
export function getOnCallLogNotificationWords(
  translator: Translator,
  row: OnCallLogNotificationRow,
): string | null {
  return (
    getOnCallLogLineSentence(translator, {
      line: readOnCallTestPageDeliveryLine({
        statusMessage: row.statusMessage,
        channel: getOnCallLogNotificationChannel(row),
      }),
      isTestPage: isTestPageRow(row),
    }) ??
    getOwnLineWords(translator, row) ??
    getWordedLine(translator, row.statusMessage)
  );
}

/*
 * A person's or a target's row - a step of a run's timeline, or a person's
 * page - with the names it is about.
 */
export function getOnCallLogStepWords(
  translator: Translator,
  row: {
    statusMessage?: string | undefined;
    userNotificationEventType?: UserNotificationEventType | undefined;
    userName?: string | undefined;
    teamName?: string | undefined;
    scheduleName?: string | undefined;
  },
): string | null {
  return (
    getOnCallLogLineSentence(translator, {
      line: readOnCallTestPageStepLine({
        statusMessage: row.statusMessage,
        userName: row.userName || undefined,
        teamName: row.teamName || undefined,
        scheduleName: row.scheduleName || undefined,
      }),
      isTestPage: isTestPageRow(row),
    }) ??
    getOwnLineWords(translator, row) ??
    getWordedLine(translator, row.statusMessage)
  );
}

// A run's own line: how it ended - a test page's as its result says it.
export function getOnCallRunWords(
  translator: Translator,
  run: {
    statusMessage?: string | undefined;
    userNotificationEventType?: UserNotificationEventType | undefined;
  },
): string | null {
  const sentence: string | null = isTestPageRow(run)
    ? getResultLineSentence(
        translator,
        readOnCallTestPageRunLine(run.statusMessage),
      )
    : getOnCallPolicyRunLineSentence(
        translator,
        readOnCallPolicyRunLine(run.statusMessage),
      );

  return (
    sentence ??
    getOwnLineWords(translator, run) ??
    getWordedLine(translator, run.statusMessage)
  );
}
