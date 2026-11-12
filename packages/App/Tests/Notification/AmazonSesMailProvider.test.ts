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
  AMAZON_SES_CREDENTIAL_REFUSAL_CODES,
  AMAZON_SES_SEND_EMAIL_PATH,
  AMAZON_SES_SIGNING_SERVICE,
  AmazonSesSendEmailRequest,
} from "../../FeatureSet/Notification/Services/MailProviders/AmazonSesMailProvider";
import HttpMailApi, {
  MailApiAnswer,
  MailApiSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/HttpMailApi";
import Email from "Common/Types/Email";
import AmazonSesAuthenticationType from "Common/Types/Email/AmazonSesAuthenticationType";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import ObjectID from "Common/Types/ObjectID";
import AwsDefaultCredentialChain, {
  AwsChainHttpRequest,
  AwsChainHttpResponse,
} from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import { EmailInlineImage } from "Common/Server/Utils/Mail/EmailInlineImages";
import {
  AmazonSesSendEmailJson,
  FakeAmazonSes,
  FakeAmazonSesKeys,
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

/*
 * SIGNING IN AS THIS SERVER'S IAM ROLE (#7000): the server's own settings
 * can send with the short-lived credentials AWS gives the server - here the
 * EKS Pod Identity agent's, through the real credential chain - signed with
 * their session token. SES refusing them drops them for new ones; a
 * project's config may never sign in as the server.
 */

const ROLE_KEYS: Array<FakeAmazonSesKeys> = [
  {
    accessKeyId: "ASIAROLEFIRSTEXAMPLE",
    secretAccessKey: "firstRoleSecretKeyEXAMPLE0123456789abcd",
    sessionToken: "IQoJb3JpZ2luX2VjEFirstSessionTokenEXAMPLE",
  },
  {
    accessKeyId: "ASIAROLESECONDEXAMPL",
    secretAccessKey: "secondRoleSecretKeyEXAMPLE0123456789abc",
    sessionToken: "IQoJb3JpZ2luX2VjESecondSessionTokenEXAMPLE",
  },
];

const FIRST_KEYS: FakeAmazonSesKeys = ROLE_KEYS[0] as FakeAmazonSesKeys;
const NEXT_KEYS: FakeAmazonSesKeys = ROLE_KEYS[1] as FakeAmazonSesKeys;

const POD_IDENTITY_TOKEN: string = "eks-pod-identity-authorization-token";

// The server's own Amazon SES settings, signing in with its IAM role: no key.
const ROLE_SERVER: EmailServer = {
  transportType: MailTransportType.AmazonSES,
  username: undefined,
  password: undefined,
  fromEmail: new Email("alerts@example.test"),
  fromName: "Acme Alerts",
  awsAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
  awsRegion: "eu-west-1",
};

interface PodIdentityChain {
  chain: AwsDefaultCredentialChain;
  // Every request the chain made to the Pod Identity agent.
  asked: Array<AwsChainHttpRequest>;
}

/*
 * A chain that gets the role's credentials from the EKS Pod Identity agent,
 * which hands out `keys` in turn, each for an hour.
 */
function podIdentityChain(keys: Array<FakeAmazonSesKeys>): PodIdentityChain {
  const asked: Array<AwsChainHttpRequest> = [];

  const chain: AwsDefaultCredentialChain = new AwsDefaultCredentialChain({
    env: {
      AWS_CONTAINER_CREDENTIALS_FULL_URI:
        "http://169.254.170.23/v1/credentials",
      AWS_CONTAINER_AUTHORIZATION_TOKEN: POD_IDENTITY_TOKEN,
    },
    httpClient: async (
      request: AwsChainHttpRequest,
    ): Promise<AwsChainHttpResponse> => {
      const handedOut: FakeAmazonSesKeys = keys[
        Math.min(asked.length, keys.length - 1)
      ] as FakeAmazonSesKeys;

      asked.push(request);

      return {
        status: 200,
        bodyText: JSON.stringify({
          AccessKeyId: handedOut.accessKeyId,
          SecretAccessKey: handedOut.secretAccessKey,
          Token: handedOut.sessionToken,
          Expiration: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        }),
      };
    },
  });

  return { chain: chain, asked: asked };
}

// A send's failure, to look at what it says.
async function failureOf(send: Promise<void>): Promise<Error> {
  try {
    await send;
  } catch (error) {
    return error as Error;
  }

  throw new Error("The send went through.");
}

describe("signing in as this server's IAM role, to a stand-in for SES", () => {
  let ses: FakeAmazonSes;

  beforeEach(async () => {
    // SES knows the role's first and next credentials, as AWS would.
    ses = await startFakeAmazonSes({ ...FIRST_KEYS, region: "eu-west-1" });
    ses.acceptKeys(NEXT_KEYS);
    sendAmazonSesTo(ses);
    // A retry goes at once: what is tested is what it is signed with.
    jest
      .spyOn(
        HttpMailApi as unknown as { sleep: (ms: number) => Promise<void> },
        "sleep",
      )
      .mockResolvedValue(undefined);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await ses.close();
  });

  test("the email is signed with the role's credentials and their session token, asked of the Pod Identity agent", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);

    await new AmazonSesMailProvider({ credentialChain: pod.chain }).send(
      mail(),
      ROLE_SERVER,
      { inlineImages: [LOGO] },
    );

    expect(ses.requests).toHaveLength(1);

    const authorization: string = String(
      ses.requests[0]!.headers.authorization,
    );

    expect(authorization).toContain(`Credential=${FIRST_KEYS.accessKeyId}/`);
    expect(authorization).toContain("/eu-west-1/ses/aws4_request");
    // The token is sent, and signed: SES would refuse it otherwise.
    expect(ses.requests[0]!.headers["x-amz-security-token"]).toBe(
      FIRST_KEYS.sessionToken,
    );
    expect(authorization).toContain("x-amz-security-token");

    expect(pod.asked).toHaveLength(1);
    expect(pod.asked[0]!.method).toBe("GET");
    expect(pod.asked[0]!.url).toBe("http://169.254.170.23/v1/credentials");
    expect(pod.asked[0]!.headers["Authorization"]).toBe(POD_IDENTITY_TOKEN);
  });

  test("the credentials in hand sign the next emails too: the agent is asked once", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider({
      credentialChain: pod.chain,
    });

    await provider.send(mail(), ROLE_SERVER, {});
    await provider.send(
      mail({ subject: "Incident #13 created" }),
      ROLE_SERVER,
      {},
    );
    await provider.send(
      mail({ subject: "Incident #14 created" }),
      ROLE_SERVER,
      {},
    );

    expect(ses.requests).toHaveLength(3);
    expect(pod.asked).toHaveLength(1);
  });

  test("credentials SES says expired are dropped: new ones are fetched, and the email goes on the next try", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);

    ses.expireKeys(FIRST_KEYS.accessKeyId);

    await new AmazonSesMailProvider({ credentialChain: pod.chain }).send(
      mail(),
      ROLE_SERVER,
      {},
    );

    expect(ses.requests).toHaveLength(2);
    expect(String(ses.requests[0]!.headers.authorization)).toContain(
      `Credential=${FIRST_KEYS.accessKeyId}/`,
    );
    expect(String(ses.requests[1]!.headers.authorization)).toContain(
      `Credential=${NEXT_KEYS.accessKeyId}/`,
    );
    expect(ses.requests[1]!.headers["x-amz-security-token"]).toBe(
      NEXT_KEYS.sessionToken,
    );
    // The same email, signed afresh with the new credentials.
    expect(ses.requests[1]!.body).toBe(ses.requests[0]!.body);
    expect(pod.asked).toHaveLength(2);
  });

  test("credentials SES does not recognize are dropped too: the next email fetches new ones", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider({
      credentialChain: pod.chain,
    });

    ses.answerNextWith(
      amazonSesError(
        403,
        "UnrecognizedClientException",
        "The security token included in the request is invalid.",
      ),
    );

    const error: Error = await failureOf(
      provider.send(mail(), ROLE_SERVER, {}),
    );

    expect(error.message).toContain(
      "Amazon SES does not recognize this server's IAM role credentials (HTTP 403 UnrecognizedClientException).",
    );
    expect(error.message).not.toContain("Access Key ID");

    await provider.send(mail(), ROLE_SERVER, {});

    expect(pod.asked).toHaveLength(2);
    expect(String(ses.requests[1]!.headers.authorization)).toContain(
      `Credential=${NEXT_KEYS.accessKeyId}/`,
    );
  });

  test("a role that may not send reads as the role's policy, and never shows its secret or token", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);

    ses.answerNextWith(
      amazonSesError(
        403,
        "AccessDeniedException",
        `User: arn:aws:sts::123456789012:assumed-role/oneuptime-ses/eks-pod is not authorized to perform: ses:SendEmail (token ${FIRST_KEYS.sessionToken}, secret ${FIRST_KEYS.secretAccessKey})`,
      ),
    );

    const error: Error = await failureOf(
      new AmazonSesMailProvider({ credentialChain: pod.chain }).send(
        mail(),
        ROLE_SERVER,
        {},
      ),
    );

    expect(error).toBeInstanceOf(MailApiSendException);
    expect((error as MailApiSendException).isRetryable).toBe(false);
    expect(error.message).toContain(
      "This server's IAM role may not send with Amazon SES (HTTP 403 AccessDeniedException). Allow ses:SendEmail on the sender's identity in the role's policy.",
    );
    expect(error.message).not.toContain(String(FIRST_KEYS.sessionToken));
    expect(error.message).not.toContain(FIRST_KEYS.secretAccessKey);
    expect(error.message).toContain("[redacted]");
  });

  test("a project's config is refused if it asks for the server's role, before any credentials are fetched", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider({
      credentialChain: pod.chain,
    });

    for (const projectConfig of [
      { ...ROLE_SERVER, id: ObjectID.generate() },
      // An access key beside it changes nothing: the config asked for the role.
      {
        ...ROLE_SERVER,
        id: ObjectID.generate(),
        awsAccessKeyId: CREDENTIALS.accessKeyId,
        awsSecretAccessKey: CREDENTIALS.secretAccessKey,
      },
    ]) {
      await expect(provider.send(mail(), projectConfig, {})).rejects.toThrow(
        "A project's Amazon SES config signs in with an access key. Only this server's own email settings may sign in with its IAM role.",
      );
    }

    expect(pod.asked).toHaveLength(0);
    expect(ses.requests).toHaveLength(0);
  });

  test("without a Region it is refused before anything is asked", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);

    await expect(
      new AmazonSesMailProvider({ credentialChain: pod.chain }).send(
        mail(),
        { ...ROLE_SERVER, awsRegion: undefined },
        {},
      ),
    ).rejects.toThrow(
      "Amazon SES needs a Region to sign in with this server's IAM role.",
    );
    expect(pod.asked).toHaveLength(0);
    expect(ses.requests).toHaveLength(0);
  });

  test("a server with no AWS credentials is told what to give it, and the email is not tried again", async () => {
    const asked: Array<AwsChainHttpRequest> = [];
    const chain: AwsDefaultCredentialChain = new AwsDefaultCredentialChain({
      env: { AWS_EC2_METADATA_DISABLED: "true" },
      httpClient: async (
        request: AwsChainHttpRequest,
      ): Promise<AwsChainHttpResponse> => {
        asked.push(request);
        return { status: 500, bodyText: "" };
      },
    });

    const error: Error = await failureOf(
      new AmazonSesMailProvider({ credentialChain: chain }).send(
        mail(),
        ROLE_SERVER,
        {},
      ),
    );

    expect(error).toBeInstanceOf(MailApiSendException);
    expect((error as MailApiSendException).isRetryable).toBe(false);
    expect(error.message).toBe(
      "Amazon SES could not sign in with this server's IAM role. This server has no AWS credentials. Give it an IAM role: IAM roles for service accounts or EKS Pod Identity on Amazon EKS, a task role on Amazon ECS, or an instance profile on Amazon EC2.",
    );
    expect(asked).toHaveLength(0);
    expect(ses.requests).toHaveLength(0);
  });

  test("an agent that does not give credentials is asked again on each try, then reported with what it said", async () => {
    let calls: number = 0;
    const chain: AwsDefaultCredentialChain = new AwsDefaultCredentialChain({
      env: {
        AWS_CONTAINER_CREDENTIALS_RELATIVE_URI: "/v2/credentials/task-role",
      },
      httpClient: async (): Promise<AwsChainHttpResponse> => {
        calls++;
        return { status: 503, bodyText: "agent restarting" };
      },
    });

    const error: Error = await failureOf(
      new AmazonSesMailProvider({ credentialChain: chain }).send(
        mail(),
        ROLE_SERVER,
        {},
      ),
    );

    expect(error.message).toBe(
      "Amazon SES could not sign in with this server's IAM role. The Amazon ECS credentials endpoint (169.254.170.2) refused to give this server credentials (HTTP 503). It said: agent restarting.",
    );
    expect((error as MailApiSendException).isRetryable).toBe(true);
    expect(calls).toBe(HttpMailApi.MAX_ATTEMPTS);
    expect(ses.requests).toHaveLength(0);
  });

  test("an access key config is as it was: signed with its key, nothing asked of the server's role", async () => {
    const pod: PodIdentityChain = podIdentityChain(ROLE_KEYS);
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider({
      credentialChain: pod.chain,
    });

    ses.acceptKeys({
      accessKeyId: CREDENTIALS.accessKeyId,
      secretAccessKey: CREDENTIALS.secretAccessKey,
    });

    await provider.send(mail(), SERVER, {});
    // Whatever else the field holds reads as the access key it always was.
    await provider.send(
      mail(),
      {
        ...SERVER,
        awsAuthenticationType: "IAM Role" as AmazonSesAuthenticationType,
      },
      {},
    );
    await provider.send(
      mail(),
      {
        ...SERVER,
        awsAuthenticationType: AmazonSesAuthenticationType.AccessKey,
      },
      {},
    );

    expect(ses.requests).toHaveLength(3);

    for (const request of ses.requests) {
      expect(String(request.headers.authorization)).toContain(
        `Credential=${CREDENTIALS.accessKeyId}/`,
      );
      expect(request.headers["x-amz-security-token"]).toBeUndefined();
    }

    expect(pod.asked).toHaveLength(0);
  });
});

