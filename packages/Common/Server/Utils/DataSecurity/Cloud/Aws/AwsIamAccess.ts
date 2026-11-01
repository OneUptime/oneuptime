import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  UNUSED_ACCESS_DAYS,
  isAccessUnused,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import { readXmlChildren } from "../../../CloudConnection/Aws/AwsApi";
import {
  readObject,
  readText,
} from "../../../LlmObservability/LlmProviderHttp";
import {
  describePrincipal,
  hasRestrictingCondition,
  isAccountId,
  policyValues,
  readPrincipals,
  wildcardMatches,
} from "./AwsPolicyGrammar";

/*
 * WHO CAN REACH A STORE THROUGH IAM: the users and roles of an AWS account
 * whose own policies let them read, change or control one of its buckets
 * or tables - which a bucket's policy and ACL alone never say. Most of an
 * account's access to its data is written this way: a role with
 * AmazonS3ReadOnlyAccess attached reads every bucket, and no bucket names
 * it.
 *
 * Read from one listing, IAM's GetAccountAuthorizationDetails: every user,
 * group and role with its inline policies and the managed policies
 * attached to it, each managed policy's default version, each role's trust
 * policy and when it was last used. A user's last use comes from the
 * account's credential report (the newest of its password's and its access
 * keys' last use).
 *
 * An identity reaches a store at the highest level its policies allow:
 *
 *  - Read      s3:GetObject on some object of the bucket; dynamodb:GetItem,
 *              Query or Scan on the table.
 *  - Write     s3:PutObject or DeleteObject; dynamodb:PutItem, UpdateItem,
 *              DeleteItem.
 *  - Admin     s3:PutBucketPolicy, PutBucketAcl or DeleteBucket;
 *              dynamodb:DeleteTable or UpdateTable.
 *
 * as IAM decides: an Allow whose Action (or NotAction) and Resource (or
 * NotResource) cover the call, and no Deny without conditions that covers
 * it; a permissions boundary must allow it too. A Resource that names part
 * of a bucket ("orders/*") reaches it. An Allow held by conditions still
 * reaches it, and says so: a condition OneUptime cannot evaluate - a
 * network, a tag, a time - may narrow it, never widen it. A service
 * control policy, a session policy or a bucket policy's own Deny can
 * narrow what is listed here; the bucket policy's grants are read beside
 * it (AwsDataSecurityReader).
 *
 * A role's trust policy says who may become it. An account outside the
 * project's connected ones that may assume a role reaches what the role
 * reaches, and is listed as such - "Can assume role data-exporter" - the
 * access path a bucket's own policy never shows. A trust policy open to
 * any AWS account, with nothing holding it to known callers, makes the
 * role's data public.
 *
 * Left out: AWS's service-linked roles (/aws-service-role/), which only an
 * AWS service can use, and AWS services named as principals.
 *
 * Patterns are the customer's own, so they are read with IAM's wildcards
 * (AwsPolicyGrammar), never as regular expressions; every listing is
 * bounded.
 */

// A managed or inline policy's statements, with the name a person knows it by.
export interface IamPolicy {
  // "AmazonS3ReadOnlyAccess", "inline policy data-reader".
  name: string;
  statements: Array<JSONObject>;
}

export enum IamIdentityKind {
  User = "user",
  Role = "role",
}

export interface IamIdentity {
  kind: IamIdentityKind;
  arn: string;
  name: string;
  path: string;
  createdAt?: Date | undefined;
  // Every policy that applies: its own, attached ones and (a user's) its groups'.
  policies: Array<{ policy: IamPolicy; via: string }>;
  // The permissions boundary's statements; null when it could not be read.
  boundary?: Array<JSONObject> | null | undefined;
  // A role's trust policy: who may assume it.
  trustStatements: Array<JSONObject>;
  lastUsedAt?: Date | undefined;
  // IAM records the identity's use, and it has not been used since it was created.
  hasNoRecordedUse: boolean;
}

export interface IamAuthorization {
  identities: Array<IamIdentity>;
  // Managed policies attached somewhere whose documents the listing left out.
  unreadPolicyArns: Array<string>;
  // Whether every page of the listing was read.
  complete: boolean;
}

