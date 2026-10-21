import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import API from "../../../Utils/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import UserService from "../../../Server/Services/UserService";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MicrosoftTeamsUtil from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion from "../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestAgainKind,
  WorkspaceConnectRequestData,
  WorkspacePendingActionKind,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { WorkspaceEventType } from "../../../Server/Utils/Workspace/WorkspaceMemberActions";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import { DashboardClientUrl } from "../../../Server/EnvironmentConfig";
import { ConnectRequestOutcome } from "../../../Types/Workspace/ConnectCallback";
import {
  CacheEntry,
  cookieHeader,
  httpGet,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * THE CONNECT BUTTON A MICROSOFT TEAMS PRESS IS ANSWERED WITH, THROUGH TO THE
 * END.
 *
 * Somebody whose Microsoft Teams account is not connected presses
 * Acknowledge on a card; the bot answers in the conversation, mentioning
 * them, with a Connect button that opens their own Microsoft Teams settings
 * page with the press's token. The page starts the sign-in with it; the
 * callback connects the account when the Microsoft account that signed in
 * is the one that pressed, finishes the press as the member, answers in the
 * conversation the press was made in (a proactive card that mentions them),
 * and tells the page what became of the press.
 *
 * These drive the real routes over HTTP; Microsoft and the Bot Connector
 * are answered here.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "3f1a8c52-7d0e-4b9a-9d61-2c4b5e6f7a80",
    MicrosoftTeamsAppClientSecret: "teams-client-secret",
  };
});

jest.mock("../../../Server/Middleware/UserAuthorization", () => {
  return {
    __esModule: true,
    default: {
      getUserMiddleware: (...args: Array<any>) => {
        return (
          jest.requireActual("./WorkspaceOAuthTestHelpers") as any
        ).fakeGetUserMiddleware(...args);
      },
    },
  };
});

jest.mock("../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: (
      jest.requireActual("./WorkspaceOAuthTestHelpers") as any
    ).createInMemoryGlobalCache(),
  };
});

jest.mock("../../../Server/Services/WorkspaceProjectAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      getProjectAuth: jest.fn(),
      refreshAuthToken: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/WorkspaceUserAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      getUserAuth: jest.fn(),
      refreshAuthToken: jest.fn(),
    },
  };
});

// The bot itself: the proactive answer is what these look at.
jest.mock(
  "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams",
  () => {
    return {
      __esModule: true,
      default: {
        refreshTeams: jest.fn(),
        sendCardToConversation: jest.fn(),
      },
    };
  },
);

jest.mock("../../../Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getCurrentPlan: jest.fn(async () => {
        return { plan: null, isSubscriptionUnpaid: false };
      }),
    },
  };
});

const SIGN_IN_START: string = "/api/microsoft-teams/sign-in-url";
const SIGN_IN_CALLBACK: string = "/api/microsoft-teams/auth";
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

// The pressers' Microsoft Entra object id, as Teams names them.
const PRESSER: string = "E3F4A5B6-C7D8-4E9F-8A1B-2C3D4E5F6A7B";
const INCIDENT_ID: ObjectID = new ObjectID(
  "b1000000-0000-4000-8000-000000000001",
);
const SERVICE_URL: string = "https://smba.trafficmanager.net/amer/";
const CONVERSATION_ID: string =
  "19:incident-inc-2@thread.tacv2;messageid=1760000000000";

const GONE: string =
  "This Connect button has expired or was already used. Press the button in Microsoft Teams again.";

type Browser = Record<string, string>;

