import {
  getOnCallPageAgainStatusMessage,
  isOnCallPageAgainStatusMessage,
} from "./OnCallAcknowledgementTimeout";
import {
  getOnCallDirectPagePagingMessage,
  ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
} from "./OnCallDirectPage";
import { getOnCallObserverPageSeenMessage } from "./OnCallObserverPage";
import { ON_CALL_PAGE_SENT_STATUS_MESSAGE } from "./OnCallPageChannel";
import {
  getOnCallPageOverRecordDeletedReason,
  getOnCallPageOverRecordResolvedReason,
  getUserOnCallLogEndedMessage,
  getUserOnCallLogRecordAcknowledgedMessage,
  ON_CALL_PAGE_OVER_PAGE_ACKNOWLEDGED_REASON,
  ON_CALL_PAGE_OVER_PAGE_AGAIN_ACKNOWLEDGED_REASON,
  readOnCallPageAcknowledgedByMessage,
} from "./OnCallPageEnding";
import { NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE } from "./OnCallPageLine";
import {
  ON_CALL_PAGE_MERGE_UNNAMED_POLICY,
  readOnCallPageMergeTakenOverMessage,
  readOnCallPageMergedMessage,
} from "./OnCallPageMerge";
import { ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE } from "./OnCallPageRecordGone";
import {
  isOnCallPagePassedOnSkipTimelineMessage,
  isOnCallPagePassedOnStatusMessage,
  ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
} from "./OnCallPagePassOn";
import {
  ON_CALL_POLICY_RUN_RECORD_KINDS,
  OnCallPolicyRunRecordKind,
} from "./OnCallPolicyRunLine";
import {
  getOnCallPolicyRunOutOfTriesMessage,
  getUserOnCallLogOutOfTriesMessage,
} from "./OnCallPolicyRunRetry";
import {
  ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
  ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE,
  ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
  ON_CALL_RUN_PAGING_STARTED_MESSAGE,
  ON_CALL_RUN_SCHEDULED_MESSAGE,
  readUserOnCallLogHandedOverMinutes,
  USER_LOG_TIMED_OUT_STATUS_MESSAGE,
} from "./OnCallRunStart";
import {
  CallOutcomeLine,
  EMAIL_SENT_STATUS_MESSAGE,
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE,
  ProviderDeliveryStatus,
  PUSH_NOTIFICATION_SENT_MESSAGE,
  readEmailSentWithoutImagesMessage,
  readCallOutcomeMessage,
  readProviderDeliveryStatusMessage,
  readProviderIdStatusMessage,
  readStuckNotificationMinutes,
  readWorkspaceMessageSentMessage,
  TELEGRAM_MESSAGE_SENT_MESSAGE,
  WHATSAPP_MESSAGE_SENT_MESSAGE,
} from "./OnCallSentLine";
import {
  getOnCallTestPagePagingMessage,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
} from "./OnCallTestPage";

/*
 * THE REST OF AN ON-CALL LOG'S OWN LINES, AS CODES (#8434).
 *
 * The on-call logs' View Status Message dialogs word OneUptime's own lines
 * in the reader's language (#8330): a notification's, a person's and a
 * step's with the codes a test page's result reads (OnCallTestPageLine),
 * and how a policy's run ended with OnCallPolicyRunLine. Every other line
 * was drawn as written - English on every page: a run still on its way, a
 * direct page's, a page again's, a run or a page that ran out of tries or
 * timed out, a step skipped because the page was escalated, "Alert Sent",
 * a notification that went out or was acknowledged.
 *
 * This reads those back into codes, compared with the very constants and
 * builders their writers write them with (OnCallRunStart, OnCallSentLine,
 * OnCallDirectPage, OnCallPagePassOn, OnCallAcknowledgementTimeout,
 * OnCallPolicyRunRetry, OnCallTestPage), so a line written before this
 * file is read the same way, and a line that changes is read the same way
 * or not at all. The Dashboard words each code in the reader's language
 * (OnCallLogLineWords). Any other line - a provider's own words, an
 * error's - reads as null and is drawn as written.
 *
 * A line means the same on whichever row it is written, so one reader
 * reads them all. React-free and server-safe.
 */

