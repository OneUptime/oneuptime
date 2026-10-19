import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import OneUptimeDate from "Common/Types/Date";
import {
  CallSummary,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
  isCallSummaryStale,
  isRootCauseSuggestionStatus,
  readCallSummary,
} from "Common/Types/VideoCall/CallSummary";
import {
  CallTranscriptFetchStatus,
  isCallTranscriptFetchStatus,
} from "Common/Types/VideoCall/CallTranscriptAutoFetch";
import {
  VideoCallTranscriptInfo,
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
  canReadVideoCallTranscriptFromProvider,
  isVideoCallTranscriptSource,
  isVideoCallTranscriptUnavailableReason,
} from "Common/Types/VideoCall/VideoCallTranscript";
import TranscriptText from "Common/Utils/VideoCall/TranscriptText";
import {
  formatFeedTimeAgo,
  getFeedClock,
} from "Common/UI/Components/Feed/FeedTime";

/*
 * WHERE AN INCIDENT CALL'S TRANSCRIPT STANDS, for the page (issue #4875).
 *
 * The Video Call card shows a call's transcript - whether it has one, where
 * it came from, and whether OneUptime AI has read it - and the AI
 * Investigation card shows what OneUptime AI read in it. Both work from
 * this one reading of the call's columns, so they never disagree.
 *
 * React-free on purpose: App's tests read it.
 */

// Where OneUptime AI's reading of the transcript stands.
export enum CallTranscriptReading {
  // No transcript, so nothing to read.
  None = "None",
  Reading = "Reading",
  // Pending for so long it stopped somewhere: offered again.
  Stuck = "Stuck",
  Ready = "Ready",
  Failed = "Failed",
  // AI is off for the project.
  Skipped = "Skipped",
}

export interface CallTranscriptView {
  hasTranscript: boolean;
  // A Zoom or Google Meet meeting OneUptime started, whose provider can be asked.
  canGetFromProvider: boolean;
  /*
   * Where OneUptime stands in getting the transcript by itself (Record and
   * transcribe incident calls): Waiting until the call is over, Stopped
   * with the provider's last answer, or null - not asked, or done.
   */
  fetchStatus: CallTranscriptFetchStatus | null;
  fetchReason: VideoCallTranscriptUnavailableReason | null;
  info: VideoCallTranscriptInfo | null;
  source: VideoCallTranscriptSource | null;
  addedAt?: Date | undefined;
  addedByName?: string | undefined;
  reading: CallTranscriptReading;
  // Why it was not read, or could not be.
  readingMessage?: string | undefined;
  summary: CallSummary | null;
  // What a person decided about the suggested root cause; null when none was suggested.
  suggestion: RootCauseSuggestionStatus | null;
  reviewedByName?: string | undefined;
  reviewedAt?: Date | undefined;
}

function nameOf(
  user: { name?: unknown; email?: unknown } | undefined,
): string | undefined {
  const name: string = user?.name ? String(user.name).trim() : "";
  const email: string = user?.email ? String(user.email).trim() : "";

  return name || email || undefined;
}

function dateOf(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = OneUptimeDate.fromString(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function getCallTranscriptView(
  call: IncidentVideoCall,
  now: Date,
): CallTranscriptView {
  const info: VideoCallTranscriptInfo | null = TranscriptText.readInfo(
    call.transcriptInfo,
  );
  // The list never carries the transcript itself: its info says it is there.
  const hasTranscript: boolean = Boolean(info || call.transcriptAddedAt);
  const status: CallSummaryStatus | undefined = call.callSummaryStatus;

  let reading: CallTranscriptReading = CallTranscriptReading.None;

  if (hasTranscript) {
    switch (status) {
      case CallSummaryStatus.Pending:
        reading = isCallSummaryStale({
          status,
          updatedAt: call.callSummaryUpdatedAt,
          now,
        })
          ? CallTranscriptReading.Stuck
          : CallTranscriptReading.Reading;
        break;
      case CallSummaryStatus.Ready:
        reading = CallTranscriptReading.Ready;
        break;
      case CallSummaryStatus.Failed:
        reading = CallTranscriptReading.Failed;
        break;
      case CallSummaryStatus.Skipped:
        reading = CallTranscriptReading.Skipped;
        break;
      default:
        reading = CallTranscriptReading.None;
    }
  }

  const summary: CallSummary | null =
    reading === CallTranscriptReading.Ready
      ? readCallSummary(call.callSummary)
      : null;

  const suggestion: RootCauseSuggestionStatus | null =
    summary &&
    summary.rootCause.outcome === CallSummaryRootCauseOutcome.Suggested &&
    isRootCauseSuggestionStatus(call.rootCauseSuggestionStatus)
      ? call.rootCauseSuggestionStatus
      : null;

  return {
    hasTranscript,
    canGetFromProvider: canReadVideoCallTranscriptFromProvider(call),
    // Once there is a transcript, nothing is waited for.
    fetchStatus:
      !hasTranscript && isCallTranscriptFetchStatus(call.transcriptFetchStatus)
        ? call.transcriptFetchStatus
        : null,
    fetchReason:
      !hasTranscript &&
      isVideoCallTranscriptUnavailableReason(call.transcriptFetchReason)
        ? call.transcriptFetchReason
        : null,
    info,
    source: isVideoCallTranscriptSource(call.transcriptSource)
      ? call.transcriptSource
      : null,
    addedAt: dateOf(call.transcriptAddedAt),
    addedByName: nameOf(call.transcriptAddedByUser),
    reading,
    readingMessage: call.callSummaryStatusMessage || undefined,
    summary,
    suggestion,
    reviewedByName: nameOf(call.rootCauseSuggestionReviewedByUser),
    reviewedAt: dateOf(call.rootCauseSuggestionReviewedAt),
  };
}

// The calls whose reading the AI Investigation card shows: read, being read, or stopped.
export function getCallsWithReadings(
  calls: Array<IncidentVideoCall>,
  now: Date,
): Array<{ call: IncidentVideoCall; view: CallTranscriptView }> {
  return calls
    .map((call: IncidentVideoCall) => {
      return { call, view: getCallTranscriptView(call, now) };
    })
    .filter((entry: { view: CallTranscriptView }): boolean => {
      return (
        entry.view.reading === CallTranscriptReading.Ready ||
        entry.view.reading === CallTranscriptReading.Reading ||
        entry.view.reading === CallTranscriptReading.Stuck ||
        entry.view.reading === CallTranscriptReading.Failed
      );
    });
}

/*
 * When something happened to a call or its transcript - started, read from
 * the provider, added, used, dismissed - as the sentences around it say it:
 * "5 minutes ago" in English, "vor 5 Minuten" in German, from the browser's
 * own words (formatFeedTimeAgo), not moment's fromNow, which is English on
 * every page. Never "now": under a minute and a half is a minute ago, so
 * "Read from Zoom {{when}}" always reads as a sentence.
 */
export function formatCallTranscriptTime(data: {
  date: Date;
  language: string;
  now: Date;
}): string {
  return (
    formatFeedTimeAgo(
      data.date,
      getFeedClock({ language: data.language, now: data.now }),
    ) || OneUptimeDate.fromNow(data.date)
  );
}

// The DOM id of a call's section in the AI Investigation card.
export function getCallSummarySectionId(callId: string): string {
  return `call-summary-${callId}`;
}

// The longest transcript file the Add transcript dialog reads in the browser.
export const MAX_TRANSCRIPT_FILE_BYTES: number = 5 * 1024 * 1024;
