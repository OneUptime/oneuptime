import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AwsCredentials } from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  AssumedRoleCache,
  AwsRoleCheckCache,
  AwsRoleCheckVerdict,
  ROLE_CHECK_PASS_MS,
  ROLE_CHECK_REFUSAL_MS,
  ROLE_CHECK_SESSION_POLICY,
  ROLE_CHECK_SESSION_SECONDS,
  assumeRole,
  getRoleCheckExternalId,
  getRoleSessionName,
  getRoleWithoutExternalIdMessage,
  probeRoleExternalId,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import AwsDefaultCredentialChain from "../../../../Server/Utils/Aws/AwsDefaultCredentialChain";
import {
  CloudChangesResult,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudReadBudget,
  CloudReadResult,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { readAwsDataSecurity } from "../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityReader";
import { blockS3BucketPublicAccess } from "../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityResponse";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import logger from "../../../../Server/Utils/Logger";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  CloudConnectionSetupScope,
  getAwsExternalIdConditionText,
  getAwsExternalIdForProject,
  getAwsReadOnlyRoleTemplate,
  getAwsRoleSetupCommand,
  getAwsTrustPolicyDocument,
} from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import {
  CloudConnectionFailureKind,
  CloudConnectionTestResult,
} from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  FAKE_ACCOUNT_ID,
  FAKE_ONEUPTIME_IDENTITY_ARN,
  FAKE_PROJECT_ID,
  FakeAws,
  FakeAwsOptions,
  FakeMetric,
  createFakeAws,
  stsError,
} from "./FakeAwsApi";

/*
 * THE CHECK THAT A ROLE REQUIRES THE PROJECT'S EXTERNAL ID (#10405).
 *
 * AWS holds OneUptime to a project's external id only when the role's
 * trust policy has the sts:ExternalId condition. Against a fake AWS whose
 * roles hold sign-ins to their trust policies: a role is signed in to once
 * with an external id no project has before it is used, and refused - with
 * nothing read, by any way into an account - when AWS takes that id; the
 * verdict is kept a day (a refusal an hour), a pass only once the sign-in
 * it allowed worked, and a check AWS throttled or did not answer is never
 * a pass. No word a project reads is AWS's own, or names OneUptime's
 * identity.
 */

const PROJECT: string = FAKE_PROJECT_ID;
const OTHER_PROJECT: string = "22222222-2222-4222-8222-222222222222";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
const OTHER_CONNECTION: string = "44444444-4444-4444-8444-444444444444";
const ROLE_ARN: string = `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/OneUptimeReadOnly-5f3a9c1e`;
const MEMBER: string = "210987654321";
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const HOUR_MS: number = 60 * 60 * 1000;
const SERVER_KEY: AwsCredentials = {
  accessKeyId: "AKIAONEUPTIMESERVER1",
  secretAccessKey: "oneuptime-server-secret",
};
const PROJECT_EXTERNAL_ID: string = getAwsExternalIdForProject(PROJECT);
// "oneuptime-" and 32 lowercase hexadecimal digits: every project's external id.
const EXTERNAL_ID_SHAPE: RegExp = /^oneuptime-[0-9a-f]{32}$/;

const connector: AwsCloudConnector = new AwsCloudConnector();

// The clock every cache reads (Date.now), moved by the tests.
let clockMs: number = NOW.getTime();
let warn: SpyInstance<typeof logger.warn>;
let debug: SpyInstance<typeof logger.debug>;

beforeEach(() => {
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = SERVER_KEY.accessKeyId;
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
    SERVER_KEY.secretAccessKey;
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
  AwsServerIdentity.useCredentialChain(
    new AwsDefaultCredentialChain({ env: { AWS_EC2_METADATA_DISABLED: "true" } }),
  );
  clockMs = NOW.getTime();
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return clockMs;
  });
  warn = jest.spyOn(logger, "warn").mockImplementation((): void => {});
  debug = jest.spyOn(logger, "debug").mockImplementation((): void => {});
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AwsServerIdentity.useCredentialChain(null);
  AssumedRoleCache.clear();
  jest.restoreAllMocks();
});

function later(ms: number): void {
  clockMs += ms;
}

function roleSettings(
  data: { projectId?: string; roleArn?: string; config?: JSONObject } = {},
): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: data.projectId || PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsRole,
      roleArn: data.roleArn || ROLE_ARN,
      regions: "us-east-1",
      ...(data.config || {}),
    },
    secrets: {},
  };
}

function organizationSettings(): CloudConnectionSettings {
  return roleSettings({
    config: { readScope: CloudConnectionSetupScope.Organization },
  });
}

