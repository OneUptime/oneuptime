import { mockRouter } from "Common/Tests/Server/API/Helpers";
import IncomingCallLogItemService from "Common/Server/Services/IncomingCallLogItemService";
import IncomingCallLogService from "Common/Server/Services/IncomingCallLogService";
import IncomingCallPolicyEscalationRuleService from "Common/Server/Services/IncomingCallPolicyEscalationRuleService";
import IncomingCallPolicyPhoneNumberService from "Common/Server/Services/IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import UserIncomingCallNumberService from "Common/Server/Services/UserIncomingCallNumberService";
import UserService from "Common/Server/Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import IncomingCallLog from "Common/Models/DatabaseModels/IncomingCallLog";
import IncomingCallLogItem from "Common/Models/DatabaseModels/IncomingCallLogItem";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "Common/Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import IncomingCallPolicyPhoneNumber from "Common/Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import User from "Common/Models/DatabaseModels/User";
import UserIncomingCallNumber from "Common/Models/DatabaseModels/UserIncomingCallNumber";
import { ICallProvider } from "Common/Types/Call/CallProvider";
import IncomingCallStatus from "Common/Types/IncomingCall/IncomingCallStatus";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import CallProviderFactory from "../../FeatureSet/Notification/Providers/CallProviderFactory";
import { getProjectTwilioConfig } from "../../FeatureSet/Notification/Utils/TwilioConfigHelper";

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      error: jest.fn(),
      debug: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Services/IncomingCallPolicyService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(),
      findOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncomingCallPolicyPhoneNumberService", () => {
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock(
  "Common/Server/Services/IncomingCallPolicyEscalationRuleService",
  () => {
    return {
      __esModule: true,
      default: { findOneBy: jest.fn() },
    };
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
  return {
    __esModule: true,
    default: { findOneBy: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Providers/CallProviderFactory", () => {
  return {
    __esModule: true,
    default: { getProviderWithConfig: jest.fn() },
  };
});

jest.mock("../../FeatureSet/Notification/Utils/TwilioConfigHelper", () => {
  return {
    __esModule: true,
    getProjectTwilioConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    __esModule: true,
    HttpProtocol: "https://",
    Host: "oneuptime.example",
  };
});

import "../../FeatureSet/Notification/API/IncomingCall";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const POLICY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CONFIG_PRIMARY: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333331",
);
const CONFIG_SECOND: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333332",
);
const CALL_LOG_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CALL_LOG_ITEM_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_CALL_LOG_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444445",
);
const NEXT_CALL_LOG_ITEM_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RULE_1_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777771",
);
const RULE_2_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777772",
);
const USER_1: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888881");
const USER_2: ObjectID = new ObjectID("88888888-8888-4888-8888-888888888882");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

const PRIMARY_NUMBER: string = "+14155550101";
const SECOND_NUMBER: string = "+14155550102";
const CALLER_NUMBER: string = "+14155550999";
const USER_1_NUMBER: string = "+14155551001";
const USER_2_NUMBER: string = "+14155551002";

type JestMock = Mock<(...args: Array<any>) => any>;

const PRIMARY_CONFIG: {
  accountSid: string;
  authToken: string;
  primaryPhoneNumber: Phone;
  secondaryPhoneNumbers: Array<Phone>;
} = {
  accountSid: "AC-primary",
  authToken: "primary-token",
  primaryPhoneNumber: new Phone(PRIMARY_NUMBER),
  secondaryPhoneNumbers: [],
};
const SECOND_CONFIG: typeof PRIMARY_CONFIG = {
  accountSid: "AC-second",
  authToken: "second-token",
  primaryPhoneNumber: new Phone(SECOND_NUMBER),
  secondaryPhoneNumbers: [],
};

interface ProviderMocks {
  searchAvailableNumbers: JestMock;
  listOwnedNumbers: JestMock;
  purchaseNumber: JestMock;
  assignExistingNumber: JestMock;
  releaseNumber: JestMock;
  updateWebhookUrl: JestMock;
  generateGreetingResponse: JestMock;
  generateDialResponse: JestMock;
  generateHangupResponse: JestMock;
  generateEscalationResponse: JestMock;
  parseIncomingCallWebhook: JestMock;
  parseDialStatusWebhook: JestMock;
  validateWebhookSignature: JestMock;
}

