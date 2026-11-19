import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * THE MONITORS A DEVICE ALREADY HAS, FOR THE LISTS THAT OFFER TO ADD IT
 * (OneUptime issue #9509).
 *
 * A scan's Review Results and the Discovered Devices list said a host was
 * "Already added" - a device - and nothing about whether anything watched
 * it, so whoever wanted it monitored went looking for another way to give it
 * a monitor, and a second identical one crept in. Each row that is already a
 * device now says "Already monitored" when it is, and links to its monitor -
 * or, with several, to the device's Monitors page.
 *
 * "Its monitors" are the ones the server's duplicate check counts
 * (DeviceMonitorDuplicateCheck): the ones made for the device (an import's,
 * an auto import rule's, an alert policy's), the ones a person tied to it
 * (Monitor.networkDeviceId, issue #9545) and the one bound to it. Read for a
 * page of rows at a time, as the reader: three list reads, whatever the page
 * holds. Best effort - a read that fails leaves every row as it was,
 * "Already added", which is still true.
 */

export interface DeviceMonitorLink {
  id: string;
  name: string;
  monitorType: string;
}

export interface DeviceMonitorsSummary {
  deviceId: string;
  // The bound monitor first - it decides the device's status - then by name.
  monitors: Array<DeviceMonitorLink>;
}

export interface DeviceMonitorsByKey {
  byDeviceId: Map<string, DeviceMonitorsSummary>;
  /*
   * By the address a device is at, for a scan's hosts. Two sites can both
   * have a 10.0.0.5, so an address can name several devices: their
   * monitors are listed together, the first device's leading.
   */
  byHostname: Map<string, DeviceMonitorsSummary>;
}

export function emptyDeviceMonitorsByKey(): DeviceMonitorsByKey {
  return { byDeviceId: new Map(), byHostname: new Map() };
}

/*
 * A row's summary, when its device has a monitor: by the device's id (a
 * Discovered Devices row), else by the host's address (a scan's host).
 * Undefined when the row's device has none, or was not read.
 */
export function getMonitorsOfRow(data: {
  monitors: DeviceMonitorsByKey;
  deviceId?: string | undefined;
  hostname?: string | undefined;
}): DeviceMonitorsSummary | undefined {
  const summary: DeviceMonitorsSummary | undefined = data.deviceId
    ? data.monitors.byDeviceId.get(data.deviceId.toLowerCase())
    : data.hostname
      ? data.monitors.byHostname.get(data.hostname.trim())
      : undefined;

  return summary && summary.monitors.length > 0 ? summary : undefined;
}

function toLink(monitor: Monitor): DeviceMonitorLink | null {
  const id: string = monitor.id?.toString() || monitor._id?.toString() || "";

  if (!id) {
    return null;
  }

  return {
    id: id,
    name: monitor.name || "",
    monitorType: String(monitor.monitorType || ""),
  };
}

function addLink(
  links: Array<DeviceMonitorLink>,
  link: DeviceMonitorLink | null,
): void {
  if (
    link &&
    !links.some((existing: DeviceMonitorLink): boolean => {
      return existing.id.toLowerCase() === link.id.toLowerCase();
    })
  ) {
    links.push(link);
  }
}

/*
 * The summaries, worked out from what the reads answered: each device's
 * bound monitor, then the monitors made for it or tied to it, each once, by
 * name. React-free and request-free, so the rule is tested on its own.
 */
export function summarizeDeviceMonitors(data: {
  devices: ReadonlyArray<NetworkDevice>;
  monitorsMadeForDevices: ReadonlyArray<Monitor>;
  // Monitors a person tied to the devices (issue #9545); none when not read.
  monitorsTiedToDevices?: ReadonlyArray<Monitor> | undefined;
}): DeviceMonitorsByKey {
  const result: DeviceMonitorsByKey = emptyDeviceMonitorsByKey();

  for (const device of data.devices) {
    const deviceId: string = device.id?.toString() || "";

    if (!deviceId) {
      continue;
    }

    const monitors: Array<DeviceMonitorLink> = [];

    if (device.monitor) {
      addLink(monitors, toLink(device.monitor));
    }

    const isTheDevice: (
      id: { toString(): string } | null | undefined,
    ) => boolean = (id: { toString(): string } | null | undefined): boolean => {
      return id?.toString().toLowerCase() === deviceId.toLowerCase();
    };

    const madeFor: Array<Monitor> = [
      ...data.monitorsMadeForDevices.filter((monitor: Monitor): boolean => {
        return isTheDevice(monitor.autoProvisionedNetworkDeviceId);
      }),
      ...(data.monitorsTiedToDevices || []).filter(
        (monitor: Monitor): boolean => {
          return isTheDevice(monitor.networkDeviceId);
        },
      ),
    ].sort((first: Monitor, second: Monitor): number => {
      return (first.name || "").localeCompare(second.name || "");
    });

    for (const monitor of madeFor) {
      addLink(monitors, toLink(monitor));
    }

    const summary: DeviceMonitorsSummary = {
      deviceId: deviceId,
      monitors: monitors,
    };

    result.byDeviceId.set(deviceId.toLowerCase(), summary);

    const hostname: string = (device.hostname || "").trim();

    if (!hostname) {
      continue;
    }

    const atAddress: DeviceMonitorsSummary | undefined =
      result.byHostname.get(hostname);

    if (!atAddress) {
      result.byHostname.set(hostname, {
        deviceId: deviceId,
        monitors: [...monitors],
      });
      continue;
    }

    for (const link of monitors) {
      addLink(atAddress.monitors, link);
    }
  }

  return result;
}

/*
 * The monitors of the devices with these ids, or at these addresses, as the
 * reader may read them. Nothing to ask about asks nothing.
 */
export async function loadDeviceMonitors(data: {
  deviceIds?: ReadonlyArray<string> | undefined;
  hostnames?: ReadonlyArray<string> | undefined;
}): Promise<DeviceMonitorsByKey> {
  const deviceIds: Array<string> = Array.from(
    new Set(
      (data.deviceIds || []).filter((id: string): boolean => {
        return Boolean(id);
      }),
    ),
  );
  const hostnames: Array<string> = Array.from(
    new Set(
      (data.hostnames || [])
        .map((hostname: string): string => {
          return hostname.trim();
        })
        .filter((hostname: string): boolean => {
          return Boolean(hostname);
        }),
    ),
  );

  if (deviceIds.length === 0 && hostnames.length === 0) {
    return emptyDeviceMonitorsByKey();
  }

  const devices: ListResult<NetworkDevice> =
    await ModelAPI.getList<NetworkDevice>({
      modelType: NetworkDevice,
      query:
        deviceIds.length > 0
          ? { _id: new Includes(deviceIds) }
          : { hostname: new Includes(hostnames) },
      select: {
        _id: true,
        hostname: true,
        monitorId: true,
        monitor: {
          _id: true,
          name: true,
          monitorType: true,
        },
      },
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });

  const foundDeviceIds: Array<string> = devices.data
    .map((device: NetworkDevice): string => {
      return device.id?.toString() || "";
    })
    .filter((id: string): boolean => {
      return Boolean(id);
    });

  if (foundDeviceIds.length === 0) {
    return emptyDeviceMonitorsByKey();
  }

  const [madeFor, tiedTo]: [ListResult<Monitor>, ListResult<Monitor>] =
    await Promise.all([
      ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          autoProvisionedNetworkDeviceId: new Includes(foundDeviceIds),
        },
        select: {
          _id: true,
          name: true,
          monitorType: true,
          autoProvisionedNetworkDeviceId: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      }),
      // The ones a person tied to the devices (issue #9545).
      ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          networkDeviceId: new Includes(foundDeviceIds),
        },
        select: {
          _id: true,
          name: true,
          monitorType: true,
          networkDeviceId: true,
        },
        sort: { name: SortOrder.Ascending },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      }),
    ]);

  return summarizeDeviceMonitors({
    devices: devices.data,
    monitorsMadeForDevices: madeFor.data,
    monitorsTiedToDevices: tiedTo.data,
  });
}

