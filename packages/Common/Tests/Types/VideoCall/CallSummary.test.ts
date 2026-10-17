import { describe, expect, test } from "@jest/globals";
import {
  CALL_SUMMARY_STALE_AFTER_MS,
  CallSummary,
  CallSummaryBasis,
  CallSummaryFindingKind,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
  MAX_CALL_SUMMARY_CITATIONS,
  MAX_CALL_SUMMARY_POINT_LENGTH,
  MAX_CALL_SUMMARY_POINTS,
  RootCauseSuggestionStatus,
  getCallSummaryPointCount,
  isCallSummaryStale,
  isCallSummaryStatus,
  isRootCauseSuggestionStatus,
  readCallSummary,
} from "../../../Types/VideoCall/CallSummary";
import { JSONObject } from "../../../Types/JSON";
import VideoCallProvider, {
  getVideoCallLabel,
} from "../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptSource,
  canReadVideoCallTranscriptFromProvider,
  isVideoCallTranscriptSource,
} from "../../../Types/VideoCall/VideoCallTranscript";

/*
 * What OneUptime AI read in a call's transcript is stored on the call as
 * JSON and read back by the dashboard. The reader keeps only what is well
 * formed, and holds the summary to its promises: a suggested cause has
 * words and at least one transcript line under it, and a finding called
 * confirmed has a line too - anything less is the call not having said
 * enough, or a hypothesis.
 */

const CITATION: JSONObject = {
  line: 12,
  time: "00:12:03",
  speaker: "Priya Shah",
  text: "The pool maxes at 50 and we just went to 100 workers.",
};

function storedSummary(overrides: JSONObject = {}): JSONObject {
  return {
    version: 1,
    runId: "run-1",
    generatedAt: "2026-10-17T15:00:00.000Z",
    rootCause: {
      outcome: "Suggested",
      summary: "The deploy doubled the workers and exhausted the pool.",
      basis: "StatedOnCall",
      citations: [CITATION],
    },
    findings: [
      {
        text: "The pool was at 100%.",
        kind: "Confirmed",
        citations: [CITATION],
      },
      { text: "Maybe the cache too.", kind: "Hypothesis", citations: [] },
    ],
    stepsTried: [{ text: "Restarted the pods.", citations: [] }],
    decisions: [
      { text: "Roll back the worker change.", citations: [CITATION] },
    ],
    actions: [
      {
        text: "Add a pool size alert.",
        owner: "Sam Lee",
        citations: [CITATION],
      },
    ],
    openQuestions: [{ text: "Why did staging not catch it?", citations: [] }],
    linesRead: 312,
    partsRead: 1,
    ...overrides,
  };
}

