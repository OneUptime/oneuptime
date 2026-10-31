import { CloudConnectionAuthMethod } from "../../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../../Types/CloudConnection/CloudConnectionTest";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  getDataStoreAccessKey,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { tlsVersionNumber } from "../../../../../Types/DataSecurity/DataStorePosture";
import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  AwsCredentials,
  AwsPartition,
  AwsRestResponse,
  awsErrorCodeOf,
  getAwsHost,
  getAwsPartition,
  readXmlChildren,
  readXmlTag,
  readXmlTags,
  sendAwsRequest,
  sendAwsRestRequest,
} from "../../../CloudConnection/Aws/AwsApi";
import AwsCloudConnector, {
  AWS_MAX_ORGANIZATION_ACCOUNTS,
} from "../../../CloudConnection/Aws/AwsCloudConnector";
import {
  AwsOrganizationAccount,
  listAwsOrganizationAccounts,
} from "../../../CloudConnection/Aws/AwsOrganizations";
import {
  AWS_DEFAULT_REGIONS,
  isAwsRegion,
} from "../../../CloudConnection/Aws/AwsRegions";
import {
  AwsCallerIdentity,
  getCallerIdentity,
  getStsRegion,
} from "../../../CloudConnection/Aws/AwsSts";
import {
  Settled,
  mapWithConcurrency,
} from "../../../CloudConnection/CloudConcurrency";
import {
  CloudConnectionSettings,
  CloudConnectorCallOptions,
  CloudConnectorTransport,
  CloudReadBudget,
  CloudReadBudgetSpent,
  getOrganizationLimitWarning,
} from "../../../CloudConnection/CloudConnectorTypes";
import DataSourceHttpFetch from "../../../DataSource/HttpFetch";
import LlmProviderError from "../../../LlmObservability/LlmProviderError";
import {
  readArray,
  readCount,
  readObject,
  readText,
} from "../../../LlmObservability/LlmProviderHttp";
import {
  CloudDataSecurityReadResult,
  CloudDataStoreRead,
  ObjectStoreListPage,
  ObjectStoreObject,
  ObjectStoreReader,
} from "../DataSecurityCloudTypes";

/*
 * AMAZON WEB SERVICES, READ FOR DATA SECURITY: every data store of the
 * accounts a connection reaches, what its configuration says about its
 * safety (DataStorePostureFacts) and who can reach it (DataStoreAccessEntry),
 * read with the connection's opt-in data security policy
 * (CloudConnectionSetupCommands: OneUptimeDataSecurity).
 *
 *   S3           ListBuckets, with each bucket's Region; then each bucket
 *                at its own Region - a request signed for another one is
 *                redirected, not answered: its policy and AWS's verdict on
 *                it, its public access block (and the account's), its ACL,
 *                default encryption, versioning, access logging, object
 *                ownership, replication and tags.
 *   RDS, Aurora  instances and clusters, and whom their manual snapshots
 *                are shared with ("restore" holding "all" is everyone).
 *   DynamoDB     tables, their key and point-in-time recovery.
 *   Redshift     clusters and their audit logging.
 *   OpenSearch   domains: their network, encryption, TLS and access policy.
 *   ElastiCache  replication groups, and EFS file systems: encryption.
 *   KMS          the aliases, to tell AWS's own keys (alias/aws/rds...) from
 *                the ones a customer manages: a key ARN alone does not say.
 *
 * What the role may not read becomes a null fact, a line on the store and
 * one warning per API and account - never a guess, and never a failed
 * read. A credential AWS refuses fails the read, as the inventory's does.
 * An organization is read account by account through the role its
 * StackSet put in each; a Region the account has not opted in to answers
 * as an unknown credential and is skipped. Requests are bounded: page and
 * item caps, a few at a time per account, and the read's budget.
 *
 * createAwsObjectStoreReader hands the content scanner one bucket: a page
 * of its keys (ListObjectsV2) and the first bytes of an object (a ranged
 * GetObject) - the "content" level's s3:ListBucket and s3:GetObject.
 */

const PROVIDER_TITLE: string = "AWS";
const S3_TITLE: string = "AWS S3";
// Regions read at once for one account, and buckets read at once.
const REGION_CONCURRENCY: number = 4;
const BUCKET_CONCURRENCY: number = 6;
// The most buckets of one account read; ListBuckets pages listed.
export const AWS_DATA_SECURITY_MAX_BUCKETS: number = 1000;
const MAX_BUCKET_PAGES: number = 10;
// Pages of any other listing, and their size where the API takes one.
const MAX_PAGES: number = 20;
const PAGE_SIZE: number = 100;
// Tables, clusters, domains... of one kind read per Region.
export const AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION: number = 500;
// Manual snapshots per Region and kind whose shares are read, one call each.
export const AWS_DATA_SECURITY_MAX_SNAPSHOTS_PER_REGION: number = 200;
const MAX_KMS_PAGES: number = 10;
const OPENSEARCH_DESCRIBE_BATCH: number = 5;
// A read's bounds when the caller gives none.
const DEFAULT_MAX_REQUESTS: number = 5000;
const DEFAULT_MAX_DURATION_MS: number = 15 * 60 * 1000;
const MAX_WARNINGS: number = 50;
const MAX_STORE_WARNINGS: number = 20;
const MAX_MESSAGE_LENGTH: number = 300;

const RDS_VERSION: string = "2014-10-31";
const REDSHIFT_VERSION: string = "2012-12-01";
const ELASTICACHE_VERSION: string = "2015-02-02";

/*
 * S3's answers for a setting that is not set: a fact ("no policy", "no
 * public access block"), not an error.
 */
const S3_NOT_SET_CODES: Array<string> = [
  "NoSuchBucketPolicy",
  "NoSuchPublicAccessBlockConfiguration",
  "ServerSideEncryptionConfigurationNotFoundError",
  "NoSuchTagSet",
  "ReplicationConfigurationNotFoundError",
  "OwnershipControlsNotFoundError",
];

// S3's answers for a bucket asked at the wrong Region, which name the right one.
const S3_REDIRECT_CODES: Array<string> = [
  "PermanentRedirect",
  "TemporaryRedirect",
  "AuthorizationHeaderMalformed",
  "IllegalLocationConstraintException",
];

// Storage classes whose objects cannot be read without a restore first.
const UNREADABLE_STORAGE_CLASSES: Array<string> = ["GLACIER", "DEEP_ARCHIVE"];

const OBJECT_READ_MAX_BYTES: number = 16 * 1024 * 1024;
const MAX_LIST_KEYS: number = 1000;

// Each bucket setting read, by its subresource, and the action that reads it.
const BUCKET_PARTS: Array<[string, string]> = [
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

export interface AwsDataSecurityReadOptions {
  projectId: ObjectID;
  connectionId: ObjectID;
  /*
   * Every AWS account the project has connected: a principal of one of
   * them is not "external". The accounts this connection reads are added.
   */
  connectedAccountIds: Array<string>;
  /*
   * The Regions to read: the connection's own when absent, else every
   * Region every account has (AWS_DEFAULT_REGIONS). Naming them also limits
   * the buckets read to theirs.
   */
  regions?: Array<string> | undefined;
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  budget?: CloudReadBudget | undefined;
  // Test seam for waiting before a throttled call is asked again.
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  requestTimeoutInMs?: number | undefined;
}

/*
 * ---------------------------------------------------------------------
 * Three-valued facts: true and false are what AWS said, null that it
 * could not be read.
 * ---------------------------------------------------------------------
 */

type Fact = boolean | null;

// True when any is true; false when all are false; null otherwise.
function anyOf(...facts: Array<Fact>): Fact {
  if (facts.includes(true)) {
    return true;
  }

  return facts.includes(null) ? null : false;
}

// False when any is false; true when all are true; null otherwise.
function allOf(...facts: Array<Fact>): Fact {
  if (facts.includes(false)) {
    return false;
  }

  return facts.includes(null) ? null : true;
}

function notOf(fact: Fact): Fact {
  return fact === null ? null : !fact;
}

/*
 * ---------------------------------------------------------------------
 * What one account's read could not do, said once per API.
 * ---------------------------------------------------------------------
 */

interface Unread {
  ok: false;
  why: "refused" | "failed" | "budget";
  message: string;
}

type Answer<T> = { ok: true; value: T } | Unread;

function shorten(text: string): string {
  const flat: string = text.split("\n").join(" ").trim();

  return flat.length > MAX_MESSAGE_LENGTH
    ? `${flat.slice(0, MAX_MESSAGE_LENGTH - 3)}...`
    : flat;
}

function messageOf(error: unknown): string {
  return shorten(error instanceof Error ? error.message : String(error));
}

function isAuthentication(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Authentication
  );
}

function isRefusal(error: unknown): boolean {
  return (
    error instanceof LlmProviderError &&
    error.kind === CloudConnectionFailureKind.Permission
  );
}

class AccountNotes {
  public budgetSpent: boolean = false;
  // A listing that did not finish: what it did not list may still be there.
  public incomplete: boolean = false;
  private subject: string;
  private refused: Set<string> = new Set<string>();
  private failed: Map<string, { count: number; message: string }> = new Map();
  private lines: Array<string> = [];

  public constructor(subject: string) {
    this.subject = subject;
  }

  /*
   * What a call that threw means for the read. A credential AWS refuses
   * is the read's to decide (it throws on), unless the caller tolerates
   * it - a key's Region that is not enabled.
   */
  public unread(
    action: string,
    error: unknown,
    options: { tolerateAuthentication?: boolean | undefined } = {},
  ): Unread {
    if (error instanceof CloudReadBudgetSpent) {
      this.budgetSpent = true;
      return { ok: false, why: "budget", message: error.message };
    }

    if (isAuthentication(error) && !options.tolerateAuthentication) {
      throw error;
    }

    if (isRefusal(error)) {
      this.refused.add(action);
      return { ok: false, why: "refused", message: messageOf(error) };
    }

    const message: string = messageOf(error);
    const earlier: { count: number; message: string } | undefined =
      this.failed.get(action);

    this.failed.set(action, {
      count: (earlier?.count || 0) + 1,
      message: earlier?.message || message,
    });

    return { ok: false, why: "failed", message };
  }

  public note(line: string): void {
    if (!this.lines.includes(line)) {
      this.lines.push(line);
    }
  }

  // The line a store gets for what could not be read of it.
  public describe(unread: Unread, action: string): string {
    if (unread.why === "refused") {
      return `${this.subject} may not call ${action}.`;
    }

    if (unread.why === "budget") {
      return `The read reached its limit before ${action} was read.`;
    }

    return `Could not read ${action}: ${unread.message}`;
  }

  public warnings(): Array<string> {
    const warnings: Array<string> = [...this.lines];

    for (const action of Array.from(this.refused).sort()) {
      warnings.push(
        `${this.subject} may not call ${action}. Run the data security setup command again to allow it.`,
      );
    }

    for (const [action, entry] of Array.from(this.failed.entries())) {
      warnings.push(
        entry.count > 1
          ? `Could not read ${action} (${entry.count} times): ${entry.message}`
          : `Could not read ${action}: ${entry.message}`,
      );
    }

    if (this.budgetSpent) {
      warnings.push(
        "The read reached its limit for this run before every data store was read.",
      );
    }

    return warnings;
  }
}

/*
 * ---------------------------------------------------------------------
 * One account's read: its credential, its Regions, what it found.
 * ---------------------------------------------------------------------
 */

interface AccountContext {
  accountId: string;
  partition: AwsPartition;
  // The partition's home Region: S3's listing, S3 Control, STS.
  homeRegion: string;
  readAt: string;
  credentials: AwsCredentials;
  transport: CloudConnectorTransport;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  timeoutInMs?: number | undefined;
  budget: CloudReadBudget;
  // The connected accounts: a principal of one is not external.
  internal: Set<string>;
  regions: Array<string>;
  // Whether the Regions were named (by the caller or the connection).
  regionsNamed: boolean;
  notes: AccountNotes;
  // Per Region, the ids of AWS's own keys (alias/aws/...), or null when unknown.
  managedKeys: Map<string, Promise<Set<string> | null>>;
  // Regions that answered at least once: a refused credential there is not a Region left off.
  reached: Set<string>;
}

async function attempt<T>(
  ctx: AccountContext,
  action: string,
  call: () => Promise<T>,
): Promise<Answer<T>> {
  try {
    return { ok: true, value: await call() };
  } catch (error) {
    return ctx.notes.unread(action, error);
  }
}

// One Query-protocol call (RDS, Redshift, ElastiCache): its XML.
async function queryCall(
  ctx: AccountContext,
  region: string,
  data: { service: string; body: Dictionary<string>; step: string },
): Promise<string> {
  const answer: { text: string } = await sendAwsRequest({
    transport: ctx.transport,
    credentials: ctx.credentials,
    service: data.service,
    region,
    body: data.body,
    step: data.step,
    providerTitle: PROVIDER_TITLE,
    now: ctx.now,
    timeoutInMs: ctx.timeoutInMs,
    sleep: ctx.sleep,
    budget: ctx.budget,
  });

  ctx.reached.add(region);
  return answer.text;
}

// One JSON-protocol call (DynamoDB, KMS): its answer.
async function jsonCall(
  ctx: AccountContext,
  region: string,
  data: {
    service: string;
    target: string;
    jsonVersion: "1.0" | "1.1";
    body: JSONObject;
    step: string;
  },
): Promise<JSONObject> {
  const answer: { json: JSONObject } = await sendAwsRequest({
    transport: ctx.transport,
    credentials: ctx.credentials,
    service: data.service,
    region,
    target: data.target,
    jsonVersion: data.jsonVersion,
    body: data.body,
    step: data.step,
    providerTitle: PROVIDER_TITLE,
    now: ctx.now,
    timeoutInMs: ctx.timeoutInMs,
    sleep: ctx.sleep,
    budget: ctx.budget,
  });

  ctx.reached.add(region);
  return answer.json;
}

