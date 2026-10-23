import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { NetworkControllerAppliance } from "./NetworkControllerTypes";

/*
 * WHICH APPLIANCES ARE DEVICES IN ONEUPTIME.
 *
 * An appliance's traffic belongs to the device it is - its Traffic tab, its
 * site's Traffic page, and whoever may read that device - when a device of
 * the project has its serial number (read off the device by its SNMP walk,
 * or typed) or its MAC address. Both are exact: an appliance is never
 * matched by a name, which two devices can share, or by an address, which
 * a NAT shares. Nothing is written to the devices.
 *
 * An appliance matched by neither keeps its traffic in the project's
 * bucket: the whole network's Traffic page shows it under its Meraki name.
 */

// Per-network: the appliance whose device a network's applications and clients belong to.
export interface NetworkControllerDeviceMatches {
  bySerial: Map<string, ObjectID>;
  byNetwork: Map<string, ObjectID>;
}

export type FindDevicesFunction = (data: {
  projectId: ObjectID;
  serials: Array<string>;
  macs: Array<string>;
}) => Promise<Array<{ id: ObjectID; serialNumber: string; macAddress: string }>>;

export default class NetworkControllerDeviceMatcher {
  public static async findDevices(data: {
    projectId: ObjectID;
    serials: Array<string>;
    macs: Array<string>;
  }): Promise<
    Array<{ id: ObjectID; serialNumber: string; macAddress: string }>
  > {
    const found: Array<{
      id: ObjectID;
      serialNumber: string;
      macAddress: string;
    }> = [];

    const collect: (devices: Array<NetworkDevice>) => void = (
      devices: Array<NetworkDevice>,
    ): void => {
      for (const device of devices) {
        if (device.id) {
          found.push({
            id: device.id,
            serialNumber: device.serialNumber || "",
            macAddress: device.macAddress || "",
          });
        }
      }
    };

    if (data.serials.length > 0) {
      collect(
        await NetworkDeviceService.findBy({
          query: {
            projectId: data.projectId,
            serialNumber: QueryHelper.any(data.serials),
          },
          select: { _id: true, serialNumber: true, macAddress: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        }),
      );
    }

    if (data.macs.length > 0) {
      collect(
        await NetworkDeviceService.findBy({
          query: {
            projectId: data.projectId,
            macAddress: QueryHelper.any(data.macs),
          },
          select: { _id: true, serialNumber: true, macAddress: true },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        }),
      );
    }

    return found;
  }

  public static async match(data: {
    projectId: ObjectID;
    appliances: Array<NetworkControllerAppliance>;
    findDevices?: FindDevicesFunction | undefined;
  }): Promise<NetworkControllerDeviceMatches> {
    const matches: NetworkControllerDeviceMatches = {
      bySerial: new Map(),
      byNetwork: new Map(),
    };

    if (data.appliances.length === 0) {
      return matches;
    }

    // Serials as Meraki prints them and as a walk might have stored them.
    const serials: Array<string> = Array.from(
      new Set(
        data.appliances.flatMap(
          (appliance: NetworkControllerAppliance): Array<string> => {
            return [appliance.serial, appliance.serial.toLowerCase()];
          },
        ),
      ),
    ).filter(Boolean);
    const macs: Array<string> = Array.from(
      new Set(
        data.appliances
          .map((appliance: NetworkControllerAppliance): string => {
            return appliance.mac;
          })
          .filter(Boolean),
      ),
    );

    const devices: Array<{
      id: ObjectID;
      serialNumber: string;
      macAddress: string;
    }> = await (data.findDevices || NetworkControllerDeviceMatcher.findDevices)({
      projectId: data.projectId,
      serials,
      macs,
    });

    const deviceBySerial: Map<string, ObjectID> = new Map();
    const deviceByMac: Map<string, ObjectID> = new Map();

    // Oldest-first is not known here; the first device seen for a key wins.
    for (const device of devices) {
      const serial: string = device.serialNumber.trim().toUpperCase();
      const mac: string = device.macAddress.trim().toLowerCase();

      if (serial && !deviceBySerial.has(serial)) {
        deviceBySerial.set(serial, device.id);
      }

      if (mac && !deviceByMac.has(mac)) {
        deviceByMac.set(mac, device.id);
      }
    }

    // A network's analytics go to its first matched appliance, by serial.
    const sorted: Array<NetworkControllerAppliance> = [...data.appliances].sort(
      (a: NetworkControllerAppliance, b: NetworkControllerAppliance): number => {
        return a.serial.localeCompare(b.serial);
      },
    );

    for (const appliance of sorted) {
      const deviceId: ObjectID | undefined =
        deviceBySerial.get(appliance.serial) ||
        (appliance.mac ? deviceByMac.get(appliance.mac) : undefined);

      if (!deviceId) {
        continue;
      }

      matches.bySerial.set(appliance.serial, deviceId);

      if (!matches.byNetwork.has(appliance.controllerNetworkId)) {
        matches.byNetwork.set(appliance.controllerNetworkId, deviceId);
      }
    }

    return matches;
  }
}