describe("readCallSummary", () => {
  test("reads a summary as the server stores it", () => {
    const summary: CallSummary | null = readCallSummary(storedSummary());

    expect(summary).not.toBeNull();
    expect(summary!.rootCause).toEqual({
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary: "The deploy doubled the workers and exhausted the pool.",
      basis: CallSummaryBasis.StatedOnCall,
      citations: [CITATION],
    });
    expect(
      summary!.findings.map((finding: { kind: CallSummaryFindingKind }) => {
        return finding.kind;
      }),
    ).toEqual([
      CallSummaryFindingKind.Confirmed,
      CallSummaryFindingKind.Hypothesis,
    ]);
    expect(summary!.actions[0]!.owner).toBe("Sam Lee");
    expect(summary!.linesRead).toBe(312);
    expect(summary!.partsRead).toBe(1);
    expect(getCallSummaryPointCount(summary!)).toBe(6);
  });

  test("a suggested cause with no line under it is the call not saying enough", () => {
    const summary: CallSummary | null = readCallSummary(
      storedSummary({
        rootCause: {
          outcome: "Suggested",
          summary: "The DNS provider, probably.",
          basis: "Inferred",
          citations: [],
        },
      }),
    );

    expect(summary!.rootCause).toEqual({
      outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
      citations: [],
    });
  });

  test("a suggested cause with no words is the call not saying enough", () => {
    expect(
      readCallSummary(
        storedSummary({
          rootCause: {
            outcome: "Suggested",
            summary: "  ",
            citations: [CITATION],
          },
        }),
      )!.rootCause.outcome,
    ).toBe(CallSummaryRootCauseOutcome.NotEnoughDiscussion);
  });

  test("a finding called confirmed with no line under it is a hypothesis", () => {
    const summary: CallSummary | null = readCallSummary(
      storedSummary({
        findings: [
          { text: "We checked the logs.", kind: "Confirmed", citations: [] },
        ],
      }),
    );

    expect(summary!.findings[0]!.kind).toBe(CallSummaryFindingKind.Hypothesis);
  });

  test("an unknown basis is read as AI's own inference, never as stated on the call", () => {
    expect(
      readCallSummary(
        storedSummary({
          rootCause: {
            outcome: "Suggested",
            summary: "The pool.",
            basis: "Certain",
            citations: [CITATION],
          },
        }),
      )!.rootCause.basis,
    ).toBe(CallSummaryBasis.Inferred);
  });

  test("malformed citations and points are left out, the rest kept", () => {
    const summary: CallSummary | null = readCallSummary(
      storedSummary({
        decisions: [
          "not an object",
          { text: "" },
          {
            text: "Keep this one.",
            citations: [
              { line: 0, text: "x" },
              { line: 2.5, text: "y" },
              { line: 3 },
              { line: 4, text: "kept" },
            ],
          },
        ],
      }),
    );

    expect(summary!.decisions).toEqual([
      { text: "Keep this one.", citations: [{ line: 4, text: "kept" }] },
    ]);
  });

  test("lists, citations and words are held to their limits", () => {
    const manyCitations: Array<JSONObject> = Array.from(
      { length: 9 },
      (_: unknown, index: number) => {
        return { line: index + 1, text: `line ${index + 1}` };
      },
    );
    const summary: CallSummary | null = readCallSummary(
      storedSummary({
        stepsTried: Array.from({ length: 30 }, (_: unknown, index: number) => {
          return { text: `step ${index}`, citations: manyCitations };
        }),
        openQuestions: [{ text: "q".repeat(5_000), citations: [] }],
      }),
    );

    expect(summary!.stepsTried).toHaveLength(MAX_CALL_SUMMARY_POINTS);
    expect(summary!.stepsTried[0]!.citations).toHaveLength(
      MAX_CALL_SUMMARY_CITATIONS,
    );
    expect(summary!.openQuestions[0]!.text.length).toBe(
      MAX_CALL_SUMMARY_POINT_LENGTH,
    );
    expect(summary!.openQuestions[0]!.text.endsWith("…")).toBe(true);
  });

  test("a value with no cause at all - a reading still running - is no summary", () => {
    expect(readCallSummary({ runId: "run-1" })).toBeNull();
    expect(readCallSummary(null)).toBeNull();
    expect(readCallSummary("text")).toBeNull();
    expect(readCallSummary([storedSummary()])).toBeNull();
  });
});

describe("isCallSummaryStale", () => {
  const now: Date = new Date("2026-10-17T15:00:00.000Z");

  test("only a reading still pending past its time is stale", () => {
    const fresh: Date = new Date(
      now.getTime() - CALL_SUMMARY_STALE_AFTER_MS + 1_000,
    );
    const old: Date = new Date(
      now.getTime() - CALL_SUMMARY_STALE_AFTER_MS - 1_000,
    );

    expect(
      isCallSummaryStale({
        status: CallSummaryStatus.Pending,
        updatedAt: fresh,
        now,
      }),
    ).toBe(false);
    expect(
      isCallSummaryStale({
        status: CallSummaryStatus.Pending,
        updatedAt: old,
        now,
      }),
    ).toBe(true);
    expect(
      isCallSummaryStale({
        status: CallSummaryStatus.Pending,
        updatedAt: old.toISOString(),
        now,
      }),
    ).toBe(true);
    expect(
      isCallSummaryStale({
        status: CallSummaryStatus.Ready,
        updatedAt: old,
        now,
      }),
    ).toBe(false);
    expect(
      isCallSummaryStale({
        status: CallSummaryStatus.Failed,
        updatedAt: old,
        now,
      }),
    ).toBe(false);
  });

  test("a pending reading with no time, or an unreadable one, is stale", () => {
    expect(
      isCallSummaryStale({
        status: CallSummaryStatus.Pending,
        updatedAt: null,
        now,
      }),
    ).toBe(true);
    expect(
      isCallSummaryStale({
        status: CallSummaryStatus.Pending,
        updatedAt: "not a date",
        now,
      }),
    ).toBe(true);
  });
});

