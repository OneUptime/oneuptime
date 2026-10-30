import { createHash } from "crypto";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { LlmConnectorTransport } from "../../../../Server/Utils/LlmObservability/LlmConnectorTypes";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * AWS in a test: CloudWatch (per Region), STS, the Resource Groups
 * Tagging API, Cloud Control (per Region), Organizations, IAM's account
 * alias, CloudTrail (per Region) and AWS Health, answering the way they do - the JSON protocols with the action in
 * X-Amz-Target, STS and IAM in XML - and every error the way the
 * production transport throws it. Each Region's CloudWatch holds metrics
 * (what ListMetrics lists) and values (what GetMetricData returns for a
 * metric and its dimensions); each Region's Cloud Control holds resources
 * by type.
 *
 * A role assumed in another account signs its calls with a key that names
 * that account, and GetCallerIdentity answers with it: an organization's
 * accounts are told apart the way AWS tells them apart.
 *
 * For data security, the data stores' APIs too: S3 (GET, path style, each
 * bucket answering only at its own Region - anywhere else with a
 * PermanentRedirect - and its settings not set answered as S3 answers
 * them), S3 Control's public access block, RDS, Redshift and ElastiCache
 * (the Query protocol), DynamoDB and KMS's aliases (JSON), and OpenSearch
 * and EFS (REST-JSON).
 */

export const FAKE_ACCOUNT_ID: string = "123456789012";

export interface FakeMetric {
  namespace: string;
  metricName: string;
  dimensions: Array<[string, string]>;
  // [epoch seconds, value]
  values?: Array<[number, number]> | undefined;
}

export interface FakeRegion {
  metrics: Array<FakeMetric>;
  // Answer every call with this error instead.
  error?: FakeResponse | undefined;
  // Answer GetMetricData with these in turn first (throttling, failure).
  getMetricDataAnswers?: Array<FakeResponse> | undefined;
  // ARN (any case) -> Name tag.
  names?: Record<string, string> | undefined;
  tagsError?: FakeResponse | undefined;
  // Cloud Control: type -> its resources, as ListResources describes them.
  resources?:
    | Record<string, Array<{ Identifier: string; Properties: JSONObject }>>
    | undefined;
  // Cloud Control: type -> the error ListResources answers with instead.
  resourceErrors?: Record<string, FakeResponse> | undefined;
  // CloudTrail: the Region's write events, as LookupEvents describes them.
  trailEvents?: Array<JSONObject> | undefined;
  // Events per LookupEvents page (50 when not set).
  trailPageSize?: number | undefined;
  trailError?: FakeResponse | undefined;
  /*
   * Data stores, for data security, as their APIs describe them: RDS's,
   * Redshift's and ElastiCache's as XML fields (xmlOf: an array is the
   * element repeated, { TagList: { Tag: [...] } }), the others as JSON.
   */
  dbInstances?: Array<JSONObject> | undefined;
  dbClusters?: Array<JSONObject> | undefined;
  dbSnapshots?: Array<FakeSnapshot> | undefined;
  dbClusterSnapshots?: Array<FakeSnapshot> | undefined;
  dynamoTables?: Array<FakeTable> | undefined;
  redshiftClusters?: Array<JSONObject> | undefined;
  // Cluster id -> whether its audit logging is on.
  redshiftLogging?: Record<string, boolean> | undefined;
  // DescribeDomains' DomainStatusList entries.
  openSearchDomains?: Array<JSONObject> | undefined;
  replicationGroups?: Array<JSONObject> | undefined;
  // DescribeFileSystems' FileSystems entries.
  fileSystems?: Array<JSONObject> | undefined;
  kmsAliases?: Array<{ AliasName: string; TargetKeyId: string }> | undefined;
  // "service:Action" (rds:DescribeDBSnapshots, es:ListDomainNames) -> the error it answers with instead.
  dataErrors?: Record<string, FakeResponse> | undefined;
}

// A manual RDS snapshot, and the accounts its "restore" attribute names ("all": everyone).
export interface FakeSnapshot {
  id: string;
  // The instance or cluster it is a snapshot of.
  source: string;
  restore?: Array<string> | undefined;
  encrypted?: boolean | undefined;
}

export interface FakeTable {
  // DescribeTable's Table.
  table: JSONObject;
  pointInTimeRecovery?: boolean | undefined;
}

export interface FakePublicAccessBlock {
  BlockPublicAcls: boolean;
  IgnorePublicAcls: boolean;
  BlockPublicPolicy: boolean;
  RestrictPublicBuckets: boolean;
}

export interface FakeObject {
  key: string;
  // Text content, stored as its UTF-8.
  body?: string | undefined;
  // Content that is not text (a gzip, a zip): stored as these bytes, body unread.
  bytes?: Uint8Array | undefined;
  storageClass?: string | undefined;
  lastModified?: string | undefined;
}

// An object's content as S3 stores it.
function contentOf(object: FakeObject): Buffer {
  return object.bytes
    ? Buffer.from(object.bytes)
    : Buffer.from(object.body || "", "utf8");
}

/*
 * An answer with the body's own bytes - an object's content - which the
 * transport hands over as bodyBytes to a request that keeps them
 * (keepBodyBytes), as the production transport does; its text is their
 * UTF-8 decoding, as the production transport's is.
 */
interface FakeBytesResponse extends FakeResponse {
  bytes?: Buffer | undefined;
}

/*
 * An S3 bucket, answering at its own Region only (any other answers with
 * PermanentRedirect, as S3 does). A setting left out answers as not set:
 * NoSuchBucketPolicy, NoSuchPublicAccessBlockConfiguration, and so on.
 */
export interface FakeBucket {
  name: string;
  region: string;
  // ListBuckets leaves its BucketRegion out: GetBucketLocation says it.
  hideRegion?: boolean | undefined;
  policy?: JSONObject | undefined;
  // GetBucketPolicyStatus: AWS's verdict on the policy; FALSE when left out.
  isPublic?: boolean | undefined;
  publicAccessBlock?: FakePublicAccessBlock | undefined;
  // Grants besides the owner's FULL_CONTROL: a group's URI or a canonical user's id.
  grants?:
    | Array<{
        uri?: string | undefined;
        id?: string | undefined;
        permission: string;
      }>
    | undefined;
  encryption?: { algorithm: string; kmsKeyId?: string | undefined } | undefined;
  versioning?: "Enabled" | "Suspended" | undefined;
  loggingTarget?: string | undefined;
  ownership?: string | undefined;
  // The names of the buckets its replication rules copy to.
  replicateTo?: Array<string> | undefined;
  tags?: Record<string, string> | undefined;
  objects?: Array<FakeObject> | undefined;
  // Subresource ("policy", "acl", "location", "list", "object") -> the error it answers with instead.
  errors?: Record<string, FakeResponse> | undefined;
}

export interface FakeOrganizationAccount {
  Id: string;
  Name: string;
  // Retired by AWS on 9 September 2026: State is what answers carry now.
  Status?: string | undefined;
  State?: string | undefined;
}

