import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import IncidentVideoCallService from "../../../../../Server/Services/IncidentVideoCallService";
import CallSummaryContext, {
  IncidentCallForPrompt,
  MAX_TRANSCRIPT_IN_POSTMORTEM_CHARACTERS,
} from "../../../../../Server/Utils/AI/CallSummary/CallSummaryContext";
import IncidentAIContextBuilder, {
  AIGenerationContext,
  IncidentContextData,
} from "../../../../../Server/Utils/AI/IncidentAIContextBuilder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CallSummary,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
  readCallSummary,
} from "../../../../../Types/VideoCall/CallSummary";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import TranscriptText, {
  TranscriptLine,
} from "../../../../../Utils/VideoCall/TranscriptText";
import {
  afterEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The postmortem OneUptime AI drafts reads the incident's calls: for each,
 * what OneUptime AI read in its transcript, the cause marked for what it is
 * - a hypothesis until a responder used it, ignored once dismissed - or,
 * with nothing read, the transcript itself, held to a length.
 */

const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const SUMMARY: JSONObject = {
  version: 1,
  runId: "run-1",
  generatedAt: "2026-10-17T15:00:00.000Z",
  rootCause: {
    outcome: "Suggested",
    summary: "The deploy doubled the workers and exhausted the DB pool.",
    basis: "StatedOnCall",
    citations: [
      { line: 3, time: "00:12:03", speaker: "Priya Shah", text: "The pool maxes at 50." },
    ],
  },
  findings: [
    { text: "The pool was at 100%.", kind: "Confirmed", citations: [{ line: 2, text: "Pool at 100%." }] },
    { text: "The cache may have been cold.", kind: "Hypothesis", citations: [] },
  ],
  stepsTried: [{ text: "Restarted the pods.", citations: [] }],
  decisions: [{ text: "Roll back the worker change.", citations: [] }],
  actions: [{ text: "Alert on pool usage.", owner: "Sam Lee", citations: [] }],
  openQuestions: [{ text: "Why did staging not catch it?", citations: [] }],
  linesRead: 3,
  partsRead: 1,
};

function callFor(data: {
  status?: RootCauseSuggestionStatus;
  summary?: CallSummary | null;
  lines?: Array<TranscriptLine>;
}): IncidentCallForPrompt {
  const forPrompt: IncidentCallForPrompt = {
    callLabel: "Zoom meeting",
    details: "52 minutes, 6 speakers, 312 remarks",
    summary: data.summary === undefined ? readCallSummary(SUMMARY) : data.summary,
    suggestionStatus: data.status,
  };

  if (data.lines) {
    forPrompt.transcriptLines = data.lines;
  }

  return forPrompt;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CallSummaryContext.formatForPrompt", () => {
  test("no calls, no section", () => {
    expect(CallSummaryContext.formatForPrompt([])).toBe("");
  });

  test("a suggested cause no responder used is a hypothesis", () => {
    const text: string = CallSummaryContext.formatForPrompt([
      callFor({ status: RootCauseSuggestionStatus.Suggested }),
    ]);

    expect(text).toContain("# Incident Calls");
    expect(text).toContain("## Zoom meeting (52 minutes, 6 speakers, 312 remarks)");
    expect(text).toContain(
      "- Root cause from the call (suggested by AI, not confirmed by a responder: a hypothesis; stated on the call): The deploy doubled the workers and exhausted the DB pool.",
    );
    expect(text).toContain("  - [00:12:03] Priya Shah: The pool maxes at 50.");
    expect(text).toContain("  - (confirmed on the call) The pool was at 100%.");
    expect(text).toContain("  - (hypothesis) The cache may have been cold.");
    expect(text).toContain("- Steps tried:\n  - Restarted the pods.");
    expect(text).toContain("- Decisions:\n  - Roll back the worker change.");
    expect(text).toContain("- Follow-up actions:\n  - Alert on pool usage. (owner: Sam Lee)");
    expect(text).toContain("- Open questions:\n  - Why did staging not catch it?");
  });

  test("a cause a responder used is said to be theirs; a dismissed one is not to be presented", () => {
    expect(
      CallSummaryContext.formatForPrompt([
        callFor({ status: RootCauseSuggestionStatus.Accepted }),
      ]),
    ).toContain("(used as the root cause by a responder; stated on the call)");

    expect(
      CallSummaryContext.formatForPrompt([
        callFor({ status: RootCauseSuggestionStatus.Dismissed }),
      ]),
    ).toContain("dismissed by a responder: do not present it as the cause");
  });

  test("a call that did not discuss the cause says so", () => {
    const text: string = CallSummaryContext.formatForPrompt([
      callFor({
        summary: readCallSummary({
          ...SUMMARY,
          rootCause: { outcome: "NotEnoughDiscussion", citations: [] },
        }),
      }),
    ]);

    expect(text).toContain(
      "- Root cause: the call did not discuss what caused the incident enough to tell.",
    );
  });

  test("a transcript nothing read: the transcript itself, redacted, held to the channel's length", () => {
    const longLine: string = "word ".repeat(200).trim();
    const lines: Array<TranscriptLine> = Array.from({ length: 100 }, (_: unknown, index: number) => {
      return { offsetInSeconds: index * 30, speaker: "Sam Lee", text: `${index}: ${longLine}` };
    });
    lines.unshift({ speaker: "Sam Lee", text: "the header was Bearer abcdefghijklmnopqrstuvwxyz123456" });

    const text: string = CallSummaryContext.formatForPrompt([
      callFor({ summary: null, lines }),
    ]);

    expect(text).toContain("The call's transcript (OneUptime AI has not read it):");
    expect(text).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
    expect(text).toContain("[00:00:30] Sam Lee: 1: word");
    expect(text).toMatch(/lines are left out\.\)/);
    expect(text.length).toBeLessThan(MAX_TRANSCRIPT_IN_POSTMORTEM_CHARACTERS + 2_000);
  });

  test("the transcripts of several unread calls share the one budget", () => {
    const lines: Array<TranscriptLine> = Array.from({ length: 200 }, (_: unknown, index: number) => {
      return { text: `line ${index} ${"x".repeat(300)}` };
    });

    const text: string = CallSummaryContext.formatForPrompt([
      callFor({ summary: null, lines }),
      callFor({ summary: null, lines }),
    ]);

    expect(text).toContain("the calls above used the space for transcripts");
  });
});