describe("the call's transcript and summary values", () => {
  test("statuses are recognised by value", () => {
    expect(isCallSummaryStatus("Pending")).toBe(true);
    expect(isCallSummaryStatus("Done")).toBe(false);
    expect(
      isRootCauseSuggestionStatus(RootCauseSuggestionStatus.Dismissed),
    ).toBe(true);
    expect(isRootCauseSuggestionStatus("Rejected")).toBe(false);
    expect(isVideoCallTranscriptSource(VideoCallTranscriptSource.Upload)).toBe(
      true,
    );
    expect(isVideoCallTranscriptSource("File")).toBe(false);
  });

  /*
   * Microsoft Graph has no transcripts for meetings created the way
   * OneUptime creates them, Slack has no API for a huddle's, and a link of
   * one's own is a meeting OneUptime knows nothing about.
   */
  test("only a Zoom or Google Meet meeting OneUptime created can be read from its provider", () => {
    const connection: string = "3a4b5c6d-7e8f-4a0b-8c2d-3e4f5a6b7c8d";

    expect(
      canReadVideoCallTranscriptFromProvider({
        provider: VideoCallProvider.Zoom,
        videoCallConnectionId: connection,
        externalMeetingId: "85746065432",
      }),
    ).toBe(true);
    expect(
      canReadVideoCallTranscriptFromProvider({
        provider: VideoCallProvider.GoogleMeet,
        videoCallConnectionId: connection,
        externalMeetingId: "spaces/abc",
      }),
    ).toBe(true);

    for (const provider of [
      VideoCallProvider.MicrosoftTeams,
      VideoCallProvider.SlackHuddle,
      VideoCallProvider.CustomLink,
    ]) {
      expect(
        canReadVideoCallTranscriptFromProvider({
          provider,
          videoCallConnectionId: connection,
          externalMeetingId: "x",
        }),
      ).toBe(false);
    }

    // A pasted Zoom link: no connection started it, and no meeting id is known.
    expect(
      canReadVideoCallTranscriptFromProvider({
        provider: VideoCallProvider.Zoom,
        externalMeetingId: "85746065432",
      }),
    ).toBe(false);
    expect(
      canReadVideoCallTranscriptFromProvider({
        provider: VideoCallProvider.Zoom,
        videoCallConnectionId: connection,
      }),
    ).toBe(false);
  });

  test("a call is called by its provider, or a link by its own name", () => {
    expect(
      getVideoCallLabel({ provider: VideoCallProvider.Zoom, title: "INC-1" }),
    ).toBe("Zoom meeting");
    expect(getVideoCallLabel({ provider: VideoCallProvider.GoogleMeet })).toBe(
      "Google Meet call",
    );
    expect(
      getVideoCallLabel({
        provider: VideoCallProvider.CustomLink,
        title: " War room ",
      }),
    ).toBe("War room");
    expect(
      getVideoCallLabel({
        provider: VideoCallProvider.CustomLink,
        connectionName: "Standing bridge",
      }),
    ).toBe("Standing bridge");
    expect(getVideoCallLabel({ provider: VideoCallProvider.CustomLink })).toBe(
      "video call",
    );
  });
});
