import IncomingCallRouter from "../../FeatureSet/Notification/API/IncomingCall";
import { getProjectTwilioConfig } from "../../FeatureSet/Notification/Utils/TwilioConfigHelper";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncomingCallLog from "Common/Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "Common/Models/DatabaseModels/IncomingCallLogItem";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import User from "Common/Models/DatabaseModels/User";
import UserIncomingCallNumber from "Common/Models/DatabaseModels/UserIncomingCallNumber";
import IncomingCallLogItemService from "Common/Server/Services/IncomingCallLogItemService";
import IncomingCallLogService from "Common/Server/Services/IncomingCallLogService";
import IncomingCallPolicyEscalationRuleService from "Common/Server/Services/IncomingCallPolicyEscalationRuleService";
import IncomingCallPolicyPhoneNumberService from "Common/Server/Services/IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import UserIncomingCallNumberService from "Common/Server/Services/UserIncomingCallNumberService";
import UserService from "Common/Server/Services/UserService";
import {
  createExpressApp,
  ExpressApplication,
  ExpressUrlEncoded,
} from "Common/Server/Utils/Express";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import { randomBytes } from "crypto";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { getExpectedTwilioSignature } from "twilio";

/*
 * Replays whole incoming calls the way Twilio drives them, to check what the
 * call log says once each call is over. The production incoming-call router
 * runs behind a real Express app and urlencoded parser on a loopback port,
 * with the real TwilioCallProvider: real TwiML, real request parsing and real
 * X-Twilio-Signature validation. Every request carries Twilio's own
 * parameters and is signed with the project's auth token over the public URL,
 * the way Twilio signs it before the ingress rewrites /notification to
 * /api/notification. Only the database is replaced, by an in-memory store
 * that keeps the call log and its attempts from one request to the next.
 *
 * The first scenario is issue #4219 step by step: one engineer, a 30 s ring
 * and "repeat if no one answers", with the caller hanging up 11 s in.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    HttpProtocol: "https://",
    Host: "oneuptime.example",
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Services/IncomingCallPolicyService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn(), findOneById: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncomingCallPolicyPhoneNumberService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock(
  "Common/Server/Services/IncomingCallPolicyEscalationRuleService",
  () => {
    return { __esModule: true, default: { findOneBy: jest.fn() } };
  },
);

jest.mock("Common/Server/Services/IncomingCallLogService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncomingCallLogItemService", () => {
  return {
    __esModule: true,
    default: {
      create: jest.fn(),
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/OnCallDutyPolicyScheduleService", () => {
  return {
    __esModule: true,
    default: { getCurrentUserIdInSchedule: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserIncomingCallNumberService", () => {
  return { __esModule: true, default: { findOneBy: jest.fn() } };
});

jest.mock("Common/Server/Services/UserService", () => {
  return { __esModule: true, default: { findOneById: jest.fn() } };
});

jest.mock("../../FeatureSet/Notification/Utils/TwilioConfigHelper", () => {
  return { __esModule: true, getProjectTwilioConfig: jest.fn() };
});

// The provider factory reads the provider type from here (Twilio).
jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    __esModule: true,
    CallProvider: "twilio",
    getTwilioConfig: jest.fn(),
  };
});

type JestMock = Mock<(...args: Array<any>) => any>;

const PUBLIC_BASE_URL: string =
  "https://oneuptime.example/notification/incoming-call";
const ACCOUNT_SID: string = `AC${"0123456789abcdef".repeat(2)}`;
const AUTH_TOKEN: string = "incoming-call-hang-up-auth-token";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CONFIG_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const POLICY_NUMBER: string = "+14155550102";
const CALLER_NUMBER: string = "+14155550999";
const NO_ANSWER_MESSAGE: string = "Nobody could take your call.";

interface Engineer {
  name: string;
  userId: ObjectID;
  phone: string;
}

const ALICE: Engineer = {
  name: "Alice",
  userId: new ObjectID("88888888-8888-4888-8888-888888888881"),
  phone: "+14155551001",
};
const BOB: Engineer = {
  name: "Bob",
  userId: new ObjectID("88888888-8888-4888-8888-888888888882"),
  phone: "+14155551002",
};
const CAROL: Engineer = {
  name: "Carol",
  userId: new ObjectID("88888888-8888-4888-8888-888888888883"),
  phone: "+14155551003",
};
const ENGINEERS: Array<Engineer> = [ALICE, BOB, CAROL];

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: ACCOUNT_SID,
  authToken: AUTH_TOKEN,
  primaryPhoneNumber: new Phone(POLICY_NUMBER),
  secondaryPhoneNumbers: [],
};

const CALL_START: number = Date.UTC(2026, 9, 1, 22, 0, 0);

// The call log still says the call is going on.
const OPEN_STATUSES: Array<IncomingCallStatus | undefined> = [
  IncomingCallStatus.Initiated,
  IncomingCallStatus.Ringing,
  IncomingCallStatus.Escalated,
  undefined,
];

/*
 * ------------------------------------------------------------------------
 * In-memory database
 * ------------------------------------------------------------------------
 */

