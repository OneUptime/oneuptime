import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { createHash } from "crypto";
import AwsServerIdentity from "../../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { AssumedRoleCache } from "../../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import {
  CloudConnectionSettings,
  CloudReadBudget,
  CloudReadBudgetSpent,
} from "../../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSecurityResponseOutcome,
  S3_BLOCK_ALL_PUBLIC_ACCESS_XML,
  S3_BUCKET_OWNER_ENFORCED_XML,
  S3_VERSIONING_ENABLED_XML,
  blockS3BucketPublicAccess,
  enforceS3BucketOwnership,
  isDynamoDbTableName,
  revokeRdsSnapshotSharing,
  turnOnDynamoDbPointInTimeRecovery,
  turnOnS3BucketVersioning,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsDataSecurityResponse";
import LlmProviderError from "../../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  FAKE_ACCOUNT_ID,
  FakeAws,
  FakeBucket,
  FakeRegion,
  FakeSnapshot,
  FakeTable,
  awsError,
  createFakeAws,
  queryError,
  s3Error,
} from "../../CloudConnection/FakeAwsApi";

/*
 * Closing a data store's exposure on AWS, against a fake AWS: a bucket's
 * four Block Public Access settings turned on with S3's checksum and its
 * owner named - and left alone, nothing written, when they are on already;
 * a manual RDS snapshot no longer restorable by everyone or by accounts
 * outside the connected ones, its connected shares kept - and nothing
 * written when it is not shared. A refusal says which setting grants the
 * permission, and a bucket of the same name in another account is never
 * touched.
 */

const PROJECT: string = "11111111-1111-4111-8111-111111111111";
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ACCESS_KEY_ID: string = "AKIAIOSFODNN7EXAMPLE";
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const ROLE_ARN: string = `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/OneUptimeReadOnly-5f3a9c1e`;
const OUTSIDE: string = "210987654321";
const PARTNER: string = "444455556666";
const NOW: Date = new Date("2026-10-21T12:07:00Z");

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

function clock(): { now: () => Date; sleep: () => Promise<void> } {
  return {
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
  };
}

function s3Writes(fake: FakeAws): Array<FakeAws["s3Calls"][number]> {
  return fake.s3Calls.filter((call: FakeAws["s3Calls"][number]): boolean => {
    return call.method === "PUT";
  });
}

function rdsActions(fake: FakeAws): Array<string> {
  return fake.dataCalls.map((call: FakeAws["dataCalls"][number]): string => {
    return call.action;
  });
}

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

