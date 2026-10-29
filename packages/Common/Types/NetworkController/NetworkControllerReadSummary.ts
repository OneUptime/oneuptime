import { JSONObject } from "../JSON";
import { LlmConnectionFailureKind } from "../LlmObservability/LlmConnectionTest";

/*
 * What the last read of a network controller connection found, kept on the
 * connection (NetworkControllerConnection.lastPullResult) for the Traffic
 * page to show: how much of the organization it reached, what it could not
 * read and why, and what it cost the organization's API budget.
 *
 * Never carries the API key, nor any of the traffic itself.
 */

export type NetworkControllerReadStatus = "success" | "partial" | "failed";

/*
 * Why a read or a test failed. The same kinds - and values - the other
 * managed connections use: the provider HTTP helpers classify with them.
 */
export const NetworkControllerFailureKind: typeof LlmConnectionFailureKind =
  LlmConnectionFailureKind;
export type NetworkControllerFailureKind = LlmConnectionFailureKind;

export interface NetworkControllerReadSummary {
  status: NetworkControllerReadStatus;
  // The organization as Meraki names it when it was read.
  organizationName: string;
  // Networks in the organization, and appliances (MX, Z) among its devices.
  networkCount: number;
  applianceCount: number;
  // Appliances that are devices in OneUptime (by serial number or MAC address).
  matchedDeviceCount: number;
  /*
   * Devices of every kind in the organization's device list, and how many of
   * them are network devices in OneUptime - whose missing details (model,
   * serial number, firmware...) are filled in from Meraki
   * (NetworkControllerInventory). Absent from a summary written before
   * Meraki was read as a source of device details.
   */
  deviceCount?: number | undefined;
  describedDeviceCount?: number | undefined;
  // Uplink windows this read stored, and the end of the newest (ISO).
  uplinkWindows: number;
  newestUplinkAt?: string | undefined;
  /*
   * Networks whose applications, destinations and clients this read stored,
   * and the networks still waiting for theirs (a large organization's are
   * read over several reads, to stay inside its API budget).
   */
  analyticsNetworks: number;
  analyticsNetworksWaiting: number;
  // Networks on which Meraki keeps no traffic analytics (turned off there).
  trafficAnalysisOffNetworks: number;
  // Rows this read stored.
  rowsWritten: number;
  // API calls this read made: what it cost the organization's budget.
  requestCount: number;
  // Meraki asked OneUptime to slow down (HTTP 429) during this read.
  wasRateLimited: boolean;
  // What the person should know that did not stop the read (at most 10).
  warnings: Array<string>;
  failureKind?: NetworkControllerFailureKind | undefined;
  durationMs: number;
  finishedAt: string;
}

export const MAX_READ_SUMMARY_WARNINGS: number = 10;

function readNumber(value: unknown): number {
  const parsed: number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/*
 * A stored summary read back without trusting its shape; undefined for a
 * connection that was never read.
 */
export function readNetworkControllerReadSummary(
  value: unknown,
): NetworkControllerReadSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const summary: JSONObject = value as JSONObject;
  const status: unknown = summary["status"];

  if (status !== "success" && status !== "partial" && status !== "failed") {
    return undefined;
  }

  const failureKind: unknown = summary["failureKind"];
  const newestUplinkAt: string = readText(summary["newestUplinkAt"]);
  const hasDeviceCounts: boolean =
    summary["deviceCount"] !== undefined && summary["deviceCount"] !== null;

  return {
    status: status,
    organizationName: readText(summary["organizationName"]),
    networkCount: readNumber(summary["networkCount"]),
    applianceCount: readNumber(summary["applianceCount"]),
    matchedDeviceCount: readNumber(summary["matchedDeviceCount"]),
    ...(hasDeviceCounts
      ? {
          deviceCount: readNumber(summary["deviceCount"]),
          describedDeviceCount: Math.min(
            readNumber(summary["deviceCount"]),
            readNumber(summary["describedDeviceCount"]),
          ),
        }
      : {}),
    uplinkWindows: readNumber(summary["uplinkWindows"]),
    ...(newestUplinkAt ? { newestUplinkAt: newestUplinkAt } : {}),
    analyticsNetworks: readNumber(summary["analyticsNetworks"]),
    analyticsNetworksWaiting: readNumber(summary["analyticsNetworksWaiting"]),
    trafficAnalysisOffNetworks: readNumber(
      summary["trafficAnalysisOffNetworks"],
    ),
    rowsWritten: readNumber(summary["rowsWritten"]),
    requestCount: readNumber(summary["requestCount"]),
    wasRateLimited: summary["wasRateLimited"] === true,
    warnings: Array.isArray(summary["warnings"])
      ? (summary["warnings"] as Array<unknown>)
          .filter((warning: unknown): boolean => {
            return typeof warning === "string" && warning.length > 0;
          })
          .slice(0, MAX_READ_SUMMARY_WARNINGS)
          .map((warning: unknown): string => {
            return warning as string;
          })
      : [],
    ...(Object.values(LlmConnectionFailureKind).includes(
      failureKind as LlmConnectionFailureKind,
    )
      ? { failureKind: failureKind as NetworkControllerFailureKind }
      : {}),
    durationMs: readNumber(summary["durationMs"]),
    finishedAt: readText(summary["finishedAt"]),
  };
}
