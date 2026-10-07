import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { EventPanelAction } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventStatusPanel";
import { getVideoCallHeadline } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/EventVideoCallsCard";
import { getJoinVideoCallAction } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/JoinVideoCallAction";
import {
  VIDEO_CALL_CONNECTION_TEST_ROUTE,
  VideoCallTestResult,
  runVideoCallConnectionTest,
  videoCallDocsUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallApi";
import {
  configFieldName,
  readVideoCallConnectionForm,
  secretFieldName,
  videoCallConnectionTestBody,
  videoCallConnectionTestDisabledReason,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallConnectionFormModal";
import {
  VideoCallConnectionHealth,
  getVideoCallConnectionHealth,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallConnectionsTable";
import { getDisplayedVideoCallProvider } from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/VideoCallProviderLogo";
import {
  EventVideoCall,
  VIDEO_CALL_RECHECK_DELAYS_MS,
  VIDEO_CALL_RECHECK_WINDOW_MS,
  VideoCallEventKind,
  fetchEventVideoCalls,
  getVideoCallRecheckDelay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/VideoCall/useEventVideoCalls";
import AlertVideoCall from "../../../Models/DatabaseModels/AlertVideoCall";
import IncidentVideoCall from "../../../Models/DatabaseModels/IncidentVideoCall";
import User from "../../../Models/DatabaseModels/User";
import VideoCallConnection from "../../../Models/DatabaseModels/VideoCallConnection";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Gray500, Green, Red } from "../../../Types/BrandColors";
import HashedString from "../../../Types/HashedString";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import VideoCallProvider from "../../../Types/VideoCall/VideoCallProvider";
import {
  VideoCallProviderDefinition,
  getVideoCallProviderDefinition,
} from "../../../Types/VideoCall/VideoCallProviderCatalog";
import { DOCS_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * The pieces of the Video Calls UI that are plain functions: how the
 * connection form's values become what the API stores, the body of a test
 * meeting request, why a test cannot run yet, how a connection's health is
 * read, the Join call button in an incident's header, what a call is called
 * on the incident's page, and when the page looks again for a call a rule
 * is about to start.
 */

const ENGLISH: Translator = createTranslator(undefined, "en");

function definitionOf(
  provider: VideoCallProvider,
): VideoCallProviderDefinition {
  const definition: VideoCallProviderDefinition | undefined =
    getVideoCallProviderDefinition(provider);

  if (!definition) {
    throw new Error(`No catalog entry for ${provider}`);
  }

  return definition;
}

const ZOOM: VideoCallProviderDefinition = definitionOf(VideoCallProvider.Zoom);
const GOOGLE_MEET: VideoCallProviderDefinition = definitionOf(
  VideoCallProvider.GoogleMeet,
);
const TEAMS: VideoCallProviderDefinition = definitionOf(
  VideoCallProvider.MicrosoftTeams,
);
const MEETING_LINK: VideoCallProviderDefinition = definitionOf(
  VideoCallProvider.CustomLink,
);

const SERVICE_ACCOUNT_KEY: string = [
  "{",
  '  "type": "service_account",',
  '  "client_email": "oneuptime@example.iam.gserviceaccount.com"',
  "}",
].join("\n");

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the connection form's field names", () => {
  test("keep config and secrets apart, keyed by the catalog's keys", () => {
    expect(configFieldName("accountId")).toBe("config__accountId");
    expect(secretFieldName("clientSecret")).toBe("secret__clientSecret");
    expect(configFieldName("clientId")).not.toBe(secretFieldName("clientId"));
  });
});

describe("readVideoCallConnectionForm", () => {
  test("reads a Zoom form into config and secrets, trimmed", () => {
    expect(
      readVideoCallConnectionForm(ZOOM, {
        name: "  Zoom for incidents ",
        description: " Sev1 bridges ",
        [configFieldName("accountId")]: " acct-1 ",
        [configFieldName("clientId")]: "client-1",
        [configFieldName("hostEmail")]: "incidents@example.com ",
        [secretFieldName("clientSecret")]: " s3cret ",
      }),
    ).toEqual({
      name: "Zoom for incidents",
      description: "Sev1 bridges",
      config: {
        accountId: "acct-1",
        clientId: "client-1",
        hostEmail: "incidents@example.com",
      },
      secrets: { clientSecret: "s3cret" },
    });
  });

  test("unwraps the HashedString a password field is submitted as, without hashing it", () => {
    const submission: ReturnType<typeof readVideoCallConnectionForm> =
      readVideoCallConnectionForm(ZOOM, {
        name: "Zoom",
        [secretFieldName("clientSecret")]: new HashedString(
          "plain-secret",
          false,
        ) as unknown as JSONObject,
      });

    expect(submission.secrets).toEqual({ clientSecret: "plain-secret" });
  });

  test("unwraps a dropdown value that is still { label, value }", () => {
    const submission: ReturnType<typeof readVideoCallConnectionForm> =
      readVideoCallConnectionForm(GOOGLE_MEET, {
        name: "Meet",
        [configFieldName("impersonatedUserEmail")]: "incidents@example.com",
        [configFieldName("accessType")]: {
          label: "Anyone with the link joins directly",
          value: "OPEN",
        },
      });

    expect(submission.config).toEqual({
      impersonatedUserEmail: "incidents@example.com",
      accessType: "OPEN",
    });
  });

  test("keeps a pasted JSON key exactly as pasted, newlines and all", () => {
    const pasted: string = `\n${SERVICE_ACCOUNT_KEY}\n`;
    const submission: ReturnType<typeof readVideoCallConnectionForm> =
      readVideoCallConnectionForm(GOOGLE_MEET, {
        name: "Meet",
        [secretFieldName("serviceAccountJson")]: pasted,
      });

    expect(submission.secrets["serviceAccountJson"]).toBe(pasted);
  });

  test("leaves out blank values, so a blank secret keeps the stored one on edit", () => {
    const submission: ReturnType<typeof readVideoCallConnectionForm> =
      readVideoCallConnectionForm(TEAMS, {
        name: "Teams",
        [configFieldName("tenantId")]: "   ",
        [configFieldName("clientId")]: "",
        [secretFieldName("clientSecret")]: "  \n ",
      });

    expect(submission.config).toEqual({});
    expect(submission.secrets).toEqual({});
  });

  test("ignores values the provider has no field for", () => {
    const submission: ReturnType<typeof readVideoCallConnectionForm> =
      readVideoCallConnectionForm(MEETING_LINK, {
        name: "War room",
        [configFieldName("joinUrl")]: "https://meet.example.com/war-room",
        [configFieldName("accountId")]: "not-a-link-field",
        [secretFieldName("clientSecret")]: "not-a-link-secret",
        somethingElse: "ignored",
      });

    expect(submission.config).toEqual({
      joinUrl: "https://meet.example.com/war-room",
    });
    expect(submission.secrets).toEqual({});
  });
});

describe("videoCallConnectionTestBody", () => {
  test("sends a new connection's unsaved settings with its provider", () => {
    expect(
      videoCallConnectionTestBody({
        definition: ZOOM,
        values: {
          name: "Zoom",
          [configFieldName("accountId")]: "acct-1",
          [secretFieldName("clientSecret")]: "s3cret",
        },
      }),
    ).toEqual({
      provider: VideoCallProvider.Zoom,
      config: { accountId: "acct-1" },
      secrets: { clientSecret: "s3cret" },
    });
  });

  test("sends a saved connection's id with only the edits, never the provider", () => {
    const connection: VideoCallConnection = new VideoCallConnection();
    connection.id = new ObjectID("7d1f7b0c-1b5b-4c4a-9d3c-3f4b8f6a2e10");

    const body: JSONObject = videoCallConnectionTestBody({
      definition: ZOOM,
      values: { [configFieldName("hostEmail")]: "oncall@example.com" },
      connection,
    });

    expect(body).toEqual({
      connectionId: "7d1f7b0c-1b5b-4c4a-9d3c-3f4b8f6a2e10",
      config: { hostEmail: "oncall@example.com" },
      secrets: {},
    });
    expect(body["provider"]).toBeUndefined();
  });
});

describe("videoCallConnectionTestDisabledReason", () => {
  test("names every required field a new connection still needs", () => {
    expect(
      videoCallConnectionTestDisabledReason({
        definition: ZOOM,
        values: { [configFieldName("accountId")]: "acct-1" },
        isEditing: false,
        translator: ENGLISH,
      }),
    ).toBe(
      "Fill in Client ID, Meeting host, Client secret to start a test meeting.",
    );
  });

  test("lets the test run once every required field is filled in", () => {
    expect(
      videoCallConnectionTestDisabledReason({
        definition: MEETING_LINK,
        values: {
          [configFieldName("joinUrl")]: "https://meet.example.com/war-room",
        },
        isEditing: false,
        translator: ENGLISH,
      }),
    ).toBeUndefined();
  });

  test("never blocks an edit: the stored credentials fill the gaps", () => {
    expect(
      videoCallConnectionTestDisabledReason({
        definition: TEAMS,
        values: {},
        isEditing: true,
        translator: ENGLISH,
      }),
    ).toBeUndefined();
  });

  test("counts a field whose dropdown default is set as filled in", () => {
    const reason: string | undefined = videoCallConnectionTestDisabledReason({
      definition: GOOGLE_MEET,
      values: {
        [configFieldName("impersonatedUserEmail")]: "incidents@example.com",
        [configFieldName("accessType")]: "TRUSTED",
      },
      isEditing: false,
      translator: ENGLISH,
    });

    expect(reason).toBe(
      "Fill in Service account JSON key to start a test meeting.",
    );
  });
});

describe("the Setup guide link", () => {
  test("opens the provider's section of the Video Calls docs page", () => {
    expect(videoCallDocsUrl(ZOOM.docsPath).toString()).toBe(
      `${DOCS_URL.toString()}/workspace-connections/video-calls#zoom`,
    );
    expect(videoCallDocsUrl(TEAMS.docsPath).toString()).toContain(
      "/workspace-connections/video-calls#microsoft-teams",
    );
  });
});

describe("runVideoCallConnectionTest", () => {
  test("posts the body to the test route and returns the meeting it started", async () => {
    const post: ReturnType<typeof jest.spyOn> = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          {
            provider: VideoCallProvider.Zoom,
            joinUrl: "https://example.zoom.us/j/123",
          },
          {},
        ) as never,
      );

    const result: VideoCallTestResult = await runVideoCallConnectionTest({
      connectionId: "abc",
    });

    expect(result).toEqual({
      provider: VideoCallProvider.Zoom,
      joinUrl: "https://example.zoom.us/j/123",
    });

    const request: { url: { toString: () => string }; data: JSONObject } = post
      .mock.calls[0]![0] as {
      url: { toString: () => string };
      data: JSONObject;
    };

    expect(request.url.toString()).toContain(VIDEO_CALL_CONNECTION_TEST_ROUTE);
    // Credentials travel in the body, never in the URL.
    expect(request.url.toString()).not.toContain("abc");
    expect(request.data).toEqual({ connectionId: "abc" });
  });

  test("throws the server's error, for the panel to show", async () => {
    const failure: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "Zoom rejected the client secret." },
      {},
    );
    jest.spyOn(API, "post").mockResolvedValue(failure as never);

    await expect(runVideoCallConnectionTest({})).rejects.toBe(failure);
  });

  test("refuses an answer without a meeting in it", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          { provider: "NotAProvider", joinUrl: 7 },
          {},
        ) as never,
      );

    await expect(runVideoCallConnectionTest({})).rejects.toThrow(
      "The server did not return a test meeting",
    );
  });
});

