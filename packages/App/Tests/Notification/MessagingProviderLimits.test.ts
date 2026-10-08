import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import TelegramService from "../../FeatureSet/Notification/Services/TelegramService";
import WhatsAppService from "../../FeatureSet/Notification/Services/WhatsAppService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import logger from "Common/Server/Utils/Logger";
import API from "Common/Utils/API";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import {
  WhatsAppTemplateId,
  WhatsAppTemplateMessages,
} from "Common/Types/WhatsApp/WhatsAppTemplates";
import {
  MAX_SMS_LENGTH,
  MAX_TELEGRAM_MESSAGE_LENGTH,
  MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH,
  TRUNCATED_TEXT_NOTE,
  TRUNCATED_TEXT_NOTE_PLAIN,
} from "Common/Utils/MessageFit";
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
 * EVERY MESSAGE IS ONE ITS PROVIDER TAKES.
 *
 * Twilio refuses an SMS body over 1,600 characters, Telegram a message over
 * 4,096, Meta a WhatsApp template whose text with its variables filled in
 * comes to more than 1,024 - and the notification is lost. A notification's
 * text can be anything a template placed in it. The real senders, with only
 * the providers and the logs mocked, hold every message to its provider's
 * limit, cut with a short note that the rest is in OneUptime. A message
 * within the limit goes as it always did.
 */

jest.mock("twilio", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { __esModule: true, ...actual, IsBillingEnabled: false };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    getTwilioConfig: jest.fn(),
    getMetaWhatsAppConfig: jest.fn(),
    getTelegramConfig: jest.fn(),
  };
});

