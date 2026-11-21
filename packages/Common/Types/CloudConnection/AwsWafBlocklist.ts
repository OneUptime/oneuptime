import { JSONObject } from "../JSON";
import {
  SecurityBlockAction,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../SecurityBlocklist/SecurityBlock";
import {
  SecurityBlockClientAddress,
  SecurityBlockClientAddressHeader,
  getSecurityBlockClientAddressHeader,
} from "../SecurityBlocklist/SecurityBlockCloudWaf";
import {
  getAwsExternalIdSuffix,
  getAwsWafIpSetNamePrefix,
} from "./CloudConnectionSetupCommands";

/*
 * THE BLOCKLIST IN AWS WAF (#10344): what OneUptime keeps in an AWS account
 * whose connection lets it block addresses, named and shaped here once -
 * for the setup command, which scopes its writes to these names; for the
 * server, which writes them (Server/Utils/CloudConnection/Aws/
 * AwsWafBlocklist); and for the Dashboard, which shows the rule a team
 * that keeps its web ACL in code adds.
 *
 *   IP sets, in each scope and Region a picked web ACL is in:
 *     oneuptime-<project>-block-ipv4      what is blocked, IPv4
 *     oneuptime-<project>-block-ipv6      what is blocked, IPv6
 *     oneuptime-<project>-challenge-ipv4  what is challenged, IPv4
 *     oneuptime-<project>-challenge-ipv6  what is challenged, IPv6
 *   An IP set holds one IP version and CIDRs only: a single address is
 *   written as /32 or /128 (CreateIPSet).
 *
 *   Rules, in each picked web ACL:
 *     OneUptime-Blocklist-<project>  Block: the OR of the two block sets
 *     OneUptime-Challenge-<project>  Challenge: the OR of the two challenge
 *                                    sets
 *   each at a free priority below the customer's first rule, reading the
 *   client's address where the web ACL is set to (a forwarded IP
 *   configuration for a header, SecurityBlockClientAddress).
 *
 * <project> is the first eight hexadecimal digits of the project's external
 * id, as its role's name carries them: two projects connected to one
 * account each keep their own sets and rules - each project's reconciler
 * replaces its sets whole, and would otherwise drop the other's blocks -
 * and a project's role may write its own sets only.
 */

export enum AwsWafScope {
  Regional = "REGIONAL",
  CloudFront = "CLOUDFRONT",
}

// A web ACL's type, as the inventory and CloudResourceCatalog name it.
export const AWS_WAF_WEB_ACL_RESOURCE_TYPE: string = "AWS::WAFv2::WebACL";

// CloudFront's web ACLs and IP sets live in US East (N. Virginia), scope CLOUDFRONT.
export const AWS_WAF_CLOUDFRONT_REGION: string = "us-east-1";

/*
 * AWS WAF's fixed quota: CIDRs in one IP set
 * (https://docs.aws.amazon.com/waf/latest/developerguide/limits.html).
 */
export const AWS_WAF_IP_SET_MAX_ADDRESSES: number = 10000;

export type AwsWafIpAddressVersion = "IPV4" | "IPV6";

// One of the blocklist's four IP sets in a scope and Region.
export interface AwsWafBlocklistSetSpec {
  // "block-ipv4": what the set is, the end of its name.
  key: string;
  name: string;
  action: SecurityBlockAction;
  family: 4 | 6;
  ipAddressVersion: AwsWafIpAddressVersion;
}

// What an IP set of OneUptime's says about itself in the console.
export const AWS_WAF_BLOCKLIST_SET_DESCRIPTION: string =
  "Kept by OneUptime from your project's blocklist. Changes made here are replaced.";

const SET_SHAPES: ReadonlyArray<{
  action: SecurityBlockAction;
  family: 4 | 6;
}> = [
  { action: SecurityBlockAction.Block, family: 4 },
  { action: SecurityBlockAction.Block, family: 6 },
  { action: SecurityBlockAction.Challenge, family: 4 },
  { action: SecurityBlockAction.Challenge, family: 6 },
];

// The project's four sets, block before challenge and IPv4 before IPv6.
export function getAwsWafBlocklistSets(
  externalId: string,
): Array<AwsWafBlocklistSetSpec> {
  const prefix: string = getAwsWafIpSetNamePrefix(externalId);

  return SET_SHAPES.map(
    (shape: {
      action: SecurityBlockAction;
      family: 4 | 6;
    }): AwsWafBlocklistSetSpec => {
      const key: string = `${shape.action.toLowerCase()}-ipv${shape.family}`;

      return {
        key,
        name: `${prefix}-${key}`,
        action: shape.action,
        family: shape.family,
        ipAddressVersion: shape.family === 4 ? "IPV4" : "IPV6",
      };
    },
  );
}

// The set an entry of an action and an IP version goes in.
export function getAwsWafBlocklistSetFor(
  sets: ReadonlyArray<AwsWafBlocklistSetSpec>,
  action: SecurityBlockAction,
  family: 4 | 6,
): AwsWafBlocklistSetSpec | undefined {
  return sets.find((set: AwsWafBlocklistSetSpec): boolean => {
    return set.action === action && set.family === family;
  });
}

export interface AwsWafBlocklistRuleNames {
  block: string;
  challenge: string;
}

/*
 * The project's two rules, by the names - and CloudWatch metric names -
 * they are written with. A rule's name is at most 128 letters, digits, "_"
 * and "-".
 */
export function getAwsWafBlocklistRuleNames(
  externalId: string,
): AwsWafBlocklistRuleNames {
  const suffix: string = getAwsExternalIdSuffix(externalId);

  return {
    block: `OneUptime-Blocklist-${suffix}`,
    challenge: `OneUptime-Challenge-${suffix}`,
  };
}

export function getAwsWafBlocklistRuleName(
  names: AwsWafBlocklistRuleNames,
  action: SecurityBlockAction,
): string {
  return action === SecurityBlockAction.Challenge
    ? names.challenge
    : names.block;
}

// ---------- ARNs ----------

/*
 * A web ACL's or an IP set's ARN, read:
 * arn:<partition>:wafv2:<region>:<account>:<regional|global>/<type>/<name>/<id>.
 * "global" is CloudFront's scope, in us-east-1.
 */
export interface AwsWafArn {
  arn: string;
  partition: string;
  region: string;
  accountId: string;
  scope: AwsWafScope;
  resourceType: string;
  name: string;
  id: string;
}

const AWS_WAF_NAME_CHARACTERS: RegExp = /^[\w-]{1,128}$/;
const AWS_WAF_ID_CHARACTERS: RegExp =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const AWS_ACCOUNT_ID_CHARACTERS: RegExp = /^\d{12}$/;
const AWS_REGION_CHARACTERS: RegExp = /^[a-z]{2}(?:-[a-z]+)+-\d{1,2}$/;

export function parseAwsWafArn(value: unknown): AwsWafArn | null {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }

  const arn: string = value.trim();
  const parts: Array<string> = arn.split(":");

  if (parts.length !== 6 || parts[0] !== "arn" || parts[2] !== "wafv2") {
    return null;
  }

  const [, partition, , region, accountId, resource] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const path: Array<string> = resource.split("/");

  if (
    !partition.startsWith("aws") ||
    !AWS_REGION_CHARACTERS.test(region) ||
    !AWS_ACCOUNT_ID_CHARACTERS.test(accountId) ||
    path.length !== 4
  ) {
    return null;
  }

  const [scopeWord, resourceType, name, id] = path as [
    string,
    string,
    string,
    string,
  ];

  if (
    (scopeWord !== "regional" && scopeWord !== "global") ||
    !resourceType ||
    !AWS_WAF_NAME_CHARACTERS.test(name) ||
    !AWS_WAF_ID_CHARACTERS.test(id)
  ) {
    return null;
  }

  return {
    arn,
    partition,
    region,
    accountId,
    scope: scopeWord === "global" ? AwsWafScope.CloudFront : AwsWafScope.Regional,
    resourceType,
    name,
    id,
  };
}

