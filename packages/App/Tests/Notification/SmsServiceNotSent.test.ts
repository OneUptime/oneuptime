import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import ErrorClass, {
  declaredErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
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
 * The Notification service does not send an SMS when the project has SMS
 * notifications turned off (the default), or has too little SMS balance. It
 * writes the SMS log and emails the owners, and used to return as if the SMS
 * had gone out. The status page subscriber jobs count every message sent or
 * failed from the answer they get, so every such SMS was counted as sent -
 * and for the incident-created notification, a page reached only by SMS was
 * recorded as told, so neither Retry nor adding pages reached it again once
 * SMS was turned on.
 *
 * A caller that counts what it delivered now asks, with failIfNotSent, for
 * such an SMS to fail. Everyone else keeps the quiet return.
 */

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: {
      Twilio: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    EXTERNAL_FAULT: {},
  };
});

/*
 * Billing on, so a send on the global Twilio account is charged and checked
 * against the project's balance; the global Twilio account is configured.
 */
jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    IsBillingEnabled: true,
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    // An SMS costs 10 cents on the global account.
    SMSDefaultCostInCents: 10,
    SMSHighRiskCostInCents: 10,
    getTwilioConfig: jest.fn(),
  };
});

import { getTwilioConfig } from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550123");
const MESSAGE: string = "Incident Checkout down (Critical) on Site 03.";

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

let createMessage: AsyncMock;
let project: Project | null;

function loggedRows(): Array<SmsLog> {
  return (SmsLogService.create as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>): SmsLog => {
      return (call[0] as { data: SmsLog }).data;
    },
  );
}

function send(options: {
  failIfNotSent?: boolean | undefined;
  onGlobalTwilioAccount?: boolean | undefined;
}): Promise<void> {
  return SmsService.sendSms(TO, MESSAGE, {
    projectId: PROJECT_ID,
    statusPageId: STATUS_PAGE_ID,
    ...(options.onGlobalTwilioAccount
      ? {}
      : { customTwilioConfig: TWILIO_CONFIG }),
    ...(options.failIfNotSent !== undefined
      ? { failIfNotSent: options.failIfNotSent }
      : {}),
  });
}

async function rejectionOf(promise: Promise<void>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  throw new Error("Expected the send to be rejected, but it resolved.");
}

