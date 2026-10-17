import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * AN INCIDENT CALL'S TRANSCRIPT ON THE VIDEO CALL CARD (issue #4875).
 *
 * Under the call: without a transcript, what one is for and how to get it -
 * Get from Zoom for a meeting OneUptime started there, Add transcript for
 * any call; with one, how long it is, where it came from, View, and where
 * OneUptime AI's reading of it stands, each state with its one action. What
 * a provider says when it has no transcript is an answer, said with what to
 * do. Nothing here can be pressed without permission to work on the
 * incident's calls, and an alert's calls keep no transcript.
 */

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import EventVideoCallsCard from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/EventVideoCallsCard";
import {
  EventVideoCall,
  VideoCallEventKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/useEventVideoCalls";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import AlertVideoCall from "../../../Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
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
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import {
  CALL_ID,
  OTHER_CALL_ID,
  TRANSCRIPT_INFO,
  notEnoughSummary,
  storedTranscript,
  suggestedCall,
  transcriptCall,
} from "./CallTranscriptFixtures";

const EVENT_ID: ObjectID = new ObjectID("2c1b0a9f-8e7d-4c6b-9a5f-4e3d2c1b0a9f");

let allowed: Record<ModelAction, boolean>;
let post: ReturnType<typeof jest.spyOn>;
let remove: ReturnType<typeof jest.spyOn>;
let postAnswer: (url: string) => HTTPResponse<JSONObject> | HTTPErrorResponse;

interface SentRequest {
  url: { toString: () => string };
  data: JSONObject;
}

function postedUrls(): Array<string> {
  return post.mock.calls.map((args: Array<unknown>): string => {
    return (args[0] as SentRequest).url.toString();
  });
}

function renderCard(data: {
  calls: Array<EventVideoCall>;
  kind?: VideoCallEventKind;
}): { onChanged: MockFunction; onReview: MockFunction } {
  const onChanged: MockFunction = getJestMockFunction();
  const onReview: MockFunction = getJestMockFunction();

  render(
    <MemoryRouter>
      <EventVideoCallsCard
        kind={data.kind || VideoCallEventKind.Incident}
        eventId={EVENT_ID}
        calls={data.calls}
        hasLoaded={true}
        onChanged={() => {
          onChanged();
        }}
        onRetry={() => {}}
        onReviewCallSummary={(callId: string) => {
          onReview(callId);
        }}
      />
    </MemoryRouter>,
  );

  return { onChanged, onReview };
}

function block(): HTMLElement {
  return screen.getAllByTestId("call-transcript-block")[0]!;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/incidents/${EVENT_ID.toString()}`);
  ConnectedWorkspaces.reset();

  allowed = {
    [ModelAction.Create]: true,
    [ModelAction.Read]: true,
    [ModelAction.Update]: true,
    [ModelAction.Delete]: true,
  } as Record<ModelAction, boolean>;

  jest
    .spyOn(PermissionGate, "check")
    .mockImplementation(
      (_model: unknown, action: ModelAction): PermissionGateResult => {
        return allowed[action]
          ? { isAllowed: true }
          : {
              isAllowed: false,
              disabledReason: "You need permission to do this.",
            };
      },
    );

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<never>> => {
      return { data: [], count: 0, skip: 0, limit: 100 };
    });

  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({
    tenantid: PROJECT_ID,
  } as never);

  postAnswer = (): HTTPResponse<JSONObject> => {
    return new HTTPResponse<JSONObject>(200, {}, {});
  };

  post = jest.spyOn(API, "post").mockImplementation((async (request: {
    url: { toString: () => string };
  }) => {
    return postAnswer(request.url.toString());
  }) as never);

  remove = jest.spyOn(API, "delete").mockImplementation((async () => {
    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  ConnectedWorkspaces.reset();
});

describe("a call without a transcript", () => {
  test("says what a transcript is for, and offers Get from Zoom and Add transcript", () => {
    renderCard({ calls: [transcriptCall()] });

    expect(
      within(block()).getByText(
        "Add it after the call: OneUptime AI reads it and suggests the root cause, for you to review.",
      ),
    ).toBeVisible();
    expect(screen.getByTestId("call-transcript-get")).toHaveTextContent(
      "Get from Zoom",
    );
    expect(screen.getByTestId("call-transcript-add")).toHaveTextContent(
      "Add transcript",
    );
  });

  test("a Google Meet meeting is asked of Google Meet", () => {
    renderCard({
      calls: [transcriptCall({ provider: VideoCallProvider.GoogleMeet })],
    });

    expect(screen.getByTestId("call-transcript-get")).toHaveTextContent(
      "Get from Google Meet",
    );
  });

  test("a Microsoft Teams meeting offers Add transcript only: Microsoft lets no app read it", () => {
    renderCard({
      calls: [transcriptCall({ provider: VideoCallProvider.MicrosoftTeams })],
    });

    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.getByTestId("call-transcript-add")).toBeVisible();
  });

  test("without permission to work on the incident's calls, offers nothing to press", () => {
    allowed[ModelAction.Create] = false;

    renderCard({ calls: [transcriptCall()] });

    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.queryByTestId("call-transcript-add")).toBeNull();
  });

  test("an alert's call keeps no transcript", () => {
    const call: AlertVideoCall = new AlertVideoCall();
    call.id = new ObjectID(CALL_ID);
    call.provider = VideoCallProvider.Zoom;
    call.joinUrl = "https://example.zoom.us/j/81234567890";
    call.createdAt = new Date();

    renderCard({ calls: [call], kind: VideoCallEventKind.Alert });

    expect(screen.getByTestId("event-video-call")).toBeVisible();
    expect(screen.queryByTestId("call-transcript-block")).toBeNull();
  });
});

describe("Get from Zoom", () => {
  test("a transcript found is added, and the page reads the calls again", async () => {
    postAnswer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        { added: true, callSummaryStatus: CallSummaryStatus.Pending },
        {},
      );
    };

    const { onChanged } = renderCard({ calls: [transcriptCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-get"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(postedUrls()[0]).toContain(
      `/incident-video-call/${CALL_ID}/transcript/from-provider`,
    );
    expect(screen.queryByTestId("call-transcript-outcome")).toBeNull();
  });

  test("not there yet is an answer, said as Zoom said it, and can be put away", async () => {
    postAnswer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          added: false,
          reason: VideoCallTranscriptUnavailableReason.NotReady,
          message:
            "Zoom is still preparing this meeting's transcript. Try again later.",
        },
        {},
      );
    };

    const { onChanged } = renderCard({ calls: [transcriptCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-get"));

    const outcome: HTMLElement = await screen.findByTestId(
      "call-transcript-outcome",
    );

    expect(outcome).toHaveAttribute("data-reason", "NotReady");
    expect(outcome).toHaveTextContent(
      "Zoom is still preparing this meeting's transcript. Try again later.",
    );
    // Nothing to set up: waiting is the answer.
    expect(within(outcome).queryByTestId("call-transcript-set-up-docs")).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();

    fireEvent.click(within(outcome).getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByTestId("call-transcript-outcome")).toBeNull();
  });

  test("a scope the connection lacks: says which, with the docs on setting it up in a new tab", async () => {
    postAnswer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          added: false,
          reason: VideoCallTranscriptUnavailableReason.PermissionMissing,
          message:
            "This connection's Zoom app cannot read transcripts. Add cloud_recording:read:list_recording_files:admin.",
        },
        {},
      );
    };

    renderCard({ calls: [transcriptCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-get"));

    const outcome: HTMLElement = await screen.findByTestId(
      "call-transcript-outcome",
    );

    // The scope may break after each colon, and reads whole.
    expect(outcome).toHaveTextContent(
      "This connection's Zoom app cannot read transcripts. Add cloud_recording:read:list_recording_files:admin.",
    );
    expect(outcome.querySelectorAll("wbr").length).toBeGreaterThanOrEqual(3);

    const docs: HTMLElement = within(outcome).getByTestId(
      "call-transcript-set-up-docs",
    );

    expect(docs).toHaveTextContent("How to set it up");
    expect(docs.getAttribute("href")).toMatch(
      /\/workspace-connections\/video-calls#call-transcripts$/,
    );
    expect(docs).toHaveAttribute("target", "_blank");
    expect(docs).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("a call nobody transcribed points to how to turn it on", async () => {
    postAnswer = (): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(
        200,
        {
          added: false,
          reason: VideoCallTranscriptUnavailableReason.NotTranscribed,
          message: "Zoom has no transcript of this meeting.",
        },
        {},
      );
    };

    renderCard({ calls: [transcriptCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-get"));

    expect(
      await screen.findByTestId("call-transcript-set-up-docs"),
    ).toBeVisible();
  });

  test("a request that fails is said as an error", async () => {
    postAnswer = (): HTTPErrorResponse => {
      return new HTTPErrorResponse(
        502,
        { message: "Zoom did not answer in time." },
        {},
      );
    };

    renderCard({ calls: [transcriptCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-get"));

    const outcome: HTMLElement = await screen.findByTestId(
      "call-transcript-outcome",
    );

    expect(outcome).toHaveAttribute("data-reason", "error");
    expect(outcome).toHaveTextContent("Zoom did not answer in time.");
  });
});

describe("a call with a transcript", () => {
  test("says how long it is and where it came from, with View", () => {
    renderCard({
      calls: [transcriptCall({ info: TRANSCRIPT_INFO, addedMinutesAgo: 5 })],
    });

    const facts: HTMLElement = screen.getByTestId("call-transcript-facts");

    expect(facts).toHaveTextContent("11 minutes · 3 speakers · Read from Zoom");
    expect(screen.getByTestId("call-transcript-view")).toBeVisible();
    // It has one: nothing offers to get or add another but the menu.
    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.queryByTestId("call-transcript-add")).toBeNull();
  });

  test("a transcript a person added says who added it", () => {
    renderCard({
      calls: [
        transcriptCall({
          provider: VideoCallProvider.MicrosoftTeams,
          info: TRANSCRIPT_INFO,
          source: VideoCallTranscriptSource.Upload,
          addedBy: "Priya Shah",
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-facts")).toHaveTextContent(
      "Added by Priya Shah",
    );
  });

  test("a short call without speakers is told in remarks", () => {
    renderCard({
      calls: [
        transcriptCall({
          info: { lineCount: 4, speakerCount: 0, characterCount: 120 },
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-facts")).toHaveTextContent(
      "4 remarks",
    );
  });

  test("View reads the transcript when the dialog opens: the list of calls never carries it", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getItem")
      .mockImplementation(async (): Promise<IncidentVideoCall> => {
        const call: IncidentVideoCall = new IncidentVideoCall();
        call.id = new ObjectID(CALL_ID);
        call.transcript = storedTranscript();
        return call;
      });

    renderCard({ calls: [transcriptCall({ info: TRANSCRIPT_INFO })] });

    fireEvent.click(screen.getByTestId("call-transcript-view"));

    const lines: HTMLElement = await screen.findByTestId(
      "call-transcript-lines",
    );

    expect(within(lines).getAllByTestId("call-transcript-line")).toHaveLength(
      12,
    );
    expect(getItem.mock.calls[0]![0]).toMatchObject({
      modelType: IncidentVideoCall,
      select: { _id: true, transcript: true },
    });
    expect(screen.getByText("Transcript of the Zoom meeting")).toBeVisible();
  });
});

describe("where OneUptime AI's reading stands", () => {
  test("while it reads, says so", () => {
    renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Pending,
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-reading")).toHaveTextContent(
      "OneUptime AI is reading it…",
    );
  });

  test("a suggestion waiting for somebody: Review opens it on the AI Investigation card", () => {
    const { onReview } = renderCard({ calls: [suggestedCall()] });

    const read: HTMLElement = screen.getByTestId("call-transcript-read");

    expect(read).toHaveTextContent(
      "OneUptime AI suggested a root cause for you to review.",
    );

    fireEvent.click(within(read).getByTestId("call-transcript-review"));

    expect(onReview).toHaveBeenCalledWith(CALL_ID);
  });

  test("a suggestion used, or dismissed, says so, with See what it found", () => {
    renderCard({
      calls: [
        suggestedCall({ suggestion: RootCauseSuggestionStatus.Accepted }),
        suggestedCall({
          id: OTHER_CALL_ID,
          suggestion: RootCauseSuggestionStatus.Dismissed,
          createdMinutesAgo: 90,
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-read")).toHaveTextContent(
      "Used as the incident's root cause.",
    );
    expect(screen.getAllByTestId("call-transcript-review")[0]).toHaveTextContent(
      "See what it found",
    );
  });

  test("a call that did not settle the cause says so", () => {
    renderCard({ calls: [suggestedCall({ summary: notEnoughSummary() })] });

    expect(screen.getByTestId("call-transcript-read")).toHaveTextContent(
      "OneUptime AI read it: not enough was said to suggest a root cause.",
    );
  });

  test("a reading that failed says why, and Try again reads it again", async () => {
    const { onChanged } = renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Failed,
          statusMessage: "This project reached its daily AI token limit.",
        }),
      ],
    });

    const failed: HTMLElement = screen.getByTestId("call-transcript-read-failed");

    expect(failed).toHaveTextContent(
      "OneUptime AI could not read it. This project reached its daily AI token limit.",
    );

    fireEvent.click(within(failed).getByTestId("call-transcript-read-again"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(postedUrls()).toEqual([
      expect.stringContaining(`/incident-video-call/${CALL_ID}/call-summary`),
    ]);
  });

  test("a reading that stopped part-way is offered again", () => {
    renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Pending,
          statusMinutesAgo: 30,
        }),
      ],
    });

    const failed: HTMLElement = screen.getByTestId("call-transcript-read-failed");

    expect(failed).toHaveTextContent("OneUptime AI took too long to read it.");
    expect(within(failed).getByTestId("call-transcript-read-again")).toBeVisible();
  });

  test("without permission, a failed reading is said without Try again", () => {
    allowed[ModelAction.Create] = false;

    renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Failed,
          statusMessage: "The AI provider refused the request.",
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-read-failed")).toBeVisible();
    expect(screen.queryByTestId("call-transcript-read-again")).toBeNull();
  });

  test("AI being off is said as the server said it", () => {
    renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Skipped,
          statusMessage: "AI features are disabled for this project.",
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-read-skipped")).toHaveTextContent(
      "AI features are disabled for this project.",
    );
  });
});

describe("the transcript's menu", () => {
  test("Replace transcript opens the dialog, saying it replaces the one there", () => {
    renderCard({ calls: [suggestedCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-menu-button"));
    fireEvent.click(screen.getByTestId("call-transcript-replace"));

    expect(screen.getByText("Replace the call's transcript")).toBeVisible();
    expect(
      screen.getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Replace transcript");
  });

  test("Read it again is offered once a reading finished, not while one runs", async () => {
    const { onChanged } = renderCard({ calls: [suggestedCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-menu-button"));
    fireEvent.click(screen.getByTestId("call-transcript-menu-read-again"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(postedUrls()[0]).toContain(`/${CALL_ID}/call-summary`);

    cleanup();

    renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Pending,
        }),
      ],
    });

    fireEvent.click(screen.getByTestId("call-transcript-menu-button"));

    expect(screen.queryByTestId("call-transcript-menu-read-again")).toBeNull();
    expect(screen.getByTestId("call-transcript-remove")).toBeVisible();
  });

  test("Remove asks first, keeps the incident's root cause, then removes it", async () => {
    const { onChanged } = renderCard({ calls: [suggestedCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-menu-button"));
    fireEvent.click(screen.getByTestId("call-transcript-remove"));

    expect(screen.getByText("Remove the transcript?")).toBeVisible();
    expect(
      screen.getByText(
        "The transcript of the Zoom meeting and what OneUptime AI read in it are removed from this incident. The incident's root cause is kept.",
      ),
    ).toBeVisible();
    expect(remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(
      (remove.mock.calls[0]![0] as SentRequest).url.toString(),
    ).toContain(`/incident-video-call/${CALL_ID}/transcript`);
  });

  test("is not there without permission to work on the incident's calls", () => {
    allowed[ModelAction.Create] = false;

    renderCard({ calls: [suggestedCall()] });

    expect(screen.queryByTestId("call-transcript-menu-button")).toBeNull();
    // Reading it is still allowed.
    expect(screen.getByTestId("call-transcript-view")).toBeVisible();
  });
});

describe("an earlier call", () => {
  test("keeps its transcript on one line, with View and See what it found", () => {
    renderCard({
      calls: [
        transcriptCall({ id: OTHER_CALL_ID, createdMinutesAgo: 5 }),
        suggestedCall({
          suggestion: RootCauseSuggestionStatus.Accepted,
          createdMinutesAgo: 90,
        }),
      ],
    });

    const rows: Array<HTMLElement> = screen.getAllByTestId("event-video-call");
    const earlier: HTMLElement = rows[1]!;

    expect(within(earlier).getByText(/Transcript · 11 minutes · 3 speakers/)).toBeVisible();
    expect(within(earlier).getByTestId("call-transcript-view")).toBeVisible();
    expect(within(earlier).getByTestId("call-transcript-review")).toHaveTextContent(
      "See what it found",
    );
  });

  test("without one, offers to get or add it as links", () => {
    renderCard({
      calls: [
        suggestedCall({ createdMinutesAgo: 5 }),
        transcriptCall({ id: OTHER_CALL_ID, createdMinutesAgo: 90 }),
      ],
    });

    const earlier: HTMLElement = screen.getAllByTestId("event-video-call")[1]!;

    expect(within(earlier).getByTestId("call-transcript-get")).toHaveTextContent(
      "Get from Zoom",
    );
    expect(within(earlier).getByTestId("call-transcript-add")).toHaveTextContent(
      "Add transcript",
    );
  });
});