/*
 * A web ACL's ARN, from what the inventory keeps of it (its Name, Id and
 * Scope properties, its Region and account): null when it lacks any of
 * them - a web ACL found by its metrics alone, before a role that may list
 * web ACLs lists it - or names a scope AWS WAF has not.
 */
export function buildAwsWafWebAclArn(data: {
  region: string | undefined | null;
  accountId: string | undefined | null;
  scope: unknown;
  name: unknown;
  id: unknown;
}): string | null {
  const region: string = (data.region || "").trim().toLowerCase();
  const scope: unknown = data.scope;

  if (scope !== AwsWafScope.Regional && scope !== AwsWafScope.CloudFront) {
    return null;
  }

  // CloudFront's web ACLs are the commercial partition's, in us-east-1.
  if (scope === AwsWafScope.CloudFront && region !== AWS_WAF_CLOUDFRONT_REGION) {
    return null;
  }

  const partition: string = region.startsWith("cn-")
    ? "aws-cn"
    : region.startsWith("us-gov-")
      ? "aws-us-gov"
      : "aws";
  const arn: string = `arn:${partition}:wafv2:${region}:${(data.accountId || "").trim()}:${scope === AwsWafScope.CloudFront ? "global" : "regional"}/webacl/${typeof data.name === "string" ? data.name.trim() : ""}/${typeof data.id === "string" ? data.id.trim() : ""}`;
  const parsed: AwsWafArn | null = parseAwsWafArn(arn);

  return parsed && parsed.resourceType === "webacl" ? parsed.arn : null;
}