const provider: ProviderMocks = {
  searchAvailableNumbers: jest.fn(),
  listOwnedNumbers: jest.fn(),
  purchaseNumber: jest.fn(),
  assignExistingNumber: jest.fn(),
  releaseNumber: jest.fn(),
  updateWebhookUrl: jest.fn(),
  generateGreetingResponse: jest.fn(),
  generateDialResponse: jest.fn(),
  generateHangupResponse: jest.fn(),
  generateEscalationResponse: jest.fn(),
  parseIncomingCallWebhook: jest.fn(),
  parseDialStatusWebhook: jest.fn(),
  validateWebhookSignature: jest.fn(),
};

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
const logItemService: {
  create: JestMock;
  findOneById: JestMock;
  updateOneById: JestMock;
} = IncomingCallLogItemService as unknown as {
  create: JestMock;
  findOneById: JestMock;
  updateOneById: JestMock;
};
const scheduleService: { getCurrentUserIdInSchedule: JestMock } =
  OnCallDutyPolicyScheduleService as unknown as {
    getCurrentUserIdInSchedule: JestMock;
  };
const incomingNumberService: { findOneBy: JestMock } =
  UserIncomingCallNumberService as unknown as { findOneBy: JestMock };
const userService: { findOneById: JestMock } = UserService as unknown as {
  findOneById: JestMock;
};
const providerFactory: { getProviderWithConfig: JestMock } =
  CallProviderFactory as unknown as { getProviderWithConfig: JestMock };
const twilioConfig: JestMock = getProjectTwilioConfig as unknown as JestMock;

function makePolicy(data?: {
  enabled?: boolean | undefined;
  configId?: ObjectID | undefined;
  primaryPhone?: string | undefined;
  repeat?: boolean | undefined;
  repeatTimes?: number | undefined;
  noAnswerMessage?: string | undefined;
  noOneAvailableMessage?: string | undefined;
  greetingMessage?: string | undefined;
}): IncomingCallPolicy {
  const policy: IncomingCallPolicy = new IncomingCallPolicy();
  policy.id = POLICY_ID;
  policy.projectId = PROJECT_ID;
  policy.projectCallSMSConfigId = data?.configId || CONFIG_PRIMARY;
  policy.routingPhoneNumber = new Phone(data?.primaryPhone || PRIMARY_NUMBER);
  policy.isEnabled = data?.enabled ?? true;
  policy.repeatPolicyIfNoOneAnswers = data?.repeat ?? false;
  policy.repeatPolicyIfNoOneAnswersTimes = data?.repeatTimes ?? 1;
  policy.greetingMessage = data?.greetingMessage || "Welcome to on-call";
  policy.noAnswerMessage = data?.noAnswerMessage || "Nobody answered";
  policy.noOneAvailableMessage =
    data?.noOneAvailableMessage || "Nobody is available";
  return policy;
}

function makeAttachedNumber(data?: {
  phone?: string | undefined;
  configId?: ObjectID | undefined;
}): IncomingCallPolicyPhoneNumber {
  const number: IncomingCallPolicyPhoneNumber =
    new IncomingCallPolicyPhoneNumber();
  number.incomingCallPolicyId = POLICY_ID;
  number.projectId = PROJECT_ID;
  number.projectCallSMSConfigId = data?.configId || CONFIG_SECOND;
  number.phoneNumber = new Phone(data?.phone || SECOND_NUMBER);
  number.callProviderPhoneNumberId = "PN-second";
  return number;
}

function makeRule(data?: {
  id?: ObjectID | undefined;
  order?: number | undefined;
  userId?: ObjectID | undefined;
  scheduleId?: ObjectID | undefined;
  timeout?: number | undefined;
}): IncomingCallPolicyEscalationRule {
  const rule: IncomingCallPolicyEscalationRule =
    new IncomingCallPolicyEscalationRule();
  rule.id = data?.id || RULE_1_ID;
  rule.incomingCallPolicyId = POLICY_ID;
  rule.order = data?.order ?? 1;
  if (data?.userId) {
    rule.userId = data.userId;
  }
  if (data?.scheduleId) {
    rule.onCallDutyPolicyScheduleId = data.scheduleId;
  }
  rule.escalateAfterSeconds = data?.timeout ?? 30;
  return rule;
}

