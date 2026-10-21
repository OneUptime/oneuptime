import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  CALL_TRANSCRIPTS_DOCS_PATH,
  CallTranscriptFromProvider,
  CallTranscriptSaved,
  addCallTranscript,
  getCallTranscriptFromProvider,
  readCallTranscriptAgain,
  removeCallTranscript,
  reviewCallRootCauseSuggestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptApi";
import {
  CallTranscriptReading,
  CallTranscriptView,
  getCallSummarySectionId,
  getCallTranscriptView,
  getCallsWithReadings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptState";
import {
  CALL_SUMMARY_POLL_INTERVAL_MS,
  CALL_TRANSCRIPT_WAIT_POLL_INTERVAL_MS,
  EventVideoCall,
  INCIDENT_CALL_TRANSCRIPT_SELECT,
  VideoCallEventKind,
  fetchEventVideoCalls,
  isAnyCallBeingRead,
  isAnyCallWaitingForTranscript,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/useEventVideoCalls";
import { CallTranscriptFetchStatus } from "../../../Types/VideoCall/CallTranscriptAutoFetch";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  CALL_SUMMARY_STALE_AFTER_MS,
  CallSummaryStatus,
  RootCauseSuggestionStatus,
} from "../../../Types/VideoCall/CallSummary";
import {
  VideoCallTranscriptSource,
  VideoCallTranscriptUnavailableReason,
} from "../../../Types/VideoCall/VideoCallTranscript";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  CALL_ID,
  OTHER_CALL_ID,
  TRANSCRIPT_INFO,
  notEnoughSummary,
  suggestedCall,
  suggestedSummary,
  transcriptCall,
} from "./CallTranscriptFixtures";

/*
 * WHERE AN INCIDENT CALL'S TRANSCRIPT STANDS, as the incident page reads it
 * (issue #4875): the Video Call card and the AI Investigation card both
 * work from getCallTranscriptView, so they never disagree; the page looks
 * again while OneUptime AI reads; and the transcript routes are reached
 * with the project's tenant header, each answer read as the route sends it.
 */

const NOW: Date = new Date();

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getCallTranscriptView - whether a call has a transcript", () => {
  test("a call with no transcript has nothing to read", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      transcriptCall(),
      NOW,
    );

    expect(view.hasTranscript).toBe(false);
    expect(view.reading).toBe(CallTranscriptReading.None);
    expect(view.summary).toBeNull();
    expect(view.suggestion).toBeNull();
  });

  test("its description says it has one: the list never carries the transcript itself", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      transcriptCall({ info: TRANSCRIPT_INFO, addedBy: "Priya Shah" }),
      NOW,
    );

    expect(view.hasTranscript).toBe(true);
    expect(view.info).toEqual(TRANSCRIPT_INFO);
    expect(view.source).toBe(VideoCallTranscriptSource.Provider);
    expect(view.addedByName).toBe("Priya Shah");
    expect(view.addedAt).toBeInstanceOf(Date);
  });

  test("a stored source it does not know reads as none", () => {
    const call: IncidentVideoCall = transcriptCall({ info: TRANSCRIPT_INFO });
    call.transcriptSource = "Fax" as never;

    expect(getCallTranscriptView(call, NOW).source).toBeNull();
  });

  test("a Zoom or Google Meet meeting started with a connection, or a Teams meeting put on a calendar, can be asked for its transcript; any other Teams meeting and a link cannot", () => {
    const canAsk: (call: IncidentVideoCall) => boolean = (
      call: IncidentVideoCall,
    ): boolean => {
      return getCallTranscriptView(call, NOW).canGetFromProvider;
    };

    expect(canAsk(transcriptCall({ provider: VideoCallProvider.Zoom }))).toBe(
      true,
    );
    expect(
      canAsk(transcriptCall({ provider: VideoCallProvider.GoogleMeet })),
    ).toBe(true);
    expect(
      canAsk(transcriptCall({ provider: VideoCallProvider.MicrosoftTeams })),
    ).toBe(false);
    expect(
      canAsk(
        transcriptCall({
          provider: VideoCallProvider.MicrosoftTeams,
          onCalendar: true,
        }),
      ),
    ).toBe(true);
    expect(
      canAsk(
        transcriptCall({
          provider: VideoCallProvider.Zoom,
          withConnection: false,
        }),
      ),
    ).toBe(false);
    expect(
      canAsk(transcriptCall({ provider: VideoCallProvider.CustomLink })),
    ).toBe(false);
  });
});

