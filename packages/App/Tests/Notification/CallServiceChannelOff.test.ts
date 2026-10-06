import CallService from "../../FeatureSet/Notification/Services/CallService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import CallLogService from "Common/Server/Services/CallLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import CallRequest from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "Common/Utils/Project/NotificationChannels";
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
 * A CALL THE PROJECT HAS SWITCHED OFF.
 *
 * Phone calls start off on a new project, and only a project owner or
 * someone with Manage Billing may turn them on. A call made while they are
 * off is not placed: the call log - read by anyone who may read the
 * project's call logs - says calls are off and exactly who can turn them on,
 * and the owners, who may, are emailed once, with a link straight to the
 * switch. Both used to say "Please enable call notifications in Project
 * Settings" to whoever read them.
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
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
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
    IsBillingEnabled: false,
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
    getTwilioConfig: jest.fn(),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000000001",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550142");

const SETTINGS_LINK: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID.toString()}/settings/notification-settings`;

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

let createCall: AsyncMock;
let project: Project;

function call(): CallRequest {
  return {
    to: TO,
    data: [{ sayMessage: "Incident Checkout down on Site 03." }],
  } as unknown as CallRequest;
}

function loggedCalls(): Array<CallLog> {
  return (CallLogService.create as unknown as jest.Mock).mock.calls.map(
    (args: Array<unknown>): CallLog => {
      return (args[0] as { data: CallLog }).data;
    },
  );
}

function ownerEmails(): Array<Array<unknown>> {
  return (ProjectService.sendEmailToProjectOwners as unknown as jest.Mock).mock
    .calls as Array<Array<unknown>>;
}

describe("a call while phone calls are off in the project", () => {
  beforeEach(() => {
    createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

    (Twilio as unknown as jest.Mock).mockImplementation(() => {
      return { calls: { create: createCall } };
    });

    project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Acme";
    project.enableCallNotifications = false;
    project.smsOrCallCurrentBalanceInUSDCents = 10000;
    project.notEnabledSmsOrCallNotificationSentToOwners = false;

    jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
      return Promise.resolve(project);
    }) as never);
    jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);
    jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockResolvedValue(undefined as never);
    jest.spyOn(CallLogService, "create").mockImplementation(((data: {
      data: CallLog;
    }) => {
      return Promise.resolve(data.data);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is not placed, and the call log says calls are off and exactly who can turn them on", async () => {
    await CallService.makeCall(call(), {
      projectId: PROJECT_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    expect(createCall).not.toHaveBeenCalled();
    expect(loggedCalls()).toHaveLength(1);
    expect(loggedCalls()[0]!.status).toBe(CallStatus.Error);
    expect(loggedCalls()[0]!.statusMessage).toBe(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.Call),
    );
    expect(loggedCalls()[0]!.statusMessage).toBe(
      "Phone calls are off in this project. A project owner or someone with Manage Billing can turn them on in Project Settings > Notification Settings.",
    );
  });

  test("the owners - who may turn calls on - are told to, if they should be on, with a link straight to the switch", async () => {
    await CallService.makeCall(call(), {
      projectId: PROJECT_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    expect(ownerEmails()).toHaveLength(1);

    const [projectId, subject, body] = ownerEmails()[0]! as [
      ObjectID,
      string,
      string,
    ];

    expect(projectId).toEqual(PROJECT_ID);
    expect(subject).toBe("Call notifications not enabled for Acme");
    expect(body).toContain(
      "This call was not made. Phone calls are off in this project. If they should be on, turn them on in Project Settings &gt; Notification Settings.",
    );
    expect(body).toContain(`<a href="${SETTINGS_LINK}">${SETTINGS_LINK}</a>`);
    expect(body).not.toContain("Please enable");

    // Told once: the flag that stops a second email is set.
    expect(ProjectService.updateOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { notEnabledSmsOrCallNotificationSentToOwners: true },
      }),
    );
  });

  test("the owners are not emailed a second time", async () => {
    project.notEnabledSmsOrCallNotificationSentToOwners = true;

    await CallService.makeCall(call(), {
      projectId: PROJECT_ID,
      customTwilioConfig: TWILIO_CONFIG,
    });

    expect(ownerEmails()).toHaveLength(0);
    expect(loggedCalls()[0]!.statusMessage).toBe(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.Call),
    );
  });
});
