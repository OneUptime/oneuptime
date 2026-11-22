import { AwsWafScope } from "../../../../Types/CloudConnection/AwsWafBlocklist";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DataSourceHttpFetch from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  readArray,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CLOUD_DEFAULT_SLEEP,
  CloudConnectionSettings,
  CloudConnectorTransport,
  CloudReadBudget,
} from "../CloudConnectorTypes";
import { AwsCredentials, awsErrorCodeOf, sendAwsRequest } from "./AwsApi";
import AwsCloudConnector from "./AwsCloudConnector";

/*
 * AWS WAF THROUGH A CLOUD CONNECTION (#10344): the calls the blocklist makes
 * of an account's AWS WAF - WAFV2's JSON 1.1 API, target AWSWAF_20190729,
 * signed for "wafv2" in the web ACL's Region (us-east-1 for CloudFront's,
 * scope CLOUDFRONT) - with the connection's own sign-in: its access key, or
 * its role through AwsCloudConnector.getCredentials, the one way into a
 * customer's account (AwsSts.assumeRole checks the role's external id
 * first, #10405). Nothing else in OneUptime calls AWS WAF.
 *
 * What each call needs is granted by the connection's setup command when
 * Block addresses in AWS WAF is on (CloudConnectionSetupCommands,
 * OneUptimeWafBlocklist); GetWebACL by its read-only policy. A refusal says
 * which permission is missing and where it is granted (explainRefusal),
 * and every call names its IAM action so CloudConnectionCommandNeeds holds
 * the grant to what is called.
 *
 * AWS WAF's own rules, kept here:
 *
 *   - Writes take the lock token of the read before them; a stale one is
 *     refused with WAFOptimisticLockException, and the caller reads again
 *     (AwsWafBlocklist). Sent again after a failure for now, a write with
 *     a lock token cannot do its work twice - its token is spent - so each
 *     says it is safe to repeat (AwsRetry).
 *   - One Create, Update or Delete of a kind a second per account and
 *     Region, five Gets and Lists: writes of a kind are spaced a little over
 *     a second apart in a session, and a throttle (ThrottlingException) is
 *     waited out as every AWS call's is.
 *   - UpdateWebACL replaces the whole web ACL: what GetWebACL answered is
 *     sent back but for its read-only members, so a setting OneUptime does
 *     not know of is kept, never dropped.
 */

const WAF_SERVICE: string = "wafv2";
const WAF_TARGET_PREFIX: string = "AWSWAF_20190729";
export const AWS_WAF_PROVIDER_TITLE: string = "AWS WAF";

// The pages of one list read at most: 2,000 IP sets, twenty times AWS's quota.
export const AWS_WAF_MAX_LIST_PAGES: number = 20;
const LIST_PAGE_SIZE: number = 100;

/*
 * How far apart two writes of a kind are sent: AWS WAF takes one Create,
 * Update or Delete of a kind a second, per account and Region.
 */
export const AWS_WAF_WRITE_SPACING_MS: number = 1100;

const WRITE_ACTIONS: ReadonlyArray<string> = [
  "CreateIPSet",
  "UpdateIPSet",
  "DeleteIPSet",
  "UpdateWebACL",
];

/*
 * A run's bounds when the caller gives none: a sign-in, the lists and reads
 * of four IP sets and a web ACL, their writes, and the reads after them,
 * with room for a lock race and a throttle or two.
 */
const DEFAULT_MAX_REQUESTS: number = 80;
const DEFAULT_MAX_DURATION_MS: number = 150 * 1000;

/*
 * The members of a web ACL GetWebACL answers and UpdateWebACL does not
 * take: what AWS works out (its ARN, capacity, label namespace) and what
 * Firewall Manager owns.
 */
export const AWS_WAF_WEB_ACL_READ_ONLY_MEMBERS: ReadonlyArray<string> = [
  "ARN",
  "Capacity",
  "LabelNamespace",
  "ManagedByFirewallManager",
  "PreProcessFirewallManagerRuleGroups",
  "PostProcessFirewallManagerRuleGroups",
  "RetrofittedByFirewallManager",
];

