import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../../Models/DatabaseModels/IncidentFeed";
import IncidentVideoCall from "../../../../../Models/DatabaseModels/IncidentVideoCall";
import VideoCallConnection from "../../../../../Models/DatabaseModels/VideoCallConnection";
import WorkspaceNotificationLog from "../../../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspaceProjectAuthToken from "../../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import IncidentFeedService from "../../../../../Server/Services/IncidentFeedService";
import IncidentVideoCallService, {
  TakenTranscript,
} from "../../../../../Server/Services/IncidentVideoCallService";
import VideoCallConnectionService from "../../../../../Server/Services/VideoCallConnectionService";
import WorkspaceNotificationLogService from "../../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../../Server/Services/WorkspaceProjectAuthTokenService";
import IncidentCallSummaryFeed from "../../../../../Server/Utils/AI/CallSummary/IncidentCallSummaryFeed";
import logger from "../../../../../Server/Utils/Logger";
import IncidentCallTranscriptRemoval, {
  REMOVED_SIGN_IN_CALLS_PER_RUN,
  TranscriptRemovalOutcome,
  TranscriptRemovalReason,
} from "../../../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptRemoval";
import WorkspacePostedMessages, {
  WorkspaceMessageDeletion,
} from "../../../../../Server/Utils/Workspace/WorkspacePostedMessages";
import { Gray500 } from "../../../../../Types/BrandColors";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  CallSummary,
  CallSummaryBasis,
  CallSummaryRootCauseOutcome,
  CallSummaryStatus,
} from "../../../../../Types/VideoCall/CallSummary";
import { CallSummaryPost } from "../../../../../Types/VideoCall/CallSummaryPosts";
import VideoCallProvider from "../../../../../Types/VideoCall/VideoCallProvider";
import { VideoCallTranscriptSource } from "../../../../../Types/VideoCall/VideoCallTranscript";
import WorkspaceNotificationActionType from "../../../../../Types/Workspace/WorkspaceNotificationActionType";
import WorkspaceNotificationStatus from "../../../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspacePostedMessage from "../../../../../Types/Workspace/WorkspacePostedMessage";
import WorkspaceType from "../../../../../Types/Workspace/WorkspaceType";
import {
  FeedEntryLead,
  getFeedEntryText,
} from "../../../../../UI/Components/Feed/FeedEntryText";
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
 * A CALL'S TRANSCRIPT REMOVED, WITH WHAT ONEUPTIME AI READ IN IT, EVERYWHERE
 * IT WENT (issues #9289 and #9290).
 *
 * Remove transcript said what OneUptime AI read was removed from the
 * incident, while its feed post and its channel messages stayed; and Zoom
 * asks apps to delete a removed user's data, while the transcripts read
 * through their sign-in stayed. Here, each way a transcript goes - a person
 * removing it, the account that read it removing OneUptime, its call
 * deleted - takes back every feed item and channel message of what was read
 * in it, forgets the text Notification Logs kept of them, says itself in
 * the feed, and says where a message stays that OneUptime could not delete.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const INCIDENT: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CALL: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const USER: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const CONNECTION: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const FEED_A: string = "66666666-6666-4666-8666-666666666666";
const FEED_B: string = "77777777-7777-4777-8777-777777777777";
const ACCOUNT: string = "KdYKjnimT4KPd8FFgQt9FQ";

const SLACK_MESSAGE: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.Slack,
  channelId: "C0INC42",
  channelName: "inc-42",
  messageId: "1760713500.000100",
};
const TEAMS_MESSAGE: WorkspacePostedMessage = {
  workspaceType: WorkspaceType.MicrosoftTeams,
  channelId: "19:abc@thread.tacv2",
  channelName: "Incidents",
  teamId: "team-1",
  messageId: "1760713500123",
};

// A reading's post: through the account's sign-in, or not.
function postOf(
  feedId: string,
  messages: Array<WorkspacePostedMessage>,
  signInAccountId?: string,
): CallSummaryPost {
  return {
    feedId,
    postedAt: "2026-10-17T15:05:00.000Z",
    ...(signInAccountId ? { signInAccountId } : {}),
    messages,
  };
}

