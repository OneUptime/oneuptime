import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../../../Models/DatabaseModels/IncidentFeed";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentVideoCallService from "../../../../../Server/Services/IncidentVideoCallService";
import IncidentCallSummary, {
  CallSummaryStart,
} from "../../../../../Server/Utils/AI/CallSummary/IncidentCallSummary";
import logger from "../../../../../Server/Utils/Logger";
import IncidentCallTranscriptSave from "../../../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptSave";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { CallSummaryStatus } from "../../../../../Types/VideoCall/CallSummary";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptSource } from "../../../../../Types/VideoCall/VideoCallTranscript";
import {
  FeedEntryLead,
  getFeedEntryText,
} from "../../../../../UI/Components/Feed/FeedEntryText";
import TranscriptText, {
  PreparedTranscript,
} from "../../../../../Utils/VideoCall/TranscriptText";
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
 * The one way a transcript reaches an incident's call - added or got by a
 * person, or got by OneUptime itself once the call is over: it replaces
 * what the call had, ends any waiting for one, has OneUptime AI read it, and
 * says so in the incident's feed, in words that say who did it.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CALL: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const PREPARED: PreparedTranscript = TranscriptText.prepareLines({
  lines: [
    { offsetInSeconds: 5, speaker: "Priya Shah", text: "Checkout is down." },
    { offsetInSeconds: 723, speaker: "Sam Lee", text: "The pool maxes at 50." },
  ],
});

function call(provider: VideoCallProvider): IncidentVideoCall {
  const model: IncidentVideoCall = new IncidentVideoCall();
  model.id = CALL;
  model.projectId = PROJECT;
  model.incidentId = INCIDENT;
  model.provider = provider;
  return model;
}

let writes: Array<JSONObject>;
let start: SpyInstance<typeof IncidentCallSummary.start>;
let feed: SpyInstance<typeof IncidentFeedService.createIncidentFeedItem>;