function fakeAws(options: Partial<FakeAwsOptions> = {}): FakeAws {
  return createFakeAws({
    regions: { "us-east-1": { metrics: ec2("i-0aaa") } },
    ...options,
  });
}

function ec2(instanceId: string): Array<FakeMetric> {
  return [
    {
      namespace: "AWS/EC2",
      metricName: "CPUUtilization",
      dimensions: [["InstanceId", instanceId]],
      values: [[NOW.getTime() / 1000 - 3000, 12]],
    },
  ];
}

interface SignIn {
  roleArn: string;
  externalId: string;
  sessionName: string;
  durationSeconds: string;
  policy: string | null;
  authorization: string;
  url: string;
}

// Every sts:AssumeRole AWS was asked, in order.
function signInsOf(fake: FakeAws): Array<SignIn> {
  return fake.stsCalls
    .filter((call: { action: string }): boolean => {
      return call.action === "AssumeRole";
    })
    .map(
      (call: { body: URLSearchParams; request: DataSourceHttpRequest }) => {
        return {
          roleArn: call.body.get("RoleArn") || "",
          externalId: call.body.get("ExternalId") || "",
          sessionName: call.body.get("RoleSessionName") || "",
          durationSeconds: call.body.get("DurationSeconds") || "",
          policy: call.body.get("Policy"),
          authorization:
            (call.request.headers as Record<string, string>)[
              "Authorization"
            ] || "",
          url: call.request.url,
        };
      },
    );
}

// The checks (an external id no project has) and the project's own sign-ins.
function countOf(fake: FakeAws): { checks: number; signIns: number } {
  const all: Array<SignIn> = signInsOf(fake);

  return {
    checks: all.filter((signIn: SignIn): boolean => {
      return signIn.externalId !== PROJECT_EXTERNAL_ID;
    }).length,
    signIns: all.filter((signIn: SignIn): boolean => {
      return signIn.externalId === PROJECT_EXTERNAL_ID;
    }).length,
  };
}

// Every request that is not to STS: what a read would have read or changed.
function readsOf(fake: FakeAws): Array<DataSourceHttpRequest> {
  return fake.requests.filter((request: DataSourceHttpRequest): boolean => {
    return !new URL(request.url).host.startsWith("sts.");
  });
}

function callOptions(
  fake: FakeAws,
  connectionId: string = CONNECTION,
): {
  transport: FakeAws["transport"];
  now: () => Date;
  sleep: () => Promise<void>;
  connectionId: string;
} {
  return {
    transport: fake.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
    connectionId,
  };
}

function keyOf(connectionId: string = CONNECTION): string {
  return AssumedRoleCache.keyOf({
    projectId: PROJECT,
    connectionId,
    roleArn: ROLE_ARN,
  });
}

async function refusalOf(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return error as LlmProviderError;
  }

  throw new Error("It was not refused.");
}

// What a project must never read: AWS's own words, OneUptime's identity, another project's id.
function expectNothingOfTheServer(message: string): void {
  for (const detail of [
    FAKE_ONEUPTIME_IDENTITY_ARN,
    "999988887777",
    "oneuptime-cloud-connect",
    "is not authorized",
    "HTTP 4",
    "HTTP 5",
    "<Error",
    SERVER_KEY.accessKeyId,
    SERVER_KEY.secretAccessKey,
    getAwsExternalIdForProject(OTHER_PROJECT),
  ]) {
    expect(message).not.toContain(detail);
  }
}

describe("the external id of the check", () => {
  test("is written as every project's is, is never a project's own, and is new every time", () => {
    const ids: Set<string> = new Set<string>();

    for (let index: number = 0; index < 50; index++) {
      const id: string = getRoleCheckExternalId();

      expect(id).toMatch(EXTERNAL_ID_SHAPE);
      expect(id).not.toBe(PROJECT_EXTERNAL_ID);
      ids.add(id);
    }

    expect(ids.size).toBe(50);
    // A project's own id has the same shape: a trust policy that lets in "oneuptime-*" lets the check in too.
    expect(PROJECT_EXTERNAL_ID).toMatch(EXTERNAL_ID_SHAPE);
  });
});

