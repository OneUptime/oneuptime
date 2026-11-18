import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../../../Models/DatabaseModels/IncidentFeed";
import IncidentFeedService, {
  IncidentFeedItemPosted,
} from "../../../../../Server/Services/IncidentFeedService";
import IncidentCallSummaryFeed from "../../../../../Server/Utils/AI/CallSummary/IncidentCallSummaryFeed";
import CallSummaryFeedMarkdown from "../../../../../Utils/VideoCall/CallSummaryFeedMarkdown";
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
import { CallSummaryPost } from "../../../../../Types/VideoCall/CallSummaryPosts";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
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
 * What OneUptime AI read in a call, posted to the incident's feed and from
 * there to its Slack and Microsoft Teams channels: OneUptime AI's item, with
 * the summary as its own text (CallSummaryFeedMarkdown, whose words are
 * tested on their own), and a post that fails never fails the reading.
 *
 * The post says where it went - the feed item and each channel message -
 * for the call to keep, so removing the transcript takes it back (#9290),
 * and names the account whose sign-in read the transcript, so that account
 * removing OneUptime takes it back too (#9289).
 */

const FEED_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

// Where the item went: the feed, and the incident's Slack channel.
function posted(): IncidentFeedItemPosted {
  return {
    feedId: FEED_ID,
    messages: [
      {
        workspaceType: WorkspaceType.Slack,
        channelId: "C0INC42",
        channelName: "inc-42",
        messageId: "1760713500.000100",
      },
    ],
  };
}

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

describe("IncidentCallSummaryFeed.post", () => {
  let feed: SpyInstance<typeof IncidentFeedService.postIncidentFeedItem>;

  beforeEach(() => {
    feed = jest
      .spyOn(IncidentFeedService, "postIncidentFeedItem")
      .mockResolvedValue(posted());
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
      CallSummaryFeedMarkdown.getFeedMarkdown({
        callLabel: "Zoom meeting",
        summary: summary(),
        details: TranscriptText.describeInfo(
          TranscriptText.readInfo(call().transcriptInfo)!,
        ),
      }).toString(),
    );
    expect(item["feedInfoInMarkdown"]).toContain("(42 minutes");
  });

  test("says where it went: the feed item and each channel message, when it was posted", async () => {
    const post: CallSummaryPost = await IncidentCallSummaryFeed.post({
      call: call(),
      callLabel: "Zoom meeting",
      summary: summary(),
    });

    expect(post).toEqual({
      feedId: FEED_ID.toString(),
      postedAt: expect.any(String),
      messages: posted().messages,
    });
    expect(Number.isNaN(Date.parse(post.postedAt))).toBe(false);
    // Read through nobody's sign-in: it names no account.
    expect(post).not.toHaveProperty("signInAccountId");
  });

  test("names the account whose sign-in read the transcript, so that account removing OneUptime takes it back", async () => {
    const post: CallSummaryPost = await IncidentCallSummaryFeed.post({
      call: call(),
      callLabel: "Zoom meeting",
      summary: summary(),
      signInAccountId: "KdYKjnimT4KPd8FFgQt9FQ",
    });

    expect(post.signInAccountId).toBe("KdYKjnimT4KPd8FFgQt9FQ");
    // The feed item itself names nobody.
    expect(
      feed.mock.calls[0]![0] as unknown as JSONObject,
    ).not.toHaveProperty("signInAccountId");
  });

  test("an item that could not be created is said as a post with nothing to take back", async () => {
    feed.mockResolvedValue(null);

    const post: CallSummaryPost = await IncidentCallSummaryFeed.post({
      call: call(),
      callLabel: "Zoom meeting",
      summary: summary(),
    });

    expect(post.feedId).toBeUndefined();
    expect(post.messages).toEqual([]);
  });

  test("its text is the same for the same reading: how a reading posted before posts were kept is found again", () => {
    const first: string = IncidentCallSummaryFeed.getFeedMarkdown({
      call: call(),
      callLabel: "Zoom meeting",
      summary: summary(),
    });

    expect(
      IncidentCallSummaryFeed.getFeedMarkdown({
        call: call(),
        callLabel: "Zoom meeting",
        summary: summary(),
      }),
    ).toBe(first);
    expect(
      IncidentCallSummaryFeed.getFeedMarkdown({
        call: call(),
        callLabel: "Google Meet call",
        summary: summary(),
      }),
    ).not.toBe(first);
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
    ).resolves.toEqual({ postedAt: expect.any(String), messages: [] });
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not post what OneUptime AI read"),
      expect.objectContaining({ incidentId: INCIDENT.toString() }),
    );
  });
});
