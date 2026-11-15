import CallLog from "Common/Models/DatabaseModels/CallLog";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import CallLogService from "Common/Server/Services/CallLogService";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import CallRequest from "Common/Types/Call/CallRequest";
import {
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ServerTwilioEnvironmentVariable,
} from "Common/Types/CallAndSMS/ServerTwilioEnvironment";
import { TwilioConfigUse } from "Common/Types/CallAndSMS/TwilioConfigUse";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import {
  getNoTwilioAccountMessage,
  TwilioMessageKind,
} from "Common/Utils/Project/TwilioAccount";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import Twilio from "twilio";

/*
 * THE NOTIFICATION SERVICE SENDS THROUGH THE ACCOUNT THE ENVIRONMENT
 * VARIABLES SET (#7515).
 *
 * A self-hosted installation kept in code sets the server's Twilio account
 * with GLOBAL_TWILIO_ variables (the Helm chart's twilio values, or
 * config.env). Here the real SmsService and CallService send, with only the
 * Twilio client faked at its boundary:
 *
 *   - set, an SMS or a call a project without a config of its own sends
 *     goes through the variables' account, from its numbers - never the
 *     account saved in the Admin Dashboard;
 *   - set with something wrong, nothing goes out, through either account,
 *     and the log says there is no account, as it does for an account that
 *     is not set up;
 *   - set for SMS only, a call has no account on the server;
 *   - unset, the saved account sends exactly as before.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
    EXTERNAL_FAULT: {},
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("twilio", () => {
  const actual: { twiml: unknown } = jest.requireActual("twilio") as {
    twiml: unknown;
  };
  const client: ((...args: Array<unknown>) => unknown) & {
    twiml?: unknown;
  } = jest.fn();
  client.twiml = actual.twiml;

  return {
    __esModule: true,
    default: client,
  };
});

import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import { getTwilioConfig } from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(
  "4e000000-0000-4000-8000-000000007515",
);

const SAVED_SID: string = "AC11111111111111111111111111111111";
const SAVED_NUMBER: string = "+15550001111";
const ENV_SID: string = "AC22222222222222222222222222222222";
const ENV_TOKEN: string = "environment-auth-token-7515";
const ENV_NUMBER: string = "+14155550100";
const ENV_SMS_NUMBER: string = "+6581234567";
const RECIPIENT: string = "+6590665484";

let createMessage: Mock<(...args: Array<unknown>) => Promise<unknown>>;
let createCall: Mock<(...args: Array<unknown>) => Promise<unknown>>;
// Which account each message went through: the Twilio client's SID and token.
let clientAccounts: Array<string>;
let smsLogs: Array<SmsLog>;
let callLogs: Array<CallLog>;
let savedAccount: GlobalConfig;

const before: Record<string, string | undefined> = {};

function setEnvironment(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>>,
): void {
  for (const [variable, value] of Object.entries(values)) {
    process.env[variable] = value;
  }
}

function setEnvironmentAccount(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>> = {},
): void {
  setEnvironment({
    [ServerTwilioEnvironmentVariable.AccountSid]: ENV_SID,
    [ServerTwilioEnvironmentVariable.AuthToken]: ENV_TOKEN,
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: ENV_NUMBER,
    ...values,
  });
}

function sentFrom(): Array<string> {
  return createMessage.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as JSONObject)["from"]);
  });
}

function calledFrom(): Array<string> {
  return createCall.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as JSONObject)["from"]);
  });
}

function callTo(recipient: string): CallRequest {
  return {
    to: new Phone(recipient),
    data: [{ sayMessage: "Incident created" }],
  } as unknown as CallRequest;
}

beforeEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }

  // What an admin saved: an account that sends both, from its own number.
  savedAccount = Object.assign(new GlobalConfig(), {
    twilioAccountSID: SAVED_SID,
    twilioAuthToken: "saved-auth-token",
    twilioPrimaryPhoneNumber: new Phone(SAVED_NUMBER),
  });
  clientAccounts = [];

  createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);
  createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

  (
    Twilio as unknown as Mock<(...args: Array<unknown>) => unknown>
  ).mockImplementation((accountSid: unknown, authToken: unknown) => {
    clientAccounts.push(`${String(accountSid)}:${String(authToken)}`);
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  });

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Ops";
    project.enableSmsNotifications = true;
    project.enableCallNotifications = true;
    project.smsOrCallCurrentBalanceInUSDCents = 10000;
    return Promise.resolve(project);
  }) as never);

  jest.spyOn(GlobalConfigService, "findOneBy").mockImplementation((() => {
    return Promise.resolve(savedAccount);
  }) as never);

  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(10000 as never);
  jest
    .spyOn(ProjectService, "claimSmsOrCallLowBalanceNotice")
    .mockResolvedValue(false as never);

  smsLogs = [];
  callLogs = [];

  jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
    data: SmsLog;
  }) => {
    const row: SmsLog = data.data;
    row._id = ObjectID.generate().toString();
    smsLogs.push(row);
    return Promise.resolve(row);
  }) as never);
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SmsLogService, "compareAndSetColumnsByIdWithoutHooks")
    .mockResolvedValue(true as never);
  jest.spyOn(CallLogService, "create").mockImplementation(((data: {
    data: CallLog;
  }) => {
    callLogs.push(data.data);
    return Promise.resolve(data.data);
  }) as never);
});

afterEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  jest.restoreAllMocks();
});

describe("unset", () => {
  test("the account saved in the Admin Dashboard sends, as before", async () => {
    await SmsService.sendSms(new Phone(RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
    });
    await CallService.makeCall(callTo(RECIPIENT), { projectId: PROJECT_ID });

    expect(sentFrom()).toEqual([SAVED_NUMBER]);
    expect(calledFrom()).toEqual([SAVED_NUMBER]);
    expect(clientAccounts).toEqual([
      `${SAVED_SID}:saved-auth-token`,
      `${SAVED_SID}:saved-auth-token`,
    ]);
  });
});

describe("set", () => {
  test("an SMS and a call go through the variables' account, from its number, never the saved one", async () => {
    setEnvironmentAccount();

    await SmsService.sendSms(new Phone(RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
    });
    await CallService.makeCall(callTo(RECIPIENT), { projectId: PROJECT_ID });

    expect(sentFrom()).toEqual([ENV_NUMBER]);
    expect(calledFrom()).toEqual([ENV_NUMBER]);
    expect(clientAccounts).toEqual([
      `${ENV_SID}:${ENV_TOKEN}`,
      `${ENV_SID}:${ENV_TOKEN}`,
    ]);
    expect(smsLogs[0]!.fromNumber?.toString()).toBe(ENV_NUMBER);
  });

  test("its SMS numbers send every SMS, as the saved account's would", async () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: ENV_SMS_NUMBER,
    });

    await SmsService.sendSms(new Phone(RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
    });

    expect(sentFrom()).toEqual([ENV_SMS_NUMBER]);
  });

  test("for SMS only: SMS go out, and a call has no account on the server", async () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: ENV_SMS_NUMBER,
    });

    expect((await getTwilioConfig())?.use).toBe(TwilioConfigUse.SmsOnly);
    expect(await getTwilioConfig(TwilioMessageKind.Call)).toBeNull();

    await SmsService.sendSms(new Phone(RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
    });

    await expect(
      CallService.makeCall(callTo(RECIPIENT), { projectId: PROJECT_ID }),
    ).rejects.toThrow(getNoTwilioAccountMessage(TwilioMessageKind.Call));

    expect(sentFrom()).toEqual([ENV_SMS_NUMBER]);
    // Not the saved account's number, which makes calls.
    expect(createCall).not.toHaveBeenCalled();
  });

  test("with something wrong, nothing goes out - not through the saved account either - and the log says there is no account", async () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "call me",
    });

    expect(await getTwilioConfig()).toBeNull();

    await expect(
      SmsService.sendSms(new Phone(RECIPIENT), "Incident created", {
        projectId: PROJECT_ID,
      }),
    ).rejects.toThrow(BadDataException);
    await expect(
      CallService.makeCall(callTo(RECIPIENT), { projectId: PROJECT_ID }),
    ).rejects.toThrow(getNoTwilioAccountMessage(TwilioMessageKind.Call));

    expect(createMessage).not.toHaveBeenCalled();
    expect(createCall).not.toHaveBeenCalled();
    expect(clientAccounts).toEqual([]);
    expect(smsLogs[0]!.status).toBe(SmsStatus.Error);
    expect(smsLogs[0]!.statusMessage).toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS),
    );
  });

  test("without the account SID, the other variables are read by nothing: the saved account sends", async () => {
    setEnvironment({
      [ServerTwilioEnvironmentVariable.AuthToken]: ENV_TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: ENV_NUMBER,
    });

    await SmsService.sendSms(new Phone(RECIPIENT), "Incident created", {
      projectId: PROJECT_ID,
    });

    expect(sentFrom()).toEqual([SAVED_NUMBER]);
    expect(clientAccounts).toEqual([`${SAVED_SID}:saved-auth-token`]);
  });
});
