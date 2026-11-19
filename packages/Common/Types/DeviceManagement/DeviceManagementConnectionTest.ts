import { DeviceManagementFailureKind } from "./DeviceManagementReadSummary";

/*
 * What "Test" answers for a device management connection, before or after
 * it is saved. A test makes two read-only calls - who the API key belongs to
 * (which also names the tenant's enterprise), and the first page of the
 * device list - and says whether the connection works and how many devices
 * a read will import; when it does not work, what to do about it.
 *
 * Nothing is stored, and the answer never carries the API key.
 */

export type DeviceManagementTestStatus = "pass" | "fail";

export interface DeviceManagementTestResult {
  provider: string;
  status: DeviceManagementTestStatus;
  // One or two sentences for the person reading it. Never a credential.
  message: string;
  // What to do when it did not pass.
  remediation?: string | undefined;
  failureKind?: DeviceManagementFailureKind | undefined;
  // The tenant tested, as it was read.
  tenant: string;
  // The role of the user the key belongs to, as the service names it.
  role?: string | undefined;
  // The devices a read will import (Android devices, for Esper).
  deviceCount?: number | undefined;
  durationMs: number;
}

export { DeviceManagementFailureKind };