// AWS WAF's error codes the blocklist acts on.
export enum AwsWafErrorCode {
  OptimisticLock = "WAFOptimisticLockException",
  LimitsExceeded = "WAFLimitsExceededException",
  Nonexistent = "WAFNonexistentItemException",
  Duplicate = "WAFDuplicateItemException",
  Unavailable = "WAFUnavailableEntityException",
  Associated = "WAFAssociatedItemException",
}

// The code AWS WAF answered a failed call with, or "".
export function getAwsWafErrorCode(error: unknown): string {
  return error instanceof LlmProviderError
    ? awsErrorCodeOf(error.responseBody || "")
    : "";
}

export function isAwsWafError(error: unknown, code: AwsWafErrorCode): boolean {
  return getAwsWafErrorCode(error) === code;
}

// One run's way into one account's AWS WAF, in one scope and Region.
export interface AwsWafSession {
  transport: CloudConnectorTransport;
  credentials: AwsCredentials;
  budget: CloudReadBudget;
  now?: (() => Date) | undefined;
  sleep: (milliseconds: number) => Promise<void>;
  accountId: string;
  region: string;
  scope: AwsWafScope;
  // "The role" or "The access key": who a refusal is about.
  subject: string;
  // When each kind of write was last sent, for the one-a-second spacing.
  lastWriteAt: Map<string, number>;
}

export interface AwsWafCallOptions {
  transport?: CloudConnectorTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  budget?: CloudReadBudget | undefined;
}

/*
 * Signs in to the account a web ACL is in: the connection's own account,
 * or - for a connection that reads an organization - the member account's
 * role, by the name the organization's StackSet gave it.
 */
export async function openAwsWafSession(
  settings: CloudConnectionSettings,
  options: AwsWafCallOptions & {
    connectionId: ObjectID;
    accountId: string;
    region: string;
    scope: AwsWafScope;
  },
): Promise<AwsWafSession> {
  const connector: AwsCloudConnector = new AwsCloudConnector();

  connector.validateSettings(settings);

  const accountSettings: CloudConnectionSettings =
    connector.isOrganization(settings) && options.accountId
      ? connector.settingsForAccount(settings, options.accountId)
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
    sleep: options.sleep || CLOUD_DEFAULT_SLEEP,
    accountId: options.accountId,
    region: options.region,
    scope: options.scope,
    subject:
      connector.getAuthMethod(settings) === CloudConnectionAuthMethod.AwsRole
        ? "The role"
        : "The access key",
    lastWriteAt: new Map(),
  };
}

/*
 * A refusal, said with what grants the permission: the blocklist's setting
 * on the connection, and its setup command run again. Any other failure as
 * AWS answered it.
 */
export function explainAwsWafRefusal(
  error: unknown,
  data: { subject: string; action: string; what: string },
): unknown {
  if (
    !(error instanceof LlmProviderError) ||
    error.kind !== CloudConnectionFailureKind.Permission
  ) {
    return error;
  }

  const fix: string =
    data.action === "wafv2:UpdateWebACL"
      ? 'Pick "On, and OneUptime adds its rule" under Block addresses in AWS WAF for the connection and run its setup command again, or add the rule to the web ACL in code.'
      : data.action === "wafv2:GetWebACL"
        ? "Run the connection's setup command again: its read-only policy grants it."
        : "Turn on Block addresses in AWS WAF for the connection, and run its setup command again.";

  return new LlmProviderError({
    message: `AWS refused ${data.action} on ${data.what}: ${data.subject.toLowerCase()} may not call it. ${fix}`,
    kind: CloudConnectionFailureKind.Permission,
    statusCode: error.statusCode,
    responseBody: error.responseBody,
  });
}

function now(session: AwsWafSession): number {
  return (session.now ? session.now() : new Date()).getTime();
}