describe("getVideoCallConnectionHealth", () => {
  const minutesAgo: (minutes: number) => Date = (minutes: number): Date => {
    return new Date(Date.now() - minutes * 60 * 1000);
  };

  test("a connection never used says so, and how to try it", () => {
    const health: VideoCallConnectionHealth = getVideoCallConnectionHealth(
      new VideoCallConnection(),
    );

    expect(health.label).toBe("Not used yet");
    expect(health.color).toBe(Gray500);
    expect(health.tooltip).toContain("Use Test");
  });

  test("a call started after the last failure is working", () => {
    const connection: VideoCallConnection = new VideoCallConnection();
    connection.lastError = "Zoom rejected the client secret.";
    connection.lastErrorAt = minutesAgo(30);
    connection.lastCallStartedAt = minutesAgo(5);

    const health: VideoCallConnectionHealth =
      getVideoCallConnectionHealth(connection);

    expect(health.label).toBe("Working");
    expect(health.color).toBe(Green);
  });

  test("a failure after the last call is what to look at, with its reason", () => {
    const connection: VideoCallConnection = new VideoCallConnection();
    connection.lastCallStartedAt = minutesAgo(30);
    connection.lastError = "Zoom rejected the client secret.";
    connection.lastErrorAt = minutesAgo(5);

    const health: VideoCallConnectionHealth =
      getVideoCallConnectionHealth(connection);

    expect(health.label).toBe("Last call failed");
    expect(health.color).toBe(Red);
    expect(health.tooltip).toBe("Zoom rejected the client secret.");
  });

  test("a connection that has only ever failed has failed", () => {
    const connection: VideoCallConnection = new VideoCallConnection();
    connection.lastError = "No application access policy.";
    connection.lastErrorAt = minutesAgo(1);

    expect(getVideoCallConnectionHealth(connection).label).toBe(
      "Last call failed",
    );
  });
});

