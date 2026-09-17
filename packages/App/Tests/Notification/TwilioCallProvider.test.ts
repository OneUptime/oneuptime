import logger from "Common/Server/Utils/Logger";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import type { AvailablePhoneNumber } from "Common/Types/Call/CallProvider";
import Phone from "Common/Types/Phone";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import Twilio, { validateRequest } from "twilio";
import TwilioCallProvider from "../../FeatureSet/Notification/Providers/TwilioCallProvider";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: {
      Twilio: jest.fn(),
      twiml: {
        VoiceResponse: jest.fn(),
      },
    },
    validateRequest: jest.fn(),
  };
});

const CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

interface VoiceResponseMocks {
  say: UnknownMock;
  dial: UnknownMock;
  number: UnknownMock;
  hangup: UnknownMock;
  toString: Mock<() => string>;
}

type UnknownMock = Mock<(...args: Array<unknown>) => unknown>;
type AsyncUnknownMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

const localList: AsyncUnknownMock = jest.fn();
const availablePhoneNumbers: Mock<
  (countryCode: string) => { local: { list: AsyncUnknownMock } }
> = jest.fn(() => {
  return { local: { list: localList } };
});
const incomingPhoneNumberList: AsyncUnknownMock = jest.fn();
const incomingPhoneNumberCreate: AsyncUnknownMock = jest.fn();
const incomingPhoneNumberUpdate: AsyncUnknownMock = jest.fn();
const incomingPhoneNumberRemove: AsyncUnknownMock = jest.fn();
const incomingPhoneNumbers: Mock<
  (phoneNumberId: string) => {
    update: AsyncUnknownMock;
    remove: AsyncUnknownMock;
  }
> & {
  list: AsyncUnknownMock;
  create: AsyncUnknownMock;
} = Object.assign(
  jest.fn(() => {
    return {
      update: incomingPhoneNumberUpdate,
      remove: incomingPhoneNumberRemove,
    };
  }),
  {
    list: incomingPhoneNumberList,
    create: incomingPhoneNumberCreate,
  },
);

const client: {
  availablePhoneNumbers: typeof availablePhoneNumbers;
  incomingPhoneNumbers: typeof incomingPhoneNumbers;
} = {
  availablePhoneNumbers,
  incomingPhoneNumbers,
};

const twilioConstructor: UnknownMock = Twilio.Twilio as unknown as UnknownMock;
const voiceResponseConstructor: UnknownMock = Twilio.twiml
  .VoiceResponse as unknown as UnknownMock;
const validate: Mock<(...args: Array<unknown>) => boolean> =
  validateRequest as unknown as Mock<(...args: Array<unknown>) => boolean>;
let voiceResponses: Array<VoiceResponseMocks> = [];

function newProvider(): TwilioCallProvider {
  return new TwilioCallProvider(CONFIG);
}

function makeWebhookRequest(data?: {
  body?: Record<string, unknown> | undefined;
  originalUrl?: string | undefined;
  protocol?: string | undefined;
  headers?: Record<string, string> | undefined;
}): any {
  const headers: Record<string, string> = data?.headers || {};
  return {
    body: data?.body || {},
    headers,
    originalUrl: data?.originalUrl || "/api/notification/incoming-call/voice",
    url: data?.originalUrl || "/api/notification/incoming-call/voice",
    protocol: data?.protocol || "http",
    get: jest.fn((name: string): string | undefined => {
      return headers[name] || headers[name.toLowerCase()];
    }),
  };
}

