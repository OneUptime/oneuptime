import { JSONObject, JSONValue } from "../JSON";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../Utils/NetworkTraffic/NetworkAddressBlock";
import {
  SECURITY_BLOCK_ADDRESS_ACTIONS,
  SecurityBlockAction,
  SecurityBlockValue,
  readSecurityBlockValue,
} from "./SecurityBlock";

/*
 * BLOCKING ADDRESSES AT CLOUDFLARE (#10343): what OneUptime sets up in a
 * Cloudflare account to enforce a project's blocklist, and what a Cloudflare
 * connection keeps of it. Pure, read by the server (Connectors/Cloudflare)
 * and the Dashboard alike.
 *
 * Everything OneUptime adds is named as OneUptime's and never mixed with the
 * customer's own:
 *
 *   - two account-level IP lists, oneuptime_block and oneuptime_challenge
 *     (https://developers.cloudflare.com/waf/tools/lists/), whose
 *     description names the OneUptime project that manages them;
 *   - in each zone blocking is on in, one WAF custom rule per list in the
 *     zone's http_request_firewall_custom phase: (ip.src in $oneuptime_block)
 *     blocks, (ip.src in $oneuptime_challenge) gives a Managed Challenge.
 *     Each has a stable ref, and the description says it is OneUptime's;
 *   - a block is one list item, whose comment says the case it was made for
 *     and when it ends ("OneUptime case CASE-123 until 2026-11-21 10:42
 *     UTC"): items without such a comment are someone else's, and OneUptime
 *     never reads them back, nor removes them;
 *   - on a plan without a list or a rule to spare, IP Access Rules instead
 *     (https://developers.cloudflare.com/waf/tools/ip-access-rules/), one a
 *     block, with the same note. Cloudflare recommends custom rules over
 *     them, so they are used only where lists cannot be.
 *
 * Which of the two each action uses is chosen when blocking is turned on
 * (chooseCloudflareBlockingMechanisms), Block before Challenge, and kept
 * until it is turned off: moving a mechanism would move every block.
 */

// ---------- What OneUptime names in Cloudflare ----------

/*
 * The lists, by action. A list's name is lowercase letters, digits and
 * underscores, at most 50 characters.
 */
export const CLOUDFLARE_BLOCK_LIST_NAMES: Readonly<
  Record<SecurityBlockAction, string>
> = {
  [SecurityBlockAction.Block]: "oneuptime_block",
  [SecurityBlockAction.Challenge]: "oneuptime_challenge",
  // A file's (#10346): Cloudflare holds addresses only (supports()), so it never sets one up.
  [SecurityBlockAction.BlockAndQuarantine]: "oneuptime_block",
};

// The custom rules' stable refs, by action: how OneUptime finds its rule in a zone.
export const CLOUDFLARE_BLOCK_RULE_REFS: Readonly<
  Record<SecurityBlockAction, string>
> = {
  [SecurityBlockAction.Block]: "oneuptime_blocklist_block",
  [SecurityBlockAction.Challenge]: "oneuptime_blocklist_challenge",
  // A file's (#10346): Cloudflare holds addresses only (supports()), so it never sets one up.
  [SecurityBlockAction.BlockAndQuarantine]: "oneuptime_blocklist_block",
};

// What each rule does, as the Rulesets API names the action.
export const CLOUDFLARE_BLOCK_RULE_ACTIONS: Readonly<
  Record<SecurityBlockAction, string>
> = {
  [SecurityBlockAction.Block]: "block",
  // Cloudflare's recommended challenge, not the JS Challenge.
  [SecurityBlockAction.Challenge]: "managed_challenge",
  // A file's (#10346): Cloudflare holds addresses only (supports()), so it never sets one up.
  [SecurityBlockAction.BlockAndQuarantine]: "block",
};

// What an IP Access Rule does, by action (its mode).
export const CLOUDFLARE_ACCESS_RULE_MODES: Readonly<
  Record<SecurityBlockAction, string>