/*
 * How many addresses one read of the devices at a scan's hosts names: a
 * scan's already-added hosts can be thousands, and one list read names a
 * project's page of devices at most.
 */
export const DEVICE_MONITORS_HOSTNAMES_PER_READ: number = 200;

/*
 * The monitors of the devices at every one of these addresses - all of a
 * scan's hosts that are devices already, as Review Results needs them to
 * tell which can be picked to get a monitor (issue #9544) - read a piece at
 * a time and put together. A piece that fails fails the whole read: the
 * caller then offers every device, and the server's duplicate rule keeps
 * each to one monitor of a kind.
 */
export async function loadDeviceMonitorsForHostnames(
  hostnames: ReadonlyArray<string>,
): Promise<DeviceMonitorsByKey> {
  const unique: Array<string> = Array.from(
    new Set(
      hostnames
        .map((hostname: string): string => {
          return hostname.trim();
        })
        .filter((hostname: string): boolean => {
          return Boolean(hostname);
        }),
    ),
  );

  const merged: DeviceMonitorsByKey = emptyDeviceMonitorsByKey();

  for (
    let offset: number = 0;
    offset < unique.length;
    offset += DEVICE_MONITORS_HOSTNAMES_PER_READ
  ) {
    const piece: DeviceMonitorsByKey = await loadDeviceMonitors({
      hostnames: unique.slice(
        offset,
        offset + DEVICE_MONITORS_HOSTNAMES_PER_READ,
      ),
    });

    for (const [key, summary] of piece.byDeviceId) {
      merged.byDeviceId.set(key, summary);
    }

    for (const [key, summary] of piece.byHostname) {
      merged.byHostname.set(key, summary);
    }
  }

  return merged;
}

/*
 * The addresses whose device - any device at that address - has a monitor:
 * the hosts Review Results never offers to give a second one (issue #9544).
 */
export function getMonitoredAddresses(
  monitors: DeviceMonitorsByKey,
): Set<string> {
  const addresses: Set<string> = new Set<string>();

  for (const [hostname, summary] of monitors.byHostname) {
    if (summary.monitors.length > 0) {
      addresses.add(hostname);
    }
  }

  return addresses;
}