describe("getCallTranscriptView - where OneUptime AI's reading stands", () => {
  test("Pending is being read, until it has been Pending too long to still be", () => {
    const fresh: CallTranscriptView = getCallTranscriptView(
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Pending,
        statusMinutesAgo: 1,
      }),
      NOW,
    );
    const stuck: CallTranscriptView = getCallTranscriptView(
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Pending,
        statusMinutesAgo: CALL_SUMMARY_STALE_AFTER_MS / 60000 + 1,
      }),
      NOW,
    );

    expect(fresh.reading).toBe(CallTranscriptReading.Reading);
    expect(stuck.reading).toBe(CallTranscriptReading.Stuck);
  });

  test("Failed and Skipped carry the reason the server gave", () => {
    const failed: CallTranscriptView = getCallTranscriptView(
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Failed,
        statusMessage: "This project reached its daily AI token limit.",
      }),
      NOW,
    );
    const skipped: CallTranscriptView = getCallTranscriptView(
      transcriptCall({
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Skipped,
        statusMessage: "AI features are disabled for this project.",
      }),
      NOW,
    );

    expect(failed.reading).toBe(CallTranscriptReading.Failed);
    expect(failed.readingMessage).toBe(
      "This project reached its daily AI token limit.",
    );
    expect(skipped.reading).toBe(CallTranscriptReading.Skipped);
    expect(skipped.readingMessage).toBe(
      "AI features are disabled for this project.",
    );
  });

  test("Ready carries the summary and what a person decided about its suggestion", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      suggestedCall({
        suggestion: RootCauseSuggestionStatus.Accepted,
        reviewedBy: "Jordan Patel",
      }),
      NOW,
    );

    expect(view.reading).toBe(CallTranscriptReading.Ready);
    expect(view.summary?.rootCause).toEqual(suggestedSummary().rootCause);
    expect(view.suggestion).toBe(RootCauseSuggestionStatus.Accepted);
    expect(view.reviewedByName).toBe("Jordan Patel");
    expect(view.reviewedAt).toBeInstanceOf(Date);
  });

  test("a call that did not settle the cause has no suggestion to decide on", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      suggestedCall({ summary: notEnoughSummary() }),
      NOW,
    );

    expect(view.reading).toBe(CallTranscriptReading.Ready);
    expect(view.summary).not.toBeNull();
    expect(view.suggestion).toBeNull();
  });

  test("a status without a transcript is not a reading: a removed transcript leaves none", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      transcriptCall({
        status: CallSummaryStatus.Ready,
        summary: suggestedSummary(),
      }),
      NOW,
    );

    expect(view.reading).toBe(CallTranscriptReading.None);
    expect(view.summary).toBeNull();
  });

  test("a summary column that is not a summary is no summary", () => {
    const call: IncidentVideoCall = suggestedCall();
    call.callSummary = { rootCause: "the database" } as never;

    expect(getCallTranscriptView(call, NOW).summary).toBeNull();
  });
});

describe("getCallsWithReadings - the calls the AI Investigation card speaks of", () => {
  test("those read, being read, or whose reading stopped - not those with nothing read or skipped", () => {
    const calls: Array<IncidentVideoCall> = [
      suggestedCall({ id: CALL_ID }),
      transcriptCall({
        id: OTHER_CALL_ID,
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Pending,
      }),
      transcriptCall({
        id: "8f7e6d5c-4b3a-4f2e-8d1c-0b9a8f7e6d5c",
        info: TRANSCRIPT_INFO,
        status: CallSummaryStatus.Skipped,
      }),
      transcriptCall({ id: "9a8f7e6d-5c4b-4a3f-9e2d-1c0b9a8f7e6d" }),
    ];

    expect(
      getCallsWithReadings(calls, NOW).map(
        (entry: { call: IncidentVideoCall }): string => {
          return entry.call.id!.toString();
        },
      ),
    ).toEqual([CALL_ID, OTHER_CALL_ID]);
  });

  test("a call's section has an id the Video Call card's Review can scroll to", () => {
    expect(getCallSummarySectionId(CALL_ID)).toBe(`call-summary-${CALL_ID}`);
  });
});

