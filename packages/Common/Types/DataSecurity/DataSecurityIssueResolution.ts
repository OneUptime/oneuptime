import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import {
  DataSecurityResponseAction,
  isDataSecurityResponseAction,
} from "./DataSecurityResponseAction";

/*
 * HOW A RESOLVED ISSUE WAS RESOLVED (#10368).
 *
 * "Resolved" alone cannot tell a leak fixed in the code from one a scrub
 * rule only hides at ingest, or a bucket fixed by a merged and applied
 * Terraform change from one whose check was turned off. Each resolved
 * issue says how (DataSecurityIssue.resolution), with the facts behind it
 * (resolutionDetails):
 *
 *   - Fixed in code: a code fix's pull request shipped in a deploy of the
 *     service, and its new version writes no more of the data, over enough
 *     of its traffic (FixProductionCheck.TelemetryLeak). With the pull
 *     request, the version and when it was verified.
 *   - Fixed in infrastructure code: a pull request to the code that
 *     declares the store merged, and the store's check passed when its
 *     configuration was read again (FixProductionCheck.StoreConfiguration).
 *   - Fixed from here: a response action (Fix it from here) changed the
 *     store, and its check passed after.
 *   - Contained at ingest: a telemetry issue's every finding is hidden by
 *     a scrub rule before it is stored. Not fixed: the code still writes
 *     the data, to stdout and to every other place it sends telemetry.
 *   - Check passed: the check passes, for no change OneUptime knows of.
 *   - Resolved by a person: Mark Resolved, which asks for a re-check.
 *   - No longer checked: the check was turned off, or no longer applies.
 *   - Store archived: the store is gone from its source.
 *
 * Fixed in code, in infrastructure code and from here, and a check that
 * passes, stopped the problem where it starts. Contained at ingest did
 * not, and a list or the Overview never counts it as fixed.
 *
 * Stored on the issue; a wire contract - do not rename the values.
 */
enum DataSecurityIssueResolution {
  FixedInCode = "FixedInCode",
  FixedInInfrastructureCode = "FixedInInfrastructureCode",
  FixedFromHere = "FixedFromHere",
  ContainedAtIngest = "ContainedAtIngest",
  CheckPassed = "CheckPassed",
  ResolvedByPerson = "ResolvedByPerson",
  NoLongerChecked = "NoLongerChecked",
  StoreArchived = "StoreArchived",
}

export default DataSecurityIssueResolution;

export const ALL_DATA_SECURITY_ISSUE_RESOLUTIONS: ReadonlyArray<DataSecurityIssueResolution> =
  [
    DataSecurityIssueResolution.FixedInCode,
    DataSecurityIssueResolution.FixedInInfrastructureCode,
    DataSecurityIssueResolution.FixedFromHere,
    DataSecurityIssueResolution.CheckPassed,
    DataSecurityIssueResolution.ContainedAtIngest,
    DataSecurityIssueResolution.ResolvedByPerson,
    DataSecurityIssueResolution.NoLongerChecked,
    DataSecurityIssueResolution.StoreArchived,
  ];

export function isDataSecurityIssueResolution(
  value: unknown,
): value is DataSecurityIssueResolution {
  return (
    ALL_DATA_SECURITY_ISSUE_RESOLUTIONS as ReadonlyArray<unknown>
  ).includes(value);
}

/*
 * The resolutions that stopped the problem where it starts: the code, the
 * infrastructure code, the store itself. A leak only contained at ingest
 * is not among them, nor a check turned off.
 */
export const FIXED_AT_SOURCE_RESOLUTIONS: ReadonlyArray<DataSecurityIssueResolution> =
  [
    DataSecurityIssueResolution.FixedInCode,
    DataSecurityIssueResolution.FixedInInfrastructureCode,
    DataSecurityIssueResolution.FixedFromHere,
    DataSecurityIssueResolution.CheckPassed,
  ];

export function isFixedAtSource(resolution: unknown): boolean {
  return (FIXED_AT_SOURCE_RESOLUTIONS as ReadonlyArray<unknown>).includes(
    resolution,
  );
}

// A fix OneUptime followed to production: its pull request was verified.
export function isVerifiedFixResolution(resolution: unknown): boolean {
  return (
    resolution === DataSecurityIssueResolution.FixedInCode ||
    resolution === DataSecurityIssueResolution.FixedInInfrastructureCode
  );
}

// The longest text a resolution keeps of a name, a version or an address.
export const MAX_RESOLUTION_TEXT_LENGTH: number = 300;

// The most scrub rules a resolution names.
export const MAX_RESOLUTION_SCRUB_RULES: number = 20;