describe("TwilioCallProvider phone number management", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    twilioConstructor.mockImplementation(() => {
      return client;
    });
    availablePhoneNumbers.mockImplementation(() => {
      return { local: { list: localList } };
    });
    incomingPhoneNumbers.mockImplementation(() => {
      return {
        update: incomingPhoneNumberUpdate,
        remove: incomingPhoneNumberRemove,
      };
    });
    localList.mockResolvedValue([]);
    incomingPhoneNumberList.mockResolvedValue([]);
    incomingPhoneNumberCreate.mockResolvedValue({
      sid: "PN-created",
      phoneNumber: "+14155550101",
    });
    incomingPhoneNumberUpdate.mockResolvedValue({
      sid: "PN-existing",
      phoneNumber: "+14155550102",
    });
    incomingPhoneNumberRemove.mockResolvedValue(undefined);
  });

  test("builds the SDK client with the configured account credentials", () => {
    newProvider();

    expect(twilioConstructor).toHaveBeenCalledWith("AC-account", "auth-token");
  });

  test("searches voice-enabled local numbers with a bounded default and maps optional metadata", async () => {
    localList.mockResolvedValue([
      {
        phoneNumber: "+14155550101",
        friendlyName: "San Francisco",
        locality: "San Francisco",
        region: "CA",
      },
      {
        phoneNumber: "+14155550102",
        friendlyName: "California",
      },
    ]);

    const result: Array<AvailablePhoneNumber> =
      await newProvider().searchAvailableNumbers({
        countryCode: "US",
        areaCode: "415",
        contains: "010",
      });

    expect(availablePhoneNumbers).toHaveBeenCalledWith("US");
    expect(localList).toHaveBeenCalledWith({
      voiceEnabled: true,
      limit: 10,
      areaCode: 415,
      contains: "010",
    });
    expect(result).toEqual([
      {
        phoneNumber: "+14155550101",
        friendlyName: "San Francisco",
        locality: "San Francisco",
        region: "CA",
        country: "US",
      },
      {
        phoneNumber: "+14155550102",
        friendlyName: "California",
        country: "US",
      },
    ]);
  });

  test("honors an explicit search limit without inventing optional filters", async () => {
    await newProvider().searchAvailableNumbers({
      countryCode: "GB",
      limit: 4,
    });

    expect(localList).toHaveBeenCalledWith({
      voiceEnabled: true,
      limit: 4,
    });
  });

  test("lists owned numbers with stable provider ids and webhook URLs", async () => {
    incomingPhoneNumberList.mockResolvedValue([
      {
        sid: "PN-one",
        phoneNumber: "+14155550101",
        friendlyName: "One",
        voiceUrl: "https://example/voice",
      },
      {
        sid: "PN-two",
        phoneNumber: "+14155550102",
        friendlyName: "Two",
      },
    ]);

    await expect(newProvider().listOwnedNumbers()).resolves.toEqual([
      {
        phoneNumberId: "PN-one",
        phoneNumber: "+14155550101",
        friendlyName: "One",
        voiceUrl: "https://example/voice",
      },
      {
        phoneNumberId: "PN-two",
        phoneNumber: "+14155550102",
        friendlyName: "Two",
        voiceUrl: undefined,
      },
    ]);
    expect(incomingPhoneNumberList).toHaveBeenCalledWith({ limit: 100 });
  });

  test("purchases a number with a POST voice webhook and returns provider truth", async () => {
    incomingPhoneNumberCreate.mockResolvedValue({
      sid: "PN-provider-created",
      phoneNumber: "+442071838750",
    });

    await expect(
      newProvider().purchaseNumber(
        "+442071838700",
        "https://oneuptime.example/voice",
      ),
    ).resolves.toEqual({
      phoneNumberId: "PN-provider-created",
      phoneNumber: "+442071838750",
    });
    expect(incomingPhoneNumberCreate).toHaveBeenCalledWith({
      phoneNumber: "+442071838700",
      voiceUrl: "https://oneuptime.example/voice",
      voiceMethod: "POST",
    });
  });

  test("assigns an existing number by provider id with a POST voice webhook", async () => {
    await expect(
      newProvider().assignExistingNumber(
        "PN-existing",
        "https://oneuptime.example/voice",
      ),
    ).resolves.toEqual({
      phoneNumberId: "PN-existing",
      phoneNumber: "+14155550102",
    });

    expect(incomingPhoneNumbers).toHaveBeenCalledWith("PN-existing");
    expect(incomingPhoneNumberUpdate).toHaveBeenCalledWith({
      voiceUrl: "https://oneuptime.example/voice",
      voiceMethod: "POST",
    });
  });

  test("updates an existing webhook with POST semantics", async () => {
    await newProvider().updateWebhookUrl(
      "PN-existing",
      "https://oneuptime.example/new-voice",
    );

    expect(incomingPhoneNumberUpdate).toHaveBeenCalledWith({
      voiceUrl: "https://oneuptime.example/new-voice",
      voiceMethod: "POST",
    });
  });

  test("release is idempotent for Twilio's HTTP and API-code not-found forms", async () => {
    incomingPhoneNumberRemove
      .mockRejectedValueOnce({ status: 404 })
      .mockRejectedValueOnce({ code: 20404 });

    await expect(
      newProvider().releaseNumber("PN-already-gone-http"),
    ).resolves.toBeUndefined();
    await expect(
      newProvider().releaseNumber("PN-already-gone-code"),
    ).resolves.toBeUndefined();

    expect(incomingPhoneNumberRemove).toHaveBeenCalledTimes(2);
  });

  test("release rethrows a real provider failure", async () => {
    const failure: Error = new Error("Twilio unavailable");
    incomingPhoneNumberRemove.mockRejectedValueOnce(failure);

    await expect(newProvider().releaseNumber("PN-live")).rejects.toBe(failure);
  });
});

