jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
    EXTERNAL_FAULT: {},
  };
});

// Whether this server has VAPID keys, for a test push to a browser (#7028).
const mockVapid: {
  publicKey: string | undefined;
  privateKey: string | undefined;
} = { publicKey: undefined, privateKey: undefined };

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "VapidPublicKey", {
    get: (): string | undefined => {
      return mockVapid.publicKey;
    },
  });
  Object.defineProperty(mocked, "VapidPrivateKey", {
    get: (): string | undefined => {
      return mockVapid.privateKey;
    },
  });

  return mocked;
});

/*
 * Master admins are named by the request's x-test-master-admin header: the
 * session is the middleware's business, tested on its own.
 */
jest.mock("Common/Server/Middleware/MasterAdminAuthorization", () => {
  const NotAuthorizedExceptionType: new (message: string) => Error = (
    jest.requireActual("Common/Types/Exception/NotAuthorizedException") as {
      default: new (message: string) => Error;
    }
  ).default;
  const ResponseType: {
    sendErrorResponse: (req: unknown, res: unknown, err: Error) => void;
  } = (
    jest.requireActual("Common/Server/Utils/Response") as {
      default: {
        sendErrorResponse: (req: unknown, res: unknown, err: Error) => void;
      };
    }
  ).default;

  const isMasterAdmin: (
    req: { headers: Record<string, unknown> },
    res: unknown,
    next: () => void,
  ) => void = (
    req: { headers: Record<string, unknown> },
    res: unknown,
    next: () => void,
  ): void => {
    if (req.headers["x-test-master-admin"] === "true") {
      next();
      return;
    }

    ResponseType.sendErrorResponse(
      req,
      res,
      new NotAuthorizedExceptionType(
        "Unauthorized: Only master admins can perform this action.",
      ),
    );
  };

  return {
    __esModule: true,
    default: {
      isAuthorizedMasterAdminMiddleware: isMasterAdmin,
      // Never used by a test send: a leaked key must not send on the server's account.
      isAuthorizedMasterAdminOrMasterApiKeyMiddleware: (): void => {
        throw new Error("A test send must not accept the master API key.");
      },
    },
  };
});

import ServerTestSendAPI, {
  readTestEmail,
  readTestPhone,
} from "../../FeatureSet/Notification/API/ServerTestSend";
import CallService from "../../FeatureSet/Notification/Services/CallService";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import ServerTestSendService, {
  SERVER_TEST_CALL_TEXT,
  SERVER_TEST_EMAIL_TIMEOUT_IN_MS,
  SERVER_TEST_PUSH_TEXT,
  SERVER_TEST_PUSH_TITLE,
  SERVER_TEST_SMS_TEXT,
} from "../../FeatureSet/Notification/Services/ServerTestSendService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import UserMiddleware, {
  RequestSession,
} from "Common/Server/Middleware/UserAuthorization";
import PushNotificationService from "Common/Server/Services/PushNotificationService";
import UserPushService from "Common/Server/Services/UserPushService";
import { PUSH_TURNED_OFF_PROBLEM } from "Common/Server/Utils/ServerSending/ServerChannelSetup";
import ServerSendingStatus from "Common/Server/Utils/ServerSending/ServerSendingStatus";
import UserPush from "Common/Models/DatabaseModels/UserPush";
import ObjectID from "Common/Types/ObjectID";
import PushDeviceType from "Common/Types/PushNotification/PushDeviceType";
import PushNotificationRequest from "Common/Types/PushNotification/PushNotificationRequest";
import { expressErrorHandler } from "Common/Server/Utils/StartServer";
import GlobalConfig, {
  EmailServerType,
} from "Common/Models/DatabaseModels/GlobalConfig";
import CallRequest from "Common/Types/Call/CallRequest";
import { CallAndSmsProvider } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import { TwilioConfigUse } from "Common/Types/CallAndSMS/TwilioConfigUse";
import { NO_AWS_CREDENTIALS_MESSAGE } from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import Email from "Common/Types/Email";
import AmazonSesAuthenticationType from "Common/Types/Email/AmazonSesAuthenticationType";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import Phone from "Common/Types/Phone";
import { ServerSendingChannel } from "Common/Types/ServerSending/ServerSendingStatus";
import {
  parseServerTestSendAnswer,
  SERVER_TEST_PUSH_REASONS,
  ServerTestSendAnswer,
  ServerTestSendResult,
} from "Common/Types/ServerSetup/ServerTestSend";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import {
  createExpressApp,
  ExpressApplication,
  ExpressJson,
} from "Common/Server/Utils/Express";
import http from "http";
import { AddressInfo } from "net";
import timers from "timers";