// A store an identity may reach: a bucket or a table, by its ARN.
export interface IamStoreTarget {
  kind: DataStoreKind;
  arn: string;
}

// What an identity's policies let it do to one store.
export interface IamReach {
  level: DataStoreAccessLevel;
  // The policy that grants the level: "AmazonS3ReadOnlyAccess".
  via: string;
  // The grant holds only under conditions OneUptime does not evaluate.
  isConditional: boolean;
}

// The kinds whose reach is read from IAM.
export const IAM_READ_STORE_KINDS: ReadonlyArray<DataStoreKind> = [
  DataStoreKind.AwsS3Bucket,
  DataStoreKind.AwsDynamoDbTable,
];

// The most identities one account's listing holds; pages listed, and their size.
export const MAX_IAM_IDENTITIES: number = 5000;
export const MAX_IAM_PAGES: number = 40;
export const IAM_PAGE_SIZE: number = 500;

// The most identities listed for one store from IAM: the highest levels first.
export const MAX_IAM_ENTRIES_PER_STORE: number = 200;

// The longest "granted via" text an entry keeps (DataStoreAccess.grantedVia).
const MAX_VIA_LENGTH: number = 500;

// How far back IAM tracks a role's last use: an empty RoleLastUsed means not in this window.
export const IAM_LAST_USED_WINDOW_IN_DAYS: number = 400;

type ResourceShape = "bucket" | "object" | "table";

interface ActionSample {
  action: string;
  shape: ResourceShape;
}

interface LevelSamples {
  level: DataStoreAccessLevel;
  samples: Array<ActionSample>;
}

// The calls that mean each level, from the highest down, for each kind.
const LEVELS_BY_KIND: Readonly<
  Partial<Record<DataStoreKind, Array<LevelSamples>>>
> = {
  [DataStoreKind.AwsS3Bucket]: [
    {
      level: DataStoreAccessLevel.Admin,
      samples: [
        { action: "s3:PutBucketPolicy", shape: "bucket" },
        { action: "s3:PutBucketAcl", shape: "bucket" },
        { action: "s3:DeleteBucket", shape: "bucket" },
      ],
    },
    {
      level: DataStoreAccessLevel.Write,
      samples: [
        { action: "s3:PutObject", shape: "object" },
        { action: "s3:DeleteObject", shape: "object" },
      ],
    },
    {
      level: DataStoreAccessLevel.Read,
      samples: [{ action: "s3:GetObject", shape: "object" }],
    },
  ],
  [DataStoreKind.AwsDynamoDbTable]: [
    {
      level: DataStoreAccessLevel.Admin,
      samples: [
        { action: "dynamodb:DeleteTable", shape: "table" },
        { action: "dynamodb:UpdateTable", shape: "table" },
      ],
    },
    {
      level: DataStoreAccessLevel.Write,
      samples: [
        { action: "dynamodb:PutItem", shape: "table" },
        { action: "dynamodb:UpdateItem", shape: "table" },
        { action: "dynamodb:DeleteItem", shape: "table" },
      ],
    },
    {
      level: DataStoreAccessLevel.Read,
      samples: [
        { action: "dynamodb:GetItem", shape: "table" },
        { action: "dynamodb:Query", shape: "table" },
        { action: "dynamodb:Scan", shape: "table" },
      ],
    },
  ],
};

// The actions of a trust policy that let a principal become the role.
const ASSUME_ROLE_ACTIONS: Array<string> = [
  "sts:AssumeRole",
  "sts:AssumeRoleWithSAML",
  "sts:AssumeRoleWithWebIdentity",
];

/*
 * ---------------------------------------------------------------------
 * Reading the listing.
 * ---------------------------------------------------------------------
 */

// A policy document as IAM writes it in XML answers: URL-encoded JSON.
export function decodePolicyDocument(text: string): JSONObject | null {
  const raw: string = (text || "").trim();

  if (!raw) {
    return null;
  }

  let decoded: string = raw;

  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Not URL-encoded after all: read it as it is.
  }

  try {
    const parsed: unknown = JSON.parse(decoded);

    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as JSONObject)
      : null;
  } catch {
    return null;
  }
}

