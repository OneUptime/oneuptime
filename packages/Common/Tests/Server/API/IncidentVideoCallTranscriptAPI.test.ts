import IncidentVideoCallAPI from "../../../Server/API/IncidentVideoCallAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentVideoCallService from "../../../Server/Services/IncidentVideoCallService";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import IncidentCallSummary from "../../../Server/Utils/AI/CallSummary/IncidentCallSummary";
import IncidentCallTranscriptSave from "../../../Server/Utils/VideoCall/Transcripts/IncidentCallTranscriptSave";
import VideoCallTranscriptReader from "../../../Server/Utils/VideoCall/Transcripts/VideoCallTranscriptReader";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Incident from "../../../Models/DatabaseModels/Incident";
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
  VideoCallTranscriptInfo,
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
} from "../../../Types/VideoCall/VideoCallTranscript";
import TranscriptText from "../../../Utils/VideoCall/TranscriptText";
import {
  FeedEntryLead,
  getFeedEntryText,
} from "../../../UI/Components/Feed/FeedEntryText";

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
/*
 * Whether the call's incident is private and owned by none of the caller's
 * teams that may work on its calls - what the private record rule asks of
 * the incident, as OneUptime, before a route writes (PrivateRecordWriteCheck).
 */
let isIncidentOutOfReach: boolean;
let incidentChecks: Array<{
  query: JSONObject;
  props: DatabaseCommonInteractionProps;
}>;
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
  isIncidentOutOfReach = false;
  incidentChecks = [];

  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }) => {
      incidentChecks.push({ query: findOneBy.query, props: findOneBy.props });

      if (!isIncidentOutOfReach) {
        return null;
      }

      const incident: Incident = new Incident();
      incident._id = INCIDENT.toString();
      return incident;
    }) as never);

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
    // And OneUptime no longer waits to get one by itself.
    expect(written["transcriptFetchStatus"]).toBeNull();
    expect(written["transcriptFetchReason"]).toBeNull();
    expect(written["transcriptFetchNextAttemptAt"]).toBeNull();

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
    /*
     * Written for the person's action - "added", the verb the feed leads
     * with the person's name - so it reads "Maya Chen added a transcript
     * of the Zoom meeting: ..." in the feed.
     */
    expect(item["feedInfoInMarkdown"]).toBe(
      "📝 added a transcript of the **Zoom meeting**: 12 minutes, 2 speakers, 2 remarks.",
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
    // The provider named once: "added the call's transcript from Zoom".
    expect(item["feedInfoInMarkdown"]).toBe(
      "📝 added the call's transcript from **Zoom**: 1 speaker, 1 remark.",
    );
    expect(sentJson()).toEqual(
      expect.objectContaining({
        added: true,
        callSummaryStatus: CallSummaryStatus.Pending,
      }),
    );
  });

  test("a Teams call is read with the calendar event its meeting belongs to, and when it started", async () => {
    const started: Date = new Date("2026-10-19T08:30:00.000Z");
    call!.provider = VideoCallProvider.MicrosoftTeams;
    call!.externalMeetingId = "MSpkYzE3Njc0Yy04MWQ5";
    call!.externalCalendarEventId = "AAMkAGI2TG93AAA=";
    call!.createdAt = started;
    jest.spyOn(VideoCallTranscriptReader, "read").mockResolvedValue({
      found: true,
      lines: [
        { offsetInSeconds: 1, speaker: "Priya Shah", text: "Rolling back." },
      ],
      format: TranscriptText.detectFormat(""),
    });

    await handlerOf("post", PROVIDER_ROUTE)(request(), res, next);

    expect(IncidentVideoCallService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          externalMeetingId: true,
          externalCalendarEventId: true,
          createdAt: true,
        }),
      }),
    );
    expect(VideoCallTranscriptReader.read).toHaveBeenCalledWith({
      call: {
        provider: VideoCallProvider.MicrosoftTeams,
        videoCallConnectionId: CONNECTION,
        externalMeetingId: "MSpkYzE3Njc0Yy04MWQ5",
        externalCalendarEventId: "AAMkAGI2TG93AAA=",
        startedAt: started,
      },
      projectId: PROJECT,
    });

    const item: JSONObject = (
      IncidentFeedService.createIncidentFeedItem as unknown as jest.Mock
    ).mock.calls[0]![0] as JSONObject;
    expect(item["feedInfoInMarkdown"]).toBe(
      "📝 added the call's transcript from **Microsoft Teams**: 1 speaker, 1 remark.",
    );
  });

  /*
   * Record and transcribe incident calls: a person who gets (or adds) the
   * transcript before OneUptime does takes it from here - OneUptime stops
   * waiting for one, so it is never stored, read and posted twice.
   */
  test("found: OneUptime stops waiting to get it by itself", async () => {
    jest.spyOn(VideoCallTranscriptReader, "read").mockResolvedValue({
      found: true,
      lines: [
        { offsetInSeconds: 1, speaker: "Priya Shah", text: "Rolling back." },
      ],
      format: TranscriptText.detectFormat(""),
    });

    await handlerOf("post", PROVIDER_ROUTE)(request(), res, next);

    expect(writes[0]).toEqual(
      expect.objectContaining({
        transcriptFetchStatus: null,
        transcriptFetchReason: null,
        transcriptFetchNextAttemptAt: null,
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

/*
 * A CALL OF A PRIVATE INCIDENT IS WORKED ON ONLY THROUGH THE TEAMS THAT OWN
 * THE INCIDENT. These routes write as OneUptime once the caller is checked,
 * so they ask the private record rule themselves: a member who sees the
 * incident through a team that may only view it, and holds Incident Member
 * on a team that does not own it, adds, reads again, removes and dismisses
 * nothing, and saves no root cause - each refused with why, before anything
 * is read from a provider, started or written.
 */
describe("a call of a private incident none of the caller's teams that may work on calls owns", () => {
  beforeEach(() => {
    isIncidentOutOfReach = true;
  });

  const PRIVATE_REASON: string =
    "The incident it belongs to is private, so it is changed only with the permissions of the teams that own that incident and of the people named as its owners, and none of them lets you do this.";

  test("adding a transcript is refused with why, and nothing is written", async () => {
    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT, fileName: "zoom.transcript.vtt" }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect((thrownBy() as Error).message).toBe(
      `You do not have permission to work on this incident's calls. ${PRIVATE_REASON} Ask a project admin to give one of the teams that own it this permission, or to add you as an owner.`,
    );
    expect(writes).toHaveLength(0);
    expect(IncidentCallSummary.start).not.toHaveBeenCalled();
  });

  test("the rule is asked of the call's incident, as OneUptime, by its id", async () => {
    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(incidentChecks).toHaveLength(1);
    expect(incidentChecks[0]!.props).toEqual({ isRoot: true });
    expect(incidentChecks[0]!.query["projectId"]?.toString()).toBe(
      PROJECT.toString(),
    );
  });

  test("reading one from the provider is refused before the provider is asked", async () => {
    const read: ReturnType<typeof jest.spyOn> = jest.spyOn(
      VideoCallTranscriptReader,
      "read",
    );

    await handlerOf("post", PROVIDER_ROUTE)(request({}), res, next);

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(read).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("removing it is refused, and the transcript stays", async () => {
    await handlerOf("delete", TRANSCRIPT_ROUTE)(request({}), res, next);

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(writes).toHaveLength(0);
  });

  test("reading it again is refused, and no reading starts", async () => {
    call!.transcript = "[00:05] Priya Shah: Checkout is timing out.";

    await handlerOf("post", SUMMARY_ROUTE)(request({}), res, next);

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(IncidentCallSummary.start).not.toHaveBeenCalled();
  });

  test("dismissing the suggestion is refused, and nothing is marked", async () => {
    Object.assign(call!, {
      callSummaryStatus: CallSummaryStatus.Ready,
      callSummary: READY_SUMMARY,
      rootCauseSuggestionStatus: RootCauseSuggestionStatus.Suggested,
    });

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Dismissed" }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect(writes).toHaveLength(0);
  });

  test("accepting it saves no root cause, and nothing is marked accepted", async () => {
    Object.assign(call!, {
      callSummaryStatus: CallSummaryStatus.Ready,
      callSummary: READY_SUMMARY,
      rootCauseSuggestionStatus: RootCauseSuggestionStatus.Suggested,
    });

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Accepted", rootCause: "The pool." }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect((thrownBy() as Error).message).toMatch(
      /^You do not have permission to edit this incident's root cause\./,
    );
    expect(IncidentService.updateOneById).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("a project admin works on it: they act on every private incident, and the incident is not even asked", async () => {
    setPermissions([Permission.ProjectAdmin]);

    await handlerOf("post", TRANSCRIPT_ROUTE)(
      request({ text: ZOOM_VTT }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(incidentChecks).toHaveLength(0);
  });
});

describe("an accepted root cause the incident's edit does not reach", () => {
  test("is refused with why, and nothing is marked accepted", async () => {
    Object.assign(call!, {
      callSummaryStatus: CallSummaryStatus.Ready,
      callSummary: READY_SUMMARY,
      rootCauseSuggestionStatus: RootCauseSuggestionStatus.Suggested,
    });

    jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(0);
    jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(
        new NotAuthorizedException(
          "You do not have permission to update this incident.",
        ),
      );

    await handlerOf("post", SUGGESTION_ROUTE)(
      request({ decision: "Accepted", rootCause: "The pool." }),
      res,
      next,
    );

    expect(thrownBy()).toBeInstanceOf(NotAuthorizedException);
    expect((thrownBy() as Error).message).toBe(
      "You do not have permission to update this incident.",
    );
    expect(writes).toHaveLength(0);
  });
});

/*
 * The feed entry an added transcript writes, as the incident's feed draws
 * it (FeedEntryText): the person who added it leads the sentence, as on
 * every entry written for someone's action, and an API key's entry reads as
 * a sentence of its own. The provider is named once.
 */
describe("the feed entry an added transcript writes", () => {
  function callOf(provider: VideoCallProvider): IncidentVideoCall {
    const feedCall: IncidentVideoCall = new IncidentVideoCall();
    feedCall.provider = provider;
    return feedCall;
  }

  const INFO: VideoCallTranscriptInfo = {
    lineCount: 312,
    speakerCount: 6,
    characterCount: 40_000,
    durationInSeconds: 52 * 60,
  };

  test.each<[string, VideoCallProvider, VideoCallTranscriptSource, string]>([
    [
      "read from Zoom",
      VideoCallProvider.Zoom,
      VideoCallTranscriptSource.Provider,
      "added the call's transcript from **Zoom**: 52 minutes, 6 speakers, 312 remarks.",
    ],
    [
      "read from Google Meet",
      VideoCallProvider.GoogleMeet,
      VideoCallTranscriptSource.Provider,
      "added the call's transcript from **Google Meet**: 52 minutes, 6 speakers, 312 remarks.",
    ],
    [
      "a Microsoft Teams meeting's, added by hand",
      VideoCallProvider.MicrosoftTeams,
      VideoCallTranscriptSource.Upload,
      "added a transcript of the **Microsoft Teams meeting**: 52 minutes, 6 speakers, 312 remarks.",
    ],
    [
      "a Slack huddle's, added by hand",
      VideoCallProvider.SlackHuddle,
      VideoCallTranscriptSource.Upload,
      "added a transcript of the **Slack huddle**: 52 minutes, 6 speakers, 312 remarks.",
    ],
  ])(
    "%s: the person's name leads it",
    (
      _name: string,
      provider: VideoCallProvider,
      source: VideoCallTranscriptSource,
      sentence: string,
    ) => {
      const markdown: string = IncidentCallTranscriptSave.getFeedMarkdown({
        call: callOf(provider),
        info: INFO,
        source,
      });

      const withPerson: FeedEntryLead = getFeedEntryText({
        markdown,
        actorName: "Maya Chen",
      });

      // "Maya Chen added the call's transcript from Zoom: ..."
      expect(withPerson.lead).toBe(sentence);
      expect(withPerson.body).toBe("");

      // Added with an API key: no one to lead it, so it starts a sentence.
      const withoutPerson: FeedEntryLead = getFeedEntryText({ markdown });

      expect(withoutPerson.lead).toBeUndefined();
      expect(withoutPerson.body).toBe(
        sentence.charAt(0).toUpperCase() + sentence.slice(1),
      );
    },
  );
});