// ---------- Addresses ----------

/*
 * A block's value as an IP set holds it: a range as it is, a single
 * address as its /32 or /128. Null for anything that is not an address or
 * a range, and for /0, which AWS WAF refuses.
 */
export function toAwsWafAddress(value: string): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (!read || read.block.prefixLength === 0) {
    return null;
  }

  const fullLength: number = read.block.family === 4 ? 32 : 128;

  return read.block.prefixLength === fullLength
    ? `${read.value}/${fullLength}`
    : read.value;
}

// An IP set's entry as blocks write values: "35.205.11.131/32" is 35.205.11.131.
export function fromAwsWafAddress(address: string): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(address);

  return read ? read.value : null;
}

// The IP version of a block's value, or null for one that is no address.
export function getAwsWafAddressFamily(value: string): 4 | 6 | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  return read ? read.block.family : null;
}

// ---------- The rules ----------

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// The IP set reference of one set, reading the client's address where the web ACL is set to.
export function buildAwsWafIpSetReference(
  arn: string,
  clientAddress: SecurityBlockClientAddress,
): JSONObject {
  const header: SecurityBlockClientAddressHeader | null =
    getSecurityBlockClientAddressHeader(clientAddress);

  return {
    IPSetReferenceStatement: {
      ARN: arn,
      ...(header
        ? {
            /*
             * NO_MATCH: a request without the header is not blocked for
             * it. MATCH would block every request that did not come
             * through the proxy - a health check, the proxy's own.
             */
            IPSetForwardedIPConfig: {
              HeaderName: header.header,
              FallbackBehavior: "NO_MATCH",
              Position: header.position,
            },
          }
        : {}),
    },
  };
}

export interface AwsWafBlocklistRuleSpec {
  name: string;
  action: SecurityBlockAction;
  priority: number;
  ipv4SetArn: string;
  ipv6SetArn: string;
  clientAddress: SecurityBlockClientAddress;
}

/*
 * One of OneUptime's rules as a web ACL holds it: the OR of its two IP
 * sets, its action, and its requests sampled - what a case's block step
 * shows as evidence - under its own CloudWatch metric.
 */
