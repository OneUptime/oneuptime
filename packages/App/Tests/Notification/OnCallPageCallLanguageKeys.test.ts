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
import { getServerTranslator } from "Common/Server/Utils/ServerTranslation";
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
 * A PAGE'S CALL IN THE PERSON'S LANGUAGE, END TO END (#11066).
 *
 * The call is written by the worker's real template, in the language of the
 * person it pages; its TwiML is built by the Notification service's real
 * CallService for an account that chose a voice; and each key is pressed at
 * the <Gather>'s own action, as Twilio posts it, signed with the account's
 * auth token, through the keypad route's real middleware and handler. The
 * call speaks German - or Japanese - by a voice of that language, and every
 * answer it gives a key is in that language and that voice. Keys 1 and 2
 * do exactly what they always did, and a request Twilio did not sign is
 * refused, whatever language its call speaks. The database is stood in for.
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

const ITEM: ObjectID = new ObjectID("0fa11066-0000-4000-8000-0000000000c1");
const PROJECT: ObjectID = new ObjectID("0fa11066-0000-4000-8000-0000000000c2");
const RUN: ObjectID = new ObjectID("0fa11066-0000-4000-8000-0000000000c3");
const ANA: ObjectID = new ObjectID("0fa11066-0000-4000-8000-0000000000c4");
const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token-0000000000000001",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

// The voice the account chose: a woman's, in US English.
const ACCOUNT_VOICE: string = "Polly.Joanna-Neural";

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
  model.title = "Checkout API is down";
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
}

// The TwiML of the page's call, through an account with `voice`, to a person who reads `language`.
async function twimlOfCall(data: {
  language: string;
  voice?: string | undefined;
  isObserverPage?: boolean | undefined;
}): Promise<string> {
  const callRequest: CallRequest =
    await UserNotificationRuleService.generateCallTemplateForIncidentCreated(
      new Phone("+15555550142"),
      incident(),
      ITEM,
      undefined,
      undefined,
      Boolean(data.isObserverPage),
      getServerTranslator(data.language),
    );

  return CallService.generateTwimlForCall(callRequest, {
    userOnCallLogTimelineId: ITEM,
    voice: data.voice,
    recordNumberPrefixes: ["#", "INC-"],
  });
}

function elementsOf(twiml: string, tag: string): Array<XmlElement> {
  return Array.from(
    new DOMParser().parseFromString(twiml, "text/xml").getElementsByTagName(tag),
  );
}

function actionOf(twiml: string): string {
  const gathers: Array<XmlElement> = elementsOf(twiml, "Gather");

  expect(gathers).toHaveLength(1);

  return gathers[0]!.getAttribute("action")!;
}

// What a TwiML says, each <Say>'s text in order.
function saidIn(twiml: string): Array<string> {
  return elementsOf(twiml, "Say").map((say: XmlElement): string => {
    return say.textContent || "";
  });
}

// Every <Say> is in `voice`, telling Twilio the language it speaks.
function expectVoice(twiml: string, voice: string, language: string): void {
  const says: Array<XmlElement> = elementsOf(twiml, "Say");

  expect(says.length).toBeGreaterThan(0);

  for (const say of says) {
    expect([say.getAttribute("voice"), say.getAttribute("language")]).toEqual([
      voice,
      language,
    ]);
  }
}

