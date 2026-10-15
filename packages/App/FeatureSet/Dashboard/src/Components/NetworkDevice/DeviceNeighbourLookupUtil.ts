import { DeviceNeighbour } from "./DeviceNeighbours";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import Includes from "Common/Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The names a device's neighbour list needs, for the "Connected to" card:
 * what this device calls its own ports, and which neighbours are devices in
 * this project, so the card can link them.
 *
 * A plain .ts module rather than part of the card, for the reason
 * DeviceAttachmentLookupUtil is one: App/tsconfig excludes the Dashboard's
 * .tsx, so this is what App/Tests can import and pin.
 */

export interface DeviceNeighbourNames {
  // This device's port names, by interface index.
  portNames: Map<number, string>;
  // The neighbours that are devices here: name in lower case, to device id.
  neighbourDeviceIds: Map<string, string>;
}

/** The names of the neighbours that are names, not chassis ids. */
export function getAdvertisedNeighbourNames(
  neighbours: Array<DeviceNeighbour>,
): Array<string> {
  const names: Array<string> = [];
  const seen: Set<string> = new Set<string>();

  for (const neighbour of neighbours) {
    if (!neighbour.hasAdvertisedName) {
      continue;
    }

    const key: string = neighbour.name.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    names.push(neighbour.name);
  }

  return names;
}

/**
 * Reads this device's port names and the neighbours that are devices here.
 * A device whose neighbours are all chassis ids asks only for its ports:
 * a chassis id names no device.
 */
export async function getDeviceNeighbourNames(
  deviceId: ObjectID,
  neighbours: Array<DeviceNeighbour>,
): Promise<DeviceNeighbourNames> {
  const advertisedNames: Array<string> =
    getAdvertisedNeighbourNames(neighbours);

  const [interfaces, devices]: [
    ListResult<NetworkInterface>,
    Array<NetworkDevice>,
  ] = await Promise.all([
    ModelAPI.getList<NetworkInterface>({
      modelType: NetworkInterface,
      query: {
        networkDeviceId: deviceId.toString(),
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        interfaceIndex: true,
        name: true,
      },
      sort: {},
    }),
    advertisedNames.length > 0
      ? ModelAPI.getList<NetworkDevice>({
          modelType: NetworkDevice,
          query: {
            name: new Includes(advertisedNames),
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          select: {
            _id: true,
            name: true,
          },
          sort: {},
        }).then((result: ListResult<NetworkDevice>): Array<NetworkDevice> => {
          return result.data;
        })
      : Promise.resolve([]),
  ]);

  const portNames: Map<number, string> = new Map<number, string>();

  for (const item of interfaces.data) {
    if (typeof item.interfaceIndex === "number" && item.name) {
      portNames.set(item.interfaceIndex, item.name);
    }
  }

  const neighbourDeviceIds: Map<string, string> = new Map<string, string>();

  for (const item of devices) {
    const id: string | undefined = item._id?.toString();

    if (item.name && id && !neighbourDeviceIds.has(item.name.toLowerCase())) {
      neighbourDeviceIds.set(item.name.toLowerCase(), id);
    }
  }

  return { portNames: portNames, neighbourDeviceIds: neighbourDeviceIds };
}
