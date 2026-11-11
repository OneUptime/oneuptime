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
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
import logger from "Common/Server/Utils/Logger";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "./Fixtures/OnCallTimelineRows";

/*
 * HOW EVERY WHATSAPP MESSAGE WENT, FOR THE PLATFORM'S OPERATOR (issue #6600).
 *
 * Each message is recorded once (notification.send.count and .duration)
 * as handed to Meta's WhatsApp API: accepted, refused, or deliberately not
 * sent - the project has too little balance, or is gone.
 *
 * Its log is written just before the message is handed to Meta - Queued,
 * with no message id - and gets the send's result, the id with it, once
 * Meta answers (issue #6684): a status Meta reports in between is then not
 * lost (API/WhatsApp.ts). An on-call page's notification says Sent, or
 * Error, only while it still says Sending: Meta's report that the message
 * failed, or the person's acknowledgement, written first, stays (#6683).
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
    default: { create: jest.fn(), updateColumnsByIdWithoutHooks: jest.fn() },
  };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneBy: jest.fn(),
      markNotSent: jest.fn(),
    },
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
const LOG_ID: ObjectID = new ObjectID("66007777-0000-4000-8000-000000000003");
const RECIPIENT: string = "+15555550123";
const META_MESSAGE_ID: string = "wamid.HBgL";

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
    to: new Phone(RECIPIENT),
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

// Each log as it was when it was written, before the send changed it.
let createdLogs: Array<WhatsAppLog>;
let timeline: OnCallTimelineRows;

// The send's result, as written on the log by its id.
function logWrites(): Array<unknown> {
  return (
    WhatsAppLogService.updateColumnsByIdWithoutHooks as unknown as jest.Mock
  ).mock.calls.map((call: Array<unknown>) => {
    return call[0];
  });
}

function refusedByMeta(): void {
  jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { error: { message: "Template name does not exist" } },
        {},
      ) as never,
    );
}

function tooLittleBalance(): void {
  jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue(
      project({ smsOrCallCurrentBalanceInUSDCents: 0 }) as never,
    );
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(0);
}

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

  createdLogs = [];
  jest.spyOn(WhatsAppLogService, "create").mockImplementation(((input: {
    data: WhatsAppLog;
  }) => {
    createdLogs.push(Object.assign(new WhatsAppLog(), input.data));

    const row: WhatsAppLog = new WhatsAppLog();
    row.id = LOG_ID;
    return Promise.resolve(row);
  }) as never);
  jest
    .spyOn(WhatsAppLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { messages: [{ id: META_MESSAGE_ID }] },
        {},
      ) as never,
    );

  // The page's notification, written Sending as its page went out.
  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
});

describe("a WhatsApp message", () => {
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
    refusedByMeta();

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
    tooLittleBalance();

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

    expect(createdLogs).toHaveLength(1);
    expect(createdLogs[0]!.userOnCallLogTimelineId?.toString()).toBe(
      TIMELINE_ID.toString(),
    );
  });

  test("a message of no page keeps none", async () => {
    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    expect(createdLogs[0]!.userOnCallLogTimelineId).toBeUndefined();
  });

  test("a page's message not sent - too little balance - keeps the page on its log too", async () => {
    tooLittleBalance();

    await WhatsAppService.sendWhatsApp(message(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(createdLogs).toHaveLength(1);
    expect(createdLogs[0]!.status).toBe(WhatsAppStatus.LowBalance);
    expect(createdLogs[0]!.userOnCallLogTimelineId?.toString()).toBe(
      TIMELINE_ID.toString(),
    );
    expect(logWrites()).toEqual([]);
  });

  test("with no template to send: a failure", async () => {
    await expect(
      WhatsAppService.sendWhatsApp(
        { to: new Phone(RECIPIENT), body: "Hello" } as WhatsAppMessage,
        { projectId: PROJECT_ID },
      ),
    ).rejects.toThrow("template key is required");

    expect(onlySend()["outcome"]).toBe("failure");
  });
});

describe("the log, written before the message is handed to Meta (issue #6684)", () => {
  test("is written Queued, with no message id yet, before Meta is asked", async () => {
    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    expect(createdLogs).toHaveLength(1);
    expect(createdLogs[0]!.status).toBe(WhatsAppStatus.Queued);
    expect(createdLogs[0]!.whatsAppMessageId).toBeUndefined();
    expect(createdLogs[0]!.toNumber?.toString()).toBe(RECIPIENT);

    const created: number = (WhatsAppLogService.create as unknown as jest.Mock)
      .mock.invocationCallOrder[0]!;
    const asked: number = (API.post as unknown as jest.Mock).mock
      .invocationCallOrder[0]!;

    expect(created).toBeLessThan(asked);
  });

  test("Meta's answer goes on that log, in one write by its id: the message's id, Sent, what it cost", async () => {
    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    expect(logWrites()).toEqual([
      {
        id: LOG_ID,
        data: {
          status: WhatsAppStatus.Sent,
          statusMessage: `Message ID: ${META_MESSAGE_ID}`,
          whatsAppCostInUSDCents: 1,
          whatsAppMessageId: META_MESSAGE_ID,
        },
      },
    ]);
    // One log, not a second one written after the send.
    expect(createdLogs).toHaveLength(1);
  });

  test("an answer with no message id: Sent, with nothing a status could name", async () => {
    jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}) as never);

    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    expect(logWrites()).toEqual([
      {
        id: LOG_ID,
        data: {
          status: WhatsAppStatus.Sent,
          statusMessage: "WhatsApp message sent successfully",
          whatsAppCostInUSDCents: 1,
        },
      },
    ]);
  });

  test("refused by Meta: the same log says Error, with Meta's words, and cost nothing", async () => {
    refusedByMeta();

    await expect(
      WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("Template name does not exist");

    expect(createdLogs).toHaveLength(1);
    expect(logWrites()).toEqual([
      {
        id: LOG_ID,
        data: {
          status: WhatsAppStatus.Error,
          statusMessage: "Template name does not exist",
          whatsAppCostInUSDCents: 0,
        },
      },
    ]);
  });

  test("Meta not reached: the same log says Error", async () => {
    jest
      .spyOn(API, "post")
      .mockRejectedValue(new Error("connect ETIMEDOUT") as never);

    await expect(
      WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID }),
    ).rejects.toThrow("connect ETIMEDOUT");

    expect(createdLogs).toHaveLength(1);
    expect(logWrites()).toEqual([
      {
        id: LOG_ID,
        data: {
          status: WhatsAppStatus.Error,
          statusMessage: "connect ETIMEDOUT",
          whatsAppCostInUSDCents: 0,
        },
      },
    ]);
  });

  test("a send that fails before the log is written - no template - is logged once, as an Error", async () => {
    await expect(
      WhatsAppService.sendWhatsApp(
        { to: new Phone(RECIPIENT), body: "Hello" } as WhatsAppMessage,
        { projectId: PROJECT_ID },
      ),
    ).rejects.toThrow("template key is required");

    expect(createdLogs).toHaveLength(1);
    expect(createdLogs[0]!.status).toBe(WhatsAppStatus.Error);
    expect(logWrites()).toEqual([]);
    expect(API.post).not.toHaveBeenCalled();
  });

  test("with no project - a test from the Admin Dashboard - nothing is logged, before or after", async () => {
    await WhatsAppService.sendWhatsApp(message(), {});

    expect(API.post).toHaveBeenCalledTimes(1);
    expect(createdLogs).toEqual([]);
    expect(logWrites()).toEqual([]);
  });

  test("the debug line of the request names neither the number nor what the message says", async () => {
    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    const lines: string = JSON.stringify(
      (logger.debug as unknown as jest.Mock).mock.calls,
    );

    expect(lines).toContain("WhatsApp API request");
    expect(lines).not.toContain("5555550123");
    expect(lines).not.toContain("Checkout API is down");
  });
});

describe("the page's notification (issues #6682, #6683)", () => {
  test("accepted by Meta: Sent, with Meta's message id", async () => {
    await WhatsAppService.sendWhatsApp(message(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(timeline.writes).toEqual([
      {
        id: TIMELINE_ID.toString(),
        data: {
          status: UserNotificationStatus.Sent,
          statusMessage: `Message ID: ${META_MESSAGE_ID}`,
        },
      },
    ]);
  });

  test("refused by Meta: Error, with Meta's words", async () => {
    refusedByMeta();

    await expect(
      WhatsAppService.sendWhatsApp(message(), {
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      }),
    ).rejects.toThrow("Template name does not exist");

    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "Template name does not exist",
    });
  });

  test.each([
    [UserNotificationStatus.Error, "Meta's report that the message failed"],
    [UserNotificationStatus.Acknowledged, "the person's acknowledgement"],
    [UserNotificationStatus.Skipped, "a skip"],
  ])(
    "a notification already %s - %s, written first - stays: the send does not put Sent back",
    async (status: UserNotificationStatus) => {
      timeline.get(TIMELINE_ID)!.status = status;
      timeline.get(TIMELINE_ID)!.statusMessage = "written first";

      await WhatsAppService.sendWhatsApp(message(), {
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      });

      expect(timeline.writes).toEqual([]);
      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: status,
        statusMessage: "written first",
      });
    },
  );

  test("an acknowledgement landing between the read and the write stays", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
    });

    await WhatsAppService.sendWhatsApp(message(), {
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(timeline.writes).toEqual([]);
    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Acknowledged,
    );
  });

  test("a message of no page touches no notification", async () => {
    await WhatsAppService.sendWhatsApp(message(), { projectId: PROJECT_ID });

    expect(UserOnCallLogTimelineService.findOneById).not.toHaveBeenCalled();
    expect(timeline.writes).toEqual([]);
  });
});