describe("TwilioCallProvider webhook parsing and validation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    twilioConstructor.mockImplementation(() => {
      return client;
    });
    validate.mockReturnValue(true);
  });

  test("parses every incoming call identity field", () => {
    expect(
      newProvider().parseIncomingCallWebhook(
        makeWebhookRequest({
          body: {
            CallSid: "CA-one",
            From: "+14155550999",
            To: "+14155550102",
          },
        }),
      ),
    ).toEqual({
      callId: "CA-one",
      callerPhoneNumber: "+14155550999",
      calledPhoneNumber: "+14155550102",
    });
  });

  test.each([
    [{ From: "+14155550999", To: "+14155550102" }, "CallSid not found"],
    [{ CallSid: "CA-one", To: "+14155550102" }, "From not found"],
    [{ CallSid: "CA-one", From: "+14155550999" }, "To not found"],
  ])(
    "rejects incomplete incoming payload %#",
    (body: Record<string, string>, message: string): void => {
      expect(() => {
        newProvider().parseIncomingCallWebhook(makeWebhookRequest({ body }));
      }).toThrow(message as string);
    },
  );

  test.each([
    ["completed", "completed"],
    ["busy", "busy"],
    ["no-answer", "no-answer"],
    ["failed", "failed"],
    ["canceled", "canceled"],
    ["provider-new-status", "failed"],
    [undefined, "failed"],
  ])(
    "maps dial status %s to %s",
    (input: string | undefined, expected: string): void => {
      expect(
        newProvider().parseDialStatusWebhook(
          makeWebhookRequest({
            body: {
              CallSid: "CA-one",
              DialCallStatus: input,
              DialCallDuration: "42",
            },
          }),
        ),
      ).toEqual({
        callId: "CA-one",
        dialStatus: expected,
        dialDurationSeconds: 42,
      });
    },
  );

  test("defaults a missing duration to zero and requires CallSid", () => {
    expect(
      newProvider().parseDialStatusWebhook(
        makeWebhookRequest({ body: { CallSid: "CA-one" } }),
      ),
    ).toEqual({
      callId: "CA-one",
      dialStatus: "failed",
      dialDurationSeconds: 0,
    });
    expect(() => {
      newProvider().parseDialStatusWebhook(makeWebhookRequest());
    }).toThrow("CallSid not found");
  });

  test("validates against the public forwarded URL and removes only the internal /api prefix", () => {
    const request: any = makeWebhookRequest({
      body: {
        CallSid: "CA-one",
        Attempt: 2,
        Answered: false,
      },
      originalUrl:
        "/api/notification/incoming-call/dial-status/log/item?attempt=2",
      protocol: "http",
      headers: {
        "x-forwarded-proto": "https",
        "x-forwarded-host": "calls.oneuptime.example",
        host: "internal-notification:3000",
      },
    });

    expect(
      newProvider().validateWebhookSignature(request, "twilio-signature"),
    ).toBe(true);
    expect(validate).toHaveBeenCalledWith(
      "auth-token",
      "twilio-signature",
      "https://calls.oneuptime.example/notification/incoming-call/dial-status/log/item?attempt=2",
      {
        CallSid: "CA-one",
        Attempt: "2",
        Answered: "false",
      },
    );
  });

  test("falls back to the request protocol and Host header", () => {
    const request: any = makeWebhookRequest({
      body: { CallSid: "CA-one" },
      originalUrl: "/notification/incoming-call/voice",
      protocol: "http",
      headers: { host: "localhost:3000" },
    });

    newProvider().validateWebhookSignature(request, "signature");

    expect(validate).toHaveBeenCalledWith(
      "auth-token",
      "signature",
      "http://localhost:3000/notification/incoming-call/voice",
      { CallSid: "CA-one" },
    );
  });

  test("returns false and logs URL diagnostics when signature validation fails", () => {
    validate.mockReturnValue(false);

    expect(
      newProvider().validateWebhookSignature(
        makeWebhookRequest({
          body: { CallSid: "CA-one" },
          headers: { host: "localhost" },
        }),
        "bad-signature",
      ),
    ).toBe(false);
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("URL used for validation"),
      { service: "notification" },
    );
  });
});

