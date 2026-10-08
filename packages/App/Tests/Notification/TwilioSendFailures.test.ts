import CallService from "../../FeatureSet/Notification/Services/CallService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import TwilioSendError, {
  TwilioSendKind,
} from "../../FeatureSet/Notification/Utils/TwilioSendError";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import CallLogService from "Common/Server/Services/CallLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import CallRequest from "Common/Types/Call/CallRequest";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import BadDataException from "Common/Types/Exception/BadDataException";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import ErrorClass, {
  declaredErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
import {
  getNoTwilioAccountMessage,
  TwilioMessageKind,
} from "Common/Utils/Project/TwilioAccount";
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
import RestException from "twilio/lib/base/RestException";

/*
 * WHAT THE NOTIFICATION SERVICE SAYS WHEN AN SMS OR A CALL DOES NOT GO.
 *
 * Two answers reached a person waiting for a verification code as nothing
 * they could act on:
 *
 *   - no Twilio account anywhere: "Twilio Config not found", in the log and
 *     in the answer;
 *   - Twilio refusing the message: the SDK throws a RestException, which the
 *     route's error handler turned into a bare 500 "Server Error" - though
 *     Twilio had said exactly what was wrong, and the log had it.
 *
 * Now the first says what is missing and who can add it, and the second
 * keeps Twilio's words and its error code. The verification code services
 * put these in front of the person (ChannelVerification.issueAndSendCode).
 */

/*
 * The client is faked; the TwiML builder is the real one, so a call's
 * script is written as it would be.
 */
