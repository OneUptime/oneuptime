import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import AwsDefaultCredentialChain from "../../../../Server/Utils/Aws/AwsDefaultCredentialChain";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import {
  AssumedRoleCache,
  AwsRolePurpose,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import OneUptimeAwsSessions, {
  ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS,
  OneUptimeAwsSessionKey,
} from "../../../../Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions";
import { AwsCredentials } from "../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import AmazonSesProjectRole from "../../../../Server/Utils/Mail/AmazonSesProjectRole";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionSetupScope } from "../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { getAwsSesExternalIdForProject } from "../../../../Types/Email/AmazonSesRoleExternalId";
import { JSONObject } from "../../../../Types/JSON";
import {
  MemoryGlobalCache,
  installMemoryGlobalCache,
} from "../../../Helpers/CloudTrailRecordings";
import { FakeSts, createFakeSts } from "../Mail/FakeSesRoleSts";
import {
  FAKE_ACCOUNT_ID,
  FAKE_PROJECT_ID,
  FakeAws,
  createFakeAws,
} from "./FakeAwsApi";

/*
 * THE KEY OF EVERY SESSION ONEUPTIME SIGNS IN TO (#10427). Each time
 * OneUptime signs in to a saved Cloud Connect connection's role, it
 * remembers the ID of the key AWS handed it - never its secret or its
 * session token - with the project, the connection, the role, the
 * sign-in's purpose and the session's life, so that the account's
 * CloudTrail can tell its calls as OneUptime's own (OneUptimeAwsSessions).
 * The sign-in itself is AwsSts.assumeRole's, and is not changed: only what
 * it handed back is remembered, after it. A project's Amazon SES role signs
 * in for another purpose, and is never remembered.
 */

const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
const ROLE_ARN: string = `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/OneUptimeReadOnly-5f3a9c1e`;
const MEMBER: string = "444455556666";
const NAMESPACE_PREFIX: string = "oneuptime-aws-session-";
const NOW_MS: number = new Date("2026-11-20T12:00:00Z").getTime();
const HOUR_MS: number = 60 * 60 * 1000;

const connector: AwsCloudConnector = new AwsCloudConnector();

function roleSettings(
  config: Record<string, string> = {},
): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: FAKE_PROJECT_ID,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsRole,
      roleArn: ROLE_ARN,
      ...config,
    },
    secrets: {},
  };
}

// The session keys the cache holds: every other entry (a role check's verdict) is left out.
function rememberedKeys(cache: MemoryGlobalCache): Map<string, JSONObject> {
  return new Map(
    Array.from(cache.values.entries())
      .filter(([key]: [string, string]): boolean => {
        return key.startsWith(NAMESPACE_PREFIX);
      })
      .map(([key, value]: [string, string]): [string, JSONObject] => {
        return [key, JSON.parse(value) as JSONObject];
      }),
  );
}

let fake: FakeAws;

beforeEach(() => {
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
  process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
  process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
    "oneuptime-server-secret";
  jest.spyOn(Date, "now").mockReturnValue(NOW_MS);
  // Sessions last an hour from the clock's now.
  fake = createFakeAws({
    regions: { "us-east-1": { metrics: [] } },
    sessionSeconds: 3600,
  });
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AmazonSesProjectRole.useTransport(null);
  AwsServerIdentity.useCredentialChain(null);
  AwsServerIdentity.clearCache();
  AssumedRoleCache.clear();
  jest.restoreAllMocks();
});