describe("the Join call button in the event's header", () => {
  function callOf(
    provider: VideoCallProvider,
    joinUrl: string | undefined,
  ): EventVideoCall {
    const call: IncidentVideoCall = new IncidentVideoCall();
    call.provider = provider;
    if (joinUrl) {
      call.joinUrl = joinUrl;
    }
    return call;
  }

  test("is absent without a call", () => {
    expect(getJoinVideoCallAction([])).toBeNull();
  });

  test("is absent for a call without a link", () => {
    expect(
      getJoinVideoCallAction([callOf(VideoCallProvider.Zoom, undefined)]),
    ).toBeNull();
  });

  test("joins the newest call, in a new tab that cannot reach back", () => {
    const open: ReturnType<typeof jest.spyOn> = jest
      .spyOn(window, "open")
      .mockImplementation((): null => {
        return null;
      });

    const action: EventPanelAction | null = getJoinVideoCallAction([
      callOf(
        VideoCallProvider.GoogleMeet,
        "https://meet.google.com/abc-defg-hij",
      ),
      callOf(VideoCallProvider.Zoom, "https://example.zoom.us/j/1"),
    ]);

    expect(action).not.toBeNull();
    expect(action!.id).toBe("join-video-call");
    expect(action!.label).toBe("Join call");
    expect(action!.icon).toBe(IconProp.VideoCamera);

    action!.onClick();

    expect(open).toHaveBeenCalledWith(
      "https://meet.google.com/abc-defg-hij",
      "_blank",
      "noopener,noreferrer",
    );
  });

  test("says Join huddle for a Slack huddle", () => {
    expect(
      getJoinVideoCallAction([
        callOf(
          VideoCallProvider.SlackHuddle,
          "https://app.slack.com/huddle/T0123/C0456",
        ),
      ])!.label,
    ).toBe("Join huddle");
  });
});

