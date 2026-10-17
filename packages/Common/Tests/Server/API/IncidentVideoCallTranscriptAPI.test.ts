import IncidentVideoCallAPI from "../../../Server/API/IncidentVideoCallAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentVideoCallService from "../../../Server/Services/IncidentVideoCallService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IncidentCallSummary from "../../../Server/Utils/AI/CallSummary/IncidentCallSummary";
import VideoCallTranscriptReader from "../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptReader";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import UserType from "../../../Types/UserType";
import APIException from "../../../Types/Exception/ApiException";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  CallSummaryStatus,
  RootCauseSuggestionStatus,
} from "../../../Types/VideoCall/CallSummary";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
} from "../../../Types/VideoCall/VideoCallTranscript";
import TranscriptText from "../../../Utils/VideoCall/TranscriptText";

/*
 * The routes of an incident call's transcript (issue #4875).
 *
 * Who may do what is the point: adding, reading again, removing and
 * dismissing take what starting a call takes; the call is always read with
 * the caller's own permissions, so a private incident's call is not found
 * by someone who cannot see the incident; and using the suggestion as the
 * root cause is an edit of the incident made with the caller's permissions
 * - the only route that writes to the incident, and only on Accept.
 */

type Handler = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => Promise<void>;

const recordedRoutes: Array<{
  method: string;
  uri: string;
  handlers: Array<Handler>;
}> = [];

