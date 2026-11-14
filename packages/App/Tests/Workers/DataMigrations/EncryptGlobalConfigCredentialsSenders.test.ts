import { mockRouter } from "Common/Tests/Server/API/Helpers";
import { EmailServerType } from "Common/Models/DatabaseModels/GlobalConfig";
import WhatsAppAuthorization from "Common/Server/Middleware/WhatsAppAuthorization";
import Encryption from "Common/Server/Utils/Encryption";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import CallRequest from "Common/Types/Call/CallRequest";
import { CallAndSmsProvider } from "Common/Types/CallAndSMS/CallAndSmsProvider";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import { JSONObject } from "Common/Types/JSON";
import Phone from "Common/Types/Phone";
import TelegramMessage from "Common/Types/Telegram/TelegramMessage";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import { WhatsAppTemplateIds } from "Common/Types/WhatsApp/WhatsAppTemplates";
import API from "Common/Utils/API";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SendgridMail from "@sendgrid/mail";
import type { Mock } from "jest-mock";
import crypto from "crypto";
import fs from "fs";
import Handlebars from "handlebars";
import nodemailer, { Transporter } from "nodemailer";
import Path from "path";
import Twilio from "twilio";
import { SqlRow } from "./Fixtures/GlobalConfigCredentialsSql";
import {
  CREDENTIALS_AS_WRITTEN,
  GATEWAY_URL,
  migrateServerSettings,
  ServerSettings,
  serverSettingsAsWritten,
  SMTP_CLIENT_ID,
  SMTP_HOST,
  SMTP_USERNAME,
  TWILIO_ACCOUNT_SID,
  useServerSettings,
  WHATSAPP_PHONE_NUMBER_ID,
} from "./Fixtures/ServerSettingsAsWritten";

/*
 * EACH OF THE SERVER'S SENDERS SENDS WITH THE CREDENTIALS AS WRITTEN, ONCE
 * THE DATA MIGRATION HAS ENCRYPTED THEM (#7739).
 *
 * The server's settings row is seeded as it was stored before its
 * credential columns were encrypted, behind the real GlobalConfigService.
 * Each sender runs as it is - SmsService, CallService, MailService,
 * WhatsAppService, TelegramService, the WhatsApp webhook's verification
 * and signature check - reading its settings through the real Notification
 * service getters, with only what is outside OneUptime stood in for:
 * Twilio's client, the gateway's and Meta's and Telegram's HTTP APIs, the
 * mail transports and the OAuth token endpoint.
 *
 * Each sends once with the row as written, then the real
 * EncryptGlobalConfigCredentials runs, and it sends again: with the same
 * credentials, which are the ones written - never the ciphertext stored.
 */

jest.mock("twilio", () => {
  const actual: { twiml: unknown } = jest.requireActual("twilio") as {
    twiml: unknown;
  };
  const client: ((...args: Array<unknown>) => unknown) & {
    twiml?: unknown;
  } = jest.fn();
  client.twiml = actual.twiml;

  return { __esModule: true, default: client };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/DataSource/EgressGuard", () => {
  return { __esModule: true, default: { assertHostnameAllowed: jest.fn() } };
});

jest.mock("nodemailer", () => {
  return { __esModule: true, default: { createTransport: jest.fn() } };
});

jest.mock("@sendgrid/mail", () => {
  return {
    __esModule: true,
    default: { setApiKey: jest.fn(), send: jest.fn() },
  };
});

