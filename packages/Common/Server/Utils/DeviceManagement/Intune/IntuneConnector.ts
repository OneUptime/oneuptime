import {
  DeviceManagementConfig,
  INTUNE_CLOUD_TITLES,
  isIntuneCloud,
  readIntuneClientId,
  readIntuneTenant,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "../../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { ManagedDevicePlatform } from "../../../../Types/DeviceManagement/ManagedDevicePlatform";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementCallOptions,
  DeviceManagementConnector,
  DeviceManagementFleetRead,
  DeviceManagementSecrets,
  DeviceManagementSession,
  DeviceManagementSessionOptions,
  DeviceManagementSettings,
  ProviderApp,
  ProviderDevice,
} from "../DeviceManagementTypes";
import IntuneGraphClient, {
  INTUNE_READ_PERMISSION,
  IntuneList,
  IntunePage,
} from "./IntuneGraphClient";
import {
  IntuneDeviceRead,
  getIntuneCheckIns,
  getIntuneGroups,
  parseIntuneBatteryLevel,
  parseIntuneDetectedApps,
  parseIntuneDevice,
  parseIntuneEnrolledDeviceCount,
} from "./IntuneParsers";

/*
 * MICROSOFT INTUNE, AS A DEVICE MANAGEMENT CONNECTOR (#9837).
 *
 * What a read asks Microsoft Graph for, all read-only, all under the one
 * application permission DeviceManagementManagedDevices.Read.All:
 *
 *   POST {login}/{tenant}/oauth2/v2.0/token      the client credentials
 *                                                grant: a token for Graph
 *   GET /v1.0/deviceManagement/managedDevices    every device Intune
 *                                                manages, a page at a time
 *                                                (@odata.nextLink): Windows,
 *                                                macOS, iOS, iPadOS, Android
 *                                                and Linux. Each says when
 *                                                it last checked in
 *                                                (lastSyncDateTime), so no
 *                                                check-in is asked for on
 *                                                its own.
 *   GET /v1.0/deviceManagement/managedDeviceOverview
 *                                                how many devices are
 *                                                enrolled: "Test" says it
 *   GET /beta/deviceManagement/managedDevices/{id}?$select=id&$expand=detectedApps
 *                                                one device's discovered
 *                                                apps. Graph has them on
 *                                                beta only; Microsoft
 *                                                supports Intune's beta
 *                                                routes but changes them
 *                                                more often.
 *   GET /beta/deviceManagement/managedDevices/{id}?$select=id,hardwareInformation
 *                                                an iPhone's or an iPad's
 *                                                battery (#10287): Graph
 *                                                fills hardwareInformation
 *                                                only on a device read
 *                                                alone, with $select, and
 *                                                its batteryLevelPercentage
 *                                                on iOS and iPadOS alone,
 *                                                per check-in. Asked once a
 *                                                device has checked in since
 *                                                it was last asked
 *                                                (DeviceManagementReadRunner
 *                                                .getBatteryLookups), within
 *                                                the read's budget and
 *                                                Graph's 2,000 requests per
 *                                                20 seconds an app may make
 *                                                of the tenant's devices.
 *
 * Intune's groups are Microsoft Entra groups, which this permission does
 * not read; a device's category is its group instead. A device's user is
 * never read. Intune sends nothing on its own, so this is read on the
 * connection's schedule.
 */

// The most pages of the device list one read follows: Graph pages Intune's by 1,000.
export const MAX_INTUNE_DEVICE_PAGES: number = 200;

export const INTUNE_DEVICES_PATH: string =
  "/v1.0/deviceManagement/managedDevices";
export const INTUNE_OVERVIEW_PATH: string =
  "/v1.0/deviceManagement/managedDeviceOverview";

export function getIntuneBetaDevicePath(providerDeviceId: string): string {
  return `/beta/deviceManagement/managedDevices/${encodeURIComponent(providerDeviceId)}`;
}

export const INTUNE_DETECTED_APPS_QUERY: string =
  "?$select=id&$expand=detectedApps";

// One device's hardware, which holds an iPhone's or an iPad's battery (#10287).
export const INTUNE_HARDWARE_QUERY: string = "?$select=id,hardwareInformation";

/*
 * The platforms Graph says a battery level of: "currently supported only
 * on devices running iOS 5.0 and later" (hardwareInformation), an iPad's
 * iPadOS among them. No other device is asked.
 */
export const INTUNE_BATTERY_PLATFORMS: ReadonlyArray<ManagedDevicePlatform> = [
  ManagedDevicePlatform.IOS,
  ManagedDevicePlatform.IPadOS,
];

