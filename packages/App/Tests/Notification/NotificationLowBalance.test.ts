import CallService from "../../FeatureSet/Notification/Services/CallService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import TelegramService from "../../FeatureSet/Notification/Services/TelegramService";
import WhatsAppService from "../../FeatureSet/Notification/Services/WhatsAppService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import API from "Common/Utils/API";
import CallRequest from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import TelegramStatus from "Common/Types/TelegramStatus";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import { ProjectNotificationChannel } from "Common/Utils/Project/NotificationChannels";
import { getProjectBalanceMessageNotSentReason } from "Common/Utils/Project/ProjectBalance";
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
 * A MESSAGE THE PROJECT'S BALANCE CANNOT PAY FOR.
 *
 * On OneUptime Cloud every SMS, call, WhatsApp and Telegram message sent on
 * OneUptime's own accounts is paid from the project's balance. One the
 * balance cannot pay for is not sent:
 *
 * - its log - which anyone who may read the project's logs reads, and which
 *   a person's on-call timeline and the status page jobs repeat - says how
 *   much is left against what it costs, and exactly who can add balance,
 *   and where. It used to say "Project does not have enough balance to send
 *   SMS" and nothing about what to do;
 * - the owners - who may add balance - are emailed once, told to add
 *   balance or turn on Auto Recharge, with a link straight to the page. The
 *   email used to say "Please enable auto recharge or recharge manually",
 *   with no link, "USD cents" for dollars and a garbled sentence for calls.
 *   A WhatsApp message's text goes into it as text, and a Telegram email
 *   leaves out the chat and the message, as the Telegram-off email does.
 */

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
    EXTERNAL_FAULT: {},
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const URLType: { fromString: (url: string) => unknown } = (
    jest.requireActual("Common/Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    }
  ).default;

  return {
    __esModule: true,
    ...actual,
    IsBillingEnabled: true,
    DashboardClientUrl: URLType.fromString(
      "https://oneuptime.example.com/dashboard",
    ),
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SMSDefaultCostInCents: 10,
    SMSHighRiskCostInCents: 10,
    CallDefaultCostInCentsPerMinute: 35,
    CallHighRiskCostInCentsPerMinute: 35,
    WhatsAppTextDefaultCostInCents: 5,
    TelegramTextDefaultCostInCents: 2,
    getTwilioConfig: jest.fn(),
    getMetaWhatsAppConfig: jest.fn(),
    getTelegramConfig: jest.fn(),
  };
});

import {
  getMetaWhatsAppConfig,
  getTelegramConfig,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000001",
);

