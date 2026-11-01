import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import {
  AwsCredentials,
  AwsRestResponse,
  awsErrorCodeOf,
  readXmlChildren,
  readXmlTags,
  sendAwsRequest,
  sendAwsRestRequest,
} from "../../../CloudConnection/Aws/AwsApi";
import AwsCloudConnector from "../../../CloudConnection/Aws/AwsCloudConnector";
import { isAwsRegion } from "../../../CloudConnection/Aws/AwsRegions";
import {
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
} from "../../../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../../../DataSource/HttpFetch";
import LlmProviderError from "../../../LlmObservability/LlmProviderError";
import { isAccountId, isS3BucketName } from "./AwsDataSecurityReader";
import { DataSecurityResponseOutcome } from "../DataSecurityCloudTypes";

/*
 * CLOSING A DATA STORE'S EXPOSURE ON AWS: the two writes Security
 * Operations playbooks make through a connection's opt-in response policy
 * (CloudConnectionSetupCommands: OneUptimeDataSecurityResponse, granted
 * only when the connection's Data security response is "block"), each run
 * approved by a person unless the playbook says otherwise.
 *
 *   blockS3BucketPublicAccess  turns on all four of a bucket's Block Public
 *                              Access settings (PutPublicAccessBlock): no
 *                              public grant of its policy or its ACLs counts
 *                              any more, and no new one can be made.
 *   revokeRdsSnapshotSharing   stops a manual RDS snapshot being restorable
 *                              by everyone ("all") and by every account
 *                              outside the connected ones; its shares with
 *                              connected accounts stay.
 *
 * Each reads first and writes only what is not so already: run twice, the
 * second run changes nothing and says so. Each answers with a sentence the
 * person reading the playbook's run understands, and fails as the reader's
 * calls fail - a refusal says which setting grants the permission. A write
 * to a bucket names the account it must belong to (S3's expected bucket
 * owner), so a bucket of the same name in another account is never
 * touched.
 */

const PROVIDER_TITLE: string = "AWS";
const S3_TITLE: string = "AWS S3";
const RDS_VERSION: string = "2014-10-31";
// A run's bounds when the caller gives none: a sign-in, a read and a write.
const DEFAULT_MAX_REQUESTS: number = 20;
const DEFAULT_MAX_DURATION_MS: number = 2 * 60 * 1000;
// RDS's identifiers: letters, digits and hyphens, at most 255.
const MAX_SNAPSHOT_IDENTIFIER_LENGTH: number = 255;

// What the action did: the outcome every cloud's response gives.
export type { DataSecurityResponseOutcome };

// The four settings of a bucket's Block Public Access, as S3 names them.
export const S3_BLOCK_PUBLIC_ACCESS_SETTINGS: Array<string> = [
  "BlockPublicAcls",
  "IgnorePublicAcls",
  "BlockPublicPolicy",
  "RestrictPublicBuckets",
];

// PutPublicAccessBlock's body: every setting on.
export const S3_BLOCK_ALL_PUBLIC_ACCESS_XML: string = `<?xml version="1.0" encoding="UTF-8"?>\n<PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${S3_BLOCK_PUBLIC_ACCESS_SETTINGS.map(
  (setting: string): string => {
    return `<${setting}>true</${setting}>`;
  },
).join("")}</PublicAccessBlockConfiguration>`;

interface SnapshotApi {
  describeAction: string;
  modifyAction: string;
  modifyIam: string;
  describeIam: string;
  idParam: string;
  attributeTag: string;
}

const INSTANCE_SNAPSHOT: SnapshotApi = {
  describeAction: "DescribeDBSnapshotAttributes",
  modifyAction: "ModifyDBSnapshotAttribute",
  describeIam: "rds:DescribeDBSnapshotAttributes",
  modifyIam: "rds:ModifyDBSnapshotAttribute",
  idParam: "DBSnapshotIdentifier",
  attributeTag: "DBSnapshotAttribute",
};

