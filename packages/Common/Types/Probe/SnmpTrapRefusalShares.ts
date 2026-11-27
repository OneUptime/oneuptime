import IP from "../IP/IP";
import SnmpTrapReceiverUtil, {
  MAX_REPORTED_SNMP_TRAP_REFUSALS,
  SnmpTrapRefusal,
  SnmpTrapRefusalReason,
} from "./SnmpTrapReceiver";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";

/*
 * A GLOBAL PROBE'S REFUSED SNMPv3 TRAPS, SPLIT BY PROJECT AS THEY ARRIVE
 * (OneUptime issue #11173).
 *
 * A global probe serves many projects, and the SNMPv3 traps it refuses are
 * counted by source address and user name: kept whole, one project would
 * read another's addresses and user names. So each refusal goes to the one
 * project whose devices on the probe have its source address - their
 * hostname, when it is an address, or one of their Other Addresses, the
 * addresses a device's page matches refusals by - and to nobody else:
 *
 *   - From an address no device on the probe has: to nobody. No project
 *     can be told it is theirs, and a probe on the internet hears every
 *     scanner.
 *   - From an address devices of two projects have: to nobody either. Each
 *     would read the user name the other's device sent.
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
 * What is kept for a project is kept for it alone (GlobalProbeSnmpTrapReport)
 * and read on its devices' pages as a project probe's report is.
 */

// One device on the probe, as the split reads it.
export interface SnmpTrapRefusalShareDevice {
  projectId: string;
  // Its hostname, when it is an address, and its Other Addresses.
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
   * most recent first, at most MAX_REPORTED_SNMP_TRAP_REFUSALS. A project
   * with none is not in the answer.
   *
   * `userNamesByProject` holds each project's own SNMPv3 user names among
   * those the probe was handed.
   */
  public static split(data: {
    refusals: Array<SnmpTrapRefusal>;
    devices: Array<SnmpTrapRefusalShareDevice>;
    userNamesByProject: Map<string, ReadonlySet<string>>;
  }): Map<string, Array<SnmpTrapRefusal>> {
    const projectsByAddress: Map<string, Set<string>> =
      SnmpTrapRefusalShares.getProjectsByAddress(data.devices);

    // By project, then by what a row says: source, reason and user.
    const sharesByProject: Map<string, Map<string, SnmpTrapRefusal>> =
      new Map();

    for (const refusal of data.refusals) {
      const projects: Set<string> | undefined = projectsByAddress.get(
        SnmpTrapRefusalShares.canonical(refusal.sourceAddress),
      );

      if (!projects || projects.size !== 1) {
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
        share.set(key, { ...refusal, reason: reason });
        continue;
      }

      // Two reasons that read as one to this project are one row.
      share.set(key, {
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
      });
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
   * A user name as a refusal shows it, for comparing a project's user names
   * with the names refusals carry.
   */
  public static toRefusalUserName(userName: string): string {
    return SnmpTrapReceiverUtil.toDisplayableUserName(userName);
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

  private static getProjectsByAddress(
    devices: Array<SnmpTrapRefusalShareDevice>,
  ): Map<string, Set<string>> {
    const projectsByAddress: Map<string, Set<string>> = new Map();

    for (const device of devices) {
      if (!device.projectId) {
        continue;
      }

      for (const address of device.addresses) {
        const canonical: string = SnmpTrapRefusalShares.canonical(address);

        if (!canonical) {
          continue;
        }

        const projects: Set<string> =
          projectsByAddress.get(canonical) || new Set();
        projects.add(device.projectId.toLowerCase());
        projectsByAddress.set(canonical, projects);
      }
    }

    return projectsByAddress;
  }

  private static canonical(address: string): string {
    const trimmed: string = (address || "").trim();

    return trimmed && IP.isIP(trimmed)
      ? IpCanonicalUtil.canonicalize(trimmed)
      : "";
  }
}