export interface FakeAwsOptions {
  regions: Record<string, FakeRegion>;
  // Regions not listed answer as a Region the account has not opted in to.
  account?: string | undefined;
  callerIdentityError?: FakeResponse | undefined;
  assumeRoleError?: FakeResponse | undefined;
  // Role ARNs (any case) whose AssumeRole is refused: a member without the role.
  refusedRoles?: Array<string> | undefined;
  organizationAccounts?: Array<FakeOrganizationAccount> | undefined;
  organizationsError?: FakeResponse | undefined;
  accountAlias?: string | undefined;
  // AWS Health: events as DescribeEvents lists them, and each one's words.
  healthEvents?: Array<JSONObject> | undefined;
  healthDescriptions?: Record<string, string> | undefined;
  healthError?: FakeResponse | undefined;
  // Per account (as a role's key names it): the error AWS Health answers it with.
  healthErrorsByAccount?: Record<string, FakeResponse> | undefined;
  /*
   * AWS's own clock: a request signed (X-Amz-Date) more than five minutes
   * before it is refused as AWS refuses it - "Signature expired", as an
   * unknown signature. Off when not given.
   */
  awsClock?: (() => Date) | undefined;
  // S3: the account's buckets, listed by ListBuckets in pages of bucketPageSize (1000).
  buckets?: Array<FakeBucket> | undefined;
  bucketPageSize?: number | undefined;
  bucketListError?: FakeResponse | undefined;
  // S3 Control: the account's public access block; not set when left out.
  accountPublicAccessBlock?: FakePublicAccessBlock | undefined;
  accountPublicAccessBlockError?: FakeResponse | undefined;
}

export interface FakeAws extends FakeProviderApi {
  // CloudWatch calls by action and Region, in order.
  cloudWatchCalls: Array<{ action: string; region: string; body: JSONObject }>;
  stsCalls: Array<{
    action: string;
    body: URLSearchParams;
    request: DataSourceHttpRequest;
  }>;
  taggingCalls: Array<{ region: string; body: JSONObject }>;
  cloudControlCalls: Array<{
    region: string;
    typeName: string;
    resourceModel: string;
    account: string;
  }>;
  // The Regions Organizations was asked in, one entry a call.
  organizationsCalls: Array<string>;
  assumedRoles: Array<string>;
  // LookupEvents calls by Region and the account they were signed for.
  cloudTrailCalls: Array<{ region: string; body: JSONObject; account: string }>;
  // AWS Health calls by action, with the Region and the account they were signed for.
  healthCalls: Array<{
    action: string;
    body: JSONObject;
    region: string;
    account: string;
  }>;
  /*
   * Requests refused because their signature was too old - a counter
   * object: a getter would be read once, when the fake is spread.
   */
  expiredSignatures: { count: number };
  /*
   * S3 and S3 Control calls: the bucket ("" for ListBuckets and the
   * account's block), the subresource ("buckets", "policy", "list",
   * "object", "accountPublicAccessBlock", "putPublicAccessBlock"...), the
   * Region of the host and the one the request was signed for, a
   * GetObject's key and Range, and the method, body and headers
   * (lowercased names) a write was sent with.
   */
  s3Calls: Array<{
    bucket: string;
    subresource: string;
    hostRegion: string;
    signedRegion: string;
    account: string;
    key: string;
    range: string;
    query: Record<string, string>;
    method: string;
    body: string;
    headers: Record<string, string>;
  }>;
  /*
   * The data stores' APIs' calls (rds, dynamodb, redshift, es, elasticache,
   * elasticfilesystem, kms), with a Query call's form fields.
   */
  dataCalls: Array<{
    service: string;
    action: string;
    region: string;
    account: string;
    params?: Record<string, string> | undefined;
  }>;
}

// A request's headers by lowercased name.
function headersOf(request: DataSourceHttpRequest): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(request.headers || {})) {
    headers[name.toLowerCase()] = String(value);
  }

  return headers;
}

// A form body's fields.
function formFieldsOf(form: URLSearchParams): Record<string, string> {
  const fields: Record<string, string> = {};

  form.forEach((value: string, name: string) => {
    fields[name] = value;
  });

  return fields;
}

// Twelve digits: an AWS account id.
function isAccountId(text: string): boolean {
  return (
    text.length === 12 &&
    Array.from(text).every((char: string): boolean => {
      return char >= "0" && char <= "9";
    })
  );
}

// The account a role session's key names: ASIA + the 12-digit account + ROLE.
function accountOfKey(request: DataSourceHttpRequest): string {
  const authorization: string = headerOf(request, "Authorization");
  const marker: string = "Credential=ASIA";
  const index: number = authorization.indexOf(marker);

  if (index < 0) {
    return "";
  }

  const digits: string = authorization.slice(
    index + marker.length,
    index + marker.length + 12,
  );

  return isAccountId(digits) ? digits : "";
}

// The 12-digit account of a role ARN, or "".
function accountOfRoleArn(roleArn: string): string {
  const parts: Array<string> = roleArn.split(":");
  return parts.length >= 5 && isAccountId(parts[4] || "") ? parts[4]! : "";
}

export function awsError(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: JSON.stringify({ __type: `com.amazonaws.coral#${code}`, message }),
  };
}

export function stsError(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: `<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`,
  };
}

// An S3 (and S3 Control) error, as S3 writes it: XML with its <Code>.
export function s3Error(
  status: number,
  code: string,
  message: string = "denied",
  extra: string = "",
): FakeResponse {
  return {
    status,
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>${code}</Code><Message>${message}</Message>${extra}<RequestId>1</RequestId><HostId>x</HostId></Error>`,
  };
}

// A Query-protocol error (RDS, Redshift, ElastiCache), as they write it.
export function queryError(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`,
  };
}

function escapeXml(text: string): string {
  return text
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;")
    .split('"')
    .join("&quot;");
}

/*
 * A JSON value as XML fields: { A: "x", B: { C: 1 } } is
 * <A>x</A><B><C>1</C></B>, and an array is its element repeated -
 * { TagList: { Tag: [{ Key: "k" }] } } is <TagList><Tag><Key>k</Key></Tag></TagList>.
 */
export function xmlOf(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value !== "object") {
    return escapeXml(String(value));
  }

  if (Array.isArray(value)) {
    return value
      .map((item: JSONValue): string => {
        return xmlOf(item);
      })
      .join("");
  }

  return Object.keys(value)
    .map((key: string): string => {
      const child: JSONValue | undefined = (value as JSONObject)[key];

      if (Array.isArray(child)) {
        return child
          .map((item: JSONValue): string => {
            return `<${key}>${xmlOf(item)}</${key}>`;
          })
          .join("");
      }

      return `<${key}>${xmlOf(child)}</${key}>`;
    })
    .join("");
}