function summary(): CallSummary {
  return {
    version: 1,
    runId: "run-1",
    generatedAt: "2026-10-17T15:04:00.000Z",
    rootCause: {
      outcome: CallSummaryRootCauseOutcome.Suggested,
      summary: "The deploy exhausted the DB pool.",
      basis: CallSummaryBasis.StatedOnCall,
      citations: [{ line: 2, text: "The pool maxes at 50." }],
    },
    findings: [],
    stepsTried: [],
    decisions: [],
    actions: [],
    openQuestions: [],
    linesRead: 2,
    partsRead: 1,
  };
}

function callOf(overrides: Partial<IncidentVideoCall> = {}): IncidentVideoCall {
  const call: IncidentVideoCall = new IncidentVideoCall();
  call.id = CALL;
  call.projectId = PROJECT;
  call.incidentId = INCIDENT;
  call.provider = VideoCallProvider.Zoom;
  call.videoCallConnectionId = CONNECTION;
  call.transcriptSource = VideoCallTranscriptSource.Provider;
  call.transcriptAddedAt = new Date("2026-10-17T15:00:00.000Z");
  Object.assign(call, overrides);
  return call;
}

function taken(overrides: Partial<TakenTranscript> = {}): TakenTranscript {
  return {
    call: callOf(),
    removedTranscript: true,
    posts: [
      postOf(FEED_A, [SLACK_MESSAGE]),
      postOf(FEED_B, [SLACK_MESSAGE, TEAMS_MESSAGE]),
    ],
    untrackedReading: false,
    ...overrides,
  };
}

let take: SpyInstance<typeof IncidentVideoCallService.takeTranscriptForRemoval>;
let feedDelete: SpyInstance<typeof IncidentFeedService.deleteBy>;
let feedFind: SpyInstance<typeof IncidentFeedService.findBy>;
let feedLine: SpyInstance<typeof IncidentFeedService.createIncidentFeedItem>;
let deleteAll: SpyInstance<typeof WorkspacePostedMessages.deleteAll>;
let forget: SpyInstance<typeof WorkspacePostedMessages.forgetLoggedText>;
let logFind: SpyInstance<typeof WorkspaceNotificationLogService.findBy>;
let projectAuths: SpyInstance<
  typeof WorkspaceProjectAuthTokenService.getProjectAuths
>;
let errorLog: SpyInstance<typeof logger.error>;

// Deletes every message it is given, unless told otherwise.
function deletingAll(
  notDeleted: Array<WorkspacePostedMessage> = [],
): (data: {
  projectId: ObjectID;
  messages: Array<WorkspacePostedMessage>;
}) => Promise<WorkspaceMessageDeletion> {
  return async (data: {
    projectId: ObjectID;
    messages: Array<WorkspacePostedMessage>;
  }): Promise<WorkspaceMessageDeletion> => {
    return {
      deleted: data.messages.filter((message: WorkspacePostedMessage) => {
        return !notDeleted.includes(message);
      }),
      notDeleted: data.messages
        .filter((message: WorkspacePostedMessage) => {
          return notDeleted.includes(message);
        })
        .map((message: WorkspacePostedMessage) => {
          return { message, reason: "channel_not_found" };
        }),
    };
  };
}

function feedLineOf(index: number = 0): JSONObject {
  return feedLine.mock.calls[index]![0] as unknown as JSONObject;
}

// The ids an any() condition names: its one parameter, as text.
function idsIn(condition: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (
      condition as {
        _objectLiteralParameters?: Record<string, unknown>;
      }
    )._objectLiteralParameters || {};
  const values: Array<unknown> = Object.values(parameters);

  expect(values).toHaveLength(1);
  return values[0] as Array<string>;
}

// The ids the call's feed items were deleted by.
function deletedFeedIds(index: number = 0): Array<string> {
  return idsIn(
    (feedDelete.mock.calls[index]![0] as unknown as { query: JSONObject })
      .query["_id"],
  );
}

