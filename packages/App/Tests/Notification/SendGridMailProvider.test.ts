import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SendgridMail from "@sendgrid/mail";
import Email from "Common/Types/Email";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import EmailPlainText from "Common/Server/Utils/Mail/EmailPlainText";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import SendGridMailProvider, {
  SendGridApiError,
  SendGridSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/SendGridMailProvider";

/*
 * The SendGrid send (SendGridMailProvider): the Mail Send it hands
 * @sendgrid/mail, and what it says when SendGrid does not take an email.
 * The client is mocked here; InlineImagesOnEveryMailTransport sends through
 * the real one to a stand-in for api.sendgrid.com.
 */

jest.mock("@sendgrid/mail", () => {
  return {
    __esModule: true,
    default: { setApiKey: jest.fn(), send: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

const CONFIG: { apiKey: string; fromEmail: Email; fromName: string } = {
  apiKey: "SG.test-key",
  fromEmail: new Email("notifications@example.test"),
  fromName: "Acme Alerts",
};

const LOGO: EmailInlineImage = {
  contentId: "4f1e9c2a-6b7d-4e8f-9a0b-1c2d3e4f5a6b@oneuptime",
  fileName: "oneuptime-logo.png",
  mimeType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  byteLength: 70,
};

const HTML: string = `<p>Reset your password.</p><img src="cid:${LOGO.contentId}" alt="OneUptime">`;

// The Mail Send the provider handed the client.
function handed(): Record<string, unknown> {
  expect(SendgridMail.send).toHaveBeenCalledTimes(1);
  return jest.mocked(SendgridMail.send).mock.calls[0]![0] as never;
}

// A ResponseError as @sendgrid/client rejects with: status, status text, body.
function responseError(
  code: number,
  statusText: string,
  body: unknown,
): Record<string, unknown> {
  return {
    code: code,
    message: statusText,
    response: { headers: {}, body: body },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(SendgridMail.send)
    .mockResolvedValue([
      { statusCode: 202, headers: {}, body: "" },
      {},
    ] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the Mail Send it hands the client", () => {
  test("the API key, then one message: to, from with its name, subject, text and HTML, the images as SendGrid names them", async () => {
    await new SendGridMailProvider().send(
      {
        toEmail: new Email("alice@example.test"),
        subject: "Password Reset Request for OneUptime",
        vars: {},
        body: HTML,
      },
      CONFIG,
      { inlineImages: [LOGO] },
    );

    expect(SendgridMail.setApiKey).toHaveBeenCalledWith("SG.test-key");
    expect(EmailPlainText.fromHtml(HTML)).toContain("Reset your password.");
    expect(handed()).toEqual({
      to: "alice@example.test",
      from: "Acme Alerts <notifications@example.test>",
      subject: "Password Reset Request for OneUptime",
      // The same email as text (EmailPlainText), the image's alt text included.
      text: EmailPlainText.fromHtml(HTML),
      html: HTML,
      attachments: [
        {
          content: LOGO.base64,
          filename: "oneuptime-logo.png",
          type: "image/png",
          disposition: "inline",
          content_id: LOGO.contentId,
        },
      ],
    });
  });

  test("no images, no attachments field at all", async () => {
    await new SendGridMailProvider().send(
      {
        toEmail: new Email("alice@example.test"),
        subject: "Plain",
        vars: {},
        body: "<p>Hello</p>",
      },
      CONFIG,
    );

    expect(Object.keys(handed())).not.toContain("attachments");
  });

  test("HTML with no words: no text part, which SendGrid would refuse as empty", async () => {
    await new SendGridMailProvider().send(
      {
        toEmail: new Email("alice@example.test"),
        subject: "Blank",
        vars: {},
        body: "<p></p>",
      },
      CONFIG,
    );

    expect(Object.keys(handed()).sort()).toEqual([
      "from",
      "html",
      "subject",
      "to",
    ]);
  });

  test("no From Name: the product's name, as a licence may have renamed it", async () => {
    jest
      .spyOn(ProductBrandingText, "getProductName")
      .mockReturnValue("Acme Status");

    await new SendGridMailProvider().send(
      {
        toEmail: new Email("alice@example.test"),
        subject: "Plain",
        vars: {},
        body: "<p>Hello</p>",
      },
      { ...CONFIG, fromName: "" },
    );

    expect(handed()["from"]).toBe("Acme Status <notifications@example.test>");
  });

  test("a refusal is thrown as what SendGrid said, flagged when it was the images", async () => {
    jest.mocked(SendgridMail.send).mockRejectedValue(
      responseError(400, "Bad Request", {
        errors: [
          {
            message:
              "The content_id parameter is required if disposition = 'inline'.",
            field: "attachments.0.content_id",
            help: "http://sendgrid.com/docs/API_Reference/Web_API_v3/Mail/errors.html#message.attachments.content_id",
          },
        ],
      }),
    );

    let thrown: unknown = undefined;

    try {
      await new SendGridMailProvider().send(
        {
          toEmail: new Email("alice@example.test"),
          subject: "Logo",
          vars: {},
          body: HTML,
        },
        CONFIG,
        { inlineImages: [LOGO] },
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SendGridSendException);
    expect((thrown as SendGridSendException).message).toBe(
      "SendGrid did not accept the email (HTTP 400 Bad Request). SendGrid said: The content_id parameter is required if disposition = 'inline'. (attachments.0.content_id)",
    );
    expect((thrown as SendGridSendException).statusCode).toBe(400);
    expect((thrown as SendGridSendException).refusedInlineImages).toBe(true);
  });
});

describe("SendGrid's errors, read from the body the client hands back", () => {
  const ERRORS: Array<SendGridApiError> = [
    {
      message:
        "The content_id parameter is required if disposition = 'inline'.",
      field: "attachments.0.content_id",
    },
    { message: "Does not contain a valid address.", field: null },
  ];

  test("parsed JSON, or the JSON as text", () => {
    const body: Record<string, unknown> = {
      errors: [
        {
          message:
            "The content_id parameter is required if disposition = 'inline'.",
          field: "attachments.0.content_id",
          help: "http://sendgrid.com/docs/API_Reference/Web_API_v3/Mail/errors.html#message.attachments.content_id",
        },
        { message: " Does not contain a valid address. ", field: null },
      ],
    };

    expect(SendGridMailProvider.readApiErrors(body)).toEqual(ERRORS);
    expect(SendGridMailProvider.readApiErrors(JSON.stringify(body))).toEqual(
      ERRORS,
    );
  });

  test("an error without words is left out; a blank field is none", () => {
    expect(
      SendGridMailProvider.readApiErrors({
        errors: [
          { message: "", field: "attachments.0.content" },
          { message: 42 },
          null,
          "Bad",
          { message: "Payload Too Large", field: "  " },
        ],
      }),
    ).toEqual([{ message: "Payload Too Large", field: null }]);
  });

  test.each([
    undefined,
    null,
    "",
    "Bad Request",
    "{not json",
    42,
    {},
    { errors: "Bad Request" },
    [],
  ])("%j lists no errors", (body: unknown) => {
    expect(SendGridMailProvider.readApiErrors(body)).toEqual([]);
  });
});

describe("what a refusal says, for whoever reads the Email Log", () => {
  test("HTTP 400: what SendGrid did not accept, each reason with its field", () => {
    const exception: SendGridSendException = SendGridMailProvider.explainError(
      responseError(400, "Bad Request", {
        errors: [
          { message: "Does not contain a valid address.", field: "from.email" },
          { message: "The subject is required.", field: "subject" },
        ],
      }),
      { hadInlineImages: true },
    );

    expect(exception.message).toBe(
      "SendGrid did not accept the email (HTTP 400 Bad Request). SendGrid said: Does not contain a valid address. (from.email) The subject is required. (subject)",
    );
    expect(exception.statusCode).toBe(400);
    expect(exception.refusedInlineImages).toBe(false);
  });

  test("HTTP 401: the API key, and where to set it", () => {
    expect(
      SendGridMailProvider.explainError(
        responseError(401, "Unauthorized", {
          errors: [
            {
              message:
                "The provided authorization grant is invalid, expired, or revoked",
              field: null,
            },
          ],
        }),
        { hadInlineImages: true },
      ).message,
    ).toBe(
      "SendGrid did not accept the API key (HTTP 401 Unauthorized). Check the SendGrid API Key in the admin dashboard, under Settings > Emails. SendGrid said: The provided authorization grant is invalid, expired, or revoked",
    );
  });

  test("HTTP 403: the key's Mail Send permission, and a verified sender", () => {
    expect(
      SendGridMailProvider.explainError(
        responseError(403, "Forbidden", {
          errors: [
            {
              message:
                "The from address does not match a verified Sender Identity.",
              field: "from",
            },
          ],
        }),
        { hadInlineImages: false },
      ).message,
    ).toBe(
      "SendGrid would not send this email (HTTP 403 Forbidden). The API key needs the Mail Send permission, and the From Email must be a sender verified in SendGrid. SendGrid said: The from address does not match a verified Sender Identity. (from)",
    );
  });

  test("HTTP 429: the account's sending limit", () => {
    expect(
      SendGridMailProvider.explainError(
        responseError(429, "Too Many Requests", ""),
        { hadInlineImages: false },
      ).message,
    ).toBe(
      "SendGrid is limiting how many emails this account sends (HTTP 429 Too Many Requests).",
    );
  });

  test("an answer with no body to read says its status", () => {
    expect(
      SendGridMailProvider.explainError(responseError(502, "", undefined), {
        hadInlineImages: false,
      }).message,
    ).toBe("SendGrid did not accept the email (HTTP 502).");
  });

  test("no answer at all: SendGrid could not be reached, and why", () => {
    const exception: SendGridSendException = SendGridMailProvider.explainError(
      Object.assign(new Error("getaddrinfo ENOTFOUND api.sendgrid.com"), {
        code: "ENOTFOUND",
      }),
      { hadInlineImages: true },
    );

    expect(exception.message).toBe(
      "SendGrid could not be reached: getaddrinfo ENOTFOUND api.sendgrid.com",
    );
    expect(exception.statusCode).toBeUndefined();
    expect(exception.refusedInlineImages).toBe(false);
  });

  test("something that is not an error at all", () => {
    expect(
      SendGridMailProvider.explainError("boom", { hadInlineImages: true })
        .message,
    ).toBe("SendGrid could not be reached.");
  });

  test("a refusal of the images counts only when the email had any", () => {
    const refusal: Record<string, unknown> = responseError(400, "Bad Request", {
      errors: [
        {
          message:
            "The content_id parameter is required if disposition = 'inline'.",
          field: "attachments.0.content_id",
        },
      ],
    });

    expect(
      SendGridMailProvider.explainError(refusal, { hadInlineImages: true })
        .refusedInlineImages,
    ).toBe(true);
    expect(
      SendGridMailProvider.explainError(refusal, { hadInlineImages: false })
        .refusedInlineImages,
    ).toBe(false);
    expect(
      SendGridMailProvider.explainError(
        responseError(413, "Payload Too Large", ""),
        { hadInlineImages: true },
      ).refusedInlineImages,
    ).toBe(true);
  });
});
