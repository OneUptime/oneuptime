import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  MailApiAnswer,
  MailApiSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/HttpMailApi";
import ResendMailProvider, {
  RESEND_SEND_URL,
  ResendSendEmailRequest,
} from "../../FeatureSet/Notification/Services/MailProviders/ResendMailProvider";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import ObjectID from "Common/Types/ObjectID";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import {
  FakeResend,
  resendError,
  sendResendTo,
  startFakeResend,
} from "./Fixtures/FakeMailServices";

/*
 * RESEND (ResendMailProvider): the Emails API's JSON - from, to, subject,
 * html, text and each inline image an attachment by its content_id - the
 * two headers Resend asks for (a User-Agent and one Idempotency-Key for
 * every try of an email), and what each refusal reads as: a key that is
 * not one, a key that may not send, a domain not verified, Resend's test
 * domain, throttling against a quota.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

const API_KEY: string = "re_test_0123456789abcdef";

const SERVER: EmailServer = {
  id: ObjectID.generate(),
  transportType: MailTransportType.Resend,
  username: undefined,
  password: undefined,
  fromEmail: new Email("alerts@example.test"),
  fromName: "Acme Alerts",
  apiKey: API_KEY,
};

const LOGO: EmailInlineImage = {
  contentId: "4f1e9c2a-6b7d-4e8f-9a0b-1c2d3e4f5a6b@oneuptime",
  fileName: "oneuptime-logo.png",
  mimeType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  byteLength: 70,
};

function mail(): EmailMessage {
  return {
    toEmail: new Email("oncall@example.test"),
    subject: "Incident #12 created",
    body: `<p>Checkout is down.</p><img src="cid:${LOGO.contentId}" alt="OneUptime">`,
    vars: {},
  };
}

function explain(
  status: number,
  name: string,
  message: string,
  hadInlineImages: boolean = false,
): MailApiSendException {
  const answer: MailApiAnswer = {
    status: status,
    headers: new Headers(),
    bodyText: JSON.stringify({
      statusCode: status,
      name: name,
      message: message,
    }),
  };

  return ResendMailProvider.explainError(answer, {
    fromEmail: "alerts@example.test",
    hadInlineImages: hadInlineImages,
    secrets: [API_KEY],
  });
}

describe("the email it writes", () => {
  test("from with its name, to as a list, the subject, the HTML, its text; the image by its content_id", () => {
    const request: ResendSendEmailRequest = ResendMailProvider.buildRequest({
      mail: mail(),
      emailServer: SERVER,
      inlineImages: [LOGO],
    });

    expect(request).toEqual({
      from: "Acme Alerts <alerts@example.test>",
      to: ["oncall@example.test"],
      subject: "Incident #12 created",
      html: mail().body,
      text: expect.stringContaining("Checkout is down."),
      attachments: [
        {
          content: LOGO.base64,
          filename: "oneuptime-logo.png",
          content_type: "image/png",
          content_id: LOGO.contentId,
        },
      ],
    });
  });

  test("an email whose HTML has no words says so with an empty text: Resend writes none of its own", () => {
    expect(
      ResendMailProvider.buildRequest({
        mail: { ...mail(), body: "<div></div>" },
        emailServer: SERVER,
        inlineImages: [],
      }).text,
    ).toBe("");
  });

  test("it sends to the Emails API, as the product, by name", () => {
    expect(RESEND_SEND_URL).toBe("https://api.resend.com/emails");
    expect(ResendMailProvider.getUserAgent()).toBe("OneUptime Mail");
  });

  test("a renamed product's User-Agent is its name, in what a header holds", () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acmé Status\r\n");

    expect(ResendMailProvider.getUserAgent()).toBe("Acm Status Mail");

    jest.restoreAllMocks();
  });
});

describe("what each refusal reads as", () => {
  test("a key that is not one", () => {
    const error: MailApiSendException = explain(
      401,
      "validation_error",
      "API key is invalid",
    );

    expect(error.message).toBe(
      "Resend did not accept the API key (HTTP 401 validation_error). Check the Resend API Key. Resend said: validation_error: API key is invalid",
    );
    expect(error.isRetryable).toBe(false);
  });

  test("a key that may not send", () => {
    expect(
      explain(
        403,
        "restricted_api_key",
        "This API key is restricted to only send emails",
      ).message,
    ).toContain("The Resend API key may not send email");
  });

  test("a domain not verified in Resend", () => {
    expect(
      explain(
        403,
        "validation_error",
        "The example.test domain is not verified. Please, add and verify your domain on https://resend.com/domains",
      ).message,
    ).toContain("example.test is not a verified domain in Resend");
  });

  test("Resend's test domain sends only to the account's own address", () => {
    expect(
      explain(
        403,
        "validation_error",
        "You can only send testing emails to your own email address (owner@example.test).",
      ).message,
    ).toContain("Resend's test domain sends only to the account's own address");
  });

  test("throttling is tried again; a spent quota is not", () => {
    expect(
      explain(429, "rate_limit_exceeded", "Too many requests").isRetryable,
    ).toBe(true);
    expect(
      explain(429, "daily_quota_exceeded", "You have reached your daily quota")
        .isRetryable,
    ).toBe(false);
    expect(
      explain(429, "monthly_quota_exceeded", "Monthly quota reached")
        .isRetryable,
    ).toBe(false);
  });

  test("an attachment Resend will not take is refused for the images", () => {
    expect(
      explain(422, "invalid_attachment", "Invalid attachment", true)
        .refusedInlineImages,
    ).toBe(true);
    expect(
      explain(422, "missing_required_field", "Missing `to` field.", true)
        .refusedInlineImages,
    ).toBe(false);
  });

  test("the key never reaches the message", () => {
    expect(
      explain(401, "validation_error", `API key ${API_KEY} is invalid`).message,
    ).not.toContain(API_KEY);
  });
});

describe("sending, to a stand-in for Resend", () => {
  let resend: FakeResend;

  beforeAll(async () => {
    resend = await startFakeResend(API_KEY);
  });

  afterAll(async () => {
    await resend.close();
  });

  beforeEach(() => {
    resend.requests.length = 0;
    sendResendTo(resend);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("throttled, it is tried again with the same Idempotency-Key, so the email is sent once", async () => {
    resend.answerNextWith({
      ...resendError(429, "rate_limit_exceeded", "Too many requests"),
      headers: { "retry-after": "0" },
    });

    await new ResendMailProvider().send(mail(), SERVER, {
      inlineImages: [LOGO],
    });

    expect(resend.requests).toHaveLength(2);
    expect(resend.requests[0]!.headers["idempotency-key"]).toBe(
      resend.requests[1]!.headers["idempotency-key"],
    );
  });

  test("two emails get keys of their own", async () => {
    await new ResendMailProvider().send(mail(), SERVER, {});
    await new ResendMailProvider().send(mail(), SERVER, {});

    expect(resend.requests[0]!.headers["idempotency-key"]).not.toBe(
      resend.requests[1]!.headers["idempotency-key"],
    );
  });

  test("a key Resend does not take is reported at once", async () => {
    await expect(
      new ResendMailProvider().send(
        mail(),
        { ...SERVER, apiKey: "re_wrong" },
        {},
      ),
    ).rejects.toThrow("Resend did not accept the API key (HTTP 401");
    expect(resend.requests).toHaveLength(1);
  });

  test("a config without its key is refused before anything is sent", async () => {
    await expect(
      new ResendMailProvider().send(mail(), { ...SERVER, apiKey: "" }, {}),
    ).rejects.toThrow("Resend needs an API Key.");
    expect(resend.requests).toHaveLength(0);
  });
});
