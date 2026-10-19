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
import { getTranscriptUnavailableHeadline } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/CallTranscriptBlock";
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
import { CallTranscriptFetchStatus } from "../../../Types/VideoCall/CallTranscriptAutoFetch";
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

  test("a Microsoft Teams meeting not on a calendar offers Add transcript only: Microsoft lets no app read it", () => {
    renderCard({
      calls: [transcriptCall({ provider: VideoCallProvider.MicrosoftTeams })],
    });

    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.getByTestId("call-transcript-add")).toBeVisible();
  });

  test("a Microsoft Teams meeting OneUptime put on a calendar is asked of Microsoft Teams", () => {
    renderCard({
      calls: [
        transcriptCall({
          provider: VideoCallProvider.MicrosoftTeams,
          onCalendar: true,
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-get")).toHaveTextContent(
      "Get from Microsoft Teams",
    );
    expect(screen.getByTestId("call-transcript-add")).toBeVisible();
  });

  test("without permission to work on the incident's calls, offers nothing to press", () => {
    allowed[ModelAction.Create] = false;

    renderCard({ calls: [transcriptCall()] });

    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.queryByTestId("call-transcript-add")).toBeNull();
    // Nor a word on adding one they cannot add: no transcript block at all.
    expect(screen.queryByTestId("call-transcript-block")).toBeNull();
    expect(
      screen.queryByText(
        "Add it after the call: OneUptime AI reads it and suggests the root cause, for you to review.",
      ),
    ).toBeNull();
    // The call itself is still there to join.
    expect(screen.getByTestId("event-video-call-join")).toBeVisible();
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

/*
 * Record and transcribe incident calls: OneUptime gets the transcript by
 * itself once the call is over. Until then the card says so - to everyone
 * who reads the incident - and keeps Get and Add for whoever may use them;
 * once it stopped waiting, the provider's last answer says why.
 */
describe("a call OneUptime gets the transcript of by itself", () => {
  test("while it waits, says OneUptime gets it from Zoom once the call is over, and keeps Get and Add", () => {
    renderCard({
      calls: [
        transcriptCall({ fetchStatus: CallTranscriptFetchStatus.Waiting }),
      ],
    });

    expect(screen.getByTestId("call-transcript-waiting")).toHaveTextContent(
      "OneUptime gets it from Zoom once the call is over, and OneUptime AI reads it.",
    );
    expect(
      within(block()).queryByText(
        "Add it after the call: OneUptime AI reads it and suggests the root cause, for you to review.",
      ),
    ).toBeNull();
    expect(screen.getByTestId("call-transcript-get")).toBeVisible();
    expect(screen.getByTestId("call-transcript-add")).toBeVisible();
  });

  test("a Google Meet call waits on Google Meet", () => {
    renderCard({
      calls: [
        transcriptCall({
          provider: VideoCallProvider.GoogleMeet,
          fetchStatus: CallTranscriptFetchStatus.Waiting,
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-waiting")).toHaveTextContent(
      "OneUptime gets it from Google Meet once the call is over",
    );
  });

  test("a Microsoft Teams call on a calendar waits on Microsoft Teams", () => {
    renderCard({
      calls: [
        transcriptCall({
          provider: VideoCallProvider.MicrosoftTeams,
          onCalendar: true,
          fetchStatus: CallTranscriptFetchStatus.Waiting,
        }),
      ],
    });

    expect(screen.getByTestId("call-transcript-waiting")).toHaveTextContent(
      "OneUptime gets it from Microsoft Teams once the call is over, and OneUptime AI reads it.",
    );
    expect(screen.getByTestId("call-transcript-get")).toHaveTextContent(
      "Get from Microsoft Teams",
    );
  });

  /*
   * A Teams call OneUptime could not put on its organizer's calendar - a
   * permission the connection does not have - started all the same,
   * unrecorded, and was stopped from the start with why.
   */
  test("a Microsoft Teams call that could not be set up to record says the connection is not allowed yet, with how to set it up, and Add transcript", () => {
    renderCard({
      calls: [
        transcriptCall({
          provider: VideoCallProvider.MicrosoftTeams,
          fetchStatus: CallTranscriptFetchStatus.Stopped,
          fetchReason: VideoCallTranscriptUnavailableReason.PermissionMissing,
        }),
      ],
    });

    const stopped: HTMLElement = screen.getByTestId(
      "call-transcript-fetch-stopped",
    );

    expect(stopped).toHaveAttribute(
      "data-reason",
      VideoCallTranscriptUnavailableReason.PermissionMissing,
    );
    expect(stopped).toHaveTextContent(
      "The Microsoft Teams connection is not allowed to read transcripts yet.",
    );
    expect(
      within(stopped).getByTestId("call-transcript-fetch-set-up-docs"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/docs/workspace-connections/video-calls#call-transcripts"),
    );
    expect(screen.queryByTestId("call-transcript-waiting")).toBeNull();
    // Never on a calendar: nothing to get, so it is added by hand.
    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.getByTestId("call-transcript-add")).toBeVisible();
  });

  test("a reader who may not add transcripts still sees that it is on its way, with nothing to press", () => {
    allowed[ModelAction.Create] = false;

    renderCard({
      calls: [
        transcriptCall({ fetchStatus: CallTranscriptFetchStatus.Waiting }),
      ],
    });

    expect(screen.getByTestId("call-transcript-block")).toBeVisible();
    expect(screen.getByTestId("call-transcript-waiting")).toBeVisible();
    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.queryByTestId("call-transcript-add")).toBeNull();
  });

  test("once it stopped, says why in the card's own words, with how to set it up where setting up is the fix", () => {
    renderCard({
      calls: [
        transcriptCall({
          fetchStatus: CallTranscriptFetchStatus.Stopped,
          fetchReason: VideoCallTranscriptUnavailableReason.NotTranscribed,
        }),
      ],
    });

    const stopped: HTMLElement = screen.getByTestId(
      "call-transcript-fetch-stopped",
    );

    expect(stopped).toHaveAttribute(
      "data-reason",
      VideoCallTranscriptUnavailableReason.NotTranscribed,
    );
    expect(stopped).toHaveTextContent(
      getTranscriptUnavailableHeadline(
        VideoCallTranscriptUnavailableReason.NotTranscribed,
      ).replace("{{provider}}", "Zoom"),
    );
    expect(
      within(stopped).getByTestId("call-transcript-fetch-set-up-docs"),
    ).toHaveAttribute("target", "_blank");
    expect(screen.queryByTestId("call-transcript-waiting")).toBeNull();
    // Get and Add are still there to try again or add it by hand.
    expect(screen.getByTestId("call-transcript-get")).toBeVisible();
    expect(screen.getByTestId("call-transcript-add")).toBeVisible();
  });

  test("an answer setting up does not fix has no set-up link", () => {
    renderCard({
      calls: [
        transcriptCall({
          fetchStatus: CallTranscriptFetchStatus.Stopped,
          fetchReason: VideoCallTranscriptUnavailableReason.Expired,
        }),
      ],
    });

    expect(
      screen.getByTestId("call-transcript-fetch-stopped"),
    ).toHaveTextContent(
      getTranscriptUnavailableHeadline(
        VideoCallTranscriptUnavailableReason.Expired,
      ).replace("{{provider}}", "Zoom"),
    );
    expect(
      screen.queryByTestId("call-transcript-fetch-set-up-docs"),
    ).toBeNull();
  });

  test("a stop with no answer to give says what a transcript is for, as before", () => {
    renderCard({
      calls: [
        transcriptCall({ fetchStatus: CallTranscriptFetchStatus.Stopped }),
      ],
    });

    expect(screen.queryByTestId("call-transcript-fetch-stopped")).toBeNull();
    expect(
      within(block()).getByText(
        "Add it after the call: OneUptime AI reads it and suggests the root cause, for you to review.",
      ),
    ).toBeVisible();
  });

  test("a reader who may not act on a stop sees no block: there is nothing to do", () => {
    allowed[ModelAction.Create] = false;

    renderCard({
      calls: [
        transcriptCall({
          fetchStatus: CallTranscriptFetchStatus.Stopped,
          fetchReason: VideoCallTranscriptUnavailableReason.NotTranscribed,
        }),
      ],
    });

    expect(screen.queryByTestId("call-transcript-block")).toBeNull();
  });

  test("once the transcript is in, the card is about the transcript, not the waiting", () => {
    renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          fetchStatus: CallTranscriptFetchStatus.Waiting,
        }),
      ],
    });

    expect(screen.queryByTestId("call-transcript-waiting")).toBeNull();
    expect(screen.getByTestId("call-transcript-view")).toBeVisible();
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

  test("not there yet is an answer, in the card's own words, with Zoom's behind Show details, and can be put away", async () => {
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
    // One short sentence of the card's own, looked up in the reader's language.
    expect(
      within(outcome).getByTestId("call-transcript-outcome-headline"),
    ).toHaveTextContent(
      "Zoom is still preparing this meeting's transcript. Try again in a few minutes.",
    );
    // Nothing to set up: waiting is the answer.
    expect(
      within(outcome).queryByTestId("call-transcript-set-up-docs"),
    ).toBeNull();
    expect(onChanged).not.toHaveBeenCalled();

    // What Zoom said is there for whoever wants it, and only then.
    const toggle: HTMLElement = within(outcome).getByTestId(
      "call-transcript-outcome-details-toggle",
    );

    expect(toggle).toHaveTextContent("Show details");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(
      within(outcome).queryByTestId("call-transcript-outcome-details"),
    ).toBeNull();

    fireEvent.click(toggle);

    expect(toggle).toHaveTextContent("Hide details");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const details: HTMLElement = within(outcome).getByTestId(
      "call-transcript-outcome-details",
    );

    expect(toggle).toHaveAttribute("aria-controls", details.id);
    expect(details).toHaveTextContent(
      "Zoom is still preparing this meeting's transcript. Try again later.",
    );

    fireEvent.click(within(outcome).getByRole("button", { name: "Dismiss" }));

    expect(screen.queryByTestId("call-transcript-outcome")).toBeNull();
  });

  test("a scope the connection lacks: says so in a sentence, with the docs on setting it up in a new tab and the scopes behind Show details", async () => {
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

    // No scope names on the card: a sentence anyone on the incident can read.
    expect(
      within(outcome).getByTestId("call-transcript-outcome-headline"),
    ).toHaveTextContent(
      /^The Zoom connection is not allowed to read transcripts yet\.$/,
    );
    expect(outcome).not.toHaveTextContent("cloud_recording");

    fireEvent.click(
      within(outcome).getByTestId("call-transcript-outcome-details-toggle"),
    );

    // For whoever sets the connection up: the scope, which may break after each colon.
    const details: HTMLElement = within(outcome).getByTestId(
      "call-transcript-outcome-details",
    );

    expect(details).toHaveTextContent(
      "This connection's Zoom app cannot read transcripts. Add cloud_recording:read:list_recording_files:admin.",
    );
    expect(details.querySelectorAll("wbr").length).toBeGreaterThanOrEqual(3);

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
    // An error is said whole: there is nothing more behind it.
    expect(
      within(outcome).queryByTestId("call-transcript-outcome-details-toggle"),
    ).toBeNull();
  });

  test.each<[VideoCallTranscriptUnavailableReason, string, boolean]>([
    [
      VideoCallTranscriptUnavailableReason.NotReady,
      "Zoom is still preparing this meeting's transcript. Try again in a few minutes.",
      false,
    ],
    [
      VideoCallTranscriptUnavailableReason.NotTranscribed,
      "Zoom kept no transcript of this meeting. Add it yourself, or turn transcripts on for the next call.",
      true,
    ],
    [
      VideoCallTranscriptUnavailableReason.NoMeeting,
      "Zoom has no record of this meeting. If the call just ended, try again in a few minutes.",
      false,
    ],
    [
      VideoCallTranscriptUnavailableReason.Expired,
      "Zoom no longer keeps this meeting's transcript. If you saved a copy, add it yourself.",
      false,
    ],
    [
      VideoCallTranscriptUnavailableReason.PermissionMissing,
      "The Zoom connection is not allowed to read transcripts yet.",
      true,
    ],
    [
      VideoCallTranscriptUnavailableReason.ConnectionProblem,
      "The Zoom connection stopped working. Reconnect it in Project Settings > Workspace > Video Calls.",
      false,
    ],
    [
      VideoCallTranscriptUnavailableReason.NotSupported,
      "OneUptime cannot ask Zoom for this meeting's transcript. Add it yourself.",
      false,
    ],
  ])(
    "%s is said in one sentence of the card's own",
    async (
      reason: VideoCallTranscriptUnavailableReason,
      headline: string,
      hasSetUpDocs: boolean,
    ) => {
      postAnswer = (): HTTPResponse<JSONObject> => {
        return new HTTPResponse<JSONObject>(
          200,
          { added: false, reason, message: "What Zoom answered." },
          {},
        );
      };

      renderCard({ calls: [transcriptCall()] });

      fireEvent.click(screen.getByTestId("call-transcript-get"));

      const outcome: HTMLElement = await screen.findByTestId(
        "call-transcript-outcome",
      );

      expect(outcome).toHaveAttribute("data-reason", reason);
      expect(
        within(outcome).getByTestId("call-transcript-outcome-headline"),
      ).toHaveTextContent(headline);
      expect(
        Boolean(within(outcome).queryByTestId("call-transcript-set-up-docs")),
      ).toBe(hasSetUpDocs);
      expect(
        within(outcome).queryByTestId("call-transcript-outcome-details"),
      ).toBeNull();
    },
  );

  test("each answer's sentence is in the reader's language: every reason has one of its own", () => {
    const headlines: Array<string> = Object.values(
      VideoCallTranscriptUnavailableReason,
    ).map((reason: VideoCallTranscriptUnavailableReason): string => {
      return getTranscriptUnavailableHeadline(reason);
    });

    // A template naming the provider, and no two alike.
    for (const headline of headlines) {
      expect(headline).toContain("{{provider}}");
    }

    expect(new Set(headlines).size).toBe(headlines.length);
  });
});

describe("a call with a transcript", () => {
  test("says how long it is and where it came from, with View transcript", () => {
    renderCard({
      calls: [transcriptCall({ info: TRANSCRIPT_INFO, addedMinutesAgo: 5 })],
    });

    const facts: HTMLElement = screen.getByTestId("call-transcript-facts");

    expect(facts).toHaveTextContent(
      "11 minutes · 3 speakers · Read from Zoom 5 minutes ago",
    );
    expect(screen.getByTestId("call-transcript-view")).toHaveTextContent(
      "View transcript",
    );
    // It has one: nothing offers to get or add another but the menu.
    expect(screen.queryByTestId("call-transcript-get")).toBeNull();
    expect(screen.queryByTestId("call-transcript-add")).toBeNull();
  });

  test("the word Transcript shares its line with the menu's mark only: View transcript sits under what is said about it", () => {
    renderCard({ calls: [suggestedCall()] });

    const heading: HTMLElement = screen.getByTestId("call-transcript-heading");
    const facts: HTMLElement = screen.getByTestId("call-transcript-facts");
    const read: HTMLElement = screen.getByTestId("call-transcript-read");
    const actions: HTMLElement = screen.getByTestId("call-transcript-actions");

    /*
     * In the page's narrow column, "Transkription" beside two buttons was
     * cut to "Tran…": only the menu's narrow mark shares the heading's line
     * now, and the heading is never truncated.
     */
    expect(heading).toHaveTextContent(/^Transcript$/);
    expect(heading).not.toHaveClass("truncate");

    const headingLine: HTMLElement = heading.parentElement!;

    expect(
      within(headingLine).getByTestId("call-transcript-menu-button"),
    ).toBeVisible();
    expect(
      within(headingLine).queryByTestId("call-transcript-view"),
    ).toBeNull();

    // View transcript has a row of its own.
    expect(
      within(actions).getByTestId("call-transcript-view"),
    ).toHaveTextContent("View transcript");
    expect(within(actions).getAllByRole("button")).toHaveLength(1);

    // Read top to bottom: the heading, its facts, the reading, what to do.
    const order: Array<HTMLElement> = [heading, facts, read, actions];

    for (let index: number = 1; index < order.length; index++) {
      expect(
        order[index - 1]!.compareDocumentPosition(order[index]!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  test("without a transcript, the same heading opens the block, then what it is for, then the buttons", () => {
    renderCard({ calls: [transcriptCall()] });

    const block: HTMLElement = screen.getByTestId("call-transcript-block");

    expect(
      within(block).getByTestId("call-transcript-heading"),
    ).toHaveTextContent(/^Transcript$/);
    expect(within(block).queryByTestId("call-transcript-actions")).toBeNull();
    expect(within(block).getByTestId("call-transcript-get")).toBeVisible();
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

    // The sentence and its action, read as one: "... a root cause. Review it"
    expect(read).toHaveTextContent(
      /^OneUptime AI suggested a root cause\. Review it$/,
    );

    const review: HTMLElement = within(read).getByTestId(
      "call-transcript-review",
    );

    // In the sentence's own line, never on a line of its own under the mark.
    expect(review.closest("p")).toBe(read.querySelector("p"));

    fireEvent.click(review);

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
    expect(
      screen.getAllByTestId("call-transcript-review")[0],
    ).toHaveTextContent("See what it found");
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

    const failed: HTMLElement = screen.getByTestId(
      "call-transcript-read-failed",
    );

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

    const failed: HTMLElement = screen.getByTestId(
      "call-transcript-read-failed",
    );

    expect(failed).toHaveTextContent("OneUptime AI took too long to read it.");
    expect(
      within(failed).getByTestId("call-transcript-read-again"),
    ).toBeVisible();
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

  test("AI being off is said in the reader's language, with the page that turns it on", () => {
    renderCard({
      calls: [
        transcriptCall({
          info: TRANSCRIPT_INFO,
          status: CallSummaryStatus.Skipped,
          statusMessage:
            "AI features are disabled for this project. Enable them in Project Settings → AI → AI Features.",
        }),
      ],
    });

    const skipped: HTMLElement = screen.getByTestId(
      "call-transcript-read-skipped",
    );

    // The server's English sentence is not shown: Skipped means AI is off.
    expect(skipped).toHaveTextContent(
      /^AI is off for this project, so OneUptime AI did not read it\. Open AI Features$/,
    );

    const settings: HTMLElement = within(skipped).getByTestId(
      "call-transcript-ai-settings",
    );

    expect(settings.getAttribute("href")).toContain(
      `/dashboard/${PROJECT_ID}/settings/ai-features`,
    );
  });
});

describe("the transcript's menu", () => {
  test("Replace transcript opens the dialog, saying it replaces the one there", () => {
    renderCard({ calls: [suggestedCall()] });

    fireEvent.click(screen.getByTestId("call-transcript-menu-button"));
    fireEvent.click(screen.getByTestId("call-transcript-replace"));

    expect(screen.getByText("Replace the call's transcript")).toBeVisible();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "Replace transcript",
    );
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
    expect((remove.mock.calls[0]![0] as SentRequest).url.toString()).toContain(
      `/incident-video-call/${CALL_ID}/transcript`,
    );
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

    expect(
      within(earlier).getByText(/Transcript · 11 minutes · 3 speakers/),
    ).toBeVisible();
    expect(within(earlier).getByTestId("call-transcript-view")).toBeVisible();
    expect(
      within(earlier).getByTestId("call-transcript-review"),
    ).toHaveTextContent("See what it found");
  });

  test("without one, offers to get or add it as links", () => {
    renderCard({
      calls: [
        suggestedCall({ createdMinutesAgo: 5 }),
        transcriptCall({ id: OTHER_CALL_ID, createdMinutesAgo: 90 }),
      ],
    });

    const earlier: HTMLElement = screen.getAllByTestId("event-video-call")[1]!;

    expect(
      within(earlier).getByTestId("call-transcript-get"),
    ).toHaveTextContent("Get from Zoom");
    expect(
      within(earlier).getByTestId("call-transcript-add"),
    ).toHaveTextContent("Add transcript");
  });
});