> = {
  [SecurityBlockAction.Block]: "block",
  [SecurityBlockAction.Challenge]: "managed_challenge",
  // A file's (#10346): Cloudflare holds addresses only (supports()), so it never sets one up.
  [SecurityBlockAction.BlockAndQuarantine]: "block",
};

export const CLOUDFLARE_BLOCK_RULE_DESCRIPTION: string =
  "Managed by OneUptime: addresses blocked from security cases. Change them in OneUptime.";

// The phase custom rules run in, and the entry point OneUptime adds its rules to.
export const CLOUDFLARE_CUSTOM_RULES_PHASE: string =
  "http_request_firewall_custom";

export function getCloudflareBlockRuleExpression(
  action: SecurityBlockAction,
): string {
  return `(ip.src in $${CLOUDFLARE_BLOCK_LIST_NAMES[action]})`;
}

const LIST_DESCRIPTION_START: string = "Managed by OneUptime project ";

// A project's id, as a list's description names it.
const PROJECT_ID_TEXT: RegExp = /^[0-9a-f-]{36}$/;

// The comment (or note) OneUptime writes on each block: "OneUptime case CASE-123 until ...".
const ONEUPTIME_COMMENT: RegExp = /^OneUptime (case|blocklist)\b/;

// A "not" or "!" just before a condition, which makes it no allow of its addresses.
const NEGATION_BEFORE: RegExp = /(\bnot|!)\s*\(?\s*$/i;

/*
 * A list's description: the project that manages it, so a second OneUptime
 * project connected to the same account never takes it over, which would
 * remove the first project's blocks.
 */
export function getCloudflareBlockListDescription(projectId: string): string {
  return `${LIST_DESCRIPTION_START}${projectId}: addresses blocked from security cases. Change them in OneUptime.`;
}

// The project a list's description names, or null for a list no OneUptime project names.
export function readCloudflareBlockListProjectId(
  description: string | null | undefined,
): string | null {
  const text: string = (description || "").trim();

  if (!text.startsWith(LIST_DESCRIPTION_START)) {
    return null;
  }

  const id: string = text
    .slice(LIST_DESCRIPTION_START.length)
    .split(":")[0]!
    .trim()
    .toLowerCase();

  return PROJECT_ID_TEXT.test(id) ? id : null;
}

// Whether an item's comment (or an access rule's note) says OneUptime added it.
export function isOneUptimeCloudflareComment(
  comment: string | null | undefined,
): boolean {
  return ONEUPTIME_COMMENT.test((comment || "").trim());
}

// ---------- Plans ----------

/*
 * A zone's plan, as its plan.legacy_id names it. Lists follow the account's
 * highest plan; custom rules follow each zone's own.
 */
export enum CloudflarePlan {
  Free = "free",
  Pro = "pro",
  Business = "business",
  Enterprise = "enterprise",
}

const PLAN_ORDER: ReadonlyArray<CloudflarePlan> = [
  CloudflarePlan.Free,
  CloudflarePlan.Pro,
  CloudflarePlan.Business,
  CloudflarePlan.Enterprise,
];

export interface CloudflarePlanLimits {
  // Custom lists of any kind in the account.
  lists: number;
  // Items across all of the account's lists.
  listItems: number;
  // Custom rules in a zone's http_request_firewall_custom phase.
  customRulesPerZone: number;
}

/*
 * https://developers.cloudflare.com/waf/tools/lists/ and
 * https://developers.cloudflare.com/waf/custom-rules/ (November 2026).
 */
export const CLOUDFLARE_PLAN_LIMITS: Readonly<
  Record<CloudflarePlan, CloudflarePlanLimits>
> = {
  [CloudflarePlan.Free]: {
    lists: 1,
    listItems: 10000,
    customRulesPerZone: 5,
  },
  [CloudflarePlan.Pro]: {
    lists: 10,
    listItems: 10000,
    customRulesPerZone: 20,
  },
  [CloudflarePlan.Business]: {
    lists: 10,
    listItems: 10000,
    customRulesPerZone: 100,
  },
  [CloudflarePlan.Enterprise]: {
    lists: 1000,
    listItems: 500000,
    customRulesPerZone: 1000,
  },
};

// IP Access Rules an account holds, on every plan.
export const CLOUDFLARE_ACCESS_RULES_PER_ACCOUNT: number = 50000;

/*
 * A zone's plan from its legacy id ("free", "pro", "business",
 * "enterprise"). A plan Cloudflare names otherwise is read as Free: its
 * limits are the smallest, so OneUptime never counts on room it may not have.
 */
export function readCloudflarePlan(
  legacyId: string | null | undefined,
): CloudflarePlan {
  const id: string = (legacyId || "").trim().toLowerCase();

  return (PLAN_ORDER as ReadonlyArray<string>).includes(id)
    ? (id as CloudflarePlan)
    : CloudflarePlan.Free;
}

export function getHighestCloudflarePlan(
  plans: ReadonlyArray<CloudflarePlan>,
): CloudflarePlan {
  let highest: CloudflarePlan = CloudflarePlan.Free;

  for (const plan of plans) {
    if (PLAN_ORDER.indexOf(plan) > PLAN_ORDER.indexOf(highest)) {
      highest = plan;
    }
  }

  return highest;
}

// ---------- The permissions blocking needs ----------

// As Cloudflare's token form names them.
export const CLOUDFLARE_LIST_EDIT_PERMISSION: string =
  "Account > Account Filter Lists > Edit";
export const CLOUDFLARE_WAF_EDIT_PERMISSION: string = "Zone > Zone WAF > Edit";
export const CLOUDFLARE_ACCESS_RULES_EDIT_PERMISSION: string =
  "Account > Account Firewall Access Rules > Edit";

// ---------- Which mechanism each action uses ----------

export enum CloudflareBlockingMechanism {
  // An IP list and one custom rule per zone.
  List = "List",
  // One IP Access Rule a block, for the whole account.
  AccessRules = "AccessRules",
}

// Why an action uses IP Access Rules, not a list.
export enum CloudflareAccessRulesReason {
  // The account's plan has no list to spare: Free has one, and the customer uses it.
  NoListLeft = "NoListLeft",
  // A zone has no custom rule to spare.
  NoRuleLeft = "NoRuleLeft",
}

export interface CloudflareMechanismChoice {
  mechanism: CloudflareBlockingMechanism;
  reason?: CloudflareAccessRulesReason | undefined;
  // For NoListLeft: the account's plan and how many lists it allows.
  plan?: CloudflarePlan | undefined;
  lists?: number | undefined;
  // For NoRuleLeft: the zone, and its custom rules used of how many.
  zoneName?: string | undefined;
  rulesUsed?: number | undefined;
  rulesLimit?: number | undefined;
}

export interface CloudflareZoneRoom {
  id: string;
  name: string;
  plan: CloudflarePlan;
  // Rules in the zone's custom rules phase, OneUptime's among them.
  ruleCount: number;
  // The actions whose OneUptime rule the zone holds already.
  oneUptimeRules: ReadonlyArray<SecurityBlockAction>;
}

/*
 * The mechanism of each action, Block first: a list where the account has a
 * list to spare (or holds OneUptime's already) and every zone has a custom
 * rule to spare (or holds OneUptime's already); IP Access Rules where not,
 * and why. On Free, whose one list the customer does not use, Block takes
 * the list and Challenge goes to IP Access Rules; where the customer uses
 * it, both do.
 */
export function chooseCloudflareBlockingMechanisms(data: {
  // The account's highest plan.
  plan: CloudflarePlan;
  // The account's lists that are not OneUptime's.
  customerListCount: number;
  // The actions whose OneUptime list the account holds already.
  oneUptimeLists: ReadonlyArray<SecurityBlockAction>;
  zones: ReadonlyArray<CloudflareZoneRoom>;
}): Record<SecurityBlockAction, CloudflareMechanismChoice> {
  const listLimit: number = CLOUDFLARE_PLAN_LIMITS[data.plan].lists;
  let listsLeft: number = Math.max(
    0,
    listLimit - data.customerListCount - data.oneUptimeLists.length,
  );
  const rulesLeft: Map<string, number> = new Map();

  for (const zone of data.zones) {
    rulesLeft.set(
      zone.id,
      Math.max(
        0,
        CLOUDFLARE_PLAN_LIMITS[zone.plan].customRulesPerZone - zone.ruleCount,
      ),
    );
  }

  const choices: Partial<
    Record<SecurityBlockAction, CloudflareMechanismChoice>
  > = {};

  for (const action of SECURITY_BLOCK_ADDRESS_ACTIONS) {
    const hasList: boolean = data.oneUptimeLists.includes(action);

    if (!hasList && listsLeft <= 0) {
      choices[action] = {
        mechanism: CloudflareBlockingMechanism.AccessRules,
        reason: CloudflareAccessRulesReason.NoListLeft,
        plan: data.plan,
        lists: listLimit,
      };
      continue;
    }

    const fullZone: CloudflareZoneRoom | undefined = data.zones.find(
      (zone: CloudflareZoneRoom): boolean => {
        return (
          !zone.oneUptimeRules.includes(action) &&
          (rulesLeft.get(zone.id) || 0) <= 0
        );
      },
    );

    if (fullZone) {
      choices[action] = {
        mechanism: CloudflareBlockingMechanism.AccessRules,
        reason: CloudflareAccessRulesReason.NoRuleLeft,
        zoneName: fullZone.name,
        rulesUsed: fullZone.ruleCount,
        rulesLimit: CLOUDFLARE_PLAN_LIMITS[fullZone.plan].customRulesPerZone,
      };
      continue;
    }

    // The list and a rule in every zone are this action's now.
    if (!hasList) {
      listsLeft--;
    }

    for (const zone of data.zones) {
      if (!zone.oneUptimeRules.includes(action)) {
        rulesLeft.set(zone.id, (rulesLeft.get(zone.id) || 0) - 1);
      }
    }

    choices[action] = { mechanism: CloudflareBlockingMechanism.List };
  }

  return choices as Record<SecurityBlockAction, CloudflareMechanismChoice>;
}

// ---------- What each mechanism holds ----------

/*
 * Why an IP list cannot hold a value, or null when it can: single addresses,
 * IPv4 ranges from /8 to /32 and IPv6 ranges from /12 to /128
 * (https://developers.cloudflare.com/waf/tools/lists/custom-lists/). Every
 * value the blocklist keeps fits; this is kept for a value read back.
 */
export function getCloudflareListValueProblem(value: string): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (!read) {
    return "Cloudflare's lists take IP addresses and ranges only";
  }

  const block: NetworkAddressBlock = read.block;

  if (block.family === 4 && block.prefixLength < 8) {
    return "Cloudflare's lists take IPv4 ranges of /8 or narrower";
  }

  if (block.family === 6 && block.prefixLength < 12) {
    return "Cloudflare's lists take IPv6 ranges of /12 or narrower";
  }

  return null;
}

