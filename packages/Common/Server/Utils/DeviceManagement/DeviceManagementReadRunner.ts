import DeviceManagementConnection from "../../../Models/DatabaseModels/DeviceManagementConnection";
import ManagedDevice from "../../../Models/DatabaseModels/ManagedDevice";
import ManagedDeviceApp from "../../../Models/DatabaseModels/ManagedDeviceApp";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { MANAGED_DEVICE_APPS_READ_INTERVAL_IN_HOURS } from "../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import {
  DeviceManagementReadStatus,
  DeviceManagementReadSummary,
  MAX_DEVICE_MANAGEMENT_READ_WARNINGS,
  readDeviceManagementReadSummary,
} from "../../../Types/DeviceManagement/DeviceManagementReadSummary";
import DeviceManagementProvider, {
  getDeviceManagementProviderTitle,
} from "../../../Types/DeviceManagement/DeviceManagementProvider";
import {
  ManagedDevicePlatform,
  readManagedDevicePlatform,
} from "../../../Types/DeviceManagement/ManagedDevicePlatform";
import {
  ManagedDeviceStatus,
  getManagedDeviceStatus,
} from "../../../Types/DeviceManagement/ManagedDeviceStatus";
import { JSONObject } from "../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../Types/LlmObservability/LlmConnectionTest";
import ObjectID from "../../../Types/ObjectID";
import DeviceManagementConnectionService from "../../Services/DeviceManagementConnectionService";
import ManagedDeviceAppService from "../../Services/ManagedDeviceAppService";
import ManagedDeviceService from "../../Services/ManagedDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import DataSourceHttpFetch from "../DataSource/HttpFetch";
import LlmConnectionPullRunner from "../LlmObservability/LlmConnectionPullRunner";
import LlmProviderError from "../LlmObservability/LlmProviderError";
import logger from "../Logger";
import DeviceManagementConnectorRegistry from "./DeviceManagementConnectorRegistry";
import DeviceManagementScheduler from "./DeviceManagementScheduler";
import {
  DeviceManagementBudgetSpent,
  DeviceManagementFleetRead,
  DeviceManagementPullState,
  DeviceManagementSession,
  DeviceManagementSettings,
  DeviceManagementTransport,
  ProviderApp,
  ProviderGroup,
  getDeviceManagementSecretValues,
  readDeviceManagementPullState,
} from "./DeviceManagementTypes";
import ManagedDeviceInventory, {
  ManagedDeviceInventoryOutcome,
} from "./ManagedDeviceInventory";
import ManagedDeviceCheckInMetrics, {
  ManagedDeviceCheckInOutcome,
  ManagedDeviceCheckInRecordInput,
} from "./ManagedDeviceCheckInMetrics";
import {
  ManagedDeviceAppSyncPlan,
  ManagedDeviceSyncPlan,
  StoredManagedDevice,
  planManagedDeviceAppSync,
  planManagedDeviceSync,
  toStoredManagedDevice,
  toStoredManagedDeviceApp,
} from "./ManagedDeviceSync";

/*
 * ONE READ OF ONE DEVICE MANAGEMENT CONNECTION.
 *
 * The worker runs it for every connection that is due (Workers job
 * DeviceManagementConnection:Read); "Read now" queues it at once. A read:
 *
 *   1. holds to the project's plan: a reseller plan without telemetry
 *      features reads nothing, and nor does an installation that turned
 *      telemetry ingestion off;
 *   2. reads the fleet through the SSRF-guarded fetch: who the key is, the
 *      devices, their groups, and the check-ins since the last window -
 *      then, one by one and while its budget lasts, the check-in of a
 *      device no window had (once a day at most per device);
 *   3. writes what changed (ManagedDeviceSync): new devices, changed ones,
 *      devices that left the list (marked removed, never from a list cut
 *      short), devices back on it, and devices gone 30 days (deleted, after
 *      their hosts are let go);
 *   4. reads the installed apps of the devices that are due - every
 *      MANAGED_DEVICE_APPS_READ_INTERVAL_IN_HOURS, oldest first, at most
 *      MAX_APP_DEVICES_PER_READ a read (fewer for a service whose API has a
 *      daily quota: maxAppDevicesPerRead) and while the budget lasts - and
 *      writes what changed on each;
 *   5. gives each device its host in Inventory (ManagedDeviceInventory):
 *      one host per device, shared with its apps' or agent's telemetry. A
 *      failure there is a warning on the read, never its failure;
 *   6. writes how long since each device checked in, as a metric a monitor
 *      alerts on per device (ManagedDeviceCheckInMetrics, #9835) - only
 *      when it read every check-in up to its end, so no age is too old. A
 *      failure there is a warning too;
 *   7. records the outcome on the connection: when it read, what it found,
 *      the error with the key removed, where the check-ins got to and when
 *      it reads next.
 *
 * A failure never escapes as anything but a recorded outcome, and the
 * bookkeeping write is itself guarded, so one tenant's trouble never stops
 * the others.
 */

