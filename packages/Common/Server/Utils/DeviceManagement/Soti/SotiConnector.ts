import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  DeviceManagementConfig,
  SOTI_SERVER_HELP,
  readSotiClientId,
  readSotiClientSecret,
  readSotiPassword,
  readSotiServer,
  readSotiUsername,
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
import TenantServerClient, { TenantServerAnswer } from "../TenantServerClient";
import {
  SOTI_READ_PERMISSIONS,
  SOTI_TITLE,
  createSotiClient,
} from "./SotiApiClient";
import {
  SotiDeviceRead,
  getSotiCheckIns,
  getSotiGroups,
  parseSotiApps,
  parseSotiDevice,
  parseSotiManagedDeviceCount,
} from "./SotiParsers";

/*
 * SOTI MOBICONTROL, AS A DEVICE MANAGEMENT CONNECTOR (#10087).
 *
 * What a read asks the MobiControl server for, all read-only, as a
 * MobiControl user whose permissions are Web Console Access and View
 * Installed Applications, and View Groups on the device groups to read:
 *
 *   POST /MobiControl/api/token     the API client and the user's sign-in
 *   GET /MobiControl/api/devices?skip=N&take=500
 *                                   every device of the groups the user may
 *                                   view, 500 a page: each says whether its
 *                                   agent is connected and when it last
 *                                   checked in, so no check-in is asked for
 *                                   on its own.
 *   GET /MobiControl/api/devices/{id}/installedApplications?skip=N&take=500
 *                                   one device's apps, on the apps' own
 *                                   clock.
 *   POST /MobiControl/api/devices/summary
 *                                   "Test" only: the devices counted by
 *                                   their Mode, to say how many a read will
 *                                   import. A question, not a change.
 *
 * A device's device group is its group. MobiControl sends nothing on its
 * own, so this is read on the connection's schedule.
 */

export const SOTI_PAGE_SIZE: number = 500;
// The most pages of the device list one read follows: 100,000 devices.
export const MAX_SOTI_DEVICE_PAGES: number = 200;
// The most pages of one device's apps read: 10,000 apps.
export const MAX_SOTI_APP_PAGES: number = 20;

export const SOTI_DEVICES_PATH: string = "/devices";
export const SOTI_DEVICE_SUMMARY_PATH: string = "/devices/summary";

/*
 * MobiControl decodes a device's ID in a path twice ("all API calls utilize
 * double encoding", its API reference says), so it is encoded twice.
 */
export function getSotiInstalledApplicationsPath(
  providerDeviceId: string,
): string {
  return `/devices/${encodeURIComponent(encodeURIComponent(providerDeviceId))}/installedApplications`;
}

// The question the device count asks: the devices, by their Mode.
export const SOTI_MODE_SUMMARY_REQUEST: Array<{
  DevicePropertyName: string;
  AggregationName: string;
  Size: number;
}> = [{ DevicePropertyName: "Mode", AggregationName: "Modes", Size: 10 }];

interface SotiList {
  items: Array<unknown>;
  // True when the pages ran out, or the read's budget did, with items left.
  isTruncated: boolean;
}

// Every page of a list MobiControl answers as a plain array, until a page is short.
async function readAllPages(data: {
  client: TenantServerClient;
  path: string;
  step: string;
  maxPages: number;
  stopWhenBudgetSpent: boolean;
}): Promise<SotiList> {
  const items: Array<unknown> = [];

  for (let page: number = 0; ; page++) {
    if (page >= data.maxPages) {
      return { items, isTruncated: true };
    }

    let answer: TenantServerAnswer;

    try {
      answer = await data.client.get(
        data.path,
        { skip: page * SOTI_PAGE_SIZE, take: SOTI_PAGE_SIZE },
        data.step,
      );
    } catch (error) {
      if (
        data.stopWhenBudgetSpent &&
        error instanceof DeviceManagementBudgetSpent
      ) {
        return { items, isTruncated: true };
      }

      throw error;
    }

    const body: unknown = answer.status === 204 ? [] : answer.body;

    if (!Array.isArray(body)) {
      throw new LlmProviderError({
        message: `MobiControl answered the ${data.step} with something that is not a list (HTTP ${answer.status}).`,
        kind: LlmConnectionFailureKind.Other,
        statusCode: answer.status,
      });
    }

    items.push(...(body as Array<unknown>));

    if (body.length < SOTI_PAGE_SIZE) {
      return { items, isTruncated: false };
    }
  }
}