const ACCESS_RULE_IPV4_PREFIXES: ReadonlyArray<number> = [16, 24, 32];
const ACCESS_RULE_IPV6_PREFIXES: ReadonlyArray<number> = [32, 48, 64, 128];

/*
 * Why an IP Access Rule cannot hold a value, or null when it can: single
 * addresses, IPv4 ranges of /16 and /24, IPv6 ranges of /32, /48 and /64
 * (https://developers.cloudflare.com/waf/tools/ip-access-rules/parameters/).
 */
export function getCloudflareAccessRuleValueProblem(
  value: string,
): string | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (!read) {
    return "Cloudflare's IP Access Rules take IP addresses and ranges only";
  }

  const block: NetworkAddressBlock = read.block;

  if (
    block.family === 4 &&
    !ACCESS_RULE_IPV4_PREFIXES.includes(block.prefixLength)
  ) {
    return "Cloudflare's IP Access Rules take IPv4 ranges of /16 or /24 only";
  }

  if (
    block.family === 6 &&
    !ACCESS_RULE_IPV6_PREFIXES.includes(block.prefixLength)
  ) {
    return "Cloudflare's IP Access Rules take IPv6 ranges of /32, /48 or /64 only";
  }

  return null;
}

export interface CloudflareAccessRuleConfiguration {
  target: "ip" | "ip6" | "ip_range";
  value: string;
}