jest.mock("../../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

import SMTPOAuthService from "../../../FeatureSet/Notification/Services/SMTPOAuthService";
import CallService from "../../../FeatureSet/Notification/Services/CallService";
import MailService from "../../../FeatureSet/Notification/Services/MailService";
import SmsService from "../../../FeatureSet/Notification/Services/SmsService";
import TelegramService from "../../../FeatureSet/Notification/Services/TelegramService";
import WhatsAppService from "../../../FeatureSet/Notification/Services/WhatsAppService";
import SignedWebhookPost from "../../../FeatureSet/Notification/Utils/SignedWebhookPost";
import "../../../FeatureSet/Notification/API/WhatsApp";
import "../../../FeatureSet/Notification/Utils/Handlebars";

type RouterFunction = (
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
) => void | Promise<void>;

const W: Readonly<Record<string, string>> = CREDENTIALS_AS_WRITTEN;

const OAUTH_ACCESS_TOKEN: string = "oauth-access-token-from-the-token-endpoint";

type TwilioCreate = (...args: Array<unknown>) => Promise<unknown>;
type SendMail = (mail: unknown) => Promise<{ messageId: string }>;

let createMessage: Mock<TwilioCreate>;
let createCall: Mock<TwilioCreate>;
let sendMail: Mock<SendMail>;

// What Twilio's client was made with, call by call: the account and its token.
function twilioClients(): Array<Array<unknown>> {
  return jest.mocked(Twilio).mock.calls as Array<Array<unknown>>;
}

// What was posted to an HTTP API, request by request.
function posted(): Array<{
  url: string;
  data: JSONObject;
  headers: Record<string, string>;
}> {
  return (jest.mocked(API.post).mock.calls as Array<Array<unknown>>).map(
    (call: Array<unknown>) => {
      const request: Record<string, unknown> = call[0] as Record<
        string,
        unknown
      >;

      return {
        url: String(request["url"]),
        data: request["data"] as JSONObject,
        headers: (request["headers"] || {}) as Record<string, string>,
      };
    },
  );
}

// The options each mail transport was made with.
function transportOptions(): Array<Record<string, unknown>> {
  return (
    jest.mocked(nodemailer.createTransport).mock.calls as Array<Array<unknown>>
  ).map((call: Array<unknown>): Record<string, unknown> => {
    return call[0] as Record<string, unknown>;
  });
}

function emailMessage(): EmailMessage {
  return {
    toEmail: new Email("alice@example.test"),
    subject: "Incident #12: Checkout API is down",
    isSubjectLiteral: true,
    templateType: EmailTemplateType.SimpleMessage,
    vars: { subject: "Incident #12", message: "Checkout API is down" },
    body: "",
  };
}

function whatsAppMessage(): WhatsAppMessage {
  return {
    to: new Phone("+15555550123"),
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

/*
 * Sends with the row as written, runs the migration, and sends again:
 * what each send went out with, as `capture` reads it from the stand-ins.
 */
async function beforeAndAfter<T>(
  row: SqlRow,
  send: () => Promise<void>,
  capture: () => T,
): Promise<{ before: T; after: T }> {
  const settings: ServerSettings = useServerSettings(row);

  await send();
  const before: T = capture();

  jest.clearAllMocks();
  await MailService.cleanup();

  await migrateServerSettings(settings);

  // Every credential the fixture wrote, not the migration's own list.
  for (const column of Object.keys(CREDENTIALS_AS_WRITTEN)) {
    expect([
      column,
      Encryption.looksEncrypted(String(settings.table.rows[0]![column])),
    ]).toEqual([column, true]);
  }

  await send();
  const after: T = capture();

  return { before, after };
}

beforeAll(async () => {
  // The email templates' partials, registered as the Notification service registers them.
  const partialsDir: string = Path.resolve(
    __dirname,
    "../../../FeatureSet/Notification/Templates/Partials",
  );
  const partialNames: Array<string> = fs
    .readdirSync(partialsDir)
    .filter((name: string): boolean => {
      return name.endsWith(".hbs");
    })
    .map((name: string): string => {
      return name.slice(0, -4);
    });
  const deadline: number = Date.now() + 15000;

  while (
    partialNames.some((name: string): boolean => {
      return typeof Handlebars.partials[name] !== "function";
    })
  ) {
    if (Date.now() >= deadline) {
      throw new Error("Email partial registration did not finish");
    }

    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 10);
    });
  }
});

