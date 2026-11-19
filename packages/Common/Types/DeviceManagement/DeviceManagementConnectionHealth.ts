import { DeviceManagementReadStatus } from "./DeviceManagementReadSummary";

/*
 * How a device management connection is doing, in one word, decided the
 * same way wherever it is shown: the connection's row on Inventory >
 * Managed Devices and the summary the API answers.
 *
 * A failure is never quiet. A read that failed says so until a read works;
 * a connection whose reads stopped - the Workers are down, or reads keep
 * being cut short - goes stale after three of its intervals, so devices
 * that stopped being refreshed are never mistaken for a quiet fleet.
 */

export enum DeviceManagementConnectionStatus {
  // Turned off: not read on its schedule.
  Off = "off",
  // Saved, and waiting for its first read.
  Waiting = "waiting",
  // The last read worked.
  Healthy = "healthy",
  // The last read worked in part: some devices' apps or check-ins wait for the next.
  Partial = "partial",
  // The last read failed.
  Failing = "failing",
  // No read has worked for longer than three of its intervals.
  Stale = "stale",
}

export interface DeviceManagementConnectionHealthInput {
  isEnabled?: boolean | undefined;
  createdAt?: Date | string | undefined;
  lastPulledAt?: Date | string | undefined;
  lastSuccessfulPullAt?: Date | string | undefined;
  lastError?: string | undefined;
  lastReadStatus?: DeviceManagementReadStatus | undefined;
  readIntervalInMinutes: number;
}

export interface DeviceManagementConnectionHealth {
  status: DeviceManagementConnectionStatus;
  /*
   * Since when the status holds, where that says something: when the last
   * read worked (healthy, stale), when the failing read ran.
   */
  since?: Date | undefined;
}

// A connection goes stale this long after its last read that worked.
export function getDeviceManagementStaleAfterMinutes(
  readIntervalInMinutes: number,
): number {
  const interval: number =
    Number.isFinite(readIntervalInMinutes) && readIntervalInMinutes > 0
      ? readIntervalInMinutes
      : 15;

  return Math.max(30, interval * 3 + 10);
}

function toDate(value: Date | string | undefined): Date | undefined {
  if (!value) {
    return undefined;
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function getDeviceManagementConnectionHealth(
  input: DeviceManagementConnectionHealthInput,
  now: Date,
): DeviceManagementConnectionHealth {
  if (input.isEnabled === false) {
    return { status: DeviceManagementConnectionStatus.Off };
  }

  const lastPulledAt: Date | undefined = toDate(input.lastPulledAt);
  const lastSuccessfulPullAt: Date | undefined = toDate(
    input.lastSuccessfulPullAt,
  );
  const createdAt: Date | undefined = toDate(input.createdAt);
  const staleAfterMs: number =
    getDeviceManagementStaleAfterMinutes(input.readIntervalInMinutes) *
    60 *
    1000;

  // The newest read failed: why is on the row.
  if (
    input.lastError &&
    (!lastSuccessfulPullAt ||
      (lastPulledAt && lastPulledAt.getTime() > lastSuccessfulPullAt.getTime()))
  ) {
    return {
      status: DeviceManagementConnectionStatus.Failing,
      ...(lastPulledAt ? { since: lastPulledAt } : {}),
    };
  }

  if (!lastSuccessfulPullAt) {
    /*
     * Never read. A connection that has waited longer than a read could
     * take was never picked up: say so rather than "waiting" forever.
     */
    if (
      createdAt &&
      now.getTime() - createdAt.getTime() > staleAfterMs &&
      !lastPulledAt
    ) {
      return { status: DeviceManagementConnectionStatus.Stale };
    }

    return { status: DeviceManagementConnectionStatus.Waiting };
  }

  if (now.getTime() - lastSuccessfulPullAt.getTime() > staleAfterMs) {
    return {
      status: DeviceManagementConnectionStatus.Stale,
      since: lastSuccessfulPullAt,
    };
  }

  if (input.lastReadStatus === "partial") {
    return {
      status: DeviceManagementConnectionStatus.Partial,
      since: lastSuccessfulPullAt,
    };
  }

  return {
    status: DeviceManagementConnectionStatus.Healthy,
    since: lastSuccessfulPullAt,
  };
}

// Whether a status is one a person should act on.
export function isDeviceManagementStatusAProblem(
  status: DeviceManagementConnectionStatus,
): boolean {
  return (
    status === DeviceManagementConnectionStatus.Failing ||
    status === DeviceManagementConnectionStatus.Stale
  );
}
