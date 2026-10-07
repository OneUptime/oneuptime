import CallService from "../../FeatureSet/Notification/Services/CallService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import TelegramService from "../../FeatureSet/Notification/Services/TelegramService";
import WhatsAppService from "../../FeatureSet/Notification/Services/WhatsAppService";
import Project from "Common/Models/DatabaseModels/Project";
import CallLogService from "Common/Server/Services/CallLogService";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import API from "Common/Utils/API";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "Common/Utils/Project/NotificationChannels";
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
 * A PAGE THAT IS NOT SENT SAYS WHY ON THE PERSON'S ON-CALL TIMELINE.
 *
 * An on-call page by SMS, call, WhatsApp or Telegram first writes a row on
 * the person's on-call timeline - "Sending SMS to +1555..." - and the
 * Notification service then records how it went. When it deliberately did
 * not send - the project's balance could not pay for it, the project has
 * the channel turned off, or the project is gone - it returned early,
 * before that update: the row said "Sending" for ever, and nobody looking
 * at the timeline could tell the page never went out, or why.
 *
 * Now every such skip records the row as not sent, with the same plain
 * reason the message's log gives (for a balance: the shortfall and who can
 * add balance), as the timeline's other skips - an unverified number, say -
 * already do.
 */

jest.mock("twilio", () => {
  // A placed call is described to Twilio as TwiML.
  class VoiceResponse {
    private parts: Array<string> = [];

    public say(text: string): void {
      this.parts.push(`<Say>${text}</Say>`);
    }

    public gather(): void {
      this.parts.push("<Gather/>");
    }

    public hangup(): void {
      this.parts.push("<Hangup/>");
    }

    public toString(): string {
      return `<Response>${this.parts.join("")}</Response>`;
    }
  }

  const twilio: Mock<(...args: Array<unknown>) => unknown> & {
    twiml?: unknown;
  } = jest.fn<(...args: Array<unknown>) => unknown>();
  twilio.twiml = { VoiceResponse };

  return {
    __esModule: true,
    default: twilio,
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
  "7f000000-0000-4000-8000-0000000000b1",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-0000000000b2",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550177");
const CHAT_ID: string = "123456789";

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

let project: Project | null;
let createMessage: AsyncMock;
let createCall: AsyncMock;

interface TimelineUpdate {
  id: string;
  status: UserNotificationStatus;
  statusMessage: string;
}

function timelineUpdates(): Array<TimelineUpdate> {
  return (
    UserOnCallLogTimelineService.updateOneById as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>): TimelineUpdate => {
    const argument: {
      id: ObjectID;
      data: { status: UserNotificationStatus; statusMessage: string };
    } = call[0] as {
      id: ObjectID;
      data: { status: UserNotificationStatus; statusMessage: string };
    };

    return {
      id: argument.id.toString(),
      status: argument.data.status,
      statusMessage: argument.data.statusMessage,
    };
  });
}

// What the person's timeline row ends up saying: one update, not sent, why.
function expectTimelineNotSent(reason: string): void {
  expect(timelineUpdates()).toEqual([
    {
      id: TIMELINE_ID.toString(),
      status: UserNotificationStatus.Error,
      statusMessage: reason,
    },
  ]);
}

function sms(options: { onTimeline?: boolean } = {}): Promise<void> {
  return SmsService.sendSms(TO, "Incident Checkout down.", {
    projectId: PROJECT_ID,
    ...(options.onTimeline === false
      ? {}
      : { userOnCallLogTimelineId: TIMELINE_ID }),
  });
}

function call(options: { onTimeline?: boolean } = {}): Promise<void> {
  return CallService.makeCall(
    {
      to: TO,
      data: [{ sayMessage: "Incident Checkout down on Site 03." }],
    } as unknown as CallRequest,
    {
      projectId: PROJECT_ID,
      ...(options.onTimeline === false
        ? {}
        : { userOnCallLogTimelineId: TIMELINE_ID }),
    },
  );
}

function whatsApp(options: { onTimeline?: boolean } = {}): Promise<void> {
  return WhatsAppService.sendWhatsApp(
    {
      to: TO,
      body: "Incident Checkout down.",
      templateKey: "oneuptime_incident_created",
    } as unknown as WhatsAppMessage,
    {
      projectId: PROJECT_ID,
      ...(options.onTimeline === false
        ? {}
        : { userOnCallLogTimelineId: TIMELINE_ID }),
    },
  );
}

function telegram(options: { onTimeline?: boolean } = {}): Promise<void> {
  return TelegramService.sendTelegram(
    { to: CHAT_ID, body: "Incident Checkout down." },
    {
      projectId: PROJECT_ID,
      ...(options.onTimeline === false
        ? {}
        : { userOnCallLogTimelineId: TIMELINE_ID }),
    },
  );
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
      return Promise.resolve(project?.smsOrCallCurrentBalanceInUSDCents || 0);
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
    jsonData: {
      ok: true,
      result: { message_id: "telegram-message-id" },
      messages: [{ id: "wamid-1" }],
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a page the project's balance cannot pay for", () => {
  test("SMS: the timeline row says it was not sent, with the shortfall and who can add balance", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 4;

    await sms();

    expect(createMessage).not.toHaveBeenCalled();
    expectTimelineNotSent(
      getProjectBalanceMessageNotSentReason({
        channel: ProjectNotificationChannel.SMS,
        balanceInUSDCents: 4,
        costInUSDCents: 10,
      }),
    );
  });

  test("SMS with nothing left: the row says the balance is used up", async () => {
    await sms();

    expectTimelineNotSent(
      "This project's balance is used up. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
  });

  test("call: the row says this call was not made, and why", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 20;

    await call();

    expect(createCall).not.toHaveBeenCalled();
    expectTimelineNotSent(
      getProjectBalanceMessageNotSentReason({
        channel: ProjectNotificationChannel.Call,
        balanceInUSDCents: 20,
        costInUSDCents: 35,
      }),
    );
  });

  test("WhatsApp: the row says it was not sent, and why", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 3;

    await whatsApp();

    expectTimelineNotSent(
      getProjectBalanceMessageNotSentReason({
        channel: ProjectNotificationChannel.WhatsApp,
        balanceInUSDCents: 3,
        costInUSDCents: 5,
      }),
    );
  });

  test("Telegram: the row says it was not sent, and why", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 1;

    await telegram();

    expect(API.post).not.toHaveBeenCalled();
    expectTimelineNotSent(
      getProjectBalanceMessageNotSentReason({
        channel: ProjectNotificationChannel.Telegram,
        balanceInUSDCents: 1,
        costInUSDCents: 2,
      }),
    );
  });
});