describe("what a call is called on the event's page", () => {
  test("a provider meeting is named for its provider", () => {
    const call: IncidentVideoCall = new IncidentVideoCall();
    call.provider = VideoCallProvider.MicrosoftTeams;
    call.title = "INC-42: Checkout is down";

    expect(getVideoCallHeadline(call)).toBe("Microsoft Teams meeting");
  });

  test("a link of one's own with a title is called by its title", () => {
    const call: AlertVideoCall = new AlertVideoCall();
    call.provider = VideoCallProvider.CustomLink;
    call.joinUrl = "https://example.zoom.us/j/1";
    call.title = "Payments war room";

    expect(getVideoCallHeadline(call)).toBe("Payments war room");
  });

  test("a link of one's own without a title is named for the link's provider", () => {
    const call: IncidentVideoCall = new IncidentVideoCall();
    call.provider = VideoCallProvider.CustomLink;
    call.joinUrl = "https://example.zoom.us/j/1";

    expect(getVideoCallHeadline(call)).toBe("Zoom meeting");
  });

  test("a standing link of an unknown bridge is named for its connection", () => {
    const call: IncidentVideoCall = new IncidentVideoCall();
    call.provider = VideoCallProvider.CustomLink;
    call.joinUrl = "https://bridge.example.com/room/7";
    const connection: VideoCallConnection = new VideoCallConnection();
    connection.name = "Standing bridge";
    call.videoCallConnection = connection;

    expect(getVideoCallHeadline(call)).toBe("Standing bridge");
  });

  test("a Slack huddle is a Slack huddle", () => {
    const call: IncidentVideoCall = new IncidentVideoCall();
    call.provider = VideoCallProvider.SlackHuddle;
    call.joinUrl = "https://app.slack.com/huddle/T0123/C0456";

    expect(getVideoCallHeadline(call)).toBe("Slack huddle");
  });
});

