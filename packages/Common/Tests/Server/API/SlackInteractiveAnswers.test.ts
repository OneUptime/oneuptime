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
import WorkspaceProjectAuthToken from "../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../Models/DatabaseModels/WorkspaceUserAuthToken";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import WorkspaceProjectAuthTokenService from "../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "../../../Server/Services/WorkspaceUserAuthTokenService";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";
import WorkspaceActionAuthorization from "../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import WorkspaceConnectRequest, {
  WorkspaceConnectRequestRecord,
} from "../../../Server/Utils/Workspace/WorkspaceConnectRequest";
import { CONNECT_REQUEST_TOKEN_PATTERN } from "../../../Types/Workspace/ConnectCallback";
import {
  httpRequest,
  ProbeResponse,
  RunningApp,
  startApp,
} from "./WorkspaceOAuthTestHelpers";

/*
 * CUSTOMER FEEDBACK #1, THROUGH SLACK'S OWN ENDPOINT.
 *
 * "Someone added to an incident channel, not connected to OneUptime,
 * pressed Acknowledge. Nothing happens on the channel." The answers went to
 * the app's direct messages - "Unfortunately your slack account is not
 * connected to OneUptime..." - twice, because they pressed twice.
 *
 * POST /api/slack/interactive with what Slack posts for a press, through the
 * real authorization (only its database reads are stubbed): Slack gets its
 * empty 200 at once, so the button never shows a timeout, and the person
 * is answered where they pressed - at the press's response_url, a message
 * only they see in the channel - with a Connect button. Never a direct
 * message. These pin every request made to Slack.
 */