// Waits until a write of this kind may be sent, and notes that it is.
async function spaceWrite(
  session: AwsWafSession,
  operation: string,
): Promise<void> {
  if (!WRITE_ACTIONS.includes(operation)) {
    return;
  }

  const last: number | undefined = session.lastWriteAt.get(operation);

  if (last !== undefined) {
    const wait: number = last + AWS_WAF_WRITE_SPACING_MS - now(session);

    if (wait > 0) {
      await session.sleep(wait);
    }
  }

  session.lastWriteAt.set(operation, now(session));
}

// One call of AWS WAF's API, named by its IAM action for a refusal's words.
async function callAwsWaf(
  session: AwsWafSession,
  data: {
    operation: string;
    iamAction: string;
    body: JSONObject;
    // What it is about, as a refusal names it: "IP set oneuptime-...-block-ipv4".
    what: string;
    isSafeToRepeat?: boolean | undefined;
  },
): Promise<JSONObject> {
  await spaceWrite(session, data.operation);

  try {
    const answer: { json: JSONObject } = await sendAwsRequest({
      transport: session.transport,
      credentials: session.credentials,
      service: WAF_SERVICE,
      region: session.region,
      target: `${WAF_TARGET_PREFIX}.${data.operation}`,
      jsonVersion: "1.1",
      body: data.body,
      step: `${data.operation} request in ${session.region}`,
      providerTitle: AWS_WAF_PROVIDER_TITLE,
      now: session.now,
      sleep: session.sleep,
      budget: session.budget,
      isSafeToRepeat: data.isSafeToRepeat,
    });

    return answer.json;
  } catch (error) {
    throw explainAwsWafRefusal(error, {
      subject: session.subject,
      action: data.iamAction,
      what: data.what,
    });
  }
}

// ---------- IP sets ----------

export interface AwsWafIpSetSummary {
  name: string;
  id: string;
  arn: string;
}

export interface AwsWafIpSet extends AwsWafIpSetSummary {
  description: string;
  ipAddressVersion: string;
  // The CIDRs it holds, as AWS answered them.
  addresses: Array<string>;
  lockToken: string;
}

function readSummary(value: unknown): AwsWafIpSetSummary | null {
  const summary: JSONObject = readObject(value);
  const name: string = readText(summary["Name"]);
  const id: string = readText(summary["Id"]);
  const arn: string = readText(summary["ARN"]);

  return name && id && arn ? { name, id, arn } : null;
}

/*
 * Every IP set of the scope and Region, page by page. Listing names no
 * resource, so it lists the customer's sets too; the blocklist reads only
 * its own by name. Complete only when the last page was read.
 */
export async function listAwsWafIpSets(
  session: AwsWafSession,
): Promise<{ sets: Array<AwsWafIpSetSummary>; isComplete: boolean }> {
  const sets: Array<AwsWafIpSetSummary> = [];
  let marker: string = "";

  for (let page: number = 0; page < AWS_WAF_MAX_LIST_PAGES; page++) {
    const answer: JSONObject = await callAwsWaf(session, {
      operation: "ListIPSets",
      iamAction: "wafv2:ListIPSets",
      body: {
        Scope: session.scope,
        Limit: LIST_PAGE_SIZE,
        ...(marker ? { NextMarker: marker } : {}),
      },
      what: `the IP sets of ${session.region}`,
    });

    for (const item of readArray(answer["IPSets"])) {
      const summary: AwsWafIpSetSummary | null = readSummary(item);

      if (summary) {
        sets.push(summary);
      }
    }

    const next: string = readText(answer["NextMarker"]);

    if (!next || next === marker) {
      return { sets, isComplete: true };
    }

    marker = next;
  }

  return { sets, isComplete: false };
}

