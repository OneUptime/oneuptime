import { mockRouter } from "Common/Tests/Server/API/Helpers";
import IncomingCallLogItemService from "Common/Server/Services/IncomingCallLogItemService";
import IncomingCallLogService from "Common/Server/Services/IncomingCallLogService";
import IncomingCallMissedCallNotificationService from "Common/Server/Services/IncomingCallMissedCallNotificationService";
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
import ProjectMembership from "Common/Server/Utils/TeamMember/ProjectMembership";
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

/*
 * The missed call notification has its own suite. Here it only matters
 * whether - and for which call - the webhook asks for it.
 */
jest.mock(
  "Common/Server/Services/IncomingCallMissedCallNotificationService",
  () => {
    return {
      __esModule: true,
      default: { notifyOwnersOfMissedCall: jest.fn() },
    };
  },
);

jest.mock("Common/Server/Services/OnCallDutyPolicyScheduleService", () => {
  return {
    __esModule: true,
    default: { getCurrentOnCallInSchedule: jest.fn() },
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

/*
 * The membership condition the number lookup carries. Faked as the plain
 * user id for a member, and as a marker the number lookup finds nothing for
 * otherwise - what the real condition does in SQL. isMember answers from the
 * same world (membersExcept).
 */
jest.mock("Common/Server/Utils/TeamMember/ProjectMembership", () => {
  return {
    __esModule: true,
    default: { userIdWhileMember: jest.fn(), isMember: jest.fn() },
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
const missedCallNotifier: { notifyOwnersOfMissedCall: JestMock } =
  IncomingCallMissedCallNotificationService as unknown as {
    notifyOwnersOfMissedCall: JestMock;
  };
const scheduleService: { getCurrentOnCallInSchedule: JestMock } =
  OnCallDutyPolicyScheduleService as unknown as {
    getCurrentOnCallInSchedule: JestMock;
  };
const incomingNumberService: { findOneBy: JestMock } =
  UserIncomingCallNumberService as unknown as { findOneBy: JestMock };
const userService: { findOneById: JestMock } = UserService as unknown as {
  findOneById: JestMock;
};
const membership: { userIdWhileMember: JestMock; isMember: JestMock } =
  ProjectMembership as unknown as {
    userIdWhileMember: JestMock;
    isMember: JestMock;
  };

// What the faked condition stands for when the person is not a member.
interface NotAMember {
  notAMember: string;
}

function isNotAMember(userCondition: unknown): boolean {
  return Boolean(
    userCondition &&
      typeof userCondition === "object" &&
      "notAMember" in (userCondition as Record<string, unknown>),
  );
}

// Everybody asked about is a member, except the ids listed.
function membersExcept(...formerMembers: Array<ObjectID>): void {
  const former: Set<string> = new Set<string>(
    formerMembers.map((userId: ObjectID): string => {
      return userId.toString().toLowerCase();
    }),
  );

  membership.userIdWhileMember.mockImplementation(
    (data: {
      userId: ObjectID;
      projectId: ObjectID;
    }): ObjectID | NotAMember => {
      return former.has(data.userId.toString().toLowerCase())
        ? { notAMember: data.userId.toString() }
        : data.userId;
    },
  );

  membership.isMember.mockImplementation(
    async (data: {
      userId: ObjectID;
      projectId: ObjectID;
    }): Promise<boolean> => {
      return !former.has(data.userId.toString().toLowerCase());
    },
  );
}
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

function dialBody(
  status: string = "no-answer",
  callStatus: string = "in-progress",
): Record<string, string> {
  return {
    CallSid: "CA-incoming",
    CallStatus: callStatus,
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
        callerHungUp: request.body["CallStatus"] === "completed",
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
  membersExcept();
  ruleService.findOneBy.mockResolvedValue(
    makeRule({ order: 1, userId: USER_1 }),
  );
  incomingNumberService.findOneBy.mockResolvedValue(
    makeVerifiedNumber(USER_1, USER_1_NUMBER),
  );
  userService.findOneById.mockResolvedValue(makeUser(USER_1));
  scheduleService.getCurrentOnCallInSchedule.mockResolvedValue({
    userId: USER_1,
    coveredUserId: null,
  });
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
  missedCallNotifier.notifyOwnersOfMissedCall.mockResolvedValue(undefined);
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
    scheduleService.getCurrentOnCallInSchedule.mockResolvedValue({
      userId: USER_2,
      coveredUserId: null,
    });
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );

    await invoke("/voice", { body: voiceBody() });

    expect(scheduleService.getCurrentOnCallInSchedule).toHaveBeenCalledWith(
      SCHEDULE_ID,
    );
    // Nobody covered: membership is left to the number lookup.
    expect(membership.isMember).not.toHaveBeenCalled();
    expect(
      provider.generateEscalationResponse.mock.calls[0]?.[1],
    ).toMatchObject({ toPhoneNumber: USER_2_NUMBER });
  });

  /*
   * A caller is only ever put through to a member of the project: a rule or
   * a schedule that still names somebody who has left is skipped like a
   * rule whose user has no verified number.
   */
  test("skips a rule naming somebody who is no longer a member, and rings the next one", async () => {
    membersExcept(USER_1);
    ruleService.findOneBy
      .mockResolvedValueOnce(makeRule({ order: 1, userId: USER_1 }))
      .mockResolvedValueOnce(
        makeRule({ id: RULE_2_ID, order: 3, userId: USER_2, timeout: 45 }),
      );
    // USER_1 HAS a verified number; the membership condition finds nothing.
    incomingNumberService.findOneBy.mockImplementation((args: any) => {
      if (isNotAMember(args.query.userId)) {
        return Promise.resolve(null);
      }

      return Promise.resolve(
        args.query.userId.toString() === USER_1.toString()
          ? makeVerifiedNumber(USER_1, USER_1_NUMBER)
          : makeVerifiedNumber(USER_2, USER_2_NUMBER),
      );
    });
    userService.findOneById.mockResolvedValue(makeUser(USER_2));

    await invoke("/voice", { body: voiceBody() });

    // Their number was asked for only while they are a member: nothing came back.
    expect(membership.userIdWhileMember).toHaveBeenCalledWith({
      userId: USER_1,
      projectId: PROJECT_ID,
    });
    expect(
      isNotAMember(
        incomingNumberService.findOneBy.mock.calls[0]?.[0].query.userId,
      ),
    ).toBe(true);
    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ toPhoneNumber: USER_2_NUMBER }),
    );
    expect(
      provider.generateEscalationResponse.mock.calls.some(
        (call: Array<any>) => {
          return call[1]?.toPhoneNumber === USER_1_NUMBER;
        },
      ),
    ).toBe(false);
  });

  /*
   * A schedule's override puts a substitute in a layer user's place. A
   * substitute who is no longer a member hands the call back to the layer
   * user they cover - as the on-call escalation pages them - instead of the
   * rule being skipped.
   */
  test("a schedule's override whose substitute has left: the layer user it covers takes the call", async () => {
    membersExcept(USER_2);
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ order: 1, scheduleId: SCHEDULE_ID }),
    );
    scheduleService.getCurrentOnCallInSchedule.mockResolvedValue({
      userId: USER_2,
      coveredUserId: USER_1,
    });
    incomingNumberService.findOneBy.mockImplementation((args: any) => {
      if (isNotAMember(args.query.userId)) {
        return Promise.resolve(null);
      }

      return Promise.resolve(
        args.query.userId.toString() === USER_1.toString()
          ? makeVerifiedNumber(USER_1, USER_1_NUMBER)
          : makeVerifiedNumber(USER_2, USER_2_NUMBER),
      );
    });

    await invoke("/voice", { body: voiceBody() });

    expect(membership.isMember).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: USER_2,
    });
    // The covered layer user's number, read while they are a member.
    expect(membership.userIdWhileMember).toHaveBeenCalledWith({
      userId: USER_1,
      projectId: PROJECT_ID,
    });
    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ toPhoneNumber: USER_1_NUMBER }),
    );
    expect(
      provider.generateEscalationResponse.mock.calls.some(
        (call: Array<any>) => {
          return call[1]?.toPhoneNumber === USER_2_NUMBER;
        },
      ),
    ).toBe(false);
  });

  test("a schedule's override whose substitute is a member: the substitute takes the call", async () => {
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ order: 1, scheduleId: SCHEDULE_ID }),
    );
    scheduleService.getCurrentOnCallInSchedule.mockResolvedValue({
      userId: USER_2,
      coveredUserId: USER_1,
    });
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );

    await invoke("/voice", { body: voiceBody() });

    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ toPhoneNumber: USER_2_NUMBER }),
    );
  });

  test("a schedule's override whose substitute and covered layer user have both left rings neither", async () => {
    membersExcept(USER_1, USER_2);
    ruleService.findOneBy
      .mockResolvedValueOnce(makeRule({ order: 1, scheduleId: SCHEDULE_ID }))
      .mockResolvedValueOnce(null);
    scheduleService.getCurrentOnCallInSchedule.mockResolvedValue({
      userId: USER_2,
      coveredUserId: USER_1,
    });
    incomingNumberService.findOneBy.mockImplementation((args: any) => {
      return Promise.resolve(
        isNotAMember(args.query.userId)
          ? null
          : makeVerifiedNumber(USER_1, USER_1_NUMBER),
      );
    });

    await invoke("/voice", { body: voiceBody() });

    expect(
      provider.generateEscalationResponse.mock.calls.some(
        (call: Array<any>) => {
          return (
            call[1]?.toPhoneNumber === USER_1_NUMBER ||
            call[1]?.toPhoneNumber === USER_2_NUMBER
          );
        },
      ),
    ).toBe(false);
  });

  test("a membership read that fails keeps the substitute, whose number lookup still carries the condition", async () => {
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ order: 1, scheduleId: SCHEDULE_ID }),
    );
    scheduleService.getCurrentOnCallInSchedule.mockResolvedValue({
      userId: USER_2,
      coveredUserId: USER_1,
    });
    const failure: Error = new Error("database unavailable");
    membership.isMember.mockRejectedValue(failure);
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );

    await invoke("/voice", { body: voiceBody() });

    expect(logger.error).toHaveBeenCalledWith(failure);
    expect(membership.userIdWhileMember).toHaveBeenCalledWith({
      userId: USER_2,
      projectId: PROJECT_ID,
    });
    expect(provider.generateEscalationResponse.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ toPhoneNumber: USER_2_NUMBER }),
    );
  });

  test("does not ring a schedule's on-call person who is no longer a member", async () => {
    membersExcept(USER_2);
    ruleService.findOneBy
      .mockResolvedValueOnce(makeRule({ order: 1, scheduleId: SCHEDULE_ID }))
      .mockResolvedValueOnce(null);
    scheduleService.getCurrentOnCallInSchedule.mockResolvedValue({
      userId: USER_2,
      coveredUserId: null,
    });
    incomingNumberService.findOneBy.mockImplementation((args: any) => {
      return Promise.resolve(
        isNotAMember(args.query.userId)
          ? null
          : makeVerifiedNumber(USER_2, USER_2_NUMBER),
      );
    });

    await invoke("/voice", { body: voiceBody() });

    expect(incomingNumberService.findOneBy).toHaveBeenCalledTimes(1);
    expect(
      isNotAMember(
        incomingNumberService.findOneBy.mock.calls[0]?.[0].query.userId,
      ),
    ).toBe(true);
    expect(
      provider.generateEscalationResponse.mock.calls.some(
        (call: Array<any>) => {
          return call[1]?.toPhoneNumber === USER_2_NUMBER;
        },
      ),
    ).toBe(false);
  });

  test("the number lookup carries the membership condition for the person about to be rung, in the policy's project", async () => {
    await invoke("/voice", { body: voiceBody() });

    expect(membership.userIdWhileMember).toHaveBeenCalledWith({
      userId: USER_1,
      projectId: PROJECT_ID,
    });
    // One read: the condition rides on the lookup the call makes anyway.
    expect(incomingNumberService.findOneBy).toHaveBeenCalledTimes(1);
    expect(
      incomingNumberService.findOneBy.mock.calls[0]?.[0].query.userId,
    ).toBe(USER_1);
  });

  test("records and hangs up a disabled policy without creating an attempt item", async () => {
    policyService.findOneById.mockResolvedValue(makePolicy({ enabled: false }));

    const result: Invocation = await invoke("/voice", { body: voiceBody() });

    /*
     * Logged as a call coming in, then ended - the same two steps as every
     * other call, so a workflow's On Create and the update that sets Ended At
     * mean the same thing for it.
     */
    const createdLog: IncomingCallLog = logService.create.mock.calls[0]?.[0]
      .data as IncomingCallLog;
    expect(createdLog.status).toBe(IncomingCallStatus.Initiated);
    expect(createdLog.routingPhoneNumber?.toString()).toBe(SECOND_NUMBER);
    expect(logService.updateOneById).toHaveBeenCalledTimes(1);
    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        status: IncomingCallStatus.Failed,
        statusMessage: "Policy is disabled",
        endedAt: expect.any(Date),
      },
      props: { isRoot: true },
    });
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
      callerHungUp: false,
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
        endedAt: true,
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
      callerHungUp: false,
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

