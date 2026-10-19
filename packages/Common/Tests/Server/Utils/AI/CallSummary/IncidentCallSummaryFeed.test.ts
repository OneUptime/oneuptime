import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../../../Models/DatabaseModels/IncidentFeed";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentCallSummaryFeed, {
  CALL_SUMMARY_FEED_SECTIONS,
} from "../../../../../Server/Utils/AI/CallSummary/IncidentCallSummaryFeed";
import logger from "../../../../../Server/Utils/Logger";
import { Indigo500 } from "../../../../../Types/BrandColors";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CallSummary,
  CallSummaryBasis,
  CallSummaryFindingKind,
  CallSummaryRootCauseOutcome,
} from "../../../../../Types/VideoCall/CallSummary";
import TranscriptText from "../../../../../Utils/VideoCall/TranscriptText";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * What OneUptime AI read in a call, in the incident's feed and from there in
 * its Slack and Microsoft Teams channels. The summary is the feed item's own
 * text (the channels get no more than that), in the AI Investigation card's
 * words for its parts, with the cause marked as a suggestion. Every sentence
 * in it is somebody else's - the model's, or a participant named as an
 * owner - so the tests feed it the hostile ones too.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const CITATION: { line: number; text: string } = {
  line: 3,
  text: "The pool maxes at 50 and the deploy went to 100 workers.",
};

function summary(overrides: Partial<CallSummary> = {}): CallSummary {
  return {
    version: 1,
    runId: "run-1",
    generatedAt: "2026-10-19T11:00:00.000Z",
    rootCause: {
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary: "The deploy doubled the workers and exhausted `DB_POOL_MAX`.",
      basis: CallSummaryBasis.StatedOnCall,
      citations: [CITATION],
    },
    findings: [
      {
        kind: CallSummaryFindingKind.Confirmed,
        text: "The DB pool was at 100%.",
        citations: [CITATION],
      },
      {
        kind: CallSummaryFindingKind.Hypothesis,
        text: "A retry storm may have made it worse.",
        citations: [],
      },
    ],
    stepsTried: [{ text: "Restarted two API pods.", citations: [CITATION] }],
    decisions: [{ text: "Roll the deploy back.", citations: [CITATION] }],
    actions: [
      {
        text: "Raise the pool limit.",
        owner: "Sam Lee",
        citations: [CITATION],
      },
      { text: "Add a pool saturation alert.", citations: [] },
    ],
    openQuestions: [{ text: "Why did the canary pass?", citations: [] }],
    linesRead: 120,
    partsRead: 1,
    ...overrides,
  };
}