export enum OnCallLogLineCode {
  // A run written, not started yet.
  RunScheduled = "RunScheduled",
  // A policy's run going through its escalation rules.
  RunStarted = "RunStarted",
  // A direct page or a test page paging its people.
  RunPagingStarted = "RunPagingStarted",
  // A policy's run that did not finish starting, timed out.
  RunTimedOut = "RunTimedOut",
  RunNeverStarted = "RunNeverStarted",
  // A direct page's run: how many it paged, nobody, or timed out.
  DirectPagePaged = "DirectPagePaged",
  DirectPageNobodyPaged = "DirectPagePagedNobody",
  DirectPageTimedOut = "DirectPageTimedOut",
  DirectPageNeverStarted = "DirectPageNeverStarted",
  // A page again, paging: which of how many, and the policy's timeout.
  PagingAgain = "PagingAgain",
  // A test page's run, paging: to how many people, or its first level.
  TestPageSent = "TestPageSent",
  TestPageSentToFirstLevel = "TestPageSentToFirstLevel",
  // A run that ran out of tries, waiting to page or paging.
  RunOutOfTries = "RunOutOfTries",
  // A step of a run's timeline.
  LevelSkippedByEscalation = "LevelSkippedByEscalation",
  SkippedAsEscalated = "SkippedAsEscalated",
  DirectPageNobodyToPage = "DirectPageNobodyToPage",
  // A person's page.
  PageSent = "PageSent",
  PageEscalated = "PageEscalated",
  PageHandedOver = "PageHandedOver",
  PageTimedOut = "PageTimedOut",
  PageOutOfTries = "PageOutOfTries",
  // A notification of a person's page.
  NotificationAcknowledged = "NotificationAcknowledged",
  NotificationEscalatedFrom = "NotificationEscalatedFrom",
  EmailSent = "EmailSent",
  PushSent = "PushSent",
  TelegramSent = "TelegramSent",
  WhatsAppSent = "WhatsAppSent",
  WorkspaceMessageSent = "WorkspaceMessageSent",
  SentWithMessageId = "SentWithMessageId",
  CallPlaced = "CallPlaced",
  // A person's page that ended (#8551): it, or its page again, acknowledged.
  PageOverPageAcknowledged = "PageOverPageAcknowledged",
  PageOverPageAgainAcknowledged = "PageOverPageAgainAcknowledged",
  // Its record acknowledged, resolved or deleted; or it named none.
  PageRecordAcknowledged = "PageRecordAcknowledged",
  PageRecordResolved = "PageRecordResolved",
  PageRecordDeleted = "PageRecordDeleted",
  PageNamesNoRecord = "PageNamesNoRecord",
  // Its person left the project.
  PageNoLongerProjectMember = "PageNoLongerProjectMember",
  // Acknowledged by its person, or seen by an observer: who, and the record.
  PageAcknowledgedBy = "PageAcknowledgedBy",
  PageSeenByObserver = "PageSeenByObserver",
  // A notification an observer marked as seen.
  NotificationSeenAsObserver = "NotificationSeenAsObserver",
  // A notification the stuck check settled: it may not have gone out.
  NotificationStuck = "NotificationStuck",
  // A provider's delivery report on an SMS or a WhatsApp message.
  ProviderDelivery = "ProviderDelivery",
  // An email sent without its images, with the mail service's words.
  EmailSentWithoutImages = "EmailSentWithoutImages",
  // A call that ended (#8576): how, how long, and its id.
  CallEnded = "CallEnded",
  /*
   * A person's page merged into their open page from another policy's run
   * (OnCallPageMerge): which policy is paging them - none, when the line
   * names none - and the page that took the page over when that one ended.
   */
  PageMerged = "PageMerged",
  PageMergeTakenOver = "PageMergeTakenOver",
}

export interface OnCallLogLine {
  code: OnCallLogLineCode;
  // How many people a direct or a test page paged.
  count?: number | undefined;
  // A page again: which of how many, and the policy's timeout in minutes.
  pageAgainNumber?: number | undefined;
  pagesAgainAtMost?: number | undefined;
  minutes?: number | undefined;
  // Out of tries: how many, over how many minutes (none: under a minute).
  tries?: number | undefined;
  // Out of tries: whether the run was waiting to page, not paging.
  wasWaiting?: boolean | undefined;
  // Out of tries: the record the run or page is about, when it is named.
  recordKind?: OnCallPolicyRunRecordKind | undefined;
  // Out of tries: what the last try failed with, as written.
  words?: string | undefined;
  // The workspace a message was sent on: "Slack".
  name?: string | undefined;
  // The id a provider gave a message or a call.
  id?: string | undefined;
  // A provider's delivery report: its status and error code, as written.
  status?: string | undefined;
  errorCode?: string | undefined;
  // A call that ended: how (CallOutcome), and how long an answered one lasted.
  callOutcome?: CallOutcomeLine | undefined;
  seconds?: number | undefined;
}