const SETTINGS_LINK: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/settings/notification-settings`;

const OWNER_SENTENCE_HTML: string =
  "Add balance in Project Settings &gt; Notification Settings, or turn on Auto Recharge there so it does not run out.";

const WHO_CAN: string =
  "A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.";

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550177");

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

let project: Project;
let createMessage: AsyncMock;
let createCall: AsyncMock;

function ownerEmails(): Array<[ObjectID, string, string]> {
  return (ProjectService.sendEmailToProjectOwners as unknown as jest.Mock).mock
    .calls as unknown as Array<[ObjectID, string, string]>;
}

function firstLogged<T>(service: unknown): T {
  return ((service as { create: jest.Mock }).create.mock.calls[0]![0] as {
    data: T;
  }).data;
}

function expectOwnerEmailAboutBalance(body: string): void {
  expect(body).toContain(OWNER_SENTENCE_HTML);
  expect(body).toContain(`<a href="${SETTINGS_LINK}">${SETTINGS_LINK}</a>`);
  expect(body).not.toMatch(/please/i);
  expect(body).not.toContain("recharge manually");
  expect(body).not.toContain("USD cents");
  expect(body).not.toContain("should is");
}

beforeEach(() => {
  project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme";
  project.enableSmsNotifications = true;
  project.enableCallNotifications = true;
  project.enableWhatsAppNotifications = true;
  project.enableTelegramNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 0;
  project.lowCallAndSMSBalanceNotificationSentToOwners = false;
  project.notEnabledSmsOrCallNotificationSentToOwners = false;

  createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);
  createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  });

  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    TWILIO_CONFIG as never,
  );
  (getMetaWhatsAppConfig as unknown as jest.Mock).mockResolvedValue({
    accessToken: "meta-token",
    phoneNumberId: "meta-phone",
    apiVersion: "v19.0",
  } as never);
  (getTelegramConfig as unknown as jest.Mock).mockResolvedValue({
    botToken: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
    botUsername: "oneuptime_bot",
  } as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    return Promise.resolve(project);
  }) as never);
  jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);
  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockImplementation((() => {
      return Promise.resolve(project.smsOrCallCurrentBalanceInUSDCents);
    }) as never);

  for (const service of [
    SmsLogService,
    CallLogService,
    WhatsAppLogService,
    TelegramLogService,
  ]) {
    jest.spyOn(service as never, "create").mockImplementation(((data: {
      data: { _id?: string };
    }) => {
      data.data._id = ObjectID.generate().toString();
      return Promise.resolve(data.data);
    }) as never);
  }

  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(API, "post").mockResolvedValue({
    jsonData: { ok: true, result: { message_id: "telegram-message-id" } },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an SMS the balance cannot pay for", () => {
  test("nothing left: not sent, and the log says the balance is used up and who can add to it", async () => {
    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
    });

    expect(createMessage).not.toHaveBeenCalled();

    const log: SmsLog = firstLogged<SmsLog>(SmsLogService);

    expect(log.status).toBe(SmsStatus.LowBalance);
    expect(log.statusMessage).toBe(
      `This project's balance is used up. ${WHO_CAN}`,
    );
  });

  test("less than it costs: the log says how much is left against what it costs", async () => {
    project.smsOrCallCurrentBalanceInUSDCents = 4;

    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
    });

    expect(firstLogged<SmsLog>(SmsLogService).statusMessage).toBe(
      getProjectBalanceMessageNotSentReason({
        channel: ProjectNotificationChannel.SMS,
        balanceInUSDCents: 4,
        costInUSDCents: 10,
      }),
    );
    expect(firstLogged<SmsLog>(SmsLogService).statusMessage).toBe(
      `This project's balance (0.04 USD) is less than this SMS costs (0.10 USD). ${WHO_CAN}`,
    );
  });

  test("the owners are told once to add balance or turn on Auto Recharge, with a link", async () => {
    project.smsOrCallCurrentBalanceInUSDCents = 4;

    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
    });

    expect(ownerEmails()).toHaveLength(1);

    const [projectId, subject, body] = ownerEmails()[0]!;

    expect(projectId).toEqual(PROJECT_ID);
    expect(subject).toBe("Low SMS and Call Balance for Acme");
    expect(body).toContain(
      "This SMS was not sent. This project&#39;s balance (0.04 USD) is less than this SMS costs (0.10 USD).",
    );
    expect(body).toContain("Incident Checkout down.");
    expectOwnerEmailAboutBalance(body);

    // Told once: the flag that stops a second email is set.
    expect(ProjectService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lowCallAndSMSBalanceNotificationSentToOwners: true },
      }),
    );
  });

  test("the owners are not emailed a second time", async () => {
    project.lowCallAndSMSBalanceNotificationSentToOwners = true;

    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
    });

    expect(ownerEmails()).toHaveLength(0);
    expect(firstLogged<SmsLog>(SmsLogService).status).toBe(
      SmsStatus.LowBalance,
    );
  });

  test("a sensitive SMS (a verification code) stays out of the owners' email, as it stays out of the log", async () => {
    await SmsService.sendSms(TO, "Your verification code is 482913.", {
      projectId: PROJECT_ID,
      isSensitive: true,
    });

    const body: string = ownerEmails()[0]![2];

    expect(body).not.toContain("482913");
    expect(body).toContain("This message is sensitive and is not logged");
    expect(firstLogged<SmsLog>(SmsLogService).smsText).toBe(
      "This message is sensitive and is not logged",
    );
  });

  test("on the project's own Twilio account nothing is charged, so the balance does not matter", async () => {
    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(ownerEmails()).toHaveLength(0);
  });

  test("with enough balance it is sent", async () => {
    project.smsOrCallCurrentBalanceInUSDCents = 1000;

    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
    });

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(ownerEmails()).toHaveLength(0);
  });
});