jest.mock("twilio", () => {
  const actual: { twiml: unknown } = jest.requireActual("twilio") as {
    twiml: unknown;
  };
  const client: ((...args: Array<unknown>) => unknown) & {
    twiml?: unknown;
  } = jest.fn();
  client.twiml = actual.twiml;

  return {
    __esModule: true,
    default: client,
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

  return {
    __esModule: true,
    ...actual,
    IsBillingEnabled: false,
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

import { getTwilioConfig } from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(
  "d0000000-0000-4000-8000-000000000001",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+6590665484");

const REGION_REFUSAL: string =
  "Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +6590665484.";

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

const twilioRefusal: (data: {
  statusCode: number;
  code?: number;
  message?: string;
}) => RestException = (data: {
  statusCode: number;
  code?: number;
  message?: string;
}): RestException => {
  return new RestException({
    statusCode: data.statusCode,
    body: {
      code: data.code,
      message: data.message,
      more_info: data.code
        ? `https://www.twilio.com/docs/errors/${data.code}`
        : undefined,
    },
  });
};

async function rejectionOf(promise: Promise<void>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  throw new Error("Expected the send to be rejected, but it resolved.");
}

describe("TwilioSendError", () => {
  test("keeps Twilio's words and its error code", () => {
    const error: unknown = TwilioSendError.toSendError(
      twilioRefusal({ statusCode: 400, code: 21408, message: REGION_REFUSAL }),
      TwilioSendKind.SMS,
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "Twilio could not send this SMS: Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +6590665484 (Twilio error 21408).",
    );
  });

  test("says what could not be done, for a call", () => {
    const error: unknown = TwilioSendError.toSendError(
      twilioRefusal({
        statusCode: 400,
        code: 21215,
        message: "Account not authorized to call +6590665484.",
      }),
      TwilioSendKind.Call,
    );

    expect((error as Error).message).toBe(
      "Twilio could not place this call: Account not authorized to call +6590665484 (Twilio error 21215).",
    );
  });

  test("Twilio refusing the request is the account's setup: a user error, said so authoritatively", () => {
    const error: unknown = TwilioSendError.toSendError(
      twilioRefusal({ statusCode: 401, code: 20003, message: "Authenticate" }),
      TwilioSendKind.SMS,
    );

    expect(declaredErrorClass(error)).toEqual({
      errorClass: ErrorClass.UserError,
      authoritative: true,
    });
    expect((error as Error).message).toBe(
      "Twilio could not send this SMS: Authenticate (Twilio error 20003).",
    );
  });

  /*
   * An outage on Twilio's side is not something the person can act on, and
   * not their setup: it is left exactly as it was, classified and alerted on
   * as before, and the person is told to try again in a moment.
   */
  test("Twilio failing (a 5xx) is left untouched", () => {
    const outage: RestException = twilioRefusal({
      statusCode: 503,
      message: "Service Unavailable",
    });

    expect(TwilioSendError.toSendError(outage, TwilioSendKind.SMS)).toBe(
      outage,
    );
  });

  test("a refusal with no readable body still says something", () => {
    const error: unknown = TwilioSendError.toSendError(
      new RestException({ statusCode: 400, body: "<html>Bad request</html>" }),
      TwilioSendKind.SMS,
    );

    expect((error as Error).message).toBe(
      "Twilio could not send this SMS: [HTTP 400] Failed to execute request.",
    );
  });

  test("our own exceptions and anything else thrown pass through untouched", () => {
    const ours: BadDataException = new BadDataException("SMS is off.");
    const unexpected: Error = new Error("connection reset");

    expect(TwilioSendError.toSendError(ours, TwilioSendKind.SMS)).toBe(ours);
    expect(TwilioSendError.toSendError(unexpected, TwilioSendKind.SMS)).toBe(
      unexpected,
    );
    expect(TwilioSendError.toSendError("text", TwilioSendKind.SMS)).toBe(
      "text",
    );
  });
});

describe("the Notification service sending an SMS", () => {
  let createMessage: AsyncMock;
  let project: Project;

  function loggedRows(): Array<SmsLog> {
    return (SmsLogService.create as unknown as jest.Mock).mock.calls.map(
      (call: Array<unknown>): SmsLog => {
        return (call[0] as { data: SmsLog }).data;
      },
    );
  }

  function finalLogUpdate(): Record<string, unknown> {
    const calls: Array<Array<unknown>> = (
      SmsLogService.updateColumnsByIdWithoutHooks as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    return (calls[calls.length - 1]![0] as { data: Record<string, unknown> })
      .data;
  }

  beforeEach(() => {
    createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);

    (Twilio as unknown as jest.Mock).mockImplementation(() => {
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

    jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
      return Promise.resolve(project);
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

  test("with no Twilio account anywhere, says what is missing and who can add it - not 'Twilio Config not found'", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(null as never);

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, "Your verification code is 482915", {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS),
    );
    expect((error as Error).message).not.toContain("Twilio Config not found");
    expect(createMessage).not.toHaveBeenCalled();
  });

  test("and the SMS log - where an admin is sent to look - says the same", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(null as never);

    await rejectionOf(
      SmsService.sendSms(TO, "Your verification code is 482915", {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    );

    expect(loggedRows()).toHaveLength(1);
    expect(loggedRows()[0]!.status).toBe(SmsStatus.Error);
    expect(loggedRows()[0]!.statusMessage).toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS),
    );
  });

  test("Twilio's refusal comes back in Twilio's words, not as a bare server error", async () => {
    createMessage.mockRejectedValue(
      twilioRefusal({
        statusCode: 400,
        code: 21408,
        message: REGION_REFUSAL,
      }) as never,
    );

    const error: unknown = await rejectionOf(
      SmsService.sendSms(TO, "Your verification code is 482915", {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "Twilio could not send this SMS: Permission to send an SMS has not been enabled for the region indicated by the 'To' number: +6590665484 (Twilio error 21408).",
    );
  });

  test("while the log keeps Twilio's own message and error code", async () => {
    createMessage.mockRejectedValue(
      twilioRefusal({
        statusCode: 400,
        code: 21408,
        message: REGION_REFUSAL,
      }) as never,
    );

    await rejectionOf(
      SmsService.sendSms(TO, "Your verification code is 482915", {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    );

    expect(finalLogUpdate()["status"]).toBe(SmsStatus.Error);
    expect(finalLogUpdate()["statusMessage"]).toBe(REGION_REFUSAL);
    expect(finalLogUpdate()["errorCode"]).toBe("21408");
  });

  test("an SMS Twilio took goes out as before", async () => {
    await expect(
      SmsService.sendSms(TO, "Your verification code is 482915", {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    ).resolves.toBeUndefined();

    expect(createMessage).toHaveBeenCalledTimes(1);
  });
});

describe("the Notification service placing a call", () => {
  let createCall: AsyncMock;
  let project: Project;

  function loggedCalls(): Array<CallLog> {
    return (CallLogService.create as unknown as jest.Mock).mock.calls.map(
      (args: Array<unknown>): CallLog => {
        return (args[0] as { data: CallLog }).data;
      },
    );
  }

  const callRequest: () => CallRequest = (): CallRequest => {
    return {
      to: TO,
      data: [{ sayMessage: "Your verification code is 4 8 2 9 1 5" }],
    } as unknown as CallRequest;
  };

  beforeEach(() => {
    createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

    (Twilio as unknown as jest.Mock).mockImplementation(() => {
      return { calls: { create: createCall } };
    });

    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
      TWILIO_CONFIG as never,
    );

    project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Acme";
    project.enableCallNotifications = true;
    project.smsOrCallCurrentBalanceInUSDCents = 10000;

    jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
      return Promise.resolve(project);
    }) as never);
    jest.spyOn(CallLogService, "create").mockImplementation(((data: {
      data: CallLog;
    }) => {
      return Promise.resolve(data.data);
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("with no Twilio account anywhere, says what is missing and who can add it", async () => {
    (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(null as never);

    const error: unknown = await rejectionOf(
      CallService.makeCall(callRequest(), {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.Call),
    );
    expect(createCall).not.toHaveBeenCalled();
    expect(loggedCalls()[0]!.statusMessage).toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.Call),
    );
  });

  test("Twilio's refusal comes back in Twilio's words", async () => {
    createCall.mockRejectedValue(
      twilioRefusal({
        statusCode: 400,
        code: 21215,
        message: "Account not authorized to call +6590665484.",
      }) as never,
    );

    const error: unknown = await rejectionOf(
      CallService.makeCall(callRequest(), {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    );

    expect(error).toBeInstanceOf(BadDataException);
    expect((error as Error).message).toBe(
      "Twilio could not place this call: Account not authorized to call +6590665484 (Twilio error 21215).",
    );
    // The log keeps Twilio's own message.
    expect(loggedCalls()[0]!.statusMessage).toBe(
      "Account not authorized to call +6590665484.",
    );
  });

  test("a call Twilio took is placed as before", async () => {
    await expect(
      CallService.makeCall(callRequest(), {
        projectId: PROJECT_ID,
        isSensitive: true,
      }),
    ).resolves.toBeUndefined();

    expect(createCall).toHaveBeenCalledTimes(1);
  });
});