describe("getDisplayedVideoCallProvider", () => {
  test("a link's own brand wins over 'meeting link'", () => {
    expect(
      getDisplayedVideoCallProvider(
        VideoCallProvider.CustomLink,
        "https://teams.microsoft.com/l/meetup-join/abc",
      ),
    ).toBe(VideoCallProvider.MicrosoftTeams);
    expect(
      getDisplayedVideoCallProvider(
        VideoCallProvider.CustomLink,
        "https://meet.google.com/abc-defg-hij",
      ),
    ).toBe(VideoCallProvider.GoogleMeet);
  });

  test("an unknown bridge stays a meeting link", () => {
    expect(
      getDisplayedVideoCallProvider(
        VideoCallProvider.CustomLink,
        "https://bridge.example.com/room/7",
      ),
    ).toBe(VideoCallProvider.CustomLink);
    expect(getDisplayedVideoCallProvider(undefined, undefined)).toBe(
      VideoCallProvider.CustomLink,
    );
  });

  test("a provider call keeps its provider, whatever its link says", () => {
    expect(
      getDisplayedVideoCallProvider(
        VideoCallProvider.SlackHuddle,
        "https://app.slack.com/huddle/T0123/C0456",
      ),
    ).toBe(VideoCallProvider.SlackHuddle);
  });
});

