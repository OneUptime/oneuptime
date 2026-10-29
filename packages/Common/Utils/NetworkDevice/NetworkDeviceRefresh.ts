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

/*
 * Why a device cannot be read again now, as the refresh route refuses it
 * and the card shows it (NetworkDeviceRefreshRunner.getCannotRefreshReason).
 * The server's own words, as every refusal the API sends is.
 */
export const MONITOR_BACKED_REASON: string =
  "This device is checked by its monitor, so nothing polls it: there is nothing to read again. Its details come from discovery scans of its address.";
export const NO_PROBE_REASON: string =
  "No probe polls this device yet. Pick the probe that reaches it in the device's Settings, then refresh it.";
export const POLLING_OFF_REASON: string =
  "Polling is turned off for this device. Turn it on in the device's Settings to read it again.";
/*
 * A device only its Meraki connection reads, while that connection is
 * turned off: the card offered Refresh for the connection's reading, so the
 * refusal names the connection rather than the probe the device never had.
 */
export const CONTROLLER_OFF_REASON: string =
  "The Meraki connection that reads this device is turned off. Turn it on at the foot of the network's Traffic page, then refresh the device.";

/*
 * What the refresh route answers (POST /network-device/:id/refresh): when the
 * refresh was asked for, on the server's clock, and who reads the device
 * again.
 */
export interface NetworkDeviceRefreshAnswer {
  requestedAt: string;
  // Its probe reads it within a minute.
  isProbeReading: boolean;
  probeName?: string | undefined;
  // A network controller connection (the Meraki dashboard) reads it again.
  isControllerReading: boolean;
  controllerName?: string | undefined;
  // An earlier ask, not answered yet, is this one.
  wasAlreadyRequested: boolean;
}

/*
 * An answer read back without trusting its shape: undefined when it is not
 * one (no time that parses, nobody reading).
 */
export function readNetworkDeviceRefreshAnswer(
  value: unknown,
): NetworkDeviceRefreshAnswer | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const answer: Record<string, unknown> = value as Record<string, unknown>;
  const requestedAt: number | undefined = readTime(answer["requestedAt"]);
  const isProbeReading: boolean = answer["isProbeReading"] === true;
  const isControllerReading: boolean = answer["isControllerReading"] === true;

  if (requestedAt === undefined || (!isProbeReading && !isControllerReading)) {
    return undefined;
  }

  const text: (key: string) => string | undefined = (
    key: string,
  ): string | undefined => {
    const read: unknown = answer[key];
    return typeof read === "string" && read.trim() ? read.trim() : undefined;
  };

  const probeName: string | undefined = text("probeName");
  const controllerName: string | undefined = text("controllerName");

  return {
    requestedAt: new Date(requestedAt).toISOString(),
    isProbeReading: isProbeReading,
    ...(probeName ? { probeName: probeName } : {}),
    isControllerReading: isControllerReading,
    ...(controllerName ? { controllerName: controllerName } : {}),
    wasAlreadyRequested: answer["wasAlreadyRequested"] === true,
  };
}

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
  // Every reader asked has read it since, and its probe reached it.
  Read = "read",
  // Its probe polled it since the ask, and could not reach it.
  Unreachable = "unreachable",
  // A reader asked has not read it in the time a read takes.
  Late = "late",
}

export interface NetworkDeviceRefreshStanding {
  progress: NetworkDeviceRefreshProgress;
  // Who has not read it since the ask: what a late refresh waits for.
  isProbePending: boolean;
  isControllerPending: boolean;
}

/**
 * Where a refresh stands, from the device as it reads now: its probe has
 * answered once it polled the device after the ask (lastPolledAt), and its
 * controller once its reading was read after the ask (the reading's
 * readAt). Both on the server's clock, as the ask's time is; only "late"
 * reads the page's own clock, and three minutes leave room for a skew.
 */
export function getNetworkDeviceRefreshStanding(data: {
  answer: NetworkDeviceRefreshAnswer;
  lastPolledAt: unknown;
  isReachable: unknown;
  controllerReadAt: unknown;
  now: Date;
}): NetworkDeviceRefreshStanding {
  const requestedAt: number | undefined = readTime(data.answer.requestedAt);
  const polledAt: number | undefined = readTime(data.lastPolledAt);
  const controllerReadAt: number | undefined = readTime(data.controllerReadAt);

  const isAnsweredAt: (time: number | undefined) => boolean = (
    time: number | undefined,
  ): boolean => {
    return (
      requestedAt !== undefined && time !== undefined && time >= requestedAt
    );
  };

  const isProbePending: boolean =
    data.answer.isProbeReading && !isAnsweredAt(polledAt);
  const isControllerPending: boolean =
    data.answer.isControllerReading && !isAnsweredAt(controllerReadAt);

  if (!isProbePending && !isControllerPending) {
    return {
      progress:
        data.answer.isProbeReading && data.isReachable === false
          ? NetworkDeviceRefreshProgress.Unreachable
          : NetworkDeviceRefreshProgress.Read,
      isProbePending: false,
      isControllerPending: false,
    };
  }

  const isLate: boolean =
    requestedAt !== undefined &&
    data.now.getTime() - requestedAt >= NETWORK_DEVICE_REFRESH_GIVE_UP_MS;

  return {
    progress: isLate
      ? NetworkDeviceRefreshProgress.Late
      : NetworkDeviceRefreshProgress.Waiting,
    isProbePending: isProbePending,
    isControllerPending: isControllerPending,
  };
}

/**
 * A refresh someone asked for that has not been answered yet, and is not
 * late: what a page opened after the ask - another tab, a reload - shows as
 * under way. Who reads it is worked out from the device as it is.
 */
export function getPendingNetworkDeviceRefresh(data: {
  device: NetworkDeviceRefreshSource & {
    refreshRequestedAt?: unknown;
    lastPolledAt?: unknown;
  };
  now: Date;
}): NetworkDeviceRefreshAnswer | undefined {
  const requestedAt: number | undefined = readTime(
    data.device.refreshRequestedAt,
  );

  if (
    requestedAt === undefined ||
    data.now.getTime() - requestedAt >= NETWORK_DEVICE_REFRESH_GIVE_UP_MS
  ) {
    return undefined;
  }

  const readers: NetworkDeviceRefreshReaders = getNetworkDeviceRefreshReaders(
    data.device,
  );
  const controllerReadAt: number | undefined = readTime(
    readers.controller?.readAt,
  );

  const answer: NetworkDeviceRefreshAnswer = {
    requestedAt: new Date(requestedAt).toISOString(),
    isProbeReading: readers.isProbePolled,
    isControllerReading: Boolean(readers.controller),
    wasAlreadyRequested: true,
  };

  const standing: NetworkDeviceRefreshStanding =
    getNetworkDeviceRefreshStanding({
      answer: answer,
      lastPolledAt: data.device.lastPolledAt,
      isReachable: undefined,
      controllerReadAt: controllerReadAt,
      now: data.now,
    });

  return standing.progress === NetworkDeviceRefreshProgress.Waiting
    ? answer
    : undefined;
}
