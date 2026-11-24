import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityRepeatOffenderSummary,
  readSecurityRepeatOffenderSummary,
} from "../SecurityAutomaticResponse/SecurityRepeatOffenders";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
  isSecurityBlockDuration,
} from "../SecurityBlocklist/SecurityBlock";
import {
  SecurityAddressProtection,
  SecurityProtectedAddressSource,
} from "../SecurityBlocklist/SecurityProtectedAddress";
import { SecurityAttackNetworkKind } from "./SecurityAttackNetwork";

/*
 * WHAT CAMPAIGNS' ACTIONS CHECK, AND ANSWER (#10354), as the server and the
 * Dashboard read them:
 *
 *   - Block Addresses: what a block of each selected campaign's address
 *     would meet - blockable, or left out and why (already blocked, one of
 *     the project's own or protected, a signed-in user's lately, or
 *     OneUptime could not tell) - and, once blocked, what became of each;
 *   - Challenge This Network: whether a network may be challenged, and by
 *     whom - refused for one that holds a signed-in user's address or one
 *     of the project's own, a Security Admin's for one wider than the
 *     largest range or an ASN, and a Security Admin's, knowingly, for one
 *     OneUptime cannot check - where it would hold, and whether it was
 *     challenged before.
 *
 * Pure: the server words its answer in English for an API client, the
 * Dashboard in the reader's language from the same parts.
 */

// The most addresses one Block Addresses takes: the page lists at most 100 campaigns.
export const SECURITY_CAMPAIGN_BLOCK_MAX_ADDRESSES: number = 100;

// The most addresses Block the Whole Campaign takes from a case.
export const SECURITY_CAMPAIGN_OF_ADDRESS_MAX: number = 50;

/*
 * How far back the campaign of a case's address is read: the Campaigns
 * page's own window, so it is the campaign the person sees there.
 */
export const SECURITY_CAMPAIGN_OF_ADDRESS_DAYS: number = 7;

// The most user agents and requests of an address its campaign is matched by.
export const SECURITY_CAMPAIGN_OF_ADDRESS_USER_AGENTS: number = 20;
export const SECURITY_CAMPAIGN_OF_ADDRESS_TARGETS: number = 200;

// One other address of an address's campaign, as the read finds it.
export interface SecurityCampaignOfAddressRow {
  // As events hold it.
  address: string;
  // Its requests that shared the address's tools and targets.
  requestCount: number;
  // How many of the address's requests it sent too.
  sharedTargetCount: number;
  // ISO.
  lastSeen: string;
}

/*
 * The campaign of one address (SecurityEventService.findCampaignOfAddress):
 * its tools, how many requests it sent, and the other addresses that sent
 * the same requests with the same tools - one more than asked for when
 * there are more.
 */
export interface SecurityCampaignOfAddressRead {
  userAgents: Array<string>;
  targetCount: number;
  addresses: Array<SecurityCampaignOfAddressRow>;
}

/*
 * What a case's Block the Whole Campaign is told (#10354): the case's
 * address, the campaign's other addresses with what a block of each would
 * meet, and the tools and requests they share.
 */
export interface SecurityCampaignOfCaseAddress {
  // The case's address, as blocks write it.
  address: string;
  userAgents: Array<string>;
  // Every other address of the campaign, the most requests first.
  addresses: Array<
    SecurityCampaignAddressCheck & {
      requestCount: number;
      sharedTargetCount: number;
    }
  >;
  // More addresses sent the same requests than are listed.
  isTruncated: boolean;
  signedInUnknownReason?: string | undefined;
  windowInDays: number;
}

// Where one address stands for Block Addresses.
export enum SecurityCampaignAddressStanding {
  // Nothing in its way: it will be blocked.
  Blockable = "Blockable",
  // Blocked by this action.
  Blocked = "Blocked",
  // A block already covers it: the address itself, or a range around it.
  AlreadyBlocked = "AlreadyBlocked",
  // One of the project's own, or on its protected list.
  Protected = "Protected",
  // A signed-in user used it in the last 30 days.
  SignedIn = "SignedIn",
  // OneUptime could not tell whether it is protected: never blocked unchecked.
  CannotTell = "CannotTell",
  // Not a value a block takes, or refused for another reason (problem).
  Refused = "Refused",
}

