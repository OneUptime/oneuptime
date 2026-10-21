import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import {
  CALL_SUMMARY_VERSION,
  CallSummary,
  CallSummaryBasis,
  CallSummaryCitation,
  CallSummaryFindingKind,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
} from "../../../Types/VideoCall/CallSummary";
import { CallTranscriptFetchStatus } from "../../../Types/VideoCall/CallTranscriptAutoFetch";
import {
  VideoCallTranscriptInfo,
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
} from "../../../Types/VideoCall/VideoCallTranscript";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import TranscriptText, {
  TranscriptLine,
} from "../../../Utils/VideoCall/TranscriptText";

/*
 * An incident call with its transcript and what OneUptime AI read in it
 * (issue #4875), as the incident page reads it - for the suites of the
 * Video Call card's transcript, the transcript dialogs and the AI
 * Investigation card's section.
 *
 * The call is the checkout incident the E2E fixture tells too: a release
 * shipped with DB_POOL_MAX=10 instead of 40, found and rolled back on a
 * Zoom meeting.
 */

export const CALL_ID: string = "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a";
export const OTHER_CALL_ID: string = "7e6d5c4b-3a2f-4e1d-9c8b-7a6f5e4d3c2b";
export const INCIDENT_ID: string = "3b2a1f0e-9d8c-4b7a-8f6e-5d4c3b2a1f0e";

export function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60 * 1000);
}

export function citation(
  line: number,
  time: string,
  speaker: string,
  text: string,
): CallSummaryCitation {
  return { line, time, speaker, text };
}

export const RELEASE_LINE: CallSummaryCitation = citation(
  6,
  "00:04:03",
  "Sam Rivera",
  "The new release has DB_POOL_MAX=10, it was 40 before.",
);

export const CAUSE_LINE: CallSummaryCitation = citation(
  11,
  "00:10:20",
  "Maya Chen",
  "So the pool size change caused it. Jordan, can you add an alert on pool usage?",
);

export const ROLLBACK_LINE: CallSummaryCitation = citation(
  9,
  "00:06:15",
  "Sam Rivera",
  "Rolling checkout-api back to 2026.09.14-1 now.",
);

export const DATABASE_LINE: CallSummaryCitation = citation(
  2,
  "00:00:31",
  "Jordan Patel",
  "Orders DB looks healthy from its side, CPU is at 30%.",
);

export const SUGGESTED_CAUSE: string =
  "checkout-api 2026.09.14-2 shipped with DB_POOL_MAX=10 instead of 40, so requests queued for a database connection.";

// A cause the call named: its quotes as the model gave them, not in order.
export function suggestedSummary(): CallSummary {
  return {
    version: CALL_SUMMARY_VERSION,
    runId: "run-2",
    generatedAt: "2026-09-14T18:15:00.000Z",
    rootCause: {
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary: SUGGESTED_CAUSE,
      basis: CallSummaryBasis.StatedOnCall,
      citations: [CAUSE_LINE, RELEASE_LINE],
    },
    findings: [
      {
        text: "The orders database itself was healthy.",
        kind: CallSummaryFindingKind.Confirmed,
        citations: [DATABASE_LINE],
      },
      {
        text: "A cold cache may have added to the latency.",
        kind: CallSummaryFindingKind.Hypothesis,
        citations: [],
      },
    ],
    stepsTried: [
      {
        text: "Rolled checkout-api back to 2026.09.14-1.",
        citations: [ROLLBACK_LINE],
      },
    ],
    decisions: [
      {
        text: "Keep the rollback until the pool size is fixed.",
        citations: [],
      },
    ],
    actions: [
      {
        text: "Add an alert on pool usage.",
        owner: "Jordan Patel",
        citations: [CAUSE_LINE],
      },
    ],
    openQuestions: [],
    linesRead: 12,
    partsRead: 1,
  };
}

// A call that did not settle the cause.
export function notEnoughSummary(): CallSummary {
  return {
    ...suggestedSummary(),
    rootCause: {
      outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
      citations: [],
    },
    findings: [],
    decisions: [],
    actions: [],
    openQuestions: [
      {
        text: "What changed in checkout-api today?",
        citations: [
          citation(
            4,
            "00:02:40",
            "Maya Chen",
            "Did anything ship in the last hour?",
          ),
        ],
      },
    ],
  };
}

// The call's remarks, in order: line 6 is RELEASE_LINE, line 11 CAUSE_LINE.
export const TRANSCRIPT_LINES: Array<TranscriptLine> = [
  [8, "Sam Rivera", "I'm on. Checkout p95 is at 2.4 seconds and climbing."],
  [31, "Jordan Patel", "Orders DB looks healthy from its side, CPU is at 30%."],
  [
    72,
    "Sam Rivera",
    "The app side is waiting on pg.pool.connect, most requests wait about two seconds.",
  ],
  [160, "Maya Chen", "Did anything ship in the last hour?"],
  [175, "Jordan Patel", "checkout-api 2026.09.14-2 went out at 17:52."],
  [243, "Sam Rivera", "The new release has DB_POOL_MAX=10, it was 40 before."],
  [270, "Maya Chen", "That would explain the queueing. Can we roll back?"],
  [302, "Jordan Patel", "Maybe the cache is cold too, I'm not sure."],
  [375, "Sam Rivera", "Rolling checkout-api back to 2026.09.14-1 now."],
  [588, "Sam Rivera", "Rollback done, p95 is back under 300 milliseconds."],
  [
    620,
    "Maya Chen",
    "So the pool size change caused it. Jordan, can you add an alert on pool usage?",
  ],
  [
    641,
    "Jordan Patel",
    "On it. I'll also fix the default in the release config.",
  ],
].map((entry: Array<string | number>): TranscriptLine => {
  return {
    offsetInSeconds: entry[0] as number,
    speaker: entry[1] as string,
    text: entry[2] as string,
  };
});