// A policy document's statements, each an object; one statement or a list.
export function statementsOf(document: JSONObject | null): Array<JSONObject> {
  if (!document) {
    return [];
  }

  const raw: unknown = document["Statement"];

  return (Array.isArray(raw) ? raw : [raw])
    .map((statement: unknown): JSONObject => {
      return readObject(statement);
    })
    .filter((statement: JSONObject): boolean => {
      return Object.keys(statement).length > 0;
    });
}

function child(block: string, tag: string): string {
  return readXmlChildren(block, tag)[0] || "";
}

function members(block: string, list: string): Array<string> {
  return readXmlChildren(child(block, list), "member");
}

function readDate(text: string): Date | undefined {
  const value: string = (text || "").trim();

  if (!value) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : undefined;
}

// An identity's inline policies, by the name it gives each.
function inlinePolicies(block: string, list: string): Array<IamPolicy> {
  return members(block, list).map((member: string): IamPolicy => {
    return {
      name: `inline policy ${child(member, "PolicyName") || "(unnamed)"}`,
      statements: statementsOf(
        decodePolicyDocument(child(member, "PolicyDocument")),
      ),
    };
  });
}

// The ARNs of the managed policies attached to an identity or group.
function attachedPolicyArns(block: string): Array<string> {
  return members(block, "AttachedManagedPolicies")
    .map((member: string): string => {
      return child(member, "PolicyArn");
    })
    .filter((arn: string): boolean => {
      return Boolean(arn);
    });
}

// A managed policy's ARN as its name: arn:aws:iam::aws:policy/ReadOnlyAccess -> ReadOnlyAccess.
export function managedPolicyName(arn: string): string {
  return arn.split("/").pop() || arn;
}

interface RawGroup {
  name: string;
  inline: Array<IamPolicy>;
  attached: Array<string>;
}

interface RawIdentity {
  kind: IamIdentityKind;
  arn: string;
  name: string;
  path: string;
  createdAt?: Date | undefined;
  inline: Array<IamPolicy>;
  attached: Array<string>;
  groups: Array<string>;
  boundaryArn: string;
  trust: Array<JSONObject>;
  lastUsedAt?: Date | undefined;
}

/*
 * Every page of GetAccountAuthorizationDetails, read into identities with
 * the policies that apply to each. A user's groups' policies are its own;
 * a managed policy is read at its default version.
 */