function makeVerifiedNumber(
  userId: ObjectID,
  phone: string,
): UserIncomingCallNumber {
  const number: UserIncomingCallNumber = new UserIncomingCallNumber();
  number.projectId = PROJECT_ID;
  number.userId = userId;
  number.phone = new Phone(phone);
  number.isVerified = true;
  return number;
}

function makeUser(id: ObjectID): User {
  const user: User = new User();
  user.id = id;
  return user;
}

function makeCallLog(data?: {
  routingPhone?: string | undefined;
  currentOrder?: number | undefined;
  repeatCount?: number | undefined;
}): IncomingCallLog {
  const log: IncomingCallLog = new IncomingCallLog();
  log.id = CALL_LOG_ID;
  log.projectId = PROJECT_ID;
  log.incomingCallPolicyId = POLICY_ID;
  if (data?.routingPhone !== undefined) {
    if (data.routingPhone) {
      log.routingPhoneNumber = new Phone(data.routingPhone);
    } else {
      delete log.routingPhoneNumber;
    }
  } else {
    log.routingPhoneNumber = new Phone(SECOND_NUMBER);
  }
  log.currentEscalationRuleOrder = data?.currentOrder ?? 1;
  log.repeatCount = data?.repeatCount ?? 0;
  return log;
}

function makeCallLogItem(
  incomingCallLogId: ObjectID = CALL_LOG_ID,
): IncomingCallLogItem {
  const item: IncomingCallLogItem = new IncomingCallLogItem();
  item.id = CALL_LOG_ITEM_ID;
  item.incomingCallLogId = incomingCallLogId;
  return item;
}

interface Invocation {
  request: ExpressRequest;
  response: ExpressResponse;
  next: JestMock;
  status: JestMock;
  type: JestMock;
  send: JestMock;
}

async function invoke(
  route: "/voice" | "/dial-status/:callLogId/:callLogItemId",
  data?: {
    body?: Record<string, unknown> | undefined;
    params?: Record<string, string | undefined> | undefined;
    signature?: string | undefined;
  },
): Promise<Invocation> {
  const send: JestMock = jest.fn();
  const response: ExpressResponse = {} as ExpressResponse;
  const status: JestMock = jest.fn(() => {
    return response;
  });
  const type: JestMock = jest.fn(() => {
    return response;
  });
  (response as any).status = status;
  (response as any).type = type;
  (response as any).send = send;
  send.mockImplementation(() => {
    return response;
  });

  const request: ExpressRequest = {
    body: data?.body || {},
    params: data?.params || {},
    headers: {
      "x-twilio-signature": data?.signature ?? "valid-signature",
    },
    originalUrl: `/api/notification/incoming-call${route}`,
    baseUrl: "/api/notification/incoming-call",
    path: route,
    protocol: "https",
    get: jest.fn((name: string): string | undefined => {
      if (name === "host") {
        return "oneuptime.example";
      }
      return undefined;
    }),
  } as unknown as ExpressRequest;
  const next: JestMock = jest.fn();

  await mockRouter
    .match("post", route)
    .handlerFunction(request, response, next as unknown as NextFunction);

  return { request, response, next, status, type, send };
}

function voiceBody(to: string = SECOND_NUMBER): Record<string, string> {
  return {
    To: to,
    From: CALLER_NUMBER,
    CallSid: "CA-incoming",
  };
}

function dialBody(status: string = "no-answer"): Record<string, string> {
  return {
    CallSid: "CA-incoming",
    DialCallStatus: status,
    DialCallDuration: status === "completed" ? "42" : "7",
  };
}

function expectError(next: JestMock, message: string): void {
  expect(next).toHaveBeenCalledTimes(1);
  expect(next.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ message }));
}

