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
 * A candidate device with the ARP reading recorded for it already (OneUptime
 * issue #5185): the MAC its discovered details say a router's table gave it,
 * and when that was read.
 */
export interface MacObservationCandidateDevice
  extends MacLearningCandidateDevice {
  observedMacAddress?: string | undefined;
  // Epoch milliseconds.
  observedAt?: number | undefined;
}

// One ARP reading to record in a device's discovered details.
export interface MacObservationPlanEntry {
  deviceId: string;
  // Lower-case colon form, as the device's MAC column stores it.
  macAddress: string;
  ipAddress: string;
}

/*
 * How often a reading that has not changed is recorded again. A router is
 * walked every few minutes and says the same thing every time; recording it
 * once an hour keeps "read 20 minutes ago" true to within the hour, at one
 * small write per device per hour rather than one per walk.
 */
export const MAC_OBSERVATION_REFRESH_INTERVAL_IN_MS: number = 60 * 60 * 1000;

// A binding every refusal below let through: this device has this MAC.
interface TrustedMacBinding {
  device: MacLearningCandidateDevice;
  macAddress: string;
  ipAddress: string;
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
    const plan: Array<MacLearningPlanEntry> = [];

    for (const binding of DeviceMacLearningUtil.getTrustedBindings(data)) {
      const device: MacLearningCandidateDevice = binding.device;
      const learnedMac: string = binding.macAddress;
      const storedMac: string | undefined = normalizeMac(device.macAddress);
      const hasStoredValue: boolean =
        (device.macAddress || "").trim().length > 0;

      if (!hasStoredValue) {
        plan.push({
          deviceId: device.id,
          macAddress: learnedMac,
          ipAddress: binding.ipAddress,
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
        ipAddress: binding.ipAddress,
        /*
         * The raw stored value, not the normalised one: the writer's
         * compare-and-set has to match what the column actually holds.
         */
        previousMacAddress: device.macAddress || null,
      });
    }

    return DeviceMacLearningUtil.sortByDeviceId(plan);
  }

  /*
   * Which ARP readings to record in the devices' discovered details
   * (OneUptime issue #5185), so a MAC says which router's table it came from
   * and when - and so a MAC someone TYPED is shown beside what the table
   * says when the two differ, rather than silently disagreeing with it.
   *
   * The bindings are the ones the learner trusts, by the same refusals
   * (getTrustedBindings): same site, one device at the address, one MAC
   * behind it. Of those, a reading is recorded when:
   *
   *   - the device has none recorded, or one with a different MAC: the
   *     table's answer is new;
   *   - the recorded one is older than MAC_OBSERVATION_REFRESH_INTERVAL_IN_MS:
   *     the table still says it, and "when" should say so.
   *
   * Except for a device whose TYPED MAC is what the table says: nothing is
   * worth recording for it, because the typed value is what is shown and
   * nothing disagrees - unless an earlier reading disagreed, which is now
   * replaced so the disagreement goes.
   *
   * Sorted by device id, like the learning plan.
   */
  public static planMacObservations(data: {
    ipBindings: Array<MacLearningIpBinding>;
    devices: Array<MacObservationCandidateDevice>;
    observingSiteId?: string | null | undefined;
    // Epoch milliseconds.
    now: number;
  }): Array<MacObservationPlanEntry> {
    const plan: Array<MacObservationPlanEntry> = [];

    for (const binding of DeviceMacLearningUtil.getTrustedBindings(data)) {
      const device: MacObservationCandidateDevice =
        binding.device as MacObservationCandidateDevice;
      const mac: string = binding.macAddress;
      const recordedMac: string | undefined = normalizeMac(
        device.observedMacAddress,
      );
      const storedMac: string | undefined = normalizeMac(device.macAddress);
      const isTyped: boolean =
        (device.macAddress || "").trim().length > 0 &&
        device.isMacAddressLearned !== true;

      let shouldRecord: boolean;

      if (isTyped && storedMac === mac) {
        shouldRecord = Boolean(recordedMac && recordedMac !== mac);
      } else if (!recordedMac || recordedMac !== mac) {
        shouldRecord = true;
      } else {
        shouldRecord =
          device.observedAt === undefined ||
          data.now - device.observedAt >=
            MAC_OBSERVATION_REFRESH_INTERVAL_IN_MS;
      }

      if (shouldRecord) {
        plan.push({
          deviceId: device.id,
          macAddress: mac,
          ipAddress: binding.ipAddress,
        });
      }
    }

    return DeviceMacLearningUtil.sortByDeviceId(plan);
  }

  private static sortByDeviceId<T extends { deviceId: string }>(
    entries: Array<T>,
  ): Array<T> {
    return entries.sort((a: T, b: T) => {
      return a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : 0;
    });
  }

  /*
   * The bindings of an ARP table that say which MAC a device has, by the
   * refusals planMacLearning lists: one per device that is the only device
   * at its address in the router's site, behind exactly one MAC.
   */
  private static getTrustedBindings(data: {
    ipBindings: Array<MacLearningIpBinding>;
    devices: Array<MacLearningCandidateDevice>;
    observingSiteId?: string | null | undefined;
  }): Array<TrustedMacBinding> {
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

    const trusted: Array<TrustedMacBinding> = [];

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

      trusted.push({
        device: candidates[0]!,
        macAddress: Array.from(macs)[0]!,
        ipAddress: ip,
      });
    }

    return trusted;
  }
}