describe("a page on a channel the project has turned off", () => {
  test("SMS off: the row says SMS is off, and who can turn it on", async () => {
    project!.enableSmsNotifications = false;

    await sms();

    expectTimelineNotSent(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
    );
  });

  test("calls off: the row says calls are off, and who can turn them on", async () => {
    project!.enableCallNotifications = false;

    await call();

    expectTimelineNotSent(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.Call),
    );
  });

  test("Telegram off: the row says Telegram is off, and who can turn it on", async () => {
    project!.enableTelegramNotifications = false;

    await telegram();

    expectTimelineNotSent(
      getProjectNotificationChannelOffMessage(
        ProjectNotificationChannel.Telegram,
      ),
    );
  });
});

describe("a page for a project that no longer exists", () => {
  test.each([
    ["SMS", sms],
    ["call", call],
    ["WhatsApp", whatsApp],
    ["Telegram", telegram],
  ])(
    "%s: the row says the project was not found",
    async (_channel: string, send: () => Promise<void>) => {
      project = null;

      await send();

      expectTimelineNotSent(`Project ${PROJECT_ID.toString()} not found.`);
    },
  );
});

describe("everything else stays as it was", () => {
  test.each([
    ["SMS", sms],
    ["call", call],
    ["WhatsApp", whatsApp],
    ["Telegram", telegram],
  ])(
    "%s not sent without a timeline row (a status page subscriber, a test send): nothing to update",
    async (
      _channel: string,
      send: (options: { onTimeline?: boolean }) => Promise<void>,
    ) => {
      await send({ onTimeline: false });

      expect(timelineUpdates()).toEqual([]);
    },
  );

  test("an SMS that is sent records Sent on the row, once", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 1000;

    await sms();

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(timelineUpdates()).toHaveLength(1);
    expect(timelineUpdates()[0]!.status).toBe(UserNotificationStatus.Sent);
  });

  test("a call that is placed records Sent on the row, once", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 1000;

    await call();

    expect(createCall).toHaveBeenCalledTimes(1);
    expect(timelineUpdates()).toHaveLength(1);
    expect(timelineUpdates()[0]!.status).toBe(UserNotificationStatus.Sent);
  });

  test("a Telegram message that is sent records Sent on the row, once", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 1000;

    await telegram();

    expect(timelineUpdates()).toHaveLength(1);
    expect(timelineUpdates()[0]!.status).toBe(UserNotificationStatus.Sent);
  });

  test("a timeline update that fails does not turn a skipped page into an error for the sender", async () => {
    (
      UserOnCallLogTimelineService.updateOneById as unknown as jest.Mock
    ).mockRejectedValue(new Error("database unavailable") as never);

    await expect(sms()).resolves.toBeUndefined();
  });
});