/*
 * Twilio requests the <Dial> action URL when the caller hangs up while the
 * engineer's phone is still ringing, too. The dial result then looks like an
 * unanswered ring, and whatever the handler answers is thrown away because
 * the call is already over. Every test here has another engineer available
 * and the policy set to repeat, so a handler that mistook the hang-up for
 * "no answer" would go on hunting.
 */
describe("incoming call dial-status after the caller hangs up", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureProviderDefaults();
    configureUserAndRuleDefaults();
    configureLogDefaults();
    logService.findOneById.mockResolvedValue(
      makeCallLog({ routingPhone: SECOND_NUMBER, currentOrder: 1 }),
    );
    policyService.findOneById.mockResolvedValue(
      makePolicy({
        configId: CONFIG_PRIMARY,
        primaryPhone: PRIMARY_NUMBER,
        repeat: true,
        repeatTimes: 3,
        noAnswerMessage: "Leave a support ticket",
      }),
    );
    numberService.findOneBy.mockResolvedValue(
      makeAttachedNumber({ phone: SECOND_NUMBER, configId: CONFIG_SECOND }),
    );
    logItemService.findOneById.mockResolvedValue(makeCallLogItem());
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ id: RULE_2_ID, order: 2, userId: USER_2 }),
    );
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );
    provider.parseDialStatusWebhook.mockReturnValue({
      callId: "CA-incoming",
      dialStatus: "no-answer",
      dialDurationSeconds: 0,
      callerHungUp: true,
    });
  });

  async function invokeCallerHungUp(): Promise<Invocation> {
    return await invoke("/dial-status/:callLogId/:callLogItemId", {
      body: dialBody("no-answer", "completed"),
      params: {
        callLogId: CALL_LOG_ID.toString(),
        callLogItemId: CALL_LOG_ITEM_ID.toString(),
      },
    });
  }

  function logUpdates(): Array<Record<string, unknown>> {
    return logService.updateOneById.mock.calls.map(
      (call: Array<any>): Record<string, unknown> => {
        return call[0].data as Record<string, unknown>;
      },
    );
  }

  test("closes the attempt and the call as caller hung up", async () => {
    const result: Invocation = await invokeCallerHungUp();

    expect(logItemService.updateOneById).toHaveBeenCalledTimes(1);
    expect(logItemService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ITEM_ID,
      data: {
        status: IncomingCallStatus.CallerHungUp,
        dialDurationInSeconds: 0,
        endedAt: expect.any(Date),
        isAnswered: false,
      },
      props: { isRoot: true },
    });
    expect(logService.updateOneById).toHaveBeenCalledTimes(1);
    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        status: IncomingCallStatus.CallerHungUp,
        endedAt: expect.any(Date),
      },
      props: { isRoot: true },
    });
    expect(result.type).toHaveBeenCalledWith("text/xml");
    expect(result.send).toHaveBeenCalledWith("<Response><Hangup/></Response>");
    expect(result.status).not.toHaveBeenCalled();
    expect(result.next).not.toHaveBeenCalled();
  });

  test("never looks up, logs or dials another engineer", async () => {
    await invokeCallerHungUp();

    expect(ruleService.findOneBy).not.toHaveBeenCalled();
    expect(incomingNumberService.findOneBy).not.toHaveBeenCalled();
    expect(logItemService.create).not.toHaveBeenCalled();
    expect(provider.generateEscalationResponse).not.toHaveBeenCalled();
    expect(provider.generateDialResponse).not.toHaveBeenCalled();
    expect(logUpdates()).not.toContainEqual(
      expect.objectContaining({ status: IncomingCallStatus.Escalated }),
    );
  });

  test("does not spend the repeat budget on a caller who is gone", async () => {
    /*
     * Rule 1 is the only rule, so a no-answer here would restart the policy
     * from it. Answer by query rather than queueing one-off answers: the
     * handler under test never asks, and queued answers would outlive it.
     */
    ruleService.findOneBy.mockImplementation((args: any) => {
      const afterOrder: unknown = Object.values(
        args.query.order.objectLiteralParameters,
      )[0];
      return Promise.resolve(
        afterOrder === 0 ? makeRule({ order: 1, userId: USER_1 }) : null,
      );
    });
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_1, USER_1_NUMBER),
    );

    await invokeCallerHungUp();

    for (const update of logUpdates()) {
      expect(update).not.toHaveProperty("repeatCount");
      expect(update).not.toHaveProperty("currentEscalationRuleOrder");
    }
    expect(logItemService.create).not.toHaveBeenCalled();
    expect(provider.generateEscalationResponse).not.toHaveBeenCalled();
  });

  test("records a hang-up on the last rule as caller hung up, not no answer", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({ repeat: false, noAnswerMessage: "Leave a support ticket" }),
    );
    ruleService.findOneBy.mockResolvedValue(null);

    await invokeCallerHungUp();

    expect(logUpdates()).toEqual([
      { status: IncomingCallStatus.CallerHungUp, endedAt: expect.any(Date) },
    ]);
    // Nobody is left on the line to hear the no-answer message.
    expect(provider.generateHangupResponse).toHaveBeenCalledTimes(1);
    expect(provider.generateHangupResponse).toHaveBeenCalledWith();
  });

  test.each(["no-answer", "canceled", "busy", "failed"])(
    "stops the hunt when the dial ended %s with the caller gone",
    async (dialStatus: string) => {
      provider.parseDialStatusWebhook.mockReturnValue({
        callId: "CA-incoming",
        dialStatus,
        dialDurationSeconds: 0,
        callerHungUp: true,
      });

      await invokeCallerHungUp();

      expect(logItemService.updateOneById).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: IncomingCallStatus.CallerHungUp,
            isAnswered: false,
          }),
        }),
      );
      expect(logUpdates()).toEqual([
        { status: IncomingCallStatus.CallerHungUp, endedAt: expect.any(Date) },
      ]);
      expect(logItemService.create).not.toHaveBeenCalled();
    },
  );

  test("ends the attempt and the call at the same moment", async () => {
    await invokeCallerHungUp();

    const attemptEndedAt: Date = logItemService.updateOneById.mock.calls[0]?.[0]
      .data.endedAt as Date;
    const callEndedAt: Date = logService.updateOneById.mock.calls[0]?.[0].data
      .endedAt as Date;
    expect(attemptEndedAt).toBeInstanceOf(Date);
    expect(callEndedAt.getTime()).toBe(attemptEndedAt.getTime());
  });

  test("still completes an answered call when the caller is the one who hangs up", async () => {
    provider.parseDialStatusWebhook.mockReturnValue({
      callId: "CA-incoming",
      dialStatus: "completed",
      dialDurationSeconds: 95,
      callerHungUp: true,
    });

    await invokeCallerHungUp();

    expect(logItemService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ITEM_ID,
      data: {
        status: IncomingCallStatus.Connected,
        dialDurationInSeconds: 95,
        endedAt: expect.any(Date),
        isAnswered: true,
      },
      props: { isRoot: true },
    });
    expect(logUpdates()).toEqual([
      { status: IncomingCallStatus.Completed, endedAt: expect.any(Date) },
    ]);
    expect(ruleService.findOneBy).not.toHaveBeenCalled();
  });

  test("keeps hunting on the same dial result while the caller is still on the line", async () => {
    provider.parseDialStatusWebhook.mockReturnValue({
      callId: "CA-incoming",
      dialStatus: "no-answer",
      dialDurationSeconds: 0,
      callerHungUp: false,
    });

    const result: Invocation = await invokeCallerHungUp();

    expect(logItemService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: IncomingCallStatus.NoAnswer }),
      }),
    );
    expect(logItemService.create).toHaveBeenCalledTimes(1);
    expect(logUpdates()).toEqual([
      { currentEscalationRuleOrder: 2, status: IncomingCallStatus.Escalated },
    ]);
    expect(provider.generateEscalationResponse).toHaveBeenCalledWith(
      "Connecting you to the next available engineer.",
      expect.objectContaining({ toPhoneNumber: USER_2_NUMBER }),
    );
    expect(result.send).toHaveBeenCalledWith("<Response><Dial/></Response>");
  });

  test("acts on a hang-up only after the signature and ownership checks", async () => {
    provider.validateWebhookSignature.mockReturnValueOnce(false);
    let result: Invocation = await invokeCallerHungUp();
    expect(result.status).toHaveBeenCalledWith(403);

    logItemService.findOneById.mockResolvedValueOnce(
      makeCallLogItem(OTHER_CALL_LOG_ID),
    );
    result = await invokeCallerHungUp();
    expect(result.status).toHaveBeenCalledWith(400);

    expect(logItemService.updateOneById).not.toHaveBeenCalled();
    expect(logService.updateOneById).not.toHaveBeenCalled();
  });
});

