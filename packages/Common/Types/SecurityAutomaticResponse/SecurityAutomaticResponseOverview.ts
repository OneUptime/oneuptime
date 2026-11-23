import { JSONObject, JSONValue } from "../JSON";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../SecurityBlocklist/SecurityBlock";
import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SecurityAutomaticResponseMatch,
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
  isSecurityAutomaticResponseDuration,
  isSecurityAutomaticResponseMode,
  isSecurityAutomaticResponsePolicyKind,
  readSecurityAutomaticResponseMatch,
} from "./SecurityAutomaticResponsePolicy";
import {
  SecurityAutomaticResponseTimeToBlock,
  SecurityAutomaticResponseTimeToBlockDay,
  SecurityAutomaticResponseTrialSummary,
} from "./SecurityAutomaticResponseSummary";

/*
 * THE AUTOMATIC RESPONSE PAGE'S READ (#10350), as the server answers it
 * (Server/Utils/SecurityAutomaticResponse/SecurityAutomaticResponseOverview)
 * and the Dashboard reads it: every policy with where its trial run
 * stands, what it would have done and did, its time to block and the rules
 * it acts on; the destinations that enforce the blocklist, and whether
 * each can challenge; and how many of the hour's automatic blocks are
 * taken.
 *
 * The reader below takes whatever came back and keeps what it can read:
 * a field it cannot read is the safest thing it could be (off, nothing
 * done, no destination).
 */

// Where one of the rules a ready policy acts on stands in the project.
export enum SecurityAutomaticResponseRuleState {
  // Runs in real time.
  RealTime = "RealTime",
  // On, but on its schedule: the project runs 50 rules in real time already, or it cannot run in real time.
  Scheduled = "Scheduled",
  // The project has it, turned off.
  Off = "Off",
  // The project has not got it.
  Missing = "Missing",
}

// One rule a ready policy acts on, as its page lists it.
export interface SecurityAutomaticResponseRule {
  libraryRuleId: string;
  title: string;
  detectionRuleId: string | null;
  state: SecurityAutomaticResponseRuleState;
}

// A policy, as the page draws it.
export interface SecurityAutomaticResponseOverviewPolicy {
  id: string;
  kind: SecurityAutomaticResponsePolicyKind;
  name: string;
  description: string;
  mode: SecurityAutomaticResponseMode;
  blockAction: SecurityBlockAction;
  duration: SecurityBlockDuration;
  match: SecurityAutomaticResponseMatch;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  trialFinishedAt: Date | null;
  trialSkippedAt: Date | null;
  turnedOnAt: Date | null;
  // Who turned it on, by name; null when nobody is known.
  turnedOnBy: string | null;
  trialState: SecurityAutomaticResponseTrialState;
  trialDaysLeft: number;
  // What its trial run would have done; null before it ever ran one.
  trialSummary: SecurityAutomaticResponseTrialSummary | null;
  timeToBlock: SecurityAutomaticResponseTimeToBlock;
  // What it did in the last 7 days, on.
  lastWeek: { acted: number; spared: number };
  rules: Array<SecurityAutomaticResponseRule>;
}

// A destination that enforces the blocklist.
export interface SecurityAutomaticResponseOverviewDestination {
  name: string;
  provider: string;
  canChallenge: boolean;
}

export interface SecurityAutomaticResponseOverviewData {
  policies: Array<SecurityAutomaticResponseOverviewPolicy>;
  destinations: Array<SecurityAutomaticResponseOverviewDestination>;
  // A kind of destination could not be listed: none listed is not nothing enforcing the blocklist.
  destinationsCannotTell: boolean;
  // The automatic blocks made in the last hour, and the most there may be.
  blocksThisHour: number;
  maxBlocksPerHour: number;
}

// A day as time to block names it: "2026-11-22".
const UTC_DAY: RegExp = /^\d{4}-\d{2}-\d{2}$/;

function readObject(value: JSONValue | undefined): JSONObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