const CLUSTER_SNAPSHOT: SnapshotApi = {
  describeAction: "DescribeDBClusterSnapshotAttributes",
  modifyAction: "ModifyDBClusterSnapshotAttribute",
  describeIam: "rds:DescribeDBClusterSnapshotAttributes",
  modifyIam: "rds:ModifyDBClusterSnapshotAttribute",
  idParam: "DBClusterSnapshotIdentifier",
  attributeTag: "DBClusterSnapshotAttribute",
};

interface ResponseCall {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  budget: CloudReadBudget;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  // "The role" or "The access key": who the refusal is about.
  subject: string;
}

/*
 * The credential a run signs with: the account's own role for a member of
 * an organization, else the connection's.
 */
async function signIn(
  settings: CloudConnectionSettings,
  options: {
    connectionId: ObjectID;
    accountNumber?: string | undefined;
    transport?: CloudConnectorTransport | undefined;
    now?: (() => Date) | undefined;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
    budget?: CloudReadBudget | undefined;
  },
): Promise<ResponseCall> {
  const connector: AwsCloudConnector = new AwsCloudConnector();

  connector.validateSettings(settings);

  const accountSettings: CloudConnectionSettings =
    connector.isOrganization(settings) &&
    options.accountNumber &&
    isAccountId(options.accountNumber)
      ? connector.settingsForAccount(settings, options.accountNumber)
      : settings;
  const transport: CloudConnectorTransport =
    options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const budget: CloudReadBudget =
    options.budget ||
    new CloudReadBudget({
      maxRequests: DEFAULT_MAX_REQUESTS,
      maxDurationMs: DEFAULT_MAX_DURATION_MS,
    });
  const credentials: AwsCredentials = await connector.getCredentials(
    accountSettings,
    {
      transport,
      now: options.now,
      sleep: options.sleep,
      connectionId: options.connectionId.toString(),
      budget,
    },
  );

  return {
    transport,
    credentials,
    budget,
    now: options.now,
    sleep: options.sleep,
    subject:
      connector.getAuthMethod(settings) === CloudConnectionAuthMethod.AwsRole
        ? "The role"
        : "The access key",
  };
}

/*
 * A refusal, said with what grants the permission; any other failure as
 * AWS answered it.
 */
function explainRefusal(
  error: unknown,
  data: { subject: string; action: string; what: string },
): unknown {
  if (
    !(error instanceof LlmProviderError) ||
    error.kind !== CloudConnectionFailureKind.Permission
  ) {
    return error;
  }

  return new LlmProviderError({
    message: `AWS refused ${data.action} on ${data.what}: ${data.subject.toLowerCase()} may not call it${
      data.what.startsWith("bucket")
        ? ", or the bucket is not in the account named"
        : ""
    }. Turn on Data security response for the connection, and run its setup command again.`,
    kind: CloudConnectionFailureKind.Permission,
    statusCode: error.statusCode,
    responseBody: error.responseBody,
  });
}

