import { normalizeMac } from "./EndpointAttachmentUtil";

/*
 * Pure planner for learning a managed device's MAC address from a walked
 * router's ARP table.
 *
 * WHY. A ping-only device is put on its switch port by the switch's
 * forwarding table, which knows MACs and nothing else - and a ping-only
 * device is exactly the device nothing ever asked for its MAC. A router's
 * ARP table is the bridge: it binds the address the device is registered at
 * to the MAC the switches learned. Writing that MAC onto the device once is
 * what keeps the device on its port after the ARP entry ages out, and after
 * the address changes.
 *
 * Deterministic and side-effect free, like EndpointAttachmentUtil: the
 * server util (NetworkDeviceMacLearningUtil) fetches the candidate devices,
 * hands them here, and applies whatever comes back.
 */

export interface MacLearningIpBinding {
  macAddress: string;
  ipAddress: string;
}

// One NetworkDevice row, reduced to what the plan needs.
export interface MacLearningCandidateDevice {
  id: string;
  hostname?: string | undefined;
  // A string, never an ObjectID: the plan keys on it.
  siteId?: string | undefined;
  macAddress?: string | undefined;
  /*
   * True when the stored MAC was written by an earlier pass rather than
   * typed. Only such a value may be corrected; a typed one is never touched.
   */
  isMacAddressLearned?: boolean | undefined;
}

export interface MacLearningPlanEntry {
  deviceId: string;
  macAddress: string;
  ipAddress: string;
  /*
   * What the column held when the plan was made: null for an empty column,
   * the previously learned MAC for a correction. The writer compares-and-
   * sets against it, so a value that changed under the plan is left alone.
   */
  previousMacAddress: string | null;
}

/*
 * null, undefined, "" and whitespace all read as the same "no site" key -
 * the convention NetworkDeviceLinkRuleUtil and the topology builder use.
 */
export function siteKeyOf(siteId: string | null | undefined): string {
  return (siteId || "").trim();
}

export default class DeviceMacLearningUtil {
  /*
   * Which devices get which MAC. The rules, every one of them a refusal:
   *
   *  - Only a device in the SAME site as the router that reported the
   *    binding. Every branch has a 10.0.0.5; a project-wide match would
   *    stamp one store's register with another store's MAC.
   *  - Only a device whose MAC column is EMPTY, or holds a MAC an earlier
   *    pass LEARNED that this table now contradicts. What an operator typed
   *    is theirs and is never touched. A learned value is the pass's own
   *    answer, and an ARP table is exactly the evidence that can be stale
   *    (an address re-leased the day before the register was plugged in
   *    stamps the previous holder's MAC), so the pass corrects itself when
   *    the address is later bound to a different MAC.
   *  - Only an address exactly one candidate device answers at. Two
   *    devices registered at one address is a contradiction, and a wrong
   *    MAC drawn as a cable is worse than none.
   *  - Only an address the ARP table binds to exactly one MAC. Proxy ARP
   *    and stale duplicates put two MACs behind one address; neither can
   *    be trusted.
   *
   * Output is sorted by device id, so a given input always plans the same
   * writes in the same order.
   */
  public static planMacLearning(data: {
    ipBindings: Array<MacLearningIpBinding>;
    devices: Array<MacLearningCandidateDevice>;
    observingSiteId?: string | null | undefined;
  }): Array<MacLearningPlanEntry> {
    const macsByIp: Map<string, Set<string>> = new Map<string, Set<string>>();
    for (const binding of data.ipBindings) {
      const mac: string | undefined = normalizeMac(binding.macAddress);
      const ip: string = (binding.ipAddress || "").trim();
      if (!mac || !ip) {
        continue;
      }
      const macs: Set<string> | undefined = macsByIp.get(ip);
      if (macs) {
        macs.add(mac);
      } else {
        macsByIp.set(ip, new Set<string>([mac]));
      }
    }

    const siteKey: string = siteKeyOf(data.observingSiteId);

    const devicesByIp: Map<string, Array<MacLearningCandidateDevice>> = new Map<
      string,
      Array<MacLearningCandidateDevice>
    >();
    for (const device of data.devices) {
      const hostname: string = (device.hostname || "").trim();
      if (!hostname || !macsByIp.has(hostname)) {
        continue;
      }
      if (siteKeyOf(device.siteId) !== siteKey) {
        continue;
      }
      const bucket: Array<MacLearningCandidateDevice> | undefined =
        devicesByIp.get(hostname);
      if (bucket) {
        bucket.push(device);
      } else {
        devicesByIp.set(hostname, [device]);
      }
    }

    const plan: Array<MacLearningPlanEntry> = [];

    for (const [ip, candidates] of devicesByIp) {
      // Two devices at one address: neither can be the one.
      if (candidates.length !== 1) {
        continue;
      }
      const macs: Set<string> = macsByIp.get(ip)!;
      // Two MACs behind one address: neither can be trusted.
      if (macs.size !== 1) {
        continue;
      }
      const device: MacLearningCandidateDevice = candidates[0]!;
      const learnedMac: string = Array.from(macs)[0]!;
      const storedMac: string | undefined = normalizeMac(device.macAddress);
      const hasStoredValue: boolean =
        (device.macAddress || "").trim().length > 0;

      if (!hasStoredValue) {
        plan.push({
          deviceId: device.id,
          macAddress: learnedMac,
          ipAddress: ip,
          previousMacAddress: null,
        });
        continue;
      }

      // Typed by somebody, or already what the table says: leave it.
      if (device.isMacAddressLearned !== true || storedMac === learnedMac) {
        continue;
      }

      plan.push({
        deviceId: device.id,
        macAddress: learnedMac,
        ipAddress: ip,
        /*
         * The raw stored value, not the normalised one: the writer's
         * compare-and-set has to match what the column actually holds.
         */
        previousMacAddress: device.macAddress || null,
      });
    }

    plan.sort((a: MacLearningPlanEntry, b: MacLearningPlanEntry) => {
      return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
    });

    return plan;
  }
}
