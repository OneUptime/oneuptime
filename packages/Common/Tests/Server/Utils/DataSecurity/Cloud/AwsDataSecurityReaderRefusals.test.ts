import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AwsServerIdentity from "../../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { AssumedRoleCache } from "../../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import { CloudConnectionSettings } from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  AwsDataSecurityReadOptions,
  readAwsDataSecurity,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityReader";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
} from "../../../../../Server/Utils/DataSecurity/Cloud/DataSecurityCloudTypes";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import ObjectID from "../../../../../Types/ObjectID";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeBucket,
  FakeSnapshot,
  createFakeAws,
  queryError,
  s3Error,
} from "../../CloudConnection/FakeAwsApi";
import { FakeResponse } from "../../LlmObservability/FakeProviderApi";

/*
 * STOP ASKING WHAT AWS REFUSED (#10427). Every call AWS refuses is a
 * refused call in the customer's CloudTrail, and Security Events'
 * recommended Burst of access-denied API calls fires on twenty of them in
 * ten minutes. Data Security's read asks nothing it already knows the
 * answer to:
 *
 *   - an action no identity-based policy of the role allows is asked once
 *     in the account, and no bucket, snapshot, table or Region is asked it
 *     again;
 *   - a setting a bucket's own policy refused stops the bucket's other
 *     settings from being asked;
 *   - the warnings and facts stay as they were: what was not asked reads
 *     exactly as the refusal it stands for;
 *   - a refusal AWS gives no reason for, or another reason (a service
 *     control policy, an explicit deny in the role's own policy, which may
 *     name some resources only), is asked again each time, as before.
 *
 * AWS's messages are the ones its own access-denied documentation gives
 * ("Troubleshoot access denied error messages", IAM and S3 user guides),
 * for the role session OneUptime reads with.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION: string = "33333333-3333-4333-8333-333333333333";
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const NOW: Date = new Date("2026-11-20T12:07:00Z");
const SESSION_ARN: string = `arn:aws:sts::${FAKE_ACCOUNT_ID}:assumed-role/OneUptimeReadOnly-5f3a9c1e/OneUptime-33333333333343338333333333333333`;

// The settings of a bucket the read asks, in the order it asks them (BUCKET_PARTS).
const BUCKET_SETTINGS: Array<[string, string]> = [
  ["policyStatus", "s3:GetBucketPolicyStatus"],
  ["publicAccessBlock", "s3:GetBucketPublicAccessBlock"],
  ["acl", "s3:GetBucketAcl"],
  ["policy", "s3:GetBucketPolicy"],
  ["encryption", "s3:GetEncryptionConfiguration"],
  ["versioning", "s3:GetBucketVersioning"],
  ["logging", "s3:GetBucketLogging"],
  ["ownershipControls", "s3:GetBucketOwnershipControls"],
  ["replication", "s3:GetReplicationConfiguration"],
  ["tagging", "s3:GetBucketTagging"],
];

// What AWS answers when nothing the role holds allows the action: refused on every resource.
function noIdentityPolicyAllows(action: string, resource: string): string {
  return `User: ${SESSION_ARN} is not authorized to perform: ${action} on resource: "${resource}" because no identity-based policy allows the ${action} action`;
}

// What S3 answers when the bucket's own policy refuses the role (a VPC endpoint only policy).
function bucketPolicyDenies(action: string, bucket: string): string {
  return `User: ${SESSION_ARN} is not authorized to perform: ${action} on resource: "arn:aws:s3:::${bucket}" with an explicit deny in a resource-based policy`;
}

function bucketPolicyDeniesResponse(
  action: string,
  bucket: string,
): FakeResponse {
  return s3Error(403, "AccessDenied", bucketPolicyDenies(action, bucket));
}

// Every setting from `from` on, refused by the bucket's own policy, as AWS would answer each.
function refusedFrom(
  bucket: string,
  from: string,
): Record<string, FakeResponse> {
  const errors: Record<string, FakeResponse> = {};
  const start: number = BUCKET_SETTINGS.findIndex(
    ([subresource]: [string, string]): boolean => {
      return subresource === from;
    },
  );

  for (const [subresource, action] of BUCKET_SETTINGS.slice(start)) {
    errors[subresource] = bucketPolicyDeniesResponse(action, bucket);
  }

  return errors;
}

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

function readOptions(
  fake: FakeAws,
  regions: Array<string> = ["us-east-1"],
): AwsDataSecurityReadOptions {
  return {
    projectId: new ObjectID(PROJECT),
    connectionId: new ObjectID(CONNECTION),
    connectedAccountIds: [],
    regions,
    transport: fake.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
  };
}

async function read(
  fake: FakeAws,
  regions: Array<string> = ["us-east-1"],
): Promise<CloudDataSecurityReadResult> {
  return await readAwsDataSecurity(keySettings(), readOptions(fake, regions));
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

// The settings the read asked a bucket, in order.
function askedOf(fake: FakeAws, bucket: string): Array<string> {
  return fake.s3Calls
    .filter((call: { bucket: string }): boolean => {
      return call.bucket === bucket;
    })
    .map((call: { subresource: string }): string => {
      return call.subresource;
    });
}

// How many times the read asked a setting, of every bucket.
function timesAsked(fake: FakeAws, subresource: string): number {
  return fake.s3Calls.filter((call: { subresource: string }): boolean => {
    return call.subresource === subresource;
  }).length;
}

function dataCallsOf(fake: FakeAws, service: string, action: string): number {
  return fake.dataCalls.filter(
    (call: { service: string; action: string }): boolean => {
      return call.service === service && call.action === action;
    },
  ).length;
}

// A store's facts and lines, without what names it.
function postureOf(store: CloudDataStoreRead): CloudDataStoreRead["posture"] {
  return { ...store.posture };
}

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a bucket whose own policy refuses the role", () => {
  test("a refused GetBucketPolicy: the reader asks that bucket no other setting, and reads every other bucket whole", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: [
        {
          name: "vpc-only",
          region: "us-east-1",
          versioning: "Enabled",
          encryption: { algorithm: "AES256" },
          // Asked, the rest would be read; the bucket's policy refused the role GetBucketPolicy.
          errors: {
            policy: bucketPolicyDeniesResponse(
              "s3:GetBucketPolicy",
              "vpc-only",
            ),
          },
        },
        { name: "open", region: "us-east-1", versioning: "Enabled" },
      ],
    });

    const result: CloudDataSecurityReadResult = await read(fake);

    // Everything up to the refusal was asked; nothing after it.
    expect(askedOf(fake, "vpc-only")).toEqual([
      "policyStatus",
      "publicAccessBlock",
      "acl",
      "policy",
    ]);
    // The other bucket is read whole.
    expect(askedOf(fake, "open")).toEqual(
      BUCKET_SETTINGS.map(([subresource]: [string, string]): string => {
        return subresource;
      }),
    );

    const vpcOnly: CloudDataStoreRead = storeNamed(result, "vpc-only");

    // What was not asked is unknown, as a refusal leaves it.
    expect(vpcOnly.posture.versioning).toBeNull();
    expect(vpcOnly.posture.encryptedAtRest).toBeNull();
    expect(storeNamed(result, "open").posture.versioning).toBe(true);
  });

  test("the bucket reads exactly as it did when every setting after the refusal was asked and refused", async () => {
    const buckets: Array<FakeBucket> = [
      {
        name: "locked",
        region: "us-east-1",
        versioning: "Enabled",
        encryption: { algorithm: "AES256" },
        errors: {
          policy: bucketPolicyDeniesResponse("s3:GetBucketPolicy", "locked"),
        },
      },
    ];
    const skipped: CloudDataSecurityReadResult = await read(
      createFakeAws({ regions: { "us-east-1": { metrics: [] } }, buckets }),
    );

    // The same bucket, as AWS answers every setting it would have been asked.
    const everyAnswer: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: [{ ...buckets[0]!, errors: refusedFrom("locked", "policy") }],
    });
    const answered: CloudDataSecurityReadResult = await readAwsDataSecurity(
      keySettings(),
      readOptions(everyAnswer),
    );

    expect(postureOf(storeNamed(skipped, "locked"))).toEqual(
      postureOf(storeNamed(answered, "locked")),
    );
    expect(skipped.warnings).toEqual(answered.warnings);
    expect(storeNamed(skipped, "locked").posture.readWarnings).toEqual([
      "The access key may not call s3:GetBucketPolicy.",
      "The access key may not call s3:GetEncryptionConfiguration.",
      "The access key may not call s3:GetBucketVersioning.",
      "The access key may not call s3:GetBucketLogging.",
      "The access key may not call s3:GetBucketOwnershipControls.",
      "The access key may not call s3:GetReplicationConfiguration.",
      "The access key may not call s3:GetBucketTagging.",
    ]);
    expect(skipped.complete).toBe(true);
  });

  test("a bucket that refuses its first setting is asked nothing else", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: [
        {
          name: "endpoint-only",
          region: "us-east-1",
          errors: refusedFrom("endpoint-only", "policyStatus"),
        },
      ],
    });

    const result: CloudDataSecurityReadResult = await read(fake);

    expect(askedOf(fake, "endpoint-only")).toEqual(["policyStatus"]);
    expect(
      storeNamed(result, "endpoint-only").posture.readWarnings,
    ).toHaveLength(BUCKET_SETTINGS.length);
  });

  test("a refusal that says no resource-based policy allows the role stops the bucket too", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: [
        {
          name: "no-grant",
          region: "us-east-1",
          errors: {
            acl: s3Error(
              403,
              "AccessDenied",
              `User: ${SESSION_ARN} is not authorized to perform: s3:GetBucketAcl because no resource-based policy allows the s3:GetBucketAcl action`,
            ),
          },
        },
      ],
    });

    await read(fake);

    expect(askedOf(fake, "no-grant")).toEqual([
      "policyStatus",
      "publicAccessBlock",
      "acl",
    ]);
  });

  test.each<[string, string]>([
    ["no reason, as S3 answers across accounts", "Access Denied"],
    [
      "a service control policy",
      `User: ${SESSION_ARN} is not authorized to perform: s3:GetBucketPolicy with an explicit deny in a service control policy`,
    ],
    [
      "an explicit deny in the role's own policy, which may name this bucket only",
      `User: ${SESSION_ARN} is not authorized to perform: s3:GetBucketPolicy on resource: "arn:aws:s3:::guarded" with an explicit deny in an identity-based policy`,
    ],
    [
      "a resource control policy, which is not the bucket's own",
      `User: ${SESSION_ARN} is not authorized to perform: s3:GetBucketPolicy on resource: "arn:aws:s3:::guarded" with an explicit deny in a resource control policy`,
    ],
  ])(
    "a refusal for %s does not stop the bucket's other settings",
    async (_reason: string, message: string) => {
      const fake: FakeAws = createFakeAws({
        regions: { "us-east-1": { metrics: [] } },
        buckets: [
          {
            name: "guarded",
            region: "us-east-1",
            versioning: "Enabled",
            errors: { policy: s3Error(403, "AccessDenied", message) },
          },
        ],
      });

      const result: CloudDataSecurityReadResult = await read(fake);

      expect(askedOf(fake, "guarded")).toEqual(
        BUCKET_SETTINGS.map(([subresource]: [string, string]): string => {
          return subresource;
        }),
      );
      expect(storeNamed(result, "guarded").posture.versioning).toBe(true);
    },
  );
});

describe("an action no identity-based policy of the role allows", () => {
  // Eight buckets: more than are read at once, so some wait for the first answer.
  const NAMES: Array<string> = [
    "a-bucket",
    "b-bucket",
    "c-bucket",
    "d-bucket",
    "e-bucket",
    "f-bucket",
    "g-bucket",
    "h-bucket",
  ];

  function bucketsRefusing(
    subresource: string,
    message: (bucket: string) => string,
  ): Array<FakeBucket> {
    return NAMES.map((name: string): FakeBucket => {
      return {
        name,
        region: "us-east-1",
        versioning: "Enabled",
        encryption: { algorithm: "AES256" },
        errors: { [subresource]: s3Error(403, "AccessDenied", message(name)) },
      };
    });
  }

  test("is asked once in the account: no other bucket is asked it again, and every other setting is still read", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: bucketsRefusing("versioning", (bucket: string): string => {
        return noIdentityPolicyAllows(
          "s3:GetBucketVersioning",
          `arn:aws:s3:::${bucket}`,
        );
      }),
    });

    const result: CloudDataSecurityReadResult = await read(fake);

    expect(timesAsked(fake, "versioning")).toBe(1);

    for (const name of NAMES) {
      const store: CloudDataStoreRead = storeNamed(result, name);

      // Every bucket's versioning is unknown, and says so, as when each was refused.
      expect(store.posture.versioning).toBeNull();
      expect(store.posture.readWarnings).toEqual([
        "The access key may not call s3:GetBucketVersioning.",
      ]);
      // The rest of the bucket is read.
      expect(store.posture.encryptedAtRest).toBe(true);
      expect(
        askedOf(fake, name).filter((subresource: string): boolean => {
          return subresource !== "versioning";
        }),
      ).toEqual(
        BUCKET_SETTINGS.map(([subresource]: [string, string]): string => {
          return subresource;
        }).filter((subresource: string): boolean => {
          return subresource !== "versioning";
        }),
      );
    }

    // One warning for the account, as before.
    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.includes("s3:GetBucketVersioning");
      }),
    ).toEqual([
      "The access key may not call s3:GetBucketVersioning. Run the data security setup command again to allow it.",
    ]);
  });

  test("the read is the same as when every bucket was asked and refused", async () => {
    const skipped: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: bucketsRefusing("logging", (bucket: string): string => {
        return noIdentityPolicyAllows(
          "s3:GetBucketLogging",
          `arn:aws:s3:::${bucket}`,
        );
      }),
    });
    // No reason given: each bucket is asked and refused, as before.
    const askedEach: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: bucketsRefusing("logging", (): string => {
        return "Access Denied";
      }),
    });

    const once: CloudDataSecurityReadResult = await read(skipped);
    const each: CloudDataSecurityReadResult = await read(askedEach);

    expect(timesAsked(skipped, "logging")).toBe(1);
    expect(timesAsked(askedEach, "logging")).toBe(NAMES.length);
    expect(once.warnings).toEqual(each.warnings);

    for (const name of NAMES) {
      expect(postureOf(storeNamed(once, name))).toEqual(
        postureOf(storeNamed(each, name)),
      );
    }
  });

  test("a refusal that gives no reason is asked of every bucket, as before", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: bucketsRefusing("tagging", (): string => {
        return "Access Denied";
      }),
    });

    await read(fake);

    expect(timesAsked(fake, "tagging")).toBe(NAMES.length);
  });

  test("a bucket whose answer is not a refusal does not stop the next from being asked", async () => {
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: NAMES.map((name: string, index: number): FakeBucket => {
        return {
          name,
          region: "us-east-1",
          // Only the last bucket refuses it, and for its own policy.
          ...(index === NAMES.length - 1
            ? {
                errors: {
                  replication: bucketPolicyDeniesResponse(
                    "s3:GetReplicationConfiguration",
                    name,
                  ),
                },
              }
            : {}),
        };
      }),
    });

    await read(fake);

    expect(timesAsked(fake, "replication")).toBe(NAMES.length);
  });

  test("RDS: who may restore each snapshot is asked once, not once a snapshot", async () => {
    const snapshots: Array<FakeSnapshot> = Array.from(
      { length: 25 },
      (_value: unknown, index: number): FakeSnapshot => {
        return { id: `nightly-${index + 1}`, source: "orders" };
      },
    );
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          dbInstances: [
            {
              DBInstanceIdentifier: "orders",
              PubliclyAccessible: false,
              StorageEncrypted: true,
            },
          ],
          dbSnapshots: snapshots,
          dataErrors: {
            "rds:DescribeDBSnapshotAttributes": queryError(
              403,
              "AccessDenied",
              noIdentityPolicyAllows(
                "rds:DescribeDBSnapshotAttributes",
                `arn:aws:rds:us-east-1:${FAKE_ACCOUNT_ID}:snapshot:nightly-1`,
              ),
            ),
          },
        },
      },
    });

    const result: CloudDataSecurityReadResult = await read(fake);

    expect(dataCallsOf(fake, "rds", "DescribeDBSnapshotAttributes")).toBe(1);
    // Who may restore them is unknown, as when each was refused.
    expect(storeNamed(result, "orders").posture.snapshotPublic).toBeNull();
    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.includes("rds:DescribeDBSnapshotAttributes");
      }),
    ).toEqual([
      "The access key may not call rds:DescribeDBSnapshotAttributes. Run the data security setup command again to allow it.",
    ]);
  });

  test("RDS: with no reason given, each snapshot is still asked, as before", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          dbInstances: [
            {
              DBInstanceIdentifier: "orders",
              PubliclyAccessible: false,
              StorageEncrypted: true,
            },
          ],
          dbSnapshots: [
            { id: "nightly-1", source: "orders" },
            { id: "nightly-2", source: "orders" },
            { id: "nightly-3", source: "orders" },
          ],
          dataErrors: {
            "rds:DescribeDBSnapshotAttributes": queryError(
              403,
              "AccessDenied",
              "no",
            ),
          },
        },
      },
    });

    await read(fake);

    expect(dataCallsOf(fake, "rds", "DescribeDBSnapshotAttributes")).toBe(3);
  });

  test("DynamoDB: a listing refused in one Region is not asked in the others", async () => {
    const refusal: FakeResponse = {
      status: 400,
      body: JSON.stringify({
        __type: "com.amazon.coral.service#AccessDeniedException",
        Message: noIdentityPolicyAllows(
          "dynamodb:ListTables",
          `arn:aws:dynamodb:us-east-1:${FAKE_ACCOUNT_ID}:table/*`,
        ),
      }),
    };
    const regions: Array<string> = [
      "us-east-1",
      "us-east-2",
      "us-west-2",
      "eu-west-1",
      "eu-central-1",
    ];
    const fake: FakeAws = createFakeAws({
      regions: Object.fromEntries(
        regions.map((region: string) => {
          return [
            region,
            { metrics: [], dataErrors: { "dynamodb:ListTables": refusal } },
          ];
        }),
      ),
    });

    const result: CloudDataSecurityReadResult = await read(fake, regions);

    expect(dataCallsOf(fake, "dynamodb", "ListTables")).toBe(1);
    expect(
      result.warnings.filter((warning: string): boolean => {
        return warning.includes("dynamodb:ListTables");
      }),
    ).toEqual([
      "The access key may not call dynamodb:ListTables. Run the data security setup command again to allow it.",
    ]);
  });

  test("the next read asks again, so a role given the action since is read in full", async () => {
    // What a read knows of an account lasts that read: the role may be fixed before the next.
    const fake: FakeAws = createFakeAws({
      regions: { "us-east-1": { metrics: [] } },
      buckets: bucketsRefusing("versioning", (bucket: string): string => {
        return noIdentityPolicyAllows(
          "s3:GetBucketVersioning",
          `arn:aws:s3:::${bucket}`,
        );
      }),
    });

    await read(fake);
    await read(fake);

    expect(timesAsked(fake, "versioning")).toBe(2);
  });
});