export function readAuthorizationDetails(
  pages: Array<string>,
  options: { now: Date; complete: boolean },
): IamAuthorization {
  const groups: Map<string, RawGroup> = new Map();
  const raw: Array<RawIdentity> = [];
  const documents: Map<string, IamPolicy> = new Map();

  for (const page of pages) {
    const result: string =
      readXmlChildren(
        child(page, "GetAccountAuthorizationDetailsResponse") || page,
        "GetAccountAuthorizationDetailsResult",
      )[0] || "";

    for (const member of members(result, "GroupDetailList")) {
      const name: string = child(member, "GroupName");

      if (name) {
        groups.set(name, {
          name,
          inline: inlinePolicies(member, "GroupPolicyList"),
          attached: attachedPolicyArns(member),
        });
      }
    }

    for (const member of members(result, "UserDetailList")) {
      const arn: string = child(member, "Arn");

      if (!arn) {
        continue;
      }

      raw.push({
        kind: IamIdentityKind.User,
        arn,
        name: child(member, "UserName") || managedPolicyName(arn),
        path: child(member, "Path") || "/",
        createdAt: readDate(child(member, "CreateDate")),
        inline: inlinePolicies(member, "UserPolicyList"),
        attached: attachedPolicyArns(member),
        groups: members(member, "GroupList").filter((group: string) => {
          return Boolean(group);
        }),
        boundaryArn: child(
          child(member, "PermissionsBoundary"),
          "PermissionsBoundaryArn",
        ),
        trust: [],
      });
    }

    for (const member of members(result, "RoleDetailList")) {
      const arn: string = child(member, "Arn");

      if (!arn) {
        continue;
      }

      raw.push({
        kind: IamIdentityKind.Role,
        arn,
        name: child(member, "RoleName") || managedPolicyName(arn),
        path: child(member, "Path") || "/",
        createdAt: readDate(child(member, "CreateDate")),
        inline: inlinePolicies(member, "RolePolicyList"),
        attached: attachedPolicyArns(member),
        groups: [],
        boundaryArn: child(
          child(member, "PermissionsBoundary"),
          "PermissionsBoundaryArn",
        ),
        trust: statementsOf(
          decodePolicyDocument(child(member, "AssumeRolePolicyDocument")),
        ),
        lastUsedAt: readDate(
          child(child(member, "RoleLastUsed"), "LastUsedDate"),
        ),
      });
    }

    for (const member of members(result, "Policies")) {
      const arn: string = child(member, "Arn");
      const defaultVersion: string = child(member, "DefaultVersionId");

      if (!arn) {
        continue;
      }

      const versions: Array<string> = members(member, "PolicyVersionList");
      const version: string =
        versions.find((candidate: string): boolean => {
          return (
            child(candidate, "IsDefaultVersion").toLowerCase() === "true" ||
            (Boolean(defaultVersion) &&
              child(candidate, "VersionId") === defaultVersion)
          );
        }) || "";

      documents.set(arn, {
        name: child(member, "PolicyName") || managedPolicyName(arn),
        statements: statementsOf(
          decodePolicyDocument(child(version, "Document")),
        ),
      });
    }
  }

  const unread: Set<string> = new Set();
  const policyOf: (arn: string) => IamPolicy | null = (
    arn: string,
  ): IamPolicy | null => {
    const found: IamPolicy | undefined = documents.get(arn);

    if (!found) {
      unread.add(arn);
      return null;
    }

    return found;
  };

  const unusedBefore: number =
    options.now.getTime() - UNUSED_ACCESS_DAYS * 24 * 3600 * 1000;
  const identities: Array<IamIdentity> = [];

  for (const identity of raw.slice(0, MAX_IAM_IDENTITIES)) {
    const policies: Array<{ policy: IamPolicy; via: string }> = [];

    for (const policy of identity.inline) {
      policies.push({ policy, via: policy.name });
    }

    for (const arn of identity.attached) {
      const policy: IamPolicy | null = policyOf(arn);

      if (policy) {
        policies.push({ policy, via: policy.name });
      }
    }

    for (const groupName of identity.groups) {
      const group: RawGroup | undefined = groups.get(groupName);

      if (!group) {
        continue;
      }

      for (const policy of group.inline) {
        policies.push({ policy, via: `group ${group.name}: ${policy.name}` });
      }

      for (const arn of group.attached) {
        const policy: IamPolicy | null = policyOf(arn);

        if (policy) {
          policies.push({
            policy,
            via: `group ${group.name}: ${policy.name}`,
          });
        }
      }
    }

    let boundary: Array<JSONObject> | null | undefined = undefined;

    if (identity.boundaryArn) {
      const policy: IamPolicy | null = policyOf(identity.boundaryArn);
      boundary = policy ? policy.statements : null;
    }

    /*
     * A role IAM records no use of - in the IAM_LAST_USED_WINDOW_IN_DAYS
     * it tracks, or since it was made - that is older than the unused
     * period has not been used in that period, as far as IAM can say. A
     * user's use is the credential report's to say (readCredentialReport).
     */
    const created: Date | undefined = identity.createdAt;

    identities.push({
      kind: identity.kind,
      arn: identity.arn,
      name: identity.name,
      path: identity.path,
      createdAt: created,
      policies,
      boundary,
      trustStatements: identity.trust,
      lastUsedAt: identity.lastUsedAt,
      hasNoRecordedUse:
        identity.kind === IamIdentityKind.Role &&
        !identity.lastUsedAt &&
        Boolean(created) &&
        created!.getTime() < unusedBefore,
    });
  }

  return {
    identities,
    unreadPolicyArns: Array.from(unread).sort(),
    complete: options.complete && raw.length <= MAX_IAM_IDENTITIES,
  };
}