// The tenant as a test names it: its ID or domain, and its cloud when it is not the commercial one.
function describeTenant(config: DeviceManagementConfig): string {
  return isIntuneCloud(config.cloud) && config.cloud !== "public"
    ? `${config.tenant} (${INTUNE_CLOUD_TITLES[config.cloud]})`
    : config.tenant;
}

/*
 * What a failed test means, for the person who set the connection up: why,
 * and what to do. The dashboard words its own sentence from the kind; this
 * is what the API answers and what an API client reads.
 */
function getTestFailureWords(
  failure: LlmProviderError,
  tenant: string,
): { message: string; remediation: string } {
  switch (failure.kind) {
    case LlmConnectionFailureKind.Authentication:
      return {
        message: `Microsoft Entra refused the app registration's client secret for the tenant ${tenant}.`,
        remediation:
          "Copy the secret's Value again from Certificates & secrets on the app registration, or make a new one: a secret stops working when it expires.",
      };
    case LlmConnectionFailureKind.Permission:
      return {
        message: `The app registration may not read Intune's devices in the tenant ${tenant}.`,
        remediation: `Give it the application permission ${INTUNE_READ_PERMISSION} on Microsoft Graph, under API permissions, and grant admin consent.`,
      };
    case LlmConnectionFailureKind.Settings:
      return {
        message: `Microsoft did not find this tenant or app registration: ${tenant}.`,
        remediation:
          "Check the tenant ID, the Application (client) ID and the cloud: all three are on the app registration's Overview in the Microsoft Entra admin center.",
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        message: "Microsoft Graph asked OneUptime to slow down.",
        remediation: "Try again in a minute.",
      };
    default:
      return {
        message: "OneUptime could not reach Microsoft Graph.",
        remediation:
          "Check the cloud the tenant is in. If it is right, Microsoft may be having trouble: try again in a few minutes.",
      };
  }
}

export class IntuneSession implements DeviceManagementSession {
  private readonly client: IntuneGraphClient;
  private readonly tenant: string;
  private readonly now: () => Date;

  public constructor(
    client: IntuneGraphClient,
    tenant: string,
    now: () => Date,
  ) {
    this.client = client;
    this.tenant = tenant;
    this.now = now;
  }

  public getRequestCount(): number {
    return this.client.getRequestCount();
  }

  public wasRateLimited(): boolean {
    return this.client.wasRateLimited();
  }

  public hasBudgetFor(requests: number): boolean {
    return this.client.hasBudgetFor(requests);
  }

  public async readFleet(_data: {
    checkInSince: Date;
  }): Promise<DeviceManagementFleetRead> {
    const warnings: Array<string> = [];

    const list: IntuneList = await this.client.getAll(
      INTUNE_DEVICES_PATH,
      "",
      "device list request",
      MAX_INTUNE_DEVICE_PAGES,
      { stopWhenBudgetSpent: true },
    );

    const listedAt: Date = this.now();
    const reads: Array<IntuneDeviceRead> = [];
    const seen: Set<string> = new Set<string>();
    let unreadable: number = 0;

    for (const item of list.items) {
      const read: IntuneDeviceRead | null = parseIntuneDevice(item, listedAt);

      if (!read) {
        unreadable++;
        continue;
      }

      if (seen.has(read.device.providerDeviceId)) {
        continue;
      }

      seen.add(read.device.providerDeviceId);
      reads.push(read);
    }

    if (unreadable > 0) {
      warnings.push(
        `${unreadable} ${unreadable === 1 ? "device" : "devices"} in Intune's list had no ID and ${unreadable === 1 ? "was" : "were"} left out.`,
      );
    }

    if (list.isTruncated) {
      warnings.push(
        "The device list was cut short this time: devices missing from it were not marked removed, and the next read carries on.",
      );
    }

    const devices: Array<ProviderDevice> = reads.map(
      (read: IntuneDeviceRead): ProviderDevice => {
        return read.device;
      },
    );

    return {
      enterpriseId: this.tenant,
      role: "",
      devices,
      isDeviceListComplete: !list.isTruncated,
      // A device's category is in its own record: its list is the device list's.
      groups: getIntuneGroups(devices),
      isGroupListComplete: !list.isTruncated,
      checkIns: getIntuneCheckIns(reads),
      // Every listed device says when it last checked in: there is no window.
      ...(list.isTruncated ? {} : { checkInWindowEnd: listedAt }),
      warnings,
    };
  }

  // Intune discovers apps on every platform it manages.
  public readsAppsOf(_device: { platform: ManagedDevicePlatform }): boolean {
    return true;
  }

  public async readApps(data: {
    enterpriseId: string;
    providerDeviceId: string;
  }): Promise<Array<ProviderApp>> {
    const page: IntunePage = await this.client.get(
      getIntuneBetaDevicePath(data.providerDeviceId),
      INTUNE_DETECTED_APPS_QUERY,
      "app list request",
    );

    return parseIntuneDetectedApps(page.body);
  }

