import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../SecurityBlocklist/SecurityBlock";
import { SecurityBlockClientAddress } from "../SecurityBlocklist/SecurityBlockCloudWaf";
import { getCloudWafValueKey } from "./CloudWafRuleSlots";

/*
 * THE BLOCKLIST IN A GOOGLE CLOUD ARMOR SECURITY POLICY (#10349): what
 * OneUptime keeps in a policy a project picked, named and shaped here once
 * - for the server, which writes it (Server/Utils/CloudConnection/Gcp/
 * CloudArmorBlocklist), for the setup command and the Add dialog, which
 * grant it, and for the Dashboard.
 *
 * Two ways of holding the addresses, picked when the policy is set up:
 *
 *   Address groups, where the project has Cloud Armor Enterprise and the
 *   policy is a global backend policy: two groups of the project's own,
 *   oneuptime-<project>-block-ipv4 and -ipv6, which every such policy of
 *   the project shares, and one rule in each policy that denies what
 *   either holds:
 *     evaluateAddressGroup('oneuptime-1a2b3c4d-block-ipv4', origin.ip) ||
 *     evaluateAddressGroup('oneuptime-1a2b3c4d-block-ipv6', origin.ip)
 *   A group's capacity is fixed when it is made
 *   (https://docs.cloud.google.com/armor/docs/address-groups-using).
 *
 *   Rules, anywhere else: as many of OneUptime's rules as the blocklist
 *   needs, each holding at most 10 ranges - a basic match's srcIpRanges,
 *   or an expression of inIpRange() terms when the policy reads the user
 *   IP (https://docs.cloud.google.com/armor/quotas).
 *
 * Every rule of OneUptime's says so in its description - "OneUptime
 * blocklist 1a2b3c4d #3" - which is how it is told from the customer's:
 * Cloud Armor names a rule by its priority alone. Each is added, patched
 * and removed on its own with the rule methods (addRule, patchRule,
 * removeRule); the policy is never patched whole, so a rule of the
 * customer's is never written.
 *
 * Cloud Armor's actions are allow, deny, redirect, throttle and
 * rate-based ban: OneUptime's rules deny with 403, and a challenge is not
 * applied (its reCAPTCHA redirect needs a site key set up in reCAPTCHA
 * Enterprise first).
 */

export enum CloudArmorPolicyType {
  Backend = "CLOUD_ARMOR",
  Edge = "CLOUD_ARMOR_EDGE",
  Network = "CLOUD_ARMOR_NETWORK",
}

// The Cloud Asset type a security policy is inventoried as.
export const CLOUD_ARMOR_POLICY_ASSET_TYPE: string =
  "compute.googleapis.com/SecurityPolicy";

// Cloud Armor's fixed limit: IP ranges in one rule, basic or in an expression.
export const CLOUD_ARMOR_ADDRESSES_PER_RULE: number = 10;

// The priorities a rule may take: 2147483647 is the default rule's.
export const CLOUD_ARMOR_LOWEST_PRIORITY: number = 0;
export const CLOUD_ARMOR_HIGHEST_PRIORITY: number = 2147483646;

/*
 * The most rules OneUptime takes of a policy in rules mode: twenty, 200
 * addresses, so the project keeps room in its rules quota for its own.
 */
export const CLOUD_ARMOR_MAX_ONEUPTIME_RULES: number = 20;

// What a OneUptime rule denies with.
export const CLOUD_ARMOR_BLOCK_ACTION: string = "deny(403)";

/*
 * A customer's rule that lets a request through: OneUptime's go before
 * it. A throttle, a rate-based ban and a fair share let a request within
 * the limit through.
 */
const PASS_ACTIONS: ReadonlyArray<string> = [
  "allow",
  "throttle",
  "rate_based_ban",
  "fairshare",
];

// How a policy holds the blocklist.
export enum CloudArmorBlocklistMode {
  AddressGroups = "addressGroups",
  Rules = "rules",
}

// Where a rule reads the client's address.
export type CloudArmorAddressAttribute = "origin.ip" | "origin.user_ip";

