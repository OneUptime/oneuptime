import { DeviceManagementConfig } from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import { JSONObject } from "../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../DataSource/HttpFetch";

/*
 * THE CONTRACT EVERY DEVICE MANAGEMENT CONNECTOR KEEPS.
 *
 * A connector is stateless: every call receives the decrypted settings and
 * opens its own requests, so one instance serves every connection of every
 * project. It turns the service's API into the plain shapes below and
 * nothing more: the read runner (DeviceManagementReadRunner) decides what
 * to read, what changed and what Inventory shows.
 *
 * A read is a session - one API client, one budget of requests and time -
 * through which the runner reads the fleet (devices, groups, check-ins)
 * and then, while the budget lasts, the check-ins no window had and the
 * installed apps of the devices that are due.
 */

/*
 * Decrypted, server-only settings of one connection. Never serialize this
 * into a response or a log line: it holds the API key.
 */
export interface DeviceManagementSettings {
  provider: DeviceManagementProvider;
  projectId: string;
  config: DeviceManagementConfig;
  apiKey: string;
}

/*
 * The HTTP transport every request goes through: the SSRF-guarded
 * DataSourceHttpFetch in production (with every status answered, so a 429's
 * Retry-After can be read), a faithful fake of the service's API in tests.
 */
export type DeviceManagementTransport = (
  request: DataSourceHttpRequest,
) => Promise<DataSourceHttpResponse>;

export interface DeviceManagementCallOptions {
  transport: DeviceManagementTransport;
  // Test seam for "now"; the real clock when absent.
  now?: (() => Date) | undefined;
  // Test seam for waiting (pacing, a Retry-After); setTimeout when absent.
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  // Test seam for the jitter added to a back-off; Math.random when absent.
  random?: (() => number) | undefined;
  requestTimeoutInMs?: number | undefined;
}

export interface DeviceManagementSessionOptions
  extends DeviceManagementCallOptions {
  // Bounds on one read: a request past either throws DeviceManagementBudgetSpent.
  maxRequests: number;
  maxDurationMs: number;
}

/*
 * Where the reads of a connection got to (DeviceManagementConnection
 * .pullState). Server only; holds no secret.
 */
export interface DeviceManagementPullState {
  // The end of the last check-in window read (ISO): the next window starts there.
  checkInCursor?: string | undefined;
  /*
   * Per device (by the service's ID): when its check-in was last asked for
   * on its own (ISO), because no window had it. Asked again a day later at
   * the soonest, so a device that has been off for months costs one request
   * a day, not one a read.
   */
  checkInLookups?: Record<string, string> | undefined;
}

/*
 * A device as the service describes it. Every text is cleaned and bounded;
 * a value the service did not give is "" (a number or a date, null).
 */
export interface ProviderDevice {
  providerDeviceId: string;
  // What it runs: Android, iOS, iPadOS, Windows... (ManagedDevicePlatform).
  platform: ManagedDevicePlatform;
  deviceName: string;
  alias: string;
  serialNumber: string;
  imei: string;
  manufacturer: string;
  brand: string;
  model: string;
  osVersion: string;
  buildNumber: string;
  securityPatchLevel: string;
  agentVersion: string;
  state: number | null;
  groupId: string;
  isKioskMode: boolean | null;
  // Percent, 0 to 100.
  batteryLevel: number | null;
  ipAddresses: Array<string>;
  // Lowercase, colon-separated, or "".
  macAddress: string;
  provisionedAt: Date | null;
  // The rest of what the service reports (ManagedDevice.details).
  details: JSONObject;
}

// A group of devices, with where it sits ("Stores/West/0412").
export interface ProviderGroup {
  id: string;
  name: string;
  path: string;
}

// When a device last checked in.
export interface ProviderCheckIn {
  providerDeviceId: string;
  lastCheckInAt: Date;
}

// An app installed on a device. Every text is cleaned and bounded.
export interface ProviderApp {
  packageName: string;
  appName: string;
  versionName: string;
  versionCode: string;
  state: string;
  isKioskApp: boolean;
  isManagedByService: boolean;
}