// The records a page names, as a line names each in lower case.
const RECORD_KIND_OF_LABEL: Readonly<
  Record<string, OnCallPolicyRunRecordKind>
> = {
  Incident: OnCallPolicyRunRecordKind.Incident,
  Alert: OnCallPolicyRunRecordKind.Alert,
  "Incident Episode": OnCallPolicyRunRecordKind.IncidentEpisode,
  "Alert Episode": OnCallPolicyRunRecordKind.AlertEpisode,
};

/*
 * How a person's page that is over says why (OnCallPageEnding): its page
 * or page again acknowledged, its record acknowledged, resolved or deleted,
 * or no record named.
 */
function readPageEnding(message: string): OnCallLogLine | null {
  if (
    message ===
    getUserOnCallLogEndedMessage(ON_CALL_PAGE_OVER_PAGE_ACKNOWLEDGED_REASON)
  ) {
    return { code: OnCallLogLineCode.PageOverPageAcknowledged };
  }

  if (
    message ===
    getUserOnCallLogEndedMessage(
      ON_CALL_PAGE_OVER_PAGE_AGAIN_ACKNOWLEDGED_REASON,
    )
  ) {
    return { code: OnCallLogLineCode.PageOverPageAgainAcknowledged };
  }

  if (message === ON_CALL_PAGE_NAMES_NO_RECORD_MESSAGE) {
    return { code: OnCallLogLineCode.PageNamesNoRecord };
  }

  for (const recordKind of ON_CALL_POLICY_RUN_RECORD_KINDS) {
    if (message === getUserOnCallLogRecordAcknowledgedMessage(recordKind)) {
      return {
        code: OnCallLogLineCode.PageRecordAcknowledged,
        recordKind: recordKind,
      };
    }

    if (
      message ===
      getUserOnCallLogEndedMessage(
        getOnCallPageOverRecordResolvedReason(recordKind),
      )
    ) {
      return {
        code: OnCallLogLineCode.PageRecordResolved,
        recordKind: recordKind,
      };
    }

    if (
      message ===
      getUserOnCallLogEndedMessage(
        getOnCallPageOverRecordDeletedReason(recordKind),
      )
    ) {
      return {
        code: OnCallLogLineCode.PageRecordDeleted,
        recordKind: recordKind,
      };
    }
  }

  return null;
}

/*
 * An observer's page they said they have seen
 * (getOnCallObserverPageSeenMessage): who, as written, and the record.
 */
const SEEN_BY_OBSERVER: RegExp = new RegExp(
  `^Seen by (.+), paged as an observer\\. The (${ON_CALL_POLICY_RUN_RECORD_KINDS.join("|")}) is not acknowledged by this\\.$`,
);

function readSeenByObserver(message: string): OnCallLogLine | null {
  const parts: RegExpMatchArray | null = message.match(SEEN_BY_OBSERVER);

  if (!parts) {
    return null;
  }

  const who: string = parts[1]!;
  const recordKind: OnCallPolicyRunRecordKind =
    parts[2] as OnCallPolicyRunRecordKind;

  // Its builder writes the name and the email as given: read back so.
  if (
    getOnCallObserverPageSeenMessage({
      kind: recordKind,
      userName: who,
      userEmail: "",
    }) !== message
  ) {
    return null;
  }

  return {
    code: OnCallLogLineCode.PageSeenByObserver,
    recordKind: recordKind,
    name: who,
  };
}

/*
 * A merged page's line (OnCallPageMerge): the policy paging them, as
 * written - none when the line names no policy, which the Dashboard says in
 * the reader's words - and the line of one that took the page over.
 */
function readMergedPageLine(message: string): OnCallLogLine | null {
  const merged: string | null = readOnCallPageMergedMessage(message);

  if (merged !== null) {
    return {
      code: OnCallLogLineCode.PageMerged,
      ...(merged !== ON_CALL_PAGE_MERGE_UNNAMED_POLICY ? { name: merged } : {}),
    };
  }

  const takenOver: string | null = readOnCallPageMergeTakenOverMessage(message);

  if (takenOver !== null) {
    return {
      code: OnCallLogLineCode.PageMergeTakenOver,
      ...(takenOver !== ON_CALL_PAGE_MERGE_UNNAMED_POLICY
        ? { name: takenOver }
        : {}),
    };
  }

  return null;
}

