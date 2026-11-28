import { JSONObject, JSONValue } from "../JSON";
import { SecurityUserErasureRequestStatus } from "./SecurityUserErasure";

/*
 * HOW FAR AN ERASURE REQUEST HAS GOT (#11232), as Security Events >
 * Settings > Erasure Requests says it under a request that reads Erasing.
 *
 * The erasure worker keeps where it got to on the request
 * (SecurityUserErasureRequest.progress, read by nobody): a pass's cursor,
 * which holds a finding's _id, and counts. The page is told only what it
 * says, worked out on the server (Server/API/SecurityUserErasureRequestAPI):
 * which step the request is at, which pass of the Detection Findings, the
 * time of the last finding that pass read, and when the final check or the
 * next try starts. Never a finding's id, and nothing of the person.
 *
 * POST /security-user-erasure-request/progress answers with a line for
 * each of the project's open requests (Queued or Erasing). Its JSON is
 * written and read here, so the server and the page agree on it.
 */

export const SECURITY_USER_ERASURE_PROGRESS_PATH: string =
  "/security-user-erasure-request/progress";

// The most open requests one answer covers: a project has a few at a time.
export const SECURITY_USER_ERASURE_PROGRESS_LIMIT: number = 100;

// Where an Erasing request is.
export enum SecurityUserErasureStage {
  // Claimed: taking the person out of Postgres and telling ClickHouse.
  Starting = "starting",
  // Told: waiting for ClickHouse to apply what it was told.
  Applying = "applying",
  // Reading the project's Detection Findings, in a pass that changes what names them.
  ReadingFindings = "reading-findings",
  // Every change applied: waiting until no detection that read the name can still run.
  WaitingForFinalCheck = "waiting-for-final-check",
  // The last pass of the findings: done once it finds nothing to change.
  FinalCheck = "final-check",
  // Its last run failed: it tries again once its wait is over.
  Retrying = "retrying",
}

// What the page says of one open request.
export interface SecurityUserErasureProgressLine {
  requestId: string;
  status: SecurityUserErasureRequestStatus;
  // Null while it is Queued.
  stage: SecurityUserErasureStage | null;
  // The pass of the findings it reads: 1 for the first.
  pass?: number | undefined;
  // When the last finding the pass read was written (ISO 8601).
  readUpTo?: string | undefined;
  // When the final check starts (ISO 8601).
  finalCheckAt?: string | undefined;
  // When it tries again (ISO 8601), and why its last run failed.
  retryAt?: string | undefined;
  failureReason?: string | undefined;
}

function readText(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function readTime(value: JSONValue | undefined): string | undefined {
  const text: string = readText(value);

  return text && !Number.isNaN(new Date(text).getTime()) ? text : undefined;
}

function isStatus(value: unknown): value is SecurityUserErasureRequestStatus {
  return Object.values(SecurityUserErasureRequestStatus).includes(
    value as SecurityUserErasureRequestStatus,
  );
}

function isStage(value: unknown): value is SecurityUserErasureStage {
  return Object.values(SecurityUserErasureStage).includes(
    value as SecurityUserErasureStage,
  );
}

// One request's line as the answer holds it.
export function progressLineToJSON(
  line: SecurityUserErasureProgressLine,
): JSONObject {
  const json: JSONObject = {
    requestId: line.requestId,
    status: line.status,
    stage: line.stage,
  };

  if (line.pass !== undefined) {
    json["pass"] = line.pass;
  }

  for (const key of [
    "readUpTo",
    "finalCheckAt",
    "retryAt",
    "failureReason",
  ] as const) {
    if (line[key]) {
      json[key] = line[key]!;
    }
  }

  return json;
}

// The answer: a line for each open request.
export function progressLinesToJSON(
  lines: ReadonlyArray<SecurityUserErasureProgressLine>,
): JSONObject {
  return { requests: lines.map(progressLineToJSON) };
}

/*
 * The lines an answer holds, whatever it held: a line that names no
 * request, or a state it does not know, is left out, and a step it does not
 * know reads as none.
 */
export function readProgressLines(
  json: JSONObject | undefined | null,
): Array<SecurityUserErasureProgressLine> {
  const requests: unknown = json?.["requests"];

  if (!Array.isArray(requests)) {
    return [];
  }

  const lines: Array<SecurityUserErasureProgressLine> = [];

  for (const item of requests) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record: JSONObject = item as JSONObject;
    const requestId: string = readText(record["requestId"]);

    if (!requestId || !isStatus(record["status"])) {
      continue;
    }

    const pass: number = Number(record["pass"]);
    const line: SecurityUserErasureProgressLine = {
      requestId,
      status: record["status"],
      stage: isStage(record["stage"]) ? record["stage"] : null,
    };

    if (Number.isInteger(pass) && pass > 0) {
      line.pass = pass;
    }

    const readUpTo: string | undefined = readTime(record["readUpTo"]);
    const finalCheckAt: string | undefined = readTime(record["finalCheckAt"]);
    const retryAt: string | undefined = readTime(record["retryAt"]);
    const failureReason: string = readText(record["failureReason"]).trim();

    if (readUpTo) {
      line.readUpTo = readUpTo;
    }

    if (finalCheckAt) {
      line.finalCheckAt = finalCheckAt;
    }

    if (retryAt) {
      line.retryAt = retryAt;
    }

    if (failureReason) {
      line.failureReason = failureReason;
    }

    lines.push(line);
  }

  return lines;
}