export function getCloudArmorAddressAttribute(
  clientAddress: SecurityBlockClientAddress | string | undefined | null,
): CloudArmorAddressAttribute {
  return clientAddress === SecurityBlockClientAddress.UserIp
    ? "origin.user_ip"
    : "origin.ip";
}

// The client addresses each type of policy can read: an edge policy has no user IP.
export function getCloudArmorClientAddresses(
  type: string | undefined | null,
): ReadonlyArray<SecurityBlockClientAddress> {
  if (type === CloudArmorPolicyType.Edge) {
    return [SecurityBlockClientAddress.SourceIp];
  }

  if (type === CloudArmorPolicyType.Network) {
    return [];
  }

  return [SecurityBlockClientAddress.SourceIp, SecurityBlockClientAddress.UserIp];
}

// Whether OneUptime can hold the blocklist in a policy of this type: not a network edge policy.
export function isCloudArmorPolicyTypeSupported(
  type: string | undefined | null,
): boolean {
  return type !== CloudArmorPolicyType.Network;
}

// ---------- A policy's name ----------

export interface CloudArmorPolicyRef {
  // "projects/acme-prod/global/securityPolicies/prod-lb".
  id: string;
  project: string;
  // Null for a global policy.
  region: string | null;
  name: string;
}

const PROJECT_ID: RegExp = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const REGION: RegExp = /^[a-z]+(?:-[a-z0-9]+)+$/;
const RESOURCE_NAME: RegExp = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

/*
 * A policy's name, read from what names it: the relative name a row keeps
 * ("projects/p/global/securityPolicies/n", ".../regions/r/securityPolicies/
 * n"), its selfLink, or Cloud Asset's full name ("//compute.googleapis.com/
 * projects/..."). Null for anything else.
 */
export function parseCloudArmorPolicyId(
  value: unknown,
): CloudArmorPolicyRef | null {
  if (typeof value !== "string") {
    return null;
  }

  const text: string = value.trim();
  const start: number = text.indexOf("projects/");

  if (start < 0) {
    return null;
  }

  const segments: Array<string> = text
    .slice(start)
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  let project: string = "";
  let region: string | null = null;
  let name: string = "";

  if (
    segments.length === 5 &&
    segments[0] === "projects" &&
    segments[2] === "global" &&
    segments[3] === "securityPolicies"
  ) {
    project = segments[1]!;
    name = segments[4]!;
  } else if (
    segments.length === 6 &&
    segments[0] === "projects" &&
    segments[2] === "regions" &&
    segments[4] === "securityPolicies"
  ) {
    project = segments[1]!;
    region = segments[3]!;
    name = segments[5]!;
  } else {
    return null;
  }

  if (
    !PROJECT_ID.test(project) ||
    !RESOURCE_NAME.test(name) ||
    (region !== null && !REGION.test(region))
  ) {
    return null;
  }

  return {
    id: region
      ? `projects/${project}/regions/${region}/securityPolicies/${name}`
      : `projects/${project}/global/securityPolicies/${name}`,
    project,
    region,
    name,
  };
}

// ---------- OneUptime's rules ----------

const OWN_RULE: RegExp = /^OneUptime blocklist ([0-9a-f]{8}) #([1-9]\d{0,3})\b/;
const OWN_GROUP_RULE: RegExp = /^OneUptime blocklist ([0-9a-f]{8}), address groups\b/;

// What a OneUptime rule of rules mode says of itself: "OneUptime blocklist 1a2b3c4d #3. ...".
export function getCloudArmorRuleDescription(
  projectSuffix: string,
  index: number,
): string {
  return `OneUptime blocklist ${projectSuffix} #${index}. Managed by OneUptime: changes here are replaced.`;
}

// What the rule of address groups mode says of itself.
export function getCloudArmorGroupRuleDescription(projectSuffix: string): string {
  return `OneUptime blocklist ${projectSuffix}, address groups. Managed by OneUptime: changes here are replaced.`;
}

