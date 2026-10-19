import { CallSummaryStatus, isCallSummaryStale } from "./CallSummary";
import { VideoCallTranscriptUnavailableReason } from "./VideoCallTranscript";

/*
 * AN INCIDENT CALL'S TRANSCRIPT, WITHOUT ANYONE ASKING FOR IT.
 *
 * With Record and transcribe incident calls on (Project Settings > Workspace >
 * Video Calls, Project.recordAndTranscribeIncidentCalls), OneUptime asks Zoom
 * and Google Meet to record and transcribe each incident call it starts, and
 * afterwards asks the provider for the call's transcript until it has it -
 * what Get from Zoom does, without anyone pressing it. No transcript exists
 * before the call ends, and the provider prepares it after that (Zoom
 * within about twice the call's length), so OneUptime asks often at first,
 * less often as the call gets older, and stops:
 *
 *   - when it has the transcript, which OneUptime AI then reads;
 *   - when asking again would get the same answer until a person acts: the
 *     connection may not read transcripts, its sign-in stopped working, the
 *     provider deleted the transcript, or has no way to give one
 *     (FINAL_CALL_TRANSCRIPT_FETCH_REASONS);
 *   - CALL_TRANSCRIPT_FETCH_WINDOW_MS after the call started, keeping the
 *     last answer, so a call nobody recorded is not asked about forever.
 *
 * Where each call stands is kept on the call, written by the server only
 * (IncidentVideoCall.transcriptFetch*): Waiting - asked again at
 * transcriptFetchNextAttemptAt - or Stopped, with transcriptFetchReason
 * saying why. A person can still Get from Zoom or Add transcript at any
 * time, and either ends the waiting.
 *
 * Shared by the server (the job that asks, and the postmortem draft that
 * waits for what the call said) and the dashboard (the Video Call card
 * says it is waiting), so both decide alike.
 */

export enum CallTranscriptFetchStatus {
  // OneUptime asks the provider again at transcriptFetchNextAttemptAt.
  Waiting = "Waiting",
  // OneUptime stopped asking; transcriptFetchReason says why.
  Stopped = "Stopped",
}

export function isCallTranscriptFetchStatus(
  value: unknown,
): value is CallTranscriptFetchStatus {
  return (
    value === CallTranscriptFetchStatus.Waiting ||
    value === CallTranscriptFetchStatus.Stopped
  );
}

const MINUTE_IN_MS: number = 60 * 1000;
const HOUR_IN_MS: number = 60 * MINUTE_IN_MS;

// The first time a new call is asked about: an incident call is rarely over sooner.
export const CALL_TRANSCRIPT_FIRST_FETCH_AFTER_MS: number = 10 * MINUTE_IN_MS;

// How long after a call started OneUptime keeps asking for its transcript.
export const CALL_TRANSCRIPT_FETCH_WINDOW_MS: number = 72 * HOUR_IN_MS;

/*
 * Answers that asking again does not change until a person acts: a scope
 * to add, a connection to sign in again, a transcript the provider deleted
 * or cannot give. "Not ready", "not transcribed" and "no meeting" are not
 * among them - the call may still be running, or the provider still
 * preparing its transcript.
 */
export const FINAL_CALL_TRANSCRIPT_FETCH_REASONS: ReadonlyArray<VideoCallTranscriptUnavailableReason> =
  [
    VideoCallTranscriptUnavailableReason.PermissionMissing,
    VideoCallTranscriptUnavailableReason.ConnectionProblem,
    VideoCallTranscriptUnavailableReason.Expired,
    VideoCallTranscriptUnavailableReason.NotSupported,
  ];

// How long to wait before asking again, by how long ago the call started.
export function getCallTranscriptFetchInterval(callAgeInMs: number): number {
  if (callAgeInMs < 2 * HOUR_IN_MS) {
    return 5 * MINUTE_IN_MS;
  }

  if (callAgeInMs < 12 * HOUR_IN_MS) {
    return 15 * MINUTE_IN_MS;
  }

  return HOUR_IN_MS;
}

// When a call that just started is first asked about.
export function getFirstCallTranscriptFetchAt(callStartedAt: Date): Date {
  return new Date(
    callStartedAt.getTime() + CALL_TRANSCRIPT_FIRST_FETCH_AFTER_MS,
  );
}

export interface CallTranscriptFetchNext {
  status: CallTranscriptFetchStatus;
  // When to ask again; null once OneUptime stopped asking.
  nextAttemptAt: Date | null;
}