describe("checking a role (probeRoleExternalId)", () => {
  async function check(fake: FakeAws): Promise<AwsRoleCheckVerdict> {
    return await probeRoleExternalId({
      transport: fake.transport,
      credentials: SERVER_KEY,
      roleArn: ` ${ROLE_ARN} `,
      roleSessionName: getRoleSessionName(CONNECTION),
      region: "us-east-1",
      now: (): Date => {
        return NOW;
      },
      sleep: async (): Promise<void> => {},
    });
  }

  test("is the sign-in as it is asked - role, session name, Region, OneUptime's identity - with an external id no project has, the shortest session and a session policy that allows nothing", async () => {
    const fake: FakeAws = fakeAws();

    expect(await check(fake)).toBe("requires-external-id");

    const [asked]: Array<SignIn> = signInsOf(fake);

    expect(signInsOf(fake)).toHaveLength(1);
    expect(asked!.roleArn).toBe(ROLE_ARN);
    expect(asked!.sessionName).toBe(getRoleSessionName(CONNECTION));
    expect(asked!.externalId).toMatch(EXTERNAL_ID_SHAPE);
    expect(asked!.externalId).not.toBe(PROJECT_EXTERNAL_ID);
    expect(asked!.durationSeconds).toBe(String(ROLE_CHECK_SESSION_SECONDS));
    expect(asked!.durationSeconds).toBe("900");
    expect(asked!.policy).toBe(ROLE_CHECK_SESSION_POLICY);
    expect(JSON.parse(asked!.policy!)).toEqual({
      Version: "2012-10-17",
      Statement: [{ Effect: "Deny", Action: "*", Resource: "*" }],
    });
    expect(asked!.url).toBe("https://sts.us-east-1.amazonaws.com/");
    expect(asked!.authorization).toContain(
      `Credential=${SERVER_KEY.accessKeyId}/`,
    );
  });

  test("a role whose trust policy lets any external id in is found out", async () => {
    expect(await check(fakeAws({ rolesTakingAnyExternalId: true }))).toBe(
      "takes-any-external-id",
    );
    expect(
      await check(fakeAws({ rolesTakingAnyExternalId: [ROLE_ARN.toUpperCase()] })),
    ).toBe("takes-any-external-id");
  });

  test("a role that trusts nobody, or another project, passes: AWS refused the id", async () => {
    expect(await check(fakeAws({ refusedRoles: [ROLE_ARN] }))).toBe(
      "requires-external-id",
    );
    expect(await check(fakeAws({ trustedProjectId: OTHER_PROJECT }))).toBe(
      "requires-external-id",
    );
  });

  test("a check AWS throttled is no pass: it fails as AWS's slow-down, in OneUptime's words", async () => {
    const fake: FakeAws = fakeAws({
      assumeRoleError: stsError(400, "Throttling", "Rate exceeded"),
    });

    const error: LlmProviderError = await refusalOf(check(fake));

    expect(error.kind).toBe(CloudConnectionFailureKind.RateLimited);
    expect(error.message).toBe(
      "AWS asked OneUptime to slow down while it checked that the role requires your project's external ID, so nothing was read through it. OneUptime tries again on the next read.",
    );
    expect(error.message).not.toContain("Rate exceeded");
    // Asked again as the AWS SDKs ask, then given up on.
    expect(signInsOf(fake)).toHaveLength(3);
  });

  test("a check AWS did not answer is no pass", async () => {
    const fake: FakeAws = fakeAws({
      assumeRoleError: stsError(503, "ServiceUnavailable", "Try later"),
    });

    const error: LlmProviderError = await refusalOf(check(fake));

    expect(error.kind).toBe(CloudConnectionFailureKind.Unavailable);
    expect(error.message).toContain("AWS did not answer while OneUptime checked");
  });

  test("a check that never reached AWS is no pass", async () => {
    let tries: number = 0;
    const error: LlmProviderError = await refusalOf(
      probeRoleExternalId({
        transport: async (): Promise<never> => {
          tries++;
          throw new Error("connect ETIMEDOUT 52.94.0.1:443");
        },
        credentials: SERVER_KEY,
        roleArn: ROLE_ARN,
        roleSessionName: getRoleSessionName(CONNECTION),
        region: "us-east-1",
        sleep: async (): Promise<void> => {},
      }),
    );

    expect(tries).toBeGreaterThan(0);
    expect(error.kind).toBe(CloudConnectionFailureKind.Unavailable);
    expect(error.message).toContain("AWS did not answer while OneUptime checked");
    expect(error.message).not.toContain("ETIMEDOUT");
  });

  test("any refusal but AccessDenied is no pass: another code, or a 403 that names none", async () => {
    for (const answer of [
      stsError(
        403,
        "RegionDisabledException",
        "STS is not activated in this region for account:999988887777.",
      ),
      { status: 403, body: "<html>Forbidden by a proxy</html>" },
      stsError(400, "ValidationError", "1 validation error detected"),
    ]) {
      const error: LlmProviderError = await refusalOf(
        check(fakeAws({ assumeRoleError: answer })),
      );

      expect(error.message).toBe(
        "OneUptime could not check that the role requires your project's external ID, so it does not sign in to it. Check that the role ARN is right, then test the connection again.",
      );
      expectNothingOfTheServer(error.message);
    }
  });

  test("AWS's own credentials refusal is said as the server's, never the role's, and keeps AWS's code for the caller", async () => {
    const error: LlmProviderError = await refusalOf(
      check(
        fakeAws({
          assumeRoleError: stsError(
            403,
            "ExpiredToken",
            "The security token included in the request is expired",
          ),
        }),
      ),
    );

    expect(error.kind).toBe(CloudConnectionFailureKind.Unavailable);
    expect(error.message).toContain(
      "AWS did not take the credentials this OneUptime signs in to roles with",
    );
    // AwsServerIdentity.refusedBy reads the code to fetch new credentials.
    expect(error.responseBody).toContain("ExpiredToken");
  });

  test("what AWS answered goes to the server's log, never to the project", async () => {
    const error: LlmProviderError = await refusalOf(
      check(
        fakeAws({
          assumeRoleError: stsError(
            403,
            "RegionDisabledException",
            `STS is not activated in this region for ${FAKE_ONEUPTIME_IDENTITY_ARN}.`,
          ),
        }),
      ),
    );
    const logged: string = warn.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .join("\n");

    expectNothingOfTheServer(error.message);
    expect(logged).toContain(ROLE_ARN);
    expect(logged).toContain("RegionDisabledException");
    expect(logged).not.toContain(SERVER_KEY.secretAccessKey);
  });
});

