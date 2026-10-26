import { describe, expect, jest, test } from "@jest/globals";
import { fastestRun } from "Common/Tests/Helpers/FastestRun";
import InlineImageRefusal from "../../FeatureSet/Notification/Services/MailProviders/InlineImageRefusal";
import { SendGridSendException } from "../../FeatureSet/Notification/Services/MailProviders/SendGridMailProvider";
import { GraphSendException } from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";

// The providers are loaded for their exceptions only: no token is fetched.
jest.mock("../../FeatureSet/Notification/Services/SMTPOAuthService", () => {
  return { __esModule: true, default: { getAccessToken: jest.fn() } };
});

/*
 * Whether a mail service refused an email for its inline images - so that,
 * without them, the same email can go (MailService.sendEvenWithoutImages) -
 * read from each service's own answer. Only an answer that names the images
 * counts: any other refusal would refuse the email without them just the
 * same, and is reported as it is.
 */

describe("SendGrid: HTTP 400 naming an attachments field, or 413", () => {
  test.each([
    [400, ["attachments.0.content_id"]],
    [400, ["attachments.1.content"]],
    [400, ["attachments"]],
    [400, ["subject", "attachments.0.filename"]],
    [413, []],
    [413, ["content"]],
  ])(
    "HTTP %s with errors on %j: the images",
    (status: number, fields: Array<string>) => {
      expect(InlineImageRefusal.isSendgridRefusal(status, fields)).toBe(true);
    },
  );

  test.each([
    [400, ["personalizations.0.to.0.email"]],
    [400, ["from"]],
    [400, ["content.0.value"]],
    [400, ["attachmentsx.0"]],
    [400, ["my.attachments.0"]],
    [400, []],
    [401, ["attachments.0.content_id"]],
    [403, ["from"]],
    [429, []],
    [500, ["attachments.0.content"]],
    [undefined, ["attachments.0.content_id"]],
  ])(
    "HTTP %s with errors on %j: not the images",
    (status: number | undefined, fields: Array<string>) => {
      expect(InlineImageRefusal.isSendgridRefusal(status, fields)).toBe(false);
    },
  );
});

describe("Microsoft Graph: HTTP 400 naming an attachment or the size, or 413", () => {
  test.each([
    [
      400,
      "RequestBodyRead The property 'contentId' does not exist on type 'microsoft.graph.attachment'.",
    ],
    [400, "ErrorInvalidRequest The attachment is not valid."],
    [400, "ErrorAttachmentSizeShouldNotBeLessThanZero"],
    [400, "RequestBodyRead Invalid value for contentBytes."],
    [
      400,
      "RequestBodyRead Cannot convert the literal to Edm.Boolean for isInline.",
    ],
    [
      400,
      "ErrorMessageSizeExceeded The message exceeds the maximum supported size.",
    ],
    [413, "RequestEntityTooLarge The request is too large."],
    [413, ""],
  ])("HTTP %s, %j: the images", (status: number, detail: string) => {
    expect(InlineImageRefusal.isMicrosoftGraphRefusal(status, detail)).toBe(
      true,
    );
  });

  test.each([
    [400, "ErrorInvalidRecipients At least one recipient isn't valid."],
    [400, "ErrorInvalidRequest Empty Payload. JSON content expected."],
    [401, "InvalidAuthenticationToken The attachment token expired."],
    [403, "ErrorAccessDenied Access is denied."],
    [404, "ErrorItemNotFound The attachment was not found."],
    [429, "ApplicationThrottled MailboxConcurrency limit."],
    [503, "ServiceUnavailable The attachment service is down."],
  ])("HTTP %s, %j: not the images", (status: number, detail: string) => {
    expect(InlineImageRefusal.isMicrosoftGraphRefusal(status, detail)).toBe(
      false,
    );
  });
});

