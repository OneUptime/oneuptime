import { getResultLineSentence } from "../../OnCallTestPage/OnCallTestPageWords";
import OneUptimeDate from "Common/Types/Date";
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
import {
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
    }) ?? getWordedLine(translator, row.statusMessage)
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
    }) ?? getWordedLine(translator, row.statusMessage)
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

  return sentence ?? getWordedLine(translator, run.statusMessage);
}