interface Store {
  policy: IncomingCallPolicy;
  rules: Array<IncomingCallPolicyEscalationRule>;
  logs: Array<IncomingCallLog>;
  attempts: Array<IncomingCallLogItem>;
}

let store: Store;

const policyService: { findOneBy: JestMock; findOneById: JestMock } =
  IncomingCallPolicyService as unknown as {
    findOneBy: JestMock;
    findOneById: JestMock;
  };
const numberService: { findOneBy: JestMock } =
  IncomingCallPolicyPhoneNumberService as unknown as { findOneBy: JestMock };
const ruleService: { findOneBy: JestMock } =
  IncomingCallPolicyEscalationRuleService as unknown as {
    findOneBy: JestMock;
  };
const logService: {
  create: JestMock;
  findOneById: JestMock;
  updateOneById: JestMock;
} = IncomingCallLogService as unknown as {
  create: JestMock;
  findOneById: JestMock;
  updateOneById: JestMock;
};
const attemptService: {
  create: JestMock;
  findOneById: JestMock;
  updateOneById: JestMock;
} = IncomingCallLogItemService as unknown as {
  create: JestMock;
  findOneById: JestMock;
  updateOneById: JestMock;
};
const verifiedNumberService: { findOneBy: JestMock } =
  UserIncomingCallNumberService as unknown as { findOneBy: JestMock };
const userService: { findOneById: JestMock } = UserService as unknown as {
  findOneById: JestMock;
};
const twilioConfigLookup: JestMock =
  getProjectTwilioConfig as unknown as JestMock;

// Like the database: only the selected columns come back (plus the id).
function selectColumns<T extends BaseModel>(
  row: T,
  select: Record<string, unknown>,
): T {
  const copy: T = new (row.constructor as new () => T)();
  const from: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;
  const to: Record<string, unknown> = copy as unknown as Record<
    string,
    unknown
  >;
  for (const column of [...Object.keys(select), "_id"]) {
    to[column] = from[column];
  }
  return copy;
}

function sameId(a: ObjectID | null | undefined, b: unknown): boolean {
  return Boolean(a) && a!.toString() === String(b);
}

// QueryHelper.greaterThan(order) is a TypeORM Raw operator.
function greaterThanValue(operator: unknown): number {
  const parameters: Record<string, unknown> | undefined = (
    operator as { objectLiteralParameters?: Record<string, unknown> }
  ).objectLiteralParameters;
  const value: unknown = parameters ? Object.values(parameters)[0] : undefined;
  if (typeof value !== "number") {
    throw new Error("Expected a QueryHelper.greaterThan(order) operator");
  }
  return value;
}

function makeRule(
  order: number,
  engineer: Engineer,
  escalateAfterSeconds: number,
): IncomingCallPolicyEscalationRule {
  const rule: IncomingCallPolicyEscalationRule =
    new IncomingCallPolicyEscalationRule();
  rule.id = ObjectID.generate();
  rule.projectId = PROJECT_ID;
  rule.incomingCallPolicyId = POLICY_ID;
  rule.name = `Rule ${order}`;
  rule.order = order;
  rule.userId = engineer.userId;
  rule.escalateAfterSeconds = escalateAfterSeconds;
  return rule;
}