describe("looking again for a call a rule is about to start", () => {
  const NOW: Date = new Date("2026-10-07T12:00:00.000Z");
  const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
    return new Date(NOW.getTime() - seconds * 1000);
  };

  test("looks again, a little later each time, while a new event has no call", () => {
    const delays: Array<number | null> = [0, 1, 2, 3].map(
      (attempt: number): number | null => {
        return getVideoCallRecheckDelay({
          eventStartedAt: secondsAgo(2),
          now: NOW,
          callCount: 0,
          attempt,
        });
      },
    );

    expect(delays).toEqual([...VIDEO_CALL_RECHECK_DELAYS_MS]);
    expect(
      [...delays].sort((a: number | null, b: number | null) => {
        return (a || 0) - (b || 0);
      }),
    ).toEqual(delays);
  });

  test("then stops", () => {
    expect(
      getVideoCallRecheckDelay({
        eventStartedAt: secondsAgo(2),
        now: NOW,
        callCount: 0,
        attempt: VIDEO_CALL_RECHECK_DELAYS_MS.length,
      }),
    ).toBeNull();
  });

  test("stops as soon as there is a call", () => {
    expect(
      getVideoCallRecheckDelay({
        eventStartedAt: secondsAgo(2),
        now: NOW,
        callCount: 1,
        attempt: 0,
      }),
    ).toBeNull();
  });

  test("never looks again for an event that is not new", () => {
    expect(
      getVideoCallRecheckDelay({
        eventStartedAt: secondsAgo(VIDEO_CALL_RECHECK_WINDOW_MS / 1000 + 1),
        now: NOW,
        callCount: 0,
        attempt: 0,
      }),
    ).toBeNull();
  });

  test("never looks again before it knows when the event started", () => {
    expect(
      getVideoCallRecheckDelay({
        eventStartedAt: undefined,
        now: NOW,
        callCount: 0,
        attempt: 0,
      }),
    ).toBeNull();
  });

  test("treats an event a few seconds in the future as new, but not one far ahead", () => {
    expect(
      getVideoCallRecheckDelay({
        eventStartedAt: secondsAgo(-10),
        now: NOW,
        callCount: 0,
        attempt: 0,
      }),
    ).toBe(VIDEO_CALL_RECHECK_DELAYS_MS[0]);
    expect(
      getVideoCallRecheckDelay({
        eventStartedAt: secondsAgo(-3600),
        now: NOW,
        callCount: 0,
        attempt: 0,
      }),
    ).toBeNull();
  });
});

describe("fetchEventVideoCalls", () => {
  let getList: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    getList = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (): Promise<ListResult<IncidentVideoCall>> => {
        const call: IncidentVideoCall = new IncidentVideoCall();
        call.provider = VideoCallProvider.Zoom;
        call.joinUrl = "https://example.zoom.us/j/1";
        const user: User = new User();
        user.name = new Name("Ada");
        call.createdByUser = user;
        return { data: [call], count: 1, skip: 0, limit: 20 };
      });
  });

  test("reads an incident's calls, newest first, with who started them", async () => {
    const eventId: ObjectID = new ObjectID(
      "0b9c3a7e-4f1d-4d7e-8a3b-2c1d0e9f8a7b",
    );

    const calls: Array<EventVideoCall> = await fetchEventVideoCalls({
      kind: VideoCallEventKind.Incident,
      eventId,
    });

    expect(calls).toHaveLength(1);

    const request: {
      modelType: unknown;
      query: JSONObject;
      select: JSONObject;
      sort: JSONObject;
      limit: number;
    } = getList.mock.calls[0]![0] as never;

    expect(request.modelType).toBe(IncidentVideoCall);
    expect(request.query).toEqual({ incidentId: eventId });
    expect(request.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(request.limit).toBe(20);
    expect(request.select).toMatchObject({
      provider: true,
      joinUrl: true,
      title: true,
      createdAt: true,
      workspaceNotificationRuleId: true,
      videoCallConnection: { name: true, provider: true },
      createdByUser: { name: true, email: true },
    });
  });

  test("reads an alert's calls from the alert's own table", async () => {
    const eventId: ObjectID = new ObjectID(
      "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    );

    await fetchEventVideoCalls({ kind: VideoCallEventKind.Alert, eventId });

    const request: { modelType: unknown; query: JSONObject } = getList.mock
      .calls[0]![0] as never;

    expect(request.modelType).toBe(AlertVideoCall);
    expect(request.query).toEqual({ alertId: eventId });
  });
});