export function buildAwsWafBlocklistRule(
  spec: AwsWafBlocklistRuleSpec,
): JSONObject {
  return {
    Name: spec.name,
    Priority: spec.priority,
    Action:
      spec.action === SecurityBlockAction.Challenge
        ? { Challenge: {} }
        : { Block: {} },
    Statement: {
      OrStatement: {
        Statements: [
          buildAwsWafIpSetReference(spec.ipv4SetArn, spec.clientAddress),
          buildAwsWafIpSetReference(spec.ipv6SetArn, spec.clientAddress),
        ],
      },
    },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: spec.name,
    },
  };
}

// What a rule does with the requests it matches, of the two the blocklist uses.
export function getAwsWafRuleAction(rule: unknown): SecurityBlockAction | null {
  const action: JSONObject = readObject(readObject(rule)["Action"]);

  if (action["Block"] !== undefined) {
    return SecurityBlockAction.Block;
  }

  if (action["Challenge"] !== undefined) {
    return SecurityBlockAction.Challenge;
  }

  return null;
}

/*
 * The IP set references a rule matches on whole: its statement itself, or
 * each statement of an OR. One nested deeper (in an AND with a scope-down
 * statement, under a NOT) matches only some of the set's requests, if any,
 * and is not counted.
 */
export function getAwsWafRuleIpSetReferences(rule: unknown): Array<JSONObject> {
  const statement: JSONObject = readObject(readObject(rule)["Statement"]);
  const direct: JSONObject = readObject(statement["IPSetReferenceStatement"]);

  if (readText(direct["ARN"])) {
    return [direct];
  }

  const statements: unknown = readObject(statement["OrStatement"])[
    "Statements"
  ];

  if (!Array.isArray(statements)) {
    return [];
  }

  return statements
    .map((item: unknown): JSONObject => {
      return readObject(readObject(item)["IPSetReferenceStatement"]);
    })
    .filter((reference: JSONObject): boolean => {
      return Boolean(readText(reference["ARN"]));
    });
}

/*
 * Whether a reference reads the client's address where the web ACL is set
 * to: the source address with no forwarded configuration, else the same
 * header (as AWS WAF reads it, without case) at a position that holds the
 * client's address - the last of X-Forwarded-For, which the proxy in front
 * wrote, or any of it, which includes that one; any of a one-address
 * header. The first of X-Forwarded-For is what the request claimed, which
 * blocks no one who chooses to claim another (#10416).
 */
export function doesAwsWafReferenceReadClientAddress(
  reference: JSONObject,
  clientAddress: SecurityBlockClientAddress,
): boolean {
  const header: SecurityBlockClientAddressHeader | null =
    getSecurityBlockClientAddressHeader(clientAddress);
  const config: JSONObject = readObject(reference["IPSetForwardedIPConfig"]);
  const configured: boolean = Boolean(readText(config["HeaderName"]));

  if (!header) {
    return !configured;
  }

  if (
    !configured ||
    readText(config["HeaderName"]).toLowerCase() !== header.header.toLowerCase()
  ) {
    return false;
  }

  const position: string = readText(config["Position"]).toUpperCase();

  return header.position === "LAST"
    ? position === "LAST" || position === "ANY"
    : position === "FIRST" || position === "LAST" || position === "ANY";
}

export interface AwsWafBlocklistSetRef {
  key: string;
  arn: string;
  action: SecurityBlockAction;
}

export interface AwsWafBlocklistEnforcement {
  // The sets a rule of the web ACL blocks or challenges, by key.
  enforcedSetKeys: Array<string>;
  /*
   * The CloudWatch metric name of the rule that enforces each action's sets,
   * whose sampled requests are the evidence a block holds: none for an
   * action no rule enforces, or whose rule samples nothing.
   */
  sampledMetricNames: Partial<Record<SecurityBlockAction, string>>;
}

/*
 * Which of the blocklist's sets a web ACL's rules enforce, read as AWS WAF
 * runs them: a set is enforced when a rule with its action (Block, or
 * Challenge) matches on it whole and reads the client's address where the
 * web ACL is set to. Whatever its name: a team that keeps its web ACL in
 * code may call its rule what it likes.
 */
