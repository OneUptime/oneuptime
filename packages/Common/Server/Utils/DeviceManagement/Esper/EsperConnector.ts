import {
  DeviceManagementConfig,
  getEsperApiHost,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { DeviceManagementTestResult } from "../../../../Types/DeviceManagement/DeviceManagementConnectionTest";
import DeviceManagementProvider from "../../../../Types/DeviceManagement/DeviceManagementProvider";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementCallOptions,
  DeviceManagementConnector,
  DeviceManagementFleetRead,
  DeviceManagementSession,
  DeviceManagementSessionOptions,
  DeviceManagementSettings,
  ProviderApp,
  ProviderDevice,
  ProviderGroup,
} from "../DeviceManagementTypes";
import EsperApiClient, {
  EsperList,
  EsperPage,
  buildEsperQuery,
} from "./EsperApiClient";
import {
  cleanText,
  isEsperId,
  newestCheckIns,
  parseEsperApp,
  parseEsperDevice,
  parseEsperGroup,
  parseEsperUserInfo,
} from "./EsperParsers";

/*
 * ESPER, AS A DEVICE MANAGEMENT CONNECTOR.
 *
 * What a read asks Esper for, all read-only and all from Esper's API
 * reference (api.esper.io):
 *
 *   GET /user_info/                         who the key belongs to: its
 *                                           enterprise (profile.enterprise),
 *                                           which the enterprise routes are
 *                                           under, and its role
 *   GET /v2/devices/?platform=ANDROID       the Android devices, 1,000 a page
 *   GET /enterprise/{eid}/devicegroup/      the groups, and where each sits
 *   GET /v2/heartbeat/?last_seen_gt=&last_seen_lt=
 *                                           when each device last checked in,
 *                                           for the devices that did within
 *                                           the window
 *   GET /device/v0/heartbeat/{id}/          one device's last check-in, for
 *                                           a device no window had
 *   GET /enterprise/{eid}/device/{id}/app/  one device's installed apps (the
 *                                           v2 app routes cover iOS and
 *                                           Windows only)
 *
 * Esper sends nothing on its own - it has no webhooks - so this is read on
 * the connection's schedule.
 */

// A page of the v2 device list: Esper's largest.
export const ESPER_DEVICE_PAGE_SIZE: number = 1000;
export const ESPER_GROUP_PAGE_SIZE: number = 100;
export const ESPER_CHECK_IN_PAGE_SIZE: number = 500;
export const ESPER_APP_PAGE_SIZE: number = 250;
// The most pages of each list one read follows.
export const MAX_DEVICE_PAGES: number = 200;
export const MAX_GROUP_PAGES: number = 50;
export const MAX_CHECK_IN_PAGES: number = 200;
export const MAX_APP_PAGES: number = 20;

/*
 * A time as Esper's heartbeat route takes it: ISO 8601, to the second, in
 * UTC ("2023-08-29T00:00:00Z").
 */
export function toEsperTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
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
  const host: string = getEsperApiHost(tenant);

  switch (failure.kind) {
    case LlmConnectionFailureKind.Authentication:
      return {
        message: `Esper refused the API key for the tenant ${tenant}.`,
        remediation:
          "Copy the key again from API Key Management in the Esper console, or make a new one. A key stops working once it is replaced, or once its user is deleted.",
      };
    case LlmConnectionFailureKind.Permission:
      return {
        message: `The API key's user may not read devices in the Esper tenant ${tenant}.`,
        remediation:
          "Use a key of a user whose Esper role can read devices, groups and apps.",
      };
    case LlmConnectionFailureKind.Settings:
      return {
        message: `There is no Esper API at ${host}.`,
        remediation:
          "Check the tenant: it is the name before .esper.cloud in your Esper console's address.",
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        message: "Esper asked OneUptime to slow down.",
        remediation: "Try again in a minute.",
      };
    default:
      return {
        message: `OneUptime could not reach the Esper API at ${host}.`,
        remediation:
          "Check the tenant: it is the name before .esper.cloud in your Esper console's address. If it is right, Esper may be down: try again in a few minutes.",
      };
  }
}

export class EsperSession implements DeviceManagementSession {
  private readonly client: EsperApiClient;
  private readonly now: () => Date;