function configureProviderDefaults(): void {
  providerFactory.getProviderWithConfig.mockReturnValue(
    provider as unknown as ICallProvider,
  );
  twilioConfig.mockImplementation((configId: ObjectID) => {
    return Promise.resolve(
      configId.toString() === CONFIG_SECOND.toString()
        ? SECOND_CONFIG
        : PRIMARY_CONFIG,
    );
  });
  provider.validateWebhookSignature.mockReturnValue(true);
  provider.parseIncomingCallWebhook.mockImplementation(
    (request: ExpressRequest) => {
      return {
        callId: String(request.body["CallSid"]),
        callerPhoneNumber: String(request.body["From"]),
        calledPhoneNumber: String(request.body["To"] || request.body["Called"]),
      };
    },
  );
  provider.parseDialStatusWebhook.mockImplementation(
    (request: ExpressRequest) => {
      return {
        callId: String(request.body["CallSid"]),
        dialStatus: String(request.body["DialCallStatus"]),
        dialDurationSeconds: Number(request.body["DialCallDuration"] || 0),
      };
    },
  );
  provider.generateEscalationResponse.mockReturnValue(
    "<Response><Dial/></Response>",
  );
  provider.generateHangupResponse.mockReturnValue(
    "<Response><Hangup/></Response>",
  );
}

function configureUserAndRuleDefaults(): void {
  ruleService.findOneBy.mockResolvedValue(
    makeRule({ order: 1, userId: USER_1 }),
  );
  incomingNumberService.findOneBy.mockResolvedValue(
    makeVerifiedNumber(USER_1, USER_1_NUMBER),
  );
  userService.findOneById.mockResolvedValue(makeUser(USER_1));
  scheduleService.getCurrentUserIdInSchedule.mockResolvedValue(USER_1);
}

function configureLogDefaults(): void {
  logService.create.mockImplementation(
    ({ data }: { data: IncomingCallLog }): Promise<IncomingCallLog> => {
      data.id = CALL_LOG_ID;
      return Promise.resolve(data);
    },
  );
  logService.updateOneById.mockResolvedValue(undefined);
  logItemService.create.mockImplementation(
    ({ data }: { data: IncomingCallLogItem }): Promise<IncomingCallLogItem> => {
      data.id = NEXT_CALL_LOG_ITEM_ID;
      return Promise.resolve(data);
    },
  );
  logItemService.updateOneById.mockResolvedValue(undefined);
}