// The number of a OneUptime rule of this project, from its description; null for any other rule.
export function readCloudArmorRuleIndex(
  description: unknown,
  projectSuffix: string,
): number | null {
  if (typeof description !== "string") {
    return null;
  }

  const match: RegExpExecArray | null = OWN_RULE.exec(description.trim());

  return match && match[1] === projectSuffix ? Number(match[2]) : null;
}

export function isCloudArmorGroupRule(
  description: unknown,
  projectSuffix: string,
): boolean {
  if (typeof description !== "string") {
    return false;
  }

  const match: RegExpExecArray | null = OWN_GROUP_RULE.exec(
    description.trim(),
  );

  return Boolean(match && match[1] === projectSuffix);
}

// Whether a description is any OneUptime project's: another project's rules are the customer's to OneUptime.
export function isAnyOneUptimeCloudArmorRule(description: unknown): boolean {
  return (
    typeof description === "string" &&
    (OWN_RULE.test(description.trim()) ||
      OWN_GROUP_RULE.test(description.trim()))
  );
}

/*
 * A block's value as Cloud Armor takes it: a range as it is, a single
 * address as its /32 or /128. Null for anything that is not an address or
 * a range, and for /0.
 */
export function toCloudArmorRange(value: string): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (!read || read.block.prefixLength === 0) {
    return null;
  }

  const full: number = read.block.family === 4 ? 32 : 128;

  return read.block.prefixLength === full
    ? `${read.value}/${full}`
    : read.value;
}

// The address groups of a project, by IP version.
export interface CloudArmorAddressGroupNames {
  ipv4: string;
  ipv6: string;
}

export function getCloudArmorAddressGroupNames(
  projectSuffix: string,
): CloudArmorAddressGroupNames {
  return {
    ipv4: `oneuptime-${projectSuffix}-block-ipv4`,
    ipv6: `oneuptime-${projectSuffix}-block-ipv6`,
  };
}

/*
 * The capacity each group is made with, fixed for its life: 10,000 IPv4
 * ranges and 2,000 IPv6 ranges - 16,000 units of the project's address
 * group quota, an IPv6 range counting three.
 */
export const CLOUD_ARMOR_ADDRESS_GROUP_CAPACITY: Readonly<{
  ipv4: number;
  ipv6: number;
}> = { ipv4: 10000, ipv6: 2000 };

// What an address group of OneUptime's says of itself in the console.
export const CLOUD_ARMOR_ADDRESS_GROUP_DESCRIPTION: string =
  "Kept by OneUptime from your project's blocklist. Changes made here are replaced.";

// The most items one addItems or removeItems call takes, by IP version.
export const CLOUD_ARMOR_ADDRESS_GROUP_ITEMS_PER_CALL: Readonly<{
  ipv4: number;
  ipv6: number;
}> = { ipv4: 50000, ipv6: 20000 };

// The rule of address groups mode, as the policy holds it.
export function buildCloudArmorGroupRule(data: {
  priority: number;
  projectSuffix: string;
  attribute: CloudArmorAddressAttribute;
}): JSONObject {
  const groups: CloudArmorAddressGroupNames = getCloudArmorAddressGroupNames(
    data.projectSuffix,
  );

  return {
    priority: data.priority,
    description: getCloudArmorGroupRuleDescription(data.projectSuffix),
    action: CLOUD_ARMOR_BLOCK_ACTION,
    preview: false,
    match: {
      expr: {
        expression: `evaluateAddressGroup('${groups.ipv4}', ${data.attribute}) || evaluateAddressGroup('${groups.ipv6}', ${data.attribute})`,
      },
    },
  };
}

// A rule of rules mode, as the policy holds it: a basic match, or an expression for the user IP.
export function buildCloudArmorRule(data: {
  priority: number;
  projectSuffix: string;
  index: number;
  values: ReadonlyArray<string>;
  attribute: CloudArmorAddressAttribute;
}): JSONObject {
  const ranges: Array<string> = data.values
    .map((value: string): string | null => {
      return toCloudArmorRange(value);
    })
    .filter((range: string | null): range is string => {
      return Boolean(range);
    });

  return {
    priority: data.priority,
    description: getCloudArmorRuleDescription(data.projectSuffix, data.index),
    action: CLOUD_ARMOR_BLOCK_ACTION,
    preview: false,
    match:
      data.attribute === "origin.ip"
        ? { versionedExpr: "SRC_IPS_V1", config: { srcIpRanges: ranges } }
        : {
            expr: {
              expression: ranges
                .map((range: string): string => {
                  return `inIpRange(origin.user_ip, '${range}')`;
                })
                .join(" || "),
            },
          },
  };
}

function readObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readList(value: unknown): Array<JSONValue> {
  return Array.isArray(value) ? (value as Array<JSONValue>) : [];
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readCloudArmorPriority(rule: unknown): number | null {
  const priority: unknown = readObject(rule)["priority"];

  return typeof priority === "number" && Number.isInteger(priority)
    ? priority
    : null;
}

const IN_IP_RANGE_TERM: RegExp =
  /^inIpRange\(\s*(origin\.ip|origin\.user_ip)\s*,\s*'([^']+)'\s*\)$/;

// A rule as the policy holds it, read for what it does.
export interface CloudArmorRuleRead {
  priority: number | null;
  description: string;
  action: string;
  isPreview: boolean;
  // Whether it denies: deny(403), deny(404) or deny(502) all turn a request away.
  isDeny: boolean;
  // The addresses it matches and where it reads them; null when it is not a plain list of them.
  attribute: CloudArmorAddressAttribute | null;
  values: Array<string>;
  // Its expression, when it has one.
  expression: string;
}

export function readCloudArmorRule(value: unknown): CloudArmorRuleRead {
  const rule: JSONObject = readObject(value);
  const match: JSONObject = readObject(rule["match"]);
  const action: string = readText(rule["action"]);
  const expression: string = readText(readObject(match["expr"])["expression"]);
  const values: Array<string> = [];
  let attribute: CloudArmorAddressAttribute | null = null;

  if (readText(match["versionedExpr"]) === "SRC_IPS_V1") {
    attribute = "origin.ip";

    for (const range of readList(
      readObject(match["config"])["srcIpRanges"],
    )) {
      const read: SecurityBlockValue | null = readSecurityBlockValue(range);

      if (read) {
        values.push(read.value);
      } else {
        // A range it cannot read ("*"): not a plain list of addresses.
        attribute = null;
      }
    }
  } else if (expression) {
    const terms: Array<string> = expression.split("||").map((term: string) => {
      return term.trim();
    });

    for (const term of terms) {
      const parsed: RegExpExecArray | null = IN_IP_RANGE_TERM.exec(term);
      const read: SecurityBlockValue | null = parsed
        ? readSecurityBlockValue(parsed[2])
        : null;

      if (
        !parsed ||
        !read ||
        (attribute !== null && attribute !== parsed[1])
      ) {
        attribute = null;
        values.length = 0;
        break;
      }

      attribute = parsed[1] as CloudArmorAddressAttribute;
      values.push(read.value);
    }
  }

  return {
    priority: readCloudArmorPriority(rule),
    description: readText(rule["description"]),
    action,
    isPreview: rule["preview"] === true,
    isDeny: action.startsWith("deny"),
    attribute,
    values,
    expression,
  };
}

/*
 * The priority of the customer's first rule that lets a request through:
 * OneUptime's rules go before it. The default rule counts too (it is last,
 * so it only bounds the range). Null when no rule lets one through.
 */
export function getCloudArmorPassPriority(
  rules: ReadonlyArray<unknown>,
): number | null {
  const priorities: Array<number> = rules
    .filter((rule: unknown): boolean => {
      const action: string = readText(readObject(rule)["action"]);

      return (
        !isAnyOneUptimeCloudArmorRule(readObject(rule)["description"]) &&
        PASS_ACTIONS.includes(action)
      );
    })
    .map((rule: unknown): number | null => {
      return readCloudArmorPriority(rule);
    })
    .filter((priority: number | null): priority is number => {
      return priority !== null;
    });

  return priorities.length > 0 ? Math.min(...priorities) : null;
}

