import { JSONObject, JSONValue } from "../JSON";
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

export interface SecurityAttackCampaign {
  // The address the requests came from; '' when it was not known.
  sourceIp: string;
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
}

export interface SecurityAttackCampaignsResult {
  campaigns: Array<SecurityAttackCampaign>;
  // The window read, as ISO dates.
  startTime: string;
  endTime: string;
  // More campaigns than the page lists sent requests in the window.
  isTruncated: boolean;
}

// The requests a campaign got past the app's front door.
export function getCampaignGotThroughCount(
  campaign: SecurityAttackCampaign,
): number {
  return (
    campaign.reachedAppCount +
    campaign.erroredCount +
    campaign.reachedDatabaseCount
  );
}

// Requests that were never followed into a trace.
export function getCampaignNotFollowedCount(
  campaign: SecurityAttackCampaign,
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

// A campaign from a row of the grouped read, or from the wire.
export function readSecurityAttackCampaign(
  row: JSONObject,
): SecurityAttackCampaign {
  const worstOutcome: string = readText(row["worstOutcome"]);

  return {
    sourceIp: readText(row["sourceIp"]),
    requestCount: readNumber(row["requestCount"]),
    rejectedCount: readNumber(row["rejectedCount"]),
    reachedAppCount: readNumber(row["reachedAppCount"]),
    erroredCount: readNumber(row["erroredCount"]),
    reachedDatabaseCount: readNumber(row["reachedDatabaseCount"]),
    worstOutcome:
      worstOutcome ||
      outcomeFromRank(readNumber(row["worstOutcomeRank"])) ||
      "",
    maxSeverityId: readNumber(row["maxSeverityId"]),
    attackKinds: readStrings(row["attackKinds"]),
    userAgents: readStrings(row["userAgents"]),
    targetCount: readNumber(row["targetCount"]),
    sampleTargets: readStrings(row["sampleTargets"]),
    firstSeen: readText(row["firstSeen"]),
    lastSeen: readText(row["lastSeen"]),
  } as SecurityAttackCampaign;
}
