/*
 * The alert/incident services reach the isolated-vm native addon through the
 * template renderer they import. Nothing here runs a sandbox.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import { mockRouter } from "./Helpers";
import UserNotificationLogTimelineAPI from "../../../Server/API/UserOnCallLogTimelineAPI";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import NotificationMiddleware from "../../../Server/Middleware/NotificationMiddleware";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import logger from "../../../Server/Utils/Logger";
import OnCallPageLinks from "../../../Server/Utils/OnCall/OnCallPageLinks";
import OnCallPagePassOn from "../../../Server/Utils/OnCall/OnCallPagePassOn";
import Response from "../../../Server/Utils/Response";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import URL from "../../../Types/API/URL";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  UpdateOneByInput,
  updateNotificationWhileStill,
} from "../TestingUtils/OnCallTimelineRows";
import {
  TwilioRequestLike,
  serverTwilioRow,
  signedTwilioRequest,
} from "../TestingUtils/TwilioSignedRequests";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A KEY PRESSED ON AN ON-CALL CALL REACHES THE PAGE ONLY AS TWILIO SIGNED IT
 * (#9979).
 *
 * An on-call call asks the person to press 1 to acknowledge, or 2 to
 * escalate, with a <Gather> whose action is
 * /api/user-notification-log-timeline/call/gather-input/:itemId - the call's
 * signed token and the page's own in its query (OnCallPageLinks, CallService).
 * Twilio posts the key there, and signs the request with the auth token of
 * the account that placed the call: the project's own Twilio config, or the
 * OneUptime server's. The tokens travel in a URL - Twilio's request logs, a
 * proxy's access log - so the route also checks Twilio's signature: a request
 * Twilio did not sign acknowledges nothing, escalates nothing, says nothing,
 * and is logged with why, none of its tokens in the log.
 *
 * The requests here are posted to the action URL exactly as a call gives it
 * to Twilio, signed by Twilio's own algorithm (getExpectedTwilioSignature),
 * and run through the route's middleware and handler as Express runs them.
 * The database is stood in for.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    render: jest.fn(),
    redirect: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendXmlResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
  };
});

const BASE: string = "/user-notification-log-timeline";
const GATHER_ROUTE: string = `${BASE}/call/gather-input/:itemId`;

const ITEM: ObjectID = new ObjectID("0f910000-0000-4000-8000-000000000001");
const PROJECT: ObjectID = new ObjectID("0f910000-0000-4000-8000-000000000003");
const RUN: ObjectID = new ObjectID("0f910000-0000-4000-8000-000000000005");
const ANA: ObjectID = new ObjectID("0f910000-0000-4000-8000-0000000000a1");
const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token-0000000000000001",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const PROJECT_ACCOUNT: TwilioConfig = {
  accountSid: "AC22222222222222222222222222222222",
  authToken: "project-auth-token-000000000000002",
  primaryPhoneNumber: new Phone("+14155550199"),
  secondaryPhoneNumbers: [],
};

// What each key answers, as the call carries it in its own signed token.
const ON_INPUT: JSONObject = {
  "1": { sayMessage: "You have acknowledged this incident. Good bye" },
  default: { sayMessage: "Invalid input. Good bye" },
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

interface Answer {
  status: jest.Mock;
  send: jest.Mock;
  // Whether the request got past the call's signed token, to the handler.
  reachedHandler: boolean;
}

let item: UserOnCallLogTimeline;
let projectConfigs: Array<ProjectCallSMSConfig>;
let updateSpy: jest.SpyInstance;
let passOnSpy: jest.SpyInstance;
let findConfigsSpy: jest.SpyInstance;
let findGlobalConfigSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

// A project's own Twilio config on an account, as the database holds it.
function projectConfig(account: TwilioConfig): ProjectCallSMSConfig {
  const row: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  row.id = ObjectID.generate();
  row.projectId = PROJECT;
  row.twilioAccountSID = account.accountSid;
  row.twilioAuthToken = account.authToken;
  row.twilioPrimaryPhoneNumber = account.primaryPhoneNumber!;

  return row;
}

/*
 * The <Gather> action a call gives Twilio: the page's address with its own
 * token, and the call's token, which says what each key answers
 * (CallService.generateTwimlForCall).
 */
async function actionUrl(): Promise<string> {
  const responseUrl: URL = await OnCallPageLinks.getCallResponseUrl(ITEM);

  return responseUrl
    .addQueryParam(
      "token",
      JSONWebToken.signJsonPayload(
        JSONFunctions.serialize(ON_INPUT),
        OneUptimeDate.getDayInSeconds(),
      ),
    )
    .toString();
}

