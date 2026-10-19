import { describe, expect, test } from "@jest/globals";
import {
  CALL_SUMMARY_STALE_AFTER_MS,
  CallSummaryStatus,
} from "../../../Types/VideoCall/CallSummary";
import {
  CALL_TRANSCRIPT_FETCH_WINDOW_MS,
  CALL_TRANSCRIPT_FIRST_FETCH_AFTER_MS,
  CallTranscriptFetchNext,
  CallTranscriptFetchStatus,
  FINAL_CALL_TRANSCRIPT_FETCH_REASONS,
  POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS,
  POSTMORTEM_WAITS_FOR_UNSEEN_TRANSCRIPT_MS,
  PostmortemCallState,
  getCallTranscriptFetchInterval,
  getFirstCallTranscriptFetchAt,
  getNextCallTranscriptFetch,
  isCallTranscriptFetchStatus,
  isPostmortemWaitingForCall,
  isPostmortemWaitingForCalls,
} from "../../../Types/VideoCall/CallTranscriptAutoFetch";
import {
  VideoCallTranscriptUnavailableReason,
  isVideoCallTranscriptUnavailableReason,
} from "../../../Types/VideoCall/VideoCallTranscript";

/*
 * Getting an incident call's transcript by itself (Record and transcribe
 * incident calls): when OneUptime asks the provider again, when it stops,
 * and how long an incident's postmortem draft waits for what its call said.
 * Pure rules, shared by the job that asks, the postmortem runner and the
 * Video Call card, so each is pinned here once.
 */

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const STARTED: Date = new Date("2026-10-19T10:00:00.000Z");

function at(offsetInMs: number): Date {
  return new Date(STARTED.getTime() + offsetInMs);
}

// The answers that are not final: the call may still run, or the provider still prepare.
const WAITING_REASONS: Array<VideoCallTranscriptUnavailableReason> = [
  VideoCallTranscriptUnavailableReason.NotReady,
  VideoCallTranscriptUnavailableReason.NotTranscribed,
  VideoCallTranscriptUnavailableReason.NoMeeting,
];

describe("isCallTranscriptFetchStatus", () => {
  test("knows the two statuses", () => {
    expect(isCallTranscriptFetchStatus(CallTranscriptFetchStatus.Waiting)).toBe(
      true,
    );
    expect(isCallTranscriptFetchStatus(CallTranscriptFetchStatus.Stopped)).toBe(
      true,
    );
  });

  test.each([
    ["another word", "Done"],
    ["the wrong case", "waiting"],
    ["empty", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1],
  ])("refuses %s", (_name: string, value: unknown) => {
    expect(isCallTranscriptFetchStatus(value)).toBe(false);
  });
});

describe("isVideoCallTranscriptUnavailableReason", () => {
  test("knows every reason the providers answer with", () => {
    for (const reason of Object.values(VideoCallTranscriptUnavailableReason)) {
      expect(isVideoCallTranscriptUnavailableReason(reason)).toBe(true);
    }
  });

  test.each([["Unknown"], ["notready"], [""], [null], [undefined], [404]])(
    "refuses %p",
    (value: unknown) => {
      expect(isVideoCallTranscriptUnavailableReason(value)).toBe(false);
    },
  );
});

describe("when OneUptime asks the provider", () => {
  test("first, a little after the call started", () => {
    expect(getFirstCallTranscriptFetchAt(STARTED)).toEqual(
      at(CALL_TRANSCRIPT_FIRST_FETCH_AFTER_MS),
    );
    expect(CALL_TRANSCRIPT_FIRST_FETCH_AFTER_MS).toBe(10 * MINUTE);
  });

  test.each([
    ["just started", 0, 5 * MINUTE],
    ["an hour in", HOUR, 5 * MINUTE],
    ["a moment short of two hours", 2 * HOUR - 1, 5 * MINUTE],
    ["two hours in", 2 * HOUR, 15 * MINUTE],
    ["six hours in", 6 * HOUR, 15 * MINUTE],
    ["a moment short of twelve hours", 12 * HOUR - 1, 15 * MINUTE],
    ["twelve hours in", 12 * HOUR, HOUR],
    ["two days in", 48 * HOUR, HOUR],
  ])(
    "then often at first and less often later: %s, every %p ms",
    (_name: string, age: number, interval: number) => {
      expect(getCallTranscriptFetchInterval(age)).toBe(interval);
    },
  );

  test("never asks less often as the call gets younger", () => {
    let previous: number = 0;

    for (let age: number = 0; age <= 80 * HOUR; age += 7 * MINUTE) {
      const interval: number = getCallTranscriptFetchInterval(age);

      expect(interval).toBeGreaterThanOrEqual(previous);
      previous = interval;
    }
  });
});