// The Region and service of a request's signature: Credential=KEY/DATE/REGION/SERVICE/aws4_request.
function signedScopeOf(request: DataSourceHttpRequest): {
  region: string;
  service: string;
} {
  const authorization: string = headerOf(request, "Authorization");
  const marker: string = "Credential=";
  const index: number = authorization.indexOf(marker);
  const credential: string =
    index >= 0
      ? authorization.slice(index + marker.length).split(",")[0] || ""
      : "";
  const parts: Array<string> = credential.split("/");

  return { region: parts[2] || "", service: parts[3] || "" };
}

// A Query listing's page: the items after the Marker (an offset), MaxRecords of them.
function queryPage(data: {
  action: string;
  container: string;
  itemTag: string;
  items: Array<JSONObject>;
  form: URLSearchParams;
}): FakeResponse {
  const offset: number = Number(data.form.get("Marker") || "0") || 0;
  const size: number = Number(data.form.get("MaxRecords") || "100") || 100;
  const page: Array<JSONObject> = data.items.slice(offset, offset + size);
  const next: string =
    offset + size < data.items.length ? String(offset + size) : "";

  return {
    status: 200,
    body: `<${data.action}Response xmlns="http://example.com/doc/"><${data.action}Result><${data.container}>${page
      .map((item: JSONObject): string => {
        return `<${data.itemTag}>${xmlOf(item)}</${data.itemTag}>`;
      })
      .join(
        "",
      )}</${data.container}>${next ? `<Marker>${next}</Marker>` : ""}</${data.action}Result></${data.action}Response>`,
  };
}

function snapshotItems(
  snapshots: Array<FakeSnapshot>,
  cluster: boolean,
  region: string,
  account: string,
): Array<JSONObject> {
  return snapshots.map((snapshot: FakeSnapshot): JSONObject => {
    return cluster
      ? {
          DBClusterSnapshotIdentifier: snapshot.id,
          DBClusterIdentifier: snapshot.source,
          DBClusterSnapshotArn: `arn:aws:rds:${region}:${account}:cluster-snapshot:${snapshot.id}`,
          SnapshotType: "manual",
          StorageEncrypted: snapshot.encrypted !== false,
        }
      : {
          DBSnapshotIdentifier: snapshot.id,
          DBInstanceIdentifier: snapshot.source,
          DBSnapshotArn: `arn:aws:rds:${region}:${account}:snapshot:${snapshot.id}`,
          SnapshotType: "manual",
          Encrypted: snapshot.encrypted !== false,
        };
  });
}

function snapshotAttributes(
  snapshots: Array<FakeSnapshot>,
  cluster: boolean,
  form: URLSearchParams,
): FakeResponse {
  const prefix: string = cluster ? "DBClusterSnapshot" : "DBSnapshot";
  const id: string = form.get(`${prefix}Identifier`) || "";
  const snapshot: FakeSnapshot | undefined = snapshots.find(
    (candidate: FakeSnapshot): boolean => {
      return candidate.id === id;
    },
  );

  if (!snapshot) {
    return queryError(404, `${prefix}NotFoundFault`, "not found");
  }

  const action: string = `Describe${prefix}Attributes`;

  return {
    status: 200,
    body: `<${action}Response><${action}Result><${prefix}AttributesResult><${prefix}Identifier>${id}</${prefix}Identifier><${prefix}Attributes><${prefix}Attribute><AttributeName>restore</AttributeName><AttributeValues>${(
      snapshot.restore || []
    )
      .map((value: string): string => {
        return `<AttributeValue>${value}</AttributeValue>`;
      })
      .join(
        "",
      )}</AttributeValues></${prefix}Attribute></${prefix}Attributes></${prefix}AttributesResult></${action}Result></${action}Response>`,
  };
}

/*
 * ModifyDB[Cluster]SnapshotAttribute: the "restore" values named in
 * ValuesToRemove.AttributeValue.N (and ValuesToAdd) leave (and join) the
 * snapshot, as RDS keeps them; it answers with the attributes after.
 */
function modifySnapshotAttribute(
  snapshots: Array<FakeSnapshot>,
  cluster: boolean,
  form: URLSearchParams,
): FakeResponse {
  const prefix: string = cluster ? "DBClusterSnapshot" : "DBSnapshot";
  const id: string = form.get(`${prefix}Identifier`) || "";
  const snapshot: FakeSnapshot | undefined = snapshots.find(
    (candidate: FakeSnapshot): boolean => {
      return candidate.id === id;
    },
  );

  if (!snapshot) {
    return queryError(404, `${prefix}NotFoundFault`, "not found");
  }

  if (form.get("AttributeName") !== "restore") {
    return queryError(400, "InvalidParameterValue", "AttributeName");
  }

  const listed: (name: string) => Array<string> = (
    name: string,
  ): Array<string> => {
    const values: Array<string> = [];

    for (
      let index: number = 1;
      form.has(`${name}.AttributeValue.${index}`);
      index++
    ) {
      values.push(form.get(`${name}.AttributeValue.${index}`) || "");
    }

    return values;
  };
  const removed: Array<string> = listed("ValuesToRemove");

  snapshot.restore = [
    ...(snapshot.restore || []).filter((value: string): boolean => {
      return !removed.includes(value);
    }),
    ...listed("ValuesToAdd"),
  ];

  const answered: FakeResponse = snapshotAttributes(snapshots, cluster, form);
  const action: string = `Modify${prefix}Attribute`;

  return {
    status: 200,
    body: String(answered.body)
      .split(`Describe${prefix}Attributes`)
      .join(action),
  };
}

// RDS, Redshift and ElastiCache: the Query protocol's data store calls.
function queryDataStoreAnswer(data: {
  service: string;
  region: string;
  account: string;
  form: URLSearchParams;
  fakeRegion: FakeRegion;
}): FakeResponse {
  const action: string = data.form.get("Action") || "";
  const fake: FakeRegion = data.fakeRegion;
  const error: FakeResponse | undefined =
    fake.dataErrors?.[`${data.service}:${action}`];

  if (error) {
    return error;
  }

  const page: (
    container: string,
    itemTag: string,
    items: Array<JSONObject>,
  ) => FakeResponse = (
    container: string,
    itemTag: string,
    items: Array<JSONObject>,
  ): FakeResponse => {
    return queryPage({ action, container, itemTag, items, form: data.form });
  };

  switch (`${data.service}:${action}`) {
    case "rds:DescribeDBInstances":
      return page("DBInstances", "DBInstance", fake.dbInstances || []);
    case "rds:DescribeDBClusters":
      return page("DBClusters", "DBCluster", fake.dbClusters || []);
    case "rds:DescribeDBSnapshots":
      return page(
        "DBSnapshots",
        "DBSnapshot",
        snapshotItems(fake.dbSnapshots || [], false, data.region, data.account),
      );
    case "rds:DescribeDBClusterSnapshots":
      return page(
        "DBClusterSnapshots",
        "DBClusterSnapshot",
        snapshotItems(
          fake.dbClusterSnapshots || [],
          true,
          data.region,
          data.account,
        ),
      );
    case "rds:DescribeDBSnapshotAttributes":
      return snapshotAttributes(fake.dbSnapshots || [], false, data.form);
    case "rds:DescribeDBClusterSnapshotAttributes":
      return snapshotAttributes(fake.dbClusterSnapshots || [], true, data.form);
    case "rds:ModifyDBSnapshotAttribute":
      return modifySnapshotAttribute(fake.dbSnapshots || [], false, data.form);
    case "rds:ModifyDBClusterSnapshotAttribute":
      return modifySnapshotAttribute(
        fake.dbClusterSnapshots || [],
        true,
        data.form,
      );
    case "redshift:DescribeClusters":
      return page("Clusters", "Cluster", fake.redshiftClusters || []);
    case "redshift:DescribeLoggingStatus":
      return {
        status: 200,
        body: `<DescribeLoggingStatusResponse><DescribeLoggingStatusResult><LoggingEnabled>${
          fake.redshiftLogging?.[data.form.get("ClusterIdentifier") || ""]
            ? "true"
            : "false"
        }</LoggingEnabled></DescribeLoggingStatusResult></DescribeLoggingStatusResponse>`,
      };
    case "elasticache:DescribeReplicationGroups":
      return page(
        "ReplicationGroups",
        "ReplicationGroup",
        fake.replicationGroups || [],
      );
    default:
      return queryError(400, "InvalidAction");
  }
}