import {
  getMetaWhatsAppConfig,
  getTelegramConfig,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550177");

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

let createMessage: AsyncMock;

// What the last message sent to Telegram or Meta carried.
function lastPosted(): JSONObject {
  const calls: Array<Array<unknown>> = (API.post as unknown as jest.Mock).mock
    .calls;

  expect(calls.length).toBeGreaterThan(0);

  return (calls[calls.length - 1]![0] as { data: JSONObject }).data;
}

beforeEach(() => {
  for (const level of ["error", "debug", "info", "warn"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {}) as never);
  }

  createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);

  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { messages: { create: createMessage } };
  });

  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    TWILIO_CONFIG as never,
  );
  (getMetaWhatsAppConfig as unknown as jest.Mock).mockResolvedValue({
    accessToken: "meta-token",
    phoneNumberId: "meta-phone",
    apiVersion: "v19.0",
  } as never);
  (getTelegramConfig as unknown as jest.Mock).mockResolvedValue({
    botToken: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
    botUsername: "oneuptime_bot",
  } as never);

  for (const service of [
    SmsLogService,
    WhatsAppLogService,
    TelegramLogService,
  ]) {
    jest.spyOn(service as never, "create").mockImplementation(((data: {
      data: { _id?: string };
    }) => {
      data.data._id = ObjectID.generate().toString();
      return Promise.resolve(data.data);
    }) as never);
  }

  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest.spyOn(API, "post").mockResolvedValue({
    jsonData: {
      ok: true,
      result: { message_id: "telegram-message-id" },
      messages: [{ id: "wamid-1" }],
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an SMS", () => {
  async function sentBody(message: string): Promise<string> {
    await SmsService.sendSms(TO, message, {});

    expect(createMessage).toHaveBeenCalledTimes(1);

    return (createMessage.mock.calls[0]![0] as { body: string }).body;
  }

  test("over 1,600 characters is cut to fit, ending with a note every SMS encoding has", async () => {
    const body: string = await sentBody(
      `Incident #42: Checkout is down. ${"The response body was a long log line. ".repeat(200)}`,
    );

    expect(body.length).toBeLessThanOrEqual(MAX_SMS_LENGTH);
    expect(body.startsWith("Incident #42: Checkout is down.")).toBe(true);
    expect(body.endsWith(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
    // GSM 7-bit only: a single other character would make every part hold 70.
    const printableAscii: RegExp = /^[\x20-\x7e\n]*$/;

    expect(printableAscii.test(TRUNCATED_TEXT_NOTE_PLAIN)).toBe(true);
  });

  test("within the limit goes as it always did", async () => {
    const message: string =
      "Incident #42: Checkout is down. Acknowledge: https://oneuptime.com/a";

    expect(await sentBody(message)).toBe(message);
  });
});

describe("a Telegram message", () => {
  test("over 4,096 characters of plain text is cut to fit, with the note", async () => {
    await TelegramService.sendTelegram(
      { to: "123456789", body: `Incident ${"x".repeat(10000)}` },
      {},
    );

    const text: string = lastPosted()["text"] as string;

    expect(text.length).toBeLessThanOrEqual(MAX_TELEGRAM_MESSAGE_LENGTH);
    expect(text.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
  });

  test("in HTML is counted as Telegram counts it, cut between tags, every tag still closed", async () => {
    await TelegramService.sendTelegram(
      {
        to: "123456789",
        body: `<b>Incident #42</b>\n<i>${"&lt;log&gt; line ".repeat(1000)}</i>`,
        parseMode: "HTML",
      },
      {},
    );

    const posted: JSONObject = lastPosted();
    const text: string = posted["text"] as string;

    expect(posted["parse_mode"]).toBe("HTML");
    expect(text.startsWith("<b>Incident #42</b>\n<i>")).toBe(true);
    expect(text.endsWith(`</i>\n\n${TRUNCATED_TEXT_NOTE}`)).toBe(true);
    // As Telegram counts it: no tags, a reference one character.
    expect(
      text.replace(/<[^>]+>/g, "").replace(/&[a-z]+;/g, "_").length,
    ).toBeLessThanOrEqual(MAX_TELEGRAM_MESSAGE_LENGTH);
  });

  test("within the limit goes as it always did", async () => {
    await TelegramService.sendTelegram(
      { to: "123456789", body: "<b>Incident #42</b>", parseMode: "HTML" },
      {},
    );

    expect(lastPosted()["text"]).toBe("<b>Incident #42</b>");
    expect(lastPosted()["parse_mode"]).toBe("HTML");
  });
});

describe("a WhatsApp template", () => {
  function hydrated(
    templateKey: string,
    parameters: Array<JSONObject>,
  ): string {
    let text: string =
      WhatsAppTemplateMessages[templateKey as WhatsAppTemplateId];

    for (const parameter of parameters) {
      text = text
        .split(`{{${parameter["parameter_name"] as string}}}`)
        .join(parameter["text"] as string);
    }

    return text;
  }

  function parametersOf(payload: JSONObject): Array<JSONObject> {
    const components: Array<JSONObject> = (payload["template"] as JSONObject)[
      "components"
    ] as Array<JSONObject>;

    return components[0]!["parameters"] as Array<JSONObject>;
  }

  test("whose title would take it over 1,024 characters has the title cut, its links whole", async () => {
    const link: string = `https://oneuptime.example.com/dashboard/${"p".repeat(60)}/incidents/42`;

    await WhatsAppService.sendWhatsApp(
      {
        to: TO,
        templateKey: "oneuptime_created_incident",
        templateVariables: {
          incident_number: "42",
          incident_title: `Checkout is down: ${"a very long title ".repeat(100)}`,
          project_name: "Acme",
          acknowledge_url: link,
          incident_link: link,
        },
      } as unknown as WhatsAppMessage,
      {},
    );

    const parameters: Array<JSONObject> = parametersOf(lastPosted());
    const text: string = hydrated("oneuptime_created_incident", parameters);

    expect(text.length).toBeLessThanOrEqual(MAX_WHATSAPP_TEMPLATE_TEXT_LENGTH);
    expect(text).toContain(`open ${link} to respond`);
    expect(text).toContain(`this incident ${link} on`);
    expect(
      parameters.find((parameter: JSONObject): boolean => {
        return parameter["parameter_name"] === "incident_title";
      })!["text"] as string,
    ).toMatch(/^Checkout is down: a very long title .*…$/);
  });

  test("within the limit goes as it always did", async () => {
    const variables: Record<string, string> = {
      incident_number: "42",
      incident_title: "Checkout is down",
      project_name: "Acme",
      acknowledge_url: "https://oneuptime.example.com/a",
      incident_link: "https://oneuptime.example.com/i",
    };

    await WhatsAppService.sendWhatsApp(
      {
        to: TO,
        templateKey: "oneuptime_created_incident",
        templateVariables: variables,
      } as unknown as WhatsAppMessage,
      {},
    );

    expect(
      parametersOf(lastPosted()).map((parameter: JSONObject): string => {
        return parameter["text"] as string;
      }),
    ).toEqual(Object.values(variables));
  });
});
