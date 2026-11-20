import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  DeviceManagementConfig,
  WORKSPACE_ONE_SERVER_HELP,
  WorkspaceOneAuthMethod,
  readWorkspaceOneApiKey,
  readWorkspaceOneAuthMethod,
  readWorkspaceOneClientId,
  readWorkspaceOneClientSecret,
  readWorkspaceOnePassword,
  readWorkspaceOneRegion,
  readWorkspaceOneServer,
  readWorkspaceOneUsername,
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
  WORKSPACE_ONE_READ_PERMISSIONS,
  WORKSPACE_ONE_TITLE,
  createWorkspaceOneClient,
} from "./WorkspaceOneApiClient";
import {
  WorkspaceOneDeviceRead,
  WorkspaceOnePage,
  getWorkspaceOneCheckIns,
  getWorkspaceOneGroups,
  parseWorkspaceOneApps,
  parseWorkspaceOneDevice,
  readWorkspaceOnePage,
} from "./WorkspaceOneParsers";

/*
 * WORKSPACE ONE UEM, AS A DEVICE MANAGEMENT CONNECTOR (#10086).
 *
 * What a read asks the tenant's API server for, all read-only, under a
 * role whose only permissions are API > REST, Devices and Apps, Read:
 *
 *   GET /API/mdm/devices/search?page=N&pagesize=500
 *                                  every device of the organization group
 *                                  the OAuth client (or the administrator)
 *                                  is at and below, 500 a page, ordered by
 *                                  ID. Each says when it last reported
 *                                  (LastSeen), so no check-in is asked for
 *                                  on its own.
 *   GET /API/mdm/devices/{id}/apps?page=N&pagesize=500
 *                                  one device's apps, on the apps' own
 *                                  clock, and at most
 *                                  WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ
 *                                  devices a read: every request counts
 *                                  against the tenant's daily API quota.
 *
 * A device's organization group is its group. Workspace ONE sends nothing
 * on its own, so this is read on the connection's schedule.
 */

// Devices a page: the most Workspace ONE's search answers.
export const WORKSPACE_ONE_PAGE_SIZE: number = 500;
// The most pages of the device list one read follows: 100,000 devices.
export const MAX_WORKSPACE_ONE_DEVICE_PAGES: number = 200;
// The most pages of one device's apps read: 5,000 apps.
export const MAX_WORKSPACE_ONE_APP_PAGES: number = 10;
/*
 * The most devices whose apps one read reads. At the default read every
 * 15 minutes that is 2,400 app requests a day at most, beside one request
 * per 500 devices a read for the list: well under a tenant's daily quota,
 * which every other integration of the tenant shares.
 */
export const WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ: number = 25;

export const WORKSPACE_ONE_DEVICES_PATH: string = "/mdm/devices/search";

export function getWorkspaceOneDeviceAppsPath(
  providerDeviceId: string,
): string {
  return `/mdm/devices/${encodeURIComponent(providerDeviceId)}/apps`;
}

interface WorkspaceOneList {
  items: Array<unknown>;
  // True when the pages ran out, or the read's budget did, with devices left.
  isTruncated: boolean;
}

/*
 * Every page of a list, until a page is short or the list's Total is read:
 * a list that came back shorter than its first page's Total (a device left
 * while it was read) is cut short too, so no device is taken for removed.
 */