// The transcript as OneUptime stores it, and the transcript dialog reads it.
export function storedTranscript(): string {
  return TranscriptText.serialize(TRANSCRIPT_LINES);
}

export const TRANSCRIPT_INFO: VideoCallTranscriptInfo = {
  lineCount: 12,
  speakerCount: 3,
  characterCount: 790,
  durationInSeconds: 641,
};

function userNamed(name: string): User {
  const user: User = new User();
  user.id = ObjectID.generate();
  user.name = new Name(name);
  return user;
}

export interface TranscriptCallData {
  id?: string | undefined;
  provider?: VideoCallProvider | undefined;
  title?: string | undefined;
  // Started with one of the project's connections, so its provider can be asked.
  withConnection?: boolean | undefined;
  /*
   * A Microsoft Teams meeting OneUptime put on its organizer's calendar, as
   * it does while it records incident calls: its provider can be asked.
   * Any other Teams meeting has no connection or meeting id here.
   */
  onCalendar?: boolean | undefined;
  info?: VideoCallTranscriptInfo | null | undefined;
  source?: VideoCallTranscriptSource | undefined;
  addedMinutesAgo?: number | undefined;
  addedBy?: string | undefined;
  status?: CallSummaryStatus | undefined;
  statusMessage?: string | undefined;
  statusMinutesAgo?: number | undefined;
  summary?: CallSummary | undefined;
  suggestion?: RootCauseSuggestionStatus | undefined;
  reviewedBy?: string | undefined;
  reviewedMinutesAgo?: number | undefined;
  createdMinutesAgo?: number | undefined;
  // Where OneUptime stands in getting the transcript by itself.
  fetchStatus?: CallTranscriptFetchStatus | undefined;
  fetchReason?: VideoCallTranscriptUnavailableReason | undefined;
}

/*
 * An incident's call. With `info`, it has a transcript; with `status`,
 * OneUptime AI is reading it, has read it, or did not.
 */
export function transcriptCall(
  data: TranscriptCallData = {},
): IncidentVideoCall {
  const call: IncidentVideoCall = new IncidentVideoCall();
  call.id = new ObjectID(data.id || CALL_ID);
  call.provider = data.provider || VideoCallProvider.Zoom;
  call.joinUrl =
    call.provider === VideoCallProvider.MicrosoftTeams
      ? "https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc%40thread.v2/0"
      : "https://example.zoom.us/j/81234567890?pwd=abc";
  call.title = data.title || "INC-1042: Checkout API p95 above 2s";
  call.workspaceNotificationRuleId = ObjectID.generate();
  call.createdAt = minutesAgo(data.createdMinutesAgo ?? 40);

  if (
    data.withConnection !== false &&
    call.provider !== VideoCallProvider.MicrosoftTeams
  ) {
    call.videoCallConnectionId = ObjectID.generate();
    call.externalMeetingId = "81234567890";
  }

  if (call.provider === VideoCallProvider.MicrosoftTeams && data.onCalendar) {
    call.videoCallConnectionId = ObjectID.generate();
    call.externalMeetingId = "MSpkYzE3Njc0Yy04MWQ5LTRhZGItYmZi";
    call.externalCalendarEventId = "AAMkAGI2TG93AAA=";
  }

  if (data.info) {
    call.transcriptInfo = { ...data.info } as never;
    call.transcriptSource = data.source || VideoCallTranscriptSource.Provider;
    call.transcriptAddedAt = minutesAgo(data.addedMinutesAgo ?? 5);

    if (data.addedBy) {
      call.transcriptAddedByUser = userNamed(data.addedBy);
    }
  }

  if (data.status) {
    call.callSummaryStatus = data.status;
    call.callSummaryUpdatedAt = minutesAgo(data.statusMinutesAgo ?? 1);

    if (data.statusMessage) {
      call.callSummaryStatusMessage = data.statusMessage;
    }
  }

  if (data.summary) {
    call.callSummary = JSON.parse(JSON.stringify(data.summary)) as never;
  }

  if (data.suggestion) {
    call.rootCauseSuggestionStatus = data.suggestion;
  }

  if (data.reviewedBy) {
    call.rootCauseSuggestionReviewedByUser = userNamed(data.reviewedBy);
    call.rootCauseSuggestionReviewedAt = minutesAgo(
      data.reviewedMinutesAgo ?? 2,
    );
  }

  if (data.fetchStatus) {
    call.transcriptFetchStatus = data.fetchStatus;
  }

  if (data.fetchReason) {
    call.transcriptFetchReason = data.fetchReason;
  }

  return call;
}

// A call OneUptime AI has read, suggesting a root cause nobody has decided on.
export function suggestedCall(
  data: TranscriptCallData = {},
): IncidentVideoCall {
  return transcriptCall({
    info: TRANSCRIPT_INFO,
    status: CallSummaryStatus.Ready,
    summary: suggestedSummary(),
    suggestion: RootCauseSuggestionStatus.Suggested,
    ...data,
  });
}