/*
 * The account's credential report (CSV): each user's last use, the newest
 * of its password's and its two access keys', by the user's ARN - and the
 * users that have never used either, made long enough ago to count as
 * unused. The report holds dates and flags only, never a secret.
 */
export interface CredentialReportUse {
  lastUsedAt?: Date | undefined;
  hasNoRecordedUse: boolean;
}

const CREDENTIAL_REPORT_DATE_COLUMNS: Array<string> = [
  "password_last_used",
  "access_key_1_last_used_date",
  "access_key_2_last_used_date",
];

export function readCredentialReport(
  csv: string,
  now: Date,
): Map<string, CredentialReportUse> {
  const uses: Map<string, CredentialReportUse> = new Map();
  const lines: Array<string> = (csv || "")
    .split("\n")
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });

  if (lines.length < 2) {
    return uses;
  }

  const header: Array<string> = lines[0]!.split(",");
  const column: (name: string) => number = (name: string): number => {
    return header.indexOf(name);
  };
  const arnColumn: number = column("arn");
  const createdColumn: number = column("user_creation_time");

  if (arnColumn < 0) {
    return uses;
  }

  const unusedBefore: number =
    now.getTime() - UNUSED_ACCESS_DAYS * 24 * 3600 * 1000;

  for (const line of lines.slice(1, MAX_IAM_IDENTITIES + 1)) {
    const cells: Array<string> = line.split(",");
    const arn: string = cells[arnColumn] || "";

    // The account's root user is not an IAM user a policy can grant to.
    if (!arn || arn.endsWith(":root")) {
      continue;
    }

    let newest: Date | undefined = undefined;

    for (const name of CREDENTIAL_REPORT_DATE_COLUMNS) {
      const index: number = column(name);
      const date: Date | undefined =
        index >= 0 ? readDate(cells[index] || "") : undefined;

      if (date && (!newest || date.getTime() > newest.getTime())) {
        newest = date;
      }
    }

    const created: Date | undefined =
      createdColumn >= 0 ? readDate(cells[createdColumn] || "") : undefined;

    uses.set(arn, {
      lastUsedAt: newest,
      hasNoRecordedUse:
        !newest && Boolean(created) && created!.getTime() < unusedBefore,
    });
  }

  return uses;
}

/*
 * ---------------------------------------------------------------------
 * Deciding what a policy allows.
 * ---------------------------------------------------------------------
 */

/*
 * Whether some value that starts with `prefix` matches `pattern`: a
 * Resource of "arn:aws:s3:::orders/2026/*" reaches the bucket orders, as
 * part of it. IAM's wildcards, case ignored, read with backtracking to the
 * last "*" - linear in practice, and no regular expression: the pattern is
 * the customer's own. Once the prefix is consumed, the rest of the pattern
 * can always be met by what follows it.
 */
export function wildcardMatchesSomeExtension(
  pattern: string,
  prefix: string,
): boolean {
  const p: string = pattern.toLowerCase();
  const v: string = prefix.toLowerCase();
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

  return true;
}

// Whether `pattern` matches every value that starts with `prefix`: "bucket/*" covers the bucket's objects.
export function wildcardCoversEveryExtension(
  pattern: string,
  prefix: string,
): boolean {
  return pattern.endsWith("*") && wildcardMatches(pattern, prefix);
}

// The resource a call is made on, as a statement's Resource is matched against it.
interface CallResource {
  shape: ResourceShape;
  // A bucket's or a table's ARN; for objects, the prefix every object's ARN starts with.
  arn: string;
}

function resourceFor(
  target: IamStoreTarget,
  shape: ResourceShape,
): CallResource {
  return shape === "object"
    ? { shape, arn: `${target.arn}/` }
    : { shape, arn: target.arn };
}

/*
 * Whether a statement's Resource or NotResource covers the call's
 * resource. `whole` asks for all of it (a Deny must take every object
 * away to take the read away); otherwise some of it is enough.
 */