// Whether a project's Cloud Armor tier is Enterprise, which address groups need.
export function isCloudArmorEnterpriseTier(tier: unknown): boolean {
  return tier === "CA_ENTERPRISE_PAYGO" || tier === "CA_ENTERPRISE_ANNUAL";
}

/*
 * How a policy holds the blocklist: address groups for a global backend
 * policy of an Enterprise project, rules for anything else - an edge
 * policy, a regional policy, a project on the Standard tier.
 */
export function chooseCloudArmorMode(data: {
  tier: unknown;
  policyType: string;
  region: string | null;
}): CloudArmorBlocklistMode {
  return isCloudArmorEnterpriseTier(data.tier) &&
    data.policyType === CloudArmorPolicyType.Backend &&
    data.region === null
    ? CloudArmorBlocklistMode.AddressGroups
    : CloudArmorBlocklistMode.Rules;
}

// ---------- What OneUptime keeps of a policy ----------

export interface CloudArmorRecordedRule {
  index: number;
  priority: number;
  values: Array<string>;
}

// How a rule of OneUptime's was changed by hand.
export enum CloudArmorRuleDrift {
  TurnedOff = "turnedOff",
  Changed = "changed",
  Deleted = "deleted",
}

/*
 * What a row keeps of its policy (SecurityBlockCloudWaf.ruleDetails): how
 * it holds the blocklist, the rules OneUptime last wrote, with what each
 * held - so a rule someone deleted is known rather than added again behind
 * their back - and what the policy reads the user IP from.
 */
export interface CloudArmorRuleDetails {
  mode: CloudArmorBlocklistMode;
  policyType: string;
  attribute: CloudArmorAddressAttribute;
  rules: Array<CloudArmorRecordedRule>;
  // Address groups mode: the priority of OneUptime's rule, once it is there.
  groupRulePriority: number | null;
  groups: CloudArmorAddressGroupNames | null;
  nextIndex: number;
  drift: Array<{ priority: number; index: number; drift: CloudArmorRuleDrift }>;
  freePriorities: Array<number>;
  // Whether the last write had a block it could not place for want of a free priority.
  isWaitingForPriority: boolean;
  // The policy's user IP request headers, as its last read found them.
  userIpHeaders: Array<string>;
  // The project's Cloud Armor tier at setup.
  tier: string;
}

export function readCloudArmorRuleDetails(
  value: unknown,
): CloudArmorRuleDetails | null {
  const json: JSONObject = readObject(value);
  const mode: string = readText(json["mode"]);

  if (
    !(Object.values(CloudArmorBlocklistMode) as Array<string>).includes(mode)
  ) {
    return null;
  }

  const rules: Array<CloudArmorRecordedRule> = [];

  for (const entry of readList(json["rules"])) {
    const rule: JSONObject = readObject(entry);
    const index: unknown = rule["index"];
    const priority: unknown = rule["priority"];

    if (
      typeof index !== "number" ||
      !Number.isInteger(index) ||
      typeof priority !== "number" ||
      !Number.isInteger(priority)
    ) {
      continue;
    }

    rules.push({
      index,
      priority,
      values: readList(rule["values"])
        .map((item: JSONValue): string => {
          return readText(item);
        })
        .filter((item: string): boolean => {
          return Boolean(item);
        }),
    });
  }

  const drift: Array<{
    priority: number;
    index: number;
    drift: CloudArmorRuleDrift;
  }> = [];

  for (const entry of readList(json["drift"])) {
    const item: JSONObject = readObject(entry);
    const kind: string = readText(item["drift"]);
    const priority: unknown = item["priority"];
    const index: unknown = item["index"];

    if (
      (Object.values(CloudArmorRuleDrift) as Array<string>).includes(kind) &&
      typeof priority === "number" &&
      typeof index === "number"
    ) {
      drift.push({ priority, index, drift: kind as CloudArmorRuleDrift });
    }
  }

  const groups: JSONObject = readObject(json["groups"]);
  const groupRulePriority: unknown = json["groupRulePriority"];
  const nextIndex: unknown = json["nextIndex"];

  return {
    mode: mode as CloudArmorBlocklistMode,
    policyType: readText(json["policyType"]) || CloudArmorPolicyType.Backend,
    attribute:
      readText(json["attribute"]) === "origin.user_ip"
        ? "origin.user_ip"
        : "origin.ip",
    rules,
    groupRulePriority:
      typeof groupRulePriority === "number" &&
      Number.isInteger(groupRulePriority)
        ? groupRulePriority
        : null,
    groups:
      readText(groups["ipv4"]) && readText(groups["ipv6"])
        ? { ipv4: readText(groups["ipv4"]), ipv6: readText(groups["ipv6"]) }
        : null,
    nextIndex:
      typeof nextIndex === "number" && Number.isInteger(nextIndex)
        ? nextIndex
        : 1,
    drift,
    freePriorities: readList(json["freePriorities"]).filter(
      (item: JSONValue): item is number => {
        return typeof item === "number" && Number.isInteger(item);
      },
    ),
    isWaitingForPriority: json["isWaitingForPriority"] === true,
    userIpHeaders: readList(json["userIpHeaders"])
      .map((item: JSONValue): string => {
        return readText(item);
      })
      .filter((item: string): boolean => {
        return Boolean(item);
      }),
    tier: readText(json["tier"]),
  };
}