describe("getCredentials", () => {
  test("remembers the ID of the key AWS handed a saved connection's session: connection, role, purpose and the session's life", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();

    const credentials: AwsCredentials = await connector.getCredentials(
      roleSettings(),
      { transport: fake.transport, connectionId: CONNECTION },
    );

    expect(Array.from(rememberedKeys(cache).entries())).toEqual([
      [
        `${NAMESPACE_PREFIX}${FAKE_PROJECT_ID}:${credentials.accessKeyId}`,
        {
          connectionId: CONNECTION,
          roleArn: ROLE_ARN,
          purpose: AwsRolePurpose.CloudConnect,
          issuedAtMs: NOW_MS,
          expiresAtMs: NOW_MS + HOUR_MS,
        },
      ],
    ]);

    const recalled: Map<string, OneUptimeAwsSessionKey> =
      await OneUptimeAwsSessions.recall(FAKE_PROJECT_ID, [
        credentials.accessKeyId,
      ]);

    expect(recalled.get(credentials.accessKeyId)).toEqual({
      connectionId: CONNECTION,
      roleArn: ROLE_ARN,
      purpose: AwsRolePurpose.CloudConnect,
      issuedAtMs: NOW_MS,
      expiresAtMs: NOW_MS + HOUR_MS,
    });
  });

  test("keeps the key's ID alone, never the secret or the session token, and for the session and two hours", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    // The spy the in-memory cache already put on it.
    const setString: SpyInstance<typeof GlobalCache.setString> = jest.spyOn(
      GlobalCache,
      "setString",
    );

    const credentials: AwsCredentials = await connector.getCredentials(
      roleSettings(),
      { transport: fake.transport, connectionId: CONNECTION },
    );
    const written: string = Array.from(cache.values.values()).join("\n");

    expect(written).not.toContain(credentials.secretAccessKey);
    expect(written).not.toContain(credentials.sessionToken || "no token");

    const sessionWrite: Parameters<typeof GlobalCache.setString> | undefined =
      setString.mock.calls.find(
        (call: Parameters<typeof GlobalCache.setString>): boolean => {
          return call[0] === "oneuptime-aws-session";
        },
      );

    expect(
      (sessionWrite![3] as { expiresInSeconds: number }).expiresInSeconds,
    ).toBe((HOUR_MS + ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS) / 1000);
  });

  test("a session reused from the cache was remembered when it was signed in to: no sign-in, nothing again", async () => {
    installMemoryGlobalCache();
    const remember: SpyInstance<typeof OneUptimeAwsSessions.remember> =
      jest.spyOn(OneUptimeAwsSessions, "remember");

    await connector.getCredentials(roleSettings(), {
      transport: fake.transport,
      connectionId: CONNECTION,
    });
    await connector.getCredentials(roleSettings(), {
      transport: fake.transport,
      connectionId: CONNECTION,
    });

    expect(remember).toHaveBeenCalledTimes(1);
  });

  test("an organization's member account is remembered with the role it was signed in to there", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    const settings: CloudConnectionSettings = roleSettings({
      readScope: CloudConnectionSetupScope.Organization,
    });

    const credentials: AwsCredentials = await connector.getCredentials(
      connector.settingsForAccount(settings, MEMBER),
      { transport: fake.transport, connectionId: CONNECTION },
    );

    expect(
      rememberedKeys(cache).get(
        `${NAMESPACE_PREFIX}${FAKE_PROJECT_ID}:${credentials.accessKeyId}`,
      ),
    ).toMatchObject({
      connectionId: CONNECTION,
      roleArn: `arn:aws:iam::${MEMBER}:role/OneUptimeReadOnly-5f3a9c1e`,
    });
  });

  test("settings never saved, and an access key connection, remember nothing", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();

    await connector.getCredentials(roleSettings(), {
      transport: fake.transport,
    });
    await connector.getCredentials(
      {
        provider: CloudProvider.AWS,
        projectId: FAKE_PROJECT_ID,
        config: {
          authMethod: CloudConnectionAuthMethod.AwsAccessKey,
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        },
        secrets: { secretAccessKey: "secret" },
      },
      { transport: fake.transport, connectionId: CONNECTION },
    );

    expect(rememberedKeys(cache).size).toBe(0);
  });

  test("a shared cache that cannot be reached never fails the sign-in", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    cache.failing = true;

    const credentials: AwsCredentials = await connector.getCredentials(
      roleSettings(),
      { transport: fake.transport, connectionId: CONNECTION },
    );

    expect(credentials.accessKeyId.startsWith("ASIA")).toBe(true);
    expect(rememberedKeys(cache).size).toBe(0);
  });

  test("a role refused at its check is never signed in to, and nothing is remembered", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    const refused: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      rolesTakingAnyExternalId: true,
    });

    await expect(
      connector.getCredentials(roleSettings(), {
        transport: refused.transport,
        connectionId: CONNECTION,
      }),
    ).rejects.toThrow();
    expect(rememberedKeys(cache).size).toBe(0);
  });
});

describe("a project's Amazon SES role", () => {
  test("signs in for its own purpose, and its key is never remembered as a connection's", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    const roleArn: string = "arn:aws:iam::210987654321:role/OneUptimeSes";
    const sts: FakeSts = createFakeSts({
      roles: [
        {
          arn: roleArn,
          trusts: [getAwsSesExternalIdForProject(FAKE_PROJECT_ID)],
        },
      ],
    });

    AwsServerIdentity.useCredentialChain(
      new AwsDefaultCredentialChain({
        env: { AWS_EC2_METADATA_DISABLED: "true" },
      }),
    );
    AmazonSesProjectRole.useTransport(
      sts.transport,
      async (): Promise<void> => {
        return;
      },
    );

    await AmazonSesProjectRole.getSession({
      projectId: FAKE_PROJECT_ID,
      configId: CONNECTION,
      roleArn,
      region: "eu-west-1",
    });

    // It signed in: a session was handed out, and none of it was remembered.
    expect(sts.sessions.length).toBeGreaterThan(0);
    expect(rememberedKeys(cache).size).toBe(0);
  });
});