describe("a call the balance cannot pay for", () => {
  function call(): CallRequest {
    return {
      to: TO,
      data: [{ sayMessage: "Incident Checkout down on Site 03." }],
    } as unknown as CallRequest;
  }

  test("nothing left: not placed, and the log says who can add balance", async () => {
    await CallService.makeCall(call(), { projectId: PROJECT_ID });

    expect(createCall).not.toHaveBeenCalled();

    const log: CallLog = firstLogged<CallLog>(CallLogService);

    expect(log.status).toBe(CallStatus.LowBalance);
    expect(log.statusMessage).toBe(
      `This project's balance is used up. ${WHO_CAN}`,
    );
  });

  test("less than it costs: about this call, not an SMS", async () => {
    project.smsOrCallCurrentBalanceInUSDCents = 20;

    await CallService.makeCall(call(), { projectId: PROJECT_ID });

    expect(firstLogged<CallLog>(CallLogService).statusMessage).toBe(
      `This project's balance (0.20 USD) is less than this call costs (0.35 USD). ${WHO_CAN}`,
    );

    const body: string = ownerEmails()[0]![2];

    expect(ownerEmails()[0]![1]).toBe("Low SMS and Call Balance for Acme");
    expect(body).toContain(
      `We tried to make a call to ${TO.toString()}. <br/> <br/> This call was not made. This project&#39;s balance (0.20 USD) is less than this call costs (0.35 USD).`,
    );
    expect(body).not.toContain("SMS should");
    expectOwnerEmailAboutBalance(body);
  });

  test("the owners are not emailed a second time", async () => {
    project.lowCallAndSMSBalanceNotificationSentToOwners = true;

    await CallService.makeCall(call(), { projectId: PROJECT_ID });

    expect(ownerEmails()).toHaveLength(0);
  });
});

describe("a WhatsApp message the balance cannot pay for", () => {
  function whatsApp(body: string): WhatsAppMessage {
    return { to: TO, body: body } as unknown as WhatsAppMessage;
  }

  test("not sent, and the log says how much is left against what it costs, and who can add balance", async () => {
    project.smsOrCallCurrentBalanceInUSDCents = 3;

    await WhatsAppService.sendWhatsApp(whatsApp("Incident Checkout down."), {
      projectId: PROJECT_ID,
    });

    const log: WhatsAppLog = firstLogged<WhatsAppLog>(WhatsAppLogService);

    expect(log.status).toBe(WhatsAppStatus.LowBalance);
    expect(log.statusMessage).toBe(
      `This project's balance (0.03 USD) is less than this WhatsApp message costs (0.05 USD). ${WHO_CAN}`,
    );
  });

  test("the owners' email shows markup in the message as text, and links to the page", async () => {
    await WhatsAppService.sendWhatsApp(
      whatsApp('Incident <a href="https://evil.example">Verify billing</a>'),
      { projectId: PROJECT_ID },
    );

    const [, subject, body] = ownerEmails()[0]!;

    expect(subject).toBe("Low WhatsApp message balance for Acme");
    expect(body).not.toContain('<a href="https://evil.example"');
    expect(body).toContain(
      "Incident &lt;a href=&quot;https://evil.example&quot;&gt;Verify billing&lt;/a&gt;",
    );
    expect(body).toContain(
      "This WhatsApp message was not sent. This project&#39;s balance is used up.",
    );
    expect(body.match(/<a href=/g)).toHaveLength(1);
    expectOwnerEmailAboutBalance(body);
  });

  test("a sensitive message stays out of the owners' email", async () => {
    await WhatsAppService.sendWhatsApp(
      whatsApp("Your verification code is 482913."),
      { projectId: PROJECT_ID, isSensitive: true },
    );

    expect(ownerEmails()[0]![2]).not.toContain("482913");
  });
});

describe("a Telegram message the balance cannot pay for", () => {
  const CHAT_ID: string = "123456789";
  const SECRET: string = "incident secret that must not enter owner email";

  test("not sent, and the log says who can add balance", async () => {
    project.smsOrCallCurrentBalanceInUSDCents = 1;

    await TelegramService.sendTelegram(
      { to: CHAT_ID, body: SECRET },
      { projectId: PROJECT_ID },
    );

    expect(API.post).not.toHaveBeenCalled();

    const log: TelegramLog = firstLogged<TelegramLog>(TelegramLogService);

    expect(log.status).toBe(TelegramStatus.LowBalance);
    expect(log.statusMessage).toBe(
      `This project's balance (0.01 USD) is less than this Telegram message costs (0.02 USD). ${WHO_CAN}`,
    );
  });

  test("the owners' email leaves out the chat and the message, like the Telegram-off email, and links to the page", async () => {
    await TelegramService.sendTelegram(
      { to: CHAT_ID, body: SECRET },
      { projectId: PROJECT_ID, isSensitive: false },
    );

    expect(ownerEmails()).toHaveLength(1);

    const [, subject, body] = ownerEmails()[0]!;

    expect(subject).toBe("Low Telegram message balance for Acme");
    expect(body).not.toContain(CHAT_ID);
    expect(body).not.toContain(SECRET);
    expect(body).toContain(
      "A Telegram notification was not sent. This project&#39;s balance is used up.",
    );
    expectOwnerEmailAboutBalance(body);
  });
});
