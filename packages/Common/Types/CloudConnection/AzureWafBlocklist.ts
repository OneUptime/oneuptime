import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityBlockValue,
  readSecurityBlockValue,
} from "../SecurityBlocklist/SecurityBlock";
import { SecurityBlockClientAddress } from "../SecurityBlocklist/SecurityBlockCloudWaf";
import { CloudWafValueSlot, getCloudWafValueKey } from "./CloudWafRuleSlots";

/*
 * THE BLOCKLIST IN AN AZURE WAF POLICY (#10348): what OneUptime keeps in an
 * Application Gateway or Front Door WAF policy a project picked, named and
 * shaped here once - for the server, which writes it
 * (Server/Utils/CloudConnection/Azure/AzureWafBlocklist), for the setup
 * command and the Add dialog, which grant it, and for the Dashboard, which
 * says where each policy stands.
 *
 *   Custom rules, in each picked policy: OneUptime<project>Block1,
 *   OneUptime<project>Block2, ... each one match condition - the client's
 *   address IPMatch the addresses it holds - and the action Block, at a
 *   free priority before the customer's first Allow rule
 *   (CloudWafRuleSlots). Azure has no list for a rule to reference: each
 *   rule holds its addresses, up to 540 in a match condition on
 *   Application Gateway (600 with CRS 3.2 or DRS) and 600 on Front Door
 *   (https://learn.microsoft.com/azure/azure-resource-manager/management/
 *   azure-subscription-service-limits).
 *
 *   <project> is the first eight hexadecimal digits of the project's
 *   external id (getCloudWafProjectSuffix): two OneUptime projects that
 *   pick one policy keep rules of their own. A rule's name is letters and
 *   digits only, which both kinds of policy take.
 *
 * Which address is matched:
 *   - Application Gateway's IP match reads RemoteAddr only: the address of
 *     the connection to the gateway. It matches IPv4 only, so an IPv6 block
 *     is not applied there, and says why.
 *   - Front Door reads SocketAddr, the address that connected to Front
 *     Door, by default, or RemoteAddr: the original client, which Front
 *     Door takes from X-Forwarded-For - for a Front Door behind another
 *     proxy or CDN. A client that connects to Front Door directly writes
 *     that header itself, so a block of RemoteAddr there is one it can step
 *     around (TrustedSec's "Azure's Front Door WAF WTF: IP Restriction
 *     Bypass"); Microsoft's own IP restriction example matches SocketAddr.
 *
 * Neither kind of policy is changed but through its whole: read with its
 * ETag, OneUptime's rules changed and every other rule written back as it
 * was, written with the ETag in If-Match.
 */

export enum AzureWafPolicyKind {
  ApplicationGateway = "applicationGateway",
  FrontDoor = "frontDoor",
}

// Each kind's resource type, as Resource Manager and the inventory spell it.
export const AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE: string =
  "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies";
export const AZURE_FRONT_DOOR_WAF_POLICY_TYPE: string =
  "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies";

export const AZURE_WAF_POLICY_TYPES: Readonly<
  Record<AzureWafPolicyKind, string>
> = {
  [AzureWafPolicyKind.ApplicationGateway]:
    AZURE_APPLICATION_GATEWAY_WAF_POLICY_TYPE,
  [AzureWafPolicyKind.FrontDoor]: AZURE_FRONT_DOOR_WAF_POLICY_TYPE,
};

/*
 * The API versions a policy is read and written with: the newest each
 * reference documents, so a policy written back whole keeps every setting
 * Azure has (a CAPTCHA's lifetime, log scrubbing) - an older version would
 * leave newer settings out of what it writes.
 */
export const AZURE_APPLICATION_GATEWAY_WAF_API_VERSION: string = "2026-03-01";
export const AZURE_FRONT_DOOR_WAF_API_VERSION: string = "2025-11-01";

export const AZURE_WAF_API_VERSIONS: Readonly<
  Record<AzureWafPolicyKind, string>
> = {
  [AzureWafPolicyKind.ApplicationGateway]:
    AZURE_APPLICATION_GATEWAY_WAF_API_VERSION,
  [AzureWafPolicyKind.FrontDoor]: AZURE_FRONT_DOOR_WAF_API_VERSION,
};

// Azure's limits: custom rules a policy holds, and the priorities they take.
export const AZURE_WAF_MAX_CUSTOM_RULES: number = 100;
export const AZURE_WAF_LOWEST_PRIORITY: number = 1;
export const AZURE_WAF_HIGHEST_PRIORITY: number = 100;

/*
 * Addresses one match condition holds: Application Gateway 540, or 600
 * with CRS 3.2 or a Default Rule Set; Front Door 600.
 */
export const AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE: number = 540;
export const AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE_NEWER: number = 600;
export const AZURE_FRONT_DOOR_WAF_ADDRESSES_PER_RULE: number = 600;

