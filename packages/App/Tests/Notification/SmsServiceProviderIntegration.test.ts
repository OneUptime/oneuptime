import { beforeEach, describe, expect, test } from "@jest/globals";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsSendException from "Common/Types/SMS/SmsProvider";
import SmsStatus from "Common/Types/SmsStatus";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";

const mockSendSms: jest.Mock = jest.fn();
const mockGetProviderWithOptionalConfig: jest.Mock = jest.fn();

jest.mock("../../FeatureSet/Notification/Providers/SmsProviderFactory", () => {
  return {
    __esModule: true,
    default: {
      getProviderWithOptionalConfig: (...args: unknown[]) => {
        return mockGetProviderWithOptionalConfig(...args);
      },
    },
  };
});

const mockSmsLogCreate: jest.Mock = jest.fn();
const mockSmsLogUpdateColumnsByIdWithoutHooks: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/SmsLogService", () => {
  return {
    __esModule: true,
    default: {
      create: (...args: unknown[]) => {
        return mockSmsLogCreate(...args);
      },
      updateColumnsByIdWithoutHooks: (...args: unknown[]) => {
        return mockSmsLogUpdateColumnsByIdWithoutHooks(...args);
      },
    },
  };
});

const mockProjectFindOneById: jest.Mock = jest.fn();
const mockProjectUpdateOneById: jest.Mock = jest.fn();
const mockProjectSendEmailToProjectOwners: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: unknown[]) => {
        return mockProjectFindOneById(...args);
      },
      updateOneById: (...args: unknown[]) => {
        return mockProjectUpdateOneById(...args);
      },
      sendEmailToProjectOwners: (...args: unknown[]) => {
        return mockProjectSendEmailToProjectOwners(...args);
      },
    },
  };
});

const mockTimelineUpdateOneById: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      updateOneById: (...args: unknown[]) => {
        return mockTimelineUpdateOneById(...args);
      },
    },
  };
});

const mockRechargeIfBalanceIsLow: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/NotificationService", () => {
  return {
    __esModule: true,
    default: {
      rechargeIfBalanceIsLow: (...args: unknown[]) => {
        return mockRechargeIfBalanceIsLow(...args);
      },
    },
  };
});