if (
  typeof (globalThis as unknown as { setImmediate?: unknown }).setImmediate !==
  "function"
) {
  (globalThis as unknown as { setImmediate: unknown }).setImmediate =
    timers.setImmediate;
}

/*
 * A MASTER ADMIN'S TEST SEND, THROUGH THE SERVER'S OWN SETTINGS (#6824).
 *
 * "Send test email", "Send test SMS" and "Make test call" go through the
 * same senders a real email, SMS or call does - with no project and no
 * settings of their own - so the test goes out through exactly what the
 * server sends with, and the senders write how it went where the setup
 * checklist and the banner read it (#6825). Each answers, in words:
 *
 *   - accepted, by what (smtp.example.com, Amazon SES, Twilio, a gateway);
 *   - refused, with what the provider said;
 *   - not set up, with what is missing - and then nothing is tried.
 *
 * Over HTTP: master admins only, never the master API key, and only an
 * address or a number that is one; a refused test is an answer (200).
 */

const SMTP: Record<string, unknown> = {
  emailServerType: EmailServerType.CustomSMTP,
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpUsername: "ops@example.com",
  smtpPassword: "secret",
  smtpFromEmail: "ops@example.com",
  smtpFromName: "OneUptime",
};

const TWILIO: Record<string, unknown> = {
  twilioAccountSID: "AC123",
  twilioAuthToken: "secret",
  twilioPrimaryPhoneNumber: "+14155550100",
};

const GATEWAY: Record<string, unknown> = {
  callAndSmsProvider: CallAndSmsProvider.Gateway,
  callAndSmsGatewayUrl: "https://sms.example.com/send?token=secret",
  callAndSmsGatewaySecret: "secret",
};

let config: Record<string, unknown> | null = null;
let mailSend: ReturnType<typeof jest.spyOn>;
let smsSend: ReturnType<typeof jest.spyOn>;
let makeCall: ReturnType<typeof jest.spyOn>;