  // An iPhone's or an iPad's battery: Graph says none of another device's.
  public readsBatteryOf(device: { platform: ManagedDevicePlatform }): boolean {
    return INTUNE_BATTERY_PLATFORMS.includes(device.platform);
  }

  // One device's battery, as Intune last heard it: null when it says none.
  public async readBatteryLevel(
    providerDeviceId: string,
  ): Promise<number | null> {
    const page: IntunePage = await this.client.get(
      getIntuneBetaDevicePath(providerDeviceId),
      INTUNE_HARDWARE_QUERY,
      "battery request",
    );

    return parseIntuneBatteryLevel(page.body);
  }
}

export default class IntuneConnector implements DeviceManagementConnector {
  public provider: DeviceManagementProvider = DeviceManagementProvider.Intune;

  /*
   * Three read-only calls: a token (are the tenant, the app registration
   * and its secret right), the first device of the list (may it read
   * Intune's devices), and the overview (how many a read will import).
   * Never throws: a failure is a result with status "fail".
   */
  public async testConnection(
    data: DeviceManagementSecrets & { config: DeviceManagementConfig },
    options: DeviceManagementCallOptions,
  ): Promise<DeviceManagementTestResult> {
    const startedAt: number = Date.now();
    let tenant: string = data.config.tenant;

    try {
      tenant = readIntuneTenant(data.config.tenant);
      readIntuneClientId(data.config.clientId);
    } catch (error) {
      return {
        provider: DeviceManagementProvider.Intune,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        failureKind: LlmConnectionFailureKind.Settings,
        tenant: tenant,
        durationMs: 0,
      };
    }

    const config: DeviceManagementConfig = { ...data.config, tenant };
    const shownTenant: string = describeTenant(config);
    const client: IntuneGraphClient = new IntuneGraphClient({
      tenant,
      clientId: config.clientId || "",
      clientSecret: data.clientSecret || "",
      cloud: config.cloud,
      transport: options.transport,
      now: options.now,
      sleep: options.sleep,
      random: options.random,
      // A test is a few calls: a rate-limit retry or two, then it says so.
      maxRequests: 8,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    try {
      await client.get(
        INTUNE_DEVICES_PATH,
        "?$top=1&$select=id",
        "device list request",
      );

      let deviceCount: number | undefined = undefined;

      try {
        const overview: IntunePage = await client.get(
          INTUNE_OVERVIEW_PATH,
          "",
          "device overview request",
        );
        deviceCount = parseIntuneEnrolledDeviceCount(overview.body);
      } catch {
        // The devices are readable either way; only the count is not said.
        deviceCount = undefined;
      }

      return {
        provider: DeviceManagementProvider.Intune,
        status: "pass",
        message:
          deviceCount === undefined
            ? `Connected to the Intune tenant ${shownTenant}.`
            : `Connected to the Intune tenant ${shownTenant}: ${deviceCount} ${deviceCount === 1 ? "device" : "devices"} to import.`,
        tenant: tenant,
        ...(deviceCount !== undefined ? { deviceCount } : {}),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error:
          error instanceof DeviceManagementBudgetSpent
            ? new LlmProviderError({
                message: "Microsoft Graph asked OneUptime to slow down.",
                kind: LlmConnectionFailureKind.RateLimited,
              })
            : error,
        step: "test",
        providerTitle: "Microsoft Intune",
        secretValues: [data.clientSecret || ""].filter(Boolean),
      });
      const words: { message: string; remediation: string } =
        getTestFailureWords(failure, shownTenant);

      return {
        provider: DeviceManagementProvider.Intune,
        status: "fail",
        message: `${words.message} ${failure.message}`.trim(),
        remediation: words.remediation,
        failureKind: failure.kind,
        tenant: tenant,
        durationMs: Date.now() - startedAt,
      };
    }
  }

  public openSession(
    settings: DeviceManagementSettings,
    options: DeviceManagementSessionOptions,
  ): DeviceManagementSession {
    const now: () => Date =
      options.now ||
      ((): Date => {
        return new Date();
      });

    const client: IntuneGraphClient = new IntuneGraphClient({
      tenant: settings.config.tenant,
      clientId: settings.config.clientId || "",
      clientSecret: settings.clientSecret || "",
      cloud: settings.config.cloud,
      transport: options.transport,
      now: now,
      sleep: options.sleep,
      random: options.random,
      maxRequests: options.maxRequests,
      deadlineMs: now().getTime() + options.maxDurationMs,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    return new IntuneSession(client, settings.config.tenant, now);
  }
}