beforeEach(() => {
  writes = [];

  jest
    .spyOn(IncidentVideoCallService, "updateOneById")
    .mockImplementation(async (data: { data: unknown }): Promise<number> => {
      writes.push(data.data as JSONObject);
      return 1;
    });
  start = jest
    .spyOn(IncidentCallSummary, "start")
    .mockResolvedValue({ status: CallSummaryStatus.Pending, runId: "run-1" });
  feed = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentCallTranscriptSave.save", () => {
  test("stores the transcript, clears what was read and any waiting, then has OneUptime AI read it", async () => {
    const started: CallSummaryStart = await IncidentCallTranscriptSave.save({
      call: call(VideoCallProvider.Zoom),
      prepared: PREPARED,
      source: VideoCallTranscriptSource.Provider,
      userId: USER,
    });

    expect(writes).toHaveLength(1);

    const written: JSONObject = writes[0]!;

    expect(written["transcript"]).toBe(PREPARED.stored);
    expect(written["transcriptSource"]).toBe(
      VideoCallTranscriptSource.Provider,
    );
    expect(written["transcriptInfo"]).toEqual(PREPARED.info);
    expect(written["transcriptAddedAt"]).toBeInstanceOf(Date);
    expect(written["transcriptAddedByUserId"]).toEqual(USER);
    // Nothing read in it yet, nothing to review.
    expect(written["callSummary"]).toBeNull();
    expect(written["callSummaryStatus"]).toBeNull();
    expect(written["rootCauseSuggestionStatus"]).toBeNull();
    // OneUptime no longer waits for one.
    expect(written["transcriptFetchStatus"]).toBeNull();
    expect(written["transcriptFetchReason"]).toBeNull();
    expect(written["transcriptFetchNextAttemptAt"]).toBeNull();

    expect(start).toHaveBeenCalledWith({ callId: CALL, userId: USER });
    expect(started).toEqual({
      status: CallSummaryStatus.Pending,
      runId: "run-1",
    });
  });

  test("writes the transcript before it is read", async () => {
    const order: Array<string> = [];

    jest
      .spyOn(IncidentVideoCallService, "updateOneById")
      .mockImplementation(async (): Promise<number> => {
        order.push("write");
        return 1;
      });
    start.mockImplementation(async (): Promise<CallSummaryStart> => {
      order.push("read");
      return { status: CallSummaryStatus.Pending, runId: "run-1" };
    });
    feed.mockImplementation(async (): Promise<void> => {
      order.push("feed");
    });

    await IncidentCallTranscriptSave.save({
      call: call(VideoCallProvider.Zoom),
      prepared: PREPARED,
      source: VideoCallTranscriptSource.Upload,
    });

    expect(order).toEqual(["write", "read", "feed"]);
  });

  test("a person's transcript is recorded in the feed with them, in the dashboard only", async () => {
    await IncidentCallTranscriptSave.save({
      call: call(VideoCallProvider.Zoom),
      prepared: PREPARED,
      source: VideoCallTranscriptSource.Provider,
      userId: USER,
    });

    const item: JSONObject = feed.mock.calls[0]![0] as unknown as JSONObject;

    expect(item["incidentId"]).toBe(INCIDENT);
    expect(item["projectId"]).toBe(PROJECT);
    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallTranscriptAdded,
    );
    expect(item["userId"]).toBe(USER);
    expect(item["feedInfoInMarkdown"]).toMatch(
      /^📝 added the call's transcript from \*\*Zoom\*\*: /,
    );
    expect(item).not.toHaveProperty("workspaceNotification");
  });

  test("one OneUptime got by itself says OneUptime got it, with nobody's name on it", async () => {
    await IncidentCallTranscriptSave.save({
      call: call(VideoCallProvider.GoogleMeet),
      prepared: PREPARED,
      source: VideoCallTranscriptSource.Provider,
      isAutomatic: true,
    });

    expect(writes[0]!["transcriptAddedByUserId"]).toBeNull();
    expect(start).toHaveBeenCalledWith({ callId: CALL, userId: undefined });

    const item: JSONObject = feed.mock.calls[0]![0] as unknown as JSONObject;
    const markdown: string = item["feedInfoInMarkdown"] as string;

    expect(item["userId"]).toBeUndefined();
    expect(markdown).toBe(
      `📝 OneUptime added the call's transcript from **Google Meet** once the call was over: ${TranscriptText.describeInfo(PREPARED.info)}.`,
    );

    // As the feed draws it: no one leads it, so it reads as a sentence of its own.
    const drawn: FeedEntryLead = getFeedEntryText({ markdown });

    expect(drawn.lead).toBeUndefined();
    expect(drawn.body).toBe(
      `OneUptime added the call's transcript from **Google Meet** once the call was over: ${TranscriptText.describeInfo(PREPARED.info)}.`,
    );
  });

  test("a feed that cannot be written is logged: the transcript is stored and read all the same", async () => {
    feed.mockRejectedValue(new Error("database unavailable"));
    const errorLog: SpyInstance<typeof logger.error> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {
        return undefined;
      });

    await expect(
      IncidentCallTranscriptSave.save({
        call: call(VideoCallProvider.Zoom),
        prepared: PREPARED,
        source: VideoCallTranscriptSource.Upload,
        userId: USER,
      }),
    ).resolves.toEqual({ status: CallSummaryStatus.Pending, runId: "run-1" });
    expect(writes).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not record an added call transcript"),
      expect.objectContaining({ incidentId: INCIDENT.toString() }),
    );
  });
});

describe("IncidentCallTranscriptSave.getFeedMarkdown", () => {
  test.each([
    [
      "read from Zoom by a person",
      VideoCallProvider.Zoom,
      VideoCallTranscriptSource.Provider,
      false,
      "📝 added the call's transcript from **Zoom**: ",
    ],
    [
      "added by a person to a Teams meeting",
      VideoCallProvider.MicrosoftTeams,
      VideoCallTranscriptSource.Upload,
      false,
      "📝 added a transcript of the **Microsoft Teams meeting**: ",
    ],
    [
      "got from Zoom by OneUptime itself",
      VideoCallProvider.Zoom,
      VideoCallTranscriptSource.Provider,
      true,
      "📝 OneUptime added the call's transcript from **Zoom** once the call was over: ",
    ],
  ])(
    "%s",
    (
      _name: string,
      provider: VideoCallProvider,
      source: VideoCallTranscriptSource,
      isAutomatic: boolean,
      opening: string,
    ) => {
      const markdown: string = IncidentCallTranscriptSave.getFeedMarkdown({
        call: { provider },
        info: PREPARED.info,
        source,
        isAutomatic,
      });

      expect(markdown.startsWith(opening)).toBe(true);
      expect(markdown.endsWith(".")).toBe(true);
    },
  );
});