describe("an SMS the Notification service does not send", () => {
  beforeEach(() => {
    createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createMessage.mockResolvedValue({
      status: "queued",
      sid: "SM-1",
    } as never);

    (Twilio.Twilio as unknown as jest.Mock).mockImplementation(() => {
      return { messages: { create: createMessage } };
    });

    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
      TWILIO_CONFIG as never,
    );

    project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Acme";
    project.enableSmsNotifications = true;
    project.smsOrCallCurrentBalanceInUSDCents = 10000;
    project.lowCallAndSMSBalanceNotificationSentToOwners = true;
    project.notEnabledSmsOrCallNotificationSentToOwners = true;

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
        return Promise.resolve(project?.smsOrCallCurrentBalanceInUSDCents);
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

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("with SMS notifications turned off for the project", () => {
    beforeEach(() => {
      project!.enableSmsNotifications = false;
    });

    test("returns quietly, as it always has, when the caller does not ask", async () => {
      await expect(send({})).resolves.toBeUndefined();

      expect(createMessage).not.toHaveBeenCalled();
      expect(loggedRows()).toHaveLength(1);
      expect(loggedRows()[0]!.status).toBe(SmsStatus.Error);
    });

    test("fails with the reason when the caller asks, after logging it once", async () => {
      const error: unknown = await rejectionOf(send({ failIfNotSent: true }));

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        "SMS not sent: SMS notifications are not enabled for this project. Please enable SMS notifications in Project Settings.",
      );
      // The tenant's setting, not a defect.
      expect(declaredErrorClass(error)).toEqual({
        errorClass: ErrorClass.UserError,
        authoritative: true,
      });

      expect(createMessage).not.toHaveBeenCalled();
      // One log row: failing does not write a second, generic one.
      expect(loggedRows()).toHaveLength(1);
      expect(loggedRows()[0]!.status).toBe(SmsStatus.Error);
      expect(
        SmsLogService.updateColumnsByIdWithoutHooks,
      ).not.toHaveBeenCalled();
    });

    test("still emails the owners the first time, when the caller asks it to fail", async () => {
      project!.notEnabledSmsOrCallNotificationSentToOwners = false;

      await rejectionOf(send({ failIfNotSent: true }));

      expect(ProjectService.sendEmailToProjectOwners).toHaveBeenCalledTimes(1);
    });

    test("failIfNotSent: false is the quiet return", async () => {
      await expect(send({ failIfNotSent: false })).resolves.toBeUndefined();
    });
  });

  describe("with too little SMS balance on the global Twilio account", () => {
    test("no balance at all fails when the caller asks", async () => {
      project!.smsOrCallCurrentBalanceInUSDCents = 0;

      const error: unknown = await rejectionOf(
        send({ failIfNotSent: true, onGlobalTwilioAccount: true }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expect((error as BadDataException).message).toBe(
        `SMS not sent: Project ${PROJECT_ID.toString()} does not have enough SMS balance.`,
      );
      expect(createMessage).not.toHaveBeenCalled();
      expect(loggedRows()).toHaveLength(1);
      expect(loggedRows()[0]!.status).toBe(SmsStatus.LowBalance);
    });

    test("a balance below the SMS's cost fails when the caller asks", async () => {
      project!.smsOrCallCurrentBalanceInUSDCents = 1;

      const error: unknown = await rejectionOf(
        send({ failIfNotSent: true, onGlobalTwilioAccount: true }),
      );

      expect((error as BadDataException).message).toMatch(
        /^SMS not sent: Project does not have enough balance to send SMS\./,
      );
      expect(createMessage).not.toHaveBeenCalled();
      expect(loggedRows()[0]!.status).toBe(SmsStatus.LowBalance);
    });

    test("returns quietly when the caller does not ask", async () => {
      project!.smsOrCallCurrentBalanceInUSDCents = 0;

      await expect(
        send({ onGlobalTwilioAccount: true }),
      ).resolves.toBeUndefined();
      expect(createMessage).not.toHaveBeenCalled();
    });
  });

  test("a project that no longer exists fails when the caller asks", async () => {
    project = null;

    const error: unknown = await rejectionOf(send({ failIfNotSent: true }));

    expect((error as BadDataException).message).toBe(
      `SMS not sent: Project ${PROJECT_ID.toString()} not found.`,
    );
    expect(createMessage).not.toHaveBeenCalled();
  });

  test("an SMS that is sent resolves, whether or not the caller asked", async () => {
    await expect(send({ failIfNotSent: true })).resolves.toBeUndefined();
    await expect(send({})).resolves.toBeUndefined();

    expect(createMessage).toHaveBeenCalledTimes(2);
  });

  test("an SMS Twilio refuses still fails as it did", async () => {
    createMessage.mockRejectedValue(new Error("Invalid 'To' number") as never);

    const error: unknown = await rejectionOf(send({ failIfNotSent: true }));

    expect((error as Error).message).toBe("Invalid 'To' number");
  });

  /*
   * The owners' email about an SMS the project could not afford places the
   * SMS text as HTML; the text is plain (incident titles, resource names,
   * custom field values), so markup in it is shown, not rendered.
   */
  test("the owners' low balance email shows markup in the SMS text as text", async () => {
    project!.smsOrCallCurrentBalanceInUSDCents = 0;
    project!.lowCallAndSMSBalanceNotificationSentToOwners = false;

    await SmsService.sendSms(
      TO,
      'Incident <a href="https://evil.example">Verify billing</a> on Site 03.',
      {
        projectId: PROJECT_ID,
        statusPageId: STATUS_PAGE_ID,
      },
    );

    expect(createMessage).not.toHaveBeenCalled();

    const body: string = (
      ProjectService.sendEmailToProjectOwners as unknown as jest.Mock
    ).mock.calls[0]![2] as string;

    expect(body).not.toContain("<a href");
    expect(body).toContain(
      "Incident &lt;a href=&quot;https://evil.example&quot;&gt;Verify billing&lt;/a&gt; on Site 03.",
    );
  });
});