describe("after an answer without a transcript", () => {
  test.each(
    FINAL_CALL_TRANSCRIPT_FETCH_REASONS.map(
      (reason: VideoCallTranscriptUnavailableReason) => {
        return [reason];
      },
    ),
  )(
    "%s is final: OneUptime stops asking at once",
    (reason: VideoCallTranscriptUnavailableReason) => {
      const next: CallTranscriptFetchNext = getNextCallTranscriptFetch({
        callStartedAt: STARTED,
        now: at(20 * MINUTE),
        reason,
      });

      expect(next).toEqual({
        status: CallTranscriptFetchStatus.Stopped,
        nextAttemptAt: null,
      });
    },
  );

  test.each(
    WAITING_REASONS.map((reason: VideoCallTranscriptUnavailableReason) => {
      return [reason];
    }),
  )(
    "%s is not final: OneUptime asks again later",
    (reason: VideoCallTranscriptUnavailableReason) => {
      const now: Date = at(30 * MINUTE);
      const next: CallTranscriptFetchNext = getNextCallTranscriptFetch({
        callStartedAt: STARTED,
        now,
        reason,
      });

      expect(next).toEqual({
        status: CallTranscriptFetchStatus.Waiting,
        nextAttemptAt: new Date(now.getTime() + 5 * MINUTE),
      });
    },
  );

  test("every reason a provider answers with is either final or waited out", () => {
    for (const reason of Object.values(VideoCallTranscriptUnavailableReason)) {
      expect({
        reason,
        classified:
          FINAL_CALL_TRANSCRIPT_FETCH_REASONS.includes(reason) !==
          WAITING_REASONS.includes(reason),
      }).toEqual({ reason, classified: true });
    }
  });

  test("a provider that did not answer at all is asked again, at the call's pace", () => {
    const now: Date = at(3 * HOUR);
    const next: CallTranscriptFetchNext = getNextCallTranscriptFetch({
      callStartedAt: STARTED,
      now,
      reason: undefined,
    });

    expect(next).toEqual({
      status: CallTranscriptFetchStatus.Waiting,
      nextAttemptAt: new Date(now.getTime() + 15 * MINUTE),
    });
  });

  test("the next attempt follows the call's age: rarer as it gets older", () => {
    const later: Date = at(20 * HOUR);

    expect(
      getNextCallTranscriptFetch({
        callStartedAt: STARTED,
        now: later,
        reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      }).nextAttemptAt,
    ).toEqual(new Date(later.getTime() + HOUR));
  });

  test("a call that seems to start in the future (clocks disagree) is asked about at the first pace", () => {
    const now: Date = at(-2 * MINUTE);

    expect(
      getNextCallTranscriptFetch({
        callStartedAt: STARTED,
        now,
        reason: VideoCallTranscriptUnavailableReason.NoMeeting,
      }).nextAttemptAt,
    ).toEqual(new Date(now.getTime() + 5 * MINUTE));
  });

  test("an attempt that would land exactly at the window's end is still made", () => {
    // 71 hours in, the next attempt is an hour later: the window's last moment.
    const now: Date = at(CALL_TRANSCRIPT_FETCH_WINDOW_MS - HOUR);
    const next: CallTranscriptFetchNext = getNextCallTranscriptFetch({
      callStartedAt: STARTED,
      now,
      reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
    });

    expect(next).toEqual({
      status: CallTranscriptFetchStatus.Waiting,
      nextAttemptAt: at(CALL_TRANSCRIPT_FETCH_WINDOW_MS),
    });
  });

  test("an attempt that would land past the window is not: the last answer stands", () => {
    const now: Date = at(CALL_TRANSCRIPT_FETCH_WINDOW_MS - HOUR + 1);

    expect(
      getNextCallTranscriptFetch({
        callStartedAt: STARTED,
        now,
        reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      }),
    ).toEqual({
      status: CallTranscriptFetchStatus.Stopped,
      nextAttemptAt: null,
    });
    expect(CALL_TRANSCRIPT_FETCH_WINDOW_MS).toBe(72 * HOUR);
  });

  test("a call nobody recorded is asked about a bounded number of times, then left alone", () => {
    let now: Date = getFirstCallTranscriptFetchAt(STARTED);
    let attempts: number = 0;
    let previousGap: number = 0;

    for (;;) {
      attempts++;

      const next: CallTranscriptFetchNext = getNextCallTranscriptFetch({
        callStartedAt: STARTED,
        now,
        reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      });

      if (next.status === CallTranscriptFetchStatus.Stopped) {
        break;
      }

      const gap: number = next.nextAttemptAt!.getTime() - now.getTime();

      expect(gap).toBeGreaterThanOrEqual(previousGap);
      expect(
        next.nextAttemptAt!.getTime() - STARTED.getTime(),
      ).toBeLessThanOrEqual(CALL_TRANSCRIPT_FETCH_WINDOW_MS);

      previousGap = gap;
      now = next.nextAttemptAt!;
    }

    // 22 at five minutes, 40 at fifteen, 60 at an hour: about 120 in three days.
    expect(attempts).toBeGreaterThan(100);
    expect(attempts).toBeLessThan(140);
    expect(now.getTime() - STARTED.getTime()).toBeLessThanOrEqual(
      CALL_TRANSCRIPT_FETCH_WINDOW_MS,
    );
  });
});

