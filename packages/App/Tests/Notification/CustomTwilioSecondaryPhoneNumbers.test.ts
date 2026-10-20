import CallService from "../../FeatureSet/Notification/Services/CallService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import SenderCallService from "Common/Server/Services/CallService";
import CallLogService from "Common/Server/Services/CallLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import SenderSmsService from "Common/Server/Services/SmsService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import BlockedProjectNotifications from "Common/Server/Utils/Notification/BlockedProjectNotifications";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import API from "Common/Utils/API";
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
 * A PROJECT'S OWN TWILIO ACCOUNT WITH SECONDARY NUMBERS.
 *
 * Besides its primary number, a project's Twilio config can hold secondary
 * numbers, and an SMS or a call goes out from the one whose country code
 * matches the recipient's. With any secondary number set, nothing went out
 * at all: the sender - Common's CallService and SmsService, which post to
 * the Notification service - joined the numbers into one string, and the
 * Notification service, picking from it as from a list, threw
 * "secondaryPhoneNumbersToPickFrom.map is not a function". A verification
 * code was reported as not sent, and an on-call call was never placed.
 *
 * Both ends below are the real ones. Only the HTTP hop between them is
 * replaced, by what it does to the body: JSON on the wire, then the route's
 * JSONFunctions.deserialize, after which the route hands customTwilioConfig
 * to the Notification service as it is.
 */

// The client is faked; the TwiML builder is the real one.
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

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    EXTERNAL_FAULT: {},
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    IsBillingEnabled: false,
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    getTwilioConfig: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "e0000000-0000-4000-8000-000000000001",
);

const US_PRIMARY_NUMBER: string = "+14155550100";
const UK_SECONDARY_NUMBER: string = "+442079460123";
const AU_SECONDARY_NUMBER: string = "+61491570156";

const projectTwilioConfig: (
  secondaryPhoneNumbers: Array<string>,
) => TwilioConfig = (secondaryPhoneNumbers: Array<string>): TwilioConfig => {
  return {
    accountSid: "AC-project",
    authToken: "project-auth-token",
    primaryPhoneNumber: new Phone(US_PRIMARY_NUMBER),
    secondaryPhoneNumbers: secondaryPhoneNumbers.map(
      (phoneNumber: string): Phone => {
        return new Phone(phoneNumber);
      },
    ),
  };
};

const UK_RECIPIENT: Phone = new Phone("+442079460999");
const SINGAPORE_RECIPIENT: Phone = new Phone("+6590665484");

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

let createCall: AsyncMock;
let createMessage: AsyncMock;

// What the sender last posted, as the Notification route reads it.
function receivedBody(): JSONObject {
  const posts: Array<Array<unknown>> = (API.post as unknown as jest.Mock).mock
    .calls as Array<Array<unknown>>;

  const posted: JSONObject = (
    posts[posts.length - 1]![0] as { data: JSONObject }
  ).data;

  return JSONFunctions.deserialize(
    JSON.parse(JSON.stringify(posted)) as JSONObject,
  );
}

function receivedTwilioConfig(body: JSONObject): TwilioConfig {
  return body["customTwilioConfig"] as unknown as TwilioConfig;
}

async function callThroughTheNotificationService(data: {
  to: Phone;
  twilioConfig: TwilioConfig;
}): Promise<JSONObject> {
  await SenderCallService.makeCall(
    {
      to: data.to,
      data: [{ sayMessage: "Incident Checkout down on Site 03." }],
    } as unknown as CallRequest,
    { projectId: PROJECT_ID, customTwilioConfig: data.twilioConfig },
  );

  const body: JSONObject = receivedBody();

  await CallService.makeCall(body["callRequest"] as unknown as CallRequest, {
    projectId: PROJECT_ID,
    customTwilioConfig: receivedTwilioConfig(body),
  });

  return body;
}