beforeEach(() => {
  config = null;
  jest
    .spyOn(ServerSendingStatus, "readConfig")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return config ? Object.assign(new GlobalConfig(), config) : null;
    });
  mailSend = jest.spyOn(MailService, "send").mockResolvedValue(undefined);
  smsSend = jest.spyOn(SmsService, "sendSms").mockResolvedValue(undefined);
  makeCall = jest.spyOn(CallService, "makeCall").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a test email", () => {
  test("goes out through the server's own settings - no project, no mail server of its own - as the SMTP test email", async () => {
    config = SMTP;

    const answer: ServerTestSendAnswer = await ServerTestSendService.sendEmail(
      new Email("ada@example.com"),
    );

    expect(answer).toEqual({
      channel: ServerSendingChannel.Email,
      result: ServerTestSendResult.Accepted,
      to: "ada@example.com",
      sentThrough: "smtp.example.com",
      message: null,
    });
    expect(mailSend).toHaveBeenCalledTimes(1);

    const [mail, options] = mailSend.mock.calls[0]! as [
      EmailMessage,
      Record<string, unknown>,
    ];

    expect(mail.toEmail.toString()).toBe("ada@example.com");
    expect(mail.templateType).toBe(EmailTemplateType.SMTPTest);
    // The server's own settings: what makes the sender write how it went.
    expect(options).toEqual({ timeout: SERVER_TEST_EMAIL_TIMEOUT_IN_MS });
    expect(options["projectId"]).toBeUndefined();
    expect(options["emailServer"]).toBeUndefined();
  });

  test("refused: what the mail server said", async () => {
    config = SMTP;
    mailSend.mockRejectedValue(
      new Error("Invalid login: 535 5.7.8 Username and Password not accepted"),
    );

    const answer: ServerTestSendAnswer = await ServerTestSendService.sendEmail(
      new Email("ada@example.com"),
    );

    expect(answer.result).toBe(ServerTestSendResult.Refused);
    expect(answer.message).toBe(
      "Invalid login: 535 5.7.8 Username and Password not accepted",
    );
    expect(answer.sentThrough).toBe("smtp.example.com");
  });

  test("not set up: what is missing, and nothing is tried", async () => {
    config = { ...SMTP, smtpPort: null };

    const answer: ServerTestSendAnswer = await ServerTestSendService.sendEmail(
      new Email("ada@example.com"),
    );

    expect(answer.result).toBe(ServerTestSendResult.NotSetUp);
    expect(answer.message).toBe(
      "SMTP: the Port is not set under Settings > Emails.",
    );
    // #9437: the same, in words the Admin Dashboard says in its reader's language.
    expect(answer.messageWords).toEqual({
      template:
        "{{provider}}: the {{field}} is not set under Settings > Emails.",
      values: { provider: "SMTP", field: "Port" },
    });
    expect(mailSend).not.toHaveBeenCalled();

    config = null;

    expect(
      (await ServerTestSendService.sendEmail(new Email("ada@example.com")))
        .result,
    ).toBe(ServerTestSendResult.NotSetUp);
    expect(mailSend).not.toHaveBeenCalled();
  });

  test("a provider by name", async () => {
    config = {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
      amazonSesSecretAccessKey: "secret",
      amazonSesRegion: "eu-west-1",
      amazonSesFromEmail: "ops@example.com",
    };

    expect(
      (await ServerTestSendService.sendEmail(new Email("ada@example.com")))
        .sentThrough,
    ).toBe("Amazon SES (eu-west-1)");
  });

  test("Amazon SES on this server's IAM role is tried with no key, and a refusal says what AWS said (#7000)", async () => {
    config = {
      emailServerType: EmailServerType.AmazonSES,
      amazonSesAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      amazonSesRegion: "eu-west-1",
      amazonSesFromEmail: "ops@example.com",
    };

    const accepted: ServerTestSendAnswer =
      await ServerTestSendService.sendEmail(new Email("ada@example.com"));

    expect(accepted.result).toBe(ServerTestSendResult.Accepted);
    expect(accepted.sentThrough).toBe("Amazon SES (eu-west-1)");
    expect(mailSend).toHaveBeenCalledTimes(1);

    // Whether the server has a role at all, only AWS knows: the test asks.
    const noRole: string = `Amazon SES could not sign in with this server's IAM role. ${NO_AWS_CREDENTIALS_MESSAGE}`;

    mailSend.mockRejectedValue(new Error(noRole));

    const refused: ServerTestSendAnswer = await ServerTestSendService.sendEmail(
      new Email("ada@example.com"),
    );

    expect(refused.result).toBe(ServerTestSendResult.Refused);
    expect(refused.message).toBe(noRole);
    expect(refused.sentThrough).toBe("Amazon SES (eu-west-1)");
  });

  test("a refusal with no words still says something, cut to what a page shows", async () => {
    config = SMTP;
    mailSend.mockRejectedValue(new Error(""));

    expect(
      (await ServerTestSendService.sendEmail(new Email("ada@example.com")))
        .message,
    ).toBe("No reason was given.");

    mailSend.mockRejectedValue(new Error("x".repeat(5000)));

    expect(
      (await ServerTestSendService.sendEmail(new Email("ada@example.com")))
        .message,
    ).toHaveLength(500);
  });
});

