import Project from "Common/Models/DatabaseModels/Project";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import { WhatsAppTemplateIds } from "Common/Types/WhatsApp/WhatsAppTemplates";
import API from "Common/Utils/API";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import WhatsAppService from "../../FeatureSet/Notification/Services/WhatsAppService";

/*
 * HOW EVERY WHATSAPP MESSAGE WENT, FOR THE PLATFORM'S OPERATOR (issue #6600).
 *
 * Each message is recorded once (notification.send.count and .duration)
 * as handed to Meta's WhatsApp API: accepted, refused, or deliberately not
 * sent - the project has too little balance, or is gone.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return {
          record: (value: number, attributes: Record<string, string>): void => {
            sendDurationCalls.push({ value, attributes });
          },
        };
      },
    },
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    WhatsAppTextDefaultCostInCents: 1,
    DEFAULT_META_WHATSAPP_API_VERSION: "v21.0",
    getMetaWhatsAppConfig: jest
      .fn<() => Promise<Record<string, string>>>()
      .mockResolvedValue({
        accessToken: "meta-access-token",
        phoneNumberId: "1234567890",
        apiVersion: "v21.0",
      }),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const URLType: { fromString: (url: string) => unknown } = (
    jest.requireActual("Common/Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    }
  ).default;

  return {
    IsBillingEnabled: true,
    DashboardClientUrl: URLType.fromString(
      "https://oneuptime.example.com/dashboard",
    ),
  };
});

jest.mock("Common/Server/Services/NotificationService", () => {
  return {
    __esModule: true,
    default: { rechargeIfBalanceIsLow: jest.fn() },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      sendEmailToProjectOwners: jest.fn(),
      updateOneById: jest.fn(),
      claimSmsOrCallLowBalanceNotice: jest.fn(),
      deductSmsOrCallBalanceInUSDCents: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/WhatsAppLogService", () => {
  return {
    __esModule: true,
    default: { create: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { updateOneById: jest.fn(), markNotSent: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "66007777-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66007777-0000-4000-8000-000000000002",
);

function project(overrides: Partial<Project> = {}): Project {
  const value: Project = new Project();
  value.id = PROJECT_ID;
  value.smsOrCallCurrentBalanceInUSDCents = 10_000;
  value.lowCallAndSMSBalanceNotificationSentToOwners = true;
  value.notEnabledSmsOrCallNotificationSentToOwners = true;
  value.name = "Example project";
  Object.assign(value, overrides);
  return value;
}

function message(): WhatsAppMessage {
  return {
    to: new Phone("+15555550123"),
    body: "",
    templateKey: WhatsAppTemplateIds.AlertCreated,
    templateVariables: {
      alert_number: "12",
      alert_title: "Checkout API is down",
      project_name: "Example project",
      acknowledge_url: "https://oneuptime.example.com/a",
      alert_link: "https://oneuptime.example.com/b",
    },
  } as WhatsAppMessage;
}

function onlySend(): Record<string, string> {
  expect(sendCounterCalls).toHaveLength(1);
  expect(sendDurationCalls).toHaveLength(1);
  return sendCounterCalls[0]!.attributes;
}

describe("a WhatsApp message", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendCounterCalls.length = 0;
    sendDurationCalls.length = 0;

    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(project() as never);
    jest
      .spyOn(NotificationService, "rechargeIfBalanceIsLow")
      .mockResolvedValue(10_000);
    jest
      .spyOn(WhatsAppLogService, "create")
      .mockResolvedValue(new WhatsAppLog() as never);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(
          200,
          { messages: [{ id: "wamid.HBgL" }] },
          {},
        ) as never,
      );
  });

  test("accepted by Meta: a success through meta_whatsapp", async () => {
    await WhatsAppService.sendWhatsApp(message(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(onlySend()).toEqual({
      "notification.channel": "whatsapp",
      "notification.provider": "meta_whatsapp",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "success",
    });
  });

  test("refused by Meta: a failure, and the send still throws", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPErrorResponse(
          400,
          { error: { message: "Template name does not exist" } },
          {},
        ) as never,
      );

    await expect(
      WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("Template name does not exist");

    expect(onlySend()).toMatchObject({
      "notification.provider": "meta_whatsapp",
      "notification.on_call_page": "false",
      outcome: "failure",
    });
  });

  test("the project's balance cannot pay for it: not sent", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        project({ smsOrCallCurrentBalanceInUSDCents: 0 }) as never,
      );
    jest
      .spyOn(NotificationService, "rechargeIfBalanceIsLow")
      .mockResolvedValue(0);

    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    expect(API.post).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  test("the project cannot be found: not sent", async () => {
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue(null as never);

    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    expect(API.post).not.toHaveBeenCalled();
    expect(onlySend()["outcome"]).toBe("not_sent");
  });

  /*
   * Meta's status webhook reads the page from the log, to count how the
   * message ended as an on-call page as its send was (issue #6648).
   */
  test("the log of an on-call page's message keeps the page it was sent for", async () => {
    await WhatsAppService.sendWhatsApp(message(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    const log: WhatsAppLog = (
      (WhatsAppLogService.create as jest.Mock).mock.calls[0]![0] as {
        data: WhatsAppLog;
      }
    ).data;

    expect(log.userOnCallLogTimelineId?.toString()).toBe(
      TIMELINE_ID.toString(),
    );
    expect(log.whatsAppMessageId).toBe("wamid.HBgL");
  });

  test("a message of no page keeps none", async () => {
    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    const log: WhatsAppLog = (
      (WhatsAppLogService.create as jest.Mock).mock.calls[0]![0] as {
        data: WhatsAppLog;
      }
    ).data;

    expect(log.userOnCallLogTimelineId).toBeUndefined();
  });

  test("a page's message not sent - too little balance - keeps the page on its log too", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(
        project({ smsOrCallCurrentBalanceInUSDCents: 0 }) as never,
      );
    jest
      .spyOn(NotificationService, "rechargeIfBalanceIsLow")
      .mockResolvedValue(0);

    await WhatsAppService.sendWhatsApp(message(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    const log: WhatsAppLog = (
      (WhatsAppLogService.create as jest.Mock).mock.calls[0]![0] as {
        data: WhatsAppLog;
      }
    ).data;

    expect(log.userOnCallLogTimelineId?.toString()).toBe(
      TIMELINE_ID.toString(),
    );
  });

  test("with no template to send: a failure", async () => {
    await expect(
      WhatsAppService.sendWhatsApp(
        { to: new Phone("+15555550123"), body: "Hello" } as WhatsAppMessage,
        { projectId: PROJECT_ID },
      ),
    ).rejects.toThrow("template key is required");

    expect(onlySend()["outcome"]).toBe("failure");
  });
});