describe("SmsService (provider integration)", () => {
  const projectId: ObjectID = ObjectID.generate();
  const smsLogId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    jest.clearAllMocks();

    mockRechargeIfBalanceIsLow.mockResolvedValue(100000);

    mockGetProviderWithOptionalConfig.mockResolvedValue({
      sendSms: mockSendSms,
    });

    mockSendSms.mockResolvedValue({
      providerMessageId: "SM123",
      providerStatus: "queued",
      fromNumber: new Phone("+14155550123"),
    });

    mockProjectFindOneById.mockResolvedValue({
      smsOrCallCurrentBalanceInUSDCents: 100000,
      enableSmsNotifications: true,
      lowCallAndSMSBalanceNotificationSentToOwners: false,
      name: "Test Project",
      notEnabledSmsOrCallNotificationSentToOwners: false,
    });

    mockSmsLogCreate.mockResolvedValue({
      id: smsLogId,
    });
  });

  test("sends through the provider and records the result on the SmsLog", async () => {
    await SmsService.sendSms(new Phone("+14155550987"), "Incident opened", {
      projectId,
    });

    expect(mockGetProviderWithOptionalConfig).toHaveBeenCalledWith(undefined);
    expect(mockSendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        to: new Phone("+14155550987"),
        message: "Incident opened",
      }),
    );

    // Initial row persisted before the send
    expect(mockSmsLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: SmsStatus.Sending }),
      }),
    );

    /*
     * Final state written back: "queued" maps to Sending, message id recorded,
     * and the from-number the provider picked is persisted
     */
    expect(mockSmsLogUpdateColumnsByIdWithoutHooks).toHaveBeenCalledWith({
      id: smsLogId,
      data: expect.objectContaining({
        status: SmsStatus.Sending,
        statusMessage: "Message ID: SM123",
        fromNumber: new Phone("+14155550123"),
      }),
    });
  });

  test("records errorCode from SmsSendException and updates the timeline as Error", async () => {
    mockSendSms.mockRejectedValue(
      new SmsSendException("Invalid phone number", "21211"),
    );

    const timelineId: ObjectID = ObjectID.generate();

    await expect(
      SmsService.sendSms(new Phone("+14155550987"), "boom", {
        projectId,
        userOnCallLogTimelineId: timelineId,
      }),
    ).rejects.toBeInstanceOf(SmsSendException);

    expect(mockSmsLogUpdateColumnsByIdWithoutHooks).toHaveBeenCalledWith({
      id: smsLogId,
      data: expect.objectContaining({
        status: SmsStatus.Error,
        statusMessage: "Invalid phone number",
        errorCode: "21211",
      }),
    });

    expect(mockTimelineUpdateOneById).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: UserNotificationStatus.Error,
        statusMessage: "Invalid phone number",
      }),
      id: timelineId,
      props: expect.objectContaining({ isRoot: true }),
    });
  });

  test("passes custom Twilio config to the factory", async () => {
    const customConfig: TwilioConfig = {
      accountSid: "AC-custom",
      authToken: "custom-secret",
      primaryPhoneNumber: new Phone("+14155550987"),
      secondaryPhoneNumbers: [],
    };

    await SmsService.sendSms(new Phone("+14155550987"), "hello", {
      projectId,
      customTwilioConfig: customConfig,
    });

    expect(mockGetProviderWithOptionalConfig).toHaveBeenCalledWith(
      customConfig,
    );
  });

  test('maps provider status "failed" to SmsStatus.Failed', async () => {
    mockSendSms.mockResolvedValue({
      providerMessageId: "SM456",
      providerStatus: "failed",
      fromNumber: new Phone("+14155550123"),
    });

    await SmsService.sendSms(new Phone("+14155550987"), "hello", {
      projectId,
    });

    expect(mockSmsLogUpdateColumnsByIdWithoutHooks).toHaveBeenCalledWith({
      id: smsLogId,
      data: expect.objectContaining({ status: SmsStatus.Failed }),
    });
  });

  test("records errorCode on Error rows for non-provider Exceptions", async () => {
    mockGetProviderWithOptionalConfig.mockRejectedValue(
      new BadDataException("Twilio Config not found"),
    );

    await expect(
      SmsService.sendSms(new Phone("+14155550987"), "hello", { projectId }),
    ).rejects.toBeInstanceOf(BadDataException);

    expect(mockSmsLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SmsStatus.Error,
          errorCode: expect.any(String),
        }),
      }),
    );
  });

  test("records errorCode from arbitrary errors carrying a code", async () => {
    mockGetProviderWithOptionalConfig.mockRejectedValue(
      Object.assign(new Error("DB connection failed"), { code: "23505" }),
    );

    await expect(
      SmsService.sendSms(new Phone("+14155550987"), "hello", { projectId }),
    ).rejects.toThrow("DB connection failed");

    expect(mockSmsLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SmsStatus.Error,
          errorCode: "23505",
        }),
      }),
    );
  });

  test('records errorCode "0" from arbitrary errors (falsy but real)', async () => {
    mockGetProviderWithOptionalConfig.mockRejectedValue(
      Object.assign(new Error("Weird error"), { code: 0 }),
    );

    await expect(
      SmsService.sendSms(new Phone("+14155550987"), "hello", { projectId }),
    ).rejects.toThrow("Weird error");

    expect(mockSmsLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SmsStatus.Error,
          errorCode: "0",
        }),
      }),
    );
  });

  test("logs an Error row when the provider cannot be constructed", async () => {
    mockGetProviderWithOptionalConfig.mockRejectedValue(
      new Error("Twilio Config not found"),
    );

    await expect(
      SmsService.sendSms(new Phone("+14155550987"), "hello", { projectId }),
    ).rejects.toThrow("Twilio Config not found");

    // Send failed before the row could be inserted, so a full create happened
    expect(mockSmsLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: SmsStatus.Error,
          statusMessage: "Twilio Config not found",
        }),
      }),
    );
  });
});