// The pull request a verified fix came in, as its row records it.
export interface DataSecurityIssueResolutionFix {
  // The AIAgentTaskPullRequest row.
  pullRequestId: string;
  // The code task in Code that opened it (the task's first turn).
  taskId?: string | undefined;
  number?: number | undefined;
  url?: string | undefined;
  // "owner/name".
  repository?: string | undefined;
  // ISO-8601.
  mergedAt?: string | undefined;
  // A code fix: the deploy that shipped it.
  version?: string | undefined;
  commitSha?: string | undefined;
  deployedAt?: string | undefined;
}

// A scrub rule that hides, or hid, the issue's data at ingest.
export interface DataSecurityIssueResolutionRule {
  id: string;
  // "log", "trace" or "metric": which kind of rule it is.
  signal: string;
  name: string;
}

/*
 * A leak that came back after a code fix production had verified: what
 * the fix's watch found (TelemetryLeakFixWatch), kept on the issue while it
 * is open again, so its page and timeline say which version brought it
 * back, and a scrub rule that hides it at ingest never closes it again on
 * its own.
 */
export interface DataSecurityIssueRegression {
  // ISO-8601: when the watch found it back.
  at: string;
  // The version that brought it back, when its records name one.
  version?: string | undefined;
  // The fix it came back after.
  fix?: DataSecurityIssueResolutionFix | undefined;
}

export interface DataSecurityIssueResolutionDetails {
  /*
   * ISO-8601: when it resolved so - for a fix OneUptime followed to
   * production, when production proved it.
   */
  at?: string | undefined;
  fix?: DataSecurityIssueResolutionFix | undefined;
  /*
   * Contained at ingest: the rules that hide the data. Fixed in code: the
   * rules that contained it before, kept as defence in depth until a
   * person removes them.
   */
  scrubRules?: Array<DataSecurityIssueResolutionRule> | undefined;
  // Fixed from here: the response action that changed the store.
  responseAction?: DataSecurityResponseAction | undefined;
  // Who: the person who marked it resolved, or ran the response action.
  userId?: string | undefined;
  // The leak came back after its verified fix: set while it is open again.
  regression?: DataSecurityIssueRegression | undefined;
}

/*
 * A change made to fix an open issue, waiting for its check to pass
 * (DataSecurityIssue.pendingResolution, server-only): a response action
 * that changed the store, whose check passing then says the issue was
 * fixed from here.
 */
export interface DataSecurityIssuePendingResolution {
  resolution: DataSecurityIssueResolution.FixedFromHere;
  responseAction: DataSecurityResponseAction;
  // ISO-8601: when the action changed the store.
  at: string;
  userId?: string | undefined;
}

// How long a response action's change waits for its check to pass.
export const PENDING_RESOLUTION_DAYS: number = 7;

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const text: string = value.trim();

  return text ? text.slice(0, MAX_RESOLUTION_TEXT_LENGTH) : undefined;
}

function readTime(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return undefined;
  }

  const time: Date = new Date(value);

  return Number.isNaN(time.getTime()) ? undefined : time.toISOString();
}

function readId(value: unknown): string | undefined {
  const text: string | undefined = readText(value);

  return text && ObjectID.isValidUUID(text) ? text : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// A web address a link can open: only http(s), never javascript: or data:.
const WEB_ADDRESS: RegExp = /^https?:\/\//i;

export function readResolutionUrl(value: unknown): string | undefined {
  const text: string | undefined = readText(value);

  return text && WEB_ADDRESS.test(text) ? text : undefined;
}

function readFix(value: unknown): DataSecurityIssueResolutionFix | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const pullRequestId: string | undefined = readId(value["pullRequestId"]);

  if (!pullRequestId) {
    return undefined;
  }

  const fix: DataSecurityIssueResolutionFix = { pullRequestId };
  const taskId: string | undefined = readId(value["taskId"]);
  const number: number | undefined = readPositiveInteger(value["number"]);
  const url: string | undefined = readResolutionUrl(value["url"]);
  const repository: string | undefined = readText(value["repository"]);
  const mergedAt: string | undefined = readTime(value["mergedAt"]);
  const version: string | undefined = readText(value["version"]);
  const commitSha: string | undefined = readText(value["commitSha"]);
  const deployedAt: string | undefined = readTime(value["deployedAt"]);

  if (taskId) {
    fix.taskId = taskId;
  }

  if (number !== undefined) {
    fix.number = number;
  }

  if (url) {
    fix.url = url;
  }

  if (repository) {
    fix.repository = repository;
  }

  if (mergedAt) {
    fix.mergedAt = mergedAt;
  }

  if (version) {
    fix.version = version;
  }

  if (commitSha) {
    fix.commitSha = commitSha;
  }

  if (deployedAt) {
    fix.deployedAt = deployedAt;
  }

  return fix;
}

