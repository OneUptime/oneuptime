import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AwsDefaultCredentialChain, {
  AwsChainHttpRequest,
  AwsChainHttpResponse,
} from "../../../../Server/Utils/Aws/AwsDefaultCredentialChain";
import { AwsCredentials } from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  AssumedRoleCache,
  AwsRoleCheckCache,
  AwsRolePurpose,
  ROLE_CHECK_PASS_MS,
  ROLE_CHECK_REFUSAL_MS,
  ROLE_CHECK_SESSION_POLICY,
  assumeRole,
  getRoleSessionName,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import AmazonSesProjectRole, {
  AmazonSesRoleSession,
  AmazonSesRoleSignInError,
} from "../../../../Server/Utils/Mail/AmazonSesProjectRole";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import logger from "../../../../Server/Utils/Logger";
import { CLOUD_CONNECT_ROLE_SIGN_IN_WORDS } from "../../../../Types/CloudConnection/AwsRoleSignInFailures";
import { getAwsExternalIdForProject } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { getAwsSesExternalIdForProject } from "../../../../Types/Email/AmazonSesRoleExternalId";
import {
  AmazonSesRoleSetup,
  readAmazonSesRoleSetup,
} from "../../../../Types/Email/AmazonSesRoleSetup";
import {
  AMAZON_SES_ROLE_ARN_INVALID,
  AMAZON_SES_ROLE_CONFIG_INCOMPLETE,
  AMAZON_SES_ROLE_IN_SERVER_ACCOUNT,
  AMAZON_SES_ROLE_SENTENCES,
  AMAZON_SES_ROLE_SIGN_IN_WORDS,
  AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
  AMAZON_SES_SERVER_ACCOUNT_UNKNOWN,
} from "../../../../Types/Email/AmazonSesRoleWords";
import {
  FAKE_ONEUPTIME_ACCOUNT,
  FAKE_ONEUPTIME_PRINCIPAL_ARN,
  FakeSts,
  FakeStsRole,
  createFakeSts,
  stsErrorAnswer,
} from "./FakeSesRoleSts";

