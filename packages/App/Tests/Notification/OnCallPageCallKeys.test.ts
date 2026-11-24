import { mockRouter } from "Common/Tests/Server/API/Helpers";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import UserNotificationLogTimelineAPI from "Common/Server/API/UserOnCallLogTimelineAPI";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "Common/Server/Services/ProjectCallSMSConfigService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import OnCallPagePassOn from "Common/Server/Utils/OnCall/OnCallPagePassOn";
import Response from "Common/Server/Utils/Response";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import {
  UpdateOneByInput,
  updateNotificationWhileStill,
} from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import {
  TwilioRequestLike,
  serverTwilioRow,
  signedTwilioRequest,
} from "Common/Tests/Server/TestingUtils/TwilioSignedRequests";
import { DOMParser, Element as XmlElement } from "@xmldom/xmldom";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * KEYS 1 AND 2 ANSWER EXACTLY AS BEFORE (#10762).
 *
 * The call now says everything inside its <Gather>, asks twice, and spells
 * its record's number - none of which may change what a key does. Here the
 * call is written by the worker's real template, its TwiML built by the
 * Notification service's real CallService, and each key is pressed at the
 * <Gather>'s own action - the address and token Twilio is given - as Twilio
 * posts it, signed with the account's auth token, through the keypad
 * route's real middleware and handler. The database is stood in for.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
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

const GATHER_ROUTE: string =
  "/user-notification-log-timeline/call/gather-input/:itemId";

const ITEM: ObjectID = new ObjectID("0fa10762-0000-4000-8000-0000000000b1");
const PROJECT: ObjectID = new ObjectID("0fa10762-0000-4000-8000-0000000000b2");
const RUN: ObjectID = new ObjectID("0fa10762-0000-4000-8000-0000000000b3");
const ANA: ObjectID = new ObjectID("0fa10762-0000-4000-8000-0000000000b4");
const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token-0000000000000001",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

let item: UserOnCallLogTimeline;
let updateSpy: jest.SpyInstance;
let passOnSpy: jest.SpyInstance;

function incident(): Incident {
  const model: Incident = new Incident();
  model.id = ObjectID.generate();
  model.projectId = PROJECT;
  const project: Project = new Project();
  project.name = "Acme Production";
  model.project = project;
  model.title = `Checkout <API> & "payments" are down`;
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
}

/*
 * The <Gather> action of a page's call, as the Notification service builds
 * it for Twilio: from the worker's own call request.
 */
async function actionOfCall(isObserverPage: boolean = false): Promise<string> {
  const callRequest: CallRequest =
    await UserNotificationRuleService.generateCallTemplateForIncidentCreated(
      new Phone("+15555550142"),
      incident(),
      ITEM,
      undefined,
      undefined,
      isObserverPage,
    );

  const twiml: string = CallService.generateTwimlForCall(callRequest, {
    userOnCallLogTimelineId: ITEM,
  });

  const gather: XmlElement = new DOMParser()
    .parseFromString(twiml, "text/xml")
    .getElementsByTagName("Gather")[0]!;

  expect(gather.getAttribute("input")).toBe("dtmf");

  return gather.getAttribute("action")!;
}

// A key pressed, as Twilio posts it to the call's action, signed.
async function press(
  digits: string,
  action: string,
): Promise<{ status: jest.Mock; request: TwilioRequestLike }> {
  const request: TwilioRequestLike = signedTwilioRequest({
    publicUrl: action,
    body: {
      AccountSid: SERVER_ACCOUNT.accountSid,
      CallSid: CALL_SID,
      Digits: digits,
      FinishedOnKey: "",
    },
    signedWith: SERVER_ACCOUNT.authToken,
    params: { itemId: ITEM.toString() },
  });

  const status: jest.Mock = jest.fn();
  const res: ExpressResponse = {
    status: status,
    send: jest.fn(),
  } as unknown as ExpressResponse;
  status.mockReturnValue(res);

  const route: {
    middlewares: Array<RouterFunction>;
    handlerFunction: RouterFunction;
  } = mockRouter.match("POST", GATHER_ROUTE);

  await route.middlewares[0]!(
    request as unknown as ExpressRequest,
    res,
    (async (err?: unknown) => {
      if (err) {
        throw err;
      }

      await route.handlerFunction(request as unknown as ExpressRequest, res, ((
        handlerError: unknown,
      ) => {
        throw handlerError || new Error("the handler must not fall through");
      }) as unknown as NextFunction);
    }) as unknown as NextFunction,
  );

  return { status: status, request: request };
}

// What the call said back to the key: the TwiML the route answered with.
function answeredWith(): string {
  const xml: jest.Mock = Response.sendXmlResponse as unknown as jest.Mock;

  expect(xml).toHaveBeenCalledTimes(1);

  return String(xml.mock.calls[0]![2]);
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

  // The call's notification, placed: Sent, at its first version.
  item = new UserOnCallLogTimeline();
  item.id = ITEM;
  item.projectId = PROJECT;
  item.userId = ANA;
  item.onCallDutyPolicyExecutionLogId = RUN;
  item.triggeredByIncidentId = ObjectID.generate();
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

  jest
    .spyOn(ProjectCallSMSConfigService, "findBy")
    .mockImplementation(async (): Promise<Array<ProjectCallSMSConfig>> => {
      return [];
    });
  jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return serverTwilioRow(SERVER_ACCOUNT);
    });
  jest.spyOn(logger, "warn").mockImplementation(() => {});
});

