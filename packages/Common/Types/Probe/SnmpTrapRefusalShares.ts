import IP from "../IP/IP";
import SnmpTrapReceiverUtil, {
  MAX_REPORTED_SNMP_TRAP_REFUSALS,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "./SnmpTrapReceiver";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";

/*
 * A GLOBAL PROBE'S REFUSED SNMPv3 TRAPS, SPLIT BY PROJECT AS THEY ARRIVE
 * (OneUptime issues #11173, #11406).
 *
 * A global probe serves many projects, and the SNMPv3 traps it refuses are
 * counted by source address and user name: kept whole, one project would
 * read another's addresses and user names. So each refusal goes to the one
 * project whose devices on the probe have its source address - their
 * hostname, when it is an address, one of their Other Addresses, or the
 * address their DNS name resolves to, the way a trap is matched to its
 * device - and to nobody else:
 *
 *   - From an address no device on the probe has: to nobody. No project
 *     can be told it is theirs, and a probe on the internet hears every
 *     scanner.
 *   - From an address devices of two projects have, however each has it: to
 *     nobody either. Each would read the user name the other's device sent.
 *     A DNS name is no exception: one project's name that resolves to an
 *     address another project's device has, or to the address another
 *     project's name resolves to, gives neither project the refusal.
 *   - Its reason as the project would see it. A probe refuses a trap as
 *     signed with a wrong key, encrypted with a wrong key, outside the time
 *     window or with too little security only when SOME project gave it a
 *     user of that name; told to a project that has no user of that name,
 *     the reason would say another project has one. So for a project with
 *     no SNMPv3 user of that name on the probe, it is "unknown user", which
 *     is what that project must fix: give its device that user. An inform
 *     sent to another engine ID is refused for the engine, whoever it came
 *     as, and is said as it was.
 *
 * Each refusal kept for a project names the project's devices it came from
 * (SnmpTrapRefusal.deviceIds), and only those: a device's pages read their
 * own refusals by it. A project's own probe keeps its report whole, each
 * refusal named the same way (attributeToDevices).
 *
 * What is kept for a project is kept for it alone (GlobalProbeSnmpTrapReport)
 * and read on its devices' pages as a project probe's report is.
 */

// One device on the probe, as the split reads it.
export interface SnmpTrapRefusalShareDevice {
  id: string;
  projectId: string;
  /*
   * The addresses its traps come from: its hostname, when it is an
   * address, its Other Addresses, and the addresses its DNS name resolved
   * to (#11406).
   */
  addresses: Array<string>;
}

// The reasons a probe gives only for a user name some project gave it.
const KNOWN_USER_REASONS: ReadonlySet<SnmpTrapRefusalReason> = new Set([
  SnmpTrapRefusalReason.WrongDigest,
  SnmpTrapRefusalReason.DecryptionError,
  SnmpTrapRefusalReason.NotInTimeWindow,
  SnmpTrapRefusalReason.UnsupportedSecurityLevel,
]);

export default class SnmpTrapRefusalShares {
  /*
   * Each project's share of a global probe's refusals, by project ID: the
   * most recent first, at most MAX_REPORTED_SNMP_TRAP_REFUSALS, each naming
   * the project's own devices it came from. A project with none is not in
   * the answer.
   *
   * `userNamesByProject` holds each project's own SNMPv3 user names among
   * those the probe was handed.
   */
  public static split(data: {
    refusals: Array<SnmpTrapRefusal>;
    devices: Array<SnmpTrapRefusalShareDevice>;
    userNamesByProject: Map<string, ReadonlySet<string>>;
  }): Map<string, Array<SnmpTrapRefusal>> {
    const devicesByAddress: Map<
      string,
      Array<SnmpTrapRefusalShareDevice>
    > = SnmpTrapRefusalShares.getDevicesByAddress(data.devices);

    // By project, then by what a row says: source, reason and user.
    const sharesByProject: Map<
      string,
      Map<string, SnmpTrapRefusal>
    > = new Map();

    for (const refusal of data.refusals) {
      const devices: Array<SnmpTrapRefusalShareDevice> =
        devicesByAddress.get(
          SnmpTrapRefusalShares.canonical(refusal.sourceAddress),
        ) || [];

      const projects: Set<string> = new Set(
        devices.map((device: SnmpTrapRefusalShareDevice): string => {
          return device.projectId;
        }),
      );

      if (projects.size !== 1) {
        continue;
      }

      const projectId: string = Array.from(projects)[0]!;

      const reason: SnmpTrapRefusalReason =
        SnmpTrapRefusalShares.reasonForProject({
          refusal: refusal,
          userNames: data.userNamesByProject.get(projectId),
        });

      const share: Map<string, SnmpTrapRefusal> =
        sharesByProject.get(projectId) || new Map();
      sharesByProject.set(projectId, share);

      const key: string = JSON.stringify([
        refusal.sourceAddress,
        reason,
        refusal.userName,
      ]);

      const existing: SnmpTrapRefusal | undefined = share.get(key);

      if (!existing) {
        share.set(
          key,
          SnmpTrapRefusalShares.withDevices(
            { ...refusal, reason: reason },
            devices,
          ),
        );
        continue;
      }

      // Two reasons that read as one to this project are one row.
      share.set(
        key,
        SnmpTrapRefusalShares.withDevices(
          {
            ...existing,
            count: existing.count + refusal.count,
            firstSeenAt:
              refusal.firstSeenAt < existing.firstSeenAt
                ? refusal.firstSeenAt
                : existing.firstSeenAt,
            lastSeenAt:
              refusal.lastSeenAt > existing.lastSeenAt
                ? refusal.lastSeenAt
                : existing.lastSeenAt,
          },
          devices,
        ),
      );
    }

    const shares: Map<string, Array<SnmpTrapRefusal>> = new Map();

    for (const [projectId, share] of sharesByProject) {
      shares.set(
        projectId,
        Array.from(share.values())
          .sort((a: SnmpTrapRefusal, b: SnmpTrapRefusal): number => {
            return b.lastSeenAt.localeCompare(a.lastSeenAt);
          })
          .slice(0, MAX_REPORTED_SNMP_TRAP_REFUSALS),
      );
    }

    return shares;
  }

  /*
   * A project's own probe's refusals, each naming the devices it came from
   * (#11406): every device on the probe that has its source address, as its
   * hostname, an Other Address or what its DNS name resolves to. The probe
   * is the project's, and so are the devices it is read with
   * (NetworkDeviceService.findDevicesAtAddressesOnProbe), so the report it
   * keeps whole names its own devices only. A refusal no device sent names
   * none, and is still the probe's own page's to show.
   */
  public static attributeToDevices(data: {
    refusals: Array<SnmpTrapRefusal>;
    devices: Array<SnmpTrapRefusalShareDevice>;
  }): Array<SnmpTrapRefusal> {
    const devicesByAddress: Map<
      string,
      Array<SnmpTrapRefusalShareDevice>
    > = SnmpTrapRefusalShares.getDevicesByAddress(data.devices);

    return data.refusals.map((refusal: SnmpTrapRefusal): SnmpTrapRefusal => {
      return SnmpTrapRefusalShares.withDevices(
        refusal,
        devicesByAddress.get(
          SnmpTrapRefusalShares.canonical(refusal.sourceAddress),
        ) || [],
      );
    });
  }

  /*
   * A user name as a refusal shows it, for comparing a project's user names
   * with the names refusals carry.
   */
  public static toRefusalUserName(userName: string): string {
    return SnmpTrapReceiverUtil.toDisplayableUserName(userName);
  }

  // A refusal naming exactly these devices, or none when there are none.
  private static withDevices(
    refusal: SnmpTrapRefusal,
    devices: Array<SnmpTrapRefusalShareDevice>,
  ): SnmpTrapRefusal {
    const withoutDevices: SnmpTrapRefusal = { ...refusal };
    delete withoutDevices.deviceIds;

    const deviceIds: Array<string> | undefined =
      SnmpTrapReceiverUtil.sanitizeDeviceIds(
        devices.map((device: SnmpTrapRefusalShareDevice): string => {
          return device.id;
        }),
      );

    return deviceIds
      ? { ...withoutDevices, deviceIds: deviceIds }
      : withoutDevices;
  }

  private static reasonForProject(data: {
    refusal: SnmpTrapRefusal;
    userNames: ReadonlySet<string> | undefined;
  }): SnmpTrapRefusalReason {
    if (!KNOWN_USER_REASONS.has(data.refusal.reason)) {
      return data.refusal.reason;
    }

    return data.userNames?.has(data.refusal.userName)
      ? data.refusal.reason
      : SnmpTrapRefusalReason.UnknownUser;
  }

  // Each device under every address it has, each device once per address.
  private static getDevicesByAddress(
    devices: Array<SnmpTrapRefusalShareDevice>,
  ): Map<string, Array<SnmpTrapRefusalShareDevice>> {
    const devicesByAddress: Map<string, Array<SnmpTrapRefusalShareDevice>> =
      new Map();

    for (const device of devices) {
      if (!device.projectId || !device.id) {
        continue;
      }

      const normalized: SnmpTrapRefusalShareDevice = {
        id: device.id.toLowerCase(),
        projectId: device.projectId.toLowerCase(),
        addresses: device.addresses,
      };

      for (const address of device.addresses) {
        const canonical: string = SnmpTrapRefusalShares.canonical(address);

        if (!canonical) {
          continue;
        }

        const atAddress: Array<SnmpTrapRefusalShareDevice> =
          devicesByAddress.get(canonical) || [];

        if (
          !atAddress.some((known: SnmpTrapRefusalShareDevice): boolean => {
            return known.id === normalized.id;
          })
        ) {
          atAddress.push(normalized);
        }

        devicesByAddress.set(canonical, atAddress);
      }
    }

    return devicesByAddress;
  }

  private static canonical(address: string): string {
    const trimmed: string = (address || "").trim();

    return trimmed && IP.isIP(trimmed)
      ? IpCanonicalUtil.canonicalize(trimmed)
      : "";
  }
}