/*
 * A direct page's or a test page's paging line, read back into how many it
 * paged: the number its line names, checked against the builder's words.
 */
function readPagedCount(
  message: string,
  build: (pagedCount: number) => string,
): number | null {
  const named: RegExpMatchArray | null = message.match(/\d+/);
  const count: number = named ? Number(named[0]) : NaN;

  return Number.isFinite(count) && build(count) === message ? count : null;
}

/*
 * A page again's paging line, read back into which page again it is and
 * the policy's timeout: the numbers its line names, checked against the
 * builder's words ("Paging again (1 of 5): still not resolved 1 hour 30
 * minutes after it was acknowledged.").
 */
function readPagingAgain(message: string): OnCallLogLine | null {
  if (!isOnCallPageAgainStatusMessage(message)) {
    return null;
  }

  const parts: RegExpMatchArray | null = message.match(
    /^Paging again \((\d+) of (\d+)\): still not resolved (?:(\d+) hours?)? ?(?:(\d+) minutes?)? after it was acknowledged\.$/,
  );

  if (!parts) {
    return null;
  }

  const pageAgainNumber: number = Number(parts[1]);
  const minutes: number = Number(parts[3] || 0) * 60 + Number(parts[4] || 0);

  if (
    getOnCallPageAgainStatusMessage({
      pageAgainNumber: pageAgainNumber,
      minutes: minutes,
    }) !== message
  ) {
    return null;
  }

  return {
    code: OnCallLogLineCode.PagingAgain,
    pageAgainNumber: pageAgainNumber,
    pagesAgainAtMost: Number(parts[2]),
    minutes: minutes,
  };
}

/*
 * HOW A RUN, OR A PERSON'S PAGE, THAT RAN OUT OF TRIES SAYS SO
 * (OnCallPolicyRunRetry): what happened, what the last try failed with, and
 * what to do. Read back into the tries, the minutes they went on for, the
 * record and the error's own words - checked against the builder: the
 * same tries, minutes and record give the same line, but for the error,
 * whose words are the server's.
 */
const OUT_OF_TRIES_DURATION: string =
  "(less than a minute|1 minute|(\\d+) minutes)";
const RECORD_KIND_PATTERN: string = ON_CALL_POLICY_RUN_RECORD_KINDS.join("|");

const RUN_OUT_OF_TRIES: RegExp = new RegExp(
  `^OneUptime tried (\\d+) times in ${OUT_OF_TRIES_DURATION} to (start this run, and every try failed, so nobody was paged|move this run on, and every try failed, so it stopped paging)\\. The last try failed with: ([\\s\\S]*?)(?: If the (${RECORD_KIND_PATTERN}) still needs somebody, page them again\\.)?$`,
);

const PAGE_OUT_OF_TRIES: RegExp = new RegExp(
  `^OneUptime tried (\\d+) times in ${OUT_OF_TRIES_DURATION} to send this page's notifications, and every try failed, so it stopped\\. The last try failed with: ([\\s\\S]*?)(?: If the (${RECORD_KIND_PATTERN}) still needs this person, page them again\\.)?$`,
);

const MINUTE_IN_MS: number = 60 * 1000;

// The minutes "less than a minute", "1 minute" or "37 minutes" says; 0 for the first.
function readDurationMinutes(
  duration: string,
  minutes: string | undefined,
): number {
  if (duration === "1 minute") {
    return 1;
  }

  return minutes ? Number(minutes) : 0;
}

// Failures that write the same line again: to check one read back.
function failuresOf(data: { tries: number; minutes: number; error: string }): {
  failedTries: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  retryAt: Date;
  lastError: string;
} {
  const lastFailedAt: Date = new Date(data.minutes * MINUTE_IN_MS);

  return {
    failedTries: data.tries,
    firstFailedAt: new Date(0),
    lastFailedAt: lastFailedAt,
    retryAt: lastFailedAt,
    lastError: data.error,
  };
}

