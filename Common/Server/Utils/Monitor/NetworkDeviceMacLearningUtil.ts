import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import DeviceMacLearningUtil, {
  MacLearningCandidateDevice,
  MacLearningIpBinding,
  MacLearningPlanEntry,
} from "../../../Utils/Monitor/DeviceMacLearningUtil";
import logger from "../Logger";

/*
 * Fills NetworkDevice.macAddress from a walked router's ARP table.
 *
 * Runs once per successful walk that carried ARP entries, after the
 * endpoint inventory has been written. The decision of WHICH devices to
 * stamp is DeviceMacLearningUtil.planMacLearning (pure, tested without a
 * database); this only fetches the candidates and applies the plan.
 *
 * The write is hook-free and compare-and-set: a row is stamped only while
 * its MAC column still holds what the plan saw (NULL for a first learn, the
 * previously learned MAC for a correction), so an operator who types a MAC
 * between the read and the write keeps theirs, and two walks racing on one
 * row cannot both land. A stable site plans nothing - every device already
 * holds what the table says - so it costs one indexed read per walk and no
 * writes, which is what keeps this affordable at fleet scale.
 *
 * The write cannot tell the caller whether the compare-and-set matched a
 * row, so the result counts what was PLANNED, not what landed.
 */

// Same chunking NetworkDeviceService.getDevicesByHostnames uses.
const HOSTNAME_LOOKUP_CHUNK_SIZE: number = 500;

export interface MacLearningResult {
  candidateDeviceCount: number;
  // Writes issued. A compare-and-set that matched nothing is not subtracted.
  plannedCount: number;
}

export default class NetworkDeviceMacLearningUtil {
  public static async learnFromArpBindings(data: {
    projectId: ObjectID;
    // The router (or L3 switch) whose ARP table this is.
    observingDeviceId: ObjectID;
    observingSiteId: ObjectID | undefined;
    ipBindings: Array<MacLearningIpBinding>;
  }): Promise<MacLearningResult> {
    const addresses: Array<string> = Array.from(
      new Set<string>(
        data.ipBindings
          .map((binding: MacLearningIpBinding) => {
            return (binding.ipAddress || "").trim();
          })
          .filter((ip: string) => {
            return ip.length > 0;
          }),
      ),
    );

    if (addresses.length === 0) {
      return { candidateDeviceCount: 0, plannedCount: 0 };
    }

    /*
     * Every live device in the project registered at one of the bound
     * addresses. Not filtered by site or by an empty MAC column in SQL:
     * the planner needs to SEE a second device at the same address, or a
     * device that already has a MAC, to refuse correctly - a query that
     * hid them would make "exactly one" true by accident.
     */
    const candidates: Array<MacLearningCandidateDevice> = [];

    for (
      let offset: number = 0;
      offset < addresses.length;
      offset += HOSTNAME_LOOKUP_CHUNK_SIZE
    ) {
      const chunk: Array<string> = addresses.slice(
        offset,
        offset + HOSTNAME_LOOKUP_CHUNK_SIZE,
      );

      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: data.projectId,
          hostname: QueryHelper.any(chunk),
          isArchived: false,
        },
        select: {
          _id: true,
          hostname: true,
          siteId: true,
          macAddress: true,
          isMacAddressLearned: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const device of devices) {
        if (!device.id) {
          continue;
        }
        candidates.push({
          id: device.id.toString(),
          hostname: device.hostname,
          siteId: device.siteId?.toString(),
          macAddress: device.macAddress,
          isMacAddressLearned: device.isMacAddressLearned,
        });
      }
    }

    const plan: Array<MacLearningPlanEntry> =
      DeviceMacLearningUtil.planMacLearning({
        ipBindings: data.ipBindings,
        devices: candidates,
        observingSiteId: data.observingSiteId?.toString(),
      });

    let plannedCount: number = 0;

    for (const entry of plan) {
      await NetworkDeviceService.updateColumnsByIdWithoutHooks({
        id: new ObjectID(entry.deviceId),
        data: {
          macAddress: entry.macAddress,
          isMacAddressLearned: true,
        } as any,
        /*
         * Only while the column still holds what the plan saw - empty, or
         * the learned value being corrected - and never a row that was
         * deleted between the read and this write.
         */
        expectedData: {
          macAddress: entry.previousMacAddress,
          deletedAt: null,
        } as any,
      });
      plannedCount++;

      logger.debug(
        `Planned MAC ${entry.macAddress} for network device ${entry.deviceId} (${entry.ipAddress}) from the ARP table of device ${data.observingDeviceId.toString()}${
          entry.previousMacAddress
            ? `, correcting the learned ${entry.previousMacAddress}`
            : ""
        }; skipped if the column changed meanwhile.`,
      );
    }

    return { candidateDeviceCount: candidates.length, plannedCount };
  }
}
