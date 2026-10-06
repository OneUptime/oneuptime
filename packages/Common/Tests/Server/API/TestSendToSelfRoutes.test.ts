import UserMicrosoftTeamsAPI from "../../../Server/API/UserMicrosoftTeamsAPI";
import UserPushAPI from "../../../Server/API/UserPushAPI";
import UserSlackAPI from "../../../Server/API/UserSlackAPI";
import UserWebhookAPI from "../../../Server/API/UserWebhookAPI";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import WebhookService from "../../../Server/Services/WebhookService";
import WorkspaceUserNotificationService from "../../../Server/Services/WorkspaceUserNotificationService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
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
 * The tests a person sends to themselves - "will a page reach me?" - from
 * their own notification methods:
 *
 *   POST /user-slack/test                     a direct message to their Slack account
 *   POST /user-microsoft-teams/test           a direct message to their Teams account
 *   POST /user-webhook/test                   a request to their own webhook
 *   POST /user-push/:deviceId/test-notification   a push to their own device
 *
 * They ask the send-to-self half of the rule (TestSendAccess
 * .assertMaySendTestToSelf): a signed-in person, on a credential that may
 * make changes. A credential issued for reading only never sends anything,
 * and is refused before the method is even read. Whose method it is, each
 * route checks against the record, as it did.
 */

const USER_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000001");
const SOMEONE_ELSE: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000003",
);
const ITEM_ID: ObjectID = new ObjectID("7f000000-0000-4000-8000-000000000004");

type Answer = "sent" | Error;

interface SelfTestRoute {
  name: string;
  uri: string;
  body: Record<string, unknown>;
  params: Record<string, string>;
  // The read of the person's own method, stubbed with whose it is.
  stubRead: (ownerId: ObjectID) => ReturnType<typeof getJestSpyOn>;
  // The send, stubbed: how many times it ran.
  stubSend: () => ReturnType<typeof getJestSpyOn>;
}

const ROUTES: Array<SelfTestRoute> = [
  {
    name: "POST /user-slack/test",
    uri: "/user-slack/test",
    body: { itemId: ITEM_ID.toString() },
    params: {},
    stubRead: (ownerId: ObjectID) => {
      return getJestSpyOn(UserSlackService, "findOneById").mockResolvedValue({
        userId: ownerId,
        projectId: PROJECT_ID,
        slackUserId: "U0123456789",
        isVerified: true,
      } as never);
    },
    stubSend: () => {
      return getJestSpyOn(
        WorkspaceUserNotificationService,
        "sendDirectMessageToUser",
      ).mockResolvedValue(undefined as never);
    },
  },
  {
    name: "POST /user-microsoft-teams/test",
    uri: "/user-microsoft-teams/test",
    body: { itemId: ITEM_ID.toString() },
    params: {},
    stubRead: (ownerId: ObjectID) => {
      return getJestSpyOn(
        UserMicrosoftTeamsService,
        "findOneById",
      ).mockResolvedValue({
        userId: ownerId,
        projectId: PROJECT_ID,
        microsoftTeamsUserId: "29:0123456789",
        isVerified: true,
      } as never);
    },
    stubSend: () => {
      return getJestSpyOn(
        WorkspaceUserNotificationService,
        "sendDirectMessageToUser",
      ).mockResolvedValue(undefined as never);
    },
  },
  {
    name: "POST /user-webhook/test",
    uri: "/user-webhook/test",
    body: { itemId: ITEM_ID.toString() },
    params: {},
    stubRead: (ownerId: ObjectID) => {
      return getJestSpyOn(UserWebhookService, "findOneById").mockResolvedValue({
        userId: ownerId,
        projectId: PROJECT_ID,
        webhookUrl: "https://example.com/hook",
        name: "My webhook",
      } as never);
    },
    stubSend: () => {
      return getJestSpyOn(WebhookService, "sendWebhook").mockResolvedValue({
        statusCode: 200,
      } as never);
    },
  },
  {
    name: "POST /user-push/:deviceId/test-notification",
    uri: "/user-push/:deviceId/test-notification",
    body: {},
    params: { deviceId: ITEM_ID.toString() },
    stubRead: (ownerId: ObjectID) => {
      return getJestSpyOn(UserPushService, "findOneById").mockResolvedValue({
        userId: ownerId,
        deviceName: "My phone",
        deviceToken: "device-token",
        deviceType: "web",
        isVerified: true,
        projectId: PROJECT_ID,
      } as never);
    },
    stubSend: () => {
      return getJestSpyOn(
        PushNotificationService,
        "sendPushNotification",
      ).mockResolvedValue(undefined as never);
    },
  },
];