// How an IP Access Rule names a value: an address by its family, a range as a range.
export function toCloudflareAccessRuleConfiguration(
  value: string,
): CloudflareAccessRuleConfiguration | null {
  const read: SecurityBlockValue | null = readSecurityBlockValue(value);

  if (!read || getCloudflareAccessRuleValueProblem(value)) {
    return null;
  }

  const isAddress: boolean =
    read.block.prefixLength === (read.block.family === 4 ? 32 : 128);

  if (isAddress) {
    return {
      target: read.block.family === 4 ? "ip" : "ip6",
      value: read.value,
    };
  }

  return { target: "ip_range", value: read.value };
}

// ---------- The customer's skip rules ----------

// The longest expression read for addresses: a rule's expression is at most 4 KB.
const MAX_EXPRESSION_LENGTH: number = 8192;

/*
 * The addresses and ranges a rule's expression lets through by the client's
 * address: "ip.src in { 203.0.113.7 198.51.100.0/24 }" and
 * "ip.src eq 203.0.113.7" (or ==), not after a "not". OneUptime's own rules
 * run first in the phase, so a skip rule of the customer's no longer keeps
 * an address it names from a block: setup offers to protect them instead.
 * A list ($name) is not read. Each value once, as blocks are written.
 */
export function readCloudflareSkipRuleAddresses(
  expression: string | null | undefined,
): Array<string> {
  const text: string = (expression || "").slice(0, MAX_EXPRESSION_LENGTH);
  const found: Array<string> = [];

  const add: (raw: string) => void = (raw: string): void => {
    const read: SecurityBlockValue | null = readSecurityBlockValue(raw);

    if (read && !found.includes(read.value)) {
      found.push(read.value);
    }
  };

  const negated: (index: number) => boolean = (index: number): boolean => {
    return NEGATION_BEFORE.test(text.slice(Math.max(0, index - 6), index));
  };

  const setPattern: RegExp = /ip\.src\s+in\s*\{([^}]*)\}/gi;
  let match: RegExpExecArray | null = setPattern.exec(text);

  while (match) {
    if (!negated(match.index)) {
      for (const value of (match[1] || "").split(/\s+/)) {
        if (value.trim()) {
          add(value.trim());
        }
      }
    }

    match = setPattern.exec(text);
  }

  const equalsPattern: RegExp = /ip\.src\s*(?:\beq\b|==)\s*([0-9a-fA-F:.]+)/gi;
  match = equalsPattern.exec(text);

  while (match) {
    if (!negated(match.index)) {
      add(match[1] || "");
    }

    match = equalsPattern.exec(text);
  }

  return found;
}