jest.mock("../../../Server/Middleware/SlackAuthorization", () => {
  return {
    __esModule: true,
    default: {
      // The signature check has its own tests; these drive what follows it.
      isAuthorizedSlackRequest: (
        _req: unknown,
        _res: unknown,
        next: () => void,
      ): void => {
        next();
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

const ROUTE: string = "/api/slack/interactive";
const DASHBOARD_URL: string = "https://oneuptime.test/dashboard";
const SLACK_TEAM_ID: string = "T0TEAM";
const PRESSER: string = "U0NITIN";
const RESPONSE_URL: string =
  "https://hooks.slack.com/actions/T0TEAM/1760000000/abcDEF123";
const PROJECT_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-000000000001",
);

interface SlackCall {
  url: string;
  data: JSONObject;
}

describe("POST /slack/interactive: a press is answered where it was made", () => {
  let app: RunningApp;
  let slackCalls: Array<SlackCall>;
  let linkedUser: ObjectID | null;
  let isMember: boolean;

  beforeAll(async () => {
    const SlackAPI: any = (await import("../../../Server/API/SlackAPI"))
      .default;

    app = await startApp([new SlackAPI().getRouter()]);
  }, 600000);

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    slackCalls = [];
    linkedUser = null;
    isMember = true;
    (
      jest.requireMock("../../../Server/Infrastructure/GlobalCache") as {
        default: { store: Map<string, unknown> };
      }
    ).default.store.clear();

    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        const projectAuth: WorkspaceProjectAuthToken =
          new WorkspaceProjectAuthToken();
        projectAuth.projectId = PROJECT_ID;
        projectAuth.authToken = "xoxb-project-token";
        projectAuth.miscData = { botUserId: "B0BOT" } as never;
        return projectAuth;
      }) as never);
    // The workspace's connections, as WorkspaceProjectResolution reads them.
    jest
      .spyOn(WorkspaceProjectAuthTokenService, "findBy")
      .mockImplementation((async (...args: Array<unknown>) => {
        const projectAuth: unknown = await (
          WorkspaceProjectAuthTokenService.findOneBy as unknown as (
            ...args: Array<unknown>
          ) => Promise<unknown>
        )(...args);
        return projectAuth ? [projectAuth] : [];
      }) as never);
    jest
      .spyOn(WorkspaceUserAuthTokenService, "findOneBy")
      .mockImplementation((async () => {
        if (!linkedUser) {
          return null;
        }

        const userAuth: WorkspaceUserAuthToken = new WorkspaceUserAuthToken();
        userAuth.userId = linkedUser;
        userAuth.authToken = "xoxp-user-token";
        return userAuth;
      }) as never);
    jest
      .spyOn(WorkspaceActionAuthorization, "isProjectMember")
      .mockImplementation(async () => {
        return isMember;
      });
    jest
      .spyOn(DatabaseConfig, "getDashboardUrl")
      .mockResolvedValue(URL.fromString(DASHBOARD_URL));
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("OneUptime");

    // Slack: every request is recorded, and taken.
    jest.spyOn(API, "post").mockImplementation((async (options: {
      url: URL;
      data: JSONObject;
    }) => {
      slackCalls.push({ url: options.url.toString(), data: options.data });
      return new HTTPResponse<JSONObject>(200, { ok: true }, {});
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // What Slack posts for a button pressed on a message in a thread.
  function buttonPress(actionId: string, value: string): JSONObject {
    return {
      type: "block_actions",
      user: { id: PRESSER, username: "nitin", name: "Nitin" },
      team: { id: SLACK_TEAM_ID },
      channel: { id: "C0INC2", name: "incident-inc-2" },
      container: {
        type: "message",
        channel_id: "C0INC2",
        message_ts: "1760000000.000200",
        thread_ts: "1760000000.000100",
      },
      message: { ts: "1760000000.000200", thread_ts: "1760000000.000100" },
      response_url: RESPONSE_URL,
      trigger_id: "1760000000.trigger",
      actions: [{ action_id: actionId, value: value }],
    };
  }

  function post(payload: JSONObject): Promise<ProbeResponse> {
    return httpRequest({
      port: app.port,
      method: "POST",
      path: ROUTE,
      body: { payload: JSON.stringify(payload) },
      timeoutMs: 20000,
    });
  }

  /*
   * Slack is answered first; the answer to the person follows it. Waits for
   * `count` requests to Slack, for `attempts` tens of milliseconds at most.
   */
  async function answersAfter(
    count: number,
    attempts: number = 200,
  ): Promise<Array<SlackCall>> {
    for (let wait: number = 0; wait < attempts; wait++) {
      if (slackCalls.length >= count) {
        break;
      }

      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 10);
      });
    }

    return slackCalls;
  }

  // The section text of an answer, and its Connect button.
  function readAnswer(call: SlackCall): {
    text: string;
    connectUrl: string | null;
  } {
    const blocks: Array<JSONObject> = call.data["blocks"] as Array<JSONObject>;
    const section: JSONObject = blocks[0]!;
    const actions: JSONObject | undefined = blocks.find(
      (block: JSONObject): boolean => {
        return block["type"] === "actions";
      },
    );
    const button: JSONObject | undefined = (
      actions?.["elements"] as Array<JSONObject> | undefined
    )?.[0];

    return {
      text: (section["text"] as JSONObject)["text"] as string,
      connectUrl: button ? (button["url"] as string) : null,
    };
  }

  test("Acknowledge from an account nobody connected: an empty 200 for Slack, then one answer only the presser sees, under the message, with a Connect button", async () => {
    const incidentId: string = ObjectID.generate().toString();

    const response: ProbeResponse = await post(
      buttonPress("AcknowledgeIncident", incidentId),
    );

    // Slack's three seconds: answered at once, with nothing to show.
    expect(response.status).toBe(200);
    expect(response.body).toBe(null);

    const calls: Array<SlackCall> = await answersAfter(1);

    // One answer, at the press's response_url - never chat.postMessage to a DM.
    expect(
      calls.map((call: SlackCall): string => {
        return call.url;
      }),
    ).toEqual([RESPONSE_URL]);
    expect(calls[0]!.data["response_type"]).toBe("ephemeral");
    expect(calls[0]!.data["replace_original"]).toBe(false);

    const answer: { text: string; connectUrl: string | null } = readAnswer(
      calls[0]!,
    );

    // master: "Unfortunately your slack account is not connected to OneUptime..."
    expect(answer.text).toBe(
      "🔗 ​*Connect your Slack account to acknowledge this incident.*​ It takes one click, and OneUptime acknowledges it for you as soon as you're connected.\n",
    );

    const url: globalThis.URL = new globalThis.URL(answer.connectUrl || "");
    expect(`${url.origin}${url.pathname}`).toBe(
      `${DASHBOARD_URL}/${PROJECT_ID.toString()}/user-settings/slack-integration`,
    );
    const token: string | null = url.searchParams.get("connect");
    expect(token).toMatch(CONNECT_REQUEST_TOKEN_PATTERN);

    // The press, kept for this Slack account, with where to answer it.
    const request: WorkspaceConnectRequestRecord | null =
      await WorkspaceConnectRequest.peek(token);
    expect(request).toMatchObject({
      workspaceUserId: PRESSER,
      purpose: "acknowledge this incident",
      slack: {
        teamId: SLACK_TEAM_ID,
        channelId: "C0INC2",
        threadTs: "1760000000.000100",
        responseUrl: RESPONSE_URL,
      },
    });
    expect(request!.pendingAction!.eventId.toString()).toBe(incidentId);
  });

  test("pressed twice: two answers, both under the message - the second press is not met with silence, nor a second DM", async () => {
    const incidentId: string = ObjectID.generate().toString();

    await post(buttonPress("AcknowledgeIncident", incidentId));
    await answersAfter(1);
    await post(buttonPress("AcknowledgeIncident", incidentId));

    const calls: Array<SlackCall> = await answersAfter(2);

    expect(
      calls.map((call: SlackCall): string => {
        return call.url;
      }),
    ).toEqual([RESPONSE_URL, RESPONSE_URL]);
  });

  test("someone removed from the project: told so where they pressed, with no Connect button", async () => {
    linkedUser = ObjectID.generate();
    isMember = false;

    const response: ProbeResponse = await post(
      buttonPress("ResolveIncident", ObjectID.generate().toString()),
    );

    expect(response.status).toBe(200);

    const calls: Array<SlackCall> = await answersAfter(1);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(RESPONSE_URL);
    expect(readAnswer(calls[0]!)).toEqual({
      text: "Your OneUptime account is not a member of this project. Ask a project admin to invite you, then try again.\n",
      connectUrl: null,
    });
  });

  test.each([
    ["the Connect button's own click", "ConnectSlackAccount"],
    ["Join call", "JoinVideoCall"],
    ["View Alert Episode", "ViewAlertEpisode"],
    ["View Incident Episode", "ViewIncidentEpisode"],
    ["View Monitor", "ViewMonitor"],
    ["View On-Call Policy", "ViewOnCallPolicy"],
  ])(
    "%s - a link button - from an account nobody connected: acknowledged, and nobody is told to connect",
    async (_name: string, actionId: string) => {
      const response: ProbeResponse = await post(
        buttonPress(actionId, ObjectID.generate().toString()),
      );

      expect(response.status).toBe(200);
      // Long enough for an answer to have gone out, were one sent.
      await answersAfter(1, 30);
      expect(slackCalls).toEqual([]);
    },
  );
});
