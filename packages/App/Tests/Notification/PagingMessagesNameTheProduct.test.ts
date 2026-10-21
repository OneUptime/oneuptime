import CallService from "../../FeatureSet/Notification/Services/CallService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import CallLogService from "Common/Server/Services/CallLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import fs from "fs";
import path from "path";
import Twilio from "twilio";

/*
 * The messages OneUptime sends on the paging channels say the name the
 * installation goes by: "This is a message from OneUptime" reads "This is a
 * message from Acme" on an installation called Acme
 * (Common/Server/Utils/ProductBrandingText.ts). Addresses and commands in a
 * message are left as they are, and an installation that is not renamed
 * sends exactly what it always did.
 *
 * Through the real SmsService and CallService, with Twilio's client faked
 * and its TwiML builder real, as in TwilioSendFailures.test.ts.
 */

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

import { getTwilioConfig } from "../../FeatureSet/Notification/Config";

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

const PROJECT_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000002",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+6590665484");

const ACME: ProductBranding = { productName: "Acme" };

const MESSAGE: string =
  "This is a message from OneUptime. A new incident has been created: INC-7. Open https://oneuptime.example/dashboard to acknowledge it.";

const brandAs: (branding: ProductBranding | null) => void = (
  branding: ProductBranding | null,
): void => {
  jest.spyOn(EnterpriseEdition, "getProductBranding").mockReturnValue(branding);
};

const projectWith: (setting: "sms" | "call") => Project = (
  setting: "sms" | "call",
): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Production";
  project.enableSmsNotifications = setting === "sms";
  project.enableCallNotifications = setting === "call";
  project.smsOrCallCurrentBalanceInUSDCents = 10000;

  return project;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an SMS", () => {
  let createMessage: AsyncMock;

  beforeEach(() => {
    createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);

    (Twilio as unknown as jest.Mock).mockImplementation(() => {
      return { messages: { create: createMessage } };
    });

    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
      TWILIO_CONFIG as never,
    );

    jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
      return Promise.resolve(projectWith("sms"));
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
  });

  const sentBody: () => string = (): string => {
    expect(createMessage).toHaveBeenCalledTimes(1);

    return String(
      (createMessage.mock.calls[0]![0] as { body?: unknown }).body || "",
    );
  };

  test("says OneUptime on an installation that is not renamed", async () => {
    brandAs(null);

    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      isSensitive: true,
    });

    expect(sentBody()).toContain("This is a message from OneUptime.");
  });

  test("says the installation's name when it goes by one, and leaves the address alone", async () => {
    brandAs(ACME);

    await SmsService.sendSms(TO, MESSAGE, {
      projectId: PROJECT_ID,
      isSensitive: true,
    });

    const body: string = sentBody();

    expect(body).toContain("This is a message from Acme.");
    expect(body).not.toContain("OneUptime");
    expect(body).toContain("https://oneuptime.example/dashboard");
  });
});

describe("a call", () => {
  let createCall: AsyncMock;

  beforeEach(() => {
    createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

    (Twilio as unknown as jest.Mock).mockImplementation(() => {
      return { calls: { create: createCall } };
    });

    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
      TWILIO_CONFIG as never,
    );

    jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
      return Promise.resolve(projectWith("call"));
    }) as never);
    jest.spyOn(CallLogService, "create").mockImplementation(((data: {
      data: CallLog;
    }) => {
      return Promise.resolve(data.data);
    }) as never);
    jest
      .spyOn(CallLogService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
  });

  const callRequest: () => CallRequest = (): CallRequest => {
    return {
      to: TO,
      data: [{ sayMessage: "This is a call from OneUptime about INC-7." }],
    } as unknown as CallRequest;
  };

  const spokenTwiml: () => string = (): string => {
    expect(createCall).toHaveBeenCalledTimes(1);

    return String(
      (createCall.mock.calls[0]![0] as { twiml?: unknown }).twiml || "",
    );
  };

  test("says OneUptime on an installation that is not renamed", async () => {
    brandAs(null);

    await CallService.makeCall(callRequest(), {
      projectId: PROJECT_ID,
      isSensitive: true,
    });

    expect(spokenTwiml()).toContain("This is a call from OneUptime about");
  });

  test("says the installation's name when it goes by one", async () => {
    brandAs(ACME);

    await CallService.makeCall(callRequest(), {
      projectId: PROJECT_ID,
      isSensitive: true,
    });

    const twiml: string = spokenTwiml();

    expect(twiml).toContain("This is a call from Acme about");
    expect(twiml).not.toContain("OneUptime");
  });
});

describe("push notifications", () => {
  test("go out with the installation's name and icon (PushNotificationService)", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "Common",
        "Server",
        "Services",
        "PushNotificationService.ts",
      ),
      "utf8",
    );

    expect(source).toContain(
      "message: ProductBrandingText.brandPushMessage(pushRequest.message, [",
    );
    expect(source).toContain("PushNotificationUtil.DEFAULT_ICON,");
  });
});