// One REST call (S3, S3 Control, OpenSearch, EFS).
async function restCall(
  ctx: AccountContext,
  region: string,
  data: {
    service: string;
    path: string;
    step: string;
    host?: string | undefined;
    method?: "GET" | "POST" | undefined;
    query?: Dictionary<string> | undefined;
    headers?: Dictionary<string> | undefined;
    body?: string | undefined;
    providerTitle?: string | undefined;
  },
): Promise<AwsRestResponse> {
  const answer: AwsRestResponse = await sendAwsRestRequest({
    transport: ctx.transport,
    credentials: ctx.credentials,
    service: data.service,
    region,
    host: data.host,
    method: data.method,
    path: data.path,
    query: data.query,
    headers: data.headers,
    body: data.body,
    step: data.step,
    providerTitle: data.providerTitle || PROVIDER_TITLE,
    now: ctx.now,
    timeoutInMs: ctx.timeoutInMs,
    sleep: ctx.sleep,
    budget: ctx.budget,
  });

  ctx.reached.add(region);
  return answer;
}

/*
 * A Query listing, page after page (MaxRecords and Marker), up to the
 * caps: its items' XML, and whether it was listed to its end.
 */
async function describePages(
  ctx: AccountContext,
  region: string,
  data: {
    service: string;
    version: string;
    action: string;
    iamAction: string;
    itemTag: string;
    step: string;
    params?: Dictionary<string> | undefined;
    maxItems: number;
  },
): Promise<Answer<{ items: Array<string>; complete: boolean }>> {
  return await attempt(
    ctx,
    data.iamAction,
    async (): Promise<{ items: Array<string>; complete: boolean }> => {
      const items: Array<string> = [];
      let marker: string = "";

      for (let page: number = 0; page < MAX_PAGES; page++) {
        const text: string = await queryCall(ctx, region, {
          service: data.service,
          body: {
            Action: data.action,
            Version: data.version,
            MaxRecords: String(PAGE_SIZE),
            ...(data.params || {}),
            ...(marker ? { Marker: marker } : {}),
          },
          step: data.step,
        });

        items.push(...readXmlTags(text, data.itemTag));

        const next: string = readXmlTag(text, "Marker");

        if (!next || next === marker) {
          return {
            items: items.slice(0, data.maxItems),
            complete: items.length <= data.maxItems,
          };
        }

        if (items.length >= data.maxItems) {
          return { items: items.slice(0, data.maxItems), complete: false };
        }

        marker = next;
      }

      return { items: items.slice(0, data.maxItems), complete: false };
    },
  );
}

/*
 * ---------------------------------------------------------------------
 * Stores, fields and ARNs.
 * ---------------------------------------------------------------------
 */

function newStore(
  ctx: AccountContext,
  identity: {
    kind: DataStoreKind;
    name: string;
    providerResourceId: string;
    region?: string | undefined;
  },
): CloudDataStoreRead {
  return {
    identity: {
      kind: identity.kind,
      name: identity.name,
      providerResourceId: identity.providerResourceId,
      accountNumber: ctx.accountId,
      region: identity.region,
    },
    posture: { readAt: ctx.readAt },
    access: [],
  };
}

function addStoreWarning(store: CloudDataStoreRead, line: string): void {
  const lines: Array<string> = store.posture.readWarnings || [];

  if (!lines.includes(line) && lines.length < MAX_STORE_WARNINGS) {
    lines.push(line);
  }

  store.posture.readWarnings = lines;
}

function addAccess(
  store: CloudDataStoreRead,
  entry: DataStoreAccessEntry,
): void {
  const key: string = getDataStoreAccessKey(entry);

  if (
    !store.access.some((existing: DataStoreAccessEntry): boolean => {
      return getDataStoreAccessKey(existing) === key;
    })
  ) {
    store.access.push(entry);
  }
}

function publicEntry(
  grantedVia: string,
  accessLevel: DataStoreAccessLevel,
  principal: string = "*",
): DataStoreAccessEntry {
  return {
    principal,
    principalName: "Everyone",
    principalType: DataStorePrincipalType.Public,
    accessLevel,
    grantedVia,
    isExternal: true,
    isPublic: true,
  };
}

// A direct child's text: an item's own field, never one inside another.
function xmlField(block: string, tag: string): string {
  return readXmlChildren(block, tag)[0] || "";
}

// The first element of the name anywhere in the text.
function xmlFirst(xml: string, tag: string): string {
  return readXmlTags(xml, tag)[0] || "";
}

function readFlag(text: string): Fact {
  const value: string = (text || "").trim().toLowerCase();

  if (value === "true") {
    return true;
  }

  return value === "false" ? false : null;
}

function readNumber(text: string): number | null {
  if (!(text || "").trim()) {
    return null;
  }

  const value: number = Number(text);
  return Number.isFinite(value) ? value : null;
}

function jsonFlag(value: unknown): Fact {
  return typeof value === "boolean" ? value : null;
}

function jsonNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// <Tag><Key>..</Key><Value>..</Value></Tag>, wherever they are listed.
function readXmlTagSet(xml: string): Record<string, string> {
  const tags: Record<string, string> = {};

  for (const tag of readXmlTags(xml, "Tag")) {
    const key: string = xmlField(tag, "Key");

    if (key) {
      tags[key] = xmlField(tag, "Value");
    }
  }

  return tags;
}

function readJsonTagSet(value: unknown): Record<string, string> {
  const tags: Record<string, string> = {};

  for (const raw of readArray(value)) {
    const tag: JSONObject = readObject(raw);
    const key: string = readText(tag["Key"]);

    if (key) {
      tags[key] = readText(tag["Value"]);
    }
  }

  return tags;
}

function arnOf(
  ctx: AccountContext,
  service: string,
  region: string,
  resource: string,
): string {
  return `arn:${ctx.partition}:${service}:${region}:${ctx.accountId}:${resource}`;
}

function arnRegion(arn: string): string {
  const parts: Array<string> = arn.split(":");
  return parts[0] === "arn" && parts.length > 4 ? parts[3] || "" : "";
}

// Twelve digits: an AWS account id.
export function isAccountId(text: string): boolean {
  if (text.length !== 12) {
    return false;
  }

  for (const character of text) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  return true;
}

// The Regions of these ARNs that are not the store's own, sorted.
function otherRegions(region: string, arns: Array<string>): Array<string> {
  const regions: Set<string> = new Set<string>();

  for (const arn of arns) {
    const other: string = arnRegion(arn);

    if (other && other !== region && isAwsRegion(other)) {
      regions.add(other);
    }
  }

  return Array.from(regions).sort();
}

function uniqueSorted(values: Array<string>): Array<string> {
  return Array.from(new Set(values)).sort();
}

/*
 * ---------------------------------------------------------------------
 * KMS: AWS's own keys of a Region, to tell a customer managed key.
 * ---------------------------------------------------------------------
 */

async function readAwsManagedKeyIds(
  ctx: AccountContext,
  region: string,
): Promise<Set<string> | null> {
  const ids: Set<string> = new Set<string>();
  let marker: string = "";

  try {
    for (let page: number = 0; page < MAX_KMS_PAGES; page++) {
      const answer: JSONObject = await jsonCall(ctx, region, {
        service: "kms",
        target: "TrentService.ListAliases",
        jsonVersion: "1.1",
        body: { Limit: 100, ...(marker ? { Marker: marker } : {}) },
        step: "key alias list request",
      });

      for (const raw of readArray(answer["Aliases"])) {
        const alias: JSONObject = readObject(raw);
        const target: string = readText(alias["TargetKeyId"]);

        if (readText(alias["AliasName"]).startsWith("alias/aws/") && target) {
          ids.add(target);
        }
      }

      const next: string = readText(answer["NextMarker"]);

      if (answer["Truncated"] !== true || !next || next === marker) {
        return ids;
      }

      marker = next;
    }

    // More aliases than a read takes: one not seen could be AWS's own.
    return null;
  } catch (error) {
    ctx.notes.unread("kms:ListAliases", error, {
      tolerateAuthentication: true,
    });
    return null;
  }
}

function getAwsManagedKeyIds(
  ctx: AccountContext,
  region: string,
): Promise<Set<string> | null> {
  let pending: Promise<Set<string> | null> | undefined =
    ctx.managedKeys.get(region);

  if (!pending) {
    pending = readAwsManagedKeyIds(ctx, region);
    ctx.managedKeys.set(region, pending);
  }

  return pending;
}

// A key reference's key id: arn:...:key/<id>, or the reference itself.
function keyIdOf(reference: string): string {
  const marker: string = ":key/";
  const index: number = reference.indexOf(marker);

  if (index >= 0) {
    return reference.slice(index + marker.length);
  }

  return reference.startsWith("key/") ? reference.slice(4) : reference;
}

/*
 * Whether a store's key is one the customer manages: false for none or for
 * one of AWS's own (alias/aws/...), true for any other - a key of another
 * account is never AWS's own key of this one - and null when the account's
 * aliases could not be read.
 */
async function isCustomerManagedKey(
  ctx: AccountContext,
  region: string,
  reference: string,
): Promise<Fact> {
  const key: string = reference.trim();

  if (!key) {
    return false;
  }

  if (key.includes("alias/aws/")) {
    return false;
  }

  let keyRegion: string = region;

  if (key.startsWith("arn:")) {
    const parts: Array<string> = key.split(":");
    const account: string = parts[4] || "";

    if (account && account !== ctx.accountId) {
      return true;
    }

    if (isAwsRegion(parts[3] || "")) {
      keyRegion = parts[3]!;
    }
  }

  const managed: Set<string> | null = await getAwsManagedKeyIds(ctx, keyRegion);

  if (!managed) {
    return null;
  }

  return !managed.has(keyIdOf(key));
}

// customerManagedKey for a store: none when it is not encrypted.
async function customerKeyFact(
  ctx: AccountContext,
  region: string,
  encrypted: Fact,
  reference: string,
): Promise<Fact> {
  if (encrypted === false) {
    return false;
  }

  if (!reference.trim()) {
    return encrypted === true ? false : null;
  }

  return await isCustomerManagedKey(ctx, region, reference);
}

/*
 * ---------------------------------------------------------------------
 * IAM policies (a bucket's, an OpenSearch domain's): who they let in, to
 * do what, and whether they make the store public.
 * ---------------------------------------------------------------------
 */

// Actions whose grant means reading, writing, or controlling the store.
interface PolicyActions {
  read: Array<string>;
  write: Array<string>;
  admin: Array<string>;
}

const S3_POLICY_ACTIONS: PolicyActions = {
  read: ["s3:GetObject", "s3:ListBucket"],
  write: ["s3:PutObject", "s3:DeleteObject"],
  admin: ["s3:PutBucketPolicy", "s3:PutBucketAcl", "s3:DeleteBucket"],
};

const OPENSEARCH_POLICY_ACTIONS: PolicyActions = {
  read: ["es:ESHttpGet", "es:ESHttpHead", "es:ESHttpPost"],
  write: ["es:ESHttpPut", "es:ESHttpPost", "es:ESHttpDelete", "es:ESHttpPatch"],
  admin: ["es:UpdateDomainConfig", "es:DeleteDomain"],
};

/*
 * Condition keys that hold a grant to "*" to known callers - an
 * organization, an account, a network, an endpoint - so AWS does not count
 * it public (the rules of S3's own public policy check).
 */
const RESTRICTING_CONDITION_KEYS: Array<string> = [
  "aws:sourceip",
  "aws:sourcevpc",
  "aws:sourcevpce",
  "aws:sourcevpcarn",
  "aws:sourcearn",
  "aws:sourceaccount",
  "aws:sourceowner",
  "aws:sourceorgid",
  "aws:sourceorgpaths",
  "aws:principalarn",
  "aws:principalaccount",
  "aws:principalorgid",
  "aws:principalorgpaths",
  "aws:principalservicename",
  "aws:userid",
  "aws:username",
  "aws:vpceaccount",
  "aws:vpceorgid",
  "aws:vpceorgpaths",
  "s3:dataaccesspointarn",
  "s3:dataaccesspointaccount",
];

interface PolicyGrant {
  principal: string;
  principalName?: string | undefined;
  principalType: DataStorePrincipalType;
  // The 12-digit account, "" when the principal names none.
  accountId: string;
  isPublic: boolean;
  isExternal: boolean;
  accessLevel: DataStoreAccessLevel;
}

interface PolicyAnalysis {
  grants: Array<PolicyGrant>;
  publicRead: boolean;
  publicWrite: boolean;
  // The first public grant, in the policy's words.
  publicReason: string;
  // A Deny of every request without TLS (aws:SecureTransport false).
  secureTransportDenied: boolean;
  // A Deny of TLS older than this (s3:TlsVersion), "" when none.
  minimumTlsVersion: string;
}

const NO_POLICY: PolicyAnalysis = {
  grants: [],
  publicRead: false,
  publicWrite: false,
  publicReason: "",
  secureTransportDenied: false,
  minimumTlsVersion: "",
};