// ---------- What a connection keeps of blocking ----------

/*
 * What the person chose, written only through the connection's blocking
 * routes: whether blocking is on, the zones it is on in (empty: every zone
 * the connection reads), and the work asked of OneUptime that the status
 * says when it has done.
 */
export interface CloudflareBlockingSettings {
  isEnabled: boolean;
  zoneIds: Array<string>;
  turnedOnAt?: string | undefined;
  // Set up (again): at turn-on, a change of zones, and Put It Back.
  setupRequestedAt?: string | undefined;
  // Put It Back in these zones only; every chosen zone when left out.
  setupZoneIds?: Array<string> | undefined;
  // Take OneUptime's lists and rules away from Cloudflare: asked at turn-off.
  removalRequestedAt?: string | undefined;
}

export enum CloudflareRuleState {
  // In place, on, and as OneUptime wrote it.
  Enforcing = "Enforcing",
  // Turned off at Cloudflare.
  TurnedOff = "TurnedOff",
  // Deleted at Cloudflare.
  Deleted = "Deleted",
  // Its expression or action was changed at Cloudflare.
  Changed = "Changed",
  // Not set up yet: a zone added since.
  NotSetUp = "NotSetUp",
}

export interface CloudflareZoneRuleStatus {
  action: SecurityBlockAction;
  state: CloudflareRuleState;
  ruleId?: string | undefined;
}

