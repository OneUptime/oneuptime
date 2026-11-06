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
import PostmarkMailProvider, {
  POSTMARK_SEND_URL,
  PostmarkSendEmailRequest,
} from "../../FeatureSet/Notification/Services/MailProviders/PostmarkMailProvider";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import ObjectID from "Common/Types/ObjectID";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import {
  FakePostmark,
  postmarkError,
  sendPostmarkTo,
  startFakePostmark,
} from "./Fixtures/FakeMailServices";

/*
 * POSTMARK (PostmarkMailProvider): the Email API's JSON - From, To,
 * Subject, HtmlBody, TextBody and each inline image an attachment whose
 * ContentID is "cid:" and its id, as Postmark's examples write it - with
 * the server's API token in X-Postmark-Server-Token, and what each
 * ErrorCode Postmark answers with reads as in the Email Log.
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

const TOKEN: string = "11111111-2222-4333-8444-555555555555";

const SERVER: EmailServer = {
  id: ObjectID.generate(),
  transportType: MailTransportType.Postmark,
  username: undefined,
  password: undefined,
  fromEmail: new Email("alerts@example.test"),
  fromName: "Acme Alerts",
  apiKey: TOKEN,
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
  body: unknown,
  hadInlineImages: boolean = false,
): MailApiSendException {
  const answer: MailApiAnswer = {
    status: status,
    headers: new Headers(),
    bodyText: typeof body === "string" ? body : JSON.stringify(body),
  };

  return PostmarkMailProvider.explainError(answer, {
    fromEmail: "alerts@example.test",
    toEmail: "oncall@example.test",
    hadInlineImages: hadInlineImages,
    secrets: [TOKEN],
  });
}

describe("the email it writes", () => {
  test("From with its name, To, Subject, the HTML and its text; the image's ContentID is cid: and its id", () => {
    const request: PostmarkSendEmailRequest = PostmarkMailProvider.buildRequest(
      { mail: mail(), emailServer: SERVER, inlineImages: [LOGO] },
    );

    expect(request).toEqual({
      From: "Acme Alerts <alerts@example.test>",
      To: "oncall@example.test",
      Subject: "Incident #12 created",
      HtmlBody: mail().body,
      TextBody: expect.stringContaining("Checkout is down."),
      Attachments: [
        {
          Name: "oneuptime-logo.png",
          Content: LOGO.base64,
          ContentType: "image/png",
          ContentID: `cid:${LOGO.contentId}`,
        },
      ],
    });
  });

  test("it sends to the Email API", () => {
    expect(POSTMARK_SEND_URL).toBe("https://api.postmarkapp.com/email");
  });

  test("an email whose HTML has no words goes as HTML alone", () => {
    expect(
      PostmarkMailProvider.buildRequest({
        mail: { ...mail(), body: "<div></div>" },
        emailServer: SERVER,
        inlineImages: [],
      }).TextBody,
    ).toBeUndefined();
  });
});

describe("what each ErrorCode reads as", () => {
  test("a server token Postmark does not take (ErrorCode 10)", () => {
    const error: MailApiSendException = explain(401, {
      ErrorCode: 10,
      Message: "The Server Token you provided was invalid.",
    });

    expect(error.message).toBe(
      "Postmark did not accept the server API token (HTTP 401, ErrorCode 10). Copy the token from the server's API Tokens tab in Postmark; an account token does not send. Postmark said: The Server Token you provided was invalid.",
    );
    expect(error.isRetryable).toBe(false);
  });

  test("a From address that is not a confirmed sender signature", () => {
    expect(
      explain(422, {
        ErrorCode: 400,
        Message:
          "The 'From' address you supplied (alerts@example.test) is not a Sender Signature on your account. Please add and confirm this address in order to be able to use it in the 'From' field of your messages.",
      }).message,
    ).toContain(
      "alerts@example.test is not a confirmed sender signature in Postmark",
    );
  });

  test("an inactive recipient (ErrorCode 406) is the recipient's, not the setup's", () => {
    expect(
      explain(422, {
        ErrorCode: 406,
        Message:
          "You tried to send to recipient(s) that have been marked as inactive.",
      }).message,
    ).toContain(
      "Postmark will not send to oncall@example.test: it is marked inactive after a hard bounce or a spam complaint",
    );
  });

  test("an account waiting for approval (ErrorCode 412)", () => {
    expect(
      explain(422, { ErrorCode: 412, Message: "Account pending approval" })
        .message,
    ).toContain("The Postmark account is waiting for approval");
  });

  test("throttling and Postmark's own failures are tried again; a refusal is not", () => {
    expect(
      explain(429, { ErrorCode: 429, Message: "Rate limit" }).isRetryable,
    ).toBe(true);
    expect(
      explain(503, { ErrorCode: 100, Message: "Maintenance" }).isRetryable,
    ).toBe(true);
    expect(
      explain(422, { ErrorCode: 300, Message: "Invalid 'To' address" })
        .isRetryable,
    ).toBe(false);
  });

  test("an attachment Postmark will not send, or an email too large, is refused for its images", () => {
    expect(
      explain(413, "Request Entity Too Large", true).refusedInlineImages,
    ).toBe(true);
    expect(
      explain(
        422,
        { ErrorCode: 411, Message: "Forbidden attachment type" },
        true,
      ).refusedInlineImages,
    ).toBe(true);
    expect(
      explain(422, { ErrorCode: 300, Message: "Invalid 'To' address" }, true)
        .refusedInlineImages,
    ).toBe(false);
  });

  test("the token never reaches the message", () => {
    expect(
      explain(401, { ErrorCode: 10, Message: `Bad token ${TOKEN}` }).message,
    ).not.toContain(TOKEN);
  });

  test("the ErrorCode is read from X-PM-ApiErrorCode when the body has none", () => {
    expect(
      PostmarkMailProvider.readError({
        status: 422,
        headers: new Headers({ "X-PM-ApiErrorCode": "406" }),
        bodyText: "",
      }).errorCode,
    ).toBe(406);
  });
});

describe("sending, to a stand-in for Postmark", () => {
  let postmark: FakePostmark;

  beforeAll(async () => {
    postmark = await startFakePostmark(TOKEN);
  });

  afterAll(async () => {
    await postmark.close();
  });

  beforeEach(() => {
    postmark.requests.length = 0;
    sendPostmarkTo(postmark);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an email Postmark takes is sent once, with the JSON headers it asks for", async () => {
    await new PostmarkMailProvider().send(mail(), SERVER, {
      inlineImages: [LOGO],
    });

    expect(postmark.requests).toHaveLength(1);
    expect(postmark.requests[0]!.headers["x-postmark-server-token"]).toBe(
      TOKEN,
    );
    expect(postmark.requests[0]!.headers.accept).toBe("application/json");
  });

  test("a 200 that carries an ErrorCode is a refusal, not a send", async () => {
    postmark.answerNextWith({
      status: 200,
      body: { ErrorCode: 406, Message: "Inactive recipient" },
    });

    await expect(
      new PostmarkMailProvider().send(mail(), SERVER, {}),
    ).rejects.toThrow("Postmark will not send to oncall@example.test");
  });

  test("throttled, it is tried again and goes", async () => {
    postmark.answerNextWith({
      status: 429,
      body: { ErrorCode: 429, Message: "Rate limit exceeded" },
      headers: { "Retry-After": "0" },
    });

    await new PostmarkMailProvider().send(mail(), SERVER, {});

    expect(postmark.requests).toHaveLength(2);
  });

  test("a refusal is reported at once", async () => {
    postmark.answerNextWith(
      postmarkError(300, "Invalid 'To' address: 'oncall@example.test'."),
    );

    await expect(
      new PostmarkMailProvider().send(mail(), SERVER, {}),
    ).rejects.toThrow("Postmark refused the email (HTTP 422, ErrorCode 300).");
    expect(postmark.requests).toHaveLength(1);
  });

  test("a config without its token is refused before anything is sent", async () => {
    await expect(
      new PostmarkMailProvider().send(
        mail(),
        { ...SERVER, apiKey: undefined },
        {},
      ),
    ).rejects.toThrow("Postmark needs a Server API Token.");
    expect(postmark.requests).toHaveLength(0);
  });
});
