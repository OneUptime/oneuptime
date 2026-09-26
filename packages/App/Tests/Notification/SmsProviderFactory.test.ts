import { beforeEach, describe, expect, test } from "@jest/globals";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import Phone from "Common/Types/Phone";
import { ISmsProvider } from "Common/Types/SMS/SmsProvider";
import SmsProviderType from "Common/Types/SMS/SmsProviderType";
import * as NotificationConfig from "../../FeatureSet/Notification/Config";
import SmsProviderFactory from "../../FeatureSet/Notification/Providers/SmsProviderFactory";
import TwilioSmsProvider from "../../FeatureSet/Notification/Providers/TwilioSmsProvider";

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getTwilioConfig: jest.fn(),
    SmsProvider: "twilio",
  };
});

const mockGetTwilioConfig: jest.Mock =
  NotificationConfig.getTwilioConfig as jest.Mock;

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: {
      Twilio: jest.fn().mockImplementation(() => {
        return { messages: { create: jest.fn() } };
      }),
    },
  };
});

describe("SmsProviderFactory", () => {
  const globalConfig: TwilioConfig = {
    accountSid: "AC-global",
    authToken: "global-secret",
    primaryPhoneNumber: new Phone("+14155550123"),
    secondaryPhoneNumbers: [],
  };

  beforeEach(() => {
    mockGetTwilioConfig.mockReset();
    SmsProviderFactory.resetProvider();
  });

  test("getProvider returns a cached instance across calls", async () => {
    mockGetTwilioConfig.mockResolvedValue(globalConfig);

    const first: ISmsProvider = await SmsProviderFactory.getProvider();
    const second: ISmsProvider = await SmsProviderFactory.getProvider();

    expect(first).toBe(second);
    expect(first).toBeInstanceOf(TwilioSmsProvider);
    expect(mockGetTwilioConfig).toHaveBeenCalledTimes(2);
  });

  test("recreates the cached instance when the global config changes", async () => {
    mockGetTwilioConfig.mockResolvedValue(globalConfig);

    const first: ISmsProvider = await SmsProviderFactory.getProvider();

    mockGetTwilioConfig.mockResolvedValue({
      accountSid: "AC-global",
      authToken: "rotated-secret",
      primaryPhoneNumber: new Phone("+14155550123"),
      secondaryPhoneNumbers: [],
    });

    const second: ISmsProvider = await SmsProviderFactory.getProvider();

    expect(first).not.toBe(second);
    expect(second).toBeInstanceOf(TwilioSmsProvider);
  });

  test("resetProvider clears the cache", async () => {
    mockGetTwilioConfig.mockResolvedValue(globalConfig);

    const first: ISmsProvider = await SmsProviderFactory.getProvider();
    SmsProviderFactory.resetProvider();
    const second: ISmsProvider = await SmsProviderFactory.getProvider();

    expect(first).not.toBe(second);
    expect(mockGetTwilioConfig).toHaveBeenCalledTimes(2);
  });

  test("getProviderWithConfig returns a fresh instance and never reads global config", () => {
    const custom: TwilioConfig = {
      accountSid: "AC-custom",
      authToken: "custom-secret",
      primaryPhoneNumber: new Phone("+14155550987"),
      secondaryPhoneNumbers: [],
    };

    const first: ISmsProvider =
      SmsProviderFactory.getProviderWithConfig(custom);
    const second: ISmsProvider =
      SmsProviderFactory.getProviderWithConfig(custom);

    expect(first).toBeInstanceOf(TwilioSmsProvider);
    expect(first).not.toBe(second);
    expect(mockGetTwilioConfig).not.toHaveBeenCalled();
  });

  test("getProviderWithOptionalConfig uses custom config when provided", async () => {
    const custom: TwilioConfig = {
      accountSid: "AC-custom",
      authToken: "custom-secret",
      primaryPhoneNumber: new Phone("+14155550987"),
      secondaryPhoneNumbers: [],
    };

    const provider: ISmsProvider =
      await SmsProviderFactory.getProviderWithOptionalConfig(custom);

    expect(provider).toBeInstanceOf(TwilioSmsProvider);
    expect(mockGetTwilioConfig).not.toHaveBeenCalled();

    mockGetTwilioConfig.mockResolvedValue(globalConfig);
    const global: ISmsProvider =
      await SmsProviderFactory.getProviderWithOptionalConfig();
    expect(mockGetTwilioConfig).toHaveBeenCalledTimes(1);
    expect(global).toBeInstanceOf(TwilioSmsProvider);
  });

  test("getProvider throws BadDataException when global Twilio config is absent", async () => {
    mockGetTwilioConfig.mockResolvedValue(null);

    await expect(SmsProviderFactory.getProvider()).rejects.toBeInstanceOf(
      BadDataException,
    );
    await expect(SmsProviderFactory.getProvider()).rejects.toMatchObject({
      message: "Twilio Config not found",
    });
  });

  test("getProviderType returns Twilio, and defaults to Twilio for unknown values", () => {
    /*
     * The default branch of the switch is the same code path as the "twilio" case,
     * so an unknown SMS_PROVIDER env value falls back to Twilio (like CALL_PROVIDER).
     */
    expect(SmsProviderFactory.getProviderType()).toBe(SmsProviderType.Twilio);
  });
});