export function toCloudArmorRuleDetailsJson(
  details: CloudArmorRuleDetails,
): JSONObject {
  return {
    mode: details.mode,
    policyType: details.policyType,
    attribute: details.attribute,
    rules: details.rules.map((rule: CloudArmorRecordedRule): JSONObject => {
      return {
        index: rule.index,
        priority: rule.priority,
        values: [...rule.values],
      };
    }),
    groupRulePriority: details.groupRulePriority,
    groups: details.groups ? { ...details.groups } : null,
    nextIndex: details.nextIndex,
    drift: details.drift.map(
      (item: {
        priority: number;
        index: number;
        drift: CloudArmorRuleDrift;
      }): JSONObject => {
        return { priority: item.priority, index: item.index, drift: item.drift };
      },
    ),
    freePriorities: [...details.freePriorities],
    isWaitingForPriority: details.isWaitingForPriority,
    userIpHeaders: [...details.userIpHeaders],
    tier: details.tier,
  };
}

// The user IP request headers a policy reads, as its advanced options name them.
export function readCloudArmorUserIpHeaders(policy: unknown): Array<string> {
  return readList(
    readObject(readObject(policy)["advancedOptionsConfig"])[
      "userIpRequestHeaders"
    ],
  )
    .map((header: JSONValue): string => {
      return readText(header);
    })
    .filter((header: string): boolean => {
      return Boolean(header);
    });
}

// Whether two lists hold the same addresses, in any order.
export function isSameCloudArmorValues(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): boolean {
  const left: Array<string> = a.map(getCloudWafValueKey).sort();
  const right: Array<string> = b.map(getCloudWafValueKey).sort();

  return (
    left.length === right.length &&
    left.every((value: string, index: number): boolean => {
      return value === right[index];
    })
  );
}

// ---------- The role that lets OneUptime write a policy ----------

/*
 * A custom role, oneuptimeCloudArmorBlocklist: read and update security
 * policies, global and regional - the rule methods all take update - wait
 * for the operations they start, read the project's Cloud Armor tier, and
 * keep the project's own address groups (Enterprise). Never delete a
 * policy, never anything else.
 */
export const GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID: string =
  "oneuptimeCloudArmorBlocklist";

export const GCP_CLOUD_ARMOR_BLOCKLIST_PERMISSIONS: Array<string> = [
  "compute.securityPolicies.get",
  "compute.securityPolicies.update",
  "compute.regionSecurityPolicies.get",
  "compute.regionSecurityPolicies.update",
  "compute.globalOperations.get",
  "compute.regionOperations.get",
  "compute.projects.get",
  "networksecurity.addressGroups.get",
  "networksecurity.addressGroups.list",
  "networksecurity.addressGroups.create",
  "networksecurity.addressGroups.update",
  "networksecurity.addressGroups.delete",
  "networksecurity.addressGroups.use",
  "networksecurity.operations.get",
];