describe("a role that lets OneUptime in with any external id", () => {
  test("is refused when it is tested: only the check is asked, nothing is read, and the project is told what to add", async () => {
    const fake: FakeAws = fakeAws({ rolesTakingAnyExternalId: true });

    const result: CloudConnectionTestResult = await connector.testConnection(
      roleSettings(),
      callOptions(fake),
    );

    expect(result.status).toBe("fail");
    expect(result.failureKind).toBe(CloudConnectionFailureKind.Settings);
    expect(result.message).toBe(getRoleWithoutExternalIdMessage(PROJECT));
    expect(result.message).toContain(
      "This role lets OneUptime sign in without your project's external ID",
    );
    expect(countOf(fake)).toEqual({ checks: 1, signIns: 0 });
    expect(readsOf(fake)).toHaveLength(0);
    // Not even who the session is: it is dropped unread.
    expect(
      fake.stsCalls.filter((call: { action: string }): boolean => {
        return call.action === "GetCallerIdentity";
      }),
    ).toHaveLength(0);
  });

  test("is told the condition the setup command's trust policy has, with the project's own external id and nothing of the server's", async () => {
    const message: string = getRoleWithoutExternalIdMessage(PROJECT);
    const condition: string = getAwsExternalIdConditionText(PROJECT_EXTERNAL_ID);
    const setup: { trustedPrincipalArn: string; externalId: string } = {
      trustedPrincipalArn: "arn:aws:iam::999988887777:root",
      externalId: PROJECT_EXTERNAL_ID,
    };

    expect(condition).toBe(
      `"Condition":{"StringEquals":{"sts:ExternalId":"${PROJECT_EXTERNAL_ID}"}}`,
    );
    expect(message).toContain(condition);
    // Word for word what the trust policy, the command and the CloudFormation template write.
    expect(getAwsTrustPolicyDocument(setup)).toContain(condition);
    expect(getAwsRoleSetupCommand(setup)).toContain(condition);
    expect(getAwsReadOnlyRoleTemplate(setup)).toContain(condition);
    expectNothingOfTheServer(message);
    expect(message).not.toContain("999988887777");
    expect(message.endsWith(".")).toBe(true);
  });

  test("is refused by every read, which reads nothing: metrics, inventory, changes and health, costs and savings", async () => {
    const fake: FakeAws = fakeAws({ rolesTakingAnyExternalId: true });
    const state: CloudConnectionPullState = { accounts: [FAKE_ACCOUNT_ID] };
    const budget: () => CloudReadBudget = (): CloudReadBudget => {
      return new CloudReadBudget({ maxRequests: 300, maxDurationMs: 60000 });
    };
    const refusals: Array<LlmProviderError> = [
      await refusalOf(
        connector.read(roleSettings(), {
          ...callOptions(fake),
          state: {},
          serviceName: "Amazon Web Services",
          maxRequests: 300,
          maxDurationMs: 60000,
        }),
      ),
      await refusalOf(
        connector.readInventory(roleSettings(), {
          ...callOptions(fake),
          state,
          budget: budget(),
        }),
      ),
      await refusalOf(
        connector.readChanges(roleSettings(), {
          ...callOptions(fake),
          state: { ...state, activePairs: ["us-east-1|AWS/EC2"] },
          budget: budget(),
        }),
      ),
      await refusalOf(
        connector.readCosts(roleSettings(), {
          ...callOptions(fake),
          state,
          budget: budget(),
          start: new Date("2026-10-13T00:00:00.000Z"),
          end: new Date("2026-10-21T00:00:00.000Z"),
        }),
      ),
      await refusalOf(
        connector.readSavings(roleSettings(), {
          ...callOptions(fake),
          state,
          budget: budget(),
        }),
      ),
    ];

    for (const refusal of refusals) {
      expect(refusal.kind).toBe(CloudConnectionFailureKind.Settings);
      expect(refusal.message).toBe(getRoleWithoutExternalIdMessage(PROJECT));
    }

    expect(readsOf(fake)).toHaveLength(0);
    expect(fake.cloudWatchCalls).toHaveLength(0);
    expect(fake.cloudTrailCalls).toHaveLength(0);
    expect(fake.healthCalls).toHaveLength(0);
    expect(fake.costCalls).toHaveLength(0);
    expect(fake.cloudControlCalls).toHaveLength(0);
    // Checked once: the refusal holds for the reads after it.
    expect(countOf(fake)).toEqual({ checks: 1, signIns: 0 });
  });

  test("is refused to Data Security, which reads no data store and changes none", async () => {
    const fake: FakeAws = fakeAws({
      rolesTakingAnyExternalId: true,
      buckets: [{ name: "exposed", region: "us-east-1" }],
    });

    const read: LlmProviderError = await refusalOf(
      readAwsDataSecurity(roleSettings(), {
        projectId: new ObjectID(PROJECT),
        connectionId: new ObjectID(CONNECTION),
        connectedAccountIds: [FAKE_ACCOUNT_ID],
        transport: fake.transport,
        now: (): Date => {
          return NOW;
        },
        sleep: async (): Promise<void> => {},
      }),
    );
    const response: LlmProviderError = await refusalOf(
      blockS3BucketPublicAccess(roleSettings(), {
        connectionId: new ObjectID(CONNECTION),
        bucket: "exposed",
        region: "us-east-1",
        accountNumber: FAKE_ACCOUNT_ID,
        transport: fake.transport,
        now: (): Date => {
          return NOW;
        },
        sleep: async (): Promise<void> => {},
      }),
    );

    for (const refusal of [read, response]) {
      expect(refusal.kind).toBe(CloudConnectionFailureKind.Settings);
      expect(refusal.message).toBe(getRoleWithoutExternalIdMessage(PROJECT));
    }

    expect(fake.s3Calls).toHaveLength(0);
    expect(fake.dataCalls).toHaveLength(0);
    expect(fake.iamCalls).toHaveLength(0);
    expect(readsOf(fake)).toHaveLength(0);
  });

  test("in one account of an organization is refused there alone: the others are read", async () => {
    const memberRole: string = `arn:aws:iam::${MEMBER}:role/OneUptimeReadOnly-5f3a9c1e`;
    const fake: FakeAws = fakeAws({
      organizationAccounts: [
        { Id: FAKE_ACCOUNT_ID, Name: "Management", State: "ACTIVE" },
        { Id: MEMBER, Name: "Production", State: "ACTIVE" },
      ],
      rolesTakingAnyExternalId: [memberRole],
    });

    const result: CloudReadResult = await connector.read(
      organizationSettings(),
      {
        ...callOptions(fake),
        state: {},
        serviceName: "Amazon Web Services",
        maxRequests: 3000,
        maxDurationMs: 60000,
      },
    );

    expect(result.accounts).toEqual([FAKE_ACCOUNT_ID]);
    expect(result.warnings).toContain(
      `Could not read Production (${MEMBER}): ${getRoleWithoutExternalIdMessage(PROJECT)}`,
    );
    // The member's role: checked, never signed in to with the project's id.
    expect(
      signInsOf(fake)
        .filter((signIn: SignIn): boolean => {
          return signIn.roleArn === memberRole;
        })
        .map((signIn: SignIn): boolean => {
          return signIn.externalId === PROJECT_EXTERNAL_ID;
        }),
    ).toEqual([false]);
    // Nothing is signed with a session of the member's account.
    for (const request of readsOf(fake)) {
      expect(JSON.stringify(request.headers)).not.toContain(`ASIA${MEMBER}ROLE`);
    }
    expect(
      warn.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          String(call[0]).includes(memberRole) &&
          String(call[0]).includes("external id no project has")
        );
      }),
    ).toBe(true);
  });

  test("never hands its session out: dropped unread, and no session is kept", async () => {
    const fake: FakeAws = fakeAws({ rolesTakingAnyExternalId: true });

    await refusalOf(connector.getCredentials(roleSettings(), callOptions(fake)));

    expect(AssumedRoleCache.get(keyOf())).toBeUndefined();
    expect(AwsRoleCheckCache.get(keyOf())).toBe("takes-any-external-id");
  });
});