function readArray(value: JSONValue | undefined): Array<JSONValue> {
  return Array.isArray(value) ? value : [];
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readCount(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

function readSeconds(value: JSONValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isFinite(date.getTime()) ? date : null;
}

function isTrialState(
  value: unknown,
): value is SecurityAutomaticResponseTrialState {
  return (
    typeof value === "string" &&
    (
      Object.values(SecurityAutomaticResponseTrialState) as Array<string>
    ).includes(value)
  );
}

function isRuleState(
  value: unknown,
): value is SecurityAutomaticResponseRuleState {
  return (
    typeof value === "string" &&
    (
      Object.values(SecurityAutomaticResponseRuleState) as Array<string>
    ).includes(value)
  );
}

export function readSecurityAutomaticResponseTrialSummary(
  value: JSONValue | undefined,
): SecurityAutomaticResponseTrialSummary | null {
  const object: JSONObject | null = readObject(value);

  if (!object) {
    return null;
  }

  return {
    wouldActOn: readCount(object["wouldActOn"]),
    wouldHaveLifted: readCount(object["wouldHaveLifted"]),
    sparedSignedIn: readCount(object["sparedSignedIn"]),
    sparedProtected: readCount(object["sparedProtected"]),
    sparedCannotTell: readCount(object["sparedCannotTell"]),
    wouldHaveStopped: readCount(object["wouldHaveStopped"]),
  };
}

export function readSecurityAutomaticResponseTimeToBlock(
  value: JSONValue | undefined,
): SecurityAutomaticResponseTimeToBlock {
  const object: JSONObject = readObject(value) || {};
  const days: Array<SecurityAutomaticResponseTimeToBlockDay> = [];

  for (const item of readArray(object["days"])) {
    const day: JSONObject | null = readObject(item);
    const date: string = readText(day?.["day"]);

    if (!day || !UTC_DAY.test(date)) {
      continue;
    }

    days.push({
      day: date,
      count: readCount(day["count"]),
      p50InSeconds: readSeconds(day["p50InSeconds"]),
      p95InSeconds: readSeconds(day["p95InSeconds"]),
    });
  }

  return {
    count: readCount(object["count"]),
    p50InSeconds: readSeconds(object["p50InSeconds"]),
    p95InSeconds: readSeconds(object["p95InSeconds"]),
    days,
  };
}

export function readSecurityAutomaticResponseRules(
  value: JSONValue | undefined,
): Array<SecurityAutomaticResponseRule> {
  const rules: Array<SecurityAutomaticResponseRule> = [];

  for (const item of readArray(value)) {
    const rule: JSONObject | null = readObject(item);
    const libraryRuleId: string = readText(rule?.["libraryRuleId"]);
    const title: string = readText(rule?.["title"]);

    if (!rule || !libraryRuleId || !title) {
      continue;
    }

    rules.push({
      libraryRuleId,
      title,
      detectionRuleId: readText(rule["detectionRuleId"]) || null,
      state: isRuleState(rule["state"])
        ? rule["state"]
        : SecurityAutomaticResponseRuleState.Missing,
    });
  }

  return rules;
}

// One policy as the server answered it, or null when it names no policy.
export function readSecurityAutomaticResponseOverviewPolicy(
  value: JSONValue | undefined,
): SecurityAutomaticResponseOverviewPolicy | null {
  const object: JSONObject | null = readObject(value);
  const id: string = readText(object?.["_id"]);

  if (!object || !id) {
    return null;
  }

  const lastWeek: JSONObject = readObject(object["lastWeek"]) || {};
  const duration: JSONValue | undefined = object["duration"];

  return {
    id,
    kind: isSecurityAutomaticResponsePolicyKind(object["kind"])
      ? object["kind"]
      : SecurityAutomaticResponsePolicyKind.Custom,
    name: readText(object["name"]),
    description: readText(object["description"]),
    mode: isSecurityAutomaticResponseMode(object["mode"])
      ? object["mode"]
      : SecurityAutomaticResponseMode.Off,
    blockAction:
      object["blockAction"] === SecurityBlockAction.Challenge
        ? SecurityBlockAction.Challenge
        : SecurityBlockAction.Block,
    duration: isSecurityAutomaticResponseDuration(duration)
      ? duration
      : SecurityBlockDuration.OneHour,
    match: readSecurityAutomaticResponseMatch(object["matchConditions"]),
    trialStartedAt: readDate(object["trialStartedAt"]),
    trialEndsAt: readDate(object["trialEndsAt"]),
    trialFinishedAt: readDate(object["trialFinishedAt"]),
    trialSkippedAt: readDate(object["trialSkippedAt"]),
    turnedOnAt: readDate(object["turnedOnAt"]),
    turnedOnBy: readText(object["turnedOnBy"]) || null,
    trialState: isTrialState(object["trialState"])
      ? object["trialState"]
      : SecurityAutomaticResponseTrialState.NotStarted,
    trialDaysLeft: readCount(object["trialDaysLeft"]),
    trialSummary: readSecurityAutomaticResponseTrialSummary(
      object["trialSummary"],
    ),
    timeToBlock: readSecurityAutomaticResponseTimeToBlock(
      object["timeToBlock"],
    ),
    lastWeek: {
      acted: readCount(lastWeek["acted"]),
      spared: readCount(lastWeek["spared"]),
    },
    rules: readSecurityAutomaticResponseRules(object["rules"]),
  };
}

// The page's read, as the server answered it.
export function readSecurityAutomaticResponseOverview(
  value: JSONValue | undefined,
): SecurityAutomaticResponseOverviewData {
  const object: JSONObject = readObject(value) || {};
  const policies: Array<SecurityAutomaticResponseOverviewPolicy> = [];
  const destinations: Array<SecurityAutomaticResponseOverviewDestination> = [];

  for (const item of readArray(object["policies"])) {
    const policy: SecurityAutomaticResponseOverviewPolicy | null =
      readSecurityAutomaticResponseOverviewPolicy(item);

    if (policy) {
      policies.push(policy);
    }
  }

  for (const item of readArray(object["destinations"])) {
    const destination: JSONObject | null = readObject(item);
    const name: string = readText(destination?.["name"]).trim();

    if (!destination || !name) {
      continue;
    }

    destinations.push({
      name,
      provider: readText(destination["provider"]),
      canChallenge: destination["canChallenge"] === true,
    });
  }

  const maxBlocksPerHour: number = readCount(object["maxBlocksPerHour"]);

  return {
    policies,
    destinations,
    destinationsCannotTell: object["destinationsCannotTell"] === true,
    blocksThisHour: readCount(object["blocksThisHour"]),
    maxBlocksPerHour:
      maxBlocksPerHour || SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  };
}