function coversResource(
  statement: JSONObject,
  resource: CallResource,
  whole: boolean,
): boolean {
  const resources: Array<string> = policyValues(statement["Resource"]);
  const notResources: Array<string> = policyValues(statement["NotResource"]);

  if (resources.length > 0) {
    return resources.some((pattern: string): boolean => {
      if (resource.shape !== "object") {
        return wildcardMatches(pattern, resource.arn);
      }

      return whole
        ? wildcardCoversEveryExtension(pattern, resource.arn)
        : wildcardMatchesSomeExtension(pattern, resource.arn);
    });
  }

  if (notResources.length > 0) {
    return !notResources.some((pattern: string): boolean => {
      if (resource.shape !== "object") {
        return wildcardMatches(pattern, resource.arn);
      }

      // Every object excluded takes all of it; any one excluded takes the whole.
      return whole
        ? wildcardMatchesSomeExtension(pattern, resource.arn)
        : wildcardCoversEveryExtension(pattern, resource.arn);
    });
  }

  return false;
}

function coversAction(statement: JSONObject, action: string): boolean {
  const actions: Array<string> = policyValues(statement["Action"]);
  const notActions: Array<string> = policyValues(statement["NotAction"]);

  if (actions.length > 0) {
    return actions.some((pattern: string): boolean => {
      return wildcardMatches(pattern, action);
    });
  }

  if (notActions.length > 0) {
    return !notActions.some((pattern: string): boolean => {
      return wildcardMatches(pattern, action);
    });
  }

  return false;
}

function effectOf(statement: JSONObject): string {
  return readText(statement["Effect"]).toLowerCase();
}

function hasConditions(statement: JSONObject): boolean {
  return Object.keys(readObject(statement["Condition"])).length > 0;
}

// Whether an unconditional Deny among the statements takes the call away.
function isDenied(
  statements: Array<JSONObject>,
  action: string,
  resource: CallResource,
): boolean {
  return statements.some((statement: JSONObject): boolean => {
    return (
      effectOf(statement) === "deny" &&
      !hasConditions(statement) &&
      coversAction(statement, action) &&
      coversResource(statement, resource, true)
    );
  });
}

// The first Allow that grants the call, the unconditional one when there is one.
function allowing(
  statements: Array<JSONObject>,
  action: string,
  resource: CallResource,
): JSONObject | null {
  let conditional: JSONObject | null = null;

  for (const statement of statements) {
    if (
      effectOf(statement) !== "allow" ||
      !coversAction(statement, action) ||
      !coversResource(statement, resource, false)
    ) {
      continue;
    }

    if (!hasConditions(statement)) {
      return statement;
    }

    conditional = conditional || statement;
  }

  return conditional;
}

/*
 * An identity made ready to evaluate against many stores: its statements
 * in one list, and the kinds of store any of its Allows can reach at all,
 * whatever the resource - an identity whose policies never name S3 is not
 * asked about every bucket.
 */
export interface PreparedIamIdentity {
  identity: IamIdentity;
  statements: Array<JSONObject>;
  reachableKinds: Set<DataStoreKind>;
}

export function prepareIamIdentity(identity: IamIdentity): PreparedIamIdentity {
  const statements: Array<JSONObject> = identity.policies.flatMap(
    (entry: { policy: IamPolicy }): Array<JSONObject> => {
      return entry.policy.statements;
    },
  );
  const reachableKinds: Set<DataStoreKind> = new Set();

  for (const [kind, levels] of Object.entries(LEVELS_BY_KIND) as Array<
    [DataStoreKind, Array<LevelSamples>]
  >) {
    const reaches: boolean = levels.some((level: LevelSamples): boolean => {
      return level.samples.some((sample: ActionSample): boolean => {
        return statements.some((statement: JSONObject): boolean => {
          return (
            effectOf(statement) === "allow" &&
            coversAction(statement, sample.action)
          );
        });
      });
    });

    if (reaches) {
      reachableKinds.add(kind);
    }
  }

  return { identity, statements, reachableKinds };
}

/*
 * What one identity's policies let it do to one store: the highest level
 * any of its calls is allowed at, and the policy that allows it - an
 * unconditional grant over one held by conditions - or null when its
 * policies allow none of them.
 */