describe("SMTP: an enhanced status 5.2.3, 5.3.4 or 5.6.x, or a reply 552 without one", () => {
  test.each([
    {
      responseCode: 552,
      response: "552 5.3.4 Message size exceeds fixed maximum message size",
    },
    {
      responseCode: 552,
      response: "552-5.2.3 Your message exceeded Google's message size limits.",
    },
    {
      responseCode: 552,
      response: "552 5.2.3 Message length exceeds administrative limit",
    },
    { responseCode: 552 },
    { responseCode: 552, response: "552 Message size exceeds fixed limit" },
    {
      responseCode: 554,
      response: "554 5.3.4 Message too big for system",
    },
    { responseCode: 554, response: "554 5.6.0 Invalid message content" },
    { responseCode: 550, response: "550 5.6.1 Media not supported" },
    { responseCode: 554, response: "554-5.6.10 Content type not allowed" },
    { response: "552 5.3.4 Message size exceeds fixed maximum message size" },
  ])("%j: the images", (reply: Record<string, unknown>) => {
    expect(InlineImageRefusal.isSmtpRefusal(reply)).toBe(true);
    expect(InlineImageRefusal.isRefusalOfInlineImages(reply)).toBe(true);
  });

  test.each([
    { responseCode: 554, response: "554 5.7.1 Message rejected as spam" },
    { responseCode: 550, response: "550 5.1.1 User unknown" },
    {
      responseCode: 535,
      response: "535 5.7.8 Authentication credentials invalid",
    },
    { responseCode: 451, response: "451 4.3.0 Temporary failure" },
    { responseCode: 452, response: "452 4.3.4 Message size exceeds limit" },
    { responseCode: 554, response: "554 5.3.40 No such status" },
    { response: "Message failed: 552 5.3.4 Message too big" },
    { code: "ECONNREFUSED", message: "connect ECONNREFUSED 127.0.0.1:25" },
    { responseCode: "552" },
    // A full mailbox: the same email without its images would be refused too.
    { responseCode: 552, response: "552 5.2.2 Mailbox full" },
    {
      responseCode: 552,
      response:
        "552-5.2.2 The email account that you tried to reach is over quota.",
    },
    { responseCode: 552, response: "552 5.7.1 Message refused by policy" },
    { responseCode: 552, response: "552 4.3.4 Message too big, try later" },
  ])("%j: not the images", (reply: Record<string, unknown>) => {
    expect(InlineImageRefusal.isSmtpRefusal(reply)).toBe(false);
    expect(InlineImageRefusal.isRefusalOfInlineImages(reply)).toBe(false);
  });

  test("nothing that is not an error object", () => {
    for (const value of [null, undefined, "552 5.3.4 Too big", 552, true]) {
      expect(InlineImageRefusal.isSmtpRefusal(value)).toBe(false);
      expect(InlineImageRefusal.isRefusalOfInlineImages(value)).toBe(false);
    }
  });

  test("a real nodemailer error says so: an Error with responseCode and response", () => {
    const error: Error & { responseCode?: number; response?: string } =
      new Error(
        "Message failed: 552 5.3.4 Message size exceeds fixed maximum message size",
      );

    error.responseCode = 552;
    error.response =
      "552 5.3.4 Message size exceeds fixed maximum message size";

    expect(InlineImageRefusal.isRefusalOfInlineImages(error)).toBe(true);
  });
});

describe("what MailService asks of whatever a transport threw", () => {
  test("a provider's own answer wins: its flag says yes or no", () => {
    expect(
      InlineImageRefusal.isRefusalOfInlineImages({ refusedInlineImages: true }),
    ).toBe(true);
    // Even beside an SMTP-looking reply, the provider read its own service.
    expect(
      InlineImageRefusal.isRefusalOfInlineImages({
        refusedInlineImages: false,
        responseCode: 552,
      }),
    ).toBe(false);
  });

  test("the providers' exceptions carry it", () => {
    expect(
      InlineImageRefusal.isRefusalOfInlineImages(
        new SendGridSendException("SendGrid did not accept the email.", {
          statusCode: 400,
          refusedInlineImages: true,
        }),
      ),
    ).toBe(true);
    expect(
      InlineImageRefusal.isRefusalOfInlineImages(
        new SendGridSendException("SendGrid did not accept the API key.", {
          statusCode: 401,
          refusedInlineImages: false,
        }),
      ),
    ).toBe(false);
    expect(
      InlineImageRefusal.isRefusalOfInlineImages(
        new GraphSendException("Microsoft Graph sendMail failed.", {
          isRetryable: false,
          refusedInlineImages: true,
        }),
      ),
    ).toBe(true);
    expect(
      InlineImageRefusal.isRefusalOfInlineImages(
        new GraphSendException("Microsoft Graph denied the send.", {
          isRetryable: false,
        }),
      ),
    ).toBe(false);
  });
});

/*
 * Graph's error text and an SMTP server's reply are written outside
 * OneUptime: each is read in time linear in its length. 400,000 characters
 * of each pattern's worst case - text that starts its match everywhere and
 * finishes it nowhere - is answered within two seconds.
 */
describe("outside text is read in linear time", () => {
  test("Graph: an error that almost names an attachment, 400,000 characters of it", () => {
    const detail: string = "attachmen".repeat(44445);

    const run: { result: boolean; inMs: number } = fastestRun({
      run: (): boolean => {
        return InlineImageRefusal.isMicrosoftGraphRefusal(400, detail);
      },
      limitInMs: 2000,
    });

    expect(detail.length).toBeGreaterThanOrEqual(400000);
    expect(run.result).toBe(false);
    expect(run.inMs).toBeLessThan(2000);
  });

  test("SMTP: a reply whose status runs on, 400,000 characters of it", () => {
    const reply: { responseCode: number; response: string } = {
      responseCode: 554,
      response: `554 5.6.${"1".repeat(400000)}`,
    };

    const run: { result: boolean; inMs: number } = fastestRun({
      run: (): boolean => {
        return InlineImageRefusal.isSmtpRefusal(reply);
      },
      limitInMs: 2000,
    });

    expect(run.result).toBe(false);
    expect(run.inMs).toBeLessThan(2000);
  });
});