async function smsThroughTheNotificationService(data: {
  to: Phone;
  twilioConfig: TwilioConfig;
}): Promise<JSONObject> {
  await SenderSmsService.sendSms(
    { to: data.to, message: "Incident Checkout down on Site 03." },
    { projectId: PROJECT_ID, customTwilioConfig: data.twilioConfig },
  );

  const body: JSONObject = receivedBody();

  await SmsService.sendSms(body["to"] as Phone, body["message"] as string, {
    projectId: PROJECT_ID,
    customTwilioConfig: receivedTwilioConfig(body),
  });

  return body;
}

// A plain array of this test's own, so toStrictEqual compares the numbers alone.
function sentFrom(create: AsyncMock): Array<string> {
  return Array.from(create.mock.calls, (args: Array<unknown>): string => {
    return String((args[0] as { from: string }).from);
  });
}

describe("a project's own Twilio config with secondary numbers, sent to the Notification service", () => {
  beforeEach(() => {
    createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);
    createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);

    (Twilio as unknown as jest.Mock).mockImplementation(() => {
      return {
        calls: { create: createCall },
        messages: { create: createMessage },
      };
    });

    const project: Project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Acme";
    project.enableCallNotifications = true;
    project.enableSmsNotifications = true;
    project.smsOrCallCurrentBalanceInUSDCents = 10000;

    jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
      return Promise.resolve(project);
    }) as never);
    jest.spyOn(CallLogService, "create").mockImplementation(((data: {
      data: CallLog;
    }) => {
      return Promise.resolve(data.data);
    }) as never);
    jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
      data: SmsLog;
    }) => {
      const row: SmsLog = data.data;
      row._id = ObjectID.generate().toString();
      return Promise.resolve(row);
    }) as never);
    jest
      .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);

    jest
      .spyOn(BlockedProjectNotifications, "getRefusal")
      .mockResolvedValue(null as never);
    jest.spyOn(API, "post").mockResolvedValue({} as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("carries the secondary numbers as a list of numbers, not one joined string", async () => {
    const body: JSONObject = await callThroughTheNotificationService({
      to: UK_RECIPIENT,
      twilioConfig: projectTwilioConfig([
        UK_SECONDARY_NUMBER,
        AU_SECONDARY_NUMBER,
      ]),
    });

    expect(receivedTwilioConfig(body).secondaryPhoneNumbers).toStrictEqual([
      UK_SECONDARY_NUMBER,
      AU_SECONDARY_NUMBER,
    ]);
  });

  test("a call goes out from the secondary number in the recipient's country", async () => {
    await callThroughTheNotificationService({
      to: UK_RECIPIENT,
      twilioConfig: projectTwilioConfig([
        AU_SECONDARY_NUMBER,
        UK_SECONDARY_NUMBER,
      ]),
    });

    expect(createCall).toHaveBeenCalledTimes(1);
    expect(sentFrom(createCall)).toStrictEqual([UK_SECONDARY_NUMBER]);
    expect(createCall.mock.calls[0]![0]).toMatchObject({
      to: UK_RECIPIENT.toString(),
    });
  });

  test("an SMS goes out from the secondary number in the recipient's country", async () => {
    await smsThroughTheNotificationService({
      to: UK_RECIPIENT,
      twilioConfig: projectTwilioConfig([
        AU_SECONDARY_NUMBER,
        UK_SECONDARY_NUMBER,
      ]),
    });

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(sentFrom(createMessage)).toStrictEqual([UK_SECONDARY_NUMBER]);
    expect(createMessage.mock.calls[0]![0]).toMatchObject({
      to: UK_RECIPIENT.toString(),
    });
  });

  test("a recipient in a country no secondary number is in gets the primary number", async () => {
    await callThroughTheNotificationService({
      to: SINGAPORE_RECIPIENT,
      twilioConfig: projectTwilioConfig([
        UK_SECONDARY_NUMBER,
        AU_SECONDARY_NUMBER,
      ]),
    });

    expect(sentFrom(createCall)).toStrictEqual([US_PRIMARY_NUMBER]);
  });

  test("a project with no secondary numbers sends from its primary number", async () => {
    await smsThroughTheNotificationService({
      to: UK_RECIPIENT,
      twilioConfig: projectTwilioConfig([]),
    });

    expect(sentFrom(createMessage)).toStrictEqual([US_PRIMARY_NUMBER]);
  });
});
