import FixProductionCheck, {
  FixProductionCheckHelper,
} from "./FixProductionCheck";
import FixProductionStatus, {
  FixProductionStatusHelper,
} from "./FixProductionStatus";
import { JSONObject } from "../JSON";

/*
 * What production showed about a merged AI fix, as the server sends it
 * wherever the fix is shown - an exception's AI panel, a task in Code, the
 * AI Logs of incidents and alerts, an AI insight - read from the fix pull
 * request's production columns (FixProductionReportUtil on the server).
 *
 * A wire contract: the Dashboard reads it with parseFixProductionReport,
 * and a field it does not know is left alone.
 */
export interface FixProductionReport {
  status: FixProductionStatus;
  // What the fix was watched for; an older server's report is an exception fix's.
  check: FixProductionCheck;
  // One or two sentences: what was measured before and since.
  summary?: string | undefined;
  // ISO-8601: when the status last changed.
  statusAt?: string | undefined;
  // ISO-8601: when the deploy that shipped the fix ran.
  deployedAt?: string | undefined;
  deployedVersion?: string | undefined;
  deployedCommitSha?: string | undefined;
}

function readText(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function readTime(value: unknown): string | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) {
    return undefined;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/*
 * A report as the server sent it, or undefined - for none, an older
 * server's without a status, or a status or a check this reader does not
 * know.
 */
export function parseFixProductionReport(
  value: unknown,
): FixProductionReport | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const json: JSONObject = value as JSONObject;
  const status: FixProductionStatus | undefined =
    FixProductionStatusHelper.fromDatabaseValue(json["status"]);
  const check: FixProductionCheck | undefined =
    FixProductionCheckHelper.fromDatabaseValue(json["check"]);

  if (!status || !check) {
    return undefined;
  }

  return {
    status,
    check,
    summary: readText(json["summary"]),
    statusAt: readTime(json["statusAt"]),
    deployedAt: readTime(json["deployedAt"]),
    deployedVersion: readText(json["deployedVersion"]),
    deployedCommitSha: readText(json["deployedCommitSha"]),
  };
}

export default FixProductionReport;