describe("IncidentCallSummaryFeed.getFeedMarkdown", () => {
  test("who read what, the suggested cause marked as one, then each part with something in it", () => {
    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      callLabel: "Zoom meeting",
      summary: summary(),
      details: "42 minutes, 5 speakers, 120 remarks",
    }).toString();

    expect(markdown).toBe(
      [
        "✨ OneUptime AI read the transcript of the **Zoom meeting** (42 minutes, 5 speakers, 120 remarks).",
        "",
        "**Suggested root cause** (not confirmed): The deploy doubled the workers and exhausted `DB_POOL_MAX`.",
        "",
        "Stated on the call. Use it as the incident's root cause, or dismiss it, on the incident's page.",
        "",
        "**Confirmed on the call**",
        "- The DB pool was at 100%.",
        "",
        "**Hypotheses**",
        "- A retry storm may have made it worse.",
        "",
        "**What was tried**",
        "- Restarted two API pods.",
        "",
        "**Decisions**",
        "- Roll the deploy back.",
        "",
        "**Follow-ups**",
        "- Raise the pool limit. (Sam Lee)",
        "- Add a pool saturation alert.",
        "",
        "**Open questions**",
        "- Why did the canary pass?",
      ].join("\n"),
    );
  });

  test("names its parts as the AI Investigation card does", () => {
    expect(CALL_SUMMARY_FEED_SECTIONS).toEqual({
      confirmed: "Confirmed on the call",
      hypotheses: "Hypotheses",
      stepsTried: "What was tried",
      decisions: "Decisions",
      actions: "Follow-ups",
      openQuestions: "Open questions",
    });
  });

  test("an inferred cause says it was inferred", () => {
    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      callLabel: "Zoom meeting",
      summary: summary({
        rootCause: {
          outcome: CallSummaryRootCauseOutcome.Suggested,
          summary: "The deploy exhausted the pool.",
          basis: CallSummaryBasis.Inferred,
          citations: [CITATION],
        },
      }),
    }).toString();

    expect(markdown).toContain(
      "Inferred from the discussion. Use it as the incident's root cause, or dismiss it, on the incident's page.",
    );
  });

  test("a call that did not settle the cause says so, and offers nothing to use", () => {
    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      callLabel: "Google Meet",
      summary: summary({
        rootCause: {
          outcome: CallSummaryRootCauseOutcome.NotEnoughDiscussion,
          citations: [],
        },
      }),
    }).toString();

    expect(markdown).toContain(
      "**Root cause:** not enough was said on the call to suggest one.",
    );
    expect(markdown).not.toContain("Suggested root cause");
    expect(markdown).not.toContain("Use it as the incident's root cause");
  });

  test("leaves out the parts the call said nothing about, and the details when there are none", () => {
    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      callLabel: "War room",
      summary: summary({
        findings: [],
        stepsTried: [],
        decisions: [],
        actions: [],
        openQuestions: [],
      }),
    }).toString();

    expect(markdown).toBe(
      [
        "✨ OneUptime AI read the transcript of the **War room**.",
        "",
        "**Suggested root cause** (not confirmed): The deploy doubled the workers and exhausted `DB_POOL_MAX`.",
        "",
        "Stated on the call. Use it as the incident's root cause, or dismiss it, on the incident's page.",
      ].join("\n"),
    );
  });

  test("only confirmed findings go under Confirmed on the call; everything else is a hypothesis", () => {
    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      callLabel: "Zoom meeting",
      summary: summary({
        findings: [
          {
            kind: CallSummaryFindingKind.Hypothesis,
            text: "Maybe DNS.",
            citations: [],
          },
        ],
      }),
    }).toString();

    expect(markdown).not.toContain("**Confirmed on the call**");
    expect(markdown).toContain("**Hypotheses**\n- Maybe DNS.");
  });

  test("somebody's text stays text: no link, image, tag, mention or markup comes alive", () => {
    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      callLabel: "[Join](https://evil.example.com) <!channel>",
      summary: summary({
        rootCause: {
          outcome: CallSummaryRootCauseOutcome.Suggested,
          summary:
            "Click [here](https://evil.example.com) ![x](https://evil.example.com/x.png) <img src=x onerror=alert(1)> <!here> **bold** _it_",
          basis: CallSummaryBasis.StatedOnCall,
          citations: [CITATION],
        },
        findings: [
          {
            kind: CallSummaryFindingKind.Confirmed,
            text: "# not a heading <script>alert(1)</script>",
            citations: [CITATION],
          },
        ],
        actions: [
          {
            text: "Page <@U123> now",
            owner: "[Sam](https://evil.example.com)",
            citations: [],
          },
        ],
        stepsTried: [],
        decisions: [],
        openQuestions: [],
      }),
    }).toString();

    // Each value is escaped where it sits; a mention gets an invisible break.
    const joiner: string = "⁠";

    expect(markdown).toBe(
      [
        `✨ OneUptime AI read the transcript of the **\\[Join\\](https://evil.example.com) \\<${joiner}!channel>**.`,
        "",
        `**Suggested root cause** (not confirmed): Click \\[here\\](https://evil.example.com) !\\[x\\](https://evil.example.com/x.png) \\<img src=x onerror=alert(1)> \\<${joiner}!here> \\*\\*bold\\*\\* \\_it\\_`,
        "",
        "Stated on the call. Use it as the incident's root cause, or dismiss it, on the incident's page.",
        "",
        "**Confirmed on the call**",
        "- \\# not a heading \\<script>alert(1)\\</script>",
        "",
        "**Follow-ups**",
        `- Page \\<${joiner}@U123> now (\\[Sam\\](https://evil.example.com))`,
      ].join("\n"),
    );

    // No link or image whose bracket is not escaped, and no tag that opens.
    expect(markdown).not.toMatch(/(?<!\\)\[[^\]\n]*(?<!\\)\]\(/);
    expect(markdown).not.toMatch(/(?<!\\)<[A-Za-z!@/]/);
    // Chat mentions cannot reach anyone.
    expect(markdown).not.toMatch(/<[!@]/);
  });

  test("an identifier the model wrote in backticks stays code", () => {
    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      callLabel: "Zoom meeting",
      summary: summary(),
    }).toString();

    expect(markdown).toContain("`DB_POOL_MAX`");
  });
});

describe("IncidentCallSummaryFeed.post", () => {
  let feed: SpyInstance<typeof IncidentFeedService.createIncidentFeedItem>;

  beforeEach(() => {
    feed = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function call(): IncidentVideoCall {
    const model: IncidentVideoCall = new IncidentVideoCall();
    model.projectId = PROJECT;
    model.incidentId = INCIDENT;
    model.transcriptInfo = TranscriptText.getInfo([
      { offsetInSeconds: 0, speaker: "Priya Shah", text: "Hi." },
      { offsetInSeconds: 2520, speaker: "Sam Lee", text: "Bye." },
    ]) as unknown as JSONObject;
    return model;
  }

  test("goes to the incident's feed and from there to its channels, as OneUptime AI's", async () => {
    await IncidentCallSummaryFeed.post({
      call: call(),
      callLabel: "Zoom meeting",
      summary: summary(),
    });

    expect(feed).toHaveBeenCalledTimes(1);

    const item: JSONObject = feed.mock.calls[0]![0] as unknown as JSONObject;

    expect(item["incidentId"]).toBe(INCIDENT);
    expect(item["projectId"]).toBe(PROJECT);
    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallSummary,
    );
    expect(item["displayColor"]).toBe(Indigo500);
    expect(item["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
    });
    // OneUptime AI's, not a person's.
    expect(item).not.toHaveProperty("userId");
    expect(item["feedInfoInMarkdown"]).toBe(
      IncidentCallSummaryFeed.getFeedMarkdown({
        callLabel: "Zoom meeting",
        summary: summary(),
        details: TranscriptText.describeInfo(
          TranscriptText.readInfo(call().transcriptInfo)!,
        ),
      }).toString(),
    );
    expect(item["feedInfoInMarkdown"]).toContain("(42 minutes");
  });

  test("never throws: the reading is stored, and the card shows it, either way", async () => {
    feed.mockRejectedValue(new Error("database unavailable"));
    const errorLog: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await expect(
      IncidentCallSummaryFeed.post({
        call: call(),
        callLabel: "Zoom meeting",
        summary: summary(),
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not post what OneUptime AI read"),
      expect.objectContaining({ incidentId: INCIDENT.toString() }),
    );
  });
});