// A policy value as strings: "x", ["x", "y"], numbers and booleans written out.
function policyValues(value: unknown): Array<string> {
  const values: Array<unknown> = Array.isArray(value) ? value : [value];

  return values
    .map((item: unknown): string => {
      if (typeof item === "string") {
        return item.trim();
      }

      if (typeof item === "number" || typeof item === "boolean") {
        return String(item);
      }

      return "";
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

/*
 * IAM's wildcards: "*" any run of characters, "?" one, case ignored. A
 * scan with backtracking to the last "*", no regular expression: patterns
 * come from the customer's policy.
 */
function wildcardMatches(pattern: string, value: string): boolean {
  const p: string = pattern.toLowerCase();
  const v: string = value.toLowerCase();
  let pi: number = 0;
  let vi: number = 0;
  let star: number = -1;
  let mark: number = 0;

  while (vi < v.length) {
    if (
      pi < p.length &&
      (p.charAt(pi) === "?" || p.charAt(pi) === v.charAt(vi))
    ) {
      pi++;
      vi++;
    } else if (pi < p.length && p.charAt(pi) === "*") {
      star = pi;
      mark = vi;
      pi++;
    } else if (star >= 0) {
      pi = star + 1;
      mark++;
      vi = mark;
    } else {
      return false;
    }
  }

  while (pi < p.length && p.charAt(pi) === "*") {
    pi++;
  }

  return pi === p.length;
}

// Whether a statement's Action (or NotAction) covers any of the samples.
function coversAny(
  actions: Array<string>,
  notActions: Array<string>,
  samples: Array<string>,
): boolean {
  if (actions.length > 0) {
    return samples.some((sample: string): boolean => {
      return actions.some((action: string): boolean => {
        return wildcardMatches(action, sample);
      });
    });
  }

  if (notActions.length > 0) {
    return samples.some((sample: string): boolean => {
      return !notActions.some((action: string): boolean => {
        return wildcardMatches(action, sample);
      });
    });
  }

  return false;
}

// A value with a wildcard or a policy variable is not a fixed restriction.
function isFixedValue(value: string): boolean {
  return !value.includes("*") && !value.includes("?") && !value.includes("${");
}

// A CIDR wider than /8 (IPv4) or /32 (IPv6) lets most of the internet in.
function isBroadCidr(value: string): boolean {
  const slash: number = value.indexOf("/");

  if (slash < 0) {
    return false;
  }

  const prefix: number = Number(value.slice(slash + 1));

  if (!Number.isFinite(prefix)) {
    return true;
  }

  return value.includes(":") ? prefix < 32 : prefix < 8;
}

/*
 * Whether a statement's conditions hold it to known callers. A negated
 * test, a Null test, an ...IfExists test (which a request without the key
 * passes) and a ForAllValues test (which an empty set passes) restrict
 * nothing.
 */
function hasRestrictingCondition(conditions: JSONObject): boolean {
  for (const operator of Object.keys(conditions)) {
    const op: string = operator.toLowerCase();

    if (
      op.includes("not") ||
      op === "null" ||
      op.endsWith("ifexists") ||
      op.startsWith("forallvalues:")
    ) {
      continue;
    }

    const block: JSONObject = readObject(conditions[operator]);

    for (const key of Object.keys(block)) {
      const name: string = key.toLowerCase();

      if (!RESTRICTING_CONDITION_KEYS.includes(name)) {
        continue;
      }

      const values: Array<string> = policyValues(block[key]);

      if (values.length === 0 || !values.every(isFixedValue)) {
        continue;
      }

      if (name === "aws:sourceip" && values.some(isBroadCidr)) {
        continue;
      }

      return true;
    }
  }

  return false;
}

interface PolicyPrincipal {
  kind: "public" | "AWS" | "Service" | "CanonicalUser" | "Federated";
  value: string;
}

function readPrincipals(statement: JSONObject): Array<PolicyPrincipal> {
  // Allowed to everyone but the principals named.
  if (statement["NotPrincipal"] !== undefined) {
    return [{ kind: "public", value: "*" }];
  }

  const principal: unknown = statement["Principal"];

  if (principal === "*") {
    return [{ kind: "public", value: "*" }];
  }

  const named: JSONObject = readObject(principal);
  const principals: Array<PolicyPrincipal> = [];

  for (const kind of ["AWS", "Service", "CanonicalUser", "Federated"] as Array<
    PolicyPrincipal["kind"]
  >) {
    for (const value of policyValues(named[kind])) {
      principals.push(
        value === "*" ? { kind: "public", value } : { kind, value },
      );
    }
  }

  return principals;
}

/*
 * A named principal as an access entry's principal: an account id or its
 * root, a role (or a session of one), a user, a service, a canonical user.
 */
function describePrincipal(principal: PolicyPrincipal): {
  principal: string;
  principalName?: string | undefined;
  principalType: DataStorePrincipalType;
  accountId: string;
} {
  const value: string = principal.value;

  if (principal.kind === "Service") {
    return {
      principal: value,
      principalType: DataStorePrincipalType.Service,
      accountId: "",
    };
  }

  if (principal.kind === "CanonicalUser") {
    return {
      principal: value,
      principalType: DataStorePrincipalType.Account,
      accountId: "",
    };
  }

  if (isAccountId(value)) {
    return {
      principal: value,
      principalType: DataStorePrincipalType.Account,
      accountId: value,
    };
  }

  if (!value.startsWith("arn:")) {
    // A role or user since deleted, which IAM shows by its unique id.
    return {
      principal: value,
      principalType: value.startsWith("AIDA")
        ? DataStorePrincipalType.User
        : DataStorePrincipalType.Role,
      accountId: "",
    };
  }

  const parts: Array<string> = value.split(":");
  const account: string = parts[4] || "";
  const resource: string = parts.slice(5).join(":");
  const lastName: string = resource.split("/").pop() || resource;

  // An AWS-owned principal (arn:aws:iam::cloudfront:user/...): a service.
  if (!isAccountId(account)) {
    return {
      principal: value,
      principalName: lastName,
      principalType: DataStorePrincipalType.Service,
      accountId: "",
    };
  }

  if (resource.startsWith("role/")) {
    return {
      principal: value,
      principalName: lastName,
      principalType: DataStorePrincipalType.Role,
      accountId: account,
    };
  }

  if (resource.startsWith("assumed-role/")) {
    return {
      principal: value,
      principalName: resource.split("/")[1] || lastName,
      principalType: DataStorePrincipalType.Role,
      accountId: account,
    };
  }

  if (resource.startsWith("user/") || resource.startsWith("federated-user/")) {
    return {
      principal: value,
      principalName: lastName,
      principalType: DataStorePrincipalType.User,
      accountId: account,
    };
  }

  return {
    principal: value,
    principalName: account,
    principalType: DataStorePrincipalType.Account,
    accountId: account,
  };
}

/*
 * A policy's grants and what it enforces. Null when it is not a policy at
 * all (not JSON). Only Allow statements grant; a Deny is read for the TLS
 * it requires. A grant to "*" held by a restricting condition is neither
 * public nor anyone's in particular, and is left out.
 */
function analyzePolicy(
  text: string,
  data: {
    actions: PolicyActions;
    // "The bucket policy", "The access policy": how the reason names it.
    what: string;
    isExternalAccount: (accountId: string) => boolean;
    // The store owner's S3 canonical user id, when known: its grants are its own.
    ownerCanonicalId?: string | undefined;
  },
): PolicyAnalysis | null {
  let document: unknown;

  try {
    document = JSON.parse(text);
  } catch {
    return null;
  }

  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return null;
  }

  const rawStatements: unknown = (document as JSONObject)["Statement"];
  const statements: Array<JSONObject> = (
    Array.isArray(rawStatements) ? rawStatements : [rawStatements]
  )
    .map((raw: unknown): JSONObject => {
      return readObject(raw);
    })
    .filter((statement: JSONObject): boolean => {
      return Object.keys(statement).length > 0;
    });
  const analysis: PolicyAnalysis = {
    ...NO_POLICY,
    grants: [],
  };
  const tlsVersions: Array<string> = [];

  for (const statement of statements) {
    const effect: string = readText(statement["Effect"]).toLowerCase();
    const conditions: JSONObject = readObject(statement["Condition"]);

    if (effect === "deny") {
      for (const operator of Object.keys(conditions)) {
        const op: string = operator.toLowerCase();
        const block: JSONObject = readObject(conditions[operator]);

        for (const key of Object.keys(block)) {
          const name: string = key.toLowerCase();
          const values: Array<string> = policyValues(block[key]);

          if (
            (op === "bool" || op === "boolifexists") &&
            name === "aws:securetransport" &&
            values.some((value: string): boolean => {
              return value.toLowerCase() === "false";
            })
          ) {
            analysis.secureTransportDenied = true;
          }

          if (
            (op === "numericlessthan" || op === "numericlessthanifexists") &&
            name === "s3:tlsversion"
          ) {
            tlsVersions.push(...values);
          }
        }
      }

      continue;
    }

    if (effect !== "allow") {
      continue;
    }

    const actions: Array<string> = policyValues(statement["Action"]);
    const notActions: Array<string> = policyValues(statement["NotAction"]);
    const reads: boolean = coversAny(actions, notActions, data.actions.read);
    const writes: boolean = coversAny(actions, notActions, data.actions.write);
    const controls: boolean = coversAny(
      actions,
      notActions,
      data.actions.admin,
    );

    if (!reads && !writes && !controls) {
      continue;
    }

    const accessLevel: DataStoreAccessLevel = controls
      ? DataStoreAccessLevel.Admin
      : writes
        ? DataStoreAccessLevel.Write
        : DataStoreAccessLevel.Read;
    const restricted: boolean = hasRestrictingCondition(conditions);

    for (const principal of readPrincipals(statement)) {
      if (principal.kind === "public") {
        if (restricted) {
          continue;
        }

        if (reads) {
          analysis.publicRead = true;
        }

        if (writes || controls) {
          analysis.publicWrite = true;
        }

        if (!analysis.publicReason) {
          const named: string =
            actions.length > 0
              ? actions.slice(0, 3).join(", ")
              : `every action but ${notActions.slice(0, 3).join(", ")}`;

          analysis.publicReason = `${data.what} lets everyone (Principal "*") call ${named}`;
        }

        analysis.grants.push({
          principal: "*",
          principalName: "Everyone",
          principalType: DataStorePrincipalType.Public,
          accountId: "",
          isPublic: true,
          isExternal: true,
          accessLevel,
        });
        continue;
      }

      const described: ReturnType<typeof describePrincipal> =
        describePrincipal(principal);
      const isExternal: boolean = described.accountId
        ? data.isExternalAccount(described.accountId)
        : principal.kind === "CanonicalUser"
          ? principal.value !== (data.ownerCanonicalId || "")
          : false;

      analysis.grants.push({
        ...described,
        isPublic: false,
        isExternal,
        accessLevel,
      });
    }
  }

  if (tlsVersions.length > 0) {
    analysis.minimumTlsVersion = tlsVersions.reduce(
      (highest: string, version: string): string => {
        return tlsVersionNumber(version) > tlsVersionNumber(highest)
          ? version
          : highest;
      },
    );
  }

  return analysis;
}

// The accounts outside the connected ones that a policy's grants name.
function externalPrincipals(grants: Array<PolicyGrant>): Array<string> {
  return grants
    .filter((grant: PolicyGrant): boolean => {
      return !grant.isPublic && grant.isExternal;
    })
    .map((grant: PolicyGrant): string => {
      return grant.accountId || grant.principal;
    });
}

function grantEntry(
  grant: PolicyGrant,
  grantedVia: string,
): DataStoreAccessEntry {
  return {
    principal: grant.principal,
    principalName: grant.principalName,
    principalType: grant.principalType,
    accessLevel: grant.accessLevel,
    grantedVia,
    isExternal: grant.isExternal,
    isPublic: grant.isPublic,
  };
}

/*
 * ---------------------------------------------------------------------
 * S3
 * ---------------------------------------------------------------------
 */

interface BucketTarget {
  name: string;
  // The bucket's own Region: learned from a redirect when it was wrong.
  region: string;
}

// One bucket setting: as set, not set (a fact), or not read.
type BucketPart =
  | { state: "set"; text: string }
  | { state: "unset" }
  | { state: "unknown"; unread: Unread };

interface PublicAccessBlock {
  blockPublicAcls: Fact;
  ignorePublicAcls: Fact;
  blockPublicPolicy: Fact;
  restrictPublicBuckets: Fact;
}

const UNKNOWN_BLOCK: PublicAccessBlock = {
  blockPublicAcls: null,
  ignorePublicAcls: null,
  blockPublicPolicy: null,
  restrictPublicBuckets: null,
};

const NO_BLOCK: PublicAccessBlock = {
  blockPublicAcls: false,
  ignorePublicAcls: false,
  blockPublicPolicy: false,
  restrictPublicBuckets: false,
};

function readPublicAccessBlock(xml: string): PublicAccessBlock {
  const setting: (tag: string) => boolean = (tag: string): boolean => {
    return readFlag(xmlFirst(xml, tag)) === true;
  };

  return {
    blockPublicAcls: setting("BlockPublicAcls"),
    ignorePublicAcls: setting("IgnorePublicAcls"),
    blockPublicPolicy: setting("BlockPublicPolicy"),
    restrictPublicBuckets: setting("RestrictPublicBuckets"),
  };
}

function isFullyBlocked(block: PublicAccessBlock): Fact {
  return allOf(
    block.blockPublicAcls,
    block.ignorePublicAcls,
    block.blockPublicPolicy,
    block.restrictPublicBuckets,
  );
}

/*
 * The Region an S3 error says the bucket is in: its <Region>, or the host
 * of its <Endpoint> (bucket.s3.eu-west-1.amazonaws.com,
 * s3-eu-west-1.amazonaws.com; s3.amazonaws.com is us-east-1). "" when it
 * names none.
 */
function regionOfRedirect(error: unknown): string {
  if (!(error instanceof LlmProviderError)) {
    return "";
  }

  const body: string = error.responseBody || "";

  if (!S3_REDIRECT_CODES.includes(awsErrorCodeOf(body))) {
    return "";
  }

  const named: string = xmlFirst(body, "Region").toLowerCase();

  if (isAwsRegion(named)) {
    return named;
  }

  const labels: Array<string> = xmlFirst(body, "Endpoint")
    .toLowerCase()
    .split(".");

  for (let index: number = 0; index < labels.length; index++) {
    const label: string = labels[index]!;

    if (label === "s3") {
      const next: string = labels[index + 1] || "";

      if (isAwsRegion(next)) {
        return next;
      }

      if (next === "amazonaws") {
        return "us-east-1";
      }
    }

    if (label.startsWith("s3-") && isAwsRegion(label.slice(3))) {
      return label.slice(3);
    }
  }

  return "";
}

// One setting of a bucket, read at the bucket's Region.
async function readBucketPart(
  ctx: AccountContext,
  bucket: BucketTarget,
  subresource: string,
  action: string,
): Promise<BucketPart> {
  for (let redirects: number = 0; ; redirects++) {
    try {
      const answer: AwsRestResponse = await restCall(ctx, bucket.region, {
        service: "s3",
        path: `/${bucket.name}`,
        query: { [subresource]: "" },
        step: `bucket ${subresource} request`,
        providerTitle: S3_TITLE,
      });

      return { state: "set", text: answer.text };
    } catch (error) {
      const code: string =
        error instanceof LlmProviderError
          ? awsErrorCodeOf(error.responseBody || "")
          : "";

      if (S3_NOT_SET_CODES.includes(code)) {
        return { state: "unset" };
      }

      const moved: string = redirects === 0 ? regionOfRedirect(error) : "";

      if (moved && moved !== bucket.region) {
        bucket.region = moved;
        continue;
      }

      /*
       * The listing was read with this credential at the home Region: a
       * refusal at the bucket's Region is that Region's, not the key's.
       */
      return {
        state: "unknown",
        unread: ctx.notes.unread(action, error, {
          tolerateAuthentication: bucket.region !== ctx.homeRegion,
        }),
      };
    }
  }
}

// Every bucket of the account, with the Region ListBuckets gives it ("" when it gives none).
async function listBuckets(
  ctx: AccountContext,
): Promise<Answer<{ buckets: Array<BucketTarget>; complete: boolean }>> {
  return await attempt(
    ctx,
    "s3:ListAllMyBuckets",
    async (): Promise<{ buckets: Array<BucketTarget>; complete: boolean }> => {
      const buckets: Array<BucketTarget> = [];
      let token: string = "";

      for (let page: number = 0; page < MAX_BUCKET_PAGES; page++) {
        /*
         * Any parameter makes ListBuckets name each bucket's Region
         * (BucketRegion): max-buckets is always sent.
         */
        const answer: AwsRestResponse = await restCall(ctx, ctx.homeRegion, {
          service: "s3",
          path: "/",
          query: {
            "max-buckets": "1000",
            ...(token ? { "continuation-token": token } : {}),
          },
          step: "bucket list request",
          providerTitle: S3_TITLE,
        });

        for (const item of readXmlTags(answer.text, "Bucket")) {
          const name: string = xmlField(item, "Name");
          const region: string = xmlField(item, "BucketRegion").toLowerCase();

          if (name) {
            buckets.push({ name, region: isAwsRegion(region) ? region : "" });
          }
        }

        const next: string = xmlFirst(answer.text, "ContinuationToken");

        if (!next || next === token) {
          return { buckets, complete: true };
        }

        token = next;
      }

      return { buckets, complete: false };
    },
  );
}

/*
 * A bucket's Region when ListBuckets did not give it: GetBucketLocation
 * ("" is us-east-1, "EU" is eu-west-1), or the home Region - a redirect
 * then names the right one.
 */
async function locateBucket(
  ctx: AccountContext,
  name: string,
): Promise<string> {
  const part: BucketPart = await readBucketPart(
    ctx,
    { name, region: ctx.homeRegion },
    "location",
    "s3:GetBucketLocation",
  );

  if (part.state !== "set") {
    return ctx.homeRegion;
  }

  const constraint: string = xmlFirst(part.text, "LocationConstraint");

  if (!constraint) {
    return "us-east-1";
  }

  if (constraint === "EU") {
    return "eu-west-1";
  }

  return isAwsRegion(constraint.toLowerCase())
    ? constraint.toLowerCase()
    : ctx.homeRegion;
}

// The account's own public access block (S3 Control), which holds for every bucket.
async function readAccountPublicAccessBlock(
  ctx: AccountContext,
): Promise<PublicAccessBlock> {
  if (!isAccountId(ctx.accountId)) {
    return UNKNOWN_BLOCK;
  }

  try {
    const answer: AwsRestResponse = await restCall(ctx, ctx.homeRegion, {
      service: "s3",
      host: `${ctx.accountId}.${getAwsHost("s3-control", ctx.homeRegion)}`,
      path: "/v20180820/configuration/publicAccessBlock",
      headers: { "x-amz-account-id": ctx.accountId },
      step: "account public access block request",
      providerTitle: S3_TITLE,
    });

    return readPublicAccessBlock(answer.text);
  } catch (error) {
    if (
      error instanceof LlmProviderError &&
      awsErrorCodeOf(error.responseBody || "") ===
        "NoSuchPublicAccessBlockConfiguration"
    ) {
      return NO_BLOCK;
    }

    ctx.notes.unread("s3:GetAccountPublicAccessBlock", error);
    return UNKNOWN_BLOCK;
  }
}

interface AclAnalysis {
  ownerId: string;
  publicRead: boolean;
  publicWrite: boolean;
  publicReason: string;
  entries: Array<DataStoreAccessEntry>;
  // Canonical users other than the owner: other accounts, which ones unknown.
  external: Array<string>;
}

const ALL_USERS_SUFFIX: string = "/global/AllUsers";
const AUTHENTICATED_USERS_SUFFIX: string = "/global/AuthenticatedUsers";
const LOG_DELIVERY_SUFFIX: string = "/s3/LogDelivery";

/*
 * A bucket ACL's grants. AllUsers is everyone; AuthenticatedUsers is any
 * AWS account at all, as public. A grant to another canonical user is
 * another account's - which one, an ACL does not say.
 */
function analyzeAcl(xml: string): AclAnalysis {
  const ownerId: string = xmlFirst(xmlFirst(xml, "Owner"), "ID");
  const analysis: AclAnalysis = {
    ownerId,
    publicRead: false,
    publicWrite: false,
    publicReason: "",
    entries: [],
    external: [],
  };

  for (const grant of readXmlTags(xml, "Grant")) {
    const grantee: string = xmlFirst(grant, "Grantee");
    const permission: string = xmlFirst(grant, "Permission").toUpperCase();
    const uri: string = xmlFirst(grantee, "URI");
    const reads: boolean =
      permission === "READ" || permission === "FULL_CONTROL";
    const writes: boolean =
      permission === "WRITE" ||
      permission === "WRITE_ACP" ||
      permission === "FULL_CONTROL";
    const accessLevel: DataStoreAccessLevel =
      permission === "FULL_CONTROL" || permission === "WRITE_ACP"
        ? DataStoreAccessLevel.Admin
        : permission === "WRITE"
          ? DataStoreAccessLevel.Write
          : DataStoreAccessLevel.Read;

    if (
      uri.endsWith(ALL_USERS_SUFFIX) ||
      uri.endsWith(AUTHENTICATED_USERS_SUFFIX)
    ) {
      if (!reads && !writes) {
        continue;
      }

      const everyone: boolean = uri.endsWith(ALL_USERS_SUFFIX);

      if (reads) {
        analysis.publicRead = true;
      }

      if (writes) {
        analysis.publicWrite = true;
      }

      if (!analysis.publicReason) {
        analysis.publicReason = `The ACL grants ${permission} to ${
          everyone
            ? "everyone (AllUsers)"
            : "any AWS account (AuthenticatedUsers)"
        }`;
      }

      analysis.entries.push(
        publicEntry(
          "ACL",
          accessLevel,
          everyone ? "AllUsers" : "AuthenticatedUsers",
        ),
      );
      continue;
    }

    if (uri.endsWith(LOG_DELIVERY_SUFFIX)) {
      analysis.entries.push({
        principal: "LogDelivery",
        principalName: "S3 log delivery",
        principalType: DataStorePrincipalType.Service,
        accessLevel,
        grantedVia: "ACL",
        isExternal: false,
        isPublic: false,
      });
      continue;
    }

    const canonical: string =
      xmlFirst(grantee, "ID") || xmlFirst(grantee, "EmailAddress");

    if (!canonical || canonical === ownerId) {
      continue;
    }

    analysis.external.push(canonical);
    analysis.entries.push({
      principal: canonical,
      principalName: xmlFirst(grantee, "DisplayName") || undefined,
      principalType: DataStorePrincipalType.Account,
      accessLevel,
      grantedVia: "ACL",
      isExternal: true,
      isPublic: false,
    });
  }

  return analysis;
}

function isAwsS3ManagedKey(key: string): boolean {
  return key === "alias/aws/s3" || key.endsWith(":alias/aws/s3");
}

// One bucket: every setting, then the facts and the access they make.
async function readBucket(
  ctx: AccountContext,
  target: BucketTarget,
  accountBlock: PublicAccessBlock,
  regionsByBucket: Map<string, string>,
): Promise<CloudDataStoreRead> {
  const bucket: BucketTarget = { ...target };
  const parts: Map<string, BucketPart> = new Map();

  for (const [subresource, action] of BUCKET_PARTS) {
    parts.set(
      subresource,
      await readBucketPart(ctx, bucket, subresource, action),
    );
  }

  const store: CloudDataStoreRead = newStore(ctx, {
    kind: DataStoreKind.AwsS3Bucket,
    name: bucket.name,
    providerResourceId: `arn:${ctx.partition}:s3:::${bucket.name}`,
    region: bucket.region,
  });
  const posture: CloudDataStoreRead["posture"] = store.posture;
  const part: (subresource: string) => BucketPart = (
    subresource: string,
  ): BucketPart => {
    return parts.get(subresource) || { state: "unset" };
  };

  for (const [subresource, action] of BUCKET_PARTS) {
    const read: BucketPart = part(subresource);

    if (read.state === "unknown") {
      addStoreWarning(store, ctx.notes.describe(read.unread, action));
    }
  }

  // Public access block: the bucket's or the account's, setting by setting.
  const blockPart: BucketPart = part("publicAccessBlock");
  const bucketBlock: PublicAccessBlock =
    blockPart.state === "set"
      ? readPublicAccessBlock(blockPart.text)
      : blockPart.state === "unset"
        ? NO_BLOCK
        : UNKNOWN_BLOCK;
  const ignorePublicAcls: Fact = anyOf(
    bucketBlock.ignorePublicAcls,
    accountBlock.ignorePublicAcls,
  );
  const restrictPublicBuckets: Fact = anyOf(
    bucketBlock.restrictPublicBuckets,
    accountBlock.restrictPublicBuckets,
  );

  posture.blockPublicAccess = anyOf(
    isFullyBlocked(bucketBlock),
    isFullyBlocked(accountBlock),
  );

  // Object ownership: with the bucket owner enforced, ACLs grant nothing.
  const ownershipPart: BucketPart = part("ownershipControls");
  const ownerEnforced: Fact =
    ownershipPart.state === "set"
      ? xmlFirst(ownershipPart.text, "ObjectOwnership") ===
        "BucketOwnerEnforced"
      : ownershipPart.state === "unset"
        ? false
        : null;

  posture.uniformAccess = ownerEnforced;

  // The ACL.
  const aclPart: BucketPart = part("acl");
  const acl: AclAnalysis | null =
    aclPart.state === "set" ? analyzeAcl(aclPart.text) : null;
  const aclCounts: Fact = allOf(notOf(ownerEnforced), notOf(ignorePublicAcls));
  const aclPublicRead: Fact = allOf(acl ? acl.publicRead : null, aclCounts);
  const aclPublicWrite: Fact = allOf(acl ? acl.publicWrite : null, aclCounts);

  // The policy, and AWS's own verdict on it.
  const policyPart: BucketPart = part("policy");
  let policy: PolicyAnalysis | null = null;

  if (policyPart.state === "set") {
    policy = analyzePolicy(policyPart.text, {
      actions: S3_POLICY_ACTIONS,
      what: "The bucket policy",
      isExternalAccount: (accountId: string): boolean => {
        return !ctx.internal.has(accountId);
      },
      ownerCanonicalId: acl?.ownerId,
    });

    if (!policy) {
      addStoreWarning(
        store,
        "The bucket policy is not JSON OneUptime can read.",
      );
    }
  } else if (policyPart.state === "unset") {
    policy = NO_POLICY;
  }

  const statusPart: BucketPart = part("policyStatus");
  const awsSaysPublic: Fact =
    statusPart.state === "set"
      ? readFlag(xmlFirst(statusPart.text, "IsPublic"))
      : statusPart.state === "unset"
        ? false
        : null;

  /*
   * AWS's verdict wins where it speaks: a policy it does not count public
   * (a condition this reading missed) is not, and one it counts public
   * is, though no statement here said what for.
   */
  let policyRead: Fact = policy ? policy.publicRead : null;
  let policyWrite: Fact = policy ? policy.publicWrite : null;
  let publicByVerdict: boolean = false;

  if (awsSaysPublic === false) {
    policyRead = false;
    policyWrite = false;
  } else if (
    awsSaysPublic === true &&
    policyRead !== true &&
    policyWrite !== true
  ) {
    policyRead = true;
    publicByVerdict = true;
  }

  const policyCounts: Fact = notOf(restrictPublicBuckets);
  const policyPublicRead: Fact = allOf(policyRead, policyCounts);
  const policyPublicWrite: Fact = allOf(policyWrite, policyCounts);

  posture.publicRead = anyOf(policyPublicRead, aclPublicRead);
  posture.publicWrite = anyOf(policyPublicWrite, aclPublicWrite);

  const reasons: Array<string> = [];

  if (policyPublicRead === true || policyPublicWrite === true) {
    reasons.push(
      publicByVerdict || !policy?.publicReason
        ? "AWS reports the bucket policy as public"
        : policy.publicReason,
    );
  }

  if ((aclPublicRead === true || aclPublicWrite === true) && acl) {
    reasons.push(acl.publicReason);
  }

  if (reasons.length > 0) {
    posture.publicReason = `${reasons.join("; ")}.`;
  }

  // Who else the policy and the ACL let in.
  const external: Array<string> = [
    ...(policy ? externalPrincipals(policy.grants) : []),
    ...(acl && ownerEnforced !== true ? acl.external : []),
  ];

  posture.sharedWithExternal =
    policy || external.length > 0 ? uniqueSorted(external) : undefined;

  for (const grant of policy?.grants || []) {
    if (
      grant.isPublic &&
      policyPublicRead === false &&
      policyPublicWrite === false
    ) {
      continue;
    }

    addAccess(store, grantEntry(grant, "Bucket policy"));
  }

  if (publicByVerdict && policyPublicRead !== false) {
    addAccess(store, publicEntry("Bucket policy", DataStoreAccessLevel.Read));
  }

  if (acl && ownerEnforced !== true) {
    for (const entry of acl.entries) {
      if (entry.isPublic && aclCounts === false) {
        continue;
      }

      addAccess(store, entry);
    }
  }

  // TLS: a Deny of requests without it.
  posture.encryptionInTransitEnforced = policy
    ? policy.secureTransportDenied
    : null;

  if (policy?.minimumTlsVersion) {
    posture.minimumTlsVersion = policy.minimumTlsVersion;
  }

  // Default encryption, and whose key.
  const encryptionPart: BucketPart = part("encryption");

  if (encryptionPart.state === "set") {
    const algorithm: string = xmlFirst(encryptionPart.text, "SSEAlgorithm");
    const key: string = xmlFirst(encryptionPart.text, "KMSMasterKeyID");

    posture.encryptedAtRest = Boolean(algorithm);
    posture.customerManagedKey =
      (algorithm === "aws:kms" || algorithm === "aws:kms:dsse") &&
      Boolean(key) &&
      !isAwsS3ManagedKey(key);
  } else if (encryptionPart.state === "unset") {
    posture.encryptedAtRest = false;
    posture.customerManagedKey = false;
  } else {
    posture.encryptedAtRest = null;
    posture.customerManagedKey = null;
  }

  // Versioning and access logging.
  const versioningPart: BucketPart = part("versioning");

  posture.versioning =
    versioningPart.state === "set"
      ? xmlFirst(versioningPart.text, "Status") === "Enabled"
      : versioningPart.state === "unset"
        ? false
        : null;

  const loggingPart: BucketPart = part("logging");

  posture.accessLogging =
    loggingPart.state === "set"
      ? readXmlTags(loggingPart.text, "LoggingEnabled").length > 0
      : loggingPart.state === "unset"
        ? false
        : null;

  // Replication: the Regions of the buckets an enabled rule copies to.
  const replicationPart: BucketPart = part("replication");

  if (replicationPart.state === "set") {
    const regions: Array<string> = [];

    for (const rule of readXmlTags(replicationPart.text, "Rule")) {
      if (xmlField(rule, "Status") !== "Enabled") {
        continue;
      }

      const destination: string = xmlField(
        xmlField(rule, "Destination"),
        "Bucket",
      );
      const name: string = destination.startsWith("arn:")
        ? destination.split(":::")[1] || ""
        : destination;
      const region: string = regionsByBucket.get(name) || "";

      if (region && region !== bucket.region) {
        regions.push(region);
      }
    }

    posture.replicationRegions = uniqueSorted(regions);
  } else if (replicationPart.state === "unset") {
    posture.replicationRegions = [];
  }

  // Tags.
  const taggingPart: BucketPart = part("tagging");

  if (taggingPart.state === "set") {
    store.tags = readXmlTagSet(taggingPart.text);
  } else if (taggingPart.state === "unset") {
    store.tags = {};
  }

  store.identity.region = bucket.region;
  return store;
}

async function readS3(ctx: AccountContext): Promise<Array<CloudDataStoreRead>> {
  const listing: Answer<{ buckets: Array<BucketTarget>; complete: boolean }> =
    await listBuckets(ctx);

  if (!listing.ok) {
    ctx.notes.incomplete = true;
    return [];
  }

  if (!listing.value.complete) {
    ctx.notes.incomplete = true;
  }

  // Where each bucket is, for the buckets ListBuckets did not say of.
  const buckets: Array<BucketTarget> = [];

  for (const bucket of listing.value.buckets) {
    buckets.push(
      bucket.region
        ? bucket
        : { name: bucket.name, region: await locateBucket(ctx, bucket.name) },
    );
  }

  const regionsByBucket: Map<string, string> = new Map(
    buckets.map((bucket: BucketTarget): [string, string] => {
      return [bucket.name, bucket.region];
    }),
  );
  const named: Array<BucketTarget> = ctx.regionsNamed
    ? buckets.filter((bucket: BucketTarget): boolean => {
        return ctx.regions.includes(bucket.region);
      })
    : buckets;

  if (named.length > AWS_DATA_SECURITY_MAX_BUCKETS) {
    ctx.notes.incomplete = true;
    ctx.notes.note(
      `The account has ${named.length} buckets: the first ${AWS_DATA_SECURITY_MAX_BUCKETS} were read.`,
    );
  }

  const chosen: Array<BucketTarget> = named.slice(
    0,
    AWS_DATA_SECURITY_MAX_BUCKETS,
  );

  if (chosen.length === 0) {
    return [];
  }

  const accountBlock: PublicAccessBlock =
    await readAccountPublicAccessBlock(ctx);
  const outcomes: Array<Settled<CloudDataStoreRead>> = await mapWithConcurrency(
    chosen,
    BUCKET_CONCURRENCY,
    async (bucket: BucketTarget): Promise<CloudDataStoreRead> => {
      return await readBucket(ctx, bucket, accountBlock, regionsByBucket);
    },
  );
  const stores: Array<CloudDataStoreRead> = [];

  for (let index: number = 0; index < outcomes.length; index++) {
    const outcome: Settled<CloudDataStoreRead> = outcomes[index]!;

    if (outcome.ok) {
      stores.push(outcome.value);
      continue;
    }

    if (isAuthentication(outcome.error)) {
      throw outcome.error;
    }

    ctx.notes.incomplete = true;
    ctx.notes.note(
      `Could not read the bucket ${chosen[index]!.name}: ${messageOf(outcome.error)}`,
    );
  }

  return stores;
}

/*
 * ---------------------------------------------------------------------
 * RDS and Aurora
 * ---------------------------------------------------------------------
 */

interface SnapshotApi {
  listAction: string;
  listIam: string;
  itemTag: string;
  idTag: string;
  sourceTag: string;
  arnTag: string;
  encryptedTag: string;
  arnResource: string;
  attributesAction: string;
  attributesIam: string;
  attributesIdParam: string;
  attributeTag: string;
}

const INSTANCE_SNAPSHOTS: SnapshotApi = {
  listAction: "DescribeDBSnapshots",
  listIam: "rds:DescribeDBSnapshots",
  itemTag: "DBSnapshot",
  idTag: "DBSnapshotIdentifier",
  sourceTag: "DBInstanceIdentifier",
  arnTag: "DBSnapshotArn",
  encryptedTag: "Encrypted",
  arnResource: "snapshot",
  attributesAction: "DescribeDBSnapshotAttributes",
  attributesIam: "rds:DescribeDBSnapshotAttributes",
  attributesIdParam: "DBSnapshotIdentifier",
  attributeTag: "DBSnapshotAttribute",
};

const CLUSTER_SNAPSHOTS: SnapshotApi = {
  listAction: "DescribeDBClusterSnapshots",
  listIam: "rds:DescribeDBClusterSnapshots",
  itemTag: "DBClusterSnapshot",
  idTag: "DBClusterSnapshotIdentifier",
  sourceTag: "DBClusterIdentifier",
  arnTag: "DBClusterSnapshotArn",
  encryptedTag: "StorageEncrypted",
  arnResource: "cluster-snapshot",
  attributesAction: "DescribeDBClusterSnapshotAttributes",
  attributesIam: "rds:DescribeDBClusterSnapshotAttributes",
  attributesIdParam: "DBClusterSnapshotIdentifier",
  attributeTag: "DBClusterSnapshotAttribute",
};

interface SnapshotRead {
  id: string;
  arn: string;
  // The instance or cluster it is a snapshot of.
  source: string;
  encrypted: Fact;
  keyId: string;
  // "restore" holds "all"; null when its shares could not be read.
  isPublic: Fact;
  sharedWith: Array<string>;
  sharesUnread?: Unread | undefined;
}

interface SnapshotListing {
  snapshots: Array<SnapshotRead>;
  // Listed to the end: a store with none of these has no manual snapshot.
  complete: boolean;
}

// The Region's manual snapshots of one kind, and whom each is shared with.
async function readRdsSnapshots(
  ctx: AccountContext,
  region: string,
  api: SnapshotApi,
): Promise<Answer<SnapshotListing>> {
  const listed: Answer<{ items: Array<string>; complete: boolean }> =
    await describePages(ctx, region, {
      service: "rds",
      version: RDS_VERSION,
      action: api.listAction,
      iamAction: api.listIam,
      itemTag: api.itemTag,
      step: "snapshot list request",
      params: { SnapshotType: "manual" },
      maxItems: AWS_DATA_SECURITY_MAX_SNAPSHOTS_PER_REGION,
    });

  if (!listed.ok) {
    return listed;
  }

  const snapshots: Array<SnapshotRead> = [];

  for (const item of listed.value.items) {
    const id: string = xmlField(item, api.idTag);

    if (!id) {
      continue;
    }

    const shares: Answer<Array<string>> = await attempt(
      ctx,
      api.attributesIam,
      async (): Promise<Array<string>> => {
        const text: string = await queryCall(ctx, region, {
          service: "rds",
          body: {
            Action: api.attributesAction,
            Version: RDS_VERSION,
            [api.attributesIdParam]: id,
          },
          step: "snapshot share request",
        });

        return readXmlTags(text, api.attributeTag)
          .filter((attribute: string): boolean => {
            return xmlField(attribute, "AttributeName") === "restore";
          })
          .flatMap((attribute: string): Array<string> => {
            return readXmlTags(attribute, "AttributeValue");
          });
      },
    );

    snapshots.push({
      id,
      arn: xmlField(item, api.arnTag),
      source: xmlField(item, api.sourceTag),
      encrypted: readFlag(xmlField(item, api.encryptedTag)),
      keyId: xmlField(item, "KmsKeyId"),
      isPublic: shares.ok ? shares.value.includes("all") : null,
      sharedWith: shares.ok
        ? uniqueSorted(
            shares.value.filter((value: string): boolean => {
              return value !== "all";
            }),
          )
        : [],
      sharesUnread: shares.ok ? undefined : shares,
    });
  }

  if (!listed.value.complete) {
    ctx.notes.incomplete = true;
  }

  return {
    ok: true,
    value: { snapshots, complete: listed.value.complete },
  };
}

function addSnapshotAccess(
  ctx: AccountContext,
  store: CloudDataStoreRead,
  snapshot: SnapshotRead,
): void {
  if (snapshot.isPublic === true) {
    addAccess(
      store,
      publicEntry(`Public snapshot ${snapshot.id}`, DataStoreAccessLevel.Read),
    );
  }

  for (const account of snapshot.sharedWith) {
    addAccess(store, {
      principal: account,
      principalType: DataStorePrincipalType.Account,
      accessLevel: DataStoreAccessLevel.Read,
      grantedVia: `Shared snapshot ${snapshot.id}`,
      isExternal: !ctx.internal.has(account),
      isPublic: false,
    });
  }
}

/*
 * A store's snapshot facts from its manual snapshots: public when any one
 * can be restored by everyone, shared with the outside accounts any one
 * names. None at all is a fact only when the listing read to its end.
 */
function applySnapshots(
  ctx: AccountContext,
  store: CloudDataStoreRead,
  sourceId: string,
  listing: Answer<SnapshotListing>,
  listAction: string,
  attributesAction: string,
): void {
  const posture: CloudDataStoreRead["posture"] = store.posture;

  if (!listing.ok) {
    posture.snapshotPublic = null;
    addStoreWarning(store, ctx.notes.describe(listing, listAction));
    return;
  }

  const own: Array<SnapshotRead> = listing.value.snapshots.filter(
    (snapshot: SnapshotRead): boolean => {
      return snapshot.source === sourceId;
    },
  );
  const allRead: boolean =
    listing.value.complete &&
    own.every((snapshot: SnapshotRead): boolean => {
      return snapshot.isPublic !== null;
    });
  const isPublic: Fact = anyOf(
    ...own.map((snapshot: SnapshotRead): Fact => {
      return snapshot.isPublic;
    }),
  );
  const external: Array<string> = uniqueSorted(
    own
      .flatMap((snapshot: SnapshotRead): Array<string> => {
        return snapshot.sharedWith;
      })
      .filter((account: string): boolean => {
        return !ctx.internal.has(account);
      }),
  );

  posture.snapshotPublic = isPublic === false && !allRead ? null : isPublic;
  posture.snapshotSharedWith =
    allRead || external.length > 0 ? external : undefined;
  posture.sharedSnapshotIds = own
    .filter((snapshot: SnapshotRead): boolean => {
      return (
        snapshot.isPublic === true ||
        snapshot.sharedWith.some((account: string): boolean => {
          return !ctx.internal.has(account);
        })
      );
    })
    .map((snapshot: SnapshotRead): string => {
      return snapshot.id;
    });

  for (const snapshot of own) {
    addSnapshotAccess(ctx, store, snapshot);

    if (snapshot.sharesUnread) {
      addStoreWarning(
        store,
        ctx.notes.describe(snapshot.sharesUnread, attributesAction),
      );
    }
  }
}

// A manual snapshot of a database that is gone: a store of its own.
async function snapshotStore(
  ctx: AccountContext,
  region: string,
  snapshot: SnapshotRead,
  api: SnapshotApi,
): Promise<CloudDataStoreRead> {
  const store: CloudDataStoreRead = newStore(ctx, {
    kind: DataStoreKind.AwsRdsSnapshot,
    name: snapshot.id,
    providerResourceId:
      snapshot.arn ||
      arnOf(ctx, "rds", region, `${api.arnResource}:${snapshot.id}`),
    region,
  });
  const external: Array<string> = snapshot.sharedWith.filter(
    (account: string): boolean => {
      return !ctx.internal.has(account);
    },
  );

  store.posture.snapshotPublic = snapshot.isPublic;
  store.posture.snapshotSharedWith =
    snapshot.isPublic !== null || external.length > 0 ? external : undefined;
  store.posture.encryptedAtRest = snapshot.encrypted;
  store.posture.customerManagedKey = await customerKeyFact(
    ctx,
    region,
    snapshot.encrypted,
    snapshot.keyId,
  );
  addSnapshotAccess(ctx, store, snapshot);

  if (snapshot.sharesUnread) {
    addStoreWarning(
      store,
      ctx.notes.describe(snapshot.sharesUnread, api.attributesIam),
    );
  }

  return store;
}

function noteCapped(
  ctx: AccountContext,
  what: string,
  region: string,
  complete: boolean,
): void {
  if (!complete) {
    ctx.notes.incomplete = true;
    ctx.notes.note(
      `More ${what} in ${region} than one read takes: the first ${AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION} were read.`,
    );
  }
}

async function readRds(
  ctx: AccountContext,
  region: string,
): Promise<Array<CloudDataStoreRead>> {
  const instances: Answer<{ items: Array<string>; complete: boolean }> =
    await describePages(ctx, region, {
      service: "rds",
      version: RDS_VERSION,
      action: "DescribeDBInstances",
      iamAction: "rds:DescribeDBInstances",
      itemTag: "DBInstance",
      step: "database list request",
      maxItems: AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION,
    });
  const clusters: Answer<{ items: Array<string>; complete: boolean }> =
    await describePages(ctx, region, {
      service: "rds",
      version: RDS_VERSION,
      action: "DescribeDBClusters",
      iamAction: "rds:DescribeDBClusters",
      itemTag: "DBCluster",
      step: "database cluster list request",
      maxItems: AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION,
    });
  const instanceSnapshots: Answer<SnapshotListing> = await readRdsSnapshots(
    ctx,
    region,
    INSTANCE_SNAPSHOTS,
  );
  const clusterSnapshots: Answer<SnapshotListing> = await readRdsSnapshots(
    ctx,
    region,
    CLUSTER_SNAPSHOTS,
  );
  const stores: Array<CloudDataStoreRead> = [];
  // A cluster member's PubliclyAccessible: the cluster's network is its members'.
  const memberPublic: Map<string, Fact> = new Map();
  const instanceIds: Set<string> = new Set<string>();

  // A listing not read leaves its stores - snapshots of gone databases too - unknown.
  if (
    !instances.ok ||
    !clusters.ok ||
    !instanceSnapshots.ok ||
    !clusterSnapshots.ok
  ) {
    ctx.notes.incomplete = true;
  }

  if (instances.ok) {
    noteCapped(ctx, "databases", region, instances.value.complete);

    for (const item of instances.value.items) {
      const id: string = xmlField(item, "DBInstanceIdentifier");

      if (!id) {
        continue;
      }

      instanceIds.add(id);

      const publiclyAccessible: Fact = readFlag(
        xmlField(item, "PubliclyAccessible"),
      );

      // A cluster's member holds the cluster's data: the cluster is the store.
      if (xmlField(item, "DBClusterIdentifier")) {
        memberPublic.set(id, publiclyAccessible);
        continue;
      }

      const store: CloudDataStoreRead = newStore(ctx, {
        kind: DataStoreKind.AwsRdsInstance,
        name: id,
        providerResourceId:
          xmlField(item, "DBInstanceArn") ||
          arnOf(ctx, "rds", region, `db:${id}`),
        region,
      });
      const encrypted: Fact = readFlag(xmlField(item, "StorageEncrypted"));
      const retention: number | null = readNumber(
        xmlField(item, "BackupRetentionPeriod"),
      );

      store.posture.publicNetworkAccess = publiclyAccessible;
      store.posture.encryptedAtRest = encrypted;
      store.posture.customerManagedKey = await customerKeyFact(
        ctx,
        region,
        encrypted,
        xmlField(item, "KmsKeyId"),
      );
      store.posture.backupRetentionDays = retention;
      store.posture.backupsEnabled = retention === null ? null : retention > 0;
      store.posture.deletionProtection = readFlag(
        xmlField(item, "DeletionProtection"),
      );
      store.posture.replicationRegions = otherRegions(region, [
        ...readXmlTags(
          xmlField(item, "ReadReplicaDBInstanceIdentifiers"),
          "ReadReplicaDBInstanceIdentifier",
        ),
        ...readXmlTags(
          xmlField(item, "DBInstanceAutomatedBackupsReplications"),
          "DBInstanceAutomatedBackupsArn",
        ),
      ]);
      store.tags = readXmlTagSet(xmlField(item, "TagList"));
      applySnapshots(
        ctx,
        store,
        id,
        instanceSnapshots,
        INSTANCE_SNAPSHOTS.listIam,
        INSTANCE_SNAPSHOTS.attributesIam,
      );
      stores.push(store);
    }
  }

  const clusterIds: Set<string> = new Set<string>();

  if (clusters.ok) {
    noteCapped(ctx, "database clusters", region, clusters.value.complete);

    for (const item of clusters.value.items) {
      const id: string = xmlField(item, "DBClusterIdentifier");

      if (!id) {
        continue;
      }

      clusterIds.add(id);

      const members: Array<string> = readXmlTags(
        xmlField(item, "DBClusterMembers"),
        "DBClusterMember",
      )
        .map((member: string): string => {
          return xmlField(member, "DBInstanceIdentifier");
        })
        .filter((member: string): boolean => {
          return Boolean(member);
        });
      const ownSetting: Fact = readFlag(xmlField(item, "PubliclyAccessible"));
      const store: CloudDataStoreRead = newStore(ctx, {
        kind: xmlField(item, "Engine").startsWith("docdb")
          ? DataStoreKind.AwsDocumentDbCluster
          : DataStoreKind.AwsRdsCluster,
        name: id,
        providerResourceId:
          xmlField(item, "DBClusterArn") ||
          arnOf(ctx, "rds", region, `cluster:${id}`),
        region,
      });
      const encrypted: Fact = readFlag(xmlField(item, "StorageEncrypted"));
      const retention: number | null = readNumber(
        xmlField(item, "BackupRetentionPeriod"),
      );

      // A Multi-AZ DB cluster says it; an Aurora cluster's members do.
      store.posture.publicNetworkAccess =
        ownSetting !== null
          ? ownSetting
          : members.length === 0
            ? false
            : anyOf(
                ...members.map((member: string): Fact => {
                  return instances.ok && memberPublic.has(member)
                    ? memberPublic.get(member)!
                    : null;
                }),
              );
      store.posture.encryptedAtRest = encrypted;
      store.posture.customerManagedKey = await customerKeyFact(
        ctx,
        region,
        encrypted,
        xmlField(item, "KmsKeyId"),
      );
      store.posture.backupRetentionDays = retention;
      store.posture.backupsEnabled = retention === null ? null : retention > 0;
      store.posture.deletionProtection = readFlag(
        xmlField(item, "DeletionProtection"),
      );
      store.posture.replicationRegions = otherRegions(
        region,
        readXmlTags(
          xmlField(item, "ReadReplicaIdentifiers"),
          "ReadReplicaIdentifier",
        ),
      );
      store.tags = readXmlTagSet(xmlField(item, "TagList"));
      applySnapshots(
        ctx,
        store,
        id,
        clusterSnapshots,
        CLUSTER_SNAPSHOTS.listIam,
        CLUSTER_SNAPSHOTS.attributesIam,
      );
      stores.push(store);
    }
  }

  // Snapshots of databases that are gone, once every database is known.
  if (instances.ok && instances.value.complete && instanceSnapshots.ok) {
    for (const snapshot of instanceSnapshots.value.snapshots) {
      if (!instanceIds.has(snapshot.source)) {
        stores.push(
          await snapshotStore(ctx, region, snapshot, INSTANCE_SNAPSHOTS),
        );
      }
    }
  }

  if (clusters.ok && clusters.value.complete && clusterSnapshots.ok) {
    for (const snapshot of clusterSnapshots.value.snapshots) {
      if (!clusterIds.has(snapshot.source)) {
        stores.push(
          await snapshotStore(ctx, region, snapshot, CLUSTER_SNAPSHOTS),
        );
      }
    }
  }

  return stores;
}

/*
 * ---------------------------------------------------------------------
 * DynamoDB
 * ---------------------------------------------------------------------
 */

async function readDynamoDb(
  ctx: AccountContext,
  region: string,
): Promise<Array<CloudDataStoreRead>> {
  const listed: Answer<{ names: Array<string>; complete: boolean }> =
    await attempt(
      ctx,
      "dynamodb:ListTables",
      async (): Promise<{ names: Array<string>; complete: boolean }> => {
        const names: Array<string> = [];
        let start: string = "";

        for (let page: number = 0; page < MAX_PAGES; page++) {
          const answer: JSONObject = await jsonCall(ctx, region, {
            service: "dynamodb",
            target: "DynamoDB_20120810.ListTables",
            jsonVersion: "1.0",
            body: {
              Limit: PAGE_SIZE,
              ...(start ? { ExclusiveStartTableName: start } : {}),
            },
            step: "table list request",
          });

          for (const raw of readArray(answer["TableNames"])) {
            const name: string = readText(raw);

            if (name) {
              names.push(name);
            }
          }

          const next: string = readText(answer["LastEvaluatedTableName"]);
          const max: number = AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION;

          if (!next || next === start) {
            return {
              names: names.slice(0, max),
              complete: names.length <= max,
            };
          }

          if (names.length >= max) {
            return { names: names.slice(0, max), complete: false };
          }

          start = next;
        }

        return {
          names: names.slice(0, AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION),
          complete: false,
        };
      },
    );

  if (!listed.ok) {
    ctx.notes.incomplete = true;
    return [];
  }

  noteCapped(ctx, "tables", region, listed.value.complete);

  const stores: Array<CloudDataStoreRead> = [];

  for (const name of listed.value.names) {
    const described: Answer<JSONObject> = await attempt(
      ctx,
      "dynamodb:DescribeTable",
      async (): Promise<JSONObject> => {
        return readObject(
          (
            await jsonCall(ctx, region, {
              service: "dynamodb",
              target: "DynamoDB_20120810.DescribeTable",
              jsonVersion: "1.0",
              body: { TableName: name },
              step: "table request",
            })
          )["Table"],
        );
      },
    );
    const backups: Answer<JSONObject> = await attempt(
      ctx,
      "dynamodb:DescribeContinuousBackups",
      async (): Promise<JSONObject> => {
        return readObject(
          (
            await jsonCall(ctx, region, {
              service: "dynamodb",
              target: "DynamoDB_20120810.DescribeContinuousBackups",
              jsonVersion: "1.0",
              body: { TableName: name },
              step: "table backup request",
            })
          )["ContinuousBackupsDescription"],
        );
      },
    );
    const table: JSONObject = described.ok ? described.value : {};
    const store: CloudDataStoreRead = newStore(ctx, {
      kind: DataStoreKind.AwsDynamoDbTable,
      name,
      providerResourceId:
        readText(table["TableArn"]) ||
        arnOf(ctx, "dynamodb", region, `table/${name}`),
      region,
    });

    // DynamoDB encrypts every table; whose key is the question.
    store.posture.encryptedAtRest = true;

    if (described.ok) {
      const sse: JSONObject = readObject(table["SSEDescription"]);

      store.posture.customerManagedKey =
        readText(sse["SSEType"]).toUpperCase() === "KMS"
          ? await isCustomerManagedKey(
              ctx,
              region,
              readText(sse["KMSMasterKeyArn"]),
            )
          : false;
      store.posture.deletionProtection =
        jsonFlag(table["DeletionProtectionEnabled"]) ?? false;
      store.posture.replicationRegions = uniqueSorted(
        readArray(table["Replicas"])
          .map((raw: unknown): string => {
            return readText(readObject(raw)["RegionName"]);
          })
          .filter((other: string): boolean => {
            return Boolean(other) && other !== region;
          }),
      );

      const size: number | null = jsonNumber(table["TableSizeBytes"]);
      const items: number | null = jsonNumber(table["ItemCount"]);

      store.sizeInBytes = size === null ? undefined : size;
      store.objectCount = items === null ? undefined : items;
    } else {
      store.posture.customerManagedKey = null;
      store.posture.deletionProtection = null;
      addStoreWarning(
        store,
        ctx.notes.describe(described, "dynamodb:DescribeTable"),
      );
    }

    if (backups.ok) {
      const recovery: JSONObject = readObject(
        backups.value["PointInTimeRecoveryDescription"],
      );
      const enabled: boolean =
        readText(recovery["PointInTimeRecoveryStatus"]).toUpperCase() ===
        "ENABLED";

      store.posture.pointInTimeRecovery = enabled;

      if (enabled) {
        store.posture.backupRetentionDays =
          jsonNumber(recovery["RecoveryPeriodInDays"]) ?? 35;
      }
    } else {
      store.posture.pointInTimeRecovery = null;
      addStoreWarning(
        store,
        ctx.notes.describe(backups, "dynamodb:DescribeContinuousBackups"),
      );
    }

    stores.push(store);
  }

  return stores;
}

/*
 * ---------------------------------------------------------------------
 * Redshift
 * ---------------------------------------------------------------------
 */

async function readRedshift(
  ctx: AccountContext,
  region: string,
): Promise<Array<CloudDataStoreRead>> {
  const clusters: Answer<{ items: Array<string>; complete: boolean }> =
    await describePages(ctx, region, {
      service: "redshift",
      version: REDSHIFT_VERSION,
      action: "DescribeClusters",
      iamAction: "redshift:DescribeClusters",
      itemTag: "Cluster",
      step: "warehouse list request",
      maxItems: AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION,
    });

  if (!clusters.ok) {
    ctx.notes.incomplete = true;
    return [];
  }

  noteCapped(ctx, "warehouses", region, clusters.value.complete);

  const stores: Array<CloudDataStoreRead> = [];

  for (const item of clusters.value.items) {
    const id: string = xmlField(item, "ClusterIdentifier");

    if (!id) {
      continue;
    }

    const logging: Answer<Fact> = await attempt(
      ctx,
      "redshift:DescribeLoggingStatus",
      async (): Promise<Fact> => {
        const text: string = await queryCall(ctx, region, {
          service: "redshift",
          body: {
            Action: "DescribeLoggingStatus",
            Version: REDSHIFT_VERSION,
            ClusterIdentifier: id,
          },
          step: "warehouse logging request",
        });

        return readFlag(readXmlTag(text, "LoggingEnabled"));
      },
    );
    const store: CloudDataStoreRead = newStore(ctx, {
      kind: DataStoreKind.AwsRedshiftCluster,
      name: id,
      providerResourceId: arnOf(ctx, "redshift", region, `cluster:${id}`),
      region,
    });
    const encrypted: Fact = readFlag(xmlField(item, "Encrypted"));
    const retention: number | null = readNumber(
      xmlField(item, "AutomatedSnapshotRetentionPeriod"),
    );
    const copiedTo: string = xmlField(
      xmlField(item, "ClusterSnapshotCopyStatus"),
      "DestinationRegion",
    );

    store.posture.publicNetworkAccess = readFlag(
      xmlField(item, "PubliclyAccessible"),
    );
    store.posture.encryptedAtRest = encrypted;
    store.posture.customerManagedKey = await customerKeyFact(
      ctx,
      region,
      encrypted,
      xmlField(item, "KmsKeyId"),
    );
    store.posture.backupRetentionDays = retention;
    store.posture.backupsEnabled = retention === null ? null : retention > 0;
    store.posture.replicationRegions =
      copiedTo && copiedTo !== region && isAwsRegion(copiedTo)
        ? [copiedTo]
        : [];
    store.tags = readXmlTagSet(xmlField(item, "Tags"));

    if (logging.ok) {
      store.posture.accessLogging = logging.value;
    } else {
      store.posture.accessLogging = null;
      addStoreWarning(
        store,
        ctx.notes.describe(logging, "redshift:DescribeLoggingStatus"),
      );
    }

    stores.push(store);
  }

  return stores;
}

/*
 * ---------------------------------------------------------------------
 * OpenSearch Service (REST-JSON)
 * ---------------------------------------------------------------------
 */

// "Policy-Min-TLS-1-2-2019-07" -> "1.2"; "" when the name says no version.
function tlsOfPolicy(policy: string): string {
  const marker: string = "TLS-";
  const index: number = policy.toUpperCase().indexOf(marker);

  if (index < 0) {
    return "";
  }

  const major: string = policy.charAt(index + marker.length);
  const separator: string = policy.charAt(index + marker.length + 1);
  const minor: string = policy.charAt(index + marker.length + 2);
  const isDigit: (character: string) => boolean = (
    character: string,
  ): boolean => {
    return character >= "0" && character <= "9";
  };

  return isDigit(major) && separator === "-" && isDigit(minor)
    ? `${major}.${minor}`
    : "";
}

async function readOpenSearchDomain(
  ctx: AccountContext,
  region: string,
  name: string,
  status: JSONObject | undefined,
  unread: Unread | undefined,
): Promise<CloudDataStoreRead> {
  const store: CloudDataStoreRead = newStore(ctx, {
    kind: DataStoreKind.AwsOpenSearchDomain,
    name,
    providerResourceId:
      readText(status?.["ARN"]) || arnOf(ctx, "es", region, `domain/${name}`),
    region,
  });
  const posture: CloudDataStoreRead["posture"] = store.posture;

  if (!status) {
    posture.publicRead = null;
    posture.publicNetworkAccess = null;
    posture.encryptedAtRest = null;
    posture.encryptionInTransitEnforced = null;

    if (unread) {
      addStoreWarning(store, ctx.notes.describe(unread, "es:DescribeDomains"));
    }

    return store;
  }

  const vpc: JSONObject = readObject(status["VPCOptions"]);
  const inVpc: boolean =
    Boolean(readText(vpc["VPCId"])) ||
    Boolean(readText(readObject(status["Endpoints"])["vpc"]));
  const atRest: JSONObject = readObject(status["EncryptionAtRestOptions"]);
  const endpoint: JSONObject = readObject(status["DomainEndpointOptions"]);
  const security: JSONObject = readObject(status["AdvancedSecurityOptions"]);
  const audit: JSONObject = readObject(
    readObject(status["LogPublishingOptions"])["AUDIT_LOGS"],
  );
  const encrypted: Fact = jsonFlag(atRest["Enabled"]);
  /*
   * Fine-grained access control asks every request for a user of its own,
   * unless it lets anonymous requests in: an open policy is then not public.
   */
  const asksForUser: boolean =
    jsonFlag(security["Enabled"]) === true &&
    jsonFlag(security["AnonymousAuthEnabled"]) !== true;
  const policyText: string = readText(status["AccessPolicies"]);
  const policy: PolicyAnalysis | null = policyText
    ? analyzePolicy(policyText, {
        actions: OPENSEARCH_POLICY_ACTIONS,
        what: "The access policy",
        isExternalAccount: (accountId: string): boolean => {
          return !ctx.internal.has(accountId);
        },
      })
    : NO_POLICY;
  const reachable: boolean = !inVpc && !asksForUser;

  posture.publicNetworkAccess = !inVpc;
  posture.publicRead = policy ? policy.publicRead && reachable : null;
  posture.publicWrite = policy ? policy.publicWrite && reachable : null;

  if (posture.publicRead || posture.publicWrite) {
    posture.publicReason = `${policy!.publicReason}, and the domain is not in a VPC.`;
  }

  if (!policy) {
    addStoreWarning(store, "The access policy is not JSON OneUptime can read.");
  }

  posture.sharedWithExternal = policy
    ? uniqueSorted(externalPrincipals(policy.grants))
    : undefined;

  for (const grant of policy?.grants || []) {
    if (grant.isPublic && !reachable) {
      continue;
    }

    addAccess(store, grantEntry(grant, "Access policy"));
  }

  posture.encryptedAtRest = encrypted;
  posture.customerManagedKey = await customerKeyFact(
    ctx,
    region,
    encrypted,
    readText(atRest["KmsKeyId"]),
  );
  posture.encryptionInTransitEnforced = allOf(
    jsonFlag(readObject(status["NodeToNodeEncryptionOptions"])["Enabled"]),
    jsonFlag(endpoint["EnforceHTTPS"]),
  );
  posture.minimumTlsVersion =
    tlsOfPolicy(readText(endpoint["TLSSecurityPolicy"])) || null;
  posture.accessLogging = jsonFlag(audit["Enabled"]) === true;

  return store;
}

async function readOpenSearch(
  ctx: AccountContext,
  region: string,
): Promise<Array<CloudDataStoreRead>> {
  const listed: Answer<Array<string>> = await attempt(
    ctx,
    "es:ListDomainNames",
    async (): Promise<Array<string>> => {
      const answer: AwsRestResponse = await restCall(ctx, region, {
        service: "es",
        path: "/2021-01-01/domain",
        step: "search domain list request",
      });

      return readArray(answer.json?.["DomainNames"])
        .map((raw: unknown): string => {
          return readText(readObject(raw)["DomainName"]);
        })
        .filter((name: string): boolean => {
          return Boolean(name);
        });
    },
  );

  if (!listed.ok) {
    ctx.notes.incomplete = true;
    return [];
  }

  const names: Array<string> = listed.value.slice(
    0,
    AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION,
  );

  noteCapped(
    ctx,
    "search domains",
    region,
    listed.value.length <= AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION,
  );

  const stores: Array<CloudDataStoreRead> = [];

  for (
    let start: number = 0;
    start < names.length;
    start += OPENSEARCH_DESCRIBE_BATCH
  ) {
    const batch: Array<string> = names.slice(
      start,
      start + OPENSEARCH_DESCRIBE_BATCH,
    );
    const described: Answer<Array<JSONObject>> = await attempt(
      ctx,
      "es:DescribeDomains",
      async (): Promise<Array<JSONObject>> => {
        const answer: AwsRestResponse = await restCall(ctx, region, {
          service: "es",
          method: "POST",
          path: "/2021-01-01/opensearch/domain-info",
          body: JSON.stringify({ DomainNames: batch }),
          step: "search domain request",
        });

        return readArray(answer.json?.["DomainStatusList"]).map(
          (raw: unknown): JSONObject => {
            return readObject(raw);
          },
        );
      },
    );

    for (const name of batch) {
      const status: JSONObject | undefined = described.ok
        ? described.value.find((candidate: JSONObject): boolean => {
            return readText(candidate["DomainName"]) === name;
          })
        : undefined;

      stores.push(
        await readOpenSearchDomain(
          ctx,
          region,
          name,
          status,
          described.ok ? undefined : described,
        ),
      );
    }
  }

  return stores;
}

/*
 * ---------------------------------------------------------------------
 * ElastiCache and EFS: how their data is encrypted.
 * ---------------------------------------------------------------------
 */

async function readElastiCache(
  ctx: AccountContext,
  region: string,
): Promise<Array<CloudDataStoreRead>> {
  const groups: Answer<{ items: Array<string>; complete: boolean }> =
    await describePages(ctx, region, {
      service: "elasticache",
      version: ELASTICACHE_VERSION,
      action: "DescribeReplicationGroups",
      iamAction: "elasticache:DescribeReplicationGroups",
      itemTag: "ReplicationGroup",
      step: "cache list request",
      maxItems: AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION,
    });

  if (!groups.ok) {
    ctx.notes.incomplete = true;
    return [];
  }

  noteCapped(ctx, "caches", region, groups.value.complete);

  const stores: Array<CloudDataStoreRead> = [];

  for (const item of groups.value.items) {
    const id: string = xmlField(item, "ReplicationGroupId");

    if (!id) {
      continue;
    }

    const store: CloudDataStoreRead = newStore(ctx, {
      kind: DataStoreKind.AwsElastiCacheCluster,
      name: id,
      providerResourceId:
        xmlField(item, "ARN") ||
        arnOf(ctx, "elasticache", region, `replicationgroup:${id}`),
      region,
    });
    const encrypted: Fact = readFlag(xmlField(item, "AtRestEncryptionEnabled"));
    const inTransit: Fact = readFlag(
      xmlField(item, "TransitEncryptionEnabled"),
    );
    const retention: number | null = readNumber(
      xmlField(item, "SnapshotRetentionLimit"),
    );

    store.posture.encryptedAtRest = encrypted;
    store.posture.customerManagedKey = await customerKeyFact(
      ctx,
      region,
      encrypted,
      xmlField(item, "KmsKeyId"),
    );
    // "preferred" takes connections with TLS and without.
    store.posture.encryptionInTransitEnforced =
      inTransit === true &&
      xmlField(item, "TransitEncryptionMode").toLowerCase() === "preferred"
        ? false
        : inTransit;
    store.posture.backupRetentionDays = retention;
    store.posture.backupsEnabled = retention === null ? null : retention > 0;
    stores.push(store);
  }

  return stores;
}

async function readEfs(
  ctx: AccountContext,
  region: string,
): Promise<Array<CloudDataStoreRead>> {
  const listed: Answer<{ fileSystems: Array<JSONObject>; complete: boolean }> =
    await attempt(
      ctx,
      "elasticfilesystem:DescribeFileSystems",
      async (): Promise<{
        fileSystems: Array<JSONObject>;
        complete: boolean;
      }> => {
        const fileSystems: Array<JSONObject> = [];
        let marker: string = "";

        for (let page: number = 0; page < MAX_PAGES; page++) {
          const answer: AwsRestResponse = await restCall(ctx, region, {
            service: "elasticfilesystem",
            path: "/2015-02-01/file-systems",
            query: {
              MaxItems: String(PAGE_SIZE),
              ...(marker ? { Marker: marker } : {}),
            },
            step: "file system list request",
          });

          for (const raw of readArray(answer.json?.["FileSystems"])) {
            fileSystems.push(readObject(raw));
          }

          const next: string = readText(answer.json?.["NextMarker"]);
          const max: number = AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION;

          if (!next || next === marker) {
            return {
              fileSystems: fileSystems.slice(0, max),
              complete: fileSystems.length <= max,
            };
          }

          if (fileSystems.length >= max) {
            return { fileSystems: fileSystems.slice(0, max), complete: false };
          }

          marker = next;
        }

        return {
          fileSystems: fileSystems.slice(
            0,
            AWS_DATA_SECURITY_MAX_ITEMS_PER_REGION,
          ),
          complete: false,
        };
      },
    );

  if (!listed.ok) {
    ctx.notes.incomplete = true;
    return [];
  }

  noteCapped(ctx, "file systems", region, listed.value.complete);

  const stores: Array<CloudDataStoreRead> = [];

  for (const fileSystem of listed.value.fileSystems) {
    const id: string = readText(fileSystem["FileSystemId"]);

    if (!id) {
      continue;
    }

    const store: CloudDataStoreRead = newStore(ctx, {
      kind: DataStoreKind.AwsEfsFileSystem,
      name: readText(fileSystem["Name"]) || id,
      providerResourceId:
        readText(fileSystem["FileSystemArn"]) ||
        arnOf(ctx, "elasticfilesystem", region, `file-system/${id}`),
      region,
    });
    const encrypted: Fact = jsonFlag(fileSystem["Encrypted"]);
    const size: number | null = jsonNumber(
      readObject(fileSystem["SizeInBytes"])["Value"],
    );

    store.posture.encryptedAtRest = encrypted;
    store.posture.customerManagedKey = await customerKeyFact(
      ctx,
      region,
      encrypted,
      readText(fileSystem["KmsKeyId"]),
    );
    store.sizeInBytes = size === null ? undefined : size;
    store.tags = readJsonTagSet(fileSystem["Tags"]);
    stores.push(store);
  }

  return stores;
}

/*
 * ---------------------------------------------------------------------
 * An account, its Regions, and the read.
 * ---------------------------------------------------------------------
 */

const REGION_LANES: Array<
  (ctx: AccountContext, region: string) => Promise<Array<CloudDataStoreRead>>
> = [
  readRds,
  readDynamoDb,
  readRedshift,
  readOpenSearch,
  readElastiCache,
  readEfs,
];

async function readRegion(
  ctx: AccountContext,
  region: string,
): Promise<Array<CloudDataStoreRead>> {
  const stores: Array<CloudDataStoreRead> = [];

  for (const lane of REGION_LANES) {
    stores.push(...(await lane(ctx, region)));
  }

  return stores;
}

async function readAccount(
  ctx: AccountContext,
): Promise<Array<CloudDataStoreRead>> {
  const stores: Array<CloudDataStoreRead> = await readS3(ctx);
  const outcomes: Array<Settled<Array<CloudDataStoreRead>>> =
    await mapWithConcurrency(
      ctx.regions,
      REGION_CONCURRENCY,
      async (region: string): Promise<Array<CloudDataStoreRead>> => {
        return await readRegion(ctx, region);
      },
    );
  const notEnabled: Array<string> = [];

  for (let index: number = 0; index < outcomes.length; index++) {
    const outcome: Settled<Array<CloudDataStoreRead>> = outcomes[index]!;
    const region: string = ctx.regions[index]!;

    if (outcome.ok) {
      stores.push(...outcome.value);
      continue;
    }

    if (outcome.error instanceof CloudReadBudgetSpent) {
      ctx.notes.budgetSpent = true;
      continue;
    }

    if (isAuthentication(outcome.error)) {
      // The home Region is open to every account: refused there is refused.
      if (region === ctx.homeRegion) {
        throw outcome.error;
      }

      /*
       * Anywhere else, a Region that never answered is one the account has
       * not opted in to, with nothing to read; one that answered before is
       * a read that stopped.
       */
      if (!ctx.reached.has(region)) {
        notEnabled.push(region);
        continue;
      }
    }

    ctx.notes.incomplete = true;
    ctx.notes.note(
      `Could not read the data stores in ${region}: ${messageOf(outcome.error)}`,
    );
  }

  if (ctx.regionsNamed && notEnabled.length > 0) {
    ctx.notes.note(
      `Could not read ${notEnabled.join(", ")}: the Region is not enabled for the account.`,
    );
  }

  return stores;
}

// Regions as AWS writes them, each once; anything else dropped.
function cleanRegions(regions: Array<string>): Array<string> {
  return Array.from(
    new Set(
      regions
        .map((region: string): string => {
          return region.trim().toLowerCase();
        })
        .filter((region: string): boolean => {
          return isAwsRegion(region);
        }),
    ),
  );
}

interface AccountToRead {
  id: string;
  name: string;
  settings: CloudConnectionSettings;
  credentials?: AwsCredentials | undefined;
}

/*
 * Every data store of the connection's accounts, read for data security.
 * Throws when the connection cannot sign in at all; everything else it
 * could not read is in the warnings and the stores' null facts.
 */
export async function readAwsDataSecurity(
  settings: CloudConnectionSettings,
  options: AwsDataSecurityReadOptions,
): Promise<CloudDataSecurityReadResult> {
  if (
    settings.projectId.trim().toLowerCase() !==
    options.projectId.toString().trim().toLowerCase()
  ) {
    throw new BadDataException(
      "The connection's settings belong to another project.",
    );
  }

  const connector: AwsCloudConnector = new AwsCloudConnector();

  connector.validateSettings(settings);

  const transport: CloudConnectorTransport =
    options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const budget: CloudReadBudget =
    options.budget ||
    new CloudReadBudget({
      maxRequests: DEFAULT_MAX_REQUESTS,
      maxDurationMs: DEFAULT_MAX_DURATION_MS,
    });
  const readAt: string = (
    options.now ? options.now() : new Date()
  ).toISOString();
  const named: Array<string> = cleanRegions(
    options.regions && options.regions.length > 0
      ? options.regions
      : connector.getConfiguredRegions(settings),
  );
  const homeRegion: string = getStsRegion(named);
  const subject: string =
    connector.getAuthMethod(settings) === CloudConnectionAuthMethod.AwsRole
      ? "The role"
      : "The access key";
  const callOptions: CloudConnectorCallOptions & {
    connectionId: string;
    budget: CloudReadBudget;
  } = {
    transport,
    now: options.now,
    sleep: options.sleep,
    requestTimeoutInMs: options.requestTimeoutInMs,
    connectionId: options.connectionId.toString(),
    budget,
  };
  const isOrganization: boolean = connector.isOrganization(settings);
  const result: CloudDataSecurityReadResult = {
    stores: [],
    warnings: [],
    complete: true,
  };
  const accounts: Array<AccountToRead> = [];

  // The connection's own account, or every account of its organization.
  const ownCredentials: AwsCredentials = await connector.getCredentials(
    settings,
    callOptions,
  );

  if (isOrganization) {
    try {
      const listed: Array<AwsOrganizationAccount> =
        await listAwsOrganizationAccounts({
          transport,
          credentials: ownCredentials,
          region: homeRegion,
          now: options.now,
          timeoutInMs: options.requestTimeoutInMs,
          sleep: options.sleep,
          budget,
        });
      const tooMany: string | null = getOrganizationLimitWarning({
        total: listed.length,
        noun: "accounts",
      });

      if (tooMany) {
        result.warnings.push(tooMany);
        result.complete = false;
      }

      for (const account of listed.slice(0, AWS_MAX_ORGANIZATION_ACCOUNTS)) {
        accounts.push({
          id: account.id,
          name: account.name,
          settings: connector.settingsForAccount(settings, account.id),
        });
      }
    } catch (error) {
      if (isAuthentication(error)) {
        throw error;
      }

      result.complete = false;

      if (error instanceof CloudReadBudgetSpent) {
        result.warnings.push(
          "The read reached its limit for this run before every data store was read.",
        );
        return result;
      }

      result.warnings.push(
        isRefusal(error)
          ? `${subject} may not call organizations:ListAccounts: only the management account was read. Run the setup command again to allow it.`
          : `Could not list the organization's accounts (${messageOf(error)}): only the management account was read.`,
      );
    }
  }

  if (accounts.length === 0) {
    const identity: AwsCallerIdentity = await getCallerIdentity({
      transport,
      credentials: ownCredentials,
      region: homeRegion,
      now: options.now,
      timeoutInMs: options.requestTimeoutInMs,
      budget,
    });

    accounts.push({
      id: identity.account,
      name: "",
      settings,
      credentials: ownCredentials,
    });
  }

  const internal: Set<string> = new Set<string>(
    [
      ...options.connectedAccountIds,
      ...accounts.map((account: AccountToRead): string => {
        return account.id;
      }),
    ]
      .map((account: string): string => {
        return account.trim();
      })
      .filter(isAccountId),
  );

  for (const account of accounts) {
    const label: string = account.name || account.id;

    if (budget.isSpent()) {
      result.complete = false;
      result.warnings.push(
        "The read reached its limit for this run before every data store was read.",
      );
      break;
    }

    let credentials: AwsCredentials | undefined = account.credentials;

    if (!credentials) {
      try {
        credentials = await connector.getCredentials(
          account.settings,
          callOptions,
        );
      } catch (error) {
        result.complete = false;

        if (error instanceof CloudReadBudgetSpent) {
          continue;
        }

        result.warnings.push(
          error instanceof LlmProviderError &&
            (isAuthentication(error) || isRefusal(error))
            ? `Could not sign in to ${label} (${account.id}): its role is not there yet, or does not trust this OneUptime. The setup command's StackSet adds it to every account.`
            : `Could not read ${label} (${account.id}): ${messageOf(error)}`,
        );
        continue;
      }
    }

    const notes: AccountNotes = new AccountNotes(subject);
    const ctx: AccountContext = {
      accountId: account.id,
      partition: getAwsPartition(homeRegion),
      homeRegion,
      readAt,
      credentials,
      transport,
      now: options.now,
      sleep: options.sleep,
      timeoutInMs: options.requestTimeoutInMs,
      budget,
      internal,
      regions: named.length > 0 ? named : [...AWS_DEFAULT_REGIONS],
      regionsNamed: named.length > 0,
      notes,
      managedKeys: new Map(),
      reached: new Set<string>(),
    };

    try {
      result.stores.push(...(await readAccount(ctx)));
    } catch (error) {
      // One account of an organization that cannot be read: the others are.
      if (!isOrganization) {
        throw error;
      }

      result.complete = false;
      result.warnings.push(
        `Could not read ${label} (${account.id}): ${messageOf(error)}`,
      );
      continue;
    }

    const prefix: string = isOrganization ? `${label}: ` : "";

    result.warnings.push(
      ...notes.warnings().map((warning: string): string => {
        return `${prefix}${warning}`;
      }),
    );

    if (notes.incomplete || notes.budgetSpent) {
      result.complete = false;
    }
  }

  result.warnings = Array.from(new Set(result.warnings)).slice(0, MAX_WARNINGS);
  return result;
}

/*
 * ---------------------------------------------------------------------
 * One bucket's content, for the content scanner.
 * ---------------------------------------------------------------------
 */

// S3's bucket names: 3 to 63 lowercase letters, digits, dots and hyphens.
export function isS3BucketName(name: string): boolean {
  if (name.length < 3 || name.length > 63) {
    return false;
  }

  for (const character of name) {
    const allowed: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "0" && character <= "9") ||
      character === "." ||
      character === "-";

    if (!allowed) {
      return false;
    }
  }

  return true;
}

/*
 * A key as ListObjectsV2 writes it with encoding-type=url: percent-encoded,
 * a space as "+". Kept as written when it does not decode.
 */
function decodeS3Key(encoded: string): string {
  try {
    return decodeURIComponent(encoded.split("+").join(" "));
  } catch {
    return encoded;
  }
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

export function createAwsObjectStoreReader(
  settings: CloudConnectionSettings,
  options: {
    connectionId: ObjectID;
    bucket: string;
    region: string;
    accountNumber: string;
    transport?: CloudConnectorTransport | undefined;
    budget?: CloudReadBudget | undefined;
    now?: (() => Date) | undefined;
    sleep?: ((milliseconds: number) => Promise<void>) | undefined;
    requestTimeoutInMs?: number | undefined;
  },
): ObjectStoreReader {
  const bucket: string = options.bucket.trim();
  const region: string = options.region.trim().toLowerCase();

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

  const connector: AwsCloudConnector = new AwsCloudConnector();
  // A member account's bucket is read through that account's own role.
  const accountSettings: CloudConnectionSettings =
    connector.isOrganization(settings) && isAccountId(options.accountNumber)
      ? connector.settingsForAccount(settings, options.accountNumber)
      : settings;
  const transport: CloudConnectorTransport =
    options.transport || DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch);
  const send: (data: {
    path: string;
    query?: Dictionary<string> | undefined;
    headers?: Dictionary<string> | undefined;
    maxBodyBytes?: number | undefined;
    keepBytes?: boolean | undefined;
    step: string;
  }) => Promise<AwsRestResponse> = async (data: {
    path: string;
    query?: Dictionary<string> | undefined;
    headers?: Dictionary<string> | undefined;
    maxBodyBytes?: number | undefined;
    keepBytes?: boolean | undefined;
    step: string;
  }): Promise<AwsRestResponse> => {
    const credentials: AwsCredentials = await connector.getCredentials(
      accountSettings,
      {
        transport,
        now: options.now,
        sleep: options.sleep,
        requestTimeoutInMs: options.requestTimeoutInMs,
        connectionId: options.connectionId.toString(),
        budget: options.budget,
      },
    );

    return await sendAwsRestRequest({
      transport,
      credentials,
      service: "s3",
      region,
      path: data.path,
      query: data.query,
      headers: data.headers,
      maxBodyBytes: data.maxBodyBytes,
      keepBytes: data.keepBytes,
      step: data.step,
      providerTitle: S3_TITLE,
      now: options.now,
      timeoutInMs: options.requestTimeoutInMs,
      sleep: options.sleep,
      budget: options.budget,
    });
  };

  return {
    description: `s3://${bucket}`,

    listObjects: async (list: {
      prefix?: string | undefined;
      nextToken?: string | undefined;
      maxKeys: number;
    }): Promise<ObjectStoreListPage> => {
      const maxKeys: number = Math.min(
        MAX_LIST_KEYS,
        Math.max(1, Math.floor(list.maxKeys) || 1),
      );
      const query: Dictionary<string> = {
        "list-type": "2",
        "max-keys": String(maxKeys),
        "encoding-type": "url",
      };

      if (list.prefix) {
        query["prefix"] = list.prefix;
      }

      if (list.nextToken) {
        query["continuation-token"] = list.nextToken;
      }

      const answer: AwsRestResponse = await send({
        path: `/${bucket}`,
        query,
        step: "object list request",
      });
      const encoded: boolean = xmlFirst(answer.text, "EncodingType") === "url";
      const objects: Array<ObjectStoreObject> = [];

      for (const item of readXmlTags(answer.text, "Contents")) {
        const written: string = xmlField(item, "Key");
        const key: string = encoded ? decodeS3Key(written) : written;
        const storageClass: string = xmlField(
          item,
          "StorageClass",
        ).toUpperCase();

        if (!key || UNREADABLE_STORAGE_CLASSES.includes(storageClass)) {
          continue;
        }

        const modified: number = Date.parse(xmlField(item, "LastModified"));
        const etag: string = unquote(xmlField(item, "ETag"));

        objects.push({
          key,
          sizeInBytes: readCount(xmlField(item, "Size")),
          lastModified: Number.isFinite(modified)
            ? new Date(modified)
            : undefined,
          etag: etag || undefined,
        });
      }

      const next: string = xmlFirst(answer.text, "NextContinuationToken");
      const truncated: boolean =
        readFlag(xmlFirst(answer.text, "IsTruncated")) === true;

      return { objects, nextToken: truncated && next ? next : undefined };
    },

    readObjectStart: async (
      key: string,
      maxBytes: number,
    ): Promise<Uint8Array> => {
      const limit: number = Math.min(
        OBJECT_READ_MAX_BYTES,
        Math.floor(maxBytes),
      );

      if (!(limit > 0)) {
        return new Uint8Array(0);
      }

      /*
       * A URL's "." and ".." parts are folded away before it is sent, so such
       * a key would read another object: it is not read at all.
       */
      if (
        !key ||
        key.split("/").some((segment: string): boolean => {
          return segment === "." || segment === "..";
        })
      ) {
        throw new BadDataException(
          `The object "${key.slice(0, 100)}" has a "." or ".." in its key and is not read.`,
        );
      }

      try {
        // The object's bytes as stored: a gzip or a spreadsheet is not text.
        const answer: AwsRestResponse = await send({
          path: `/${bucket}/${key}`,
          headers: { Range: `bytes=0-${limit - 1}` },
          maxBodyBytes: limit,
          keepBytes: true,
          step: "object read request",
        });

        return answer.bytes.length > limit
          ? answer.bytes.subarray(0, limit)
          : answer.bytes;
      } catch (error) {
        // An empty object has no first byte for a range to start at.
        if (
          error instanceof LlmProviderError &&
          (error.statusCode === 416 ||
            awsErrorCodeOf(error.responseBody || "") === "InvalidRange")
        ) {
          return new Uint8Array(0);
        }

        throw error;
      }
    },
  };
}