function givenPolicy(data: {
  rules: Array<IncomingCallPolicyEscalationRule>;
  repeatTimes?: number | undefined;
}): void {
  const policy: IncomingCallPolicy = new IncomingCallPolicy();
  policy.id = POLICY_ID;
  policy.projectId = PROJECT_ID;
  policy.projectCallSMSConfigId = CONFIG_ID;
  policy.routingPhoneNumber = new Phone(POLICY_NUMBER);
  policy.isEnabled = true;
  policy.greetingMessage = "Please hold while we reach the on-call engineer.";
  policy.noAnswerMessage = NO_ANSWER_MESSAGE;
  policy.noOneAvailableMessage = "Nobody is on call.";
  policy.repeatPolicyIfNoOneAnswers = Boolean(data.repeatTimes);
  policy.repeatPolicyIfNoOneAnswersTimes = data.repeatTimes || 1;

  store = { policy, rules: data.rules, logs: [], attempts: [] };
}

function wireDatabase(): void {
  policyService.findOneById.mockImplementation((args: any) => {
    return Promise.resolve(
      sameId(store.policy.id, args.id)
        ? selectColumns(store.policy, args.select)
        : null,
    );
  });
  policyService.findOneBy.mockResolvedValue(null);

  numberService.findOneBy.mockImplementation((args: any) => {
    const attached: IncomingCallPolicyPhoneNumber =
      new IncomingCallPolicyPhoneNumber();
    attached.id = ObjectID.generate();
    attached.projectId = PROJECT_ID;
    attached.incomingCallPolicyId = POLICY_ID;
    attached.projectCallSMSConfigId = CONFIG_ID;
    attached.phoneNumber = new Phone(POLICY_NUMBER);

    const matches: boolean =
      String(args.query.phoneNumber) === POLICY_NUMBER &&
      (args.query.incomingCallPolicyId === undefined ||
        sameId(POLICY_ID, args.query.incomingCallPolicyId));
    return Promise.resolve(
      matches ? selectColumns(attached, args.select) : null,
    );
  });

  ruleService.findOneBy.mockImplementation((args: any) => {
    const afterOrder: number = greaterThanValue(args.query.order);
    const next: IncomingCallPolicyEscalationRule | undefined = store.rules
      .filter((rule: IncomingCallPolicyEscalationRule) => {
        return (
          sameId(rule.incomingCallPolicyId, args.query.incomingCallPolicyId) &&
          (rule.order || 0) > afterOrder
        );
      })
      .sort(
        (
          a: IncomingCallPolicyEscalationRule,
          b: IncomingCallPolicyEscalationRule,
        ) => {
          return (a.order || 0) - (b.order || 0);
        },
      )[0];
    return Promise.resolve(next ? selectColumns(next, args.select) : null);
  });

  verifiedNumberService.findOneBy.mockImplementation((args: any) => {
    const engineer: Engineer | undefined = ENGINEERS.find((e: Engineer) => {
      return sameId(e.userId, args.query.userId);
    });
    if (!engineer || !sameId(PROJECT_ID, args.query.projectId)) {
      return Promise.resolve(null);
    }
    const verified: UserIncomingCallNumber = new UserIncomingCallNumber();
    verified.id = ObjectID.generate();
    verified.projectId = PROJECT_ID;
    verified.userId = engineer.userId;
    verified.phone = new Phone(engineer.phone);
    verified.isVerified = true;
    return Promise.resolve(selectColumns(verified, args.select));
  });

  userService.findOneById.mockImplementation((args: any) => {
    const engineer: Engineer | undefined = ENGINEERS.find((e: Engineer) => {
      return sameId(e.userId, args.id);
    });
    if (!engineer) {
      return Promise.resolve(null);
    }
    const user: User = new User();
    user.id = engineer.userId;
    return Promise.resolve(user);
  });

  logService.create.mockImplementation((args: any) => {
    const log: IncomingCallLog = args.data as IncomingCallLog;
    log.id = ObjectID.generate();
    store.logs.push(Object.assign(new IncomingCallLog(), log));
    return Promise.resolve(log);
  });
  logService.findOneById.mockImplementation((args: any) => {
    const log: IncomingCallLog | undefined = store.logs.find(
      (row: IncomingCallLog) => {
        return sameId(row.id, args.id);
      },
    );
    return Promise.resolve(log ? selectColumns(log, args.select) : null);
  });
  logService.updateOneById.mockImplementation((args: any) => {
    const log: IncomingCallLog | undefined = store.logs.find(
      (row: IncomingCallLog) => {
        return sameId(row.id, args.id);
      },
    );
    if (log) {
      Object.assign(log, args.data);
    }
    return Promise.resolve();
  });

  attemptService.create.mockImplementation((args: any) => {
    const attempt: IncomingCallLogItem = args.data as IncomingCallLogItem;
    attempt.id = ObjectID.generate();
    store.attempts.push(Object.assign(new IncomingCallLogItem(), attempt));
    return Promise.resolve(attempt);
  });
  attemptService.findOneById.mockImplementation((args: any) => {
    const attempt: IncomingCallLogItem | undefined = store.attempts.find(
      (row: IncomingCallLogItem) => {
        return sameId(row.id, args.id);
      },
    );
    return Promise.resolve(
      attempt ? selectColumns(attempt, args.select) : null,
    );
  });
  attemptService.updateOneById.mockImplementation((args: any) => {
    const attempt: IncomingCallLogItem | undefined = store.attempts.find(
      (row: IncomingCallLogItem) => {
        return sameId(row.id, args.id);
      },
    );
    if (attempt) {
      Object.assign(attempt, args.data);
    }
    return Promise.resolve();
  });

  twilioConfigLookup.mockImplementation((configId: ObjectID) => {
    return Promise.resolve(
      configId.toString() === CONFIG_ID.toString() ? TWILIO_CONFIG : null,
    );
  });
}