/*
 * Issue #4159: when a call ends without reaching anyone, the policy's owners
 * are told. Each of the four ways a call can end unanswered asks for exactly
 * one notification, for that call, once the call log says how it ended. A
 * call someone answered, or one still hunting, asks for none.
 */
describe("incoming call missed call notifications", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureProviderDefaults();
    configureUserAndRuleDefaults();
    configureLogDefaults();
    numberService.findOneBy.mockResolvedValue(makeAttachedNumber());
    policyService.findOneById.mockResolvedValue(makePolicy());
    policyService.findOneBy.mockResolvedValue(null);
    logService.findOneById.mockResolvedValue(
      makeCallLog({ routingPhone: SECOND_NUMBER, currentOrder: 1 }),
    );
    logItemService.findOneById.mockResolvedValue(makeCallLogItem());
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

  function notifiedCallLogIds(): Array<string> {
    return missedCallNotifier.notifyOwnersOfMissedCall.mock.calls.map(
      (call: Array<any>): string => {
        return call[0].incomingCallLogId.toString();
      },
    );
  }

  // The call log is ended before anyone is asked to read it.
  function expectEndedBeforeNotifying(status: IncomingCallStatus): void {
    const endedCall: number | undefined =
      logService.updateOneById.mock.invocationCallOrder[
        logService.updateOneById.mock.calls.findIndex(
          (call: Array<any>): boolean => {
            return call[0].data.status === status;
          },
        )
      ];
    const notified: number | undefined =
      missedCallNotifier.notifyOwnersOfMissedCall.mock.invocationCallOrder[0];

    expect(endedCall).toBeDefined();
    expect(notified).toBeDefined();
    expect(endedCall!).toBeLessThan(notified!);
  }

  test("a call to a disabled policy is a missed call", async () => {
    policyService.findOneById.mockResolvedValue(makePolicy({ enabled: false }));

    await invoke("/voice", { body: voiceBody() });

    expect(notifiedCallLogIds()).toEqual([CALL_LOG_ID.toString()]);
    expectEndedBeforeNotifying(IncomingCallStatus.Failed);
  });

  test("a call nobody is available for is a missed call", async () => {
    ruleService.findOneBy.mockResolvedValue(null);

    await invoke("/voice", { body: voiceBody() });

    expect(notifiedCallLogIds()).toEqual([CALL_LOG_ID.toString()]);
    expectEndedBeforeNotifying(IncomingCallStatus.Failed);
  });

  test("a call that rings someone is not missed yet", async () => {
    await invoke("/voice", { body: voiceBody() });

    expect(provider.generateEscalationResponse).toHaveBeenCalledTimes(1);
    expect(missedCallNotifier.notifyOwnersOfMissedCall).not.toHaveBeenCalled();
  });

  test("a call whose hunt ran out is a missed call", async () => {
    ruleService.findOneBy.mockResolvedValue(null);

    await invokeDialStatus(dialBody("no-answer"));

    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: { status: IncomingCallStatus.NoAnswer, endedAt: expect.any(Date) },
      props: { isRoot: true },
    });
    expect(notifiedCallLogIds()).toEqual([CALL_LOG_ID.toString()]);
    expectEndedBeforeNotifying(IncomingCallStatus.NoAnswer);
  });

  test("a caller who hung up while a phone rang is a missed call", async () => {
    await invokeDialStatus(dialBody("no-answer", "completed"));

    expect(notifiedCallLogIds()).toEqual([CALL_LOG_ID.toString()]);
    expectEndedBeforeNotifying(IncomingCallStatus.CallerHungUp);
  });

  test("an answered call tells nobody", async () => {
    await invokeDialStatus(dialBody("completed"));

    expect(logService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: IncomingCallStatus.Completed,
        }),
      }),
    );
    expect(missedCallNotifier.notifyOwnersOfMissedCall).not.toHaveBeenCalled();
  });

  test("an answered call that the caller ends tells nobody either", async () => {
    await invokeDialStatus(dialBody("completed", "completed"));

    expect(missedCallNotifier.notifyOwnersOfMissedCall).not.toHaveBeenCalled();
  });

  test("escalating to the next engineer tells nobody", async () => {
    ruleService.findOneBy.mockResolvedValue(
      makeRule({ id: RULE_2_ID, order: 2, userId: USER_2 }),
    );
    incomingNumberService.findOneBy.mockResolvedValue(
      makeVerifiedNumber(USER_2, USER_2_NUMBER),
    );

    await invokeDialStatus(dialBody("no-answer"));

    expect(provider.generateEscalationResponse).toHaveBeenCalledTimes(1);
    expect(missedCallNotifier.notifyOwnersOfMissedCall).not.toHaveBeenCalled();
  });

  test("repeating the policy tells nobody", async () => {
    policyService.findOneById.mockResolvedValue(
      makePolicy({ repeat: true, repeatTimes: 2 }),
    );
    ruleService.findOneBy.mockImplementation((args: any) => {
      const afterOrder: unknown = Object.values(
        args.query.order.objectLiteralParameters,
      )[0];
      return Promise.resolve(
        afterOrder === 0 ? makeRule({ order: 1, userId: USER_1 }) : null,
      );
    });

    await invokeDialStatus(dialBody("no-answer"));

    expect(logService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ repeatCount: 1 }),
      }),
    );
    expect(missedCallNotifier.notifyOwnersOfMissedCall).not.toHaveBeenCalled();
  });

  test("the reply to Twilio does not wait for the notification", async () => {
    ruleService.findOneBy.mockResolvedValue(null);
    missedCallNotifier.notifyOwnersOfMissedCall.mockReturnValue(
      new Promise<void>(() => {
        // Never settles: owners on a slow mail server.
      }),
    );

    const result: Invocation = await invokeDialStatus(dialBody("no-answer"));

    expect(missedCallNotifier.notifyOwnersOfMissedCall).toHaveBeenCalledTimes(
      1,
    );
    expect(result.send).toHaveBeenCalledWith("<Response><Hangup/></Response>");
  });

  test("a notification that fails is logged and the caller still gets the reply", async () => {
    ruleService.findOneBy.mockResolvedValue(null);
    const failure: Error = new Error("mail server down");
    missedCallNotifier.notifyOwnersOfMissedCall.mockRejectedValue(failure);

    const result: Invocation = await invokeDialStatus(dialBody("no-answer"));
    // Let the rejected notification settle.
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    expect(result.send).toHaveBeenCalledWith("<Response><Hangup/></Response>");
    expect(result.next).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(failure);
  });

  test("a failure ending the call is not reported as a missed call", async () => {
    ruleService.findOneBy.mockResolvedValue(null);
    const failure: Error = new Error("database is down");
    logService.updateOneById.mockRejectedValue(failure);

    const result: Invocation = await invokeDialStatus(dialBody("no-answer"));

    expect(result.next).toHaveBeenCalledWith(failure);
    expect(missedCallNotifier.notifyOwnersOfMissedCall).not.toHaveBeenCalled();
  });
});

