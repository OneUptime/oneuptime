import { JSONObject } from "../JSON";
import { LlmConnectionFailureKind } from "../LlmObservability/LlmConnectionTest";

/*
 * What the last read of a device management connection found, kept on the
 * connection (DeviceManagementConnection.lastPullResult) for its row on
 * Inventory > Managed Devices: how many devices the fleet has and how many
 * are online, what changed since the read before, what it could not read
 * and why, and what it cost the tenant's API budget.
 *
 * Never carries the API key, nor anything about one device.
 */

export type DeviceManagementReadStatus = "success" | "partial" | "failed";

/*
 * Why a read or a test failed. The same kinds - and values - the other
 * managed connections use: the provider HTTP helpers classify with them.
 */
export const DeviceManagementFailureKind: typeof LlmConnectionFailureKind =
  LlmConnectionFailureKind;
export type DeviceManagementFailureKind = LlmConnectionFailureKind;

export interface DeviceManagementReadSummary {
  status: DeviceManagementReadStatus;
  // The tenant as it was read.
  tenant: string;
  // The role of the user the API key belongs to, as the service names it.
  role?: string | undefined;
  // Devices the service lists for the tenant (Android devices for Esper).
  deviceCount: number;
  // Of those, how many checked in within the online window, and how many did not.
  onlineCount: number;
  offlineCount: number;
  // What this read changed: devices new to OneUptime, changed, and gone from the service.
  addedCount: number;
  changedCount: number;
  removedCount: number;
  groupCount: number;
  /*
   * Devices whose Inventory host was found among the hosts telemetry
   * reports (by name, device ID or serial number), rather than made for
   * them: the devices that are one row with their apps' or agent's
   * telemetry.
   */
  matchedHostCount: number;
  /*
   * Devices whose installed apps this read refreshed, and devices whose
   * apps are due but wait for a later read (a large fleet's apps are read
   * over several reads, to stay inside the API's rate limits).
   */
  appsReadDeviceCount: number;
  appsWaitingDeviceCount: number;
  /*
   * Whether the device list was read to its end. A list cut short says
   * nothing about the devices it left out, so no device is marked removed
   * from it.
   */
  isDeviceListComplete: boolean;
  // API calls this read made: what it cost the tenant's budget.
  requestCount: number;
  // The service asked OneUptime to slow down (HTTP 429) during this read.
  wasRateLimited: boolean;
  // What the person should know that did not stop the read (at most 10).
  warnings: Array<string>;
  failureKind?: DeviceManagementFailureKind | undefined;
  durationMs: number;
  finishedAt: string;
}

export const MAX_DEVICE_MANAGEMENT_READ_WARNINGS: number = 10;

function readCount(value: unknown): number {
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
export function readDeviceManagementReadSummary(
  value: unknown,
): DeviceManagementReadSummary | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const summary: JSONObject = value as JSONObject;
  const status: unknown = summary["status"];

  if (status !== "success" && status !== "partial" && status !== "failed") {
    return undefined;
  }

  const failureKind: unknown = summary["failureKind"];
  const role: string = readText(summary["role"]);

  return {
    status: status,
    tenant: readText(summary["tenant"]),
    ...(role ? { role: role } : {}),
    deviceCount: readCount(summary["deviceCount"]),
    onlineCount: readCount(summary["onlineCount"]),
    offlineCount: readCount(summary["offlineCount"]),
    addedCount: readCount(summary["addedCount"]),
    changedCount: readCount(summary["changedCount"]),
    removedCount: readCount(summary["removedCount"]),
    groupCount: readCount(summary["groupCount"]),
    matchedHostCount: readCount(summary["matchedHostCount"]),
    appsReadDeviceCount: readCount(summary["appsReadDeviceCount"]),
    appsWaitingDeviceCount: readCount(summary["appsWaitingDeviceCount"]),
    isDeviceListComplete: summary["isDeviceListComplete"] !== false,
    requestCount: readCount(summary["requestCount"]),
    wasRateLimited: summary["wasRateLimited"] === true,
    warnings: Array.isArray(summary["warnings"])
      ? (summary["warnings"] as Array<unknown>)
          .filter((warning: unknown): boolean => {
            return typeof warning === "string" && warning.length > 0;
          })
          .slice(0, MAX_DEVICE_MANAGEMENT_READ_WARNINGS)
          .map((warning: unknown): string => {
            return warning as string;
          })
      : [],
    ...(Object.values(LlmConnectionFailureKind).includes(
      failureKind as LlmConnectionFailureKind,
    )
      ? { failureKind: failureKind as DeviceManagementFailureKind }
      : {}),
    durationMs: readCount(summary["durationMs"]),
    finishedAt: readText(summary["finishedAt"]),
  };
}