describe("CallSummaryContext.readForIncident", () => {
  test("reads the incident's calls that have a transcript, as root, oldest first", async () => {
    const withSummary: IncidentVideoCall = new IncidentVideoCall();
    withSummary.provider = VideoCallProvider.Zoom;
    withSummary.transcript = TranscriptText.serialize([{ speaker: "A", text: "hello" }]);
    withSummary.transcriptInfo = { lineCount: 1, speakerCount: 1, characterCount: 5 };
    withSummary.callSummary = SUMMARY;
    withSummary.callSummaryStatus = CallSummaryStatus.Ready;
    withSummary.rootCauseSuggestionStatus = RootCauseSuggestionStatus.Accepted;

    const unread: IncidentVideoCall = new IncidentVideoCall();
    unread.provider = VideoCallProvider.CustomLink;
    unread.title = "War room";
    unread.transcript = TranscriptText.serialize([{ text: "unread words" }]);
    unread.callSummaryStatus = CallSummaryStatus.Skipped;

    const empty: IncidentVideoCall = new IncidentVideoCall();
    empty.provider = VideoCallProvider.Zoom;
    empty.transcript = "  ";

    const findBy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentVideoCallService, "findBy")
      .mockResolvedValue([withSummary, unread, empty]);

    const calls: Array<IncidentCallForPrompt> =
      await CallSummaryContext.readForIncident(INCIDENT);

    expect(findBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({ incidentId: INCIDENT }),
        props: { isRoot: true },
      }),
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]!.callLabel).toBe("Zoom meeting");
    expect(calls[0]!.details).toBe("1 speaker, 1 remark");
    expect(calls[0]!.summary).not.toBeNull();
    expect(calls[0]!.suggestionStatus).toBe(RootCauseSuggestionStatus.Accepted);
    expect(calls[0]!.transcriptLines).toBeUndefined();

    expect(calls[1]!.callLabel).toBe("War room");
    expect(calls[1]!.summary).toBeNull();
    expect(calls[1]!.transcriptLines).toEqual([{ text: "unread words" }]);
  });

  test("a draft goes ahead without its calls when they cannot be read", async () => {
    jest
      .spyOn(IncidentVideoCallService, "findBy")
      .mockRejectedValue(new Error("Database not connected"));

    expect(await CallSummaryContext.readForIncident(INCIDENT)).toEqual([]);
  });
});

describe("the postmortem draft reads the calls", () => {
  function contextWith(calls: Array<IncidentCallForPrompt> | undefined): IncidentContextData {
    const incident: Incident = new Incident();
    incident.title = "Checkout API is down";

    const data: IncidentContextData = {
      incident,
      stateTimeline: [],
      internalNotes: [],
      publicNotes: [],
      workspaceMessages: [],
    };

    if (calls) {
      data.calls = calls;
    }

    return data;
  }

  test("the calls go into the draft's incident data, and the prompt treats an unconfirmed cause as a hypothesis", () => {
    const context: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        contextWith([callFor({ status: RootCauseSuggestionStatus.Suggested })]),
      );

    expect(context.contextText).toContain("# Incident Calls");
    expect(context.contextText).toContain("not confirmed by a responder: a hypothesis");
    expect(context.systemPrompt).toContain(
      "A root cause marked as suggested by AI and not confirmed by a responder is a hypothesis",
    );
  });

  test("a template draft is told the same", () => {
    const context: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(
        contextWith([callFor({})]),
        "## Summary\n\n## Root cause",
      );

    expect(context.systemPrompt).toContain(
      "A root cause marked as suggested by AI and not confirmed by a responder is a hypothesis",
    );
    expect(context.contextText).toContain("# Incident Calls");
  });

  test("an incident with no calls has no calls section", () => {
    const context: AIGenerationContext =
      IncidentAIContextBuilder.formatIncidentContextForPostmortem(contextWith(undefined));

    expect(context.contextText).not.toContain("# Incident Calls");
  });
});