// DynamoDB and KMS: the JSON protocol's data store calls.
function jsonDataStoreAnswer(data: {
  service: string;
  action: string;
  body: JSONObject;
  fakeRegion: FakeRegion;
}): FakeResponse {
  const fake: FakeRegion = data.fakeRegion;
  const error: FakeResponse | undefined =
    fake.dataErrors?.[`${data.service}:${data.action}`];

  if (error) {
    return error;
  }

  if (data.service === "kms") {
    return json({
      Aliases: (fake.kmsAliases || []) as unknown as JSONValue,
      Truncated: false,
    });
  }

  const tables: Array<FakeTable> = fake.dynamoTables || [];
  const named: FakeTable | undefined = tables.find(
    (candidate: FakeTable): boolean => {
      return candidate.table["TableName"] === data.body["TableName"];
    },
  );

  if (data.action === "ListTables") {
    return json({
      TableNames: tables.map((candidate: FakeTable): JSONValue => {
        return candidate.table["TableName"] as JSONValue;
      }),
    });
  }

  if (!named) {
    return awsError(400, "ResourceNotFoundException", "not found");
  }

  if (data.action === "DescribeTable") {
    return json({ Table: named.table });
  }

  if (data.action === "DescribeContinuousBackups") {
    return json({
      ContinuousBackupsDescription: {
        ContinuousBackupsStatus: "ENABLED",
        PointInTimeRecoveryDescription: {
          PointInTimeRecoveryStatus: named.pointInTimeRecovery
            ? "ENABLED"
            : "DISABLED",
          ...(named.pointInTimeRecovery ? { RecoveryPeriodInDays: 35 } : {}),
        },
      },
    });
  }

  return awsError(400, "UnknownOperationException");
}