export function findAwsWafBlocklistEnforcement(data: {
  rules: ReadonlyArray<unknown>;
  sets: ReadonlyArray<AwsWafBlocklistSetRef>;
  clientAddress: SecurityBlockClientAddress;
}): AwsWafBlocklistEnforcement {
  const enforced: Set<string> = new Set();
  const sampledMetricNames: Partial<Record<SecurityBlockAction, string>> = {};

  for (const rule of data.rules) {
    const action: SecurityBlockAction | null = getAwsWafRuleAction(rule);

    if (!action) {
      continue;
    }

    const references: Array<JSONObject> = getAwsWafRuleIpSetReferences(
      rule,
    ).filter((reference: JSONObject): boolean => {
      return doesAwsWafReferenceReadClientAddress(
        reference,
        data.clientAddress,
      );
    });
    let enforcesOne: boolean = false;

    for (const set of data.sets) {
      if (
        set.action === action &&
        references.some((reference: JSONObject): boolean => {
          return readText(reference["ARN"]) === set.arn;
        })
      ) {
        enforced.add(set.key);
        enforcesOne = true;
      }
    }

    const visibility: JSONObject = readObject(readObject(rule)["VisibilityConfig"]);
    const metricName: string = readText(visibility["MetricName"]);

    if (
      enforcesOne &&
      metricName &&
      visibility["SampledRequestsEnabled"] === true &&
      !sampledMetricNames[action]
    ) {
      sampledMetricNames[action] = metricName;
    }
  }

  return {
    enforcedSetKeys: data.sets
      .map((set: AwsWafBlocklistSetRef): string => {
        return set.key;
      })
      .filter((key: string): boolean => {
        return enforced.has(key);
      }),
    sampledMetricNames,
  };
}

/*
 * Whether a rule in the web ACL is OneUptime's as it should be: the same
 * name, action, sets, client address and sampling. Anything a person added
 * to it besides (a label, a custom response) is left as it is.
 */
export function isAwsWafBlocklistRuleCurrent(
  rule: unknown,
  wanted: JSONObject,
): boolean {
  const ruleObject: JSONObject = readObject(rule);

  if (readText(ruleObject["Name"]) !== readText(wanted["Name"])) {
    return false;
  }

  if (getAwsWafRuleAction(ruleObject) !== getAwsWafRuleAction(wanted)) {
    return false;
  }

  const shape: (references: Array<JSONObject>) => Array<string> = (
    references: Array<JSONObject>,
  ): Array<string> => {
    return references
      .map((reference: JSONObject): string => {
        const config: JSONObject = readObject(
          reference["IPSetForwardedIPConfig"],
        );

        return [
          readText(reference["ARN"]),
          readText(config["HeaderName"]).toLowerCase(),
          readText(config["Position"]).toUpperCase(),
          readText(config["FallbackBehavior"]).toUpperCase(),
        ].join("|");
      })
      .sort();
  };

  const statement: JSONObject = readObject(ruleObject["Statement"]);

  // An OR of exactly the two sets, nothing beside them.
  if (
    statement["OrStatement"] === undefined ||
    Object.keys(statement).length !== 1
  ) {
    return false;
  }

  const ruleShape: Array<string> = shape(
    getAwsWafRuleIpSetReferences(ruleObject),
  );
  const wantedShape: Array<string> = shape(getAwsWafRuleIpSetReferences(wanted));
  const statements: unknown = readObject(statement["OrStatement"])[
    "Statements"
  ];

  if (
    !Array.isArray(statements) ||
    statements.length !== wantedShape.length ||
    ruleShape.join(",") !== wantedShape.join(",")
  ) {
    return false;
  }

  const visibility: JSONObject = readObject(ruleObject["VisibilityConfig"]);
  const wantedVisibility: JSONObject = readObject(wanted["VisibilityConfig"]);

  return (
    visibility["SampledRequestsEnabled"] === true &&
    visibility["CloudWatchMetricsEnabled"] ===
      wantedVisibility["CloudWatchMetricsEnabled"] &&
    readText(visibility["MetricName"]) ===
      readText(wantedVisibility["MetricName"])
  );
}

