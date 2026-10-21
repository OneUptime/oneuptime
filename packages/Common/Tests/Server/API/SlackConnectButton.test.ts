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
import WorkspaceOAuthState from "../../../Server/Utils/Workspace/WorkspaceOAuthState";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectCompletion from "../../../Server/Utils/Workspace/WorkspaceConnectCompletion";
import SlackActionAnswer, {
  SlackAnswerDelivery,
} from "../../../Server/Utils/Workspace/Slack/Actions/Answer";
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
  makeUnsignedJwt,
  ProbeResponse,
  queryOf,
  RunningApp,
  startApp,
  TEST_PERMISSIONS_HEADER,
  TEST_USER_HEADER,
} from "./WorkspaceOAuthTestHelpers";

/*
 * THE CONNECT BUTTON A SLACK PRESS IS ANSWERED WITH, THROUGH TO THE END.
 *
 * Somebody whose Slack account is not connected presses Acknowledge; the
 * answer, where they pressed, carries a Connect button that opens their own
 * Slack settings page with the press's token (`?connect=`). The page starts
 * the sign-in with that token (GET /slack/sign-in-url?connect=), and the
 * sign-in's callback connects the account - when the Slack account that
 * signed in is the one that pressed - then finishes the press as the member
 * (WorkspaceConnectCompletion), answers at the press's response_url, and
 * sends the browser back to the page with what became of the press and the
 * channel to go back to.
 *
 * These drive the real routes over HTTP. Slack is never reached: every
 * request to it is recorded and answered here.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    SlackAppClientId: "1234567890.0987654321",
    SlackAppClientSecret: "slack-client-secret",
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
      findOneBy: jest.fn(),
      refreshAuthToken: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/WorkspaceUserAuthTokenService", () => {
  return {
    __esModule: true,
    default: {
      refreshAuthToken: jest.fn(),
    },
  };
});

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

const SIGN_IN_START: string = "/api/slack/sign-in-url";
const COOKIE_NAME: string = WorkspaceOAuthState.BROWSER_BINDING_COOKIE_NAME;
const mockCacheStore: Map<string, CacheEntry> = (GlobalCache as any).store;

const SLACK_TEAM_ID: string = "T0123ABC456";
const PRESSER: string = "U0NITIN";
const RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0123ABC456/1234/abcDEF";
const TOKEN_EXCHANGE_URL: string = "https://slack.com/api/openid.connect.token";
const INCIDENT_ID: ObjectID = new ObjectID(
  "a1000000-0000-4000-8000-000000000001",
);

const GONE: string =
  "This Connect button has expired or was already used. Press the button in Slack again.";

// Slack's own: a zero-width space around a bold span it draws.
const ZWSP: string = "\u{200B}";

type Browser = Record<string, string>;

interface SlackCall {
  url: string;
  data: JSONObject;
}

describe("a Connect button in Slack", () => {
  let app: RunningApp;
  let projectId: ObjectID;
  let userId: ObjectID;
  let slackCalls: Array<SlackCall>;
  // The Slack account the sign-in says signed in.
  let signedInAs: string;

  const findProjectAuth: jest.Mock =
    WorkspaceProjectAuthTokenService.findOneBy as unknown as jest.Mock;
  const refreshUserAuth: jest.Mock =
    WorkspaceUserAuthTokenService.refreshAuthToken as unknown as jest.Mock;

  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    mockCacheStore.clear();
    jest.clearAllMocks();
    projectId = ObjectID.generate();
    userId = ObjectID.generate();
    slackCalls = [];
    signedInAs = PRESSER;

    findProjectAuth.mockImplementation(async () => {
      return {
        workspaceProjectId: SLACK_TEAM_ID,
        miscData: { teamName: "Acme" },
        authToken: "xoxb-project-token",
      };
    });
    refreshUserAuth.mockImplementation(async () => {
      return undefined;
    });

    // Slack: the sign-in's token exchange, and every answer posted.
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data: JSONObject;
    }) => {
      const url: string = options.url.toString();
      slackCalls.push({ url: url, data: options.data });

      if (url === TOKEN_EXCHANGE_URL) {
        return new HTTPResponse<JSONObject>(
          200,
          {
            ok: true,
            access_token: "xoxp-user-token",
            id_token: makeUnsignedJwt({
              "https://slack.com/team_id": SLACK_TEAM_ID,
              "https://slack.com/user_id": signedInAs,
            }),
          },
          {},
        );
      }

      return new HTTPResponse<JSONObject>(200, { ok: true }, {});
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

  function signedInHeaders(): Record<string, string> {
    return {
      [TEST_USER_HEADER]: userId.toString(),
      tenantid: projectId.toString(),
      [TEST_PERMISSIONS_HEADER]: [Permission.ProjectMember].join(","),
    };
  }

  // The press, as the answer's Connect button keeps it.
  async function press(
    overrides?: Partial<WorkspaceConnectRequestData>,
  ): Promise<string> {
    const { token } = await WorkspaceConnectRequest.create({
      workspaceType: WorkspaceType.Slack,
      projectId: projectId,
      workspaceUserId: PRESSER,
      purpose: "acknowledge this incident",
      pendingAction: {
        kind: WorkspacePendingActionKind.Acknowledge,
        eventType: WorkspaceEventType.Incident,
        eventId: INCIDENT_ID,
      },
      slack: {
        teamId: SLACK_TEAM_ID,
        channelId: "C0INC2",
        threadTs: "1760000000.000100",
        responseUrl: RESPONSE_URL,
      },
      ...overrides,
    });

    return token;
  }

  // What the settings page asks for when it opens with `?connect=`.
  function startSignIn(token: string): Promise<ProbeResponse> {
    return httpGet({
      port: app.port,
      path: `${SIGN_IN_START}?from=user-settings&connect=${encodeURIComponent(token)}`,
      headers: signedInHeaders(),
    });
  }

  async function signIn(
    token: string,
  ): Promise<{ state: string; browser: Browser }> {
    const response: ProbeResponse = await startSignIn(token);

    expect(response.status).toBe(200);

    const url: string = (response.body as JSONObject)[
      "authorizationUrl"
    ] as string;

    return {
      state: queryOf(url).get("state")!,
      browser: { [COOKIE_NAME]: response.setCookies[COOKIE_NAME]! },
    };
  }

  // Where Slack sends the browser back once the person signed in.
  function comeBack(started: {
    state: string;
    browser: Browser;
  }): Promise<ProbeResponse> {
    return httpGet({
      port: app.port,
      path: `/api/slack/auth/${projectId.toString()}/${userId.toString()}/user?${new URLSearchParams(
        { code: "slack-code", state: started.state },
      ).toString()}`,
      headers: { cookie: cookieHeader(started.browser) },
    });
  }

  // The person's own Slack settings page, which the sign-in comes back to.
  function settingsPage(): string {
    return `${DashboardClientUrl.toString()}/${projectId.toString()}/user-settings/slack-integration`;
  }

  function answersPosted(): Array<SlackCall> {
    return slackCalls.filter((call: SlackCall): boolean => {
      return call.url !== TOKEN_EXCHANGE_URL;
    });
  }

  describe("GET /slack/sign-in-url?connect=", () => {
    test("starts the sign-in for a press that is still there, and leaves the press for its callback", async () => {
      const token: string = await press();

      const response: ProbeResponse = await startSignIn(token);

      expect(response.status).toBe(200);
      expect(
        (
          (response.body as JSONObject)["authorizationUrl"] as string
        ).startsWith("https://slack.com/openid/connect/authorize?"),
      ).toBe(true);
      // Only read: an abandoned sign-in can be started again from the same button.
      expect(await WorkspaceConnectRequest.peek(token)).not.toBeNull();
    });

    test.each([
      ["a press already finished, or past its thirty minutes", "gone"],
      ["another project's press", "other-project"],
      ["a Microsoft Teams press", "teams"],
      ["a value that is not a token at all", "garbage"],
    ])(
      "refuses %s, in the words the page shows",
      async (_name: string, kind: string) => {
        let token: string = "../../evil?x=1";

        if (kind === "gone") {
          token = await press();
          await WorkspaceConnectRequest.take(token);
        }

        if (kind === "other-project") {
          token = await press({ projectId: ObjectID.generate() });
        }

        if (kind === "teams") {
          token = await press({
            workspaceType: WorkspaceType.MicrosoftTeams,
            slack: undefined,
          });
        }

        const before: number = mockCacheStore.size;
        const response: ProbeResponse = await startSignIn(token);

        expect(response.status).toBe(400);
        expect((response.body as JSONObject)["message"]).toBe(GONE);
        // No sign-in was started for it.
        expect(mockCacheStore.size).toBe(before);
        expect(response.setCookies[COOKIE_NAME]).toBeUndefined();
      },
    );
  });

  describe("the sign-in's callback", () => {
    test("the account that pressed: connected, the press finished as the member, answered where it was pressed, and the page told so", async () => {
      const token: string = await press();
      const complete: jest.SpyInstance = jest
        .spyOn(WorkspaceConnectCompletion, "complete")
        .mockResolvedValue({
          outcome: ConnectRequestOutcome.Done,
          answer: {
            markdown:
              "✅ **Your Slack account is connected to OneUptime.** You acknowledged **Incident INC-2**.",
            text: "Your Slack account is connected to OneUptime. You acknowledged Incident INC-2",
          },
        });

      const response: ProbeResponse = await comeBack(await signIn(token));

      // Connected: the Slack account that pressed, to the person signed in.
      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      expect(refreshUserAuth.mock.calls[0]![0]).toMatchObject({
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: PRESSER,
      });
      expect(
        (refreshUserAuth.mock.calls[0]![0] as JSONObject)["userId"]!.toString(),
      ).toBe(userId.toString());

      // Finished as that member, from the press as it was kept.
      expect(complete).toHaveBeenCalledTimes(1);
      const finished: {
        request: { workspaceUserId: string; purpose: string };
        userId: ObjectID;
      } = complete.mock.calls[0]![0];
      expect(finished.userId.toString()).toBe(userId.toString());
      expect(finished.request).toMatchObject({
        workspaceUserId: PRESSER,
        purpose: "acknowledge this incident",
      });

      // Answered at the press's response_url, only to them, in the channel.
      expect(answersPosted()).toEqual([
        {
          url: RESPONSE_URL,
          data: {
            response_type: "ephemeral",
            replace_original: false,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: "✅ ​*Your Slack account is connected to OneUptime.*​ You acknowledged ​*Incident INC-2*​.\n",
                },
              },
            ],
            text: "Your Slack account is connected to OneUptime. You acknowledged Incident INC-2",
          },
        },
      ]);

      // The page: what became of the press, and the channel to go back to.
      expect(response.status).toBe(302);
      const location: globalThis.URL = new globalThis.URL(response.location!);
      expect(`${location.origin}${location.pathname}`).toBe(settingsPage());
      expect(Object.fromEntries(location.searchParams.entries())).toEqual({
        pressed: "done",
        slackChannel: "C0INC2",
        slackTeam: SLACK_TEAM_ID,
      });

      // Spent: a second sign-in from the same button finds nothing.
      expect(await WorkspaceConnectRequest.peek(token)).toBeNull();
    });

    test("a form's button: connected, told in Slack to press it again, and the page says so too", async () => {
      const token: string = await press({
        purpose: "add a note to this incident",
        pendingAction: undefined,
        again: {
          kind: WorkspaceConnectRequestAgainKind.Button,
          label: "Add Note",
        },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      expect(answersPosted()).toHaveLength(1);
      expect(answersPosted()[0]!.url).toBe(RESPONSE_URL);
      expect(
        (
          (answersPosted()[0]!.data["blocks"] as Array<JSONObject>)[0]![
            "text"
          ] as JSONObject
        )["text"],
      ).toBe(
        "✅ ​*Your Slack account is connected to OneUptime.*​ Now press ​*Add Note*​ again.\n",
      );
      expect(
        new globalThis.URL(response.location!).searchParams.get("pressed"),
      ).toBe("again");
    });

    /*
     * A command - /oneuptime incident - is not a press either: Slack says to
     * run it again, and the page says the same. It used to say "press the
     * button again", with no button to press.
     */
    test("a command: connected, told in Slack to run it again, and the page says to run it", async () => {
      const token: string = await press({
        purpose: "declare an incident",
        pendingAction: undefined,
        again: {
          kind: WorkspaceConnectRequestAgainKind.Command,
          label: "/oneuptime incident",
        },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(answersPosted()).toHaveLength(1);
      expect(
        (
          (answersPosted()[0]!.data["blocks"] as Array<JSONObject>)[0]![
            "text"
          ] as JSONObject
        )["text"],
      ).toBe(
        "✅ ​*Your Slack account is connected to OneUptime.*​ Now run ​*/oneuptime incident*​ again.\n",
      );
      expect(
        new globalThis.URL(response.location!).searchParams.get("pressed"),
      ).toBe("run");
    });

    /*
     * A question to OneUptime AI - an @mention, a direct message - is not a
     * press: once connected, the person asks it again. Slack says so where
     * they were asked to connect, and the page says the same - it used to
     * say "press the button again", with no button to press (#4768).
     */
    test("a question asked at the top of a channel: connected, told in the channel to ask it again, and the page says to ask", async () => {
      const token: string = await press({
        purpose: "ask OneUptime AI",
        pendingAction: undefined,
        again: { kind: WorkspaceConnectRequestAgainKind.Question },
        // Asked with no thread yet: the prompt was in the channel itself.
        slack: { teamId: SLACK_TEAM_ID, channelId: "C0OPS" },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      expect(answersPosted()).toEqual([
        {
          url: "https://slack.com/api/chat.postEphemeral",
          data: {
            channel: "C0OPS",
            user: PRESSER,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `✅ ${ZWSP}*Your Slack account is connected to OneUptime.*${ZWSP} Now ask your question again.\n`,
                },
              },
            ],
            text: "Your Slack account is connected to OneUptime. Now ask your question again.",
          },
        },
      ]);

      const location: globalThis.URL = new globalThis.URL(response.location!);
      expect(`${location.origin}${location.pathname}`).toBe(settingsPage());
      expect(Object.fromEntries(location.searchParams.entries())).toEqual({
        pressed: "ask",
        slackChannel: "C0OPS",
        slackTeam: SLACK_TEAM_ID,
      });
    });

    test("a question asked in a thread: told to ask it again in that thread", async () => {
      const token: string = await press({
        purpose: "ask OneUptime AI",
        pendingAction: undefined,
        again: { kind: WorkspaceConnectRequestAgainKind.Question },
        slack: {
          teamId: SLACK_TEAM_ID,
          channelId: "C0OPS",
          threadTs: "1760000000.000100",
        },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(answersPosted()).toHaveLength(1);
      expect(answersPosted()[0]!.url).toBe(
        "https://slack.com/api/chat.postEphemeral",
      );
      expect(answersPosted()[0]!.data).toMatchObject({
        channel: "C0OPS",
        user: PRESSER,
        thread_ts: "1760000000.000100",
        text: "Your Slack account is connected to OneUptime. Now ask your question again.",
      });
      expect(
        new globalThis.URL(response.location!).searchParams.get("pressed"),
      ).toBe("ask");
    });

    test("a question asked in the app's direct messages: told there to ask it again, as the app's own message, and the page says to ask - and links back to the direct messages", async () => {
      const token: string = await press({
        purpose: "ask OneUptime AI",
        pendingAction: undefined,
        again: { kind: WorkspaceConnectRequestAgainKind.Question },
        /*
         * A direct message names no channel to answer in: it is answered by
         * the app's own message there. The direct messages are kept only as
         * the way back.
         */
        slack: { teamId: SLACK_TEAM_ID, directMessageChannelId: "D0NITIN" },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(answersPosted()).toEqual([
        {
          url: "https://slack.com/api/chat.postMessage",
          data: {
            channel: PRESSER,
            blocks: [
              {
                type: "section",
                text: {
                  type: "mrkdwn",
                  text: `✅ ${ZWSP}*Your Slack account is connected to OneUptime.*${ZWSP} Now ask your question again.\n`,
                },
              },
            ],
            unfurl_links: false,
            text: "Your Slack account is connected to OneUptime. Now ask your question again.",
          },
        },
      ]);

      // "Back to Slack" opens the direct messages they asked in.
      const location: globalThis.URL = new globalThis.URL(response.location!);
      expect(`${location.origin}${location.pathname}`).toBe(settingsPage());
      expect(Object.fromEntries(location.searchParams.entries())).toEqual({
        pressed: "ask",
        slackChannel: "D0NITIN",
        slackTeam: SLACK_TEAM_ID,
      });
    });

    test("…kept before OneUptime remembered the direct messages (no channel at all): the same answer, and no link to nowhere", async () => {
      const token: string = await press({
        purpose: "ask OneUptime AI",
        pendingAction: undefined,
        again: { kind: WorkspaceConnectRequestAgainKind.Question },
        slack: { teamId: SLACK_TEAM_ID },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(answersPosted()).toHaveLength(1);
      expect(answersPosted()[0]!.url).toBe(
        "https://slack.com/api/chat.postMessage",
      );
      expect(answersPosted()[0]!.data["channel"]).toBe(PRESSER);
      expect(response.location).toBe(`${settingsPage()}?pressed=ask`);
    });

    test("a direct message's channel that is not an id links nowhere: the page gets no address but Slack's own ids", async () => {
      const token: string = await press({
        purpose: "ask OneUptime AI",
        pendingAction: undefined,
        again: { kind: WorkspaceConnectRequestAgainKind.Question },
        slack: {
          teamId: SLACK_TEAM_ID,
          directMessageChannelId: "D0NITIN&team=T9EVIL",
        },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(response.location).toBe(`${settingsPage()}?pressed=ask`);
    });

    test("another Slack account than the one that pressed: refused, nothing connected, and the press kept for its own account", async () => {
      const token: string = await press();
      const complete: jest.SpyInstance = jest.spyOn(
        WorkspaceConnectCompletion,
        "complete",
      );
      // The browser was signed in to a colleague's Slack.
      signedInAs = "U0COLLEAGUE";

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(response.status).toBe(302);
      expect(response.location).toBe(
        `${settingsPage()}?error=slack-other-account`,
      );
      expect(refreshUserAuth).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(answersPosted()).toEqual([]);
      // Still there, for the account that pressed to finish.
      expect(await WorkspaceConnectRequest.peek(token)).not.toBeNull();
    });

    test("a press that expired while they signed in: connected all the same, and the page says the press expired", async () => {
      const token: string = await press();
      const complete: jest.SpyInstance = jest.spyOn(
        WorkspaceConnectCompletion,
        "complete",
      );
      const started: { state: string; browser: Browser } = await signIn(token);

      // Thirty minutes pass on the sign-in page.
      await WorkspaceConnectRequest.take(token);

      const response: ProbeResponse = await comeBack(started);

      expect(refreshUserAuth).toHaveBeenCalledTimes(1);
      expect(complete).not.toHaveBeenCalled();
      expect(answersPosted()).toEqual([]);
      expect(response.location).toBe(`${settingsPage()}?pressed=expired`);
    });

    /*
     * Not done - somebody got there first, the member may not, it failed -
     * is answered in Slack with why; the page says only where the answer
     * is, never that the press was finished.
     */
    test("a press answered without being done: the page is told it was answered, not done", async () => {
      const token: string = await press();
      jest.spyOn(WorkspaceConnectCompletion, "complete").mockResolvedValue({
        outcome: ConnectRequestOutcome.Answered,
        answer: {
          markdown:
            "✅ **Your Slack account is connected to OneUptime.** You do not have permission to acknowledge this incident.",
          text: "Your Slack account is connected to OneUptime. You do not have permission to acknowledge this incident.",
        },
      });

      const response: ProbeResponse = await comeBack(await signIn(token));

      expect(answersPosted()).toHaveLength(1);
      expect(
        Object.fromEntries(
          new globalThis.URL(response.location!).searchParams.entries(),
        ),
      ).toEqual({
        pressed: "answered",
        slackChannel: "C0INC2",
        slackTeam: SLACK_TEAM_ID,
      });
    });

    test.each([ConnectRequestOutcome.Done, ConnectRequestOutcome.Answered])(
      "%s, but Slack takes the answer nowhere: the page does not say it is in Slack, it says to look at the record",
      async (outcome: ConnectRequestOutcome) => {
        const token: string = await press();
        jest.spyOn(WorkspaceConnectCompletion, "complete").mockResolvedValue({
          outcome: outcome,
          answer: { markdown: "Done.", text: "Done." },
        });
        jest
          .spyOn(SlackActionAnswer, "answer")
          .mockResolvedValue(SlackAnswerDelivery.None);

        const response: ProbeResponse = await comeBack(await signIn(token));

        expect(
          Object.fromEntries(
            new globalThis.URL(response.location!).searchParams.entries(),
          ),
        ).toEqual({
          pressed: "unanswered",
          slackChannel: "C0INC2",
          slackTeam: SLACK_TEAM_ID,
        });
      },
    );

    test("a response_url that is not Slack's, however it got into the press, is never posted to", async () => {
      const token: string = await press({
        slack: {
          teamId: SLACK_TEAM_ID,
          channelId: "C0INC2",
          responseUrl: "https://evil.test/hooks.slack.com/x",
        },
      });
      jest.spyOn(WorkspaceConnectCompletion, "complete").mockResolvedValue({
        outcome: ConnectRequestOutcome.Answered,
        answer: { markdown: "Done.", text: "Done." },
      });

      await comeBack(await signIn(token));

      // The channel instead, with the project's bot token.
      expect(
        answersPosted().map((call: SlackCall): string => {
          return call.url;
        }),
      ).toEqual(["https://slack.com/api/chat.postEphemeral"]);
      expect(answersPosted()[0]!.data).toMatchObject({
        channel: "C0INC2",
        user: PRESSER,
      });
    });
  });
});