/*
 * Record and transcribe incident calls: while OneUptime gets a call's
 * transcript by itself the card says so, and once it stopped it says why -
 * until the transcript is in, when neither matters any more.
 */
describe("getCallTranscriptView - OneUptime getting the transcript by itself", () => {
  test("a call OneUptime waits on says Waiting", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      transcriptCall({ fetchStatus: CallTranscriptFetchStatus.Waiting }),
      NOW,
    );

    expect(view.hasTranscript).toBe(false);
    expect(view.fetchStatus).toBe(CallTranscriptFetchStatus.Waiting);
    expect(view.fetchReason).toBeNull();
  });

  test("a call OneUptime stopped waiting on keeps the provider's last answer", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      transcriptCall({
        fetchStatus: CallTranscriptFetchStatus.Stopped,
        fetchReason: VideoCallTranscriptUnavailableReason.NotTranscribed,
      }),
      NOW,
    );

    expect(view.fetchStatus).toBe(CallTranscriptFetchStatus.Stopped);
    expect(view.fetchReason).toBe(
      VideoCallTranscriptUnavailableReason.NotTranscribed,
    );
  });

  test("once the transcript is in, nothing is waited for, whatever the columns still say", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      transcriptCall({
        info: TRANSCRIPT_INFO,
        fetchStatus: CallTranscriptFetchStatus.Waiting,
        fetchReason: VideoCallTranscriptUnavailableReason.NotReady,
      }),
      NOW,
    );

    expect(view.hasTranscript).toBe(true);
    expect(view.fetchStatus).toBeNull();
    expect(view.fetchReason).toBeNull();
  });

  test("values a column should never hold are read as nothing", () => {
    const call: IncidentVideoCall = transcriptCall();
    (call as unknown as JSONObject)["transcriptFetchStatus"] = "Paused";
    (call as unknown as JSONObject)["transcriptFetchReason"] = "Unknown";

    const view: CallTranscriptView = getCallTranscriptView(call, NOW);

    expect(view.fetchStatus).toBeNull();
    expect(view.fetchReason).toBeNull();
  });

  test("a call nobody asked about waits for nothing", () => {
    const view: CallTranscriptView = getCallTranscriptView(
      transcriptCall(),
      NOW,
    );

    expect(view.fetchStatus).toBeNull();
    expect(view.fetchReason).toBeNull();
  });
});

describe("looking again while OneUptime waits for a transcript", () => {
  test("only while a call is Waiting and has no transcript yet", () => {
    const waiting: EventVideoCall = transcriptCall({
      fetchStatus: CallTranscriptFetchStatus.Waiting,
    });
    const stopped: EventVideoCall = transcriptCall({
      fetchStatus: CallTranscriptFetchStatus.Stopped,
      fetchReason: VideoCallTranscriptUnavailableReason.Expired,
    });
    const arrived: EventVideoCall = transcriptCall({
      info: TRANSCRIPT_INFO,
      fetchStatus: CallTranscriptFetchStatus.Waiting,
    });

    expect(isAnyCallWaitingForTranscript([suggestedCall(), waiting])).toBe(
      true,
    );
    expect(isAnyCallWaitingForTranscript([stopped])).toBe(false);
    expect(isAnyCallWaitingForTranscript([arrived])).toBe(false);
    expect(isAnyCallWaitingForTranscript([transcriptCall()])).toBe(false);
    expect(isAnyCallWaitingForTranscript([])).toBe(false);
  });

  test("looks again once a minute: a transcript comes minutes after a call", () => {
    expect(CALL_TRANSCRIPT_WAIT_POLL_INTERVAL_MS).toBe(60 * 1000);
  });

  test("an incident's calls are read with where OneUptime stands in getting each transcript", () => {
    expect(INCIDENT_CALL_TRANSCRIPT_SELECT).toMatchObject({
      transcriptFetchStatus: true,
      transcriptFetchReason: true,
    });
  });
});