export function evaluateIdentityReach(
  identity: IamIdentity | PreparedIamIdentity,
  target: IamStoreTarget,
): IamReach | null {
  const prepared: PreparedIamIdentity =
    "reachableKinds" in identity ? identity : prepareIamIdentity(identity);
  const levels: Array<LevelSamples> | undefined = LEVELS_BY_KIND[target.kind];

  if (!levels || !prepared.reachableKinds.has(target.kind)) {
    return null;
  }

  const who: IamIdentity = prepared.identity;

  for (const { level, samples } of levels) {
    let best: IamReach | null = null;

    for (const sample of samples) {
      const resource: CallResource = resourceFor(target, sample.shape);

      if (isDenied(prepared.statements, sample.action, resource)) {
        continue;
      }

      // A permissions boundary allows only what it allows itself.
      let boundaryConditional: boolean = who.boundary === null;

      if (who.boundary) {
        if (isDenied(who.boundary, sample.action, resource)) {
          continue;
        }

        const bounded: JSONObject | null = allowing(
          who.boundary,
          sample.action,
          resource,
        );

        if (!bounded) {
          continue;
        }

        boundaryConditional = hasConditions(bounded);
      }

      for (const entry of who.policies) {
        const statement: JSONObject | null = allowing(
          entry.policy.statements,
          sample.action,
          resource,
        );

        if (!statement) {
          continue;
        }

        const reach: IamReach = {
          level,
          via: entry.via,
          isConditional: hasConditions(statement) || boundaryConditional,
        };

        if (!reach.isConditional) {
          return reach;
        }

        best = best || reach;
      }
    }

    if (best) {
      return best;
    }
  }

  return null;
}

// A principal a role's trust policy lets in from outside the connected accounts.
export interface IamExternalTruster {
  principal: string;
  principalName?: string | undefined;
  principalType: DataStorePrincipalType;
  isPublic: boolean;
}

/*
 * Who outside the connected accounts may become this role: the AWS
 * accounts, roles and users its trust policy lets assume it, and anyone at
 * all when it trusts "*" with nothing holding that to known callers. AWS
 * services and identity providers that may assume it are not accounts, and
 * are left out.
 */
export function readExternalTrusters(
  identity: IamIdentity,
  isInternalAccount: (accountId: string) => boolean,
): Array<IamExternalTruster> {
  const trusters: Map<string, IamExternalTruster> = new Map();

  for (const statement of identity.trustStatements) {
    if (
      effectOf(statement) !== "allow" ||
      !ASSUME_ROLE_ACTIONS.some((action: string): boolean => {
        return coversAction(statement, action);
      })
    ) {
      continue;
    }

    const restricted: boolean = hasRestrictingCondition(
      readObject(statement["Condition"]),
    );

    for (const principal of readPrincipals(statement)) {
      if (principal.kind === "public") {
        if (!restricted) {
          trusters.set("*", {
            principal: "*",
            principalName: "Any AWS account",
            principalType: DataStorePrincipalType.Public,
            isPublic: true,
          });
        }

        continue;
      }

      if (principal.kind !== "AWS") {
        continue;
      }

      const described: ReturnType<typeof describePrincipal> =
        describePrincipal(principal);

      if (
        !described.accountId ||
        !isAccountId(described.accountId) ||
        isInternalAccount(described.accountId)
      ) {
        continue;
      }

      trusters.set(described.principal, {
        principal: described.principal,
        principalName: described.principalName,
        principalType: described.principalType,
        isPublic: false,
      });
    }
  }

  return Array.from(trusters.values());
}

// AWS's own roles, which only an AWS service can use.
export function isServiceLinkedRole(identity: IamIdentity): boolean {
  return (
    identity.kind === IamIdentityKind.Role &&
    identity.path.toLowerCase().startsWith("/aws-service-role/")
  );
}

function clampVia(text: string): string {
  return text.length > MAX_VIA_LENGTH
    ? `${text.slice(0, MAX_VIA_LENGTH - 3)}...`
    : text;
}

function describeVia(reach: IamReach): string {
  return clampVia(
    `IAM policy ${reach.via}${reach.isConditional ? ", with conditions" : ""}`,
  );
}