// The key pressed, as Twilio posts it to the action URL - signed with `signedWith`.
async function press(data: {
  digits: string;
  account?: TwilioConfig | undefined;
  signedWith?: string | null | undefined;
  signedBody?: Record<string, string> | undefined;
  url?: string | undefined;
}): Promise<{ request: TwilioRequestLike; answer: Answer }> {
  const account: TwilioConfig = data.account || SERVER_ACCOUNT;
  const request: TwilioRequestLike = signedTwilioRequest({
    publicUrl: data.url || (await actionUrl()),
    body: {
      AccountSid: account.accountSid,
      CallSid: CALL_SID,
      Digits: data.digits,
      FinishedOnKey: "",
    },
    signedWith:
      data.signedWith === undefined ? account.authToken : data.signedWith,
    signedBody: data.signedBody
      ? {
          AccountSid: account.accountSid,
          CallSid: CALL_SID,
          FinishedOnKey: "",
          ...data.signedBody,
        }
      : undefined,
    params: { itemId: ITEM.toString() },
  });

  const status: jest.Mock = jest.fn();
  const send: jest.Mock = jest.fn();
  const res: ExpressResponse = {
    status: status,
    send: send,
  } as unknown as ExpressResponse;
  status.mockReturnValue(res);

  const route: {
    middlewares: Array<RouterFunction>;
    handlerFunction: RouterFunction;
  } = mockRouter.match("POST", GATHER_ROUTE);

  let reachedHandler: boolean = false;

  // As Express runs it: the middleware, then - when it calls next - the handler.
  await route.middlewares[0]!(
    request as unknown as ExpressRequest,
    res,
    (async (err?: unknown) => {
      if (err) {
        throw err;
      }

      reachedHandler = true;

      await route.handlerFunction(request as unknown as ExpressRequest, res, ((
        handlerError: unknown,
      ) => {
        throw handlerError || new Error("the handler must not fall through");
      }) as unknown as NextFunction);
    }) as unknown as NextFunction,
  );

  return {
    request: request,
    answer: { status: status, send: send, reachedHandler: reachedHandler },
  };
}

function said(): string {
  const xml: jest.Mock = Response.sendXmlResponse as unknown as jest.Mock;

  expect(xml).toHaveBeenCalledTimes(1);

  return String(xml.mock.calls[0]![2]);
}

// A refused key press: 403, and nothing acknowledged, escalated or said.
function expectRefused(answer: Answer): void {
  expect(answer.reachedHandler).toBe(true);
  expect(answer.status).toHaveBeenCalledWith(403);
  expect(answer.send).toHaveBeenCalledWith("Forbidden");
  expect(updateSpy).not.toHaveBeenCalled();
  expect(passOnSpy).not.toHaveBeenCalled();
  expect(Response.sendXmlResponse).not.toHaveBeenCalled();
  expect(item.status).toBe(UserNotificationStatus.Sent);
  expect(item.isAcknowledged).toBeFalsy();
}

function expectAcknowledged(answer: Answer): void {
  expect(answer.status).not.toHaveBeenCalled();
  expect(updateSpy).toHaveBeenCalledTimes(1);
  expect(item.status).toBe(UserNotificationStatus.Acknowledged);
  expect(said()).toContain("You have acknowledged this incident. Good bye");
}

beforeAll(() => {
  new UserNotificationLogTimelineAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  (Response.sendErrorResponse as unknown as jest.Mock).mockClear();
  (Response.sendXmlResponse as unknown as jest.Mock).mockClear();

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.example.com"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);

  // A call's notification, placed: Sent, at its first version.
  item = new UserOnCallLogTimeline();
  item.id = ITEM;
  item.projectId = PROJECT;
  item.userId = ANA;
  item.onCallDutyPolicyExecutionLogId = RUN;
  item.status = UserNotificationStatus.Sent;
  item.version = 1;

  jest
    .spyOn(UserOnCallLogTimelineService, "findOneById")
    .mockImplementation(async (): Promise<UserOnCallLogTimeline | null> => {
      return item;
    });
  updateSpy = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneBy")
    .mockImplementation((async (updateBy: UpdateOneByInput) => {
      return updateNotificationWhileStill(item, updateBy);
    }) as never);
  passOnSpy = jest.spyOn(OnCallPagePassOn, "passOn");

  projectConfigs = [];
  findConfigsSpy = jest
    .spyOn(ProjectCallSMSConfigService, "findBy")
    .mockImplementation(async (): Promise<Array<ProjectCallSMSConfig>> => {
      return projectConfigs;
    });
  findGlobalConfigSpy = jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return serverTwilioRow(SERVER_ACCOUNT);
    });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
});

describe("the keypad route", () => {
  test("checks the call's signed token first, then - in the handler - Twilio's signature", () => {
    const route: { middlewares: Array<RouterFunction> } = mockRouter.match(
      "POST",
      GATHER_ROUTE,
    );

    expect(route.middlewares).toEqual([
      NotificationMiddleware.isValidCallNotificationRequest,
    ]);
  });
});