describe("a Connect button in Microsoft Teams", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  // The Microsoft account the sign-in says signed in.
  let signedInAs: string;

  const getProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.getProjectAuth as unknown as jest.Mock;
  const refreshUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.refreshAuthToken as unknown as jest.Mock;
  const sendCard: jest.Mock =
    MicrosoftTeamsUtil.sendCardToConversation as unknown as jest.Mock;

  beforeAll(async () => {
    const MicrosoftTeamsAPI: any = (
      await import("../../../Server/API/MicrosoftTeamsAPI")
    ).default;

    app = await startApp([new MicrosoftTeamsAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    // Microsoft names the same account in lower case.
    signedInAs = PRESSER.toLowerCase();

    // The project's Teams connection, consented to by an admin.
    getProjectAuth.mockImplementation(async () => {
      return { miscData: { adminConsentGranted: true } };
    });
    refreshUserAuth.mockImplementation(async () => {
      return undefined;
    });
    sendCard.mockImplementation(async () => {
      return undefined;
    });

    jest.spyOn(API, "post").mockImplementation((async () => {
      return new HTTPResponse<JSONObject>(
        200,
        { access_token: "user-access-token" },
        {},
      );
    }) as never);
    jest.spyOn(API, "get").mockImplementation((async () => {
      return new HTTPResponse<JSONObject>(
        200,
        { id: signedInAs, displayName: "Nitin", mail: "nitin@example.com" },
        {},
      );
    }) as never);

    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockImplementation(
        async (data: {
          userId: ObjectID;
          projectId: ObjectID;
        }): Promise<DatabaseCommonInteractionProps> => {
          return { userId: data.userId, tenantId: data.projectId };
        },
      );
    jest.spyOn(UserService, "findOneById").mockImplementation(async () => {
      return { isMasterAdmin: false } as any;
    });
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DashboardClientUrl.toString()));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function press(
    overrides?: Partial<WorkspaceConnectRequestData>,
  ): Promise<string> {
    const { token } = await WorkspaceConnectRequest.create({
      workspaceType: WorkspaceType.MicrosoftTeams,
      projectId: projectId,
      workspaceUserId: PRESSER,
      purpose: "acknowledge this incident",
      pendingAction: {
        kind: WorkspacePendingActionKind.Acknowledge,
        eventType: WorkspaceEventType.Incident,
        eventId: INCIDENT_ID,
      },
      teams: {
        serviceUrl: SERVICE_URL,
        conversationId: CONVERSATION_ID,
        conversationType: "channel",
        tenantId: "tenant-1",
        userTeamsId: "29:nitin",
        userName: "Nitin",
      },
      ...overrides,
    });

    return token;
  }

  function startSignIn(token: string): Promise<ProbeResponse> {
    return httpGet({
      port: app.port,
      path: `${SIGN_IN_START}?from=user-settings&connect=${encodeURIComponent(token)}`,
      headers: {
        [TEST_USER_HEADER]: userId.toString(),
        tenantid: projectId.toString(),
        [TEST_PERMISSIONS_HEADER]: [Permission.ProjectMember].join(","),
      },
    });
  }

  async function signIn(
    token: string,
  ): Promise<{ state: string; browser: Browser }> {
    const response: ProbeResponse = await startSignIn(token);

    expect(response.status).toBe(200);

    return {
      state: queryOf(
        (response.body as JSONObject)["authorizationUrl"] as string,
      ).get("state")!,
      browser: { [COOKIE_NAME]: response.setCookies[COOKIE_NAME]! },
    };
  }

  function comeBack(started: {
    state: string;
    browser: Browser;
  }): Promise<ProbeResponse> {
    return httpGet({
      port: app.port,
      path: `${SIGN_IN_CALLBACK}?${new URLSearchParams({
        code: "code",
        state: started.state,
      }).toString()}`,
      headers: { cookie: cookieHeader(started.browser) },
    });
  }

  function settingsPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/user-settings/microsoft-teams-integration`;
  }

  test("the sign-in starts for a Microsoft Teams press of this project, and refuses a Slack one in the page's words", async () => {
    expect((await startSignIn(await press())).status).toBe(200);

    const slackPress: string = await press({
      workspaceType: WorkspaceType.Slack,
      teams: undefined,
    });
    const refused: ProbeResponse = await startSignIn(slackPress);

    expect(refused.status).toBe(400);
    expect((refused.body as JSONObject)["message"]).toBe(GONE);
  });

  test("the account that pressed: connected, the press finished as the member, answered in its conversation with a mention, and the page told so", async () => {
    const token: string = await press();
    const complete: jest.SpyInstance = jest
      .spyOn(WorkspaceConnectCompletion, "complete")
      .mockResolvedValue({
        outcome: ConnectRequestOutcome.Done,
        answer: {
          markdown:
            "✅ **Your Microsoft Teams account is connected to OneUptime.** You acknowledged **Incident INC-2**.",
          text: "Your Microsoft Teams account is connected to OneUptime. You acknowledged Incident INC-2",
        },
      });

    const response: ProbeResponse = await comeBack(await signIn(token));

    expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    expect(refreshUserAuth.mock.calls[0]![0]).toMatchObject({
      workspaceType: WorkspaceType.MicrosoftTeams,
      workspaceUserId: PRESSER.toLowerCase(),
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(
      (complete.mock.calls[0]![0] as { userId: ObjectID }).userId.toString(),
    ).toBe(userId.toString());

    // Answered in the conversation the press was made in, mentioning them.
    expect(sendCard).toHaveBeenCalledTimes(1);
    expect(sendCard.mock.calls[0]![0]).toEqual({
      conversationId: CONVERSATION_ID,
      conversationType: "channel",
      tenantId: "tenant-1",
      serviceUrl: SERVICE_URL,
      card: {
        type: "AdaptiveCard",
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        version: "1.5",
        body: [
          {
            type: "TextBlock",
            text: "<at>Nitin</at> ✅ **Your Microsoft Teams account is connected to OneUptime.** You acknowledged **Incident INC-2**.",
            wrap: true,
          },
        ],
        msteams: {
          entities: [
            {
              type: "mention",
              text: "<at>Nitin</at>",
              mentioned: { id: "29:nitin", name: "Nitin" },
            },
          ],
        },
      },
      summary:
        "Your Microsoft Teams account is connected to OneUptime. You acknowledged Incident INC-2",
    });

    expect(response.status).toBe(302);
    expect(response.location).toBe(`${settingsPage()}?pressed=done`);
    expect(await WorkspaceConnectRequest.peek(token)).toBeNull();
  });

  test("a press answered without being done: the page is told it was answered, not done", async () => {
    const token: string = await press();
    jest.spyOn(WorkspaceConnectCompletion, "complete").mockResolvedValue({
      outcome: ConnectRequestOutcome.Answered,
      answer: {
        markdown:
          "✅ **Your Microsoft Teams account is connected to OneUptime.** **Incident INC-2** was already acknowledged by **Simon Lee**.",
        text: "Your Microsoft Teams account is connected to OneUptime. Incident INC-2 was already acknowledged by Simon Lee",
      },
    });

    const response: ProbeResponse = await comeBack(await signIn(token));

    expect(sendCard).toHaveBeenCalledTimes(1);
    expect(response.location).toBe(`${settingsPage()}?pressed=answered`);
  });

  test("a form's button: connected, told in the conversation to press it again, and the page says so too", async () => {
    const token: string = await press({
      purpose: "add a note to this incident",
      pendingAction: undefined,
      again: {
        kind: WorkspaceConnectRequestAgainKind.Button,
        label: "Add Note",
      },
    });

    const response: ProbeResponse = await comeBack(await signIn(token));

    expect(
      (
        (sendCard.mock.calls[0]![0] as { card: JSONObject }).card[
          "body"
        ] as Array<JSONObject>
      )[0]!["text"],
    ).toBe(
      "<at>Nitin</at> ✅ **Your Microsoft Teams account is connected to OneUptime.** Now press **Add Note** again.",
    );
    expect(response.location).toBe(`${settingsPage()}?pressed=again`);
  });

  /*
   * A command typed to the bot - "oncall", "show active incidents" - is not
   * a press: the conversation says to type it again, and so does the page,
   * which used to say "press the button again".
   */
  test("a command: connected, told in the conversation to type it again, and the page says to run it", async () => {
    const token: string = await press({
      purpose: "see the open incidents",
      pendingAction: undefined,
      again: {
        kind: WorkspaceConnectRequestAgainKind.Command,
        label: "show active incidents",
      },
    });

    const response: ProbeResponse = await comeBack(await signIn(token));

    expect(
      (
        (sendCard.mock.calls[0]![0] as { card: JSONObject }).card[
          "body"
        ] as Array<JSONObject>
      )[0]!["text"],
    ).toBe(
      "<at>Nitin</at> ✅ **Your Microsoft Teams account is connected to OneUptime.** Now type **show active incidents** again.",
    );
    expect(response.location).toBe(`${settingsPage()}?pressed=run`);
  });

  /*
   * A question to OneUptime AI - typed in a chat with the bot, or after
   * @OneUptime - is not a press: the conversation says to ask it again, and
   * so does the page, which used to say "press the button again" (#4768).
   */
  test("a question: connected, told in the conversation to ask it again, and the page says to ask", async () => {
    const token: string = await press({
      purpose: "ask OneUptime AI",
      pendingAction: undefined,
      again: { kind: WorkspaceConnectRequestAgainKind.Question },
    });

    const response: ProbeResponse = await comeBack(await signIn(token));

    expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    expect(sendCard).toHaveBeenCalledTimes(1);
    expect(
      (
        (sendCard.mock.calls[0]![0] as { card: JSONObject }).card[
          "body"
        ] as Array<JSONObject>
      )[0]!["text"],
    ).toBe(
      "<at>Nitin</at> ✅ **Your Microsoft Teams account is connected to OneUptime.** Now ask your question again.",
    );
    expect((sendCard.mock.calls[0]![0] as { summary: string }).summary).toBe(
      "Your Microsoft Teams account is connected to OneUptime. Now ask your question again.",
    );
    expect(response.location).toBe(`${settingsPage()}?pressed=ask`);
  });

  test("another Microsoft account than the one that pressed: refused, nothing connected, nothing answered, and the press kept", async () => {
    const token: string = await press();
    const complete: jest.SpyInstance = jest.spyOn(
      WorkspaceConnectCompletion,
      "complete",
    );
    signedInAs = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

    const response: ProbeResponse = await comeBack(await signIn(token));

    expect(response.status).toBe(302);
    expect(response.location).toBe(
      `${settingsPage()}?error=teams-other-account`,
    );
    expect(refreshUserAuth).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(sendCard).not.toHaveBeenCalled();
    expect(await WorkspaceConnectRequest.peek(token)).not.toBeNull();
  });

  test.each([ConnectRequestOutcome.Done, ConnectRequestOutcome.Answered])(
    "%s, but the conversation takes no answer: the page does not say it is in Microsoft Teams",
    async (outcome: ConnectRequestOutcome) => {
      const token: string = await press();
      jest.spyOn(WorkspaceConnectCompletion, "complete").mockResolvedValue({
        outcome: outcome,
        answer: { markdown: "Done.", text: "Done." },
      });
      // The bot was removed from the team since the press.
      sendCard.mockRejectedValue(new Error("BotNotInConversationRoster"));

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      expect(response.location).toBe(`${settingsPage()}?pressed=unanswered`);
    },
  );

  test("a press that expired while they signed in: connected, nothing answered, and the page says it expired", async () => {
    const token: string = await press();
    const started: { state: string; browser: Browser } = await signIn(token);
    await WorkspaceConnectRequest.take(token);

    const response: ProbeResponse = await comeBack(started);

    expect(refreshUserAuth).toHaveBeenCalledTimes(1);
    expect(sendCard).not.toHaveBeenCalled();
    expect(response.location).toBe(`${settingsPage()}?pressed=expired`);
  });
});