beforeEach(() => {
  take = jest
    .spyOn(IncidentVideoCallService, "takeTranscriptForRemoval")
    .mockResolvedValue(taken());
  feedDelete = jest.spyOn(IncidentFeedService, "deleteBy").mockResolvedValue(2);
  feedFind = jest.spyOn(IncidentFeedService, "findBy").mockResolvedValue([]);
  feedLine = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined);
  deleteAll = jest
    .spyOn(WorkspacePostedMessages, "deleteAll")
    .mockImplementation(deletingAll());
  forget = jest
    .spyOn(WorkspacePostedMessages, "forgetLoggedText")
    .mockResolvedValue(undefined);
  logFind = jest
    .spyOn(WorkspaceNotificationLogService, "findBy")
    .mockResolvedValue([]);
  projectAuths = jest
    .spyOn(WorkspaceProjectAuthTokenService, "getProjectAuths")
    .mockImplementation(async (): Promise<Array<WorkspaceProjectAuthToken>> => {
      const auth: WorkspaceProjectAuthToken = new WorkspaceProjectAuthToken();
      auth.workspaceType = WorkspaceType.Slack;
      auth.authToken = "xoxb-token";
      return [auth];
    });
  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Remove transcript, by a person (#9290)", () => {
  test("takes the transcript and everything read in it, then deletes every reading's feed item, in this incident only", async () => {
    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    // Everything: no account narrows it.
    expect(take).toHaveBeenCalledWith({ callId: CALL });
    expect(feedDelete).toHaveBeenCalledTimes(1);

    const query: JSONObject = (
      feedDelete.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;

    expect(query["projectId"]).toEqual(PROJECT);
    expect(query["incidentId"]).toEqual(INCIDENT);
    expect(query["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallSummary,
    );
    expect(idsIn(query["_id"])).toEqual([FEED_A, FEED_B]);
    expect(
      (feedDelete.mock.calls[0]![0] as unknown as { props: JSONObject }).props,
    ).toEqual({ isRoot: true });
  });

  test("deletes every channel message of every reading, and forgets the text Notification Logs kept of them", async () => {
    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    expect(deleteAll).toHaveBeenCalledWith({
      projectId: PROJECT,
      messages: [SLACK_MESSAGE, SLACK_MESSAGE, TEAMS_MESSAGE],
    });
    expect(forget).toHaveBeenCalledWith({
      projectId: PROJECT,
      deletion: {
        deleted: [SLACK_MESSAGE, SLACK_MESSAGE, TEAMS_MESSAGE],
        notDeleted: [],
      },
      note: IncidentCallTranscriptRemoval.FORGOTTEN_MESSAGE_NOTE,
    });
    expect(IncidentCallTranscriptRemoval.FORGOTTEN_MESSAGE_NOTE).not.toMatch(
      /pool/i,
    );
  });

  test("says itself in the feed, kept to the dashboard, led by the person who removed it", async () => {
    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    const item: JSONObject = feedLineOf();

    expect(item["incidentId"]).toEqual(INCIDENT);
    expect(item["projectId"]).toEqual(PROJECT);
    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallTranscriptRemoved,
    );
    expect(item["displayColor"]).toBe(Gray500);
    expect(item["userId"]).toEqual(USER);
    // Never posted to the channels it just took the reading back from.
    expect(item).not.toHaveProperty("workspaceNotification");

    const drawn: FeedEntryLead = getFeedEntryText({
      markdown: item["feedInfoInMarkdown"] as string,
      actorName: "Maya Chen",
    });

    expect(drawn.lead).toBe(
      "removed the transcript of the **Zoom meeting** and what OneUptime AI read in it.",
    );
  });

  test("answers that it removed it, with nothing left behind", async () => {
    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome).toEqual({
      removed: true,
      messagesLeftIn: [],
      mayHaveMessagesLeft: false,
    });
  });

  test("names, once each, the places a message stays that OneUptime could not delete", async () => {
    deleteAll.mockImplementation(deletingAll([SLACK_MESSAGE, TEAMS_MESSAGE]));

    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome.removed).toBe(true);
    expect(outcome.messagesLeftIn).toEqual([
      "#inc-42 (Slack)",
      "Incidents (Microsoft Teams)",
    ]);
    // What Notification Logs kept of them is forgotten all the same.
    expect(forget).toHaveBeenCalledTimes(1);
  });

  test("a call whose reading was still going posted nothing: the transcript goes, and nothing else is asked", async () => {
    take.mockResolvedValue(taken({ posts: [] }));

    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome.removed).toBe(true);
    expect(feedDelete).not.toHaveBeenCalled();
    expect(deleteAll).not.toHaveBeenCalled();
    expect(feedLine).toHaveBeenCalledTimes(1);
  });

  test("a second removal finds nothing: no line in the feed, nothing deleted", async () => {
    take.mockResolvedValue(taken({ removedTranscript: false, posts: [] }));

    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome).toEqual({
      removed: false,
      messagesLeftIn: [],
      mayHaveMessagesLeft: false,
    });
    expect(feedLine).not.toHaveBeenCalled();
    expect(feedDelete).not.toHaveBeenCalled();
    expect(deleteAll).not.toHaveBeenCalled();
  });

  test("a call that is gone has nothing to remove", async () => {
    take.mockResolvedValue(null);

    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome.removed).toBe(false);
    expect(feedLine).not.toHaveBeenCalled();
  });

  test("a feed item that cannot be deleted is logged: the messages are still deleted", async () => {
    feedDelete.mockRejectedValue(new Error("database unavailable"));

    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome.removed).toBe(true);
    expect(deleteAll).toHaveBeenCalledTimes(1);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not delete what OneUptime AI read"),
      expect.objectContaining({ incidentId: INCIDENT.toString() }),
    );
  });

  test("a line the feed cannot take is logged: what was removed stays removed", async () => {
    feedLine.mockRejectedValue(new Error("database unavailable"));

    await expect(
      IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      }),
    ).resolves.toEqual(expect.objectContaining({ removed: true }));
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("Could not record a removed call transcript"),
      expect.anything(),
    );
  });

  test("a feed id that is not one is left alone", async () => {
    take.mockResolvedValue(
      taken({ posts: [postOf("not-an-id", [SLACK_MESSAGE])] }),
    );

    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    expect(feedDelete).not.toHaveBeenCalled();
    expect(deleteAll).toHaveBeenCalledTimes(1);
  });
});