describe("a key pressed on a page's call, at the action its TwiML gives Twilio", () => {
  test("1 acknowledges the page, and the call says so", async () => {
    const { status } = await press("1", await actionOfCall());

    expect(status).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(item.status).toBe(UserNotificationStatus.Acknowledged);
    expect(answeredWith()).toContain(
      "<Say>You have acknowledged this incident. Good bye</Say>",
    );
    expect(passOnSpy).not.toHaveBeenCalled();
  });

  test("2 escalates the page, from the person paged and their run", async () => {
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

    const { status } = await press("2", await actionOfCall());

    expect(status).not.toHaveBeenCalled();
    expect(passOnSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
      viaUserOnCallLogTimelineId: ITEM,
    });
    expect(answeredWith()).toContain("<Say>You escalated this incident.");
    expect(item.status).toBe(UserNotificationStatus.Sent);
  });

  test("any other key acknowledges nothing and escalates nothing, as before", async () => {
    await press("7", await actionOfCall());

    expect(updateSpy).not.toHaveBeenCalled();
    expect(passOnSpy).not.toHaveBeenCalled();
    expect(item.status).toBe(UserNotificationStatus.Sent);
    expect(answeredWith()).toContain("<Say>Invalid input. Good bye</Say>");
  });

  test("an observer's 1 says the page is heard", async () => {
    await press("1", await actionOfCall(true));

    expect(answeredWith()).toContain(
      "<Say>Thank you. The page is marked as heard. Good bye</Say>",
    );
  });

  test("the action carries the call's own token, and no page link token", async () => {
    const action: string = await actionOfCall();
    const parsed: globalThis.URL = new globalThis.URL(action);

    expect(parsed.pathname).toBe(
      `/api/user-notification-log-timeline/call/gather-input/${ITEM.toString()}`,
    );
    expect(Array.from(parsed.searchParams.keys())).toEqual(["token"]);
  });

  test("unsigned, a key is refused: asking twice opened no other way in", async () => {
    const action: string = await actionOfCall();
    const request: TwilioRequestLike = signedTwilioRequest({
      publicUrl: action,
      body: {
        AccountSid: SERVER_ACCOUNT.accountSid,
        CallSid: CALL_SID,
        Digits: "1",
        FinishedOnKey: "",
      },
      signedWith: null,
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

    await route.middlewares[0]!(
      request as unknown as ExpressRequest,
      res,
      (async () => {
        await route.handlerFunction(
          request as unknown as ExpressRequest,
          res,
          (() => {}) as unknown as NextFunction,
        );
      }) as unknown as NextFunction,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(item.status).toBe(UserNotificationStatus.Sent);
  });
});