function readOutOfTries(message: string): OnCallLogLine | null {
  const run: RegExpMatchArray | null = message.match(RUN_OUT_OF_TRIES);

  if (run) {
    const tries: number = Number(run[1]);
    const minutes: number = readDurationMinutes(run[2]!, run[3]);
    const wasWaiting: boolean = run[4]!.startsWith("start");
    const words: string = (run[5] || "").trim();
    const recordKind: OnCallPolicyRunRecordKind | undefined = run[6] as
      | OnCallPolicyRunRecordKind
      | undefined;

    const rebuilt: string = getOnCallPolicyRunOutOfTriesMessage({
      failures: failuresOf({ tries: tries, minutes: minutes, error: words }),
      wasWaiting: wasWaiting,
      recordKind: recordKind,
    });

    if (rebuilt !== message) {
      return null;
    }

    return {
      code: OnCallLogLineCode.RunOutOfTries,
      tries: tries,
      minutes: minutes,
      wasWaiting: wasWaiting,
      words: words,
      ...(recordKind ? { recordKind: recordKind } : {}),
    };
  }

  const page: RegExpMatchArray | null = message.match(PAGE_OUT_OF_TRIES);

  if (page) {
    const tries: number = Number(page[1]);
    const minutes: number = readDurationMinutes(page[2]!, page[3]);
    const words: string = (page[4] || "").trim();
    const recordKind: OnCallPolicyRunRecordKind | undefined = page[5] as
      | OnCallPolicyRunRecordKind
      | undefined;

    const rebuilt: string = getUserOnCallLogOutOfTriesMessage({
      failures: failuresOf({ tries: tries, minutes: minutes, error: words }),
      recordKind: recordKind,
    });

    if (rebuilt !== message) {
      return null;
    }

    return {
      code: OnCallLogLineCode.PageOutOfTries,
      tries: tries,
      minutes: minutes,
      words: words,
      ...(recordKind ? { recordKind: recordKind } : {}),
    };
  }

  return null;
}

// The lines that are each one constant, whole, and the code each reads as.
const WHOLE_LINES: ReadonlyArray<[string, OnCallLogLineCode]> = [
  [ON_CALL_RUN_SCHEDULED_MESSAGE, OnCallLogLineCode.RunScheduled],
  [ON_CALL_RUN_EXECUTION_STARTED_MESSAGE, OnCallLogLineCode.RunStarted],
  [ON_CALL_RUN_PAGING_STARTED_MESSAGE, OnCallLogLineCode.RunPagingStarted],
  [ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE, OnCallLogLineCode.RunTimedOut],
  [ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE, OnCallLogLineCode.RunNeverStarted],
  [
    ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
    OnCallLogLineCode.DirectPageNobodyPaged,
  ],
  [ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE, OnCallLogLineCode.DirectPageTimedOut],
  [
    ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
    OnCallLogLineCode.DirectPageNeverStarted,
  ],
  [
    ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
    OnCallLogLineCode.TestPageSentToFirstLevel,
  ],
  [
    ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
    OnCallLogLineCode.LevelSkippedByEscalation,
  ],
  [
    ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
    OnCallLogLineCode.DirectPageNobodyToPage,
  ],
  [ON_CALL_PAGE_SENT_STATUS_MESSAGE, OnCallLogLineCode.PageSent],
  [USER_LOG_TIMED_OUT_STATUS_MESSAGE, OnCallLogLineCode.PageTimedOut],
  [
    ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    OnCallLogLineCode.NotificationAcknowledged,
  ],
  [
    ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
    OnCallLogLineCode.NotificationEscalatedFrom,
  ],
  [EMAIL_SENT_STATUS_MESSAGE, OnCallLogLineCode.EmailSent],
  [PUSH_NOTIFICATION_SENT_MESSAGE, OnCallLogLineCode.PushSent],
  [TELEGRAM_MESSAGE_SENT_MESSAGE, OnCallLogLineCode.TelegramSent],
  [WHATSAPP_MESSAGE_SENT_MESSAGE, OnCallLogLineCode.WhatsAppSent],
  [
    NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
    OnCallLogLineCode.PageNoLongerProjectMember,
  ],
  [
    ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE,
    OnCallLogLineCode.NotificationSeenAsObserver,
  ],
];

/*
 * One of an on-call log's own lines - of a run, a step of its timeline, a
 * person's page or one of its notifications - as a code with the values it
 * names; null for any other line.
 */
