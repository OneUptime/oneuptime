import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityBlockAction,
  readSecurityAsnNumber,
  readSecurityBlockAsn,
} from "../SecurityBlocklist/SecurityBlock";
import SecurityEventRequestOutcome, {
  SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER,
} from "./SecurityEventRequestOutcome";

/*
 * AN ATTACK CAMPAIGN: every attack request one address sent over a window,
 * as one row - the scanner that probed a hundred paths is one thing to look
 * at, not a hundred - with how far its requests got. The rows of the
 * Campaigns page (POST /security-event/attack-campaigns), worst first: a
 * campaign one of whose requests reached the database before one that was
 * turned away a thousand times.
 *
 * A campaign is the project's web attacks (OCSF HTTP Activity) grouped by
 * the address that sent them. Requests whose address nobody knew are one
 * campaign of their own, with an empty address.
 */

export const SECURITY_ATTACK_CAMPAIGNS_MAX: number = 100;

// The longest window the page reads, in days.
export const SECURITY_ATTACK_CAMPAIGNS_MAX_DAYS: number = 31;

export const HTTP_ACTIVITY_CLASS_UID: number = 4002;

/*
 * The block on the project's Blocklist that holds a campaign's address or a
 * network now (#10354): the address itself, a range around it, or the
 * network's ASN - so a row says it is blocked already, and Block Addresses
 * leaves it out.
 */
export interface SecurityAttackCampaignBlock {
  // As blocks are written: "35.205.11.131", "35.205.11.0/24", "AS14061".
  value: string;
  action: SecurityBlockAction;
  // ISO; null when it stays until someone lifts it.
  expiresAt: string | null;
}

/*
 * What every row of the Campaigns page counts, whether it is one address
 * or a network of them (#10354): how many requests, how far they got, what
 * kinds of attack, which tools, which requests, and when.
 */
export interface SecurityAttackActivity {
  requestCount: number;
  rejectedCount: number;
  reachedAppCount: number;
  erroredCount: number;
  reachedDatabaseCount: number;
  // The worst any of its requests got to; '' when none was followed.
  worstOutcome: SecurityEventRequestOutcome | "";
  maxSeverityId: number;
  // The kinds of attack it sent (SQL injection, path traversal, ...).
  attackKinds: Array<string>;
  userAgents: Array<string>;
  // How many different requests it sent, and a few of them.
  targetCount: number;
  sampleTargets: Array<string>;
  firstSeen: string;
  lastSeen: string;
  /*
   * Of its requests, those whose address a scrub rule hid (#10397) - only
   * the campaign with no address has any. Absent when none did.
   */
  hiddenAddressCount?: number | undefined;
  // The block that holds it now, when one does and the reader may read the Blocklist (#10354).
  block?: SecurityAttackCampaignBlock | undefined;
}

export interface SecurityAttackCampaign extends SecurityAttackActivity {
  // The address the requests came from; '' when it was not known.
  sourceIp: string;
  /*
   * The network the address belongs to by its autonomous system, as
   * Cloudflare's events carry it (#10339): "AS14061", and its name
   * ("DIGITALOCEAN-ASN"). Absent when none of its events carry one -
   * OneUptime has no ASN data of its own (RequestLocation.ts).
   */
  asn?: string | undefined;
  asnName?: string | undefined;
}

export interface SecurityAttackCampaignsResult {
  campaigns: Array<SecurityAttackCampaign>;
  // The window read, as ISO dates.
  startTime: string;
  endTime: string;
  // More campaigns than the page lists sent requests in the window.
  isTruncated: boolean;
}

// The requests a campaign, or a network's campaigns, got past the app's front door.
export function getCampaignGotThroughCount(
  campaign: SecurityAttackActivity,
): number {
  return (
    campaign.reachedAppCount +
    campaign.erroredCount +
    campaign.reachedDatabaseCount
  );
}

/*
 * The campaign of requests with no address is that of requests whose
 * address a scrub rule hid, every one of them (#10397): its row says so,
 * not "Unknown address".
 */