/*
 * A reading posted before calls kept where their readings went: its feed
 * item is found by its exact text, which the same reading always has, and
 * its channel messages by the text Notification Logs kept of each.
 */
describe("a reading posted before calls kept where it went", () => {
  function legacyCall(
    overrides: Partial<IncidentVideoCall> = {},
  ): IncidentVideoCall {
    return callOf({
      callSummary: summary() as unknown as JSONObject,
      callSummaryStatus: CallSummaryStatus.Ready,
      ...overrides,
    });
  }

  function logRow(data: {
    workspaceType: WorkspaceType;
    channelId: string;
    channelName: string;
    threadId: string;
  }): WorkspaceNotificationLog {
    const log: WorkspaceNotificationLog = new WorkspaceNotificationLog();
    log.workspaceType = data.workspaceType;
    log.channelId = data.channelId;
    log.channelName = data.channelName;
    log.threadId = data.threadId;
    return log;
  }

  test("finds its feed item by what it says, and deletes it", async () => {
    const call: IncidentVideoCall = legacyCall();
    take.mockResolvedValue(taken({ call, posts: [], untrackedReading: true }));
    const item: IncidentFeed = new IncidentFeed();
    item.id = new ObjectID(FEED_A);
    feedFind.mockResolvedValue([item]);

    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    const markdown: string = IncidentCallSummaryFeed.getFeedMarkdown({
      call,
      callLabel: "Zoom meeting",
      summary: summary(),
    });
    const query: JSONObject = (
      feedFind.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;

    expect(query).toEqual({
      projectId: PROJECT,
      incidentId: INCIDENT,
      incidentFeedEventType: IncidentFeedEventType.VideoCallSummary,
      feedInfoInMarkdown: markdown,
    });
    expect(deletedFeedIds()).toEqual([FEED_A]);
  });

  test("finds its channel messages by the text their logs kept, deletes them, and forgets that text", async () => {
    const call: IncidentVideoCall = legacyCall();
    take.mockResolvedValue(taken({ call, posts: [], untrackedReading: true }));
    logFind.mockResolvedValue([
      logRow({
        workspaceType: WorkspaceType.Slack,
        channelId: "C0INC42",
        channelName: "inc-42",
        threadId: "1760713500.000100",
      }),
    ]);

    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    const query: JSONObject = (
      logFind.mock.calls[0]![0] as unknown as { query: JSONObject }
    ).query;

    expect(query["projectId"]).toEqual(PROJECT);
    expect(query["incidentId"]).toEqual(INCIDENT);
    expect(query["actionType"]).toBe(
      WorkspaceNotificationActionType.SendMessage,
    );
    expect(query["status"]).toBe(WorkspaceNotificationStatus.Success);
    expect(query["message"]).toBe(
      IncidentCallSummaryFeed.getFeedMarkdown({
        call,
        callLabel: "Zoom meeting",
        summary: summary(),
      }),
    );
    expect(deleteAll).toHaveBeenCalledWith({
      projectId: PROJECT,
      messages: [SLACK_MESSAGE],
    });
    expect(forget).toHaveBeenCalledTimes(1);
  });

  test("says some messages may stay, while the project has a chat connected: the logs may not keep them all", async () => {
    take.mockResolvedValue(
      taken({ call: legacyCall(), posts: [], untrackedReading: true }),
    );

    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome.mayHaveMessagesLeft).toBe(true);
  });

  test("a project with no chat connected had nowhere to post: nothing may stay", async () => {
    take.mockResolvedValue(
      taken({ call: legacyCall(), posts: [], untrackedReading: true }),
    );
    projectAuths.mockResolvedValue([]);

    const outcome: TranscriptRemovalOutcome =
      await IncidentCallTranscriptRemoval.removeByPerson({
        callId: CALL,
        userId: USER,
      });

    expect(outcome.mayHaveMessagesLeft).toBe(false);
  });

  test("a link of one's own with no title is named as its reading named it, after its connection", async () => {
    const call: IncidentVideoCall = legacyCall({
      provider: VideoCallProvider.CustomLink,
    });
    take.mockResolvedValue(taken({ call, posts: [], untrackedReading: true }));
    jest
      .spyOn(VideoCallConnectionService, "findOneById")
      .mockImplementation(async (): Promise<VideoCallConnection | null> => {
        const connection: VideoCallConnection = new VideoCallConnection();
        connection.name = "War room bridge";
        return connection;
      });

    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    expect(
      (feedFind.mock.calls[0]![0] as unknown as { query: JSONObject }).query[
        "feedInfoInMarkdown"
      ],
    ).toContain("**War room bridge**");
    expect(feedLineOf()["feedInfoInMarkdown"]).toContain("**War room bridge**");
  });

  test("a reading kept as one is never looked for by its text", async () => {
    await IncidentCallTranscriptRemoval.removeByPerson({
      callId: CALL,
      userId: USER,
    });

    expect(feedFind).not.toHaveBeenCalled();
    expect(logFind).not.toHaveBeenCalled();
  });
});

