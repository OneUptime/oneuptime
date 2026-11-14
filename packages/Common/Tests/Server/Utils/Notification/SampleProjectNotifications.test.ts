jest.mock("../../../../Server/Utils/Logger", () => {
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

jest.mock("../../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../../Enterprise/TestBillingFlag",
    ) as typeof import("../../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../../Enterprise/TestBillingFlag";
import CallService from "../../../../Server/Services/CallService";
import CustomNotificationChannelDeliveryService from "../../../../Server/Services/CustomNotificationChannelDeliveryService";
import MailService from "../../../../Server/Services/MailService";
import ProjectService from "../../../../Server/Services/ProjectService";
import PushNotificationService from "../../../../Server/Services/PushNotificationService";
import SmsService from "../../../../Server/Services/SmsService";
import TelegramService from "../../../../Server/Services/TelegramService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import WebhookService from "../../../../Server/Services/WebhookService";
import WhatsAppService from "../../../../Server/Services/WhatsAppService";
import WorkspaceNotificationLogService from "../../../../Server/Services/WorkspaceNotificationLogService";
import WorkspaceProjectAuthTokenService from "../../../../Server/Services/WorkspaceProjectAuthTokenService";
import WorkspaceUserNotificationService from "../../../../Server/Services/WorkspaceUserNotificationService";
import logger from "../../../../Server/Utils/Logger";
import BlockedProjectNotifications from "../../../../Server/Utils/Notification/BlockedProjectNotifications";
import WorkspaceUtil from "../../../../Server/Utils/Workspace/Workspace";
import SlackUtil from "../../../../Server/Utils/Workspace/Slack/Slack";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import Email from "../../../../Types/Email";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
import ObjectID from "../../../../Types/ObjectID";
import Phone from "../../../../Types/Phone";
import {
  SAMPLE_PERSON_NOT_SENT_REASON,
  SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE,
  getSamplePersonEmail,
  getSampleProjectNotSentReason,
} from "../../../../Types/SampleProject/SampleProject";
import WorkspaceMessagePayload from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import API from "../../../../Utils/API";
import { WorkspaceSendMessageResponse } from "../../../../Server/Utils/Workspace/WorkspaceBase";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ---------------------------------------------------------------------------
 * NOTHING LEAVES A SAMPLE PROJECT (issue #6808).
 *
 * A sample project (Project.isSampleProject) is made up for a person to look
 * around in: no email, SMS, call, WhatsApp, Telegram, push, webhook, custom
 * channel or chat message ever leaves it - each sender refuses it the way it
 * refuses a blocked project, with a reason that says it is a sample, and
 * nothing reaches the Notification service. And nothing is ever sent to a
 * sample person's address, whatever sends it.
 * ---------------------------------------------------------------------------
 */

const SAMPLE_PROJECT_ID: ObjectID = new ObjectID(
  "c6808000-0000-4000-8000-0000000000a1",
);
const REAL_PROJECT_ID: ObjectID = new ObjectID(
  "c6808000-0000-4000-8000-0000000000b1",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "c6808000-0000-4000-8000-000000000001",
);

let isSampleProject: jest.SpyInstance;
let markNotSent: jest.SpyInstance;
let post: jest.SpyInstance;

beforeEach(() => {
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  isSampleProject = jest
    .spyOn(ProjectService, "isSampleProject")
    .mockImplementation(async (projectId: ObjectID | string) => {
      return projectId.toString() === SAMPLE_PROJECT_ID.toString();
    });
  markNotSent = jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined);
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as unknown as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const expectNotSent: (response: unknown, channel: string) => void = (
  response: unknown,
  channel: string,
): void => {
  expect(response).toBeInstanceOf(HTTPErrorResponse);
  expect((response as HTTPErrorResponse).statusCode).toBe(403);
  expect((response as HTTPErrorResponse).message).toBe(
    getSampleProjectNotSentReason(channel),
  );
  expect(post).not.toHaveBeenCalled();
};

describe("BlockedProjectNotifications for a sample project", () => {
  test("refuses, and the on-call timeline says it is a sample", async () => {
    const refusal: HTTPErrorResponse | null =
      await BlockedProjectNotifications.getRefusal({
        channel: "SMS",
        projectId: SAMPLE_PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      });

    expect(refusal?.statusCode).toBe(403);
    expect(refusal?.message).toBe(
      `SMS not sent: ${SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE}`,
    );
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: `SMS not sent: ${SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE}`,
    });
  });

  test("lets a real project send", async () => {
    await expect(
      BlockedProjectNotifications.getRefusal({
        channel: "SMS",
        projectId: REAL_PROJECT_ID,
      }),
    ).resolves.toBeNull();

    expect(markNotSent).not.toHaveBeenCalled();
  });

  test("a blocked sample is refused as blocked: the block is said first", async () => {
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(true);

    await expect(
      BlockedProjectNotifications.getSilencedReason({
        channel: "Email",
        projectId: SAMPLE_PROJECT_ID,
      }),
    ).resolves.toBe(`Email not sent: ${ExceptionMessages.ProjectBlocked}`);
  });

  test("asks nothing when no project is named", async () => {
    await expect(
      BlockedProjectNotifications.getSilencedReason({ channel: "Email" }),
    ).resolves.toBeNull();

    expect(isSampleProject).not.toHaveBeenCalled();
  });

  test("fails open: a lookup that fails sends as usual, and is logged", async () => {
    isSampleProject.mockRejectedValue(new Error("database unavailable"));

    await expect(
      BlockedProjectNotifications.getRefusal({
        channel: "Call",
        projectId: SAMPLE_PROJECT_ID,
      }),
    ).resolves.toBeNull();

    expect(logger.error).toHaveBeenCalled();
  });
});

describe("every sender refuses a sample project", () => {
  test("email", async () => {
    expectNotSent(
      await MailService.sendMail(
        {
          toEmail: new Email("owner@example.com"),
          subject: "Incident created",
          vars: {},
        },
        { projectId: SAMPLE_PROJECT_ID },
      ),
      "Email",
    );
  });

  test("SMS, and the on-call timeline says why", async () => {
    expectNotSent(
      await SmsService.sendSms(
        { to: new Phone("+15550000000"), message: "Incident created" },
        { projectId: SAMPLE_PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
      "SMS",
    );
    expect(markNotSent).toHaveBeenCalledTimes(1);
  });

  test("a call", async () => {
    expectNotSent(
      await CallService.makeCall(
        {
          to: new Phone("+15550000000"),
          data: [],
        } as unknown as Parameters<typeof CallService.makeCall>[0],
        { projectId: SAMPLE_PROJECT_ID },
      ),
      "Call",
    );
  });

  test("a WhatsApp message", async () => {
    expectNotSent(
      await WhatsAppService.sendWhatsAppMessage(
        {
          to: new Phone("+15550000000"),
        } as unknown as Parameters<
          typeof WhatsAppService.sendWhatsAppMessage
        >[0],
        { projectId: SAMPLE_PROJECT_ID },
      ),
      "WhatsApp message",
    );
  });

  test("a Telegram message", async () => {
    expectNotSent(
      await TelegramService.sendTelegramMessage(
        {
          to: "123456",
          message: "Incident created",
        } as unknown as Parameters<
          typeof TelegramService.sendTelegramMessage
        >[0],
        { projectId: SAMPLE_PROJECT_ID },
      ),
      "Telegram message",
    );
  });

  test("a webhook", async () => {
    expectNotSent(
      await WebhookService.sendWebhook(
        {
          url: "https://hooks.example.com/oneuptime",
          eventType: "incident.created",
          payload: {},
        },
        { projectId: SAMPLE_PROJECT_ID },
      ),
      "Webhook",
    );
  });

  test("a push notification: nothing is asked of it, and the timeline says why", async () => {
    await expect(
      PushNotificationService.sendPushNotification(
        {
          devices: [],
          message: { title: "Incident created", body: "Checkout" },
        } as unknown as Parameters<
          typeof PushNotificationService.sendPushNotification
        >[0],
        { projectId: SAMPLE_PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
      ),
    ).resolves.toBeUndefined();

    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: expect.stringContaining(SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE),
    });
  });

  test("a custom notification channel, licensed and all", async () => {
    // Custom channels are an Enterprise feature: loaded, so only the sample stops it.
    setTestBillingEnabled(false);
    installFakeEnterpriseModule();

    const result: unknown = await CustomNotificationChannelDeliveryService.send(
      {
        customNotificationChannelId: new ObjectID(
          "c6808000-0000-4000-8000-0000000000c1",
        ),
        eventType: "on-call.incident.created",
        payload: { version: 1 },
        projectId: SAMPLE_PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      },
    );

    expect(post).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain(
      SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE,
    );
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: expect.stringContaining(SAMPLE_PROJECT_SENDS_NOTHING_MESSAGE),
    });

    uninstallEnterpriseModule();
  });

  test("a real project's email is sent", async () => {
    await MailService.sendMail(
      {
        toEmail: new Email("owner@example.com"),
        subject: "Incident created",
        vars: {},
      },
      { projectId: REAL_PROJECT_ID },
    );

    expect(post).toHaveBeenCalledTimes(1);
  });
});

describe("nothing is sent to a sample person's address", () => {
  const samplePersonEmail: Email = new Email(
    getSamplePersonEmail({
      handle: "maya.chen",
      projectId: SAMPLE_PROJECT_ID.toString(),
    }),
  );

  test("from a real project", async () => {
    const response: unknown = await MailService.sendMail(
      { toEmail: samplePersonEmail, subject: "You are invited", vars: {} },
      { projectId: REAL_PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
    );

    expect(response).toBeInstanceOf(HTTPErrorResponse);
    expect((response as HTTPErrorResponse).message).toBe(
      SAMPLE_PERSON_NOT_SENT_REASON,
    );
    expect(post).not.toHaveBeenCalled();
    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: SAMPLE_PERSON_NOT_SENT_REASON,
    });
  });

  test("with no project at all: an account email", async () => {
    const response: unknown = await MailService.sendMail({
      toEmail: samplePersonEmail,
      subject: "Complete your registration",
      vars: {},
    });

    expect(response).toBeInstanceOf(HTTPErrorResponse);
    expect(post).not.toHaveBeenCalled();
  });
});

describe("chat messages from a sample project", () => {
  const payload: (workspaceType: WorkspaceType) => WorkspaceMessagePayload = (
    workspaceType: WorkspaceType,
  ): WorkspaceMessagePayload => {
    return {
      _type: "WorkspaceMessagePayload",
      channelNames: ["incidents"],
      channelIds: [],
      messageBlocks: [],
      workspaceType: workspaceType,
    };
  };

  test("are not posted to Slack, Microsoft Teams or Mattermost, and say why", async () => {
    const getProjectAuth: jest.SpyInstance = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "getProjectAuth",
    );

    const responses: Array<WorkspaceSendMessageResponse> =
      await WorkspaceUtil.postMessageToAllWorkspaceChannelsAsBot({
        projectId: SAMPLE_PROJECT_ID,
        messagePayloadsByWorkspace: [
          payload(WorkspaceType.Slack),
          payload(WorkspaceType.MicrosoftTeams),
          payload(WorkspaceType.Mattermost),
        ],
      });

    const reason: string = getSampleProjectNotSentReason("Workspace message");

    expect(responses).toEqual([
      {
        workspaceType: WorkspaceType.Slack,
        threads: [],
        notSentReason: reason,
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        threads: [],
        notSentReason: reason,
      },
      {
        workspaceType: WorkspaceType.Mattermost,
        threads: [],
        notSentReason: reason,
      },
    ]);
    expect(getProjectAuth).not.toHaveBeenCalled();
  });

  test("are not posted to a channel either", async () => {
    const getWorkspaceTypeUtil: jest.SpyInstance = jest.spyOn(
      WorkspaceUtil,
      "getWorkspaceTypeUtil",
    );

    await expect(
      WorkspaceUtil.postToWorkspaceChannels({
        workspaceUserId: "U123",
        projectOrUserAuthTokenForWorkspace: "xoxb-token",
        workspaceType: WorkspaceType.Slack,
        workspaceMessagePayload: payload(WorkspaceType.Slack),
        projectId: SAMPLE_PROJECT_ID,
      }),
    ).resolves.toEqual({ workspaceType: WorkspaceType.Slack, threads: [] });

    expect(getWorkspaceTypeUtil).not.toHaveBeenCalled();
  });

  test("send nobody a direct message: the send fails with why, and nothing is asked of Slack", async () => {
    const sendDirectMessageToUser: jest.SpyInstance = jest.spyOn(
      SlackUtil,
      "sendDirectMessageToUser",
    );
    const getProjectAuth: jest.SpyInstance = jest.spyOn(
      WorkspaceProjectAuthTokenService,
      "getProjectAuth",
    );
    const createWorkspaceLog: jest.SpyInstance = jest
      .spyOn(WorkspaceNotificationLogService, "createWorkspaceLog")
      .mockResolvedValue(undefined as never);

    await expect(
      WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: SAMPLE_PROJECT_ID,
        workspaceType: WorkspaceType.Slack,
        workspaceUserId: "U123",
        messageBlocks: [],
      }),
    ).rejects.toThrow(getSampleProjectNotSentReason("Slack message"));

    expect(getProjectAuth).not.toHaveBeenCalled();
    expect(sendDirectMessageToUser).not.toHaveBeenCalled();
    expect(createWorkspaceLog).toHaveBeenCalledWith(
      expect.objectContaining({
        statusMessage: getSampleProjectNotSentReason("Slack message"),
      }),
      { isRoot: true },
    );
  });
});