/*
 * What a failed test means, for the person who set the connection up: why,
 * and what to do. The dashboard words its own sentence from the kind; this
 * is what the API answers and what an API client reads.
 */
function getTestFailureWords(
  failure: LlmProviderError,
  server: string,
): { message: string; remediation: string } {
  switch (failure.kind) {
    case LlmConnectionFailureKind.Authentication:
      return {
        message: `MobiControl at ${server} refused OneUptime's sign-in.`,
        remediation:
          "Check the API client's ID and secret, from Global Settings > Services > API Client, and the user's username and password. The user must be a MobiControl user with Web Console Access.",
      };
    case LlmConnectionFailureKind.Permission:
      return {
        message: `The MobiControl user may not read the devices at ${server}.`,
        remediation: `Give it the permissions ${SOTI_READ_PERMISSIONS}.`,
      };
    case LlmConnectionFailureKind.Settings:
      return {
        message: `OneUptime could not read MobiControl at ${server}.`,
        remediation:
          "Check the server's address: it is the address of the web console, without /MobiControl. OneUptime Cloud reads servers on the public internet only.",
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        message: "MobiControl asked OneUptime to slow down.",
        remediation: "Try again in a minute.",
      };
    default:
      return {
        message: `OneUptime could not reach MobiControl at ${server}.`,
        remediation:
          "Check the server's address. If it is right, the server may be having trouble: try again in a few minutes.",
      };
  }
}

export class SotiSession implements DeviceManagementSession {
  private readonly client: TenantServerClient;
  private readonly server: string;
  private readonly now: () => Date;

  public constructor(
    client: TenantServerClient,
    server: string,
    now: () => Date,
  ) {
    this.client = client;
    this.server = server;
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
    const list: SotiList = await readAllPages({
      client: this.client,
      path: SOTI_DEVICES_PATH,
      step: "device list request",
      maxPages: MAX_SOTI_DEVICE_PAGES,
      stopWhenBudgetSpent: true,
    });

    const listedAt: Date = this.now();
    const reads: Array<SotiDeviceRead> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of list.items) {
      const read: SotiDeviceRead | null = parseSotiDevice(item, listedAt);

      if (!read || seen.has(read.device.providerDeviceId)) {
        continue;
      }

      seen.add(read.device.providerDeviceId);
      reads.push(read);
    }

    if (list.isTruncated) {
      warnings.push(
        "The device list was cut short this time: devices missing from it were not marked removed, and the next read carries on.",
      );
    }

    const devices: Array<ProviderDevice> = reads.map(
      (read: SotiDeviceRead): ProviderDevice => {
        return read.device;
      },
    );

    return {
      enterpriseId: this.server,
      role: "",
      devices,
      isDeviceListComplete: !list.isTruncated,
      // A device's group is in its own record: its list is the device list's.
      groups: getSotiGroups(devices),
      isGroupListComplete: !list.isTruncated,
      checkIns: getSotiCheckIns(reads),
      // Every listed device says when it was last there: there is no window.
      ...(list.isTruncated ? {} : { checkInWindowEnd: listedAt }),
      warnings,
    };
  }

  // MobiControl lists the apps of every platform it manages.
  public readsAppsOf(_device: { platform: ManagedDevicePlatform }): boolean {
    return true;
  }

  public async readApps(data: {
    enterpriseId: string;
    providerDeviceId: string;
  }): Promise<Array<ProviderApp>> {
    const list: SotiList = await readAllPages({
      client: this.client,
      path: getSotiInstalledApplicationsPath(data.providerDeviceId),
      step: "app list request",
      maxPages: MAX_SOTI_APP_PAGES,
      stopWhenBudgetSpent: false,
    });

    return parseSotiApps(list.items);
  }
}