describe("looking again while OneUptime AI reads", () => {
  test("only while a reading is under way, not once it is stuck, done or never started", () => {
    const reading: EventVideoCall = transcriptCall({
      info: TRANSCRIPT_INFO,
      status: CallSummaryStatus.Pending,
    });
    const stuck: EventVideoCall = transcriptCall({
      info: TRANSCRIPT_INFO,
      status: CallSummaryStatus.Pending,
      statusMinutesAgo: CALL_SUMMARY_STALE_AFTER_MS / 60000 + 1,
    });

    expect(isAnyCallBeingRead([suggestedCall(), reading], NOW)).toBe(true);
    expect(isAnyCallBeingRead([stuck], NOW)).toBe(false);
    expect(isAnyCallBeingRead([suggestedCall(), transcriptCall()], NOW)).toBe(
      false,
    );
    expect(isAnyCallBeingRead([], NOW)).toBe(false);
  });

  test("looks again within seconds", () => {
    expect(CALL_SUMMARY_POLL_INTERVAL_MS).toBeGreaterThanOrEqual(2000);
    expect(CALL_SUMMARY_POLL_INTERVAL_MS).toBeLessThanOrEqual(10000);
  });

  test("an incident's calls are read with their transcript's description and reading, never the transcript", async () => {
    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<ListResult<IncidentVideoCall>> => {
        return { data: [], count: 0, skip: 0, limit: 20 };
      });

    await fetchEventVideoCalls({
      kind: VideoCallEventKind.Incident,
      eventId: new ObjectID(CALL_ID),
    });

    const select: JSONObject = (
      getList.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select).toMatchObject(INCIDENT_CALL_TRANSCRIPT_SELECT);
    expect(select["transcript"]).toBeUndefined();
    expect(select["transcriptAddedByUser"]).toEqual({
      _id: true,
      name: true,
      email: true,
    });
  });

  test("an alert's calls are read as before: they keep no transcript", async () => {
    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<ListResult<IncidentVideoCall>> => {
        return { data: [], count: 0, skip: 0, limit: 20 };
      });

    await fetchEventVideoCalls({
      kind: VideoCallEventKind.Alert,
      eventId: new ObjectID(CALL_ID),
    });

    const select: JSONObject = (
      getList.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    expect(select["transcriptInfo"]).toBeUndefined();
    expect(select["callSummary"]).toBeUndefined();
  });
});