export function getAwsWafRulePriority(rule: unknown): number | null {
  const priority: unknown = readObject(rule)["Priority"];

  return typeof priority === "number" && Number.isInteger(priority)
    ? priority
    : null;
}

/*
 * Where OneUptime's rules go: the free priorities right below the
 * customer's first rule, the block rule before the challenge rule, so the
 * blocklist is read before any rule of theirs - and before one of theirs
 * that allows - and the priorities above stay free for a rule they want
 * before OneUptime's. With no rule of theirs, 0 and 1. Null when there are
 * not enough: OneUptime never renumbers a customer's rule.
 */
export function pickAwsWafBlocklistPriorities(data: {
  // The priorities the web ACL's other rules (the customer's) take.
  customerPriorities: ReadonlyArray<number>;
  // The priorities OneUptime's rules that stay where they are take.
  keptPriorities: ReadonlyArray<number>;
  count: number;
}): Array<number> | null {
  if (data.count <= 0) {
    return [];
  }

  const used: Set<number> = new Set([
    ...data.customerPriorities,
    ...data.keptPriorities,
  ]);

  if (data.customerPriorities.length === 0) {
    const picked: Array<number> = [];

    for (
      let priority: number = 0;
      picked.length < data.count && priority <= used.size + data.count;
      priority++
    ) {
      if (!used.has(priority)) {
        picked.push(priority);
      }
    }

    return picked;
  }

  const first: number = Math.min(...data.customerPriorities);
  const picked: Array<number> = [];

  for (
    let priority: number = first - 1;
    priority >= 0 && picked.length < data.count;
    priority--
  ) {
    if (!used.has(priority)) {
      picked.push(priority);
    }
  }

  return picked.length === data.count
    ? picked.sort((a: number, b: number): number => {
        return a - b;
      })
    : null;
}

// The customer's first rule's priority, or null when the web ACL has none of theirs.
export function getAwsWafFirstCustomerPriority(
  rules: ReadonlyArray<unknown>,
  ownRuleNames: ReadonlyArray<string>,
): number | null {
  const priorities: Array<number> = rules
    .filter((rule: unknown): boolean => {
      return !ownRuleNames.includes(readText(readObject(rule)["Name"]));
    })
    .map((rule: unknown): number | null => {
      return getAwsWafRulePriority(rule);
    })
    .filter((priority: number | null): priority is number => {
      return priority !== null;
    });

  return priorities.length > 0 ? Math.min(...priorities) : null;
}

export type AwsWafBlocklistRulePlan =
  | {
      isPlaced: true;
      // The web ACL's rules as they are to be written: the customer's untouched.
      rules: Array<JSONObject>;
      // Whether anything differs from what the web ACL holds.
      isChanged: boolean;
      // Where each of OneUptime's rules sits.
      priorities: Partial<Record<SecurityBlockAction, number>>;
    }
  | {
      isPlaced: false;
      // The customer's first rule's priority, which leaves too few free below it.
      firstPriority: number;
      // How many priorities OneUptime needs below it.
      needed: number;
    };

/*
 * The web ACL's rules with OneUptime's two as they should be: each of
 * OneUptime's that is there kept at its priority and rewritten only when it
 * differs; each that is not placed at a free priority below the customer's
 * first rule. Every rule of the customer's is kept as it is, in its place:
 * UpdateWebACL replaces the whole web ACL, so what is not written back is
 * lost.
 */