describe("how long a check holds", () => {
  test("a pass holds a day: later sign-ins of the day are not checked again, the next day's is", async () => {
    // Sessions of an hour, as AWS hands them out.
    const fake: FakeAws = fakeAws({ sessionSeconds: 3600 });

    await connector.getCredentials(roleSettings(), callOptions(fake));
    expect(countOf(fake)).toEqual({ checks: 1, signIns: 1 });

    // The session lasts: neither is asked again.
    later(30 * 60 * 1000);
    await connector.getCredentials(roleSettings(), callOptions(fake));
    expect(countOf(fake)).toEqual({ checks: 1, signIns: 1 });

    // A new session within the day: signed in to, not checked.
    later(2 * HOUR_MS);
    await connector.getCredentials(roleSettings(), callOptions(fake));
    expect(countOf(fake)).toEqual({ checks: 1, signIns: 2 });

    // A day after the check: checked again first.
    clockMs = NOW.getTime() + ROLE_CHECK_PASS_MS;
    await connector.getCredentials(roleSettings(), callOptions(fake));
    expect(countOf(fake)).toEqual({ checks: 2, signIns: 3 });
  });

  test("a customer's CloudTrail sees one AccessDenied a day per server, not one per read", async () => {
    const fake: FakeAws = fakeAws({ sessionSeconds: 3600 });

    // A read every five minutes, for a day.
    for (let read: number = 0; read < 288; read++) {
      await connector.getCredentials(roleSettings(), callOptions(fake));
      later(5 * 60 * 1000);
    }

    const counted: { checks: number; signIns: number } = countOf(fake);

    expect(counted.checks).toBe(1);
    // A session an hour, renewed five minutes before it ends.
    expect(counted.signIns).toBeGreaterThanOrEqual(24);
    expect(counted.signIns).toBeLessThanOrEqual(28);
  });

  test("a session is handed out only while the check that let it be made holds", async () => {
    // A session that would last past the day.
    const fake: FakeAws = fakeAws({ sessionSeconds: 3 * 24 * 3600 });

    await connector.getCredentials(roleSettings(), callOptions(fake));
    expect(AssumedRoleCache.get(keyOf())).toBeDefined();

    later(ROLE_CHECK_PASS_MS);
    expect(AssumedRoleCache.get(keyOf())).toBeUndefined();

    await connector.getCredentials(roleSettings(), callOptions(fake));
    expect(countOf(fake)).toEqual({ checks: 2, signIns: 2 });
  });

  test("a trust policy that loses the condition is caught on the next day's check, and its session is dropped", async () => {
    const options: FakeAwsOptions = {
      regions: { "us-east-1": { metrics: ec2("i-0aaa") } },
      sessionSeconds: 3600,
    };
    const fake: FakeAws = createFakeAws(options);

    await connector.getCredentials(roleSettings(), callOptions(fake));

    // Someone edits the trust policy and drops the condition.
    options.rolesTakingAnyExternalId = true;

    later(ROLE_CHECK_PASS_MS);

    const refusal: LlmProviderError = await refusalOf(
      connector.getCredentials(roleSettings(), callOptions(fake)),
    );

    expect(refusal.message).toBe(getRoleWithoutExternalIdMessage(PROJECT));
    expect(countOf(fake)).toEqual({ checks: 2, signIns: 1 });
    expect(AssumedRoleCache.get(keyOf())).toBeUndefined();
  });

  test("a refusal holds an hour, so a fixed trust policy is used within the hour", async () => {
    const options: FakeAwsOptions = {
      regions: { "us-east-1": { metrics: ec2("i-0aaa") } },
      rolesTakingAnyExternalId: true,
    };
    const fake: FakeAws = createFakeAws(options);

    await refusalOf(connector.getCredentials(roleSettings(), callOptions(fake)));

    // Within the hour: refused without asking AWS.
    later(30 * 60 * 1000);
    await refusalOf(connector.getCredentials(roleSettings(), callOptions(fake)));
    expect(countOf(fake)).toEqual({ checks: 1, signIns: 0 });

    // The customer adds the condition: the hour after the check, it is used.
    options.rolesTakingAnyExternalId = undefined;
    clockMs = NOW.getTime() + ROLE_CHECK_REFUSAL_MS;

    const credentials: AwsCredentials = await connector.getCredentials(
      roleSettings(),
      callOptions(fake),
    );

    expect(credentials.sessionToken).toBe("session-token-abc");
    expect(countOf(fake)).toEqual({ checks: 2, signIns: 1 });
  });

  test("a pass is kept only once its sign-in worked: a role that let nobody in is checked again before it lets anyone in", async () => {
    const options: FakeAwsOptions = {
      regions: { "us-east-1": { metrics: ec2("i-0aaa") } },
      refusedRoles: [ROLE_ARN],
    };
    const fake: FakeAws = createFakeAws(options);

    // Trusts nobody: the check passes, the sign-in is refused.
    const refused: LlmProviderError = await refusalOf(
      connector.getCredentials(roleSettings(), callOptions(fake)),
    );

    expect(refused.kind).toBe(CloudConnectionFailureKind.Permission);
    expect(AwsRoleCheckCache.get(keyOf())).toBeUndefined();

    // A minute later, its trust policy lets OneUptime in with any id.
    options.refusedRoles = [];
    options.rolesTakingAnyExternalId = true;
    later(60 * 1000);

    const refusal: LlmProviderError = await refusalOf(
      connector.getCredentials(roleSettings(), callOptions(fake)),
    );

    expect(refusal.kind).toBe(CloudConnectionFailureKind.Settings);
    expect(countOf(fake)).toEqual({ checks: 2, signIns: 1 });
  });

  test("a throttled check keeps nothing, and the next try checks again", async () => {
    const options: FakeAwsOptions = {
      regions: { "us-east-1": { metrics: ec2("i-0aaa") } },
      assumeRoleError: stsError(400, "Throttling", "Rate exceeded"),
    };
    const fake: FakeAws = createFakeAws(options);

    const throttled: LlmProviderError = await refusalOf(
      connector.getCredentials(roleSettings(), callOptions(fake)),
    );

    expect(throttled.kind).toBe(CloudConnectionFailureKind.RateLimited);
    expect(AwsRoleCheckCache.get(keyOf())).toBeUndefined();
    expect(AssumedRoleCache.get(keyOf())).toBeUndefined();

    options.assumeRoleError = undefined;

    await connector.getCredentials(roleSettings(), callOptions(fake));

    // Three throttled tries of the first check, then a check and a sign-in.
    expect(
      signInsOf(fake).map((signIn: SignIn): boolean => {
        return signIn.externalId === PROJECT_EXTERNAL_ID;
      }),
    ).toEqual([false, false, false, false, true]);
  });

  test("a check throttled once, then answered, passes: the AWS SDKs' retry", async () => {
    const fake: FakeAws = fakeAws({
      assumeRoleAnswers: [stsError(400, "Throttling", "Rate exceeded")],
    });

    await connector.getCredentials(roleSettings(), callOptions(fake));

    expect(countOf(fake)).toEqual({ checks: 2, signIns: 1 });
    expect(AwsRoleCheckCache.get(keyOf())).toBe("requires-external-id");
  });

  test("a test checks afresh every time and keeps nothing", async () => {
    const fake: FakeAws = fakeAws();

    for (let attempt: number = 0; attempt < 2; attempt++) {
      const result: CloudConnectionTestResult = await connector.testConnection(
        roleSettings(),
        callOptions(fake),
      );

      expect(result.status).toBe("pass");
    }

    expect(countOf(fake)).toEqual({ checks: 2, signIns: 2 });
    expect(
      AwsRoleCheckCache.get(
        AssumedRoleCache.keyOf({
          projectId: PROJECT,
          connectionId: "test",
          roleArn: ROLE_ARN,
        }),
      ),
    ).toBeUndefined();
  });

  test("each connection's role is checked on its own", async () => {
    const fake: FakeAws = fakeAws();

    await connector.getCredentials(roleSettings(), callOptions(fake));
    await connector.getCredentials(
      roleSettings(),
      callOptions(fake, OTHER_CONNECTION),
    );

    expect(countOf(fake)).toEqual({ checks: 2, signIns: 2 });
    expect(
      signInsOf(fake).map((signIn: SignIn): string => {
        return signIn.sessionName;
      }),
    ).toEqual([
      getRoleSessionName(CONNECTION),
      getRoleSessionName(CONNECTION),
      getRoleSessionName(OTHER_CONNECTION),
      getRoleSessionName(OTHER_CONNECTION),
    ]);
  });

  test("a clock that went back holds no check longer", () => {
    AwsRoleCheckCache.set(keyOf(), "requires-external-id", clockMs + HOUR_MS);

    expect(AwsRoleCheckCache.get(keyOf())).toBeUndefined();
  });
});

