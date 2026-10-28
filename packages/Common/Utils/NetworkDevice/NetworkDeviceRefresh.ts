import { NetworkDeviceMonitoringMethodUtil } from "../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import {
  NetworkDeviceControllerReading,
  readNetworkDeviceDiscoveredDetails,
} from "../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";

/*
 * "REFRESH": READ A NETWORK DEVICE AGAIN NOW (OneUptime issue #5185: "Inventory
 * should support refreshing discovered information as devices and network
 * details change").
 *
 * A device's details are read on schedules: its probe polls it every few
 * minutes, a network controller connection reads Meraki every few minutes,
 * discovery scans sweep its address every few hours, and its Inventory item
 * copies the device every fifteen minutes. After a firmware upgrade or a
 * swapped box, a person should not have to wait for those: Refresh asks the
 * readers that can be asked to read it now.
 *
 *   - Its probe, when a probe polls it (polling on, a probe and an address,
 *     not monitor-backed): the device goes to the front of its probe's queue,
 *     so the probe's next fetch - within a minute - pings it, and walks it
 *     when it has SNMP credentials. Its Inventory item is copied as soon as
 *     that poll lands.
 *   - Its controller, when a network controller connection describes it
 *     (the Meraki dashboard): that connection is read at once, and writes
 *     the device's reading again even when nothing in it changed - so the
 *     reading says it was read just now.
 *
 * Discovery scans are not run from here: a scan sweeps a whole range, and
 * sweeping a /16 to refresh one device is out of all proportion. What they
 * read stays as it is, with when.
 *
 * Pure, and shared: the refresh route decides with it, the poll pipeline
 * knows a poll answers a refresh with it, and the Dashboard draws the
 * button's states with it.
 */

/*
 * A refresh asked for again within this long of the last one, before that
 * one was answered, IS that one: nothing is queued twice.
 */
export const NETWORK_DEVICE_REFRESH_PENDING_MS: number = 60 * 1000;

/*
 * How long a refresh is waited for. A probe fetches every minute; past this
 * the probe is likely offline or busy, and the page says so.
 */
export const NETWORK_DEVICE_REFRESH_GIVE_UP_MS: number = 3 * 60 * 1000;

// Where a refreshed device goes in its probe's queue: first.
export const NETWORK_DEVICE_REFRESH_POLL_AT: Date = new Date(0);

export interface NetworkDeviceRefreshSource {
  probeId?: unknown;
  isPollingEnabled?: unknown;
  monitoringMethod?: unknown;
  hostname?: unknown;
  discoveredDetails?: unknown;
}

export interface NetworkDeviceRefreshReaders {
  // Its probe polls it.
  isProbePolled: boolean;
  // The controller reading a connection keeps on it, when one does.
  controller?: NetworkDeviceControllerReading | undefined;
}

function readTime(value: unknown): number | undefined {
  if (value instanceof Date) {
    const time: number = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  if (typeof value === "string" && value.trim()) {
    const time: number = new Date(value.trim()).getTime();
    return Number.isNaN(time) ? undefined : time;
  }

  return undefined;
}

/**
 * Who can be asked to read a device again: its probe, its controller, both,
 * or neither (then Refresh has nothing to ask, and is not offered).
 */
export function getNetworkDeviceRefreshReaders(
  device: NetworkDeviceRefreshSource,
): NetworkDeviceRefreshReaders {
  const hostname: string =
    typeof device.hostname === "string" ? device.hostname.trim() : "";
  const probeId: string =
    device.probeId === undefined || device.probeId === null
      ? ""
      : String(device.probeId).trim();
  const monitoringMethod: string | undefined =
    typeof device.monitoringMethod === "string"
      ? device.monitoringMethod
      : undefined;

  const isProbePolled: boolean = Boolean(
    probeId &&
      hostname &&
      device.isPollingEnabled !== false &&
      NetworkDeviceMonitoringMethodUtil.isProbePolled(monitoringMethod),
  );

  const controller: NetworkDeviceControllerReading | undefined =
    readNetworkDeviceDiscoveredDetails(device.discoveredDetails).controller;

  return controller
    ? { isProbePolled: isProbePolled, controller: controller }
    : { isProbePolled: isProbePolled };
}

// True when something can be asked to read the device again.
export function canRefreshNetworkDevice(
  device: NetworkDeviceRefreshSource,
): boolean {
  const readers: NetworkDeviceRefreshReaders =
    getNetworkDeviceRefreshReaders(device);

  return readers.isProbePolled || Boolean(readers.controller);
}

/**
 * True for a refresh asked for so recently, and not answered yet, that a new
 * ask is the same one.
 */
export function isNetworkDeviceRefreshPending(data: {
  refreshRequestedAt: unknown;
  lastPolledAt: unknown;
  now: Date;
}): boolean {
  const requestedAt: number | undefined = readTime(data.refreshRequestedAt);

  if (requestedAt === undefined) {
    return false;
  }

  const polledAt: number | undefined = readTime(data.lastPolledAt);
  const age: number = data.now.getTime() - requestedAt;

  return (
    age >= 0 &&
    age < NETWORK_DEVICE_REFRESH_PENDING_MS &&
    (polledAt === undefined || polledAt < requestedAt)
  );
}

/**
 * True when a poll that lands now is the first since someone asked for the
 * device to be read again: the poll before it landed before the ask.
 */
export function isFirstPollSinceRefresh(data: {
  refreshRequestedAt: unknown;
  previousLastPolledAt: unknown;
}): boolean {
  const requestedAt: number | undefined = readTime(data.refreshRequestedAt);

  if (requestedAt === undefined) {
    return false;
  }

  const previous: number | undefined = readTime(data.previousLastPolledAt);

  return previous === undefined || previous < requestedAt;
}

export enum NetworkDeviceRefreshProgress {
  // Asked, and waiting for the readers.
  Waiting = "waiting",
  // Its probe polled it since the ask, and reached it.
  Read = "read",
  // Its probe polled it since the ask, and could not reach it.
  Unreachable = "unreachable",
  // Nothing has polled it in the time a poll takes: its probe may be offline.
  Late = "late",
}

/**
 * Where a refresh stands, from the device as it reads now. A device only its
 * controller reads has no poll to wait for: its reading's time says when
 * Meraki was read, and the page shows it.
 */
export function getNetworkDeviceRefreshProgress(data: {
  requestedAt: unknown;
  lastPolledAt: unknown;
  isReachable: unknown;
  now: Date;
}): NetworkDeviceRefreshProgress {
  const requestedAt: number | undefined = readTime(data.requestedAt);
  const polledAt: number | undefined = readTime(data.lastPolledAt);

  if (
    requestedAt !== undefined &&
    polledAt !== undefined &&
    polledAt >= requestedAt
  ) {
    return data.isReachable === false
      ? NetworkDeviceRefreshProgress.Unreachable
      : NetworkDeviceRefreshProgress.Read;
  }

  if (
    requestedAt !== undefined &&
    data.now.getTime() - requestedAt >= NETWORK_DEVICE_REFRESH_GIVE_UP_MS
  ) {
    return NetworkDeviceRefreshProgress.Late;
  }

  return NetworkDeviceRefreshProgress.Waiting;
}
