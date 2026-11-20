import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AmazonSesMailProvider from "../../FeatureSet/Notification/Services/MailProviders/AmazonSesMailProvider";
import HttpMailApi, {
  MailApiSendException,
} from "../../FeatureSet/Notification/Services/MailProviders/HttpMailApi";
import MailService from "../../FeatureSet/Notification/Services/MailService";
import Email from "Common/Types/Email";
import AmazonSesAuthenticationType from "Common/Types/Email/AmazonSesAuthenticationType";
import {
  AMAZON_SES_ROLE_CONFIG_INCOMPLETE,
  AMAZON_SES_ROLE_IN_SERVER_ACCOUNT,
  AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
} from "Common/Types/Email/AmazonSesRoleWords";
import { getAwsSesExternalIdForProject } from "Common/Types/Email/AmazonSesRoleExternalId";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import AwsDefaultCredentialChain from "Common/Server/Utils/Aws/AwsDefaultCredentialChain";
import AwsServerIdentity from "Common/Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { AssumedRoleCache } from "Common/Server/Utils/CloudConnection/Aws/AwsSts";
import AmazonSesProjectRole from "Common/Server/Utils/Mail/AmazonSesProjectRole";
import {
  FAKE_ONEUPTIME_ACCOUNT,
  FAKE_ONEUPTIME_PRINCIPAL_ARN,
  FakeSts,
  FakeStsRole,
  createFakeSts,
} from "Common/Tests/Server/Utils/Mail/FakeSesRoleSts";
import {
  FakeAmazonSes,
  FakeAmazonSesKeys,
  amazonSesError,
  sendAmazonSesTo,
  startFakeAmazonSes,
} from "./Fixtures/FakeMailServices";