/*
 * ------------------------------------------------------------------------
 * Twilio's side of the call
 * ------------------------------------------------------------------------
 */

let server: Server;
let origin: string;

interface DialInstruction {
  action: string;
  method: string;
  timeoutSeconds: number;
  callerId: string;
  number: string;
}

interface TwimlReply {
  status: number;
  contentType: string;
  xml: string;
  says: Array<string>;
  dial: DialInstruction | null;
  hangsUp: boolean;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function readTwiml(
  status: number,
  contentType: string,
  xml: string,
): TwimlReply {
  const says: Array<string> = Array.from(
    xml.matchAll(/<Say[^>]*>([^<]*)<\/Say>/g),
  ).map((match: RegExpMatchArray) => {
    return unescapeXml(match[1] || "");
  });

  let dial: DialInstruction | null = null;
  const dialMatch: RegExpMatchArray | null = xml.match(
    /<Dial ([^>]*)>\s*<Number>([^<]+)<\/Number>\s*<\/Dial>/,
  );
  if (dialMatch) {
    const attributes: Record<string, string> = {};
    for (const attribute of (dialMatch[1] || "").matchAll(/(\w+)="([^"]*)"/g)) {
      attributes[attribute[1] || ""] = unescapeXml(attribute[2] || "");
    }
    dial = {
      action: attributes["action"] || "",
      method: attributes["method"] || "",
      timeoutSeconds: Number(attributes["timeout"]),
      callerId: attributes["callerId"] || "",
      number: unescapeXml(dialMatch[2] || ""),
    };
  }

  const hangup: RegExp = /<Hangup\s*\/>/;

  return {
    status,
    contentType,
    xml,
    says,
    dial,
    hangsUp: hangup.test(xml),
  };
}

function twilioSid(prefix: string): string {
  return `${prefix}${randomBytes(16).toString("hex")}`;
}

/*
 * Twilio signs the public URL it was given, with every POST parameter. The
 * ingress then rewrites /notification to /api/notification and forwards the
 * public scheme and host.
 */