export interface DeviceManagementFleetRead {
  // The service's ID of the tenant's enterprise, and the key's role in it.
  enterpriseId: string;
  role: string;
  devices: Array<ProviderDevice>;
  /*
   * Whether the device list was read to its end. One cut short (the budget
   * ran out) says nothing about the devices it left out.
   */
  isDeviceListComplete: boolean;
  groups: Array<ProviderGroup>;
  isGroupListComplete: boolean;
  /*
   * Check-ins within the window, newest per device - and, for a service
   * whose device list says when each device last checked in (an Esper Apple
   * device's last_seen, Intune's lastSyncDateTime), every listed device's.
   */
  checkIns: Array<ProviderCheckIn>;
  /*
   * The end of the check-in window read, when it was read to its end: the
   * next read's window starts there. Undefined when it was cut short, so
   * the next read reads it again.
   */
  checkInWindowEnd?: Date | undefined;
  warnings: Array<string>;
}

/*
 * One read's session: one API client, one budget. Each call throws
 * LlmProviderError when the service refuses it, or
 * DeviceManagementBudgetSpent once the read's budget is spent.
 */
export interface DeviceManagementSession {
  /*
   * The fleet: who the key is, the devices, their groups and the check-ins
   * since `checkInSince`. Stops - never throws - when the budget runs out
   * part way, and says what it did not finish.
   */
  readFleet(data: { checkInSince: Date }): Promise<DeviceManagementFleetRead>;
  /*
   * One device's last check-in, asked on its own. Null when it has none.
   * Absent for a service whose device list already says it of every device
   * (readFleet's checkIns): nothing is then asked one by one.
   */
  readCheckIn?:
    | ((providerDeviceId: string) => Promise<Date | null>)
    | undefined;
  /*
   * Whether the service lists a device's installed apps, by its platform:
   * Esper lists an Android device's, but an Apple device's only as the IDs
   * of the apps it pushed. A device it does not is never due.
   */
  readsAppsOf(device: { platform: ManagedDevicePlatform }): boolean;
  // One device's installed apps, every page of them.
  readApps(data: {
    enterpriseId: string;
    providerDeviceId: string;
  }): Promise<Array<ProviderApp>>;
  getRequestCount(): number;
  wasRateLimited(): boolean;
  // Whether the budget has room for this many more requests.
  hasBudgetFor(requests: number): boolean;
}

export interface DeviceManagementConnector {
  provider: DeviceManagementProvider;
  /*
   * Two read-only calls: is the key accepted (and whose is it), and how many
   * devices a read imports. Never throws: a failure is a result with status
   * "fail".
   */
  testConnection(
    data: {
      apiKey: string;
      config: DeviceManagementConfig;
    },
    options: DeviceManagementCallOptions,
  ): Promise<DeviceManagementTestResult>;
  openSession(
    settings: DeviceManagementSettings,
    options: DeviceManagementSessionOptions,
  ): DeviceManagementSession;
}

// The read's budget ran out: the read stops where it is.
export class DeviceManagementBudgetSpent extends Error {
  public constructor() {
    super("The read reached its limit for this run.");
    this.name = "DeviceManagementBudgetSpent";
  }
}

export function readDeviceManagementPullState(
  value: unknown,
): DeviceManagementPullState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const state: JSONObject = value as JSONObject;
  const result: DeviceManagementPullState = {};
  const cursor: unknown = state["checkInCursor"];

  if (typeof cursor === "string" && !Number.isNaN(Date.parse(cursor))) {
    result.checkInCursor = cursor;
  }

  const lookups: unknown = state["checkInLookups"];

  if (lookups && typeof lookups === "object" && !Array.isArray(lookups)) {
    const read: Record<string, string> = {};

    for (const [deviceId, askedAt] of Object.entries(
      lookups as Record<string, unknown>,
    )) {
      if (typeof askedAt === "string" && !Number.isNaN(Date.parse(askedAt))) {
        read[deviceId] = askedAt;
      }
    }

    result.checkInLookups = read;
  }

  return result;
}
