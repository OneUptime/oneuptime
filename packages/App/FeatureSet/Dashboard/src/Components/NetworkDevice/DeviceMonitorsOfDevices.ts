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
 *
 * Always by the device, never by the address: two sites can each have a
 * 10.0.0.5 (issue #9677), and one branch's monitor says nothing about the
 * other branch's device. A scan's host names the device it is
 * (DiscoveredNetworkDevice.registeredDeviceId, which the server works out
 * from the scan's probe), and a Discovered Devices row its monitored device.
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
  // By the device's id, lower-cased.
  byDeviceId: Map<string, DeviceMonitorsSummary>;
}

export function emptyDeviceMonitorsByKey(): DeviceMonitorsByKey {
  return { byDeviceId: new Map() };
}

/*
 * A row's summary, when its device has a monitor: by the device's id - a
 * Discovered Devices row's monitored device, or the device a scan's host is.
 * Undefined when the row is no known device, its device has none, or it was
 * not read.
 */
export function getMonitorsOfRow(data: {
  monitors: DeviceMonitorsByKey;
  deviceId?: string | undefined;
}): DeviceMonitorsSummary | undefined {
  const summary: DeviceMonitorsSummary | undefined = data.deviceId
    ? data.monitors.byDeviceId.get(data.deviceId.toLowerCase())
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

    result.byDeviceId.set(deviceId.toLowerCase(), {
      deviceId: deviceId,
      monitors: monitors,
    });
  }

  return result;
}

// Ids, each once, lower-cased, with none empty.
function uniqueIds(ids: ReadonlyArray<string>): Array<string> {
  return Array.from(
    new Set(
      ids
        .map((id: string): string => {
          return (id || "").trim().toLowerCase();
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    ),
  );
}

/*
 * The monitors of the devices with these ids, as the reader may read them.
 * Nothing to ask about asks nothing.
 */
export async function loadDeviceMonitors(data: {
  deviceIds: ReadonlyArray<string>;
}): Promise<DeviceMonitorsByKey> {
  const deviceIds: Array<string> = uniqueIds(data.deviceIds);

  if (deviceIds.length === 0) {
    return emptyDeviceMonitorsByKey();
  }

  const devices: ListResult<NetworkDevice> =
    await ModelAPI.getList<NetworkDevice>({
      modelType: NetworkDevice,
      query: { _id: new Includes(deviceIds) },
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
 * How many devices one read names: a scan's already-added hosts can be
 * thousands, and one list read names a project's page of devices at most.
 */
export const DEVICE_MONITORS_DEVICES_PER_READ: number = 200;

/*
 * The monitors of every one of these devices - all the devices a scan's
 * hosts already are, as Review Results needs them to tell which can be
 * picked to get a monitor (issue #9544) - read a piece at a time and put
 * together. A piece that fails fails the whole read: the caller then offers
 * every device, and the server's duplicate rule keeps each to one monitor of
 * a kind.
 */
export async function loadDeviceMonitorsForDeviceIds(
  deviceIds: ReadonlyArray<string>,
): Promise<DeviceMonitorsByKey> {
  const unique: Array<string> = uniqueIds(deviceIds);
  const merged: DeviceMonitorsByKey = emptyDeviceMonitorsByKey();

  for (
    let offset: number = 0;
    offset < unique.length;
    offset += DEVICE_MONITORS_DEVICES_PER_READ
  ) {
    const piece: DeviceMonitorsByKey = await loadDeviceMonitors({
      deviceIds: unique.slice(
        offset,
        offset + DEVICE_MONITORS_DEVICES_PER_READ,
      ),
    });

    for (const [key, summary] of piece.byDeviceId) {
      merged.byDeviceId.set(key, summary);
    }
  }

  return merged;
}

/*
 * The devices, by id (lower-cased), that have a monitor: the ones Review
 * Results and Add to monitoring never offer to give a second one (issues
 * #9544, #9675).
 */
export function getMonitoredDeviceIds(
  monitors: DeviceMonitorsByKey,
): Set<string> {
  const deviceIds: Set<string> = new Set<string>();

  for (const [deviceId, summary] of monitors.byDeviceId) {
    if (summary.monitors.length > 0) {
      deviceIds.add(deviceId);
    }
  }

  return deviceIds;
}