describe("a key Twilio signed", () => {
  test("on the server's own account: 1 acknowledges the page", async () => {
    const { answer } = await press({ digits: "1" });

    expectAcknowledged(answer);
    expect(findConfigsSpy).toHaveBeenCalledTimes(1);
    expect(
      ((findConfigsSpy.mock.calls[0]![0] as JSONObject)["query"] as JSONObject)[
        "projectId"
      ],
    ).toEqual(PROJECT);
  });

  test("on the project's own Twilio config: 1 acknowledges the page, and the server's settings are not read", async () => {
    projectConfigs = [projectConfig(PROJECT_ACCOUNT)];

    const { answer } = await press({ digits: "1", account: PROJECT_ACCOUNT });

    expectAcknowledged(answer);
    expect(findGlobalConfigSpy).not.toHaveBeenCalled();
  });

  test("still needs the call's own token: without it, nothing is read or written", async () => {
    const url: string = (await actionUrl()).replace(/&token=[^&]+/, "");

    expect(url).toContain("pageToken=");
    expect(url).not.toContain("&token=");

    const { answer } = await press({ digits: "1", url: url });

    expect(answer.reachedHandler).toBe(false);
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(
      (
        (Response.sendErrorResponse as unknown as jest.Mock).mock
          .calls[0]![2] as Error
      ).message,
    ).toBe("Invalid token");
    expect(updateSpy).not.toHaveBeenCalled();
    expect(findConfigsSpy).not.toHaveBeenCalled();
  });

  test("2 on a call that offered it escalates the page", async () => {
    passOnSpy.mockResolvedValue({
      passedOn: true,
      result: {
        outcome: "NextRulePaged",
        isPreview: false,
        isDirectPage: false,
        policyName: "Payments",
        rule: { order: 2, name: "Level 2" },
        pagedNames: ["Bob Smith"],
        stillPagedNames: [],
        ruleCount: 2,
      },
    } as never);

    const { answer } = await press({ digits: "2" });

    expect(answer.status).not.toHaveBeenCalled();
    expect(passOnSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
      viaUserOnCallLogTimelineId: ITEM,
    });
  });
});

describe("a key Twilio did not sign acknowledges nothing, escalates nothing, says nothing", () => {
  test("unsigned", async () => {
    const { answer } = await press({ digits: "1", signedWith: null });

    expectRefused(answer);
  });

  test("signed with another auth token", async () => {
    const { answer } = await press({
      digits: "1",
      signedWith: "an-auth-token-nobody-here-holds",
    });

    expectRefused(answer);
  });

  test("a body changed on the way - 2 made 1 - no longer matches the signature", async () => {
    const { answer } = await press({
      digits: "1",
      signedBody: { Digits: "2" },
    });

    expectRefused(answer);
  });

  test("2, unsigned, escalates nothing", async () => {
    const { answer } = await press({ digits: "2", signedWith: null });

    expectRefused(answer);
  });

  test("an account that placed none of this project's calls, even signed with its own auth token", async () => {
    projectConfigs = [projectConfig(PROJECT_ACCOUNT)];

    const { answer } = await press({
      digits: "1",
      account: {
        ...PROJECT_ACCOUNT,
        accountSid: "AC33333333333333333333333333333333",
        authToken: "a-strangers-auth-token-00000000003",
      },
    });

    expectRefused(answer);
  });

  test("the refusal is logged with why - none of the address's tokens, no auth token, no whole account SID", async () => {
    const { request } = await press({
      digits: "1",
      signedWith: "an-auth-token-nobody-here-holds",
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);

    const logged: string = String(warnSpy.mock.calls[0]![0]);

    expect(logged).toContain(
      `Twilio callback refused: the keypad callback for on-call notification ${ITEM.toString()}. Its X-Twilio-Signature does not match the one Twilio account AC…1111 makes for https://oneuptime.example.com/api/user-notification-log-timeline/call/gather-input/${ITEM.toString()}?pageToken=…&token=…`,
    );
    expect(logged).not.toContain(request.query["pageToken"]!);
    expect(logged).not.toContain(request.query["token"]!);
    expect(logged).not.toContain(SERVER_ACCOUNT.authToken);
    expect(logged).not.toContain(SERVER_ACCOUNT.accountSid);
  });

  test("a notification that is gone is refused as before, before any account is read", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(null);

    const { answer } = await press({ digits: "1", signedWith: null });

    expect(answer.status).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalledTimes(1);
    expect(findConfigsSpy).not.toHaveBeenCalled();
    expect(findGlobalConfigSpy).not.toHaveBeenCalled();
  });
});