describe("the account whose sign-in read it removed OneUptime (#9289)", () => {
  test("takes only what was read through that sign-in, and deletes its posts everywhere", async () => {
    const throughSignIn: CallSummaryPost = postOf(
      FEED_A,
      [SLACK_MESSAGE],
      ACCOUNT,
    );
    take.mockResolvedValue(taken({ posts: [throughSignIn] }));

    await IncidentCallTranscriptRemoval.removeForRemovedSignIn({
      callId: CALL,
      signInAccountId: ACCOUNT,
    });

    expect(take).toHaveBeenCalledWith({
      callId: CALL,
      signInAccountId: ACCOUNT,
    });
    expect(deletedFeedIds()).toEqual([FEED_A]);
    expect(deleteAll).toHaveBeenCalledWith({
      projectId: PROJECT,
      messages: [SLACK_MESSAGE],
    });
  });

  test("says in the feed why, as OneUptime's own line, naming nobody", async () => {
    await IncidentCallTranscriptRemoval.removeForRemovedSignIn({
      callId: CALL,
      signInAccountId: ACCOUNT,
    });

    const item: JSONObject = feedLineOf();

    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallTranscriptRemoved,
    );
    expect(item["userId"]).toBeUndefined();
    expect(item["feedInfoInMarkdown"]).toBe(
      "🗑️ OneUptime deleted the transcript of the **Zoom meeting**, and what OneUptime AI read in it, because OneUptime was removed from the Zoom account it was read through.",
    );
    // The account itself is never named.
    expect(item["feedInfoInMarkdown"]).not.toContain(ACCOUNT);

    const drawn: FeedEntryLead = getFeedEntryText({
      markdown: item["feedInfoInMarkdown"] as string,
    });

    expect(drawn.lead).toBeUndefined();
    expect(drawn.body).toMatch(/^OneUptime deleted the transcript/);
  });

  test("a transcript a person added since stays: only what was read in the one read through the sign-in goes, and the feed says so", async () => {
    take.mockResolvedValue(
      taken({
        removedTranscript: false,
        posts: [postOf(FEED_A, [SLACK_MESSAGE], ACCOUNT)],
      }),
    );

    await IncidentCallTranscriptRemoval.removeForRemovedSignIn({
      callId: CALL,
      signInAccountId: ACCOUNT,
    });

    expect(feedLineOf()["feedInfoInMarkdown"]).toBe(
      "🗑️ OneUptime deleted what OneUptime AI read in the transcript of the **Zoom meeting** it read from Zoom, because OneUptime was removed from the Zoom account it was read through. The transcript added since stays.",
    );
  });

  test("nothing read through the account on this call: nothing said, nothing deleted", async () => {
    take.mockResolvedValue(taken({ removedTranscript: false, posts: [] }));

    await IncidentCallTranscriptRemoval.removeForRemovedSignIn({
      callId: CALL,
      signInAccountId: ACCOUNT,
    });

    expect(feedLine).not.toHaveBeenCalled();
    expect(deleteAll).not.toHaveBeenCalled();
  });

  test("the Workers job takes on the marked calls, the longest waiting first, each with its own account", async () => {
    const first: IncidentVideoCall = callOf({
      transcriptSignInAccountId: ACCOUNT,
    });
    const second: IncidentVideoCall = callOf({
      transcriptSignInAccountId: "OtherZoomUser1",
    });
    second.id = new ObjectID("88888888-8888-4888-8888-888888888888");
    const getCalls: SpyInstance<
      typeof IncidentVideoCallService.getCallsOfRemovedSignIns
    > = jest
      .spyOn(IncidentVideoCallService, "getCallsOfRemovedSignIns")
      .mockResolvedValue([first, second]);
    const removeOne: SpyInstance<
      typeof IncidentCallTranscriptRemoval.removeForRemovedSignIn
    > = jest
      .spyOn(IncidentCallTranscriptRemoval, "removeForRemovedSignIn")
      .mockResolvedValue(undefined);

    await expect(
      IncidentCallTranscriptRemoval.removeForRemovedSignIns(),
    ).resolves.toBe(2);

    expect(getCalls).toHaveBeenCalledWith(REMOVED_SIGN_IN_CALLS_PER_RUN);
    expect(removeOne.mock.calls).toEqual([
      [{ callId: CALL, signInAccountId: ACCOUNT }],
      [{ callId: second.id, signInAccountId: "OtherZoomUser1" }],
    ]);
  });

  test("a call that fails is logged and stays marked for the next run; the rest go on", async () => {
    const second: IncidentVideoCall = callOf({
      transcriptSignInAccountId: ACCOUNT,
    });
    second.id = new ObjectID("88888888-8888-4888-8888-888888888888");
    jest
      .spyOn(IncidentVideoCallService, "getCallsOfRemovedSignIns")
      .mockResolvedValue([
        callOf({ transcriptSignInAccountId: ACCOUNT }),
        second,
      ]);
    const removeOne: SpyInstance<
      typeof IncidentCallTranscriptRemoval.removeForRemovedSignIn
    > = jest
      .spyOn(IncidentCallTranscriptRemoval, "removeForRemovedSignIn")
      .mockRejectedValueOnce(new Error("lock timeout"))
      .mockResolvedValueOnce(undefined);

    await IncidentCallTranscriptRemoval.removeForRemovedSignIns();

    expect(removeOne).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining("trying again on the next run"),
      expect.anything(),
    );
  });
});