/*
 * A PROJECT'S AMAZON SES CONFIG, SIGNED IN TO AN IAM ROLE IN ITS OWN AWS
 * ACCOUNT (#7378), against a stand-in for STS:
 *
 *   - what OneUptime asks AWS: the role checked first with an external id no
 *     project has, then signed in to with the project's email external id -
 *     never Cloud Connect's, never one a caller names - as OneUptime's own
 *     identity, its session token on the signature;
 *   - who is never let in: another project, a role made for Cloud Connect, a
 *     role that takes any external id, a role in OneUptime's own AWS
 *     account, and anything while AWS does not say which account that is;
 *   - what is kept, and for how long: the session while it lasts, the check
 *     a day (a refusal an hour), each in email's own key space; a test
 *     checks afresh, and what it finds holds for every email after it;
 *   - what the project is told: OneUptime's own words, never AWS's answer
 *     (which names OneUptime's identity), a key or a token.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const OTHER_PROJECT: string = "22222222-2222-4222-8222-222222222222";
const CONFIG: string = "33333333-3333-4333-8333-333333333333";
const CUSTOMER_ACCOUNT: string = "210987654321";
const ROLE_ARN: string = `arn:aws:iam::${CUSTOMER_ACCOUNT}:role/OneUptimeSes`;
const SES_EXTERNAL_ID: string = getAwsSesExternalIdForProject(PROJECT);
const SERVER_KEY: AwsCredentials = {
  accessKeyId: "AKIAONEUPTIMESERVER1",
  secretAccessKey: "oneuptime-server-secret",
};
const NOW: Date = new Date("2026-11-20T12:00:00Z");
const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;

let clockMs: number = NOW.getTime();

function later(ms: number): void {
  clockMs += ms;
}

beforeEach(() => {
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = SERVER_KEY.accessKeyId;
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
    SERVER_KEY.secretAccessKey;
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
  AwsServerIdentity.useCredentialChain(
    new AwsDefaultCredentialChain({
      env: { AWS_EC2_METADATA_DISABLED: "true" },
    }),
  );
  clockMs = NOW.getTime();
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clockMs;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {});
  jest.spyOn(logger, "debug").mockImplementation((): void => {});
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AwsServerIdentity.useCredentialChain(null);
  AwsServerIdentity.clearCache();
  AmazonSesProjectRole.useTransport(null);
  AssumedRoleCache.clear();
  jest.restoreAllMocks();
});

// A stand-in for STS, with the project's role trusting its email external id.
function fakeSts(
  roles: Array<FakeStsRole> = [{ arn: ROLE_ARN, trusts: [SES_EXTERNAL_ID] }],
  sessionSeconds?: number,
): FakeSts {
  const sts: FakeSts = createFakeSts({ roles, sessionSeconds });

  // A retry of AWS's goes at once: what is tested is what is asked.
  AmazonSesProjectRole.useTransport(sts.transport, async (): Promise<void> => {
    return;
  });

  return sts;
}

function session(
  data: Partial<{
    projectId: string;
    configId: string;
    roleArn: string;
    region: string;
    checksAfresh: boolean;
  }> = {},
): Promise<AmazonSesRoleSession> {
  return AmazonSesProjectRole.getSession({
    projectId: PROJECT,
    configId: CONFIG,
    roleArn: ROLE_ARN,
    region: "eu-west-1",
    ...data,
  });
}

async function refusalOf(
  promise: Promise<unknown>,
): Promise<AmazonSesRoleSignInError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AmazonSesRoleSignInError);
    return error as AmazonSesRoleSignInError;
  }

  throw new Error("The sign-in went through.");
}

// Nothing of AWS's own answer, of OneUptime's identity or of a credential.
function expectOneUptimesOwnWords(message: string, sts?: FakeSts): void {
  expect(AMAZON_SES_ROLE_SENTENCES).toContain(message);
  expect(message).not.toContain(FAKE_ONEUPTIME_PRINCIPAL_ARN);
  expect(message).not.toContain(FAKE_ONEUPTIME_ACCOUNT);
  expect(message).not.toContain("is not authorized");
  expect(message).not.toContain("Rate exceeded");
  expect(message).not.toContain(SERVER_KEY.accessKeyId);
  expect(message).not.toContain(SERVER_KEY.secretAccessKey);

  for (const handedOut of sts?.sessions || []) {
    expect(message).not.toContain(handedOut.accessKeyId);
    expect(message).not.toContain(handedOut.secretAccessKey);
    expect(message).not.toContain(handedOut.sessionToken);
  }
}

describe("what OneUptime asks AWS", () => {
  test("it checks the role first, then signs in with the project's email external ID, as its own identity", async () => {
    const sts: FakeSts = fakeSts();

    const signedIn: AmazonSesRoleSession = await session();

    // Who OneUptime is (the account check), the role's check, the sign-in.
    expect(sts.actions).toEqual([
      "GetCallerIdentity",
      "AssumeRole",
      "AssumeRole",
    ]);

    const [check, signIn] = sts.assumeRoles;

    // A trust policy judges both alike: the same role, session name, Region and identity.
    for (const asked of [check!, signIn!]) {
      expect(asked.roleArn).toBe(ROLE_ARN);
      expect(asked.sessionName).toBe(getRoleSessionName(CONFIG));
      expect(asked.url).toBe("https://sts.us-east-1.amazonaws.com/");
      expect(asked.authorization).toContain(
        `Credential=${SERVER_KEY.accessKeyId}/`,
      );
    }

    // The check: an id no project has, of every project's shape, for nothing.
    expect(check!.externalId).not.toBe(SES_EXTERNAL_ID);
    expect(check!.externalId).toMatch(/^oneuptime-[0-9a-f]{32}$/);
    expect(check!.durationSeconds).toBe("900");
    expect(check!.policy).toBe(ROLE_CHECK_SESSION_POLICY);

    // The sign-in: the project's email id - never its Cloud Connect one.
    expect(signIn!.externalId).toBe(SES_EXTERNAL_ID);
    expect(signIn!.externalId).not.toBe(getAwsExternalIdForProject(PROJECT));
    expect(signIn!.durationSeconds).toBe("3600");
    expect(signIn!.policy).toBeNull();

    // What an email is signed with: the session AWS handed out, token and all.
    expect(sts.sessions).toHaveLength(1);
    expect(signedIn.credentials).toEqual({
      accessKeyId: sts.sessions[0]!.accessKeyId,
      secretAccessKey: sts.sessions[0]!.secretAccessKey,
      sessionToken: sts.sessions[0]!.sessionToken,
    });
    expect(signedIn.key).toBe(
      AmazonSesProjectRole.keyOf({
        projectId: PROJECT,
        configId: CONFIG,
        roleArn: ROLE_ARN,
      }),
    );
  });

  test("the external ID is the project's own, derived from its id alone, and of every project's shape", () => {
    expect(SES_EXTERNAL_ID).toMatch(/^oneuptime-[0-9a-f]{32}$/);
    expect(getAwsSesExternalIdForProject(` ${PROJECT.toUpperCase()} `)).toBe(
      SES_EXTERNAL_ID,
    );
    expect(getAwsSesExternalIdForProject(OTHER_PROJECT)).not.toBe(
      SES_EXTERNAL_ID,
    );
    // Email's label, never Cloud Connect's: a role made for one is no role of the other.
    expect(SES_EXTERNAL_ID).not.toBe(getAwsExternalIdForProject(PROJECT));
  });

  test("STS is asked in the home Region of the email's partition", async () => {
    for (const [region, roleArn, url] of [
      [
        "cn-north-1",
        `arn:aws-cn:iam::${CUSTOMER_ACCOUNT}:role/OneUptimeSes`,
        "https://sts.cn-north-1.amazonaws.com.cn/",
      ],
      [
        "us-gov-west-1",
        `arn:aws-us-gov:iam::${CUSTOMER_ACCOUNT}:role/OneUptimeSes`,
        "https://sts.us-gov-west-1.amazonaws.com/",
      ],
      ["ap-southeast-2", ROLE_ARN, "https://sts.us-east-1.amazonaws.com/"],
    ] as Array<[string, string, string]>) {
      AssumedRoleCache.clear();
      const sts: FakeSts = fakeSts([
        { arn: roleArn, trusts: [SES_EXTERNAL_ID] },
      ]);

      await session({ region, roleArn });

      expect(
        sts.assumeRoles.map((asked: { url: string }): string => {
          return asked.url;
        }),
      ).toEqual([url, url]);
    }
  });

  test("the server's own credentials sign with their session token", async () => {
    delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
    delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
    AwsServerIdentity.useCredentialChain(
      new AwsDefaultCredentialChain({
        env: {
          AWS_ACCESS_KEY_ID: "ASIASERVERROLE000001",
          AWS_SECRET_ACCESS_KEY: "server-role-secret",
          AWS_SESSION_TOKEN: "server-role-session-token",
          AWS_EC2_METADATA_DISABLED: "true",
        },
      }),
    );
    const sts: FakeSts = fakeSts();

    await session();

    expect(sts.assumeRoles).toHaveLength(2);

    for (const asked of sts.assumeRoles) {
      expect(asked.authorization).toContain("Credential=ASIASERVERROLE000001/");
      expect(asked.securityToken).toBe("server-role-session-token");
    }
  });
});

describe("who is never let in", () => {
  test("another project's config: it signs in with its own project's external ID, which the role does not trust", async () => {
    const sts: FakeSts = fakeSts();

    const refusal: AmazonSesRoleSignInError = await refusalOf(
      session({ projectId: OTHER_PROJECT }),
    );

    expect(refusal.message).toBe(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.signInNotPermitted,
    );
    expect(refusal.isRetryable).toBe(false);
    expect(sts.assumeRoles[1]!.externalId).toBe(
      getAwsSesExternalIdForProject(OTHER_PROJECT),
    );
    expect(sts.sessions).toHaveLength(0);
    expectOneUptimesOwnWords(refusal.message, sts);
  });

  test("a role made for the project's Cloud Connect is not one of its email's, nor the other way round", async () => {
    const cloudRole: FakeSts = fakeSts([
      { arn: ROLE_ARN, trusts: [getAwsExternalIdForProject(PROJECT)] },
    ]);

    expect((await refusalOf(session())).message).toBe(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.signInNotPermitted,
    );
    expect(cloudRole.sessions).toHaveLength(0);

    // The project's email role, asked by Cloud Connect: refused there too.
    AssumedRoleCache.clear();
    const emailRole: FakeSts = createFakeSts({
      roles: [{ arn: ROLE_ARN, trusts: [SES_EXTERNAL_ID] }],
    });
    let cloudRefusal: unknown = null;

    try {
      await assumeRole({
        purpose: AwsRolePurpose.CloudConnect,
        transport: emailRole.transport,
        credentials: SERVER_KEY,
        roleArn: ROLE_ARN,
        projectId: PROJECT,
        connectionId: CONFIG,
        region: "us-east-1",
        sleep: async (): Promise<void> => {},
      });
    } catch (error) {
      cloudRefusal = error;
    }

    expect(cloudRefusal).toBeInstanceOf(LlmProviderError);
    expect((cloudRefusal as LlmProviderError).message).toBe(
      CLOUD_CONNECT_ROLE_SIGN_IN_WORDS.signInNotPermitted,
    );
    expect(emailRole.assumeRoles[1]!.externalId).toBe(
      getAwsExternalIdForProject(PROJECT),
    );
    expect(emailRole.sessions).toHaveLength(0);
  });

  test("a role that lets any external ID in is refused, its session dropped unread, and the refusal holds an hour", async () => {
    const sts: FakeSts = fakeSts([{ arn: ROLE_ARN, trusts: "any" }]);

    const refusal: AmazonSesRoleSignInError = await refusalOf(session());

    expect(refusal.message).toBe(AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID);
    expect(refusal.isRetryable).toBe(false);
    // The check alone: the session it was handed is never signed with.
    expect(sts.assumeRoles).toHaveLength(1);
    expect(sts.assumeRoles[0]!.externalId).not.toBe(SES_EXTERNAL_ID);
    expectOneUptimesOwnWords(refusal.message, sts);

    // Every email in the hour is refused without asking AWS again.
    later(30 * MINUTE_MS);
    expect((await refusalOf(session())).message).toBe(
      AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
    );
    expect(sts.assumeRoles).toHaveLength(1);

    // An hour after the check, it is checked again.
    later(ROLE_CHECK_REFUSAL_MS);
    await refusalOf(session());
    expect(sts.assumeRoles).toHaveLength(2);
  });

  test("a role in OneUptime's own AWS account is never signed in to, whatever its trust policy says", async () => {
    const operatorRole: string = `arn:aws:iam::${FAKE_ONEUPTIME_ACCOUNT}:role/OperatorSes`;

    for (const trusts of ["any", [SES_EXTERNAL_ID]] as Array<
      FakeStsRole["trusts"]
    >) {
      AssumedRoleCache.clear();
      const sts: FakeSts = fakeSts([{ arn: operatorRole, trusts }]);

      for (const checksAfresh of [false, true]) {
        const refusal: AmazonSesRoleSignInError = await refusalOf(
          session({ roleArn: operatorRole, checksAfresh }),
        );

        expect(refusal.message).toBe(AMAZON_SES_ROLE_IN_SERVER_ACCOUNT);
        expect(refusal.isRetryable).toBe(false);
        expectOneUptimesOwnWords(refusal.message, sts);
      }

      // Not even the check: who OneUptime is, then nothing.
      expect(sts.assumeRoles).toHaveLength(0);
      expect(sts.sessions).toHaveLength(0);
    }

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("in this OneUptime's own AWS account"),
    );
  });

  test("while AWS does not say which account OneUptime is, nothing is signed in to (fail closed)", async () => {
    const sts: FakeSts = fakeSts();

    sts.failCallerIdentityWith(
      stsErrorAnswer(500, "InternalFailure", "We encountered an error."),
    );

    const refusal: AmazonSesRoleSignInError = await refusalOf(session());

    expect(refusal.message).toBe(AMAZON_SES_SERVER_ACCOUNT_UNKNOWN);
    // AWS may answer next time: the email may be tried again.
    expect(refusal.isRetryable).toBe(true);
    expect(sts.assumeRoles).toHaveLength(0);
    expectOneUptimesOwnWords(refusal.message, sts);

    // Once AWS says, the role is checked and signed in to.
    sts.failCallerIdentityWith(null);
    AwsServerIdentity.clearCache();
    await session();
    expect(sts.sessions).toHaveLength(1);
  });

  test("a server with no AWS identity is told to sign in with an access key, and asks AWS nothing", async () => {
    delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
    delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
    const sts: FakeSts = fakeSts();

    const refusal: AmazonSesRoleSignInError = await refusalOf(session());

    expect(refusal.message).toBe(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.noServerIdentity,
    );
    expect(refusal.isRetryable).toBe(false);
    expect(sts.actions).toEqual([]);
  });

  test("a config that cannot be signed in with is refused before AWS is asked", async () => {
    const sts: FakeSts = fakeSts();

    for (const roleArn of [
      "",
      "OneUptimeSes",
      "arn:aws:iam::21098765432:role/OneUptimeSes",
      "arn:aws:iam::210987654321:user/OneUptimeSes",
      "arn:aws:sts::210987654321:assumed-role/OneUptimeSes/x",
    ]) {
      expect((await refusalOf(session({ roleArn }))).message).toBe(
        AMAZON_SES_ROLE_ARN_INVALID,
      );
    }

    for (const missing of [
      { projectId: "" },
      { configId: "" },
      { region: " " },
    ]) {
      expect((await refusalOf(session(missing))).message).toBe(
        AMAZON_SES_ROLE_CONFIG_INCOMPLETE,
      );
    }

    expect(sts.actions).toEqual([]);
  });
});

describe("what is kept, and for how long", () => {
  test("the session signs the config's next emails while it lasts, then the role is signed in to again", async () => {
    const sts: FakeSts = fakeSts();

    const first: AmazonSesRoleSession = await session();
    const second: AmazonSesRoleSession = await session();

    expect(second.credentials).toEqual(first.credentials);
    expect(sts.assumeRoles).toHaveLength(2);

    // Five minutes before the hour is up, a new session: the check still holds.
    later(56 * MINUTE_MS);
    const third: AmazonSesRoleSession = await session();

    expect(third.credentials.accessKeyId).toBe(sts.sessions[1]!.accessKeyId);
    expect(sts.assumeRoles).toHaveLength(3);
    expect(sts.assumeRoles[2]!.externalId).toBe(SES_EXTERNAL_ID);

    // A day after the check, it is checked again before the next session.
    later(ROLE_CHECK_PASS_MS);
    await session();
    expect(sts.assumeRoles).toHaveLength(5);
    expect(sts.assumeRoles[3]!.externalId).not.toBe(SES_EXTERNAL_ID);
  });

  test("a session Amazon SES no longer takes is dropped, and the next email signs in again", async () => {
    const sts: FakeSts = fakeSts();

    const first: AmazonSesRoleSession = await session();

    AmazonSesProjectRole.forgetSession(first);

    const next: AmazonSesRoleSession = await session();

    expect(next.credentials.accessKeyId).not.toBe(
      first.credentials.accessKeyId,
    );
    // Signed in again; the role's check still holds, so no second check.
    expect(sts.assumeRoles).toHaveLength(3);
  });

  test("dropping a session another email already replaced leaves the new one", async () => {
    const sts: FakeSts = fakeSts();

    const first: AmazonSesRoleSession = await session();

    AmazonSesProjectRole.forgetSession(first);
    const replaced: AmazonSesRoleSession = await session();

    // The first email's late drop names a session no longer kept.
    AmazonSesProjectRole.forgetSession(first);

    expect((await session()).credentials).toEqual(replaced.credentials);
    expect(sts.sessions).toHaveLength(2);
  });

  test("Send Test Email checks the role afresh, and a role it finds taking any ID is sent through no more", async () => {
    const role: FakeStsRole = { arn: ROLE_ARN, trusts: [SES_EXTERNAL_ID] };
    const sts: FakeSts = fakeSts([role]);

    await session();
    expect(sts.assumeRoles).toHaveLength(2);

    // Someone removes the condition: a test checks again, whatever was kept.
    role.trusts = "any";

    expect((await refusalOf(session({ checksAfresh: true }))).message).toBe(
      AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
    );
    expect(sts.assumeRoles).toHaveLength(3);

    // The next email does not sign with the session it held before.
    expect((await refusalOf(session())).message).toBe(
      AMAZON_SES_ROLE_WITHOUT_EXTERNAL_ID,
    );
    expect(sts.assumeRoles).toHaveLength(3);
  });

  test("a fixed role is sent through once a test passes, without waiting out its refusal", async () => {
    const role: FakeStsRole = { arn: ROLE_ARN, trusts: "any" };
    const sts: FakeSts = fakeSts([role]);

    await refusalOf(session());

    // The condition is added; the refusal still holds for an email...
    role.trusts = [SES_EXTERNAL_ID];
    await refusalOf(session());
    expect(sts.assumeRoles).toHaveLength(1);

    // ...until a test checks again.
    const tested: AmazonSesRoleSession = await session({ checksAfresh: true });

    expect(sts.assumeRoles).toHaveLength(3);
    // The emails after it sign with the session the test made.
    expect((await session()).credentials).toEqual(tested.credentials);
    expect(sts.assumeRoles).toHaveLength(3);
  });

  test("a Cloud Connect verdict never stands for an email one, nor the other way round", async () => {
    const sts: FakeSts = fakeSts([{ arn: ROLE_ARN, trusts: "any" }]);
    const cloudKey: string = AssumedRoleCache.keyOf({
      purpose: AwsRolePurpose.CloudConnect,
      projectId: PROJECT,
      connectionId: CONFIG,
      roleArn: ROLE_ARN,
    });
    const emailKey: string = AmazonSesProjectRole.keyOf({
      projectId: PROJECT,
      configId: CONFIG,
      roleArn: ROLE_ARN,
    });

    expect(emailKey).not.toBe(cloudKey);

    // A pass kept for Cloud Connect's key: email checks the role itself.
    await AwsRoleCheckCache.set(cloudKey, "requires-external-id", clockMs);
    await refusalOf(session());
    expect(sts.assumeRoles).toHaveLength(1);
    expect(await AwsRoleCheckCache.get(emailKey)).toBe("takes-any-external-id");
    expect(await AwsRoleCheckCache.get(cloudKey)).toBe("requires-external-id");

    // Email's refusal does not stand for Cloud Connect's sign-in either.
    AssumedRoleCache.clear();
    await AwsRoleCheckCache.set(emailKey, "takes-any-external-id", clockMs);
    const cloud: FakeSts = createFakeSts({
      roles: [{ arn: ROLE_ARN, trusts: [getAwsExternalIdForProject(PROJECT)] }],
    });

    await assumeRole({
      purpose: AwsRolePurpose.CloudConnect,
      transport: cloud.transport,
      credentials: SERVER_KEY,
      roleArn: ROLE_ARN,
      projectId: PROJECT,
      connectionId: CONFIG,
      region: "us-east-1",
      sleep: async (): Promise<void> => {},
    });

    expect(cloud.assumeRoles).toHaveLength(2);
    expect(cloud.sessions).toHaveLength(1);
  });

  test("a check AWS throttled is no pass: the email is not sent, another try may work, and nothing is kept", async () => {
    const sts: FakeSts = fakeSts();

    // Asked again as the AWS SDKs ask, then given up on.
    for (let index: number = 0; index < 3; index++) {
      sts.answerNextAssumeRoleWith(
        stsErrorAnswer(400, "Throttling", "Rate exceeded"),
      );
    }

    const refusal: AmazonSesRoleSignInError = await refusalOf(session());

    expect(refusal.message).toBe(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.checkRateLimited,
    );
    expect(refusal.isRetryable).toBe(true);
    expectOneUptimesOwnWords(refusal.message, sts);

    // Nothing was kept: the next email checks the role again, and goes.
    await session();
    expect(sts.assumeRoles).toHaveLength(5);
    expect(sts.sessions).toHaveLength(1);
  });

  test("a sign-in AWS did not answer may be tried again; one it refused may not", async () => {
    const sts: FakeSts = fakeSts();

    // The check passes (AccessDenied for its id), then the sign-in gets no answer, three times.
    sts.answerNextAssumeRoleWith(
      stsErrorAnswer(403, "AccessDenied", "not authorized"),
    );

    for (let index: number = 0; index < 3; index++) {
      sts.answerNextAssumeRoleWith(
        stsErrorAnswer(503, "ServiceUnavailable", "Try later"),
      );
    }

    const unanswered: AmazonSesRoleSignInError = await refusalOf(session());

    expect(unanswered.message).toBe(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.signInUnanswered,
    );
    expect(unanswered.isRetryable).toBe(true);
    expectOneUptimesOwnWords(unanswered.message, sts);
  });
});

describe("what the project is told", () => {
  test("AWS's AccessDenied, which names OneUptime's identity, never reaches the project", async () => {
    const sts: FakeSts = fakeSts([
      { arn: ROLE_ARN, trusts: ["oneuptime-someone-else"] },
    ]);

    const refusal: AmazonSesRoleSignInError = await refusalOf(session());

    expect(refusal.message).toBe(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.signInNotPermitted,
    );
    expectOneUptimesOwnWords(refusal.message, sts);
    // It is the server's log's, for whoever runs the server.
    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining(FAKE_ONEUPTIME_PRINCIPAL_ARN),
    );
  });

  test("AWS not taking OneUptime's own credentials is the server's, and its credentials are fetched again", async () => {
    delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
    delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
    const asked: Array<AwsChainHttpRequest> = [];

    AwsServerIdentity.useCredentialChain(
      new AwsDefaultCredentialChain({
        env: {
          AWS_CONTAINER_CREDENTIALS_FULL_URI:
            "http://169.254.170.23/v1/credentials",
          AWS_CONTAINER_AUTHORIZATION_TOKEN: "pod-identity-token",
        },
        httpClient: async (
          request: AwsChainHttpRequest,
        ): Promise<AwsChainHttpResponse> => {
          asked.push(request);

          return {
            status: 200,
            bodyText: JSON.stringify({
              AccessKeyId: `ASIAPODROLE${asked.length}0000000`,
              SecretAccessKey: "pod-role-secret",
              Token: "pod-role-token",
              Expiration: new Date(clockMs + HOUR_MS).toISOString(),
            }),
          };
        },
      }),
    );
    const sts: FakeSts = fakeSts();

    // Who OneUptime is works; the role's check then meets an expired token, which is not asked again.
    sts.answerNextAssumeRoleWith(
      stsErrorAnswer(
        403,
        "ExpiredToken",
        "The security token included in the request is expired",
      ),
    );

    const refusal: AmazonSesRoleSignInError = await refusalOf(session());

    expect(refusal.message).toBe(
      AMAZON_SES_ROLE_SIGN_IN_WORDS.serverCredentialsRefused,
    );
    expect(refusal.isRetryable).toBe(true);
    expectOneUptimesOwnWords(refusal.message, sts);

    const fetchedBefore: number = asked.length;

    // The next email signs with credentials fetched afresh.
    await session();
    expect(asked.length).toBe(fetchedBefore + 1);
    expect(
      sts.assumeRoles[sts.assumeRoles.length - 1]!.authorization,
    ).toContain(
      `Credential=ASIAPODROLE${asked.length}0000000/`,
    );
  });

  test("every sentence a project may be told is whole, one of OneUptime's, and names no value", () => {
    for (const sentence of AMAZON_SES_ROLE_SENTENCES) {
      expect(sentence).toMatch(/^[A-Z]/);
      expect(sentence).toMatch(/\.$/);
      expect(sentence).not.toContain("{{");
    }

    expect(new Set(AMAZON_SES_ROLE_SENTENCES).size).toBe(
      AMAZON_SES_ROLE_SENTENCES.length,
    );
  });
});

describe("what the form is told to set a role up with", () => {
  test("OneUptime's account to trust, the project's email external ID, and the trust policy written from them", async () => {
    fakeSts();

    const setup: AmazonSesRoleSetup = await AmazonSesProjectRole.getRoleSetup({
      projectId: PROJECT,
    });
    const principal: string = `arn:aws:iam::${FAKE_ONEUPTIME_ACCOUNT}:root`;

    expect(setup).toEqual({
      isAvailable: true,
      trustedPrincipalArn: principal,
      externalId: SES_EXTERNAL_ID,
      trustPolicy: expect.any(String),
    });
    expect(JSON.parse(setup.trustPolicy!)).toEqual({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: principal },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "sts:ExternalId": SES_EXTERNAL_ID } },
        },
      ],
    });
    // Laid out to be read and copied.
    expect(setup.trustPolicy).toContain("\n  ");
    // What the form reads back is what was sent.
    expect(readAmazonSesRoleSetup(JSON.parse(JSON.stringify(setup)))).toEqual(
      setup,
    );
  });

  test("a server with no AWS identity says so, with the project's external ID and no policy", async () => {
    delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
    delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
    fakeSts();

    expect(
      await AmazonSesProjectRole.getRoleSetup({ projectId: PROJECT }),
    ).toEqual({ isAvailable: false, externalId: SES_EXTERNAL_ID });
  });

  test("an answer that is not one is never read as one", () => {
    for (const value of [
      null,
      "text",
      [],
      {},
      { isAvailable: true, externalId: SES_EXTERNAL_ID },
      { isAvailable: "yes", externalId: SES_EXTERNAL_ID },
      { isAvailable: false },
      {
        isAvailable: true,
        externalId: SES_EXTERNAL_ID,
        trustedPrincipalArn: "arn:aws:iam::999988887777:root",
      },
      {
        isAvailable: true,
        externalId: SES_EXTERNAL_ID,
        trustedPrincipalArn: "arn:aws:iam::999988887777:root",
        trustPolicy: "x".repeat(5000),
      },
    ]) {
      expect(readAmazonSesRoleSetup(value)).toBeNull();
    }

    expect(
      readAmazonSesRoleSetup({
        isAvailable: false,
        externalId: SES_EXTERNAL_ID,
      }),
    ).toEqual({ isAvailable: false, externalId: SES_EXTERNAL_ID });
  });
});
