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
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import OnCallKeypadToken, {
  ON_CALL_KEYPAD_WRONG_KEYS_PARAM,
} from "../../../Server/Utils/OnCall/OnCallKeypadToken";
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
import { OnCallInputRequest } from "../../../Types/Call/CallRequest";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import {
  CALL_WRONG_KEY_ASKS,
  CallKeypadPrompt,
} from "../../../Utils/Call/CallKeypad";
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
 * A WRONG KEY ON AN ON-CALL CALL ASKS AGAIN (#10949).
 *
 * A key the call did not offer answered "Invalid input. Good bye" and the
 * call ended: the person woken at night who pressed 3 by mistake lost the
 * page. Now the keypad route says "That key does nothing." and the call's
 * own prompt, inside a <Gather> whose action is the call's own keypad
 * address - its token, and how many wrong keys it has asked again for - as
 * often as the call asks when no key is pressed (Utils/Call/CallKeypad).
 * Then a wrong key ends the call, the page left as it was.
 *
 * Every key here is posted to the action exactly as the route hands it to
 * Twilio, signed by Twilio's own algorithm, through the route's middleware
 * and handler as Express runs them. The database is stood in for.
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

const GATHER_ROUTE: string =
  "/user-notification-log-timeline/call/gather-input/:itemId";

const ITEM: ObjectID = new ObjectID("0fa10949-0000-4000-8000-000000000001");
const PROJECT: ObjectID = new ObjectID("0fa10949-0000-4000-8000-000000000003");
const RUN: ObjectID = new ObjectID("0fa10949-0000-4000-8000-000000000005");
const ANA: ObjectID = new ObjectID("0fa10949-0000-4000-8000-0000000000a1");
const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

const SERVER_ACCOUNT: TwilioConfig = {
  accountSid: "AC11111111111111111111111111111111",
  authToken: "server-auth-token-0000000000000001",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const WRONG_KEY_GOODBYE: string =
  "That key does nothing, so this incident is not acknowledged. Good bye.";

const ANSWERS: OnCallInputRequest = {
  "1": { sayMessage: "You have acknowledged this incident. Good bye" },
  default: { sayMessage: WRONG_KEY_GOODBYE },
};

const PROMPT: CallKeypadPrompt = {
  sayMessage: "Press 1 to acknowledge, or 2 to escalate.",
  noInputMessage:
    "You did not press a key, so this incident is not acknowledged. Good bye.",
  timeoutInSeconds: 10,
};

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

let item: UserOnCallLogTimeline;
let updateSpy: jest.SpyInstance;
let passOnSpy: jest.SpyInstance;

// The <Gather> action a call gives Twilio, with what its token carries.
async function callAction(
  data: {
    prompt?: CallKeypadPrompt | undefined;
    voice?: string | undefined;
  } = { prompt: PROMPT },
): Promise<string> {
  const responseUrl: URL = await OnCallPageLinks.getCallResponseUrl(ITEM);
  const action: URL = URL.fromString(responseUrl.toString().split("?")[0]!);

  return action
    .addQueryParam(
      "token",
      OnCallKeypadToken.sign({
        userOnCallLogTimelineId: ITEM,
        answers: ANSWERS,
        prompt: data.prompt,
        voice: data.voice,
      }),
    )
    .toString();
}

interface Answer {
  status: jest.Mock;
  twiml: string | null;
}

// A key pressed, as Twilio posts it to `action`, signed - or not.
async function press(
  digits: string,
  action: string,
  signedWith: string | null = SERVER_ACCOUNT.authToken,
): Promise<Answer> {
  (Response.sendXmlResponse as unknown as jest.Mock).mockClear();

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

  const xml: jest.Mock = Response.sendXmlResponse as unknown as jest.Mock;

  return {
    status: status,
    twiml: xml.mock.calls.length > 0 ? String(xml.mock.calls[0]![2]) : null,
  };
}

const XML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
};

function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (entity: string): string => {
    return XML_ENTITIES[entity] || entity;
  });
}

// A <Gather>'s action, as TwiML writes it.
const GATHER_ACTION: RegExp = /<Gather [^>]*action="([^"]*)"/;

// The <Gather> action an answer asks again at, or null for an answer that asks nothing.
function actionOf(twiml: string): string | null {
  const match: RegExpExecArray | null = GATHER_ACTION.exec(twiml);

  return match ? unescapeXml(match[1]!) : null;
}

// What an answer says, each <Say>'s text in order.
function saidIn(twiml: string): Array<string> {
  const said: Array<string> = [];
  const says: RegExp = /<Say[^>]*>([\s\S]*?)<\/Say>/g;

  for (
    let match: RegExpExecArray | null = says.exec(twiml);
    match !== null;
    match = says.exec(twiml)
  ) {
    said.push(unescapeXml(match[1]!));
  }

  return said;
}