export interface CloudflareZoneStatus {
  id: string;
  name: string;
  plan: CloudflarePlan;
  rulesUsed: number;
  rulesLimit: number;
  // OneUptime's rules here: one per action that uses a list.
  rules: Array<CloudflareZoneRuleStatus>;
  // Addresses the zone's own skip rules let through, that no protection holds yet.
  skipAddresses?: Array<string> | undefined;
}

export interface CloudflareActionStatus {
  action: SecurityBlockAction;
  choice: CloudflareMechanismChoice;
  // The list, when the action uses one and it exists.
  listId?: string | undefined;
  // Whether the list or the mechanism is there: false when the list was deleted at Cloudflare.
  isInPlace: boolean;
}

/*
 * What OneUptime found in Cloudflare, written by OneUptime alone: when it
 * last read it, the mechanism of each action, the zones' rules, how much of
 * the plan its blocks use, and what failed.
 */
export interface CloudflareBlockingStatus {
  checkedAt: string;
  accountId: string;
  // The account's highest plan.
  plan: CloudflarePlan;
  actions: Array<CloudflareActionStatus>;
  zones: Array<CloudflareZoneStatus>;
  usage: {
    // OneUptime's blocks held, across both actions.
    items: number;
    // How many its mechanism holds at most for OneUptime: null with two mechanisms.
    limit: number | null;
  };
  // The setup request this status fulfilled (settings.setupRequestedAt).
  setupDoneFor?: string | undefined;
  // The removal request this status fulfilled (settings.removalRequestedAt).
  removalDoneFor?: string | undefined;
  // A removal still going: the blocks left to take away.
  removalLeft?: number | undefined;
  // What failed the last time OneUptime read or changed Cloudflare.
  error?: string | undefined;
  errorAt?: string | undefined;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function readTextList(value: JSONValue | undefined): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const list: Array<string> = [];

  for (const item of value) {
    const text: string = readText(item as JSONValue);

    if (text && !list.includes(text)) {
      list.push(text);
    }
  }

  return list;
}

// The settings as stored, or blocking off when nothing is.
export function readCloudflareBlockingSettings(
  value: unknown,
): CloudflareBlockingSettings {
  const json: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};

  const settings: CloudflareBlockingSettings = {
    isEnabled: json["isEnabled"] === true,
    zoneIds: readTextList(json["zoneIds"]).map((id: string): string => {
      return id.toLowerCase();
    }),
  };

  for (const key of [
    "turnedOnAt",
    "setupRequestedAt",
    "removalRequestedAt",
  ] as const) {
    const text: string = readText(json[key]);

    if (text) {
      settings[key] = text;
    }
  }

  if (Array.isArray(json["setupZoneIds"])) {
    settings.setupZoneIds = readTextList(json["setupZoneIds"]).map(
      (id: string): string => {
        return id.toLowerCase();
      },
    );
  }

  return settings;
}

// The status as stored, or null when OneUptime has read nothing yet.
export function readCloudflareBlockingStatus(
  value: unknown,
): CloudflareBlockingStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;

  if (!readText(json["checkedAt"]) || !Array.isArray(json["actions"])) {
    return null;
  }

  return json as unknown as CloudflareBlockingStatus;
}

/*
 * What failed the last time OneUptime set blocking up, checked it or took it
 * away, read from the status as stored: also when the first setup failed
 * and there is no other status to read.
 */
export function readCloudflareBlockingFailure(
  value: unknown,
): { error: string; errorAt: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const error: string = readText((value as JSONObject)["error"]);

  if (!error) {
    return null;
  }

  return { error, errorAt: readText((value as JSONObject)["errorAt"]) };
}