/*
 * The most custom rules OneUptime takes of a policy: ten, so the customer
 * keeps ninety for their own - 5,400 addresses on Application Gateway
 * (6,000 with CRS 3.2 or DRS), 6,000 on Front Door.
 */
export const AZURE_WAF_MAX_ONEUPTIME_RULES: number = 10;

// What a OneUptime rule matches on, by kind and the client address picked.
export type AzureWafMatchVariable = "RemoteAddr" | "SocketAddr";

// The client addresses each kind of policy can read.
export const AZURE_WAF_CLIENT_ADDRESSES: Readonly<
  Record<AzureWafPolicyKind, ReadonlyArray<SecurityBlockClientAddress>>
> = {
  [AzureWafPolicyKind.ApplicationGateway]: [
    SecurityBlockClientAddress.SourceIp,
  ],
  [AzureWafPolicyKind.FrontDoor]: [
    SecurityBlockClientAddress.SourceIp,
    SecurityBlockClientAddress.ForwardedClient,
  ],
};

export function getAzureWafMatchVariable(
  kind: AzureWafPolicyKind,
  clientAddress: SecurityBlockClientAddress | string | undefined | null,
): AzureWafMatchVariable {
  if (kind === AzureWafPolicyKind.ApplicationGateway) {
    return "RemoteAddr";
  }

  return clientAddress === SecurityBlockClientAddress.ForwardedClient
    ? "RemoteAddr"
    : "SocketAddr";
}

// ---------- A policy's resource id ----------

export interface AzureWafPolicyRef {
  // The id as Resource Manager names it, its type spelled as above.
  id: string;
  subscriptionId: string;
  resourceGroup: string;
  name: string;
  kind: AzureWafPolicyKind;
}

const GUID: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A resource group's name: letters, digits, "_", "-", ".", "(" and ")", at most 90.
const RESOURCE_GROUP: RegExp = /^[\w.()-]{1,90}$/;
// A policy's name: letters, digits, "_", "-" and ".", at most 128.
const POLICY_NAME: RegExp = /^[\w.-]{1,128}$/;

/*
 * A policy's resource id, read: /subscriptions/<id>/resourceGroups/<group>/
 * providers/Microsoft.Network/<type>/<name>, its segments in any case, as
 * Resource Graph lowers them. Null for anything else.
 */
export function parseAzureWafPolicyId(
  value: unknown,
): AzureWafPolicyRef | null {
  if (typeof value !== "string") {
    return null;
  }

  const segments: Array<string> = value
    .trim()
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    });

  if (
    segments.length !== 8 ||
    segments[0]!.toLowerCase() !== "subscriptions" ||
    segments[2]!.toLowerCase() !== "resourcegroups" ||
    segments[4]!.toLowerCase() !== "providers" ||
    segments[5]!.toLowerCase() !== "microsoft.network"
  ) {
    return null;
  }

  const subscriptionId: string = segments[1]!;
  const resourceGroup: string = segments[3]!;
  const name: string = segments[7]!;
  const kind: AzureWafPolicyKind | undefined = (
    Object.values(AzureWafPolicyKind) as Array<AzureWafPolicyKind>
  ).find((candidate: AzureWafPolicyKind): boolean => {
    return (
      AZURE_WAF_POLICY_TYPES[candidate].split("/")[1]!.toLowerCase() ===
      segments[6]!.toLowerCase()
    );
  });

  if (
    !kind ||
    !GUID.test(subscriptionId) ||
    !RESOURCE_GROUP.test(resourceGroup) ||
    !POLICY_NAME.test(name)
  ) {
    return null;
  }

  return {
    id: `/subscriptions/${subscriptionId.toLowerCase()}/resourceGroups/${resourceGroup}/providers/${AZURE_WAF_POLICY_TYPES[kind]}/${name}`,
    subscriptionId: subscriptionId.toLowerCase(),
    resourceGroup,
    name,
    kind,
  };
}

// The kind of a resource type, whatever case it is spelled in; null for anything else.
export function getAzureWafPolicyKind(
  type: string | undefined | null,
): AzureWafPolicyKind | null {
  const wanted: string = (type || "").trim().toLowerCase();

  return (
    (Object.values(AzureWafPolicyKind) as Array<AzureWafPolicyKind>).find(
      (kind: AzureWafPolicyKind): boolean => {
        return AZURE_WAF_POLICY_TYPES[kind].toLowerCase() === wanted;
      },
    ) || null
  );
}

// ---------- OneUptime's rules ----------

const RULE_NAME: RegExp = /^OneUptime([0-9a-f]{8})Block([1-9]\d{0,2})$/;

// A OneUptime rule's name: OneUptime1a2b3c4dBlock3.
export function getAzureWafRuleName(
  projectSuffix: string,
  index: number,
): string {
  return `OneUptime${projectSuffix}Block${index}`;
}