// What a picked policy takes, by mode: rules need the policy's own permissions alone.
export function getCloudArmorRequiredPermissions(data: {
  region: string | null;
  mode: CloudArmorBlocklistMode | null;
}): Array<string> {
  const policy: Array<string> =
    data.region === null
      ? [
          "compute.securityPolicies.get",
          "compute.securityPolicies.update",
          "compute.globalOperations.get",
        ]
      : [
          "compute.regionSecurityPolicies.get",
          "compute.regionSecurityPolicies.update",
          "compute.regionOperations.get",
        ];

  return [
    ...policy,
    "compute.projects.get",
    ...(data.mode === CloudArmorBlocklistMode.AddressGroups
      ? [
          "networksecurity.addressGroups.get",
          "networksecurity.addressGroups.create",
          "networksecurity.addressGroups.update",
          "networksecurity.addressGroups.use",
          "networksecurity.operations.get",
        ]
      : []),
  ];
}

const ROLE_TITLE: string = "OneUptime Cloud Armor Blocklist";
const ROLE_DESCRIPTION: string =
  "OneUptime: keep its own rules and address groups in the Cloud Armor policies it enforces your blocklist in.";

/*
 * The role made where the setup command binds roles, and bound there: for
 * the setup command, which knows its project ($PROJECT_ID) or organization
 * ($ORG_ID) and the service account ($MEMBER form, via bind).
 */
export function getGcpCloudArmorBlocklistRoleLines(data: {
  roleHome: string;
  roleName: string;
  bind: (role: string) => string;
}): Array<string> {
  const permissions: string = GCP_CLOUD_ARMOR_BLOCKLIST_PERMISSIONS.join(",");

  return [
    `gcloud iam roles create ${GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID} ${data.roleHome} --title "${ROLE_TITLE}" --description "${ROLE_DESCRIPTION}" --permissions ${permissions} --stage GA --quiet > /dev/null 2>&1 || gcloud iam roles update ${GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID} ${data.roleHome} --permissions ${permissions} --quiet > /dev/null`,
    data.bind(data.roleName),
  ];
}

/*
 * The lines that let a connection's service account write one picked
 * policy's project, for a connection set up before it could: the role made
 * in that project and bound there.
 */
export function getCloudArmorPolicyAccessCommand(data: {
  serviceAccountEmail: string;
  policy: CloudArmorPolicyRef;
}): string {
  const project: string = data.policy.project;
  const permissions: string = GCP_CLOUD_ARMOR_BLOCKLIST_PERMISSIONS.join(",");

  return [
    `gcloud iam roles create ${GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID} --project "${project}" --title "${ROLE_TITLE}" --description "${ROLE_DESCRIPTION}" --permissions ${permissions} --stage GA --quiet > /dev/null 2>&1 || gcloud iam roles update ${GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID} --project "${project}" --permissions ${permissions} --quiet > /dev/null`,
    `gcloud projects add-iam-policy-binding "${project}" --member "serviceAccount:${data.serviceAccountEmail}" --role projects/${project}/roles/${GCP_CLOUD_ARMOR_BLOCKLIST_ROLE_ID} --condition=None > /dev/null`,
  ].join("\n");
}

// A destination's name, as a block's Enforced At reads it: "Cloud Armor (prod-lb)".
export function getCloudArmorDestinationName(name: string): string {
  return `Cloud Armor (${name})`;
}

// The policy's page in the Google Cloud console.
export function getCloudArmorConsoleUrl(policy: CloudArmorPolicyRef): string {
  return policy.region
    ? `https://console.cloud.google.com/net-security/securitypolicies/details/${encodeURIComponent(policy.name)}?project=${encodeURIComponent(policy.project)}&region=${encodeURIComponent(policy.region)}`
    : `https://console.cloud.google.com/net-security/securitypolicies/details/${encodeURIComponent(policy.name)}?project=${encodeURIComponent(policy.project)}`;
}
