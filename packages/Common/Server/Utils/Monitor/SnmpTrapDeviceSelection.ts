import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import SnmpTrap from "../../../Types/Monitor/SnmpMonitor/SnmpTrap";
import SnmpSecurityLevel, {
  SnmpSecurityLevelUtil,
} from "../../../Types/Monitor/SnmpMonitor/SnmpSecurityLevel";
import { SnmpVersionUtil } from "../../../Types/Monitor/SnmpMonitor/SnmpVersion";
import SnmpTrapReceiverUtil from "../../../Types/Probe/SnmpTrapReceiver";
import SnmpV3CredentialHolderUtil, {
  SnmpV3CredentialHolders,
} from "../../../Types/Probe/SnmpV3CredentialHolders";
import SnmpTrapContextRouting from "./SnmpTrapContextRouting";

/*
 * WHICH OF A PROBE'S DEVICES AN SNMP TRAP CAME FROM (OneUptime issue
 * #11172).
 *
 * A trap is matched to the probe's devices by the address it came from. A
 * device has an address in one of three ways, and the first that finds any
 * device is the one a v1 or v2c trap goes by, as it always has: its
 * hostname is the address, one of its Other Addresses is, or its hostname
 * resolves to it. That is right for a device alone at its address, and
 * wrong for devices that send from one: behind a NAT, or blades that send
 * from their chassis's management address. A trap from any of them went to
 * whichever device had the address first - or to every device that had it.
 *
 * An SNMPv3 trap the probe authenticated says more than its address, and
 * it is matched by all of it:
 *
 *   1. Its credential's projects. The probe sends back which records hold
 *      the credential that signed it (SnmpTrap.signedBy), and the trap goes
 *      only to devices of those projects: it is kept in a project whose own
 *      keys signed it, or in none. Devices of another project at the same
 *      address never see it.
 *   2. Every device of those that has the address, whichever way it has it,
 *      narrowed by the SNMPv3 context the trap names first, as before
 *      (SnmpTrapContextRouting: a Brocade Virtual Fabric's logical switch).
 *   3. Its engine ID. A device's own agent answers its SNMPv3 polls as an
 *      engine, and sends its traps as the same one: the devices whose last
 *      SNMPv3 poll read the trap's engine ID (NetworkDevice.snmpEngineId)
 *      are the ones it came from.
 *   4. Its credential's devices: of those left, the ones that carry the
 *      credential that signed it - their own SNMPv3 credentials, their
 *      credential profile's or their site's default.
 *   5. Of those still left, a device whose agent is known to be another
 *      engine did not send it, while one that may have is left: so devices
 *      that share a site's default credential are told apart once all but
 *      one of them are polled over SNMPv3.
 *   6. What is left, the first way the address finds any of them: the same
 *      order a v1 or v2c trap goes by.
 *
 * Each step narrows only when something is left: what it cannot tell apart
 * goes on to the next, and a trap that nothing tells apart goes where it
 * went before. A device alone at its address gets every trap from it, as
 * before; only devices that share an address are told apart.
 *
 * A noAuthNoPriv trap, or one from a probe older than this, carries nothing
 * a sender could not make up, and is matched by its address alone.
 */

// How a device has a trap's source address, in the order the address goes by.
export interface SnmpTrapSourceTiers {
  // Its hostname is the address.
  hostname: Array<NetworkDevice>;
  // One of its Other Addresses is.
  otherAddress: Array<NetworkDevice>;
  // Its hostname is a DNS name that resolves to it.
  dns: Array<NetworkDevice>;
}

export default class SnmpTrapDeviceSelection {
  /*
   * Whether the probe authenticated the trap: SNMPv3, signed with a key.
   * Only such a trap's engine ID and credential say who sent it.
   */
  public static isAuthenticatedSnmpV3(trap: SnmpTrap): boolean {
    // "3" as the probe sends it; "v3" too, however a trap was written.
    if (
      typeof trap.snmpVersion !== "string" ||
      !SnmpVersionUtil.isV3(trap.snmpVersion)
    ) {
      return false;
    }

    const level: SnmpSecurityLevel | undefined = SnmpSecurityLevelUtil.parse(
      typeof trap.securityLevel === "string" ? trap.securityLevel : undefined,
    );

    return (
      level === SnmpSecurityLevel.AuthNoPriv ||
      level === SnmpSecurityLevel.AuthPriv
    );
  }

  /*
   * Who holds the credential an authenticated trap was signed with, read as
   * what it can be (it came through the queue as JSON). Null for any other
   * trap, and when the probe did not say.
   */
  public static getSigners(trap: SnmpTrap): SnmpV3CredentialHolders | null {
    if (!SnmpTrapDeviceSelection.isAuthenticatedSnmpV3(trap)) {
      return null;
    }

    return SnmpV3CredentialHolderUtil.sanitize(trap.signedBy);
  }