describe("blocking a bucket's public access", () => {
  function bucketFake(bucket: Partial<FakeBucket> = {}): {
    fake: FakeAws;
    bucket: FakeBucket;
  } {
    const exposed: FakeBucket = {
      name: "exposed",
      region: "eu-west-1",
      ...bucket,
    };

    return {
      fake: createFakeAws({ regions: {}, buckets: [exposed] }),
      bucket: exposed,
    };
  }

  async function block(
    fake: FakeAws,
    accountNumber: string = FAKE_ACCOUNT_ID,
  ): Promise<DataSecurityResponseOutcome> {
    return await blockS3BucketPublicAccess(keySettings(), {
      connectionId: CONNECTION,
      bucket: "exposed",
      region: "eu-west-1",
      accountNumber,
      transport: fake.transport,
      ...clock(),
    });
  }

  test("turns on all four settings of a bucket that has none, with S3's checksum and the bucket's owner named, and says which were off", async () => {
    const { fake, bucket }: { fake: FakeAws; bucket: FakeBucket } =
      bucketFake();

    const outcome: DataSecurityResponseOutcome = await block(fake);

    expect(outcome).toEqual({
      changed: true,
      summary:
        "Turned on all four Block Public Access settings of bucket exposed (BlockPublicAcls, IgnorePublicAcls, BlockPublicPolicy and RestrictPublicBuckets were off).",
    });

    const writes: Array<FakeAws["s3Calls"][number]> = s3Writes(fake);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      bucket: "exposed",
      subresource: "putPublicAccessBlock",
      hostRegion: "eu-west-1",
      signedRegion: "eu-west-1",
      query: { publicAccessBlock: "" },
      body: S3_BLOCK_ALL_PUBLIC_ACCESS_XML,
    });
    expect(writes[0]!.headers["content-md5"]).toBe(
      createHash("md5")
        .update(S3_BLOCK_ALL_PUBLIC_ACCESS_XML, "utf8")
        .digest("base64"),
    );
    expect(writes[0]!.headers["content-type"]).toBe("application/xml");
    expect(writes[0]!.headers["x-amz-expected-bucket-owner"]).toBe(
      FAKE_ACCOUNT_ID,
    );
    expect(writes[0]!.headers["x-amz-content-sha256"]).toBe(
      createHash("sha256")
        .update(S3_BLOCK_ALL_PUBLIC_ACCESS_XML, "utf8")
        .digest("hex"),
    );
    // The body names every setting, on.
    expect(S3_BLOCK_ALL_PUBLIC_ACCESS_XML).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><BlockPublicAcls>true</BlockPublicAcls><IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets></PublicAccessBlockConfiguration>',
    );
    // The read came first, and named the owner too.
    expect(fake.s3Calls[0]).toMatchObject({
      method: "GET",
      subresource: "publicAccessBlock",
    });
    expect(fake.s3Calls[0]!.headers["x-amz-expected-bucket-owner"]).toBe(
      FAKE_ACCOUNT_ID,
    );
    expect(bucket.publicAccessBlock).toEqual({
      BlockPublicAcls: true,
      IgnorePublicAcls: true,
      BlockPublicPolicy: true,
      RestrictPublicBuckets: true,
    });

    // Run again: nothing to change, nothing written.
    expect(await block(fake)).toEqual({
      changed: false,
      summary:
        "All four Block Public Access settings of bucket exposed were already on; nothing changed.",
    });
    expect(s3Writes(fake)).toHaveLength(1);
  });

  test("a bucket with some of the four on gets the rest, and the summary names what was off", async () => {
    const { fake }: { fake: FakeAws } = bucketFake({
      publicAccessBlock: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: false,
      },
    });

    expect(await block(fake)).toEqual({
      changed: true,
      summary:
        "Turned on all four Block Public Access settings of bucket exposed (RestrictPublicBuckets was off).",
    });
    expect(s3Writes(fake)).toHaveLength(1);
  });

  test("a bucket already blocked is left alone: nothing is written", async () => {
    const { fake }: { fake: FakeAws } = bucketFake({
      publicAccessBlock: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    });

    expect((await block(fake)).changed).toBe(false);
    expect(s3Writes(fake)).toEqual([]);
  });

  test("a write the role may not make says which setting grants it", async () => {
    process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"] = "AKIAONEUPTIMESERVER1";
    process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"] =
      "oneuptime-server-secret";

    const { fake }: { fake: FakeAws } = bucketFake({
      errors: {
        putPublicAccessBlock: s3Error(403, "AccessDenied", "Access Denied"),
      },
    });

    const failure: unknown = await blockS3BucketPublicAccess(
      {
        provider: CloudProvider.AWS,
        projectId: PROJECT,
        config: {
          authMethod: CloudConnectionAuthMethod.AwsRole,
          roleArn: ROLE_ARN,
        },
        secrets: {},
      },
      {
        connectionId: CONNECTION,
        bucket: "exposed",
        region: "eu-west-1",
        accountNumber: FAKE_ACCOUNT_ID,
        transport: fake.transport,
        ...clock(),
      },
    ).catch((error: unknown): unknown => {
      return error;
    });

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as LlmProviderError).message).toBe(
      "AWS refused s3:PutBucketPublicAccessBlock on bucket exposed: the role may not call it, or the bucket is not in the account named. Turn on Data security response for the connection, and run its setup command again.",
    );
  });

  test("a bucket of the same name in another account is never touched", async () => {
    const { fake, bucket }: { fake: FakeAws; bucket: FakeBucket } =
      bucketFake();

    await expect(block(fake, OUTSIDE)).rejects.toBeInstanceOf(LlmProviderError);
    expect(s3Writes(fake)).toEqual([]);
    expect(bucket.publicAccessBlock).toBeUndefined();
  });

  test("only a bucket name, a Region and an account id are taken, and a spent budget sends nothing", async () => {
    const { fake }: { fake: FakeAws } = bucketFake();

    await expect(
      blockS3BucketPublicAccess(keySettings(), {
        connectionId: CONNECTION,
        bucket: "Not/A/Bucket",
        region: "eu-west-1",
        accountNumber: FAKE_ACCOUNT_ID,
        transport: fake.transport,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      blockS3BucketPublicAccess(keySettings(), {
        connectionId: CONNECTION,
        bucket: "exposed",
        region: "eu-west-1",
        accountNumber: "not-an-account",
        transport: fake.transport,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
    await expect(
      blockS3BucketPublicAccess(keySettings(), {
        connectionId: CONNECTION,
        bucket: "exposed",
        region: "eu-west-1",
        accountNumber: FAKE_ACCOUNT_ID,
        transport: fake.transport,
        budget: new CloudReadBudget({ maxRequests: 0, maxDurationMs: 60000 }),
      }),
    ).rejects.toBeInstanceOf(CloudReadBudgetSpent);
    expect(fake.requests).toEqual([]);
  });
});

describe("revoking a snapshot's sharing", () => {
  function snapshotFake(data: {
    snapshots?: Array<FakeSnapshot> | undefined;
    clusterSnapshots?: Array<FakeSnapshot> | undefined;
    dataErrors?: FakeRegion["dataErrors"];
  }): FakeAws {
    return createFakeAws({
      regions: {
        "us-east-1": {
          metrics: [],
          dbSnapshots: data.snapshots,
          dbClusterSnapshots: data.clusterSnapshots,
          dataErrors: data.dataErrors,
        },
      },
    });
  }

  async function revoke(
    fake: FakeAws,
    snapshotIdentifier: string,
    isClusterSnapshot: boolean = false,
  ): Promise<DataSecurityResponseOutcome> {
    return await revokeRdsSnapshotSharing(keySettings(), {
      connectionId: CONNECTION,
      region: "us-east-1",
      snapshotIdentifier,
      isClusterSnapshot,
      connectedAccountIds: [PARTNER],
      transport: fake.transport,
      ...clock(),
    });
  }

  test("stops a snapshot being public and shared outside the connected accounts; the connected shares stay", async () => {
    const snapshot: FakeSnapshot = {
      id: "orders-final",
      source: "orders",
      restore: ["all", OUTSIDE, PARTNER],
    };
    const fake: FakeAws = snapshotFake({ snapshots: [snapshot] });

    expect(await revoke(fake, "orders-final")).toEqual({
      changed: true,
      summary: `Stopped sharing snapshot orders-final with everyone (it was public) and account ${OUTSIDE}. It stays shared with the connected account ${PARTNER}.`,
    });
    expect(rdsActions(fake)).toEqual([
      "DescribeDBSnapshotAttributes",
      "ModifyDBSnapshotAttribute",
    ]);
    expect(fake.dataCalls[1]!.params).toEqual({
      Action: "ModifyDBSnapshotAttribute",
      Version: "2014-10-31",
      DBSnapshotIdentifier: "orders-final",
      AttributeName: "restore",
      "ValuesToRemove.AttributeValue.1": "all",
      "ValuesToRemove.AttributeValue.2": OUTSIDE,
    });
    expect(snapshot.restore).toEqual([PARTNER]);

    // Run again: nothing left to stop, nothing written.
    expect(await revoke(fake, "orders-final")).toEqual({
      changed: false,
      summary:
        "Snapshot orders-final is neither public nor shared outside the connected accounts; nothing changed.",
    });
    expect(rdsActions(fake)).toEqual([
      "DescribeDBSnapshotAttributes",
      "ModifyDBSnapshotAttribute",
      "DescribeDBSnapshotAttributes",
    ]);
  });

  test("a cluster snapshot is changed through the cluster snapshot calls", async () => {
    const snapshot: FakeSnapshot = {
      id: "ledger-final",
      source: "ledger",
      restore: [OUTSIDE],
    };
    const fake: FakeAws = snapshotFake({ clusterSnapshots: [snapshot] });

    expect(await revoke(fake, "ledger-final", true)).toEqual({
      changed: true,
      summary: `Stopped sharing snapshot ledger-final with account ${OUTSIDE}.`,
    });
    expect(rdsActions(fake)).toEqual([
      "DescribeDBClusterSnapshotAttributes",
      "ModifyDBClusterSnapshotAttribute",
    ]);
    expect(fake.dataCalls[1]!.params).toMatchObject({
      DBClusterSnapshotIdentifier: "ledger-final",
      AttributeName: "restore",
      "ValuesToRemove.AttributeValue.1": OUTSIDE,
    });
    expect(snapshot.restore).toEqual([]);
  });

  test("a snapshot shared only with connected accounts - or with no one - is left alone: nothing is written", async () => {
    const fake: FakeAws = snapshotFake({
      snapshots: [
        { id: "backup-copy", source: "orders", restore: [PARTNER] },
        { id: "private", source: "orders", restore: [] },
      ],
    });

    expect((await revoke(fake, "backup-copy")).changed).toBe(false);
    expect((await revoke(fake, "private")).changed).toBe(false);
    expect(rdsActions(fake)).toEqual([
      "DescribeDBSnapshotAttributes",
      "DescribeDBSnapshotAttributes",
    ]);
  });

  test("a change the role may not make says which setting grants it", async () => {
    const fake: FakeAws = snapshotFake({
      snapshots: [{ id: "orders-final", source: "orders", restore: ["all"] }],
      dataErrors: {
        "rds:ModifyDBSnapshotAttribute": queryError(
          403,
          "AccessDenied",
          "not authorized",
        ),
      },
    });

    const failure: unknown = await revoke(fake, "orders-final").catch(
      (error: unknown): unknown => {
        return error;
      },
    );

    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as LlmProviderError).message).toBe(
      "AWS refused rds:ModifyDBSnapshotAttribute on snapshot orders-final: the access key may not call it. Turn on Data security response for the connection, and run its setup command again.",
    );
  });

  test("a snapshot that is not there is RDS's own error, and only an identifier is taken", async () => {
    const fake: FakeAws = snapshotFake({ snapshots: [] });

    const failure: unknown = await revoke(fake, "gone").catch(
      (error: unknown): unknown => {
        return error;
      },
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).statusCode).toBe(404);
    await expect(revoke(fake, "orders;drop")).rejects.toBeInstanceOf(
      BadDataException,
    );
    expect(rdsActions(fake)).toEqual(["DescribeDBSnapshotAttributes"]);
  });
});