// One read stops after this many API calls, or this long.
export const DEVICE_MANAGEMENT_READ_MAX_REQUESTS: number = 1500;
export const DEVICE_MANAGEMENT_READ_MAX_DURATION_MS: number = 6 * 60 * 1000;
// The most devices whose apps one read reads (one request each, at least).
export const MAX_APP_DEVICES_PER_READ: number = 300;
// The most devices one read asks about one by one for their check-in.
export const MAX_CHECK_IN_LOOKUPS_PER_READ: number = 50;
// A device no window had is asked about on its own again this long after.
export const CHECK_IN_LOOKUP_INTERVAL_MS: number = 24 * 60 * 60 * 1000;
/*
 * How far back the first read's check-in window reaches, and the most any
 * window does: a device that has not checked in for longer is asked about
 * on its own.
 */
export const CHECK_IN_WINDOW_MAX_MS: number = 30 * 24 * 60 * 60 * 1000;
// Each window starts this long before the last one ended, so none is missed.
export const CHECK_IN_WINDOW_OVERLAP_MS: number = 5 * 60 * 1000;
// After a failure the next read waits at least this long.
const RETRY_AFTER_FAILURE_MS: number = 15 * 60 * 1000;
// After a refused key, the next read waits this long.
const RETRY_AFTER_REFUSED_KEY_MS: number = 60 * 60 * 1000;
// A read that stopped part way carries on this soon.
const CONTINUE_AFTER_MS: number = 60 * 1000;
// A read that was rate limited carries on no sooner than this.
const CONTINUE_AFTER_RATE_LIMIT_MS: number = 5 * 60 * 1000;
// A plan or installation without telemetry is asked again a day later.
const RETRY_AFTER_PLAN_MS: number = 24 * 60 * 60 * 1000;
// Devices read from the database per page.
const DEVICE_PAGE_SIZE: number = 1000;

export const INVENTORY_NOT_RECORDED_WARNING: string =
  "The devices' hosts in Inventory could not be updated this time: the next read tries again.";
export const APPS_NOT_READ_WARNING: string =
  "Some devices' apps could not be read this time: the next read tries again.";
export const CHECK_INS_NOT_RECORDED_WARNING: string =
  "How long since each device checked in could not be recorded this time, so its alerts have nothing new to read: the next read tries again.";

export interface DeviceManagementReadDependencies {
  transport?: DeviceManagementTransport | undefined;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
  // Test seam for whether the project may read telemetry.
  isTelemetryAllowed?: ((projectId: ObjectID) => Promise<boolean>) | undefined;
  // Test seam for the hosts in Inventory.
  recordInventory?:
    | ((data: {
        projectId: ObjectID;
        connectionId: ObjectID;
        provider: DeviceManagementProvider;
        now: Date;
      }) => Promise<ManagedDeviceInventoryOutcome>)
    | undefined;
  // Test seam for the devices' check-in readings.
  recordCheckIns?:
    | ((
        data: ManagedDeviceCheckInRecordInput,
      ) => Promise<ManagedDeviceCheckInOutcome>)
    | undefined;
}

// What a read's apps came to.
interface AppsReadOutcome {
  // Devices whose apps were read and written.
  read: number;
  // Devices whose apps are due but were not read this time.
  waiting: number;
  // Whether a device's apps could not be read or written.
  failed: boolean;
  /*
   * Whether the devices that wait may be read soon: false when the
   * service's own cap or a refusal held them, which a minute does not change.
   */
  mayCarryOn: boolean;
}

export interface DeviceManagementReadOutcome {
  status: DeviceManagementReadStatus | "skipped";
  summary?: DeviceManagementReadSummary | undefined;
  error?: string | undefined;
}

/*
 * Where a read's check-in window starts: where the last one ended (less an
 * overlap, so a check-in on the edge is not missed), never further back
 * than CHECK_IN_WINDOW_MAX_MS. Pure.
 */
export function getCheckInWindowStart(data: {
  state: DeviceManagementPullState;
  now: Date;
}): Date {
  const earliest: number = data.now.getTime() - CHECK_IN_WINDOW_MAX_MS;
  const cursor: number = data.state.checkInCursor
    ? Date.parse(data.state.checkInCursor)
    : NaN;

  if (!Number.isFinite(cursor)) {
    return new Date(earliest);
  }

  return new Date(
    Math.max(
      earliest,
      Math.min(cursor, data.now.getTime()) - CHECK_IN_WINDOW_OVERLAP_MS,
    ),
  );
}

