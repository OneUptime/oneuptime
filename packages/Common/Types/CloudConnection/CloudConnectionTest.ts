import { JSONObject, JSONValue } from "../JSON";
import { LlmConnectionFailureKind } from "../LlmObservability/LlmConnectionTest";

/*
 * What "Test connection" and a read answer for a cloud connection.
 *
 * A test signs in and reads a little of what a real read would - the
 * resources of one AWS Region, the first page of an Azure subscription's
 * resources, one Cloud Monitoring metric of a project - and says whether
 * the connection works and what it would bring in, or, when it does not
 * work, why. Nothing is stored. A read stores what it found on the
 * connection (CloudConnection.lastPullResult) in the same words.
 *
 * Never carries a credential.
 */

export type CloudConnectionTestStatus = "pass" | "warn" | "fail";

/*
 * Why a test or a read failed, so the dashboard can say what to fix
 * without reading the cloud's error text. The same kinds the AI
 * connections use, and the same values: the provider HTTP helpers both
 * kinds of connection share classify failures with them.
 */
export const CloudConnectionFailureKind: typeof LlmConnectionFailureKind =
  LlmConnectionFailureKind;
export type CloudConnectionFailureKind = LlmConnectionFailureKind;

// How many resources of one provider type, e.g. AWS::EC2::Instance: 12.
export interface CloudConnectionTypeCount {
  type: string;
  count: number;
}

// How many resources in one region or location.
export interface CloudConnectionRegionCount {
  region: string;
  count: number;
}

export interface CloudConnectionTestResult {
  provider: string;
  status: CloudConnectionTestStatus;
  // One or two sentences, in English, for the details. Never a credential.
  message: string;
  failureKind?: CloudConnectionFailureKind | undefined;
  /*
   * What the credential reaches: an AWS account id, the Azure
   * subscriptions, the Google Cloud projects.
   */
  accounts?: Array<string> | undefined;
  resourceCount?: number | undefined;
  resourceTypes?: Array<CloudConnectionTypeCount> | undefined;
  regions?: Array<CloudConnectionRegionCount> | undefined;
  /*
   * True when the counts are a sample, not everything a read finds: a test
   * stops after the first page of resources, or the first few Regions,
   * where the first read goes through all of them.
   */
  isSample?: boolean | undefined;
  durationMs: number;
}

export type CloudConnectionReadStatus = "success" | "partial" | "failed";

/*
 * What the last read of a connection found, kept on the connection
 * (CloudConnection.lastPullResult) for the list to show.
 */
export interface CloudConnectionReadSummary {
  status: CloudConnectionReadStatus;
  accounts: Array<string>;
  // Resources the connection holds now: found by this read or one before.
  resourceCount: number;
  resourceTypes: Array<CloudConnectionTypeCount>;
  regions: Array<CloudConnectionRegionCount>;
  // Resources this read added, and ones it archived because they are gone.
  newResources: number;
  archivedResources: number;
  // Metric datapoints this read wrote.
  pointsWritten: number;
  // Change and health events this read kept.
  changesRecorded: number;
  // Calls this read made to the cloud's APIs.
  requestCount: number;
  // Things the person should know that did not stop the read.
  warnings: Array<string>;
  failureKind?: CloudConnectionFailureKind | undefined;
  durationMs: number;
  finishedAt: string;
}

// The most entries a summary keeps per list: the rest are counted only.
export const CLOUD_CONNECTION_SUMMARY_TOP: number = 12;

function readNumber(value: JSONValue | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function readStrings(value: JSONValue | undefined): Array<string> {
  if (!Array.isArray(value)) {
    return [];
  }

  const strings: Array<string> = [];

  for (const item of value) {
    if (typeof item === "string" && item.length > 0) {
      strings.push(item);
    }
  }

  return strings;
}

function readCounts<
  T extends CloudConnectionTypeCount | CloudConnectionRegionCount,
>(value: JSONValue | undefined, key: "type" | "region"): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  const counts: Array<T> = [];

  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const entry: JSONObject = item as JSONObject;
    const name: JSONValue | undefined = entry[key];
    const count: number = readNumber(entry["count"]);

    if (typeof name === "string" && name && count > 0) {
      counts.push({ [key]: name, count } as unknown as T);
    }
  }

  return counts;
}

/*
 * A stored read result as the summary it is - every field present, every
 * value of the right type - or undefined before the first read.
 */
export function readCloudConnectionReadSummary(
  value: JSONObject | null | undefined,
): CloudConnectionReadSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const status: JSONValue | undefined = value["status"];

  if (status !== "success" && status !== "partial" && status !== "failed") {
    return undefined;
  }

  const failureKind: JSONValue | undefined = value["failureKind"];

  return {
    status,
    accounts: readStrings(value["accounts"]),
    resourceCount: readNumber(value["resourceCount"]),
    resourceTypes: readCounts<CloudConnectionTypeCount>(
      value["resourceTypes"],
      "type",
    ),
    regions: readCounts<CloudConnectionRegionCount>(value["regions"], "region"),
    newResources: readNumber(value["newResources"]),
    archivedResources: readNumber(value["archivedResources"]),
    pointsWritten: readNumber(value["pointsWritten"]),
    changesRecorded: readNumber(value["changesRecorded"]),
    requestCount: readNumber(value["requestCount"]),
    warnings: readStrings(value["warnings"]),
    failureKind:
      typeof failureKind === "string" &&
      (Object.values(CloudConnectionFailureKind) as Array<string>).includes(
        failureKind,
      )
        ? (failureKind as CloudConnectionFailureKind)
        : undefined,
    durationMs: readNumber(value["durationMs"]),
    finishedAt:
      typeof value["finishedAt"] === "string" ? value["finishedAt"] : "",
  };
}

/*
 * Counts by a key, most first and then by name, the top
 * CLOUD_CONNECTION_SUMMARY_TOP of them.
 */
export function countCloudConnectionValues(
  values: Array<string>,
): Array<{ value: string; count: number }> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    counts.set(value, (counts.get(value) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([value, count]: [string, number]) => {
      return { value, count };
    })
    .sort(
      (
        a: { value: string; count: number },
        b: { value: string; count: number },
      ): number => {
        return b.count - a.count || a.value.localeCompare(b.value);
      },
    )
    .slice(0, CLOUD_CONNECTION_SUMMARY_TOP);
}