export interface SecurityCampaignSignedInUser {
  name: string;
  // "Requests": a user id on the app's requests; "IdentityProvider": a sign-in.
  source: string;
  // ISO, when known.
  lastSeenAt: string | null;
}

export interface SecurityCampaignAddressCheck {
  // As asked.
  typed: string;
  // As blocks write it, when it is one.
  value: string | null;
  standing: SecurityCampaignAddressStanding;
  // The block that covers it (AlreadyBlocked).
  coveredBy?: string | undefined;
  // What protects it, as the caller may be told it (Protected).
  protection?: SecurityAddressProtection | undefined;
  // Who used it lately, the latest first (SignedIn).
  users?: Array<SecurityCampaignSignedInUser> | undefined;
  // Why, in English, for an API client (Refused, CannotTell).
  problem?: string | undefined;
}

export interface SecurityCampaignAddressesCheck {
  addresses: Array<SecurityCampaignAddressCheck>;
  /*
   * Why OneUptime could not tell whether signed-in users used them, in its
   * English words, when it could not: nothing is left out for it, and the
   * dialog says so.
   */
  signedInUnknownReason?: string | undefined;
}

// Whether a standing is one Block Addresses leaves out.
export function isSecurityCampaignAddressLeftOut(
  standing: SecurityCampaignAddressStanding,
): boolean {
  return (
    standing !== SecurityCampaignAddressStanding.Blockable &&
    standing !== SecurityCampaignAddressStanding.Blocked
  );
}

// ---------- Challenge This Network ----------

export enum SecurityNetworkChallengeStanding {
  // Nothing in its way, for this person.
  Challengeable = "Challengeable",
  /*
   * OneUptime cannot tell whether a signed-in user, or one of the
   * project's own servers, is in it: a Security Admin may challenge it
   * knowingly; anyone else is refused.
   */
  Unchecked = "Unchecked",
  // Wider than the largest range, or an ASN, and the person is no Security Admin.
  NeedsSecurityAdmin = "NeedsSecurityAdmin",
  // Refused: a signed-in user used an address in it lately (users).
  SignedIn = "SignedIn",
  // Refused: it holds one of the project's own addresses or a protected one.
  Protected = "Protected",
  // A block or a challenge already covers it.
  AlreadyCovered = "AlreadyCovered",
  // Nothing the project connected can challenge it.
  NotHeld = "NotHeld",
  // Not a network, wider than anyone may challenge, or a check failed.
  Refused = "Refused",
}

// Why OneUptime cannot tell who is in a network.
export enum SecurityNetworkUncheckedReason {
  // An ASN: no list says which addresses it holds.
  Asn = "Asn",
  // The signed-in check could not tell (a scrub rule, a read that failed); its words in reasonText.
  SignedInCheck = "SignedInCheck",
}

export interface SecurityNetworkChallengeCheck {
  // As blocks write it: "203.0.113.0/24", "AS14061".
  value: string;
  kind: SecurityAttackNetworkKind;
  standing: SecurityNetworkChallengeStanding;
  // Where a challenge of it would hold, by name: "Cloudflare".
  holders: Array<string>;
  // Whether the person may go past the largest range (a Security Admin, a Project Admin or Owner).
  isAdmin: boolean;
  // The block or challenge that covers it (AlreadyCovered).
  coveredBy?:
    | { value: string; action: SecurityBlockAction; expiresAt: string | null }
    | undefined;
  protection?: SecurityAddressProtection | undefined;
  users?: Array<SecurityCampaignSignedInUser> | undefined;
  uncheckedReason?: SecurityNetworkUncheckedReason | undefined;
  // The signed-in check's own words, in English, when it could not tell.
  uncheckedReasonText?: string | undefined;
  // For an ASN: how many addresses OneUptime saw attack from it in the window.
  seenAddressCount?: number | undefined;
  // Blocked or challenged before, in the last 30 days.
  repeat: SecurityRepeatOffenderSummary | null;
  // How long the challenge lasts unless the person says: 24 hours, longer for a repeat offender.
  suggestedDuration: SecurityBlockDuration;
  // Why, in English, for an API client (Refused, NotHeld, NeedsSecurityAdmin).
  problem?: string | undefined;
}

