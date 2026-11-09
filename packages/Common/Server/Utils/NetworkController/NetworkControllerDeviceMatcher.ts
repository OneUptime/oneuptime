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
 * the project, in this order:
 *
 *   1. has its serial number (read off the device by its SNMP walk, written
 *      by Add devices, or linked by a person on the device's Traffic page);
 *   2. has its MAC address;
 *   3. is the device the connection's Inventory found the appliance to be:
 *      its controller reading (discoveredDetails.controller) names the
 *      appliance's serial number. Inventory ties a device to a Meraki device
 *      by stricter rules than a name or an address alone - for an MX, whose
 *      serial number nothing but the dashboard can read, by its name with a
 *      MAC of the appliance's block, or with the management address
 *      (NetworkControllerInventory, issue #5384) - and the device's details
 *      already say it is that appliance. Its traffic followed only rules 1
 *      and 2 until issue #5762: the device's page said "MX85, serial
 *      Q2XX-..." and showed none of the appliance's traffic.
 *
 * Every rule is exact: an appliance is never matched by a name, which two
 * devices can share, or by an address, which a NAT shares. Nothing is
 * written to the devices here.
 *
 * An appliance matched by none keeps its traffic in the project's bucket:
 * the whole network's Traffic page shows it under its Meraki name, and the
 * device it is can be linked to it from its own Traffic page.
 */

// Per-network: the appliance whose device a network's applications and clients belong to.
export interface NetworkControllerDeviceMatches {
  bySerial: Map<string, ObjectID>;
  byNetwork: Map<string, ObjectID>;
}

export interface NetworkControllerMatchCandidate {
  id: ObjectID;
  serialNumber: string;
  macAddress: string;
  // The serial number its controller reading names (rule 3), when it has one.
  controllerSerial?: string | undefined;
}

export type FindDevicesFunction = (data: {
  projectId: ObjectID;
  serials: Array<string>;
  macs: Array<string>;
}) => Promise<Array<NetworkControllerMatchCandidate>>;

export default class NetworkControllerDeviceMatcher {
  public static async findDevices(data: {
    projectId: ObjectID;
    serials: Array<string>;
    macs: Array<string>;
  }): Promise<Array<NetworkControllerMatchCandidate>> {
    const found: Array<NetworkControllerMatchCandidate> = [];

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

    if (data.serials.length > 0) {
      const described: Array<{ id: ObjectID; controllerSerial: string }> =
        await NetworkDeviceService.findByControllerSerials({
          projectId: data.projectId,
          serials: data.serials,
          limit: LIMIT_MAX,
        });

      for (const device of described) {
        found.push({
          id: device.id,
          serialNumber: "",
          macAddress: "",
          controllerSerial: device.controllerSerial,
        });
      }
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

    const devices: Array<NetworkControllerMatchCandidate> = await (
      data.findDevices || NetworkControllerDeviceMatcher.findDevices
    )({
      projectId: data.projectId,
      serials,
      macs,
    });

    const deviceBySerial: Map<string, ObjectID> = new Map();
    const deviceByMac: Map<string, ObjectID> = new Map();
    const deviceByControllerSerial: Map<string, ObjectID> = new Map();

    // Oldest-first is not known here; the first device seen for a key wins.
    for (const device of devices) {
      const serial: string = (device.serialNumber || "").trim().toUpperCase();
      const mac: string = (device.macAddress || "").trim().toLowerCase();
      const controllerSerial: string = (device.controllerSerial || "")
        .trim()
        .toUpperCase();

      if (serial && !deviceBySerial.has(serial)) {
        deviceBySerial.set(serial, device.id);
      }

      if (mac && !deviceByMac.has(mac)) {
        deviceByMac.set(mac, device.id);
      }

      if (controllerSerial && !deviceByControllerSerial.has(controllerSerial)) {
        deviceByControllerSerial.set(controllerSerial, device.id);
      }
    }

    // A network's analytics go to its first matched appliance, by serial.
    const sorted: Array<NetworkControllerAppliance> = [...data.appliances].sort(
      (
        a: NetworkControllerAppliance,
        b: NetworkControllerAppliance,
      ): number => {
        return a.serial.localeCompare(b.serial);
      },
    );

    for (const appliance of sorted) {
      const serialKey: string = appliance.serial.trim().toUpperCase();
      const deviceId: ObjectID | undefined =
        deviceBySerial.get(serialKey) ||
        (appliance.mac ? deviceByMac.get(appliance.mac) : undefined) ||
        deviceByControllerSerial.get(serialKey);

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