function publicAccessBlockXml(block: FakePublicAccessBlock): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><BlockPublicAcls>${block.BlockPublicAcls}</BlockPublicAcls><IgnorePublicAcls>${block.IgnorePublicAcls}</IgnorePublicAcls><BlockPublicPolicy>${block.BlockPublicPolicy}</BlockPublicPolicy><RestrictPublicBuckets>${block.RestrictPublicBuckets}</RestrictPublicBuckets></PublicAccessBlockConfiguration>`;
}

const S3_XMLNS: string = 'xmlns="http://s3.amazonaws.com/doc/2006-03-01/"';
const OWNER_CANONICAL_ID: string =
  "79a59df900b949e55d96a1e698fbacedfd6e09d98eacf8f8d5218e7cd47ef2be";

// One subresource of a bucket, at its own Region.
function bucketAnswer(data: {
  bucket: FakeBucket;
  subresource: string;
  key: string;
  url: URL;
  request: DataSourceHttpRequest;
  buckets: Array<FakeBucket>;
}): FakeBytesResponse {
  const bucket: FakeBucket = data.bucket;
  const xml: (body: string) => FakeResponse = (body: string): FakeResponse => {
    return {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?>\n${body}`,
    };
  };

  switch (data.subresource) {
    case "location":
      return xml(
        bucket.region === "us-east-1"
          ? `<LocationConstraint ${S3_XMLNS}/>`
          : `<LocationConstraint ${S3_XMLNS}>${bucket.region}</LocationConstraint>`,
      );
    case "policyStatus":
      return bucket.policy
        ? xml(
            `<PolicyStatus ${S3_XMLNS}><IsPublic>${bucket.isPublic ? "TRUE" : "FALSE"}</IsPublic></PolicyStatus>`,
          )
        : s3Error(
            404,
            "NoSuchBucketPolicy",
            "The bucket policy does not exist",
          );
    case "policy":
      return bucket.policy
        ? { status: 200, body: JSON.stringify(bucket.policy) }
        : s3Error(
            404,
            "NoSuchBucketPolicy",
            "The bucket policy does not exist",
          );
    case "publicAccessBlock":
      return bucket.publicAccessBlock
        ? { status: 200, body: publicAccessBlockXml(bucket.publicAccessBlock) }
        : s3Error(
            404,
            "NoSuchPublicAccessBlockConfiguration",
            "The public access block configuration was not found",
          );
    case "acl":
      return xml(
        `<AccessControlPolicy ${S3_XMLNS}><Owner><ID>${OWNER_CANONICAL_ID}</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>${OWNER_CANONICAL_ID}</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant>${(
          bucket.grants || []
        )
          .map(
            (grant: {
              uri?: string | undefined;
              id?: string | undefined;
              permission: string;
            }): string => {
              return grant.uri
                ? `<Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="Group"><URI>${grant.uri}</URI></Grantee><Permission>${grant.permission}</Permission></Grant>`
                : `<Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>${grant.id || ""}</ID></Grantee><Permission>${grant.permission}</Permission></Grant>`;
            },
          )
          .join("")}</AccessControlList></AccessControlPolicy>`,
      );
    case "encryption":
      return bucket.encryption
        ? xml(
            `<ServerSideEncryptionConfiguration ${S3_XMLNS}><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>${bucket.encryption.algorithm}</SSEAlgorithm>${
              bucket.encryption.kmsKeyId
                ? `<KMSMasterKeyID>${bucket.encryption.kmsKeyId}</KMSMasterKeyID>`
                : ""
            }</ApplyServerSideEncryptionByDefault><BucketKeyEnabled>true</BucketKeyEnabled></Rule></ServerSideEncryptionConfiguration>`,
          )
        : s3Error(
            404,
            "ServerSideEncryptionConfigurationNotFoundError",
            "The server side encryption configuration was not found",
          );
    case "versioning":
      return xml(
        bucket.versioning
          ? `<VersioningConfiguration ${S3_XMLNS}><Status>${bucket.versioning}</Status></VersioningConfiguration>`
          : `<VersioningConfiguration ${S3_XMLNS}/>`,
      );
    case "logging":
      return xml(
        `<BucketLoggingStatus ${S3_XMLNS}>${
          bucket.loggingTarget
            ? `<LoggingEnabled><TargetBucket>${bucket.loggingTarget}</TargetBucket><TargetPrefix>logs/</TargetPrefix></LoggingEnabled>`
            : ""
        }</BucketLoggingStatus>`,
      );
    case "ownershipControls":
      return bucket.ownership
        ? xml(
            `<OwnershipControls ${S3_XMLNS}><Rule><ObjectOwnership>${bucket.ownership}</ObjectOwnership></Rule></OwnershipControls>`,
          )
        : s3Error(
            404,
            "OwnershipControlsNotFoundError",
            "The bucket ownership controls were not found",
          );
    case "replication":
      return bucket.replicateTo && bucket.replicateTo.length > 0
        ? xml(
            `<ReplicationConfiguration ${S3_XMLNS}><Role>arn:aws:iam::${FAKE_ACCOUNT_ID}:role/replication</Role>${bucket.replicateTo
              .map((destination: string, index: number): string => {
                return `<Rule><ID>rule-${index}</ID><Priority>${index}</Priority><Status>Enabled</Status><DeleteMarkerReplication><Status>Disabled</Status></DeleteMarkerReplication><Destination><Bucket>arn:aws:s3:::${destination}</Bucket></Destination></Rule>`;
              })
              .join("")}</ReplicationConfiguration>`,
          )
        : s3Error(
            404,
            "ReplicationConfigurationNotFoundError",
            "The replication configuration was not found",
          );
    case "tagging":
      return bucket.tags
        ? xml(
            `<Tagging ${S3_XMLNS}><TagSet>${Object.entries(bucket.tags)
              .map(([key, value]: [string, string]): string => {
                return `<Tag><Key>${escapeXml(key)}</Key><Value>${escapeXml(value)}</Value></Tag>`;
              })
              .join("")}</TagSet></Tagging>`,
          )
        : s3Error(404, "NoSuchTagSet", "The TagSet does not exist");
    case "list": {
      // ListObjectsV2: by key, after the token (an offset), keys URL-encoded as S3 does (a space as "+").
      const prefix: string = data.url.searchParams.get("prefix") || "";
      const size: number =
        Number(data.url.searchParams.get("max-keys") || "1000") || 1000;
      const offset: number =
        Number(data.url.searchParams.get("continuation-token") || "0") || 0;
      const encode: boolean =
        data.url.searchParams.get("encoding-type") === "url";
      const matching: Array<FakeObject> = (bucket.objects || [])
        .filter((object: FakeObject): boolean => {
          return object.key.startsWith(prefix);
        })
        .sort((a: FakeObject, b: FakeObject): number => {
          return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
        });
      const page: Array<FakeObject> = matching.slice(offset, offset + size);
      const truncated: boolean = offset + size < matching.length;

      return xml(
        `<ListBucketResult ${S3_XMLNS}><Name>${bucket.name}</Name><Prefix>${escapeXml(prefix)}</Prefix><KeyCount>${page.length}</KeyCount><MaxKeys>${size}</MaxKeys>${
          encode ? "<EncodingType>url</EncodingType>" : ""
        }<IsTruncated>${truncated}</IsTruncated>${page
          .map((object: FakeObject): string => {
            const key: string = encode
              ? encodeURIComponent(object.key).split("%20").join("+")
              : escapeXml(object.key);

            return `<Contents><Key>${key}</Key><LastModified>${object.lastModified || "2026-10-01T00:00:00.000Z"}</LastModified><ETag>&quot;etag-${escapeXml(object.key)}&quot;</ETag><Size>${contentOf(object).length}</Size><StorageClass>${object.storageClass || "STANDARD"}</StorageClass></Contents>`;
          })
          .join("")}${
          truncated
            ? `<NextContinuationToken>${offset + size}</NextContinuationToken>`
            : ""
        }</ListBucketResult>`,
      );
    }
    case "object": {
      const object: FakeObject | undefined = (bucket.objects || []).find(
        (candidate: FakeObject): boolean => {
          return candidate.key === data.key;
        },
      );

      if (!object) {
        return s3Error(404, "NoSuchKey", "The specified key does not exist.");
      }

      const bytes: Buffer = contentOf(object);

      if (bytes.length === 0) {
        return s3Error(
          416,
          "InvalidRange",
          "The requested range is not satisfiable",
        );
      }

      // Range: bytes=0-N, as the reader asks.
      const range: string = headerOf(data.request, "Range");
      const end: number = range.startsWith("bytes=0-")
        ? Number(range.slice("bytes=0-".length))
        : bytes.length - 1;
      const sent: Buffer = bytes.subarray(0, Math.min(bytes.length, end + 1));

      return {
        status: range ? 206 : 200,
        body: sent.toString("utf8"),
        bytes: sent,
      };
    }
    default:
      return s3Error(400, "InvalidRequest", `no fake for ${data.subresource}`);
  }
}

/*
 * PutPublicAccessBlock: taken only with the body's Content-MD5, as S3
 * takes it, and kept on the bucket - the next read sees it.
 */
function putPublicAccessBlock(
  bucket: FakeBucket,
  request: DataSourceHttpRequest,
): FakeResponse {
  const body: string = typeof request.body === "string" ? request.body : "";
  const sent: string = headerOf(request, "Content-MD5");

  if (!sent) {
    return s3Error(
      400,
      "InvalidRequest",
      "Missing required header for this request: Content-MD5",
    );
  }

  if (sent !== createHash("md5").update(body, "utf8").digest("base64")) {
    return s3Error(
      400,
      "InvalidDigest",
      "The Content-MD5 you specified did not match what we received.",
    );
  }

  const setting: (name: string) => boolean = (name: string): boolean => {
    const open: string = `<${name}>`;
    const start: number = body.indexOf(open);

    return (
      start >= 0 &&
      body.slice(start + open.length, start + open.length + 4) === "true"
    );
  };

  bucket.publicAccessBlock = {
    BlockPublicAcls: setting("BlockPublicAcls"),
    IgnorePublicAcls: setting("IgnorePublicAcls"),
    BlockPublicPolicy: setting("BlockPublicPolicy"),
    RestrictPublicBuckets: setting("RestrictPublicBuckets"),
  };

  return { status: 200, body: "" };
}

const BUCKET_SUBRESOURCES: Array<string> = [
  "location",
  "policyStatus",
  "policy",
  "publicAccessBlock",
  "acl",
  "encryption",
  "versioning",
  "logging",
  "ownershipControls",
  "replication",
  "tagging",
];

// Every path but POST /: S3 and S3 Control (GET), OpenSearch and EFS (REST-JSON).
const REST_PATH: RegExp = /^\//;

// X-Amz-Date (20261021T120700Z) as epoch ms, or NaN.
function signedAtMs(request: DataSourceHttpRequest): number {
  const value: string = headerOf(request, "X-Amz-Date");

  if (value.length !== 16) {
    return NaN;
  }

  return Date.parse(
    `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`,
  );
}

