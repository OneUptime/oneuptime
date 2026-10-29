import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { gunzipSync, gzipSync } from "zlib";
import {
  AwsRestResponse,
  readXmlChildren,
  readXmlTags,
  sendAwsRestRequest,
} from "../../../../../Server/Utils/CloudConnection/Aws/AwsApi";
import AwsServerIdentity from "../../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { AssumedRoleCache } from "../../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../../Server/Utils/DataSource/HttpFetch";
import {
  AwsDataSecurityReadOptions,
  createAwsObjectStoreReader,
  readAwsDataSecurity,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityReader";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
  ObjectStoreListPage,
  ObjectStoreReader,
} from "../../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import LlmProviderError from "../../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import {
  AWS_DATA_SECURITY_CONFIGURATION_ACTIONS,
  CloudConnectionSetupScope,
} from "../../../../../Types/CloudConnection/CloudConnectionSetupCommands";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import {
  DataStoreExposure,
  getDataStoreExposure,
} from "../../../../../Types/DataSecurity/DataStorePosture";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeBucket,
  FakeRegion,
  awsError,
  createFakeAws,
  s3Error,
  stsError,
} from "../../CloudConnection/FakeAwsApi";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  sequence,
} from "../../LlmObservability/FakeProviderApi";

/*
 * AWS read for data security, against a fake AWS: each S3 bucket at its
 * own Region, public by its policy (as AWS judges it), by its ACL or not at
 * all once a public access block holds; principals of other accounts as
 * shared outside the connected ones; TLS required by a Deny; whose key
 * encrypts it. RDS's public instances and the snapshots everyone - or
 * another account - may restore; DynamoDB, Redshift, OpenSearch,
 * ElastiCache and EFS settings. What the role may not read is a null fact
 * and one warning, a refused credential fails the read, and the content
 * scanner's reader lists keys and reads only an object's first bytes.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const ROLE_ARN: string = `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/OneUptimeReadOnly-5f3a9c1e`;
// An account outside the project's, and one the project has connected too.
const OUTSIDE: string = "210987654321";
const PARTNER: string = "444455556666";
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const ALL_USERS: string = "http://acs.amazonaws.com/groups/global/AllUsers";
const AUTHENTICATED_USERS: string =
  "http://acs.amazonaws.com/groups/global/AuthenticatedUsers";

function keySettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: ACCESS_KEY_ID,
    },
    secrets: { secretAccessKey: SECRET },
  };
}

function roleSettings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: PROJECT,
    config: {
      authMethod: CloudConnectionAuthMethod.AwsRole,
      roleArn: ROLE_ARN,
    },
    secrets: {},
  };
}

function readOptions(
  fake: FakeAws,
  overrides: Partial<AwsDataSecurityReadOptions> = {},
): AwsDataSecurityReadOptions {
  return {
    projectId: new ObjectID(PROJECT),
    connectionId: new ObjectID(CONNECTION),
    connectedAccountIds: [PARTNER],
    regions: ["us-east-1"],
    transport: fake.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
    ...overrides,
  };
}

async function read(
  fake: FakeAws,
  overrides: Partial<AwsDataSecurityReadOptions> = {},
): Promise<CloudDataSecurityReadResult> {
  return await readAwsDataSecurity(keySettings(), readOptions(fake, overrides));
}

function storeNamed(
  result: CloudDataSecurityReadResult,
  name: string,
): CloudDataStoreRead {
  const store: CloudDataStoreRead | undefined = result.stores.find(
    (candidate: CloudDataStoreRead): boolean => {
      return candidate.identity.name === name;
    },
  );

  expect({ name, found: Boolean(store) }).toEqual({ name, found: true });
  return store!;
}

function fakeWithBuckets(
  buckets: Array<FakeBucket>,
  extra: Partial<Parameters<typeof createFakeAws>[0]> = {},
): FakeAws {
  return createFakeAws({
    regions: { "us-east-1": { metrics: [] } },
    buckets,
    ...extra,
  });
}

function fakeWithRegion(region: Omit<FakeRegion, "metrics">): FakeAws {
  return createFakeAws({
    regions: { "us-east-1": { metrics: [], ...region } },
  });
}

function publicEntries(store: CloudDataStoreRead): Array<DataStoreAccessEntry> {
  return store.access.filter((entry: DataStoreAccessEntry): boolean => {
    return entry.isPublic;
  });
}

const PUBLIC_READ_POLICY: JSONObject = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "PublicRead",
      Effect: "Allow",
      Principal: "*",
      Action: "s3:GetObject",
      Resource: "arn:aws:s3:::public-site/*",
    },
  ],
};

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
});

describe("S3 buckets", () => {
  test("a bucket whose policy lets everyone read is public, for the reason the policy gives", async () => {
    const fake: FakeAws = fakeWithBuckets([
      {
        name: "public-site",
        region: "us-east-1",
        policy: PUBLIC_READ_POLICY,
        isPublic: true,
        encryption: { algorithm: "AES256" },
        versioning: "Enabled",
        ownership: "BucketOwnerEnforced",
        tags: { team: "web" },
      },
      {
        // Everyone, but only through one VPC endpoint: AWS does not count it public.
        name: "vpc-only",
        region: "us-east-1",
        policy: {
          Statement: [
            {
              Effect: "Allow",
              Principal: "*",
              Action: "s3:GetObject",
              Resource: "arn:aws:s3:::vpc-only/*",
              Condition: { StringEquals: { "aws:SourceVpce": "vpce-1a2b3c" } },
            },
          ],
        },
        isPublic: false,
      },
    ]);

    const result: CloudDataSecurityReadResult = await read(fake);
    const bucket: CloudDataStoreRead = storeNamed(result, "public-site");

    expect(bucket.identity).toEqual({
      kind: DataStoreKind.AwsS3Bucket,
      name: "public-site",
      providerResourceId: "arn:aws:s3:::public-site",
      accountNumber: FAKE_ACCOUNT_ID,
      region: "us-east-1",
    });
    expect(bucket.posture).toMatchObject({
      readAt: NOW.toISOString(),
      publicRead: true,
      publicWrite: false,
      blockPublicAccess: false,
      encryptedAtRest: true,
      customerManagedKey: false,
      versioning: true,
      uniformAccess: true,
      accessLogging: false,
      encryptionInTransitEnforced: false,
      sharedWithExternal: [],
      replicationRegions: [],
    });
    expect(bucket.posture.publicReason).toBe(
      'The bucket policy lets everyone (Principal "*") call s3:GetObject.',
    );
    expect(publicEntries(bucket)).toEqual([
      {
        principal: "*",
        principalName: "Everyone",
        principalType: DataStorePrincipalType.Public,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "Bucket policy",
        isExternal: true,
        isPublic: true,
      },
    ]);
    expect(bucket.tags).toEqual({ team: "web" });
    expect(getDataStoreExposure(bucket.posture)).toBe(DataStoreExposure.Public);

    const vpcOnly: CloudDataStoreRead = storeNamed(result, "vpc-only");

    expect(vpcOnly.posture.publicRead).toBe(false);
    expect(vpcOnly.posture.publicReason).toBeUndefined();
    expect(publicEntries(vpcOnly)).toEqual([]);
    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  test("an ACL grant to AllUsers makes a bucket public, AuthenticatedUsers too - unless the bucket owner is enforced", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithBuckets([
        {
          name: "acl-read",
          region: "us-east-1",
          grants: [{ uri: ALL_USERS, permission: "READ" }],
        },
        {
          name: "acl-write",
          region: "us-east-1",
          grants: [{ uri: AUTHENTICATED_USERS, permission: "WRITE" }],
        },
        {
          // ACLs are off: the grant is still listed, and grants nothing.
          name: "acl-off",
          region: "us-east-1",
          ownership: "BucketOwnerEnforced",
          grants: [{ uri: ALL_USERS, permission: "READ" }],
        },
      ]),
    );

    const readable: CloudDataStoreRead = storeNamed(result, "acl-read");

    expect(readable.posture.publicRead).toBe(true);
    expect(readable.posture.publicWrite).toBe(false);
    expect(readable.posture.publicReason).toBe(
      "The ACL grants READ to everyone (AllUsers).",
    );
    expect(publicEntries(readable)).toEqual([
      expect.objectContaining({
        principal: "AllUsers",
        principalType: DataStorePrincipalType.Public,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "ACL",
      }),
    ]);
    // ACLs are on: the bucket owner is not enforced.
    expect(readable.posture.uniformAccess).toBe(false);

    const writable: CloudDataStoreRead = storeNamed(result, "acl-write");

    expect(writable.posture.publicRead).toBe(false);
    expect(writable.posture.publicWrite).toBe(true);
    expect(writable.posture.publicReason).toBe(
      "The ACL grants WRITE to any AWS account (AuthenticatedUsers).",
    );

    const off: CloudDataStoreRead = storeNamed(result, "acl-off");

    expect(off.posture.publicRead).toBe(false);
    expect(off.posture.uniformAccess).toBe(true);
    expect(publicEntries(off)).toEqual([]);
  });

  test("the account's public access block keeps a public policy and a public ACL from counting", async () => {
    const fake: FakeAws = fakeWithBuckets(
      [
        {
          name: "blocked",
          region: "us-east-1",
          policy: PUBLIC_READ_POLICY,
          isPublic: true,
          grants: [{ uri: ALL_USERS, permission: "READ" }],
        },
        {
          // Its own block holds only part: the account's holds the rest.
          name: "partly",
          region: "us-east-1",
          publicAccessBlock: {
            BlockPublicAcls: true,
            IgnorePublicAcls: false,
            BlockPublicPolicy: false,
            RestrictPublicBuckets: false,
          },
        },
      ],
      {
        accountPublicAccessBlock: {
          BlockPublicAcls: true,
          IgnorePublicAcls: true,
          BlockPublicPolicy: true,
          RestrictPublicBuckets: true,
        },
      },
    );

    const result: CloudDataSecurityReadResult = await read(fake);
    const blocked: CloudDataStoreRead = storeNamed(result, "blocked");

    expect(blocked.posture).toMatchObject({
      publicRead: false,
      publicWrite: false,
      blockPublicAccess: true,
    });
    expect(blocked.posture.publicReason).toBeUndefined();
    expect(publicEntries(blocked)).toEqual([]);
    expect(storeNamed(result, "partly").posture.blockPublicAccess).toBe(true);
    // The account's block is read once, at S3 Control, for every bucket.
    expect(
      fake.s3Calls.filter((call: FakeAws["s3Calls"][number]): boolean => {
        return call.subresource === "accountPublicAccessBlock";
      }),
    ).toEqual([
      expect.objectContaining({
        hostRegion: "us-east-1",
        signedRegion: "us-east-1",
      }),
    ]);
  });

  test("a bucket's own partial block is not a public access block, and an unread one is unknown", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithBuckets([
        {
          name: "partly",
          region: "us-east-1",
          publicAccessBlock: {
            BlockPublicAcls: true,
            IgnorePublicAcls: true,
            BlockPublicPolicy: true,
            RestrictPublicBuckets: false,
          },
        },
        {
          name: "unread",
          region: "us-east-1",
          errors: { publicAccessBlock: s3Error(403, "AccessDenied") },
        },
      ]),
    );

    expect(storeNamed(result, "partly").posture.blockPublicAccess).toBe(false);
    expect(storeNamed(result, "unread").posture.blockPublicAccess).toBeNull();
  });

  test("a principal of another account is shared with outside the connected ones; one of the connected accounts is not", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithBuckets([
        {
          name: "shared",
          region: "us-east-1",
          policy: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Allow",
                Principal: {
                  AWS: [
                    `arn:aws:iam::${OUTSIDE}:root`,
                    `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/app`,
                    `arn:aws:iam::${PARTNER}:role/partner-reader`,
                  ],
                },
                Action: ["s3:GetObject", "s3:ListBucket"],
                Resource: ["arn:aws:s3:::shared", "arn:aws:s3:::shared/*"],
              },
              {
                Effect: "Allow",
                Principal: { AWS: `arn:aws:iam::${OUTSIDE}:user/uploader` },
                Action: "s3:PutObject",
                Resource: "arn:aws:s3:::shared/*",
              },
            ],
          },
        },
      ]),
    );
    const bucket: CloudDataStoreRead = storeNamed(result, "shared");

    expect(bucket.posture.publicRead).toBe(false);
    expect(bucket.posture.sharedWithExternal).toEqual([OUTSIDE]);
    expect(getDataStoreExposure(bucket.posture)).toBe(
      DataStoreExposure.OtherAccounts,
    );
    expect(bucket.access).toEqual(
      expect.arrayContaining([
        {
          principal: `arn:aws:iam::${OUTSIDE}:root`,
          principalName: OUTSIDE,
          principalType: DataStorePrincipalType.Account,
          accessLevel: DataStoreAccessLevel.Read,
          grantedVia: "Bucket policy",
          isExternal: true,
          isPublic: false,
        },
        expect.objectContaining({
          principal: `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/app`,
          principalName: "app",
          principalType: DataStorePrincipalType.Role,
          isExternal: false,
        }),
        expect.objectContaining({
          principal: `arn:aws:iam::${PARTNER}:role/partner-reader`,
          principalType: DataStorePrincipalType.Role,
          isExternal: false,
        }),
        expect.objectContaining({
          principal: `arn:aws:iam::${OUTSIDE}:user/uploader`,
          principalName: "uploader",
          principalType: DataStorePrincipalType.User,
          accessLevel: DataStoreAccessLevel.Write,
          isExternal: true,
        }),
      ]),
    );
  });

  test("a Deny of requests without TLS enforces encryption in transit, and one of old TLS sets the minimum", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithBuckets([
        {
          name: "tls-only",
          region: "us-east-1",
          policy: {
            Version: "2012-10-17",
            Statement: [
              {
                Effect: "Deny",
                Principal: "*",
                Action: "s3:*",
                Resource: ["arn:aws:s3:::tls-only", "arn:aws:s3:::tls-only/*"],
                Condition: { Bool: { "aws:SecureTransport": "false" } },
              },
              {
                Effect: "Deny",
                Principal: "*",
                Action: "s3:*",
                Resource: "arn:aws:s3:::tls-only/*",
                Condition: { NumericLessThan: { "s3:TlsVersion": "1.2" } },
              },
            ],
          },
        },
        { name: "no-policy", region: "us-east-1" },
      ]),
    );
    const enforced: CloudDataStoreRead = storeNamed(result, "tls-only");

    expect(enforced.posture.encryptionInTransitEnforced).toBe(true);
    expect(enforced.posture.minimumTlsVersion).toBe("1.2");
    expect(enforced.posture.publicRead).toBe(false);
    expect(
      storeNamed(result, "no-policy").posture.encryptionInTransitEnforced,
    ).toBe(false);
  });

  test("SSE-KMS with a key of the customer's is a customer managed key; aws/s3, SSE-S3 and none are not", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithBuckets([
        {
          name: "own-key",
          region: "us-east-1",
          encryption: {
            algorithm: "aws:kms",
            kmsKeyId: `arn:aws:kms:us-east-1:${FAKE_ACCOUNT_ID}:key/1111-2222`,
          },
        },
        {
          name: "dsse",
          region: "us-east-1",
          encryption: { algorithm: "aws:kms:dsse", kmsKeyId: "1111-2222" },
        },
        {
          name: "aws-key",
          region: "us-east-1",
          encryption: {
            algorithm: "aws:kms",
            kmsKeyId: `arn:aws:kms:us-east-1:${FAKE_ACCOUNT_ID}:alias/aws/s3`,
          },
        },
        // aws:kms without a key named: S3's own aws/s3 key.
        {
          name: "kms-default",
          region: "us-east-1",
          encryption: { algorithm: "aws:kms" },
        },
        {
          name: "sse-s3",
          region: "us-east-1",
          encryption: { algorithm: "AES256" },
        },
        { name: "unencrypted", region: "us-east-1" },
      ]),
    );
    const keyOf: (name: string) => [unknown, unknown] = (
      name: string,
    ): [unknown, unknown] => {
      const posture: CloudDataStoreRead["posture"] = storeNamed(
        result,
        name,
      ).posture;

      return [posture.encryptedAtRest, posture.customerManagedKey];
    };

    expect(keyOf("own-key")).toEqual([true, true]);
    expect(keyOf("dsse")).toEqual([true, true]);
    expect(keyOf("aws-key")).toEqual([true, false]);
    expect(keyOf("kms-default")).toEqual([true, false]);
    expect(keyOf("sse-s3")).toEqual([true, false]);
    expect(keyOf("unencrypted")).toEqual([false, false]);
  });

  test("a GetBucketPolicy the role may not call leaves what it decides unknown, warns once for every bucket, and the rest is read", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
      "oneuptime-server-secret";

    const fake: FakeAws = fakeWithBuckets([
      {
        // AWS still says the policy is public: the bucket is, though what for is unknown.
        name: "verdict",
        region: "us-east-1",
        policy: PUBLIC_READ_POLICY,
        isPublic: true,
        versioning: "Enabled",
        errors: { policy: s3Error(403, "AccessDenied", "Access Denied") },
      },
      {
        name: "quiet",
        region: "us-east-1",
        errors: { policy: s3Error(403, "AccessDenied", "Access Denied") },
      },
    ]);

    const result: CloudDataSecurityReadResult = await readAwsDataSecurity(
      roleSettings(),
      readOptions(fake),
    );
    const verdict: CloudDataStoreRead = storeNamed(result, "verdict");

    expect(verdict.posture).toMatchObject({
      publicRead: true,
      publicWrite: null,
      encryptionInTransitEnforced: null,
      versioning: true,
      readWarnings: ["The role may not call s3:GetBucketPolicy."],
    });
    expect(verdict.posture.publicReason).toBe(
      "AWS reports the bucket policy as public.",
    );
    expect(verdict.posture.sharedWithExternal).toBeUndefined();
    expect(publicEntries(verdict)).toEqual([
      expect.objectContaining({ principal: "*", grantedVia: "Bucket policy" }),
    ]);

    const quiet: CloudDataStoreRead = storeNamed(result, "quiet");

    expect(quiet.posture.encryptionInTransitEnforced).toBeNull();
    expect(quiet.posture.sharedWithExternal).toBeUndefined();
    // AWS's verdict: no policy, so nothing public by one.
    expect(quiet.posture.publicRead).toBe(false);
    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.includes("s3:GetBucketPolicy");
      }),
    ).toEqual([
      "The role may not call s3:GetBucketPolicy. Run the data security setup command again to allow it.",
    ]);
    // A refused setting is a fact unknown, not a listing that stopped.
    expect(result.complete).toBe(true);
  });

  test("each bucket is read at, and signed for, its own Region; one the listing does not place is asked where it is", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": { metrics: [] },
        "eu-west-1": { metrics: [] },
        "ap-south-1": { metrics: [] },
      },
      buckets: [
        { name: "eu-data", region: "eu-west-1", replicateTo: ["mumbai-copy"] },
        { name: "mumbai-copy", region: "ap-south-1", hideRegion: true },
        { name: "virginia", region: "us-east-1" },
      ],
    });

    const result: CloudDataSecurityReadResult = await read(fake, {
      regions: ["us-east-1", "eu-west-1", "ap-south-1"],
    });

    expect(storeNamed(result, "eu-data").identity.region).toBe("eu-west-1");
    expect(storeNamed(result, "mumbai-copy").identity.region).toBe(
      "ap-south-1",
    );
    expect(storeNamed(result, "eu-data").posture.replicationRegions).toEqual([
      "ap-south-1",
    ]);

    const regionOf: Record<string, string> = {
      "eu-data": "eu-west-1",
      "mumbai-copy": "ap-south-1",
      virginia: "us-east-1",
    };

    for (const call of fake.s3Calls) {
      if (!call.bucket || call.subresource === "location") {
        continue;
      }

      expect([call.bucket, call.hostRegion, call.signedRegion]).toEqual([
        call.bucket,
        regionOf[call.bucket],
        regionOf[call.bucket],
      ]);
    }

    expect(
      fake.s3Calls
        .filter((call: FakeAws["s3Calls"][number]): boolean => {
          return call.subresource === "location";
        })
        .map((call: FakeAws["s3Calls"][number]): string => {
          return call.bucket;
        }),
    ).toEqual(["mumbai-copy"]);
    // ListBuckets asks for each bucket's Region: it is sent with a parameter.
    expect(
      fake.s3Calls.find((call: FakeAws["s3Calls"][number]): boolean => {
        return call.subresource === "buckets";
      })?.query,
    ).toEqual({ "max-buckets": "1000" });
    expect(result.warnings).toEqual([]);
  });

  test("a bucket asked at the wrong Region is asked again where S3's redirect says it is", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] }, "eu-west-1": { metrics: [] } },
      buckets: [
        {
          name: "moved",
          region: "eu-west-1",
          hideRegion: true,
          versioning: "Enabled",
          errors: { location: s3Error(403, "AccessDenied") },
        },
      ],
    });

    const result: CloudDataSecurityReadResult = await read(fake, {
      regions: ["us-east-1", "eu-west-1"],
    });
    const moved: CloudDataStoreRead = storeNamed(result, "moved");

    expect(moved.identity.region).toBe("eu-west-1");
    expect(moved.posture.versioning).toBe(true);
    expect(moved.posture.readWarnings).toBeUndefined();
    // One redirect, at the first setting; every other at eu-west-1.
    expect(
      fake.s3Calls
        .filter((call: FakeAws["s3Calls"][number]): boolean => {
          return call.bucket === "moved" && call.subresource !== "location";
        })
        .map((call: FakeAws["s3Calls"][number]): string => {
          return call.hostRegion;
        }),
    ).toEqual(["us-east-1", ...Array(10).fill("eu-west-1")]);
    expect(result.warnings).toEqual([
      "The access key may not call s3:GetBucketLocation. Run the data security setup command again to allow it.",
    ]);
  });

  test("named Regions keep the buckets of other Regions out", async () => {
    const fake: FakeAws = fakeWithBuckets([
      { name: "here", region: "us-east-1" },
      { name: "elsewhere", region: "eu-west-1" },
    ]);

    const result: CloudDataSecurityReadResult = await read(fake);

    expect(
      result.stores.map((store: CloudDataStoreRead): string => {
        return store.identity.name;
      }),
    ).toEqual(["here"]);
    expect(
      fake.s3Calls.some((call: FakeAws["s3Calls"][number]): boolean => {
        return call.bucket === "elsewhere";
      }),
    ).toBe(false);
  });

  test("a listing of every bucket that is refused leaves the read incomplete, said once", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithBuckets([], {
        bucketListError: s3Error(403, "AccessDenied", "Access Denied"),
      }),
    );

    expect(result.stores).toEqual([]);
    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      "The access key may not call s3:ListAllMyBuckets. Run the data security setup command again to allow it.",
    ]);
  });
});

describe("databases and the other stores", () => {
  const RDS_KEY: string = `arn:aws:kms:us-east-1:${FAKE_ACCOUNT_ID}:key/aws-rds-key`;

  test("RDS: a public instance, a snapshot everyone may restore and one shared with another account", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        kmsAliases: [
          { AliasName: "alias/aws/rds", TargetKeyId: "aws-rds-key" },
        ],
        dbInstances: [
          {
            DBInstanceIdentifier: "orders",
            // A change not made yet comes first, and is not the setting.
            PendingModifiedValues: { BackupRetentionPeriod: 0 },
            DBInstanceArn: `arn:aws:rds:us-east-1:${FAKE_ACCOUNT_ID}:db:orders`,
            Engine: "postgres",
            PubliclyAccessible: true,
            StorageEncrypted: true,
            KmsKeyId: RDS_KEY,
            BackupRetentionPeriod: 7,
            DeletionProtection: false,
            ReadReplicaDBInstanceIdentifiers: {
              ReadReplicaDBInstanceIdentifier: [
                `arn:aws:rds:eu-west-1:${FAKE_ACCOUNT_ID}:db:orders-eu`,
                "orders-replica",
              ],
            },
            TagList: { Tag: [{ Key: "team", Value: "payments" }] },
          },
          {
            DBInstanceIdentifier: "billing",
            DBInstanceArn: `arn:aws:rds:us-east-1:${FAKE_ACCOUNT_ID}:db:billing`,
            PubliclyAccessible: false,
            StorageEncrypted: true,
            KmsKeyId: `arn:aws:kms:us-east-1:${FAKE_ACCOUNT_ID}:key/customer-key`,
            BackupRetentionPeriod: 0,
            DeletionProtection: true,
          },
          {
            DBInstanceIdentifier: "ledger-1",
            DBClusterIdentifier: "ledger",
            PubliclyAccessible: true,
            StorageEncrypted: true,
          },
        ],
        dbClusters: [
          {
            DBClusterIdentifier: "ledger",
            DBClusterArn: `arn:aws:rds:us-east-1:${FAKE_ACCOUNT_ID}:cluster:ledger`,
            Engine: "aurora-postgresql",
            StorageEncrypted: true,
            KmsKeyId: RDS_KEY,
            BackupRetentionPeriod: 1,
            DeletionProtection: true,
            DBClusterMembers: {
              DBClusterMember: [
                { DBInstanceIdentifier: "ledger-1", IsClusterWriter: true },
              ],
            },
          },
        ],
        dbSnapshots: [
          { id: "orders-public", source: "orders", restore: ["all"] },
          {
            id: "orders-shared",
            source: "orders",
            restore: [OUTSIDE, PARTNER],
          },
          // Of a database since deleted: a store of its own.
          { id: "old-final", source: "deleted-db", restore: ["all"] },
        ],
      }),
    );
    const orders: CloudDataStoreRead = storeNamed(result, "orders");

    expect(orders.identity).toEqual({
      kind: DataStoreKind.AwsRdsInstance,
      name: "orders",
      providerResourceId: `arn:aws:rds:us-east-1:${FAKE_ACCOUNT_ID}:db:orders`,
      accountNumber: FAKE_ACCOUNT_ID,
      region: "us-east-1",
    });
    expect(orders.posture).toMatchObject({
      readAt: NOW.toISOString(),
      publicNetworkAccess: true,
      encryptedAtRest: true,
      customerManagedKey: false,
      backupRetentionDays: 7,
      backupsEnabled: true,
      deletionProtection: false,
      replicationRegions: ["eu-west-1"],
      snapshotPublic: true,
      snapshotSharedWith: [OUTSIDE],
    });
    expect(orders.tags).toEqual({ team: "payments" });
    expect(orders.access).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          principal: "*",
          principalType: DataStorePrincipalType.Public,
          grantedVia: "Public snapshot orders-public",
        }),
        {
          principal: OUTSIDE,
          principalType: DataStorePrincipalType.Account,
          accessLevel: DataStoreAccessLevel.Read,
          grantedVia: "Shared snapshot orders-shared",
          isExternal: true,
          isPublic: false,
        },
        expect.objectContaining({ principal: PARTNER, isExternal: false }),
      ]),
    );
    expect(getDataStoreExposure(orders.posture)).toBe(DataStoreExposure.Public);

    const billing: CloudDataStoreRead = storeNamed(result, "billing");

    expect(billing.posture).toMatchObject({
      publicNetworkAccess: false,
      customerManagedKey: true,
      backupRetentionDays: 0,
      backupsEnabled: false,
      deletionProtection: true,
      // Listed in full and none of its own: a fact.
      snapshotPublic: false,
      snapshotSharedWith: [],
    });
    expect(getDataStoreExposure(billing.posture)).toBe(
      DataStoreExposure.Private,
    );

    // An Aurora member is its cluster's: the cluster is the store.
    expect(
      result.stores.some((store: CloudDataStoreRead): boolean => {
        return store.identity.name === "ledger-1";
      }),
    ).toBe(false);

    const ledger: CloudDataStoreRead = storeNamed(result, "ledger");

    expect(ledger.identity.kind).toBe(DataStoreKind.AwsRdsCluster);
    expect(ledger.posture).toMatchObject({
      publicNetworkAccess: true,
      customerManagedKey: false,
      deletionProtection: true,
      snapshotPublic: false,
      snapshotSharedWith: [],
    });

    const orphan: CloudDataStoreRead = storeNamed(result, "old-final");

    expect(orphan.identity.kind).toBe(DataStoreKind.AwsRdsSnapshot);
    expect(orphan.posture.snapshotPublic).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.complete).toBe(true);
  });

  test("RDS: snapshots the role may not list leave the snapshot facts unknown", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        dbInstances: [
          {
            DBInstanceIdentifier: "orders",
            PubliclyAccessible: false,
            StorageEncrypted: false,
          },
        ],
        dataErrors: {
          "rds:DescribeDBSnapshots": {
            status: 403,
            body: "<ErrorResponse><Error><Code>AccessDenied</Code><Message>no</Message></Error></ErrorResponse>",
          },
        },
      }),
    );
    const orders: CloudDataStoreRead = storeNamed(result, "orders");

    expect(orders.posture.snapshotPublic).toBeNull();
    expect(orders.posture.snapshotSharedWith).toBeUndefined();
    expect(orders.posture.customerManagedKey).toBe(false);
    expect(result.warnings).toContain(
      "The access key may not call rds:DescribeDBSnapshots. Run the data security setup command again to allow it.",
    );
  });

  test("DynamoDB: point-in-time recovery off, AWS's key, and a table encrypted with the customer's own", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        dynamoTables: [
          {
            table: {
              TableName: "sessions",
              TableArn: `arn:aws:dynamodb:us-east-1:${FAKE_ACCOUNT_ID}:table/sessions`,
              TableSizeBytes: 2048,
              ItemCount: 12,
              DeletionProtectionEnabled: true,
              Replicas: [
                { RegionName: "eu-west-1" },
                { RegionName: "us-east-1" },
              ],
            },
            pointInTimeRecovery: false,
          },
          {
            table: {
              TableName: "orders",
              TableArn: `arn:aws:dynamodb:us-east-1:${FAKE_ACCOUNT_ID}:table/orders`,
              SSEDescription: {
                Status: "ENABLED",
                SSEType: "KMS",
                KMSMasterKeyArn: `arn:aws:kms:us-east-1:${FAKE_ACCOUNT_ID}:key/orders-key`,
              },
            },
            pointInTimeRecovery: true,
          },
        ],
      }),
    );
    const sessions: CloudDataStoreRead = storeNamed(result, "sessions");

    expect(sessions.identity.kind).toBe(DataStoreKind.AwsDynamoDbTable);
    expect(sessions.identity.providerResourceId).toBe(
      `arn:aws:dynamodb:us-east-1:${FAKE_ACCOUNT_ID}:table/sessions`,
    );
    expect(sessions.posture).toMatchObject({
      encryptedAtRest: true,
      customerManagedKey: false,
      pointInTimeRecovery: false,
      deletionProtection: true,
      replicationRegions: ["eu-west-1"],
    });
    expect(sessions.sizeInBytes).toBe(2048);
    expect(sessions.objectCount).toBe(12);

    expect(storeNamed(result, "orders").posture).toMatchObject({
      encryptedAtRest: true,
      customerManagedKey: true,
      pointInTimeRecovery: true,
      backupRetentionDays: 35,
      deletionProtection: false,
    });
  });

  test("Redshift: an unencrypted, public cluster without audit logging", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        redshiftClusters: [
          {
            ClusterIdentifier: "warehouse",
            // A pending change, before the setting itself: not the setting.
            PendingModifiedValues: { PubliclyAccessible: false },
            PubliclyAccessible: true,
            Encrypted: false,
            AutomatedSnapshotRetentionPeriod: 1,
            Tags: { Tag: [{ Key: "env", Value: "prod" }] },
          },
        ],
        redshiftLogging: { warehouse: false },
      }),
    );
    const warehouse: CloudDataStoreRead = storeNamed(result, "warehouse");

    expect(warehouse.identity).toMatchObject({
      kind: DataStoreKind.AwsRedshiftCluster,
      providerResourceId: `arn:aws:redshift:us-east-1:${FAKE_ACCOUNT_ID}:cluster:warehouse`,
    });
    expect(warehouse.posture).toMatchObject({
      publicNetworkAccess: true,
      encryptedAtRest: false,
      customerManagedKey: false,
      accessLogging: false,
      backupRetentionDays: 1,
      backupsEnabled: true,
    });
    expect(warehouse.tags).toEqual({ env: "prod" });
    expect(getDataStoreExposure(warehouse.posture)).toBe(
      DataStoreExposure.InternetReachable,
    );
  });

  test("OpenSearch: a domain whose access policy lets everyone in is public; in a VPC, or held to an address range, it is not", async () => {
    const openPolicy: string = JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: "*" },
          Action: "es:*",
          Resource: `arn:aws:es:us-east-1:${FAKE_ACCOUNT_ID}:domain/logs/*`,
        },
      ],
    });
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        kmsAliases: [{ AliasName: "alias/aws/es", TargetKeyId: "es-key" }],
        openSearchDomains: [
          {
            DomainName: "logs",
            ARN: `arn:aws:es:us-east-1:${FAKE_ACCOUNT_ID}:domain/logs`,
            AccessPolicies: openPolicy,
            EncryptionAtRestOptions: {
              Enabled: true,
              KmsKeyId: `arn:aws:kms:us-east-1:${FAKE_ACCOUNT_ID}:key/es-key`,
            },
            NodeToNodeEncryptionOptions: { Enabled: true },
            DomainEndpointOptions: {
              EnforceHTTPS: true,
              TLSSecurityPolicy: "Policy-Min-TLS-1-2-2019-07",
            },
          },
          {
            DomainName: "private-search",
            ARN: `arn:aws:es:us-east-1:${FAKE_ACCOUNT_ID}:domain/private-search`,
            VPCOptions: { VPCId: "vpc-1a2b" },
            AccessPolicies: openPolicy,
            EncryptionAtRestOptions: { Enabled: false },
            NodeToNodeEncryptionOptions: { Enabled: false },
            DomainEndpointOptions: {
              EnforceHTTPS: false,
              TLSSecurityPolicy: "Policy-Min-TLS-1-0-2019-07",
            },
          },
          {
            DomainName: "office-only",
            ARN: `arn:aws:es:us-east-1:${FAKE_ACCOUNT_ID}:domain/office-only`,
            AccessPolicies: JSON.stringify({
              Statement: [
                {
                  Effect: "Allow",
                  Principal: { AWS: "*" },
                  Action: "es:ESHttpGet",
                  Condition: {
                    IpAddress: { "aws:SourceIp": ["203.0.113.0/24"] },
                  },
                },
              ],
            }),
          },
        ],
      }),
    );
    const logs: CloudDataStoreRead = storeNamed(result, "logs");

    expect(logs.identity.kind).toBe(DataStoreKind.AwsOpenSearchDomain);
    expect(logs.posture).toMatchObject({
      publicRead: true,
      publicWrite: true,
      publicNetworkAccess: true,
      encryptedAtRest: true,
      customerManagedKey: false,
      encryptionInTransitEnforced: true,
      minimumTlsVersion: "1.2",
      accessLogging: false,
    });
    expect(logs.posture.publicReason).toBe(
      'The access policy lets everyone (Principal "*") call es:*, and the domain is not in a VPC.',
    );
    expect(publicEntries(logs)).toEqual([
      expect.objectContaining({
        principal: "*",
        accessLevel: DataStoreAccessLevel.Admin,
        grantedVia: "Access policy",
      }),
    ]);

    expect(storeNamed(result, "private-search").posture).toMatchObject({
      publicRead: false,
      publicNetworkAccess: false,
      encryptedAtRest: false,
      customerManagedKey: false,
      encryptionInTransitEnforced: false,
      minimumTlsVersion: "1.0",
    });
    expect(storeNamed(result, "office-only").posture).toMatchObject({
      publicRead: false,
      publicNetworkAccess: true,
    });
  });

  test("ElastiCache and EFS: how their data is encrypted", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        replicationGroups: [
          {
            ReplicationGroupId: "sessions-cache",
            ARN: `arn:aws:elasticache:us-east-1:${FAKE_ACCOUNT_ID}:replicationgroup:sessions-cache`,
            AtRestEncryptionEnabled: true,
            TransitEncryptionEnabled: true,
            // TLS offered, not required.
            TransitEncryptionMode: "preferred",
            SnapshotRetentionLimit: 0,
          },
        ],
        fileSystems: [
          {
            FileSystemId: "fs-0123",
            FileSystemArn: `arn:aws:elasticfilesystem:us-east-1:${FAKE_ACCOUNT_ID}:file-system/fs-0123`,
            Name: "shared",
            Encrypted: false,
            SizeInBytes: { Value: 6144 },
            Tags: [{ Key: "Name", Value: "shared" }],
          },
        ],
      }),
    );

    expect(storeNamed(result, "sessions-cache").posture).toMatchObject({
      encryptedAtRest: true,
      encryptionInTransitEnforced: false,
      customerManagedKey: false,
      backupsEnabled: false,
    });

    const files: CloudDataStoreRead = storeNamed(result, "shared");

    expect(files.identity.kind).toBe(DataStoreKind.AwsEfsFileSystem);
    expect(files.posture).toMatchObject({
      encryptedAtRest: false,
      customerManagedKey: false,
    });
    expect(files.sizeInBytes).toBe(6144);
    expect(files.tags).toEqual({ Name: "shared" });
  });
});

describe("the permissions the reader needs", () => {
  // The IAM action of each S3 call the fake saw.
  const S3_ACTIONS: Record<string, string> = {
    buckets: "s3:ListAllMyBuckets",
    location: "s3:GetBucketLocation",
    policyStatus: "s3:GetBucketPolicyStatus",
    publicAccessBlock: "s3:GetBucketPublicAccessBlock",
    accountPublicAccessBlock: "s3:GetAccountPublicAccessBlock",
    acl: "s3:GetBucketAcl",
    policy: "s3:GetBucketPolicy",
    encryption: "s3:GetEncryptionConfiguration",
    versioning: "s3:GetBucketVersioning",
    logging: "s3:GetBucketLogging",
    ownershipControls: "s3:GetBucketOwnershipControls",
    replication: "s3:GetReplicationConfiguration",
    tagging: "s3:GetBucketTagging",
  };

  test("a read of every kind of store calls exactly the actions of the configuration policy", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          dbInstances: [
            {
              DBInstanceIdentifier: "orders",
              StorageEncrypted: true,
              KmsKeyId: `arn:aws:kms:us-east-1:${FAKE_ACCOUNT_ID}:key/k1`,
            },
          ],
          dbClusters: [
            { DBClusterIdentifier: "ledger", StorageEncrypted: false },
          ],
          dbSnapshots: [{ id: "s1", source: "orders", restore: [] }],
          dbClusterSnapshots: [{ id: "c1", source: "ledger", restore: [] }],
          dynamoTables: [{ table: { TableName: "events" } }],
          redshiftClusters: [
            { ClusterIdentifier: "warehouse", Encrypted: true },
          ],
          openSearchDomains: [{ DomainName: "logs" }],
          replicationGroups: [{ ReplicationGroupId: "cache" }],
          fileSystems: [{ FileSystemId: "fs-1", Encrypted: true }],
        },
      },
      buckets: [
        { name: "placed-later", region: "us-east-1", hideRegion: true },
      ],
    });

    const result: CloudDataSecurityReadResult = await read(fake);
    const called: Set<string> = new Set<string>([
      ...fake.s3Calls.map((call: FakeAws["s3Calls"][number]): string => {
        return S3_ACTIONS[call.subresource] || `s3:?${call.subresource}`;
      }),
      ...fake.dataCalls.map((call: FakeAws["dataCalls"][number]): string => {
        return `${call.service}:${call.action}`;
      }),
    ]);

    expect(result.warnings).toEqual([]);
    expect(Array.from(called).sort()).toEqual(
      [...AWS_DATA_SECURITY_CONFIGURATION_ACTIONS].sort(),
    );
  });
});

describe("what cannot be read", () => {
  test("a credential AWS refuses fails the read, as the inventory's does", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      callerIdentityError: stsError(403, "InvalidClientTokenId", "bad key"),
    });

    const failure: unknown = await read(fake).catch(
      (error: unknown): unknown => {
        return error;
      },
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
  });

  test("a Region the account has not opted in to is skipped, and said when it was named", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        dynamoTables: [{ table: { TableName: "kept" } }],
      }),
      { regions: ["us-east-1", "ap-east-1"] },
    );

    expect(storeNamed(result, "kept").identity.region).toBe("us-east-1");
    expect(result.warnings).toEqual([
      "Could not read ap-east-1: the Region is not enabled for the account.",
    ]);
    expect(result.complete).toBe(true);
  });

  test("a listing the role may not call leaves the read incomplete, said once", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithRegion({
        dataErrors: {
          "dynamodb:ListTables": awsError(400, "AccessDeniedException", "no"),
        },
      }),
    );

    expect(result.complete).toBe(false);
    expect(result.warnings).toEqual([
      "The access key may not call dynamodb:ListTables. Run the data security setup command again to allow it.",
    ]);
  });

  test("a read past its budget stops, keeps what it read, and says so", async () => {
    const result: CloudDataSecurityReadResult = await read(
      fakeWithBuckets([
        { name: "first", region: "us-east-1" },
        { name: "second", region: "us-east-1" },
      ]),
      { budget: new CloudReadBudget({ maxRequests: 6, maxDurationMs: 60000 }) },
    );

    expect(result.complete).toBe(false);
    expect(result.warnings).toContain(
      "The read reached its limit for this run before every data store was read.",
    );
  });

  test("an organization is read account by account through each one's role; a member without it is a warning", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
      "oneuptime-server-secret";

    const member: string = "555566667777";
    const noRole: string = "333333333333";
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          dynamoTables: [{ table: { TableName: "events" } }],
        },
      },
      organizationAccounts: [
        { Id: FAKE_ACCOUNT_ID, Name: "Management", State: "ACTIVE" },
        { Id: member, Name: "Payments", State: "ACTIVE" },
        { Id: noRole, Name: "Sandbox", State: "ACTIVE" },
      ],
      refusedRoles: [`arn:aws:iam::${noRole}:role/OneUptimeReadOnly-5f3a9c1e`],
    });
    const settings: CloudConnectionSettings = roleSettings();

    settings.config["readScope"] = CloudConnectionSetupScope.Organization;

    const result: CloudDataSecurityReadResult = await readAwsDataSecurity(
      settings,
      readOptions(fake),
    );

    expect(
      result.stores.map((store: CloudDataStoreRead): string => {
        return store.identity.accountNumber;
      }),
    ).toEqual([FAKE_ACCOUNT_ID, member]);
    expect(
      fake.dataCalls
        .filter((call: FakeAws["dataCalls"][number]): boolean => {
          return call.action === "DescribeTable";
        })
        .map((call: FakeAws["dataCalls"][number]): string => {
          return call.account;
        }),
    ).toEqual([FAKE_ACCOUNT_ID, member]);
    expect(result.warnings).toEqual([
      `Could not sign in to Sandbox (${noRole}): its role is not there yet, or does not trust this OneUptime. The setup command's StackSet adds it to every account.`,
    ]);
    expect(result.complete).toBe(false);
  });

  test("settings of another project are not read", async () => {
    const fake: FakeAws = fakeWithBuckets([]);

    await expect(
      read(fake, {
        projectId: new ObjectID("22222222-2222-4222-8222-222222222222"),
      }),
    ).rejects.toThrow("another project");
    expect(fake.requests).toEqual([]);
  });
});

describe("the object store reader", () => {
  function readerOf(fake: FakeAws): ObjectStoreReader {
    return createAwsObjectStoreReader(keySettings(), {
      connectionId: new ObjectID(CONNECTION),
      bucket: "exports",
      region: "eu-west-1",
      accountNumber: FAKE_ACCOUNT_ID,
      transport: fake.transport,
      now: (): Date => {
        return NOW;
      },
      sleep: async (): Promise<void> => {},
    });
  }

  const CSV: string = "email,name\nx@example.com,X";

  function exportsFake(): FakeAws {
    return createFakeAws({
      regions: {},
      buckets: [
        {
          name: "exports",
          region: "eu-west-1",
          objects: [
            { key: "users/a b.csv", body: CSV },
            { key: "users/c+d.json", body: "{}" },
            { key: "users/old.csv", body: "x", storageClass: "GLACIER" },
            { key: "users/empty.txt", body: "" },
            { key: "other.txt", body: "other" },
          ],
        },
      ],
    });
  }

  test("lists a bucket's keys page by page, decoded, without the archived ones", async () => {
    const fake: FakeAws = exportsFake();
    const reader: ObjectStoreReader = readerOf(fake);

    expect(reader.description).toBe("s3://exports");

    const first: ObjectStoreListPage = await reader.listObjects({
      prefix: "users/",
      maxKeys: 2,
    });

    expect(first.objects).toEqual([
      {
        key: "users/a b.csv",
        sizeInBytes: Buffer.byteLength(CSV, "utf8"),
        lastModified: new Date("2026-10-01T00:00:00.000Z"),
        etag: "etag-users/a b.csv",
      },
      expect.objectContaining({ key: "users/c+d.json", sizeInBytes: 2 }),
    ]);
    expect(first.nextToken).toBe("2");

    const second: ObjectStoreListPage = await reader.listObjects({
      prefix: "users/",
      maxKeys: 2,
      nextToken: first.nextToken,
    });

    // users/empty.txt sorts first; the GLACIER object cannot be read and is left out.
    expect(
      second.objects.map((object: { key: string }): string => {
        return object.key;
      }),
    ).toEqual(["users/empty.txt"]);
    expect(second.nextToken).toBeUndefined();

    const list: FakeAws["s3Calls"][number] = fake.s3Calls.find(
      (call: FakeAws["s3Calls"][number]): boolean => {
        return call.subresource === "list";
      },
    )!;

    expect(list).toMatchObject({
      bucket: "exports",
      hostRegion: "eu-west-1",
      signedRegion: "eu-west-1",
      query: {
        "list-type": "2",
        "max-keys": "2",
        "encoding-type": "url",
        prefix: "users/",
      },
    });
  });

  test("reads only the first bytes of an object, with a range, and nothing of an empty one", async () => {
    const fake: FakeAws = exportsFake();
    const reader: ObjectStoreReader = readerOf(fake);

    const start: Uint8Array = await reader.readObjectStart("users/a b.csv", 5);

    expect(Buffer.from(start).toString("utf8")).toBe("email");
    expect(
      fake.s3Calls.find((call: FakeAws["s3Calls"][number]): boolean => {
        return call.subresource === "object";
      }),
    ).toMatchObject({
      bucket: "exports",
      key: "users/a b.csv",
      range: "bytes=0-4",
      signedRegion: "eu-west-1",
    });

    // Asking for more than there is gives what there is.
    expect(
      Buffer.from(
        await reader.readObjectStart("users/c+d.json", 4096),
      ).toString("utf8"),
    ).toBe("{}");
    expect(await reader.readObjectStart("users/empty.txt", 10)).toEqual(
      new Uint8Array(0),
    );
    expect(await reader.readObjectStart("users/a b.csv", 0)).toEqual(
      new Uint8Array(0),
    );
    // A key a URL would fold into another is not read.
    await expect(reader.readObjectStart("users/../secret", 10)).rejects.toThrow(
      "is not read",
    );
  });

  test("an object that is not text - a gzip - comes back byte for byte, and only reading an object asks the transport for bytes", async () => {
    const gzip: Buffer = gzipSync(Buffer.from(CSV, "utf8"));

    // Not valid UTF-8: text would not carry it whole.
    expect(Buffer.from(gzip.toString("utf8"), "utf8").equals(gzip)).toBe(false);

    const fake: FakeAws = createFakeAws({
      regions: {},
      buckets: [
        {
          name: "exports",
          region: "eu-west-1",
          objects: [{ key: "users.csv.gz", bytes: gzip }],
        },
      ],
    });
    const reader: ObjectStoreReader = readerOf(fake);

    const whole: Uint8Array = await reader.readObjectStart(
      "users.csv.gz",
      1024 * 1024,
    );

    expect(Buffer.from(whole).equals(gzip)).toBe(true);
    expect(gunzipSync(Buffer.from(whole)).toString("utf8")).toBe(CSV);

    const start: Uint8Array = await reader.readObjectStart("users.csv.gz", 10);

    expect(Buffer.from(start).equals(gzip.subarray(0, 10))).toBe(true);

    const listed: ObjectStoreListPage = await reader.listObjects({
      maxKeys: 10,
    });

    expect(listed.objects[0]!.sizeInBytes).toBe(gzip.length);
    // The listing, like every configuration answer, stays text.
    expect(
      fake.requests.map((request: DataSourceHttpRequest): boolean => {
        return Boolean(request.keepBodyBytes);
      }),
    ).toEqual([true, true, false]);
  });

  test("a key the bucket does not have is S3's own error", async () => {
    const failure: unknown = await readerOf(exportsFake())
      .readObjectStart("missing.csv", 10)
      .catch((error: unknown): unknown => {
        return error;
      });

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).statusCode).toBe(404);
  });

  test("only a bucket name and a Region are taken", () => {
    expect(() => {
      createAwsObjectStoreReader(keySettings(), {
        connectionId: new ObjectID(CONNECTION),
        bucket: "Not/A/Bucket",
        region: "eu-west-1",
        accountNumber: FAKE_ACCOUNT_ID,
      });
    }).toThrow("is not an S3 bucket name");
    expect(() => {
      createAwsObjectStoreReader(keySettings(), {
        connectionId: new ObjectID(CONNECTION),
        bucket: "exports",
        region: "mars-1",
        accountNumber: FAKE_ACCOUNT_ID,
      });
    }).toThrow("is not an AWS Region");
  });
});

describe("REST requests and the XML they answer with", () => {
  const credentials: { accessKeyId: string; secretAccessKey: string } = {
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET,
  };

  test("every element of a name, with attributes, empty ones, and names matched whole", () => {
    const xml: string =
      '<?xml version="1.0"?><R xmlns="x"><Buckets><Bucket><Name>a&amp;b</Name></Bucket><Bucket><Name>c</Name><BucketRegion>eu-west-1</BucketRegion></Bucket></Buckets><Grantee xmlns:xsi="y" xsi:type="Group"><URI>u&amp;v</URI></Grantee><Empty/></R>';

    expect(readXmlTags(xml, "Bucket")).toHaveLength(2);
    expect(readXmlTags(xml, "Buckets")).toHaveLength(1);
    expect(readXmlTags(xml, "Name")).toEqual(["a&b", "c"]);
    expect(readXmlTags(xml, "Grantee")).toEqual(["<URI>u&amp;v</URI>"]);
    // A parent's content is decoded once, when its leaf is read.
    expect(readXmlTags(readXmlTags(xml, "Grantee")[0]!, "URI")).toEqual([
      "u&v",
    ]);
    expect(readXmlTags(xml, "Empty")).toEqual([""]);
    expect(readXmlTags(xml, "Missing")).toEqual([]);
    expect(readXmlTags("<a><a>1</a><b>2</b></a><a>3</a>", "a")).toEqual([
      "<a>1</a><b>2</b>",
      "3",
    ]);
    expect(readXmlTags("<a>unclosed", "a")).toEqual([]);
  });

  test("an item's own fields, never the ones inside another element", () => {
    const item: string =
      "<PendingModifiedValues><BackupRetentionPeriod>0</BackupRetentionPeriod></PendingModifiedValues><BackupRetentionPeriod>7</BackupRetentionPeriod><Tag/>";

    expect(readXmlChildren(item, "BackupRetentionPeriod")).toEqual(["7"]);
    expect(readXmlChildren(item, "Tag")).toEqual([""]);
    expect(readXmlChildren(item, "Missing")).toEqual([]);
  });

  test("reading many elements stays linear", () => {
    const xml: string = `<R>${"<Bucket><Name>b</Name></Bucket>".repeat(50000)}</R>`;
    const timed: FastestRun<[number, number]> = fastestRun({
      run: (): [number, number] => {
        return [
          readXmlTags(xml, "Bucket").length,
          readXmlChildren(readXmlTags(xml, "R")[0]!, "Bucket").length,
        ];
      },
      limitInMs: 2000,
    });

    expect(timed.result).toEqual([50000, 50000]);
    expect(timed.inMs).toBeLessThan(2000);
  });

  test("signs a GET for the Region it is sent to, with S3's payload hash, and asks again when S3 says SlowDown", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/my-bucket",
        respond: sequence([
          s3Error(503, "SlowDown", "Please reduce your request rate."),
          {
            status: 200,
            body: "<PolicyStatus><IsPublic>FALSE</IsPublic></PolicyStatus>",
          },
        ]),
      },
    ]);
    const waits: Array<number> = [];

    const answer: AwsRestResponse = await sendAwsRestRequest({
      transport: api.transport,
      credentials,
      service: "s3",
      region: "eu-west-1",
      path: "/my-bucket",
      query: { policyStatus: "" },
      step: "bucket policy status request",
      providerTitle: "AWS S3",
      sleep: async (milliseconds: number): Promise<void> => {
        waits.push(milliseconds);
      },
    });

    expect(answer.status).toBe(200);
    expect(readXmlTags(answer.text, "IsPublic")).toEqual(["FALSE"]);
    expect(waits).toEqual([1000]);
    expect(api.requests).toHaveLength(2);
    expect(api.requests[1]!.url).toBe(
      "https://s3.eu-west-1.amazonaws.com/my-bucket?policyStatus=",
    );
    expect(api.requests[1]!.headers!["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(api.requests[1]!.headers!["Authorization"]).toContain(
      "/eu-west-1/s3/aws4_request",
    );
  });

  test("S3's unknown key is a refused credential, AccessDenied a refused permission", async () => {
    for (const [code, kind] of [
      ["InvalidAccessKeyId", CloudConnectionFailureKind.Authentication],
      ["AccessDenied", CloudConnectionFailureKind.Permission],
    ] as Array<[string, CloudConnectionFailureKind]>) {
      const api: FakeProviderApi = createFakeProviderApi([
        {
          path: "/",
          respond: (): FakeResponse => {
            return s3Error(403, code);
          },
        },
      ]);
      const failure: unknown = await sendAwsRestRequest({
        transport: api.transport,
        credentials,
        service: "s3",
        region: "us-east-1",
        path: "/",
        step: "bucket list request",
        providerTitle: "AWS S3",
      }).catch((error: unknown): unknown => {
        return error;
      });

      expect([code, (failure as LlmProviderError).kind]).toEqual([code, kind]);
    }
  });

  test("an object's own bytes are kept when asked, and cut to the bound; a configuration answer's bytes are its text's UTF-8, and the transport is not asked", async () => {
    // A gzip's first bytes, and bytes no UTF-8 text holds.
    const raw: Buffer = Buffer.from([
      0x1f, 0x8b, 0x08, 0x00, 0xff, 0xfe, 0x00, 0x41,
    ]);
    const asked: Array<boolean> = [];
    const transport: CloudConnectorTransport = async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      asked.push(Boolean(request.keepBodyBytes));

      return {
        statusCode: 206,
        bodyText: raw.toString("utf8"),
        bodyJson: undefined,
        headers: {},
        ...(request.keepBodyBytes ? { bodyBytes: raw } : {}),
      };
    };
    const send: (
      keepBytes: boolean,
      maxBodyBytes?: number | undefined,
    ) => Promise<AwsRestResponse> = async (
      keepBytes: boolean,
      maxBodyBytes?: number | undefined,
    ): Promise<AwsRestResponse> => {
      return await sendAwsRestRequest({
        transport,
        credentials,
        service: "s3",
        region: "us-east-1",
        path: "/b/k.gz",
        keepBytes,
        maxBodyBytes,
        step: "object read request",
        providerTitle: "AWS S3",
      });
    };

    const kept: AwsRestResponse = await send(true);

    expect(Buffer.from(kept.bytes).equals(raw)).toBe(true);
    expect(kept.truncated).toBe(false);
    expect(kept.text).toBe(raw.toString("utf8"));

    const cut: AwsRestResponse = await send(true, 3);

    expect(Buffer.from(cut.bytes).equals(raw.subarray(0, 3))).toBe(true);
    expect(cut.truncated).toBe(true);

    const text: AwsRestResponse = await send(false);

    expect(
      Buffer.from(text.bytes).equals(Buffer.from(raw.toString("utf8"), "utf8")),
    ).toBe(true);
    expect(Buffer.from(text.bytes).equals(raw)).toBe(false);
    expect(asked).toEqual([true, true, false]);
  });

  test("a body longer than its bound is cut, and a spent budget sends nothing", async () => {
    const api: FakeProviderApi = createFakeProviderApi([
      {
        path: "/b/k",
        respond: (): FakeResponse => {
          return { status: 206, body: "0123456789" };
        },
      },
    ]);

    const answer: AwsRestResponse = await sendAwsRestRequest({
      transport: api.transport,
      credentials,
      service: "s3",
      region: "us-east-1",
      path: "/b/k",
      maxBodyBytes: 4,
      step: "object read request",
      providerTitle: "AWS S3",
    });

    expect(answer.truncated).toBe(true);
    expect(Buffer.from(answer.bytes).toString("utf8")).toBe("0123");
    expect(answer.text).toBe("0123");

    const spent: CloudReadBudget = new CloudReadBudget({
      maxRequests: 0,
      maxDurationMs: 60000,
    });

    await expect(
      sendAwsRestRequest({
        transport: api.transport,
        credentials,
        service: "s3",
        region: "us-east-1",
        path: "/b/k",
        step: "object read request",
        providerTitle: "AWS S3",
        budget: spent,
      }),
    ).rejects.toBeInstanceOf(CloudReadBudgetSpent);
    expect(api.requests).toHaveLength(1);
  });
});