/*
 * A callback for a call that has already ended is a repeat of one that was
 * handled. Acting on it would ring an engineer for a caller who is gone, and
 * tell the owners about the same missed call twice.
 */
describe("incoming call dial-status after the call ended", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureProviderDefaults();
    configureUserAndRuleDefaults();
    configureLogDefaults();
    const endedLog: IncomingCallLog = makeCallLog({
      routingPhone: SECOND_NUMBER,
      currentOrder: 1,
    });
    endedLog.endedAt = new Date("2026-10-01T22:01:00.000Z");
    logService.findOneById.mockResolvedValue(endedLog);
    policyService.findOneById.mockResolvedValue(makePolicy());
    numberService.findOneBy.mockResolvedValue(makeAttachedNumber());
    logItemService.findOneById.mockResolvedValue(makeCallLogItem());
  });

  async function invokeDialStatus(
    body: Record<string, unknown>,
  ): Promise<Invocation> {
    return await invoke("/dial-status/:callLogId/:callLogItemId", {
      body,
      params: {
        callLogId: CALL_LOG_ID.toString(),
        callLogItemId: CALL_LOG_ITEM_ID.toString(),
      },
    });
  }

  test.each([
    ["no-answer", "in-progress"],
    ["no-answer", "completed"],
    ["completed", "in-progress"],
    ["busy", "in-progress"],
  ])(
    "a repeated %s callback (caller %s) changes nothing and tells nobody",
    async (dialStatus: string, callStatus: string) => {
      const result: Invocation = await invokeDialStatus(
        dialBody(dialStatus, callStatus),
      );

      expect(logItemService.updateOneById).not.toHaveBeenCalled();
      expect(logService.updateOneById).not.toHaveBeenCalled();
      expect(logItemService.create).not.toHaveBeenCalled();
      expect(ruleService.findOneBy).not.toHaveBeenCalled();
      expect(provider.generateEscalationResponse).not.toHaveBeenCalled();
      expect(
        missedCallNotifier.notifyOwnersOfMissedCall,
      ).not.toHaveBeenCalled();
      expect(result.type).toHaveBeenCalledWith("text/xml");
      expect(result.send).toHaveBeenCalledWith(
        "<Response><Hangup/></Response>",
      );
    },
  );

  test("is only ignored after the signature and ownership checks", async () => {
    provider.validateWebhookSignature.mockReturnValueOnce(false);
    let result: Invocation = await invokeDialStatus(dialBody());
    expect(result.status).toHaveBeenCalledWith(403);

    logItemService.findOneById.mockResolvedValueOnce(
      makeCallLogItem(OTHER_CALL_LOG_ID),
    );
    result = await invokeDialStatus(dialBody());
    expect(result.status).toHaveBeenCalledWith(400);

    expect(provider.generateHangupResponse).not.toHaveBeenCalled();
  });
});

