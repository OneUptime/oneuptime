import CallService from "../../../Server/Services/CallService";
import SmsService from "../../../Server/Services/SmsService";
import BlockedProjectNotifications from "../../../Server/Utils/Notification/BlockedProjectNotifications";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import TwilioConfigJSON from "../../../Types/CallAndSMS/TwilioConfigJSON";
import TwilioPhoneNumbers from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import API, { APIRequestOptions } from "../../../Utils/API";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THE SERVER'S SENDERS POST TO THE NOTIFICATION SERVICE.
 *
 * Every SMS and call through a project's own Twilio config - its default
 * for its members, a status page's for its subscribers - is posted to the
 * Notification service with the config in the body. Its lists of numbers
 * went as an array's toString(), one comma-separated string, which the
 * Notification service then called .map on: an SMS or a call through a
 * config with secondary numbers failed every time. These pin the body the
 * two senders post, and that what they post comes back, on the other side,
 * as a config that sends each kind of message from the right number - a
 * Singapore config's SMS from its mobile number, its calls from its
 * national number.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "3c000000-0000-4000-8000-000000000001",
);

const SG_NATIONAL: string = "+6561234567";
const SG_MOBILE: string = "+6581234567";
const SG_RECIPIENT: string = "+6590665484";
const UK: string = "+447700900123";
const SE: string = "+46701234567";

function singaporeConfig(): TwilioConfig {
  return {
    accountSid: "AC00000000000000000000000000000001",
    authToken: "auth-token",
    primaryPhoneNumber: new Phone(SG_NATIONAL),
    secondaryPhoneNumbers: [new Phone(UK), new Phone(SE)],
    smsPhoneNumbers: [new Phone(SG_MOBILE), new Phone(SE)],
  };
}

let posted: Array<APIRequestOptions>;

beforeEach(() => {
  posted = [];

  jest
    .spyOn(BlockedProjectNotifications, "getRefusal")
    .mockResolvedValue(null as never);

  jest.spyOn(API, "post").mockImplementation((async (
    options: APIRequestOptions,
  ): Promise<HTTPResponse<JSONObject>> => {
    posted.push(options);
    return new HTTPResponse<JSONObject>(200, {}, {});
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The config of the one body posted, read the way the route reads it.
function receivedConfig(): TwilioConfig | undefined {
  expect(posted).toHaveLength(1);

  const body: JSONObject = JSONFunctions.deserialize(
    JSON.parse(JSON.stringify(posted[0]!.data)) as JSONObject,
  );

  return TwilioConfigJSON.fromJSON(body["customTwilioConfig"]);
}

function postedConfig(): JSONObject {
  return (posted[0]!.data as JSONObject)["customTwilioConfig"] as JSONObject;
}

describe("an SMS through a project's own Twilio config", () => {
  beforeEach(async () => {
    await SmsService.sendSms(
      { to: new Phone(SG_RECIPIENT), message: "Incident created" },
      { projectId: PROJECT_ID, customTwilioConfig: singaporeConfig() },
    );
  });

  test("posts the config's lists of numbers as arrays, not as one string", () => {
    expect(postedConfig()).toEqual({
      accountSid: "AC00000000000000000000000000000001",
      authToken: "auth-token",
      primaryPhoneNumber: SG_NATIONAL,
      secondaryPhoneNumbers: [UK, SE],
      smsPhoneNumbers: [SG_MOBILE, SE],
    });
    expect(Array.isArray(postedConfig()["secondaryPhoneNumbers"])).toBe(true);
    expect(Array.isArray(postedConfig()["smsPhoneNumbers"])).toBe(true);
  });

  test("goes out, on the other side, from the config's SMS numbers", () => {
    const received: TwilioConfig | undefined = receivedConfig();

    expect(
      TwilioPhoneNumbers.pickSenderNumber({
        config: received!,
        kind: TwilioMessageKind.SMS,
        to: SG_RECIPIENT,
      }).toString(),
    ).toBe(SG_MOBILE);
    // A Swedish recipient's from the Swedish SMS number.
    expect(
      TwilioPhoneNumbers.pickSenderNumber({
        config: received!,
        kind: TwilioMessageKind.SMS,
        to: "+46709876543",
      }).toString(),
    ).toBe(SE);
    // A British one's from the first SMS number, not the UK number kept for calls.
    expect(
      TwilioPhoneNumbers.pickSenderNumber({
        config: received!,
        kind: TwilioMessageKind.SMS,
        to: "+447911123456",
      }).toString(),
    ).toBe(SG_MOBILE);
  });
});

describe("a call through a project's own Twilio config", () => {
  beforeEach(async () => {
    await CallService.makeCall(
      {
        to: new Phone(SG_RECIPIENT),
        data: [{ sayMessage: "Incident created" }],
      },
      { projectId: PROJECT_ID, customTwilioConfig: singaporeConfig() },
    );
  });

  test("posts the same config, its SMS numbers included", () => {
    expect(postedConfig()).toEqual(
      TwilioConfigJSON.toJSON(singaporeConfig()),
    );
  });

  test("goes out, on the other side, from the config's primary number", () => {
    const received: TwilioConfig | undefined = receivedConfig();

    expect(
      TwilioPhoneNumbers.pickSenderNumber({
        config: received!,
        kind: TwilioMessageKind.Call,
        to: SG_RECIPIENT,
      }).toString(),
    ).toBe(SG_NATIONAL);
  });
});

describe("a message without a config of its own", () => {
  test("posts none: the OneUptime server's own account sends it", async () => {
    await SmsService.sendSms(
      { to: new Phone(SG_RECIPIENT), message: "Your code is 123456" },
      { projectId: PROJECT_ID, isSensitive: true },
    );

    expect(postedConfig()).toBeUndefined();
    expect(receivedConfig()).toBeUndefined();
  });

  test("a config without SMS numbers posts none of them, and sends SMS from its primary number", async () => {
    await SmsService.sendSms(
      { to: new Phone(SG_RECIPIENT), message: "Incident created" },
      {
        projectId: PROJECT_ID,
        customTwilioConfig: {
          accountSid: "AC1",
          authToken: "token",
          primaryPhoneNumber: new Phone(SG_MOBILE),
          secondaryPhoneNumbers: [],
        },
      },
    );

    expect(postedConfig()).toEqual({
      accountSid: "AC1",
      authToken: "token",
      primaryPhoneNumber: SG_MOBILE,
      secondaryPhoneNumbers: [],
    });
    expect(
      TwilioPhoneNumbers.pickSenderNumber({
        config: receivedConfig()!,
        kind: TwilioMessageKind.SMS,
        to: SG_RECIPIENT,
      }).toString(),
    ).toBe(SG_MOBILE);
  });
});