describe("a test SMS and a test call", () => {
  test("go out through the server's Twilio account, no project, and throw rather than return quietly when not sent", async () => {
    config = TWILIO;

    const sms: ServerTestSendAnswer = await ServerTestSendService.sendSms(
      new Phone("+14155550123"),
    );

    expect(sms).toEqual({
      channel: ServerSendingChannel.SMS,
      result: ServerTestSendResult.Accepted,
      to: "+14155550123",
      sentThrough: "Twilio",
      message: null,
    });

    const [to, text, options] = smsSend.mock.calls[0]! as [
      Phone,
      string,
      Record<string, unknown>,
    ];

    expect(to.toString()).toBe("+14155550123");
    expect(text).toBe(SERVER_TEST_SMS_TEXT);
    expect(options).toEqual({ failIfNotSent: true });

    const call: ServerTestSendAnswer = await ServerTestSendService.makeCall(
      new Phone("+14155550123"),
    );

    expect(call.result).toBe(ServerTestSendResult.Accepted);
    expect(call.channel).toBe(ServerSendingChannel.Call);

    const [request, callOptions] = makeCall.mock.calls[0]! as [
      CallRequest,
      Record<string, unknown>,
    ];

    expect(request.to.toString()).toBe("+14155550123");
    expect(JSON.stringify(request.data)).toContain(SERVER_TEST_CALL_TEXT);
    expect(callOptions).toEqual({ failIfNotSent: true });
  });

  test("through the server's gateway, named by its host - never its path or secret", async () => {
    config = GATEWAY;

    const sms: ServerTestSendAnswer = await ServerTestSendService.sendSms(
      new Phone("+14155550123"),
    );

    expect(sms.sentThrough).toBe("sms.example.com");
    expect(JSON.stringify(sms)).not.toContain("secret");
  });

  test("refused: what Twilio said", async () => {
    config = TWILIO;
    smsSend.mockRejectedValue(
      new Error("The 'To' number +14155550123 is not a valid phone number."),
    );
    makeCall.mockRejectedValue(new Error("Permission to call is not enabled."));

    const sms: ServerTestSendAnswer = await ServerTestSendService.sendSms(
      new Phone("+14155550123"),
    );
    const call: ServerTestSendAnswer = await ServerTestSendService.makeCall(
      new Phone("+14155550123"),
    );

    expect(sms).toMatchObject({
      result: ServerTestSendResult.Refused,
      message: "The 'To' number +14155550123 is not a valid phone number.",
    });
    expect(call).toMatchObject({
      result: ServerTestSendResult.Refused,
      message: "Permission to call is not enabled.",
    });
  });

  test("not set up: what is missing, and nothing is tried", async () => {
    const sms: ServerTestSendAnswer = await ServerTestSendService.sendSms(
      new Phone("+14155550123"),
    );
    const call: ServerTestSendAnswer = await ServerTestSendService.makeCall(
      new Phone("+14155550123"),
    );

    expect(sms.result).toBe(ServerTestSendResult.NotSetUp);
    expect(sms.message).toContain("SMS gateway");
    expect(call.result).toBe(ServerTestSendResult.NotSetUp);
    expect(call.message).toContain("call gateway");
    // #9437: in words the Admin Dashboard says in its reader's language.
    expect(sms.messageWords).toEqual({ template: sms.message, values: {} });
    expect(call.messageWords).toEqual({ template: call.message, values: {} });
    expect(smsSend).not.toHaveBeenCalled();
    expect(makeCall).not.toHaveBeenCalled();
  });

  test("an account used for SMS only has no calls: not set up, and no call is tried", async () => {
    config = {
      ...TWILIO,
      twilioPrimaryPhoneNumber: null,
      twilioSmsPhoneNumbers: "+14155550100",
      twilioUsedFor: TwilioConfigUse.SmsOnly,
    };

    const call: ServerTestSendAnswer = await ServerTestSendService.makeCall(
      new Phone("+14155550123"),
    );

    expect(call.result).toBe(ServerTestSendResult.NotSetUp);
    expect(makeCall).not.toHaveBeenCalled();
  });
});

describe("what a test reads of an address and a number", () => {
  test("an email address that is one, trimmed; anything else is refused", () => {
    expect(readTestEmail(" ada@example.com ").toString()).toBe(
      "ada@example.com",
    );

    for (const bad of [undefined, null, "", "  ", "nope", 3, "a@b@c.com"]) {
      expect(() => {
        return readTestEmail(bad);
      }).toThrow();
    }
  });

  test("a phone number that is one; anything else is refused, with what to type", () => {
    expect(readTestPhone("+14155550123").toString()).toBe("+14155550123");

    for (const bad of [undefined, "", "  ", 3]) {
      expect(() => {
        return readTestPhone(bad);
      }).toThrow("Enter the phone number to send the test to.");
    }

    expect(() => {
      return readTestPhone("not a number");
    }).toThrow("country code");
  });
});