describe("turning on a bucket's versioning", () => {
  async function turnOn(
    fake: FakeAws,
    accountNumber: string = FAKE_ACCOUNT_ID,
  ): Promise<DataSecurityResponseOutcome> {
    return await turnOnS3BucketVersioning(keySettings(), {
      connectionId: CONNECTION,
      bucket: "exports",
      region: "eu-west-1",
      accountNumber,
      transport: fake.transport,
      ...clock(),
    });
  }

  test("turns it on with S3's checksum and the bucket's owner named, once", async () => {
    const bucket: FakeBucket = { name: "exports", region: "eu-west-1" };
    const fake: FakeAws = createFakeAws({ regions: {}, buckets: [bucket] });

    expect(await turnOn(fake)).toEqual({
      changed: true,
      summary:
        "Turned on versioning for bucket exports: an object overwritten or deleted from now on can be restored from its earlier version.",
    });

    const writes: Array<FakeAws["s3Calls"][number]> = s3Writes(fake);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      bucket: "exports",
      subresource: "putVersioning",
      query: { versioning: "" },
      body: S3_VERSIONING_ENABLED_XML,
    });
    expect(writes[0]!.headers["content-md5"]).toBe(
      createHash("md5")
        .update(S3_VERSIONING_ENABLED_XML, "utf8")
        .digest("base64"),
    );
    expect(writes[0]!.headers["x-amz-expected-bucket-owner"]).toBe(
      FAKE_ACCOUNT_ID,
    );
    expect(fake.s3Calls[0]).toMatchObject({
      method: "GET",
      subresource: "versioning",
    });
    expect(bucket.versioning).toBe("Enabled");

    // Run again: on already, nothing written.
    expect(await turnOn(fake)).toEqual({
      changed: false,
      summary: "Versioning was already on for bucket exports; nothing changed.",
    });
    expect(s3Writes(fake)).toHaveLength(1);
  });

  test("a bucket whose versioning was suspended has it back on, and is told so", async () => {
    const bucket: FakeBucket = {
      name: "exports",
      region: "eu-west-1",
      versioning: "Suspended",
    };
    const fake: FakeAws = createFakeAws({ regions: {}, buckets: [bucket] });

    expect((await turnOn(fake)).summary).toBe(
      "Turned versioning back on for bucket exports: it was suspended. An object overwritten or deleted from now on can be restored from its earlier version.",
    );
    expect(bucket.versioning).toBe("Enabled");
  });

  test("a write the role may not make says which permission it needed", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      buckets: [
        {
          name: "exports",
          region: "eu-west-1",
          errors: {
            putVersioning: s3Error(403, "AccessDenied", "Access Denied"),
          },
        },
      ],
    });

    const failure: unknown = await turnOn(fake).catch(
      (error: unknown): unknown => {
        return error;
      },
    );

    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as LlmProviderError).message).toBe(
      "AWS refused s3:PutBucketVersioning on bucket exports: the access key may not call it, or the bucket is not in the account named. Turn on Data security response for the connection, and run its setup command again.",
    );
  });

  test("a bucket of another account is never touched; only names are taken", async () => {
    const bucket: FakeBucket = { name: "exports", region: "eu-west-1" };
    const fake: FakeAws = createFakeAws({ regions: {}, buckets: [bucket] });

    await expect(turnOn(fake, OUTSIDE)).rejects.toBeInstanceOf(
      LlmProviderError,
    );
    expect(s3Writes(fake)).toEqual([]);
    expect(bucket.versioning).toBeUndefined();

    await expect(
      turnOnS3BucketVersioning(keySettings(), {
        connectionId: CONNECTION,
        bucket: "Not A Bucket",
        region: "eu-west-1",
        accountNumber: FAKE_ACCOUNT_ID,
        transport: fake.transport,
      }),
    ).rejects.toBeInstanceOf(BadDataException);
  });
});