export async function getAwsWafIpSet(
  session: AwsWafSession,
  set: AwsWafIpSetSummary,
): Promise<AwsWafIpSet> {
  const answer: JSONObject = await callAwsWaf(session, {
    operation: "GetIPSet",
    iamAction: "wafv2:GetIPSet",
    body: { Name: set.name, Scope: session.scope, Id: set.id },
    what: `IP set ${set.name}`,
  });
  const ipSet: JSONObject = readObject(answer["IPSet"]);

  return {
    name: readText(ipSet["Name"]) || set.name,
    id: readText(ipSet["Id"]) || set.id,
    arn: readText(ipSet["ARN"]) || set.arn,
    description: readText(ipSet["Description"]),
    ipAddressVersion: readText(ipSet["IPAddressVersion"]),
    addresses: readArray(ipSet["Addresses"])
      .map((address: unknown): string => {
        return readText(address).trim();
      })
      .filter((address: string): boolean => {
        return address.length > 0;
      }),
    lockToken: readText(answer["LockToken"]),
  };
}

export async function createAwsWafIpSet(
  session: AwsWafSession,
  data: {
    name: string;
    description: string;
    ipAddressVersion: string;
    addresses: Array<string>;
  },
): Promise<AwsWafIpSetSummary> {
  const answer: JSONObject = await callAwsWaf(session, {
    operation: "CreateIPSet",
    iamAction: "wafv2:CreateIPSet",
    body: {
      Name: data.name,
      Scope: session.scope,
      Description: data.description,
      IPAddressVersion: data.ipAddressVersion,
      Addresses: data.addresses,
    },
    what: `IP set ${data.name}`,
    // Sent twice, the second is a duplicate, which the caller reads as made.
    isSafeToRepeat: true,
  });
  const summary: AwsWafIpSetSummary | null = readSummary(answer["Summary"]);

  if (!summary) {
    throw new LlmProviderError({
      message: `AWS WAF created IP set ${data.name} without saying its ARN.`,
      kind: CloudConnectionFailureKind.Other,
    });
  }

  return summary;
}

// Replaces the set's addresses whole; the token it hands back is the next write's.
export async function updateAwsWafIpSet(
  session: AwsWafSession,
  data: {
    set: AwsWafIpSetSummary;
    description: string;
    addresses: Array<string>;
    lockToken: string;
  },
): Promise<string> {
  const answer: JSONObject = await callAwsWaf(session, {
    operation: "UpdateIPSet",
    iamAction: "wafv2:UpdateIPSet",
    body: {
      Name: data.set.name,
      Scope: session.scope,
      Id: data.set.id,
      ...(data.description ? { Description: data.description } : {}),
      Addresses: data.addresses,
      LockToken: data.lockToken,
    },
    what: `IP set ${data.set.name}`,
    isSafeToRepeat: true,
  });

  return readText(answer["NextLockToken"]);
}

export async function deleteAwsWafIpSet(
  session: AwsWafSession,
  data: { set: AwsWafIpSetSummary; lockToken: string },
): Promise<void> {
  await callAwsWaf(session, {
    operation: "DeleteIPSet",
    iamAction: "wafv2:DeleteIPSet",
    body: {
      Name: data.set.name,
      Scope: session.scope,
      Id: data.set.id,
      LockToken: data.lockToken,
    },
    what: `IP set ${data.set.name}`,
    isSafeToRepeat: true,
  });
}

// ---------- Web ACLs ----------

export interface AwsWafWebAclRef {
  name: string;
  id: string;
  arn: string;
}

export interface AwsWafWebAcl {
  // As GetWebACL answered it, every member.
  webAcl: JSONObject;
  lockToken: string;
}

export async function getAwsWafWebAcl(
  session: AwsWafSession,
  webAcl: AwsWafWebAclRef,
): Promise<AwsWafWebAcl> {
  const answer: JSONObject = await callAwsWaf(session, {
    operation: "GetWebACL",
    iamAction: "wafv2:GetWebACL",
    body: { Name: webAcl.name, Scope: session.scope, Id: webAcl.id },
    what: `web ACL ${webAcl.name}`,
  });

  return {
    webAcl: readObject(answer["WebACL"]),
    lockToken: readText(answer["LockToken"]),
  };
}

/*
 * The web ACL as UpdateWebACL takes it: every member GetWebACL answered
 * but the read-only ones, with its rules as given, its scope and the lock
 * token of the read.
 */