describe("how long a postmortem draft waits for a call", () => {
  const RESOLVED: Date = at(2 * HOUR);

  function waits(call: PostmortemCallState, waited: number): boolean {
    return isPostmortemWaitingForCall({
      call,
      waitingSince: RESOLVED,
      now: new Date(RESOLVED.getTime() + waited),
    });
  }

  test("a transcript OneUptime AI is reading: until the reading is done", () => {
    const reading: PostmortemCallState = {
      hasTranscript: true,
      callSummaryStatus: CallSummaryStatus.Pending,
      callSummaryUpdatedAt: RESOLVED,
    };

    expect(waits(reading, MINUTE)).toBe(true);
    expect(waits(reading, CALL_SUMMARY_STALE_AFTER_MS)).toBe(true);
  });

  test("a reading that stalled is not waited on", () => {
    expect(
      waits(
        {
          hasTranscript: true,
          callSummaryStatus: CallSummaryStatus.Pending,
          callSummaryUpdatedAt: RESOLVED,
        },
        CALL_SUMMARY_STALE_AFTER_MS + 1,
      ),
    ).toBe(false);
  });

  test.each([
    [CallSummaryStatus.Ready],
    [CallSummaryStatus.Failed],
    [CallSummaryStatus.Skipped],
    [null],
  ])(
    "a transcript whose reading is %p holds nothing back",
    (status: CallSummaryStatus | null) => {
      expect(
        waits(
          {
            hasTranscript: true,
            callSummaryStatus: status,
            callSummaryUpdatedAt: RESOLVED,
            // Whatever the job last said, the transcript is in.
            transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
            transcriptFetchReason:
              VideoCallTranscriptUnavailableReason.NotReady,
          },
          MINUTE,
        ),
      ).toBe(false);
    },
  );

  test("a transcript the provider is preparing: up to six hours", () => {
    const preparing: PostmortemCallState = {
      hasTranscript: false,
      transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
      transcriptFetchReason: VideoCallTranscriptUnavailableReason.NotReady,
    };

    expect(POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS).toBe(6 * HOUR);
    expect(waits(preparing, 0)).toBe(true);
    expect(waits(preparing, 5 * HOUR)).toBe(true);
    expect(waits(preparing, 6 * HOUR - 1)).toBe(true);
    expect(waits(preparing, 6 * HOUR)).toBe(false);
  });

  test.each([
    ["not asked yet", null],
    [
      "nothing recorded yet",
      VideoCallTranscriptUnavailableReason.NotTranscribed,
    ],
    ["no meeting yet", VideoCallTranscriptUnavailableReason.NoMeeting],
  ])(
    "no sign of a transcript (%s): up to an hour",
    (_name: string, reason: VideoCallTranscriptUnavailableReason | null) => {
      const unseen: PostmortemCallState = {
        hasTranscript: false,
        transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
        transcriptFetchReason: reason,
      };

      expect(POSTMORTEM_WAITS_FOR_UNSEEN_TRANSCRIPT_MS).toBe(HOUR);
      expect(waits(unseen, 59 * MINUTE)).toBe(true);
      expect(waits(unseen, HOUR)).toBe(false);
    },
  );

  test.each([
    ["stopped", CallTranscriptFetchStatus.Stopped],
    ["never watched", null],
    ["an unknown status", "Paused"],
  ])(
    "a call OneUptime no longer asks about (%s) holds nothing back",
    (_name: string, status: string | null) => {
      expect(
        waits(
          {
            hasTranscript: false,
            transcriptFetchStatus: status,
            transcriptFetchReason:
              VideoCallTranscriptUnavailableReason.NotReady,
          },
          0,
        ),
      ).toBe(false);
    },
  );

  test("a draft waits while any one of the incident's calls is still expected", () => {
    const done: PostmortemCallState = {
      hasTranscript: true,
      callSummaryStatus: CallSummaryStatus.Ready,
    };
    const preparing: PostmortemCallState = {
      hasTranscript: false,
      transcriptFetchStatus: CallTranscriptFetchStatus.Waiting,
      transcriptFetchReason: VideoCallTranscriptUnavailableReason.NotReady,
    };

    expect(
      isPostmortemWaitingForCalls({
        calls: [done, preparing],
        waitingSince: RESOLVED,
        now: at(3 * HOUR),
      }),
    ).toBe(true);
    expect(
      isPostmortemWaitingForCalls({
        calls: [done],
        waitingSince: RESOLVED,
        now: at(3 * HOUR),
      }),
    ).toBe(false);
    expect(
      isPostmortemWaitingForCalls({
        calls: [],
        waitingSince: RESOLVED,
        now: RESOLVED,
      }),
    ).toBe(false);
  });
});
