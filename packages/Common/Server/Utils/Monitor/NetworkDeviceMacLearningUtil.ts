import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService, {
  DiscoveredDetailsMerge,
} from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import {
  NetworkDeviceDiscoveredField,
  NetworkDeviceDiscoveredValue,
  NetworkDeviceDiscoveryReader,
  NetworkDeviceDiscoveryReaderType,
  buildDiscoveredValue,
  getDiscoveredTime,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import DeviceMacLearningUtil, {
  MacLearningIpBinding,
  MacLearningPlanEntry,
  MacObservationCandidateDevice,
  MacObservationPlanEntry,
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
 * And it never waits (OneUptime issue #7194): a device another writer holds
 * right now - its own poll, mostly - is skipped, not queued for. It used to
 * be queued for, device after device, inside the router's walk: one busy
 * device stalled the rest of the plan, and a wait past lock_timeout threw
 * the remainder away. A skipped device is planned again by the next walk
 * of the router, since its column still holds what the plan saw.
 *
 * The result counts what was PLANNED; `learnedCount` what landed.
 *
 * It also records each trusted reading in the device's discovered details
 * (OneUptime issue #5185): which router's table gave the device its MAC, and
 * when - and, for a MAC someone typed that the table contradicts, what the
 * table says, so both are shown. Never the column: a typed MAC is still never
 * touched. Planned by DeviceMacLearningUtil.planMacObservations, which
 * records a reading that has not changed at most once an hour.
 *
 * A network controller's client list binds addresses to MACs too
 * (NetworkControllerTopology), and goes through here by the same refusals. Its
 * readings name the connection that read them instead of a router, so a MAC
 * from Meraki is never shown as an ARP table's.
 */

// Same chunking NetworkDeviceService.getDevicesByHostnames uses.
const HOSTNAME_LOOKUP_CHUNK_SIZE: number = 500;

export interface MacLearningResult {
  candidateDeviceCount: number;
  // Writes issued. A compare-and-set that matched nothing is not subtracted.
  plannedCount: number;
  /*
   * Writes that landed: the device was not held by another writer, and its
   * column still held what the plan saw.
   */
  learnedCount: number;
  // Readings recorded in the devices' discovered details.
  observationCount: number;
}

export default class NetworkDeviceMacLearningUtil {
  public static async learnFromArpBindings(data: {
    projectId: ObjectID;
    // The router (or L3 switch) whose ARP table this is.
    observingDeviceId: ObjectID;
    // Its name, which the readings it gives are credited to.
    observingDeviceName?: string | undefined;
    observingSiteId: ObjectID | undefined;
    ipBindings: Array<MacLearningIpBinding>;
    // Who a reading is credited to, when that is not the device above.
    reader?: NetworkDeviceDiscoveryReader | undefined;
    /*
     * When the table was read: for a walk, when OneUptime received the poll
     * (OneUptime issue #7389), which can be many minutes before a worker
     * processes it. Its readings are stamped with it, and a device holding
     * a reading taken after it is neither corrected nor re-recorded by it.
     * Undefined, or not a time: now.
     */
    now?: Date | undefined;
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
      return {
        candidateDeviceCount: 0,
        plannedCount: 0,
        learnedCount: 0,
        observationCount: 0,
      };
    }

    /*
     * Every live device in the project registered at one of the bound
     * addresses. Not filtered by site or by an empty MAC column in SQL:
     * the planner needs to SEE a second device at the same address, or a
     * device that already has a MAC, to refuse correctly - a query that
     * hid them would make "exactly one" true by accident.
     */
    const candidates: Array<MacObservationCandidateDevice> = [];

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
          // What an earlier reading recorded, and when.
          discoveredDetails: true,
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

        const recorded: NetworkDeviceDiscoveredValue | undefined =
          readNetworkDeviceDiscoveredDetails(device.discoveredDetails).values[
            NetworkDeviceDiscoveredField.MacAddress
          ];

        candidates.push({
          id: device.id.toString(),
          hostname: device.hostname,
          siteId: device.siteId?.toString(),
          macAddress: device.macAddress,
          isMacAddressLearned: device.isMacAddressLearned,
          observedMacAddress: recorded?.value,
          observedAt: getDiscoveredTime(recorded),
        });
      }
    }

    const readAt: Date =
      data.now && !isNaN(data.now.getTime())
        ? data.now
        : OneUptimeDate.getCurrentDate();

    const plan: Array<MacLearningPlanEntry> =
      DeviceMacLearningUtil.planMacLearning({
        ipBindings: data.ipBindings,
        devices: candidates,
        observingSiteId: data.observingSiteId?.toString(),
        now: readAt.getTime(),
      });

    let plannedCount: number = 0;
    let learnedCount: number = 0;

    for (const entry of plan) {
      const learned: boolean =
        await NetworkDeviceService.updateColumnsByIdIfUnlockedWithoutHooks({
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

      if (learned) {
        learnedCount++;
      }

      logger.debug(
        `${learned ? "Learned" : "Did not learn"} MAC ${entry.macAddress} for network device ${entry.deviceId} (${entry.ipAddress}) from the ARP table of device ${data.observingDeviceId.toString()}${
          entry.previousMacAddress
            ? `, correcting the learned ${entry.previousMacAddress}`
            : ""
        }${
          learned
            ? ""
            : ": the device was held by another writer, its MAC column changed meanwhile, or it was deleted. The next walk plans it again."
        }`,
      );
    }

    const observationCount: number = await this.recordMacObservations({
      readAt: readAt,
      projectId: data.projectId,
      observingDeviceId: data.observingDeviceId,
      observingDeviceName: data.observingDeviceName,
      observingSiteId: data.observingSiteId,
      ipBindings: data.ipBindings,
      candidates: candidates,
      reader: data.reader,
    });

    return {
      candidateDeviceCount: candidates.length,
      plannedCount,
      learnedCount,
      observationCount,
    };
  }

  /*
   * The readings of this table worth recording, merged into the devices'
   * discovered details in one batched statement. Its own try/catch: the MACs
   * above are already learned, and a failure here must not read as one there.
   *
   * A device another writer holds is left out rather than waited for
   * (skipLockedDevices): its reading is planned again by the router's next
   * walk, since what it records is still older than the refresh interval.
   * Returns how many devices it recorded a reading on.
   */
  private static async recordMacObservations(data: {
    // When the table was read (see learnFromArpBindings).
    readAt: Date;
    projectId: ObjectID;
    observingDeviceId: ObjectID;
    observingDeviceName?: string | undefined;
    observingSiteId: ObjectID | undefined;
    ipBindings: Array<MacLearningIpBinding>;
    candidates: Array<MacObservationCandidateDevice>;
    reader?: NetworkDeviceDiscoveryReader | undefined;
  }): Promise<number> {
    try {
      const now: Date = data.readAt;
      const observations: Array<MacObservationPlanEntry> =
        DeviceMacLearningUtil.planMacObservations({
          ipBindings: data.ipBindings,
          devices: data.candidates,
          observingSiteId: data.observingSiteId?.toString(),
          now: now.getTime(),
        });

      const patches: Array<DiscoveredDetailsMerge> = [];

      for (const observation of observations) {
        const entry: NetworkDeviceDiscoveredValue | undefined =
          buildDiscoveredValue({
            field: NetworkDeviceDiscoveredField.MacAddress,
            value: observation.macAddress,
            readBy: data.reader || {
              type: NetworkDeviceDiscoveryReaderType.NetworkDevice,
              id: data.observingDeviceId.toString(),
              name: data.observingDeviceName,
            },
            readAt: now,
          });

        if (entry) {
          patches.push({
            deviceId: observation.deviceId,
            set: { [NetworkDeviceDiscoveredField.MacAddress]: entry },
          });
        }
      }

      if (patches.length === 0) {
        return 0;
      }

      return await NetworkDeviceService.mergeDiscoveredDetails({
        projectId: data.projectId,
        patches: patches,
        skipLockedDevices: true,
      });
    } catch (err) {
      logger.error(
        `Failed to record the MAC addresses the ARP table of network device ${data.observingDeviceId.toString()} gives its neighbours:`,
      );
      logger.error(err);
      return 0;
    }
  }
}