  // The devices a trap goes to, of those at its source address.
  public static select(data: {
    tiers: SnmpTrapSourceTiers;
    trap: SnmpTrap;
  }): Array<NetworkDevice> {
    const trap: SnmpTrap = data.trap;
    const tiers: Array<Array<NetworkDevice>> = [
      data.tiers.hostname,
      data.tiers.otherAddress,
      data.tiers.dns,
    ];

    const signers: SnmpV3CredentialHolders | null =
      SnmpTrapDeviceSelection.getSigners(trap);
    const engineId: string | null =
      SnmpTrapDeviceSelection.isAuthenticatedSnmpV3(trap)
        ? SnmpTrapReceiverUtil.normalizeEngineId(trap.engineId)
        : null;

    // Nothing but its address says who sent it: as before.
    if (!signers && !engineId) {
      return SnmpTrapContextRouting.devicesForTrap({
        devices: SnmpTrapDeviceSelection.firstTier(tiers, null),
        contextName: trap.contextName,
      });
    }

    // 1 and 2: every device with the address, of the credential's projects, in its context.
    let devices: Array<NetworkDevice> = SnmpTrapDeviceSelection.unique(
      tiers.flat(),
    );

    if (signers) {
      devices = devices.filter((device: NetworkDevice): boolean => {
        return Boolean(
          device.projectId &&
            SnmpV3CredentialHolderUtil.isHeldByProject(
              signers,
              device.projectId.toString(),
            ),
        );
      });
    }

    devices = SnmpTrapContextRouting.devicesForTrap({
      devices: devices,
      contextName: trap.contextName,
    });

    if (devices.length <= 1) {
      return devices;
    }

    // 3. The devices whose agent answers as the engine it came from.
    const sameEngine: Array<NetworkDevice> = engineId
      ? devices.filter((device: NetworkDevice): boolean => {
          return SnmpTrapDeviceSelection.engineIdOf(device) === engineId;
        })
      : [];

    if (sameEngine.length > 0) {
      devices = sameEngine;
    }

    // 4. The devices that carry the credential that signed it.
    const signerDeviceIds: Array<string> | undefined = signers?.deviceIds;

    if (signerDeviceIds && devices.length > 1) {
      const carrying: Array<NetworkDevice> = devices.filter(
        (device: NetworkDevice): boolean => {
          return signerDeviceIds.includes(
            device.id?.toString().toLowerCase() || "",
          );
        },
      );

      if (carrying.length > 0) {
        devices = carrying;
      }
    }

    /*
     * 5. Of the devices still left, one whose agent is known
     * to be another engine did not send it - while one that may have is
     * left. After the credential, which says more: a device replaced since
     * its last poll still carries its own credential.
     */
    if (engineId && sameEngine.length === 0 && devices.length > 1) {
      const notAnotherEngine: Array<NetworkDevice> = devices.filter(
        (device: NetworkDevice): boolean => {
          return !SnmpTrapDeviceSelection.engineIdOf(device);
        },
      );

      if (notAnotherEngine.length > 0) {
        devices = notAnotherEngine;
      }
    }

    // 6. The first way the address finds any of those left.
    return SnmpTrapDeviceSelection.firstTier(tiers, devices);
  }

  /*
   * The trap as it is kept - in a device's trap history, a monitor's log and
   * its criteria - without the records that hold its credential: they are
   * how it was matched, and may name other projects that hold the same
   * credential, which no project's records may carry.
   */
  public static withoutSigners(trap: SnmpTrap): SnmpTrap {
    if (!("signedBy" in trap)) {
      return trap;
    }

    const kept: SnmpTrap = { ...trap };
    delete kept.signedBy;

    return kept;
  }

  // How many devices have the address, whichever way.
  public static countDevices(tiers: SnmpTrapSourceTiers): number {
    return SnmpTrapDeviceSelection.unique([
      ...tiers.hostname,
      ...tiers.otherAddress,
      ...tiers.dns,
    ]).length;
  }

  private static engineIdOf(device: NetworkDevice): string | null {
    return SnmpTrapReceiverUtil.normalizeEngineId(device.snmpEngineId);
  }

  /*
   * The devices of the first tier that holds any of `among` (any device at
   * all, when `among` is null), in that tier's order.
   */
  private static firstTier(
    tiers: Array<Array<NetworkDevice>>,
    among: Array<NetworkDevice> | null,
  ): Array<NetworkDevice> {
    const wanted: Set<string> | null = among
      ? new Set(
          among.map((device: NetworkDevice): string => {
            return SnmpTrapDeviceSelection.keyOf(device);
          }),
        )
      : null;
    const seen: Set<string> = new Set();

    for (const tier of tiers) {
      const found: Array<NetworkDevice> = [];

      for (const device of tier) {
        const key: string = SnmpTrapDeviceSelection.keyOf(device);

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        if (!wanted || wanted.has(key)) {
          found.push(device);
        }
      }

      if (found.length > 0) {
        return found;
      }
    }

    return [];
  }

  private static unique(devices: Array<NetworkDevice>): Array<NetworkDevice> {
    const seen: Set<string> = new Set();
    const unique: Array<NetworkDevice> = [];

    for (const device of devices) {
      const key: string = SnmpTrapDeviceSelection.keyOf(device);

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(device);
      }
    }

    return unique;
  }

  private static keyOf(device: NetworkDevice): string {
    return device.id?.toString().toLowerCase() || "";
  }
}