  public constructor(client: EsperApiClient, now: () => Date) {
    this.client = client;
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

  public async readFleet(data: {
    checkInSince: Date;
  }): Promise<DeviceManagementFleetRead> {
    const warnings: Array<string> = [];

    const userInfo: EsperPage = await this.client.get(
      "/user_info/",
      "",
      "user info request",
    );
    const user: { enterpriseId: string; role: string } = parseEsperUserInfo(
      userInfo.body,
    );

    if (!user.enterpriseId || !isEsperId(user.enterpriseId)) {
      throw new LlmProviderError({
        message:
          "Esper answered, but did not say which enterprise the API key's user belongs to.",
        kind: LlmConnectionFailureKind.Other,
        statusCode: userInfo.status,
      });
    }

    const deviceList: EsperList = await this.client.getAll(
      "/v2/devices/",
      buildEsperQuery([
        ["platform", "ANDROID"],
        ["limit", ESPER_DEVICE_PAGE_SIZE],
        ["ordering", "created_at"],
      ]),
      "device list request",
      MAX_DEVICE_PAGES,
      { stopWhenBudgetSpent: true },
    );

    const devices: Array<ProviderDevice> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of deviceList.items) {
      const device: ProviderDevice | null = parseEsperDevice(item);

      if (!device || seen.has(device.providerDeviceId)) {
        continue;
      }

      seen.add(device.providerDeviceId);
      devices.push(device);
    }

    if (deviceList.isTruncated) {
      warnings.push(
        "The device list was cut short this time: devices missing from it were not marked removed, and the next read carries on.",
      );
    }

    let groups: Array<ProviderGroup> = [];
    let isGroupListComplete: boolean = false;

    if (!deviceList.isBudgetSpent) {
      const groupList: EsperList = await this.client.getAll(
        `/enterprise/${user.enterpriseId}/devicegroup/`,
        buildEsperQuery([["limit", ESPER_GROUP_PAGE_SIZE]]),
        "group list request",
        MAX_GROUP_PAGES,
        { stopWhenBudgetSpent: true },
      );

      groups = groupList.items
        .map((item: unknown): ProviderGroup | null => {
          return parseEsperGroup(item);
        })
        .filter((group: ProviderGroup | null): group is ProviderGroup => {
          return group !== null;
        });
      isGroupListComplete = !groupList.isTruncated;
    }

    const now: Date = this.now();
    let checkIns: DeviceManagementFleetRead["checkIns"] = [];
    let checkInWindowEnd: Date | undefined = undefined;

    if (!deviceList.isBudgetSpent && this.client.hasBudgetFor(1)) {
      const since: Date =
        data.checkInSince.getTime() < now.getTime()
          ? data.checkInSince
          : new Date(now.getTime() - 60 * 1000);

      const checkInList: EsperList = await this.client.getAll(
        "/v2/heartbeat/",
        buildEsperQuery([
          ["last_seen_gt", toEsperTime(since)],
          ["last_seen_lt", toEsperTime(now)],
          ["platform", "ANDROID"],
          ["limit", ESPER_CHECK_IN_PAGE_SIZE],
        ]),
        "check-in list request",
        MAX_CHECK_IN_PAGES,
        { stopWhenBudgetSpent: true },
      );

      checkIns = newestCheckIns(checkInList.items, now);

      if (!checkInList.isTruncated) {
        checkInWindowEnd = now;
      }
    }

    return {
      enterpriseId: user.enterpriseId,
      role: user.role,
      devices: devices,
      isDeviceListComplete: !deviceList.isTruncated,
      groups: groups,
      isGroupListComplete: isGroupListComplete,
      checkIns: checkIns,
      ...(checkInWindowEnd ? { checkInWindowEnd } : {}),
      warnings: warnings,
    };
  }

  public async readCheckIn(providerDeviceId: string): Promise<Date | null> {
    if (!isEsperId(providerDeviceId)) {
      return null;
    }

    try {
      const page: EsperPage = await this.client.get(
        `/device/v0/heartbeat/${providerDeviceId}/`,
        "",
        "check-in request",
      );
      const heartbeat: JSONObject =
        page.body && typeof page.body === "object" && !Array.isArray(page.body)
          ? (page.body as JSONObject)
          : {};
      const timestamp: unknown = heartbeat["timestamp"];

      if (typeof timestamp !== "string") {
        return null;
      }

      const time: number = Date.parse(timestamp);

      if (Number.isNaN(time)) {
        return null;
      }

      // Never later than now: a device whose clock runs ahead.
      return new Date(Math.min(time, this.now().getTime()));
    } catch (error) {
      // A device Esper has no check-in for answers 404: it has none.
      if (error instanceof LlmProviderError && error.statusCode === 404) {
        return null;
      }

      throw error;
    }
  }