export function planAwsWafBlocklistRules(data: {
  rules: ReadonlyArray<unknown>;
  // Each of OneUptime's rules as it should be, given a priority.
  wanted: ReadonlyArray<{
    action: SecurityBlockAction;
    name: string;
    build: (priority: number) => JSONObject;
  }>;
}): AwsWafBlocklistRulePlan {
  const ownNames: Array<string> = data.wanted.map(
    (wanted: { name: string }): string => {
      return wanted.name;
    },
  );
  const rules: Array<JSONObject> = data.rules.map(
    (rule: unknown): JSONObject => {
      return readObject(rule);
    },
  );
  const customerPriorities: Array<number> = rules
    .filter((rule: JSONObject): boolean => {
      return !ownNames.includes(readText(rule["Name"]));
    })
    .map((rule: JSONObject): number | null => {
      return getAwsWafRulePriority(rule);
    })
    .filter((priority: number | null): priority is number => {
      return priority !== null;
    });
  const keptPriorities: Array<number> = [];
  const missing: Array<{
    action: SecurityBlockAction;
    build: (priority: number) => JSONObject;
  }> = [];
  const result: Array<JSONObject> = [...rules];
  const priorities: Partial<Record<SecurityBlockAction, number>> = {};
  let isChanged: boolean = false;

  for (const wanted of data.wanted) {
    const index: number = result.findIndex((rule: JSONObject): boolean => {
      return readText(rule["Name"]) === wanted.name;
    });
    const priority: number | null =
      index >= 0 ? getAwsWafRulePriority(result[index]) : null;

    if (index < 0 || priority === null) {
      if (index >= 0) {
        result.splice(index, 1);
      }

      missing.push(wanted);
      continue;
    }

    keptPriorities.push(priority);
    priorities[wanted.action] = priority;

    const built: JSONObject = wanted.build(priority);

    if (!isAwsWafBlocklistRuleCurrent(result[index], built)) {
      // Rewritten in place: what a person added to it besides is kept.
      result[index] = {
        ...result[index],
        ...built,
      };
      isChanged = true;
    }
  }

  if (missing.length === 0) {
    return { isPlaced: true, rules: result, isChanged, priorities };
  }

  const free: Array<number> | null = pickAwsWafBlocklistPriorities({
    customerPriorities,
    keptPriorities,
    count: missing.length,
  });

  if (!free) {
    return {
      isPlaced: false,
      firstPriority: Math.min(...customerPriorities),
      needed: missing.length,
    };
  }

  missing.forEach(
    (
      wanted: {
        action: SecurityBlockAction;
        build: (priority: number) => JSONObject;
      },
      index: number,
    ) => {
      const priority: number = free[index]!;

      priorities[wanted.action] = priority;
      result.push(wanted.build(priority));
    },
  );

  return { isPlaced: true, rules: result, isChanged: true, priorities };
}

// The web ACL's rules without OneUptime's: what is written back when it lets the web ACL go.
export function withoutAwsWafBlocklistRules(
  rules: ReadonlyArray<unknown>,
  names: AwsWafBlocklistRuleNames,
): Array<JSONObject> {
  return rules
    .map((rule: unknown): JSONObject => {
      return readObject(rule);
    })
    .filter((rule: JSONObject): boolean => {
      const name: string = readText(rule["Name"]);

      return name !== names.block && name !== names.challenge;
    });
}

// ---------- The rule to add in code ----------

/*
 * What a team that keeps its web ACL in code adds to it, written from what
 * OneUptime set up: its sets' ARNs, its rules' names, the client address
 * the web ACL reads, and the priorities that are free below their first
 * rule.
 */
export interface AwsWafBlocklistCodeRule {
  ruleNames: AwsWafBlocklistRuleNames;
  // The four sets' ARNs, by key ("block-ipv4").
  setArns: Record<string, string>;
  clientAddress: SecurityBlockClientAddress;
  // The block rule's and the challenge rule's priorities.
  priorities: { block: number; challenge: number };
}

const CODE_RULES: ReadonlyArray<{
  action: SecurityBlockAction;
  terraformAction: string;
  ipv4: string;
  ipv6: string;
}> = [
  {
    action: SecurityBlockAction.Block,
    terraformAction: "block",
    ipv4: "block-ipv4",
    ipv6: "block-ipv6",
  },
  {
    action: SecurityBlockAction.Challenge,
    terraformAction: "challenge",
    ipv4: "challenge-ipv4",
    ipv6: "challenge-ipv6",
  },
];