/*
 * What follows an answer without a transcript: asked again later, or no
 * more. `reason` is why the provider had none to give; without one, the
 * provider did not answer at all (a timeout, a 5xx, a rate limit), which is
 * asked again like any wait.
 */
export function getNextCallTranscriptFetch(data: {
  callStartedAt: Date;
  now: Date;
  reason?: VideoCallTranscriptUnavailableReason | undefined;
}): CallTranscriptFetchNext {
  if (
    data.reason !== undefined &&
    FINAL_CALL_TRANSCRIPT_FETCH_REASONS.includes(data.reason)
  ) {
    return { status: CallTranscriptFetchStatus.Stopped, nextAttemptAt: null };
  }

  const startedAt: number = data.callStartedAt.getTime();
  const now: number = data.now.getTime();
  const nextAttemptAt: number =
    now + getCallTranscriptFetchInterval(Math.max(0, now - startedAt));

  if (nextAttemptAt - startedAt > CALL_TRANSCRIPT_FETCH_WINDOW_MS) {
    return { status: CallTranscriptFetchStatus.Stopped, nextAttemptAt: null };
  }

  return {
    status: CallTranscriptFetchStatus.Waiting,
    nextAttemptAt: new Date(nextAttemptAt),
  };
}

/*
 * HOW LONG AN INCIDENT'S POSTMORTEM DRAFT WAITS FOR WHAT ITS CALLS SAID.
 *
 * The automatic postmortem draft is written when the incident resolves,
 * and it reads what OneUptime AI read in the incident's calls
 * (CallSummaryContext). A call usually ends about when the incident does,
 * so its transcript comes after the resolve; the draft waits for it, as
 * long as one can be expected:
 *
 *   - a transcript OneUptime AI is reading: until the reading is done (a
 *     reading that stalled is not waited on, isCallSummaryStale);
 *   - a transcript the provider is still preparing (its last answer was
 *     NotReady): up to POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS after
 *     the draft started waiting - Zoom takes up to about twice the call's
 *     length;
 *   - a call OneUptime still asks about with no sign of a transcript yet
 *     (not asked yet, nothing recorded yet, no meeting yet): up to
 *     POSTMORTEM_WAITS_FOR_UNSEEN_TRANSCRIPT_MS, long enough for a call that
 *     ends with the incident to show its transcript, short enough that a
 *     call nobody recorded does not hold the draft back for hours.
 *
 * A call OneUptime does not ask about - not watched, stopped, or read
 * already - holds nothing back.
 */
export const POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS: number =
  6 * HOUR_IN_MS;
export const POSTMORTEM_WAITS_FOR_UNSEEN_TRANSCRIPT_MS: number = HOUR_IN_MS;

// What a call's columns say about its transcript, as the wait reads them.
export interface PostmortemCallState {
  hasTranscript: boolean;
  transcriptFetchStatus?: string | null | undefined;
  transcriptFetchReason?: string | null | undefined;
  callSummaryStatus?: string | null | undefined;
  callSummaryUpdatedAt?: Date | string | null | undefined;
}

export function isPostmortemWaitingForCall(data: {
  call: PostmortemCallState;
  // When the draft started waiting: the incident's resolve.
  waitingSince: Date;
  now: Date;
}): boolean {
  if (data.call.hasTranscript) {
    return (
      data.call.callSummaryStatus === CallSummaryStatus.Pending &&
      !isCallSummaryStale({
        status: data.call.callSummaryStatus,
        updatedAt: data.call.callSummaryUpdatedAt,
        now: data.now,
      })
    );
  }

  if (data.call.transcriptFetchStatus !== CallTranscriptFetchStatus.Waiting) {
    return false;
  }

  const waited: number = data.now.getTime() - data.waitingSince.getTime();
  const longest: number =
    data.call.transcriptFetchReason ===
    VideoCallTranscriptUnavailableReason.NotReady
      ? POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS
      : POSTMORTEM_WAITS_FOR_UNSEEN_TRANSCRIPT_MS;

  return waited < longest;
}

export function isPostmortemWaitingForCalls(data: {
  calls: ReadonlyArray<PostmortemCallState>;
  waitingSince: Date;
  now: Date;
}): boolean {
  return data.calls.some((call: PostmortemCallState): boolean => {
    return isPostmortemWaitingForCall({
      call,
      waitingSince: data.waitingSince,
      now: data.now,
    });
  });
}