// Whether a person may challenge a network now, from its check: knowingly, for one OneUptime cannot check.
export function maySecurityNetworkBeChallenged(
  check: Pick<SecurityNetworkChallengeCheck, "standing" | "isAdmin">,
): boolean {
  return (
    check.standing === SecurityNetworkChallengeStanding.Challengeable ||
    (check.standing === SecurityNetworkChallengeStanding.Unchecked &&
      check.isAdmin)
  );
}

// ---------- The wire ----------

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

export function readSecurityCampaignProtection(
  value: JSONValue | undefined,
): SecurityAddressProtection | null {
  const json: JSONObject | null = readObject(value);
  const protectedValue: string = readText(json?.["protectedValue"]);
  const source: string = readText(json?.["source"]);

  if (!json || !protectedValue || !source) {
    return null;
  }

  const name: string = readText(json["name"]);
  const kind: string = readText(json["kind"]);
  const where: string = readText(json["where"]);

  return {
    source: source as SecurityProtectedAddressSource,
    protectedValue,
    ...(name ? { name } : {}),
    ...(kind ? { kind } : {}),
    ...(where ? { where } : {}),
  };
}

export function readSecurityCampaignSignedInUsers(
  value: JSONValue | undefined,
): Array<SecurityCampaignSignedInUser> {
  const users: Array<SecurityCampaignSignedInUser> = [];

  for (const item of Array.isArray(value) ? value : []) {
    const json: JSONObject | null = readObject(item as JSONValue);
    const name: string = readText(json?.["name"]);

    if (!json || !name) {
      continue;
    }

    const lastSeenAt: string = readText(json["lastSeenAt"]);

    users.push({
      name,
      source: readText(json["source"]),
      lastSeenAt: lastSeenAt || null,
    });
  }

  return users;
}

function isStanding(value: string): value is SecurityCampaignAddressStanding {
  return (
    Object.values(SecurityCampaignAddressStanding) as Array<string>
  ).includes(value);
}

export function readSecurityCampaignAddressCheck(
  value: JSONValue | undefined,
): SecurityCampaignAddressCheck | null {
  const json: JSONObject | null = readObject(value);
  const typed: string = readText(json?.["typed"]);
  const standing: string = readText(json?.["standing"]);

  if (!json || !typed || !isStanding(standing)) {
    return null;
  }

  const protection: SecurityAddressProtection | null =
    readSecurityCampaignProtection(json["protection"]);
  const users: Array<SecurityCampaignSignedInUser> =
    readSecurityCampaignSignedInUsers(json["users"]);
  const coveredBy: string = readText(json["coveredBy"]);
  const problem: string = readText(json["problem"]);

  return {
    typed,
    value: readText(json["value"]) || null,
    standing,
    ...(coveredBy ? { coveredBy } : {}),
    ...(protection ? { protection } : {}),
    ...(users.length > 0 ? { users } : {}),
    ...(problem ? { problem } : {}),
  };
}

export function readSecurityCampaignAddressesCheck(
  value: JSONValue | undefined,
): SecurityCampaignAddressesCheck {
  const json: JSONObject | null = readObject(value);
  const addresses: Array<SecurityCampaignAddressCheck> = [];

  for (const item of Array.isArray(json?.["addresses"])
    ? (json!["addresses"] as Array<JSONValue>)
    : []) {
    const check: SecurityCampaignAddressCheck | null =
      readSecurityCampaignAddressCheck(item);

    if (check) {
      addresses.push(check);
    }
  }

  const reason: string = readText(json?.["signedInUnknownReason"]);

  return {
    addresses,
    ...(reason ? { signedInUnknownReason: reason } : {}),
  };
}