const requestFrom: (
  route: SelfTestRoute,
  options?: { readOnlyCredential?: boolean | undefined; anonymous?: boolean },
) => OneUptimeRequest = (
  route: SelfTestRoute,
  options?: { readOnlyCredential?: boolean | undefined; anonymous?: boolean },
): OneUptimeRequest => {
  if (options?.anonymous) {
    return {
      params: route.params,
      body: route.body,
      headers: {},
      query: {},
      userType: UserType.Public,
    } as unknown as OneUptimeRequest;
  }

  const req: Record<string, unknown> = {
    params: route.params,
    body: route.body,
    headers: {},
    query: {},
    userType: UserType.User,
    userAuthorization: { userId: USER_ID, isMasterAdmin: false },
  };

  if (options?.readOnlyCredential !== undefined) {
    req["mcpOAuth"] = {
      grantId: new ObjectID("7f000000-0000-4000-8000-000000000005"),
      clientId: "test-mcp-client",
      clientName: "Test MCP client",
      isReadOnly: options.readOnlyCredential,
    };
  }

  return req as unknown as OneUptimeRequest;
};

const send: (
  route: SelfTestRoute,
  req: OneUptimeRequest,
) => Promise<Answer> = async (
  route: SelfTestRoute,
  req: OneUptimeRequest,
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
    .handlerFunction(req, res, (err?: unknown): void => {
      failure = err as Error;
    });

  const errorCalls: Array<Array<unknown>> = (
    Response.sendErrorResponse as jest.Mock
  ).mock.calls as Array<Array<unknown>>;

  if (!failure && errorCalls.length > 0) {
    failure = errorCalls[0]![2] as Error;
  }

  if (failure) {
    return failure;
  }

  return "sent";
};

beforeAll(() => {
  mockRouter.routes.length = 0;
  new UserSlackAPI();
  new UserMicrosoftTeamsAPI();
  new UserWebhookAPI();
  new UserPushAPI();
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(ROUTES)("$name", (route: SelfTestRoute) => {
  test("the person whose method it is sends themselves a test", async () => {
    route.stubRead(USER_ID);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    expect(await send(route, requestFrom(route))).toBe("sent");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  test("a credential issued for reading only is refused before the method is read, and nothing is sent", async () => {
    const readSpy: ReturnType<typeof getJestSpyOn> = route.stubRead(USER_ID);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    const answer: Answer = await send(
      route,
      requestFrom(route, { readOnlyCredential: true }),
    );

    expect(answer).toBeInstanceOf(NotAuthorizedException);
    expect((answer as Error).message).toBe(
      DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
    );
    expect(readSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("the same person through a credential that may make changes sends it", async () => {
    route.stubRead(USER_ID);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    expect(
      await send(route, requestFrom(route, { readOnlyCredential: false })),
    ).toBe("sent");
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  test("no credentials at all is 401, and nothing is read or sent", async () => {
    const readSpy: ReturnType<typeof getJestSpyOn> = route.stubRead(USER_ID);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    const answer: Answer = await send(
      route,
      requestFrom(route, { anonymous: true }),
    );

    expect(answer).toBeInstanceOf(NotAuthenticatedException);
    expect(readSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  test("someone else's method is refused, and nothing is sent", async () => {
    route.stubRead(SOMEONE_ELSE);
    const sendSpy: ReturnType<typeof getJestSpyOn> = route.stubSend();

    expect(await send(route, requestFrom(route))).toBeInstanceOf(Error);
    expect(sendSpy).not.toHaveBeenCalled();
  });
});