describe("TwilioCallProvider voice response generation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    twilioConstructor.mockImplementation(() => {
      return client;
    });
    voiceResponses = [];
    voiceResponseConstructor.mockImplementation(() => {
      const response: VoiceResponseMocks = {
        say: jest.fn(),
        dial: jest.fn(),
        number: jest.fn(),
        hangup: jest.fn(),
        toString: jest.fn((): string => {
          return "<Response/>";
        }),
      };
      response.dial.mockReturnValue({ number: response.number });
      voiceResponses.push(response);
      return response;
    });
  });

  test("generates a greeting with the stable Alice voice", () => {
    expect(newProvider().generateGreetingResponse("Welcome")).toBe(
      "<Response/>",
    );
    expect(voiceResponses[0]?.say).toHaveBeenCalledWith(
      { voice: "alice" },
      "Welcome",
    );
  });

  test("generates a dial response with caller id, timeout, callback and POST", () => {
    newProvider().generateDialResponse({
      toPhoneNumber: "+14155551001",
      fromPhoneNumber: "+14155550102",
      timeoutSeconds: 25,
      statusCallbackUrl: "https://oneuptime.example/dial-status",
    });

    expect(voiceResponses[0]?.dial).toHaveBeenCalledWith({
      action: "https://oneuptime.example/dial-status",
      method: "POST",
      timeout: 25,
      callerId: "+14155550102",
    });
    expect(voiceResponses[0]?.number).toHaveBeenCalledWith("+14155551001");
  });

  test("generates escalation speech before dialing with the exact called number", () => {
    newProvider().generateEscalationResponse("Trying the next engineer", {
      toPhoneNumber: "+14155551002",
      fromPhoneNumber: "+14155550103",
      timeoutSeconds: 30,
      statusCallbackUrl: "https://oneuptime.example/dial-status/next",
    });

    expect(voiceResponses[0]?.say).toHaveBeenCalledWith(
      { voice: "alice" },
      "Trying the next engineer",
    );
    expect(voiceResponses[0]?.dial).toHaveBeenCalledWith(
      expect.objectContaining({ callerId: "+14155550103", method: "POST" }),
    );
    expect(voiceResponses[0]?.say.mock.invocationCallOrder[0]).toBeLessThan(
      voiceResponses[0]?.dial.mock.invocationCallOrder[0] || 0,
    );
  });

  test("hangup optionally speaks a message and always hangs up", () => {
    newProvider().generateHangupResponse("Goodbye");
    newProvider().generateHangupResponse();

    expect(voiceResponses[0]?.say).toHaveBeenCalledWith(
      { voice: "alice" },
      "Goodbye",
    );
    expect(voiceResponses[0]?.hangup).toHaveBeenCalledTimes(1);
    expect(voiceResponses[1]?.say).not.toHaveBeenCalled();
    expect(voiceResponses[1]?.hangup).toHaveBeenCalledTimes(1);
  });
});