/*
 * The devices whose check-in to ask about one by one: listed now, with no
 * check-in known (stored or in this read's window), and not asked about
 * within CHECK_IN_LOOKUP_INTERVAL_MS - at most MAX_CHECK_IN_LOOKUPS_PER_READ,
 * the ones asked longest ago (or never) first. Pure.
 */
export function getCheckInLookups(data: {
  listedDeviceIds: Array<string>;
  knownCheckIns: ReadonlySet<string>;
  lookups: Record<string, string>;
  now: Date;
}): Array<string> {
  const due: Array<{ id: string; askedAt: number }> = [];

  for (const id of data.listedDeviceIds) {
    if (data.knownCheckIns.has(id)) {
      continue;
    }

    const askedAt: number = data.lookups[id]
      ? Date.parse(data.lookups[id]!)
      : NaN;

    if (
      Number.isFinite(askedAt) &&
      data.now.getTime() - askedAt < CHECK_IN_LOOKUP_INTERVAL_MS
    ) {
      continue;
    }

    due.push({ id, askedAt: Number.isFinite(askedAt) ? askedAt : 0 });
  }

  return due
    .sort((left: { askedAt: number }, right: { askedAt: number }): number => {
      return left.askedAt - right.askedAt;
    })
    .slice(0, MAX_CHECK_IN_LOOKUPS_PER_READ)
    .map((entry: { id: string }): string => {
      return entry.id;
    });
}

/*
 * The devices whose apps are due: enrolled, never read or read
 * MANAGED_DEVICE_APPS_READ_INTERVAL_IN_HOURS ago, the longest ago first.
 * Pure.
 */
export function getAppsDueDevices<
  T extends { id: string; appsReadAt: Date | null; isRemoved: boolean },
>(devices: Array<T>, now: Date): Array<T> {
  const intervalMs: number =
    MANAGED_DEVICE_APPS_READ_INTERVAL_IN_HOURS * 60 * 60 * 1000;

  return devices
    .filter((device: T): boolean => {
      return (
        !device.isRemoved &&
        (!device.appsReadAt ||
          now.getTime() - device.appsReadAt.getTime() >= intervalMs)
      );
    })
    .sort((left: T, right: T): number => {
      return (
        (left.appsReadAt ? left.appsReadAt.getTime() : 0) -
        (right.appsReadAt ? right.appsReadAt.getTime() : 0)
      );
    });
}

export default class DeviceManagementReadRunner {
  // When a connection that just read is read next.
  public static nextPullAt(data: {
    now: Date;
    intervalInMinutes: number;
    outcome: DeviceManagementReadStatus;
    failureKind?: LlmConnectionFailureKind | undefined;
    wasRateLimited?: boolean | undefined;
  }): Date {
    const interval: number = Math.max(1, data.intervalInMinutes) * 60 * 1000;

    if (data.outcome === "partial") {
      return new Date(
        data.now.getTime() +
          Math.min(
            interval,
            data.wasRateLimited
              ? CONTINUE_AFTER_RATE_LIMIT_MS
              : CONTINUE_AFTER_MS,
          ),
      );
    }

    if (data.outcome === "failed") {
      const wait: number =
        data.failureKind === LlmConnectionFailureKind.Authentication ||
        data.failureKind === LlmConnectionFailureKind.Permission
          ? RETRY_AFTER_REFUSED_KEY_MS
          : Math.max(interval, RETRY_AFTER_FAILURE_MS);

      return new Date(data.now.getTime() + wait);
    }

    return new Date(data.now.getTime() + interval);
  }

  public static async run(
    connectionId: ObjectID,
    dependencies: DeviceManagementReadDependencies = {},
  ): Promise<DeviceManagementReadOutcome> {
    const clock: () => Date =
      dependencies.now ||
      ((): Date => {
        return new Date();
      });
    const now: Date = clock();
    const startedAt: number = Date.now();

    const connection: DeviceManagementConnection | null =
      await DeviceManagementConnectionService.findOneById({
        id: connectionId,
        select: {
          _id: true,
          projectId: true,
          name: true,
          provider: true,
          config: true,
          secrets: true,
          isEnabled: true,
          pullState: true,
          lastPullResult: true,
        },
        props: { isRoot: true },
      });

    if (!connection || !connection.projectId || !connection.isEnabled) {
      return { status: "skipped" };
    }

    const projectId: ObjectID = connection.projectId;
    const interval: number = DeviceManagementScheduler.intervalOf(connection);
    const previous: DeviceManagementReadSummary | undefined =
      readDeviceManagementReadSummary(connection.lastPullResult);
    const providerTitle: string = getDeviceManagementProviderTitle(
      connection.provider,
    );

    const isAllowed: (projectId: ObjectID) => Promise<boolean> =
      dependencies.isTelemetryAllowed ||
      ((id: ObjectID): Promise<boolean> => {
        return LlmConnectionPullRunner.isTelemetryAllowed(id);
      });

    if (!(await isAllowed(projectId))) {
      const message: string =
        "Importing devices is not part of this project's plan, or telemetry ingestion is turned off.";

      await DeviceManagementReadRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: message,
        nextPullAt: new Date(now.getTime() + RETRY_AFTER_PLAN_MS),
      });

