import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import CallService from "../../../Server/Services/CallService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import SmsService from "../../../Server/Services/SmsService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import CallRequest from "../../../Types/Call/CallRequest";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import SMS from "../../../Types/SMS/SMS";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger", () => {
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

/*
 * EVERY VERIFICATION CODE A PROJECT MEMBER IS SENT GOES THROUGH THE
 * PROJECT'S DEFAULT TWILIO CONFIG.
 *
 * Project Settings -> Notification Settings says that SMS and calls to the
 * people in a project - phone verification included - go through the
 * project's default Twilio config, and a project's first config now becomes
 * that default. The SMS and call codes did; the code that verifies a number
 * for incoming call routing was sent without it, so it went out through
 * OneUptime's own account and was paid from the project's balance - which
 * UserIncomingCallNumberService does not even check when the project has its
 * own config. These pin all three senders to the same rule.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1c000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000002");
const ITEM_ID: ObjectID = new ObjectID("1c000000-0000-4000-8000-000000000003");
const CODE: string = "482915";

const PROJECT_TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC00000000000000000000000000000003",
  authToken: "00000000000000000000000000000003",
  primaryPhoneNumber: new Phone("+15550001111"),
  secondaryPhoneNumbers: [],
};

type SmsOptions = Parameters<typeof SmsService.sendSms>[1];
type CallOptions = Parameters<typeof CallService.makeCall>[1];

// What the notification service answers for a message it has taken.
const SENT: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
  200,
  {},
  {},
);

interface SentSms {
  sms: SMS;
  options: Record<string, unknown>;
}

interface PlacedCall {
  callRequest: CallRequest;
  options: Record<string, unknown>;
}

let sentSms: Array<SentSms>;
let placedCalls: Array<PlacedCall>;
let projectDefault: TwilioConfig | undefined;
let defaultLookups: Array<ObjectID | undefined>;

// Lets the fire-and-forget send finish.
async function flush(): Promise<void> {
  for (let index: number = 0; index < 5; index++) {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  }
}

function incomingCallNumber(): UserIncomingCallNumber {
  const item: UserIncomingCallNumber = new UserIncomingCallNumber();
  item.id = ITEM_ID;
  item.projectId = PROJECT_ID;
  item.userId = USER_ID;
  item.phone = new Phone("+15552223333");
  return item;
}

function userSms(): UserSMS {
  const item: UserSMS = new UserSMS();
  item.id = ITEM_ID;
  item.projectId = PROJECT_ID;
  item.userId = USER_ID;
  item.phone = new Phone("+15552224444");
  return item;
}

function userCall(): UserCall {
  const item: UserCall = new UserCall();
  item.id = ITEM_ID;
  item.projectId = PROJECT_ID;
  item.userId = USER_ID;
  item.phone = new Phone("+15552225555");
  return item;
}

beforeEach(() => {
  sentSms = [];
  placedCalls = [];
  projectDefault = PROJECT_TWILIO_CONFIG;
  defaultLookups = [];

  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockImplementation(
      async (
        projectId: ObjectID | undefined,
      ): Promise<TwilioConfig | undefined> => {
        defaultLookups.push(projectId);
        return projectDefault;
      },
    );

  jest
    .spyOn(SmsService, "sendSms")
    .mockImplementation(
      async (
        sms: SMS,
        options: SmsOptions,
      ): Promise<HTTPResponse<JSONObject>> => {
        sentSms.push({
          sms,
          options: options as unknown as Record<string, unknown>,
        });
        return SENT;
      },
    );

  jest
    .spyOn(CallService, "makeCall")
    .mockImplementation(
      async (
        callRequest: CallRequest,
        options: CallOptions,
      ): Promise<HTTPResponse<JSONObject>> => {
        placedCalls.push({
          callRequest,
          options: options as unknown as Record<string, unknown>,
        });
        return SENT;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the code that verifies a number for incoming call routing", () => {
  test("goes through the project's default Twilio config", async () => {
    UserIncomingCallNumberService.sendVerificationCode(
      incomingCallNumber(),
      CODE,
    );
    await flush();

    expect(defaultLookups.map(String)).toEqual([PROJECT_ID.toString()]);
    expect(sentSms).toHaveLength(1);
    expect(sentSms[0]!.options["customTwilioConfig"]).toBe(
      PROJECT_TWILIO_CONFIG,
    );
  });

  test("goes through OneUptime's own account when the project has no default", async () => {
    projectDefault = undefined;

    UserIncomingCallNumberService.sendVerificationCode(
      incomingCallNumber(),
      CODE,
    );
    await flush();

    expect(sentSms).toHaveLength(1);
    expect(sentSms[0]!.options["customTwilioConfig"]).toBeUndefined();
  });

  test("still says what it is, to whom, for which project, and is kept out of the logs", async () => {
    UserIncomingCallNumberService.sendVerificationCode(
      incomingCallNumber(),
      CODE,
    );
    await flush();

    const sent: SentSms = sentSms[0]!;

    expect(sent.sms.to.toString()).toBe("+15552223333");
    expect(sent.sms.message).toBe(
      "This message is from OneUptime. Your verification code for incoming call routing is " +
        CODE,
    );
    expect(String(sent.options["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(sent.options["userId"])).toBe(USER_ID.toString());
    expect(sent.options["isSensitive"]).toBe(true);
  });

  /*
   * It used to be sent fire-and-forget, so a failure here was swallowed and
   * the person was told the code was on its way. Now the caller hears it
   * (and issueAndSendVerificationCode turns it into the person's answer).
   */
  test("a failed lookup sends nothing, and the caller is told", async () => {
    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockRejectedValue(new Error("lookup failed"));

    await expect(
      UserIncomingCallNumberService.sendVerificationCode(
        incomingCallNumber(),
        CODE,
      ),
    ).rejects.toThrow("lookup failed");

    expect(sentSms).toHaveLength(0);
  });
});

describe("the other verification codes, held to the same rule", () => {
  test("an SMS number's code goes through the project's default Twilio config", async () => {
    UserSmsService.sendVerificationCode(userSms(), CODE);
    await flush();

    expect(sentSms).toHaveLength(1);
    expect(sentSms[0]!.options["customTwilioConfig"]).toBe(
      PROJECT_TWILIO_CONFIG,
    );
  });

  test("a call number's code goes through the project's default Twilio config", async () => {
    UserCallService.sendVerificationCode(userCall(), CODE);
    await flush();

    expect(placedCalls).toHaveLength(1);
    expect(placedCalls[0]!.options["customTwilioConfig"]).toBe(
      PROJECT_TWILIO_CONFIG,
    );
  });
});