const LEVEL_RANK: Readonly<Record<DataStoreAccessLevel, number>> = {
  [DataStoreAccessLevel.Admin]: 3,
  [DataStoreAccessLevel.Write]: 2,
  [DataStoreAccessLevel.Read]: 1,
};

export interface IamStoreAccess {
  entries: Array<DataStoreAccessEntry>;
  // How many identities reached the store beyond the ones listed.
  leftOut: number;
}

/*
 * Who reaches each store through IAM: one entry per identity at its
 * highest level, and one per principal outside the connected accounts
 * that may assume a role reaching it. The most powerful are listed first,
 * at most MAX_IAM_ENTRIES_PER_STORE of them a store.
 */
export function buildIamAccessEntries(data: {
  authorization: IamAuthorization;
  targets: Array<IamStoreTarget>;
  isInternalAccount: (accountId: string) => boolean;
  userUses?: Map<string, CredentialReportUse> | undefined;
  now: Date;
}): Map<string, IamStoreAccess> {
  const byTarget: Map<string, IamStoreAccess> = new Map();
  const candidates: Array<PreparedIamIdentity> = data.authorization.identities
    .filter((identity: IamIdentity): boolean => {
      return !isServiceLinkedRole(identity) && identity.policies.length > 0;
    })
    .map(prepareIamIdentity)
    .filter((prepared: PreparedIamIdentity): boolean => {
      return prepared.reachableKinds.size > 0;
    });
  const trustersOf: Map<string, Array<IamExternalTruster>> = new Map();

  for (const { identity } of candidates) {
    if (identity.kind === IamIdentityKind.Role) {
      trustersOf.set(
        identity.arn,
        readExternalTrusters(identity, data.isInternalAccount),
      );
    }
  }

  for (const target of data.targets) {
    const entries: Array<DataStoreAccessEntry> = [];

    for (const prepared of candidates) {
      const identity: IamIdentity = prepared.identity;
      const reach: IamReach | null = evaluateIdentityReach(prepared, target);

      if (!reach) {
        continue;
      }

      const use: CredentialReportUse | undefined =
        identity.kind === IamIdentityKind.User
          ? data.userUses?.get(identity.arn)
          : undefined;
      const lastUsedAt: Date | undefined =
        identity.kind === IamIdentityKind.User
          ? use?.lastUsedAt
          : identity.lastUsedAt;

      entries.push({
        principal: identity.arn,
        principalName: identity.name,
        principalType:
          identity.kind === IamIdentityKind.User
            ? DataStorePrincipalType.User
            : DataStorePrincipalType.Role,
        accessLevel: reach.level,
        grantedVia: describeVia(reach),
        isExternal: false,
        isPublic: false,
        lastUsedAt,
        isUnused: isAccessUnused({
          lastUsedAt,
          hasNoRecordedUse:
            identity.kind === IamIdentityKind.User
              ? Boolean(use?.hasNoRecordedUse)
              : identity.hasNoRecordedUse,
          now: data.now,
        }),
      });

      for (const truster of trustersOf.get(identity.arn) || []) {
        entries.push({
          principal: truster.principal,
          principalName: truster.principalName,
          principalType: truster.principalType,
          accessLevel: reach.level,
          grantedVia: clampVia(
            `Can assume role ${identity.name}, whose ${describeVia(reach)}`,
          ),
          isExternal: true,
          isPublic: truster.isPublic,
        });
      }
    }

    entries.sort((a: DataStoreAccessEntry, b: DataStoreAccessEntry): number => {
      if (a.isPublic !== b.isPublic) {
        return a.isPublic ? -1 : 1;
      }

      if (a.isExternal !== b.isExternal) {
        return a.isExternal ? -1 : 1;
      }

      const rank: number =
        LEVEL_RANK[b.accessLevel] - LEVEL_RANK[a.accessLevel];

      return rank !== 0
        ? rank
        : (a.principalName || a.principal).localeCompare(
            b.principalName || b.principal,
          );
    });

    byTarget.set(target.arn, {
      entries: entries.slice(0, MAX_IAM_ENTRIES_PER_STORE),
      leftOut: Math.max(0, entries.length - MAX_IAM_ENTRIES_PER_STORE),
    });
  }

  return byTarget;
}