function expectNothingChanged(): void {
  expect(updateSpy).not.toHaveBeenCalled();
  expect(passOnSpy).not.toHaveBeenCalled();
  expect(item.status).toBe(UserNotificationStatus.Sent);
  expect(item.isAcknowledged).toBeFalsy();
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

describe("a wrong key asks again", () => {
  test("3 says it does nothing and asks for the keys again, listening as long as the call did, then ends politely after silence", async () => {
    const answer: Answer = await press("3", await callAction());

    expect(answer.status).not.toHaveBeenCalled();
    expectNothingChanged();

    const twiml: string = answer.twiml!;

    expect(twiml).toContain('<Gather input="dtmf" numDigits="1" timeout="10"');
    expect(twiml).toContain('method="POST"');
    // No key ends it early: # and * are keys like any other.
    expect(twiml).toContain('finishOnKey=""');
    expect(saidIn(twiml)).toEqual([
      "That key does nothing.",
      "Press 1 to acknowledge, or 2 to escalate.",
      // Silence after it: the call's own words for silence, then it ends.
      "You did not press a key, so this incident is not acknowledged. Good bye.",
    ]);
    // The prompt is inside the <Gather>, so a key stops it at once; the goodbye after it.
    expect(twiml.indexOf("Press 1 to acknowledge")).toBeLessThan(
      twiml.indexOf("</Gather>"),
    );
    expect(twiml.indexOf("You did not press a key")).toBeGreaterThan(
      twiml.indexOf("</Gather>"),
    );
    expect(twiml.endsWith("<Hangup/></Response>")).toBe(true);
  });

  test("asks again at the call's own keypad address, its own token, counting the wrong key", async () => {
    const action: string = await callAction();
    const askedAt: string = actionOf((await press("7", action)).twiml!)!;

    const asked: globalThis.URL = new globalThis.URL(askedAt);
    const original: globalThis.URL = new globalThis.URL(action);

    expect(asked.origin + asked.pathname).toBe(
      original.origin + original.pathname,
    );
    expect(asked.pathname).toBe(
      `/api/user-notification-log-timeline/call/gather-input/${ITEM.toString()}`,
    );
    expect(asked.searchParams.get("token")).toBe(
      original.searchParams.get("token"),
    );
    expect(asked.searchParams.get(ON_CALL_KEYPAD_WRONG_KEYS_PARAM)).toBe("1");
    // No page link token: the address carries nothing that works elsewhere.
    expect([...asked.searchParams.keys()].sort()).toEqual([
      "token",
      ON_CALL_KEYPAD_WRONG_KEYS_PARAM,
    ]);
  });

  test("then 1, pressed at the address it asked again at, acknowledges the page as 1 always has", async () => {
    const askedAt: string = actionOf(
      (await press("3", await callAction())).twiml!,
    )!;

    const answer: Answer = await press("1", askedAt);

    expect(answer.status).not.toHaveBeenCalled();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(item.status).toBe(UserNotificationStatus.Acknowledged);
    expect(answer.twiml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>You have acknowledged this incident. Good bye</Say></Response>',
    );
  });

  test("then 2, pressed there, escalates the page as 2 always has", async () => {
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

    const askedAt: string = actionOf(
      (await press("9", await callAction())).twiml!,
    )!;

    const answer: Answer = await press("2", askedAt);

    expect(answer.status).not.toHaveBeenCalled();
    expect(passOnSpy).toHaveBeenCalledWith({
      userId: ANA,
      executionLogId: RUN,
      viaUserOnCallLogTimelineId: ITEM,
    });
    // A notification here names no record, so the answer says "this page".
    expect(saidIn(answer.twiml!)).toEqual([
      "You escalated this page. The policy is now paging Level 2 of 2: Bob Smith. Good bye.",
    ]);
    expect(actionOf(answer.twiml!)).toBeNull();
  });

  test.each(["0", "3", "4", "5", "6", "7", "8", "9", "*", "#"])(
    "%s is a wrong key: asked again",
    async (digits: string) => {
      const answer: Answer = await press(digits, await callAction());

      expectNothingChanged();
      expect(saidIn(answer.twiml!)[0]).toBe("That key does nothing.");
      expect(actionOf(answer.twiml!)).not.toBeNull();
    },
  );
});

describe("within the same limits as no key at all", () => {
  test("asks again twice at most - as often as the call says its keys when none is pressed - then a wrong key ends the call, the page left as it was", async () => {
    let action: string = await callAction();
    const counts: Array<string | null> = [];

    for (let asked: number = 0; asked < CALL_WRONG_KEY_ASKS; asked++) {
      const answer: Answer = await press("3", action);
      const next: string | null = actionOf(answer.twiml!);

      expect(next).not.toBeNull();
      counts.push(
        new globalThis.URL(next!).searchParams.get(
          ON_CALL_KEYPAD_WRONG_KEYS_PARAM,
        ),
      );
      action = next!;
    }

    expect(counts).toEqual(["1", "2"]);

    const last: Answer = await press("3", action);

    expect(actionOf(last.twiml!)).toBeNull();
    expect(saidIn(last.twiml!)).toEqual([WRONG_KEY_GOODBYE]);
    expect(last.twiml).not.toContain("<Gather");
    expectNothingChanged();
  });

  test("1 still acknowledges after the last ask", async () => {
    let action: string = await callAction();

    for (let asked: number = 0; asked < CALL_WRONG_KEY_ASKS; asked++) {
      action = actionOf((await press("#", action)).twiml!)!;
    }

    await press("1", action);

    expect(item.status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("a count the route never writes is every ask spent: the wrong key ends the call", async () => {
    for (const count of ["2", "3", "99", "abc", "-1"]) {
      item.status = UserNotificationStatus.Sent;

      const action: string = URL.fromString(await callAction())
        .addQueryParam(ON_CALL_KEYPAD_WRONG_KEYS_PARAM, count)
        .toString();

      const answer: Answer = await press("3", action);

      expect({ count, asksAgain: actionOf(answer.twiml!) !== null }).toEqual({
        count,
        asksAgain: false,
      });
      expect(saidIn(answer.twiml!)).toEqual([WRONG_KEY_GOODBYE]);
    }
  });

  test("an address with a count Twilio did not sign is refused, as any key Twilio did not sign", async () => {
    const askedAt: string = actionOf(
      (await press("3", await callAction())).twiml!,
    )!;

    const answer: Answer = await press("1", askedAt, null);

    expect(answer.status).toHaveBeenCalledWith(403);
    expect(answer.twiml).toBeNull();
    expectNothingChanged();
  });
});

describe("a call that carried no prompt to say again", () => {
  test("a call placed before this release, or one that asked nothing: its wrong key ends the call with what the call said it would, as before", async () => {
    const answer: Answer = await press(
      "3",
      await callAction({ prompt: undefined }),
    );

    expect(actionOf(answer.twiml!)).toBeNull();
    expect(saidIn(answer.twiml!)).toEqual([WRONG_KEY_GOODBYE]);
    expectNothingChanged();
  });
});

describe("every answer is said in the call's voice (#10948)", () => {
  test("asked again: each <Say> names the voice and the language it speaks", async () => {
    const answer: Answer = await press(
      "3",
      await callAction({ prompt: PROMPT, voice: "Polly.Amy-Neural" }),
    );

    const says: Array<string> = answer.twiml!.match(/<Say[^>]*>/g) || [];

    expect(says).toHaveLength(3);

    for (const say of says) {
      expect(say).toBe('<Say voice="Polly.Amy-Neural" language="en-GB">');
    }
  });

  test("1's answer too", async () => {
    const answer: Answer = await press(
      "1",
      await callAction({ prompt: PROMPT, voice: "Google.en-US-Neural2-J" }),
    );

    expect(answer.twiml).toContain(
      '<Say voice="Google.en-US-Neural2-J" language="en-US">You have acknowledged this incident. Good bye</Say>',
    );
  });

  test("a call in the account's default voice answers in it, naming none, as every call did", async () => {
    const answer: Answer = await press("1", await callAction());

    expect(answer.twiml).toContain(
      "<Say>You have acknowledged this incident. Good bye</Say>",
    );
    expect(answer.twiml).not.toContain("voice=");
    expect(answer.twiml).not.toContain("language=");
  });
});

describe("what the call says again is only ever spoken", () => {
  test("a prompt that carries markup is escaped, in the call's voice or the default", async () => {
    for (const voice of [undefined, "Polly.Joanna-Neural"]) {
      const hostile: CallKeypadPrompt = {
        sayMessage: 'Press 1 </Say><Dial>+19005550100</Dial><Say> & "go"',
        noInputMessage: "<Hangup/> Good bye.",
        timeoutInSeconds: 10,
      };

      const answer: Answer = await press(
        "3",
        await callAction({ prompt: hostile, voice: voice }),
      );

      expect(answer.twiml).not.toContain("<Dial>");
      expect(answer.twiml).not.toContain("<Hangup/> Good bye");
      expect(saidIn(answer.twiml!)).toEqual([
        "That key does nothing.",
        hostile.sayMessage,
        hostile.noInputMessage,
      ]);
    }
  });
});