function headerOf(request: DataSourceHttpRequest, name: string): string {
  const headers: Record<string, string> = (request.headers || {}) as Record<
    string,
    string
  >;

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key] || "";
    }
  }

  return "";
}

// The Region a host names: monitoring.us-east-1.amazonaws.com -> us-east-1.
function regionOf(host: string): string {
  return host.split(".")[1] || "";
}

function dimensionsMatch(
  metric: FakeMetric,
  dimensions: Array<JSONObject>,
): boolean {
  if (metric.dimensions.length !== dimensions.length) {
    return false;
  }

  return metric.dimensions.every(([name, value]: [string, string]) => {
    return dimensions.some((dimension: JSONObject): boolean => {
      return dimension["Name"] === name && dimension["Value"] === value;
    });
  });
}

export function createFakeAws(options: FakeAwsOptions): FakeAws {
  const cloudWatchCalls: FakeAws["cloudWatchCalls"] = [];
  const stsCalls: FakeAws["stsCalls"] = [];
  const taggingCalls: FakeAws["taggingCalls"] = [];
  const cloudControlCalls: FakeAws["cloudControlCalls"] = [];
  const assumedRoles: Array<string> = [];
  const organizationsCalls: Array<string> = [];
  const cloudTrailCalls: FakeAws["cloudTrailCalls"] = [];
  const healthCalls: FakeAws["healthCalls"] = [];
  const getMetricDataTurns: Map<string, number> = new Map();
  const account: string = options.account || FAKE_ACCOUNT_ID;
  const expiredSignatures: { count: number } = { count: 0 };
  const s3Calls: FakeAws["s3Calls"] = [];
  const dataCalls: FakeAws["dataCalls"] = [];
  // An object answer's bytes, by the request it answered.
  const bytesOfAnswer: WeakMap<DataSourceHttpRequest, Buffer> = new WeakMap();

  const route: FakeRoute = {
    path: "/",
    method: "POST",
    respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
      const host: string = url.host;
      const service: string = host.split(".")[0] || "";
      const region: string = regionOf(host);

      if (options.awsClock) {
        const signedAt: number = signedAtMs(request);

        if (
          !Number.isFinite(signedAt) ||
          options.awsClock().getTime() - signedAt > 5 * 60 * 1000
        ) {
          expiredSignatures.count++;

          return service === "sts"
            ? stsError(
                403,
                "SignatureDoesNotMatch",
                "Signature expired: the request is more than five minutes old.",
              )
            : awsError(
                400,
                "InvalidSignatureException",
                "Signature expired: the request is more than five minutes old.",
              );
        }
      }

      if (service === "sts") {
        const form: URLSearchParams = new URLSearchParams(
          String(request.body || ""),
        );
        const action: string = form.get("Action") || "";
        stsCalls.push({ action, body: form, request });

        if (action === "GetCallerIdentity") {
          if (options.callerIdentityError) {
            return options.callerIdentityError;
          }

          const caller: string = accountOfKey(request) || account;

          return {
            status: 200,
            body: `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:iam::${caller}:user/reader</Arn><UserId>AIDAEXAMPLE</UserId><Account>${caller}</Account></GetCallerIdentityResult><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
          };
        }

        if (action === "AssumeRole") {
          if (options.assumeRoleError) {
            return options.assumeRoleError;
          }

          const roleArn: string = form.get("RoleArn") || "";
          assumedRoles.push(roleArn);

          if (
            (options.refusedRoles || []).some((refused: string): boolean => {
              return refused.toLowerCase() === roleArn.toLowerCase();
            })
          ) {
            return stsError(
              403,
              "AccessDenied",
              "User is not authorized to perform: sts:AssumeRole",
            );
          }

          // A key that names the role's account, for GetCallerIdentity.
          const roleAccount: string = accountOfRoleArn(roleArn);
          const keyId: string =
            roleAccount && roleAccount !== account
              ? `ASIA${roleAccount}ROLE`
              : "ASIAASSUMEDROLE00001";

          return {
            status: 200,
            body: `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><AssumedRoleUser><Arn>arn:aws:sts::${roleAccount || account}:assumed-role/OneUptimeReadOnly/x</Arn><AssumedRoleId>AROA:x</AssumedRoleId></AssumedRoleUser><Credentials><AccessKeyId>${keyId}</AccessKeyId><SecretAccessKey>assumed/secret&amp;key</SecretAccessKey><SessionToken>session-token-abc</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`,
          };
        }

        return stsError(400, "InvalidAction");
      }

      // IAM's one global endpoint: the account's alias.
      if (service === "iam") {
        const form: URLSearchParams = new URLSearchParams(
          String(request.body || ""),
        );

        if (form.get("Action") !== "ListAccountAliases") {
          return stsError(400, "InvalidAction");
        }

        return {
          status: 200,
          body: `<ListAccountAliasesResponse xmlns="https://iam.amazonaws.com/doc/2010-05-08/"><ListAccountAliasesResult><IsTruncated>false</IsTruncated><AccountAliases>${
            options.accountAlias
              ? `<member>${options.accountAlias}</member>`
              : ""
          }</AccountAliases></ListAccountAliasesResult></ListAccountAliasesResponse>`,
        };
      }

      if (service === "organizations") {
        organizationsCalls.push(region);

        if (options.organizationsError) {
          return options.organizationsError;
        }

        return json({
          Accounts: (options.organizationAccounts ||
            []) as unknown as JSONValue,
        });
      }

      // AWS Health, in the partition's home Region.
      if (service === "health") {
        const action: string =
          headerOf(request, "X-Amz-Target").split(".")[1] || "";
        const body: JSONObject = bodyOf(request);
        const caller: string = accountOfKey(request) || account;
        healthCalls.push({ action, body, region, account: caller });

        if (options.healthError) {
          return options.healthError;
        }

        if (options.healthErrorsByAccount?.[caller]) {
          return options.healthErrorsByAccount[caller]!;
        }

        if (action === "DescribeEventDetails") {
          const arns: Array<string> = (body["eventArns"] ||
            []) as Array<string>;

          return json({
            successfulSet: arns
              .filter((arn: string): boolean => {
                return Boolean(options.healthDescriptions?.[arn]);
              })
              .map((arn: string) => {
                return {
                  event: { arn },
                  eventDescription: {
                    latestDescription: options.healthDescriptions![arn],
                  },
                };
              }),
            failedSet: [],
          });
        }

        return json({ events: options.healthEvents || [] });
      }

      const fakeRegion: FakeRegion | undefined = options.regions[region];

      if (!fakeRegion) {
        // An opt-in Region the account has not enabled.
        return awsError(
          403,
          "UnrecognizedClientException",
          "The security token included in the request is invalid.",
        );
      }

      if (fakeRegion.error) {
        return fakeRegion.error;
      }

      // Data stores over the Query protocol: a form body, read before any JSON is.
      if (
        service === "rds" ||
        service === "redshift" ||
        service === "elasticache"
      ) {
        const form: URLSearchParams = new URLSearchParams(
          String(request.body || ""),
        );
        const caller: string = accountOfKey(request) || account;

        dataCalls.push({
          service,
          action: form.get("Action") || "",
          region,
          account: caller,
          params: formFieldsOf(form),
        });

        return queryDataStoreAnswer({
          service,
          region,
          account: caller,
          form,
          fakeRegion,
        });
      }

      const target: string = headerOf(request, "X-Amz-Target");
      const body: JSONObject = bodyOf(request);

      // Data stores over the JSON protocol, before CloudWatch's.
      if (service === "dynamodb" || service === "kms") {
        const dataAction: string = target.split(".")[1] || "";

        dataCalls.push({
          service,
          action: dataAction,
          region,
          account: accountOfKey(request) || account,
        });

        return jsonDataStoreAnswer({
          service,
          action: dataAction,
          body,
          fakeRegion,
        });
      }

      if (service === "cloudcontrolapi") {
        const typeName: string = String(body["TypeName"] || "");
        const resourceModel: string = String(body["ResourceModel"] || "");
        cloudControlCalls.push({
          region,
          typeName,
          resourceModel,
          account: accountOfKey(request) || account,
        });

        const error: FakeResponse | undefined =
          fakeRegion.resourceErrors?.[typeName];

        if (error) {
          return error;
        }

        const listed: Array<{ Identifier: string; Properties: JSONObject }> = (
          fakeRegion.resources?.[typeName] || []
        ).filter((resource: { Properties: JSONObject }): boolean => {
          // A child type lists the resources of the parent the model names.
          if (!resourceModel) {
            return true;
          }

          const model: JSONObject = JSON.parse(resourceModel) as JSONObject;
          return Object.keys(model).every((key: string): boolean => {
            return resource.Properties[key] === model[key];
          });
        });

        return json({
          TypeName: typeName,
          ResourceDescriptions: listed.map(
            (resource: { Identifier: string; Properties: JSONObject }) => {
              return {
                Identifier: resource.Identifier,
                Properties: JSON.stringify(resource.Properties),
              };
            },
          ),
        });
      }

      if (service === "cloudtrail") {
        cloudTrailCalls.push({
          region,
          body,
          account: accountOfKey(request) || account,
        });

        if (fakeRegion.trailError) {
          return fakeRegion.trailError;
        }

        const start: number = Number(body["StartTime"]);
        const end: number = Number(body["EndTime"]);
        // Newest first, as LookupEvents lists them.
        const events: Array<JSONObject> = (fakeRegion.trailEvents || [])
          .filter((event: JSONObject): boolean => {
            const time: number = Number(event["EventTime"]);
            return time >= start && time <= end;
          })
          .sort((a: JSONObject, b: JSONObject): number => {
            return Number(b["EventTime"]) - Number(a["EventTime"]);
          });
        const pageSize: number = fakeRegion.trailPageSize || 50;
        const offset: number = body["NextToken"]
          ? Number(body["NextToken"])
          : 0;

        return json({
          Events: events.slice(offset, offset + pageSize),
          ...(offset + pageSize < events.length
            ? { NextToken: String(offset + pageSize) }
            : {}),
        });
      }

      if (service === "tagging") {
        taggingCalls.push({ region, body });

        if (fakeRegion.tagsError) {
          return fakeRegion.tagsError;
        }

        return json({
          ResourceTagMappingList: Object.entries(fakeRegion.names || {}).map(
            ([arn, name]: [string, string]) => {
              return { ResourceARN: arn, Tags: [{ Key: "Name", Value: name }] };
            },
          ),
          PaginationToken: "",
        });
      }

      const action: string = target.split(".")[1] || "";
      cloudWatchCalls.push({ action, region, body });

      if (action === "ListMetrics") {
        const matched: Array<FakeMetric> = fakeRegion.metrics.filter(
          (metric: FakeMetric): boolean => {
            return (
              metric.namespace === body["Namespace"] &&
              (!body["MetricName"] || metric.metricName === body["MetricName"])
            );
          },
        );

        return json({
          Metrics: matched.map((metric: FakeMetric) => {
            return {
              Namespace: metric.namespace,
              MetricName: metric.metricName,
              Dimensions: metric.dimensions.map(
                ([Name, Value]: [string, string]) => {
                  return { Name, Value };
                },
              ),
            };
          }),
        });
      }

      if (action === "GetMetricData") {
        const turn: number = getMetricDataTurns.get(region) || 0;
        getMetricDataTurns.set(region, turn + 1);
        const scripted: FakeResponse | undefined =
          fakeRegion.getMetricDataAnswers?.[turn];

        if (scripted) {
          return scripted;
        }

        const queries: Array<JSONObject> = (body["MetricDataQueries"] ||
          []) as Array<JSONObject>;

        return json({
          MetricDataResults: queries.map((query: JSONObject) => {
            const stat: JSONObject = query["MetricStat"] as JSONObject;
            const metric: JSONObject = stat["Metric"] as JSONObject;
            const found: FakeMetric | undefined = fakeRegion.metrics.find(
              (candidate: FakeMetric): boolean => {
                return (
                  candidate.namespace === metric["Namespace"] &&
                  candidate.metricName === metric["MetricName"] &&
                  dimensionsMatch(
                    candidate,
                    (metric["Dimensions"] || []) as Array<JSONObject>,
                  )
                );
              },
            );
            const values: Array<[number, number]> = (
              found?.values || []
            ).filter(([time]: [number, number]): boolean => {
              return (
                time >= Number(body["StartTime"]) &&
                time < Number(body["EndTime"])
              );
            });

            return {
              Id: query["Id"],
              Timestamps: values.map(([time]: [number, number]) => {
                return time;
              }),
              Values: values.map(([, value]: [number, number]) => {
                return value;
              }),
              StatusCode: "Complete",
            };
          }),
        });
      }

      return awsError(400, "InvalidAction");
    },
  };

  /*
   * The APIs addressed by their path: S3 (GET, path style, at
   * s3.<region>.amazonaws.com), S3 Control (<account>.s3-control.<region>),
   * and OpenSearch's and EFS's REST-JSON.
   */
  const restRoute: FakeRoute = {
    path: REST_PATH,
    respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
      const host: string = url.host;
      const labels: Array<string> = host.split(".");
      const signed: { region: string; service: string } =
        signedScopeOf(request);
      const caller: string = accountOfKey(request) || account;
      const query: Record<string, string> = {};

      url.searchParams.forEach((value: string, name: string) => {
        query[name] = value;
      });

      if (labels[1] === "s3-control") {
        s3Calls.push({
          bucket: "",
          subresource: "accountPublicAccessBlock",
          hostRegion: labels[2] || "",
          signedRegion: signed.region,
          account: caller,
          key: "",
          range: "",
          query,
          method: request.method,
          body: typeof request.body === "string" ? request.body : "",
          headers: headersOf(request),
        });

        if (options.accountPublicAccessBlockError) {
          return options.accountPublicAccessBlockError;
        }

        return options.accountPublicAccessBlock
          ? {
              status: 200,
              body: publicAccessBlockXml(options.accountPublicAccessBlock),
            }
          : s3Error(
              404,
              "NoSuchPublicAccessBlockConfiguration",
              "The public access block configuration was not found",
            );
      }

      if (labels[0] === "s3") {
        const hostRegion: string = labels[1] || "";
        const segments: Array<string> = url.pathname.split("/").slice(1);
        const bucketName: string = decodeURIComponent(segments[0] || "");
        const key: string = segments
          .slice(1)
          .map((segment: string): string => {
            return decodeURIComponent(segment);
          })
          .join("/");
        const read: string = !bucketName
          ? "buckets"
          : segments.length > 1
            ? "object"
            : url.searchParams.get("list-type") === "2"
              ? "list"
              : BUCKET_SUBRESOURCES.find((name: string): boolean => {
                  return url.searchParams.has(name);
                }) || "unknown";
        // A PUT of a subresource writes it: "putPublicAccessBlock".
        const subresource: string =
          request.method === "PUT"
            ? `put${read.charAt(0).toUpperCase()}${read.slice(1)}`
            : read;

        s3Calls.push({
          bucket: bucketName,
          subresource,
          hostRegion,
          signedRegion: signed.region,
          account: caller,
          key,
          range: headerOf(request, "Range"),
          query,
          method: request.method,
          body: typeof request.body === "string" ? request.body : "",
          headers: headersOf(request),
        });

        // Signed for one Region and sent to another: S3 names the right one.
        if (signed.region !== hostRegion) {
          return s3Error(
            400,
            "AuthorizationHeaderMalformed",
            `The authorization header is malformed; the region '${signed.region}' is wrong; expecting '${hostRegion}'`,
            `<Region>${hostRegion}</Region>`,
          );
        }

        if (subresource === "buckets") {
          if (options.bucketListError) {
            return options.bucketListError;
          }

          const all: Array<FakeBucket> = options.buckets || [];
          const size: number = options.bucketPageSize || 1000;
          const offset: number =
            Number(url.searchParams.get("continuation-token") || "0") || 0;
          const page: Array<FakeBucket> = all.slice(offset, offset + size);
          const next: string =
            offset + size < all.length ? String(offset + size) : "";

          return {
            status: 200,
            body: `<?xml version="1.0" encoding="UTF-8"?>\n<ListAllMyBucketsResult ${S3_XMLNS}><Buckets>${page
              .map((bucket: FakeBucket): string => {
                return `<Bucket><Name>${bucket.name}</Name><CreationDate>2026-01-01T00:00:00.000Z</CreationDate>${
                  bucket.hideRegion
                    ? ""
                    : `<BucketRegion>${bucket.region}</BucketRegion>`
                }</Bucket>`;
              })
              .join(
                "",
              )}</Buckets><Owner><ID>${OWNER_CANONICAL_ID}</ID></Owner>${
              next ? `<ContinuationToken>${next}</ContinuationToken>` : ""
            }</ListAllMyBucketsResult>`,
          };
        }

        const bucket: FakeBucket | undefined = (options.buckets || []).find(
          (candidate: FakeBucket): boolean => {
            return candidate.name === bucketName;
          },
        );

        if (!bucket) {
          return s3Error(
            404,
            "NoSuchBucket",
            "The specified bucket does not exist",
          );
        }

        // GetBucketLocation answers anywhere; everything else at the bucket's own Region.
        if (subresource !== "location" && hostRegion !== bucket.region) {
          return s3Error(
            301,
            "PermanentRedirect",
            "The bucket you are attempting to access must be addressed using the specified endpoint. Please send all future requests to this endpoint.",
            `<Endpoint>s3.${bucket.region}.amazonaws.com</Endpoint><Bucket>${bucket.name}</Bucket>`,
          );
        }

        // A request that names the bucket's owner is refused for another account's bucket.
        const expectedOwner: string = headerOf(
          request,
          "x-amz-expected-bucket-owner",
        );

        if (expectedOwner && expectedOwner !== account) {
          return s3Error(403, "AccessDenied", "Access Denied");
        }

        const error: FakeResponse | undefined = bucket.errors?.[subresource];

        if (error) {
          return error;
        }

        if (subresource === "putPublicAccessBlock") {
          return putPublicAccessBlock(bucket, request);
        }

        const answer: FakeBytesResponse = bucketAnswer({
          bucket,
          subresource,
          key,
          url,
          request,
          buckets: options.buckets || [],
        });

        if (answer.bytes) {
          bytesOfAnswer.set(request, answer.bytes);
        }

        return answer;
      }

      // OpenSearch Service and EFS, at their Region.
      const service: string = labels[0] || "";
      const region: string = labels[1] || "";
      const fakeRegion: FakeRegion | undefined = options.regions[region];
      const action: string =
        service === "es"
          ? request.method === "POST"
            ? "DescribeDomains"
            : "ListDomainNames"
          : "DescribeFileSystems";

      dataCalls.push({ service, action, region, account: caller });

      if (!fakeRegion) {
        // An opt-in Region the account has not enabled, in REST-JSON's words.
        return {
          status: 403,
          body: JSON.stringify({
            message: "The security token included in the request is invalid.",
          }),
        };
      }

      const error: FakeResponse | undefined =
        fakeRegion.dataErrors?.[`${service}:${action}`];

      if (error) {
        return error;
      }

      if (service === "es" && action === "ListDomainNames") {
        return json({
          DomainNames: (fakeRegion.openSearchDomains || []).map(
            (domain: JSONObject): JSONValue => {
              return {
                DomainName: domain["DomainName"]!,
                EngineType: "OpenSearch",
              };
            },
          ),
        });
      }

      if (service === "es") {
        const wanted: Array<string> = (bodyOf(request)["DomainNames"] ||
          []) as Array<string>;

        return json({
          DomainStatusList: (fakeRegion.openSearchDomains || []).filter(
            (domain: JSONObject): boolean => {
              return wanted.includes(String(domain["DomainName"]));
            },
          ),
        });
      }

      if (service === "elasticfilesystem") {
        return json({ FileSystems: fakeRegion.fileSystems || [] });
      }

      return awsError(400, "UnknownOperationException");
    },
  };

  const api: FakeProviderApi = createFakeProviderApi([route, restRoute]);

  /*
   * The production transport's keepBodyBytes: a request that keeps them
   * gets the body's own bytes as bodyBytes - an object's as stored, any
   * other answer's text as UTF-8 - and one that does not gets text alone.
   */
  const transport: LlmConnectorTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const response: DataSourceHttpResponse = await api.transport(request);

    if (!request.keepBodyBytes) {
      return response;
    }

    return {
      ...response,
      bodyBytes:
        bytesOfAnswer.get(request) || Buffer.from(response.bodyText, "utf8"),
    };
  };

  return {
    ...api,
    transport,
    cloudWatchCalls,
    stsCalls,
    taggingCalls,
    cloudControlCalls,
    organizationsCalls,
    assumedRoles,
    cloudTrailCalls,
    healthCalls,
    expiredSignatures,
    s3Calls,
    dataCalls,
  };
}
