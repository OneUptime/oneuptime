import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * THE NAMES OF THE NETWORK DEVICES A LINE NAMES, as the reader may read
 * them: the device a scan's host at a shared address is, or the ones it
 * cannot tell apart (Review Results, issue #9905), and the devices a
 * monitor's probes cannot tell a device from (its Monitors card, #9903).
 */

function toIdKey(id: unknown): string {
  return typeof id === "string" ? id.trim().toLowerCase() : "";
}

/*
 * The names of these devices, by id (lower case), as the reader may read
 * them: a device they may not see is left out, and its line names none.
 */
export async function loadDeviceNames(
  deviceIds: ReadonlyArray<string>,
): Promise<Map<string, string>> {
  const names: Map<string, string> = new Map<string, string>();
  const ids: Array<string> = Array.from(new Set(deviceIds)).filter(
    (id: string): boolean => {
      return ObjectID.isValidUUID(id);
    },
  );

  for (
    let offset: number = 0;
    offset < ids.length;
    offset += LIMIT_PER_PROJECT
  ) {
    const piece: Array<string> = ids.slice(offset, offset + LIMIT_PER_PROJECT);

    const devices: ListResult<NetworkDevice> =
      await ModelAPI.getList<NetworkDevice>({
        modelType: NetworkDevice,
        query: { _id: new Includes(piece) },
        select: { _id: true, name: true },
        sort: { name: SortOrder.Ascending },
        limit: piece.length,
        skip: 0,
      });

    for (const device of devices.data) {
      const id: string = toIdKey(
        device._id?.toString() || device.id?.toString(),
      );
      const name: string = device.name?.toString().trim() || "";

      if (id && name) {
        names.set(id, name);
      }
    }
  }

  return names;
}