function isLater(
  request: string | undefined,
  fulfilled: string | undefined,
): boolean {
  if (!request) {
    return false;
  }

  if (!fulfilled) {
    return true;
  }

  return new Date(request).getTime() > new Date(fulfilled).getTime();
}

// Whether blocking is on and a setup asked for is not done yet.
export function isCloudflareBlockingSetupPending(
  settings: CloudflareBlockingSettings,
  status: CloudflareBlockingStatus | null,
): boolean {
  return (
    settings.isEnabled &&
    isLater(settings.setupRequestedAt, status?.setupDoneFor)
  );
}

// Whether blocking is off and a removal asked for is not done yet.
export function isCloudflareBlockingRemovalPending(
  settings: CloudflareBlockingSettings,
  status: CloudflareBlockingStatus | null,
): boolean {
  return (
    !settings.isEnabled &&
    isLater(settings.removalRequestedAt, status?.removalDoneFor)
  );
}

// The action's status, when the status holds one.
export function getCloudflareActionStatus(
  status: CloudflareBlockingStatus | null,
  action: SecurityBlockAction,
): CloudflareActionStatus | null {
  return (
    status?.actions.find((entry: CloudflareActionStatus): boolean => {
      return entry.action === action;
    }) || null
  );
}

// The zones whose OneUptime rule for an action does not enforce, with why.
export function getCloudflareRuleProblems(
  status: CloudflareBlockingStatus | null,
  action: SecurityBlockAction,
): Array<{ zoneName: string; state: CloudflareRuleState }> {
  const problems: Array<{ zoneName: string; state: CloudflareRuleState }> = [];

  for (const zone of status?.zones || []) {
    for (const rule of zone.rules) {
      if (
        rule.action === action &&
        rule.state !== CloudflareRuleState.Enforcing
      ) {
        problems.push({ zoneName: zone.name, state: rule.state });
      }
    }
  }

  return problems;
}

const RULE_STATE_VERBS: Readonly<Record<CloudflareRuleState, string>> = {
  [CloudflareRuleState.Enforcing]: "is in place",
  [CloudflareRuleState.TurnedOff]: "was turned off",
  [CloudflareRuleState.Deleted]: "was deleted",
  [CloudflareRuleState.Changed]: "was changed",
  [CloudflareRuleState.NotSetUp]: "is not set up yet",
};

/*
 * What a block's Cloudflare enforcement says while a zone's rule does not
 * enforce it: "Your rule in example.com was turned off: blocks there are not
 * enforced". Written on the block's enforcement and its case's timeline, in
 * English, as every enforcement error is.
 */
export function describeCloudflareRuleProblems(
  problems: ReadonlyArray<{ zoneName: string; state: CloudflareRuleState }>,
): string | null {
  if (problems.length === 0) {
    return null;
  }

  const first: { zoneName: string; state: CloudflareRuleState } = problems[0]!;

  if (problems.length === 1) {
    return `Your rule in ${first.zoneName} ${RULE_STATE_VERBS[first.state]}: blocks there are not enforced`;
  }

  const sameState: boolean = problems.every(
    (problem: { state: CloudflareRuleState }): boolean => {
      return problem.state === first.state;
    },
  );
  const names: Array<string> = problems.map(
    (problem: { zoneName: string }): string => {
      return problem.zoneName;
    },
  );
  const shown: string =
    names.length > 3
      ? `${names.slice(0, 3).join(", ")} and ${names.length - 3} more`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  return sameState
    ? `Your rules in ${shown} ${RULE_STATE_VERBS[first.state].replace(/^is /, "are ").replace(/^was /, "were ")}: blocks there are not enforced`
    : `Your rules in ${shown} are not in place: blocks there are not enforced`;
}

// The ranges of a value, for a check that a list or rule holds it.
export function readCloudflareValueBlock(
  value: string,
): NetworkAddressBlock | null {
  return NetworkAddressBlockUtil.parse(value);
}
