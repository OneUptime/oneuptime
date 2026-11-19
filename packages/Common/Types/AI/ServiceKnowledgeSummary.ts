/*
 * WHAT ONEUPTIME AI LEARNED ABOUT A SERVICE, AS ITS PAGE SHOWS IT (#7672).
 *
 * OneUptime AI learns each service's recurring failures from its resolved
 * incidents and alerts whose cause is known - recorded by the team, or
 * OneUptime AI's analysis a person confirmed - with the fix that worked
 * (Server/Utils/AI/SRE/ServiceKnowledge). Its investigations read them; the
 * service's page shows them too, read with the viewer's own permissions
 * (Server/API/ServiceKnowledgeAPI), so a record the viewer may not read is
 * never named or counted.
 *
 * Plain data: the server writes it, the Dashboard draws it in the reader's
 * language. The record titles and causes are the team's own words, drawn as
 * written.
 */

// The most records a failure names on the page, the newest first.
export const MAX_SERVICE_KNOWLEDGE_RECORDS: number = 3;

// The most of a cause the page shows.
export const MAX_SERVICE_KNOWLEDGE_CAUSE_LENGTH: number = 600;

export type ServiceKnowledgeRecordKind = "incident" | "alert";

// One resolved incident or alert a failure was learned from.
export interface ServiceKnowledgeRecord {
  kind: ServiceKnowledgeRecordKind;
  id: string;
  // Its incident or alert number, when it has one.
  number: number | null;
  title: string;
  // When it happened, in ISO 8601.
  happenedAt: string;
}

// The fix that worked, verified: the runbook OneUptime AI started, or the commands it ran.
export interface ServiceKnowledgeFix {
  runbookName: string | null;
  commands: Array<string>;
}

// One failure the service keeps having.
export interface ServiceKnowledgeFailure {
  // How often it was seen, of the records the viewer may read.
  count: number;
  // When it was last seen, in ISO 8601.
  lastSeenAt: string;
  // The newest first, at most MAX_SERVICE_KNOWLEDGE_RECORDS.
  records: Array<ServiceKnowledgeRecord>;
  // Its cause, as the team recorded it or confirmed it; null when unknown.
  cause: string | null;
  // The cause is OneUptime AI's analysis, which someone on the team confirmed.
  isConfirmedAnalysis: boolean;
  fix: ServiceKnowledgeFix | null;
}

export interface ServiceKnowledgeSummary {
  serviceId: string;
  // The failures seen most often first, at most a few.
  failures: Array<ServiceKnowledgeFailure>;
}

function isRecord(value: unknown): value is ServiceKnowledgeRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return (
    (record["kind"] === "incident" || record["kind"] === "alert") &&
    typeof record["id"] === "string" &&
    (record["number"] === null || typeof record["number"] === "number") &&
    typeof record["title"] === "string" &&
    typeof record["happenedAt"] === "string"
  );
}

function isFix(value: unknown): value is ServiceKnowledgeFix {
  if (!value || typeof value !== "object") {
    return false;
  }

  const fix: Record<string, unknown> = value as Record<string, unknown>;

  return (
    (fix["runbookName"] === null || typeof fix["runbookName"] === "string") &&
    Array.isArray(fix["commands"]) &&
    (fix["commands"] as Array<unknown>).every((command: unknown): boolean => {
      return typeof command === "string";
    })
  );
}

function isFailure(value: unknown): value is ServiceKnowledgeFailure {
  if (!value || typeof value !== "object") {
    return false;
  }

  const failure: Record<string, unknown> = value as Record<string, unknown>;

  return (
    typeof failure["count"] === "number" &&
    typeof failure["lastSeenAt"] === "string" &&
    Array.isArray(failure["records"]) &&
    (failure["records"] as Array<unknown>).every(isRecord) &&
    (failure["cause"] === null || typeof failure["cause"] === "string") &&
    typeof failure["isConfirmedAnalysis"] === "boolean" &&
    (failure["fix"] === null || isFix(failure["fix"]))
  );
}

// Whether a response body is a summary, as the Dashboard checks it.
export function isServiceKnowledgeSummary(
  value: unknown,
): value is ServiceKnowledgeSummary {
  if (!value || typeof value !== "object") {
    return false;
  }

  const summary: Record<string, unknown> = value as Record<string, unknown>;

  return (
    typeof summary["serviceId"] === "string" &&
    Array.isArray(summary["failures"]) &&
    (summary["failures"] as Array<unknown>).every(isFailure)
  );
}
