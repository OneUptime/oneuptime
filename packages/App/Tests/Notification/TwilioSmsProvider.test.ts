import { beforeEach, describe, expect, test } from "@jest/globals";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import Phone from "Common/Types/Phone";
import SmsSendException, { SmsSendResult } from "Common/Types/SMS/SmsProvider";
import TwilioSmsProvider from "../../FeatureSet/Notification/Providers/TwilioSmsProvider";

const mockMessagesCreate: jest.Mock = jest.fn();
const mockTwilioConstructor: jest.Mock = jest.fn();

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: {
      Twilio: jest.fn().mockImplementation(() => {
        return {
          messages: { create: mockMessagesCreate },
        };
      }),
    },
  };
});

describe("TwilioSmsProvider", () => {
  const config: TwilioConfig = {
    accountSid: "AC123",
    authToken: "secret",
    primaryPhoneNumber: new Phone("+14155550123"),
    secondaryPhoneNumbers: [new Phone("+447700900123")],
  };

  beforeEach(() => {
    mockMessagesCreate.mockReset();
    mockTwilioConstructor.mockClear();
  });

  test("sends SMS with body, to, from and no statusCallback when absent", async () => {
    mockMessagesCreate.mockResolvedValue({
      sid: "SM123",
      status: "queued",
    });

    const provider: TwilioSmsProvider = new TwilioSmsProvider(config);
    const result: SmsSendResult = await provider.sendSms({
      to: new Phone("+14155550987"),
      message: "Hello",
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      body: "Hello",
      to: "+14155550987",
      from: "+14155550123",
    });
    expect(result).toEqual({
      providerMessageId: "SM123",
      providerStatus: "queued",
      fromNumber: new Phone("+14155550123"),
    });
  });

  test("includes statusCallback when provided", async () => {
    mockMessagesCreate.mockResolvedValue({ sid: "SM1", status: "sent" });

    const provider: TwilioSmsProvider = new TwilioSmsProvider(config);
    await provider.sendSms({
      to: new Phone("+14155550987"),
      message: "Hello",
      statusCallbackUrl: "https://example.com/callback",
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith({
      body: "Hello",
      to: "+14155550987",
      from: "+14155550123",
      statusCallback: "https://example.com/callback",
    });
  });

  test("picks the secondary from-number when its country matches the destination", async () => {
    mockMessagesCreate.mockResolvedValue({ sid: "SM2", status: "sent" });

    const provider: TwilioSmsProvider = new TwilioSmsProvider(config);
    const result: SmsSendResult = await provider.sendSms({
      to: new Phone("+447700909090"),
      message: "Hello",
    });

    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({ from: "+447700900123" }),
    );
    expect(result.fromNumber.toString()).toBe("+447700900123");
  });

  test("throws SmsSendException with message and errorCode on SDK error", async () => {
    mockMessagesCreate.mockRejectedValue(
      Object.assign(new Error("Invalid phone number"), { code: 21211 }),
    );

    const provider: TwilioSmsProvider = new TwilioSmsProvider(config);

    await expect(
      provider.sendSms({ to: new Phone("+14155550987"), message: "x" }),
    ).rejects.toBeInstanceOf(SmsSendException);

    await expect(
      provider.sendSms({ to: new Phone("+14155550987"), message: "x" }),
    ).rejects.toMatchObject({
      message: "Invalid phone number",
      errorCode: "21211",
    });
  });

  test("handles null error codes without crashing", async () => {
    mockMessagesCreate.mockRejectedValue(
      Object.assign(new Error("Weird error"), { code: null }),
    );

    const provider: TwilioSmsProvider = new TwilioSmsProvider(config);
    let caught: SmsSendException | null = null;

    try {
      await provider.sendSms({ to: new Phone("+14155550987"), message: "x" });
    } catch (e) {
      caught = e as SmsSendException;
    }

    expect(caught).toBeInstanceOf(SmsSendException);
    expect(caught!.message).toBe("Weird error");
    expect(caught!.errorCode).toBeUndefined();
  });

  test("handles non-Error throws", async () => {
    mockMessagesCreate.mockRejectedValue("plain string failure");

    const provider: TwilioSmsProvider = new TwilioSmsProvider(config);
    let caught: SmsSendException | null = null;

    try {
      await provider.sendSms({ to: new Phone("+14155550987"), message: "x" });
    } catch (e) {
      caught = e as SmsSendException;
    }

    expect(caught).toBeInstanceOf(SmsSendException);
    expect(caught!.message).toBe("plain string failure");
    expect(caught!.errorCode).toBeUndefined();
  });

  test("records errorCode 0 from SDK errors (falsy but real)", async () => {
    mockMessagesCreate.mockRejectedValue(
      Object.assign(new Error("Weird error"), { code: 0 }),
    );

    const provider: TwilioSmsProvider = new TwilioSmsProvider(config);

    await expect(
      provider.sendSms({ to: new Phone("+14155550987"), message: "x" }),
    ).rejects.toMatchObject({ errorCode: "0" });
  });
});