export function readSecurityCampaignOfCaseAddress(
  value: JSONValue | undefined,
): SecurityCampaignOfCaseAddress | null {
  const json: JSONObject | null = readObject(value);
  const address: string = readText(json?.["address"]);

  if (!json || !address) {
    return null;
  }

  const addresses: SecurityCampaignOfCaseAddress["addresses"] = [];

  for (const item of Array.isArray(json["addresses"])
    ? (json["addresses"] as Array<JSONValue>)
    : []) {
    const check: SecurityCampaignAddressCheck | null =
      readSecurityCampaignAddressCheck(item);
    const row: JSONObject | null = readObject(item);

    if (!check || !row) {
      continue;
    }

    const requests: number = Number(row["requestCount"]);
    const shared: number = Number(row["sharedTargetCount"]);

    addresses.push({
      ...check,
      requestCount:
        Number.isFinite(requests) && requests > 0 ? Math.floor(requests) : 0,
      sharedTargetCount:
        Number.isFinite(shared) && shared > 0 ? Math.floor(shared) : 0,
    });
  }

  const reason: string = readText(json["signedInUnknownReason"]);
  const days: number = Number(json["windowInDays"]);

  return {
    address,
    userAgents: (Array.isArray(json["userAgents"]) ? json["userAgents"] : [])
      .map((item: JSONValue): string => {
        return readText(item);
      })
      .filter(Boolean),
    addresses,
    isTruncated: json["isTruncated"] === true,
    ...(reason ? { signedInUnknownReason: reason } : {}),
    windowInDays:
      Number.isFinite(days) && days > 0
        ? Math.floor(days)
        : SECURITY_CAMPAIGN_OF_ADDRESS_DAYS,
  };
}

function isNetworkStanding(
  value: string,
): value is SecurityNetworkChallengeStanding {
  return (
    Object.values(SecurityNetworkChallengeStanding) as Array<string>
  ).includes(value);
}

export function readSecurityNetworkChallengeCheck(
  value: JSONValue | undefined,
): SecurityNetworkChallengeCheck | null {
  const json: JSONObject | null = readObject(value);
  const network: string = readText(json?.["value"]);
  const standing: string = readText(json?.["standing"]);
  const kind: string = readText(json?.["kind"]);

  if (
    !json ||
    !network ||
    !isNetworkStanding(standing) ||
    (kind !== SecurityAttackNetworkKind.Asn &&
      kind !== SecurityAttackNetworkKind.Range)
  ) {
    return null;
  }

  const covered: JSONObject | null = readObject(json["coveredBy"]);
  const coveredValue: string = readText(covered?.["value"]);
  const protection: SecurityAddressProtection | null =
    readSecurityCampaignProtection(json["protection"]);
  const users: Array<SecurityCampaignSignedInUser> =
    readSecurityCampaignSignedInUsers(json["users"]);
  const uncheckedReason: string = readText(json["uncheckedReason"]);
  const uncheckedReasonText: string = readText(json["uncheckedReasonText"]);
  const problem: string = readText(json["problem"]);
  const seen: number = Number(json["seenAddressCount"]);
  const duration: string = readText(json["suggestedDuration"]);

  return {
    value: network,
    kind,
    standing,
    holders: (Array.isArray(json["holders"]) ? json["holders"] : [])
      .map((item: JSONValue): string => {
        return readText(item);
      })
      .filter(Boolean),
    isAdmin: json["isAdmin"] === true,
    ...(covered && coveredValue
      ? {
          coveredBy: {
            value: coveredValue,
            action:
              covered["action"] === SecurityBlockAction.Challenge
                ? SecurityBlockAction.Challenge
                : SecurityBlockAction.Block,
            expiresAt: readText(covered["expiresAt"]) || null,
          },
        }
      : {}),
    ...(protection ? { protection } : {}),
    ...(users.length > 0 ? { users } : {}),
    ...(uncheckedReason === SecurityNetworkUncheckedReason.Asn ||
    uncheckedReason === SecurityNetworkUncheckedReason.SignedInCheck
      ? { uncheckedReason }
      : {}),
    ...(uncheckedReasonText ? { uncheckedReasonText } : {}),
    ...(Number.isFinite(seen) && seen > 0
      ? { seenAddressCount: Math.floor(seen) }
      : {}),
    repeat: readSecurityRepeatOffenderSummary(json["repeat"]),
    suggestedDuration: isSecurityBlockDuration(duration)
      ? duration
      : SecurityBlockDuration.OneDay,
    ...(problem ? { problem } : {}),
  };
}