describe("a call deleted, with its transcript", () => {
  test("takes back its readings' posts, kept on the call, and says who removed the call", async () => {
    const call: IncidentVideoCall = callOf({
      callSummaryPosts: {
        posts: [
          {
            feedId: FEED_A,
            postedAt: "2026-10-17T15:05:00.000Z",
            messages: [
              {
                workspaceType: WorkspaceType.Slack,
                channelId: "C0INC42",
                channelName: "inc-42",
                messageId: "1760713500.000100",
              },
            ],
          },
        ],
      },
    });

    await IncidentCallTranscriptRemoval.takeBackDeletedCall({
      call,
      userId: USER,
    });

    expect(deletedFeedIds()).toEqual([FEED_A]);
    expect(deleteAll).toHaveBeenCalledWith({
      projectId: PROJECT,
      messages: [SLACK_MESSAGE],
    });

    const drawn: FeedEntryLead = getFeedEntryText({
      markdown: feedLineOf()["feedInfoInMarkdown"] as string,
      actorName: "Maya Chen",
    });

    expect(drawn.lead).toBe(
      "removed the **Zoom meeting**, with its transcript and what OneUptime AI read in it.",
    );
    expect(feedLineOf()["userId"]).toEqual(USER);
  });

  test("never throws: the call is gone either way", async () => {
    deleteAll.mockRejectedValue(new Error("Slack is down"));

    await expect(
      IncidentCallTranscriptRemoval.takeBackDeletedCall({
        call: callOf({
          callSummaryPosts: {
            posts: [
              {
                postedAt: "2026-10-17T15:05:00.000Z",
                messages: [
                  {
                    workspaceType: WorkspaceType.Slack,
                    channelId: "C0INC42",
                    messageId: "1760713500.000100",
                  },
                ],
              },
            ],
          },
        }),
      }),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalled();
  });
});

describe("the feed's line, in each case", () => {
  test.each([
    [
      TranscriptRemovalReason.Person,
      true,
      "🗑️ removed the transcript of the **Zoom meeting** and what OneUptime AI read in it.",
    ],
    [
      TranscriptRemovalReason.Person,
      false,
      "🗑️ removed what OneUptime AI read in the transcript of the **Zoom meeting**.",
    ],
    [
      TranscriptRemovalReason.CallDeleted,
      true,
      "🗑️ removed the **Zoom meeting**, with its transcript and what OneUptime AI read in it.",
    ],
  ])(
    "%s (transcript removed: %s)",
    (reason: TranscriptRemovalReason, removed: boolean, expected: string) => {
      expect(
        IncidentCallTranscriptRemoval.getRemovedFeedMarkdown({
          callLabel: "Zoom meeting",
          provider: VideoCallProvider.Zoom,
          reason,
          removedTranscript: removed,
        }),
      ).toBe(expected);
    },
  );

  test("a call's label is placed as text: a link's title cannot become markup", () => {
    const markdown: string =
      IncidentCallTranscriptRemoval.getRemovedFeedMarkdown({
        callLabel: "Bridge **now** [x](javascript:alert(1))",
        reason: TranscriptRemovalReason.Person,
        removedTranscript: true,
      });

    // Escaped where it sits: no bold, and no link, of the title's own.
    expect(markdown).toContain("\\*\\*now\\*\\*");
    expect(markdown).toContain("\\[x\\](javascript:");
    expect(markdown).not.toContain(" **now** ");
  });
});