jest.mock("../../../Server/Utils/Express", () => {
  const record: (
    method: string,
  ) => (uri: string, ...handlers: Array<Handler>) => void = (
    method: string,
  ) => {
    return (uri: string, ...handlers: Array<Handler>): void => {
      recordedRoutes.push({ method, uri, handlers });
    };
  };

  return {
    getRouter: () => {
      return {
        post: record("post"),
        get: record("get"),
        put: record("put"),
        delete: record("delete"),
      };
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const USER: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const CALL: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const CONNECTION: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const ZOOM_VTT: string = [
  "WEBVTT",
  "",
  "00:00:05.000 --> 00:00:09.000",
  "Priya Shah: Checkout is timing out.",
  "",
  "00:12:03.000 --> 00:12:06.000",
  "Sam Lee: The pool maxes at 50.",
  "",
].join("\n");

const READY_SUMMARY: JSONObject = {
  version: 1,
  runId: "run-1",
  generatedAt: "2026-10-17T15:00:00.000Z",
  rootCause: {
    outcome: "Suggested",
    summary: "The deploy exhausted the DB pool.",
    basis: "StatedOnCall",
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

let props: DatabaseCommonInteractionProps;
let call: IncidentVideoCall | null;
let next: jest.Mock;
let writes: Array<JSONObject>;
const res: ExpressResponse = {} as ExpressResponse;

function setPermissions(permissions: Array<Permission>): void {
  props.userTenantAccessPermission = {
    [PROJECT.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT,
      permissions: permissions.map((permission: Permission) => {
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
    },
  } as unknown as DatabaseCommonInteractionProps["userTenantAccessPermission"];
}

function handlerOf(method: string, uri: string): Handler {
  const found: { handlers: Array<Handler> } | undefined = recordedRoutes.find(
    (route: { method: string; uri: string }) => {
      return route.method === method && route.uri === uri;
    },
  );

  expect(found).toBeDefined();
  return found!.handlers[found!.handlers.length - 1]!;
}

function request(
  body: JSONObject = {},
  callId: string = CALL.toString(),
): ExpressRequest {
  return { body, params: { callId } } as unknown as ExpressRequest;
}

function zoomCall(): IncidentVideoCall {
  const found: IncidentVideoCall = new IncidentVideoCall();
  found.id = CALL;
  found.projectId = PROJECT;
  found.incidentId = INCIDENT;
  found.provider = VideoCallProvider.Zoom;
  found.videoCallConnectionId = CONNECTION;
  found.externalMeetingId = "85746065432";
  return found;
}

function thrownBy(): unknown {
  expect(next).toHaveBeenCalledTimes(1);
  return next.mock.calls[0]![0];
}

function sentJson(): JSONObject {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  expect(send).toHaveBeenCalledTimes(1);
  return send.mock.calls[0]![2] as JSONObject;
}

const TRANSCRIPT_ROUTE: string = "/incident-video-call/:callId/transcript";
const PROVIDER_ROUTE: string =
  "/incident-video-call/:callId/transcript/from-provider";
const SUMMARY_ROUTE: string = "/incident-video-call/:callId/call-summary";
const SUGGESTION_ROUTE: string =
  "/incident-video-call/:callId/root-cause-suggestion";

beforeAll(() => {
  new IncidentVideoCallAPI();
});

beforeEach(() => {
  props = { userId: USER, tenantId: PROJECT, userType: UserType.User };
  setPermissions([Permission.IncidentMember]);
  call = zoomCall();
  next = jest.fn();
  writes = [];

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return props;
    });

  jest
    .spyOn(IncidentVideoCallService, "findOneBy")
    .mockImplementation(async () => {
      return call;
    });

  jest
    .spyOn(IncidentVideoCallService, "updateOneById")
    .mockImplementation(async (data: { data: unknown }): Promise<number> => {
      writes.push(data.data as JSONObject);
      return 1;
    });

  jest.spyOn(IncidentCallSummary, "start").mockResolvedValue({
    status: CallSummaryStatus.Pending,
    runId: "run-2",
  });

  jest.spyOn(IncidentFeedService, "createIncidentFeedItem").mockResolvedValue();
  jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(1);
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("the routes", () => {
  test.each([
    ["post", TRANSCRIPT_ROUTE],
    ["post", PROVIDER_ROUTE],
    ["delete", TRANSCRIPT_ROUTE],
    ["post", SUMMARY_ROUTE],
    ["post", SUGGESTION_ROUTE],
  ])(
    "%s %s resolves the caller and requires authentication first",
    (method: string, uri: string) => {
      const route: { handlers: Array<Handler> } | undefined =
        recordedRoutes.find((candidate: { method: string; uri: string }) => {
          return candidate.method === method && candidate.uri === uri;
        });

      expect(route).toBeDefined();
      expect(route!.handlers.slice(0, 2)).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
      expect(route!.handlers).toHaveLength(3);
    },
  );
});

describe("POST /incident-video-call/:callId/transcript - adding one", () => {
  test("stores it as remarks, has OneUptime AI read it, and records it in the feed only", async () => {
    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT, fileName: "zoom.transcript.vtt" }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);

    const written: JSONObject = writes[0]!;

    expect(written["transcript"]).toBe(
      TranscriptText.serialize([
        {
          offsetInSeconds: 5,
          speaker: "Priya Shah",
          text: "Checkout is timing out.",
        },
        {
          offsetInSeconds: 723,
          speaker: "Sam Lee",
          text: "The pool maxes at 50.",
        },
      ]),
    );
    expect(written["transcriptSource"]).toBe(VideoCallTranscriptSource.Upload);
    expect(written["transcriptAddedAt"]).toBeInstanceOf(Date);
    expect(written["transcriptAddedByUserId"]).toEqual(USER);
    expect(written["transcriptInfo"]).toEqual({
      lineCount: 2,
      speakerCount: 2,
      characterCount: 44,
      durationInSeconds: 718,
      fileName: "zoom.transcript.vtt",
    });
    // A new transcript starts with nothing read in it and nothing to review.
    expect(written["callSummary"]).toBeNull();
    expect(written["rootCauseSuggestionStatus"]).toBeNull();
    expect(written["rootCauseSuggestionReviewedByUserId"]).toBeNull();

    expect(IncidentCallSummary.start).toHaveBeenCalledWith({
      callId: CALL,
      userId: USER,
    });

    const feed: jest.Mock =
      IncidentFeedService.createIncidentFeedItem as unknown as jest.Mock;
    expect(feed).toHaveBeenCalledTimes(1);
    const item: JSONObject = feed.mock.calls[0]![0] as JSONObject;
    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.VideoCallTranscriptAdded,
    );
    expect(item["incidentId"]).toEqual(INCIDENT);
    expect(item["userId"]).toEqual(USER);
    expect(item["feedInfoInMarkdown"]).toBe(
      "📝 A transcript of the **Zoom meeting** was added: 12 minutes, 2 speakers, 2 remarks.",
    );
    // Never posted to the incident's Slack or Teams channels.
    expect(item["workspaceNotification"]).toBeUndefined();

    expect(sentJson()).toEqual({
      transcriptSource: VideoCallTranscriptSource.Upload,
      transcriptInfo: written["transcriptInfo"],
      callSummaryStatus: CallSummaryStatus.Pending,
    });
  });

  test("AI off for the project: the transcript is kept, and the answer says why it was not read", async () => {
    jest.spyOn(IncidentCallSummary, "start").mockResolvedValue({
      status: CallSummaryStatus.Skipped,
      message:
        "AI features are disabled for this project. Enable them in Project Settings → AI → AI Features.",
    });

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(writes).toHaveLength(1);
    expect(sentJson()).toEqual(
      expect.objectContaining({
        callSummaryStatus: CallSummaryStatus.Skipped,
        callSummaryStatusMessage: expect.stringMatching(
          /AI features are disabled/,
        ),
      }),
    );
  });

  test("an API key may add one: no person added it", async () => {
    props = { tenantId: PROJECT, userType: UserType.API };
    setPermissions([Permission.IncidentMember]);

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(writes[0]!["transcriptAddedByUserId"]).toBeNull();
  });

  test("no text: says what to add", async () => {
    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: "  " }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(BadDataException);
    expect((thrownBy() as Error).message).toMatch(/\.vtt, \.srt or \.txt/);
    expect(writes).toHaveLength(0);
  });

  test("a transcript too long to keep is refused, and nothing is written", async () => {
    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: "x".repeat(2_000_001) }),
      res,
      next,
    );

    expect((thrownBy() as Error).message).toMatch(/too long to add/);
    expect(writes).toHaveLength(0);
    expect(IncidentCallSummary.start).not.toHaveBeenCalled();
  });

  test("someone who can only read incidents may not add one: refused before anything is read", async () => {
    setPermissions([Permission.IncidentViewer]);

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(IncidentVideoCallService.findOneBy).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("a custom role with Create Incident Video Call may", async () => {
    setPermissions([
      Permission.CreateIncidentVideoCall,
      Permission.ReadIncidentVideoCall,
    ]);

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
  });

  /*
   * The call is read with the caller's own props: the incident privacy
   * filter decides whether it is there at all. A private incident's call
   * is not found by someone who cannot see the incident.
   */
  test("the call is read with the caller's permissions: a private incident's call is not found", async () => {
    call = null;

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotFoundException);
    expect(IncidentVideoCallService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { _id: CALL.toString(), projectId: PROJECT },
        props,
      }),
    );
    expect(writes).toHaveLength(0);
  });

  test("a call of another project is refused", async () => {
    call!.projectId = new ObjectID("99999999-9999-4999-8999-999999999999");

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(writes).toHaveLength(0);
  });

  test("a call id that is not one is refused", async () => {
    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }, "1"),
      res,
      next,
    );

    expect((thrownBy() as Error).message).toMatch(/valid video call ID/);
  });

  test("a feed that cannot be written does not undo the transcript", async () => {
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockRejectedValue(new Error("feed down"));

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
  });
});