export default class SotiConnector implements DeviceManagementConnector {
  public provider: DeviceManagementProvider = DeviceManagementProvider.Soti;

  /*
   * A sign-in, the first device of the list (may the user read the
   * devices), and the devices counted by their Mode (how many a read will
   * import). Never throws: a failure is a result with status "fail".
   */
  public async testConnection(
    data: DeviceManagementSecrets & { config: DeviceManagementConfig },
    options: DeviceManagementCallOptions,
  ): Promise<DeviceManagementTestResult> {
    const startedAt: number = Date.now();
    let server: string = data.config.tenant;

    try {
      server = readSotiServer(data.config.tenant);

      if (!server) {
        throw new BadDataException(SOTI_SERVER_HELP);
      }

      readSotiClientId(data.config.clientId);
      readSotiClientSecret(data.clientSecret);
      readSotiUsername(data.config.username);
      readSotiPassword(data.password);
    } catch (error) {
      return {
        provider: DeviceManagementProvider.Soti,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        failureKind: LlmConnectionFailureKind.Settings,
        tenant: server,
        durationMs: 0,
      };
    }

    const client: TenantServerClient = createSotiClient({
      config: { ...data.config, tenant: server },
      clientSecret: data.clientSecret,
      password: data.password,
      transport: options.transport,
      now: options.now,
      sleep: options.sleep,
      random: options.random,
      // A test is a few calls: a rate-limit retry or two, then it says so.
      maxRequests: 8,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    try {
      const answer: TenantServerAnswer = await client.get(
        SOTI_DEVICES_PATH,
        { skip: 0, take: 1 },
        "device list request",
      );

      if (answer.status !== 204 && !Array.isArray(answer.body)) {
        throw new LlmProviderError({
          message: `MobiControl answered the device list request with something that is not a list (HTTP ${answer.status}).`,
          kind: LlmConnectionFailureKind.Other,
          statusCode: answer.status,
        });
      }

      let deviceCount: number | undefined = undefined;

      try {
        const summary: TenantServerAnswer = await client.postJson(
          SOTI_DEVICE_SUMMARY_PATH,
          SOTI_MODE_SUMMARY_REQUEST,
          "device summary request",
        );
        deviceCount = parseSotiManagedDeviceCount(summary.body);
      } catch {
        // The devices are readable either way; only the count is not said.
        deviceCount = undefined;
      }

      return {
        provider: DeviceManagementProvider.Soti,
        status: "pass",
        message:
          deviceCount === undefined
            ? `Connected to ${SOTI_TITLE} at ${server}.`
            : `Connected to ${SOTI_TITLE} at ${server}: ${deviceCount} ${deviceCount === 1 ? "device" : "devices"} to import.`,
        tenant: server,
        ...(deviceCount !== undefined ? { deviceCount } : {}),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error:
          error instanceof DeviceManagementBudgetSpent
            ? new LlmProviderError({
                message: "MobiControl asked OneUptime to slow down.",
                kind: LlmConnectionFailureKind.RateLimited,
              })
            : error,
        step: "test",
        providerTitle: SOTI_TITLE,
        secretValues: [data.clientSecret || "", data.password || ""].filter(
          Boolean,
        ),
      });
      const words: { message: string; remediation: string } =
        getTestFailureWords(failure, server);

      return {
        provider: DeviceManagementProvider.Soti,
        status: "fail",
        message: `${words.message} ${failure.message}`.trim(),
        remediation: words.remediation,
        failureKind: failure.kind,
        tenant: server,
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

    const client: TenantServerClient = createSotiClient({
      config: settings.config,
      clientSecret: settings.clientSecret,
      password: settings.password,
      transport: options.transport,
      now,
      sleep: options.sleep,
      random: options.random,
      maxRequests: options.maxRequests,
      deadlineMs: now().getTime() + options.maxDurationMs,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    return new SotiSession(client, settings.config.tenant, now);
  }
}