describe("the transcript routes", () => {
  const TENANT: { tenantid: string } = {
    tenantid: "0f1e2d3c-4b5a-4968-8776-655443322110",
  };

  let post: ReturnType<typeof jest.spyOn>;
  let remove: ReturnType<typeof jest.spyOn>;
  let answer: HTTPResponse<JSONObject> | HTTPErrorResponse;

  interface SentRequest {
    url: URL;
    headers: JSONObject;
    data: JSONObject;
  }

  function sent(spy: ReturnType<typeof jest.spyOn>): SentRequest {
    return spy.mock.calls[0]![0] as SentRequest;
  }

  beforeEach(() => {
    answer = new HTTPResponse<JSONObject>(200, {}, {});
    jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue(TENANT as never);
    post = jest.spyOn(API, "post").mockImplementation((async () => {
      return answer;
    }) as never);
    remove = jest.spyOn(API, "delete").mockImplementation((async () => {
      return answer;
    }) as never);
  });

  test("adding a transcript posts its text and file name, with the tenant header", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      { callSummaryStatus: CallSummaryStatus.Pending },
      {},
    );

    const saved: CallTranscriptSaved = await addCallTranscript({
      callId: CALL_ID,
      text: "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Sam>Checkout is slow.",
      fileName: "checkout.vtt",
    });

    const request: SentRequest = sent(post);

    expect(request.url.toString()).toContain(
      `/incident-video-call/${CALL_ID}/transcript`,
    );
    expect(request.headers).toEqual(TENANT);
    expect(request.data).toEqual({
      text: "WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Sam>Checkout is slow.",
      fileName: "checkout.vtt",
    });
    expect(saved).toEqual({
      callSummaryStatus: CallSummaryStatus.Pending,
      callSummaryStatusMessage: undefined,
    });
  });

  test("pasted text has no file name", async () => {
    await addCallTranscript({ callId: CALL_ID, text: "Sam: it is the pool" });

    expect(sent(post).data).toEqual({ text: "Sam: it is the pool" });
  });

  test("a status the route does not send is read as none, and AI being off says why", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      {
        callSummaryStatus: "Thinking",
        callSummaryStatusMessage: "AI features are disabled for this project.",
      },
      {},
    );

    expect(await addCallTranscript({ callId: CALL_ID, text: "x" })).toEqual({
      callSummaryStatus: null,
      callSummaryStatusMessage: "AI features are disabled for this project.",
    });
  });

  test("a refusal is thrown, for the dialog to say", async () => {
    answer = new HTTPErrorResponse(
      400,
      { message: "This transcript has no remarks." },
      {},
    );

    await expect(
      addCallTranscript({ callId: CALL_ID, text: "   " }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("asking the provider: a transcript found was added", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      { added: true, callSummaryStatus: CallSummaryStatus.Pending },
      {},
    );

    const result: CallTranscriptFromProvider =
      await getCallTranscriptFromProvider({ callId: CALL_ID });

    expect(sent(post).url.toString()).toContain(
      `/incident-video-call/${CALL_ID}/transcript/from-provider`,
    );
    expect(result).toEqual({
      added: true,
      callSummaryStatus: CallSummaryStatus.Pending,
      callSummaryStatusMessage: undefined,
    });
  });

  test("asking the provider: none there yet is an answer, with why", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      {
        added: false,
        reason: VideoCallTranscriptUnavailableReason.NotReady,
        message: "Zoom is still preparing this meeting's transcript.",
      },
      {},
    );

    expect(await getCallTranscriptFromProvider({ callId: CALL_ID })).toEqual({
      added: false,
      reason: VideoCallTranscriptUnavailableReason.NotReady,
      message: "Zoom is still preparing this meeting's transcript.",
    });
  });

  test("asking the provider: a reason the dashboard does not know reads as not supported", async () => {
    answer = new HTTPResponse<JSONObject>(
      200,
      { added: false, reason: "Moonphase", message: 42 } as never,
      {},
    );

    expect(await getCallTranscriptFromProvider({ callId: CALL_ID })).toEqual({
      added: false,
      reason: VideoCallTranscriptUnavailableReason.NotSupported,
      message: "",
    });
  });

  test("removing, reading again and deciding each reach their own route", async () => {
    await removeCallTranscript({ callId: CALL_ID });
    await readCallTranscriptAgain({ callId: CALL_ID });
    await reviewCallRootCauseSuggestion({
      callId: CALL_ID,
      decision: RootCauseSuggestionStatus.Accepted,
      rootCause: "The pool size.",
    });
    await reviewCallRootCauseSuggestion({
      callId: CALL_ID,
      decision: RootCauseSuggestionStatus.Dismissed,
    });

    expect(sent(remove).url.toString()).toContain(
      `/incident-video-call/${CALL_ID}/transcript`,
    );
    expect(sent(remove).headers).toEqual(TENANT);

    const posts: Array<SentRequest> = post.mock.calls.map(
      (args: Array<unknown>): SentRequest => {
        return args[0] as SentRequest;
      },
    );

    expect(posts[0]!.url.toString()).toContain(`/${CALL_ID}/call-summary`);
    expect(posts[1]!.url.toString()).toContain(
      `/${CALL_ID}/root-cause-suggestion`,
    );
    expect(posts[1]!.data).toEqual({
      decision: RootCauseSuggestionStatus.Accepted,
      rootCause: "The pool size.",
    });
    expect(posts[2]!.data).toEqual({
      decision: RootCauseSuggestionStatus.Dismissed,
    });
    for (const request of posts) {
      expect(request.headers).toEqual(TENANT);
    }
  });

  test("a refused decision is thrown", async () => {
    answer = new HTTPErrorResponse(
      403,
      { message: "You do not have permission to edit this incident." },
      {},
    );

    await expect(
      reviewCallRootCauseSuggestion({
        callId: CALL_ID,
        decision: RootCauseSuggestionStatus.Dismissed,
      }),
    ).rejects.toBeInstanceOf(HTTPErrorResponse);
  });

  test("the docs section on call transcripts is on the Video Calls page", () => {
    expect(CALL_TRANSCRIPTS_DOCS_PATH).toBe(
      "/docs/workspace-connections/video-calls#call-transcripts",
    );
  });
});