describe("POST /incident-video-call/:callId/transcript/from-provider", () => {
  test("found: stored as the provider's, read by OneUptime AI, recorded in the feed", async () => {
    jest.spyOn(VideoCallTranscriptReader, "read").mockResolvedValue({
      found: true,
      lines: [
        { offsetInSeconds: 1, speaker: "Priya Shah", text: "Rolling back." },
      ],
      format: TranscriptText.detectFormat(""),
    });

    await handlerOf("post", PROVIDER_ROUTE)(request(), res, next);

    expect(VideoCallTranscriptReader.read).toHaveBeenCalledWith({
      call: {
        provider: VideoCallProvider.Zoom,
        videoCallConnectionId: CONNECTION,
        externalMeetingId: "85746065432",
      },
      projectId: PROJECT,
    });
    expect(writes[0]!["transcriptSource"]).toBe(
      VideoCallTranscriptSource.Provider,
    );
    expect(IncidentCallSummary.start).toHaveBeenCalled();

    const item: JSONObject = (
      IncidentFeedService.createIncidentFeedItem as unknown as jest.Mock
    ).mock.calls[0]![0] as JSONObject;
    expect(item["feedInfoInMarkdown"]).toBe(
      "📝 The transcript of the **Zoom meeting** was read from Zoom: 1 speaker, 1 remark.",
    );
    expect(sentJson()).toEqual(
      expect.objectContaining({
        added: true,
        callSummaryStatus: CallSummaryStatus.Pending,
      }),
    );
  });

  test("not there to read: says why, and writes nothing", async () => {
    jest.spyOn(VideoCallTranscriptReader, "read").mockResolvedValue({
      found: false,
      unavailable: {
        reason: VideoCallTranscriptUnavailableReason.NotReady,
        message: "Zoom is still preparing this meeting's transcript.",
      },
    });

    await handlerOf("post", PROVIDER_ROUTE)(request(), res, next);

    expect(sentJson()).toEqual({
      added: false,
      reason: VideoCallTranscriptUnavailableReason.NotReady,
      message: "Zoom is still preparing this meeting's transcript.",
    });
    expect(writes).toHaveLength(0);
    expect(IncidentCallSummary.start).not.toHaveBeenCalled();
    expect(IncidentFeedService.createIncidentFeedItem).not.toHaveBeenCalled();
  });

  test("a provider that does not answer is an error", async () => {
    jest
      .spyOn(VideoCallTranscriptReader, "read")
      .mockRejectedValue(new APIException("Zoom could not answer (HTTP 503)"));

    await handlerOf("post", PROVIDER_ROUTE)(request(), res, next);

    expect(thrownBy()).toBeInstanceOf(APIException);
    expect(writes).toHaveLength(0);
  });

  test("the call is found before the provider is asked", async () => {
    call = null;
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      VideoCallTranscriptReader,
      "read",
    );

    await handlerOf("post", PROVIDER_ROUTE)(request(), res, next);

    expect(thrownBy()).toBeInstanceOf(NotFoundException);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("DELETE /incident-video-call/:callId/transcript", () => {
  test("removes the transcript and everything read in it", async () => {
    await handlerOf("delete", TRANSCRIPT_ROUTE)(request(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(writes).toEqual([
      {
        transcript: null,
        transcriptSource: null,
        transcriptInfo: null,
        transcriptAddedAt: null,
        transcriptAddedByUserId: null,
        callSummary: null,
        callSummaryStatus: null,
        callSummaryStatusMessage: null,
        callSummaryUpdatedAt: null,
        rootCauseSuggestionStatus: null,
        rootCauseSuggestionReviewedAt: null,
        rootCauseSuggestionReviewedByUserId: null,
      },
    ]);
    expect(Response.sendEmptySuccessResponse).toHaveBeenCalled();
  });

  test("needs what adding one needs", async () => {
    setPermissions([Permission.IncidentViewer]);

    await handlerOf("delete", TRANSCRIPT_ROUTE)(request(), res, next);

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(writes).toHaveLength(0);
  });
});

describe("POST /incident-video-call/:callId/call-summary - reading it again", () => {
  test("starts a new reading", async () => {
    call!.transcript = "00:00:01\tA\tHello";

    await handlerOf("post", SUMMARY_ROUTE)(request(), res, next);

    expect(IncidentCallSummary.start).toHaveBeenCalledWith({
      callId: CALL,
      userId: USER,
    });
    expect(sentJson()).toEqual({
      callSummaryStatus: CallSummaryStatus.Pending,
    });
  });

  test("a call with no transcript has nothing to read", async () => {
    await handlerOf("post", SUMMARY_ROUTE)(request(), res, next);

    expect((thrownBy() as Error).message).toMatch(/no transcript to read/);
    expect(IncidentCallSummary.start).not.toHaveBeenCalled();
  });
});

describe("POST /incident-video-call/:callId/root-cause-suggestion", () => {
  beforeEach(() => {
    call!.callSummaryStatus = CallSummaryStatus.Ready;
    call!.callSummary = READY_SUMMARY;
    call!.rootCauseSuggestionStatus = RootCauseSuggestionStatus.Suggested;
  });

  test("Accepted: the root cause the person saved becomes the incident's, as their own edit", async () => {
    setPermissions([Permission.IncidentMember]);

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({
        decision: "Accepted",
        rootCause:
          "  The 14:05 deploy exhausted the DB pool.\n\n> [00:12:03] Sam Lee: The pool maxes at 50.  ",
      }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(IncidentService.updateOneById).toHaveBeenCalledWith({
      id: INCIDENT,
      data: {
        rootCause:
          "The 14:05 deploy exhausted the DB pool.\n\n> [00:12:03] Sam Lee: The pool maxes at 50.",
      },
      // The caller's props, never root: their permission, the incident's privacy.
      props,
    });
    expect(writes).toEqual([
      {
        rootCauseSuggestionStatus: RootCauseSuggestionStatus.Accepted,
        rootCauseSuggestionReviewedAt: expect.any(Date),
        rootCauseSuggestionReviewedByUserId: USER,
      },
    ]);
    expect(sentJson()).toEqual({
      rootCauseSuggestionStatus: RootCauseSuggestionStatus.Accepted,
    });
  });

  test("Accepted by someone the incident's edit refuses: nothing is marked accepted", async () => {
    jest
      .spyOn(IncidentService, "updateOneById")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permission to edit this incident.",
        ),
      );

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Accepted", rootCause: "The pool." }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(writes).toHaveLength(0);
  });

  test("Accepted needs the root cause to save", async () => {
    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Accepted" }),
      res,
      next,
    );

    expect((thrownBy() as Error).message).toMatch(
      /Write the root cause to save/,
    );
    expect(IncidentService.updateOneById).not.toHaveBeenCalled();
  });

  test("Accepted with a root cause longer than any is refused", async () => {
    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Accepted", rootCause: "x".repeat(50_001) }),
      res,
      next,
    );

    expect((thrownBy() as Error).message).toMatch(/too long/);
    expect(IncidentService.updateOneById).not.toHaveBeenCalled();
  });

  test("Dismissed: the incident is untouched", async () => {
    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Dismissed" }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(IncidentService.updateOneById).not.toHaveBeenCalled();
    expect(writes).toEqual([
      {
        rootCauseSuggestionStatus: RootCauseSuggestionStatus.Dismissed,
        rootCauseSuggestionReviewedAt: expect.any(Date),
        rootCauseSuggestionReviewedByUserId: USER,
      },
    ]);
  });

  test("Suggested again undoes a dismissal, and forgets who dismissed it", async () => {
    call!.rootCauseSuggestionStatus = RootCauseSuggestionStatus.Dismissed;

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Suggested" }),
      res,
      next,
    );

    expect(writes).toEqual([
      {
        rootCauseSuggestionStatus: RootCauseSuggestionStatus.Suggested,
        rootCauseSuggestionReviewedAt: null,
        rootCauseSuggestionReviewedByUserId: null,
      },
    ]);
  });

  test("dismissing needs what working on the calls needs", async () => {
    setPermissions([Permission.IncidentViewer]);

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Dismissed" }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(writes).toHaveLength(0);
  });

  test("a decision that is not one is refused", async () => {
    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Maybe" }),
      res,
      next,
    );

    expect((thrownBy() as Error).message).toMatch(
      /Accepted, Dismissed or Suggested/,
    );
  });

  test.each([
    [
      "the reading is still running",
      { callSummaryStatus: CallSummaryStatus.Pending },
    ],
    [
      "the call did not discuss the cause enough",
      {
        callSummary: {
          ...READY_SUMMARY,
          rootCause: { outcome: "NotEnoughDiscussion", citations: [] },
        },
      },
    ],
    ["nothing was suggested", { rootCauseSuggestionStatus: undefined }],
  ])("nothing to decide when %s", async (_name: string, change: JSONObject) => {
    Object.assign(call!, change);

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Accepted", rootCause: "The pool." }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(BadDataException);
    expect((thrownBy() as Error).message).toMatch(
      /did not suggest a root cause/,
    );
    expect(IncidentService.updateOneById).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });
});