interface HttpResult {
  status: number;
  body: JSONObject | null;
}

describe("over HTTP", () => {
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const app: ExpressApplication = createExpressApp();
    app.use(ExpressJson());
    app.use("/api/notification/server-test", ServerTestSendAPI);
    app.use(expressErrorHandler);
    server = http.createServer(app);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  function post(data: {
    path: string;
    body: JSONObject;
    isMasterAdmin: boolean;
  }): Promise<HttpResult> {
    return new Promise<HttpResult>(
      (resolve: (result: HttpResult) => void, reject: (e: Error) => void) => {
        const payload: string = JSON.stringify(data.body);
        const request: http.ClientRequest = http.request(
          {
            host: "127.0.0.1",
            port: port,
            path: `/api/notification/server-test${data.path}`,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "content-length": Buffer.byteLength(payload),
              ...(data.isMasterAdmin ? { "x-test-master-admin": "true" } : {}),
            },
          },
          (response: http.IncomingMessage) => {
            const chunks: Array<Buffer> = [];

            response.on("data", (chunk: Buffer) => {
              chunks.push(chunk);
            });
            response.on("end", () => {
              const raw: string = Buffer.concat(chunks).toString("utf8");
              let body: JSONObject | null = null;

              try {
                body = raw ? (JSON.parse(raw) as JSONObject) : null;
              } catch {
                body = null;
              }

              resolve({ status: response.statusCode || 0, body });
            });
          },
        );

        request.on("error", reject);
        request.write(payload);
        request.end();
      },
    );
  }

  test("a master admin's test email: 200, and the answer in words", async () => {
    config = SMTP;

    const result: HttpResult = await post({
      path: "/email",
      body: { toEmail: "ada@example.com" },
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);
    expect(parseServerTestSendAnswer(result.body)).toEqual({
      channel: ServerSendingChannel.Email,
      result: ServerTestSendResult.Accepted,
      to: "ada@example.com",
      sentThrough: "smtp.example.com",
      message: null,
    });
  });

  test("a refused test is an answer, 200, not an error", async () => {
    config = SMTP;
    mailSend.mockRejectedValue(new Error("421 Service not available"));

    const result: HttpResult = await post({
      path: "/email",
      body: { toEmail: "ada@example.com" },
      isMasterAdmin: true,
    });

    expect(result.status).toBe(200);
    expect(parseServerTestSendAnswer(result.body)?.message).toBe(
      "421 Service not available",
    );
  });

  test("SMS and calls take the number", async () => {
    config = TWILIO;

    for (const channel of ["sms", "call"]) {
      const result: HttpResult = await post({
        path: `/${channel}`,
        body: { toPhone: "+14155550123" },
        isMasterAdmin: true,
      });

      expect(result.status).toBe(200);
      expect(parseServerTestSendAnswer(result.body)?.channel).toBe(channel);
    }

    expect(smsSend).toHaveBeenCalledTimes(1);
    expect(makeCall).toHaveBeenCalledTimes(1);
  });

  test("an address or number that is not one is refused (400), and nothing is sent", async () => {
    config = { ...SMTP, ...TWILIO };

    const email: HttpResult = await post({
      path: "/email",
      body: { toEmail: "not an address" },
      isMasterAdmin: true,
    });
    const sms: HttpResult = await post({
      path: "/sms",
      body: {},
      isMasterAdmin: true,
    });

    expect(email.status).toBe(400);
    expect(sms.status).toBe(400);
    expect(mailSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
  });

  test("anybody but a master admin is refused, and nothing is sent", async () => {
    config = { ...SMTP, ...TWILIO };

    for (const [path, body] of [
      ["/email", { toEmail: "ada@example.com" }],
      ["/sms", { toPhone: "+14155550123" }],
      ["/call", { toPhone: "+14155550123" }],
    ] as Array<[string, JSONObject]>) {
      const result: HttpResult = await post({
        path: path,
        body: body,
        isMasterAdmin: false,
      });

      expect(result.status).toBeGreaterThanOrEqual(400);
    }

    expect(mailSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(makeCall).not.toHaveBeenCalled();
  });
});

/*
 * #7028: "Send test push" goes to the master admin who pressed it, on the
 * phones and browsers they registered - each once, whichever projects they
 * registered it in - through PushNotificationService, the way a page goes,
 * with no project. It says plainly when nothing can be sent: push turned off
 * for the server, nothing registered, or only browsers and no VAPID keys.
 */
describe("a test push", () => {
  const ADA: ObjectID = new ObjectID("a1a1a1a1-0000-4000-8000-000000000001");
  let devices: Array<Partial<UserPush>> = [];
  let findDevices: ReturnType<typeof jest.spyOn>;
  let sendPush: ReturnType<typeof jest.spyOn>;
  // The tokens a push service refuses, and what it says.
  let refusedTokens: Record<string, string> = {};

  const device: (
    token: string,
    deviceType: PushDeviceType,
    deviceName: string,
  ) => Partial<UserPush> = (
    token: string,
    deviceType: PushDeviceType,
    deviceName: string,
  ): Partial<UserPush> => {
    return { deviceToken: token, deviceType, deviceName };
  };

  const pushedTokens: () => Array<string> = (): Array<string> => {
    return sendPush.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as PushNotificationRequest).devices[0]!.token;
    });
  };

  beforeEach(() => {
    devices = [];
    refusedTokens = {};
    mockVapid.publicKey = undefined;
    mockVapid.privateKey = undefined;
    config = {};

    findDevices = jest
      .spyOn(UserPushService, "findBy")
      .mockImplementation(async (): Promise<Array<UserPush>> => {
        return devices.map((values: Partial<UserPush>): UserPush => {
          return Object.assign(new UserPush(), values);
        });
      });
    sendPush = jest
      .spyOn(PushNotificationService, "sendPushNotification")
      .mockImplementation(
        async (request: PushNotificationRequest): Promise<void> => {
          const refusal: string | undefined =
            refusedTokens[request.devices[0]!.token];

          if (refusal) {
            throw new Error(refusal);
          }
        },
      );
  });

  test("push turned off for the server: not set up, in the checklist's words, and nothing read or sent", async () => {
    config = { disablePushNotifications: true };
    devices = [device("ExponentPushToken[a]", PushDeviceType.iOS, "iPhone")];

    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    expect(answer).toEqual({
      channel: ServerSendingChannel.Push,
      result: ServerTestSendResult.NotSetUp,
      to: "",
      sentThrough: null,
      message: PUSH_TURNED_OFF_PROBLEM,
      // In words the Admin Dashboard says in its reader's language (#9437).
      messageWords: { template: PUSH_TURNED_OFF_PROBLEM, values: {} },
    });
    expect(PUSH_TURNED_OFF_PROBLEM).toBe(SERVER_TEST_PUSH_REASONS.turnedOff);
    expect(findDevices).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  test("nothing registered: says so, and nothing is sent", async () => {
    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    expect(answer.result).toBe(ServerTestSendResult.NotSetUp);
    expect(answer.message).toBe(SERVER_TEST_PUSH_REASONS.noDevices);
    expect(sendPush).not.toHaveBeenCalled();
  });

  test("only browsers, and no VAPID keys: says so, and nothing is sent", async () => {
    devices = [
      device(
        '{"endpoint":"https://fcm.googleapis.com/x"}',
        PushDeviceType.Web,
        "Chrome on macOS",
      ),
    ];

    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    expect(answer.result).toBe(ServerTestSendResult.NotSetUp);
    expect(answer.message).toBe(SERVER_TEST_PUSH_REASONS.noVapidKeys);
    expect(sendPush).not.toHaveBeenCalled();
  });

  test("the admin's own verified devices only, each once, read as OneUptime", async () => {
    devices = [
      device("ExponentPushToken[phone]", PushDeviceType.iOS, "iPhone"),
      // The same phone, registered in a second project.
      device("ExponentPushToken[phone]", PushDeviceType.iOS, "iPhone"),
      device("ExponentPushToken[tablet]", PushDeviceType.Android, ""),
    ];

    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    const query: Record<string, unknown> = (
      findDevices.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect((query["userId"] as ObjectID).toString()).toBe(ADA.toString());
    expect(query["isVerified"]).toBe(true);
    expect(query["projectId"]).toBeUndefined();
    expect((findDevices.mock.calls[0]![0] as { props: unknown }).props).toEqual(
      { isRoot: true },
    );

    expect(pushedTokens()).toEqual([
      "ExponentPushToken[phone]",
      "ExponentPushToken[tablet]",
    ]);
    expect(answer).toEqual({
      channel: ServerSendingChannel.Push,
      result: ServerTestSendResult.Accepted,
      to: "iPhone, Unknown Device",
      sentThrough: null,
      message: null,
    });
  });

  test("a device that accepts it: the test message, to that device, with no project, for that admin", async () => {
    mockVapid.publicKey = "public";
    mockVapid.privateKey = "private";
    devices = [
      device(
        '{"endpoint":"https://fcm.googleapis.com/x"}',
        PushDeviceType.Web,
        "Chrome on macOS",
      ),
    ];

    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    expect(answer.result).toBe(ServerTestSendResult.Accepted);
    expect(answer.to).toBe("Chrome on macOS");

    const [request, options] = sendPush.mock.calls[0] as [
      PushNotificationRequest,
      Record<string, unknown>,
    ];

    expect(request.deviceType).toBe(PushDeviceType.Web);
    expect(request.message.title).toBe(SERVER_TEST_PUSH_TITLE);
    expect(request.message.body).toBe(SERVER_TEST_PUSH_TEXT);
    expect(options["projectId"]).toBeUndefined();
    expect((options["userId"] as ObjectID).toString()).toBe(ADA.toString());
  });

  test("without VAPID keys a browser is left out, and the phone still gets it", async () => {
    devices = [
      device(
        '{"endpoint":"https://fcm.googleapis.com/x"}',
        PushDeviceType.Web,
        "Chrome on macOS",
      ),
      device("ExponentPushToken[phone]", PushDeviceType.iOS, "iPhone"),
    ];

    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    expect(pushedTokens()).toEqual(["ExponentPushToken[phone]"]);
    expect(answer.result).toBe(ServerTestSendResult.Accepted);
    expect(answer.to).toBe("iPhone");
  });

  test("one device refuses and one accepts: accepted, for the one that took it", async () => {
    devices = [
      device("ExponentPushToken[gone]", PushDeviceType.Android, "Old phone"),
      device("ExponentPushToken[phone]", PushDeviceType.iOS, "iPhone"),
    ];
    refusedTokens = {
      "ExponentPushToken[gone]":
        "Expo says this device is no longer registered for push notifications (DeviceNotRegistered).",
    };

    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    expect(answer.result).toBe(ServerTestSendResult.Accepted);
    expect(answer.to).toBe("iPhone");
  });

  test("every device refuses: refused, with what each push service said, once each", async () => {
    devices = [
      device("ExponentPushToken[a]", PushDeviceType.Android, "Phone A"),
      device("ExponentPushToken[b]", PushDeviceType.Android, "Phone B"),
      device("ExponentPushToken[c]", PushDeviceType.iOS, "Phone C"),
    ];
    refusedTokens = {
      "ExponentPushToken[a]": "The push relay could not be reached.",
      "ExponentPushToken[b]": "The push relay could not be reached.",
      "ExponentPushToken[c]": "Expo refused the credentials.",
    };

    const answer: ServerTestSendAnswer =
      await ServerTestSendService.sendPush(ADA);

    expect(answer).toEqual({
      channel: ServerSendingChannel.Push,
      result: ServerTestSendResult.Refused,
      to: "",
      sentThrough: null,
      message:
        "The push relay could not be reached.; Expo refused the credentials.",
    });
  });

  describe("over HTTP", () => {
    let server: http.Server;
    let port: number;

    beforeAll(async () => {
      const app: ExpressApplication = createExpressApp();
      app.use(ExpressJson());
      app.use("/api/notification/server-test", ServerTestSendAPI);
      app.use(expressErrorHandler);
      server = http.createServer(app);

      await new Promise<void>((resolve: () => void) => {
        server.listen(0, "127.0.0.1", resolve);
      });

      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve: () => void) => {
        server.close(() => {
          resolve();
        });
      });
    });

    const signedIn: (userId: ObjectID | null) => void = (
      userId: ObjectID | null,
    ): void => {
      jest.spyOn(UserMiddleware, "readRequestSession").mockResolvedValue(
        userId
          ? ({
              kind: "user",
              session: { userId: userId, isMasterAdmin: true },
            } as unknown as RequestSession)
          : ({ kind: "none" } as RequestSession),
      );
    };

    function postPush(data: {
      body: JSONObject;
      isMasterAdmin: boolean;
    }): Promise<{ status: number; body: JSONObject | null }> {
      return new Promise(
        (
          resolve: (result: {
            status: number;
            body: JSONObject | null;
          }) => void,
          reject: (e: Error) => void,
        ) => {
          const payload: string = JSON.stringify(data.body);
          const request: http.ClientRequest = http.request(
            {
              host: "127.0.0.1",
              port: port,
              path: "/api/notification/server-test/push",
              method: "POST",
              headers: {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
                ...(data.isMasterAdmin
                  ? { "x-test-master-admin": "true" }
                  : {}),
              },
            },
            (response: http.IncomingMessage) => {
              const chunks: Array<Buffer> = [];

              response.on("data", (chunk: Buffer) => {
                chunks.push(chunk);
              });
              response.on("end", () => {
                const raw: string = Buffer.concat(chunks).toString("utf8");

                resolve({
                  status: response.statusCode || 0,
                  body: raw ? (JSON.parse(raw) as JSONObject) : null,
                });
              });
            },
          );

          request.on("error", reject);
          request.write(payload);
          request.end();
        },
      );
    }

    test("a master admin's test push: 200, to their own devices - a body naming someone else changes nothing", async () => {
      signedIn(ADA);
      devices = [
        device("ExponentPushToken[phone]", PushDeviceType.iOS, "iPhone"),
      ];

      const result: { status: number; body: JSONObject | null } =
        await postPush({
          body: {
            userId: "b2b2b2b2-0000-4000-8000-000000000002",
            toPhone: "+14155550123",
          },
          isMasterAdmin: true,
        });

      expect(result.status).toBe(200);
      expect(parseServerTestSendAnswer(result.body)).toEqual({
        channel: ServerSendingChannel.Push,
        result: ServerTestSendResult.Accepted,
        to: "iPhone",
        sentThrough: null,
        message: null,
      });
      expect(
        (
          (findDevices.mock.calls[0]![0] as { query: Record<string, unknown> })
            .query["userId"] as ObjectID
        ).toString(),
      ).toBe(ADA.toString());
    });

    test("nothing registered is an answer, 200, saying so", async () => {
      signedIn(ADA);

      const result: { status: number; body: JSONObject | null } =
        await postPush({ body: {}, isMasterAdmin: true });

      expect(result.status).toBe(200);
      expect(parseServerTestSendAnswer(result.body)?.message).toBe(
        SERVER_TEST_PUSH_REASONS.noDevices,
      );
    });

    test("anybody but a master admin is refused, and nothing is read or sent", async () => {
      signedIn(ADA);
      devices = [
        device("ExponentPushToken[phone]", PushDeviceType.iOS, "iPhone"),
      ];

      const result: { status: number; body: JSONObject | null } =
        await postPush({ body: {}, isMasterAdmin: false });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(findDevices).not.toHaveBeenCalled();
      expect(sendPush).not.toHaveBeenCalled();
    });

    test("a master admin whose session cannot be read is refused, and nothing is sent", async () => {
      signedIn(null);
      devices = [
        device("ExponentPushToken[phone]", PushDeviceType.iOS, "iPhone"),
      ];

      const result: { status: number; body: JSONObject | null } =
        await postPush({ body: {}, isMasterAdmin: true });

      expect(result.status).toBeGreaterThanOrEqual(400);
      expect(sendPush).not.toHaveBeenCalled();
    });
  });
});