describe("incoming call voice routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureProviderDefaults();
    configureUserAndRuleDefaults();
    configureLogDefaults();
    numberService.findOneBy.mockResolvedValue(makeAttachedNumber());
    policyService.findOneById.mockResolvedValue(makePolicy());
    policyService.findOneBy.mockResolvedValue(null);
  });

  test("routes a call through the exact second attachment and keeps its caller id", async () => {
    const result: Invocation = await invoke("/voice", {
      body: voiceBody(SECOND_NUMBER),
    });

    expect(numberService.findOneBy).toHaveBeenCalledWith({
      query: { phoneNumber: expect.any(Phone) },
      select: {
        incomingCallPolicyId: true,
        projectCallSMSConfigId: true,
        phoneNumber: true,
      },
      props: { isRoot: true },
    });
    expect(
      numberService.findOneBy.mock.calls[0]?.[0].query.phoneNumber.toString(),
    ).toBe(SECOND_NUMBER);
    expect(policyService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({ id: POLICY_ID }),
    );
    expect(policyService.findOneBy).not.toHaveBeenCalled();
    expect(twilioConfig).toHaveBeenCalledWith(CONFIG_SECOND);

    const createdLog: IncomingCallLog = logService.create.mock.calls[0]?.[0]
      .data as IncomingCallLog;
    expect(createdLog.routingPhoneNumber?.toString()).toBe(SECOND_NUMBER);
    expect(createdLog.callerPhoneNumber?.toString()).toBe(CALLER_NUMBER);
    expect(createdLog.incomingCallPolicyId?.toString()).toBe(
      POLICY_ID.toString(),
    );

    expect(provider.generateEscalationResponse).toHaveBeenCalledWith(
      "Welcome to on-call",
      {
        toPhoneNumber: USER_1_NUMBER,
        fromPhoneNumber: SECOND_NUMBER,
        timeoutSeconds: 30,
        statusCallbackUrl:
          `https://oneuptime.example/notification/incoming-call/dial-status/` +
          `${CALL_LOG_ID.toString()}/${NEXT_CALL_LOG_ITEM_ID.toString()}`,
      },
    );
    expect(result.type).toHaveBeenCalledWith("text/xml");
    expect(result.send).toHaveBeenCalledWith("<Response><Dial/></Response>");
    expect(result.next).not.toHaveBeenCalled();
  });

  test("uses the attachment's provider config even when the policy primary uses another", async () => {
    numberService.findOneBy.mockResolvedValue(
      makeAttachedNumber({ configId: CONFIG_SECOND }),
    );
    policyService.findOneById.mockResolvedValue(
      makePolicy({ configId: CONFIG_PRIMARY, primaryPhone: PRIMARY_NUMBER }),
    );

    await invoke("/voice", { body: voiceBody(SECOND_NUMBER) });

    expect(twilioConfig).toHaveBeenCalledTimes(1);
    expect(twilioConfig).toHaveBeenCalledWith(CONFIG_SECOND);
    expect(providerFactory.getProviderWithConfig).toHaveBeenCalledWith(
      SECOND_CONFIG,
    );
  });

  test("queries the verified responder destination inside the policy project", async () => {
    await invoke("/voice", { body: voiceBody() });

    expect(incomingNumberService.findOneBy).toHaveBeenCalledWith({
      query: {
        userId: USER_1,
        projectId: PROJECT_ID,
        isVerified: true,
      },
      select: { phone: true },
      props: { isRoot: true },
    });
  });

  test("supports Twilio's Called field when To is absent", async () => {
    const body: Record<string, string> = voiceBody();
    delete body["To"];
    body["Called"] = SECOND_NUMBER;

    await invoke("/voice", { body });

    expect(
      numberService.findOneBy.mock.calls[0]?.[0].query.phoneNumber.toString(),
    ).toBe(SECOND_NUMBER);
    expect(
      (
        logService.create.mock.calls[0]?.[0].data as IncomingCallLog
      ).routingPhoneNumber?.toString(),
    ).toBe(SECOND_NUMBER);
  });

  test("falls back to a scalar-only legacy policy when no child row exists", async () => {
    numberService.findOneBy.mockResolvedValue(null);
    policyService.findOneBy.mockResolvedValue(
      makePolicy({ configId: CONFIG_PRIMARY, primaryPhone: PRIMARY_NUMBER }),
    );

    await invoke("/voice", { body: voiceBody(PRIMARY_NUMBER) });

    expect(policyService.findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: { routingPhoneNumber: expect.any(Phone) },
      }),
    );
    expect(twilioConfig).toHaveBeenCalledWith(CONFIG_PRIMARY);
    expect(
      (
        logService.create.mock.calls[0]?.[0].data as IncomingCallLog
      ).routingPhoneNumber?.toString(),
    ).toBe(PRIMARY_NUMBER);
    expect(
      provider.generateEscalationResponse.mock.calls[0]?.[1],
    ).toMatchObject({ fromPhoneNumber: PRIMARY_NUMBER });
  });

  test("skips unavailable and gapped rules before dialing an available user", async () => {
    ruleService.findOneBy
      .mockResolvedValueOnce(makeRule({ order: 1, userId: USER_1 }))
      .mockResolvedValueOnce(
        makeRule({ id: RULE_2_ID, order: 3, userId: USER_2, timeout: 45 }),
      );
    incomingNumberService.findOneBy.mockImplementation((args: any) => {
      if (args.query.userId.toString() === USER_1.toString()) {
        return Promise.resolve(null);
      }
      return Promise.resolve(makeVerifiedNumber(USER_2, USER_2_NUMBER));
    });
    userService.findOneById.mockResolvedValue(makeUser(USER_2));

    await invoke("/voice", { body: voiceBody() });

    expect(ruleService.findOneBy).toHaveBeenCalledTimes(2);
    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: { currentEscalationRuleOrder: 3 },
      props: { isRoot: true },
    });
    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        toPhoneNumber: USER_2_NUMBER,
        fromPhoneNumber: SECOND_NUMBER,
        timeoutSeconds: 45,
      }),
    );
  });

  test("resolves a schedule rule to the current on-call user", async () => {
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ order: 1, scheduleId: SCHEDULE_ID }),
    );
    scheduleService.getCurrentUserIdInSchedule.mockResolvedValue(USER_2);
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );

    await invoke("/voice", { body: voiceBody() });

    expect(scheduleService.getCurrentUserIdInSchedule).toHaveBeenCalledWith(
      SCHEDULE_ID,
    );
    expect(
      provider.generateEscalationResponse.mock.calls[0]?.[1],
    ).toMatchObject({ toPhoneNumber: USER_2_NUMBER });
  });

  test("records and hangs up a disabled policy without creating an attempt item", async () => {
    policyService.findOneById.mockResolvedValue(makePolicy({ enabled: false }));

    const result: Invocation = await invoke("/voice", { body: voiceBody() });

    const failedLog: IncomingCallLog = logService.create.mock.calls[0]?.[0]
      .data as IncomingCallLog;
    expect(failedLog.status).toBe(IncomingCallStatus.Failed);
    expect(failedLog.statusMessage).toBe("Policy is disabled");
    expect(failedLog.routingPhoneNumber?.toString()).toBe(SECOND_NUMBER);
    expect(logItemService.create).not.toHaveBeenCalled();
    expect(provider.generateHangupResponse).toHaveBeenCalledWith(
      "Sorry, this service is currently disabled.",
    );
    expect(result.send).toHaveBeenCalledWith("<Response><Hangup/></Response>");
  });

  test("ends with the configured no-one-available message after every rule is exhausted", async () => {
    ruleService.findOneBy.mockResolvedValue(null);
    policyService.findOneById.mockResolvedValue(
      makePolicy({ noOneAvailableMessage: "Please call support" }),
    );

    await invoke("/voice", { body: voiceBody() });

    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: expect.objectContaining({
        status: IncomingCallStatus.Failed,
        statusMessage: "No on-call user available in any escalation rule",
        endedAt: expect.any(Date),
      }),
      props: { isRoot: true },
    });
    expect(provider.generateHangupResponse).toHaveBeenCalledWith(
      "Please call support",
    );
    expect(logItemService.create).not.toHaveBeenCalled();
  });

  test("rejects missing called number, unknown number, missing config, and invalid signatures before writes", async () => {
    let result: Invocation = await invoke("/voice", {
      body: { From: CALLER_NUMBER, CallSid: "CA-incoming" },
    });
    expect(result.status).toHaveBeenCalledWith(400);

    numberService.findOneBy.mockResolvedValueOnce(null);
    policyService.findOneBy.mockResolvedValueOnce(null);
    result = await invoke("/voice", { body: voiceBody() });
    expect(result.status).toHaveBeenCalledWith(404);

    const noConfigPolicy: IncomingCallPolicy = makePolicy();
    delete noConfigPolicy.projectCallSMSConfigId;
    numberService.findOneBy.mockResolvedValueOnce(null);
    policyService.findOneBy.mockResolvedValueOnce(noConfigPolicy);
    result = await invoke("/voice", { body: voiceBody(PRIMARY_NUMBER) });
    expect(result.status).toHaveBeenCalledWith(400);

    numberService.findOneBy.mockResolvedValueOnce(makeAttachedNumber());
    policyService.findOneById.mockResolvedValueOnce(makePolicy());
    provider.validateWebhookSignature.mockReturnValueOnce(false);
    result = await invoke("/voice", { body: voiceBody() });
    expect(result.status).toHaveBeenCalledWith(403);

    expect(logService.create).not.toHaveBeenCalled();
    expect(logItemService.create).not.toHaveBeenCalled();
  });

  test("forwards parsing and persistence failures through next", async () => {
    const parseFailure: Error = new Error("malformed provider payload");
    provider.parseIncomingCallWebhook.mockImplementationOnce(() => {
      throw parseFailure;
    });

    const result: Invocation = await invoke("/voice", { body: voiceBody() });

    expect(result.next).toHaveBeenCalledWith(parseFailure);
    expect(logger.error).toHaveBeenCalledWith(parseFailure, {});
  });
});

