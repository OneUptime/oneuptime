import UserMattermostAPI from "../../../Server/API/UserMattermostAPI";
import UserMicrosoftTeamsAPI from "../../../Server/API/UserMicrosoftTeamsAPI";
import UserSlackAPI from "../../../Server/API/UserSlackAPI";
import UserWebhookAPI from "../../../Server/API/UserWebhookAPI";
import UserMattermostService from "../../../Server/Services/UserMattermostService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import WebhookService from "../../../Server/Services/WebhookService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import BadDataException from "../../../Types/Exception/BadDataException";
import { meetsErrorMessageRule } from "../../../Types/Exception/ErrorMessageRule";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ChannelVerificationMessages } from "../../../Types/UserNotification/ChannelVerificationMessages";
import UserType from "../../../Types/UserType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import WorkspaceRefusal from "../../../Utils/Workspace/WorkspaceRefusal";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

jest.mock("../../../Server/Utils/Logger");

/*
 * WHAT A NOTIFICATION METHOD'S SEND TEST ANSWERS WHEN IT CANNOT SEND ONE
 * (#7272).
 *
 * Slack's, Microsoft Teams', Mattermost's and a webhook's Send Test
 * answered "Invalid item ID", "Item not found" and "Invalid user ID", and
 * told a method of somebody else's ("Invalid user ID") apart from one that
 * does not exist ("Item not found"). They answer as the e-mail, SMS, call
 * and WhatsApp routes do (ChannelVerificationMessages): what happened and
 * what to do next, and somebody else's method reads exactly as a missing
 * one - the same message, the same exception, the same status - so the
 * answer never says whether an id is someone's.
 *
 * A send that failed says so in OneUptime's words: a chat tool's own
 * reason when it gave one, and when it gave none that the tool did not say
 * why, with what to do next, never "Unknown error sending test Slack
 * message.".
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000011");
const SOMEONE_ELSE: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000012",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000013",
);
const ITEM_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000014");

interface TestRoute {
  name: string;
  uri: string;
  // The chat tool's name, as a failed send names it; none for a webhook.
  tool: string | null;
  // The read of the method: whose it is, or none at all.
  stubRead: (ownerId: ObjectID | null) => ReturnType<typeof getJestSpyOn>;
  // The send, stubbed to fail with `error` or to succeed.
  stubSend: (error?: Error) => ReturnType<typeof getJestSpyOn>;
}

const workspaceSend: (error?: Error) => ReturnType<typeof getJestSpyOn> = (
  error?: Error,
): ReturnType<typeof getJestSpyOn> => {
  const spy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
    WorkspaceUserNotificationService,
    "sendDirectMessageToUser",
  );

  return error
    ? spy.mockRejectedValue(error as never)
    : spy.mockResolvedValue(undefined as never);
};

// Each chat tool's workspace, by the name a failed send gives it.
const TOOL_WORKSPACES: Record<string, WorkspaceType> = {
  Slack: WorkspaceType.Slack,
  "Microsoft Teams": WorkspaceType.MicrosoftTeams,
  Mattermost: WorkspaceType.Mattermost,
};

const ROUTES: Array<TestRoute> = [
  {
    name: "POST /user-slack/test",
    uri: "/user-slack/test",
    tool: "Slack",
    stubRead: (ownerId: ObjectID | null) => {
      return getJestSpyOn(UserSlackService, "findOneById").mockResolvedValue(
        (ownerId
          ? {
              userId: ownerId,
              projectId: PROJECT_ID,
              slackUserId: "U0123456789",
              isVerified: true,
            }
          : null) as never,
      );
    },
    stubSend: workspaceSend,
  },
  {
    name: "POST /user-microsoft-teams/test",
    uri: "/user-microsoft-teams/test",
    tool: "Microsoft Teams",
    stubRead: (ownerId: ObjectID | null) => {
      return getJestSpyOn(
        UserMicrosoftTeamsService,
        "findOneById",
      ).mockResolvedValue(
        (ownerId
          ? {
              userId: ownerId,
              projectId: PROJECT_ID,
              microsoftTeamsUserId: "29:0123456789",
              isVerified: true,
            }
          : null) as never,
      );
    },
    stubSend: workspaceSend,
  },
  {
    name: "POST /user-mattermost/test",
    uri: "/user-mattermost/test",
    tool: "Mattermost",
    stubRead: (ownerId: ObjectID | null) => {
      return getJestSpyOn(
        UserMattermostService,
        "findOneById",
      ).mockResolvedValue(
        (ownerId
          ? {
              userId: ownerId,
              projectId: PROJECT_ID,
              mattermostUserId: "abcdefghijklmnopqrstuvwxyz",
              isVerified: true,
            }
          : null) as never,
      );
    },
    stubSend: workspaceSend,
  },
  {
    name: "POST /user-webhook/test",
    uri: "/user-webhook/test",
    tool: null,
    stubRead: (ownerId: ObjectID | null) => {
      return getJestSpyOn(UserWebhookService, "findOneById").mockResolvedValue(
        (ownerId
          ? {
              userId: ownerId,
              projectId: PROJECT_ID,
              webhookUrl: "https://example.com/hook",
              name: "My webhook",
            }
          : null) as never,
      );
    },
    stubSend: (error?: Error) => {
      const spy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        WebhookService,
        "sendWebhook",
      );

      return error
        ? spy.mockRejectedValue(error as never)
        : spy.mockResolvedValue({ statusCode: 200 } as never);
    },
  },
];

const requestTo: (body: JSONObject) => OneUptimeRequest = (
  body: JSONObject,
): OneUptimeRequest => {
  return {
    params: {},
    body: body,
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [PROJECT_ID],
      globalPermissions: [],
    },
  } as unknown as OneUptimeRequest;
};

type Answer =
  | { kind: "refused"; error: Error }
  | { kind: "answered"; body: JSONObject };

const send: (route: TestRoute, body: JSONObject) => Promise<Answer> = async (
  route: TestRoute,
  body: JSONObject,
): Promise<Answer> => {
  (Response.sendJsonObjectResponse as jest.Mock).mockClear();
  (Response.sendErrorResponse as jest.Mock).mockClear();

  let failure: Error | undefined = undefined;

  const res: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await mockRouter
    .match("POST", route.uri)
    .handlerFunction(requestTo(body), res, (err?: unknown): void => {
      failure = err as Error;
    });

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  if (!failure && errorCalls.length > 0) {
    failure = errorCalls[0]![2] as Error;
  }

  if (failure) {
    return { kind: "refused", error: failure };
  }

  const jsonCalls: Array<Array<unknown>> = (
    Response.sendJsonObjectResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  return { kind: "answered", body: jsonCalls[0]![2] as JSONObject };
};

const refusalOf: (answer: Answer) => Error = (answer: Answer): Error => {
  expect(answer.kind).toBe("refused");

  return (answer as { kind: "refused"; error: Error }).error;
};

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserSlackAPI();
  new UserMicrosoftTeamsAPI();
  new UserMattermostAPI();
  new UserWebhookAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ROUTES)("$name", (route: TestRoute) => {
  test("a request that names no method says which was not named, before reading any", async () => {
    const readSpy: ReturnType<typeof getJestSpyOn> = route.stubRead(USER_ID);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    const refusal: Error = refusalOf(await send(route, {}));

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(ChannelVerificationMessages.noItemToTest);
    expect(readSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("a method that does not exist says it is not in the list any more, and nothing is sent", async () => {
    route.stubRead(null);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    const refusal: Error = refusalOf(
      await send(route, { itemId: ITEM_ID.toString() }),
    );

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(refusal.message).toBe(ChannelVerificationMessages.notFound);
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("somebody else's method is answered exactly as one that does not exist, and nothing is sent", async () => {
    route.stubRead(null);
    route.stubSend();

    const missing: BadDataException = refusalOf(
      await send(route, { itemId: ITEM_ID.toString() }),
    ) as BadDataException;

    jest.restoreAllMocks();
    route.stubRead(SOMEONE_ELSE);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    const notTheirs: BadDataException = refusalOf(
      await send(route, { itemId: ITEM_ID.toString() }),
    ) as BadDataException;

    expect(notTheirs.constructor).toBe(missing.constructor);
    expect({ message: notTheirs.message, code: notTheirs.code }).toEqual({
      message: missing.message,
      code: missing.code,
    });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("the person whose method it is still sends themselves a test", async () => {
    route.stubRead(USER_ID);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    const answer: Answer = await send(route, { itemId: ITEM_ID.toString() });

    expect(answer.kind).toBe("answered");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});

describe.each(
  ROUTES.filter((route: TestRoute): boolean => {
    return route.tool !== null;
  }),
)("$name, when the send fails", (route: TestRoute) => {
  test("says the chat tool did not say why, and what to do next, when it gave no reason", async () => {
    route.stubRead(USER_ID);
    route.stubSend(new Error(""));

    const answer: Answer = await send(route, { itemId: ITEM_ID.toString() });

    expect(answer.kind).toBe("answered");

    const body: JSONObject = (answer as { kind: "answered"; body: JSONObject })
      .body;

    expect(body["ok"]).toBe(false);
    expect(body["statusMessage"]).toBe(
      `The test message was not sent, and ${route.tool} did not say why. Try again in a moment.`,
    );
    expect(meetsErrorMessageRule(body["statusMessage"] as string)).toBe(true);
    expect(body["statusMessage"]).not.toContain("Unknown error");
  });

  test("passes on the reason it was given", async () => {
    const reason: string =
      "Your account is not connected to OneUptime in this project yet. Connect it under User Settings > Workspace, then add it here.";

    route.stubRead(USER_ID);
    route.stubSend(new Error(reason));

    const answer: Answer = await send(route, { itemId: ITEM_ID.toString() });
    const body: JSONObject = (answer as { kind: "answered"; body: JSONObject })
      .body;

    expect(body).toEqual({ ok: false, statusMessage: reason });
  });

  /*
   * A refusal of the tool's is said in OneUptime's words, and the tool's own
   * answer goes beside them, for the dialog's Details (#7268): not glued
   * after the sentence ("... Slack said: is_archived.").
   */
  test("says the tool's refusal in OneUptime's words, and hands the tool's own answer on beside them", async () => {
    const workspaceType: WorkspaceType = TOOL_WORKSPACES[route.tool!]!;
    const reason: string =
      "The Slack channel is archived. Unarchive it in Slack, or pick another channel.";

    route.stubRead(USER_ID);
    route.stubSend(
      new Error(
        WorkspaceRefusal.withDetail({
          reason: reason,
          workspaceType: workspaceType,
          detail: "is_archived",
        }),
      ),
    );

    const answer: Answer = await send(route, { itemId: ITEM_ID.toString() });
    const body: JSONObject = (answer as { kind: "answered"; body: JSONObject })
      .body;

    expect(body).toEqual({
      ok: false,
      statusMessage: reason,
      otherSystemDetails: "is_archived",
    });
    expect(meetsErrorMessageRule(body["statusMessage"] as string)).toBe(true);
    expect(body["statusMessage"]).not.toContain("said:");
  });
});

describe("the words", () => {
  test("each refusal is a sentence that says what to do next, and names no field", () => {
    for (const message of [
      ChannelVerificationMessages.noItemToTest,
      ChannelVerificationMessages.notFound,
    ]) {
      expect(meetsErrorMessageRule(message)).toBe(true);
      expect(message).not.toMatch(/\b(itemId|userId|ID|Invalid|Item)\b/);
    }
  });
});
