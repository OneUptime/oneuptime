import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  InventoryAssetDetails,
  getNetworkDeviceInventoryAssetDetails,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import { TopologyDeviceRoleInput } from "Common/Utils/Monitor/NetworkDeviceRoleCatalog";
import { useEffect, useState } from "react";
import { NETWORK_DEVICE_ASSET_FACT_SELECT } from "./NetworkDeviceAssetSelect";

/*
 * A network device's asset details read from the device ITSELF, for its
 * Inventory item's Asset Details card (OneUptime issue #5185).
 *
 * The item is a copy the inventory mirror refreshes every fifteen minutes, and
 * it carries the facts but not where each one came from. The device carries
 * both, current to the moment: what its poll read and when, what discovery
 * read and when, what someone saved. The card reads it when it may and falls
 * back to the item's facts when it may not - a reader without the network
 * device permissions, a device deleted since the last mirror - so the card
 * never shows less than it did before.
 *
 * The project's device roles are read beside it, so a device the classifier
 * calls a "wirelessAccessPoint" is named as the project names that role, the
 * way the mirror names it. A refused role read just means the built-in names.
 */

export interface NetworkDeviceAssetDetailsRead {
  // Null when the item is not a device, the device cannot be read, or yet.
  details: InventoryAssetDetails | null;
  isLoading: boolean;
}

// What the hook reads off an Inventory item.
export interface LinkedNetworkDeviceSource {
  entityType?: unknown;
  resourceType?: unknown;
  resourceId?: unknown;
}

/**
 * The Network Device an Inventory item mirrors, or null for any other item.
 */
export function getLinkedNetworkDeviceId(
  item: LinkedNetworkDeviceSource,
): ObjectID | null {
  if (
    item.entityType !== EntityType.NetworkDevice ||
    item.resourceType !== "NetworkDevice" ||
    !item.resourceId
  ) {
    return null;
  }

  const id: string = String(item.resourceId).trim();

  return ObjectID.isValidUUID(id) ? new ObjectID(id) : null;
}

async function readProjectRoles(): Promise<Array<TopologyDeviceRoleInput>> {
  try {
    const roles: ListResult<NetworkDeviceRole> =
      await ModelAPI.getList<NetworkDeviceRole>({
        modelType: NetworkDeviceRole,
        query: {},
        select: {
          key: true,
          name: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        sort: {},
      });

    const inputs: Array<TopologyDeviceRoleInput> = [];

    for (const role of roles.data) {
      if (role.key && role.name) {
        inputs.push({ key: role.key, name: role.name });
      }
    }

    return inputs;
  } catch {
    return [];
  }
}

/**
 * The asset details of the device the item mirrors, with their sources -
 * see the header.
 */
const useNetworkDeviceAssetDetails: (
  item: LinkedNetworkDeviceSource,
) => NetworkDeviceAssetDetailsRead = (
  item: LinkedNetworkDeviceSource,
): NetworkDeviceAssetDetailsRead => {
  const deviceId: ObjectID | null = getLinkedNetworkDeviceId(item);
  const deviceIdString: string = deviceId ? deviceId.toString() : "";

  const [read, setRead] = useState<NetworkDeviceAssetDetailsRead>({
    details: null,
    isLoading: Boolean(deviceId),
  });

  useEffect(() => {
    if (!deviceIdString) {
      setRead({ details: null, isLoading: false });
      return;
    }

    let isCancelled: boolean = false;

    setRead({ details: null, isLoading: true });

    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const [device, roles]: [
          NetworkDevice | null,
          Array<TopologyDeviceRoleInput>,
        ] = await Promise.all([
          ModelAPI.getItem<NetworkDevice>({
            modelType: NetworkDevice,
            id: new ObjectID(deviceIdString),
            select: NETWORK_DEVICE_ASSET_FACT_SELECT,
          }),
          readProjectRoles(),
        ]);

        if (isCancelled) {
          return;
        }

        setRead({
          details: device
            ? getNetworkDeviceInventoryAssetDetails(device, { roles: roles })
            : null,
          isLoading: false,
        });
      } catch {
        // The item's own facts stand in: never less than before.
        if (!isCancelled) {
          setRead({ details: null, isLoading: false });
        }
      }
    };

    load().catch(() => {
      // Handled inside.
    });

    return () => {
      isCancelled = true;
    };
  }, [deviceIdString]);

  return read;
};

export default useNetworkDeviceAssetDetails;