describe("incoming call dial-status routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureProviderDefaults();
    configureUserAndRuleDefaults();
    configureLogDefaults();
    logService.findOneById.mockResolvedValue(
      makeCallLog({ routingPhone: SECOND_NUMBER, currentOrder: 1 }),
    );
    policyService.findOneById.mockResolvedValue(
      makePolicy({ configId: CONFIG_PRIMARY, primaryPhone: PRIMARY_NUMBER }),
    );
    numberService.findOneBy.mockResolvedValue(
      makeAttachedNumber({ phone: SECOND_NUMBER, configId: CONFIG_SECOND }),
    );
    logItemService.findOneById.mockResolvedValue(makeCallLogItem());
    provider.parseDialStatusWebhook.mockReturnValue({
      callId: "CA-incoming",
      dialStatus: "no-answer",
      dialDurationSeconds: 7,
    });
  });

  async function invokeDialStatus(
    body: Record<string, unknown> = dialBody(),
  ): Promise<Invocation> {
    return await invoke("/dial-status/:callLogId/:callLogItemId", {
      body,
      params: {
        callLogId: CALL_LOG_ID.toString(),
        callLogItemId: CALL_LOG_ITEM_ID.toString(),
      },
    });
  }

  test("selects the persisted called number and its config for callbacks", async () => {
    await invokeDialStatus();

    expect(logService.findOneById.mock.calls[0]?.[0]).toEqual({
      id: CALL_LOG_ID,
      select: {
        _id: true,
        currentEscalationRuleOrder: true,
        repeatCount: true,
        incomingCallPolicyId: true,
        routingPhoneNumber: true,
      },
      props: { isRoot: true },
    });
    expect(numberService.findOneBy).toHaveBeenCalledWith({
      query: {
        incomingCallPolicyId: POLICY_ID,
        phoneNumber: expect.any(Phone),
      },
      select: { projectCallSMSConfigId: true },
      props: { isRoot: true },
    });
    expect(
      numberService.findOneBy.mock.calls[0]?.[0].query.phoneNumber.toString(),
    ).toBe(SECOND_NUMBER);
    expect(twilioConfig).toHaveBeenCalledWith(CONFIG_SECOND);
  });

  test("escalates from the exact called number, never the policy's first number", async () => {
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ id: RULE_2_ID, order: 2, userId: USER_2, timeout: 25 }),
    );
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );

    const result: Invocation = await invokeDialStatus();

    expect(logItemService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ITEM_ID,
      data: expect.objectContaining({
        status: IncomingCallStatus.NoAnswer,
        dialDurationInSeconds: 7,
        isAnswered: false,
      }),
      props: { isRoot: true },
    });
    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        currentEscalationRuleOrder: 2,
        status: IncomingCallStatus.Escalated,
      },
      props: { isRoot: true },
    });
    expect(provider.generateEscalationResponse).toHaveBeenCalledWith(
      "Connecting you to the next available engineer.",
      expect.objectContaining({
        toPhoneNumber: USER_2_NUMBER,
        fromPhoneNumber: SECOND_NUMBER,
        timeoutSeconds: 25,
      }),
    );
    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).not.toEqual(
      expect.objectContaining({ fromPhoneNumber: PRIMARY_NUMBER }),
    );
    expect(result.send).toHaveBeenCalledWith("<Response><Dial/></Response>");
  });

  test("repeats from the exact called number and increments repeat state only after resolving a user", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        configId: CONFIG_PRIMARY,
        primaryPhone: PRIMARY_NUMBER,
        repeat: true,
        repeatTimes: 2,
      }),
    );
    ruleService.findOneBy
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeRule({ order: 1, userId: USER_1 }));

    await invokeDialStatus();

    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        currentEscalationRuleOrder: 1,
        repeatCount: 1,
        status: IncomingCallStatus.Escalated,
      },
      props: { isRoot: true },
    });
    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ fromPhoneNumber: SECOND_NUMBER }),
    );
  });

  test("marks the attempt and parent complete without looking for another rule", async () => {
    provider.parseDialStatusWebhook.mockReturnValue({
      callId: "CA-incoming",
      dialStatus: "completed",
      dialDurationSeconds: 42,
    });

    const result: Invocation = await invokeDialStatus(dialBody("completed"));

    expect(logItemService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ITEM_ID,
      data: expect.objectContaining({
        status: IncomingCallStatus.Connected,
        dialDurationInSeconds: 42,
        isAnswered: true,
        endedAt: expect.any(Date),
      }),
      props: { isRoot: true },
    });
    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        status: IncomingCallStatus.Completed,
        endedAt: expect.any(Date),
      },
      props: { isRoot: true },
    });
    expect(ruleService.findOneBy).not.toHaveBeenCalled();
    expect(provider.generateHangupResponse).toHaveBeenCalledWith();
    expect(result.send).toHaveBeenCalledWith("<Response><Hangup/></Response>");
  });

  test("exhausts the policy with its configured message and does not overrun repeat budget", async () => {
    logService.findOneById.mockResolvedValue(
      makeCallLog({ routingPhone: SECOND_NUMBER, repeatCount: 2 }),
    );
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        repeat: true,
        repeatTimes: 2,
        noAnswerMessage: "Leave a support ticket",
      }),
    );
    ruleService.findOneBy.mockResolvedValue(null);

    await invokeDialStatus();

    expect(ruleService.findOneBy).toHaveBeenCalledTimes(1);
    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        status: IncomingCallStatus.NoAnswer,
        endedAt: expect.any(Date),
      },
      props: { isRoot: true },
    });
    expect(provider.generateHangupResponse).toHaveBeenCalledWith(
      "Leave a support ticket",
    );
    expect(provider.generateEscalationResponse).not.toHaveBeenCalled();
  });

  test("keeps legacy callbacks working when the call log predates child rows", async () => {
    logService.findOneById.mockResolvedValue(
      makeCallLog({ routingPhone: PRIMARY_NUMBER }),
    );
    numberService.findOneBy.mockResolvedValue(null);
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ id: RULE_2_ID, order: 2, userId: USER_2 }),
    );
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );

    await invokeDialStatus();

    expect(twilioConfig).toHaveBeenCalledWith(CONFIG_PRIMARY);
    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ fromPhoneNumber: PRIMARY_NUMBER }),
    );
  });

  test("hangs up safely when the callback attempt item is already gone", async () => {
    logItemService.findOneById.mockResolvedValue(null);

    const result: Invocation = await invokeDialStatus();

    expect(logItemService.updateOneById).not.toHaveBeenCalled();
    expect(logService.updateOneById).not.toHaveBeenCalled();
    expect(provider.generateHangupResponse).toHaveBeenCalledWith();
    expect(result.send).toHaveBeenCalledWith("<Response><Hangup/></Response>");
  });

  test("rejects a callback item belonging to a different call log before mutation", async () => {
    logItemService.findOneById.mockResolvedValue(
      makeCallLogItem(OTHER_CALL_LOG_ID),
    );

    const result: Invocation = await invokeDialStatus();

    expect(result.status).toHaveBeenCalledWith(400);
    expect(result.send).toHaveBeenCalledWith(
      "Call log item does not belong to this call log",
    );
    expect(logItemService.updateOneById).not.toHaveBeenCalled();
    expect(logService.updateOneById).not.toHaveBeenCalled();
    expect(ruleService.findOneBy).not.toHaveBeenCalled();
    expect(provider.generateEscalationResponse).not.toHaveBeenCalled();
  });

  test("rejects malformed URLs, missing state/config, and invalid signatures before status writes", async () => {
    let result: Invocation = await invoke(
      "/dial-status/:callLogId/:callLogItemId",
      { body: dialBody(), params: {} },
    );
    expectError(result.next, "Invalid webhook URL");

    logService.findOneById.mockResolvedValueOnce(null);
    result = await invokeDialStatus();
    expect(result.status).toHaveBeenCalledWith(404);

    logService.findOneById.mockResolvedValueOnce(makeCallLog());
    policyService.findOneById.mockResolvedValueOnce(null);
    result = await invokeDialStatus();
    expect(result.status).toHaveBeenCalledWith(400);

    const noConfigPolicy: IncomingCallPolicy = makePolicy();
    delete noConfigPolicy.projectCallSMSConfigId;
    logService.findOneById.mockResolvedValueOnce(makeCallLog());
    policyService.findOneById.mockResolvedValueOnce(noConfigPolicy);
    numberService.findOneBy.mockResolvedValueOnce(null);
    result = await invokeDialStatus();
    expect(result.status).toHaveBeenCalledWith(400);

    logService.findOneById.mockResolvedValueOnce(makeCallLog());
    policyService.findOneById.mockResolvedValueOnce(makePolicy());
    numberService.findOneBy.mockResolvedValueOnce(makeAttachedNumber());
    provider.validateWebhookSignature.mockReturnValueOnce(false);
    result = await invokeDialStatus();
    expect(result.status).toHaveBeenCalledWith(403);

    expect(logItemService.updateOneById).not.toHaveBeenCalled();
    expect(logService.updateOneById).not.toHaveBeenCalled();
  });

  test("uses the callback item id only after provider authentication", async () => {
    provider.validateWebhookSignature.mockReturnValue(false);

    await invokeDialStatus();

    expect(logItemService.findOneById).not.toHaveBeenCalled();
    expect(logItemService.updateOneById).not.toHaveBeenCalled();
  });
});
