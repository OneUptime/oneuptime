import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * A stored security event as a destination sends it: the SecurityEvent
 * row's columns, read into plain values. The reader takes the JSON
 * ClickHouse answers with, so the columns a sender needs are listed once
 * (SECURITY_EVENT_RECORD_COLUMNS) and read the same way everywhere.
 */
export interface SecurityEventRecord {
  id: string;
  time: Date;
  createdAt: Date | null;
  eventUid: string;
  categoryUid: number;
  categoryName: string;
  classUid: number;
  className: string;
  activityName: string;
  severityId: number;
  severityName: string;
  statusName: string;
  message: string;
  vendorName: string;
  productName: string;
  ruleId: string;
  ruleName: string;
  mitreTactics: Array<string>;
  mitreTechniques: Array<string>;
  principalUser: string;
  principalHost: string;
  principalIp: string;
  principalProcess: string;
  targetUser: string;
  targetHost: string;
  targetIp: string;
  targetPort: number;
  targetResource: string;
  observables: Array<string>;
  attributes: Record<string, string>;
}

// The columns a sender reads, in the order a SELECT names them.
export const SECURITY_EVENT_RECORD_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "time",
  "createdAt",
  "eventUid",
  "categoryUid",
  "categoryName",
  "classUid",
  "className",
  "activityName",
  "severityId",
  "severityName",
  "statusName",
  "message",
  "vendorName",
  "productName",
  "ruleId",
  "ruleName",
  "mitreTactics",
  "mitreTechniques",
  "principalUser",
  "principalHost",
  "principalIp",
  "principalProcess",
  "targetUser",
  "targetHost",
  "targetIp",
  "targetPort",
  "targetResource",
  "observables",
  "attributes",
];

function readText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  return typeof value === "string" ? value : String(value);
}

function readNumber(value: JSONValue | undefined): number {
  const number: number = typeof value === "number" ? value : Number(value);

  return Number.isFinite(number) ? number : 0;
}

function readTextArray(value: JSONValue | undefined): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item: JSONValue): string => {
      return readText(item);
    })
    .filter((item: string): boolean => {
      return item.length > 0;
    });
}

/*
 * ClickHouse answers DateTime64 as "2026-10-19 10:00:00.123" in UTC, and a
 * JSON reader may already have made a Date or an ISO string of it.
 */
export function readClickhouseDate(value: JSONValue | undefined): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text: string = readText(value).trim();

  if (!text) {
    return null;
  }

  const isoText: string = text.includes("T")
    ? text
    : `${text.replace(" ", "T")}Z`;
  const date: Date = new Date(isoText);

  return Number.isNaN(date.getTime()) ? null : date;
}

function readAttributes(value: JSONValue | undefined): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const attributes: Record<string, string> = {};

  for (const key of Object.keys(value as JSONObject)) {
    attributes[key] = readText((value as JSONObject)[key]);
  }

  return attributes;
}

export function readSecurityEventRecord(row: JSONObject): SecurityEventRecord {
  return {
    id: readText(row["_id"]),
    time: readClickhouseDate(row["time"]) || new Date(0),
    createdAt: readClickhouseDate(row["createdAt"]),
    eventUid: readText(row["eventUid"]),
    categoryUid: readNumber(row["categoryUid"]),
    categoryName: readText(row["categoryName"]),
    classUid: readNumber(row["classUid"]),
    className: readText(row["className"]),
    activityName: readText(row["activityName"]),
    severityId: readNumber(row["severityId"]),
    severityName: readText(row["severityName"]),
    statusName: readText(row["statusName"]),
    message: readText(row["message"]),
    vendorName: readText(row["vendorName"]),
    productName: readText(row["productName"]),
    ruleId: readText(row["ruleId"]),
    ruleName: readText(row["ruleName"]),
    mitreTactics: readTextArray(row["mitreTactics"]),
    mitreTechniques: readTextArray(row["mitreTechniques"]),
    principalUser: readText(row["principalUser"]),
    principalHost: readText(row["principalHost"]),
    principalIp: readText(row["principalIp"]),
    principalProcess: readText(row["principalProcess"]),
    targetUser: readText(row["targetUser"]),
    targetHost: readText(row["targetHost"]),
    targetIp: readText(row["targetIp"]),
    targetPort: readNumber(row["targetPort"]),
    targetResource: readText(row["targetResource"]),
    observables: readTextArray(row["observables"]),
    attributes: readAttributes(row["attributes"]),
  };
}
