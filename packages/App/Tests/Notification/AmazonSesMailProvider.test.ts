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
import AmazonSesMailProvider, {
  AMAZON_SES_SEND_EMAIL_PATH,
  AMAZON_SES_SIGNING_SERVICE,
  AmazonSesSendEmailRequest,
} from "../../FeatureSet/Notification/Services/MailProviders/AmazonSesMailProvider";
import {
  MailApiAnswer,
  MailApiSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/HttpMailApi";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import ObjectID from "Common/Types/ObjectID";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import {
  AmazonSesSendEmailJson,
  FakeAmazonSes,
  amazonSesError,
  sendAmazonSesTo,
  startFakeAmazonSes,
} from "./Fixtures/FakeMailServices";

/*
 * AMAZON SES (AmazonSesMailProvider): the SendEmail it writes - Simple
 * content, the sender's name as SES asks for it, each inline image an
 * INLINE attachment by its Content-ID - the Region it is sent to and only a
 * Region, and what each refusal SES documents reads as in the Email Log:
 * what it means, what to change, what SES said, and never the secret.
 * InlineImagesOnEveryMailTransport sends whole emails through it, its
 * signature checked by the stand-in.
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

const CREDENTIALS: {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
} = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  region: "eu-west-1",
};

const SERVER: EmailServer = {
  id: ObjectID.generate(),
  transportType: MailTransportType.AmazonSES,
  username: undefined,
  password: undefined,
  fromEmail: new Email("alerts@example.test"),
  fromName: "Acme Alerts",
  awsAccessKeyId: CREDENTIALS.accessKeyId,
  awsSecretAccessKey: CREDENTIALS.secretAccessKey,
  awsRegion: CREDENTIALS.region,
};

const LOGO: EmailInlineImage = {
  contentId: "4f1e9c2a-6b7d-4e8f-9a0b-1c2d3e4f5a6b@oneuptime",
  fileName: "oneuptime-logo.png",
  mimeType: "image/png",
  base64:
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  byteLength: 70,
};

function mail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    toEmail: new Email("oncall@example.test"),
    subject: "Incident #12 created",
    body: `<p>Checkout is down.</p><img src="cid:${LOGO.contentId}" alt="OneUptime">`,
    vars: {},
    ...overrides,
  };
}

function answer(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): MailApiAnswer {
  return {
    status: status,
    headers: new Headers(headers),
    bodyText: typeof body === "string" ? body : JSON.stringify(body),
  };
}

function explain(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
  hadInlineImages: boolean = false,
): MailApiSendException {
  return AmazonSesMailProvider.explainError(answer(status, body, headers), {
    region: "eu-west-1",
    fromEmail: "alerts@example.test",
    hadInlineImages: hadInlineImages,
    secrets: [CREDENTIALS.secretAccessKey],
  });
}

describe("the SendEmail it writes", () => {
  test("Simple content in UTF-8: the subject, the HTML and the same email as text", () => {
    const request: AmazonSesSendEmailRequest =
      AmazonSesMailProvider.buildRequest({
        mail: mail(),
        emailServer: SERVER,
        inlineImages: [],
      });

    expect(request.FromEmailAddress).toBe("Acme Alerts <alerts@example.test>");
    expect(request.Destination).toEqual({
      ToAddresses: ["oncall@example.test"],
    });
    expect(request.Content.Simple.Subject).toEqual({
      Data: "Incident #12 created",
      Charset: "UTF-8",
    });
    expect(request.Content.Simple.Body.Html.Charset).toBe("UTF-8");
    expect(request.Content.Simple.Body.Text).toEqual({
      Data: "Checkout is down.\n\nOneUptime",
      Charset: "UTF-8",
    });
    expect(request.Content.Simple.Attachments).toBeUndefined();
  });

  test("each inline image an INLINE attachment by the Content-ID the HTML points at, its bytes as base64", () => {
    expect(
      AmazonSesMailProvider.buildRequest({
        mail: mail(),
        emailServer: SERVER,
        inlineImages: [LOGO],
      }).Content.Simple.Attachments,
    ).toEqual([
      {
        FileName: "oneuptime-logo.png",
        RawContent: LOGO.base64,
        ContentDisposition: "INLINE",
        ContentId: LOGO.contentId,
        ContentTransferEncoding: "BASE64",
        ContentType: "image/png",
      },
    ]);
  });

  test("an email whose HTML has no words goes without a text part", () => {
    expect(
      AmazonSesMailProvider.buildRequest({
        mail: mail({ body: "<div></div>" }),
        emailServer: SERVER,
        inlineImages: [],
      }).Content.Simple.Body.Text,
    ).toBeUndefined();
  });

  test("a sender's name in another script goes as RFC 2047 encoded words, as SES asks", () => {
    const request: AmazonSesSendEmailRequest =
      AmazonSesMailProvider.buildRequest({
        mail: mail(),
        emailServer: { ...SERVER, fromName: "Équipe d'astreinte" },
        inlineImages: [],
      });

    expect(request.FromEmailAddress).toMatch(
      /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <alerts@example\.test>$/,
    );
    expect(
      Buffer.from(
        request.FromEmailAddress.split("?")[3] as string,
        "base64",
      ).toString("utf8"),
    ).toBe("Équipe d'astreinte");
  });

  test("a name with a comma is quoted, so it stays one sender", () => {
    expect(
      AmazonSesMailProvider.buildRequest({
        mail: mail(),
        emailServer: { ...SERVER, fromName: "Acme, Inc." },
        inlineImages: [],
      }).FromEmailAddress,
    ).toBe('"Acme, Inc." <alerts@example.test>');
  });

  test("a line break in the subject cannot start a header", () => {
    expect(
      AmazonSesMailProvider.buildRequest({
        mail: mail({ subject: "Down\r\nBcc: someone@example.test" }),
        emailServer: SERVER,
        inlineImages: [],
      }).Content.Simple.Subject.Data,
    ).toBe("Down  Bcc: someone@example.test");
  });
});

describe("the Region it is sent to", () => {
  test.each([
    ["us-east-1", "email.us-east-1.amazonaws.com"],
    ["eu-central-2", "email.eu-central-2.amazonaws.com"],
    [" EU-WEST-1 ", "email.eu-west-1.amazonaws.com"],
    ["us-gov-west-1", "email.us-gov-west-1.amazonaws.com"],
    ["cn-north-1", "email.cn-north-1.amazonaws.com.cn"],
  ])("%s: %s", (region: string, host: string) => {
    expect(AmazonSesMailProvider.getHost(region)).toBe(host);
  });

  test.each([
    "us-east-1.evil.test",
    "evil.test/",
    "169.254.169.254",
    "us-east-1#",
    "../us-east-1",
    "localhost",
    "",
  ])("%j is refused: a Region is part of the host", (region: string) => {
    expect(() => {
      return AmazonSesMailProvider.getHost(region);
    }).toThrow("is not an AWS Region");
  });

  test("it signs for the service ses, at the v2 SendEmail path", () => {
    expect(AMAZON_SES_SIGNING_SERVICE).toBe("ses");
    expect(AMAZON_SES_SEND_EMAIL_PATH).toBe("/v2/email/outbound-emails");
  });
});

describe("SES's error, as AWS's REST-JSON protocol carries it", () => {
  test("its name from X-Amzn-ErrorType, without the namespace", () => {
    expect(
      AmazonSesMailProvider.readError(
        answer(
          400,
          { message: "Email address is not verified." },
          {
            "x-amzn-errortype":
              "MessageRejected:http://internal.amazon.com/coral/com.amazonaws.sesv2/",
          },
        ),
      ),
    ).toEqual({
      code: "MessageRejected",
      message: "Email address is not verified.",
    });
  });

  test("or from the body's __type, after the last #", () => {
    expect(
      AmazonSesMailProvider.readError(
        answer(403, {
          __type: "com.amazonaws.sesv2#AccessDeniedException",
          Message: "User is not authorized to perform ses:SendEmail",
        }),
      ),
    ).toEqual({
      code: "AccessDeniedException",
      message: "User is not authorized to perform ses:SendEmail",
    });
  });

  test("an answer that is not JSON is its own words", () => {
    expect(AmazonSesMailProvider.readError(answer(502, "Bad Gateway"))).toEqual(
      { code: "", message: "Bad Gateway" },
    );
  });
});

describe("what each refusal reads as", () => {
  const typed: (code: string) => Record<string, string> = (
    code: string,
  ): Record<string, string> => {
    return { "x-amzn-errortype": `${code}:http://internal.amazon.com/` };
  };

  test("an access key SES does not know", () => {
    const error: MailApiSendException = explain(
      403,
      { message: "The security token included in the request is invalid." },
      typed("UnrecognizedClientException"),
    );

    expect(error.message).toBe(
      "Amazon SES does not recognize the access key (HTTP 403 UnrecognizedClientException). Check the Access Key ID, and that the key is active in IAM. Amazon SES said: UnrecognizedClientException: The security token included in the request is invalid.",
    );
    expect(error.isRetryable).toBe(false);
    expect(error.statusCode).toBe(403);
  });

  test("a secret that is not the key's", () => {
    expect(
      explain(
        403,
        { message: "The request signature we calculated does not match." },
        typed("SignatureDoesNotMatch"),
      ).message,
    ).toContain(
      "Check that the Secret Access Key belongs to the Access Key ID, and that this server's clock is right.",
    );
  });

  test("a key without ses:SendEmail", () => {
    const error: MailApiSendException = explain(
      403,
      {
        message:
          "User: arn:aws:iam::123456789012:user/oneuptime is not authorized to perform: ses:SendEmail",
      },
      typed("AccessDeniedException"),
    );

    expect(error.message).toContain(
      "Allow ses:SendEmail on the sender's identity in the IAM user's or role's policy.",
    );
    expect(error.isRetryable).toBe(false);
  });

  test("an identity that is not verified - or, in the sandbox, a recipient", () => {
    const error: MailApiSendException = explain(
      400,
      {
        message:
          "Email address is not verified. The following identities failed the check in region EU-WEST-1: alerts@example.test",
      },
      typed("MessageRejected"),
    );

    expect(error.message).toBe(
      "Amazon SES needs a verified identity in eu-west-1 for alerts@example.test (HTTP 400 MessageRejected). Verify the address or its domain in that Region; while the account is in the SES sandbox, verify each recipient too, or request production access. Amazon SES said: MessageRejected: Email address is not verified. The following identities failed the check in region EU-WEST-1: alerts@example.test",
    );
    expect(error.isRetryable).toBe(false);
    expect(error.refusedInlineImages).toBe(false);
  });

  test.each([
    ["MailFromDomainNotVerifiedException", "MAIL FROM domain"],
    ["AccountSuspendedException", "suspended sending"],
    ["SendingPausedException", "Sending is paused"],
  ])("%s says what it is", (code: string, words: string) => {
    const error: MailApiSendException = explain(
      400,
      { message: "No." },
      typed(code),
    );

    expect(error.message).toContain(words);
    expect(error.isRetryable).toBe(false);
  });

  test("throttling is tried again, by its 429 or by its name on a 400", () => {
    expect(
      explain(
        429,
        { message: "Maximum sending rate exceeded." },
        typed("TooManyRequestsException"),
      ).isRetryable,
    ).toBe(true);
    expect(
      explain(400, { message: "Rate exceeded" }, typed("ThrottlingException"))
        .isRetryable,
    ).toBe(true);
  });

  test("the day's quota is not tried again: no retry this hour sends it", () => {
    const error: MailApiSendException = explain(
      400,
      { message: "Daily message quota exceeded." },
      typed("MessageRejected"),
    );

    expect(error.isRetryable).toBe(false);
    expect(error.message).toContain(
      "has sent all the email its Amazon SES quota allows today",
    );
  });

  test("SES's own failures are tried again, after the wait it asks for", () => {
    const error: MailApiSendException = explain(
      503,
      { message: "Service unavailable." },
      { "retry-after": "5", ...typed("ServiceUnavailable") },
    );

    expect(error.isRetryable).toBe(true);
    expect(error.retryAfterSeconds).toBe(5);
  });

  test("an email too large, with images, is refused for its images: it goes again without them", () => {
    expect(
      explain(
        413,
        { message: "Request too large" },
        typed("RequestEntityTooLargeException"),
        true,
      ).refusedInlineImages,
    ).toBe(true);
    expect(
      explain(
        400,
        { message: "Message length is more than 40 MB" },
        typed("MessageRejected"),
        true,
      ).refusedInlineImages,
    ).toBe(true);
    // Without images, there is nothing to leave out.
    expect(
      explain(413, { message: "Request too large" }, {}, false)
        .refusedInlineImages,
    ).toBe(false);
  });

  test("the secret never reaches the message, whatever SES echoes", () => {
    const error: MailApiSendException = explain(
      403,
      { message: `Bad secret ${CREDENTIALS.secretAccessKey}` },
      typed("SignatureDoesNotMatch"),
    );

    expect(error.message).not.toContain(CREDENTIALS.secretAccessKey);
    expect(error.message).toContain("[redacted]");
  });
});

describe("sending, to a stand-in for SES", () => {
  let ses: FakeAmazonSes;

  beforeAll(async () => {
    ses = await startFakeAmazonSes(CREDENTIALS);
  });

  afterAll(async () => {
    await ses.close();
  });

  beforeEach(() => {
    ses.requests.length = 0;
    sendAmazonSesTo(ses);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an email SES takes is sent once, signed for its Region", async () => {
    await new AmazonSesMailProvider().send(mail(), SERVER, {
      inlineImages: [LOGO],
    });

    expect(ses.requests).toHaveLength(1);

    const json: AmazonSesSendEmailJson = ses.requests[0]!
      .json as AmazonSesSendEmailJson;

    expect(json.Content.Simple.Attachments).toHaveLength(1);
    expect(String(ses.requests[0]!.headers.authorization)).toContain(
      "/eu-west-1/ses/aws4_request",
    );
  });

  test("throttled, it is tried again after SES's Retry-After, signed afresh, and goes", async () => {
    ses.answerNextWith({
      ...amazonSesError(429, "TooManyRequestsException", "Too many requests."),
      headers: {
        "x-amzn-ErrorType": "TooManyRequestsException:",
        "Retry-After": "0",
      },
    });

    await new AmazonSesMailProvider().send(mail(), SERVER, {});

    expect(ses.requests).toHaveLength(2);
    expect(ses.requests[0]!.body).toBe(ses.requests[1]!.body);
  });

  test("a refusal is reported at once, with SES's words", async () => {
    ses.answerNextWith(
      amazonSesError(
        400,
        "MessageRejected",
        "Email address is not verified. The following identities failed the check in region EU-WEST-1: alerts@example.test",
      ),
    );

    await expect(
      new AmazonSesMailProvider().send(mail(), SERVER, {}),
    ).rejects.toThrow("Amazon SES needs a verified identity in eu-west-1");
    expect(ses.requests).toHaveLength(1);
  });

  test("a config without its key or Region is refused before anything is sent", async () => {
    await expect(
      new AmazonSesMailProvider().send(
        mail(),
        { ...SERVER, awsSecretAccessKey: undefined },
        {},
      ),
    ).rejects.toThrow(
      "Amazon SES needs an Access Key ID, a Secret Access Key and a Region.",
    );
    expect(ses.requests).toHaveLength(0);
  });
});
