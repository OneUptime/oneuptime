import { JSONArray, JSONObject, JSONValue } from "Common/Types/JSON";
import { SecurityOverviewMetrics } from "Common/Utils/SecurityCase/SecurityOverviewMetrics";

/*
 * What the Security product's own routes answer, read defensively: a field
 * the server left out reads as nothing rather than throwing in a render.
 * Apart from the calls (SecurityCaseApi.ts) so the reading is tested
 * without a browser.
 */

export interface SecurityOverview {
  generatedAt: Date;
  caseWindowInDays: number;
  detectionWindowInDays: number;
  myOpenCases: number;
  runsWaitingForApproval: number;
  isTruncated: boolean;
  metrics: SecurityOverviewMetrics;
}

export interface EntityActivity {
  value: string;
  eventCount: number;
  findingCount: number;
  maxSeverityId: number;
  firstSeen: Date | null;
  lastSeen: Date | null;
}

export interface EntityFindingSummary {
  value: string;
  findingCount: number;
  ruleCount: number;
  maxSeverityId: number;
  lastSeen: Date | null;
}

export interface DeclaredIncident {
  incidentId: string;
  incidentNumber: string;
}

export function readNumber(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readDate(value: JSONValue | undefined): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const date: Date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readArray(value: JSONValue | undefined): Array<JSONObject> {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value as JSONArray).filter((item: JSONValue): item is JSONObject => {
    return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  });
}

export function parseEntityActivity(body: JSONObject): Array<EntityActivity> {
  return readArray(body["activity"]).map((item: JSONObject): EntityActivity => {
    return {
      value: String(item["value"] || ""),
      eventCount: readNumber(item["eventCount"]),
      findingCount: readNumber(item["findingCount"]),
      maxSeverityId: readNumber(item["maxSeverityId"]),
      firstSeen: readDate(item["firstSeen"]),
      lastSeen: readDate(item["lastSeen"]),
    };
  });
}

export function parseTopEntities(
  body: JSONObject,
): Array<EntityFindingSummary> {
  return readArray(body["entities"]).map(
    (item: JSONObject): EntityFindingSummary => {
      return {
        value: String(item["value"] || ""),
        findingCount: readNumber(item["findingCount"]),
        ruleCount: readNumber(item["ruleCount"]),
        maxSeverityId: readNumber(item["maxSeverityId"]),
        lastSeen: readDate(item["lastSeen"]),
      };
    },
  );
}

export function parseOverview(body: JSONObject): SecurityOverview {
  return {
    generatedAt: readDate(body["generatedAt"]) || new Date(),
    caseWindowInDays: readNumber(body["caseWindowInDays"]) || 30,
    detectionWindowInDays: readNumber(body["detectionWindowInDays"]) || 14,
    myOpenCases: readNumber(body["myOpenCases"]),
    runsWaitingForApproval: readNumber(body["runsWaitingForApproval"]),
    isTruncated: body["isTruncated"] === true,
    metrics: body["metrics"] as unknown as SecurityOverviewMetrics,
  };
}