// "a", "a and b", "a, b and c".
function sayList(items: Array<string>): string {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/*
 * Turns on all four of a bucket's Block Public Access settings, unless
 * they are on already. The bucket must be the account's: S3 refuses
 * either call for a bucket of the same name another account owns.
 */
export async function blockS3BucketPublicAccess(
  settings: CloudConnectionSettings,
  options: {
    connectionId: ObjectID;
    bucket: string;
    region: string;
    accountNumber: string;
    transport?: CloudConnectorTransport | undefined;
    now?: (() => Date) | undefined;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
    budget?: CloudReadBudget | undefined;
  },
): Promise<DataSecurityResponseOutcome> {
  const bucket: string = options.bucket.trim();
  const region: string = options.region.trim().toLowerCase();
  const accountNumber: string = options.accountNumber.trim();

  if (!isS3BucketName(bucket)) {
    throw new BadDataException(
      `"${bucket.slice(0, 70)}" is not an S3 bucket name.`,
    );
  }

  if (!isAwsRegion(region)) {
    throw new BadDataException(
      `"${region.slice(0, 40)}" is not an AWS Region.`,
    );
  }

  if (!isAccountId(accountNumber)) {
    throw new BadDataException(
      "The bucket's account must be a 12-digit AWS account id.",
    );
  }

  const call: ResponseCall = await signIn(settings, {
    ...options,
    accountNumber,
  });
  const send: (data: {
    method: "GET" | "PUT";
    body?: string | undefined;
    step: string;
  }) => Promise<AwsRestResponse> = async (data: {
    method: "GET" | "PUT";
    body?: string | undefined;
    step: string;
  }): Promise<AwsRestResponse> => {
    return await sendAwsRestRequest({
      transport: call.transport,
      credentials: call.credentials,
      service: "s3",
      region,
      method: data.method,
      path: `/${bucket}`,
      query: { publicAccessBlock: "" },
      headers: { "x-amz-expected-bucket-owner": accountNumber },
      body: data.body,
      step: data.step,
      providerTitle: S3_TITLE,
      now: call.now,
      sleep: call.sleep,
      budget: call.budget,
    });
  };

  // What is on now: a bucket with no block has none of the four.
  let current: string = "";

  try {
    current = (
      await send({ method: "GET", step: "bucket public access block request" })
    ).text;
  } catch (error) {
    if (
      !(error instanceof LlmProviderError) ||
      awsErrorCodeOf(error.responseBody || "") !==
        "NoSuchPublicAccessBlockConfiguration"
    ) {
      throw explainRefusal(error, {
        subject: call.subject,
        action: "s3:GetBucketPublicAccessBlock",
        what: `bucket ${bucket}`,
      });
    }
  }

  const off: Array<string> = S3_BLOCK_PUBLIC_ACCESS_SETTINGS.filter(
    (setting: string): boolean => {
      return (readXmlTags(current, setting)[0] || "").toLowerCase() !== "true";
    },
  );

  if (off.length === 0) {
    return {
      changed: false,
      summary: `All four Block Public Access settings of bucket ${bucket} were already on; nothing changed.`,
    };
  }

  try {
    await send({
      method: "PUT",
      body: S3_BLOCK_ALL_PUBLIC_ACCESS_XML,
      step: "bucket public access block update",
    });
  } catch (error) {
    throw explainRefusal(error, {
      subject: call.subject,
      action: "s3:PutBucketPublicAccessBlock",
      what: `bucket ${bucket}`,
    });
  }

  return {
    changed: true,
    summary: `Turned on all four Block Public Access settings of bucket ${bucket} (${sayList(
      off,
    )} ${off.length === 1 ? "was" : "were"} off).`,
  };
}

// RDS's identifiers of manual snapshots: letters, digits and hyphens.
function isSnapshotIdentifier(identifier: string): boolean {
  if (!identifier || identifier.length > MAX_SNAPSHOT_IDENTIFIER_LENGTH) {
    return false;
  }

  for (const character of identifier) {
    const allowed: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      character === "-";

    if (!allowed) {
      return false;
    }
  }

  return true;
}

/*
 * Stops a manual snapshot being restorable by everyone and by any account
 * outside the connected ones, unless it is not. Its shares with connected
 * accounts - a backup account of the same organization - stay.
 */
export async function revokeRdsSnapshotSharing(
  settings: CloudConnectionSettings,
  options: {
    connectionId: ObjectID;
    region: string;
    snapshotIdentifier: string;
    isClusterSnapshot: boolean;
    // Every AWS account the project has connected: their shares stay.
    connectedAccountIds: Array<string>;
    // The account the snapshot is in, for an organization's connection: its own role is used.
    accountNumber?: string | undefined;
    transport?: CloudConnectorTransport | undefined;
    now?: (() => Date) | undefined;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
    budget?: CloudReadBudget | undefined;
  },
): Promise<DataSecurityResponseOutcome> {
  const region: string = options.region.trim().toLowerCase();
  const identifier: string = options.snapshotIdentifier.trim();
  const api: SnapshotApi = options.isClusterSnapshot
    ? CLUSTER_SNAPSHOT
    : INSTANCE_SNAPSHOT;

  if (!isAwsRegion(region)) {
    throw new BadDataException(
      `"${region.slice(0, 40)}" is not an AWS Region.`,
    );
  }

  if (!isSnapshotIdentifier(identifier)) {
    throw new BadDataException(
      `"${identifier.slice(0, 70)}" is not the identifier of a manual RDS snapshot.`,
    );
  }

  const call: ResponseCall = await signIn(settings, options);
  const query: (
    body: Dictionary<string>,
    step: string,
  ) => Promise<string> = async (
    body: Dictionary<string>,
    step: string,
  ): Promise<string> => {
    return (
      await sendAwsRequest({
        transport: call.transport,
        credentials: call.credentials,
        service: "rds",
        region,
        body: { Version: RDS_VERSION, ...body },
        step,
        providerTitle: PROVIDER_TITLE,
        now: call.now,
        sleep: call.sleep,
        budget: call.budget,
      })
    ).text;
  };
  const what: string = `snapshot ${identifier}`;

  // Who may restore it now.
  let restore: Array<string> = [];

  try {
    const text: string = await query(
      { Action: api.describeAction, [api.idParam]: identifier },
      "snapshot share request",
    );

    restore = readXmlTags(text, api.attributeTag)
      .filter((attribute: string): boolean => {
        return (
          (readXmlChildren(attribute, "AttributeName")[0] || "") === "restore"
        );
      })
      .flatMap((attribute: string): Array<string> => {
        return readXmlTags(attribute, "AttributeValue");
      });
  } catch (error) {
    throw explainRefusal(error, {
      subject: call.subject,
      action: api.describeIam,
      what,
    });
  }

  const connected: Set<string> = new Set<string>(
    [...options.connectedAccountIds, options.accountNumber || ""]
      .map((account: string): string => {
        return account.trim();
      })
      .filter(isAccountId),
  );
  const toRemove: Array<string> = Array.from(new Set(restore)).filter(
    (value: string): boolean => {
      return value === "all" || !connected.has(value);
    },
  );
  const kept: Array<string> = restore.filter((value: string): boolean => {
    return value !== "all" && connected.has(value);
  });

  if (toRemove.length === 0) {
    return {
      changed: false,
      summary: `Snapshot ${identifier} is neither public nor shared outside the connected accounts; nothing changed.`,
    };
  }

  const values: Dictionary<string> = {};

  toRemove.forEach((value: string, index: number) => {
    values[`ValuesToRemove.AttributeValue.${index + 1}`] = value;
  });

  try {
    await query(
      {
        Action: api.modifyAction,
        [api.idParam]: identifier,
        AttributeName: "restore",
        ...values,
      },
      "snapshot share update",
    );
  } catch (error) {
    throw explainRefusal(error, {
      subject: call.subject,
      action: api.modifyIam,
      what,
    });
  }

  const removed: Array<string> = [
    ...(toRemove.includes("all") ? ["everyone (it was public)"] : []),
    ...toRemove
      .filter((value: string): boolean => {
        return value !== "all";
      })
      .map((account: string): string => {
        return `account ${account}`;
      }),
  ];
  const stays: string =
    kept.length > 0
      ? ` It stays shared with the connected ${
          kept.length === 1 ? "account" : "accounts"
        } ${sayList(kept)}.`
      : "";

  return {
    changed: true,
    summary: `Stopped sharing snapshot ${identifier} with ${sayList(removed)}.${stays}`,
  };
}