export function readOnCallLogLine(
  statusMessage: string | null | undefined,
): OnCallLogLine | null {
  const message: string = (statusMessage || "").trim();

  if (!message) {
    return null;
  }

  for (const [line, code] of WHOLE_LINES) {
    if (message === line) {
      return { code: code };
    }
  }

  // Today's words, and those written before Pass it on was renamed Escalate.
  if (isOnCallPagePassedOnSkipTimelineMessage(message)) {
    return { code: OnCallLogLineCode.SkippedAsEscalated };
  }

  if (isOnCallPagePassedOnStatusMessage(message)) {
    return { code: OnCallLogLineCode.PageEscalated };
  }

  const directCount: number | null = readPagedCount(
    message,
    getOnCallDirectPagePagingMessage,
  );

  if (directCount !== null) {
    return { code: OnCallLogLineCode.DirectPagePaged, count: directCount };
  }

  const testCount: number | null = readPagedCount(
    message,
    getOnCallTestPagePagingMessage,
  );

  if (testCount !== null) {
    return { code: OnCallLogLineCode.TestPageSent, count: testCount };
  }

  const pagingAgain: OnCallLogLine | null = readPagingAgain(message);

  if (pagingAgain) {
    return pagingAgain;
  }

  const handedOverMinutes: number | null =
    readUserOnCallLogHandedOverMinutes(message);

  if (handedOverMinutes !== null) {
    return {
      code: OnCallLogLineCode.PageHandedOver,
      minutes: handedOverMinutes,
    };
  }

  const outOfTries: OnCallLogLine | null = readOutOfTries(message);

  if (outOfTries) {
    return outOfTries;
  }

  const workspace: string | null = readWorkspaceMessageSentMessage(message);

  if (workspace) {
    return { code: OnCallLogLineCode.WorkspaceMessageSent, name: workspace };
  }

  const pageEnding: OnCallLogLine | null = readPageEnding(message);

  if (pageEnding) {
    return pageEnding;
  }

  const acknowledgedBy: { recordLabel: string; who: string } | null =
    readOnCallPageAcknowledgedByMessage(message);
  const acknowledgedKind: OnCallPolicyRunRecordKind | undefined = acknowledgedBy
    ? RECORD_KIND_OF_LABEL[acknowledgedBy.recordLabel]
    : undefined;

  if (acknowledgedBy && acknowledgedKind) {
    return {
      code: OnCallLogLineCode.PageAcknowledgedBy,
      recordKind: acknowledgedKind,
      name: acknowledgedBy.who,
    };
  }

  const seenByObserver: OnCallLogLine | null = readSeenByObserver(message);

  if (seenByObserver) {
    return seenByObserver;
  }

  const merged: OnCallLogLine | null = readMergedPageLine(message);

  if (merged) {
    return merged;
  }

  const stuckMinutes: number | null = readStuckNotificationMinutes(message);

  if (stuckMinutes !== null) {
    return { code: OnCallLogLineCode.NotificationStuck, minutes: stuckMinutes };
  }

  const delivery: ProviderDeliveryStatus | null =
    readProviderDeliveryStatusMessage(message);

  if (delivery) {
    return {
      code: OnCallLogLineCode.ProviderDelivery,
      status: delivery.status,
      ...(delivery.messageId ? { id: delivery.messageId } : {}),
      ...(delivery.errorCode ? { errorCode: delivery.errorCode } : {}),
      ...(delivery.providerError ? { words: delivery.providerError } : {}),
    };
  }

  const withoutImages: string | null =
    readEmailSentWithoutImagesMessage(message);

  if (withoutImages) {
    return {
      code: OnCallLogLineCode.EmailSentWithoutImages,
      words: withoutImages,
    };
  }

  const call: {
    outcome: CallOutcomeLine;
    seconds?: number | undefined;
    callId?: string | undefined;
  } | null = readCallOutcomeMessage(message);

  if (call) {
    return {
      code: OnCallLogLineCode.CallEnded,
      callOutcome: call.outcome,
      ...(call.seconds !== undefined ? { seconds: call.seconds } : {}),
      ...(call.callId ? { id: call.callId } : {}),
    };
  }

  const providerId: { id: string; isCall: boolean } | null =
    readProviderIdStatusMessage(message);

  if (providerId) {
    return {
      code: providerId.isCall
        ? OnCallLogLineCode.CallPlaced
        : OnCallLogLineCode.SentWithMessageId,
      id: providerId.id,
    };
  }

  return null;
}