export function isCampaignAddressHidden(
  campaign: SecurityAttackCampaign,
): boolean {
  return (
    !campaign.sourceIp &&
    campaign.requestCount > 0 &&
    (campaign.hiddenAddressCount || 0) >= campaign.requestCount
  );
}

// Requests that were never followed into a trace.
export function getCampaignNotFollowedCount(
  campaign: SecurityAttackActivity,
): number {
  return Math.max(
    0,
    campaign.requestCount -
      campaign.rejectedCount -
      getCampaignGotThroughCount(campaign),
  );
}

// An outcome from its rank (1 Rejected .. 4 Reached Database), '' for 0.
export function outcomeFromRank(
  rank: number,
): SecurityEventRequestOutcome | "" {
  return SECURITY_EVENT_REQUEST_OUTCOMES_IN_ORDER[rank - 1] || "";
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = Number(value);

  return Number.isFinite(number) && number > 0 ? number : 0;
}

function readStrings(value: JSONValue | undefined): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: JSONValue): string => {
      return typeof item === "string" ? item.trim() : "";
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/*
 * An ASN as a row carries it: digits alone from Cloudflare's events
 * ("14061"), or as blocks write it from the wire ("AS14061").
 */
export function readCampaignAsn(value: JSONValue | undefined): string | null {
  if (typeof value === "number") {
    return readSecurityAsnNumber(String(value));
  }

  return readSecurityBlockAsn(value) || readSecurityAsnNumber(value);
}

// The block that holds a row, from the wire; null for none.
export function readSecurityAttackCampaignBlock(
  value: JSONValue | undefined,
): SecurityAttackCampaignBlock | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const json: JSONObject = value as JSONObject;
  const blocked: string = readText(json["value"]).trim();

  if (!blocked) {
    return null;
  }

  const expiresAt: string = readText(json["expiresAt"]).trim();

  return {
    value: blocked,
    action:
      json["action"] === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block,
    expiresAt: expiresAt || null,
  };
}

// What a row of either kind counts, from a row of the grouped read or the wire.
export function readSecurityAttackActivity(
  row: JSONObject,
): SecurityAttackActivity {
  const worstOutcome: string = readText(row["worstOutcome"]);
  const hiddenAddressCount: number = readNumber(row["hiddenAddressCount"]);
  const block: SecurityAttackCampaignBlock | null =
    readSecurityAttackCampaignBlock(row["block"]);

  return {
    ...(hiddenAddressCount > 0 ? { hiddenAddressCount } : {}),
    ...(block ? { block } : {}),
    requestCount: readNumber(row["requestCount"]),
    rejectedCount: readNumber(row["rejectedCount"]),
    reachedAppCount: readNumber(row["reachedAppCount"]),
    erroredCount: readNumber(row["erroredCount"]),
    reachedDatabaseCount: readNumber(row["reachedDatabaseCount"]),
    worstOutcome:
      (worstOutcome as SecurityEventRequestOutcome) ||
      outcomeFromRank(readNumber(row["worstOutcomeRank"])) ||
      "",
    maxSeverityId: readNumber(row["maxSeverityId"]),
    attackKinds: readStrings(row["attackKinds"]),
    userAgents: readStrings(row["userAgents"]),
    targetCount: readNumber(row["targetCount"]),
    sampleTargets: readStrings(row["sampleTargets"]),
    firstSeen: readText(row["firstSeen"]),
    lastSeen: readText(row["lastSeen"]),
  };
}

// A campaign from a row of the grouped read, or from the wire.
export function readSecurityAttackCampaign(
  row: JSONObject,
): SecurityAttackCampaign {
  const asn: string | null = readCampaignAsn(row["asn"]);
  const asnName: string = asn ? readText(row["asnName"]).trim() : "";

  return {
    ...readSecurityAttackActivity(row),
    sourceIp: readText(row["sourceIp"]),
    ...(asn ? { asn } : {}),
    ...(asnName ? { asnName } : {}),
  };
}