async function twilioPost(
  publicUrl: string,
  parameters: Record<string, string>,
  signature?: string,
): Promise<TwimlReply> {
  const url: URL = new URL(publicUrl);
  const internalPath: string = url.pathname.replace(
    /^\/notification\//,
    "/api/notification/",
  );

  const response: Response = await fetch(`${origin}${internalPath}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature":
        signature ??
        getExpectedTwilioSignature(AUTH_TOKEN, publicUrl, parameters),
      "X-Forwarded-Proto": url.protocol.replace(":", ""),
      "X-Forwarded-Host": url.host,
    },
    body: new URLSearchParams(parameters).toString(),
  });

  return readTwiml(
    response.status,
    response.headers.get("content-type") || "",
    await response.text(),
  );
}

type CallerState = "on the line" | "hung up";

class InboundCall {
  public readonly callSid: string = twilioSid("CA");

  // Twilio sends these with every request about the call.
  private parameters(callStatus: string): Record<string, string> {
    return {
      AccountSid: ACCOUNT_SID,
      ApiVersion: "2010-04-01",
      CallSid: this.callSid,
      CallStatus: callStatus,
      Called: POLICY_NUMBER,
      CalledCountry: "US",
      Caller: CALLER_NUMBER,
      CallerCountry: "US",
      Direction: "inbound",
      From: CALLER_NUMBER,
      FromCountry: "US",
      To: POLICY_NUMBER,
      ToCountry: "US",
    };
  }

  // The call reaches the number: Twilio fetches its voice URL.
  public async arrive(): Promise<TwimlReply> {
    return await twilioPost(
      `${PUBLIC_BASE_URL}/voice`,
      this.parameters("ringing"),
    );
  }

  // A <Dial> ended: Twilio requests its action URL.
  public async dialEnds(
    dial: DialInstruction | null,
    data: {
      dialCallStatus: string;
      caller: CallerState;
      dialCallDuration?: number | undefined;
      signature?: string | undefined;
    },
  ): Promise<TwimlReply> {
    if (!dial) {
      throw new Error("The last reply did not dial anyone");
    }

    const parameters: Record<string, string> = {
      ...this.parameters(
        data.caller === "on the line" ? "in-progress" : "completed",
      ),
      DialCallSid: twilioSid("CA"),
      DialCallStatus: data.dialCallStatus,
      DialBridged: data.dialCallStatus === "completed" ? "true" : "false",
    };
    if (data.dialCallDuration !== undefined) {
      parameters["DialCallDuration"] = String(data.dialCallDuration);
    }

    return await twilioPost(dial.action, parameters, data.signature);
  }
}

/*
 * ------------------------------------------------------------------------
 * Reading the call log back
 * ------------------------------------------------------------------------
 */

function at(seconds: number): Date {
  return new Date(CALL_START + seconds * 1000);
}

function clockAt(seconds: number): void {
  jest.setSystemTime(at(seconds));
}

function secondsIntoCall(date: Date | undefined): number | null {
  return date ? (date.getTime() - CALL_START) / 1000 : null;
}

function onlyCallLog(): IncomingCallLog {
  expect(store.logs).toHaveLength(1);
  return store.logs[0]!;
}

interface AttemptRow {
  engineer: string;
  start: number | null;
  end: number | null;
  status: IncomingCallStatus | undefined;
  answered: boolean | undefined;
}

// The call log's timeline, as the dashboard shows it.
function timeline(): Array<AttemptRow> {
  return store.attempts.map((attempt: IncomingCallLogItem): AttemptRow => {
    const engineer: Engineer | undefined = ENGINEERS.find((e: Engineer) => {
      return sameId(e.userId, attempt.userId);
    });
    return {
      engineer: engineer?.name || "?",
      start: secondsIntoCall(attempt.startedAt),
      end: secondsIntoCall(attempt.endedAt),
      status: attempt.status,
      answered: attempt.isAnswered,
    };
  });
}

function expectEveryCallClosed(): void {
  for (const log of store.logs) {
    expect(OPEN_STATUSES).not.toContain(log.status);
    expect(log.endedAt).toBeInstanceOf(Date);
  }
  for (const attempt of store.attempts) {
    expect(attempt.status).not.toBe(IncomingCallStatus.Ringing);
    expect(attempt.endedAt).toBeInstanceOf(Date);
  }
}

beforeAll(async () => {
  const app: ExpressApplication = createExpressApp();
  app.use(ExpressUrlEncoded({ extended: true }));
  app.use(
    ["/api/notification/incoming-call", "/incoming-call"],
    IncomingCallRouter,
  );

  server = createServer(app);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  jest.clearAllMocks();
  // Only the clock is fake; sockets and the HTTP server need real timers.
  jest.useFakeTimers({
    now: CALL_START,
    doNotFake: [
      "hrtime",
      "nextTick",
      "performance",
      "queueMicrotask",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "requestIdleCallback",
      "cancelIdleCallback",
      "setImmediate",
      "clearImmediate",
      "setInterval",
      "clearInterval",
      "setTimeout",
      "clearTimeout",
    ],
  });
  wireDatabase();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("a caller who hangs up while an engineer's phone rings (#4219)", () => {
  test("one engineer, 30 s ring, repeat on: the call ends caller hung up at 11 s and nobody else is dialed", async () => {
    givenPolicy({ rules: [makeRule(1, ALICE, 30)], repeatTimes: 1 });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();

    expect(greeting.status).toBe(200);
    expect(greeting.says).toEqual([
      "Please hold while we reach the on-call engineer.",
    ]);
    expect(greeting.dial).toMatchObject({
      number: ALICE.phone,
      timeoutSeconds: 30,
      callerId: POLICY_NUMBER,
      method: "POST",
    });

    clockAt(11);
    const reply: TwimlReply = await call.dialEnds(greeting.dial, {
      dialCallStatus: "no-answer",
      caller: "hung up",
    });

    // Twilio discards this reply, but it must not try to dial anyone.
    expect(reply.status).toBe(200);
    expect(reply.contentType).toContain("text/xml");
    expect(reply.dial).toBeNull();
    expect(reply.says).toEqual([]);
    expect(reply.hangsUp).toBe(true);

    const log: IncomingCallLog = onlyCallLog();
    expect(log.status).toBe(IncomingCallStatus.CallerHungUp);
    expect(log.endedAt).toEqual(at(11));
    expect(log.repeatCount).toBe(0);
    expect(log.callProviderCallId).toBe(call.callSid);

    expect(timeline()).toEqual([
      {
        engineer: "Alice",
        start: 0,
        end: 11,
        status: IncomingCallStatus.CallerHungUp,
        answered: false,
      },
    ]);
    expectEveryCallClosed();
  });

  test("Twilio reporting the cut-off ring as canceled ends the call the same way", async () => {
    givenPolicy({ rules: [makeRule(1, ALICE, 30)], repeatTimes: 1 });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();
    clockAt(11);
    const reply: TwimlReply = await call.dialEnds(greeting.dial, {
      dialCallStatus: "canceled",
      caller: "hung up",
    });

    expect(reply.dial).toBeNull();
    expect(onlyCallLog().status).toBe(IncomingCallStatus.CallerHungUp);
    expect(timeline()).toEqual([
      expect.objectContaining({
        status: IncomingCallStatus.CallerHungUp,
        end: 11,
      }),
    ]);
    expectEveryCallClosed();
  });

  test("a hang-up on the second engineer keeps the first one's real no-answer and stops there", async () => {
    givenPolicy({
      rules: [
        makeRule(1, ALICE, 20),
        makeRule(2, BOB, 25),
        makeRule(3, CAROL, 25),
      ],
    });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();
    expect(greeting.dial?.number).toBe(ALICE.phone);

    clockAt(24);
    const toBob: TwimlReply = await call.dialEnds(greeting.dial, {
      dialCallStatus: "no-answer",
      caller: "on the line",
    });
    expect(toBob.dial).toMatchObject({ number: BOB.phone, timeoutSeconds: 25 });
    expect(onlyCallLog().status).toBe(IncomingCallStatus.Escalated);

    clockAt(31);
    const reply: TwimlReply = await call.dialEnds(toBob.dial, {
      dialCallStatus: "no-answer",
      caller: "hung up",
    });
    expect(reply.dial).toBeNull();

    const log: IncomingCallLog = onlyCallLog();
    expect(log.status).toBe(IncomingCallStatus.CallerHungUp);
    expect(log.endedAt).toEqual(at(31));
    expect(log.currentEscalationRuleOrder).toBe(2);
    expect(timeline()).toEqual([
      {
        engineer: "Alice",
        start: 0,
        end: 24,
        status: IncomingCallStatus.NoAnswer,
        answered: false,
      },
      {
        engineer: "Bob",
        start: 24,
        end: 31,
        status: IncomingCallStatus.CallerHungUp,
        answered: false,
      },
    ]);
    expectEveryCallClosed();
  });

  test("a hang-up during a repeat round does not start another one", async () => {
    givenPolicy({ rules: [makeRule(1, ALICE, 30)], repeatTimes: 3 });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();

    clockAt(34);
    const repeat: TwimlReply = await call.dialEnds(greeting.dial, {
      dialCallStatus: "no-answer",
      caller: "on the line",
    });
    expect(repeat.dial?.number).toBe(ALICE.phone);
    expect(onlyCallLog().repeatCount).toBe(1);

    clockAt(40);
    const reply: TwimlReply = await call.dialEnds(repeat.dial, {
      dialCallStatus: "no-answer",
      caller: "hung up",
    });
    expect(reply.dial).toBeNull();

    const log: IncomingCallLog = onlyCallLog();
    expect(log.status).toBe(IncomingCallStatus.CallerHungUp);
    expect(log.repeatCount).toBe(1);
    expect(timeline()).toEqual([
      {
        engineer: "Alice",
        start: 0,
        end: 34,
        status: IncomingCallStatus.NoAnswer,
        answered: false,
      },
      {
        engineer: "Alice",
        start: 34,
        end: 40,
        status: IncomingCallStatus.CallerHungUp,
        answered: false,
      },
    ]);
    expectEveryCallClosed();
  });

  test.each([1, 2, 3])(
    "a three-engineer hunt leaves nothing open when the caller hangs up on attempt %i",
    async (hangUpOnAttempt: number) => {
      givenPolicy({
        rules: [
          makeRule(1, ALICE, 20),
          makeRule(2, BOB, 20),
          makeRule(3, CAROL, 20),
        ],
        repeatTimes: 2,
      });
      const call: InboundCall = new InboundCall();

      clockAt(0);
      let reply: TwimlReply = await call.arrive();
      for (let attempt: number = 1; attempt < hangUpOnAttempt; attempt++) {
        clockAt(attempt * 24);
        reply = await call.dialEnds(reply.dial, {
          dialCallStatus: "no-answer",
          caller: "on the line",
        });
      }
      clockAt(hangUpOnAttempt * 24 - 10);
      reply = await call.dialEnds(reply.dial, {
        dialCallStatus: "no-answer",
        caller: "hung up",
      });

      expect(reply.dial).toBeNull();
      expect(onlyCallLog().status).toBe(IncomingCallStatus.CallerHungUp);
      expect(store.attempts).toHaveLength(hangUpOnAttempt);
      expect(
        timeline().map((row: AttemptRow) => {
          return row.status;
        }),
      ).toEqual([
        ...Array(hangUpOnAttempt - 1).fill(IncomingCallStatus.NoAnswer),
        IncomingCallStatus.CallerHungUp,
      ]);
      expectEveryCallClosed();
    },
  );

  test("a forged hang-up is refused and leaves the call ringing", async () => {
    givenPolicy({ rules: [makeRule(1, ALICE, 30)], repeatTimes: 1 });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();
    clockAt(11);
    const reply: TwimlReply = await call.dialEnds(greeting.dial, {
      dialCallStatus: "no-answer",
      caller: "hung up",
      signature: getExpectedTwilioSignature(
        "someone-elses-auth-token",
        greeting.dial!.action,
        {},
      ),
    });

    expect(reply.status).toBe(403);
    expect(onlyCallLog().status).toBe(IncomingCallStatus.Initiated);
    expect(onlyCallLog().endedAt).toBeUndefined();
    expect(timeline()).toEqual([
      expect.objectContaining({
        status: IncomingCallStatus.Ringing,
        end: null,
      }),
    ]);
  });
});

describe("calls the hang-up fix must leave as they were (#4219's comparisons)", () => {
  test("nobody answers at all: every attempt rings out and the call ends no answer", async () => {
    givenPolicy({ rules: [makeRule(1, ALICE, 30)], repeatTimes: 1 });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();

    clockAt(34);
    const repeat: TwimlReply = await call.dialEnds(greeting.dial, {
      dialCallStatus: "no-answer",
      caller: "on the line",
    });
    expect(repeat.says).toEqual([
      "Connecting you to the next available engineer.",
    ]);
    expect(repeat.dial).toMatchObject({ number: ALICE.phone });

    clockAt(68);
    const goodbye: TwimlReply = await call.dialEnds(repeat.dial, {
      dialCallStatus: "no-answer",
      caller: "on the line",
    });
    expect(goodbye.dial).toBeNull();
    expect(goodbye.says).toEqual([NO_ANSWER_MESSAGE]);
    expect(goodbye.hangsUp).toBe(true);

    const log: IncomingCallLog = onlyCallLog();
    expect(log.status).toBe(IncomingCallStatus.NoAnswer);
    expect(log.endedAt).toEqual(at(68));
    expect(log.repeatCount).toBe(1);
    expect(timeline()).toEqual([
      {
        engineer: "Alice",
        start: 0,
        end: 34,
        status: IncomingCallStatus.NoAnswer,
        answered: false,
      },
      {
        engineer: "Alice",
        start: 34,
        end: 68,
        status: IncomingCallStatus.NoAnswer,
        answered: false,
      },
    ]);
    expectEveryCallClosed();
  });

  test("the engineer answers and hangs up first: the call completes", async () => {
    givenPolicy({ rules: [makeRule(1, ALICE, 30)], repeatTimes: 1 });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();

    clockAt(125);
    const reply: TwimlReply = await call.dialEnds(greeting.dial, {
      dialCallStatus: "completed",
      dialCallDuration: 118,
      caller: "on the line",
    });
    expect(reply.dial).toBeNull();
    expect(reply.hangsUp).toBe(true);

    const log: IncomingCallLog = onlyCallLog();
    expect(log.status).toBe(IncomingCallStatus.Completed);
    expect(log.endedAt).toEqual(at(125));
    expect(timeline()).toEqual([
      {
        engineer: "Alice",
        start: 0,
        end: 125,
        status: IncomingCallStatus.Connected,
        answered: true,
      },
    ]);
    expect(store.attempts[0]?.dialDurationInSeconds).toBe(118);
    expectEveryCallClosed();
  });

  test("the engineer answers and the caller hangs up at the end: still completed, not caller hung up", async () => {
    givenPolicy({ rules: [makeRule(1, ALICE, 30)], repeatTimes: 1 });
    const call: InboundCall = new InboundCall();

    clockAt(0);
    const greeting: TwimlReply = await call.arrive();

    clockAt(125);
    await call.dialEnds(greeting.dial, {
      dialCallStatus: "completed",
      dialCallDuration: 118,
      caller: "hung up",
    });

    expect(onlyCallLog().status).toBe(IncomingCallStatus.Completed);
    expect(timeline()).toEqual([
      expect.objectContaining({
        status: IncomingCallStatus.Connected,
        answered: true,
      }),
    ]);
    expectEveryCallClosed();
  });

  test.each(["busy", "failed"])(
    "an engineer line that is %s, with the caller still waiting, escalates to the next engineer",
    async (dialCallStatus: string) => {
      givenPolicy({ rules: [makeRule(1, ALICE, 20), makeRule(2, BOB, 20)] });
      const call: InboundCall = new InboundCall();

      clockAt(0);
      const greeting: TwimlReply = await call.arrive();

      clockAt(3);
      const reply: TwimlReply = await call.dialEnds(greeting.dial, {
        dialCallStatus,
        caller: "on the line",
      });

      expect(reply.dial).toMatchObject({ number: BOB.phone });
      expect(onlyCallLog().status).toBe(IncomingCallStatus.Escalated);
      expect(timeline()).toEqual([
        expect.objectContaining({
          engineer: "Alice",
          status: IncomingCallStatus.NoAnswer,
        }),
        expect.objectContaining({
          engineer: "Bob",
          status: IncomingCallStatus.Ringing,
          end: null,
        }),
      ]);
    },
  );
});