// The number of a OneUptime rule of this project, from its name; null for any other rule.
export function readAzureWafRuleIndex(
  name: unknown,
  projectSuffix: string,
): number | null {
  if (typeof name !== "string") {
    return null;
  }

  const match: RegExpExecArray | null = RULE_NAME.exec(name.trim());

  if (!match || match[1] !== projectSuffix) {
    return null;
  }

  return Number(match[2]);
}

/*
 * A block's value as an IP match condition holds it: a single address
 * bare, a range as it is. Null for anything that is not an address or a
 * range, for /0, and - on Application Gateway, whose IP match is IPv4 only
 * - for an IPv6 value.
 */
export function toAzureWafAddress(
  kind: AzureWafPolicyKind,
  value: string,
): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (!read || read.block.prefixLength === 0) {
    return null;
  }

  if (
    kind === AzureWafPolicyKind.ApplicationGateway &&
    read.block.family !== 4
  ) {
    return null;
  }

  return read.value;
}

// One of OneUptime's rules as the policy holds it.
export function buildAzureWafRule(data: {
  kind: AzureWafPolicyKind;
  name: string;
  priority: number;
  values: ReadonlyArray<string>;
  matchVariable: AzureWafMatchVariable;
}): JSONObject {
  const values: Array<string> = data.values
    .map((value: string): string | null => {
      return toAzureWafAddress(data.kind, value);
    })
    .filter((value: string | null): value is string => {
      return Boolean(value);
    });

  if (data.kind === AzureWafPolicyKind.ApplicationGateway) {
    return {
      name: data.name,
      priority: data.priority,
      ruleType: "MatchRule",
      action: "Block",
      state: "Enabled",
      matchConditions: [
        {
          matchVariables: [{ variableName: "RemoteAddr" }],
          operator: "IPMatch",
          negationConditon: false,
          matchValues: values,
          transforms: [],
        },
      ],
    };
  }

  return {
    name: data.name,
    priority: data.priority,
    enabledState: "Enabled",
    ruleType: "MatchRule",
    action: "Block",
    matchConditions: [
      {
        matchVariable: data.matchVariable,
        operator: "IPMatch",
        negateCondition: false,
        matchValue: values,
        transforms: [],
      },
    ],
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

function readPriority(rule: JSONObject): number | null {
  const priority: unknown = rule["priority"];

  return typeof priority === "number" && Number.isInteger(priority)
    ? priority
    : null;
}

// A rule as the policy holds it, read for what it does.
export interface AzureWafRuleRead {
  name: string;
  priority: number | null;
  action: string;
  isEnabled: boolean;
  /*
   * Whether it is shaped as OneUptime writes its rules: a match rule, one
   * condition, an IP match that is not negated, with the action Block. A
   * rule of OneUptime's that is not was changed by hand.
   */
  isBlockOfAddresses: boolean;
  // What its one IP match condition reads; null when it has no such condition.
  matchVariable: string | null;
  // The addresses it holds, as blocks write values; those it cannot read are left out.
  values: Array<string>;
}

export function readAzureWafRule(
  kind: AzureWafPolicyKind,
  value: unknown,
): AzureWafRuleRead {
  const rule: JSONObject = readObject(value);
  const conditions: Array<JSONValue> = readList(rule["matchConditions"]);
  const condition: JSONObject = readObject(conditions[0]);
  const action: string = readText(rule["action"]);
  let matchVariable: string | null = null;
  let rawValues: Array<JSONValue> = [];
  let isNegated: boolean = false;

  if (kind === AzureWafPolicyKind.ApplicationGateway) {
    const variables: Array<JSONValue> = readList(condition["matchVariables"]);
    const variable: JSONObject = readObject(variables[0]);

    matchVariable =
      variables.length === 1 && !readText(variable["selector"])
        ? readText(variable["variableName"]) || null
        : null;
    rawValues = readList(condition["matchValues"]);
    isNegated = condition["negationConditon"] === true;
  } else {
    matchVariable = readText(condition["matchVariable"]) || null;
    rawValues = readList(condition["matchValue"]);
    isNegated = condition["negateCondition"] === true;
  }

  const values: Array<string> = [];

  for (const raw of rawValues) {
    const read: SecurityBlockValue | null = readSecurityBlockValue(raw);

    if (read) {
      values.push(read.value);
    }
  }

  const isEnabled: boolean =
    kind === AzureWafPolicyKind.ApplicationGateway
      ? readText(rule["state"]) !== "Disabled"
      : readText(rule["enabledState"]) !== "Disabled";

  return {
    name: readText(rule["name"]),
    priority: readPriority(rule),
    action,
    isEnabled,
    isBlockOfAddresses:
      conditions.length === 1 &&
      readText(condition["operator"]) === "IPMatch" &&
      !isNegated &&
      action === "Block" &&
      (readText(rule["ruleType"]) || "MatchRule") === "MatchRule" &&
      Boolean(matchVariable),
    matchVariable,
    values,
  };
}

// ---------- A policy as a whole ----------

// What a policy's read says of it, beside its rules.
export interface AzureWafPolicyFacts {
  // Every custom rule, as Azure listed it.
  customRules: Array<JSONObject>;
  // The policy runs at all: Application Gateway's state, Front Door's enabledState.
  isEnabled: boolean;
  // Prevention blocks; Detection only logs what a Block rule matches.
  mode: string;
  provisioningState: string;
  resourceState: string;
  // Whether it guards anything: a gateway, a listener or a path; a Front Door domain.
  isAttached: boolean;
  // How many addresses one of OneUptime's rules may hold here.
  addressesPerRule: number;
  // Front Door's tier: Classic_AzureFrontDoor, Standard_AzureFrontDoor, Premium_AzureFrontDoor.
  skuName: string;
  etag: string;
}

/*
 * Whether an Application Gateway policy's managed rules are CRS 3.2 or
 * newer, or a Default Rule Set: then a match condition holds 600 ranges.
 */
export function isAzureApplicationGatewayNewerRuleSet(
  policy: unknown,
): boolean {
  const sets: Array<JSONValue> = readList(
    readObject(readObject(readObject(policy)["properties"])["managedRules"])[
      "managedRuleSets"
    ],
  );

  return sets.some((value: JSONValue): boolean => {
    const set: JSONObject = readObject(value);
    const type: string = readText(set["ruleSetType"]).toLowerCase();
    const version: number = Number(readText(set["ruleSetVersion"]));

    return (
      type === "microsoft_defaultruleset" ||
      (type === "owasp" && Number.isFinite(version) && version >= 3.2)
    );
  });
}

export function readAzureWafPolicyFacts(
  kind: AzureWafPolicyKind,
  policy: unknown,
): AzureWafPolicyFacts {
  const json: JSONObject = readObject(policy);
  const properties: JSONObject = readObject(json["properties"]);
  const settings: JSONObject = readObject(properties["policySettings"]);
  const isGateway: boolean = kind === AzureWafPolicyKind.ApplicationGateway;
  const customRules: Array<JSONObject> = (
    isGateway
      ? readList(properties["customRules"])
      : readList(readObject(properties["customRules"])["rules"])
  ).map((rule: JSONValue): JSONObject => {
    return readObject(rule);
  });
  const attachments: number = isGateway
    ? readList(properties["applicationGateways"]).length +
      readList(properties["httpListeners"]).length +
      readList(properties["pathBasedRules"]).length +
      readList(properties["applicationGatewayForContainers"]).length
    : readList(properties["frontendEndpointLinks"]).length +
      readList(properties["securityPolicyLinks"]).length +
      readList(properties["routingRuleLinks"]).length;

  return {
    customRules,
    isEnabled: isGateway
      ? readText(settings["state"]) !== "Disabled"
      : readText(settings["enabledState"]) !== "Disabled",
    mode: readText(settings["mode"]) || "Prevention",
    provisioningState: readText(properties["provisioningState"]),
    resourceState: readText(properties["resourceState"]),
    isAttached: attachments > 0,
    addressesPerRule: isGateway
      ? isAzureApplicationGatewayNewerRuleSet(json)
        ? AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE_NEWER
        : AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE
      : AZURE_FRONT_DOOR_WAF_ADDRESSES_PER_RULE,
    skuName: readText(readObject(json["sku"])["name"]),
    etag: readText(json["etag"]),
  };
}

/*
 * The priority of the first rule that lets a request through - an Allow
 * rule, on or off (it may be turned on again): OneUptime's rules go before
 * it. Null when the policy has none.
 */
export function getAzureWafPassPriority(
  rules: ReadonlyArray<JSONObject>,
): number | null {
  const priorities: Array<number> = rules
    .filter((rule: JSONObject): boolean => {
      return readText(rule["action"]) === "Allow";
    })
    .map((rule: JSONObject): number | null => {
      return readPriority(rule);
    })
    .filter((priority: number | null): priority is number => {
      return priority !== null;
    });

  return priorities.length > 0 ? Math.min(...priorities) : null;
}

/*
 * The properties Azure answers that a write must not send: they are the
 * policy's state and what it is attached to, never its settings.
 */
const READ_ONLY_PROPERTIES: Readonly<
  Record<AzureWafPolicyKind, Array<string>>
> = {
  [AzureWafPolicyKind.ApplicationGateway]: [
    "provisioningState",
    "resourceState",
    "applicationGateways",
    "httpListeners",
    "pathBasedRules",
    "applicationGatewayForContainers",
  ],
  [AzureWafPolicyKind.FrontDoor]: [
    "provisioningState",
    "resourceState",
    "frontendEndpointLinks",
    "routingRuleLinks",
    "securityPolicyLinks",
  ],
};

/*
 * The policy as it is written back: everything Azure answered - every
 * setting, managed rule and custom rule of the customer's, as it was - with
 * the custom rules given in their place and the read-only state left out.
 * The ETag goes in If-Match, not in the body.
 */
export function buildAzureWafPolicyWrite(data: {
  kind: AzureWafPolicyKind;
  policy: JSONObject;
  customRules: Array<JSONObject>;
}): JSONObject {
  const copy: JSONObject = JSON.parse(
    JSON.stringify(data.policy),
  ) as JSONObject;
  const properties: JSONObject = readObject(copy["properties"]);

  for (const key of READ_ONLY_PROPERTIES[data.kind]) {
    delete properties[key];
  }

  const customRules: Array<JSONObject> = data.customRules.map(
    (rule: JSONObject): JSONObject => {
      const written: JSONObject = JSON.parse(
        JSON.stringify(rule),
      ) as JSONObject;

      // Each custom rule's own etag is Azure's to set.
      delete written["etag"];

      return written;
    },
  );

  if (data.kind === AzureWafPolicyKind.ApplicationGateway) {
    properties["customRules"] = customRules;

    // A managed rule set's computed list is Azure's to work out.
    for (const set of readList(
      readObject(properties["managedRules"])["managedRuleSets"],
    )) {
      delete readObject(set)["computedDisabledRules"];
    }
  } else {
    properties["customRules"] = {
      ...readObject(properties["customRules"]),
      rules: customRules,
    };
  }

  delete copy["etag"];
  copy["properties"] = properties;

  return copy;
}

// ---------- What OneUptime keeps of a policy ----------

// A OneUptime rule as OneUptime last wrote it.
export interface AzureWafRecordedRule {
  index: number;
  name: string;
  priority: number;
  values: Array<string>;
}

// How a OneUptime rule was changed by hand, as its last read found it.
export enum AzureWafRuleDrift {
  TurnedOff = "turnedOff",
  Changed = "changed",
  Deleted = "deleted",
}

/*
 * What a row keeps of its policy (SecurityBlockCloudWaf.ruleDetails): the
 * rules OneUptime last wrote, with what each held - so a rule someone
 * deleted is known, and its blocks said not to be enforced, rather than
 * written again behind their back - the match variable they read, and
 * where the policy stood at the last read.
 */
export interface AzureWafRuleDetails {
  kind: AzureWafPolicyKind;
  matchVariable: AzureWafMatchVariable;
  addressesPerRule: number;
  maxRules: number;
  rules: Array<AzureWafRecordedRule>;
  // One past the highest number any of OneUptime's rules took here.
  nextIndex: number;
  // OneUptime's rules changed by hand, by name.
  drift: Array<{ name: string; drift: AzureWafRuleDrift }>;
  // The priorities OneUptime's next rules take: its reserved run, as the last read found it.
  freePriorities: Array<number>;
  /*
   * Whether the last write had a block it could not place for want of a
   * free priority: the policy says No Free Priority until one is free.
   */
  isWaitingForPriority: boolean;
  policy: {
    isEnabled: boolean;
    mode: string;
    isAttached: boolean;
    provisioningState: string;
    skuName: string;
  };
}

export function readAzureWafRuleDetails(
  value: unknown,
): AzureWafRuleDetails | null {
  const json: JSONObject = readObject(value);
  const kind: string = readText(json["kind"]);

  if (!(Object.values(AzureWafPolicyKind) as Array<string>).includes(kind)) {
    return null;
  }

  const rules: Array<AzureWafRecordedRule> = [];

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
      name: readText(rule["name"]),
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

  const drift: Array<{ name: string; drift: AzureWafRuleDrift }> = [];

  for (const entry of readList(json["drift"])) {
    const item: JSONObject = readObject(entry);
    const kindOfDrift: string = readText(item["drift"]);

    if (
      (Object.values(AzureWafRuleDrift) as Array<string>).includes(kindOfDrift)
    ) {
      drift.push({
        name: readText(item["name"]),
        drift: kindOfDrift as AzureWafRuleDrift,
      });
    }
  }

  const policy: JSONObject = readObject(json["policy"]);
  const nextIndex: unknown = json["nextIndex"];
  const addressesPerRule: unknown = json["addressesPerRule"];
  const maxRules: unknown = json["maxRules"];

  return {
    kind: kind as AzureWafPolicyKind,
    matchVariable:
      readText(json["matchVariable"]) === "RemoteAddr"
        ? "RemoteAddr"
        : "SocketAddr",
    addressesPerRule:
      typeof addressesPerRule === "number" && addressesPerRule > 0
        ? addressesPerRule
        : AZURE_APPLICATION_GATEWAY_WAF_ADDRESSES_PER_RULE,
    maxRules:
      typeof maxRules === "number" && maxRules >= 0
        ? maxRules
        : AZURE_WAF_MAX_ONEUPTIME_RULES,
    rules,
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
    policy: {
      isEnabled: policy["isEnabled"] !== false,
      mode: readText(policy["mode"]) || "Prevention",
      isAttached: policy["isAttached"] !== false,
      provisioningState: readText(policy["provisioningState"]),
      skuName: readText(policy["skuName"]),
    },
  };
}

export function toAzureWafRuleDetailsJson(
  details: AzureWafRuleDetails,
): JSONObject {
  return {
    kind: details.kind,
    matchVariable: details.matchVariable,
    addressesPerRule: details.addressesPerRule,
    maxRules: details.maxRules,
    rules: details.rules.map((rule: AzureWafRecordedRule): JSONObject => {
      return {
        index: rule.index,
        name: rule.name,
        priority: rule.priority,
        values: [...rule.values],
      };
    }),
    nextIndex: details.nextIndex,
    drift: details.drift.map(
      (item: { name: string; drift: AzureWafRuleDrift }): JSONObject => {
        return { name: item.name, drift: item.drift };
      },
    ),
    freePriorities: [...details.freePriorities],
    isWaitingForPriority: details.isWaitingForPriority,
    policy: { ...details.policy },
  };
}

// The slots of the recorded rules, as a pass plans them.
export function toAzureWafSlots(
  rules: ReadonlyArray<AzureWafRecordedRule>,
  frozen: ReadonlySet<number>,
): Array<CloudWafValueSlot> {
  return rules.map((rule: AzureWafRecordedRule): CloudWafValueSlot => {
    return {
      index: rule.index,
      priority: rule.priority,
      values: [...rule.values],
      isFrozen: frozen.has(rule.index),
    };
  });
}

// Whether two lists hold the same addresses, in any order.
export function isSameAzureWafValues(
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

// ---------- A policy, read against what OneUptime wrote ----------

// Where one of OneUptime's rules stands, as a read finds it.
export enum AzureWafOwnRuleState {
  // As OneUptime writes it.
  InForce = "inForce",
  /*
   * As OneUptime wrote it, reading the address it read before the person
   * changed the Client Address in OneUptime: written again with the new
   * one, not changed by hand.
   */
  ToRewrite = "toRewrite",
  TurnedOff = "turnedOff",
  Changed = "changed",
}

export interface AzureWafOwnRule {
  index: number;
  name: string;
  priority: number;
  state: AzureWafOwnRuleState;
  values: Array<string>;
  // The rule as Azure holds it, every field it has.
  json: JSONObject;
}

export interface AzureWafPolicyAnalysis {
  facts: AzureWafPolicyFacts;
  // OneUptime's rules of this project the policy holds, by number.
  own: Array<AzureWafOwnRule>;
  // OneUptime's rules it wrote that the policy no longer holds.
  deleted: Array<AzureWafRecordedRule>;
  // Every other rule: the customer's, and another project's.
  others: Array<JSONObject>;
  // The priority of the first rule that lets a request through.
  passPriority: number | null;
  // The priorities a new rule of OneUptime's may take, lowest first.
  freePriorities: Array<number>;
  // The most rules OneUptime may hold here, those it holds and those deleted included.
  maxRules: number;
  // One past the highest number any of OneUptime's rules took.
  nextIndex: number;
}

export function classifyAzureWafOwnRule(data: {
  read: AzureWafRuleRead;
  expectedVariable: AzureWafMatchVariable;
  lastWrittenVariable: AzureWafMatchVariable | null;
}): AzureWafOwnRuleState {
  const { read } = data;
  const isOursToRead: boolean =
    read.matchVariable === "RemoteAddr" || read.matchVariable === "SocketAddr";

  if (!read.isBlockOfAddresses || !isOursToRead) {
    return AzureWafOwnRuleState.Changed;
  }

  if (read.matchVariable !== data.expectedVariable) {
    if (read.matchVariable !== (data.lastWrittenVariable || "")) {
      return AzureWafOwnRuleState.Changed;
    }

    return read.isEnabled
      ? AzureWafOwnRuleState.ToRewrite
      : AzureWafOwnRuleState.TurnedOff;
  }

  return read.isEnabled
    ? AzureWafOwnRuleState.InForce
    : AzureWafOwnRuleState.TurnedOff;
}

export function analyzeAzureWafPolicy(data: {
  kind: AzureWafPolicyKind;
  policy: JSONObject;
  projectSuffix: string;
  expectedVariable: AzureWafMatchVariable;
  details: AzureWafRuleDetails | null;
}): AzureWafPolicyAnalysis {
  const facts: AzureWafPolicyFacts = readAzureWafPolicyFacts(
    data.kind,
    data.policy,
  );
  const own: Array<AzureWafOwnRule> = [];
  const others: Array<JSONObject> = [];

  for (const rule of facts.customRules) {
    const read: AzureWafRuleRead = readAzureWafRule(data.kind, rule);
    const index: number | null = readAzureWafRuleIndex(
      read.name,
      data.projectSuffix,
    );

    if (index === null || read.priority === null) {
      others.push(rule);
      continue;
    }

    own.push({
      index,
      name: read.name,
      priority: read.priority,
      state: classifyAzureWafOwnRule({
        read,
        expectedVariable: data.expectedVariable,
        lastWrittenVariable: data.details?.matchVariable || null,
      }),
      values: uniqueAzureWafValues(read.values),
      json: rule,
    });
  }

  own.sort((a: AzureWafOwnRule, b: AzureWafOwnRule): number => {
    return a.index - b.index;
  });

  const liveIndexes: Set<number> = new Set(
    own.map((rule: AzureWafOwnRule): number => {
      return rule.index;
    }),
  );
  const deleted: Array<AzureWafRecordedRule> = (data.details?.rules || [])
    .filter((rule: AzureWafRecordedRule): boolean => {
      return !liveIndexes.has(rule.index);
    })
    .map((rule: AzureWafRecordedRule): AzureWafRecordedRule => {
      return { ...rule, values: [...rule.values] };
    });
  const usedPriorities: Array<number> = facts.customRules
    .map((rule: JSONObject): number | null => {
      return readPriority(rule);
    })
    .filter((priority: number | null): priority is number => {
      return priority !== null;
    });
  const passPriority: number | null = getAzureWafPassPriority(others);
  const maxRules: number = Math.max(
    0,
    Math.min(
      AZURE_WAF_MAX_ONEUPTIME_RULES,
      AZURE_WAF_MAX_CUSTOM_RULES - others.length,
    ),
  );
  const last: number =
    passPriority === null
      ? AZURE_WAF_HIGHEST_PRIORITY
      : Math.min(AZURE_WAF_HIGHEST_PRIORITY, passPriority - 1);
  const used: Set<number> = new Set(usedPriorities);
  const freePriorities: Array<number> = [];

  for (
    let priority: number = AZURE_WAF_LOWEST_PRIORITY;
    priority <= last && freePriorities.length < AZURE_WAF_MAX_ONEUPTIME_RULES;
    priority++
  ) {
    if (!used.has(priority)) {
      freePriorities.push(priority);
    }
  }

  return {
    facts,
    own,
    deleted,
    others,
    passPriority,
    freePriorities,
    maxRules,
    nextIndex: Math.max(
      data.details?.nextIndex || 1,
      ...own.map((rule: AzureWafOwnRule): number => {
        return rule.index + 1;
      }),
      ...deleted.map((rule: AzureWafRecordedRule): number => {
        return rule.index + 1;
      }),
      1,
    ),
  };
}

// ---------- The role that lets OneUptime write a policy ----------

/*
 * A custom role of read and write on both kinds of WAF policy - never
 * delete, never anything else - assigned to the connection's app. Writing
 * a policy writes its custom rules: OneUptime changes none but its own.
 */
export const AZURE_WAF_BLOCKLIST_ROLE: string = "OneUptime WAF Blocklist";

export const AZURE_WAF_BLOCKLIST_ACTIONS: Array<string> = [
  "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/read",
  "Microsoft.Network/ApplicationGatewayWebApplicationFirewallPolicies/write",
  "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/read",
  "Microsoft.Network/FrontDoorWebApplicationFirewallPolicies/write",
];

// What a picked policy of each kind takes: read it and write it.
export function getAzureWafRequiredActions(
  kind: AzureWafPolicyKind,
): Array<string> {
  return [
    `${AZURE_WAF_POLICY_TYPES[kind]}/read`,
    `${AZURE_WAF_POLICY_TYPES[kind]}/write`,
  ];
}

const ROLE_DESCRIPTION: string =
  "OneUptime: read and write the Azure WAF policies it enforces your blocklist in. It changes only its own rules.";

/*
 * The role as az role definition takes it, built by jq in the shell where
 * the scope it may be assigned at ($SCOPE) is known: for the setup command.
 */
export function getAzureWafBlocklistRoleLines(): Array<string> {
  const actions: string = AZURE_WAF_BLOCKLIST_ACTIONS.map(
    (action: string): string => {
      return `"${action}"`;
    },
  ).join(", ");

  return [
    `WAF_ROLE=$(jq -n --arg scope "$SCOPE" '{Name: "${AZURE_WAF_BLOCKLIST_ROLE}", IsCustom: true, Description: "${ROLE_DESCRIPTION}", Actions: [${actions}], NotActions: [], AssignableScopes: [$scope]}')`,
    `az role definition create --role-definition "$WAF_ROLE" > /dev/null 2>&1 || az role definition update --role-definition "$WAF_ROLE" > /dev/null`,
    `az role assignment create --assignee "$APP" --role "${AZURE_WAF_BLOCKLIST_ROLE}" --scope "$SCOPE" > /dev/null`,
  ];
}

/*
 * The lines that let a connection's app write one picked policy, for a
 * connection set up before it could: the role made, or its assignable
 * scopes widened to the policy's subscription (another subscription's
 * assignments are kept), then assigned on the policy alone - so OneUptime
 * may write that policy and no other.
 *
 * The role is looked for where the policy is first, then in Cloud Shell's
 * own subscription. az role definition update finds an existing role by
 * its full id and needs its roleName with it (azure-cli's
 * _create_update_role_definition), so both come from the list's answer.
 */
export function getAzureWafPolicyAccessCommand(data: {
  clientId: string;
  policy: AzureWafPolicyRef;
}): string {
  const actions: string = AZURE_WAF_BLOCKLIST_ACTIONS.map(
    (action: string): string => {
      return `"${action}"`;
    },
  ).join(", ");

  return [
    `SCOPE="/subscriptions/${data.policy.subscriptionId}"`,
    `ROLE=$(az role definition list --custom-role-only true --name "${AZURE_WAF_BLOCKLIST_ROLE}" --scope "$SCOPE" --query "[0]" --output json)`,
    `if [ -z "$ROLE" ] || [ "$ROLE" = "null" ]; then ROLE=$(az role definition list --custom-role-only true --name "${AZURE_WAF_BLOCKLIST_ROLE}" --query "[0]" --output json); fi`,
    `if [ -n "$ROLE" ] && [ "$ROLE" != "null" ]; then`,
    `  az role definition update --role-definition "$(echo "$ROLE" | jq --arg scope "$SCOPE" '{Id: .id, RoleName: .roleName, IsCustom: true, Description: "${ROLE_DESCRIPTION}", Actions: [${actions}], NotActions: [], AssignableScopes: ((.assignableScopes + [$scope]) | unique)}')" > /dev/null`,
    `else`,
    `  az role definition create --role-definition "$(jq -n --arg scope "$SCOPE" '{Name: "${AZURE_WAF_BLOCKLIST_ROLE}", IsCustom: true, Description: "${ROLE_DESCRIPTION}", Actions: [${actions}], NotActions: [], AssignableScopes: [$scope]}')" > /dev/null`,
    `fi`,
    `az role assignment create --assignee "${data.clientId}" --role "${AZURE_WAF_BLOCKLIST_ROLE}" --scope "${data.policy.id}" > /dev/null`,
  ].join("\n");
}

/*
 * Whether an action is allowed by the actions and not-actions of the
 * caller's permissions at a scope (Microsoft.Authorization/permissions),
 * whose wildcards ("*", "Microsoft.Network/*") Azure matches without case.
 */
export function isAzureActionPermitted(data: {
  action: string;
  permissions: ReadonlyArray<{
    actions: ReadonlyArray<string>;
    notActions: ReadonlyArray<string>;
  }>;
}): boolean {
  const matches: (pattern: string) => boolean = (pattern: string): boolean => {
    const escaped: string = pattern
      .trim()
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");

    return new RegExp(`^${escaped}$`, "i").test(data.action);
  };

  return data.permissions.some(
    (permission: {
      actions: ReadonlyArray<string>;
      notActions: ReadonlyArray<string>;
    }): boolean => {
      return (
        permission.actions.some(matches) && !permission.notActions.some(matches)
      );
    },
  );
}

// A destination's name, as a block's Enforced At reads it: "Azure WAF (prod-waf)".
export function getAzureWafDestinationName(name: string): string {
  return `Azure WAF (${name})`;
}

// Where a policy is, as its kind's console names it.
export const AZURE_WAF_KIND_TITLES: Readonly<
  Record<AzureWafPolicyKind, string>
> = {
  [AzureWafPolicyKind.ApplicationGateway]: "Application Gateway",
  [AzureWafPolicyKind.FrontDoor]: "Front Door",
};

// The policy's page in the Azure portal.
export function getAzureWafPortalUrl(policy: AzureWafPolicyRef): string {
  return `https://portal.azure.com/#@/resource${policy.id}/overview`;
}

// The values of a rule as blocks write them, deduplicated, the order kept.
export function uniqueAzureWafValues(
  values: ReadonlyArray<string>,
): Array<string> {
  const seen: Set<string> = new Set();
  const unique: Array<string> = [];

  for (const value of values) {
    const key: string = getCloudWafValueKey(value);

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(value);
    }
  }

  return unique;
}