  public async readApps(data: {
    enterpriseId: string;
    providerDeviceId: string;
  }): Promise<Array<ProviderApp>> {
    if (!isEsperId(data.enterpriseId) || !isEsperId(data.providerDeviceId)) {
      return [];
    }

    const list: EsperList = await this.client.getAll(
      `/enterprise/${data.enterpriseId}/device/${data.providerDeviceId}/app/`,
      buildEsperQuery([["limit", ESPER_APP_PAGE_SIZE]]),
      "app list request",
      MAX_APP_PAGES,
    );

    const apps: Map<string, ProviderApp> = new Map<string, ProviderApp>();

    for (const item of list.items) {
      const app: ProviderApp | null = parseEsperApp(item);

      if (app && !apps.has(app.packageName)) {
        apps.set(app.packageName, app);
      }
    }

    return Array.from(apps.values());
  }
}

export default class EsperConnector implements DeviceManagementConnector {
  public provider: DeviceManagementProvider = DeviceManagementProvider.Esper;

  public async testConnection(
    data: { apiKey: string; config: DeviceManagementConfig },
    options: DeviceManagementCallOptions,
  ): Promise<DeviceManagementTestResult> {
    const startedAt: number = Date.now();
    const tenant: string = data.config.tenant;

    if (!tenant) {
      return {
        provider: DeviceManagementProvider.Esper,
        status: "fail",
        message:
          "Enter your Esper tenant: the name before .esper.cloud in your Esper console's address.",
        failureKind: LlmConnectionFailureKind.Settings,
        tenant: "",
        durationMs: 0,
      };
    }

    const client: EsperApiClient = new EsperApiClient({
      apiKey: data.apiKey,
      tenant: tenant,
      transport: options.transport,
      now: options.now,
      sleep: options.sleep,
      random: options.random,
      // A test is a few calls: one rate-limit retry at most, then it says so.
      maxRequests: 6,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    try {
      const userInfo: EsperPage = await client.get(
        "/user_info/",
        "",
        "user info request",
      );
      const user: { enterpriseId: string; role: string } = parseEsperUserInfo(
        userInfo.body,
      );

      if (!user.enterpriseId) {
        return {
          provider: DeviceManagementProvider.Esper,
          status: "fail",
          message:
            "Esper answered, but did not say which enterprise the API key's user belongs to.",
          remediation:
            "Make the key as a user of the tenant's enterprise, in API Key Management in the Esper console.",
          failureKind: LlmConnectionFailureKind.Other,
          tenant: tenant,
          durationMs: Date.now() - startedAt,
        };
      }

      const devices: EsperPage = await client.get(
        "/v2/devices/",
        buildEsperQuery([
          ["platform", "ANDROID"],
          ["limit", 1],
        ]),
        "device list request",
      );
      const body: JSONObject =
        devices.body &&
        typeof devices.body === "object" &&
        !Array.isArray(devices.body)
          ? (devices.body as JSONObject)
          : {};
      const count: unknown = body["count"];
      const deviceCount: number | undefined =
        typeof count === "number" && Number.isFinite(count) && count >= 0
          ? Math.floor(count)
          : Array.isArray(body["results"])
            ? (body["results"] as Array<unknown>).length
            : undefined;
      const role: string = cleanText(user.role);

      return {
        provider: DeviceManagementProvider.Esper,
        status: "pass",
        message:
          deviceCount === undefined
            ? `Connected to the Esper tenant ${tenant}.`
            : `Connected to the Esper tenant ${tenant}: ${deviceCount} Android ${deviceCount === 1 ? "device" : "devices"} to import.`,
        tenant: tenant,
        ...(role ? { role: role } : {}),
        ...(deviceCount !== undefined ? { deviceCount: deviceCount } : {}),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error:
          error instanceof DeviceManagementBudgetSpent
            ? new LlmProviderError({
                message: "Esper asked OneUptime to slow down.",
                kind: LlmConnectionFailureKind.RateLimited,
              })
            : error,
        step: "test",
        providerTitle: "Esper",
        secretValues: [data.apiKey],
      });
      const words: { message: string; remediation: string } =
        getTestFailureWords(failure, tenant);

      return {
        provider: DeviceManagementProvider.Esper,
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

    const client: EsperApiClient = new EsperApiClient({
      apiKey: settings.apiKey,
      tenant: settings.config.tenant,
      transport: options.transport,
      now: now,
      sleep: options.sleep,
      random: options.random,
      maxRequests: options.maxRequests,
      deadlineMs: now().getTime() + options.maxDurationMs,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    return new EsperSession(client, now);
  }
}