describe("turning off a bucket's object ACLs", () => {
  async function enforce(fake: FakeAws): Promise<DataSecurityResponseOutcome> {
    return await enforceS3BucketOwnership(keySettings(), {
      connectionId: CONNECTION,
      bucket: "exports",
      region: "eu-west-1",
      accountNumber: FAKE_ACCOUNT_ID,
      transport: fake.transport,
      ...clock(),
    });
  }

  test("a bucket with no ownership controls gets Bucket owner enforced, once", async () => {
    const bucket: FakeBucket = { name: "exports", region: "eu-west-1" };
    const fake: FakeAws = createFakeAws({ regions: {}, buckets: [bucket] });

    expect(await enforce(fake)).toEqual({
      changed: true,
      summary:
        "Turned off object ACLs for bucket exports: the bucket's policy alone decides who reads it now.",
    });
    expect(s3Writes(fake)[0]).toMatchObject({
      subresource: "putOwnershipControls",
      query: { ownershipControls: "" },
      body: S3_BUCKET_OWNER_ENFORCED_XML,
    });
    expect(bucket.ownership).toBe("BucketOwnerEnforced");

    expect(await enforce(fake)).toEqual({
      changed: false,
      summary:
        "Object ACLs were already off for bucket exports; nothing changed.",
    });
    expect(s3Writes(fake)).toHaveLength(1);
  });

  test("the ownership it had is named", async () => {
    const fake: FakeAws = createFakeAws({
      regions: {},
      buckets: [
        { name: "exports", region: "eu-west-1", ownership: "ObjectWriter" },
      ],
    });

    expect((await enforce(fake)).summary).toBe(
      "Turned off object ACLs for bucket exports (its Object Ownership was ObjectWriter): the bucket's policy alone decides who reads it now.",
    );
  });

  test("a bucket whose own ACL grants others is refused by S3, and told what to move first", async () => {
    const bucket: FakeBucket = {
      name: "exports",
      region: "eu-west-1",
      grants: [
        {
          uri: "http://acs.amazonaws.com/groups/global/AllUsers",
          permission: "READ",
        },
      ],
    };
    const fake: FakeAws = createFakeAws({ regions: {}, buckets: [bucket] });

    await expect(enforce(fake)).rejects.toThrow(
      "S3 will not turn off object ACLs for bucket exports while the bucket's own ACL grants access to another account or to everyone. Grant that access in the bucket policy instead, remove it from the ACL, then try again.",
    );
    expect(bucket.ownership).toBeUndefined();
  });
});