beforeEach(() => {
  jest.clearAllMocks();

  createMessage = jest.fn<TwilioCreate>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" });
  createCall = jest.fn<TwilioCreate>();
  createCall.mockResolvedValue({ sid: "CA-1", duration: "0" });
  jest.mocked(Twilio).mockImplementation((() => {
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  }) as never);

  jest
    .spyOn(API, "post")
    .mockResolvedValue(new HTTPResponse<JSONObject>(200, {}, {}) as never);
  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined as never);
  jest.spyOn(SignedWebhookPost, "sleep").mockResolvedValue();

  sendMail = jest.fn<SendMail>();
  sendMail.mockResolvedValue({ messageId: "mail-1" });
  jest.mocked(nodemailer.createTransport).mockReturnValue({
    sendMail,
    close: jest.fn(),
  } as unknown as Transporter);
  jest
    .mocked(SMTPOAuthService.getAccessToken)
    .mockResolvedValue(OAUTH_ACCESS_TOKEN);
  jest
    .mocked(SendgridMail.send)
    .mockResolvedValue([{ statusCode: 202, headers: {} }, {}] as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await MailService.cleanup();
});

describe("SMS and calls through Twilio", () => {
  test("an SMS: Twilio's client is made with the account and its auth token as written", async () => {
    const sent: {
      before: Array<Array<unknown>>;
      after: Array<Array<unknown>>;
    } = await beforeAndAfter(
      serverSettingsAsWritten(),
      async (): Promise<void> => {
        await SmsService.sendSms(
          new Phone("+15555550123"),
          "Incident created",
          {},
        );
      },
      (): Array<Array<unknown>> => {
        return twilioClients().map((call: Array<unknown>) => {
          return [...call];
        });
      },
    );

    expect(sent.after).toEqual([[TWILIO_ACCOUNT_SID, W["twilioAuthToken"]]]);
    expect(sent.after).toEqual(sent.before);
    expect(createMessage).toHaveBeenCalledTimes(1);
  });

  test("a call: the same", async () => {
    const sent: {
      before: Array<Array<unknown>>;
      after: Array<Array<unknown>>;
    } = await beforeAndAfter(
      serverSettingsAsWritten(),
      async (): Promise<void> => {
        await CallService.makeCall(
          {
            to: new Phone("+15555550123"),
            data: [{ sayMessage: "Incident created" }],
          } as unknown as CallRequest,
          {},
        );
      },
      (): Array<Array<unknown>> => {
        return twilioClients().map((call: Array<unknown>) => {
          return [...call];
        });
      },
    );

    expect(sent.after).toEqual([[TWILIO_ACCOUNT_SID, W["twilioAuthToken"]]]);
    expect(sent.after).toEqual(sent.before);
    expect(createCall).toHaveBeenCalledTimes(1);
  });
});

describe("SMS and calls through the server's own gateway", () => {
  // Each request posted: whether its signature is the gateway secret's as written.
  const signedWithTheSecretAsWritten: () => Array<
    [string, boolean]
  > = (): Array<[string, boolean]> => {
    return posted().map(
      (request: {
        url: string;
        data: JSONObject;
        headers: Record<string, string>;
      }): [string, boolean] => {
        const expected: string = `sha256=${crypto
          .createHmac("sha256", W["callAndSmsGatewaySecret"]!)
          .update(JSON.stringify(request.data))
          .digest("hex")}`;

        return [
          request.url,
          request.headers["X-OneUptime-Signature"] === expected,
        ];
      },
    );
  };

  const gatewayRow: () => SqlRow = (): SqlRow => {
    return serverSettingsAsWritten({
      callAndSmsProvider: CallAndSmsProvider.Gateway,
    });
  };

  test("an SMS: signed with the gateway's secret as written", async () => {
    const sent: {
      before: Array<[string, boolean]>;
      after: Array<[string, boolean]>;
    } = await beforeAndAfter(
      gatewayRow(),
      async (): Promise<void> => {
        await SmsService.sendSms(
          new Phone("+15555550123"),
          "Incident created",
          {},
        );
      },
      signedWithTheSecretAsWritten,
    );

    expect(sent.before).toEqual([[GATEWAY_URL, true]]);
    expect(sent.after).toEqual([[GATEWAY_URL, true]]);
    expect(Twilio).not.toHaveBeenCalled();
  });

  test("a call: the same", async () => {
    const sent: {
      before: Array<[string, boolean]>;
      after: Array<[string, boolean]>;
    } = await beforeAndAfter(
      gatewayRow(),
      async (): Promise<void> => {
        await CallService.makeCall(
          {
            to: new Phone("+15555550123"),
            data: [{ sayMessage: "Incident created" }],
          } as unknown as CallRequest,
          {},
        );
      },
      signedWithTheSecretAsWritten,
    );

    expect(sent.before).toEqual([[GATEWAY_URL, true]]);
    expect(sent.after).toEqual([[GATEWAY_URL, true]]);
    expect(Twilio).not.toHaveBeenCalled();
  });
});