export function getAwsWafWebAclUpdateBody(data: {
  webAcl: JSONObject;
  rules: Array<JSONObject>;
  scope: AwsWafScope;
  lockToken: string;
}): JSONObject {
  const body: JSONObject = {};

  for (const [member, value] of Object.entries(data.webAcl)) {
    if (!AWS_WAF_WEB_ACL_READ_ONLY_MEMBERS.includes(member)) {
      body[member] = value as JSONValue;
    }
  }

  body["Scope"] = data.scope;
  body["Rules"] = data.rules;
  body["LockToken"] = data.lockToken;

  return body;
}

export async function updateAwsWafWebAcl(
  session: AwsWafSession,
  data: {
    webAcl: AwsWafWebAcl;
    rules: Array<JSONObject>;
    name: string;
  },
): Promise<string> {
  const answer: JSONObject = await callAwsWaf(session, {
    operation: "UpdateWebACL",
    iamAction: "wafv2:UpdateWebACL",
    body: getAwsWafWebAclUpdateBody({
      webAcl: data.webAcl.webAcl,
      rules: data.rules,
      scope: session.scope,
      lockToken: data.webAcl.lockToken,
    }),
    what: `web ACL ${data.name}`,
    isSafeToRepeat: true,
  });

  return readText(answer["NextLockToken"]);
}

// ---------- Sampled requests ----------

export interface AwsWafSampledRequest {
  // The address the request came from, as the web ACL saw it.
  clientIp: string;
  // Its headers by lower-case name: a forwarded address is read from them.
  headers: Record<string, Array<string>>;
  timestamp: Date | null;
  // What the web ACL did: BLOCK, CHALLENGE, ALLOW, COUNT...
  action: string;
  // How many requests of the sample this one stands for.
  weight: number;
}

/*
 * A sample of the requests one rule matched in a window of the last three
 * hours (AWS WAF keeps no more), at most maxItems of them: the evidence a
 * block holds. The rule must sample requests (its VisibilityConfig), as
 * OneUptime's rules do.
 */
export async function getAwsWafSampledRequests(
  session: AwsWafSession,
  data: {
    webAclArn: string;
    webAclName: string;
    ruleMetricName: string;
    from: Date;
    to: Date;
    maxItems: number;
  },
): Promise<Array<AwsWafSampledRequest>> {
  const answer: JSONObject = await callAwsWaf(session, {
    operation: "GetSampledRequests",
    iamAction: "wafv2:GetSampledRequests",
    body: {
      WebAclArn: data.webAclArn,
      RuleMetricName: data.ruleMetricName,
      Scope: session.scope,
      TimeWindow: {
        StartTime: Math.floor(data.from.getTime() / 1000),
        EndTime: Math.floor(data.to.getTime() / 1000),
      },
      MaxItems: Math.max(1, Math.min(500, Math.floor(data.maxItems))),
    },
    what: `web ACL ${data.webAclName}`,
  });

  return readArray(answer["SampledRequests"]).map(
    (raw: unknown): AwsWafSampledRequest => {
      const sample: JSONObject = readObject(raw);
      const request: JSONObject = readObject(sample["Request"]);
      const headers: Record<string, Array<string>> = {};

      for (const header of readArray(request["Headers"])) {
        const name: string = readText(readObject(header)["Name"])
          .trim()
          .toLowerCase();

        if (name) {
          headers[name] = [
            ...(headers[name] || []),
            readText(readObject(header)["Value"]),
          ];
        }
      }

      const seconds: unknown = sample["Timestamp"];

      return {
        clientIp: readText(request["ClientIP"]).trim(),
        headers,
        timestamp:
          typeof seconds === "number" && Number.isFinite(seconds)
            ? new Date(seconds * 1000)
            : null,
        action: readText(sample["Action"]).toUpperCase(),
        weight:
          typeof sample["Weight"] === "number" ? (sample["Weight"] as number) : 1,
      };
    },
  );
}