function readRules(
  value: unknown,
): Array<DataSecurityIssueResolutionRule> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const rules: Array<DataSecurityIssueResolutionRule> = [];
  const seen: Set<string> = new Set<string>();

  for (const item of value) {
    if (!isObject(item)) {
      continue;
    }

    const id: string | undefined = readId(item["id"]);
    const signal: string | undefined = readText(item["signal"]);

    if (!id || !signal || seen.has(id)) {
      continue;
    }

    seen.add(id);
    rules.push({ id, signal, name: readText(item["name"]) || "" });

    if (rules.length >= MAX_RESOLUTION_SCRUB_RULES) {
      break;
    }
  }

  return rules.length > 0 ? rules : undefined;
}

/*
 * The details as stored, or as a server sent them: each field read on its
 * own, and one of the wrong shape left out - never trusted as written.
 */
export function readDataSecurityIssueResolutionDetails(
  value: unknown,
): DataSecurityIssueResolutionDetails {
  if (!isObject(value)) {
    return {};
  }

  const details: DataSecurityIssueResolutionDetails = {};
  const at: string | undefined = readTime(value["at"]);
  const fix: DataSecurityIssueResolutionFix | undefined = readFix(value["fix"]);
  const scrubRules: Array<DataSecurityIssueResolutionRule> | undefined =
    readRules(value["scrubRules"]);
  const userId: string | undefined = readId(value["userId"]);

  if (at) {
    details.at = at;
  }

  if (fix) {
    details.fix = fix;
  }

  if (scrubRules) {
    details.scrubRules = scrubRules;
  }

  if (isDataSecurityResponseAction(value["responseAction"])) {
    details.responseAction = value["responseAction"];
  }

  if (userId) {
    details.userId = userId;
  }

  const regression: DataSecurityIssueRegression | undefined = readRegression(
    value["regression"],
  );

  if (regression) {
    details.regression = regression;
  }

  return details;
}

function readRegression(
  value: unknown,
): DataSecurityIssueRegression | undefined {
  if (!isObject(value)) {
    return undefined;
  }

  const at: string | undefined = readTime(value["at"]);

  if (!at) {
    return undefined;
  }

  const regression: DataSecurityIssueRegression = { at };
  const version: string | undefined = readText(value["version"]);
  const fix: DataSecurityIssueResolutionFix | undefined = readFix(value["fix"]);

  if (version) {
    regression.version = version;
  }

  if (fix) {
    regression.fix = fix;
  }

  return regression;
}

// The details as the issue's JSON column takes them.
export function toResolutionDetailsJSON(
  details: DataSecurityIssueResolutionDetails,
): JSONObject {
  return JSON.parse(
    JSON.stringify(readDataSecurityIssueResolutionDetails(details)),
  ) as JSONObject;
}

export function readDataSecurityIssuePendingResolution(
  value: unknown,
): DataSecurityIssuePendingResolution | null {
  if (
    !isObject(value) ||
    value["resolution"] !== DataSecurityIssueResolution.FixedFromHere ||
    !isDataSecurityResponseAction(value["responseAction"])
  ) {
    return null;
  }

  const at: string | undefined = readTime(value["at"]);

  if (!at) {
    return null;
  }

  const pending: DataSecurityIssuePendingResolution = {
    resolution: DataSecurityIssueResolution.FixedFromHere,
    responseAction: value["responseAction"],
    at,
  };
  const userId: string | undefined = readId(value["userId"]);

  if (userId) {
    pending.userId = userId;
  }

  return pending;
}

/*
 * Whether a response action's change still explains a check passing now:
 * made since the issue last opened, and within PENDING_RESOLUTION_DAYS.
 */
export function isPendingResolutionCurrent(data: {
  pending: DataSecurityIssuePendingResolution | null;
  now: Date;
  // When the issue last opened (its first detection, or its reopening).
  openedAt?: Date | null | undefined;
}): boolean {
  if (!data.pending) {
    return false;
  }

  const at: number = new Date(data.pending.at).getTime();

  if (data.openedAt && at < new Date(data.openedAt).getTime()) {
    return false;
  }

  return (
    data.now.getTime() - at <= PENDING_RESOLUTION_DAYS * 24 * 60 * 60 * 1000
  );
}

// "#482", "acme/checkout#482", or "" for a pull request with no number.
export function describeResolutionPullRequest(
  fix: DataSecurityIssueResolutionFix,
): string {
  if (!fix.number) {
    return "";
  }

  return `#${fix.number}`;
}