describe("turning on a table's point-in-time recovery", () => {
  function tableFake(data: {
    pointInTimeRecovery?: boolean;
    dataErrors?: FakeRegion["dataErrors"];
  }): { fake: FakeAws; table: FakeTable } {
    const table: FakeTable = {
      table: {
        TableName: "orders",
        TableArn: "arn:aws:dynamodb:us-east-1:123456789012:table/orders",
      },
      pointInTimeRecovery: data.pointInTimeRecovery,
    };

    return {
      fake: createFakeAws({
        regions: {
          "us-east-1": {
            metrics: [],
            dynamoTables: [table],
            dataErrors: data.dataErrors,
          },
        },
      }),
      table,
    };
  }

  async function turnOn(
    fake: FakeAws,
    table: string = "orders",
  ): Promise<DataSecurityResponseOutcome> {
    return await turnOnDynamoDbPointInTimeRecovery(keySettings(), {
      connectionId: CONNECTION,
      table,
      region: "us-east-1",
      transport: fake.transport,
      ...clock(),
    });
  }

  function dynamoActions(fake: FakeAws): Array<string> {
    return fake.dataCalls
      .filter((call: FakeAws["dataCalls"][number]): boolean => {
        return call.service === "dynamodb";
      })
      .map((call: FakeAws["dataCalls"][number]): string => {
        return call.action;
      });
  }

  test("reads, turns it on, and leaves it alone the second time", async () => {
    const { fake, table }: { fake: FakeAws; table: FakeTable } = tableFake({});

    expect(await turnOn(fake)).toEqual({
      changed: true,
      summary:
        "Turned on point-in-time recovery for table orders: it can be restored to any second of the last 35 days.",
    });
    expect(table.pointInTimeRecovery).toBe(true);
    expect(dynamoActions(fake)).toEqual([
      "DescribeContinuousBackups",
      "UpdateContinuousBackups",
    ]);

    expect(await turnOn(fake)).toEqual({
      changed: false,
      summary:
        "Point-in-time recovery was already on for table orders; nothing changed.",
    });
    expect(dynamoActions(fake)).toEqual([
      "DescribeContinuousBackups",
      "UpdateContinuousBackups",
      "DescribeContinuousBackups",
    ]);
  });

  test("a refusal says which permission it needed; a table still setting up its backups says to wait", async () => {
    const refused: FakeAws = tableFake({
      dataErrors: {
        "dynamodb:UpdateContinuousBackups": awsError(
          400,
          "AccessDeniedException",
          "not authorized",
        ),
      },
    }).fake;
    const failure: unknown = await turnOn(refused).catch(
      (error: unknown): unknown => {
        return error;
      },
    );

    expect((failure as LlmProviderError).message).toBe(
      "AWS refused dynamodb:UpdateContinuousBackups on table orders: the access key may not call it. Turn on Data security response for the connection, and run its setup command again.",
    );

    const busy: FakeAws = tableFake({
      dataErrors: {
        "dynamodb:UpdateContinuousBackups": awsError(
          400,
          "ContinuousBackupsUnavailableException",
          "Backups are being enabled for the table",
        ),
      },
    }).fake;

    await expect(turnOn(busy)).rejects.toThrow(
      "DynamoDB cannot turn on point-in-time recovery for table orders yet: its backups are still being set up. Try again in a few minutes.",
    );
  });

  test("only a table name is taken", async () => {
    const { fake }: { fake: FakeAws } = tableFake({});

    await expect(turnOn(fake, "orders; drop")).rejects.toBeInstanceOf(
      BadDataException,
    );
    await expect(turnOn(fake, "ab")).rejects.toBeInstanceOf(BadDataException);
    expect(dynamoActions(fake)).toEqual([]);
    expect(isDynamoDbTableName("Orders_2026-10.v2")).toBe(true);
    expect(isDynamoDbTableName("x".repeat(256))).toBe(false);
  });
});