      return { status: "skipped", error: message };
    }

    let settings: DeviceManagementSettings | null = null;

    try {
      settings =
        await DeviceManagementConnectionService.getDeviceManagementSettings(
          connection,
        );

      const session: DeviceManagementSession =
        DeviceManagementConnectorRegistry.getConnector(
          settings.provider,
        ).openSession(settings, {
          transport:
            dependencies.transport ||
            DataSourceHttpFetch.fetch.bind(DataSourceHttpFetch),
          now: clock,
          sleep: dependencies.sleep,
          random: dependencies.random,
          maxRequests: DEVICE_MANAGEMENT_READ_MAX_REQUESTS,
          maxDurationMs: DEVICE_MANAGEMENT_READ_MAX_DURATION_MS,
        });

      const state: DeviceManagementPullState = readDeviceManagementPullState(
        connection.pullState,
      );

      const fleet: DeviceManagementFleetRead = await session.readFleet({
        checkInSince: getCheckInWindowStart({ state, now }),
      });

      const warnings: Array<string> = [...fleet.warnings];
      const stored: Array<ManagedDevice> =
        await DeviceManagementReadRunner.loadDevices({
          projectId,
          connectionId: connection.id!,
        });
      const storedDevices: Array<StoredManagedDevice> = stored.map(
        (row: ManagedDevice): StoredManagedDevice => {
          return toStoredManagedDevice(row);
        },
      );

      // The newest check-in known per device: stored, then this read's.
      const checkIns: Map<string, Date> = new Map<string, Date>();

      for (const checkIn of fleet.checkIns) {
        checkIns.set(checkIn.providerDeviceId, checkIn.lastCheckInAt);
      }

      const knownCheckIns: Set<string> = new Set<string>(checkIns.keys());

      for (const device of storedDevices) {
        if (device.lastCheckInAt) {
          knownCheckIns.add(device.providerDeviceId);
        }
      }

      // A device no window had: asked about on its own, a few a read.
      const lookups: Record<string, string> = {};
      const listedIds: Array<string> = fleet.devices.map(
        (device: { providerDeviceId: string }): string => {
          return device.providerDeviceId;
        },
      );

      for (const id of listedIds) {
        if (state.checkInLookups?.[id]) {
          lookups[id] = state.checkInLookups[id]!;
        }
      }

      let isPartial: boolean = !fleet.isDeviceListComplete;

      /*
       * Only for a service that answers one device's check-in on its own:
       * another one's device list said every check-in it knows.
       */
      const readCheckIn: ((id: string) => Promise<Date | null>) | undefined =
        session.readCheckIn ? session.readCheckIn.bind(session) : undefined;

      for (const id of readCheckIn
        ? getCheckInLookups({
            listedDeviceIds: listedIds,
            knownCheckIns,
            lookups,
            now,
          })
        : []) {
        if (!session.hasBudgetFor(1)) {
          isPartial = true;
          break;
        }

        try {
          const lastCheckIn: Date | null = await readCheckIn!(id);
          lookups[id] = now.toISOString();

          if (lastCheckIn) {
            checkIns.set(id, lastCheckIn);
          }
        } catch (error) {
          if (error instanceof DeviceManagementBudgetSpent) {
            isPartial = true;
            break;
          }

          throw error;
        }
      }

      const groups: Map<string, ProviderGroup> = new Map<
        string,
        ProviderGroup
      >();

      for (const group of fleet.groups) {
        groups.set(group.id, group);
      }

      const plan: ManagedDeviceSyncPlan = planManagedDeviceSync({
        stored: storedDevices,
        devices: fleet.devices,
        groups,
        isGroupListComplete: fleet.isGroupListComplete,
        isDeviceListComplete: fleet.isDeviceListComplete,
        checkIns,
        now,
      });

      await DeviceManagementReadRunner.applyDevicePlan({
        projectId,
        connectionId: connection.id!,
        plan,
        stored,
        now,
      });

      // The installed apps of the devices that are due.
      const apps: AppsReadOutcome = await DeviceManagementReadRunner.readApps({
        projectId,
        connectionId: connection.id!,
        session,
        enterpriseId: fleet.enterpriseId,
        now,
      });

      if (apps.failed) {
        warnings.push(APPS_NOT_READ_WARNING);
      }

      /*
       * Devices whose apps wait carry the read on soon, unless what held
       * them will not be different in a minute: the service's own cap (a
       * daily quota) or a refusal, which the next scheduled read meets.
       */
      if (apps.waiting > 0 && apps.mayCarryOn) {
        isPartial = true;
      }

      if (!fleet.checkInWindowEnd) {
        isPartial = true;
      }

      // Each device's host in Inventory.
      let inventory: ManagedDeviceInventoryOutcome | undefined = undefined;

      try {
        inventory = await (
          dependencies.recordInventory ||
          ((data: {
            projectId: ObjectID;
            connectionId: ObjectID;
            provider: DeviceManagementProvider;
            now: Date;
          }): Promise<ManagedDeviceInventoryOutcome> => {
            return ManagedDeviceInventory.record(data);
          })
        )({
          projectId,
          connectionId: connection.id!,
          provider: settings.provider,
          now,
        });
      } catch (error) {
        logger.error(
          `Device management connection ${connection.id!.toString()}: its devices' hosts in Inventory could not be updated: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        warnings.push(INVENTORY_NOT_RECORDED_WARNING);
      }

      /*
       * How long since each device checked in, as a metric a monitor reads
       * (#9835): only after a read that read the whole device list and
       * every check-in up to its end, at that end, when every device's last
       * check-in is known. A read cut short says nothing rather than an age
       * too old - a device a list cut short left out keeps the check-in of
       * an older read - and the readings before it are still in the
       * monitor's window.
       */
      if (fleet.isDeviceListComplete && fleet.checkInWindowEnd) {
        try {
          await (
            dependencies.recordCheckIns ||
            ((
              data: ManagedDeviceCheckInRecordInput,
            ): Promise<ManagedDeviceCheckInOutcome> => {
              return ManagedDeviceCheckInMetrics.record(data);
            })
          )({
            projectId,
            connectionId: connection.id!,
            provider: settings.provider,
            asOf: fleet.checkInWindowEnd,
          });
        } catch (error) {
          logger.error(
            `Device management connection ${connection.id!.toString()}: its devices' check-ins could not be recorded: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          warnings.push(CHECK_INS_NOT_RECORDED_WARNING);
        }
      }

      // Online and offline, as the devices stand after this read.
      let onlineCount: number = 0;
      let offlineCount: number = 0;
      const storedCheckIns: Map<string, Date> = new Map<string, Date>();

      for (const device of storedDevices) {
        if (device.lastCheckInAt) {
          storedCheckIns.set(device.providerDeviceId, device.lastCheckInAt);
        }
      }

      for (const device of fleet.devices) {
        const read: Date | undefined = checkIns.get(device.providerDeviceId);
        const known: Date | undefined = storedCheckIns.get(
          device.providerDeviceId,
        );
        const status: ManagedDeviceStatus = getManagedDeviceStatus({
          providerState: device.state,
          lastCheckInAt:
            read && known
              ? new Date(Math.max(read.getTime(), known.getTime()))
              : read || known || null,
          provider: settings.provider,
          platform: device.platform,
          now,
        });

        if (status === ManagedDeviceStatus.Online) {
          onlineCount++;
        } else if (status === ManagedDeviceStatus.Offline) {
          offlineCount++;
        }
      }

      const status: DeviceManagementReadStatus = isPartial
        ? "partial"
        : "success";

      const summary: DeviceManagementReadSummary = {
        status,
        tenant: settings.config.tenant,
        ...(fleet.role ? { role: fleet.role } : {}),
        deviceCount: fleet.devices.length,
        onlineCount,
        offlineCount,
        addedCount: plan.creates.length,
        changedCount: plan.updates.filter(
          (update: { isCounted: boolean }): boolean => {
            return update.isCounted;
          },
        ).length,
        removedCount: plan.removals.length,
        groupCount: fleet.groups.length,
        matchedHostCount: inventory
          ? inventory.matchedHostCount
          : previous?.matchedHostCount || 0,
        appsReadDeviceCount: apps.read,
        appsWaitingDeviceCount: apps.waiting,
        isDeviceListComplete: fleet.isDeviceListComplete,
        requestCount: session.getRequestCount(),
        wasRateLimited: session.wasRateLimited(),
        warnings: warnings.slice(0, MAX_DEVICE_MANAGEMENT_READ_WARNINGS),
        durationMs: Date.now() - startedAt,
        finishedAt: clock().toISOString(),
      };

      const nextState: DeviceManagementPullState = {
        ...(fleet.checkInWindowEnd
          ? { checkInCursor: fleet.checkInWindowEnd.toISOString() }
          : state.checkInCursor
            ? { checkInCursor: state.checkInCursor }
            : {}),
        ...(Object.keys(lookups).length > 0 ? { checkInLookups: lookups } : {}),
      };

      await DeviceManagementReadRunner.record(connection.id!, {
        lastPulledAt: now,
        lastSuccessfulPullAt: now,
        lastError: null,
        lastPullResult: summary as unknown as JSONObject,
        pullState: nextState as unknown as JSONObject,
        nextPullAt: DeviceManagementReadRunner.nextPullAt({
          now,
          intervalInMinutes: interval,
          outcome: status,
          wasRateLimited: summary.wasRateLimited,
        }),
      });

      return { status, summary };
    } catch (error) {
      const failure: LlmProviderError = LlmProviderError.from({
        error:
          error instanceof DeviceManagementBudgetSpent
            ? new LlmProviderError({
                message: `${providerTitle} took longer to read than one read may take.`,
                kind: LlmConnectionFailureKind.Unavailable,
              })
            : error,
        step: "read",
        providerTitle: providerTitle,
        secretValues: settings ? getDeviceManagementSecretValues(settings) : [],
      });

      const summary: DeviceManagementReadSummary = {
        status: "failed",
        tenant: previous?.tenant || settings?.config.tenant || "",
        ...(previous?.role ? { role: previous.role } : {}),
        deviceCount: previous?.deviceCount || 0,
        onlineCount: previous?.onlineCount || 0,
        offlineCount: previous?.offlineCount || 0,
        addedCount: 0,
        changedCount: 0,
        removedCount: 0,
        groupCount: previous?.groupCount || 0,
        matchedHostCount: previous?.matchedHostCount || 0,
        appsReadDeviceCount: 0,
        appsWaitingDeviceCount: previous?.appsWaitingDeviceCount || 0,
        isDeviceListComplete: false,
        requestCount: 0,
        wasRateLimited: failure.kind === LlmConnectionFailureKind.RateLimited,
        warnings: [],
        failureKind: failure.kind,
        durationMs: Date.now() - startedAt,
        finishedAt: clock().toISOString(),
      };

      await DeviceManagementReadRunner.record(connection.id!, {
        lastPulledAt: now,
        lastError: failure.message,
        lastPullResult: summary as unknown as JSONObject,
        nextPullAt: DeviceManagementReadRunner.nextPullAt({
          now,
          intervalInMinutes: interval,
          outcome: "failed",
          failureKind: failure.kind,
        }),
      });

      return { status: "failed", summary, error: failure.message };
    }
  }

  // Every device of a connection, removed ones too, in pages.
  private static async loadDevices(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
  }): Promise<Array<ManagedDevice>> {
    const devices: Array<ManagedDevice> = [];
    let skip: number = 0;

    for (;;) {
      const page: Array<ManagedDevice> = await ManagedDeviceService.findBy({
        query: { projectId: data.projectId, connectionId: data.connectionId },
        select: {
          _id: true,
          projectId: true,
          connectionId: true,
          providerDeviceId: true,
          platform: true,
          deviceName: true,
          alias: true,
          serialNumber: true,
          imei: true,
          manufacturer: true,
          brand: true,
          model: true,
          osVersion: true,
          buildNumber: true,
          securityPatchLevel: true,
          agentVersion: true,
          providerState: true,
          lastCheckInAt: true,
          groupId: true,
          groupName: true,
          groupPath: true,
          isKioskMode: true,
          batteryLevel: true,
          ipAddresses: true,
          macAddress: true,
          details: true,
          provisionedAt: true,
          removedAt: true,
          appsReadAt: true,
          inventoryItemId: true,
          inventoryMatch: true,
          inventoryAttributes: true,
          isInventoryItemArchivedOnRemoval: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip: skip,
        limit: DEVICE_PAGE_SIZE,
        props: { isRoot: true },
      });

      devices.push(...page);

      if (page.length < DEVICE_PAGE_SIZE) {
        break;
      }

      skip += DEVICE_PAGE_SIZE;
    }

    return devices;
  }

  // Writes a device plan: creates, updates, removals and purges.
  private static async applyDevicePlan(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    plan: ManagedDeviceSyncPlan;
    stored: Array<ManagedDevice>;
    now: Date;
  }): Promise<void> {
    for (const create of data.plan.creates) {
      const device: ManagedDevice = new ManagedDevice();
      device.projectId = data.projectId;
      device.connectionId = data.connectionId;
      device.providerDeviceId = create.providerDeviceId;
      DeviceManagementReadRunner.assignFields(
        device,
        create.fields as unknown as Record<string, unknown>,
      );

      if (create.lastCheckInAt) {
        device.lastCheckInAt = create.lastCheckInAt;
      }

      await ManagedDeviceService.create({
        data: device,
        props: { isRoot: true },
      });
    }

    for (const update of data.plan.updates) {
      await ManagedDeviceService.updateOneById({
        id: new ObjectID(update.id),
        data: DeviceManagementReadRunner.toColumns(update.changes) as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    if (data.plan.removals.length > 0) {
      await ManagedDeviceService.updateBy({
        query: {
          projectId: data.projectId,
          connectionId: data.connectionId,
          _id: QueryHelper.any(data.plan.removals),
        },
        data: { removedAt: data.now },
        limit: data.plan.removals.length,
        skip: 0,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    if (data.plan.purges.length > 0) {
      const purged: Set<string> = new Set<string>(data.plan.purges);

      // Their hosts are let go first: once the rows go, nothing says which.
      await ManagedDeviceInventory.releaseDevices(
        data.stored.filter((device: ManagedDevice): boolean => {
          return purged.has(device._id!.toString());
        }),
      );

      await ManagedDeviceService.hardDeleteBy({
        query: {
          projectId: data.projectId,
          connectionId: data.connectionId,
          _id: QueryHelper.any(data.plan.purges),
        },
        limit: data.plan.purges.length,
        skip: 0,
        props: { isRoot: true },
      });
    }
  }

  // A device's columns, as the model takes them (empty text as null).
  private static toColumns(changes: Record<string, unknown>): JSONObject {
    const columns: JSONObject = {};

    for (const [key, value] of Object.entries(changes)) {
      columns[key] = (value === "" ? null : value) as JSONObject[string];
    }

    return columns;
  }

  private static assignFields(
    device: ManagedDevice,
    fields: Record<string, unknown>,
  ): void {
    const columns: JSONObject = DeviceManagementReadRunner.toColumns(fields);

    for (const [key, value] of Object.entries(columns)) {
      if (value !== null && value !== undefined) {
        (device as unknown as JSONObject)[key] = value;
      }
    }
  }

  /*
   * The installed apps of the devices that are due, while the budget
   * lasts, and at most as many devices as the read reads apps of
   * (MAX_APP_DEVICES_PER_READ, or the service's own, lower cap). A device
   * whose apps cannot be read is tried again next read; a refused key, a
   * permission the key lacks or a rate limit ends the apps for this read.
   */
  private static async readApps(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    session: DeviceManagementSession;
    enterpriseId: string;
    now: Date;
  }): Promise<AppsReadOutcome> {
    const devices: Array<ManagedDevice> = await ManagedDeviceService.findBy({
      query: {
        projectId: data.projectId,
        connectionId: data.connectionId,
        removedAt: QueryHelper.isNull(),
      },
      select: {
        _id: true,
        providerDeviceId: true,
        appsReadAt: true,
        platform: true,
      },
      skip: 0,
      limit: 100000,
      props: { isRoot: true },
    });

    const due: Array<{
      id: string;
      providerDeviceId: string;
      appsReadAt: Date | null;
      isRemoved: boolean;
    }> = getAppsDueDevices(
      devices
        // A device whose apps its service does not list is never due.
        .filter((device: ManagedDevice): boolean => {
          const platform: ManagedDevicePlatform = readManagedDevicePlatform(
            device.platform,
          );

          return data.session.readsAppsOf({ platform });
        })
        .map(
          (
            device: ManagedDevice,
          ): {
            id: string;
            providerDeviceId: string;
            appsReadAt: Date | null;
            isRemoved: boolean;
          } => {
            return {
              id: device._id!.toString(),
              providerDeviceId: device.providerDeviceId || "",
              appsReadAt: device.appsReadAt
                ? new Date(device.appsReadAt)
                : null,
              isRemoved: false,
            };
          },
        ),
      data.now,
    );

    const serviceCap: number | undefined = data.session.maxAppDevicesPerRead;
    const limit: number = Math.min(
      MAX_APP_DEVICES_PER_READ,
      serviceCap !== undefined && serviceCap >= 0
        ? serviceCap
        : MAX_APP_DEVICES_PER_READ,
    );
    let read: number = 0;
    let attempted: number = 0;
    let failed: boolean = false;
    let mayCarryOn: boolean = true;

    for (const device of due) {
      if (attempted >= limit) {
        // The service's own cap waits for the next scheduled read.
        mayCarryOn = serviceCap === undefined;
        break;
      }

      if (!data.session.hasBudgetFor(2)) {
        break;
      }

      attempted++;

      let apps: Array<ProviderApp>;

      try {
        apps = await data.session.readApps({
          enterpriseId: data.enterpriseId,
          providerDeviceId: device.providerDeviceId,
        });
      } catch (error) {
        if (error instanceof DeviceManagementBudgetSpent) {
          break;
        }

        failed = true;

        if (
          error instanceof LlmProviderError &&
          (error.kind === LlmConnectionFailureKind.Authentication ||
            error.kind === LlmConnectionFailureKind.Permission ||
            error.kind === LlmConnectionFailureKind.RateLimited)
        ) {
          // A rate limit is carried on after its wait; a refusal is the next scheduled read's.
          mayCarryOn = error.kind === LlmConnectionFailureKind.RateLimited;
          break;
        }

        logger.debug(
          `Managed device ${device.id}: its apps could not be read: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }

      try {
        await DeviceManagementReadRunner.writeApps({
          projectId: data.projectId,
          connectionId: data.connectionId,
          deviceId: new ObjectID(device.id),
          apps,
          now: data.now,
        });
        read++;
      } catch (error) {
        failed = true;
        logger.error(
          `Managed device ${device.id}: its apps could not be recorded: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return {
      read,
      waiting: Math.max(0, due.length - read),
      failed,
      mayCarryOn,
    };
  }

  // One device's apps: what changed written, and when they were read.
  private static async writeApps(data: {
    projectId: ObjectID;
    connectionId: ObjectID;
    deviceId: ObjectID;
    apps: Array<ProviderApp>;
    now: Date;
  }): Promise<void> {
    const stored: Array<ManagedDeviceApp> =
      await ManagedDeviceAppService.findBy({
        query: { managedDeviceId: data.deviceId },
        select: {
          _id: true,
          packageName: true,
          appName: true,
          versionName: true,
          versionCode: true,
          state: true,
          isKioskApp: true,
          isManagedByService: true,
        },
        skip: 0,
        limit: 10000,
        props: { isRoot: true },
      });

    const plan: ManagedDeviceAppSyncPlan = planManagedDeviceAppSync({
      stored: stored.map(toStoredManagedDeviceApp),
      apps: data.apps,
    });

    for (const app of plan.creates) {
      const row: ManagedDeviceApp = new ManagedDeviceApp();
      row.projectId = data.projectId;
      row.connectionId = data.connectionId;
      row.managedDeviceId = data.deviceId;
      DeviceManagementReadRunner.assignApp(row, app);

      await ManagedDeviceAppService.create({
        data: row,
        props: { isRoot: true },
      });
    }

    for (const update of plan.updates) {
      await ManagedDeviceAppService.updateOneById({
        id: new ObjectID(update.id),
        data: {
          appName: update.app.appName || null,
          versionName: update.app.versionName || null,
          versionCode: update.app.versionCode || null,
          state: update.app.state || null,
          isKioskApp: update.app.isKioskApp,
          isManagedByService: update.app.isManagedByService,
        } as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    if (plan.deletes.length > 0) {
      await ManagedDeviceAppService.hardDeleteBy({
        query: {
          managedDeviceId: data.deviceId,
          _id: QueryHelper.any(plan.deletes),
        },
        limit: plan.deletes.length,
        skip: 0,
        props: { isRoot: true },
      });
    }

    await ManagedDeviceService.updateOneById({
      id: data.deviceId,
      data: { appsReadAt: data.now, appCount: data.apps.length },
      props: { isRoot: true, ignoreHooks: true },
    });
  }

  private static assignApp(row: ManagedDeviceApp, app: ProviderApp): void {
    row.packageName = app.packageName;

    if (app.appName) {
      row.appName = app.appName;
    }

    if (app.versionName) {
      row.versionName = app.versionName;
    }

    if (app.versionCode) {
      row.versionCode = app.versionCode;
    }

    if (app.state) {
      row.state = app.state;
    }

    row.isKioskApp = app.isKioskApp;
    row.isManagedByService = app.isManagedByService;
  }

  // The bookkeeping write: guarded, so a failure to record never escapes.
  private static async record(
    connectionId: ObjectID,
    data: {
      lastPulledAt?: Date | undefined;
      lastSuccessfulPullAt?: Date | undefined;
      lastError?: string | null | undefined;
      lastPullResult?: JSONObject | undefined;
      pullState?: JSONObject | undefined;
      nextPullAt?: Date | undefined;
    },
  ): Promise<void> {
    try {
      await DeviceManagementConnectionService.updateOneById({
        id: connectionId,
        // JSON columns make the typed partial too deep for TypeScript.
        data: data as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    } catch (error) {
      logger.error(
        `Device management connection ${connectionId.toString()}: the read's outcome could not be recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