describe("incoming call answered by", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configureProviderDefaults();
    configureUserAndRuleDefaults();
    configureLogDefaults();
    logService.findOneById.mockResolvedValue(
      makeCallLog({ routingPhone: SECOND_NUMBER, currentOrder: 1 }),
    );
    policyService.findOneById.mockResolvedValue(makePolicy());
    numberService.findOneBy.mockResolvedValue(makeAttachedNumber());
  });

  async function invokeAnswered(): Promise<Invocation> {
    return await invoke("/dial-status/:callLogId/:callLogItemId", {
      body: dialBody("completed"),
      params: {
        callLogId: CALL_LOG_ID.toString(),
        callLogItemId: CALL_LOG_ITEM_ID.toString(),
      },
    });
  }

  test("records who answered on the call log", async () => {
    const item: IncomingCallLogItem = makeCallLogItem();
    item.userId = USER_2;
    logItemService.findOneById.mockResolvedValue(item);

    await invokeAnswered();

    expect(logItemService.findOneById.mock.calls[0]?.[0].select).toEqual({
      _id: true,
      incomingCallLogId: true,
      userId: true,
    });
    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        status: IncomingCallStatus.Completed,
        endedAt: expect.any(Date),
        answeredByUserId: USER_2,
      },
      props: { isRoot: true },
    });
  });

  test("an attempt with no user leaves Answered By empty rather than wrong", async () => {
    logItemService.findOneById.mockResolvedValue(makeCallLogItem());

    await invokeAnswered();

    expect(logService.updateOneById).toHaveBeenCalledWith({
      id: CALL_LOG_ID,
      data: {
        status: IncomingCallStatus.Completed,
        endedAt: expect.any(Date),
      },
      props: { isRoot: true },
    });
  });
});