/*
 * A PROJECT'S AMAZON SES CONFIG SENDING THROUGH AN IAM ROLE IN ITS OWN AWS
 * ACCOUNT (#7378), end to end: the real AmazonSesMailProvider signs in to
 * the role through a stand-in for STS (AmazonSesProjectRole, AwsSts) and
 * sends to the stand-in for SES, which checks each request's signature and
 * session token against the sessions STS handed out (acceptKeys,
 * expireKeys). The server's own IAM role stays refused to a project's
 * config, as AmazonSesMailProvider.test pins.
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

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const CONFIG: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const ROLE_ARN: string = "arn:aws:iam::210987654321:role/OneUptimeSes";
const REGION: string = "eu-west-1";

// The sessions the stand-in for STS hands out, in turn (FakeSesRoleSts).
function sessionKeys(number: number): FakeAmazonSesKeys {
  return {
    accessKeyId: `ASIASESSION${String(number).padStart(9, "0")}`,
    secretAccessKey: `sessionSecret${number}EXAMPLEabcdefghijklmnop`,
    sessionToken: `IQoJb3JpZ2luSessionToken${number}EXAMPLE`,
  };
}

const FIRST_SESSION: FakeAmazonSesKeys = sessionKeys(1);
const SECOND_SESSION: FakeAmazonSesKeys = sessionKeys(2);

// A project's config signing in with the IAM role in its own account: no key.
const ROLE_CONFIG: EmailServer = {
  id: CONFIG,
  transportType: MailTransportType.AmazonSES,
  username: undefined,
  password: undefined,
  fromEmail: new Email("alerts@example.test"),
  fromName: "Acme Alerts",
  awsRegion: REGION,
  awsRoleArn: ROLE_ARN,
  awsRoleProjectId: PROJECT,
};

function mail(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    toEmail: new Email("oncall@example.test"),
    subject: "Incident #12 created",
    body: "<p>Checkout is down.</p>",
    vars: {},
    ...overrides,
  };
}

async function failureOf(send: Promise<void>): Promise<MailApiSendException> {
  try {
    await send;
  } catch (error) {
    expect(error).toBeInstanceOf(MailApiSendException);
    return error as MailApiSendException;
  }

  throw new Error("The send went through.");
}

let ses: FakeAmazonSes;
let sts: FakeSts;

// The stand-in for STS, the project's role trusting its email external id.
function useSts(
  roles: Array<FakeStsRole> = [
    { arn: ROLE_ARN, trusts: [getAwsSesExternalIdForProject(PROJECT)] },
  ],
): FakeSts {
  sts = createFakeSts({ roles });
  AmazonSesProjectRole.useTransport(sts.transport, async (): Promise<void> => {
    return;
  });

  return sts;
}

beforeEach(async () => {
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
    "oneuptime-server-secret";
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
  AwsServerIdentity.useCredentialChain(
    new AwsDefaultCredentialChain({
      env: { AWS_EC2_METADATA_DISABLED: "true" },
    }),
  );

  // SES knows each session STS will hand out, as AWS would.
  ses = await startFakeAmazonSes({ ...FIRST_SESSION, region: REGION });
  ses.acceptKeys(SECOND_SESSION);
  sendAmazonSesTo(ses);
  useSts();

  // A retry goes at once: what is tested is what it is signed with.
  jest
    .spyOn(
      HttpMailApi as unknown as { sleep: (ms: number) => Promise<void> },
      "sleep",
    )
    .mockResolvedValue(undefined);
});

afterEach(async () => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AmazonSesProjectRole.useTransport(null);
  AwsServerIdentity.useCredentialChain(null);
  AwsServerIdentity.clearCache();
  AssumedRoleCache.clear();
  jest.restoreAllMocks();
  await ses.close();
});

describe("sending through a project's IAM role, to stand-ins for STS and SES", () => {
  test("the email is signed with the role's session and its token, once the role is checked", async () => {
    await new AmazonSesMailProvider().send(mail(), ROLE_CONFIG, {});

    // The role's check, then the sign-in with the project's email external id.
    expect(sts.assumeRoles).toHaveLength(2);
    expect(sts.assumeRoles[1]!.externalId).toBe(
      getAwsSesExternalIdForProject(PROJECT),
    );

    expect(ses.requests).toHaveLength(1);

    const authorization: string = String(
      ses.requests[0]!.headers.authorization,
    );

    expect(authorization).toContain(`Credential=${FIRST_SESSION.accessKeyId}/`);
    expect(authorization).toContain(`/${REGION}/ses/aws4_request`);
    // The token is sent, and signed: SES would refuse it otherwise.
    expect(ses.requests[0]!.headers["x-amz-security-token"]).toBe(
      FIRST_SESSION.sessionToken,
    );
    expect(authorization).toContain("x-amz-security-token");
  });

  test("the session in hand signs the config's next emails: the role is signed in to once", async () => {
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider();

    await provider.send(mail(), ROLE_CONFIG, {});
    await provider.send(mail({ subject: "Incident #13" }), ROLE_CONFIG, {});
    await provider.send(mail({ subject: "Incident #14" }), ROLE_CONFIG, {});

    expect(ses.requests).toHaveLength(3);
    expect(sts.assumeRoles).toHaveLength(2);
  });

  test("a session SES says expired is dropped: the role is signed in to again, and the email goes on the next try", async () => {
    ses.expireKeys(FIRST_SESSION.accessKeyId);

    await new AmazonSesMailProvider().send(mail(), ROLE_CONFIG, {});

    expect(ses.requests).toHaveLength(2);
    expect(String(ses.requests[1]!.headers.authorization)).toContain(
      `Credential=${SECOND_SESSION.accessKeyId}/`,
    );
    expect(ses.requests[1]!.headers["x-amz-security-token"]).toBe(
      SECOND_SESSION.sessionToken,
    );
    // The same email, signed afresh; signed in again, and not checked again.
    expect(ses.requests[1]!.body).toBe(ses.requests[0]!.body);
    expect(sts.assumeRoles).toHaveLength(3);
    expect(sts.assumeRoles[2]!.externalId).toBe(
      getAwsSesExternalIdForProject(PROJECT),
    );
  });

  test("a session SES does not recognize is dropped too: the next email signs in again", async () => {
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider();

    ses.answerNextWith(
      amazonSesError(
        403,
        "UnrecognizedClientException",
        "The security token included in the request is invalid.",
      ),
    );

    const failure: MailApiSendException = await failureOf(
      provider.send(mail(), ROLE_CONFIG, {}),
    );

    expect(failure.message).toContain(
      "Amazon SES does not recognize the credentials of this config's IAM role (HTTP 403 UnrecognizedClientException).",
    );
    expect(failure.message).not.toContain("Access Key ID");

    await provider.send(mail(), ROLE_CONFIG, {});

    expect(
      String(ses.requests[ses.requests.length - 1]!.headers.authorization),
    ).toContain(
      `Credential=${SECOND_SESSION.accessKeyId}/`,
    );
  });

  test("a role that may not send reads as the role's policy, and never shows its secret or token", async () => {
    ses.answerNextWith(
      amazonSesError(
        403,
        "AccessDeniedException",
        `User: ${ROLE_ARN.replace(":iam::", ":sts::")}/OneUptime is not authorized to perform: ses:SendEmail (token ${FIRST_SESSION.sessionToken}, secret ${FIRST_SESSION.secretAccessKey})`,
      ),
    );

    const failure: MailApiSendException = await failureOf(
      new AmazonSesMailProvider().send(mail(), ROLE_CONFIG, {}),
    );

    expect(failure.isRetryable).toBe(false);
    expect(failure.message).toContain(
      "This config's IAM role may not send with Amazon SES (HTTP 403 AccessDeniedException). Allow ses:SendEmail on the sender's identity in the role's policy.",
    );
    expect(failure.message).not.toContain(String(FIRST_SESSION.sessionToken));
    expect(failure.message).not.toContain(FIRST_SESSION.secretAccessKey);
    expect(failure.message).toContain("[redacted]");
  });

  test("a role that lets any external ID in sends nothing, and says why in OneUptime's words", async () => {
    useSts([{ arn: ROLE_ARN, trusts: "any" }]);

    const failure: MailApiSendException = await failureOf(
      new AmazonSesMailProvider().send(mail(), ROLE_CONFIG, {}),
    );

    expect(failure.message).toBe(AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID);
    expect(failure.isRetryable).toBe(false);
    // The check alone, never tried again: the session it was handed is never used.
    expect(sts.assumeRoles).toHaveLength(1);
    expect(ses.requests).toHaveLength(0);
  });

  test("a role in OneUptime's own AWS account sends nothing, and is never signed in to", async () => {
    const operatorRole: string = `arn:aws:iam::${FAKE_ONEUPTIME_ACCOUNT}:role/OperatorSes`;

    useSts([{ arn: operatorRole, trusts: "any" }]);

    const failure: MailApiSendException = await failureOf(
      new AmazonSesMailProvider().send(
        mail(),
        { ...ROLE_CONFIG, awsRoleArn: operatorRole },
        {},
      ),
    );

    expect(failure.message).toBe(AMAZON_SES_ROLE_IN_SERVER_ACCOUNT);
    expect(failure.message).not.toContain(FAKE_ONEUPTIME_ACCOUNT);
    expect(sts.assumeRoles).toHaveLength(0);
    expect(ses.requests).toHaveLength(0);
  });

  test("AWS's refusal of the sign-in, which names OneUptime's identity, never reaches the Email Log", async () => {
    useSts([{ arn: ROLE_ARN, trusts: ["oneuptime-some-other-id"] }]);

    const failure: MailApiSendException = await failureOf(
      new AmazonSesMailProvider().send(mail(), ROLE_CONFIG, {}),
    );

    expect(failure.message).not.toContain(FAKE_ONEUPTIME_PRINCIPAL_ARN);
    expect(failure.message).not.toContain("is not authorized");
    expect(failure.message).not.toContain("oneuptime-server-secret");
    expect(failure.isRetryable).toBe(false);
    expect(ses.requests).toHaveLength(0);
  });

  test("a project's config that asks for the server's own role is still refused, a role ARN beside it or not", async () => {
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider();

    for (const config of [
      {
        ...ROLE_CONFIG,
        awsAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      },
      {
        ...ROLE_CONFIG,
        awsRoleArn: undefined,
        awsAuthenticationType: AmazonSesAuthenticationType.ServerIamRole,
      },
    ]) {
      await expect(provider.send(mail(), config, {})).rejects.toThrow(
        "A project's Amazon SES config signs in with an access key. Only this server's own email settings may sign in with its IAM role.",
      );
    }

    expect(sts.actions).toEqual([]);
    expect(ses.requests).toHaveLength(0);
  });

  test("a role sent without its config, its project or its Region is refused before anything is asked", async () => {
    const provider: AmazonSesMailProvider = new AmazonSesMailProvider();

    for (const config of [
      { ...ROLE_CONFIG, id: undefined },
      { ...ROLE_CONFIG, awsRoleProjectId: undefined },
      { ...ROLE_CONFIG, awsRoleProjectId: " " },
      { ...ROLE_CONFIG, awsRegion: undefined },
    ]) {
      await expect(provider.send(mail(), config, {})).rejects.toThrow(
        AMAZON_SES_ROLE_CONFIG_INCOMPLETE,
      );
    }

    expect(sts.actions).toEqual([]);
    expect(ses.requests).toHaveLength(0);
  });

  test("an access key config is as it was: signed with its key, nothing asked of STS", async () => {
    ses.acceptKeys({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    });

    await new AmazonSesMailProvider().send(
      mail(),
      {
        ...ROLE_CONFIG,
        awsRoleArn: undefined,
        awsRoleProjectId: undefined,
        awsAccessKeyId: "AKIAIOSFODNN7EXAMPLE",
        awsSecretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      },
      {},
    );

    expect(ses.requests).toHaveLength(1);
    expect(String(ses.requests[0]!.headers.authorization)).toContain(
      "Credential=AKIAIOSFODNN7EXAMPLE/",
    );
    expect(ses.requests[0]!.headers["x-amz-security-token"]).toBeUndefined();
    expect(sts.actions).toEqual([]);
  });
});

describe("the role, from the app to the notification service (MailService.getEmailServer)", () => {
  // The body Common's MailService.sendMail posts for a role config.
  const body: JSONObject = {
    SMTP_ID: CONFIG.toString(),
    SMTP_TRANSPORT_TYPE: MailTransportType.AmazonSES,
    SMTP_EMAIL: "alerts@example.test",
    SMTP_FROM_NAME: "Acme Alerts",
    SMTP_AWS_REGION: "EU-WEST-1 ",
    SMTP_AWS_ROLE_ARN: ` ${ROLE_ARN} `,
    SMTP_AWS_ROLE_PROJECT_ID: PROJECT,
  };

  test("a role config is read back with its role, its project and its config, and no key", () => {
    const server: EmailServer = MailService.getEmailServer({ ...body });

    expect(server.id?.toString()).toBe(CONFIG.toString());
    expect(server.awsRoleArn).toBe(ROLE_ARN);
    expect(server.awsRoleProjectId).toBe(PROJECT);
    expect(server.awsRegion).toBe("eu-west-1");
    expect(server.awsAccessKeyId).toBeUndefined();
    expect(server.awsSecretAccessKey).toBeUndefined();
  });

  test("a role config needs its role, its config, its project and a Region", () => {
    expect(MailService.isSMTPConfigValid({ ...body })).toBe(true);

    for (const missing of [
      "SMTP_ID",
      "SMTP_AWS_ROLE_PROJECT_ID",
      "SMTP_AWS_REGION",
    ]) {
      const without: JSONObject = { ...body };

      delete without[missing];
      expect(MailService.isSMTPConfigValid(without)).toBe(false);
    }

    // Without a role, it is an access key's config, and needs the key.
    const withoutRole: JSONObject = { ...body };

    delete withoutRole["SMTP_AWS_ROLE_ARN"];
    expect(MailService.isSMTPConfigValid(withoutRole)).toBe(false);
    expect(
      MailService.isSMTPConfigValid({
        ...withoutRole,
        SMTP_AWS_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
        SMTP_AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      }),
    ).toBe(true);
  });

  test("another provider's config never carries a role", () => {
    const server: EmailServer = MailService.getEmailServer({
      ...body,
      SMTP_TRANSPORT_TYPE: MailTransportType.Postmark,
      SMTP_API_KEY: "postmark-token",
    });

    expect(server.awsRoleArn).toBeUndefined();
    expect(server.awsRoleProjectId).toBeUndefined();
  });
});