async function readAllPages(data: {
  client: TenantServerClient;
  path: string;
  key: string;
  step: string;
  maxPages: number;
  stopWhenBudgetSpent: boolean;
}): Promise<WorkspaceOneList> {
  const items: Array<unknown> = [];
  let total: number | null = null;

  for (let page: number = 0; ; page++) {
    if (page >= data.maxPages) {
      return { items, isTruncated: true };
    }

    let answer: TenantServerAnswer;

    try {
      answer = await data.client.get(
        data.path,
        { page, pagesize: WORKSPACE_ONE_PAGE_SIZE },
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

    const read: WorkspaceOnePage | null = readWorkspaceOnePage({
      status: answer.status,
      body: answer.body,
      key: data.key,
    });

    if (!read) {
      throw new LlmProviderError({
        message: `Workspace ONE answered the ${data.step} with something that is not a list (HTTP ${answer.status}).`,
        kind: LlmConnectionFailureKind.Other,
        statusCode: answer.status,
      });
    }

    if (total === null && read.total !== null) {
      total = read.total;
    }

    items.push(...read.items);

    if (
      read.items.length < WORKSPACE_ONE_PAGE_SIZE ||
      (total !== null && items.length >= total)
    ) {
      return {
        items,
        isTruncated: total !== null && items.length < total,
      };
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
  data: { server: string; authMethod: WorkspaceOneAuthMethod },
): { message: string; remediation: string } {
  const isOAuth: boolean = data.authMethod === "oauth";

  switch (failure.kind) {
    case LlmConnectionFailureKind.Authentication:
      return isOAuth
        ? {
            message: "Workspace ONE refused the OAuth client's ID or secret.",
            remediation:
              "Copy the Client ID and Client Secret again from Groups & Settings > Configurations > OAuth Client Management, and check the region: it is where the tenant's data center is.",
          }
        : {
            message:
              "Workspace ONE refused the administrator's username, password or REST API key.",
            remediation:
              "Check the username and password, and copy the REST API key again from Groups & Settings > All Settings > System > Advanced > API > REST API.",
          };
    case LlmConnectionFailureKind.Permission:
      return {
        message: `Workspace ONE does not let OneUptime read the devices at ${data.server}.`,
        remediation: `Give OneUptime's admin role the permissions ${WORKSPACE_ONE_READ_PERMISSIONS}, and make the ${isOAuth ? "OAuth client" : "administrator"} at the organization group whose devices it reads.`,
      };
    case LlmConnectionFailureKind.Settings:
      return {
        message: `OneUptime could not read Workspace ONE at ${data.server}.`,
        remediation:
          "Check the REST API URL: Groups & Settings > All Settings > System > Advanced > API > REST API shows it. OneUptime Cloud reads servers on the public internet only.",
      };
    case LlmConnectionFailureKind.RateLimited:
      return {
        message: "Workspace ONE asked OneUptime to slow down.",
        remediation:
          "Try again in a minute. If the tenant's daily API quota is used up, its usage under Groups & Settings > All Settings > System > Advanced > API > REST API says so.",
      };
    default:
      return {
        message: `OneUptime could not reach Workspace ONE at ${data.server}.`,
        remediation:
          "Check the REST API URL. If it is right, the server may be having trouble: try again in a few minutes.",
      };
  }
}

export class WorkspaceOneSession implements DeviceManagementSession {
  public readonly maxAppDevicesPerRead: number =
    WORKSPACE_ONE_MAX_APP_DEVICES_PER_READ;
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
    const list: WorkspaceOneList = await readAllPages({
      client: this.client,
      path: WORKSPACE_ONE_DEVICES_PATH,
      key: "Devices",
      step: "device list request",
      maxPages: MAX_WORKSPACE_ONE_DEVICE_PAGES,
      stopWhenBudgetSpent: true,
    });

    const listedAt: Date = this.now();
    const reads: Array<WorkspaceOneDeviceRead> = [];
    const imported: Array<unknown> = [];
    const seen: Set<string> = new Set<string>();

    for (const item of list.items) {
      const read: WorkspaceOneDeviceRead | null = parseWorkspaceOneDevice(
        item,
        listedAt,
      );

      if (!read || seen.has(read.device.providerDeviceId)) {
        continue;
      }

      seen.add(read.device.providerDeviceId);
      reads.push(read);
      imported.push(item);
    }

    if (list.isTruncated) {
      warnings.push(
        "The device list was cut short this time: devices missing from it were not marked removed, and the next read carries on.",
      );
    }

    const devices: Array<ProviderDevice> = reads.map(
      (read: WorkspaceOneDeviceRead): ProviderDevice => {
        return read.device;
      },
    );

    return {
      enterpriseId: this.server,
      role: "",
      devices,
      isDeviceListComplete: !list.isTruncated,
      // A device's organization group is in its own record: its list is the device list's.
      groups: getWorkspaceOneGroups(imported),
      isGroupListComplete: !list.isTruncated,
      checkIns: getWorkspaceOneCheckIns(reads),
      // Every listed device says when it last reported: there is no window.
      ...(list.isTruncated ? {} : { checkInWindowEnd: listedAt }),
      warnings,
    };
  }

  // Workspace ONE lists the apps of every platform it manages.
  public readsAppsOf(_device: { platform: ManagedDevicePlatform }): boolean {
    return true;
  }

  public async readApps(data: {
    enterpriseId: string;
    providerDeviceId: string;
  }): Promise<Array<ProviderApp>> {
    let list: WorkspaceOneList;

    try {
      list = await readAllPages({
        client: this.client,
        path: getWorkspaceOneDeviceAppsPath(data.providerDeviceId),
        key: "DeviceApps",
        step: "app list request",
        maxPages: MAX_WORKSPACE_ONE_APP_PAGES,
        stopWhenBudgetSpent: false,
      });
    } catch (error) {
      // "Functionality not supported for device type": a device it lists no apps of.
      if (error instanceof LlmProviderError && error.statusCode === 501) {
        return [];
      }

      throw error;
    }

    return parseWorkspaceOneApps(list.items);
  }
}

export default class WorkspaceOneConnector
  implements DeviceManagementConnector
{
  public provider: DeviceManagementProvider =
    DeviceManagementProvider.WorkspaceOne;

  /*
   * A sign-in and the first page of the device list (is OneUptime let in,
   * may it read the devices), which says how many a read will import when
   * the whole list fits on it. Never throws: a failure is a result with
   * status "fail".
   */
  public async testConnection(
    data: DeviceManagementSecrets & { config: DeviceManagementConfig },
    options: DeviceManagementCallOptions,
  ): Promise<DeviceManagementTestResult> {
    const startedAt: number = Date.now();
    let server: string = data.config.tenant;
    let authMethod: WorkspaceOneAuthMethod = "oauth";

    try {
      server = readWorkspaceOneServer(data.config.tenant);
      authMethod = readWorkspaceOneAuthMethod(data.config.authMethod);

      if (!server) {
        throw new BadDataException(WORKSPACE_ONE_SERVER_HELP);
      }

      if (authMethod === "basic") {
        readWorkspaceOneUsername(data.config.username);
        readWorkspaceOnePassword(data.password);
        readWorkspaceOneApiKey(data.apiKey);
      } else {
        readWorkspaceOneRegion(data.config.region);
        readWorkspaceOneClientId(data.config.clientId);
        readWorkspaceOneClientSecret(data.clientSecret);
      }
    } catch (error) {
      return {
        provider: DeviceManagementProvider.WorkspaceOne,
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
        failureKind: LlmConnectionFailureKind.Settings,
        tenant: server,
        durationMs: 0,
      };
    }

    const config: DeviceManagementConfig = {
      ...data.config,
      tenant: server,
      authMethod,
    };
    const client: TenantServerClient = createWorkspaceOneClient({
      config,
      clientSecret: data.clientSecret,
      password: data.password,
      apiKey: data.apiKey,
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
        WORKSPACE_ONE_DEVICES_PATH,
        { page: 0, pagesize: WORKSPACE_ONE_PAGE_SIZE },
        "device list request",
      );
      const page: WorkspaceOnePage | null = readWorkspaceOnePage({
        status: answer.status,
        body: answer.body,
        key: "Devices",
      });

      if (!page) {
        throw new LlmProviderError({
          message: `Workspace ONE answered the device list request with something that is not a list (HTTP ${answer.status}).`,
          kind: LlmConnectionFailureKind.Other,
          statusCode: answer.status,
        });
      }

      const now: Date = options.now ? options.now() : new Date();
      // Said only when the whole list is on the page: past it, enrolled ones cannot be counted.
      const isWholeList: boolean =
        page.items.length < WORKSPACE_ONE_PAGE_SIZE ||
        (page.total !== null && page.items.length >= page.total);
      const deviceCount: number | undefined = isWholeList
        ? page.items.filter((item: unknown): boolean => {
            return parseWorkspaceOneDevice(item, now) !== null;
          }).length
        : undefined;

      return {
        provider: DeviceManagementProvider.WorkspaceOne,
        status: "pass",
        message:
          deviceCount === undefined
            ? `Connected to ${WORKSPACE_ONE_TITLE} at ${server}.`
            : `Connected to ${WORKSPACE_ONE_TITLE} at ${server}: ${deviceCount} ${deviceCount === 1 ? "device" : "devices"} to import.`,
        tenant: server,
        ...(deviceCount !== undefined ? { deviceCount } : {}),
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error:
          error instanceof DeviceManagementBudgetSpent
            ? new LlmProviderError({
                message: "Workspace ONE asked OneUptime to slow down.",
                kind: LlmConnectionFailureKind.RateLimited,
              })
            : error,
        step: "test",
        providerTitle: WORKSPACE_ONE_TITLE,
        secretValues: [
          data.clientSecret || "",
          data.password || "",
          data.apiKey || "",
        ].filter(Boolean),
      });
      const words: { message: string; remediation: string } =
        getTestFailureWords(failure, { server, authMethod });

      return {
        provider: DeviceManagementProvider.WorkspaceOne,
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

    const client: TenantServerClient = createWorkspaceOneClient({
      config: settings.config,
      clientSecret: settings.clientSecret,
      password: settings.password,
      apiKey: settings.apiKey,
      transport: options.transport,
      now,
      sleep: options.sleep,
      random: options.random,
      maxRequests: options.maxRequests,
      deadlineMs: now().getTime() + options.maxDurationMs,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });

    return new WorkspaceOneSession(client, settings.config.tenant, now);
  }
}