describe("what a refusal says, signed in as the server's IAM role", () => {
  function explainForRole(
    status: number,
    code: string,
    message: string,
  ): MailApiSendException {
    return AmazonSesMailProvider.explainError(
      answer(status, { message: message }, { "x-amzn-ErrorType": `${code}:` }),
      {
        region: "eu-west-1",
        fromEmail: "alerts@example.test",
        hadInlineImages: false,
        signsInWith: AmazonSesAuthenticationType.ServerIamRole,
        secrets: [FIRST_KEYS.secretAccessKey, FIRST_KEYS.sessionToken],
      },
    );
  }

  test("each credential refusal names the role, never an access key the server does not have", () => {
    for (const [code, meaning] of [
      [
        "UnrecognizedClientException",
        "Amazon SES does not recognize this server's IAM role credentials (HTTP 403 UnrecognizedClientException). New ones are fetched for the next email; if this goes on, check the IAM role this server runs as.",
      ],
      [
        "InvalidClientTokenId",
        "Amazon SES does not recognize this server's IAM role credentials (HTTP 403 InvalidClientTokenId).",
      ],
      [
        "SignatureDoesNotMatch",
        "Amazon SES did not accept the request's signature (HTTP 403 SignatureDoesNotMatch). Check that this server's clock is right.",
      ],
      [
        "AccessDeniedException",
        "This server's IAM role may not send with Amazon SES (HTTP 403 AccessDeniedException).",
      ],
      [
        "ExpiredTokenException",
        "This server's IAM role credentials expired before Amazon SES read them (HTTP 403 ExpiredTokenException). New ones are fetched for the next try.",
      ],
    ] as Array<[string, string]>) {
      const error: MailApiSendException = explainForRole(403, code, "No.");

      expect(error.message).toContain(meaning);
      expect(error.message.toLowerCase()).not.toContain("access key");
    }
  });

  test("expired credentials are tried again as the role - an access key that expired is not", () => {
    expect(
      explainForRole(403, "ExpiredTokenException", "expired").isRetryable,
    ).toBe(true);
    expect(explainForRole(400, "ExpiredToken", "expired").isRetryable).toBe(
      true,
    );
    expect(
      explain(
        403,
        { message: "expired" },
        { "x-amzn-ErrorType": "ExpiredTokenException:" },
      ).isRetryable,
    ).toBe(false);
  });

  test("the refusals that drop the credentials in hand are SES's words for credentials it does not take", () => {
    expect([...AMAZON_SES_CREDENTIAL_REFUSAL_CODES].sort()).toEqual(
      [
        "ExpiredToken",
        "ExpiredTokenException",
        "InvalidClientTokenId",
        "UnrecognizedClientException",
      ].sort(),
    );
  });

  test("whatever SES echoes, the role's secret and session token are never in the message", () => {
    const error: MailApiSendException = explainForRole(
      400,
      "MessageRejected",
      `echo ${FIRST_KEYS.sessionToken} and ${FIRST_KEYS.secretAccessKey}`,
    );

    expect(error.message).not.toContain(String(FIRST_KEYS.sessionToken));
    expect(error.message).not.toContain(FIRST_KEYS.secretAccessKey);
  });
});