describe("email", () => {
  test("Custom SMTP: signed in with the password as written", async () => {
    const sent: {
      before: Array<Record<string, unknown>>;
      after: Array<Record<string, unknown>>;
    } = await beforeAndAfter(
      serverSettingsAsWritten(),
      async (): Promise<void> => {
        await MailService.send(emailMessage());
      },
      transportOptions,
    );

    expect(sent.after).toHaveLength(1);
    expect(sent.after[0]).toMatchObject({
      host: SMTP_HOST,
      auth: { user: SMTP_USERNAME, pass: W["smtpPassword"] },
    });
    expect(sent.after).toEqual(sent.before);
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test("Custom SMTP signing in with OAuth: the token asked for with the client secret as written", async () => {
    const asked: {
      before: Array<unknown>;
      after: Array<unknown>;
    } = await beforeAndAfter(
      serverSettingsAsWritten({ smtpAuthType: SMTPAuthenticationType.OAuth }),
      async (): Promise<void> => {
        await MailService.send(emailMessage());
      },
      (): Array<unknown> => {
        return jest
          .mocked(SMTPOAuthService.getAccessToken)
          .mock.calls.map((call: Array<unknown>) => {
            return call[0];
          });
      },
    );

    expect(asked.after).toHaveLength(1);
    expect(asked.after[0]).toMatchObject({
      clientId: SMTP_CLIENT_ID,
      clientSecret: W["smtpClientSecret"],
      username: SMTP_USERNAME,
    });
    expect(asked.after).toEqual(asked.before);
    expect(transportOptions()[0]).toMatchObject({
      auth: {
        type: "OAuth2",
        user: SMTP_USERNAME,
        accessToken: OAUTH_ACCESS_TOKEN,
      },
    });
  });

  test("SendGrid: sent with the API key as written", async () => {
    const sent: {
      before: Array<unknown>;
      after: Array<unknown>;
    } = await beforeAndAfter(
      serverSettingsAsWritten({ emailServerType: EmailServerType.Sendgrid }),
      async (): Promise<void> => {
        await MailService.send(emailMessage());
      },
      (): Array<unknown> => {
        // SendGrid's client, told the key before each send.
        return (
          jest.mocked(SendgridMail.setApiKey).mock.calls as Array<
            Array<unknown>
          >
        ).map((call: Array<unknown>) => {
          return call[0];
        });
      },
    );

    expect(sent.after).toEqual([W["sendgridApiKey"]]);
    expect(sent.after).toEqual(sent.before);
    expect(SendgridMail.send).toHaveBeenCalledTimes(1);
    expect(sendMail).not.toHaveBeenCalled();
  });
});

describe("WhatsApp", () => {
  test("a message: posted to Meta with the access token as written", async () => {
    const sent: {
      before: Array<[string, string | undefined]>;
      after: Array<[string, string | undefined]>;
    } = await beforeAndAfter(
      serverSettingsAsWritten(),
      async (): Promise<void> => {
        await WhatsAppService.sendWhatsApp(whatsAppMessage(), {});
      },
      (): Array<[string, string | undefined]> => {
        return posted().map(
          (request: {
            url: string;
            headers: Record<string, string>;
          }): [string, string | undefined] => {
            return [request.url, request.headers["Authorization"]];
          },
        );
      },
    );

    expect(sent.after).toHaveLength(1);
    expect(sent.after[0]![0]).toContain(
      `/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
    );
    expect(sent.after[0]![1]).toBe(`Bearer ${W["metaWhatsAppAccessToken"]}`);
    expect(sent.after).toEqual(sent.before);
  });

  test("Meta's webhook verification: the verify token as written is taken, the stored value is not", async () => {
    const handler: RouterFunction = mockRouter.match("GET", "/webhook")
      .handlerFunction as RouterFunction;

    const verify: (token: string) => Promise<[number, unknown]> = async (
      token: string,
    ): Promise<[number, unknown]> => {
      let answer: [number, unknown] = [0, undefined];
      const res: Record<string, unknown> = {};

      res["status"] = (code: number): unknown => {
        answer = [code, undefined];
        return res;
      };
      res["send"] = (body: unknown): void => {
        answer = [answer[0], body];
      };
      res["sendStatus"] = (code: number): void => {
        answer = [code, undefined];
      };

      await handler(
        {
          query: {
            "hub.mode": "subscribe",
            "hub.verify_token": token,
            "hub.challenge": "1158201444",
          },
          headers: {},
        } as unknown as ExpressRequest,
        res as unknown as ExpressResponse,
        (() => {}) as NextFunction,
      );

      return answer;
    };

    const settings: ServerSettings = useServerSettings(
      serverSettingsAsWritten(),
    );

    expect(await verify(W["metaWhatsAppWebhookVerifyToken"]!)).toEqual([
      200,
      "1158201444",
    ]);

    await migrateServerSettings(settings);

    const stored: string = String(
      settings.table.rows[0]!["metaWhatsAppWebhookVerifyToken"],
    );

    expect(Encryption.looksEncrypted(stored)).toBe(true);
    expect(await verify(W["metaWhatsAppWebhookVerifyToken"]!)).toEqual([
      200,
      "1158201444",
    ]);
    expect(await verify(stored)).toEqual([403, undefined]);
  });

  test("Meta's webhook signature: checked with the app secret as written", async () => {
    jest
      .spyOn(Response, "sendErrorResponse")
      .mockResolvedValue(undefined as never);

    const rawBody: string = JSON.stringify({
      object: "whatsapp_business_account",
    });

    const isAccepted: (secret: string) => Promise<boolean> = async (
      secret: string,
    ): Promise<boolean> => {
      const next: Mock<(...args: Array<unknown>) => unknown> = jest.fn();

      await WhatsAppAuthorization.isAuthorizedWhatsAppRequest(
        {
          headers: {
            "x-hub-signature-256": `sha256=${crypto
              .createHmac("sha256", secret)
              .update(rawBody)
              .digest("hex")}`,
          },
          rawBody: rawBody,
        } as unknown as OneUptimeRequest,
        {} as ExpressResponse,
        next as unknown as NextFunction,
      );

      return next.mock.calls.length === 1;
    };

    const settings: ServerSettings = useServerSettings(
      serverSettingsAsWritten(),
    );

    expect(await isAccepted(W["metaWhatsAppAppSecret"]!)).toBe(true);

    await migrateServerSettings(settings);

    const stored: string = String(
      settings.table.rows[0]!["metaWhatsAppAppSecret"],
    );

    expect(Encryption.looksEncrypted(stored)).toBe(true);
    expect(await isAccepted(W["metaWhatsAppAppSecret"]!)).toBe(true);
    expect(await isAccepted(stored)).toBe(false);
  });
});

describe("Telegram", () => {
  test("a message: posted to the bot's address with the bot token as written", async () => {
    const sent: { before: Array<string>; after: Array<string> } =
      await beforeAndAfter(
        serverSettingsAsWritten(),
        async (): Promise<void> => {
          await TelegramService.sendTelegram(
            { to: "424242", body: "Incident created" } as TelegramMessage,
            {},
          );
        },
        (): Array<string> => {
          return posted().map((request: { url: string }): string => {
            return request.url;
          });
        },
      );

    expect(sent.after).toEqual([
      `https://api.telegram.org/bot${W["telegramBotToken"]}/sendMessage`,
    ]);
    expect(sent.after).toEqual(sent.before);
  });
});