function codeRuleName(
  rule: AwsWafBlocklistCodeRule,
  action: SecurityBlockAction,
): string {
  return getAwsWafBlocklistRuleName(rule.ruleNames, action);
}

function codeRulePriority(
  rule: AwsWafBlocklistCodeRule,
  action: SecurityBlockAction,
): number {
  return action === SecurityBlockAction.Challenge
    ? rule.priorities.challenge
    : rule.priorities.block;
}

/*
 * The two rules as rule blocks of Terraform's aws_wafv2_web_acl, each an
 * or_statement of two ip_set_reference_statement blocks.
 */
export function getAwsWafBlocklistTerraform(
  rule: AwsWafBlocklistCodeRule,
): string {
  const header: SecurityBlockClientAddressHeader | null =
    getSecurityBlockClientAddressHeader(rule.clientAddress);

  const reference: (arn: string) => Array<string> = (
    arn: string,
  ): Array<string> => {
    return [
      "      statement {",
      "        ip_set_reference_statement {",
      `          arn = "${arn}"`,
      ...(header
        ? [
            "",
            "          ip_set_forwarded_ip_config {",
            `            header_name       = "${header.header}"`,
            `            fallback_behavior = "NO_MATCH"`,
            `            position          = "${header.position}"`,
            "          }",
          ]
        : []),
      "        }",
      "      }",
    ];
  };

  return CODE_RULES.map(
    (code: (typeof CODE_RULES)[number]): string => {
      const name: string = codeRuleName(rule, code.action);

      return [
        "rule {",
        `  name     = "${name}"`,
        `  priority = ${codeRulePriority(rule, code.action)}`,
        "",
        "  action {",
        `    ${code.terraformAction} {}`,
        "  }",
        "",
        "  statement {",
        "    or_statement {",
        ...reference(rule.setArns[code.ipv4] || ""),
        "",
        ...reference(rule.setArns[code.ipv6] || ""),
        "    }",
        "  }",
        "",
        "  visibility_config {",
        "    cloudwatch_metrics_enabled = true",
        `    metric_name                = "${name}"`,
        "    sampled_requests_enabled   = true",
        "  }",
        "}",
      ].join("\n");
    },
  ).join("\n\n");
}

/*
 * The two rules as entries of an AWS::WAFv2::WebACL's Rules, in YAML.
 * CloudFormation names an IP set reference's ARN "Arn".
 */
export function getAwsWafBlocklistCloudFormation(
  rule: AwsWafBlocklistCodeRule,
): string {
  const header: SecurityBlockClientAddressHeader | null =
    getSecurityBlockClientAddressHeader(rule.clientAddress);

  const reference: (arn: string) => Array<string> = (
    arn: string,
  ): Array<string> => {
    return [
      "        - IPSetReferenceStatement:",
      `            Arn: ${arn}`,
      ...(header
        ? [
            "            IPSetForwardedIPConfig:",
            `              HeaderName: ${header.header}`,
            "              FallbackBehavior: NO_MATCH",
            `              Position: ${header.position}`,
          ]
        : []),
    ];
  };

  return CODE_RULES.map(
    (code: (typeof CODE_RULES)[number]): string => {
      const name: string = codeRuleName(rule, code.action);

      return [
        `- Name: ${name}`,
        `  Priority: ${codeRulePriority(rule, code.action)}`,
        "  Action:",
        `    ${code.action === SecurityBlockAction.Challenge ? "Challenge" : "Block"}: {}`,
        "  Statement:",
        "    OrStatement:",
        "      Statements:",
        ...reference(rule.setArns[code.ipv4] || ""),
        ...reference(rule.setArns[code.ipv6] || ""),
        "  VisibilityConfig:",
        "    SampledRequestsEnabled: true",
        "    CloudWatchMetricsEnabled: true",
        `    MetricName: ${name}`,
      ].join("\n");
    },
  ).join("\n");
}