describe("signing in to a role (assumeRole)", () => {
  test("checks the role first, then signs in with this project's external id: the check and the sign-in differ only in the id, the session and its policy", async () => {
    const fake: FakeAws = fakeAws();

    await assumeRole({
      transport: fake.transport,
      credentials: SERVER_KEY,
      roleArn: ROLE_ARN,
      projectId: PROJECT,
      connectionId: CONNECTION,
      region: "us-east-1",
      sleep: async (): Promise<void> => {},
    });

    const [check, signIn]: Array<SignIn> = signInsOf(fake);

    expect(signInsOf(fake)).toHaveLength(2);
    // The same role, session name, Region and identity: a trust policy judges both alike.
    for (const asked of [check!, signIn!]) {
      expect(asked.roleArn).toBe(ROLE_ARN);
      expect(asked.sessionName).toBe(getRoleSessionName(CONNECTION));
      expect(asked.url).toBe("https://sts.us-east-1.amazonaws.com/");
      expect(asked.authorization).toContain(
        `Credential=${SERVER_KEY.accessKeyId}/`,
      );
    }
    expect(check!.externalId).not.toBe(PROJECT_EXTERNAL_ID);
    expect(check!.policy).toBe(ROLE_CHECK_SESSION_POLICY);
    expect(signIn!.externalId).toBe(PROJECT_EXTERNAL_ID);
    expect(signIn!.durationSeconds).toBe("3600");
    expect(signIn!.policy).toBeNull();
  });

  test("a project's sign-in is its own: a role made for another project is refused, and never because of the check", async () => {
    const fake: FakeAws = fakeAws({ trustedProjectId: OTHER_PROJECT });

    const error: LlmProviderError = await refusalOf(
      connector.getCredentials(roleSettings(), callOptions(fake)),
    );

    expect(error.kind).toBe(CloudConnectionFailureKind.Permission);
    expect(error.message).toBe(
      "OneUptime could not sign in to the role. Check that the role exists and trusts OneUptime with your project's external ID: run the setup command again.",
    );
    expectNothingOfTheServer(error.message);
    // AWS's words, which name OneUptime's identity, are the server log's.
    expect(
      debug.mock.calls.some((call: Array<unknown>): boolean => {
        return String(call[0]).includes(FAKE_ONEUPTIME_IDENTITY_ARN);
      }),
    ).toBe(true);
  });

  test("a sign-in AWS throttled or did not answer is said in OneUptime's words", async () => {
    for (const [answer, kind] of [
      [
        stsError(400, "Throttling", "Rate exceeded"),
        CloudConnectionFailureKind.RateLimited,
      ],
      [
        stsError(500, "InternalFailure", "oops"),
        CloudConnectionFailureKind.Unavailable,
      ],
    ] as Array<[{ status: number; body: string }, CloudConnectionFailureKind]>) {
      AssumedRoleCache.clear();
      // The check passes (refused); every sign-in after it fails so.
      const fake: FakeAws = fakeAws({
        assumeRoleAnswers: [
          stsError(403, "AccessDenied", "denied"),
          answer,
          answer,
          answer,
        ],
      });

      const error: LlmProviderError = await refusalOf(
        connector.getCredentials(roleSettings(), callOptions(fake)),
      );

      expect(error.kind).toBe(kind);
      expect(error.message).toContain("signed in to the role");
      expect(error.message).toContain("OneUptime tries again on the next read.");
      expect(error.message).not.toContain("Rate exceeded");
      expect(error.message).not.toContain("oops");
      // No pass is kept from a sign-in that did not work.
      expect(AwsRoleCheckCache.get(keyOf())).toBeUndefined();
    }
  });

  test("the changes of an organization's account that refuses its check are left out, not read", async () => {
    const memberRole: string = `arn:aws:iam::${MEMBER}:role/OneUptimeReadOnly-5f3a9c1e`;
    const fake: FakeAws = fakeAws({ rolesTakingAnyExternalId: [memberRole] });

    const result: CloudChangesResult = await connector.readChanges(
      organizationSettings(),
      {
        ...callOptions(fake),
        state: {
          accounts: [FAKE_ACCOUNT_ID, MEMBER],
          organizationAccounts: [
            { id: FAKE_ACCOUNT_ID, name: "Management" },
            { id: MEMBER, name: "Production" },
          ],
        },
        budget: new CloudReadBudget({ maxRequests: 300, maxDurationMs: 60000 }),
      },
    );

    expect(result.changes).toEqual([]);
    expect(
      fake.cloudTrailCalls.some((call: { account: string }): boolean => {
        return call.account === MEMBER;
      }),
    ).toBe(false);
    expect(
      fake.cloudTrailCalls.some((call: { account: string }): boolean => {
        return call.account === FAKE_ACCOUNT_ID;
      }),
    ).toBe(true);
  });
});