// A key pressed, as Twilio posts it to the call's action, signed (or not).
async function press(
  digits: string,
  action: string,
  signedWith: string | null = SERVER_ACCOUNT.authToken,
): Promise<{ status: jest.Mock }> {
  const request: TwilioRequestLike = signedTwilioRequest({
    publicUrl: action,
    body: {
      AccountSid: SERVER_ACCOUNT.accountSid,
      CallSid: CALL_SID,
      Digits: digits,
      FinishedOnKey: "",
    },
    signedWith: signedWith,
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

  return { status: status };
}

// A key pressed, and what the call said back to it.
async function answerTo(digits: string, action: string): Promise<string> {
  const xml: jest.Mock = Response.sendXmlResponse as unknown as jest.Mock;

  xml.mockClear();

  await press(digits, action);

  expect(xml).toHaveBeenCalledTimes(1);

  return String(xml.mock.calls[0]![2]);
}

function askedAgainAt(twiml: string): string | null {
  const gathers: Array<XmlElement> = elementsOf(twiml, "Gather");

  return gathers.length > 0 ? gathers[0]!.getAttribute("action") : null;
}

const NEXT_LEVEL_PAGED: unknown = {
  passedOn: true,
  result: {
    outcome: "NextRulePaged",
    isPreview: false,
    isDirectPage: false,
    policyName: "Payments",
    rule: { order: 2, name: "Platform leads" },
    pagedNames: ["Bob Smith"],
    stillPagedNames: [],
    ruleCount: 3,
  },
};

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

describe("a page's call to a person who reads German, through an account that chose Joanna", () => {
  test("is said in German, by Vicki, telling Twilio it speaks de-DE", async () => {
    const twiml: string = await twimlOfCall({
      language: "de",
      voice: ACCOUNT_VOICE,
    });

    expectVoice(twiml, "Polly.Vicki-Neural", "de-DE");
    expect(saidIn(twiml)).toEqual([
      "Dies ist ein Anruf von Acme Production.",
      "Ein neuer Vorfall wurde erstellt.",
      "Kritischer Vorfall INC 42.",
      "Drücken Sie 1, um zu bestätigen, oder 2, um zu eskalieren.",
      "Checkout API is down",
      "Ein neuer Vorfall wurde erstellt.",
      "Kritischer Vorfall INC 42.",
      "Checkout API is down",
      "Drücken Sie 1, um zu bestätigen, oder 2, um zu eskalieren.",
      "Sie haben keine Taste gedrückt, daher ist dieser Vorfall nicht bestätigt. Auf Wiederhören.",
    ]);
    // The record's prefix is spelled with SSML, in the German voice.
    expect(twiml).toContain(
      '<say-as interpret-as="characters">INC</say-as> 42.',
    );
  });

  test("1 acknowledges the page, as it always did, and says so in German, by Vicki", async () => {
    const answer: string = await answerTo(
      "1",
      actionOf(await twimlOfCall({ language: "de", voice: ACCOUNT_VOICE })),
    );

    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(item.status).toBe(UserNotificationStatus.Acknowledged);
    expect(answer).toContain(
      '<Say voice="Polly.Vicki-Neural" language="de-DE">Sie haben diesen Vorfall bestätigt. Auf Wiederhören</Say>',
    );
  });

  test("2 escalates the page, as it always did, and says what came of it in German, by Vicki", async () => {
    passOnSpy.mockResolvedValue(NEXT_LEVEL_PAGED as never);

    const answer: string = await answerTo(
      "2",
      actionOf(await twimlOfCall({ language: "de", voice: ACCOUNT_VOICE })),
    );

    expect(passOnSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
      viaUserOnCallLogTimelineId: ITEM,
    });
    expectVoice(answer, "Polly.Vicki-Neural", "de-DE");
    expect(saidIn(answer)).toEqual([
      "Sie haben diesen Vorfall eskaliert. Die Richtlinie alarmiert jetzt Platform leads (Stufe 2 von 3): Bob Smith. Auf Wiederhören.",
    ]);
  });

  test("a wrong key says so in German and asks again with the call's own German prompt, by Vicki", async () => {
    const answer: string = await answerTo(
      "7",
      actionOf(await twimlOfCall({ language: "de", voice: ACCOUNT_VOICE })),
    );

    expect(updateSpy).not.toHaveBeenCalled();
    expect(passOnSpy).not.toHaveBeenCalled();
    expectVoice(answer, "Polly.Vicki-Neural", "de-DE");
    expect(saidIn(answer)).toEqual([
      "Diese Taste hat keine Funktion.",
      "Drücken Sie 1, um zu bestätigen, oder 2, um zu eskalieren.",
      "Sie haben keine Taste gedrückt, daher ist dieser Vorfall nicht bestätigt. Auf Wiederhören.",
    ]);
    expect(askedAgainAt(answer)).not.toBeNull();
  });

  test("asks again twice at most, then a wrong key ends the call in German, the page left as it was", async () => {
    let action: string = actionOf(
      await twimlOfCall({ language: "de", voice: ACCOUNT_VOICE }),
    );
    let asked: number = 0;

    for (let pressed: number = 0; pressed < 10; pressed++) {
      const twiml: string = await answerTo("#", action);
      const next: string | null = askedAgainAt(twiml);

      if (!next) {
        expectVoice(twiml, "Polly.Vicki-Neural", "de-DE");
        expect(saidIn(twiml)).toEqual([
          "Diese Taste hat keine Funktion, daher ist dieser Vorfall nicht bestätigt. Auf Wiederhören.",
        ]);
        break;
      }

      asked++;
      action = next;
    }

    expect(asked).toBe(2);
    expect(item.status).toBe(UserNotificationStatus.Sent);
  });

  test("a wrong key, then 1 at the address asked again at: acknowledged, in German", async () => {
    const askedAt: string = askedAgainAt(
      await answerTo(
        "3",
        actionOf(await twimlOfCall({ language: "de", voice: ACCOUNT_VOICE })),
      ),
    )!;

    expect(await answerTo("1", askedAt)).toContain(
      "Sie haben diesen Vorfall bestätigt.",
    );
    expect(item.status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("a man's voice chosen speaks it with a man's German voice", async () => {
    const twiml: string = await twimlOfCall({
      language: "de",
      voice: "Polly.Matthew-Neural",
    });

    expectVoice(twiml, "Polly.Daniel-Neural", "de-DE");
    expectVoice(
      await answerTo("4", actionOf(twiml)),
      "Polly.Daniel-Neural",
      "de-DE",
    );
  });

  test("an observer's call is German too, and 1 says the page is heard", async () => {
    const twiml: string = await twimlOfCall({
      language: "de",
      voice: ACCOUNT_VOICE,
      isObserverPage: true,
    });

    expect(saidIn(twiml)).toContain(
      "Um zu bestätigen, dass Sie dies gehört haben, drücken Sie 1. Der Vorfall wird dadurch nicht bestätigt.",
    );
    expect(await answerTo("1", actionOf(twiml))).toContain(
      '<Say voice="Polly.Vicki-Neural" language="de-DE">Danke. Die Alarmierung ist als gehört markiert. Auf Wiederhören</Say>',
    );
  });

  test("unsigned, a key is refused, whatever language the call speaks", async () => {
    const { status } = await press(
      "1",
      actionOf(await twimlOfCall({ language: "de", voice: ACCOUNT_VOICE })),
      null,
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(updateSpy).not.toHaveBeenCalled();
    expect(item.status).toBe(UserNotificationStatus.Sent);
  });

  test("signed with another account's auth token, a key is refused", async () => {
    const { status } = await press(
      "1",
      actionOf(await twimlOfCall({ language: "de", voice: ACCOUNT_VOICE })),
      "another-accounts-auth-token-000001",
    );

    expect(status).toHaveBeenCalledWith(403);
    expect(item.status).toBe(UserNotificationStatus.Sent);
  });
});

describe("a page's call to a person who reads Japanese", () => {
  test("is said in Japanese by Kazuha, and answers every key in it", async () => {
    const twiml: string = await twimlOfCall({
      language: "ja",
      voice: "Google.en-US-Neural2-F",
    });

    expectVoice(twiml, "Polly.Kazuha-Neural", "ja-JP");
    expect(saidIn(twiml).slice(0, 4)).toEqual([
      "Acme Production からのお電話です。",
      "新しいインシデントが作成されました。",
      "重大インシデント INC 42。",
      "確認するには 1 を、エスカレーションするには 2 を押してください。",
    ]);

    const again: string = await answerTo("9", actionOf(twiml));

    expectVoice(again, "Polly.Kazuha-Neural", "ja-JP");
    expect(saidIn(again)[0]).toBe("そのキーには何も割り当てられていません。");

    expect(await answerTo("1", askedAgainAt(again)!)).toContain(
      '<Say voice="Polly.Kazuha-Neural" language="ja-JP">このインシデントを確認しました。失礼いたします</Say>',
    );
    expect(item.status).toBe(UserNotificationStatus.Acknowledged);
  });
});

describe("the English fallback", () => {
  test("an account that chose no voice speaks English, as every call did: its default voice speaks no German", async () => {
    const twiml: string = await twimlOfCall({ language: "de" });

    for (const say of elementsOf(twiml, "Say")) {
      expect(say.hasAttribute("voice")).toBe(false);
      expect(say.hasAttribute("language")).toBe(false);
    }

    expect(saidIn(twiml)[1]).toBe(
      "A new Critical Incident has been created: I N C 42.",
    );
    expect(saidIn(await answerTo("7", actionOf(twiml)))[0]).toBe(
      "That key does nothing.",
    );
  });

  test("a person who reads Persian hears English, in the voice the account chose", async () => {
    const twiml: string = await twimlOfCall({
      language: "fa",
      voice: ACCOUNT_VOICE,
    });

    expectVoice(twiml, ACCOUNT_VOICE, "en-US");
    expect(saidIn(twiml)[0]).toBe("This is a call from Acme Production.");

    passOnSpy.mockResolvedValue(NEXT_LEVEL_PAGED as never);

    expect(saidIn(await answerTo("2", actionOf(twiml)))).toEqual([
      "You escalated this incident. The policy is now paging Platform leads (Level 2 of 3): Bob Smith. Good bye.",
    ]);
  });
});
